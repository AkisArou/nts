import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join,resolve} from 'node:path';
import {positiveNodeTests} from './node-test-population.mjs';

const root=resolve('node-test-root');
const entry=path=>({name:path,path:join(root,path)});

test('upstream known issues contribute no positive population',()=>{
  const diagnostic=entry('known_issues/test-fs-cp-filter.js');
  assert.deepEqual(positiveNodeTests(root,[diagnostic]),[]);
});

test('explicit suite registration and normalized paths cannot include known issues',()=>{
  const tests=[entry('known_issues/test-a.js'),entry('known_issues/nested/test-b.mjs'),entry('parallel/../known_issues/test-c.js')];
  assert.deepEqual(positiveNodeTests(root,tests),[]);
});

test('moving a file into a positive suite enters normal selection',()=>{
  const moved=entry('parallel/test-fs-cp-filter.js');
  assert.deepEqual(positiveNodeTests(root,[moved]),[moved]);
});

test('network-dependent internet entries never enter positive conformance',()=>{
  const tests=[entry('internet/test-net-connect-timeout.js'),entry('parallel/../internet/test-dns.js')];
  assert.deepEqual(positiveNodeTests(root,tests),[]);
  const moved=entry('parallel/test-net-connect-timeout.js');
  assert.deepEqual(positiveNodeTests(root,[moved]),[moved]);
});

test('a filename mentioning known issues is not that diagnostic suite',()=>{
  const tests=[entry('parallel/test-known_issues.js'),entry('not_known_issues/test-a.js'),entry('parallel/known_issues/test-a.js'),entry('parallel/test-internet.js')];
  assert.deepEqual(positiveNodeTests(root,tests),tests);
});

test('diagnostics never execute and positive entry identity/order is preserved',()=>{
  let count=0;
  const first={...entry('parallel/test-a.js'),run(){count++;}};
  const diagnostic={...entry('known_issues/test-b.js'),run(){throw Error('diagnostic must not execute');}};
  const second={...entry('sequential/test-c.js'),run(){count++;}};
  const selected=positiveNodeTests(root,[first,diagnostic,second]);
  assert.deepEqual(selected,[first,second]);
  for(const item of selected)item.run();
  assert.equal(count,2);
  assert.equal(selected[0],first);
});
