// Flags: --experimental-stream-iter
'use strict';

const common = require('../common');
const assert = require('assert');
const { broadcast, duplex, text } = require('stream/iter');

(async () => {
  {
    const { broadcast: controller } = broadcast();
    const pending = text(controller.push());
    controller[Symbol.dispose]();
    controller[Symbol.dispose]();
    assert.strictEqual(await pending, '');
  }

  {
    const { writer, broadcast: controller } = broadcast();
    const pending = text(controller.push());
    writer[Symbol.dispose]();
    writer[Symbol.dispose]();
    await assert.rejects(pending, { code: 'ERR_INVALID_STATE' });
    assert.strictEqual(writer.canWrite, null);
  }

  {
    const { writer, broadcast: controller } = broadcast();
    const pending = text(controller.push());
    await writer[Symbol.asyncDispose]();
    await writer[Symbol.asyncDispose]();
    await assert.rejects(pending, { code: 'ERR_INVALID_STATE' });
    assert.strictEqual(writer.canWrite, null);
  }

  {
    const [a, b] = duplex();
    const ownIterator = a.readable[Symbol.asyncIterator]();
    const ownNext = ownIterator.next();
    const peerText = text(b.readable);
    await a[Symbol.asyncDispose]();
    await a[Symbol.asyncDispose]();
    assert.strictEqual((await ownNext).done, true);
    assert.strictEqual(await peerText, '');
    await b[Symbol.asyncDispose]();
  }
})().then(common.mustCall());
