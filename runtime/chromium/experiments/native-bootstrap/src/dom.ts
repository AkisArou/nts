// Explicit experiment API. Every operation calls Blink immediately; this is
// not a DOM effect tape or a declaration pretending to implement lib.dom.
import * as host from "nts:chromium-dom-experiment";
import * as dom from "nts:chromium-dom";
import type { DomContext } from "nts:chromium-dom-experiment";
import type { c_uint32 } from "c:types";

function getBody(c: DomContext): c_uint32 { return host.nts_dom_body(c); }
function query(c: DomContext, s: string): c_uint32 { return host.nts_dom_query(c, s); }
function element(c: DomContext, s: string): c_uint32 { return host.nts_dom_element(c, s); }
function textNode(c: DomContext, s: string): c_uint32 { return host.nts_dom_text(c, s); }
function append(c: DomContext, p: c_uint32, n: c_uint32): number { return host.nts_dom_append(c, p, n); }
function remove(c: DomContext, p: c_uint32, n: c_uint32): number { return host.nts_dom_remove(c, p, n); }
function setText(c: DomContext, n: c_uint32, s: string): number { return host.nts_dom_set_text(c, n, s); }
function setAttribute(c: DomContext, n: c_uint32, name: string, value: string): number {
  return host.nts_dom_set_attribute(c, n, name, value);
}
function status(c: DomContext): number { return host.nts_dom_status(c); }
function readText(c: DomContext, n: c_uint32): string {
  const length = host.nts_dom_text_length(c, n);
  const buffer = new Uint16Array(length);
  host.nts_dom_copy_text(c, n, buffer, length);
  let result = "";
  for (let i = 0; i < buffer.length; ++i) result += String.fromCharCode(buffer[i]);
  return result;
}

export function ntsChromiumDomProgram(context: DomContext): number {
  const body = getBody(context);
  const container = element(context, "section");
  setAttribute(context, container, "id", "native-dom");
  const label = element(context, "output");
  setAttribute(context, label, "id", "native-dom-count");
  const text = textNode(context, "Count: 0");
  append(context, label, text);
  append(context, container, label);
  append(context, body, container);
  if (query(context, "#native-dom-count") !== label) return 1;
  if (query(context, "#native-dom-count") !== label) return 2;
  if (query(context, "#missing") !== 0 || status(context) !== 0) return 3;
  query(context, "[");
  if (status(context) !== 12) return 4; // SyntaxError
  append(context, container, container);
  if (status(context) !== 3) return 5; // HierarchyRequestError
  remove(context, body, label);
  if (status(context) !== 8) return 6; // NotFoundError
  element(context, "bad name");
  if (status(context) !== 5) return 7; // InvalidCharacterError

  // A string view must preserve NUL, paired and lone surrogates, Latin-1 and
  // non-Latin-1 code units into Blink, and the copy back must return them.
  const exact = "A\0\u00e9\u03a9" + String.fromCharCode(0xd800) + "Z"
    + String.fromCharCode(0xdc00) + String.fromCharCode(0xd83d) + String.fromCharCode(0xde00);
  setText(context, label, exact);
  if (readText(context, label) !== exact) return 8;
  setAttribute(context, label, "data-exact", exact);
  remove(context, container, label);
  if (query(context, "#native-dom-count") !== 0) return 9;
  host.nts_dom_collect_for_testing(context);
  if (readText(context, label) !== exact) return 10;
  append(context, container, label);
  if (query(context, "#native-dom-count") !== label) return 11;
  setText(context, label, "Count: 0");
  let caught = false;
  try {
    query(context, "[");
    if (status(context) === 12) throw new Error("SyntaxError");
  } catch (error) {
    caught = true;
  }
  if (!caught) return 12;
  return 0;
}

export function ntsChromiumDomCounter(context: DomContext, count: number): void {
  const label = query(context, "#native-dom-count");
  setText(context, label, "Count: " + count);
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
// Modes match binding_benchmark.cc. 0-1 are the original bridge, which reads
// a context-wide status; 2-6 are entered calls returning their own status.
// 0 and 4 pass the string itself as a view (the legacy and the entered
// bridge), 1-3 prepared buffers, 5 a fresh string per mutation, as UI code
// builds one, and 6 interned text by id.
export function ntsChromiumBenchmarkLoop(context: DomContext, node: c_uint32,
  state: ChromiumBenchmarkState, a: string, b: string, iterations: number, mode: number): number {
  const length = a.length as c_uint32;
  let failed = 0;
  if (mode === 0) {
    for (let i = 0; i < iterations; ++i) setText(context, node, i % 2 === 0 ? a : b);
  } else if (mode === 1) {
    for (let i = 0; i < iterations; ++i) {
      host.nts_dom_set_text_units(context, node, i % 2 === 0 ? state.aUnits : state.bUnits, length);
    }
  } else if (mode === 2) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text16(context, node, i % 2 === 0 ? state.aUnits : state.bUnits, length);
    }
  } else if (mode === 3) {
    for (let i = 0; i < iterations; ++i) {
      failed |= host.nts_dom_set_text8(context, node, i % 2 === 0 ? state.aBytes : state.bBytes, length);
    }
  } else if (mode === 4) {
    for (let i = 0; i < iterations; ++i) failed |= dom.nts_dom_set_text_value(context, node, i % 2 === 0 ? a : b);
  } else if (mode === 6) {
    for (let i = 0; i < iterations; ++i) {
      failed |= dom.nts_dom_set_text_interned(context, node, i % 2 === 0 ? state.aAtom : state.bAtom);
    }
  } else {
    for (let i = 0; i < iterations; ++i) {
      failed |= dom.nts_dom_set_text_value(context, node, state.prefix + (i % 2 === 0 ? "A" : "B"));
    }
  }
  return mode < 2 ? status(context) : failed;
}
