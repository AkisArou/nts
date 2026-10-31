// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixInvalidImportSyntax.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isNamespaceImport as checked_isNamespaceImport } from "../../compiler/factory/nodeTests.ts";
import { createCodeFixActionWithoutFixAll, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { addRange, type CallExpression, type CodeFixAction, type CodeFixContext, Diagnostics, factory, findAncestor, getEmitModuleKind, getNamespaceDeclarationNode, getQuotePreference, getSourceFileOfNode, getTokenAtPosition, type ImportDeclaration, isExpression, isImportCall, isNamedDeclaration, isTransientSymbol, makeImport, ModuleKind, type NamespaceImport, type NewExpression, type Node, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixName = "invalidImportSyntax";
function getCodeFixesForImportDeclaration(context: CodeFixContext, node: ImportDeclaration): CodeFixAction[] {
    const sourceFile = getSourceFileOfNode(node);
    const namespace = checkedCompilerLayout(getNamespaceDeclarationNode(node), checked_isNamespaceImport);
    const opts = context.program.getCompilerOptions();
    const variations: CodeFixAction[] = [];
    // import Bluebird from "bluebird";
    variations.push(createAction(context, sourceFile, node, makeImport((namespace)!.name, /*namedImports*/ undefined, node.moduleSpecifier, getQuotePreference(sourceFile, context.preferences))));
    if (getEmitModuleKind(opts) === ModuleKind.CommonJS) {
        // import Bluebird = require("bluebird");
        variations.push(createAction(context, sourceFile, node, factory.createImportEqualsDeclaration(
        /*modifiers*/ undefined, 
        /*isTypeOnly*/ false, (namespace)!.name, factory.createExternalModuleReference(node.moduleSpecifier))));
    }
    return variations;
}
function createAction(context: CodeFixContext, sourceFile: SourceFile, node: Node, replacement: Node): CodeFixAction {
    const changes = textChanges.ChangeTracker.with(context, t => t.replaceNode(sourceFile, node, replacement));
    return createCodeFixActionWithoutFixAll(fixName, changes, [Diagnostics.Replace_import_with_0, changes[0].textChanges[0].newText]);
}
registerCodeFix({
    errorCodes: [
        Diagnostics.This_expression_is_not_callable.code,
        Diagnostics.This_expression_is_not_constructable.code,
    ],
    getCodeActions: getActionsForUsageOfInvalidImport,
});
function getActionsForUsageOfInvalidImport(context: CodeFixContext): CodeFixAction[] | undefined {
    const sourceFile = context.sourceFile;
    const targetKind = Diagnostics.This_expression_is_not_callable.code === context.errorCode ? SyntaxKind.CallExpression : SyntaxKind.NewExpression;
    const node = findAncestor(getTokenAtPosition(sourceFile, context.span.start), a => a.kind === targetKind);
    if (!node) {
        return [];
    }
    const expr = checkedCompilerLayout(node, isInvalidImportCallOrNew).expression;
    return getImportCodeFixesForExpression(context, expr);
}
registerCodeFix({
    errorCodes: [
        // The following error codes cover pretty much all assignability errors that could involve an expression
        Diagnostics.Argument_of_type_0_is_not_assignable_to_parameter_of_type_1.code,
        Diagnostics.Type_0_does_not_satisfy_the_constraint_1.code,
        Diagnostics.Type_0_is_not_assignable_to_type_1.code,
        Diagnostics.Type_0_is_not_assignable_to_type_1_Two_different_types_with_this_name_exist_but_they_are_unrelated.code,
        Diagnostics.Type_predicate_0_is_not_assignable_to_1.code,
        Diagnostics.Property_0_of_type_1_is_not_assignable_to_2_index_type_3.code,
        Diagnostics._0_index_type_1_is_not_assignable_to_2_index_type_3.code,
        Diagnostics.Property_0_in_type_1_is_not_assignable_to_the_same_property_in_base_type_2.code,
        Diagnostics.Property_0_in_type_1_is_not_assignable_to_type_2.code,
        Diagnostics.Property_0_of_JSX_spread_attribute_is_not_assignable_to_target_property.code,
        Diagnostics.The_this_context_of_type_0_is_not_assignable_to_method_s_this_of_type_1.code,
    ],
    getCodeActions: getActionsForInvalidImportLocation,
});
function getActionsForInvalidImportLocation(context: CodeFixContext): CodeFixAction[] | undefined {
    const sourceFile = context.sourceFile;
    const node = findAncestor(getTokenAtPosition(sourceFile, context.span.start), a => requireCompilerMember(a, "getStart").getStart() === context.span.start && requireCompilerMember(a, "getEnd").getEnd() === (context.span.start + context.span.length));
    if (!node) {
        return [];
    }
    return getImportCodeFixesForExpression(context, node);
}
function getImportCodeFixesForExpression(context: CodeFixContext, expr: Node): CodeFixAction[] | undefined {
    const type = context.program.getTypeChecker().getTypeAtLocation(expr);
    if (!(type.symbol && isTransientSymbol(type.symbol) && type.symbol.links.originatingImport)) {
        return [];
    }
    const fixes: CodeFixAction[] = [];
    const relatedImport = type.symbol.links.originatingImport;
    if (!isImportCall(relatedImport)) {
        addRange(fixes, getCodeFixesForImportDeclaration(context, relatedImport));
    }
    if (isExpression(expr) && !(testCompilerLayout(expr.parent, isNamedDeclaration) && expr.parent.name === expr)) {
        const sourceFile = context.sourceFile;
        const changes = textChanges.ChangeTracker.with(context, t => t.replaceNode(sourceFile, expr, factory.createPropertyAccessExpression(expr, "default"), {}));
        fixes.push(createCodeFixActionWithoutFixAll(fixName, changes, Diagnostics.Use_synthetic_default_member));
    }
    return fixes;
}

function isInvalidImportCallOrNew(node: Node): node is CallExpression | NewExpression {
    return node.kind === SyntaxKind.CallExpression || node.kind === SyntaxKind.NewExpression;
}
