interface Numeric { accept(x: number): number }
class Exact { accept(x: number): number { return x; } }
class Literal { accept(x: 3): number { return x === 3 ? 7 : 11; } }
export function narrowed(n: number): number {
  const all: Numeric[] = [new Exact(), new Literal()];
  return all[(n | 0) & 1].accept(n);
}

interface Optional { finish(settle?: boolean): void }
class Defaulted { finish(settle = false): void { if (settle) throw new Error("settled"); } }
export function defaulted(n: number): number {
  const all: Optional[] = [new Defaulted()];
  all[0].finish((n | 0) === 0 ? undefined : true);
  return n;
}

interface Named { name: string }
class Thing { constructor(public id: number, public name: string) {} }
interface Handler { handle(value: Thing): number }
class WantsInterface { handle(value: Named): number { return value.name.length; } }
export function structuralStorage(n: number): number {
  const all: Handler[] = [new WantsInterface()];
  return all[0].handle(new Thing(n, "x"));
}
