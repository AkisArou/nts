// expect: a closure in `drain` calls `a function value`, whose own `throw` cannot be carried
//
// **A call made directly on an array element holds the program-global raising gate
// off.** The closure `drain` returns calls each queued function as `queue[i]!()`. That
// one closure sets `closures_carry` false for the whole program, so the unrelated `try`
// in `run`, around a call through a function value, is refused. It is the sibling of
// `examples/a-call-on-a-cast-inside-a-closure` (5041138e9): there the callee was a cast;
// here it is an element access.
//
// **The control differs in one thing and compiles, agreeing with node** (`restored;
// caught effect`): the same element read into a local first,
//
//     const restore = queue[i]!;
//     restore();
//
// The two cannot be arms of one file, because the gate is a property of the whole
// program. Without the `!`, `queue[i]()` refuses the same way, and its sentence names the
// callee as `i`, the index, rather than the element: "a closure in `drain` calls `i`".
// That is a second, smaller defect in the naming, worth one line when this is fixed.
//
// **Found by the React lane**, one step past 5041138e9. react-gtk's controller closures
// call `SignalSlot.dispatch`, which queues a controlled value's restore, and the GLib idle
// closure that drains that queue calls `queue[i]!()`. So every native React program that
// links react-gtk still has the gate off, and React's scheduler and effect callbacks,
// each called inside a `try`, stay refused.
const queue: (() => void)[] = [];
let log = "";

function drain(): () => void {
  return () => {
    for (let i = 0; i < queue.length; i++) {
      queue[i]!();
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
drain()();
const answer = log + run(() => {
  throw new Error("effect");
});
if (answer !== "restored;caught effect") throw new Error(answer);
