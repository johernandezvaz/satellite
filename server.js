'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn, exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const treeKill = require('tree-kill');
const session = require('express-session');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 4570;


const ERROR_PATTERNS = [
  /error:/i,
  /ECONNREFUSED/,
  /TypeError/,
  /SyntaxError/,
  /ReferenceError/,
  /UnhandledPromise/,
  /ENOENT/,
  /ETIMEDOUT/,
  /EADDRINUSE/,
  /failed to compile/i,
  /Build error/i,
  /Module not found/i,
  /Cannot find module/i,
  /Unhandled rejection/i,
  /Application error/i,
];

const IGNORE_PATTERNS = [
  /^\s*$/,
  /Compiling/,
  /[\u2713\u25b6\u25cf]/,
  /^\s+at\s/,
  /^\s*\(http/,
];


let apps = [];
const procState = {};
const childProcs = {};
const polls = {};

const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development'];

const DB_VARS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_NON_POOLING',
  'MYSQL_URL',
  'MONGODB_URI',
  'MONGO_URI',
];

function parseEnvFile(filePath) {
  const vars = {};
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();

      if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
  } catch { /* file not accessible */ }
  return vars;
}


function parseConnectionString(url) {
  if (!url) return null;

  if (/^file:|\.db$|\.sqlite$/i.test(url)) {
    const fileName = path.basename(url.replace(/^file:/, ''));
    return { type: 'SQLite', name: fileName };
  }

  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '').toLowerCase();
    const dbName = parsed.pathname.replace(/^\//, '').split('?')[0] || 'Unknown';

    let type = 'Unknown';
    if (/postgres|postgresql/.test(protocol)) type = 'PostgreSQL';
    else if (/mysql/.test(protocol)) type = 'MySQL';
    else if (/mongodb/.test(protocol)) type = 'MongoDB';
    else if (/sqlite/.test(protocol)) type = 'SQLite';
    else if (/mssql|sqlserver/.test(protocol)) type = 'SQL Server';

    return { type, name: dbName };
  } catch {
    return null;
  }
}


function detectDatabase(appPath) {
  const envVars = {};

  for (const file of ENV_FILES) {
    const full = path.join(appPath, file);
    Object.assign(envVars, parseEnvFile(full));
  }

  for (const varName of DB_VARS) {
    const val = envVars[varName];
    if (val) {
      const result = parseConnectionString(val);
      if (result) return result;
    }
  }

  return { type: 'Unknown', name: 'No detectada' };
}


async function loadApps() {
  apps = await db.getApps();
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}


function getState(id) {
  return procState[id] || { status: 'stopped', pid: null, startTime: null, errorCount: 0, errors: [] };
}

function setState(id, patch) {
  procState[id] = { ...getState(id), ...patch };
}

function isErrorLine(line) {
  if (IGNORE_PATTERNS.some(p => p.test(line))) return false;
  return ERROR_PATTERNS.some(p => p.test(line));
}

function pushError(id, line) {
  const st = getState(id);
  const error = { ts: new Date().toISOString(), line: line.trim() };
  const errors = [...(st.errors || []), error].slice(-100);
  setState(id, { errorCount: (st.errorCount || 0) + 1, errors });
  broadcast({ type: 'error', id, error });
}

function clearPoll(key) {
  if (polls[key]) { clearInterval(polls[key]); delete polls[key]; }
}

function startHealthPoll(id, port) {
  clearPoll(id);
  let attempts = 0;
  const MAX = 80;

  polls[id] = setInterval(() => {
    attempts++;
    const st = getState(id);
    if (st.status === 'stopped' || st.status === 'error') { clearPoll(id); return; }
    if (attempts > MAX) { clearPoll(id); return; }

    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      const current = getState(id);
      if (current.status === 'starting') {
        setState(id, { status: 'running' });
        broadcast({ type: 'status', id, status: 'running' });
        clearPoll(id);
        startPeriodicCheck(id, port);
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('timeout', () => socket.destroy());
    try { socket.connect(port, '127.0.0.1'); } catch { }
  }, 5000);
}

function startPeriodicCheck(id, port) {
  clearPoll(`${id}_check`);
  polls[`${id}_check`] = setInterval(() => {
    const st = getState(id);
    if (st.status !== 'running') { clearPoll(`${id}_check`); return; }
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.on('connect', () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('timeout', () => socket.destroy());
    try { socket.connect(port, '127.0.0.1'); } catch { }
  }, 15000);
}


function startApp(id) {
  const appData = apps.find(a => a.id === id);
  if (!appData) return { success: false, message: 'App no encontrada' };

  const st = getState(id);
  if (st.status === 'running' || st.status === 'starting') {
    return { success: false, message: 'La app ya está corriendo' };
  }

  const cmd = appData.packageManager === 'pnpm' ? 'pnpm' : 'npm';

  setState(id, { status: 'starting', startTime: Date.now(), errorCount: 0, errors: [] });
  broadcast({ type: 'status', id, status: 'starting' });

  let proc;
  try {
    proc = spawn(cmd, ['run', 'serve'], {
      cwd: appData.path,
      shell: true,
      windowsHide: true,
    });
  } catch (err) {
    setState(id, { status: 'error', pid: null });
    broadcast({ type: 'status', id, status: 'error' });
    pushError(id, err.message);
    return { success: false, message: err.message };
  }

  childProcs[id] = proc;
  setState(id, { pid: proc.pid });

  const handleOutput = (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (!line.trim()) return;
      if (/Ready in|ready - started|started server on/i.test(line)) {
        const current = getState(id);
        if (current.status === 'starting') {
          setState(id, { status: 'running' });
          broadcast({ type: 'status', id, status: 'running' });
          clearPoll(id);
          startPeriodicCheck(id, appData.port);
        }
      }
      if (isErrorLine(line)) pushError(id, line);
    });
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('close', (code) => {
    const current = getState(id);
    if (current.status !== 'stopped') {
      const newStatus = (code === 0 || code === null) ? 'stopped' : 'error';
      setState(id, { status: newStatus, pid: null });
      broadcast({ type: 'status', id, status: newStatus });
      if (newStatus === 'error') {
        pushError(id, `Proceso terminó inesperadamente (código ${code})`);
      }
    }
    delete childProcs[id];
    clearPoll(id);
    clearPoll(`${id}_check`);
  });

  proc.on('error', (err) => {
    setState(id, { status: 'error', pid: null });
    broadcast({ type: 'status', id, status: 'error' });
    pushError(id, err.message);
    delete childProcs[id];
    clearPoll(id);
    clearPoll(`${id}_check`);
  });

  startHealthPoll(id, appData.port);
  return { success: true };
}

function stopApp(id) {
  clearPoll(id);
  clearPoll(`${id}_check`);

  const proc = childProcs[id];
  if (proc && proc.pid) {
    treeKill(proc.pid, 'SIGTERM', (err) => {
      if (err) {
        try { treeKill(proc.pid, 'SIGKILL'); } catch { }
      }
    });
    delete childProcs[id];
  }

  setState(id, { status: 'stopped', pid: null });
  broadcast({ type: 'status', id, status: 'stopped' });
  return { success: true };
}

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'satellite-secret-fallback',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ success: false, message: 'No autenticado' });
}


app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Credenciales requeridas' });
  }
  const user = await db.getUserByEmail(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
  }
  const valid = await db.verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
  }
  req.session.userId = user.id;
  req.session.userEmail = user.email;
  res.json({ success: true, email: user.email });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, email: req.session.userEmail });
  }
  res.json({ authenticated: false });
});


app.get('/api/apps', requireAuth, (req, res) => {
  res.json(apps.map(a => ({ ...a, state: getState(a.id) })));
});

app.post('/api/apps', requireAuth, async (req, res) => {
  const { name, path: appPath, port, packageManager } = req.body;
  if (!name || !appPath || !port || !packageManager) {
    return res.status(400).json({ success: false, message: 'Faltan campos requeridos' });
  }
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const portNum = parseInt(port);

  if (await db.idExists(id)) {
    return res.status(400).json({ success: false, message: 'Ya existe una app con ese nombre' });
  }
  if (await db.portExists(portNum)) {
    return res.status(400).json({ success: false, message: `El puerto ${portNum} ya está en uso` });
  }


  const database = detectDatabase(appPath);

  const newApp = { id, name, path: appPath, port: portNum, packageManager, database };
  await db.upsertApp(newApp);
  apps.push(newApp);
  broadcast({ type: 'apps', apps: apps.map(a => ({ ...a, state: getState(a.id) })) });
  res.json({ success: true, app: newApp });
});

app.put('/api/apps/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, path: appPath, port, packageManager } = req.body;
  const appData = apps.find(a => a.id === id);
  if (!appData) return res.status(404).json({ success: false, message: 'App no encontrada' });

  const st = getState(id);
  if (st.status !== 'stopped') {
    return res.status(400).json({ success: false, message: 'Detén la app antes de editar sus datos' });
  }

  const portNum = port ? parseInt(port) : appData.port;
  if (portNum !== appData.port && await db.portExists(portNum, id)) {
    return res.status(400).json({ success: false, message: `El puerto ${portNum} ya está en uso` });
  }

  const updatedName = name?.trim() || appData.name;
  const updatedPath = appPath?.trim() || appData.path;
  const updatedPm = packageManager || appData.packageManager;

  // Re-detect database if path changed
  const database = detectDatabase(updatedPath);

  await db.updateAppDetails(id, {
    name: updatedName,
    path: updatedPath,
    port: portNum,
    packageManager: updatedPm
  });
  await db.updateAppDB(id, database.type, database.name);

  appData.name = updatedName;
  appData.path = updatedPath;
  appData.port = portNum;
  appData.packageManager = updatedPm;
  appData.database = database;

  broadcast({ type: 'apps', apps: apps.map(a => ({ ...a, state: getState(a.id) })) });
  res.json({ success: true, app: appData });
});

app.delete('/api/apps/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const st = getState(id);
  if (st.status !== 'stopped') {
    return res.status(400).json({ success: false, message: 'Detén la app antes de eliminarla' });
  }
  await db.deleteApp(id);
  apps = apps.filter(a => a.id !== id);
  delete procState[id];
  broadcast({ type: 'apps', apps: apps.map(a => ({ ...a, state: getState(a.id) })) });
  res.json({ success: true });
});

app.post('/api/apps/:id/start', requireAuth, (req, res) => {
  const result = startApp(req.params.id);
  res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/apps/:id/stop', requireAuth, (req, res) => {
  const result = stopApp(req.params.id);
  res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/apps/:id/restart', requireAuth, async (req, res) => {
  const { id } = req.params;
  stopApp(id);
  await new Promise(r => setTimeout(r, 2500));
  const result = startApp(id);
  res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/apps/:id/update', requireAuth, (req, res) => {
  const { id } = req.params;
  const appData = apps.find(a => a.id === id);
  if (!appData) return res.status(404).json({ success: false, message: 'App no encontrada' });

  const st = getState(id);
  if (st.status !== 'stopped') {
    return res.status(403).json({
      success: false,
      message: 'La app debe estar detenida para actualizar',
    });
  }

  broadcast({ type: 'update', id, status: 'pulling' });

  exec('git pull origin main', { cwd: appData.path, timeout: 60000 }, async (error, stdout, stderr) => {
    if (error) {
      const output = stderr?.trim() || error.message;
      broadcast({ type: 'update', id, status: 'error', output });
      return res.json({ success: false, output });
    }
    const output = stdout?.trim() || 'Already up to date.';


    const database = detectDatabase(appData.path);
    appData.database = database;
    await db.updateAppDB(id, database.type, database.name);
    broadcast({ type: 'db_update', id, database });

    broadcast({ type: 'update', id, status: 'success', output });
    res.json({ success: true, output });
  });
});

app.post('/api/apps/:id/refresh-db', requireAuth, async (req, res) => {
  const { id } = req.params;
  const appData = apps.find(a => a.id === id);
  if (!appData) return res.status(404).json({ success: false, message: 'App no encontrada' });

  const database = detectDatabase(appData.path);
  appData.database = database;
  await db.updateAppDB(id, database.type, database.name);
  broadcast({ type: 'db_update', id, database });
  res.json({ success: true, database });
});

app.get('/api/apps/:id/errors', requireAuth, (req, res) => {
  res.json({ errors: getState(req.params.id).errors || [] });
});

// Login page route
app.get(['/login', '/login/'], (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Dashboard root
app.get('/', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA / other pages
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'Not found' });
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    apps: apps.map(a => ({ ...a, state: getState(a.id) })),
  }));
});


async function bootstrap() {
  try {
    console.log('\n  Satellite — iniciando...');
    console.log('  Conectando a PostgreSQL...');
    await db.initDB();
    console.log('  Base de datos lista.');

    await loadApps();
    console.log(`  ${apps.length} app(s) cargadas.`);


    for (const appData of apps) {
      const database = detectDatabase(appData.path);
      if (database.type !== appData.database?.type || database.name !== appData.database?.name) {
        appData.database = database;
        await db.updateAppDB(appData.id, database.type, database.name);
      }
    }

    server.listen(PORT, () => {
      console.log(`\n  Satellite corriendo en \x1b[36mhttp://localhost:${PORT}\x1b[0m\n`);
    });
  } catch (err) {
    console.error('\n  [ERROR] No se pudo iniciar Satellite:', err.message);
    console.error('  Verifica que PostgreSQL esté disponible y DATABASE_URL sea correcta.\n');
    process.exit(1);
  }
}

bootstrap();
