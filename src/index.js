const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'items.json');

function readDbPassword() {
  const file = process.env.DB_PASSWORD_FILE;
  if (file) {
    // Throws (and stops startup) if the file is missing or unreadable
    return fs.readFileSync(file, 'utf8').trim();
  }
  return process.env.DB_PASSWORD;
}

const dbPassword = readDbPassword();
if (!dbPassword) {
  console.error('No database password: set DB_PASSWORD_FILE or DB_PASSWORD');
  process.exit(1);
}

const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: dbPassword,
  database: process.env.DB_NAME || 'postgres',
  connectionTimeoutMillis: 3000,
});

// Without this handler, an idle connection dropped by the server (e.g. the
// db container restarting) would crash the app.
db.on('error', (err) => console.error('Postgres pool error:', err.message));

const app = express();
app.use(express.json());

// Simple request logger - visible via `docker logs`
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// Items live in memory and are persisted to DATA_FILE. Mount a volume at
// DATA_DIR to keep them across container restarts and re-creations.
const items = new Map();
let nextId = 1;

function loadItems() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    console.log(`No data file at ${DATA_FILE}, starting empty`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const item of data.items) items.set(item.id, item);
  nextId = data.nextId;
  console.log(`Loaded ${items.size} item(s) from ${DATA_FILE}`);
}

// Write to a temp file and rename it, so a crash mid-write can't leave a
// half-written items.json behind.
function saveItems(itemList, nextIdValue) {
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify({ nextId: nextIdValue, items: itemList }, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

try {
  loadItems();
} catch (err) {
  console.error(`Cannot use data directory ${DATA_DIR}: ${err.message}`);
  process.exit(1);
}

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Docker study app!',
    endpoints: [
      'GET    /health',
      'GET    /info',
      'GET    /items',
      'GET    /items/:id',
      'POST   /items      { "name": "...", "description": "..." }',
      'DELETE /items/:id',
      'GET    /echo?msg=hello',
      'GET    /db-check',
    ],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/info', (req, res) => {
  res.json({
    hostname: os.hostname(), // equals the container ID inside Docker
    appName: process.env.APP_NAME || 'docker-study-app',
    appEnv: process.env.APP_ENV || 'local',
    appVersion: process.env.APP_VERSION || 'n/a',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptime: process.uptime(),
  });
});

app.get('/items', (req, res) => {
  res.json([...items.values()]);
});

app.get('/items/:id', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

app.post('/items', (req, res) => {
  const { name, description = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: '"name" is required' });

  const item = { id: nextId, name, description, createdAt: new Date().toISOString() };
  // Save first, then update memory, so a failed write leaves both unchanged
  saveItems([...items.values(), item], nextId + 1);
  items.set(item.id, item);
  nextId++;
  res.status(201).json(item);
});

app.delete('/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!items.has(id)) return res.status(404).json({ error: 'Items not found' });

  saveItems([...items.values()].filter((item) => item.id !== id), nextId);
  items.delete(id);
  res.status(204).end();
});

app.get('/echo', (req, res) => {
  res.json({ query: req.query, headers: req.headers });
});

app.get('/db-check', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'OK' });
  } catch (err) {
    // A refused connection can arrive with an empty message, so fall back to the code
    const error = err.message || err.code || String(err);
    console.error('DB check failed:', error);
    res.status(503).json({ status: 'error', error });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown - `docker stop` sends SIGTERM
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    console.log('Server closed');
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
