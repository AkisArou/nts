// expect: emit-c --napi -> no wrapper for valueFactory: is exported as a value of type `a function`, which does not cross
// runtime/node/zlib/src/main.ts exports its eleven create* factories as
// function-valued const bindings. Their bodies can compile while Node-API
// cannot publish the binding. A declared function with the same body crosses.
// This isolates the crossing from the compression constructors' own refusals.

export const valueFactory = (n: number): number => n + 1;

export function declaredFactory(n: number): number {
  return n + 1;
}
