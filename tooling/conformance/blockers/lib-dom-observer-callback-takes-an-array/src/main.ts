// expect: NTS1001 a callback taking an array where its binding passes a `NtsDomMutationRecordSequence`, which the bridge does not make one of
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): lib.dom's
// `MutationObserver` calls its callback with `MutationRecord[]`; nts:dom's
// `newMutationObserver` calls it with a `MutationRecordSequence` (`length`,
// `item`). WebIDL makes a new array of the sequence for page script's
// callback, and the bridge into the program's closure would have to make
// that array too (beside `nts_array_from_handles`, which makes one of C's
// array of handles). Until it does, the program is refused here.
//
// **What it was, found 2026-10-07 by MainClaude**: the moment `new` of a
// bound interface lowered (0ca629392), this compiled, and the bridge passed
// the sequence as the array -- `Closure0__call(..., (NtsArray *)a0)` -- a
// handle read as an array's header. `bridges::check` compared a handle only
// with a handle; it refuses a handle passed where a closure takes a managed
// value now.
//
// Control, one difference: the same program against the generated nts:dom
// module, whose callback takes the sequence (emit-c --rc, clean):
//
//     import { document, newMutationObserver, type MutationRecordSequence } from "nts:dom";
//     export function go(): number {
//       const state = { n: 0 };
//       const observer = newMutationObserver((records: MutationRecordSequence) => { state.n += records.length; });
//       const body = document().body;
//       if (body !== null) observer.observe(body, { childList: true });
//       observer.disconnect();
//       return state.n;
//     }

export function go(): number {
  const state = { n: 0 };
  const observer = new MutationObserver((records: MutationRecord[]) => { state.n += records.length; });
  observer.observe(document.body, { childList: true });
  observer.disconnect();
  return state.n;
}
