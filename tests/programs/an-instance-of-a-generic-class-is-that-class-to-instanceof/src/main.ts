// Every instantiation of a generic class is that class to `instanceof`.
// The test compared against the first of the class's instance types only,
// so `new Box<number>(n) instanceof Box` folded to false.
// The control's class is not generic.
class Box<T> {
  constructor(readonly value: T) {}
}
class Labelled<T> extends Box<T> {}
export function direct(n: number): number {
  return new Box<number>(n) instanceof Box ? 1 : 0;
}
export function inherited(n: number): number {
  const made: object = new Labelled<string>("v" + n);
  return made instanceof Box ? 1 : 0;
}
export function other(n: number): number {
  const value: object = [n];
  return value instanceof Box ? 1 : 0;
}
