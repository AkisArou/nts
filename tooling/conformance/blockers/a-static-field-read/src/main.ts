// expect: `Limits`, a class used as a value
//
// A **static field** read through the class name.
//
//     class Event { static readonly AT_TARGET = 2; }
//     this.phase = Event.AT_TARGET;                    REFUSED
//
// # It wears the same message as two other constructs
//
// "a class used as a value" covers three unlike things, and the Node lane
// separated them by measurement before I started, which saved a wrong first
// move:
//
//     WithStatic.double(3)    a static method call      lowers today
//     WithStatic.limit        a static field read       refused -- this
//     ?? IncomingMessage      the bare class as a value  fixed 2026-09-10
//
// The third is `examples/a-class-stored-and-compared`. It needed a token: one
// immortal object per class, comparable, `typeof` `"function"`. **A static read
// does not want a token** — it wants the storage behind the name, and handing
// it a token would produce an object with no field to read. Starting from this
// reduction would have cleared a shape and left `http.Server`'s constructor
// exactly where it was.
//
// That the static *method call* already lowers is the useful half: the lowering
// can resolve a member through a class name when the result is immediately
// consumed. What it cannot do is produce a value for the name on its own.
//
// # Size
//
// The commonest of the three in the corpus by a wide margin: **about ten per
// module** across `stream`, `net`, `process`, `fs`, `util`, `events`, `zlib`
// and `console`, and they are the same few shared files counted repeatedly --
// `web-platform/src/core/events.ts` reading `Event.AT_TARGET` and `Event.NONE`,
// `event-source.ts` reading `EventSource.CLOSED`, and `events/src/main.ts`
// reading `EventEmitter.errorMonitor`.
//
// A static field is close to a module-scope `const` with a qualified name: one
// storage location for the program, initialised once. What makes it not simply
// that is a `static` whose initializer reads `this`, and inheritance -- a
// subclass reading a base's static through its own name.
//
// # Controls
//
// `staticMethod` is the shape that already lowers, so this fixture reports the
// field and not the class name. `instanceField` reads the same value off an
// instance, which is the rewrite available to source we control and not to
// node's -- and it lowers, so what is refused is the *static* and not the read.

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
