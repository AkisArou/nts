// An empty tuple is an array with no elements. It used to receive an empty
// object layout, refusing the literal where an array was expected. TypeScript
// 7.1 also records empty tuples in destructuring defaults that the older API
// failed to encode, exposing the same storage mismatch in six existing guards.
//
// Control: one element instead of zero, with the same numeric array consumer.
// The reference-rest pair also checks that an exhausted rest is built at its
// target's empty-array width rather than sliced at its source's string width.
function shape(value: readonly number[]): number {
  return (Array.isArray(value) ? 100 : 0) + value.length;
}

export function emptyTuple(n: number): number {
  const value: [] = [];
  return shape(value) + (n | 0);
}

export function oneElementTuple(n: number): number {
  const value: [number] = [n];
  return shape(value) + (n | 0);
}

const [, ...emptyReferenceRest] = ["kept"];
const [...oneReferenceRest] = ["kept"];

export function exhaustedReferenceRest(n: number): number {
  return emptyReferenceRest.length + (Array.isArray(emptyReferenceRest) ? 100 : 0) + (n | 0);
}

export function retainedReferenceRest(n: number): number {
  return oneReferenceRest.length + (Array.isArray(oneReferenceRest) ? 100 : 0) + (n | 0);
}
