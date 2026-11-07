// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/refactors/moveToNewFile.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { type ApplicableRefactorInfo, codefix, createFutureSourceFile, Debug, Diagnostics, emptyArray, findAncestor, getLineAndCharacterOfPosition, getLocaleSpecificMessage, getTokenAtPosition, hostGetCanonicalFileName, isBlockLike, isSourceFile, type LanguageServiceHost, last, ModuleKind, type Program, type RefactorContext, type RefactorEditInfo, type SourceFile, textChanges, type UserPreferences } from "../_namespaces/ts.ts";
import { addNewFileToTsconfig, createNewFileName, getNewStatementsAndRemoveFromOldFile, getStatementsToMove, getUsageInfo, registerRefactor, type ToMove } from "../_namespaces/ts.refactor.ts";
const refactorName = "Move to a new file";
const description = getLocaleSpecificMessage(Diagnostics.Move_to_a_new_file);
const moveToNewFileAction = {
    name: refactorName,
    description,
    kind: "refactor.move.newFile",
};
registerRefactor(refactorName, {
    kinds: [moveToNewFileAction.kind],
    getAvailableActions: function getRefactorActionsToMoveToNewFile(context): readonly ApplicableRefactorInfo[] {
        const statements = getStatementsToMove(context);
        const file = context.file;
        if (context.triggerReason === "implicit" && context.endPosition !== undefined) {
            const startNodeAncestor = findAncestor(getTokenAtPosition(file, context.startPosition), isBlockLike);
            const endNodeAncestor = findAncestor(getTokenAtPosition(file, context.endPosition), isBlockLike);
            if (startNodeAncestor && !isSourceFile(startNodeAncestor) && endNodeAncestor && !isSourceFile(endNodeAncestor)) {
                return emptyArray;
            }
        }
        if (context.preferences.allowTextChangesInNewFiles && statements) {
            const file = context.file;
            const affectedTextRange = {
                start: { line: getLineAndCharacterOfPosition(file, requireCompilerMember(statements.all[0], "getStart").getStart(file)).line, offset: getLineAndCharacterOfPosition(file, requireCompilerMember(statements.all[0], "getStart").getStart(file)).character },
                end: { line: getLineAndCharacterOfPosition(file, last(statements.all).end).line, offset: getLineAndCharacterOfPosition(file, last(statements.all).end).character },
            };
            return [{ name: refactorName, description, actions: [{ ...moveToNewFileAction, range: affectedTextRange }] }];
        }
        if (context.preferences.provideRefactorNotApplicableReason) {
            return [{ name: refactorName, description, actions: [{ ...moveToNewFileAction, notApplicableReason: getLocaleSpecificMessage(Diagnostics.Selection_is_not_a_valid_statement_or_statements) }] }];
        }
        return emptyArray;
    },
    getEditsForAction: function getRefactorEditsToMoveToNewFile(context, actionName): RefactorEditInfo {
        Debug.assert(actionName === refactorName, "Wrong refactor invoked");
        const statements = Debug.checkDefined(getStatementsToMove(context));
        const edits = textChanges.ChangeTracker.with(context, t => doChange(context.file, context.program, statements, t, context.host, context, context.preferences));
        return { edits, renameFilename: undefined, renameLocation: undefined };
    },
});
function doChange(oldFile: SourceFile, program: Program, toMove: ToMove, changes: textChanges.ChangeTracker, host: LanguageServiceHost, context: RefactorContext, preferences: UserPreferences): void {
    const checker = program.getTypeChecker();
    const usage = getUsageInfo(oldFile, toMove.all, checker);
    const newFilename = createNewFileName(oldFile, program, host, toMove);
    const newSourceFile = createFutureSourceFile(newFilename, oldFile.externalModuleIndicator ? ModuleKind.ESNext : oldFile.commonJsModuleIndicator ? ModuleKind.CommonJS : undefined, program, host);
    const importAdderForOldFile = codefix.createImportAdder(oldFile, context.program, context.preferences, context.host);
    const importAdderForNewFile = codefix.createImportAdder(newSourceFile, context.program, context.preferences, context.host);
    getNewStatementsAndRemoveFromOldFile(oldFile, newSourceFile, usage, changes, toMove, program, host, preferences, importAdderForNewFile, importAdderForOldFile);
    addNewFileToTsconfig(program, changes, oldFile.fileName, newFilename, hostGetCanonicalFileName(host));
}
