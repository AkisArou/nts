'use strict';

// Statically representable Blob/File behavior from Node v24.20.0. The broad
// upstream files also inspect descriptors/prototypes, invoke arbitrary
// receivers and coercion hooks, and require structured-clone metadata.

const common = require('../common');
const assert = require('assert');
const { EOL } = require('os');
const { Blob, File } = require('buffer');

assert.strictEqual(new Blob().size, 0);
assert.strictEqual(new Blob().type, '');
assert.strictEqual(new Blob([], { type: 'TEXT/PLAIN' }).type, 'text/plain');
assert.strictEqual(new Blob([], { type: '\x01' }).type, '');
assert.throws(() => new Blob([], { endings: 'other' }), {
  code: 'ERR_INVALID_ARG_VALUE',
});

const source = new Uint8Array([97, 98, 99]);
const copied = new Blob([source]);
source[0] = 120;

(async () => {
  assert.strictEqual(await copied.text(), 'abc');
  const copiedBytes = await copied.bytes();
  assert.deepStrictEqual([...copiedBytes], [97, 98, 99]);
  copiedBytes[0] = 120;
  assert.strictEqual(await copied.text(), 'abc');
  const copiedBuffer = await copied.arrayBuffer();
  assert.deepStrictEqual([...new Uint8Array(copiedBuffer)], [97, 98, 99]);
  new Uint8Array(copiedBuffer)[0] = 120;
  assert.strictEqual(await copied.text(), 'abc');

  const joined = new Blob(['hello', copied, 42]);
  assert.strictEqual(joined.size, 10);
  assert.strictEqual(await joined.text(), 'helloabc42');

  const slice = joined.slice(1, -2, 'TEXT/CUSTOM');
  assert.strictEqual(slice.type, 'text/custom');
  assert.strictEqual(await slice.text(), 'elloabc');
  assert.strictEqual(joined.slice(-1, 1).size, 0);

  const fractions = new Blob(['abcdef']);
  assert.strictEqual(await fractions.slice(0, 0.5).text(), '');
  assert.strictEqual(await fractions.slice(0, 0.6).text(), 'a');
  assert.strictEqual(await fractions.slice(0, 1.5).text(), 'ab');
  assert.strictEqual(await fractions.slice(0, 2.5).text(), 'ab');
  assert.strictEqual(await fractions.slice(0, 3.5).text(), 'abcd');
  assert.strictEqual(await fractions.slice(-1.5).text(), 'ef');
  assert.strictEqual(await fractions.slice(-2.5).text(), 'ef');

  const invalidUtf8 = new Blob(['hello', new Uint8Array([0xed, 0xa0, 0x88])]);
  assert.strictEqual(await invalidUtf8.text(), 'hello\ufffd\ufffd\ufffd');

  const typedViews = new Blob([
    new Uint8Array(4),
    new Int16Array(4),
    new Uint32Array(4),
  ]);
  assert.strictEqual(typedViews.size, 28);

  const nativeLines = new Blob(['a\rb\r\nc\nd'], { endings: 'native' });
  assert.strictEqual(await nativeLines.text(), ['a', 'b', 'c', 'd'].join(EOL));
  for (const [input, expected] of [
    ['a\r\rb', `a${EOL}${EOL}b`],
    ['a\n\rb', `a${EOL}${EOL}b`],
    ['\r\n\r', `${EOL}${EOL}`],
  ]) {
    assert.strictEqual(await new Blob([input], { endings: 'native' }).text(), expected);
  }

  const reader = new Blob(['A', 'BC']).stream().getReader();
  let result = await reader.read();
  assert.deepStrictEqual([...result.value], [65]);
  assert.strictEqual(result.done, false);
  result = await reader.read();
  assert.deepStrictEqual([...result.value], [66, 67]);
  result = await reader.read();
  assert.strictEqual(result.done, true);

  const cancelReader = new Blob(['A', 'B']).stream().getReader();
  assert.deepStrictEqual([...((await cancelReader.read()).value)], [65]);
  await cancelReader.cancel('done');
  await cancelReader.closed;

  const byobReader = new Blob(['hello', 'world'])
    .stream()
    .getReader({ mode: 'byob' });
  let byob = await byobReader.read(new Uint8Array(2));
  assert.deepStrictEqual([...byob.value], [104, 101]);
  assert.strictEqual(byob.done, false);
  byob = await byobReader.read(new Uint8Array(8));
  assert.deepStrictEqual([...byob.value], [108, 108, 111]);
  await byobReader.cancel();

  const smiley = Buffer.from('😀');
  const textReader = new Blob([
    'hello ',
    smiley.subarray(0, 2),
    smiley.subarray(2),
  ]).textStream().getReader();
  let decoded = '';
  while (true) {
    const chunk = await textReader.read();
    if (chunk.done) break;
    decoded += chunk.value;
  }
  assert.strictEqual(decoded, 'hello 😀');

  const file = new File(['body'], 'dummy.txt', {
    type: 'TEXT/PLAIN',
    lastModified: 10,
  });
  assert(file instanceof Blob);
  assert.strictEqual(file.name, 'dummy.txt');
  assert.strictEqual(file.lastModified, 10);
  assert.strictEqual(file.type, 'text/plain');
  assert.strictEqual(await file.text(), 'body');
  assert.strictEqual(new File([], '\ud800').name, '\ufffd');
  assert.strictEqual(new File([], 'name', { lastModified: NaN }).lastModified, 0);

  const before = Date.now();
  const defaultDate = new File([], 'name');
  assert(defaultDate.lastModified >= before);
  assert(defaultDate.lastModified <= Date.now());
})().then(common.mustCall());
