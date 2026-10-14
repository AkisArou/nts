// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "subject"
//
// FIXED, kept as a guard. A rest parameter crosses now.
//
// It was refused on the reading that "a wrapper handed one JavaScript array
// would have to decide whether it is the array or the first of the gathered
// arguments". That ambiguity was real when the shape was unknown, and
// `Param::shape` carries `Rest` now -- **and a rest parameter is never handed
// an array at all.** JavaScript gives it the trailing arguments one at a time,
// so the wrapper reads however many arrived and builds the array the compiled
// body expects.
//
// The count is not known at emit time, hence a two-phase `napi_get_cb_info`:
// the first call asks how many there are, the second reads them. Eight on the
// stack because `path.join(a, b)` is what callers write, and a heap buffer past
// that rather than a cap -- silently dropping the ninth argument would be a
// wrong answer, and `join` is exactly the function someone calls with a spread.
//
// Verified by loading the addon and calling it, across the cases that differ:
//
//     joinAll("a","b","c")        "abc"
//     joinAll()                   ""            <- empty rest is legal
//     after("x","y","z")          "x/y/z"       <- fixed parameters and a rest
//     joinAll(...Array(12))       twelve        <- past the stack buffer
//
// **`path` publishes `resolve` and `join` because of this**, going from 10
// exports to 12 and from 7 wrapper declines to 5. There is no fixed-arity
// spelling of either -- a rest parameter is how node declares both -- so this
// was the difference between the module publishing the two functions a caller
// reaches for first and not.
//
// What stays refused is a rest parameter this cannot *fill*: an array of
// objects needs a layout and an array of views carries the ownership question,
// which are the reasons those elements are refused anywhere. And a rest
// parameter that is not last, which TypeScript forbids and which is checked
// rather than assumed.
//
// `fixed` remains the control, or the diagnostic reads as "a string-taking
// function does not cross", which is false.

export function fixed(first: string, second: string): string {
  return first + second;
}

export function subject(...parts: string[]): string {
  let out = "";
  for (const part of parts) {
    out += part;
  }
  return out;
}
