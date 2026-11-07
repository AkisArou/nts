// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/requireInTs.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { SyntaxKind, type CallExpression, type Node } from "../../compiler/types.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { cast, Debug, Diagnostics, factory, first, getAllowSyntheticDefaultImports, getQuotePreference, getTokenAtPosition, type Identifier, type ImportSpecifier, isIdentifier, isNoSubstitutionTemplateLiteral, isObjectBindingPattern, isRequireCall, isVariableDeclaration, isVariableStatement, type NamedImports, type ObjectBindingPattern, type Program, QuotePreference, type SourceFile, type StringLiteralLike, textChanges, tryCast, type UserPreferences, type VariableStatement } from "../_namespaces/ts.ts";
const fixId = "requireInTs";
const errorCodes = [Diagnostics.require_call_may_be_converted_to_an_import.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const info = getInfo(context.sourceFile, context.program, context.span.start, context.preferences);
        if (!info) {
            return undefined;
        }
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, context.sourceFile, info));
        return [createCodeFixAction(fixId, changes, Diagnostics.Convert_require_to_import, fixId, Diagnostics.Convert_all_require_to_import)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const info = getInfo(diag.file, context.program, diag.start, context.preferences);
        if (info) {
            doChange(changes, context.sourceFile, info);
        }
    }),
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, info: Info) {
    const { allowSyntheticDefaults, defaultImportName, namedImports, statement, moduleSpecifier } = info;
    changes.replaceNode(sourceFile, statement, defaultImportName && !allowSyntheticDefaults
        ? factory.createImportEqualsDeclaration(/*modifiers*/ undefined, /*isTypeOnly*/ false, defaultImportName, factory.createExternalModuleReference(moduleSpecifier))
        : factory.createImportDeclaration(/*modifiers*/ undefined, factory.createImportClause(/*phaseModifier*/ undefined, defaultImportName, namedImports), moduleSpecifier, /*attributes*/ undefined));
}
interface Info {
    allowSyntheticDefaults: boolean;
    defaultImportName: Identifier | undefined;
    namedImports: NamedImports | undefined;
    statement: VariableStatement;
    moduleSpecifier: StringLiteralLike;
}
function getInfo(sourceFile: SourceFile, program: Program, pos: number, preferences: UserPreferences): Info | undefined {
    const { parent } = getTokenAtPosition(sourceFile, pos);
    if (!isRequireCall((parent)!, /*requireStringLiteralLikeArgument*/ true)) {
        Debug.failBadSyntaxKind((parent)!);
    }
    const decl = cast((parent)!.parent, isVariableDeclaration);
    const quotePreference = getQuotePreference(sourceFile, preferences);
    const defaultImportName = tryCast(decl.name, isIdentifier);
    const namedImports = isObjectBindingPattern(decl.name) ? tryCreateNamedImportsFromObjectBindingPattern(decl.name) : undefined;
    if (defaultImportName || namedImports) {
        const moduleSpecifier = checkedCompilerLayout(first(checkedCompilerLayout(parent!, isRequireFixCall).arguments), isRequireFixString);
        return {
            allowSyntheticDefaults: getAllowSyntheticDefaultImports(program.getCompilerOptions()),
            defaultImportName,
            namedImports,
            statement: cast(decl.parent.parent, isVariableStatement),
            moduleSpecifier: isNoSubstitutionTemplateLiteral(moduleSpecifier) ? factory.createStringLiteral(moduleSpecifier.text, quotePreference === QuotePreference.Single) : moduleSpecifier,
        };
    }
}
function tryCreateNamedImportsFromObjectBindingPattern(node: ObjectBindingPattern): NamedImports | undefined {
    const importSpecifiers: ImportSpecifier[] = [];
    for (const element of node.elements) {
        if (!isIdentifier(element.name) || element.initializer) {
            return undefined;
        }
        importSpecifiers.push(factory.createImportSpecifier(/*isTypeOnly*/ false, tryCast(element.propertyName, isIdentifier), element.name));
    }
    if (importSpecifiers.length) {
        return factory.createNamedImports(importSpecifiers);
    }
}

function isRequireFixCall(node: Node): node is CallExpression { return node.kind === SyntaxKind.CallExpression; }
function isRequireFixString(node: Node): node is StringLiteralLike {
    return node.kind === SyntaxKind.StringLiteral || node.kind === SyntaxKind.NoSubstitutionTemplateLiteral;
}
