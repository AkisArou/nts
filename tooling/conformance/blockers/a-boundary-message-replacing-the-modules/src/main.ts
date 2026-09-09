// expect: emit-c --napi -> calls (() => { try { exports.takesANumber("x"); return "no throw"; } catch (e) { return e.message; } })() === "expected a number argument"
// control: typeof exports.takesANumber === "function"
//
// The boundary's argument check rejects before the module's validator runs, and
// substitutes its own message.
//
//     compiled   message: expected a number argument
//                code:    ERR_INVALID_ARG_TYPE
//                name:    TypeError
//     node       message: The "value" argument must be of type number.
//
// **The code and the name are right.** So this is neither the missing-code
// defect nor a lost error type: the wrapper manufactures a `TypeError` carrying
// node's code and its own wording, because `napi_get_value_double` fails on the
// argument and the module's own `typeof` check is never reached.
//
// # Where it lands
//
// `os` is the module nearest to whole -- 5 passed, 4 failed of 9 applicable --
// and this is one of the four. `test-os-process-priority.js` asserts
// `/The "pid" argument must be of type number\./` and gets
// `expected a number argument`.
//
// The other three are one chain each. `networkInterfaces` needs `getCIDR`,
// which needs `Number.parseInt`. `userInfo` needs `userInfoString`, which calls
// `Buffer.from`, which needs `objectToBuffer`, which needs `in` on a bare
// `object`. Both roots are filed -- `the-number-parsing-builtins` and
// `in-on-an-undeclared-object` -- so **os is four failures from whole and every
// one is behind something already named.**
//
// # The scalar case of a defect already fixed for rest elements
//
// `rest-element-error-replaces-the-modules-own` is a guard now: a rest element
// of the wrong type gets node's error rather than
// `could not gather the rest arguments`. The same substitution still happens for
// an ordinary scalar parameter, which is the far more common shape.
//
// # Why this is not in `agreements/`
//
// It was written there first and could not be expressed. An agreement case runs
// inside the compiled program, and reading the message means catching the throw
// -- and **an exception does not cross a call frame**, so the `try` never
// catches and the case reports the exception defect instead of this one.
//
// The `calls` form catches in JavaScript, outside the addon, where the throw has
// already arrived. A defect that blocks the instrument you would use to measure
// another defect is worth the paragraph.
//
// The expectation asserts the wrapper's message, which is what is true now; when
// the module's message arrives instead, the expectation stops matching and the
// run asks for a person.

export function takesANumber(value: number): number {
  if (typeof value !== "number") {
    throw new TypeError('The "value" argument must be of type number.');
  }
  return value + 1;
}
