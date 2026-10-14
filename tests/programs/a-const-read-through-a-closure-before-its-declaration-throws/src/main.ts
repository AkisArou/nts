// A captured const read throws ReferenceError; a later read is the control.
function kind(e: unknown): string {
  return e instanceof ReferenceError ? "ReferenceError" : "other";
}

export function before(_n: number): string {
  function f(): number {
    return x + 1;
  }
  let out = "";
  try {
    out = "no throw " + String(f());
  } catch (e) {
    out = kind(e);
  }
  const x = 1;
  return out + " / after " + String(f());
}

export function afterOnly(_n: number): string {
  const y = 1;
  function g(): number {
    return y + 1;
  }
  return "after " + String(g());
}

