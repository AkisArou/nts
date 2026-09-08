// expect: `sort` on an array of references is not supported by this lowering yet
//
// `array.sort()` with no comparator, on an array of strings.
//
// Where it bites: `util/src/inspect.ts:1093` and `:1095` are `keys.sort()` and
// `output.sort()`, which is `util.inspect(value, { sorted: true })` -- a public
// node option, and the only two `.sort()` calls in the whole of `runtime/node`.
// So this is a small blocker with a small blast radius, which is worth saying
// plainly: it is not on `util`'s critical path the way the radix `toString` is
// on everyone's.
//
// The numeric case is the contrast that makes it a *reference* problem rather
// than a `sort` problem, and it is in this fixture so a fix that only handles
// numbers is visible as a partial one.
//
// Found by a probe that wanted to sort directory entries before comparing them,
// which is instrumentation rather than module source -- that sort moved to the
// comparison side, where it belongs. This fixture is the part that stays.

export function sortStrings(values: string[]): string {
  values.sort();
  return values.join(",");
}

export function sortNumbers(values: number[]): number {
  values.sort();
  return values[0] ?? 0;
}
