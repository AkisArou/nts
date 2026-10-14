// An elision in an array pattern **steps** the iterator.
//
// `IteratorDestructuringAssignmentEvaluation`'s first clause: `Elision : ,` calls
// `IteratorStep` and throws the value away. This compiler emitted **nothing** -- `bind_pattern`
// skips a hole, and for a source that is not an array no element is ever read, so a generator
// was never asked for anything and its `throw` never happened. `const [,] = iter` over a
// throwing generator ran clean.
//
// # What each arm pins
//
// The generator counts its own steps into a module global, so an arm's answer says **how many
// times it was resumed** -- which is the thing the specification is about and which a value
// read out of the pattern could not show. A hole binds nothing, so there is nothing else to
// observe.
//
//   noElisions        `[]` steps **zero** times: the specification gets the iterator and asks
//                     it for nothing, so a generator that throws on its first `next` must not
//                     throw here. The arm that stops "an elision steps" becoming "a pattern
//                     steps once per pattern"
//   oneElision        one step
//   threeElisions     three
//   aThrowingStep     the step's `throw` reaches the handler, which is `e22963ec9`'s flag test
//                     doing its half: without it the raise is recorded and the loop reads
//                     `done`, so the `catch` never runs
//
// # Why only a generator source
//
// An **array** keeps its indexed read. `build_array_from`'s own comment prices a walk against
// `slice` at **8.7x** -- 462.77 us against 53.07 us over 256 elements -- and an array's steps
// have no observable side effect, so skipping an elision over one is observationally sound and
// free. A `Set`, a `Map` and a string are walkable and are not here because nothing measured
// asks for them.
//
// A **binding** element over a generator still refuses, and the sentence names the gap rather
// than the symptom: the element would have to be `undefined` where the step answered `done`,
// and a `Generator<number>`'s element is a double with no room for one.

let steps = 0;

function* counting(limit: number): Generator<number> {
  let i = 0;
  while (i < limit) {
    steps += 1;
    yield i;
    i += 1;
  }
}

function* throwingAfter(ok: number): Generator<number> {
  let i = 0;
  while (true) {
    if (i >= ok) {
      throw new RangeError("stepped past");
    }
    steps += 1;
    yield i;
    i += 1;
  }
}

/** `[]` asks the iterator for nothing. */
export function noElisions(n: number): number {
  steps = 0;
  const [] = counting(5);
  return steps * 10 + (n & 7);
}

/** One hole, one step. */
export function oneElision(n: number): number {
  steps = 0;
  const [,] = counting(5);
  return steps * 10 + (n & 7);
}

/** Three holes, three steps. */
export function threeElisions(n: number): number {
  steps = 0;
  const [, , ] = counting(5);
  return steps * 10 + (n & 7);
}

/** The step's `throw` must reach this handler. */
export function aThrowingStep(n: number): number {
  steps = 0;
  try {
    const [, , ] = throwingAfter(n & 3);
    return steps * 10;
  } catch {
    return -(steps * 10 + 1);
  }
}
