// TypeScript closures as Objective-C blocks, checked against the same program
// written in Objective-C under ARC (`reference/blocks.m`).
//
// - `enumerateObjectsUsingBlock:` calls the block during the call, and the
//   closure's captured `let`s are the variables themselves.
// - A repeating `NSTimer` keeps a copy of its block and fires it from the run
//   loop. The closure captures `sentinel`, an object whose only owner is the
//   closure: it dies exactly when the closure does, which is when the timer's
//   copy of the block is released, after `invalidate`.
// - A timer invalidated before it ever fires: the block is copied and
//   released without once being called, so only the copy and dispose helpers
//   run.
//
// Every lifetime is read in a later task than the one that ended it, since
// each task drains its own autorelease pool.
import {
  hold_block,
  loop_run,
  loop_stop,
  off_thread_arm,
  release_held_off_thread,
  report,
  weak_alive,
  weak_watch,
} from "c:support";
import { arrayWithCapacity, newObject, scheduledTimer } from "objc:Foundation";
import type { c_double, c_int, c_ulong } from "c:types";

function state(watch: c_int): string {
  return weak_alive(watch) ? "alive" : "gone";
}

function enumerate(): void {
  const array = arrayWithCapacity(3n as c_ulong);
  array.addObject(newObject());
  array.addObject(newObject());
  array.addObject(newObject());
  let seen = 0;
  let indices = 0n;
  array.enumerateObjectsUsingBlock((object, index) => {
    seen++;
    indices += index as bigint;
  });
  report("enumerated " + String(seen) + " " + String(indices));
}

function cancelled(): c_int {
  const sentinel = newObject();
  const watch = weak_watch(sentinel);
  const timer = scheduledTimer(60 as c_double, false, () => {
    report("never " + String(sentinel.hash()));
  });
  timer.invalidate();
  return watch;
}

let cancelledWatch = 0 as c_int;
let tickingWatch = 0 as c_int;

function ticking(): void {
  const sentinel = newObject();
  tickingWatch = weak_watch(sentinel);
  let ticks = 0;
  scheduledTimer(0.01 as c_double, true, (timer) => {
    ticks++;
    report("tick " + String(ticks) + " " + (sentinel.hash() === 0n ? "?" : "held"));
    if (ticks === 3) {
      timer.invalidate();
      setTimeout(finish, 0);
    }
  });
}

// A block copied on this thread and released on another: its dispose would
// touch the closure's count from a thread that does not own it, so the
// process stops, by name. Only when `BLOCKS_OFF_THREAD` is set (build.sh's
// guard arm); otherwise nothing is held.
function offThread(): void {
  let kept = 0;
  hold_block(() => {
    kept++;
  });
  release_held_off_thread();
  report("released off thread " + String(kept));
}

function finish(): void {
  report("cancelled " + state(cancelledWatch));
  report("ticking " + state(tickingWatch));
  if (off_thread_arm()) {
    offThread();
  }
  loop_stop();
}

function main(): void {
  setTimeout(() => {
    enumerate();
    cancelledWatch = cancelled();
    ticking();
  }, 0);
  loop_run();
  report("done");
}

main();
