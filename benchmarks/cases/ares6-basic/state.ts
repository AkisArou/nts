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
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Basic/state.js
// Original license retained above; shared notices: ../LICENSE-ares6.

import { CaselessMap } from "./caseless_map.ts";
import { NativeFunction, NumberArray, NumberValue } from "./number.ts";
import { createRNGWithFixedSeed } from "./random.ts";
import type { LoopSideState, Name, NumericValue, Program, Statement } from "./types.ts";

export class State {
    declare values: CaselessMap<NumericValue | number> | Map<Name, NumericValue | number>;
    declare stringValues: CaselessMap<string>;
    declare sideState: WeakMap<Statement, LoopSideState>;
    declare statement: Statement | null;
    declare nextLineNumber: number | null;
    declare subStack: (number | null)[];
    declare dataIndex: number;
    declare program: Program;
    declare rng: () => number;
    constructor(program: Program)
    {
        this.values = new CaselessMap<NumericValue | number>();
        this.stringValues = new CaselessMap<string>();
        this.sideState = new WeakMap<Statement, LoopSideState>();
        this.statement = null;
        this.nextLineNumber = 0;
        this.subStack = [];
        this.dataIndex = 0;
        this.program = program;
        this.rng = createRNGWithFixedSeed();
        
        let addNative = (name: string, callback: (...parameters: number[]) => number) => {
            this.values.set(name, new NativeFunction(callback));
        };
        
        addNative("abs", x => Math.abs(x));
        addNative("atn", x => Math.atan(x));
        addNative("cos", x => Math.cos(x));
        addNative("exp", x => Math.exp(x));
        addNative("int", x => Math.floor(x));
        addNative("log", x => Math.log(x));
        addNative("rnd", () => this.rng());
        addNative("sgn", x => Math.sign(x));
        addNative("sin", x => Math.sin(x));
        addNative("sqr", x => Math.sqrt(x));
        addNative("tan", x => Math.tan(x));
    }
    
    getValue(name: string, numParameters: number): NumericValue
    {
        if (this.values.has(name)) {
            let result = this.values.get(name)!;
            // NumberFunction stores bare parameters upstream. Preserve the
            // resulting TypeError instead of treating them as NumberValues.
            if (typeof result == "number")
                throw new TypeError("state.getValue(...).apply is not a function");
            return result;
        }

        let result;
        if (numParameters == 0)
            result = new NumberValue();
        else {
            let dim = [];
            while (numParameters--)
                dim.push(11);
            result = new NumberArray(dim);
        }
        this.values.set(name, result);
        return result;
    }
    
    getSideState(key: Statement): LoopSideState
    {
        if (!this.sideState.has(key)) {
            let result = {};
            this.sideState.set(key, result);
            return result;
        }
        return this.sideState.get(key)!;
    }
    
    abort(text: string): never
    {
        if (!this.statement)
            throw new Error("At beginning of execution: " + text);
        throw new Error("At " + this.statement.sourceLineNumber + ": " + text);
    }
    
    validate(predicate: unknown, text: string): asserts predicate
    {
        if (!predicate)
            this.abort(text);
    }
}

