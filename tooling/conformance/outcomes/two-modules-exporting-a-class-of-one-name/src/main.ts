// **Now a guard.** 8482afb63 fixed it, and this record was taken from a clean
// build of that commit, where it agrees with node (3). The cause: three places
// build the name a class member is emitted under. `naming()` disambiguates
// classes (its comment names `dgram` and `net` both exporting `Socket`), but
// `hierarchy.name`, which spells an instance method's definition, read the
// identifier. So the method table asked for `Thing#value`, found neither
// `Thing@a#value` nor `Thing@b#value`, and silently emitted no table at all.
// The history is kept beneath.
//
// **Two modules that each export a class named `Thing` crash the program, and
// nothing refuses.** nts emits one `struct NtsObj_Thing` and two descriptors
// whose method tables are 0, so the virtual call below goes through a null
// pointer: SIGSEGV, exit 139. node answers 3.
//
// Found by the React lane (2026-09-27, `~/.cache/nts-react/probes/same-name-class`).
// Any two modules with a same-named exported class can hit it, and nothing says
// so at compile time. That is why this is the most serious open item of its week.
//
// The control, measured on 81ca51a21 with this record, differs in one thing: b.ts's
// class is named `Other`. That program agrees with node (3). So the name
// collision is the cause, not the cross-module base, the abstract method, or
// the virtual call.
//
// One fixture on its own, because an abort erases every arm beside it (see
// `outcomes-check.mjs`). The compiler fix is the compiler lane's; when it
// lands, this reads FIXED and gets re-recorded as a guard.
import { type Base, Thing as ThingA } from "./a.ts";
import { Thing as ThingB } from "./b.ts";

function total(things: Base[]): number {
  let sum = 0;
  for (const thing of things) {
    sum += thing.value();
  }
  return sum;
}

observe("virtual calls through the shared base", String(total([new ThingA(), new ThingB()])));
done();
