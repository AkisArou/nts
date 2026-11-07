// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/convertTypedefToType.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { TypeNode } from "../../compiler/types.ts";
import type { JSDocThisTag, EntityName } from "../../compiler/types.ts";
import { requireCompilerMember } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, flatMap, getNewLineOrDefaultFromHost, getSynthesizedDeepClone, getTokenAtPosition, hasJSDocNodes, type InterfaceDeclaration, isJSDocTypedefTag, isJSDocTypeLiteral, type JSDoc, type JSDocPropertyLikeTag, type JSDocTag, type JSDocTypedefTag, type JSDocTypeExpression, type JSDocTypeLiteral, mapDefined, type Node, type PropertySignature, some, type SourceFile, SyntaxKind, textChanges, type TypeAliasDeclaration } from "../_namespaces/ts.ts";
const fixId = "convertTypedefToType";
const errorCodes = [Diagnostics.JSDoc_typedef_may_be_converted_to_TypeScript_type.code];
registerCodeFix({
    fixIds: [fixId],
    errorCodes,
    getCodeActions(context) {
        const newLineCharacter = getNewLineOrDefaultFromHost(context.host, context.formatContext.options);
        const node = getTokenAtPosition(context.sourceFile, context.span.start);
        if (!node)
            return;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, node, context.sourceFile, newLineCharacter));
        if (changes.length > 0) {
            return [
                createCodeFixAction(fixId, changes, Diagnostics.Convert_typedef_to_TypeScript_type, fixId, Diagnostics.Convert_all_typedef_to_TypeScript_types),
            ];
        }
    },
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const newLineCharacter = getNewLineOrDefaultFromHost(context.host, context.formatContext.options);
        const node = getTokenAtPosition(diag.file, diag.start);
        const fixAll = true;
        if (node)
            doChange(changes, node, diag.file, newLineCharacter, fixAll);
    }),
});
function doChange(changes: textChanges.ChangeTracker, node: Node, sourceFile: SourceFile, newLine: string, fixAll = false) {
    if (!isJSDocTypedefTag(node))
        return;
    const declaration = createDeclaration(node);
    if (!declaration)
        return;
    const commentNode = node.parent;
    const { leftSibling, rightSibling } = getLeftAndRightSiblings(node);
    let pos = requireCompilerMember(commentNode, "getStart").getStart();
    let prefix = "";
    // the first @typedef is the comment block with a text comment above
    if (!leftSibling && commentNode.comment) {
        pos = findEndOfTextBetween(commentNode, requireCompilerMember(commentNode, "getStart").getStart(), requireCompilerMember(node, "getStart").getStart());
        prefix = `${newLine} */${newLine}`;
    }
    if (leftSibling) {
        if (fixAll && isJSDocTypedefTag(leftSibling)) {
            // Don't need to keep empty comment clock between created interfaces
            pos = requireCompilerMember(node, "getStart").getStart();
            prefix = "";
        }
        else {
            pos = findEndOfTextBetween(commentNode, requireCompilerMember(leftSibling, "getStart").getStart(), requireCompilerMember(node, "getStart").getStart());
            prefix = `${newLine} */${newLine}`;
        }
    }
    let end = requireCompilerMember(commentNode, "getEnd").getEnd();
    let suffix = "";
    if (rightSibling) {
        if (fixAll && isJSDocTypedefTag(rightSibling)) {
            // Don't need to keep empty comment clock between created interfaces
            end = requireCompilerMember(rightSibling, "getStart").getStart();
            suffix = `${newLine}${newLine}`;
        }
        else {
            end = requireCompilerMember(rightSibling, "getStart").getStart();
            suffix = `${newLine}/**${newLine} * `;
        }
    }
    changes.replaceRange(sourceFile, { pos, end }, declaration, { prefix, suffix });
}
function getLeftAndRightSiblings(typedefNode: JSDocTypedefTag): {
    leftSibling?: Node;
    rightSibling?: Node;
} {
    const commentNode = typedefNode.parent;
    const maxChildIndex = requireCompilerMember(commentNode, "getChildCount").getChildCount() - 1;
    const currentNodeIndex = requireCompilerMember(commentNode, "getChildren").getChildren().findIndex(n => requireCompilerMember(n, "getStart").getStart() === requireCompilerMember(typedefNode, "getStart").getStart() && requireCompilerMember(n, "getEnd").getEnd() === requireCompilerMember(typedefNode, "getEnd").getEnd());
    const leftSibling = currentNodeIndex > 0 ? requireCompilerMember(commentNode, "getChildAt").getChildAt(currentNodeIndex - 1) : undefined;
    const rightSibling = currentNodeIndex < maxChildIndex ? requireCompilerMember(commentNode, "getChildAt").getChildAt(currentNodeIndex + 1) : undefined;
    return { leftSibling, rightSibling };
}
/**
 * Finds the index of the last meaningful symbol (except empty spaces, * and /) in the comment
 * between start and end positions
 */
function findEndOfTextBetween(jsDocComment: JSDoc, from: number, to: number): number {
    const comment = requireCompilerMember(jsDocComment, "getText").getText().substring(from - requireCompilerMember(jsDocComment, "getStart").getStart(), to - requireCompilerMember(jsDocComment, "getStart").getStart());
    for (let i = comment.length; i > 0; i--) {
        if (!/[*/\s]/.test(comment.substring(i - 1, i))) {
            return from + i;
        }
    }
    return to;
}
function createDeclaration(tag: JSDocTypedefTag): InterfaceDeclaration | TypeAliasDeclaration | undefined {
    const { typeExpression } = tag;
    if (!typeExpression)
        return;
    const typeName = tag.name?.getText!();
    if (!typeName)
        return;
    // For use case @typedef {object}Foo @property{bar}number
    // But object type can be nested, meaning the value in the k/v pair can be the object itself
    if (typeExpression.kind === SyntaxKind.JSDocTypeLiteral) {
        return createInterfaceForTypeLiteral(typeName, typeExpression);
    }
    // for use case @typedef {(number|string|undefined)} Foo or @typedef {number|string|undefined} Foo
    // In this case, we reach the leaf node of AST.
    if (typeExpression.kind === SyntaxKind.JSDocTypeExpression) {
        return createTypeAliasForTypeExpression(typeName, typeExpression);
    }
}
function createInterfaceForTypeLiteral(typeName: string, typeLiteral: JSDocTypeLiteral): InterfaceDeclaration | undefined {
    const propertySignatures = createSignatureFromTypeLiteral(typeLiteral);
    if (!some(propertySignatures))
        return;
    return factory.createInterfaceDeclaration(
    /*modifiers*/ undefined, typeName, 
    /*typeParameters*/ undefined, 
    /*heritageClauses*/ undefined, propertySignatures);
}
function createTypeAliasForTypeExpression(typeName: string, typeExpression: JSDocTypeExpression): TypeAliasDeclaration | undefined {
    const typeReference = getSynthesizedDeepClone(typeExpression.type);
    if (!typeReference)
        return;
    return factory.createTypeAliasDeclaration(
    /*modifiers*/ undefined, factory.createIdentifier(typeName), 
    /*typeParameters*/ undefined, typeReference);
}
function createSignatureFromTypeLiteral(typeLiteral: JSDocTypeLiteral): PropertySignature[] | undefined {
    const propertyTags = typeLiteral.jsDocPropertyTags;
    if (!some(propertyTags))
        return;
    const getSignature = (tag: (JSDocPropertyLikeTag | JSDocThisTag) & { name?: EntityName; isBracketed?: boolean }) => {
        const name = getPropertyName(tag);
        const type = tag.typeExpression?.type;
        const isOptional = tag.isBracketed;
        let typeReference: TypeNode | undefined;
        // Recursively handle nested object type
        if (type && isJSDocTypeLiteral(type)) {
            const signatures = createSignatureFromTypeLiteral(type);
            typeReference = factory.createTypeLiteralNode(signatures);
        }
        // Leaf node, where type.kind === SyntaxKind.JSDocTypeExpression
        else if (type) {
            typeReference = getSynthesizedDeepClone(type);
        }
        if (typeReference && name) {
            const questionToken = isOptional ? factory.createToken(SyntaxKind.QuestionToken) : undefined;
            return factory.createPropertySignature(
            /*modifiers*/ undefined, name, questionToken, typeReference);
        }
    };
    return mapDefined(propertyTags, getSignature);
}
function getPropertyName(tag: (JSDocPropertyLikeTag | JSDocThisTag) & { name?: EntityName }): string | undefined {
    return tag.name!.kind === SyntaxKind.Identifier ? tag.name!.text : tag.name!.right.text;
}
/** @internal */
export function getJSDocTypedefNodes(node: Node): readonly JSDocTag[] {
    if (hasJSDocNodes(node)) {
        return flatMap(node.jsDoc, doc => doc.tags?.filter(tag => isJSDocTypedefTag(tag)));
    }
    return [];
}
