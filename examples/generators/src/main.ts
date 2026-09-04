// Generators: `function*` and `yield`, walked by a `for...of`.
//
// The state machine is the one `async` already had. What differs is who
// resumes it: an `await` subscribes to a promise and comes back from the event
// loop, a `yield` returns to the caller that is standing there waiting. So the
// suspension is an ordinary `return`, the frame *is* the iterator, and one step
// is one call and one field read -- nothing allocated per element.

function* upTo(limit: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < limit) {
    yield i;
    i = i + 1;
  }
}

export function total(limit: number): number {
  let sum = 0;
  for (const value of upTo(limit)) {
    sum = sum + value;
  }
  return sum;
}

// Nothing at all. The first resumption runs to the end and answers done, so
// the body never runs -- which is the case a walk that tested `done` after the
// body would get wrong.
function* nothing(limit: number): Generator<number, void, unknown> {
  if (limit > 1000000) {
    yield 1;
  }
}

export function emptyWalk(limit: number): number {
  let count = 0;
  for (const value of nothing(limit)) {
    count = count + value + 1;
  }
  return count;
}

// One `yield` and no loop: two states, and the second is the end.
function* justOne(n: number): Generator<number, void, unknown> {
  yield n * 2;
}

export function singleton(n: number): number {
  let seen = 0;
  let sum = 0;
  for (const value of justOne(n)) {
    seen = seen + 1;
    sum = sum + value;
  }
  return sum * 10 + seen;
}

// Two suspensions in a row, so the dispatch has three states and the value
// live across each is a different one.
function* pair(a: number, b: number): Generator<number, void, unknown> {
  const first = a + 1;
  yield first;
  const second = b + first;
  yield second;
}

export function twoStates(a: number, b: number): number {
  let out = 0;
  for (const value of pair(a, b)) {
    out = out * 100 + value;
  }
  return out;
}

// `break` leaves the generator suspended. Nothing resumes it again, which is
// what a walk that closed its iterator would have to do differently.
export function stopEarly(limit: number, stop: number): number {
  let sum = 0;
  for (const value of upTo(limit)) {
    if (value >= stop) {
      break;
    }
    sum = sum + value;
  }
  return sum;
}

// `continue` has to reach the resumption. A cursorless walk keeps its step in
// the header for exactly this reason: a latch of its own would step nothing
// and the loop would spin.
export function skipping(limit: number): number {
  let sum = 0;
  for (const value of upTo(limit)) {
    if (value % 2 === 0) {
      continue;
    }
    sum = sum + value;
  }
  return sum;
}

// A `return` inside the body, which leaves the walk without finishing it.
export function firstOver(limit: number, floor: number): number {
  for (const value of upTo(limit)) {
    if (value > floor) {
      return value;
    }
  }
  return -1;
}

// Two walks over two frames at once. Each has its own state, so an
// implementation that kept the cursor anywhere but the frame gets this wrong.
export function nested(outer: number, inner: number): number {
  let sum = 0;
  for (const a of upTo(outer)) {
    for (const b of upTo(inner)) {
      sum = sum + a * b;
    }
  }
  return sum;
}

// A generator whose element is not a number.
function* words(n: number): Generator<string, void, unknown> {
  let i = 0;
  while (i < n) {
    yield "w" + i;
    i = i + 1;
  }
}

export function joined(n: number): string {
  let out = "";
  // Bounded: the pool hands this negative, fractional and very large values,
  // and a string built from an unbounded one is megabytes the differential
  // then has to compare character by character.
  for (const word of words(n % 8)) {
    out = out + word + ".";
  }
  return out;
}

// The frame in a `const` first. It is the same SSA value, so the walk finds the
// call behind it and the loop is identical.
export function throughAName(limit: number): number {
  const walk = upTo(limit);
  let sum = 0;
  for (const value of walk) {
    sum = sum + value;
  }
  return sum;
}

// Walked twice. The second walk resumes a frame that already answered done, so
// it yields nothing -- which is what node does, and is the reason a generator
// is not an iterable you can restart.
export function twice(limit: number): number {
  const walk = upTo(limit);
  let first = 0;
  for (const value of walk) {
    first = first + value;
  }
  let second = 0;
  for (const value of walk) {
    second = second + 1;
  }
  return first * 1000 + second;
}

// Two calls, two frames, walked one after the other.
export function twoFrames(a: number, b: number): number {
  let sum = 0;
  for (const value of upTo(a)) {
    sum = sum + value;
  }
  for (const value of upTo(b)) {
    sum = sum + value * 100;
  }
  return sum;
}

// A parameter read after the suspension, so it has to be in the frame rather
// than in a C local that the return threw away.
function* strided(from: number, step: number, count: number): Generator<number, void, unknown> {
  let made = 0;
  let at = from;
  while (made < count) {
    yield at;
    at = at + step;
    made = made + 1;
  }
}

export function strideSum(from: number, step: number, count: number): number {
  let sum = 0;
  for (const value of strided(from, step, count)) {
    sum = sum + value;
  }
  return sum;
}

// A generator that yields from inside a nested block and a `for` loop, so the
// suspension is not at the top level of the body.
function* triangle(rows: number): Generator<number, void, unknown> {
  for (let row = 0; row < rows; row = row + 1) {
    for (let col = 0; col <= row; col = col + 1) {
      yield row * 10 + col;
    }
  }
}

export function triangleSum(rows: number): number {
  let sum = 0;
  for (const value of triangle(rows)) {
    sum = sum + value;
  }
  return sum;
}

// A `return` in the generator, which ends the walk. What it returns is the
// `TReturn` of `Generator<T, TReturn>` and a `for...of` discards it.
function* untilNegative(a: number, b: number, c: number): Generator<number, void, unknown> {
  yield a;
  if (b < 0) {
    return;
  }
  yield b;
  if (c < 0) {
    return;
  }
  yield c;
}

export function beforeNegative(a: number, b: number, c: number): number {
  let count = 0;
  let sum = 0;
  for (const value of untilNegative(a, b, c)) {
    count = count + 1;
    sum = sum + value;
  }
  return count * 1000000 + sum;
}
