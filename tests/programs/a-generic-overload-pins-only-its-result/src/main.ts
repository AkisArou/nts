// Both implementation bodies return AsyncIterableIterator<unknown>.
// The one changed contract is T versus unknown in the selected overload's result.
let calls = 0;
let steps = 0;

class Cursor implements AsyncIterableIterator<unknown> {
  value: number;
  constructor(value: number) { this.value = value; }
  next(): Promise<IteratorResult<unknown>> {
    steps += this.value < 0 ? 2 : 1;
    const result: IteratorResult<unknown> = { value: "event", done: false };
    return Promise.resolve(result);
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown> { return this; }
}

function selected<T>(n: number): AsyncIterableIterator<T>;
function selected(n: number): AsyncIterableIterator<unknown> {
  calls += 1;
  return new Cursor(n);
}

function closed<T>(n: number): AsyncIterableIterator<unknown>;
function closed(n: number): AsyncIterableIterator<unknown> {
  calls += 1;
  return new Cursor(n);
}

export function subject(n: number): number {
  const beforeCalls = calls;
  const beforeSteps = steps;
  const iterator = selected<string>(n);
  void iterator;
  return n + 100 * (calls - beforeCalls) + 10 * (steps - beforeSteps);
}

export function control(n: number): number {
  const beforeCalls = calls;
  const beforeSteps = steps;
  const iterator = closed<string>(n);
  void iterator;
  return n + 100 * (calls - beforeCalls) + 10 * (steps - beforeSteps);
}
