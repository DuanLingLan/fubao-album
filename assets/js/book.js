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
    // 点击 vs 拖拽判定：记下按下点（pointerdown 覆盖鼠标和触屏，touchstart 兜底老 WebView）
    const noteDown = (x, y) => { this._down = { x, y, t: Date.now() }; };
    this.container.addEventListener('pointerdown', (e) => noteDown(e.clientX, e.clientY), true);
    this.container.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) noteDown(t.clientX, t.clientY);
    }, true);
    // page-flip 在 touchstart 上 preventDefault（mobileScrollSupport:false），触屏拿不到 click，
    // 所以触摸走 touchend（它也排在库自身的 userStop 之后，不会打断库的动画），鼠标走 click
    this.container.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      this._tapAt = Date.now();
      this._onTap(t.clientX, t.clientY, e.target);
    }, true);
    this.container.addEventListener('click', (e) => {
      if (Date.now() - (this._tapAt || 0) < 800) return;
      this._onTap(e.clientX, e.clientY, e.target);
    }, true);
  }

  _onTap(x, y, target) {
    if (!this._down) return;
    const dx = Math.abs(x - this._down.x), dy = Math.abs(y - this._down.y);
    const dt = Date.now() - this._down.t;
    if (dx >= 14 || dy >= 14 || dt >= 600) return;
    // 卷角正亮着且点在这个角上 = 翻这一页。必须排在封面判定之前：
    // 往回翻的卷角，折起来的那个元素本身就是 .page.cover（它盖在左半边），
    // 先判封面的话「点左角回封面」会被当成点封面翻开 → 反而往前翻一页。
    if (this._onCurl(x, y)) {
      this._turnBySide(x);
      return;
    }
    const page = target?.closest?.('.page');
    if (page?.classList.contains('cover') && this.getCurrentPage() === 0) { // 停在封面时：轻触翻开
      this.next();
      return;
    }
    const pick = target?.closest?.('#tp-today');
    if (pick?.dataset.photo) {
      this.hooks.openPhoto?.(pick.dataset.photo);
      return;
    }
    const card = target?.closest?.('.photo-card');
    if (card) {
      this.hooks.openPhoto?.(card.dataset.id);
      return;
    }
    const zone = this._tapZone(x);
    if (!zone) return;
    zone === 'l' ? this.prev() : this.next();
  }

  // 悬停卷角（fold_corner）状态 + 点落在库的角判定框里
  _onCurl(x, y) {
    if (!this.pf || this.pf.getState() !== 'fold_corner') return false;
    const fc = this.pf.getFlipController();
    // 库用 .stf__block（事件绑定元素）的相对坐标判定，四角 sqrt(pageW²+H²)/5 的方块
    const box = (this.container.querySelector('.stf__block') || this.container).getBoundingClientRect();
    return !!fc?.isPointOnCorners({ x: x - box.left, y: y - box.top });
  }

  _turnBySide(x) {
    const s = this._spread();
    if (!s) return;
    x < (s.left + s.right) / 2 ? this.prev() : this.next();
  }

  // 可见书页的最左/最右 + 边缘热区宽度
  _spread() {
    const box = this.container.getBoundingClientRect();
    // 只量静止页：折起来的那页带 transform，getBoundingClientRect 会跟着飞走，
    // 而它的布局盒（offsetLeft）又会落到书本框之外（往回翻时封面的 offsetLeft 是 0），
    // 混进来会把左边缘热区推到视口外，点书页最左边反而没反应。
    const rects = [...this.container.querySelectorAll('.stf__item')]
      .filter(e => e.style.display === 'block' && !e.style.transform)
      .map(e => {
        const p = (e.offsetParent || this.container).getBoundingClientRect();
        return { left: p.left + e.offsetLeft, right: p.left + e.offsetLeft + e.offsetWidth };
      })
      .filter(r => r.right > box.left && r.left < box.right);
    if (!rects.length) return null;
    const left = Math.max(box.left, Math.min(...rects.map(r => r.left)));
    const right = Math.min(box.right, Math.max(...rects.map(r => r.right)));
    return { left, right, edge: Math.min(80, Math.max(36, (right - left) * 0.1)) };
  }

  // 翻页热区只贴可见书页的最左/最右 10%，中间留给照片本身
  _tapZone(x) {
    const s = this._spread();
    if (!s) return null;
    if (x <= s.left + s.edge) return 'l';
    if (x >= s.right - s.edge) return 'r';
    return null;
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
      minWidth: 280, maxWidth: 1400, minHeight: 100, maxHeight: 1500,
      // 容器尺寸已由 CSS 决定：autoSize 会按 width/height 比例给外层加 padding，短屏下撑出滚动区
      autoSize: false,
      usePortrait: true,
      showCover: true,
      // 投影只为悬停卷角提供明暗
      drawShadow: true,
      maxShadowOpacity: isMobile ? 0.35 : 0.5,
      // 卷角预览与回位的时长。别调小：库按「距离/1000×本值」排帧，卷角位移只有 ~50px，
      // 本值低于 ~340ms 时首个 rAF 就冲过终点，而 render() 越界时只收尾不补末帧 → 卷角画不出来
      flippingTime: 650,
      mobileScrollSupport: false,
      useMouseEvents: true,
      // 卷角折出的几何仍会顶出视口，由 html,body{overflow:hidden} 兜住，不会再闪滚动条
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
