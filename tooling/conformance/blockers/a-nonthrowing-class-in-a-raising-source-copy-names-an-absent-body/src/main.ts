// expect: `Quiet#then@raises`, which nothing in this program defines
// The directly guarded interface call already seeds this family on main.
// Its nonthrowing member uses the ordinary body, but a concrete source copy
// still names an absent raising body. The ordinary call is the control.
// Calls through a helper must use the same raising interface family as
// directly guarded calls. Negative inputs throw; the positive control does not.
interface Wakeable { then(resolve: () => unknown, reject: () => unknown): unknown }
function invoke(value: Wakeable): number {
  value.then(() => undefined, () => undefined);
  return 11;
}
function run(value: Wakeable): number {
  try { value.then(() => undefined, () => undefined); return invoke(value); } catch { return 17; }
}
class Exact implements Wakeable {
 constructor(private n: number) {}
 then(resolve: () => unknown, reject: () => unknown): unknown { if (this.n < 0) throw new Error("bad"); return resolve(); }
}


class Quiet implements Wakeable {
  then(_resolve: () => unknown, _reject: () => unknown): unknown { return undefined; }
}
export function missing(n: number): number { return run(new Quiet()) + n; }
export function control(n: number): number { new Quiet().then(() => undefined, () => undefined); return 11 + n; }
