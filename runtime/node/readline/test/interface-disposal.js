'use strict';

const common = require('../common');
const readline = require('readline');
const readlinePromises = require('readline/promises');
const { PassThrough } = require('stream');

function makeOptions() {
  return {
    input: new PassThrough(),
    output: new PassThrough(),
    terminal: false,
  };
}

const callbackInterface = readline.createInterface(makeOptions());
callbackInterface.once('close', common.mustCall());
callbackInterface[Symbol.dispose]();
callbackInterface[Symbol.dispose]();

const promiseInterface = readlinePromises.createInterface(makeOptions());
promiseInterface.once('close', common.mustCall());
promiseInterface[Symbol.dispose]();
promiseInterface[Symbol.dispose]();
