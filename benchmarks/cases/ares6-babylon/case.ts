/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

// WebKit ARES-6 Babylon, revision b64265f153b3178bfb4ca9f51736289f57982fce.
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Babylon/benchmark.js
// Outer suite driver (200 repetitions):
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/babylon_benchmark.js
// The timed operation still parses all four full original fixed inputs, in
// order, with the original options. The external I/O/clock/reporting harness
// becomes embedded source strings and an opaque outer repetition count.
// Upstream's success criterion is completing all four parses without throwing.
// The checksum observes token counts and every top-level statement boundary;
// parseSources exposes complete ASTs for independent structural verification.

import { Node, Parser, preparePlugins } from "./parser.ts";
import type { ParserOptions } from "./parser.ts";
import { airSource, basicSource, inspectorSource, babylonSource } from "./sources.ts";

interface Source {
  file: string;
  text: string;
  options: Partial<ParserOptions>;
}

const sources: Source[] = [
  { file: "./Babylon/air-blob.js", text: airSource, options: {} },
  { file: "./Babylon/basic-blob.js", text: basicSource, options: {} },
  { file: "./Babylon/inspector-blob.js", text: inspectorSource, options: {} },
  { file: "./Babylon/babylon-blob.js", text: babylonSource, options: { sourceType: "module" } },
];

export function parse(input: string, options?: Partial<ParserOptions>): Node {
  return new Parser(options, input).parse();
}

export function parseExpression(input: string, options?: Partial<ParserOptions>): Node {
  const parser = new Parser(options, input);
  if (parser.options.strictMode) parser.state.strict = true;
  return parser.getExpression();
}

export function parseSources(): Node[] {
  preparePlugins();
  const result: Node[] = [];
  for (const source of sources) result.push(parse(source.text, source.options));
  return result;
}

export function sourceNames(): string[] {
  return sources.map(source => source.file);
}

function observe(ast: Node, hash: number): number {
  hash = (hash * 31 + ast.end) >>> 0;
  hash = (hash * 31 + ast.tokens.length) >>> 0;
  hash = (hash * 31 + ast.comments.length) >>> 0;
  const body = ast.program.body;
  if (!Array.isArray(body)) throw new Error("A parsed program must have a statement array");
  hash = (hash * 31 + body.length) >>> 0;
  for (const statement of body) {
    hash = (hash * 31 + statement.start) >>> 0;
    hash = (hash * 31 + statement.end) >>> 0;
  }
  return hash;
}

export function work(n: number): number {
  let hash = 0;
  for (let iteration = 0; iteration < n; iteration++) {
    preparePlugins();
    for (const source of sources) hash = observe(parse(source.text, source.options), hash);
  }
  return hash;
}

export const seed = 1;
