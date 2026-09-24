// expect: emit-c --napi -> publishes holderOfFunctions
//
// FIXED 2026-09-24, kept as a guard. `{ one, two }` is shorthand, and
// `namespace_of` required explicit keys -- so this published nothing while
// `punycode`'s identical shape published, because its imports forced explicit
// keys on it. `blockers/export-object-shorthand` carries the full account.
//
// This fixture is also what caught the fix's second bug: `export { one, two }`
// below gives the export specifiers symbols spelled `one` and `two` that alias
// to the same functions, so counting symbols by name called them shadowed and
// refused. Candidates are deduplicated by the declaration they resolve to now,
// and two *different* functions of one name are still the coin toss that
// refuses. Do not remove the `export { one, two }` line: it is the arm that
// distinguishes those.
//
// **The message changed on 2026-09-11 and the fixture is why it could.** It read
// `is exported and is not a function this backend can name`, which is true of
// the *export shape* and sends a reader to look at export shapes -- when the
// thing to look at is a crossing for an object type. The Node lane reported it
// as wrong twice: 44 of `assert`'s declined exports carried it, and
// `assert.deepStrictEqual` is a function.
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
// (provided since 2026-09-11), and neither of them is reachable while this one
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
