// Copyright 2017 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// JetStream 3.0 Lebab Web Tooling Benchmark driver, V8 project authors, BSD-3-Clause.
import {load} from "./vendor/lebab/index.ts";
import {preactSource} from "./sources.ts";
const lebab = load();
const payloads = [{name: "preact-8.2.5.js", options: [
  "arg-rest", "arg-spread", "arrow", "class", "for-of", "let", "template",
  "includes", "obj-method", "obj-shorthand"
]}];
export function runTest(fileData: Record<string, string>) {
  const testData = payloads.map(({name, options}) => ({payload: fileData[name], options}));
  return testData.map(({payload, options}) => lebab.transform(payload, options));
}
export const seed = 1;
export function work(n: number): number {
  let checksum = 0;
  for (let i = 0; i < n; i++) {
    const result = runTest({"preact-8.2.5.js": preactSource});
    const serialized = JSON.stringify(result);
    let hash = 2166136261;
    for (let j = 0; j < serialized.length; j++) hash = Math.imul(hash ^ serialized.charCodeAt(j), 16777619);
    checksum = (checksum + (hash >>> 0)) >>> 0;
  }
  return checksum;
}

// Full-output observer for deterministic correctness checks outside timing.
export function render(n: number): string {
  let result = "";
  for (let i = 0; i < n; i++) result = JSON.stringify(runTest({"preact-8.2.5.js": preactSource}));
  return result;
}
