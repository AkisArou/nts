// expect: emit-c --rc -> emits-c static void go__resume(NtsObj_go_frame * v0) {
//
// An async export awaiting a promise an nts:dom member answers
// (`document().exitFullscreen()`, request 12) compiles, and the C defines its
// resume function -- but the prepared HIR calls `go__resume` and defines it
// nowhere: integrity's call-resolves reports "`go__resume` is called and
// defined 0 time(s)" (the integrity.known entry beside this fixture). The same
// shape through lib.dom (`await document.exitFullscreen()`) reports the same.
// Found 2026-10-08 by the Chromium lane, asked for as its own fixture by
// MainClaude. The expectation above is the emitted C, which is right; the
// defect is what the HIR says, which the integrity entry records.
//
// Control, one difference -- the promise from a `c:` foreign function
// instead (`import { ready } from "c:later"`, `await ready()`, the
// native-promise example's declaration): integrity clean.

import { document } from "nts:dom";
export async function go(): Promise<void> {
  await document().exitFullscreen();
}
