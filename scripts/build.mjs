// 福宝相册构建管线：原图 → WebP + LQIP + 元数据 → manifest.json
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/config.json'), 'utf8'));

const PHOTOS_DIR = path.join(ROOT, 'photos');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(ROOT, 'scripts/state.json');
const MANIFEST_FILE = path.join(DATA_DIR, 'manifest.json');
const CAPTIONS_FILE = path.join(DATA_DIR, 'captions.json');
const FONT_FULL = path.join(ROOT, 'assets/fonts/mashanzheng-full.ttf');
const FONT_OUT = path.join(ROOT, 'assets/fonts/mashanzheng-subset.woff2');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function magick(args, opts = {}) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4e6, ...opts });
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ---------- 1. 元数据源 ----------
const indexData = loadJson(cfg.indexJson, null);
if (!indexData) {
  console.error(`[!] 找不到索引文件 ${cfg.indexJson}，将只按文件名解析日期`);
}
const indexMap = new Map();
for (const row of indexData?.rows ?? []) {
  indexMap.set(row.name.replace(/\.[^.]+$/, ''), row);
}

const captions = loadJson(CAPTIONS_FILE, {});

// ---------- 2. 待处理文件清单 ----------
const sourceDir = cfg.sourceDir;
if (!fs.existsSync(sourceDir)) {
  console.error(`[!] 原图目录不存在: ${sourceDir}`);
  process.exit(1);
}
let files = fs.readdirSync(sourceDir)
  .filter(f => IMG_EXT.has(path.extname(f).toLowerCase()))
  .sort();

const selection = loadJson(path.join(ROOT, cfg.selectionFile), null);
if (selection) {
  const sel = new Set(selection.map(s => s.replace(/\.[^.]+$/, '')));
  files = files.filter(f => sel.has(f.replace(/\.[^.]+$/, '')));
  console.log(`[i] 使用选片清单 ${cfg.selectionFile}：${sel.size} 张入选`);
}

// ---------- 3. 增量处理 ----------
const state = loadJson(STATE_FILE, {});
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const warnings = [];
let processed = 0, skipped = 0;

function compress(srcFile, outWebp) {
  // target-size 多趟逼近 + quality 降档兜底，确保 ≤ maxBytes
  const qualities = [82, 72, 62];
  for (let i = 0; i < qualities.length; i++) {
    const args = [srcFile, '-auto-orient', '-strip', '-resize', `${cfg.longEdge}x${cfg.longEdge}>`];
    if (i === 0) args.push('-define', 'webp:method=4', '-define', `webp:target-size=${cfg.targetSize}`, '-define', 'webp:pass=6');
    else args.push('-define', 'webp:method=4');
    args.push('-quality', String(qualities[i]), outWebp);
    magick(args);
    if (fs.statSync(outWebp).size <= cfg.maxBytes) return;
  }
  warnings.push(`${path.basename(srcFile)}: 三趟压缩后仍 >${cfg.maxBytes >> 10}KB（${(fs.statSync(outWebp).size / 1024) | 0}KB）`);
}

function makeLqip(srcFile) {
  const buf = magick([srcFile, '-auto-orient', '-strip', '-resize', `${cfg.lqipSize}x${cfg.lqipSize}`,
    '-define', 'webp:method=6', '-quality', '55', 'webp:-'], { encoding: 'buffer' });
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

function dimsOf(webp) {
  const out = magick(['identify', '-format', '%w %h', webp]).toString();
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w, h };
}

function parseDateFromName(name) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  const d = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (d) return `${d[1]}-${d[2]}-${d[3]} 00:00:00`;
  return null;
}

const photos = {};
const newState = {};

for (const f of files) {
  const id = f.replace(/\.[^.]+$/, '');
  const src = path.join(sourceDir, f);
  const out = path.join(PHOTOS_DIR, `${id}.webp`);
  const st = fs.statSync(src);
  newState[id] = { size: st.size, mtimeMs: st.mtimeMs };

  const unchanged = state[id] && state[id].size === st.size && state[id].mtimeMs === st.mtimeMs && fs.existsSync(out);

  let lqip, dims;
  if (unchanged) {
    skipped++;
    lqip = makeLqip(src); // LQIP 极快，直接重算，避免 state 里存大字段
    dims = dimsOf(out);
  } else {
    compress(src, out);
    lqip = makeLqip(src);
    dims = dimsOf(out);
    processed++;
    console.log(`  [+] ${id}.webp ${(fs.statSync(out).size / 1024) | 0}KB ${dims.w}x${dims.h}`);
  }

  const row = indexMap.get(id);
  const cap = captions[id] ?? {};
  const date = cap.date ?? row?.date ?? parseDateFromName(id);
  if (!row) warnings.push(`${id}: 索引中无元数据${date ? '（已从文件名解析日期）' : '（且无法解析日期！）'}`);

  photos[id] = {
    date: date ?? '',
    month: date ? date.slice(0, 7) : 'unknown',
    desc: cap.desc ?? row?.desc ?? '',
    tags: cap.tags ?? row?.tags ?? ['待补充'],
    layout: cap.layout ?? null,
    w: dims.w, h: dims.h,
    file: `photos/${id}.webp`,
    lqip,
  };
}

// 移除已不在清单中的照片产物（selection 收缩时）
for (const f of fs.readdirSync(PHOTOS_DIR)) {
  const id = f.replace(/\.webp$/, '');
  if (!photos[id]) { fs.unlinkSync(path.join(PHOTOS_DIR, f)); delete newState[id]; }
}

// ---------- 4. 分页算法（确定性） ----------
const ids = Object.keys(photos).sort((a, b) => (photos[a].date || '').localeCompare(photos[b].date || '') || a.localeCompare(b));
const byMonth = new Map();
for (const id of ids) {
  const m = photos[id].month;
  if (!byMonth.has(m)) byMonth.set(m, []);
  byMonth.get(m).push(id);
}

const pages = [];
pages.push({ i: pages.length, type: 'cover' });
pages.push({ i: pages.length, type: 'title' });

const months = [];
const monthKeys = [...byMonth.keys()].sort();
for (const mk of monthKeys) {
  const list = byMonth.get(mk);
  months.push({ month: mk, label: monthLabel(mk), startPage: pages.length, count: list.length });
  pages.push({ i: pages.length, type: 'divider', month: mk, label: monthLabel(mk) });

  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const layout = buf.length === 1 ? 'single'
      : buf.every(id => photos[id].h > photos[id].w) ? 'pair' : 'stack';
    pages.push({ i: pages.length, type: 'photos', month: mk, layout, photos: [...buf] });
    buf = [];
  };
  for (const id of list) {
    if (photos[id].layout === 'hero') {
      flush();
      pages.push({ i: pages.length, type: 'photos', month: mk, layout: 'hero', photos: [id] });
      continue;
    }
    if (buf.length >= 2) flush();
    buf.push(id);
  }
  flush();
}

function monthLabel(mk) {
  if (mk === 'unknown') return '未知时间';
  const [y, m] = mk.split('-');
  return `${y}年${Number(m)}月`;
}

// ---------- 5. 标签统计 ----------
const tagCount = new Map();
for (const p of Object.values(photos)) {
  for (const t of p.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
}
const allTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([tag, n]) => [tag, n]);

// ---------- 6. 字体子集化 ----------
async function subsetFont() {
  if (!fs.existsSync(FONT_FULL)) {
    console.log('[i] 未找到 assets/fonts/mashanzheng-full.ttf，跳过字体子集化');
    return;
  }
  const { default: subsetFontFn } = await import('subset-font');
  const chars = new Set();
  const addText = s => { for (const ch of s ?? '') chars.add(ch); };
  for (const p of Object.values(photos)) { addText(p.desc); for (const t of p.tags) addText(t); }
  for (const c of Object.values(captions)) { addText(c.desc); for (const t of c.tags ?? []) addText(t); }
  for (const m of months) addText(m.label);
  addText('福宝的相册距离岁生日还有天今天啦刚到家第一年换春夏秋冬睡觉玩耍吃饭好奇慵懒小喵爪印目录时间轴标签全部推荐随机一张幻灯片夜间模式分享下载关闭返回上次看到第页封面');
  // GB2312 一级汉字（区位 16-55），保证后补文案不缺字
  const gbk = new TextDecoder('gbk', { fatal: false });
  for (let row = 16; row <= 55; row++) {
    for (let cell = 1; cell <= 94; cell++) {
      const ch = gbk.decode(new Uint8Array([0xa0 + row, 0xa0 + cell]));
      if (ch && ch !== '\uFFFD') chars.add(ch);
    }
  }
  const buf = await subsetFontFn(fs.readFileSync(FONT_FULL), [...chars].join(''), { targetFormat: 'woff2' });
  fs.writeFileSync(FONT_OUT, buf);
  console.log(`[i] 字体子集化完成：${chars.size} 字 → ${(buf.length / 1024) | 0}KB woff2`);
}
await subsetFont();

// ---------- 7. 写 manifest ----------
const manifest = {
  version: 1,
  built: new Date().toISOString(),
  birthday: cfg.birthday,
  photoCount: Object.keys(photos).length,
  pageCount: pages.length,
  photos,
  pages,
  months,
  allTags,
};
fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest));
fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 1));

console.log(`\n== 构建完成 ==`);
console.log(`照片 ${manifest.photoCount} 张（新压 ${processed}，跳过 ${skipped}），页面 ${pages.length} 页，月份 ${months.length} 个，标签 ${allTags.length} 种`);
console.log(`manifest: ${(fs.statSync(MANIFEST_FILE).size / 1024) | 0}KB`);
if (warnings.length) {
  console.log(`\n[!] ${warnings.length} 条警告：`);
  for (const w of warnings) console.log('   - ' + w);
}
