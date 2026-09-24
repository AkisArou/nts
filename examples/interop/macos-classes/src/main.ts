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

let replaced = 0 as c_int;
let held = 0 as c_int;

// An object only the caller will hold, watched on the way out.
function watched(): NSObject {
  const object = new NSObject();
  replaced = weak_watch(object);
  return object;
}

// Swift's `[NSNumber]` and `[NSObject]`: an array owns a count of each element,
// a copy counts its own, an overwritten element is given up at once, and the
// array's elements go with the array.
function arrays(): void {
  const numbers: NSNumber[] = [new NSNumber(1), new NSNumber(2)];
  numbers.push(new NSNumber(3));
  const tail = numbers.slice(1);
  numbers[0] = new NSNumber(10);
  let total = 0;
  for (const n of numbers) {
    total += n.intValue;
  }
  report(`arrays ${numbers.length} ${tail.length} ${total} ${tail[0].intValue} ${numbers.indexOf(tail[1])}`);
  const objects: NSObject[] = [watched()];
  objects[0] = new NSObject();
  report(`replaced ${weak_alive(replaced) ? "alive" : "gone"}`);
  held = weak_watch(objects[0]);
}

function optional(operation: NSOperation | null): string {
  operation?.cancel();
  return `${operation?.isCancelled ?? "absent"} ${operation?.name ?? "unnamed"}`;
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

  // Swift's optional chaining: a message to an absent receiver is not sent,
  // and the chain is `undefined`.
  report(`optional ${optional(operation)} ${optional(null)}`);

  arrays();
  report(`array ${weak_alive(held) ? "alive" : "gone"}`);

  made();
  report(`object ${weak_alive(watch) ? "alive" : "gone"}`);
  report("done");
}

main();
