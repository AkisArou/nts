// The DOM ABI's own witness, and the binding benchmark's loop. Every
// operation calls Blink immediately; this is not a DOM effect tape or a
// declaration pretending to implement lib.dom.
import * as host from "nts:chromium-dom-experiment";
import { asHTMLElement, cancelAnimationFrame, document, requestAnimationFrame } from "nts:dom";
import type { Document, Element, Event, Node } from "nts:dom";
import { idlTranscript } from "./idl-vectors.ts";
import type { VectorHost } from "./idl-vectors.ts";
import type { c_uint32 } from "c:types";

function element(d: Document, tag: string, id: string): Element {
  const node = d.createElement(tag);
  node.id = id;
  return node;
}

// What a call threw, as the program catches it: the DOMException's name and
// Blink's message, or "" when it did not throw.
function thrown(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

// The DOM ABI end to end in one callback, numbered so a failure names its
// step: node identity is the address, a DOM exception is thrown with Blink's
// own name and message, text crosses exactly both ways, a node only the
// native stack refers to survives a collection, and a compiled closure
// listens. Every member is the one generated from Blink's IDL.
export function ntsChromiumDomProgram(): number {
  const d = document();
  const body = d.querySelector("body");
  if (body === null) return 1;
  const container = element(d, "section", "native-dom");
  const label = element(d, "output", "native-dom-count");
  label.appendChild(d.createTextNode("Count: 0"));
  container.appendChild(label);
  body.appendChild(container);
  if (d.querySelector("#native-dom-count") !== label) return 2;
  if (d.querySelector("#missing") !== null) return 3;
  if (!thrown(() => d.querySelector("[")).startsWith("SyntaxError: ")) return 4;
  if (!thrown(() => container.appendChild(container)).startsWith("HierarchyRequestError: ")) return 5;
  if (!thrown(() => body.removeChild(label)).startsWith("NotFoundError: ")) return 6;
  if (!thrown(() => d.createElement("bad name")).startsWith("InvalidCharacterError: ")) return 7;

  // A string view must carry NUL, paired and lone surrogates, Latin-1 and
  // non-Latin-1 units into Blink, and the view Blink lends back must return
  // them, as text and as an attribute. A [Reflect]ed attribute reads through
  // Blink's own accessor.
  const exact = "A\0\u00e9\u03a9" + String.fromCharCode(0xd800) + "Z"
    + String.fromCharCode(0xdc00) + String.fromCharCode(0xd83d) + String.fromCharCode(0xde00);
  label.textContent = exact;
  if (label.textContent !== exact) return 8;
  label.setAttribute("data-exact", exact);
  if (label.getAttribute("data-exact") !== exact) return 9;
  label.className = "counter";
  if (label.className !== "counter" || label.getAttribute("class") !== "counter") return 9;

  // Detached, the label is referenced by nothing but this frame: no root, no
  // parent. A collection now is a conservative one, as an allocation would
  // trigger, and must find it on the stack.
  label.remove();
  if (d.querySelector("#native-dom-count") !== null) return 10;
  host.nts_dom_collect_for_testing();
  if (label.textContent !== exact) return 11;
  container.appendChild(label);
  if (d.querySelector("#native-dom-count") !== label) return 12;

  // Events: a compiled closure on a button, fired synchronously by click(),
  // then removed, after which a click changes nothing. The closure captures
  // the button and the label, which are rooted while the listener holds it
  // and unrooted when removing it gives the closure back.
  const button = asHTMLElement(d.createElement("button"));
  if (button === null) return 13;
  const clicks = { count: 0 };
  const listener = button.listen("click", (event: Event): void => {
    if (event.target === button && event.type === "click") clicks.count += 1;
    label.textContent = "Clicked " + clicks.count;
  });
  button.click();
  button.click();
  if (clicks.count !== 2 || label.textContent !== "Clicked 2") return 14;
  listener.remove();
  listener.remove();
  button.click();
  if (clicks.count !== 2) return 16;
  label.textContent = "Count: 0";

  // The differential vectors (idl-vectors.ts), whose transcript the oracle
  // page computes through V8's bindings: the DOM the smoke compares holds it.
  const narrowing: VectorHost = {
    failure: (error: unknown): string => (error as Error).message,
  };
  const vectors = d.createElement("section");
  container.appendChild(vectors);
  const transcript = idlTranscript(d, vectors, narrowing);
  const pre = element(d, "pre", "native-idl");
  pre.textContent = transcript;
  container.appendChild(pre);

  // A frame callback runs before the next frame, with its time; a cancelled
  // one never runs. The smoke reads both after its frames have passed. The
  // first finds the label when it runs rather than capturing it, so nothing
  // is rooted when this callback returns (the observer logs roots=0).
  requestAnimationFrame((time: number): void => {
    const later = document().querySelector("#native-dom-count");
    if (later !== null) later.setAttribute("data-frame", time > 0 ? "ran" : "no time");
  });
  cancelAnimationFrame(requestAnimationFrame((): void => {
    label.setAttribute("data-cancelled", "ran");
  }));
  return 0;
}

export function ntsChromiumDomCounter(count: number): void {
  const label = document().querySelector("#native-dom-count");
  if (label !== null) label.textContent = "Count: " + count;
}

export interface ChromiumBenchmarkState {
  aUnits: Uint16Array;
  bUnits: Uint16Array;
  aBytes: Uint8Array;
  bBytes: Uint8Array;
  prefix: string;
  aAtom: c_uint32;
  bAtom: c_uint32;
}
// Prepared buffers: the controls a view is measured against. Built once,
// outside the timed loop, so they show the cost of the call and Blink's copy
// with no string handling at all.
function utf16(text: string): Uint16Array {
  const result = new Uint16Array(text.length);
  for (let i = 0; i < text.length; ++i) result[i] = text.charCodeAt(i);
  return result;
}
// Latin-1 storage for a one-byte payload; only Latin-1 rows use it.
function latin1(text: string): Uint8Array {
  const result = new Uint8Array(text.length);
  for (let i = 0; i < text.length; ++i) result[i] = text.charCodeAt(i) & 0xff;
  return result;
}
export function ntsChromiumPrepareBenchmark(a: string, b: string): ChromiumBenchmarkState {
  return {aUnits: utf16(a), bUnits: utf16(b), aBytes: latin1(a), bBytes: latin1(b),
    prefix: a.substring(0, a.length - 1), aAtom: host.nts_dom_intern(a), bAtom: host.nts_dom_intern(b)};
}
// Modes match binding_benchmark.cc: 0-1 prepared buffers (UTF-16, Latin-1),
// 2 the string itself as a view (`textContent`, as page script writes it), 3
// a fresh string per mutation, as UI code builds one, and 4 text interned for
// an id. The controls return a status; `textContent` would throw.
export function ntsChromiumBenchmarkLoop(node: Node,
  state: ChromiumBenchmarkState, a: string, b: string, iterations: number, mode: number): number {
  const length = a.length as c_uint32;
  let failed = 0;
  if (mode === 0) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text16(node, i % 2 === 0 ? state.aUnits : state.bUnits, length);
    }
  } else if (mode === 1) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text8(node, i % 2 === 0 ? state.aBytes : state.bBytes, length);
    }
  } else if (mode === 2) {
    for (let i = 0; i < iterations; ++i) node.textContent = i % 2 === 0 ? a : b;
  } else if (mode === 4) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text_interned(node, i % 2 === 0 ? state.aAtom : state.bAtom);
    }
  } else {
    for (let i = 0; i < iterations; ++i) {
      node.textContent = state.prefix + (i % 2 === 0 ? "A" : "B");
    }
  }
  return failed;
}
