// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixExpectedComma.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, getTokenAtPosition, isArrayLiteralExpression, isObjectLiteralExpression, type Node, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixId = "fixExpectedComma";
const expectedErrorCode = Diagnostics._0_expected.code;
const errorCodes = [expectedErrorCode];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile } = context;
        const info = getInfo(sourceFile, context.span.start, context.errorCode);
        if (!info)
            return undefined;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, info));
        return [createCodeFixAction(fixId, changes, [Diagnostics.Change_0_to_1, ";", ","], fixId, [Diagnostics.Change_0_to_1, ";", ","])];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const info = getInfo(diag.file, diag.start, diag.code);
        if (info)
            doChange(changes, context.sourceFile, info);
    }),
});
interface Info {
    node: Node;
}
function getInfo(sourceFile: SourceFile, pos: number, _: number): Info | undefined {
    const node = getTokenAtPosition(sourceFile, pos);
    return (node.kind === SyntaxKind.SemicolonToken &&
        node.parent &&
        (isObjectLiteralExpression(node.parent) ||
            isArrayLiteralExpression(node.parent))) ? { node } : undefined;
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, { node }: Info): void {
    const newNode = factory.createToken(SyntaxKind.CommaToken);
    changes.replaceNode(sourceFile, node, newNode);
}
