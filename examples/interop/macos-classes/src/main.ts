// Foundation's classes as TypeScript classes: `new` (alloc and init, an
// inherited init, and a class method Swift imports as an init), methods,
// properties read and written, a class property, and `instanceof`. Checked
// against the same program in Objective-C (`reference/classes.m`).
import {
  FileManager,
  NSMutableArray,
  NSNumber,
  NSObject,
  NSOperation,
  NSPredicate,
  NSProcessInfo,
  NSString,
  XMLParser,
  type NSXMLParserDelegate,
} from "objc:Foundation";
import { live_objects, report, weak_alive, weak_watch } from "c:support";
import { class_conformsToProtocol, objc_getClass, objc_getProtocol } from "objc:runtime";
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

// Swift's `class Tally: NSObject { var count = 0 ... }`: fields on a class the
// runtime makes. They live in an object its ivar holds, made by `init` with the
// initialisers run and given back by `dealloc` -- a managed array among them,
// which the object owns a count of.
class Tally extends NSObject {
  count = 0;
  step = 2;
  label = "tally";
  names: string[] = [];

  bump(): void {
    this.count += this.step;
  }

  total(): number {
    return this.count;
  }
}

let tallyWatch = 0 as c_int;

function tallied(): string {
  const tally = new Tally();
  tallyWatch = weak_watch(tally);
  tally.bump();
  tally.step = 4;
  tally.bump();
  tally.names.push("x");
  tally.names.push("y");
  tally.label = "total";
  return `${tally.label} ${tally.total()} ${tally.count} ${tally.names.join(",")}`;
}

// Swift's `init(owner:opening:)` on an `NSObject` subclass: a constructor
// taking arguments, whose `super()` makes the instance and whose body then
// sets a field and sends the instance a message of its own.
class Ledger extends NSObject {
  // Swift's `static var` and `static func`: the program's alone.
  static opened = 0;
  static described(): string {
    return `${Ledger.opened} opened`;
  }

  owner: string;
  balance = 0;
  entries = 0;

  constructor(owner: string, opening: number) {
    super();
    Ledger.opened++;
    this.owner = owner;
    this.record(opening);
  }

  record(amount: number): void {
    this.balance += amount;
    this.entries++;
  }
}

let ledgerWatch = 0 as c_int;

function ledgered(): string {
  const ledger = new Ledger("ada", 10);
  ledgerWatch = weak_watch(ledger);
  ledger.record(5);
  return `${ledger.owner} ${ledger.balance} ${ledger.entries}`;
}

let elements = "";

// Swift's `class Elements: NSObject, XMLParserDelegate`: the parser sends the
// protocol's five-argument selector, which only the protocol can name.
class Elements extends NSObject implements NSXMLParserDelegate {
  parserDidStartElement(parser: NSObject, elementName: NSString, namespaceURI: NSString | null, qualifiedName: NSString | null, attributes: NSObject): void {
    elements += (elements === "" ? "" : ",") + elementName.appending("");
  }
}

// What `implements` told the runtime: the class conforms, as `class_addProtocol`
// makes it, and `conformsToProtocol:` answers.
function adopted(name: string, protocolName: string): string {
  const cls = objc_getClass(name);
  const protocol = objc_getProtocol(protocolName);
  return cls !== null && protocol !== null && class_conformsToProtocol(cls, protocol) ? "adopted" : "not adopted";
}

function parsed(): string {
  const data = new NSString("<a><b/><c><d/></c></a>").data({ using: 4 });
  if (data === null) {
    return "no data";
  }
  const parser = new XMLParser({ data });
  const delegate = new Elements();
  parser.delegate = delegate;
  return `${parser.parse()} ${elements} ${adopted("Elements", "NSXMLParserDelegate")}`;
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
  list.sort((a, b) => Math.sign((b as NSNumber).intValue - (a as NSNumber).intValue));
  report(`sorted ${(list.object(0) as NSNumber).intValue} ${(list.object(3) as NSNumber).intValue}`);

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

  // Swift's `[String]` and `[Any]` at a message: copied into an `NSArray`
  // for the call, and out of the one it returns.
  const parts = new NSString("a,b,c").components({ separatedBy: "," });
  report(`parts ${parts.length} ${parts.join("+")} ${NSString.path({ withComponents: ["usr", "lib"] })}`);
  const more = new NSMutableArray();
  more.addObjects({ from: [new NSNumber(7), new NSNumber(8)] });
  const both = more.adding({ contentsOf: [new NSNumber(9)] });
  report(`bridged ${more.count} ${both.length} ${(both[2] as NSNumber).intValue}`);

  // Swift's `throws`: a reported `NSError` is a thrown `Error`.
  const frameworks = FileManager.default.contentsOfDirectory({ atPath: "/System/Library/Frameworks/AppKit.framework" });
  report(`listed ${frameworks.includes("Versions")}`);
  try {
    FileManager.default.contentsOfDirectory({ atPath: "/nts-no-such-directory" });
    report("listed a missing directory");
  } catch (error) {
    report(`thrown ${(error as Error).message}`);
  }
  // Swift's `[String]?`: a nil `NSArray` is `null`, and one that is there is
  // read as an array.
  const missing = FileManager.default.subpaths({ atPath: "/nts-no-such-directory" });
  const present = FileManager.default.subpaths({ atPath: "/System/Library/Frameworks/AppKit.framework" });
  report(`subpaths ${missing === null} ${present !== null && present.includes("Versions")}`);
  // And `[Any]?` at a message: `null` is sent as nil.
  const always = new NSPredicate({ format: "TRUEPREDICATE", argumentArray: null });
  const three = new NSPredicate({ format: "SELF == %@", argumentArray: [new NSNumber(3)] });
  report(`predicates ${always.predicateFormat} ${three.predicateFormat}`);
  // Labels held in a variable, as a wrapper passes on the ones it was given:
  // each read from its field at the call.
  const byDash = { separatedBy: "-" };
  const split = (text: string, labels: { separatedBy: string }) => new NSString(text).components(labels);
  report(`labelled ${split("x-y-z", byDash).length} ${new NSString("p-q").components(byDash).join("+")}`);

  report(`parsed ${parsed()}`);
  // `dealloc` gave the fields back: as many of the program's objects are
  // alive after as before, the array the fields held included.
  const before = live_objects();
  report(`fields ${tallied()}`);
  // Counted before the line reporting it is built, which is itself an object.
  const after = live_objects();
  report(`fields ${weak_alive(tallyWatch) ? "alive" : "gone"} ${after === before ? "released" : "held"}`);
  report(`constructed ${ledgered()}`);
  report(`constructed ${weak_alive(ledgerWatch) ? "alive" : "gone"}`);
  report(`ledgers ${Ledger.described()}`);

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
