import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getDatabase, ref, onChildAdded, onChildChanged, onChildRemoved, onValue, off, set, update, remove, push } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

// REMOVE all localStorage usage for jobs, categories, and boards
// All job, category, and board CRUD operations must use Firebase Realtime Database only
// Example for jobs:
// - Load jobs: use onValue, onChildAdded, onChildChanged, onChildRemoved on Firebase refs
// - Save jobs: use set, update, remove on Firebase refs
// Example for categories:
// - Load categories: use onValue on /boards/{boardId}/categories
// - Add/remove categories: use set/remove on Firebase refs
// Example for boards:
// - Load boards: use onValue on /boards_meta
// - Add/remove boards: use set/remove on Firebase refs

let COLUMNS = [];

// Listen for cross-tab user updates (version key) and re-fetch users
window.addEventListener('storage', async (e)=>{
  try{
    if(e.key === 'kanban_users_version'){
      if(window._USERS && window._USERS.getAll){
        const users = await window._USERS.getAll();
        window._USERSCache = users || {};
        const evt = new CustomEvent('users-updated', { detail: { users: users || {} } });
        window.dispatchEvent(evt);
      }
    }
  }catch(err){}
});

// Listen for current-user changes across tabs and refresh UI immediately
window.addEventListener('storage', (e)=>{
  try{
    if(e.key === 'kanban_current_user'){
      try{ const raw = localStorage.getItem('kanban_current_user'); if(raw) currentUser = JSON.parse(raw); else currentUser = null; }catch(err){ currentUser = null; }
      try{ updateCurrentUserUI(); }catch(err){}
    }
  }catch(err){}
});
const STORAGE_KEY_BASE = 'kanban_jobs_v1';
function storageKeyForBoard(b){ return STORAGE_KEY_BASE + '::' + (b || currentBoardId()); }

const board = document.getElementById('board');
// job creation only via left createTaskBtn
// export/import UI removed
// clear button removed; hamburger menu will provide actions
const hamburgerBtn = document.getElementById('hamburgerBtn');
const hamburgerMenu = document.getElementById('hamburgerMenu');
// Create Task removed from menu; use left createTaskBtn
const menuManageCategories = document.getElementById('menuRemoveCategory');
const menuManageUsers = document.getElementById('menuManageUsers');
const menuLogin = document.getElementById('menuLogin');
const menuLogout = document.getElementById('menuLogout');
const currentUserDisplay = document.getElementById('currentUserDisplay');
const loginModal = document.getElementById('loginModal');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const loginCancel = document.getElementById('loginCancel');
const loginSubmit = document.getElementById('loginSubmit');
const loginError = document.getElementById('loginError');
const adminAuthModal = document.getElementById('adminAuthModal');
const adminAuthUser = document.getElementById('adminAuthUser');
const adminAuthPass = document.getElementById('adminAuthPass');
const adminAuthCancel = document.getElementById('adminAuthCancel');
const adminAuthSubmit = document.getElementById('adminAuthSubmit');
const adminAuthError = document.getElementById('adminAuthError');
const cardTemplate = document.getElementById('cardTemplate');
const createTaskBtn = document.getElementById('createTaskBtn');
const createModal = document.getElementById('createModal');
const createTitle = document.getElementById('createTitle');
const createDesc = document.getElementById('createDesc');
const createAssignee = document.getElementById('createAssignee');
const createDue = document.getElementById('createDue');
const createCategory = document.getElementById('createCategory');
const createCancel = document.getElementById('createCancel');
const createSave = document.getElementById('createSave');
const detailsModal = document.getElementById('detailsModal');
const detailTitle = document.getElementById('detailTitle');
const detailDesc = document.getElementById('detailDesc');
const detailAssignee = document.getElementById('detailAssignee');
const detailDue = document.getElementById('detailDue');
const detailCategory = document.getElementById('detailCategory');
const detailCreated = document.getElementById('detailCreated');
const detailClose = document.getElementById('detailClose');
const attachmentsList = document.getElementById('attachmentsList');
const attachBtn = document.getElementById('attachBtn');
const attachmentInput = document.getElementById('attachmentInput');
const attachmentStatus = document.getElementById('attachmentStatus');
const commentsList = document.getElementById('commentsList');
const commentInput = document.getElementById('commentInput');
const commentSubmit = document.getElementById('commentSubmit');
const customFieldsContainer = document.getElementById('customFieldsContainer');

/* Debug console capture: capture console calls and global errors/unhandled rejections
   and provide an in-menu debug console UI for phones. Stored in window._debugConsole. */
(function(){
  const buffer = [];
  const MAX_ENTRIES = 5000;
  function pushEntry(level, msg){
    try{
      buffer.push({ ts: Date.now(), level: level, msg: String(msg) });
      if(buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
    }catch(e){}
  }

  // safe stringify for objects
  function safeStringify(v){
    try{
      if(typeof v === 'string') return v;
      if(v instanceof Error) return v.stack || v.message || String(v);
      const seen = new WeakSet();
      return JSON.stringify(v, function(k,val){
        if(typeof val === 'object' && val !== null){
          if(seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      }, 2);
    }catch(e){
      try{ return String(v); }catch(_) { return '[unprintable]'; }
    }
  }

  // Capture original console methods
  const _origConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  ['log','info','warn','error'].forEach(fn => {
    try{
      console[fn] = function(...args){
        try{
          const txt = args.map(a => safeStringify(a)).join(' ');
          pushEntry(fn, txt);
        }catch(e){}
        try{ _origConsole[fn].apply(console, args); }catch(e){}
        // live-update UI if present
        try{ if(window._debugConsole && typeof window._debugConsole.livePush === 'function') window._debugConsole.livePush(fn, args); }catch(e){}
      };
    }catch(e){}
  });

  window.addEventListener('error', function(ev){
    try{
      const msg = ev && ev.error ? (ev.error.stack || ev.error.message || String(ev.error)) : (ev && ev.message) || 'unknown error';
      pushEntry('error', msg + ' @ ' + (ev && ev.filename ? (ev.filename + ':' + ev.lineno + ':' + ev.colno) : '')); 
      if(window._debugConsole && typeof window._debugConsole.livePush === 'function') window._debugConsole.livePush('error', [msg]);
    }catch(e){}
  });

  window.addEventListener('unhandledrejection', function(ev){
    try{
      const reason = ev && ev.reason ? ev.reason : 'unhandled rejection';
      const txt = (reason && reason.stack) ? reason.stack : safeStringify(reason);
      pushEntry('error', 'UnhandledRejection: ' + txt);
      if(window._debugConsole && typeof window._debugConsole.livePush === 'function') window._debugConsole.livePush('error', [txt]);
    }catch(e){}
  });

  // Expose debug console API
  window._debugConsole = {
    _buf: buffer,
    entries: function(){ return buffer.slice(); },
    clear: function(){ buffer.length = 0; const m = document.getElementById('hamburgerMenu'); if(m){ const c = m.querySelector('#debugConsole'); if(c) c.innerHTML=''; } },
    download: function(){ try{ const txt = buffer.map(e => new Date(e.ts).toISOString() + ' ['+e.level+'] ' + e.msg).join('\n'); const blob = new Blob([txt], {type:'text/plain'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'debug-log.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 3000); }catch(e){} },
    livePush: null,
    // render entries into a container element (menuEl)
    renderTo: function(menuEl){
      try{
        if(!menuEl) return;
        // prepare container
        let container = menuEl.querySelector('#debugConsole');
        if(!container){
          container = document.createElement('div');
          container.id = 'debugConsole';
          container.style.maxHeight = '360px';
          container.style.overflow = 'auto';
          container.style.minWidth = '240px';
          container.style.maxWidth = '420px';
          container.style.padding = '6px';
          container.style.marginTop = '8px';
          container.style.borderRadius = '8px';
          container.style.background = 'linear-gradient(180deg,#fff,#fbfdff)';
          container.style.border = '1px solid #eef4fb';
          menuEl.appendChild(container);
        }
        // populate
        container.innerHTML = '';
        buffer.forEach(e => {
          const el = document.createElement('div');
          el.className = 'dbg-entry dbg-' + (e.level || 'log');
          el.style.padding = '6px 8px';
          el.style.borderBottom = '1px solid rgba(2,6,23,0.03)';
          el.style.fontFamily = 'monospace';
          el.style.fontSize = '12px';
          el.style.whiteSpace = 'pre-wrap';
          el.textContent = new Date(e.ts).toLocaleTimeString() + ' [' + (e.level||'log') + '] ' + (e.msg||'');
          container.appendChild(el);
        });
        container.scrollTop = container.scrollHeight;
      }catch(e){}
    }
  };

  // livePush will append a single entry if UI exists (keeps rendering responsive)
  window._debugConsole.livePush = function(level, args){
    try{
      const menu = document.getElementById('hamburgerMenu');
      if(!menu) return;
      const container = menu.querySelector('#debugConsole');
      if(!container) return;
      const txt = args.map(a => safeStringify(a)).join(' ');
      const el = document.createElement('div'); el.className = 'dbg-entry dbg-' + (level||'log'); el.style.padding='6px 8px'; el.style.borderBottom='1px solid rgba(2,6,23,0.03)'; el.style.fontFamily='monospace'; el.style.fontSize='12px'; el.style.whiteSpace='pre-wrap'; el.textContent = new Date().toLocaleTimeString() + ' [' + level + '] ' + txt; container.appendChild(el); container.scrollTop = container.scrollHeight; 
    }catch(e){}
  };

  // helper to prepare a debug UI inside the menu
  window._debugConsole.prepareMenu = function(menuEl){
    try{
      if(!menuEl) return;
      menuEl.innerHTML = '';
      const head = document.createElement('div'); head.style.display='flex'; head.style.justifyContent='space-between'; head.style.alignItems='center'; head.style.gap='8px';
      const title = document.createElement('div'); title.textContent = 'Debug Console'; title.style.fontWeight = '700'; title.style.fontSize='14px';
      const controls = document.createElement('div'); controls.className = 'dbg-controls'; controls.style.display='flex'; controls.style.gap='6px';
      const clearBtn = document.createElement('button'); clearBtn.textContent='Clear'; clearBtn.onclick = function(){ window._debugConsole.clear(); window._debugConsole.renderTo(menuEl); };
      const dlBtn = document.createElement('button'); dlBtn.textContent='Download'; dlBtn.onclick = function(){ window._debugConsole.download(); };
      const closeBtn = document.createElement('button'); closeBtn.textContent='Close'; closeBtn.onclick = function(){ try{ menuEl.style.display = 'none'; }catch(e){} };
      [clearBtn, dlBtn, closeBtn].forEach(b => { b.style.padding='6px 8px'; b.style.borderRadius='6px'; b.style.border='1px solid rgba(0,0,0,0.04)'; b.style.background='transparent'; b.style.cursor='pointer'; controls.appendChild(b); });
      head.appendChild(title); head.appendChild(controls);
      menuEl.appendChild(head);
      // render entries container
      window._debugConsole.renderTo(menuEl);
    }catch(e){}
  };

})();

let state = {};
let currentUser = null; // { username }
let userAvatarEl = null; // DOM element for the colored initial avatar
// Firebase configuration (provided by the user)
const firebaseConfig = {
  apiKey: "AIzaSyBP7NUTGpupGEz5ZH28AhY8DHZKxkKRWTU",
  authDomain: "daily-diary-26dbf.firebaseapp.com",
  databaseURL: "https://daily-diary-26dbf-default-rtdb.firebaseio.com",
  projectId: "daily-diary-26dbf",
  storageBucket: "daily-diary-26dbf.firebasestorage.app",
  messagingSenderId: "994518127061",
  appId: "1:994518127061:web:89064378570723575bed5c",
  measurementId: "G-YRDNL38G9X"
};

let db;
let cardsRef = null; // ref to /boards/{boardId}/cards
// track unsubscribe functions for active card listeners so we can detach when switching boards
let cardListeners = [];
function currentBoardId(){ return localStorage.getItem('kanban_selected_board') || 'default'; }
function cardsPathForBoard(b){ return 'boards/' + (b || currentBoardId()) + '/cards'; }
const WRITE_DEBOUNCE_MS = 400;
const pendingWrites = new Set(); // cardIds currently being written locally
const cardWriteTimers = Object.create(null); // per-card debounce timers

try{
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  cardsRef = ref(db, `/${cardsPathForBoard()}`);
}catch(err){
  console.warn('Firebase init failed or blocked by browser', err);
}

// Lightweight maintenance overlay: listens to /system and shows a blocking overlay
try{
  // create overlay element (hidden by default)
  const _maintenanceOverlay = document.createElement('div');
  _maintenanceOverlay.id = 'maintenanceOverlay';
  _maintenanceOverlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);color:#fff;z-index:9999;align-items:center;justify-content:center;text-align:center;padding:20px';
  const _inner = document.createElement('div');
  _inner.style.cssText = 'max-width:720px;margin:auto;background:#111827;padding:20px;border-radius:8px';
  _inner.innerHTML = '<h2 style="margin:0 0 8px">Maintenance Mode</h2><p style="margin:0">The system is currently offline. Please contact the administrator.</p>';
  _maintenanceOverlay.appendChild(_inner);
  try{ document.body.appendChild(_maintenanceOverlay); }catch(e){}

  // only attach DB listener if db is available
  try{
    if(db){
      const _sysRef = ref(db, '/system');
      onValue(_sysRef, snap => {
        const val = snap.val() || {};
        const enabled = (typeof val.enabled === 'boolean') ? val.enabled : true;
        _maintenanceOverlay.style.display = enabled ? 'none' : 'flex';
      }, err => {
        console.warn('Maintenance overlay: could not read /system state', err);
      });
    }
  }catch(e){ console.warn('Failed to install maintenance listener', e); }
}catch(e){ /* non-fatal */ }

function createInitialState(){
  const s = {};
  COLUMNS.forEach(col => s[col] = []);
  return s;
}

// Load jobs for the current board only
function load(boardId){
  try{
    const key = storageKeyForBoard(boardId);
    const raw = localStorage.getItem(key);
    if(!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    // Filter out any jobs not belonging to this board (extra safety)
    for(const col in parsed){
      if(Array.isArray(parsed[col])){
        parsed[col] = parsed[col].filter(card => card.board === boardId);
      }
    }
    return parsed;
  }catch(e){
    console.error('Failed to load state', e);
    return createInitialState();
  }
}

// Save jobs for the current board only
function save(){
  // Only save jobs that belong to the current board
  const filteredState = {};
  for(const col in state){
    if(Array.isArray(state[col])){
      filteredState[col] = state[col].filter(card => card.board === currentBoardId());
    }
  }
  localStorage.setItem(storageKeyForBoard(), JSON.stringify(filteredState));
}

// --- Remote helpers (per-card) ---
function remoteWriteCard(card){
  if(!cardsRef || !db) return Promise.reject(new Error('no-remote'));
  pendingWrites.add(card.id);
  const payload = {
    id: card.id,
    title: card.title,
    column: card.column,
    order: typeof card.order === 'number' ? card.order : 0,
    description: card.description || '',
    assignee: card.assignee || '',
    due: card.due || null,
    attachments: Array.isArray(card.attachments) ? card.attachments : [],
    // ensure creation timestamp is preserved in remote DB; if missing, set now
    created: typeof card.created === 'number' ? card.created : Date.now(),
    createdBy: card.createdBy || null,
    updatedAt: Date.now(),
    board: currentBoardId()
  };
  const path = `/${cardsPathForBoard()}/${card.id}`;
  try{ console.info('remoteWriteCard ->', path); }catch(e){}
  return set(ref(db, path), payload)
    .catch(err => console.warn('Failed to write card', card.id, err))
    .finally(() => pendingWrites.delete(card.id));
}

function scheduleRemoteWriteCard(card){
  if(!cardsRef) return;
  if(cardWriteTimers[card.id]) clearTimeout(cardWriteTimers[card.id]);
  cardWriteTimers[card.id] = setTimeout(()=>{
    remoteWriteCard(card);
    delete cardWriteTimers[card.id];
  }, WRITE_DEBOUNCE_MS);
}

function remoteRemoveCard(cardId){
  if(!cardsRef || !db) return Promise.reject(new Error('no-remote'));
  pendingWrites.add(cardId);
  return set(ref(db, `/${cardsPathForBoard()}/${cardId}`), null)
    .catch(err => console.warn('Failed to remove remote card', cardId, err))
    .finally(() => pendingWrites.delete(cardId));
}

function remoteBatchUpdateOrders(columns){
  if(!cardsRef || !db) return;
  const updates = {};
  const rootRef = ref(db, '/');
  const uniqueCols = Array.from(new Set(columns));
  uniqueCols.forEach(col => {
    (state[col] || []).forEach((card, idx) => {
      updates[`${cardsPathForBoard()}/${card.id}/order`] = idx;
    });
  });
  // Fire-and-forget
  update(rootRef, updates).catch(err => console.warn('Failed batch update orders', err));
}

function scheduleRemoteWrite(){
  if(!remoteRef) return; // no remote configured
  if(writeTimer) clearTimeout(writeTimer);
  // clone state and add updatedAt to allow simple conflict avoidance
  const payload = {state, updatedAt: Date.now()};
  writeTimer = setTimeout(()=>{
    // prevent writing if remote has a newer timestamp
    set(remoteRef, payload).catch(err => console.warn('Failed to write remote state', err));
    writeTimer = null;
  }, WRITE_DEBOUNCE_MS);
}

function render(){
  console.log('Rendering board for', currentBoardId(), 'with state:', state);
  // If not signed in, hide tasks and show a sign-in prompt
  if(!currentUser){
    board.innerHTML = '';
    const prompt = document.createElement('div');
    prompt.style.padding = '40px';
    prompt.style.textAlign = 'center';
    prompt.style.color = '#444';
    prompt.innerHTML = '<h2>Please sign in to view tasks</h2>';
    const btn = document.createElement('button');
    btn.textContent = 'Sign in';
    btn.style.marginTop = '12px';
    btn.addEventListener('click', ()=>{ if(loginModal) loginModal.style.display = 'flex'; });
    prompt.appendChild(btn);
    board.appendChild(prompt);
    return;
  }

  // If no boards are available, show a hint prompting to create a board
  try{
    if(window._HAS_BOARDS === false){
      board.innerHTML = '';
      const hint = document.createElement('div');
      hint.style.padding = '32px'; hint.style.textAlign = 'center'; hint.style.color = '#444';
      hint.innerHTML = '<h2>No boards available</h2><div style="margin-top:8px;color:#666">Ask an admin to create a board via the Admin → Manage Boards panel.</div>';
      board.appendChild(hint);
      return;
    }
  }catch(e){}

  board.innerHTML = '';
  // Determine which columns should be visible for the current user.
  // The users manager may store visibleColumns as plain category names
  // or as "Board Title / Category" entries (admin UI creates those). We
  // support both: a visibleColumns entry matches if it equals the column
  // name, or if it ends with " / " + column (for prefixed entries).
  let visibleCols = Array.from(COLUMNS);
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    if(me && Array.isArray(me.visibleColumns) && me.visibleColumns.length){
      const allowed = new Set();
      me.visibleColumns.forEach(vc => {
        try{
          if(typeof vc !== 'string') vc = String(vc);
          const trimmed = vc.trim();
          // if entry contains ' / ' we consider the suffix after last ' / ' to be the category name
          if(trimmed.indexOf(' / ') !== -1){
            const parts = trimmed.split(' / ');
            const cat = parts.slice(1).join(' / ').trim();
            if(cat) allowed.add(cat);
          } else {
            allowed.add(trimmed);
          }
        }catch(e){}
      });
      // Filter only those columns that are in allowed set
      visibleCols = visibleCols.filter(c => allowed.has(c));
    }
  }catch(e){ /* ignore and show all */ }

  visibleCols.forEach(col => {
    const colEl = document.createElement('section');
    colEl.className = 'column';
    colEl.dataset.col = col;
    const header = document.createElement('h2');
    header.textContent = col;
    const count = document.createElement('span');
    count.className = 'count';
    // Only count jobs for the current board
    const jobs = (state[col] || []).filter(card => card.board === currentBoardId());
    count.textContent = `(${jobs.length})`;
    header.appendChild(count);
    const drop = document.createElement('div');
    drop.className = 'dropzone';
    drop.dataset.col = col;
  // Dragover/Drop handlers for moving cards between columns
    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.classList.add('dragover');
    });
    drop.addEventListener('dragleave', e => {
      drop.classList.remove('dragover');
    });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      // primary: read card id from dataTransfer
      let cardId = '';
      try{ cardId = e.dataTransfer.getData('text/plain') || ''; }catch(err){ cardId = ''; }
      // fallback: if dataTransfer didn't carry the id (some browsers/conditions), find the currently dragging element
      if(!cardId){
        try{
          const draggingEl = document.querySelector('.card[dragging]') || document.querySelector('[dragging]');
          if(draggingEl && draggingEl.dataset && draggingEl.dataset.id) cardId = draggingEl.dataset.id;
        }catch(e){ }
      }
      if(!cardId){ console.warn('Drop: could not determine dragged card id'); return; }
      // Find the card in any column
      let fromCol = null, card = null, idx = -1;
      for (const c of Object.keys(state)) {
        idx = state[c].findIndex(x => x.id === cardId);
        if (idx !== -1) { fromCol = c; card = state[c][idx]; break; }
      }
      if (!card || fromCol === col) return;
      // Remove from old column
      state[fromCol].splice(idx, 1);
      // Update card's column and order
      card.column = col;
      state[col].push(card);
      (state[col] || []).forEach((c, i) => c.order = i);
      save();
      scheduleRemoteWriteCard(card);
      render();
    });
    jobs.forEach(card => {
      const node = createCardNode(card);
      drop.appendChild(node);
    });
    colEl.appendChild(header);
    colEl.appendChild(drop);
    board.appendChild(colEl);
  });
}

// Rebind top-level cards listeners when the selected board changes
function attachCardsListeners(){
  try{
    if(!db) return;
    // detach existing listeners
    cardListeners.forEach(unsub => unsub());
    cardListeners = [];
    // attach new listeners for the selected board
  const listenPath = '/' + cardsPathForBoard();
  console.log('Attaching card listeners for path:', listenPath);
  cardsRef = ref(db, listenPath);
    try{
      cardListeners.push(onChildAdded(cardsRef, snap => {
        const id = snap.key;
        const remoteCard = snap.val();
        console.log('onChildAdded for board', currentBoardId(), ': card', id, 'from DB:', remoteCard);
        if(!remoteCard) return;
        if(pendingWrites.has(id)) return;
        applyRemoteCard(remoteCard);
      }));
      cardListeners.push(onChildChanged(cardsRef, snap => {
        const id = snap.key;
        const remoteCard = snap.val();
        console.log('onChildChanged for board', currentBoardId(), ': card', id, 'from DB:', remoteCard);
        if(!remoteCard) return;
        if(pendingWrites.has(id)) return;
        applyRemoteCard(remoteCard);
      }));
      cardListeners.push(onChildRemoved(cardsRef, snap => {
        const id = snap.key;
        console.log('onChildRemoved for board', currentBoardId(), ': card', id);
        for(const col of Object.keys(state)){
          const idx = state[col].findIndex(c => c.id === id);
          if(idx !== -1){
            state[col].splice(idx,1);
            (state[col] || []).forEach((c,i)=> c.order = i);
            localStorage.setItem(storageKeyForBoard(), JSON.stringify(state));
            render();
            break;
          }
        }
      }));
    }catch(e){ console.warn('Failed to attach child listeners', e); }
  }catch(e){ console.warn('attachCardsListeners', e); }
}

attachCardsListeners();

// Create and insert the user avatar circle before the createTaskBtn
function ensureUserAvatar(){
  if(userAvatarEl) return userAvatarEl;
  userAvatarEl = document.createElement('div');
  userAvatarEl.className = 'user-avatar';
  userAvatarEl.style.display = 'none';
  userAvatarEl.title = '';
  // insert before Create Task button when available
  try{
    if(createTaskBtn && createTaskBtn.parentNode){
      createTaskBtn.parentNode.insertBefore(userAvatarEl, createTaskBtn);
    }
  }catch(e){}
  return userAvatarEl;
}

// Update the current user UI: avatar, text, and create button enabled state based on permissions
function updateCurrentUserUI(){
  ensureUserAvatar();
  // default to not signed in
  if(!currentUser){
    if(currentUserDisplay) currentUserDisplay.textContent = 'Not signed in';
    if(userAvatarEl) userAvatarEl.style.display = 'none';
    if(createTaskBtn) createTaskBtn.disabled = true;
    return;
  }
  const username = currentUser.username;
  if(currentUserDisplay) currentUserDisplay.textContent = '';
  // get user color and permissions from cached users if available
  let users = window._USERSCache || null;
  let u = findUser(users, username);
  // If not found in in-memory cache, try the persisted localStorage snapshot
  if(!u){
    try{
      const raw = localStorage.getItem('kanban_users_v1');
      if(raw){
        const parsed = JSON.parse(raw);
        if(parsed && Object.keys(parsed).length){
          users = parsed;
          window._USERSCache = users;
          u = findUser(users, username);
        }
      }
    }catch(e){ /* ignore parse errors */ }
  }
  const color = u && u.color ? u.color : '#6b7280';
  const canCreate = u && typeof u.canCreate !== 'undefined' ? !!u.canCreate : true;
  const canUpload = u && typeof u.canUpload !== 'undefined' ? !!u.canUpload : true;
  // populate avatar
  if(userAvatarEl){
    userAvatarEl.textContent = (username && username[0]) ? username[0].toUpperCase() : '?';
    userAvatarEl.style.background = color;
    userAvatarEl.style.color = '#fff';
    userAvatarEl.style.display = 'inline-flex';
    userAvatarEl.title = username;
  }
  if(createTaskBtn) createTaskBtn.disabled = !canCreate;
  // show/hide attach button entirely per permission
  try{ if(attachBtn) attachBtn.style.display = canUpload ? '' : 'none'; }catch(e){}

  // Show Manage Users menu only for the unremovable admin account
  try{
    if(menuManageUsers){
      menuManageUsers.style.display = (username === 'admin') ? '' : 'none';
    }
  }catch(e){}

  // Ensure the standalone ADMIN button visibility matches current user as well
  try{
    const adminBtn = document.getElementById('menuAdmin');
    if(adminBtn) adminBtn.style.display = (username === 'admin') ? '' : 'none';
  }catch(e){}

  // Also fetch freshest user state in background (if available) and re-apply UI to ensure any remote changes propagate
  try{
    if(window._USERS && window._USERS.getAll){
      window._USERS.getAll().then(users => {
        try{
          if(users && Object.keys(users).length){
            window._USERSCache = users;
            const fresh = findUser(users, username);
            const freshCanCreate = fresh && typeof fresh.canCreate !== 'undefined' ? !!fresh.canCreate : canCreate;
            const freshCanUpload = fresh && typeof fresh.canUpload !== 'undefined' ? !!fresh.canUpload : canUpload;
            if(createTaskBtn) createTaskBtn.disabled = !freshCanCreate;
            try{ if(attachBtn) attachBtn.style.display = freshCanUpload ? '' : 'none'; }catch(e){}
            // hide attachments area if user not allowed to view
            try{
              const attachmentsContainer = document.querySelector('.attachments') || document.getElementById('attachmentsList')?.parentNode;
              if(fresh && fresh.canViewAttachments === false){ if(attachmentsContainer) attachmentsContainer.style.display = 'none'; }
              else { if(attachmentsContainer) attachmentsContainer.style.display = ''; }
            }catch(e){}
          }
        }catch(e){/* ignore */}
      }).catch(()=>{});
    }
  }catch(e){}
}

function createCardNode(card){
  const tpl = cardTemplate.content.cloneNode(true);
  const el = tpl.querySelector('.card');
  const title = tpl.querySelector('.card-title');
  const del = tpl.querySelector('.delete');

  el.dataset.id = card.id;
  title.textContent = card.title;
  // apply creator color if available
  try{
    const createdBy = card.createdBy;
    if(createdBy){
      // attempt to get color from users helper cache
      const users = (window._USERS && window._USERS.getAll) ? awaitMaybeUsersSync() : null;
      const color = users && users[createdBy] && users[createdBy].color ? users[createdBy].color : null;
      if(color){
        el.style.setProperty('--creator-color', color);
        el.classList.add('has-creator-color');
      } else {
        el.style.removeProperty('--creator-color');
        el.classList.remove('has-creator-color');
      }
    }
  }catch(e){/* ignore color application errors */}
  // Card titles are not editable inline anymore. Clicking opens the details modal.

  // show details modal when clicking the card (but not when clicking delete or editing title)
  el.addEventListener('click', e => {
    // if we're currently touch-dragging this card, ignore the click
    if(el.hasAttribute('dragging')) return;
    if(e.target.closest('.delete')) return; // ignore delete button clicks
    // show modal
    if(!detailsModal) return;
    if(detailTitle) detailTitle.textContent = card.title || '';
    if(detailDesc) detailDesc.textContent = card.description || '';
    if(detailAssignee) detailAssignee.textContent = card.assignee || '';
  if(detailDue) detailDue.textContent = formatDateStr(card.due);
  if(detailCategory) detailCategory.textContent = card.column || '';
  if(detailCreated) detailCreated.textContent = formatDateStr(card.created);
    const createdByEl = document.getElementById('detailCreatedBy');
    if(createdByEl) createdByEl.textContent = card.createdBy || 'unknown';
  // set current card id for attachment handlers and render attachments
  try{ detailsModal.dataset.cardId = card.id; }catch(e){}
  try{ renderAttachmentsForCard(card); }catch(e){ console.warn('Failed to render attachments', e); }
  try{ listenCommentsForCard(card.id); }catch(e){ console.warn('Failed to start comments listener', e); }
  try{ updateCommentsUIForCurrentUser(card); }catch(e){}
  try{ // start listening and render custom fields for this card
    listenCustomFieldsForCard(card.id);
    renderCustomFieldsForOpenCard();
  }catch(e){ console.warn('Failed to init custom fields for card', e); }
  detailsModal.style.display = 'flex';
  });

  del.addEventListener('click', () => {
    deleteCard(card.id);
  });

  el.addEventListener('dragstart', e => {
    // check permission: current user must have canMove
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
      if(me && me.canMove === false){
        e.preventDefault();
        return;
      }
    }catch(e){}
    e.dataTransfer.setData('text/plain', card.id);
    requestAnimationFrame(() => el.setAttribute('dragging', ''));
  });
  el.addEventListener('dragend', () => el.removeAttribute('dragging'));

  // Touch support: long-press to pick up card and drag between columns on mobile
  (function(){
    let touchState = { timer: null, active: false, startX: 0, startY: 0, touchId: null, currentDrop: null };
    const LONGPRESS = 250; // ms

    function clearTouchTimer(){ if(touchState.timer){ clearTimeout(touchState.timer); touchState.timer = null; } }

    el.addEventListener('touchstart', function(ev){
      if((ev.touches && ev.touches.length > 1)) return; // ignore multi-touch
      const t = ev.touches[0];
      touchState.startX = t.clientX; touchState.startY = t.clientY; touchState.touchId = t.identifier;
      // start long-press timer
      touchState.timer = setTimeout(()=>{
        // permission check: ensure user can move
        try{ const users = window._USERSCache || {}; const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null; if(me && me.canMove === false){ clearTouchTimer(); return; } }catch(e){}
        touchState.active = true;
        // mark element as dragging (reuses existing CSS)
        try{ el.setAttribute('dragging',''); }catch(e){}
        // create floating ghost clone that follows the finger
        try{
          const ghost = el.cloneNode(true);
          ghost.classList.add('drag-ghost');
          // limit width to the original card width (avoid huge clones)
          try{ ghost.style.width = el.offsetWidth + 'px'; }catch(e){}
          // position at touch start (offset slightly above finger so it's not occluded)
          try{ ghost.style.position = 'fixed'; ghost.style.left = (touchState.startX || 0) + 'px'; ghost.style.top = ((touchState.startY || 0) - 36) + 'px'; ghost.style.pointerEvents = 'none'; ghost.style.transition = 'transform 80ms linear'; }catch(e){}
          document.body.appendChild(ghost);
          touchState.ghost = ghost;
          // hide the original card visually while dragging so ghost is the focus
          try{ el.style.visibility = 'hidden'; }catch(e){}
        }catch(e){/* ignore ghost creation errors */}
      }, LONGPRESS);
    }, { passive: true });

    el.addEventListener('touchmove', function(ev){
      // find the touch with our id
      const touches = ev.touches || [];
      const t = Array.prototype.slice.call(touches).find(tt => tt.identifier === touchState.touchId) || touches[0];
      if(!t) return;
      const dx = Math.abs(t.clientX - touchState.startX), dy = Math.abs(t.clientY - touchState.startY);
      // if user moved before longpress threshold, cancel pickup
      if(!touchState.active && (dx > 10 || dy > 10)){
        clearTouchTimer();
        return;
      }
      if(touchState.active){
        // prevent page scrolling while dragging
        ev.preventDefault();
        // move ghost to follow the finger
        try{
          const gx = t.clientX, gy = t.clientY;
          if(touchState.ghost){
            // follow the finger but stay slightly above it so the finger doesn't hide the ghost
            touchState.ghost.style.left = gx + 'px';
            touchState.ghost.style.top = (gy - 36) + 'px';
          }
        }catch(e){}
        // highlight dropzone under finger
        const elUnder = document.elementFromPoint(t.clientX, t.clientY);
        const dz = elUnder ? elUnder.closest('.dropzone') : null;
        if(dz !== touchState.currentDrop){
          if(touchState.currentDrop) try{ touchState.currentDrop.classList.remove('dragover'); }catch(e){}
          touchState.currentDrop = dz;
          if(dz) dz.classList.add('dragover');
        }
      }
    }, { passive: false });

    function touchEndHandler(ev){
      clearTouchTimer();
      if(touchState.active){
        // perform drop if over a dropzone
        try{
          if(touchState.currentDrop){
            const toCol = touchState.currentDrop.dataset && touchState.currentDrop.dataset.col;
            if(toCol && toCol !== card.column){ try{ moveCard(card.id, toCol); }catch(e){ console.warn('touch drop move failed', e); } }
            try{ touchState.currentDrop.classList.remove('dragover'); }catch(e){}
          }
        }catch(e){}
        // remove dragging attribute and restore original visibility
        try{ el.removeAttribute('dragging'); }catch(e){}
        try{ if(touchState.ghost){ touchState.ghost.remove(); touchState.ghost = null; } }catch(e){}
        try{ el.style.visibility = ''; }catch(e){}
      }
      touchState.active = false; touchState.currentDrop = null; touchState.touchId = null;
    }

    el.addEventListener('touchend', touchEndHandler, { passive: true });
    el.addEventListener('touchcancel', touchEndHandler, { passive: true });
  })();

  return el;
}

// Attachment helpers
// Use window.BACKEND if provided. Otherwise prefer the page origin when served over http(s).
// If page is file:// or origin is empty, fall back to localhost:3000 where the STORAGE server commonly runs.
function getQueryParam(name){
  try{ const params = new URLSearchParams(location.search); return params.get(name); }catch(e){ return null; }
}

const _explicitBackend = getQueryParam('backend') || (typeof window.BACKEND === 'string' && window.BACKEND.length ? window.BACKEND : null);
const BACKEND_BASE = _explicitBackend
  || (location && location.protocol && location.protocol.startsWith('http') && location.host ? `${location.protocol}//${location.host}` : 'http://localhost:3000');

if(_explicitBackend && console && console.info) console.info('Using explicit backend:', _explicitBackend);

async function presignUpload(key, contentType){
  try{
    const body = { key, contentType };
    if(currentUser && currentUser.username) body.username = currentUser.username;
    if(console && console.info) console.info('presign-upload request body', body);
    const res = await fetch(BACKEND_BASE + '/presign-upload', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if(!res.ok){
      const text = await res.text().catch(()=>null);
      throw new Error(`presign failed: ${res.status} ${res.statusText} ${text||''}`);
    }
    const j = await res.json();
    return j.url;
  }catch(e){
    console.warn('presignUpload failed', e);
    if(attachmentStatus) attachmentStatus.textContent = 'Failed to contact backend for upload (see console)';
    return null;
  }
}

async function presignDownload(key){
  try{
    const body = { key };
    if(currentUser && currentUser.username) body.username = currentUser.username;
    if(console && console.info) console.info('presign-download request body', body);
    const res = await fetch(BACKEND_BASE + '/presign-download', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if(!res.ok){
      const text = await res.text().catch(()=>null);
      throw new Error(`presign failed: ${res.status} ${res.statusText} ${text||''}`);
    }
    const j = await res.json();
    return j.url;
  }catch(e){
    console.warn('presignDownload failed', e);
    if(attachmentStatus) attachmentStatus.textContent = 'Failed to contact backend for download (see console)';
    return null;
  }
}

async function uploadFileForCard(card, file){
  if(!file) return null;
  // check permission: current user must be allowed to upload
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    if(me && me.canUpload === false){
      if(attachmentStatus) attachmentStatus.textContent = 'You do not have permission to upload attachments';
      return null;
    }
  }catch(e){}
  const key = `attachments/${card.id}/${Date.now()}_${file.name}`;
  attachmentStatus.textContent = 'Requesting upload URL...';
  const url = await presignUpload(key, file.type || 'application/pdf');
  if(!url) { attachmentStatus.textContent = 'Failed to get upload URL'; return null; }
  attachmentStatus.textContent = 'Uploading...';
  try{
    const putRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/pdf' }, body: file });
    if(!putRes.ok){ attachmentStatus.textContent = 'Upload failed'; return null; }
    attachmentStatus.textContent = 'Upload complete';
    const entry = { key, name: file.name, uploadedAt: Date.now(), contentType: file.type || 'application/pdf' };
    // persist into card attachments
    card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
  try{ entry.attachedInCategory = card.column || null; }catch(e){ entry.attachedInCategory = null; }
  card.attachments.push(entry);
    save();
    scheduleRemoteWriteCard(card);
    return entry;
  }catch(e){ attachmentStatus.textContent = 'Upload error'; console.warn(e); return null; }
}

function renderAttachmentsForCard(card){
  if(!attachmentsList) return;
  // respect permission to view attachments; hide the attachments container if not allowed
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    const attachmentsContainer = document.querySelector('.attachments') || document.getElementById('attachmentsList')?.parentNode;
    if(me && me.canViewAttachments === false){
      if(attachmentsContainer) attachmentsContainer.style.display = 'none';
      return;
    } else {
      if(attachmentsContainer) attachmentsContainer.style.display = '';
    }
    // Check uploadable setting for this card's category. Categories in the DB
    // are stored under keys (slugs) while `card.column` is a human title. Try
    // to resolve the key by checking the categories map for a matching title.
    if (attachBtn && card && card.column) {
      import('https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js').then(({ getDatabase, ref, get }) => {
        try{
          const dbInst = getDatabase();
          const catsRef = ref(dbInst, `/boards/${currentBoardId()}/categories`);
          // read the categories object once and resolve uploadable for the matching key/title
          get(catsRef).then(snap => {
            const val = snap.val() || {};
            // If a category exists with key equal to card.column, prefer that
            if(val.hasOwnProperty(card.column)){
              const entry = val[card.column] || {};
              attachBtn.style.display = entry.uploadable ? '' : 'none';
              return;
            }
            // otherwise try to find a category whose title matches the card.column
            const foundKey = Object.keys(val).find(k => {
              try{ const e = val[k] || {}; return (e.title || k) === card.column; }catch(e){ return false; }
            });
            if(foundKey){
              const entry = val[foundKey] || {};
              attachBtn.style.display = entry.uploadable ? '' : 'none';
              return;
            }
            // Not found: hide the attach button
            attachBtn.style.display = 'none';
          }).catch(err => { console.warn('Failed to read categories for uploadable check', err); attachBtn.style.display = 'none'; });
        }catch(e){ console.warn('Uploadable check failed', e); attachBtn.style.display = 'none'; }
      }).catch(e => { console.warn('Dynamic import failed for firebase database', e); attachBtn.style.display = 'none'; });
    }
  }catch(e){}
  const list = (card.attachments || []);
  if(!list.length){ attachmentsList.textContent = 'No attachments'; return; }
  // group attachments by category for clearer separation
  const groups = {};
  list.forEach(a => {
    const cat = a.attachedInCategory || card.column || 'Uncategorized';
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push(a);
  });
  attachmentsList.innerHTML = '';
  Object.keys(groups).forEach(cat => {
    const header = document.createElement('div');
    header.textContent = cat;
    header.style.fontWeight = '700';
    header.style.marginTop = '8px';
    header.style.marginBottom = '6px';
    header.style.fontSize = '13px';
    attachmentsList.appendChild(header);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
    grid.style.gap = '12px';
    grid.style.marginBottom = '12px';

    groups[cat].forEach(a => {
      const box = document.createElement('div');
      box.className = 'attachment-box';

      const top = document.createElement('div'); top.style.display = 'flex'; top.style.alignItems = 'center'; top.style.gap = '8px';
      const icon = document.createElement('div'); icon.textContent = '📄'; icon.style.fontSize = '20px'; icon.style.width = '28px'; icon.style.textAlign = 'center';
      const fname = document.createElement('div'); fname.className = 'file-name'; fname.textContent = a.name || a.key;
      top.appendChild(icon); top.appendChild(fname);

      const meta = document.createElement('div'); meta.className = 'file-meta'; meta.style.display = 'flex'; meta.style.justifyContent = 'space-between'; meta.style.alignItems = 'center';
      const badge = document.createElement('div'); badge.textContent = 'Uploaded in: ' + (a.attachedInCategory || card.column || 'Unknown'); badge.style.padding = '4px 8px'; badge.style.borderRadius = '999px'; badge.style.fontSize = '12px'; badge.style.background = a.attachedInCategory ? '#eef2ff' : '#fff7ed'; badge.style.color = a.attachedInCategory ? '#1f2937' : '#92400e';
      const when = document.createElement('div'); when.textContent = a.uploadedAt ? (new Date(a.uploadedAt)).toLocaleString() : ''; when.style.fontSize = '12px'; when.style.color = '#666';
      meta.appendChild(badge); meta.appendChild(when);

      const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.justifyContent = 'flex-end';
      const dl = document.createElement('button'); dl.textContent = 'Download'; dl.style.padding = '6px 10px'; dl.style.borderRadius = '6px'; dl.style.border = '1px solid #dbeafe'; dl.style.background = '#eff6ff';
      dl.addEventListener('click', async ()=>{
        dl.disabled = true; const prev = dl.textContent; dl.textContent = 'Getting link...';
        const url = await presignDownload(a.key);
        if(!url){ dl.textContent = 'Failed'; setTimeout(()=>{ dl.disabled=false; dl.textContent=prev; }, 1500); return; }
        window.open(url, '_blank');
        dl.disabled = false; dl.textContent = prev;
      });
      actions.appendChild(dl);

      box.appendChild(top);
      box.appendChild(meta);
      box.appendChild(actions);
      grid.appendChild(box);
    });

    attachmentsList.appendChild(grid);
  });
}

// ---------------------- Comments ----------------------
let currentCommentsRef = null;
function clearCommentsListeners(){
  try{
    if(!db) return;
    if(currentCommentsRef){
      try{ off(currentCommentsRef); }catch(e){}
      currentCommentsRef = null;
    }
    if(commentsList) commentsList.innerHTML = '';
  }catch(e){ }
}

function formatShortDate(ts){ try{ return new Date(ts).toLocaleString(); }catch(e){ return ts; } }

function renderCommentNode(id, data){
  if(!commentsList) return;
  // avoid duplicate
  if(commentsList.querySelector(`[data-comment-id="${id}"]`)) return;
  const el = document.createElement('div'); el.dataset.commentId = id; el.style.marginBottom = '8px';
  const wrapper = document.createElement('div'); wrapper.className = 'details-desc';
  const headerRow = document.createElement('div'); headerRow.style.display = 'flex'; headerRow.style.justifyContent = 'space-between'; headerRow.style.alignItems = 'center';
  const meta = document.createElement('div'); meta.style.fontWeight = '600'; meta.style.fontSize = '13px';
  const catPart = data && data.category ? `${data.category} • ` : '';
  meta.textContent = `${data.createdBy || 'anonymous'} • ${catPart}${formatShortDate(data.createdAt || data.created || Date.now())}`;
  const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px';
  // allow delete if current user is author OR has canDeleteComments permission
  try{
    const me = currentUser && currentUser.username ? currentUser.username : null;
    let allowDelete = false;
    try{
      const users = window._USERSCache || {};
      const myRec = me ? findUser(users, me) : null;
      if(myRec && myRec.canDeleteComments) allowDelete = true;
    }catch(e){}
    if(me && data.createdBy && me === data.createdBy) allowDelete = true;
    if(allowDelete){
      const del = document.createElement('button'); del.className = 'delete-comment'; del.textContent = '✕'; del.title = 'Delete comment';
      del.addEventListener('click', async ()=>{
        if(!db) return alert('No DB');
        const cardId = detailsModal?.dataset?.cardId;
        if(!cardId) return;
        const path = `/${cardsPathForBoard()}/${cardId}/comments/${id}`;
        try{ await remove(ref(db, path)); try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){} }catch(e){ console.warn('Failed to remove comment', e); }
      });
      actions.appendChild(del);
    }
  }catch(e){}
  headerRow.appendChild(meta); headerRow.appendChild(actions);
  const txt = document.createElement('div'); txt.textContent = data.text || ''; txt.style.marginTop = '8px';
  wrapper.appendChild(headerRow); wrapper.appendChild(txt);
  el.appendChild(wrapper);
  commentsList.appendChild(el);
  // scroll to bottom
  commentsList.scrollTop = commentsList.scrollHeight;
}

function updateCommentNode(id, data){
  if(!commentsList) return;
  const el = commentsList.querySelector(`[data-comment-id="${id}"]`);
  if(!el) return renderCommentNode(id, data);
  try{
    const meta = el.querySelector('.meta'); if(meta) meta.textContent = `${data.createdBy || 'anonymous'} • ${formatShortDate(data.createdAt || data.created || Date.now())}`;
    const txt = el.querySelector('.text'); if(txt) txt.textContent = data.text || '';
  }catch(e){}
}

function removeCommentNode(id){
  if(!commentsList) return;
  const el = commentsList.querySelector(`[data-comment-id="${id}"]`);
  if(el) el.remove();
}

function listenCommentsForCard(cardId){
  clearCommentsListeners();
  if(!db || !cardId) return;
  // respect per-user view permission: do not attach listeners if user cannot view comments
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    const canView = me ? (typeof me.canViewComments === 'boolean' ? me.canViewComments : true) : true;
    if(!canView){
      if(commentsList) commentsList.innerHTML = '<div style="color:#900;padding:8px">You do not have permission to view comments.</div>';
      return;
    }
  }catch(e){}
  const path = `/${cardsPathForBoard()}/${cardId}/comments`;
  try{
    const r = ref(db, path);
    currentCommentsRef = r;
    // onChildAdded will fire for existing and new children
    onChildAdded(r, snap => { const val = snap.val(); if(val) renderCommentNode(snap.key, val); });
    onChildChanged(r, snap => { const val = snap.val(); if(val) updateCommentNode(snap.key, val); });
    onChildRemoved(r, snap => { removeCommentNode(snap.key); });
  }catch(e){ console.warn('listenCommentsForCard failed', e); }
}

// ---------------- Custom Fields (admin-defined per-board) ----------------
let customFieldDefs = {};
let customFieldDefsRef = null;
let currentCardCustomFieldsRef = null;
// map of fid -> firebase ref for per-field comments so we can detach listeners
let customFieldCommentRefs = {};

function clearCustomFieldListeners(){
  try{
    if(!db) return;
    if(currentCardCustomFieldsRef){ try{ off(currentCardCustomFieldsRef); }catch(e){} currentCardCustomFieldsRef = null; }
    // clear any per-field comment listeners
    try{
      Object.keys(customFieldCommentRefs || {}).forEach(k => { try{ off(customFieldCommentRefs[k]); }catch(e){} });
    }catch(e){}
    customFieldCommentRefs = {};
  }catch(e){}
}

function attachCustomFieldDefsListener(boardId){
  try{
    if(!db) return;
    if(customFieldDefsRef){ try{ off(customFieldDefsRef); }catch(e){} customFieldDefsRef = null; }
    customFieldDefsRef = ref(db, `/boards/${boardId}/customFields`);
    onValue(customFieldDefsRef, snap => {
      customFieldDefs = snap.val() || {};
      try{ console.info('Custom field definitions loaded for board', boardId, customFieldDefs); }catch(e){}
      // re-render for currently open card if any
      try{ if(detailsModal && detailsModal.style.display === 'flex') renderCustomFieldsForOpenCard(); }catch(e){}
    }, err => { console.warn('Failed to read custom field definitions', err); });
  }catch(e){ console.warn('attachCustomFieldDefsListener failed', e); }
}

function listenCustomFieldsForCard(cardId){
  try{
    clearCustomFieldListeners();
    if(!db || !cardId) return;
    const path = `/${cardsPathForBoard()}/${cardId}/customFields`;
    currentCardCustomFieldsRef = ref(db, path);
    onValue(currentCardCustomFieldsRef, snap => {
      const vals = snap.val() || {};
      // populate inputs with the most recent values
      try{ if(detailsModal && detailsModal.style.display === 'flex') renderCustomFieldsForOpenCard(vals); }catch(e){}
    }, err => { console.warn('Failed to listen per-card custom fields', err); });
  }catch(e){ console.warn('listenCustomFieldsForCard failed', e); }
}

async function renderCustomFieldsForOpenCard(perCardValues){
  try{
    if(!customFieldsContainer) return;
    const defs = customFieldDefs || {};
    const ids = Object.keys(defs || {});
    if(!ids.length){ customFieldsContainer.style.display = 'none'; customFieldsContainer.innerHTML = ''; return; }
    const cardId = detailsModal?.dataset?.cardId;
    if(!cardId){ customFieldsContainer.style.display = 'none'; customFieldsContainer.innerHTML = ''; return; }
    // load categories map for this board to resolve visibility by category key/title
    let categoriesMap = null;
    try{
      if(db){
        const mod = await import('https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js');
        const snap = await new Promise((resolve)=>{ mod.onValue(mod.ref(db, `/boards/${currentBoardId()}/categories`), s => resolve(s), { onlyOnce: true }); });
        categoriesMap = (snap && snap.val()) || null;
      }
    }catch(e){ categoriesMap = null; }
    customFieldsContainer.style.display = 'block';
    customFieldsContainer.innerHTML = '';
    const title = document.createElement('h4'); title.style.margin='6px 0'; title.textContent = 'Custom Fields'; customFieldsContainer.appendChild(title);
    ids.forEach(fid => {
      const def = defs[fid] || {};
      // enforce per-field category visibility if defined
      try{
        const vis = def.visibility || {};
        const allowedCats = vis.categories || null; // object keyed by categoryKey -> true
        if(allowedCats && Object.keys(allowedCats).length){
          // determine this card's category key
          const card = Object.values(state).flat().find(c => c.id === cardId) || {};
          const cardCol = card.column || null;
          let cardKey = null;
          try{
            if(categoriesMap){
              if(categoriesMap[cardCol]) cardKey = cardCol;
              else {
                for(const k of Object.keys(categoriesMap || {})){
                  try{ const e = categoriesMap[k] || {}; if((e.title || k) === cardCol){ cardKey = k; break; } }catch(e){}
                }
              }
            }
          }catch(e){ cardKey = null; }
          // if cardKey is found and not allowed, skip rendering this field
          if(!cardKey || !allowedCats[cardKey]) return;
        }
      }catch(e){ /* ignore visibility check on failure */ }
      // enforce per-field permissions if defined (structure: def.permissions.canView, def.permissions.canUse)
      try{
        const perms = def.permissions || {};
        const canViewObj = perms.canView || {};
        const canUseObj = perms.canUse || {};
        const username = (currentUser && currentUser.username) ? currentUser.username : null;
        const viewRestricted = canViewObj && Object.keys(canViewObj).length > 0;
        const useRestricted = canUseObj && Object.keys(canUseObj).length > 0;
        const canView = viewRestricted ? (!!username && !!canViewObj[username]) : true;
        const canUse = useRestricted ? (!!username && !!canUseObj[username]) : true;
        // if current user cannot view this field, skip rendering it entirely
        if(!canView) return;
        // carry allow/deny flags into def so UI can disable inputs when needed
        def.__canUse = canUse;
      }catch(e){ /* ignore permission checks on failure */ }
      const label = def.label || def.title || def.name || fid;
      const type = (def.type || 'comment').toLowerCase();
      const row = document.createElement('div'); row.style.display = 'flex'; row.style.flexDirection = 'column'; row.style.gap = '6px'; row.style.marginBottom = '8px';
      const lab = document.createElement('div'); lab.textContent = label; lab.style.fontWeight = '600'; lab.style.fontSize = '13px'; row.appendChild(lab);
      if(type === 'checkbox' || type === 'bool' || type === 'boolean'){
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = `cf_${fid}`;
        const initial = (perCardValues && typeof perCardValues[fid] !== 'undefined') ? !!perCardValues[fid] : !!(def.default);
        cb.checked = initial;
        // disable if user is not allowed to use this field
        try{ if(def.__canUse === false) cb.disabled = true; }catch(e){}
        cb.addEventListener('change', async ()=>{
          try{
            const path = `/${cardsPathForBoard()}/${cardId}/customFields/${fid}`;
            await set(ref(db, path), !!cb.checked);
            // bump card updatedAt so other clients receive onChildChanged for this card
            try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){}
          }catch(e){ console.warn('Failed to save custom field', e); }
        });
        const wrap = document.createElement('label'); wrap.style.display = 'inline-flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '8px'; wrap.appendChild(cb); const desc = document.createElement('span'); desc.textContent = def.hint || ''; desc.style.color='#666'; wrap.appendChild(desc);
        row.appendChild(wrap);
      } else {
          // treat as comment / textarea but if type === 'comment' provide a full comments UI (list + input)
          if(type === 'comment'){
            // render a comments list for this custom field and an input bar that behaves like the permanent comments
            const commentsWrap = document.createElement('div');
            commentsWrap.style.display = 'flex';
            commentsWrap.style.flexDirection = 'column';
            commentsWrap.style.gap = '8px';
            commentsWrap.style.marginTop = '6px';

            const listEl = document.createElement('div'); listEl.id = `cf_${fid}_list`; listEl.style.maxHeight = '160px'; listEl.style.overflow = 'auto'; listEl.style.padding = '8px'; listEl.style.border = '1px solid #eef4fb'; listEl.style.borderRadius = '6px'; listEl.style.background = '#fff';
            commentsWrap.appendChild(listEl);

            const inputRow = document.createElement('div'); inputRow.style.display = 'flex'; inputRow.style.gap = '8px'; inputRow.style.marginTop = '6px';
            const ta = document.createElement('textarea'); ta.id = `cf_${fid}_input`; ta.rows = 2; ta.style.flex = '1'; ta.style.padding = '8px'; ta.style.border = '1px solid #ddd'; ta.style.borderRadius = '6px';
            const postBtn = document.createElement('button'); postBtn.type = 'button'; postBtn.textContent = 'Post'; postBtn.style.padding = '8px 12px'; postBtn.style.borderRadius = '6px'; postBtn.style.border = '0'; postBtn.style.background = '#2b7cff'; postBtn.style.color = '#fff';
            inputRow.appendChild(ta); inputRow.appendChild(postBtn);
            // disable if user cannot use this field
            try{ if(def.__canUse === false){ ta.readOnly = true; postBtn.disabled = true; } }catch(e){}
            commentsWrap.appendChild(inputRow);

            // helper render functions for per-field comments
            const renderCFCommentNode = (cid, data) => {
              if(!listEl) return;
              if(listEl.querySelector(`[data-cf-comment-id="${cid}"]`)) return;
              const elc = document.createElement('div'); elc.dataset.cfCommentId = cid; elc.style.marginBottom = '8px';
              const wrapper = document.createElement('div'); wrapper.className = 'details-desc';
              const headerRow = document.createElement('div'); headerRow.style.display = 'flex'; headerRow.style.justifyContent = 'space-between'; headerRow.style.alignItems = 'center';
              const meta = document.createElement('div'); meta.className = 'meta'; meta.style.fontWeight = '600'; meta.style.fontSize = '13px'; meta.textContent = `${data.createdBy || 'anonymous'} • ${formatShortDate(data.createdAt || data.created || Date.now())}`;
              const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px';
              try{
                const me = currentUser && currentUser.username ? currentUser.username : null;
                let allowDelete = false;
                try{ const users = window._USERSCache || {}; const myRec = me ? findUser(users, me) : null; if(myRec && myRec.canDeleteComments) allowDelete = true; }catch(e){}
                if(me && data.createdBy && me === data.createdBy) allowDelete = true;
                if(allowDelete){ const del = document.createElement('button'); del.className = 'delete-comment'; del.textContent = '✕'; del.title = 'Delete comment'; del.addEventListener('click', async ()=>{
                  if(!db) return alert('No DB');
                  const path = `/${cardsPathForBoard()}/${cardId}/customFields/${fid}/comments/${cid}`;
                  try{ await remove(ref(db, path)); try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){} }catch(e){ console.warn('Failed to remove custom field comment', e); }
                }); actions.appendChild(del); }
              }catch(e){}
              headerRow.appendChild(meta); headerRow.appendChild(actions);
              const txt = document.createElement('div'); txt.className = 'text'; txt.textContent = data.text || ''; txt.style.marginTop = '8px';
              wrapper.appendChild(headerRow); wrapper.appendChild(txt);
              elc.appendChild(wrapper);
              listEl.appendChild(elc);
              listEl.scrollTop = listEl.scrollHeight;
            };
            const updateCFCommentNode = (cid, data) => { try{ const elc = listEl.querySelector(`[data-cf-comment-id="${cid}"]`); if(!elc) return renderCFCommentNode(cid, data); const meta = elc.querySelector('.meta'); if(meta) meta.textContent = `${data.createdBy || 'anonymous'} • ${formatShortDate(data.createdAt || data.created || Date.now())}`; const txt = elc.querySelector('.text'); if(txt) txt.textContent = data.text || ''; }catch(e){} };
            const removeCFCommentNode = (cid) => { try{ const elc = listEl.querySelector(`[data-cf-comment-id="${cid}"]`); if(elc) elc.remove(); }catch(e){} };

            // attach firebase listeners for this custom-field comments path
            try{
              if(db){
                const path = `/${cardsPathForBoard()}/${cardId}/customFields/${fid}/comments`;
                const r = ref(db, path);
                customFieldCommentRefs[fid] = r;
                onChildAdded(r, snap => { const v = snap.val(); if(v) renderCFCommentNode(snap.key, v); });
                onChildChanged(r, snap => { const v = snap.val(); if(v) updateCFCommentNode(snap.key, v); });
                onChildRemoved(r, snap => { removeCFCommentNode(snap.key); });
              }
            }catch(e){ console.warn('Failed to attach custom field comment listeners', e); }

            postBtn.addEventListener('click', async ()=>{
              const text = (ta.value || '').trim(); if(!text) return;
              if(!db) return alert('Comments require Firebase database access');
              // permission check: allow if def.__canUse !== false and user has canCreateComments (fallback)
              try{ const users = window._USERSCache || {}; const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null; if(def.__canUse === false) return alert('You do not have permission to post to this field'); if(me && me.canCreateComments === false) return alert('You do not have permission to create comments'); }catch(e){}
              try{
                const commentsPath = `/${cardsPathForBoard()}/${cardId}/customFields/${fid}/comments`;
                const newRef = push(ref(db, commentsPath));
                const payload = { id: newRef.key, text: text, createdAt: Date.now(), createdBy: (currentUser && currentUser.username) ? currentUser.username : 'anonymous' };
                await set(newRef, payload);
                try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){}
                ta.value = '';
              }catch(e){ console.warn('Failed to post custom field comment', e); alert('Failed to post comment (see console)'); }
            });

            row.appendChild(commentsWrap);
          } else {
            // fallback: simple textarea with save button (existing behavior)
            const ta = document.createElement('textarea'); ta.id = `cf_${fid}`; ta.rows = 3; ta.style.padding='8px'; ta.style.border='1px solid #ddd'; ta.style.borderRadius='6px'; ta.style.width='100%';
            ta.value = (perCardValues && typeof perCardValues[fid] !== 'undefined') ? (perCardValues[fid] || '') : (def.default || '');
            let saveTimer = null;
            // auto-save (debounced) while typing
            ta.addEventListener('input', ()=>{
              if(saveTimer) clearTimeout(saveTimer);
              saveTimer = setTimeout(async ()=>{
                try{
                  const path = `/${cardsPathForBoard()}/${cardId}/customFields/${fid}`;
                  await set(ref(db, path), ta.value);
                  try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){}
                }catch(e){ console.warn('Failed to save custom field', e); }
              }, 600);
            });
            const controls = document.createElement('div'); controls.style.display = 'flex'; controls.style.gap = '8px'; controls.style.alignItems = 'center'; controls.style.marginTop = '6px';
            const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.textContent = 'Save'; saveBtn.style.padding = '6px 10px'; saveBtn.style.borderRadius = '6px'; saveBtn.style.border = '1px solid #dbeafe'; saveBtn.style.background = '#eff6ff';
            const statusSpan = document.createElement('span'); statusSpan.style.fontSize = '12px'; statusSpan.style.color = '#666';
            // disable controls if user is not allowed to use this field
            try{ if(def.__canUse === false){ ta.readOnly = true; saveBtn.disabled = true; } }catch(e){}
            saveBtn.addEventListener('click', async ()=>{
              try{
                saveBtn.disabled = true; const prev = saveBtn.textContent; saveBtn.textContent = 'Saving...';
                const path = `/${cardsPathForBoard()}/${cardId}/customFields/${fid}`;
                await set(ref(db, path), ta.value);
                // bump card updatedAt so other clients refresh
                try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){}
                saveBtn.textContent = 'Saved';
                statusSpan.textContent = '';
                setTimeout(()=>{ try{ saveBtn.disabled = false; saveBtn.textContent = prev; }catch(e){} }, 1100);
              }catch(e){ console.warn('Failed to save custom field', e); statusSpan.textContent = 'Save failed'; saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
            });
            controls.appendChild(saveBtn); controls.appendChild(statusSpan);
            row.appendChild(ta); row.appendChild(controls);
          }
        }
      customFieldsContainer.appendChild(row);
    });
  }catch(e){ console.warn('renderCustomFieldsForOpenCard failed', e); }
}


function updateCommentsUIForCurrentUser(card){
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    const canView = me ? (typeof me.canViewComments === 'boolean' ? me.canViewComments : true) : true;
    const canCreate = me ? (typeof me.canCreateComments === 'boolean' ? me.canCreateComments : true) : true;
    // show/hide comments list
    if(!canView){
      if(commentsList) commentsList.innerHTML = '<div style="color:#900;padding:8px">You do not have permission to view comments.</div>';
    } else {
      // clear any permission message - actual comments are rendered by listeners
      if(commentsList) commentsList.innerHTML = '';
      // re-listen to populate if needed
      try{ if(card && detailsModal && detailsModal.dataset.cardId === card.id) listenCommentsForCard(card.id); }catch(e){}
    }
    // show/hide input area
    if(commentInput && commentSubmit){
      commentInput.style.display = canCreate ? '' : 'none';
      commentSubmit.style.display = canCreate ? '' : 'none';
    }
  }catch(e){ console.warn('Failed to update comments UI for current user', e); }
}

if(commentSubmit && commentInput){
  commentSubmit.addEventListener('click', async ()=>{
    const text = (commentInput.value || '').trim();
    if(!text) return;
    if(!db) return alert('Comments require Firebase database access');
    const cardId = detailsModal?.dataset?.cardId;
    if(!cardId) return alert('No card selected');
    // check permission to create comments
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
      if(me && me.canCreateComments === false) return alert('You do not have permission to create comments');
    }catch(e){}
    try{
      const commentsPath = `/${cardsPathForBoard()}/${cardId}/comments`;
      const newRef = push(ref(db, commentsPath));
  // include the card's category at the time of posting so the comment keeps context
  let categoryForComment = null;
  try{ const card = Object.values(state).flat().find(c => c.id === cardId); if(card && card.column) categoryForComment = card.column; }catch(e){}
  const payload = { id: newRef.key, text: text, createdAt: Date.now(), createdBy: (currentUser && currentUser.username) ? currentUser.username : 'anonymous', category: categoryForComment };
      await set(newRef, payload);
      // bump card updatedAt so other clients receive child change and can refresh UI
      try{ await update(ref(db, `/${cardsPathForBoard()}/${cardId}`), { updatedAt: Date.now() }); }catch(e){}
      commentInput.value = '';
      // UI will be updated by onChildAdded listener
    }catch(e){ console.warn('Failed to post comment', e); alert('Failed to post comment (see console)'); }
  });
}

// Ensure comments listeners are cleared when closing modal
if(detailClose){ detailClose.addEventListener('click', ()=>{ try{ clearCommentsListeners(); clearCustomFieldListeners(); if(commentInput) commentInput.value = ''; }catch(e){} }); }



// wire attachment controls
if(attachBtn && attachmentInput){
  attachBtn.addEventListener('click', ()=>{
    // check current user's upload permission
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
      if(me && me.canUpload === false){ return alert('You do not have permission to upload attachments'); }
    }catch(e){}
    if(attachmentInput) attachmentInput.click();
  });
  attachmentInput.addEventListener('change', async (e)=>{
    const files = e.target.files; if(!files || !files.length) return;
    // the modal must have a currently shown card — attempt to find by title
    const title = detailTitle ? detailTitle.textContent : null;
    // find card in state by title and created date is not reliable; instead, support attaching only when details modal was opened and a lastViewedCard is set.
    try{
      const lastCardId = detailsModal.dataset.cardId;
      if(!lastCardId){ attachmentStatus.textContent = 'No card selected'; return; }
      const card = Object.values(state).flat().find(c => c.id === lastCardId);
      if(!card){ attachmentStatus.textContent = 'Card not found'; return; }
      await uploadFileForCard(card, files[0]);
      renderAttachmentsForCard(card);
    }catch(e){ console.warn(e); }
  });
}


// Helper to synchronously attempt to read users cache; returns object or null
function awaitMaybeUsersSync(){
  try{
    // If _USERS.getAll is a function, it may be async. We attempt to read last-known users from window._USERSCache
    if(window._USERSCache) return window._USERSCache;
    // try to call getAll but don't await (synchronously impossible) - instead return null
    return null;
  }catch(e){ return null; }
}

// Find a user record by username with case-insensitive fallback
function findUser(usersMap, username){
  if(!usersMap || !username) return null;
  if(usersMap[username]) return usersMap[username];
  const lower = username.toLowerCase();
  for(const k of Object.keys(usersMap)){
    if(k.toLowerCase() === lower) return usersMap[k];
  }
  return null;
}

function addCard(title, col = COLUMNS[0]){
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const card = {id, title, created: Date.now(), column: col, order: (state[col] || []).length, board: currentBoardId()};
  state[col].push(card);
  save();
  render();
  // write this new card to remote
  scheduleRemoteWriteCard(card);
}

function moveCard(cardId, toCol){
  for(const col of COLUMNS){
    const idx = state[col].findIndex(c => c.id === cardId);
    if(idx !== -1){
      const [card] = state[col].splice(idx,1);
      // update card metadata
      card.column = toCol;
      state[toCol].push(card);
      // reassign order indexes for affected columns
      (state[col] || []).forEach((c,i)=> c.order = i);
      (state[toCol] || []).forEach((c,i)=> c.order = i);
      save();
      render();
      // schedule remote writes
      scheduleRemoteWriteCard(card);
      remoteBatchUpdateOrders([col, toCol]);
      return;
    }
  }
}

function deleteCard(cardId){
  for(const col of COLUMNS){
    const idx = state[col].findIndex(c => c.id === cardId);
    if(idx !== -1){
      state[col].splice(idx,1);
      // reassign orders
      (state[col] || []).forEach((c,i)=> c.order = i);
      save();
      render();
      // remove remote
      remoteRemoveCard(cardId);
      remoteBatchUpdateOrders([col]);
      return;
    }
  }
}

// Button in top-left: CREATE TASK + (single entry point)
if(createTaskBtn){
  createTaskBtn.addEventListener('click', () => {
    // require signed-in user to create jobs
    if(!currentUser){
      if(loginModal) loginModal.style.display = 'flex';
      if(loginUser) loginUser.value = '';
      if(loginPass) loginPass.value = '';
      if(loginError) loginError.style.display = 'none';
      return;
    }
    // Open modal and populate categories
    // check permission
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? users[currentUser.username] : null;
      if(me && me.canCreate === false){
        return alert('You do not have permission to create jobs');
      }
    }catch(e){}
    if(createModal) createModal.style.display = 'flex';
    if(createCategory){
      createCategory.innerHTML = '';
      COLUMNS.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col; opt.textContent = col; createCategory.appendChild(opt);
      });
    }
    if(createTitle) createTitle.value = '';
    if(createDesc) createDesc.value = '';
    if(createAssignee) createAssignee.value = '';
    if(createDue) createDue.value = '';
  });
}

// export/import functionality removed per user request

// Hook up hamburger menu actions (guard in case elements are missing)
if(hamburgerBtn && hamburgerMenu){
  hamburgerBtn.addEventListener('click', ()=>{
    const vis = hamburgerMenu.style.display !== 'none';
    if(vis){
      // hide
      hamburgerMenu.style.display = 'none';
      try{ document.body.classList.toggle('hamburger-open', false); }catch(e){}
      // if we moved the menu to body earlier, restore it to its original place
      try{
        if(hamburgerMenu._originalParent){
          if(hamburgerMenu._originalNextSibling){ hamburgerMenu._originalParent.insertBefore(hamburgerMenu, hamburgerMenu._originalNextSibling); }
          else { hamburgerMenu._originalParent.appendChild(hamburgerMenu); }
          delete hamburgerMenu._originalParent;
          delete hamburgerMenu._originalNextSibling;
        }
      }catch(e){}
    } else {
      // show: move menu to document.body so it escapes any stacking contexts and sits above other UI
      try{
        if(!hamburgerMenu._originalParent){
          hamburgerMenu._originalParent = hamburgerMenu.parentNode;
          hamburgerMenu._originalNextSibling = hamburgerMenu.nextSibling;
          document.body.appendChild(hamburgerMenu);
        }
        // compute placement near the button
        const rect = hamburgerBtn.getBoundingClientRect();
        hamburgerMenu.style.position = 'fixed';
        hamburgerMenu.style.zIndex = '20000';
        // place menu so its right aligns with button right, and a bit below button
        // temporarily display block to measure
        hamburgerMenu.style.display = 'block';
        const mW = hamburgerMenu.offsetWidth || 160;
        const left = Math.min(Math.max(8, rect.right - mW), window.innerWidth - mW - 8);
        const top = rect.bottom + 8;
        hamburgerMenu.style.left = left + 'px';
        hamburgerMenu.style.top = top + 'px';
        try{ document.body.classList.toggle('hamburger-open', true); }catch(e){}
      }catch(e){
        // fallback: just toggle display
        hamburgerMenu.style.display = 'block';
        try{ document.body.classList.toggle('hamburger-open', true); }catch(e){}
      }
    }
  });
}
// Create task via left `createTaskBtn` only
if(menuManageCategories){
  menuManageCategories.addEventListener('click', ()=>{
    // open centralized manage UI in categories.js (categories.js will request admin auth if needed)
    const evt = new CustomEvent('categories-manage');
    window.dispatchEvent(evt);
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
  });
}

// Listen for category manager requests that require admin authentication
window.addEventListener('request-admin-auth', (e)=>{
  // show the admin auth modal so the caller can authenticate as admin
  if(adminAuthModal){
    if(adminAuthUser) adminAuthUser.value = '';
    if(adminAuthPass) adminAuthPass.value = '';
    if(adminAuthError) adminAuthError.style.display = 'none';
    adminAuthModal.style.display = 'flex';
  } else {
    // fallback: show login modal
    if(loginModal){ loginModal.style.display = 'flex'; }
  }
});
if(menuManageUsers){
  menuManageUsers.addEventListener('click', ()=>{
    // require admin authentication before opening users manager
    if(adminAuthModal){
      adminAuthModal.style.display = 'flex';
      if(adminAuthUser) adminAuthUser.value = '';
      if(adminAuthPass) adminAuthPass.value = '';
      if(adminAuthError) adminAuthError.style.display = 'none';
    }else{
      const evt = new CustomEvent('users-manage');
      window.dispatchEvent(evt);
    }
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
  });
}
// Login/logout handlers
if(menuLogin){
  menuLogin.addEventListener('click', ()=>{
    if(loginModal) loginModal.style.display = 'flex';
    if(loginUser) loginUser.value = '';
    if(loginPass) loginPass.value = '';
    if(loginError) loginError.style.display = 'none';
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
  });
}
if(menuLogout){
  menuLogout.addEventListener('click', ()=>{
    if(!currentUser) return alert('Not signed in');
    currentUser = null; localStorage.removeItem('kanban_current_user');
    try{ updateCurrentUserUI(); }catch(e){}
    alert('Signed out');
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
    try{ render(); }catch(e){}
    // refresh the page so all UI modules reload based on auth change
    try{ location.reload(); }catch(e){}
  });
}

// Fallback delegation: handle clicks inside the hamburger menu if direct listeners didn't attach
try{
  const hm = document.getElementById('hamburgerMenu');
  if(hm){
    hm.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('button');
      if(!btn) return;
      const id = btn.id;
      try{
        if(id === 'menuLogin'){
          if(loginModal) loginModal.style.display = 'flex';
          if(loginUser) loginUser.value = '';
          if(loginPass) loginPass.value = '';
          if(loginError) loginError.style.display = 'none';
          hm.style.display = 'none';
          return;
        }
        if(id === 'menuLogout'){
          if(!currentUser){ alert('Not signed in'); hm.style.display = 'none'; return; }
          currentUser = null; localStorage.removeItem('kanban_current_user');
          try{ updateCurrentUserUI(); }catch(e){}
          alert('Signed out');
          hm.style.display = 'none';
          try{ render(); }catch(e){}
          try{ location.reload(); }catch(e){}
          return;
        }
        if(id === 'menuAdmin'){
          const raw = localStorage.getItem('kanban_current_user');
          const cu = raw ? JSON.parse(raw) : null;
          if(cu && cu.username === 'admin'){
            try{ window.open('admin/index.html', '_blank'); }catch(e){ window.location.href = 'admin/index.html'; }
          } else {
            if(adminAuthModal){
              if(adminAuthUser) adminAuthUser.value = '';
              if(adminAuthPass) adminAuthPass.value = '';
              if(adminAuthError) adminAuthError.style.display = 'none';
              adminAuthModal.style.display = 'flex';
            } else {
              try{ window.location.href = 'admin/index.html'; }catch(e){}
            }
          }
          hm.style.display = 'none';
          return;
        }
      }catch(e){ /* swallow */ }
    });
  }
}catch(e){ /* ignore */ }

// Make the current user display clickable: open login when signed out, prompt logout when signed in
if(currentUserDisplay){
  // visual affordance
  currentUserDisplay.style.cursor = 'pointer';
  currentUserDisplay.title = 'Click to sign in or out';
  currentUserDisplay.addEventListener('click', ()=>{
    if(!currentUser){
      // open login modal
      if(loginModal) loginModal.style.display = 'flex';
      if(loginUser) loginUser.value = '';
      if(loginPass) loginPass.value = '';
      if(loginError) loginError.style.display = 'none';
      return;
    }
    // if signed in, confirm sign out
    const confirmOut = confirm('Sign out ' + (currentUser && currentUser.username ? currentUser.username : '') + '?');
    if(confirmOut){
      currentUser = null; localStorage.removeItem('kanban_current_user');
      try{ updateCurrentUserUI(); }catch(e){}
      alert('Signed out');
      try{ render(); }catch(e){}
      try{ location.reload(); }catch(e){}
    }
  });
}

if(loginCancel){ loginCancel.addEventListener('click', ()=>{ if(loginModal) loginModal.style.display = 'none'; }); }
// submit login when pressing Enter in username or password
if(loginUser){ loginUser.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') loginSubmit.click(); }); }
if(loginPass){ loginPass.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') loginSubmit.click(); }); }
if(loginSubmit){ loginSubmit.addEventListener('click', async ()=>{
  const u = loginUser && loginUser.value && loginUser.value.trim();
  const p = loginPass && loginPass.value && loginPass.value.trim();
  if(!u || !p){ if(loginError){ loginError.textContent = 'Enter username and password'; loginError.style.display = 'block'; } return; }
  // use users helper
  const ok = await (window._USERS && window._USERS.login ? window._USERS.login(u,p) : Promise.resolve(false));
  if(ok){
    currentUser = { username: u };
    localStorage.setItem('kanban_current_user', JSON.stringify(currentUser));
    // ensure we have latest users data (color/permissions) before updating UI
    try{
      if(window._USERS && window._USERS.getAll){
        const users = await window._USERS.getAll();
        window._USERSCache = users || {};
      } else {
        window._USERSCache = window._USERSCache || {};
      }
    }catch(e){ window._USERSCache = window._USERSCache || {}; }
    try{ updateCurrentUserUI(); }catch(e){}
    if(loginModal) loginModal.style.display = 'none';
    // re-render board now that user is signed in
    try{ render(); }catch(e){}
    // refresh the page so the app fully picks up the signed-in state
    try{ location.reload(); }catch(e){}
  }else{
    if(loginError){ loginError.textContent = 'Invalid username or password'; loginError.style.display = 'block'; }
  }
}); }

// Admin auth modal handlers
if(adminAuthCancel){ adminAuthCancel.addEventListener('click', ()=>{ if(adminAuthModal) adminAuthModal.style.display = 'none'; }); }
// submit admin auth when pressing Enter
if(adminAuthUser){ adminAuthUser.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') adminAuthSubmit.click(); }); }
if(adminAuthPass){ adminAuthPass.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') adminAuthSubmit.click(); }); }
if(adminAuthSubmit){ adminAuthSubmit.addEventListener('click', async ()=>{
  const u = adminAuthUser && adminAuthUser.value && adminAuthUser.value.trim();
  const p = adminAuthPass && adminAuthPass.value && adminAuthPass.value.trim();
  if(!u || !p){ if(adminAuthError){ adminAuthError.textContent = 'Enter username and password'; adminAuthError.style.display = 'block'; } return; }
  // validate via users helper
  const ok = await (window._USERS && window._USERS.login ? window._USERS.login(u,p) : Promise.resolve(false));
  if(ok){
    // Dispatch a guarded event that users.js will listen for to open the manager
    const evt = new CustomEvent('admin-auth-success', { detail: { username: u } });
    window.dispatchEvent(evt);
    if(adminAuthModal) adminAuthModal.style.display = 'none';
  }else{
    if(adminAuthError){ adminAuthError.textContent = 'Invalid admin credentials'; adminAuthError.style.display = 'block'; }
  }
}); }

// restore current user from localStorage
try{
  const raw = localStorage.getItem('kanban_current_user');
  if(raw) currentUser = JSON.parse(raw);
  // update UI for restored user (avatar, permissions)
  // Attempt to load users first so we can show the correct avatar color on refresh
  (async ()=>{
    try{
      if(window._USERS && window._USERS.getAll){
        const users = await window._USERS.getAll();
        window._USERSCache = users || {};
      } else {
        // fallback to any cached copy
        window._USERSCache = window._USERSCache || {};
      }
    }catch(e){ window._USERSCache = window._USERSCache || {}; }
    try{ updateCurrentUserUI(); }catch(e){}
  })();
}catch(e){}

// Create modal handlers
if(createCancel){ createCancel.addEventListener('click', ()=>{ if(createModal) createModal.style.display = 'none'; }); }
if(createSave){ createSave.addEventListener('click', ()=>{
  const title = createTitle && createTitle.value.trim();
  if(!title) return alert('Enter a job title');
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const col = (createCategory && createCategory.value) || COLUMNS[0];
  if (!col) {
    alert('Please select a category before creating a task.');
    return;
  }
  // Ensure state[col] is initialized as an array
  if (!state[col]) state[col] = [];
  const card = {
    id, title,
    description: createDesc ? createDesc.value.trim() : '',
    assignee: createAssignee ? createAssignee.value.trim() : '',
    due: createDue && createDue.value ? createDue.value : null,
    created: Date.now(),
    column: col,
    createdBy: currentUser ? currentUser.username : 'anonymous',
    order: state[col].length,
    board: currentBoardId() // always set board
  };
  state[col].push(card);
  save(); render();
  scheduleRemoteWriteCard(card);
  if(createModal) createModal.style.display = 'none';
}); }

if(detailClose){ detailClose.addEventListener('click', ()=>{
  if(detailsModal){
    detailsModal.style.display = 'none';
    try{ delete detailsModal.dataset.cardId; }catch(e){}
  }
  try{ if(attachmentStatus) attachmentStatus.textContent = ''; }catch(e){}
  try{ clearCommentsListeners(); }catch(e){}
  try{ clearCustomFieldListeners(); }catch(e){}
  try{ if(customFieldsContainer){ customFieldsContainer.style.display = 'none'; customFieldsContainer.innerHTML = ''; } }catch(e){}
}); }

// helper: format date string (optional)
function formatDateStr(d){ if(!d) return '—'; try{ return new Date(d).toLocaleDateString(); }catch(e){ return d; } }

// Migrate legacy global storage (if present) into the currently selected board
try{
  // const legacyKey = STORAGE_KEY_BASE; // 'kanban_jobs_v1'
  // const legacyRaw = localStorage.getItem(legacyKey);
  // if(legacyRaw){
  //   const perKey = storageKeyForBoard();
  //   // only migrate if the target per-board key is empty to avoid overwriting
  //   if(!localStorage.getItem(perKey)){
  //     try{ localStorage.setItem(perKey, legacyRaw); localStorage.removeItem(legacyKey); console.info('Migrated legacy jobs into', perKey); }catch(e){ /* ignore */ }
  //   }
  // }
}catch(e){}

// initialize for current board
state = load(currentBoardId());
// ensure keys exist
COLUMNS.forEach(col => { if(!state[col]) state[col]=[] });
render();
// ensure custom field definitions are listened for on initial load
try{ attachCustomFieldDefsListener(currentBoardId()); }catch(e){}

// expose for debugging
window._KANBAN = {state, save, render};

// listen for categories updates from categories.js module
window.addEventListener('categories-updated', e => {
  const list = e?.detail?.categories;
  if(!Array.isArray(list) || list.length===0) return;
  // Update COLUMNS to match categories from Firebase
  COLUMNS = list;
  // also refresh create modal's category dropdown if present
  try{
    if(createCategory){
      createCategory.innerHTML = '';
      list.forEach(col => { const opt = document.createElement('option'); opt.value = col; opt.textContent = col; createCategory.appendChild(opt); });
    }
  }catch(e){}
  // Re-render board to apply any user visibility rules against the new COLUMNS
  try{ render(); }catch(e){}
});

// re-render when boards availability changes
window.addEventListener('boards-availability-changed', (e)=>{
  try{
    // reload persisted categories for the selected board (if any)
    const persistedCats = loadLocalCategories();
  // REMOVED: setCategories for persistedCats; categories are managed via Firebase only
    render();
  }catch(err){ render(); }
});

// When the selected board changes, reload local state for that board and reattach listeners
window.addEventListener('board-changed', (e)=>{
  try{
    const bid = e?.detail?.boardId || currentBoardId();
    console.log('Board changed to:', bid);
    // stop pending write timers
    Object.keys(cardWriteTimers).forEach(k => { if(cardWriteTimers[k]) clearTimeout(cardWriteTimers[k]); delete cardWriteTimers[k]; });
    // load state for new board
    state = load(bid);
    console.log('Loaded state for board', bid, ':', state);
    // ensure columns exist for new board
  // REMOVED: DEFAULT_COLUMNS logic; COLUMNS should be set from Firebase only
  // Example: COLUMNS = fetchedCategoriesFromFirebase;
    COLUMNS.forEach(col => { if(!state[col]) state[col]=[] });
    // reattach firebase listeners and render
    try{ attachCardsListeners(); }catch(e){}
  try{ attachCustomFieldDefsListener(bid); }catch(e){}
    // refresh category dropdown used by create modal
    try{
      if(createCategory){
        createCategory.innerHTML = '';
        COLUMNS.forEach(col => { const opt = document.createElement('option'); opt.value = col; opt.textContent = col; createCategory.appendChild(opt); });
      }
    }catch(e){}
    // update debug handle
    try{ if(window._KANBAN) window._KANBAN.state = state; }catch(e){}
    // update user UI and render board
    try{ updateCurrentUserUI(); }catch(e){}
    render();
  }catch(err){ console.warn('board-changed handler failed', err); }
});

// Remote -> Local sync is handled by attachCardsListeners() which attaches
// per-board child listeners when the selected board changes.

// Listen for users updates so we can re-render cards with new colors
window.addEventListener('users-updated', async (e)=>{
  try{
    // Prefer to fetch the freshest users snapshot when available
    let users = e?.detail?.users || null;
    try{
      if(window._USERS && window._USERS.getAll){
        const fetched = await window._USERS.getAll();
        if(fetched && Object.keys(fetched).length) users = fetched;
      }
    }catch(err){ /* ignore fetch errors and fall back to event payload */ }
    users = users || (e?.detail?.users || {});
    // cache for synchronous reads
    window._USERSCache = users;
    // re-render the board so cards pick up new colors
    render();
    // update current user UI (avatar/permissions) and attachments visibility
    try{ updateCurrentUserUI(); }catch(e){}
    try{ if(detailsModal && detailsModal.style.display === 'flex'){ const lastCardId = detailsModal.dataset.cardId; if(lastCardId){ const card = Object.values(state).flat().find(c => c.id === lastCardId); if(card) renderAttachmentsForCard(card); } } }catch(e){}
  try{ if(detailsModal && detailsModal.style.display === 'flex'){ const lastCardId = detailsModal.dataset.cardId; if(lastCardId){ const card = Object.values(state).flat().find(c => c.id === lastCardId); if(card) { renderAttachmentsForCard(card); updateCommentsUIForCurrentUser(card); } } } }catch(e){}
    // update create button enabled state based on current user's permission
    try{
      if(currentUser && createTaskBtn){
        const me = findUser(users, currentUser.username);
        createTaskBtn.disabled = !!(me && me.canCreate === false) ? true : false;
      }
    }catch(e){}
  }catch(err){ console.warn('users-updated handling failed', err); }
});

function applyRemoteCard(remoteCard){
  // only process cards for the current board
  if(remoteCard.board && remoteCard.board !== currentBoardId()) {
    console.log('Skipping card from different board:', remoteCard.board, 'current:', currentBoardId(), 'card:', remoteCard.id);
    return;
  }
  console.log('Applying remote card for board', currentBoardId(), ':', remoteCard.id, remoteCard);
  // place or update card in local state if newer
  const id = remoteCard.id;
  const col = remoteCard.column || COLUMNS[0];
  // find existing in all columns
  let found = null;
  for(const c of Object.keys(state)){
    const idx = state[c].findIndex(x=> x.id === id);
    if(idx !== -1){ found = {col:c, idx}; break; }
  }
  const localCard = found ? state[found.col][found.idx] : null;
  if(!localCard){
    // new card
    const card = Object.assign({}, remoteCard);
    // ensure column exists
    if(!state[col]) state[col] = [];
    // add at specified order or push
    if(typeof remoteCard.order === 'number') state[col].splice(remoteCard.order,0,card);
    else state[col].push(card);
    (state[col] || []).forEach((c,i)=> c.order = i);
    localStorage.setItem(storageKeyForBoard(), JSON.stringify(state));
    render();
    return;
  }
  // existing card: update if remote is newer
  if(!localCard.updatedAt || (remoteCard.updatedAt && remoteCard.updatedAt > localCard.updatedAt)){
    // remove from old col if changed
    if(found.col !== col){
      state[found.col].splice(found.idx, 1);
      if(!state[col]) state[col] = [];
      state[col].splice(typeof remoteCard.order === 'number' ? remoteCard.order : state[col].length, 0, remoteCard);
    }else{
      // replace
      state[found.col][found.idx] = Object.assign({}, state[found.col][found.idx], remoteCard);
    }
    (state[col] || []).forEach((c,i)=> c.order = i);
    localStorage.setItem(storageKeyForBoard(), JSON.stringify(state));
    render();
  }
}

// Load categories for the current board from Firebase
function loadCategoriesForBoard(boardId, callback) {
  const catsRef = ref(db, `/boards/${boardId}/categories`);
  onValue(catsRef, snap => {
    const val = snap.val() || {};
    // DB stores categories under slug keys with { title, order } entries.
    // Return the human-readable titles in the original order when available.
    try{
      const items = Object.keys(val || {}).map(k => {
        const entry = val[k] || {};
        return { title: entry.title || k, order: (typeof entry.order === 'number') ? entry.order : 0 };
      });
      items.sort((a,b) => (a.order || 0) - (b.order || 0));
      const categories = items.map(i => i.title);
      callback(categories);
    }catch(e){
      // fallback to keys if structure unexpected
      const categories = Object.keys(val || {});
      callback(categories);
    }
  });
}

// When board changes, update COLUMNS from Firebase
window.addEventListener('board-changed', (e) => {
  const bid = e?.detail?.boardId || currentBoardId();
  loadCategoriesForBoard(bid, async (categories) => {
    try{
      const filtered = await applyUserColumnFilter(bid, categories);
      COLUMNS = filtered;
    }catch(e){ COLUMNS = categories; }
    render();
    try{ attachCustomFieldDefsListener(bid); }catch(e){}
  });
});

// Apply per-user visibleColumns settings to a category list for a given board.
// Supports legacy plain category names and 'Board Title / Category' prefixed entries.
async function applyUserColumnFilter(boardId, categories){
  try{
    if(!Array.isArray(categories) || categories.length === 0) return categories;
    // If no signed-in user, return full list
    if(!currentUser || !currentUser.username) return categories;
    // get users map (prefer cached)
    let users = window._USERSCache || null;
    try{ if(!users && window._USERS && window._USERS.getAll){ users = await window._USERS.getAll(); window._USERSCache = users; } }catch(e){}
    users = users || window._USERSCache || {};
    const me = users && users[currentUser.username] ? users[currentUser.username] : null;
    if(!me || !Array.isArray(me.visibleColumns) || me.visibleColumns.length === 0) return categories;
    const vis = me.visibleColumns;
    const hasPrefixed = vis.some(v => typeof v === 'string' && v.indexOf(' / ') !== -1);
    // If there are no prefixed entries, treat visibleColumns as plain category names
    if(!hasPrefixed){
      // preserve order of 'categories'
      return categories.filter(c => vis.includes(c));
    }
    // Resolve board title so we can match prefixed entries like 'Board Title / Category'
    let boardTitle = boardId;
    try{
      if(window._BOARDS && window._BOARDS.getAll){ const map = await window._BOARDS.getAll(); if(map && map[boardId] && (map[boardId].title || map[boardId].name)) boardTitle = map[boardId].title || map[boardId].name; }
    }catch(e){}
    // Build allowed set for this board by extracting category parts from prefixed entries
    const allowed = new Set();
    vis.forEach(v => {
      try{
        if(typeof v !== 'string') return;
        if(v.indexOf(' / ') !== -1){
          const parts = v.split(' / ');
          const b = parts[0].trim();
          const cat = parts.slice(1).join(' / ').trim();
          if(!cat) return;
          // match board by title or id
          if(b === boardTitle || b === boardId) allowed.add(cat);
        }
      }catch(e){}
    });
    // Also include any plain entries that match current board categories
    vis.forEach(v => { if(typeof v === 'string' && v.indexOf(' / ') === -1){ if(categories.includes(v)) allowed.add(v); } });
    // If allowed is empty, fall back to showing all categories
    if(allowed.size === 0) return categories;
    // preserve order from categories array
    return categories.filter(c => allowed.has(c));
  }catch(err){ return categories; }
}


