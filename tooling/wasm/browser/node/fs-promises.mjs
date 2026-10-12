// node:fs/promises's readFile for a browser page.
export async function readFile(file, options) {
  const response = await fetch(`/fs${String(file).split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) { const error = new Error(`ENOENT: ${file}`); error.code = 'ENOENT'; throw error; }
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? response.text() : new Uint8Array(await response.arrayBuffer());
}
export default { readFile };
