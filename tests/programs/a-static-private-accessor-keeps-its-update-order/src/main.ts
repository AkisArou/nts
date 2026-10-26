// Private and public accessor pairs differ only in their property key kind.
// The trace retains setter/getter order, including the compound read/write.
let stored = 0;
let trace = 0;
class Subject {
  static get #value(): number { trace = trace * 10 + 1; return stored; }
  static set #value(next: number) { trace = trace * 10 + 2; stored = next * 2; }
  static update(n: number): number {
    this.#value = n;
    this.#value += 3;
    const value = this.#value;
    return value * 10000 + trace;
  }
}
class Control {
  static get value(): number { trace = trace * 10 + 1; return stored; }
  static set value(next: number) { trace = trace * 10 + 2; stored = next * 2; }
  static update(n: number): number {
    this.value = n;
    this.value += 3;
    const value = this.value;
    return value * 10000 + trace;
  }
}
export function subject(n: number): number {
  stored = 0; trace = 0;
  return Subject.update(n);
}
export function control(n: number): number {
  stored = 0; trace = 0;
  return Control.update(n);
}
