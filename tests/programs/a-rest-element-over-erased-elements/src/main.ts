// A rest element over an array of erased elements, and a spread copy of one.
//
// `const [first, ...others] = xs` with `xs: unknown[]` called the number
// array's slice, `nts_array_slice`, whatever the element: it copied eight
// bytes an element from offsets eight bytes apart, where an erased element is
// sixteen, so `others` held fragments of its values (C answered
// `undefined,other,b:true,undefined,...` where node answers
// `s:two,b:true,null,...`). The Wasm lane's test262 parity run found it, as
// the outcome this program was: Wasm declined the same call by name. Both
// now take `nts_array_slice_value`, chosen by the element type, and so does
// `[...xs]`, which was refused for want of it.
//
// The control, `typed`, differs from `mixed` only in the element type
// (`number[]`, whose slice the old one was).

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

// The copy is a fresh array: writing to it leaves the source as it was.
function copied(xs: unknown[]): string {
  const copy = [...xs];
  copy[0] = "changed";
  let out = "";
  for (const value of copy) out += describe(value) + ",";
  return out + describe(xs[0]);
}

export function spread(n: number): string {
  return copied([n, "two", false, null, { n }]);
}
