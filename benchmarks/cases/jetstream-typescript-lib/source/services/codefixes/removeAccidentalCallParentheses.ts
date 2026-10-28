// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/removeAccidentalCallParentheses.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { createCodeFixActionWithoutFixAll, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, findAncestor, getTokenAtPosition, isCallExpression, textChanges } from "../_namespaces/ts.ts";
const fixId = "removeAccidentalCallParentheses";
const errorCodes = [
    Diagnostics.This_expression_is_not_callable_because_it_is_a_get_accessor_Did_you_mean_to_use_it_without.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const callExpression = findAncestor(getTokenAtPosition(context.sourceFile, context.span.start), isCallExpression);
        if (!callExpression) {
            return undefined;
        }
        const changes = textChanges.ChangeTracker.with(context, t => {
            t.deleteRange(context.sourceFile, { pos: callExpression.expression.end, end: callExpression.end });
        });
        return [createCodeFixActionWithoutFixAll(fixId, changes, Diagnostics.Remove_parentheses)];
    },
    fixIds: [fixId],
});
