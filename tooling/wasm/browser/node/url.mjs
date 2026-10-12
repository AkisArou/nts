// node:url for a browser page: a filesystem path is served under /fs.
const encode = file => file.split('/').map(encodeURIComponent).join('/');
export function pathToFileURL(file) { return new URL(`/fs${encode(file)}`, location.origin); }
export function fileURLToPath(url) {
  const pathname = new URL(url, location.origin).pathname;
  if (!pathname.startsWith('/fs/')) throw new TypeError(`not a served file: ${url}`);
  return decodeURIComponent(pathname.slice(3));
}
export default { pathToFileURL, fileURLToPath };
