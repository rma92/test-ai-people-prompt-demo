Plan: AI People Prompt Demo — Tech Demo Build

 Context

 Building a local-only tech demo for an AI-assisted CRM outreach campaign tool. The user has an existing
 SQL schema (setup_draft.sql) and a spec (instructions.md). Nothing has been built yet. The goal is a
 two-component app: a browser-side single-page app (using sql.js hosted locally) and a minimal Go HTTP
 server with a SQLite-backed job queue. The AI integration works by generating a job directory with
 instructions.md + a contacts SQLite export, then running Claude Code or OpenAI Codex in non-interactive
 mode against that directory.

 Constraints: No internet required at runtime, no authentication, local use only, simplicity is the
 priority.

 ---
 Directory Structure

 test-ai-people-prompt-demo/
 ├── instructions.md           (existing)
 ├── 20260530-AI-Message-Prompt.md  (existing)
 ├── setup_draft.sql           (existing)
 ├── .gitignore
 ├── htdocs/
 │   ├── index.html            (single-page app, all UI)
 │   ├── app.js                (all frontend logic)
 │   └── lib/
 │       ├── sql-wasm.js       (sql.js, downloaded from GitHub release)
 │       ├── sql-wasm.wasm     (sql.js WASM binary)
 │       └── papaparse.min.js  (CSV parser, downloaded)
 ├── server/
 │   ├── main.go               (entire Go server, single file)
 │   └── go.mod
 └── jobs/                     (runtime, gitignored — created by server)

 ---
 Phase 1: Project Setup

 1. Create .gitignore (ignore jobs/, server/server.db, *.db)
 2. Download sql.js v1.12.0 release files (sql-wasm.js, sql-wasm.wasm) into htdocs/lib/
 3. Download PapaParse (papaparse.min.js) into htdocs/lib/
 4. Create server/go.mod using modernc.org/sqlite (pure Go, no CGo/MinGW needed on Windows)

 ---
 Phase 2: Go Server (server/main.go)

 Single file. Uses only stdlib + modernc.org/sqlite.

 Job Queue SQLite Schema (server.db)

 CREATE TABLE IF NOT EXISTS jobs (
   id        INTEGER PRIMARY KEY AUTOINCREMENT,
   job_dir   TEXT NOT NULL UNIQUE,   -- "job20260530-120000"
   status    TEXT NOT NULL DEFAULT 'pending',  -- pending/running/completed/failed/killed
   created_at TEXT NOT NULL,
   started_at TEXT,
   finished_at TEXT,
   pid       INTEGER,
   exit_code INTEGER,
   error_msg TEXT
 );

 REST API Endpoints

 ┌────────┬─────────────────────────────┬────────────────────────────────────────────────────────┐
 │ Method │            Path             │                      Description                       │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ GET    │ /                           │ Redirect to /index.html                                │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ GET    │ /*                          │ Serve htdocs/ static files                             │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ GET    │ /api/jobs                   │ List all jobs                                          │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ POST   │ /api/jobs                   │ Create job (makes directory, returns id + job_dir)     │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ GET    │ /api/jobs/{id}              │ Job status + file list                                 │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ POST   │ /api/jobs/{id}/files        │ Upload file (multipart)                                │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ GET    │ /api/jobs/{id}/files        │ List files in job dir                                  │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ GET    │ /api/jobs/{id}/files/{name} │ Download a file                                        │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ POST   │ /api/jobs/{id}/start        │ Execute run.bat (Windows) or run.sh (Unix)             │
 ├────────┼─────────────────────────────┼────────────────────────────────────────────────────────┤
 │ DELETE │ /api/jobs/{id}              │ Kill process (taskkill /F /T on Windows, kill on Unix) │
 └────────┴─────────────────────────────┴────────────────────────────────────────────────────────┘

 Process Management

 - On start: exec.Command("cmd", "/c", "run.bat") on Windows, exec.Command("bash", "run.sh") on Unix
 - stdout+stderr redirected to job.log in job directory
 - Background goroutine cmd.Wait() → update status to completed/failed + store exit code
 - On kill (Windows): exec.Command("taskkill", "/F", "/T", "/PID", pid) — kills process tree
 - On kill (POSIX — Linux, macOS, OpenBSD): syscall.Kill(-pid, syscall.SIGKILL) — negative PID targets
 the whole process group
 - On POSIX, set cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} at launch so the AI subprocess
 gets its own process group (ensures clean kill of child processes it spawns)
 - Detect OS via runtime.GOOS

 Server startup

 - Listens on localhost:8080 (flag -port to override)
 - Creates jobs/ directory if missing
 - Opens/creates server.db

 ---
 Phase 3: Browser Schema (sql.js)

 The browser DB uses the tables from setup_draft.sql with additions for voter use case. Core table stored
 locally via IndexedDB (not localStorage — avoids 5MB limit for 10k+ contacts).

 Added columns to contact:

 contact_party    TEXT,   -- political party affiliation
 contact_district TEXT,   -- electoral district (e.g. NY-12)
 contact_precinct TEXT,   -- precinct
 contact_voter_id TEXT,   -- state voter registration ID
 contact_gender   TEXT    -- gender
 (All existing setup_draft.sql columns retained; contact_note kept as free-text catch-all for
 consumer/preference data)

 Persistence strategy

 - On every change: db.export() → Uint8Array → store in IndexedDB under key "crm_db"
 - On load: retrieve from IndexedDB → new SQL.Database(uint8array)
 - Debounce saves to avoid blocking on every insert during CSV import

 ---
 Phase 4: Frontend (htdocs/index.html + app.js)

 Single scrollable page with numbered sections. Minimal styling (clean, functional).

 Section 0 — Tools

 - "Clear all databases" button (confirm dialog → wipe IndexedDB → reinit empty DB)
 - "Delete all data" button (confirm → localStorage.clear() + IndexedDB clear → reload)

 Section 1 — Import Data

 - Drag-and-drop zone (also click-to-browse) for CSV files
 - On drop: PapaParse reads file → show column headers + first 3 rows as preview
 - Column mapper: for each CSV column, a <select> of all contact table fields
   - Auto-suggest: fuzzy match CSV header names to field names (e.g. "Party" → contact_party, "First" →
 contact_first_name)
 - Options: "Replace existing" / "Append only" / "Append notes only" radio
 - "Import" button → batch INSERT with progress bar (chunked to avoid UI freeze)
 - Row count shown after import

 Section 2 — Select Contacts

 - Default SQL: SELECT XID, contact_first_name, contact_last_name, contact_email, contact_phone,
 contact_party, contact_district FROM contact
 - Editable <textarea> for arbitrary SQL
 - "Run Query" button
 - Results rendered in scrollable table (max-height: 400px with overflow-y:scroll)
 - Row count shown
 - "Use these N contacts for campaign" button → stores current result set IDs

 Section 3 — First Question

 - Radio: What? (default) / Who? / When?
 - <textarea> — default value: "School Choice"

 Section 4 — Additional Notes & Options

 - <textarea> for extra context / instructions to the AI
 - Message count:
   - ○ Single message for everyone
   - ○ Maximum ___ different messages (number input)
   - ○ Unique message per recipient
 - Coverage:
   - ☐ Contact all users including those that are a poor fit (if unchecked, AI can exclude)

 Section 5 — Prompt the AI (Generate Job)

 - "Preview instructions.md" button → shows generated text in a modal/expandable area
 - "Download Package" button → generates and downloads a ZIP containing:
   - instructions.md (generated)
   - contacts.db (SQLite export of filtered contacts)
   - schema.md (field descriptions including voter-specific columns)
   - run.bat (Windows batch, both claude and codex options, one uncommented)
   - run.sh (bash equivalent)
 - "Upload to Server & Create Job" button → POSTs each file to server, creates job, shows job ID

 Section 6 — Job Monitor

 - Auto-polls GET /api/jobs every 3 seconds when visible
 - Table of jobs: ID, directory, status, created, started, finished
 - Per-job actions:
   - "Start" (POST /api/jobs/{id}/start)
   - "Kill" (DELETE /api/jobs/{id})
   - "Files" → expandable list with download links
   - "View output.md" → fetches and renders inline as HTML (marked.js from CDN or simple pre block)
 - Status badges: pending (gray), running (blue/animated), completed (green), failed (red), killed
 (orange)

 ---
 Phase 5: Generated Job Files

 instructions.md (generated by frontend)

 # Campaign Job Instructions

 ## Campaign Goal
 [User's text from Section 3]

 ## Known Dimension: [What / Who / When]

 ## Audience
 - Contacts selected: [N]
 - SQL filter used: [query from Section 2]
 - Additional notes: [text from Section 4]

 ## Message Options
 - Mode: [Single / Max N / Unique per recipient]
 - Coverage: [Best-fit only / Contact all]

 ## Your Task
 You have access to a SQLite database `contacts.db` in this directory.
 The schema is described in `schema.md`.
 ...full task description with output requirements...

 ## Output Requirements
 Write TWO files in this directory:
 1. `output.md` — markdown table: | contact_id | name | channel | message | rationale |
 suggested_send_time |
 2. `output.json` — same data as JSON array with same fields

 schema.md

 Describes every contact field with plain-language meaning, especially the voter-specific additions.
 Helps the AI agent understand what contact_party, contact_district, contact_note contain.

 run.bat

 @echo off
 REM === AI Campaign Runner ===
 REM Uncomment ONE command to run. Both claude and codex must be in PATH.

 REM Option 1: Claude Code (non-interactive)
 claude --dangerously-skip-permissions -p "Read instructions.md and schema.md carefully, then query
 contacts.db with sqlite3 to understand the audience, then write output.md and output.json as specified
 in instructions.md." > job.log 2>&1

 REM Option 2: OpenAI Codex
 REM codex --full-auto "Read instructions.md and schema.md, query contacts.db, write output.md and
 output.json." > job.log 2>&1

 run.sh

 Same as run.bat but bash syntax and #!/bin/bash shebang.

 ---
 Phase 6: Verification

 1. cd server && go run main.go → server starts on :8080
 2. Browser opens http://localhost:8080
 3. Drag in a sample CSV of contacts → map columns → import
 4. Run SELECT * FROM contact → see rows in scrollable table
 5. Fill in campaign form → generate job package
 6. Upload package to server → job appears in monitor
 7. Click "Start" → job.log updates, status changes to running/completed
 8. Download output.md and output.json

 ---
 Key Technical Notes

 - Go SQLite driver: modernc.org/sqlite (CGo-free, works on Windows without MinGW)
 - No bundler: All JS is vanilla, loaded via <script> tags; sql.js initialized with locateFile pointing
 to lib/sql-wasm.wasm
 - IndexedDB key: "crm_db" stores the raw WASM bytes of the SQLite database
 - ZIP generation: Use JSZip (hosted locally in htdocs/lib/) to build the download package client-side
 - CORS headers: Not needed (same-origin, served by Go)
 - Port conflict: If 8080 is taken, -port flag on server binary
 - Windows process kill: exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run()
 - POSIX process kill: syscall.Kill(-pid, syscall.SIGKILL) with Setpgid: true on launch — works on Linux,
 macOS, OpenBSD
