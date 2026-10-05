// The DOM ABI's own witness, and the binding benchmark's loop. Every
// operation calls Blink immediately; this is not a DOM effect tape or a
// declaration pretending to implement lib.dom.
import * as host from "nts:chromium-dom-experiment";
import * as dom from "nts:chromium-dom";
import type { DomContext, Element, Node } from "nts:chromium-dom";
import type { c_uint32 } from "c:types";

function element(c: DomContext, tag: string, id: string): Element | null {
  const node = dom.nts_dom_create_element(c, tag);
  if (node !== null) dom.nts_dom_set_attribute(c, node, "id", id);
  return node;
}

// The DOM ABI end to end in one callback, numbered so a failure names its
// step: node identity is the address, every DOM exception arrives as its code,
// text crosses exactly both ways, and a node only the native stack refers to
// survives a collection.
export function ntsChromiumDomProgram(c: DomContext): number {
  const document = dom.nts_dom_document(c);
  if (document === null) return 1;
  const body = dom.nts_dom_query(c, document, "body");
  const container = element(c, "section", "native-dom");
  const label = element(c, "output", "native-dom-count");
  const text = dom.nts_dom_create_text(c, "Count: 0");
  if (body === null || container === null || label === null || text === null) return 1;
  dom.nts_dom_append_child(c, label, text);
  dom.nts_dom_append_child(c, container, label);
  dom.nts_dom_append_child(c, body, container);
  if (dom.nts_dom_query(c, document, "#native-dom-count") !== label) return 2;
  if (dom.nts_dom_query(c, document, "#missing") !== null || dom.nts_dom_last_error(c) !== 0) return 3;
  if (dom.nts_dom_query(c, document, "[") !== null || dom.nts_dom_last_error(c) !== 12) return 4; // SyntaxError
  if (dom.nts_dom_append_child(c, container, container) !== 3) return 5; // HierarchyRequestError
  if (dom.nts_dom_remove_child(c, body, label) !== 8) return 6; // NotFoundError
  if (dom.nts_dom_create_element(c, "bad name") !== null || dom.nts_dom_last_error(c) !== 5) return 7; // InvalidCharacterError

  // A string view must carry NUL, paired and lone surrogates, Latin-1 and
  // non-Latin-1 units into Blink, and the view Blink lends back must return
  // them, as text and as an attribute.
  const exact = "A\0éΩ" + String.fromCharCode(0xd800) + "Z"
    + String.fromCharCode(0xdc00) + String.fromCharCode(0xd83d) + String.fromCharCode(0xde00);
  dom.nts_dom_set_text_content(c, label, exact);
  if (dom.nts_dom_text_content(c, label) !== exact) return 8;
  dom.nts_dom_set_attribute(c, label, "data-exact", exact);
  if (dom.nts_dom_get_attribute(c, label, "data-exact") !== exact) return 9;

  // Detached, the label is referenced by nothing but this frame: no root, no
  // parent. A collection now is a conservative one, as an allocation would
  // trigger, and must find it on the stack.
  dom.nts_dom_remove(c, label);
  if (dom.nts_dom_query(c, document, "#native-dom-count") !== null) return 10;
  host.nts_dom_collect_for_testing(c);
  if (dom.nts_dom_text_content(c, label) !== exact) return 11;
  dom.nts_dom_append_child(c, container, label);
  if (dom.nts_dom_query(c, document, "#native-dom-count") !== label) return 12;

  // Events: a compiled closure on a button, fired synchronously by click(),
  // then removed, after which a click changes nothing. The closure captures
  // the button and the label, which are rooted while the listener holds it
  // and unrooted when removing it gives the closure back.
  const button = dom.nts_dom_create_element(c, "button");
  if (button === null) return 13;
  const clicks = { count: 0 };
  const listener = dom.nts_dom_listen(c, button, "click", (target: Node): void => {
    if (target === button) clicks.count += 1;
    dom.nts_dom_set_text_content(c, label, "Clicked " + clicks.count);
  });
  if (listener === null) return 13;
  dom.nts_dom_click(c, button);
  dom.nts_dom_click(c, button);
  if (clicks.count !== 2 || dom.nts_dom_text_content(c, label) !== "Clicked 2") return 14;
  if (dom.nts_dom_unlisten(c, listener) !== 0) return 15;
  dom.nts_dom_click(c, button);
  if (clicks.count !== 2) return 16;
  dom.nts_dom_set_text_content(c, label, "Count: 0");
  return 0;
}

export function ntsChromiumDomCounter(c: DomContext, count: number): void {
  const document = dom.nts_dom_document(c);
  const label = document === null ? null : dom.nts_dom_query(c, document, "#native-dom-count");
  if (label !== null) dom.nts_dom_set_text_content(c, label, "Count: " + count);
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
export function ntsChromiumPrepareBenchmark(context: DomContext, a: string, b: string): ChromiumBenchmarkState {
  return {aUnits: utf16(a), bUnits: utf16(b), aBytes: latin1(a), bBytes: latin1(b),
    prefix: a.substring(0, a.length - 1), aAtom: dom.nts_dom_intern(context, a), bAtom: dom.nts_dom_intern(context, b)};
}
// Modes match binding_benchmark.cc, all entered calls returning their own
// status: 0-1 prepared buffers (UTF-16, Latin-1), 2 the string itself as a
// view, 3 a fresh string per mutation, as UI code builds one, and 4 text
// interned for an id.
export function ntsChromiumBenchmarkLoop(context: DomContext, node: Node,
  state: ChromiumBenchmarkState, a: string, b: string, iterations: number, mode: number): number {
  const length = a.length as c_uint32;
  let failed = 0;
  if (mode === 0) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text16(context, node, i % 2 === 0 ? state.aUnits : state.bUnits, length);
    }
  } else if (mode === 1) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text8(context, node, i % 2 === 0 ? state.aBytes : state.bBytes, length);
    }
  } else if (mode === 2) {
    for (let i = 0; i < iterations; ++i) failed |= dom.nts_dom_set_text_content(context, node, i % 2 === 0 ? a : b);
  } else if (mode === 4) {
    for (let i = 0; i < iterations; ++i) {
      failed |= dom.nts_dom_set_text_interned(context, node, i % 2 === 0 ? state.aAtom : state.bAtom);
    }
  } else {
    for (let i = 0; i < iterations; ++i) {
      failed |= dom.nts_dom_set_text_content(context, node, state.prefix + (i % 2 === 0 ? "A" : "B"));
    }
  }
  return failed;
}
