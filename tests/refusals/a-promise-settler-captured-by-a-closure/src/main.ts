// expect: nothing refused
//
// **Closed 2026-09-21**, and kept as the regression guard. The closure now
// captures the **promise** rather than the settler and re-derives the settle
// from it -- `Capture::settles` carries which of the two it is, decided in
// `collect_closures` because the closure table is built once and cloned. The
// row went 41 sites to 0.
//
// The account below is the useful part: it is why the refusal existed and what
// the message used to claim.
//
// ---
//
// The commonest way this corpus builds a promise, and the commonest thing to
// do inside the executor:
//
//     new Promise((resolve, reject) => {
//       const done = (e: Error | null): void => {
//         if (e !== null) { reject(e); return; }
//         resolve(v);
//       };
//       lookupService(host, done);          // `done` runs later
//     });
//
// `runtime/node/dns/src/main.ts:406` is that shape verbatim.
//
// # The message used to be about a different program
//
// It read ``reject`, captured above its own declaration, where it has no value
// yet` -- and `reject` is a parameter of the executor arrow, declared as
// ordinarily as any parameter. Nothing about it is above its own declaration.
//
// It is absent from `bindings` because `Settler`'s own doc says so: `resolve`
// and `reject` are "not values at all". The executor is lowered at the
// construction site and a call to one is the settle it stands for, so the
// capture loop looks the symbol up, misses, and falls through to a refusal
// about use-before-declaration.
//
// **41 of the 48 sites in that census row were this**, wearing a message that
// sent a reader looking for a declaration order problem. Separating them left
// 7 genuine ones, which keep the original wording and are a different piece of
// work.
//
// # What is true, measured one factor at a time
//
// ```text
// function outer(a) { const inner = () => a * 2; ... }      lowers
// const outer = (a) => { const inner = () => a * 2; ... }   lowers
// a user function taking (res, rej) with an inner closure   lowers
// new Promise((resolve, reject) => { resolve(7); })         lowers
// new Promise((resolve, reject) => {
//   const done = () => { resolve(7); }; done(); })          REFUSED
// ```
//
// Capturing an enclosing parameter is fine in general, and a *user-defined*
// function of the identical shape is fine. Only `new Promise`'s executor
// refuses, and only once something captures a settler -- so this is a gap in
// one special-cased path rather than a limitation of closures.
//
// # `Promise.withResolvers` is the same map
//
// Its destructured `resolve` and `reject` go through `self.settlers` too, so a
// closure capturing one lands on this refusal identically:
//
//     const { promise, resolve } = Promise.withResolvers<number>();
//     const done = (): void => { resolve(5); };     // same refusal
//
// The message therefore says *a promise settler* rather than naming
// `new Promise`, which would be right about the 41 sites and wrong about
// whichever spelling a reader had in front of them.
//
// # Why it cannot be inlined away
//
// In the `dns` case `done` is handed to an asynchronous operation and runs
// after the executor has returned. The settler has to become a real heap value
// that outlives the executor, which rules out resolving it statically at the
// capture site.

export function made(n: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const done = (e: Error | null): void => {
      if (e !== null) {
        reject(e);
        return;
      }
      resolve(n);
    };
    done(null);
  });
}
