// run: check
// provider: rc
// sanitizer: address
//
// The control: the same, throwing an `Error`. It can hold a reference to
// itself, so the release that leaves it one makes it a cycle candidate, and
// the candidate buffer keeps it whole across the release one too many.
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
      throw new Error("over " + String(v));
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
    return (e as Error).message.length;
  }
}

