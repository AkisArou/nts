// expect: a module-scope name holding a function, whose closure layout its initializer does not fix
//
// The pattern `runtime/web-platform/src/core/abort-brand.ts` uses to keep
// `events.ts` independent of its `AbortSignal` subclass (PR #2): a
// module-scope `let` with a definite-assignment assertion holds the brand
// check, the class's static block installs it once, and callers go through
// the indirect name. The direct form of the same check -- imported, not
// installed -- compiles today; see
// `tests/programs/a-brand-check-on-a-known-class`, which differs in that
// only. What refuses here is the write-once module function, not the
// `#field in value` brand test and not the static block.
//
// When this reports FIXED, move the fixture to `tests/programs`: it then
// pins that the installed check answers as node does.
import { isOps } from "./brand.ts";
import { Widget } from "./widget.ts";

export function run(seed: number): number {
  const w = new Widget();
  return (isOps(w) ? 1 : 0) + (isOps(seed) ? 10 : 0) + seed;
}
