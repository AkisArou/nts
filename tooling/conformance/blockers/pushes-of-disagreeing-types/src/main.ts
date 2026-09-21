// expect: NTS1001 a module-scope variable of unrepresentable type (an array of any)
//
// `xs.push(7); xs.push("a")` on an evolving array.
//
// `pushed_element_type` requires every push to agree, because a dense array
// has **one width**: the two arguments are a `number` and a `string`, and
// TypeScript's own answer for the array is the union.
//
// Refusing names the construct. The alternative is inventing a width -- taking
// the first push, or the widest -- and being wrong about the other element at
// run time rather than at compile time.
//
// Node runs this file perfectly well, which is the point: it is a program this
// compiler declines rather than one that is wrong.

const xs = [];
xs.push(7);
xs.push("a");
export const count: number = xs.length;
