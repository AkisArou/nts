// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/annotateWithTypeFromJSDoc.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { JSDocPropertyLikeTag, JSDocThisTag, EntityName } from "../../compiler/types.ts";
import { testCompilerLayout } from "../../checked.ts";
import { checkedCompilerLayout, present } from "../../checked.ts";
import { isJSDocOptionalType as checked_isJSDocOptionalType } from "../../compiler/factory/nodeTests.ts";
import { isJSDocNonNullableType as checked_isJSDocNonNullableType } from "../../compiler/factory/nodeTests.ts";
import { isJSDocNullableType as checked_isJSDocNullableType } from "../../compiler/factory/nodeTests.ts";
import { isJSDocVariadicType as checked_isJSDocVariadicType } from "../../compiler/factory/nodeTests.ts";
import { isJSDocFunctionType as checked_isJSDocFunctionType } from "../../compiler/factory/nodeTests.ts";
import { isTypeReferenceNode as checked_isTypeReferenceNode } from "../../compiler/factory/nodeTests.ts";
import { isJSDocTypeLiteral as checked_isJSDocTypeLiteral } from "../../compiler/factory/nodeTests.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Debug, Diagnostics, EmitFlags, emptyArray, factory, findChildOfKind, first, type FunctionLikeDeclaration, getJSDocReturnType, getJSDocType, getJSDocTypeParameterDeclarations, getTokenAtPosition, isArrowFunction, isFunctionLikeDeclaration, isIdentifier, isJSDocIndexSignature, isOptionalJSDocPropertyLikeTag, isParameter, isTypeNode, type JSDocFunctionType, type JSDocNonNullableType, type JSDocNullableType, type JSDocOptionalType, type JSDocTypeLiteral, type JSDocVariadicType, last, map, type Node, type ParameterDeclaration, type PropertyDeclaration, type PropertySignature, setEmitFlags, type SourceFile, SyntaxKind, textChanges, tryCast, type TypeReferenceNode, type VariableDeclaration, visitEachChild, visitNode, visitNodes } from "../_namespaces/ts.ts";
const fixId = "annotateWithTypeFromJSDoc";
const errorCodes = [Diagnostics.JSDoc_types_may_be_moved_to_TypeScript_types.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const decl = getDeclaration(context.sourceFile, context.span.start);
        if (!decl)
            return;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, decl));
        return [createCodeFixAction(fixId, changes, Diagnostics.Annotate_with_type_from_JSDoc, fixId, Diagnostics.Annotate_everything_with_types_from_JSDoc)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const decl = getDeclaration(diag.file, diag.start);
        if (decl)
            doChange(changes, diag.file, decl);
    }),
});
function getDeclaration(file: SourceFile, pos: number): DeclarationWithType | undefined {
    const name = getTokenAtPosition(file, pos);
    // For an arrow function with no name, 'name' lands on the first parameter.
    return tryCast(testCompilerLayout(name.parent, isParameter) ? name.parent.parent : name.parent, parameterShouldGetTypeFromJSDoc);
}
/** @internal */
export type DeclarationWithType = FunctionLikeDeclaration | VariableDeclaration | PropertySignature | PropertyDeclaration;
/** @internal */
export function parameterShouldGetTypeFromJSDoc(node: Node): node is DeclarationWithType {
    return isDeclarationWithType(node) && hasUsableJSDoc(node);
}
function hasUsableJSDoc(decl: DeclarationWithType | ParameterDeclaration): boolean {
    return isFunctionLikeDeclaration(decl)
        ? decl.parameters.some(hasUsableJSDoc) || (!decl.type && !!getJSDocReturnType(decl))
        : !decl.type && !!getJSDocType(decl);
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, decl: DeclarationWithType): void {
    if (isFunctionLikeDeclaration(decl) && (getJSDocReturnType(decl) || decl.parameters.some(p => !!getJSDocType(p)))) {
        if (!decl.typeParameters) {
            const typeParameters = getJSDocTypeParameterDeclarations(decl);
            if (typeParameters.length)
                changes.insertTypeParameters(sourceFile, decl, typeParameters);
        }
        const needParens = isArrowFunction(decl) && !findChildOfKind(decl, SyntaxKind.OpenParenToken, sourceFile);
        if (needParens)
            changes.insertNodeBefore(sourceFile, first(decl.parameters), factory.createToken(SyntaxKind.OpenParenToken));
        for (const param of decl.parameters) {
            if (!param.type) {
                const paramType = getJSDocType(param);
                if (paramType)
                    changes.tryInsertTypeAnnotation(sourceFile, param, visitNode(paramType, transformJSDocType, isTypeNode));
            }
        }
        if (needParens)
            changes.insertNodeAfter(sourceFile, last(decl.parameters), factory.createToken(SyntaxKind.CloseParenToken));
        if (!decl.type) {
            const returnType = getJSDocReturnType(decl);
            if (returnType)
                changes.tryInsertTypeAnnotation(sourceFile, decl, visitNode(returnType, transformJSDocType, isTypeNode));
        }
    }
    else {
        const jsdocType = Debug.checkDefined(getJSDocType(decl), "A JSDocType for this declaration should exist"); // If not defined, shouldn't have been an error to fix
        Debug.assert(!decl.type, "The JSDocType decl should have a type"); // If defined, shouldn't have been an error to fix.
        changes.tryInsertTypeAnnotation(sourceFile, decl, visitNode(jsdocType, transformJSDocType, isTypeNode));
    }
}
function isDeclarationWithType(node: Node): node is DeclarationWithType {
    return isFunctionLikeDeclaration(node) ||
        node.kind === SyntaxKind.VariableDeclaration ||
        node.kind === SyntaxKind.PropertySignature ||
        node.kind === SyntaxKind.PropertyDeclaration;
}
function transformJSDocType(node: Node): Node {
    switch (node.kind) {
        case SyntaxKind.JSDocAllType:
        case SyntaxKind.JSDocUnknownType:
            return factory.createTypeReferenceNode("any", emptyArray);
        case SyntaxKind.JSDocOptionalType:
            return transformJSDocOptionalType(checkedCompilerLayout(node, checked_isJSDocOptionalType));
        case SyntaxKind.JSDocNonNullableType:
            return transformJSDocType((checkedCompilerLayout(node, checked_isJSDocNonNullableType)).type);
        case SyntaxKind.JSDocNullableType:
            return transformJSDocNullableType(checkedCompilerLayout(node, checked_isJSDocNullableType));
        case SyntaxKind.JSDocVariadicType:
            return transformJSDocVariadicType(checkedCompilerLayout(node, checked_isJSDocVariadicType));
        case SyntaxKind.JSDocFunctionType:
            return transformJSDocFunctionType(checkedCompilerLayout(node, checked_isJSDocFunctionType));
        case SyntaxKind.TypeReference:
            return transformJSDocTypeReference(checkedCompilerLayout(node, checked_isTypeReferenceNode));
        case SyntaxKind.JSDocTypeLiteral:
            return transformJSDocTypeLiteral(checkedCompilerLayout(node, checked_isJSDocTypeLiteral));
        default:
            const visited = visitEachChild(node, transformJSDocType, /*context*/ undefined);
            setEmitFlags(visited, EmitFlags.SingleLine);
            return visited;
    }
}
function transformJSDocTypeLiteral(node: JSDocTypeLiteral) {
    const typeNode = factory.createTypeLiteralNode(map(node.jsDocPropertyTags, (tag: (JSDocPropertyLikeTag | JSDocThisTag) & { name?: EntityName }) => factory.createPropertySignature(
    /*modifiers*/ undefined, isIdentifier(tag.name!) ? tag.name! : tag.name!.right, isOptionalJSDocPropertyLikeTag(tag) ? factory.createToken(SyntaxKind.QuestionToken) : undefined, tag.typeExpression && visitNode(tag.typeExpression.type, transformJSDocType, isTypeNode) || factory.createKeywordTypeNode(SyntaxKind.AnyKeyword))));
    setEmitFlags(typeNode, EmitFlags.SingleLine);
    return typeNode;
}
function transformJSDocOptionalType(node: JSDocOptionalType) {
    return factory.createUnionTypeNode([visitNode(node.type, transformJSDocType, isTypeNode), factory.createTypeReferenceNode("undefined", emptyArray)]);
}
function transformJSDocNullableType(node: JSDocNullableType) {
    return factory.createUnionTypeNode([visitNode(node.type, transformJSDocType, isTypeNode), factory.createTypeReferenceNode("null", emptyArray)]);
}
function transformJSDocVariadicType(node: JSDocVariadicType) {
    return factory.createArrayTypeNode(visitNode(node.type, transformJSDocType, isTypeNode));
}
function transformJSDocFunctionType(node: JSDocFunctionType) {
    // TODO: This does not properly handle `function(new:C, string)` per https://github.com/google/closure-compiler/wiki/Types-in-the-Closure-Type-System#the-javascript-type-language
    //       however we do handle it correctly in `serializeTypeForDeclaration` in checker.ts
    return factory.createFunctionTypeNode(emptyArray, node.parameters.map(transformJSDocParameter), node.type ?? factory.createKeywordTypeNode(SyntaxKind.AnyKeyword));
}
function transformJSDocParameter(node: ParameterDeclaration) {
    const index = node.parent.parameters.indexOf(node);
    const isRest = (node.type)!.kind === SyntaxKind.JSDocVariadicType && index === node.parent.parameters.length - 1; // TODO: GH#18217
    const name = node.name || (isRest ? "rest" : "arg" + index);
    const dotdotdot = isRest ? factory.createToken(SyntaxKind.DotDotDotToken) : node.dotDotDotToken;
    return factory.createParameterDeclaration(node.modifiers, dotdotdot, name, node.questionToken, visitNode(node.type, transformJSDocType, isTypeNode), node.initializer);
}
function transformJSDocTypeReference(node: TypeReferenceNode) {
    let name = node.typeName;
    let args = node.typeArguments;
    if (isIdentifier(node.typeName)) {
        if (isJSDocIndexSignature(node)) {
            return transformJSDocIndexSignature(node);
        }
        let text = node.typeName.text;
        switch (node.typeName.text) {
            case "String":
            case "Boolean":
            case "Object":
            case "Number":
                text = (text)!.toLowerCase();
                break;
            case "array":
            case "date":
            case "promise":
                text = (text)![0].toUpperCase() + (text)!.slice(1);
                break;
        }
        name = factory.createIdentifier((text)!);
        if ((text === "Array" || text === "Promise") && !node.typeArguments) {
            args = factory.createNodeArray([factory.createTypeReferenceNode("any", emptyArray)]);
        }
        else {
            args = visitNodes(node.typeArguments, transformJSDocType, isTypeNode);
        }
    }
    return factory.createTypeReferenceNode(name, args);
}
function transformJSDocIndexSignature(node: TypeReferenceNode) {
    const index = factory.createParameterDeclaration(
    /*modifiers*/ undefined, 
    /*dotDotDotToken*/ undefined, (node.typeArguments)![0].kind === SyntaxKind.NumberKeyword ? "n" : "s", 
    /*questionToken*/ undefined, factory.createTypeReferenceNode((node.typeArguments)![0].kind === SyntaxKind.NumberKeyword ? "number" : "string", []), 
    /*initializer*/ undefined);
    const indexSignature = factory.createTypeLiteralNode([factory.createIndexSignature(/*modifiers*/ undefined, [index], (node.typeArguments)![1])]);
    setEmitFlags(indexSignature, EmitFlags.SingleLine);
    return indexSignature;
}
