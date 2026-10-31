// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/refactors/convertExport.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { ModuleDeclaration } from "../../compiler/types.ts";
import { isImportSpecifier, isExportSpecifier } from "../../compiler/factory/nodeTests.ts";
import { isImportOrExportSpecifier } from "../_namespaces/ts.ts";
import { requireCompilerMember } from "../../checked.ts";
import { isNodeLayout_beb74bd086d0 } from "../../checkedLayouts.ts";
import { testCompilerLayout } from "../../checked.ts";
import { isIdentifier as checked_isIdentifier } from "../_namespaces/ts.ts";
import { isExportAssignment as checked_isExportAssignment } from "../_namespaces/ts.ts";
import { checkedCompilerLayout, present } from "../../checked.ts";
import { isVariableStatement as checked_isVariableStatement } from "../../compiler/factory/nodeTests.ts";
import { isImportClause as checked_isImportClause } from "../../compiler/factory/nodeTests.ts";
import { isImportTypeNode as checked_isImportTypeNode } from "../../compiler/factory/nodeTests.ts";
import { type ApplicableRefactorInfo, type CancellationToken, type ClassDeclaration, Debug, Diagnostics, emptyArray, type EnumDeclaration, type ExportAssignment, type ExportSpecifier, factory, FindAllReferences, findModifier, first, type FunctionDeclaration, getLocaleSpecificMessage, getParentNodeInSpan, getRefactorContextSpan, getSyntacticModifierFlags, getTokenAtPosition, type Identifier, type ImportClause, type ImportSpecifier, type ImportTypeNode, type InterfaceDeclaration, InternalSymbolName, isAmbientModule, isExportAssignment, isExternalModuleAugmentation, isIdentifier, isModuleBlock, isSourceFile, isStringLiteral, makeImport, ModifierFlags, type ModuleBlock, type ModuleExportName, type NamespaceDeclaration, type Node, NodeFlags, type Program, type PropertyAccessExpression, QuotePreference, quotePreferenceFromString, type RefactorContext, type RefactorEditInfo, type SourceFile, type Symbol, SyntaxKind, textChanges, type TypeAliasDeclaration, type TypeChecker, type VariableStatement } from "../_namespaces/ts.ts";
import { isRefactorErrorInfo, type RefactorErrorInfo, registerRefactor } from "../_namespaces/ts.refactor.ts";
const refactorName = "Convert export";
const defaultToNamedAction = {
    name: "Convert default export to named export",
    description: getLocaleSpecificMessage(Diagnostics.Convert_default_export_to_named_export),
    kind: "refactor.rewrite.export.named",
};
const namedToDefaultAction = {
    name: "Convert named export to default export",
    description: getLocaleSpecificMessage(Diagnostics.Convert_named_export_to_default_export),
    kind: "refactor.rewrite.export.default",
};
registerRefactor(refactorName, {
    kinds: [
        defaultToNamedAction.kind,
        namedToDefaultAction.kind,
    ],
    getAvailableActions: function getRefactorActionsToConvertBetweenNamedAndDefaultExports(context): readonly ApplicableRefactorInfo[] {
        const info = getInfo(context, context.triggerReason === "invoked");
        if (!info)
            return emptyArray;
        if (!isRefactorErrorInfo(info)) {
            const action = info.wasDefault ? defaultToNamedAction : namedToDefaultAction;
            return [{ name: refactorName, description: action.description, actions: [action] }];
        }
        if (context.preferences.provideRefactorNotApplicableReason) {
            return [
                {
                    name: refactorName,
                    description: getLocaleSpecificMessage(Diagnostics.Convert_default_export_to_named_export),
                    actions: [
                        { ...defaultToNamedAction, notApplicableReason: info.error },
                        { ...namedToDefaultAction, notApplicableReason: info.error },
                    ],
                },
            ];
        }
        return emptyArray;
    },
    getEditsForAction: function getRefactorEditsToConvertBetweenNamedAndDefaultExports(context, actionName): RefactorEditInfo {
        Debug.assert(actionName === defaultToNamedAction.name || actionName === namedToDefaultAction.name, "Unexpected action name");
        const info = getInfo(context);
        Debug.assert(info && !isRefactorErrorInfo(info), "Expected applicable refactor info");
        const edits = textChanges.ChangeTracker.with(context, t => doChange(context.file, context.program, info, t, context.cancellationToken));
        return { edits, renameFilename: undefined, renameLocation: undefined };
    },
});
// If a VariableStatement, will have exactly one VariableDeclaration, with an Identifier for a name.
type ExportToConvert = FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | EnumDeclaration | ModuleDeclaration | TypeAliasDeclaration | VariableStatement | ExportAssignment;
interface ExportInfo {
    exportNode: ExportToConvert;
    exportName: Identifier; // This is exportNode.name except for VariableStatement_s.
    wasDefault: boolean;
    exportingModuleSymbol: Symbol;
}
function getInfo(context: RefactorContext, considerPartialSpans = true): ExportInfo | RefactorErrorInfo | undefined {
    const { file, program } = context;
    const span = getRefactorContextSpan(context);
    const token = getTokenAtPosition(file, span.start);
    const exportNode = !!(token.parent && getSyntacticModifierFlags(token.parent) & ModifierFlags.Export) && considerPartialSpans ? token.parent : getParentNodeInSpan(token, file, span);
    if (!exportNode || (!testCompilerLayout(exportNode.parent, isSourceFile) && !(testCompilerLayout(exportNode.parent, isModuleBlock) && isAmbientModule(exportNode.parent.parent)))) {
        return { error: getLocaleSpecificMessage(Diagnostics.Could_not_find_export_statement) };
    }
    const checker = program.getTypeChecker();
    const exportingModuleSymbol = getExportingModuleSymbol(exportNode.parent, checker)!;
    const flags = getSyntacticModifierFlags(exportNode) || ((isExportAssignment(exportNode) && !exportNode.isExportEquals) ? ModifierFlags.ExportDefault : ModifierFlags.None);
    const wasDefault = !!(flags & ModifierFlags.Default);
    // If source file already has a default export, don't offer refactor.
    if (!(flags & ModifierFlags.Export) || !wasDefault && ((exportingModuleSymbol)!.exports)!.has(InternalSymbolName.Default)) {
        return { error: getLocaleSpecificMessage(Diagnostics.This_file_already_has_a_default_export) };
    }
    const noSymbolError = (id: Node) => (isIdentifier(id) && checker.getSymbolAtLocation(id)) ? undefined
        : { error: getLocaleSpecificMessage(Diagnostics.Can_only_convert_named_export) };
    switch (exportNode.kind) {
        case SyntaxKind.FunctionDeclaration:
        case SyntaxKind.ClassDeclaration:
        case SyntaxKind.InterfaceDeclaration:
        case SyntaxKind.EnumDeclaration:
        case SyntaxKind.TypeAliasDeclaration:
        case SyntaxKind.ModuleDeclaration: {
            const node = checkedCompilerLayout(exportNode, isNamedExportDeclaration);
            if (!node.name)
                return undefined;
            return noSymbolError(node.name)
                || { exportNode: node, exportName: checkedCompilerLayout(node.name, checked_isIdentifier), wasDefault, exportingModuleSymbol };
        }
        case SyntaxKind.VariableStatement: {
            const vs = checkedCompilerLayout(exportNode, checked_isVariableStatement);
            // Must be `export const x = something;`.
            if (!(vs.declarationList.flags & NodeFlags.Const) || vs.declarationList.declarations.length !== 1) {
                return undefined;
            }
            const decl = first(vs.declarationList.declarations);
            if (!decl.initializer)
                return undefined;
            Debug.assert(!wasDefault, "Can't have a default flag here");
            return noSymbolError(decl.name)
                || { exportNode: vs, exportName: checkedCompilerLayout(decl.name, checked_isIdentifier), wasDefault, exportingModuleSymbol };
        }
        case SyntaxKind.ExportAssignment: {
            const node = checkedCompilerLayout(exportNode, checked_isExportAssignment);
            if (node.isExportEquals)
                return undefined;
            return noSymbolError(node.expression)
                || { exportNode: node, exportName: checkedCompilerLayout(node.expression, checked_isIdentifier), wasDefault, exportingModuleSymbol };
        }
        default:
            return undefined;
    }
}
function doChange(exportingSourceFile: SourceFile, program: Program, info: ExportInfo, changes: textChanges.ChangeTracker, cancellationToken: CancellationToken | undefined): void {
    changeExport(exportingSourceFile, info, changes, program.getTypeChecker());
    changeImports(program, info, changes, cancellationToken);
}
function changeExport(exportingSourceFile: SourceFile, { wasDefault, exportNode, exportName }: ExportInfo, changes: textChanges.ChangeTracker, checker: TypeChecker): void {
    if (wasDefault) {
        if (isExportAssignment(exportNode) && !exportNode.isExportEquals) {
            const exp = checkedCompilerLayout(exportNode.expression, checked_isIdentifier);
            const spec = makeExportSpecifier((exp.text)!, exp.text!);
            changes.replaceNode(exportingSourceFile, exportNode, factory.createExportDeclaration(/*modifiers*/ undefined, /*isTypeOnly*/ false, factory.createNamedExports([spec])));
        }
        else {
            changes.delete(exportingSourceFile, Debug.checkDefined(findModifier(exportNode, SyntaxKind.DefaultKeyword), "Should find a default keyword in modifier list"));
        }
    }
    else {
        const exportKeyword = Debug.checkDefined(findModifier(exportNode, SyntaxKind.ExportKeyword), "Should find an export keyword in modifier list");
        switch (exportNode.kind) {
            case SyntaxKind.FunctionDeclaration:
            case SyntaxKind.ClassDeclaration:
            case SyntaxKind.InterfaceDeclaration:
                changes.insertNodeAfter(exportingSourceFile, exportKeyword, factory.createToken(SyntaxKind.DefaultKeyword));
                break;
            case SyntaxKind.VariableStatement:
                // If 'x' isn't used in this file and doesn't have type definition, `export const x = 0;` --> `export default 0;`
                const decl = first(exportNode.declarationList.declarations);
                if (!FindAllReferences.Core.isSymbolReferencedInFile(exportName, checker, exportingSourceFile) && !decl.type) {
                    // We checked in `getInfo` that an initializer exists.
                    changes.replaceNode(exportingSourceFile, exportNode, factory.createExportDefault(Debug.checkDefined(decl.initializer, "Initializer was previously known to be present")));
                    break;
                }
            // falls through
            case SyntaxKind.EnumDeclaration:
            case SyntaxKind.TypeAliasDeclaration:
            case SyntaxKind.ModuleDeclaration:
                // `export type T = number;` -> `type T = number; export default T;`
                changes.deleteModifier(exportingSourceFile, exportKeyword);
                changes.insertNodeAfter(exportingSourceFile, exportNode, factory.createExportDefault(factory.createIdentifier((exportName.text)!)));
                break;
            default:
                Debug.fail(`Unexpected exportNode kind ${(exportNode).kind}`);
        }
    }
}
function changeImports(program: Program, { wasDefault, exportName, exportingModuleSymbol }: ExportInfo, changes: textChanges.ChangeTracker, cancellationToken: CancellationToken | undefined): void {
    const checker = program.getTypeChecker();
    const exportSymbol = Debug.checkDefined(checker.getSymbolAtLocation(exportName), "Export name should resolve to a symbol");
    FindAllReferences.Core.eachExportReference(program.getSourceFiles(), checker, cancellationToken, exportSymbol, exportingModuleSymbol, (exportName.text)!, wasDefault, ref => {
        if (exportName === ref)
            return;
        const importingSourceFile = requireCompilerMember(ref, "getSourceFile").getSourceFile();
        if (wasDefault) {
            changeDefaultToNamedImport(importingSourceFile, ref, changes, (exportName.text)!);
        }
        else {
            changeNamedToDefaultImport(importingSourceFile, ref, changes);
        }
    });
}
function changeDefaultToNamedImport(importingSourceFile: SourceFile, ref: ModuleExportName, changes: textChanges.ChangeTracker, exportName: string): void {
    const { parent } = ref;
    switch ((parent)!.kind) {
        case SyntaxKind.PropertyAccessExpression:
            // `a.default` --> `a.foo`
            changes.replaceNode(importingSourceFile, ref, factory.createIdentifier(exportName));
            break;
        case SyntaxKind.ImportSpecifier:
        case SyntaxKind.ExportSpecifier: {
            const spec = checkedCompilerLayout(parent!, isImportOrExportSpecifier);
            // `default as foo` --> `foo`, `default as bar` --> `foo as bar`
            changes.replaceNode(importingSourceFile, (spec)!, makeImportSpecifier(exportName, (spec)!.name.text!));
            break;
        }
        case SyntaxKind.ImportClause: {
            const clause = checkedCompilerLayout(parent, checked_isImportClause);
            Debug.assert((clause)!.name === ref, "Import clause name should match provided ref");
            const spec = makeImportSpecifier(exportName, (ref.text)!);
            const { namedBindings } = clause!;
            if (!namedBindings) {
                // `import foo from "./a";` --> `import { foo } from "./a";`
                changes.replaceNode(importingSourceFile, ref, factory.createNamedImports([spec]));
            }
            else if (namedBindings.kind === SyntaxKind.NamespaceImport) {
                // `import foo, * as a from "./a";` --> `import * as a from ".a/"; import { foo } from "./a";`
                changes.deleteRange(importingSourceFile, { pos: requireCompilerMember(ref, "getStart").getStart(importingSourceFile), end: requireCompilerMember(namedBindings, "getStart").getStart(importingSourceFile) });
                const quotePreference = isStringLiteral((clause)!.parent.moduleSpecifier) ? quotePreferenceFromString(checkedCompilerLayout((clause)!.parent.moduleSpecifier, isNodeLayout_beb74bd086d0), importingSourceFile) : QuotePreference.Double;
                const newImport = makeImport(/*defaultImport*/ undefined, [makeImportSpecifier(exportName, (ref.text)!)], (clause)!.parent.moduleSpecifier, quotePreference);
                changes.insertNodeAfter(importingSourceFile, (clause)!.parent, newImport);
            }
            else {
                // `import foo, { bar } from "./a"` --> `import { bar, foo } from "./a";`
                changes.delete(importingSourceFile, ref);
                changes.insertNodeAtEndOfList(importingSourceFile, namedBindings.elements, spec);
            }
            break;
        }
        case SyntaxKind.ImportType:
            const importTypeNode = checkedCompilerLayout(parent, checked_isImportTypeNode);
            changes.replaceNode(importingSourceFile, (parent)!, factory.createImportTypeNode((importTypeNode)!.argument, (importTypeNode)!.attributes, factory.createIdentifier(exportName), (importTypeNode)!.typeArguments, (importTypeNode)!.isTypeOf));
            break;
        default:
            Debug.failBadSyntaxKind((parent)!);
    }
}
function changeNamedToDefaultImport(importingSourceFile: SourceFile, ref: ModuleExportName, changes: textChanges.ChangeTracker): void {
    const parent = ref.parent;
    switch ((parent)!.kind) {
        case SyntaxKind.PropertyAccessExpression:
            // `a.foo` --> `a.default`
            changes.replaceNode(importingSourceFile, ref, factory.createIdentifier("default"));
            break;
        case SyntaxKind.ImportSpecifier: {
            // `import { foo } from "./a";` --> `import foo from "./a";`
            // `import { foo as bar } from "./a";` --> `import bar from "./a";`
            const importSpecifier = checkedCompilerLayout(parent!, isImportSpecifier);
            const defaultImport = factory.createIdentifier(importSpecifier.name.text!);
            if (importSpecifier.parent.elements.length === 1) {
                changes.replaceNode(importingSourceFile, ((parent)!.parent)!, defaultImport);
            }
            else {
                changes.delete(importingSourceFile, (parent)!);
                changes.insertNodeBefore(importingSourceFile, ((parent)!.parent)!, defaultImport);
            }
            break;
        }
        case SyntaxKind.ExportSpecifier: {
            // `export { foo } from "./a";` --> `export { default as foo } from "./a";`
            // `export { foo as bar } from "./a";` --> `export { default as bar } from "./a";`
            // `export { foo as default } from "./a";` --> `export { default } from "./a";`
            // (Because `export foo from "./a";` isn't valid syntax.)
            changes.replaceNode(importingSourceFile, (parent)!, makeExportSpecifier("default", checkedCompilerLayout(parent!, isExportSpecifier).name.text!));
            break;
        }
        default:
            Debug.assertNever(parent, `Unexpected parent kind ${((parent))!.kind}`);
    }
}
function makeImportSpecifier(propertyName: string, name: string): ImportSpecifier {
    return factory.createImportSpecifier(/*isTypeOnly*/ false, propertyName === name ? undefined : factory.createIdentifier(propertyName), factory.createIdentifier(name));
}
function makeExportSpecifier(propertyName: string, name: string): ExportSpecifier {
    return factory.createExportSpecifier(/*isTypeOnly*/ false, propertyName === name ? undefined : factory.createIdentifier(propertyName), factory.createIdentifier(name));
}
function getExportingModuleSymbol(parent: SourceFile | ModuleBlock, checker: TypeChecker) {
    if (isSourceFile(parent)) {
        return parent.symbol;
    }
    const symbol = parent.parent.symbol;
    if ((symbol)!.valueDeclaration && testCompilerLayout((symbol)!.valueDeclaration, isExternalModuleAugmentation)) {
        return checker.getMergedSymbol((symbol)!);
    }
    return symbol;
}

type NamedExportDeclaration = FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | EnumDeclaration | ModuleDeclaration | TypeAliasDeclaration;
function isNamedExportDeclaration(node: Node): node is NamedExportDeclaration {
    return node.kind === SyntaxKind.FunctionDeclaration || node.kind === SyntaxKind.ClassDeclaration
        || node.kind === SyntaxKind.InterfaceDeclaration || node.kind === SyntaxKind.EnumDeclaration
        || node.kind === SyntaxKind.TypeAliasDeclaration || node.kind === SyntaxKind.ModuleDeclaration;
}
