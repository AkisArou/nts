// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/addMissingAsync.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { DiagnosticRelatedInformation, Node } from "../../compiler/types.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { requireCompilerMember } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type ArrowFunction, type CodeFixAllContext, type CodeFixContext, createTextSpanFromNode, type Diagnostic, Diagnostics, factory, type FileTextChanges, find, findAncestor, type FunctionDeclaration, type FunctionExpression, getNodeId, getSyntacticModifierFlags, getSynthesizedDeepClone, getTokenAtPosition, isArrowFunction, isFunctionDeclaration, isFunctionExpression, isMethodDeclaration, isNumber, type MethodDeclaration, ModifierFlags, some, type SourceFile, textChanges, type TextSpan, textSpanEnd, textSpansEqual } from "../_namespaces/ts.ts";
type ContextualTrackChangesFunction = (cb: (changeTracker: textChanges.ChangeTracker) => void) => FileTextChanges[];
const fixId = "addMissingAsync";
const errorCodes = [
    Diagnostics.Argument_of_type_0_is_not_assignable_to_parameter_of_type_1.code,
    Diagnostics.Type_0_is_not_assignable_to_type_1.code,
    Diagnostics.Type_0_is_not_comparable_to_type_1.code,
];
registerCodeFix({
    fixIds: [fixId],
    errorCodes,
    getCodeActions: function getCodeActionsToAddMissingAsync(context) {
        const { sourceFile, errorCode, cancellationToken, program, span } = context;
        const diagnostic = find(program.getTypeChecker().getDiagnostics(sourceFile, cancellationToken), getIsMatchingAsyncError(span, errorCode));
        const directSpan = diagnostic && diagnostic.relatedInformation && find(diagnostic.relatedInformation, r => r.code === Diagnostics.Did_you_mean_to_mark_this_function_as_async.code);
        const decl = getFixableErrorSpanDeclaration(sourceFile, checkedAsyncRelatedSpan(directSpan));
        if (!decl) {
            return;
        }
        const trackChanges: ContextualTrackChangesFunction = cb => textChanges.ChangeTracker.with(context, cb);
        return [getFix(context, decl, trackChanges)];
    },
    getAllCodeActions: context => {
        const { sourceFile } = context;
        const fixedDeclarations = new Set<number>();
        return codeFixAll(context, errorCodes, (t, diagnostic) => {
            const span = diagnostic.relatedInformation && find(diagnostic.relatedInformation, r => r.code === Diagnostics.Did_you_mean_to_mark_this_function_as_async.code);
            const decl = getFixableErrorSpanDeclaration(sourceFile, checkedAsyncRelatedSpan(span));
            if (!decl) {
                return;
            }
            const trackChanges: ContextualTrackChangesFunction = cb => (cb(t), []);
            return getFix(context, decl, trackChanges, fixedDeclarations);
        });
    },
});
type FixableDeclaration = ArrowFunction | FunctionDeclaration | FunctionExpression | MethodDeclaration;
function getFix(context: CodeFixContext | CodeFixAllContext, decl: FixableDeclaration, trackChanges: ContextualTrackChangesFunction, fixedDeclarations?: Set<number>) {
    const changes = trackChanges(t => makeChange(t, context.sourceFile, decl, fixedDeclarations));
    return createCodeFixAction(fixId, changes, Diagnostics.Add_async_modifier_to_containing_function, fixId, Diagnostics.Add_all_missing_async_modifiers);
}
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, insertionSite: FixableDeclaration, fixedDeclarations?: Set<number>) {
    if (fixedDeclarations) {
        if (fixedDeclarations.has(getNodeId(insertionSite))) {
            return;
        }
    }
    fixedDeclarations?.add(getNodeId(insertionSite));
    const cloneWithModifier = factory.replaceModifiers(getSynthesizedDeepClone(insertionSite, /*includeTrivia*/ true), factory.createNodeArray(factory.createModifiersFromModifierFlags(getSyntacticModifierFlags(insertionSite) | ModifierFlags.Async)));
    changeTracker.replaceNode(sourceFile, insertionSite, cloneWithModifier);
}
function getFixableErrorSpanDeclaration(sourceFile: SourceFile, span: TextSpan | undefined): FixableDeclaration | undefined {
    if (!span)
        return undefined;
    const token = getTokenAtPosition(sourceFile, span.start);
    // Checker has already done work to determine that async might be possible, and has attached
    // related info to the node, so start by finding the signature that exactly matches up
    // with the diagnostic range.
    const decl = findAncestor(token, node => {
        if (requireCompilerMember(node, "getStart").getStart(sourceFile) < span.start || requireCompilerMember(node, "getEnd").getEnd() > textSpanEnd(span)) {
            return "quit";
        }
        return (isArrowFunction(node) || isMethodDeclaration(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) && textSpansEqual(span, createTextSpanFromNode(node, sourceFile));
    });
    return checkedCompilerLayout(decl, isAsyncFixableDeclaration);
}
function getIsMatchingAsyncError(span: TextSpan, errorCode: number) {
    return ({ start, length, relatedInformation, code }: Diagnostic) => isNumber(start) && isNumber(length) && textSpansEqual({ start, length }, span) &&
        code === errorCode &&
        !!relatedInformation &&
        some(relatedInformation, related => related.code === Diagnostics.Did_you_mean_to_mark_this_function_as_async.code);
}

function checkedAsyncRelatedSpan(span: DiagnosticRelatedInformation | undefined): TextSpan | undefined {
    if (span === undefined) return span;
    return requireCompilerMember(requireCompilerMember(span, "start"), "length");
}
function isAsyncFixableDeclaration(node: Node): node is FixableDeclaration {
    return isArrowFunction(node) || isMethodDeclaration(node) || isFunctionExpression(node) || isFunctionDeclaration(node);
}
