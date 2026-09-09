// expect: emit-c --napi -> no wrapper for holderOfFunctions: is exported and is not a function this backend can name
//
// A value export whose properties are **functions** does not cross. One whose
// properties are scalars does, and the same functions exported directly do.
//
// # The controls
//
//     export const holderOfFunctions = { one, two }   -> REFUSED
//     export const holderOfScalars = { a: 1, b: "x" } -> crosses
//     export { one, two }                             -> crosses
//
// The second control is the one that matters. `blockers/object-value-export`
// and `blockers/value-export` both assert that value exports publish, and both
// hold -- so "value exports do not cross" is the wrong reading and would send
// somebody to re-fix something that works. It is the function-valued properties.
//
// # Where it bites: this is the whole of `querystring`
//
// `runtime/node/querystring/src/main.ts:451` is
//
//     export const QueryString = { unescapeBuffer, unescape, escape,
//                                  stringify, encode, parse, decode }
//
// and it is not decoration. Node's `parse` reads `unescape` off that object at
// call time rather than closing over a module-local binding, because replacing
// `querystring.unescape` has to change what `parse` does -- node's own tests
// check it. An ESM module has no `module.exports` to read back, so the object is
// explicit.
//
// `runtime/node/querystring/shape.mjs` therefore returns `exports.QueryString`
// itself rather than a spread, since a spread would hand the test one object and
// `parse` another. When the export does not cross, the shim falls through to its
// partial path and `parse`, `decode`, `encode` and `stringify` are all absent at
// once. That is why the module reads **1 passed, 7 failed** compiled against
// **8 passed, 0 failed** interpreted: one object holds the module shut.
//
// Its other two items are `stringify: takes an object`
// (`blockers/object-parameter-at-the-wrapper`) and `decodeURIComponent`
// (`blockers/missing-builtin`), and neither of them is reachable while this one
// stands.

function one(): number {
  return 1;
}

function two(s: string): string {
  return s;
}

/** The reduction: a value export whose properties are functions. */
export const holderOfFunctions = { one, two };

/** Control: the same shape, scalar properties. */
export const holderOfScalars = { a: 1, b: "x" };

/** Control: the same functions, exported directly. */
export { one, two };
