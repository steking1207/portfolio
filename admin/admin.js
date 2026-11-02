/* SK2 作品管理 — edits data/works.json and publishes to GitHub in one commit.
   Runs entirely in the browser; the token never leaves this machine except to api.github.com. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
};
const thumbOf = (img) => img.thumb || img.src.replace(/\.(webp|jpe?g|png)$/i, '-t.$1');
const DATA_PATH = 'data/works.json';
const FRAMES = [['browser', '瀏覽器框'], ['phone', '手機框'], ['none', '無外框']];
// Same fallback the site uses for images saved before frames were chosen by hand.
function autoFrame(w, im) {
  if (w.category === 'graphic') return 'none';
  if (im.h / im.w >= 1.3 && im.w <= 1100) return 'phone';
  return w.category === 'app' || im.w < 700 ? 'none' : 'browser';
}
const frameOf = (w, im) => (FRAMES.some(([v]) => v === im.frame) ? im.frame : autoFrame(w, im));
// Default for a new upload. Phone screens are roughly 16:9 to 20:9; full-page website captures are
// usually much taller or wider, so they get the browser frame. Always changeable per image.
function guessFrame(w, W, H) {
  if (w.category === 'graphic') return 'none';
  const r = H / W;
  if (w.category === 'app') return r >= 1.3 ? 'phone' : 'none';
  return r >= 1.7 && r <= 2.3 && W <= 1300 ? 'phone' : 'browser';
}
// Every role/tag already used on any work, most used first, so they can be picked instead of typed.
function vocab(key) {
  const n = new Map();
  (state.data.works || []).forEach((x) => (x[key] || []).forEach((v) => n.set(v, (n.get(v) || 0) + 1)));
  return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b, 'zh-Hant'));
}
function pickerHTML(w, key, label, placeholder) {
  const cur = w[key] || [];
  const all = [...new Set([...vocab(key), ...cur])];
  return `<div class="field"><span>${label}<small class="hint">（點選套用，再點一次取消）</small></span><div class="picks" data-picks="${key}">
    ${all.map((v) => `<button type="button" class="pick ${cur.includes(v) ? 'is-on' : ''}" data-pick="${esc(v)}" aria-pressed="${cur.includes(v)}">${esc(v)}</button>`).join('')}
    <input class="pick-add" data-pick-add="${key}" placeholder="${placeholder}" aria-label="新增${label}">
  </div></div>`;
}
const STATUS = [['', '不標示（已下線或無網址）'], ['live', '上線中（網站仍是這個設計）'], ['redesigned', '已改版（網站還在，設計已換）']];

const state = {
  data: null, original: null, sha: null, selected: null, q: '', fcat: '', fyear: '',
  pending: new Map(), // repo path -> { blob, url }
  dirty: false,
};

/* ---------------- settings ---------------- */
function defaults() {
  const host = location.hostname; const parts = location.pathname.split('/').filter(Boolean);
  const owner = host.endsWith('.github.io') ? host.replace('.github.io', '') : 'steking1207';
  const repo = host.endsWith('.github.io') && parts[0] && parts[0] !== 'admin' ? parts[0] : 'portfolio';
  return { owner, repo, branch: 'master', token: '' };
}
// Token lives in sessionStorage (cleared when the browser closes) unless the user ticks "remember".
const SS = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* noop */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* noop */ } },
};
function getToken() { return SS.get('sk2:token') || LS.get('sk2:token') || ''; }
function setToken(t, remember) { SS.del('sk2:token'); LS.del('sk2:token'); if (t) (remember ? LS : SS).set('sk2:token', t); }
function settings() {
  let s = {};
  try { s = JSON.parse(LS.get('sk2:gh') || '{}'); } catch (e) { s = {}; }
  if (s.token) { setToken(s.token, true); delete s.token; LS.set('sk2:gh', JSON.stringify(s)); } // migrate old storage
  return { ...defaults(), ...s, token: getToken() };
}
function saveSettings(s) { const { token, ...rest } = s; LS.set('sk2:gh', JSON.stringify(rest)); }
function logout() {
  if (state.dirty && !confirm('有未發佈的變更，登出後只會保留文字草稿。確定登出？')) return;
  setToken(''); location.reload();
}

/* Only someone whose token can push to this repo gets in. */
async function verifyAccess() {
  const s = settings();
  if (!s.token) return { ok: false };
  try {
    const repo = await gh('');
    if (!repo.permissions || !repo.permissions.push) return { ok: false, msg: '這組權杖沒有這個 repo 的寫入權限。' };
    return { ok: true };
  } catch (err) { return { ok: false, msg: err.message }; }
}

function showLogin(msg = '') {
  const s = settings();
  const el = $('[data-login]'); el.hidden = false;
  document.body.classList.add('is-locked');
  const f = $('[data-login-form]');
  f.elements.owner.value = s.owner; f.elements.repo.value = s.repo; f.elements.branch.value = s.branch;
  const q = new URLSearchParams({ name: `SK2 ${s.repo} admin`, description: 'SK2 作品集後台', target_name: s.owner, expires_in: '366', contents: 'write' });
  $('[data-token-link]').href = `https://github.com/settings/personal-access-tokens/new?${q}`;
  $('[data-login-error]').textContent = msg; $('[data-login-error]').hidden = !msg;
  setTimeout(() => f.elements.token.focus(), 50);
  return new Promise((resolve) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type="submit"]', f); btn.disabled = true; btn.textContent = '驗證中…';
      saveSettings({ owner: f.elements.owner.value.trim(), repo: f.elements.repo.value.trim(), branch: f.elements.branch.value.trim() });
      setToken(f.elements.token.value.trim(), f.elements.remember.checked);
      const r = await verifyAccess();
      btn.disabled = false; btn.textContent = '進入後台';
      if (r.ok) { el.hidden = true; document.body.classList.remove('is-locked'); f.elements.token.value = ''; resolve(); }
      else { setToken(''); $('[data-login-error]').textContent = r.msg || '權杖無效。'; $('[data-login-error]').hidden = false; }
    });
  });
}

/* Admin appearance: light / dark / system */
function applyAdminTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
  $$('[data-admin-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.adminTheme === (mode || 'system'))));
}

/* ---------------- GitHub API ---------------- */
async function gh(path, opts = {}) {
  const s = settings();
  const res = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}${path}`, {
    cache: 'no-store',
    ...opts,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg += ` ${j.message || ''}`; } catch (e) { /* noop */ }
    if (res.status === 401) msg = '權杖無效或已過期，請重新輸入。';
    if (res.status === 403 || res.status === 404) msg += '（請確認權杖有這個 repo 的 Contents: Read and write 權限）';
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
const b64FromText = (text) => { const bytes = new TextEncoder().encode(text); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const textFromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64FromBlob = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

// Always read works.json pinned to the branch's current commit, never a cached copy:
// a stale read would make the next publish silently revert earlier changes.
async function loadRemote() {
  const s = settings();
  const ref = await gh(`/git/ref/heads/${encodeURIComponent(s.branch)}?t=${Date.now()}`);
  const head = ref.object.sha;
  const j = await gh(`/contents/${DATA_PATH}?ref=${head}`);
  return { data: JSON.parse(textFromB64(j.content)), sha: j.sha, head };
}

async function publish() {
  const s = settings();
  if (!s.token) { logout(); return; }
  const problems = validate();
  if (problems.length) { toast(problems[0], 'error'); return; }
  const btn = $('[data-publish]'); btn.disabled = true; btn.textContent = '發佈中…';
  try {
    // conflict check against the branch's real current commit
    const ref = await gh(`/git/ref/heads/${encodeURIComponent(s.branch)}?t=${Date.now()}`);
    if (state.head && ref.object.sha !== state.head) {
      const remote = await gh(`/contents/${DATA_PATH}?ref=${ref.object.sha}`);
      if (remote.sha !== state.sha && !confirm('GitHub 上的作品資料在你載入後被別處改過（例如另一個分頁或另一台電腦）。\n按「確定」用目前畫面的版本覆蓋；按「取消」先不發佈，可重新整理載入最新版本。')) return;
    }
    const baseCommit = await gh(`/git/commits/${ref.object.sha}`);
    const tree = [];
    // new images were named after the work's id at upload time; move them under its final id
    state.data.works.forEach((w) => (w.images || []).forEach((im) => {
      const dir = `images/works/${w.id}/`;
      [['src', im.src], ['thumb', thumbOf(im)]].forEach(([k, path]) => {
        if (!state.pending.has(path) || path.startsWith(dir)) return;
        const to = dir + path.split('/').pop();
        state.pending.set(to, state.pending.get(path)); state.pending.delete(path); im[k] = to;
      });
    }));
    const used = referencedPaths(state.data);
    let n = 0;
    for (const [path, p] of state.pending) {
      if (!used.has(path)) continue;
      n += 1; btn.textContent = `上傳圖片 ${n}…`;
      const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: await b64FromBlob(p.blob), encoding: 'base64' }) });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const removed = [...referencedPaths(state.original)].filter((p) => !used.has(p) && p.startsWith('images/works/'));
    removed.forEach((path) => tree.push({ path, mode: '100644', type: 'blob', sha: null }));
    const json = `${JSON.stringify(cleanData(state.data), null, 2)}\n`;
    const dataBlob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64FromText(json), encoding: 'base64' }) });
    tree.push({ path: DATA_PATH, mode: '100644', type: 'blob', sha: dataBlob.sha });
    btn.textContent = '建立 commit…';
    const newTree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) });
    const summary = summarize();
    const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: `更新作品集：${summary}`, tree: newTree.sha, parents: [ref.object.sha] }) });
    await gh(`/git/refs/heads/${encodeURIComponent(s.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    // refresh baseline
    state.head = commit.sha;
    state.sha = dataBlob.sha;
    state.original = clone(state.data);
    state.pending.forEach((p) => URL.revokeObjectURL(p.url));
    state.pending.clear();
    setDirty(false);
    renderList(); if (state.selected) renderEditor();
    toast(`已發佈（${summary}）。GitHub Pages 約 1 分鐘後更新。`, 'ok');
  } catch (err) {
    toast(`發佈失敗：${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '發佈到 GitHub';
  }
}

/* ---------------- data helpers ---------------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
function referencedPaths(data) {
  const set = new Set();
  (data.works || []).forEach((w) => (w.images || []).forEach((im) => { set.add(im.src); set.add(thumbOf(im)); }));
  return set;
}
function cleanData(d) {
  const out = clone(d);
  out.works.forEach((w) => { delete w._new; });
  return out;
}
function summarize() {
  const a = new Map(state.original.works.map((w) => [w.id, w]));
  const b = new Map(state.data.works.map((w) => [w.id, w]));
  const added = [...b.keys()].filter((k) => !a.has(k)).length;
  const removed = [...a.keys()].filter((k) => !b.has(k)).length;
  const edited = [...b.keys()].filter((k) => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).length;
  const parts = [];
  if (added) parts.push(`新增 ${added} 件`);
  if (edited) parts.push(`修改 ${edited} 件`);
  if (removed) parts.push(`刪除 ${removed} 件`);
  if (JSON.stringify(state.original.site) !== JSON.stringify(state.data.site) || JSON.stringify(state.original.categories) !== JSON.stringify(state.data.categories)) parts.push('網站資訊');
  if (JSON.stringify(state.original.featured) !== JSON.stringify(state.data.featured)) parts.push('精選');
  return parts.join('、') || '資料整理';
}
function validate() {
  const ids = new Set(); const out = [];
  state.data.works.forEach((w) => {
    if (!w.title) out.push('有作品沒有標題。');
    if (!/^[a-z0-9-]+$/.test(w.id)) out.push(`作品「${w.title}」的代號只能用小寫英文、數字和 -。`);
    if (ids.has(w.id)) out.push(`作品代號重複：${w.id}`);
    ids.add(w.id);
    if (!w.year || w.year < 1990 || w.year > 2100) out.push(`作品「${w.title}」的年份不正確。`);
    if (w.status && !w.url) out.push(`作品「${w.title}」標了${w.status === 'live' ? '上線中' : '已改版'}，但沒有填網址。`);
    (w.sites || []).forEach((st) => {
      if (!st.name) out.push(`作品「${w.title}」有一個其他網站沒有填名稱。`);
      if (st.status && !st.url) out.push(`作品「${w.title}」的「${st.name}」標了${st.status === 'live' ? '上線中' : '已改版'}，但沒有填網址。`);
    });
  });
  return out;
}
function slugify(title, year) {
  const ascii = title.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  let base = `${year}-${ascii || 'work'}`; let id = base; let i = 2;
  while (state.data.works.some((w) => w.id === id && w !== state.selectedWork)) { id = `${base}-${i}`; i += 1; }
  return id;
}
function setDirty(v = true) {
  state.dirty = v; $('[data-dirty]').hidden = !v;
  if (v) LS.set('sk2:admin-draft', JSON.stringify({ data: cleanData(state.data), sha: state.sha, at: Date.now() }));
  else LS.del('sk2:admin-draft');
}
const imgURL = (path) => (state.pending.get(path) || {}).url || `../${path}`;
const catName = (id) => (state.data.categories.find((c) => c.id === id) || {}).name || id;

/* ---------------- image processing ---------------- */
async function toImage(file) {
  if ('createImageBitmap' in window) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fallback */ } }
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
}
function canvasBlob(canvas, quality) {
  return new Promise((res) => canvas.toBlob((b) => {
    if (b && b.type === 'image/webp') res({ blob: b, ext: 'webp' });
    else canvas.toBlob((j) => res({ blob: j, ext: 'jpg' }), 'image/jpeg', 0.85);
  }, 'image/webp', quality));
}
// Scale the top sw×sh of the source to dw×dh. Halving in steps (instead of one big drawImage)
// avoids the blurry/jagged result browsers give when shrinking a very large image in one go.
function resample(src, sw, sh, dw, dh) {
  let cur = src; let cw = sw; let ch = sh;
  while (cw / 2 >= dw * 1.05) {
    const nw = Math.round(cw / 2); const nh = Math.round(ch / 2);
    const c = document.createElement('canvas'); c.width = nw; c.height = nh;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  const out = document.createElement('canvas'); out.width = dw; out.height = dh;
  const x = out.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, dw, dh);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, cw, ch, 0, 0, dw, dh);
  return out;
}
const MAX_W = 2000; // sharp on high-DPI screens at the site's widest image size
const MAX_AREA = 16e6; // Safari refuses canvases larger than ~16.7M pixels
async function processFile(file, dir, index, w) {
  const img = await toImage(file);
  const W = img.width; const H = img.height;
  // very tall captures get a narrower width rather than being cut off; crop only past that
  const fw = Math.min(W, MAX_W, Math.max(1000, Math.floor(Math.sqrt(MAX_AREA * W / H))));
  const fh = Math.min(Math.round(H * fw / W), Math.floor(MAX_AREA / fw));
  const full = await canvasBlob(resample(img, W, Math.round(fh * W / fw), fw, fh), 0.9);
  const tw = Math.min(760, W); const th = Math.min(Math.round(H * tw / W), Math.round(tw * 1.5));
  const thumb = await canvasBlob(resample(img, W, Math.round(th * W / tw), tw, th), 0.82);
  const stamp = `${Date.now().toString(36)}${index}`;
  const src = `${dir}/${stamp}.${full.ext}`; const tsrc = `${dir}/${stamp}-t.${thumb.ext}`;
  state.pending.set(src, { blob: full.blob, url: URL.createObjectURL(full.blob) });
  state.pending.set(tsrc, { blob: thumb.blob, url: URL.createObjectURL(thumb.blob) });
  return { src, thumb: tsrc, w: fw, h: fh, frame: guessFrame(w, W, H) };
}

/* ---------------- list ---------------- */
// Year filter lists only years that have works, newest first, with counts; rebuilt as works change.
function renderYearFilter() {
  const sel = $('[data-fyear]'); if (!sel) return;
  const n = {}; state.data.works.forEach((w) => { n[w.year] = (n[w.year] || 0) + 1; });
  if (state.fyear && !n[state.fyear]) state.fyear = '';
  sel.innerHTML = `<option value="">全部年份</option>${Object.keys(n).sort((a, b) => b - a).map((y) => `<option value="${y}" ${y === state.fyear ? 'selected' : ''}>${y}（${n[y]}）</option>`).join('')}`;
}
function renderList() {
  renderYearFilter();
  const q = state.q.toLowerCase();
  const items = state.data.works
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => (!state.fcat || w.category === state.fcat) && (!state.fyear || String(w.year) === state.fyear) && (!q || `${w.title} ${w.subtitle} ${w.year} ${w.id}`.toLowerCase().includes(q)))
    .sort((a, b) => b.w.year - a.w.year || a.i - b.i);
  const shown = state.data.works.filter((w) => !w.hidden).length;
  $('[data-count]').textContent = `共 ${state.data.works.length} 件・顯示中 ${shown} 件・下架 ${state.data.works.length - shown} 件`;
  $('[data-list]').innerHTML = items.map(({ w }) => {
    const im = (w.images || [])[0];
    const feat = (state.data.featured || []).includes(w.id);
    return `<li data-id="${esc(w.id)}" class="${state.selected === w.id ? 'is-active' : ''}">
      ${im ? `<img src="${esc(imgURL(thumbOf(im)))}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <div><div class="list__title">${esc(w.title || '（未命名）')}</div><div class="list__meta">${w.year} · ${esc(catName(w.category))}</div></div>
      <div class="list__flags">${w._new ? '<span class="flag flag--new">新</span>' : ''}${feat ? '<span class="flag flag--featured">精選</span>' : ''}${w.hidden ? '<span class="flag flag--hidden">下架</span>' : ''}</div>
    </li>`;
  }).join('');
}

/* ---------------- editor ---------------- */
function current() { return state.data.works.find((w) => w.id === state.selected); }

function renderEditor() {
  const w = current(); const el = $('[data-editor]');
  if (!w) { el.innerHTML = '<div class="empty">從左側選一件作品編輯，或按「新增作品」。</div>'; return; }
  state.selectedWork = w;
  const featIdx = (state.data.featured || []).indexOf(w.id);
  el.innerHTML = `
    <div class="ed-head"><h1>${esc(w.title || '新作品')}</h1>${w._new ? '' : `<a href="../#/work/${encodeURIComponent(w.id)}" target="_blank" rel="noopener">在網站上查看 ↗</a>`}</div>
    <div class="grid">
      <label class="field c4"><span>標題</span><input class="input" data-f="title" value="${esc(w.title)}" placeholder="例：今周刊 ESG 專題" required></label>
      <label class="field c2"><span>年份</span><input class="input" data-f="year" type="number" min="1990" max="2100" value="${w.year}"></label>
      <label class="field c4"><span>副標（一句話說明）</span><input class="input" data-f="subtitle" value="${esc(w.subtitle || '')}" placeholder="例：RWD 互動專題與測驗"></label>
      <label class="field c2"><span>分類</span><select class="input" data-f="category">${state.data.categories.map((c) => `<option value="${c.id}" ${c.id === w.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      ${pickerHTML(w, 'roles', '角色', '＋ 其他角色，按 Enter')}
      ${pickerHTML(w, 'tags', '標籤', '＋ 其他標籤，按 Enter')}
      <label class="field"><span>作品說明（選填）</span><textarea class="input" data-f="summary" placeholder="專案背景、你負責的部分、成果……">${esc(w.summary || '')}</textarea></label>
    </div>

    <div class="section"><h2>線上狀態</h2>
      <div class="grid">
        <label class="field c2"><span>狀態</span><select class="input" data-f="status">${STATUS.map(([v, l]) => `<option value="${v}" ${v === (w.status || '') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field c4"><span>網站網址（上線中／已改版時必填）</span><input class="input" data-f="url" type="url" value="${esc(w.url || '')}" placeholder="https://"></label>
        <label class="field"><span>Demo 網址（選填，自己架的可操作版本）</span><input class="input" data-f="demo" type="url" value="${esc(w.demo || '')}" placeholder="https://steking1207.github.io/..."></label>
      </div>
      <h3 class="sub">其他網站 <small class="hint">同一個專案還有產品網站、活動網站時加在這裡；上面的網址是主網站。圖片可在下方指定屬於哪個網站。</small></h3>
      <div class="sites">
        ${(w.sites || []).map((st) => `<div class="site-row">
          <input class="input" data-sf="${esc(st.key)}:name" value="${esc(st.name || '')}" placeholder="網站名稱，例：產品網站" aria-label="網站名稱">
          <select class="input" data-sf="${esc(st.key)}:status" aria-label="狀態">${STATUS.map(([v, l]) => `<option value="${v}" ${v === (st.status || '') ? 'selected' : ''}>${l.replace(/（.*）/, '')}</option>`).join('')}</select>
          <input class="input" data-sf="${esc(st.key)}:url" type="url" value="${esc(st.url || '')}" placeholder="https://" aria-label="網址">
          <button type="button" class="btn" data-site-del="${esc(st.key)}" aria-label="刪除這個網站">×</button>
        </div>`).join('')}
        <button type="button" class="btn" data-site-add>＋ 新增網站</button>
      </div>
    </div>

    <div class="section"><h2>顯示</h2>
      <div class="grid">
        <label class="check c3"><input type="checkbox" data-hidden ${w.hidden ? 'checked' : ''}> 下架（不在網站顯示）</label>
        <label class="check c3"><input type="checkbox" data-featured ${featIdx >= 0 ? 'checked' : ''}> 放在首頁精選 ${featIdx >= 0 ? `<input class="input" style="width:70px;height:32px;margin-left:auto" type="number" min="1" max="${state.data.featured.length}" value="${featIdx + 1}" data-feat-order aria-label="精選順序">` : ''}</label>
      </div>
    </div>

    <div class="section"><h2>圖片 <small class="hint">${(w.images || []).length} 張・第一張是封面・拖曳排序・每張可選外框</small></h2>
      <div class="images" data-images>
        ${(w.images || []).map((im, i) => `<div class="img" draggable="true" data-i="${i}"><div class="img__pic"><img src="${esc(imgURL(thumbOf(im)))}" alt=""><span class="img__no">${i + 1}</span><button type="button" class="img__del" data-del="${i}" aria-label="移除第 ${i + 1} 張">×</button><span class="img__move"><button type="button" data-mv="${i}:-1" aria-label="往前">←</button><button type="button" data-mv="${i}:1" aria-label="往後">→</button></span></div><select class="img__frame" data-frame="${i}" aria-label="第 ${i + 1} 張的外框" title="網站上顯示這張圖時的外框">${FRAMES.map(([v, l]) => `<option value="${v}" ${v === frameOf(w, im) ? 'selected' : ''}>${l}</option>`).join('')}</select>${(w.sites || []).length ? `<select class="img__frame" data-site="${i}" aria-label="第 ${i + 1} 張屬於哪個網站" title="這張圖屬於哪個網站"><option value="">主網站</option>${w.sites.map((st) => `<option value="${esc(st.key)}" ${st.key === im.site ? 'selected' : ''}>${esc(st.name || '未命名網站')}</option>`).join('')}</select>` : ''}</div>`).join('')}
        <label class="drop" data-drop><b>＋</b>拖曳圖片到這裡<br>或點擊選擇<input type="file" accept="image/*" multiple hidden data-file></label>
      </div>
      <p class="hint">上傳時會自動縮成網頁用尺寸（最寬 2000px）並產生縮圖，原檔不會上傳。</p>
    </div>

    <div class="section"><h2>進階</h2>
      <div class="grid"><label class="field c3"><span>作品代號（網址用，只能小寫英文、數字、-）</span><input class="input mono" data-f="id" value="${esc(w.id)}" ${w._new ? '' : 'readonly title="已發佈的作品代號固定，避免舊連結失效"'}></label></div>
    </div>

    <div class="danger-zone"><span class="hint">刪除後發佈，這件作品和它的圖片檔會從網站與 repo 移除。只想暫時隱藏請用「下架」。</span><button type="button" class="btn btn--danger" data-delete>刪除這件作品</button></div>`;
}

function onField(e) {
  const w = current(); if (!w) return;
  const f = e.target.dataset.f; if (!f) return;
  let v = e.target.value;
  if (f === 'year') v = parseInt(v, 10) || w.year;
  if (f === 'roles' || f === 'tags') v = v.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
  if (f === 'id') {
    v = v.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const old = w.id; const fi = state.data.featured.indexOf(old);
    if (fi >= 0) state.data.featured[fi] = v;
    state.selected = v;
  }
  w[f] = v;
  if (f === 'title' && w._new && e.type === 'change') { const id = slugify(w.title, w.year); const fi = state.data.featured.indexOf(w.id); if (fi >= 0) state.data.featured[fi] = id; w.id = id; state.selected = id; $('[data-f="id"]').value = id; }
  if (f === 'title') $('.ed-head h1').textContent = w.title || '新作品';
  setDirty(); renderList();
}

function moveImage(from, to) {
  const w = current(); const arr = w.images;
  if (to < 0 || to >= arr.length || from === to) return;
  const [it] = arr.splice(from, 1); arr.splice(to, 0, it);
  setDirty(); renderEditor(); renderList();
}

async function addFiles(files) {
  const w = current(); if (!w) return;
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  toast(`處理 ${list.length} 張圖片…`);
  w.images = w.images || [];
  for (let i = 0; i < list.length; i++) {
    try { w.images.push(await processFile(list[i], `images/works/${w.id}`, i, w)); } catch (e) { toast(`「${list[i].name}」無法讀取`, 'error'); }
  }
  setDirty(); renderEditor(); renderList(); toast(`已加入 ${list.length} 張圖片，記得按「發佈到 GitHub」。`);
}

function bindEditor() {
  const el = $('[data-editor]');
  el.addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-pick-add]'); if (!inp || e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const w = current(); const key = inp.dataset.pickAdd;
    const add = inp.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    if (!add.length) return;
    w[key] = [...new Set([...(w[key] || []), ...add])];
    setDirty(); renderEditor(); $(`[data-pick-add="${key}"]`).focus();
  });
  el.addEventListener('input', (e) => { if (e.target.dataset.f && e.target.dataset.f !== 'title') onField(e); else if (e.target.dataset.f === 'title') { current().title = e.target.value; $('.ed-head h1').textContent = e.target.value || '新作品'; setDirty(); renderList(); } });
  el.addEventListener('change', (e) => {
    const w = current(); if (!w) return;
    if (e.target.dataset.f === 'title') onField(e);
    if (e.target.matches('[data-hidden]')) { w.hidden = e.target.checked; setDirty(); renderList(); }
    if (e.target.matches('[data-featured]')) {
      const f = state.data.featured;
      if (e.target.checked && !f.includes(w.id)) f.push(w.id);
      if (!e.target.checked) state.data.featured = f.filter((x) => x !== w.id);
      setDirty(); renderEditor(); renderList();
    }
    if (e.target.matches('[data-feat-order]')) {
      const f = state.data.featured.filter((x) => x !== w.id);
      const pos = Math.max(1, Math.min(f.length + 1, parseInt(e.target.value, 10) || 1)) - 1;
      f.splice(pos, 0, w.id); state.data.featured = f; setDirty(); renderEditor();
    }
    if (e.target.matches('[data-site]')) { const im = w.images[+e.target.dataset.site]; if (im) { if (e.target.value) im.site = e.target.value; else delete im.site; setDirty(); } return; }
    if (e.target.matches('[data-sf]')) {
      const [key, f] = e.target.dataset.sf.split(':'); const st = (w.sites || []).find((x) => x.key === key);
      if (st) { st[f] = e.target.value.trim(); setDirty(); if (f === 'name') renderEditor(); }
      return;
    }
    if (e.target.matches('[data-frame]')) { const im = w.images[+e.target.dataset.frame]; if (im) { im.frame = e.target.value; setDirty(); } return; }
    if (e.target.matches('[data-file]')) { addFiles(e.target.files); e.target.value = ''; }
  });
  el.addEventListener('click', (e) => {
    const w = current(); if (!w) return;
    const del = e.target.closest('[data-del]');
    if (del) { w.images.splice(+del.dataset.del, 1); setDirty(); renderEditor(); renderList(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const key = pk.closest('[data-picks]').dataset.picks; const v = pk.dataset.pick;
      const arr = w[key] || []; w[key] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
      pk.classList.toggle('is-on', w[key].includes(v)); pk.setAttribute('aria-pressed', w[key].includes(v));
      setDirty(); return;
    }
    if (e.target.closest('[data-site-add]')) {
      w.sites = w.sites || []; w.sites.push({ key: `s${Date.now().toString(36)}`, name: '', status: '', url: '' });
      setDirty(); renderEditor(); const ins = $$('[data-sf$=":name"]'); if (ins.length) ins[ins.length - 1].focus(); return;
    }
    const sd = e.target.closest('[data-site-del]');
    if (sd) {
      const key = sd.dataset.siteDel; const st = (w.sites || []).find((x) => x.key === key);
      if (!confirm(`刪除網站「${(st && st.name) || '未命名網站'}」？屬於它的圖片會改回主網站（圖片不會刪除）。`)) return;
      w.sites = w.sites.filter((x) => x.key !== key); if (!w.sites.length) delete w.sites;
      (w.images || []).forEach((im) => { if (im.site === key) delete im.site; });
      setDirty(); renderEditor(); return;
    }
    const mv = e.target.closest('[data-mv]');
    if (mv) { const [i, d] = mv.dataset.mv.split(':').map(Number); moveImage(i, i + d); return; }
    if (e.target.closest('[data-delete]')) {
      if (!confirm(`確定刪除「${w.title}」？發佈後無法復原（git 歷史仍保留）。只想暫時隱藏請改用「下架」。`)) return;
      state.data.works = state.data.works.filter((x) => x !== w);
      state.data.featured = state.data.featured.filter((x) => x !== w.id);
      state.selected = null; setDirty(); renderList(); renderEditor();
    }
  });
  // drag & drop: reorder and file drop
  let dragI = null;
  el.addEventListener('dragstart', (e) => { const it = e.target.closest('.img'); if (it) { dragI = +it.dataset.i; it.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; } });
  el.addEventListener('dragend', () => { dragI = null; $$('.img', el).forEach((x) => x.classList.remove('is-drag', 'is-over')); });
  el.addEventListener('dragover', (e) => {
    const it = e.target.closest('.img, [data-drop]'); if (!it) return;
    e.preventDefault(); $$('.is-over', el).forEach((x) => x.classList.remove('is-over')); it.classList.add('is-over');
  });
  el.addEventListener('drop', (e) => {
    const it = e.target.closest('.img, [data-drop]'); if (!it) return;
    e.preventDefault(); it.classList.remove('is-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length) { addFiles(e.dataTransfer.files); return; }
    if (dragI !== null && it.classList.contains('img')) moveImage(dragI, +it.dataset.i);
  });
}

/* ---------------- site editor ---------------- */
/* ---------------- featured order ---------------- */
function renderFeatured() {
  const el = $('[data-featured-editor]'); if (!el || !state.data) return;
  const byId = new Map(state.data.works.map((w) => [w.id, w]));
  state.data.featured = state.data.featured.filter((id) => byId.has(id));
  const f = state.data.featured;
  const rest = state.data.works.filter((w) => !f.includes(w.id)).sort((a, b) => b.year - a.year);
  el.innerHTML = `
    <div class="ed-head"><h1>首頁精選</h1><span class="hint">${f.length} 件・拖曳或用 ↑↓ 排序，最上面排第一</span></div>
    <ol class="feat" data-feat-list>
      ${f.map((id, i) => { const w = byId.get(id); const im = (w.images || [])[0]; return `<li class="feat__item" draggable="true" data-fi="${i}">
        <span class="feat__no mono">${i + 1}</span>
        ${im ? `<img src="${esc(imgURL(thumbOf(im)))}" alt="">` : '<span class="noimg"></span>'}
        <div class="feat__text"><div class="list__title">${esc(w.title || '（未命名）')}</div><div class="list__meta">${w.year} · ${esc(catName(w.category))}${w.hidden ? ' · <b class="feat__warn">已下架，不會顯示</b>' : ''}</div></div>
        <span class="feat__btns"><button type="button" class="btn" data-fmv="${i}:-1" aria-label="往上" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn" data-fmv="${i}:1" aria-label="往下" ${i < f.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn" data-fdel="${i}" aria-label="移出精選">×</button></span>
      </li>`; }).join('') || '<li class="empty">還沒有精選作品。</li>'}
    </ol>
    <label class="field" style="margin-top:20px"><span>加入精選</span><select class="input" data-feat-add><option value="">選一件作品加到最後…</option>${rest.map((w) => `<option value="${esc(w.id)}">${w.year}・${esc(w.title || w.id)}${w.hidden ? '（已下架）' : ''}</option>`).join('')}</select></label>`;
}
function moveFeatured(from, to) {
  const f = state.data.featured;
  if (to < 0 || to >= f.length || from === to) return;
  const [id] = f.splice(from, 1); f.splice(to, 0, id);
  setDirty(); renderFeatured(); renderList();
}
function bindFeatured() {
  const el = $('[data-featured-editor]');
  el.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-fmv]');
    if (mv) { const [i, d] = mv.dataset.fmv.split(':').map(Number); moveFeatured(i, i + d); return; }
    const del = e.target.closest('[data-fdel]');
    if (del) { state.data.featured.splice(+del.dataset.fdel, 1); setDirty(); renderFeatured(); renderList(); }
  });
  el.addEventListener('change', (e) => {
    if (!e.target.matches('[data-feat-add]') || !e.target.value) return;
    state.data.featured.push(e.target.value); setDirty(); renderFeatured(); renderList();
  });
  let dragI = null;
  el.addEventListener('dragstart', (e) => { const it = e.target.closest('[data-fi]'); if (it) { dragI = +it.dataset.fi; it.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; } });
  el.addEventListener('dragend', () => { dragI = null; $$('[data-fi]', el).forEach((x) => x.classList.remove('is-drag', 'is-over')); });
  el.addEventListener('dragover', (e) => { const it = e.target.closest('[data-fi]'); if (it && dragI !== null) { e.preventDefault(); $$('[data-fi]', el).forEach((x) => x.classList.toggle('is-over', x === it)); } });
  el.addEventListener('drop', (e) => { const it = e.target.closest('[data-fi]'); if (it && dragI !== null) { e.preventDefault(); moveFeatured(dragI, +it.dataset.fi); } });
}

function renderSite() {
  const s = state.data.site;
  $('[data-site-editor]').innerHTML = `
    <div class="ed-head"><h1>網站資訊</h1></div>
    <div class="grid">
      <label class="field c2"><span>名稱</span><input class="input" data-s="name" value="${esc(s.name || '')}"></label>
      <label class="field c4"><span>網頁標題（搜尋結果顯示）</span><input class="input" data-s="title" value="${esc(s.title || '')}"></label>
      <label class="field"><span>首頁簡介</span><textarea class="input" data-s="intro">${esc(s.intro || '')}</textarea></label>
      <label class="field"><span>關於區塊的大段文字</span><textarea class="input" data-s="statement">${esc(s.statement || '')}</textarea></label>
      <label class="field c3"><span>聯絡 Email（留空則不顯示）</span><input class="input" type="email" data-s="email" value="${esc(s.email || '')}" placeholder="you@example.com"></label>
      <label class="field c3"><span>網站預設顯示</span><select class="input" data-s="theme">${[['system', '跟隨訪客系統設定'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<option value="${v}" ${(s.theme || 'system') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><small>訪客仍可用右上角按鈕切換；這裡決定第一次打開時的樣子。</small></label>
    </div>
    <div class="section"><h2>外部連結</h2><div class="links-edit" data-links>
      ${(s.links || []).map((l, i) => `<div class="lrow"><input class="input" data-l="${i}:label" value="${esc(l.label)}" placeholder="名稱"><input class="input" data-l="${i}:url" value="${esc(l.url)}" placeholder="https://"><button type="button" class="btn" data-ldel="${i}">移除</button></div>`).join('')}
      <div><button type="button" class="btn" data-ladd>＋ 新增連結</button></div></div></div>
    <div class="section"><h2>分類名稱</h2><p class="hint">分類代號固定不變；名稱和說明可以改。</p><div class="cats-edit">
      ${state.data.categories.map((c, i) => `<div class="crow"><code>${esc(c.id)}</code><input class="input" data-c="${i}:name" value="${esc(c.name)}"><input class="input" data-c="${i}:en" value="${esc(c.en || '')}" placeholder="英文"><input class="input" data-c="${i}:desc" value="${esc(c.desc || '')}" placeholder="說明"></div>`).join('')}
    </div></div>`;
}
function bindSite() {
  const el = $('[data-site-editor]');
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.s) state.data.site[t.dataset.s] = t.value;
    if (t.dataset.l) { const [i, k] = t.dataset.l.split(':'); state.data.site.links[+i][k] = t.value; }
    if (t.dataset.c) { const [i, k] = t.dataset.c.split(':'); state.data.categories[+i][k] = t.value; }
    setDirty();
  });
  el.addEventListener('click', (e) => {
    if (e.target.matches('[data-ladd]')) { state.data.site.links = state.data.site.links || []; state.data.site.links.push({ label: '', url: '' }); setDirty(); renderSite(); }
    if (e.target.matches('[data-ldel]')) { state.data.site.links.splice(+e.target.dataset.ldel, 1); setDirty(); renderSite(); }
  });
}

/* ---------------- misc UI ---------------- */
let toastT;
function toast(msg, kind = '') {
  const t = $('[data-toast]'); t.textContent = msg; t.className = `toast ${kind ? `is-${kind}` : ''}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 9000 : 4500);
}
function openSettings() {
  const s = settings(); const f = $('[data-settings-form]');
  ['owner', 'repo', 'branch'].forEach((k) => { f.elements[k].value = s[k] || ''; });
  $('[data-settings-dialog]').showModal();
}
function download() {
  const blob = new Blob([`${JSON.stringify(cleanData(state.data), null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'works.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if ([...state.pending.keys()].length) toast('提醒：新上傳的圖片尚未存檔，下載 JSON 不包含圖片檔，請用「發佈到 GitHub」。');
}
async function preview() {
  const d = cleanData(state.data);
  // embed not-yet-published images as data URLs so the preview can show them (best effort)
  const toData = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  for (const w of d.works) {
    for (const im of w.images || []) {
      const p = state.pending.get(im.src); const pt = state.pending.get(thumbOf(im));
      if (p) im.src = await toData(p.blob);
      if (pt) im.thumb = await toData(pt.blob); else if (!im.thumb) im.thumb = thumbOf({ src: im.src });
    }
  }
  if (!LS.set('sk2:draft', JSON.stringify(d))) {
    d.works.forEach((w) => (w.images || []).forEach((im) => { if (im.src.startsWith('data:')) { im.src = im.thumb = ''; } }));
    d.works.forEach((w) => { w.images = (w.images || []).filter((im) => im.src); });
    LS.set('sk2:draft', JSON.stringify(d));
    toast('新圖片太大無法預覽，預覽中先不顯示它們。');
  }
  window.open('../?preview', '_blank', 'noopener');
}

function newWork() {
  const year = new Date().getFullYear();
  const w = { id: '', title: '', subtitle: '', year, category: state.fcat || state.data.categories[0].id, roles: [], tags: [], status: '', url: '', demo: '', summary: '', images: [], hidden: false, _new: true };
  state.selectedWork = w;
  w.id = slugify('', year);
  state.data.works.unshift(w);
  state.selected = w.id; setDirty(); renderList(); renderEditor();
  $('[data-f="title"]').focus();
}

/* ---------------- boot ---------------- */
async function boot() {
  applyAdminTheme(LS.get('sk2:admin-theme') || 'system');
  $$('[data-admin-theme]').forEach((b) => b.addEventListener('click', () => { LS.set('sk2:admin-theme', b.dataset.adminTheme); applyAdminTheme(b.dataset.adminTheme); }));
  const access = await verifyAccess();
  if (!access.ok) await showLogin(settings().token ? access.msg : '');
  $('[data-app]').hidden = false;
  let loaded = null;
  const s = settings();
  try { loaded = await loadRemote(); } catch (err) { toast(`無法從 GitHub 載入：${err.message}`, 'error'); return; }
  state.data = loaded.data; state.sha = loaded.sha; state.head = loaded.head;
  state.data.featured = state.data.featured || [];
  state.original = clone(state.data);

  // restore unsaved draft (text only; new images can't survive a reload)
  try {
    const draft = JSON.parse(LS.get('sk2:admin-draft') || 'null');
    if (draft && draft.data && JSON.stringify(draft.data) !== JSON.stringify(state.data) && confirm(`找到 ${new Date(draft.at).toLocaleString()} 未發佈的草稿，要還原嗎？（草稿中新上傳的圖片無法還原）${draft.sha && draft.sha !== state.sha ? '\n\n注意：這份草稿之後 GitHub 上的資料已經更新過，還原後再發佈會蓋掉那些更新。' : ''}`)) {
      const known = referencedPaths(state.original);
      draft.data.works.forEach((w) => { w.images = (w.images || []).filter((im) => known.has(im.src)); });
      state.data = draft.data; setDirty();
    } else LS.del('sk2:admin-draft');
  } catch (e) { LS.del('sk2:admin-draft'); }

  $('[data-fcat]').innerHTML += state.data.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  renderList(); renderSite();

  $('[data-list]').addEventListener('click', (e) => { const li = e.target.closest('[data-id]'); if (!li) return; state.selected = li.dataset.id; renderList(); renderEditor(); if (innerWidth < 900) $('[data-editor]').scrollIntoView(); });
  $('[data-q]').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
  $('[data-fcat]').addEventListener('change', (e) => { state.fcat = e.target.value; renderList(); });
  $('[data-fyear]').addEventListener('change', (e) => { state.fyear = e.target.value; renderList(); });
  $('[data-add]').addEventListener('click', newWork);
  $('[data-publish]').addEventListener('click', publish);
  $('[data-download]').addEventListener('click', download);
  $('[data-preview]').addEventListener('click', preview);
  $('[data-settings]').addEventListener('click', openSettings);
  $('[data-logout]').addEventListener('click', logout);
  $('[data-settings-dialog]').addEventListener('close', (e) => {
    if (e.target.returnValue !== 'ok') return;
    const f = $('[data-settings-form]').elements;
    saveSettings({ owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() });
    if (state.dirty && !confirm('重新載入會以 GitHub 上的資料為準，未發佈的文字變更會保留在草稿中。繼續？')) return;
    location.reload();
  });
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
    if (b.dataset.tab === 'featured') renderFeatured();
    if (b.dataset.tab === 'works') renderEditor();
  }));
  addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  bindEditor(); bindSite(); bindFeatured();
}
boot();
