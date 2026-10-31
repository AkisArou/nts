// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixUnreachableCode.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isIfStatement as checked_isIfStatement } from "../../compiler/factory/nodeTests.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Debug, Diagnostics, emptyArray, factory, findAncestor, first, getTokenAtPosition, type IfStatement, isBlock, isStatement, sliceAfter, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixId = "fixUnreachableCode";
const errorCodes = [Diagnostics.Unreachable_code_detected.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const syntacticDiagnostics = context.program.getSyntacticDiagnostics(context.sourceFile, context.cancellationToken);
        if (syntacticDiagnostics.length)
            return;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, context.span.start, context.span.length, context.errorCode));
        return [createCodeFixAction(fixId, changes, Diagnostics.Remove_unreachable_code, fixId, Diagnostics.Remove_all_unreachable_code)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => doChange(changes, diag.file, diag.start, diag.length, diag.code)),
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, start: number, length: number, errorCode: number): void {
    const token = getTokenAtPosition(sourceFile, start);
    const statement = findAncestor(token, isStatement);
    if (requireCompilerMember((statement)!, "getStart").getStart(sourceFile) !== requireCompilerMember(token, "getStart").getStart(sourceFile)) {
        const logData = JSON.stringify({
            statementKind: Debug.formatSyntaxKind((statement)!.kind),
            tokenKind: Debug.formatSyntaxKind(token.kind),
            errorCode,
            start,
            length,
        });
        Debug.fail("Token and statement should start at the same point. " + logData);
    }
    const container = ((testCompilerLayout((statement)!.parent, isBlock) ? (statement)!.parent : statement))!.parent;
    if (!testCompilerLayout((statement)!.parent, isBlock) || statement === first(checkedCompilerLayout((statement)!.parent!, isBlock).statements)) {
        switch ((container)!.kind) {
            case SyntaxKind.IfStatement:
                if (((checkedCompilerLayout(container, checked_isIfStatement)))!.elseStatement) {
                    if (testCompilerLayout((statement)!.parent, isBlock)) {
                        break;
                    }
                    else {
                        changes.replaceNode(sourceFile, (statement)!, factory.createBlock(emptyArray));
                    }
                    return;
                }
            // falls through
            case SyntaxKind.WhileStatement:
            case SyntaxKind.ForStatement:
                changes.delete(sourceFile, (container)!);
                return;
        }
    }
    if (testCompilerLayout((statement)!.parent, isBlock)) {
        const end = start + length;
        const lastStatement = Debug.checkDefined(lastWhere(sliceAfter(checkedCompilerLayout((statement)!.parent!, isBlock).statements, statement), s => (s)!.pos < end), "Some statement should be last");
        changes.deleteNodeRange(sourceFile, (statement)!, lastStatement);
    }
    else {
        changes.delete(sourceFile, (statement)!);
    }
}
function lastWhere<T>(a: readonly T[], pred: (value: T) => boolean): T | undefined {
    let last: T | undefined;
    for (const value of a) {
        if (!pred(value))
            break;
        last = value;
    }
    return last;
}
