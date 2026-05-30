#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// --- Config ---
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const SERVER_DIR = __dirname;
const JOBS_DIR = path.join(SERVER_DIR, '..', 'jobs');
const HTDOCS_DIR = path.join(SERVER_DIR, '..', 'htdocs');
const DB_PATH = path.join(SERVER_DIR, 'server.db');

// --- Init ---
fs.mkdirSync(JOBS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_dir     TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  pid         INTEGER,
  exit_code   INTEGER,
  error_msg   TEXT
)`);

const processes = new Map(); // id -> child process

// --- MIME types ---
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.md': 'text/markdown',
  '.db': 'application/octet-stream', '.txt': 'text/plain',
  '.sh': 'text/plain', '.bat': 'text/plain', '.log': 'text/plain',
};

// --- Helpers ---
function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function errRes(res, status, msg) {
  jsonRes(res, { error: msg }, status);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(n => !fs.statSync(path.join(dir, n)).isDirectory())
      .map(n => {
        const st = fs.statSync(path.join(dir, n));
        return { name: n, size: st.size, mod_time: st.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

function nowISO() { return new Date().toISOString(); }

function makeJobDir() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `job${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

// --- Multipart parser (no deps) ---
function parseMultipart(body, boundary) {
  const files = [];
  const sep = Buffer.from('--' + boundary);
  let pos = 0;
  while (pos < body.length) {
    const start = indexOfBuf(body, sep, pos);
    if (start === -1) break;
    pos = start + sep.length;
    if (body[pos] === 0x2d && body[pos+1] === 0x2d) break; // --
    pos += 2; // CRLF after boundary
    // find header/body split
    const hdrEnd = indexOfBuf(body, Buffer.from('\r\n\r\n'), pos);
    if (hdrEnd === -1) break;
    const headers = body.slice(pos, hdrEnd).toString();
    pos = hdrEnd + 4;
    const nextBound = indexOfBuf(body, sep, pos);
    const fileData = body.slice(pos, nextBound - 2); // strip trailing CRLF
    pos = nextBound;
    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]+)"/);
    if (nameMatch && fileMatch) {
      files.push({ fieldName: nameMatch[1], fileName: fileMatch[1], data: fileData });
    }
  }
  return files;
}

function indexOfBuf(haystack, needle, start = 0) {
  for (let i = start; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i+j] !== needle[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

// --- Job management ---
function startJob(id, jobPath) {
  const logPath = path.join(jobPath, 'job.log');
  const logFd = fs.openSync(logPath, 'a');

  const isWin = process.platform === 'win32';
  let child;
  if (isWin) {
    child = spawn('cmd.exe', ['/c', 'run.bat'], {
      cwd: jobPath, stdio: ['ignore', logFd, logFd],
      detached: false,
    });
  } else {
    child = spawn('bash', ['run.sh'], {
      cwd: jobPath, stdio: ['ignore', logFd, logFd],
      detached: true,
    });
  }

  const pid = child.pid;
  const now = nowISO();
  db.prepare(`UPDATE jobs SET status='running', started_at=?, pid=? WHERE id=?`).run(now, pid, id);
  processes.set(id, child);

  child.on('close', (code) => {
    fs.closeSync(logFd);
    processes.delete(id);
    const finish = nowISO();
    const status = code === 0 ? 'completed' : 'failed';
    db.prepare(`UPDATE jobs SET status=?, finished_at=?, exit_code=? WHERE id=?`)
      .run(status, finish, code ?? -1, id);
  });
}

function killJob(id) {
  const child = processes.get(id);
  if (child) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch (_) {}
    processes.delete(id);
  }
  db.prepare(`UPDATE jobs SET status='killed', finished_at=? WHERE id=?`).run(nowISO(), id);
}

function getJob(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id);
}

// --- Router ---
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost`);
  const p = url.pathname;

  // API routes
  if (p === '/api/jobs') {
    if (req.method === 'GET') {
      const rows = db.prepare(`SELECT * FROM jobs ORDER BY id DESC`).all();
      return jsonRes(res, rows);
    }
    if (req.method === 'POST') {
      const dirName = makeJobDir();
      const dirPath = path.join(JOBS_DIR, dirName);
      fs.mkdirSync(dirPath, { recursive: true });
      const result = db.prepare(`INSERT INTO jobs (job_dir, status, created_at) VALUES (?, 'pending', ?)`).run(dirName, nowISO());
      return jsonRes(res, { id: Number(result.lastInsertRowid), job_dir: dirName });
    }
    return errRes(res, 405, 'method not allowed');
  }

  const jobMatch = p.match(/^\/api\/jobs\/(\d+)(\/(.+))?$/);
  if (jobMatch) {
    const id = parseInt(jobMatch[1], 10);
    const sub = jobMatch[3] || '';
    const job = getJob(id);
    if (!job) return errRes(res, 404, 'job not found');
    const jobPath = path.join(JOBS_DIR, job.job_dir);

    // /api/jobs/{id}
    if (!sub) {
      if (req.method === 'GET') {
        return jsonRes(res, { job, files: listFiles(jobPath) });
      }
      if (req.method === 'DELETE') {
        killJob(id);
        return jsonRes(res, { status: 'killed' });
      }
      return errRes(res, 405, 'method not allowed');
    }

    // /api/jobs/{id}/start
    if (sub === 'start') {
      if (req.method !== 'POST') return errRes(res, 405, 'method not allowed');
      if (job.status !== 'pending') return errRes(res, 400, 'job is not pending');
      try { startJob(id, jobPath); } catch (e) { return errRes(res, 500, e.message); }
      return jsonRes(res, { status: 'running' });
    }

    // /api/jobs/{id}/files
    if (sub === 'files') {
      if (req.method === 'GET') return jsonRes(res, listFiles(jobPath));
      if (req.method === 'POST') {
        const ct = req.headers['content-type'] || '';
        const boundaryMatch = ct.match(/boundary=(.+)/);
        if (!boundaryMatch) return errRes(res, 400, 'no boundary');
        const body = await parseBody(req);
        const files = parseMultipart(body, boundaryMatch[1].trim());
        if (!files.length) return errRes(res, 400, 'no file found');
        const saved = [];
        for (const f of files) {
          const safeName = path.basename(f.fileName);
          fs.writeFileSync(path.join(jobPath, safeName), f.data);
          saved.push(safeName);
        }
        return jsonRes(res, { files: saved });
      }
      return errRes(res, 405, 'method not allowed');
    }

    // /api/jobs/{id}/files/{name}
    const fileMatch = sub.match(/^files\/(.+)$/);
    if (fileMatch) {
      if (req.method !== 'GET') return errRes(res, 405, 'method not allowed');
      const safeName = path.basename(fileMatch[1]);
      const filePath = path.join(jobPath, safeName);
      if (!fs.existsSync(filePath)) return errRes(res, 404, 'file not found');
      const ext = path.extname(safeName).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    return errRes(res, 404, 'unknown path');
  }

  // Static file serving
  let filePath = path.join(HTDOCS_DIR, p === '/' ? '/index.html' : p);
  // Prevent directory traversal
  if (!filePath.startsWith(HTDOCS_DIR)) {
    return errRes(res, 403, 'forbidden');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not Found');
    return;
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI CRM Server running at http://localhost:${PORT}`);
  console.log(`Jobs directory: ${JOBS_DIR}`);
  console.log(`Serving htdocs from: ${HTDOCS_DIR}`);
});
