// A call made directly on an array element, inside a closure, in a program with a
// `try` around a call through a function value.
//
// A call through a function value inside a `try` dispatches at the raising slot
// only where every closure the program builds can carry what it calls -- a
// program-wide gate. A closure calling `queue[i]!()` held it off: the element
// read names no declaration, so the census found no symbol, and read the call as
// one no raising entry could carry -- where the same element read into a local
// first was a value, and carried. An element holds a function exactly as a field
// does, so it is now asked as one. Found by the React lane -- react-gtk's idle
// closure drains its restore queue this way -- as `blockers/a-call-on-an-array-
// element-in-a-closure-holds-the-raising-gate-off`, which this replaces; the
// sibling of `a-call-on-a-cast-inside-a-closure`.
//
// What each export pins:
//
//   drained     the queued function called through the element ran: "restored;"
//   caught      the unrelated `try` around a call through a function value
//               compiles and catches: "caught effect"
//   rethrown    a `throw` from the element call itself, inside a closure's `try`,
//               is caught there: "caught queued"
//
// Transcribed from node (v24), each export called with 3:
//
//     drained 12    caught 16    rethrown 16
const queue: (() => void)[] = [];
const failing: (() => void)[] = [];
let log = "";

function drain(): () => void {
  return () => {
    for (let i = 0; i < queue.length; i++) {
      queue[i]!();
    }
  };
}

function drainCatching(): () => string {
  return () => {
    try {
      for (let i = 0; i < failing.length; i++) {
        failing[i]!();
      }
      return "ok";
    } catch (error) {
      return "caught " + (error instanceof Error ? error.message : "?");
    }
  };
}

function run(callback: () => void): string {
  try {
    callback();
    return "ok";
  } catch (error) {
    return "caught " + (error instanceof Error ? error.message : "?");
  }
}

queue.push(() => {
  log += "restored;";
});
failing.push(() => {
  throw new Error("queued");
});

export function drained(n: number): number {
  log = "";
  drain()();
  const length = log.length;
  log = "";
  return length + n * 0 + 3;
}

export function caught(n: number): number {
  return run(() => {
    throw new Error("effect");
  }).length + n * 0 + 3;
}

export function rethrown(n: number): number {
  return drainCatching()().length + n * 0 + 3;
}
