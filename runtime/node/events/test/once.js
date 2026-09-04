'use strict';
// Applicable behavior isolated from pinned upstream test-events-once.js,
// whose EventTarget cases require Node's private kResistStopPropagation option
// and internal listener registry.
const common = require('../common');
const assert = require('assert');
const {
  EventEmitter,
  getEventListeners,
  listenerCount,
  once,
} = require('events');

async function resolvesEventArguments() {
  const emitter = new EventEmitter();
  process.nextTick(() => emitter.emit('value', 42, 'answer'));
  assert.deepStrictEqual(await once(emitter, 'value'), [42, 'answer']);
  assert.strictEqual(emitter.listenerCount('value'), 0);
  assert.strictEqual(emitter.listenerCount('error'), 0);
}

async function rejectsErrors() {
  const emitter = new EventEmitter();
  const expected = new Error('expected');
  process.nextTick(() => emitter.emit('error', expected));
  await assert.rejects(once(emitter, 'value'), (error) => error === expected);
  assert.strictEqual(emitter.listenerCount('value'), 0);
  assert.strictEqual(emitter.listenerCount('error'), 0);
}

async function validatesAndAborts() {
  const emitter = new EventEmitter();
  await assert.rejects(once(emitter, 'value', 1), {
    code: 'ERR_INVALID_ARG_TYPE',
  });

  const controller = new AbortController();
  const pending = once(emitter, 'value', { signal: controller.signal });
  assert.strictEqual(listenerCount(controller.signal, 'abort'), 1);
  controller.abort('stop');
  await assert.rejects(pending, {
    name: 'AbortError',
    code: 'ABORT_ERR',
  });
  assert.strictEqual(listenerCount(controller.signal, 'abort'), 0);
  assert.strictEqual(emitter.listenerCount('value'), 0);
  assert.strictEqual(emitter.listenerCount('error'), 0);
}

async function resolvesEventTarget() {
  const target = new EventTarget();
  const pending = once(target, 'value');
  assert.strictEqual(getEventListeners(target, 'value').length, 1);
  target.dispatchEvent(new Event('value'));
  const result = await pending;
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'value');
  assert.deepStrictEqual(getEventListeners(target, 'value'), []);
}

Promise.all([
  resolvesEventArguments(),
  rejectsErrors(),
  validatesAndAborts(),
  resolvesEventTarget(),
]).then(common.mustCall());
