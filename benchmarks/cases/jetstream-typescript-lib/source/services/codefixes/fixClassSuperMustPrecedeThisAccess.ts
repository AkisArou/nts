// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixClassSuperMustPrecedeThisAccess.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isNodeLayout_ee724129a7be } from "../../checkedLayouts.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isConstructorDeclaration as checked_isConstructorDeclaration } from "../../compiler/factory/nodeTests.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { addToSeen, type CallExpression, type ConstructorDeclaration, Diagnostics, type ExpressionStatement, forEachChild, getContainingFunction, getNodeId, getTokenAtPosition, isExpressionStatement, isFunctionLike, isPropertyAccessExpression, isSuperCall, type Node, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixId = "classSuperMustPrecedeThisAccess";
const errorCodes = [Diagnostics.super_must_be_called_before_accessing_this_in_the_constructor_of_a_derived_class.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span } = context;
        const nodes = getNodes(sourceFile, span.start);
        if (!nodes)
            return undefined;
        const { constructor, superCall } = nodes;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, constructor, superCall));
        return [createCodeFixAction(fixId, changes, Diagnostics.Make_super_call_the_first_statement_in_the_constructor, fixId, Diagnostics.Make_all_super_calls_the_first_statement_in_their_constructor)];
    },
    fixIds: [fixId],
    getAllCodeActions(context) {
        const { sourceFile } = context;
        const seenClasses = new Set<number>(); // Ensure we only do this once per class.
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const nodes = getNodes(diag.file, diag.start);
            if (!nodes)
                return;
            const { constructor, superCall } = nodes;
            if (addToSeen(seenClasses, getNodeId(constructor.parent))) {
                doChange(changes, sourceFile, constructor, superCall);
            }
        });
    },
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, constructor: ConstructorDeclaration, superCall: ExpressionStatement): void {
    changes.insertNodeAtConstructorStart(sourceFile, constructor, superCall);
    changes.delete(sourceFile, superCall);
}
function getNodes(sourceFile: SourceFile, pos: number): {
    constructor: ConstructorDeclaration;
    superCall: ExpressionStatement;
} | undefined {
    const token = getTokenAtPosition(sourceFile, pos);
    if (token.kind !== SyntaxKind.ThisKeyword)
        return undefined;
    const constructor = checkedCompilerLayout(getContainingFunction(token), checked_isConstructorDeclaration);
    const superCall = findSuperCall(((constructor)!.body)!);
    // figure out if the `this` access is actually inside the supercall
    // i.e. super(this.a), since in that case we won't suggest a fix
    return superCall && !superCall.expression.arguments.some(arg => isPropertyAccessExpression(arg) && arg.expression === token) ? { constructor: (constructor)!, superCall } : undefined;
}
function findSuperCall(n: Node): ExpressionStatement & {
    expression: CallExpression;
} | undefined {
    return isExpressionStatement(n) && isSuperCall(n.expression)
        ? checkedCompilerLayout(n, isNodeLayout_ee724129a7be) : isFunctionLike(n)
        ? undefined
        : forEachChild(n, findSuperCall);
}
