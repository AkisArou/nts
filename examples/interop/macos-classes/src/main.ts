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
  NSAttributedString,
  NSPredicate,
  type NSRange,
  NSProcessInfo,
  NSString,
  XMLParser,
  type NSXMLParserDelegate,
} from "objc:Foundation";
import { live_objects, report, weak_alive, weak_watch } from "c:support";
import { class_conformsToProtocol, objc_getClass, objc_getProtocol } from "objc:runtime";
import type { c_int } from "c:types";
import type { ObjCBool, UInt } from "objc:types";
import { local } from "c:memory";

let watch = 0 as c_int;

// `new` hands over an object the caller owns: once this returns, nothing
// holds it, and it is gone.
function made(): void {
  const object = new NSObject();
  watch = weak_watch(object);
}

let replaced = 0 as c_int;
let held = 0 as c_int;
let mapped = 0 as c_int;

// A weak watch on a map's entry, in a function of its own: a counted handle a
// function reads is held to the end of its block, and this one's ends here.
function watchEntry(map: Map<string, NSObject>, key: string): c_int {
  return weak_watch(map.get(key)!);
}

// Swift's `[String: NSObject]`: a map holds each object in a box of its
// family, whose count it gives back when the entry is overwritten or deleted,
// or the map goes. Overwriting an entry with itself keeps it.
function maps(): void {
  const map = new Map<string, NSObject>();
  const kept = new NSObject();
  mapped = weak_watch(kept);
  map.set("kept", kept);
  map.set("dropped", new NSObject());
  const dropped = watchEntry(map, "dropped");
  map.set("kept", map.get("kept")!);
  map.delete("dropped");
  const missing = map.get("missing");
  report(`maps ${map.size} ${map.has("kept")} ${missing === undefined} ${weak_alive(dropped) ? "alive" : "gone"}`);
  let count = 0;
  for (const [key, value] of map) {
    if (key === "kept" && value.isEqual(kept)) count++;
  }
  map.forEach((value) => {
    if (value.isEqual(kept)) count++;
  });
  report(`maps iterated ${count}`);
}

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
// sets its fields -- one a parameter property -- and sends the instance a
// message of its own.
class Ledger extends NSObject {
  // Swift's `static var` and `static func`: the program's alone.
  static opened = 0;
  static described(): string {
    return `${Ledger.opened} opened`;
  }

  balance = 0;
  entries = 0;

  // `owner` a field too, as `readonly` declares it.
  constructor(
    readonly owner: string,
    opening: number,
  ) {
    super();
    Ledger.opened++;
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
  // Swift's `UnsafeMutablePointer<NSRange>`: the method writes the range the
  // attribute is absent across, the whole string.
  const attributed = new NSAttributedString("hello world");
  const range = local<NSRange>();
  const font = attributed.attribute("NSFont", { at: 3, effectiveRange: range });
  report(`attributed ${font === null} ${range.location} ${range.length}`);
  // Swift's `[NSAttributedString.Key: Any]`: a map, crossing as the
  // `NSDictionary` the message takes.
  const attributes = new Map<string, NSObject>();
  attributes.set("nts.count", new NSNumber(7));
  const styled = new NSAttributedString("hello", { attributes });
  const count = styled.attribute("nts.count", { at: 1, effectiveRange: null });
  const absent = styled.attribute("absent", { at: 1, effectiveRange: null });
  report(`styled ${count !== null && count.isEqual(new NSNumber(7))} ${absent === null}`);
  const named = new NSAttributedString("hello", { textAttributes: new Map([["nts.name", "ada"]]) });
  const nameValue = named.attribute("nts.name", { at: 0, effectiveRange: null });
  report(`named ${nameValue !== null && nameValue.isEqual(new NSString("ada"))}`);
  // And back: the `NSDictionary` a message answers, as a map.
  const read = styled.attributes({ at: 1, effectiveRange: null });
  const seven = read.get("nts.count");
  report(`read ${read.size} ${seven !== undefined && seven.isEqual(new NSNumber(7))}`);
  const environment = NSProcessInfo.processInfo.environment;
  report(`environment ${environment.size > 0} ${environment.get("HOME") !== undefined}`);
  // Swift's `UnsafeMutablePointer<UInt>`, three of them: the numbers the
  // message writes, read back as `[0]`.
  const start = local<UInt>();
  const end = local<UInt>();
  const contentsEnd = local<UInt>();
  const at = local<NSRange>();
  at.location = 4;
  at.length = 0;
  new NSString("ab\ncde\nf").getLineStart(start, { end, contentsEnd, for: at });
  report(`line ${start[0]} ${end[0]} ${contentsEnd[0]}`);
  // And `UnsafeMutablePointer<ObjCBool>`: a `BOOL` the message writes.
  const directory = local<ObjCBool>();
  const exists = FileManager.default.fileExists({ atPath: "/System", isDirectory: directory });
  report(`exists ${exists} ${directory[0] !== 0}`);
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
  maps();
  report(`mapped ${weak_alive(mapped) ? "alive" : "gone"}`);

  made();
  report(`object ${weak_alive(watch) ? "alive" : "gone"}`);
  report("done");
}

main();
