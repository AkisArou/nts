// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/addMissingInvocationForDecorator.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Debug, Diagnostics, factory, findAncestor, getTokenAtPosition, isDecorator, type SourceFile, textChanges } from "../_namespaces/ts.ts";
const fixId = "addMissingInvocationForDecorator";
const errorCodes = [Diagnostics._0_accepts_too_few_arguments_to_be_used_as_a_decorator_here_Did_you_mean_to_call_it_first_and_write_0.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToAddMissingInvocationForDecorator(context) {
        const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span.start));
        return [createCodeFixAction(fixId, changes, Diagnostics.Call_decorator_expression, fixId, Diagnostics.Add_to_all_uncalled_decorators)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file, diag.start)),
});
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, pos: number) {
    const token = getTokenAtPosition(sourceFile, pos);
    const decorator = findAncestor(token, isDecorator);
    Debug.assert(!!decorator, "Expected position to be owned by a decorator.");
    const replacement = factory.createCallExpression(decorator.expression, /*typeArguments*/ undefined, /*argumentsArray*/ undefined);
    changeTracker.replaceNode(sourceFile, decorator.expression, replacement);
}
