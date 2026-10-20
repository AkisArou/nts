// The control for two-generator-closures-called-through-one-signature: the
// same calls through `Make` and `Stream`, with one closure filling each. Each
// signature's result is that closure's own frame, as it was before the
// two-closure case was fixed, and this program emits as it did then.
type Make = () => Generator<number, void, unknown>;

let first = 1;

const makers: Make[] = [
  function* () {
    yield first + 1;
    yield first + 2;
  },
];

type Stream = () => AsyncGenerator<number, void, unknown>;

const streams: Stream[] = [
  async function* () {
    yield first + 1;
    yield first + 2;
  },
];

// Held untyped and assigned later, so its calls go through the closure's own
// `call` slot, and every signature the program lays out declares one.
let twice;
twice = (value: number) => value * 2;
const none = twice(0);

export function total(seed: number): number {
  let sum = none;
  for (const value of makers[seed & 0]()) {
    sum = sum + value;
  }
  return sum;
}

export function steps(seed: number): number {
  const walk = makers[seed & 0]();
  let count = 0;
  while (!walk.next().done) {
    count = count + 1;
  }
  return count;
}

export async function streamed(seed: number): Promise<number> {
  let sum = none;
  for await (const value of streams[seed & 0]()) {
    sum = sum + value;
  }
  return sum;
}
