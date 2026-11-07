// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/wrapDecoratorInParentheses.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Debug, Diagnostics, factory, findAncestor, getTokenAtPosition, isDecorator, type SourceFile, textChanges } from "../_namespaces/ts.ts";
const fixId = "wrapDecoratorInParentheses";
const errorCodes = [Diagnostics.Expression_must_be_enclosed_in_parentheses_to_be_used_as_a_decorator.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToWrapDecoratorExpressionInParentheses(context) {
        const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span.start));
        return [createCodeFixAction(fixId, changes, Diagnostics.Wrap_in_parentheses, fixId, Diagnostics.Wrap_all_invalid_decorator_expressions_in_parentheses)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file, diag.start)),
});
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, pos: number) {
    const token = getTokenAtPosition(sourceFile, pos);
    const decorator = findAncestor(token, isDecorator);
    Debug.assert(!!decorator, "Expected position to be owned by a decorator.");
    const replacement = factory.createParenthesizedExpression(decorator.expression);
    changeTracker.replaceNode(sourceFile, decorator.expression, replacement);
}
