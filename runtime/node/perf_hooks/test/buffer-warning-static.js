// The global buffer's leak warning, which upstream provokes and never checks.
//
// Preserves node v24.20.0 lib/internal/perf/observe.js `bufferUserTiming`:
// past 1e6 buffered entries of one type, one
// `MaxPerformanceEntryBufferExceededWarning` per type for the life of the
// process, carrying `entryType` and `count`. The expected values are node's,
// taken from node v24.20.0 by running this same sequence against its
// `perf_hooks`. test/parallel/test-performance-many-marks.js makes a million
// marks and asserts nothing about them.

'use strict';

const common = require('../common');
const assert = require('assert');
const { performance } = require('perf_hooks');

const warnings = [];
process.on('warning', (warning) => {
  if (warning.name === 'MaxPerformanceEntryBufferExceededWarning') warnings.push(warning);
});

for (let i = 0; i < 1e6 + 2; i++) performance.mark('m');
for (let i = 0; i < 1e6 + 1; i++) performance.measure('x');
performance.clearMarks();
performance.clearMeasures();
// Warned once per type, however often the buffer refills.
for (let i = 0; i < 1e6 + 1; i++) performance.mark('m');
performance.clearMarks();

setImmediate(common.mustCall(() => {
  assert.deepStrictEqual(
    warnings.map((w) => [w.message, w.entryType, w.count, Object.keys(w)]),
    [
      [
        'Possible perf_hooks memory leak detected. 1000001 mark entries added to the ' +
          'global performance entry buffer. Use performance.clearMarks to clear the buffer.',
        'mark',
        1000001,
        ['name', 'entryType', 'count'],
      ],
      [
        'Possible perf_hooks memory leak detected. 1000001 measure entries added to the ' +
          'global performance entry buffer. Use performance.clearMeasures to clear the buffer.',
        'measure',
        1000001,
        ['name', 'entryType', 'count'],
      ],
    ],
  );
}));
