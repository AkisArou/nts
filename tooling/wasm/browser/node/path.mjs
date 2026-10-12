// node:path (POSIX) for a browser page.
function normalize(file) {
  const absolute = file.startsWith('/');
  const parts = [];
  for (const part of file.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (parts.length && parts.at(-1) !== '..') parts.pop(); else if (!absolute) parts.push('..'); continue; }
    parts.push(part);
  }
  return (absolute ? '/' : '') + parts.join('/') || (absolute ? '/' : '.');
}
export function join(...parts) { return normalize(parts.filter(Boolean).join('/')); }
export function resolve(...parts) {
  let file = '';
  for (const part of parts) file = part.startsWith('/') ? part : `${file}/${part}`;
  return normalize(file.startsWith('/') ? file : `${globalThis.process.cwd()}/${file}`);
}
export function dirname(file) { const at = file.lastIndexOf('/'); return at <= 0 ? (at === 0 ? '/' : '.') : file.slice(0, at); }
export function basename(file, suffix) { const base = file.slice(file.lastIndexOf('/') + 1); return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base; }
export function extname(file) { const base = basename(file); const at = base.lastIndexOf('.'); return at > 0 ? base.slice(at) : ''; }
export const sep = '/';
export default { join, resolve, dirname, basename, extname, sep, normalize };
