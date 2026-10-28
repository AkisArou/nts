// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixClassDoesntImplementInheritedAbstractMember.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isClassElement as checked_isClassElement } from "../../compiler/utilitiesPublic.ts";
import { codeFixAll, createCodeFixAction, createImportAdder, createMissingMemberNodes, registerCodeFix, type TypeConstructionContext } from "../_namespaces/ts.codefix.ts";
import { addToSeen, cast, type ClassElement, type ClassLikeDeclaration, Diagnostics, first, getEffectiveBaseTypeNode, getNodeId, getSyntacticModifierFlags, getTokenAtPosition, isClassLike, ModifierFlags, type SourceFile, type Symbol, textChanges, type UserPreferences } from "../_namespaces/ts.ts";
const errorCodes = [
    Diagnostics.Non_abstract_class_0_does_not_implement_inherited_abstract_member_1_from_class_2.code,
    Diagnostics.Non_abstract_class_0_is_missing_implementations_for_the_following_members_of_1_Colon_2.code,
    Diagnostics.Non_abstract_class_0_is_missing_implementations_for_the_following_members_of_1_Colon_2_and_3_more.code,
    Diagnostics.Non_abstract_class_expression_does_not_implement_inherited_abstract_member_0_from_class_1.code,
    Diagnostics.Non_abstract_class_expression_is_missing_implementations_for_the_following_members_of_0_Colon_1.code,
    Diagnostics.Non_abstract_class_expression_is_missing_implementations_for_the_following_members_of_0_Colon_1_and_2_more.code,
];
const fixId = "fixClassDoesntImplementInheritedAbstractMember";
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToFixClassNotImplementingInheritedMembers(context) {
        const { sourceFile, span } = context;
        const changes = textChanges.ChangeTracker.with(context, t => addMissingMembers(getClass(sourceFile, span.start), sourceFile, context, t, context.preferences));
        return changes.length === 0 ? undefined : [createCodeFixAction(fixId, changes, Diagnostics.Implement_inherited_abstract_class, fixId, Diagnostics.Implement_all_inherited_abstract_classes)];
    },
    fixIds: [fixId],
    getAllCodeActions: function getAllCodeActionsToFixClassDoesntImplementInheritedAbstractMember(context) {
        const seenClassDeclarations = new Set<number>();
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const classDeclaration = getClass(diag.file, diag.start);
            if (addToSeen(seenClassDeclarations, getNodeId(classDeclaration))) {
                addMissingMembers(classDeclaration, context.sourceFile, context, changes, context.preferences);
            }
        });
    },
});
function getClass(sourceFile: SourceFile, pos: number): ClassLikeDeclaration {
    // Token is the identifier in the case of a class declaration
    // or the class keyword token in the case of a class expression.
    const token = getTokenAtPosition(sourceFile, pos);
    return cast(token.parent, isClassLike);
}
function addMissingMembers(classDeclaration: ClassLikeDeclaration, sourceFile: SourceFile, context: TypeConstructionContext, changeTracker: textChanges.ChangeTracker, preferences: UserPreferences): void {
    const extendsNode = getEffectiveBaseTypeNode(classDeclaration);
    const checker = context.program.getTypeChecker();
    const instantiatedExtendsType = checker.getTypeAtLocation((extendsNode)!);
    // Note that this is ultimately derived from a map indexed by symbol names,
    // so duplicates cannot occur.
    const abstractAndNonPrivateExtendsSymbols = checker.getPropertiesOfType(instantiatedExtendsType).filter(symbolPointsToNonPrivateAndAbstractMember);
    const importAdder = createImportAdder(sourceFile, context.program, preferences, context.host);
    createMissingMemberNodes(classDeclaration, abstractAndNonPrivateExtendsSymbols, sourceFile, context, preferences, importAdder, member => changeTracker.insertMemberAtStart(sourceFile, classDeclaration, (member)));
    importAdder.writeFixes(changeTracker);
}
function symbolPointsToNonPrivateAndAbstractMember(symbol: Symbol): boolean {
    // See `codeFixClassExtendAbstractProtectedProperty.ts` in https://github.com/Microsoft/TypeScript/pull/11547/files
    // (now named `codeFixClassExtendAbstractPrivateProperty.ts`)
    const flags = getSyntacticModifierFlags(first((requireCompilerMember(symbol, "getDeclarations").getDeclarations())!));
    return !(flags & ModifierFlags.Private) && !!(flags & ModifierFlags.Abstract);
}
