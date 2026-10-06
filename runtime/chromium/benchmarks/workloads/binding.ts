// The binding benchmark's loop (benchmarks/harness/binding_benchmark.cc runs
// it): one text mutation per iteration, through the program's own string and
// through prepared buffers that show what the string costs.
import * as testing from "nts:dom-testing";
import type { Node } from "nts:dom";
import type { c_uint32 } from "c:types";

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
    prefix: a.substring(0, a.length - 1), aAtom: testing.nts_dom_intern(a), bAtom: testing.nts_dom_intern(b)};
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
      failed |= testing.nts_dom_set_text16(node, i % 2 === 0 ? state.aUnits : state.bUnits, length);
    }
  } else if (mode === 1) {
    for (let i = 0; i < iterations; ++i) {
      failed |= testing.nts_dom_set_text8(node, i % 2 === 0 ? state.aBytes : state.bBytes, length);
    }
  } else if (mode === 2) {
    for (let i = 0; i < iterations; ++i) node.textContent = i % 2 === 0 ? a : b;
  } else if (mode === 4) {
    for (let i = 0; i < iterations; ++i) {
      failed |= testing.nts_dom_set_text_interned(node, i % 2 === 0 ? state.aAtom : state.bAtom);
    }
  } else {
    for (let i = 0; i < iterations; ++i) {
      node.textContent = state.prefix + (i % 2 === 0 ? "A" : "B");
    }
  }
  return failed;
}
