// Two binding kernels from native-typescript's Chromium matrix
// (benchmarks/chromium: create-element, detached-counter-tree), on the
// entered DOM ABI, for comparison with its numbers. The work per iteration
// is the same: create a detached div; or create a button and a text node,
// append, and change the text. No node here leaves the frame, so none is
// rooted: each is Blink's own pointer, found by Oilpan on the native stack,
// as ScriptC passed nodes its compiler proved frame-bounded.
import * as dom from "nts:chromium-dom";
import type { DomContext } from "nts:chromium-dom";

export function ntsKernelCreateElements(c: DomContext, iterations: number): number {
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    if (dom.nts_dom_create_element(c, "div") !== null) checksum += 1;
  }
  return checksum;
}

export function ntsKernelCounterTrees(c: DomContext, iterations: number): number {
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    const button = dom.nts_dom_create_element(c, "button");
    const label = dom.nts_dom_create_text(c, "Count: 0");
    if (button !== null && label !== null && dom.nts_dom_append_child(c, button, label) === 0 &&
      dom.nts_dom_set_text_content(c, label, "Count: 1") === 0) {
      checksum += 1;
    }
  }
  return checksum;
}
