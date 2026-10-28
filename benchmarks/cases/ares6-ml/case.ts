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

// Adapter for WebKit ARES-6 ML, revision b64265f153b3178bfb4ca9f51736289f57982fce.
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/ml/benchmark.js
// Shared notices and provenance exclusions: ../LICENSE-ares6.

import { MLBenchmark } from "./benchmark.ts";
import type { WorkloadName } from "./benchmark.ts";
import type { FeedForwardNeuralNetworks, Label, NetworkModel } from "./neural-network.ts";
import { FeedforwardNeuralNetworksActivationFunctions } from "./neural-network.ts";
import { resetRandom } from "./random.ts";

export const originalActivationCount = Object.keys(FeedforwardNeuralNetworksActivationFunctions).length;
export const seed = 1;

export interface Observation {
    name: WorkloadName;
    activation: string;
    model: NetworkModel;
    predictions: Label[];
    probabilities: number[][];
}

// n is the outer activation-sweep count, not an input/network/training size.
// Every selected activation executes all five original complete training cases.
// The original library used Math.random, and JetStream did not enable its
// deterministicRandom flag for ML. The local fixed RNG is a checksum adapter.
export function render(n: number): Observation[] {
    resetRandom();
    let observations: Observation[] = [];
    new MLBenchmark().runIteration(n, (name, activation, network, predictions) => {
        observations.push({name, activation, model: network.toJSON(), predictions,
            probabilities: network.predictionProbabilities!.to2DArray()});
    });
    return observations;
}

export function renderOriginal(): Observation[] { return render(originalActivationCount); }

export function work(n: number): number {
    resetRandom();
    let checksum = 0;
    // Hash actual weights, biases, probabilities and predictions at six decimal
    // places. Only this observation adapter rounds: training stays unchanged.
    // The integer result tolerates insignificant Math.exp/tanh engine variation.
    function add(value: number): void { checksum = (checksum * 31 + Math.round(value * 1e6)) >>> 0; }
    function observe(_name: WorkloadName, _activation: string, network: FeedForwardNeuralNetworks, predictions: Label[]): void {
        for (let layer of network.model) {
            for (let i = 0; i < layer.W.rows; ++i)
                for (let j = 0; j < layer.W.columns; ++j) add(layer.W.get(i, j));
            for (let i = 0; i < layer.b.rows; ++i)
                for (let j = 0; j < layer.b.columns; ++j) add(layer.b.get(i, j));
        }
        let probabilities = network.predictionProbabilities!;
        for (let i = 0; i < probabilities.rows; ++i)
            for (let j = 0; j < probabilities.columns; ++j) add(probabilities.get(i, j));
        for (let label of predictions) {
            if (typeof label === 'number') add(label);
            else if (typeof label === 'boolean') add(+label);
            else if (Array.isArray(label)) for (let value of label) add(value);
            else for (let i = 0; i < label.length; ++i) add(label.charCodeAt(i));
        }
    }
    new MLBenchmark().runIteration(n, observe);
    return checksum;
}
