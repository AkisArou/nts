// An arrow whose body can call a function that never returns, called inside a
// `try` through a function value.
//
// Inside the `try` the arrow is called through its raising entry, and its body
// is lowered again as a raising copy: after each call that can raise, a flag
// test, and the branch where nothing was raised carries on with the call's
// value. A call to a `never` function only comes back by raising, so that
// branch cannot run -- and it used to be emitted anyway, using the `never`
// value: `ret %1` for `() => fail()`, a `convert` for `c ? fail() : n`. Every
// backend refuses to materialise a `never` (C NTS2002, the JVM NTS4001), so
// both closures were declined and every export calling them with them. The
// branch is `unreachable` now.
//
// And on the JVM a second gap stood behind it: with every call inside the
// `try`, the closure's ordinary entries are pruned and only the raising one is
// left, which the JVM did not count as callable -- so it was not related to
// its signature (the JVM lane's fix, landed beside this).
//
// test262 writes this shape constantly: `assert.throws(E, () => new C())`
// where `C`'s constructor always throws.
//
// **Control:** `plain`, an arrow with no `never` in it through the same
// parameter, which compiled before.
//
// Transcribed from node (v24), each export called with 3 and 200:
//
//     alwaysThrows 5 202     mayReturn 4 202     plain 4 201

function run(make: () => unknown): number {
  try {
    make();
    return 1;
  } catch {
    return 2;
  }
}

function fail(): never {
  throw new Error("x");
}

// Can only throw.
export function alwaysThrows(n: number): number {
  return run(() => fail()) + n;
}

// Throws on one branch and returns on the other.
export function mayReturn(n: number): number {
  return run(() => (n > 100 ? fail() : n)) + n;
}

export function plain(n: number): number {
  return run(() => n + 1) + n;
}
