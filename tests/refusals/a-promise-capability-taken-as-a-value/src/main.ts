// The one shape `PromiseWithResolvers` represented as its promise cannot answer.
//
// The capability holds nothing besides the promise, so `d.resolve(v)` is a
// settle and `d.promise` is the identity -- but `d.resolve` on its own is a
// *function value*, and there is none to hand back. It needs a closure over the
// promise whose body is synthesized rather than lowered from source, which is
// `docs/records/0336`'s decomposed form.
//
// Five distinct sites in `runtime/node` are this: `stream/src/iter/broadcast.ts`
// twice, `iter/classic.ts`, `iter/push.ts` and `http1/pool.ts`. All five have
// the shape below -- the capability is made in one place and its settle is
// stored so that somewhere else can call it later.
//
// `docs/records/0337` reverted the whole representation over these, on the
// reading that the members must therefore be first-class. They must, for these
// five; the other 22 sites do not need them, and a refusal here costs those five
// functions rather than the representation.

interface Consumer {
  resolve: ((value: number) => void) | null;
  reject: ((reason: unknown) => void) | null;
}

export function park(consumer: Consumer): Promise<number> {
  const pending = Promise.withResolvers<number>();
  consumer.resolve = pending.resolve;
  consumer.reject = pending.reject;
  return pending.promise;
}
