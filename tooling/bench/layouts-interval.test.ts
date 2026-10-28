import test from 'node:test';
import assert from 'node:assert/strict';
import {inferLayouts,random,type LayoutSample} from './layouts-interval.ts';

function observations(ratios: number[], repeats = 3): LayoutSample[] {
  return ratios.map((ratio,index) => ({id: 'layout-' + index,
    rounds: Array.from({length:repeats},(_,round) => {
      const before = 1000 * (1 + index / 100) * (1 + round / 50);
      const after = before * 1.02;
      return {before,after,changed: Math.sqrt(before) * Math.sqrt(after) * ratio};
    })}));
}

test('intervals distinguish a real effect from opposing layout draws',() => {
  assert.equal(inferLayouts(observations(Array(20).fill(0.9))).verdict,'improvement');
  assert.equal(inferLayouts(observations(Array(20).fill(1.1))).verdict,'regression');
  const noisy = inferLayouts(observations(Array.from({length:20},(_,i) => i % 2 ? 1.15 : 0.85)));
  assert.equal(noisy.verdict,'noise');
  assert.ok(noisy.interval.low < 0 && noisy.interval.high > 0);
  assert.ok(noisy.perLayoutDelta.min < 0 && noisy.perLayoutDelta.max > 0);
});

test('repeats do not become independent layout samples',() => {
  const ratios=Array.from({length:20},(_,i) => 0.95 + i / 200);
  const first=inferLayouts(observations(ratios));
  const repeated=inferLayouts(observations(ratios,6));
  assert.equal(first.independentLayouts,20); assert.equal(repeated.independentLayouts,20);
  assert.ok(Math.abs(first.interval.low-repeated.interval.low)<1e-12);
  assert.ok(Math.abs(first.interval.high-repeated.interval.high)<1e-12);
  assert.throws(() => inferLayouts(observations([1],25)),/twenty/);
});

test('all draws and the deterministic interval survive completion order',() => {
  const rows=observations(Array.from({length:20},(_,i) => i===19 ? 1.9 : 0.95));
  assert.deepEqual(inferLayouts(rows),inferLayouts(rows.toReversed()));
  assert.ok(inferLayouts(rows).perLayoutDelta.max>0.89);
});

test('malformed and incomplete samples cannot receive a verdict',() => {
  const rows=observations(Array(20).fill(1));
  assert.throws(() => inferLayouts([...rows.slice(0,19),rows[0]]));
  assert.throws(() => inferLayouts([{...rows[0],rounds:[]},...rows.slice(1)]));
  assert.throws(() => inferLayouts([{...rows[0],rounds:[{before:0,changed:1,after:1},...rows[0].rounds.slice(1)]},...rows.slice(1)]));
  assert.throws(() => inferLayouts(rows,{resamples:20}));
  assert.throws(() => inferLayouts(rows,{confidence:1}));
  assert.throws(() => random(0));
});
