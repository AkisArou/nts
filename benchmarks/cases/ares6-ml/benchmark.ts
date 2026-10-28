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

"use strict";

// Transcribed from WebKit ARES-6, revision b64265f153b3178bfb4ca9f51736289f57982fce:
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/ml/benchmark.js
// All five original datasets, network widths, rates, iteration counts and
// assertions are unchanged. activationCount is only the outer sweep count.
// The source has fourteen activation names; full validation uses all fourteen.
import { Matrix } from "./matrix.ts";
import { FeedforwardNeuralNetwork, FeedforwardNeuralNetworksActivationFunctions, readNetworkModel } from "./neural-network.ts";
import type { Label, FeedForwardNeuralNetworks } from "./neural-network.ts";

export type WorkloadName = 'xor' | 'and' | 'or' | 'multiclass' | 'big';
export type Observer = (name: WorkloadName, activation: string, network: FeedForwardNeuralNetworks, predictions: Label[]) => void;

export class MLBenchmark {
    constructor() { }

    runIteration(activationCount: number, observe?: Observer): void
    {
        let MatrixClass = Matrix;
        let ACTIVATION_FUNCTIONS = FeedforwardNeuralNetworksActivationFunctions;

        function run() {
            
            let it = (name: string, f: () => void) => {
                f();
            };

            function assert(b: unknown): asserts b {
                if (!b)
                    throw new Error("Bad");
            }

            var functions = Object.keys(ACTIVATION_FUNCTIONS);

            it('Training the neural network with XOR operator', function () {
                var trainingSet = new MatrixClass([[0, 0], [0, 1], [1, 0], [1, 1]]);
                var predictions = [false, true, true, false];

                for (var i = 0; i < functions.length && i < activationCount; ++i) {
                    var options = {
                        hiddenLayers: [4],
                        iterations: 40,
                        learningRate: 0.3,
                        activation: functions[i]
                    };
                    var xorNN = new FeedforwardNeuralNetwork(options);

                    xorNN.train(trainingSet, predictions);
                    var results = xorNN.predict(trainingSet);
                    if (observe) observe('xor', functions[i], xorNN, results);
                }
            });

            it('Training the neural network with AND operator', function () {
                var trainingSet = [[0, 0], [0, 1], [1, 0], [1, 1]];
                var predictions = [[1, 0], [1, 0], [1, 0], [0, 1]];

                for (var i = 0; i < functions.length && i < activationCount; ++i) {
                    var options = {
                        hiddenLayers: [3],
                        iterations: 75,
                        learningRate: 0.3,
                        activation: functions[i]
                    };
                    var andNN = new FeedforwardNeuralNetwork(options);
                    andNN.train(trainingSet, predictions);

                    var results = andNN.predict(trainingSet);
                    if (observe) observe('and', functions[i], andNN, results);
                }
            });

            it('Export and import', function () {
                var trainingSet = [[0, 0], [0, 1], [1, 0], [1, 1]];
                var predictions = [0, 1, 1, 1];

                for (var i = 0; i < functions.length && i < activationCount; ++i) {
                    var options = {
                        hiddenLayers: [4],
                        iterations: 40,
                        learningRate: 0.3,
                        activation: functions[i]
                    };
                    var orNN = new FeedforwardNeuralNetwork(options);
                    orNN.train(trainingSet, predictions);

                    var model = readNetworkModel(JSON.parse(JSON.stringify(orNN)));
                    var networkNN = FeedforwardNeuralNetwork.load(model);

                    var results = networkNN.predict(trainingSet);
                    if (observe) observe('or', functions[i], networkNN, results);
                }
            });

            it('Multiclass clasification', function () {
                var trainingSet = [[0, 0], [0, 1], [1, 0], [1, 1]];
                var predictions = [2, 0, 1, 0];

                for (var i = 0; i < functions.length && i < activationCount; ++i) {
                    var options = {
                        hiddenLayers: [4],
                        iterations: 40,
                        learningRate: 0.5,
                        activation: functions[i]
                    };
                    var nn = new FeedforwardNeuralNetwork(options);
                    nn.train(trainingSet, predictions);

                    var result = nn.predict(trainingSet);
                    if (observe) observe('multiclass', functions[i], nn, result);
                }
            });

            it('Big case', function () {
                var trainingSet = [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [1, 3], [1, 4], [4, 1],
                                    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 5], [4, 5], [3, 5]];
                var predictions = [[1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0],
                                    [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]];
                for (var i = 0; i < functions.length && i < activationCount; ++i) {
                    var options = {
                        hiddenLayers: [20],
                        iterations: 60,
                        learningRate: 0.01,
                        activation: functions[i]
                    };
                    var nn = new FeedforwardNeuralNetwork(options);
                    nn.train(trainingSet, predictions);

                    var result = nn.predict([[5, 4]]);

                    // Original labels in this case are numeric arrays.
                    let label = result[0];
                    if (!Array.isArray(label)) throw new TypeError('Expected an array label');
                    assert(label[0] < label[1]);
                    if (observe) observe('big', functions[i], nn, result);
                }
            });
        }

        run();
    }
}
