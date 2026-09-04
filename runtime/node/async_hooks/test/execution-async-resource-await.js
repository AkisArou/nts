'use strict';

// Focused applicable coverage from Node v24.20.0
// test-async-hooks-execution-async-resource-await.js. The upstream setup uses
// util.promisify(setTimeout), whose custom function property is a §13
// non-goal. This spells the same delay without function metadata.

const common = require('../common');
const assert = require('assert');
const { executionAsyncResource, createHook } = require('async_hooks');
const { createServer, get } = require('http');
const sym = Symbol('cls');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

assert.ok(executionAsyncResource());

createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    const current = executionAsyncResource();
    resource[sym] = current[sym];
  },
}).enable();

async function handler(req, res) {
  executionAsyncResource()[sym] = { state: req.url };
  await sleep(10);
  const { state } = executionAsyncResource()[sym];
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ state }));
}

const server = createServer((req, res) => {
  handler(req, res);
});

function request(n) {
  get(`http://localhost:${server.address().port}/${n}`, common.mustCall((res) => {
    res.setEncoding('utf8');
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', common.mustCall(() => {
      assert.deepStrictEqual(JSON.parse(body), { state: `/${n}` });
    }));
  }));
}

server.listen(0, common.mustCall(() => {
  server.unref();
  for (let i = 0; i < 10; i++) request(i);
}));
