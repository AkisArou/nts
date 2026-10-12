// node:fs's synchronous reads and writes for a browser page, through the
// runner's server and a synchronous request. Writes after process.exit are
// dropped, as node would never have made them.
function request(method, file, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, `/${method === 'GET' || method === 'HEAD' ? 'fs' : 'write'}${file.split('/').map(encodeURIComponent).join('/')}`, false);
  if (method === 'GET') xhr.overrideMimeType('text/plain; charset=utf-8');
  xhr.send(body ?? null);
  return xhr;
}
export function readFileSync(file, encoding) {
  const xhr = request('GET', String(file));
  if (xhr.status !== 200) { const error = new Error(`ENOENT: ${file}`); error.code = 'ENOENT'; throw error; }
  if (!encoding) throw new TypeError('the browser shim reads text only; pass an encoding');
  return xhr.responseText;
}
export function existsSync(file) { return request('HEAD', String(file)).status === 200; }
export function writeFileSync(file, data) {
  if (globalThis.process.exited) return;
  if (request('POST', String(file), String(data)).status !== 200) throw new Error(`write refused: ${file}`);
}
export default { readFileSync, existsSync, writeFileSync };
