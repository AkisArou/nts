// expect: emit-c --napi -> publishes ucs2
//
// FIXED 2026-09-24, kept as a guard. **The diagnosis below was right and the
// cause was not where any comment said it was.**
//
// `object_crosses` in the napi backend was never the defect. Its comment blames
// its own empty-fields rule and dead-code elimination, and names a `Layout`
// callability flag as the repair; the layout dump refutes all three. `ucs2`'s
// layout carries both fields, and `querystring`'s `QueryString` carries all
// seven -- nothing is emptied, and an object whose fields are functions is
// correctly refused as a *value* export either way.
//
// What publishes such an object is `Program::public_namespaces`, and the gate is
// `namespace_of` (`compiler/core/src/hir/lower.rs`), which required every member
// to be spelled with an explicit key. So the fixture's own word for it -- **a
// spelling** -- was exactly right.
//
// Two things the fix needed beyond widening the kind test, both found by
// instrumenting rather than by reading:
//
//   * **A shorthand's symbol is the property's, not the binding's.** Its only
//     declaration is the shorthand node itself, so widening the kind test alone
//     is a no-op. Resolved by name within the literal's own file, the way
//     `shorthand_value_symbol` resolves it against the bindings it has.
//   * **An object literal's key gets a symbol too**, spelled identically. A name
//     match finds three records for one function -- the function, the explicit
//     key, the shorthand -- so candidates are filtered to those that name a
//     function and deduplicated by the declaration they resolve to. Counting
//     records instead called `export { one }` beside `const held = { one }` a
//     shadowed binding and refused `blockers/value-export-holding-functions`,
//     whose whole subject is the shorthand.
//
// **The message changed on 2026-09-11**, from `is exported and is not a function
// this backend can name`. That sentence was true of the export *shape* and sent
// a reader there, when what is wanted is a crossing for an object type -- and it
// was outright false for the 44 `assert` exports that also carried it, every one
// of which is a function.
//
// Shorthand property syntax makes an exported object literal unpublishable.
// Spelling the same object with explicit keys publishes it. The two differ by
// nothing a reader would call a difference:
//
//     export const ucs2 = { decode, encode };                  // REFUSED
//     export const ucs2 = { decode: decode, encode: encode };  // published
//
// Same functions, same names, same object. Only the syntax differs.
//
// Found by disagreeing with the tree rather than by reading a diagnostic.
// `punycode` publishes its `ucs2` and a bare fixture of "an exported object
// literal of functions" did not, on the same binary, which should not have been
// possible. `punycode` writes `{ decode: codec.ucs2decode, encode:
// codec.ucs2encode }` -- explicit keys, because the functions it names live in
// another module and the shorthand was never available to it. So the module that
// works does not work because of anything it knows; it works because of a
// spelling its imports forced on it.
//
// Two candidates and a control separated them: explicit keys with differently
// named locals published, explicit keys with identically named locals published,
// shorthand refused. So it is not the name collision between the property and
// the local, which was the more interesting hypothesis and is wrong.
//
// Worth having because of what it implies about the other refusals of this kind.
// "Not a function this backend can name" is one message covering at least three
// different situations -- a value export, which is fixed; a class, which is real
// work; and this, which is a spelling. A grouped message is not a cause, and this
// is the third time that has been the lesson today.
function decode(input: string): string {
  return input;
}

function encode(input: string): string {
  return input;
}

export const ucs2 = { decode, encode };
