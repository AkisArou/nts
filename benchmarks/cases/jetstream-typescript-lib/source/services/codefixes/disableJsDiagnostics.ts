// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/disableJsDiagnostics.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { DiagnosticMessage } from "../../compiler/types.ts";
import { codeFixAll, createCodeFixAction, createCodeFixActionWithoutFixAll, createFileTextChanges, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type CodeFixAction, createTextChange, createTextSpan, createTextSpanFromBounds, DiagnosticCategory, Diagnostics, getLineAndCharacterOfPosition, getNewLineOrDefaultFromHost, isCheckJsEnabledForFile, isInJSFile, mapDefined, type SourceFile, textChanges, tryAddToSet } from "../_namespaces/ts.ts";
const fixName = "disableJsDiagnostics";
const fixId = "disableJsDiagnostics";
const diagnosticsByName: Readonly<Record<string, DiagnosticMessage>> = Diagnostics;
const errorCodes = mapDefined(Object.keys(Diagnostics), key => {
    const diag = diagnosticsByName[key];
    return diag.category === DiagnosticCategory.Error ? diag.code : undefined;
});
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToDisableJsDiagnostics(context) {
        const { sourceFile, program, span, host, formatContext } = context;
        if (!isInJSFile(sourceFile) || !isCheckJsEnabledForFile(sourceFile, program.getCompilerOptions())) {
            return undefined;
        }
        const newLineCharacter = sourceFile.checkJsDirective ? "" : getNewLineOrDefaultFromHost(host, formatContext.options);
        const fixes: CodeFixAction[] = [
            // fixId unnecessary because adding `// @ts-nocheck` even once will ignore every error in the file.
            createCodeFixActionWithoutFixAll(fixName, [createFileTextChanges(sourceFile.fileName, [
                    createTextChange(sourceFile.checkJsDirective
                        ? createTextSpanFromBounds(sourceFile.checkJsDirective.pos, sourceFile.checkJsDirective.end)
                        : createTextSpan(0, 0), `// @ts-nocheck${newLineCharacter}`),
                ])], Diagnostics.Disable_checking_for_this_file),
        ];
        if (textChanges.isValidLocationToAddComment(sourceFile, span.start)) {
            fixes.unshift(createCodeFixAction(fixName, textChanges.ChangeTracker.with(context, t => makeChange(t, sourceFile, span.start)), Diagnostics.Ignore_this_error_message, fixId, Diagnostics.Add_ts_ignore_to_all_error_messages));
        }
        return fixes;
    },
    fixIds: [fixId],
    getAllCodeActions: context => {
        const seenLines = new Set<number>();
        return codeFixAll(context, errorCodes, (changes, diag) => {
            if (textChanges.isValidLocationToAddComment(diag.file, diag.start)) {
                makeChange(changes, diag.file, diag.start, seenLines);
            }
        });
    },
});
function makeChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, position: number, seenLines?: Set<number>) {
    const { line: lineNumber } = getLineAndCharacterOfPosition(sourceFile, position);
    // Only need to add `// @ts-ignore` for a line once.
    if (!seenLines || tryAddToSet(seenLines, lineNumber)) {
        changes.insertCommentBeforeLine(sourceFile, lineNumber, position, " @ts-ignore");
    }
}
