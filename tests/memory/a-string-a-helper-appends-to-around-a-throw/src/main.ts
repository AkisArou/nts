// A string a runtime helper appends onto (`out + String(n)`, sent to
// `nts_str_append_number`, which takes `out` over), with a throw on either
// side of the append, inside a `try` round a loop, some iterations raising.
//
// `throwsFirst` raises before its append: the call reaches
// `throwsFirst@raises`, whose raise path returns before the helper, so the
// helper's slot is not on every path and the function keeps borrowing `out`.
//
// `appendsFirst` appends, then may raise: the helper's slot is on every path
// and `appendsFirst@raises` takes `out` over. The caller reads its string
// after a throw, so it keeps a reference of its own beside the one it hands
// over: the count is two, the helper copies, and the string it made is given
// back on the raise path.

function throwsFirst(out: string, n: number): string {
  if (n < 0) {
    throw new Error("n");
  }
  return out + String(n);
}

function appendsFirst(out: string, n: number): string {
  const grown = out + String(n);
  if (n < 0) {
    throw new Error("n");
  }
  return grown;
}

export function work(seed: number): number {
  let s = "s";
  let t = "t";
  let caught = 0;
  for (let i = 0; i < 12; i++) {
    const n = ((seed + i) % 4) - 1;
    try {
      s = throwsFirst(s, n);
    } catch {
      caught = caught + 1;
    }
    try {
      t = appendsFirst(t, n);
    } catch {
      caught = caught + 1;
    }
  }
  return s.length * 10000 + t.length * 100 + caught;
}
