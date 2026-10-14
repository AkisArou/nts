// **Agrees since 141c1ea81; a guard.** Until then:
// `typeof f()` evaluates f() and then names the result's type. nts answers
// from the static type and never calls f: its side effect is lost. The same
// fold compiles `typeof new Temporal.Duration().toLocaleString()` with no
// Temporal runtime at all, where node throws a ReferenceError -- 9 test262
// built-ins/Temporal/**/toLocaleString/return-string.js and Now/timeZoneId/
// return-value.js files are recorded passes that ran nothing. The control
// calls f in its own statement, then applies typeof to the result, and
// differs in that only.
let folded = "no";
let bound = "no";
function f(): string { folded = "yes"; return "x"; }
function g(): string { bound = "yes"; return "x"; }
const t1 = typeof f();
const r = g();
const t2 = typeof r;
observe("typeof a call", t1 + ", called: " + folded);
observe("typeof a binding", t2 + ", called: " + bound);
done();
