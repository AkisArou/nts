// expect: NTS1001 a module-scope variable of unrepresentable type (an array of any)
//
// The **read** decides whether the declaration lowers, which is not a property
// of the declaration at all:
//
//     const xs = []; xs.push(7); xs[0];        lowers
//     const xs = []; xs.push(7); xs.length;    refused
//     const xs = []; xs.push(7); xs.join(","); lowers
//
// Same declaration, same write, three different outcomes from the expression
// that reads the result.
//
// # Where it comes from, measured rather than inferred
//
// `evolved_type` walks every node carrying the name's symbol and takes the
// checker's type at each. Printing what it sees for the two spellings:
//
//     xs[0]      node=116 parent=PROPERTY_ACCESS   ty=None     (the xs.push receiver)
//                node=127 parent=ELEMENT_ACCESS    ty=Some(Array(f64))
//
//     xs.length  node=116 parent=PROPERTY_ACCESS   ty=None
//                node=127 parent=PROPERTY_ACCESS   ty=None
//
// So it is not `never[]` being vetoed --- `is_an_unsettled_array` would handle
// that, and it is the case its comment was written for. There is **no type at
// all** at either reference, and `evolved_type` has nothing to settle from.
//
// The refusal text says which type: *an array of **any***. This is TypeScript's
// evolving-array inference working as specified. `const xs = []` is `any[]`
// until a reference forces the element type to be resolved, and `.length` never
// forces it --- `length` is on the array whatever it holds. `xs[0]` forces it.
// `xs.join(",")` forces it. The receiver of the `push` that supplies the
// element type does not, which is why even two pushes do not help.
//
// # So the element type is in the push argument and nowhere else
//
// Closing this means settling the element type from the **arguments** of the
// `push` calls, rather than from the type at any reference --- the one place
// the information exists in a program the checker has already given up on.
// `dense_prefix_writes` already walks the indexed writes of a name and would
// be the shape of it; what is missing is the same walk over `push` arguments,
// and a rule for what two pushes of different types mean.
//
// The message is the module-scope wording because this fixture is written at
// module scope; the function-scope spelling of the same program refuses as
// *an empty array of unrepresentable type*. One cause, two diagnostics, which
// is worth knowing before either is counted.
//
// Until then this refuses, which is honest: a refusal names the construct,
// where the alternative would be inventing an element type the checker
// declined to.
//
// # Why it is worth having as a fixture
//
// Found 2026-09-21 by `tooling/conformance/fuzz-statements.mjs` on its first
// productive run, whose refusal map is keyed by the generating *shape*:
// `4 push:` and `9 pushThenIndex:` sitting beside `9 fillSparse:`, which is
// correctly refused. Two of those three rows were a gap and one was the design,
// and a map keyed by the message would have shown all three as one row of 22.

const xs = [];
xs.push(7);
export const total: number = xs.length;
