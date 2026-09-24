// Foundation's classes as TypeScript classes: `new` (alloc and init, an
// inherited init, and a class method Swift imports as an init), methods,
// properties read and written, a class property, and `instanceof`. Checked
// against the same program in Objective-C (`reference/classes.m`).
import { NSMutableArray, NSNumber, NSObject, NSOperation, NSProcessInfo, NSString } from "objc:Foundation";
import { report, weak_alive, weak_watch } from "c:support";
import type { c_int } from "c:types";

let watch = 0 as c_int;

// `new` hands over an object the caller owns: once this returns, nothing
// holds it, and it is gone.
function made(): void {
  const object = new NSObject();
  watch = weak_watch(object);
}

function main(): void {
  const list = new NSMutableArray();
  report(`empty ${list.count}`);
  for (const n of [1, 2, 3]) {
    list.addObject(new NSNumber(n));
  }
  report(`count ${list.count}`);
  list.insert(new NSNumber(0), { at: 0 });
  report(`inserted ${list.count} first ${(list.object(0) as NSNumber).intValue}`);

  const answer = new NSNumber(42);
  report(`number ${answer.intValue} equal ${answer.isEqual(new NSNumber(42))}`);
  report(`kinds ${answer instanceof NSNumber} ${answer instanceof NSString} ${list instanceof NSObject}`);
  report(`processors ${NSProcessInfo.processInfo.processorCount > 0}`);

  const text = new NSString("worker");
  report(`length ${text.length}`);
  report(`upper ${text.uppercaseString} appended ${text.appending("!")}`);
  const operation = new NSOperation();
  operation.name = "worker";
  const name = operation.name;
  if (name !== null) {
    report(`name ${name} ${name.length}`);
  }

  made();
  report(`object ${weak_alive(watch) ? "alive" : "gone"}`);
  report("done");
}

main();
