// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Preserve service-method dispatch and receiver narrowing.
import type { Type, UnionType, IntersectionType, UnionOrIntersectionType, LiteralType, StringLiteralType, NumberLiteralType, TypeParameter, InterfaceType, IndexType } from "./compiler/types.ts";
import { requireCompilerMember } from "./checked.ts";

export function testCompilerMethod_isUnion(value: Type): value is UnionType {
    return requireCompilerMember(value, "isUnion").isUnion();
}

export function testCompilerMethod_isIntersection(value: Type): value is IntersectionType {
    return requireCompilerMember(value, "isIntersection").isIntersection();
}

export function testCompilerMethod_isUnionOrIntersection(value: Type): value is UnionOrIntersectionType {
    return requireCompilerMember(value, "isUnionOrIntersection").isUnionOrIntersection();
}

export function testCompilerMethod_isLiteral(value: Type): value is LiteralType {
    return requireCompilerMember(value, "isLiteral").isLiteral();
}

export function testCompilerMethod_isStringLiteral(value: Type): value is StringLiteralType {
    return requireCompilerMember(value, "isStringLiteral").isStringLiteral();
}

export function testCompilerMethod_isNumberLiteral(value: Type): value is NumberLiteralType {
    return requireCompilerMember(value, "isNumberLiteral").isNumberLiteral();
}

export function testCompilerMethod_isTypeParameter(value: Type): value is TypeParameter {
    return requireCompilerMember(value, "isTypeParameter").isTypeParameter();
}

export function testCompilerMethod_isClassOrInterface(value: Type): value is InterfaceType {
    return requireCompilerMember(value, "isClassOrInterface").isClassOrInterface();
}

export function testCompilerMethod_isClass(value: Type): value is InterfaceType {
    return requireCompilerMember(value, "isClass").isClass();
}

export function testCompilerMethod_isIndexType(value: Type): value is IndexType {
    return requireCompilerMember(value, "isIndexType").isIndexType();
}
