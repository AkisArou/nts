// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/splitTypeOnlyImport.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type CodeFixContextBase, Debug, Diagnostics, factory, findAncestor, getTokenAtPosition, type ImportDeclaration, isImportDeclaration, type SourceFile, textChanges, type TextSpan } from "../_namespaces/ts.ts";
const errorCodes = [Diagnostics.A_type_only_import_can_specify_a_default_import_or_named_bindings_but_not_both.code];
const fixId = "splitTypeOnlyImport";
registerCodeFix({
    errorCodes,
    fixIds: [fixId],
    getCodeActions: function getCodeActionsToSplitTypeOnlyImport(context) {
        const changes = textChanges.ChangeTracker.with(context, t => {
            return splitTypeOnlyImport(t, getImportDeclaration(context.sourceFile, context.span), context);
        });
        if (changes.length) {
            return [createCodeFixAction(fixId, changes, Diagnostics.Split_into_two_separate_import_declarations, fixId, Diagnostics.Split_all_invalid_type_only_imports)];
        }
    },
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, error) => {
        splitTypeOnlyImport(changes, getImportDeclaration(context.sourceFile, error), context);
    }),
});
function getImportDeclaration(sourceFile: SourceFile, span: TextSpan) {
    return findAncestor(getTokenAtPosition(sourceFile, span.start), isImportDeclaration);
}
function splitTypeOnlyImport(changes: textChanges.ChangeTracker, importDeclaration: ImportDeclaration | undefined, context: CodeFixContextBase) {
    if (!importDeclaration) {
        return;
    }
    const importClause = Debug.checkDefined(importDeclaration.importClause);
    changes.replaceNode(context.sourceFile, importDeclaration, factory.updateImportDeclaration(importDeclaration, importDeclaration.modifiers, factory.updateImportClause(importClause, importClause.phaseModifier, importClause.name, /*namedBindings*/ undefined), importDeclaration.moduleSpecifier, importDeclaration.attributes));
    changes.insertNodeAfter(context.sourceFile, importDeclaration, factory.createImportDeclaration(
    /*modifiers*/ undefined, factory.updateImportClause(importClause, importClause.phaseModifier, /*name*/ undefined, importClause.namedBindings), importDeclaration.moduleSpecifier, importDeclaration.attributes));
}
