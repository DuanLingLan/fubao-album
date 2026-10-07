import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/config.json'), 'utf8'));
const indexDir = path.dirname(cfg.indexJson);
const indexData = JSON.parse(fs.readFileSync(cfg.indexJson, 'utf8'));
const SEL_FILE = path.join(ROOT, cfg.selectionFile);
const CAP_FILE = path.join(ROOT, 'data/captions.json');

const allRows = indexData.rows;
const byName = new Map(allRows.map(r => [r.name, r]));

const rows = indexData.rows
  .filter(r => (r.tags || []).some(t => t.includes('猫')))
  .map(({ n, name, date, desc, tags, thumb }) => ({ n, name, date, desc, tags, thumb }));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(ROOT, 'scripts/curate.html')));
    return;
  }
  if (url.pathname === '/data') {
    let selection = [];
    try { selection = JSON.parse(fs.readFileSync(SEL_FILE, 'utf8')); } catch { /* 首次选片 */ }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ rows, selection }));
    return;
  }
  if (url.pathname.startsWith('/thumbs/')) {
    const file = path.basename(url.pathname);
    const p = path.join(indexDir, 'thumbs', file);
    if (!fs.existsSync(p)) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'max-age=86400');
    res.end(fs.readFileSync(p));
    return;
  }
  if (url.pathname === '/captions') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(ROOT, 'scripts/caption.html')));
    return;
  }
  if (url.pathname === '/captions-data') {
    let selection = [];
    try { selection = JSON.parse(fs.readFileSync(SEL_FILE, 'utf8')); } catch { /* 尚未选片 */ }
    let captions = {};
    try { captions = JSON.parse(fs.readFileSync(CAP_FILE, 'utf8')); } catch { /* 还没写过文案 */ }
    const photos = selection.map(name => {
      const r = byName.get(name);
      if (!r) return { name, date: '', desc: '', tags: [], thumb: '' };
      const { name: n, date, desc, tags, thumb } = r;
      return { name: n, date, desc, tags, thumb };
    }).sort((a, b) => (a.date || a.name).localeCompare(b.date || b.name));
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ photos, captions }));
    return;
  }
  if (url.pathname === '/save-captions' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new Error('格式错误');
        fs.writeFileSync(CAP_FILE, JSON.stringify(obj, null, 2));
        const n = Object.keys(obj).filter(k => k !== 'months').length;
        console.log(`[i] 已保存 captions.json：${n} 张照片文案，${Object.keys(obj.months ?? {}).length} 个章节引言`);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, count: n }));
      } catch (e) {
        res.statusCode = 400;
        res.end(e.message);
      }
    });
    return;
  }
  if (url.pathname === '/save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const arr = JSON.parse(body);
        if (!Array.isArray(arr) || arr.some(s => typeof s !== 'string')) throw new Error('格式错误');
        fs.writeFileSync(SEL_FILE, JSON.stringify(arr, null, 1));
        console.log(`[i] 已保存 selection.json：${arr.length} 张`);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, count: arr.length }));
        if (url.searchParams.has('exit')) setTimeout(() => process.exit(0), 300);
      } catch (e) {
        res.statusCode = 400;
        res.end(e.message);
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log('[i] 已有一个工具实例在 8124 端口运行，直接用浏览器打开 http://127.0.0.1:8124 即可（本窗口可关闭）');
    process.exit(0);
  }
  throw e;
});
server.listen(8124, '127.0.0.1', () => {
  console.log(`[i] 选片工具已启动：http://127.0.0.1:8124 （共 ${rows.length} 张猫片）`);
  console.log('[i] 选完后点页面右上「导出并退出」，或直接关闭本窗口放弃修改');
});
