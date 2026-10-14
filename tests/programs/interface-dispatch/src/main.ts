// Calling a method through an interface-typed value.
//
// The hierarchy is built from class declarations and walks a single `base`
// edge, so an interface was not in it at all: `sink.write(v)` on a `Sink`-typed
// receiver found "a method `write` with no declaration in the hierarchy" and
// was refused. 739 occurrences across the node and web-platform corpora, and
// the most frequent single shape in two other lanes' inventories.
//
// A method on an interface is a **dispatch root**. Every implementer has to be
// reachable through it, which is exactly what a slot is, so the slot is
// numbered against the interface and each class fills it -- a call through
// `Sink` and a call through `Counting` reach the same index.
//
// The interface itself gets an abstract declaration to name at the call site,
// which is the same thing a function type gets for its `call`: a signature the
// program declares, that nothing calls directly, and that every reachable
// receiver overrides.
//
// WHAT THE SABOTAGES SHOW, because it is not what one would guess. Removing the
// `implements` edge from `descends_from` stops three of these functions
// compiling at all rather than making them answer wrongly; filling every
// implementer's slot with one implementation makes the *backend* refuse,
// because the receiver types no longer match. So on this lane the dispatch is
// guarded by the type system and by whether the program builds, and neither
// sabotage produces a wrong number. A genuinely wrong cast through a
// correct-looking table is a thing NEITHER lane sees, and the obvious guess
// about that is wrong: the checked-cast backend catches a bad class edge, but
// JVMS 4.10.1.2 makes any class type assignable to any interface type without
// checking, so a bad interface edge is deferred to `invokeinterface` and shows
// only on a path something runs. What covers the interface half is that every
// case below executes and is compared against node.

interface Sink {
  write(value: number): number;
  close(): number;
}

// TWO IMPLEMENTERS WITH DIFFERENT ANSWERS, which is what makes these cases
// worth anything. One implementer and every arrangement agrees; the dispatch is
// only observable where two disagree.
//
// They also have different FIELDS on purpose. With identical shapes the two
// layouts merged -- `same_shape` compares fields and methods, and before the
// slot existed both method tables were empty, so `Counting` and `Doubling`
// became one layout holding two type ids and the dispatch had nothing left to
// choose between. The slot is what separates them, so a case where the classes
// differ only in behaviour is a case that would pass against a compiler that
// merged them.
class Counting implements Sink {
  total = 0;
  write(value: number): number {
    this.total = this.total + value;
    return this.total;
  }
  close(): number {
    return this.total;
  }
}

class Doubling implements Sink {
  total = 0;
  seen = 0;
  write(value: number): number {
    this.seen = this.seen + 1;
    this.total = this.total + value * 2;
    return this.total;
  }
  close(): number {
    return this.total * 10 + this.seen;
  }
}

// Through a parameter, which is the plainest form.
export function throughAParameter(n: number): number {
  const use = (s: Sink, v: number): number => s.write(v) + s.close();
  return use(new Counting(), n) + use(new Doubling(), n);
}

// Through an interface-typed FIELD, which is the shape the web-platform lane
// reported: `close`, `dispatch` and `parse` called on a field whose declared
// type is an interface.
class Holder {
  sink: Sink;
  constructor(s: Sink) {
    this.sink = s;
  }
  run(v: number): number {
    return this.sink.write(v) + this.sink.close();
  }
}

export function throughAField(n: number): number {
  return new Holder(new Counting()).run(n) + new Holder(new Doubling()).run(n);
}

// Assigned to an interface-typed local, which is an upcast: an interface
// contributes no fields, so there is no prefix to disagree about and the cast
// is the no-op base-first layout already makes it.
export function assignedToAnInterfaceLocal(n: number): number {
  const one: Sink = new Doubling();
  const two: Sink = new Counting();
  return one.write(n) + one.close() + two.write(n) + two.close();
}

// Returned as an interface from a function whose body knows the class.
export function returnedAsAnInterface(n: number): number {
  const counting = (): Sink => new Counting();
  const doubling = (): Sink => new Doubling();
  return counting().write(n) + doubling().write(n);
}

// AN INTERFACE THAT EXTENDS ANOTHER, and a class that both extends a class and
// implements one. This is the only shape that reaches `interface_declaring`:
// where a class merely implements, the interface is already the nearest thing
// the base walk finds, and the slot lands on it without help. Sabotaging that
// function alone leaves every case above agreeing, which is how this one came
// to be written.
interface Closable {
  close(): number;
}
interface Reporting extends Closable {
  report(): number;
}
class Base {
  tag = 7;
}
class Reporter extends Base implements Reporting {
  count = 0;
  close(): number {
    return this.tag;
  }
  report(): number {
    this.count = this.count + 1;
    return this.count * 100 + this.tag;
  }
}
class Quiet extends Base implements Reporting {
  close(): number {
    return this.tag * 2;
  }
  report(): number {
    return 0;
  }
}

export function throughAnExtendedInterface(n: number): number {
  const a: Reporting = new Reporter();
  const b: Reporting = new Quiet();
  return a.report() + a.close() + b.report() + b.close() + n;
}

// And through the interface the other one extends, which is a different slot
// reached from the same objects.
export function throughTheExtendedOne(n: number): number {
  const a: Closable = new Reporter();
  const b: Closable = new Quiet();
  return a.close() + b.close() + n;
}

// Two calls on one receiver, so a table read that answered once and was reused
// would still be right -- and a table read that answered for the wrong class
// would be wrong twice. The second call also depends on state the first wrote,
// which is what makes `close()` different per implementer.
export function twoCallsOnOneReceiver(n: number): number {
  const s: Sink = n > 0 ? new Doubling() : new Doubling();
  s.write(n);
  s.write(n + 1);
  return s.close();
}
