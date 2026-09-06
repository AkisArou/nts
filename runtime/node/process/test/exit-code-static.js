'use strict';

// The statically representable portion of pinned Node
// test/parallel/test-process-exit-code.js. Its final case dynamically removes
// process._fatalException, which is a Section 13 function/metaobject operation;
// these ten cases retain every ordinary exit and uncaught-exception transition.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');
const { spawn } = require('child_process');
const { getTestCases } = require(
  '../../../../third_party/node/test/common/process-exit-code-cases',
);

const testCases = getTestCases(false).slice(0, 10);

if (process.argv[2] === undefined) {
  const test = common.mustCallAtLeast((index, name, expected) => {
    spawn(process.execPath, [__filename, String(index)], {
      stdio: [0, 1, 'ignore'],
    }).on('exit', common.mustCall((code) => {
      assert.strictEqual(
        code,
        expected,
        `wrong exit for ${index}-${name}: expected ${expected}, got ${code}`,
      );
    }));
  });

  testCases.forEach((testCase, index) => {
    test(index, testCase.func.name, testCase.result);
  });
} else {
  const index = Number.parseInt(process.argv[2], 10);
  assert(!Number.isNaN(index));
  const testCase = testCases[index];
  assert(testCase !== undefined);
  testCase.func();
}
