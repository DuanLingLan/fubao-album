// 标签画廊视图：按标签筛选浏览全部照片
export class Gallery {
  constructor(manifest, hooks = {}) {
    this.manifest = manifest;
    this.hooks = hooks; // { openPhoto(id), closeGallery() }
    this.view = document.getElementById('gallery-view');
    this.chipsEl = document.getElementById('tag-chips');
    this.gridEl = document.getElementById('gallery-grid');
    this.activeTag = null;
    this._observer = null;
    document.getElementById('gallery-back').addEventListener('click', () => this.hooks.closeGallery?.());
  }

  show(tag = null) {
    this.view.hidden = false;
    document.getElementById('book-view').style.display = 'none';
    this.renderChips();
    this.renderGrid(tag);
    this.view.scrollTop = 0;
  }

  hide() {
    this.view.hidden = true;
    document.getElementById('book-view').style.display = '';
    this._observer?.disconnect();
  }

  get visible() { return !this.view.hidden; }

  renderChips() {
    this.chipsEl.innerHTML = '';
    const mk = (label, count, tag) => {
      const b = document.createElement('button');
      b.className = 'tag-chip' + (this.activeTag === tag ? ' on' : '');
      b.innerHTML = `${label}<small>${count}</small>`;
      b.addEventListener('click', () => this.renderGrid(tag));
      this.chipsEl.appendChild(b);
    };
    mk('全部', this.manifest.photoCount, null);
    for (const [tag, n] of this.manifest.allTags) mk(tag, n, tag);
  }

  renderGrid(tag) {
    this.activeTag = tag;
    this.renderChips();
    this._observer?.disconnect();
    this.gridEl.innerHTML = '';

    const ids = Object.keys(this.manifest.photos)
      .filter(id => !tag || this.manifest.photos[id].tags.includes(tag))
      .sort((a, b) => (this.manifest.photos[b].date || '').localeCompare(this.manifest.photos[a].date || ''));

    this._observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const img = en.target;
        this._observer.unobserve(img);
        const full = new Image();
        full.onload = () => { img.src = full.src; img.classList.remove('lqip-mode'); };
        full.src = img.dataset.full;
      }
    }, { root: this.view, rootMargin: '300px' });

    for (const id of ids) {
      const p = this.manifest.photos[id];
      const item = document.createElement('div');
      item.className = 'g-item';
      item.dataset.id = id;
      const img = document.createElement('img');
      img.src = p.lqip;
      img.dataset.full = p.file;
      img.alt = p.desc || '福宝';
      img.classList.add('lqip-mode');
      img.loading = 'lazy';
      img.decoding = 'async';
      item.appendChild(img);
      const d = document.createElement('span');
      d.className = 'g-date';
      d.textContent = (p.date || '').slice(0, 10);
      item.appendChild(d);
      item.addEventListener('click', () => this.hooks.openPhoto?.(id));
      this.gridEl.appendChild(item);
      this._observer.observe(img);
    }
  }
}
