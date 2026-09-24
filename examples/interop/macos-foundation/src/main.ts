// Foundation from TypeScript, checked against the same messages sent from C.
//
// `reference/foundation.c` sends every message below from hand-written C, and
// is compiled against the same SDK and run on the same Mac. Its output is the
// expectation. That makes it a real oracle and not a second implementation:
// both programs call Apple's Foundation, so what is compared is whether the
// compiled TypeScript sends the same messages with the same arguments and
// reads the answers the same way.
//
// Nothing asserts `retainCount`, which Apple documents as meaningless: a
// constant string is immortal and a short one is a tagged pointer with no
// count at all. The retain/release arm asserts behaviour instead, that the
// object still answers after a balanced pair.
import { report, objc_autoreleasePoolPush, objc_autoreleasePoolPop } from "c:report";
import {
  allocString,
  arrayWithCapacity,
  classNSMutableArray,
  classNSString,
  stringWithUTF8String,
  type NSObject,
  type NSString,
} from "objc:Foundation";
import { unsafeDowncast } from "c:memory";
import type { c_ulong } from "c:types";

function main(): void {
  const pool = objc_autoreleasePoolPush();

  // +alloc/-init: an object this program owns, and releases below.
  const owned = allocString().initWithUTF8String("α\u{1F600} hello");
  report("length " + String(owned.length()));
  report("utf8 " + owned.UTF8String());
  report("upper " + owned.uppercaseString().UTF8String());

  // A class method, and an object as an argument.
  const same = stringWithUTF8String("α\u{1F600} hello");
  const other = stringWithUTF8String("β\u{1F600} hello");
  report("equal " + String(owned.isEqualToString(same)) + " " + String(owned.isEqualToString(other)));

  // A collection: an object in, `id` out, and a checked downcast back.
  const array = arrayWithCapacity(2n as c_ulong);
  array.addObject(owned);
  array.addObject(other);
  report("count " + String(array.count()));
  const first = array.objectAtIndex(0n as c_ulong);
  const text = unsafeDowncast<NSString>(first, first.isKindOfClass(classNSString()));
  report("first " + (text === null ? "not a string" : text.UTF8String()));
  // An array seen as an object, so the cast is a real downcast. The check says
  // no, and the answer is null. The compiler refuses the sideways cast
  // (`NSMutableArray` to `NSString`) before the check could say anything.
  const asObject: NSObject = array;
  const wrong = unsafeDowncast<NSString>(asObject, asObject.isKindOfClass(classNSString()));
  report("array as string " + (wrong === null ? "null" : "a string"));
  report("array is array " + String(array.isKindOfClass(classNSMutableArray())));

  // A balanced retain and release, then the object is still usable.
  owned.retain();
  owned.release();
  report("after retain/release " + owned.UTF8String());

  owned.release();
  objc_autoreleasePoolPop(pool);
}

main();
