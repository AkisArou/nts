"use strict";

// Statically representable pipeline behavior retained from pinned upstream
// `parallel/test-stream-pipeline.js`. That broad fixture also extracts a host
// fs method and invokes it with Function.call, and returns a getter-backed
// arbitrary thenable whose `then` property must be read exactly once. Both
// require the JavaScript function/property metaobject model.
const common = require("../common");
const assert = require("assert");
const { PassThrough, Readable, Transform, Writable, pipeline } = require("stream");
const { pipeline: pipelinePromise } = require("stream/promises");

function streamPipeline() {
  let result = "";
  const source = new Readable({ read() {} });
  const destination = new Writable({
    write(chunk, encoding, callback) {
      result += chunk;
      callback();
    },
  });
  source.push("hello");
  source.push("world");
  source.push(null);
  const returned = pipeline(
    source,
    destination,
    common.mustSucceed(() => {
      assert.strictEqual(result, "helloworld");
      assert.strictEqual(destination.writableFinished, true);
    }),
  );
  assert.strictEqual(returned, destination);
}

function transformFailure() {
  const expected = new Error("kaboom");
  const source = new Readable({ read() {} });
  const transform = new Transform({
    transform(chunk, encoding, callback) {
      callback(expected);
    },
  });
  const destination = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  pipeline(
    source,
    transform,
    destination,
    common.mustCall((error) => {
      assert.strictEqual(error, expected);
      assert.strictEqual(source.destroyed, true);
      assert.strictEqual(transform.destroyed, true);
      assert.strictEqual(destination.destroyed, true);
    }),
  );
  source.push("data");
}

function functionStages() {
  let observed = "";
  const returned = pipeline(
    async function* () {
      await Promise.resolve();
      yield "hello";
      yield "world";
    },
    async function* (source) {
      for await (const chunk of source) yield chunk.toUpperCase();
    },
    async function (source) {
      for await (const chunk of source) observed += chunk;
      return observed;
    },
    common.mustSucceed((value) => {
      assert.strictEqual(value, "HELLOWORLD");
      assert.strictEqual(observed, "HELLOWORLD");
    }),
  );
  assert.strictEqual(typeof returned.pipe, "function");
  returned.resume();
}

async function promiseAndEndPolicy() {
  let arrayResult = "";
  const arrayDestination = new Writable({
    write(chunk, encoding, callback) {
      arrayResult += chunk;
      callback();
    },
  });
  await pipelinePromise([Readable.from(["array", "-form"]), arrayDestination]);
  assert.strictEqual(arrayResult, "array-form");

  let result = "";
  const destination = new Writable({
    write(chunk, encoding, callback) {
      result += chunk;
      callback();
    },
  });
  await pipelinePromise(
    async function* () {
      yield "hello";
      await Promise.resolve();
      yield "world";
    },
    destination,
    { end: false },
  );
  assert.strictEqual(result, "helloworld");
  assert.strictEqual(destination.writableEnded, false);
}

async function abortsEveryStage() {
  const controller = new AbortController();
  const source = new Readable({
    read() {
      this.push("data");
    },
  });
  const middle = new PassThrough();
  const destination = new Writable({
    write(chunk, encoding, callback) {
      controller.abort(new Error("stop"));
      callback();
    },
  });
  await assert.rejects(
    pipelinePromise(source, middle, destination, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.strictEqual(source.destroyed, true);
  assert.strictEqual(middle.destroyed, true);
  assert.strictEqual(destination.destroyed, true);
}

assert.throws(() => pipeline(), { code: "ERR_INVALID_ARG_TYPE" });
assert.throws(() => pipeline(new Readable({ read() {} }), () => {}), {
  code: "ERR_MISSING_ARGS",
});
streamPipeline();
transformFailure();
functionStages();
Promise.all([promiseAndEndPolicy(), abortsEveryStage()]).then(common.mustCall());
