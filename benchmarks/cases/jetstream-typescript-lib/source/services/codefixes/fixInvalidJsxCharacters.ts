// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixInvalidJsxCharacters.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, hasProperty, quote, type SourceFile, textChanges, type UserPreferences } from "../_namespaces/ts.ts";
const fixIdExpression = "fixInvalidJsxCharacters_expression";
const fixIdHtmlEntity = "fixInvalidJsxCharacters_htmlEntity";
const errorCodes = [
    Diagnostics.Unexpected_token_Did_you_mean_or_gt.code,
    Diagnostics.Unexpected_token_Did_you_mean_or_rbrace.code,
];
registerCodeFix({
    errorCodes,
    fixIds: [fixIdExpression, fixIdHtmlEntity],
    getCodeActions(context) {
        const { sourceFile, preferences, span } = context;
        const changeToExpression = textChanges.ChangeTracker.with(context, t => doChange(t, preferences, sourceFile, span.start, /*useHtmlEntity*/ false));
        const changeToHtmlEntity = textChanges.ChangeTracker.with(context, t => doChange(t, preferences, sourceFile, span.start, /*useHtmlEntity*/ true));
        return [
            createCodeFixAction(fixIdExpression, changeToExpression, Diagnostics.Wrap_invalid_character_in_an_expression_container, fixIdExpression, Diagnostics.Wrap_all_invalid_characters_in_an_expression_container),
            createCodeFixAction(fixIdHtmlEntity, changeToHtmlEntity, Diagnostics.Convert_invalid_character_to_its_html_entity_code, fixIdHtmlEntity, Diagnostics.Convert_all_invalid_characters_to_HTML_entity_code),
        ];
    },
    getAllCodeActions(context) {
        return codeFixAll(context, errorCodes, (changes, diagnostic) => doChange(changes, context.preferences, diagnostic.file, diagnostic.start, context.fixId === fixIdHtmlEntity));
    },
});
const htmlEntity = {
    ">": "&gt;",
    "}": "&rbrace;",
};
function isValidCharacter(character: string): character is keyof typeof htmlEntity {
    return hasProperty(htmlEntity, character);
}
function doChange(changes: textChanges.ChangeTracker, preferences: UserPreferences, sourceFile: SourceFile, start: number, useHtmlEntity: boolean) {
    const character = requireCompilerMember(sourceFile, "getText").getText()[start];
    // sanity check
    if (!isValidCharacter(character)) {
        return;
    }
    const replacement = useHtmlEntity ? htmlEntity[character] : `{${quote(sourceFile, preferences, character)}}`;
    changes.replaceRangeWithText(sourceFile, { pos: start, end: start + 1 }, replacement);
}
