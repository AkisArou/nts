// expect: lowers
//
// **Kept as a guard. Fixed 2026-09-10.**
//
// A **static field** read through the class name.
//
//     class Event { static readonly AT_TARGET = 2; }
//     this.phase = Event.AT_TARGET;                    REFUSED
//
// # It wore the same message as two other constructs
//
// "a class used as a value" covered three unlike things, and the Node lane
// separated them by measurement before this was started, which saved a wrong
// first move:
//
//     WithStatic.double(3)     a static method call       already lowered
//     WithStatic.limit         a static field read        this
//     ?? IncomingMessage       the bare class as a value  record 0269
//
// A static read never wanted a class token; it wanted the storage behind the
// name. Handing it a token would have produced an object with no field to read.
//
// # What it is now
//
// One global per static field, named `Class.field`, initialized in `module#init`
// in class-definition order -- which is exactly what a `static` field *is*: one
// location for the program, written once when the class is defined. Everything
// after that is `collect_module_scope`'s machinery keyed on the property's own
// symbol, so a read resolves as a module-scope `const`'s does, and a write is a
// global write.
//
// A class joins the ordered statement list only if it has a static field with an
// initializer. Putting every class in gave a file that had no module evaluation
// an empty `module#init`, and `examples/delete` went from eight exports to nine
// -- caught by a test asserting the count exactly.
//
// # What it was under
//
// `EventEmitter#emit` reads `EventEmitter.errorMonitor`. Under `emit` sit
// `addListener`, `EventEmitter#on`, `net.Server`'s constructor, `http.Server`'s,
// and `createServer` -- **274 failing test files** by the Node lane's ranking.
// `EventEmitter#on` lowers now.
//
// It also needed `unique symbol` to have a representation, which it did not:
// `TypeFlagsUniqueESSymbol` is `1 << 14` and came through as
// `Structured { flags: 16384 }`, so every declaration of one was "of
// unrepresentable type". The uniqueness is a type-level identity and the
// runtime value is an interned symbol like any other.
//
// # Controls
//
// `staticMethod` is the shape that already lowered, so this fixture reports the
// field and not the class name. `instanceField` reads the same value off an
// instance, which is the rewrite available to source we control and not to
// node's -- so what was refused was the *static* and not the read.

class Limits {
  static readonly LIMIT = 5;
  static double(n: number): number {
    return n * 2;
  }
  readonly limit = 5;
}

/** The reduction. */
export function subject(n: number): number {
  return Limits.LIMIT + n * 0;
}

/** Control: a static method call through the same class name. */
export function staticMethod(n: number): number {
  return Limits.double(n);
}

/** Control: the same value read off an instance. */
export function instanceField(n: number): number {
  return new Limits().limit + n * 0;
}
