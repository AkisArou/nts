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
// A refusal and an absence are different answers: 403 is EACCES.
function failure(status, file) {
  const code = status === 403 ? 'EACCES' : 'ENOENT';
  const error = new Error(`${code}: ${file}`);
  error.code = code;
  return error;
}
export function readFileSync(file, encoding) {
  const xhr = request('GET', String(file));
  if (xhr.status !== 200) throw failure(xhr.status, file);
  if (!encoding) throw new TypeError('the browser shim reads text only; pass an encoding');
  return xhr.responseText;
}
export function existsSync(file) { return request('HEAD', String(file)).status === 200; }
export function writeFileSync(file, data) {
  if (globalThis.process.exited) return;
  if (request('POST', String(file), String(data)).status !== 200) throw new Error(`write refused: ${file}`);
}
export default { readFileSync, existsSync, writeFileSync };
