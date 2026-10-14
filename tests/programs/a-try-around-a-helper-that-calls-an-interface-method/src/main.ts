// Calls through a helper must use the same raising interface family as
// directly guarded calls. Negative inputs throw; the positive control does not.
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
export function caught(n: number): number { return run(supplies(n)[0]); }

class Quiet implements Wakeable {
  then(_resolve: () => unknown, _reject: () => unknown): unknown { return undefined; }
}
function supplies(n: number): Wakeable[] { return [new Exact(n), new Quiet()]; }
export function control(n: number): number { return run(supplies(n)[1]) + n; }
