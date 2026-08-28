'use strict';

let ws = null;
let appsMap = {};
let uptimeTimers = {};
let currentDrawerApp = null;


async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401 || !res.ok) {
      location.href = '/login';
      return false;
    }
    const data = await res.json();
    if (!data.authenticated) {
      location.href = '/login';
      return false;
    }

    const userInfo = document.getElementById('userInfo');
    const userEmail = document.getElementById('userEmail');
    const logoutBtn = document.getElementById('logoutBtn');
    if (userInfo) userInfo.style.display = 'flex';
    if (userEmail) userEmail.textContent = data.email;
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    return true;
  } catch {
    location.href = '/login';
    return false;
  }
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => { });
  location.href = '/login';
}


function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connectWS, 3500); };
  ws.onerror = () => ws.close();

  ws.onmessage = ({ data }) => {
    try { handleMsg(JSON.parse(data)); } catch { }
  };
}

function setConn(ok) {
  const badge = document.getElementById('connBadge');
  const label = document.getElementById('connLabel');
  badge.className = `conn-badge${ok ? '' : ' disconnected'}`;
  label.textContent = ok ? 'Conectado' : 'Reconectando...';
}


function handleMsg(msg) {
  switch (msg.type) {

    case 'init':
      appsMap = {};
      msg.apps.forEach(a => { appsMap[a.id] = a; });
      renderAll();
      break;

    case 'apps': {
      const newIds = new Set(msg.apps.map(a => a.id));
      Object.keys(appsMap).forEach(id => {
        if (!newIds.has(id)) { delete appsMap[id]; removeCard(id); }
      });
      msg.apps.forEach(a => { appsMap[a.id] = a; });
      renderAll();
      break;
    }

    case 'status':
      if (appsMap[msg.id]) {
        appsMap[msg.id].state = { ...appsMap[msg.id].state, status: msg.status };
        refreshCard(msg.id);
        updateStats();
      }
      break;

    case 'error':
      if (appsMap[msg.id]) {
        const st = appsMap[msg.id].state;
        st.errors = [...(st.errors || []), msg.error].slice(-100);
        st.errorCount = (st.errorCount || 0) + 1;
        refreshCard(msg.id);
        if (currentDrawerApp === msg.id) appendErrEntry(msg.error);
      }
      break;

    case 'update':
      handleUpdateMsg(msg);
      break;

    case 'db_update':
      if (appsMap[msg.id]) {
        appsMap[msg.id].database = msg.database;
        refreshCard(msg.id);
        toast(`Base de datos actualizada: ${appsMap[msg.id]?.name}`, 'info');
      }
      break;
  }
}


function renderAll() {
  const grid = document.getElementById('appsGrid');
  const empty = document.getElementById('emptyState');
  const apps = Object.values(appsMap);

  if (apps.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    updateStats();
    return;
  }
  empty.style.display = 'none';

  const existingIds = new Set(
    [...grid.querySelectorAll('.app-card')].map(el => el.dataset.id)
  );

  apps.forEach(app => {
    if (existingIds.has(app.id)) {
      refreshCard(app.id);
    } else {
      grid.appendChild(buildCard(app));
    }
    scheduleUptime(app.id);
  });

  updateStats();
}

function removeCard(id) {
  stopUptime(id);
  const el = document.querySelector(`.app-card[data-id="${id}"]`);
  if (el) el.remove();
}

function buildCard(app) {
  const div = document.createElement('div');
  div.className = `app-card s-${app.state?.status || 'stopped'}`;
  div.dataset.id = app.id;
  div.innerHTML = cardInnerHTML(app);
  return div;
}

function refreshCard(id) {
  const app = appsMap[id];
  const card = document.querySelector(`.app-card[data-id="${id}"]`);
  if (!app || !card) return;
  const status = app.state?.status || 'stopped';
  card.className = `app-card s-${status}`;
  card.innerHTML = cardInnerHTML(app);
  scheduleUptime(id);
}

const STATUS_LABELS = {
  running: 'Corriendo',
  stopped: 'Detenida',
  starting: 'Iniciando',
  error: 'Error',
};


function cardInnerHTML(app) {
  const st = app.state || { status: 'stopped', errorCount: 0, errors: [] };
  const status = st.status || 'stopped';
  const stopped = status === 'stopped';
  const running = status === 'running';
  const errs = st.errorCount || 0;
  const label = STATUS_LABELS[status] || status;

  const db = app.database || { type: 'Unknown', name: 'No detectada' };
  const dbType = esc(db.type || 'Unknown');
  const dbName = esc(db.name || 'No detectada');

  const portVal = app.port;

  const uptimeVal = running && st.startTime
    ? fmtUptime(st.startTime)
    : '—';

  const errBadge = errs > 0
    ? `<button class="err-pill" onclick="openDrawer('${app.id}')" title="Ver errores">
         <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
           <circle cx="5" cy="5" r="4.5"/>
           <path d="M5 3v2.5M5 7h.01"/>
         </svg>
         ${errs} error${errs !== 1 ? 'es' : ''}
       </button>`
    : '';

  const startDisabled = !stopped ? 'disabled' : '';
  const stopDisabled = stopped ? 'disabled' : '';
  const restartDisabled = stopped ? 'disabled' : '';
  const updateDisabled = !stopped ? 'disabled' : '';
  const updateTitle = !stopped ? 'Detén la app primero' : 'git pull origin main';

  const footerLeft = running
    ? `<a class="open-link" href="http://${location.hostname || 'localhost'}:${portVal}" target="_blank" rel="noopener">
         <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
           <path d="M4.5 1H1v9h9V7M7 1h3v3M10 1L5.5 5.5"/>
         </svg>
         Abrir (${portVal})
       </a>`
    : `<span></span>`;

  return `
    <div class="card-head">
      <div class="card-title-col">
        <div class="card-name" title="${esc(app.name)}">${esc(app.name)}</div>
        <div class="card-badges">
          <span class="badge badge-port">:${portVal}</span>
          <span class="badge badge-pm">${esc(app.packageManager)}</span>
        </div>
      </div>
      <div class="status-pill pill-${status}">
        <span class="s-dot dot-${status}"></span>
        ${label}
      </div>
    </div>

    <div class="card-body">
      <div class="card-meta" aria-label="Información de runtime">
        <div class="meta-col">
          <span class="meta-label">Puerto</span>
          <span class="meta-value">${portVal}</span>
        </div>

        <div class="meta-col meta-col-center">
          <span class="meta-label">Base de datos</span>
          <span class="meta-value">${dbType}</span>
          <span class="meta-sub" title="${dbName}">${dbName}</span>
        </div>

        <div class="meta-col">
          <span class="meta-label">Uptime</span>
          <span class="meta-value uptime-val" id="up-${app.id}">${uptimeVal}</span>
        </div>
      </div>

      ${errBadge ? `<div>${errBadge}</div>` : ''}

      <div class="card-actions">
        <button class="btn btn-start"   id="bs-${app.id}" ${startDisabled}   onclick="doStart('${app.id}')">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 4-7 4V1.5z"/></svg>
          Iniciar
        </button>
        <button class="btn btn-stop"    id="bx-${app.id}" ${stopDisabled}    onclick="doStop('${app.id}')">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><rect x="1" y="1" width="7" height="7" rx="1"/></svg>
          Detener
        </button>
        <button class="btn btn-restart" id="br-${app.id}" ${restartDisabled} onclick="doRestart('${app.id}')">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 2A5.5 5.5 0 102.5 7.5"/>
            <path d="M2.5 5V8H5.5"/>
          </svg>
          Reiniciar
        </button>
        <button class="btn btn-update"     id="bu-${app.id}" ${updateDisabled} onclick="doUpdate('${app.id}')" title="${updateTitle}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 1v8M3 6l3 3 3-3M1 11h10"/>
          </svg>
        </button>
        <button class="btn btn-db-refresh" id="bdb-${app.id}" onclick="doRefreshDB('${app.id}')" title="Re-detectar base de datos">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 6A5 5 0 0110.5 3.5M11 6a5 5 0 01-9.5 2.5"/>
            <path d="M9.5 1v3H11"/>
            <path d="M1 9l1.5-1.5"/>
          </svg>
        </button>
      </div>
      <div class="git-output" id="go-${app.id}"></div>
    </div>

    <div class="card-foot">
      ${footerLeft}
      <div class="card-foot-acts">
        <button class="edit-btn" onclick="openEditModal('${app.id}')">Editar</button>
        <button class="del-btn" onclick="doDelete('${app.id}')">Eliminar</button>
      </div>
    </div>
  `;
}

function scheduleUptime(id) {
  stopUptime(id);
  const app = appsMap[id];
  if (app?.state?.status !== 'running' || !app.state.startTime) return;

  uptimeTimers[id] = setInterval(() => {
    const el = document.getElementById(`up-${id}`);
    if (!el) { stopUptime(id); return; }
    const st = appsMap[id]?.state;
    if (st?.status === 'running' && st.startTime) {
      el.textContent = fmtUptime(st.startTime);
    } else {
      el.textContent = '—';
      stopUptime(id);
    }
  }, 1000);
}

function stopUptime(id) {
  if (uptimeTimers[id]) { clearInterval(uptimeTimers[id]); delete uptimeTimers[id]; }
}

function fmtUptime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function updateStats() {
  const list = Object.values(appsMap);
  document.getElementById('statTotal').textContent = list.length;
  document.getElementById('statRunning').textContent = list.filter(a => a.state?.status === 'running').length;
  document.getElementById('statStopped').textContent = list.filter(a => ['stopped', 'error'].includes(a.state?.status)).length;
  document.getElementById('statErrors').textContent = list.filter(a => (a.state?.errorCount || 0) > 0).length;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; return null; }
  return res.json();
}

async function doStart(id) {
  const r = await api('POST', `/api/apps/${id}/start`);
  if (!r) return;
  if (!r.success) toast(r.message || 'Error al iniciar', 'error');
  else toast(`Iniciando ${appsMap[id]?.name}...`, 'info');
}

async function doStop(id) {
  const r = await api('POST', `/api/apps/${id}/stop`);
  if (!r) return;
  if (!r.success) toast(r.message || 'Error al detener', 'error');
}

async function doRestart(id) {
  toast(`Reiniciando ${appsMap[id]?.name}...`, 'info');
  setBtn(`br-${id}`, '<span class="spinner"></span>', true);
  await api('POST', `/api/apps/${id}/restart`);
}

async function doUpdate(id) {
  const app = appsMap[id];
  if (!app) return;
  if (app.state?.status !== 'stopped') {
    toast('Detén la app antes de actualizar', 'warning');
    return;
  }

  const btn = document.getElementById(`bu-${id}`);
  const out = document.getElementById(`go-${id}`);

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  if (out) { out.style.display = 'none'; out.textContent = ''; }

  const r = await api('POST', `/api/apps/${id}/update`);
  if (!r) return;

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1v8M3 6l3 3 3-3M1 11h10"/></svg>`;
  }

  if (r.success) {
    toast(`${app.name} actualizada`, 'success');
    if (out) { out.textContent = r.output?.trim() || 'Already up to date.'; out.style.display = 'block'; }
  } else {
    const firstLine = r.output?.split('\n').find(l => l.trim()) || 'Error desconocido';
    toast(firstLine, 'error');
    if (out) { out.textContent = r.output?.trim() || 'Error'; out.style.display = 'block'; }
  }
}

async function doRefreshDB(id) {
  const btn = document.getElementById(`bdb-${id}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  const r = await api('POST', `/api/apps/${id}/refresh-db`);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6A5 5 0 0110.5 3.5M11 6a5 5 0 01-9.5 2.5"/><path d="M9.5 1v3H11"/><path d="M1 9l1.5-1.5"/></svg>`;
  }

  if (!r) return;
  if (r.success && appsMap[id]) {
    appsMap[id].database = r.database;
    refreshCard(id);
    toast(`DB detectada: ${r.database.type} · ${r.database.name}`, 'info');
  }
}

function handleUpdateMsg(msg) {
  const btn = document.getElementById(`bu-${msg.id}`);
  const out = document.getElementById(`go-${msg.id}`);
  const svgDown = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1v8M3 6l3 3 3-3M1 11h10"/></svg>`;
  if (msg.status === 'pulling') {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  } else {
    if (btn) { btn.disabled = false; btn.innerHTML = svgDown; }
    if (out && msg.output) { out.textContent = msg.output.trim(); out.style.display = 'block'; }
  }
}

async function doDelete(id) {
  const app = appsMap[id];
  if (!app) return;
  if (app.state?.status !== 'stopped') {
    toast('Detén la app antes de eliminarla', 'warning');
    return;
  }
  if (!confirm(`Eliminar "${app.name}" del panel?\n\nNo se borrarán archivos del disco.`)) return;
  const r = await api('DELETE', `/api/apps/${id}`);
  if (!r) return;
  if (!r.success) toast(r.message || 'Error al eliminar', 'error');
  else {
    delete appsMap[id];
    removeCard(id);
    updateStats();
    toast(`${app.name} eliminada del panel`, 'info');
  }
}



function setBtn(id, html, disabled) {
  const el = document.getElementById(id);
  if (el) { el.innerHTML = html; el.disabled = disabled; }
}


function openAddModal() {
  document.getElementById('modalOverlay').style.display = 'block';
  document.getElementById('addModal').classList.add('open');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function closeAddModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  document.getElementById('addModal').classList.remove('open');
  document.getElementById('addForm').reset();
}

function openEditModal(id) {
  const app = appsMap[id];
  if (!app) return;
  if (app.state?.status !== 'stopped') {
    toast('Detén la app antes de editar sus datos', 'warning');
    return;
  }

  document.getElementById('editAppId').value = app.id;
  document.getElementById('editInputName').value = app.name || '';
  document.getElementById('editInputPath').value = app.path || '';
  document.getElementById('editInputPort').value = app.port || '';
  document.getElementById('editInputPm').value = app.packageManager || 'npm';

  document.getElementById('editModalOverlay').style.display = 'block';
  document.getElementById('editModal').classList.add('open');
  setTimeout(() => document.getElementById('editInputName').focus(), 50);
}

function closeEditModal() {
  document.getElementById('editModalOverlay').style.display = 'none';
  document.getElementById('editModal').classList.remove('open');
  document.getElementById('editForm').reset();
}

async function submitEditApp(e) {
  e.preventDefault();
  const id             = document.getElementById('editAppId').value;
  const name           = document.getElementById('editInputName').value.trim();
  const path           = document.getElementById('editInputPath').value.trim();
  const port           = document.getElementById('editInputPort').value;
  const packageManager = document.getElementById('editInputPm').value;

  const btn = document.getElementById('editSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';

  const r = await api('PUT', `/api/apps/${id}`, { name, path, port, packageManager });

  btn.disabled = false;
  btn.innerHTML = 'Guardar cambios';

  if (!r) return;

  if (r.success) {
    closeEditModal();
    toast(`Cambios guardados para ${name}`, 'success');
    if (r.app) {
      appsMap[id] = { ...appsMap[id], ...r.app };
      refreshCard(id);
    }
  } else {
    toast(r.message || 'Error al guardar cambios', 'error');
  }
}

async function submitAddApp(e) {
  e.preventDefault();
  const name = document.getElementById('inputName').value.trim();
  const path = document.getElementById('inputPath').value.trim();
  const port = document.getElementById('inputPort').value;
  const packageManager = document.getElementById('inputPm').value;

  const btn = document.getElementById('addSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Agregando...';

  const r = await api('POST', '/api/apps', { name, path, port, packageManager });

  btn.disabled = false;
  btn.innerHTML = 'Agregar';

  if (!r) return;

  if (r.success) {
    closeAddModal();
    toast(`${name} agregada al panel`, 'success');
    if (r.app) {
      appsMap[r.app.id] = { ...r.app, state: { status: 'stopped', errorCount: 0, errors: [] } };
      renderAll();
    }
  } else {
    toast(r.message || 'Error al agregar', 'error');
  }
}


function openDrawer(id) {
  currentDrawerApp = id;
  const app = appsMap[id];
  const errors = app?.state?.errors || [];

  document.getElementById('drawerTitle').textContent = `Errores — ${app?.name || id}`;
  updateDrawerSub(errors.length);

  const log = document.getElementById('errLog');
  const empty = document.getElementById('errEmpty');
  log.innerHTML = '';

  if (errors.length === 0) {
    log.style.display = 'none';
    empty.style.display = 'flex';
  } else {
    log.style.display = 'flex';
    empty.style.display = 'none';
    errors.forEach(e => appendErrEntry(e, log));
    log.scrollTop = log.scrollHeight;
  }

  document.getElementById('drawerOverlay').style.display = 'block';
  document.getElementById('errorDrawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawerOverlay').style.display = 'none';
  document.getElementById('errorDrawer').classList.remove('open');
  currentDrawerApp = null;
}

function appendErrEntry(err, container) {
  const log = container || document.getElementById('errLog');
  const empty = document.getElementById('errEmpty');
  if (!log) return;
  if (empty) empty.style.display = 'none';
  log.style.display = 'flex';

  const div = document.createElement('div');
  div.className = 'err-entry';
  div.innerHTML = `
    <div class="err-ts">${new Date(err.ts).toLocaleString('es-MX')}</div>
    <div class="err-line">${esc(err.line)}</div>
  `;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  updateDrawerSub(log.children.length);
}

function updateDrawerSub(n) {
  const sub = document.getElementById('drawerSub');
  if (sub) sub.textContent = `${n} error${n !== 1 ? 'es' : ''} capturado${n !== 1 ? 's' : ''}`;
}

function clearErrors() {
  if (!currentDrawerApp) return;
  const app = appsMap[currentDrawerApp];
  if (app) {
    app.state.errors = [];
    app.state.errorCount = 0;
    refreshCard(currentDrawerApp);
    updateStats();
  }
  const log = document.getElementById('errLog');
  const empty = document.getElementById('errEmpty');
  if (log) { log.innerHTML = ''; log.style.display = 'none'; }
  if (empty) empty.style.display = 'flex';
  updateDrawerSub(0);
}


const TOAST_ICONS = {
  success: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l4 4 6-6"/></svg>`,
  error: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l12 12M13 1L1 13"/></svg>`,
  warning: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 1L1 12h12L7 1zM7 5.5v3M7 10h.01"/></svg>`,
  info: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="6"/><path d="M7 6v4M7 4h.01"/></svg>`,
};

function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span>${esc(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(16px)';
    setTimeout(() => el.remove(), 280);
  }, 4500);
}


function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDrawer();
    closeAddModal();
    closeEditModal();
  }
});

(async () => {
  const ok = await checkAuth();
  if (ok) connectWS();
})();
