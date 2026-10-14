// expect: emit-c --rc -> emits-c nts_value_handle(
//
// A promise of a host's object (`HostClass`: Blink's wrappables) holds it as a
// value tagged `NTS_TAG_HANDLE_HOST`, so the promise keeps it alive through
// the host's pair until it dies -- whoever settles it. The host fulfils with
// `nts_promise_fulfill_value(p, nts_value_of_handle(obj,
// NTS_TAG_HANDLE_HOST))`; the program does the same (`hand`), and an `await`
// reads it back by unerasing (`nts_value_handle`). It was read through
// `nts_promise_pointer`, borrowed: nothing held Blink's object between the
// host's fulfilment and the read a microtask later. And a program settling
// one was refused: "a promise settling with a counted handle of a family with
// no box".
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude, for
// the Chromium lane (Animation.finished, CSSStyleSheet.replace).
import { ready, id } from "x:host";
import type { Widget } from "x:host";

export async function go(): Promise<number> {
  const widget = await ready();
  return id(widget) as number;
}

export async function hand(widget: Widget): Promise<Widget> {
  return widget;
}
