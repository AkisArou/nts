// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Concrete views used by the original compiler utility branches.
import { isCompilerSyntaxNode } from "../checkedTypes.ts";
import { isTypeParameterDeclaration } from "./factory/nodeTests.ts";
import { SyntaxKind, TypeFlags, type Node, type ObjectLiteralExpression, type JsxAttributes, type TypeParameterDeclaration, type ObjectFlagsType, type Type, type StringLiteralType, type NumberLiteralType, type UniqueESSymbolType } from "./types.ts";
import type { StrictOptionName } from "./utilities.ts";

function isTypeParameters(value: unknown): value is readonly TypeParameterDeclaration[] {
    return Array.isArray(value) && value.every((entry: unknown) => isCompilerSyntaxNode(entry) && isTypeParameterDeclaration(entry));
}
export function checkedTypeParameters(value: unknown): readonly TypeParameterDeclaration[] | undefined {
    if (value === undefined || isTypeParameters(value)) return value;
    throw new TypeError("Expected compiler type parameters");
}
export function checkedStrictOptionName(value: string): StrictOptionName {
    switch (value) {
        case "noImplicitAny": case "noImplicitThis": case "strictNullChecks":
        case "strictFunctionTypes": case "strictBindCallApply": case "strictPropertyInitialization":
        case "strictBuiltinIteratorReturn": case "alwaysStrict": case "useUnknownInCatchVariables": return value;
        default: throw new TypeError("Expected strict compiler option name");
    }
}
export function isUtilitiesObjectFlagsType(value: Type): value is ObjectFlagsType {
    return !!(value.flags & TypeFlags.ObjectFlagsType);
}
export function isUtilitiesUniqueSymbolType(value: Type): value is UniqueESSymbolType {
    return !!(value.flags & TypeFlags.UniqueESSymbol);
}
export function isUtilitiesStringOrNumberLiteralType(value: Type): value is StringLiteralType | NumberLiteralType {
    return !!(value.flags & TypeFlags.StringOrNumberLiteral);
}
export function isUtilitiesPropertyContainer(value: Node): value is ObjectLiteralExpression | JsxAttributes {
    return value.kind === SyntaxKind.ObjectLiteralExpression || value.kind === SyntaxKind.JsxAttributes;
}

// The kind comparison in getDeclaration(s)OfKind establishes these finite layouts.
import type * as Layout from "./types.ts";
export interface DeclarationKindLayouts {
    [SyntaxKind.SourceFile]: Layout.SourceFile;
    [SyntaxKind.TypeParameter]: Layout.TypeParameterDeclaration;
    [SyntaxKind.Parameter]: Layout.ParameterDeclaration;
    [SyntaxKind.PropertyDeclaration]: Layout.PropertyDeclaration;
    [SyntaxKind.GetAccessor]: Layout.GetAccessorDeclaration;
    [SyntaxKind.SetAccessor]: Layout.SetAccessorDeclaration;
    [SyntaxKind.ModuleDeclaration]: Layout.ModuleDeclaration;
    [SyntaxKind.InterfaceDeclaration]: Layout.InterfaceDeclaration;
    [SyntaxKind.ImportSpecifier]: Layout.ImportSpecifier;
    [SyntaxKind.ExportSpecifier]: Layout.ExportSpecifier;
    [SyntaxKind.BindingElement]: Layout.BindingElement;
    [SyntaxKind.ClassDeclaration]: Layout.ClassDeclaration;
    [SyntaxKind.ClassExpression]: Layout.ClassExpression;
    [SyntaxKind.EnumMember]: Layout.EnumMember;
    [SyntaxKind.NamespaceExport]: Layout.NamespaceExport;
    [SyntaxKind.TypeAliasDeclaration]: Layout.TypeAliasDeclaration;
    [SyntaxKind.JSDocParameterTag]: Layout.JSDocParameterTag;
}
export type DeclarationByKind<K extends Layout.SyntaxKind> = K extends keyof DeclarationKindLayouts ? DeclarationKindLayouts[K] : Layout.Declaration;

function isDeclarationNameValue(value: unknown): value is Layout.DeclarationName {
    if (!isCompilerSyntaxNode(value)) return false;
    switch (value.kind) {
        case SyntaxKind.Identifier: case SyntaxKind.PrivateIdentifier: case SyntaxKind.StringLiteral:
        case SyntaxKind.NoSubstitutionTemplateLiteral: case SyntaxKind.NumericLiteral: case SyntaxKind.BigIntLiteral:
        case SyntaxKind.ComputedPropertyName: case SyntaxKind.JsxNamespacedName: case SyntaxKind.ElementAccessExpression:
        case SyntaxKind.ObjectBindingPattern: case SyntaxKind.ArrayBindingPattern: case SyntaxKind.PropertyAccessExpression: return true;
        default: return false;
    }
}
export function checkedDeclarationName(value: unknown): Layout.DeclarationName | undefined {
    if (value === undefined || isDeclarationNameValue(value)) return value;
    throw new TypeError("Expected compiler declaration name");
}
