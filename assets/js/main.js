// 入口：加载 manifest，装配 book / lightbox / gallery / ui / 路由
import { AlbumBook } from './book.js';
import { Lightbox } from './lightbox.js';
import { Gallery } from './gallery.js';
import { UI, toast } from './ui.js';
import { parseHash, navigate, onRoute } from './router.js';

let manifest;
try {
  const res = await fetch('data/manifest.json');
  if (!res.ok) throw new Error(res.status);
  manifest = await res.json();
} catch (e) {
  document.getElementById('app').innerHTML =
    '<p style="font-family:var(--hand);font-size:20px;text-align:center">相册数据还没生成<br>请先运行「更新相册.bat」</p>';
  throw e;
}

const app = { manifest };

app.book = new AlbumBook(manifest, document.getElementById('book'), {
  flip: (idx) => { app.ui.updateProgress(idx); app.ui.playFlip(); },
  openPhoto: (id) => app.lightbox.open(id),
  rebuilt: () => { app.ui.fillTitlePage(); app.ui.updateProgress(app.book.getCurrentPage()); },
});

app.lightbox = new Lightbox(manifest, {
  toast,
  onOpen: (id) => history.replaceState(null, '', '#/photo/' + encodeURIComponent(id)),
  onClose: () => history.replaceState(null, '', '#/p/' + app.book.getCurrentPage()),
});

app.gallery = new Gallery(manifest, {
  openPhoto: (id) => app.lightbox.open(id),
  closeGallery: () => navigate('/'),
});

app.ui = new UI(app);
app.book.mount(0);
app.ui.init();

function route() {
  const r = parseHash();
  if (r.view === 'gallery') {
    app.gallery.show(r.tag ?? null);
    return;
  }
  if (app.gallery.visible) app.gallery.hide();

  if (r.photoId) {
    if (!manifest.photos[r.photoId]) { toast('没有找到这张照片'); return; }
    app.book.jumpTo(app.book.pageOfPhoto(r.photoId));
    app.lightbox.open(r.photoId);
  } else if (r.month) {
    const mo = manifest.months.find(m => m.month === r.month);
    if (mo) app.book.jumpTo(mo.startPage);
  } else if (typeof r.page === 'number' && r.page > 0) {
    app.book.jumpTo(Math.min(r.page, app.book.getPageCount() - 1));
  } else if (r.slideshow) {
    app.ui.startSlideshow();
  }
}

onRoute(route);
route();
