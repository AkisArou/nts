// A getter with no return annotation.
//
// `examples/accessors` covers accessors, and every getter in it is written
// `get doubled(): number`. That is the unusual spelling. `get doubled()` is
// the ordinary one -- TypeScript infers the property type from the body, and
// nobody writes the annotation unless a lint asks for it.
//
// The inferred form lowered as `-> void` with its `return` dropped. It was not
// refused and it was not wrong-but-running: `emit-c` said `nothing refused`
// and wrote C that assigns from a `void` call, which clang rejects with `use
// of undeclared identifier`. On a class and in an object literal alike, for as
// long as getters had existed.
//
// The cause is that a getter's node type is **the type of the property it
// defines**, not a function type -- so the signature branch that answers
// "what does this declare" never matched one, and the branch under it reads
// the *written annotation*, which is why annotating it worked and inferring
// it did not. Two derivations of one fact, and the call site used the other
// one: it read the property type and expected a value back.
//
// So the arms below are annotated and un-annotated side by side. An arm that
// only exercised one spelling would pass on both compilers.

class Box {
  constructor(private value: number) {}

  // Inferred: the shape this example exists for.
  get doubled() {
    return this.value * 2;
  }

  // Annotated, the spelling that already worked, as the control beside it.
  get tripled(): number {
    return this.value * 3;
  }

  // Inferred, and not a number. A getter's property type is whatever the body
  // produces, so the fix has to represent it rather than assume a scalar.
  get label() {
    return `box(${this.value})`;
  }

  // Inferred through a branch, where the property type is a union the checker
  // widens rather than anything written down.
  get sign() {
    return this.value < 0 ? -1 : 1;
  }

  // A getter and a setter over one name, the getter inferred. The setter is
  // void by construction and was never affected -- which is what made this
  // look like an object-literal problem when it was an annotation one.
  get held() {
    return this.value;
  }

  set held(v: number) {
    this.value = v;
  }
}

// A getter on a class that reads another getter, so the inferred type has to
// survive being consumed by lowering rather than only by the emitter.
class Wrapper {
  constructor(private box: Box) {}

  get twiceDoubled() {
    return this.box.doubled * 2;
  }
}

export function inferredGetter(n: number): number {
  return new Box(n).doubled;
}

export function annotatedGetter(n: number): number {
  return new Box(n).tripled;
}

export function inferredStringGetter(n: number): number {
  return new Box(n).label.length;
}

export function inferredUnionGetter(n: number): number {
  return new Box(n).sign;
}

export function inferredPairedWithASetter(n: number): number {
  const box = new Box(n);
  box.held = n * 5;
  return box.held;
}

export function throughASecondGetter(n: number): number {
  return new Wrapper(new Box(n)).twiceDoubled;
}

export function inferredGetterOnAnObjectLiteral(n: number): number {
  const o = {
    v: n,
    get double() {
      return this.v * 2;
    },
  };
  return o.double;
}

export function inferredGetterWithNoThis(n: number): number {
  const o = {
    get five() {
      return 5;
    },
  };
  return o.five + n;
}
