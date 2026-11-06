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


// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/ml/index.js
// Runtime sections are retained verbatim apart from erased TypeScript types.
// The eval boundary is intentional (L1); no static-method variant is provided.
// Excluded decomposition bodies retain their original bindings only; the
// upstream workload never calls them (qualification receipts name the proof).
import { MLArrayUtils } from "./statistics.ts";
import { MLMatrixUtil } from "./matrix-util.ts";


import type * as Api from "./matrix-api.d.ts";
type AbstractConstructor = {
 new(...args: number[]): object;
 isMatrix: Api.MatrixConstructor["isMatrix"];
};
type AbstractFactory = (superCtor?: new(...args: number[]) => object) => AbstractConstructor;
type ViewBaseConstructor = new(matrix: Api.MatrixBase, rows: number, columns: number) => {
 matrix: Api.MatrixBase; rows: number; columns: number;
};
type InplaceOperation = <T extends Api.MatrixBase>(this: T, value: number | Api.MatrixInput) => T;
type InplaceScalar = <T extends Api.MatrixBase>(this: T, value: number) => T;
type InplaceMatrix = <T extends Api.MatrixBase>(this: T, matrix: Api.MatrixInput) => T;
type InplaceUnary = <T extends Api.MatrixBase>(this: T) => T;
type StaticOperation = (this: Api.MatrixConstructor, matrix: Api.MatrixInput, value: number | Api.MatrixInput) => Api.Matrix;
type StaticUnary = (this: Api.MatrixConstructor, matrix: Api.MatrixInput) => Api.Matrix;
type Decompositions = {
 SingularValueDecomposition: Record<string, never>; SVD: Record<string, never>;
 EigenvalueDecomposition: undefined; EVD: undefined;
 LuDecomposition: Record<string, never>; LU: Record<string, never>;
 QrDecomposition: undefined; QR: undefined;
 CholeskyDecomposition: Record<string, never>; CHO: Record<string, never>;
 inverse(matrix: Api.MatrixInput): Api.Matrix;
 solve(lhs: Api.MatrixInput, rhs: Api.MatrixInput): Api.Matrix;
};
type MatrixModuleExtensions = {
 abstractMatrix?: AbstractFactory;
 inverse?(matrix: Api.MatrixInput): Api.Matrix;
 inv?(matrix: Api.MatrixInput): Api.Matrix;
 solve?(lhs: Api.MatrixInput, rhs: Api.MatrixInput): Api.Matrix;
 Decompositions?: Partial<Decompositions>; DC?: Partial<Decompositions>;
};
type SvdResult = { leftSingularVectors: Api.Matrix; rightSingularVectors: Api.Matrix; diagonal: number[] };

const MLMatrixMatrix: { Matrix?: Api.MatrixConstructor & MatrixModuleExtensions } = {};
let MLMatrixDCLU: Record<string, never> = {};
let MLMatrixDCSVD: Record<string, never> = {};
let MLMatrixDCCholesky: Record<string, never> = {};
let MLMatrixDCEVD: undefined;
let MLMatrixDCQR: undefined;

// ml-matrix symbolsspecies.js
if (!Symbol.species) {
    (Symbol as { species?: symbol }).species = Symbol.for('@@species');
}


// ml-matrix src/abstractMatrix.js
let MLMatrixAbstractMatrix: AbstractFactory;
{
    let LuDecomposition = MLMatrixDCLU;
    let SvDecomposition = MLMatrixDCSVD;
    let arrayUtils = MLArrayUtils;
    let util = MLMatrixUtil;

    MLMatrixAbstractMatrix = function abstractMatrix(superCtor?: new(...args: number[]) => object) : AbstractConstructor {
        if (superCtor === undefined) superCtor = Object;

        /**
         * Real matrix
         * @class Matrix
         * @param {number|Array|Matrix} nRows - Number of rows of the new matrix,
         * 2D array containing the data or Matrix instance to clone
         * @param {number} [nColumns] - Number of columns of the new matrix
         */
        class Matrix extends superCtor {
            [key: string]: unknown;
            static [key: string]: unknown;
            declare static add: StaticOperation; declare static sub: StaticOperation;
            declare rows?: number; declare columns?: number;

            static get [Symbol.species]() {
                return this;
            }

            /**
             * Constructs a Matrix with the chosen dimensions from a 1D array
             * @param {number} newRows - Number of rows
             * @param {number} newColumns - Number of columns
             * @param {Array} newData - A 1D array containing data for the matrix
             * @return {Matrix} - The new matrix
             */
            static from1DArray(this: Api.MatrixConstructor, newRows: number, newColumns: number, newData: number[]) : Api.AbstractArrayMatrix {
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
            static rowVector(this: Api.MatrixConstructor, newData: number[]) : Api.AbstractArrayMatrix {
                var vector = new this(1, newData.length);
                for (var i: number = 0; i < newData.length; i++) {
                    vector.set(0, i, newData[i]);
                }
                return vector;
            }

            /**
             * Creates a column vector, a matrix with only one column.
             * @param {Array} newData - A 1D array containing data for the vector
             * @return {Matrix} - The new matrix
             */
            static columnVector(this: Api.MatrixConstructor, newData: number[]) : Api.AbstractArrayMatrix {
                var vector = new this(newData.length, 1);
                for (var i: number = 0; i < newData.length; i++) {
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
            static empty(this: Api.MatrixConstructor, rows: number, columns: number) : Api.AbstractArrayMatrix {
                return new this(rows, columns);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be set to zero.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static zeros(this: Api.MatrixConstructor, rows: number, columns: number) : Api.AbstractArrayMatrix {
                return this.empty(rows, columns).fill(0);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be set to one.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @return {Matrix} - The new matrix
             */
            static ones(this: Api.MatrixConstructor, rows: number, columns: number) : Api.AbstractArrayMatrix {
                return this.empty(rows, columns).fill(1);
            }

            /**
             * Creates a matrix with the given dimensions. Values will be randomly set.
             * @param {number} rows - Number of rows
             * @param {number} columns - Number of columns
             * @param {function} [rng=Math.random] - Random number generator
             * @return {Matrix} The new matrix
             */
            static rand(this: Api.MatrixConstructor, rows: number, columns: number, rng?: () => number) : Api.AbstractArrayMatrix {
                if (rng === undefined) rng = Math.random;
                var matrix = this.empty(rows, columns);
                for (var i: number = 0; i < rows; i++) {
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
            static randInt(this: Api.MatrixConstructor, rows: number, columns: number, maxValue?: number, rng?: () => number) : Api.AbstractArrayMatrix {
                if (maxValue === undefined) maxValue = 1000;
                if (rng === undefined) rng = Math.random;
                var matrix = this.empty(rows, columns);
                for (var i: number = 0; i < rows; i++) {
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
            static eye(this: Api.MatrixConstructor, rows: number, columns?: number, value?: number) : Api.AbstractArrayMatrix {
                if (columns === undefined) columns = rows;
                if (value === undefined) value = 1;
                var min = Math.min(rows, columns);
                var matrix = this.zeros(rows, columns);
                for (var i: number = 0; i < min; i++) {
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
            static diag(this: Api.MatrixConstructor, data: number[], rows?: number, columns?: number) : Api.AbstractArrayMatrix {
                var l = data.length;
                if (rows === undefined) rows = l;
                if (columns === undefined) columns = rows;
                var min = Math.min(l, rows, columns);
                var matrix = this.zeros(rows, columns);
                for (var i: number = 0; i < min; i++) {
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
            static min(this: Api.MatrixConstructor, matrix1: Api.MatrixInput, matrix2: Api.MatrixInput) : Api.AbstractArrayMatrix {
                matrix1 = this.checkMatrix(matrix1);
                matrix2 = this.checkMatrix(matrix2);
                var rows = matrix1.rows;
                var columns = matrix1.columns;
                var result = new this(rows, columns);
                for (var i: number = 0; i < rows; i++) {
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
            static max(this: Api.MatrixConstructor, matrix1: Api.MatrixInput, matrix2: Api.MatrixInput) : Api.AbstractArrayMatrix {
                matrix1 = this.checkMatrix(matrix1);
                matrix2 = this.checkMatrix(matrix2);
                var rows = matrix1.rows;
                var columns = matrix1.columns;
                var result = new this(rows, columns);
                for (var i: number = 0; i < rows; i++) {
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
            static checkMatrix(this: Api.MatrixConstructor, value: Api.MatrixInput) : Api.MatrixBase {
                return Matrix.isMatrix(value) ? value : new this(value);
            }

            /**
             * Returns true if the argument is a Matrix, false otherwise
             * @param {*} value - The value to check
             * @return {boolean}
             */
            static isMatrix(value: unknown) : value is Api.MatrixTag {
                return (value != null) && ((value as { klass?: unknown }).klass === 'Matrix');
            }

            /**
             * @prop {number} size - The number of elements in the matrix.
             */
            get size()  : number {
                // @ts-expect-error upstream bare abstract instances have no dimensions and produce NaN.
                return this.rows * this.columns;
            }

            /**
             * Applies a callback for each element of the matrix. The function is called in the matrix (this) context.
             * @param {function} callback - Function that will be called with two parameters : i (row) and j (column)
             * @return {Matrix} this
             */
            apply<T extends Api.MatrixBase>(this: T, callback: (this: T, i: number, j: number) => void) : T {
                if (typeof callback !== 'function') {
                    throw new TypeError('callback must be a function');
                }
                var ii = this.rows;
                var jj = this.columns;
                for (var i: number = 0; i < ii; i++) {
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
            to1DArray(this: Api.MatrixBase) : number[] {
                var array = new Array<number>(this.size);
                for (var i: number = 0; i < this.rows; i++) {
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
            to2DArray(this: Api.MatrixBase) : number[][] {
                var copy = new Array<number[]>(this.rows);
                for (var i: number = 0; i < this.rows; i++) {
                    copy[i] = new Array<number>(this.columns);
                    for (var j = 0; j < this.columns; j++) {
                        copy[i][j] = this.get(i, j);
                    }
                }
                return copy;
            }

            /**
             * @return {boolean} true if the matrix has one row
             */
            isRowVector(this: Api.MatrixBase) : boolean {
                return this.rows === 1;
            }

            /**
             * @return {boolean} true if the matrix has one column
             */
            isColumnVector(this: Api.MatrixBase) : boolean {
                return this.columns === 1;
            }

            /**
             * @return {boolean} true if the matrix has one row or one column
             */
            isVector(this: Api.MatrixBase) : boolean {
                return (this.rows === 1) || (this.columns === 1);
            }

            /**
             * @return {boolean} true if the matrix has the same number of rows and columns
             */
            isSquare(this: Api.MatrixBase) : boolean {
                return this.rows === this.columns;
            }

            /**
             * @return {boolean} true if the matrix is square and has the same values on both sides of the diagonal
             */
            isSymmetric(this: Api.MatrixBase) : boolean {
                if (this.isSquare()) {
                    for (var i: number = 0; i < this.rows; i++) {
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
            set<T extends Api.MatrixBase>(this: T, rowIndex: number, columnIndex: number, value: number) : T { // eslint-disable-line no-unused-vars
                throw new Error('set method is unimplemented');
            }

            /**
             * Returns the given element of the matrix. mat.get(3,4) is equivalent to matrix[3][4]
             * @abstract
             * @param {number} rowIndex - Index of the row
             * @param {number} columnIndex - Index of the column
             * @return {number}
             */
            get(this: Api.MatrixBase, rowIndex: number, columnIndex: number) : number { // eslint-disable-line no-unused-vars
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
            repeat(this: Api.MatrixBase, rowRep?: number, colRep?: number) : Api.Matrix {
                rowRep = rowRep || 1;
                colRep = colRep || 1;
                var matrix = new this.constructor[Symbol.species](this.rows * rowRep, this.columns * colRep);
                for (var i: number = 0; i < rowRep; i++) {
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
            fill<T extends Api.MatrixBase>(this: T, value: number) : T {
                for (var i: number = 0; i < this.rows; i++) {
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
            neg<T extends Api.MatrixBase>(this: T) : T {
                return this.mulS(-1);
            }

            /**
             * Returns a new array from the given row index
             * @param {number} index - Row index
             * @return {Array}
             */
            getRow(this: Api.MatrixBase, index: number) : number[] {
                util.checkRowIndex(this, index);
                var row = new Array<number>(this.columns);
                for (var i: number = 0; i < this.columns; i++) {
                    row[i] = this.get(index, i);
                }
                return row;
            }

            /**
             * Returns a new row vector from the given row index
             * @param {number} index - Row index
             * @return {Matrix}
             */
            getRowVector(this: Api.Matrix, index: number) : Api.MatrixLike {
                return this.constructor.rowVector(this.getRow(index));
            }

            /**
             * Sets a row at the given index
             * @param {number} index - Row index
             * @param {Array|Matrix} array - Array or vector
             * @return {Matrix} this
             */
            setRow<T extends Api.MatrixBase>(this: T, index: number, array: Api.MatrixVector) : T {
                util.checkRowIndex(this, index);
                array = util.checkRowVector(this, array);
                for (var i: number = 0; i < this.columns; i++) {
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
            swapRows<T extends Api.MatrixBase>(this: T, row1: number, row2: number) : T {
                util.checkRowIndex(this, row1);
                util.checkRowIndex(this, row2);
                for (var i: number = 0; i < this.columns; i++) {
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
            getColumn(this: Api.MatrixBase, index: number) : number[] {
                util.checkColumnIndex(this, index);
                var column = new Array<number>(this.rows);
                for (var i: number = 0; i < this.rows; i++) {
                    column[i] = this.get(i, index);
                }
                return column;
            }

            /**
             * Returns a new column vector from the given column index
             * @param {number} index - Column index
             * @return {Matrix}
             */
            getColumnVector(this: Api.Matrix, index: number) : Api.MatrixLike {
                return this.constructor.columnVector(this.getColumn(index));
            }

            /**
             * Sets a column at the given index
             * @param {number} index - Column index
             * @param {Array|Matrix} array - Array or vector
             * @return {Matrix} this
             */
            setColumn<T extends Api.MatrixBase>(this: T, index: number, array: Api.MatrixVector) : T {
                util.checkColumnIndex(this, index);
                array = util.checkColumnVector(this, array);
                for (var i: number = 0; i < this.rows; i++) {
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
            swapColumns<T extends Api.MatrixBase>(this: T, column1: number, column2: number) : T {
                util.checkColumnIndex(this, column1);
                util.checkColumnIndex(this, column2);
                for (var i: number = 0; i < this.rows; i++) {
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
            addRowVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkRowVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            subRowVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkRowVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            mulRowVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkRowVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            divRowVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkRowVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            addColumnVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkColumnVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            subColumnVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkColumnVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            mulColumnVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkColumnVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            divColumnVector<T extends Api.MatrixBase>(this: T, vector: Api.MatrixVector) : T {
                vector = util.checkColumnVector(this, vector);
                for (var i: number = 0; i < this.rows; i++) {
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
            mulRow<T extends Api.MatrixBase>(this: T, index: number, value: number) : T {
                util.checkRowIndex(this, index);
                for (var i: number = 0; i < this.columns; i++) {
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
            mulColumn<T extends Api.MatrixBase>(this: T, index: number, value: number) : T {
                util.checkColumnIndex(this, index);
                for (var i: number = 0; i < this.rows; i++) {
                    this.set(i, index, this.get(i, index) * value);
                }
                return this;
            }

            /**
             * Returns the maximum value of the matrix
             * @return {number}
             */
            max(this: Api.MatrixBase) : number {
                var v = this.get(0, 0);
                for (var i: number = 0; i < this.rows; i++) {
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
            maxIndex(this: Api.MatrixBase) : number[] {
                var v = this.get(0, 0);
                var idx = [0, 0];
                for (var i: number = 0; i < this.rows; i++) {
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
            min(this: Api.MatrixBase) : number {
                var v = this.get(0, 0);
                for (var i: number = 0; i < this.rows; i++) {
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
            minIndex(this: Api.MatrixBase) : number[] {
                var v = this.get(0, 0);
                var idx = [0, 0];
                for (var i: number = 0; i < this.rows; i++) {
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
            maxRow(this: Api.MatrixBase, row: number) : number {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                for (var i: number = 1; i < this.columns; i++) {
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
            maxRowIndex(this: Api.MatrixBase, row: number) : number[] {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                var idx = [row, 0];
                for (var i: number = 1; i < this.columns; i++) {
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
            minRow(this: Api.MatrixBase, row: number) : number {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                for (var i: number = 1; i < this.columns; i++) {
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
            minRowIndex(this: Api.MatrixBase, row: number) : number[] {
                util.checkRowIndex(this, row);
                var v = this.get(row, 0);
                var idx = [row, 0];
                for (var i: number = 1; i < this.columns; i++) {
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
            maxColumn(this: Api.MatrixBase, column: number) : number {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                for (var i: number = 1; i < this.rows; i++) {
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
            maxColumnIndex(this: Api.MatrixBase, column: number) : number[] {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                var idx = [0, column];
                for (var i: number = 1; i < this.rows; i++) {
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
            minColumn(this: Api.MatrixBase, column: number) : number {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                for (var i: number = 1; i < this.rows; i++) {
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
            minColumnIndex(this: Api.MatrixBase, column: number) : number[] {
                util.checkColumnIndex(this, column);
                var v = this.get(0, column);
                var idx = [0, column];
                for (var i: number = 1; i < this.rows; i++) {
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
            diag(this: Api.MatrixBase) : number[] {
                var min = Math.min(this.rows, this.columns);
                var diag = new Array<number>(min);
                for (var i: number = 0; i < min; i++) {
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
            sum(this: Api.MatrixBase, by?: string) : Api.Matrix | number {
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
            mean(this: Api.MatrixBase) : number {
                return this.sum() / this.size;
            }

            /**
             * Returns the product of all elements of the matrix
             * @return {number}
             */
            prod(this: Api.MatrixBase) : number {
                var prod = 1;
                for (var i: number = 0; i < this.rows; i++) {
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
            cumulativeSum<T extends Api.MatrixBase>(this: T) : T {
                var sum = 0;
                for (var i: number = 0; i < this.rows; i++) {
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
            dot(this: Api.MatrixBase, vector2: Api.MatrixVector) : number {
                if (Matrix.isMatrix(vector2)) vector2 = vector2.to1DArray();
                var vector1 = this.to1DArray();
                if (vector1.length !== vector2.length) {
                    throw new RangeError('vectors do not have the same size');
                }
                var dot = 0;
                for (var i: number = 0; i < vector1.length; i++) {
                    dot += vector1[i] * vector2[i];
                }
                return dot;
            }

            /**
             * Returns the matrix product between this and other
             * @param {Matrix} other
             * @return {Matrix}
             */
            mmul(this: Api.MatrixBase, other: Api.MatrixLike) : Api.Matrix {
                other = this.constructor.checkMatrix(other);
                if (this.columns !== other.rows) {
                    // eslint-disable-next-line no-console
                    console.warn('Number of columns of left matrix are not equal to number of rows of right matrix.');
                }

                var m = this.rows;
                var n = this.columns;
                var p = other.columns;

                var result = new this.constructor[Symbol.species](m, p);

                var Bcolj = new Array<number>(n);
                for (var j = 0; j < p; j++) {
                    for (var k = 0; k < n; k++) {
                        Bcolj[k] = other.get(k, j);
                    }

                    for (var i: number = 0; i < m; i++) {
                        var s = 0;
                        for (k = 0; k < n; k++) {
                            s += this.get(i, k) * Bcolj[k];
                        }

                        result.set(i, j, s);
                    }
                }
                return result;
            }

            strassen2x2(this: Api.MatrixBase, other: Api.MatrixLike) : Api.Matrix {
                var result = new this.constructor[Symbol.species](2, 2);
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

            strassen3x3(this: Api.MatrixBase, other: Api.MatrixLike) : Api.Matrix {
                var result = new this.constructor[Symbol.species](3, 3);

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
            mmulStrassen(this: Api.Matrix, y: Api.Matrix) : Api.Matrix {
                var x = this.clone();
                var r1 = x.rows;
                var c1 = x.columns;
                var r2 = y.rows;
                var c2 = y.columns;
                if (c1 !== r2) {
                    // eslint-disable-next-line no-console
                    console.warn(`Multiplying ${r1} x ${c1} and ${r2} x ${c2} matrix: dimensions do not match.`);
                }

                // Put a matrix into the top left of a matrix of zeros.
                // `rows` and `cols` are the dimensions of the output matrix.
                function embed(mat: Api.Matrix, rows: number, cols: number) : Api.Matrix {
                    var r = mat.rows;
                    var c = mat.columns;
                    if ((r === rows) && (c === cols)) {
                        return mat;
                    } else {
                        // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
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
                function blockMult(a: Api.Matrix, b: Api.Matrix, rows: number, cols: number) : Api.Matrix {
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

                    // @ts-expect-error upstream parseInt coerces this numeric quotient to a string.
                    var halfRows = parseInt(a.rows / 2);
                    // @ts-expect-error upstream parseInt coerces this numeric quotient to a string.
                    var halfCols = parseInt(a.columns / 2);
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
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m1 = blockMult(Matrix.add(a11, a22), Matrix.add(b11, b22), halfRows, halfCols);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m2 = blockMult(Matrix.add(a21, a22), b11, halfRows, halfCols);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m3 = blockMult(a11, Matrix.sub(b12, b22), halfRows, halfCols);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m4 = blockMult(a22, Matrix.sub(b21, b11), halfRows, halfCols);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m5 = blockMult(Matrix.add(a11, a12), b22, halfRows, halfCols);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m6 = blockMult(Matrix.sub(a21, a11), Matrix.add(b11, b12), halfRows, halfCols);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var m7 = blockMult(Matrix.sub(a12, a22), Matrix.add(b21, b22), halfRows, halfCols);

                    // Combine intermediate values into the output.
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var c11 = Matrix.add(m1, m4);
                    c11.sub(m5);
                    c11.add(m7);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var c12 = Matrix.add(m3, m5);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var c21 = Matrix.add(m2, m4);
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
                    var c22 = Matrix.sub(m1, m2);
                    c22.add(m3);
                    c22.add(m6);

                    //Crop output to the desired size (undo dynamic padding).
                    // @ts-expect-error upstream invokes the raw abstract constructor here, without dense initialization.
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
            scaleRows(this: Api.Matrix, min?: number, max?: number) : Api.MatrixLike {
                min = min === undefined ? 0 : min;
                max = max === undefined ? 1 : max;
                if (min >= max) {
                    throw new RangeError('min should be strictly smaller than max');
                }
                var newMatrix = this.constructor.empty(this.rows, this.columns);
                for (var i: number = 0; i < this.rows; i++) {
                    // @ts-expect-error upstream MLArrayUtils never exports scale; this unused path throws.
                    var scaled = arrayUtils.scale(this.getRow(i), {min, max});
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
            scaleColumns(this: Api.Matrix, min?: number, max?: number) : Api.MatrixLike {
                min = min === undefined ? 0 : min;
                max = max === undefined ? 1 : max;
                if (min >= max) {
                    throw new RangeError('min should be strictly smaller than max');
                }
                var newMatrix = this.constructor.empty(this.rows, this.columns);
                for (var i: number = 0; i < this.columns; i++) {
                    // @ts-expect-error upstream MLArrayUtils never exports scale; this unused path throws.
                    var scaled = arrayUtils.scale(this.getColumn(i), {
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
            kroneckerProduct(this: Api.MatrixBase, other: Api.MatrixLike) : Api.Matrix {
                other = this.constructor.checkMatrix(other);

                var m = this.rows;
                var n = this.columns;
                var p = other.rows;
                var q = other.columns;

                var result = new this.constructor[Symbol.species](m * p, n * q);
                for (var i: number = 0; i < m; i++) {
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
            transpose(this: Api.MatrixBase) : Api.Matrix {
                var result = new this.constructor[Symbol.species](this.columns, this.rows);
                for (var i: number = 0; i < this.rows; i++) {
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
            sortRows<T extends Api.MatrixBase>(this: T, compareFunction?: (a: number, b: number) => number) : T {
                if (compareFunction === undefined) compareFunction = compareNumbers;
                for (var i: number = 0; i < this.rows; i++) {
                    this.setRow(i, this.getRow(i).sort(compareFunction));
                }
                return this;
            }

            /**
             * Sorts the columns (in place)
             * @param {function} compareFunction - usual Array.prototype.sort comparison function
             * @return {Matrix} this
             */
            sortColumns<T extends Api.MatrixBase>(this: T, compareFunction?: (a: number, b: number) => number) : T {
                if (compareFunction === undefined) compareFunction = compareNumbers;
                for (var i: number = 0; i < this.columns; i++) {
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
            subMatrix(this: Api.MatrixBase, startRow: number, endRow: number, startColumn: number, endColumn: number) : Api.Matrix {
                util.checkRange(this, startRow, endRow, startColumn, endColumn);
                var newMatrix = new this.constructor[Symbol.species](endRow - startRow + 1, endColumn - startColumn + 1);
                for (var i: number = startRow; i <= endRow; i++) {
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
            subMatrixRow(this: Api.MatrixBase, indices: number[], startColumn?: number, endColumn?: number) : Api.Matrix {
                if (startColumn === undefined) startColumn = 0;
                if (endColumn === undefined) endColumn = this.columns - 1;
                if ((startColumn > endColumn) || (startColumn < 0) || (startColumn >= this.columns) || (endColumn < 0) || (endColumn >= this.columns)) {
                    throw new RangeError('Argument out of range');
                }

                var newMatrix = new this.constructor[Symbol.species](indices.length, endColumn - startColumn + 1);
                for (var i: number = 0; i < indices.length; i++) {
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
            subMatrixColumn(this: Api.MatrixBase, indices: number[], startRow?: number, endRow?: number) : Api.Matrix {
                if (startRow === undefined) startRow = 0;
                if (endRow === undefined) endRow = this.rows - 1;
                if ((startRow > endRow) || (startRow < 0) || (startRow >= this.rows) || (endRow < 0) || (endRow >= this.rows)) {
                    throw new RangeError('Argument out of range');
                }

                var newMatrix = new this.constructor[Symbol.species](endRow - startRow + 1, indices.length);
                for (var i: number = 0; i < indices.length; i++) {
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
            setSubMatrix<T extends Api.Matrix>(this: T, matrix: Api.MatrixInput, startRow: number, startColumn: number) : T {
                matrix = this.constructor.checkMatrix(matrix);
                var endRow = startRow + matrix.rows - 1;
                var endColumn = startColumn + matrix.columns - 1;
                util.checkRange(this, startRow, endRow, startColumn, endColumn);
                for (var i: number = 0; i < matrix.rows; i++) {
                    for (var j = 0; j < matrix.columns; j++) {
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
            selection(this: Api.MatrixBase, rowIndices: number[], columnIndices: number[]) : Api.Matrix {
                var indices = util.checkIndices(this, rowIndices, columnIndices);
                var newMatrix = new this.constructor[Symbol.species](rowIndices.length, columnIndices.length);
                for (var i: number = 0; i < indices.row.length; i++) {
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
            trace(this: Api.MatrixBase) : number {
                var min = Math.min(this.rows, this.columns);
                var trace = 0;
                for (var i: number = 0; i < min; i++) {
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
            transposeView(this: Api.MatrixBase) : Api.MatrixTransposeView {
                return new MLMatrixTransposeView(this);
            }

            /**
             * Returns a view of the row vector with the given index
             * @param {number} row - row index of the vector
             * @return {MatrixRowView}
             */
            rowView(this: Api.MatrixBase, row: number) : Api.MatrixRowView {
                util.checkRowIndex(this, row);
                return new MLMatrixRowView(this, row);
            }

            /**
             * Returns a view of the column vector with the given index
             * @param {number} column - column index of the vector
             * @return {MatrixColumnView}
             */
            columnView(this: Api.MatrixBase, column: number) : Api.MatrixColumnView {
                util.checkColumnIndex(this, column);
                return new MLMatrixColumnView(this, column);
            }

            /**
             * Returns a view of the matrix flipped in the row axis
             * @return {MatrixFlipRowView}
             */
            flipRowView(this: Api.MatrixBase) : Api.MatrixFlipRowView {
                return new MLMatrixFlipRowView(this);
            }

            /**
             * Returns a view of the matrix flipped in the column axis
             * @return {MatrixFlipColumnView}
             */
            flipColumnView(this: Api.MatrixBase) : Api.MatrixFlipColumnView {
                return new MLMatrixFlipColumnView(this);
            }

            /**
             * Returns a view of a submatrix giving the index boundaries
             * @param {number} startRow - first row index of the submatrix
             * @param {number} endRow - last row index of the submatrix
             * @param {number} startColumn - first column index of the submatrix
             * @param {number} endColumn - last column index of the submatrix
             * @return {MatrixSubView}
             */
            subMatrixView(this: Api.MatrixBase, startRow: number, endRow: number, startColumn: number, endColumn: number) : Api.MatrixSubView {
                return new MLMatrixSubView(this, startRow, endRow, startColumn, endColumn);
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
            selectionView(this: Api.MatrixBase, rowIndices: number[], columnIndices: number[]) : Api.MatrixSelectionView {
                return new MLMatrixSelectionView(this, rowIndices, columnIndices);
            }


            /**
            * Calculates and returns the determinant of a matrix as a Number
            * @example
            *   new Matrix([[1,2,3], [4,5,6]]).det()
            * @return {number}
            */
            det(this: Api.MatrixBase) : number {
                if (this.isSquare()) {
                    var a, b, c, d;
                    if (this.columns === 2) {
                        // 2 x 2 matrix
                        a = this.get(0, 0);
                        b = this.get(0, 1);
                        c = this.get(1, 0);
                        d = this.get(1, 1);

                        return a * d - (b * c);
                    } else if (this.columns === 3) {
                        // 3 x 3 matrix
                        var subMatrix0, subMatrix1, subMatrix2;
                        subMatrix0 = this.selectionView([1, 2], [1, 2]);
                        subMatrix1 = this.selectionView([1, 2], [0, 2]);
                        subMatrix2 = this.selectionView([1, 2], [0, 1]);
                        a = this.get(0, 0);
                        b = this.get(0, 1);
                        c = this.get(0, 2);

                        return a * subMatrix0.det() - b * subMatrix1.det() + c * subMatrix2.det();
                    } else {
                        // general purpose determinant using the LU decomposition
                        // @ts-expect-error upstream decomposition body was excluded; this original call throws if reached.
                return new LuDecomposition(this).determinant;
                    }

                } else {
                    throw Error('Determinant can only be calculated for a square matrix.');
                }
            }

            /**
             * Returns inverse of a matrix if it exists or the pseudoinverse
             * @param {number} threshold - threshold for taking inverse of singular values (default = 1e-15)
             * @return {Matrix} the (pseudo)inverted matrix.
             */
            pseudoInverse(this: Api.MatrixBase, threshold?: number) : Api.Matrix {
                if (threshold === undefined) threshold = Number.EPSILON;
                // @ts-expect-error upstream decomposition body was excluded; this original call throws if reached.
                var svdSolution: SvdResult = new SvDecomposition(this, {autoTranspose: true});

                var U = svdSolution.leftSingularVectors;
                var V = svdSolution.rightSingularVectors;
                var s: number[] | Api.Matrix = svdSolution.diagonal;

                for (var i: number = 0; i < s.length; i++) {
                    if (Math.abs(s[i]) > threshold) {
                        s[i] = 1.0 / s[i];
                    } else {
                        s[i] = 0.0;
                    }
                }

                // convert list to diagonal
                s = this.constructor[Symbol.species].diag(s);
                return V.mmul(s.mmul(U.transposeView()));
            }
        }

        Matrix.prototype.klass = 'Matrix';

        /**
         * @private
         * Check that two matrices have the same dimensions
         * @param {Matrix} matrix
         * @param {Matrix} otherMatrix
         */
        function checkDimensions(matrix: Api.MatrixBase, otherMatrix: Api.MatrixBase) : void { // eslint-disable-line no-unused-vars
            if (matrix.rows !== otherMatrix.rows ||
                matrix.columns !== otherMatrix.columns) {
                throw new RangeError('Matrices dimensions must be equal');
            }
        }

        function compareNumbers(a: number, b: number) : number {
            return a - b;
        }

        /*
         Synonyms
         */

        Matrix.random = Matrix.rand;
        Matrix.diagonal = Matrix.diag;
        Matrix.prototype.diagonal = Matrix.prototype.diag;
        Matrix.identity = Matrix.eye;
        Matrix.prototype.negate = Matrix.prototype.neg;
        Matrix.prototype.tensorProduct = Matrix.prototype.kroneckerProduct;
        Matrix.prototype.determinant = Matrix.prototype.det;

        /*
         Add dynamically instance and static methods for mathematical operations
         */

        var inplaceOperator = `
    (function %name%(value) {
        if (typeof value === 'number') return this.%name%S(value);
        return this.%name%M(value);
    })
    `;

        var inplaceOperatorScalar = `
    (function %name%S(value) {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) %op% value);
            }
        }
        return this;
    })
    `;

        var inplaceOperatorMatrix = `
    (function %name%M(matrix) {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, this.get(i, j) %op% matrix.get(i, j));
            }
        }
        return this;
    })
    `;

        var staticOperator = `
    (function %name%(matrix, value) {
        var newMatrix = new this[Symbol.species](matrix);
        return newMatrix.%name%(value);
    })
    `;

        var inplaceMethod = `
    (function %name%() {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, %method%(this.get(i, j)));
            }
        }
        return this;
    })
    `;

        var staticMethod = `
    (function %name%(matrix) {
        var newMatrix = new this[Symbol.species](matrix);
        return newMatrix.%name%();
    })
    `;

        var inplaceMethodWithArgs = `
    (function %name%(%args%) {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, %method%(this.get(i, j), %args%));
            }
        }
        return this;
    })
    `;

        var staticMethodWithArgs = `
    (function %name%(matrix, %args%) {
        var newMatrix = new this[Symbol.species](matrix);
        return newMatrix.%name%(%args%);
    })
    `;


        var inplaceMethodWithOneArgScalar = `
    (function %name%S(value) {
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, %method%(this.get(i, j), value));
            }
        }
        return this;
    })
    `;
        var inplaceMethodWithOneArgMatrix = `
    (function %name%M(matrix) {
        matrix = this.constructor.checkMatrix(matrix);
        checkDimensions(this, matrix);
        for (var i = 0; i < this.rows; i++) {
            for (var j = 0; j < this.columns; j++) {
                this.set(i, j, %method%(this.get(i, j), matrix.get(i, j)));
            }
        }
        return this;
    })
    `;

        var inplaceMethodWithOneArg = `
    (function %name%(value) {
        if (typeof value === 'number') return this.%name%S(value);
        return this.%name%M(value);
    })
    `;

        var staticMethodWithOneArg = staticMethodWithArgs;

        var operators: string[][] = [
            // Arithmetic operators
            ['+', 'add'],
            ['-', 'sub', 'subtract'],
            ['*', 'mul', 'multiply'],
            ['/', 'div', 'divide'],
            ['%', 'mod', 'modulus'],
            // Bitwise operators
            ['&', 'and'],
            ['|', 'or'],
            ['^', 'xor'],
            ['<<', 'leftShift'],
            ['>>', 'signPropagatingRightShift'],
            ['>>>', 'rightShift', 'zeroFillRightShift']
        ];

        var i: number;

        for (var operator of operators) {
            var inplaceOp: InplaceOperation = eval(fillTemplateFunction(inplaceOperator, {name: operator[1], op: operator[0]}));
            var inplaceOpS: InplaceScalar = eval(fillTemplateFunction(inplaceOperatorScalar, {name: operator[1] + 'S', op: operator[0]}));
            var inplaceOpM: InplaceMatrix = eval(fillTemplateFunction(inplaceOperatorMatrix, {name: operator[1] + 'M', op: operator[0]}));
            var staticOp: StaticOperation = eval(fillTemplateFunction(staticOperator, {name: operator[1]}));
            for (i = 1; i < operator.length; i++) {
                Matrix.prototype[operator[i]] = inplaceOp;
                Matrix.prototype[operator[i] + 'S'] = inplaceOpS;
                Matrix.prototype[operator[i] + 'M'] = inplaceOpM;
                Matrix[operator[i]] = staticOp;
            }
        }

        var methods: string[][] = [
            ['~', 'not']
        ];

        [
            'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'cbrt', 'ceil',
            'clz32', 'cos', 'cosh', 'exp', 'expm1', 'floor', 'fround', 'log', 'log1p',
            'log10', 'log2', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc'
        ].forEach(function (mathMethod) {
            methods.push(['Math.' + mathMethod, mathMethod]);
        });

        for (var method of methods) {
            var inplaceMeth: InplaceUnary = eval(fillTemplateFunction(inplaceMethod, {name: method[1], method: method[0]}));
            var staticMeth: StaticUnary = eval(fillTemplateFunction(staticMethod, {name: method[1]}));
            for (i = 1; i < method.length; i++) {
                Matrix.prototype[method[i]] = inplaceMeth;
                Matrix[method[i]] = staticMeth;
            }
        }

        var methodsWithArgs: [string, number, ...string[]][] = [
            ['Math.pow', 1, 'pow']
        ];

        for (var methodWithArg of methodsWithArgs) {
            var args = 'arg0';
            for (i = 1; i < methodWithArg[1]; i++) {
                args += `, arg${i}`;
            }
            if (methodWithArg[1] !== 1) {
                var inplaceMethWithArgs: InplaceScalar = eval(fillTemplateFunction(inplaceMethodWithArgs, {
                    name: methodWithArg[2],
                    method: methodWithArg[0],
                    args: args
                }));
                var staticMethWithArgs: StaticOperation = eval(fillTemplateFunction(staticMethodWithArgs, {name: methodWithArg[2], args: args}));
                for (i = 2; i < methodWithArg.length; i++) {
                    Matrix.prototype[methodWithArg[i]] = inplaceMethWithArgs;
                    Matrix[methodWithArg[i]] = staticMethWithArgs;
                }
            } else {
                var tmplVar = {
                    name: methodWithArg[2],
                    args: args,
                    method: methodWithArg[0]
                };
                var inplaceMethod2: InplaceOperation = eval(fillTemplateFunction(inplaceMethodWithOneArg, tmplVar));
                var inplaceMethodS: InplaceScalar = eval(fillTemplateFunction(inplaceMethodWithOneArgScalar, tmplVar));
                var inplaceMethodM: InplaceMatrix = eval(fillTemplateFunction(inplaceMethodWithOneArgMatrix, tmplVar));
                var staticMethod2: StaticOperation = eval(fillTemplateFunction(staticMethodWithOneArg, tmplVar));
                for (i = 2; i < methodWithArg.length; i++) {
                    Matrix.prototype[methodWithArg[i]] = inplaceMethod2;
                    Matrix.prototype[methodWithArg[i] + 'M'] = inplaceMethodM;
                    Matrix.prototype[methodWithArg[i] + 'S'] = inplaceMethodS;
                    Matrix[methodWithArg[i]] = staticMethod2;
                }
            }
        }

        function fillTemplateFunction(template: string, values: Record<string, string>) : string {
            for (var value in values) {
                template = template.replace(new RegExp('%' + value + '%', 'g'), values[value]);
            }
            return template;
        }

        return Matrix;
    }
}


// ml-matrix src/views/base
let MLMatrixBaseView: ViewBaseConstructor;
{
    let abstractMatrix = MLMatrixAbstractMatrix;
    let Matrix = MLMatrixMatrix;

    class BaseView extends abstractMatrix() {
        declare matrix: Api.MatrixBase; declare rows: number; declare columns: number;

        constructor(matrix: Api.MatrixBase, rows: number, columns: number) {
            super();
            this.matrix = matrix;
            this.rows = rows;
            this.columns = columns;
        }

        static get [Symbol.species]() {
            return Matrix.Matrix;
        }
    }

    MLMatrixBaseView = BaseView;
}


// ml-matrix src/views/column.js
let MLMatrixColumnView: new(matrix: Api.MatrixBase, column: number) => Api.MatrixColumnView;
{
    let BaseView = MLMatrixBaseView;

    class MatrixColumnView extends BaseView {
        declare column: number;

        constructor(matrix: Api.MatrixBase, column: number) {
            super(matrix, matrix.rows, 1);
            this.column = column;
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(rowIndex, this.column, value);
            return this;
        }

        get(rowIndex: number) : number {
            return this.matrix.get(rowIndex, this.column);
        }
    }

    MLMatrixColumnView = MatrixColumnView as unknown as new(matrix: Api.MatrixBase, column: number) => Api.MatrixColumnView;
}


// ml-matrix src/views/flipColumn.js
let MLMatrixFlipColumnView: new(matrix: Api.MatrixBase) => Api.MatrixFlipColumnView;
{
    let BaseView = MLMatrixBaseView

    class MatrixFlipColumnView extends BaseView {
        

        constructor(matrix: Api.MatrixBase) {
            super(matrix, matrix.rows, matrix.columns);
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(rowIndex, this.columns - columnIndex - 1, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number) : number {
            return this.matrix.get(rowIndex, this.columns - columnIndex - 1);
        }
    }

    MLMatrixFlipColumnView = MatrixFlipColumnView as unknown as new(matrix: Api.MatrixBase) => Api.MatrixFlipColumnView;
}


// ml-matrix src/views/flipRow.js
let MLMatrixFlipRowView: new(matrix: Api.MatrixBase) => Api.MatrixFlipRowView;
{
    let BaseView = MLMatrixBaseView

    class MatrixFlipRowView extends BaseView {
        

        constructor(matrix: Api.MatrixBase) {
            super(matrix, matrix.rows, matrix.columns);
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(this.rows - rowIndex - 1, columnIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number) : number {
            return this.matrix.get(this.rows - rowIndex - 1, columnIndex);
        }
    }

    MLMatrixFlipRowView = MatrixFlipRowView as unknown as new(matrix: Api.MatrixBase) => Api.MatrixFlipRowView;
}

// ml-matrix src/views/row.js
let MLMatrixRowView: new(matrix: Api.MatrixBase, row: number) => Api.MatrixRowView;
{
    let BaseView = MLMatrixBaseView;

    class MatrixRowView extends BaseView {
        declare row: number;

        constructor(matrix: Api.MatrixBase, row: number) {
            super(matrix, 1, matrix.columns);
            this.row = row;
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(this.row, columnIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number) : number {
            return this.matrix.get(this.row, columnIndex);
        }
    }

    MLMatrixRowView = MatrixRowView as unknown as new(matrix: Api.MatrixBase, row: number) => Api.MatrixRowView;
}


// ml-matrix src/views/selection.js
let MLMatrixSelectionView: new(matrix: Api.MatrixBase, rows: number[], columns: number[]) => Api.MatrixSelectionView;
{
    let BaseView = MLMatrixBaseView;
    let util = MLMatrixUtil;

    class MatrixSelectionView extends BaseView {
        declare rowIndices: number[]; declare columnIndices: number[];

        constructor(matrix: Api.MatrixBase, rowIndices: number[], columnIndices: number[]) {
            var indices = util.checkIndices(matrix, rowIndices, columnIndices);
            super(matrix, indices.row.length, indices.column.length);
            this.rowIndices = indices.row;
            this.columnIndices = indices.column;
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(this.rowIndices[rowIndex], this.columnIndices[columnIndex], value);
            return this;
        }

        get(rowIndex: number, columnIndex: number) : number {
            return this.matrix.get(this.rowIndices[rowIndex], this.columnIndices[columnIndex]);
        }
    }

    MLMatrixSelectionView = MatrixSelectionView as unknown as new(matrix: Api.MatrixBase, rows: number[], columns: number[]) => Api.MatrixSelectionView;
}

// ml-matrix src/views/sub.js
let MLMatrixSubView: new(matrix: Api.MatrixBase, startRow: number, endRow: number, startColumn: number, endColumn: number) => Api.MatrixSubView;
{
    let BaseView = MLMatrixBaseView;
    let util = MLMatrixUtil;

    class MatrixSubView extends BaseView {
        declare startRow: number; declare startColumn: number;

        constructor(matrix: Api.MatrixBase, startRow: number, endRow: number, startColumn: number, endColumn: number) {
            util.checkRange(matrix, startRow, endRow, startColumn, endColumn);
            super(matrix, endRow - startRow + 1, endColumn - startColumn + 1);
            this.startRow = startRow;
            this.startColumn = startColumn;
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(this.startRow + rowIndex, this.startColumn + columnIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number) : number {
            return this.matrix.get(this.startRow + rowIndex, this.startColumn + columnIndex);
        }
    }

    MLMatrixSubView = MatrixSubView as unknown as new(matrix: Api.MatrixBase, startRow: number, endRow: number, startColumn: number, endColumn: number) => Api.MatrixSubView;
}

// ml-matrix src/views/transpose.js
let MLMatrixTransposeView: new(matrix: Api.MatrixBase) => Api.MatrixTransposeView;
{
    let BaseView = MLMatrixBaseView;

    class MatrixTransposeView extends BaseView {
        

        constructor(matrix: Api.MatrixBase) {
            super(matrix, matrix.columns, matrix.rows);
        }

        set(rowIndex: number, columnIndex: number, value: number) : this {
            this.matrix.set(columnIndex, rowIndex, value);
            return this;
        }

        get(rowIndex: number, columnIndex: number) : number {
            return this.matrix.get(columnIndex, rowIndex);
        }
    }

    MLMatrixTransposeView = MatrixTransposeView as unknown as new(matrix: Api.MatrixBase) => Api.MatrixTransposeView;
}

// mlmatrix src/matrix.js
{
    let abstractMatrix = MLMatrixAbstractMatrix;
    let util = MLMatrixUtil;

    class Matrix extends abstractMatrix(Array) {
        [index: number]: number[];
        declare rows?: number; declare columns?: number;

        constructor(nRows: number | Api.Matrix | Api.MatrixRows, nColumns?: number) {
            var i: number;
            if (arguments.length === 1 && typeof nRows === 'number') {
                return new Array<number[]>((nRows as number));
            }
            if (Matrix.isMatrix(nRows)) {
                return nRows.clone();
            } else if (Number.isInteger(nRows) && (nRows as number) > 0) { // Create an empty matrix
                super((nRows as number));
                if (Number.isInteger(nColumns) && (nColumns as number) > 0) {
                    for (i = 0; i < (nRows as number); i++) {
                        this[i] = new Array<number>((nColumns as number));
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
                super((nRows as number));
                for (i = 0; i < (nRows as number); i++) {
                    if (matrix[i].length !== nColumns) {
                        throw new RangeError('Inconsistent array dimensions');
                    }
                    this[i] = ([] as number[]).concat(matrix[i]);
                }
            } else {
                throw new TypeError('First argument must be a positive number or an array');
            }
            this.rows = (nRows as number);
            this.columns = (nColumns as number);
            return this;
        }

        set?(this: Api.Matrix, rowIndex: number, columnIndex: number, value: number) : Api.Matrix {
            this[rowIndex][columnIndex] = value;
            return this;
        }

        get?(this: Api.Matrix, rowIndex: number, columnIndex: number) : number {
            return this[rowIndex][columnIndex];
        }

        /**
         * Creates an exact and independent copy of the matrix
         * @return {Matrix}
         */
        clone?(this: Api.Matrix) : Api.Matrix {
            var newMatrix = new this.constructor[Symbol.species](this.rows, this.columns);
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
        removeRow?(this: Api.Matrix, index: number) : Api.Matrix {
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
        addRow?(this: Api.Matrix, index: number | Api.MatrixVector, array?: Api.MatrixVector) : Api.Matrix {
            if (array === undefined) {
                array = (index as Api.MatrixVector);
                index = this.rows;
            }
            util.checkRowIndex(this, (index as number), true);
            array = util.checkRowVector(this, (array as Api.MatrixVector), true);
            this.splice((index as number), 0, array);
            this.rows += 1;
            return this;
        }

        /**
         * Removes a column from the given index
         * @param {number} index - Column index
         * @return {Matrix} this
         */
        removeColumn?(this: Api.Matrix, index: number) : Api.Matrix {
            util.checkColumnIndex(this, index);
            if (this.columns === 1) {
                throw new RangeError('A matrix cannot have less than one column');
            }
            for (var i: number = 0; i < this.rows; i++) {
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
        addColumn?(this: Api.Matrix, index: number | Api.MatrixVector, array?: Api.MatrixVector) : Api.Matrix {
            if (typeof array === 'undefined') {
                array = (index as Api.MatrixVector);
                index = this.columns;
            }
            util.checkColumnIndex(this, (index as number), true);
            array = util.checkColumnVector(this, (array as Api.MatrixVector));
            for (var i: number = 0; i < this.rows; i++) {
                this[i].splice((index as number), 0, array[i]);
            }
            this.columns += 1;
            return this;
        }
    }

    MLMatrixMatrix.Matrix = Matrix as unknown as Api.MatrixConstructor & MatrixModuleExtensions;
    (Matrix as typeof Matrix & { abstractMatrix?: AbstractFactory }).abstractMatrix = abstractMatrix;
}



// ml-matric src/decompositions.js
let MLMatrixDecompositions: Partial<Decompositions> = {};
{
    let Matrix = MLMatrixMatrix.Matrix as Api.MatrixConstructor & MatrixModuleExtensions;

    let SingularValueDecomposition = MLMatrixDCSVD;
    let EigenvalueDecomposition = MLMatrixDCEVD;
    let LuDecomposition = MLMatrixDCLU;
    let QrDecomposition = MLMatrixDCQR
    let CholeskyDecomposition = MLMatrixDCCholesky;

    function inverse(matrix: Api.MatrixInput) : Api.Matrix {
        matrix = Matrix.checkMatrix(matrix);
        return solve(matrix, Matrix.eye(matrix.rows));
    }

    /**
     * Returns the inverse
     * @memberOf Matrix
     * @static
     * @param {Matrix} matrix
     * @return {Matrix} matrix
     * @alias inv
     */
    Matrix.inverse = Matrix.inv = inverse;

    /**
     * Returns the inverse
     * @memberOf Matrix
     * @static
     * @param {Matrix} matrix
     * @return {Matrix} matrix
     * @alias inv
     */
    Matrix.prototype.inverse = Matrix.prototype.inv = function (this: Api.MatrixBase) : Api.Matrix {
        return inverse(this);
    };

    function solve(leftHandSide: Api.MatrixInput, rightHandSide: Api.MatrixInput) : Api.Matrix {
        leftHandSide = Matrix.checkMatrix(leftHandSide);
        rightHandSide = Matrix.checkMatrix(rightHandSide);
        // @ts-expect-error upstream decomposition body was excluded; this original call throws if reached.
                return leftHandSide.isSquare() ? new LuDecomposition(leftHandSide).solve(rightHandSide) : new QrDecomposition(leftHandSide).solve(rightHandSide);
    }

    Matrix.solve = solve;
    Matrix.prototype.solve = function (this: Api.MatrixBase, other: Api.MatrixInput) : Api.Matrix {
        return solve(this, other);
    };

    MLMatrixDecompositions = {
        SingularValueDecomposition: SingularValueDecomposition,
        SVD: SingularValueDecomposition,
        EigenvalueDecomposition: EigenvalueDecomposition,
        EVD: EigenvalueDecomposition,
        LuDecomposition: LuDecomposition,
        LU: LuDecomposition,
        QrDecomposition: QrDecomposition,
        QR: QrDecomposition,
        CholeskyDecomposition: CholeskyDecomposition,
        CHO: CholeskyDecomposition,
        inverse: inverse,
        solve: solve
    };
}

// ml-matrix src/index.js
let MLMatrix: Record<string, never> | (Api.MatrixConstructor & MatrixModuleExtensions) = {};
{
    MLMatrix = MLMatrixMatrix.Matrix;
    MLMatrix.Decompositions = MLMatrix.DC = MLMatrixDecompositions;
}


export const Matrix = MLMatrixMatrix.Matrix as Api.MatrixConstructor;
export { MLMatrix, MLMatrixMatrix };

export type SpeciesSource = Api.SpeciesSource;
export type MatrixTag = Api.MatrixTag;
export type MatrixBase = Api.MatrixBase;
export type Matrix = Api.Matrix;
export type MatrixView = Api.MatrixView;
export type MatrixLike = Api.MatrixLike;
export type AbstractMatrix = Api.AbstractMatrix;
export type AbstractArrayMatrix = Api.AbstractArrayMatrix;
export type MatrixRows = Api.MatrixRows;
export type MatrixInput = Api.MatrixInput;
export type MatrixVector = Api.MatrixVector;
export type BaseView = Api.BaseView;
export type MatrixColumnView = Api.MatrixColumnView;
export type MatrixFlipColumnView = Api.MatrixFlipColumnView;
export type MatrixFlipRowView = Api.MatrixFlipRowView;
export type MatrixRowView = Api.MatrixRowView;
export type MatrixSelectionView = Api.MatrixSelectionView;
export type MatrixSubView = Api.MatrixSubView;
export type MatrixTransposeView = Api.MatrixTransposeView;
export type MatrixConstructor = Api.MatrixConstructor;
