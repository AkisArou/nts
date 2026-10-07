// A closure answering a `bigint` that may throw, called inside a `try`.
//
// The call goes through the closure's raising copy, whose raising path returns
// a placeholder of the closure's own return type. A predicate written when a
// `bigint` and a native pointer had no placeholder kept refusing them after
// `raised_return` gained both, so this compiled to an entry that aborted at run
// time on every lane -- "calling `Closure0#call` from inside a `try`, whose
// raising copy would have to return a value of a type that has none to return".
// The Chromium lane met the native-pointer half
// (blockers/a-raising-handle-returning-closure-called-as-void).
function attempt(f: () => bigint): string {
  try {
    return String(f());
  } catch {
    return "caught";
  }
}

/** Throws above 2, so both paths of the raising copy run. */
export function big(n: number): number {
  return attempt(() => {
    if (n > 2) throw new Error("x");
    return BigInt(Math.trunc(n)) * 3n;
  }).length;
}

/** The control: the same closure with no `throw`, which needs no raising copy. */
export function plain(n: number): number {
  return attempt(() => BigInt(Math.trunc(n)) * 3n).length;
}
