// `t.a` where `t` is a `Record<string, T>`.
//
//     const env: Readonly<Record<string, string | undefined>>
//     env.NODE_USE_ENV_PROXY === "1"
//
// The bracketed form `t["a"]` lowered and the dotted form did not, refusing with
// "a property of a value with no fields" — a sentence about a type that has no
// fields *because that is what an index signature is*. They are one operation
// in JavaScript: a property access with a literal key.
//
// # What one dotted read cost
//
// That line is `http`'s `useEnvironmentProxy`, and `globalAgent`'s initializer
// is a ternary on the call:
//
//     export let globalAgent = createGlobalAgent(
//       useEnvironmentProxy() ? processEnvironment : undefined);
//
// So a doomed value reaches a **branch**, `excise_from_initializer` cannot cut a
// statement whose shape depends on a refusal, and `module#init` is dropped
// whole. Every deferred global in the program is then unwritten and every
// function that reads one is refused with it.
//
//     http   1196 function(s) -> 1522     2783 refused -> 2497
//            module#init absent -> present
//            2 names published -> 5
//
// One property access, and the module's entire evaluation.
//
// # Three defects underneath, each masked by the one above it
//
// Making `module#init` run made `http` compile code nothing had compiled, and
// each layer had something wrong that the layer above had been hiding.
//
// **`nts_string_eq` dereferenced a null.** A nullable string slot holds `NULL`
// for `undefined`, so `table["missing"] === "1"` arrived as `(NULL, "1")` and
// segfaulted — in `module.init`, so the addon failed to load at all. The
// `a == b` check above it already answers `true` for two absences, which is
// what `undefined === undefined` is, so only the mixed case was left and it is
// `false` by the language.
//
// **A value export that could not cross killed the module.** An erased export
// whose value is an object refuses at `nts_to_napi_value`, which is right for a
// function's *return* and fatal at registration: `require` threw and nothing
// loaded. Omitting the name is what the boundary already does for a function it
// cannot wrap. Both emitters needed it — top-level exports and namespace
// members — and guarding one is guarding half.
//
// **A quoted property name was silently dropped.** `initialize_fields` read the
// name node's `text`, which a string or numeric literal does not carry, and
// `continue`d. `{ "a b": 1, "x+y": 2, ordinary: 3 }` wrote only `ordinary`.
// That had been masked by the C emitter refusing any layout holding a name it
// could not spell — and *that* refusal emitted invalid C anyway, skipping the
// struct while leaving its descriptor and reference tables pointing into it.
// `c_member_escaped` spells them instead: `_x` plus the byte in hex, injective,
// and an ordinary name unchanged.
//
// # Controls
//
// `bracketed` is the spelling that always worked, so this fixture distinguishes
// the *access form* from the table representation. `missing` reads a key that is
// not there, which is the case that segfaulted. `bothAbsent` compares two
// absences, which must be equal. `present` is the ordinary read.

const table: Record<string, string | undefined> = { a: "one", b: "two" };

/** Under test: the dotted read. */
export function dotted(n: number): number {
  const v = table.a;
  return v === undefined ? 0 : v.length + n * 0;
}

/** Under test: a dotted read of a key that is not there. */
export function missing(n: number): number {
  const v = table.zz;
  return v === undefined ? 7 : v.length + n * 0;
}

/** Under test: the comparison that dereferenced a null. */
export function missingCompared(n: number): number {
  return table.zz === "1" ? 1 : 2 + n * 0;
}

/** Control: two absences are equal. */
export function bothAbsent(n: number): number {
  return table.zz === table.yy ? 1 : 2 + n * 0;
}

/** Control: the bracketed spelling, which always lowered. */
export function bracketed(n: number): number {
  const v = table["a"];
  return v === undefined ? 0 : v.length + n * 0;
}

/** Control: a variable key, the third spelling. */
export function byVariable(n: number): number {
  const v = table[n > 0 ? "a" : "b"];
  return v === undefined ? 0 : v.length;
}
