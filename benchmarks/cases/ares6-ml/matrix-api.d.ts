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
// Type-only public API for the pinned upstream matrix runtime. Operator
// implementations remain in upstream eval templates; this file has no bodies.
export interface SpeciesSource {
    readonly [Symbol.species]: MatrixConstructor;
    checkMatrix(value: MatrixBase): MatrixBase;
}
export interface MatrixTag { klass: "Matrix"; }
export interface MatrixBase {
    constructor: SpeciesSource;
    rows: number; columns: number; klass: "Matrix";
    get size(): number;
    apply<T extends MatrixLike>(this: T, callback: (this: T, i: number, j: number) => void): T;
    to1DArray(): number[];
    to2DArray(): number[][];
    isRowVector(): boolean;
    isColumnVector(): boolean;
    isVector(): boolean;
    isSquare(): boolean;
    isSymmetric(): boolean;
    set(rowIndex: number, columnIndex: number, value: number): this;
    get(rowIndex: number, columnIndex: number): number;
    repeat(rowRep?: number, colRep?: number): Matrix;
    fill(value: number): this;
    neg(): this;
    getRow(index: number): number[];
    getRowVector(this: Matrix, index: number): MatrixLike;
    setRow(index: number, array: MatrixVector): this;
    swapRows(row1: number, row2: number): this;
    getColumn(index: number): number[];
    getColumnVector(this: Matrix, index: number): MatrixLike;
    setColumn(index: number, array: MatrixVector): this;
    swapColumns(column1: number, column2: number): this;
    addRowVector(vector: MatrixVector): this;
    subRowVector(vector: MatrixVector): this;
    mulRowVector(vector: MatrixVector): this;
    divRowVector(vector: MatrixVector): this;
    addColumnVector(vector: MatrixVector): this;
    subColumnVector(vector: MatrixVector): this;
    mulColumnVector(vector: MatrixVector): this;
    divColumnVector(vector: MatrixVector): this;
    mulRow(index: number, value: number): this;
    mulColumn(index: number, value: number): this;
    max(): number;
    maxIndex(): number[];
    min(): number;
    minIndex(): number[];
    maxRow(row: number): number;
    maxRowIndex(row: number): number[];
    minRow(row: number): number;
    minRowIndex(row: number): number[];
    maxColumn(column: number): number;
    maxColumnIndex(column: number): number[];
    minColumn(column: number): number;
    minColumnIndex(column: number): number[];
    diag(): number[];
    sum(): number;
    sum(by?: string): Matrix | number;
    mean(): number;
    prod(): number;
    cumulativeSum(): this;
    dot(vector2: MatrixVector): number;
    mmul(other: MatrixLike): Matrix;
    strassen2x2(other: MatrixLike): Matrix;
    strassen3x3(other: MatrixLike): Matrix;
    mmulStrassen(this: Matrix, y: Matrix): Matrix;
    scaleRows(this: Matrix, min?: number, max?: number): MatrixLike;
    scaleColumns(this: Matrix, min?: number, max?: number): MatrixLike;
    kroneckerProduct(other: MatrixLike): Matrix;
    transpose(): Matrix;
    sortRows(compareFunction?: (a: number, b: number) => number): this;
    sortColumns(compareFunction?: (a: number, b: number) => number): this;
    subMatrix(startRow: number, endRow: number, startColumn: number, endColumn: number): Matrix;
    subMatrixRow(indices: number[], startColumn?: number, endColumn?: number): Matrix;
    subMatrixColumn(indices: number[], startRow?: number, endRow?: number): Matrix;
    setSubMatrix(this: Matrix, matrix: MatrixInput, startRow: number, startColumn: number): this;
    selection(rowIndices: number[], columnIndices: number[]): Matrix;
    trace(): number;
    transposeView(): MatrixTransposeView;
    rowView(row: number): MatrixRowView;
    columnView(column: number): MatrixColumnView;
    flipRowView(): MatrixFlipRowView;
    flipColumnView(): MatrixFlipColumnView;
    subMatrixView(startRow: number, endRow: number, startColumn: number, endColumn: number): MatrixSubView;
    selectionView(rowIndices: number[], columnIndices: number[]): MatrixSelectionView;
    add(value: number | MatrixInput): this;
    addS(value: number): this;
    addM(matrix: MatrixInput): this;
    sub(value: number | MatrixInput): this;
    subS(value: number): this;
    subM(matrix: MatrixInput): this;
    subtract(value: number | MatrixInput): this;
    subtractS(value: number): this;
    subtractM(matrix: MatrixInput): this;
    mul(value: number | MatrixInput): this;
    mulS(value: number): this;
    mulM(matrix: MatrixInput): this;
    multiply(value: number | MatrixInput): this;
    multiplyS(value: number): this;
    multiplyM(matrix: MatrixInput): this;
    div(value: number | MatrixInput): this;
    divS(value: number): this;
    divM(matrix: MatrixInput): this;
    divide(value: number | MatrixInput): this;
    divideS(value: number): this;
    divideM(matrix: MatrixInput): this;
    mod(value: number | MatrixInput): this;
    modS(value: number): this;
    modM(matrix: MatrixInput): this;
    modulus(value: number | MatrixInput): this;
    modulusS(value: number): this;
    modulusM(matrix: MatrixInput): this;
    and(value: number | MatrixInput): this;
    andS(value: number): this;
    andM(matrix: MatrixInput): this;
    or(value: number | MatrixInput): this;
    orS(value: number): this;
    orM(matrix: MatrixInput): this;
    xor(value: number | MatrixInput): this;
    xorS(value: number): this;
    xorM(matrix: MatrixInput): this;
    leftShift(value: number | MatrixInput): this;
    leftShiftS(value: number): this;
    leftShiftM(matrix: MatrixInput): this;
    signPropagatingRightShift(value: number | MatrixInput): this;
    signPropagatingRightShiftS(value: number): this;
    signPropagatingRightShiftM(matrix: MatrixInput): this;
    rightShift(value: number | MatrixInput): this;
    rightShiftS(value: number): this;
    rightShiftM(matrix: MatrixInput): this;
    zeroFillRightShift(value: number | MatrixInput): this;
    zeroFillRightShiftS(value: number): this;
    zeroFillRightShiftM(matrix: MatrixInput): this;
    not(): this;
    abs(): this;
    acos(): this;
    acosh(): this;
    asin(): this;
    asinh(): this;
    atan(): this;
    atanh(): this;
    cbrt(): this;
    ceil(): this;
    clz32(): this;
    cos(): this;
    cosh(): this;
    exp(): this;
    expm1(): this;
    floor(): this;
    fround(): this;
    log(): this;
    log1p(): this;
    log10(): this;
    log2(): this;
    round(): this;
    sign(): this;
    sin(): this;
    sinh(): this;
    sqrt(): this;
    tan(): this;
    tanh(): this;
    trunc(): this;
    pow(value: number | MatrixInput): this;
    powS(value: number): this;
    powM(matrix: MatrixInput): this;
    diagonal(): number[];
    negate(): this;
    tensorProduct(other: MatrixLike): Matrix;
    det(): number;
    determinant(): number;
    pseudoInverse(threshold?: number): Matrix;
    inverse?(): Matrix;
    inv?(): Matrix;
    solve?(other: MatrixInput): Matrix;

}
export interface Matrix extends MatrixBase {
    constructor: MatrixConstructor;
    [index: number]: number[];
    length: number;
    splice(start: number, deleteCount: number, ...items: number[][]): number[][];
    clone(): Matrix;
    removeRow(index: number): this;
    addRow(array: MatrixVector): this;
    addRow(index: number, array: MatrixVector): this;
    removeColumn(index: number): this;
    addColumn(array: MatrixVector): this;
    addColumn(index: number, array: MatrixVector): this;
    mmul(other: MatrixInput): Matrix;
    kroneckerProduct(other: MatrixInput): Matrix;
    tensorProduct(other: MatrixInput): Matrix;
}
export interface MatrixView extends MatrixBase {}
export type MatrixLike = MatrixBase;
export type AbstractMatrix = MatrixView;
export type AbstractArrayMatrix = Matrix;
// The tag test can refine the declared input domain, but does not validate a
// structurally spoofed unknown object. Ordinary arrays have no Matrix tag.
export type MatrixRows = number[][] & { klass?: undefined };
export type MatrixInput = MatrixLike | MatrixRows;
export type MatrixVector = MatrixLike | (number[] & { klass?: undefined; to1DArray?: () => number[] });
export type BaseView = MatrixView;
export type MatrixColumnView = MatrixView;
export type MatrixFlipColumnView = MatrixView;
export type MatrixFlipRowView = MatrixView;
export type MatrixRowView = MatrixView;
export type MatrixSelectionView = MatrixView;
export type MatrixSubView = MatrixView;
export type MatrixTransposeView = MatrixView;
export interface MatrixConstructor {
    prototype: Partial<Matrix>;
    new(nRows: number): unknown[];
    new(nRows: number, nColumns: number): Matrix;
    new(nRows: MatrixInput): Matrix;
    readonly [Symbol.species]: MatrixConstructor;
    from1DArray(newRows: number, newColumns: number, newData: number[]): AbstractArrayMatrix;
    rowVector(newData: number[]): AbstractArrayMatrix;
    columnVector(newData: number[]): AbstractArrayMatrix;
    empty(rows: number, columns: number): AbstractArrayMatrix;
    zeros(rows: number, columns: number): AbstractArrayMatrix;
    ones(rows: number, columns: number): AbstractArrayMatrix;
    rand(rows: number, columns: number, rng?: () => number): AbstractArrayMatrix;
    randInt(rows: number, columns: number, maxValue?: number, rng?: () => number): AbstractArrayMatrix;
    eye(rows: number, columns?: number, value?: number): AbstractArrayMatrix;
    diag(data: number[], rows?: number, columns?: number): AbstractArrayMatrix;
    min(matrix1: MatrixInput, matrix2: MatrixInput): AbstractArrayMatrix;
    max(matrix1: MatrixInput, matrix2: MatrixInput): AbstractArrayMatrix;
    checkMatrix(value: Matrix | number[][]): Matrix;
    checkMatrix(value: MatrixInput): MatrixLike;
    isMatrix<T extends MatrixTag>(value: T | MatrixRows | (number[] & { klass?: undefined }) | number | null | undefined): value is T;
    isMatrix(value: unknown): value is MatrixTag;
    add(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    sub(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    subtract(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    mul(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    multiply(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    div(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    divide(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    mod(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    modulus(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    and(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    or(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    xor(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    leftShift(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    signPropagatingRightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    rightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    zeroFillRightShift(matrix: MatrixInput, value: number | MatrixInput): Matrix;
    not(matrix: MatrixInput): Matrix;
    abs(matrix: MatrixInput): Matrix;
    acos(matrix: MatrixInput): Matrix;
    acosh(matrix: MatrixInput): Matrix;
    asin(matrix: MatrixInput): Matrix;
    asinh(matrix: MatrixInput): Matrix;
    atan(matrix: MatrixInput): Matrix;
    atanh(matrix: MatrixInput): Matrix;
    cbrt(matrix: MatrixInput): Matrix;
    ceil(matrix: MatrixInput): Matrix;
    clz32(matrix: MatrixInput): Matrix;
    cos(matrix: MatrixInput): Matrix;
    cosh(matrix: MatrixInput): Matrix;
    exp(matrix: MatrixInput): Matrix;
    expm1(matrix: MatrixInput): Matrix;
    floor(matrix: MatrixInput): Matrix;
    fround(matrix: MatrixInput): Matrix;
    log(matrix: MatrixInput): Matrix;
    log1p(matrix: MatrixInput): Matrix;
    log10(matrix: MatrixInput): Matrix;
    log2(matrix: MatrixInput): Matrix;
    round(matrix: MatrixInput): Matrix;
    sign(matrix: MatrixInput): Matrix;
    sin(matrix: MatrixInput): Matrix;
    sinh(matrix: MatrixInput): Matrix;
    sqrt(matrix: MatrixInput): Matrix;
    tan(matrix: MatrixInput): Matrix;
    tanh(matrix: MatrixInput): Matrix;
    trunc(matrix: MatrixInput): Matrix;
    pow(matrix: MatrixInput, arg0: number | MatrixInput): Matrix;
    random: MatrixConstructor["rand"];
    diagonal: MatrixConstructor["diag"];
    identity: MatrixConstructor["eye"];
}
