// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/useBigintLiteral.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, getTokenAtPosition, isNumericLiteral, type SourceFile, textChanges, type TextSpan, tryCast } from "../_namespaces/ts.ts";
const fixId = "useBigintLiteral";
const errorCodes = [
    Diagnostics.Numeric_literals_with_absolute_values_equal_to_2_53_or_greater_are_too_large_to_be_represented_accurately_as_integers.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToUseBigintLiteral(context) {
        const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span));
        if (changes.length > 0) {
            return [createCodeFixAction(fixId, changes, Diagnostics.Convert_to_a_bigint_numeric_literal, fixId, Diagnostics.Convert_all_to_bigint_numeric_literals)];
        }
    },
    fixIds: [fixId],
    getAllCodeActions: context => {
        return codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file, diag));
    },
});
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, span: TextSpan) {
    const numericLiteral = tryCast(getTokenAtPosition(sourceFile, span.start), isNumericLiteral);
    if (!numericLiteral) {
        return;
    }
    // We use .getText to overcome parser inaccuracies: https://github.com/microsoft/TypeScript/issues/33298
    const newText = requireCompilerMember(numericLiteral, "getText").getText(sourceFile) + "n";
    changeTracker.replaceNode(sourceFile, numericLiteral, factory.createBigIntLiteral(newText));
}
