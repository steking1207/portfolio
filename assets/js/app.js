/* SK2 Portfolio — vanilla JS, no build step.
   All content comes from data/works.json (edit it through /admin/). */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thumbOf = (img) => (img && (img.thumb || img.src.replace(/\.(webp|jpe?g|png)$/i, '-t.$1'))) || '';
const pad = (n, l = 2) => String(n).padStart(l, '0');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

const STATUS = {
  live: { label: '上線中', cls: 'status--live' },
  redesigned: { label: '已改版', cls: 'status--redesigned' },
};

const PAGE = 24;
// A project may span years: year = start, yearEnd = last year (optional).
const endYear = (w) => (w.yearEnd > w.year ? w.yearEnd : w.year);
const yearsOf = (w) => { const out = []; for (let y = w.year; y <= endYear(w); y++) out.push(y); return out; };
const yearLabel = (w) => (endYear(w) > w.year ? `${w.year}–${endYear(w)}` : `${w.year}`);
const state = { limit: PAGE, data: null, works: [], byId: new Map(), cat: 'all', year: null, q: '', view: store.get('sk2:view') || 'grid', lastFocus: null, current: null };

/* ---------------------------------------------------------
   Data
   --------------------------------------------------------- */
async function loadData() {
  const params = new URLSearchParams(location.search);
  if (params.has('preview')) {
    const draft = store.get('sk2:draft');
    if (draft) {
      try {
        const d = JSON.parse(draft);
        $('[data-preview-banner]').hidden = false;
        return d;
      } catch (e) { /* fall through */ }
    }
  }
  const res = await fetch(`data/works.json?v=${Date.now().toString(36).slice(0, -3)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('無法載入作品資料');
  return res.json();
}

function prepare(data) {
  state.data = data;
  const cats = new Map(data.categories.map((c, i) => [c.id, { ...c, index: i }]));
  state.cats = cats;
  state.works = data.works
    .filter((w) => !w.hidden && w.images && w.images.length)
    .map((w, i) => ({ ...w, _i: i }))
    .sort((a, b) => endYear(b) - endYear(a) || b.year - a.year || a._i - b._i);
  state.works.forEach((w) => state.byId.set(w.id, w));
  state.years = state.works.flatMap(yearsOf);
  state.minYear = Math.min(...state.years);
  state.maxYear = Math.max(...state.years);
}

/* ---------------------------------------------------------
   Shared bits
   --------------------------------------------------------- */
function statusBadge(w, { small = false } = {}) {
  const s = STATUS[w.status];
  let html = '';
  if (s && w.url) html += `<a class="status ${s.cls}" href="${esc(w.url)}" target="_blank" rel="noopener" aria-label="${s.label}：開啟 ${esc(w.title)} 網站">${s.label}<span class="arr" aria-hidden="true">↗</span></a>`;
  else if (s) html += `<span class="status ${s.cls}">${s.label}</span>`;
  if (w.demo && !small) html += `<a class="status status--demo" href="${esc(w.demo)}" target="_blank" rel="noopener">線上 Demo<span class="arr" aria-hidden="true">↗</span></a>`;
  return html;
}
const catName = (id) => (state.cats.get(id) || {}).name || id;
const workHref = (w) => `#/work/${encodeURIComponent(w.id)}`;
const hostOf = (w) => {
  const u = w.url || w.demo;
  if (u) { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { /* noop */ } }
  return `sk2.archive/${w.id}`;
};
// Each image picks its own frame in the admin: 'browser' | 'phone' | 'none'.
// Images saved before that setting existed fall back to the old automatic guess.
const FRAMES = ['browser', 'phone', 'none'];
function frameOf(w, img) {
  if (FRAMES.includes(img.frame)) return img.frame;
  if (w.category === 'graphic') return 'none';
  if (img.h / img.w >= 1.3 && img.w <= 1100) return 'phone';
  return w.category === 'app' || img.w < 700 ? 'none' : 'browser';
}

/* ---------------------------------------------------------
   Hero
   --------------------------------------------------------- */
function renderHero() {
  const { site } = state.data;
  $$('[data-site-name]').forEach((el) => { el.textContent = site.name || 'SK DESIGN'; });
  $('[data-site-intro]').textContent = site.intro || '';
  $('[data-year]').textContent = new Date().getFullYear();
  $$('[data-count-total]').forEach((el) => { el.textContent = state.works.length; });
  const span = state.maxYear - state.minYear + 1;
  $('[data-stats]').innerHTML = [
    ['Works', state.works.length, '件'],
    ['Categories', state.data.categories.length, '類'],
    ['Years', span, '年'],
  ].map(([k, v, u]) => `<div><dt>${k}</dt><dd><span data-countup="${v}">${v}</span><small>${u}</small></dd></div>`).join('');

  // film strip: interleave categories so the strip shows range
  const buckets = state.data.categories.map((c) => state.works.filter((w) => w.category === c.id));
  const picks = [];
  for (let r = 0; picks.length < 18 && r < 6; r++) buckets.forEach((b) => { if (b[r] && picks.length < 18) picks.push(b[r]); });
  const item = (w, dup) => `<a class="strip__item" href="${workHref(w)}" data-open="${esc(w.id)}" data-cursor="View" ${dup ? 'aria-hidden="true" tabindex="-1"' : ''}>
      <img src="${esc(thumbOf(w.images[0]))}" alt="${dup ? '' : esc(w.title)}" width="${Math.round(w.images[0].w)}" height="${Math.round(Math.min(w.images[0].h, w.images[0].w * 1.5))}" loading="lazy" decoding="async">
      <figcaption>${esc(w.title)} · ${yearLabel(w)}</figcaption></a>`;
  $('[data-strip-track]').innerHTML = picks.map((w) => item(w)).join('') + picks.map((w) => item(w, true)).join('');
}

/* ---------------------------------------------------------
   Featured
   --------------------------------------------------------- */
function mediaFor(w) {
  const imgs = w.images;
  if (w.category === 'graphic' && imgs.every((im) => frameOf(w, im) === 'none')) {
    return `<div class="collage">${imgs.slice(0, 3).map((im) => `<img src="${esc(thumbOf(im))}" alt="" loading="lazy" decoding="async">`).join('')}</div>`;
  }
  const phones = imgs.filter((im) => frameOf(w, im) === 'phone');
  const im = imgs[0];
  const f = frameOf(w, im);
  if ((w.category === 'app' && phones.length >= 3) || f === 'phone') {
    const pick = phones.length >= 3 ? phones.slice(0, 3) : [im];
    return `<div class="phones">${pick.map((p) => `<div class="phone"><img src="${esc(thumbOf(p))}" alt="" loading="lazy" decoding="async"></div>`).join('')}</div>`;
  }
  if (f === 'none') {
    return `<div class="frame frame--bare"><div class="frame__view" data-scrollshot data-ratio="${im.h / im.w}"><img src="${esc(im.src)}" alt="" width="${im.w}" height="${im.h}" loading="lazy" decoding="async"></div></div>`;
  }
  return `<div class="frame"><div class="frame__bar"><i></i><i></i><i></i><span class="frame__url">${esc(hostOf(w))}</span></div>
    <div class="frame__view" data-scrollshot data-ratio="${im.h / im.w}"><img src="${esc(im.src)}" alt="" width="${im.w}" height="${im.h}" loading="lazy" decoding="async"></div></div>`;
}

function renderFeatured() {
  const ids = (state.data.featured || []).filter((id) => state.byId.has(id));
  const list = ids.map((id) => state.byId.get(id));
  $('[data-featured]').innerHTML = list.map((w, i) => `
    <article class="feature" data-feature>
      <a class="feature__media media-link" href="${workHref(w)}" data-open="${esc(w.id)}" data-cursor="View" aria-label="查看 ${esc(w.title)}" data-reveal>${mediaFor(w)}</a>
      <div class="feature__info">
        <p class="feature__num" data-reveal>${pad(i + 1)} / ${pad(list.length)}</p>
        <h3 class="feature__title" data-reveal style="--d:.06s"><a href="${workHref(w)}" data-open="${esc(w.id)}">${esc(w.title)}</a></h3>
        <p class="feature__sub" data-reveal style="--d:.12s">${esc(w.subtitle || '')}</p>
        <div class="feature__meta" data-reveal style="--d:.18s">
          <span class="chip chip--solid">${yearLabel(w)}</span><span class="chip">${esc(catName(w.category))}</span>${(w.roles || []).map((r) => `<span class="chip">${esc(r)}</span>`).join('')}${statusBadge(w)}
        </div>
        <a class="feature__open" href="${workHref(w)}" data-open="${esc(w.id)}" data-reveal style="--d:.24s" data-magnetic>看完整作品 <i aria-hidden="true">→</i></a>
      </div>
    </article>`).join('');
  $('#featured').hidden = !list.length;
}

/* ---------------------------------------------------------
   Archive
   --------------------------------------------------------- */
function filtered({ ignoreYear = false, ignoreCat = false } = {}) {
  const q = state.q.trim().toLowerCase();
  return state.works.filter((w) => {
    if (!ignoreCat && state.cat !== 'all' && w.category !== state.cat) return false;
    if (!ignoreYear && state.year && !yearsOf(w).includes(state.year)) return false;
    if (q) {
      const hay = [w.title, w.subtitle, w.summary, catName(w.category), ...(w.roles || []), ...(w.tags || []), ...yearsOf(w)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFilters() {
  const base = filtered({ ignoreCat: true });
  const count = (id) => (id === 'all' ? base.length : base.filter((w) => w.category === id).length);
  const items = [{ id: 'all', name: '全部' }, ...state.data.categories];
  $('[data-filters]').innerHTML = items.map((c) => `<button class="filter" type="button" role="tab" data-cat="${c.id}" aria-selected="${state.cat === c.id}">${esc(c.name)}<sup>${count(c.id)}</sup></button>`).join('');
}

function renderTimeline() {
  const base = filtered({ ignoreYear: true });
  const counts = {};
  for (let y = state.minYear; y <= state.maxYear; y++) counts[y] = 0;
  base.forEach((w) => yearsOf(w).forEach((y) => { counts[y] += 1; }));
  const allCounts = {};
  state.works.forEach((w) => yearsOf(w).forEach((y) => { allCounts[y] = (allCounts[y] || 0) + 1; }));
  const max = Math.max(...Object.values(allCounts), 1);
  const el = $('[data-timeline]');
  el.innerHTML = Object.entries(counts).map(([y, c], i) => `
    <button type="button" class="tl-bar ${state.year === +y ? 'is-active' : ''} ${state.year && state.year !== +y ? 'is-dim' : ''}" data-year="${y}" style="--i:${i}" aria-pressed="${state.year === +y}" aria-label="${y} 年，${c} 件作品" ${c ? '' : 'disabled'}>
      <span class="tl-bar__count">${c}</span>
      <span class="tl-bar__fill ${c ? '' : 'is-empty'}" style="--h:${(c / max).toFixed(3)}"></span>
      <span class="tl-bar__year">${String(y).slice(2)}</span>
    </button>`).join('');
  $('[data-year-ctrl]').innerHTML = state.year
    ? `<span class="year-pill is-current">${state.year} 年</span><button type="button" class="year-pill is-clear" data-year-reset aria-label="清除年份，顯示全部年份"><span class="x" aria-hidden="true">×</span> 全部年份</button>`
    : `<button type="button" class="year-pill" data-year-reset aria-pressed="true">全部年份</button>`;
}

function cardHTML(w, i) {
  const im = w.images[0];
  const kind = w.category === 'graphic' ? 'is-graphic' : (frameOf(w, im) === 'phone' ? 'is-app' : '');
  return `<article class="card is-entering" style="--i:${Math.min(i, 12)}">
    <div class="card__thumb ${kind}">
      <img src="${esc(thumbOf(im))}" alt="" width="760" height="570" loading="lazy" decoding="async" onload="this.classList.add('is-loaded')">
      ${w.images.length > 1 ? `<span class="card__count">${w.images.length} 張</span>` : ''}
    </div>
    <div class="card__body">
      <h3 class="card__title"><a href="${workHref(w)}" data-open="${esc(w.id)}" data-cursor="View">${esc(w.title)}</a></h3>
      <span class="card__year">${yearLabel(w)}</span>
      <p class="card__sub">${esc(w.subtitle || catName(w.category))}</p>
      ${w.status && STATUS[w.status] ? `<div class="card__foot">${statusBadge(w, { small: true })}</div>` : ''}
    </div>
  </article>`;
}

function rowHTML(w, i) {
  return `<article class="row is-entering" style="--i:${Math.min(i, 30)}" data-thumb="${esc(thumbOf(w.images[0]))}">
    <span class="row__year">${yearLabel(w)}</span>
    <h3 class="row__title"><a href="${workHref(w)}" data-open="${esc(w.id)}">${esc(w.title)}<small>${esc(w.subtitle || '')}</small></a></h3>
    <span class="row__cat">${esc(catName(w.category))}</span>
    <span class="row__roles">${esc((w.roles || []).join('、'))}</span>
    <span class="row__status">${statusBadge(w, { small: true })}</span>
  </article>`;
}

function renderWorks() {
  const list = filtered();
  state.list = list;
  const el = $('[data-works]');
  el.dataset.viewMode = state.view;
  const shown = list.slice(0, state.limit);
  el.innerHTML = shown.map(state.view === 'list' ? rowHTML : cardHTML).join('');
  const more = $('[data-more]');
  more.hidden = list.length <= shown.length;
  more.innerHTML = `顯示更多 <span class="mono">${shown.length} / ${list.length}</span>`;
  $$('img', el).forEach((img) => { if (img.complete && img.naturalWidth) img.classList.add('is-loaded'); });
  $('[data-empty]').hidden = list.length > 0;
  const parts = [];
  if (state.cat !== 'all') parts.push(catName(state.cat));
  if (state.year) parts.push(`${state.year} 年`);
  if (state.q) parts.push(`「${esc(state.q)}」`);
  $('[data-result-line]').innerHTML = `<b>${pad(list.length)}</b> 件作品${parts.length ? ` · ${parts.join(' · ')} <button type="button" class="link-btn" data-clear>清除</button>` : ''}`;
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
}

function refreshArchive() { state.limit = PAGE; renderFilters(); renderTimeline(); $('[data-timeline]').classList.add('is-in'); renderWorks(); }

function bindArchive() {
  $('[data-filters]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    state.cat = b.dataset.cat; refreshArchive();
    b.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  $('[data-timeline]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]'); if (!b) return;
    const y = +b.dataset.year; state.year = state.year === y ? null : y; refreshArchive();
  });
  $('[data-year-ctrl]').addEventListener('click', (e) => {
    if (!e.target.closest('[data-year-reset]') || !state.year) return;
    state.year = null; refreshArchive();
  });
  let t;
  $('[data-search]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; refreshArchive(); }, 140); });
  $('[data-more]').addEventListener('click', () => {
    const from = state.limit; state.limit += PAGE; renderWorks();
    const items = $('[data-works]').children; if (items[from]) items[from].querySelector('a').focus({ preventScroll: true });
  });
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; store.set('sk2:view', state.view); renderWorks(); }));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear]')) return;
    state.cat = 'all'; state.year = null; state.q = ''; $('[data-search]').value = ''; refreshArchive();
  });

  // floating preview for list rows
  const pv = $('[data-hover-preview]'); const pimg = $('img', pv);
  const works = $('[data-works]');
  works.addEventListener('mousemove', (e) => {
    if (state.view !== 'list') return;
    const row = e.target.closest('.row');
    if (!row) { pv.classList.remove('is-on'); return; }
    if (pimg.getAttribute('src') !== row.dataset.thumb) pimg.src = row.dataset.thumb;
    pv.style.setProperty('--x', `${Math.min(e.clientX + 28, innerWidth - 320)}px`);
    pv.style.setProperty('--y', `${Math.min(e.clientY - 110, innerHeight - 240)}px`);
    pv.classList.add('is-on');
  });
  works.addEventListener('mouseleave', () => pv.classList.remove('is-on'));

  // sticky toolbar border
  const tb = $('[data-toolbar]');
  const io = new IntersectionObserver(([en]) => tb.classList.toggle('is-stuck', en.intersectionRatio < 1), { rootMargin: `-${parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) + 1}px 0px 0px 0px`, threshold: [1] });
  io.observe(tb);
}

/* ---------------------------------------------------------
   About
   --------------------------------------------------------- */
function renderAbout() {
  const { site, categories } = state.data;
  const text = site.statement || site.intro || '';
  // split into "words": latin words stay together, CJK split per 2 chars for a smoother sweep
  const tokens = text.match(/[A-Za-z0-9／/＋+.\-]+|[　-〿＀-￯，。、！？：；「」（）]|[一-鿿]{1,2}|\s+|./g) || [];
  $('[data-statement]').innerHTML = tokens.map((t) => (/^\s+$/.test(t) ? t : `<span class="w">${esc(t)}</span>`)).join('');
  $('[data-disciplines]').innerHTML = categories.map((c, i) => {
    const n = state.works.filter((w) => w.category === c.id).length;
    return `<li class="discipline"><span class="discipline__no">${pad(i + 1)}</span><button type="button" data-goto-cat="${c.id}"><span class="discipline__name">${esc(c.name)}<small>${esc(c.desc || '')}</small></span></button><span class="discipline__count">${pad(n)}</span></li>`;
  }).join('');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto-cat]'); if (!b) return;
    state.cat = b.dataset.gotoCat; state.year = null; refreshArchive();
    $('#works').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  const cta = $('[data-contact-link]');
  const links = site.links || [];
  if (site.email) cta.href = `mailto:${site.email}`;
  else if (links[0]) { cta.href = links[0].url; cta.target = '_blank'; cta.rel = 'noopener'; }
  else $('[data-contact]').hidden = true;
  $('[data-links]').innerHTML = [
    ...(site.email ? [{ label: site.email, url: `mailto:${site.email}` }] : []),
    ...links,
  ].map((l) => `<li><a href="${esc(l.url)}" ${l.url.startsWith('mailto:') ? '' : 'target="_blank" rel="noopener"'}>${esc(l.label)}</a></li>`).join('');
}

/* ---------------------------------------------------------
   Detail overlay + routing
   --------------------------------------------------------- */
const detail = $('[data-detail]');
const dScroll = $('[data-detail-scroll]');

function navList() { return state.current && state.list && state.list.some((w) => w.id === state.current.id) ? state.list : state.works; }

// Very tall screenshots are stored as stacked slices (im.slices); render them as one seamless column.
function imgHTML(im, alt, loading = 'lazy') {
  if (!im.slices || im.slices.length < 2) return `<img src="${esc(im.src)}" alt="${esc(alt)}" width="${im.w}" height="${im.h}" loading="${loading}" decoding="async">`;
  return `<span class="stack" role="img" aria-label="${esc(alt)}">${im.slices.map((sl, k) => `<img src="${esc(sl.src)}" alt="" width="${im.w}" height="${sl.h}" loading="${k ? 'lazy' : loading}" decoding="async">`).join('')}</span>`;
}
const zoomAttrs = (im) => `data-zoom="${esc(im.src)}"${im.slices && im.slices.length > 1 ? ` data-zoom-parts="${esc(im.slices.map((sl) => sl.src).join('|'))}"` : ''}`;

// pairs: [[image, indexInWork]]; host: what the browser frame's address bar shows
function galleryHTML(w, pairs = w.images.map((im, i) => [im, i]), host = hostOf(w)) {
  const imgs = pairs.map(([im]) => im);
  const shot = (im, i, cls = 'd-shot') => `<button type="button" class="${cls}" ${zoomAttrs(im)} aria-label="放大第 ${i + 1} 張圖">${imgHTML(im, `${w.title} 截圖 ${i + 1}`, i < 2 ? 'eager' : 'lazy')}</button>`;
  if (w.category === 'graphic' && imgs.every((im) => frameOf(w, im) === 'none')) return `<div class="d-graphics">${pairs.map(([im, i]) => shot(im, i)).join('')}</div>`;
  // group consecutive phone-framed screenshots into horizontal strips
  const groups = [];
  pairs.forEach(([im, i]) => {
    const kind = frameOf(w, im) === 'phone' ? 'phone' : 'wide';
    const last = groups[groups.length - 1];
    if (last && last.kind === 'phone' && kind === 'phone') last.items.push([im, i]);
    else groups.push({ kind, items: [[im, i]] });
  });
  return groups.map((g) => {
    if (g.kind === 'phone') return `<div class="d-phones">${g.items.map(([im, i]) => `<button type="button" class="phone" ${zoomAttrs(im)} aria-label="放大第 ${i + 1} 張圖">${imgHTML(im, `${w.title} 畫面 ${i + 1}`)}</button>`).join('')}</div>`;
    const [im, i] = g.items[0];
    if (frameOf(w, im) === 'none') return `<figure>${shot(im, i, 'd-shot d-wide')}</figure>`;
    return `<figure class="frame d-shot-wrap"><div class="frame__bar"><i></i><i></i><i></i><span class="frame__url">${esc(host)}</span></div><div class="frame__view">${shot(im, i)}</div></figure>`;
  }).join('');
}

// A project can have several sites (official, product, campaign…). Images tagged with a site key
// are shown in that site's own section with its name and link; untagged images belong to the work's main URL.
function sitesHTML(w) {
  const sites = (w.sites || []).filter((s) => s && s.key);
  const all = w.images.map((im, i) => [im, i]);
  if (!sites.length) return `<div class="d-gallery">${galleryHTML(w)}</div>`;
  const keys = new Set(sites.map((s) => s.key));
  const main = all.filter(([im]) => !keys.has(im.site));
  let html = main.length ? `<div class="d-gallery">${galleryHTML(w, main)}</div>` : '';
  sites.forEach((st) => {
    const pairs = all.filter(([im]) => im.site === st.key);
    const badge = statusBadge({ status: st.status, url: st.url, title: st.name }, { small: true });
    if (!pairs.length && !badge) return;
    let host = hostOf(w);
    if (st.url) { try { host = new URL(st.url).host.replace(/^www\./, ''); } catch (e) { /* noop */ } }
    html += `<section class="d-site"><header class="d-site__head"><h3 class="d-site__name">${esc(st.name || '網站')}</h3>${st.year ? `<span class="d-site__year">${st.year}</span>` : ''}${badge}</header>
      ${pairs.length ? `<div class="d-gallery">${galleryHTML(w, pairs, host)}</div>` : ''}</section>`;
  });
  return html;
}

function renderDetail(w) {
  const list = navList();
  const idx = list.findIndex((x) => x.id === w.id);
  const next = list[(idx + 1) % list.length];
  $('[data-detail-count]').textContent = `${pad(idx + 1)} / ${pad(list.length)}`;
  const chips = (arr) => arr.map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const meta = [
    ['Year', `<span>${yearLabel(w)}</span>`],
    ['Category', `<span>${esc(catName(w.category))}</span>`],
    ['Role', chips(w.roles || []) || '<span>—</span>'],
  ];
  if ((w.tags || []).length) meta.push(['Tech', chips(w.tags)]);
  if (statusBadge(w)) meta.push(['Online', statusBadge(w)]);
  $('[data-detail-body]').innerHTML = `
    <header class="d-head">
      <p class="eyebrow"><span class="eyebrow__dot"></span>${esc(catName(w.category))} · ${yearLabel(w)}</p>
      <h2 class="d-title" id="detail-title">${esc(w.title)}</h2>
      ${w.subtitle ? `<p class="d-sub">${esc(w.subtitle)}</p>` : ''}
    </header>
    <dl class="d-meta" style="--n:${meta.length}">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${w.summary ? `<p class="d-summary">${esc(w.summary)}</p>` : ''}
    ${sitesHTML(w)}
    ${next && next.id !== w.id ? `<a class="d-next" href="${workHref(next)}" data-swap="${esc(next.id)}"><span class="d-next__label">Next project — ${esc(catName(next.category))} · ${yearLabel(next)}</span><span class="d-next__title"><span>${esc(next.title)}</span><span aria-hidden="true">→</span></span></a>` : ''}`;
  dScroll.scrollTop = 0;
  document.title = `${w.title} — ${state.data.site.name || 'SK DESIGN'}`;
}

function openDetail(id, { push = true } = {}) {
  const w = state.byId.get(id);
  if (!w) return;
  const wasOpen = !detail.hidden;
  state.current = w;
  renderDetail(w);
  if (push) {
    if (wasOpen) history.replaceState({ detail: true }, '', workHref(w));
    else history.pushState({ detail: true }, '', workHref(w));
  }
  if (!wasOpen) {
    state.lastFocus = document.activeElement;
    detail.hidden = false;
    detail.classList.remove('is-closing');
    if (!reduceMotion) { detail.classList.add('is-opening'); setTimeout(() => detail.classList.remove('is-opening'), 820); }
    document.body.classList.add('is-locked');
    setTimeout(() => $('[data-close]').focus({ preventScroll: true }), 50);
  }
}

function closeDetail({ fromPop = false } = {}) {
  if (detail.hidden) return;
  if (!fromPop && history.state && history.state.detail) { history.back(); return; }
  if (!fromPop) history.replaceState(null, '', location.pathname + location.search);
  const done = () => { detail.hidden = true; detail.classList.remove('is-closing'); document.body.classList.remove('is-locked'); };
  if (reduceMotion) done(); else { detail.classList.add('is-closing'); setTimeout(done, 480); }
  document.title = state.data.site.title || document.title;
  state.current = null;
  if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus({ preventScroll: true });
}

function step(dir) {
  if (!state.current) return;
  const list = navList();
  const i = list.findIndex((x) => x.id === state.current.id);
  const n = list[(i + dir + list.length) % list.length];
  openDetail(n.id);
}

function syncRoute() {
  const m = location.hash.match(/^#\/work\/(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]), { push: false });
  else closeDetail({ fromPop: true });
}

function bindDetail() {
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); openDetail(o.dataset.open); return; }
    const s = e.target.closest('[data-swap]');
    if (s) { e.preventDefault(); openDetail(s.dataset.swap); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) { openLightbox(z.dataset.zoom, ($('[aria-label]', z) || $('img', z)).getAttribute('aria-label') || $('img', z).alt, z.dataset.zoomParts); }
  });
  $('[data-close]').addEventListener('click', () => closeDetail());
  $('[data-prev]').addEventListener('click', () => step(-1));
  $('[data-next]').addEventListener('click', () => step(1));
  window.addEventListener('popstate', syncRoute);
  window.addEventListener('hashchange', syncRoute);
  dScroll.addEventListener('scroll', () => {
    const p = dScroll.scrollTop / Math.max(1, dScroll.scrollHeight - dScroll.clientHeight);
    $('[data-detail-progress]').style.setProperty('--p', p.toFixed(4));
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!$('[data-lightbox]').hidden) { if (e.key === 'Escape') closeLightbox(); return; }
    if (detail.hidden) return;
    if (e.key === 'Escape') closeDetail();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Tab') trapFocus(e, detail);
  });
  // swipe between projects on touch
  let sx = 0; let sy = 0;
  dScroll.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  dScroll.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 2 && !e.target.closest('.d-phones')) step(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function trapFocus(e, root) {
  const f = $$('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])', root).filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* Lightbox */
const lb = $('[data-lightbox]');
let lbFocus = null;
function openLightbox(src, alt = '', parts = '') {
  lbFocus = document.activeElement;
  $('[data-lightbox-stage]').innerHTML = parts
    ? `<span class="stack" role="img" aria-label="${esc(alt)}">${parts.split('|').map((p) => `<img src="${esc(p)}" alt="">`).join('')}</span>`
    : `<img src="${esc(src)}" alt="${esc(alt)}">`;
  lb.hidden = false;
  $('[data-lightbox-close]').focus();
}
function closeLightbox() { lb.hidden = true; $('[data-lightbox-stage]').innerHTML = ''; if (lbFocus) lbFocus.focus(); }
lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('[data-lightbox-close]')) closeLightbox(); });

/* ---------------------------------------------------------
   Motion & micro-interactions
   --------------------------------------------------------- */
function bindReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  $$('[data-reveal]').forEach((el) => io.observe(el));
  const tl = new IntersectionObserver(([en]) => { if (en.isIntersecting) { en.target.classList.add('is-in'); tl.disconnect(); } }, { threshold: 0.3 });
  tl.observe($('[data-timeline]'));
}

function bindScrollFx() {
  const nav = $('[data-nav]');
  const shots = $$('[data-feature]');
  const statement = $('[data-statement]');
  const words = $$('.w', statement);
  let lastY = scrollY; let ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY; const vh = innerHeight;
    nav.classList.toggle('is-scrolled', y > 10);
    nav.classList.toggle('is-hidden', y > vh * 0.9 && y > lastY + 4 && detail.hidden);
    if (y < lastY - 4 || y < vh * 0.9) nav.classList.remove('is-hidden');
    lastY = y;
    if (reduceMotion) return;
    shots.forEach((f) => {
      const r = f.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
      f.style.setProperty('--py', (p - 0.5).toFixed(3));
      const view = $('[data-scrollshot]', f);
      if (view) {
        const ratio = parseFloat(view.dataset.ratio);
        const w = view.clientWidth; const h = view.clientHeight;
        const travel = Math.min(Math.max(0, ratio * w - h), h * 1.6);
        const eased = Math.min(1, Math.max(0, (p - 0.15) / 0.7));
        view.style.setProperty('--shift', `${(-travel * eased).toFixed(1)}px`);
      }
    });
    if (words.length) {
      const r = statement.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      const lit = Math.round(p * words.length);
      words.forEach((wEl, i) => wEl.classList.toggle('is-lit', i < lit));
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
  if (reduceMotion) words.forEach((w) => w.classList.add('is-lit'));
  $$('[data-scrollshot]').forEach((v) => { if (parseFloat(v.dataset.ratio) < 0.625) v.classList.add('is-contain'); });

  // active nav link
  const links = $$('.nav__links a');
  const secIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['featured', 'works', 'about'].forEach((id) => secIO.observe(document.getElementById(id)));
}

function bindCursor() {
  if (!finePointer || reduceMotion) return;
  document.documentElement.classList.add('has-cursor');
  const c = $('.cursor'); const label = $('[data-cursor-label]');
  let x = innerWidth / 2; let y = innerHeight / 2; let rx = x; let ry = y;
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; c.classList.remove('is-hidden'); }, { passive: true });
  document.addEventListener('mouseleave', () => c.classList.add('is-hidden'));
  addEventListener('mousedown', () => c.classList.add('is-down'));
  addEventListener('mouseup', () => c.classList.remove('is-down'));
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-cursor]');
    if (t) { label.textContent = t.dataset.cursor; c.classList.add('is-label'); } else c.classList.remove('is-label');
    c.classList.toggle('is-link', !t && !!e.target.closest('a, button, [role="button"], label, select'));
    c.classList.toggle('is-text', !!e.target.closest('input, textarea, [contenteditable="true"]'));
  });
  const loop = () => {
    rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
    c.style.setProperty('--x', `${x}px`); c.style.setProperty('--y', `${y}px`);
    c.style.setProperty('--rx', `${rx.toFixed(1)}px`); c.style.setProperty('--ry', `${ry.toFixed(1)}px`);
    requestAnimationFrame(loop);
  };
  loop();
}

function bindMagnetic() {
  if (!finePointer || reduceMotion) return;
  document.addEventListener('mousemove', (e) => {
    const m = e.target.closest('[data-magnetic]');
    $$('[data-magnetic].is-mag').forEach((el) => { if (el !== m) { el.classList.remove('is-mag'); el.style.transform = ''; } });
    if (!m) return;
    const r = m.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) * 0.25; const dy = (e.clientY - (r.top + r.height / 2)) * 0.35;
    m.classList.add('is-mag');
    m.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    m.style.transition = 'transform .3s cubic-bezier(.16,1,.3,1)';
  }, { passive: true });
}

function bindHero() {
  const hero = $('.hero'); const coords = $('[data-coords]');
  if (finePointer) {
    hero.addEventListener('mousemove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
      hero.style.setProperty('--my', `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
      coords.textContent = `X ${pad(Math.round(e.clientX), 4)} · Y ${pad(Math.round(e.clientY - r.top), 4)}`;
    }, { passive: true });
  }
  $$('.hero__title .line > span').forEach((s, i) => s.style.setProperty('--i', i));
  const clock = $('[data-clock]');
  const tick = () => {
    try { clock.textContent = `TPE ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' }).format(new Date())}`; } catch (e) { clock.hidden = true; }
  };
  tick(); setInterval(tick, 30000);
}

function countUp() {
  if (reduceMotion) return;
  $$('[data-countup]').forEach((el) => {
    const to = +el.dataset.countup; const t0 = performance.now(); const dur = 1400;
    const f = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - (1 - p) ** 4)); if (p < 1) requestAnimationFrame(f); };
    el.textContent = '0'; requestAnimationFrame(f);
  });
}

/* Theme: visitor choice (light / dark / system) overrides the site default set in the admin. */
const THEME_LABEL = { system: '跟隨系統', light: '淺色', dark: '深色' };
function themePref() { return store.get('sk2:theme') || store.get('sk2:theme-default') || 'system'; }
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
  const btn = $('[data-theme-toggle]');
  btn.dataset.mode = mode;
  btn.title = THEME_LABEL[mode];
  btn.setAttribute('aria-label', `顯示模式：${THEME_LABEL[mode]}（點擊切換）`);
}
function bindTheme() {
  applyTheme(themePref());
  $('[data-theme-toggle]').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(themePref()) + 1) % order.length];
    store.set('sk2:theme', next); applyTheme(next);
    toastTheme(next);
  });
}
function siteDefaultTheme(mode) {
  const m = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
  store.set('sk2:theme-default', m);
  if (!store.get('sk2:theme')) applyTheme(m);
}
let themeTip;
function toastTheme(mode) {
  let t = $('.theme-tip');
  if (!t) { t = document.createElement('div'); t.className = 'theme-tip mono'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = `顯示：${THEME_LABEL[mode]}`;
  t.classList.add('is-on'); clearTimeout(themeTip); themeTip = setTimeout(() => t.classList.remove('is-on'), 1400);
}

function runLoader() {
  return new Promise((resolve) => {
    const root = document.documentElement;
    const loader = $('.loader');
    if (!root.classList.contains('is-first') || reduceMotion) { root.classList.remove('is-first'); resolve(); return; }
    try { sessionStorage.setItem('sk2:seen', '1'); } catch (e) { /* ignore */ }
    const yEl = $('[data-loader-year]'); const bar = $('.loader__bar i');
    const from = state.minYear || 2005; const to = state.maxYear || new Date().getFullYear();
    const t0 = performance.now(); const dur = 1300;
    const f = (t) => {
      const p = Math.min(1, (t - t0) / dur); const e = 1 - (1 - p) ** 3;
      yEl.textContent = Math.round(from + (to - from) * e);
      bar.style.setProperty('--p', e.toFixed(3));
      if (p < 1) requestAnimationFrame(f);
      else { loader.classList.add('is-done'); setTimeout(resolve, 380); setTimeout(() => root.classList.remove('is-first'), 1100); }
    };
    requestAnimationFrame(f);
  });
}

/* ---------------------------------------------------------
   Boot
   --------------------------------------------------------- */
(async function boot() {
  bindTheme();
  let data;
  try { data = await loadData(); } catch (err) {
    document.documentElement.classList.remove('is-first');
    $('[data-works]').innerHTML = `<p class="works__empty">${esc(err.message)}，請稍後再試。</p>`;
    return;
  }
  prepare(data);
  siteDefaultTheme(data.site && data.site.theme);
  renderHero();
  renderFeatured();
  refreshArchive();
  renderAbout();
  bindArchive();
  bindDetail();
  bindHero();
  bindCursor();
  bindMagnetic();
  await runLoader();
  $('.hero').classList.add('is-in');
  countUp();
  bindReveal();
  bindScrollFx();
  syncRoute();
}());
