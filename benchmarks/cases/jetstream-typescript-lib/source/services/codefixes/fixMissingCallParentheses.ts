// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixMissingCallParentheses.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, getTokenAtPosition, type Identifier, isIdentifier, isPropertyAccessExpression, type PrivateIdentifier, type PropertyAccessExpression, type SourceFile, textChanges } from "../_namespaces/ts.ts";
const fixId = "fixMissingCallParentheses";
const errorCodes = [
    Diagnostics.This_condition_will_always_return_true_since_this_function_is_always_defined_Did_you_mean_to_call_it_instead.code,
];
registerCodeFix({
    errorCodes,
    fixIds: [fixId],
    getCodeActions(context) {
        const { sourceFile, span } = context;
        const callName = getCallName(sourceFile, span.start);
        if (!callName)
            return;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, callName));
        return [createCodeFixAction(fixId, changes, Diagnostics.Add_missing_call_parentheses, fixId, Diagnostics.Add_all_missing_call_parentheses)];
    },
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const callName = getCallName(diag.file, diag.start);
        if (callName)
            doChange(changes, diag.file, callName);
    }),
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, name: Identifier | PrivateIdentifier): void {
    changes.replaceNodeWithText(sourceFile, name, `${name.text}()`);
}
function getCallName(sourceFile: SourceFile, start: number): Identifier | PrivateIdentifier | undefined {
    const token = getTokenAtPosition(sourceFile, start);
    if (testCompilerLayout(token.parent, isPropertyAccessExpression)) {
        let current: PropertyAccessExpression = token.parent;
        while (testCompilerLayout(current.parent, isPropertyAccessExpression)) {
            current = current.parent;
        }
        return current.name;
    }
    if (isIdentifier(token)) {
        return token;
    }
    return undefined;
}
