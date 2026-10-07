// UI 层：工具栏 / 目录抽屉 / 进度条 / 进度记忆 / 主题 / 音效 / 幻灯片 / 扉页内容
import { navigate } from './router.js';

const LS = {
  page: 'fubao.page', theme: 'fubao.theme', sound: 'fubao.sound', tapHint: 'fubao.tapHint',
};

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, ms);
}

function countdown(birthday) {
  const [by, bm, bd] = birthday.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), bm - 1, bd);
  if (today > next) next = new Date(today.getFullYear() + 1, bm - 1, bd);
  const days = Math.round((next - today) / 86400000);
  return { days, age: next.getFullYear() - by, isToday: days === 0 };
}

function dailyPick(ids) {
  const s = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ids[h % ids.length];
}

export class UI {
  constructor(app) {
    this.app = app; // { manifest, book, lightbox, gallery }
    this.slideshowTimer = null;
    this._resumeSaveTimer = null;
    this.installEvt = null;
    this.installBtn = null;
    this.audio = new Audio('assets/audio/page-turn.mp3');
    this.audio.volume = 0.35;
    this.audioLoaded = false;
  }

  init() {
    this._initTheme();
    this._initSound();
    this._bindToolbar();
    this._bindDrawer();
    this._bindProgress();
    this._bindKeyboard();
    this.fillTitlePage();
    this.maybeShowResume();
    this.updateProgress(this.app.book.getCurrentPage());
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEvt = e; });
    this._maybeHintTap();
  }

  // 触屏首次访问时提示一次轻触翻页
  _maybeHintTap() {
    if (localStorage.getItem(LS.tapHint) || !matchMedia('(pointer: coarse)').matches) return;
    localStorage.setItem(LS.tapHint, '1');
    setTimeout(() => toast('轻触画面左右边缘可翻页 · 点照片看大图'), 1800);
  }

  // ---- 扉页：倒计时 + 今日推荐 ----
  fillTitlePage() {
    const m = this.app.manifest;
    const cd = countdown(m.birthday);
    const cdEl = document.getElementById('tp-countdown');
    if (cdEl) {
      cdEl.textContent = cd.isToday
        ? `今天是福宝 ${cd.age} 岁生日！生日快乐！`
        : `距离福宝 ${cd.age} 岁生日还有 ${cd.days} 天`;
    }
    const stats = document.getElementById('tp-stats');
    if (stats) stats.textContent = `${m.photoCount} 张照片 · ${m.months.length} 个月份 · 记录于 ${m.months[0]?.label ?? ''} 至 ${m.months[m.months.length - 1]?.label ?? ''}`;

    const todayEl = document.getElementById('tp-today');
    if (todayEl && !todayEl.dataset.filled) {
      todayEl.dataset.filled = '1';
      const id = dailyPick(Object.keys(m.photos));
      const p = m.photos[id];
      if (p) {
        todayEl.dataset.photo = id; // 点击由 book.js 的统一轻触处理接住（书页内 click 在触屏不触发）
        todayEl.innerHTML = `<img src="${p.lqip}" data-full="${p.file}" class="lqip-mode" alt="今日推荐"><div class="tp-today-label">今日推荐${p.desc ? ' · ' + esc(p.desc.slice(0, 22)) : ''}</div>`;
        const img = todayEl.querySelector('img');
        const full = new Image();
        full.onload = () => { img.src = full.src; img.classList.remove('lqip-mode'); };
        full.src = p.file;
      }
    }
  }

  // ---- 主题 ----
  _initTheme() {
    const saved = localStorage.getItem(LS.theme);
    const night = saved ? saved === 'night'
      : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    this._setTheme(night);
  }
  _setTheme(night) {
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    this._actBtn('night')?.classList.toggle('active', night);
  }
  toggleTheme() {
    const night = document.documentElement.dataset.theme !== 'night';
    this._setTheme(night);
    localStorage.setItem(LS.theme, night ? 'night' : 'day');
  }

  // ---- 音效 ----
  _initSound() {
    const on = localStorage.getItem(LS.sound) === '1';
    this._actBtn('sound')?.classList.toggle('active', on);
    document.addEventListener('pointerdown', () => {
      if (!this.audioLoaded) { this.audio.load(); this.audioLoaded = true; }
    }, { once: true });
  }
  get soundOn() { return this._actBtn('sound')?.classList.contains('active'); }
  toggleSound() {
    const btn = this._actBtn('sound');
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    localStorage.setItem(LS.sound, on ? '1' : '0');
    if (on) { this.audio.load(); this.audioLoaded = true; this.playFlip(); }
  }
  playFlip() {
    if (!this.soundOn) return;
    try { this.audio.currentTime = 0; this.audio.play().catch(() => {}); } catch { /* noop */ }
  }

  // ---- 工具栏 ----
  _actBtn(act) { return document.querySelector(`#toolbar button[data-act="${act}"]`); }
  _bindToolbar() {
    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      this.stopSlideshow();
      switch (btn.dataset.act) {
        case 'toc': this.openDrawer(); break;
        case 'tags': navigate('/tag/'); break;
        case 'random': this.app.lightbox.open(randomPick(Object.keys(this.app.manifest.photos))); break;
        case 'slideshow': this.startSlideshow(); break;
        case 'night': this.toggleTheme(); break;
        case 'sound': this.toggleSound(); break;
      }
    });
  }

  // ---- 目录抽屉 ----
  _bindDrawer() {
    const drawer = document.getElementById('toc-drawer');
    const mask = document.getElementById('drawer-mask');
    document.getElementById('toc-close').addEventListener('click', () => this.closeDrawer());
    mask.addEventListener('click', () => this.closeDrawer());

    const list = document.getElementById('toc-list');
    const m = this.app.manifest;
    const mkItem = (label, count, thumbPhoto, onClick) => {
      const b = document.createElement('button');
      b.className = 'toc-item';
      const thumb = thumbPhoto
        ? `<img class="toc-thumb" src="${thumbPhoto.lqip}" alt="">`
        : `<span class="toc-thumb" style="display:flex;align-items:center;justify-content:center;color:#a5804c"><svg viewBox="0 0 100 100" width="22" fill="currentColor"><ellipse cx="50" cy="62" rx="24" ry="19"/><ellipse cx="24" cy="38" rx="10" ry="13" transform="rotate(-18 24 38)"/><ellipse cx="43" cy="28" rx="10" ry="14" transform="rotate(-6 43 28)"/><ellipse cx="62" cy="28" rx="10" ry="14" transform="rotate(6 62 28)"/><ellipse cx="79" cy="40" rx="10" ry="13" transform="rotate(18 79 40)"/></svg></span>`;
      b.innerHTML = `${thumb}<span><span class="toc-label">${esc(label)}</span><div class="toc-count">${count}</div></span>`;
      b.addEventListener('click', () => { this.closeDrawer(); onClick(); });
      list.appendChild(b);
    };
    mkItem('封面 · 福宝', '从这里开始', null, () => navigate('/'));
    for (const mo of m.months) {
      const first = m.pages.find(p => p.type === 'photos' && p.month === mo.month)?.photos[0];
      mkItem(mo.label, `${mo.count} 张`, first ? m.photos[first] : null, () => navigate(`/month/${mo.month}`));
    }
    this._bindInstall(list);
  }

  // ---- 添加到主屏幕（PWA 入口）----
  _installHTML() {
    const ua = navigator.userAgent;
    const tip = this.installEvt ? '一键安装，之后离线也能翻'
      : /iPhone|iPad|iPod/i.test(ua) ? 'Safari：分享 → 添加到主屏幕'
      : '浏览器菜单 ⋮ → 添加到主屏幕';
    return `<span class="toc-thumb" style="display:flex;align-items:center;justify-content:center;color:#a5804c">
      <svg viewBox="0 0 24 24" width="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M12 7v6.5m0 0L9.6 11.2M12 13.5l2.4-2.3"/><path d="M9.5 18.5h5"/></svg>
      </span><span><span class="toc-label">${this.installEvt ? '安装到主屏幕' : '添加到主屏幕'}</span><div class="toc-count">${tip}</div></span>`;
  }

  _bindInstall(list) {
    const standalone = window.navigator.standalone === true
      || matchMedia('(display-mode: standalone)').matches;
    if (standalone || /MicroMessenger|QQ\//i.test(navigator.userAgent)) return; // 已安装 / 微信内装不了
    const b = document.createElement('button');
    b.className = 'toc-item';
    b.innerHTML = this._installHTML();
    b.addEventListener('click', async () => {
      if (!this.installEvt) { toast(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '点 Safari 底部分享按钮 → 添加到主屏幕' : '点浏览器菜单 → 添加到主屏幕'); return; }
      this.installEvt.prompt();
      await this.installEvt.userChoice;
      this.installEvt = null;
      this.closeDrawer();
    });
    list.appendChild(b);
    this.installBtn = b;
  }
  openDrawer() {
    if (this.installBtn) this.installBtn.innerHTML = this._installHTML();
    document.getElementById('toc-drawer').hidden = false;
    document.getElementById('drawer-mask').hidden = false;
  }
  closeDrawer() {
    document.getElementById('toc-drawer').hidden = true;
    document.getElementById('drawer-mask').hidden = true;
  }

  // ---- 进度条 ----
  _bindProgress() {
    const bar = document.getElementById('progress-bar');
    bar.addEventListener('click', (e) => {
      const r = bar.getBoundingClientRect();
      const frac = (e.clientX - r.left) / r.width;
      this.app.book.turnTo(Math.round(frac * (this.app.book.getPageCount() - 1)));
    });
  }
  updateProgress(idx) {
    const total = this.app.book.getPageCount();
    document.getElementById('progress-fill').style.width = `${((idx + 1) / total) * 100}%`;
    // 进度记忆（防抖保存）
    clearTimeout(this._resumeSaveTimer);
    this._resumeSaveTimer = setTimeout(() => {
      if (idx > 1) localStorage.setItem(LS.page, String(idx));
    }, 600);
  }
  maybeShowResume() {
    const saved = parseInt(localStorage.getItem(LS.page) ?? '', 10);
    if (!saved || saved <= 1 || saved >= this.app.book.getPageCount()) return;
    const route = location.hash;
    if (route && route !== '#/' && route !== '#') return; // 深链优先
    const bar = document.getElementById('resume-bar');
    const pg = this.app.manifest.pages[saved];
    const label = pg?.month && pg.month !== 'unknown' ? monthLabel(pg.month) : '';
    document.getElementById('resume-text').textContent = `上次看到第 ${saved + 1} 页${label ? ' · ' + label : ''}`;
    bar.hidden = false;
    document.getElementById('resume-go').addEventListener('click', () => {
      this.app.book.jumpTo(saved);
      bar.hidden = true;
    });
    document.getElementById('resume-dismiss').addEventListener('click', () => { bar.hidden = true; });
  }

  // ---- 幻灯片 ----
  startSlideshow() {
    if (this.slideshowTimer) return;
    document.body.classList.add('slideshow');
    const tick = () => {
      const book = this.app.book;
      const cur = book.getCurrentPage();
      if (cur >= book.getPageCount() - 1) { this.stopSlideshow(); toast('放映完毕 · 谢谢观看'); return; }
      book.next();
      const nextPage = this.app.manifest.pages[cur + 1];
      const delay = nextPage?.type === 'divider' ? 6500 : 4200;
      this.slideshowTimer = setTimeout(tick, delay);
    };
    this.slideshowTimer = setTimeout(tick, 1200);
    const stop = () => { this.stopSlideshow(); cleanup(); };
    const cleanup = () => {
      document.removeEventListener('pointerdown', stop);
      window.removeEventListener('keydown', stop);
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', stop);
      window.addEventListener('keydown', stop);
    }, 400);
    toast('幻灯片播放中 · 点击任意处退出');
  }
  stopSlideshow() {
    clearTimeout(this.slideshowTimer);
    this.slideshowTimer = null;
    document.body.classList.remove('slideshow');
  }

  // ---- 键盘 ----
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'f' && !this.app.lightbox.isOpen && !e.metaKey && !e.ctrlKey) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }
      if (e.key === 'Escape') this.closeDrawer();
    });
  }
}

function randomPick(ids) { return ids[Math.floor(Math.random() * ids.length)]; }
function monthLabel(mk) { const [y, m] = mk.split('-'); return `${y}年${Number(m)}月`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export { toast };
