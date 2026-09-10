// A `static` field, read and written through the class name.
//
//     class EventEmitter {
//       static readonly errorMonitor: unique symbol = Symbol("events.errorMonitor");
//     }
//     if (isError && events.get(EventEmitter.errorMonitor) !== undefined) { ... }
//
// Refused as "`EventEmitter`, a class used as a value" — the message for a
// different construct. A static read does not want the class object; it wants
// the storage behind the name. Handing it a token would produce an object with
// no field to read.
//
// # What it was under
//
// That line is inside `EventEmitter#emit`. Under `emit` sit `addListener`,
// `EventEmitter#on`, `net.Server`'s constructor, `http.Server`'s, and
// `createServer` — **274 failing test files** by the Node lane's ranking.
// `EventEmitter#on` lowers now.
//
// # A static field is a global
//
// One location for the program, written once when the class is defined — which
// is during module evaluation, the same moment every other deferred global is
// written and in the same source order. So it is `collect_module_scope`'s
// machinery keyed on the property's own symbol: a read resolves as a
// module-scope `const`'s does, and a write is a global write.
//
// Named `Class.field`, which is what a static *method* is already called, and
// `.` is not an identifier character so it cannot collide with a declaration.
//
// A class joins the ordered statement list **only if it has a static field with
// an initializer**. Putting every class in gave a file that had no module
// evaluation an empty `module#init`, and `examples/delete` went from eight
// exports to nine — caught by a test asserting the count exactly, which is the
// kind of assertion that earns its keep.
//
// # `unique symbol` had no representation
//
// `TypeFlagsUniqueESSymbol` is `1 << 14`, and it arrived as
// `Structured { flags: 16384 }` — so every declaration of one was "of
// unrepresentable type", static field or module-scope `const` alike. The
// uniqueness is a *type-level* identity, which is what lets the checker treat
// `[kRefed]` as its own member name; the runtime value is an interned symbol
// like any other.
//
// One consequence, checked rather than assumed: `module#init` now interns a
// symbol per declaration, where before there was none. That does not touch
// `examples/symbol-keys`, whose claim is that a symbol *member name* costs what
// a field costs — no accessor in that example makes a symbol, and the member
// access is still a field.
//
// # Controls
//
// `staticMethod` is the shape that already lowered, so this fixture reports the
// field rather than the class name. `instanceField` reads the same value off an
// instance. `written` and `viaMethod` are the mutable half, which a `readonly`
// fixture alone would not cover.

class Limits {
  static readonly LIMIT = 5;
  static readonly NAME = "cap";
  static readonly TAG: unique symbol = Symbol("limits");
  static count = 1;

  static double(n: number): number {
    return n * 2;
  }

  readonly limit = 5;
}

/** Under test: a numeric static, which folds. */
export function staticNumber(n: number): number {
  return Limits.LIMIT + n * 0;
}

/** Under test: a string static, whose initializer runs at evaluation. */
export function staticString(n: number): number {
  return Limits.NAME.length + n * 0;
}

/** Under test: a `unique symbol` static. */
export function staticSymbol(n: number): number {
  return String(Limits.TAG).length + n * 0;
}

/** Under test: writing one. */
export function written(n: number): number {
  Limits.count = n;
  return Limits.count;
}

/** Under test: a static read and written from inside a static method. */
export function viaMethod(n: number): number {
  Limits.count = n;
  return Limits.double(Limits.count);
}

/** Control: a static method call, which always lowered. */
export function staticMethod(n: number): number {
  return Limits.double(n);
}

/** Control: the same value read off an instance. */
export function instanceField(n: number): number {
  return new Limits().limit + n * 0;
}
