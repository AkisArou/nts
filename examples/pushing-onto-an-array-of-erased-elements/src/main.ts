// `xs.push(v)` where `xs` is `unknown[]`.
//
// An erased element is a sixteen-byte `NtsValue`, so every array method that
// *writes* or *copies* one needs an entry point that knows that width. Reading
// needs none -- the emitter indexes `NTS_ITEMS(a, NtsValue)` directly -- which is
// why `xs[0]` on an `unknown[]` has always worked and `xs.push(v)` had not.
//
// The React lane's runtime keeps `unknown[]` for children, logs and error lists,
// and `push` on one was 10 root refusals there.
//
// `slice` and `splice` on such an array are **still refused**, and the message
// says so. Their helpers were written with this one and withdrawn: `slice` needs
// a `nts_value_retain` per copied element, both need the argument defaults
// JavaScript gives them, and landing a helper nothing calls is scaffolding.

/** One element of each tag, so the write is exercised at more than one width. */
export function pushesThreeTags(n: number): number {
  const xs: unknown[] = [];
  xs.push(n);
  xs.push("two");
  xs.push(true);
  return xs.length;
}

/**
 * **The control that the elements survive the push**, which a length count
 * cannot see: a slot written at the wrong width reads back as unrelated memory,
 * and `length` would still be 3.
 */
export function readsBackWhatItPushed(n: number): number {
  const xs: unknown[] = [];
  xs.push(n);
  xs.push("abcd");
  const first = xs[0];
  const second = xs[1];
  const a = typeof first === "number" ? first : -1;
  const b = typeof second === "string" ? second.length : -1;
  return a * 10 + b;
}

/**
 * **The control that a reference survives it**, which a number and a string
 * cannot show between them: `push` is *consuming*, so the array owes the
 * reference a release and the value must still be there to read after the
 * pushing frame would have dropped it.
 */
export function pushesAReference(n: number): number {
  const xs: unknown[] = [];
  const held = { at: n, label: "kept" };
  xs.push(held);
  const back = xs[0];
  if (back === null || typeof back !== "object") return -1;
  return (back as { at: number; label: string }).at;
}

/**
 * The control that the numeric family is untouched: the same method on an array
 * whose elements are doubles, which has always gone through `nts_array_push`.
 */
export function theNumericPushIsUnchanged(n: number): number {
  const ns: number[] = [];
  ns.push(n);
  ns.push(n + 1);
  return ns.length + ns[1];
}
