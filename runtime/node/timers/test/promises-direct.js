'use strict';

// Focused applicable coverage from Node v24.20.0:
//   test-timers-timeout-promisified.js
//   test-timers-immediate-promisified.js
//   test-timers-interval-promisified.js
// Those upstream files obtain the functions through util.promisify.custom, a
// §13 dynamic-function-property non-goal. This file starts at the supported
// node:timers/promises exports and retains their behavioral assertions.

const common = require('../common');
const assert = require('assert');
const { listenerCount } = require('events');
const timerPromises = require('timers/promises');

async function main() {
  assert.strictEqual(await timerPromises.setTimeout(1), undefined);
  assert.strictEqual(await timerPromises.setTimeout(1, 'timeout value'), 'timeout value');
  assert.strictEqual(await timerPromises.setImmediate(), undefined);
  assert.strictEqual(await timerPromises.setImmediate('immediate value'), 'immediate value');

  {
    const controller = new AbortController();
    const promise = timerPromises.setTimeout(1, 'done', { signal: controller.signal });
    assert.strictEqual(listenerCount(controller.signal, 'abort'), 1);
    assert.strictEqual(await promise, 'done');
    assert.strictEqual(listenerCount(controller.signal, 'abort'), 0);
    controller.abort();
  }

  {
    const reason = { source: 'timeout' };
    const controller = new AbortController();
    const promise = timerPromises.setTimeout(1000, undefined, { signal: controller.signal });
    controller.abort(reason);
    await assert.rejects(promise, (error) =>
      error.name === 'AbortError' && error.cause === reason);
    assert.strictEqual(listenerCount(controller.signal, 'abort'), 0);
  }

  {
    const reason = { source: 'immediate' };
    const controller = new AbortController();
    const promise = timerPromises.setImmediate(undefined, { signal: controller.signal });
    controller.abort(reason);
    await assert.rejects(promise, (error) =>
      error.name === 'AbortError' && error.cause === reason);
    assert.strictEqual(listenerCount(controller.signal, 'abort'), 0);
  }

  {
    const reason = { source: 'already aborted' };
    const signal = AbortSignal.abort(reason);
    await assert.rejects(
      timerPromises.setTimeout(1, undefined, { signal }),
      (error) => error.name === 'AbortError' && error.cause === reason,
    );
    await assert.rejects(
      timerPromises.setImmediate(undefined, { signal }),
      (error) => error.name === 'AbortError' && error.cause === reason,
    );
  }

  for (const delay of ['', false]) {
    await assert.rejects(
      timerPromises.setTimeout(delay, null, {}),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  for (const options of [1, '', false, Infinity]) {
    await assert.rejects(
      timerPromises.setTimeout(1, null, options),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
    await assert.rejects(
      timerPromises.setImmediate(null, options),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }

  {
    const iterator = timerPromises.setInterval(1, 'interval value')[Symbol.asyncIterator]();
    assert.deepStrictEqual(await iterator.next(), { value: 'interval value', done: false });
    assert.deepStrictEqual(await iterator.next(), { value: 'interval value', done: false });
    assert.deepStrictEqual(await iterator.return(), { value: undefined, done: true });
  }

  {
    const reason = { source: 'interval' };
    const controller = new AbortController();
    const iterator = timerPromises
      .setInterval(1000, undefined, { signal: controller.signal })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    assert.strictEqual(listenerCount(controller.signal, 'abort'), 1);
    controller.abort(reason);
    await assert.rejects(pending, (error) =>
      error.name === 'AbortError' && error.cause === reason);
    assert.strictEqual(listenerCount(controller.signal, 'abort'), 0);
  }

  {
    const iterator = timerPromises
      .setInterval(1, undefined, { signal: AbortSignal.abort('interval pre-abort') })
      [Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), {
      name: 'AbortError',
      cause: 'interval pre-abort',
    });
  }

  for (const options of [1, '', Infinity, null, true, false]) {
    const iterator = timerPromises.setInterval(1, undefined, options)[Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), { code: 'ERR_INVALID_ARG_TYPE' });
  }
}

main().then(common.mustCall(), common.mustNotCall());
