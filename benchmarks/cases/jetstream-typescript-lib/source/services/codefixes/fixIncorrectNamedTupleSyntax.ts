// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixIncorrectNamedTupleSyntax.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isNodeLayout_ae9401269231, isNodeLayout_d01568ece20e } from "../../checkedLayouts.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, findAncestor, getTokenAtPosition, type NamedTupleMember, type OptionalTypeNode, type ParenthesizedTypeNode, type RestTypeNode, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixId = "fixIncorrectNamedTupleSyntax";
const errorCodes = [
    Diagnostics.A_labeled_tuple_element_is_declared_as_optional_with_a_question_mark_after_the_name_and_before_the_colon_rather_than_after_the_type.code,
    Diagnostics.A_labeled_tuple_element_is_declared_as_rest_with_a_before_the_name_rather_than_before_the_type.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToFixIncorrectNamedTupleSyntax(context) {
        const { sourceFile, span } = context;
        const namedTupleMember = getNamedTupleMember(sourceFile, span.start);
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, checkedCompilerLayout(namedTupleMember, isNodeLayout_ae9401269231)));
        return [createCodeFixAction(fixId, changes, Diagnostics.Move_labeled_tuple_element_modifiers_to_labels, fixId, Diagnostics.Move_labeled_tuple_element_modifiers_to_labels)];
    },
    fixIds: [fixId],
});
function getNamedTupleMember(sourceFile: SourceFile, pos: number) {
    const token = getTokenAtPosition(sourceFile, pos);
    return findAncestor(token, t => t.kind === SyntaxKind.NamedTupleMember);
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, namedTupleMember?: NamedTupleMember) {
    if (!namedTupleMember) {
        return;
    }
    let unwrappedType = namedTupleMember.type;
    let sawOptional = false;
    let sawRest = false;
    while (unwrappedType.kind === SyntaxKind.OptionalType || unwrappedType.kind === SyntaxKind.RestType || unwrappedType.kind === SyntaxKind.ParenthesizedType) {
        if (unwrappedType.kind === SyntaxKind.OptionalType) {
            sawOptional = true;
        }
        else if (unwrappedType.kind === SyntaxKind.RestType) {
            sawRest = true;
        }
        unwrappedType = checkedCompilerLayout((unwrappedType), isNodeLayout_d01568ece20e).type;
    }
    const updated = factory.updateNamedTupleMember(namedTupleMember, namedTupleMember.dotDotDotToken || (sawRest ? factory.createToken(SyntaxKind.DotDotDotToken) : undefined), namedTupleMember.name, namedTupleMember.questionToken || (sawOptional ? factory.createToken(SyntaxKind.QuestionToken) : undefined), unwrappedType);
    if (updated === namedTupleMember) {
        return;
    }
    changes.replaceNode(sourceFile, namedTupleMember, updated);
}
