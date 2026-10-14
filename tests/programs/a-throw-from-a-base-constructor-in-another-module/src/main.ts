// A throw from a base-class constructor declared in another module is caught
// by the `try` around it. `create` (derived.ts) builds a `Derived`, whose
// `super(type)` runs `Base`'s constructor (base.ts), which throws for an empty
// type, and the factory is called through a function value inside a `try`.
//
// It escaped: the compiled program ended with "uncaught Error: no type" where
// node answers -1. `extends Base` with `Base` imported names the import's own
// symbol, which no class declares, so the base was dropped and the derived
// class's construction was not known to raise. Reported by the React lane as
// an outcome (a silent wrong answer, older than any commit they bisected).
import { create } from "./derived.ts";

function run(make: (type: string) => { type: string }, type: string): number {
  try {
    return make(type).type.length;
  } catch (error) {
    return -1;
  }
}

export function made(n: number): number {
  return run(create, n > 0 ? "group" : "") + n;
}
