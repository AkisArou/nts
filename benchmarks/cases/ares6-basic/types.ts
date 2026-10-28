/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Basic/ast.js
// Original license retained above; shared notices: ../LICENSE-ares6.

import type { State } from "./state.ts";
import type { NumberValue } from "./number.ts";

// These interfaces describe the original mutable AST records. The evaluator's
// explicit this parameter disappears when TypeScript is stripped.
export interface NumericExpression {
    evaluate(state: State): number;
    value?: number;
    left?: NumericExpression;
    right?: NumericExpression;
    term?: NumericExpression;
    name?: string;
    parameters?: NumericExpression[];
}
export interface StringExpression { evaluate(state: State): string; value?: string; name?: string; }
export interface RelationalExpression {
    evaluate(state: State): boolean;
    left?: NumericExpression | StringExpression;
    right?: NumericExpression | StringExpression;
}
export interface VariableExpression {
    evaluate(state: State): NumberValue;
    // READ calls this absent member in the source; preserve that failure.
    assign?: (value: number | string) => void;
}
export interface NumberApplyExpression extends NumericExpression {
    name: string;
    parameters: NumericExpression[];
}
export interface VariableApplyExpression extends VariableExpression {
    name: string;
    parameters: NumericExpression[];
}
export interface ConstantExpression<T> { value: T; }
export interface BinaryNumericExpression extends NumericExpression {
    left: NumericExpression;
    right: NumericExpression;
}
export interface NegateExpression extends NumericExpression { term: NumericExpression; }
export interface StringVariableExpression extends StringExpression { name: string; }
export interface EqualityExpression {
    left: NumericExpression | StringExpression;
    right: NumericExpression | StringExpression;
}
export interface OrderedExpression {
    left: NumericExpression;
    right: NumericExpression;
}

export type PlainTokenKind = "identifier" | "keyword" | "operator" | "remark" | "userLineNumber" | "newLine" | "endOfFile";
export interface TokenLocation {
    string: string;
    sourceLineNumber?: number;
    userLineNumber?: number;
}
export interface PlainToken extends TokenLocation { kind: PlainTokenKind; }
export interface NumericToken extends TokenLocation { kind: "number"; value?: number; }
export interface StringToken extends TokenLocation { kind: "string"; value?: string; }
export type Token = PlainToken | NumericToken | StringToken;
export type TokenKind = Token["kind"];
export type Name = string | Token;

export interface OutputEvent { kind: "output"; string: string; }
export interface InputEvent { kind: "input"; numItems: number; }
export interface Execution extends Generator<OutputEvent | InputEvent, void, number[] | undefined> {
    // JavaScript generator next ignores arguments after the first. This
    // signature permits the source's spread call without changing that call.
    next(...args: (number[] | undefined)[]): IteratorResult<OutputEvent | InputEvent, void>;
}
export interface Processor {
    (state: State): Execution;
    isBlockEnd?: boolean;
}
export type PrintItem = { kind: "comma" } | { kind: "tab" | "number"; value: NumericExpression } | { kind: "string"; value: StringExpression };
export interface DimItem { name: string; bounds: number[]; }

// Parsing fills the optional fields before installing/using their processor.
// Individual evaluator receivers below require precisely their own fields.
export interface Statement {
    lineNumber: number;
    sourceLineNumber?: number;
    process?: Processor;
    kind?: Processor;
    name?: Name;
    parameters?: Name[];
    expression?: NumericExpression | StringExpression;
    variable?: string | VariableExpression;
    condition?: RelationalExpression;
    target?: number | Statement;
    targets?: number[];
    initial?: NumericExpression;
    limit?: NumericExpression;
    step?: NumericExpression;
    items?: PrintItem[] | VariableExpression[] | DimItem[];
    nextLineNumber?: number | null;
    // RETURN calls this absent member in the source; preserve that failure.
    validate?: (predicate: unknown, text: string) => void;
}
export interface JumpStatement extends Statement { target: number; }
export interface DefStatement extends Statement { name: Name; parameters: Name[]; expression: NumericExpression; }
export interface LetStatement extends Statement { variable: VariableExpression; expression: NumericExpression; }
export interface IfStatement extends JumpStatement { condition: RelationalExpression; }
export interface OnStatement extends Statement { expression: NumericExpression; targets: number[]; }
export interface ForStatement extends Statement {
    variable: string;
    initial: NumericExpression;
    limit: NumericExpression;
    step: NumericExpression;
    target: Statement;
}
export interface NextStatement extends Statement { target: Statement; }
export interface PrintStatement extends Statement { items: PrintItem[]; }
export interface InputStatement extends Statement { items: VariableExpression[]; }
export interface DimStatement extends Statement { items: DimItem[]; }
export interface Program {
    process(state: State): Execution;
    statements: Map<number, Statement>;
    data: (number | string)[];
    base: number;
}
export interface LoopSideState {
    variable?: NumberValue;
    initialValue?: number;
    limitValue?: number;
    stepValue?: number;
    shouldStop?: () => boolean;
}
export interface NumericValue {
    apply(state: State, parameters: number[]): number;
    leftApply(state: State, parameters: number[]): NumberValue;
}
