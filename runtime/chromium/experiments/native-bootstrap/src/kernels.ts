// Two binding kernels from native-typescript's Chromium matrix
// (benchmarks/chromium: create-element, detached-counter-tree), on the
// entered DOM ABI, for comparison with its numbers. The work per iteration
// is the same: create a detached div; or create a button and a text node,
// append, and change the text. Every handle the ABI returns is a lease, so
// each node is also released here -- native-typescript passed nodes the
// compiler proved frame-bounded as raw Blink pointers, with no registry.
import * as dom from "nts:chromium-dom";
import type { DomContext } from "nts:chromium-dom";

export function ntsKernelCreateElements(c: DomContext, iterations: number): number {
  const div = dom.nts_dom_intern(c, "div");
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    const element = dom.nts_dom_create_element(c, div);
    if (element !== 0) {
      checksum += 1;
      dom.nts_dom_release(c, element);
    }
  }
  return checksum;
}

export function ntsKernelCounterTrees(c: DomContext, iterations: number): number {
  const tag = dom.nts_dom_intern(c, "button");
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    const button = dom.nts_dom_create_element(c, tag);
    const label = dom.nts_dom_create_text(c, "Count: 0");
    if (button !== 0 && label !== 0 && dom.nts_dom_append_child(c, button, label) === 0 &&
      dom.nts_dom_set_text_value(c, label, "Count: 1") === 0) {
      checksum += 1;
    }
    if (label !== 0) dom.nts_dom_release(c, label);
    if (button !== 0) dom.nts_dom_release(c, button);
  }
  return checksum;
}
