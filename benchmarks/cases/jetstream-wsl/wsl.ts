// Strict TypeScript transcription of WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b.
type Origin = LexerToken | typeof externalOrigin | string;
declare global { interface String { readonly originString?: string; readonly originKind?: string; } }
type NamedNode = Func | Type | Protocol | Variable;
type FuncGroup = Func[] & {kind?: typeof Func};
type NameEntry = NamedNode | FuncGroup;
interface OverloadResult {func?:Func; unificationContext?:UnificationContext; typeArguments?:Node[]; failure?:OverloadResolutionFailure; failures?:OverloadResolutionFailure[];}
type Kind = typeof Type | typeof Value | typeof Func | typeof Protocol;
type Variable = ConstexprTypeParameter | FuncParameter | VariableDecl | AnonymousVariable;
interface GenericLiteral extends Expression {
    readonly value: number;
    type: TypeRef | GenericLiteralType;
    readonly valueForSelectedType: number;
}
interface GenericLiteralType extends Type {
    readonly value: number;
    preferredType: TypeRef;
    type: Type | null;
    readonly constructor: new(origin: Origin, value: number) => GenericLiteralType;
}
interface ReferenceType { readonly constructor: new(origin:Origin,addressSpace:string,elementType:Type)=>ReferenceType; }
interface Node {
    program?: Program;
    readonly origin?: Origin;
    readonly name?: string | null;
    readonly typeParameters?: Node[];
    verifyAsParameter?(context:UnificationContext): Verification;
    verifyAsArgument?(context:UnificationContext): Verification;
}
interface Value {
    readonly origin: Origin;
    get unifyNode(): Value;
    readonly addressSpace?: string | null;
    readonly valueForSelectedType?: Slot;
    readonly negConstexpr?: ((origin?: Origin) => Value) | null;
}
interface Type {
    readonly size: number;
    readonly origin: Origin;
    readonly name?: string | null;
    get unifyNode(): Type;
    populateDefaultValue(buffer:EBuffer,offset:number):void;
    readonly addressSpace?: string;
    readonly elementType?: Type;
    createLiteral?(origin:Origin,value:number|undefined):Value;
    isSigned?: boolean;
    defaultValue?: number;
    canRepresent?(value:number):boolean;
    successorValue?(value:number):number;
    valuesEqual?(a:unknown,b:unknown):boolean;
    allValues?(): Generator<{value:Slot;name:string|number}>;
    instantiate?(typeArguments:Node[]): Type;
}
interface Func { inlined?: boolean; uninstantiatedReturnType?: Type; implementation?: ((args:EPtr[],node:CallExpression)=>EPtr) | null; }
interface ProtocolDecl { readonly isPrimitive?: boolean | number | null; }
interface AnonymousVariable { readonly varIsLValue?: boolean; }
interface PropertyAccessExpression {
    readonly getFuncName: string;
    readonly setFuncName: string;
    readonly andFuncName: string;
}
interface LiteralConfiguration {
    literalClassName: string;
    preferredTypeName: string;
    createType(this: GenericLiteral, origin: Origin, value: number): GenericLiteralType;
    negConstexpr?(this: GenericLiteral, origin?: Origin): GenericLiteral;
}
interface LiteralTypeConfiguration {
    preferredTypeName: string;
    verifyAsArgument(this: GenericLiteralType, context: UnificationContext): Verification;
}
declare const WError: new (origin: string | undefined, message: string) => Error;
declare const node: { origin: Origin };
type Verification = {result:boolean,reason?:string};
function readLiteralType(value: unknown): TypeRef | GenericLiteralType {
    if (value instanceof TypeRef || value instanceof IntLiteralType || value instanceof UintLiteralType || value instanceof FloatLiteralType || value instanceof DoubleLiteralType) return value;
    throw new TypeError("Unexpected WSL literal type");
}
function readInstance<T>(value: unknown, constructor: abstract new (...args: never[]) => T): T {
    if (!(value instanceof constructor)) throw new TypeError("Unexpected WSL value for " + constructor.name);
    return value;
}
function readOptionalInstance<T, V extends Node | null | undefined>(value: V, constructor: abstract new (...args: never[]) => T): T | Extract<V, null | undefined>;
function readOptionalInstance<T>(value: unknown, constructor: abstract new (...args: never[]) => T): T | null | undefined;
function readOptionalInstance<T>(value: unknown, constructor: abstract new (...args: never[]) => T): T | null | undefined {
    if (value === null || value === undefined) return value;
    return readInstance(value, constructor);
}
function isUnknownArray(value: unknown): value is unknown[] { return Array.isArray(value); }
function isInstances<T>(value: unknown, constructor: abstract new (...args: never[]) => T): value is T[] {
    if (!isUnknownArray(value)) return false;
    for (const item of value) if (!(item instanceof constructor)) return false;
    return true;
}
function readInstances<T>(value: unknown, constructor: abstract new (...args: never[]) => T): T[] {
    if (!isInstances(value, constructor)) throw new TypeError("Expected WSL instance array");
    return value;
}
function isOptionalValues(value: unknown[]): value is (Value | null)[] {
    for (const item of value) if (item !== null && !(item instanceof Value)) return false;
    return true;
}
function readOptionalValues(value: unknown[]): (Value | null)[] {
    if (!isOptionalValues(value)) throw new TypeError("Expected WSL value argument");
    return value;
}
interface StructImplementationData { type:StructType; fieldName:string; offset?:number; structSize?:number; fieldSize?:number; }
function isStructImplementationData(value: unknown): value is StructImplementationData {
    return isRecord(value) && value.type instanceof StructType && typeof value.fieldName === "string"
        && (value.offset === undefined || typeof value.offset === "number")
        && (value.structSize === undefined || typeof value.structSize === "number")
        && (value.fieldSize === undefined || typeof value.fieldSize === "number");
}
function readStructImplementationData(value: unknown): StructImplementationData {
    if (!isStructImplementationData(value)) throw new TypeError("Expected WSL struct implementation data");
    return value;
}
function isNamedNode(value:Node):value is NamedNode {
    return value instanceof Func || value instanceof Type || value instanceof Protocol || value instanceof ConstexprTypeParameter || value instanceof FuncParameter || value instanceof VariableDecl || value instanceof AnonymousVariable;
}
function readVariable(value: Node | null): Variable | null {
    if (value === null || value instanceof ConstexprTypeParameter || value instanceof FuncParameter || value instanceof VariableDecl || value instanceof AnonymousVariable) return value;
    throw new TypeError("Expected WSL variable");
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && (typeof value === "object" || typeof value === "function");
}
function readProperty(value: unknown, key: string): unknown {
    if (!isRecord(value)) throw new TypeError("Cannot read WSL member " + key);
    return value[key];
}
function readString(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Expected WSL string");
    return value;
}
function readNumber(value: unknown): number {
    if (typeof value !== "number") throw new TypeError("Expected WSL numeric value");
    return value;
}
function callLegacy(value: unknown, ...args: unknown[]): unknown {
    if (typeof value !== "function") throw new TypeError("WSL member is not callable");
    return value(...args);
}
declare const type: Type;
declare function describe(value: unknown): string;
declare const TernaryExpression: new(origin: Origin, condition: Value, left: Value, right: Value) => Value;
type Slot = number | boolean | EPtr | EArrayRef | null | undefined;
type DoubleLiteral = InstanceType<typeof DoubleLiteral>;
type DoubleLiteralType = InstanceType<typeof DoubleLiteralType>;
type FloatLiteral = InstanceType<typeof FloatLiteral>;
type FloatLiteralType = InstanceType<typeof FloatLiteralType>;
type IntLiteral = InstanceType<typeof IntLiteral>;
type IntLiteralType = InstanceType<typeof IntLiteralType>;
type UintLiteral = InstanceType<typeof UintLiteral>;
type UintLiteralType = InstanceType<typeof UintLiteralType>;

// Upstream source: ./WSL/Node.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Node {
    visit(visitor: Rewriter): Node;
    visit(visitor: Evaluator): EPtr | null | undefined;
    visit(visitor: Checker): Type | WTypeError | undefined;
    visit(visitor: object): unknown;
    visit(visitor: object): unknown
    {
        let visitFunc = readProperty(visitor, "visit" + this.constructor.name);
        if (!visitFunc)
            throw new Error("No visit function for " + this.constructor.name + " in " + visitor.constructor.name);
        if (typeof visitFunc !== "function") throw new TypeError("WSL visit member is not callable");
        let returnValue: unknown = visitFunc.call(visitor, this);
        if ("returnValue" in visitor)
            returnValue = visitor.returnValue;
        if (visitor instanceof Rewriter) return readInstance(returnValue, Node);
        if (visitor instanceof Evaluator) {
            if (returnValue === null || returnValue === undefined) return returnValue;
            return readInstance(returnValue, EPtr);
        }
        if (visitor instanceof Checker) {
            if (returnValue === undefined || returnValue instanceof WTypeError) return returnValue;
            return readInstance(returnValue, Type);
        }
        return returnValue;
    }
    
    static visit<T extends Node | null | undefined>(node: T, visitor: Rewriter): Node | Extract<T, null | undefined>;
    static visit(node: unknown, visitor: object): unknown;
    static visit(node: unknown, visitor: object): unknown
    {
        if (node instanceof Node)
            return node.visit(visitor);
        return node;
    }
    
    unify(unificationContext: UnificationContext, other: Node)
    {
        if (!other)
            throw new Error("Null other");
        let unifyThis = this.unifyNode;
        let unifyOther = other.unifyNode;
        if (unifyThis == unifyOther)
            return true;
        if (unifyOther.typeVariableUnify(unificationContext, unifyThis))
            return true;
        return unifyThis.unifyImpl(unificationContext, unifyOther);
    }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (other.typeVariableUnify(unificationContext, this))
            return true;
        return this == other;
    }
    
    typeVariableUnify(unificationContext: UnificationContext, other: Node)
    {
        return false;
    }
    
    _typeVariableUnifyImpl(unificationContext: UnificationContext, other: Node)
    {
        let realThis = unificationContext.find(this);
        if (realThis != this)
            return realThis.unify(unificationContext, other);
        
        unificationContext.union(this, other);
        return true;
    }
    
    // Most type variables don't care about this.
    prepareToVerify(unificationContext: UnificationContext): (() => Verification) | undefined { return undefined; }
    commitUnification(unificationContext: UnificationContext) { }
    
    get unifyNode(): Node { return this; }
    get isUnifiable() { return false; }
    get isLiteral() { return false; }
    
    get isNative() { return false; }
    
    conversionCost(unificationContext: UnificationContext) { return 0; }
    
    equals(other: Node)
    {
        let unificationContext = new UnificationContext();
        if (this.unify(unificationContext, other) && unificationContext.verify().result)
            return unificationContext;
        return false;
    }
    
    equalsWithCommit(other: Node)
    {
        let unificationContext = this.equals(other);
        if (!unificationContext)
            return false;
        unificationContext.commit();
        return unificationContext;
    }
    
    commit()
    {
        let unificationContext = new UnificationContext();
        unificationContext.addExtraNode(this);
        let result = unificationContext.verify();
        if (!result.result)
            throw new WError(node.origin.originString, "Could not infer type: " + result.reason);
        unificationContext.commit();
        return unificationContext.find(this);
    }
    
    substitute(parameters: Node[], argumentList: Node[]): Node
    {
        return this.visit(new Substitution(parameters, argumentList));
    }
    
    substituteToUnification(parameters: Node[], unificationContext: UnificationContext): Node
    {
        return this.substitute(
            parameters,
            parameters.map((type: Node) => unificationContext.find(type)));
    }
}


// Upstream source: ./WSL/Type.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Type extends Node {
    
    
    
    
    
    
    
    

    get typeParameters(): Node[] { return []; }
    get kind(): typeof Type { return Type; }
    get isPtr() { return false; }
    get isArray() { return false; }
    get isArrayRef() { return false; }
    get isRef() { return this.isPtr || this.isArrayRef; }
    get isNumber() { return false; }
    get isInt() { return false; }
    get isFloating() { return false; }
    get isPrimitive(): boolean | number | null | undefined { return false; }
    
    inherits(protocol: ProtocolRef | null | undefined): Verification
    {
        if (!protocol)
            return {result: true};
        return protocol.hasHeir(this);
    }
    
    get instantiatedType(): Type { return readInstance(this.visit(new InstantiateImmediates()), Type); }
    
    // Have to call these on the unifyNode.
    argumentForAndOverload(origin: Origin, value: Value): Value
    {
        return new MakePtrExpression(origin, value);
    }
    argumentTypeForAndOverload(origin: Origin): Type
    {
        return new PtrType(origin, "thread", this);
    }
    returnTypeFromAndOverload(origin: Origin): Type
    {
        throw new WTypeError(origin.originString, "By-pointer overload returned non-pointer type: " + this);
    }
}



// Upstream source: ./WSL/ReferenceType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ReferenceType extends Type {
    declare _origin: Origin;
    declare _addressSpace: string;
    declare _elementType: Type;

    constructor(origin: Origin, addressSpace: string, elementType: Type)
    {
        if (!elementType)
            throw new Error("Null elementType");
        if (!origin)
            throw new Error("Null origin");
        super();
        validateAddressSpace(addressSpace);
        this._origin = origin;
        this._addressSpace = addressSpace;
        this._elementType = elementType;
    }
    
    get origin() { return this._origin; }
    get addressSpace() { return this._addressSpace; }
    get elementType() { return this._elementType; }

    get size(): number { return 1; }

    populateDefaultValue(buffer: EBuffer, offset: number): void
    {
        buffer.set(offset, null);
    }
}



// Upstream source: ./WSL/Value.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Value extends Node {
    declare ePtr: EPtr;

    declare __proto__: object;
    declare _origin: Origin;
    declare _target: Value;

    get kind(): typeof Value { return Value; }
    get isConstexpr() { return false; }
    get isLValue(): boolean | null | undefined { return false; }
    get notLValueReason(): string | null { return null; }
    
    get notLValueReasonString()
    {
        let result = this.notLValueReason;
        if (result)
            return "\n" + result;
        return "";
    }
    
    become(otherValue: Value)
    {
        // NOTE: Make sure that IdentityExpression implements unifyNode and all that
        let origin = this.origin;
        this.__proto__ = IdentityExpression.prototype;
        this._origin = origin;
        this._target = otherValue;
    }
}



// Upstream source: ./WSL/Expression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Expression extends Value {
    declare ePtr: EPtr;

    declare _origin: Origin;

    constructor(origin: Origin)
    {
        super();
        this._origin = origin;
    }
    
    get origin() { return this._origin; }
}


// Upstream source: ./WSL/Rewriter.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// FIXME: This should have sensible behavior when it encounters definitions that it cannot handle. Right
// now we are hackishly preventing this by wrapping things in TypeRef. That's probably wrong.
// https://bugs.webkit.org/show_bug.cgi?id=176208
class Rewriter {
    declare _mapping: Map<Node | null, Node>;

    constructor()
    {
        this._mapping = new Map();
    }
    
    _mapNode(oldItem: Node, newItem: Node)
    {
        this._mapping.set(oldItem, newItem);
        return newItem;
    }
    
    _getMapping(oldItem: Node | null)
    {
        let result = this._mapping.get(oldItem);
        if (result)
            return result;
        return oldItem;
    }
    
    // We return identity for anything that is not inside a function/struct body. When processing
    // function bodies, we only recurse into them and never out of them - for example if there is a
    // function call to another function then we don't rewrite the other function. This is how we stop
    // that.
    visitFuncDef(node: FuncDef): Node { return node; }
    visitNativeFunc(node: NativeFunc): Node { return node; }
    visitNativeFuncInstance(node: NativeFuncInstance): Node { return node; }
    visitNativeType(node: NativeType): Node { return node; }
    visitTypeDef(node: TypeDef): Node { return node; }
    visitStructType(node: StructType): Node { return node; }
    visitConstexprTypeParameter(node: ConstexprTypeParameter): Node { return node; }
    visitProtocolDecl(node: ProtocolDecl): Node { return node; }
    visitEnumType(node: EnumType): Node { return node; }

    // This is almost wrong. We instantiate Func in Substitution in ProtocolDecl. Then, we end up
    // not rewriting type variables. I think that just works because not rewriting them there is OK.
    // Everywhere else, it's mandatory that we don't rewrite these because we always assume that
    // type variables are outside the scope of rewriting.
    visitTypeVariable(node: TypeVariable): Node { return node; }

    visitProtocolFuncDecl(node: ProtocolFuncDecl): Node
    {
        let result = new ProtocolFuncDecl(
            node.origin, node.name,
            readInstance(node.returnType.visit(this), Type),
            node.typeParameters.map((parameter: Node) => parameter.visit(this)),
            readInstances(node.parameters.map((parameter: Node) => parameter.visit(this)), FuncParameter),
            node.isCast,
            node.shaderType);
        result.protocolDecl = node.protocolDecl;
        result.possibleOverloads = node.possibleOverloads;
        return result;
    }
    
    visitNativeTypeInstance(node: NativeTypeInstance): Node
    {
        return new NativeTypeInstance(
            readInstance(node.type.visit(this), NativeType),
            node.typeArguments.map((argument: Node) => argument.visit(this)));
    }
    
    visitFuncParameter(node: FuncParameter): Node
    {
        let result = new FuncParameter(node.origin, node.name, readInstance(node.type.visit(this), Type));
        this._mapNode(node, result);
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitVariableDecl(node: VariableDecl): Node
    {
        let result = new VariableDecl(
            node.origin, node.name,
            readInstance(node.type.visit(this), Type),
            readOptionalInstance(Node.visit(node.initializer, this), Value));
        this._mapNode(node, result);
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitBlock(node: Block): Node
    {
        let result = new Block(node.origin);
        for (let statement of node.statements)
            result.add(statement.visit(this));
        return result;
    }
    
    visitCommaExpression(node: CommaExpression): Node
    {
        return new CommaExpression(node.origin, readInstances(node.list.map((expression: Expression) => {
            let result = expression.visit(this);
            if (!result)
                throw new Error("Null result from " + expression);
            return result;
        }), Value));
    }
    
    visitProtocolRef(node: ProtocolRef): Node
    {
        return node;
    }
    
    visitTypeRef(node: TypeRef): Node
    {
        let result = new TypeRef(node.origin, node.name, node.typeArguments.map(typeArgument => typeArgument.visit(this)));
        result.type = readOptionalInstance(Node.visit(node.type, this), Type);
        return result;
    }
    
    visitField(node: Field): Node
    {
        return new Field(node.origin, node.name, readInstance(node.type.visit(this), Type));
    }
    
    visitEnumMember(node: EnumMember): Node
    {
        return new EnumMember(node.origin, node.name, readOptionalInstance(node.value!.visit(this), Value));
    }
    
    visitEnumLiteral(node: EnumLiteral): Node
    {
        let result = new EnumLiteral(node.origin, node.member);
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitReferenceType(node: ReferenceType): Node
    {
        return new node.constructor(node.origin, node.addressSpace, readInstance(node.elementType.visit(this), Type));
    }
    
    visitPtrType(node: PtrType): Node
    {
        return this.visitReferenceType(node);
    }
    
    visitArrayRefType(node: ArrayRefType): Node
    {
        return this.visitReferenceType(node);
    }
    
    visitArrayType(node: ArrayType): Node
    {
        return new ArrayType(node.origin, readInstance(node.elementType.visit(this), Type), readInstance(node.numElements.visit(this), Value));
    }
    
    visitAssignment(node: Assignment): Node
    {
        let result = new Assignment(node.origin, readInstance(node.lhs.visit(this), Value), readInstance(node.rhs.visit(this), Value));
        result.type = readOptionalInstance(Node.visit(node.type, this), Type);
        return result;
    }
    
    visitReadModifyWriteExpression(node: ReadModifyWriteExpression): Node
    {
        let result = new ReadModifyWriteExpression(node.origin, readInstance(node.lValue.visit(this), Value));
        result.oldValueVar = readInstance(node.oldValueVar.visit(this), AnonymousVariable);
        result.newValueVar = readInstance(node.newValueVar.visit(this), AnonymousVariable);
        result.newValueExp = readOptionalInstance(node.newValueExp!.visit(this), Value);
        result.resultExp = readOptionalInstance(node.resultExp!.visit(this), Value);
        return result;
    }
    
    visitDereferenceExpression(node: DereferenceExpression): Node
    {
        let result = new DereferenceExpression(node.origin, readInstance(node.ptr.visit(this), Value));
        result.type = readOptionalInstance(Node.visit(node.type, this), Type);
        result.addressSpace = node.addressSpace;
        return result;
    }
    
    _handlePropertyAccessExpression(result: DotExpression|IndexExpression, node: PropertyAccessExpression)
    {
        result.possibleGetOverloads = node.possibleGetOverloads;
        result.possibleSetOverloads = node.possibleSetOverloads;
        result.possibleAndOverloads = node.possibleAndOverloads;
        result.baseType = readOptionalInstance(Node.visit(node.baseType, this), Type);
        result.callForGet = readOptionalInstance(Node.visit(node.callForGet, this), CallExpression);
        result.resultTypeForGet = readOptionalInstance(Node.visit(node.resultTypeForGet, this), Type);
        result.callForAnd = readOptionalInstance(Node.visit(node.callForAnd, this), CallExpression);
        result.resultTypeForAnd = readOptionalInstance(Node.visit(node.resultTypeForAnd, this), Type);
        result.callForSet = readOptionalInstance(Node.visit(node.callForSet, this), CallExpression);
        result.errorForSet = node.errorForSet;
        result.updateCalls();
    }
    
    visitDotExpression(node: DotExpression): Node
    {
        let result = new DotExpression(node.origin, readInstance(node.struct.visit(this), Value), node.fieldName);
        this._handlePropertyAccessExpression(result, node);
        return result;
    }
    
    visitIndexExpression(node: IndexExpression): Node
    {
        let result = new IndexExpression(node.origin, readInstance(node.array.visit(this), Value), readInstance(node.index.visit(this), Value));
        this._handlePropertyAccessExpression(result, node);
        return result;
    }
    
    visitMakePtrExpression(node: MakePtrExpression): Node
    {
        let result = new MakePtrExpression(node.origin, readInstance(node.lValue.visit(this), Value));
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitMakeArrayRefExpression(node: MakeArrayRefExpression): Node
    {
        let result = new MakeArrayRefExpression(node.origin, readInstance(node.lValue.visit(this), Value));
        if (node.numElements)
            result.numElements = readInstance(node.numElements.visit(this), Value);
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitConvertPtrToArrayRefExpression(node: ConvertPtrToArrayRefExpression): Node
    {
        let result = new ConvertPtrToArrayRefExpression(node.origin, readInstance(node.lValue.visit(this), Value));
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitVariableRef(node: VariableRef): Node
    {
        let result = new VariableRef(node.origin, node.name);
        result.variable = readVariable(this._getMapping(node.variable));
        return result;
    }
    
    visitReturn(node: Return): Node
    {
        return new Return(node.origin, readOptionalInstance(Node.visit(node.value, this), Value));
    }
    
    visitContinue(node: Continue): Node
    {
        return new Continue(node.origin);
    }
    
    visitBreak(node: Break): Node
    {
        return new Break(node.origin);
    }

    visitTrapStatement(node: TrapStatement): Node
    {
        return new TrapStatement(node.origin);
    }
    
    visitGenericLiteral(node: GenericLiteral): Node
    {
        // FIXME: This doesn't seem right.
        let result = new IntLiteral(node.origin, node.value);
        result.type = readLiteralType(node.type.visit(this));
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitGenericLiteralType(node: GenericLiteralType): Node
    {
        let result = new node.constructor(node.origin, node.value);
        result.type = readOptionalInstance(Node.visit(node.type, this), Type);
        result.preferredType = readInstance(node.preferredType.visit(this), TypeRef);
        return result;
    }

    visitBoolLiteral(node: BoolLiteral): Node
    {
        return node;
    }
    
    visitNullLiteral(node: NullLiteral): Node
    {
        let result = new NullLiteral(node.origin);
        result.type = readOptionalInstance(node.type!.visit(this), Type);
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitNullType(node: NullType): Node
    {
        let result = new NullType(node.origin);
        result.type = readOptionalInstance(Node.visit(node.type, this), Type);
        return result;
    }

    processDerivedCallData(node: CallExpression, result: CallExpression)
    {
        let handleTypeArguments = (actualTypeArguments: Node[] | null | undefined) => {
            if (actualTypeArguments)
                return actualTypeArguments.map((actualTypeArgument) => actualTypeArgument.visit(this));
            else
                return null;
        }
        result.actualTypeArguments = handleTypeArguments(node.actualTypeArguments);
        result.instantiatedActualTypeArguments = handleTypeArguments(node.instantiatedActualTypeArguments);
        let argumentTypes = node.argumentTypes;
        if (argumentTypes)
            result.argumentTypes = readInstances(argumentTypes.map((argumentType) => argumentType.visit(this)), Type);
        result.func = node.func;
        result.nativeFuncInstance = node.nativeFuncInstance;
        result.possibleOverloads = node.possibleOverloads;
        if (node.isCast)
            result.setCastData(readInstance(node.returnType!.visit(this), Type));
        result.resultType = readOptionalInstance(Node.visit(node.resultType, this), Type);
        result.resultEPtr = node.resultEPtr;
        return result;
    }

    visitCallExpression(node: CallExpression): Node
    {
        let result = new CallExpression(
            node.origin, node.name,
            node.typeArguments.map(typeArgument => typeArgument.visit(this)),
            readOptionalValues(node.argumentList.map(argument => readOptionalInstance(Node.visit(argument, this), Value))));
        return this.processDerivedCallData(node, result);
    }
    
    visitFunctionLikeBlock(node: FunctionLikeBlock): Node
    {
        let result = new FunctionLikeBlock(
            node.origin,
            readInstance(Node.visit(node.returnType, this), Type),
            readInstances(node.argumentList.map((argument: Node) => argument.visit(this)), Value),
            readInstances(node.parameters.map((parameter: Node) => parameter.visit(this)), FuncParameter),
            readInstance(node.body.visit(this), Block));
        result.returnEPtr = node.returnEPtr;
        return result;
    }
    
    visitLogicalNot(node: LogicalNot): Node
    {
        let result = new LogicalNot(node.origin, readInstance(node.operand.visit(this), Value));
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitLogicalExpression(node: LogicalExpression): Node
    {
        let result = new LogicalExpression(node.origin, node.text, readInstance(node.left.visit(this), Value), readInstance(node.right.visit(this), Value));
        result.ePtr = node.ePtr;
        return result;
    }

    visitIfStatement(node: IfStatement): Node
    {
        return new IfStatement(node.origin, readInstance(node.conditional.visit(this), Value), node.body!.visit(this), Node.visit(node.elseBody, this));
    }

    visitWhileLoop(node: WhileLoop): Node
    {
        return new WhileLoop(node.origin, readInstance(node.conditional.visit(this), Value), node.body!.visit(this));
    }

    visitDoWhileLoop(node: DoWhileLoop): Node
    {
        return new DoWhileLoop(node.origin, node.body!.visit(this), readInstance(node.conditional.visit(this), Value));
    }

    visitForLoop(node: ForLoop): Node
    {
        return new ForLoop(node.origin,
            Node.visit(node.initialization, this),
            readOptionalInstance(Node.visit(node.condition, this), Value),
            readOptionalInstance(Node.visit(node.increment, this), Value),
            node.body!.visit(this));
    }
    
    visitSwitchStatement(node: SwitchStatement): Node
    {
        let result = new SwitchStatement(node.origin, readInstance(Node.visit(node.value, this), Value));
        for (let switchCase of node.switchCases)
            result.add(readInstance(switchCase.visit(this), SwitchCase));
        result.type = readOptionalInstance(Node.visit(node.type, this), Type);
        return result;
    }
    
    visitSwitchCase(node: SwitchCase): Node
    {
        return new SwitchCase(node.origin, readOptionalInstance(Node.visit(node.value, this), Value), readInstance(node.body.visit(this), Block));
    }
    
    visitAnonymousVariable(node: AnonymousVariable): Node
    {
        let result = new AnonymousVariable(node.origin, readOptionalInstance(node.type!.visit(this), Type));
        result._index = node._index;
        this._mapNode(node, result);
        result.ePtr = node.ePtr;
        return result;
    }
    
    visitIdentityExpression(node: IdentityExpression): Node
    {
        return new IdentityExpression(readInstance(node.target.visit(this), Value));
    }
}



// Upstream source: ./WSL/Visitor.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Visitor {
    visitProgram(node: Program)
    {
        for (let statement of node.topLevelStatements)
            statement.visit(this);
    }
    
    visitFunc(node: Func)
    {
        node.returnType.visit(this);
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        for (let parameter of node.parameters)
            parameter.visit(this);
    }
    
    visitProtocolFuncDecl(node: ProtocolFuncDecl)
    {
        this.visitFunc(node);
    }
    
    visitFuncParameter(node: FuncParameter)
    {
        node.type.visit(this);
    }
    
    visitFuncDef(node: FuncDef)
    {
        this.visitFunc(node);
        node.body.visit(this);
    }
    
    visitNativeFunc(node: NativeFunc)
    {
        this.visitFunc(node);
    }
    
    visitNativeFuncInstance(node: NativeFuncInstance)
    {
        this.visitFunc(node);
        node.func.visitImplementationData(node.implementationData, this);
    }
    
    visitBlock(node: Block)
    {
        for (let statement of node.statements)
            statement.visit(this);
    }
    
    visitCommaExpression(node: CommaExpression)
    {
        for (let expression of node.list)
            expression.visit(this);
    }
    
    visitProtocolRef(node: ProtocolRef)
    {
    }
    
    visitProtocolDecl(node: ProtocolDecl)
    {
        for (let protocol of node.extends)
            protocol.visit(this);
        for (let signature of node.signatures)
            signature.visit(this);
    }
    
    visitTypeRef(node: TypeRef)
    {
        for (let typeArgument of node.typeArguments)
            typeArgument.visit(this);
    }
    
    visitNativeType(node: NativeType)
    {
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
    }
    
    visitNativeTypeInstance(node: NativeTypeInstance)
    {
        node.type.visit(this);
        for (let typeArgument of node.typeArguments)
            typeArgument.visit(this);
    }
    
    visitTypeDef(node: TypeDef)
    {
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        node.type.visit(this);
    }
    
    visitStructType(node: StructType)
    {
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        for (let field of node.fields)
            field.visit(this);
    }
    
    visitTypeVariable(node: TypeVariable)
    {
        Node.visit(node.protocol, this);
    }
    
    visitConstexprTypeParameter(node: ConstexprTypeParameter)
    {
        node.type.visit(this);
    }
    
    visitField(node: Field)
    {
        node.type.visit(this);
    }
    
    visitEnumType(node: EnumType)
    {
        node.baseType.visit(this);
        for (let member of node.members)
            member.visit(this);
    }
    
    visitEnumMember(node: EnumMember)
    {
        Node.visit(node.value, this);
    }
    
    visitEnumLiteral(node: EnumLiteral)
    {
    }
    
    visitElementalType(node: ReferenceType | ArrayType)
    {
        node.elementType.visit(this);
    }
    
    visitReferenceType(node: ReferenceType)
    {
        this.visitElementalType(node);
    }
    
    visitPtrType(node: PtrType)
    {
        this.visitReferenceType(node);
    }
    
    visitArrayRefType(node: ArrayRefType)
    {
        this.visitReferenceType(node);
    }
    
    visitArrayType(node: ArrayType)
    {
        this.visitElementalType(node);
        node.numElements.visit(this);
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        node.type.visit(this);
        Node.visit(node.initializer, this);
    }
    
    visitAssignment(node: Assignment)
    {
        node.lhs.visit(this);
        node.rhs.visit(this);
        Node.visit(node.type, this);
    }
    
    visitReadModifyWriteExpression(node: ReadModifyWriteExpression)
    {
        node.lValue.visit(this);
        node.oldValueVar.visit(this);
        node.newValueVar.visit(this);
        node.newValueExp!.visit(this);
        node.resultExp!.visit(this);
    }
    
    visitDereferenceExpression(node: DereferenceExpression)
    {
        node.ptr.visit(this);
    }
    
    _handlePropertyAccessExpression(node: PropertyAccessExpression)
    {
        Node.visit(node.baseType, this);
        Node.visit(node.callForGet, this);
        Node.visit(node.resultTypeForGet, this);
        Node.visit(node.callForAnd, this);
        Node.visit(node.resultTypeForAnd, this);
        Node.visit(node.callForSet, this);
    }
    
    visitDotExpression(node: DotExpression)
    {
        node.struct.visit(this);
        this._handlePropertyAccessExpression(node);
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        node.array.visit(this);
        node.index.visit(this);
        this._handlePropertyAccessExpression(node);
    }
    
    visitMakePtrExpression(node: MakePtrExpression)
    {
        node.lValue.visit(this);
    }
    
    visitMakeArrayRefExpression(node: MakeArrayRefExpression)
    {
        node.lValue.visit(this);
        Node.visit(node.numElements, this);
    }
    
    visitConvertPtrToArrayRefExpression(node: ConvertPtrToArrayRefExpression)
    {
        node.lValue.visit(this);
    }
    
    visitVariableRef(node: VariableRef)
    {
    }
    
    visitIfStatement(node: IfStatement)
    {
        node.conditional.visit(this);
        node.body!.visit(this);
        Node.visit(node.elseBody, this);
    }
    
    visitWhileLoop(node: WhileLoop)
    {
        node.conditional.visit(this);
        node.body!.visit(this);
    }
    
    visitDoWhileLoop(node: DoWhileLoop)
    {
        node.body!.visit(this);
        node.conditional.visit(this);
    }
    
    visitForLoop(node: ForLoop)
    {
        Node.visit(node.initialization, this);
        Node.visit(node.condition, this);
        Node.visit(node.increment, this);
        node.body!.visit(this);
    }
    
    visitSwitchStatement(node: SwitchStatement)
    {
        node.value.visit(this);
        for (let switchCase of node.switchCases)
            switchCase.visit(this);
    }
    
    visitSwitchCase(node: SwitchCase)
    {
        Node.visit(node.value, this);
        node.body.visit(this);
    }

    visitReturn(node: Return)
    {
        Node.visit(node.value, this);
    }

    visitContinue(node: Continue)
    {
    }

    visitBreak(node: Break)
    {
    }

    visitTrapStatement(node: TrapStatement)
    {
    }
    
    visitGenericLiteral(node: GenericLiteral)
    {
        node.type.visit(this);
    }
    
    visitGenericLiteralType(node: GenericLiteralType)
    {
        Node.visit(node.type, this);
        node.preferredType.visit(this);
    }
    
    visitNullLiteral(node: NullLiteral)
    {
        node.type!.visit(this);
    }
    
    visitBoolLiteral(node: BoolLiteral)
    {
    }
    
    visitNullType(node: NullType)
    {
        Node.visit(node.type, this);
    }
    
    visitCallExpression(node: CallExpression)
    {
        for (let typeArgument of node.typeArguments)
            typeArgument.visit(this);
        for (let argument of node.argumentList)
            Node.visit(argument, this);
        let handleTypeArguments = (actualTypeArguments: Node[] | null | undefined) => {
            if (actualTypeArguments) {
                for (let argument of actualTypeArguments)
                    argument.visit(this);
            }
        };
        handleTypeArguments(node.actualTypeArguments);
        handleTypeArguments(node.instantiatedActualTypeArguments);
        Node.visit(node.nativeFuncInstance, this);
        Node.visit(node.returnType, this);
        Node.visit(node.resultType, this);
    }
    
    visitLogicalNot(node: LogicalNot)
    {
        node.operand.visit(this);
    }
    
    visitLogicalExpression(node: LogicalExpression)
    {
        node.left.visit(this);
        node.right.visit(this);
    }
    
    visitFunctionLikeBlock(node: FunctionLikeBlock)
    {
        Node.visit(node.returnType, this);
        for (let argument of node.argumentList)
            argument.visit(this);
        for (let parameter of node.parameters)
            parameter.visit(this);
        node.body.visit(this);
        Node.visit(node.resultType, this);
    }
    
    visitAnonymousVariable(node: AnonymousVariable)
    {
        Node.visit(node.type, this);
    }
    
    visitIdentityExpression(node: IdentityExpression)
    {
        node.target.visit(this);
    }
}



// Upstream source: ./WSL/CreateLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function createLiteral(config: LiteralConfiguration)
{
    class GenericLiteral extends Expression {
    declare _value: number;
    declare type: TypeRef | GenericLiteralType;

        constructor(origin: Origin, value: number)
        {
            super(origin);
            this._value = value;
            this.type = config.createType.call(this, origin, value);
        }
        
        static withType(origin: Origin, value: number, type: Type)
        {
            let result = new GenericLiteral(origin, value);
            result.type = TypeRef.wrap(type);
            return result;
        }
        
        get value() { return this._value; }
        
        // This is necessary because once we support int64, we'll need that to be represented as an object
        // rather than as a primitive. Then we'll need to convert.
        get valueForSelectedType()
        {
            let type = this.type.type!.unifyNode;
            if (!type)
                throw new Error("Cannot get type for " + this);
            let func = readProperty(type, "formatValueFrom" + config.literalClassName);
            if (!func)
                throw new Error("Cannot get function to format type for " + config.literalClassName + " from " + type);
            if (typeof func !== "function") throw new TypeError("WSL literal formatter is not callable");
            return readNumber(func.call(type, this.value));
        }
        
        get isConstexpr() { return true; }
        get isLiteral() { return true; }
        
        get negConstexpr()
        {
            if (!config.negConstexpr)
                return null;
            
            return () => config.negConstexpr!.call(this);
        }
        
        unifyImpl(unificationContext: UnificationContext, other: Node)
        {
            if (!(other instanceof GenericLiteral))
                return false;
            return this.value == other.value;
        }
        
        toString()
        {
            return config.preferredTypeName + "Literal<" + this.value + ">";
        }
    }
    
    return GenericLiteral;
}



// Upstream source: ./WSL/CreateLiteralType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function createLiteralType(config: LiteralTypeConfiguration)
{
    class GenericLiteralType extends Type {
    declare ["constructor"]: new(origin: Origin, value: number) => GenericLiteralType;
    declare _origin: Origin;
    declare _value: number;
    declare preferredType: TypeRef;
    declare type: Type | null;

        constructor(origin: Origin, value: number)
        {
            super();
            this._origin = origin;
            this._value = value;
            this.preferredType = new TypeRef(origin, config.preferredTypeName, []);
        }
        
        get origin() { return this._origin; }
        get value() { return this._value; }
        
        get isPrimitive(): boolean | number | null | undefined { return true; }
        get isUnifiable() { return true; }
        get isLiteral() { return true; }
        
        typeVariableUnify(unificationContext: UnificationContext, other: Node)
        {
            if (!(other instanceof Type))
                return false;
            
            return this._typeVariableUnifyImpl(unificationContext, other);
        }
        
        unifyImpl(unificationContext: UnificationContext, other: Node)
        {
            return this.typeVariableUnify(unificationContext, other);
        }
        
        prepareToVerify(unificationContext: UnificationContext)
        {
            let realThis = unificationContext.find(this);
            if (realThis instanceof TypeVariable || realThis.isLiteral) {
                return () => {
                    if (realThis.unify(unificationContext, this.preferredType))
                        return {result: true};
                    return {result: false, reason: "Type mismatch between " + unificationContext.find(realThis) + " and " + this.preferredType};
                };
            }
        }
        
        verifyAsArgument(unificationContext: UnificationContext): Verification
        {
            return config.verifyAsArgument.call(this, unificationContext);
        }
        
        verifyAsParameter(unificationContext: UnificationContext): Verification
        {
            throw new Error("GenericLiteralType should never be used as a type parameter");
        }
        
        conversionCost(unificationContext: UnificationContext)
        {
            let realThis = unificationContext.find(this);
            if (realThis.equals(this.preferredType))
                return 0;
            return 1;
        }
        
        commitUnification(unificationContext: UnificationContext)
        {
            this.type = readOptionalInstance(unificationContext.find(this).visit(new AutoWrapper()), Type);
        }
        
        toString()
        {
            return config.preferredTypeName + "LiteralType<" + this.value + ">";
        }
    }
    
    return GenericLiteralType;
}



// Upstream source: ./WSL/PropertyAccessExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class PropertyAccessExpression extends Expression {
    declare base: Value;
    declare addressSpace: string | undefined | null;
    declare possibleGetOverloads: Func[] | null | undefined;
    declare possibleSetOverloads: Func[] | null | undefined;
    declare possibleAndOverloads: Func[] | null | undefined;
    declare resultTypeForGet: Type | null | undefined;
    declare resultTypeForAnd: Type | null | undefined;
    declare callForSet: CallExpression | null | undefined;
    declare errorForSet: WTypeError | null;

    declare callForAnd: CallExpression | null | undefined;
    declare baseType: Type | null | undefined;
    declare callForGet: CallExpression | null | undefined;
    declare _isLValue: boolean | null;
    declare _notLValueReason: string | null;

    constructor(origin: Origin, base: Value)
    {
        super(origin);
        this.base = base;
        this._isLValue = null; // We use null to indicate that we don't know yet.
        this.addressSpace = null;
        this._notLValueReason = null;
    }
    
    get resultType() { return this.resultTypeForGet ? this.resultTypeForGet : this.resultTypeForAnd; }
    get isLValue() { return this._isLValue; }
    set isLValue(value: boolean | null) { this._isLValue = value; }
    get notLValueReason() { return this._notLValueReason; }
    set notLValueReason(value: string | null) { this._notLValueReason = value; }
    
    rewriteAfterCloning()
    {
        // At this point, node.base.isLValue will only return true if it's possible to get a pointer to it,
        // since we will no longer see any DotExpressions or IndexExpressions. Also, node is a newly created
        // node and everything beneath it is newly created, so we can edit it in-place.
        
        if ((this.base.isLValue || this.baseType!.isRef) && this.callForAnd)
            return new DereferenceExpression(this.origin, this.callForAnd, this.resultType, this.callForAnd.resultType!.addressSpace);
        
        if (this.callForGet)
            return this.callForGet;
        
        if (!this.callForAnd)
            throw new Error(this.origin.originString + ": Property access without getter and ander: " + this);
        
        let anonVar = new AnonymousVariable(this.origin, this.baseType);
        this.callForAnd.argumentList[0] = this.baseType!.unifyNode.argumentForAndOverload(this.origin, VariableRef.wrap(anonVar));
        return new CommaExpression(this.origin, [
            anonVar,
            new Assignment(this.origin, VariableRef.wrap(anonVar), this.base, this.baseType),
            new DereferenceExpression(this.origin, this.callForAnd, this.resultType, this.callForAnd.resultType!.addressSpace)
        ]);
    }
    
    updateCalls()
    {
        if (this.callForGet)
            this.callForGet.argumentList[0] = this.base;
        if (this.callForAnd)
            this.callForAnd.argumentList[0] = this.baseType!.argumentForAndOverload(this.origin, this.base);
        if (this.callForSet)
            this.callForSet.argumentList[0] = this.base;
    }
    
    emitGet(base: Value)
    {
        let result = readInstance(this.visit(new Rewriter()), PropertyAccessExpression);
        result.base = base;
        result.updateCalls();
        return result.rewriteAfterCloning();
    }
    
    emitSet(base: Value, value: Value)
    {
        let result = readInstance(this.visit(new Rewriter()), PropertyAccessExpression);
        if (!result.callForSet)
            throw new WTypeError(this.origin.originString, "Cannot emit set because: " + this.errorForSet!.typeErrorMessage);
        result.base = base;
        result.updateCalls();
        result.callForSet.argumentList[result.callForSet.argumentList.length - 1] = value;
        return result.callForSet;
    }
}



// Upstream source: ./WSL/AddressSpace.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

const addressSpaces = ["constant", "device", "threadgroup", "thread"];

function isAddressSpace(addressSpace: string)
{
    switch (addressSpace) {
    case "constant":
    case "device":
    case "threadgroup":
    case "thread":
        return true;
    default:
        return false;
    }
}

function validateAddressSpace(addressSpace: string)
{
    if (!isAddressSpace(addressSpace))
        throw new Error("Bad address space: " + addressSpace);
}


// Upstream source: ./WSL/AnonymousVariable.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let anonymousVariableCount = 0;

class AnonymousVariable extends Value {
    declare index: number;

    declare _index: number;
    declare _origin: Origin;
    declare type: Type | null;

    // You have to initialize the variable's value before use, but that could be quite late.
    constructor(origin: Origin, type: Type | null = null)
    {
        super();
        this._origin = origin;
        this.index = anonymousVariableCount++;
        this.type = type;
    }
    
    get origin() { return this._origin; }
    get name() { return "anonVar<" + this.index + ">"; }
    
    toString()
    {
        return this.name;
    }
}



// Upstream source: ./WSL/ArrayRefType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// Note that we say that T[] is "the same type" as T[c] for any T, c. This greatly simplifies the
// language.
class ArrayRefType extends ReferenceType {
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (!readProperty(other, "isArrayRef"))
            return false;
        if (!(other instanceof ArrayRefType)) throw new TypeError("Expected WSL array reference type");
        
        if (this.addressSpace != other.addressSpace)
            return false;
        
        return this.elementType.unify(unificationContext, other.elementType);
    }
    
    get isArrayRef() { return true; }

    argumentForAndOverload(origin: Origin, value: Value): Value
    {
        return value;
    }
    argumentTypeForAndOverload(origin: Origin)
    {
        return this;
    }

    toString()
    {
        return this.elementType + "[] " + this.addressSpace;
    }
}



// Upstream source: ./WSL/ArrayType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ArrayType extends Type {
    declare _numElements: Value;

    declare _origin: Origin;
    declare _elementType: Type;

    constructor(origin: Origin, elementType: Type, numElements: Value)
    {
        if (!numElements)
            throw new Error("null numElements");
        super();
        this._origin = origin;
        this._elementType = elementType;
        this._numElements = numElements;
    }
    
    get origin() { return this._origin; }
    get elementType() { return this._elementType; }
    get numElements() { return this._numElements; }
    get isPrimitive(): boolean | number | null | undefined { return this.elementType.isPrimitive; }
    get isArray() { return true; }
    
    get numElementsValue()
    {
        if (!(this.numElements.isLiteral))
            throw new Error("numElements is not a literal: " + this.numElements);
        return readNumber(readProperty(this.numElements, "value"));
    }

    toString()
    {
        return this.elementType + "[" + this.numElements + "]";
    }
    
    get size(): number
    {
        return this.elementType.size * this.numElementsValue;
    }
    
    populateDefaultValue(buffer: EBuffer, offset: number): void
    {
        for (let i = 0; i < this.numElementsValue; ++i)
            this.elementType.populateDefaultValue(buffer, offset + i * this.elementType.size);
    }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (!(other instanceof ArrayType))
            return false;
        
        if (!this.numElements.unify(unificationContext, other.numElements))
            return false;
        
        return this.elementType.unify(unificationContext, other.elementType);
    }

    argumentForAndOverload(origin: Origin, value: Value): Value
    {
        let result = new MakeArrayRefExpression(origin, value);
        result.numElements = this.numElements;
        return result;
    }
    argumentTypeForAndOverload(origin: Origin)
    {
        return new ArrayRefType(origin, "thread", this.elementType);
    }
}



// Upstream source: ./WSL/Assignment.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Assignment extends Expression {
    declare _lhs: Value;
    declare _rhs: Value;

    declare type: Type | null;

    constructor(origin: Origin, lhs: Value, rhs: Value, type: Type | null = null)
    {
        super(origin);
        this._lhs = lhs;
        this._rhs = rhs;
        this.type = type;
    }
    
    get lhs() { return this._lhs; }
    get rhs() { return this._rhs; }
    
    toString()
    {
        return this.lhs + " = " + this.rhs;
    }
};



// Upstream source: ./WSL/AutoWrapper.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class AutoWrapper extends Rewriter {
    visitVariableRef(node: VariableRef)
    {
        return node;
    }
    
    visitTypeRef(node: TypeRef)
    {
        return node;
    }
    
    visitConstexprTypeParameter(node: ConstexprTypeParameter)
    {
        return VariableRef.wrap(node);
    }
    
    visitFuncParameter(node: FuncParameter)
    {
        return VariableRef.wrap(node);
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        return VariableRef.wrap(node);
    }
    
    visitStructType(node: StructType)
    {
        return TypeRef.wrap(node);
    }
    
    visitNativeType(node: NativeType)
    {
        return TypeRef.wrap(node);
    }
    
    visitTypeVariable(node: TypeVariable)
    {
        return TypeRef.wrap(readInstance(node, Type));
    }
    
    visitGenericLiteralType(node: GenericLiteralType)
    {
        return node;
    }

    visitNullType(node: NullType)
    {
        return node;
    }
}


// Upstream source: ./WSL/Block.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Block extends Node {
    declare _origin: Origin;
    declare _statements: Node[];

    constructor(origin: Origin)
    {
        super();
        this._origin = origin;
        this._statements = [];
    }
    
    get origin() { return this._origin; }
    
    add(statement: Node)
    {
        this._statements.push(statement);
    }
    
    get statements() { return this._statements; }
    
    toString()
    {
        if (!this.statements.length)
            return "{ }";
        return "{ " + this.statements.join("; ") + "; }";
    }
};



// Upstream source: ./WSL/BoolLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class BoolLiteral extends Expression {
    declare type: TypeRef;

    declare _value: boolean;

    constructor(origin: Origin, value: boolean)
    {
        super(origin);
        this._value = value;
    }
    
    get value() { return this._value; }
    get isConstexpr() { return true; }
    
    toString()
    {
        return "" + this._value;
    }
}



// Upstream source: ./WSL/Break.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Break extends Node {
    declare _origin: Origin;

    constructor(origin: Origin)
    {
        super();
        this._origin = origin;
    }
    
    get origin() { return this._origin; }
    
    toString()
    {
        return "break";
    }
};



// Upstream source: ./WSL/CallExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class CallExpression extends Expression {
    declare actualTypeArguments: Node[] | null;
    declare instantiatedActualTypeArguments: Node[] | null;
    declare nativeFuncInstance: NativeFuncInstance;
    declare resultType: Type | undefined;
    declare resultEPtr: EPtr;

    declare argumentTypes: Type[];
    declare func: Func | null;
    declare possibleOverloads: Func[] | null | undefined;
    declare _name: string;
    declare _typeArguments: Node[];
    declare _argumentList: (Value | null)[];
    declare _isCast: boolean;
    declare _returnType: Type | null;

    constructor(origin: Origin, name: string, typeArguments: Node[], argumentList: (Value | null)[])
    {
        super(origin);
        this._name = name;
        this._typeArguments = typeArguments;
        this._argumentList = argumentList;
        this.func = null;
        this._isCast = false;
        this._returnType = null;
    }
    
    get name() { return this._name; }
    get typeArguments() { return this._typeArguments; }
    get argumentList() { return this._argumentList; }
    get isCast() { return this._isCast; }
    get returnType() { return this._returnType; }
    
    static resolve(origin: Origin, possibleOverloads: Func[] | null | undefined, typeParametersInScope: Node[], name: string, typeArguments: Node[], argumentList: (Value | null)[], argumentTypes: Type[], returnType: Type | null)
    {
        let call = new CallExpression(origin, name, typeArguments, argumentList);
        call.argumentTypes = readInstances(argumentTypes.map((argument: Node) => argument.visit(new AutoWrapper())), Type);
        call.possibleOverloads = possibleOverloads;
        if (returnType)
            call.setCastData(returnType);
        return {call, resultType: call.resolve(possibleOverloads, typeParametersInScope, typeArguments)};
    }
    
    resolve(possibleOverloads: Func[] | null | undefined, typeParametersInScope: Node[], typeArguments: (Node | WTypeError | undefined)[])
    {
        if (!possibleOverloads)
            throw new WTypeError(this.origin.originString, "Did not find any functions named " + this.name);
        
        let overload = null;
        let failures = [];
        for (let typeParameter of typeParametersInScope) {
            if (!(typeParameter instanceof TypeVariable))
                continue;
            if (!typeParameter.protocol)
                continue;
            let signatures =
                typeParameter.protocol.protocolDecl!.signaturesByNameWithTypeVariable(this.name, typeParameter);
            if (!signatures)
                continue;
            overload = resolveOverloadImpl(readInstances(signatures, Func), this.typeArguments, this.argumentTypes, this.returnType);
            if (overload.func)
                break;
            failures.push(...overload.failures!);
            overload = null;
        }
        if (!overload) {
            overload = resolveOverloadImpl(
                possibleOverloads, this.typeArguments, this.argumentTypes, this.returnType);
            if (!overload.func) {
                failures.push(...overload.failures!);
                let message = "Did not find function named " + this.name + " for call with ";
                if (this.typeArguments.length)
                    message += "type arguments <" + this.typeArguments + "> and ";
                message += "argument types (" + this.argumentTypes + ")";
                if (this.returnType)
                    message +=" and return type " + this.returnType;
                if (failures.length)
                    message += ", but considered:\n" + failures.join("\n")
                throw new WTypeError(this.origin.originString, message);
            }
        }
        for (let i = 0; i < typeArguments.length; ++i) {
            let typeArgumentType = typeArguments[i];
            let typeParameter = overload.func!.typeParameters[i];
            if (!(typeParameter instanceof ConstexprTypeParameter))
                continue;
            if (!typeParameter.type.equalsWithCommit(readInstance(typeArgumentType, Type)))
                throw new Error("At " + this.origin.originString + " constexpr type argument and parameter types not equal: argument = " + typeArgumentType + ", parameter = " + typeParameter.type);
        }
        for (let i = 0; i < this.argumentTypes.length; ++i) {
            let argumentType = this.argumentTypes[i];
            let parameterType = overload.func!.parameters[i].type.substituteToUnification(
                overload.func!.typeParameters, readInstance(overload.unificationContext, UnificationContext));
            let result = argumentType.equalsWithCommit(parameterType);
            if (!result)
                throw new Error("At " + this.origin.originString + " argument and parameter types not equal after type argument substitution: argument = " + argumentType + ", parameter = " + parameterType);
        }
        return this.resolveToOverload(overload);
    }
    
    resolveToOverload(overload: OverloadResult)
    {
        this.func = overload.func!;
        this.actualTypeArguments = overload.typeArguments!.map((typeArgument) => typeArgument instanceof Type ? typeArgument.visit(new AutoWrapper()) : typeArgument);
        this.instantiatedActualTypeArguments = this.actualTypeArguments;
        let result = overload.func!.returnType.substituteToUnification(
            overload.func!.typeParameters, readInstance(overload.unificationContext, UnificationContext));
        if (!result)
            throw new Error("Null return type");
        result = result.visit(new AutoWrapper());
        this.resultType = readOptionalInstance(result, Type);
        return result;
    }
    
    becomeCast(returnType: Type)
    {
        this._returnType = new TypeRef(this.origin, this.name, this._typeArguments);
        readInstance(this._returnType, TypeRef).type = returnType;
        this._name = "operator cast";
        this._isCast = true;
        this._typeArguments = [];
    }
    
    setCastData(returnType: Type)
    {
        this._returnType = returnType;
        this._isCast = true;
    }
    
    toString()
    {
        return (this.isCast ? "operator " + this.returnType : this.name) +
            "<" + this.typeArguments + ">" +
            (this.actualTypeArguments ? "<<" + this.actualTypeArguments + ">>" : "") +
            "(" + this.argumentList + ")";
    }
}



// Upstream source: ./WSL/CallFunction.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This allows you to pass structs and arrays in-place, but it's a more annoying API.
function callFunction(program: Program, name: string, typeArguments: Node[], argumentList: TypedValue[])
{
    let argumentTypes = argumentList.map((argument: TypedValue) => argument.type);
    let funcOrFailures = resolveInlinedFunction(program, name, typeArguments, argumentTypes, true);
    if (!(funcOrFailures instanceof Func)) {
        let failures = funcOrFailures;
        throw new WTypeError("<callFunction>", "Cannot resolve function call " + name + "<" + typeArguments + ">(" + argumentList + ")" + (failures!.length ? "; tried:\n" + failures!.join("\n") : ""));
    }
    let func = funcOrFailures;
    for (let i = 0; i < func.parameters.length; ++i) {
        let type = argumentTypes[i].instantiatedType;
        type.visit(new StructLayoutBuilder());
        func.parameters[i].ePtr.copyFrom(argumentList[i].ePtr, type.size);
    }
    let result = new Evaluator(program).runFunc(readInstance(func, FuncDef));
    return new TypedValue(readInstance(func.uninstantiatedReturnType, Type), result);
}



// Upstream source: ./WSL/Check.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function check(program: Program)
{
    program.visit(new Checker(program));
}



// Upstream source: ./WSL/CheckLiteralTypes.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkLiteralTypes(program: Program)
{
    program.visit(new LiteralTypeChecker());
}


// Upstream source: ./WSL/CheckLoops.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkLoops(program: Program)
{
    program.visit(new LoopChecker());
}



// Upstream source: ./WSL/CheckRecursiveTypes.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkRecursiveTypes(program: Program)
{
    program.visit(new RecursiveTypeChecker());
}


// Upstream source: ./WSL/CheckRecursion.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkRecursion(program: Program)
{
    program.visit(new RecursionChecker(program));
}



// Upstream source: ./WSL/CheckReturns.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkReturns(program: Program)
{
    program.visit(new ReturnChecker(program));
}



// Upstream source: ./WSL/CheckUnreachableCode.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkUnreachableCode(program: Program)
{
    program.visit(new UnreachableCodeChecker(program));
}



// Upstream source: ./WSL/CheckWrapped.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function checkExpressionWrapped(node: Node)
{
    node.visit(new WrapChecker(node));
}

function checkProgramWrapped(node: Node)
{
    node.visit(new ExpressionFinder(checkExpressionWrapped));
}



// Upstream source: ./WSL/Checker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Checker extends Visitor {
    declare _vertexEntryPoints: Set<string>;
    declare _fragmentEntryPoints: Set<string>;

    declare _program: Program;
    declare _currentStatement: Node | null;

    constructor(program: Program)
    {
        super();
        this._program = program;
        this._currentStatement = null;
        this._vertexEntryPoints = new Set();
        this._fragmentEntryPoints = new Set();
    }
    
    visitProgram(node: Program)
    {
        let doStatement = (statement: Node) => {
            this._currentStatement = statement;
            statement.visit(this);
        }
        
        for (let type of node.types.values())
            doStatement(type);
        for (let protocol of node.protocols.values())
            doStatement(protocol);
        for (let funcs of node.functions.values()) {
            for (let func of funcs) {
                this.visitFunc(func);
            }
        }
        for (let funcs of node.functions.values()) {
            for (let func of funcs)
                doStatement(func);
        }
    }

    _checkShaderType(node: Func)
    {
        // FIXME: Relax these checks once we have implemented support for textures and samplers.
        if (node.typeParameters.length != 0)
            throw new WTypeError(node.origin.originString, "Entry point " + node.name + " must not have type arguments.");
        let shaderFunc = node;
        switch (node.shaderType) {
        case "vertex":
            if (this._vertexEntryPoints.has(node.name))
                throw new WTypeError(node.origin.originString, "Duplicate vertex entry point name " + node.name);
            this._vertexEntryPoints.add(node.name);
            break;
        case "fragment":
            if (this._fragmentEntryPoints.has(node.name))
                throw new WTypeError(node.origin.originString, "Duplicate fragment entry point name " + node.name);
            this._fragmentEntryPoints.add(node.name);
            break;
        }
    }

    _checkOperatorOverload(func: Func, resolveFuncs: (name:string)=>Func[] | undefined)
    {
        if (Lexer.textIsIdentifier(func.name))
            return; // Not operator!

        if (!func.name.startsWith("operator"))
            throw new Error("Bad operator overload name: " + func.name);
        
        let typeVariableTracker = new TypeVariableTracker();
        for (let parameterType of func.parameterTypes)
            parameterType.visit(typeVariableTracker);
        Node.visit(func.returnTypeForOverloadResolution, typeVariableTracker);
        for (let typeParameter of func.typeParameters) {
            if (!typeVariableTracker.set.has(typeParameter))
                throw new WTypeError(typeParameter.origin!.originString, "Type parameter " + typeParameter + " to operator " + func.toDeclString() + " is not inferrable from value parameters");
        }
        
        let checkGetter = (kind: string) => {
            let numExpectedParameters = kind == "index" ? 2 : 1;
            if (func.parameters.length != numExpectedParameters)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected " + numExpectedParameters + ", got " + func.parameters.length + ")");
            if (func.parameterTypes[0].unifyNode.isPtr)
                throw new WTypeError(func.origin.originString, "Cannot have getter for pointer type: " + func.parameterTypes[0]);
        };
        
        let checkSetter = (kind: string) => {
            let numExpectedParameters = kind == "index" ? 3 : 2;
            if (func.parameters.length != numExpectedParameters)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected " + numExpectedParameters + ", got " + func.parameters.length + ")");
            if (func.parameterTypes[0].unifyNode.isPtr)
                throw new WTypeError(func.origin.originString, "Cannot have setter for pointer type: " + func.parameterTypes[0]);
            if (!func.returnType.equals(func.parameterTypes[0]))
                throw new WTypeError(func.origin.originString, "First parameter type and return type of setter must match (parameter was " + func.parameterTypes[0] + " but return was " + func.returnType + ")");
            let valueType = func.parameterTypes[numExpectedParameters - 1];
            let getterName = func.name.substr(0, func.name.length - 1);
            let getterFuncs = resolveFuncs(getterName);
            if (!getterFuncs)
                throw new WTypeError(func.origin.originString, "Every setter must have a matching getter, but did not find any function named " + getterName + " to match " + func.name);
            let argumentTypes = func.parameterTypes.slice(0, numExpectedParameters - 1);
            let overload = resolveOverloadImpl(getterFuncs, [], argumentTypes, null);
            if (!overload.func)
                throw new WTypeError(func.origin.originString, "Did not find function named " + func.name + " with arguments " + argumentTypes + (overload.failures!.length ? "; tried:\n" + overload.failures!.join("\n") : ""));
            let resultType = overload.func.returnType.substituteToUnification(
                overload.func.typeParameters, readInstance(overload.unificationContext, UnificationContext));
            if (!resultType.equals(valueType))
                throw new WTypeError(func.origin.originString, "Setter and getter must agree on value type (getter at " + overload.func.origin.originString + " says " + resultType + " while this setter says " + valueType + ")");
        };
        
        let checkAnder = (kind: string) => {
            let numExpectedParameters = kind == "index" ? 2 : 1;
            if (func.parameters.length != numExpectedParameters)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected " + numExpectedParameters + ", got " + func.parameters.length + ")");
            if (!func.returnType.unifyNode.isPtr)
                throw new WTypeError(func.origin.originString, "Return type of ander is not a pointer: " + func.returnType);
            if (!func.parameterTypes[0].unifyNode.isRef)
                throw new WTypeError(func.origin.originString, "Parameter to ander is not a reference: " + func.parameterTypes[0]);
        };
        
        switch (func.name) {
        case "operator cast":
            break;
        case "operator++":
        case "operator--":
            if (func.parameters.length != 1)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected 1, got " + func.parameters.length + ")");
            if (!func.parameterTypes[0].equals(func.returnType))
                throw new WTypeError(func.origin.originString, "Parameter type and return type must match for " + func.name + " (parameter is " + func.parameterTypes[0] + " while return is " + func.returnType + ")");
            break;
        case "operator+":
        case "operator-":
            if (func.parameters.length != 1 && func.parameters.length != 2)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected 1 or 2, got " + func.parameters.length + ")");
            break;
        case "operator*":
        case "operator/":
        case "operator%":
        case "operator&":
        case "operator|":
        case "operator^":
        case "operator<<":
        case "operator>>":
            if (func.parameters.length != 2)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected 2, got " + func.parameters.length + ")");
            break;
        case "operator~":
            if (func.parameters.length != 1)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected 1, got " + func.parameters.length + ")");
            break;
        case "operator==":
        case "operator<":
        case "operator<=":
        case "operator>":
        case "operator>=":
            if (func.parameters.length != 2)
                throw new WTypeError(func.origin.originString, "Incorrect number of parameters for " + func.name + " (expected 2, got " + func.parameters.length + ")");
            if (!func.returnType.equals(this._program.intrinsics.bool))
                throw new WTypeError(func.origin.originString, "Return type of " + func.name + " must be bool but was " + func.returnType);
            break;
        case "operator[]":
            checkGetter("index");
            break;
        case "operator[]=":
            checkSetter("index");
            break;
        case "operator&[]":
            checkAnder("index");
            break;
        default:
            if (func.name.startsWith("operator.")) {
                if (func.name.endsWith("="))
                    checkSetter("dot");
                else
                    checkGetter("dot");
                break;
            }
            if (func.name.startsWith("operator&.")) {
                checkAnder("dot");
                break;
            }
            throw new Error("Parser accepted unrecognized operator: " + func.name);
        }
    }
    
    visitFuncDef(node: FuncDef)
    {
        if (node.shaderType)
            this._checkShaderType(node);
        this._checkOperatorOverload(node, (name: string) => this._program.functions.get(name));
        node.body.visit(this);
    }
    
    visitNativeFunc(node: NativeFunc)
    {
    }
    
    visitProtocolDecl(node: ProtocolDecl)
    {
        for (let signature of node.signatures) {
            let typeVariableTracker = new TypeVariableTracker();
            for (let parameterType of signature.parameterTypes)
                parameterType.visit(typeVariableTracker);
            Node.visit(signature.returnTypeForOverloadResolution, typeVariableTracker);
            for (let typeParameter of signature.typeParameters) {
                if (!typeVariableTracker.set.has(typeParameter))
                    throw callLegacy(WTypeError, typeParameter.origin!.originString, "Type parameter to protocol signature not inferrable from value parameters");
            }
            if (!typeVariableTracker.set.has(node.typeVariable))
                throw new WTypeError(signature.origin.originString, "Protocol's type variable (" + node.name + ") not mentioned in signature: " + signature);
            this._checkOperatorOverload(signature, (name: string) => node.signaturesByName(name));
        }
    }
    
    visitEnumType(node: EnumType)
    {
        node.baseType.visit(this);
        
        let baseType = node.baseType.unifyNode;
        
        if (!baseType.isInt)
            throw new WTypeError(node.origin.originString, "Base type of enum is not an integer: " + node.baseType);
        
        for (let member of node.members) {
            if (!member.value)
                continue;
            
            let memberType = member.value.visit(this);
            if (!baseType.equalsWithCommit(readInstance(memberType, Node)))
                throw new WTypeError(member.origin.originString, "Type of enum member " + member.value.name + " does not patch enum base type (member type is " + memberType + ", enum base type is " + node.baseType + ")");
        }
        
        let nextValue = baseType.defaultValue;
        for (let member of node.members) {
            if (member.value) {
                nextValue = baseType.successorValue!(readNumber(member.value.unifyNode.valueForSelectedType));
                continue;
            }
            
            member.value = baseType.createLiteral!(member.origin, nextValue);
            nextValue = baseType.successorValue!(readNumber(nextValue));
        }
        
        let memberArray = Array.from(node.members);
        for (let i = 0; i < memberArray.length; ++i) {
            let member = memberArray[i];
            for (let j = i + 1; j < memberArray.length; ++j) {
                let otherMember = memberArray[j];
                if (baseType.valuesEqual!(member.value!.unifyNode.valueForSelectedType, otherMember.value!.unifyNode.valueForSelectedType))
                    throw new WTypeError(otherMember.origin.originString, "Duplicate enum member value (" + member.name + " has " + member.value + " while " + otherMember.name + " has " + otherMember.value + ")");
            }
        }
        
        let foundZero = false;
        for (let member of node.members) {
            if (baseType.valuesEqual!(member.value!.unifyNode.valueForSelectedType, baseType.defaultValue)) {
                foundZero = true;
                break;
            }
        }
        if (!foundZero)
            throw new WTypeError(node.origin.originString, "Enum does not have a member with the value zero");
    }
    
    _checkTypeArguments(origin: Origin, typeParameters: Node[], typeArguments: Node[])
    {
        for (let i = 0; i < typeParameters.length; ++i) {
            let argumentIsType = typeArguments[i] instanceof Type;
            let result = typeArguments[i].visit(this);
            if (argumentIsType) {
                let result = readInstance(typeArguments[i], Type).inherits(readInstance(typeParameters[i], TypeVariable).protocol);
                if (!result.result)
                    throw new WTypeError(origin.originString, "Type argument does not inherit protocol: " + result.reason);
            } else {
                if (!readInstance(result, Type).equalsWithCommit(readInstance(typeParameters[i], ConstexprTypeParameter).type))
                    throw new WTypeError(origin.originString, "Wrong type for constexpr");
            }
        }
    }
    
    visitTypeRef(node: TypeRef)
    {
        if (!node.type)
            throw new Error("Type reference without a type in checker: " + node + " at " + node.origin);
        if (!(node.type instanceof StructType))
            node.type.visit(this);
        this._checkTypeArguments(node.origin, node.type.typeParameters, node.typeArguments);
    }
    
    visitArrayType(node: ArrayType)
    {
        node.elementType.visit(this);
        
        if (!node.numElements.isConstexpr)
            throw new WTypeError(node.origin.originString, "Array length must be constexpr");
        
        let type = node.numElements.visit(this);
        
        if (!readInstance(type, Type).equalsWithCommit(this._program.intrinsics.uint32))
            throw new WTypeError(node.origin.originString, "Array length must be a uint32");
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        node.type.visit(this);
        if (node.initializer) {
            let lhsType = node.type;
            let rhsType = node.initializer.visit(this);
            if (!readInstance(lhsType, Type).equalsWithCommit(readInstance(rhsType, Node)))
                throw new WTypeError(node.origin.originString, "Type mismatch in variable initialization: " + lhsType + " versus " + rhsType);
        }
    }
    
    visitAssignment(node: Assignment)
    {
        let lhsType = node.lhs.visit(this);
        if (!node.lhs.isLValue)
            throw new WTypeError(node.origin.originString, "LHS of assignment is not an LValue: " + node.lhs + node.lhs.notLValueReasonString);
        let rhsType = node.rhs.visit(this);
        if (!readInstance(lhsType, Type).equalsWithCommit(readInstance(rhsType, Type)))
            throw new WTypeError(node.origin.originString, "Type mismatch in assignment: " + lhsType + " versus " + rhsType);
        node.type = readInstance(lhsType, Type);
        return lhsType;
    }
    
    visitIdentityExpression(node: IdentityExpression)
    {
        return node.target.visit(this);
    }
    
    visitReadModifyWriteExpression(node: ReadModifyWriteExpression)
    {
        let lhsType = node.lValue.visit(this);
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "LHS of read-modify-write is not an LValue: " + node.lValue + node.lValue.notLValueReasonString);
        node.oldValueVar.type = readInstance(lhsType, Type);
        node.newValueVar.type = readInstance(lhsType, Type);
        node.oldValueVar.visit(this);
        node.newValueVar.visit(this);
        let newValueType = node.newValueExp!.visit(this);
        if (!readInstance(lhsType, Type).equalsWithCommit(readInstance(newValueType, Type)))
            return new WTypeError(node.origin.originString, "Type mismatch in read-modify-write: " + lhsType + " versus " + newValueType);
        return node.resultExp!.visit(this);
    }
    
    visitAnonymousVariable(node: AnonymousVariable)
    {
        if (!node.type)
            throw new Error("Anonymous variable must know type before first appearance");
    }
    
    visitDereferenceExpression(node: DereferenceExpression)
    {
        let type = readInstance(node.ptr.visit(this), Type).unifyNode;
        if (!type.isPtr)
            throw new WTypeError(node.origin.originString, "Type passed to dereference is not a pointer: " + type);
        node.type = readInstance(type.elementType, Type);
        node.addressSpace = type.addressSpace!;
        if (!node.addressSpace)
            throw new Error("Null address space in type: " + type);
        return node.type;
    }
    
    visitMakePtrExpression(node: MakePtrExpression)
    {
        let elementType = readInstance(node.lValue.visit(this), Type).unifyNode;
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "Operand to & is not an LValue: " + node.lValue + node.lValue.notLValueReasonString);
        
        return new PtrType(node.origin, node.lValue.addressSpace!, elementType);
    }
    
    visitMakeArrayRefExpression(node: MakeArrayRefExpression)
    {
        let elementType = readInstance(node.lValue.visit(this), Type).unifyNode;
        if (elementType.isPtr) {
            node.become(new ConvertPtrToArrayRefExpression(node.origin, node.lValue));
            return new ArrayRefType(node.origin, elementType.addressSpace!, elementType.elementType!);
        }
        
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "Operand to @ is not an LValue: " + node.lValue + node.lValue.notLValueReasonString);
        
        if (elementType.isArray) {
            node.numElements = readInstance(elementType, ArrayType).numElements;
            elementType = readInstance(elementType.elementType, Type);
        } else
            node.numElements = UintLiteral.withType(node.origin, 1, this._program.intrinsics.uint32);
            
        return new ArrayRefType(node.origin, node.lValue.addressSpace!, elementType);
    }
    
    visitConvertToArrayRefExpression(node: ConvertPtrToArrayRefExpression)
    {
        throw new Error("Should not exist yet.");
    }
    
    _finishVisitingPropertyAccess(node: PropertyAccessExpression, baseType: Type, extraArgs: Value[], extraArgTypes: Type[])
    {
        baseType = readInstance(baseType.visit(new AutoWrapper()), Type)
        node.baseType = baseType;
        
        // Such a type must exist. This may throw if it doesn't.
        let typeForAnd = baseType.argumentTypeForAndOverload(node.origin);
        if (!typeForAnd)
            throw new Error("Cannot get typeForAnd");
        
        let errorForGet;
        let errorForAnd;
        
        try {
            let result = CallExpression.resolve(
                node.origin, node.possibleGetOverloads, readInstances(this._currentStatement!.typeParameters, Node),
                node.getFuncName, [], [node.base, ...extraArgs], [baseType, ...extraArgTypes], null);
            node.callForGet = result.call;
            node.resultTypeForGet = readOptionalInstance(result.resultType, Type);
        } catch (e) {
            if (!(e instanceof WTypeError))
                throw e;
            errorForGet = e;
        }
        
        try {
            let baseForAnd = baseType.argumentForAndOverload(node.origin, node.base);
            
            let result = CallExpression.resolve(
                node.origin, node.possibleAndOverloads, readInstances(this._currentStatement!.typeParameters, Node),
                node.andFuncName, [], [baseForAnd, ...extraArgs], [typeForAnd, ...extraArgTypes],
                null);
            node.callForAnd = result.call;
            node.resultTypeForAnd = readInstance(result.resultType, Type).unifyNode.returnTypeFromAndOverload(node.origin);
        } catch (e) {
            if (!(e instanceof WTypeError))
                throw e;
            errorForAnd = e;
        }
        
        if (!node.resultTypeForGet && !node.resultTypeForAnd) {
            throw new WTypeError(
                node.origin.originString,
                "Cannot resolve access; tried by-value:\n" +
                errorForGet!.typeErrorMessage + "\n" +
                "and tried by-pointer:\n" +
                errorForAnd!.typeErrorMessage);
        }
        
        if (node.resultTypeForGet && node.resultTypeForAnd
            && !node.resultTypeForGet.equals(node.resultTypeForAnd))
            throw new WTypeError(node.origin.originString, "Result type resolved by-value (" + node.resultTypeForGet + ") does not match result type resolved by-pointer (" + node.resultTypeForAnd + ")");
        
        try {
            let result = CallExpression.resolve(
                node.origin, node.possibleSetOverloads, readInstances(this._currentStatement!.typeParameters, Node),
                node.setFuncName, [], [node.base, ...extraArgs, null], [baseType, ...extraArgTypes, node.resultType!], null);
            node.callForSet = result.call;
            if (!result.resultType.equals(baseType))
                throw new WTypeError(node.origin.originString, "Result type of setter " + result.call.func + " is not the base type " + baseType);
        } catch (e) {
            if (!(e instanceof WTypeError))
                throw e;
            node.errorForSet = e;
        }
        
        // OK, now we need to determine if we are an lvalue. We are an lvalue if we can be assigned to. We can
        // be assigned to if we have an ander or setter. But it's weirder than that. We also need the base to be
        // an lvalue, except unless the base is an array reference.
        if (!node.callForAnd && !node.callForSet) {
            node.isLValue = false;
            node.notLValueReason =
                "Have neither ander nor setter. Tried setter:\n" +
                node.errorForSet!.typeErrorMessage + "\n" +
                "and tried ander:\n" +
                errorForAnd!.typeErrorMessage;
        } else if (!node.base.isLValue && !baseType.isArrayRef) {
            node.isLValue = false;
            node.notLValueReason = "Base of property access is neither a lvalue nor an array reference";
        } else {
            node.isLValue = true;
            node.addressSpace = node.base.isLValue ? node.base.addressSpace : baseType.addressSpace;
        }
        
        return node.resultType;
    }
    
    visitDotExpression(node: DotExpression)
    {
        let structType = readInstance(node.struct.visit(this), Type).unifyNode;
        return this._finishVisitingPropertyAccess(node, structType, [], []);
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        let arrayType = readInstance(node.array.visit(this), Type).unifyNode;
        let indexType = node.index.visit(this);
        
        return this._finishVisitingPropertyAccess(node, arrayType, [node.index], [readInstance(indexType, Type)]);
    }
    
    visitVariableRef(node: VariableRef)
    {
        if (!node.variable!.type)
            throw new Error("Variable has no type: " + node.variable);
        return node.variable!.type;
    }
    
    visitReturn(node: Return)
    {
        if (node.value) {
            let resultType = node.value.visit(this);
            if (!resultType)
                throw new Error("Null result type from " + node.value);
            if (!node.func.returnType.equalsWithCommit(readInstance(resultType, Node)))
                throw new WTypeError(node.origin.originString, "Trying to return " + resultType + " in a function that returns " + node.func.returnType);
            return;
        }
        
        if (!node.func.returnType.equalsWithCommit(this._program.intrinsics.void))
            throw new WTypeError(node.origin.originString, "Non-void function must return a value");
    }
    
    visitGenericLiteral(node: GenericLiteral)
    {
        return node.type;
    }
    
    visitNullLiteral(node: NullLiteral)
    {
        return node.type;
    }
    
    visitBoolLiteral(node: BoolLiteral)
    {
        return this._program.intrinsics.bool;
    }
    
    visitEnumLiteral(node: EnumLiteral)
    {
        return node.member.enumType;
    }

    _requireBool(expression: Value)
    {
        let type = expression.visit(this);
        if (!type)
            throw new Error("Expression has no type, but should be bool: " + expression);
        if (!readInstance(type, Type).equals(this._program.intrinsics.bool))
            throw new WTypeError("Expression isn't a bool: " + expression);
    }

    visitLogicalNot(node: LogicalNot)
    {
        this._requireBool(node.operand);
        return this._program.intrinsics.bool;
    }

    visitLogicalExpression(node: LogicalExpression)
    {
        this._requireBool(node.left);
        this._requireBool(node.right);
        return this._program.intrinsics.bool;
    }

    visitIfStatement(node: IfStatement)
    {
        this._requireBool(node.conditional);
        node.body!.visit(this);
        if (node.elseBody)
            node.elseBody.visit(this);
    }

    visitWhileLoop(node: WhileLoop)
    {
        this._requireBool(node.conditional);
        node.body!.visit(this);
    }

    visitDoWhileLoop(node: DoWhileLoop)
    {
        node.body!.visit(this);
        this._requireBool(node.conditional);
    }

    visitForLoop(node: ForLoop)
    {
        if (node.initialization)
            node.initialization.visit(this);
        if (node.condition)
            this._requireBool(node.condition);
        if (node.increment)
            node.increment.visit(this);
        node.body!.visit(this);
    }

    visitSwitchStatement(node: SwitchStatement)
    {
        let type = readInstance(readInstance(node.value.visit(this), Type).commit(), Type);
        
        if (!type.unifyNode.isInt && !(type.unifyNode instanceof EnumType))
            throw new WTypeError(node.origin.originString, "Cannot switch on non-integer/non-enum type: " + type);

        node.type = type;
        
        let hasDefault = false;
        
        for (let switchCase of node.switchCases) {
            switchCase.body.visit(this);

            if (switchCase.isDefault) {
                hasDefault = true;
                continue;
            }
            
            if (!switchCase.value!.isConstexpr)
                throw new WTypeError(switchCase.origin.originString, "Switch case not constexpr: " + switchCase.value);
            
            let caseType = switchCase.value!.visit(this);
            if (!readInstance(type, Type).equalsWithCommit(readInstance(caseType, Node)))
                throw new WTypeError(switchCase.origin.originString, "Switch case type does not match switch value type (case type is " + caseType + " but switch value type is " + type + ")");
        }
        
        for (let i = 0; i < node.switchCases.length; ++i) {
            let firstCase = node.switchCases[i];
            for (let j = i + 1; j < node.switchCases.length; ++j) {
                let secondCase = node.switchCases[j];
                
                if (firstCase.isDefault != secondCase.isDefault)
                    continue;
                
                if (firstCase.isDefault)
                    throw new WTypeError(secondCase.origin.originString, "Duplicate default case in switch statement");
                
                let valuesEqual = type.unifyNode.valuesEqual!(
                    firstCase.value!.unifyNode.valueForSelectedType,
                    secondCase.value!.unifyNode.valueForSelectedType);
                if (valuesEqual)
                    throw new WTypeError(secondCase.origin.originString, "Duplicate case in switch statement for value " + firstCase.value!.unifyNode.valueForSelectedType);
            }
        }
        
        if (!hasDefault) {
            let includedValues = new Set();
            for (let switchCase of node.switchCases)
                includedValues.add(switchCase.value!.unifyNode.valueForSelectedType);
            
            for (let {value, name} of type.unifyNode.allValues!()) {
                if (!includedValues.has(value))
                    throw new WTypeError(node.origin.originString, "Value not handled by switch statement: " + name);
            }
        }
    }
    
    visitCommaExpression(node: CommaExpression)
    {
        let result = null;
        for (let expression of node.list)
            result = expression.visit(this);
        return result;
    }
    
    visitCallExpression(node: CallExpression)
    {
        let typeArguments = node.typeArguments.map(typeArgument => typeArgument.visit(this));
        let argumentTypes = node.argumentList.map((argument: Value | null) => {
            let newArgument = argument!.visit(this);
            if (!newArgument)
                throw new Error("visitor returned null for " + argument);
            return readInstance(newArgument, Type).visit(new AutoWrapper());
        });
        
        node.argumentTypes = readInstances(argumentTypes, Type);
        if (node.returnType)
            node.returnType.visit(this);

        let result = node.resolve(node.possibleOverloads, readInstances(this._currentStatement!.typeParameters, Node), typeArguments);
        return result;
    }
}



// Upstream source: ./WSL/CloneProgram.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This is only currently used to clone programs just after parsing, so it doesn't really need to be
// able to handle all aspects of what Rewriter would need to do.

function cloneProgram(program: Program)
{
    let result = new Program();
    let cloner = new StatementCloner();
    for (let statement of program.topLevelStatements)
        result.add(statement.visit(cloner));
    return result;
}



// Upstream source: ./WSL/CommaExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class CommaExpression extends Expression {
    declare _list: Value[];

    constructor(origin: Origin, list: Value[])
    {
        super(origin);
        this._list = list;
        for (let expression of list) {
            if (!expression)
                throw new Error("null expression");
        }
    }
    
    get list() { return this._list; }
    
    // NOTE: It's super tempting to say that CommaExpression is an lValue if its last entry is an lValue. But,
    // PropertyResolver relies on this not being the case.
    
    toString()
    {
        return "(" + this.list.toString() + ")";
    }
}



// Upstream source: ./WSL/ConstexprFolder.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// NOTE: This doesn't let you negate constexpr variables. I think that's probably OK for now, but we should
// fix that eventually.
// https://bugs.webkit.org/show_bug.cgi?id=177121

class ConstexprFolder extends Visitor {
    visitCallExpression(node: CallExpression)
    {
        super.visitCallExpression(node);
        
        if (node.name == "operator-"
            && !node.typeArguments.length
            && node.argumentList.length == 1
            && node.argumentList[0]!.unifyNode.isConstexpr
            && node.argumentList[0]!.unifyNode.negConstexpr) {
            node.become(node.argumentList[0]!.unifyNode.negConstexpr(node.origin));
            return;
        }
    }
    
    visitTypeOrVariableRef(node: TypeOrVariableRef)
    {
    }
}



// Upstream source: ./WSL/ConstexprTypeParameter.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ConstexprTypeParameter extends Value {
    declare _origin: Origin;
    declare _name: string;
    declare _type: Type;

    constructor(origin: Origin, name: string, type: Type)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._type = type;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get type() { return this._type; }
    get isConstexpr() { return true; }
    get isUnifiable() { return true; }
    get varIsLValue() { return false; }
    
    typeVariableUnify(unificationContext: UnificationContext, other: Node)
    {
        if (!(other instanceof Value))
            return false;

        if (!this.type.unify(unificationContext, readInstance(readProperty(other, "type"), Type)))
            return false;
        
        return this._typeVariableUnifyImpl(unificationContext, other);
    }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        return this.typeVariableUnify(unificationContext, other);
    }
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        return {result: true};
    }
    
    verifyAsParameter(unificationContext: UnificationContext): Verification
    {
        return {result: true};
    }
    
    toString()
    {
        return this.type + " " + this.name;
    }
}



// Upstream source: ./WSL/Continue.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Continue extends Node {
    declare _origin: Origin;

    constructor(origin: Origin)
    {
        super();
        this._origin = origin;
    }
    
    get origin() { return this._origin; }
    
    toString()
    {
        return "Continue";
    }
};



// Upstream source: ./WSL/ConvertPtrToArrayRefExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ConvertPtrToArrayRefExpression extends Expression {
    declare _lValue: Value;

    constructor(origin: Origin, lValue: Value)
    {
        super(origin);
        this._lValue = lValue;
    }
    
    get lValue() { return this._lValue; }
    
    toString()
    {
        return "@(" + this.lValue + ")";
    }
}



// Upstream source: ./WSL/DereferenceExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class DereferenceExpression extends Expression {
    declare _ptr: Value;
    declare type: Type | null;
    declare addressSpace: string | null;

    constructor(origin: Origin, ptr: Value, type: Type | null = null, addressSpace: string | null = null)
    {
        super(origin);
        this._ptr = ptr;
        this.type = type;
        this.addressSpace = addressSpace;
    }
    
    get ptr() { return this._ptr; }
    get isLValue() { return true; }
    
    toString()
    {
        return "*(" + this.ptr + ")";
    }
}


// Upstream source: ./WSL/DoWhileLoop.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class DoWhileLoop extends Node {
    declare _conditional: Value;

    declare _origin: Origin;
    declare _body: Node | null;

    constructor(origin: Origin, body: Node | null, conditional: Value)
    {
        super();
        this._origin = origin;
        this._body = body;
        this._conditional = conditional;
    }

    get origin() { return this._origin; }
    get body() { return this._body; }
    get conditional() { return this._conditional; }

    toString()
    {
        return "do " + this.body + " while (" + this.conditional + ");";
    }
};



// Upstream source: ./WSL/DotExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class DotExpression extends PropertyAccessExpression {
    declare _fieldName: string;

    constructor(origin: Origin, struct: Value, fieldName: string)
    {
        super(origin, struct);
        this._fieldName = fieldName;
    }
    
    get struct() { return this.base; }
    get fieldName() { return this._fieldName; }
    
    get getFuncName() { return "operator." + this.fieldName; }
    get andFuncName() { return "operator&." + this.fieldName; }
    get setFuncName() { return "operator." + this.fieldName + "="; }
    
    toString()
    {
        return "(" + this.struct + "." + this.fieldName + ")";
    }
}


// Upstream source: ./WSL/DoubleLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let DoubleLiteral = createLiteral({
    literalClassName: "DoubleLiteral",
    preferredTypeName: "double",
    
    negConstexpr(origin: Origin)
    {
        return new IntLiteral(origin, -this.value);
    },
    
    createType(origin: Origin, value: Slot)
    {
        return new DoubleLiteralType(origin, readNumber(value));
    }
});



// Upstream source: ./WSL/DoubleLiteralType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let DoubleLiteralType = createLiteralType({
    preferredTypeName: "double",
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        let realThis = unificationContext.find(this);
        if (!realThis.isFloating)
            return {result: false, reason: "Cannot use double literal with non-floating type " + realThis};
        if (!realThis.canRepresent!(this.value))
            return {result: false, reason: "Float literal " + this.value + " does not fit in type " + realThis};
        return {result: true};
    }
});


// Upstream source: ./WSL/EArrayRef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class EArrayRef {
    declare _ptr: EPtr;
    declare _length: number;

    constructor(ptr: EPtr, length: number)
    {
        this._ptr = ptr;
        this._length = length;
    }
    
    get ptr() { return this._ptr; }
    get length() { return this._length; }
    
    toString()
    {
        return "A:<" + this.ptr + ", " + this.length + ">";
    }
}



// Upstream source: ./WSL/EBuffer.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let eBufferCount = 0;
let canAllocateEBuffers = true;

class EBuffer {
    declare _index: number;
    declare _array: Slot[];

    constructor(size: number)
    {
        if (!canAllocateEBuffers)
            throw new Error("Trying to allocate EBuffer while allocation is disallowed");
        this._index = eBufferCount++;
        this._array = new Array(size);
    }
    
    static setCanAllocateEBuffers<T>(value: boolean, callback: ()=>T): T
    {
        let oldCanAllocateEBuffers = canAllocateEBuffers;
        canAllocateEBuffers = value;
        try {
            return callback();
        } finally {
            canAllocateEBuffers = oldCanAllocateEBuffers;
        }
    }
    
    static disallowAllocation<T>(callback: ()=>T): T
    {
        return EBuffer.setCanAllocateEBuffers(false, callback);
    }
    
    static allowAllocation<T>(callback: ()=>T): T
    {
        return EBuffer.setCanAllocateEBuffers(true, callback);
    }
    
    get(index: number)
    {
        if (index < 0 || index >= this._array.length)
            throw new Error("Out of bounds buffer access (buffer = " + this + ", index = " + index + ")");
        return this._array[index];
    }
    
    set(index: number, value: Slot)
    {
        if (index < 0 || index >= this._array.length)
            throw new Error("out of bounds buffer access (buffer = " + this + ", index = " + index + ")");
        this._array[index] = value;
    }
    
    get index() { return this._index; }
    
    toString()
    {
        return "B" + this._index + ":[" + this._array + "]";
    }
}


// Upstream source: ./WSL/EBufferBuilder.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class EBufferBuilder extends Visitor {
    declare _program: Program;

    constructor(program: Program)
    {
        super();
        this._program = program;
    }
    
    _createEPtr(type: Type)
    {
        if (type.size == null)
            throw new Error("Type does not have size: " + type);
        let buffer = new EBuffer(type.size);
        if (!type.populateDefaultValue)
            throw new Error("Cannot populateDefaultValue with: " + type);
        type.populateDefaultValue(buffer, 0);
        return new EPtr(buffer, 0);
    }
    
    _createEPtrForNode(node: FuncParameter | VariableDecl | AnonymousVariable | GenericLiteral | BoolLiteral | NullLiteral | EnumLiteral | DereferenceExpression)
    {
        if (!node.type)
            throw new Error("node has no type: " + node);
        node.ePtr = this._createEPtr(node.type);
    }
    
    visitFuncParameter(node: FuncParameter)
    {
        this._createEPtrForNode(node);
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        this._createEPtrForNode(node);
        if (node.initializer)
            node.initializer.visit(this);
    }
    
    visitFuncDef(node: FuncDef)
    {
        node.returnEPtr = this._createEPtr(node.returnType);
        super.visitFuncDef(node);
    }
    
    visitFunctionLikeBlock(node: FunctionLikeBlock)
    {
        node.returnEPtr = this._createEPtr(node.returnType);
        super.visitFunctionLikeBlock(node);
    }
    
    visitCallExpression(node: CallExpression)
    {
        node.resultEPtr = this._createEPtr(readInstance(node.resultType, Type));
        super.visitCallExpression(node);
    }
    
    visitMakePtrExpression(node: MakePtrExpression)
    {
        node.ePtr = EPtr.box();
        super.visitMakePtrExpression(node);
    }
    
    visitGenericLiteral(node: GenericLiteral)
    {
        node.ePtr = EPtr.box();
    }
    
    visitNullLiteral(node: NullLiteral)
    {
        node.ePtr = EPtr.box();
    }
    
    visitBoolLiteral(node: BoolLiteral)
    {
        node.ePtr = EPtr.box();
    }
    
    visitEnumLiteral(node: EnumLiteral)
    {
        node.ePtr = EPtr.box();
    }
    
    visitLogicalNot(node: LogicalNot)
    {
        node.ePtr = EPtr.box();
        super.visitLogicalNot(node);
    }
    
    visitLogicalExpression(node: LogicalExpression)
    {
        node.ePtr = EPtr.box();
        super.visitLogicalExpression(node);
    }
    
    visitAnonymousVariable(node: AnonymousVariable)
    {
        this._createEPtrForNode(node);
    }
    
    visitMakeArrayRefExpression(node: MakeArrayRefExpression)
    {
        node.ePtr = EPtr.box();
        super.visitMakeArrayRefExpression(node);
    }
    
    visitConvertPtrToArrayRefExpression(node: ConvertPtrToArrayRefExpression)
    {
        node.ePtr = EPtr.box();
        super.visitConvertPtrToArrayRefExpression(node);
    }
}



// Upstream source: ./WSL/EPtr.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class EPtr {
    declare _buffer: EBuffer;
    declare _offset: number;

    constructor(buffer: EBuffer, offset: number)
    {
        if (offset == null || offset != offset)
            throw new Error("Bad offset: " + offset);
        this._buffer = buffer;
        this._offset = offset;
    }
    
    // The interpreter always passes around pointers to things. This means that sometimes we will
    // want to return a value but we have to "invent" a pointer to that value. No problem, this
    // function is here to help.
    //
    // In a real execution environment, uses of this manifest as SSA temporaries.
    static box(value?: Slot)
    {
        return new EPtr(new EBuffer(1), 0).box(value);
    }
    
    box(value?: Slot)
    {
        this._buffer.set(0, value);
        return this;
    }
    
    get buffer() { return this._buffer; }
    get offset() { return this._offset; }
    
    plus(offset: number)
    {
        return new EPtr(this.buffer, this.offset + offset);
    }
    
    loadValue()
    {
        return this.buffer.get(this.offset);
    }
    
    get(offset: number)
    {
        return this.buffer.get(this.offset + offset);
    }
    
    set(offset: number, value: Slot)
    {
        this.buffer.set(this.offset + offset, value);
    }
    
    copyFrom(other: EPtr | null | undefined, size: number)
    {
        if (size == null)
            throw new Error("Cannot copy null size");
        for (let i = size; i--;)
            this.set(i, other!.get(i));
    }
    
    toString()
    {
        return "B" + this.buffer.index + ":" + this.offset;
    }
}



// Upstream source: ./WSL/EnumLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class EnumLiteral extends Expression {
    declare _member: EnumMember;

    constructor(origin: Origin, member: EnumMember)
    {
        super(origin);
        this._member = member;
    }
    
    get member() { return this._member; }
    get type() { return this.member.enumType; }
    get isConstexpr() { return true; }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (!(other instanceof EnumLiteral))
            return false;
        return this.member == other.member;
    }
    
    get valueForSelectedType()
    {
        return this.member.value!.unifyNode.valueForSelectedType;
    }
        
    toString()
    {
        return this.member.enumType.name + "." + this.member.name;
    }
}


// Upstream source: ./WSL/EnumMember.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class EnumMember extends Node {
    declare enumType: EnumType;

    declare _origin: Origin;
    declare _name: string;
    declare value: Value | null;

    constructor(origin: Origin, name: string, value: Value | null)
    {
        super();
        this._origin = origin;
        this._name = name;
        this.value = value;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    
    toString()
    {
        let result = this.name;
        if (this.value)
            result += " = " + this.value;
        return result;
    }
}


// Upstream source: ./WSL/EnumType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class EnumType extends Type {
    

    declare _origin: Origin;
    declare _name: string;
    declare _baseType: Type;
    declare _members: Map<string, EnumMember>;

    constructor(origin: Origin, name: string, baseType: Type)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._baseType = baseType;
        this._members = new Map();
    }
    
    add(member: EnumMember)
    {
        if (this._members.has(member.name))
            throw new WTypeError(member.origin.originString, "Duplicate enum member name: " + member.name);
        member.enumType = this;
        this._members.set(member.name, member);
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get baseType() { return this._baseType; }
    
    get memberNames() { return this._members.keys(); }
    memberByName(name: string) { return this._members.get(name); }
    get members() { return this._members.values(); }
    get memberMap() { return this._members; }
    
    get isPrimitive(): boolean | number | null | undefined { return true; }
    
    *allValues()
    {
        for (let member of this.members)
            yield {value: member.value!.unifyNode.valueForSelectedType, name: member.name};
    }
    
    valuesEqual(a: number|boolean|EPtr|EArrayRef|null|undefined, b: number|boolean|EPtr|EArrayRef|null|undefined)
    {
        return this.baseType.unifyNode.valuesEqual!(a, b);
    }
    
    populateDefaultValue(buffer: EBuffer, offset: number): void
    {
        this.baseType.populateDefaultValue(buffer, offset);
    }
    
    get size(): number { return this.baseType.size; }
    
    toString()
    {
        return "enum " + this.name + " : " + this.baseType + " { " + Array.from(this.members).join(",") + " }";
    }
}



// Upstream source: ./WSL/EvaluationCommon.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

const BreakException = Symbol("BreakException");
const ContinueException = Symbol("ContinueException");




// Upstream source: ./WSL/Evaluator.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This is a combined LHS/RHS evaluator that passes around EPtr's to everything.
class Evaluator extends Visitor {
    declare _program: Program;

    constructor(program: Program)
    {
        super();
        this._program = program;
    }
    
    // You must snapshot if you use a value in rvalue context. For example, a call expression will
    // snapshot all of its arguments immedaitely upon executing them. In general, it should not be
    // possible for a pointer returned from a visit method in rvalue context to live across any effects.
    _snapshot(type: Type, dstPtr: EPtr | null, srcPtr: EPtr | null | undefined)
    {
        let size = type.size;
        if (size == null)
            throw new Error("Cannot get size of type: " + type + " (size = " + size + ", constructor = " + type.constructor.name + ")");
        if (!dstPtr)
            dstPtr = new EPtr(new EBuffer(size), 0);
        dstPtr.copyFrom(srcPtr, size);
        return dstPtr;
    }
    
    runFunc(func: FuncDef)
    {
        return EBuffer.disallowAllocation(
            () => this._runBody(func.returnType, func.returnEPtr, func.body));
    }
    
    _runBody(type: Type, ptr: EPtr, block: Block)
    {
        if (!ptr)
            throw new Error("Null ptr");
        try {
            block.visit(this);
            // FIXME: We should have a check that there is no way to drop out of a function without
            // returning unless the function returns void.
            return null;
        } catch (e) {
            if (e == BreakException || e == ContinueException)
                throw new Error("Should not see break/continue at function scope");
            if (e instanceof ReturnException) {
                let result = this._snapshot(type, ptr, e.value);
                return result;
            }
            throw e;
        }
    }
    
    visitFunctionLikeBlock(node: FunctionLikeBlock)
    {
        for (let i = 0; i < node.argumentList.length; ++i) {
            node.parameters[i].ePtr.copyFrom(
                node.argumentList[i].visit(this),
                node.parameters[i].type.size);
        }
        let result = this._runBody(node.returnType, node.returnEPtr, node.body);
        return result;
    }
    
    visitReturn(node: Return)
    {
        throw new ReturnException(node.value ? node.value.visit(this) : null);
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        if (!node.ePtr.buffer)
            throw new Error("eptr without buffer in " + node);
        node.type.populateDefaultValue(node.ePtr.buffer, node.ePtr.offset);
        if (node.initializer)
            node.ePtr.copyFrom(node.initializer.visit(this), node.type.size);
    }
    
    visitAssignment(node: Assignment)
    {
        let target = node.lhs.visit(this);
        let source = node.rhs.visit(this);
        target!.copyFrom(source, node.type!.size);
        return target;
    }
    
    visitIdentityExpression(node: IdentityExpression)
    {
        return node.target.visit(this);
    }
    
    visitDereferenceExpression(node: DereferenceExpression)
    {
        let ptr = node.ptr.visit(this)!.loadValue();
        if (!ptr)
            throw new WTrapError(node.origin.originString, "Null dereference");
        return ptr;
    }
    
    visitMakePtrExpression(node: MakePtrExpression)
    {
        let ptr = node.lValue.visit(this);
        return node.ePtr.box(ptr);
    }
    
    visitMakeArrayRefExpression(node: MakeArrayRefExpression)
    {
        return node.ePtr.box(new EArrayRef(readInstance(node.lValue.visit(this), EPtr), readNumber(node.numElements.visit(this)!.loadValue())));
    }
    
    visitConvertPtrToArrayRefExpression(node: ConvertPtrToArrayRefExpression)
    {
        return node.ePtr.box(new EArrayRef(readInstance(node.lValue.visit(this)!.loadValue(), EPtr), 1));
    }
    
    visitCommaExpression(node: CommaExpression)
    {
        let result;
        for (let expression of node.list)
            result = expression.visit(this);
        // This should almost snapshot, except that tail-returning a pointer is totally OK.
        return result;
    }
    
    visitVariableRef(node: VariableRef)
    {
        return node.variable!.ePtr;
    }
    
    visitGenericLiteral(node: GenericLiteral)
    {
        return node.ePtr.box(node.valueForSelectedType);
    }
    
    visitNullLiteral(node: NullLiteral)
    {
        return node.ePtr.box(null);
    }
    
    visitBoolLiteral(node: BoolLiteral)
    {
        return node.ePtr.box(node.value);
    }
    
    visitEnumLiteral(node: EnumLiteral)
    {
        return node.ePtr.box(node.member.value!.unifyNode.valueForSelectedType);
    }

    visitLogicalNot(node: LogicalNot)
    {
        let result = !node.operand.visit(this)!.loadValue();
        return node.ePtr.box(result);
    }

    visitLogicalExpression(node: LogicalExpression)
    {
        let lhs = node.left.visit(this)!.loadValue();
        let rhs = node.right.visit(this)!.loadValue();
        let result;
        switch (node.text) {
        case "&&":
            result = lhs && rhs;
            break;
        case "||":
            result = lhs || rhs;
            break;
        default:
            throw new Error("Unknown type of logical expression");
        }
        return node.ePtr.box(result);
    }

    visitIfStatement(node: IfStatement)
    {
        if (node.conditional.visit(this)!.loadValue())
            return node.body!.visit(this);
        else if (node.elseBody)
            return node.elseBody.visit(this);
    }

    visitWhileLoop(node: WhileLoop)
    {
        while (node.conditional.visit(this)!.loadValue()) {
            try {
                node.body!.visit(this);
            } catch (e) {
                if (e == BreakException)
                    break;
                if (e == ContinueException)
                    continue;
                throw e;
            }
        }
    }

    visitDoWhileLoop(node: DoWhileLoop)
    {
        do {
            try {
                node.body!.visit(this);
            } catch (e) {
                if (e == BreakException)
                    break;
                if (e == ContinueException)
                    continue;
                throw e;
            }
        } while (node.conditional.visit(this)!.loadValue());
    }

    visitForLoop(node: ForLoop)
    {
        for (node.initialization ? node.initialization.visit(this) : true;
            node.condition ? node.condition.visit(this)!.loadValue() : true;
            node.increment ? node.increment.visit(this) : true) {
            try {
                node.body!.visit(this);
            } catch (e) {
                if (e == BreakException)
                    break;
                if (e == ContinueException)
                    continue;
                throw e;
            }
        }
    }
    
    visitSwitchStatement(node: SwitchStatement)
    {
        let findAndRunCast = (predicate: (switchCase: SwitchCase)=>boolean) => {
            for (let i = 0; i < node.switchCases.length; ++i) {
                let switchCase = node.switchCases[i];
                if (predicate(switchCase)) {
                    try {
                        for (let j = i; j < node.switchCases.length; ++j)
                            node.switchCases[j].visit(this);
                    } catch (e) {
                        if (e != BreakException)
                            throw e;
                    }
                    return true;
                }
            }
            return false;
        };
        
        let value = node.value.visit(this)!.loadValue();
        
        let found = findAndRunCast(switchCase => {
            if (switchCase.isDefault)
                return false;
            return node.type!.unifyNode.valuesEqual!(
                value, switchCase.value!.unifyNode.valueForSelectedType);
        });
        if (found)
            return;
        
        found = findAndRunCast(switchCase => switchCase.isDefault);
        if (!found)
            throw new Error("Switch statement did not find case");
    }

    visitBreak(node: Break)
    {
        throw BreakException;
    }

    visitContinue(node: Continue)
    {
        throw ContinueException;
    }

    visitTrapStatement(node: TrapStatement)
    {
        throw new WTrapError(node.origin.originString, "Trap statement");
    }
    
    visitAnonymousVariable(node: AnonymousVariable)
    {
        node.type!.populateDefaultValue(node.ePtr.buffer, node.ePtr.offset);
    }
    
    visitCallExpression(node: CallExpression)
    {
        // We evaluate inlined ASTs, so this can only be a native call.
        let callArguments = [];
        for (let i = 0; i < node.argumentList.length; ++i) {
            let argument = node.argumentList[i];
            let type = node.nativeFuncInstance.parameterTypes[i];
            if (!type || !argument)
                throw new Error("Cannot get type or argument; i = " + i + ", argument = " + argument + ", type = " + type + "; in " + node);
            let argumentValue = argument.visit(this);
            if (!argumentValue)
                throw new Error("Null argument value, i = " + i + ", node = " + node);
            callArguments.push(() => {
                let result = this._snapshot(type, null, argumentValue);
                return result;
            });
        }
        
        // For simplicity, we allow intrinsics to just allocate new buffers, and we allocate new
        // buffers when snapshotting their arguments. This is not observable to the user, so it's OK.
        let result = EBuffer.allowAllocation(
            () => node.func!.implementation!(callArguments.map(thunk => thunk()), node));
        
        result = this._snapshot(node.nativeFuncInstance.returnType, node.resultEPtr, readInstance(result, EPtr));
        return result;
    }
}



// Upstream source: ./WSL/ExpressionFinder.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This finds type and value expressions, but skips type and value declarations.
class ExpressionFinder extends Visitor {
    declare _callback: (node:Node)=>void;

    constructor(callback: (node:Node)=>void)
    {
        super();
        this._callback = callback;
    }
    
    visitFunc(node: Func)
    {
        this._callback(node.returnType);
        for (let typeParameter of node.typeParameters)
            typeParameter.visit(this);
        for (let parameter of node.parameters)
            parameter.visit(this);
    }
    
    visitFuncParameter(node: FuncParameter)
    {
        this._callback(node.type);
    }
    
    visitConstexprTypeParameter(node: ConstexprTypeParameter)
    {
        this._callback(node.type);
    }
    
    visitAssignment(node: Assignment)
    {
        this._callback(node);
    }
    
    visitReadModifyWriteExpression(node: ReadModifyWriteExpression)
    {
        this._callback(node);
    }
    
    visitIdentityExpression(node: IdentityExpression)
    {
        this._callback(node);
    }
    
    visitCallExpression(node: CallExpression)
    {
        this._callback(node);
    }
    
    visitReturn(node: Return)
    {
        if (node.value)
            this._callback(node.value);
    }
    
    visitWhileLoop(node: WhileLoop)
    {
        this._callback(node.conditional);
        node.body!.visit(this);
    }
    
    visitDoWhileLoop(node: DoWhileLoop)
    {
        node.body!.visit(this);
        this._callback(node.conditional);
    }
    
    visitIfStatement(node: IfStatement)
    {
        this._callback(node.conditional);
        node.body!.visit(this);
        if (node.elseBody)
            node.elseBody.visit(this);
    }
    
    visitForLoop(node: ForLoop)
    {
        // Initialization is a statement, not an expression. If it's an assignment or variableDecl, we'll
        // catch it and redirect to the callback.
        if (node.initialization)
            node.initialization.visit(this);
        
        if (node.condition)
            this._callback(node.condition);
        if (node.increment)
            this._callback(node.increment);
        
        node.body!.visit(this);
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        this._callback(node.type);
        if (node.initializer)
            this._callback(node.initializer);
    }
}



// Upstream source: ./WSL/ExternalOrigin.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

const externalOrigin = {
    originString: "<external>",
    originKind: "user"
};


// Upstream source: ./WSL/Field.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Field extends Node {
    declare struct: StructType;

    declare offset: number;

    declare _origin: Origin;
    declare _name: string;
    declare _type: Type;

    constructor(origin: Origin, name: string, type: Type)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._type = type;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get type() { return this._type; }
    
    toString()
    {
        return this.type + " " + this.name;
    }
}


// Upstream source: ./WSL/FindHighZombies.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function findHighZombies(program: Program)
{
    program.visit(new HighZombieFinder());
}


// Upstream source: ./WSL/FlattenProtocolExtends.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function flattenProtocolExtends(program: Program)
{
    let visiting = new VisitingSet();
    
    function flatten(protocol: ProtocolDecl)
    {
        if (!protocol.extends.length)
            return;
        
        visiting.doVisit(protocol, () => {
            for (let parentRef of protocol.extends) {
                let parent: ProtocolRef | ProtocolDecl | null = parentRef;
                parent = parent.protocolDecl;
                flatten(readInstance(parent!, ProtocolDecl));
                for (let signature of parent!.signatures) {
                    let newSignature = readInstance(signature.visit(
                        new Substitution([readInstance(parent, ProtocolDecl).typeVariable], [protocol.typeVariable])), ProtocolFuncDecl);
                    protocol.add(newSignature);
                }
            }
            protocol.extends = [];
        });
    }
    
    for (let protocol of program.protocols.values())
        flatten(readInstance(protocol, ProtocolDecl));
}



// Upstream source: ./WSL/FlattenedStructOffsetGatherer.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class FlattenedStructOffsetGatherer extends Visitor {
    declare _result: {name:string,offset:number,type:string}[];

    declare _offset: number;
    declare _name: string[];

    constructor(initial: string)
    {
        super();
        this._offset = 0;
        this._name = [initial];
        this._result = [];
    }

    get result()
    {
        return this._result;
    }
    
    visitReferenceType(node: ReferenceType)
    {
    }
    
    visitField(node: Field)
    {
        this._offset += node.offset;
        this._name.push(node.name);
        super.visitField(node);
        this._name.pop();
        this._offset -= node.offset;
    }
    
    visitNativeType(node: NativeType)
    {
        this._result.push({name: this._name.join("."), offset: this._offset, type: node.name});
        super.visitNativeType(node);
    }
    
    visitTypeRef(node: TypeRef)
    {
        super.visitTypeRef(node);
        Node.visit(node.type, this);
    }
}



// Upstream source: ./WSL/FloatLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let FloatLiteral = createLiteral({
    literalClassName: "FloatLiteral",
    preferredTypeName: "float",
    
    negConstexpr(origin: Origin)
    {
        return new IntLiteral(origin, -this.value);
    },
    
    createType(origin: Origin, value: Slot)
    {
        return new FloatLiteralType(origin, readNumber(value));
    }
});



// Upstream source: ./WSL/FloatLiteralType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let FloatLiteralType = createLiteralType({
    preferredTypeName: "float",
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        let realThis = unificationContext.find(this);
        if (!realThis.isFloating)
            return {result: false, reason: "Cannot use float literal with non-floating type " + realThis};
        if (!realThis.canRepresent!(this.value))
            return {result: false, reason: "Float literal " + this.value + " does not fit in type " + realThis};
        return {result: true};
    }
});


// Upstream source: ./WSL/FoldConstexprs.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function foldConstexprs(program: Program)
{
    program.visit(new ConstexprFolder());
}



// Upstream source: ./WSL/ForLoop.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ForLoop extends Node {
    declare _initialization: Node | null | undefined;
    declare _increment: Value | null | undefined;

    declare _origin: Origin;
    declare _condition: Value | null | undefined;
    declare _body: Node | null;

    constructor(origin: Origin, initialization: Node | null | undefined, condition: Value | null | undefined, increment: Value | null | undefined, body: Node | null)
    {
        super();
        this._origin = origin;
        this._initialization = initialization;
        this._condition = condition;
        this._increment = increment;
        this._body = body;
    }

    get origin() { return this._origin; }
    get initialization() { return this._initialization; }
    get condition() { return this._condition; }
    get increment() { return this._increment; }
    get body() { return this._body; }

    toString()
    {
        return "for (" + (this.initialization ? this.initialization : " ") + "; " + (this.condition ? this.condition : "") + "; " + (this.increment ? this.increment : "") + ") " + this.body;
    }
};



// Upstream source: ./WSL/Func.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Func extends Node {
    declare program: Program;
    declare isRestricted: boolean | undefined;

    declare _origin: Origin;
    declare _name: string;
    declare _returnType: Type;
    declare _typeParameters: Node[];
    declare _parameters: FuncParameter[];
    declare _isCast: boolean;
    declare _shaderType: string | null | undefined;

    constructor(origin: Origin, name: string, returnType: Type, typeParameters: Node[], parameters: FuncParameter[], isCast: boolean, shaderType: string | null | undefined)
    {
        if (!(origin instanceof LexerToken))
            throw new Error("Bad origin: " + origin);
        for (let parameter of parameters) {
            if (!parameter)
                throw new Error("Null parameter");
            if (!parameter.type)
                throw new Error("Null parameter type");
        }
        super();
        this._origin = origin;
        this._name = name;
        this._returnType = returnType;
        this._typeParameters = typeParameters;
        this._parameters = parameters;
        this._isCast = isCast;
        this._shaderType = shaderType;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get returnType() { return this._returnType; }
    get typeParameters() { return this._typeParameters; }
    get typeParametersForCallResolution() { return this.typeParameters; }
    get parameters() { return this._parameters; }
    get parameterTypes() { return this.parameters.map((parameter) => parameter.type); }
    get isCast() { return this._isCast; }
    get shaderType() { return this._shaderType; }
    get returnTypeForOverloadResolution() { return this.isCast ? this.returnType : null; }
    
    get kind() { return Func; }
    
    toDeclString()
    {
        let result = "";
        if (this.shaderType)
            result += this.shaderType + " ";
        if (this.isCast)
            result += "operator<" + this.typeParameters + "> " + this.returnType;
        else
            result += this.returnType + " " + this.name + "<" + this.typeParameters + ">";
        return result + "(" + this.parameters + ")";
    }
    
    toString()
    {
        return this.toDeclString();
    }
}



// Upstream source: ./WSL/FuncDef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class FuncDef extends Func {
    declare inlined: boolean | undefined;
    declare returnEPtr: EPtr;
    declare uninstantiatedReturnType: Type;
    declare program: Program;

    declare _name: string;

    declare _body: Block;
    declare isRestricted: boolean;
    declare _returnType: Type;
    declare _parameters: FuncParameter[];

    constructor(origin: Origin, name: string, returnType: Type, typeParameters: Node[], parameters: FuncParameter[], body: Block, isCast: boolean, shaderType: string | null | undefined)
    {
        super(origin, name, returnType, typeParameters, parameters, isCast, shaderType);
        this._body = body;
        this.isRestricted = false;
    }

    get body() { return this._body; }
    
    rewrite(rewriter: Visitor|Rewriter)
    {
        if (this._typeParameters.length)
            throw new Error("Cannot rewrite an uninstantiated function");
        this._returnType = readInstance(this._returnType.visit(rewriter), Type);
        this._parameters = readInstances(this._parameters.map((parameter: Node) => parameter.visit(rewriter)), FuncParameter);
        this._body = readInstance(this.body.visit(rewriter), Block);
    }
    
    toString()
    {
        return super.toString() + " " + this.body;
    }
}



// Upstream source: ./WSL/FuncInstantiator.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class FuncInstantiator {
    declare _instances: Map<Func, {typeArguments: Node[]; func: Func}[]>;

    declare _program: Program;

    constructor(program: Program)
    {
        this._program = program;
        this._instances = new Map();
    }
    
    // Returns a Func object that uniquely identifies a particular system of type arguments. You must
    // intantiate things with concrete types, because this code casually assumes this. Note that this
    // will return a different func from `func` no matter what. This ensures that we can use the
    // returned func for rewrites that instantiate types without destroying our ability to do overload
    // resolutions on the original Program.
    getUnique(func: Func, typeArguments: Node[])
    {
        class FindTypeVariable extends Visitor {
            visitTypeRef(node: TypeRef)
            {
                for (let typeArgument of node.typeArguments)
                    typeArgument.visit(this);
            }
            
            visitTypeVariable(node: TypeVariable) {
                throw new Error("Unexpected type variable: " + node + " when instantiating " + func + " with arguments " + typeArguments);
            }
        }
        for (let typeArgument of typeArguments)
            typeArgument.visit(new FindTypeVariable());
        
        let instances = this._instances.get(func);
        if (!instances)
            this._instances.set(func, instances = []);
        
        for (let instance of instances) {
            let ok = true;
            for (let i = instance.typeArguments.length; i--;) {
                if (!instance.typeArguments[i].equals(typeArguments[i])) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
            return instance.func;
        }
        
        let thisInstantiator = this;
        
        class InstantiationSubstitution extends Substitution {
            visitCallExpression(node: CallExpression)
            {
                let result = readInstance(super.visitCallExpression(node), CallExpression);
                
                // We may have to re-resolve the function call, if it was a call to a protocol
                // signature.
                if (result.func instanceof ProtocolFuncDecl) {
                    let overload = resolveOverloadImpl(readInstances(result.possibleOverloads, Func), result.typeArguments, result.argumentTypes, result.returnType);
                    if (!overload.func)
                        throw new Error("Could not resolve protocol signature function call during instantiation: " + result.func + (overload.failures!.length ? "; tried:\n" + overload.failures!.join("\n") : ""));
                    result.resolveToOverload(overload);
                }
                
                if (result.func!.isNative)
                    result.nativeFuncInstance = readInstance(thisInstantiator.getUnique(result.func!, result.actualTypeArguments!), NativeFuncInstance);
                
                return result;
            }
        }
        
        let substitution = new InstantiationSubstitution(func.typeParameters, typeArguments);

        class InstantiationInstantiateImmediates extends InstantiateImmediates {
            visitCallExpression(node: CallExpression)
            {
                // We need to preserve certain things that would have instantiated, but that we cannot
                // instantiate without breaking chain-instantiations (generic function calls generic
                // function so therefore the instantiated generic function must still have the original
                // (uninstantiated) types to instantiate the generic function that it calls).
                let result = new CallExpression(
                    node.origin, node.name, node.typeArguments,
                    readOptionalValues(node.argumentList.map(argument => readOptionalInstance(Node.visit(argument, this), Value))));
                result = this.processDerivedCallData(node, result);
                
                result.argumentTypes = Array.from(node.argumentTypes);
                if (node.isCast)
                    result.setCastData(readInstance(node.returnType, Type));
                result.actualTypeArguments = Array.from(node.actualTypeArguments!);
                
                return result;
            }
        }

        let instantiateImmediates = new InstantiationInstantiateImmediates();
        
        class Instantiate {
            visitFuncDef(func: FuncDef)
            {
                let returnType = func.returnType.visit(substitution);
                returnType = returnType.visit(instantiateImmediates);
                let parameters = func.parameters.map((parameter: Node) => parameter.visit(substitution));
                parameters = parameters.map((parameter: Node) => parameter.visit(instantiateImmediates));
                let body = func.body.visit(substitution);
                body = body.visit(instantiateImmediates);
                return new FuncDef(
                    func.origin, func.name, readInstance(returnType, Type), [], readInstances(parameters, FuncParameter), readInstance(body, Block), func.isCast,
                    func.shaderType);
            }
            
            visitNativeFunc(func: NativeFunc)
            {
                return new NativeFuncInstance(
                    readInstance(func, NativeFunc),
                    readInstance(func.returnType.visit(substitution).visit(instantiateImmediates), Type),
                    readInstances(func.parameters.map((parameter: Node) => parameter.visit(substitution).visit(instantiateImmediates)), FuncParameter),
                    func.isCast,
                    func.shaderType,
                    func.instantiateImplementation(substitution));
            }
        }
        let resultingFunc = readInstance(func.visit(new Instantiate()), Func);
        resultingFunc.uninstantiatedReturnType = readInstance(func.returnType.visit(substitution), Type);
        let instance = {func: resultingFunc, typeArguments};
        instances.push(instance);
        return resultingFunc;
    }
}



// Upstream source: ./WSL/FuncParameter.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class FuncParameter extends Value {
    declare ePtr: EPtr;
    declare _origin: Origin;
    declare _name: string | null;
    declare _type: Type;

    // The name is optional. It's OK for it to be null!
    constructor(origin: Origin, name: string | null, type: Type)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._type = type;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get type() { return this._type; }
    get varIsLValue() { return true; }
    
    toString()
    {
        if (!this.name)
            return "" + this.type;
        return this.type + " " + this.name;
    }
}



// Upstream source: ./WSL/FunctionLikeBlock.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class FunctionLikeBlock extends Value {
    declare resultType: Type;

    declare returnEPtr: EPtr;
    declare _origin: Origin;
    declare _returnType: Type;
    declare _argumentList: Value[];
    declare _parameters: FuncParameter[];
    declare _body: Block;

    constructor(origin: Origin, returnType: Type, argumentList: Value[], parameters: FuncParameter[], body: Block)
    {
        super();
        this._origin = origin;
        this._returnType = returnType;
        this._argumentList = argumentList;
        this._parameters = parameters;
        this._body = body;
    }
    
    get origin() { return this._origin; }
    get returnType() { return this._returnType; }
    get argumentList() { return this._argumentList; }
    get parameters() { return this._parameters; }
    get body() { return this._body; }
    
    toString()
    {
        return "([&] (" + this.parameters + ") -> " + this.returnType + " { " + this.body + " }(" + this.argumentList + "))";
    }
}


// Upstream source: ./WSL/HighZombieFinder.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// If a high-level construct somehow manages to live on when we're lowered, it's a high zombie.
class HighZombieFinder extends Visitor {
    _found(node: Node)
    {
        throw new Error(node.origin!.originString + ": High zombie: " + node);
    }
    
    visitDotExpression(node: DotExpression)
    {
        this._found(node);
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        this._found(node);
    }
    
    visitCallExpression(node: CallExpression)
    {
        super.visitCallExpression(node);
    }
}



// Upstream source: ./WSL/IdentityExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class IdentityExpression extends Expression {
    declare _target: Value;

    constructor(target: Value)
    {
        super(target.origin);
        this._target = target;
    }
    
    get target() { return this._target; }
    
    get unifyNode(): Value { return this.target.unifyNode; }
    get isConstexpr() { return this.target.isConstexpr; }
    get isLValue() { return this.target.isLValue; }
    get addressSpace() { return this.target.addressSpace; }
    
    toString()
    {
        return "(" + this.target + ")";
    }
}



// Upstream source: ./WSL/IfStatement.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class IfStatement extends Node {
    declare _conditional: Value;
    declare _elseBody: Node | null | undefined;

    declare _origin: Origin;
    declare _body: Node | null;

    constructor(origin: Origin, conditional: Value, body: Node | null, elseBody: Node | null | undefined)
    {
        super();
        this._origin = origin;
        this._conditional = conditional;
        this._body = body;
        this._elseBody = elseBody;
    }

    get origin() { return this._origin; }
    get conditional() { return this._conditional; }
    get body() { return this._body; }
    get elseBody() { return this._elseBody; }

    toString()
    {
        let result = "if (" + this.conditional + ") " + this.body;
        if (this.elseBody)
            return result + " else " + this.elseBody;
        return result;
    }
};



// Upstream source: ./WSL/IndexExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class IndexExpression extends PropertyAccessExpression {
    declare _index: Value;

    constructor(origin: Origin, array: Value, index: Value)
    {
        super(origin, array);
        this._index = index;
    }
    
    get array() { return this.base; }
    get index() { return this._index; }
    
    get getFuncName() { return "operator[]"; }
    get andFuncName() { return "operator&[]"; }
    get setFuncName() { return "operator[]="; }

    updateCalls()
    {
        if (this.callForGet)
            this.callForGet.argumentList[1] = this.index;
        if (this.callForAnd)
            this.callForAnd.argumentList[1] = this.index;
        if (this.callForSet)
            this.callForSet.argumentList[1] = this.index;
        super.updateCalls();
    }

    toString()
    {
        return "(" + this.array + "[" + this.index + "])";
    }
}


// Upstream source: ./WSL/InferTypesForCall.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function inferTypesForCall(func: Func, typeArguments: Node[], argumentTypes: Type[], returnType: Type | null | undefined): OverloadResult
{
    if (typeArguments.length && typeArguments.length != func.typeParameters.length)
        return {failure: new OverloadResolutionFailure(func, "Wrong number of type arguments (passed " + typeArguments.length + ", require " + func.typeParameters.length + ")")};
    if (argumentTypes.length != func.parameters.length)
        return {failure: new OverloadResolutionFailure(func, "Wrong number of arguments (passed " + argumentTypes.length + ", require " + func.parameters.length + ")")};
    let unificationContext = new UnificationContext(func.typeParametersForCallResolution);
    for (let i = 0; i < typeArguments.length; ++i) {
        let argument = typeArguments[i];
        let parameter = func.typeParameters[i];
        if (!argument.unify(unificationContext, parameter))
            return {failure: new OverloadResolutionFailure(func, "Type argument #" + (i + 1) + " for parameter " + parameter.name + " does not match (passed " + argument + ", require " + parameter + ")")};
    }
    for (let i = 0; i < argumentTypes.length; ++i) {
        if (!argumentTypes[i])
            throw new Error("Null argument type at i = " + i);
        if (!argumentTypes[i].unify(unificationContext, func.parameters[i].type))
            return {failure: new OverloadResolutionFailure(func, "Argument #" + (i + 1) + " " + (func.parameters[i].name ? "for parameter " + func.parameters[i].name + " " : "") + "does not match (passed " + argumentTypes[i] + ", require " + func.parameters[i].type + ")")};
    }
    if (returnType && !returnType.unify(unificationContext, func.returnType))
        return {failure: new OverloadResolutionFailure(func, "Return type " + func.returnType + " does not match " + returnType)};
    let verificationResult = unificationContext.verify();
    if (!verificationResult.result)
        return {failure: new OverloadResolutionFailure(func, verificationResult.reason!)};
    let shouldBuildTypeArguments = !typeArguments.length;
    if (shouldBuildTypeArguments)
        typeArguments = [];
    for (let typeParameter of func.typeParameters) {
        let typeArgument = unificationContext.find(typeParameter);
        if (typeArgument == typeParameter)
            return {failure: new OverloadResolutionFailure(func, "Type parameter " + typeParameter + " did not get assigned a type")};
        if (shouldBuildTypeArguments)
            typeArguments.push(typeArgument);
    }
    return {func, unificationContext, typeArguments};
}



// Upstream source: ./WSL/Inline.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function inline(program: Program)
{
    for (let funcList of program.functions.values()) {
        for (let func of funcList) {
            if (!func.typeParameters.length) {
                func = readInstance(program.funcInstantiator.getUnique(func, []), Func)
                _inlineFunction(program, func, new VisitingSet(func));
            }
        }
    }
}

function _inlineFunction(program: Program, func: Func, visiting: VisitingSet)
{
    if (func.typeParameters.length)
        throw new Error("Cannot inline function that has type parameters");
    if (func.inlined || func.isNative)
        return;
    if (!(func instanceof FuncDef)) throw new TypeError("Expected WSL function definition after native-function check");
    
    func.visit(new LateChecker());
    
    // This is the precise time when we can build EBuffers in order to get them to be uniqued by
    // type instantiation but nothing else.
    func.visit(new StructLayoutBuilder());
    func.visit(new EBufferBuilder(program));
    
    func.rewrite(new Inliner(program, func, visiting));

    func.inlined = true;
}

function resolveInlinedFunction(program: Program, name: string, typeArguments: Node[], argumentTypes: Type[], allowEntryPoint = false)
{
    let overload = program.globalNameContext.resolveFuncOverload(name, typeArguments, argumentTypes, undefined, allowEntryPoint);
    if (!overload.func)
        return overload.failures;
    if (!overload.func.typeParameters)
        return overload.func;
    let func = program.funcInstantiator.getUnique(overload.func, readInstances(overload.typeArguments, Node));
    _inlineFunction(program, readInstance(func, Func), new VisitingSet(overload.func));
    return func;
}


// Upstream source: ./WSL/Inliner.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Inliner extends Rewriter {
    declare _visiting: VisitingSet;

    declare _program: Program;

    constructor(program: Program, func: FuncDef, visiting: VisitingSet)
    {
        super();
        this._program = program;
        this._visiting = visiting;
    }
    
    visitCallExpression(node: CallExpression)
    {
        let result = readInstance(super.visitCallExpression(node), CallExpression);
        if (result.nativeFuncInstance)
            return result;
        return this._visiting.doVisit(readInstance(node.func, Node), () => {
            let func = readInstance(this._program.funcInstantiator.getUnique(result.func!, result.actualTypeArguments!), FuncDef);
            if (func.isNative)
                throw new Error("Unexpected native func: " + func);
            _inlineFunction(this._program, readInstance(func, Func), this._visiting);
            let resultingBlock = new FunctionLikeBlock(
                result.origin, func.returnType, readInstances(result.argumentList, Value), func.parameters, func.body);
            resultingBlock.returnEPtr = result.resultEPtr;
            return resultingBlock;
        });
    }
}



// Upstream source: ./WSL/InstantiateImmediates.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class InstantiateImmediates extends Rewriter {
    visitTypeRef(node: TypeRef)
    {
        node = readInstance(super.visitTypeRef(node), TypeRef);
        if (!node.type!.instantiate) {
            if (node.typeArguments.length)
                throw new Error("type does not support instantiation: " + type + " (" + type.constructor.name + ")");
            return node;
        }
        return node.type!.instantiate(node.typeArguments).visit(new AutoWrapper());
    }
    
    visitReferenceType(node: ReferenceType)
    {
        return node;
    }
}



// Upstream source: ./WSL/IntLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let IntLiteral = createLiteral({
    literalClassName: "IntLiteral",
    preferredTypeName: "int",
    
    negConstexpr(origin: Origin)
    {
        return new IntLiteral(origin, (-this.value) | 0);
    },
    
    createType(origin: Origin, value: Slot)
    {
        return new IntLiteralType(origin, readNumber(value));
    }
});



// Upstream source: ./WSL/IntLiteralType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let IntLiteralType = createLiteralType({
    preferredTypeName: "int",
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        let realThis = unificationContext.find(this);
        if (!realThis.isNumber)
            return {result: false, reason: "Cannot use int literal with non-number type " + realThis};
        if (!realThis.canRepresent!(this.value))
            return {result: false, reason: "Int literal " + this.value + " too large to be represented by type " + realThis};
        return {result: true};
    }
});


// Upstream source: ./WSL/Intrinsics.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Intrinsics {
    declare _map: Map<string, unknown>;
    declare void: NativeType;
    declare int32: NativeType;
    declare uint32: NativeType;
    declare uint8: NativeType;
    declare float: NativeType;
    declare double: NativeType;
    declare bool: NativeType;

    constructor(nameContext: NameContext)
    {
        this._map = new Map();

        // NOTE: Intrinsic resolution happens before type name resolution, so the strings we use here
        // to catch the intrinsics must be based on the type names that StandardLibraryPrologue.js uses.
        // For example, if a native function is declared using "int" rather than "int32", then we must
        // use "int" here, since we don't yet know that they are the same type.
        
        this._map.set(
            "native typedef void<>",
            (type: NativeType) => {
                this.void = type;
                type.size = 0;
                type.populateDefaultValue = () => { };
            });
        
        function isBitwiseEquivalent(left: number, right: number)
        {
            let doubleArray = new Float64Array(1);
            let intArray = new Int32Array(doubleArray.buffer);
            doubleArray[0] = left;
            let leftInts = Int32Array.from(intArray);
            doubleArray[0] = right;
            for (let i = 0; i < 2; ++i) {
                if (leftInts[i] != intArray[i])
                    return false;
            }
            return true;
        }

        this._map.set(
            "native typedef int32<>",
            (type: NativeType) => {
                this.int32 = type;
                type.isPrimitive = true;
                type.isInt = true;
                type.isNumber = true;
                type.isSigned = true;
                type.canRepresent = (value: number) => isBitwiseEquivalent(value | 0, value);
                type.size = 1;
                type.defaultValue = 0;
                type.createLiteral = (origin: Origin, value: number) => IntLiteral.withType(origin, value | 0, type);
                type.successorValue = (value: number) => (value + 1) | 0;
                type.valuesEqual = (a, b) => a === b;
                type.populateDefaultValue = (buffer: EBuffer, offset: number) => buffer.set(offset, 0);
                type.formatValueFromIntLiteral = (value: number) => value | 0;
                type.formatValueFromUintLiteral = (value: number) => value | 0;
                type.allValues = function*() { 
                    for (let i = 0; i <= 0xffffffff; ++i) {
                        let value = i | 0;
                        yield {value: value, name: value};
                    }
                };
            });

        this._map.set(
            "native typedef uint32<>",
            (type: NativeType) => {
                this.uint32 = type;
                type.isPrimitive = true;
                type.isInt = true;
                type.isNumber = true;
                type.isSigned = false;
                type.canRepresent = (value: number) => isBitwiseEquivalent(value >>> 0, value);
                type.size = 1;
                type.defaultValue = 0;
                type.createLiteral = (origin: Origin, value: number) => IntLiteral.withType(origin, value >>> 0, type);
                type.successorValue = (value: number) => (value + 1) >>> 0;
                type.valuesEqual = (a, b) => a === b;
                type.populateDefaultValue = (buffer: EBuffer, offset: number) => buffer.set(offset, 0);
                type.formatValueFromIntLiteral = (value: number) => value >>> 0;
                type.formatValueFromUintLiteral = (value: number) => value >>> 0;
                type.allValues = function*() { 
                    for (let i = 0; i <= 0xffffffff; ++i)
                        yield {value: i, name: i};
                };
            });

        this._map.set(
            "native typedef uint8<>",
            (type: NativeType) => {
                this.uint8 = type;
                type.isInt = true;
                type.isNumber = true;
                type.isSigned = false;
                type.canRepresent = (value: number) => isBitwiseEquivalent(value & 0xff, value);
                type.size = 1;
                type.defaultValue = 0;
                type.createLiteral = (origin: Origin, value: number) => IntLiteral.withType(origin, value & 0xff, type);
                type.successorValue = (value: number) => (value + 1) & 0xff;
                type.valuesEqual = (a, b) => a === b;
                type.populateDefaultValue = (buffer: EBuffer, offset: number) => buffer.set(offset, 0);
                type.formatValueFromIntLiteral = (value: number) => value & 0xff;
                type.formatValueFromUintLiteral = (value: number) => value & 0xff;
                type.allValues = function*() {
                    for (let i = 0; i <= 0xff; ++i)
                        yield {value: i, name: i};
                };
            });

        this._map.set(
            "native typedef float32<>",
            (type: NativeType) => {
                this.float = type;
                type.isPrimitive = true;
                type.size = 1;
                type.isFloating = true;
                type.isNumber = true;
                type.canRepresent = (value: number) => isBitwiseEquivalent(Math.fround(value), value);
                type.populateDefaultValue = (buffer: EBuffer, offset: number) => buffer.set(offset, 0);
                type.formatValueFromIntLiteral = (value: number) => value;
                type.formatValueFromUintLiteral = (value: number) => value;
                type.formatValueFromFloatLiteral = (value: number) => Math.fround(value);
                type.formatValueFromDoubleLiteral = (value: number) => Math.fround(value);
            });

        this._map.set(
            "native typedef float64<>",
            (type: NativeType) => {
                this.double = type;
                type.isPrimitive = true;
                type.size = 1;
                type.isFloating = true;
                type.isNumber = true;
                type.canRepresent = (value: number) => true;
                type.populateDefaultValue = (buffer: EBuffer, offset: number) => buffer.set(offset, 0);
                type.formatValueFromIntLiteral = (value: number) => value;
                type.formatValueFromUintLiteral = (value: number) => value;
                type.formatValueFromFloatLiteral = (value: number) => value;
                type.formatValueFromDoubleLiteral = (value: number) => value;
            });

        this._map.set(
            "native typedef bool<>",
            (type: NativeType) => {
                this.bool = type;
                type.isPrimitive = true;
                type.size = 1;
                type.populateDefaultValue = (buffer: EBuffer, offset: number) => buffer.set(offset, false);
            });
        
        this._map.set(
            "native operator<> int32(uint32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) | 0);
            });
        
        this._map.set(
            "native operator<> int32(uint8)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) | 0);
            });
        
        this._map.set(
            "native operator<> int32(float)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) | 0);
            });
        
        this._map.set(
            "native operator<> int32(double)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) | 0);
            });
        
        this._map.set(
            "native operator<> uint32(int32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) >>> 0);
            });
        
        this._map.set(
            "native operator<> uint32(uint8)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) >>> 0);
            });
        
        this._map.set(
            "native operator<> uint32(float)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) >>> 0);
            });
        
        this._map.set(
            "native operator<> uint32(double)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) >>> 0);
            });
        
        this._map.set(
            "native operator<> uint8(int32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) & 0xff);
            });
        
        this._map.set(
            "native operator<> uint8(uint32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) & 0xff);
            });
        
        this._map.set(
            "native operator<> uint8(float)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) & 0xff);
            });
        
        this._map.set(
            "native operator<> uint8(double)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(readNumber(value.loadValue()!) & 0xff);
            });
        
        this._map.set(
            "native operator<> float(double)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(Math.fround(readNumber(value.loadValue())));
            });
        
        this._map.set(
            "native operator<> float(int32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(Math.fround(readNumber(value.loadValue())));
            });
        
        this._map.set(
            "native operator<> float(uint32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(Math.fround(readNumber(value.loadValue())));
            });
        
        this._map.set(
            "native operator<> float(uint8)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(Math.fround(readNumber(value.loadValue())));
            });
        
        this._map.set(
            "native operator<> double(float)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(value.loadValue());
            });
        
        this._map.set(
            "native operator<> double(int32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(value.loadValue());
            });
        
        this._map.set(
            "native operator<> double(uint32)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(value.loadValue());
            });
        
        this._map.set(
            "native operator<> double(uint8)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(value.loadValue());
            });
        
        this._map.set(
            "native int operator+<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) + readNumber(right.loadValue()!)) | 0);
            });
        
        this._map.set(
            "native uint operator+<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) + readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native float operator+<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(Math.fround(readNumber(left.loadValue()!) + readNumber(right.loadValue()!)));
            });
        
        this._map.set(
            "native double operator+<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) + readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native int operator-<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) - readNumber(right.loadValue()!)) | 0);
            });
        
        this._map.set(
            "native uint operator-<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) - readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native float operator-<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(Math.fround(readNumber(left.loadValue()!) - readNumber(right.loadValue()!)));
            });
        
        this._map.set(
            "native double operator-<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) - readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native int operator*<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) * readNumber(right.loadValue()!)) | 0);
            });
        
        this._map.set(
            "native uint operator*<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) * readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native float operator*<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(Math.fround(readNumber(left.loadValue()!) * readNumber(right.loadValue()!)));
            });
        
        this._map.set(
            "native double operator*<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) * readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native int operator/<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) / readNumber(right.loadValue()!)) | 0);
            });
        
        this._map.set(
            "native uint operator/<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) / readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native int operator&<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) & readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native uint operator&<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) & readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native int operator|<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) | readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native uint operator|<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) | readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native int operator^<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) ^ readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native uint operator^<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) ^ readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native int operator<<<>(int,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) << readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native uint operator<<<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box((readNumber(left.loadValue()!) << readNumber(right.loadValue()!)) >>> 0);
            });
        
        this._map.set(
            "native int operator>><>(int,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) >> readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native uint operator>><>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) >>> readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native int operator~<>(int)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box(~value.loadValue()!);
            });
        
        this._map.set(
            "native uint operator~<>(uint)",
            (func: NativeFunc) => {
                func.implementation = ([value]) => EPtr.box((~value.loadValue()!) >>> 0);
            });
        
        this._map.set(
            "native float operator/<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(Math.fround(readNumber(left.loadValue()!) / readNumber(right.loadValue()!)));
            });
        
        this._map.set(
            "native double operator/<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(readNumber(left.loadValue()!) / readNumber(right.loadValue()!));
            });
        
        this._map.set(
            "native bool operator==<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue() == right.loadValue());
            });
        
        this._map.set(
            "native bool operator==<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue() == right.loadValue());
            });
        
        this._map.set(
            "native bool operator==<>(bool,bool)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue() == right.loadValue());
            });
        
        this._map.set(
            "native bool operator==<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue() == right.loadValue());
            });
        
        this._map.set(
            "native bool operator==<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue() == right.loadValue());
            });
        
        this._map.set(
            "native bool operator<<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! < right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! < right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! < right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! < right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<=<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! <= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<=<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! <= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<=<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! <= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator<=<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! <= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator><>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! > right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator><>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! > right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator><>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! > right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator><>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! > right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator>=<>(int,int)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! >= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator>=<>(uint,uint)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! >= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator>=<>(float,float)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! >= right.loadValue()!);
            });
        
        this._map.set(
            "native bool operator>=<>(double,double)",
            (func: NativeFunc) => {
                func.implementation = ([left, right]) =>
                    EPtr.box(left.loadValue()! >= right.loadValue()!);
            });
        
        for (let addressSpace of addressSpaces) {
            this._map.set(
                `native T* ${addressSpace} operator&[]<T>(T[] ${addressSpace},uint)`,
                (func: NativeFunc) => {
                    func.implementation = ([ref, index]: Slot[], node: CallExpression) => {
                        ref = readOptionalInstance(readInstance(ref, EPtr).loadValue(), EArrayRef);
                        if (!ref)
                            throw new WTrapError(node.origin!.originString, "Null dereference");
                        index = readNumber(readInstance(index, EPtr).loadValue());
                        if (index > ref.length)
                            throw new WTrapError(node.origin!.originString, "Array index " + index + " is out of bounds of " + ref);
                        return EPtr.box(ref.ptr.plus(readNumber(index) * readInstance(node.instantiatedActualTypeArguments![0], Type).size));
                    };
                });

            this._map.set(
                `native uint operator.length<T>(T[] ${addressSpace})`,
                (func: NativeFunc) => {
                    func.implementation = ([ref]: Slot[], node: CallExpression) => {
                        ref = readOptionalInstance(readInstance(ref, EPtr).loadValue(), EArrayRef);
                        if (!ref)
                            return EPtr.box(0);
                        return EPtr.box(ref.length);
                    };
                });
        }
    }
    
    add(thing: NamedNode)
    {
        let intrinsic = this._map.get(thing.toString());
        if (!intrinsic)
            throw new WTypeError(thing.origin.originString, "Unrecognized intrinsic: " + thing);
        callLegacy(intrinsic, thing);
    }
}



// Upstream source: ./WSL/LateChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class LateChecker extends Visitor {
    visitReferenceType(node: ReferenceType)
    {
        if (node.addressSpace == "thread")
            return;
        
        if (!node.elementType.isPrimitive)
            throw new WTypeError(node.origin.originString, "Illegal pointer to non-primitive type: " + node);
    }
    
    _checkShaderType(node: FuncDef)
    {
        // FIXME: Tighten these checks. For now, we should only accept int32, uint32, float32, and float64.
        let assertPrimitive = (type: Type) => {
            if (!type.isPrimitive)
                throw new WTypeError(node.origin!.originString, "Shader signature cannot include non-primitive type: " + type);
        }
        assertPrimitive(node.returnType);
        if (!(node.returnType.unifyNode instanceof StructType))
            throw new WTypeError(node.origin!.originString, "Vertex shader " + node.name + " must return a struct.");
        switch (node.shaderType) {
        case "vertex":
            for (let parameter of node.parameters) {
                if (parameter.type.unifyNode instanceof StructType)
                    assertPrimitive(parameter.type);
                else if (!parameter.type.unifyNode.isArrayRef)
                    throw new WTypeError(node.origin!.originString, node.name + " accepts a parameter " + parameter.name + " which isn't a struct and isn't an ArrayRef.");
            }
            break;
        case "fragment":
            for (let parameter of node.parameters) {
                if (parameter.name == "stageIn") {
                    if (!(parameter.type.unifyNode instanceof StructType))
                        throw new WTypeError(node.origin!.originString, "Fragment entry points' stageIn parameter (of " + node.name + ") must be a struct type.");
                    assertPrimitive(parameter.type);
                } else {
                    if (!parameter.type.unifyNode.isArrayRef)
                        throw new WTypeError(node.origin!.originString, "Fragment entry point's " + parameter.name + " parameter is not an array reference.");
                }
            }
            break;
        default:
            throw new Error("Bad shader type: " + node.shaderType);
        }
    }
    
    visitFuncDef(node: FuncDef)
    {
        if (node.shaderType)
            this._checkShaderType(node);
        super.visitFuncDef(node);
    }
}



// Upstream source: ./WSL/Lexer.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Lexer {
    declare _origin: string;
    declare _stack: (LexerToken | null | undefined)[];
    declare _originKind: string;
    declare _lineNumberOffset: number;
    declare _text: string;
    declare _index: number;

    constructor(origin: string, originKind: string, lineNumberOffset: number, text: string)
    {
        if (!isOriginKind(originKind))
            throw new Error("Bad origin kind: " + originKind);
        this._origin = origin;
        this._originKind = originKind;
        this._lineNumberOffset = lineNumberOffset;
        this._text = text;
        this._index = 0;
        this._stack = [];
    }
    
    get lineNumber()
    {
        return this.lineNumberForIndex(this._index);
    }
    
    get origin() { return this._origin; }
    
    get originString()
    {
        return this._origin + ":" + (this.lineNumber + 1);
    }
    
    get originKind() { return this._originKind; }
    
    lineNumberForIndex(index: number)
    {
        let matches = this._text.substring(0, index).match(/\n/g);
        return (matches ? matches.length : 0) + this._lineNumberOffset;
    }
    
    get state() { return {index: this._index, stack: this._stack.concat()}; }
    set state(value: {index:number;stack:(LexerToken|null|undefined)[]})
    {
        this._index = value!.index;
        this._stack = value!.stack;
    }
    
    static _textIsIdentifierImpl(text: string)
    {
        return /^[^\d\W]\w*/.test(text);
    }
    
    static textIsIdentifier(text: string)
    {
        return Lexer._textIsIdentifierImpl(text) && !RegExp.rightContext.length;
    }
    
    next()
    {
        if (this._stack.length)
            return this._stack.pop();
        
        if (this._index >= this._text.length)
            return null;
        
        const isCCommentBegin = /\/\*/;
        const isCPlusPlusCommentBegin = /\/\//;
        
        let result = (kind: string) => {
            let text = RegExp.lastMatch;
            let token = new LexerToken(this, this._index, kind, text);
            this._index += text.length;
            return token;
        };

        let relevantText;
        for (;;) {
            relevantText = this._text.substring(this._index);
            if (/^\s+/.test(relevantText)) {
                this._index += RegExp.lastMatch.length;
                continue;
            }
            if (/^\/\*/.test(relevantText)) {
                let endIndex = relevantText.search(/\*\//);
                if (endIndex < 0)
                    this.fail("Unterminated comment");
                this._index += endIndex;
                continue;
            }
            if (/^\/\/.*/.test(relevantText)) {
                this._index += RegExp.lastMatch.length;
                continue;
            }
            break;
        }
        
        if (this._index >= this._text.length)
            return null;

        // FIXME: Make this handle exp-form literals like 1e1.
        if (/^(([0-9]*\.[0-9]+[fd]?)|([0-9]+\.[0-9]*[fd]?))/.test(relevantText))
            return result("floatLiteral");
        
        // FIXME: Make this do Unicode.
        if (Lexer._textIsIdentifierImpl(relevantText)) {
            if (/^(struct|protocol|typedef|if|else|enum|continue|break|switch|case|default|for|while|do|return|constant|device|threadgroup|thread|operator|null|true|false)$/.test(RegExp.lastMatch))
                return result("keyword");
            
            if (this._originKind == "native" && /^(native|restricted)$/.test(RegExp.lastMatch))
                return result("keyword");
            
            return result("identifier");
        }

        if (/^0x[0-9a-fA-F]+u/.test(relevantText))
            return result("uintHexLiteral");

        if (/^0x[0-9a-fA-F]+/.test(relevantText))
            return result("intHexLiteral");

        if (/^[0-9]+u/.test(relevantText))
            return result("uintLiteral");

        if (/^[0-9]+/.test(relevantText))
            return result("intLiteral");
        
        if (/^<<|>>|->|>=|<=|==|!=|\+=|-=|\*=|\/=|%=|\^=|\|=|&=|\+\+|--|&&|\|\||([{}()\[\]?:=+*\/,.%!~^&|<>@;-])/.test(relevantText))
            return result("punctuation");
        
        let remaining = relevantText.substring(0, 20).split(/\s/)[0];
        if (!remaining.length)
            remaining = relevantText.substring(0, 20);
        this.fail("Unrecognized token beginning with: " + remaining);
    }
    
    push(token: LexerToken | null | undefined)
    {
        this._stack.push(token);
    }
    
    peek()
    {
        let result = this.next();
        this.push(result);
        return result;
    }
    
    fail(error: string): never
    {
        throw new WSyntaxError(this.originString, error);
    }
    
    backtrackingScope<T>(callback: ()=>T): T | null
    {
        let state = this.state;
        try {
            return callback();
        } catch (e) {
            if (e instanceof WSyntaxError) {
                this.state = state;
                return null;
            }
            throw e;
        }
    }
    
    testScope(callback: ()=>unknown)
    {
        let state = this.state;
        try {
            callback();
            return true;
        } catch (e) {
            if (e instanceof WSyntaxError)
                return false;
            throw e;
        } finally {
            this.state = state;
        }
    }
}


// Upstream source: ./WSL/LexerToken.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class LexerToken {
    declare _origin: string;
    declare _lexer: Lexer;
    declare _index: number | LexerToken;
    declare _kind: string | number | LexerToken;
    declare _text: string;

    constructor(lexer:Lexer,index:number|LexerToken,kind:string|number|LexerToken,text:string,ignored?:string);
    constructor(lexer: Lexer, index: number | LexerToken, kind: string | number | LexerToken, text: string)
    {
        this._lexer = lexer;
        this._index = index;
        this._kind = kind;
        this._text = text;
    }
    
    get lexer()
    {
        return this._lexer;
    }
    
    get kind()
    {
        return this._kind;
    }
    
    get text()
    {
        return this._text;
    }
    
    get origin()
    {
        return this.lexer.origin;
    }
    
    get originKind()
    {
        return this.lexer.originKind;
    }
    
    get index()
    {
        return this._index;
    }
    
    get lineNumber()
    {
        return this._lexer.lineNumberForIndex(Number(this._index));
    }
    
    get originString()
    {
        return this.origin + ":" + (this.lineNumber + 1);
    }
    
    toString()
    {
        return "LexerToken(" + this.kind + ", " + this.text + ", " + this.lineNumber + ")";
    }
}


// Upstream source: ./WSL/LiteralTypeChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This phase is for asserting that the compiler didn't violate its internal constraints, so it
// throws Error not WTypeError.
//
// The reason this phase exists is that in a compiler, we need literals like null and 0 to know their
// exact type so that they know how many bytes they occupy and how to set their default value. For
// example, null for ^ will probably take one pointer-sized word while null for [] will take two words
// (one for base and one for length). The type checker is equipped to infer this, and this phase's job
// is just to verify that the type checker succeeded.
class LiteralTypeChecker extends Visitor {
    visitNullType(node: NullType)
    {
        if (!node.type)
            throw new Error("Null at " + node.origin.originString + " does not have type");
    }
    
    visitGenericLiteralType(node: GenericLiteralType)
    {
        if (!node.type)
            throw new Error(node + " at " + node.origin.originString + " does not have type");
    }
}



// Upstream source: ./WSL/LogicalExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class LogicalExpression extends Expression {
    declare _left: Value;
    declare _right: Value;

    declare _text: string;

    constructor(origin: Origin, text: string, left: Value, right: Value)
    {
        super(origin);
        this._text = text;
        this._left = left;
        this._right = right;
    }
    
    get text() { return this._text; }
    get left() { return this._left; }
    get right() { return this._right; }
    
    toString()
    {
        return "(" + this.left + " " + this.text + " " + this.right + ")";
    }
}



// Upstream source: ./WSL/LogicalNot.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class LogicalNot extends Expression {
    declare _operand: Value;

    constructor(origin: Origin, operand: Value)
    {
        super(origin);
        this._operand = operand;
    }
    
    get operand() { return this._operand; }
    
    toString()
    {
        return "!(" + this.operand + ")";
    }
}



// Upstream source: ./WSL/LoopChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class LoopChecker extends Visitor {
    declare _loopDepth: number;
    declare _switchDepth: number;

    constructor()
    {
        super();
        this._loopDepth = 0;
        this._switchDepth = 0;
    }

    visitFuncDef(node: FuncDef)
    {
        if (this._loopDepth != 0)
            throw new WTypeError(node.origin.originString, "LoopChecker does not understand nested functions.");
        super.visitFuncDef(node);
    }

    visitWhileLoop(node: WhileLoop)
    {
        node.conditional.visit(this);
        ++this._loopDepth;
        node.body!.visit(this);
        if (this._loopDepth == 0)
            throw new WTypeError(node.origin.originString, "The number of nested loops is negative!");
        --this._loopDepth;
    }

    visitDoWhileLoop(node: DoWhileLoop)
    {
        ++this._loopDepth;
        node.body!.visit(this);
        if (this._loopDepth == 0)
            throw new WTypeError(node.origin.originString, "The number of nested loops is negative!");
        --this._loopDepth;
        node.conditional.visit(this);
    }

    visitForLoop(node: ForLoop)
    {
        if (node.initialization)
            node.initialization.visit(this);
        if (node.condition)
            node.condition.visit(this);
        if (node.increment)
            node.increment.visit(this);
        ++this._loopDepth;
        node.body!.visit(this);
        if (this._loopDepth == 0)
            throw new WTypeError(node.origin.originString, "The number of nested loops is negative!");
        --this._loopDepth;
    }
    
    visitSwitchStatement(node: SwitchStatement)
    {
        node.value.visit(this);
        this._switchDepth++;
        for (let switchCase of node.switchCases)
            switchCase.visit(this);
        this._switchDepth--;
    }
    
    visitBreak(node: Break)
    {
        if (this._loopDepth == 0 && this._switchDepth == 0)
            throw new WTypeError(node.origin.originString, "Break statement without enclosing loop or switch!");
        super.visitBreak(node);
    }
    
    visitContinue(node: Continue)
    {
        if (this._loopDepth == 0)
            throw new WTypeError(node.origin.originString, "Continue statement without enclosing loop!");
        super.visitContinue(node);
    }
}


// Upstream source: ./WSL/MakeArrayRefExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class MakeArrayRefExpression extends Expression {
    declare _lValue: Value;
    declare numElements: Value;

    constructor(origin: Origin, lValue: Value)
    {
        super(origin);
        this._lValue = lValue;
    }
    
    get lValue() { return this._lValue; }
    
    toString()
    {
        return "@" + (this.numElements ? "<<" + this.numElements + ">>" : "") + "(" + this.lValue + ")";
    }
}



// Upstream source: ./WSL/MakePtrExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class MakePtrExpression extends Expression {
    declare _lValue: Value;

    constructor(origin: Origin, lValue: Value)
    {
        super(origin);
        this._lValue = lValue;
    }
    
    get lValue() { return this._lValue; }
    
    toString()
    {
        return "&(" + this.lValue + ")";
    }
}


// Upstream source: ./WSL/NameContext.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

const Anything = Symbol();

function isWildcardKind(kind: Kind | symbol | null)
{
    return kind == Anything;
}

class NameContext {
    declare _set: Set<NamedNode>;

    declare _delegate: NameContext | undefined;
    declare _map: Map<string, NameEntry>;
    declare _intrinsics: Intrinsics | null;
    declare _program: Program | null;
    declare _currentStatement: Node | null;

    constructor(delegate?: NameContext)
    {
        this._map = new Map();
        this._set = new Set();
        this._currentStatement = null;
        this._delegate = delegate;
        this._intrinsics = null;
        this._program = null;
    }
    
    add(thing: Node)
    {
        if (!thing.name)
            return;
        if (!isNamedNode(thing)) throw new TypeError("Expected named WSL node");
        if (!thing.origin)
            throw new Error("Thing does not have origin: " + thing);
        
        if (thing.isNative && !readProperty(thing, "implementation")) {
            if (!this._intrinsics)
                throw new Error("Native function in a scope that does not recognize intrinsics");
            this._intrinsics.add(thing);
        }
        
        if (thing.kind == Func) {
            this._set.add(thing);
            let array = this._map.get(thing.name);
            if (!array) {
                array = [];
                array.kind = Func;
                this._map.set(thing.name, array);
            }
            if (array.kind != Func)
                throw new WTypeError(thing.origin.originString, "Cannot reuse type name for function: " + thing.name);
            readInstances(array, Func).push(readInstance(thing, Func));
            return;
        }
        if (this._map.has(thing.name))
            throw new WTypeError(thing.origin.originString, "Duplicate name: " + thing.name);
        this._set.add(thing);
        this._map.set(thing.name, thing);
    }
    
    get(kind: typeof Func, name:string | null | undefined): FuncGroup | null | undefined;
    get(kind: typeof Type, name:string | null | undefined): Type | null | undefined;
    get(kind: typeof Value, name:string | null | undefined): Variable | null | undefined;
    get(kind: typeof Protocol, name:string | null | undefined): ProtocolDecl | null | undefined;
    get(kind: Kind | symbol, name:string | null | undefined): NameEntry | null | undefined;
    get(kind: Kind | symbol, name: string | null | undefined): NameEntry | null | undefined
    {
        let result = this._map.get(name!);
        if (!result && this._delegate)
            return this._delegate.get(kind, name);
        if (result && !isWildcardKind(kind) && result.kind != kind)
            return null;
        return result;
    }
    
    underlyingThings(kind: Kind | symbol, name: string | null | undefined)
    {
        let things = this.get(kind, name);
        return NameContext.underlyingThings(things);
    }
    
    static *underlyingThings(thing: NameEntry | null | undefined): Generator<NamedNode>
    {
        if (!thing)
            return;
        if (thing.kind === Func) {
            if (!(thing instanceof Array))
                throw new Error("Func thing is not array: " + thing);
            for (let func of thing)
                yield func;
            return;
        }
        if (Array.isArray(thing)) throw new TypeError("Expected individual named WSL node");
        yield thing;
    }
    
    resolveFuncOverload(name: string | null | undefined, typeArguments: Node[], argumentTypes: Type[], returnType: Type | null | undefined, allowEntryPoint = false)
    {
        let functions = this.get(Func, name);
        if (!functions)
            return {failures: []};
        
        return resolveOverloadImpl(functions, typeArguments, argumentTypes, returnType, allowEntryPoint);
    }
    
    get currentStatement(): Node | null
    {
        if (this._currentStatement)
            return this._currentStatement;
        if (this._delegate)
            return this._delegate.currentStatement;
        return null;
    }
    
    doStatement(statement: Node, callback: ()=>unknown)
    {
        this._currentStatement = statement;
        callback();
        this._currentStatement = null;
    }
    
    recognizeIntrinsics()
    {
        this._intrinsics = new Intrinsics(this);
    }
    
    get intrinsics(): Intrinsics | null
    {
        if (this._intrinsics)
            return this._intrinsics;
        if (this._delegate)
            return this._delegate.intrinsics;
        return null;
    }
    
    set program(value: Program | null)
    {
        this._program = readOptionalInstance(value, Program);
    }
    
    get program(): Program | null
    {
        if (this._program)
            return this._program;
        if (this._delegate)
            return this._delegate.program;
        return null;
    }
    
    *[Symbol.iterator]()
    {
        for (let value of this._map.values()) {
            if (value instanceof Array) {
                for (let func of value)
                    yield func;
                continue;
            }
            yield value;
        }
    }
}


// Upstream source: ./WSL/NameFinder.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NameFinder extends Visitor {
    declare _set: Set<string | null | undefined>;
    declare _worklist: (string | null | undefined)[];

    constructor()
    {
        super();
        this._set = new Set();
        this._worklist = [];
    }
    
    get set() { return this._set; }
    get worklist() { return this._worklist; }
    
    add(name: string | null | undefined)
    {
        if (this._set.has(name))
            return;
        this._set.add(name);
        this._worklist.push(name);
    }
    
    visitProtocolRef(node: ProtocolRef)
    {
        this.add(node.name);
        super.visitProtocolRef(node);
    }
    
    visitTypeRef(node: TypeRef)
    {
        this.add(node.name);
        super.visitTypeRef(node);
    }
    
    visitVariableRef(node: VariableRef)
    {
        this.add(node.name);
        super.visitVariableRef(node);
    }
    
    visitTypeOrVariableRef(node: TypeOrVariableRef)
    {
        this.add(node.name);
    }

    _handlePropertyAccess(node: PropertyAccessExpression)
    {
        this.add(node.getFuncName);
        this.add(node.setFuncName);
        this.add(node.andFuncName);
    }
    
    visitDotExpression(node: DotExpression)
    {
        this._handlePropertyAccess(node);
        super.visitDotExpression(node);
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        this._handlePropertyAccess(node);
        super.visitIndexExpression(node);
    }
    
    visitCallExpression(node: CallExpression)
    {
        this.add(node.name);
        super.visitCallExpression(node);
    }
}



// Upstream source: ./WSL/NameResolver.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This only resolves names. After this phase runs, all names will be resolved. This means that all
// XYZRef objects now know who they resolve to. This does not yet allow type analysis, because there
// are still TypeDefs. This throws type errors for failed name resolutions and for things that are
// more convenient to check here than in the Checker. This usually involves things that need to be
// checked before TypeRefToTypeDefSkipper.
class NameResolver extends Visitor {
    declare _nameContext: NameContext;

    constructor(nameContext: NameContext)
    {
        super();
        this._nameContext = nameContext;
    }

    doStatement(statement: Node)
    {
        this._nameContext.doStatement(statement, () => statement.visit(this));
    }
    
    _visitTypeParametersAndBuildNameContext(node: Func | Type)
    {
        let nameContext = new NameContext(this._nameContext);
        for (let typeParameter of node.typeParameters) {
            nameContext.add(typeParameter);
            typeParameter.visit(this);
        }
        return nameContext;
    }
    
    visitFunc(node: Func)
    {
        let checker = new NameResolver(this._visitTypeParametersAndBuildNameContext(node));
        node.returnType.visit(checker);
        for (let parameter of node.parameters)
            parameter.visit(checker);
    }
    
    visitFuncDef(node: FuncDef)
    {
        let contextWithTypeParameters = this._visitTypeParametersAndBuildNameContext(node);
        let checkerWithTypeParameters = new NameResolver(contextWithTypeParameters);
        node.returnType.visit(checkerWithTypeParameters);
        let contextWithParameters = new NameContext(contextWithTypeParameters);
        for (let parameter of node.parameters) {
            parameter.visit(checkerWithTypeParameters);
            contextWithParameters.add(parameter);
        }
        let checkerWithParameters = new NameResolver(contextWithParameters);
        node.body.visit(checkerWithParameters);
    }
    
    visitBlock(node: Block)
    {
        let checker = new NameResolver(new NameContext(this._nameContext));
        for (let statement of node.statements)
            statement.visit(checker);
    }

    visitIfStatement(node: IfStatement)
    {
        node.conditional.visit(this);
        // The bodies might not be Blocks, so we need to explicitly give them a new context.
        node.body!.visit(new NameResolver(new NameContext(this._nameContext)));
        if (node.elseBody)
            node.elseBody.visit(new NameResolver(new NameContext(this._nameContext)));
    }

    visitWhileLoop(node: WhileLoop)
    {
        node.conditional.visit(this);
        // The bodies might not be Blocks, so we need to explicitly give them a new context.
        node.body!.visit(new NameResolver(new NameContext(this._nameContext)));
    }

    visitDoWhileLoop(node: DoWhileLoop)
    {
        // The bodies might not be Blocks, so we need to explicitly give them a new context.
        node.body!.visit(new NameResolver(new NameContext(this._nameContext)));
        node.conditional.visit(this);
    }

    visitForLoop(node: ForLoop)
    {
        let newResolver = new NameResolver(new NameContext(this._nameContext))
        if (node.initialization)
            node.initialization.visit(newResolver);
        if (node.condition)
            node.condition.visit(newResolver);
        if (node.increment)
            node.increment.visit(newResolver);
        node.body!.visit(newResolver);
    }
    
    visitProtocolDecl(node: ProtocolDecl)
    {
        for (let parent of node.extends)
            parent.visit(this);
        let nameContext = new NameContext(this._nameContext);
        nameContext.add(node.typeVariable);
        let checker = new NameResolver(nameContext);
        for (let signature of node.signatures)
            signature.visit(checker);
    }
    
    visitProtocolRef(node: ProtocolRef)
    {
        let result = this._nameContext.get(Protocol, node.name);
        if (!result)
            throw new WTypeError(node.origin.originString, "Could not find protocol named " + node.name);
        node.protocolDecl = result;
    }
    
    visitProtocolFuncDecl(node: ProtocolFuncDecl)
    {
        this.visitFunc(node);
        let funcs = this._nameContext.get(Func, node.name);
        if (!funcs)
            throw new WTypeError(node.origin.originString, "Cannot find any functions named " + node.name);
        node.possibleOverloads = funcs;
    }
    
    visitTypeDef(node: TypeDef)
    {
        let nameContext = new NameContext(this._nameContext);
        for (let typeParameter of node.typeParameters) {
            typeParameter.visit(this);
            nameContext.add(typeParameter);
        }
        let checker = new NameResolver(nameContext);
        node.type.visit(checker);
    }
    
    visitStructType(node: StructType)
    {
        let nameContext = new NameContext(this._nameContext);
        for (let typeParameter of node.typeParameters) {
            typeParameter.visit(this);
            nameContext.add(typeParameter);
        }
        let checker = new NameResolver(nameContext);
        for (let field of node.fields)
            field.visit(checker);
    }
    
    _resolveTypeArguments(typeArguments: Node[])
    {
        for (let i = 0; i < typeArguments.length; ++i) {
            let typeArgument = typeArguments[i];
            if (typeArgument instanceof TypeOrVariableRef) {
                let thing = this._nameContext.get(Anything, typeArgument.name);
                if (!thing)
                    new WTypeError(typeArgument.origin.originString, "Could not find type or variable named " + typeArgument.name);
                if (thing instanceof Value)
                    typeArguments[i] = new VariableRef(typeArgument.origin, typeArgument.name);
                else if (thing instanceof Type)
                    typeArguments[i] = new TypeRef(typeArgument.origin, typeArgument.name, []);
                else
                    throw new WTypeError(typeArgument.origin.originString, "Type argument resolved to wrong kind of thing: " + thing!.kind);
            }
            
            if (readProperty(typeArgument, String(i)) instanceof Value
                && !readInstance(readProperty(typeArgument, String(i)), Value).isConstexpr)
                throw new WTypeError(readInstance(readProperty(typeArgument, String(i)), Value).origin.originString, "Expected constexpr");
        }
    }
    
    visitTypeRef(node: TypeRef)
    {
        this._resolveTypeArguments(node.typeArguments);
        
        let type = node.type;
        if (!type) {
            type = this._nameContext.get(Type, node.name)!;
            if (!type)
                throw new WTypeError(node.origin.originString, "Could not find type named " + node.name);
            node.type = type;
        }
        
        if (type.typeParameters.length != node.typeArguments.length)
            throw new WTypeError(node.origin.originString, "Wrong number of type arguments (passed " + node.typeArguments.length + ", expected " + type.typeParameters.length + ")");
        for (let i = 0; i < type.typeParameters.length; ++i) {
            let parameterIsType = type.typeParameters[i] instanceof TypeVariable;
            let argumentIsType = node.typeArguments[i] instanceof Type;
            node.typeArguments[i].visit(this);
            if (parameterIsType && !argumentIsType)
                throw new WTypeError(node.origin.originString, "Expected type, but got value at argument #" + i);
            if (!parameterIsType && argumentIsType)
                throw new WTypeError(node.origin.originString, "Expected value, but got type at argument #" + i);
        }
    }
    
    visitReferenceType(node: ReferenceType)
    {
        let nameContext = new NameContext(this._nameContext);
        node.elementType.visit(new NameResolver(nameContext));
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        this._nameContext.add(node);
        node.type.visit(this);
        if (node.initializer)
            node.initializer.visit(this);
    }

    visitVariableRef(node: VariableRef)
    {
        if (node.variable)
            return;
        let result = this._nameContext.get(Value, node.name);
        if (!result)
            throw new WTypeError(node.origin.originString, "Could not find variable named " + node.name);
        node.variable = result;
    }
    
    visitReturn(node: Return)
    {
        node.func = readInstance(this._nameContext.currentStatement, Func);
        super.visitReturn(node);
    }
    
    _handlePropertyAccess(node: PropertyAccessExpression)
    {
        node.possibleGetOverloads = this._nameContext.get(Func, node.getFuncName);
        node.possibleSetOverloads = this._nameContext.get(Func, node.setFuncName);
        node.possibleAndOverloads = this._nameContext.get(Func, node.andFuncName);

        if (!node.possibleGetOverloads && !node.possibleAndOverloads)
            throw new WTypeError(node.origin.originString, "Cannot find either " + node.getFuncName + " or " + node.andFuncName);
    }
    
    visitDotExpression(node: DotExpression)
    {
        // This could be a reference to an enum. Let's resolve that now.
        if (node.struct instanceof VariableRef) {
            let enumType = this._nameContext.get(Type, node.struct.name);
            if (enumType && enumType instanceof EnumType) {
                let enumMember = enumType.memberByName(node.fieldName);
                if (!enumMember)
                    throw new WTypeError(node.origin.originString, "Enum " + enumType.name + " does not have a member named " + node.fieldName);
                node.become(new EnumLiteral(node.origin, enumMember));
                return;
            }
        }
        
        this._handlePropertyAccess(node);
        super.visitDotExpression(node);
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        this._handlePropertyAccess(node);
        super.visitIndexExpression(node);
    }
    
    visitCallExpression(node: CallExpression)
    {
        this._resolveTypeArguments(node.typeArguments);
        
        let funcs = this._nameContext.get(Func, node.name);
        if (funcs)
            node.possibleOverloads = funcs;
        else {
            let type = this._nameContext.get(Type, node.name)!;
            if (!type)
                throw new WTypeError(node.origin.originString, "Cannot find any function or type named \"" + node.name + "\"");
            node.becomeCast(type);
            node.possibleOverloads = this._nameContext.get(Func, "operator cast");
            if (!node.possibleOverloads)
                throw new WTypeError(node.origin.originString, "Cannot find any operator cast implementations in cast to " + type);
        }
        
        super.visitCallExpression(node);
    }
}



// Upstream source: ./WSL/NativeFunc.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NativeFunc extends Func {
    declare implementation: ((args: EPtr[], node: CallExpression) => EPtr) | null;
    declare instantiateImplementation: (substitution: Substitution) => unknown;
    declare visitImplementationData: (data: unknown, visitor: object) => unknown;
    declare didLayoutStructsInImplementationData: (data: unknown) => unknown;
    declare isRestricted: boolean;

    constructor(origin: Origin, name: string, returnType: Type, typeParameters: Node[], parameters: FuncParameter[], isCast: boolean, shaderType: string | null | undefined)
    {
        super(origin, name, returnType, typeParameters, parameters, isCast, shaderType);
        this.isRestricted = false;
        this.implementation = null;
        this.instantiateImplementation = (substitution) => {};
        this.visitImplementationData = (implementationData, visitor) => null;
        this.didLayoutStructsInImplementationData = (implementationData) => null;
    }
    
    get isNative() { return true; }

    toDeclString()
    {
        return "native " + super.toDeclString();
    }
}



// Upstream source: ./WSL/NativeFuncInstance.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NativeFuncInstance extends Func {
    declare _implementationData: unknown;

    declare _func: NativeFunc;

    constructor(func: NativeFunc, returnType: Type, parameters: FuncParameter[], isCast: boolean, shaderType: string | null | undefined, implementationData: unknown)
    {
        super(func.origin, func.name, returnType, [], parameters, isCast, shaderType);
        this._func = func;
        this._implementationData = implementationData;
    }
    
    get func() { return this._func; }
    get isNative() { return true; }
    get implementationData() { return this._implementationData; }

    toDeclString()
    {
        return "native " + super.toDeclString();
    }
}



// Upstream source: ./WSL/NativeType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NativeType extends Type {
    declare size: number;
    declare defaultValue: number;
    declare isSigned: boolean;
    declare populateDefaultValue: (buffer:EBuffer,offset:number)=>void;
    declare canRepresent: (value:number)=>boolean;
    declare successorValue: (value:number)=>number;
    declare valuesEqual: (a:unknown,b:unknown)=>boolean;
    declare createLiteral: (origin:Origin,value:number)=>Value;
    declare allValues: ()=>Generator<{value:number,name:number}>;
    declare formatValueFromIntLiteral: (value:number)=>number;
    declare formatValueFromUintLiteral: (value:number)=>number;
    declare formatValueFromFloatLiteral: (value:number)=>number;
    declare formatValueFromDoubleLiteral: (value:number)=>number;

    declare _origin: Origin;
    declare _name: string;
    declare _typeParameters: Node[];
    declare _isNumber: boolean;
    declare _isInt: boolean;
    declare _isFloating: boolean;
    declare _isPrimitive: boolean;

    constructor(origin: Origin, name: string, typeParameters: Node[])
    {
        if (!(typeParameters instanceof Array))
            throw new Error("type parameters not array: " + typeParameters);
        super();
        this._origin = origin;
        this._name = name;
        this._typeParameters = typeParameters;
        this._isNumber = false;
        this._isInt = false;
        this._isFloating = false;
        this._isPrimitive = false;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get typeParameters() { return this._typeParameters; }
    get isNative() { return true; }
    
    // We let Intrinsics.js set these as it likes.
    get isNumber() { return this._isNumber; }
    set isNumber(value: boolean) { this._isNumber = value; }
    get isInt() { return this._isInt; }
    set isInt(value: boolean) { this._isInt = value; }
    get isFloating() { return this._isFloating; }
    set isFloating(value: boolean) { this._isFloating = value; }
    get isPrimitive(): boolean | number | null | undefined { return this._isPrimitive; }
    set isPrimitive(value: boolean) { this._isPrimitive = value; }
    
    instantiate(typeArguments: Node[])
    {
        if (typeArguments.length != this.typeParameters.length)
            throw new Error("Wrong number of type arguments to instantiation");
        if (!typeArguments.length)
            return this;
        return new NativeTypeInstance(this, typeArguments);
    }
    
    toString()
    {
        return "native typedef " + this.name + "<" + this.typeParameters + ">";
    }
}



// Upstream source: ./WSL/NativeTypeInstance.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NativeTypeInstance extends Type {
    declare _type: NativeType;
    declare _typeArguments: Node[];

    constructor(type: NativeType, typeArguments: Node[])
    {
        super();
        this._type = type;
        this._typeArguments = typeArguments;
    }
    
    get type() { return this._type; }
    get typeArguments() { return this._typeArguments; }
    get isPrimitive(): boolean | number | null | undefined { return this._type.isPrimitive; }
    get isNative() { return true; }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (this.type != readProperty(other, "type"))
            return false;
        if (!(other instanceof NativeTypeInstance)) throw new TypeError("Expected WSL native type instance");
        if (this.typeArguments.length != other.typeArguments.length)
            return false;
        for (let i = 0; i < this.typeArguments.length; ++i) {
            if (!this.typeArguments[i].unify(unificationContext, other.typeArguments[i]))
                return false;
        }
        return true;
    }
    
    toString()
    {
        return this.type + "<" + this.typeArguments + ">";
    }
}



// Upstream source: ./WSL/NormalUsePropertyResolver.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NormalUsePropertyResolver extends Rewriter {
    visitDotExpression(node: DotExpression)
    {
        return readInstance(super.visitDotExpression(node), DotExpression).rewriteAfterCloning();
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        return readInstance(super.visitIndexExpression(node), IndexExpression).rewriteAfterCloning();
    }
}



// Upstream source: ./WSL/NullLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NullLiteral extends Expression {
    declare type: Type | null;

    constructor(origin: Origin)
    {
        super(origin);
        this.type = new NullType(origin);
    }
    
    toString()
    {
        return "null";
    }
}



// Upstream source: ./WSL/NullType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class NullType extends Type {
    declare _origin: Origin;
    declare type: Type | null;

    constructor(origin: Origin)
    {
        super();
        this._origin = origin;
    }
    
    get origin() { return this._origin; }
    
    // For now we answer false for isPtr and isArrayRef because that happens to make all of the logic
    // work. But, it's strange, since as a bottom type it really is the case that this is both isPtr and
    // isArrayRef.
    
    get isPrimitive(): boolean | number | null | undefined { return true; }
    get isUnifiable() { return true; }
    get isLiteral() { return true; }
    
    typeVariableUnify(unificationContext: UnificationContext, other: Node)
    {
        if (!(other instanceof Type))
            return false;
        
        return this._typeVariableUnifyImpl(unificationContext, other);
    }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        return this.typeVariableUnify(unificationContext, other);
    }
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        let realThis = unificationContext.find(this);
        if (realThis.isPtr || realThis.isArrayRef)
            return {result: true};
        return {result: false, reason: "Null cannot be used with non-pointer type " + realThis};
    }
    
    verifyAsParameter(unificationContext: UnificationContext): Verification
    {
        throw new Error("NullType should never be used as a type parameter");
    }
    
    commitUnification(unificationContext: UnificationContext)
    {
        this.type = unificationContext.find(this);
    }
    
    toString()
    {
        return "nullType";
    }
}



// Upstream source: ./WSL/OriginKind.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

const originKinds = ["native", "user"];

function isOriginKind(originKind: string)
{
    switch (originKind) {
    case "native":
    case "user":
        return true;
    default:
        return false;
    }
}



// Upstream source: ./WSL/OverloadResolutionFailure.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class OverloadResolutionFailure {
    declare _func: Func;
    declare _reason: string;

    constructor(func: Func, reason: string)
    {
        this._func = func;
        this._reason = reason;
    }
    
    get func() { return this._func; }
    get reason() { return this._reason; }
    
    toString()
    {
        return this.func.toDeclString() + " did not match because: " + this.reason;
    }
}



// Upstream source: ./WSL/Parse.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function parse(program: Program, origin: string, originKind: string, lineNumberOffset: number, text: string)
{
    let lexer: Lexer = new Lexer(origin, originKind, lineNumberOffset, text);
    
    // The hardest part of dealing with C-like languages is parsing variable declaration statements.
    // Let's consider if this happens in WSL. Here are the valid statements in WSL that being with an
    // identifier, if we assume that any expression can be a standalone statement.
    //
    //     x;
    //     x <binop> y;
    //     x < y;
    //     x < y > z;
    //     x = y;
    //     x.f = y;
    //     \exp = y;
    //     x[42] = y;
    //     x();
    //     x<y>();
    //     x y;
    //     x<y> z;
    //     device x[] y;
    //     x[42] y;
    //     device x^ y;
    //     thread x^^ y;
    //     x^thread^thread y;
    //     x^device^thread y;
    //
    // This has two problem areas:
    //
    //     - x<y>z can parse two different ways (as (x < y) > z or x<y> z).
    //     - x[42] could become either an assignment or a variable declaration.
    //     - x<y> could become either an assignment or a variable declaration.
    //
    // We solve the first problem by forbidding expressions as statements. The lack of function
    // pointers means that we can still allow function call statements - unlike in C, those cannot
    // have arbitrary expressions as the callee. The remaining two problems are solved by
    // backtracking. In all other respects, this is a simple recursive descent parser.
    
    function genericConsume(callback: (token: LexerToken) => boolean, explanation: string | string[]): LexerToken
    {
        let token = lexer.next();
        if (!token)
            lexer.fail("Unexpected end of file");
        if (!callback(token))
            lexer.fail("Unexpected token: " + token!.text + "; expected: " + explanation);
        return token;
    }
    
    function consume(...texts: string[])
    {
        return genericConsume((token: LexerToken) => texts.includes(token.text), texts);
    }
    
    function consumeKind(kind: string)
    {
        return genericConsume((token: LexerToken) => token.kind == kind, kind);
    }
    
    function assertNext(...texts: string[])
    {
        lexer.push(consume(...texts));
    }
    
    function genericTest(callback: (token: LexerToken) => boolean)
    {
        let token = lexer.peek();
        if (token && callback(token))
            return token;
        return null;
    }
    
    function test(...texts: string[])
    {
        return genericTest((token: LexerToken) => texts.includes(token.text));
    }
    
    function testKind(kind: string)
    {
        return genericTest((token: LexerToken) => token.kind == kind);
    }
    
    function tryConsume(...texts: string[])
    {
        let result = test(...texts);
        if (result)
            lexer.next();
        return result;
    }
    
    function tryConsumeKind(kind: string)
    {
        let result = testKind(kind);
        if (result)
            lexer.next();
        return result;
    }
    
    function parseProtocolRef()
    {
        let protocolToken = consumeKind("identifier");
        return new ProtocolRef(protocolToken, protocolToken!.text);
    }
    
    function consumeEndOfTypeArgs()
    {
        let rightShift = tryConsume(">>");
        if (rightShift)
            lexer.push(new LexerToken(lexer, rightShift, rightShift.index, readString(rightShift.kind), ">"));
        else
            consume(">");
    }
    
    function parseTypeParameters()
    {
        if (!test("<"))
            return [];
        
        let result = [];
        consume("<");
        while (!test(">")) {
            let constexpr = lexer.backtrackingScope(() => {
                let type = parseType();
                let name = consumeKind("identifier");
                assertNext(",", ">", ">>");
                return new ConstexprTypeParameter(type.origin, name!.text, type);
            });
            if (constexpr)
                result.push(constexpr);
            else {
                let name = consumeKind("identifier");
                let protocol = tryConsume(":") ? parseProtocolRef() : null;
                result.push(new TypeVariable(name, name!.text, protocol));
            }
            if (!tryConsume(","))
                break;
        }
        consumeEndOfTypeArgs();
        return result;
    }
    
    function parseTerm(): Value
    {
        let token;
        if (token = tryConsume("null"))
            return new NullLiteral(token);
        if (token = tryConsumeKind("identifier"))
            return new VariableRef(token, token.text);
        if (token = tryConsumeKind("intLiteral")) {
            let intVersion = (+token.text) | 0;
            if ("" + intVersion !== token.text)
                lexer.fail("Integer literal is not an integer: " + token.text);
            return new IntLiteral(token, intVersion);
        }
        if (token = tryConsumeKind("uintLiteral")) {
            let uintVersion = Number(token.text.substr(0, token.text.length - 1)) >>> 0;
            if (uintVersion + "u" !== token.text)
                lexer.fail("Integer literal is not 32-bit unsigned integer: " + token.text);
            return new UintLiteral(token, uintVersion);
        }
        if ((token = tryConsumeKind("intHexLiteral"))
            || (token = tryConsumeKind("uintHexLiteral"))) {
            let hexString = token.text.substr(2);
            if (token.kind == "uintHexLiteral")
                hexString = hexString.substr(0, hexString.length - 1);
            if (!hexString.length)
                throw new Error("Bad hex literal: " + token);
            let intVersion = parseInt(hexString, 16);
            if (token.kind == "intHexLiteral")
                intVersion = intVersion | 0;
            else
                intVersion = intVersion >>> 0;
            if (intVersion.toString(16) !== hexString)
                lexer.fail("Hex integer literal is not an integer: " + token.text);
            if (token.kind == "intHexLiteral")
                return new IntLiteral(token, intVersion);
            return new UintLiteral(token, intVersion >>> 0);
        }
        if (token = tryConsumeKind("doubleLiteral"))
            return new DoubleLiteral(token, +token.text);
        if (token = tryConsumeKind("floatLiteral")) {
            let text = token.text;
            let d = token.text.endsWith("d");
            let f = token.text.endsWith("f");
            if (d && f)
                throw new Error("Literal cannot be both a double literal and a float literal.");
            if (d || f)
                text = text.substring(0, text.length - 1);
            let value = parseFloat(text);
            if (d)
                return new DoubleLiteral(token, value);
            return new FloatLiteral(token, Math.fround(value));
        }
        if (token = tryConsume("true", "false"))
            return new BoolLiteral(token, token.text == "true");
        // FIXME: Need support for other literals too.
        consume("(");
        let result = parseExpression();
        consume(")");
        return result;
    }
    
    function parseConstexpr(): Value
    {
        let token;
        if (token = tryConsume("-"))
            return new CallExpression(token, "operator" + token.text, [], [parseTerm()]);
        let left = parseTerm();
        if (token = tryConsume("."))
            left = new DotExpression(token, left, consumeKind("identifier")!.text);
        return left;
    }
    
    function parseTypeArguments()
    {
        if (!test("<"))
            return [];
        
        let result = [];
        consume("<");
        while (!test(">")) {
            // It's possible for a constexpr or type can syntactically overlap in the single
            // identifier case. Let's consider the possibilities:
            //
            //     T          could be type or constexpr
            //     T[]        only type
            //     T[42]      only type (constexpr cannot do indexing)
            //     42         only constexpr
            //
            // In the future we'll allow constexprs to do more things, and then we'll still have
            // the problem that something of the form T[1][2][3]... can either be a type or a
            // constexpr, and we can figure out in the checker which it is.
            let typeOrVariableRef = lexer.backtrackingScope(() => {
                let result = consumeKind("identifier");
                assertNext(",", ">", ">>");
                return new TypeOrVariableRef(result, result!.text);
            });
            if (typeOrVariableRef)
                result.push(typeOrVariableRef);
            else {
                let constexpr = lexer.backtrackingScope(() => {
                    let result = parseConstexpr();
                    assertNext(",", ">", ">>");
                    return result;
                });
                if (constexpr)
                    result.push(constexpr);
                else
                    result.push(parseType());
            }
            if (!tryConsume(","))
                break;
        }
        consumeEndOfTypeArgs();
        return result;
    }
    
    function parseType(): Type
    {
        let token;
        let addressSpace: string | undefined;
        let addressSpaceConsumed = false;
        if (token = tryConsume(...addressSpaces))
            addressSpace = token.text;
        
        let name = consumeKind("identifier");
        let typeArguments = parseTypeArguments();
        let type: Type = new TypeRef(name, name!.text, typeArguments);
        
        function getAddressSpace()
        {
            addressSpaceConsumed = true;
            if (addressSpace)
                return addressSpace;
            return consume(...addressSpaces)!.text;
        }
        
        while (token = tryConsume("*", "[")) {
            if (token.text == "*") {
                type = new PtrType(token, getAddressSpace(), type);
                continue;
            }
            
            if (tryConsume("]")) {
                type = new ArrayRefType(token, getAddressSpace(), type);
                continue;
            }
            
            type = new ArrayType(token, type, parseConstexpr());
            consume("]");
        }
        
        if (addressSpace && !addressSpaceConsumed)
            lexer.fail("Address space specified for type that does not need address space");
        
        return type;
    }
    
    function parseTypeDef()
    {
        let origin = consume("typedef");
        let name = consumeKind("identifier")!.text;
        let typeParameters = parseTypeParameters();
        consume("=");
        let type = parseType();
        consume(";");
        return new TypeDef(origin, name, typeParameters, type);
    }
    
    function genericParseLeft(texts: string[], nextParser: ()=>Value, constructor: (token:LexerToken,left:Value,right:Value)=>Value): Value
    {
        let left = nextParser();
        let token;
        while (token = tryConsume(...texts))
            left = constructor(token, left, nextParser());
        return left;
    }
    
    function parseLeftOperatorCall(texts: string[], nextParser: ()=>Value): Value
    {
        return genericParseLeft(
            texts, nextParser,
            (token: LexerToken, left: Value, right: Value) =>
                new CallExpression(token, "operator" + token.text, [], [left, right]));
    }
    
    function parseCallExpression()
    {
        let name = consumeKind("identifier");
        let typeArguments = parseTypeArguments();
        consume("(");
        let argumentList = [];
        while (!test(")")) {
            let argument = parsePossibleAssignment();
            argumentList.push(argument);
            if (!tryConsume(","))
                break;
        }
        consume(")");
        let result = new CallExpression(name, name!.text, typeArguments, argumentList);
        return result;
    }
    
    function isCallExpression()
    {
        return lexer.testScope(() => {
            consumeKind("identifier");
            parseTypeArguments();
            consume("(");
        });
    }
    
    function emitIncrement(token: LexerToken, old: VariableRef, extraArg?: Value | undefined)
    {
        let args: Value[] = [old];
        if (extraArg)
            args.push(extraArg);
        
        let name = "operator" + token.text;
        if (/=$/.test(name))
            name = RegExp.leftContext;
        
        if (name == "operator")
            throw new Error("Invalid name: " + name);
        
        return new CallExpression(token, name, [], args);
    }
    
    function finishParsingPostIncrement(token: LexerToken, left: Value)
    {
        let readModifyWrite = new ReadModifyWriteExpression(token, left);
        readModifyWrite.newValueExp = emitIncrement(token, readModifyWrite.oldValueRef());
        readModifyWrite.resultExp = readModifyWrite.oldValueRef();
        return readModifyWrite;
    }
    
    function parseSuffixOperator(left:Value, acceptableOperators:string | string[], ignored1?: string, ignored2?: string): Value;
    function parseSuffixOperator(left: Value, acceptableOperators: string | string[]): Value
    {
        let token;
        while (token = tryConsume(...acceptableOperators)) {
            switch (token.text) {
            case "++":
            case "--":
                return finishParsingPostIncrement(token, left);
            case ".":
            case "->":
                if (token.text == "->")
                    left = new DereferenceExpression(token, left);
                left = new DotExpression(token, left, consumeKind("identifier")!.text);
                break;
            case "[": {
                let index = parseExpression();
                consume("]");
                left = new IndexExpression(token, left, index);
                break;
            }
            default:
                throw new Error("Bad token: " + token);
            }
        }
        return left;
    }
    
    function parsePossibleSuffix(): Value
    {
        let acceptableOperators = ["++", "--", ".", "->", "["];
        let limitedOperators = [".", "->", "["];
        let left;
        if (isCallExpression()) {
            left = parseCallExpression();
            acceptableOperators = limitedOperators;
        } else
            left = parseTerm();
        
        return parseSuffixOperator(left, acceptableOperators);
    }
    
    function finishParsingPreIncrement(token: LexerToken, left: Value, extraArg?: Value | undefined)
    {
        let readModifyWrite = new ReadModifyWriteExpression(token, left);
        readModifyWrite.newValueExp = emitIncrement(token, readModifyWrite.oldValueRef(), extraArg);
        readModifyWrite.resultExp = readModifyWrite.newValueRef();
        return readModifyWrite;
    }
    
    function parsePreIncrement()
    {
        let token = consume("++", "--");
        let left = parsePossiblePrefix();
        return finishParsingPreIncrement(token, left);
    }
    
    function parsePossiblePrefix(): Value
    {
        let token;
        if (test("++", "--"))
            return parsePreIncrement();
        if (token = tryConsume("+", "-", "~"))
            return new CallExpression(token, "operator" + token.text, [], [parsePossiblePrefix()]);
        if (token = tryConsume("*"))
            return new DereferenceExpression(token, parsePossiblePrefix());
        if (token = tryConsume("&"))
            return new MakePtrExpression(token, parsePossiblePrefix());
        if (token = tryConsume("@"))
            return new MakeArrayRefExpression(token, parsePossiblePrefix());
        if (token = tryConsume("!")) {
            let remainder = parsePossiblePrefix();
            return new LogicalNot(token, new CallExpression(remainder.origin, "bool", [], [remainder]));
        }
        return parsePossibleSuffix();
    }
    
    function parsePossibleProduct(): Value
    {
        return parseLeftOperatorCall(["*", "/", "%"], parsePossiblePrefix);
    }
    
    function parsePossibleSum(): Value
    {
        return parseLeftOperatorCall(["+", "-"], parsePossibleProduct);
    }
    
    function parsePossibleShift(): Value
    {
        return parseLeftOperatorCall(["<<", ">>"], parsePossibleSum);
    }
    
    function parsePossibleRelationalInequality(): Value
    {
        return parseLeftOperatorCall(["<", ">", "<=", ">="], parsePossibleShift);
    }
    
    function parsePossibleRelationalEquality(): Value
    {
        return genericParseLeft(
            ["==", "!="], parsePossibleRelationalInequality,
            (token: LexerToken, left: Value, right: Value) => {
                let result: Value = new CallExpression(token, "operator==", [], [left, right]);
                if (token.text == "!=")
                    result = new LogicalNot(token, result);
                return result;
            });
    }
    
    function parsePossibleBitwiseAnd(): Value
    {
        return parseLeftOperatorCall(["&"], parsePossibleRelationalEquality);
    }
    
    function parsePossibleBitwiseXor(): Value
    {
        return parseLeftOperatorCall(["^"], parsePossibleBitwiseAnd);
    }
    
    function parsePossibleBitwiseOr(): Value
    {
        return parseLeftOperatorCall(["|"], parsePossibleBitwiseXor);
    }
    
    function parseLeftLogicalExpression(texts: string[], nextParser: ()=>Value): Value
    {
        return genericParseLeft(
            texts, nextParser,
            (token: LexerToken, left: Value, right: Value) => new LogicalExpression(token, token.text, new CallExpression(left.origin, "bool", [], [left]), new CallExpression(right.origin, "bool", [], [right])));
    }
    
    function parsePossibleLogicalAnd(): Value
    {
        return parseLeftLogicalExpression(["&&"], parsePossibleBitwiseOr);
    }
    
    function parsePossibleLogicalOr(): Value
    {
        return parseLeftLogicalExpression(["||"], parsePossibleLogicalAnd);
    }
    
    function parsePossibleTernaryConditional(): Value
    {
        let predicate = parsePossibleLogicalOr();
        let operator = tryConsume("?");
        if (!operator)
            return predicate;
        return new TernaryExpression(operator, predicate, parsePossibleAssignment(), parsePossibleAssignment());
    }
    
    function parsePossibleAssignment(mode?: string): Value
    {
        let lhs = parsePossibleTernaryConditional();
        let operator = tryConsume("=", "+=", "-=", "*=", "/=", "%=", "^=", "|=", "&=");
        if (!operator) {
            if (mode == "required")
                lexer.fail("Expected assignment");
            return lhs;
        }
        if (operator.text == "=")
            return new Assignment(operator, lhs, parsePossibleAssignment());
        return finishParsingPreIncrement(operator, lhs, parsePossibleAssignment());
    }
    
    function parseAssignment(): Value
    {
        return parsePossibleAssignment("required");
    }
    
    function parsePostIncrement(): Value
    {
        let left = parseSuffixOperator(parseTerm(), ".", "->", "[");
        let token = consume("++", "--");
        return finishParsingPostIncrement(token, left);
    }
    
    function parseEffectfulExpression(): Value
    {
        if (isCallExpression())
            return parseCallExpression();
        let preIncrement = lexer.backtrackingScope(parsePreIncrement);
        if (preIncrement)
            return preIncrement;
        let postIncrement = lexer.backtrackingScope(parsePostIncrement);
        if (postIncrement)
            return postIncrement;
        return parseAssignment();
    }
    
    function genericParseCommaExpression(finalExpressionParser: ()=>Value): Value
    {
        let list = [];
        let origin = lexer.peek();
        if (!origin)
            lexer.fail("Unexpected end of file");
        for (;;) {
            let effectfulExpression = lexer.backtrackingScope(() => {
                parseEffectfulExpression();
                consume(",");
            });
            if (!effectfulExpression) {
                let final = finalExpressionParser();
                list.push(final);
                break;
            }
            list.push(effectfulExpression);
        }
        if (!list.length)
            throw new Error("Length should never be zero");
        if (list.length == 1)
            return list[0];
        return new CommaExpression(origin, list);
    }
    
    function parseCommaExpression(): Value
    {
        return genericParseCommaExpression(parsePossibleAssignment);
    }
    
    function parseExpression(): Value
    {
        return parseCommaExpression();
    }
    
    function parseEffectfulStatement()
    {
        let result = genericParseCommaExpression(parseEffectfulExpression);
        consume(";");
        return result;
    }
    
    function parseReturn()
    {
        let origin = consume("return");
        if (tryConsume(";"))
            return new Return(origin, null);
        let expression = parseExpression();
        consume(";");
        return new Return(origin, expression);
    }
    
    function parseBreak()
    {
        let origin = consume("break");
        consume(";");
        return new Break(origin);
    }
    
    function parseContinue()
    {
        let origin = consume("continue");
        consume(";");
        return new Continue(origin);
    }

    function parseIfStatement(): IfStatement
    {
        let origin = consume("if");
        consume("(");
        let conditional = parseExpression();
        consume(")");
        let body = parseStatement();
        let elseBody;
        if (tryConsume("else"))
            elseBody = parseStatement();
        return new IfStatement(origin, new CallExpression(conditional.origin, "bool", [], [conditional]), body, readOptionalInstance(elseBody, Node));
    }

    function parseWhile(): WhileLoop
    {
        let origin = consume("while");
        consume("(");
        let conditional = parseExpression();
        consume(")");
        let body = parseStatement();
        return new WhileLoop(origin, new CallExpression(conditional.origin, "bool", [], [conditional]), body);
    }

    function parseFor(): ForLoop
    {
        let origin = consume("for");
        consume("(");
        let initialization;
        if (tryConsume(";"))
            initialization = undefined;
        else {
            initialization = lexer.backtrackingScope(parseVariableDecls);
            if (!initialization)
                initialization = parseEffectfulStatement();
        }
        let condition: LexerToken | Value | null | undefined = tryConsume(";");
        if (condition)
            condition = undefined;
        else {
            condition = parseExpression();
            consume(";");
            condition = new CallExpression(condition.origin, "bool", [], [condition]);
        }
        let increment;
        if (tryConsume(")"))
            increment = undefined;
        else {
            increment = parseExpression();
            consume(")");
        }
        let body = parseStatement();
        return new ForLoop(origin, initialization, condition, increment, body);
    }

    function parseDo(): DoWhileLoop
    {
        let origin = consume("do");
        let body = parseStatement();
        consume("while");
        consume("(");
        let conditional = parseExpression();
        consume(")");
        return new DoWhileLoop(origin, body, new CallExpression(conditional.origin, "bool", [], [conditional]));
    }
    
    function parseVariableDecls()
    {
        let type = parseType();
        let list = [];
        do {
            let name = consumeKind("identifier");
            let initializer = tryConsume("=") ? parseExpression() : null;
            list.push(new VariableDecl(name, name!.text, type, initializer));
        } while (consume(",", ";")!.text == ",");
        return new CommaExpression(type.origin, list);
    }
    
    function parseSwitchCase()
    {
        let token = consume("default", "case");
        let value;
        if (token!.text == "case")
            value = parseConstexpr();
        consume(":");
        let body = parseBlockBody("}", "default", "case");
        return new SwitchCase(token, readOptionalInstance(value, Value), body);
    }
    
    function parseSwitchStatement()
    {
        let origin = consume("switch");
        consume("(");
        let value = parseExpression();
        consume(")");
        consume("{");
        let result = new SwitchStatement(origin, value);
        while (!tryConsume("}"))
            result.add(parseSwitchCase());
        return result;
    }
    
    function parseStatement(): Node | null
    {
        let token = lexer.peek();
        if (token!.text == ";") {
            lexer.next();
            return null;
        }
        if (token!.text == "return")
            return parseReturn();
        if (token!.text == "break")
            return parseBreak();
        if (token!.text == "continue")
            return parseContinue();
        if (token!.text == "while")
            return parseWhile();
        if (token!.text == "do")
            return parseDo();
        if (token!.text == "for")
            return parseFor();
        if (token!.text == "if")
            return parseIfStatement();
        if (token!.text == "switch")
            return parseSwitchStatement();
        if (token!.text == "trap") {
            let origin = consume("trap");
            consume(";");
            return new TrapStatement(origin);
        }
        if (token!.text == "{")
            return parseBlock();
        let variableDecl = lexer.backtrackingScope(parseVariableDecls);
        if (variableDecl)
            return variableDecl;
        return parseEffectfulStatement();
    }
    
    function parseBlockBody(...terminators: string[])
    {
        let block = new Block(origin);
        while (!test(...terminators)) {
            let statement = parseStatement();
            if (statement)
                block.add(statement);
        }
        return block;
    }
    
    function parseBlock()
    {
        let origin = consume("{");
        let block = parseBlockBody("}");
        consume("}");
        return block;
    }
    
    function parseParameter()
    {
        let type = parseType();
        let name = tryConsumeKind("identifier");
        return new FuncParameter(type.origin, name ? name.text : null, type);
    }
    
    function parseParameters()
    {
        consume("(");
        let parameters = [];
        while (!test(")")) {
            parameters.push(parseParameter());
            if (!tryConsume(","))
                break;
        }
        consume(")");
        return parameters;
    }
    
    function parseFuncName()
    {
        if (tryConsume("operator")) {
            let token = consume("+", "-", "*", "/", "%", "^", "&", "|", "<", ">", "<=", ">=", "==", "++", "--", ".", "~", "<<", ">>", "[");
            if (token!.text == "&") {
                if (tryConsume("[")) {
                    consume("]");
                    return "operator&[]";
                }
                if (tryConsume("."))
                    return "operator&." + consumeKind("identifier")!.text;
                return "operator&";
            }
            if (token!.text == ".") {
                let result = "operator." + consumeKind("identifier")!.text;
                if (tryConsume("="))
                    result += "=";
                return result;
            }
            if (token!.text == "[") {
                consume("]");
                let result = "operator[]";
                if (tryConsume("="))
                    result += "=";
                return result;
            }
            return "operator" + token!.text;
        }
        return consumeKind("identifier")!.text;
    }

    function parseFuncDecl()
    {
        let origin;
        let returnType;
        let name;
        let typeParameters;
        let isCast;
        let shaderType;
        let operatorToken = tryConsume("operator");
        if (operatorToken) {
            origin = operatorToken;
            typeParameters = parseTypeParameters();
            returnType = parseType();
            name = "operator cast";
            isCast = true;
        } else {
            shaderType = tryConsume("vertex", "fragment");
            returnType = parseType();
            if (shaderType) {
                origin = shaderType;
                shaderType = shaderType.text;
            } else
                origin = returnType.origin;
            name = parseFuncName();
            typeParameters = parseTypeParameters();
            isCast = false;
        }
        let parameters = parseParameters();
        return new Func(origin, name, returnType, typeParameters, parameters, isCast, shaderType);
    }

    function parseProtocolFuncDecl()
    {
        let func = parseFuncDecl();
        return new ProtocolFuncDecl(func.origin, func.name, func.returnType, func.typeParameters, func.parameters, func.isCast, func.shaderType);
    }
    
    function parseFuncDef()
    {
        let func = parseFuncDecl();
        let body = parseBlock();
        return new FuncDef(func.origin, func.name, func.returnType, func.typeParameters, func.parameters, body, func.isCast, func.shaderType);
    }
    
    function parseProtocolDecl()
    {
        let origin = consume("protocol");
        let name = consumeKind("identifier")!.text;
        let result = new ProtocolDecl(origin, name);
        if (tryConsume(":")) {
            while (!test("{")) {
                result.addExtends(parseProtocolRef());
                if (!tryConsume(","))
                    break;
            }
        }
        consume("{");
        while (!tryConsume("}")) {
            result.add(parseProtocolFuncDecl());
            consume(";");
        }
        return result;
    }
    
    function parseField()
    {
        let type = parseType();
        let name = consumeKind("identifier");
        consume(";");
        return new Field(name, name!.text, type);
    }
    
    function parseStructType()
    {
        let origin = consume("struct");
        let name = consumeKind("identifier")!.text;
        let typeParameters = parseTypeParameters();
        let result = new StructType(origin, name, typeParameters);
        consume("{");
        while (!tryConsume("}"))
            result.add(parseField());
        return result;
    }
    
    function parseNativeFunc()
    {
        let func = parseFuncDecl();
        consume(";");
        return new NativeFunc(func.origin, func.name, func.returnType, func.typeParameters, func.parameters, func.isCast, func.shaderType);
    }
    
    function parseNative()
    {
        let origin = consume("native");
        if (tryConsume("typedef")) {
            let name = consumeKind("identifier");
            let parameters = parseTypeParameters();
            consume(";");
            return new NativeType(origin, name!.text, parameters);
        }
        return parseNativeFunc();
    }
    
    function parseRestrictedFuncDef()
    {
        consume("restricted");
        let result;
        if (tryConsume("native"))
            result = parseNativeFunc();
        else
            result = parseFuncDef();
        result.isRestricted = true;
        return result;
    }
    
    function parseEnumMember()
    {
        let name = consumeKind("identifier");
        let value = null;
        if (tryConsume("="))
            value = parseConstexpr();
        return new EnumMember(name, name!.text, value);
    }
    
    function parseEnumType()
    {
        consume("enum");
        let name = consumeKind("identifier");
        let baseType;
        if (tryConsume(":"))
            baseType = parseType();
        else
            baseType = new TypeRef(name, "int", []);
        consume("{");
        let result = new EnumType(name, name!.text, baseType);
        while (!test("}")) {
            result.add(parseEnumMember());
            if (!tryConsume(","))
                break;
        }
        consume("}");
        return result;
    }
    
    for (;;) {
        let token = lexer.peek();
        if (!token)
            return;
        if (token.text == ";")
            lexer.next();
        else if (token.text == "typedef")
            program.add(parseTypeDef());
        else if (originKind == "native" && token.text == "native")
            program.add(parseNative());
        else if (originKind == "native" && token.text == "restricted")
            program.add(parseRestrictedFuncDef());
        else if (token.text == "struct")
            program.add(parseStructType());
        else if (token.text == "enum")
            program.add(parseEnumType());
        else if (token.text == "protocol")
            program.add(parseProtocolDecl());
        else
            program.add(parseFuncDef());
    }
}



// Upstream source: ./WSL/Prepare.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let resetPreparedStandardLibrary: () => void;
let prepare = (() => {
    let standardProgram: Program | undefined;
    resetPreparedStandardLibrary = () => { standardProgram = undefined; };
    return function(origin?: string, lineNumberOffset?: number, text?: string) {
        if (!standardProgram) {
            standardProgram = new Program();
            let firstLineOfStandardLibrary = 28; // See StandardLibrary.js.
            parse(standardProgram, "/internal/stdlib", "native", firstLineOfStandardLibrary - 1, standardLibrary);
        }
        
        let program = cloneProgram(standardProgram);
        if (arguments.length) {
            parse(program, origin!, "user", lineNumberOffset!, text!);
            program = programWithUnnecessaryThingsRemoved(program);
        }
        
        foldConstexprs(program);
        let nameResolver = createNameResolver(program);
        resolveNamesInTypes(program, nameResolver);
        resolveNamesInProtocols(program, nameResolver);
        resolveTypeDefsInTypes(program);
        resolveTypeDefsInProtocols(program);
        checkRecursiveTypes(program);
        synthesizeStructAccessors(program);
        synthesizeEnumFunctions(program);
        resolveNamesInFunctions(program, nameResolver);
        resolveTypeDefsInFunctions(program);
        
        flattenProtocolExtends(program);
        check(program);
        checkLiteralTypes(program);
        resolveProperties(program);
        findHighZombies(program);
        checkLiteralTypes(program);
        checkProgramWrapped(program);
        checkReturns(program);
        checkUnreachableCode(program);
        checkLoops(program);
        checkRecursion(program);
        checkProgramWrapped(program);
        findHighZombies(program);
        inline(program);
        
        return program;
    };
})();



// Upstream source: ./WSL/Program.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Program extends Node {
    declare _topLevelStatements: Node[];
    declare _functions: Map<string, Func[]>;
    declare _types: Map<string, Type>;
    declare _protocols: Map<string, Protocol>;
    declare _funcInstantiator: FuncInstantiator;
    declare _globalNameContext: NameContext;
    declare intrinsics: Intrinsics;

    constructor()
    {
        super();
        this._topLevelStatements = [];
        this._functions = new Map();
        this._types = new Map();
        this._protocols = new Map();
        this._funcInstantiator = new FuncInstantiator(this);
        this._globalNameContext = new NameContext();
        this._globalNameContext.program = this;
        this._globalNameContext.recognizeIntrinsics();
        this.intrinsics = this._globalNameContext.intrinsics!;
    }
    
    get topLevelStatements() { return this._topLevelStatements; }
    get functions() { return this._functions; }
    get types() { return this._types; }
    get protocols() { return this._protocols; }
    get funcInstantiator() { return this._funcInstantiator; }
    get globalNameContext() { return this._globalNameContext; }
    
    add(statement: Node)
    {
        statement.program = this;
        if (statement instanceof Func) {
            let array = this._functions.get(statement.name);
            if (!array)
                this._functions.set(statement.name, array = []);
            array.push(statement);
        } else if (statement instanceof Type)
            this._types.set(statement.name!, statement);
        else if (statement instanceof Protocol)
            this._protocols.set(statement.name, statement);
        else
            throw new Error("Statement is not a function or type: " + statement);
        this._topLevelStatements.push(statement);
        this._globalNameContext.add(statement);
    }
    
    toString()
    {
        if (!this._topLevelStatements.length)
            return "";
        return this._topLevelStatements.join(";") + ";";
    }
}



// Upstream source: ./WSL/ProgramWithUnnecessaryThingsRemoved.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function programWithUnnecessaryThingsRemoved(program: Program)
{
    let nameFinder = new NameFinder();
    
    // Build our roots.
    for (let statement of program.topLevelStatements) {
        if (statement.origin!.originKind === "user")
            nameFinder.add(statement.name!);
    }
    
    // Unfortunately, we cannot know yet which operator casts we'll need.
    nameFinder.add("operator cast");
    
    // We need these even if the program doesn't mention them by name.
    nameFinder.add("void");
    nameFinder.add("bool");
    nameFinder.add("int");
    
    // Pull in things as necessary.
    while (nameFinder.worklist.length) {
        let name = nameFinder.worklist.pop();
        for (let thing of program.globalNameContext.underlyingThings(Anything, name))
            thing.visit(nameFinder);
    }
    
    let result = new Program();
    for (let name of nameFinder.set) {
        for (let thing of program.globalNameContext.underlyingThings(Anything, name))
            result.add(readInstance(thing, Node));
    }
    
    return result;
}



// Upstream source: ./WSL/PropertyResolver.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class PropertyResolver extends Visitor {
    _visitRValuesWithinLValue(node: Node)
    {
        let visit = (node: Node) => node.visit(this);
        
        class RValueFinder {
            visitDotExpression(node: DotExpression)
            {
                node.struct.visit(this);
            }
            
            visitIndexExpression(node: IndexExpression)
            {
                node.array.visit(this);
                visit(node.index);
            }
            
            visitVariableRef(node: VariableRef)
            {
            }
            
            visitDereferenceExpression(node: DereferenceExpression)
            {
                visit(node.ptr);
            }
            
            visitIdentityExpression(node: IdentityExpression)
            {
                node.target.visit(this);
            }
            
            visitMakeArrayRefExpression(node: MakeArrayRefExpression)
            {
                visit(node.lValue);
            }
        }
        
        node.visit(new RValueFinder());
    }
    
    _visitPropertyAccess(node: PropertyAccessExpression)
    {
        let newNode = readInstance(node.visit(new NormalUsePropertyResolver()), Value);
        newNode.visit(this);
        node.become(newNode);
    }
    
    visitDotExpression(node: DotExpression)
    {
        this._visitPropertyAccess(node);
    }
    
    visitIndexExpression(node: IndexExpression)
    {
        this._visitPropertyAccess(node);
    }
    
    _handleReadModifyWrite(node: ReadModifyWriteExpression)
    {
        let type = node.oldValueVar.type;
        if (!type)
            throw new Error("Null type");
        let simpleLHS = readInstance(node.lValue.visit(new NormalUsePropertyResolver()), Value);
        if (simpleLHS.isLValue) {
            if (!simpleLHS.addressSpace)
                throw new Error(node.origin!.originString + ": LHS without address space: " + simpleLHS);
            let ptrType = new PtrType(node.origin, simpleLHS.addressSpace, type);
            let ptrVar = new AnonymousVariable(node.origin, ptrType);
            node.become(new CommaExpression(node.origin, [
                node.oldValueVar, node.newValueVar, ptrVar,
                new Assignment(
                    node.origin, VariableRef.wrap(ptrVar),
                    new MakePtrExpression(node.origin, simpleLHS), ptrType),
                new Assignment(
                    node.origin, node.oldValueRef(),
                    new DereferenceExpression(
                        node.origin, VariableRef.wrap(ptrVar), type, simpleLHS.addressSpace),
                    type),
                new Assignment(node.origin, node.newValueRef(), readInstance(node.newValueExp, Value), type),
                new Assignment(
                    node.origin,
                    new DereferenceExpression(
                        node.origin, VariableRef.wrap(ptrVar), type, simpleLHS.addressSpace),
                    node.newValueRef(), type),
                node.resultExp!
            ]));
            return;
        }
        
        let result = new ReadModifyWriteExpression(node.origin, readInstance(node.lValue, PropertyAccessExpression).base, readInstance(node.lValue, PropertyAccessExpression).baseType);
        result.newValueExp = new CommaExpression(node.origin, [
            node.oldValueVar, node.newValueVar,
            new Assignment(node.origin, node.oldValueRef(), readInstance(node.lValue, PropertyAccessExpression).emitGet(result.oldValueRef()), type),
            new Assignment(node.origin, node.newValueRef(), readInstance(node.newValueExp, Value), type),
            readInstance(node.lValue, PropertyAccessExpression).emitSet(result.oldValueRef(), node.newValueRef())
        ]);
        result.resultExp = node.newValueRef();
        this._handleReadModifyWrite(result);
        node.become(result);
    }
    
    visitReadModifyWriteExpression(node: ReadModifyWriteExpression)
    {
        node.newValueExp!.visit(this);
        node.resultExp!.visit(this);
        this._visitRValuesWithinLValue(node.lValue);
        this._handleReadModifyWrite(node);
    }
    
    visitAssignment(node: Assignment)
    {
        this._visitRValuesWithinLValue(node.lhs);
        node.rhs.visit(this);
        
        let simpleLHS = readInstance(node.lhs.visit(new NormalUsePropertyResolver()), Value);
        if (simpleLHS.isLValue) {
            node.lhs.become(readInstance(simpleLHS, Value));
            return;
        }
        
        if (!(node.lhs instanceof PropertyAccessExpression))
            throw new Error("Unexpected lhs type: " + node.lhs.constructor.name);
        
        let result = new ReadModifyWriteExpression(node.origin, node.lhs.base, node.lhs.baseType);
        let resultVar = new AnonymousVariable(node.origin, node.type);
        result.newValueExp = new CommaExpression(node.origin, [
            resultVar,
            new Assignment(node.origin, VariableRef.wrap(resultVar), node.rhs, node.type),
            node.lhs.emitSet(result.oldValueRef(), VariableRef.wrap(resultVar))
        ]);
        result.resultExp = VariableRef.wrap(resultVar);
        this._handleReadModifyWrite(result);
        node.become(result);
    }
    
    visitMakePtrExpression(node: MakePtrExpression)
    {
        super.visitMakePtrExpression(node);
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "Not an lvalue: " + node.lValue);
    }
    
    visitMakeArrayRefExpression(node: MakeArrayRefExpression)
    {
        super.visitMakeArrayRefExpression(node);
        if (!node.lValue.isLValue)
            throw new WTypeError(node.origin.originString, "Not an lvalue: " + node.lValue);
    }
}



// Upstream source: ./WSL/Protocol.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Protocol extends Node {
    declare _origin: Origin;
    declare _name: string;

    constructor(origin: Origin, name: string)
    {
        super();
        this._origin = origin;
        this._name = name;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get kind() { return Protocol; }
    
    toString()
    {
        return this.name;
    }
}


// Upstream source: ./WSL/ProtocolDecl.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ProtocolDecl extends Protocol {
    declare extends: ProtocolRef[];
    declare _signatures: ProtocolFuncDecl[];
    declare _signatureMap: Map<string,ProtocolFuncDecl[]>;

    declare _typeVariable: TypeVariable;

    constructor(origin: Origin, name: string)
    {
        super(origin, name);
        this.extends = [];
        this._signatures = [];
        this._signatureMap = new Map();
        this._typeVariable = new TypeVariable(origin, name, null);
    }
    
    addExtends(protocol: Protocol)
    {
        this.extends.push(readInstance(protocol, ProtocolRef));
    }
    
    add(signature: Node)
    {
        if (!(signature instanceof ProtocolFuncDecl))
            throw new Error("Signature isn't a ProtocolFuncDecl but a " + signature.constructor.name);
        
        signature.protocolDecl = this;
        this._signatures.push(signature);
        let overloads = this._signatureMap.get(signature.name);
        if (!overloads)
            this._signatureMap.set(signature.name, overloads = []);
        overloads.push(signature);
    }
    
    get signatures() { return this._signatures; }
    signaturesByName(name: string) { return this._signatureMap.get(name); }
    get typeVariable() { return this._typeVariable; }
    
    signaturesByNameWithTypeVariable(name: string, typeVariable: Node)
    {
        let substitution = new Substitution([this.typeVariable], [typeVariable]);
        let result = this.signaturesByName(name);
        if (!result)
            return null;
        return result.map((signature) => signature.visit(substitution));
    }
    
    inherits(otherProtocol: ProtocolDecl | ProtocolRef | null | undefined): Verification
    {
        if (!otherProtocol)
            return {result: true};
        
        if (otherProtocol instanceof ProtocolRef)
            otherProtocol = readInstance(otherProtocol.protocolDecl, ProtocolDecl);
        
        for (let otherSignature of otherProtocol.signatures) {
            let signatures = this.signaturesByName(otherSignature.name);
            if (!signatures)
                return {result: false, reason: "Protocol " + this.name + " does not have a function named " + otherSignature.name + " (looking at signature " + otherSignature + ")"};
            let overload = resolveOverloadImpl(
                signatures, [],
                otherSignature.parameterTypes,
                otherSignature.returnTypeForOverloadResolution);
            if (!overload.func)
                return {result: false, reason: "Did not find matching signature for " + otherSignature + " in " + this.name + (overload.failures!.length ? " (tried: " + overload.failures!.join("; ") + ")" : "")};
            let substitutedReturnType =
                overload.func.returnType.substituteToUnification(
                    overload.func.typeParameters, readInstance(overload.unificationContext, UnificationContext));
            if (!substitutedReturnType.equals(otherSignature.returnType))
                return {result: false, reason: "Return type mismatch between " + otherSignature.returnType + " and " + substitutedReturnType};
        }
        return {result: true};
    }
    
    hasHeir(type: Type): Verification
    {
        let substitution = new Substitution([this._typeVariable], [type]);
        let signatures = this.signatures;
        for (let originalSignature of signatures) {
            let signature = readInstance(originalSignature.visit(substitution), ProtocolFuncDecl);
            let overload = resolveOverloadImpl(readInstances(signature.possibleOverloads, Func), readInstances(signature.typeParameters, Node), signature.parameterTypes, signature.returnTypeForOverloadResolution);
            if (!overload.func)
                return {result: false, reason: "Did not find matching signature for " + originalSignature + " (at " + originalSignature.origin.originString + ") with type " + type + (overload.failures!.length ? " (tried: " + overload.failures!.join("; ") + ")" : "")};
            
            let substitutedReturnType = overload.func.returnType.substituteToUnification(
                overload.func.typeParameters, readInstance(overload.unificationContext, UnificationContext));
            if (!substitutedReturnType.equals(signature.returnType))
                return {result: false, reason: "At signature " + originalSignature + " (at " + originalSignature.origin.originString + "): return type mismatch between " + signature.returnType + " and " + substitutedReturnType + " in found function " + overload.func.toDeclString()};
        }
        return {result: true};
    }
    
    toString()
    {
        return "protocol " + this.name + " { " + this.signatures.join("; ") + "; }";
    }
}




// Upstream source: ./WSL/ProtocolFuncDecl.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ProtocolFuncDecl extends Func {
    declare protocolDecl: ProtocolDecl;
    declare possibleOverloads: Func[] | null | undefined;

    get typeParametersForCallResolution()
    {
        return this.typeParameters.concat(this.protocolDecl.typeVariable);
    }
}



// Upstream source: ./WSL/ProtocolRef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ProtocolRef extends Protocol {
    declare protocolDecl: ProtocolDecl | null;

    constructor(origin: Origin, name: string)
    {
        super(origin, name);
        this.protocolDecl = null;
    }
    
    inherits(other: ProtocolDecl | ProtocolRef | null | undefined): Verification
    {
        return this.protocolDecl!.inherits(other);
    }
    
    hasHeir(type: Type): Verification
    {
        return this.protocolDecl!.hasHeir(type);
    }
    
    get isPrimitive(): boolean | number | null | undefined
    {
        return this.protocolDecl!.isPrimitive;
    }
}


// Upstream source: ./WSL/PtrType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class PtrType extends ReferenceType {
    get isPtr() { return true; }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (!readProperty(other, "isPtr"))
            return false;
        if (!(other instanceof PtrType)) throw new TypeError("Expected WSL pointer type");
        if (this.addressSpace != other.addressSpace)
            return false;
        return this.elementType.unify(unificationContext, other.elementType);
    }
    
    argumentForAndOverload(origin: Origin, value: Value): Value
    {
        throw new WTypeError(origin.originString, "Pointer subscript is not valid");
    }
    argumentTypeForAndOverload(origin: Origin, type?: Type): Type
    {
        throw new WTypeError(origin.originString, "Pointer subscript is not valid");
    }
    returnTypeFromAndOverload(origin: Origin)
    {
        return this.elementType;
    }

    toString()
    {
        return this.elementType + "* " + this.addressSpace;
    }
}



// Upstream source: ./WSL/ReadModifyWriteExpression.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ReadModifyWriteExpression extends Expression {
    declare _lValue: Value;
    declare newValueExp: Value | null;
    declare resultExp: Value | null;
    declare type: Type | null;

    declare oldValueVar: AnonymousVariable;
    declare newValueVar: AnonymousVariable;

    constructor(origin: Origin, lValue: Value, type: Type | null = null)
    {
        super(origin);
        this._lValue = lValue;
        this.oldValueVar = new AnonymousVariable(origin, type);
        this.newValueVar = new AnonymousVariable(origin, type);
        this.newValueExp = null;
        this.resultExp = null;
    }
    
    get lValue() { return this._lValue; }
    
    oldValueRef() { return VariableRef.wrap(this.oldValueVar); }
    newValueRef() { return VariableRef.wrap(this.newValueVar); }
    
    toString()
    {
        return "RMW(" + this.lValue + ", " + this.oldValueVar + ", " + this.newValueVar + ", " + this.newValueExp + ", " + this.resultExp + ")";
    }
}



// Upstream source: ./WSL/RecursionChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class RecursionChecker extends Visitor {
    declare _visiting: VisitingSet;

    constructor(ignored?: Program);
    constructor()
    {
        super();
        this._visiting = new VisitingSet();
    }
    
    visitFuncDef(node: FuncDef)
    {
        this._visiting.doVisit(node, () => super.visitFuncDef(node));
    }
    
    visitCallExpression(node: CallExpression)
    {
        node.func!.visit(this);
    }
}


// Upstream source: ./WSL/RecursiveTypeChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class RecursiveTypeChecker extends Visitor {
    declare _visiting: VisitingSet;

    constructor()
    {
        super();
        this._visiting = new VisitingSet();
    }
    
    visitFuncDef(node: FuncDef)
    {
    }
    
    visitNativeFunc(node: NativeFunc)
    {
    }
    
    visitStructType(node: StructType)
    {
        this._visiting.doVisit(node, () => super.visitStructType(node));
    }
    
    visitReferenceType(node: ReferenceType)
    {
    }
    
    visitTypeRef(node: TypeRef)
    {
        super.visitTypeRef(node);
        node.type!.visit(this);
    }
}



// Upstream source: ./WSL/ResolveNames.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function createNameResolver(program: Program)
{
    return new NameResolver(program.globalNameContext);
}

function resolveNamesInTypes(program: Program, nameResolver: NameResolver)
{
    for (let type of program.types.values())
        nameResolver.doStatement(type);
}

function resolveNamesInProtocols(program: Program, nameResolver: NameResolver)
{
    for (let protocol of program.protocols.values())
        nameResolver.doStatement(protocol);
}

function resolveNamesInFunctions(program: Program, nameResolver: NameResolver)
{
    for (let funcs of program.functions.values()) {
        for (let func of funcs)
            nameResolver.doStatement(func);
    }
}



// Upstream source: ./WSL/ResolveOverloadImpl.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function resolveOverloadImpl(functions: Func[], typeArguments: Node[], argumentTypes: Type[], returnType: Type | null | undefined, allowEntryPoint = false): OverloadResult
{
    if (!functions)
        throw new Error("Null functions; that should have been caught by the caller.");
    
    let failures = [];
    let successes = [];
    for (let func of functions) {
        if (!allowEntryPoint && func.shaderType) {
            failures.push(new OverloadResolutionFailure(func, "Function is a " + func.shaderType + " shader, so it cannot be called from within an existing shader."))
            continue;
        }
        let overload = inferTypesForCall(func, typeArguments, argumentTypes, returnType);
        if (overload.failure)
            failures.push(overload.failure);
        else
            successes.push(overload);
    }
    
    if (!successes.length)
        return {failures: failures};
    
    let minimumConversionCost = successes.reduce(
        (result, overload) => Math.min(result, overload.unificationContext!.conversionCost),
        Infinity);
    successes = successes.filter(
        overload => overload.unificationContext!.conversionCost == minimumConversionCost);
    
    // If any of the signatures are restricted then we consider those first. This is an escape mechanism for
    // built-in things.
    // FIXME: It should be an error to declare a function that is at least as specific as a restricted function.
    // https://bugs.webkit.org/show_bug.cgi?id=176580
    let hasRestricted = successes.reduce<boolean | undefined>(
        (result, overload) => result || overload.func!.isRestricted,
        false);
    if (hasRestricted)
        successes = successes.filter(overload => overload.func!.isRestricted);
    
    // We are only interested in functions that are at least as specific as all of the others. This means
    // that they can be "turned around" and applied onto all of the other functions in the list.
    let prunedSuccesses = [];
    for (let i = 0; i < successes.length; ++i) {
        let ok = true;
        let argumentFunc = successes[i].func;
        for (let j = 0; j < successes.length; ++j) {
            if (i == j)
                continue;
            let parameterFunc = successes[j].func;
            let overload = inferTypesForCall(
                readInstance(parameterFunc, Func),
                typeArguments.length ? argumentFunc!.typeParameters : [],
                argumentFunc!.parameterTypes,
                argumentFunc!.returnTypeForOverloadResolution);
            if (!overload.func) {
                ok = false;
                break;
            }
        }
        if (ok)
            prunedSuccesses.push(successes[i]);
    }
    
    if (prunedSuccesses.length == 1)
        return prunedSuccesses[0];
    
    let ambiguityList;
    let message;
    if (prunedSuccesses.length == 0) {
        ambiguityList = successes;
        message = "Ambiguous overload - no function can be applied to all others";
    } else {
        ambiguityList = prunedSuccesses;
        message = "Ambiguous overload - functions mutually applicable";
    }
    
    return {failures: ambiguityList.map(overload => new OverloadResolutionFailure(readInstance(overload.func, Func), message))};
}


// Upstream source: ./WSL/ResolveProperties.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// This turns DotExpression and IndexExpression into calls to getters (operator.field and operator[]),
// setters (operator.field= and operator[]=), and anders (operator&.field and operator&[]). This involves
// transforming assignments and RMW's to do lvalue emulation.
function resolveProperties(program: Program)
{
    program.visit(new PropertyResolver());
}


// Upstream source: ./WSL/ResolveTypeDefs.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function resolveTypeDefsInTypes(program: Program)
{
    let resolver = new TypeDefResolver();
    for (let type of program.types.values())
        type.visit(resolver);
}

function resolveTypeDefsInProtocols(program: Program)
{
    let resolver = new TypeDefResolver();
    for (let protocol of program.protocols.values())
        protocol.visit(resolver);
}

function resolveTypeDefsInFunctions(program: Program)
{
    let resolver = new TypeDefResolver();
    for (let funcs of program.functions.values()) {
        for (let func of funcs)
            func.visit(resolver);
    }
}



// Upstream source: ./WSL/Return.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Return extends Node {
    declare func: Func;

    declare _origin: Origin;
    declare _value: Value | null | undefined;

    constructor(origin: Origin, value: Value | null | undefined)
    {
        super();
        this._origin = origin;
        this._value = value;
    }
    
    get origin() { return this._origin; }
    get value() { return this._value; }
    
    toString()
    {
        if (this.value)
            return "return " + this.value;
        return "return";
    }
};



// Upstream source: ./WSL/ReturnChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ReturnChecker extends Visitor {
    declare returnStyle: {DefinitelyReturns:string;DefinitelyDoesntReturn:string;HasntReturnedYet:string};
    declare _program: Program;

    constructor(program: Program)
    {
        super();
        this.returnStyle = {
            DefinitelyReturns: "Definitely Returns",
            DefinitelyDoesntReturn: "Definitely Doesn't Return",
            HasntReturnedYet: "Hasn't Returned Yet"
        };
        this._program = program;
    }
    
    _mergeReturnStyle(a: unknown, b: unknown)
    {
        if (!a)
            return b;
        if (!b)
            return a;
        switch (a) {
        case this.returnStyle.DefinitelyReturns:
        case this.returnStyle.DefinitelyDoesntReturn:
            if (a == b)
                return a;
            return this.returnStyle.HasntReturnedYet;
        case this.returnStyle.HasntReturnedYet:
            return this.returnStyle.HasntReturnedYet;
        default:
            throw new Error("Bad return style: " + a);
        }
    }

    visitFuncDef(node: FuncDef)
    {
        if (node.returnType.equals(node.program.intrinsics.void))
            return;
        
        let bodyValue = node.body.visit(this);
        if (bodyValue == this.returnStyle.DefinitelyDoesntReturn || bodyValue == this.returnStyle.HasntReturnedYet)
            throw new WTypeError(node.origin.originString, "Function does not return");
    }
    
    visitBlock(node: Block)
    {
        for (let statement of node.statements) {
            switch (statement.visit(this)) {
            case this.returnStyle.DefinitelyReturns:
                return this.returnStyle.DefinitelyReturns;
            case this.returnStyle.DefinitelyDoesntReturn:
                return this.returnStyle.DefinitelyDoesntReturn;
            case this.returnStyle.HasntReturnedYet:
                continue;
            }
        }
        return this.returnStyle.HasntReturnedYet;
    }

    visitIfStatement(node: IfStatement)
    {
        if (node.elseBody) {
            let bodyValue = node.body!.visit(this);
            let elseValue = node.elseBody.visit(this);
            return this._mergeReturnStyle(bodyValue, elseValue);
        }
        return this.returnStyle.HasntReturnedYet;
    }

    _isBoolCastFromLiteralTrue(node: CallExpression)
    {
        return node.isCast && node.returnType instanceof TypeRef && node.returnType.equals(this._program.intrinsics.bool) && node.argumentList.length == 1 && node.argumentList[0] instanceof BoolLiteral && node.argumentList[0].value;
    }

    visitWhileLoop(node: WhileLoop)
    {
        let bodyReturn = node.body!.visit(this);
        if (node.conditional instanceof CallExpression && this._isBoolCastFromLiteralTrue(node.conditional)) {
            switch (bodyReturn) {
            case this.returnStyle.DefinitelyReturns:
                return this.returnStyle.DefinitelyReturns;
            case this.returnStyle.DefinitelyDoesntReturn:
            case this.returnStyle.HasntReturnedYet:
                return this.returnStyle.HasntReturnedYet;
            }
        }
        return this.returnStyle.HasntReturnedYet;
    }

    visitDoWhileLoop(node: DoWhileLoop)
    {
        let result = this.returnStyle.HasntReturnedYet;
        switch (node.body!.visit(this)) {
        case this.returnStyle.DefinitelyReturns:
            result = this.returnStyle.DefinitelyReturns;
        case this.returnStyle.DefinitelyDoesntReturn:
        case this.returnStyle.HasntReturnedYet:
            result = this.returnStyle.HasntReturnedYet;
        }
        return result;
    }

    visitForLoop(node: ForLoop)
    {
        let bodyReturn = node.body!.visit(this);
        if (node.condition === undefined || this._isBoolCastFromLiteralTrue(readInstance(node.condition, CallExpression))) {
            switch (bodyReturn) {
            case this.returnStyle.DefinitelyReturns:
                return this.returnStyle.DefinitelyReturns;
            case this.returnStyle.DefinitelyDoesntReturn:
            case this.returnStyle.HasntReturnedYet:
                return this.returnStyle.HasntReturnedYet;
            }
        }
    }
    
    visitSwitchStatement(node: SwitchStatement)
    {
        // FIXME: This seems like it's missing things. For example, we need to be smart about this:
        //
        // for (;;) {
        //     switch (...) {
        //     ...
        //         continue; // This continues the for loop
        //     }
        // }
        //
        // I'm not sure what that means for this analysis. I'm starting to think that the right way to
        // build this analysis is to run a visitor that builds a CFG and then analyze the CFG.
        // https://bugs.webkit.org/show_bug.cgi?id=177172
        
        let returnStyle = null;
        for (let switchCase of node.switchCases) {
            let bodyStyle = switchCase.body.visit(this);
            // FIXME: The fact that we need this demonstrates the need for CFG analysis.
            if (bodyStyle == this.returnStyle.DefinitelyDoesntReturn)
                bodyStyle = this.returnStyle.HasntReturnedYet;
            returnStyle = this._mergeReturnStyle(returnStyle, bodyStyle);
        }
        return returnStyle;
    }
    
    visitReturn(node: Return)
    {
        return this.returnStyle.DefinitelyReturns;
    }
    
    visitTrapStatement(node: TrapStatement)
    {
        return this.returnStyle.DefinitelyReturns;
    }

    visitBreak(node: Break)
    {
        return this.returnStyle.DefinitelyDoesntReturn;
    }

    visitContinue(node: Continue)
    {
        // FIXME: This seems wrong. Consider a loop like:
        //
        // int foo() { for (;;) { continue; } }
        //
        // This program shouldn't claim that the problem is that it doesn't return.
        // https://bugs.webkit.org/show_bug.cgi?id=177172
        return this.returnStyle.DefinitelyDoesntReturn;
    }
}


// Upstream source: ./WSL/ReturnException.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class ReturnException {
    declare _value: EPtr | null | undefined;

    constructor(value: EPtr | null | undefined)
    {
        this._value = value;
    }
    
    get value() { return this._value; }
}


// Upstream source: ./WSL/StandardLibrary.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

// NOTE: The next line is line 28, and we rely on this in Prepare.js.
let standardLibrary = `
// This is the WSL standard library. Implementations of all of these things are in
// Intrinsics.js.

// Need to bootstrap void first.
native typedef void;

native typedef uint8;
native typedef int32;
native typedef uint32;
native typedef bool;
typedef int = int32;
typedef uint = uint32;

native typedef float32;
native typedef float64;
typedef float = float32;
typedef double = float64;

native operator int32(uint32);
native operator int32(uint8);
native operator int32(float);
native operator int32(double);
native operator uint32(int32);
native operator uint32(uint8);
native operator uint32(float);
native operator uint32(double);
native operator uint8(int32);
native operator uint8(uint32);
native operator uint8(float);
native operator uint8(double);
native operator float(int32);
native operator float(uint32);
native operator float(uint8);
native operator float(double);
native operator double(float);
native operator double(int32);
native operator double(uint32);
native operator double(uint8);

native int operator+(int, int);
native uint operator+(uint, uint);
uint8 operator+(uint8 a, uint8 b) { return uint8(uint(a) + uint(b)); }
native float operator+(float, float);
native double operator+(double, double);
int operator++(int value) { return value + 1; }
uint operator++(uint value) { return value + 1; }
uint8 operator++(uint8 value) { return value + 1; }
native int operator-(int, int);
native uint operator-(uint, uint);
uint8 operator-(uint8 a, uint8 b) { return uint8(uint(a) - uint(b)); }
native float operator-(float, float);
native double operator-(double, double);
int operator--(int value) { return value - 1; }
uint operator--(uint value) { return value - 1; }
uint8 operator--(uint8 value) { return value - 1; }
native int operator*(int, int);
native uint operator*(uint, uint);
uint8 operator*(uint8 a, uint8 b) { return uint8(uint(a) * uint(b)); }
native float operator*(float, float);
native double operator*(double, double);
native int operator/(int, int);
native uint operator/(uint, uint);
uint8 operator/(uint8 a, uint8 b) { return uint8(uint(a) / uint(b)); }
native int operator&(int, int);
native int operator|(int, int);
native int operator^(int, int);
native int operator~(int);
native int operator<<(int, uint);
native int operator>>(int, uint);
native uint operator&(uint, uint);
native uint operator|(uint, uint);
native uint operator^(uint, uint);
native uint operator~(uint);
native uint operator<<(uint, uint);
native uint operator>>(uint, uint);
uint8 operator&(uint8 a, uint8 b) { return uint8(uint(a) & uint(b)); }
uint8 operator|(uint8 a, uint8 b) { return uint8(uint(a) | uint(b)); }
uint8 operator^(uint8 a, uint8 b) { return uint8(uint(a) ^ uint(b)); }
uint8 operator~(uint8 value) { return uint8(~uint(value)); }
uint8 operator<<(uint8 a, uint b) { return uint8(uint(a) << (b & 7)); }
uint8 operator>>(uint8 a, uint b) { return uint8(uint(a) >> (b & 7)); }
native float operator/(float, float);
native double operator/(double, double);
native bool operator==(int, int);
native bool operator==(uint, uint);
bool operator==(uint8 a, uint8 b) { return uint(a) == uint(b); }
native bool operator==(bool, bool);
native bool operator==(float, float);
native bool operator==(double, double);
native bool operator<(int, int);
native bool operator<(uint, uint);
bool operator<(uint8 a, uint8 b) { return uint(a) < uint(b); }
native bool operator<(float, float);
native bool operator<(double, double);
native bool operator<=(int, int);
native bool operator<=(uint, uint);
bool operator<=(uint8 a, uint8 b) { return uint(a) <= uint(b); }
native bool operator<=(float, float);
native bool operator<=(double, double);
native bool operator>(int, int);
native bool operator>(uint, uint);
bool operator>(uint8 a, uint8 b) { return uint(a) > uint(b); }
native bool operator>(float, float);
native bool operator>(double, double);
native bool operator>=(int, int);
native bool operator>=(uint, uint);
bool operator>=(uint8 a, uint8 b) { return uint(a) >= uint(b); }
native bool operator>=(float, float);
native bool operator>=(double, double);

bool operator&(bool a, bool b)
{
    if (a)
        return b;
    return false;
}

bool operator|(bool a, bool b)
{
    if (a)
        return true;
    if (b)
        return true;
    return false;
}

bool operator^(bool a, bool b)
{
    if (a)
        return !b;
    return b;
}

bool operator~(bool value)
{
    return !value;
}

protocol Addable {
    Addable operator+(Addable, Addable);
}

protocol Equatable {
    bool operator==(Equatable, Equatable);
}

restricted operator<T> T()
{
    T defaultValue;
    return defaultValue;
}

restricted operator<T> T(T x)
{
    return x;
}

operator<T:Equatable> bool(T x)
{
    return x != T();
}

struct vec2<T> {
    T x;
    T y;
}

typedef int2 = vec2<int>;
typedef uint2 = vec2<uint>;
typedef float2 = vec2<float>;
typedef double2 = vec2<double>;

operator<T> vec2<T>(T x, T y)
{
    vec2<T> result;
    result.x = x;
    result.y = y;
    return result;
}

bool operator==<T:Equatable>(vec2<T> a, vec2<T> b)
{
    return a.x == b.x && a.y == b.y;
}

thread T* operator&[]<T>(thread vec2<T>* foo, uint index)
{
    if (index == 0)
        return &foo->x;
    if (index == 1)
        return &foo->y;
    trap;
}

struct vec3<T> {
    T x;
    T y;
    T z;
}

typedef int3 = vec3<int>;
typedef uint3 = vec3<uint>;
typedef float3 = vec3<float>;
typedef double3 = vec3<double>;

operator<T> vec3<T>(T x, T y, T z)
{
    vec3<T> result;
    result.x = x;
    result.y = y;
    result.z = z;
    return result;
}

operator<T> vec3<T>(vec2<T> v2, T z)
{
    vec3<T> result;
    result.x = v2.x;
    result.y = v2.y;
    result.z = z;
    return result;
}

operator<T> vec3<T>(T x, vec2<T> v2)
{
    vec3<T> result;
    result.x = x;
    result.y = v2.x;
    result.z = v2.y;
    return result;
}

bool operator==<T:Equatable>(vec3<T> a, vec3<T> b)
{
    return a.x == b.x && a.y == b.y && a.z == b.z;
}

thread T* operator&[]<T>(thread vec3<T>* foo, uint index)
{
    if (index == 0)
        return &foo->x;
    if (index == 1)
        return &foo->y;
    if (index == 2)
        return &foo->z;
    trap;
}

struct vec4<T> {
    T x;
    T y;
    T z;
    T w;
}

typedef int4 = vec4<int>;
typedef uint4 = vec4<uint>;
typedef float4 = vec4<float>;
typedef double4 = vec4<double>;

operator<T> vec4<T>(T x, T y, T z, T w)
{
    vec4<T> result;
    result.x = x;
    result.y = y;
    result.z = z;
    result.w = w;
    return result;
}

operator<T> vec4<T>(vec2<T> v2, T z, T w)
{
    vec4<T> result;
    result.x = v2.x;
    result.y = v2.y;
    result.z = z;
    result.w = w;
    return result;
}

operator<T> vec4<T>(T x, vec2<T> v2, T w)
{
    vec4<T> result;
    result.x = x;
    result.y = v2.x;
    result.z = v2.y;
    result.w = w;
    return result;
}

operator<T> vec4<T>(T x, T y, vec2<T> v2)
{
    vec4<T> result;
    result.x = x;
    result.y = y;
    result.z = v2.x;
    result.w = v2.y;
    return result;
}

operator<T> vec4<T>(vec2<T> v2a, vec2<T> v2b)
{
    vec4<T> result;
    result.x = v2a.x;
    result.y = v2a.y;
    result.z = v2b.x;
    result.w = v2b.y;
    return result;
}

operator<T> vec4<T>(vec3<T> v3, T w)
{
    vec4<T> result;
    result.x = v3.x;
    result.y = v3.y;
    result.z = v3.z;
    result.w = w;
    return result;
}

operator<T> vec4<T>(T x, vec3<T> v3)
{
    vec4<T> result;
    result.x = x;
    result.y = v3.x;
    result.z = v3.y;
    result.w = v3.z;
    return result;
}

bool operator==<T:Equatable>(vec4<T> a, vec4<T> b)
{
    return a.x == b.x && a.y == b.y && a.z == b.z && a.w == b.w;
}

thread T* operator&[]<T>(thread vec4<T>* foo, uint index)
{
    if (index == 0)
        return &foo->x;
    if (index == 1)
        return &foo->y;
    if (index == 2)
        return &foo->z;
    if (index == 3)
        return &foo->w;
    trap;
}

native thread T* operator&[]<T>(thread T[], uint);
native threadgroup T* operator&[]<T>(threadgroup T[], uint);
native device T* operator&[]<T>(device T[], uint);
native constant T* operator&[]<T>(constant T[], uint);

native uint operator.length<T>(thread T[]);
native uint operator.length<T>(threadgroup T[]);
native uint operator.length<T>(device T[]);
native uint operator.length<T>(constant T[]);

uint operator.length<T, uint length>(T[length])
{
    return length;
}
`;

function intToString(x: number)
{
    switch (x) {
    case 0:
        return "x";
    case 1:
        return "y";
    case 2:
        return "z";
    case 3:
        return "w";
    default:
        throw new Error("Could not generate standard library.");
    }
}

// There are 481 swizzle operators. Let's not list them explicitly.
function _generateSwizzle(maxDepth: number, maxItems: number, array?: string[])
{
    if (!array)
        array = [];
    if (array.length == maxDepth) {
        let result = `vec${array.length}<T> operator.${array.join("")}<T>(vec${maxItems}<T> v)
{
    vec${array.length}<T> result;
`;
        for (let i = 0; i < array.length; ++i) {
            result += `    result.${intToString(i)} = v.${array[i]};
`;
        }
        result += `    return result;
}
`;
        return result;
    }
    let result = "";
    for (let i = 0; i < maxItems; ++i) {
        array.push(intToString(i));
        result += _generateSwizzle(maxDepth, maxItems, array);
        array.pop();
    }
    return result;
}

for (let maxDepth = 2; maxDepth <= 4; maxDepth++) {
    for (let maxItems = 2; maxItems <= 4; maxItems++)
        standardLibrary += _generateSwizzle(maxDepth, maxItems);
}


// Upstream source: ./WSL/StatementCloner.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class StatementCloner extends Rewriter {
    visitFuncDef(node: FuncDef)
    {
        let typeParameters = node.typeParameters.map(typeParameter => typeParameter.visit(this));
        let result = new FuncDef(
            node.origin, node.name,
            readInstance(node.returnType.visit(this), Type),
            readInstances(typeParameters, Node),
            readInstances(node.parameters.map((parameter: Node) => parameter.visit(this)), FuncParameter),
            readInstance(node.body.visit(this), Block),
            node.isCast, node.shaderType);
        result.isRestricted = node.isRestricted;
        return result;
    }
    
    visitNativeFunc(node: NativeFunc)
    {
        let result = new NativeFunc(
            node.origin, node.name,
            readInstance(node.returnType.visit(this), Type),
            readInstances(node.typeParameters.map(typeParameter => typeParameter.visit(this)), Node),
            readInstances(node.parameters.map((parameter: Node) => parameter.visit(this)), FuncParameter),
            node.isCast, node.shaderType);
        result.isRestricted = node.isRestricted;
        return result;
    }
    
    visitNativeType(node: NativeType)
    {
        return new NativeType(
            node.origin, node.name, readInstances(node.typeParameters.map(typeParameter => typeParameter.visit(this)), Node));
    }
    
    visitTypeDef(node: TypeDef)
    {
        return new TypeDef(
            node.origin, node.name,
            readInstances(node.typeParameters.map(typeParameter => typeParameter.visit(this)), Node),
            readInstance(node.type.visit(this), Type));
    }
    
    visitStructType(node: StructType)
    {
        let result = new StructType(
            node.origin, node.name,
            readInstances(node.typeParameters.map(typeParameter => typeParameter.visit(this)), Node));
        for (let field of node.fields)
            result.add(readInstance(field.visit(this), Field));
        return result;
    }
    
    visitConstexprTypeParameter(node: ConstexprTypeParameter)
    {
        return new ConstexprTypeParameter(node.origin, node.name, readInstance(node.type.visit(this), Type));
    }
    
    visitProtocolDecl(node: ProtocolDecl)
    {
        let result = new ProtocolDecl(node.origin, node.name);
        for (let protocol of node.extends)
            result.addExtends(readInstance(protocol.visit(this), Protocol));
        for (let signature of node.signatures)
            result.add(readInstance(signature.visit(this), ProtocolFuncDecl));
        return result;
    }

    visitTypeVariable(node: TypeVariable)
    {
        return new TypeVariable(node.origin, node.name, readOptionalInstance(Node.visit(node.protocol, this), ProtocolRef));
    }
    
    visitProtocolRef(node: ProtocolRef)
    {
        return new ProtocolRef(node.origin, node.name);
    }
    
    visitBoolLiteral(node: BoolLiteral)
    {
        return new BoolLiteral(node.origin, node.value);
    }
    
    visitTypeOrVariableRef(node: TypeOrVariableRef)
    {
        return new TypeOrVariableRef(node.origin, node.name);
    }
    
    visitEnumType(node: EnumType)
    {
        let result = new EnumType(node.origin, node.name, readInstance(node.baseType.visit(this), Type));
        for (let member of node.members)
            result.add(member);
        return result;
    }
}



// Upstream source: ./WSL/StructLayoutBuilder.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class StructLayoutBuilder extends Visitor {
    declare _offset: number;

    constructor()
    {
        super();
        this._offset = 0;
    }
    
    visitReferenceType(node: ReferenceType)
    {
    }
    
    visitStructType(node: StructType)
    {
        if (node.size != null)
            return;
        if (node.typeParameters.length)
            throw new Error("Cannot do layout for generic type: " + node);
        let oldOffset = this._offset;
        this._offset = 0;
        super.visitStructType(node);
        node.size = this._offset;
        this._offset += oldOffset;
    }
    
    get offset() { return this._offset; }
    
    visitField(node: Field)
    {
        super.visitField(node);
        node.offset = this._offset;
        let size = node.type.size;
        if (size == null)
            throw new Error("Type does not have size: " + node.type);
        this._offset += size;
    }
    
    visitNativeFuncInstance(node: NativeFuncInstance)
    {
        super.visitNativeFuncInstance(node);
        node.func.didLayoutStructsInImplementationData(node.implementationData);
    }
    
    visitTypeRef(node: TypeRef)
    {
        super.visitTypeRef(node);
        node.type!.visit(this);
    }
    
    visitCallExpression(node: CallExpression)
    {
        for (let argument of node.argumentList)
            Node.visit(argument, this);
        let handleTypeArguments = (actualTypeArguments: Node[] | null | undefined) => {
            if (actualTypeArguments) {
                for (let argument of actualTypeArguments)
                    argument.visit(this);
            }
        };
        handleTypeArguments(node.instantiatedActualTypeArguments);
        Node.visit(node.nativeFuncInstance, this);
        Node.visit(node.resultType, this);
    }
}



// Upstream source: ./WSL/StructType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class StructType extends Type {
    declare size: number;
    

    declare _origin: Origin;
    declare _name: string;
    declare _typeParameters: Node[];
    declare _fields: Map<string, Field>;

    constructor(origin: Origin, name: string, typeParameters: Node[])
    {
        super();
        this._origin = origin;
        this._name = name;
        this._typeParameters = typeParameters;
        this._fields = new Map();
    }
    
    add(field: Field)
    {
        field.struct = this;
        if (this._fields.has(field.name))
            throw new WTypeError(field.origin.originString, "Duplicate field name: " + field.name);
        this._fields.set(field.name, field);
    }
    
    get name() { return this._name; }
    get origin() { return this._origin; }
    get typeParameters() { return this._typeParameters; }
    
    get fieldNames() { return this._fields.keys(); }
    fieldByName(name: string) { return this._fields.get(name); }
    get fields() { return this._fields.values(); }
    get fieldMap() { return this._fields; }
    get isPrimitive(): boolean | number | null | undefined
    {
        let result: boolean | number = true;
        for (let field of this.fields)
            result = Number(result) & Number(field.type.isPrimitive);
        return result;
    }
    
    instantiate(typeArguments: Node[] | null = null)
    {
        let substitution = null;
        let typeParameters = this.typeParameters;
        
        if (typeArguments) {
            if (typeArguments.length != this.typeParameters.length)
                throw new WTypeError(this.origin.originString, "Wrong number of type arguments to instantiation");
            
            substitution = new Substitution(this.typeParameters, typeArguments);
            typeParameters = [];
        }
        
        let instantiateImmediates = new InstantiateImmediates();
        let result = new StructType(this.origin, this.name, typeParameters);
        for (let field of this.fields) {
            let newField = field;
            if (substitution)
                newField = readInstance(newField.visit(substitution), Field);
            newField = readInstance(newField.visit(instantiateImmediates), Field);
            result.add(newField);
        }
        
        return result;
    }
    
    populateDefaultValue(buffer: EBuffer, offset: number): void
    {
        if (this.size == null)
            throw new Error("Struct does not have layout: " + this + " " + describe(this));
        for (let field of this.fields)
            field.type.populateDefaultValue(buffer, offset + field.offset);
    }
    
    toString()
    {
        return "struct " + this.name + "<" + this.typeParameters + "> { " + Array.from(this.fields).join("; ") + "; }";
    }
}


// Upstream source: ./WSL/Substitution.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class Substitution extends Rewriter {
    declare _map: Map<Node, Node>;
    constructor(parameters: Node[], argumentList: Node[])
    {
        super();
        if (parameters.length != argumentList.length)
            throw new Error("Parameters and arguments are mismatched");
        this._map = new Map();
        for (let i = 0; i < parameters.length; ++i)
            this._map.set(parameters[i], argumentList[i]);
    }
    
    get map() { return this._map; }
    
    visitTypeRef(node: TypeRef)
    {
        let replacement = this._map.get(readInstance(node.type, Node));
        if (replacement) {
            if (node.typeArguments.length)
                throw new Error("Unexpected type arguments on type variable");
            let result = replacement.visit(new AutoWrapper());
            return result;
        }
        
        let result = super.visitTypeRef(node);
        return result;
    }

    visitVariableRef(node: VariableRef)
    {
        let replacement = this._map.get(readInstance(node.variable, Node));
        if (replacement)
            return replacement.visit(new AutoWrapper());
        
        return super.visitVariableRef(node);
    }
}



// Upstream source: ./WSL/SwitchCase.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class SwitchCase extends Node {
    declare _origin: Origin;
    declare _value: Value | null | undefined;
    declare _body: Block;

    // Null value means default.
    constructor(origin: Origin, value: Value | null | undefined, body: Block)
    {
        super();
        this._origin = origin;
        this._value = value;
        this._body = body;
    }
    
    get origin() { return this._origin; }
    get isDefault() { return !this._value; }
    get value() { return this._value; }
    get body() { return this._body; }
    
    toString()
    {
        let result = "";
        if (this.isDefault)
            result += "default";
        else
            result += "cast " + this.value;
        return result + ": " + this.body;
    }
}



// Upstream source: ./WSL/SwitchStatement.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class SwitchStatement extends Node {
    declare _switchCases: SwitchCase[];
    declare type: Type | null;

    declare _origin: Origin;
    declare _value: Value;

    constructor(origin: Origin, value: Value)
    {
        super();
        this._origin = origin;
        this._value = value;
        this._switchCases = [];
    }
    
    get origin() { return this._origin; }
    get value() { return this._value; }
    
    add(switchCase: SwitchCase)
    {
        this._switchCases.push(switchCase);
    }
    
    get switchCases() { return this._switchCases; }
    
    toString()
    {
        let result = "switch (" + this.value + ") { ";
        if (this.switchCases.length)
            result += this.switchCases.join("; "); + "; ";
        return result + "}";
    }
}



// Upstream source: ./WSL/SynthesizeEnumFunctions.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function synthesizeEnumFunctions(program: Program)
{
    for (let type of program.types.values()) {
        if (!(type instanceof EnumType))
            continue;
        
        let nativeFunc;
        let isCast = false;
        let shaderType;
        
        nativeFunc = new NativeFunc(
            type.origin, "operator==", new TypeRef(type.origin, "bool", []), [],
            [
                new FuncParameter(type.origin, null, new TypeRef(type.origin, type.name, [])),
                new FuncParameter(type.origin, null, new TypeRef(type.origin, type.name, []))
            ],
            isCast, shaderType);
        nativeFunc.implementation = ([left, right]) => EPtr.box(left.loadValue() == right.loadValue());
        program.add(nativeFunc);
        
        nativeFunc = new NativeFunc(
            type.origin, "operator.value", readInstance(type.baseType.visit(new Rewriter()), Type), [],
            [new FuncParameter(type.origin, null, new TypeRef(type.origin, type.name, []))],
            isCast, shaderType);
        nativeFunc.implementation = ([value]) => value;
        program.add(nativeFunc);
        
        nativeFunc = new NativeFunc(
            type.origin, "operator cast", readInstance(type.baseType.visit(new Rewriter()), Type), [],
            [new FuncParameter(type.origin, null, new TypeRef(type.origin, type.name, []))],
            isCast, shaderType);
        nativeFunc.implementation = ([value]) => value;
        program.add(nativeFunc);
        
        nativeFunc = new NativeFunc(
            type.origin, "operator cast", new TypeRef(type.origin, type.name, []), [],
            [new FuncParameter(type.origin, null, readInstance(type.baseType.visit(new Rewriter()), Type))],
            isCast, shaderType);
        nativeFunc.implementation = ([value]) => value;
        program.add(nativeFunc);
    }
}


// Upstream source: ./WSL/SynthesizeStructAccessors.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function synthesizeStructAccessors(program: Program)
{
    for (let type of program.types.values()) {
        if (!(type instanceof StructType))
            continue;
        
        for (let field of type.fields) {
            function createTypeParameters()
            {
                return readInstance(type!, StructType).typeParameters.map(
                    typeParameter => readInstance(typeParameter.visit(new TypeParameterRewriter()), Node));
            }
            
            function createTypeArguments()
            {
                return typeParameters.map((typeParameter) => typeParameter.visit(new AutoWrapper()));
            }
            
            function setupImplementationData(nativeFunc: NativeFunc, implementation: (args:EPtr[], offset:number, structSize:number, fieldSize:number)=>EPtr)
            {
                nativeFunc.instantiateImplementation = (substitution) => {
                    let newType = readInstance(type!, StructType).instantiate(nativeFunc.typeParameters.map((typeParameter) => {
                        let substitute = substitution.map.get(typeParameter);
                        if (!substitute)
                            throw new Error("Null substitute for type parameter " + typeParameter);
                        return substitute;
                    }));
                    return {type: newType, fieldName: field!.name};
                };
                nativeFunc.visitImplementationData = (implementationData, visitor) => {
                    const data = readStructImplementationData(implementationData);
                    // Visiting the type first ensures that the struct layout builder figures out the field's
                    // offset.
                    data.type.visit(visitor);
                };
                nativeFunc.didLayoutStructsInImplementationData = (implementationData) => {
                    const data = readStructImplementationData(implementationData);
                    let structSize = data.type.size;
                    if (structSize == null)
                        throw new Error("No struct size for " + nativeFunc);
                    let field = data.type.fieldByName(data.fieldName);
                    if (!field)
                        throw new Error("Could not find field");
                    let offset = field!.offset;
                    let fieldSize = field!.type.size;
                    if (fieldSize == null)
                        throw new Error("No field size for " + nativeFunc);
                    if (offset == null)
                        throw new Error("No offset for " + nativeFunc);
                    
                    data.offset = offset;
                    data.structSize = structSize;
                    data.fieldSize = fieldSize;
                };
                nativeFunc.implementation = (argumentList: EPtr[], node: CallExpression) => {
                    let nativeFuncInstance = node.nativeFuncInstance;
                    let implementationData = readStructImplementationData(nativeFuncInstance.implementationData);
                    return implementation(
                        argumentList,
                        implementationData.offset!,
                        implementationData.structSize!,
                        implementationData.fieldSize!);
                };
            }
            
            function createFieldType()
            {
                return field!.type.visit(new Substitution(readInstance(type!, StructType).typeParameters, typeParameters));
            }
            
            function createTypeRef()
            {
                return TypeRef.instantiate(type!, createTypeArguments());
            }
            
            let isCast = false;
            let shaderType: string | undefined;
            let typeParameters!: Node[];
            let nativeFunc!: NativeFunc;

            // The getter: operator.field
            typeParameters = readInstances(createTypeParameters(), Node);
            nativeFunc = new NativeFunc(
                field!.origin, "operator." + field!.name, readInstance(createFieldType(), Type), readInstances(typeParameters, Node),
                [new FuncParameter(field!.origin, null, createTypeRef())], isCast, shaderType);
            setupImplementationData(nativeFunc, ([base], offset: number, structSize, fieldSize: number) => {
                let result = new EPtr(new EBuffer(fieldSize), 0);
                result.copyFrom(base.plus(offset), fieldSize);
                return result;
            });
            program.add(nativeFunc);
            
            // The setter: operator.field=
            typeParameters = readInstances(createTypeParameters(), Node);
            nativeFunc = new NativeFunc(
                field!.origin, "operator." + field!.name + "=", createTypeRef(), readInstances(typeParameters, Node),
                [
                    new FuncParameter(field!.origin, null, createTypeRef()),
                    new FuncParameter(field!.origin, null, readInstance(createFieldType(), Type))
                ],
                isCast, shaderType);
            setupImplementationData(nativeFunc, ([base, value], offset: number, structSize: number, fieldSize: number) => {
                let result = new EPtr(new EBuffer(structSize), 0);
                result.copyFrom(base, structSize);
                result.plus(offset).copyFrom(value, fieldSize);
                return result;
            });
            program.add(nativeFunc);
            
            // The ander: operator&.field
            function setupAnder(addressSpace: string)
            {
                typeParameters = readInstances(createTypeParameters(), Node);
                nativeFunc = new NativeFunc(
                    field!.origin, "operator&." + field!.name, new PtrType(field!.origin, addressSpace, readInstance(createFieldType(), Type)),
                    readInstances(typeParameters, Node),
                    [
                        new FuncParameter(
                            field!.origin, null,
                            new PtrType(field!.origin, addressSpace, createTypeRef()))
                    ],
                    isCast, shaderType);
                setupImplementationData(nativeFunc, ([base]: Slot[], offset: number, structSize: number, fieldSize: number) => {
                    base = readOptionalInstance(readInstance(base, EPtr).loadValue(), EPtr);
                    if (!base)
                        throw new WTrapError(node.origin.originString, "Null dereference");
                    return EPtr.box(base.plus(offset));
                });
                program.add(nativeFunc);
            }
            
            setupAnder("thread");
            setupAnder("threadgroup");
            setupAnder("device");
            setupAnder("constant");
        }
    }
}


// Upstream source: ./WSL/TrapStatement.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TrapStatement extends Node {
    declare _origin: Origin;

    constructor(origin: Origin)
    {
        super();
        this._origin = origin;
    }
    
    get origin() { return this._origin; }
    
    toString()
    {
        return "trap";
    }
};



// Upstream source: ./WSL/TypeDef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeDef extends Type {
    declare _origin: Origin;
    declare _name: string;
    declare _typeParameters: Node[];
    declare _type: Type;

    constructor(origin: Origin, name: string, typeParameters: Node[], type: Type)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._typeParameters = typeParameters;
        this._type = type;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get typeParameters() { return this._typeParameters; }
    get type() { return this._type; }
    
    toString()
    {
        return "typedef " + this.name + "<" + this.typeParameters + "> = " + this.type;
    }
}



// Upstream source: ./WSL/TypeDefResolver.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeDefResolver extends Visitor {
    declare _visiting: VisitingSet;

    constructor()
    {
        super();
        this._visiting = new VisitingSet();
    }
    
    visitTypeRef(node: TypeRef)
    {
        this._visiting.doVisit(node, () => {
            for (let typeArgument of node.typeArguments)
                typeArgument.visit(this);
            if (node.type instanceof TypeDef) {
                let unificationContext = new UnificationContext(node.type.typeParameters);
                if (node.typeArguments.length != node.type.typeParameters.length)
                    throw new Error("argument/parameter mismatch (should have been caught earlier)");
                for (let i = 0; i < node.typeArguments.length; ++i)
                    node.typeArguments[i].unify(unificationContext, node.type.typeParameters[i]);
                let verificationResult = unificationContext.verify();
                if (!verificationResult.result)
                    throw new WTypeError(node.origin.originString, "Type reference to a type definition violates protocol constraints: " + verificationResult.reason);
                
                let newType = node.type.type.substituteToUnification(node.type.typeParameters, unificationContext);
                newType.visit(this);
                node.setTypeAndArguments(readInstance(newType, Type), []);
            }
        });
    }
}


// Upstream source: ./WSL/TypeOrVariableRef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeOrVariableRef extends Node {
    declare _origin: Origin;
    declare _name: string;

    constructor(origin: Origin, name: string)
    {
        super();
        this._origin = origin;
        this._name = name;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }

    toString()
    {
        return this.name;
    }
}


// Upstream source: ./WSL/TypeParameterRewriter.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeParameterRewriter {
    visitConstexprTypeParameter(node: ConstexprTypeParameter)
    {
        return new ConstexprTypeParameter(node.origin, node.name, readInstance(node.type.visit(new Rewriter()), Type));
    }
    
    visitTypeVariable(node: TypeVariable)
    {
        return new TypeVariable(node.origin, node.name, node.protocol);
    }
}



// Upstream source: ./WSL/TypeRef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeRef extends Type {
    declare _origin: Origin;
    declare _name: string | null | undefined;
    declare type: Type | null;
    declare _typeArguments: Node[];

    constructor(origin: Origin, name: string | null | undefined, typeArguments: Node[])
    {
        super();
        this._origin = origin;
        this._name = name;
        this.type = null;
        this._typeArguments = typeArguments;
    }
    
    static wrap(type: Type)
    {
        if (type instanceof TypeRef && !type.typeArguments)
            return type;
        let name = type.name;
        let result = new TypeRef(type.origin, name, []);
        result.type = type;
        return result;
    }
    
    static instantiate(type: Type, typeArguments: Node[])
    {
        let result = new TypeRef(type.origin, type.name, typeArguments);
        result.type = type;
        return result;
    }
 
    get origin() { return this._origin; }
    get name() { return this._name; }
    get typeArguments() { return this._typeArguments; }
    
    get unifyNode(): Type
    {
        if (!this.typeArguments.length)
            return this.type!.unifyNode;
        return this;
    }
    
    populateDefaultValue(buffer: EBuffer, offset: number): void
    {
        if (!this.typeArguments.length)
            return this.type!.populateDefaultValue(buffer, offset);
        throw new Error("Cannot get default value of a type instantiation");
    }
    
    get size(): number
    {
        if (!this.typeArguments.length)
            return this.type!.size;
        throw new Error("Cannot get size of a type instantiation");
    }
    
    get isPrimitive(): boolean | number | null | undefined
    {
        if (!this.typeArguments.length)
            return this.type!.isPrimitive;
        throw new Error("Cannot determine if an uninstantiated type is primitive: " + this);
    }
    
    setTypeAndArguments(type: Type, typeArguments: Node[])
    {
        this._name = null;
        this.type = type;
        this._typeArguments = typeArguments;
    }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        if (!(other instanceof TypeRef))
            return false;
        if (!this.type!.unify(unificationContext, readInstance(other.type, Node)))
            return false;
        if (this.typeArguments.length != other.typeArguments.length)
            return false;
        for (let i = 0; i < this.typeArguments.length; ++i) {
            if (!this.typeArguments[i].unify(unificationContext, other.typeArguments[i]))
                return false;
        }
        return true;
    }
    
    toString(): string
    {
        if (!this.name)
            return this.type!.toString();
        if (!this.typeArguments.length)
            return this.name;
        return this.name + "<" + this.typeArguments + ">";
    }
}



// Upstream source: ./WSL/TypeVariable.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeVariable extends Type {
    declare _origin: Origin;
    declare _name: string;
    declare _protocol: ProtocolRef | null | undefined;

    constructor(origin: Origin, name: string, protocol: ProtocolRef | null | undefined)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._protocol = protocol;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get protocol() { return this._protocol; }
    
    get isPrimitive(): boolean | number | null | undefined
    {
        return this._protocol && this._protocol.isPrimitive;
    }
    
    get isUnifiable() { return true; }
    
    inherits(protocol: ProtocolRef | null | undefined): Verification
    {
        if (!protocol)
            return {result: true};
        if (!this.protocol)
            return {result: false, reason: "Type variable " + this + " does not have a protocol"};
        return this.protocol.inherits(protocol);
    }
    
    typeVariableUnify(unificationContext: UnificationContext, other: Node)
    {
        if (!(other instanceof Type))
            return false;
        
        return this._typeVariableUnifyImpl(unificationContext, other);
    }
    
    unifyImpl(unificationContext: UnificationContext, other: Node)
    {
        return this.typeVariableUnify(unificationContext, other);
    }
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        let realThis = unificationContext.find(this);
        
        // The thing we get unified with must be a type variable that accepts a broader set of
        // things than we do.
        if (!(realThis instanceof TypeVariable))
            return {result: false, reason: "Type variable argument " + this + " cannot be passed to non-type-variable parameter type " + realThis};
        
        if (!this.protocol) {
            if (realThis.protocol)
                return {result: false, reason: "Type variable without protocol " + this + " cannot be passed to parameter type variable with protocol " + realThis.protocol};
            return {result: true};
        }
        
        let result = this.protocol.inherits(realThis.protocol);
        if (!result.result)
            return {result: false, reason: "Protocol " + this.protocol + " does not subsume protocol " + realThis.protocol + " (passing type " + this + " to type " + realThis + "): " + result.reason};
        return {result: true};
    }
    
    verifyAsParameter(unificationContext: UnificationContext): Verification
    {
        if (!this.protocol)
            return {result: true};
        let realThis = unificationContext.find(this);
        let result = realThis.inherits(this.protocol);
        if (!result.result)
            return {result: false, reason: "Type " + realThis + " does not inherit protocol " + this.protocol + " (passing type " + realThis + " to type " + this + "): " + result.reason};
        return {result: true};
    }
    
    toString()
    {
        return this.name + (this.protocol ? ":" + this.protocol.name : "");
    }
}



// Upstream source: ./WSL/TypeVariableTracker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypeVariableTracker extends Visitor {
    declare _set: Set<Node>;

    constructor()
    {
        super();
        this._set = new Set();
    }
    
    get set() { return this._set; }
    
    _consider(thing: Node | null)
    {
        if (thing!.isUnifiable)
            this._set.add(readInstance(thing, Node));
    }
    
    visitTypeRef(node: TypeRef)
    {
        if (node.typeArguments.length) {
            for (let typeArgument of node.typeArguments)
                typeArgument.visit(this);
            return;
        }
        this._consider(node.type);
    }
    
    visitVariableRef(node: VariableRef)
    {
        this._consider(node.variable);
    }
}



// Upstream source: ./WSL/TypedValue.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class TypedValue {
    declare _type: Type;
    declare _ePtr: EPtr | null | undefined;

    constructor(type: Type, ePtr: EPtr | null | undefined)
    {
        this._type = type;
        this._ePtr = ePtr;
    }
    
    get type() { return this._type; }
    get ePtr() { return this._ePtr; }
    
    static box(type: Type, value: Slot)
    {
        return new TypedValue(type, EPtr.box(value));
    }
    
    get value() { return this.ePtr!.loadValue(); }
    
    toString()
    {
        return this.type + "(" + this.ePtr + ")";
    }
}


// Upstream source: ./WSL/UintLiteral.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let UintLiteral = createLiteral({
    literalClassName: "UintLiteral",
    preferredTypeName: "uint",
    
    negConstexpr(origin: Origin)
    {
        return new UintLiteral(origin, (-this.value) >>> 0);
    },
    
    createType(origin: Origin, value: Slot)
    {
        return new UintLiteralType(origin, readNumber(value));
    }
});



// Upstream source: ./WSL/UintLiteralType.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

let UintLiteralType = createLiteralType({
    preferredTypeName: "uint",
    
    verifyAsArgument(unificationContext: UnificationContext): Verification
    {
        let realThis = unificationContext.find(this);
        if (!realThis.isInt)
            return {result: false, reason: "Cannot use uint literal with non-integer type " + realThis};
        if (realThis.isSigned)
            return {result: false, reason: "Cannot use uint literal with signed type " + realThis};
        if (!realThis.canRepresent!(this.value))
            return {result: false, reason: "Uint literal " + this.value + " too large to be represented by type " + realThis};
        return {result: true};
    }
});


// Upstream source: ./WSL/UnificationContext.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class UnificationContext {
    declare _typeParameters: Set<Node>;
    declare _nextMap: Map<Node, Node>;
    declare _extraNodes: Set<Node>;

    constructor(typeParameters?: Node[])
    {
        this._typeParameters = new Set(typeParameters);
        this._nextMap = new Map();
        this._extraNodes = new Set();
    }
    
    union(a: Node, b: Node)
    {
        a = this.find(readInstance(a, Node));
        b = this.find(readInstance(b, Node));
        if (a == b)
            return;
        
        if (!a.isUnifiable) {
            [a, b] = [b, a];
            if (!a.isUnifiable)
                throw new Error("Cannot unify non-unifiable things " + a + " and " + b);
        }
        
        // Make sure that type parameters don't end up being roots.
        if (a.isUnifiable && b.isUnifiable && this._typeParameters.has(b))
            [a, b] = [b, a];
        
        this._nextMap.set(a, b);
    }
    
    find(node: Type): Type;
    find(node: Value): Value;
    find(node: Node): Node;
    find(node: Node)
    {
        let currentNode = node;
        let nextNode = this._nextMap.get(currentNode);
        if (!nextNode)
            return node instanceof Type ? readInstance(currentNode, Type) : node instanceof Value ? readInstance(currentNode, Value) : currentNode;
        for (;;) {
            currentNode = nextNode;
            nextNode = this._nextMap.get(currentNode);
            if (!nextNode)
                break;
        }
        this._nextMap.set(node, currentNode);
        return node instanceof Type ? readInstance(currentNode, Type) : node instanceof Value ? readInstance(currentNode, Value) : currentNode;
    }
    
    addExtraNode(node: Node)
    {
        this._extraNodes.add(node);
    }
    
    get nodes()
    {
        let result = new Set<Node>();
        for (let [key, value] of this._nextMap) {
            result.add(key);
            result.add(value);
        }
        for (let node of this._extraNodes)
            result.add(node);
        return result;
    }
    
    typeParameters() { return this._typeParameters; }
    *typeArguments()
    {
        for (let typeArgument of this.nodes) {
            if (!typeArgument.isUnifiable)
                continue;
            if (this._typeParameters.has(typeArgument))
                continue;
            yield typeArgument;
        }
    }
    
    verify()
    {
        // We do a two-phase pre-verification. This gives literals a chance to select a more specific type.
        let preparations = [];
        for (let node of this.nodes) {
            let preparation = node.prepareToVerify(this);
            if (preparation)
                preparations.push(preparation);
        }
        for (let preparation of preparations) {
            let result = preparation();
            if (!result.result)
                return result;
        }
        
        for (let typeParameter of this._typeParameters) {
            let result = typeParameter.verifyAsParameter!(this);
            if (!result.result)
                return result;
        }
        let numTypeVariableArguments = 0;
        let argumentSet = new Set();
        for (let typeArgument of this.typeArguments()) {
            let result = typeArgument.verifyAsArgument!(this);
            if (!result.result)
                return result;
            if (typeArgument.isLiteral)
                continue;
            argumentSet.add(this.find(typeArgument));
            numTypeVariableArguments++;
        }
        if (argumentSet.size == numTypeVariableArguments)
            return {result: true};
        return {result: false, reason: "Type variables used as arguments got unified with each other"};
    }
    
    get conversionCost()
    {
        let result = 0;
        for (let typeArgument of this.typeArguments())
            result += typeArgument.conversionCost(this);
        return result;
    }
    
    commit()
    {
        for (let typeArgument of this.typeArguments())
            typeArgument.commitUnification(this);
    }
}



// Upstream source: ./WSL/UnreachableCodeChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class UnreachableCodeChecker extends Visitor {
    declare _returnChecker: ReturnChecker;

    constructor(program: Program)
    {
        super();
        this._returnChecker = new ReturnChecker(program);
    }
    
    visitBlock(node: Block)
    {
        super.visitBlock(node);
        for (let i = 0; i < node.statements.length - 1; ++i) {
            switch(node.statements[i].visit(this._returnChecker)) {
            case this._returnChecker.returnStyle.DefinitelyReturns:
            case this._returnChecker.returnStyle.DefinitelyDoesntReturn:
                throw new WTypeError(
                    node.statements[i + 1].origin!.originString,
                    "Unreachable code");
            case this._returnChecker.returnStyle.HasntReturnedYet:
                continue;
            }
        }
    }
}


// Upstream source: ./WSL/VariableDecl.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class VariableDecl extends Value {
    declare _initializer: Value | null;

    declare ePtr: EPtr;
    declare _origin: Origin;
    declare _name: string;
    declare _type: Type;

    constructor(origin: Origin, name: string, type: Type, initializer: Value | null)
    {
        super();
        this._origin = origin;
        this._name = name;
        this._type = type;
        this._initializer = initializer;
    }
    
    get origin() { return this._origin; }
    get name() { return this._name; }
    get type() { return this._type; }
    get initializer() { return this._initializer; }
    get varIsLValue() { return true; }
    
    toString()
    {
        return this.type + " " + this.name + (this.initializer ? " = " + this.initializer : "");
    }
}



// Upstream source: ./WSL/VariableRef.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class VariableRef extends Expression {
    declare variable: Variable | null;

    declare _name: string | null;

    constructor(origin: Origin, name: string | null)
    {
        super(origin);
        this._name = name;
        this.variable = null;
    }
    
    static wrap(variable: ConstexprTypeParameter|FuncParameter|VariableDecl|AnonymousVariable)
    {
        let result = new VariableRef(variable.origin, variable.name);
        result.variable = variable;
        return result;
    }
    
    get name() { return this._name; }
    get isConstexpr() { return this.variable!.isConstexpr; }
    get unifyNode(): Value { return this.variable!.unifyNode; } // This only makes sense when this is a constexpr.
    get isLValue() { return this.variable!.varIsLValue; }
    get addressSpace() { return "thread"; }
    
    toString()
    {
        return this.name;
    }
}


// Upstream source: ./WSL/VisitingSet.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class VisitingSet {
    declare _set: Set<Node | undefined>;

    constructor(...items: (Node | undefined)[])
    {
        this._set = new Set(items);
    }
    
    doVisit<T>(item: Node, callback: ()=>T): T
    {
        if (this._set.has(item))
            throw new WTypeError(item.origin!.originString, "Recursive " + readProperty(readProperty(item, "kind"), "name"));
        this._set.add(item);
        try {
            return callback();
        } finally {
            this._set.delete(item);
        }
    }
}


// Upstream source: ./WSL/WSyntaxError.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class WSyntaxError extends Error {
    declare originString: string | undefined;
    declare syntaxErrorMessage: string;

    constructor(originString: string | undefined, message: string)
    {
        super("Syntax error at " + originString + ": " + message);
        this.originString = originString;
        this.syntaxErrorMessage = message;
    }
}



// Upstream source: ./WSL/WTrapError.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class WTrapError extends Error {
    declare originString: string | undefined;
    declare syntaxErrorMessage: string;

    constructor(originString: string | undefined, message: string)
    {
        super("Trap at " + originString + ": " + message);
        this.originString = originString;
        this.syntaxErrorMessage = message;
    }
}



// Upstream source: ./WSL/WTypeError.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class WTypeError extends Error {
    declare originString: string | undefined;
    declare typeErrorMessage: string | undefined;

    constructor(originString: string | undefined, message?: string)
    {
        super("Type error at " + originString + ": " + message);
        this.originString = originString;
        this.typeErrorMessage = message;
    }
}



// Upstream source: ./WSL/WhileLoop.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class WhileLoop extends Node {
    declare _conditional: Value;

    declare _origin: Origin;
    declare _body: Node | null;

    constructor(origin: Origin, conditional: Value, body: Node | null)
    {
        super();
        this._origin = origin;
        this._conditional = conditional;
        this._body = body;
    }

    get origin() { return this._origin; }
    get conditional() { return this._conditional; }
    get body() { return this._body; }

    toString()
    {
        return "while (" + this.conditional + ") " + this.body;
    }
};



// Upstream source: ./WSL/WrapChecker.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

class WrapChecker extends Visitor {
    declare _startNode: Node;

    constructor(node: Node)
    {
        super();
        this._startNode = node;
    }
    
    visitVariableRef(node: VariableRef)
    {
    }
    
    visitTypeRef(node: TypeRef)
    {
    }
    
    _foundUnwrapped(node: Node)
    {
        function originString(node: Node)
        {
            let origin = node.origin;
            if (!origin)
                return "<null origin>";
            return origin.originString;
        }
        
        throw new Error("Found unwrapped " + node.constructor.name + " at " + originString(node) + ": " + node + "\nWhile visiting " + this._startNode.constructor.name + " at " + originString(readInstance(this._startNode.origin, Node)) + ": " + this._startNode);
    }
    
    visitConstexprTypeParameter(node: ConstexprTypeParameter)
    {
        this._foundUnwrapped(node);
    }
    
    visitFuncParameter(node: FuncParameter)
    {
        this._foundUnwrapped(node);
    }
    
    visitVariableDecl(node: VariableDecl)
    {
        this._foundUnwrapped(node);
    }
    
    visitStructType(node: StructType)
    {
        this._foundUnwrapped(node);
    }
    
    visitNativeType(node: NativeType)
    {
        this._foundUnwrapped(node);
    }
    
    visitTypeVariable(node: TypeVariable)
    {
        this._foundUnwrapped(node);
    }
    
    // NOTE: This does not know how to handle NativeTypeInstance, because this is never called on instantiated
    // code. Once code is instantiated, you cannot instantiate it further.
    
    // NOTE: This needs to be kept in sync with AutoWrapper.
}


// Upstream source: ./WSL/Test.js
/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

function doPrep(code: string)
{
    return prepare("/internal/test", 0, code);
}

function doLex(code: string)
{
    let lexer: Lexer = new Lexer("/internal/test", "native", 0, code);
    var result = [];
    for (;;) {
        let next = lexer.next();
        if (!next)
            return result;
        result.push(next);
    }
    return result;
}

function makeInt(program: Program, value: number)
{
    return TypedValue.box(program.intrinsics.int32, value);
}

function makeUint(program: Program, value: number)
{
    return TypedValue.box(program.intrinsics.uint32, value);
}

function makeUint8(program: Program, value: number)
{
    return TypedValue.box(program.intrinsics.uint8, value);
}

function makeBool(program: Program, value: boolean)
{
    return TypedValue.box(program.intrinsics.bool, value);
}

function makeFloat(program: Program, value: number)
{
    return TypedValue.box(program.intrinsics.float, value);
}

function makeDouble(program: Program, value: number)
{
    return TypedValue.box(program.intrinsics.double, value);
}

function makeEnum(program: Program, enumName: string, value: string)
{
    let enumType = program.types.get(enumName);
    if (!enumType)
        throw new Error("No type named " + enumName);
    let enumMember = readInstance(enumType, EnumType).memberByName(value);
    if (!enumMember)
        throw new Error("No member named " + enumMember + " in " + enumType);
    return TypedValue.box(enumType, enumMember.value!.unifyNode.valueForSelectedType);
}

function checkNumber(program: Program, result: TypedValue, expected: number)
{
    if (!result.type.unifyNode.isNumber)
        throw new Error("Wrong result type; result: " + result);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkInt(program: Program, result: TypedValue, expected: number)
{
    if (!result.type.equals(program.intrinsics.int32))
        throw new Error("Wrong result type; result: " + result);
    checkNumber(program, result, expected);
}

function checkEnum(program: Program, result: TypedValue, expected: number)
{
    if (!(result.type.unifyNode instanceof EnumType))
        throw new Error("Wrong result type; result: " + result);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkUint(program: Program, result: TypedValue, expected: number)
{
    if (!result.type.equals(program.intrinsics.uint32))
        throw new Error("Wrong result type: " + result.type);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkUint8(program: Program, result: TypedValue, expected: number)
{
    if (!result.type.equals(program.intrinsics.uint8))
        throw new Error("Wrong result type: " + result.type);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkBool(program: Program, result: TypedValue, expected: boolean)
{
    if (!result.type.equals(program.intrinsics.bool))
        throw new Error("Wrong result type: " + result.type);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkFloat(program: Program, result: TypedValue, expected: number)
{
    if (!result.type.equals(program.intrinsics.float))
        throw new Error("Wrong result type: " + result.type);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkDouble(program: Program, result: TypedValue, expected: number)
{
    if (!result.type.equals(program.intrinsics.double))
        throw new Error("Wrong result type: " + result.type);
    if (result.value != expected)
        throw new Error("Wrong result: " + result.value + " (expected " + expected + ")");
}

function checkLexerToken(result: LexerToken, expectedIndex: number, expectedKind: string, expectedText: string)
{
    if (result._index != expectedIndex)
        throw new Error("Wrong lexer index; result: " + result._index + " (expected " + expectedIndex + ")");
    if (result._kind != expectedKind)
        throw new Error("Wrong lexer kind; result: " + result._kind + " (expected " + expectedKind + ")");
    if (result._text != expectedText)
        throw new Error("Wrong lexer text; result: " + result._text + " (expected " + expectedText + ")");
}

function checkFail(callback: ()=>void, predicate: (error: unknown)=>boolean)
{
    try {
        callback();
        throw new Error("Did not throw exception");
    } catch (e) {
        if (predicate(e)) {
            return;
        }
        throw e;
    }
}

let okToTest = false;

let tests = new Proxy<Record<string, () => void>>({}, {
    set(target, property: string, value: () => void, receiver: unknown)
    {
        if (property in target)
            throw new Error("Trying to declare duplicate test: " + property);
        target[property] = value;
        return true;
    }
});


tests.literalBool = function() {
    let program = doPrep("bool foo() { return true; }");
    checkBool(program, callFunction(program, "foo", [], []), true);
}

tests.identityBool = function() {
    let program = doPrep("bool foo(bool x) { return x; }");
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false)]), false);
}

tests.intSimpleMath = function() {
    let program = doPrep("int foo(int x, int y) { return x + y; }");
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 5)]), 12);
    program = doPrep("int foo(int x, int y) { return x - y; }");
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 5)]), 2);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5), makeInt(program, 7)]), -2);
    program = doPrep("int foo(int x, int y) { return x * y; }");
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 5)]), 35);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, -5)]), -35);
    program = doPrep("int foo(int x, int y) { return x / y; }");
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 2)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, -2)]), -3);
}

tests.uintSimpleMath = function() {
    let program = doPrep("uint foo(uint x, uint y) { return x + y; }");
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 5)]), 12);
    program = doPrep("uint foo(uint x, uint y) { return x - y; }");
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 5)]), 2);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 5), makeUint(program, 7)]), 4294967294);
    program = doPrep("uint foo(uint x, uint y) { return x * y; }");
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 5)]), 35);
    program = doPrep("uint foo(uint x, uint y) { return x / y; }");
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 2)]), 3);
}

tests.uint8SimpleMath = function() {
    let program = doPrep("uint8 foo(uint8 x, uint8 y) { return x + y; }");
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 5)]), 12);
    program = doPrep("uint8 foo(uint8 x, uint8 y) { return x - y; }");
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 5)]), 2);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 5), makeUint8(program, 7)]), 254);
    program = doPrep("uint8 foo(uint8 x, uint8 y) { return x * y; }");
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 5)]), 35);
    program = doPrep("uint8 foo(uint8 x, uint8 y) { return x / y; }");
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 2)]), 3);
}

tests.equality = function() {
    let program = doPrep("bool foo(uint x, uint y) { return x == y; }");
    checkBool(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 5)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 7)]), true);
    program = doPrep("bool foo(uint8 x, uint8 y) { return x == y; }");
    checkBool(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 5)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 7)]), true);
    program = doPrep("bool foo(int x, int y) { return x == y; }");
    checkBool(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 5)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 7)]), true);
    program = doPrep("bool foo(bool x, bool y) { return x == y; }");
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, true)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, false)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, false)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, true)]), true);
}

tests.logicalNegation = function()
{
    let program = doPrep("bool foo(bool x) { return !x; }");
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false)]), true);
}

tests.notEquality = function() {
    let program = doPrep("bool foo(uint x, uint y) { return x != y; }");
    checkBool(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 5)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeUint(program, 7), makeUint(program, 7)]), false);
    program = doPrep("bool foo(uint8 x, uint8 y) { return x != y; }");
    checkBool(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 5)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeUint8(program, 7), makeUint8(program, 7)]), false);
    program = doPrep("bool foo(int x, int y) { return x != y; }");
    checkBool(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 5)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeInt(program, 7), makeInt(program, 7)]), false);
    program = doPrep("bool foo(bool x, bool y) { return x != y; }");
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, true)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, false)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, false)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, true)]), false);
}

tests.equalityTypeFailure = function()
{
    checkFail(
        () => doPrep("bool foo(int x, uint y) { return x == y; }"),
        (e) => e instanceof WTypeError && e.message.indexOf("/internal/test:1") != -1);
}

tests.generalNegation = function()
{
    let program = doPrep("bool foo(int x) { return !x; }");
    checkBool(program, callFunction(program, "foo", [], [makeInt(program, 7)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeInt(program, 0)]), true);
}

tests.add1 = function() {
    let program = doPrep("int foo(int x) { return x + 1; }");
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 42)]), 43);
}

tests.simpleGeneric = function() {
    let program = doPrep(`
        T id<T>(T x) { return x; }
        int foo(int x) { return id(x) + 1; }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 42)]), 43);
}

tests.nameResolutionFailure = function()
{
    checkFail(
        () => doPrep("int foo(int x) { return x + y; }"),
        (e) => e instanceof WTypeError && e.message.indexOf("/internal/test:1") != -1);
}

tests.simpleVariable = function()
{
    let program = doPrep(`
        int foo(int p)
        {
            int result = p;
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 42)]), 42);
}

tests.simpleAssignment = function()
{
    let program = doPrep(`
        int foo(int p)
        {
            int result;
            result = p;
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 42)]), 42);
}

tests.simpleDefault = function()
{
    let program = doPrep(`
        int foo()
        {
            int result;
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 0);
}

tests.simpleDereference = function()
{
    let program = doPrep(`
        int foo(device int* p)
        {
            return *p;
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 13);
    checkInt(program, callFunction(program, "foo", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 13);
}

tests.dereferenceStore = function()
{
    let program = doPrep(`
        void foo(device int* p)
        {
            *p = 52;
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 13);
    callFunction(program, "foo", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]);
    if (buffer.get(0) != 52)
        throw new Error("Expected buffer to contain 52 but it contains: " + buffer.get(0));
}

tests.simpleMakePtr = function()
{
    let program = doPrep(`
        thread int* foo()
        {
            int x = 42;
            return &x;
        }
    `);
    let result = callFunction(program, "foo", [], []);
    if (!result.type.isPtr)
        throw new Error("Return type is not a pointer: " + result.type);
    if (!result.type.elementType!.equals(program.intrinsics.int32))
        throw new Error("Return type is not a pointer to an int: " + result.type);
    if (!(result.value instanceof EPtr))
        throw new Error("Return value is not an EPtr: " + result.value);
    let value = result.value.loadValue();
    if (value != 42)
        throw new Error("Expected 42 but got: " + value);
}

tests.threadArrayLoad = function()
{
    let program = doPrep(`
        int foo(thread int[] array)
        {
            return array[0u];
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 89);
    let result = callFunction(program, "foo", [], [TypedValue.box(new ArrayRefType(externalOrigin, "thread", program.intrinsics.int32), new EArrayRef(new EPtr(buffer, 0), 1))]);
    checkInt(program, result, 89);
}

tests.threadArrayLoadIntLiteral = function()
{
    let program = doPrep(`
        int foo(thread int[] array)
        {
            return array[0];
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 89);
    let result = callFunction(program, "foo", [], [TypedValue.box(new ArrayRefType(externalOrigin, "thread", program.intrinsics.int32), new EArrayRef(new EPtr(buffer, 0), 1))]);
    checkInt(program, result, 89);
}

tests.deviceArrayLoad = function()
{
    let program = doPrep(`
        int foo(device int[] array)
        {
            return array[0u];
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 89);
    let result = callFunction(program, "foo", [], [TypedValue.box(new ArrayRefType(externalOrigin, "device", program.intrinsics.int32), new EArrayRef(new EPtr(buffer, 0), 1))]);
    checkInt(program, result, 89);
}

tests.threadArrayStore = function()
{
    let program = doPrep(`
        void foo(thread int[] array, int value)
        {
            array[0u] = value;
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 15);
    let arrayRef = TypedValue.box(
        new ArrayRefType(externalOrigin, "thread", program.intrinsics.int32),
        new EArrayRef(new EPtr(buffer, 0), 1));
    callFunction(program, "foo", [], [arrayRef, makeInt(program, 65)]);
    if (buffer.get(0) != 65)
        throw new Error("Bad value stored into buffer (expected 65): " + buffer.get(0));
    callFunction(program, "foo", [], [arrayRef, makeInt(program, -111)]);
    if (buffer.get(0) != -111)
        throw new Error("Bad value stored into buffer (expected -111): " + buffer.get(0));
}

tests.deviceArrayStore = function()
{
    let program = doPrep(`
        void foo(device int[] array, int value)
        {
            array[0u] = value;
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 15);
    let arrayRef = TypedValue.box(
        new ArrayRefType(externalOrigin, "device", program.intrinsics.int32),
        new EArrayRef(new EPtr(buffer, 0), 1));
    callFunction(program, "foo", [], [arrayRef, makeInt(program, 65)]);
    if (buffer.get(0) != 65)
        throw new Error("Bad value stored into buffer (expected 65): " + buffer.get(0));
    callFunction(program, "foo", [], [arrayRef, makeInt(program, -111)]);
    if (buffer.get(0) != -111)
        throw new Error("Bad value stored into buffer (expected -111): " + buffer.get(0));
}

tests.deviceArrayStoreIntLiteral = function()
{
    let program = doPrep(`
        void foo(device int[] array, int value)
        {
            array[0] = value;
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 15);
    let arrayRef = TypedValue.box(
        new ArrayRefType(externalOrigin, "device", program.intrinsics.int32),
        new EArrayRef(new EPtr(buffer, 0), 1));
    callFunction(program, "foo", [], [arrayRef, makeInt(program, 65)]);
    if (buffer.get(0) != 65)
        throw new Error("Bad value stored into buffer (expected 65): " + buffer.get(0));
    callFunction(program, "foo", [], [arrayRef, makeInt(program, -111)]);
    if (buffer.get(0) != -111)
        throw new Error("Bad value stored into buffer (expected -111): " + buffer.get(0));
}

tests.simpleProtocol = function()
{
    let program = doPrep(`
        protocol MyAddable {
            MyAddable operator+(MyAddable, MyAddable);
        }
        T add<T:MyAddable>(T a, T b)
        {
            return a + b;
        }
        int foo(int x)
        {
            return add(x, 73);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 45)]), 45 + 73);
}

tests.typeMismatchReturn = function()
{
    checkFail(
        () => doPrep(`
            int foo()
            {
                return 0u;
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.typeMismatchVariableDecl = function()
{
    checkFail(
        () => doPrep(`
            void foo(uint x)
            {
                int y = x;
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.typeMismatchAssignment = function()
{
    checkFail(
        () => doPrep(`
            void foo(uint x)
            {
                int y;
                y = x;
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.typeMismatchReturnParam = function()
{
    checkFail(
        () => doPrep(`
            int foo(uint x)
            {
                return x;
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.badAdd = function()
{
    checkFail(
        () => doPrep(`
            void bar<T>(T) { }
            void foo(int x, uint y)
            {
                bar(x + y);
            }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("native int32 operator+<>(int32,int32)") != -1);
}

tests.lexerKeyword = function()
{
    let result = doLex("ident for while 123 123u { } {asd asd{ 1a3 1.2 + 3.4 + 1. + .2 1.2d 0.d .3d && ||");
    if (result.length != 25)
        throw new Error("Lexer emitted an incorrect number of tokens (expected 23): " + result.length);
    checkLexerToken(result[0],  0,  "identifier",    "ident");
    checkLexerToken(result[1],  6,  "keyword",       "for");
    checkLexerToken(result[2],  10, "keyword",       "while");
    checkLexerToken(result[3],  16, "intLiteral",    "123");
    checkLexerToken(result[4],  20, "uintLiteral",   "123u");
    checkLexerToken(result[5],  25, "punctuation",   "{");
    checkLexerToken(result[6],  27, "punctuation",   "}");
    checkLexerToken(result[7],  29, "punctuation",   "{");
    checkLexerToken(result[8],  30, "identifier",    "asd");
    checkLexerToken(result[9],  34, "identifier",    "asd");
    checkLexerToken(result[10], 37, "punctuation",   "{");
    checkLexerToken(result[11], 39, "intLiteral",    "1");
    checkLexerToken(result[12], 40, "identifier",    "a3");
    checkLexerToken(result[13], 43, "floatLiteral",  "1.2");
    checkLexerToken(result[14], 47, "punctuation",   "+");
    checkLexerToken(result[15], 49, "floatLiteral",  "3.4");
    checkLexerToken(result[16], 53, "punctuation",   "+");
    checkLexerToken(result[17], 55, "floatLiteral",  "1.");
    checkLexerToken(result[18], 58, "punctuation",   "+");
    checkLexerToken(result[19], 60, "floatLiteral",  ".2");
    checkLexerToken(result[20], 63, "floatLiteral",  "1.2d");
    checkLexerToken(result[21], 68, "floatLiteral",  "0.d");
    checkLexerToken(result[22], 72, "floatLiteral",  ".3d");
    checkLexerToken(result[23], 76, "punctuation",   "&&");
    checkLexerToken(result[24], 79, "punctuation",   "||");
}

tests.simpleNoReturn = function()
{
    checkFail(
        () => doPrep("int foo() { }"),
        (e) => e instanceof WTypeError);
}

tests.simpleUnreachableCode = function()
{
    checkFail(
        () => doPrep(`
            void foo()
            {
                return;
                int x;
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.simpleStruct = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
            int y;
        }
        Foo foo(Foo foo)
        {
            Foo result;
            result.x = foo.y;
            result.y = foo.x;
            return result;
        }
    `);
    let structType = program.types.get("Foo");
    if (!structType)
        throw new Error("Did not find Foo type");
    let buffer = new EBuffer(2);
    buffer.set(0, 62);
    buffer.set(1, 24);
    let result = callFunction(program, "foo", [], [new TypedValue(structType, new EPtr(buffer, 0))]);
    if (!result.type.equals(structType))
        throw new Error("Wrong result type: " + result.type);
    let x = result.ePtr!.get(0);
    let y = result.ePtr!.get(1);
    if (x != 24)
        throw new Error("Wrong result for x: " + x + " (y = " + y + ")");
    if (y != 62)
        throw new Error("Wrong result for y: " + y + " (x + " + x + ")");
}

tests.genericStructInstance = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T x;
            T y;
        }
        Foo<int> foo(Foo<int> foo)
        {
            Foo<int> result;
            result.x = foo.y;
            result.y = foo.x;
            return result;
        }
    `);
    let structType = TypeRef.instantiate(readInstance(program.types.get("Foo"), Type), [program.intrinsics.int32]);
    let buffer = new EBuffer(2);
    buffer.set(0, 62);
    buffer.set(1, 24);
    let result = callFunction(program, "foo", [], [new TypedValue(structType, new EPtr(buffer, 0))]);
    let x = result.ePtr!.get(0);
    let y = result.ePtr!.get(1);
    if (x != 24)
        throw new Error("Wrong result for x: " + x + " (y = " + y + ")");
    if (y != 62)
        throw new Error("Wrong result for y: " + y + " (x + " + x + ")");
}

tests.doubleGenericCallsDoubleGeneric = function()
{
    doPrep(`
        void foo<T, U>(T, U) { }
        void bar<V, W>(V x, W y) { foo(x, y); }
    `);
}

tests.doubleGenericCallsSingleGeneric = function()
{
    checkFail(
        () => doPrep(`
            void foo<T>(T, T) { }
            void bar<V, W>(V x, W y) { foo(x, y); }
        `),
        (e) => e instanceof WTypeError);
}

tests.loadNull = function()
{
    checkFail(
        () => doPrep(`
            void sink<T>(T) { }
            void foo() { sink(*null); }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Type passed to dereference is not a pointer: null") != -1);
}

tests.storeNull = function()
{
    checkFail(
        () => doPrep(`
            void foo() { *null = 42; }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Type passed to dereference is not a pointer: null") != -1);
}

tests.returnNull = function()
{
    let program = doPrep(`
        thread int* foo() { return null; }
    `);
    let result = callFunction(program, "foo", [], []);
    if (!result.type.isPtr)
        throw new Error("Return type is not a pointer: " + result.type);
    if (!result.type.elementType!.equals(program.intrinsics.int32))
        throw new Error("Return type is not a pointer to an int: " + result.type);
    if (result.value != null)
        throw new Error("Return value is not null: " + result.value);
}

tests.dereferenceDefaultNull = function()
{
    let program = doPrep(`
        int foo()
        {
            thread int* p;
            return *p;
        }
    `);
    checkFail(
        () => callFunction(program, "foo", [], []),
        (e) => e instanceof WTrapError);
}

tests.defaultInitializedNull = function()
{
    let program = doPrep(`
        int foo()
        {
            thread int* p = null;;
            return *p;
        }
    `);
    checkFail(
        () => callFunction(program, "foo", [], []),
        (e) => e instanceof WTrapError);
}

tests.passNullToPtrMonomorphic = function()
{
    let program = doPrep(`
        int foo(thread int* ptr)
        {
            return *ptr;
        }
        int bar()
        {
            return foo(null);
        }
    `);
    checkFail(
        () => callFunction(program, "bar", [], []),
        (e) => e instanceof WTrapError);
}

tests.passNullToPtrPolymorphic = function()
{
    checkFail(
        () => doPrep(`
            T foo<T>(thread T* ptr)
            {
                return *ptr;
            }
            int bar()
            {
                return foo(null);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.passNullToPolymorphic = function()
{
    checkFail(
        () => doPrep(`
            T foo<T>(T ptr)
            {
                return ptr;
            }
            int bar()
            {
                return foo(null);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.loadNullArrayRef = function()
{
    checkFail(
        () => doPrep(`
            void sink<T>(T) { }
            void foo() { sink(null[0u]); }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Cannot resolve access") != -1);
}

tests.storeNullArrayRef = function()
{
    checkFail(
        () => doPrep(`
            void foo() { null[0u] = 42; }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Cannot resolve access") != -1);
}

tests.returnNullArrayRef = function()
{
    let program = doPrep(`
        thread int[] foo() { return null; }
    `);
    let result = callFunction(program, "foo", [], []);
    if (!result.type.isArrayRef)
        throw new Error("Return type is not an array reference: " + result.type);
    if (!result.type.elementType!.equals(program.intrinsics.int32))
        throw new Error("Return type is not an int array reference: " + result.type);
    if (result.value != null)
        throw new Error("Return value is not null: " + result.value);
}

tests.dereferenceDefaultNullArrayRef = function()
{
    let program = doPrep(`
        int foo()
        {
            thread int[] p;
            return p[0u];
        }
    `);
    checkFail(
        () => callFunction(program, "foo", [], []),
        (e) => e instanceof WTrapError);
}

tests.defaultInitializedNullArrayRef = function()
{
    let program = doPrep(`
        int foo()
        {
            thread int[] p = null;
            return p[0u];
        }
    `);
    checkFail(
        () => callFunction(program, "foo", [], []),
        (e) => e instanceof WTrapError);
}

tests.defaultInitializedNullArrayRefIntLiteral = function()
{
    let program = doPrep(`
        int foo()
        {
            thread int[] p = null;
            return p[0];
        }
    `);
    checkFail(
        () => callFunction(program, "foo", [], []),
        (e) => e instanceof WTrapError);
}

tests.passNullToPtrMonomorphicArrayRef = function()
{
    let program = doPrep(`
        int foo(thread int[] ptr)
        {
            return ptr[0u];
        }
        int bar()
        {
            return foo(null);
        }
    `);
    checkFail(
        () => callFunction(program, "bar", [], []),
        (e) => e instanceof WTrapError);
}

tests.passNullToPtrPolymorphicArrayRef = function()
{
    checkFail(
        () => doPrep(`
            T foo<T>(thread T[] ptr)
            {
                return ptr[0u];
            }
            int bar()
            {
                return foo(null);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.returnIntLiteralUint = function()
{
    let program = doPrep("uint foo() { return 42; }");
    checkNumber(program, callFunction(program, "foo", [], []), 42);
}

tests.returnIntLiteralDouble = function()
{
    let program = doPrep("double foo() { return 42; }");
    checkNumber(program, callFunction(program, "foo", [], []), 42);
}

tests.badIntLiteralForInt = function()
{
    checkFail(
        () => doPrep("void foo() { int x = 3000000000; }"),
        (e) => e instanceof WSyntaxError);
}

tests.badIntLiteralForUint = function()
{
    checkFail(
        () => doPrep("void foo() { uint x = 5000000000; }"),
        (e) => e instanceof WSyntaxError);
}

tests.badIntLiteralForDouble = function()
{
    checkFail(
        () => doPrep("void foo() { double x = 5000000000000000000000000000000000000; }"),
        (e) => e instanceof WSyntaxError);
}

tests.passNullAndNotNull = function()
{
    let program = doPrep(`
        T bar<T>(device T* p, device T*)
        {
            return *p;
        }
        int foo(device int* p)
        {
            return bar(p, null);
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 13);
    checkInt(program, callFunction(program, "foo", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 13);
}

tests.passNullAndNotNullFullPoly = function()
{
    let program = doPrep(`
        T bar<T>(T p, T)
        {
            return p;
        }
        int foo(device int* p)
        {
            return *bar(p, null);
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 13);
    checkInt(program, callFunction(program, "foo", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 13);
}

tests.passNullAndNotNullFullPolyReverse = function()
{
    let program = doPrep(`
        T bar<T>(T, T p)
        {
            return p;
        }
        int foo(device int* p)
        {
            return *bar(null, p);
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 13);
    checkInt(program, callFunction(program, "foo", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 13);
}

tests.nullTypeVariableUnify = function()
{
    let left = new NullType(externalOrigin);
    let right = new TypeVariable(externalOrigin, "T", null);
    if (left.equals(right))
        throw new Error("Should not be equal but are: " + left + " and " + right);
    if (right.equals(left))
        throw new Error("Should not be equal but are: " + left + " and " + right);
    
    function everyOrder<T>(array: T[], callback: (order:T[])=>void)
    {
        function recurse(array: T[], callback: (order:T[])=>void, order:T[])
        {
            if (!array.length)
                return callback.call(null, order);
            
            for (let i = 0; i < array.length; ++i) {
                let nextArray = array.concat();
                nextArray.splice(i, 1);
                recurse(nextArray, callback, order.concat([array[i]]));
            }
        }
        
        recurse(array, callback, []);
    }
    
    function everyPair<T>(things:T[])
    {
        let result = [];
        for (let i = 0; i < things.length; ++i) {
            for (let j = 0; j < things.length; ++j) {
                if (i != j)
                    result.push([things[i], things[j]]);
            }
        }
        return result;
    }
    
    everyOrder(
        everyPair(["nullType", "variableType", "ptrType"]),
		(order) => {
            let types: Record<string, Type> = {};
            types.nullType = new NullType(externalOrigin);
            types.variableType = new TypeVariable(externalOrigin, "T", null);
            types.ptrType = new PtrType(externalOrigin, "constant", new NativeType(externalOrigin, "foo_t", []));
            let unificationContext = new UnificationContext([types.variableType]);
            for (let [leftName, rightName] of order) {
                let left = types[leftName];
                let right = types[rightName];
                let result = left.unify(unificationContext, right);
                if (!result)
                    throw new Error("In order " + order + " cannot unify " + left + " with " + right);
            }
            if (!unificationContext.verify().result)
                throw new Error("In order " + order.map((value) => "(" + value + ")") + " cannot verify");
        });
}

tests.doubleNot = function()
{
    let program = doPrep(`
        bool foo(bool x)
        {
            return !!x;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false)]), false);
}

tests.simpleRecursion = function()
{
    checkFail(
        () => doPrep(`
            void foo<T>(T x)
            {
                foo(&x);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.protocolMonoSigPolyDef = function()
{
    let program = doPrep(`
        struct IntAnd<T> {
            int first;
            T second;
        }
        IntAnd<T> intAnd<T>(int first, T second)
        {
            IntAnd<T> result;
            result.first = first;
            result.second = second;
            return result;
        }
        protocol IntAndable {
            IntAnd<int> intAnd(IntAndable, int);
        }
        int foo<T:IntAndable>(T first, int second)
        {
            IntAnd<int> result = intAnd(first, second);
            return result.first + result.second;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 54), makeInt(program, 12)]), 54 + 12);
}

tests.protocolPolySigPolyDef = function()
{
    let program = doPrep(`
        struct IntAnd<T> {
            int first;
            T second;
        }
        IntAnd<T> intAnd<T>(int first, T second)
        {
            IntAnd<T> result;
            result.first = first;
            result.second = second;
            return result;
        }
        protocol IntAndable {
            IntAnd<T> intAnd<T>(IntAndable, T);
        }
        int foo<T:IntAndable>(T first, int second)
        {
            IntAnd<int> result = intAnd(first, second);
            return result.first + result.second;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 54), makeInt(program, 12)]), 54 + 12);
}

tests.protocolDoublePolySigDoublePolyDef = function()
{
    let program = doPrep(`
        struct IntAnd<T, U> {
            int first;
            T second;
            U third;
        }
        IntAnd<T, U> intAnd<T, U>(int first, T second, U third)
        {
            IntAnd<T, U> result;
            result.first = first;
            result.second = second;
            result.third = third;
            return result;
        }
        protocol IntAndable {
            IntAnd<T, U> intAnd<T, U>(IntAndable, T, U);
        }
        int foo<T:IntAndable>(T first, int second, int third)
        {
            IntAnd<int, int> result = intAnd(first, second, third);
            return result.first + result.second + result.third;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 54), makeInt(program, 12), makeInt(program, 39)]), 54 + 12 + 39);
}

tests.protocolDoublePolySigDoublePolyDefExplicit = function()
{
    let program = doPrep(`
        struct IntAnd<T, U> {
            int first;
            T second;
            U third;
        }
        IntAnd<T, U> intAnd<T, U>(int first, T second, U third)
        {
            IntAnd<T, U> result;
            result.first = first;
            result.second = second;
            result.third = third;
            return result;
        }
        protocol IntAndable {
            IntAnd<T, U> intAnd<T, U>(IntAndable, T, U);
        }
        int foo<T:IntAndable>(T first, int second, int third)
        {
            IntAnd<int, int> result = intAnd<int, int>(first, second, third);
            return result.first + result.second + result.third;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 54), makeInt(program, 12), makeInt(program, 39)]), 54 + 12 + 39);
}

tests.variableShadowing = function()
{
    let program = doPrep(`
        int foo()
        {
            int y;
            int x = 7;
            {
                int x = 8;
                y = x;
            }
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 8);
    program = doPrep(`
        int foo()
        {
            int y;
            int x = 7;
            {
                int x = 8;
            }
            y = x;
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 7);
}

tests.ifStatement = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7) {
                y = 8;
            }
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 8)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 6);
}

tests.ifElseStatement = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7) {
                y = 8;
            } else {
                y = 9;
            }
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 8)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 9);
}

tests.ifElseIfStatement = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7) {
                y = 8;
            } else if (x == 8) {
                y = 9;
            }
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 8)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 6);
}

tests.ifElseIfElseStatement = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7) {
                y = 8;
            } else if (x == 8) {
                y = 9;
            } else {
                y = 10;
            }
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 8)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 10);
}

tests.returnIf = function()
{
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                int y = 6;
                if (x == 7) {
                    return y;
                }
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                int y = 6;
                if (x == 7) {
                    return y;
                } else {
                    y = 8;
                }
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                int y = 6;
                if (x == 7) {
                    y = 8;
                } else {
                    return y;
                }
            }
        `),
        (e) => e instanceof WTypeError);
    let program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7) {
                return 8;
            } else {
                return 10;
            }
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 8)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 10);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                int y = 6;
                if (x == 7) {
                    return 8;
                } else if (x == 9) {
                    return 10;
                }
            }
        `),
        (e) => e instanceof WTypeError);
    program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7) {
                return 8;
            } else {
                y = 9;
            }
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 8)]), 9);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 9);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                int y = 6;
                if (x == 7) {
                    return 8;
                } else {
                    return 10;
                }
                return 11;
            }
        `),
        (e) => e instanceof WTypeError);
    program = doPrep(`
        int foo(int x)
        {
            int y = 6;
            if (x == 7)
                int y = 8;
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 6);
}

tests.simpleWhile = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            while (x < 13)
                x = x * 2;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 16);
}

tests.protocolMonoPolySigDoublePolyDefExplicit = function()
{
    checkFail(
        () => {
            let program = doPrep(`
                struct IntAnd<T, U> {
                    int first;
                    T second;
                    U third;
                }
                IntAnd<T, U> intAnd<T, U>(int first, T second, U third)
                {
                    IntAnd<T, U> result;
                    result.first = first;
                    result.second = second;
                    result.third = third;
                    return result;
                }
                protocol IntAndable {
                    IntAnd<T, int> intAnd<T>(IntAndable, T, int);
                }
                int foo<T:IntAndable>(T first, int second, int third)
                {
                    IntAnd<int, int> result = intAnd<int>(first, second, third);
                    return result.first + result.second + result.third;
                }
            `);
            callFunction(program, "foo", [], [makeInt(program, 54), makeInt(program, 12), makeInt(program, 39)]);
        },
        (e) => e instanceof WTypeError);
}

tests.ambiguousOverloadSimple = function()
{
    checkFail(
        () => doPrep(`
            void foo<T>(int, T) { }
            void foo<T>(T, int) { }
            void bar(int a, int b) { foo(a, b); }
        `),
        (e) => e instanceof WTypeError);
}

tests.ambiguousOverloadOverlapping = function()
{
    checkFail(
        () => doPrep(`
            void foo<T>(int, T) { }
            void foo<T>(T, T) { }
            void bar(int a, int b) { foo(a, b); }
        `),
        (e) => e instanceof WTypeError);
}

tests.ambiguousOverloadTieBreak = function()
{
    doPrep(`
        void foo<T>(int, T) { }
        void foo<T>(T, T) { }
        void foo(int, int) { }
        void bar(int a, int b) { foo(a, b); }
    `);
}

tests.intOverloadResolution = function()
{
    let program = doPrep(`
        int foo(int) { return 1; }
        int foo(uint) { return 2; }
        int foo(double) { return 3; }
        int bar() { return foo(42); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 1);
}

tests.intOverloadResolutionReverseOrder = function()
{
    let program = doPrep(`
        int foo(double) { return 3; }
        int foo(uint) { return 2; }
        int foo(int) { return 1; }
        int bar() { return foo(42); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 1);
}

tests.intOverloadResolutionGeneric = function()
{
    let program = doPrep(`
        int foo(int) { return 1; }
        int foo<T>(T) { return 2; }
        int bar() { return foo(42); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 1);
}

tests.intLiteralGeneric = function()
{
    let program = doPrep(`
        int foo<T>(T x) { return 3478; }
        int bar() { return foo(42); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 3478);
}

tests.intLiteralGenericWithProtocols = function()
{
    let program = doPrep(`
        protocol MyConvertibleToInt {
            operator int(MyConvertibleToInt);
        }
        int foo<T:MyConvertibleToInt>(T x) { return int(x); }
        int bar() { return foo(42); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 42);
}

tests.uintLiteralGeneric = function()
{
    let program = doPrep(`
        int foo<T>(T x) { return 3478; }
        int bar() { return foo(42u); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 3478);
}

tests.uintLiteralGenericWithProtocols = function()
{
    let program = doPrep(`
        protocol MyConvertibleToUint {
            operator uint(MyConvertibleToUint);
        }
        uint foo<T:MyConvertibleToUint>(T x) { return uint(x); }
        uint bar() { return foo(42u); }
    `);
    checkUint(program, callFunction(program, "bar", [], []), 42);
}

tests.intLiteralGenericSpecific = function()
{
    let program = doPrep(`
        T foo<T>(T x) { return x; }
        int bar() { return foo(int(42)); }
    `);
    checkInt(program, callFunction(program, "bar", [], []), 42);
}

tests.simpleConstexpr = function()
{
    let program = doPrep(`
        int foo<int a>(int b)
        {
            return a + b;
        }
        int bar(int b)
        {
            return foo<42>(b);
        }
    `);
    checkInt(program, callFunction(program, "bar", [], [makeInt(program, 58)]), 58 + 42);
}

tests.break = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            while (true) {
                x = x * 2;
                if (x >= 7)
                    break;
            }
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 10)]), 20);
    program = doPrep(`
        int foo(int x)
        {
            while (true) {
                while (true) {
                    x = x * 2;
                    if (x >= 7)
                        break;
                }
                x = x - 1;
                break;
            }
            return x;
            
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 10)]), 19);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                while (true) {
                    {
                        break;
                    }
                    x = x + 1;
                }
                return x;
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                break;
                return x;
            }
        `),
        (e) => e instanceof WTypeError);
    program = doPrep(`
            int foo(int x)
            {
                while (true) {
                    if (x == 7) {
                        break;
                    }
                    x = x + 1;
                }
                return x;
            }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 7);
    program = doPrep(`
            int foo(int x)
            {
                while (true) {
                    break;
                }
                return x;
            }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 1);
    program = doPrep(`
            int foo()
            {
                while (true) {
                    return 7;
                }
            }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 7);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                while(true) {
                    break;
                    return 7;
                }
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.continue = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            while (x < 10) {
                if (x == 8) {
                    x = x + 1;
                    continue;
                }
                x = x * 2;
            }
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 18);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                continue;
                return x;
                
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.doWhile = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int y = 7;
            do {
                y = 8;
                break;
            } while (x < 10);
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 8);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 11)]), 8);
    program = doPrep(`
        int foo(int x)
        {
            int y = 7;
            do {
                y = 8;
                break;
            } while (y == 7);
            return y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), 8);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            do {
                if (x == 11) {
                    x = 15;
                    continue;
                }
                sum = sum + x;
                x = x + 1;
            } while (x < 13);
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 9)]), 19);
}

tests.forLoop = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            int i;
            for (i = 0; i < x; i = i + 1) {
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            for (int i = 0; i < x; i = i + 1) {
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            int i = 100;
            for (int i = 0; i < x; i = i + 1) {
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            for (int i = 0; i < x; i = i + 1) {
                if (i == 4)
                    continue;
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 11);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            for (int i = 0; i < x; i = i + 1) {
                if (i == 5)
                    break;
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 10);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            for (int i = 0; ; i = i + 1) {
                if (i >= x)
                    break;
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 15);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 21);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            int i = 0;
            for ( ; ; i = i + 1) {
                if (i >= x)
                    break;
                sum = sum + i;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 15);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 21);
    program = doPrep(`
        int foo(int x)
        {
            int sum = 0;
            int i = 0;
            for ( ; ; ) {
                if (i >= x)
                    break;
                sum = sum + i;
                i = i + 1;
            }
            return sum;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 3);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 10);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 15);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 21);
    checkFail(
        () => doPrep(`
            void foo(int x)
            {
                for (int i = 0; ; i = i + 1) {
                    break;
                    x = i;
                }
            }
        `),
        (e) => e instanceof WTypeError);
    program = doPrep(`
        int foo(int x)
        {
            for ( ; ; ) {
                return 7;
            }
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 7);
    checkFail(
        () => doPrep(`
            int foo(int x)
            {
                for ( ; x < 10; ) {
                    return 7;
                }
            }
        `),
        (e) => e instanceof WTypeError);
    program = doPrep(`
        int foo(int x)
        {
            for ( ; true; ) {
                return 7;
            }
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 3)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 4)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 5)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 6)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 7)]), 7);
}

tests.chainConstexpr = function()
{
    let program = doPrep(`
        int foo<int a>(int b)
        {
            return a + b;
        }
        int bar<int a>(int b)
        {
            return foo<a>(b);
        }
        int baz(int b)
        {
            return bar<42>(b);
        }
    `);
    checkInt(program, callFunction(program, "baz", [], [makeInt(program, 58)]), 58 + 42);
}

tests.chainGeneric = function()
{
    let program = doPrep(`
        T foo<T>(T x)
        {
            return x;
        }
        T bar<T>(thread T* ptr)
        {
            return *foo(ptr);
        }
        int baz(int x)
        {
            return bar(&x);
        }
    `);
    checkInt(program, callFunction(program, "baz", [], [makeInt(program, 37)]), 37);
}

tests.chainStruct = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T f;
        }
        struct Bar<T> {
            Foo<thread T*> f;
        }
        int foo(thread Bar<int>* x)
        {
            return *x->f.f;
        }
        int bar(int a)
        {
            Bar<int> x;
            x.f.f = &a;
            return foo(&x);
        }
    `);
    checkInt(program, callFunction(program, "bar", [], [makeInt(program, 4657)]), 4657);
}

tests.chainStructNewlyValid = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T f;
        }
        struct Bar<T> {
            Foo<device T*> f;
        }
        int foo(thread Bar<int>* x)
        {
            return *x->f.f;
        }
        int bar(device int* a)
        {
            Bar<int> x;
            x.f.f = a;
            return foo(&x);
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 78453);
    checkInt(program, callFunction(program, "bar", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 78453);
}

tests.chainStructDevice = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T f;
        }
        struct Bar<T> {
            Foo<device T*> f;
        }
        int foo(thread Bar<int>* x)
        {
            return *x->f.f;
        }
        int bar(device int* a)
        {
            Bar<int> x;
            x.f.f = a;
            return foo(&x);
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 79201);
    checkInt(program, callFunction(program, "bar", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 79201);
}

tests.paramChainStructDevice = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T f;
        }
        struct Bar<T> {
            Foo<T> f;
        }
        int foo(thread Bar<device int*>* x)
        {
            return *x->f.f;
        }
        int bar(device int* a)
        {
            Bar<device int*> x;
            x.f.f = a;
            return foo(&x);
        }
    `);
    let buffer = new EBuffer(1);
    buffer.set(0, 79201);
    checkInt(program, callFunction(program, "bar", [], [TypedValue.box(new PtrType(externalOrigin, "device", program.intrinsics.int32), new EPtr(buffer, 0))]), 79201);
}

tests.simpleProtocolExtends = function()
{
    let program = doPrep(`
        protocol Foo {
            void foo(thread Foo*);
        }
        protocol Bar : Foo {
            void bar(thread Bar*);
        }
        void fuzz<T:Foo>(thread T* p)
        {
            foo(p);
        }
        void buzz<T:Bar>(thread T* p)
        {
            fuzz(p);
            bar(p);
        }
        void foo(thread int* p)
        {
            *p = *p + 743;
        }
        void bar(thread int* p)
        {
            *p = *p + 91;
        }
        int thingy(int a)
        {
            buzz(&a);
            return a;
        }
    `);
    checkInt(program, callFunction(program, "thingy", [], [makeInt(program, 642)]), 642 + 743 + 91);
}

tests.protocolExtendsTwo = function()
{
    let program = doPrep(`
        protocol Foo {
            void foo(thread Foo*);
        }
        protocol Bar {
            void bar(thread Bar*);
        }
        protocol Baz : Foo, Bar {
            void baz(thread Baz*);
        }
        void fuzz<T:Foo>(thread T* p)
        {
            foo(p);
        }
        void buzz<T:Bar>(thread T* p)
        {
            bar(p);
        }
        void xuzz<T:Baz>(thread T* p)
        {
            fuzz(p);
            buzz(p);
            baz(p);
        }
        void foo(thread int* p)
        {
            *p = *p + 743;
        }
        void bar(thread int* p)
        {
            *p = *p + 91;
        }
        void baz(thread int* p)
        {
            *p = *p + 39;
        }
        int thingy(int a)
        {
            xuzz(&a);
            return a;
        }
    `);
    checkInt(program, callFunction(program, "thingy", [], [makeInt(program, 642)]), 642 + 743 + 91 + 39);
}

tests.prefixPlusPlus = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            ++x;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 65);
}

tests.prefixPlusPlusResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return ++x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 65);
}

tests.postfixPlusPlus = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            x++;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 65);
}

tests.postfixPlusPlusResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return x++;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 64);
}

tests.prefixMinusMinus = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            --x;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 63);
}

tests.prefixMinusMinusResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return --x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 63);
}

tests.postfixMinusMinus = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            x--;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 63);
}

tests.postfixMinusMinusResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return x--;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 64)]), 64);
}

tests.plusEquals = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            x += 42;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), 385 + 42);
}

tests.plusEqualsResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return x += 42;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), 385 + 42);
}

tests.minusEquals = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            x -= 42;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), 385 - 42);
}

tests.minusEqualsResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return x -= 42;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), 385 - 42);
}

tests.timesEquals = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            x *= 42;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), 385 * 42);
}

tests.timesEqualsResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return x *= 42;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), 385 * 42);
}

tests.divideEquals = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            x /= 42;
            return x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), (385 / 42) | 0);
}

tests.divideEqualsResult = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            return x /= 42;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 385)]), (385 / 42) | 0);
}

tests.twoIntLiterals = function()
{
    let program = doPrep(`
        bool foo()
        {
            return 42 == 42;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], []), true);
}

tests.unifyDifferentLiterals = function()
{
    checkFail(
        () => doPrep(`
            void bar<T>(T, T)
            {
            }
            void foo()
            {
                bar(42, 42u);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.unifyDifferentLiteralsBackwards = function()
{
    checkFail(
        () => doPrep(`
            void bar<T>(T, T)
            {
            }
            void foo()
            {
                bar(42u, 42);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.unifyVeryDifferentLiterals = function()
{
    checkFail(
        () => doPrep(`
            void bar<T>(T, T)
            {
            }
            void foo()
            {
                bar(42, null);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.unifyVeryDifferentLiteralsBackwards = function()
{
    checkFail(
        () => doPrep(`
            void bar<T>(T, T)
            {
            }
            void foo()
            {
                bar(null, 42);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.assignUintToInt = function()
{
    checkFail(
        () => doPrep(`
            void foo()
            {
                int x = 42u;
            }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Type mismatch in variable initialization") != -1);
}

tests.buildArrayThenSumIt = function()
{
    let program = doPrep(`
        int foo()
        {
            int[42] array;
            for (uint i = 0; i < 42; i = i + 1)
                array[i] = int(i + 5);
            int result;
            for (uint i = 0; i < 42; i = i + 1)
                result = result + array[i];
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 42 * 5 + 42 * 41 / 2);
}

tests.buildArrayThenSumItUsingArrayReference = function()
{
    let program = doPrep(`
        int bar(thread int[] array)
        {
            for (uint i = 0; i < 42; i = i + 1)
                array[i] = int(i + 5);
            int result;
            for (uint i = 0; i < 42; i = i + 1)
                result = result + array[i];
            return result;
        }
        int foo()
        {
            int[42] array;
            return bar(@array);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 42 * 5 + 42 * 41 / 2);
}

tests.overrideSubscriptStruct = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
            int y;
        }
        thread int* operator&[](thread Foo* foo, uint index)
        {
            if (index == 0)
                return &foo->x;
            if (index == 1)
                return &foo->y;
            return null;
        }
        int foo()
        {
            Foo foo;
            foo.x = 498;
            foo.y = 19;
            return foo[0] + foo[1] * 3;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 498 + 19 * 3);
}

tests.overrideSubscriptStructAndDoStores = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
            int y;
        }
        thread int* operator&[](thread Foo* foo, uint index)
        {
            if (index == 0)
                return &foo->x;
            if (index == 1)
                return &foo->y;
            return null;
        }
        int foo()
        {
            Foo foo;
            foo[0] = 498;
            foo[1] = 19;
            return foo.x + foo.y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 498 + 19);
}

tests.overrideSubscriptStructAndUsePointers = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
            int y;
        }
        thread int* operator&[](thread Foo* foo, uint index)
        {
            if (index == 0)
                return &foo->x;
            if (index == 1)
                return &foo->y;
            return null;
        }
        int bar(thread Foo* foo)
        {
            return (*foo)[0] + (*foo)[1];
        }
        int foo()
        {
            Foo foo;
            foo.x = 498;
            foo.y = 19;
            return bar(&foo);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 498 + 19);
}

tests.overrideSubscriptStructAndUsePointersIncorrectly = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
                int y;
            }
            thread int* operator&[](thread Foo* foo, uint index)
            {
                if (index == 0)
                    return &foo->x;
                if (index == 1)
                    return &foo->y;
                return null;
            }
            int bar(thread Foo* foo)
            {
                return foo[0] + foo[1];
            }
            int foo()
            {
                Foo foo;
                foo.x = 498;
                foo.y = 19;
                return bar(&foo);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.makeArrayRefFromLocal = function()
{
    let program = doPrep(`
        int bar(thread int[] ref)
        {
            return ref[0];
        }
        int foo()
        {
            int x = 48;
            return bar(@x);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 48);
}

tests.makeArrayRefFromPointer = function()
{
    let program = doPrep(`
        int bar(thread int[] ref)
        {
            return ref[0];
        }
        int baz(thread int* ptr)
        {
            return bar(@ptr);
        }
        int foo()
        {
            int x = 48;
            return baz(&x);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 48);
}

tests.makeArrayRefFromArrayRef = function()
{
    checkFail(
        () => doPrep(`
            int bar(thread int[] ref)
            {
                return ref[0];
            }
            int baz(thread int[] ptr)
            {
                return bar(@ptr);
            }
            int foo()
            {
                int x = 48;
                return baz(@x);
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.simpleLength = function()
{
    let program = doPrep(`
        uint foo()
        {
            double[754] array;
            return (@array).length;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], []), 754);
}

tests.nonArrayRefArrayLengthSucceed = function()
{
    let program = doPrep(`
        uint foo()
        {
            double[754] array;
            return array.length;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], []), 754);
}

tests.nonArrayRefArrayLengthFail = function()
{
    checkFail(
        () => doPrep(`
            thread uint* lengthPtr()
            {
                int[42] array;
                return &(array.length);
            }
        `),
        e => e instanceof WTypeError);
}

tests.constexprIsNotLValuePtr = function()
{
    checkFail(
        () => doPrep(`
            thread int* foo<int x>()
            {
                return &x;
            }
        `),
        e => e instanceof WTypeError);
}

tests.constexprIsNotLValueAssign = function()
{
    checkFail(
        () => doPrep(`
            void foo<int x>()
            {
                x = 42;
            }
        `),
        e => e instanceof WTypeError);
}

tests.constexprIsNotLValueRMW = function()
{
    checkFail(
        () => doPrep(`
            void foo<int x>()
            {
                x += 42;
            }
        `),
        e => e instanceof WTypeError);
}

tests.assignLength = function()
{
    checkFail(
        () => doPrep(`
            void foo()
            {
                double[754] array;
                (@array).length = 42;
            }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Have neither ander nor setter") != -1);
}

tests.assignLengthHelper = function()
{
    checkFail(
        () => doPrep(`
            void bar(thread double[] array)
            {
                array.length = 42;
            }
            void foo()
            {
                double[754] array;
                bar(@array);
            }
        `),
        (e) => e instanceof WTypeError && e.message.indexOf("Have neither ander nor setter") != -1);
}

tests.simpleGetter = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        int operator.y(Foo foo)
        {
            return foo.x;
        }
        int foo()
        {
            Foo foo;
            foo.x = 7804;
            return foo.y;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 7804);
}

tests.simpleSetter = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        int operator.y(Foo foo)
        {
            return foo.x;
        }
        Foo operator.y=(Foo foo, int value)
        {
            foo.x = value;
            return foo;
        }
        int foo()
        {
            Foo foo;
            foo.y = 7804;
            return foo.x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 7804);
}

tests.genericAccessors = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T x;
            T[3] y;
        }
        struct Bar<T> {
            T x;
            T y;
        }
        Bar<T> operator.z<T>(Foo<T> foo)
        {
            Bar<T> result;
            result.x = foo.x;
            result.y = foo.y[1];
            return result;
        }
        Foo<T> operator.z=<T>(Foo<T> foo, Bar<T> bar)
        {
            foo.x = bar.x;
            foo.y[1] = bar.y;
            return foo;
        }
        T operator.sum<T:Addable>(Foo<T> foo)
        {
            return foo.x + foo.y[0] + foo.y[1] + foo.y[2];
        }
        T operator.sum<T:Addable>(Bar<T> bar)
        {
            return bar.x + bar.y;
        }
        operator<T> Bar<T>(T x, T y)
        {
            Bar<T> result;
            result.x = x;
            result.y = y;
            return result;
        }
        void setup(thread Foo<int>* foo)
        {
            foo->x = 1;
            foo->y[0] = 2;
            foo->y[1] = 3;
            foo->y[2] = 4;
        }
        int testSuperBasic()
        {
            Foo<int> foo;
            setup(&foo);
            return foo.sum;
        }
        int testZSetterDidSetY()
        {
            Foo<int> foo;
            foo.z = Bar<int>(53, 932);
            return foo.y[1];
        }
        int testZSetter()
        {
            Foo<int> foo;
            foo.z = Bar<int>(53, 932);
            return foo.sum;
        }
        int testZGetter()
        {
            Foo<int> foo;
            // This deliberately does not call setup() just so we test this syntax.
            foo.x = 1;
            foo.y[0] = 2;
            foo.y[1] = 3;
            foo.y[2] = 4;
            return foo.z.sum;
        }
        int testLValueEmulation()
        {
            Foo<int> foo;
            setup(&foo);
            foo.z.y *= 5;
            return foo.sum;
        }
    `);
    checkInt(program, callFunction(program, "testSuperBasic", [], []), 1 + 2 + 3 + 4);
    checkInt(program, callFunction(program, "testZSetterDidSetY", [], []), 932);
    checkInt(program, callFunction(program, "testZSetter", [], []), 53 + 932);
    checkInt(program, callFunction(program, "testZGetter", [], []), 1 + 3);
    checkInt(program, callFunction(program, "testLValueEmulation", [], []), 1 + 2 + 3 * 5 + 4);
}

tests.bitSubscriptAccessor = function()
{
    let program = doPrep(`
        protocol MyBitmaskable : Equatable {
            MyBitmaskable operator&(MyBitmaskable, MyBitmaskable);
            MyBitmaskable operator|(MyBitmaskable, MyBitmaskable);
            MyBitmaskable operator~(MyBitmaskable);
            MyBitmaskable operator<<(MyBitmaskable, uint);
            MyBitmaskable operator>>(MyBitmaskable, uint);
            operator MyBitmaskable(int);
        }
        T maskForBitIndex<T:MyBitmaskable>(uint index)
        {
            return T(1) << index;
        }
        bool operator[]<T:MyBitmaskable>(T value, uint index)
        {
            return bool(value & maskForBitIndex<T>(index));
        }
        T operator[]=<T:MyBitmaskable>(T value, uint index, bool bit)
        {
            T mask = maskForBitIndex<T>(index);
            if (bit)
                value |= mask;
            else
                value &= ~mask;
            return value;
        }
        uint operator.length(int)
        {
            return 32;
        }
        uint operator.length(uint)
        {
            return 32;
        }
        int testIntSetBit3()
        {
            int foo;
            foo[3] = true;
            return foo;
        }
        bool testIntSetGetBit5()
        {
            int foo;
            foo[5] = true;
            return foo[5];
        }
        bool testIntGetBit1()
        {
            int foo;
            return foo[1];
        }
        int testUintSumBits()
        {
            int foo = 42;
            int result;
            for (uint i = 0; i < foo.length; ++i) {
                if (foo[i])
                    result++;
            }
            return result;
        }
        int testUintSwapBits()
        {
            int foo = 42;
            for (uint i = 0; i < foo.length / 2; ++i) {
                bool tmp = foo[i];
                foo[i] = foo[foo.length - i - 1];
                foo[foo.length - i - 1] = tmp;
            }
            return foo;
        }
        struct Foo {
            uint f;
            uint g;
        }
        operator Foo(uint f, uint g)
        {
            Foo result;
            result.f = f;
            result.g = g;
            return result;
        }
        int operator.h(Foo foo)
        {
            return int((foo.f & 0xffff) | ((foo.g & 0xffff) << 16));
        }
        Foo operator.h=(Foo foo, int value)
        {
            foo.f &= ~0xffffu;
            foo.f |= uint(value) & 0xffff;
            foo.g &= ~0xffffu;
            foo.g |= (uint(value) >> 16) & 0xffff;
            return foo;
        }
        int testLValueEmulation()
        {
            Foo foo;
            foo.f = 42;
            foo.g = 37;
            for (uint i = 0; i < foo.h.length; ++i)
                foo.h[i] ^= true;
            return int(foo.f + foo.g);
        }
        struct Bar {
            Foo a;
            Foo b;
        }
        Foo operator.c(Bar bar)
        {
            return Foo(uint(bar.a.h), uint(bar.b.h));
        }
        Bar operator.c=(Bar bar, Foo foo)
        {
            bar.a.h = int(foo.f);
            bar.b.h = int(foo.g);
            return bar;
        }
        int testCrazyLValueEmulation()
        {
            Bar bar;
            bar.a.f = 1;
            bar.a.g = 2;
            bar.b.f = 3;
            bar.b.g = 4;
            for (uint i = 0; i < bar.c.h.length; i += 2)
                bar.c.h[i] ^= true;
            return int(bar.a.f + bar.a.g + bar.b.f + bar.b.g);
        }
    `);
    checkInt(program, callFunction(program, "testIntSetBit3", [], []), 8);
    checkBool(program, callFunction(program, "testIntSetGetBit5", [], []), true);
    checkBool(program, callFunction(program, "testIntGetBit1", [], []), false);
    checkInt(program, callFunction(program, "testUintSumBits", [], []), 3);
    checkInt(program, callFunction(program, "testUintSwapBits", [], []), 1409286144);
    checkInt(program, callFunction(program, "testLValueEmulation", [], []), 130991);
    checkInt(program, callFunction(program, "testCrazyLValueEmulation", [], []), 43696);
}

tests.nestedSubscriptLValueEmulationSimple = function()
{
    let program = doPrep(`
        struct Foo {
            int[7] array;
        }
        int operator[](Foo foo, uint index)
        {
            return foo.array[index];
        }
        Foo operator[]=(Foo foo, uint index, int value)
        {
            foo.array[index] = value;
            return foo;
        }
        uint operator.length(Foo foo)
        {
            return foo.array.length;
        }
        int sum(Foo foo)
        {
            int result = 0;
            for (uint i = foo.length; i--;)
                result += foo[i];
            return result;
        }
        struct Bar {
            Foo[6] array;
        }
        uint operator.length(Bar bar)
        {
            return bar.array.length;
        }
        Foo operator[](Bar bar, uint index)
        {
            return bar.array[index];
        }
        Bar operator[]=(Bar bar, uint index, Foo value)
        {
            bar.array[index] = value;
            return bar;
        }
        int sum(Bar bar)
        {
            int result = 0;
            for (uint i = bar.length; i--;)
                result += sum(bar[i]);
            return result;
        }
        struct Baz {
            Bar[5] array;
        }
        Bar operator[](Baz baz, uint index)
        {
            return baz.array[index];
        }
        Baz operator[]=(Baz baz, uint index, Bar value)
        {
            baz.array[index] = value;
            return baz;
        }
        uint operator.length(Baz baz)
        {
            return baz.array.length;
        }
        int sum(Baz baz)
        {
            int result = 0;
            for (uint i = baz.length; i--;)
                result += sum(baz[i]);
            return result;
        }
        void setValues(thread Baz* baz)
        {
            for (uint i = baz->length; i--;) {
                for (uint j = (*baz)[i].length; j--;) {
                    for (uint k = (*baz)[i][j].length; k--;)
                        (*baz)[i][j][k] = int(i + j + k);
                }
            }
        }
        int testSetValuesAndSum()
        {
            Baz baz;
            setValues(&baz);
            return sum(baz);
        }
        int testSetValuesMutateValuesAndSum()
        {
            Baz baz;
            setValues(&baz);
            for (uint i = baz.length; i--;) {
                for (uint j = baz[i].length; j--;) {
                    for (uint k = baz[i][j].length; k--;)
                        baz[i][j][k] *= int(k);
                }
            }
            return sum(baz);
        }
    `);
    checkInt(program, callFunction(program, "testSetValuesAndSum", [], []), 1575);
    checkInt(program, callFunction(program, "testSetValuesMutateValuesAndSum", [], []), 5565);
}

tests.nestedSubscriptLValueEmulationGeneric = function()
{
    let program = doPrep(`
        struct Foo<T> {
            T[7] array;
        }
        T operator[]<T>(Foo<T> foo, uint index)
        {
            return foo.array[index];
        }
        Foo<T> operator[]=<T>(Foo<T> foo, uint index, T value)
        {
            foo.array[index] = value;
            return foo;
        }
        uint operator.length<T>(Foo<T> foo)
        {
            return foo.array.length;
        }
        protocol MyAddable {
            MyAddable operator+(MyAddable, MyAddable);
        }
        T sum<T:MyAddable>(Foo<T> foo)
        {
            T result;
            for (uint i = foo.length; i--;)
                result += foo[i];
            return result;
        }
        struct Bar<T> {
            Foo<T>[6] array;
        }
        uint operator.length<T>(Bar<T> bar)
        {
            return bar.array.length;
        }
        Foo<T> operator[]<T>(Bar<T> bar, uint index)
        {
            return bar.array[index];
        }
        Bar<T> operator[]=<T>(Bar<T> bar, uint index, Foo<T> value)
        {
            bar.array[index] = value;
            return bar;
        }
        T sum<T:MyAddable>(Bar<T> bar)
        {
            T result;
            for (uint i = bar.length; i--;)
                result += sum(bar[i]);
            return result;
        }
        struct Baz<T> {
            Bar<T>[5] array;
        }
        Bar<T> operator[]<T>(Baz<T> baz, uint index)
        {
            return baz.array[index];
        }
        Baz<T> operator[]=<T>(Baz<T> baz, uint index, Bar<T> value)
        {
            baz.array[index] = value;
            return baz;
        }
        uint operator.length<T>(Baz<T> baz)
        {
            return baz.array.length;
        }
        T sum<T:MyAddable>(Baz<T> baz)
        {
            T result;
            for (uint i = baz.length; i--;)
                result += sum(baz[i]);
            return result;
        }
        protocol MyConvertibleFromUint {
            operator MyConvertibleFromUint(uint);
        }
        protocol SetValuable : MyAddable, MyConvertibleFromUint { }
        void setValues<T:SetValuable>(thread Baz<T>* baz)
        {
            for (uint i = baz->length; i--;) {
                for (uint j = (*baz)[i].length; j--;) {
                    for (uint k = (*baz)[i][j].length; k--;)
                        (*baz)[i][j][k] = T(i + j + k);
                }
            }
        }
        int testSetValuesAndSum()
        {
            Baz<int> baz;
            setValues(&baz);
            return sum(baz);
        }
        int testSetValuesMutateValuesAndSum()
        {
            Baz<int> baz;
            setValues(&baz);
            for (uint i = baz.length; i--;) {
                for (uint j = baz[i].length; j--;) {
                    for (uint k = baz[i][j].length; k--;)
                        baz[i][j][k] *= int(k);
                }
            }
            return sum(baz);
        }
    `);
    checkInt(program, callFunction(program, "testSetValuesAndSum", [], []), 1575);
    checkInt(program, callFunction(program, "testSetValuesMutateValuesAndSum", [], []), 5565);
}

tests.boolBitAnd = function()
{
    let program = doPrep(`
        bool foo(bool a, bool b)
        {
            return a & b;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, false)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, false)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, true)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, true)]), true);
}

tests.boolBitOr = function()
{
    let program = doPrep(`
        bool foo(bool a, bool b)
        {
            return a | b;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, false)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, false)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, true)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, true)]), true);
}

tests.boolBitXor = function()
{
    let program = doPrep(`
        bool foo(bool a, bool b)
        {
            return a ^ b;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, false)]), false);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, false)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false), makeBool(program, true)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true), makeBool(program, true)]), false);
}

tests.boolBitNot = function()
{
    let program = doPrep(`
        bool foo(bool a)
        {
            return ~a;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, false)]), true);
    checkBool(program, callFunction(program, "foo", [], [makeBool(program, true)]), false);
}

tests.intBitAnd = function()
{
    let program = doPrep(`
        int foo(int a, int b)
        {
            return a & b;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1), makeInt(program, 7)]), 1);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 65535), makeInt(program, 42)]), 42);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, -1), makeInt(program, -7)]), -7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0), makeInt(program, 85732)]), 0);
}

tests.intBitOr = function()
{
    let program = doPrep(`
        int foo(int a, int b)
        {
            return a | b;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1), makeInt(program, 7)]), 7);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 65535), makeInt(program, 42)]), 65535);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, -1), makeInt(program, -7)]), -1);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0), makeInt(program, 85732)]), 85732);
}

tests.intBitXor = function()
{
    let program = doPrep(`
        int foo(int a, int b)
        {
            return a ^ b;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1), makeInt(program, 7)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 65535), makeInt(program, 42)]), 65493);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, -1), makeInt(program, -7)]), 6);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0), makeInt(program, 85732)]), 85732);
}

tests.intBitNot = function()
{
    let program = doPrep(`
        int foo(int a)
        {
            return ~a;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1)]), -2);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 65535)]), -65536);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, -1)]), 0);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0)]), -1);
}

tests.intLShift = function()
{
    let program = doPrep(`
        int foo(int a, uint b)
        {
            return a << b;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1), makeUint(program, 7)]), 128);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 65535), makeUint(program, 2)]), 262140);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, -1), makeUint(program, 5)]), -32);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0), makeUint(program, 3)]), 0);
}

tests.intRShift = function()
{
    let program = doPrep(`
        int foo(int a, uint b)
        {
            return a >> b;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 1), makeUint(program, 7)]), 0);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 65535), makeUint(program, 2)]), 16383);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, -1), makeUint(program, 5)]), -1);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0), makeUint(program, 3)]), 0);
}

tests.uintBitAnd = function()
{
    let program = doPrep(`
        uint foo(uint a, uint b)
        {
            return a & b;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 1), makeUint(program, 7)]), 1);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 65535), makeUint(program, 42)]), 42);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, -1), makeUint(program, -7)]), 4294967289);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 0), makeUint(program, 85732)]), 0);
}

tests.uintBitOr = function()
{
    let program = doPrep(`
        uint foo(uint a, uint b)
        {
            return a | b;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 1), makeUint(program, 7)]), 7);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 65535), makeUint(program, 42)]), 65535);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, -1), makeUint(program, -7)]), 4294967295);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 0), makeUint(program, 85732)]), 85732);
}

tests.uintBitXor = function()
{
    let program = doPrep(`
        uint foo(uint a, uint b)
        {
            return a ^ b;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 1), makeUint(program, 7)]), 6);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 65535), makeUint(program, 42)]), 65493);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, -1), makeUint(program, -7)]), 6);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 0), makeUint(program, 85732)]), 85732);
}

tests.uintBitNot = function()
{
    let program = doPrep(`
        uint foo(uint a)
        {
            return ~a;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 1)]), 4294967294);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 65535)]), 4294901760);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, -1)]), 0);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 0)]), 4294967295);
}

tests.uintLShift = function()
{
    let program = doPrep(`
        uint foo(uint a, uint b)
        {
            return a << b;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 1), makeUint(program, 7)]), 128);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 65535), makeUint(program, 2)]), 262140);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, -1), makeUint(program, 5)]), 4294967264);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 0), makeUint(program, 3)]), 0);
}

tests.uintRShift = function()
{
    let program = doPrep(`
        uint foo(uint a, uint b)
        {
            return a >> b;
        }
    `);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 1), makeUint(program, 7)]), 0);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 65535), makeUint(program, 2)]), 16383);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, -1), makeUint(program, 5)]), 134217727);
    checkUint(program, callFunction(program, "foo", [], [makeUint(program, 0), makeUint(program, 3)]), 0);
}

tests.uint8BitAnd = function()
{
    let program = doPrep(`
        uint8 foo(uint8 a, uint8 b)
        {
            return a & b;
        }
    `);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 1), makeUint8(program, 7)]), 1);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 65535), makeUint8(program, 42)]), 42);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, -1), makeUint8(program, -7)]), 249);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 0), makeUint8(program, 85732)]), 0);
}

tests.uint8BitOr = function()
{
    let program = doPrep(`
        uint8 foo(uint8 a, uint8 b)
        {
            return a | b;
        }
    `);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 1), makeUint8(program, 7)]), 7);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 65535), makeUint8(program, 42)]), 255);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, -1), makeUint8(program, -7)]), 255);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 0), makeUint8(program, 85732)]), 228);
}

tests.uint8BitXor = function()
{
    let program = doPrep(`
        uint8 foo(uint8 a, uint8 b)
        {
            return a ^ b;
        }
    `);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 1), makeUint8(program, 7)]), 6);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 65535), makeUint8(program, 42)]), 213);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, -1), makeUint8(program, -7)]), 6);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 0), makeUint8(program, 85732)]), 228);
}

tests.uint8BitNot = function()
{
    let program = doPrep(`
        uint8 foo(uint8 a)
        {
            return ~a;
        }
    `);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 1)]), 254);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 65535)]), 0);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, -1)]), 0);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 0)]), 255);
}

tests.uint8LShift = function()
{
    let program = doPrep(`
        uint8 foo(uint8 a, uint b)
        {
            return a << b;
        }
    `);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 1), makeUint(program, 7)]), 128);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 65535), makeUint(program, 2)]), 252);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, -1), makeUint(program, 5)]), 224);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 0), makeUint(program, 3)]), 0);
}

tests.uint8RShift = function()
{
    let program = doPrep(`
        uint8 foo(uint8 a, uint b)
        {
            return a >> b;
        }
    `);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 1), makeUint(program, 7)]), 0);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 65535), makeUint(program, 2)]), 255);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, -1), makeUint(program, 5)]), 255);
    checkUint8(program, callFunction(program, "foo", [], [makeUint8(program, 0), makeUint(program, 3)]), 0);
}

tests.floatMath = function()
{
    let program = doPrep(`
        bool foo()
        {
            return 42.5 == 42.5;
        }
        bool foo2()
        {
            return 42.5f == 42.5;
        }
        bool foo3()
        {
            return 42.5 == 42.5f;
        }
        bool foo4()
        {
            return 42.5f == 42.5f;
        }
        bool foo5()
        {
            return 42.5d == 42.5d;
        }
        float bar(float x)
        {
            return x;
        }
        float foo6()
        {
            return bar(7.5);
        }
        float foo7()
        {
            return bar(7.5f);
        }
        float foo8()
        {
            return bar(7.5d);
        }
        float foo9()
        {
            return float(7.5);
        }
        float foo10()
        {
            return float(7.5f);
        }
        float foo11()
        {
            return float(7.5d);
        }
        float foo12()
        {
            return float(7);
        }
        float foo13()
        {
            double x = 7.5d;
            return float(x);
        }
        double foo14()
        {
            double x = 7.5f;
            return double(x);
        }
    `);
    checkBool(program, callFunction(program, "foo", [], []), true);
    checkBool(program, callFunction(program, "foo2", [], []), true);
    checkBool(program, callFunction(program, "foo3", [], []), true);
    checkBool(program, callFunction(program, "foo4", [], []), true);
    checkBool(program, callFunction(program, "foo5", [], []), true);
    checkFloat(program, callFunction(program, "foo6", [], []), 7.5);
    checkFloat(program, callFunction(program, "foo7", [], []), 7.5);
    checkFloat(program, callFunction(program, "foo8", [], []), 7.5);
    checkFloat(program, callFunction(program, "foo9", [], []), 7.5);
    checkFloat(program, callFunction(program, "foo10", [], []), 7.5);
    checkFloat(program, callFunction(program, "foo11", [], []), 7.5);
    checkFloat(program, callFunction(program, "foo12", [], []), 7);
    checkFloat(program, callFunction(program, "foo13", [], []), 7.5);
    checkDouble(program, callFunction(program, "foo14", [], []), 7.5);
    checkFail(
        () => doPrep(`
            int bar(int x)
            {
                return x;
            }
            int foo()
            {
                bar(4.);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int bar(int x)
            {
                return x;
            }
            int foo()
            {
                bar(4.d);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int bar(int x)
            {
                return x;
            }
            int foo()
            {
                bar(4.f);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            uint bar(uint x)
            {
                return x;
            }
            int foo()
            {
                bar(4.);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            uint bar(uint x)
            {
                return x;
            }
            int foo()
            {
                bar(4.d);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            uint bar(uint x)
            {
                return x;
            }
            int foo()
            {
                bar(4.f);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            float bar(float x)
            {
                return x;
            }
            void foo()
            {
                bar(16777217.d);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            float bar(float x)
            {
                return x;
            }
            float foo()
            {
                double x = 7.;
                return bar(x);
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            float foo()
            {
                double x = 7.;
                return x;
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.genericCastInfer = function()
{
    let program = doPrep(`
        struct Complex<T> {
            T real;
            T imag;
        }
        operator<T> Complex<T>(T real, T imag)
        {
            Complex<T> result;
            result.real = real;
            result.imag = imag;
            return result;
        }
        int foo()
        {
            Complex<int> x = Complex<int>(1, 2);
            return x.real + x.imag;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 3);
}

tests.booleanMath = function()
{
    let program = doPrep(`
        bool foo()
        {
            return true && true;
        }
        bool foo2()
        {
            return true && false;
        }
        bool foo3()
        {
            return false && true;
        }
        bool foo4()
        {
            return false && false;
        }
        bool foo5()
        {
            return true || true;
        }
        bool foo6()
        {
            return true || false;
        }
        bool foo7()
        {
            return false || true;
        }
        bool foo8()
        {
            return false || false;
        }
    `);
    checkBool(program, callFunction(program, "foo", [], []), true);
    checkBool(program, callFunction(program, "foo2", [], []), false);
    checkBool(program, callFunction(program, "foo3", [], []), false);
    checkBool(program, callFunction(program, "foo4", [], []), false);
    checkBool(program, callFunction(program, "foo5", [], []), true);
    checkBool(program, callFunction(program, "foo6", [], []), true);
    checkBool(program, callFunction(program, "foo7", [], []), true);
    checkBool(program, callFunction(program, "foo8", [], []), false);
}

tests.typedefArray = function()
{
    let program = doPrep(`
        typedef ArrayTypedef = int[2];
        int foo()
        {
            ArrayTypedef arrayTypedef;
            return arrayTypedef[0];
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 0);
}

tests.shaderTypes = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                float4 x;
            }
            vertex Foo bar()
            {
                Foo result;
                result.x = float4();
                return result;
            }
            Foo foo() {
                return bar();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            vertex float bar()
            {
                return 4.;
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                float4 x;
            }
            vertex Foo bar(device Foo* x)
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Boo {
                float4 x;
            }
            struct Foo {
                float4 x;
                device Boo* y;
            }
            vertex Foo bar()
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                float4 x;
            }
            struct Boo {
                device Foo* y;
            }
            vertex Foo bar(Boo b)
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                float4 x;
            }
            vertex Foo bar(device Foo* x)
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                float4 x;
            }
            fragment Foo bar(Foo foo)
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                float4 x;
            }
            fragment Foo bar(device Foo* stageIn)
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Boo {
                float4 x;
            }
            struct Foo {
                float4 x;
                device Boo* y;
            }
            fragment Boo bar(Foo stageIn)
            {
                return boo();
            }
        `),
        (e) => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Boo {
                float4 x;
            }
            struct Foo {
                float4 x;
                device Boo* y;
            }
            fragment Foo bar(Boo stageIn)
            {
                return Foo();
            }
        `),
        (e) => e instanceof WTypeError);
}

tests.builtinVectors = function()
{
    let program = doPrep(`
        int foo()
        {
            int2 a = int2(3, 4);
            return a[0];
        }
        int foo2()
        {
            int2 a = int2(3, 4);
            int3 b = int3(a, 5);
            return b[1];
        }
        int foo3()
        {
            int3 a = int3(3, 4, 5);
            int4 b = int4(6, a);
            return b[1];
        }
        int foo4()
        {
            int2 a = int2(3, 4);
            int2 b = int2(5, 6);
            int4 c = int4(a, b);
            return c[2];
        }
        bool foo5()
        {
            int4 a = int4(3, 4, 5, 6);
            int2 b = int2(4, 5);
            int4 c = int4(3, b, 6);
            return a == c;
        }
        bool foo6()
        {
            int2 a = int2(4, 5);
            int3 b = int3(3, a);
            int3 c = int3(3, 4, 6);
            return b == c;
        }
        uint foou()
        {
            uint2 a = uint2(3, 4);
            return a[0];
        }
        uint foou2()
        {
            uint2 a = uint2(3, 4);
            uint3 b = uint3(a, 5);
            return b[1];
        }
        uint foou3()
        {
            uint3 a = uint3(3, 4, 5);
            uint4 b = uint4(6, a);
            return b[1];
        }
        uint foou4()
        {
            uint2 a = uint2(3, 4);
            uint2 b = uint2(5, 6);
            uint4 c = uint4(a, b);
            return c[2];
        }
        bool foou5()
        {
            uint4 a = uint4(3, 4, 5, 6);
            uint2 b = uint2(4, 5);
            uint4 c = uint4(3, b, 6);
            return a == c;
        }
        bool foou6()
        {
            uint2 a = uint2(4, 5);
            uint3 b = uint3(3, a);
            uint3 c = uint3(3, 4, 6);
            return b == c;
        }
        float foof()
        {
            float2 a = float2(3., 4.);
            return a[0];
        }
        float foof2()
        {
            float2 a = float2(3., 4.);
            float3 b = float3(a, 5.);
            return b[1];
        }
        float foof3()
        {
            float3 a = float3(3., 4., 5.);
            float4 b = float4(6., a);
            return b[1];
        }
        float foof4()
        {
            float2 a = float2(3., 4.);
            float2 b = float2(5., 6.);
            float4 c = float4(a, b);
            return c[2];
        }
        bool foof5()
        {
            float4 a = float4(3., 4., 5., 6.);
            float2 b = float2(4., 5.);
            float4 c = float4(3., b, 6.);
            return a == c;
        }
        bool foof6()
        {
            float2 a = float2(4., 5.);
            float3 b = float3(3., a);
            float3 c = float3(3., 4., 6.);
            return b == c;
        }
        double food()
        {
            double2 a = double2(3., 4.);
            return a[0];
        }
        double food2()
        {
            double2 a = double2(3., 4.);
            double3 b = double3(a, 5.);
            return b[1];
        }
        double food3()
        {
            double3 a = double3(3., 4., 5.);
            double4 b = double4(6., a);
            return b[1];
        }
        double food4()
        {
            double2 a = double2(3., 4.);
            double2 b = double2(5., 6.);
            double4 c = double4(a, b);
            return c[2];
        }
        bool food5()
        {
            double4 a = double4(3., 4., 5., 6.);
            double2 b = double2(4., 5.);
            double4 c = double4(3., b, 6.);
            return a == c;
        }
        bool food6()
        {
            double2 a = double2(4., 5.);
            double3 b = double3(3., a);
            double3 c = double3(3., 4., 6.);
            return b == c;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 3);
    checkInt(program, callFunction(program, "foo2", [], []), 4);
    checkInt(program, callFunction(program, "foo3", [], []), 3);
    checkInt(program, callFunction(program, "foo4", [], []), 5);
    checkBool(program, callFunction(program, "foo5", [], []), true);
    checkBool(program, callFunction(program, "foo6", [], []), false);
    checkUint(program, callFunction(program, "foou", [], []), 3);
    checkUint(program, callFunction(program, "foou2", [], []), 4);
    checkUint(program, callFunction(program, "foou3", [], []), 3);
    checkUint(program, callFunction(program, "foou4", [], []), 5);
    checkBool(program, callFunction(program, "foou5", [], []), true);
    checkBool(program, callFunction(program, "foou6", [], []), false);
    checkFloat(program, callFunction(program, "foof", [], []), 3);
    checkFloat(program, callFunction(program, "foof2", [], []), 4);
    checkFloat(program, callFunction(program, "foof3", [], []), 3);
    checkFloat(program, callFunction(program, "foof4", [], []), 5);
    checkBool(program, callFunction(program, "foof5", [], []), true);
    checkBool(program, callFunction(program, "foof6", [], []), false);
    checkDouble(program, callFunction(program, "food", [], []), 3);
    checkDouble(program, callFunction(program, "food2", [], []), 4);
    checkDouble(program, callFunction(program, "food3", [], []), 3);
    checkDouble(program, callFunction(program, "food4", [], []), 5);
    checkBool(program, callFunction(program, "food5", [], []), true);
    checkBool(program, callFunction(program, "food6", [], []), false);
}

tests.instantiateStructInStruct = function()
{
    let program = doPrep(`
        struct Bar<T> {
            T x;
        }
        struct Foo {
            Bar<int> x;
        }
        int foo()
        {
            Foo x;
            x.x.x = 42;
            x.x.x++;
            return x.x.x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 43);
}

tests.instantiateStructInStructWithInt2 = function()
{
    let program = doPrep(`
        struct Foo {
            int2 x;
        }
        int foo()
        {
            Foo x;
            x.x.x = 42;
            x.x.x++;
            return x.x.x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 43);
}

tests.simpleEnum = function()
{
    let program = doPrep(`
        enum Foo {
            War,
            Famine,
            Pestilence,
            Death
        }
        Foo war()
        {
            return Foo.War;
        }
        Foo famine()
        {
            return Foo.Famine;
        }
        Foo pestilence()
        {
            return Foo.Pestilence;
        }
        Foo death()
        {
            return Foo.Death;
        }
        bool equals(Foo a, Foo b)
        {
            return a == b;
        }
        bool notEquals(Foo a, Foo b)
        {
            return a != b;
        }
        bool testSimpleEqual()
        {
            return equals(Foo.War, Foo.War);
        }
        bool testAnotherEqual()
        {
            return equals(Foo.Pestilence, Foo.Pestilence);
        }
        bool testNotEqual()
        {
            return equals(Foo.Famine, Foo.Death);
        }
        bool testSimpleNotEqual()
        {
            return notEquals(Foo.War, Foo.War);
        }
        bool testAnotherNotEqual()
        {
            return notEquals(Foo.Pestilence, Foo.Pestilence);
        }
        bool testNotNotEqual()
        {
            return notEquals(Foo.Famine, Foo.Death);
        }
        int intWar()
        {
            return int(war());
        }
        int intFamine()
        {
            return int(famine());
        }
        int intPestilence()
        {
            return int(pestilence());
        }
        int intDeath()
        {
            return int(death());
        }
        int warValue()
        {
            return war().value;
        }
        int famineValue()
        {
            return famine().value;
        }
        int pestilenceValue()
        {
            return pestilence().value;
        }
        int deathValue()
        {
            return death().value;
        }
        int warValueLiteral()
        {
            return Foo.War.value;
        }
        int famineValueLiteral()
        {
            return Foo.Famine.value;
        }
        int pestilenceValueLiteral()
        {
            return Foo.Pestilence.value;
        }
        int deathValueLiteral()
        {
            return Foo.Death.value;
        }
        Foo intWarBackwards()
        {
            return Foo(intWar());
        }
        Foo intFamineBackwards()
        {
            return Foo(intFamine());
        }
        Foo intPestilenceBackwards()
        {
            return Foo(intPestilence());
        }
        Foo intDeathBackwards()
        {
            return Foo(intDeath());
        }
    `);
    checkEnum(program, callFunction(program, "war", [], []), 0);
    checkEnum(program, callFunction(program, "famine", [], []), 1);
    checkEnum(program, callFunction(program, "pestilence", [], []), 2);
    checkEnum(program, callFunction(program, "death", [], []), 3);
    checkBool(program, callFunction(program, "testSimpleEqual", [], []), true);
    checkBool(program, callFunction(program, "testAnotherEqual", [], []), true);
    checkBool(program, callFunction(program, "testNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testSimpleNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testAnotherNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testNotNotEqual", [], []), true);
    checkInt(program, callFunction(program, "intWar", [], []), 0);
    checkInt(program, callFunction(program, "intFamine", [], []), 1);
    checkInt(program, callFunction(program, "intPestilence", [], []), 2);
    checkInt(program, callFunction(program, "intDeath", [], []), 3);
    checkInt(program, callFunction(program, "warValue", [], []), 0);
    checkInt(program, callFunction(program, "famineValue", [], []), 1);
    checkInt(program, callFunction(program, "pestilenceValue", [], []), 2);
    checkInt(program, callFunction(program, "deathValue", [], []), 3);
    checkInt(program, callFunction(program, "warValueLiteral", [], []), 0);
    checkInt(program, callFunction(program, "famineValueLiteral", [], []), 1);
    checkInt(program, callFunction(program, "pestilenceValueLiteral", [], []), 2);
    checkInt(program, callFunction(program, "deathValueLiteral", [], []), 3);
    checkEnum(program, callFunction(program, "intWarBackwards", [], []), 0);
    checkEnum(program, callFunction(program, "intFamineBackwards", [], []), 1);
    checkEnum(program, callFunction(program, "intPestilenceBackwards", [], []), 2);
    checkEnum(program, callFunction(program, "intDeathBackwards", [], []), 3);
}

tests.enumWithManualValues = function()
{
    let program = doPrep(`
        enum Foo {
            War = 72,
            Famine = 0,
            Pestilence = 23,
            Death = -42
        }
        Foo war()
        {
            return Foo.War;
        }
        Foo famine()
        {
            return Foo.Famine;
        }
        Foo pestilence()
        {
            return Foo.Pestilence;
        }
        Foo death()
        {
            return Foo.Death;
        }
    `);
    checkEnum(program, callFunction(program, "war", [], []), 72);
    checkEnum(program, callFunction(program, "famine", [], []), 0);
    checkEnum(program, callFunction(program, "pestilence", [], []), 23);
    checkEnum(program, callFunction(program, "death", [], []), -42);
}

tests.enumWithoutZero = function()
{
    checkFail(
        () => doPrep(`
            enum Foo {
                War = 72,
                Famine = 64,
                Pestilence = 23,
                Death = -42
            }
        `),
        e => e instanceof WTypeError);
}

tests.enumDuplicates = function()
{
    checkFail(
        () => doPrep(`
            enum Foo {
                War = -42,
                Famine = 0,
                Pestilence = 23,
                Death = -42
            }
        `),
        e => e instanceof WTypeError);
}

tests.enumWithSomeManualValues = function()
{
    let program = doPrep(`
        enum Foo {
            War = 72,
            Famine,
            Pestilence = 0,
            Death
        }
        Foo war()
        {
            return Foo.War;
        }
        Foo famine()
        {
            return Foo.Famine;
        }
        Foo pestilence()
        {
            return Foo.Pestilence;
        }
        Foo death()
        {
            return Foo.Death;
        }
    `);
    checkEnum(program, callFunction(program, "war", [], []), 72);
    checkEnum(program, callFunction(program, "famine", [], []), 73);
    checkEnum(program, callFunction(program, "pestilence", [], []), 0);
    checkEnum(program, callFunction(program, "death", [], []), 1);
}

tests.enumConstexprGenericFunction = function()
{
    let program = doPrep(`
        enum Axis { X, Y }
        int foo<Axis axis>() { return int(axis); }
        int testX() { return foo<Axis.X>(); }
        int testY() { return foo<Axis.Y>(); }
    `);
    checkInt(program, callFunction(program, "testX", [], []), 0);
    checkInt(program, callFunction(program, "testY", [], []), 1);
}

tests.enumConstexprGenericStruct = function()
{
    let program = doPrep(`
        enum Axis { X, Y }
        struct Foo<Axis axis> { }
        int foo<Axis axis>(Foo<axis>) { return int(axis); }
        int testX()
        {   
            Foo<Axis.X> f;
            return foo(f);
        }
        int testY()
        {   
            Foo<Axis.Y> f;
            return foo(f);
        }
    `);
    checkInt(program, callFunction(program, "testX", [], []), 0);
    checkInt(program, callFunction(program, "testY", [], []), 1);
}

tests.trap = function()
{
    let program = doPrep(`
        int foo()
        {
            trap;
        }
        int foo2(int x)
        {
            if (x == 3)
                trap;
            return 4;
        }
        struct Bar {
            int3 x;
            float y;
        }
        Bar foo3()
        {
            trap;
        }
    `);
    checkFail(
        () => callFunction(program, "foo", [], []),
        e => e instanceof WTrapError);
    checkInt(program, callFunction(program, "foo2", [], [makeInt(program, 1)]), 4);
    checkFail(
        () => callFunction(program, "foo2", [], [makeInt(program, 3)]),
        e => e instanceof WTrapError);
    checkFail(
        () => callFunction(program, "foo3", [], []),
        e => e instanceof WTrapError);
}

tests.swizzle = function()
{
    let program = doPrep(`
        float foo() {
            float4 bar = float4(3., 4., 5., 6.);
            float3 baz = bar.zzx;
            return baz.z;
        }
        float foo2() {
            float4 bar = float4(3., 4., 5., 6.);
            float3 baz = bar.wyz;
            return baz.x;
        }
        float foo3() {
            float3 bar = float3(3., 4., 5.);
            float2 baz = bar.yz;
            float4 quix = baz.yyxx;
            return quix.z;
        }
    `);
    checkFloat(program, callFunction(program, "foo", [], []), 3);
    checkFloat(program, callFunction(program, "foo2", [], []), 6);
    checkFloat(program, callFunction(program, "foo3", [], []), 4);
}

tests.enumWithExplicitIntBase = function()
{
    let program = doPrep(`
        enum Foo : int {
            War,
            Famine,
            Pestilence,
            Death
        }
        Foo war()
        {
            return Foo.War;
        }
        Foo famine()
        {
            return Foo.Famine;
        }
        Foo pestilence()
        {
            return Foo.Pestilence;
        }
        Foo death()
        {
            return Foo.Death;
        }
        bool equals(Foo a, Foo b)
        {
            return a == b;
        }
        bool notEquals(Foo a, Foo b)
        {
            return a != b;
        }
        bool testSimpleEqual()
        {
            return equals(Foo.War, Foo.War);
        }
        bool testAnotherEqual()
        {
            return equals(Foo.Pestilence, Foo.Pestilence);
        }
        bool testNotEqual()
        {
            return equals(Foo.Famine, Foo.Death);
        }
        bool testSimpleNotEqual()
        {
            return notEquals(Foo.War, Foo.War);
        }
        bool testAnotherNotEqual()
        {
            return notEquals(Foo.Pestilence, Foo.Pestilence);
        }
        bool testNotNotEqual()
        {
            return notEquals(Foo.Famine, Foo.Death);
        }
        int intWar()
        {
            return int(war());
        }
        int intFamine()
        {
            return int(famine());
        }
        int intPestilence()
        {
            return int(pestilence());
        }
        int intDeath()
        {
            return int(death());
        }
        int warValue()
        {
            return war().value;
        }
        int famineValue()
        {
            return famine().value;
        }
        int pestilenceValue()
        {
            return pestilence().value;
        }
        int deathValue()
        {
            return death().value;
        }
        int warValueLiteral()
        {
            return Foo.War.value;
        }
        int famineValueLiteral()
        {
            return Foo.Famine.value;
        }
        int pestilenceValueLiteral()
        {
            return Foo.Pestilence.value;
        }
        int deathValueLiteral()
        {
            return Foo.Death.value;
        }
        Foo intWarBackwards()
        {
            return Foo(intWar());
        }
        Foo intFamineBackwards()
        {
            return Foo(intFamine());
        }
        Foo intPestilenceBackwards()
        {
            return Foo(intPestilence());
        }
        Foo intDeathBackwards()
        {
            return Foo(intDeath());
        }
    `);
    checkEnum(program, callFunction(program, "war", [], []), 0);
    checkEnum(program, callFunction(program, "famine", [], []), 1);
    checkEnum(program, callFunction(program, "pestilence", [], []), 2);
    checkEnum(program, callFunction(program, "death", [], []), 3);
    checkBool(program, callFunction(program, "testSimpleEqual", [], []), true);
    checkBool(program, callFunction(program, "testAnotherEqual", [], []), true);
    checkBool(program, callFunction(program, "testNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testSimpleNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testAnotherNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testNotNotEqual", [], []), true);
    checkInt(program, callFunction(program, "intWar", [], []), 0);
    checkInt(program, callFunction(program, "intFamine", [], []), 1);
    checkInt(program, callFunction(program, "intPestilence", [], []), 2);
    checkInt(program, callFunction(program, "intDeath", [], []), 3);
    checkInt(program, callFunction(program, "warValue", [], []), 0);
    checkInt(program, callFunction(program, "famineValue", [], []), 1);
    checkInt(program, callFunction(program, "pestilenceValue", [], []), 2);
    checkInt(program, callFunction(program, "deathValue", [], []), 3);
    checkInt(program, callFunction(program, "warValueLiteral", [], []), 0);
    checkInt(program, callFunction(program, "famineValueLiteral", [], []), 1);
    checkInt(program, callFunction(program, "pestilenceValueLiteral", [], []), 2);
    checkInt(program, callFunction(program, "deathValueLiteral", [], []), 3);
    checkEnum(program, callFunction(program, "intWarBackwards", [], []), 0);
    checkEnum(program, callFunction(program, "intFamineBackwards", [], []), 1);
    checkEnum(program, callFunction(program, "intPestilenceBackwards", [], []), 2);
    checkEnum(program, callFunction(program, "intDeathBackwards", [], []), 3);
}

tests.enumWithUintBase = function()
{
    let program = doPrep(`
        enum Foo : uint {
            War,
            Famine,
            Pestilence,
            Death
        }
        Foo war()
        {
            return Foo.War;
        }
        Foo famine()
        {
            return Foo.Famine;
        }
        Foo pestilence()
        {
            return Foo.Pestilence;
        }
        Foo death()
        {
            return Foo.Death;
        }
        bool equals(Foo a, Foo b)
        {
            return a == b;
        }
        bool notEquals(Foo a, Foo b)
        {
            return a != b;
        }
        bool testSimpleEqual()
        {
            return equals(Foo.War, Foo.War);
        }
        bool testAnotherEqual()
        {
            return equals(Foo.Pestilence, Foo.Pestilence);
        }
        bool testNotEqual()
        {
            return equals(Foo.Famine, Foo.Death);
        }
        bool testSimpleNotEqual()
        {
            return notEquals(Foo.War, Foo.War);
        }
        bool testAnotherNotEqual()
        {
            return notEquals(Foo.Pestilence, Foo.Pestilence);
        }
        bool testNotNotEqual()
        {
            return notEquals(Foo.Famine, Foo.Death);
        }
        uint uintWar()
        {
            return uint(war());
        }
        uint uintFamine()
        {
            return uint(famine());
        }
        uint uintPestilence()
        {
            return uint(pestilence());
        }
        uint uintDeath()
        {
            return uint(death());
        }
        uint warValue()
        {
            return war().value;
        }
        uint famineValue()
        {
            return famine().value;
        }
        uint pestilenceValue()
        {
            return pestilence().value;
        }
        uint deathValue()
        {
            return death().value;
        }
        uint warValueLiteral()
        {
            return Foo.War.value;
        }
        uint famineValueLiteral()
        {
            return Foo.Famine.value;
        }
        uint pestilenceValueLiteral()
        {
            return Foo.Pestilence.value;
        }
        uint deathValueLiteral()
        {
            return Foo.Death.value;
        }
        Foo uintWarBackwards()
        {
            return Foo(uintWar());
        }
        Foo uintFamineBackwards()
        {
            return Foo(uintFamine());
        }
        Foo uintPestilenceBackwards()
        {
            return Foo(uintPestilence());
        }
        Foo uintDeathBackwards()
        {
            return Foo(uintDeath());
        }
    `);
    checkEnum(program, callFunction(program, "war", [], []), 0);
    checkEnum(program, callFunction(program, "famine", [], []), 1);
    checkEnum(program, callFunction(program, "pestilence", [], []), 2);
    checkEnum(program, callFunction(program, "death", [], []), 3);
    checkBool(program, callFunction(program, "testSimpleEqual", [], []), true);
    checkBool(program, callFunction(program, "testAnotherEqual", [], []), true);
    checkBool(program, callFunction(program, "testNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testSimpleNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testAnotherNotEqual", [], []), false);
    checkBool(program, callFunction(program, "testNotNotEqual", [], []), true);
    checkUint(program, callFunction(program, "uintWar", [], []), 0);
    checkUint(program, callFunction(program, "uintFamine", [], []), 1);
    checkUint(program, callFunction(program, "uintPestilence", [], []), 2);
    checkUint(program, callFunction(program, "uintDeath", [], []), 3);
    checkUint(program, callFunction(program, "warValue", [], []), 0);
    checkUint(program, callFunction(program, "famineValue", [], []), 1);
    checkUint(program, callFunction(program, "pestilenceValue", [], []), 2);
    checkUint(program, callFunction(program, "deathValue", [], []), 3);
    checkUint(program, callFunction(program, "warValueLiteral", [], []), 0);
    checkUint(program, callFunction(program, "famineValueLiteral", [], []), 1);
    checkUint(program, callFunction(program, "pestilenceValueLiteral", [], []), 2);
    checkUint(program, callFunction(program, "deathValueLiteral", [], []), 3);
    checkEnum(program, callFunction(program, "uintWarBackwards", [], []), 0);
    checkEnum(program, callFunction(program, "uintFamineBackwards", [], []), 1);
    checkEnum(program, callFunction(program, "uintPestilenceBackwards", [], []), 2);
    checkEnum(program, callFunction(program, "uintDeathBackwards", [], []), 3);
}

tests.enumFloatBase = function()
{
    checkFail(
        () => doPrep(`
            enum Foo : float {
                Bar
            }
        `),
        e => e instanceof WTypeError);
}

tests.enumPtrBase = function()
{
    checkFail(
        () => doPrep(`
            enum Foo : thread int* {
                Bar
            }
        `),
        e => e instanceof WTypeError);
}

tests.enumArrayRefBase = function()
{
    checkFail(
        () => doPrep(`
            enum Foo : thread int[] {
                Bar
            }
        `),
        e => e instanceof WTypeError);
}

tests.emptyStruct = function()
{
    let program = doPrep(`
        struct Thingy { }
        int foo()
        {
            Thingy thingy;
            return 46;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 46);
}

tests.enumStructBase = function()
{
    checkFail(
        () => doPrep(`
            struct Thingy { }
            enum Foo : Thingy {
                Bar
            }
        `),
        e => e instanceof WTypeError);
}

tests.enumNoMembers = function()
{
    checkFail(
        () => doPrep(`
            enum Foo { }
        `),
        e => e instanceof WTypeError);
}

tests.simpleSwitch = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            switch (x) {
            case 767:
                return 27;
            case 69:
                return 7624;
            default:
                return 49;
            }
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 767)]), 27);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 69)]), 7624);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0)]), 49);
}

tests.exhaustiveUint8Switch = function()
{
    let text = "double foo(uint8 x) { switch (uint8(x)) {"
    for (let i = 0; i <= 0xff; ++i)
        text += "case " + i + ": return " + i * 1.5 + ";";
    text += "} }";
    let program = doPrep(text);
    for (let i = 0; i < 0xff; ++i)
        checkDouble(program, callFunction(program, "foo", [], [makeUint8(program, i)]), i * 1.5);
}

tests.notQuiteExhaustiveUint8Switch = function()
{
    let text = "double foo(uint8 x) { switch (uint8(x)) {"
    for (let i = 0; i <= 0xfe; ++i)
        text += "case " + i + ": return " + i * 1.5 + ";";
    text += "} }";
    checkFail(() => doPrep(text), e => e instanceof WTypeError);
}

tests.notQuiteExhaustiveUint8SwitchWithDefault = function()
{
    let text = "double foo(uint8 x) { switch (uint8(x)) {"
    for (let i = 0; i <= 0xfe; ++i)
        text += "case " + i + ": return " + i * 1.5 + ";";
    text += "default: return " + 0xff * 1.5 + ";";
    text += "} }";
    let program = doPrep(text);
    for (let i = 0; i < 0xff; ++i)
        checkDouble(program, callFunction(program, "foo", [], [makeUint8(program, i)]), i * 1.5);
}

tests.switchFallThrough = function()
{
    // FIXME: This might become an error in future versions.
    // https://bugs.webkit.org/show_bug.cgi?id=177172
    let program = doPrep(`
        int foo(int x)
        {
            int result = 0;
            switch (x) {
            case 767:
                result += 27;
            case 69:
                result += 7624;
            default:
                result += 49;
            }
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 767)]), 27 + 7624 + 49);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 69)]), 7624 + 49);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0)]), 49);
}

tests.switchBreak = function()
{
    let program = doPrep(`
        int foo(int x)
        {
            int result = 0;
            switch (x) {
            case 767:
                result += 27;
                break;
            case 69:
                result += 7624;
                break;
            default:
                result += 49;
                break;
            }
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 767)]), 27);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 69)]), 7624);
    checkInt(program, callFunction(program, "foo", [], [makeInt(program, 0)]), 49);
}

tests.enumSwitchBreakExhaustive = function()
{
    let program = doPrep(`
        enum Foo {
            A, B, C
        }
        int foo(Foo x)
        {
            int result = 0;
            switch (x) {
            case Foo.A:
                result += 27;
                break;
            case Foo.B:
                result += 7624;
                break;
            case Foo.C:
                result += 49;
                break;
            }
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeEnum(program, "Foo", "A")]), 27);
    checkInt(program, callFunction(program, "foo", [], [makeEnum(program, "Foo", "B")]), 7624);
    checkInt(program, callFunction(program, "foo", [], [makeEnum(program, "Foo", "C")]), 49);
}

tests.enumSwitchBreakNotQuiteExhaustive = function()
{
    checkFail(
        () => doPrep(`
            enum Foo {
                A, B, C, D
            }
            int foo(Foo x)
            {
                int result = 0;
                switch (x) {
                case Foo.A:
                    result += 27;
                    break;
                case Foo.B:
                    result += 7624;
                    break;
                case Foo.C:
                    result += 49;
                    break;
                }
                return result;
            }
        `),
        e => e instanceof WTypeError);
}

tests.enumSwitchBreakNotQuiteExhaustiveWithDefault = function()
{
    let program = doPrep(`
        enum Foo {
            A, B, C
        }
        int foo(Foo x)
        {
            int result = 0;
            switch (x) {
            case Foo.A:
                result += 27;
                break;
            case Foo.B:
                result += 7624;
                break;
            default:
                result += 49;
                break;
            }
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], [makeEnum(program, "Foo", "A")]), 27);
    checkInt(program, callFunction(program, "foo", [], [makeEnum(program, "Foo", "B")]), 7624);
    checkInt(program, callFunction(program, "foo", [], [makeEnum(program, "Foo", "C")]), 49);
}

tests.simpleRecursiveStruct = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                Foo foo;
            }
        `),
        e => e instanceof WTypeError);
}

tests.mutuallyRecursiveStruct = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                Bar bar;
            }
            struct Bar {
                Foo foo;
            }
        `),
        e => e instanceof WTypeError);
}

tests.mutuallyRecursiveStructWithPointersBroken = function()
{
    let program = doPrep(`
        struct Foo {
            thread Bar* bar;
            int foo;
        }
        struct Bar {
            thread Foo* foo;
            int bar;
        }
        int foo()
        {
            Foo foo;
            Bar bar;
            foo.foo = 564;
            bar.bar = 53;
            return foo.bar->bar - bar.foo->foo;
        }
    `);
    checkFail(
        () => checkInt(program, callFunction(program, "foo", [], []), -511),
        e => e instanceof WTrapError);
}

tests.mutuallyRecursiveStructWithPointers = function()
{
    let program = doPrep(`
        struct Foo {
            thread Bar* bar;
            int foo;
        }
        struct Bar {
            thread Foo* foo;
            int bar;
        }
        int foo()
        {
            Foo foo;
            Bar bar;
            foo.bar = &bar;
            bar.foo = &foo;
            foo.foo = 564;
            bar.bar = 53;
            return foo.bar->bar - bar.foo->foo;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), -511);
}

tests.linkedList = function()
{
    let program = doPrep(`
        struct Node {
            thread Node* next;
            int value;
        }
        int foo()
        {
            Node x, y, z;
            x.next = &y;
            y.next = &z;
            x.value = 1;
            y.value = 2;
            z.value = 3;
            return x.next->next->value;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 3);
}

tests.pointerToPointer = function()
{
    let program = doPrep(`
        int foo()
        {
            int x;
            thread int* p = &x;
            thread int** pp = &p;
            int*thread*thread qq = pp;
            int result = 0;
            x = 42;
            *p = 76;
            result += x;
            **pp = 39;
            result += x;
            **qq = 83;
            result += x;
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 76 + 39 + 83);
}

tests.arrayRefToArrayRef = function()
{
    let program = doPrep(`
        int foo()
        {
            int x;
            thread int[] p = @x;
            thread int[][] pp = @p;
            int[]thread[]thread qq = pp;
            int result = 0;
            x = 42;
            p[0] = 76;
            result += x;
            pp[0][0] = 39;
            result += x;
            qq[0][0] = 83;
            result += x;
            return result;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 76 + 39 + 83);
}

tests.pointerGetter = function()
{
    checkFail(
        () => doPrep(`
            int operator.foo(device int*)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator.foo(thread int*)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator.foo(threadgroup int*)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator.foo(constant int*)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
}

tests.loneSetter = function()
{
    checkFail(
        () => doPrep(`
            int operator.foo=(int, int)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
}

tests.setterWithMismatchedType = function()
{
    checkFail(
        () => doPrep(`
            double operator.foo(int)
            {
                return 5.43;
            }
            int operator.foo=(int, int)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
}

tests.setterWithMatchedType = function()
{
    doPrep(`
        int operator.foo(int)
        {
            return 5;
        }
        int operator.foo=(int, int)
        {
            return 543;
        }
    `);
}

tests.operatorWithUninferrableTypeVariable = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            Foo operator+<T>(Foo a, Foo b)
            {
                Foo result;
                result.x = a.x + b.x;
                return result;
            }
        `),
        e => e instanceof WTypeError);
}

tests.operatorWithoutUninferrableTypeVariable = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        Foo operator+(Foo a, Foo b)
        {
            Foo result;
            result.x = a.x + b.x;
            return result;
        }
        int foo()
        {
            Foo a;
            a.x = 645;
            Foo b;
            b.x = -35;
            return (a + b).x;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 645 - 35);
}

tests.operatorCastWithUninferrableTypeVariable = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            operator<T> Foo(int x)
            {
                Foo result;
                result.x = x;
                return result;
            }
        `),
        e => e instanceof WTypeError);
}

tests.operatorCastWithTypeVariableInferredFromReturnType = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        protocol Barable {
            void bar(thread Barable*, int);
        }
        void bar(thread double* result, int value)
        {
            *result = double(value);
        }
        operator<T:Barable> T(Foo foo)
        {
            T result;
            bar(&result, foo.x);
            return result;
        }
        int foo()
        {
            Foo foo;
            foo.x = 75;
            double x = double(foo);
            return int(x * 1.5);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 112);
}

tests.incWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator++() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator++(int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.decWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator--() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator--(int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.incWrongTypes = function()
{
    checkFail(
        () => doPrep(`
            int operator++(double) { return 32; }
        `),
        e => e instanceof WTypeError);
}

tests.decWrongTypes = function()
{
    checkFail(
        () => doPrep(`
            int operator--(double) { return 32; }
        `),
        e => e instanceof WTypeError);
}

tests.plusWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator+() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator+(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.minusWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator-() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator-(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.timesWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator*() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator*(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator*(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.divideWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator/() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator/(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator/(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.moduloWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator%() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator%(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator%(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.bitAndWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator&() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator&(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator&(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.bitOrWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator|() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator|(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator|(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.bitXorWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator^() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator^(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator^(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.lShiftWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator<<() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator<<(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator<<(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.rShiftWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator>>() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator>>(int) { return 534; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator>>(int, int, int) { return 76; }
        `),
        e => e instanceof WTypeError);
}

tests.bitNotWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator~() { return 32; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator~(int, int) { return 534; }
        `),
        e => e instanceof WTypeError);
}

tests.equalsWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            bool operator==() { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator==(int) { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator==(int, int, int) { return true; }
        `),
        e => e instanceof WTypeError);
}

tests.lessThanWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            bool operator<() { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator<(int) { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator<(int, int, int) { return true; }
        `),
        e => e instanceof WTypeError);
}

tests.lessEqualWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            bool operator<=() { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator<=(int) { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator<=(int, int, int) { return true; }
        `),
        e => e instanceof WTypeError);
}

tests.greaterWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            bool operator>() { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator>(int) { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator>(int, int, int) { return true; }
        `),
        e => e instanceof WTypeError);
}

tests.greaterEqualWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            bool operator>=() { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator>=(int) { return true; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            bool operator>=(int, int, int) { return true; }
        `),
        e => e instanceof WTypeError);
}

tests.equalsWrongReturnType = function()
{
    checkFail(
        () => doPrep(`
            int operator==(int a, int b) { return a + b; }
        `),
        e => e instanceof WTypeError);
}

tests.notEqualsOverload = function()
{
    checkFail(
        () => doPrep(`
            struct Foo { }
            bool operator!=(Foo, Foo) { return true; }
        `),
        e => e instanceof WSyntaxError);
}

tests.lessThanWrongReturnType = function()
{
    checkFail(
        () => doPrep(`
            int operator<(int a, int b) { return a + b; }
        `),
        e => e instanceof WTypeError);
}

tests.lessEqualWrongReturnType = function()
{
    checkFail(
        () => doPrep(`
            int operator<=(int a, int b) { return a + b; }
        `),
        e => e instanceof WTypeError);
}

tests.greaterThanWrongReturnType = function()
{
    checkFail(
        () => doPrep(`
            int operator>(int a, int b) { return a + b; }
        `),
        e => e instanceof WTypeError);
}

tests.greaterEqualWrongReturnType = function()
{
    checkFail(
        () => doPrep(`
            int operator>=(int a, int b) { return a + b; }
        `),
        e => e instanceof WTypeError);
}

tests.dotOperatorWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator.foo() { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo { }
            int operator.foo(Foo, int) { return 42; }
        `),
        e => e instanceof WTypeError);
}

tests.dotOperatorSetterWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            struct Foo { }
            Foo operator.foo=() { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo { }
            Foo operator.foo=(Foo) { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo { }
            Foo operator.foo=(Foo, int, int) { return 42; }
        `),
        e => e instanceof WTypeError);
}

tests.loneSetterPointer = function()
{
    checkFail(
        () => doPrep(`
            thread int* operator.foo=(thread int* ptr, int)
            {
                return ptr;
            }
        `),
        e => e instanceof WTypeError);
}

tests.setterWithNoGetterOverload = function()
{
    checkFail(
        () => doPrep(`
            struct Foo { }
            struct Bar { }
            int operator.foo(Foo)
            {
                return 534;
            }
            Bar operator.foo=(Bar, int)
            {
                return Bar();
            }
        `),
        e => e instanceof WTypeError);
}

tests.setterWithNoGetterOverloadFixed = function()
{
    doPrep(`
        struct Bar { }
        int operator.foo(Bar)
        {
            return 534;
        }
        Bar operator.foo=(Bar, int)
        {
            return Bar();
        }
    `);
}

tests.anderWithNothingWrong = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        thread int* operator&.foo(thread Foo* foo)
        {
            return &foo->x;
        }
        int foo()
        {
            Foo x;
            x.x = 13;
            return x.foo;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 13);
}

tests.anderWithWrongNumberOfArguments = function()
{
    checkFail(
        () => doPrep(`
            thread int* operator&.foo()
            {
                int x;
                return &x;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            thread int* operator&.foo(thread Foo* foo, int blah)
            {
                return &foo->x;
            }
        `),
        e => e instanceof WTypeError);
}

tests.anderDoesntReturnPointer = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            int operator&.foo(thread Foo* foo)
            {
                return foo->x;
            }
        `),
        e => e instanceof WTypeError);
}

tests.anderDoesntTakeReference = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            thread int* operator&.foo(Foo foo)
            {
                return &foo.x;
            }
        `),
        e => e instanceof WTypeError);
}

tests.anderWithArrayRef = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        thread int* operator&.foo(thread Foo[] foo)
        {
            return &foo[0].x;
        }
        int foo()
        {
            Foo x;
            x.x = 13;
            return (@x).foo;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 13);
}

tests.pointerIndexGetter = function()
{
    checkFail(
        () => doPrep(`
            int operator[](device int*, uint)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[](thread int*, uint)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[](threadgroup int*, uint)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[](constant int*, uint)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
}

tests.loneIndexSetter = function()
{
    checkFail(
        () => doPrep(`
            int operator[]=(int, uint, int)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError);
}

tests.notLoneIndexSetter = function()
{
    doPrep(`
        int operator[](int, uint)
        {
            return 65;
        }
        int operator[]=(int, uint, int)
        {
            return 543;
        }
    `);
}

tests.indexSetterWithMismatchedType = function()
{
    checkFail(
        () => doPrep(`
            double operator[](int, uint)
            {
                return 5.43;
            }
            int operator[]=(int, uint, int)
            {
                return 543;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Setter and getter must agree on value type") != -1);
}

tests.indexOperatorWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator[]() { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[](int) { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[](int, int, int) { return 42; }
        `),
        e => e instanceof WTypeError);
}

tests.indexOperatorSetterWrongArgumentLength = function()
{
    checkFail(
        () => doPrep(`
            int operator[]=() { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[]=(int) { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[]=(int, int) { return 42; }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            int operator[]=(int, int, int, int) { return 42; }
        `),
        e => e instanceof WTypeError);
}

tests.loneIndexSetterPointer = function()
{
    checkFail(
        () => doPrep(`
            thread int* operator[]=(thread int* ptr, uint, int)
            {
                return ptr;
            }
        `),
        e => e instanceof WTypeError);
}

tests.indexSetterWithNoGetterOverload = function()
{
    checkFail(
        () => doPrep(`
            struct Foo { }
            struct Bar { }
            int operator[](Foo, uint)
            {
                return 534;
            }
            Bar operator[]=(Bar, uint, int)
            {
                return Bar();
            }
        `),
        e => e instanceof WTypeError);
}

tests.indexSetterWithNoGetterOverloadFixed = function()
{
    doPrep(`
        struct Bar { }
        int operator[](Bar, uint)
        {
            return 534;
        }
        Bar operator[]=(Bar, uint, int)
        {
            return Bar();
        }
    `);
}

tests.indexAnderWithNothingWrong = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        thread int* operator&[](thread Foo* foo, uint)
        {
            return &foo->x;
        }
        int foo()
        {
            Foo x;
            x.x = 13;
            return x[666];
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 13);
}

tests.indexAnderWithWrongNumberOfArguments = function()
{
    checkFail(
        () => doPrep(`
            thread int* operator&[]()
            {
                int x;
                return &x;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            thread int* operator&[](thread Foo* foo)
            {
                return &foo->x;
            }
        `),
        e => e instanceof WTypeError);
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            thread int* operator&[](thread Foo* foo, uint, uint)
            {
                return &foo->x;
            }
        `),
        e => e instanceof WTypeError);
}

tests.indexAnderDoesntReturnPointer = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            int operator&[](thread Foo* foo, uint)
            {
                return foo->x;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Return type of ander is not a pointer") != -1);
}

tests.indexAnderDoesntTakeReference = function()
{
    checkFail(
        () => doPrep(`
            struct Foo {
                int x;
            }
            thread int* operator&[](Foo foo, uint)
            {
                return &foo.x;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Parameter to ander is not a reference") != -1);
}

tests.indexAnderWithArrayRef = function()
{
    let program = doPrep(`
        struct Foo {
            int x;
        }
        thread int* operator&[](thread Foo[] array, double index)
        {
            return &array[uint(index + 1)].x;
        }
        int foo()
        {
            Foo x;
            x.x = 13;
            return (@x)[double(-1)];
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 13);
}

tests.devicePtrPtr = function()
{
    checkFail(
        () => doPrep(`
            void foo()
            {
                device int** p;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Illegal pointer to non-primitive type: int32* device* device") != -1);
}

tests.threadgroupPtrPtr = function()
{
    checkFail(
        () => doPrep(`
            void foo()
            {
                threadgroup int** p;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Illegal pointer to non-primitive type: int32* threadgroup* threadgroup") != -1);
}

tests.constantPtrPtr = function()
{
    checkFail(
        () => doPrep(`
            void foo()
            {
                constant int** p;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Illegal pointer to non-primitive type: int32* constant* constant") != -1);
}

tests.pointerIndexGetterInProtocol = function()
{
    for (let addressSpace of addressSpaces) {
        checkFail(
            () => doPrep(`
                protocol Foo {
                    int operator[](${addressSpace} Foo*, uint);
                }
                struct Bar { }
                int operator[](Bar, uint) { return 42; }
            `),
            e => e instanceof WTypeError && e.message.indexOf("Cannot have getter for pointer type") != -1);
    }
}

tests.loneIndexSetterInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                Foo operator[]=(Foo, uint, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Every setter must have a matching getter") != -1);
}

tests.notLoneIndexSetterInProtocol = function()
{
    doPrep(`
        protocol Foo {
            int operator[](Foo, uint);
            Foo operator[]=(Foo, uint, int);
        }
        struct Bar { }
        int operator[](Bar, uint) { return 42; }
        Bar operator[]=(Bar, uint, int) { return Bar(); }
    `);
}

tests.indexSetterWithMismatchedTypeInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                double operator[](Foo, uint);
                Foo operator[]=(Foo, uint, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Setter and getter must agree on value type") != -1);
}

tests.indexOperatorWrongArgumentLengthInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[]();
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Protocol's type variable (Foo) not mentioned in signature") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[](Foo);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[](Foo, int, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters") != -1);
}

tests.indexOperatorSetterWrongArgumentLengthInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[]=();
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Protocol's type variable (Foo) not mentioned in signature") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[]=(Foo);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[]=(Foo, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[]=(Foo, int, int, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters") != -1);
}

tests.loneIndexSetterPointerInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                thread int* operator[]=(thread Foo* ptr, uint, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Cannot have setter for pointer type") != -1);
}

tests.indexSetterWithNoGetterOverloadInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator[](int, Foo);
                Foo operator[]=(Foo, uint, int);
            }
            struct Bar { }
            int operator[](Bar, uint) { return 42; }
            Bar operator[]=(Bar, uint, int) { return Bar(); }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Did not find function named operator[]= with arguments Foo,uint32") != -1);
}

tests.indexSetterWithNoGetterOverloadFixedInProtocol = function()
{
    doPrep(`
        protocol Foo {
            int operator[](Foo, uint);
            Foo operator[]=(Foo, uint, int);
        }
        struct Bar { }
        int operator[](Bar, uint) { return 42; }
        Bar operator[]=(Bar, uint, int) { return Bar(); }
    `);
}

tests.indexAnderWithNothingWrongInProtocol = function()
{
    let program = doPrep(`
        protocol Foo {
            thread int* operator&[](thread Foo* foo, uint);
        }
        int bar<T:Foo>(T x)
        {
            return x[42];
        }
        struct Bar { }
        thread int* operator&[](thread Bar*, uint)
        {
            int result = 1234;
            return &result;
        }
        int foo()
        {
            return bar(Bar());
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 1234);
}

tests.indexAnderWithWrongNumberOfArgumentsInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                thread int* operator&[]();
            }
            struct Bar { }
            thread int* operator&[](thread Bar*, uint)
            {
                int result = 1234;
                return &result;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Protocol's type variable (Foo) not mentioned in signature") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                thread int* operator&[](thread Foo* foo);
            }
            struct Bar { }
            thread int* operator&[](thread Bar*, uint)
            {
                int result = 1234;
                return &result;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters for operator&[]") != -1);
    checkFail(
        () => doPrep(`
            protocol Foo {
                thread int* operator&[](thread Foo* foo, uint, uint);
            }
            struct Bar { }
            thread int* operator&[](thread Bar*, uint)
            {
                int result = 1234;
                return &result;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Incorrect number of parameters for operator&[]") != -1);
}

tests.indexAnderDoesntReturnPointerInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                int operator&[](thread Foo* foo, uint);
            }
            struct Bar { }
            thread int* operator&[](thread Bar*, uint)
            {
                int result = 1234;
                return &result;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Return type of ander is not a pointer") != -1);
}

tests.indexAnderDoesntTakeReferenceInProtocol = function()
{
    checkFail(
        () => doPrep(`
            protocol Foo {
                thread int* operator&[](Foo foo, uint);
            }
            struct Bar { }
            thread int* operator&[](thread Bar*, uint)
            {
                int result = 1234;
                return &result;
            }
        `),
        e => e instanceof WTypeError && e.message.indexOf("Parameter to ander is not a reference") != -1);
}

tests.indexAnderWithArrayRefInProtocol = function()
{
    let program = doPrep(`
        protocol Foo {
            thread int* operator&[](thread Foo[] array, double index);
        }
        int bar<T:Foo>(thread T[] x)
        {
            return x[1.5];
        }
        struct Bar { }
        thread int* operator&[](thread Bar[], double)
        {
            int result = 1234;
            return &result;
        }
        int foo()
        {
            Bar x;
            return bar(@x);
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 1234);
}

tests.andReturnedArrayRef = function()
{
    let program = doPrep(`
        thread int[] getArray()
        {
            int[10] x;
            x[5] = 354;
            return @x;
        }
        int foo()
        {
            thread int* ptr = &getArray()[5];
            return *ptr;
        }
    `);
    checkInt(program, callFunction(program, "foo", [], []), 354);
}

okToTest = true;

function doTest()
{
    if (!okToTest)
        throw new Error("Test setup is incomplete.");

    let names = [];
    for (let s in tests)
        names.push(s);
    names.sort();
    for (let s of names) {
        tests[s]();
    }
}

class Benchmark {
    buildStdlib() {
        prepare();
    }

    run() {
        doTest()
    }
}

// A JetStream trial loads these module bindings afresh before its two phases.
// The harness repeats complete trials without loading source inside work.
export function resetTrial(): void {
    resetPreparedStandardLibrary();
    anonymousVariableCount = 0;
    eBufferCount = 0;
    canAllocateEBuffers = true;
}

export function trialCounters(): { eBuffers: number; anonymousVariables: number; tests: number } {
    return { eBuffers: eBufferCount, anonymousVariables: anonymousVariableCount, tests: Object.keys(tests).length };
}

export { Benchmark, Value, IdentityExpression, tests };
