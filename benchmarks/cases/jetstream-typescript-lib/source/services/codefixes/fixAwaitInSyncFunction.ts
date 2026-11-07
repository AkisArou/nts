// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixAwaitInSyncFunction.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { addToSeen, type ArrowFunction, Diagnostics, factory, findChildOfKind, first, type FunctionDeclaration, type FunctionExpression, getContainingFunction, getEntityNameFromTypeNode, getNodeId, getTokenAtPosition, isFunctionTypeNode, isVariableDeclaration, type MethodDeclaration, type Node, type SourceFile, SyntaxKind, textChanges, type TypeNode } from "../_namespaces/ts.ts";
const fixId = "fixAwaitInSyncFunction";
const errorCodes = [
    Diagnostics.await_expressions_are_only_allowed_within_async_functions_and_at_the_top_levels_of_modules.code,
    Diagnostics.await_using_statements_are_only_allowed_within_async_functions_and_at_the_top_levels_of_modules.code,
    Diagnostics.for_await_loops_are_only_allowed_within_async_functions_and_at_the_top_levels_of_modules.code,
    Diagnostics.Cannot_find_name_0_Did_you_mean_to_write_this_in_an_async_function.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span } = context;
        const nodes = getNodes(sourceFile, span.start);
        if (!nodes)
            return undefined;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, nodes));
        return [createCodeFixAction(fixId, changes, Diagnostics.Add_async_modifier_to_containing_function, fixId, Diagnostics.Add_all_missing_async_modifiers)];
    },
    fixIds: [fixId],
    getAllCodeActions: function getAllCodeActionsToFixAwaitInSyncFunction(context) {
        const seen = new Set<number>();
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const nodes = getNodes(diag.file, diag.start);
            if (!nodes || !addToSeen(seen, getNodeId(nodes.insertBefore)))
                return;
            doChange(changes, context.sourceFile, nodes);
        });
    },
});
function getReturnType(expr: FunctionDeclaration | MethodDeclaration | FunctionExpression | ArrowFunction) {
    if (expr.type) {
        return expr.type;
    }
    if (testCompilerLayout(expr.parent, isVariableDeclaration) &&
        expr.parent.type &&
        isFunctionTypeNode(expr.parent.type)) {
        return expr.parent.type.type;
    }
}
function getNodes(sourceFile: SourceFile, start: number): {
    insertBefore: Node;
    returnType: TypeNode | undefined;
} | undefined {
    const token = getTokenAtPosition(sourceFile, start);
    const containingFunction = getContainingFunction(token);
    if (!containingFunction) {
        return;
    }
    let insertBefore: Node | undefined;
    switch (containingFunction.kind) {
        case SyntaxKind.MethodDeclaration:
            insertBefore = containingFunction.name;
            break;
        case SyntaxKind.FunctionDeclaration:
        case SyntaxKind.FunctionExpression:
            insertBefore = findChildOfKind(containingFunction, SyntaxKind.FunctionKeyword, sourceFile);
            break;
        case SyntaxKind.ArrowFunction:
            const kind = containingFunction.typeParameters ? SyntaxKind.LessThanToken : SyntaxKind.OpenParenToken;
            insertBefore = findChildOfKind(containingFunction, kind, sourceFile) || first(containingFunction.parameters);
            break;
        default:
            return;
    }
    return insertBefore && {
        insertBefore,
        returnType: getReturnType(containingFunction),
    };
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, { insertBefore, returnType }: {
    insertBefore: Node;
    returnType: TypeNode | undefined;
}): void {
    if (returnType) {
        const entityName = getEntityNameFromTypeNode(returnType);
        if (!entityName || entityName.kind !== SyntaxKind.Identifier || entityName.text !== "Promise") {
            changes.replaceNode(sourceFile, returnType, factory.createTypeReferenceNode("Promise", factory.createNodeArray([returnType])));
        }
    }
    changes.insertModifierBefore(sourceFile, SyntaxKind.AsyncKeyword, insertBefore);
}
