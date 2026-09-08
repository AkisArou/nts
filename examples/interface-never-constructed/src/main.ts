// A field whose declared type is an interface the program never constructs.
//
// The JVM does not check a store into an interface-typed slot: JVMS 4.10.1.2
// makes any class assignable to any interface without verifying it, and
// conformance is settled at the call site instead. So an interface-typed field
// that nothing in the program implements is precisely where a wrong descriptor
// or a missing class goes unnoticed at load and arrives as an
// `IncompatibleClassChangeError` on whichever path reaches it first.
//
// Nothing here implements `Sink`, so no class for it need exist. The JVM lane
// emits the field as `java/lang/Object` and emits no class for the interface at
// all, which is right for this program: the only value ever stored is `null`
// and the only read is a null comparison. This example is what pins that
// fallback -- a comment would not notice it changing.
//
// **The C lane declines this**, with `an object type with no layout`, and that
// is the point of keeping it rather than a reason to drop it. An example the
// backends disagree about is worth more than one they all pass: it makes the
// difference visible in the corpus instead of leaving it to be rediscovered.

interface Sink {
  take(value: number): number;
}

class Holder {
  slot: Sink | null = null;
  count: number = 0;

  bump(value: number): number {
    this.count = this.count + value;
    return this.count;
  }

  // The only read of an interface-typed field in the program, and it never sees
  // anything but `null` -- which is the case that must still compile.
  reaches(): boolean {
    return this.slot !== null;
  }
}

export function twice(value: number): number {
  const holder = new Holder();
  return holder.bump(value) + holder.bump(value);
}

export function empty(value: number): boolean {
  const holder = new Holder();
  return holder.reaches() || value > 0;
}

export function main(): number {
  return twice(21) + (empty(1) ? 1 : 0);
}
