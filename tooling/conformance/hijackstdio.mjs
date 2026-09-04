// Node's `test/common/hijackstdio`, which its console tests use to capture
// what was printed.
//
// Transcribed rather than imported because node ships it as CommonJS inside
// its test tree; the behaviour, including the `writeTimes` counter that
// test-console.js asserts on, is node's.
import process from "node:process";

const stdWrite = {};

function hijackStdWritable(name, listener) {
  const stream = process[name];
  const _write = stdWrite[name] = stream.write;

  stream.writeTimes = 0;
  stream.write = function (data, callback) {
    try {
      listener(data);
    } catch (e) {
      process.nextTick(() => { throw e; });
    }

    _write.call(stream, data, callback);
    stream.writeTimes++;
  };
}

function restoreWritable(name) {
  process[name].write = stdWrite[name];
  delete process[name].writeTimes;
}

export const hijackStdout = hijackStdWritable.bind(null, "stdout");
export const hijackStderr = hijackStdWritable.bind(null, "stderr");
export const restoreStdout = restoreWritable.bind(null, "stdout");
export const restoreStderr = restoreWritable.bind(null, "stderr");
