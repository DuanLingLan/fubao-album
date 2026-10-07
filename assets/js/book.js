// 翻页书核心：page-flip 集成、页面生成、渐进加载、响应式单双页
import { PageFlip } from '../vendor/page-flip.esm.js';

const PAW_SVG = `<svg viewBox="0 0 100 100" fill="currentColor"><ellipse cx="50" cy="62" rx="24" ry="19"/><ellipse cx="24" cy="38" rx="10" ry="13" transform="rotate(-18 24 38)"/><ellipse cx="43" cy="28" rx="10" ry="14" transform="rotate(-6 43 28)"/><ellipse cx="62" cy="28" rx="10" ry="14" transform="rotate(6 62 28)"/><ellipse cx="79" cy="40" rx="10" ry="13" transform="rotate(18 79 40)"/></svg>`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function fmtDate(d) { return (d || '').slice(0, 10).replace(/-/g, '.'); }

export class AlbumBook {
  constructor(manifest, container, hooks = {}) {
    this.manifest = manifest;
    this.container = container;
    this.hooks = hooks; // { flip(idx), openPhoto(id) }
    this.pf = null;
    this._imgRegistry = new Map(); // pageIdx -> [img]
    this._loaded = new Set();      // pageIdx 已换清晰图
    this._down = null;
    this._resizeTimer = null;
    this._lastOrientation = null;
  }

  mount(startPage = 0) {
    this._lastOrientation = this._detectOrientation();
    this._create(startPage);
    window.addEventListener('resize', this._onResize = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._maybeRebuild(), 220);
    });
    window.addEventListener('orientationchange', () => setTimeout(() => this._maybeRebuild(), 300));
    // 首帧布局稳定后重算一次，避免初始化测量竞态
    requestAnimationFrame(() => requestAnimationFrame(() => this.pf?.update()));
    // 键盘翻页
    window.addEventListener('keydown', this._onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.prev();
    });
    // 点击 vs 拖拽判定
    this.container.addEventListener('pointerdown', (e) => {
      this._down = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, true);
    this.container.addEventListener('click', (e) => {
      const card = e.target.closest?.('.photo-card');
      if (!card || !this._down) return;
      const dx = Math.abs(e.clientX - this._down.x), dy = Math.abs(e.clientY - this._down.y);
      const dt = Date.now() - this._down.t;
      if (dx < 10 && dy < 10 && dt < 450) {
        e.stopPropagation();
        this.hooks.openPhoto?.(card.dataset.id);
      }
    }, true);
  }

  _detectOrientation() {
    const w = this.container.parentElement.clientWidth || window.innerWidth;
    return (w < 720 && window.innerWidth < 720) ? 'portrait' : 'landscape';
  }

  _maybeRebuild() {
    const o = this._detectOrientation();
    if (o === this._lastOrientation) { this.pf?.update(); return; }
    this._lastOrientation = o;
    const cur = this.getCurrentPage();
    this._destroyFlip();
    this._create(cur);
  }

  _destroyFlip() {
    if (!this.pf) return;
    try { this.pf.destroy(); } catch { /* noop */ }
    this.pf = null;
    this.container.innerHTML = '';
    this._imgRegistry.clear();
    this._loaded.clear();
  }

  _create(startPage) {
    const pages = this._buildPageEls();
    const isMobile = this._lastOrientation === 'portrait';
    this.pf = new PageFlip(this.container, {
      width: 550, height: 730,
      size: 'stretch',
      minWidth: 280, maxWidth: 1400, minHeight: 380, maxHeight: 1500,
      usePortrait: true,
      showCover: true,
      drawShadow: true,
      maxShadowOpacity: isMobile ? 0.3 : 0.5,
      flippingTime: 650,
      mobileScrollSupport: false,
      useMouseEvents: true,
      showPageCorners: true,
      disableFlipByClick: true,
    });
    this.pf.loadFromHTML(pages);
    this.pf.on('flip', (e) => {
      const idx = e.data;
      this._ensureLoaded(idx);
      this.hooks.flip?.(idx, this.manifest.pages[idx]);
    });
    if (startPage > 0) this.pf.turnToPage(startPage);
    this._ensureLoaded(this.getCurrentPage());
    this.hooks.rebuilt?.();
  }

  // ---- 页面 DOM 生成 ----
  _buildPageEls() {
    const frag = [];
    for (const p of this.manifest.pages) {
      if (p.type === 'cover') frag.push(this._coverEl());
      else if (p.type === 'title') frag.push(this._titleEl());
      else if (p.type === 'divider') frag.push(this._dividerEl(p));
      else frag.push(this._photoPageEl(p));
    }
    return frag;
  }

  _coverEl() {
    const page = el('div', 'page cover');
    page.innerHTML = `
      <div class="cover-spine"></div><div class="cover-frame"></div>
      <div class="cover-inner">
        <h1 class="cover-name">福宝</h1>
        <div class="cover-sub">电子相册</div>
        <div class="cover-paw" style="color:#d8b578">${PAW_SVG}</div>
      </div>
      <div class="cover-hint">轻触翻开</div>`;
    page.addEventListener('click', () => this.next());
    return page;
  }

  _titleEl() {
    const page = el('div', 'page title-page');
    page.innerHTML = `
      <div class="title-inner">
        <h2 class="tp-title">福宝的相册</h2>
        <div class="tp-countdown" id="tp-countdown"></div>
        <div class="tp-today-card" id="tp-today" title="今日推荐"></div>
        <div class="tp-stats" id="tp-stats"></div>
      </div>`;
    return page;
  }

  _dividerEl(p) {
    const tone = this.manifest.months.findIndex(m => m.month === p.month) % 6;
    const page = el('div', `page divider tone-${tone}`);
    page.innerHTML = `
      <div class="div-inner">
        <h2 class="div-month">${p.label}</h2>
        <div class="div-count">${p.count ?? ''} 张照片的时光</div>
        ${p.text ? `<div class="div-text">${esc(p.text)}</div>` : ''}
        <div class="div-paws" style="color:#8a744e">${PAW_SVG}${PAW_SVG}${PAW_SVG}</div>
        <div class="div-rule"></div>
      </div>`;
    return page;
  }

  _photoPageEl(p) {
    const page = el('div', `page photo-page layout-${p.layout}`);
    const cards = el('div', `cards layout-${p.layout}`);
    const imgs = [];
    for (const id of p.photos) {
      const photo = this.manifest.photos[id];
      const card = el('div', 'photo-card' + (photo.desc ? ' has-caption' : ''));
      card.dataset.id = id;
      const frame = el('div', 'photo-frame');
      const img = el('img');
      img.src = photo.lqip;
      img.dataset.full = photo.file;
      img.alt = photo.desc || '福宝';
      img.decoding = 'async';
      img.classList.add('lqip-mode');
      imgs.push(img);
      frame.appendChild(img);
      if (p.layout === 'single' || p.layout === 'hero') {
        for (const c of ['tl', 'tr', 'bl', 'br']) frame.appendChild(el('i', `pcorner ${c}`));
      }
      if (photo.desc) frame.appendChild(el('div', 'photo-caption', esc(photo.desc)));
      frame.appendChild(el('div', 'photo-date', fmtDate(photo.date)));
      card.appendChild(frame);
      cards.appendChild(card);
    }
    page.appendChild(cards);
    this._imgRegistry.set(p.i, imgs);
    return page;
  }

  // ---- 渐进加载 ----
  _ensureLoaded(centerIdx) {
    for (let i = centerIdx - 2; i <= centerIdx + 2; i++) {
      const imgs = this._imgRegistry.get(i);
      if (!imgs || this._loaded.has(i)) continue;
      this._loaded.add(i);
      for (const img of imgs) {
        const full = new Image();
        full.onload = () => { img.src = full.src; img.classList.remove('lqip-mode'); };
        full.src = img.dataset.full;
      }
    }
  }

  // ---- 公共 API ----
  next() { this.pf?.flipNext(); }
  prev() { this.pf?.flipPrev(); }
  turnTo(i) { if (this.pf) this.pf.flip(Math.max(0, Math.min(i, this.getPageCount() - 1))); this._ensureLoaded(i); }
  jumpTo(i) { if (this.pf) this.pf.turnToPage(Math.max(0, Math.min(i, this.getPageCount() - 1))); this._ensureLoaded(i); }
  getCurrentPage() { return this.pf ? this.pf.getCurrentPageIndex() : 0; }
  getPageCount() { return this.manifest.pages.length; }

  pageOfPhoto(id) {
    const pg = this.manifest.pages.find(p => p.photos?.includes(id));
    return pg ? pg.i : 0;
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
    this._destroyFlip();
  }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
