/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/noble-benchmark.js

import { runNobleBenchmark } from './benchmark.ts';
import type { BenchmarkResult } from './benchmark.ts';
import { resetRandom } from './web-crypto-sham.ts';

export const seed = 1;

export class Benchmark {
  async runIteration(): Promise<BenchmarkResult> {
    return await runNobleBenchmark();
  }
}

const benchmark = new Benchmark();

function observe(result: BenchmarkResult): number {
  let checksum = Number(result.pairing.c0.c0.c0.value & 0xffff_ffffn);
  checksum = (Math.imul(checksum, 16777619) ^ result.publicKey[0]) >>> 0;
  checksum = (Math.imul(checksum, 16777619) ^ Number(result.signature.x.c0.value & 0xffff_ffffn)) >>> 0;
  checksum = (Math.imul(checksum, 16777619) ^ Number(result.verified)) >>> 0;
  checksum = (Math.imul(checksum, 16777619) ^ Number(result.aggregatePublicKey.x.value & 0xffff_ffffn)) >>> 0;
  checksum = (Math.imul(checksum, 16777619) ^ Number(result.aggregateSignature.x.c0.value & 0xffff_ffffn)) >>> 0;
  checksum = (Math.imul(checksum, 16777619) ^ Number(result.hashG1.x.value & 0xffff_ffffn)) >>> 0;
  checksum = (Math.imul(checksum, 16777619) ^ Number(result.hashG2.x.c0.value & 0xffff_ffffn)) >>> 0;
  return checksum;
}

export async function work(n: number): Promise<number> {
  let checksum = 0;
  for (let i = 0; i < n; i++) {
    resetRandom();
    checksum = (Math.imul(checksum, 16777619) ^ observe(await benchmark.runIteration())) >>> 0;
  }
  return checksum;
}
