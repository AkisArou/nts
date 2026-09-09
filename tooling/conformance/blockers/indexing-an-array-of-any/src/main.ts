// expect: lowers
//
// FIXED, kept as a guard. An element of an array of `any` reads now.
//
// `lowers` rather than `nothing refused`, because that spelling also requires
// the wrapper to carry it and `subject` takes and returns `unknown`, which is
// declined at the boundary for `unknown-at-the-boundary` -- somebody else's
// blocker, and no reason to keep this one red.
//
// # What it was
//
// The other half of `length-after-array-isarray`, and it arrived the moment
// that one was fixed. `Array.isArray` narrows an `unknown` to `any[]`. Reading
// `.length` off the result lowers -- a length is in the header every reference
// carries, so it needs no element type. Reading an *element* did not, because
// an element has a width and `any` does not say what it is.
//
// # What changed
//
// The width was never the missing half on its own. `NtsDescriptor` carried
// `size` and `references` already, which is enough to *find* an element and not
// to read one: eight bytes is a `double` or an `int64_t`, and both are emitted
// -- element narrowing picks a signed 64-bit width for an array that leaves the
// `i32` range and stays inside the safe integers, so the two descriptors
// differ in `name` and in nothing else a reader can switch on.
//
// So the descriptor gained an element *kind*, and `nts_array_element` reads the
// slot through it. Zero means "this descriptor was written before the field
// existed" and refuses, loudly, naming the array -- it never guesses, because a
// guess at eight bytes returns 4.2439915819305446e-314 for 8589934592 and
// `typeof` still says "number".
//
// # The three controls
//
// `control` says indexing is not what was refused. `lengthStillLowers` says the
// fix that landed before this one is still landed. `subject` is the fix itself.
//
// Two more live elsewhere, because neither fits in a lowering fixture:
// `runtime/c/tests/elements.c` checks the read against each element kind and
// was controlled by making the runtime guess from width alone -- three checks
// fail. `examples/dynamic-element` checks the whole path against node and was
// controlled the same way -- `wide`, `widest` and `text` disagree.
//
// # What is still refused, deliberately
//
// Writing. `xs[i] = v` under the same guard names itself and stops: the value
// being stored has a static type that need not be the slot's, and narrowing a
// double into an `int64_t[]` is a conversion with no obvious place to be
// decided. Reading through a descriptor and writing through one are not the
// same feature.

export function control(items: string[], index: number): string {
  return items[index] ?? "";
}

export function lengthStillLowers(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

export function subject(value: unknown, index: number): unknown {
  if (Array.isArray(value)) {
    return value[index];
  }
  return undefined;
}
