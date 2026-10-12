// node:fs/promises's readFile for a browser page.
export async function readFile(file, options) {
  const response = await fetch(`/fs${String(file).split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) {
    // A refusal and an absence are different answers: 403 is EACCES.
    const code = response.status === 403 ? 'EACCES' : 'ENOENT';
    const error = new Error(`${code}: ${file}`);
    error.code = code;
    throw error;
  }
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? response.text() : new Uint8Array(await response.arrayBuffer());
}
export default { readFile };
