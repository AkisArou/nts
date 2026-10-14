// A member C is told was given or not (`Given<T>`, c:types): given when its
// value is not `undefined` -- WebIDL's "present", decided at run time -- so
// `false` and `0` are given, and a member left out or `undefined` is not.
// Each line is checked against the same calls written in C
// (`reference/main.c`).
import { options_report } from "c:options";

// A value the checker cannot decide, so `given` is the run time's answer.
function maybe(flag: boolean, present: boolean): boolean | undefined {
  return present ? flag : undefined;
}

// An object the program holds, copied field by field: its optional members
// are erased, and each is given or not by what it holds now.
function held(label: string, options: { keepalive?: boolean; priority?: number }): void {
  options_report(label, options);
}

options_report("false", { keepalive: false });
options_report("empty", {});
options_report("undefined", { keepalive: undefined });
options_report("all", { keepalive: true, priority: 2.5, plain: 7 });
options_report("zero", { priority: 0 });
options_report("decided false", { keepalive: maybe(false, true) });
options_report("decided absent", { keepalive: maybe(true, false) });
held("held empty", {});
held("held false", { keepalive: false });
held("held zero", { priority: 0, keepalive: undefined });
