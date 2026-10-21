// An array of tuples copied -- `sort`, `slice`, `concat` -- where the tuple
// type is written twice: once in a `Map`'s literal, whose entries the `Map`
// constructor reads as `readonly [string, number]`, and once in the array's
// annotation. That is two types for one layout, and Wasm stores both as one
// array type; its copy compared the types and refused (`copying result
// changes mutable array storage`) a copy native backends made.
//
// The Wasm plan is the module's, and records the first of the two names it
// meets, so the control is a program of its own -- one difference, the `Map`
// built with `set`, so the tuple is written only in the annotation:
//
//     export function once(n: number): string {
//       const totals = new Map<string, number>();
//       totals.set("rent", 900);
//       totals.set("food", 300 + n);
//       totals.set("fun", n * 7);
//       const entries: [string, number][] = [];
//       ... the same five lines as `twice` below
//     }

export function twice(n: number): string {
  const totals = new Map<string, number>([["rent", 900], ["food", 300 + n], ["fun", n * 7]]);
  const entries: [string, number][] = [];
  for (const [name, sum] of totals.entries()) entries.push([name, sum]);
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 2);
  const both = top.concat(entries.slice(2));
  return both.map((pair) => pair[0] + "=" + pair[1]).join(",");
}
