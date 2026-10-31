// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixNoPropertyAccessFromIndexSignature.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { cast, Diagnostics, factory, getQuotePreference, getTokenAtPosition, isPropertyAccessChain, isPropertyAccessExpression, type PropertyAccessExpression, QuotePreference, type SourceFile, textChanges, type UserPreferences } from "../_namespaces/ts.ts";
const fixId = "fixNoPropertyAccessFromIndexSignature";
const errorCodes = [
    Diagnostics.Property_0_comes_from_an_index_signature_so_it_must_be_accessed_with_0.code,
];
registerCodeFix({
    errorCodes,
    fixIds: [fixId],
    getCodeActions(context) {
        const { sourceFile, span, preferences } = context;
        const property = getPropertyAccessExpression(sourceFile, span.start);
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, property, preferences));
        return [createCodeFixAction(fixId, changes, [Diagnostics.Use_element_access_for_0, (property.name.text)!], fixId, Diagnostics.Use_element_access_for_all_undeclared_properties)];
    },
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => doChange(changes, diag.file, getPropertyAccessExpression(diag.file, diag.start), context.preferences)),
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, node: PropertyAccessExpression, preferences: UserPreferences): void {
    const quotePreference = getQuotePreference(sourceFile, preferences);
    const argumentsExpression = factory.createStringLiteral((node.name.text)!, quotePreference === QuotePreference.Single);
    changes.replaceNode(sourceFile, node, isPropertyAccessChain(node) ?
        factory.createElementAccessChain(node.expression, node.questionDotToken, argumentsExpression) :
        factory.createElementAccessExpression(node.expression, argumentsExpression));
}
function getPropertyAccessExpression(sourceFile: SourceFile, pos: number): PropertyAccessExpression {
    return cast(getTokenAtPosition(sourceFile, pos).parent, isPropertyAccessExpression);
}
