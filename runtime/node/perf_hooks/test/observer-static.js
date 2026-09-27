// Upstream test-performanceobserver.js, less its native observer counts.
//
// Preserves node v24.20.0 test/parallel/test-performanceobserver.js verbatim
// except for its first lines, which read `internalBinding('performance')`'s
// `observerCounts` -- the table node's C++ consults before producing `gc` and
// `http2` entries. Nothing in this profile produces those, so it keeps no such
// table, and the upstream file is skipped for needing the binding.

'use strict';

const common = require('../common');
const assert = require('assert');
const {
  performance,
  PerformanceObserver,
} = require('perf_hooks');

{
  [1, null, undefined, {}, [], Infinity].forEach((i) => {
    assert.throws(
      () => new PerformanceObserver(i),
      {
        code: 'ERR_INVALID_ARG_TYPE',
        name: 'TypeError',
      }
    );
  });
  const observer = new PerformanceObserver(common.mustNotCall());

  [1, 'test'].forEach((input) => {
    assert.throws(
      () => observer.observe(input),
      {
        code: 'ERR_INVALID_ARG_TYPE',
        name: 'TypeError',
        message: 'The "options" argument must be of type object.' +
                 common.invalidArgTypeHelper(input)
      });
  });

  [1, null, {}, Infinity].forEach((i) => {
    assert.throws(() => observer.observe({ entryTypes: i }),
                  {
                    code: 'ERR_INVALID_ARG_TYPE',
                    name: 'TypeError'
                  });
  });

  const obs = new PerformanceObserver(common.mustNotCall());
  obs.observe({ entryTypes: ['mark', 'mark'] });
  obs.disconnect();
  performance.mark('42');
}

// Test Non-Buffered
{
  const observer =
    new PerformanceObserver(common.mustCall(callback));

  function callback(list, obs) {
    assert.strictEqual(obs, observer);
    const entries = list.getEntries();
    assert.strictEqual(entries.length, 3);
    observer.disconnect();
  }
  observer.observe({ entryTypes: ['mark', 'node'] });
  performance.mark('test1');
  performance.mark('test2');
  performance.mark('test3');
}
