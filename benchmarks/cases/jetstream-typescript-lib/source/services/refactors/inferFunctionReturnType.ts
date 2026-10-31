// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/refactors/inferFunctionReturnType.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { isNodeLayout_b74b1ef9bfcc, isNodeLayout_9bb832a7697a } from "../../checkedLayouts.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { type ApplicableRefactorInfo, type ArrowFunction, Diagnostics, emptyArray, factory, findAncestor, findChildOfKind, first, type FunctionDeclaration, type FunctionExpression, getLocaleSpecificMessage, getTouchingPropertyName, InternalNodeBuilderFlags, isArrowFunction, isBlock, isInJSFile, mapDefined, type MethodDeclaration, type Node, NodeBuilderFlags, type RefactorContext, type RefactorEditInfo, type SourceFile, SyntaxKind, textChanges, type Type, type TypeNode } from "../_namespaces/ts.ts";
import { isRefactorErrorInfo, type RefactorErrorInfo, refactorKindBeginsWith, registerRefactor } from "../_namespaces/ts.refactor.ts";
const refactorName = "Infer function return type";
const refactorDescription = getLocaleSpecificMessage(Diagnostics.Infer_function_return_type);
const inferReturnTypeAction = {
    name: refactorName,
    description: refactorDescription,
    kind: "refactor.rewrite.function.returnType",
};
registerRefactor(refactorName, {
    kinds: [inferReturnTypeAction.kind],
    getEditsForAction: getRefactorEditsToInferReturnType,
    getAvailableActions: getRefactorActionsToInferReturnType,
});
function getRefactorEditsToInferReturnType(context: RefactorContext): RefactorEditInfo | undefined {
    const info = getInfo(context);
    if (info && !isRefactorErrorInfo(info)) {
        const edits = textChanges.ChangeTracker.with(context, t => doChange(context.file, t, info.declaration, info.returnTypeNode));
        return { renameFilename: undefined, renameLocation: undefined, edits };
    }
    return undefined;
}
function getRefactorActionsToInferReturnType(context: RefactorContext): readonly ApplicableRefactorInfo[] {
    const info = getInfo(context);
    if (!info)
        return emptyArray;
    if (!isRefactorErrorInfo(info)) {
        return [{
                name: refactorName,
                description: refactorDescription,
                actions: [inferReturnTypeAction],
            }];
    }
    if (context.preferences.provideRefactorNotApplicableReason) {
        return [{
                name: refactorName,
                description: refactorDescription,
                actions: [{ ...inferReturnTypeAction, notApplicableReason: info.error }],
            }];
    }
    return emptyArray;
}
type ConvertibleDeclaration = FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration;
interface FunctionInfo {
    declaration: ConvertibleDeclaration;
    returnTypeNode: TypeNode;
}
function doChange(sourceFile: SourceFile, changes: textChanges.ChangeTracker, declaration: ConvertibleDeclaration, typeNode: TypeNode) {
    const closeParen = findChildOfKind(declaration, SyntaxKind.CloseParenToken, sourceFile);
    const needParens = isArrowFunction(declaration) && closeParen === undefined;
    const endNode = needParens ? first(declaration.parameters) : closeParen;
    if (endNode) {
        if (needParens) {
            changes.insertNodeBefore(sourceFile, endNode, factory.createToken(SyntaxKind.OpenParenToken));
            changes.insertNodeAfter(sourceFile, endNode, factory.createToken(SyntaxKind.CloseParenToken));
        }
        changes.insertNodeAt(sourceFile, endNode.end, typeNode, { prefix: ": " });
    }
}
function getInfo(context: RefactorContext): FunctionInfo | RefactorErrorInfo | undefined {
    if (isInJSFile(context.file) || !refactorKindBeginsWith(inferReturnTypeAction.kind, context.kind))
        return;
    const token = getTouchingPropertyName(context.file, context.startPosition);
    const declaration = checkedCompilerLayout(findAncestor(token, n => isBlock(n) || n.parent && isArrowFunction(n.parent) && (n.kind === SyntaxKind.EqualsGreaterThanToken || n.parent.body === n) ? "quit" :
        isConvertibleDeclaration(n)), isConvertibleDeclaration);
    if (!declaration || !declaration.body || declaration.type) {
        return { error: getLocaleSpecificMessage(Diagnostics.Return_type_must_be_inferred_from_a_function) };
    }
    const typeChecker = context.program.getTypeChecker();
    let returnType: Type | undefined;
    if (typeChecker.isImplementationOfOverload(checkedCompilerLayout(declaration, isNodeLayout_b74b1ef9bfcc))) {
        const signatures = requireCompilerMember(typeChecker.getTypeAtLocation(declaration), "getCallSignatures").getCallSignatures();
        if (signatures.length > 1) {
            returnType = typeChecker.getUnionType(mapDefined(signatures, s => requireCompilerMember(s, "getReturnType").getReturnType()));
        }
    }
    if (!returnType) {
        const signature = typeChecker.getSignatureFromDeclaration(checkedCompilerLayout(declaration, isNodeLayout_b74b1ef9bfcc));
        if (signature) {
            const typePredicate = typeChecker.getTypePredicateOfSignature(signature);
            if (typePredicate && typePredicate.type) {
                const typePredicateTypeNode = typeChecker.typePredicateToTypePredicateNode(typePredicate, declaration, NodeBuilderFlags.NoTruncation, InternalNodeBuilderFlags.AllowUnresolvedNames);
                if (typePredicateTypeNode) {
                    return { declaration: checkedCompilerLayout(declaration, isNodeLayout_9bb832a7697a), returnTypeNode: typePredicateTypeNode };
                }
            }
            else {
                returnType = typeChecker.getReturnTypeOfSignature(signature);
            }
        }
    }
    if (!returnType) {
        return { error: getLocaleSpecificMessage(Diagnostics.Could_not_determine_function_return_type) };
    }
    const returnTypeNode = typeChecker.typeToTypeNode(returnType, declaration, NodeBuilderFlags.NoTruncation, InternalNodeBuilderFlags.AllowUnresolvedNames);
    if (returnTypeNode) {
        return { declaration: checkedCompilerLayout(declaration, isNodeLayout_9bb832a7697a), returnTypeNode };
    }
}
function isConvertibleDeclaration(node: Node): node is ConvertibleDeclaration {
    switch (node.kind) {
        case SyntaxKind.FunctionDeclaration:
        case SyntaxKind.FunctionExpression:
        case SyntaxKind.ArrowFunction:
        case SyntaxKind.MethodDeclaration:
            return true;
        default:
            return false;
    }
}
