// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "first"
//
// FIXED, and kept as a guard for the *partial* behaviour rather than for a
// refusal. A module-scope initializer that calls a function containing a refusal
// used to take the entire module initializer with it: no `module__init` at all,
// `data` never assigned, and both exports dropped -- including `first`, which
// touches neither the refusal nor anything downstream of it.
//
// Now the excision cuts only what depends on the refused call. `first` is
// published, `second` is not, and the diagnostics say which is which by name:
//
//     NTS1003 the initializer of `flag` was not compiled because it calls
//             `bad`, which was refused above; the rest of the module's
//             evaluation still runs
//     NTS1003 `second` cannot be compiled because it reads `flag`, whose
//             initializer was not compiled -- see the refusal above
//
// **The guard is on `first`, and that is the whole point.** A fixture asserting
// that `second` is dropped would pass again the day the excision goes back to
// dropping everything, which is the regression worth catching. So this asserts
// the export that must *survive*.
//
// **What this guard cannot see, stated because it caught me out immediately.**
// It asserts that the name reaches the addon's export table. It does not assert
// that the addon *loads*. At the time of writing it does not: the excision can
// empty the initializer entirely, so `program.c` defines no `module__init` while
// `addon.c` still calls it, and the artifact dies at `dlopen` with
//
//     undefined symbol: module__init
//
// which is exactly what `os` does — 17 of 23 names published and every test
// failing at load. **Publishing is not loading**, and an export-table assertion
// cannot tell the difference. I reported "15 of 15 as expected" from this file
// twenty minutes after writing it to avoid that class of mistake. The mismatch
// is between two emitted files and the checker has no expectation form that can
// say it; `check.sh <module>` catches it immediately, which is where it was
// found.
//
// The control is the same file with `bad` returning `true` instead of testing a
// regular expression. It emits `module__init` and publishes both exports. So it
// is not the call, the module-scope const, or the binding: it is that the called
// function could not be lowered.
//
// This contradicts what the ledger recorded, and the distinction is fine enough
// that the first three attempts to reproduce it failed. A refused *literal* at
// module scope really is skipped alone -- `const pattern = /a+/` next to
// `const data = info()` costs only the export that reads `pattern`, and that
// holds whether the refusal is written above or below, and whether it is in this
// module or an imported one. All of that was measured before this was found. A
// refused *call* is the case that behaves differently.
//
// What it costs, measured on `os`: ten exports. `os` ends
// `export const constants: OsConstants = readConstants()`, and `readConstants`
// refuses on a property access. So `osInformation` is never assigned, and with
// it `type`, `release`, `version`, `machine`, `arch`, `platform`, `endianness`,
// `EOL`, `devNull` and `constants` are never compiled -- every one of them
// reading a module-scope const that no longer has a value. `emit-c` reports them
// as "no function of that name was compiled", which reads like an export-table
// problem and is not one. `os` publishes 8 of 23; ten of the missing fifteen are
// this single statement.
//
// Fourteen of the twenty-four built modules emit no `module__init`, `os`,
// `querystring`, `url` and `util` among them, and those four are modules that
// compile and publish nothing. This is worth checking against each of them.
declare function info(): [string, string];
const data = info();

function bad(): boolean {
  return /a+/.test("aaa");
}
const flag = bad();

export function first(): string {
  return data[0];
}

export function second(): boolean {
  return flag;
}
