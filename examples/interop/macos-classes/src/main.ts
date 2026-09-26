// Foundation's classes as TypeScript classes: `new` (alloc and init, an
// inherited init, and a class method Swift imports as an init), methods,
// properties read and written, a class property, and `instanceof`. Checked
// against the same program in Objective-C (`reference/classes.m`).
import {
  FileManager,
  NSClassFromString,
  NSMutableArray,
  NSNumber,
  NSObject,
  NSOperation,
  NSAttributedString,
  NSPredicate,
  type NSRange,
  NSProcessInfo,
  NSSet,
  NSString,
  NSStringFromClass,
  NSStringSet,
  XMLParser,
  type NSXMLParserDelegate,
} from "objc:Foundation";
import { kvc_watch, kvo_forget, kvo_observe, live_objects, weak_alive, weak_watch } from "c:support";
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
  console.log(`maps ${map.size} ${map.has("kept")} ${missing === undefined} ${weak_alive(dropped) ? "alive" : "gone"}`);
  let count = 0;
  for (const [key, value] of map) {
    if (key === "kept" && value.isEqual(kept)) count++;
  }
  map.forEach((value) => {
    if (value.isEqual(kept)) count++;
  });
  console.log(`maps iterated ${count}`);
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
  console.log(`arrays ${numbers.length} ${tail.length} ${total} ${tail[0].intValue} ${numbers.indexOf(tail[1])}`);
  const objects: NSObject[] = [watched()];
  objects[0] = new NSObject();
  console.log(`replaced ${weak_alive(replaced) ? "alive" : "gone"}`);
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

// Swift's `class Scored: Tally { var bonus = 5 }`: a subclass adds fields
// to a class with fields. One instance holds both, the base's first, so a
// `Tally` field is where `Tally`'s methods look for it whichever class the
// instance is. `Plain` adds none, and its instances have `Tally`'s.
class Scored extends Tally {
  bonus = 5;

  score(): number {
    this.bump();
    return this.count + this.bonus;
  }
}

class Plain extends Tally {}

let scoredWatch = 0 as c_int;

function scored(): string {
  const scored = new Scored();
  scoredWatch = weak_watch(scored);
  scored.step = 3;
  const first = scored.score();
  const asTally: Tally = scored;
  asTally.bump();
  const plain = new Plain();
  plain.bump();
  return `${first} ${scored.total()} ${scored.bonus} ${plain.count} ${plain.label}`;
}

// Swift's `override func`: a method a subclass overrides answers for the
// subclass's instance whatever type the call sees it as -- `bump`, which the
// runtime is told of, and `tagged(_:)`, which takes a `String` no message
// could carry and which only the program calls.
class Tagger extends NSObject {
  bump(): number {
    return 1;
  }

  tagged(name: string): string {
    return `tagger ${name}`;
  }
}

class Loud extends Tagger {
  override bump(): number {
    return 2;
  }

  override tagged(name: string): string {
    return `loud ${name.toUpperCase()}`;
  }
}

class Louder extends Loud {
  override bump(): number {
    return 3;
  }
}

function overridden(): string {
  const all: Tagger[] = [new Tagger(), new Loud(), new Louder()];
  const parts: string[] = [];
  for (const tagger of all) {
    parts.push(`${tagger.bump()} ${tagger.tagged("x")}`);
  }
  return parts.join(", ");
}

// The same call on an object key-value observing has given a class of the
// runtime's making, below `Loud`: still `Loud`'s methods.
function observed(): string {
  const loud: Tagger = new Loud();
  const replaced = kvo_observe(loud);
  const line = `${replaced} ${loud.bump()} ${loud.tagged("y")}`;
  kvo_forget(loud);
  return line;
}

// Swift's `NSStringFromClass(NSClassFromString(name)!)`: a C function taking
// and answering an `NSString *`, given a literal, a variable and a string
// built at run time -- each crosses as the `NSString` the parameter
// declares, whatever the argument's own type is.
function roundTrip(name: string): string {
  const cls = NSClassFromString(name);
  return cls === null ? "none" : NSStringFromClass(cls);
}

function classNames(): string {
  const name = "NSMutableArray";
  const tail = "String";
  const literal = NSClassFromString("NSObject");
  return [
    literal === null ? "none" : NSStringFromClass(literal),
    roundTrip(name),
    roundTrip("NS" + tail),
    roundTrip("NoSuchClass"),
  ].join(" ");
}

// Swift's `@objc var made: NSObject { NSObject() }`, read by key-value
// coding: the runtime calls the program's `made`, which answers a new object
// at +0 as ARC's getter does. Its count goes to the pool, and the object is
// gone once the pool is.
class Maker extends NSObject {
  made(): NSObject {
    return new NSObject();
  }
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
  // The last element's name, kept past the call that handed it over.
  last = "";

  // Swift's `elementName: String`: the runtime's `NSString`, copied into
  // the program's string where the method is entered. The entry point gives
  // its copy back once the method returns, so `last` holds its own count.
  parserDidStartElement(parser: NSObject, elementName: string, namespaceURI: string | null, qualifiedName: string | null, attributes: NSObject): void {
    elements += (elements === "" ? "" : ",") + elementName;
    this.last = elementName;
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
  const line = `${parser.parse()} ${elements} ${adopted("Elements", "NSXMLParserDelegate")}`;
  kept = delegate;
  return line;
}

let kept: Elements | null = null;

// The name `parserDidStartElement` stored, read after the parse that passed
// it has returned, and again after a second parse with other names.
function keptNames(): string {
  const delegate = kept;
  if (delegate === null) {
    return "none";
  }
  const first = delegate.last;
  const data = new NSString("<x><yz/></x>").data({ using: 4 });
  if (data === null) {
    return "no data";
  }
  const parser = new XMLParser({ data });
  parser.delegate = delegate;
  parser.parse();
  return `${first} ${delegate.last}`;
}

function optional(operation: NSOperation | null): string {
  operation?.cancel();
  return `${operation?.isCancelled ?? "absent"} ${operation?.name ?? "unnamed"}`;
}

function main(): void {
  const list = new NSMutableArray();
  console.log(`empty ${list.count}`);
  for (const n of [1, 2, 3]) {
    list.addObject(new NSNumber(n));
  }
  console.log(`count ${list.count}`);
  list.insert(new NSNumber(0), { at: 0 });
  console.log(`inserted ${list.count} first ${(list.object(0) as NSNumber).intValue}`);
  list.sort((a, b) => Math.sign((b as NSNumber).intValue - (a as NSNumber).intValue));
  console.log(`sorted ${(list.object(0) as NSNumber).intValue} ${(list.object(3) as NSNumber).intValue}`);

  const answer = new NSNumber(42);
  console.log(`number ${answer.intValue} equal ${answer.isEqual(new NSNumber(42))}`);
  console.log(`kinds ${answer instanceof NSNumber} ${answer instanceof NSString} ${list instanceof NSObject}`);
  console.log(`processors ${NSProcessInfo.processInfo.processorCount > 0}`);

  const text = new NSString("worker");
  console.log(`length ${text.length}`);
  console.log(`upper ${text.uppercaseString} appended ${text.appending("!")}`);
  const operation = new NSOperation();
  operation.name = "worker";
  const name = operation.name;
  if (name !== null) {
    console.log(`name ${name} ${name.length}`);
  }

  // Swift's `[String]` and `[Any]` at a message: copied into an `NSArray`
  // for the call, and out of the one it returns.
  const parts = new NSString("a,b,c").components({ separatedBy: "," });
  console.log(`parts ${parts.length} ${parts.join("+")} ${NSString.path({ withComponents: ["usr", "lib"] })}`);
  const more = new NSMutableArray();
  more.addObjects({ from: [new NSNumber(7), new NSNumber(8)] });
  const both = more.adding({ contentsOf: [new NSNumber(9)] });
  console.log(`bridged ${more.count} ${both.length} ${(both[2] as NSNumber).intValue}`);

  // Swift's `throws`: a reported `NSError` is a thrown `Error`.
  const frameworks = FileManager.default.contentsOfDirectory({ atPath: "/System/Library/Frameworks/AppKit.framework" });
  console.log(`listed ${frameworks.includes("Versions")}`);
  try {
    FileManager.default.contentsOfDirectory({ atPath: "/nts-no-such-directory" });
    console.log("listed a missing directory");
  } catch (error) {
    console.log(`thrown ${(error as Error).message}`);
  }
  // Swift's `[String]?`: a nil `NSArray` is `null`, and one that is there is
  // read as an array.
  const missing = FileManager.default.subpaths({ atPath: "/nts-no-such-directory" });
  const present = FileManager.default.subpaths({ atPath: "/System/Library/Frameworks/AppKit.framework" });
  console.log(`subpaths ${missing === null} ${present !== null && present.includes("Versions")}`);
  // And `[Any]?` at a message: `null` is sent as nil.
  const always = new NSPredicate({ format: "TRUEPREDICATE", argumentArray: null });
  const three = new NSPredicate({ format: "SELF == %@", argumentArray: [new NSNumber(3)] });
  console.log(`predicates ${always.predicateFormat} ${three.predicateFormat}`);
  // Swift's `UnsafeMutablePointer<NSRange>`: the method writes the range the
  // attribute is absent across, the whole string.
  const attributed = new NSAttributedString("hello world");
  const range = local<NSRange>();
  const font = attributed.attribute("NSFont", { at: 3, effectiveRange: range });
  console.log(`attributed ${font === null} ${range.location} ${range.length}`);
  // Swift's `[NSAttributedString.Key: Any]`: a map, crossing as the
  // `NSDictionary` the message takes.
  const attributes = new Map<string, NSObject>();
  attributes.set("nts.count", new NSNumber(7));
  const styled = new NSAttributedString("hello", { attributes });
  const count = styled.attribute("nts.count", { at: 1, effectiveRange: null });
  const absent = styled.attribute("absent", { at: 1, effectiveRange: null });
  console.log(`styled ${count !== null && count.isEqual(new NSNumber(7))} ${absent === null}`);
  const named = new NSAttributedString("hello", { textAttributes: new Map([["nts.name", "ada"]]) });
  const nameValue = named.attribute("nts.name", { at: 0, effectiveRange: null });
  console.log(`named ${nameValue !== null && nameValue.isEqual(new NSString("ada"))}`);
  // And back: the `NSDictionary` a message answers, as a map.
  const read = styled.attributes({ at: 1, effectiveRange: null });
  const seven = read.get("nts.count");
  console.log(`read ${read.size} ${seven !== undefined && seven.isEqual(new NSNumber(7))}`);
  const environment = NSProcessInfo.processInfo.environment;
  console.log(`environment ${environment.size > 0} ${environment.get("HOME") !== undefined}`);
  // Swift's `UnsafeMutablePointer<UInt>`, three of them: the numbers the
  // message writes, read back as `[0]`.
  const start = local<UInt>();
  const end = local<UInt>();
  const contentsEnd = local<UInt>();
  const at = local<NSRange>();
  at.location = 4;
  at.length = 0;
  new NSString("ab\ncde\nf").getLineStart(start, { end, contentsEnd, for: at });
  console.log(`line ${start[0]} ${end[0]} ${contentsEnd[0]}`);
  // And `UnsafeMutablePointer<ObjCBool>`: a `BOOL` the message writes.
  const directory = local<ObjCBool>();
  const exists = FileManager.default.fileExists({ atPath: "/System", isDirectory: directory });
  console.log(`exists ${exists} ${directory[0] !== 0}`);
  // Labels held in a variable, as a wrapper passes on the ones it was given:
  // each read from its field at the call.
  const byDash = { separatedBy: "-" };
  const split = (text: string, labels: { separatedBy: string }) => new NSString(text).components(labels);
  console.log(`labelled ${split("x-y-z", byDash).length} ${new NSString("p-q").components(byDash).join("+")}`);
  // Swift's `Set<NSObject>` and `Set<String>`. An equal string is one
  // element, as `-isEqual:` says, and the `Set` read back finds an equal one
  // it was not given; the `Set` passed is an `NSSet` made of it.
  const pair = new NSSet([new NSString("a"), new NSString("b"), new NSString("a")]);
  const grown = pair.setByAdding(new NSString("c"));
  const strings = new NSStringSet(["x", "y", "x"]);
  const added = strings.setByAdding("z");
  console.log(
    `sets ${pair.count} ${grown.size} ${grown.has(new NSString("c"))} ${pair.isSubset({ of: grown })} ${strings.count} ${added.size} ${added.has("z")}`,
  );

  console.log(`parsed ${parsed()}`);
  console.log(`kept ${keptNames()}`);
  console.log(`answered ${weak_alive(kvc_watch(new Maker(), "made")) ? "alive" : "gone"}`);
  // `dealloc` gave the fields back: as many of the program's objects are
  // alive after as before, the array the fields held included.
  const before = live_objects();
  console.log(`fields ${tallied()}`);
  // Counted before the line reporting it is built, which is itself an object.
  const after = live_objects();
  console.log(`fields ${weak_alive(tallyWatch) ? "alive" : "gone"} ${after === before ? "released" : "held"}`);
  console.log(`inherited ${scored()}`);
  console.log(`inherited ${weak_alive(scoredWatch) ? "alive" : "gone"}`);
  console.log(`constructed ${ledgered()}`);
  console.log(`constructed ${weak_alive(ledgerWatch) ? "alive" : "gone"}`);
  console.log(`ledgers ${Ledger.described()}`);
  console.log(`overridden ${overridden()}`);
  console.log(`observed ${observed()}`);
  console.log(`class-names ${classNames()}`);

  // Swift's optional chaining: a message to an absent receiver is not sent,
  // and the chain is `undefined`.
  console.log(`optional ${optional(operation)} ${optional(null)}`);

  arrays();
  console.log(`array ${weak_alive(held) ? "alive" : "gone"}`);
  maps();
  console.log(`mapped ${weak_alive(mapped) ? "alive" : "gone"}`);

  made();
  console.log(`object ${weak_alive(watch) ? "alive" : "gone"}`);
  console.log("done");
}

main();
