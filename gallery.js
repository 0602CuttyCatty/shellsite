/* ═══════════════════════════════════════════
   CELESTIAL GALLERY — gallery.js
   캐릭터별 사진탭(게시물=여러장) + 글탭
═══════════════════════════════════════════ */
'use strict';

firebase.initializeApp(CONFIG.firebaseConfig);
const db = firebase.firestore();

/* ══════════════════════════════
   CONSTANTS
══════════════════════════════ */

const EMOJIS = [
  '🌙','🌟','⭐','✨','💫','🌸','🦋','🐺',
  '🦊','🐉','👑','🌺','🌈','⚡','🔮','🌊',
  '🌹','🍃','🎭','🦄','🔱','🌙','🏹','🗡️',
];

/* ══════════════════════════════
   STATE
══════════════════════════════ */

let state = {
  characters:     [],
  activeCharId:   null,
  subtab:         'photos',   // 'photos' | 'writings'
  sortOrder:      'newest',
  selectedEmoji:  EMOJIS[0],
  pendingAction:  null,
  // 게시물 상세 슬라이더
  postDetail:     null,       // { post, imgIndex }
  // 글 상세
  writingDetail:  null,       // { writing, charId }
  // 모달 내 이미지 미리보기
  pendingImages:  [],         // { file, dataUrl }[]
  editingPostImages: [],      // 기존 이미지 (수정 시)
  loading: true,
};

/* ══════════════════════════════
   FIRESTORE 리스너
══════════════════════════════ */

const unsubMap = {};

function initFirestore() {
  db.collection('characters').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') {
        ['posts','writings'].forEach(sub => {
          const key = change.doc.id + '_' + sub;
          if (unsubMap[key]) { unsubMap[key](); delete unsubMap[key]; }
        });
        state.characters = state.characters.filter(c => c.id !== change.doc.id);
        if (state.activeCharId === change.doc.id)
          state.activeCharId = state.characters.length ? state.characters[0].id : null;
      }
    });

    snapshot.docs.forEach(charDoc => {
      const meta     = { id: charDoc.id, ...charDoc.data() };
      const existing = state.characters.find(c => c.id === charDoc.id);
      if (existing) Object.assign(existing, meta);
      else state.characters.push({ ...meta, posts: [], writings: [] });

      // posts 구독
      const postsKey = charDoc.id + '_posts';
      if (!unsubMap[postsKey]) {
        unsubMap[postsKey] = db.collection('characters').doc(charDoc.id)
          .collection('posts').orderBy('createdAt','desc')
          .onSnapshot(snap => {
            const char = state.characters.find(c => c.id === charDoc.id);
            if (char) char.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            finishLoad();
          });
      }

      // writings 구독
      const writingsKey = charDoc.id + '_writings';
      if (!unsubMap[writingsKey]) {
        unsubMap[writingsKey] = db.collection('characters').doc(charDoc.id)
          .collection('writings').orderBy('createdAt','desc')
          .onSnapshot(snap => {
            const char = state.characters.find(c => c.id === charDoc.id);
            if (char) char.writings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            finishLoad();
          });
      }
    });

    if (snapshot.docs.length === 0) {
      state.characters  = [];
      state.loading     = false;
      state.activeCharId = null;
      render();
    }
  });
}

function finishLoad() {
  state.characters.sort((a,b) => (a.order??0) - (b.order??0));
  state.loading = false;
  if (!state.activeCharId && state.characters.length > 0)
    state.activeCharId = state.characters[0].id;
  render();
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
    for (const p of char.posts)    await fbDeletePost(charId, p.id, p.images || []);
    for (const w of char.writings) await fbDeleteWriting(charId, w.id);
  }
  return db.collection('characters').doc(charId).delete();
}

/* ══════════════════════════════
   FB CRUD — 게시물 (posts)
   images: [{ url, publicId }]
══════════════════════════════ */

async function fbAddPost(charId, title, date, desc, imageFiles) {
  const postId  = uid();
  const images  = [];

  for (const file of imageFiles) {
    const { url, publicId } = await uploadToCloudinary(file);
    images.push({ url, publicId });
  }

  await db.collection('characters').doc(charId).collection('posts').doc(postId).set({
    title, date, desc, images, createdAt: Date.now(),
  });
}

async function fbUpdatePost(charId, postId, title, date, desc, existingImages, newFiles) {
  const images = [...existingImages];
  for (const file of newFiles) {
    const { url, publicId } = await uploadToCloudinary(file);
    images.push({ url, publicId });
  }
  await db.collection('characters').doc(charId).collection('posts').doc(postId)
    .update({ title, date, desc, images });
}

async function fbDeletePost(charId, postId, images) {
  // Cloudinary 삭제는 서버 필요 — 일단 Firestore만 삭제
  await db.collection('characters').doc(charId).collection('posts').doc(postId).delete();
}

/* ══════════════════════════════
   FB CRUD — 글 (writings)
══════════════════════════════ */

function fbAddWriting(charId, title, date, body) {
  const id = uid();
  return db.collection('characters').doc(charId).collection('writings').doc(id).set({
    title, date, body, createdAt: Date.now(),
  });
}

function fbUpdateWriting(charId, writingId, title, date, body) {
  return db.collection('characters').doc(charId).collection('writings').doc(writingId)
    .update({ title, date, body });
}

function fbDeleteWriting(charId, writingId) {
  return db.collection('characters').doc(charId).collection('writings').doc(writingId).delete();
}

/* ══════════════════════════════
   CLOUDINARY 업로드
══════════════════════════════ */

async function uploadToCloudinary(file) {
  const sigRes = await fetch('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sign', folder: 'gallery' }),
  });
  const { signature, timestamp, apiKey, cloudName, folder } = await sigRes.json();

  const formData = new FormData();
  formData.append('file',      file);
  formData.append('folder',    folder);
  formData.append('timestamp', timestamp);
  formData.append('api_key',   apiKey);
  formData.append('signature', signature);

  const upRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST', body: formData,
  });
  if (!upRes.ok) throw new Error('Cloudinary 업로드 실패');
  const data = await upRes.json();
  return { url: data.secure_url, publicId: data.public_id };
}

/* ══════════════════════════════
   STARFIELD
══════════════════════════════ */

function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize(); window.addEventListener('resize', resize);

  const stars = Array.from({ length: 300 }, () => ({
    x: Math.random()*innerWidth, y: Math.random()*innerHeight,
    r: Math.random()*1.7+0.2,   a: Math.random(),
    da: (Math.random()*0.013+0.003)*(Math.random()<0.5?1:-1),
    color: ['#ffffff','#c8d8f0','#f5d67a','#d0b8ff','#a8d8ff'][Math.floor(Math.random()*5)],
  }));

  (function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    stars.forEach(s => {
      s.a = Math.max(0.05,Math.min(1,s.a+s.da));
      if (s.a<=0.05||s.a>=1) s.da*=-1;
      ctx.save(); ctx.globalAlpha=s.a; ctx.fillStyle=s.color;
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); ctx.restore();
    });
    requestAnimationFrame(draw);
  })();
}

function launchShootingStar() {
  const el = document.createElement('div'); el.className='shooting-star';
  const x=(Math.random()*innerWidth*0.82).toFixed(0);
  const dur=(1.8+Math.random()*1.3).toFixed(2);
  el.style.cssText=`left:${x}px;top:-24px;animation:shoot ${dur}s ease forwards`;
  document.body.appendChild(el); setTimeout(()=>el.remove(),+dur*1000);
}
setInterval(launchShootingStar,4800);

document.addEventListener('click', e => {
  if (e.target.closest('button,input,textarea,label,.tab-btn,.tab-add-btn,.subtab-btn,.sort-btn,.view-btn,.icon-btn,.card-action-btn,.add-post-btn,.writing-item-actions')) return;
  const syms=['✦','✧','⋆','★','✺','⊹','✵','·'];
  for(let i=0;i<6;i++){
    const el=document.createElement('div'); el.className='sparkle';
    const dx=(Math.random()-0.5)*65, dy=(Math.random()-0.5)*65;
    el.style.cssText=`left:${e.clientX}px;top:${e.clientY}px;--dx:${dx}px;--dy:${dy}px;animation-delay:${i*0.045}s`;
    el.textContent=syms[Math.floor(Math.random()*syms.length)];
    document.body.appendChild(el); setTimeout(()=>el.remove(),1050);
  }
});

/* ══════════════════════════════
   TOAST
══════════════════════════════ */

let toastTimer;
function showToast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast'+(type?` ${type}`:'');
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2800);
}

/* ══════════════════════════════
   HELPERS
══════════════════════════════ */

function uid(){ return 'id_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function todayStr(){
  const d=new Date();
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function sorted(arr){
  const a=[...arr];
  return state.sortOrder==='newest'
    ? a.sort((x,y)=>y.date.localeCompare(x.date))
    : a.sort((x,y)=>x.date.localeCompare(y.date));
}

/* ══════════════════════════════
   RENDER
══════════════════════════════ */

function renderLoading(){
  document.getElementById('tabsRow').innerHTML='';
  document.getElementById('subtabsRow').style.display='none';
  document.getElementById('galleryPanels').innerHTML=
    `<div class="empty-state"><div class="empty-icon" style="animation:star-pulse 1.5s ease-in-out infinite">✦</div><p class="empty-text">데이터를 불러오는 중...</p></div>`;
}

function renderTabs(){
  const row=document.getElementById('tabsRow');
  row.innerHTML='';
  state.characters.forEach(c=>{
    const btn=document.createElement('button');
    btn.className='tab-btn'+(c.id===state.activeCharId?' active':'');
    btn.innerHTML=`<span class="tab-emoji">${c.emoji}</span><span>${c.name}</span>`;
    btn.onclick=()=>{ state.activeCharId=c.id; render(); };
    row.appendChild(btn);
  });
  const addBtn=document.createElement('button');
  addBtn.className='tab-add-btn'; addBtn.innerHTML='＋ 캐릭터 추가';
  addBtn.onclick=()=>requirePassword('openAddChar');
  row.appendChild(addBtn);
}

function renderSubtabs(){
  const row=document.getElementById('subtabsRow');
  if (!state.activeCharId){ row.style.display='none'; return; }
  row.style.display='flex';
  document.getElementById('subtab-photos').classList.toggle('active', state.subtab==='photos');
  document.getElementById('subtab-writings').classList.toggle('active', state.subtab==='writings');
}

function setSubtab(tab){ state.subtab=tab; render(); }

function renderPanels(){
  const container=document.getElementById('galleryPanels');
  container.innerHTML='';
  if (!state.activeCharId) return;
  const c=state.characters.find(x=>x.id===state.activeCharId);
  if (!c) return;

  const panel=document.createElement('div');
  panel.innerHTML=buildCharInfoHTML(c);
  container.appendChild(panel);

  if (state.subtab==='photos') renderPhotosPanel(c, container);
  else                          renderWritingsPanel(c, container);
}

function buildCharInfoHTML(c){
  return `
    <div class="char-info-bar">
      <div class="char-avatar">${c.emoji}</div>
      <div class="char-meta">
        <div class="char-name">${c.name}</div>
        <div class="char-desc">${c.desc||'<em>소개가 없습니다</em>'}</div>
      </div>
      <div class="char-stat">
        <div class="char-stat-n">${(c.posts||[]).length}</div>
        <div class="char-stat-l">게시물</div>
      </div>
      <div class="char-stat">
        <div class="char-stat-n">${(c.writings||[]).length}</div>
        <div class="char-stat-l">글</div>
      </div>
      <div class="char-actions">
        <div class="icon-btn" title="캐릭터 수정"  onclick="requirePassword('openEditChar','${c.id}')">✏️</div>
        <div class="icon-btn danger" title="캐릭터 삭제" onclick="requirePassword('confirmDeleteChar','${c.id}')">🗑️</div>
      </div>
    </div>`;
}

/* ── 사진 탭 ── */
function renderPhotosPanel(c, container){
  const posts = sorted(c.posts||[]);
  const wrap  = document.createElement('div');

  // 정렬 컨트롤
  wrap.innerHTML = `
    <div class="controls-bar">
      <div class="sort-group">
        <button class="sort-btn${state.sortOrder==='newest'?' active':''}" onclick="setSortOrder('newest')">최신순 ↓</button>
        <button class="sort-btn${state.sortOrder==='oldest'?' active':''}" onclick="setSortOrder('oldest')">오래된순 ↑</button>
      </div>
      <span class="photo-count">${posts.length}개의 게시물</span>
    </div>
    <button class="add-post-btn" onclick="requirePassword('openAddPost','${c.id}')">＋ 사진 게시물 추가</button>
    <div class="post-grid" id="postGrid"></div>`;

  container.appendChild(wrap);

  const grid = wrap.querySelector('#postGrid');
  if (posts.length===0){
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🌌</div><p class="empty-text">아직 게시물이 없어요</p></div>`;
  } else {
    posts.forEach((p,i)=>{
      const card=document.createElement('div');
      card.className='post-card';
      card.style.animationDelay=i*0.055+'s';
      const thumb=(p.images&&p.images[0])?p.images[0].url:'';
      card.innerHTML=`
        ${thumb
          ?`<img class="post-thumb" src="${thumb}" alt="${p.title}" loading="lazy" />`
          :`<div class="post-thumb-placeholder">🌌</div>`}
        <div class="post-card-body">
          <div class="post-card-title">${p.title||'(제목 없음)'}</div>
          <div class="post-card-meta">${p.date||''}${p.images&&p.images.length>1?` · 📷 ${p.images.length}장`:''}</div>
          <div class="post-card-desc">${p.desc||''}</div>
        </div>
        <div class="post-card-actions">
          <div class="icon-btn" onclick="event.stopPropagation();requirePassword('openEditPost','${c.id}','${p.id}')">✏️</div>
          <div class="icon-btn danger" onclick="event.stopPropagation();requirePassword('confirmDeletePost','${c.id}','${p.id}')">🗑️</div>
        </div>`;
      card.onclick=()=>openPostDetail(c.id, p.id);
      grid.appendChild(card);
    });
  }
}

/* ── 글 탭 ── */
function renderWritingsPanel(c, container){
  const writings = sorted(c.writings||[]);
  const wrap=document.createElement('div');

  wrap.innerHTML=`
    <div class="controls-bar">
      <div class="sort-group">
        <button class="sort-btn${state.sortOrder==='newest'?' active':''}" onclick="setSortOrder('newest')">최신순 ↓</button>
        <button class="sort-btn${state.sortOrder==='oldest'?' active':''}" onclick="setSortOrder('oldest')">오래된순 ↑</button>
      </div>
      <span class="photo-count">${writings.length}편의 글</span>
    </div>
    <button class="add-post-btn" onclick="requirePassword('openAddWriting','${c.id}')">＋ 글 작성</button>
    <div class="writing-grid" id="writingGrid"></div>`;

  container.appendChild(wrap);

  const grid=wrap.querySelector('#writingGrid');
  if (writings.length===0){
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">✍️</div><p class="empty-text">아직 글이 없어요</p></div>`;
  } else {
    writings.forEach((w,i)=>{
      const card=document.createElement('div');
      card.className='writing-card';
      card.style.animationDelay=i*0.055+'s';
      const preview=(w.body||'').slice(0,100).replace(/\n/g,' ');
      card.innerHTML=`
        <div class="writing-card-inner">
          <div class="writing-card-title">${w.title||'(제목 없음)'}</div>
          <div class="writing-card-date">${w.date||''}</div>
          <div class="writing-card-preview">${preview}${(w.body||'').length>100?'…':''}</div>
        </div>
        <div class="writing-card-actions">
          <div class="icon-btn" onclick="event.stopPropagation();requirePassword('openEditWriting','${c.id}','${w.id}')">✏️</div>
          <div class="icon-btn danger" onclick="event.stopPropagation();requirePassword('confirmDeleteWriting','${c.id}','${w.id}')">🗑️</div>
        </div>`;
      card.onclick=e=>{ if(!e.target.closest('.writing-card-actions')) openWritingDetail(c.id,w.id); };
      grid.appendChild(card);
    });
  }
}

function render(){
  if (state.loading){ renderLoading(); return; }
  renderTabs();
  renderSubtabs();
  renderPanels();
}

function setSortOrder(o){ state.sortOrder=o; render(); }

/* ══════════════════════════════
   게시물 상세 (슬라이더)
══════════════════════════════ */

function openPostDetail(charId, postId){
  const char=state.characters.find(c=>c.id===charId);
  const post=char?.posts.find(p=>p.id===postId);
  if (!post) return;
  state.postDetail={ charId, postId, post, imgIndex:0 };
  renderPostDetail();
  const pd=document.getElementById('postDetail');
  pd.classList.add('open');
}

function renderPostDetail(){
  const { post, imgIndex, charId, postId } = state.postDetail;
  const images=post.images||[];
  const img=images[imgIndex];

  document.getElementById('pdTitle').textContent = post.title||'';
  document.getElementById('pdDate').textContent  = post.date||'';
  document.getElementById('pdDesc').textContent  = post.desc||'';
  document.getElementById('pdDesc').style.display = post.desc?'':'none';

  const imgEl=document.getElementById('pdImg');
  if (img){ imgEl.src=img.url; imgEl.style.display=''; } else { imgEl.style.display='none'; }

  document.getElementById('pdCounter').textContent = images.length>1?`${imgIndex+1} / ${images.length}`:'';
  document.getElementById('pdPrev').style.display = images.length>1?'':'none';
  document.getElementById('pdNext').style.display = images.length>1?'':'none';
}

function postDetailNav(dir){
  const images=state.postDetail.post.images||[];
  state.postDetail.imgIndex=((state.postDetail.imgIndex+dir)%images.length+images.length)%images.length;
  renderPostDetail();
}

function closePostDetail(){
  document.getElementById('postDetail').classList.remove('open');
  state.postDetail=null;
}

// 터치 스와이프
(function(){
  let tx=0,ty=0;
  const pd=document.getElementById('postDetail');
  pd.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;},{passive:true});
  pd.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>50) postDetailNav(dx<0?1:-1);
  },{passive:true});
})();

document.addEventListener('keydown',e=>{
  if (document.getElementById('postDetail').classList.contains('open')){
    if(e.key==='Escape') closePostDetail();
    else if(e.key==='ArrowLeft')  postDetailNav(-1);
    else if(e.key==='ArrowRight') postDetailNav(1);
  }
});

/* ══════════════════════════════
   글 상세
══════════════════════════════ */

function openWritingDetail(charId, writingId){
  const char=state.characters.find(c=>c.id===charId);
  const w=char?.writings.find(x=>x.id===writingId);
  if (!w) return;
  state.writingDetail={ charId, writingId, writing:w };
  document.getElementById('wdTitle').textContent=w.title||'';
  document.getElementById('wdDate').textContent=w.date||'';
  document.getElementById('wdBody').textContent=w.body||'';
  document.getElementById('writingDetailModal').classList.add('open');
}

function closeWritingDetailModal(){
  document.getElementById('writingDetailModal').classList.remove('open');
  state.writingDetail=null;
}

function editWritingFromDetail(){
  if (!state.writingDetail) return;
  const { charId, writingId } = state.writingDetail;
  closeWritingDetailModal();
  requirePassword('openEditWriting', charId, writingId);
}

function deleteWritingFromDetail(){
  if (!state.writingDetail) return;
  const { charId, writingId } = state.writingDetail;
  closeWritingDetailModal();
  requirePassword('confirmDeleteWriting', charId, writingId);
}

/* ══════════════════════════════
   PASSWORD GATE
══════════════════════════════ */

function requirePassword(type, charId, id2, extra){
  state.pendingAction={ type, charId:charId||null, id2:id2||null, extra:extra||null };
  document.getElementById('pwInput').value='';
  document.getElementById('pwError').textContent='';
  document.getElementById('pwGate').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('pwInput').focus());
}

async function submitPassword(){
  const val=document.getElementById('pwInput').value; if(!val) return;
  const pwError=document.getElementById('pwError');
  pwError.textContent='';
  try {
    const res=await fetch('/verify',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:val}),
    });
    const {ok}=await res.json();
    if(ok){
      const action=state.pendingAction; state.pendingAction=null;
      closePwGate(); executeAction(action);
    } else {
      pwError.textContent='⚠ 비밀번호가 올바르지 않습니다';
      document.getElementById('pwInput').value=''; document.getElementById('pwInput').focus();
    }
  } catch { pwError.textContent='⚠ 네트워크 오류'; }
}

function closePwGate(){ document.getElementById('pwGate').classList.remove('open'); }

document.getElementById('pwInput').addEventListener('keydown',e=>{
  if(e.key==='Enter') submitPassword();
  if(e.key==='Escape') closePwGate();
});

/* ══════════════════════════════
   ACTION DISPATCHER
══════════════════════════════ */

function executeAction(action){
  if(!action) return;
  const {type,charId,id2}=action;
  switch(type){
    case 'openAddChar':         openAddCharModal(); break;
    case 'openEditChar':        openEditCharModal(charId); break;
    case 'confirmDeleteChar':   openConfirm('캐릭터를 삭제할까요?<br>모든 게시물과 글도 삭제됩니다.',()=>doDeleteChar(charId)); break;
    case 'openAddPost':         openPostModal(charId,null); break;
    case 'openEditPost':        openPostModal(charId,id2); break;
    case 'confirmDeletePost':   openConfirm('이 게시물을 삭제할까요?',()=>doDeletePost(charId,id2)); break;
    case 'openAddWriting':      openWritingModal(charId,null); break;
    case 'openEditWriting':     openWritingModal(charId,id2); break;
    case 'confirmDeleteWriting':openConfirm('이 글을 삭제할까요?',()=>doDeleteWriting(charId,id2)); break;
  }
}

/* ══════════════════════════════
   CHARACTER MODALS
══════════════════════════════ */

function openAddCharModal(){
  state.selectedEmoji=EMOJIS[0];
  document.getElementById('newCharName').value='';
  document.getElementById('newCharDesc').value='';
  buildEmojiPicker('addEmojiPicker',()=>{});
  document.getElementById('addCharModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('newCharName').focus());
}
function closeAddCharModal(){ document.getElementById('addCharModal').classList.remove('open'); }

async function submitAddChar(){
  const name=document.getElementById('newCharName').value.trim(); if(!name) return;
  const desc=document.getElementById('newCharDesc').value.trim();
  closeAddCharModal();
  try{
    const id=await fbAddChar(name,desc,state.selectedEmoji);
    state.activeCharId=id; showToast('✨ 캐릭터가 추가되었습니다','success');
  }catch(e){console.error(e);showToast('❌ 저장 실패','error');}
}

function openEditCharModal(charId){
  const c=state.characters.find(x=>x.id===charId); if(!c) return;
  state.selectedEmoji=c.emoji;
  document.getElementById('editCharId').value=charId;
  document.getElementById('editCharName').value=c.name;
  document.getElementById('editCharDesc').value=c.desc;
  buildEmojiPicker('editEmojiPicker',()=>{},c.emoji);
  document.getElementById('editCharModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('editCharName').focus());
}
function closeEditCharModal(){ document.getElementById('editCharModal').classList.remove('open'); }

async function submitEditChar(){
  const charId=document.getElementById('editCharId').value;
  const name=document.getElementById('editCharName').value.trim(); if(!name) return;
  const desc=document.getElementById('editCharDesc').value.trim();
  closeEditCharModal();
  try{ await fbUpdateChar(charId,name,desc,state.selectedEmoji); showToast('✏️ 캐릭터가 수정되었습니다','success'); }
  catch(e){console.error(e);showToast('❌ 저장 실패','error');}
}

async function doDeleteChar(charId){
  try{ await fbDeleteChar(charId); showToast('🗑️ 캐릭터가 삭제되었습니다'); }
  catch(e){console.error(e);showToast('❌ 삭제 실패','error');}
}

/* ══════════════════════════════
   POST MODAL (사진 게시물)
══════════════════════════════ */

function openPostModal(charId, postId){
  state.pendingImages=[];
  const post = postId ? state.characters.find(c=>c.id===charId)?.posts.find(p=>p.id===postId) : null;

  document.getElementById('postCharId').value = charId;
  document.getElementById('postId').value     = postId||'';
  document.getElementById('postModalTitle').textContent = post ? '🖼️ 게시물 수정' : '🖼️ 사진 게시물 추가';
  document.getElementById('postTitle').value  = post?.title||'';
  document.getElementById('postDate').value   = post?.date||todayStr();
  document.getElementById('postDesc').value   = post?.desc||'';

  // 기존 이미지 미리보기
  state.editingPostImages = post ? [...(post.images||[])] : [];
  renderPostImgPreview();

  document.getElementById('postImages').value='';
  document.getElementById('postModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('postTitle').focus());
}

function closePostModal(){
  document.getElementById('postModal').classList.remove('open');
  state.pendingImages=[];
  state.editingPostImages=[];
}

// 파일 선택 시 미리보기 추가
document.getElementById('postImages').addEventListener('change', function(){
  Array.from(this.files).forEach(file=>{
    if(!file.type.startsWith('image/')) return;
    const reader=new FileReader();
    reader.onload=e=>{ state.pendingImages.push({file,dataUrl:e.target.result}); renderPostImgPreview(); };
    reader.readAsDataURL(file);
  });
  this.value='';
});

function renderPostImgPreview(){
  const wrap=document.getElementById('postImgPreview');
  wrap.innerHTML='';
  // 기존 이미지
  state.editingPostImages.forEach((img,i)=>{
    const item=document.createElement('div'); item.className='post-img-preview-item';
    item.innerHTML=`<img src="${img.url}" /><button class="post-img-preview-del" onclick="removeExistingImg(${i})">✕</button>`;
    wrap.appendChild(item);
  });
  // 새 이미지
  state.pendingImages.forEach((p,i)=>{
    const item=document.createElement('div'); item.className='post-img-preview-item';
    item.innerHTML=`<img src="${p.dataUrl}" /><button class="post-img-preview-del" onclick="removeNewImg(${i})">✕</button>`;
    wrap.appendChild(item);
  });
}

function removeExistingImg(i){ state.editingPostImages.splice(i,1); renderPostImgPreview(); }
function removeNewImg(i){ state.pendingImages.splice(i,1); renderPostImgPreview(); }

async function submitPost(){
  const charId  = document.getElementById('postCharId').value;
  const postId  = document.getElementById('postId').value;
  const title   = document.getElementById('postTitle').value.trim();
  const date    = document.getElementById('postDate').value.trim()||todayStr();
  const desc    = document.getElementById('postDesc').value.trim();
  const newFiles= state.pendingImages.map(p=>p.file);

  if (!title){ document.getElementById('postTitle').focus(); return; }
  closePostModal();
  showToast('⏳ 저장 중...','');

  try{
    if(postId){
      await fbUpdatePost(charId,postId,title,date,desc,state.editingPostImages,newFiles);
      showToast('✏️ 게시물이 수정되었습니다','success');
    } else {
      await fbAddPost(charId,title,date,desc,newFiles);
      showToast('📸 게시물이 추가되었습니다','success');
    }
  }catch(e){console.error(e);showToast('❌ 저장 실패','error');}
}

async function doDeletePost(charId, postId){
  const char=state.characters.find(c=>c.id===charId);
  const post=char?.posts.find(p=>p.id===postId);
  try{ await fbDeletePost(charId,postId,post?.images||[]); showToast('🗑️ 게시물이 삭제되었습니다'); }
  catch(e){console.error(e);showToast('❌ 삭제 실패','error');}
}

/* ══════════════════════════════
   WRITING MODAL
══════════════════════════════ */

function openWritingModal(charId, writingId){
  const writing = writingId ? state.characters.find(c=>c.id===charId)?.writings.find(w=>w.id===writingId) : null;
  document.getElementById('writingCharId').value   = charId;
  document.getElementById('writingId').value       = writingId||'';
  document.getElementById('writingModalTitle').textContent = writing ? '✍️ 글 수정' : '✍️ 글 작성';
  document.getElementById('writingTitle').value    = writing?.title||'';
  document.getElementById('writingDate').value     = writing?.date||todayStr();
  document.getElementById('writingBody').value     = writing?.body||'';
  document.getElementById('writingModal').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('writingTitle').focus());
}
function closeWritingModal(){ document.getElementById('writingModal').classList.remove('open'); }

async function submitWriting(){
  const charId    = document.getElementById('writingCharId').value;
  const writingId = document.getElementById('writingId').value;
  const title     = document.getElementById('writingTitle').value.trim();
  const date      = document.getElementById('writingDate').value.trim()||todayStr();
  const body      = document.getElementById('writingBody').value.trim();
  if(!title){ document.getElementById('writingTitle').focus(); return; }
  closeWritingModal();
  try{
    if(writingId){
      await fbUpdateWriting(charId,writingId,title,date,body);
      showToast('✏️ 글이 수정되었습니다','success');
    } else {
      await fbAddWriting(charId,title,date,body);
      showToast('✍️ 글이 등록되었습니다','success');
    }
  }catch(e){console.error(e);showToast('❌ 저장 실패','error');}
}

async function doDeleteWriting(charId, writingId){
  try{ await fbDeleteWriting(charId,writingId); showToast('🗑️ 글이 삭제되었습니다'); }
  catch(e){console.error(e);showToast('❌ 삭제 실패','error');}
}

/* ══════════════════════════════
   CONFIRM
══════════════════════════════ */

let confirmCallback=null;
function openConfirm(msg,cb){ confirmCallback=cb; document.getElementById('confirmMsg').innerHTML=msg; document.getElementById('confirmModal').classList.add('open'); }
function closeConfirm(){ document.getElementById('confirmModal').classList.remove('open'); confirmCallback=null; }
function submitConfirm(){ const cb=confirmCallback; closeConfirm(); if(cb) cb(); }

/* ══════════════════════════════
   EMOJI PICKER
══════════════════════════════ */

function buildEmojiPicker(containerId, onChange, initial){
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const selected = initial || state.selectedEmoji;

  // 직접 입력 칸
  const inputWrap = document.createElement('div');
  inputWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;width:100%';
  inputWrap.innerHTML = `
    <input id="${containerId}_custom" type="text" placeholder="이모지 직접 입력 (예: 🐱)"
      style="flex:1;padding:8px 12px;background:rgba(8,4,24,0.75);border:1px solid rgba(180,150,255,0.28);
             border-radius:10px;color:#e8eeff;font-size:1.1rem;outline:none;font-family:inherit"
      maxlength="4" />
    <button onclick="applyCustomEmoji('${containerId}')"
      style="padding:8px 14px;border-radius:10px;background:linear-gradient(135deg,#7030d8,#2e5ec8);
             border:none;color:white;cursor:pointer;font-size:0.82rem;font-family:inherit;flex-shrink:0">
      적용
    </button>`;
  container.appendChild(inputWrap);

  // 기본 이모지 목록
  const grid = document.createElement('div');
  grid.className = 'emoji-picker';
  EMOJIS.forEach(em => {
    const opt = document.createElement('div');
    opt.className = 'emoji-opt' + (em === selected ? ' selected' : '');
    opt.textContent = em;
    opt.onclick = () => {
      state.selectedEmoji = em;
      grid.querySelectorAll('.emoji-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById(containerId + '_custom').value = '';
      onChange(em);
    };
    grid.appendChild(opt);
  });
  container.appendChild(grid);
  state.selectedEmoji = selected;
}

function applyCustomEmoji(containerId) {
  const input = document.getElementById(containerId + '_custom');
  const val   = input.value.trim();
  if (!val) return;
  // 이모지만 허용 (문자가 있으면 첫 글자만)
  const em = [...val][0];
  if (!em) return;
  state.selectedEmoji = em;
  // 기존 선택 해제
  document.querySelectorAll(`#${containerId} .emoji-opt`).forEach(o => o.classList.remove('selected'));
  showToast(`${em} 선택됨`, 'success');
}

function togglePw(inputId,btnId){
  const inp=document.getElementById(inputId),btn=document.getElementById(btnId);
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈';}
  else{inp.type='password';btn.textContent='👁️';}
}

['addCharModal','editCharModal','postModal','writingModal','writingDetailModal','confirmModal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',e=>{
    if(e.target===document.getElementById(id)) document.getElementById(id).classList.remove('open');
  });
});

/* ══════════════════════════════
   WINDOW 전역 노출
══════════════════════════════ */

Object.assign(window,{
  requirePassword,
  submitPassword, closePwGate, togglePw,
  setSubtab, setSortOrder,
  closePostDetail, postDetailNav,
  closeWritingDetailModal, editWritingFromDetail, deleteWritingFromDetail,
  closeAddCharModal, submitAddChar,
  closeEditCharModal, submitEditChar,
  closePostModal, submitPost,
  removeExistingImg, removeNewImg,
  closeWritingModal, submitWriting,
  closeConfirm, submitConfirm,
  applyCustomEmoji,
});

/* ══════════════════════════════
   INIT
══════════════════════════════ */

initStarfield();
renderLoading();
initFirestore();