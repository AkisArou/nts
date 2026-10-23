// A string parameter whose one use is the left side of a concatenation is
// one the function is about to give away, so it takes it over (`own`): the
// caller hands its reference in and `out + piece` appends in place where the
// count allows. `s = add(s, piece)` round a loop is then linear, as `s +=
// piece` is, where it copied the whole of `s` every time.
//
// Taken over: `add`, `addBoth` (one concatenation chain), `relay` (handed to
// a slot `add` takes over), `either` (one concatenation on each of two
// exclusive paths) and `joined` (the same, the paths meeting before the
// return). The one-difference controls keep borrowing: `measured` reads `out`
// a second time, `twiceOnAPath` appends onto it twice on one path, `looped`
// hands it round a loop, and `addExported` is called from outside, where no
// caller hands anything over.

function add(out: string, piece: string): string {
  return out + piece;
}

function addBoth(out: string, a: string, b: string): string {
  return out + a + b;
}

function relay(out: string, piece: string): string {
  return add(out, piece);
}

function either(out: string, flag: boolean): string {
  if (flag) {
    return out + "<";
  }
  return out + ">";
}

// One append in each arm, the arms meeting before one return: no single
// append stands in front of the return, and every path still passes one.
function joined(out: string, flag: boolean): string {
  let next: string;
  if (flag) {
    next = out + "[";
  } else {
    next = out + "]";
  }
  return next;
}

// Read twice on one path: an append onto `out`, then on one path a second
// append onto `out` itself, so no single read is where it is given away.
function twiceOnAPath(out: string, flag: boolean): string {
  let next = out + "(";
  if (flag) {
    next = out + ")";
  }
  return next;
}

function measured(out: string, piece: string): string {
  return out + piece + String(out.length);
}

function looped(out: string, times: number): string {
  for (let i = 0; i < times; i++) {
    out = out + "~";
  }
  return out;
}

export function addExported(out: string, piece: string): string {
  return out + piece;
}

function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum = (sum * 31 + text.charCodeAt(i)) | 0;
  }
  return sum;
}

export function build(seed: number): number {
  const rounds = (seed & 63) + 1;
  let s = "";
  for (let i = 0; i < rounds; i++) {
    s = add(s, "ab");
    s = addBoth(s, "c", String(i & 7));
    s = relay(s, "|");
    s = either(s, (i & 1) === 0);
    s = joined(s, (i & 2) === 0);
  }
  return s.length * 1000 + (checksum(s) & 511);
}

export function controls(seed: number): number {
  const rounds = (seed & 15) + 1;
  let s = "x";
  for (let i = 0; i < rounds; i++) {
    s = measured(s, "m");
    s = looped(s, i & 3);
    s = addExported(s, "e");
    s = twiceOnAPath(s, (i & 1) === 0);
  }
  return s.length * 1000 + (checksum(s) & 511);
}

// A string taken over by a call that may throw, inside a `try` round a loop:
// `throwsFirst` raises before its append and keeps borrowing; `appendsFirst`
// appends, then may raise, and takes its string over -- the caller, which
// reads its string after a throw, holds a reference of its own, so the
// append copies and the string survives. tests/memory/a-string-taken-over-
// by-a-call-that-throws counts the same shape and finds nothing left behind.
function throwsFirst(out: string, x: number): string {
  if (x < 0) {
    throw new Error("x");
  }
  return out + "y";
}

function appendsFirst(out: string, x: number): string {
  const grown = out + "z";
  if (x < 0) {
    throw new Error("x");
  }
  return grown;
}

export function throwing(seed: number): number {
  let s = "s";
  let t = "t";
  let caught = 0;
  for (let i = 0; i < 12; i++) {
    const x = ((seed + i) % 4) - 1;
    try {
      s = throwsFirst(s, x);
    } catch {
      caught = caught + 1;
    }
    try {
      t = appendsFirst(t, x);
    } catch {
      caught = caught + 1;
    }
  }
  return s.length * 10000 + t.length * 100 + caught;
}

// A caller that keeps reading its string after the call: handing it over
// would take a retain, the count would be two, and the append would copy
// anyway. So `addKept`, whose only caller keeps its argument, keeps
// borrowing: one such caller leaves a parameter borrowed for all of them,
// which is why it is not `add`.
function addKept(out: string, piece: string): string {
  return out + piece;
}

export function keptByTheCaller(seed: number): number {
  const base = "base" + String(seed & 7);
  const longer = addKept(base, "+tail");
  return base.length * 100 + longer.length + (checksum(base) & 7);
}
