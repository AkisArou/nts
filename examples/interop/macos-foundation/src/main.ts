// Foundation from TypeScript, with every object's lifetime the compiler's.
//
// `reference/foundation.c` sends the same messages from hand-written C, and
// releases each object exactly where ARC would. It is compiled against the
// same SDK and run on the same Mac. That makes it a real oracle and not a
// second implementation: both programs call Apple's Foundation, and what is
// compared is whether the compiled TypeScript sends the same messages and
// gives each object back at the same point.
//
// Deallocation is observed with a zeroing weak reference (`weak_alive`), not
// `retainCount`, which Apple documents as meaningless.
import { weak_alive, weak_watch } from "c:report";
import {
  allocString,
  arrayWithCapacity,
  classNSMutableArray,
  classNSString,
  newObject,
  stringWithUTF8String,
  type NSObject,
  type NSString,
} from "objc:Foundation";
import { unsafeDowncast } from "c:memory";
import type { c_int, c_ulong } from "c:types";

function state(watch: c_int): string {
  return weak_alive(watch) ? "alive" : "gone";
}

// `+new` hands over an object. Its only reference is `object`, which dies
// when this returns, so the object is gone by the time the caller looks.
function scoped(): c_int {
  const object = newObject();
  return weak_watch(object);
}

// `+alloc` hands over an object that `-init` consumes and replaces. The
// string is non-ASCII so it cannot be a tagged pointer, which is never freed.
function initialised(): c_int {
  const text = allocString().initWithUTF8String("α\u{1F600} scoped");
  return weak_watch(text);
}

// A heap object whose field is the object's only reference: gone when the
// holder is, which its descriptor's foreign slot sees to.
class Holder {
  constructor(public object: NSObject) {}
}
function holding(): Holder {
  return new Holder(newObject());
}
function inAField(): c_int {
  const holder = holding();
  return weak_watch(holder.object);
}

// A closure's environment as the object's only reference.
function capturing(): () => boolean {
  const object = newObject();
  watched = weak_watch(object);
  return () => object.isKindOfClass(classNSString());
}
let watched = 0 as c_int;
function captured(): c_int {
  const check = capturing();
  check();
  return watched;
}

function main(): void {
  const owned = allocString().initWithUTF8String("α\u{1F600} hello");
  console.log("length " + String(owned.length()));
  console.log("utf8 " + owned.UTF8String());
  console.log("upper " + owned.uppercaseString().UTF8String());

  // A class method, and an object as an argument.
  const same = stringWithUTF8String("α\u{1F600} hello");
  const other = stringWithUTF8String("β\u{1F600} hello");
  console.log("equal " + String(owned.isEqualToString(same)) + " " + String(owned.isEqualToString(other)));

  // A collection: an object in, `id` out, and a checked downcast back.
  const array = arrayWithCapacity(2n as c_ulong);
  array.addObject(owned);
  array.addObject(other);
  console.log("count " + String(array.count()));
  const first = array.objectAtIndex(0n as c_ulong);
  const text = unsafeDowncast<NSString>(first, first.isKindOfClass(classNSString()));
  console.log("first " + (text === null ? "not a string" : text.UTF8String()));
  // An array seen as an object, so the cast is a real downcast. The check
  // says no, and the answer is null. The compiler refuses the sideways cast
  // (`NSMutableArray` to `NSString`) before the check could say anything.
  const asObject: NSObject = array;
  const wrong = unsafeDowncast<NSString>(asObject, asObject.isKindOfClass(classNSString()));
  console.log("array as string " + (wrong === null ? "null" : "a string"));
  console.log("array is array " + String(array.isKindOfClass(classNSMutableArray())));

  // Lifetimes. An object is alive while a TypeScript value holds it, and gone
  // once the last one dies.
  const held = newObject();
  const watch = weak_watch(held);
  console.log("held " + state(watch));
  console.log("held again " + String(held.isKindOfClass(classNSString())));
  console.log("scoped new " + state(scoped()));
  console.log("scoped init " + state(initialised()));
  console.log("in a field " + state(inAField()));
  console.log("captured " + state(captured()));
}

main();
