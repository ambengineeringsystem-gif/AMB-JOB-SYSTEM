import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

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

let db = null;
let metaRef = null;
try{
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  metaRef = ref(db, '/boards_meta');
}catch(e){ console.warn('Firebase init (boards) failed', e); }

// Local helper storage key
const LS_KEY = 'kanban_boards_v1';
function loadLocal(){ try{ const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }catch(e){ return null; } }
function saveLocal(obj){ try{ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }catch(e){} }

function dispatchBoards(list){ const evt = new CustomEvent('boards-updated', { detail: { boards: list } }); window.dispatchEvent(evt); }

// default single board when nothing exists
function ensureDefaultLocal(){ const cur = loadLocal() || { default: { id: 'default', title: 'Default Board' } }; if(!cur['default']) cur['default'] = { id:'default', title:'Default Board' }; saveLocal(cur); return cur; }

// listen remote -> update local and dispatch
if(metaRef){
  onValue(metaRef, snap => {
    const val = snap.val() || {};
    // normalize to object of { id, title }
    const normalized = {};
    Object.keys(val).forEach(k => {
      const v = val[k] || {};
      normalized[k] = { id: k, title: v.title || (v.name || k) };
    });
    saveLocal(normalized);
    const list = Object.keys(normalized).map(k => normalized[k]);
    dispatchBoards(list);
  }, err => console.warn('boards listen failed', err));
} else {
  // remote unavailable: ensure we have default
  const local = ensureDefaultLocal();
  const list = Object.keys(local).map(k => local[k]);
  setTimeout(()=> dispatchBoards(list), 0);
}

// expose API
window._BOARDS = {
  getAll: async function(){
    // prefer remote if available
    if(metaRef && db){
      return new Promise((resolve)=>{
        onValue(metaRef, snap => { const v = snap.val() || {}; const norm = {}; Object.keys(v).forEach(k=>{ const it=v[k]||{}; norm[k] = { id:k, title: it.title||it.name||k }; }); resolve(norm); }, { onlyOnce: true });
      });
    }
    return Promise.resolve(loadLocal() || ensureDefaultLocal());
  },
  create: async function(id, title){
    if(!id || !title) throw new Error('id and title required');
    const payload = { title };
    if(metaRef && db){
      try{
        await set(ref(db, `/boards_meta/${id}`), payload);
        // Do NOT seed the board with a base category
        // create an empty cards node to ensure the path exists
        try{ await set(ref(db, `/boards/${id}/cards`), {}); }catch(e){}
        return { id, title };
      }catch(e){ console.warn('Failed to create board remote', e); }
    }
    // fallback to local
    const local = loadLocal() || {};
    local[id] = { id, title };
    saveLocal(local);
    dispatchBoards(Object.keys(local).map(k=>local[k]));
    return { id, title };
  },
  remove: async function(id){
    if(!id) throw new Error('id required');
    if(id === 'default') throw new Error('cannot remove default');
    if(metaRef && db){
      try{
        // remove metadata
        await set(ref(db, `/boards_meta/${id}`), null);
        // remove the board contents (categories/cards)
        try{ await set(ref(db, `/boards/${id}`), null); }catch(e){ console.warn('Failed to remove board contents', e); }
        return true;
      }catch(e){ console.warn('Failed to remove board remote', e); }
    }
    const local = loadLocal() || {};
    delete local[id]; saveLocal(local);
    dispatchBoards(Object.keys(local).map(k=>local[k]));
    return true;
  },
  select: function(id){ if(!id) return; localStorage.setItem('kanban_selected_board', id); window.dispatchEvent(new CustomEvent('board-changed', { detail: { boardId: id } })); }
};

// helper to select previously chosen board on load
try{ const sel = localStorage.getItem('kanban_selected_board') || 'default'; window.dispatchEvent(new CustomEvent('board-changed', { detail: { boardId: sel } })); }catch(e){}

export default window._BOARDS;

// --- simple modal manager for boards (admin) ---
let boardsModal = null;
function buildBoardsModal(){
  if(boardsModal) return boardsModal;
  boardsModal = document.createElement('div');
  boardsModal.style.position='fixed'; boardsModal.style.left='0'; boardsModal.style.top='0'; boardsModal.style.right='0'; boardsModal.style.bottom='0'; boardsModal.style.background='rgba(0,0,0,0.45)'; boardsModal.style.display='flex'; boardsModal.style.alignItems='center'; boardsModal.style.justifyContent='center';
  const panel = document.createElement('div'); panel.style.background='#fff'; panel.style.padding='16px'; panel.style.borderRadius='8px'; panel.style.width='420px'; panel.style.maxHeight='80vh'; panel.style.overflow='auto';
  const title = document.createElement('h3'); title.textContent = 'Manage Boards'; panel.appendChild(title);
  const input = document.createElement('input'); input.placeholder='Board id (alphanumeric)'; input.style.width='100%'; input.style.padding='8px'; input.style.marginBottom='8px'; panel.appendChild(input);
  const titleIn = document.createElement('input'); titleIn.placeholder='Board title'; titleIn.style.width='100%'; titleIn.style.padding='8px'; titleIn.style.marginBottom='8px'; panel.appendChild(titleIn);
  const addBtn = document.createElement('button'); addBtn.textContent='Create Board'; addBtn.addEventListener('click', async ()=>{
    const id = (input.value||'').trim(); const t = (titleIn.value||'').trim() || id;
    if(!id) return alert('Enter board id');
    try{ await window._BOARDS.create(id, t); input.value=''; titleIn.value=''; showList(); }catch(e){ alert('Failed to create board: ' + e.message); }
  }); panel.appendChild(addBtn);
  const list = document.createElement('div'); list.style.marginTop='12px'; panel.appendChild(list);
  const close = document.createElement('button'); close.textContent='Close'; close.style.marginTop='12px'; close.addEventListener('click', ()=> boardsModal.style.display='none'); panel.appendChild(close);
  boardsModal.appendChild(panel); document.body.appendChild(boardsModal);

  async function showList(){
    try{
      const map = await window._BOARDS.getAll();
      const items = Object.keys(map||{}).map(k=>map[k]);
      list.innerHTML='';
      items.forEach(it=>{
        const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.padding='6px 0';
        const left = document.createElement('div'); left.textContent = `${it.id} — ${it.title}`; row.appendChild(left);
        const right = document.createElement('div'); const selBtn = document.createElement('button'); selBtn.textContent='Select'; selBtn.style.marginRight='8px'; selBtn.addEventListener('click', ()=>{ window._BOARDS.select(it.id); boardsModal.style.display='none'; }); right.appendChild(selBtn);
        const del = document.createElement('button'); del.textContent='Delete'; if(it.id==='default'){ del.disabled=true; del.title='Default board cannot be removed'; }
        del.addEventListener('click', async ()=>{ if(!confirm('Delete board '+it.id+'?')) return; try{ await window._BOARDS.remove(it.id); showList(); }catch(e){ alert('Failed to delete: '+(e&&e.message?e.message:String(e))); } }); right.appendChild(del);
        row.appendChild(right); list.appendChild(row);
      });
    }catch(e){ console.warn('Failed to list boards', e); }
  }
  // expose showList
  boardsModal.showList = showList;
  return boardsModal;
}

window.addEventListener('boards-manage', ()=>{
  // require admin auth via users.js; if not authed, users.js will request auth
  try{
    // If an admin settings area exists (admin page), render the manager inline there
    const settingsArea = (typeof document !== 'undefined') ? document.getElementById('adminSettingsArea') : null;
    if(settingsArea){
      // ensure it's visible
      settingsArea.style.display = 'block';
      const container = document.getElementById('categoryUploadSettings') || settingsArea;
      // render manager UI into the container
      renderBoardsManager(container);
      return;
    }
    // fallback to modal when admin page UI not present
    const m = buildBoardsModal();
    // ensure we have up-to-date list
    m.showList();
    m.style.display = 'flex';
  }catch(e){ console.warn('Failed to open boards manager', e); }
});

// Render the boards manager UI into a given container (used by admin page)
async function renderBoardsManager(container){
  if(!container) return;
  container.innerHTML = '';
  const title = document.createElement('h3'); title.textContent = 'Manage Boards'; container.appendChild(title);

  const form = document.createElement('div'); form.style.display='flex'; form.style.gap='8px'; form.style.marginBottom='12px';
  const idIn = document.createElement('input'); idIn.placeholder='Board id (alphanumeric)'; idIn.style.padding='8px'; idIn.style.flex='0 0 180px'; idIn.style.borderRadius='8px'; idIn.style.border='1px solid rgba(15,23,42,0.06)';
  const titleIn = document.createElement('input'); titleIn.placeholder='Board title'; titleIn.style.padding='8px'; titleIn.style.flex='1'; titleIn.style.borderRadius='8px'; titleIn.style.border='1px solid rgba(15,23,42,0.06)';
  const addBtn = document.createElement('button'); addBtn.className='btn primary'; addBtn.textContent='Create Board';
  form.appendChild(idIn); form.appendChild(titleIn); form.appendChild(addBtn); container.appendChild(form);

  const list = document.createElement('div'); list.style.display='grid'; list.style.gridTemplateColumns='repeat(auto-fit,minmax(240px,1fr))'; list.style.gap='10px'; container.appendChild(list);

  const close = document.createElement('div'); close.style.marginTop='12px'; const closeBtn = document.createElement('button'); closeBtn.className='btn ghost'; closeBtn.textContent='Close'; closeBtn.addEventListener('click', ()=>{ try{ const settingsArea = document.getElementById('adminSettingsArea'); if(settingsArea) settingsArea.style.display='none'; }catch(e){} }); close.appendChild(closeBtn); container.appendChild(close);

  async function refresh(){
    list.innerHTML='';
    try{
      const map = await window._BOARDS.getAll();
      const items = Object.keys(map||{}).map(k=>map[k]);
      items.forEach(it=>{
        const card = document.createElement('div'); card.style.padding='10px'; card.style.borderRadius='8px'; card.style.background='#fff'; card.style.border='1px solid rgba(15,23,42,0.04)';
        const left = document.createElement('div'); left.textContent = `${it.id} — ${it.title}`; left.style.marginBottom='8px'; card.appendChild(left);
        const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px';
        const selBtn = document.createElement('button'); selBtn.className='btn'; selBtn.textContent='Select'; selBtn.addEventListener('click', ()=>{ window._BOARDS.select(it.id); }); row.appendChild(selBtn);
        const del = document.createElement('button'); del.className='btn ghost'; del.textContent='Delete'; if(it.id==='default'){ del.disabled=true; del.title='Default board cannot be removed'; }
        del.addEventListener('click', async ()=>{ if(!confirm('Delete board '+it.id+'?')) return; try{ await window._BOARDS.remove(it.id); await refresh(); }catch(e){ alert('Failed to delete: '+(e&&e.message?e.message:String(e))); } }); row.appendChild(del);
        card.appendChild(row);
        list.appendChild(card);
      });
    }catch(e){ console.warn('Failed to list boards', e); list.innerHTML = '<div style="color:#900">Failed to load boards</div>'; }
  }

  addBtn.addEventListener('click', async ()=>{
    const id = (idIn.value||'').trim(); const t = (titleIn.value||'').trim() || id;
    if(!id){ alert('Enter board id'); return; }
    try{ await window._BOARDS.create(id, t); idIn.value=''; titleIn.value=''; await refresh(); }catch(e){ alert('Failed to create board: ' + (e && e.message ? e.message : String(e))); }
  });

  await refresh();
}

// open manager after admin-auth-success for admin user
// Previously this opened the boards manager on every admin-auth-success.
// Require an explicit flag `openBoards: true` in the event detail to auto-open.
window.addEventListener('admin-auth-success', (e)=>{
  try{
    const u = e?.detail?.username;
    const autoOpen = e?.detail?.openBoards === true;
    if(u === 'admin' && autoOpen){ const m = buildBoardsModal(); m.showList(); m.style.display='flex'; }
  }catch(err){ console.warn('admin-auth-success handler failed', err); }
});
