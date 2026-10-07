// hash 路由：#/  #/p/N  #/photo/ID  #/month/YYYY-MM  #/tag/xxx  #/slideshow
export function parseHash() {
  const h = decodeURIComponent(location.hash || '').replace(/^#\/?/, '');
  if (!h) return { view: 'book' };
  const [head, param] = h.split('/');
  switch (head) {
    case 'p': return { view: 'book', page: parseInt(param, 10) || 0 };
    case 'photo': return param ? { view: 'book', photoId: param } : { view: 'book' };
    case 'month': return param ? { view: 'book', month: param } : { view: 'book' };
    case 'tag': return param ? { view: 'gallery', tag: param } : { view: 'gallery' };
    case 'slideshow': return { view: 'book', slideshow: true };
    default: return { view: 'book' };
  }
}

export function navigate(path) {
  const target = '#' + path;
  if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

export function onRoute(fn) {
  window.addEventListener('hashchange', fn);
}

export function shareUrlForPhoto(id) {
  const base = location.origin + location.pathname;
  return `${base}#/photo/${encodeURIComponent(id)}`;
}
