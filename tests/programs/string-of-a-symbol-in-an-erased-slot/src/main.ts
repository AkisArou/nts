// `String(v)` where `v` is a `string | symbol`.
//
//     `Possible EventEmitter memory leak detected. ${count} ${String(type)} ...`
//
// node's `MaxListenersExceededWarning`, and an `EventName` is `string | symbol`.
// It is under `warnMaxListenersExceeded`, which is under `addListener`, which is
// under `EventEmitter#on` — the base of `net.Server`, `http.Server`, every
// stream, `process`, `readline` and `dgram`.
//
// # Two arms existed and the third did not
//
// `String(sym)` on a *typed* symbol already worked: it is
// `SymbolDescriptiveString`, and the one conversion the language allows only
// through `String` — `sym + ""` throws a TypeError by 13.15.3 — so no implicit
// coercion reaches it. `String(v)` on an *erased* value already worked too,
// through `nts_value_to_string`, which spells a value from its tag.
//
// What was missing was the intersection: a symbol arriving in an erased slot.
// `spells_itself` listed the tags that helper knows and symbol was not among
// them, correctly, because the helper aborted on that tag. Both halves had to
// move together.
//
// # A neighbouring disagreement that is not a defect
//
// `spells_itself` also lists `BigInt`, and `nts_value_to_string` has no bigint
// case — it would `abort()`. That reads exactly like the same bug and is
// unreachable: putting a bigint in an erased slot is refused earlier, as "a
// value of type BigInt where `unknown` is expected", so no bigint tag can arrive.
// Teaching the helper a case it cannot receive would be a feature probe below
// its first use, so it is deliberately absent. Checked by probing rather than
// assumed, which is why this paragraph exists rather than a third arm.
//
// # What this example found that was not the feature
//
// The rc lane runs every example under reference counting on **both** halves --
// the provider the compiler emits for and the allocator the runtime uses -- and
// it failed here at 165 objects never given back. Not in the new arm: in
// `plainSymbol`, the *typed* arm that already worked.
//
// `nts_symbol_to_string` allocates four strings and returns one. Both
// `nts_string_from_utf8` and `nts_concat` are `NTS_ALLOCATES` and borrow their
// arguments, so `open`, `close` and the intermediate `head` were all owned by
// that helper and none was released. Three per call.
//
// **Nothing had ever run it.** The rc lane covers every example and no example
// called `String()` on a symbol, so a helper that had existed for a while and
// worked correctly leaked in a lane that measures leaks, unobserved. Adding an
// example for a feature ran a *different* feature for the first time.
//
// The tell was that `--rc` passed and `NTS_RC=1` did not. They are not the same
// thing: the flag sets the compiler's provider and the environment variable
// sets that *and* the runtime's allocator, so `--rc` alone compares a program
// that releases against an allocator that frees nothing and measures nothing.
// `tooling/gate/rc.sh` says so in its header, and reading that is what turned a
// disagreement between two runs into a finding.
//
// # Controls
//
// `plainSymbol` and `plainString` are the two arms that already worked, so a
// regression in either is told apart from one in the union. `viaTemplate` is the
// shape node actually writes — inside a template literal — which reaches the
// conversion by a different path than a bare `String()` call.

const tag: symbol = Symbol("tag");
const other: symbol = Symbol("other");

/** Under test: the union, which is what an `EventName` is. */
export function union(n: number): number {
  const v: string | symbol = n > 0 ? "abc" : tag;
  return String(v).length;
}

/** Under test: the same conversion inside a template, as node writes it. */
export function viaTemplate(n: number): number {
  const v: string | symbol = n > 0 ? "ab" : other;
  return `x ${String(v)} y`.length;
}

/** Control: a typed symbol, which had its own arm already. */
export function plainSymbol(n: number): number {
  return String(tag).length + n * 0;
}

/** Control: a string through the same erased path. */
export function plainString(n: number): number {
  const v: string = n > 0 ? "abc" : "de";
  return String(v).length;
}

/** Control: the description survives, rather than only the length. */
export function description(n: number): number {
  const v: string | symbol = n > 0 ? "z" : tag;
  const spelled = String(v);
  return spelled === "Symbol(tag)" ? 1 : spelled === "z" ? 2 : 3 + n * 0;
}
