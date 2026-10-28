// Transcribed ARES-6 Air stack allocator and recorded IR inputs.
// Upstream revision: b64265f153b3178bfb4ca9f51736289f57982fce
// Source URLs and original licence headers are retained with each source section.
// All maps, sets, symbols, callbacks, loops, hashes, and instruction payloads remain.
// Required adapters: typed fields; an iterable successor projection in place of
// Proxy; removal of host timing; preserved dormant errors.

type FastCallback<T> = (value: T) => T | void;
type Callback<T> = (value: T, role: symbol, type: symbol, width: number) => T | void;
interface Thing<T> {
    extract(arg: Arg): T | null;
    forEachFast(arg: Arg, func: FastCallback<T>): Arg | void;
    forEach(arg: Arg, role: symbol, type: symbol, width: number, func: Callback<T>): Arg | void;
}
interface PatchArgData { role: symbol; type: symbol; width: number; }

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/symbols.js
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

// This file is for misc symbols.

// B3 types
export const Void = Symbol("Void");
export const Int32 = Symbol("Int32");
export const Int64 = Symbol("Int64");
export const Float = Symbol("Float");
export const Double = Symbol("Double");

// Arg type
export const GP = Symbol("GP");
export const FP = Symbol("FP");

// Stack slot kind
export const Locked = Symbol("Locked");
export const Spill = Symbol("Spill");

// Frequency class
export const Normal = Symbol("Normal");
export const Rare = Symbol("Rare");

// Relational conditions
export const Equal = Symbol("Equal");
export const NotEqual = Symbol("NotEqual");
export const Above = Symbol("Above");
export const AboveOrEqual = Symbol("AboveOrEqual");
export const Below = Symbol("Below");
export const BelowOrEqual = Symbol("BelowOrEqual");
export const GreaterThan = Symbol("GreaterThan");
export const GreaterThanOrEqual = Symbol("GreaterThanOrEqual");
export const LessThan = Symbol("LessThan");
export const LessThanOrEqual = Symbol("LessThanOrEqual");

export function relCondCode(cond: symbol): number
{
    switch (cond) {
    case Equal:
        return 4;
    case NotEqual:
        return 5;
    case Above:
        return 7;
    case AboveOrEqual:
        return 3;
    case Below:
        return 2;
    case BelowOrEqual:
        return 6;
    case GreaterThan:
        return 15;
    case GreaterThanOrEqual:
        return 13;
    case LessThan:
        return 12;
    case LessThanOrEqual:
        return 14;
    default:
        throw new Error("Bad rel cond");
    }
}

// Result conditions
export const Overflow = Symbol("Overflow");
export const Signed = Symbol("Signed");
export const PositiveOrZero = Symbol("PositiveOrZero");
export const Zero = Symbol("Zero");
export const NonZero = Symbol("NonZero");

export function resCondCode(cond: symbol): number
{
    switch (cond) {
    case Overflow:
        return 0;
    case Signed:
        return 8;
    case PositiveOrZero:
        return 9;
    case Zero:
        return 4;
    case NonZero:
        return 5;
    default:
        throw new Error("Bad res cond: " + cond.toString());
    }
}

// Double conditions
export const DoubleEqual = Symbol("DoubleEqual");
export const DoubleNotEqual = Symbol("DoubleNotEqual");
export const DoubleGreaterThan = Symbol("DoubleGreaterThan");
export const DoubleGreaterThanOrEqual = Symbol("DoubleGreaterThanOrEqual");
export const DoubleLessThan = Symbol("DoubleLessThan");
export const DoubleLessThanOrEqual = Symbol("DoubleLessThanOrEqual");
export const DoubleEqualOrUnordered = Symbol("DoubleEqualOrUnordered");
export const DoubleNotEqualOrUnordered = Symbol("DoubleNotEqualOrUnordered");
export const DoubleGreaterThanOrUnordered = Symbol("DoubleGreaterThanOrUnordered");
export const DoubleGreaterThanOrEqualOrUnordered = Symbol("DoubleGreaterThanOrEqualOrUnordered");
export const DoubleLessThanOrUnordered = Symbol("DoubleLessThanOrUnordered");
export const DoubleLessThanOrEqualOrUnordered = Symbol("DoubleLessThanOrEqualOrUnordered");

export function doubleCondCode(cond: symbol): number
{
    const bitInvert = 0x10;
    const bitSpecial = 0x20;
    switch (cond) {
    case DoubleEqual:
        return 4 | bitSpecial;
    case DoubleNotEqual:
        return 5;
    case DoubleGreaterThan:
        return 7;
    case DoubleGreaterThanOrEqual:
        return 3;
    case DoubleLessThan:
        return 7 | bitInvert;
    case DoubleLessThanOrEqual:
        return 3 | bitInvert;
    case DoubleEqualOrUnordered:
        return 4;
    case DoubleNotEqualOrUnordered:
        return 5 | bitSpecial;
    case DoubleGreaterThanOrUnordered:
        return 2 | bitInvert;
    case DoubleGreaterThanOrEqualOrUnordered:
        return 6 | bitInvert;
    case DoubleLessThanOrUnordered:
        return 2;
    case DoubleLessThanOrEqualOrUnordered:
        return 6;
    default:
        throw new Error("Bad cond");
    }
}

// Define pointerType()
export const Ptr = 64;

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/tmp_base.js
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

export abstract class TmpBase {
    abstract get type(): symbol;
    abstract get isReg(): boolean;
    abstract hash(): number;
    get isGP() { return this.type == GP; }
    get isFP() { return this.type == FP; }
    
    get isGPR() { return this.isReg && this.isGP; }
    get isFPR() { return this.isReg && this.isFP; }
    
    get reg(): TmpBase
    {
        if (!this.isReg)
            throw new Error("Called .reg on non-Reg");
        return this;
    }

    get gpr(): TmpBase
    {
        if (!this.isGPR)
            throw new Error("Called .gpr on non-GPR");
        return this;
    }
    
    get fpr(): TmpBase
    {
        if (!this.isFPR)
            throw new Error("Called .fpr on non-FPR");
        return this;
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/arg.js
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

export class Arg {
    declare _kind: symbol;
    declare _tmp?: TmpBase;
    declare _value?: number;
    declare _lowValue?: number;
    declare _highValue?: number;
    declare _base?: TmpBase;
    declare _offset?: number;
    declare _slot?: StackSlot;
    declare _index?: TmpBase;
    declare _scale?: number;
    declare _condition?: symbol;
    declare _width?: number;
    // These names are absent upstream; retaining undefined preserves those dormant cases.
    declare static GP: undefined;
    declare static FP: undefined;
    declare static DoubleCold: undefined;
    declare static WidthArg: undefined;
    static Invalid: symbol = Symbol("Invalid");
    static Tmp: symbol = Symbol("Tmp");
    static Imm: symbol = Symbol("Imm");
    static BigImm: symbol = Symbol("BigImm");
    static BitImm: symbol = Symbol("BitImm");
    static BitImm64: symbol = Symbol("BitImm64");
    static Addr: symbol = Symbol("Addr");
    static Stack: symbol = Symbol("Stack");
    static CallArg: symbol = Symbol("CallArg");
    static Index: symbol = Symbol("Index");
    static RelCond: symbol = Symbol("RelCond");
    static ResCond: symbol = Symbol("ResCond");
    static DoubleCond: symbol = Symbol("DoubleCond");
    static Special: symbol = Symbol("Special");
    static Width: symbol = Symbol("Width");
    static Use: symbol = Symbol("Use");
    static ColdUse: symbol = Symbol("ColdUse");
    static LateUse: symbol = Symbol("LateUse");
    static LateColdUse: symbol = Symbol("LateColdUse");
    static Def: symbol = Symbol("Def");
    static ZDef: symbol = Symbol("ZDef");
    static UseDef: symbol = Symbol("UseDef");
    static UseZDef: symbol = Symbol("UseZDef");
    static EarlyDef: symbol = Symbol("EarlyDef");
    static Scratch: symbol = Symbol("Scratch");
    static UseAddr: symbol = Symbol("UseAddr");

    constructor()
    {
        this._kind = Arg.Invalid;
    }
    
    static isAnyUse(role: symbol): boolean
    {
        switch (role) {
        case Arg.Use:
        case Arg.ColdUse:
        case Arg.UseDef:
        case Arg.UseZDef:
        case Arg.LateUse:
        case Arg.LateColdUse:
        case Arg.Scratch:
            return true;
        case Arg.Def:
        case Arg.ZDef:
        case Arg.UseAddr:
        case Arg.EarlyDef:
            return false;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isColdUse(role: symbol): boolean
    {
        switch (role) {
        case Arg.ColdUse:
        case Arg.LateColdUse:
            return true;
        case Arg.Use:
        case Arg.UseDef:
        case Arg.UseZDef:
        case Arg.LateUse:
        case Arg.Def:
        case Arg.ZDef:
        case Arg.UseAddr:
        case Arg.Scratch:
        case Arg.EarlyDef:
            return false;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isWarmUse(role: symbol): boolean
    {
        return Arg.isAnyUse(role) && !Arg.isColdUse(role);
    }
    
    static cooled(role: symbol): symbol
    {
        switch (role) {
        case Arg.ColdUse:
        case Arg.LateColdUse:
        case Arg.UseDef:
        case Arg.UseZDef:
        case Arg.Def:
        case Arg.ZDef:
        case Arg.UseAddr:
        case Arg.Scratch:
        case Arg.EarlyDef:
            return role;
        case Arg.Use:
            return Arg.ColdUse;
        case Arg.LateUse:
            return Arg.LateColdUse;
        default:
            throw new Error("Bad role");
        }
    }

    static isEarlyUse(role: symbol): boolean
    {
        switch (role) {
        case Arg.Use:
        case Arg.ColdUse:
        case Arg.UseDef:
        case Arg.UseZDef:
            return true;
        case Arg.Def:
        case Arg.ZDef:
        case Arg.UseAddr:
        case Arg.LateUse:
        case Arg.LateColdUse:
        case Arg.Scratch:
        case Arg.EarlyDef:
            return false;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isLateUse(role: symbol): boolean
    {
        switch (role) {
        case Arg.LateUse:
        case Arg.LateColdUse:
        case Arg.Scratch:
            return true;
        case Arg.ColdUse:
        case Arg.Use:
        case Arg.UseDef:
        case Arg.UseZDef:
        case Arg.Def:
        case Arg.ZDef:
        case Arg.UseAddr:
        case Arg.EarlyDef:
            return false;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isAnyDef(role: symbol): boolean
    {
        switch (role) {
        case Arg.Use:
        case Arg.ColdUse:
        case Arg.UseAddr:
        case Arg.LateUse:
        case Arg.LateColdUse:
            return false;
        case Arg.Def:
        case Arg.UseDef:
        case Arg.ZDef:
        case Arg.UseZDef:
        case Arg.EarlyDef:
        case Arg.Scratch:
            return true;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isEarlyDef(role: symbol): boolean
    {
        switch (role) {
        case Arg.Use:
        case Arg.ColdUse:
        case Arg.UseAddr:
        case Arg.LateUse:
        case Arg.Def:
        case Arg.UseDef:
        case Arg.ZDef:
        case Arg.UseZDef:
        case Arg.LateColdUse:
            return false;
        case Arg.EarlyDef:
        case Arg.Scratch:
            return true;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isLateDef(role: symbol): boolean
    {
        switch (role) {
        case Arg.Use:
        case Arg.ColdUse:
        case Arg.UseAddr:
        case Arg.LateUse:
        case Arg.EarlyDef:
        case Arg.Scratch:
        case Arg.LateColdUse:
            return false;
        case Arg.Def:
        case Arg.UseDef:
        case Arg.ZDef:
        case Arg.UseZDef:
            return true;
        default:
            throw new Error("Bad role");
        }
    }
    
    static isZDef(role: symbol): boolean
    {
        switch (role) {
        case Arg.Use:
        case Arg.ColdUse:
        case Arg.UseAddr:
        case Arg.LateUse:
        case Arg.Def:
        case Arg.UseDef:
        case Arg.EarlyDef:
        case Arg.Scratch:
        case Arg.LateColdUse:
            return false;
        case Arg.ZDef:
        case Arg.UseZDef:
            return true;
        default:
            throw new Error("Bad role");
        }
    }
    
    static typeForB3Type(type: symbol)
    {
        switch (type) {
        case Int32:
        case Int64:
            return GP;
        case Float:
        case Double:
            return FP;
        default:
            throw new Error("Bad B3 type");
        }
    }
    
    static widthForB3Type(type: symbol)
    {
        switch (type) {
        case Int32:
        case Float:
            return 32;
        case Int64:
        case Double:
            return 64;
        default:
            throw new Error("Bad B3 type");
        }
    }
    
    static conservativeWidth(type: symbol)
    {
        return type == GP ? Ptr : 64;
    }
    
    static minimumWidth(type: symbol)
    {
        return type == GP ? 8 : 32;
    }
    
    static bytes(width: number): number
    {
        return width / 8;
    }
    
    static widthForBytes(bytes: number): number
    {
        switch (bytes) {
        case 0:
        case 1:
            return 8;
        case 2:
            return 16;
        case 3:
        case 4:
            return 32;
        default:
            if (bytes > 8)
                throw new Error("Bad number of bytes");
            return 64;
        }
    }
    
    static createTmp(tmp: TmpBase): Arg
    {
        let result = new Arg();
        result._kind = Arg.Tmp;
        result._tmp = tmp;
        return result;
    }
    
    static fromReg(reg: Reg): Arg
    {
        return Arg.createTmp(reg);
    }
    
    static createImm(value: number): Arg
    {
        let result = new Arg();
        result._kind = Arg.Imm;
        result._value = value;
        return result;
    }
    
    static createBigImm(lowValue: number, highValue = 0): Arg
    {
        let result = new Arg();
        result._kind = Arg.BigImm;
        result._lowValue = lowValue;
        result._highValue = highValue;
        return result;
    }
    
    static createBitImm(value: number): Arg
    {
        let result = new Arg();
        result._kind = Arg.BitImm;
        result._value = value;
        return result;
    }
    
    static createBitImm64(lowValue: number, highValue = 0): Arg
    {
        let result = new Arg();
        result._kind = Arg.BitImm64;
        result._lowValue = lowValue;
        result._highValue = highValue;
        return result;
    }
    
    static createAddr(base: TmpBase, offset = 0): Arg
    {
        let result = new Arg();
        result._kind = Arg.Addr;
        result._base = base;
        result._offset = offset;
        return result;
    }
    
    static createStack(slot: StackSlot, offset = 0): Arg
    {
        let result = new Arg();
        result._kind = Arg.Stack;
        result._slot = slot;
        result._offset = offset;
        return result;
    }
    
    static createCallArg(offset: number): Arg
    {
        let result = new Arg();
        result._kind = Arg.CallArg;
        result._offset = offset;
        return result;
    }
    
    static createStackAddr(offsetFromFP: number, frameSize: number, width: number): Arg
    {
        let result = Arg.createAddr(Reg.callFrameRegister, offsetFromFP);
        if (!result.isValidForm(width))
            result = Arg.createAddr(Reg.stackPointerRegister, offsetFromFP + frameSize);
        return result;
    }
    
    static isValidScale(scale: number, width: number): boolean
    {
        switch (scale) {
        case 1:
        case 2:
        case 4:
        case 8:
            return true;
        default:
            return false;
        }
    }
    
    static logScale(scale: number): number
    {
        switch (scale) {
        case 1:
            return 0;
        case 2:
            return 1;
        case 4:
            return 2;
        case 8:
            return 3;
        default:
            throw new Error("Bad scale");
        }
    }
    
    static createIndex(base: TmpBase, index: TmpBase, scale = 1, offset = 0): Arg
    {
        let result = new Arg();
        result._kind = Arg.Index;
        result._base = base;
        result._index = index;
        result._scale = scale;
        result._offset = offset;
        return result;
    }
    
    static createRelCond(condition: symbol): Arg
    {
        let result = new Arg();
        result._kind = Arg.RelCond;
        result._condition = condition;
        return result;
    }
    
    static createResCond(condition: symbol): Arg
    {
        let result = new Arg();
        result._kind = Arg.ResCond;
        result._condition = condition;
        return result;
    }
    
    static createDoubleCond(condition: symbol): Arg
    {
        let result = new Arg();
        result._kind = Arg.DoubleCond;
        result._condition = condition;
        return result;
    }
    
    static createWidth(width: number): Arg
    {
        let result = new Arg();
        result._kind = Arg.Width;
        result._width = width;
        return result;
    }
    
    static createSpecial()
    {
        let result = new Arg();
        result._kind = Arg.Special;
        return result;
    }
    
    get kind() { return this._kind; }
    get isTmp() { return this._kind == Arg.Tmp; }
    get isImm() { return this._kind == Arg.Imm; }
    get isBigImm() { return this._kind == Arg.BigImm; }
    get isBitImm() { return this._kind == Arg.BitImm; }
    get isBitImm64() { return this._kind == Arg.BitImm64; }
    get isSomeImm()
    {
        switch (this._kind) {
        case Arg.Imm:
        case Arg.BitImm:
            return true;
        default:
            return false;
        }
    }
    get isSomeBigImm()
    {
        switch (this._kind) {
        case Arg.BigImm:
        case Arg.BitImm64:
            return true;
        default:
            return false;
        }
    }
    get isAddr() { return this._kind == Arg.Addr; }
    get isStack() { return this._kind == Arg.Stack; }
    get isCallArg() { return this._kind == Arg.CallArg; }
    get isIndex() { return this._kind == Arg.Index; }
    get isMemory()
    {
        switch (this._kind) {
        case Arg.Addr:
        case Arg.Stack:
        case Arg.CallArg:
        case Arg.Index:
            return true;
        default:
            return false;
        }
    }
    get isStackMemory()
    {
        switch (this._kind) {
        case Arg.Addr:
            return this._base! == Reg.callFrameRegister
                || this._base! == Reg.stackPointerRegister;
        case Arg.Stack:
        case Arg.CallArg:
            return true;
        default:
            return false;
        }
    }
    get isRelCond() { return this._kind == Arg.RelCond; }
    get isResCond() { return this._kind == Arg.ResCond; }
    get isDoubleCond() { return this._kind == Arg.DoubleCond; }
    get isCondition()
    {
        switch (this._kind) {
        case Arg.RelCond:
        case Arg.ResCond:
        case Arg.DoubleCond:
            return true;
        default:
            return false;
        }
    }
    get isWidth() { return this._kind == Arg.Width; }
    get isSpecial() { return this._kind == Arg.Special; }
    get isAlive() { return this.isTmp || this.isStack; }
    
    get tmp()
    {
        if (this._kind != Arg.Tmp)
            throw new Error("Called .tmp for non-tmp");
        return this._tmp!;
    }
    
    get value()
    {
        if (!this.isSomeImm)
            throw new Error("Called .value for non-imm");
        return this._value!;
    }
    
    get lowValue()
    {
        if (!this.isSomeBigImm)
            throw new Error("Called .lowValue for non-big-imm");
        return this._lowValue!;
    }
    
    get highValue()
    {
        if (!this.isSomeBigImm)
            throw new Error("Called .highValue for non-big-imm");
        return this._highValue!;
    }
    
    get base()
    {
        switch (this._kind) {
        case Arg.Addr:
        case Arg.Index:
            return this._base!;
        default:
            throw new Error("Called .base for non-address");
        }
    }
    
    get hasOffset() { return this.isMemory; }
    
    get offset()
    {
        switch (this._kind) {
        case Arg.Addr:
        case Arg.Index:
        case Arg.Stack:
        case Arg.CallArg:
            return this._offset!;
        default:
            throw new Error("Called .offset for non-address");
        }
    }
    
    get stackSlot()
    {
        if (this._kind != Arg.Stack)
            throw new Error("Called .stackSlot for non-address");
        return this._slot!;
    }
    
    get index()
    {
        if (this._kind != Arg.Index)
            throw new Error("Called .index for non-Index");
        return this._index!;
    }
    
    get scale()
    {
        if (this._kind != Arg.Index)
            throw new Error("Called .scale for non-Index");
        return this._scale!;
    }
    
    get logScale()
    {
        return Arg.logScale(this.scale);
    }
    
    get width()
    {
        if (this._kind != Arg.Width)
            throw new Error("Called .width for non-Width");
        return this._width!;
    }
    
    get isGPTmp() { return this.isTmp && this.tmp.isGP; }
    get isFPTmp() { return this.isTmp && this.tmp.isFP; }
    
    get isGP()
    {
        switch (this._kind) {
        case Arg.Imm:
        case Arg.BigImm:
        case Arg.BitImm:
        case Arg.BitImm64:
        case Arg.Addr:
        case Arg.Index:
        case Arg.Stack:
        case Arg.CallArg:
        case Arg.RelCond:
        case Arg.ResCond:
        case Arg.DoubleCond:
        case Arg.Width:
        case Arg.Special:
            return true;
        case Arg.Tmp:
            return this.isGPTmp;
        case Arg.Invalid:
            return false;
        default:
            throw new Error("Bad kind");
        }
    }
    
    get isFP()
    {
        switch (this._kind) {
        case Arg.Imm:
        case Arg.BitImm:
        case Arg.BitImm64:
        case Arg.RelCond:
        case Arg.ResCond:
        case Arg.DoubleCond:
        case Arg.Width:
        case Arg.Special:
        case Arg.Invalid:
            return false;
        case Arg.Addr:
        case Arg.Index:
        case Arg.Stack:
        case Arg.CallArg:
        case Arg.BigImm:
            return true;
        case Arg.Tmp:
            return this.isFPTmp;
        default:
            throw new Error("Bad kind");
        }
    }
    
    get hasType()
    {
        switch (this._kind) {
        case Arg.Imm:
        case Arg.BitImm:
        case Arg.BitImm64:
        case Arg.Tmp:
            return true;
        default:
            return false;
        }
    }
    
    get type()
    {
        return this.isGP ? GP : FP;
    }
    
    isType(type: symbol): boolean
    {
        switch (type) {
        case Arg.GP:
            return this.isGP;
        case Arg.FP:
            return this.isFP;
        default:
            throw new Error("Bad type");
        }
    }
    
    isCompatibleType(other: Arg): boolean
    {
        if (this.hasType)
            return other.isType(this.type);
        if (other.hasType)
            return this.isType(other.type);
        return true;
    }
    
    get isGPR() { return this.isTmp && this.tmp.isGPR; }
    get gpr() { return this.tmp.gpr; }
    get isFPR() { return this.isTmp && this.tmp.isFPR; }
    get fpr() { return this.tmp.fpr; }
    get isReg() { return this.isTmp && this.tmp.isReg; }
    get reg() { return this.tmp.reg; }
    
    static isValidImmForm(value: number): boolean
    {
        return isRepresentableAsInt32(value);
    }
    static isValidBitImmForm(value: number): boolean
    {
        return isRepresentableAsInt32(value);
    }
    static isValidBitImm64Form(value: number): boolean
    {
        return isRepresentableAsInt32(value);
    }
    
    static isValidAddrForm(offset: number, width: number): boolean
    {
        return true;
    }
    
    static isValidIndexForm(scale: number, offset: number, width: number): boolean
    {
        // Upstream calls an unbound isValidScale here (not Arg.isValidScale).
        throw new ReferenceError("isValidScale is not defined");
    }
    
    isValidForm(width: number): boolean
    {
        switch (this._kind) {
        case Arg.Invalid:
            return false;
        case Arg.Tmp:
            return true;
        case Arg.Imm:
            return Arg.isValidImmForm(this.value);
        case Arg.BigImm:
            return true;
        case Arg.BitImm:
            return Arg.isValidBitImmForm(this.value);
        case Arg.BitImm64:
            return Arg.isValidBitImm64Form(this.value);
        case Arg.Addr:
        case Arg.Stack:
        case Arg.CallArg:
            return Arg.isValidAddrForm(this.offset, width);
        case Arg.Index:
            return Arg.isValidIndexForm(this.scale, this.offset, width);
        case Arg.RelCond:
        case Arg.ResCond:
        case Arg.DoubleCond:
        case Arg.Width:
        case Arg.Special:
            return true;
        default:
            throw new Error("Bad kind");
        }
    }
    
    forEachTmpFast(func: FastCallback<TmpBase>): Arg | void
    {
        switch (this._kind) {
        case Arg.Tmp: {
            let replacement;
            if (replacement = func(this._tmp!))
                return Arg.createTmp(replacement);
            break;
        }
        case Arg.Addr: {
            let replacement;
            if (replacement = func(this._base!))
                return Arg.createAddr(replacement, this._offset!);
            break;
        }
        case Arg.Index: {
            let baseReplacement = func(this._base!);
            let indexReplacement = func(this._index!);
            if (baseReplacement || indexReplacement) {
                return Arg.createIndex(
                    baseReplacement ? baseReplacement : this._base!,
                    indexReplacement ? indexReplacement : this._index!,
                    this._scale!, this._offset!);
            }
            break;
        }
        default:
            break;
        }
    }
    
    usesTmp(expectedTmp: TmpBase): boolean
    {
        // Upstream calls an unbound forEachTmpFast here (not this.forEachTmpFast).
        throw new ReferenceError("forEachTmpFast is not defined");
    }
    
    forEachTmp(role: symbol, type: symbol, width: number, func: Callback<TmpBase>): Arg | void
    {
        switch (this._kind) {
        case Arg.Tmp: {
            let replacement;
            if (replacement = func(this._tmp!, role, type, width))
                return Arg.createTmp(replacement);
            break;
        }
        case Arg.Addr: {
            let replacement;
            if (replacement = func(this._base!, Arg.Use, GP, role == Arg.UseAddr ? width : Ptr))
                return Arg.createAddr(replacement, this._offset!);
            break;
        }
        case Arg.Index: {
            let baseReplacement = func(this._base!, Arg.Use, GP, role == Arg.UseAddr ? width : Ptr);
            let indexReplacement = func(this._index!, Arg.Use, GP, role == Arg.UseAddr ? width : Ptr);
            if (baseReplacement || indexReplacement) {
                return Arg.createIndex(
                    baseReplacement ? baseReplacement : this._base!,
                    indexReplacement ? indexReplacement : this._index!,
                    this._scale!, this._offset!);
            }
            break;
        }
        default:
            break;
        }
    }
    
    is<T>(thing: Thing<T>): boolean { return !!thing.extract(this); }
    as<T>(thing: Thing<T>): T | null { return thing.extract(this); }
    
    // This lets you say things like:
    // arg.forEach(Tmp | Reg | Arg | StackSlot, ...)
    //
    // It's used for abstract liveness analysis.
    forEachFast<T>(thing: Thing<T>, func: FastCallback<T>): Arg | void
    {
        return thing.forEachFast(this, func);
    }
    forEach<T>(thing: Thing<T>, role: symbol, type: symbol, width: number, func: Callback<T>): Arg | void
    {
        return thing.forEach(this, role, type, width, func);
    }
    
    static extract(arg: Arg): Arg { return arg; }
    static forEachFast(arg: Arg, func: FastCallback<Arg>): Arg | void { return func(arg); }
    static forEach(arg: Arg, role: symbol, type: symbol, width: number, func: Callback<Arg>): Arg | void { return func(arg, role, type, width); }

    get condition()
    {
        switch (this._kind) {
        case Arg.RelCond:
        case Arg.ResCond:
        case Arg.DoubleCond:
            return this._condition!;
        default:
            throw new Error("Called .condition for non-condition");
        }
    }
    
    get isInvertible()
    {
        switch (this._kind) {
        case Arg.RelCond:
        case Arg.DoubleCold:
            return true;
        case Arg.ResCond:
            switch (this._condition!) {
            case Zero:
            case NonZero:
            case Signed:
            case PositiveOrZero:
                return true;
            default:
                return false;
            }
        default:
            return false;
        }
    }
    
    static kindCode(kind: symbol): number
    {
        switch (kind) {
        case Arg.Invalid:
            return 0;
        case Arg.Tmp:
            return 1;
        case Arg.Imm:
            return 2;
        case Arg.BigImm:
            return 3;
        case Arg.BitImm:
            return 4;
        case Arg.BitImm64:
            return 5;
        case Arg.Addr:
            return 6;
        case Arg.Stack:
            return 7;
        case Arg.CallArg:
            return 8;
        case Arg.Index:
            return 9;
        case Arg.RelCond:
            return 10;
        case Arg.ResCond:
            return 11;
        case Arg.DoubleCond:
            return 12;
        case Arg.Special:
            return 13;
        case Arg.WidthArg:
            return 14;
        default:
            throw new Error("Bad kind");
        }
    }
    
    hash()
    {
        let result = Arg.kindCode(this._kind);
        
        switch (this._kind) {
        case Arg.Invalid:
        case Arg.Special:
            break;
        case Arg.Tmp:
            result += this._tmp!.hash();
            result |= 0;
            break;
        case Arg.Imm:
        case Arg.BitImm:
            result += this._value!;
            result |= 0;
            break;
        case Arg.BigImm:
        case Arg.BitImm64:
            result += this._lowValue!;
            result |= 0;
            result += this._highValue!;
            result |= 0;
            break;
        case Arg.CallArg:
            result += this._offset!;
            result |= 0;
            break;
        case Arg.RelCond:
            result += relCondCode(this._condition!);
            result |= 0;
            break;
        case Arg.ResCond:
            result += resCondCode(this._condition!);
            result |= 0;
            break;
        case Arg.DoubleCond:
            result += doubleCondCode(this._condition!);
            result |= 0;
            break;
        case Arg.WidthArg:
            result += this._width!;
            result |= 0;
            break;
        case Arg.Addr:
            result += this._offset!;
            result |= 0;
            result += this._base!.hash();
            result |= 0;
            break;
        case Arg.Index:
            result += this._offset!;
            result |= 0;
            result += this._scale!;
            result |= 0;
            result += this._base!.hash();
            result |= 0;
            result += this._index!.hash();
            result |= 0;
            break;
        case Arg.Stack:
            result += this._offset!;
            result |= 0;
            result += this.stackSlot.index;
            result |= 0;
            break;
        }
        
        return result >>> 0;
    }
    
    toString()
    {
        switch (this._kind) {
        case Arg.Invalid:
            return "<invalid>";
        case Arg.Tmp:
            return this._tmp!.toString();
        case Arg.Imm:
            return "$" + this._value!;
        case Arg.BigImm:
        case Arg.BitImm64:
            return "$0x" + this._highValue!.toString(16) + ":" + this._lowValue!.toString(16);
        case Arg.Addr:
            return "" + (this._offset! ? this._offset! : "") + "(" + this._base! + ")";
        case Arg.Index:
            return "" + (this._offset! ? this._offset! : "") + "(" + this._base! +
                "," + this._index! + (this._scale! == 1 ? "" : "," + this._scale!) + ")";
        case Arg.Stack:
            return "" + (this._offset! ? this._offset! : "") + "(" + this._slot! + ")";
        case Arg.CallArg:
            return "" + (this._offset! ? this._offset! : "") + "(callArg)";
        case Arg.RelCond:
        case Arg.ResCond:
        case Arg.DoubleCond:
            return symbolName(this._condition!);
        case Arg.Special:
            return "special";
        case Arg.Width:
            return "" + this._value!;
        default:
            throw new Error("Bad kind");
        }
    }
}

// Arg kinds

// Arg roles

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/basic_block.js
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

export class BasicBlock {
    declare _index: number;
    declare _frequency: number;
    declare _insts: Inst[];
    declare _successors: FrequentedBlock[];
    declare _predecessors: BasicBlock[];
    constructor(index: number, frequency: number)
    {
        this._index = index;
        this._frequency = frequency;
        this._insts = [];
        this._successors = [];
        this._predecessors = [];
    }
    
    get index() { return this._index; }
    get size() { return this._insts.length; }
    
    [Symbol.iterator]()
    {
        return this._insts[Symbol.iterator]();
    }
    
    at(index: number)
    {
        if (index >= this._insts.length)
            throw new Error("Out of bounds access");
        return this._insts[index];
    }
    
    get(index: number)
    {
        if (index < 0 || index >= this._insts.length)
            return null;
        return this._insts[index];
    }
    
    get last()
    {
        return this._insts[this._insts.length - 1];
    }
    
    get insts() { return this._insts; }
    
    append(inst: Inst): void { this._insts.push(inst); }
    
    get numSuccessors() { return this._successors.length; }
    successor(index: number) { return this._successors[index]; }
    get successors() { return this._successors; }
    
    successorBlock(index: number) { return this._successors[index].block; }
    // Typed projection of the original Proxy's numeric reads. This generator
    // reads the same backing array in order and observes mutations during iteration.
    get successorBlocks(): Iterable<BasicBlock>
    {
        return this.iterateSuccessorBlocks(this._successors);
    }

    *iterateSuccessorBlocks(successors: FrequentedBlock[]): Generator<BasicBlock, void, unknown>
    {
        for (let successor of successors)
            yield successor.block;
    }

    get numPredecessors() { return this._predecessors.length; }
    predecessor(index: number) { return this._predecessors[index]; }
    get predecessors() { return this._predecessors; }
    
    get frequency() { return this._frequency; }

    toString()
    {
        return "#" + this._index;
    }
    
    get headerString()
    {
        let result = "";
        result += `BB${this}: ; frequency = ${this._frequency}\n`;
        if (this._predecessors.length)
            result += "  Predecessors: " + this._predecessors.join(", ") + "\n";
        return result;
    }
    
    get footerString()
    {
        let result = "";
        if (this._successors.length)
            result += "  Successors: " + this._successors.join(", ") + "\n";
        return result;
    }
    
    toStringDeep()
    {
        let result = "";
        result += this.headerString;
        for (let inst of this)
            result += `    ${inst}\n`;
        result += this.footerString;
        return result;
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/code.js
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

export class Code {
    [name: `_${string}Tmps`]: Tmp[] | undefined;
    declare _blocks: BasicBlock[];
    declare _stackSlots: StackSlot[];
    declare _gpTmps: Tmp[];
    declare _fpTmps: Tmp[];
    declare _callArgAreaSize: number;
    declare _frameSize: number;
    constructor()
    {
        this._blocks = [];
        this._stackSlots = [];
        this._gpTmps = [];
        this._fpTmps = [];
        this._callArgAreaSize = 0;
        this._frameSize = 0;
    }
    
    addBlock(frequency = 1)
    {
        return addIndexed(this._blocks, BasicBlock, frequency);
    }
    
    addStackSlot(byteSize: number, kind: symbol): StackSlot
    {
        return addIndexed(this._stackSlots, StackSlot, byteSize, kind);
    }
    
    newTmp(type: symbol): Tmp
    {
        return addIndexed(this[`_${lowerSymbolName(type)}Tmps`]!, Tmp, type);
    }
    
    get size() { return this._blocks.length; }
    at(index: number): BasicBlock { return this._blocks[index]; }
    
    [Symbol.iterator]()
    {
        return this._blocks[Symbol.iterator]();
    }
    
    get blocks() { return this._blocks; }
    get stackSlots() { return this._stackSlots; }
    
    tmps(type: symbol): Tmp[] | undefined { return this[`_${lowerSymbolName(type)}Tmps`]; }
    
    get callArgAreaSize() { return this._callArgAreaSize; }
    
    requestCallArgAreaSize(size: number): void
    {
        this._callArgAreaSize = Math.max(this._callArgAreaSize, roundUpToMultipleOf(stackAlignmentBytes, size));
    }
    
    get frameSize() { return this._frameSize; }
    
    setFrameSize(frameSize: number): void { this._frameSize = frameSize; }
    
    hash()
    {
        let result = 0;
        for (let block of this) {
            result *= 1000001;
            result |= 0;
            for (let inst of block) {
                result *= 97;
                result |= 0;
                result += inst.hash();
                result |= 0;
            }
            for (let successor of block.successorBlocks) {
                result *= 7;
                result |= 0;
                result += successor.index;
                result |= 0;
            }
        }
        for (let slot of this.stackSlots) {
            result *= 101;
            result |= 0;
            result += slot.hash();
            result |= 0;
        }
        return result >>> 0;
    }
    
    toString()
    {
        let result = "";
        for (let block of this) {
            result += block.toStringDeep();
        }
        if (this.stackSlots.length) {
            result += "Stack slots:\n";
            for (let slot of this.stackSlots)
                result += `    ${slot}\n`;
        }
        if (this._frameSize)
            result += `Frame size: ${this._frameSize}\n`;
        if (this._callArgAreaSize)
            result += `Call arg area size: ${this._callArgAreaSize}\n`;
        return result;
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/frequented_block.js
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

export class FrequentedBlock {
    declare block: BasicBlock;
    declare frequency: symbol;
    constructor(block: BasicBlock, frequency: symbol)
    {
        this.block = block;
        this.frequency = frequency;
    }
    
    toString()
    {
        return (this.frequency == Normal ? "" : "Rare:") + this.block;
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/inst.js
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

export class Inst {
    declare _opcode: symbol;
    declare _args: Arg[];
    declare patchArgData?: PatchArgData[];
    declare patchHasNonArgEffects?: boolean;
    declare extraClobberedRegs?: Set<Reg>;
    declare extraEarlyClobberedRegs?: Set<Reg>;
    declare cCallType?: symbol;
    declare cCallArgTypes?: symbol[];
    constructor(opcode: symbol, args: Arg[] = [])
    {
        this._opcode = opcode;
        this._args = args;
    }
    
    append(...args: Arg[]): void
    {
        this._args.push(...args);
    }
    
    clear()
    {
        this._opcode = Nop;
        this._args = [];
    }
    
    get opcode() { return this._opcode; }
    get args() { return this._args; }
    
    visitArg(index: number, func: Callback<Arg>, ...args: [symbol, symbol, number]): void
    {
        let replacement = func(this._args[index], ...args);
        if (replacement)
            this._args[index] = replacement;
    }
    
    forEachTmpFast(func: FastCallback<TmpBase>): void
    {
        for (let i = 0; i < this._args.length; ++i) {
            let replacement;
            if (replacement = this._args[i].forEachTmpFast(func))
                this._args[i] = replacement;
        }
    }
    
    forEachArg(func: Callback<Arg>): void
    {
        Inst_forEachArg(this, func);
    }
    
    forEachTmp(func: Callback<TmpBase>): void
    {
        this.forEachArg((arg, role, type, width) => {
            return arg.forEachTmp(role, type, width, func);
        });
    }
    
    forEach<T>(thing: Thing<T>, func: Callback<T>): void
    {
        this.forEachArg((arg, role, type, width) => {
            return arg.forEach(thing, role, type, width, func);
        });
    }
    
    static forEachDef<T>(thing: Thing<T>, prevInst: Inst | null, nextInst: Inst | null, func: Callback<T>): void
    {
        if (prevInst) {
            prevInst.forEach(
                thing,
                (value, role, type, width) => {
                    if (Arg.isLateDef(role))
                        return func(value, role, type, width);
                });
        }
        
        if (nextInst) {
            nextInst.forEach(
                thing,
                (value, role, type, width) => {
                    if (Arg.isEarlyDef(role))
                        return func(value, role, type, width);
                });
        }
    }
    
    static forEachDefWithExtraClobberedRegs<T>(thing: Thing<T>, prevInst: Inst | null, nextInst: Inst | null, func: Callback<T>): void
    {
        // The original first statement calls an unbound forEachDef and throws.
        throw new ReferenceError("forEachDef is not defined");
    }

    get hasNonArgEffects() { return Inst_hasNonArgEffects(this); }
    
    hash()
    {
        let result = opcodeCode(this.opcode);
        for (let arg of this.args) {
            result += arg.hash();
            result |= 0;
        }
        return result >>> 0;
    }
    
    toString()
    {
        return "" + symbolName(this._opcode) + " " + this._args.join(", ");
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/opcode.js
// Generated by opcode_generator.rb from JavaScriptCore/b3/air/AirOpcode.opcodes -- do not edit!
export const Nop = Symbol("Nop");
export const Add32 = Symbol("Add32");
export const Add8 = Symbol("Add8");
export const Add16 = Symbol("Add16");
export const Add64 = Symbol("Add64");
export const AddDouble = Symbol("AddDouble");
export const AddFloat = Symbol("AddFloat");
export const Sub32 = Symbol("Sub32");
export const Sub64 = Symbol("Sub64");
export const SubDouble = Symbol("SubDouble");
export const SubFloat = Symbol("SubFloat");
export const Neg32 = Symbol("Neg32");
export const Neg64 = Symbol("Neg64");
export const NegateDouble = Symbol("NegateDouble");
export const Mul32 = Symbol("Mul32");
export const Mul64 = Symbol("Mul64");
export const MultiplyAdd32 = Symbol("MultiplyAdd32");
export const MultiplyAdd64 = Symbol("MultiplyAdd64");
export const MultiplySub32 = Symbol("MultiplySub32");
export const MultiplySub64 = Symbol("MultiplySub64");
export const MultiplyNeg32 = Symbol("MultiplyNeg32");
export const MultiplyNeg64 = Symbol("MultiplyNeg64");
export const Div32 = Symbol("Div32");
export const Div64 = Symbol("Div64");
export const MulDouble = Symbol("MulDouble");
export const MulFloat = Symbol("MulFloat");
export const DivDouble = Symbol("DivDouble");
export const DivFloat = Symbol("DivFloat");
export const X86ConvertToDoubleWord32 = Symbol("X86ConvertToDoubleWord32");
export const X86ConvertToQuadWord64 = Symbol("X86ConvertToQuadWord64");
export const X86Div32 = Symbol("X86Div32");
export const X86Div64 = Symbol("X86Div64");
export const Lea = Symbol("Lea");
export const And32 = Symbol("And32");
export const And64 = Symbol("And64");
export const AndDouble = Symbol("AndDouble");
export const AndFloat = Symbol("AndFloat");
export const XorDouble = Symbol("XorDouble");
export const XorFloat = Symbol("XorFloat");
export const Lshift32 = Symbol("Lshift32");
export const Lshift64 = Symbol("Lshift64");
export const Rshift32 = Symbol("Rshift32");
export const Rshift64 = Symbol("Rshift64");
export const Urshift32 = Symbol("Urshift32");
export const Urshift64 = Symbol("Urshift64");
export const Or32 = Symbol("Or32");
export const Or64 = Symbol("Or64");
export const Xor32 = Symbol("Xor32");
export const Xor64 = Symbol("Xor64");
export const Not32 = Symbol("Not32");
export const Not64 = Symbol("Not64");
export const AbsDouble = Symbol("AbsDouble");
export const AbsFloat = Symbol("AbsFloat");
export const CeilDouble = Symbol("CeilDouble");
export const CeilFloat = Symbol("CeilFloat");
export const FloorDouble = Symbol("FloorDouble");
export const FloorFloat = Symbol("FloorFloat");
export const SqrtDouble = Symbol("SqrtDouble");
export const SqrtFloat = Symbol("SqrtFloat");
export const ConvertInt32ToDouble = Symbol("ConvertInt32ToDouble");
export const ConvertInt64ToDouble = Symbol("ConvertInt64ToDouble");
export const ConvertInt32ToFloat = Symbol("ConvertInt32ToFloat");
export const ConvertInt64ToFloat = Symbol("ConvertInt64ToFloat");
export const CountLeadingZeros32 = Symbol("CountLeadingZeros32");
export const CountLeadingZeros64 = Symbol("CountLeadingZeros64");
export const ConvertDoubleToFloat = Symbol("ConvertDoubleToFloat");
export const ConvertFloatToDouble = Symbol("ConvertFloatToDouble");
export const Move = Symbol("Move");
export const Swap32 = Symbol("Swap32");
export const Swap64 = Symbol("Swap64");
export const Move32 = Symbol("Move32");
export const StoreZero32 = Symbol("StoreZero32");
export const SignExtend32ToPtr = Symbol("SignExtend32ToPtr");
export const ZeroExtend8To32 = Symbol("ZeroExtend8To32");
export const SignExtend8To32 = Symbol("SignExtend8To32");
export const ZeroExtend16To32 = Symbol("ZeroExtend16To32");
export const SignExtend16To32 = Symbol("SignExtend16To32");
export const MoveFloat = Symbol("MoveFloat");
export const MoveDouble = Symbol("MoveDouble");
export const MoveZeroToDouble = Symbol("MoveZeroToDouble");
export const Move64ToDouble = Symbol("Move64ToDouble");
export const Move32ToFloat = Symbol("Move32ToFloat");
export const MoveDoubleTo64 = Symbol("MoveDoubleTo64");
export const MoveFloatTo32 = Symbol("MoveFloatTo32");
export const Load8 = Symbol("Load8");
export const Store8 = Symbol("Store8");
export const Load8SignedExtendTo32 = Symbol("Load8SignedExtendTo32");
export const Load16 = Symbol("Load16");
export const Load16SignedExtendTo32 = Symbol("Load16SignedExtendTo32");
export const Store16 = Symbol("Store16");
export const Compare32 = Symbol("Compare32");
export const Compare64 = Symbol("Compare64");
export const Test32 = Symbol("Test32");
export const Test64 = Symbol("Test64");
export const CompareDouble = Symbol("CompareDouble");
export const CompareFloat = Symbol("CompareFloat");
export const Branch8 = Symbol("Branch8");
export const Branch32 = Symbol("Branch32");
export const Branch64 = Symbol("Branch64");
export const BranchTest8 = Symbol("BranchTest8");
export const BranchTest32 = Symbol("BranchTest32");
export const BranchTest64 = Symbol("BranchTest64");
export const BranchDouble = Symbol("BranchDouble");
export const BranchFloat = Symbol("BranchFloat");
export const BranchAdd32 = Symbol("BranchAdd32");
export const BranchAdd64 = Symbol("BranchAdd64");
export const BranchMul32 = Symbol("BranchMul32");
export const BranchMul64 = Symbol("BranchMul64");
export const BranchSub32 = Symbol("BranchSub32");
export const BranchSub64 = Symbol("BranchSub64");
export const BranchNeg32 = Symbol("BranchNeg32");
export const BranchNeg64 = Symbol("BranchNeg64");
export const MoveConditionally32 = Symbol("MoveConditionally32");
export const MoveConditionally64 = Symbol("MoveConditionally64");
export const MoveConditionallyTest32 = Symbol("MoveConditionallyTest32");
export const MoveConditionallyTest64 = Symbol("MoveConditionallyTest64");
export const MoveConditionallyDouble = Symbol("MoveConditionallyDouble");
export const MoveConditionallyFloat = Symbol("MoveConditionallyFloat");
export const MoveDoubleConditionally32 = Symbol("MoveDoubleConditionally32");
export const MoveDoubleConditionally64 = Symbol("MoveDoubleConditionally64");
export const MoveDoubleConditionallyTest32 = Symbol("MoveDoubleConditionallyTest32");
export const MoveDoubleConditionallyTest64 = Symbol("MoveDoubleConditionallyTest64");
export const MoveDoubleConditionallyDouble = Symbol("MoveDoubleConditionallyDouble");
export const MoveDoubleConditionallyFloat = Symbol("MoveDoubleConditionallyFloat");
export const Jump = Symbol("Jump");
export const Ret32 = Symbol("Ret32");
export const Ret64 = Symbol("Ret64");
export const RetFloat = Symbol("RetFloat");
export const RetDouble = Symbol("RetDouble");
export const Oops = Symbol("Oops");
export const Shuffle = Symbol("Shuffle");
export const Patch = Symbol("Patch");
export const CCall = Symbol("CCall");
export const ColdCCall = Symbol("ColdCCall");
export function Inst_forEachArg(inst: Inst, func: Callback<Arg>): void
{
    let replacement;
    switch (inst.opcode) {
    case Nop:
        break;
        break;
    case Add32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Add8:
        inst.visitArg(0, func, Arg.Use, GP, 8);
        inst.visitArg(1, func, Arg.UseDef, GP, 8);
        break;
        break;
    case Add16:
        inst.visitArg(0, func, Arg.Use, GP, 16);
        inst.visitArg(1, func, Arg.UseDef, GP, 16);
        break;
        break;
    case Add64:
        switch (inst.args.length) {
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Def, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case AddDouble:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Def, FP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.UseDef, FP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case AddFloat:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.UseDef, FP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Sub32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.UseZDef, GP, 32);
        break;
        break;
    case Sub64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.UseDef, GP, 64);
        break;
        break;
    case SubDouble:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Def, FP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.UseDef, FP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case SubFloat:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.UseDef, FP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Neg32:
        inst.visitArg(0, func, Arg.UseZDef, GP, 32);
        break;
        break;
    case Neg64:
        inst.visitArg(0, func, Arg.UseDef, GP, 64);
        break;
        break;
    case NegateDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case Mul32:
        switch (inst.args.length) {
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Mul64:
        switch (inst.args.length) {
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Def, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MultiplyAdd32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case MultiplyAdd64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        inst.visitArg(3, func, Arg.Def, GP, 64);
        break;
        break;
    case MultiplySub32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case MultiplySub64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        inst.visitArg(3, func, Arg.Def, GP, 64);
        break;
        break;
    case MultiplyNeg32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.ZDef, GP, 32);
        break;
        break;
    case MultiplyNeg64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.ZDef, GP, 64);
        break;
        break;
    case Div32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Div64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Def, GP, 64);
        break;
        break;
    case MulDouble:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Def, FP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.UseDef, FP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MulFloat:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.UseDef, FP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case DivDouble:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.UseDef, FP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case DivFloat:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.UseDef, FP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case X86ConvertToDoubleWord32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case X86ConvertToQuadWord64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Def, GP, 64);
        break;
        break;
    case X86Div32:
        inst.visitArg(0, func, Arg.UseZDef, GP, 32);
        inst.visitArg(1, func, Arg.UseZDef, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        break;
        break;
    case X86Div64:
        inst.visitArg(0, func, Arg.UseZDef, GP, 64);
        inst.visitArg(1, func, Arg.UseZDef, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        break;
        break;
    case Lea:
        inst.visitArg(0, func, Arg.UseAddr, GP, Ptr);
        inst.visitArg(1, func, Arg.Def, GP, Ptr);
        break;
        break;
    case And32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case And64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Def, GP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case AndDouble:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Def, FP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.UseDef, FP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case AndFloat:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.UseDef, FP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case XorDouble:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Def, FP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 64);
            inst.visitArg(1, func, Arg.UseDef, FP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case XorFloat:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Def, FP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, FP, 32);
            inst.visitArg(1, func, Arg.UseDef, FP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Lshift32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Lshift64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.ZDef, GP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Rshift32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Rshift64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.ZDef, GP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Urshift32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Urshift64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.ZDef, GP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Or32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Or64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Def, GP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Xor32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.ZDef, GP, 32);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Xor64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Def, GP, 64);
            break;
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Not32:
        switch (inst.args.length) {
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.ZDef, GP, 32);
            break;
        case 1:
            inst.visitArg(0, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case Not64:
        switch (inst.args.length) {
        case 2:
            inst.visitArg(0, func, Arg.Use, GP, 64);
            inst.visitArg(1, func, Arg.Def, GP, 64);
            break;
        case 1:
            inst.visitArg(0, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case AbsDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case AbsFloat:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case CeilDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case CeilFloat:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case FloorDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case FloorFloat:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case SqrtDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case SqrtFloat:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case ConvertInt32ToDouble:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case ConvertInt64ToDouble:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case ConvertInt32ToFloat:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case ConvertInt64ToFloat:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case CountLeadingZeros32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case CountLeadingZeros64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Def, GP, 64);
        break;
        break;
    case ConvertDoubleToFloat:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case ConvertFloatToDouble:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case Move:
        inst.visitArg(0, func, Arg.Use, GP, Ptr);
        inst.visitArg(1, func, Arg.Def, GP, Ptr);
        break;
        break;
    case Swap32:
        inst.visitArg(0, func, Arg.UseDef, GP, 32);
        inst.visitArg(1, func, Arg.UseDef, GP, 32);
        break;
        break;
    case Swap64:
        inst.visitArg(0, func, Arg.UseDef, GP, 64);
        inst.visitArg(1, func, Arg.UseDef, GP, 64);
        break;
        break;
    case Move32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case StoreZero32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        break;
        break;
    case SignExtend32ToPtr:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Def, GP, Ptr);
        break;
        break;
    case ZeroExtend8To32:
        inst.visitArg(0, func, Arg.Use, GP, 8);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case SignExtend8To32:
        inst.visitArg(0, func, Arg.Use, GP, 8);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case ZeroExtend16To32:
        inst.visitArg(0, func, Arg.Use, GP, 16);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case SignExtend16To32:
        inst.visitArg(0, func, Arg.Use, GP, 16);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case MoveFloat:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case MoveDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case MoveZeroToDouble:
        inst.visitArg(0, func, Arg.Def, FP, 64);
        break;
        break;
    case Move64ToDouble:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        inst.visitArg(1, func, Arg.Def, FP, 64);
        break;
        break;
    case Move32ToFloat:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Def, FP, 32);
        break;
        break;
    case MoveDoubleTo64:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        inst.visitArg(1, func, Arg.Def, GP, 64);
        break;
        break;
    case MoveFloatTo32:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        inst.visitArg(1, func, Arg.Def, GP, 32);
        break;
        break;
    case Load8:
        inst.visitArg(0, func, Arg.Use, GP, 8);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Store8:
        inst.visitArg(0, func, Arg.Use, GP, 8);
        inst.visitArg(1, func, Arg.Def, GP, 8);
        break;
        break;
    case Load8SignedExtendTo32:
        inst.visitArg(0, func, Arg.Use, GP, 8);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Load16:
        inst.visitArg(0, func, Arg.Use, GP, 16);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Load16SignedExtendTo32:
        inst.visitArg(0, func, Arg.Use, GP, 16);
        inst.visitArg(1, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Store16:
        inst.visitArg(0, func, Arg.Use, GP, 16);
        inst.visitArg(1, func, Arg.Def, GP, 16);
        break;
        break;
    case Compare32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Compare64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Test32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Test64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case CompareDouble:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, FP, 64);
        inst.visitArg(2, func, Arg.Use, FP, 64);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case CompareFloat:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, FP, 32);
        inst.visitArg(2, func, Arg.Use, FP, 32);
        inst.visitArg(3, func, Arg.ZDef, GP, 32);
        break;
        break;
    case Branch8:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 8);
        inst.visitArg(2, func, Arg.Use, GP, 8);
        break;
        break;
    case Branch32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        break;
        break;
    case Branch64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        break;
        break;
    case BranchTest8:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 8);
        inst.visitArg(2, func, Arg.Use, GP, 8);
        break;
        break;
    case BranchTest32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        break;
        break;
    case BranchTest64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        break;
        break;
    case BranchDouble:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, FP, 64);
        inst.visitArg(2, func, Arg.Use, FP, 64);
        break;
        break;
    case BranchFloat:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, FP, 32);
        inst.visitArg(2, func, Arg.Use, FP, 32);
        break;
        break;
    case BranchAdd32:
        switch (inst.args.length) {
        case 4:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.ZDef, GP, 32);
            break;
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.UseZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case BranchAdd64:
        switch (inst.args.length) {
        case 4:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Use, GP, 64);
            inst.visitArg(3, func, Arg.ZDef, GP, 64);
            break;
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.UseDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case BranchMul32:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.UseZDef, GP, 32);
            break;
        case 4:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.ZDef, GP, 32);
            break;
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.Scratch, GP, 32);
            inst.visitArg(4, func, Arg.Scratch, GP, 32);
            inst.visitArg(5, func, Arg.ZDef, GP, 32);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case BranchMul64:
        switch (inst.args.length) {
        case 3:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.UseZDef, GP, 64);
            break;
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Use, GP, 64);
            inst.visitArg(3, func, Arg.Scratch, GP, 64);
            inst.visitArg(4, func, Arg.Scratch, GP, 64);
            inst.visitArg(5, func, Arg.ZDef, GP, 64);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case BranchSub32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.UseZDef, GP, 32);
        break;
        break;
    case BranchSub64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.UseDef, GP, 64);
        break;
        break;
    case BranchNeg32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.UseZDef, GP, 32);
        break;
        break;
    case BranchNeg64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.UseZDef, GP, 64);
        break;
        break;
    case MoveConditionally32:
        switch (inst.args.length) {
        case 5:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.UseDef, GP, Ptr);
            break;
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.Use, GP, Ptr);
            inst.visitArg(5, func, Arg.Def, GP, Ptr);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MoveConditionally64:
        switch (inst.args.length) {
        case 5:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Use, GP, 64);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.UseDef, GP, Ptr);
            break;
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Use, GP, 64);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.Use, GP, Ptr);
            inst.visitArg(5, func, Arg.Def, GP, Ptr);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MoveConditionallyTest32:
        switch (inst.args.length) {
        case 5:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.UseDef, GP, Ptr);
            break;
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.Use, GP, Ptr);
            inst.visitArg(5, func, Arg.Def, GP, Ptr);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MoveConditionallyTest64:
        switch (inst.args.length) {
        case 5:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 64);
            inst.visitArg(2, func, Arg.Use, GP, 64);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.UseDef, GP, Ptr);
            break;
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, GP, 32);
            inst.visitArg(2, func, Arg.Use, GP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.Use, GP, Ptr);
            inst.visitArg(5, func, Arg.Def, GP, Ptr);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MoveConditionallyDouble:
        switch (inst.args.length) {
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Use, FP, 64);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.Use, GP, Ptr);
            inst.visitArg(5, func, Arg.Def, GP, Ptr);
            break;
        case 5:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 64);
            inst.visitArg(2, func, Arg.Use, FP, 64);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.UseDef, GP, Ptr);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MoveConditionallyFloat:
        switch (inst.args.length) {
        case 6:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Use, FP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.Use, GP, Ptr);
            inst.visitArg(5, func, Arg.Def, GP, Ptr);
            break;
        case 5:
            inst.visitArg(0, func, Arg.Use, GP, 32);
            inst.visitArg(1, func, Arg.Use, FP, 32);
            inst.visitArg(2, func, Arg.Use, FP, 32);
            inst.visitArg(3, func, Arg.Use, GP, Ptr);
            inst.visitArg(4, func, Arg.UseDef, GP, Ptr);
            break;
        default:
            throw new Error("Bad overload");
            break;
        }
        break;
    case MoveDoubleConditionally32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        inst.visitArg(3, func, Arg.Use, FP, 64);
        inst.visitArg(4, func, Arg.Use, FP, 64);
        inst.visitArg(5, func, Arg.Def, FP, 64);
        break;
        break;
    case MoveDoubleConditionally64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        inst.visitArg(3, func, Arg.Use, FP, 64);
        inst.visitArg(4, func, Arg.Use, FP, 64);
        inst.visitArg(5, func, Arg.Def, FP, 64);
        break;
        break;
    case MoveDoubleConditionallyTest32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 32);
        inst.visitArg(2, func, Arg.Use, GP, 32);
        inst.visitArg(3, func, Arg.Use, FP, 64);
        inst.visitArg(4, func, Arg.Use, FP, 64);
        inst.visitArg(5, func, Arg.Def, FP, 64);
        break;
        break;
    case MoveDoubleConditionallyTest64:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, GP, 64);
        inst.visitArg(2, func, Arg.Use, GP, 64);
        inst.visitArg(3, func, Arg.Use, FP, 64);
        inst.visitArg(4, func, Arg.Use, FP, 64);
        inst.visitArg(5, func, Arg.Def, FP, 64);
        break;
        break;
    case MoveDoubleConditionallyDouble:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, FP, 64);
        inst.visitArg(2, func, Arg.Use, FP, 64);
        inst.visitArg(3, func, Arg.Use, FP, 64);
        inst.visitArg(4, func, Arg.Use, FP, 64);
        inst.visitArg(5, func, Arg.Def, FP, 64);
        break;
        break;
    case MoveDoubleConditionallyFloat:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        inst.visitArg(1, func, Arg.Use, FP, 32);
        inst.visitArg(2, func, Arg.Use, FP, 32);
        inst.visitArg(3, func, Arg.Use, FP, 64);
        inst.visitArg(4, func, Arg.Use, FP, 64);
        inst.visitArg(5, func, Arg.Def, FP, 64);
        break;
        break;
    case Jump:
        break;
        break;
    case Ret32:
        inst.visitArg(0, func, Arg.Use, GP, 32);
        break;
        break;
    case Ret64:
        inst.visitArg(0, func, Arg.Use, GP, 64);
        break;
        break;
    case RetFloat:
        inst.visitArg(0, func, Arg.Use, FP, 32);
        break;
        break;
    case RetDouble:
        inst.visitArg(0, func, Arg.Use, FP, 64);
        break;
        break;
    case Oops:
        break;
        break;
    case Shuffle:
        ShuffleCustom.forEachArg(inst, func);
        break;
    case Patch:
        PatchCustom.forEachArg(inst, func);
        break;
    case CCall:
        CCallCustom.forEachArg(inst, func);
        break;
    case ColdCCall:
        ColdCCallCustom.forEachArg(inst, func);
        break;
    default:
        throw "Bad opcode";
    }
}
export function Inst_hasNonArgEffects(inst: Inst): boolean | undefined
{
    switch (inst.opcode) {
    case Branch8:
    case Branch32:
    case Branch64:
    case BranchTest8:
    case BranchTest32:
    case BranchTest64:
    case BranchDouble:
    case BranchFloat:
    case BranchAdd32:
    case BranchAdd64:
    case BranchMul32:
    case BranchMul64:
    case BranchSub32:
    case BranchSub64:
    case BranchNeg32:
    case BranchNeg64:
    case Jump:
    case Ret32:
    case Ret64:
    case RetFloat:
    case RetDouble:
    case Oops:
        return true;
    case Shuffle:
        return ShuffleCustom.hasNonArgNonControlEffects(inst);
    case Patch:
        return PatchCustom.hasNonArgNonControlEffects(inst);
    case CCall:
        return CCallCustom.hasNonArgNonControlEffects(inst);
    case ColdCCall:
        return ColdCCallCustom.hasNonArgNonControlEffects(inst);
    default:
        return false;
    }
}
export function opcodeCode(opcode: symbol): number
{
    switch (opcode) {
    case AbsDouble:
        return 0
    case AbsFloat:
        return 1
    case Add16:
        return 2
    case Add32:
        return 3
    case Add64:
        return 4
    case Add8:
        return 5
    case AddDouble:
        return 6
    case AddFloat:
        return 7
    case And32:
        return 8
    case And64:
        return 9
    case AndDouble:
        return 10
    case AndFloat:
        return 11
    case Branch32:
        return 12
    case Branch64:
        return 13
    case Branch8:
        return 14
    case BranchAdd32:
        return 15
    case BranchAdd64:
        return 16
    case BranchDouble:
        return 17
    case BranchFloat:
        return 18
    case BranchMul32:
        return 19
    case BranchMul64:
        return 20
    case BranchNeg32:
        return 21
    case BranchNeg64:
        return 22
    case BranchSub32:
        return 23
    case BranchSub64:
        return 24
    case BranchTest32:
        return 25
    case BranchTest64:
        return 26
    case BranchTest8:
        return 27
    case CCall:
        return 28
    case CeilDouble:
        return 29
    case CeilFloat:
        return 30
    case ColdCCall:
        return 31
    case Compare32:
        return 32
    case Compare64:
        return 33
    case CompareDouble:
        return 34
    case CompareFloat:
        return 35
    case ConvertDoubleToFloat:
        return 36
    case ConvertFloatToDouble:
        return 37
    case ConvertInt32ToDouble:
        return 38
    case ConvertInt32ToFloat:
        return 39
    case ConvertInt64ToDouble:
        return 40
    case ConvertInt64ToFloat:
        return 41
    case CountLeadingZeros32:
        return 42
    case CountLeadingZeros64:
        return 43
    case Div32:
        return 44
    case Div64:
        return 45
    case DivDouble:
        return 46
    case DivFloat:
        return 47
    case FloorDouble:
        return 48
    case FloorFloat:
        return 49
    case Jump:
        return 50
    case Lea:
        return 51
    case Load16:
        return 52
    case Load16SignedExtendTo32:
        return 53
    case Load8:
        return 54
    case Load8SignedExtendTo32:
        return 55
    case Lshift32:
        return 56
    case Lshift64:
        return 57
    case Move:
        return 58
    case Move32:
        return 59
    case Move32ToFloat:
        return 60
    case Move64ToDouble:
        return 61
    case MoveConditionally32:
        return 62
    case MoveConditionally64:
        return 63
    case MoveConditionallyDouble:
        return 64
    case MoveConditionallyFloat:
        return 65
    case MoveConditionallyTest32:
        return 66
    case MoveConditionallyTest64:
        return 67
    case MoveDouble:
        return 68
    case MoveDoubleConditionally32:
        return 69
    case MoveDoubleConditionally64:
        return 70
    case MoveDoubleConditionallyDouble:
        return 71
    case MoveDoubleConditionallyFloat:
        return 72
    case MoveDoubleConditionallyTest32:
        return 73
    case MoveDoubleConditionallyTest64:
        return 74
    case MoveDoubleTo64:
        return 75
    case MoveFloat:
        return 76
    case MoveFloatTo32:
        return 77
    case MoveZeroToDouble:
        return 78
    case Mul32:
        return 79
    case Mul64:
        return 80
    case MulDouble:
        return 81
    case MulFloat:
        return 82
    case MultiplyAdd32:
        return 83
    case MultiplyAdd64:
        return 84
    case MultiplyNeg32:
        return 85
    case MultiplyNeg64:
        return 86
    case MultiplySub32:
        return 87
    case MultiplySub64:
        return 88
    case Neg32:
        return 89
    case Neg64:
        return 90
    case NegateDouble:
        return 91
    case Nop:
        return 92
    case Not32:
        return 93
    case Not64:
        return 94
    case Oops:
        return 95
    case Or32:
        return 96
    case Or64:
        return 97
    case Patch:
        return 98
    case Ret32:
        return 99
    case Ret64:
        return 100
    case RetDouble:
        return 101
    case RetFloat:
        return 102
    case Rshift32:
        return 103
    case Rshift64:
        return 104
    case Shuffle:
        return 105
    case SignExtend16To32:
        return 106
    case SignExtend32ToPtr:
        return 107
    case SignExtend8To32:
        return 108
    case SqrtDouble:
        return 109
    case SqrtFloat:
        return 110
    case Store16:
        return 111
    case Store8:
        return 112
    case StoreZero32:
        return 113
    case Sub32:
        return 114
    case Sub64:
        return 115
    case SubDouble:
        return 116
    case SubFloat:
        return 117
    case Swap32:
        return 118
    case Swap64:
        return 119
    case Test32:
        return 120
    case Test64:
        return 121
    case Urshift32:
        return 122
    case Urshift64:
        return 123
    case X86ConvertToDoubleWord32:
        return 124
    case X86ConvertToQuadWord64:
        return 125
    case X86Div32:
        return 126
    case X86Div64:
        return 127
    case Xor32:
        return 128
    case Xor64:
        return 129
    case XorDouble:
        return 130
    case XorFloat:
        return 131
    case ZeroExtend16To32:
        return 132
    case ZeroExtend8To32:
        return 133
    default:
        throw new Error("bad opcode");
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/reg.js
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

export class Reg extends TmpBase {
    static [name: `r${number}`]: Reg;
    static [name: `xmm${number}`]: Reg;
    declare _index: number;
    declare _type: symbol;
    declare _name: string;
    declare _isCalleeSave: boolean;
    declare static regs: Reg[];
    declare static gprs: Reg[];
    declare static fprs: Reg[];
    declare static calleeSaveGPRs: Reg[];
    declare static calleeSaveFPRs: Reg[];
    declare static calleeSaves: Reg[];
    // Typo in the original, only read if an X86 FPR is callee-save (none is).
    declare static calleeSaveFPRS: Reg[] | undefined;
    declare static callFrameRegister: Reg;
    declare static stackPointerRegister: Reg;
    declare static rax: Reg;
    declare static rcx: Reg;
    declare static rdx: Reg;
    declare static rbx: Reg;
    declare static rsp: Reg;
    declare static rbp: Reg;
    declare static rsi: Reg;
    declare static rdi: Reg;
    declare static r8: Reg;
    declare static r9: Reg;
    declare static r10: Reg;
    declare static r11: Reg;
    declare static r12: Reg;
    declare static r13: Reg;
    declare static r14: Reg;
    declare static r15: Reg;
    declare static xmm0: Reg;
    declare static xmm1: Reg;
    declare static xmm2: Reg;
    declare static xmm3: Reg;
    declare static xmm4: Reg;
    declare static xmm5: Reg;
    declare static xmm6: Reg;
    declare static xmm7: Reg;
    declare static xmm8: Reg;
    declare static xmm9: Reg;
    declare static xmm10: Reg;
    declare static xmm11: Reg;
    declare static xmm12: Reg;
    declare static xmm13: Reg;
    declare static xmm14: Reg;
    declare static xmm15: Reg;

    constructor(index: number, type: symbol, name: string, isCalleeSave?: boolean)
    {
        super();
        this._index = index;
        this._type = type;
        this._name = name;
        this._isCalleeSave = !!isCalleeSave;
    }
    
    static fromReg(reg: Reg): Reg
    {
        return reg;
    }
    
    get index() { return this._index; }
    get type() { return this._type; }
    get name() { return this._name; }
    get isCalleeSave() { return this._isCalleeSave; }
    
    get isReg() { return true; }
    
    hash()
    {
        if (this.isGP)
            return 1 + this._index;
        return -1 - this._index;
    }
    
    toString()
    {
        return `%${this._name}`;
    }
    
    static extract(arg: Arg): TmpBase | null
    {
        if (arg.isReg)
            return arg.reg;
        return null;
    }
    
    static forEachFast(arg: Arg, func: FastCallback<TmpBase>): Arg | void
    {
        return arg.forEachTmpFast(tmp => {
            if (!tmp.isReg)
                return;
            return func(tmp);
        });
    }
    
    static forEach(arg: Arg, argRole: symbol, argType: symbol, argWidth: number, func: Callback<TmpBase>): Arg | void
    {
        return arg.forEachTmp(
            argRole, argType, argWidth,
            (tmp, role, type, width) => {
                if (!tmp.isReg)
                    return;
                return func(tmp, role, type, width);
            });
    }
}

{
    Reg.regs = [];
    function newReg(...args: [number, symbol, string, boolean?]): Reg
    {
        let result = new Reg(...args);
        Reg.regs.push(result);
        return result;
    }

    // Define X86_64 GPRs
    {
        let index = 0;
        function newGPR(name: string, isCalleeSave?: boolean): Reg { return newReg(index++, GP, name, isCalleeSave); }
        
        Reg.rax = newGPR("rax");
        Reg.rcx = newGPR("rcx");
        Reg.rdx = newGPR("rdx");
        Reg.rbx = newGPR("rbx", true);
        Reg.rsp = newGPR("rsp");
        Reg.rbp = newGPR("rbp", true);
        Reg.rsi = newGPR("rsi");
        Reg.rdi = newGPR("rdi");
        for (let i = 8; i <= 15; ++i)
            Reg[`r${i}`] = newGPR(`r${i}`, i >= 12);
    }

    // Define X86_64 FPRs.
    for (let i = 0; i <= 15; ++i)
        Reg[`xmm${i}`] = newReg(i, FP, `xmm${i}`);

    Reg.gprs = []
    Reg.fprs = []
    Reg.calleeSaveGPRs = []
    Reg.calleeSaveFPRs = []
    Reg.calleeSaves = []
    for (let reg of Reg.regs) {
        if (reg.isGP) {
            Reg.gprs.push(reg);
            if (reg.isCalleeSave)
                Reg.calleeSaveGPRs.push(reg);
        } else {
            Reg.fprs.push(reg);
            if (reg.isCalleeSave)
                Reg.calleeSaveFPRS!.push(reg);
        }
        if (reg.isCalleeSave)
            Reg.calleeSaves.push(reg);
    }
    
    Reg.callFrameRegister = Reg.rbp;
    Reg.stackPointerRegister = Reg.rsp;
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/stack_slot.js
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

export class StackSlot {
    declare _index: number;
    declare _byteSize: number;
    declare _kind: symbol;
    declare _offsetFromFP?: number;
    // Original static callbacks read this absent property, passing undefined.
    declare static _offset: undefined;
    constructor(index: number, byteSize: number, kind: symbol)
    {
        this._index = index;
        this._byteSize = byteSize;
        this._kind = kind;
    }
    
    get byteSize() { return this._byteSize; }
    get kind() { return this._kind; }
    
    get isLocked() { return this._kind == Locked; }
    get isSpill() { return this._kind == Spill; }
    
    get index() { return this._index; }

    ensureSize(size: number): void
    {
        if (this._offsetFromFP)
            throw new Error("Stack slot already allocated");
        this._byteSize = Math.max(this._byteSize, size);
    }
    
    get alignment()
    {
        if (this._byteSize <= 1)
            return 1;
        if (this._byteSize <= 2)
            return 2;
        if (this._byteSize <= 4)
            return 4;
        return 8;
    }
    
    get offsetFromFP() { return this._offsetFromFP; }
    
    setOffsetFromFP(value: number): void { this._offsetFromFP = value; }
    
    hash()
    {
        return ((this._kind == Spill ? 1 : 0) + this._byteSize * 3 + (this._offsetFromFP ? this._offsetFromFP * 7 : 0)) >>> 0;
    }
    
    toString()
    {
        return "" + (this.isSpill ? "spill" : "stack") + this._index + "<" + this._byteSize +
            (this._offsetFromFP ? ", offset = " + this._offsetFromFP : "") + ">";
    }
    
    static extract(arg: Arg): StackSlot | null
    {
        if (arg.isStack)
            return arg.stackSlot;
        return null;
    }
    
    static forEachFast(arg: Arg, func: FastCallback<StackSlot>): Arg | void
    {
        if (!arg.isStack)
            return;
        
        let replacement;
        if (replacement = func(arg.stackSlot))
            return Arg.createStack(replacement, this._offset);
    }
    
    static forEach(arg: Arg, role: symbol, type: symbol, width: number, func: Callback<StackSlot>): Arg | void
    {
        if (!arg.isStack)
            return;
        
        let replacement;
        if (replacement = func(arg.stackSlot, role, type, width))
            return Arg.createStack(replacement, this._offset);
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/tmp.js
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

export class Tmp extends TmpBase {
    declare _index: number;
    declare _type: symbol;
    constructor(index: number, type: symbol)
    {
        super();
        this._index = index;
        this._type = type;
    }
    
    static fromReg(reg: Reg): Reg
    {
        return reg;
    }
    
    get index() { return this._index; }
    get type() { return this._type; }
    
    get isReg() { return false; }
    
    hash(): number
    {
        // Upstream uses unbound isGP, so hashing an unallocated Tmp throws.
        // Recorded benchmark operands use allocated Reg objects instead.
        throw new ReferenceError("isGP is not defined");
    }

    toString()
    {
        return "%" + (this.isGP ? "" : "f") + "tmp" + this._index;
    }
    
    static extract(arg: Arg): TmpBase | null
    {
        if (arg.isTmp)
            return arg.tmp;
        return null;
    }

    static forEachFast(arg: Arg, func: FastCallback<TmpBase>): Arg | void { return arg.forEachTmpFast(func); }
    static forEach(arg: Arg, role: symbol, type: symbol, width: number, func: Callback<TmpBase>): Arg | void { return arg.forEachTmp(role, type, width, func); }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/util.js
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

export function isRepresentableAsInt32(value: number): boolean
{
    return (value | 0) === value;
}

export function addIndexed<T, A extends unknown[]>(list: T[], cons: new (index: number, ...args: A) => T, ...args: A): T
{
    let result = new cons(list.length, ...args);
    list.push(result);
    return result;
}

export const stackAlignmentBytes = 16;

export function roundUpToMultipleOf(amount: number, value: number): number
{
    return Math.ceil(value / amount) * amount;
}

export function symbolName(symbol: symbol): string
{
    let fullString = symbol.toString();
    return fullString.substring("Symbol(".length, fullString.length - ")".length);
}

export function lowerSymbolName(symbol: symbol): string
{
    return symbolName(symbol).toLowerCase();
}

export function setToString<T>(set: Iterable<T>): string
{
    let result = "";
    for (let value of set) {
        if (result)
            result += ", ";
        result += value;
    }
    return result;
}

export function mergeIntoSet<T>(target: Set<T>, source: Iterable<T>): boolean
{
    let didAdd = false;
    for (let value of source) {
        if (target.has(value))
            continue;
        target.add(value);
        didAdd = true;
    }
    return didAdd;
}

export function nonEmptyRangesOverlap(leftMin: number, leftMax: number, rightMin: number, rightMax: number): boolean
{
    if (leftMin >= leftMax)
        throw new Error("Bad left range");
    if (rightMin >= rightMax)
        throw new Error("Bad right range");
    
    if (leftMin <= rightMin && leftMax > rightMin)
        return true;
    if (rightMin <= leftMin && rightMax > leftMin)
        return true;
    return false;
}

export function rangesOverlap(leftMin: number, leftMax: number, rightMin: number, rightMax: number): boolean
{
    if (leftMin > leftMax)
        throw new Error("Bad left range");
    if (rightMin > rightMax)
        throw new Error("Bad right range");
    
    if (leftMin == leftMax)
        return false;
    if (rightMin == rightMax)
        return false;
    
    return nonEmptyRangesOverlap(leftMin, leftMax, rightMin, rightMax);
}

export function removeAllMatching<T>(array: T[], func: (value: T) => boolean): void
{
    let srcIndex = 0;
    let dstIndex = 0;
    while (srcIndex < array.length) {
        let value = array[srcIndex++];
        if (!func(value))
            array[dstIndex++] = value;
    }
    array.length = dstIndex;
}

export function bubbleSort<T>(array: T[], lessThan: (left: T, right: T) => boolean): void
{
    function swap(i: number, j: number): void
    {
        var tmp = array[i];
        array[i] = array[j];
        array[j] = tmp;
    }
    
    let begin = 0;
    let end = array.length;
    for (;;) {
        let changed = false;
        
        function bubble(i: number, j: number): void
        {
            if (lessThan(array[i], array[j])) {
                swap(i, j);
                changed = true;
            }
        }
    
        if (end < begin)
            throw new Error("Begin and end are messed up");
        
        let limit = end - begin;
        for (let i = limit; i-- > 1;)
            bubble(begin + i, begin + i - 1);
        if (!changed)
            return;
        
        // After one run, the first element in the list is guaranteed to be the smallest.
        begin++;
        
        // Now go in the other direction. This eliminates most sorting pathologies.
        changed = false;
        
        if (end < begin)
            throw new Error("Begin and end are messed up");
        
        limit = end - begin;
        for (let i = 1; i < limit; ++i)
            bubble(begin + i, begin + i - 1);
        if (!changed)
            return;
        
        // Now the last element is guaranteed to be the largest.
        end--;
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/custom.js
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

export const ShuffleCustom = {
    forEachArg(inst: Inst, func: Callback<Arg>): void
    {
        var limit = Math.floor(inst.args.length / 3) * 3;
        for (let i = 0; i < limit; i += 3) {
            let src = inst.args[i + 0];
            let dst = inst.args[i + 1];
            let widthArg = inst.args[i + 2];
            let width = widthArg.width;
            let type = src.isGP && dst.isGP ? GP : FP;
            inst.visitArg(i + 0, func, Arg.Use, type, width);
            inst.visitArg(i + 1, func, Arg.Def, type, width);
            inst.visitArg(i + 2, func, Arg.Use, GP, 8);
        }
    },
    
    hasNonArgNonControlEffects(inst: Inst): boolean | undefined
    {
        return false;
    }
};

export const PatchCustom = {
    forEachArg(inst: Inst, func: Callback<Arg>): void
    {
        for (let i = 0; i < inst.args.length; ++i) {
            let {type, role, width} = inst.patchArgData![i];
            inst.visitArg(i, func, role, type, width);
        }
    },
    
    hasNonArgNonControlEffects(inst: Inst): boolean | undefined
    {
        return inst.patchHasNonArgEffects;
    }
};

export const CCallCustom = {
    forEachArg(inst: Inst, func: Callback<Arg>): void
    {
        let index = 0;
        inst.visitArg(index++, func, Arg.Use, GP, Ptr); // callee
        
        if (inst.cCallType! != Void) {
            inst.visitArg(
                index++, func, Arg.Def, Arg.typeForB3Type(inst.cCallType!),
                Arg.widthForB3Type(inst.cCallType!));
        }
        
        for (let type of inst.cCallArgTypes!) {
            inst.visitArg(
                index++, func, Arg.Use, Arg.typeForB3Type(type), Arg.widthForB3Type(type));
        }
    },
    
    hasNonArgNonControlEffects(inst: Inst): boolean | undefined
    {
        return true;
    }
};

export const ColdCCallCustom = {
    forEachArg(inst: Inst, func: Callback<Arg>): void
    {
        CCallCustom.forEachArg(
            inst,
            (arg, role, type, width) => {
                return func(arg, Arg.cooled(role), type, width);
            });
    },
    
    hasNonArgNonControlEffects(inst: Inst): boolean | undefined
    {
        return true;
    }
};

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/liveness.js
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

export class Liveness<T> {
    declare _thing: Thing<T>;
    declare _code: Code;
    declare _liveAtHead: Map<BasicBlock, Set<T>>;
    declare _liveAtTail: Map<BasicBlock, Set<T>>;
    constructor(thing: Thing<T>, code: Code)
    {
        this._thing = thing;
        this._code = code;
        
        this._liveAtHead = new Map<BasicBlock, Set<T>>();
        this._liveAtTail = new Map<BasicBlock, Set<T>>();
        
        for (let block of code) {
            this._liveAtHead.set(block, new Set<T>());
            
            let liveAtTail = new Set<T>();
            this._liveAtTail.set(block, liveAtTail);
            
            block.last.forEach(
                thing,
                (value, role, type, width) => {
                    if (Arg.isLateUse(role))
                        liveAtTail.add(value);
                });
        }
        
        let dirtyBlocks = new Set(code);
        
        let changed;
        do {
            changed = false;
            
            for (let blockIndex = code.size; blockIndex--;) {
                let block = code.at(blockIndex);
                if (!block)
                    continue;
                
                if (!dirtyBlocks.delete(block))
                    continue;
                
                let localCalc = this.localCalc(block);
                for (let instIndex = block.size; instIndex--;)
                    localCalc.execute(instIndex);
                
                // Handle the early def's of the first instruction.
                block.at(0).forEach(
                    thing,
                    (value, role, type, width) => {
                        if (Arg.isEarlyDef(role))
                            localCalc.liveSet.remove!(value);
                    });
                
                let liveAtHead = this._liveAtHead.get(block)!;
                
                if (!mergeIntoSet(liveAtHead, localCalc.liveSet))
                    continue;
                
                for (let predecessor of block.predecessors) {
                    if (mergeIntoSet(this._liveAtTail.get(predecessor)!, liveAtHead)) {
                        dirtyBlocks.add(predecessor);
                        changed = true;
                    }
                }
            }
        } while (changed);
    }
    
    get thing() { return this._thing; }
    get code() { return this._code; }
    get liveAtHead() { return this._liveAtHead; }
    get liveAtTail() { return this._liveAtTail; }
    
    localCalc(block: BasicBlock)
    {
        let liveness = this;
        class LocalCalc {
            // Set.remove is absent upstream. The optional member keeps its
            // original TypeError if a first instruction ever has an early def.
            declare _liveSet: Set<T> & { remove?: (value: T) => boolean };
            constructor()
            {
                this._liveSet = new Set(liveness.liveAtTail.get(block));
            }
            
            get liveSet() { return this._liveSet; }
            
            execute(instIndex: number): void
            {
                let inst = block.at(instIndex);
                
                // First handle the early defs of the next instruction.
                if (instIndex + 1 < block.size) {
                    block.at(instIndex + 1).forEach(
                        liveness.thing,
                        (value, role, type, width) => {
                            if (Arg.isEarlyDef(role))
                                this._liveSet.delete(value);
                        });
                }
                
                // Then handle defs.
                inst.forEach(
                    liveness.thing,
                    (value, role, type, width) => {
                        if (Arg.isLateDef(role))
                            this._liveSet.delete(value);
                    });
                
                // Then handle uses.
                inst.forEach(
                    liveness.thing,
                    (value, role, type, width) => {
                        if (Arg.isEarlyUse(role))
                            this._liveSet.add(value);
                    });
                
                // Finally handle the late uses of the previous instruction.
                if (instIndex - 1 >= 0) {
                    block.at(instIndex - 1).forEach(
                        liveness.thing,
                        (value, role, type, width) => {
                            if (Arg.isLateUse(role))
                                this._liveSet.add(value);
                        });
                }
            }
        }
        
        return new LocalCalc();
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/insertion_set.js
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

export class Insertion<T> {
    declare _index: number;
    declare _element: T;
    constructor(index: number, element: T)
    {
        this._index = index;
        this._element = element;
    }
    
    get index() { return this._index; }
    get element() { return this._element; }
    
    lessThan(other: Insertion<T>): boolean
    {
        return this._index < other._index;
    }
}

export class InsertionSet<T> {
    declare _insertions: Insertion<T>[];
    // No insert method exists upstream; the rare zero-fill path must still fail.
    declare insert: ((index: number, element: T) => void) | undefined;
    constructor()
    {
        this._insertions = []
    }
    
    appendInsertion(insertion: Insertion<T>): void
    {
        this._insertions.push(insertion);
    }
    
    append(index: number, element: T): void
    {
        this.appendInsertion(new Insertion(index, element));
    }
    
    execute(target: T[]): number
    {
        // We bubble-sort because that's what the C++ code, and for the same reason as we do it:
        // the stdlib doesn't have a stable sort and mergesort is slower in the common case of the
        // array usually being sorted. This array is usually sorted.
        bubbleSort(this._insertions, (a, b) => (a.lessThan(b)));
        
        let numInsertions = this._insertions.length;
        if (!numInsertions)
            return 0;
        let originalTargetSize = target.length;
        target.length += numInsertions;
        let lastIndex = target.length;
        for (let indexInInsertions = numInsertions; indexInInsertions--;) {
            let insertion = this._insertions[indexInInsertions];
            if (indexInInsertions && insertion.index < this._insertions[indexInInsertions - 1].index)
                throw new Error("Insertions out of order");
            if (insertion.index > originalTargetSize)
                throw new Error("Out-of-bounds insertion");
            let firstIndex = insertion.index + indexInInsertions;
            let indexOffset = indexInInsertions + 1;
            for (let i = lastIndex; --i > firstIndex;)
                target[i] = target[i - indexOffset];
            target[firstIndex] = insertion.element;
            lastIndex = firstIndex;
        }
        this._insertions = [];
        return numInsertions;
    }
}

// Source: https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/allocate_stack.js
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

export function allocateStack(code: Code): void
{
    if (code.frameSize)
        throw new Error("Frame size already determined");
    
    function attemptAssignment(slot: StackSlot, offsetFromFP: number, otherSlots: StackSlot[]): boolean
    {
        if (offsetFromFP > 0)
            throw new Error("Expect negative offset");
        
        offsetFromFP = -roundUpToMultipleOf(slot.alignment, -offsetFromFP);
        
        for (let otherSlot of otherSlots) {
            if (!otherSlot.offsetFromFP)
                continue;
            let overlap = rangesOverlap(
                offsetFromFP,
                offsetFromFP + slot.byteSize,
                otherSlot.offsetFromFP,
                otherSlot.offsetFromFP + otherSlot.byteSize);
            if (overlap)
                return false;
        }
        
        slot.setOffsetFromFP(offsetFromFP);
        return true;
    }
    
    function assign(slot: StackSlot, otherSlots: StackSlot[]): void
    {
        if (attemptAssignment(slot, -slot.byteSize, otherSlots))
            return;
        
        for (let otherSlot of otherSlots) {
            if (!otherSlot.offsetFromFP)
                continue;
            if (attemptAssignment(slot, otherSlot.offsetFromFP - slot.byteSize, otherSlots))
                return;
        }
        
        throw new Error("Assignment failed");
    }
    
    // Allocate all of the escaped slots in order. This is kind of a crazy algorithm to allow for
    // the possibility of stack slots being assigned frame offsets before we even get here.
    let assignedEscapedStackSlots: StackSlot[] = [];
    let escapedStackSlotsWorklist: StackSlot[] = [];
    for (let slot of code.stackSlots) {
        if (slot.isLocked) {
            if (slot.offsetFromFP)
                assignedEscapedStackSlots.push(slot);
            else
                escapedStackSlotsWorklist.push(slot);
        } else {
            if (slot.offsetFromFP)
                throw new Error("Offset already assigned");
        }
    }
    
    // This is a fairly espensive loop, but it's OK because we'll usually only have a handful of
    // escaped stack slots.
    while (escapedStackSlotsWorklist.length) {
        let slot = escapedStackSlotsWorklist.pop()!;
        assign(slot, assignedEscapedStackSlots);
        assignedEscapedStackSlots.push(slot);
    }
    
    // Now we handle the spill slots.
    let liveness = new Liveness(StackSlot, code);
    let interference = new Map<StackSlot, Set<StackSlot>>();
    for (let slot of code.stackSlots)
        interference.set(slot, new Set<StackSlot>());
    let slots: StackSlot[] = [];
    
    for (let block of code) {
        let localCalc = liveness.localCalc(block);
        
        function interfere(instIndex: number): void
        {
            Inst.forEachDef(
                StackSlot, block.get(instIndex), block.get(instIndex + 1),
                (slot, role, type, width) => {
                    if (!slot.isSpill)
                        return;
                    
                    for (let otherSlot of localCalc.liveSet) {
                        interference.get(slot)!.add(otherSlot);
                        interference.get(otherSlot)!.add(slot);
                    }
                });
        }
        
        for (let instIndex = block.size; instIndex--;) {
            // Kill dead stores. For simplicity we say that a store is killable if it has only late
            // defs and those late defs are to things that are dead right now. We only do that
            // because that's the only kind of dead stack store we will see here.
            let inst = block.at(instIndex);
            if (!inst.hasNonArgEffects) {
                let ok = true;
                inst.forEachArg((arg, role, type, width) => {
                    if (Arg.isEarlyDef(role)) {
                        ok = false;
                        return;
                    }
                    if (!Arg.isLateDef(role))
                        return;
                    if (!arg.isStack) {
                        ok = false;
                        return;
                    }
                    
                    let slot = arg.stackSlot;
                    if (!slot.isSpill) {
                        ok = false;
                        return;
                    }
                    
                    if (localCalc.liveSet.has(slot)) {
                        ok = false;
                        return;
                    }
                });
                if (ok)
                    inst.clear();
            }
            
            interfere(instIndex);
            localCalc.execute(instIndex);
        }
        interfere(-1);
        
        removeAllMatching(block.insts, inst => inst.opcode == Nop);
    }
    
    // Now we assign stack locations. At its heart this algorithm is just first-fit. For each
    // StackSlot we just want to find the offsetFromFP that is closest to zero while ensuring no
    // overlap with other StackSlots that this overlaps with.
    for (let slot of code.stackSlots) {
        if (slot.offsetFromFP)
            continue;
        
        assign(slot, assignedEscapedStackSlots.concat(Array.from(interference.get(slot)!)));
    }
    
    // Figure out how much stack we're using for stack slots.
    let frameSizeForStackSlots = 0;
    for (let slot of code.stackSlots) {
        frameSizeForStackSlots = Math.max(
            frameSizeForStackSlots,
            -slot.offsetFromFP!);
    }
    
    frameSizeForStackSlots = roundUpToMultipleOf(stackAlignmentBytes, frameSizeForStackSlots);

    // No we need to deduce how much argument area we need.
    for (let block of code) {
        for (let inst of block) {
            for (let arg of inst.args) {
                if (arg.isCallArg) {
                    // For now, we assume that we use 8 bytes of the call arg. But that's not
                    // such an awesome assumption.
                    // FIXME: https://bugs.webkit.org/show_bug.cgi?id=150454
                    if (arg.offset < 0)
                        throw new Error("Did not expect negative offset for callArg");
                    code.requestCallArgAreaSize(arg.offset + 8);
                }
            }
        }
    }
    
    code.setFrameSize(frameSizeForStackSlots + code.callArgAreaSize);
    
    // Finally transform the code to use Addrs instead of StackSlots. This is a lossless
    // transformation since we can search the StackSlots array to figure out which StackSlot any
    // offset-from-FP refers to.

    // FIXME: This may produce addresses that aren't valid if we end up with a ginormous stack frame.
    // We would have to scavenge for temporaries if this happened. Fortunately, this case will be
    // extremely rare so we can do crazy things when it arises.
    // https://bugs.webkit.org/show_bug.cgi?id=152530
    
    let insertionSet = new InsertionSet<Inst>();
    for (let block of code) {
        for (let instIndex = 0; instIndex < block.size; ++instIndex) {
            let inst = block.at(instIndex);
            inst.forEachArg((arg, role, type, width) => {
                function stackAddr(offset: number): Arg
                {
                    return Arg.createStackAddr(offset, code.frameSize, width);
                }
                
                switch (arg.kind) {
                case Arg.Stack: {
                    let slot = arg.stackSlot;
                    if (Arg.isZDef(role)
                        && slot.isSpill
                        && slot.byteSize > Arg.bytes(width)) {
                        // Currently we only handle this simple case because it's the only one
                        // that arises: ZDef's are only 32-bit right now. So, when we hit these
                        // assertions it means that we need to implement those other kinds of
                        // zero fills.
                        if (slot.byteSize != 8) {
                            throw new Error(
                                `Bad spill slot size for ZDef: ${slot.byteSize}, width is ${width}`);
                        }
                        if (width != 32)
                            throw new Error("Bad width for ZDef");
                        
                        insertionSet.insert!(
                            instIndex + 1,
                            new Inst(
                                StoreZero32,
                                [stackAddr(arg.offset + 4 + slot.offsetFromFP!)]));
                    }
                    return stackAddr(arg.offset + slot.offsetFromFP!);
                }
                case Arg.CallArg:
                    return stackAddr(arg.offset - code.frameSize);
                default:
                    break;
                }
            });
        }
        insertionSet.execute(block.insts);
    }
}
