// run: check
// provider: rc
// sanitizer: address
//
// **Fixed 2026-10-14, kept as a guard**: `nts_raise` consumes its argument
// (`own::consumes`), so the raising copy no longer releases what it raised.
//
// An object thrown from a method called as a value inside a `try`, read by the
// handler: under counting, the raising copy gives back one reference more
// than it holds. `nts_raise` stores the thrown value without a count of its
// own and `nts_raise_take` hands it to the handler as owned, but the copy
// releases it after raising as well, so the object is freed while the raise
// slot still names it, and the handler reads freed memory.
//
// Without the sanitizer it agrees: the runtime recycles a freed block, so the
// read finds the field still there. The control throws an `Error`, which is
// held across the same release by the cycle buffer, and reads clean.
class Oops {
  code: number;
  constructor(code: number) {
    this.code = code;
  }
}

class Guard {
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  check(v: number): number {
    if (v > this.limit) {
      throw new Oops(v);
    }
    return v;
  }
}

export function caught(n: number): number {
  const guard = new Guard(3);
  const check = guard.check;
  try {
    return check.call(guard, n);
  } catch (e) {
    return (e as Oops).code * 10;
  }
}

