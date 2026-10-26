// The SDK metadata guard reads these same five parameter controls. Rest is
// separate from a question-optional argument; a default has an initializer.
export function fixed(first: number, tail: number[]): number {
  let total = first;
  for (let index = 0; index < tail.length; index++) total += tail[index];
  return total;
}
export function rest(first: number, ...tail: number[]): number {
  let total = first;
  for (let index = 0; index < tail.length; index++) total += tail[index];
  return total;
}
export function optional(first: number, tail?: number[]): number {
  if (tail === undefined) return first;
  return fixed(first, tail);
}
export function initialized(first: number, tail: number[] = []): number {
  return fixed(first, tail);
}
export function beforeRequired(first = 1, tail: string): number {
  return first + tail.length;
}
console.log(fixed(10, []), fixed(10, [2, 3]));
console.log(rest(10), rest(10, 2), rest(10, 2, 3));
console.log(optional(10), optional(10, []), optional(10, [2, 3]));
console.log(initialized(10), initialized(10, undefined), initialized(10, [2, 3]));
console.log(beforeRequired(undefined, "abc"), beforeRequired(5, "abc"));
