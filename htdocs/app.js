'use strict';

// ============================================================
// Constants
// ============================================================
const API = 'http://localhost:8080';
const IDB_NAME = 'crm_app';
const IDB_STORE = 'db_bytes';
const IDB_KEY = 'crm_db';

const CONTACT_FIELDS = [
  ['XID', 'ID (auto)'],
  ['contact_first_name', 'First Name'],
  ['contact_last_name', 'Last Name'],
  ['contact_salutation', 'Salutation'],
  ['contact_street', 'Street'],
  ['contact_street2', 'Street 2'],
  ['contact_city', 'City'],
  ['contact_zip', 'ZIP'],
  ['contact_state', 'State'],
  ['contact_country', 'Country'],
  ['contact_phone', 'Phone'],
  ['contact_mobile', 'Mobile'],
  ['contact_home_phone', 'Home Phone'],
  ['contact_email', 'Email'],
  ['contact_title', 'Title'],
  ['contact_department', 'Department'],
  ['contact_birthdate', 'Birthdate'],
  ['contact_description', 'Description'],
  ['contact_email_opt_out', 'Email Opt-Out'],
  ['contact_party', 'Party Affiliation'],
  ['contact_district', 'District'],
  ['contact_precinct', 'Precinct'],
  ['contact_voter_id', 'Voter ID'],
  ['contact_gender', 'Gender'],
  ['contact_note', 'Notes'],
];

const SCHEMA_DOC = `# Contact Table Schema

This database contains a \`contact\` table with the following columns:

| Column | Description |
|--------|-------------|
| XID | Unique integer ID |
| contact_first_name | First name |
| contact_last_name | Last name |
| contact_salutation | Salutation (Mr., Ms., Dr., etc.) |
| contact_street | Street address |
| contact_street2 | Street address line 2 |
| contact_city | City |
| contact_zip | ZIP / postal code |
| contact_state | State / province |
| contact_country | Country |
| contact_phone | Primary phone |
| contact_mobile | Mobile phone |
| contact_home_phone | Home phone |
| contact_email | Email address |
| contact_title | Job title |
| contact_department | Department |
| contact_birthdate | Birthdate (YYYYMMDD integer) |
| contact_description | General description |
| contact_email_opt_out | 1 = opted out of email |
| contact_party | Political party affiliation (e.g. Democrat, Republican, Independent) |
| contact_district | Electoral district (e.g. NY-12, NY-14) |
| contact_precinct | Voting precinct |
| contact_voter_id | State voter registration ID |
| contact_gender | Gender |
| contact_note | Free-text notes — may contain consumer preferences, interests, household details, donor history, or any other CRM notes |
| contact_is_deleted | 1 = deleted (soft delete) |

All contacts in contacts.db have contact_is_deleted = 0.
`;

// ============================================================
// State
// ============================================================
let SQL = null;
let db = null;
let csvData = null;       // { headers, rows } from PapaParse
let columnMap = {};       // csvHeader -> contactField
let selectedContactIds = []; // XIDs from query result
let lastQuerySQL = '';
let pollTimer = null;
let currentJobId = null;

// ============================================================
// IndexedDB helpers
// ============================================================
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

async function idbDelete(key) {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

// ============================================================
// DB init
// ============================================================
const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS contact (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_first_name TEXT, contact_last_name TEXT, contact_salutation TEXT,
  contact_street TEXT, contact_street2 TEXT, contact_street3 TEXT,
  contact_city TEXT, contact_zip TEXT, contact_state TEXT, contact_country TEXT,
  contact_x REAL, contact_y REAL,
  contact_mail_street TEXT, contact_mail_street2 TEXT, contact_mail_street3 TEXT,
  contact_mail_city TEXT, contact_mail_zip TEXT, contact_mail_state TEXT, contact_mail_country TEXT,
  contact_phone TEXT, contact_fax TEXT, contact_mobile TEXT,
  contact_home_phone TEXT, contact_other_phone TEXT, contact_assistant_phone TEXT,
  contact_email TEXT, contact_title TEXT, contact_department TEXT,
  contact_birthdate INTEGER, contact_description TEXT,
  contact_email_opt_out INTEGER DEFAULT 0,
  contact_email_bounced_reason TEXT, contact_email_bounced_date INTEGER,
  contact_party TEXT, contact_district TEXT, contact_precinct TEXT,
  contact_voter_id TEXT, contact_gender TEXT,
  contact_note TEXT, contact_is_deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS campaign (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_name TEXT, campaign_status TEXT, campaign_active INTEGER,
  campaign_type TEXT, campaign_description TEXT,
  campaign_start_date INTEGER, campaign_end_date INTEGER,
  campaign_notes TEXT
);
`;

let saveDebounce = null;
function scheduleSave() {
  if (saveDebounce) clearTimeout(saveDebounce);
  saveDebounce = setTimeout(saveDB, 800);
}

async function saveDB() {
  if (!db) return;
  const bytes = db.export();
  await idbSet(IDB_KEY, bytes);
}

async function initApp() {
  setStatus('Initializing…');
  SQL = await initSqlJs({ locateFile: f => `lib/${f}` });

  const saved = await idbGet(IDB_KEY);
  if (saved) {
    db = new SQL.Database(saved);
    // Ensure new columns exist (idempotent migration)
    applyMigrations();
  } else {
    db = new SQL.Database();
    db.run(CREATE_SCHEMA);
    await saveDB();
  }

  updateContactCount();
  setStatus('Ready');
  startPoll();
  loadJobs();
}

function applyMigrations() {
  const newCols = [
    'contact_party TEXT', 'contact_district TEXT', 'contact_precinct TEXT',
    'contact_voter_id TEXT', 'contact_gender TEXT',
  ];
  for (const col of newCols) {
    try { db.run(`ALTER TABLE contact ADD COLUMN ${col}`); } catch (_) {}
  }
}

function updateContactCount() {
  try {
    const r = db.exec('SELECT COUNT(*) FROM contact WHERE contact_is_deleted=0');
    const n = r[0]?.values[0][0] ?? 0;
    document.getElementById('contact-count-badge').textContent = `${n} contacts`;
    document.getElementById('db-info').textContent = `Browser database has ${n} contacts.`;
  } catch (_) {}
}

// ============================================================
// Section toggle
// ============================================================
function toggleSection(id) {
  const body = document.querySelector(`#${id} .sec-body`);
  body.classList.toggle('collapsed');
}

// ============================================================
// Status bar
// ============================================================
function setStatus(msg) {
  document.getElementById('status-bar').textContent = msg;
}

// ============================================================
// Section 0: Tools
// ============================================================
function clearDatabases() {
  if (!confirm('Clear all contact data? This cannot be undone.')) return;
  db.run('DELETE FROM contact');
  db.run('DELETE FROM campaign');
  scheduleSave();
  updateContactCount();
  selectedContactIds = [];
  document.getElementById('selected-count-badge').textContent = 'none selected';
  setStatus('Database cleared');
}

async function deleteAllData() {
  if (!confirm('Delete ALL local data and reload? This cannot be undone.')) return;
  await idbDelete(IDB_KEY);
  localStorage.clear();
  location.reload();
}

// ============================================================
// Section 1: Import Data
// ============================================================
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
document.getElementById('csv-input').addEventListener('change', e => handleFile(e.target.files[0]));

function handleFile(file) {
  if (!file) return;
  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: result => {
      csvData = { headers: result.meta.fields, rows: result.data };
      showMapper();
    }
  });
}

function showMapper() {
  const { headers, rows } = csvData;
  columnMap = {};

  // Auto-suggest mappings
  const suggestions = {
    'first': 'contact_first_name', 'first name': 'contact_first_name', 'firstname': 'contact_first_name',
    'last': 'contact_last_name', 'last name': 'contact_last_name', 'lastname': 'contact_last_name',
    'name': 'contact_last_name',
    'email': 'contact_email', 'e-mail': 'contact_email',
    'phone': 'contact_phone', 'telephone': 'contact_phone', 'cell': 'contact_mobile', 'mobile': 'contact_mobile',
    'address': 'contact_street', 'street': 'contact_street',
    'city': 'contact_city', 'state': 'contact_state', 'zip': 'contact_zip',
    'zip code': 'contact_zip', 'postal': 'contact_zip',
    'party': 'contact_party', 'party affiliation': 'contact_party', 'political party': 'contact_party',
    'district': 'contact_district', 'precinct': 'contact_precinct',
    'voter id': 'contact_voter_id', 'voterid': 'contact_voter_id',
    'gender': 'contact_gender', 'sex': 'contact_gender',
    'note': 'contact_note', 'notes': 'contact_note', 'comment': 'contact_note', 'comments': 'contact_note',
    'description': 'contact_description',
    'title': 'contact_title', 'salutation': 'contact_salutation',
    'dob': 'contact_birthdate', 'birthdate': 'contact_birthdate', 'birth date': 'contact_birthdate',
  };

  const grid = document.getElementById('mapper-grid');
  grid.innerHTML = '';

  // Header row
  const h1 = document.createElement('div');
  h1.textContent = 'CSV Column'; h1.style.fontWeight = '600';
  const h2 = document.createElement('div');
  h2.textContent = 'Maps to Contact Field'; h2.style.fontWeight = '600';
  grid.appendChild(h1); grid.appendChild(h2);

  for (const hdr of headers) {
    const lbl = document.createElement('label');
    lbl.textContent = hdr;
    grid.appendChild(lbl);

    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">(skip)</option>' +
      CONTACT_FIELDS.filter(([k]) => k !== 'XID')
        .map(([k, v]) => `<option value="${k}">${v} (${k})</option>`).join('');

    const suggested = suggestions[hdr.toLowerCase().trim()];
    if (suggested) sel.value = suggested;
    columnMap[hdr] = sel;
    grid.appendChild(sel);
  }

  // CSV preview table
  const previewRows = rows.slice(0, 3);
  let tbl = `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
  for (const row of previewRows) {
    tbl += `<tr>${headers.map(h => `<td>${esc(String(row[h] ?? ''))}</td>`).join('')}</tr>`;
  }
  tbl += '</tbody></table>';
  document.getElementById('csv-preview-table').innerHTML = tbl;
  document.getElementById('csv-preview').style.display = 'block';
}

function cancelImport() {
  csvData = null;
  document.getElementById('csv-preview').style.display = 'none';
}

async function importCSV() {
  if (!csvData) return;
  const mode = document.querySelector('input[name=import-mode]:checked').value;
  const mapping = {};
  for (const [hdr, sel] of Object.entries(columnMap)) {
    if (sel.value) mapping[hdr] = sel.value;
  }
  if (!Object.keys(mapping).length) { alert('Map at least one column.'); return; }

  const btn = document.getElementById('import-btn');
  btn.disabled = true;
  const wrap = document.getElementById('import-progress-wrap');
  const fill = document.getElementById('import-progress-fill');
  wrap.style.display = 'block';

  if (mode === 'replace') db.run('DELETE FROM contact');

  const rows = csvData.rows;
  const CHUNK = 200;
  const fields = Object.values(mapping).filter((v, i, a) => a.indexOf(v) === i); // unique
  const csvHdrs = Object.keys(mapping);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    if (mode === 'notes') {
      // Only update note field — requires matching on email or name
      for (const row of chunk) {
        const note = row[csvHdrs.find(h => mapping[h] === 'contact_note')] ?? '';
        const email = row[csvHdrs.find(h => mapping[h] === 'contact_email')] ?? '';
        if (email) {
          db.run(`UPDATE contact SET contact_note = contact_note || ? WHERE contact_email=?`,
            ['\n' + note, email]);
        }
      }
    } else {
      for (const row of chunk) {
        const vals = fields.map(f => {
          const hdr = csvHdrs.find(h => mapping[h] === f);
          return hdr ? (row[hdr] ?? null) : null;
        });
        const placeholders = fields.map(() => '?').join(',');
        db.run(
          `INSERT INTO contact (${fields.join(',')}) VALUES (${placeholders})`,
          vals
        );
      }
    }

    fill.style.width = `${Math.round(((i + chunk.length) / rows.length) * 100)}%`;
    await new Promise(r => setTimeout(r, 0)); // yield to browser
  }

  scheduleSave();
  updateContactCount();
  btn.disabled = false;
  wrap.style.display = 'none';
  fill.style.width = '0%';
  document.getElementById('csv-preview').style.display = 'none';
  csvData = null;
  setStatus(`Imported ${rows.length} rows`);
}

// ============================================================
// Section 2: Select Contacts
// ============================================================
let queryResults = [];

function runQuery() {
  const sql = document.getElementById('sql-query').value.trim();
  if (!sql) return;
  try {
    const result = db.exec(sql);
    if (!result.length) {
      document.getElementById('query-results').style.display = 'none';
      document.getElementById('query-count').textContent = '0 rows';
      document.getElementById('use-contacts-btn').style.display = 'none';
      queryResults = [];
      return;
    }
    const { columns, values } = result[0];
    queryResults = values;
    lastQuerySQL = sql;

    let tbl = `<table><thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
    const shown = values.slice(0, 1000);
    for (const row of shown) {
      tbl += `<tr>${row.map(v => `<td>${esc(String(v ?? ''))}</td>`).join('')}</tr>`;
    }
    tbl += '</tbody></table>';

    const wrap = document.getElementById('query-results');
    wrap.innerHTML = tbl;
    wrap.style.display = 'block';
    const total = values.length;
    document.getElementById('query-count').textContent =
      `${total.toLocaleString()} row${total !== 1 ? 's' : ''}${total > 1000 ? ' (showing first 1000)' : ''}`;
    document.getElementById('use-contacts-btn').style.display = 'inline-flex';
  } catch (e) {
    document.getElementById('query-count').innerHTML = `<span class="err">${esc(e.message)}</span>`;
    document.getElementById('query-results').style.display = 'none';
    document.getElementById('use-contacts-btn').style.display = 'none';
  }
}

function useContacts() {
  // Try to find XID column
  try {
    const xidResult = db.exec(
      `SELECT XID FROM (${lastQuerySQL}) WHERE contact_is_deleted=0 OR 1=1`
    );
    if (xidResult.length) {
      selectedContactIds = xidResult[0].values.map(r => r[0]);
    }
  } catch (_) {
    selectedContactIds = queryResults.map(r => r[0]);
  }
  document.getElementById('selected-count-badge').textContent = `${selectedContactIds.length.toLocaleString()} selected`;
  document.getElementById('campaign-summary').textContent =
    `${selectedContactIds.length.toLocaleString()} contacts selected. Configure sections 3–4, then generate the AI job package below.`;
  setStatus(`${selectedContactIds.length} contacts selected for campaign`);
}

// ============================================================
// Section 5: Prompt AI
// ============================================================
function getDimension() { return document.querySelector('input[name=dimension]:checked')?.value || 'What'; }
function getCampaignGoal() { return document.getElementById('campaign-goal').value.trim(); }
function getExtraNotes() { return document.getElementById('extra-notes').value.trim(); }
function getMsgMode() { return document.querySelector('input[name=msg-mode]:checked')?.value || 'single'; }
function getMaxMsgs() { return parseInt(document.getElementById('max-msgs').value, 10) || 5; }
function getContactAll() { return document.getElementById('contact-all').checked; }

function buildInstructionsMd() {
  const dim = getDimension();
  const goal = getCampaignGoal();
  const notes = getExtraNotes();
  const msgMode = getMsgMode();
  const maxMsgs = getMaxMsgs();
  const contactAll = getContactAll();
  const n = selectedContactIds.length;

  const msgModeText = msgMode === 'single'
    ? 'Write a SINGLE message that will be sent to all suitable recipients.'
    : msgMode === 'max'
      ? `Write UP TO ${maxMsgs} distinct message variants. Assign each recipient to the most appropriate variant.`
      : 'Write a UNIQUE, individually personalized message for EACH recipient.';

  const coverageText = contactAll
    ? 'Contact ALL eligible recipients, even if the message is a poor fit. Do not exclude anyone.'
    : 'Only include recipients for whom this message is a reasonably good fit. You may exclude recipients where the message would be clearly irrelevant or counterproductive. Explain any exclusions.';

  return `# Campaign Job Instructions

## Campaign Goal
${goal}

## Known Dimension: ${dim}
You know the "${dim}" — use this to fill in the missing dimensions.

## Audience
- **Contacts in database**: ${n.toLocaleString()}
- **SQL filter used**: \`${lastQuerySQL || 'SELECT * FROM contact'}\`
${notes ? `- **Additional notes**: ${notes}` : ''}

## Message Options
- **Mode**: ${msgModeText}
- **Coverage**: ${coverageText}

## Your Task
You are an AI assistant helping plan a voter outreach campaign.
You have access to a SQLite database file called \`contacts.db\` in this directory.
The database schema is described in \`schema.md\`.

Steps to follow:
1. Read \`schema.md\` to understand the database structure.
2. Query \`contacts.db\` using \`sqlite3\` command-line tool (or any SQLite tool available) to understand the audience.
3. Analyze each contact's information — especially \`contact_party\`, \`contact_district\`, \`contact_note\`, and demographic fields.
4. Determine which contacts should receive a message and what that message should say.
5. Write your output to the two files described below.

## Output Requirements
Write TWO files in this directory:

### output.md
A markdown file with:
1. A brief **Campaign Summary** (2-3 sentences about your approach).
2. A **Message Variants** section listing each message variant with its full text.
3. A **Recipient Table** with columns:

| contact_id | name | channel | variant | message_preview | rationale | suggested_send_time |

- \`channel\`: email or sms
- \`variant\`: variant name/number (or "unique" if individualized)
- \`message_preview\`: first 80 chars of the message
- \`rationale\`: one sentence why this contact was included
- \`suggested_send_time\`: suggested time window (e.g. "Weekday afternoon 3-5pm")

4. An **Exclusions** section listing any contacts not included and why (if coverage mode allows exclusions).

### output.json
A JSON file with this structure:
\`\`\`json
{
  "campaign_summary": "...",
  "message_variants": [
    { "id": "v1", "channel": "email|sms", "subject": "...", "body": "..." }
  ],
  "recipients": [
    {
      "contact_id": 123,
      "name": "Jane Doe",
      "channel": "email",
      "variant_id": "v1",
      "full_message": "...",
      "rationale": "...",
      "suggested_send_time": "..."
    }
  ],
  "exclusions": [
    { "contact_id": 456, "name": "...", "reason": "..." }
  ]
}
\`\`\`

## Important Notes
- All messages must be respectful and appropriate for voter outreach.
- Do not fabricate demographic information not present in the database.
- Keep SMS messages under 160 characters where possible.
- If a contact has opted out of email (\`contact_email_opt_out = 1\`), use SMS instead.
`;
}

function buildRunBat(claudePrompt) {
  return `@echo off
REM ============================================================
REM  AI Campaign Runner — Windows
REM  Run this file from its directory.
REM  Uncomment ONE command below.
REM ============================================================

REM Option 1: Claude Code (claude.exe must be in PATH)
claude --dangerously-skip-permissions -p "${claudePrompt.replace(/"/g, '\\"')}" > job.log 2>&1

REM Option 2: OpenAI Codex (codex must be in PATH)
REM codex --full-auto "${claudePrompt.replace(/"/g, '\\"')}" > job.log 2>&1

echo Done. Exit code: %ERRORLEVEL%
`;
}

function buildRunSh(claudePrompt) {
  return `#!/usr/bin/env bash
# ============================================================
#  AI Campaign Runner — Unix/WSL/macOS
#  Run: bash run.sh
#  Uncomment ONE command below.
# ============================================================

# Option 1: Claude Code
claude --dangerously-skip-permissions -p "${claudePrompt.replace(/"/g, '\\"')}" > job.log 2>&1

# Option 2: OpenAI Codex
# codex --full-auto "${claudePrompt.replace(/"/g, '\\"')}" > job.log 2>&1

echo "Done. Exit code: $?"
`;
}

const AI_PROMPT = 'Read instructions.md and schema.md carefully, then use sqlite3 to query contacts.db, then write output.md and output.json as specified in instructions.md.';

function previewInstructions() {
  document.getElementById('preview-title').textContent = 'instructions.md';
  document.getElementById('preview-content').textContent = buildInstructionsMd();
  document.getElementById('preview-modal').classList.add('open');
}

function closePreview() {
  document.getElementById('preview-modal').classList.remove('open');
}

async function buildContactsDB() {
  // Export selected contacts into a new in-memory DB and return as Uint8Array
  const exportDB = new SQL.Database();
  exportDB.run(CREATE_SCHEMA);

  if (!selectedContactIds.length) {
    // Export all
    const all = db.exec('SELECT * FROM contact WHERE contact_is_deleted=0');
    if (all.length) {
      const { columns, values } = all[0];
      const ph = columns.map(() => '?').join(',');
      for (const row of values) {
        exportDB.run(`INSERT INTO contact (${columns.join(',')}) VALUES (${ph})`, row);
      }
    }
  } else {
    const ids = selectedContactIds.join(',');
    const all = db.exec(`SELECT * FROM contact WHERE XID IN (${ids})`);
    if (all.length) {
      const { columns, values } = all[0];
      const ph = columns.map(() => '?').join(',');
      for (const row of values) {
        exportDB.run(`INSERT INTO contact (${columns.join(',')}) VALUES (${ph})`, row);
      }
    }
  }

  const bytes = exportDB.export();
  exportDB.close();
  return bytes;
}

async function downloadPackage() {
  setStatus('Building ZIP package…');
  const zip = new JSZip();
  zip.file('instructions.md', buildInstructionsMd());
  zip.file('schema.md', SCHEMA_DOC);
  zip.file('run.bat', buildRunBat(AI_PROMPT));
  zip.file('run.sh', buildRunSh(AI_PROMPT));
  const dbBytes = await buildContactsDB();
  zip.file('contacts.db', dbBytes);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'campaign-job.zip';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Package downloaded');
}

async function uploadAndCreateJob() {
  const btn = document.getElementById('upload-btn');
  const statusEl = document.getElementById('upload-status');
  btn.disabled = true;
  statusEl.textContent = 'Creating job…';

  try {
    // 1. Create job
    const jobRes = await fetch(`${API}/api/jobs`, { method: 'POST' });
    if (!jobRes.ok) throw new Error(await jobRes.text());
    const { id, job_dir } = await jobRes.json();
    currentJobId = id;

    const files = [
      { name: 'instructions.md', content: new Blob([buildInstructionsMd()], { type: 'text/plain' }) },
      { name: 'schema.md', content: new Blob([SCHEMA_DOC], { type: 'text/plain' }) },
      { name: 'run.bat', content: new Blob([buildRunBat(AI_PROMPT)], { type: 'text/plain' }) },
      { name: 'run.sh', content: new Blob([buildRunSh(AI_PROMPT)], { type: 'text/plain' }) },
    ];

    // 2. Upload text files
    for (const f of files) {
      statusEl.textContent = `Uploading ${f.name}…`;
      const fd = new FormData();
      fd.append('file', f.content, f.name);
      const r = await fetch(`${API}/api/jobs/${id}/files`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`Upload ${f.name}: ${await r.text()}`);
    }

    // 3. Upload contacts.db
    statusEl.textContent = 'Building & uploading contacts.db…';
    const dbBytes = await buildContactsDB();
    const fd = new FormData();
    fd.append('file', new Blob([dbBytes], { type: 'application/octet-stream' }), 'contacts.db');
    const dbRes = await fetch(`${API}/api/jobs/${id}/files`, { method: 'POST', body: fd });
    if (!dbRes.ok) throw new Error(`Upload contacts.db: ${await dbRes.text()}`);

    statusEl.textContent = `Job #${id} (${job_dir}) created. Starting…`;

    // 4. Start job
    const startRes = await fetch(`${API}/api/jobs/${id}/start`, { method: 'POST' });
    if (!startRes.ok) throw new Error(await startRes.text());

    statusEl.textContent = `Job #${id} is running. See Job Monitor below.`;
    loadJobs();
  } catch (e) {
    statusEl.innerHTML = `<span class="err">Error: ${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// Section 6: Job Monitor
// ============================================================
async function loadJobs() {
  try {
    const res = await fetch(`${API}/api/jobs`);
    if (!res.ok) {
      document.getElementById('jobs-table').innerHTML = `<p class="err">Server not reachable. Start it with: node server/server.js</p>`;
      document.getElementById('jobs-badge').textContent = 'offline';
      return;
    }
    const jobs = await res.json();
    document.getElementById('jobs-badge').textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;
    renderJobs(jobs);
  } catch (e) {
    document.getElementById('jobs-table').innerHTML = `<p class="err">Server not reachable. Start it with: node server/server.js</p>`;
    document.getElementById('jobs-badge').textContent = 'offline';
  }
}

function renderJobs(jobs) {
  if (!jobs.length) {
    document.getElementById('jobs-table').innerHTML = '<p class="info">No jobs yet.</p>';
    return;
  }
  let html = `<div class="tbl-wrap"><table>
    <thead><tr>
      <th>ID</th><th>Directory</th><th>Status</th><th>Created</th><th>Started</th><th>Finished</th><th>Actions</th>
    </tr></thead><tbody>`;
  for (const j of jobs) {
    const sc = `s-${j.status}`;
    html += `<tr>
      <td>${j.id}</td>
      <td style="font-family:monospace;font-size:.78rem">${esc(j.job_dir)}</td>
      <td><span class="badge-status ${sc}">${j.status}</span></td>
      <td>${fmtTime(j.created_at)}</td>
      <td>${fmtTime(j.started_at)}</td>
      <td>${fmtTime(j.finished_at)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        ${j.status === 'pending' ? `<button class="btn btn-success btn-sm" onclick="startJob(${j.id})">Start</button>` : ''}
        ${j.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="killJob(${j.id})">Kill</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="showJobFiles(${j.id})">Files</button>
      </td>
    </tr>
    <tr id="files-row-${j.id}" style="display:none">
      <td colspan="7" style="padding:8px 16px;background:#f8f8f8">
        <div id="files-content-${j.id}"></div>
      </td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  document.getElementById('jobs-table').innerHTML = html;
}

async function startJob(id) {
  await fetch(`${API}/api/jobs/${id}/start`, { method: 'POST' });
  loadJobs();
}

async function killJob(id) {
  if (!confirm('Kill this job?')) return;
  await fetch(`${API}/api/jobs/${id}`, { method: 'DELETE' });
  loadJobs();
}

async function showJobFiles(id) {
  const row = document.getElementById(`files-row-${id}`);
  const content = document.getElementById(`files-content-${id}`);
  if (row.style.display !== 'none') { row.style.display = 'none'; return; }

  row.style.display = 'table-row';
  content.innerHTML = 'Loading…';

  try {
    const res = await fetch(`${API}/api/jobs/${id}/files`);
    const files = await res.json();
    if (!files || !files.length) { content.innerHTML = '<em>No files yet.</em>'; return; }

    let html = '<div class="file-list">';
    for (const f of files) {
      const url = `${API}/api/jobs/${id}/files/${encodeURIComponent(f.name)}`;
      html += `<div class="file-item">
        <a href="${url}" target="_blank" download="${esc(f.name)}">${esc(f.name)}</a>
        <span class="info">${fmtBytes(f.size)}</span>
        ${f.name === 'output.md' ? `<button class="btn btn-secondary btn-sm" onclick="viewOutput(${id},'output.md')">View</button>` : ''}
        ${f.name === 'job.log' ? `<button class="btn btn-secondary btn-sm" onclick="viewOutput(${id},'job.log')">View</button>` : ''}
      </div>`;
    }
    html += '</div>';
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

async function viewOutput(jobId, filename) {
  try {
    const res = await fetch(`${API}/api/jobs/${jobId}/files/${encodeURIComponent(filename)}`);
    const text = await res.text();
    document.getElementById('preview-title').textContent = filename;
    document.getElementById('preview-content').textContent = text;
    document.getElementById('preview-modal').classList.add('open');
  } catch (e) {
    alert('Could not load file: ' + e.message);
  }
}

// ============================================================
// Polling
// ============================================================
function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.getElementById('auto-poll').checked) loadJobs();
  }, 3000);
}

// ============================================================
// Utilities
// ============================================================
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch { return iso; }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(1)} MB`;
}

// ============================================================
// Boot
// ============================================================
initApp().catch(e => {
  document.getElementById('status-bar').textContent = 'Init error: ' + e.message;
  console.error(e);
});
