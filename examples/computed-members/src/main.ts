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
