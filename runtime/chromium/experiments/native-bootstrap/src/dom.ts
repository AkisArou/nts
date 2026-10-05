// Explicit experiment API. Every operation calls Blink immediately; this is
// not a DOM effect tape or a declaration pretending to implement lib.dom.
import * as host from "nts:chromium-dom-experiment";
import type { DomContext } from "nts:chromium-dom-experiment";
import type { c_uint32 } from "c:types";

function units(text: string): Uint16Array {
  const result = new Uint16Array(text.length);
  for (let i = 0; i < text.length; ++i) result[i] = text.charCodeAt(i);
  return result;
}
function getBody(c: DomContext): c_uint32 { return host.nts_dom_body(c); }
function query(c: DomContext, s: string): c_uint32 { return host.nts_dom_query(c, units(s), s.length as c_uint32); }
function element(c: DomContext, s: string): c_uint32 { return host.nts_dom_element(c, units(s), s.length as c_uint32); }
function textNode(c: DomContext, s: string): c_uint32 { return host.nts_dom_text(c, units(s), s.length as c_uint32); }
function append(c: DomContext, p: c_uint32, n: c_uint32): number { return host.nts_dom_append(c, p, n); }
function remove(c: DomContext, p: c_uint32, n: c_uint32): number { return host.nts_dom_remove(c, p, n); }
function setText(c: DomContext, n: c_uint32, s: string): number { return host.nts_dom_set_text(c, n, units(s), s.length as c_uint32); }
function setAttribute(c: DomContext, n: c_uint32, name: string, value: string): number {
  return host.nts_dom_set_attribute(c, n, units(name), name.length as c_uint32, units(value), value.length as c_uint32);
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

  // Length-bearing copies must preserve NUL, paired and lone surrogates,
  // Latin-1 and non-Latin-1 code units in both directions.
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
}
export function ntsChromiumPrepareBenchmark(a: string, b: string): ChromiumBenchmarkState {
  return {aUnits: units(a), bUnits: units(b)};
}
export function ntsChromiumBenchmarkLoop(context: DomContext, node: c_uint32,
  state: ChromiumBenchmarkState, a: string, b: string, iterations: number, prepared: boolean): number {
  const length = a.length as c_uint32;
  if (prepared) {
    for (let i = 0; i < iterations; ++i) {
      host.nts_dom_set_text(context, node, i % 2 === 0 ? state.aUnits : state.bUnits, length);
    }
  } else {
    for (let i = 0; i < iterations; ++i) {
      setText(context, node, i % 2 === 0 ? a : b);
    }
  }
  return status(context);
}
