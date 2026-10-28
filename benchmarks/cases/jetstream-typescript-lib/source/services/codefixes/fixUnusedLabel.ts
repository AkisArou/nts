// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixUnusedLabel.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { cast, Diagnostics, findChildOfKind, getTokenAtPosition, isLabeledStatement, positionsAreOnSameLine, skipTrivia, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixId = "fixUnusedLabel";
const errorCodes = [Diagnostics.Unused_label.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, context.span.start));
        return [createCodeFixAction(fixId, changes, Diagnostics.Remove_unused_label, fixId, Diagnostics.Remove_all_unused_labels)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => doChange(changes, diag.file, diag.start)),
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, start: number): void {
    const token = getTokenAtPosition(sourceFile, start);
    const labeledStatement = cast(token.parent, isLabeledStatement);
    const pos = requireCompilerMember(token, "getStart").getStart(sourceFile);
    const statementPos = requireCompilerMember(labeledStatement.statement, "getStart").getStart(sourceFile);
    // If label is on a separate line, just delete the rest of that line, but not the indentation of the labeled statement.
    const end = positionsAreOnSameLine(pos, statementPos, sourceFile) ? statementPos
        : skipTrivia(sourceFile.text, (findChildOfKind(labeledStatement, SyntaxKind.ColonToken, sourceFile))!.end, /*stopAfterLineBreak*/ true);
    changes.deleteRange(sourceFile, { pos, end });
}
