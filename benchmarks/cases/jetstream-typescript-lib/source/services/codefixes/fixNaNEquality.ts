// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixNaNEquality.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, findAncestorMatchingSpan, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type BinaryExpression, createTextSpan, type DiagnosticMessageChain, Diagnostics, type Expression, factory, find, flattenDiagnosticMessageText, isBinaryExpression, isExpression, type Program, type SourceFile, SyntaxKind, textChanges, type TextSpan } from "../_namespaces/ts.ts";
const fixId = "fixNaNEquality";
const errorCodes = [
    Diagnostics.This_condition_will_always_return_0.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile, span, program } = context;
        const info = getInfo(program, sourceFile, span);
        if (info === undefined)
            return;
        const { suggestion, expression, arg } = info;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, arg, expression));
        return [createCodeFixAction(fixId, changes, [Diagnostics.Use_0, suggestion], fixId, Diagnostics.Use_Number_isNaN_in_all_conditions)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => {
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const info = getInfo(context.program, diag.file, createTextSpan(diag.start, diag.length));
            if (info) {
                doChange(changes, diag.file, info.arg, info.expression);
            }
        });
    },
});
interface Info {
    suggestion: string;
    expression: BinaryExpression;
    arg: Expression;
}
function getInfo(program: Program, sourceFile: SourceFile, span: TextSpan): Info | undefined {
    const diag = find(program.getSemanticDiagnostics(sourceFile), diag => diag.start === span.start && diag.length === span.length);
    if (diag === undefined || diag.relatedInformation === undefined)
        return;
    const related = find(diag.relatedInformation, related => related.code === Diagnostics.Did_you_mean_0.code);
    if (related === undefined || related.file === undefined || related.start === undefined || related.length === undefined)
        return;
    const token = findAncestorMatchingSpan(related.file, createTextSpan(related.start, related.length));
    if (token === undefined)
        return;
    if (isExpression(token) && testCompilerLayout(token.parent, isBinaryExpression)) {
        return { suggestion: getSuggestion(related.messageText), expression: token.parent, arg: token };
    }
    return undefined;
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, arg: Expression, expression: BinaryExpression) {
    const callExpression = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("Number"), factory.createIdentifier("isNaN")), 
    /*typeArguments*/ undefined, [arg]);
    const operator = expression.operatorToken.kind;
    changes.replaceNode(sourceFile, expression, operator === SyntaxKind.ExclamationEqualsEqualsToken || operator === SyntaxKind.ExclamationEqualsToken
        ? factory.createPrefixUnaryExpression(SyntaxKind.ExclamationToken, callExpression) : callExpression);
}
function getSuggestion(messageText: string | DiagnosticMessageChain) {
    const [, suggestion] = flattenDiagnosticMessageText(messageText, "\n", 0).match(/'(.*)'/) || [];
    return suggestion;
}
