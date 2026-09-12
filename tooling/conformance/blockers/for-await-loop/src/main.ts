// expect: a parameter of unrepresentable type (`AsyncIterable`)
//
// **The loop form landed on 2026-09-12 and this moved rather than cleared.**
// It expected `a \`for await\` loop` -- a refusal of the *syntax* -- and now
// reports the type of its own parameter:
//
//     for (const value of values)        lowers
//     for await (const value of values)  lowers, where `values` is an
//                                        `AsyncGenerator<T, …>`
//     for await (const value of values)  REFUSED, where `values` is an
//                                        `AsyncIterable<T>`
//
// That is a better message and a smaller claim. `async function*` and the
// `for await` that drives one are in `examples/an-async-generator`, nine
// exports on all three backends; what is left here is the **protocol object**,
// and it is the same shape as its synchronous twin.
//
// # The distinction this fixture now holds
//
// An `AsyncGenerator<T, …>` is a *frame*: this compiler builds it, lays it out,
// and resumes it. An `AsyncIterable<T>` is an interface with a
// `[Symbol.asyncIterator]()` that hands back an object with a `next()` returning
// `Promise<IteratorResult<T>>` -- three things this compiler does not build, and
// `IteratorResult` is a union whose two arms lay their fields out differently,
// which is the refusal census's number one row.
//
// So the synchronous pair is the map for the asynchronous one:
//
//     Generator<T>       a frame, resumed        lowers
//     Iterable<T>        `[Symbol.iterator]()` + `next()`  lowers, as a protocol
//     AsyncGenerator<T>  a frame, stepped        lowers as of 2026-09-12
//     AsyncIterable<T>   the protocol, awaited   this fixture
//
// # What it still costs
//
// The sites were counted as 22 -- `stream` 20, `fs` 2 -- when the message was
// about the loop. That number was about the syntax and no longer answers this:
// a site whose sequence is an `AsyncGenerator` now lowers, and only the ones
// typed as a protocol remain. Re-count against this message rather than
// carrying the old total forward, which is the mistake the `an async generator`
// row made in the other direction.
//
// `control` is `async` itself, so the refusal cannot be read as "async
// functions do not lower".

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
