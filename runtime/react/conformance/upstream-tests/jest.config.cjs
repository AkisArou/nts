'use strict';

// Upstream React's own "run the tests against built packages" configuration,
// with one change: which directory the package names resolve to.
//
//   NTS_REACT_ARM=upstream  upstream's own stable build (the control arm)
//   NTS_REACT_ARM=stub      an empty package per name (must fail everything)
//   NTS_REACT_ARM=nts       this lane's runtime, emitted as JavaScript
//
// Jest runs with the upstream clone as its working directory, so `<rootDir>`
// is that clone and the test files, `internal-test-utils` and the setup
// files are upstream's own, unmodified.

const {join, resolve} = require('path');

const buildConfig = require(join(process.cwd(), 'scripts/jest/config.build.js'));

const arm = process.env.NTS_REACT_ARM || 'nts';
const lane = resolve(__dirname, '../..');
const targets = {
  upstream: '<rootDir>/build/oss-stable',
  stub: join(lane, 'build/stub'),
  nts: join(lane, 'build/js'),
};
const target = targets[arm];
if (target === undefined) {
  throw new Error(`NTS_REACT_ARM must be one of ${Object.keys(targets).join(', ')}`);
}

// The packages this lane implements. Everything else, including test
// infrastructure such as `jest-react`, resolves to upstream's own build. A
// package we do not claim can still be required by a test and will then run
// against our `react`, which is a failure we should see rather than hide.
const owned = ['react', 'react-noop-renderer', 'scheduler'];

const moduleNameMapper = {};
for (const [pattern, path] of Object.entries(buildConfig.moduleNameMapper)) {
  const name = /^\^([^\\$/]+)/.exec(pattern)?.[1];
  moduleNameMapper[pattern] = owned.includes(name)
    ? path.replace('<rootDir>/build/oss-stable', target)
    : path;
}

module.exports = Object.assign({}, buildConfig, {moduleNameMapper});
