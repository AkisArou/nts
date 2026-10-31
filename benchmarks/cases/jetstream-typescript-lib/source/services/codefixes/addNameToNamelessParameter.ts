// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/addNameToNamelessParameter.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isIdentifier as checked_isIdentifier } from "../../compiler/factory/nodeTests.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { createRange, Debug, Diagnostics, factory, findNextToken, getTokenAtPosition, type Identifier, isArrayBindingPattern, isArrayTypeNode, isParameter, type ParameterDeclaration, type SourceFile, SyntaxKind, textChanges, type TypeNode } from "../_namespaces/ts.ts";
const fixId = "addNameToNamelessParameter";
const errorCodes = [Diagnostics.Parameter_has_a_name_but_no_type_Did_you_mean_0_Colon_1.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToAddNameToNamelessParameter(context) {
        const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span.start));
        return [createCodeFixAction(fixId, changes, Diagnostics.Add_parameter_name, fixId, Diagnostics.Add_names_to_all_parameters_without_names)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file, diag.start)),
});
function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, start: number) {
    const token = getTokenAtPosition(sourceFile, start);
    const param = token.parent;
    if (!testCompilerLayout(param, isParameter)) {
        return Debug.fail("Tried to add a parameter name to a non-parameter: " + Debug.formatSyntaxKind(token.kind));
    }
    const i = param.parent.parameters.indexOf(param);
    Debug.assert(!param.type, "Tried to add a parameter name to a parameter that already had one.");
    Debug.assert(i > -1, "Parameter not found in parent parameter list.");
    let end = requireCompilerMember(param.name, "getEnd").getEnd();
    let typeNode: TypeNode = factory.createTypeReferenceNode(checkedCompilerLayout(param.name, checked_isIdentifier), /*typeArguments*/ undefined);
    let nextParam = tryGetNextParam(sourceFile, param);
    while (nextParam) {
        typeNode = factory.createArrayTypeNode(typeNode);
        end = requireCompilerMember(nextParam, "getEnd").getEnd();
        nextParam = tryGetNextParam(sourceFile, nextParam);
    }
    const replacement = factory.createParameterDeclaration(param.modifiers, param.dotDotDotToken, "arg" + i, param.questionToken, param.dotDotDotToken && !isArrayTypeNode(typeNode) ? factory.createArrayTypeNode(typeNode) : typeNode, param.initializer);
    changeTracker.replaceRange(sourceFile, createRange(requireCompilerMember(param, "getStart").getStart(sourceFile), end), replacement);
}
function tryGetNextParam(sourceFile: SourceFile, param: ParameterDeclaration) {
    const nextToken = findNextToken(param.name, param.parent, sourceFile);
    if (nextToken && nextToken.kind === SyntaxKind.OpenBracketToken
        && testCompilerLayout(nextToken.parent, isArrayBindingPattern) && isParameter(nextToken.parent.parent)) {
        return nextToken.parent.parent;
    }
    return undefined;
}
