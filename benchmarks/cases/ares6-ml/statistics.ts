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
// Transcribed from WebKit ARES-6 ml/index.js, revision b64265f153b3178bfb4ca9f51736289f57982fce.
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/ml/index.js
// Original MIT notice retained above; shared notices: ../LICENSE-ares6.
// Namespace assignment blocks become typed plain-object initializers. All
// statistical and resampling algorithms retain their original arithmetic.

export interface ScaleOptions { inPlace?: boolean; min?: number; max?: number }
export interface EquallySpacedOptions { from?: number; to?: number; numberOfPoints?: number; variant?: string }

// Upstream correlation/zScores pass a boolean in the means position. A
// property read on that boolean yields undefined; retain the resulting NaNs
// instead of repairing the source's argument order during transcription.
function meanEntry(values: number[] | boolean, index: number): number | undefined {
    return typeof values === 'boolean' ? undefined : values[index];
}


// ml-stat array.js
export const MLStatArray = (() => {
    function compareNumbers(a: number, b: number) : number {
        return a - b;
    }

    /**
     * Computes the sum of the given values
     * @param {Array} values
     * @returns {number}
     */
    function sum(values: number[]) : number {
        var sum = 0;
        for (var i = 0; i < values.length; i++) {
            sum += values[i];
        }
        return sum;
    }

    /**
     * Computes the maximum of the given values
     * @param {Array} values
     * @returns {number}
     */
    function max(values: number[]) : number {
        var max = values[0];
        var l = values.length;
        for (var i = 1; i < l; i++) {
            if (values[i] > max) max = values[i];
        }
        return max;
    }

    /**
     * Computes the minimum of the given values
     * @param {Array} values
     * @returns {number}
     */
    function min(values: number[]) : number {
        var min = values[0];
        var l = values.length;
        for (var i = 1; i < l; i++) {
            if (values[i] < min) min = values[i];
        }
        return min;
    }

    /**
     * Computes the min and max of the given values
     * @param {Array} values
     * @returns {{min: number, max: number}}
     */
    function minMax(values: number[]) : { min: number; max: number } {
        var min = values[0];
        var max = values[0];
        var l = values.length;
        for (var i = 1; i < l; i++) {
            if (values[i] < min) min = values[i];
            if (values[i] > max) max = values[i];
        }
        return {
            min: min,
            max: max
        };
    }

    /**
     * Computes the arithmetic mean of the given values
     * @param {Array} values
     * @returns {number}
     */
    function arithmeticMean(values: number[]) : number {
        var sum = 0;
        var l = values.length;
        for (var i = 0; i < l; i++) {
            sum += values[i];
        }
        return sum / l;
    }

    /**
     * {@link arithmeticMean}
     */
    

    /**
     * Computes the geometric mean of the given values
     * @param {Array} values
     * @returns {number}
     */
    function geometricMean(values: number[]) : number {
        var mul = 1;
        var l = values.length;
        for (var i = 0; i < l; i++) {
            mul *= values[i];
        }
        return Math.pow(mul, 1 / l);
    }

    /**
     * Computes the mean of the log of the given values
     * If the return value is exponentiated, it gives the same result as the
     * geometric mean.
     * @param {Array} values
     * @returns {number}
     */
    function logMean(values: number[]) : number {
        var lnsum = 0;
        var l = values.length;
        for (var i = 0; i < l; i++) {
            lnsum += Math.log(values[i]);
        }
        return lnsum / l;
    }

    /**
     * Computes the weighted grand mean for a list of means and sample sizes
     * @param {Array} means - Mean values for each set of samples
     * @param {Array} samples - Number of original values for each set of samples
     * @returns {number}
     */
    function grandMean(means: number[], samples: number[]) : number {
        var sum = 0;
        var n = 0;
        var l = means.length;
        for (var i = 0; i < l; i++) {
            sum += samples[i] * means[i];
            n += samples[i];
        }
        return sum / n;
    }

    /**
     * Computes the truncated mean of the given values using a given percentage
     * @param {Array} values
     * @param {number} percent - The percentage of values to keep (range: [0,1])
     * @param {boolean} [alreadySorted=false]
     * @returns {number}
     */
    function truncatedMean(values: number[], percent: number, alreadySorted?: boolean) : number {
        if (alreadySorted === undefined) alreadySorted = false;
        if (!alreadySorted) {
            values = new Array<number>().concat(values).sort(compareNumbers);
        }
        var l = values.length;
        var k = Math.floor(l * percent);
        var sum = 0;
        for (var i = k; i < (l - k); i++) {
            sum += values[i];
        }
        return sum / (l - 2 * k);
    }

    /**
     * Computes the harmonic mean of the given values
     * @param {Array} values
     * @returns {number}
     */
    function harmonicMean(values: number[]) : number {
        var sum = 0;
        var l = values.length;
        for (var i = 0; i < l; i++) {
            if (values[i] === 0) {
                throw new RangeError('value at index ' + i + 'is zero');
            }
            sum += 1 / values[i];
        }
        return l / sum;
    }

    /**
     * Computes the contraharmonic mean of the given values
     * @param {Array} values
     * @returns {number}
     */
    function contraHarmonicMean(values: number[]) : number {
        var r1 = 0;
        var r2 = 0;
        var l = values.length;
        for (var i = 0; i < l; i++) {
            r1 += values[i] * values[i];
            r2 += values[i];
        }
        if (r2 < 0) {
            throw new RangeError('sum of values is negative');
        }
        return r1 / r2;
    }

    /**
     * Computes the median of the given values
     * @param {Array} values
     * @param {boolean} [alreadySorted=false]
     * @returns {number}
     */
    function median(values: number[], alreadySorted?: boolean) : number {
        if (alreadySorted === undefined) alreadySorted = false;
        if (!alreadySorted) {
            values = new Array<number>().concat(values).sort(compareNumbers);
        }
        var l = values.length;
        var half = Math.floor(l / 2);
        if (l % 2 === 0) {
            return (values[half - 1] + values[half]) * 0.5;
        } else {
            return values[half];
        }
    }

    /**
     * Computes the variance of the given values
     * @param {Array} values
     * @param {boolean} [unbiased=true] - if true, divide by (n-1); if false, divide by n.
     * @returns {number}
     */
    function variance(values: number[], unbiased?: boolean) : number {
        if (unbiased === undefined) unbiased = true;
        var theMean = MLStatArray.mean(values);
        var theVariance = 0;
        var l = values.length;

        for (var i = 0; i < l; i++) {
            var x = values[i] - theMean;
            theVariance += x * x;
        }

        if (unbiased) {
            return theVariance / (l - 1);
        } else {
            return theVariance / l;
        }
    }

    /**
     * Computes the standard deviation of the given values
     * @param {Array} values
     * @param {boolean} [unbiased=true] - if true, divide by (n-1); if false, divide by n.
     * @returns {number}
     */
    function standardDeviation(values: number[], unbiased?: boolean) : number {
        return Math.sqrt(MLStatArray.variance(values, unbiased));
    }

    function standardError(values: number[]) : number {
        return MLStatArray.standardDeviation(values) / Math.sqrt(values.length);
    }

    /**
     * IEEE Transactions on biomedical engineering, vol. 52, no. 1, january 2005, p. 76-
     * Calculate the standard deviation via the Median of the absolute deviation
     *  The formula for the standard deviation only holds for Gaussian random variables.
     * @returns {{mean: number, stdev: number}}
     */
    function robustMeanAndStdev(y: number[]) : { mean: number; stdev: number } {
        var mean = 0, stdev = 0;
        var length = y.length, i = 0;
        for (i = 0; i < length; i++) {
            mean += y[i];
        }
        mean /= length;
        var averageDeviations = new Array<number>(length);
        for (i = 0; i < length; i++)
            averageDeviations[i] = Math.abs(y[i] - mean);
        averageDeviations.sort(compareNumbers);
        if (length % 2 === 1) {
            stdev = averageDeviations[(length - 1) / 2] / 0.6745;
        } else {
            stdev = 0.5 * (averageDeviations[length / 2] + averageDeviations[length / 2 - 1]) / 0.6745;
        }

        return {
            mean: mean,
            stdev: stdev
        };
    }

    function quartiles(values: number[], alreadySorted?: boolean) : { q1: number; q2: number; q3: number } {
        if (typeof (alreadySorted) === 'undefined') alreadySorted = false;
        if (!alreadySorted) {
            values = new Array<number>().concat(values).sort(compareNumbers);
        }

        var quart = values.length / 4;
        var q1 = values[Math.ceil(quart) - 1];
        var q2 = MLStatArray.median(values, true);
        var q3 = values[Math.ceil(quart * 3) - 1];

        return {q1: q1, q2: q2, q3: q3};
    }

    function pooledStandardDeviation(samples: number[][], unbiased?: boolean) : number {
        return Math.sqrt(MLStatArray.pooledVariance(samples, unbiased));
    }

    function pooledVariance(samples: number[][], unbiased?: boolean) : number {
        if (typeof (unbiased) === 'undefined') unbiased = true;
        var sum = 0;
        var length = 0, l = samples.length;
        for (var i = 0; i < l; i++) {
            var values = samples[i];
            var vari = MLStatArray.variance(values);

            sum += (values.length - 1) * vari;

            if (unbiased)
                length += values.length - 1;
            else
                length += values.length;
        }
        return sum / length;
    }

    function mode(values: number[]) : number {
        var l = values.length,
            itemCount = new Array<number>(l),
            i;
        for (i = 0; i < l; i++) {
            itemCount[i] = 0;
        }
        var itemArray = new Array<number>(l);
        var count = 0;

        for (i = 0; i < l; i++) {
            var index = itemArray.indexOf(values[i]);
            if (index >= 0)
                itemCount[index]++;
            else {
                itemArray[count] = values[i];
                itemCount[count] = 1;
                count++;
            }
        }

        var maxValue = 0, maxIndex = 0;
        for (i = 0; i < count; i++) {
            if (itemCount[i] > maxValue) {
                maxValue = itemCount[i];
                maxIndex = i;
            }
        }

        return itemArray[maxIndex];
    }

    function covariance(vector1: number[], vector2: number[], unbiased?: boolean) : number {
        if (typeof (unbiased) === 'undefined') unbiased = true;
        var mean1 = MLStatArray.mean(vector1);
        var mean2 = MLStatArray.mean(vector2);

        if (vector1.length !== vector2.length)
            throw 'Vectors do not have the same dimensions';

        var cov = 0, l = vector1.length;
        for (var i = 0; i < l; i++) {
            var x = vector1[i] - mean1;
            var y = vector2[i] - mean2;
            cov += x * y;
        }

        if (unbiased)
            return cov / (l - 1);
        else
            return cov / l;
    }

    function skewness(values: number[], unbiased?: boolean) : number {
        if (typeof (unbiased) === 'undefined') unbiased = true;
        var theMean = MLStatArray.mean(values);

        var s2 = 0, s3 = 0, l = values.length;
        for (var i = 0; i < l; i++) {
            var dev = values[i] - theMean;
            s2 += dev * dev;
            s3 += dev * dev * dev;
        }
        var m2 = s2 / l;
        var m3 = s3 / l;

        var g = m3 / (Math.pow(m2, 3 / 2.0));
        if (unbiased) {
            var a = Math.sqrt(l * (l - 1));
            var b = l - 2;
            return (a / b) * g;
        } else {
            return g;
        }
    }

    function kurtosis(values: number[], unbiased?: boolean) : number {
        if (typeof (unbiased) === 'undefined') unbiased = true;
        var theMean = MLStatArray.mean(values);
        var n = values.length, s2 = 0, s4 = 0;

        for (var i = 0; i < n; i++) {
            var dev = values[i] - theMean;
            s2 += dev * dev;
            s4 += dev * dev * dev * dev;
        }
        var m2 = s2 / n;
        var m4 = s4 / n;

        if (unbiased) {
            var v = s2 / (n - 1);
            var a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
            var b = s4 / (v * v);
            var c = ((n - 1) * (n - 1)) / ((n - 2) * (n - 3));

            return a * b - 3 * c;
        } else {
            return m4 / (m2 * m2) - 3;
        }
    }

    function entropy(values: number[], eps?: number) : number {
        if (typeof (eps) === 'undefined') eps = 0;
        var sum = 0, l = values.length;
        for (var i = 0; i < l; i++)
            sum += values[i] * Math.log(values[i] + eps);
        return -sum;
    }

    function weightedMean(values: number[], weights: number[]) : number {
        var sum = 0, l = values.length;
        for (var i = 0; i < l; i++)
            sum += values[i] * weights[i];
        return sum;
    }

    function weightedStandardDeviation(values: number[], weights: number[]) : number {
        return Math.sqrt(MLStatArray.weightedVariance(values, weights));
    }

    function weightedVariance(values: number[], weights: number[]) : number {
        var theMean = MLStatArray.weightedMean(values, weights);
        var vari = 0, l = values.length;
        var a = 0, b = 0;

        for (var i = 0; i < l; i++) {
            var z = values[i] - theMean;
            var w = weights[i];

            vari += w * (z * z);
            b += w;
            a += w * w;
        }

        return vari * (b / (b * b - a));
    }

    function center(values: number[], inPlace?: boolean) : void {
        if (typeof (inPlace) === 'undefined') inPlace = false;

        var result = values;
        if (!inPlace)
            result = new Array<number>().concat(values);

        var theMean = MLStatArray.mean(result), l = result.length;
        for (var i = 0; i < l; i++)
            result[i] -= theMean;
    }

    function standardize(values: number[], standardDev?: number, inPlace?: boolean) : number[] {
        if (typeof (standardDev) === 'undefined') standardDev = MLStatArray.standardDeviation(values);
        if (typeof (inPlace) === 'undefined') inPlace = false;
        var l = values.length;
        var result = inPlace ? values : new Array<number>(l);
        for (var i = 0; i < l; i++)
            result[i] = values[i] / standardDev;
        return result;
    }

    function cumulativeSum(array: number[]) : number[] {
        var l = array.length;
        var result = new Array<number>(l);
        result[0] = array[0];
        for (var i = 1; i < l; i++)
            result[i] = result[i - 1] + array[i];
        return result;
    }

    return {
        sum: sum,
        max: max,
        min: min,
        minMax: minMax,
        arithmeticMean: arithmeticMean,
        mean: arithmeticMean,
        geometricMean: geometricMean,
        logMean: logMean,
        grandMean: grandMean,
        truncatedMean: truncatedMean,
        harmonicMean: harmonicMean,
        contraHarmonicMean: contraHarmonicMean,
        median: median,
        variance: variance,
        standardDeviation: standardDeviation,
        standardError: standardError,
        robustMeanAndStdev: robustMeanAndStdev,
        quartiles: quartiles,
        pooledStandardDeviation: pooledStandardDeviation,
        pooledVariance: pooledVariance,
        mode: mode,
        covariance: covariance,
        skewness: skewness,
        kurtosis: kurtosis,
        entropy: entropy,
        weightedMean: weightedMean,
        weightedStandardDeviation: weightedStandardDeviation,
        weightedVariance: weightedVariance,
        center: center,
        standardize: standardize,
        cumulativeSum: cumulativeSum
    };
})();


// ml-stat matrix.js
export const MLStatMatrix = (() => {
    let arrayStat = MLStatArray;

    function compareNumbers(a: number, b: number) : number {
        return a - b;
    }

    function max(matrix: number[][]) : number {
        var max = -Infinity;
        for (var i = 0; i < matrix.length; i++) {
            for (var j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] > max) max = matrix[i][j];
            }
        }
        return max;
    }

    function min(matrix: number[][]) : number {
        var min = Infinity;
        for (var i = 0; i < matrix.length; i++) {
            for (var j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] < min) min = matrix[i][j];
            }
        }
        return min;
    }

    function minMax(matrix: number[][]) : { min: number; max: number } {
        var min = Infinity;
        var max = -Infinity;
        for (var i = 0; i < matrix.length; i++) {
            for (var j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] < min) min = matrix[i][j];
                if (matrix[i][j] > max) max = matrix[i][j];
            }
        }
        return {
            min:min,
            max:max
        };
    }

    function entropy(matrix: number[][], eps?: number) : number {
        if (typeof (eps) === 'undefined') {
            eps = 0;
        }
        var sum = 0,
            l1 = matrix.length,
            l2 = matrix[0].length;
        for (var i = 0; i < l1; i++) {
            for (var j = 0; j < l2; j++) {
                sum += matrix[i][j] * Math.log(matrix[i][j] + eps);
            }
        }
        return -sum;
    }

    function mean(matrix: number[][], dimension?: number) : number[] {
        if (typeof (dimension) === 'undefined') {
            dimension = 0;
        }
        var rows = matrix.length,
            cols = matrix[0].length,
            theMean, N, i, j;

        if (dimension === -1) {
            theMean = [0];
            N = rows * cols;
            for (i = 0; i < rows; i++) {
                for (j = 0; j < cols; j++) {
                    theMean[0] += matrix[i][j];
                }
            }
            theMean[0] /= N;
        } else if (dimension === 0) {
            theMean = new Array<number>(cols);
            N = rows;
            for (j = 0; j < cols; j++) {
                theMean[j] = 0;
                for (i = 0; i < rows; i++) {
                    theMean[j] += matrix[i][j];
                }
                theMean[j] /= N;
            }
        } else if (dimension === 1) {
            theMean = new Array<number>(rows);
            N = cols;
            for (j = 0; j < rows; j++) {
                theMean[j] = 0;
                for (i = 0; i < cols; i++) {
                    theMean[j] += matrix[j][i];
                }
                theMean[j] /= N;
            }
        } else {
            throw new Error('Invalid dimension');
        }
        return theMean;
    }

    function sum(matrix: number[][], dimension?: number) : number[] {
        if (typeof (dimension) === 'undefined') {
            dimension = 0;
        }
        var rows = matrix.length,
            cols = matrix[0].length,
            theSum, i, j;

        if (dimension === -1) {
            theSum = [0];
            for (i = 0; i < rows; i++) {
                for (j = 0; j < cols; j++) {
                    theSum[0] += matrix[i][j];
                }
            }
        } else if (dimension === 0) {
            theSum = new Array<number>(cols);
            for (j = 0; j < cols; j++) {
                theSum[j] = 0;
                for (i = 0; i < rows; i++) {
                    theSum[j] += matrix[i][j];
                }
            }
        } else if (dimension === 1) {
            theSum = new Array<number>(rows);
            for (j = 0; j < rows; j++) {
                theSum[j] = 0;
                for (i = 0; i < cols; i++) {
                    theSum[j] += matrix[j][i];
                }
            }
        } else {
            throw new Error('Invalid dimension');
        }
        return theSum;
    }

    function product(matrix: number[][], dimension?: number) : number[] {
        if (typeof (dimension) === 'undefined') {
            dimension = 0;
        }
        var rows = matrix.length,
            cols = matrix[0].length,
            theProduct, i, j;

        if (dimension === -1) {
            theProduct = [1];
            for (i = 0; i < rows; i++) {
                for (j = 0; j < cols; j++) {
                    theProduct[0] *= matrix[i][j];
                }
            }
        } else if (dimension === 0) {
            theProduct = new Array<number>(cols);
            for (j = 0; j < cols; j++) {
                theProduct[j] = 1;
                for (i = 0; i < rows; i++) {
                    theProduct[j] *= matrix[i][j];
                }
            }
        } else if (dimension === 1) {
            theProduct = new Array<number>(rows);
            for (j = 0; j < rows; j++) {
                theProduct[j] = 1;
                for (i = 0; i < cols; i++) {
                    theProduct[j] *= matrix[j][i];
                }
            }
        } else {
            throw new Error('Invalid dimension');
        }
        return theProduct;
    }

    function standardDeviation(matrix: number[][], means?: number[] | boolean, unbiased?: boolean | number[]) : number[] {
        var vari = MLStatMatrix.variance(matrix, means, unbiased), l = vari.length;
        for (var i = 0; i < l; i++) {
            vari[i] = Math.sqrt(vari[i]);
        }
        return vari;
    }

    function variance(matrix: number[][], means?: number[] | boolean, unbiased?: boolean | number[]) : number[] {
        if (typeof (unbiased) === 'undefined') {
            unbiased = true;
        }
        means = means || MLStatMatrix.mean(matrix);
        var rows = matrix.length;
        if (rows === 0) return [];
        var cols = matrix[0].length;
        var vari = new Array<number>(cols);

        for (var j = 0; j < cols; j++) {
            var sum1 = 0, sum2 = 0, x = 0;
            for (var i = 0; i < rows; i++) {
                x = matrix[i][j] - meanEntry(means, j)!;
                sum1 += x;
                sum2 += x * x;
            }
            if (unbiased) {
                vari[j] = (sum2 - ((sum1 * sum1) / rows)) / (rows - 1);
            } else {
                vari[j] = (sum2 - ((sum1 * sum1) / rows)) / rows;
            }
        }
        return vari;
    }

    function median(matrix: number[][]) : number[] {
        var rows = matrix.length, cols = matrix[0].length;
        var medians = new Array<number>(cols);

        for (var i = 0; i < cols; i++) {
            var data = new Array<number>(rows);
            for (var j = 0; j < rows; j++) {
                data[j] = matrix[j][i];
            }
            data.sort(compareNumbers);
            var N = data.length;
            if (N % 2 === 0) {
                medians[i] = (data[N / 2] + data[(N / 2) - 1]) * 0.5;
            } else {
                medians[i] = data[Math.floor(N / 2)];
            }
        }
        return medians;
    }

    function mode(matrix: number[][]) : number[] {
        var rows = matrix.length,
            cols = matrix[0].length,
            modes = new Array<number>(cols),
            i, j;
        for (i = 0; i < cols; i++) {
            var itemCount = new Array<number>(rows);
            for (var k = 0; k < rows; k++) {
                itemCount[k] = 0;
            }
            var itemArray = new Array<number>(rows);
            var count = 0;

            for (j = 0; j < rows; j++) {
                var index = itemArray.indexOf(matrix[j][i]);
                if (index >= 0) {
                    itemCount[index]++;
                } else {
                    itemArray[count] = matrix[j][i];
                    itemCount[count] = 1;
                    count++;
                }
            }

            var maxValue = 0, maxIndex = 0;
            for (j = 0; j < count; j++) {
                if (itemCount[j] > maxValue) {
                    maxValue = itemCount[j];
                    maxIndex = j;
                }
            }

            modes[i] = itemArray[maxIndex];
        }
        return modes;
    }

    function skewness(matrix: number[][], unbiased?: boolean) : number[] {
        if (typeof (unbiased) === 'undefined') unbiased = true;
        var means = MLStatMatrix.mean(matrix);
        var n = matrix.length, l = means.length;
        var skew = new Array<number>(l);

        for (var j = 0; j < l; j++) {
            var s2 = 0, s3 = 0;
            for (var i = 0; i < n; i++) {
                var dev = matrix[i][j] - means[j];
                s2 += dev * dev;
                s3 += dev * dev * dev;
            }

            var m2 = s2 / n;
            var m3 = s3 / n;
            var g = m3 / Math.pow(m2, 3 / 2);

            if (unbiased) {
                var a = Math.sqrt(n * (n - 1));
                var b = n - 2;
                skew[j] = (a / b) * g;
            } else {
                skew[j] = g;
            }
        }
        return skew;
    }

    function kurtosis(matrix: number[][], unbiased?: boolean) : number[] {
        if (typeof (unbiased) === 'undefined') unbiased = true;
        var means = MLStatMatrix.mean(matrix);
        var n = matrix.length, m = matrix[0].length;
        var kurt = new Array<number>(m);

        for (var j = 0; j < m; j++) {
            var s2 = 0, s4 = 0;
            for (var i = 0; i < n; i++) {
                var dev = matrix[i][j] - means[j];
                s2 += dev * dev;
                s4 += dev * dev * dev * dev;
            }
            var m2 = s2 / n;
            var m4 = s4 / n;

            if (unbiased) {
                var v = s2 / (n - 1);
                var a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
                var b = s4 / (v * v);
                var c = ((n - 1) * (n - 1)) / ((n - 2) * (n - 3));
                kurt[j] = a * b - 3 * c;
            } else {
                kurt[j] = m4 / (m2 * m2) - 3;
            }
        }
        return kurt;
    }

    function standardError(matrix: number[][]) : number[] {
        var samples = matrix.length;
        var standardDeviations = MLStatMatrix.standardDeviation(matrix);
        var l = standardDeviations.length;
        var standardErrors = new Array<number>(l);
        var sqrtN = Math.sqrt(samples);

        for (var i = 0; i < l; i++) {
            standardErrors[i] = standardDeviations[i] / sqrtN;
        }
        return standardErrors;
    }

    function covariance(matrix: number[][], dimension?: number) : number[][] {
        return MLStatMatrix.scatter(matrix, undefined, dimension);
    }

    function scatter(matrix: number[][], divisor?: number, dimension?: number) : number[][] {
        if (typeof (dimension) === 'undefined') {
            dimension = 0;
        }
        if (typeof (divisor) === 'undefined') {
            if (dimension === 0) {
                divisor = matrix.length - 1;
            } else if (dimension === 1) {
                divisor = matrix[0].length - 1;
            }
        }
        var means = MLStatMatrix.mean(matrix, dimension);
        var rows = matrix.length;
        if (rows === 0) {
            return [[]];
        }
        var cols = matrix[0].length,
            cov, i, j, s, k;

        if (dimension === 0) {
            cov = new Array<number[]>(cols);
            for (i = 0; i < cols; i++) {
                cov[i] = new Array<number>(cols);
            }
            for (i = 0; i < cols; i++) {
                for (j = i; j < cols; j++) {
                    s = 0;
                    for (k = 0; k < rows; k++) {
                        s += (matrix[k][j] - means[j]) * (matrix[k][i] - means[i]);
                    }
                    s /= divisor!;
                    cov[i][j] = s;
                    cov[j][i] = s;
                }
            }
        } else if (dimension === 1) {
            cov = new Array<number[]>(rows);
            for (i = 0; i < rows; i++) {
                cov[i] = new Array<number>(rows);
            }
            for (i = 0; i < rows; i++) {
                for (j = i; j < rows; j++) {
                    s = 0;
                    for (k = 0; k < cols; k++) {
                        s += (matrix[j][k] - means[j]) * (matrix[i][k] - means[i]);
                    }
                    s /= divisor!;
                    cov[i][j] = s;
                    cov[j][i] = s;
                }
            }
        } else {
            throw new Error('Invalid dimension');
        }

        return cov;
    }

    function correlation(matrix: number[][]) : number[][] {
        var means = MLStatMatrix.mean(matrix),
            standardDeviations = MLStatMatrix.standardDeviation(matrix, true, means),
            scores = MLStatMatrix.zScores(matrix, means, standardDeviations),
            rows = matrix.length,
            cols = matrix[0].length,
            i, j;

        var cor = new Array<number[]>(cols);
        for (i = 0; i < cols; i++) {
            cor[i] = new Array<number>(cols);
        }
        for (i = 0; i < cols; i++) {
            for (j = i; j < cols; j++) {
                var c = 0;
                for (var k = 0, l = scores.length; k < l; k++) {
                    c += scores[k][j] * scores[k][i];
                }
                c /= rows - 1;
                cor[i][j] = c;
                cor[j][i] = c;
            }
        }
        return cor;
    }

    function zScores(matrix: number[][], means?: number[], standardDeviations?: number[]) : number[][] {
        means = means || MLStatMatrix.mean(matrix);
        if (typeof (standardDeviations) === 'undefined') standardDeviations = MLStatMatrix.standardDeviation(matrix, true, means);
        return MLStatMatrix.standardize(MLStatMatrix.center(matrix, means, false), standardDeviations, true);
    }

    function center(matrix: number[][], means?: number[], inPlace?: boolean) : number[][] {
        means = means || MLStatMatrix.mean(matrix);
        var result = matrix,
            l = matrix.length,
            i, j, jj;

        if (!inPlace) {
            result = new Array<number[]>(l);
            for (i = 0; i < l; i++) {
                result[i] = new Array<number>(matrix[i].length);
            }
        }

        for (i = 0; i < l; i++) {
            var row = result[i];
            for (j = 0, jj = row.length; j < jj; j++) {
                row[j] = matrix[i][j] - means[j];
            }
        }
        return result;
    }

    function standardize(matrix: number[][], standardDeviations?: number[], inPlace?: boolean) : number[][] {
        if (typeof (standardDeviations) === 'undefined') standardDeviations = MLStatMatrix.standardDeviation(matrix);
        var result = matrix,
            l = matrix.length,
            i, j, jj;

        if (!inPlace) {
            result = new Array<number[]>(l);
            for (i = 0; i < l; i++) {
                result[i] = new Array<number>(matrix[i].length);
            }
        }

        for (i = 0; i < l; i++) {
            var resultRow = result[i];
            var sourceRow = matrix[i];
            for (j = 0, jj = resultRow.length; j < jj; j++) {
                if (standardDeviations[j] !== 0 && !isNaN(standardDeviations[j])) {
                    resultRow[j] = sourceRow[j] / standardDeviations[j];
                }
            }
        }
        return result;
    }

    function weightedVariance(matrix: number[][], weights: number[]) : number[] {
        var means = MLStatMatrix.mean(matrix);
        var rows = matrix.length;
        if (rows === 0) return [];
        var cols = matrix[0].length;
        var vari = new Array<number>(cols);

        for (var j = 0; j < cols; j++) {
            var sum = 0;
            var a = 0, b = 0;

            for (var i = 0; i < rows; i++) {
                var z = matrix[i][j] - means[j];
                var w = weights[i];

                sum += w * (z * z);
                b += w;
                a += w * w;
            }

            vari[j] = sum * (b / (b * b - a));
        }

        return vari;
    }

    function weightedMean(matrix: number[][], weights: number[], dimension?: number) : number[] {
        if (typeof (dimension) === 'undefined') {
            dimension = 0;
        }
        var rows = matrix.length;
        if (rows === 0) return [];
        var cols = matrix[0].length,
            means, i, ii, j, w, row;

        if (dimension === 0) {
            means = new Array<number>(cols);
            for (i = 0; i < cols; i++) {
                means[i] = 0;
            }
            for (i = 0; i < rows; i++) {
                row = matrix[i];
                w = weights[i];
                for (j = 0; j < cols; j++) {
                    means[j] += row[j] * w;
                }
            }
        } else if (dimension === 1) {
            means = new Array<number>(rows);
            for (i = 0; i < rows; i++) {
                means[i] = 0;
            }
            for (j = 0; j < rows; j++) {
                row = matrix[j];
                w = weights[j];
                for (i = 0; i < cols; i++) {
                    means[j] += row[i] * w;
                }
            }
        } else {
            throw new Error('Invalid dimension');
        }

        var weightSum = arrayStat.sum(weights);
        if (weightSum !== 0) {
            for (i = 0, ii = means.length; i < ii; i++) {
                means[i] /= weightSum;
            }
        }
        return means;
    }

    function weightedCovariance(matrix: number[][], weights: number[], means?: number[], dimension?: number) : number[][] {
        dimension = dimension || 0;
        means = means || MLStatMatrix.weightedMean(matrix, weights, dimension);
        var s1 = 0, s2 = 0;
        for (var i = 0, ii = weights.length; i < ii; i++) {
            s1 += weights[i];
            s2 += weights[i] * weights[i];
        }
        var factor = s1 / (s1 * s1 - s2);
        return MLStatMatrix.weightedScatter(matrix, weights, means, factor, dimension);
    }

    function weightedScatter(matrix: number[][], weights: number[], means?: number[], factor?: number, dimension?: number) : number[][] {
        dimension = dimension || 0;
        means = means || MLStatMatrix.weightedMean(matrix, weights, dimension);
        if (typeof (factor) === 'undefined') {
            factor = 1;
        }
        var rows = matrix.length;
        if (rows === 0) {
            return [[]];
        }
        var cols = matrix[0].length,
            cov, i, j, k, s;

        if (dimension === 0) {
            cov = new Array<number[]>(cols);
            for (i = 0; i < cols; i++) {
                cov[i] = new Array<number>(cols);
            }
            for (i = 0; i < cols; i++) {
                for (j = i; j < cols; j++) {
                    s = 0;
                    for (k = 0; k < rows; k++) {
                        s += weights[k] * (matrix[k][j] - means[j]) * (matrix[k][i] - means[i]);
                    }
                    cov[i][j] = s * factor;
                    cov[j][i] = s * factor;
                }
            }
        } else if (dimension === 1) {
            cov = new Array<number[]>(rows);
            for (i = 0; i < rows; i++) {
                cov[i] = new Array<number>(rows);
            }
            for (i = 0; i < rows; i++) {
                for (j = i; j < rows; j++) {
                    s = 0;
                    for (k = 0; k < cols; k++) {
                        s += weights[k] * (matrix[j][k] - means[j]) * (matrix[i][k] - means[i]);
                    }
                    cov[i][j] = s * factor;
                    cov[j][i] = s * factor;
                }
            }
        } else {
            throw new Error('Invalid dimension');
        }

        return cov;
    }

    return {
        max: max,
        min: min,
        minMax: minMax,
        entropy: entropy,
        mean: mean,
        sum: sum,
        product: product,
        standardDeviation: standardDeviation,
        variance: variance,
        median: median,
        mode: mode,
        skewness: skewness,
        kurtosis: kurtosis,
        standardError: standardError,
        covariance: covariance,
        scatter: scatter,
        correlation: correlation,
        zScores: zScores,
        center: center,
        standardize: standardize,
        weightedVariance: weightedVariance,
        weightedMean: weightedMean,
        weightedCovariance: weightedCovariance,
        weightedScatter: weightedScatter
    };
})();

// ml-stat index.js
export const MLStat = (() => {
    
    

    return {
        array: MLStatArray,
        matrix: MLStatMatrix
    };
})();


// ml-array-utils ArrayUtils.js
export const MLArrayUtilsArrayUtils = (() => {
    const Stat = MLStat.array;
    /**
     * Function that returns an array of points given 1D array as follows:
     *
     * [x1, y1, .. , x2, y2, ..]
     *
     * And receive the number of dimensions of each point.
     * @param array
     * @param dimensions
     * @returns {Array} - Array of points.
     */
    function coordArrayToPoints(array: number[], dimensions: number) : number[][] {
        if(array.length % dimensions !== 0) {
            throw new RangeError('Dimensions number must be accordance with the size of the array.');
        }

        var length = array.length / dimensions;
        var pointsArr = new Array<number[]>(length);

        var k = 0;
        for(var i = 0; i < array.length; i += dimensions) {
            var point = new Array<number>(dimensions);
            for(var j = 0; j < dimensions; ++j) {
                point[j] = array[i + j];
            }

            pointsArr[k] = point;
            k++;
        }

        return pointsArr;
    }


    /**
     * Function that given an array as follows:
     * [x1, y1, .. , x2, y2, ..]
     *
     * Returns an array as follows:
     * [[x1, x2, ..], [y1, y2, ..], [ .. ]]
     *
     * And receives the number of dimensions of each coordinate.
     * @param array
     * @param dimensions
     * @returns {Array} - Matrix of coordinates
     */
    function coordArrayToCoordMatrix(array: number[], dimensions: number) : number[][] {
        if(array.length % dimensions !== 0) {
            throw new RangeError('Dimensions number must be accordance with the size of the array.');
        }

        var coordinatesArray = new Array<number[]>(dimensions);
        var points = array.length / dimensions;
        for (var i = 0; i < coordinatesArray.length; i++) {
            coordinatesArray[i] = new Array<number>(points);
        }

        for(i = 0; i < array.length; i += dimensions) {
            for(var j = 0; j < dimensions; ++j) {
                var currentPoint = Math.floor(i / dimensions);
                coordinatesArray[j][currentPoint] = array[i + j];
            }
        }

        return coordinatesArray;
    }

    /**
     * Function that receives a coordinate matrix as follows:
     * [[x1, x2, ..], [y1, y2, ..], [ .. ]]
     *
     * Returns an array of coordinates as follows:
     * [x1, y1, .. , x2, y2, ..]
     *
     * @param coordMatrix
     * @returns {Array}
     */
    function coordMatrixToCoordArray(coordMatrix: number[][]) : number[] {
        var coodinatesArray = new Array<number>(coordMatrix.length * coordMatrix[0].length);
        var k = 0;
        for(var i = 0; i < coordMatrix[0].length; ++i) {
            for(var j = 0; j < coordMatrix.length; ++j) {
                coodinatesArray[k] = coordMatrix[j][i];
                ++k;
            }
        }

        return coodinatesArray;
    }

    /**
     * Tranpose a matrix, this method is for coordMatrixToPoints and
     * pointsToCoordMatrix, that because only transposing the matrix
     * you can change your representation.
     *
     * @param matrix
     * @returns {Array}
     */
    function transpose(matrix: number[][]) : number[][] {
        var resultMatrix = new Array<number[]>(matrix[0].length);
        for(var i = 0; i < resultMatrix.length; ++i) {
            resultMatrix[i] = new Array<number>(matrix.length);
        }

        for (i = 0; i < matrix.length; ++i) {
            for(var j = 0; j < matrix[0].length; ++j) {
                resultMatrix[j][i] = matrix[i][j];
            }
        }

        return resultMatrix;
    }

    /**
     * Function that transform an array of points into a coordinates array
     * as follows:
     * [x1, y1, .. , x2, y2, ..]
     *
     * @param points
     * @returns {Array}
     */
    function pointsToCoordArray(points: number[][]) : number[] {
        var coodinatesArray = new Array<number>(points.length * points[0].length);
        var k = 0;
        for(var i = 0; i < points.length; ++i) {
            for(var j = 0; j < points[0].length; ++j) {
                coodinatesArray[k] = points[i][j];
                ++k;
            }
        }

        return coodinatesArray;
    }

    /**
     * Apply the dot product between the smaller vector and a subsets of the
     * largest one.
     *
     * @param firstVector
     * @param secondVector
     * @returns {Array} each dot product of size of the difference between the
     *                  larger and the smallest one.
     */
    function applyDotProduct(firstVector: number[], secondVector: number[]) : number[] {
        var largestVector, smallestVector;
        if(firstVector.length <= secondVector.length) {
            smallestVector = firstVector;
            largestVector = secondVector;
        } else {
            smallestVector = secondVector;
            largestVector = firstVector;
        }

        var difference = largestVector.length - smallestVector.length + 1;
        var dotProductApplied = new Array<number>(difference);

        for (var i = 0; i < difference; ++i) {
            var sum = 0;
            for (var j = 0; j < smallestVector.length; ++j) {
                sum += smallestVector[j] * largestVector[i + j];
            }
            dotProductApplied[i] = sum;
        }

        return dotProductApplied;
    }
    /**
     * To scale the input array between the specified min and max values. The operation is performed inplace
     * if the options.inplace is specified. If only one of the min or max parameters is specified, then the scaling
     * will multiply the input array by min/min(input) or max/max(input)
     * @param input
     * @param options
     * @returns {*}
     */
    function scale(input: number[], options: ScaleOptions): number[] {
        var y;
        if(options.inPlace){
            y = input;
        }
        else{
            y = new Array<number>(input.length);
        }
        const max = options.max;
        const min = options.min;
        if(typeof max === "number"){
            if(typeof min === "number"){
                var minMax = Stat.minMax(input);
                var factor = (max - min)/(minMax.max-minMax.min);
                for(var i=0;i< y.length;i++){
                    y[i]=(input[i]-minMax.min)*factor+min;
                }
            }
            else{
                var currentMin = Stat.max(input);
                var factor = max/currentMin;
                for(var i=0;i< y.length;i++){
                    y[i] = input[i]*factor;
                }
            }
        }
        else{
            if(typeof min === "number"){
                var currentMin = Stat.min(input);
                var factor = min/currentMin;
                for(var i=0;i< y.length;i++){
                    y[i] = input[i]*factor;
                }
            }
        }
        return y;
    }

    
    
    
    
    
    
    
    

    return {
        coordArrayToPoints: coordArrayToPoints,
        coordArrayToCoordMatrix: coordArrayToCoordMatrix,
        coordMatrixToCoordArray: coordMatrixToCoordArray,
        coordMatrixToPoints: transpose,
        pointsToCoordArray: pointsToCoordArray,
        pointsToCoordMatrix: transpose,
        applyDotProduct: applyDotProduct,
        scale: scale
    };
})();


// ml-array-utils getEquallySpaced.js
export const MLArrayUtilsGetEquallySpaced = (() => {
    /**
     *
     * Function that returns a Number array of equally spaced numberOfPoints
     * containing a representation of intensities of the spectra arguments x
     * and y.
     *
     * The options parameter contains an object in the following form:
     * from: starting point
     * to: last point
     * numberOfPoints: number of points between from and to
     * variant: "slot" or "smooth" - smooth is the default option
     *
     * The slot variant consist that each point in the new array is calculated
     * averaging the existing points between the slot that belongs to the current
     * value. The smooth variant is the same but takes the integral of the range
     * of the slot and divide by the step size between two points in the new array.
     *
     * @param x - sorted increasing x values
     * @param y
     * @param options
     * @returns {Array} new array with the equally spaced data.
     *
     */
    function getEquallySpacedData(x: number[], y: number[], options?: EquallySpacedOptions) : number[] {
        if (x.length>1 && x[0]>x[1]) {
            x=x.slice().reverse();
            y=y.slice().reverse();
        }

        var xLength = x.length;
        if(xLength !== y.length)
            throw new RangeError("the x and y vector doesn't have the same size.");

        if (options === undefined) options = {};

        var from = options.from === undefined ? x[0] : options.from
        if (isNaN(from) || !isFinite(from)) {
            throw new RangeError("'From' value must be a number");
        }
        var to = options.to === undefined ? x[x.length - 1] : options.to;
        if (isNaN(to) || !isFinite(to)) {
            throw new RangeError("'To' value must be a number");
        }

        var reverse = from > to;
        if(reverse) {
            var temp = from;
            from = to;
            to = temp;
        }

        var numberOfPoints = options.numberOfPoints === undefined ? 100 : options.numberOfPoints;
        if (isNaN(numberOfPoints) || !isFinite(numberOfPoints)) {
            throw new RangeError("'Number of points' value must be a number");
        }
        if(numberOfPoints < 1)
            throw new RangeError("the number of point must be higher than 1");

        var algorithm = options.variant === "slot" ? "slot" : "smooth"; // default value: smooth

        var output = algorithm === "slot" ? getEquallySpacedSlot(x, y, from, to, numberOfPoints) : getEquallySpacedSmooth(x, y, from, to, numberOfPoints);

        return reverse ? output.reverse() : output;
    }

    /**
     * function that retrieves the getEquallySpacedData with the variant "smooth"
     *
     * @param x
     * @param y
     * @param from - Initial point
     * @param to - Final point
     * @param numberOfPoints
     * @returns {Array} - Array of y's equally spaced with the variant "smooth"
     */
    function getEquallySpacedSmooth(x: number[], y: number[], from: number, to: number, numberOfPoints: number) : number[] {
        var xLength = x.length;

        var step = (to - from) / (numberOfPoints - 1);
        var halfStep = step / 2;

        var start = from - halfStep;
        var output = new Array<number>(numberOfPoints);

        var initialOriginalStep = x[1] - x[0];
        var lastOriginalStep = x[x.length - 1] - x[x.length - 2];

        // Init main variables
        var min = start;
        var max = start + step;

        var previousX = Number.MIN_VALUE;
        var previousY = 0;
        var nextX = x[0] - initialOriginalStep;
        var nextY = 0;

        var currentValue = 0;
        var slope = 0;
        var intercept = 0;
        var sumAtMin = 0;
        var sumAtMax = 0;

        var i = 0; // index of input
        var j = 0; // index of output

        function getSlope(x0: number, y0: number, x1: number, y1: number) : number {
            return (y1 - y0) / (x1 - x0);
        }

        main: while(true) {
            while (nextX - max >= 0) {
                // no overlap with original point, just consume current value
                var add = integral(0, max - previousX, slope, previousY);
                sumAtMax = currentValue + add;

                output[j] = (sumAtMax - sumAtMin) / step;
                j++;

                if (j === numberOfPoints)
                    break main;

                min = max;
                max += step;
                sumAtMin = sumAtMax;
            }

            if(previousX <= min && min <= nextX) {
                add = integral(0, min - previousX, slope, previousY);
                sumAtMin = currentValue + add;
            }

            currentValue += integral(previousX, nextX, slope, intercept);

            previousX = nextX;
            previousY = nextY;

            if (i < xLength) {
                nextX = x[i];
                nextY = y[i];
                i++;
            } else if (i === xLength) {
                nextX += lastOriginalStep;
                nextY = 0;
            }
            // updating parameters
            slope = getSlope(previousX, previousY, nextX, nextY);
            intercept = -slope*previousX + previousY;
        }

        return output;
    }

    /**
     * function that retrieves the getEquallySpacedData with the variant "slot"
     *
     * @param x
     * @param y
     * @param from - Initial point
     * @param to - Final point
     * @param numberOfPoints
     * @returns {Array} - Array of y's equally spaced with the variant "slot"
     */
    function getEquallySpacedSlot(x: number[], y: number[], from: number, to: number, numberOfPoints: number) : number[] {
        var xLength = x.length;

        var step = (to - from) / (numberOfPoints - 1);
        var halfStep = step / 2;
        var lastStep = x[x.length - 1] - x[x.length - 2];

        var start = from - halfStep;
        var output = new Array<number>(numberOfPoints);

        // Init main variables
        var min = start;
        var max = start + step;

        var previousX = -Number.MAX_VALUE;
        var previousY = 0;
        var nextX = x[0];
        var nextY = y[0];
        var frontOutsideSpectra = 0;
        var backOutsideSpectra = true;

        var currentValue = 0;

        // for slot algorithm
        var currentPoints = 0;

        var i = 1; // index of input
        var j = 0; // index of output

        main: while(true) {
            if (previousX>=nextX) throw (new Error('x must be an increasing serie'));
            while (previousX - max > 0) {
                // no overlap with original point, just consume current value
                if(backOutsideSpectra) {
                    currentPoints++;
                    backOutsideSpectra = false;
                }

                output[j] = currentPoints <= 0 ? 0 : currentValue / currentPoints;
                j++;

                if (j === numberOfPoints)
                    break main;

                min = max;
                max += step;
                currentValue = 0;
                currentPoints = 0;
            }

            if(previousX > min) {
                currentValue += previousY;
                currentPoints++;
            }

            if(previousX === -Number.MAX_VALUE || frontOutsideSpectra > 1)
                currentPoints--;

            previousX = nextX;
            previousY = nextY;

            if (i < xLength) {
                nextX = x[i];
                nextY = y[i];
                i++;
            } else {
                nextX += lastStep;
                nextY = 0;
                frontOutsideSpectra++;
            }
        }

        return output;
    }
    /**
     * Function that calculates the integral of the line between two
     * x-coordinates, given the slope and intercept of the line.
     *
     * @param x0
     * @param x1
     * @param slope
     * @param intercept
     * @returns {number} integral value.
     */
    function integral(x0: number, x1: number, slope: number, intercept: number) : number {
        return (0.5 * slope * x1 * x1 + intercept * x1) - (0.5 * slope * x0 * x0 + intercept * x0);
    }

    
    

    return {
        getEquallySpacedData: getEquallySpacedData,
        integral: integral
    };
})();


// ml-array-utils snv.js
export const MLArrayUtilsSNV = (() => {
    
    let Stat = MLStat.array;

    /**
     * Function that applies the standard normal variate (SNV) to an array of values.
     *
     * @param data - Array of values.
     * @returns {Array} - applied the SNV.
     */
    function SNV(data: number[]) : number[] {
        var mean = Stat.mean(data);
        var std = Stat.standardDeviation(data);
        var result = data.slice();
        for (var i = 0; i < data.length; i++) {
            result[i] = (result[i] - mean) / std;
        }
        return result;
    }

    return {
        SNV: SNV
    };
})();

// ml-array-utils index.js
export const MLArrayUtils = (() => {
    
    

    return {
        getEquallySpacedData: MLArrayUtilsGetEquallySpaced.getEquallySpacedData,
        SNV: MLArrayUtilsSNV.SNV
    };
})();



