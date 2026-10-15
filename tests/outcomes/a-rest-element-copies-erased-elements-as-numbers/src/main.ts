// run: check
//
// A rest element over an array of erased elements copies them with the
// number array's slice: `const [first, ...others] = xs` with `xs: unknown[]`
// calls `nts_array_slice`, which copies eight bytes an element from offsets
// eight bytes apart, where an erased element is sixteen. `others` holds
// fragments of its values. The control differs only in the element type,
// `number[]`, whose slice that is, and agrees.

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return "s:" + value;
  if (typeof value === "number") return "n:" + String(value);
  if (typeof value === "boolean") return "b:" + String(value);
  return "other";
}

function rest(xs: unknown[]): string {
  const [first, ...others] = xs;
  let out = describe(first) + "|";
  for (const other of others) out += describe(other) + ",";
  return out + String(others.length);
}

export function mixed(n: number): string {
  return rest([n, "two", true, null, undefined, 6.5, "seven"]);
}

function typedRest(xs: number[]): string {
  const [first, ...others] = xs;
  let out = "n:" + String(first) + "|";
  for (const other of others) out += "n:" + String(other) + ",";
  return out + String(others.length);
}

export function typed(n: number): string {
  return typedRest([n, n + 1, n + 2, n + 3]);
}
