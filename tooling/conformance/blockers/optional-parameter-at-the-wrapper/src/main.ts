// expect: emit-c --napi -> emits-addon the compiled function requires 2 arguments
//
// An optional parameter crosses as a required one. `withOptional` is published
// -- this is not a decline -- and the wrapper it gets rejects a call that omits
// the optional argument, with `ERR_MISSING_ARGS`.
//
// `required` is the control: a genuinely two-parameter function should demand
// two, and the expectation above would be satisfied by that alone. So the
// fixture is written so the *only* function with an arity check is the one
// whose second parameter is optional, and `required` takes one parameter.
//
// Where it bites: `path.basename(p)` is how everyone calls it, and node's
// signature is `basename(path, suffix?)`. `basename` is one of the ten exports
// `path` publishes since the `instanceof` family landed, so this is a function
// that compiled, linked, published, and throws on the ordinary call --
// `test-path-basename.js` fails with "the compiled function requires 2
// arguments" rather than with a wrong answer.
//
// `node`'s own `basename.length` is 2 and ours is 0, which is a separate
// observation about the wrapper's function objects and not this blocker.

export function required(only: string): string {
  return only;
}

export function withOptional(value: string, suffix?: string): string {
  return suffix === undefined ? value : value + suffix;
}
