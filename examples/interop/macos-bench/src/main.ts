// Swift's surface, timed: the same four loops as reference/bench.swift.
import { NSMutableArray, NSNumber, NSObject, NSOperation, NSString } from "objc:Foundation";
import { now_ns } from "c:support";

// Milliseconds, from the clock Swift's `DispatchTime` reads.
function now(): number {
  return now_ns() / 1e6;
}

function joined(prefix: string, count: number, separator: string): string {
  let text = "";
  for (let i = 0; i < count; i++) text += (i === 0 ? "" : separator) + prefix + i;
  return text;
}

// A field of a class the runtime makes, and the same field on a class of the
// program's own: what reaching one through the ivar costs over a plain load.
class Tally extends NSObject {
  count = 0;
  bump(): void {
    this.count++;
  }
}

class Plain {
  count = 0;
  bump(): void {
    this.count++;
  }
}

// A method a subclass overrides, called through the base's type: which
// method answers is the object's class's, at run time.
class Shape extends NSObject {
  sides(): number {
    return 0;
  }
}

class Square extends Shape {
  override sides(): number {
    return 4;
  }
}

function time(label: string, count: number, body: () => number): void {
  body();
  const start = now();
  const result = body();
  const elapsed = now() - start;
  console.log(`${label} ${((elapsed * 1e6) / count).toFixed(1)} ns/op (${result})`);
}

function main(): void {
  const number = new NSNumber(7);
  time("send", 10_000_000, () => {
    let total = 0;
    for (let i = 0; i < 10_000_000; i++) total += number.intValue;
    return total;
  });
  const operation = new NSOperation();
  time("string-set", 1_000_000, () => {
    for (let i = 0; i < 1_000_000; i++) operation.name = "worker";
    return 1;
  });
  time("string-get", 1_000_000, () => {
    let total = 0;
    for (let i = 0; i < 1_000_000; i++) total += (operation.name ?? "").length;
    return total;
  });
  const csv = new NSString(joined("item", 64, ","));
  time("array-out", 100_000, () => {
    let total = 0;
    for (let i = 0; i < 100_000; i++) total += csv.components({ separatedBy: "," }).length;
    return total;
  });
  const parts = joined("p", 64, ",").split(",");
  time("array-in", 100_000, () => {
    let total = 0;
    for (let i = 0; i < 100_000; i++) total += NSString.path({ withComponents: parts }).length;
    return total;
  });
  const tally = new Tally();
  time("field", 10_000_000, () => {
    for (let i = 0; i < 10_000_000; i++) tally.bump();
    return tally.count;
  });
  const plain = new Plain();
  time("plain-field", 10_000_000, () => {
    for (let i = 0; i < 10_000_000; i++) plain.bump();
    return plain.count;
  });
  const shape: Shape = new Square();
  time("override", 10_000_000, () => {
    let total = 0;
    for (let i = 0; i < 10_000_000; i++) total += shape.sides();
    return total;
  });
  const list = new NSMutableArray();
  time("objects-in", 100_000, () => {
    const numbers = [new NSNumber(1), new NSNumber(2), new NSNumber(3), new NSNumber(4)];
    for (let i = 0; i < 100_000; i++) list.addObjects({ from: numbers });
    return list.count;
  });
}

main();
