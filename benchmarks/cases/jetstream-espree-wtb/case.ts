// Copyright 2017 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as espree from "./espree.ts";

import {fileData} from "./sources.ts";
import {nodeArray} from "./acorn.ts";

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
    count += espree.tokenize(payload, { loc: true, range: true }).length;
    count += nodeArray(espree.parse(payload, { loc: true, range: true }).body).length;
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
  return payloads.map(name => ({name, input: fileData[name], ast: espree.parse(fileData[name], {loc:true,range:true}), tokens: espree.tokenize(fileData[name], {loc:true,range:true})}));
}
export function parseValidation(input: string): unknown {
  return espree.parse(input, {ecmaVersion: "latest", loc:true, range:true, tokens:true, comment:true, ecmaFeatures:{jsx:true}});
}
export const seed = 1;
