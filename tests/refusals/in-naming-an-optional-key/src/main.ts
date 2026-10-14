// expect: nothing refused
//
// **FIXED on 2026-09-12, and kept as a guard.** This filed the refusal:
//
//     an `in` naming `maybe`, which is optional -- its slot exists here
//     whether or not it was written, and `{}` and `{ maybe: undefined }`
//     disagree in JavaScript
//
// The slot still exists whether or not it was written; what changed is that the
// object header now records whether it *was*. One bit per optional property,
// in the `flags` word every object already carries -- bits 0 through 5 are
// spoken for by the string, array and collector flags and the other
// twenty-six were free, so it cost no memory and no ABI.
//
//     "required" in row   answered from the type, as before, with no test
//     "maybe" in row      answered from the bit
//
// `requiredKey` is the control and is now the more important half: it asserts
// that the *required* key did not start paying for a runtime test when the
// optional one gained one. A version that answered every `in` at run time
// would be correct and would give back what the closed world buys.
//
// # What this fixture could not have told you
//
// It was filed at **52 distinct sites**, and closing it moved the corpus by
// one distinct thing and two sites. The 52 are mostly the *other* blocker --
// `in-on-an-object-with-an-optional-declarer`, where the receiver is typed
// `object` and the declarer is found by a whole-program walk. That one still
// reproduces. Two fixtures for what read as one question, and the site count
// belonged to the other one.
//
// The ledger row is §1's `in` naming an optional property; the remaining half
// is a **computed** key, which leaves no set to test against and is
// `in-with-a-computed-key`.

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
