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

// Transcribed from WebKit ARES-6, revision b64265f153b3178bfb4ca9f51736289f57982fce:
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/ml/index.js
// Original MIT notice retained above; see ../LICENSE-ares6 for provenance exclusions.

import { Matrix } from "./matrix.ts";
import type { MatrixLike, MatrixVector } from "./matrix.ts";

    /**
     * @private
     * Check that a row index is not out of bounds
     * @param {Matrix} matrix
     * @param {number} index
     * @param {boolean} [outer]
     */
    export function checkRowIndex(matrix: MatrixLike, index: number, outer?: boolean): void {
        var max = outer ? matrix.rows : matrix.rows - 1;
        if (index < 0 || index > max) {
            throw new RangeError('Row index out of range');
        }
    };

    /**
     * @private
     * Check that a column index is not out of bounds
     * @param {Matrix} matrix
     * @param {number} index
     * @param {boolean} [outer]
     */
    export function checkColumnIndex(matrix: MatrixLike, index: number, outer?: boolean): void {
        var max = outer ? matrix.columns : matrix.columns - 1;
        if (index < 0 || index > max) {
            throw new RangeError('Column index out of range');
        }
    };

    /**
     * @private
     * Check that the provided vector is an array with the right length
     * @param {Matrix} matrix
     * @param {Array|Matrix} vector
     * @return {Array}
     * @throws {RangeError}
     */
    export function checkRowVector(matrix: MatrixLike, vector: MatrixVector): number[] {
        if (Matrix.isMatrix(vector)) {
            vector = vector.to1DArray();
        }
        if (vector.length !== matrix.columns) {
            throw new RangeError('vector size must be the same as the number of columns');
        }
        return vector;
    };

    /**
     * @private
     * Check that the provided vector is an array with the right length
     * @param {Matrix} matrix
     * @param {Array|Matrix} vector
     * @return {Array}
     * @throws {RangeError}
     */
    export function checkColumnVector(matrix: MatrixLike, vector: MatrixVector): number[] {
        if (Matrix.isMatrix(vector)) {
            vector = vector.to1DArray();
        }
        if (vector.length !== matrix.rows) {
            throw new RangeError('vector size must be the same as the number of rows');
        }
        return vector;
    };

    export function checkIndices(matrix: MatrixLike, rowIndices: number[], columnIndices: number[]): { row: number[]; column: number[] } {
        var rowOut = rowIndices.some(r => {
            return r < 0 || r >= matrix.rows;

        });

        var columnOut = columnIndices.some(c => {
            return c < 0 || c >= matrix.columns;
        });

        if (rowOut || columnOut) {
            throw new RangeError('Indices are out of range');
        }

        if (typeof rowIndices !== 'object' || typeof columnIndices !== 'object') {
            throw new TypeError('Unexpected type for row/column indices');
        }
        if (!Array.isArray(rowIndices)) rowIndices = Array.from(rowIndices);
        if (!Array.isArray(columnIndices)) rowIndices = Array.from(columnIndices);

        return {
            row: rowIndices,
            column: columnIndices
        };
    };

    export function checkRange(matrix: MatrixLike, startRow: number, endRow: number, startColumn: number, endColumn: number): void {
        if (arguments.length !== 5) throw new TypeError('Invalid argument type');
        var notAllNumbers = Array.from(arguments).slice(1).some(function (arg) {
            return typeof arg !== 'number';
        });
        if (notAllNumbers) throw new TypeError('Invalid argument type');
        if (startRow > endRow || startColumn > endColumn || startRow < 0 || startRow >= matrix.rows || endRow < 0 || endRow >= matrix.rows || startColumn < 0 || startColumn >= matrix.columns || endColumn < 0 || endColumn >= matrix.columns) {
            throw new RangeError('Submatrix indices are out of range');
        }
    };

    export function getRange(from: number, to: number): number[] {
        var arr: number[] = new Array(to - from + 1);
        for (var i = 0; i < arr.length; i++) {
            arr[i] = from + i;
        }
        return arr;
    };

    export function sumByRow(matrix: MatrixLike): Matrix {
        var sum = Matrix.zeros(matrix.rows, 1);
        for (var i = 0; i < matrix.rows; ++i) {
            for (var j = 0; j < matrix.columns; ++j) {
                sum.set(i, 0, sum.get(i, 0) + matrix.get(i, j));
            }
        }
        return sum;
    };

    export function sumByColumn(matrix: MatrixLike): Matrix {
        var sum = Matrix.zeros(1, matrix.columns);
        for (var i = 0; i < matrix.rows; ++i) {
            for (var j = 0; j < matrix.columns; ++j) {
                sum.set(0, j, sum.get(0, j) + matrix.get(i, j));
            }
        }
        return sum;
    };

    export function sumAll(matrix: MatrixLike): number {
        var v = 0;
        for (var i = 0; i < matrix.rows; i++) {
            for (var j = 0; j < matrix.columns; j++) {
                v += matrix.get(i, j);
            }
        }
        return v;
    };