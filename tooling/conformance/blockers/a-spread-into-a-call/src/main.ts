// expect: a spread element
//
// Spreading into a **call**. Spreading into an array literal compiles and
// agrees with node.
//
//     add(...args)          refuses, `a spread element`
//     [0, ...a, 3]          compiles, and answers what node answers
//
// So it is not the spread syntax and not the array being spread -- it is the
// argument position. The fifth construct found in a day where one position or
// spelling works and another of the same thing does not.
//
// # It is beside a working rest parameter
//
// `agreements/spread-and-class-member-seams` asks ten questions and eight
// agree, among them **a rest parameter collecting the extra arguments**:
//
//     const sum = (first: number, ...rest: number[]) => …    works
//     add(...args)                                           refuses
//
// The two halves of the same feature. Gathering at the callee is implemented;
// scattering at the caller is not.
//
// Node's own modules use the call form constantly -- `fn.apply`-free forwarding
// is written `f(...args)` throughout `lib/`.

export function spreadIntoAnArray(): number {
  const a = [1, 2];
  const b = [0, ...a, 3];
  return b.length;
}

export function spreadIntoACall(): number {
  const add = (a: number, b: number): number => a + b;
  const args: [number, number] = [4, 5];
  return add(...args);
}
