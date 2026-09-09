// expect: a `for await` loop
//
// `for await (const x of source)`. The synchronous loop over the same values
// lowers, so it is the `await` in the loop head and not iteration:
//
//     for (const value of values)        -> lowers
//     for await (const value of values)  -> REFUSED
//
// `control` is the control and is `async` itself, so the refusal cannot be read
// as "async functions do not lower" -- it is the loop form alone.
//
// **22 distinct sites: `stream` 20, `fs` 2.** Counted as sites, not summed over
// module cones. Twenty of twenty-two are in `stream`, which is the module this
// costs: `stream/src/iter/` exists to turn a stream into an async iterable, and
// `for await` is how every consumer of that reads it. `Readable[Symbol.async
// Iterator]`, `pipeline` over async sources, and the `iter/` helpers are all
// behind it.
//
// **Ruled out on the way**: that this is the same gap as `an async generator`,
// which reports at 13 sites and is a separate message. A generator *produces*
// the sequence and this *consumes* one; the fixture below has no `yield` and no
// generator anywhere, and still refuses. They may share an implementation and
// they do not share a repro, so both are needed to see a fix land.

export async function control(values: number[]): Promise<number> {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export async function subject(values: AsyncIterable<number>): Promise<number> {
  let total = 0;
  for await (const value of values) total += value;
  return total;
}
