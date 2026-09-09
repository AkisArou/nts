// expect: an `in` naming `maybe`, which is optional -- its slot exists here
//   whether or not it was written, and `{}` and `{ maybe: undefined }` disagree
//   in JavaScript
//
// The expectation carries the whole message on purpose. Written as the prefix
// `an `in` naming `maybe`, which is optional` it could not tell this message
// from one that changed only its tail, so a fix that reworded the explanation
// would leave this reading "reproduces" forever. The compiler lane found the
// same shape in its own guard, where `requires 1 argument` matched
// `requires 1 arguments` because the plural was unconditional.
//
// `"required" in row` lowers. `"maybe" in row` does not, when `maybe` is
// declared optional: the slot exists in the layout whether or not it was ever
// written, so no test of the value can answer the question `in` is asking.
//
//     "required" in row   -> lowers
//     "maybe" in row      -> REFUSED
//
// `requiredKey` is the control. Without it the diagnostic reads as "`in` is
// refused", which is false and is a different blocker --
// `in-with-a-computed-key` is that one, where the key is a variable rather than
// optional.
//
// 52 distinct sites in `runtime/node`, counted as sites rather than summed over
// cones. It is how one asks "did the caller pass this option", which every
// options bag in the profile does.

interface Row {
  required: number;
  maybe?: number;
}

export function requiredKey(row: Row): boolean {
  return "required" in row;
}

export function optionalKey(row: Row): boolean {
  return "maybe" in row;
}
