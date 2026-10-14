// Pure TypeScript, no native code -- and still platform-sensitive.
//
// **This is the package that makes the intersection real.** It wants a
// monotonic clock. On the JVM that is `System.nanoTime`; on Apple it is
// `mach_absolute_time`; on Linux `clock_gettime(CLOCK_MONOTONIC)`. All three
// are reachable from the platform type surfaces, and none of them is present in
// all of them.
//
// So this file has to be written against what every target it ships to can
// answer -- the *intersection* -- or it has to branch, and branching means the
// build selects a module, which means it is no longer one file.
//
// Written here against the intersection, which today is `Date.now()` and is
// wrong for the purpose: it is not monotonic. That is the honest state of the
// question rather than a solved one.

export interface Span {
  readonly name: string;
  readonly startedAt: number;
}

export function begin(name: string): Span {
  // Not monotonic. See the header: the monotonic clock is exactly the API that
  // is spelled differently on every target, and this is what the intersection
  // leaves you with when nothing bridges them.
  return { name, startedAt: Date.now() };
}

export function elapsed(span: Span): number {
  return Date.now() - span.startedAt;
}
