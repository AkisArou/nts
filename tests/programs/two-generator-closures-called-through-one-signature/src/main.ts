// Two generator closures held as one function type and called through it.
//
// `Make` is a signature both closures fill, so a call through a `Make` value
// dispatches to whichever closure it holds. Each closure's `call` returns its
// own frame, a class only that generator's body uses, so the signature cannot
// declare either one: it declares the `Generator<number, void, unknown>` both
// frames extend, and each `call` narrows it. Declared with the first closure's
// frame, the second's `call` did not override it and the JVM declined the
// program (NTS4009 on the second `call`), the defect
// tests/outcomes/a-signature-shell-typed-with-the-first-generator-frame-on-the-jvm
// recorded from test262's `fn-name-gen` cases.
//
// `streamed` is the same for two async generators under `Stream`, whose
// declaration takes the `AsyncGenerator<number, void, unknown>` both frames
// extend: the same defect, and the same fix.
//
// The control, one-generator-closure-called-through-a-signature, holds one
// closure of each: its signatures keep that closure's frame as their result.
type Make = () => Generator<number, void, unknown>;

// A literal yield would give a closure the type `Generator<1, void, unknown>`,
// which is not `Make`'s result, and the closure would not fill `Make` at all.
let first = 1;

const makers: Make[] = [
  function* () {
    yield first;
  },
  function* () {
    yield first + 1;
    yield first + 2;
  },
];

type Stream = () => AsyncGenerator<number, void, unknown>;

const streams: Stream[] = [
  async function* () {
    yield first;
  },
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
  for (const value of makers[seed & 1]()) {
    sum = sum + value;
  }
  return sum;
}

export function steps(seed: number): number {
  const walk = makers[seed & 1]();
  let count = 0;
  while (!walk.next().done) {
    count = count + 1;
  }
  return count;
}

export async function streamed(seed: number): Promise<number> {
  let sum = none;
  for await (const value of streams[seed & 1]()) {
    sum = sum + value;
  }
  return sum;
}
