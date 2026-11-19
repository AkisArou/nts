// A whole program: it exports nothing, so no case calls it, and `nts check`
// runs it once on each side and compares what it printed, byte for byte, and
// its exit status (tooling/differential/src/whole_program.rs). Until then a
// program like this compared nothing, however wrong its output.
//
// What only a whole run reaches: the module's own statements in order, a
// microtask that runs after them, and two timers that fire by deadline rather
// than by the order they were set -- which the compiled side reaches only by
// draining its loop, as the shipped `main` does.
class Counter {
  private count = 0;
  bump(by: number): number {
    this.count += by;
    return this.count;
  }
}

const counter = new Counter();
console.log("start");
for (const step of [1, 2, 3]) console.log("count", counter.bump(step));
Promise.resolve("microtask").then((label) => console.log(label));
setTimeout(() => console.log("later timer", counter.bump(10)), 20);
setTimeout(() => console.log("sooner timer", counter.bump(100)), 5);
console.log(["end", "of", "module"].join(" "));
