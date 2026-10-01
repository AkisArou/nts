// A raising call through an interface, reaching three implementors: one that
// throws, one that cannot, and one declaring fewer parameters than the
// interface.
//
// 34fabbfc0 made an interface member a dispatch root, so `sink.take(n)` inside
// a `try` dispatches at `Sink`'s raising slot. On the JVM that is
// `invokeinterface Sink.take$raises(D)D`, abstract on the interface, and each
// implementor has to define it under exactly that name and descriptor. Two did
// not: `Quiet`, whose slot holds its ordinary `take` because it cannot raise,
// was given a forwarder named `take` (a duplicate, dropped), and `Narrow`'s
// `take$raises()` had no bridge to `(D)D`, because the JVM backend took a
// slot's name and its bridge from the superclass chain only. Both were an
// `AbstractMethodError` on the first call to reach them -- 16 of 29 cases --
// while c, llvm and rc agreed and the verifier, linkage and SHADOWED all
// passed, since the copy they lack is abstract. `jvm-verifies` reports that
// shape now as UNFILLED.
//
// `Quiet` answers `n + 100` and `Narrow` `limit + 50`, unlike `Throwing`'s
// `n * 2`, so a call landing on the wrong body answers wrongly rather than
// agreeing by accident. Under node 12 of 32 inputs throw.
interface Sink {
  take(n: number): number;
}
class Throwing implements Sink {
  take(n: number): number {
    if (n > 5) throw new RangeError("too big");
    return n * 2;
  }
}
class Quiet implements Sink {
  take(n: number): number {
    return n + 100;
  }
}
class Narrow implements Sink {
  limit = 0;
  take(): number {
    if (this.limit > 3) throw new RangeError("over");
    return this.limit + 50;
  }
}

function pick(n: number): Sink {
  const k = n % 3;
  if (k === 0) return new Throwing();
  if (k === 1) return new Quiet();
  const s = new Narrow();
  s.limit = n & 7;
  return s;
}

export function dispatched(n: number): number {
  const sink = pick(n & 31);
  try {
    return sink.take(n & 15);
  } catch {
    return -1;
  }
}
