// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixAddModuleReferTypeMissingTypeof.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isImportTypeNode as checked_isImportTypeNode } from "../../compiler/factory/nodeTests.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Debug, Diagnostics, factory, getTokenAtPosition, type ImportTypeNode, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixIdAddMissingTypeof = "fixAddModuleReferTypeMissingTypeof";
const fixId = fixIdAddMissingTypeof;
const errorCodes = [Diagnostics.Module_0_does_not_refer_to_a_type_but_is_used_as_a_type_here_Did_you_mean_typeof_import_0.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToAddMissingTypeof(context) {
        const { sourceFile, span } = context;
        const importType = getImportTypeNode(sourceFile, span.start);
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, importType));
        return [createCodeFixAction(fixId, changes, Diagnostics.Add_missing_typeof, fixId, Diagnostics.Add_missing_typeof)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => doChange(changes, context.sourceFile, getImportTypeNode(diag.file, diag.start))),
});
function getImportTypeNode(sourceFile: SourceFile, pos: number): ImportTypeNode {
    const token = getTokenAtPosition(sourceFile, pos);
    Debug.assert(token.kind === SyntaxKind.ImportKeyword, "This token should be an ImportKeyword");
    Debug.assert((token.parent)!.kind === SyntaxKind.ImportType, "Token parent should be an ImportType");
    return checkedCompilerLayout(token.parent!, checked_isImportTypeNode);
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, importType: ImportTypeNode) {
    const newTypeNode = factory.updateImportTypeNode(importType, importType.argument, importType.attributes, importType.qualifier, importType.typeArguments, /*isTypeOf*/ true);
    changes.replaceNode(sourceFile, importType, newTypeNode);
}
