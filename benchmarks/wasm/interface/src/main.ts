// Calls through an interface (the receiver's row) against calls through an
// abstract base class (its typed vtable), monomorphic and 4-way, in loops the
// compiler emits, against node running the same TypeScript.
interface Shape {
  area(scale: number): number;
}
abstract class Base {
  abstract area(scale: number): number;
}
class A extends Base implements Shape { area(s: number): number { return s + 1; } }
class B extends Base implements Shape { area(s: number): number { return s + 2; } }
class C extends Base implements Shape { area(s: number): number { return s + 3; } }
class D extends Base implements Shape { area(s: number): number { return s + 4; } }

const faces: Shape[] = [new A(), new B(), new C(), new D()];
const bases: Base[] = [new A(), new B(), new C(), new D()];

export function faceMono(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += faces[0].area(i & 7);
  return total;
}
export function face4(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += faces[i & 3].area(i & 7);
  return total;
}
export function baseMono(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += bases[0].area(i & 7);
  return total;
}
export function base4(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += bases[i & 3].area(i & 7);
  return total;
}
