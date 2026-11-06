/*
 * The MIT License (MIT)
 * 
 * Copyright (c) 2015 ml.js
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
*/
'use strict';


// Original module blocks below are unchanged after type erasure.
import { Matrix as MLMatrix } from "./matrix.ts";
import type { Matrix } from "./matrix.ts";
export type Label = boolean | number | string | number[];
export interface LabelDictionaries<T extends Label = Label> { inputs: Record<string, number>; outputs: Record<string, T>; }
export interface Activation { activation(val: number, param?: number): number; derivate(val: number, param?: number): number; }
export interface LayerOptions {
    inputSize: number;
    outputSize: number;
    regularization: number;
    epsilon: number;
    activation: string;
    activationParam?: number;
    model?: undefined;
}
export interface LayerModel {
    model: 'Layer';
    inputSize: number;
    outputSize: number;
    regularization: number;
    epsilon: number;
    activation: string;
    activationParam?: number;
    W: Matrix | number[][];
    b: Matrix | number[][];
}
export interface NetworkOptions {
    model?: undefined;
    hiddenLayers?: number[];
    iterations?: number;
    learningRate?: number;
    regularization?: number;
    activation?: string;
    activationParam?: number;
}
export interface NetworkModel<T extends Label = Label> {
    model: 'FNN';
    hiddenLayers: number[];
    iterations: number;
    learningRate: number;
    regularization: number;
    activation: string;
    activationParam?: number;
    dicts: LabelDictionaries<T>;
    layers: LayerModel[];
}

export type BuiltNetwork<T extends Label = Label> = FeedForwardNeuralNetworks<T> & { model: Layer[] };
export type TrainedNetwork<T extends Label = Label> = BuiltNetwork<T> & { dicts: LabelDictionaries<T> };
export type ForwardedLayer = Layer & { a: Matrix };
export type ForwardedNetwork<T extends Label = Label> = TrainedNetwork<T> & { model: ForwardedLayer[] };
export type DifferentiatedLayer = Layer & { dW: Matrix; db: Matrix };





export interface Layer {

    inputSize: number;
    outputSize: number;
    regularization: number;
    epsilon: number;
    activation: string;
    activationParam?: number;
    activationFunction: (this: Matrix, i: number, j: number) => void;
    derivate: (this: Matrix, i: number, j: number) => void;
    W: Matrix;
    b: Matrix;
    a?: Matrix;
    dW?: Matrix;
    db?: Matrix;
        /**
         * @private
         * Create a new layer with the given options
         * @param {object} options
         * @param {number} [options.inputSize] - Number of conections that enter the neurons.
         * @param {number} [options.outputSize] - Number of conections that leave the neurons.
         * @param {number} [options.regularization] - Regularization parameter.
         * @param {number} [options.epsilon] - Learning rate parameter.
         * @param {string} [options.activation] - Activation function parameter from the FeedForwardNeuralNetwork class.
         * @param {number} [options.activationParam] - Activation parameter if needed.
         */
        forward(X: Matrix): Matrix;
backpropagation(delta: Matrix, a: Matrix): Matrix;
update(this: DifferentiatedLayer): void;
toJSON(): LayerModel;
}

export interface OutputLayer extends Layer {

        
}

export interface FeedForwardNeuralNetworks<T extends Label = Label> {

    hiddenLayers: number[];
    iterations: number;
    learningRate: number;
    regularization: number;
    activation: string;
    activationParam?: number;
    dicts?: LabelDictionaries<T>;
    model?: Layer[];

        /**
         * Create a new Feedforword neural network model.
         * @param {object} options
         * @param {Array} [options.hiddenLayers=[10]] - Array that contains the sizes of the hidden layers.
         * @oaram {number} [options.iterations=50] - Number of iterations at the training step.
         * @param {number} [options.learningRate=0.01] - Learning rate of the neural net (also known as epsilon).
         * @poram {number} [options.regularization=0.01] - Regularization parameter af the neural net.
         * @poram {string} [options.activation='tanh'] - activation function to be used. (options: 'tanh'(default),
         * 'identity', 'logistic', 'arctan', 'softsign', 'relu', 'softplus', 'bent', 'sinusoid', 'sinc', 'gaussian').
         * (single-parametric options: 'parametric-relu', 'exponential-relu', 'soft-exponential').
         * @param {number} [options.activationParam=1] - if the selected activation function needs a parameter.
         */
        buildNetwork(inputSize: number, outputSize: number): asserts this is this & { model: Layer[] };
train(features: Matrix | number[][], labels: T[]): asserts this is this & { model: Layer[]; dicts: LabelDictionaries<T> };
propagate(this: BuiltNetwork<T>, X: Matrix): Matrix;
backpropagation(this: ForwardedNetwork<T>, features: Matrix, labels: T[], probabilities: Matrix): void;
predict(this: TrainedNetwork<T>, features: Matrix | number[][]): T[];
toJSON(this: TrainedNetwork<T>): NetworkModel<T>;
}
interface NetworkUtils {
 dictOutputs<T extends Label>(array: T[]): LabelDictionaries<T>;
 sumCol(matrix: Matrix): Matrix; sumRow(matrix: Matrix): Matrix;
}
interface LayerConstructor { new(options: LayerOptions | LayerModel): Layer; load(model: LayerModel): Layer; }
interface NetworkConstructor {
 new<T extends Label = Label>(options?: NetworkOptions | NetworkModel<T>): FeedForwardNeuralNetworks<T>;
 load<T extends Label>(model: NetworkModel<T>): TrainedNetwork<T>;
}

// feedforward-neural-networks utils.js
let FeedforwardNeuralNetworksUtils: NetworkUtils;
{
    let Matrix = MLMatrix;

    /**
     * @private
     * Retrieves the sum at each row of the given matrix.
     * @param {Matrix} matrix
     * @return {Matrix}
     */
    function sumRow(matrix: Matrix): Matrix {
        var sum = Matrix.zeros(matrix.rows, 1);
        for (var i = 0; i < matrix.rows; ++i) {
            for (var j = 0; j < matrix.columns; ++j) {
                sum[i][0] += matrix[i][j];
            }
        }
        return sum;
    }

    /**
     * @private
     * Retrieves the sum at each column of the given matrix.
     * @param {Matrix} matrix
     * @return {Matrix}
     */
    function sumCol(matrix: Matrix): Matrix {
        var sum = Matrix.zeros(1, matrix.columns);
        for (var i = 0; i < matrix.rows; ++i) {
            for (var j = 0; j < matrix.columns; ++j) {
                sum[0][j] += matrix[i][j];
            }
        }
        return sum;
    }

    /**
     * @private
     * Method that given an array of labels(predictions), returns two dictionaries, one to transform from labels to
     * numbers and other in the reverse way
     * @param {Array} array
     * @return {object}
     */
    function dictOutputs<T extends Label>(array: T[]): LabelDictionaries<T> {
        var inputs: Record<string, number> = {}, outputs: Record<string, T> = {}, l = array.length, index = 0;
        for (var i = 0; i < l; i += 1) {
            // @ts-expect-error upstream coerces arbitrary label values to object property keys here.
            if (inputs[array[i]] === undefined) {
                // @ts-expect-error upstream coerces arbitrary label values to object property keys here.
                inputs[array[i]] = index;
                outputs[index] = array[i];
                index++;
            }
        }

        return {
            inputs: inputs,
            outputs: outputs
        };
    }

    FeedforwardNeuralNetworksUtils = {
        dictOutputs: dictOutputs,
        sumCol: sumCol,
        sumRow: sumRow
    };
}

// feedforward-neural-networks activationFunctions.js
let FeedforwardNeuralNetworksActivationFunctions: Partial<Record<string, Activation>>;
{
    function logistic(val: number): number {
        return 1 / (1 + Math.exp(-val));
    }

    function expELU(val: number, param?: number): number {
        // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
        return val < 0 ? param * (Math.exp(val) - 1) : val;
    }

    function softExponential(val: number, param?: number): number {
        // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
        if (param < 0) {
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            return -Math.log(1 - param * (val + param)) / param;
        }
        // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
        if (param > 0) {
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            return ((Math.exp(param * val) - 1) / param) + param;
        }
        return val;
    }

    function softExponentialPrime(val: number, param?: number): number {
        // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
        if (param < 0) {
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            return 1 / (1 - param * (param + val));
        } else {
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            return Math.exp(param * val);
        }
    }

    const ACTIVATION_FUNCTIONS: Partial<Record<string, Activation>> = {
        'tanh': {
            activation: Math.tanh,
            derivate: val => 1 - (val * val)
        },
        'identity': {
            activation: val => val,
            derivate: () => 1
        },
        'logistic': {
            activation: logistic,
            derivate: val => logistic(val) * (1 - logistic(val))
        },
        'arctan': {
            activation: Math.atan,
            derivate: val => 1 / (val * val + 1)
        },
        'softsign': {
            activation: val => val / (1 + Math.abs(val)),
            derivate: val => 1 / ((1 + Math.abs(val)) * (1 + Math.abs(val)))
        },
        'relu': {
            activation: val => val < 0 ? 0 : val,
            derivate: val => val < 0 ? 0 : 1
        },
        'softplus': {
            activation: val => Math.log(1 + Math.exp(val)),
            derivate: val => 1 / (1 + Math.exp(-val))
        },
        'bent': {
            activation: val => ((Math.sqrt(val * val + 1) - 1) / 2) + val,
            derivate: val => (val / (2 * Math.sqrt(val * val + 1))) + 1
        },
        'sinusoid': {
            activation: Math.sin,
            derivate: Math.cos
        },
        'sinc': {
            activation: val => val === 0 ? 1 : Math.sin(val) / val,
            derivate: val => val === 0 ? 0 : (Math.cos(val) / val) - (Math.sin(val) / (val * val))
        },
        'gaussian': {
            activation: val => Math.exp(-(val * val)),
            derivate: val => -2 * val * Math.exp(-(val * val))
        },
        'parametric-relu': {
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            activation: (val, param) => val < 0 ? param * val : val,
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            derivate: (val, param) => val < 0 ? param : 1
        },
        'exponential-elu': {
            activation: expELU,
            // @ts-expect-error upstream permits an omitted parameter here; arithmetic keeps JavaScript coercion to NaN.
            derivate: (val, param) => val < 0 ? expELU(val, param) + param : 1
        },
        'soft-exponential': {
            activation: softExponential,
            derivate: softExponentialPrime
        }
    };

    FeedforwardNeuralNetworksActivationFunctions = ACTIVATION_FUNCTIONS;
}

// feedforward-neural-networks Layer.js
let FeedforwardNeuralNetworksLayer: LayerConstructor;
{
    let Matrix = MLMatrix;

    let Utils = FeedforwardNeuralNetworksUtils;
    const ACTIVATION_FUNCTIONS = FeedforwardNeuralNetworksActivationFunctions;

    class Layer {
    declare inputSize: number;
    declare outputSize: number;
    declare regularization: number;
    declare epsilon: number;
    declare activation: string;
    declare activationParam?: number;
    declare activationFunction: (this: Matrix, i: number, j: number) => void;
    declare derivate: (this: Matrix, i: number, j: number) => void;
    declare W: Matrix;
    declare b: Matrix;
    declare a?: Matrix;
    declare dW?: Matrix;
    declare db?: Matrix;
        /**
         * @private
         * Create a new layer with the given options
         * @param {object} options
         * @param {number} [options.inputSize] - Number of conections that enter the neurons.
         * @param {number} [options.outputSize] - Number of conections that leave the neurons.
         * @param {number} [options.regularization] - Regularization parameter.
         * @param {number} [options.epsilon] - Learning rate parameter.
         * @param {string} [options.activation] - Activation function parameter from the FeedForwardNeuralNetwork class.
         * @param {number} [options.activationParam] - Activation parameter if needed.
         */
        constructor(options: LayerOptions | LayerModel) {
            this.inputSize = options.inputSize;
            this.outputSize = options.outputSize;
            this.regularization = options.regularization;
            this.epsilon = options.epsilon;
            this.activation = options.activation;
            this.activationParam = options.activationParam;

            var selectedFunction = ACTIVATION_FUNCTIONS[options.activation];
            // @ts-expect-error upstream throws TypeError when the activation name is absent.
            var params = selectedFunction.activation.length;

            var actFunction = params > 1 ? (val: number) => (selectedFunction as Activation).activation(val, options.activationParam) : (selectedFunction as Activation).activation;
            var derFunction = params > 1 ? (val: number) => (selectedFunction as Activation).derivate(val, options.activationParam) : (selectedFunction as Activation).derivate;

            this.activationFunction = function (this: Matrix, i: number, j: number) {
                this[i][j] = actFunction(this[i][j]);
            };
            this.derivate = function (this: Matrix, i: number, j: number) {
                this[i][j] = derFunction(this[i][j]);
            };

            if (options.model) {
                // load model
                this.W = Matrix.checkMatrix(options.W);
                this.b = Matrix.checkMatrix(options.b);

            } else {
                // default constructor

                this.W = Matrix.rand(this.inputSize, this.outputSize);
                this.b = Matrix.zeros(1, this.outputSize);

                this.W.apply(function (this: Matrix, i: number, j: number) {
                    this[i][j] /= Math.sqrt(options.inputSize);
                });
            }
        }

        /**
         * @private
         * propagate the given input through the current layer.
         * @param {Matrix} X - input.
         * @return {Matrix} output at the current layer.
         */
        forward(X: Matrix): Matrix {
            var z = X.mmul(this.W).addRowVector(this.b);
            z.apply(this.activationFunction);
            this.a = z.clone();
            return z;
        }

        /**
         * @private
         * apply backpropagation algorithm at the current layer
         * @param {Matrix} delta - delta values estimated at the following layer.
         * @param {Matrix} a - 'a' values from the following layer.
         * @return {Matrix} the new delta values for the next layer.
         */
        backpropagation(delta: Matrix, a: Matrix): Matrix {
            this.dW = a.transposeView().mmul(delta);
            this.db = Utils.sumCol(delta);

            var aCopy = a.clone();
            return delta.mmul(this.W.transposeView()).mul(aCopy.apply(this.derivate));
        }

        /**
         * @private
         * Function that updates the weights at the current layer with the derivatives.
         */
        update(this: DifferentiatedLayer): void {
            this.dW.add(this.W.clone().mul(this.regularization));
            this.W.add(this.dW.mul(-this.epsilon));
            this.b.add(this.db.mul(-this.epsilon));
        }

        /**
         * @private
         * Export the current layer to JSON.
         * @return {object} model
         */
        toJSON(): LayerModel {
            return {
                model: 'Layer',
                inputSize: this.inputSize,
                outputSize: this.outputSize,
                regularization: this.regularization,
                epsilon: this.epsilon,
                activation: this.activation,
                W: this.W,
                b: this.b
            };
        }

        /**
         * @private
         * Creates a new Layer with the given model.
         * @param {object} model
         * @return {Layer}
         */
        static load(model: LayerModel): Layer {
            if (model.model !== 'Layer') {
                throw new RangeError('the current model is not a Layer model');
            }
            return new Layer(model);
        }

    }

    FeedforwardNeuralNetworksLayer = Layer;
}

// feedforward-neural-networks OutputLayer.js
let FeedforwardNeuralNetworksOutputLayer: LayerConstructor;
{
    let Layer = FeedforwardNeuralNetworksLayer;

    class OutputLayer extends Layer {
        constructor(options: LayerOptions | LayerModel) {
            super(options);

            this.activationFunction = function (this: Matrix, i: number, j: number) {
                this[i][j] = Math.exp(this[i][j]);
            };
        }

        static load(model: LayerModel): OutputLayer {
            if (model.model !== 'Layer') {
                throw new RangeError('the current model is not a Layer model');
            }

            return new OutputLayer(model);
        }
    }

    FeedforwardNeuralNetworksOutputLayer = OutputLayer;
}

// feedforward-neural-networks FeedForwardNeuralNetwork.js
let FeedforwardNeuralNetwork: NetworkConstructor;
{
    const Matrix = MLMatrix;

    const Layer = FeedforwardNeuralNetworksLayer;
    const OutputLayer = FeedforwardNeuralNetworksOutputLayer;
    const Utils = FeedforwardNeuralNetworksUtils;
    const ACTIVATION_FUNCTIONS = FeedforwardNeuralNetworksActivationFunctions;

    class FeedForwardNeuralNetworks<T extends Label = Label> {
    declare hiddenLayers: number[];
    declare iterations: number;
    declare learningRate: number;
    declare regularization: number;
    declare activation: string;
    declare activationParam?: number;
    declare dicts?: LabelDictionaries<T>;
    declare model?: Layer[];

        /**
         * Create a new Feedforword neural network model.
         * @param {object} options
         * @param {Array} [options.hiddenLayers=[10]] - Array that contains the sizes of the hidden layers.
         * @oaram {number} [options.iterations=50] - Number of iterations at the training step.
         * @param {number} [options.learningRate=0.01] - Learning rate of the neural net (also known as epsilon).
         * @poram {number} [options.regularization=0.01] - Regularization parameter af the neural net.
         * @poram {string} [options.activation='tanh'] - activation function to be used. (options: 'tanh'(default),
         * 'identity', 'logistic', 'arctan', 'softsign', 'relu', 'softplus', 'bent', 'sinusoid', 'sinc', 'gaussian').
         * (single-parametric options: 'parametric-relu', 'exponential-relu', 'soft-exponential').
         * @param {number} [options.activationParam=1] - if the selected activation function needs a parameter.
         */
        constructor(options?: NetworkOptions | NetworkModel<T>) {
            options = options || {};
            if (options.model) {
                // load network
                this.hiddenLayers = options.hiddenLayers;
                this.iterations = options.iterations;
                this.learningRate = options.learningRate;
                this.regularization = options.regularization;
                this.dicts = options.dicts;
                this.activation = options.activation;
                this.activationParam = options.activationParam;
                this.model = new Array(options.layers.length);

                for (var i = 0; i < this.model.length - 1; ++i) {
                    this.model[i] = Layer.load(options.layers[i]);
                }
                this.model[this.model.length - 1] = OutputLayer.load(options.layers[this.model.length - 1]);
            } else {
                // default constructor
                this.hiddenLayers = options.hiddenLayers === undefined ? [10] : options.hiddenLayers;
                this.iterations = options.iterations === undefined ? 50 : options.iterations;

                this.learningRate = options.learningRate === undefined ? 0.01 : options.learningRate;
                //this.momentum = options.momentum === undefined ? 0.1 : options.momentum;
                this.regularization = options.regularization === undefined ? 0.01 : options.regularization;

                this.activation = options.activation === undefined ? 'tanh' : options.activation;
                this.activationParam = options.activationParam === undefined ? 1 : options.activationParam;
                if (!(this.activation in Object.keys(ACTIVATION_FUNCTIONS))) {
                    this.activation = 'tanh';
                }
            }
        }

        /**
         * @private
         * Function that build and initialize the neural net.
         * @param {number} inputSize - total of features to fit.
         * @param {number} outputSize - total of labels of the prediction set.
         */
        buildNetwork(inputSize: number, outputSize: number): asserts this is this & { model: Layer[] } {
            var size = 2 + (this.hiddenLayers.length - 1);
            this.model = new Array(size);

            // input layer
            this.model[0] = new Layer({
                inputSize: inputSize,
                outputSize: this.hiddenLayers[0],
                activation: this.activation,
                activationParam: this.activationParam,
                regularization: this.regularization,
                epsilon: this.learningRate
            });

            // hidden layers
            for (var i = 1; i < this.hiddenLayers.length; ++i) {
                this.model[i] = new Layer({
                    inputSize: this.hiddenLayers[i - 1],
                    outputSize: this.hiddenLayers[i],
                    activation: this.activation,
                    activationParam: this.activationParam,
                    regularization: this.regularization,
                    epsilon: this.learningRate
                });
            }

            // output layer
            this.model[size - 1] = new OutputLayer({
                inputSize: this.hiddenLayers[this.hiddenLayers.length - 1],
                outputSize: outputSize,
                activation: this.activation,
                activationParam: this.activationParam,
                regularization: this.regularization,
                epsilon: this.learningRate
            });
        }

        /**
         * Train the neural net with the given features and labels.
         * @param {Matrix|Array} features
         * @param {Matrix|Array} labels
         */
        train(features: Matrix | number[][], labels: T[]): asserts this is this & { model: Layer[]; dicts: LabelDictionaries<T> } {
            features = Matrix.checkMatrix(features);
            this.dicts = Utils.dictOutputs(labels);

            var inputSize = features.columns;
            var outputSize = Object.keys(this.dicts.inputs).length;

            this.buildNetwork(inputSize, outputSize);

            for (var i = 0; i < this.iterations; ++i) {
                var probabilities = this.propagate(features);
                // propagate has called forward on every layer before this read.
                (this as ForwardedNetwork<T>).backpropagation(features, labels, probabilities);
            }
        }

        /**
         * @private
         * Propagate the input(training set) and retrives the probabilities of each class.
         * @param {Matrix} X
         * @return {Matrix} probabilities of each class.
         */
        propagate(this: BuiltNetwork<T>, X: Matrix): Matrix {
            var input = X;
            for (var i = 0; i < this.model.length; ++i) {
                //console.log(i);
                input = this.model[i].forward(input);
            }

            // get probabilities
            return input.divColumnVector(Utils.sumRow(input));
        }

        /**
         * @private
         * Function that applies the backpropagation algorithm on each layer of the network
         * in order to fit the features and labels.
         * @param {Matrix} features
         * @param {Array} labels
         * @param {Matrix} probabilities - probabilities of each class of the feature set.
         */
        backpropagation(this: ForwardedNetwork<T>, features: Matrix, labels: T[], probabilities: Matrix): void {
            for (var i = 0; i < probabilities.length; ++i) {
                // @ts-expect-error upstream coerces arbitrary label values to object property keys here.
                probabilities[i][this.dicts.inputs[labels[i]]] -= 1;
            }

            // remember, the last delta doesn't matter
            var delta = probabilities;
            for (i = this.model.length - 1; i >= 0; --i) {
                var a = i > 0 ? this.model[i - 1].a : features;
                delta = this.model[i].backpropagation(delta, a);
            }

            for (i = 0; i < this.model.length; ++i) {
                // The preceding reverse loop assigned dW and db on every layer.
                (this.model[i] as DifferentiatedLayer).update();
            }
        }

        /**
         * Predict the output given the feature set.
         * @param {Array|Matrix} features
         * @return {Array}
         */
        predict(this: TrainedNetwork<T>, features: Matrix | number[][]): T[] {
            features = Matrix.checkMatrix(features);
            var outputs: T[] = new Array(features.rows);
            var probabilities = this.propagate(features);
            for (var i = 0; i < features.rows; ++i) {
                outputs[i] = this.dicts.outputs[probabilities.maxRowIndex(i)[1]];
            }

            return outputs;
        }

        /**
         * Export the current model to JSOM.
         * @return {object} model
         */
        toJSON(this: TrainedNetwork<T>): NetworkModel<T> {
            var model: NetworkModel<T> = {
                model: 'FNN',
                hiddenLayers: this.hiddenLayers,
                iterations: this.iterations,
                learningRate: this.learningRate,
                regularization: this.regularization,
                activation: this.activation,
                activationParam: this.activationParam,
                dicts: this.dicts,
                layers: new Array(this.model.length)
            };

            for (var i = 0; i < this.model.length; ++i) {
                model.layers[i] = this.model[i].toJSON();
            }

            return model;
        }

        /**
         * Load a Feedforward Neural Network with the current model.
         * @param {object} model
         * @return {FeedForwardNeuralNetworks}
         */
        static load<T extends Label>(model: NetworkModel<T>): TrainedNetwork<T> {
            if (model.model !== 'FNN') {
                throw new RangeError('the current model is not a feed forward network');
            }

            // The model branch initializes both dictionaries and all layers.
            return new FeedForwardNeuralNetworks(model) as TrainedNetwork<T>;
        }
    }

    FeedforwardNeuralNetwork = FeedForwardNeuralNetworks;
}

export { FeedforwardNeuralNetwork, FeedforwardNeuralNetworksUtils, FeedforwardNeuralNetworksActivationFunctions, FeedforwardNeuralNetworksLayer, FeedforwardNeuralNetworksOutputLayer };
