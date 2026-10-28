// Copyright 2017 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as esprima from "./esprima.ts";

import {fileData} from "./sources.ts";

const payloads = [
  "backbone-1.6.1.js",
  "jquery-3.7.1.js",
  "mootools-core-1.6.0.js",
  "underscore-1.13.7.js",
];

export function runTest(fileData: Record<string, string>): number[] {
  const testData = payloads.map((name) => fileData[name]);

  return testData.map((payload) => {
    let count = 0;
    count += esprima.tokenize(payload, { loc: true, range: true }).length;
    count += esprima.parse(payload, { loc: true, range: true }).body.length;
    return count;
  });
}


export function work(n: number): number {
  let checksum = 0;
  for (let iteration = 0; iteration < n; iteration++) {
    for (const count of runTest(fileData)) checksum = (checksum * 31 + count) >>> 0;
  }
  return checksum;
}
export function render(n: number = 1): number[] {
  let result: number[] = [];
  for (let iteration = 0; iteration < n; iteration++) result = runTest(fileData);
  return result;
}
export function validationResults(): Array<{name: string; input: string; ast: unknown; tokens: unknown[]}> {
  return payloads.map(name => ({name, input: fileData[name], ast: esprima.parse(fileData[name], {loc:true,range:true}), tokens: esprima.tokenize(fileData[name], {loc:true,range:true})}));
}
export function parseValidation(input: string): unknown {
  return esprima.parse(input, {loc:true, range:true, tokens:true, comment:true, jsx:true});
}
export const seed = 1;

// The bundled visitor is retained; this observation runs only in correctness checks.
export function visitorValidation(): boolean[] {
  return payloads.map(name => {
    const ast = esprima.parse(fileData[name], {loc: true, range: true});
    return new esprima.Visitor().visit(ast) === ast;
  });
}
