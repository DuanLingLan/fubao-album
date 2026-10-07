// git add + commit + push（有变更才提交）
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

git(['add', '-A']);
const staged = git(['diff', '--cached', '--name-only']).trim();
if (!staged) {
  console.log('[i] 无变更，跳过提交');
  process.exit(0);
}
const count = (filter) => git(['diff', '--cached', '--name-only', `--diff-filter=${filter}`])
  .trim().split('\n').filter(f => f.startsWith('photos/')).length;
const added = count('A');
const removed = count('D');
const date = new Date().toISOString().slice(0, 10);
const parts = [];
if (added) parts.push(`+${added}`);
if (removed) parts.push(`-${removed}`);
const msg = parts.length ? `album: ${parts.join(' ')} photos (${date})` : `album: update (${date})`;
git(['commit', '-m', msg]);
console.log(`[i] 已提交: ${msg}`);
git(['push'], { stdio: 'inherit' });
console.log('[i] 已推送到 GitHub');
