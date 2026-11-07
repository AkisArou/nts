// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixClassIncorrectlyImplementsInterface.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isCompilerInterfaceType as checked_isCompilerInterfaceType } from "../../checkedTypes.ts";
import { isClassElement as checked_isClassElement } from "../../compiler/utilitiesPublic.ts";
import { codeFixAll, createCodeFixAction, createImportAdder, createMissingMemberNodes, getNoopSymbolTrackerWithResolver, registerCodeFix, type TypeConstructionContext } from "../_namespaces/ts.codefix.ts";
import { addToSeen, and, type ClassElement, type ClassLikeDeclaration, type CodeFixAction, createSymbolTable, Debug, Diagnostics, type ExpressionWithTypeArguments, find, getContainingClass, getEffectiveBaseTypeNode, getEffectiveImplementsTypeNodes, getEffectiveModifierFlags, getNodeId, getTokenAtPosition, IndexKind, type InterfaceDeclaration, type InterfaceType, isConstructorDeclaration, mapDefined, ModifierFlags, type SourceFile, type Symbol, type SymbolTable, textChanges, type TypeChecker, type UserPreferences } from "../_namespaces/ts.ts";
const errorCodes = [
    Diagnostics.Class_0_incorrectly_implements_interface_1.code,
    Diagnostics.Class_0_incorrectly_implements_class_1_Did_you_mean_to_extend_1_and_inherit_its_members_as_a_subclass.code,
];
const fixId = "fixClassIncorrectlyImplementsInterface"; // TODO: share a group with fixClassDoesntImplementInheritedAbstractMember?
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span } = context;
        const classDeclaration = getClass(sourceFile, span.start);
        return mapDefined<ExpressionWithTypeArguments, CodeFixAction>(getEffectiveImplementsTypeNodes(classDeclaration), implementedTypeNode => {
            const changes = textChanges.ChangeTracker.with(context, t => addMissingDeclarations(context, implementedTypeNode, sourceFile, classDeclaration, t, context.preferences));
            return changes.length === 0 ? undefined : createCodeFixAction(fixId, changes, [Diagnostics.Implement_interface_0, requireCompilerMember(implementedTypeNode, "getText").getText(sourceFile)], fixId, Diagnostics.Implement_all_unimplemented_interfaces);
        });
    },
    fixIds: [fixId],
    getAllCodeActions(context) {
        const seenClassDeclarations = new Set<number>();
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const classDeclaration = getClass(diag.file, diag.start);
            if (addToSeen(seenClassDeclarations, getNodeId(classDeclaration))) {
                for (const implementedTypeNode of (getEffectiveImplementsTypeNodes(classDeclaration))!) {
                    addMissingDeclarations(context, implementedTypeNode, diag.file, classDeclaration, changes, context.preferences);
                }
            }
        });
    },
});
function getClass(sourceFile: SourceFile, pos: number): ClassLikeDeclaration {
    return Debug.checkDefined(getContainingClass(getTokenAtPosition(sourceFile, pos)), "There should be a containing class");
}
function symbolPointsToNonPrivateMember(symbol: Symbol) {
    return !symbol.valueDeclaration || !(getEffectiveModifierFlags(symbol.valueDeclaration) & ModifierFlags.Private);
}
function addMissingDeclarations(context: TypeConstructionContext, implementedTypeNode: ExpressionWithTypeArguments, sourceFile: SourceFile, classDeclaration: ClassLikeDeclaration, changeTracker: textChanges.ChangeTracker, preferences: UserPreferences): void {
    const checker = context.program.getTypeChecker();
    const maybeHeritageClauseSymbol = getHeritageClauseSymbolTable(classDeclaration, checker);
    // Note that this is ultimately derived from a map indexed by symbol names,
    // so duplicates cannot occur.
    const implementedType = checkedCompilerLayout(checker.getTypeAtLocation(implementedTypeNode), checked_isCompilerInterfaceType);
    const implementedTypeSymbols = checker.getPropertiesOfType(implementedType);
    const nonPrivateAndNotExistedInHeritageClauseMembers = implementedTypeSymbols.filter(and(symbolPointsToNonPrivateMember, symbol => !maybeHeritageClauseSymbol.has(symbol.escapedName)));
    const classType = checker.getTypeAtLocation(classDeclaration);
    const constructor = find(classDeclaration.members, m => isConstructorDeclaration(m));
    if (!requireCompilerMember(classType, "getNumberIndexType").getNumberIndexType()) {
        createMissingIndexSignatureDeclaration(implementedType, IndexKind.Number);
    }
    if (!requireCompilerMember(classType, "getStringIndexType").getStringIndexType()) {
        createMissingIndexSignatureDeclaration(implementedType, IndexKind.String);
    }
    const importAdder = createImportAdder(sourceFile, context.program, preferences, context.host);
    createMissingMemberNodes(classDeclaration, nonPrivateAndNotExistedInHeritageClauseMembers, sourceFile, context, preferences, importAdder, member => insertInterfaceMemberNode(sourceFile, classDeclaration, (member)));
    importAdder.writeFixes(changeTracker);
    function createMissingIndexSignatureDeclaration(type: InterfaceType, kind: IndexKind): void {
        const indexInfoOfKind = checker.getIndexInfoOfType(type, kind);
        if (indexInfoOfKind) {
            insertInterfaceMemberNode(sourceFile, classDeclaration, (checker.indexInfoToIndexSignatureDeclaration(indexInfoOfKind, classDeclaration, /*flags*/ undefined, /*internalFlags*/ undefined, getNoopSymbolTrackerWithResolver(context)))!);
        }
    }
    // Either adds the node at the top of the class, or if there's a constructor right after that
    function insertInterfaceMemberNode(sourceFile: SourceFile, cls: ClassLikeDeclaration | InterfaceDeclaration, newElement: ClassElement): void {
        if (constructor) {
            changeTracker.insertNodeAfter(sourceFile, constructor, newElement);
        }
        else {
            changeTracker.insertMemberAtStart(sourceFile, cls, newElement);
        }
    }
}
function getHeritageClauseSymbolTable(classDeclaration: ClassLikeDeclaration, checker: TypeChecker): SymbolTable {
    const heritageClauseNode = getEffectiveBaseTypeNode(classDeclaration);
    if (!heritageClauseNode)
        return createSymbolTable();
    const heritageClauseType = checkedCompilerLayout(checker.getTypeAtLocation(heritageClauseNode), checked_isCompilerInterfaceType);
    const heritageClauseTypeSymbols = checker.getPropertiesOfType(heritageClauseType);
    return createSymbolTable(heritageClauseTypeSymbols.filter(symbolPointsToNonPrivateMember));
}
