// expect: emit-c --rc -> emits-c nts_dom_HTMLElement_get_onclick(
//
// A bound property read that TypeScript has narrowed to `null` -- after
// `target.onclick = null`, `target.onclick` is typed `null` -- is refused,
// though the getter answers `Closure | null` like any other read of it.
// Behind lib-dom-event-handler-read-back, now fixed. Found 2026-10-08 by
// the Chromium lane.
//
// Control (emit-c --rc), one difference -- the write is to another
// element, so the read is not narrowed: nothing refused.
//
// **A guard since 2026-10-08** (MainClaude): a read the checker narrowed to `null` is typed as the getter declares its result (`call_bound_method`).
export function clearedReadsNull(): boolean {
  const target = document.createElement("div");
  const other = document.createElement("div");
  target.onclick = null;
  return target.onclick === null;
}
