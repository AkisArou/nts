'use strict';

const { AsyncResource, createHook } = require('async_hooks');

const hookName = process.env.NTS_FATAL_HOOK;
const thrownValue = process.env.NTS_FATAL_VALUE === 'symbol' ? Symbol('foo') : null;
const fail = () => { throw thrownValue; };

switch (hookName) {
  case 'init':
    createHook({ init: fail }).enable();
    new AsyncResource('fatal-test');
    break;
  case 'before': {
    createHook({ before: fail }).enable();
    const resource = new AsyncResource('fatal-test');
    resource.runInAsyncScope(() => {});
    break;
  }
  case 'after': {
    createHook({ after: fail }).enable();
    const resource = new AsyncResource('fatal-test');
    resource.runInAsyncScope(() => {});
    break;
  }
  case 'destroy': {
    createHook({ destroy: fail }).enable();
    const resource = new AsyncResource('fatal-test', { requireManualDestroy: true });
    resource.emitDestroy();
    break;
  }
  case 'promiseResolve':
    createHook({ promiseResolve: fail }).enable();
    Promise.resolve();
    break;
  default:
    throw new Error(`unknown hook ${hookName}`);
}
