// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/convertToTypeOnlyImport.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isNodeLayout_a9aa2b938ccb } from "../../checkedLayouts.ts";
import { testCompilerLayout } from "../../checked.ts";
import { isImportDeclaration as checked_isImportDeclaration } from "../_namespaces/ts.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isImportClause as checked_isImportClause } from "../../compiler/factory/nodeTests.ts";
import { codeFixAll, createCodeFixAction, createCodeFixActionWithoutFixAll, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, FindAllReferences, getSynthesizedDeepClone, getSynthesizedDeepClones, getTokenAtPosition, type ImportClause, type ImportDeclaration, type ImportSpecifier, isImportDeclaration, isImportSpecifier, isValidTypeOnlyAliasUseSite, type Program, sameMap, some, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const errorCodes = [
    Diagnostics._0_is_a_type_and_must_be_imported_using_a_type_only_import_when_verbatimModuleSyntax_is_enabled.code,
    Diagnostics._0_resolves_to_a_type_only_declaration_and_must_be_imported_using_a_type_only_import_when_verbatimModuleSyntax_is_enabled.code,
];
const fixId = "convertToTypeOnlyImport";
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToConvertToTypeOnlyImport(context) {
        const declaration = getDeclaration(context.sourceFile, context.span.start);
        if (declaration) {
            const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, declaration));
            const importDeclarationChanges = declaration.kind === SyntaxKind.ImportSpecifier && isImportDeclaration(declaration.parent.parent.parent) && canConvertImportDeclarationForSpecifier(declaration, context.sourceFile, context.program)
                ? textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, checkedCompilerLayout(declaration.parent.parent.parent, checked_isImportDeclaration)))
                : undefined;
            const mainAction = createCodeFixAction(fixId, changes, declaration.kind === SyntaxKind.ImportSpecifier
                ? [Diagnostics.Use_type_0, declaration.propertyName?.text ?? declaration.name.text]
                : Diagnostics.Use_import_type, fixId, Diagnostics.Fix_all_with_type_only_imports);
            if (some(importDeclarationChanges)) {
                return [
                    createCodeFixActionWithoutFixAll(fixId, importDeclarationChanges, Diagnostics.Use_import_type),
                    mainAction,
                ];
            }
            return [mainAction];
        }
        return undefined;
    },
    fixIds: [fixId],
    getAllCodeActions: function getAllCodeActionsToConvertToTypeOnlyImport(context) {
        const fixedImportDeclarations = new Set<ImportDeclaration>();
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const errorDeclaration = getDeclaration(diag.file, diag.start);
            if (errorDeclaration?.kind === SyntaxKind.ImportDeclaration && !fixedImportDeclarations.has(errorDeclaration)) {
                doChange(changes, diag.file, errorDeclaration);
                fixedImportDeclarations.add(errorDeclaration);
            }
            else if (errorDeclaration?.kind === SyntaxKind.ImportSpecifier
                && isImportDeclaration(errorDeclaration.parent.parent.parent)
                && !fixedImportDeclarations.has(errorDeclaration.parent.parent.parent)
                && canConvertImportDeclarationForSpecifier(errorDeclaration, diag.file, context.program)) {
                doChange(changes, diag.file, errorDeclaration.parent.parent.parent);
                fixedImportDeclarations.add(errorDeclaration.parent.parent.parent);
            }
            else if (errorDeclaration?.kind === SyntaxKind.ImportSpecifier) {
                doChange(changes, diag.file, errorDeclaration);
            }
        });
    },
});
function getDeclaration(sourceFile: SourceFile, pos: number) {
    const { parent } = getTokenAtPosition(sourceFile, pos);
    return testCompilerLayout(parent, isImportSpecifier) || testCompilerLayout(parent, isImportDeclaration) && parent.importClause ? parent : undefined;
}
function canConvertImportDeclarationForSpecifier(specifier: ImportSpecifier, sourceFile: SourceFile, program: Program): boolean {
    if (specifier.parent.parent.name) {
        // An import declaration with a default import and named bindings can't be type-only
        return false;
    }
    const nonTypeOnlySpecifiers = specifier.parent.elements.filter(e => !e.isTypeOnly);
    if (nonTypeOnlySpecifiers.length === 1) {
        // If the error specifier is on the only non-type-only specifier, we can convert the whole import
        return true;
    }
    // Otherwise, we need to check the usage of the other specifiers
    const checker = program.getTypeChecker();
    for (const specifier of nonTypeOnlySpecifiers) {
        const isUsedAsValue = FindAllReferences.Core.eachSymbolReferenceInFile(specifier.name, checker, sourceFile, usage => {
            const symbol = checker.getSymbolAtLocation(usage);
            return !!symbol && checker.symbolIsValue(symbol) || !isValidTypeOnlyAliasUseSite(usage);
        });
        if (isUsedAsValue) {
            return false;
        }
    }
    // No other specifiers are used as values, so we can convert the whole import
    return true;
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, declaration: ImportDeclaration | ImportSpecifier) {
    if (isImportSpecifier(declaration)) {
        changes.replaceNode(sourceFile, declaration, factory.updateImportSpecifier(declaration, /*isTypeOnly*/ true, declaration.propertyName, declaration.name));
    }
    else {
        const importClause = (declaration.importClause);
        if ((importClause)!.name && (importClause)!.namedBindings) {
            changes.replaceNodeWithNodes(sourceFile, declaration, [
                factory.createImportDeclaration(getSynthesizedDeepClones(declaration.modifiers, /*includeTrivia*/ true), factory.createImportClause(SyntaxKind.TypeKeyword, getSynthesizedDeepClone((importClause)!.name, /*includeTrivia*/ true), /*namedBindings*/ undefined), getSynthesizedDeepClone(declaration.moduleSpecifier, /*includeTrivia*/ true), getSynthesizedDeepClone(declaration.attributes, /*includeTrivia*/ true)),
                factory.createImportDeclaration(getSynthesizedDeepClones(declaration.modifiers, /*includeTrivia*/ true), factory.createImportClause(SyntaxKind.TypeKeyword, /*name*/ undefined, getSynthesizedDeepClone((importClause)!.namedBindings, /*includeTrivia*/ true)), getSynthesizedDeepClone(declaration.moduleSpecifier, /*includeTrivia*/ true), getSynthesizedDeepClone(declaration.attributes, /*includeTrivia*/ true)),
            ]);
        }
        else {
            const newNamedBindings = (importClause)!.namedBindings?.kind === SyntaxKind.NamedImports
                ? factory.updateNamedImports((checkedCompilerLayout((importClause)!.namedBindings, isNodeLayout_a9aa2b938ccb))!, sameMap((checkedCompilerLayout((importClause)!.namedBindings, isNodeLayout_a9aa2b938ccb))!.elements, e => factory.updateImportSpecifier(e, /*isTypeOnly*/ false, e.propertyName, e.name)))
                : (importClause)!.namedBindings;
            const importDeclaration = factory.updateImportDeclaration(declaration, declaration.modifiers, factory.updateImportClause((importClause)!, SyntaxKind.TypeKeyword, (importClause)!.name, newNamedBindings), declaration.moduleSpecifier, declaration.attributes);
            changes.replaceNode(sourceFile, declaration, importDeclaration);
        }
    }
}
