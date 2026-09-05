'use strict';

// Statically representable behavior retained from pinned Node v24.20.0
// parallel/test-readline-interface.js. That broad fixture also calls the
// exported class without `new` and discovers a dynamic
// `util.promisify.custom` Symbol hook on a prototype method.
const common = require('../common');
const assert = require('assert');
const { PassThrough } = require('stream');
const readline = require('readline');
const readlinePromises = require('readline/promises');

const lineInput = new PassThrough();
const lineOutput = new PassThrough();
const lineInterface = new readline.Interface({
  input: lineInput,
  output: lineOutput,
  terminal: false,
});
assert(lineInterface instanceof readline.Interface);

const lines = [];
lineInterface.on('line', (line) => lines.push(line));
lineInterface.on('close', common.mustCall(() => {
  assert.deepStrictEqual(lines, ['one', 'two', 'last']);
}));
lineInput.end('one\r\ntwo\nlast');

const positionalInput = new PassThrough();
const positionalOutput = new PassThrough();
const positional = readline.createInterface(
  positionalInput,
  positionalOutput,
  undefined,
  false,
);
positional.on('line', common.mustCall((line) => {
  assert.strictEqual(line, 'positional');
  positional.close();
}));
positionalInput.write('positional\n');

const questionInput = new PassThrough();
const questionOutput = new PassThrough();
let questionPrompt = '';
questionOutput.setEncoding('utf8');
questionOutput.on('data', (chunk) => { questionPrompt += chunk; });
const questionInterface = readline.createInterface({
  input: questionInput,
  output: questionOutput,
  terminal: false,
});
questionInterface.question('name? ', common.mustCall((answer) => {
  assert.strictEqual(answer, 'Ada');
  assert.strictEqual(questionPrompt, 'name? ');
  questionInterface.close();
}));
questionInput.write('Ada\n');

const promiseInput = new PassThrough();
const promiseOutput = new PassThrough();
const promiseInterface = readlinePromises.createInterface({
  input: promiseInput,
  output: promiseOutput,
  terminal: false,
});
promiseInterface.question('language? ').then(common.mustCall((answer) => {
  assert.strictEqual(answer, 'TypeScript');
  promiseInterface.close();
}));
promiseInput.write('TypeScript\n');
