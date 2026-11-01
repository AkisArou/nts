// Control: the same classes, not generic.
class Box {
  constructor(readonly value: number) {}
}
class Labelled extends Box {}
export function direct(n: number): number {
  return new Box(n) instanceof Box ? 1 : 0;
}
export function inherited(n: number): number {
  const made: object = new Labelled(n);
  return made instanceof Box ? 1 : 0;
}
export function other(n: number): number {
  const value: object = [n];
  return value instanceof Box ? 1 : 0;
}
