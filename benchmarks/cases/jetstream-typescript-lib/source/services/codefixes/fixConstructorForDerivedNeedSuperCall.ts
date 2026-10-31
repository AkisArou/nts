// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixConstructorForDerivedNeedSuperCall.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type ConstructorDeclaration, Debug, Diagnostics, emptyArray, factory, getTokenAtPosition, isConstructorDeclaration, type SourceFile, textChanges } from "../_namespaces/ts.ts";
const fixId = "constructorForDerivedNeedSuperCall";
const errorCodes = [Diagnostics.Constructors_for_derived_classes_must_contain_a_super_call.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span } = context;
        const ctr = getNode(sourceFile, span.start);
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, ctr));
        return [createCodeFixAction(fixId, changes, Diagnostics.Add_missing_super_call, fixId, Diagnostics.Add_all_missing_super_calls)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => doChange(changes, context.sourceFile, getNode(diag.file, diag.start))),
});
function getNode(sourceFile: SourceFile, pos: number): ConstructorDeclaration {
    const token = getTokenAtPosition(sourceFile, pos);
    Debug.assert(testCompilerLayout(token.parent, isConstructorDeclaration), "token should be at the constructor declaration");
    return token.parent;
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, ctr: ConstructorDeclaration) {
    const superCall = factory.createExpressionStatement(factory.createCallExpression(factory.createSuper(), /*typeArguments*/ undefined, /*argumentsArray*/ emptyArray));
    changes.insertNodeAtConstructorStart(sourceFile, ctr, superCall);
}
