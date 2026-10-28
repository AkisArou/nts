// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/removeUnnecessaryAwait.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isCompilerSyntaxNode } from "../../checkedTypes.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type AwaitKeyword, Diagnostics, findPrecedingToken, getLeftmostExpression, getTokenAtPosition, isAwaitExpression, isIdentifier, isParenthesizedExpression, type Node, type SourceFile, SyntaxKind, textChanges, type TextSpan, tryCast } from "../_namespaces/ts.ts";
const fixId = "removeUnnecessaryAwait";
const errorCodes = [
    Diagnostics.await_has_no_effect_on_the_type_of_this_expression.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToRemoveUnnecessaryAwait(context) {
        const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span));
        if (changes.length > 0) {
            return [createCodeFixAction(fixId, changes, Diagnostics.Remove_unnecessary_await, fixId, Diagnostics.Remove_all_unnecessary_uses_of_await)];
        }
    },
    fixIds: [fixId],
    getAllCodeActions: context => {
        return codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file, diag));
    },
});
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, span: TextSpan) {
    const awaitKeyword = tryCast(getTokenAtPosition(sourceFile, span.start), (node): node is AwaitKeyword => node.kind === SyntaxKind.AwaitKeyword);
    const awaitExpression = awaitKeyword && tryCast(awaitKeyword.parent, isAwaitExpression);
    if (!awaitExpression) {
        return;
    }
    let expressionToReplace: Node = awaitExpression;
    const hasSurroundingParens = testCompilerLayout(awaitExpression.parent, isParenthesizedExpression);
    if (hasSurroundingParens) {
        const leftMostExpression = getLeftmostExpression(awaitExpression.expression, /*stopAtCallExpressions*/ false);
        if (isIdentifier(leftMostExpression)) {
            const precedingToken = findPrecedingToken((awaitExpression.parent)!.pos, sourceFile);
            if (precedingToken && precedingToken.kind !== SyntaxKind.NewKeyword) {
                expressionToReplace = (checkedCompilerLayout(awaitExpression.parent, isCompilerSyntaxNode))!;
            }
        }
    }
    changeTracker.replaceNode(sourceFile, expressionToReplace, awaitExpression.expression);
}
