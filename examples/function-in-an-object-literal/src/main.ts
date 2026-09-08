// A module-scope function held in an object literal and called through it.
//
// This is how a module publishes a namespace: `querystring` writes
//
//     export const QueryString = { unescape, escape, stringify, parse, ... };
//
// and its own `parse` reads `QueryString.unescape` off that object at call time
// rather than closing over it, because node's tests replace the property and
// expect `parse` to pick the replacement up.
//
// **The JVM backend fails to verify this**, at class load rather than at
// emission:
//
//     java.lang.VerifyError: Bad type on operand stack
//
// It is **not the shorthand**: `{ doubled: doubled }` fails exactly as
// `{ doubled }` does, so it is not the resolution `examples/shorthand-property`
// covers. And it is **not new**: it reproduces on the binary committed before
// the shorthand work, so that work revealed it rather than caused it.
//
// # Why there is no control in this file
//
// Every control I tried made it stop reproducing. All three of these pass on
// the JVM, and each was written to be the *control* for the line above it:
//
//     const one = { doubled };            // fails alone
//     const two = { doubled, halved };    // adding this makes `one` pass
//
//     const one = { doubled };            // fails alone
//     const two = { scaled, shifted };    // adding this makes `one` pass too,
//                                         // so it is not the shared field name
//
// A second object literal holding functions anywhere in the program suppresses
// it. Whatever decides the call is direct is looking at more than the field, so
// a file containing both the subject and its control contains neither.
//
// That is worth more than the reproduction. A fixture whose control removes the
// defect it controls for reports green and means nothing, and this one would
// have -- the first version of this file had the pair in it and passed on every
// backend while the two-line probe beside it failed.
//
// So the controls are written above as text and the file holds only the shape
// that fails. If this ever passes, check that nothing has been *added* to it.

function doubled(n: number): number {
  return n * 2;
}

const table = { doubled };

export function throughAModuleTable(n: number): number {
  return table.doubled(n);
}

export function throughATableBuiltHere(n: number): number {
  const local = { doubled };
  return local.doubled(n);
}
