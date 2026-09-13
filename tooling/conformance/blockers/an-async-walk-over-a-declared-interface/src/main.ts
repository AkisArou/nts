// expect: a `for...of` over `NumberStream`
//
// Row 2024 of the ledger -- `for await...of` over an `AsyncIterable` -- and the
// position in the program is the whole of it.
//
// `for await` over an async generator is green (row 2022), and stays green when
// the source arrives through a parameter typed `AsyncGenerator<number>`:
// `examples/an-async-generator` guards nine arms of that across all three
// backends. What refuses is the source arriving as something that only
// *declares* the protocol.
//
// Measured 2026-09-13, and the two cases are not one cause:
//
//     parameter: AsyncIterable<number>   NTS1001 a parameter of unrepresentable
//                                        type (`AsyncIterable`)
//     parameter: NumberStream            NTS1001 a `for...of` over
//                                        `NumberStream`
//
// The first never reaches the walk -- lib.d.ts's `AsyncIterable` has no
// representation, so the parameter is refused before its body is read. The
// second is representable, being an ordinary object type, and the *walk* is
// what has no case for it.
//
// The second is the corpus shape. `zlib`'s `transform(source: AsyncByteStream,
// …)` and `stream`'s operators take their source as a parameter, and of the 38
// `for await` sites in `runtime/node` the ones that are not over a call are
// over a value whose declared type is an interface.
//
// The sync half of this is already closed: `for...of` over a user type with
// `[Symbol.iterator]` is row 2007, green, through `Walk::Protocol`. So the work
// is an async counterpart to a walk that exists rather than a new mechanism --
// read `[Symbol.asyncIterator]`, call `next()`, await the result, read `done`
// and `value` off it. The one unknown worth pricing first is where that result
// type comes from: a hand-written `next()` returning `Promise<IteratorResult<T>>`
// lands on row 2005, which is a two-arm union and unbuilt, while one returning a
// concrete `{ value, done }` does not.
//
// Beware the probe that annotates a local instead of a parameter:
//
//     const s: AsyncIterable<number> = ticks(3);   // compiles today
//
// It compiles because the initialiser still carries the concrete generator type
// for the walk to read, so it measures nothing about the declared type. Two
// arms of one probe differing in position as well as in annotation is how this
// row read green for an afternoon.

async function* ticks(limit: number): AsyncGenerator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

interface NumberStream {
  [Symbol.asyncIterator](): AsyncIterator<number>;
}

async function drainNamed(g: NumberStream): Promise<number> {
  let total = 0;
  for await (const v of g) total += v;
  return total;
}

export async function throughANamedInterface(n: number): Promise<number> {
  return await drainNamed(ticks(n & 3));
}
