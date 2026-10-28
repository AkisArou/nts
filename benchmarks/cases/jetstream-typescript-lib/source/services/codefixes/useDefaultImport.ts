// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/useDefaultImport.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type AnyImportSyntax, Diagnostics, type Expression, getQuotePreference, getTokenAtPosition, type Identifier, isExternalModuleReference, isIdentifier, isImportDeclaration, isImportEqualsDeclaration, isNamespaceImport, makeImport, type SourceFile, textChanges, type UserPreferences } from "../_namespaces/ts.ts";
const fixId = "useDefaultImport";
const errorCodes = [Diagnostics.Import_may_be_converted_to_a_default_import.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span: { start } } = context;
        const info = getInfo(sourceFile, start);
        if (!info)
            return undefined;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, info, context.preferences));
        return [createCodeFixAction(fixId, changes, Diagnostics.Convert_to_default_import, fixId, Diagnostics.Convert_all_to_default_imports)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const info = getInfo(diag.file, diag.start);
        if (info)
            doChange(changes, diag.file, info, context.preferences);
    }),
});
interface Info {
    importNode: AnyImportSyntax;
    name: Identifier;
    moduleSpecifier: Expression;
}
function getInfo(sourceFile: SourceFile, pos: number): Info | undefined {
    const name = getTokenAtPosition(sourceFile, pos);
    if (!isIdentifier(name))
        return undefined; // bad input
    const { parent } = name;
    if (testCompilerLayout(parent, isImportEqualsDeclaration) && isExternalModuleReference(parent.moduleReference)) {
        return { importNode: parent, name, moduleSpecifier: parent.moduleReference.expression };
    }
    else if (testCompilerLayout(parent, isNamespaceImport) && isImportDeclaration(parent.parent.parent)) {
        const importNode = parent.parent.parent;
        return { importNode, name, moduleSpecifier: importNode.moduleSpecifier };
    }
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, info: Info, preferences: UserPreferences): void {
    changes.replaceNode(sourceFile, info.importNode, makeImport(info.name, /*namedImports*/ undefined, info.moduleSpecifier, getQuotePreference(sourceFile, preferences)));
}
