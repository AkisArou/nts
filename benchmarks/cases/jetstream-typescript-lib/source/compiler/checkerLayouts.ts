// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked views for erased assertions in the original TypeScript 5.9.2 checker.
// These return the existing object; no compiler node or type is replaced.
import {TypeFlags, ObjectFlags, SymbolFlags, CheckFlags, type Type, type FreshableType, type ResolvedType, type Symbol, type MappedSymbol, type ReverseMappedSymbol, type InstantiationExpressionType, type InterfaceType, type InterfaceTypeWithDeclaredMembers, type Node, type Signature, type DeferredTypeReference, type AnonymousType, type UniqueESSymbolType, type FreshObjectLiteralType} from "./types.ts";
import {checkedCompilerLayout} from "../checked.ts";
import type {StringLiteralType, NumberLiteralType, ObjectFlagsType, IndexedAccessType, TypeParameter, TypePredicate, SymbolLinks, MappedSymbolLinks, ReverseMappedSymbolLinks, IntrinsicType, FreshableIntrinsicType} from "./types.ts";
import {isCompilerStructuredType, isCompilerObjectType, isCompilerTypeReference, requireCompleteResolvedType} from "../checkedTypes.ts";
export function isCheckerFreshableType(value: Type): value is FreshableType {
    return !!(value.flags & TypeFlags.Freshable);
}
export function isCheckerFreshIntrinsic(value: IntrinsicType): value is FreshableIntrinsicType {
    return !!(value.flags & TypeFlags.Freshable);
}
export function checkerResolvedType(value: Type): ResolvedType {
    const structured = checkedCompilerLayout(value, isCompilerStructuredType);
    requireCompleteResolvedType(structured);
    return structured;
}
export function isCheckerMappedSymbol(value: Symbol): value is MappedSymbol {
    return !!(value.flags & SymbolFlags.Transient) && !!value.links && !!((value.links.checkFlags ?? 0) & CheckFlags.Mapped);
}
export function isCheckerReverseMappedSymbol(value: Symbol): value is ReverseMappedSymbol {
    return !!(value.flags & SymbolFlags.Transient) && !!value.links && !!((value.links.checkFlags ?? 0) & CheckFlags.ReverseMapped);
}
export function isCheckerInstantiationExpressionType(value: Type): value is InstantiationExpressionType {
    return isCompilerObjectType(value) && !!(value.objectFlags & ObjectFlags.InstantiationExpressionType);
}
export function isCheckerDeclaredInterface(value: InterfaceType & Partial<InterfaceTypeWithDeclaredMembers>): value is InterfaceTypeWithDeclaredMembers {
    return value.declaredProperties !== undefined && value.declaredCallSignatures !== undefined && value.declaredConstructSignatures !== undefined && value.declaredIndexInfos !== undefined;
}
type CheckerEntity = Node | Symbol | Type | Signature;
export function isCheckerSymbol(value: CheckerEntity): value is Symbol {
    return "escapedName" in value && typeof value.escapedName === "string";
}
export function isCheckerType(value: CheckerEntity): value is Type {
    return !("kind" in value) && !("escapedName" in value) && "id" in value && typeof value.id === "number" && "flags" in value;
}
export function isCheckerSignature(value: CheckerEntity): value is Signature {
    return !("kind" in value) && "parameters" in value && "minArgumentCount" in value;
}
export function isCheckerDeferredReference(value: Type): value is DeferredTypeReference {
    return isCompilerTypeReference(value) && value.node !== undefined;
}
export function isCheckerAnonymousOrDeferred(value: Type): value is AnonymousType | DeferredTypeReference {
    return isCompilerObjectType(value) && (!!(value.objectFlags & (ObjectFlags.Anonymous | ObjectFlags.Mapped | ObjectFlags.InstantiationExpressionType)) || isCheckerDeferredReference(value));
}
export function isCheckerUniqueSymbol(value: Type): value is UniqueESSymbolType {
    return !!(value.flags & TypeFlags.UniqueESSymbol);
}
export function isCheckerFreshObjectLiteral(value: Type): value is FreshObjectLiteralType {
    return isCompilerObjectType(value) && !!(value.objectFlags & ObjectFlags.FreshLiteral);
}
export function isCheckerStringOrNumberLiteral(value: Type): value is StringLiteralType | NumberLiteralType {
    return !!(value.flags & TypeFlags.StringOrNumberLiteral);
}
export function isCheckerObjectFlagsType(value: Type): value is ObjectFlagsType {
    return !!(value.flags & TypeFlags.ObjectFlagsType);
}
export function isCheckerReplaceableIndexedAccess(value: Type): value is IndexedAccessType & {objectType: TypeParameter; indexType: TypeParameter} {
    if (!(value.flags & TypeFlags.IndexedAccess) || !("objectType" in value) || !("indexType" in value)) return false;
    const objectType = value.objectType;
    const indexType = value.indexType;
    return typeof objectType === "object" && objectType !== null && "flags" in objectType && typeof objectType.flags === "number" && !!(objectType.flags & TypeFlags.TypeParameter)
        && typeof indexType === "object" && indexType !== null && "flags" in indexType && typeof indexType.flags === "number" && !!(indexType.flags & TypeFlags.TypeParameter);
}
export function checkerSymbolLinks(value: SymbolLinks | undefined): (SymbolLinks & Partial<MappedSymbolLinks & ReverseMappedSymbolLinks>) | undefined {
    return value;
}
export function isCheckerTypePredicate(value: {kind: number; parameterName: string | undefined; parameterIndex: number | undefined; type: Type | undefined}): value is TypePredicate {
    return ((value.kind === 0 || value.kind === 2) && value.parameterName === undefined && value.parameterIndex === undefined && (value.kind === 2 || value.type !== undefined)) || ((value.kind === 1 || value.kind === 3) && value.parameterName !== undefined && value.parameterIndex !== undefined && (value.kind === 3 || value.type !== undefined));
}
