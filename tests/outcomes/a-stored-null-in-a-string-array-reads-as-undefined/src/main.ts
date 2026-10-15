// run: check
//
// A `null` stored in a `(string | null)[]` is read back as `undefined` three
// ways, where node keeps it `null`.
//
// A reference slot holds a null pointer for `null` or for `undefined`, never
// both, and lowering tells the runtime which with the tag `null_slot` passes.
// - `sort()` is told `undefined` (tag 0) for this element type, so the null
//   sorts last where node sorts it as the string "null": `["z", null, "aa"]`
//   is `aa,z,N` here and `aa,N,z` in node. Data without an element after
//   "null" cannot tell the two apart, which is why an "a" and "b" fixture
//   agreed.
// - `at(i)` goes through `nts_array_at_ref`, whose null result is erased as
//   `undefined`, so a stored `null` reads as `undefined` ("U" where node
//   says "N"). `at` can also answer `undefined` for an index out of range, so
//   one null pointer cannot carry both here.
// - An index through the array erased (`unknown`, then `Array.isArray`) goes
//   through `nts_array_element`, told `undefined` because the read type is
//   `any[]`: the static type at an erased read cannot know, and the array
//   does not record at run time which absence its null slots hold.
//
// Each subject has a control that differs in one thing, `undefined` for
// `null`, which agrees.
//
// 2026-10-15: `sort()` and `at(i)` are fixed (the null slot asked of the
// receiver; `nts_array_at_element`), 87 disagreeing cases to 29. What is left
// is the erased read, which needs the array to say at run time which absence
// its null slots hold.
export function sortWithNull(n: number): string {
  const xs: (string | null)[] = ["z", null, "a".repeat((n & 1) + 1)];
  xs.sort();
  return xs.map((x) => (x === null ? "N" : x)).join(",");
}
export function sortWithUndefined(n: number): string {
  const xs: (string | undefined)[] = ["z", undefined, "a".repeat((n & 1) + 1)];
  xs.sort();
  return xs.map((x) => (x === undefined ? "U" : x)).join(",");
}
export function atNull(n: number): string {
  const xs: (string | null)[] = ["z", null, "a".repeat((n & 1) + 1)];
  const x = xs.at(1);
  return x === null ? "N" : x === undefined ? "U" : x;
}
export function atUndefined(n: number): string {
  const xs: (string | undefined)[] = ["z", undefined, "a".repeat((n & 1) + 1)];
  const x = xs.at(1);
  return x === null ? "N" : x === undefined ? "U" : x;
}
function second(a: unknown): unknown {
  return Array.isArray(a) ? a[1] : 0;
}
export function erasedNull(n: number): string {
  const xs: (string | null)[] = ["a".repeat((n & 1) + 1), null];
  const x = second(xs);
  return x === null ? "N" : x === undefined ? "U" : "S";
}
export function erasedUndefined(n: number): string {
  const xs: (string | undefined)[] = ["a".repeat((n & 1) + 1), undefined];
  const x = second(xs);
  return x === null ? "N" : x === undefined ? "U" : "S";
}
