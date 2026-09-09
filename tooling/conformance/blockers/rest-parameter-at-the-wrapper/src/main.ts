// expect: emit-c --napi -> no wrapper for subject: takes a rest parameter
//
// A rest parameter lowers and does not cross. `subject` compiles -- the body
// below is emitted -- and the Node-API wrapper declines it, so the function
// exists in the addon and is not published.
//
//     fixed(first, second)   -> crosses
//     subject(...parts)      -> lowers, no wrapper
//
// `fixed` is the control and must keep crossing, or the diagnostic reads as
// "a string-taking function does not cross", which is false.
//
// It became the live blocker for `path` the moment the `instanceof` family
// completed. `validateString` compiled, and with it eleven of path's functions,
// taking the module from four published exports to ten -- `normalize`,
// `isAbsolute`, `relative`, `dirname`, `basename`, `extname` joined
// `_makeLong`, `toNamespacedPath`, `delimiter` and `sep`. What did not join
// them, and why:
//
//     resolve@posix   takes a rest parameter `args`     <- this
//     join@posix      takes a rest parameter `args`     <- this
//     format@posix    takes an object                   parameter-boundary-carries-four-types
//     parse@posix     returns an object                 array-return-only-carries-numbers
//     matchesGlob     no function of that name compiled glob-matcher's own six roots
//     posix, win32    not a function this backend can name   export-namespace
//
// `resolve` and `join` are the two functions a caller reaches for first, and a
// rest parameter is how node spells both. There is no variant of `path.join`
// that takes a fixed arity.

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
