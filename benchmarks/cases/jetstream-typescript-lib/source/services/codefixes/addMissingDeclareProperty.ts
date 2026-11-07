// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/addMissingDeclareProperty.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, getTokenAtPosition, isIdentifier, type Node, type SourceFile, SyntaxKind, textChanges, tryAddToSet } from "../_namespaces/ts.ts";
const fixId = "addMissingDeclareProperty";
const errorCodes = [
    Diagnostics.Property_0_will_overwrite_the_base_property_in_1_If_this_is_intentional_add_an_initializer_Otherwise_add_a_declare_modifier_or_remove_the_redundant_declaration.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToAddMissingDeclareOnProperty(context) {
        const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span.start));
        if (changes.length > 0) {
            return [createCodeFixAction(fixId, changes, Diagnostics.Prefix_with_declare, fixId, Diagnostics.Prefix_all_incorrect_property_declarations_with_declare)];
        }
    },
    fixIds: [fixId],
    getAllCodeActions: context => {
        const fixedNodes = new Set<Node>();
        return codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file, diag.start, fixedNodes));
    },
});
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, pos: number, fixedNodes?: Set<Node>) {
    const token = getTokenAtPosition(sourceFile, pos);
    if (!isIdentifier(token)) {
        return;
    }
    const declaration = token.parent;
    if ((declaration)!.kind === SyntaxKind.PropertyDeclaration &&
        (!fixedNodes || tryAddToSet(fixedNodes, declaration))) {
        changeTracker.insertModifierBefore(sourceFile, SyntaxKind.DeclareKeyword, (declaration)!);
    }
}
