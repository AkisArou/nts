// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked views of the compiler's original discriminants; no representation is changed.
import { type Type, TypeFlags, ObjectFlags, type FlowNode, FlowFlags, type UnionType, type IntersectionType, type UnionOrIntersectionType, type ObjectType, type TypeParameter, type IndexType, type IndexedAccessType, type ConditionalType, type SubstitutionType, type TemplateLiteralType, type StringMappingType, type StringLiteralType, type NumberLiteralType, type BigIntLiteralType, type LiteralType, type InstantiableType, type IntrinsicType, type TypeReference, type InterfaceType, type GenericType, type TupleType, type MappedType, type ReverseMappedType, type EvolvingArrayType, type AnonymousType, type FlowLabel, type FlowAssignment, type FlowCondition, type FlowSwitchClause, type FlowArrayMutation, type FlowCall, type FlowReduceLabel, type FlowStart } from "./compiler/types.ts";
export function isCompilerUnionType(value: Type): value is UnionType {
    return !!(value.flags & TypeFlags.Union);
}
export function isCompilerIntersectionType(value: Type): value is IntersectionType {
    return !!(value.flags & TypeFlags.Intersection);
}
export function isCompilerUnionOrIntersectionType(value: Type): value is UnionOrIntersectionType {
    return !!(value.flags & TypeFlags.UnionOrIntersection);
}
export function isCompilerObjectType(value: Type): value is ObjectType {
    return !!(value.flags & TypeFlags.Object);
}
export function isCompilerTypeParameter(value: Type): value is TypeParameter {
    return !!(value.flags & TypeFlags.TypeParameter);
}
export function isCompilerIndexType(value: Type): value is IndexType {
    return !!(value.flags & TypeFlags.Index);
}
export function isCompilerIndexedAccessType(value: Type): value is IndexedAccessType {
    return !!(value.flags & TypeFlags.IndexedAccess);
}
export function isCompilerConditionalType(value: Type): value is ConditionalType {
    return !!(value.flags & TypeFlags.Conditional);
}
export function isCompilerSubstitutionType(value: Type): value is SubstitutionType {
    return !!(value.flags & TypeFlags.Substitution);
}
export function isCompilerTemplateLiteralType(value: Type): value is TemplateLiteralType {
    return !!(value.flags & TypeFlags.TemplateLiteral);
}
export function isCompilerStringMappingType(value: Type): value is StringMappingType {
    return !!(value.flags & TypeFlags.StringMapping);
}
export function isCompilerStringLiteralType(value: Type): value is StringLiteralType {
    return !!(value.flags & TypeFlags.StringLiteral);
}
export function isCompilerNumberLiteralType(value: Type): value is NumberLiteralType {
    return !!(value.flags & TypeFlags.NumberLiteral);
}
export function isCompilerBigIntLiteralType(value: Type): value is BigIntLiteralType {
    return !!(value.flags & TypeFlags.BigIntLiteral);
}
export function isCompilerLiteralType(value: Type): value is LiteralType {
    return !!(value.flags & TypeFlags.Literal);
}
export function isCompilerInstantiableType(value: Type): value is InstantiableType {
    return !!(value.flags & TypeFlags.Instantiable);
}
export function isCompilerIntrinsicType(value: Type): value is IntrinsicType {
    return !!(value.flags & TypeFlags.Intrinsic);
}
function hasObjectFlags(value: Type): value is Type & {
    objectFlags: number;
} {
    return "objectFlags" in value && typeof value.objectFlags === "number";
}
export function isCompilerTypeReference(value: Type): value is TypeReference {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.Reference);
}
export function isCompilerInterfaceType(value: Type): value is InterfaceType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.ClassOrInterface);
}
export function isCompilerGenericType(value: Type): value is GenericType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & (ObjectFlags.ClassOrInterface | ObjectFlags.Tuple)) && !!(value.objectFlags & ObjectFlags.Reference);
}
export function isCompilerTupleType(value: Type): value is TupleType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.Tuple);
}
export function isCompilerMappedType(value: Type): value is MappedType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.Mapped);
}
export function isCompilerReverseMappedType(value: Type): value is ReverseMappedType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.ReverseMapped);
}
export function isCompilerEvolvingArrayType(value: Type): value is EvolvingArrayType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.EvolvingArray);
}
export function isCompilerAnonymousType(value: Type): value is AnonymousType {
    return !!(value.flags & TypeFlags.Object) && hasObjectFlags(value) && !!(value.objectFlags & ObjectFlags.Anonymous);
}
export function isCompilerFlowLabel(value: FlowNode): value is FlowLabel {
    return !!(value.flags & FlowFlags.Label);
}
export function isCompilerFlowAssignment(value: FlowNode): value is FlowAssignment {
    return !!(value.flags & FlowFlags.Assignment);
}
export function isCompilerFlowCondition(value: FlowNode): value is FlowCondition {
    return !!(value.flags & FlowFlags.Condition);
}
export function isCompilerFlowSwitchClause(value: FlowNode): value is FlowSwitchClause {
    return !!(value.flags & FlowFlags.SwitchClause);
}
export function isCompilerFlowArrayMutation(value: FlowNode): value is FlowArrayMutation {
    return !!(value.flags & FlowFlags.ArrayMutation);
}
export function isCompilerFlowCall(value: FlowNode): value is FlowCall {
    return !!(value.flags & FlowFlags.Call);
}
export function isCompilerFlowReduceLabel(value: FlowNode): value is FlowReduceLabel {
    return !!(value.flags & FlowFlags.ReduceLabel);
}
export function isCompilerFlowStart(value: FlowNode): value is FlowStart {
    return !!(value.flags & FlowFlags.Start);
}
import type { Node, SignatureDeclaration, FunctionLikeDeclarationBase, MethodDeclaration, MethodSignature, Block, ModuleBlock, CallExpression, NewExpression, Declaration, Identifier, ThisExpression, StructuredType, FunctionExpression, ArrowFunction } from "./compiler/types.ts";
import { SyntaxKind } from "./compiler/types.ts";
import { isFunctionLike, isDeclaration } from "./compiler/utilitiesPublic.ts";
export function isCompilerSignatureView(value: Node): value is SignatureDeclaration {
    return isFunctionLike(value);
}
export function isCompilerMethodView(value: Node): value is MethodDeclaration | MethodSignature {
    return value.kind === SyntaxKind.MethodDeclaration || value.kind === SyntaxKind.MethodSignature;
}
export function isCompilerBlockView(value: Node): value is Block | ModuleBlock {
    return value.kind === SyntaxKind.Block || value.kind === SyntaxKind.ModuleBlock;
}
export function isCompilerCallView(value: Node): value is CallExpression | NewExpression {
    return value.kind === SyntaxKind.CallExpression || value.kind === SyntaxKind.NewExpression;
}
export function isCompilerDeclarationView(value: Node): value is Declaration {
    return value.kind === SyntaxKind.IndexSignature || value.kind === SyntaxKind.ExportAssignment || value.kind === SyntaxKind.SourceFile || isFunctionLike(value) || isDeclaration(value);
}
export function isCompilerIdentifierOrThis(value: Node): value is Identifier | ThisExpression {
    return value.kind === SyntaxKind.Identifier || value.kind === SyntaxKind.ThisKeyword;
}
export function isCompilerStructuredType(value: Type): value is StructuredType {
    return !!(value.flags & TypeFlags.StructuredType);
}
export function isCompilerContextualFunction(value: Node): value is FunctionExpression | ArrowFunction | MethodDeclaration {
    return value.kind === SyntaxKind.FunctionExpression || value.kind === SyntaxKind.ArrowFunction || value.kind === SyntaxKind.MethodDeclaration;
}
export function isCompilerDeferredFunction(value: Node): value is FunctionExpression | ArrowFunction | MethodDeclaration | MethodSignature {
    return isCompilerContextualFunction(value) || value.kind === SyntaxKind.MethodSignature;
}
export function hasCompilerParent<T extends Node>(value: T): value is T & {
    parent: Node;
} {
    return value.parent !== undefined;
}
import type { ClassStaticBlockDeclaration } from "./compiler/types.ts";
export function isCompilerFunctionContainerView(value: Node): value is SignatureDeclaration | ClassStaticBlockDeclaration {
    return value.kind === SyntaxKind.ClassStaticBlockDeclaration || isFunctionLike(value);
}
import type { ClassLikeDeclaration, AccessorDeclaration, FunctionLikeDeclaration } from "./compiler/types.ts";
import { isClassLike, isAccessor, isFunctionLikeDeclaration } from "./compiler/utilitiesPublic.ts";
export function testOptional_isClassLike(value: Node | undefined): value is ClassLikeDeclaration {
    return !!isClassLike(value);
}
export function testOptional_isAccessor(value: Node | undefined): value is AccessorDeclaration {
    return !!isAccessor(value);
}
export function testOptional_isFunctionLikeDeclaration(value: Node | undefined): value is FunctionLikeDeclaration {
    return !!isFunctionLikeDeclaration(value);
}
import type { TypeNode } from "./compiler/types.ts";
import { dictionaryValue } from "./checked.ts";
import { isNodeLayout_69176c08124f } from "./checkedLayouts.ts";
export function isCompilerSyntaxNode(value: unknown): value is Node {
    if (value === null || typeof value !== "object")
        return false;
    return "kind" in value && typeof value.kind === "number"
        && "flags" in value && typeof value.flags === "number"
        && "pos" in value && typeof value.pos === "number"
        && "end" in value && typeof value.end === "number"
        && "transformFlags" in value && typeof value.transformFlags === "number";
}
/** Some legal callers have no type annotation field at all. */
export function compilerTypeAnnotation(node: Node): TypeNode | undefined {
    const value = dictionaryValue(node).type;
    if (value === undefined)
        return undefined;
    if (isCompilerSyntaxNode(value) && isNodeLayout_69176c08124f(value))
        return value;
    throw new TypeError("Unexpected compiler type annotation");
}

import type { ResolvedType } from "./compiler/types.ts";
export function requireCompleteResolvedType(value: StructuredType): asserts value is ResolvedType {
    if (value.members === undefined || value.properties === undefined || value.callSignatures === undefined || value.constructSignatures === undefined || value.indexInfos === undefined) {
        throw new TypeError("Incomplete compiler resolved type");
    }
}
