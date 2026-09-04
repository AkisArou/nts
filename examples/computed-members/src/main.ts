// A member declared with brackets around a literal.
//
// Not computed in any run-time sense: `["record"]` names the same member
// `record` does. The brackets are how a class declares a member whose name
// would otherwise be rejected -- node's own `internal/errors` writes
// `get ["constructor"]()`, because `get constructor()` is a type error -- and
// the name is resolved once, at compile time, to a plain string key.
//
// A name the program actually computes (`[kSymbol]`, `[prefix + n]`) is still
// refused. That one needs a property map rather than a field, and reading it
// as a literal would collide two distinct members into a single slot.
//
// It is worth doing because the name is resolved in two places that have to
// agree: the function a member is *emitted* as, and the table a call site
// *finds* it through. Fixing one and not the other produces a method the
// emitter names and nothing can reach.

class Registry {
  private count = 0;
  private label = "registry";

  ["record"](n: number): number {
    this.count += n;
    return this.count;
  }

  // Quotes do the same job as brackets, and mean the same thing.
  "restate"(): number {
    return this.count;
  }

  // A name no class can spell without brackets.
  get ["constructor"](): string {
    return this.label;
  }

  get ["size"](): number {
    return this.count;
  }

  set ["size"](n: number) {
    this.count = n;
  }

  // A numeric literal is a name too, and it is the string of its digits.
  [0](): number {
    return this.count * 2;
  }
}

export function records(n: number): number {
  const registry = new Registry();
  registry.record(n);
  registry.record(n + 2);
  return registry.restate();
}

export function accessors(n: number): number {
  const registry = new Registry();
  registry.size = n;
  return registry.size + registry[0]();
}

export function reservedName(n: number): string {
  const registry = new Registry();
  registry.size = n;
  return registry.constructor;
}

// The bracketed and unbracketed spellings are one member, reached either way.
export function inALiteral(n: number): number {
  const pair = { ["bracketed"]: n, "quoted": n + 1, direct: 4 };
  return pair.bracketed + pair.quoted + pair.direct;
}

// A member keyed by a *symbol*, which is not a name the program computes
// however much the brackets suggest it. `[kStep]` resolves to exactly one
// property and the checker spells it `__@kStep@N` -- the description written
// between the brackets and its own id for the symbol.
//
// The *field* spelling has always worked, because a layout takes its field
// names straight from the checker's members. The *method* spelling did not,
// and it needed three places to agree letter for letter rather than two: the
// declaration decides what the function is emitted as, the hierarchy decides
// what a lookup finds, and the call site decides what is looked up. Only the
// first had a rule. Writing one of the three emitted a method nothing could
// reach; writing two of them reported "a method `__@kStep@2` with no
// declaration in the hierarchy", which is the emitted name failing to find
// itself.
const kStep = Symbol("step");
const kSeen = Symbol("seen");

class Counter {
  [kSeen]: number;
  at: number;

  constructor(at: number) {
    this.at = at;
    this[kSeen] = 0;
  }

  [kStep](by: number): number {
    this[kSeen] = this[kSeen] + 1;
    this.at = this.at + by;
    return this.at;
  }

  // A plain method beside it, so the two spellings are known to coexist rather
  // than one replacing the other.
  plainStep(by: number): number {
    return this.at + by;
  }
}

export function symbolKeyedMethod(n: number): number {
  const c = new Counter(n);
  return c[kStep](2) + c[kStep](3) + c[kSeen] + c.plainStep(1);
}
