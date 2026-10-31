// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixAddMissingNewOperator.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isCompilerSyntaxNode } from "../../checkedTypes.ts";
import { checkedCompilerLayout, present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { cast, Diagnostics, factory, getTokenAtPosition, isCallExpression, type Node, type SourceFile, textChanges, type TextSpan, textSpanEnd } from "../_namespaces/ts.ts";
const fixId = "addMissingNewOperator";
const errorCodes = [Diagnostics.Value_of_type_0_is_not_callable_Did_you_mean_to_include_new.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span } = context;
        const changes = textChanges.ChangeTracker.with(context, t => addMissingNewOperator(t, sourceFile, span));
        return [createCodeFixAction(fixId, changes, Diagnostics.Add_missing_new_operator_to_call, fixId, Diagnostics.Add_missing_new_operator_to_all_calls)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => addMissingNewOperator(changes, context.sourceFile, diag)),
});
function addMissingNewOperator(changes: textChanges.ChangeTracker, sourceFile: SourceFile, span: TextSpan): void {
    const call = cast(findAncestorMatchingSpan(sourceFile, span), isCallExpression);
    const newExpression = factory.createNewExpression(call.expression, call.typeArguments, call.arguments);
    changes.replaceNode(sourceFile, call, newExpression);
}
function findAncestorMatchingSpan(sourceFile: SourceFile, span: TextSpan): Node {
    let token = getTokenAtPosition(sourceFile, span.start);
    const end = textSpanEnd(span);
    while (token.end < end) {
        token = (checkedCompilerLayout(token.parent, isCompilerSyntaxNode))!;
    }
    return token;
}
