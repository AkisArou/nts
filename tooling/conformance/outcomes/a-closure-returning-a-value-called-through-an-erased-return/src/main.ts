// **FIXED by `519195e49` and kept as a guard.** This pinned the *return* face
// of the closure-slot type pun: a closure returning a value, reached through a
// slot that reads an `NtsValue`, answering `not a number` / `not a string` /
// `not true` / `not a record` while its own control arm answered 42. A closure
// now carries an erased entry whose result is erased for it, so every row
// matches node. The category is `agrees`: what it guards is that the entry
// keeps doing the conversion, and the four kinds are there because the pun was
// silent in all four.
//
// **Ours, not upstream's: the return face of a closure called through a
// signature that is not its own.** A closure kept as `unknown` is called
// through a function type whose return is `unknown`: the call site reads the
// result as an erased value, while the closure's `#call` returns its own
// representation -- a raw double, a string pointer, a bool, a record
// pointer. No refusal, no crash: a wrong answer per width.
// `two-components-called-on-their-props-through-unknown` is the *parameter*
// face (it returns `string` on both sides and passes erased props where a
// record is read); this is the other half. React's gtk-state is the same face
// as a record pointer in its driver.
//
// **Expected, confirmed under node:**
//
//     number, through unknown    42
//     string, through unknown    s4
//     boolean, through unknown   true
//     record, through unknown    7
//     number, as number (control) 42
//
// The control keeps the closure's own return type at the call, and only it
// is expected to agree today.
function run(): void {
  const table = new Map<string, unknown>();
  table.set("number", (n: number) => n + 1);
  table.set("string", (n: number) => "s" + n);
  table.set("boolean", (n: number) => n > 2);
  table.set("record", (n: number) => ({ v: n + 3 }));

  const num = (table.get("number") as (n: number) => unknown)(41);
  observe("number, through unknown", typeof num === "number" ? String(num) : "not a number");
  const str = (table.get("string") as (n: number) => unknown)(4);
  observe("string, through unknown", typeof str === "string" ? str : "not a string");
  const bool = (table.get("boolean") as (n: number) => unknown)(4);
  observe("boolean, through unknown", bool === true ? "true" : "not true");
  const rec = (table.get("record") as (n: number) => unknown)(4);
  observe("record, through unknown", typeof rec === "object" && rec !== null && "v" in rec ? String((rec as { v: number }).v) : "not a record");
  observe("number, as number (control)", String((table.get("number") as (n: number) => number)(41)));
}
run();
done();
