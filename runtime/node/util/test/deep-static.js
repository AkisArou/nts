'use strict';

// Supported behavior retained from pinned Node v24.20.0
// parallel/test-util-isDeepStrictEqual.js. The upstream file also observes
// ToObject-boxed Symbol/BigInt values, Symbol-keyed fields, descriptors, and
// prototype identity, none of which exists in NTS's flat typed object model.
const assert = require('assert');
const { isDeepStrictEqual } = require('util');

function equal(left, right) {
  assert.strictEqual(isDeepStrictEqual(left, right), true);
  assert.strictEqual(isDeepStrictEqual(right, left), true);
}

function different(left, right) {
  assert.strictEqual(isDeepStrictEqual(left, right), false);
  assert.strictEqual(isDeepStrictEqual(right, left), false);
}

equal(new Boolean(true), new Boolean(true));
different(new Boolean(true), new Boolean(false));
equal(new Number(2), new Number(2));
different(new Number(2), new Number(1));
equal(new String('test'), new String('test'));
different(new String('test'), new String('other'));
different(new Boolean(true), new Number(1));

equal(
  { name: 'NTS', values: [1, 2, { active: true }] },
  { name: 'NTS', values: [1, 2, { active: true }] },
);
different(
  { name: 'NTS', values: [1, 2, { active: true }] },
  { name: 'NTS', values: [1, 2, { active: false }] },
);

class Cycle {
  constructor(name) {
    this.name = name;
    this.self = this;
  }
}
const leftCycle = new Cycle('cycle');
const rightCycle = new Cycle('cycle');
equal(leftCycle, rightCycle);

equal(new Set([{ id: 1 }, { id: 2 }]), new Set([{ id: 2 }, { id: 1 }]));
equal(
  new Map([[{ id: 1 }, { value: 'one' }]]),
  new Map([[{ id: 1 }, { value: 'one' }]]),
);
different(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]));
