// expect: an async generator
//
// `async function*`. 13 distinct named things across 9 modules.
//
// # Both halves work; the combination does not
//
//     function* g(): Generator<number>              compiles
//     async function g(): Promise<number>           compiles
//     async function* g(): AsyncGenerator<number>   refuses
//
// A synchronous generator compiles and an async function compiles. So neither
// suspension nor iteration is missing on its own, and what has no lowering is
// the two together. That is a narrower claim than the message makes, and it is
// the claim a reader needs: the machinery each half needs is already there.
//
// Worth stating alongside the promise fixture, which found the same shape from
// the other direction -- `await` compiles and `.then` does not. Twice now the
// diagnostic has read as a whole feature being absent where a specific
// combination or surface is.
//
// # It is not the return type
//
// A generator annotated `IterableIterator<number>` rather than
// `Generator<number>` refuses for a different reason -- `a generator whose
// element type is not record` -- so the sync control above is written with
// `Generator<number>` deliberately. Getting that wrong would have made the
// control refuse and turned this fixture into a claim that generators do not
// work, which is false.

export function* syncGenerator(): Generator<number> {
  yield 1;
}

export async function asyncFunction(): Promise<number> {
  return 1;
}

export async function* asyncGenerator(): AsyncGenerator<number> {
  yield 1;
}
