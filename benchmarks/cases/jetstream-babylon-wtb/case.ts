// Copyright 2017 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as babylon from "./parser.ts";

import { fileData } from "./sources.ts";

const payloads: Array<{name: string; options: Partial<babylon.ParserOptions>}> = [
  {
    name: "jquery-3.7.1.js",
    options: { sourceType: "script" },
  },
  {
    name: "lodash.core-4.17.21.js",
    options: { sourceType: "script" },
  },
  {
    name: "preact-8.2.5.js",
    options: { sourceType: "script" },
  },
  {
    name: "redux-5.0.1.min.js",
    options: { sourceType: "module", plugins: ["objectRestSpread"] },
  },
  {
    name: "speedometer-es2015-test-2.0.js",
    options: { sourceType: "script" },
  },
  {
    name: "todomvc/react/app.jsx",
    options: { sourceType: "script", plugins: ["jsx"] },
  },
  {
    name: "todomvc/react/footer.jsx",
    options: { sourceType: "script", plugins: ["jsx"] },
  },
  {
    name: "todomvc/react/todoItem.jsx",
    options: { sourceType: "script", plugins: ["jsx"] },
  },
  {
    name: "underscore-1.13.7.js",
    options: { sourceType: "script" },
  },
  {
    name: "vue-3.5.18.runtime.esm-browser.js",
    options: { sourceType: "module" },
  },
];

export function runTest(fileData: Record<string, string>): babylon.Node[] {
  const testData = payloads.map(({ name, options }) => ({
    payload: fileData[name],
    name,
    options,
  }));

  return testData.map(({ payload, name, options }) => {
    return babylon.parse(payload, options);
  });
}


// Observe the completed root of every original parse; n repeats all ten inputs.
export function work(n: number): number {
  let checksum = 0;
  for (let iteration = 0; iteration < n; iteration++) {
    for (const ast of runTest(fileData)) checksum = (checksum * 31 + ast.end) >>> 0;
  }
  return checksum;
}

export function render(n: number = 1): babylon.Node[] {
  let result: babylon.Node[] = [];
  for (let iteration = 0; iteration < n; iteration++) result = runTest(fileData);
  return result;
}

export function validationResults(): Array<{name: string; input: string; ast: babylon.Node}> {
  return payloads.map(({name, options}) => ({name, input: fileData[name], ast: babylon.parse(fileData[name], options)}));
}

export const seed = 1;

// Untimed grammar fixtures also cover the retained Flow, TypeScript and ESTree plugins.
export function parseValidation(input: string, plugins: string[]): babylon.Node {
  return babylon.parse(input, {plugins});
}
