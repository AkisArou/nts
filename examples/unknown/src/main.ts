// `unknown`: a value with a representation but no facts.
//
// The erasure has to be at a *parameter*. A local written `const held: unknown
// = n` is narrowed straight back to `number` by the checker at every use, so it
// compiles to ordinary numeric code and tests nothing — which is the
// specialization `docs/any-unknown.md` hopes for, arrived at for free. A
// parameter has no such narrowing: inside the function the value is `unknown`
// and stays so until something tests it. That is also what the measurement
// counts, 612 of them across the node profile.
//
// Each exported wrapper takes and returns a `number` so the differential can
// drive it, and hands the value across an erasing boundary — which is the
// `console.log(...args)` shape in miniature.

// Carried: erased, moved, never read. It goes in as a number, travels as a
// tag beside a payload through a function that does nothing to it, and only
// the far end looks. Nothing here converts -- erased to erased is a copy.
function keeps(value: unknown): unknown {
  return value;
}

export function carried(n: number): number {
  return kind(keeps(n));
}

// Tested: the tag is read and the payload is not.
function kind(value: unknown): number {
  return typeof value === "number" ? 1 : 0;
}

export function tested(n: number): number {
  return kind(n);
}

// The full loop, and the only place a wrong answer would be silent: inside the
// branch the checker has narrowed `value` to `number`, while its declaration
// is `unknown`. Lowering has to notice and unerase.
function addOne(value: unknown): number {
  if (typeof value === "number") {
    return value + 1;
  }
  return -1;
}

export function unerased(n: number): number {
  return addOne(n);
}
