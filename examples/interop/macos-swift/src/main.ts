// A project's own Swift from TypeScript: `native/Greeter` is a Swift module,
// and the program imports its `@objc` declarations as `objc:Greeter`, by the
// names an Objective-C client has for them. No binding is committed: `nts
// build` compiles the module, and binds the header Swift writes for it.
//
// What it checks, against `reference/main.swift`, the same program in Swift:
//
//   greet ...        an initializer with labels, and a method
//   name / renamed   a property read, written and read through the method
//   count 2          a class property
//   delegate ...     a TypeScript class adopting the module's protocol: its
//                    required method called back, then its optional one
//   later 5          the `async` form of a completion handler, completed on
//                    another thread and awaited here
//   greeter gone     the Greeter released once the program drops it
import { Greeter, Watch, type GreeterDelegate } from "objc:Greeter";
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
  const watch = Watch.watch(greeter);
  console.log(`greet ${greeter.greet({ withTimes: 2 })}`);
  console.log(`name ${greeter.name}`);
  greeter.name = "world";
  console.log(`renamed ${greeter.greet({ withTimes: 1 })}`);
  console.log(`count ${Greeter.greetingCount}`);
  greeter.delegate = watcher;
  console.log(`quiet ${greeter.greet({ withTimes: 1 })}`);
  watcher.shout = true;
  console.log(`shouted ${greeter.greet({ withTimes: 1 })}`);
  watcher.shout = false;
  console.log(`later ${await greeter.greetLater()}`);
  return watch;
}

async function main(): Promise<void> {
  const watcher = new Watcher();
  const watch = await greetings(watcher);
  console.log(`greeter ${Watch.isAlive(watch) ? "alive" : "gone"}`);
}

void main();
