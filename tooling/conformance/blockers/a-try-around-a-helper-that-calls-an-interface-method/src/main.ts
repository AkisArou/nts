// expect: a call inside a body that carries a `throw` back to its caller
interface Wakeable { then(resolve: () => unknown, reject: () => unknown): unknown }
function invoke(value: Wakeable): number {
  value.then(() => undefined, () => undefined);
  return 11;
}
function run(value: Wakeable): number {
  try { return invoke(value); } catch { return 17; }
}
class Exact implements Wakeable {
 constructor(private n: number) {}
 then(resolve: () => unknown, reject: () => unknown): unknown { if (this.n < 0) throw new Error("bad"); return resolve(); }
}
export function caught(n: number): number { return run(new Exact(n)); }
