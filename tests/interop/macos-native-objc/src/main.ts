// A project's own Objective-C from TypeScript: `native/Greeter.h` declares a
// class and a protocol, `native/Greeter.m` implements the class, and the
// program imports them as `objc:Greeter`, with the names Swift gives them.
// No binding is committed: `nts build` generates it from the header.
//
// What it checks, against `reference/main.m`, the same program in
// Objective-C under ARC:
//
//   greet ...        an initializer with labels, and a method
//   name / renamed   a property read, written and read through the method
//   count 2          a class method
//   delegate ...     a TypeScript class adopting the header's protocol: its
//                    required method called back, then its optional one
//   later 5          the `async` form Swift makes of the completion handler,
//                    completed on another thread and awaited here
//   greeting ...     the same, given a string: the `NSString` the block is
//                    given, read as the program's string
//   greeter gone     the Greeter released once the program drops it
import { Greeter, GreeterAlive, GreeterWatch, type GreeterDelegate } from "objc:Greeter";
import { NSObject } from "objc:Foundation";
import type { Int } from "objc:types";

class Watcher extends NSObject implements GreeterDelegate {
  shout = false;

  greeter(greeter: Greeter, name: string): void {
    console.log(`delegate greeted ${name}`);
  }

  greeterShouldShout(greeter: Greeter): boolean {
    return this.shout;
  }
}

// Made and dropped here: once this returns, nothing holds the Greeter.
async function greetings(watcher: Watcher): Promise<Int> {
  const greeter = new Greeter({ name: "nts" });
  const watch = GreeterWatch(greeter);
  console.log(`greet ${greeter.greet({ withTimes: 2 })}`);
  console.log(`name ${greeter.name}`);
  greeter.name = "world";
  console.log(`renamed ${greeter.greet({ withTimes: 1 })}`);
  console.log(`count ${Greeter.greetingCount()}`);
  greeter.delegate = watcher;
  console.log(`quiet ${greeter.greet({ withTimes: 1 })}`);
  watcher.shout = true;
  console.log(`shouted ${greeter.greet({ withTimes: 1 })}`);
  watcher.shout = false;
  console.log(`later ${await greeter.greetLater()}`);
  const greeting = await greeter.greetingLater();
  console.log(`greeting ${greeting} (${greeting.length})`);
  return watch;
}

async function main(): Promise<void> {
  const watcher = new Watcher();
  const watch = await greetings(watcher);
  console.log(`greeter ${GreeterAlive(watch) ? "alive" : "gone"}`);
}

void main();
