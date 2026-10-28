// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/classifier2020.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { dictionaryValue } from "../checked.ts";
import { isCompilerSyntaxNode } from "../checkedTypes.ts";
import { checkedCompilerLayout } from "../checked.ts";
import { testCompilerMethod_isUnion } from "../checkedMethods.ts";
import { requireCompilerMember } from "../checked.ts";
import { testCompilerLayout } from "../checked.ts";
import { present } from "../checked.ts";
import { type BindingElement, type CancellationToken, type Classifications, type ClassifiedSpan2020, createTextSpan, Debug, type Declaration, EndOfLineState, forEachChild, getCombinedModifierFlags, getCombinedNodeFlags, getMeaningFromLocation, isBindingElement, isCallExpression, isCatchClause, isFunctionDeclaration, isIdentifier, isImportClause, isImportSpecifier, isInfinityOrNaNString, isJsxElement, isJsxExpression, isJsxSelfClosingElement, isNamespaceImport, isPropertyAccessExpression, isQualifiedName, isSourceFile, isVariableDeclaration, ModifierFlags, type NamedDeclaration, type Node, NodeFlags, type ParameterDeclaration, type Program, SemanticMeaning, type SourceFile, type Symbol, SymbolFlags, SyntaxKind, type TextSpan, textSpanIntersectsWith, type Type, type TypeChecker, type VariableDeclaration } from "./_namespaces/ts.ts";
/** @internal */
export type TokenEncodingConsts = number;
/** @internal */
export const TokenEncodingConsts: {
    readonly typeOffset: 8;
    readonly modifierMask: 255;
    [index: number]: string;
} = {
    typeOffset: 8,
    "8": "typeOffset",
    modifierMask: 255,
    "255": "modifierMask"
};
/** @internal */
export type TokenType = number;
/** @internal */
export const TokenType: {
    readonly class: 0;
    readonly enum: 1;
    readonly interface: 2;
    readonly namespace: 3;
    readonly typeParameter: 4;
    readonly type: 5;
    readonly parameter: 6;
    readonly variable: 7;
    readonly enumMember: 8;
    readonly property: 9;
    readonly function: 10;
    readonly member: 11;
    [index: number]: string;
} = {
    class: 0,
    "0": "class",
    enum: 1,
    "1": "enum",
    interface: 2,
    "2": "interface",
    namespace: 3,
    "3": "namespace",
    typeParameter: 4,
    "4": "typeParameter",
    type: 5,
    "5": "type",
    parameter: 6,
    "6": "parameter",
    variable: 7,
    "7": "variable",
    enumMember: 8,
    "8": "enumMember",
    property: 9,
    "9": "property",
    function: 10,
    "10": "function",
    member: 11,
    "11": "member"
};
/** @internal */
export type TokenModifier = number;
/** @internal */
export const TokenModifier: {
    readonly declaration: 0;
    readonly static: 1;
    readonly async: 2;
    readonly readonly: 3;
    readonly defaultLibrary: 4;
    readonly local: 5;
    [index: number]: string;
} = {
    declaration: 0,
    "0": "declaration",
    static: 1,
    "1": "static",
    async: 2,
    "2": "async",
    readonly: 3,
    "3": "readonly",
    defaultLibrary: 4,
    "4": "defaultLibrary",
    local: 5,
    "5": "local"
};
/**
 * This is mainly used internally for testing
 *
 * @internal
 */
export function getSemanticClassifications(program: Program, cancellationToken: CancellationToken, sourceFile: SourceFile, span: TextSpan): ClassifiedSpan2020[] {
    const classifications = getEncodedSemanticClassifications(program, cancellationToken, sourceFile, span);
    Debug.assert(classifications.spans.length % 3 === 0);
    const dense = classifications.spans;
    const result: ClassifiedSpan2020[] = [];
    for (let i = 0; i < dense.length; i += 3) {
        result.push({
            textSpan: createTextSpan(dense[i], dense[i + 1]),
            classificationType: dense[i + 2],
        });
    }
    return result;
}
/** @internal */
export function getEncodedSemanticClassifications(program: Program, cancellationToken: CancellationToken, sourceFile: SourceFile, span: TextSpan): Classifications {
    return {
        spans: getSemanticTokens(program, sourceFile, span, cancellationToken),
        endOfLineState: EndOfLineState.None,
    };
}
function getSemanticTokens(program: Program, sourceFile: SourceFile, span: TextSpan, cancellationToken: CancellationToken): number[] {
    const resultTokens: number[] = [];
    const collector = (node: Node, typeIdx: number, modifierSet: number) => {
        resultTokens.push(requireCompilerMember(node, "getStart").getStart(sourceFile), requireCompilerMember(node, "getWidth").getWidth(sourceFile), ((typeIdx + 1) << TokenEncodingConsts.typeOffset) + modifierSet);
    };
    if (program && sourceFile) {
        collectTokens(program, sourceFile, span, collector, cancellationToken);
    }
    return resultTokens;
}
function collectTokens(program: Program, sourceFile: SourceFile, span: TextSpan, collector: (node: Node, tokenType: number, tokenModifier: number) => void, cancellationToken: CancellationToken) {
    const typeChecker = program.getTypeChecker();
    let inJSXElement = false;
    function visit(node: Node) {
        switch (node.kind) {
            case SyntaxKind.ModuleDeclaration:
            case SyntaxKind.ClassDeclaration:
            case SyntaxKind.InterfaceDeclaration:
            case SyntaxKind.FunctionDeclaration:
            case SyntaxKind.ClassExpression:
            case SyntaxKind.FunctionExpression:
            case SyntaxKind.ArrowFunction:
                cancellationToken.throwIfCancellationRequested();
        }
        if (!node || !textSpanIntersectsWith(span, node.pos, requireCompilerMember(node, "getFullWidth").getFullWidth()) || requireCompilerMember(node, "getFullWidth").getFullWidth() === 0) {
            return;
        }
        const prevInJSXElement = inJSXElement;
        if (isJsxElement(node) || isJsxSelfClosingElement(node)) {
            inJSXElement = true;
        }
        if (isJsxExpression(node)) {
            inJSXElement = false;
        }
        if (isIdentifier(node) && !inJSXElement && !inImportClause(node) && !isInfinityOrNaNString(node.escapedText)) {
            let symbol = typeChecker.getSymbolAtLocation(node);
            if (symbol) {
                if (symbol.flags & SymbolFlags.Alias) {
                    symbol = typeChecker.getAliasedSymbol(symbol);
                }
                let typeIdx = classifySymbol(symbol, getMeaningFromLocation(node));
                if (typeIdx !== undefined) {
                    let modifierSet = 0;
                    if (node.parent) {
                        const parentIsDeclaration = isBindingElement(node.parent) || tokenFromDeclarationMapping.get(node.parent.kind) === typeIdx;
                        if (parentIsDeclaration && dictionaryValue(node.parent).name === node) {
                            modifierSet = 1 << TokenModifier.declaration;
                        }
                    }
                    // property declaration in constructor
                    if (typeIdx === TokenType.parameter && isRightSideOfQualifiedNameOrPropertyAccess(node)) {
                        typeIdx = TokenType.property;
                    }
                    typeIdx = reclassifyByType(typeChecker, node, typeIdx);
                    const decl = symbol.valueDeclaration;
                    if (decl) {
                        const modifiers = getCombinedModifierFlags(decl);
                        const nodeFlags = getCombinedNodeFlags(decl);
                        if (modifiers & ModifierFlags.Static) {
                            modifierSet |= 1 << TokenModifier.static;
                        }
                        if (modifiers & ModifierFlags.Async) {
                            modifierSet |= 1 << TokenModifier.async;
                        }
                        if (typeIdx !== TokenType.class && typeIdx !== TokenType.interface) {
                            if ((modifiers & ModifierFlags.Readonly) || (nodeFlags & NodeFlags.Const) || (requireCompilerMember(symbol, "getFlags").getFlags() & SymbolFlags.EnumMember)) {
                                modifierSet |= 1 << TokenModifier.readonly;
                            }
                        }
                        if ((typeIdx === TokenType.variable || typeIdx === TokenType.function) && isLocalDeclaration(decl, sourceFile)) {
                            modifierSet |= 1 << TokenModifier.local;
                        }
                        if (program.isSourceFileDefaultLibrary(requireCompilerMember(decl, "getSourceFile").getSourceFile())) {
                            modifierSet |= 1 << TokenModifier.defaultLibrary;
                        }
                    }
                    else if (symbol.declarations && symbol.declarations.some(d => program.isSourceFileDefaultLibrary(requireCompilerMember(d, "getSourceFile").getSourceFile()))) {
                        modifierSet |= 1 << TokenModifier.defaultLibrary;
                    }
                    collector(node, typeIdx, modifierSet);
                }
            }
        }
        forEachChild(node, visit);
        inJSXElement = prevInJSXElement;
    }
    visit(sourceFile);
}
function classifySymbol(symbol: Symbol, meaning: SemanticMeaning): TokenType | undefined {
    const flags = requireCompilerMember(symbol, "getFlags").getFlags();
    if (flags & SymbolFlags.Class) {
        return TokenType.class;
    }
    else if (flags & SymbolFlags.Enum) {
        return TokenType.enum;
    }
    else if (flags & SymbolFlags.TypeAlias) {
        return TokenType.type;
    }
    else if (flags & SymbolFlags.Interface) {
        if (meaning & SemanticMeaning.Type) {
            return TokenType.interface;
        }
    }
    else if (flags & SymbolFlags.TypeParameter) {
        return TokenType.typeParameter;
    }
    let decl = symbol.valueDeclaration || symbol.declarations && symbol.declarations[0];
    if (decl && isBindingElement(decl)) {
        decl = getDeclarationForBindingElement(decl);
    }
    return decl && tokenFromDeclarationMapping.get(decl.kind);
}
function reclassifyByType(typeChecker: TypeChecker, node: Node, typeIdx: TokenType): TokenType {
    // type based classifications
    if (typeIdx === TokenType.variable || typeIdx === TokenType.property || typeIdx === TokenType.parameter) {
        const type = typeChecker.getTypeAtLocation(node);
        if (type) {
            const test = (condition: (type: Type) => boolean) => {
                return condition(type) || testCompilerMethod_isUnion(type) && type.types.some(condition);
            };
            if (typeIdx !== TokenType.parameter && test(t => requireCompilerMember(t, "getConstructSignatures").getConstructSignatures().length > 0)) {
                return TokenType.class;
            }
            if (test(t => requireCompilerMember(t, "getCallSignatures").getCallSignatures().length > 0) && !test(t => requireCompilerMember(t, "getProperties").getProperties().length > 0) || isExpressionInCallExpression(node)) {
                return typeIdx === TokenType.property ? TokenType.member : TokenType.function;
            }
        }
    }
    return typeIdx;
}
function isLocalDeclaration(decl: Declaration, sourceFile: SourceFile): boolean {
    if (isBindingElement(decl)) {
        decl = getDeclarationForBindingElement(decl);
    }
    if (isVariableDeclaration(decl)) {
        return (!testCompilerLayout(decl.parent.parent.parent, isSourceFile) || isCatchClause(decl.parent)) && requireCompilerMember(decl, "getSourceFile").getSourceFile() === sourceFile;
    }
    else if (isFunctionDeclaration(decl)) {
        return !testCompilerLayout(decl.parent, isSourceFile) && requireCompilerMember(decl, "getSourceFile").getSourceFile() === sourceFile;
    }
    return false;
}
function getDeclarationForBindingElement(element: BindingElement): VariableDeclaration | ParameterDeclaration {
    while (true) {
        if (isBindingElement(element.parent.parent)) {
            element = element.parent.parent;
        }
        else {
            return element.parent.parent;
        }
    }
}
function inImportClause(node: Node): boolean | undefined {
    const parent = node.parent;
    return parent && (isImportClause(parent) || isImportSpecifier(parent) || isNamespaceImport(parent));
}
function isExpressionInCallExpression(node: Node): boolean {
    while (isRightSideOfQualifiedNameOrPropertyAccess(node)) {
        node = (checkedCompilerLayout(node.parent, isCompilerSyntaxNode))!;
    }
    return testCompilerLayout(node.parent, isCallExpression) && node.parent.expression === node;
}
function isRightSideOfQualifiedNameOrPropertyAccess(node: Node): boolean {
    return (testCompilerLayout(node.parent, isQualifiedName) && node.parent.right === node) || (testCompilerLayout(node.parent, isPropertyAccessExpression) && node.parent.name === node);
}
const tokenFromDeclarationMapping = new Map<SyntaxKind, TokenType>([
    [SyntaxKind.VariableDeclaration, TokenType.variable],
    [SyntaxKind.Parameter, TokenType.parameter],
    [SyntaxKind.PropertyDeclaration, TokenType.property],
    [SyntaxKind.ModuleDeclaration, TokenType.namespace],
    [SyntaxKind.EnumDeclaration, TokenType.enum],
    [SyntaxKind.EnumMember, TokenType.enumMember],
    [SyntaxKind.ClassDeclaration, TokenType.class],
    [SyntaxKind.MethodDeclaration, TokenType.member],
    [SyntaxKind.FunctionDeclaration, TokenType.function],
    [SyntaxKind.FunctionExpression, TokenType.function],
    [SyntaxKind.MethodSignature, TokenType.member],
    [SyntaxKind.GetAccessor, TokenType.property],
    [SyntaxKind.SetAccessor, TokenType.property],
    [SyntaxKind.PropertySignature, TokenType.property],
    [SyntaxKind.InterfaceDeclaration, TokenType.interface],
    [SyntaxKind.TypeAliasDeclaration, TokenType.type],
    [SyntaxKind.TypeParameter, TokenType.typeParameter],
    [SyntaxKind.PropertyAssignment, TokenType.property],
    [SyntaxKind.ShorthandPropertyAssignment, TokenType.property],
]);
