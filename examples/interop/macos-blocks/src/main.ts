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
  call_held_off_thread,
  complete_off_thread,
  complete_pair_off_thread,
  complete_later,
  console_arm,
  off_thread_arm,
  on_main_thread,
  report,
  weak_alive,
  weak_watch,
} from "c:support";
import { nts_pending_begin, nts_pending_end } from "c:pending";
import { arrayWithCapacity, newObject, scheduledTimer, type NSObject } from "objc:Foundation";
import type { c_double, c_int, c_int8, c_ulong } from "c:types";

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
  // The block's `BOOL *stop`, written: the enumeration ends after the second.
  let visited = 0;
  array.enumerateObjectsUsingBlock((object, index, stop) => {
    visited++;
    if (index === 1n) {
      stop[0] = 1 as c_int8;
    }
  });
  report("stopped after " + String(visited));
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

// A completion handler the platform calls on a background queue and then
// releases there: both are carried to this thread, where the closure's count
// and heap are. The closure runs here, given what the other thread passed,
// and is released here, with the object it captured. Only when
// `BLOCKS_OFF_THREAD` is set (build.sh's arm), since Objective-C itself runs
// the block where it is called, and the oracle is Objective-C.
let offWatch = 0 as c_int;

function offThread(): void {
  const sentinel = newObject();
  offWatch = weak_watch(sentinel);
  hold_block((value, n) => {
    report(`off thread: called on the main thread ${on_main_thread()} with ${n} ${value === sentinel ? "same" : "other"}`);
  });
  call_held_off_thread(sentinel, 7 as c_int);
  report("off thread: called and released");
}

// Swift's `async throws`, as `nts bind-objc --values` writes it: a promise a
// completion handler settles, with the object, or rejected with the error's
// description -- the handler called on a background thread.
function completed(fail: boolean): Promise<NSObject> {
  return new Promise((resolve, reject) => {
    nts_pending_begin();
    complete_off_thread(fail, (value, error) => {
      nts_pending_end();
      if (error !== null) {
        reject(new Error(error.localizedDescription));
      } else {
        resolve(value!);
      }
    });
  });
}

// And Swift's tuple, `async throws -> (A, B)`: two objects in one promise.
function pair(): Promise<[NSObject, NSObject]> {
  return new Promise((resolve, reject) => {
    nts_pending_begin();
    complete_pair_off_thread((first, second, error) => {
      nts_pending_end();
      if (error !== null) {
        reject(new Error(error.localizedDescription));
      } else {
        resolve([first!, second!]);
      }
    });
  });
}

// A console program, with no run loop: the awaited operation is all that
// keeps it alive until its completion arrives from another thread, 100 ms
// later (`c:pending`). The control is the same promise without the bracket,
// and that program ends before the completion.
function later(held: boolean): Promise<NSObject> {
  return new Promise((resolve) => {
    if (held) nts_pending_begin();
    complete_later(100 as c_int, (value) => {
      if (held) nts_pending_end();
      resolve(value!);
    });
  });
}

async function consoleAwait(held: boolean): Promise<void> {
  const value = await later(held);
  report(`console: resolved ${value === null ? "nothing" : "an object"} on the main thread ${on_main_thread()}`);
}

async function offThreadAll(): Promise<void> {
  offThread();
  const value = await completed(false);
  report(`off thread: resolved ${value === null ? "nothing" : "an object"} on the main thread ${on_main_thread()}`);
  try {
    await completed(true);
    report("off thread: resolved a failure");
  } catch (error) {
    report(`off thread: rejected with "${(error as Error).message}"`);
  }
  const [first, second] = await pair();
  report(`off thread: a pair of ${first === second ? "one object" : "two objects"}`);
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
  report("off thread: closure " + state(offWatch));
  loop_stop();
}

function finish(): void {
  report("cancelled " + state(cancelledWatch));
  report("ticking " + state(tickingWatch));
  if (off_thread_arm()) {
    void offThreadAll();
    return;
  }
  loop_stop();
}

function main(): void {
  const arm = console_arm();
  if (arm !== 0) {
    void consoleAwait(arm === 1);
    return;
  }
  setTimeout(() => {
    enumerate();
    cancelledWatch = cancelled();
    ticking();
  }, 0);
  loop_run();
  report("done");
}

main();
