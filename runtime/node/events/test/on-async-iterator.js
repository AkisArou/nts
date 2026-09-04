'use strict';
// Applicable public behavior isolated from pinned upstream
// test-events-on-async-iterator.js, which also imports Node's private
// internal/event_target classes and listener registry.
const common = require('../common');
const assert = require('assert');
const {
  EventEmitter,
  getEventListeners,
  on,
} = require('events');

async function eventEmitterIteration() {
  const emitter = new EventEmitter();
  const iterable = on(emitter, 'value');
  emitter.emit('value', 42, 'answer');
  assert.deepStrictEqual(await iterable.next(), {
    value: [42, 'answer'],
    done: false,
  });

  // `close` has no special meaning unless the caller requests it.
  emitter.emit('close');
  emitter.emit('value', 7);
  assert.deepStrictEqual(await iterable.next(), {
    value: [7],
    done: false,
  });
  await iterable.return();
  assert.strictEqual(emitter.listenerCount('value'), 0);
  assert.strictEqual(emitter.listenerCount('error'), 0);
}

async function configuredClose() {
  const emitter = new EventEmitter();
  const iterable = on(emitter, 'value', { close: ['finished'] });
  emitter.emit('finished');
  assert.deepStrictEqual(await iterable.next(), {
    value: undefined,
    done: true,
  });
  assert.strictEqual(emitter.listenerCount('value'), 0);
  assert.strictEqual(emitter.listenerCount('finished'), 0);
}

async function errorAndAbort() {
  const errorEmitter = new EventEmitter();
  const errorIterable = on(errorEmitter, 'value');
  const expected = new Error('expected');
  errorEmitter.emit('error', expected);
  await assert.rejects(errorIterable.next(), (error) => error === expected);
  assert.deepStrictEqual(await errorIterable.next(), {
    value: undefined,
    done: true,
  });

  const abortEmitter = new EventEmitter();
  const controller = new AbortController();
  const abortIterable = on(abortEmitter, 'value', {
    signal: controller.signal,
  });
  controller.abort('stop');
  await assert.rejects(abortIterable.next(), (error) => {
    assert.strictEqual(error.name, 'AbortError');
    assert.strictEqual(error.code, 'ABORT_ERR');
    assert.strictEqual(error.cause, 'stop');
    return true;
  });
  assert.strictEqual(abortEmitter.listenerCount('value'), 0);
  assert.strictEqual(abortEmitter.listenerCount('error'), 0);
}

async function eventTargetIteration() {
  const target = new EventTarget();
  const iterable = on(target, 'tick');
  assert.strictEqual(getEventListeners(target, 'tick').length, 1);
  target.dispatchEvent(new Event('tick'));
  const result = await iterable.next();
  assert.strictEqual(result.done, false);
  assert.strictEqual(result.value.length, 1);
  assert.strictEqual(result.value[0].type, 'tick');
  await iterable.return();
  assert.deepStrictEqual(getEventListeners(target, 'tick'), []);
}

async function backpressureAndLegacyNames() {
  class PausableEmitter extends EventEmitter {
    pauses = 0;
    resumes = 0;

    pause() {
      this.pauses += 1;
    }

    resume() {
      this.resumes += 1;
    }
  }

  const emitter = new PausableEmitter();
  const iterable = on(emitter, 'value', {
    highWatermark: 1,
    lowWatermark: 1,
  });
  const watermark = iterable[Symbol.for('nodejs.watermarkData')];
  emitter.emit('value', 1);
  emitter.emit('value', 2);
  assert.strictEqual(emitter.pauses, 1);
  assert.strictEqual(watermark.size, 2);
  assert.strictEqual(watermark.isPaused, true);
  await iterable.next();
  assert.strictEqual(emitter.resumes, 0);
  await iterable.next();
  assert.strictEqual(emitter.resumes, 1);
  assert.strictEqual(watermark.size, 0);
  assert.strictEqual(watermark.isPaused, false);
  await iterable.return();
}

assert.throws(() => on({}, 'value'), {
  code: 'ERR_INVALID_ARG_TYPE',
});

Promise.all([
  eventEmitterIteration(),
  configuredClose(),
  errorAndAbort(),
  eventTargetIteration(),
  backpressureAndLegacyNames(),
]).then(common.mustCall());
