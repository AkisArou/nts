// Every enum here is declared in `kinds.ts` and read from this file, which is
// the one thing the four existing enum examples do not do: `examples/enums`,
// `examples/string-enum`, `examples/an-enums-reverse-mapping` and
// `examples/enum-reverse-map-unsupported` are each a single file, so all of
// them fold an enum whose declaration is in the same module.
//
// Across the edge an import names an *alias* at the use site, and an alias
// carries no `ENUM` flag, so the fold was skipped and the access fell through
// to `describe_name` -- which resolves the alias, sees a genuine enum, and
// reported ``Align`` as an object rather than a member, which is the reverse
// mapping`. Every export below refused on the binary before that fix, and the
// sentence was wrong twice: these are member reads, and the reverse mapping
// was the half that already worked.

import { Align, Weight, Label } from "./kinds.ts";
import { Align as Hopped } from "./hop.ts";

// The implicit numbering, across the edge. `Align.Center` follows `End = 5`,
// so it is 6 -- a running total rather than a position, which `withAGap`
// below would catch if it were read as one.
export function forwardMember(): number {
  return Align.Center;
}

export function implicitZero(): number {
  return Align.Fill;
}

// A `const enum` has no object at run time at all, so this one cannot be
// answered by a property load even in principle: it folds or it refuses.
export function constEnumMember(): number {
  return Weight.Bold;
}

// A string member is a *managed* constant -- the interned static a string
// literal gets, rather than an immediate.
export function stringMember(): string {
  return Label.Long;
}

// The reverse mapping, across the edge. `enum_reverse_member` reads
// `record.declarations` to recover the member values, so an unresolved alias
// would find one import specifier, no `ENUM_MEMBER` child, and refuse with
// `at a value no member has` for a value a member has.
export function reverseAtConstant(): string {
  return Align[6];
}

// The same, at the member that carries the explicit initializer. This is the
// arm that fails if the numbering is read as a position instead of a total.
export function withAGap(): string {
  return Align[5];
}

// Two alias hops: `hop.ts` re-exports what `kinds.ts` declares, so the chain
// `denoted_symbol` walks is longer than one and its loop bound is exercised.
export function throughTwoHops(): number {
  return Hopped.End;
}

// Not folded away: the parameter is the value, and the enum member is a
// constant it is compared against. An arm whose answer does not depend on its
// input would test nothing, so this one takes the input.
export function isCentered(n: number): boolean {
  return n === Align.Center;
}

// The enum as a *type* across the edge, which lowered before the fix too --
// the control that says the change did not disturb what already worked.
export function widen(a: Align): number {
  return a + 1;
}
