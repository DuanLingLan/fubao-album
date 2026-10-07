// Lightbox：大图查看、双指缩放、双击放大、滑动切换、分享、下载
import { shareUrlForPhoto, navigate } from './router.js';

export class Lightbox {
  constructor(manifest, hooks = {}) {
    this.manifest = manifest;
    this.hooks = hooks; // { toast(msg), onOpen(id), onClose() }
    this.ids = Object.keys(manifest.photos).sort((a, b) =>
      (manifest.photos[a].date || '').localeCompare(manifest.photos[b].date || '') || a.localeCompare(b));
    this.root = document.getElementById('lightbox');
    this.img = document.getElementById('lb-img');
    this.dateEl = document.getElementById('lb-date');
    this.capEl = document.getElementById('lb-caption');
    this.dlEl = document.getElementById('lb-download');
    this.curId = null;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this._touches = new Map();
    this._startDist = 0; this._startScale = 1;
    this._dragStart = null;
    this._swipeStart = null;
    this._bind();
  }

  _bind() {
    document.getElementById('lb-close').addEventListener('click', () => this.close());
    document.getElementById('lb-prev').addEventListener('click', (e) => { e.stopPropagation(); this.step(-1); });
    document.getElementById('lb-next').addEventListener('click', (e) => { e.stopPropagation(); this.step(1); });
    document.getElementById('lb-share').addEventListener('click', () => this.share());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root || e.target.id === 'lb-stage') this.close();
    });

    const stage = document.getElementById('lb-stage');
    stage.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    stage.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    stage.addEventListener('touchend', (e) => this._onTouchEnd(e));
    stage.addEventListener('dblclick', (e) => { e.preventDefault(); this._toggleZoom(e.clientX, e.clientY); });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const next = Math.min(4, Math.max(1, this.scale * (e.deltaY < 0 ? 1.15 : 0.87)));
      this._setScale(next);
    }, { passive: false });

    // 鼠标拖拽平移（放大态）
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || this.scale <= 1) return;
      this._dragStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this._dragStart) return;
      this.tx = this._dragStart.tx + (e.clientX - this._dragStart.x);
      this.ty = this._dragStart.ty + (e.clientY - this._dragStart.y);
      this._apply(false);
    });
    stage.addEventListener('pointerup', () => { this._dragStart = null; this._apply(); });

    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight') this.step(1);
      else if (e.key === 'ArrowLeft') this.step(-1);
    });
  }

  // ---- 触摸：双指缩放 / 单指平移或滑动切换 ----
  _onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      this._startDist = this._dist(e.touches);
      this._startScale = this.scale;
      this._swipeStart = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (this.scale > 1) {
        e.preventDefault();
        this._dragStart = { x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };
      } else {
        this._swipeStart = { x: t.clientX, y: t.clientY, t: Date.now() };
      }
      // 双击缩放（手动实现，移动端 dblclick 不可靠）
      const now = Date.now();
      if (now - (this._lastTap || 0) < 300) { this._toggleZoom(t.clientX, t.clientY); this._lastTap = 0; }
      else this._lastTap = now;
    }
  }

  _onTouchMove(e) {
    if (e.touches.length === 2 && this._startDist) {
      e.preventDefault();
      const next = Math.min(4, Math.max(1, this._startScale * this._dist(e.touches) / this._startDist));
      this._setScale(next);
    } else if (e.touches.length === 1 && this._dragStart) {
      e.preventDefault();
      const t = e.touches[0];
      this.tx = this._dragStart.tx + (t.clientX - this._dragStart.x);
      this.ty = this._dragStart.ty + (t.clientY - this._dragStart.y);
      this._apply(false);
    }
  }

  _onTouchEnd(e) {
    if (e.touches.length < 2) this._startDist = 0;
    this._dragStart = null;
    if (e.touches.length === 0 && this._swipeStart && this.scale <= 1) {
      const t = e.changedTouches[0];
      const dx = t.clientX - this._swipeStart.x;
      const dy = t.clientY - this._swipeStart.y;
      const dt = Date.now() - this._swipeStart.t;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) {
        this.step(dx < 0 ? 1 : -1);
      }
      this._swipeStart = null;
    }
    if (this.scale <= 1) { this.tx = 0; this.ty = 0; this._apply(true); }
  }

  _dist(ts) { return Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY); }

  _toggleZoom(cx, cy) {
    if (this.scale > 1) { this._setScale(1); return; }
    const rect = this.img.getBoundingClientRect();
    const ox = (rect.left + rect.width / 2 - cx) / (rect.width / 2);
    const oy = (rect.top + rect.height / 2 - cy) / (rect.height / 2);
    this.tx = ox * rect.width * 0.75; this.ty = oy * rect.height * 0.75;
    this._setScale(2.5);
  }

  _setScale(s) {
    this.scale = s;
    if (s <= 1) { this.tx = 0; this.ty = 0; }
    this._apply(true);
  }

  // smooth=true 带过渡动画；拖拽/捏合过程中传 false 保证跟手
  _apply(smooth = false) {
    this.img.classList.toggle('no-transition', !smooth);
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  // ---- 打开 / 切换 / 关闭 ----
  open(id) {
    if (!this.manifest.photos[id]) return;
    this.curId = id;
    const p = this.manifest.photos[id];
    this._reset();
    this.img.src = p.file;
    this.img.alt = p.desc || '福宝';
    this.dateEl.textContent = p.date ? p.date.slice(0, 10) + (p.tags.length ? ' · ' + p.tags.join(' ') : '') : '';
    this.capEl.textContent = p.desc || '';
    this.dlEl.href = p.file;
    this.dlEl.setAttribute('download', `福宝_${id}.webp`);
    this.root.hidden = false;
    document.body.style.overflow = 'hidden';
    this.hooks.onOpen?.(id);
  }

  step(dir) {
    if (!this.curId) return;
    const i = this.ids.indexOf(this.curId);
    const next = this.ids[(i + dir + this.ids.length) % this.ids.length];
    this.curId = next;
    const p = this.manifest.photos[next];
    this._reset();
    this.img.src = p.file;
    this.dateEl.textContent = p.date ? p.date.slice(0, 10) + (p.tags.length ? ' · ' + p.tags.join(' ') : '') : '';
    this.capEl.textContent = p.desc || '';
    this.dlEl.href = p.file;
    this.dlEl.setAttribute('download', `福宝_${next}.webp`);
    this.hooks.onOpen?.(next);
  }

  _reset() {
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.img.style.transform = '';
  }

  close() {
    this.root.hidden = true;
    document.body.style.overflow = '';
    this.curId = null;
    this.hooks.onClose?.();
  }

  get isOpen() { return !this.root.hidden; }

  async share() {
    const url = shareUrlForPhoto(this.curId);
    const p = this.manifest.photos[this.curId];
    const title = `福宝 · ${p.date ? p.date.slice(0, 10) : ''}`;
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch { /* 用户取消或不支持 */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.hooks.toast?.('链接已复制，去粘贴分享吧（微信内可长按图片保存）');
    } catch {
      this.hooks.toast?.('复制失败，请手动复制地址栏链接');
    }
  }
}
