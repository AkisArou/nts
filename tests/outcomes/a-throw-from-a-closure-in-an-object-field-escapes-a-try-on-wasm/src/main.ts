// run: check
// backend: wasm

// L15: the throw escapes the try when the closure is called through h.f().
// The control passes the same closure to a parameter callee with the same
// try/catch. Each entry has one case so both arms are reached.

interface Holder {
  f: () => string;
}
function call(h: Holder): string {
  try { return h.f(); } catch { return "caught"; }
}
function guard(f: () => string): string {
  try { return f(); } catch { return "caught"; }
}
export function throughField(): string {
  const h: Holder = { f: () => { throw new Error("boom"); } };
  return call(h);
}
export function throughParameter(): string {
  const h: Holder = { f: () => { throw new Error("boom"); } };
  return guard(h.f);
}
