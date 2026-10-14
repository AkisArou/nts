// Calls through method-only interfaces, against node: unrelated classes, a
// class that implements two interfaces, an interface that extends another,
// a void method and a string argument, read through the receiver's row.
interface Shape {
  area(scale: number): number;
}
interface Named {
  label(prefix: string): string;
}
interface Tagged extends Named {
  tag(): number;
}
interface Sink {
  put(value: number): void;
  total(): number;
}
class Square implements Shape, Tagged {
  constructor(readonly side: number) {}
  area(scale: number): number { return this.side * this.side * scale; }
  label(prefix: string): string { return prefix + 'square'; }
  tag(): number { return 4; }
}
class Circle implements Shape, Named {
  constructor(readonly radius: number) {}
  area(scale: number): number { return 3 * this.radius * this.radius * scale; }
  label(prefix: string): string { return prefix + 'circle'; }
}
class Badge implements Tagged {
  label(prefix: string): string { return prefix + 'badge!'; }
  tag(): number { return 7; }
}
class Strip implements Shape {
  constructor(readonly length: number) {}
  area(scale: number): number { return this.length * scale; }
}
class Counter implements Sink {
  sum = 0;
  put(value: number): void { this.sum += value; }
  total(): number { return this.sum; }
}
class Doubler implements Sink {
  sum = 0;
  put(value: number): void { this.sum += 2 * value; }
  total(): number { return this.sum + 1; }
}
function areaOf(shape: Shape, scale: number): number {
  return shape.area(scale);
}
export function throughAParameter(n: number): number {
  return areaOf(new Square(n), 2) + areaOf(new Circle(n), 3) + areaOf(new Strip(n), 5);
}
export function throughAnArray(n: number): number {
  const shapes: Shape[] = [new Square(n), new Circle(n + 1), new Strip(n + 2), new Square(1)];
  let sum = 0;
  for (const shape of shapes) sum += shape.area(n);
  return sum;
}
export function twoInterfacesOnOneClass(n: number): number {
  const square = new Square(n);
  const shape: Shape = square;
  const named: Named = square;
  return shape.area(1) + named.label('a ').length;
}
export function anExtendedInterface(n: number): number {
  const tagged: Tagged = n > 2 ? new Square(n) : new Badge();
  return tagged.tag() * 100 + n;
}
export function aVoidMethodThroughAField(n: number): number {
  const sinks: Sink[] = [new Counter(), new Doubler()];
  for (const sink of sinks) {
    sink.put(n);
    sink.put(1);
  }
  return sinks[0].total() * 1000 + sinks[1].total();
}
export function chosenAtRunTime(n: number): number {
  const named: Named = n > 0 ? new Square(n) : new Circle(n);
  return named.label('#').length;
}
