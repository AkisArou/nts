// expect: nothing refused
//
// **Landed 2026-09-12.** This fixture used to expect `an async generator` and
// is kept as a regression guard, because what it reduced was a *combination*
// rather than a feature: both halves compiled and the pair did not.
//
//     function* g(): Generator<number>              compiled
//     async function g(): Promise<number>           compiled
//     async function* g(): AsyncGenerator<number>   refused
//
// That reading was right and was the useful half of the report. The machinery
// each half needs was already there, and what had to be built was one frame
// speaking both protocols: `state` and `yielded` where every generator keeps
// them, `awaited` and `result` after, and a resumption that returns nothing
// because by the time it reaches a `yield` there is no caller left standing in
// front of it.
//
// The working feature lives in `examples/an-async-generator`, nine exports and
// 261 cases on C, LLVM and the JVM, including one that records the **order** a
// step takes rather than its value -- every other arm gives the same sum
// whether or not the step ever suspended.
//
// # Four refusals stood between the declaration and here
//
// Worth listing, because the message named the construct at each and the cause
// moved every time:
//
//     an async generator                      the frontend, by name
//     an `async` generator                    `begin_generator`, by name
//     element type is not recorded            `AsyncGenerator` was not in the
//                                             frontend's natively-represented
//                                             list, so `T` never arrived
//     an `async` function's result of         `begin_async` wanted a promise;
//     unrepresentable type (a function type)  an async generator settles one
//                                             per *step*, not one per call
//
// The third is the one to read twice. `Generator` was on that list with a
// paragraph arguing why, and the paragraph never said which of the two it was
// about -- it applies to `AsyncGenerator` word for word. One name missing from
// one list, and every `async function*` stopped four lines into the lowering
// with a message about its element type.

/** Control: a synchronous generator, walked by `for...of`. */
export function syncGenerator(n: number): number {
  let total = 0;
  for (const v of counting(n & 3)) total += v;
  return total;
}

function* counting(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

/** Control: an `async` function with an `await`. */
export async function asyncFunction(n: number): Promise<number> {
  return await Promise.resolve(n & 3);
}

/** Under test: the two together. */
async function* asyncCounting(limit: number): AsyncGenerator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

export async function asyncGenerator(n: number): Promise<number> {
  let total = 0;
  for await (const v of asyncCounting(n & 3)) total += v;
  return total;
}
