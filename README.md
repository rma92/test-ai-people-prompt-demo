# AI Outreach Campaign Builder

A local tech demo for AI-assisted CRM messaging. Runs entirely on your machine — no internet required.

## Requirements

- [Node.js](https://nodejs.org/) v22 or later (v26 recommended — uses built-in SQLite)

## Start

**Windows:**
```
start.cmd
```

**Mac / Linux / WSL:**
```
bash start.sh
```

Then open **http://localhost:8080** in your browser.

To use a different port:
```
node server/server.js 9090
```

## Usage

1. **Import Data** — drag a CSV of contacts and map the columns
2. **Select Contacts** — write a SQL query to filter who to include
3. **First Question** — choose What / Who / When and describe the campaign goal
4. **Additional Notes** — set message count options and coverage preference
5. **Prompt the AI** — upload the package to the server and start a job
6. **Job Monitor** — watch the job run, download results when done

## AI Job Scripts

Each job directory contains `run.bat` (Windows) and `run.sh` (Unix). By default `claude` is used. To switch to OpenAI Codex, comment out the `claude` line and uncomment the `codex` line in the script.

Both `claude` and `codex` must be in your PATH for the respective command to work.

## Data

- Browser contact database: stored in IndexedDB (persists across page reloads)
- Server job queue: `server/server.db` (created on first run)
- Job files: `jobs/jobYYYYMMDD-hhmmss/`
