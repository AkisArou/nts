import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGeneratedNumbers, stableCheckText } from "../conformance/observation-text.ts";

test("diagnostic normalization retains source names, positions, arity and widths", () => {
  assert.equal(normalizeGeneratedNumbers('Queue<35>#push Wrapper<37, 42>#map type 99 BlockId(12) at: 14 bits: 64 OwnType35'),
    'Queue<N>#push Wrapper<N, N>#map type N BlockId(N) at: 14 bits: 64 OwnType35');
  assert.notEqual(normalizeGeneratedNumbers('Queue<35>#push'), normalizeGeneratedNumbers('Queue<35>#shift'));
});

test("scratch-location normalization never changes an answer's numbers", () => {
  assert.equal(stableCheckText('refused: /scratch/src/main.ts:12:5: NTS1001 Queue<35>'), 'refused: NTS1001 Queue<35>');
  assert.equal(stableCheckText('not rendered: /scratch/src/main.ts:12:5: NTS4001'), 'not rendered: NTS4001');
  assert.equal(stableCheckText('observed <35> type 42 at 17'), 'observed <35> type 42 at 17');
});
