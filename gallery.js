/* ═══════════════════════════════════════════
   CELESTIAL GALLERY — gallery.js
   - 메타데이터(이름/설명/날짜): Firestore
   - 이미지 원본: IndexedDB (브라우저 로컬)
   - Firestore에는 썸네일(200px)만 저장
     → 1MB 제한 걱정 없음
═══════════════════════════════════════════ */

'use strict';

if (typeof CONFIG === 'undefined') {
  document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;color:#c8d8f0;background:#03010a;font-family:sans-serif"><div style="font-size:2rem">⚠️</div><div>config.js 를 찾을 수 없습니다</div></div>`;
  throw new Error('config.js not found');
}

/* ══════════════════════════════
   FIREBASE COMPAT 초기화
══════════════════════════════ */

firebase.initializeApp(CONFIG.firebaseConfig);
const db = firebase.firestore();

/* ══════════════════════════════
   INDEXED DB (이미지 원본 저장)
══════════════════════════════ */

let idb;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('celestial_gallery', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = e => { idb = e.target.result; resolve(idb); };
    req.onerror   = () => reject(req.error);
  });
}

function idbSave(id, dataUrl) {
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction('images', 'readwrite');
    const req = tx.objectStore('images').put({ id, dataUrl });
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

function idbGet(id) {
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction('images', 'readonly');
    const req = tx.objectStore('images').get(id);
    req.onsuccess = () => resolve(req.result?.dataUrl || null);
    req.onerror   = () => reject(req.error);
  });
}

function idbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction('images', 'readwrite');
    const req = tx.objectStore('images').delete(id);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

/* ══════════════════════════════
   이미지 처리 유틸
══════════════════════════════ */

// 원본 저장용 (최대 1920px, 품질 88%)
function fileToBase64(file, maxW = 1920, q = 0.88) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 썸네일 생성 (Firestore 저장용, 최대 300px, 품질 70%)
function makeThumb(base64, maxW = 300, q = 0.70) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = reject;
    img.src = base64;
  });
}

/* ══════════════════════════════
   CONSTANTS / STATE
══════════════════════════════ */

const EMOJIS = [
  '🌙','🌟','⭐','✨','💫','🌸','🦋','🐺',
  '🦊','🐉','👑','🌺','🌈','⚡','🔮','🌊',
  '🌹','🍃','🎭','🦄','🔱','🌙','🏹','🗡️',
];

// 로드된 원본 이미지 메모리 캐시 (photoId → dataUrl)
const imgCache = {};

let state = {
  characters:     [],
  activeCharId:   null,
  sortOrder:      'newest',
  viewMode:       'grid',
  openPhotoId:    null,
  selectedEmoji:  EMOJIS[0],
  pendingAction:  null,
  editingPhotoId: null,
  lb: { charId: null, photos: [], index: 0 },
  loading: true,
};

/* ══════════════════════════════
   FIRESTORE 리스너
══════════════════════════════ */

const photoUnsubMap = {};

function initFirestore() {
  db.collection('characters').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed' && photoUnsubMap[change.doc.id]) {
        photoUnsubMap[change.doc.id]();
        delete photoUnsubMap[change.doc.id];
        state.characters = state.characters.filter(c => c.id !== change.doc.id);
        if (state.activeCharId === change.doc.id)
          state.activeCharId = state.characters.length ? state.characters[0].id : null;
      }
    });

    snapshot.docs.forEach(charDoc => {
      const meta     = { id: charDoc.id, ...charDoc.data() };
      const existing = state.characters.find(c => c.id === charDoc.id);
      if (existing) Object.assign(existing, meta);
      else          state.characters.push({ ...meta, photos: [] });

      if (photoUnsubMap[charDoc.id]) return;

      photoUnsubMap[charDoc.id] = db
        .collection('characters').doc(charDoc.id)
        .collection('photos').orderBy('createdAt', 'desc')
        .onSnapshot(async photoSnap => {
          const photos = photoSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          // 원본 이미지 IndexedDB에서 로드 (캐시 활용)
          for (const p of photos) {
            if (!imgCache[p.id]) {
              const stored = await idbGet(p.id);
              if (stored) imgCache[p.id] = stored;
            }
            // fullUrl: 원본 있으면 원본, 없으면 thumb
            p.fullUrl  = imgCache[p.id] || p.thumb || '';
          }

          const char = state.characters.find(c => c.id === charDoc.id);
          if (char) char.photos = photos;

          state.characters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          state.loading = false;
          if (!state.activeCharId && state.characters.length > 0)
            state.activeCharId = state.characters[0].id;

          render();
        });
    });

    if (snapshot.docs.length === 0) {
      state.characters  = [];
      state.loading     = false;
      state.activeCharId = null;
      render();
    }
  });
}

/* ══════════════════════════════
   FB CRUD — 캐릭터
══════════════════════════════ */

function fbAddChar(name, desc, emoji) {
  const id = uid();
  return db.collection('characters').doc(id).set({
    name, desc, emoji, order: state.characters.length, createdAt: Date.now()
  }).then(() => id);
}

function fbUpdateChar(charId, name, desc, emoji) {
  return db.collection('characters').doc(charId).update({ name, desc, emoji });
}

async function fbDeleteChar(charId) {
  const char = state.characters.find(c => c.id === charId);
  if (char) {
    for (const p of char.photos) await fbDeletePhoto(charId, p.id);
  }
  return db.collection('characters').doc(charId).delete();
}

/* ══════════════════════════════
   FB CRUD — 사진
══════════════════════════════ */

async function fbAddPhoto(charId, photoId, thumb, title, date) {
  // Firestore에는 썸네일 + 메타만 저장
  await db.collection('characters').doc(charId)
    .collection('photos').doc(photoId).set({
      title, date, desc: '', thumb,
      createdAt: Date.now(),
    });
}

function fbUpdatePhoto(charId, photoId, title, date, desc) {
  return db.collection('characters').doc(charId)
    .collection('photos').doc(photoId).update({ title, date, desc });
}

async function fbDeletePhoto(charId, photoId) {
  await idbDelete(photoId).catch(() => {});
  delete imgCache[photoId];
  return db.collection('characters').doc(charId)
    .collection('photos').doc(photoId).delete();
}

/* ══════════════════════════════
   STARFIELD
══════════════════════════════ */

function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  const stars = Array.from({ length: 300 }, () => ({
    x: Math.random()*innerWidth, y: Math.random()*innerHeight,
    r: Math.random()*1.7+0.2,   a: Math.random(),
    da: (Math.random()*0.013+0.003)*(Math.random()<0.5?1:-1),
    color: ['#ffffff','#c8d8f0','#f5d67a','#d0b8ff','#a8d8ff'][Math.floor(Math.random()*5)],
  }));
  (function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    stars.forEach(s => {
      s.a = Math.max(0.05, Math.min(1, s.a+s.da));
      if (s.a<=0.05||s.a>=1) s.da*=-1;
      ctx.save(); ctx.globalAlpha=s.a; ctx.fillStyle=s.color;
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); ctx.restore();
    });
    requestAnimationFrame(draw);
  })();
}

function launchShootingStar() {
  const el = document.createElement('div');
  el.className = 'shooting-star';
  const x = Math.random()*innerWidth*0.82;
  const dur = (1.8+Math.random()*1.3).toFixed(2);
  el.style.cssText = `left:${x}px;top:-24px;animation:shoot ${dur}s ease forwards`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), +dur*1000);
}
setInterval(launchShootingStar, 4800);

document.addEventListener('click', e => {
  if (e.target.closest('button,input,textarea,label,.tab-btn,.tab-add-btn,.sort-btn,.view-btn,.icon-btn,.card-action-btn,.detail-btn,.detail-edit-actions')) return;
  const syms = ['✦','✧','⋆','★','✺','⊹','✵','·'];
  for (let i=0;i<6;i++) {
    const el = document.createElement('div');
    el.className = 'sparkle';
    const dx=(Math.random()-0.5)*65, dy=(Math.random()-0.5)*65;
    el.style.cssText=`left:${e.clientX}px;top:${e.clientY}px;--dx:${dx}px;--dy:${dy}px;animation-delay:${i*0.045}s`;
    el.textContent=syms[Math.floor(Math.random()*syms.length)];
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),1050);
  }
});

/* ══════════════════════════════
   TOAST
══════════════════════════════ */

let toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast'+(type?` ${type}`:'');
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2800);
}

/* ══════════════════════════════
   HELPERS
══════════════════════════════ */

function uid() { return 'id_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function todayStr() {
  const d=new Date();
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function sortedPhotos(char) {
  const p=[...char.photos];
  return state.sortOrder==='newest'
    ? p.sort((a,b)=>b.date.localeCompare(a.date))
    : p.sort((a,b)=>a.date.localeCompare(b.date));
}

/* ══════════════════════════════
   RENDER
══════════════════════════════ */

function renderLoading() {
  document.getElementById('tabsRow').innerHTML = '';
  document.getElementById('galleryPanels').innerHTML =
    `<div class="empty-state"><div class="empty-icon" style="animation:star-pulse 1.5s ease-in-out infinite">✦</div><p class="empty-text">데이터를 불러오는 중...</p></div>`;
}

function renderTabs() {
  const row = document.getElementById('tabsRow');
  row.innerHTML = '';
  state.characters.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn'+(c.id===state.activeCharId?' active':'');
    btn.id = 'tab-'+c.id;
    btn.innerHTML = `<span class="tab-emoji">${c.emoji}</span><span>${c.name}</span>`;
    btn.onclick = ()=>{ state.activeCharId=c.id; state.openPhotoId=null; render(); };
    row.appendChild(btn);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add-btn';
  addBtn.innerHTML = '＋ 캐릭터 추가';
  addBtn.onclick = ()=>requirePassword('openAddChar');
  row.appendChild(addBtn);
}

function renderPanels() {
  const container = document.getElementById('galleryPanels');
  container.innerHTML = '';
  state.characters.forEach(c => {
    const panel = document.createElement('div');
    panel.className = 'gallery-panel'+(c.id===state.activeCharId?' active':'');
    panel.id = 'panel-'+c.id;
    panel.innerHTML = buildPanelHTML(c);
    container.appendChild(panel);

    const fileInput  = panel.querySelector('.upload-input');
    const uploadArea = panel.querySelector('.upload-area');
    fileInput.addEventListener('change', ()=>{
      const saved = Array.from(fileInput.files);
      fileInput.value = '';
      if (saved.length) requirePassword('uploadPhotos', c.id, null, saved);
    });
    uploadArea.addEventListener('dragover',  e=>{ e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', ()=>uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', e=>{
      e.preventDefault(); uploadArea.classList.remove('drag-over');
      const saved = Array.from(e.dataTransfer.files);
      if (saved.length) requirePassword('uploadPhotos', c.id, null, saved);
    });
  });
}

function buildPanelHTML(c) {
  const photos = sortedPhotos(c);
  const cardsHTML = photos.length===0
    ?`<div class="empty-state"><div class="empty-icon">🌌</div><p class="empty-text">아직 사진이 없어요</p><p class="empty-sub">위에서 사진을 업로드해보세요</p></div>`
    :photos.map((p,i)=>buildCardHTML(c,p,i)).join('');

  return `
    <div class="char-info-bar">
      <div class="char-avatar">${c.emoji}</div>
      <div class="char-meta">
        <div class="char-name">${c.name}</div>
        <div class="char-desc">${c.desc||'<em>소개가 없습니다</em>'}</div>
      </div>
      <div class="char-stat">
        <div class="char-stat-n">${c.photos.length}</div>
        <div class="char-stat-l">사진</div>
      </div>
      <div class="char-actions">
        <div class="icon-btn" title="캐릭터 수정"  onclick="requirePassword('openEditChar','${c.id}')">✏️</div>
        <div class="icon-btn danger" title="캐릭터 삭제" onclick="requirePassword('confirmDeleteChar','${c.id}')">🗑️</div>
      </div>
    </div>
    <label class="upload-area">
      <input type="file" class="upload-input" accept="image/*" multiple />
      <div class="upload-icon">🌠</div>
      <div class="upload-text">드래그하거나 <span>클릭하여 업로드</span></div>
    </label>
    <div class="controls-bar">
      <div class="sort-group">
        <button class="sort-btn${state.sortOrder==='newest'?' active':''}" onclick="setSortOrder('newest')">최신순 ↓</button>
        <button class="sort-btn${state.sortOrder==='oldest'?' active':''}" onclick="setSortOrder('oldest')">오래된순 ↑</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="photo-count">${photos.length}장의 사진</span>
        <div class="view-group">
          <div class="view-btn${state.viewMode==='grid'?' active':''}" title="그리드" onclick="setViewMode('grid')">⊞</div>
          <div class="view-btn${state.viewMode==='list'?' active':''}" title="목록"   onclick="setViewMode('list')">☰</div>
        </div>
      </div>
    </div>
    <div class="photo-grid${state.viewMode==='list'?' list-view':''}" id="grid-${c.id}">${cardsHTML}</div>`;
}

function buildCardHTML(c, p, i) {
  const isOpen  = state.openPhotoId===p.id;
  const src     = p.fullUrl || p.thumb || '';
  const imgHTML = src
    ?`<img src="${src}" alt="${p.title}" loading="lazy" />`
    :`<div class="photo-placeholder">${c.emoji}</div>`;
  const detailHTML = isOpen ? buildDetailHTML(c,p) : '';

  return `
    <div class="photo-card" id="card-${p.id}" style="animation-delay:${i*0.055}s"
         onclick="openLightbox('${c.id}','${p.id}')">
      <div class="photo-card-img-wrap"><div class="photo-overlay"></div>${imgHTML}</div>
      <div class="photo-card-actions">
        <div class="card-action-btn icon-btn" title="설명 보기/접기"
             onclick="event.stopPropagation();toggleDetail('${c.id}','${p.id}')">📝</div>
        <div class="card-action-btn icon-btn" title="사진 정보 수정"
             onclick="event.stopPropagation();requirePassword('openEditPhoto','${c.id}','${p.id}')">✏️</div>
        <div class="card-action-btn icon-btn danger" title="사진 삭제"
             onclick="event.stopPropagation();requirePassword('confirmDeletePhoto','${c.id}','${p.id}')">🗑️</div>
      </div>
      <div class="photo-card-foot">
        <div class="photo-card-title">${p.title}</div>
        <div class="photo-card-date">${p.date}</div>
      </div>
    </div>
    ${detailHTML?`<div id="detail-wrap-${p.id}">${detailHTML}</div>`:''}`;
}

function buildDetailHTML(c, p) {
  if (state.editingPhotoId===p.id) return `
    <div class="photo-detail"><div class="detail-edit-form">
      <input  class="detail-input"    id="editPhotoTitle" value="${p.title}" placeholder="제목" />
      <input  class="detail-input"    id="editPhotoDate"  value="${p.date}"  placeholder="날짜 (YYYY.MM.DD)" />
      <textarea class="detail-textarea" id="editPhotoDesc" placeholder="부가 설명 (선택)">${p.desc||''}</textarea>
      <div class="detail-edit-actions">
        <button class="detail-btn edit-btn" onclick="savePhotoEdit('${c.id}','${p.id}')">저장</button>
        <button class="detail-btn"          onclick="cancelPhotoEdit()">취소</button>
      </div>
    </div></div>`;

  return `
    <div class="photo-detail">
      <div class="detail-header">
        <span class="detail-title">${p.title}</span>
        <span class="detail-date">${p.date}</span>
      </div>
      <div class="detail-desc${p.desc?'':' empty'}">${p.desc||'부가 설명이 없습니다. 아래에서 추가할 수 있어요.'}</div>
      <div class="detail-actions">
        <button class="detail-btn edit-btn" onclick="requirePassword('startEditPhotoDetail','${c.id}','${p.id}')">✏️ 수정</button>
        <button class="detail-btn del-btn"  onclick="requirePassword('confirmDeletePhoto','${c.id}','${p.id}')">🗑️ 삭제</button>
      </div>
    </div>`;
}

function render() {
  if (state.loading) { renderLoading(); return; }
  renderTabs();
  renderPanels();
}

/* ══════════════════════════════
   TOGGLE / SORT / VIEW
══════════════════════════════ */

function toggleDetail(charId, photoId) {
  state.openPhotoId    = state.openPhotoId===photoId ? null : photoId;
  state.editingPhotoId = null;
  render();
  if (state.openPhotoId)
    requestAnimationFrame(()=>document.getElementById('card-'+photoId)?.scrollIntoView({behavior:'smooth',block:'nearest'}));
}
function setSortOrder(o) { state.sortOrder=o; render(); }
function setViewMode(m)  { state.viewMode=m;  render(); }

/* ══════════════════════════════
   UPLOAD
══════════════════════════════ */

async function processFiles(charId, files) {
  const arr = Array.from(files).filter(f=>f.type.startsWith('image/'));
  if (!arr.length) return;

  for (let i=0; i<arr.length; i++) {
    showToast(`⏳ 처리 중... (${i+1}/${arr.length})`, '');
    try {
      const photoId = uid();
      const full    = await fileToBase64(arr[i]);       // 원본 (1920px)
      const thumb   = await makeThumb(full);            // 썸네일 (300px) → Firestore
      const title   = arr[i].name.replace(/\.[^/.]+$/,'');

      await idbSave(photoId, full);                     // IndexedDB에 원본 저장
      imgCache[photoId] = full;                         // 메모리 캐시
      await fbAddPhoto(charId, photoId, thumb, title, todayStr()); // Firestore에 메타+썸네일
    } catch(e) {
      console.error(e);
      showToast('❌ 업로드 실패: '+arr[i].name, 'error');
    }
  }
  showToast(`📸 ${arr.length}장 업로드 완료`, 'success');
}

/* ══════════════════════════════
   LIGHTBOX
══════════════════════════════ */

function openLightbox(charId, photoId) {
  const char = state.characters.find(c=>c.id===charId); if(!char) return;
  const photos = sortedPhotos(char);
  state.lb = { charId, photos, index: Math.max(0, photos.findIndex(p=>p.id===photoId)) };
  showLbPhoto();
  const lb = document.getElementById('lightbox');
  lb.classList.add('open');
  if      (lb.requestFullscreen)       lb.requestFullscreen();
  else if (lb.webkitRequestFullscreen) lb.webkitRequestFullscreen();
}

function showLbPhoto() {
  const { photos, index } = state.lb;
  const p = photos[index]; if(!p) return;
  const img = document.getElementById('lbImg');
  const src = p.fullUrl || p.thumb || '';
  if (src){ img.src=src; img.style.display=''; } else { img.src=''; img.style.display='none'; }
  document.getElementById('lbTitle').textContent = p.title;
  document.getElementById('lbDate').textContent  = p.date;
  const descEl = document.getElementById('lbDesc');
  descEl.textContent = p.desc||''; descEl.style.display = p.desc?'':'none';
  document.getElementById('lbCounter').textContent = `${index+1} / ${photos.length}`;
}

function lbNav(dir) {
  const len = state.lb.photos.length;
  state.lb.index = ((state.lb.index+dir)%len+len)%len;
  showLbPhoto();
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  if (document.fullscreenElement||document.webkitFullscreenElement) {
    if      (document.exitFullscreen)            document.exitFullscreen();
    else if (document.webkitExitFullscreen)      document.webkitExitFullscreen();
  }
}

document.addEventListener('fullscreenchange',       ()=>{ if(!document.fullscreenElement)       document.getElementById('lightbox').classList.remove('open'); });
document.addEventListener('webkitfullscreenchange', ()=>{ if(!document.webkitFullscreenElement) document.getElementById('lightbox').classList.remove('open'); });
document.addEventListener('keydown', e=>{
  if(!document.getElementById('lightbox').classList.contains('open')) return;
  if      (e.key==='Escape')     closeLightbox();
  else if (e.key==='ArrowLeft')  lbNav(-1);
  else if (e.key==='ArrowRight') lbNav(1);
});
document.getElementById('lightbox').addEventListener('click', e=>{
  if(e.target===document.getElementById('lightbox')) closeLightbox();
});

/* ══════════════════════════════
   PASSWORD GATE
══════════════════════════════ */

function requirePassword(type, charId, photoId, files) {
  state.pendingAction = { type, charId:charId||null, photoId:photoId||null, files:files||null };
  document.getElementById('pwInput').value       = '';
  document.getElementById('pwError').textContent = '';
  document.getElementById('pwGate').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('pwInput').focus());
}

function submitPassword() {
  const val = document.getElementById('pwInput').value;
  if (val !== CONFIG.password) {
    document.getElementById('pwError').textContent = '⚠ 비밀번호가 올바르지 않습니다';
    document.getElementById('pwInput').value = '';
    document.getElementById('pwInput').focus();
    return;
  }
  closePwGate();
  executeAction(state.pendingAction);
  state.pendingAction = null;
}

function closePwGate() { document.getElementById('pwGate').classList.remove('open'); }

document.getElementById('pwInput').addEventListener('keydown', e=>{
  if(e.key==='Enter')  submitPassword();
  if(e.key==='Escape') closePwGate();
});

/* ══════════════════════════════
   ACTION DISPATCHER
══════════════════════════════ */

function executeAction(action) {
  if(!action) return;
  const {type,charId,photoId,files} = action;
  switch(type) {
    case 'openAddChar':          openAddCharModal();                    break;
    case 'openEditChar':         openEditCharModal(charId);             break;
    case 'confirmDeleteChar':    openConfirm('캐릭터를 삭제할까요?<br>해당 캐릭터의 사진도 모두 삭제됩니다.',()=>doDeleteChar(charId)); break;
    case 'openEditPhoto':        openEditPhotoModal(charId,photoId);    break;
    case 'confirmDeletePhoto':   openConfirm('이 사진을 삭제할까요?',()=>doDeletePhoto(charId,photoId)); break;
    case 'startEditPhotoDetail': startEditPhotoDetail(charId,photoId);  break;
    case 'uploadPhotos':         processFiles(charId,files);            break;
  }
}

/* ══════════════════════════════
   CHARACTER MODALS
══════════════════════════════ */

function openAddCharModal() {
  state.selectedEmoji = EMOJIS[0];
  document.getElementById('newCharName').value = '';
  document.getElementById('newCharDesc').value = '';
  buildEmojiPicker('addEmojiPicker', ()=>{});
  document.getElementById('addCharModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('newCharName').focus());
}
function closeAddCharModal() { document.getElementById('addCharModal').classList.remove('open'); }

async function submitAddChar() {
  const name = document.getElementById('newCharName').value.trim();
  if (!name) { document.getElementById('newCharName').focus(); return; }
  const desc = document.getElementById('newCharDesc').value.trim();
  closeAddCharModal();
  try {
    const id = await fbAddChar(name, desc, state.selectedEmoji);
    state.activeCharId = id;
    showToast('✨ 새 캐릭터가 추가되었습니다','success');
  } catch(e) { console.error(e); showToast('❌ 저장 실패','error'); }
}

function openEditCharModal(charId) {
  const c = state.characters.find(x=>x.id===charId); if(!c) return;
  state.selectedEmoji = c.emoji;
  document.getElementById('editCharId').value   = charId;
  document.getElementById('editCharName').value = c.name;
  document.getElementById('editCharDesc').value = c.desc;
  buildEmojiPicker('editEmojiPicker', ()=>{}, c.emoji);
  document.getElementById('editCharModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('editCharName').focus());
}
function closeEditCharModal() { document.getElementById('editCharModal').classList.remove('open'); }

async function submitEditChar() {
  const charId = document.getElementById('editCharId').value;
  const name   = document.getElementById('editCharName').value.trim(); if(!name) return;
  const desc   = document.getElementById('editCharDesc').value.trim();
  closeEditCharModal();
  try { await fbUpdateChar(charId,name,desc,state.selectedEmoji); showToast('✏️ 캐릭터가 수정되었습니다','success'); }
  catch(e) { console.error(e); showToast('❌ 저장 실패','error'); }
}

async function doDeleteChar(charId) {
  try { await fbDeleteChar(charId); showToast('🗑️ 캐릭터가 삭제되었습니다'); }
  catch(e) { console.error(e); showToast('❌ 삭제 실패','error'); }
}

/* ══════════════════════════════
   PHOTO MODALS
══════════════════════════════ */

function openEditPhotoModal(charId, photoId) {
  const char  = state.characters.find(c=>c.id===charId);
  const photo = char?.photos.find(p=>p.id===photoId); if(!photo) return;
  document.getElementById('editPhotoCharId').value  = charId;
  document.getElementById('editPhotoIdField').value = photoId;
  document.getElementById('editPhotoTitleM').value  = photo.title;
  document.getElementById('editPhotoDateM').value   = photo.date;
  document.getElementById('editPhotoDescM').value   = photo.desc||'';
  document.getElementById('editPhotoModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('editPhotoTitleM').focus());
}
function closeEditPhotoModal() { document.getElementById('editPhotoModal').classList.remove('open'); }

async function submitEditPhoto() {
  const charId  = document.getElementById('editPhotoCharId').value;
  const photoId = document.getElementById('editPhotoIdField').value;
  const title   = document.getElementById('editPhotoTitleM').value.trim(); if(!title) return;
  const date    = document.getElementById('editPhotoDateM').value.trim();
  const desc    = document.getElementById('editPhotoDescM').value.trim();
  closeEditPhotoModal();
  try { await fbUpdatePhoto(charId,photoId,title,date,desc); showToast('✏️ 사진 정보가 수정되었습니다','success'); }
  catch(e) { console.error(e); showToast('❌ 저장 실패','error'); }
}

async function doDeletePhoto(charId, photoId) {
  if (state.openPhotoId===photoId) state.openPhotoId = null;
  try { await fbDeletePhoto(charId,photoId); showToast('🗑️ 사진이 삭제되었습니다'); }
  catch(e) { console.error(e); showToast('❌ 삭제 실패','error'); }
}

function startEditPhotoDetail(charId, photoId) {
  state.openPhotoId=photoId; state.editingPhotoId=photoId; render();
}

async function savePhotoEdit(charId, photoId) {
  const t = document.getElementById('editPhotoTitle')?.value.trim();
  const d = document.getElementById('editPhotoDate')?.value.trim();
  const s = document.getElementById('editPhotoDesc')?.value.trim()||'';
  state.editingPhotoId = null;
  try { await fbUpdatePhoto(charId,photoId,t,d,s); showToast('✏️ 설명이 수정되었습니다','success'); }
  catch(e) { console.error(e); showToast('❌ 저장 실패','error'); }
}

function cancelPhotoEdit() { state.editingPhotoId=null; render(); }

/* ══════════════════════════════
   CONFIRM
══════════════════════════════ */

let confirmCallback = null;
function openConfirm(msg,cb)  { confirmCallback=cb; document.getElementById('confirmMsg').innerHTML=msg; document.getElementById('confirmModal').classList.add('open'); }
function closeConfirm()       { document.getElementById('confirmModal').classList.remove('open'); confirmCallback=null; }
function submitConfirm()      { closeConfirm(); if(confirmCallback) confirmCallback(); }

/* ══════════════════════════════
   EMOJI PICKER
══════════════════════════════ */

function buildEmojiPicker(containerId, onChange, initial) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const selected = initial||state.selectedEmoji;
  EMOJIS.forEach(em=>{
    const opt = document.createElement('div');
    opt.className   = 'emoji-opt'+(em===selected?' selected':'');
    opt.textContent = em;
    opt.onclick = ()=>{
      state.selectedEmoji=em;
      container.querySelectorAll('.emoji-opt').forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');
      onChange(em);
    };
    container.appendChild(opt);
  });
  state.selectedEmoji = selected;
}

function togglePw(inputId, btnId) {
  const inp=document.getElementById(inputId), btn=document.getElementById(btnId);
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈';}
  else{inp.type='password';btn.textContent='👁️';}
}

['addCharModal','editCharModal','editPhotoModal','confirmModal'].forEach(id=>{
  document.getElementById(id).addEventListener('click', e=>{
    if(e.target===document.getElementById(id)) document.getElementById(id).classList.remove('open');
  });
});

/* ══════════════════════════════
   INIT
══════════════════════════════ */

openIDB().then(() => {
  initStarfield();
  renderLoading();
  initFirestore();
}).catch(e => {
  console.error('IndexedDB 초기화 실패:', e);
  // IDB 없이도 진행 (썸네일만 표시)
  initStarfield();
  renderLoading();
  initFirestore();
});

// 터치 스와이프로 사진 넘기기
(function() {
  let tx = 0, ty = 0;
  const lb = document.getElementById('lightbox');
  lb.addEventListener('touchstart', e => {
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) lbNav(dx < 0 ? 1 : -1);
  }, { passive: true });
})();