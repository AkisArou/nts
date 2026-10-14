// A call to an **overloaded** function whose name two modules share.
//
// `lower_call` derives the name a direct call is emitted under from the
// declaration the checker resolved the call to. For an overloaded function that
// declaration is an overload *signature*, and `qualified_names` skips a bodiless
// function declaration deliberately -- a signature is not a thing to emit. So
// asking the disambiguating map about that node answered nothing, the fallback
// spelled the **bare** name, and for a name two modules share the bare name is
// the one name that by construction cannot exist: this program emits `pick@one`,
// `pick@two` and `pick@three` and nothing called `pick`.
//
// The refusal was `` it calls `pick`, which nothing in this program defines `` --
// a cascade blaming a name no refusal can be recorded against, because there is
// no such function to refuse. Seven of those stood in `runtime/node/fs` alone
// (`writeFile`, `readFile`, `opendir`, `lstat`, `rm`, `rmdir`, `statfs`), each an
// overloaded export of a name `fs` publishes from two modules, and they were
// `tooling/conformance/integrity.known`'s whole `plain / refused-as` class.
//
// The **other two halves of the same call site already asked the right
// question**: the arity through `parameter_representation` and the externality
// through `defines`, both of which go through `implementation_of` and say so in
// their own docs. The name was the half that did not, and it is the half that
// decided what got emitted.
//
// The controls are what say this is about ambiguity rather than about overloads
// or about `fs`: `throughThePlainOne` is the same shared name reached through a
// declaration that *has* a body, which was qualified correctly all along, and
// the two `stretch` arms are an overloaded function whose name is its own, which
// needs no qualification at all. All three compiled before this and must not
// move.

import { pick, stretch } from "./one.ts";
import { pick as pickPlain } from "./two.ts";
import { pick as pickAlsoOverloaded } from "./three.ts";
import { pick as pickReExported } from "./aliased.ts";

/// The subject: an overloaded callee, at a name three modules share.
export function throughAnOverload(n: number): number {
  return pick(n);
}

/// The subject at the other signature, so the arity half is exercised beside
/// the name: both derive from the implementation, and they must agree.
export function throughTheSecondSignature(n: number): number {
  return pick(n, 10);
}

/// Overloaded on the other side too, so neither declaration the checker can
/// resolve to has a body.
export function throughTwoOverloads(n: number): number {
  return pickAlsoOverloaded(n);
}

/// The same overload reached through a re-export, which is how `fs` publishes
/// every one of the seven.
export function throughAReExport(n: number): number {
  return pickReExported(n) + 1;
}

/// Control: the shared name, at the declaration that has a body. Qualified
/// before this change and after it.
export function throughThePlainOne(n: number): number {
  return pickPlain(n);
}

/// Control: overloaded, and nothing else declares `stretch`, so there is no
/// qualification to get wrong.
export function throughAnUnsharedOverload(n: number): number {
  return stretch(n);
}

/// Control: the same at its second signature.
export function throughAnUnsharedSecondSignature(n: number): number {
  return stretch(n, 3);
}
