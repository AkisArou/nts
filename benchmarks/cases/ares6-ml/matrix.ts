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

import { MLArrayUtils, MLArrayUtilsArrayUtils } from "./statistics.ts";
import * as util from "./matrix-util.ts";
import { random } from "./random.ts";

export type MatrixLike = AbstractMatrix | AbstractArrayMatrix;
export type MatrixInput = MatrixLike | number[][];
export type MatrixVector = MatrixLike | number[];

// The original export omits scale. Its optional declaration preserves the
// TypeError in dormant scaleRows/scaleColumns rather than repairing that export.
const arrayUtils: typeof MLArrayUtils & { scale?: typeof MLArrayUtilsArrayUtils.scale } = MLArrayUtils;

// Typed structural views of the actual built-in constructors, with no cast.
// Array storage stays an Array at runtime; views continue to inherit Object.
interface ArrayStorage {
    [index: number]: unknown;
    length: number;
    splice(start: number, deleteCount: number, ...items: unknown[]): unknown[];
    [Symbol.iterator](): ArrayIterator<unknown>;
}
const ArrayStorage: { new(...args: unknown[]): ArrayStorage } = Array;
const ObjectStorage: { new(...args: unknown[]): object } = Object;

function checkDimensions(matrix: MatrixLike, otherMatrix: MatrixLike): void {
    if (matrix.rows !== otherMatrix.rows || matrix.columns !== otherMatrix.columns)
        throw new RangeError('Matrices dimensions must be equal');
}
function compareNumbers(a: number, b: number): number { return a - b; }

// The two source factory instantiations are expanded into real declared classes.
// Explicit species allocations below always allocated Matrix in these classes.
// Decomposition entry points are omitted for unresolved/nonpermissive provenance.

export class AbstractMatrix extends ObjectStorage {
    declare rows: number;
    declare columns: number;
    declare ["constructor"]: typeof AbstractMatrix;
    klass: string = "Matrix";


            /**
             * Constructs a Matrix with the chosen dimensions from a 1D array
             * @param {number} newRows - Number of rows
             * @param {number} newColumns - Number of columns
             * @param {Array} newData - A 1D array containing data for the matrix
             * @return {Matrix} - The new matrix
             */
            static from1DArray(this: typeof Matrix, newRows: number, newColumns: number, newData: number[]): Matrix;
            static from1DArray(newRows: number, newColumns: number, newData: number[]): AbstractMatrix;
            static from1DArray(newRows: number, newColumns: number, newData: number[]): AbstractMatrix {
                var length = newRows * newColumns;
                if (length !== newData.length) {
                    throw new RangeError('Data length does not match given dimensions');
                }
                var newMatrix = new this(newRows, newColumns);
                for (var row = 0; row < newRows; row++) {
                    for (var column = 0; column < newColumns; column++) {
                        newMatrix.set(row, column, newData[row * newColumns + column]);
                    }
                }
                return newMatrix;
            }

            /**
             * Creates a row vector, a matrix with only one row.
             * @param {Array} newData - A 1D array containing data for the vector
             * @return {Matrix} - The new matrix
             */
            static rowVector(this: typeof Matrix, newData: number[]): Matrix;
            static rowVector(newData: number[]): AbstractMatrix;
            static rowVector(newData: number[]): AbstractMatrix {
                var vector = new this(1, newData.length);
                for (var i = 0; i < newData.length; i++) {
                    vector.set(0, i, newData[i]);
                }
                return vector;
            }

            /**
             * Creates a column vector, a matrix with only one column.
             * @param {Array} newData - A 1D array containing data for the vector
             * @return {Matrix} - The new matrix
             */
            static columnVector(this: typeof Matrix, newData: number[]): Matrix;
            static columnVector(newData: number[]): AbstractMatrix;
            static columnVector(newData: number[]): AbstractMatrix {
                var vector = new this(newData.length, 1);
                for (var i = 0; i < newData.length; i++) {
                    vector.set(i, 0, newData[i]);
                }
                return vector;
            }

            /**
             * Creates an empty matrix with the given dimensions. Values will be undefined. Same as using new Matrix(rows, columns).
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static empty(this: typeof Matrix, rows: number, columns: number): Matrix;
            static empty(rows: number, columns: number): AbstractMatrix;
            static empty(rows: number, columns: number): AbstractMatrix {
                return new this(rows, columns);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be set to zero.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static zeros(this: typeof Matrix, rows: number, columns: number): Matrix;
            static zeros(rows: number, columns: number): AbstractMatrix;
            static zeros(rows: number, columns: number): AbstractMatrix {
                return this.empty(rows, columns).fill(0);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be set to one.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static ones(this: typeof Matrix, rows: number, columns: number): Matrix;
            static ones(rows: number, columns: number): AbstractMatrix;
            static ones(rows: number, columns: number): AbstractMatrix {
                return this.empty(rows, columns).fill(1);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be randomly set.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @param {function} [rng=Math.random] - Random number generator
             * @return {Matrix} The new matrix
             */
            static rand(this: typeof Matrix, rows: number, columns: number, rng?: () => number): Matrix;
            static rand(rows: number, columns: number, rng?: () => number): AbstractMatrix;
            static rand(rows: number, columns: number, rng?: () => number): AbstractMatrix {
                if (rng === undefined) rng = random;
                var matrix = this.empty(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        matrix.set(i, j, rng());
                    }
                }
                return matrix;
            }

            /**
             * Creates a matrix with the given dimensions. Values will be random integers.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @param {number} [maxValue=1000] - Maximum value
             * @param {function} [rng=Math.random] - Random number generator
             * @return {Matrix} The new matrix
             */
            static randInt(this: typeof Matrix, rows: number, columns: number, maxValue?: number, rng?: () => number): Matrix;
            static randInt(rows: number, columns: number, maxValue?: number, rng?: () => number): AbstractMatrix;
            static randInt(rows: number, columns: number, maxValue?: number, rng?: () => number): AbstractMatrix {
                if (maxValue === undefined) maxValue = 1000;
                if (rng === undefined) rng = random;
                var matrix = this.empty(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        var value = Math.floor(rng() * maxValue);
                        matrix.set(i, j, value);
                    }
                }
                return matrix;
            }

            /**
             * Creates an identity matrix with the given dimension. Values of the diagonal will be 1 and others will be 0.
             * @param {number} rows - Number of rows
             * @param {number} [columns=rows] - Number of columns
             * @param {number} [value=1] - Value to fill the diagonal with
             * @return {Matrix} - The new identity matrix
             */
            static eye(this: typeof Matrix, rows: number, columns?: number, value?: number): Matrix;
            static eye(rows: number, columns?: number, value?: number): AbstractMatrix;
            static eye(rows: number, columns?: number, value?: number): AbstractMatrix {
                if (columns === undefined) columns = rows;
                if (value === undefined) value = 1;
                var min = Math.min(rows, columns);
                var matrix = this.zeros(rows, columns);
                for (var i = 0; i < min; i++) {
                    matrix.set(i, i, value);
                }
                return matrix;
            }

            /**
             * Creates a diagonal matrix based on the given array.
             * @param {Array} data - Array containing the data for the diagonal
             * @param {number} [rows] - Number of rows (Default: data.length)
             * @param {number} [columns] - Number of columns (Default: rows)
             * @return {Matrix} - The new diagonal matrix
             */
            static diag(this: typeof Matrix, data: number[], rows?: number, columns?: number): Matrix;
            static diag(data: number[], rows?: number, columns?: number): AbstractMatrix;
            static diag(data: number[], rows?: number, columns?: number): AbstractMatrix {
                var l = data.length;
                if (rows === undefined) rows = l;
                if (columns === undefined) columns = rows;
                var min = Math.min(l, rows, columns);
                var matrix = this.zeros(rows, columns);
                for (var i = 0; i < min; i++) {
                    matrix.set(i, i, data[i]);
                }
                return matrix;
            }

            /**
             * Returns a matrix whose elements are the minimum between matrix1 and matrix2
             * @param {Matrix} matrix1
             * @param {Matrix} matrix2
             * @return {Matrix}
             */
            static min(this: typeof Matrix, matrix1: MatrixInput, matrix2: MatrixInput): Matrix;
            static min(matrix1: MatrixInput, matrix2: MatrixInput): AbstractMatrix;
            static min(matrix1: MatrixInput, matrix2: MatrixInput): AbstractMatrix {
                matrix1 = this.checkMatrix(matrix1);
                matrix2 = this.checkMatrix(matrix2);
                var rows = matrix1.rows;
                var columns = matrix1.columns;
                var result = new this(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        result.set(i, j, Math.min(matrix1.get(i, j), matrix2.get(i, j)));
                    }
                }
                return result;
            }

            /**
             * Returns a matrix whose elements are the maximum between matrix1 and matrix2
             * @param {Matrix} matrix1
             * @param {Matrix} matrix2
             * @return {Matrix}
             */
            static max(this: typeof Matrix, matrix1: MatrixInput, matrix2: MatrixInput): Matrix;
            static max(matrix1: MatrixInput, matrix2: MatrixInput): AbstractMatrix;
            static max(matrix1: MatrixInput, matrix2: MatrixInput): AbstractMatrix {
                matrix1 = this.checkMatrix(matrix1);
                matrix2 = this.checkMatrix(matrix2);
                var rows = matrix1.rows;
                var columns = matrix1.columns;
                var result = new this(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        result.set(i, j, Math.max(matrix1.get(i, j), matrix2.get(i, j)));
                    }
                }
                return result;
            }

            /**
             * Check that the provided value is a Matrix and tries to instantiate one if not
             * @param {*} value - The value to check
             * @return {Matrix}
             */
            static checkMatrix(this: typeof Matrix, value: Matrix | number[][]): Matrix;
            static checkMatrix(value: MatrixInput): MatrixLike;
            static checkMatrix(value: MatrixInput): MatrixLike {
                return Matrix.isMatrix(value) ? value : new this(value);
            }

            /**
             * Returns true if the argument is a Matrix, false otherwise
             * @param {*} value - The value to check
             * @return {boolean}
             */
            static isMatrix(value: unknown): value is MatrixLike {
                return (typeof value === 'object') && (value != null) && ('klass' in value) && (value.klass === 'Matrix');
            }

            /**
             * @prop {number} size - The number of elements in the matrix.
             */
            get size(): number {
                return this.rows * this.columns;
            }

            /**
             * Applies a callback for each element of the matrix. The function is called in the matrix (this) context.
             * @param {function} callback - Function that will be called with two parameters : i (row) and j (column)
             * @return {Matrix} this
             */
            apply<T extends MatrixLike>(this: T, callback: (this: T, i: number, j: number) => void): T {
                if (typeof callback !== 'function') {
                    throw new TypeError('callback must be a function');
                }
                var ii = this.rows;
                var jj = this.columns;
                for (var i = 0; i < ii; i++) {
                    for (var j = 0; j < jj; j++) {
                        callback.call(this, i, j);
                    }
                }
                return this;
            }

            /**
             * Returns a new 1D array filled row by row with the matrix values
             * @return {Array}
             */
            to1DArray(): number[] {
                var array: number[] = new Array(this.size);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        array[i * this.columns + j] = this.get(i, j);
                    }
                }
                return array;
            }

            /**
             * Returns a 2D array containing a copy of the data
             * @return {Array}
             */
            to2DArray(): number[][] {
                var copy: number[][] = new Array(this.rows);
                for (var i = 0; i < this.rows; i++) {
                    copy[i] = new Array(this.columns);
                    for (var j = 0; j < this.columns; j++) {
                        copy[i][j] = this.get(i, j);
                    }
                }
                return copy;
            }

            /**
             * @return {boolean} true if the matrix has one row
             */
            isRowVector(): boolean {
                return this.rows === 1;
            }

            /**
             * @return {boolean} true if the matrix has one column
             */
            isColumnVector(): boolean {
                return this.columns === 1;
            }

            /**
             * @return {boolean} true if the matrix has one row or one column
             */
            isVector(): boolean {
                return (this.rows === 1) || (this.columns === 1);
            }

            /**
             * @return {boolean} true if the matrix has the same number of rows and columns
             */
            isSquare(): boolean {
                return this.rows === this.columns;
            }

            /**
             * @return {boolean} true if the matrix is square and has the same values on both sides of the diagonal
             */
            isSymmetric(): boolean {
                if (this.isSquare()) {
                    for (var i = 0; i < this.rows; i++) {
                        for (var j = 0; j <= i; j++) {
                            if (this.get(i, j) !== this.get(j, i)) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
                return false;
            }

            /**
             * Sets a given element of the matrix. mat.set(3,4,1) is equivalent to mat[3][4]=1
             * @abstract
             * @param {number} rowIndex - Index of the row
             * @param {number} columnIndex - Index of the column
             * @param {number} value - The new value for the element
             * @return {Matrix} this
             */
            set(rowIndex: number, columnIndex: number, value: number): this { // eslint-disable-line no-unused-vars
                throw new Error('set method is unimplemented');
            }

            /**
             * Returns the given element of the matrix. mat.get(3,4) is equivalent to matrix[3][4]
             * @abstract
             * @param {number} rowIndex - Index of the row
             * @param {number} columnIndex - Index of the column
             * @return {number}
             */
            get(rowIndex: number, columnIndex: number): number { // eslint-disable-line no-unused-vars
                throw new Error('get method is unimplemented');
            }

            /**
             * Creates a new matrix that is a repetition of the current matrix. New matrix has rowRep times the number of
             * rows of the matrix, and colRep times the number of columns of the matrix
             * @param {number} rowRep - Number of times the rows should be repeated
             * @param {number} colRep - Number of times the columns should be re
             * @return {Matrix}
             * @example
             * var matrix = new Matrix([[1,2]]);
             * matrix.repeat(2); // [[1,2],[1,2]]
             */
            repeat(rowRep?: number, colRep?: number): Matrix {
                rowRep = rowRep || 1;
                colRep = colRep || 1;
                var matrix = new Matrix(this.rows * rowRep, this.columns * colRep);
                for (var i = 0; i < rowRep; i++) {
                    for (var j = 0; j < colRep; j++) {
                        matrix.setSubMatrix(this, this.rows * i, this.columns * j);
                    }
                }
                return matrix;
            }

            /**
             * Fills the matrix with a given value. All elements will be set to this value.
             * @param {number} value - New value
             * @return {Matrix} this
             */
            fill(value: number): this {
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, value);
                    }
                }
                return this;
            }

            /**
             * Negates the matrix. All elements will be multiplied by (-1)
             * @return {Matrix} this
             */
            neg(): this {
                return this.mulS(-1);
            }

            /**
             * Returns a new array from the given row index
             * @param {number} index - Row index
             * @return {Array}
             */
            getRow(index: number): number[] {
                util.checkRowIndex(this, index);
                var row: number[] = new Array(this.columns);
                for (var i = 0; i < this.columns; i++) {
                    row[i] = this.get(index, i);
                }
                return row;
            }

            /**
             * Returns a new row vector from the given row index
             * @param {number} index - Row index
             * @return {Matrix}
             */
            getRowVector(index: number): MatrixLike {
                return this.constructor.rowVector(this.getRow(index));
            }

            /**
             * Sets a row at the given index
             * @param {number} index - Row index
             * @param {Array|Matrix} array - Array or vector
             * @return {Matrix} this
             */
            setRow(index: number, array: MatrixVector): this {
                util.checkRowIndex(this, index);
                array = util.checkRowVector(this, array);
                for (var i = 0; i < this.columns; i++) {
                    this.set(index, i, array[i]);
                }
                return this;
            }

            /**
             * Swaps two rows
             * @param {number} row1 - First row index
             * @param {number} row2 - Second row index
             * @return {Matrix} this
             */
            swapRows(row1: number, row2: number): this {
                util.checkRowIndex(this, row1);
                util.checkRowIndex(this, row2);
                for (var i = 0; i < this.columns; i++) {
                    var temp = this.get(row1, i);
                    this.set(row1, i, this.get(row2, i));
                    this.set(row2, i, temp);
                }
                return this;
            }

            /**
             * Returns a new array from the given column index
             * @param {number} index - Column index
             * @return {Array}
             */
            getColumn(index: number): number[] {
                util.checkColumnIndex(this, index);
                var column: number[] = new Array(this.rows);
                for (var i = 0; i < this.rows; i++) {
                    column[i] = this.get(i, index);
                }
                return column;
            }

            /**
             * Returns a new column vector from the given column index
             * @param {number} index - Column index
             * @return {Matrix}
             */
            getColumnVector(index: number): MatrixLike {
                return this.constructor.columnVector(this.getColumn(index));
            }

            /**
             * Sets a column at the given index
             * @param {number} index - Column index
             * @param {Array|Matrix} array - Array or vector
             * @return {Matrix} this
             */
            setColumn(index: number, array: MatrixVector): this {
                util.checkColumnIndex(this, index);
                array = util.checkColumnVector(this, array);
                for (var i = 0; i < this.rows; i++) {
                    this.set(i, index, array[i]);
                }
                return this;
            }

            /**
             * Swaps two columns
             * @param {number} column1 - First column index
             * @param {number} column2 - Second column index
             * @return {Matrix} this
             */
            swapColumns(column1: number, column2: number): this {
                util.checkColumnIndex(this, column1);
                util.checkColumnIndex(this, column2);
                for (var i = 0; i < this.rows; i++) {
                    var temp = this.get(i, column1);
                    this.set(i, column1, this.get(i, column2));
                    this.set(i, column2, temp);
                }
                return this;
            }

            /**
             * Adds the values of a vector to each row
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            addRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) + vector[j]);
                    }
                }
                return this;
            }

            /**
             * Subtracts the values of a vector from each row
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            subRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) - vector[j]);
                    }
                }
                return this;
            }

            /**
             * Multiplies the values of a vector with each row
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            mulRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) * vector[j]);
                    }
                }
                return this;
            }

            /**
             * Divides the values of each row by those of a vector
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            divRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) / vector[j]);
                    }
                }
                return this;
            }

            /**
             * Adds the values of a vector to each column
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            addColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) + vector[i]);
                    }
                }
                return this;
            }

            /**
             * Subtracts the values of a vector from each column
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            subColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) - vector[i]);
                    }
                }
                return this;
            }

            /**
             * Multiplies the values of a vector with each column
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            mulColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) * vector[i]);
                    }
                }
                return this;
            }

            /**
             * Divides the values of each column by those of a vector
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            divColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) / vector[i]);
                    }
                }
                return this;
            }

            /**
             * Multiplies the values of a row with a scalar
             * @param {number} index - Row index
             * @param {number} value
             * @return {Matrix} this
             */
            mulRow(index: number, value: number): this {
                util.checkRowIndex(this, index);
                for (var i = 0; i < this.columns; i++) {
                    this.set(index, i, this.get(index, i) * value);
                }
                return this;
            }

            /**
             * Multiplies the values of a column with a scalar
             * @param {number} index - Column index
             * @param {number} value
             * @return {Matrix} this
             */
            mulColumn(index: number, value: number): this {
                util.checkColumnIndex(this, index);
                for (var i = 0; i < this.rows; i++) {
                    this.set(i, index, this.get(i, index) * value);
                }
                return this;
            }

            /**
             * Returns the maximum value of the matrix
             * @return {number}
             */
            max(): number {
                var v = this.get(0, 0);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) > v) {
                            v = this.get(i, j);
                        }
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value
             * @return {Array}
             */
            maxIndex(): number[] {
                var v = this.get(0, 0);
                var idx = [0, 0];
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) > v) {
                            v = this.get(i, j);
                            idx[0] = i;
                            idx[1] = j;
                        }
                    }
                }
                return idx;
            }

            /**
             * Returns the minimum value of the matrix
             * @return {number}
             */
            min(): number {
                var v = this.get(0, 0);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) < v) {
                            v = this.get(i, j);
                        }
                    }
                }
                return v;
            }

            /**
             * Returns the index of the minimum value
             * @return {Array}
             */
            minIndex(): number[] {
                var v = this.get(0, 0);
                var idx = [0, 0];
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) < v) {
                            v = this.get(i, j);
                            idx[0] = i;
                            idx[1] = j;
                        }
                    }
                }
                return idx;
            }

            /**
             * Returns the maximum value of one row
             * @param {number} row - Row index
             * @return {number}
             */
            maxRow(row: number): number {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) > v) {
                        v = this.get(row, i);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value of one row
             * @param {number} row - Row index
             * @return {Array}
             */
            maxRowIndex(row: number): number[] {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                var idx = [row, 0];
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) > v) {
                        v = this.get(row, i);
                        idx[1] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns the minimum value of one row
             * @param {number} row - Row index
             * @return {number}
             */
            minRow(row: number): number {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) < v) {
                        v = this.get(row, i);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value of one row
             * @param {number} row - Row index
             * @return {Array}
             */
            minRowIndex(row: number): number[] {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                var idx = [row, 0];
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) < v) {
                        v = this.get(row, i);
                        idx[1] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns the maximum value of one column
             * @param {number} column - Column index
             * @return {number}
             */
            maxColumn(column: number): number {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) > v) {
                        v = this.get(i, column);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value of one column
             * @param {number} column - Column index
             * @return {Array}
             */
            maxColumnIndex(column: number): number[] {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                var idx = [0, column];
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) > v) {
                        v = this.get(i, column);
                        idx[0] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns the minimum value of one column
             * @param {number} column - Column index
             * @return {number}
             */
            minColumn(column: number): number {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) < v) {
                        v = this.get(i, column);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the minimum value of one column
             * @param {number} column - Column index
             * @return {Array}
             */
            minColumnIndex(column: number): number[] {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                var idx = [0, column];
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) < v) {
                        v = this.get(i, column);
                        idx[0] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns an array containing the diagonal values of the matrix
             * @return {Array}
             */
            diag(): number[] {
                var min = Math.min(this.rows, this.columns);
                var diag: number[] = new Array(min);
                for (var i = 0; i < min; i++) {
                    diag[i] = this.get(i, i);
                }
                return diag;
            }

            /**
             * Returns the sum by the argument given, if no argument given,
             * it returns the sum of all elements of the matrix.
             * @param {string} by - sum by 'row' or 'column'.
             * @return {Matrix|number}
             */
            sum(): number;
            sum(by: 'row' | 'column'): Matrix;
            sum(by?: string): Matrix | number;
            sum(by?: string): Matrix | number {
                switch (by) {
                    case 'row':
                        return util.sumByRow(this);
                    case 'column':
                        return util.sumByColumn(this);
                    default:
                        return util.sumAll(this);
                }
            }

            /**
             * Returns the mean of all elements of the matrix
             * @return {number}
             */
            mean(): number {
                return this.sum() / this.size;
            }

            /**
             * Returns the product of all elements of the matrix
             * @return {number}
             */
            prod(): number {
                var prod = 1;
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        prod *= this.get(i, j);
                    }
                }
                return prod;
            }

            /**
             * Computes the cumulative sum of the matrix elements (in place, row by row)
             * @return {Matrix} this
             */
            cumulativeSum(): this {
                var sum = 0;
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        sum += this.get(i, j);
                        this.set(i, j, sum);
                    }
                }
                return this;
            }

            /**
             * Computes the dot (scalar) product between the matrix and another
             * @param {Matrix} vector2 vector
             * @return {number}
             */
            dot(vector2: MatrixVector): number {
                if (Matrix.isMatrix(vector2)) vector2 = vector2.to1DArray();
                var vector1 = this.to1DArray();
                if (vector1.length !== vector2.length) {
                    throw new RangeError('vectors do not have the same size');
                }
                var dot = 0;
                for (var i = 0; i < vector1.length; i++) {
                    dot += vector1[i] * vector2[i];
                }
                return dot;
            }

            /**
             * Returns the matrix product between this and other
             * @param {Matrix} other
             * @return {Matrix}
             */
            mmul(other: MatrixInput): Matrix {
                other = this.constructor.checkMatrix(other);
                if (this.columns !== other.rows) {
                    // eslint-disable-next-line no-console
                    // Host warning output omitted; arithmetic continues as upstream.
                }

                var m = this.rows;
                var n = this.columns;
                var p = other.columns;

                var result = new Matrix(m, p);

                var Bcolj: number[] = new Array(n);
                for (var j = 0; j < p; j++) {
                    for (var k = 0; k < n; k++) {
                        Bcolj[k] = other.get(k, j);
                    }

                    for (var i = 0; i < m; i++) {
                        var s = 0;
                        for (k = 0; k < n; k++) {
                            s += this.get(i, k) * Bcolj[k];
                        }

                        result.set(i, j, s);
                    }
                }
                return result;
            }

            strassen2x2(other: MatrixLike): Matrix {
                var result = new Matrix(2, 2);
                const a11 = this.get(0, 0);
                const b11 = other.get(0, 0);
                const a12 = this.get(0, 1);
                const b12 = other.get(0, 1);
                const a21 = this.get(1, 0);
                const b21 = other.get(1, 0);
                const a22 = this.get(1, 1);
                const b22 = other.get(1, 1);

                // Compute intermediate values.
                const m1 = (a11 + a22) * (b11 + b22);
                const m2 = (a21 + a22) * b11;
                const m3 = a11 * (b12 - b22);
                const m4 = a22 * (b21 - b11);
                const m5 = (a11 + a12) * b22;
                const m6 = (a21 - a11) * (b11 + b12);
                const m7 = (a12 - a22) * (b21 + b22);

                // Combine intermediate values into the output.
                const c00 = m1 + m4 - m5 + m7;
                const c01 = m3 + m5;
                const c10 = m2 + m4;
                const c11 = m1 - m2 + m3 + m6;

                result.set(0, 0, c00);
                result.set(0, 1, c01);
                result.set(1, 0, c10);
                result.set(1, 1, c11);
                return result;
            }

            strassen3x3(other: MatrixLike): Matrix {
                var result = new Matrix(3, 3);

                const a00 = this.get(0, 0);
                const a01 = this.get(0, 1);
                const a02 = this.get(0, 2);
                const a10 = this.get(1, 0);
                const a11 = this.get(1, 1);
                const a12 = this.get(1, 2);
                const a20 = this.get(2, 0);
                const a21 = this.get(2, 1);
                const a22 = this.get(2, 2);

                const b00 = other.get(0, 0);
                const b01 = other.get(0, 1);
                const b02 = other.get(0, 2);
                const b10 = other.get(1, 0);
                const b11 = other.get(1, 1);
                const b12 = other.get(1, 2);
                const b20 = other.get(2, 0);
                const b21 = other.get(2, 1);
                const b22 = other.get(2, 2);

                const m1 = (a00 + a01 + a02 - a10 - a11 - a21 - a22) * b11;
                const m2 = (a00 - a10) * (-b01 + b11);
                const m3 = a11 * (-b00 + b01 + b10 - b11 - b12 - b20 + b22);
                const m4 = (-a00 + a10 + a11) * (b00 - b01 + b11);
                const m5 = (a10 + a11) * (-b00 + b01);
                const m6 = a00 * b00;
                const m7 = (-a00 + a20 + a21) * (b00 - b02 + b12);
                const m8 = (-a00 + a20) * (b02 - b12);
                const m9 = (a20 + a21) * (-b00 + b02);
                const m10 = (a00 + a01 + a02 - a11 - a12 - a20 - a21) * b12;
                const m11 = a21 * (-b00 + b02 + b10 - b11 - b12 - b20 + b21);
                const m12 = (-a02 + a21 + a22) * (b11 + b20 - b21);
                const m13 = (a02 - a22) * (b11 - b21);
                const m14 = a02 * b20;
                const m15 = (a21 + a22) * (-b20 + b21);
                const m16 = (-a02 + a11 + a12) * (b12 + b20 - b22);
                const m17 = (a02 - a12) * (b12 - b22);
                const m18 = (a11 + a12) * (-b20 + b22);
                const m19 = a01 * b10;
                const m20 = a12 * b21;
                const m21 = a10 * b02;
                const m22 = a20 * b01;
                const m23 = a22 * b22;

                const c00 = m6 + m14 + m19;
                const c01 = m1 + m4 + m5 + m6 + m12 + m14 + m15;
                const c02 = m6 + m7 + m9 + m10 + m14 + m16 + m18;
                const c10 = m2 + m3 + m4 + m6 + m14 + m16 + m17;
                const c11 = m2 + m4 + m5 + m6 + m20;
                const c12 = m14 + m16 + m17 + m18 + m21;
                const c20 = m6 + m7 + m8 + m11 + m12 + m13 + m14;
                const c21 = m12 + m13 + m14 + m15 + m22;
                const c22 = m6 + m7 + m8 + m9 + m23;

                result.set(0, 0, c00);
                result.set(0, 1, c01);
                result.set(0, 2, c02);
                result.set(1, 0, c10);
                result.set(1, 1, c11);
                result.set(1, 2, c12);
                result.set(2, 0, c20);
                result.set(2, 1, c21);
                result.set(2, 2, c22);
                return result;
            }

            /**
             * Returns the matrix product between x and y. More efficient than mmul(other) only when we multiply squared matrix and when the size of the matrix is > 1000.
             * @param {Matrix} y
             * @return {Matrix}
             */
            mmulStrassen(y: Matrix): Matrix {
                // Views have no clone method upstream; retain that TypeError.
                if (!(this instanceof Matrix))
                    throw new TypeError('this.clone is not a function');
                var x = this.clone();
                var r1 = x.rows;
                var c1 = x.columns;
                var r2 = y.rows;
                var c2 = y.columns;
                if (c1 !== r2) {
                    // eslint-disable-next-line no-console
                    // Host warning output omitted; arithmetic continues as upstream.
                }

                // Put a matrix into the top left of a matrix of zeros.
                // `rows` and `cols` are the dimensions of the output matrix.
                function embed(mat: Matrix, rows: number, cols: number): Matrix {
                    var r = mat.rows;
                    var c = mat.columns;
                    if ((r === rows) && (c === cols)) {
                        return mat;
                    } else {
                        var resultat = Matrix.zeros(rows, cols);
                        resultat = resultat.setSubMatrix(mat, 0, 0);
                        return resultat;
                    }
                }


                // Make sure both matrices are the same size.
                // This is exclusively for simplicity:
                // this algorithm can be implemented with matrices of different sizes.

                var r = Math.max(r1, r2);
                var c = Math.max(c1, c2);
                x = embed(x, r, c);
                y = embed(y, r, c);

                // Our recursive multiplication function.
                function blockMult(a: Matrix, b: Matrix, rows: number, cols: number): Matrix {
                    // For small matrices, resort to naive multiplication.
                    if (rows <= 512 || cols <= 512) {
                        return a.mmul(b); // a is equivalent to this
                    }

                    // Apply dynamic padding.
                    if ((rows % 2 === 1) && (cols % 2 === 1)) {
                        a = embed(a, rows + 1, cols + 1);
                        b = embed(b, rows + 1, cols + 1);
                    } else if (rows % 2 === 1) {
                        a = embed(a, rows + 1, cols);
                        b = embed(b, rows + 1, cols);
                    } else if (cols % 2 === 1) {
                        a = embed(a, rows, cols + 1);
                        b = embed(b, rows, cols + 1);
                    }

                    var halfRows = parseInt(String(a.rows / 2));
                    var halfCols = parseInt(String(a.columns / 2));
                    // Subdivide input matrices.
                    var a11 = a.subMatrix(0, halfRows - 1, 0, halfCols - 1);
                    var b11 = b.subMatrix(0, halfRows - 1, 0, halfCols - 1);

                    var a12 = a.subMatrix(0, halfRows - 1, halfCols, a.columns - 1);
                    var b12 = b.subMatrix(0, halfRows - 1, halfCols, b.columns - 1);

                    var a21 = a.subMatrix(halfRows, a.rows - 1, 0, halfCols - 1);
                    var b21 = b.subMatrix(halfRows, b.rows - 1, 0, halfCols - 1);

                    var a22 = a.subMatrix(halfRows, a.rows - 1, halfCols, a.columns - 1);
                    var b22 = b.subMatrix(halfRows, b.rows - 1, halfCols, b.columns - 1);

                    // Compute intermediate values.
                    var m1 = blockMult(Matrix.add(a11, a22), Matrix.add(b11, b22), halfRows, halfCols);
                    var m2 = blockMult(Matrix.add(a21, a22), b11, halfRows, halfCols);
                    var m3 = blockMult(a11, Matrix.sub(b12, b22), halfRows, halfCols);
                    var m4 = blockMult(a22, Matrix.sub(b21, b11), halfRows, halfCols);
                    var m5 = blockMult(Matrix.add(a11, a12), b22, halfRows, halfCols);
                    var m6 = blockMult(Matrix.sub(a21, a11), Matrix.add(b11, b12), halfRows, halfCols);
                    var m7 = blockMult(Matrix.sub(a12, a22), Matrix.add(b21, b22), halfRows, halfCols);

                    // Combine intermediate values into the output.
                    var c11 = Matrix.add(m1, m4);
                    c11.sub(m5);
                    c11.add(m7);
                    var c12 = Matrix.add(m3, m5);
                    var c21 = Matrix.add(m2, m4);
                    var c22 = Matrix.sub(m1, m2);
                    c22.add(m3);
                    c22.add(m6);

                    //Crop output to the desired size (undo dynamic padding).
                    var resultat = Matrix.zeros(2 * c11.rows, 2 * c11.columns);
                    resultat = resultat.setSubMatrix(c11, 0, 0);
                    resultat = resultat.setSubMatrix(c12, c11.rows, 0);
                    resultat = resultat.setSubMatrix(c21, 0, c11.columns);
                    resultat = resultat.setSubMatrix(c22, c11.rows, c11.columns);
                    return resultat.subMatrix(0, rows - 1, 0, cols - 1);
                }
                return blockMult(x, y, r, c);
            }

            /**
             * Returns a row-by-row scaled matrix
             * @param {number} [min=0] - Minimum scaled value
             * @param {number} [max=1] - Maximum scaled value
             * @return {Matrix} - The scaled matrix
             */
            scaleRows(min?: number, max?: number): MatrixLike {
                min = min === undefined ? 0 : min;
                max = max === undefined ? 1 : max;
                if (min >= max) {
                    throw new RangeError('min should be strictly smaller than max');
                }
                var newMatrix = this.constructor.empty(this.rows, this.columns);
                for (var i = 0; i < this.rows; i++) {
                    var scaled = arrayUtils.scale!(this.getRow(i), {min, max});
                    newMatrix.setRow(i, scaled);
                }
                return newMatrix;
            }

            /**
             * Returns a new column-by-column scaled matrix
             * @param {number} [min=0] - Minimum scaled value
             * @param {number} [max=1] - Maximum scaled value
             * @return {Matrix} - The new scaled matrix
             * @example
             * var matrix = new Matrix([[1,2],[-1,0]]);
             * var scaledMatrix = matrix.scaleColumns(); // [[1,1],[0,0]]
             */
            scaleColumns(min?: number, max?: number): MatrixLike {
                min = min === undefined ? 0 : min;
                max = max === undefined ? 1 : max;
                if (min >= max) {
                    throw new RangeError('min should be strictly smaller than max');
                }
                var newMatrix = this.constructor.empty(this.rows, this.columns);
                for (var i = 0; i < this.columns; i++) {
                    var scaled = arrayUtils.scale!(this.getColumn(i), {
                        min: min,
                        max: max
                    });
                    newMatrix.setColumn(i, scaled);
                }
                return newMatrix;
            }


            /**
             * Returns the Kronecker product (also known as tensor product) between this and other
             * See https://en.wikipedia.org/wiki/Kronecker_product
             * @param {Matrix} other
             * @return {Matrix}
             */
            kroneckerProduct(other: MatrixInput): Matrix {
                other = this.constructor.checkMatrix(other);

                var m = this.rows;
                var n = this.columns;
                var p = other.rows;
                var q = other.columns;

                var result = new Matrix(m * p, n * q);
                for (var i = 0; i < m; i++) {
                    for (var j = 0; j < n; j++) {
                        for (var k = 0; k < p; k++) {
                            for (var l = 0; l < q; l++) {
                                result[p * i + k][q * j + l] = this.get(i, j) * other.get(k, l);
                            }
                        }
                    }
                }
                return result;
            }

            /**
             * Transposes the matrix and returns a new one containing the result
             * @return {Matrix}
             */
            transpose(): Matrix {
                var result = new Matrix(this.columns, this.rows);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        result.set(j, i, this.get(i, j));
                    }
                }
                return result;
            }

            /**
             * Sorts the rows (in place)
             * @param {function} compareFunction - usual Array.prototype.sort comparison function
             * @return {Matrix} this
             */
            sortRows(compareFunction?: (a: number, b: number) => number): this {
                if (compareFunction === undefined) compareFunction = compareNumbers;
                for (var i = 0; i < this.rows; i++) {
                    this.setRow(i, this.getRow(i).sort(compareFunction));
                }
                return this;
            }

            /**
             * Sorts the columns (in place)
             * @param {function} compareFunction - usual Array.prototype.sort comparison function
             * @return {Matrix} this
             */
            sortColumns(compareFunction?: (a: number, b: number) => number): this {
                if (compareFunction === undefined) compareFunction = compareNumbers;
                for (var i = 0; i < this.columns; i++) {
                    this.setColumn(i, this.getColumn(i).sort(compareFunction));
                }
                return this;
            }

            /**
             * Returns a subset of the matrix
             * @param {number} startRow - First row index
             * @param {number} endRow - Last row index
             * @param {number} startColumn - First column index
             * @param {number} endColumn - Last column index
             * @return {Matrix}
             */
            subMatrix(startRow: number, endRow: number, startColumn: number, endColumn: number): Matrix {
                util.checkRange(this, startRow, endRow, startColumn, endColumn);
                var newMatrix = new Matrix(endRow - startRow + 1, endColumn - startColumn + 1);
                for (var i = startRow; i <= endRow; i++) {
                    for (var j = startColumn; j <= endColumn; j++) {
                        newMatrix[i - startRow][j - startColumn] = this.get(i, j);
                    }
                }
                return newMatrix;
            }

            /**
             * Returns a subset of the matrix based on an array of row indices
             * @param {Array} indices - Array containing the row indices
             * @param {number} [startColumn = 0] - First column index
             * @param {number} [endColumn = this.columns-1] - Last column index
             * @return {Matrix}
             */
            subMatrixRow(indices: number[], startColumn?: number, endColumn?: number): Matrix {
                if (startColumn === undefined) startColumn = 0;
                if (endColumn === undefined) endColumn = this.columns - 1;
                if ((startColumn > endColumn) || (startColumn < 0) || (startColumn >= this.columns) || (endColumn < 0) || (endColumn >= this.columns)) {
                    throw new RangeError('Argument out of range');
                }

                var newMatrix = new Matrix(indices.length, endColumn - startColumn + 1);
                for (var i = 0; i < indices.length; i++) {
                    for (var j = startColumn; j <= endColumn; j++) {
                        if (indices[i] < 0 || indices[i] >= this.rows) {
                            throw new RangeError('Row index out of range: ' + indices[i]);
                        }
                        newMatrix.set(i, j - startColumn, this.get(indices[i], j));
                    }
                }
                return newMatrix;
            }

            /**
             * Returns a subset of the matrix based on an array of column indices
             * @param {Array} indices - Array containing the column indices
             * @param {number} [startRow = 0] - First row index
             * @param {number} [endRow = this.rows-1] - Last row index
             * @return {Matrix}
             */
            subMatrixColumn(indices: number[], startRow?: number, endRow?: number): Matrix {
                if (startRow === undefined) startRow = 0;
                if (endRow === undefined) endRow = this.rows - 1;
                if ((startRow > endRow) || (startRow < 0) || (startRow >= this.rows) || (endRow < 0) || (endRow >= this.rows)) {
                    throw new RangeError('Argument out of range');
                }

                var newMatrix = new Matrix(endRow - startRow + 1, indices.length);
                for (var i = 0; i < indices.length; i++) {
                    for (var j = startRow; j <= endRow; j++) {
                        if (indices[i] < 0 || indices[i] >= this.columns) {
                            throw new RangeError('Column index out of range: ' + indices[i]);
                        }
                        newMatrix.set(j - startRow, i, this.get(j, indices[i]));
                    }
                }
                return newMatrix;
            }

            /**
             * Set a part of the matrix to the given sub-matrix
             * @param {Matrix|Array< Array >} matrix - The source matrix from which to extract values.
             * @param {number} startRow - The index of the first row to set
             * @param {number} startColumn - The index of the first column to set
             * @return {Matrix}
             */
            setSubMatrix(matrix: MatrixInput, startRow: number, startColumn: number): this {
                matrix = this.constructor.checkMatrix(matrix);
                var endRow = startRow + matrix.rows - 1;
                var endColumn = startColumn + matrix.columns - 1;
                util.checkRange(this, startRow, endRow, startColumn, endColumn);
                for (var i = 0; i < matrix.rows; i++) {
                    for (var j = 0; j < matrix.columns; j++) {
                        // Object-backed views have no row-array storage upstream.
                        if (!(this instanceof Matrix))
                            throw new TypeError("Cannot set properties of undefined (setting '" + (startColumn + j) + "')");
                        this[startRow + i][startColumn + j] = matrix.get(i, j);
                    }
                }
                return this;
            }

            /**
             * Return a new matrix based on a selection of rows and columns
             * @param {Array<number>} rowIndices - The row indices to select. Order matters and an index can be more than once.
             * @param {Array<number>} columnIndices - The column indices to select. Order matters and an index can be use more than once.
             * @return {Matrix} The new matrix
             */
            selection(rowIndices: number[], columnIndices: number[]): Matrix {
                var indices = util.checkIndices(this, rowIndices, columnIndices);
                var newMatrix = new Matrix(rowIndices.length, columnIndices.length);
                for (var i = 0; i < indices.row.length; i++) {
                    var rowIndex = indices.row[i];
                    for (var j = 0; j < indices.column.length; j++) {
                        var columnIndex = indices.column[j];
                        newMatrix[i][j] = this.get(rowIndex, columnIndex);
                    }
                }
                return newMatrix;
            }

            /**
             * Returns the trace of the matrix (sum of the diagonal elements)
             * @return {number}
             */
            trace(): number {
                var min = Math.min(this.rows, this.columns);
                var trace = 0;
                for (var i = 0; i < min; i++) {
                    trace += this.get(i, i);
                }
                return trace;
            }

            /*
             Matrix views
             */

            /**
             * Returns a view of the transposition of the matrix
             * @return {MatrixTransposeView}
             */
            transposeView(): MatrixTransposeView {
                return new MatrixTransposeView(this);
            }

            /**
             * Returns a view of the row vector with the given index
             * @param {number} row - row index of the vector
             * @return {MatrixRowView}
             */
            rowView(row: number): MatrixRowView {
                util.checkRowIndex(this, row);
                return new MatrixRowView(this, row);
            }

            /**
             * Returns a view of the column vector with the given index
             * @param {number} column - column index of the vector
             * @return {MatrixColumnView}
             */
            columnView(column: number): MatrixColumnView {
                util.checkColumnIndex(this, column);
                return new MatrixColumnView(this, column);
            }

            /**
             * Returns a view of the matrix flipped in the row axis
             * @return {MatrixFlipRowView}
             */
            flipRowView(): MatrixFlipRowView {
                return new MatrixFlipRowView(this);
            }

            /**
             * Returns a view of the matrix flipped in the column axis
             * @return {MatrixFlipColumnView}
             */
            flipColumnView(): MatrixFlipColumnView {
                return new MatrixFlipColumnView(this);
            }

            /**
             * Returns a view of a submatrix giving the index boundaries
             * @param {number} startRow - first row index of the submatrix
             * @param {number} endRow - last row index of the submatrix
             * @param {number} startColumn - first column index of the submatrix
             * @param {number} endColumn - last column index of the submatrix
             * @return {MatrixSubView}
             */
            subMatrixView(startRow: number, endRow: number, startColumn: number, endColumn: number): MatrixSubView {
                return new MatrixSubView(this, startRow, endRow, startColumn, endColumn);
            }

            /**
             * Returns a view of the cross of the row indices and the column indices
             * @example
             * // resulting vector is [[2], [2]]
             * var matrix = new Matrix([[1,2,3], [4,5,6]]).selectionView([0, 0], [1])
             * @param {Array<number>} rowIndices
             * @param {Array<number>} columnIndices
             * @return {MatrixSelectionView}
             */
            selectionView(rowIndices: number[], columnIndices: number[]): MatrixSelectionView {
                return new MatrixSelectionView(this, rowIndices, columnIndices);
            }



    // Constant operator templates expanded to declared methods; no runtime code generation.

    add(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.addS(value);
        return this.addM(value);
    
    }

    addS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) + value);
            }
        }
        return this;
    
    }

    addM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) + matrix.get(i, j));
            }
        }
        return this;
    
    }

    static add(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.add(value);
    
    }

    sub(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.subS(value);
        return this.subM(value);
    
    }

    subS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - value);
            }
        }
        return this;
    
    }

    subM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - matrix.get(i, j));
            }
        }
        return this;
    
    }

    static sub(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sub(value);
    
    }

    subtract(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.subS(value);
        return this.subM(value);
    
    }

    subtractS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - value);
            }
        }
        return this;
    
    }

    subtractM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - matrix.get(i, j));
            }
        }
        return this;
    
    }

    static subtract(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sub(value);
    
    }

    mul(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.mulS(value);
        return this.mulM(value);
    
    }

    mulS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * value);
            }
        }
        return this;
    
    }

    mulM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * matrix.get(i, j));
            }
        }
        return this;
    
    }

    static mul(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mul(value);
    
    }

    multiply(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.mulS(value);
        return this.mulM(value);
    
    }

    multiplyS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * value);
            }
        }
        return this;
    
    }

    multiplyM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * matrix.get(i, j));
            }
        }
        return this;
    
    }

    static multiply(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mul(value);
    
    }

    div(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.divS(value);
        return this.divM(value);
    
    }

    divS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / value);
            }
        }
        return this;
    
    }

    divM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / matrix.get(i, j));
            }
        }
        return this;
    
    }

    static div(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.div(value);
    
    }

    divide(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.divS(value);
        return this.divM(value);
    
    }

    divideS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / value);
            }
        }
        return this;
    
    }

    divideM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / matrix.get(i, j));
            }
        }
        return this;
    
    }

    static divide(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.div(value);
    
    }

    mod(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.modS(value);
        return this.modM(value);
    
    }

    modS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % value);
            }
        }
        return this;
    
    }

    modM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % matrix.get(i, j));
            }
        }
        return this;
    
    }

    static mod(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mod(value);
    
    }

    modulus(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.modS(value);
        return this.modM(value);
    
    }

    modulusS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % value);
            }
        }
        return this;
    
    }

    modulusM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % matrix.get(i, j));
            }
        }
        return this;
    
    }

    static modulus(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mod(value);
    
    }

    and(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.andS(value);
        return this.andM(value);
    
    }

    andS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) & value);
            }
        }
        return this;
    
    }

    andM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) & matrix.get(i, j));
            }
        }
        return this;
    
    }

    static and(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.and(value);
    
    }

    or(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.orS(value);
        return this.orM(value);
    
    }

    orS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) | value);
            }
        }
        return this;
    
    }

    orM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) | matrix.get(i, j));
            }
        }
        return this;
    
    }

    static or(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.or(value);
    
    }

    xor(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.xorS(value);
        return this.xorM(value);
    
    }

    xorS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) ^ value);
            }
        }
        return this;
    
    }

    xorM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) ^ matrix.get(i, j));
            }
        }
        return this;
    
    }

    static xor(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.xor(value);
    
    }

    leftShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.leftShiftS(value);
        return this.leftShiftM(value);
    
    }

    leftShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) << value);
            }
        }
        return this;
    
    }

    leftShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) << matrix.get(i, j));
            }
        }
        return this;
    
    }

    static leftShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.leftShift(value);
    
    }

    signPropagatingRightShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.signPropagatingRightShiftS(value);
        return this.signPropagatingRightShiftM(value);
    
    }

    signPropagatingRightShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >> value);
            }
        }
        return this;
    
    }

    signPropagatingRightShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >> matrix.get(i, j));
            }
        }
        return this;
    
    }

    static signPropagatingRightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.signPropagatingRightShift(value);
    
    }

    rightShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.rightShiftS(value);
        return this.rightShiftM(value);
    
    }

    rightShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> value);
            }
        }
        return this;
    
    }

    rightShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> matrix.get(i, j));
            }
        }
        return this;
    
    }

    static rightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.rightShift(value);
    
    }

    zeroFillRightShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.rightShiftS(value);
        return this.rightShiftM(value);
    
    }

    zeroFillRightShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> value);
            }
        }
        return this;
    
    }

    zeroFillRightShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> matrix.get(i, j));
            }
        }
        return this;
    
    }

    static zeroFillRightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.rightShift(value);
    
    }

    not(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, ~(this.get(i, j)));
            }
        }
        return this;
    
    }

    static not(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.not();
    
    }

    abs(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.abs(this.get(i, j)));
            }
        }
        return this;
    
    }

    static abs(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.abs();
    
    }

    acos(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.acos(this.get(i, j)));
            }
        }
        return this;
    
    }

    static acos(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.acos();
    
    }

    acosh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.acosh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static acosh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.acosh();
    
    }

    asin(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.asin(this.get(i, j)));
            }
        }
        return this;
    
    }

    static asin(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.asin();
    
    }

    asinh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.asinh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static asinh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.asinh();
    
    }

    atan(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.atan(this.get(i, j)));
            }
        }
        return this;
    
    }

    static atan(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.atan();
    
    }

    atanh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.atanh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static atanh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.atanh();
    
    }

    cbrt(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.cbrt(this.get(i, j)));
            }
        }
        return this;
    
    }

    static cbrt(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.cbrt();
    
    }

    ceil(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.ceil(this.get(i, j)));
            }
        }
        return this;
    
    }

    static ceil(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.ceil();
    
    }

    clz32(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.clz32(this.get(i, j)));
            }
        }
        return this;
    
    }

    static clz32(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.clz32();
    
    }

    cos(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.cos(this.get(i, j)));
            }
        }
        return this;
    
    }

    static cos(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.cos();
    
    }

    cosh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.cosh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static cosh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.cosh();
    
    }

    exp(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.exp(this.get(i, j)));
            }
        }
        return this;
    
    }

    static exp(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.exp();
    
    }

    expm1(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.expm1(this.get(i, j)));
            }
        }
        return this;
    
    }

    static expm1(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.expm1();
    
    }

    floor(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.floor(this.get(i, j)));
            }
        }
        return this;
    
    }

    static floor(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.floor();
    
    }

    fround(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.fround(this.get(i, j)));
            }
        }
        return this;
    
    }

    static fround(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.fround();
    
    }

    log(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log();
    
    }

    log1p(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log1p(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log1p(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log1p();
    
    }

    log10(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log10(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log10(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log10();
    
    }

    log2(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log2(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log2(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log2();
    
    }

    round(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.round(this.get(i, j)));
            }
        }
        return this;
    
    }

    static round(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.round();
    
    }

    sign(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sign(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sign(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sign();
    
    }

    sin(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sin(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sin(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sin();
    
    }

    sinh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sinh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sinh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sinh();
    
    }

    sqrt(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sqrt(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sqrt(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sqrt();
    
    }

    tan(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.tan(this.get(i, j)));
            }
        }
        return this;
    
    }

    static tan(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.tan();
    
    }

    tanh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.tanh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static tanh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.tanh();
    
    }

    trunc(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.trunc(this.get(i, j)));
            }
        }
        return this;
    
    }

    static trunc(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.trunc();
    
    }

    pow(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.powS(value);
        return this.powM(value);
    
    }

    powS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.pow(this.get(i, j), value));
            }
        }
        return this;
    
    }

    powM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.pow(this.get(i, j), matrix.get(i, j)));
            }
        }
        return this;
    
    }

    static pow(matrix: MatrixInput, arg0: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.pow(arg0);
    
    }

    static random = this.rand;
    static diagonal = this.diag;
    static identity = this.eye;
    diagonal(): number[] { return this.diag(); }
    negate(): this { return this.neg(); }
    tensorProduct(other: MatrixInput): Matrix { return this.kroneckerProduct(other); }

}

export class AbstractArrayMatrix extends ArrayStorage {
    declare rows: number;
    declare columns: number;
    declare ["constructor"]: typeof AbstractArrayMatrix;
    klass: string = "Matrix";


            /**
             * Constructs a Matrix with the chosen dimensions from a 1D array
             * @param {number} newRows - Number of rows
             * @param {number} newColumns - Number of columns
             * @param {Array} newData - A 1D array containing data for the matrix
             * @return {Matrix} - The new matrix
             */
            static from1DArray(this: typeof Matrix, newRows: number, newColumns: number, newData: number[]): Matrix;
            static from1DArray(newRows: number, newColumns: number, newData: number[]): AbstractArrayMatrix;
            static from1DArray(newRows: number, newColumns: number, newData: number[]): AbstractArrayMatrix {
                var length = newRows * newColumns;
                if (length !== newData.length) {
                    throw new RangeError('Data length does not match given dimensions');
                }
                var newMatrix = new this(newRows, newColumns);
                for (var row = 0; row < newRows; row++) {
                    for (var column = 0; column < newColumns; column++) {
                        newMatrix.set(row, column, newData[row * newColumns + column]);
                    }
                }
                return newMatrix;
            }

            /**
             * Creates a row vector, a matrix with only one row.
             * @param {Array} newData - A 1D array containing data for the vector
             * @return {Matrix} - The new matrix
             */
            static rowVector(this: typeof Matrix, newData: number[]): Matrix;
            static rowVector(newData: number[]): AbstractArrayMatrix;
            static rowVector(newData: number[]): AbstractArrayMatrix {
                var vector = new this(1, newData.length);
                for (var i = 0; i < newData.length; i++) {
                    vector.set(0, i, newData[i]);
                }
                return vector;
            }

            /**
             * Creates a column vector, a matrix with only one column.
             * @param {Array} newData - A 1D array containing data for the vector
             * @return {Matrix} - The new matrix
             */
            static columnVector(this: typeof Matrix, newData: number[]): Matrix;
            static columnVector(newData: number[]): AbstractArrayMatrix;
            static columnVector(newData: number[]): AbstractArrayMatrix {
                var vector = new this(newData.length, 1);
                for (var i = 0; i < newData.length; i++) {
                    vector.set(i, 0, newData[i]);
                }
                return vector;
            }

            /**
             * Creates an empty matrix with the given dimensions. Values will be undefined. Same as using new Matrix(rows, columns).
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static empty(this: typeof Matrix, rows: number, columns: number): Matrix;
            static empty(rows: number, columns: number): AbstractArrayMatrix;
            static empty(rows: number, columns: number): AbstractArrayMatrix {
                return new this(rows, columns);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be set to zero.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static zeros(this: typeof Matrix, rows: number, columns: number): Matrix;
            static zeros(rows: number, columns: number): AbstractArrayMatrix;
            static zeros(rows: number, columns: number): AbstractArrayMatrix {
                return this.empty(rows, columns).fill(0);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be set to one.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static ones(this: typeof Matrix, rows: number, columns: number): Matrix;
            static ones(rows: number, columns: number): AbstractArrayMatrix;
            static ones(rows: number, columns: number): AbstractArrayMatrix {
                return this.empty(rows, columns).fill(1);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be randomly set.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @param {function} [rng=Math.random] - Random number generator
             * @return {Matrix} The new matrix
             */
            static rand(this: typeof Matrix, rows: number, columns: number, rng?: () => number): Matrix;
            static rand(rows: number, columns: number, rng?: () => number): AbstractArrayMatrix;
            static rand(rows: number, columns: number, rng?: () => number): AbstractArrayMatrix {
                if (rng === undefined) rng = random;
                var matrix = this.empty(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        matrix.set(i, j, rng());
                    }
                }
                return matrix;
            }

            /**
             * Creates a matrix with the given dimensions. Values will be random integers.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @param {number} [maxValue=1000] - Maximum value
             * @param {function} [rng=Math.random] - Random number generator
             * @return {Matrix} The new matrix
             */
            static randInt(this: typeof Matrix, rows: number, columns: number, maxValue?: number, rng?: () => number): Matrix;
            static randInt(rows: number, columns: number, maxValue?: number, rng?: () => number): AbstractArrayMatrix;
            static randInt(rows: number, columns: number, maxValue?: number, rng?: () => number): AbstractArrayMatrix {
                if (maxValue === undefined) maxValue = 1000;
                if (rng === undefined) rng = random;
                var matrix = this.empty(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        var value = Math.floor(rng() * maxValue);
                        matrix.set(i, j, value);
                    }
                }
                return matrix;
            }

            /**
             * Creates an identity matrix with the given dimension. Values of the diagonal will be 1 and others will be 0.
             * @param {number} rows - Number of rows
             * @param {number} [columns=rows] - Number of columns
             * @param {number} [value=1] - Value to fill the diagonal with
             * @return {Matrix} - The new identity matrix
             */
            static eye(this: typeof Matrix, rows: number, columns?: number, value?: number): Matrix;
            static eye(rows: number, columns?: number, value?: number): AbstractArrayMatrix;
            static eye(rows: number, columns?: number, value?: number): AbstractArrayMatrix {
                if (columns === undefined) columns = rows;
                if (value === undefined) value = 1;
                var min = Math.min(rows, columns);
                var matrix = this.zeros(rows, columns);
                for (var i = 0; i < min; i++) {
                    matrix.set(i, i, value);
                }
                return matrix;
            }

            /**
             * Creates a diagonal matrix based on the given array.
             * @param {Array} data - Array containing the data for the diagonal
             * @param {number} [rows] - Number of rows (Default: data.length)
             * @param {number} [columns] - Number of columns (Default: rows)
             * @return {Matrix} - The new diagonal matrix
             */
            static diag(this: typeof Matrix, data: number[], rows?: number, columns?: number): Matrix;
            static diag(data: number[], rows?: number, columns?: number): AbstractArrayMatrix;
            static diag(data: number[], rows?: number, columns?: number): AbstractArrayMatrix {
                var l = data.length;
                if (rows === undefined) rows = l;
                if (columns === undefined) columns = rows;
                var min = Math.min(l, rows, columns);
                var matrix = this.zeros(rows, columns);
                for (var i = 0; i < min; i++) {
                    matrix.set(i, i, data[i]);
                }
                return matrix;
            }

            /**
             * Returns a matrix whose elements are the minimum between matrix1 and matrix2
             * @param {Matrix} matrix1
             * @param {Matrix} matrix2
             * @return {Matrix}
             */
            static min(this: typeof Matrix, matrix1: MatrixInput, matrix2: MatrixInput): Matrix;
            static min(matrix1: MatrixInput, matrix2: MatrixInput): AbstractArrayMatrix;
            static min(matrix1: MatrixInput, matrix2: MatrixInput): AbstractArrayMatrix {
                matrix1 = this.checkMatrix(matrix1);
                matrix2 = this.checkMatrix(matrix2);
                var rows = matrix1.rows;
                var columns = matrix1.columns;
                var result = new this(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        result.set(i, j, Math.min(matrix1.get(i, j), matrix2.get(i, j)));
                    }
                }
                return result;
            }

            /**
             * Returns a matrix whose elements are the maximum between matrix1 and matrix2
             * @param {Matrix} matrix1
             * @param {Matrix} matrix2
             * @return {Matrix}
             */
            static max(this: typeof Matrix, matrix1: MatrixInput, matrix2: MatrixInput): Matrix;
            static max(matrix1: MatrixInput, matrix2: MatrixInput): AbstractArrayMatrix;
            static max(matrix1: MatrixInput, matrix2: MatrixInput): AbstractArrayMatrix {
                matrix1 = this.checkMatrix(matrix1);
                matrix2 = this.checkMatrix(matrix2);
                var rows = matrix1.rows;
                var columns = matrix1.columns;
                var result = new this(rows, columns);
                for (var i = 0; i < rows; i++) {
                    for (var j = 0; j < columns; j++) {
                        result.set(i, j, Math.max(matrix1.get(i, j), matrix2.get(i, j)));
                    }
                }
                return result;
            }

            /**
             * Check that the provided value is a Matrix and tries to instantiate one if not
             * @param {*} value - The value to check
             * @return {Matrix}
             */
            static checkMatrix(this: typeof Matrix, value: Matrix | number[][]): Matrix;
            static checkMatrix(value: MatrixInput): MatrixLike;
            static checkMatrix(value: MatrixInput): MatrixLike {
                return Matrix.isMatrix(value) ? value : new this(value);
            }

            /**
             * Returns true if the argument is a Matrix, false otherwise
             * @param {*} value - The value to check
             * @return {boolean}
             */
            static isMatrix(value: unknown): value is MatrixLike {
                return (typeof value === 'object') && (value != null) && ('klass' in value) && (value.klass === 'Matrix');
            }

            /**
             * @prop {number} size - The number of elements in the matrix.
             */
            get size(): number {
                return this.rows * this.columns;
            }

            /**
             * Applies a callback for each element of the matrix. The function is called in the matrix (this) context.
             * @param {function} callback - Function that will be called with two parameters : i (row) and j (column)
             * @return {Matrix} this
             */
            apply<T extends MatrixLike>(this: T, callback: (this: T, i: number, j: number) => void): T {
                if (typeof callback !== 'function') {
                    throw new TypeError('callback must be a function');
                }
                var ii = this.rows;
                var jj = this.columns;
                for (var i = 0; i < ii; i++) {
                    for (var j = 0; j < jj; j++) {
                        callback.call(this, i, j);
                    }
                }
                return this;
            }

            /**
             * Returns a new 1D array filled row by row with the matrix values
             * @return {Array}
             */
            to1DArray(): number[] {
                var array: number[] = new Array(this.size);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        array[i * this.columns + j] = this.get(i, j);
                    }
                }
                return array;
            }

            /**
             * Returns a 2D array containing a copy of the data
             * @return {Array}
             */
            to2DArray(): number[][] {
                var copy: number[][] = new Array(this.rows);
                for (var i = 0; i < this.rows; i++) {
                    copy[i] = new Array(this.columns);
                    for (var j = 0; j < this.columns; j++) {
                        copy[i][j] = this.get(i, j);
                    }
                }
                return copy;
            }

            /**
             * @return {boolean} true if the matrix has one row
             */
            isRowVector(): boolean {
                return this.rows === 1;
            }

            /**
             * @return {boolean} true if the matrix has one column
             */
            isColumnVector(): boolean {
                return this.columns === 1;
            }

            /**
             * @return {boolean} true if the matrix has one row or one column
             */
            isVector(): boolean {
                return (this.rows === 1) || (this.columns === 1);
            }

            /**
             * @return {boolean} true if the matrix has the same number of rows and columns
             */
            isSquare(): boolean {
                return this.rows === this.columns;
            }

            /**
             * @return {boolean} true if the matrix is square and has the same values on both sides of the diagonal
             */
            isSymmetric(): boolean {
                if (this.isSquare()) {
                    for (var i = 0; i < this.rows; i++) {
                        for (var j = 0; j <= i; j++) {
                            if (this.get(i, j) !== this.get(j, i)) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
                return false;
            }

            /**
             * Sets a given element of the matrix. mat.set(3,4,1) is equivalent to mat[3][4]=1
             * @abstract
             * @param {number} rowIndex - Index of the row
             * @param {number} columnIndex - Index of the column
             * @param {number} value - The new value for the element
             * @return {Matrix} this
             */
            set(rowIndex: number, columnIndex: number, value: number): this { // eslint-disable-line no-unused-vars
                throw new Error('set method is unimplemented');
            }

            /**
             * Returns the given element of the matrix. mat.get(3,4) is equivalent to matrix[3][4]
             * @abstract
             * @param {number} rowIndex - Index of the row
             * @param {number} columnIndex - Index of the column
             * @return {number}
             */
            get(rowIndex: number, columnIndex: number): number { // eslint-disable-line no-unused-vars
                throw new Error('get method is unimplemented');
            }

            /**
             * Creates a new matrix that is a repetition of the current matrix. New matrix has rowRep times the number of
             * rows of the matrix, and colRep times the number of columns of the matrix
             * @param {number} rowRep - Number of times the rows should be repeated
             * @param {number} colRep - Number of times the columns should be re
             * @return {Matrix}
             * @example
             * var matrix = new Matrix([[1,2]]);
             * matrix.repeat(2); // [[1,2],[1,2]]
             */
            repeat(rowRep?: number, colRep?: number): Matrix {
                rowRep = rowRep || 1;
                colRep = colRep || 1;
                var matrix = new Matrix(this.rows * rowRep, this.columns * colRep);
                for (var i = 0; i < rowRep; i++) {
                    for (var j = 0; j < colRep; j++) {
                        matrix.setSubMatrix(this, this.rows * i, this.columns * j);
                    }
                }
                return matrix;
            }

            /**
             * Fills the matrix with a given value. All elements will be set to this value.
             * @param {number} value - New value
             * @return {Matrix} this
             */
            fill(value: number): this {
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, value);
                    }
                }
                return this;
            }

            /**
             * Negates the matrix. All elements will be multiplied by (-1)
             * @return {Matrix} this
             */
            neg(): this {
                return this.mulS(-1);
            }

            /**
             * Returns a new array from the given row index
             * @param {number} index - Row index
             * @return {Array}
             */
            getRow(index: number): number[] {
                util.checkRowIndex(this, index);
                var row: number[] = new Array(this.columns);
                for (var i = 0; i < this.columns; i++) {
                    row[i] = this.get(index, i);
                }
                return row;
            }

            /**
             * Returns a new row vector from the given row index
             * @param {number} index - Row index
             * @return {Matrix}
             */
            getRowVector(index: number): MatrixLike {
                return this.constructor.rowVector(this.getRow(index));
            }

            /**
             * Sets a row at the given index
             * @param {number} index - Row index
             * @param {Array|Matrix} array - Array or vector
             * @return {Matrix} this
             */
            setRow(index: number, array: MatrixVector): this {
                util.checkRowIndex(this, index);
                array = util.checkRowVector(this, array);
                for (var i = 0; i < this.columns; i++) {
                    this.set(index, i, array[i]);
                }
                return this;
            }

            /**
             * Swaps two rows
             * @param {number} row1 - First row index
             * @param {number} row2 - Second row index
             * @return {Matrix} this
             */
            swapRows(row1: number, row2: number): this {
                util.checkRowIndex(this, row1);
                util.checkRowIndex(this, row2);
                for (var i = 0; i < this.columns; i++) {
                    var temp = this.get(row1, i);
                    this.set(row1, i, this.get(row2, i));
                    this.set(row2, i, temp);
                }
                return this;
            }

            /**
             * Returns a new array from the given column index
             * @param {number} index - Column index
             * @return {Array}
             */
            getColumn(index: number): number[] {
                util.checkColumnIndex(this, index);
                var column: number[] = new Array(this.rows);
                for (var i = 0; i < this.rows; i++) {
                    column[i] = this.get(i, index);
                }
                return column;
            }

            /**
             * Returns a new column vector from the given column index
             * @param {number} index - Column index
             * @return {Matrix}
             */
            getColumnVector(index: number): MatrixLike {
                return this.constructor.columnVector(this.getColumn(index));
            }

            /**
             * Sets a column at the given index
             * @param {number} index - Column index
             * @param {Array|Matrix} array - Array or vector
             * @return {Matrix} this
             */
            setColumn(index: number, array: MatrixVector): this {
                util.checkColumnIndex(this, index);
                array = util.checkColumnVector(this, array);
                for (var i = 0; i < this.rows; i++) {
                    this.set(i, index, array[i]);
                }
                return this;
            }

            /**
             * Swaps two columns
             * @param {number} column1 - First column index
             * @param {number} column2 - Second column index
             * @return {Matrix} this
             */
            swapColumns(column1: number, column2: number): this {
                util.checkColumnIndex(this, column1);
                util.checkColumnIndex(this, column2);
                for (var i = 0; i < this.rows; i++) {
                    var temp = this.get(i, column1);
                    this.set(i, column1, this.get(i, column2));
                    this.set(i, column2, temp);
                }
                return this;
            }

            /**
             * Adds the values of a vector to each row
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            addRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) + vector[j]);
                    }
                }
                return this;
            }

            /**
             * Subtracts the values of a vector from each row
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            subRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) - vector[j]);
                    }
                }
                return this;
            }

            /**
             * Multiplies the values of a vector with each row
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            mulRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) * vector[j]);
                    }
                }
                return this;
            }

            /**
             * Divides the values of each row by those of a vector
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            divRowVector(vector: MatrixVector): this {
                vector = util.checkRowVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) / vector[j]);
                    }
                }
                return this;
            }

            /**
             * Adds the values of a vector to each column
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            addColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) + vector[i]);
                    }
                }
                return this;
            }

            /**
             * Subtracts the values of a vector from each column
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            subColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) - vector[i]);
                    }
                }
                return this;
            }

            /**
             * Multiplies the values of a vector with each column
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            mulColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) * vector[i]);
                    }
                }
                return this;
            }

            /**
             * Divides the values of each column by those of a vector
             * @param {Array|Matrix} vector - Array or vector
             * @return {Matrix} this
             */
            divColumnVector(vector: MatrixVector): this {
                vector = util.checkColumnVector(this, vector);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        this.set(i, j, this.get(i, j) / vector[i]);
                    }
                }
                return this;
            }

            /**
             * Multiplies the values of a row with a scalar
             * @param {number} index - Row index
             * @param {number} value
             * @return {Matrix} this
             */
            mulRow(index: number, value: number): this {
                util.checkRowIndex(this, index);
                for (var i = 0; i < this.columns; i++) {
                    this.set(index, i, this.get(index, i) * value);
                }
                return this;
            }

            /**
             * Multiplies the values of a column with a scalar
             * @param {number} index - Column index
             * @param {number} value
             * @return {Matrix} this
             */
            mulColumn(index: number, value: number): this {
                util.checkColumnIndex(this, index);
                for (var i = 0; i < this.rows; i++) {
                    this.set(i, index, this.get(i, index) * value);
                }
                return this;
            }

            /**
             * Returns the maximum value of the matrix
             * @return {number}
             */
            max(): number {
                var v = this.get(0, 0);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) > v) {
                            v = this.get(i, j);
                        }
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value
             * @return {Array}
             */
            maxIndex(): number[] {
                var v = this.get(0, 0);
                var idx = [0, 0];
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) > v) {
                            v = this.get(i, j);
                            idx[0] = i;
                            idx[1] = j;
                        }
                    }
                }
                return idx;
            }

            /**
             * Returns the minimum value of the matrix
             * @return {number}
             */
            min(): number {
                var v = this.get(0, 0);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) < v) {
                            v = this.get(i, j);
                        }
                    }
                }
                return v;
            }

            /**
             * Returns the index of the minimum value
             * @return {Array}
             */
            minIndex(): number[] {
                var v = this.get(0, 0);
                var idx = [0, 0];
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        if (this.get(i, j) < v) {
                            v = this.get(i, j);
                            idx[0] = i;
                            idx[1] = j;
                        }
                    }
                }
                return idx;
            }

            /**
             * Returns the maximum value of one row
             * @param {number} row - Row index
             * @return {number}
             */
            maxRow(row: number): number {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) > v) {
                        v = this.get(row, i);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value of one row
             * @param {number} row - Row index
             * @return {Array}
             */
            maxRowIndex(row: number): number[] {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                var idx = [row, 0];
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) > v) {
                        v = this.get(row, i);
                        idx[1] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns the minimum value of one row
             * @param {number} row - Row index
             * @return {number}
             */
            minRow(row: number): number {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) < v) {
                        v = this.get(row, i);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value of one row
             * @param {number} row - Row index
             * @return {Array}
             */
            minRowIndex(row: number): number[] {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                var idx = [row, 0];
                for (var i = 1; i < this.columns; i++) {
                    if (this.get(row, i) < v) {
                        v = this.get(row, i);
                        idx[1] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns the maximum value of one column
             * @param {number} column - Column index
             * @return {number}
             */
            maxColumn(column: number): number {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) > v) {
                        v = this.get(i, column);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the maximum value of one column
             * @param {number} column - Column index
             * @return {Array}
             */
            maxColumnIndex(column: number): number[] {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                var idx = [0, column];
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) > v) {
                        v = this.get(i, column);
                        idx[0] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns the minimum value of one column
             * @param {number} column - Column index
             * @return {number}
             */
            minColumn(column: number): number {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) < v) {
                        v = this.get(i, column);
                    }
                }
                return v;
            }

            /**
             * Returns the index of the minimum value of one column
             * @param {number} column - Column index
             * @return {Array}
             */
            minColumnIndex(column: number): number[] {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                var idx = [0, column];
                for (var i = 1; i < this.rows; i++) {
                    if (this.get(i, column) < v) {
                        v = this.get(i, column);
                        idx[0] = i;
                    }
                }
                return idx;
            }

            /**
             * Returns an array containing the diagonal values of the matrix
             * @return {Array}
             */
            diag(): number[] {
                var min = Math.min(this.rows, this.columns);
                var diag: number[] = new Array(min);
                for (var i = 0; i < min; i++) {
                    diag[i] = this.get(i, i);
                }
                return diag;
            }

            /**
             * Returns the sum by the argument given, if no argument given,
             * it returns the sum of all elements of the matrix.
             * @param {string} by - sum by 'row' or 'column'.
             * @return {Matrix|number}
             */
            sum(): number;
            sum(by: 'row' | 'column'): Matrix;
            sum(by?: string): Matrix | number;
            sum(by?: string): Matrix | number {
                switch (by) {
                    case 'row':
                        return util.sumByRow(this);
                    case 'column':
                        return util.sumByColumn(this);
                    default:
                        return util.sumAll(this);
                }
            }

            /**
             * Returns the mean of all elements of the matrix
             * @return {number}
             */
            mean(): number {
                return this.sum() / this.size;
            }

            /**
             * Returns the product of all elements of the matrix
             * @return {number}
             */
            prod(): number {
                var prod = 1;
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        prod *= this.get(i, j);
                    }
                }
                return prod;
            }

            /**
             * Computes the cumulative sum of the matrix elements (in place, row by row)
             * @return {Matrix} this
             */
            cumulativeSum(): this {
                var sum = 0;
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        sum += this.get(i, j);
                        this.set(i, j, sum);
                    }
                }
                return this;
            }

            /**
             * Computes the dot (scalar) product between the matrix and another
             * @param {Matrix} vector2 vector
             * @return {number}
             */
            dot(vector2: MatrixVector): number {
                if (Matrix.isMatrix(vector2)) vector2 = vector2.to1DArray();
                var vector1 = this.to1DArray();
                if (vector1.length !== vector2.length) {
                    throw new RangeError('vectors do not have the same size');
                }
                var dot = 0;
                for (var i = 0; i < vector1.length; i++) {
                    dot += vector1[i] * vector2[i];
                }
                return dot;
            }

            /**
             * Returns the matrix product between this and other
             * @param {Matrix} other
             * @return {Matrix}
             */
            mmul(other: MatrixInput): Matrix {
                other = this.constructor.checkMatrix(other);
                if (this.columns !== other.rows) {
                    // eslint-disable-next-line no-console
                    // Host warning output omitted; arithmetic continues as upstream.
                }

                var m = this.rows;
                var n = this.columns;
                var p = other.columns;

                var result = new Matrix(m, p);

                var Bcolj: number[] = new Array(n);
                for (var j = 0; j < p; j++) {
                    for (var k = 0; k < n; k++) {
                        Bcolj[k] = other.get(k, j);
                    }

                    for (var i = 0; i < m; i++) {
                        var s = 0;
                        for (k = 0; k < n; k++) {
                            s += this.get(i, k) * Bcolj[k];
                        }

                        result.set(i, j, s);
                    }
                }
                return result;
            }

            strassen2x2(other: MatrixLike): Matrix {
                var result = new Matrix(2, 2);
                const a11 = this.get(0, 0);
                const b11 = other.get(0, 0);
                const a12 = this.get(0, 1);
                const b12 = other.get(0, 1);
                const a21 = this.get(1, 0);
                const b21 = other.get(1, 0);
                const a22 = this.get(1, 1);
                const b22 = other.get(1, 1);

                // Compute intermediate values.
                const m1 = (a11 + a22) * (b11 + b22);
                const m2 = (a21 + a22) * b11;
                const m3 = a11 * (b12 - b22);
                const m4 = a22 * (b21 - b11);
                const m5 = (a11 + a12) * b22;
                const m6 = (a21 - a11) * (b11 + b12);
                const m7 = (a12 - a22) * (b21 + b22);

                // Combine intermediate values into the output.
                const c00 = m1 + m4 - m5 + m7;
                const c01 = m3 + m5;
                const c10 = m2 + m4;
                const c11 = m1 - m2 + m3 + m6;

                result.set(0, 0, c00);
                result.set(0, 1, c01);
                result.set(1, 0, c10);
                result.set(1, 1, c11);
                return result;
            }

            strassen3x3(other: MatrixLike): Matrix {
                var result = new Matrix(3, 3);

                const a00 = this.get(0, 0);
                const a01 = this.get(0, 1);
                const a02 = this.get(0, 2);
                const a10 = this.get(1, 0);
                const a11 = this.get(1, 1);
                const a12 = this.get(1, 2);
                const a20 = this.get(2, 0);
                const a21 = this.get(2, 1);
                const a22 = this.get(2, 2);

                const b00 = other.get(0, 0);
                const b01 = other.get(0, 1);
                const b02 = other.get(0, 2);
                const b10 = other.get(1, 0);
                const b11 = other.get(1, 1);
                const b12 = other.get(1, 2);
                const b20 = other.get(2, 0);
                const b21 = other.get(2, 1);
                const b22 = other.get(2, 2);

                const m1 = (a00 + a01 + a02 - a10 - a11 - a21 - a22) * b11;
                const m2 = (a00 - a10) * (-b01 + b11);
                const m3 = a11 * (-b00 + b01 + b10 - b11 - b12 - b20 + b22);
                const m4 = (-a00 + a10 + a11) * (b00 - b01 + b11);
                const m5 = (a10 + a11) * (-b00 + b01);
                const m6 = a00 * b00;
                const m7 = (-a00 + a20 + a21) * (b00 - b02 + b12);
                const m8 = (-a00 + a20) * (b02 - b12);
                const m9 = (a20 + a21) * (-b00 + b02);
                const m10 = (a00 + a01 + a02 - a11 - a12 - a20 - a21) * b12;
                const m11 = a21 * (-b00 + b02 + b10 - b11 - b12 - b20 + b21);
                const m12 = (-a02 + a21 + a22) * (b11 + b20 - b21);
                const m13 = (a02 - a22) * (b11 - b21);
                const m14 = a02 * b20;
                const m15 = (a21 + a22) * (-b20 + b21);
                const m16 = (-a02 + a11 + a12) * (b12 + b20 - b22);
                const m17 = (a02 - a12) * (b12 - b22);
                const m18 = (a11 + a12) * (-b20 + b22);
                const m19 = a01 * b10;
                const m20 = a12 * b21;
                const m21 = a10 * b02;
                const m22 = a20 * b01;
                const m23 = a22 * b22;

                const c00 = m6 + m14 + m19;
                const c01 = m1 + m4 + m5 + m6 + m12 + m14 + m15;
                const c02 = m6 + m7 + m9 + m10 + m14 + m16 + m18;
                const c10 = m2 + m3 + m4 + m6 + m14 + m16 + m17;
                const c11 = m2 + m4 + m5 + m6 + m20;
                const c12 = m14 + m16 + m17 + m18 + m21;
                const c20 = m6 + m7 + m8 + m11 + m12 + m13 + m14;
                const c21 = m12 + m13 + m14 + m15 + m22;
                const c22 = m6 + m7 + m8 + m9 + m23;

                result.set(0, 0, c00);
                result.set(0, 1, c01);
                result.set(0, 2, c02);
                result.set(1, 0, c10);
                result.set(1, 1, c11);
                result.set(1, 2, c12);
                result.set(2, 0, c20);
                result.set(2, 1, c21);
                result.set(2, 2, c22);
                return result;
            }

            /**
             * Returns the matrix product between x and y. More efficient than mmul(other) only when we multiply squared matrix and when the size of the matrix is > 1000.
             * @param {Matrix} y
             * @return {Matrix}
             */
            mmulStrassen(y: Matrix): Matrix {
                // Views have no clone method upstream; retain that TypeError.
                if (!(this instanceof Matrix))
                    throw new TypeError('this.clone is not a function');
                var x = this.clone();
                var r1 = x.rows;
                var c1 = x.columns;
                var r2 = y.rows;
                var c2 = y.columns;
                if (c1 !== r2) {
                    // eslint-disable-next-line no-console
                    // Host warning output omitted; arithmetic continues as upstream.
                }

                // Put a matrix into the top left of a matrix of zeros.
                // `rows` and `cols` are the dimensions of the output matrix.
                function embed(mat: Matrix, rows: number, cols: number): Matrix {
                    var r = mat.rows;
                    var c = mat.columns;
                    if ((r === rows) && (c === cols)) {
                        return mat;
                    } else {
                        var resultat = Matrix.zeros(rows, cols);
                        resultat = resultat.setSubMatrix(mat, 0, 0);
                        return resultat;
                    }
                }


                // Make sure both matrices are the same size.
                // This is exclusively for simplicity:
                // this algorithm can be implemented with matrices of different sizes.

                var r = Math.max(r1, r2);
                var c = Math.max(c1, c2);
                x = embed(x, r, c);
                y = embed(y, r, c);

                // Our recursive multiplication function.
                function blockMult(a: Matrix, b: Matrix, rows: number, cols: number): Matrix {
                    // For small matrices, resort to naive multiplication.
                    if (rows <= 512 || cols <= 512) {
                        return a.mmul(b); // a is equivalent to this
                    }

                    // Apply dynamic padding.
                    if ((rows % 2 === 1) && (cols % 2 === 1)) {
                        a = embed(a, rows + 1, cols + 1);
                        b = embed(b, rows + 1, cols + 1);
                    } else if (rows % 2 === 1) {
                        a = embed(a, rows + 1, cols);
                        b = embed(b, rows + 1, cols);
                    } else if (cols % 2 === 1) {
                        a = embed(a, rows, cols + 1);
                        b = embed(b, rows, cols + 1);
                    }

                    var halfRows = parseInt(String(a.rows / 2));
                    var halfCols = parseInt(String(a.columns / 2));
                    // Subdivide input matrices.
                    var a11 = a.subMatrix(0, halfRows - 1, 0, halfCols - 1);
                    var b11 = b.subMatrix(0, halfRows - 1, 0, halfCols - 1);

                    var a12 = a.subMatrix(0, halfRows - 1, halfCols, a.columns - 1);
                    var b12 = b.subMatrix(0, halfRows - 1, halfCols, b.columns - 1);

                    var a21 = a.subMatrix(halfRows, a.rows - 1, 0, halfCols - 1);
                    var b21 = b.subMatrix(halfRows, b.rows - 1, 0, halfCols - 1);

                    var a22 = a.subMatrix(halfRows, a.rows - 1, halfCols, a.columns - 1);
                    var b22 = b.subMatrix(halfRows, b.rows - 1, halfCols, b.columns - 1);

                    // Compute intermediate values.
                    var m1 = blockMult(Matrix.add(a11, a22), Matrix.add(b11, b22), halfRows, halfCols);
                    var m2 = blockMult(Matrix.add(a21, a22), b11, halfRows, halfCols);
                    var m3 = blockMult(a11, Matrix.sub(b12, b22), halfRows, halfCols);
                    var m4 = blockMult(a22, Matrix.sub(b21, b11), halfRows, halfCols);
                    var m5 = blockMult(Matrix.add(a11, a12), b22, halfRows, halfCols);
                    var m6 = blockMult(Matrix.sub(a21, a11), Matrix.add(b11, b12), halfRows, halfCols);
                    var m7 = blockMult(Matrix.sub(a12, a22), Matrix.add(b21, b22), halfRows, halfCols);

                    // Combine intermediate values into the output.
                    var c11 = Matrix.add(m1, m4);
                    c11.sub(m5);
                    c11.add(m7);
                    var c12 = Matrix.add(m3, m5);
                    var c21 = Matrix.add(m2, m4);
                    var c22 = Matrix.sub(m1, m2);
                    c22.add(m3);
                    c22.add(m6);

                    //Crop output to the desired size (undo dynamic padding).
                    var resultat = Matrix.zeros(2 * c11.rows, 2 * c11.columns);
                    resultat = resultat.setSubMatrix(c11, 0, 0);
                    resultat = resultat.setSubMatrix(c12, c11.rows, 0);
                    resultat = resultat.setSubMatrix(c21, 0, c11.columns);
                    resultat = resultat.setSubMatrix(c22, c11.rows, c11.columns);
                    return resultat.subMatrix(0, rows - 1, 0, cols - 1);
                }
                return blockMult(x, y, r, c);
            }

            /**
             * Returns a row-by-row scaled matrix
             * @param {number} [min=0] - Minimum scaled value
             * @param {number} [max=1] - Maximum scaled value
             * @return {Matrix} - The scaled matrix
             */
            scaleRows(min?: number, max?: number): MatrixLike {
                min = min === undefined ? 0 : min;
                max = max === undefined ? 1 : max;
                if (min >= max) {
                    throw new RangeError('min should be strictly smaller than max');
                }
                var newMatrix = this.constructor.empty(this.rows, this.columns);
                for (var i = 0; i < this.rows; i++) {
                    var scaled = arrayUtils.scale!(this.getRow(i), {min, max});
                    newMatrix.setRow(i, scaled);
                }
                return newMatrix;
            }

            /**
             * Returns a new column-by-column scaled matrix
             * @param {number} [min=0] - Minimum scaled value
             * @param {number} [max=1] - Maximum scaled value
             * @return {Matrix} - The new scaled matrix
             * @example
             * var matrix = new Matrix([[1,2],[-1,0]]);
             * var scaledMatrix = matrix.scaleColumns(); // [[1,1],[0,0]]
             */
            scaleColumns(min?: number, max?: number): MatrixLike {
                min = min === undefined ? 0 : min;
                max = max === undefined ? 1 : max;
                if (min >= max) {
                    throw new RangeError('min should be strictly smaller than max');
                }
                var newMatrix = this.constructor.empty(this.rows, this.columns);
                for (var i = 0; i < this.columns; i++) {
                    var scaled = arrayUtils.scale!(this.getColumn(i), {
                        min: min,
                        max: max
                    });
                    newMatrix.setColumn(i, scaled);
                }
                return newMatrix;
            }


            /**
             * Returns the Kronecker product (also known as tensor product) between this and other
             * See https://en.wikipedia.org/wiki/Kronecker_product
             * @param {Matrix} other
             * @return {Matrix}
             */
            kroneckerProduct(other: MatrixInput): Matrix {
                other = this.constructor.checkMatrix(other);

                var m = this.rows;
                var n = this.columns;
                var p = other.rows;
                var q = other.columns;

                var result = new Matrix(m * p, n * q);
                for (var i = 0; i < m; i++) {
                    for (var j = 0; j < n; j++) {
                        for (var k = 0; k < p; k++) {
                            for (var l = 0; l < q; l++) {
                                result[p * i + k][q * j + l] = this.get(i, j) * other.get(k, l);
                            }
                        }
                    }
                }
                return result;
            }

            /**
             * Transposes the matrix and returns a new one containing the result
             * @return {Matrix}
             */
            transpose(): Matrix {
                var result = new Matrix(this.columns, this.rows);
                for (var i = 0; i < this.rows; i++) {
                    for (var j = 0; j < this.columns; j++) {
                        result.set(j, i, this.get(i, j));
                    }
                }
                return result;
            }

            /**
             * Sorts the rows (in place)
             * @param {function} compareFunction - usual Array.prototype.sort comparison function
             * @return {Matrix} this
             */
            sortRows(compareFunction?: (a: number, b: number) => number): this {
                if (compareFunction === undefined) compareFunction = compareNumbers;
                for (var i = 0; i < this.rows; i++) {
                    this.setRow(i, this.getRow(i).sort(compareFunction));
                }
                return this;
            }

            /**
             * Sorts the columns (in place)
             * @param {function} compareFunction - usual Array.prototype.sort comparison function
             * @return {Matrix} this
             */
            sortColumns(compareFunction?: (a: number, b: number) => number): this {
                if (compareFunction === undefined) compareFunction = compareNumbers;
                for (var i = 0; i < this.columns; i++) {
                    this.setColumn(i, this.getColumn(i).sort(compareFunction));
                }
                return this;
            }

            /**
             * Returns a subset of the matrix
             * @param {number} startRow - First row index
             * @param {number} endRow - Last row index
             * @param {number} startColumn - First column index
             * @param {number} endColumn - Last column index
             * @return {Matrix}
             */
            subMatrix(startRow: number, endRow: number, startColumn: number, endColumn: number): Matrix {
                util.checkRange(this, startRow, endRow, startColumn, endColumn);
                var newMatrix = new Matrix(endRow - startRow + 1, endColumn - startColumn + 1);
                for (var i = startRow; i <= endRow; i++) {
                    for (var j = startColumn; j <= endColumn; j++) {
                        newMatrix[i - startRow][j - startColumn] = this.get(i, j);
                    }
                }
                return newMatrix;
            }

            /**
             * Returns a subset of the matrix based on an array of row indices
             * @param {Array} indices - Array containing the row indices
             * @param {number} [startColumn = 0] - First column index
             * @param {number} [endColumn = this.columns-1] - Last column index
             * @return {Matrix}
             */
            subMatrixRow(indices: number[], startColumn?: number, endColumn?: number): Matrix {
                if (startColumn === undefined) startColumn = 0;
                if (endColumn === undefined) endColumn = this.columns - 1;
                if ((startColumn > endColumn) || (startColumn < 0) || (startColumn >= this.columns) || (endColumn < 0) || (endColumn >= this.columns)) {
                    throw new RangeError('Argument out of range');
                }

                var newMatrix = new Matrix(indices.length, endColumn - startColumn + 1);
                for (var i = 0; i < indices.length; i++) {
                    for (var j = startColumn; j <= endColumn; j++) {
                        if (indices[i] < 0 || indices[i] >= this.rows) {
                            throw new RangeError('Row index out of range: ' + indices[i]);
                        }
                        newMatrix.set(i, j - startColumn, this.get(indices[i], j));
                    }
                }
                return newMatrix;
            }

            /**
             * Returns a subset of the matrix based on an array of column indices
             * @param {Array} indices - Array containing the column indices
             * @param {number} [startRow = 0] - First row index
             * @param {number} [endRow = this.rows-1] - Last row index
             * @return {Matrix}
             */
            subMatrixColumn(indices: number[], startRow?: number, endRow?: number): Matrix {
                if (startRow === undefined) startRow = 0;
                if (endRow === undefined) endRow = this.rows - 1;
                if ((startRow > endRow) || (startRow < 0) || (startRow >= this.rows) || (endRow < 0) || (endRow >= this.rows)) {
                    throw new RangeError('Argument out of range');
                }

                var newMatrix = new Matrix(endRow - startRow + 1, indices.length);
                for (var i = 0; i < indices.length; i++) {
                    for (var j = startRow; j <= endRow; j++) {
                        if (indices[i] < 0 || indices[i] >= this.columns) {
                            throw new RangeError('Column index out of range: ' + indices[i]);
                        }
                        newMatrix.set(j - startRow, i, this.get(j, indices[i]));
                    }
                }
                return newMatrix;
            }

            /**
             * Set a part of the matrix to the given sub-matrix
             * @param {Matrix|Array< Array >} matrix - The source matrix from which to extract values.
             * @param {number} startRow - The index of the first row to set
             * @param {number} startColumn - The index of the first column to set
             * @return {Matrix}
             */
            setSubMatrix(matrix: MatrixInput, startRow: number, startColumn: number): this {
                matrix = this.constructor.checkMatrix(matrix);
                var endRow = startRow + matrix.rows - 1;
                var endColumn = startColumn + matrix.columns - 1;
                util.checkRange(this, startRow, endRow, startColumn, endColumn);
                for (var i = 0; i < matrix.rows; i++) {
                    for (var j = 0; j < matrix.columns; j++) {
                        // Object-backed views have no row-array storage upstream.
                        if (!(this instanceof Matrix))
                            throw new TypeError("Cannot set properties of undefined (setting '" + (startColumn + j) + "')");
                        this[startRow + i][startColumn + j] = matrix.get(i, j);
                    }
                }
                return this;
            }

            /**
             * Return a new matrix based on a selection of rows and columns
             * @param {Array<number>} rowIndices - The row indices to select. Order matters and an index can be more than once.
             * @param {Array<number>} columnIndices - The column indices to select. Order matters and an index can be use more than once.
             * @return {Matrix} The new matrix
             */
            selection(rowIndices: number[], columnIndices: number[]): Matrix {
                var indices = util.checkIndices(this, rowIndices, columnIndices);
                var newMatrix = new Matrix(rowIndices.length, columnIndices.length);
                for (var i = 0; i < indices.row.length; i++) {
                    var rowIndex = indices.row[i];
                    for (var j = 0; j < indices.column.length; j++) {
                        var columnIndex = indices.column[j];
                        newMatrix[i][j] = this.get(rowIndex, columnIndex);
                    }
                }
                return newMatrix;
            }

            /**
             * Returns the trace of the matrix (sum of the diagonal elements)
             * @return {number}
             */
            trace(): number {
                var min = Math.min(this.rows, this.columns);
                var trace = 0;
                for (var i = 0; i < min; i++) {
                    trace += this.get(i, i);
                }
                return trace;
            }

            /*
             Matrix views
             */

            /**
             * Returns a view of the transposition of the matrix
             * @return {MatrixTransposeView}
             */
            transposeView(): MatrixTransposeView {
                return new MatrixTransposeView(this);
            }

            /**
             * Returns a view of the row vector with the given index
             * @param {number} row - row index of the vector
             * @return {MatrixRowView}
             */
            rowView(row: number): MatrixRowView {
                util.checkRowIndex(this, row);
                return new MatrixRowView(this, row);
            }

            /**
             * Returns a view of the column vector with the given index
             * @param {number} column - column index of the vector
             * @return {MatrixColumnView}
             */
            columnView(column: number): MatrixColumnView {
                util.checkColumnIndex(this, column);
                return new MatrixColumnView(this, column);
            }

            /**
             * Returns a view of the matrix flipped in the row axis
             * @return {MatrixFlipRowView}
             */
            flipRowView(): MatrixFlipRowView {
                return new MatrixFlipRowView(this);
            }

            /**
             * Returns a view of the matrix flipped in the column axis
             * @return {MatrixFlipColumnView}
             */
            flipColumnView(): MatrixFlipColumnView {
                return new MatrixFlipColumnView(this);
            }

            /**
             * Returns a view of a submatrix giving the index boundaries
             * @param {number} startRow - first row index of the submatrix
             * @param {number} endRow - last row index of the submatrix
             * @param {number} startColumn - first column index of the submatrix
             * @param {number} endColumn - last column index of the submatrix
             * @return {MatrixSubView}
             */
            subMatrixView(startRow: number, endRow: number, startColumn: number, endColumn: number): MatrixSubView {
                return new MatrixSubView(this, startRow, endRow, startColumn, endColumn);
            }

            /**
             * Returns a view of the cross of the row indices and the column indices
             * @example
             * // resulting vector is [[2], [2]]
             * var matrix = new Matrix([[1,2,3], [4,5,6]]).selectionView([0, 0], [1])
             * @param {Array<number>} rowIndices
             * @param {Array<number>} columnIndices
             * @return {MatrixSelectionView}
             */
            selectionView(rowIndices: number[], columnIndices: number[]): MatrixSelectionView {
                return new MatrixSelectionView(this, rowIndices, columnIndices);
            }



    // Constant operator templates expanded to declared methods; no runtime code generation.

    add(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.addS(value);
        return this.addM(value);
    
    }

    addS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) + value);
            }
        }
        return this;
    
    }

    addM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) + matrix.get(i, j));
            }
        }
        return this;
    
    }

    static add(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.add(value);
    
    }

    sub(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.subS(value);
        return this.subM(value);
    
    }

    subS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - value);
            }
        }
        return this;
    
    }

    subM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - matrix.get(i, j));
            }
        }
        return this;
    
    }

    static sub(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sub(value);
    
    }

    subtract(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.subS(value);
        return this.subM(value);
    
    }

    subtractS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - value);
            }
        }
        return this;
    
    }

    subtractM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) - matrix.get(i, j));
            }
        }
        return this;
    
    }

    static subtract(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sub(value);
    
    }

    mul(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.mulS(value);
        return this.mulM(value);
    
    }

    mulS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * value);
            }
        }
        return this;
    
    }

    mulM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * matrix.get(i, j));
            }
        }
        return this;
    
    }

    static mul(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mul(value);
    
    }

    multiply(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.mulS(value);
        return this.mulM(value);
    
    }

    multiplyS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * value);
            }
        }
        return this;
    
    }

    multiplyM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) * matrix.get(i, j));
            }
        }
        return this;
    
    }

    static multiply(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mul(value);
    
    }

    div(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.divS(value);
        return this.divM(value);
    
    }

    divS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / value);
            }
        }
        return this;
    
    }

    divM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / matrix.get(i, j));
            }
        }
        return this;
    
    }

    static div(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.div(value);
    
    }

    divide(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.divS(value);
        return this.divM(value);
    
    }

    divideS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / value);
            }
        }
        return this;
    
    }

    divideM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) / matrix.get(i, j));
            }
        }
        return this;
    
    }

    static divide(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.div(value);
    
    }

    mod(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.modS(value);
        return this.modM(value);
    
    }

    modS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % value);
            }
        }
        return this;
    
    }

    modM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % matrix.get(i, j));
            }
        }
        return this;
    
    }

    static mod(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mod(value);
    
    }

    modulus(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.modS(value);
        return this.modM(value);
    
    }

    modulusS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % value);
            }
        }
        return this;
    
    }

    modulusM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) % matrix.get(i, j));
            }
        }
        return this;
    
    }

    static modulus(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.mod(value);
    
    }

    and(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.andS(value);
        return this.andM(value);
    
    }

    andS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) & value);
            }
        }
        return this;
    
    }

    andM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) & matrix.get(i, j));
            }
        }
        return this;
    
    }

    static and(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.and(value);
    
    }

    or(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.orS(value);
        return this.orM(value);
    
    }

    orS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) | value);
            }
        }
        return this;
    
    }

    orM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) | matrix.get(i, j));
            }
        }
        return this;
    
    }

    static or(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.or(value);
    
    }

    xor(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.xorS(value);
        return this.xorM(value);
    
    }

    xorS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) ^ value);
            }
        }
        return this;
    
    }

    xorM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) ^ matrix.get(i, j));
            }
        }
        return this;
    
    }

    static xor(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.xor(value);
    
    }

    leftShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.leftShiftS(value);
        return this.leftShiftM(value);
    
    }

    leftShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) << value);
            }
        }
        return this;
    
    }

    leftShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) << matrix.get(i, j));
            }
        }
        return this;
    
    }

    static leftShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.leftShift(value);
    
    }

    signPropagatingRightShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.signPropagatingRightShiftS(value);
        return this.signPropagatingRightShiftM(value);
    
    }

    signPropagatingRightShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >> value);
            }
        }
        return this;
    
    }

    signPropagatingRightShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >> matrix.get(i, j));
            }
        }
        return this;
    
    }

    static signPropagatingRightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.signPropagatingRightShift(value);
    
    }

    rightShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.rightShiftS(value);
        return this.rightShiftM(value);
    
    }

    rightShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> value);
            }
        }
        return this;
    
    }

    rightShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> matrix.get(i, j));
            }
        }
        return this;
    
    }

    static rightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.rightShift(value);
    
    }

    zeroFillRightShift(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.rightShiftS(value);
        return this.rightShiftM(value);
    
    }

    zeroFillRightShiftS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> value);
            }
        }
        return this;
    
    }

    zeroFillRightShiftM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) >>> matrix.get(i, j));
            }
        }
        return this;
    
    }

    static zeroFillRightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.rightShift(value);
    
    }

    not(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, ~(this.get(i, j)));
            }
        }
        return this;
    
    }

    static not(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.not();
    
    }

    abs(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.abs(this.get(i, j)));
            }
        }
        return this;
    
    }

    static abs(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.abs();
    
    }

    acos(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.acos(this.get(i, j)));
            }
        }
        return this;
    
    }

    static acos(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.acos();
    
    }

    acosh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.acosh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static acosh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.acosh();
    
    }

    asin(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.asin(this.get(i, j)));
            }
        }
        return this;
    
    }

    static asin(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.asin();
    
    }

    asinh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.asinh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static asinh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.asinh();
    
    }

    atan(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.atan(this.get(i, j)));
            }
        }
        return this;
    
    }

    static atan(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.atan();
    
    }

    atanh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.atanh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static atanh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.atanh();
    
    }

    cbrt(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.cbrt(this.get(i, j)));
            }
        }
        return this;
    
    }

    static cbrt(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.cbrt();
    
    }

    ceil(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.ceil(this.get(i, j)));
            }
        }
        return this;
    
    }

    static ceil(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.ceil();
    
    }

    clz32(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.clz32(this.get(i, j)));
            }
        }
        return this;
    
    }

    static clz32(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.clz32();
    
    }

    cos(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.cos(this.get(i, j)));
            }
        }
        return this;
    
    }

    static cos(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.cos();
    
    }

    cosh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.cosh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static cosh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.cosh();
    
    }

    exp(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.exp(this.get(i, j)));
            }
        }
        return this;
    
    }

    static exp(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.exp();
    
    }

    expm1(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.expm1(this.get(i, j)));
            }
        }
        return this;
    
    }

    static expm1(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.expm1();
    
    }

    floor(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.floor(this.get(i, j)));
            }
        }
        return this;
    
    }

    static floor(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.floor();
    
    }

    fround(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.fround(this.get(i, j)));
            }
        }
        return this;
    
    }

    static fround(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.fround();
    
    }

    log(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log();
    
    }

    log1p(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log1p(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log1p(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log1p();
    
    }

    log10(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log10(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log10(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log10();
    
    }

    log2(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.log2(this.get(i, j)));
            }
        }
        return this;
    
    }

    static log2(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.log2();
    
    }

    round(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.round(this.get(i, j)));
            }
        }
        return this;
    
    }

    static round(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.round();
    
    }

    sign(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sign(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sign(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sign();
    
    }

    sin(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sin(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sin(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sin();
    
    }

    sinh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sinh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sinh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sinh();
    
    }

    sqrt(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.sqrt(this.get(i, j)));
            }
        }
        return this;
    
    }

    static sqrt(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.sqrt();
    
    }

    tan(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.tan(this.get(i, j)));
            }
        }
        return this;
    
    }

    static tan(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.tan();
    
    }

    tanh(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.tanh(this.get(i, j)));
            }
        }
        return this;
    
    }

    static tanh(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.tanh();
    
    }

    trunc(): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.trunc(this.get(i, j)));
            }
        }
        return this;
    
    }

    static trunc(matrix: MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.trunc();
    
    }

    pow(value: number | MatrixInput): this {
        if (typeof value === 'number') return this.powS(value);
        return this.powM(value);
    
    }

    powS(value: number): this {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.pow(this.get(i, j), value));
            }
        }
        return this;
    
    }

    powM(matrix: MatrixInput): this {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, Math.pow(this.get(i, j), matrix.get(i, j)));
            }
        }
        return this;
    
    }

    static pow(matrix: MatrixInput, arg0: number | MatrixInput): Matrix {
        var newMatrix = new Matrix(matrix);
        return newMatrix.pow(arg0);
    
    }

    static random = this.rand;
    static diagonal = this.diag;
    static identity = this.eye;
    diagonal(): number[] { return this.diag(); }
    negate(): this { return this.neg(); }
    tensorProduct(other: MatrixInput): Matrix { return this.kroneckerProduct(other); }

}


    export class BaseView extends AbstractMatrix {
        declare matrix: MatrixLike; declare rows: number; declare columns: number;
        constructor(matrix: MatrixLike, rows: number, columns: number) {
            super();
            this.matrix = matrix;
            this.rows = rows;
            this.columns = columns;
        }

        static get [Symbol.species]() {
            return Matrix;
        }
    }



// ml-matrix src/views/column.js

    export class MatrixColumnView extends BaseView {
        declare column: number;
        constructor(matrix: MatrixLike, column: number) {
            super(matrix, matrix.rows, 1);
            this.column = column;
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(rowIndex, this.column, value);
            return this;
        }

        get(rowIndex: number, _columnIndex?: number): number {
            return this.matrix.get(rowIndex, this.column);
        }
    }



// ml-matrix src/views/flipColumn.js

    export class MatrixFlipColumnView extends BaseView {
        constructor(matrix: MatrixLike) {
            super(matrix, matrix.rows, matrix.columns);
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(rowIndex, this.columns - columnIndex - 1, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this.matrix.get(rowIndex, this.columns - columnIndex - 1);
        }
    }



// ml-matrix src/views/flipRow.js

    export class MatrixFlipRowView extends BaseView {
        constructor(matrix: MatrixLike) {
            super(matrix, matrix.rows, matrix.columns);
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(this.rows - rowIndex - 1, columnIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this.matrix.get(this.rows - rowIndex - 1, columnIndex);
        }
    }


// ml-matrix src/views/row.js

    export class MatrixRowView extends BaseView {
        declare row: number;
        constructor(matrix: MatrixLike, row: number) {
            super(matrix, 1, matrix.columns);
            this.row = row;
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(this.row, columnIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this.matrix.get(this.row, columnIndex);
        }
    }



// ml-matrix src/views/selection.js

    export class MatrixSelectionView extends BaseView {
        declare rowIndices: number[]; declare columnIndices: number[];
        constructor(matrix: MatrixLike, rowIndices: number[], columnIndices: number[]) {
            var indices = util.checkIndices(matrix, rowIndices, columnIndices);
            super(matrix, indices.row.length, indices.column.length);
            this.rowIndices = indices.row;
            this.columnIndices = indices.column;
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(this.rowIndices[rowIndex], this.columnIndices[columnIndex], value);
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this.matrix.get(this.rowIndices[rowIndex], this.columnIndices[columnIndex]);
        }
    }


// ml-matrix src/views/sub.js

    export class MatrixSubView extends BaseView {
        declare startRow: number; declare startColumn: number;
        constructor(matrix: MatrixLike, startRow: number, endRow: number, startColumn: number, endColumn: number) {
            util.checkRange(matrix, startRow, endRow, startColumn, endColumn);
            super(matrix, endRow - startRow + 1, endColumn - startColumn + 1);
            this.startRow = startRow;
            this.startColumn = startColumn;
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(this.startRow + rowIndex, this.startColumn + columnIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this.matrix.get(this.startRow + rowIndex, this.startColumn + columnIndex);
        }
    }


// ml-matrix src/views/transpose.js

    export class MatrixTransposeView extends BaseView {
        constructor(matrix: MatrixLike) {
            super(matrix, matrix.columns, matrix.rows);
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this.matrix.set(columnIndex, rowIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this.matrix.get(columnIndex, rowIndex);
        }
    }



export class Matrix extends AbstractArrayMatrix {
    [index: number]: number[];
    declare rows: number;
    declare columns: number;

    // Native Array methods call the species with only a length. Upstream's
    // Matrix constructor returned a plain Array for that call. Use Array
    // directly here; explicit matrix species allocations above remain Matrix.
    static get [Symbol.species](): ArrayConstructor { return Array; }

        constructor(nRows: number | MatrixInput, nColumns?: number) {
            var i;
            if (Matrix.isMatrix(nRows)) {
                return requireArrayMatrix(nRows).clone();
            } else if (typeof nRows === 'number' && Number.isInteger(nRows) && nRows > 0) { // Create an empty matrix
                super(nRows);
                if (typeof nColumns === 'number' && Number.isInteger(nColumns) && nColumns > 0) {
                    for (i = 0; i < nRows; i++) {
                        this[i] = new Array(nColumns);
                    }
                } else {
                    throw new TypeError('nColumns must be a positive integer');
                }
            } else if (Array.isArray(nRows)) { // Copy the values from the 2D array
                const matrix = nRows;
                nRows = matrix.length;
                nColumns = matrix[0].length;
                if (typeof nColumns !== 'number' || nColumns === 0) {
                    throw new TypeError('Data must be a 2D array with at least one element');
                }
                super(nRows);
                for (i = 0; i < nRows; i++) {
                    if (matrix[i].length !== nColumns) {
                        throw new RangeError('Inconsistent array dimensions');
                    }
                    this[i] = Array<number>().concat(matrix[i]);
                }
            } else {
                throw new TypeError('First argument must be a positive number or an array');
            }
            this.rows = nRows;
            this.columns = nColumns;
            return this;
        }

        set(rowIndex: number, columnIndex: number, value: number): this {
            this[rowIndex][columnIndex] = value;
            return this;
        }

        get(rowIndex: number, columnIndex: number): number {
            return this[rowIndex][columnIndex];
        }

        /**
         * Creates an exact and independent copy of the matrix
         * @return {Matrix}
         */
        clone(): Matrix {
            var newMatrix = new Matrix(this.rows, this.columns);
            for (var row = 0; row < this.rows; row++) {
                for (var column = 0; column < this.columns; column++) {
                    newMatrix.set(row, column, this.get(row, column));
                }
            }
            return newMatrix;
        }

        /**
         * Removes a row from the given index
         * @param {number} index - Row index
         * @return {Matrix} this
         */
        removeRow(index: number): this {
            util.checkRowIndex(this, index);
            if (this.rows === 1) {
                throw new RangeError('A matrix cannot have less than one row');
            }
            this.splice(index, 1);
            this.rows -= 1;
            return this;
        }

        /**
         * Adds a row at the given index
         * @param {number} [index = this.rows] - Row index
         * @param {Array|Matrix} array - Array or vector
         * @return {Matrix} this
         */
        addRow(index: number | MatrixVector, array?: MatrixVector): this {
            if (array === undefined) {
                if (typeof index === 'number') throw new TypeError('Expected a vector');
                array = index;
                index = this.rows;
            }
            if (typeof index !== 'number') throw new TypeError('Row index must be numeric');
            util.checkRowIndex(this, index, true);
            array = util.checkRowVector(this, array!);
            this.splice(index, 0, array);
            this.rows += 1;
            return this;
        }

        /**
         * Removes a column from the given index
         * @param {number} index - Column index
         * @return {Matrix} this
         */
        removeColumn(index: number): this {
            util.checkColumnIndex(this, index);
            if (this.columns === 1) {
                throw new RangeError('A matrix cannot have less than one column');
            }
            for (var i = 0; i < this.rows; i++) {
                this[i].splice(index, 1);
            }
            this.columns -= 1;
            return this;
        }

        /**
         * Adds a column at the given index
         * @param {number} [index = this.columns] - Column index
         * @param {Array|Matrix} array - Array or vector
         * @return {Matrix} this
         */
        addColumn(index: number | MatrixVector, array?: MatrixVector): this {
            if (typeof array === 'undefined') {
                if (typeof index === 'number') throw new TypeError('Expected a vector');
                array = index;
                index = this.columns;
            }
            if (typeof index !== 'number') throw new TypeError('Column index must be numeric');
            util.checkColumnIndex(this, index, true);
            array = util.checkColumnVector(this, array!);
            for (var i = 0; i < this.rows; i++) {
                this[i].splice(index, 0, array[i]);
            }
            this.columns += 1;
            return this;
        }
}

export function requireArrayMatrix(value: MatrixLike): Matrix {
    if (!(value instanceof Matrix))
        throw new TypeError('matrix.clone is not a function');
    return value;
}

export const MLMatrix = Matrix;
export const MLMatrixMatrix = { Matrix };
