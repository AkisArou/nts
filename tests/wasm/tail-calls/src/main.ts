// Calls in tail position, which Wasm makes as `return_call`, so a recursion
// as deep as test262's `tco-*` does not exhaust the stack: directly, and
// through a join that only returns what the call answered (`??`). A call
// inside a `try` whose callee may throw keeps its frame, since the handler
// is the caller's, and so does one whose result is added to.

export function countdown(n: number): number {
  if (n <= 0) return 0;
  return countdown(n - 1);
}

function absentOr(n: number): number | null {
  return n <= 0 ? 0 : null;
}

export function throughJoin(n: number): number {
  if (n <= 0) return 0;
  return absentOr(n) ?? throughJoin(n - 1);
}

function thrower(n: number): number {
  if (n === 3) throw new RangeError("three");
  return n;
}

export function caught(n: number): number {
  try {
    return thrower(n);
  } catch {
    return -1;
  }
}

export function addedTo(n: number): number {
  if (n <= 0) return 0;
  return 1 + addedTo(n - 1);
}
