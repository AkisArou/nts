// A string a function appends onto is one it takes over (`own`), and a call
// that throws leaves the caller's string where it must survive the throw:
// inside a `try`, round a loop, some iterations raising.
//
// `f` throws before its append. The call reaches `f@raises`, whose raise path
// returns before the append, so the append does not dominate every return and
// `f@raises` keeps borrowing `out`: the append copies.
//
// `h` appends first and then may throw, so the append dominates both returns
// and `h@raises` takes `out` over. The caller still reads `t` after a throw --
// the loop goes round with it -- so it keeps a reference of its own and hands
// a second one over: the count is two, the append copies, and the string the
// append made is given back on the raise path where `h` drops it.

function f(out: string, x: number): string {
  if (x < 0) {
    throw new Error("x");
  }
  return out + "y";
}

function h(out: string, x: number): string {
  const grown = out + "z";
  if (x < 0) {
    throw new Error("x");
  }
  return grown;
}

export function work(seed: number): number {
  let s = "s";
  let t = "t";
  let caught = 0;
  for (let i = 0; i < 12; i++) {
    const x = ((seed + i) % 4) - 1;
    try {
      s = f(s, x);
    } catch {
      caught = caught + 1;
    }
    try {
      t = h(t, x);
    } catch {
      caught = caught + 1;
    }
  }
  return s.length * 10000 + t.length * 100 + caught;
}
