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

import { NumberArray, NumberFunction } from "./number.ts";
import { createRNGWithRandomSeed } from "./random.ts";
import type { State } from "./state.ts";
import type { BinaryNumericExpression, ConstantExpression, DefStatement, DimStatement, EqualityExpression, Execution, ForStatement, IfStatement, InputStatement, JumpStatement, LetStatement, NegateExpression, NextStatement, NumberApplyExpression, OnStatement, OrderedExpression, PrintStatement, Program, Statement, StringVariableExpression, VariableApplyExpression } from "./types.ts";

function NumberApply(this: NumberApplyExpression, state: State): number
{
    // I'd call this arguments but we're in strict mode.
    let parameters = this.parameters.map(value => value.evaluate(state));
    
    return state.getValue(this.name, parameters.length).apply(state, parameters);
};

function Variable(this: VariableApplyExpression, state: State): import("./number.ts").NumberValue
{
    let parameters = this.parameters.map(value => value.evaluate(state));
    
    return state.getValue(this.name, parameters.length).leftApply(state, parameters);
}

function Const<T>(this: ConstantExpression<T>, state: State): T
{
    return this.value;
}

function NumberPow(this: BinaryNumericExpression, state: State): number
{
    return Math.pow(this.left.evaluate(state), this.right.evaluate(state));
}

function NumberMul(this: BinaryNumericExpression, state: State): number
{
    return this.left.evaluate(state) * this.right.evaluate(state);
}

function NumberDiv(this: BinaryNumericExpression, state: State): number
{
    return this.left.evaluate(state) / this.right.evaluate(state);
}

function NumberNeg(this: NegateExpression, state: State): number
{
    return -this.term.evaluate(state);
}

function NumberAdd(this: BinaryNumericExpression, state: State): number
{
    return this.left.evaluate(state) + this.right.evaluate(state);
}

function NumberSub(this: BinaryNumericExpression, state: State): number
{
    return this.left.evaluate(state) - this.right.evaluate(state);
}

function StringVar(this: StringVariableExpression, state: State): string
{
    let value = state.stringValues.get(this.name);
    if (value == null)
        state.abort("Could not find string variable " + this.name);
    return value;
}

function Equals(this: EqualityExpression, state: State): boolean
{
    return this.left.evaluate(state) == this.right.evaluate(state);
}

function NotEquals(this: EqualityExpression, state: State): boolean
{
    return this.left.evaluate(state) != this.right.evaluate(state);
}

function LessThan(this: OrderedExpression, state: State): boolean
{
    return this.left.evaluate(state) < this.right.evaluate(state);
}

function GreaterThan(this: OrderedExpression, state: State): boolean
{
    return this.left.evaluate(state) > this.right.evaluate(state);
}

function LessEqual(this: OrderedExpression, state: State): boolean
{
    return this.left.evaluate(state) <= this.right.evaluate(state);
}

function GreaterEqual(this: OrderedExpression, state: State): boolean
{
    return this.left.evaluate(state) >= this.right.evaluate(state);
}

function* GoTo(this: JumpStatement, state: State): Execution
{
    state.nextLineNumber = this.target;
}

function* GoSub(this: JumpStatement, state: State): Execution
{
    state.subStack.push(state.nextLineNumber);
    state.nextLineNumber = this.target;
}

function* Def(this: DefStatement, state: State): Execution
{
    state.validate(!state.values.has(this.name), "Cannot redefine function");
    state.values.set(this.name, new NumberFunction(this.parameters, this.expression));
}

function* Let(this: LetStatement, state: State): Execution
{
    this.variable.evaluate(state).assign(this.expression.evaluate(state));
}

function* If(this: IfStatement, state: State): Execution
{
    if (this.condition.evaluate(state))
        state.nextLineNumber = this.target;
}

function* Return(this: Statement, state: State): Execution
{
    this.validate!(state.subStack.length, "Not in a subroutine");
    this.nextLineNumber = state.subStack.pop();
}

function* Stop(this: Statement, state: State): Execution
{
    state.nextLineNumber = null;
}

function* On(this: OnStatement, state: State): Execution
{
    let index = this.expression.evaluate(state);
    if (!(index >= 1) || !(index <= this.targets.length))
        state.abort("Index out of bounds: " + index);
    this.nextLineNumber = this.targets[Math.floor(index)];
}

function* For(this: ForStatement, state: State): Execution
{
    let sideState = state.getSideState(this);
    sideState.variable = state.getValue(this.variable, 0).leftApply(state, []);
    sideState.initialValue = this.initial.evaluate(state);
    sideState.limitValue = this.limit.evaluate(state);
    sideState.stepValue = this.step.evaluate(state);
    sideState.variable.assign(sideState.initialValue);
    sideState.shouldStop = function() {
        return (sideState.variable!.value - sideState.limitValue!) * Math.sign(sideState.stepValue!) > 0;
    };
    if (sideState.shouldStop!())
        this.nextLineNumber = this.target.lineNumber + 1;
}

function* Next(this: NextStatement, state: State): Execution
{
    let sideState = state.getSideState(this.target);
    sideState.variable!.assign(sideState.variable!.value + sideState.stepValue!);
    if (sideState.shouldStop!())
        return;
    state.nextLineNumber = this.target.lineNumber + 1;
}

Next.isBlockEnd = true;

function* Print(this: PrintStatement, state: State): Execution
{
    let string = "";
    for (let item of this.items) {
        const kind = item.kind;
        switch (item.kind) {
        case "comma":
            while (string.length % 14)
                string += " ";
            break;
        case "tab": {
            let value = item.value.evaluate(state);
            value = Math.max(Math.round(value), 1);
            while (string.length % value)
                string += " ";
            break;
        }
        case "string":
        case "number":
            string += item.value.evaluate(state);
            break;
        default:
            throw new Error("Bad item kind: " + kind);
        }
    }
    
    yield {kind: "output", string};
}

function* Input(this: InputStatement, state: State): Execution
{
    let results = yield {kind: "input", numItems: this.items.length};
    state.validate(results != null && results.length == this.items.length, "Input did not get the right number of items");
    for (let i = 0; i < results.length; ++i)
        this.items[i].evaluate(state).assign(results[i]);
}

function* Read(this: InputStatement, state: State): Execution
{
    for (let item of this.items) {
        state.validate(state.dataIndex < state.program.data.length, "Attempting to read past the end of data");
        item.assign!(state.program.data[state.dataIndex++]);
    }
}

function* Restore(this: Statement, state: State): Execution
{
    state.dataIndex = 0;
}

function* Dim(this: DimStatement, state: State): Execution
{
    for (let item of this.items) {
        state.validate(!state.values.has(item.name), "Variable " + item.name + " already exists");
        state.validate(item.bounds.length, "Dim statement is for arrays");
        state.values.set(item.name, new NumberArray(item.bounds.map(bound => bound + 1)));
    }
}

function* Randomize(this: Statement, state: State): Execution
{
    state.rng = createRNGWithRandomSeed();
}

function* End(this: Statement, state: State): Execution
{
    state.nextLineNumber = null;
}

End.isBlockEnd = true;

function* programGenerator(this: Program, state: State): Execution
{
    state.validate(state.program == this, "State must match program");
    let maxLineNumber = Math.max(...this.statements.keys());
    while (state.nextLineNumber != null) {
        state.validate(state.nextLineNumber <= maxLineNumber, "Went out of bounds of the program");
        let statement = this.statements.get(state.nextLineNumber++);
        if (statement == null || statement.process == null)
            continue;
        state.statement = statement;
        yield* statement.process(state);
    }
}


export const Basic = {
    NumberApply, Variable, Const, NumberPow, NumberMul, NumberDiv, NumberNeg,
    NumberAdd, NumberSub, StringVar, Equals, NotEquals, LessThan, GreaterThan,
    LessEqual, GreaterEqual, GoTo, GoSub, Def, Let, If, Return, Stop, On, For,
    Next, Print, Input, Read, Restore, Dim, Randomize, End, Program: programGenerator
};
