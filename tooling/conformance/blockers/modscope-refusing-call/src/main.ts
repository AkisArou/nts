// expect: emit-c --napi -> no wrapper for first: is exported and no function of
//         that name was compiled
//
// A module-scope initializer that *calls a function containing a refusal* takes
// the entire module initializer with it. No `module__init` is emitted at all,
// `data` is never assigned, and both exports are dropped -- including `first`,
// which does not touch the refusal or anything downstream of it.
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
