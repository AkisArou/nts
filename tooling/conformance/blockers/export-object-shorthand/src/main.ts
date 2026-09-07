// expect: emit-c --napi -> no wrapper for ucs2: is exported and is not a
//         function this backend can name
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
