// A class defined from TypeScript: `NtsClickTarget`, an NSObject subclass
// whose `clicked:` method is a TypeScript closure. Checked against the same
// program in Objective-C under ARC (`reference/subclass.m`).
//
// The class is built through the Objective-C runtime's C API, and the method's
// implementation is a block (`imp_implementationWithBlock`), which takes `self`
// first. So the method is a closure, and it captures: `clicks` is the
// program's variable. `class X extends NSObject` sugar will lower to these
// same calls (the Apple lane's A4).
//
// Foundation then calls the method twice: synchronously through
// `performSelector:withObject:`, and from the run loop as an NSTimer's
// target/action, the way AppKit calls a button's target.
import { loop_run, loop_stop, report, actionImplementation, weak_alive, weak_watch } from "c:support";
import { newClickTarget, scheduledTimerCalling, type NSObject } from "objc:Foundation";
import {
  class_addMethod,
  objc_allocateClassPair,
  objc_getClass,
  objc_registerClassPair,
  sel_registerName,
} from "objc:runtime";
import type { c_double, c_int, c_size_t } from "c:types";

let clicks = 0;
let targetWatch = 0 as c_int;

function define(): void {
  const base = objc_getClass("NSObject");
  if (base === null) {
    report("no NSObject");
    return;
  }
  const cls = objc_allocateClassPair(base, "NtsClickTarget", 0n as c_size_t);
  if (cls === null) {
    report("NtsClickTarget already exists");
    return;
  }
  const clicked = actionImplementation((self: NSObject, sender: NSObject) => {
    clicks++;
    report("clicked " + String(clicks) + (self === sender ? " by itself" : " by another"));
    if (clicks === 2) {
      setTimeout(finish, 0);
    }
  });
  report("added " + String(class_addMethod(cls, sel_registerName("clicked:"), clicked, "v@:@")));
  objc_registerClassPair(cls);
}

function start(): void {
  define();
  const target = newClickTarget();
  targetWatch = weak_watch(target);
  const base = objc_getClass("NSObject");
  report("responds " + String(target.respondsToSelector(sel_registerName("clicked:"))));
  report("is an NSObject " + String(base !== null && target.isKindOfClass(base)));
  target.performSelector(sel_registerName("clicked:"), target);
  // Foundation keeps the target until the timer fires, and then lets it go.
  scheduledTimerCalling(0.01 as c_double, target, sel_registerName("clicked:"), null, false);
}

function finish(): void {
  report("target " + (weak_alive(targetWatch) ? "alive" : "gone"));
  loop_stop();
}

function main(): void {
  setTimeout(start, 0);
  loop_run();
  report("done");
}

main();
