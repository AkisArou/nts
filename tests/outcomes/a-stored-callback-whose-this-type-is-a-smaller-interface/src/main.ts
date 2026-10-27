// run: check

// L14: receive_this checks layouts, so a structurally valid wider object
// stops by name. Only the callback's declared this type differs in the pair.
interface Valued { value: number; }
class Holder {
  value: number;
  run: (n: number) => number;
  constructor(n: number, run: (n: number) => number) {
    this.value = n;
    this.run = run;
  }
}
function structural(this: Valued, n: number): number { return this.value * 10 + n; }
function concrete(this: Holder, n: number): number { return this.value * 10 + n; }
export function control(n: number): number { return new Holder(n, concrete).run(3); }
export function subject(n: number): number { return new Holder(n, structural).run(3); }
