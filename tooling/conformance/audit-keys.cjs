'use strict';

// The export surface a consumer actually sees, printed for `audit.mjs`.
//
// Run through `run-one.mjs`, so `require(name)` is the *substituted* module
// assembled by its `shape.mjs` rather than the TypeScript source's exports.
// That distinction is the whole point: what a program can reach is the shape,
// and a name present in the source but absent from the shape is missing as far
// as any test is concerned.

const name = process.env.NTS_AUDIT_MODULE;
if (typeof name !== 'string' || name === '') {
  throw new Error('NTS_AUDIT_MODULE must name the module to inspect');
}
const shape = require(name);
console.log('NTSKEYS ' + JSON.stringify(Object.keys(shape).sort()));

// Own enumerable keys are not the whole surface. `process.exitCode`, `title`
// and `ppid` are inherited accessors, so `Object.keys` misses them and a diff
// built on it alone calls them missing -- three false positives out of the
// first eighteen this reported. Reachability is the question a consumer
// actually asks, so the audit sends back what it suspects and this answers
// with `in`.
const suspected = process.env.NTS_AUDIT_NAMES;
if (typeof suspected === 'string' && suspected !== '') {
  const reachable = JSON.parse(suspected).filter((key) => key in shape);
  console.log('NTSREACHABLE ' + JSON.stringify(reachable));
}
