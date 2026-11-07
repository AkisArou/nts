// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixReturnTypeInAsyncFunction.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { checkedCompilerLayout } from "../../checked.ts";
import { isNodeLayout_1ca01a4c8123 } from "../../checkedLayouts.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, findAncestor, getTokenAtPosition, isFunctionLikeDeclaration, isInJSFile, type SourceFile, textChanges, type Type, type TypeChecker, type TypeNode } from "../_namespaces/ts.ts";
const fixId = "fixReturnTypeInAsyncFunction";
const errorCodes = [
    Diagnostics.The_return_type_of_an_async_function_or_method_must_be_the_global_Promise_T_type_Did_you_mean_to_write_Promise_0.code,
];
interface Info {
    returnTypeNode: TypeNode;
    returnType: Type;
    promisedTypeNode: TypeNode;
    promisedType: Type;
}
registerCodeFix({
    errorCodes,
    fixIds: [fixId],
    getCodeActions: function getCodeActionsToFixReturnTypeInAsyncFunction(context) {
        const { sourceFile, program, span } = context;
        const checker = program.getTypeChecker();
        const info = getInfo(sourceFile, program.getTypeChecker(), span.start);
        if (!info) {
            return undefined;
        }
        const { returnTypeNode, returnType, promisedTypeNode, promisedType } = info;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, returnTypeNode, promisedTypeNode));
        return [createCodeFixAction(fixId, changes, [Diagnostics.Replace_0_with_Promise_1, checker.typeToString(returnType), checker.typeToString(promisedType)], fixId, Diagnostics.Fix_all_incorrect_return_type_of_an_async_functions)];
    },
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const info = getInfo(diag.file, context.program.getTypeChecker(), diag.start);
        if (info) {
            doChange(changes, diag.file, info.returnTypeNode, info.promisedTypeNode);
        }
    }),
});
function getInfo(sourceFile: SourceFile, checker: TypeChecker, pos: number): Info | undefined {
    if (isInJSFile(sourceFile)) {
        return undefined;
    }
    const token = getTokenAtPosition(sourceFile, pos);
    const func = checkedCompilerLayout(findAncestor(token, isFunctionLikeDeclaration), isNodeLayout_1ca01a4c8123);
    const returnTypeNode = func?.type;
    if (!returnTypeNode) {
        return undefined;
    }
    const returnType = checker.getTypeFromTypeNode(returnTypeNode);
    const promisedType = checker.getAwaitedType(returnType) || checker.getVoidType();
    const promisedTypeNode = checker.typeToTypeNode(promisedType, /*enclosingDeclaration*/ returnTypeNode, /*flags*/ undefined);
    if (promisedTypeNode) {
        return { returnTypeNode, returnType, promisedTypeNode, promisedType };
    }
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, returnTypeNode: TypeNode, promisedTypeNode: TypeNode): void {
    changes.replaceNode(sourceFile, returnTypeNode, factory.createTypeReferenceNode("Promise", [promisedTypeNode]));
}
