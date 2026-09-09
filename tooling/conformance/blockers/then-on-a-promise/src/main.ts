// expect: a method call on something without methods
//
// `.then` on a promise. The largest unfiled lowering root across `fs` and
// `stream` after the rest-parameter one: 20 distinct named things.
//
// `buffer/src/blob.ts:664` and `:672` are the sites it was reduced from --
// `this.#copyBytes().then((bytes) => bytes.buffer)` and the same shape in
// `text()`. Column 11 is the `.then`.
//
// # The capability is there; the surface is not
//
// This is the control that makes the fixture worth more than its message, and
// it is the reason to file rather than wait:
//
//     Promise.resolve(1)                        compiles
//     await Promise.resolve(1)                  compiles
//     Promise.resolve(1).then(n => n + 1)       refuses
//     Promise.resolve(1).catch(() => 0)         refuses
//     Promise.resolve(1).finally(() => { })     refuses
//
// **`await` on the same promise compiles.** So the lowering can already
// sequence one, and what has no representation is the method surface on the
// object -- all three of `then`, `catch` and `finally` alike. That is a
// narrower thing than "promises are not supported", which is what a reader of
// the diagnostic would reasonably conclude, and it is what the twenty things
// are waiting on.
//
// Holding a promise is not the condition either: a function that returns
// `Promise.resolve(1)` and never touches it compiles. It is the call.
//
// The source of the promise does not matter. `Promise.resolve(...)` and an
// `async function`'s return value refuse identically, so the fixture uses both
// and neither is load-bearing on its own.

async function fromAnAsyncFunction(): Promise<number> {
  return 1;
}

export function thenOnAResolvedPromise(): Promise<number> {
  return Promise.resolve(1).then((n) => n + 1);
}

export function thenOnAnAsyncResult(): Promise<number> {
  return fromAnAsyncFunction().then((n) => n + 1);
}
