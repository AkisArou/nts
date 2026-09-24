// expect: `once`, captured above its own declaration, where it has no value yet
//
// A closure that names itself. `capturesEarlier` captures a binding declared
// above it and lowers; `capturesItself` captures the `const` it is being
// assigned to, and does not.
//
//     const add  = (n) => { total += n; }              -> lowers
//     const once = (n) => { total += n; drop(once); }  -> REFUSED
//
// `capturesEarlier` is the control. Without it the diagnostic reads as "a
// closure capturing a local is refused", which is false and would point at
// closures generally.
//
// 37 distinct sites in `runtime/node`, counted as sites rather than summed over
// cones. It is the self-removing listener, which is how `once` is written
// everywhere it appears -- `events/src/main.ts:1322`:
//
//     const eventListener = (...args: unknown[]): void => {
//       removeEventSourceListener(emitter, name, eventListener);
//       ...
//     };
//
// and `console/src/main.ts:437` reaches it a different way, through a helper
// used above its own `const`. A listener that unsubscribes itself cannot be
// written without naming itself, so this is not a spelling that can be avoided.

function register(f: (n: number) => void): void {
  f(1);
}

function unregister(f: (n: number) => void): void {
  f(0);
}

export function capturesEarlier(seed: number): number {
  let total = seed;
  const add = (n: number): void => {
    total += n;
  };
  register(add);
  return total;
}

export function capturesItself(seed: number): number {
  let total = seed;
  const once = (n: number): void => {
    total += n;
    unregister(once);
  };
  register(once);
  return total;
}
