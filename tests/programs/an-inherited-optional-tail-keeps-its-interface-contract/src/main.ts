// A one-argument face over an inherited optional tail.
let calls = 0;

interface Counter {
  count(event: number): number;
}

class Parent {
  bias = 0;
  count(event: number, listener?: unknown): number {
    calls += 1;
    return event + this.bias + (listener === undefined ? 2 : 7);
  }
}

class Child extends Parent {}

// Keep these exported so preparation must retain their unknown receiver domain.
// The receiver annotation is the single contract difference; the body is shared.
export function throughContract(values: Counter[], n: number): number {
  return values[0].count(n);
}

export function throughClass(values: Child[], n: number): number {
  return values[0].count(n);
}

export function subject(n: number): number {
  const before = calls;
  const answer = throughContract([new Child()], n);
  return answer + 100 * (calls - before);
}

export function control(n: number): number {
  const before = calls;
  const answer = throughClass([new Child()], n);
  return answer + 100 * (calls - before);
}
