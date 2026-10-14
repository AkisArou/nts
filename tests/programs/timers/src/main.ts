// `setTimeout`, `setInterval`, `clearTimeout` and `clearInterval`.
//
// A *capability* over the host's `post_delayed` rather than part of the host
// contract, so both hosts have it and neither implements it -- which is what
// lets the deterministic host run exactly the code the libuv one does.
//
// What this file checks is the lowering: that a callback becomes a closure the
// runtime can call through its method table, that the id comes back as a
// number, and that the whole thing compiles, links and runs. It cannot check
// what a timer *does*, because nothing this compiler can express observes one:
// a timer's effect reaches a program only through a promise its callback
// settles, and `new Promise` is not implemented. The behaviour is checked in
// `runtime/c/tests/timers.c`, against a closure built by hand.
//
// Every timer here is cleared. A pending one would still be pending when the
// next case ran, and a case that depends on what the one before it left behind
// is a case that passes for the wrong reason.

let fired = 0;

// Assigning to a *captured* variable is refused -- this compiler captures by
// value and JavaScript captures by reference -- so the callback reads its
// capture and the write happens in a function it calls.
function record(by: number): void {
  fired = fired + by;
}

// The callback closes over `n`, so it has state and is not a bare function
// pointer: the runtime is handed the closure object and the slot its call
// occupies.
export function scheduleAndCancel(n: number): number {
  const id = setTimeout(() => {
    record(n);
  }, 10);
  clearTimeout(id);
  return fired + n;
}

// `setTimeout(fn)` with no delay is `setTimeout(fn, 0)`.
export function scheduleWithNoDelay(n: number): number {
  const id = setTimeout(() => {
    record(1);
  });
  clearTimeout(id);
  return n;
}

// An interval, and `clearInterval` -- which is the same operation as
// `clearTimeout`, because the id says which timer and nothing else differs.
export function repeatAndStop(n: number): number {
  const id = setInterval(() => {
    record(2);
  }, 1);
  clearInterval(id);
  return fired + n;
}

// The one timer here that is *not* cleared, so that something somewhere calls
// a timer callback: a null method table is what a closure gets when nothing
// dispatches through its slot, and the call through it is the only thing that
// would notice.
//
// A minute out, so that neither side fires it during a `nts check` run -- the
// native side never runs the loop for a function that returns a number, and
// node's driver never yields for long enough. What does fire it is the harness
// in `compiler/codegen/c/tests/execute.rs`, whose host has a virtual clock.
export function scheduleWithoutClearing(n: number): number {
  setTimeout(() => {
    record(n);
  }, 60000);
  return fired;
}

// What that timer changed, once something has run the loop.
export function observed(n: number): number {
  return fired + n;
}

// Clearing an id whose timer already went is legal and does nothing. Here the
// timer never existed: zero is never a live id.
export function clearNothing(n: number): number {
  clearTimeout(0);
  return n;
}
