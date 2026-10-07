// Three binding kernels from native-typescript's Chromium matrix
// (benchmarks/chromium: create-element, detached-counter-tree,
// synchronous-event-round-trip), written as page script writes them, for
// comparison with its numbers. The work per iteration is the same: create a
// detached div; create a button and a text node, append, and change the
// text; click the body, dispatching to a compiled closure. No node here
// leaves the frame, so none is rooted: each is Blink's own pointer, found by
// Oilpan on the native stack.
import { asHTMLCanvasElement, document } from "nts:dom";

export function ntsKernelCreateElements(iterations: number): number {
  const d = document();
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    d.createElement("div");
    checksum += 1;
  }
  return checksum;
}

// native-typescript's synchronous-event-round-trip: listen on the body, click
// it `iterations` times, each dispatching to a compiled closure, and remove
// the listener.
export function ntsKernelEventRoundTrips(iterations: number): number {
  const body = document().body;
  if (body === null) return 0;
  const state = { checksum: 0 };
  const listener = body.listen("click", (): void => {
    state.checksum += 1;
  });
  for (let i = 0; i < iterations; i += 1) body.click();
  listener.remove();
  return state.checksum;
}

// A canvas kernel: fill a 2x2 rectangle on the page's 256x256 canvas, the
// call a drawing loop makes most. Blink records it (no pixels until a frame);
// what is measured is the call into the 2D context, which page script makes
// through V8's fast API path ([NoAllocDirectCall]).
export function ntsKernelCanvasRects(iterations: number): number {
  const canvas = asHTMLCanvasElement(document().getElementById("kernel-canvas")!);
  if (canvas === null) return 0;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return 0;
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    ctx.fillRect(i & 255, (i >> 8) & 255, 2, 2);
    checksum += 1;
  }
  return checksum;
}

export function ntsKernelCounterTrees(iterations: number): number {
  const d = document();
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    const button = d.createElement("button");
    const label = d.createTextNode("Count: 0");
    button.appendChild(label);
    label.data = "Count: 1";
    checksum += 1;
  }
  return checksum;
}
