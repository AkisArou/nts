// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/wrapJsxInFragment.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { testCompilerLayout } from "../../checked.ts";
import { isJsxChild as checked_isJsxChild } from "../_namespaces/ts.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type BinaryExpression, Diagnostics, factory, getTokenAtPosition, isBinaryExpression, isJsxChild, type JsxChild, type Node, nodeIsMissing, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixID = "wrapJsxInFragment";
const errorCodes = [Diagnostics.JSX_expressions_must_have_one_parent_element.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToWrapJsxInFragment(context) {
        const { sourceFile, span } = context;
        const node = findNodeToFix(sourceFile, span.start);
        if (!node)
            return undefined;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, node));
        return [createCodeFixAction(fixID, changes, Diagnostics.Wrap_in_JSX_fragment, fixID, Diagnostics.Wrap_all_unparented_JSX_in_JSX_fragment)];
    },
    fixIds: [fixID],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const node = findNodeToFix(context.sourceFile, diag.start);
        if (!node)
            return undefined;
        doChange(changes, context.sourceFile, node);
    }),
});
function findNodeToFix(sourceFile: SourceFile, pos: number): BinaryExpression | undefined {
    // The error always at 1st token that is "<" in "<a /><a />"
    const lessThanToken = getTokenAtPosition(sourceFile, pos);
    const firstJsxElementOrOpenElement = lessThanToken.parent;
    let binaryExpr = (firstJsxElementOrOpenElement)!.parent;
    if (!testCompilerLayout(binaryExpr, isBinaryExpression)) {
        // In case the start element is a JsxSelfClosingElement, it the end.
        // For JsxOpenElement, find one more parent
        binaryExpr = (binaryExpr)!.parent;
        if (!testCompilerLayout(binaryExpr, isBinaryExpression))
            return undefined;
    }
    if (!nodeIsMissing(binaryExpr.operatorToken))
        return undefined;
    return binaryExpr;
}
function doChange(changeTracker: textChanges.ChangeTracker, sf: SourceFile, node: Node) {
    const jsx = flattenInvalidBinaryExpr(node);
    if (jsx)
        changeTracker.replaceNode(sf, node, factory.createJsxFragment(factory.createJsxOpeningFragment(), jsx, factory.createJsxJsxClosingFragment()));
}
// The invalid syntax is constructed as
// InvalidJsxTree :: One of
//     JsxElement CommaToken InvalidJsxTree
//     JsxElement CommaToken JsxElement
function flattenInvalidBinaryExpr(node: Node): JsxChild[] | undefined {
    const children: JsxChild[] = [];
    let current = node;
    while (true) {
        if (isBinaryExpression(current) && nodeIsMissing(current.operatorToken) && current.operatorToken.kind === SyntaxKind.CommaToken) {
            children.push(checkedCompilerLayout(current.left, checked_isJsxChild));
            if (isJsxChild(current.right)) {
                children.push(current.right);
                // Indicates the tree has go to the bottom
                return children;
            }
            else if (isBinaryExpression(current.right)) {
                current = current.right;
                continue;
            }
            // Unreachable case
            else
                return undefined;
        }
        // Unreachable case
        else
            return undefined;
    }
}
