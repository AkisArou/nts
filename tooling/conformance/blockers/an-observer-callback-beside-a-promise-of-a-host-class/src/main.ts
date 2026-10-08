// expect: emit-c --rc -> emits-c x_observe(
//
// One pair per host tag counts *erasures*: an erase puts a handle into a value
// counted through the registered pair. An unerase does not -- the typed handle
// it makes is counted through its own class's pair -- and every closure's
// erased-call shim unerases its parameters. Counting those refused any program
// with an observer callback (whose parameter is a sequence adapter with its
// own pair) beside a promise of a DOM object: "a host handle counted by
// `x_records_retain`/`x_records_release` as a value" (the Chromium lane,
// 2026-10-08, MutationObserver and ResizeObserver beside
// CSSStyleSheet.replace).
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude.
// blockers/host-classes-of-two-pairs-erased still refuses two pairs *erased*.
import { observe, ready, recordsLength } from "x:hosts";

let seen = 0;

export function watch(): number {
  return observe((records) => {
    seen += recordsLength(records) as number;
  }) as number;
}

export async function node(): Promise<number> {
  const found = await ready();
  return found === null ? 0 : seen;
}
