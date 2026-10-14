// An object handed to a function *value* is kept by what that function does.
//
// `run(demo)` calls `demo` through the value, and a call through a value enters
// the function at its `erased_call` entry: one that unerases the argument and
// hands the result to the written body. Escape analysis followed an erasure to
// what it carries and not an unerasure, so the body keeping the object -- here
// in a closure stored at module scope -- escaped the unerased value and never
// the entry's parameter. Every caller reaching `demo` through the value put the
// object it built in its own frame, and the kept closure read a dead frame.
//
// Two runs in a row make that a wrong answer rather than luck: the second
// `go` frame reuses the first one's slot, so the first closure read the second
// object's `count`, one more than node's answer, and under `--rc` the collector
// walked it.
// The GTK corpus's `Workbench`, captured by a handler a demo connected to a
// signal, crashed there.
//
// The control is the same program with `go` calling `demo` by name, which
// enters the written body directly and was always right.

interface Bench {
  name: string;
  count: number;
}

// Overwritten rather than appended, so the live set is constant: `rc.sh` reads
// growth between cases as a leak.
const kept: (() => number)[] = [() => 0, () => 0];
let next = 0;

function demo(bench: Bench): void {
  kept[next] = () => bench.name.length * 100 + bench.count;
  next = 1 - next;
}

function run(body: (bench: Bench) => void, n: number): void {
  const go = (k: number): void => {
    body({ name: "bench", count: k });
  };
  go(n);
}

export function keptPastTheFrame(n: number): number {
  next = 0;
  run(demo, n);
  run(demo, n + 1);
  return kept[0]();
}
