// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "fNumber"
//
// **An object crosses outward only if every field is a scalar.** Nine
// functions returning a one-field object, differing in nothing but that field:
//
//     { v: number }        ok        { v: number[] }    returns an object
//     { v: string }        ok        { v: string[] }    returns an object
//     { v: boolean }       ok        { v: Uint8Array }  returns an object
//                                    { v: Inner }       returns an object
//                                    { v?: number }     returns an object
//                                    { v: Inner|null }  refused before the wrapper
//
// The three that cross are the controls. They say the object machinery works,
// so the six declines are field *kinds* rather than objects being
// unsupported -- and they all give the same message, `returns an object`, which
// names the return and not the field that stopped it.
//
// **No nesting.** `{ v: Inner }` where `Inner` is `{ a: number }` declines, so
// the rule is flat-scalar and not scalars-all-the-way-down.
//
// **What it costs, concretely.** `os.userInfo` answers
//
//     { uid, gid, username: Buffer, homedir: Buffer, shell: Buffer | null }
//
// so it cannot cross even after its two lowering refusals are fixed -- three of
// its five fields are views and one is a nullable object. `os` is the module
// closest to green at 17 of node's 23 names, and `userInfo` is one of the six
// missing.
//
// This is the third face of the same boundary. The other two are
// `array-return-only-carries-numbers` (outward: `number[]` only) and
// `parameter-boundary-carries-four-types` (inward: four scalars plus
// `number[]`). An object is the one thing that crosses out and not in, and its
// fields are narrower than the boundary either way.

interface Inner {
  a: number;
}

// Controls. These three are what say the machinery exists.
export function fNumber(): { v: number } {
  return { v: 1 };
}
export function fString(): { v: string } {
  return { v: "a" };
}
export function fBool(): { v: boolean } {
  return { v: true };
}

export function fNumbers(): { v: number[] } {
  return { v: [1] };
}
export function fStrings(): { v: string[] } {
  return { v: ["a"] };
}
export function fView(): { v: Uint8Array } {
  return { v: new Uint8Array(1) };
}
export function fObject(): { v: Inner } {
  return { v: { a: 1 } };
}
export function fOptional(): { v?: number } {
  return { v: 1 };
}
