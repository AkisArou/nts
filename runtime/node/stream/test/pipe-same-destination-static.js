"use strict";

// Applicable behavior retained from pinned upstream
// `parallel/test-stream-pipe-same-destination-twice.js`. The upstream file
// additionally indexes `_events.data`, Node's dynamic internal property bag;
// this version observes the public delivery and statically typed pipe state.
const common = require("../common");
const assert = require("assert");
const { PassThrough, Writable } = require("stream");

{
  const source = new PassThrough();
  const destination = new Writable({
    write: common.mustCall((chunk, encoding, callback) => {
      assert.strictEqual(`${chunk}`, "foobar");
      callback();
    }),
  });

  source.pipe(destination);
  source.pipe(destination);
  assert.strictEqual(source._readableState.pipes.length, 2);
  assert.strictEqual(source._readableState.pipes[0], destination);
  assert.strictEqual(source._readableState.pipes[1], destination);

  source.unpipe(destination);
  assert.strictEqual(source._readableState.pipes.length, 1);
  assert.strictEqual(source._readableState.pipes[0], destination);
  source.write("foobar");
  source.pipe(destination);
}

{
  const source = new PassThrough();
  const destination = new Writable({
    write: common.mustCall((chunk, encoding, callback) => {
      assert.strictEqual(`${chunk}`, "foobar");
      callback();
    }, 2),
  });

  source.pipe(destination);
  source.pipe(destination);
  assert.strictEqual(source._readableState.pipes.length, 2);
  source.write("foobar");
}

{
  const source = new PassThrough();
  const destination = new Writable({ write: common.mustNotCall() });

  source.pipe(destination);
  source.pipe(destination);
  assert.strictEqual(source._readableState.pipes.length, 2);
  source.unpipe(destination);
  source.unpipe(destination);
  assert.strictEqual(source._readableState.pipes.length, 0);
  source.write("foobar");
}
