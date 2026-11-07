// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixJSDocTypes.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { append, type AsExpression, type CallSignatureDeclaration, type CodeFixAction, type ConstructSignatureDeclaration, type DiagnosticMessage, Diagnostics, findAncestor, type FunctionDeclaration, type GetAccessorDeclaration, getTokenAtPosition, type IndexSignatureDeclaration, isJSDocNullableType, type MappedTypeNode, type MethodDeclaration, type MethodSignature, type Node, type ParameterDeclaration, type PropertyDeclaration, type PropertySignature, type SetAccessorDeclaration, type SourceFile, SyntaxKind, textChanges, type Type, type TypeAliasDeclaration, type TypeAssertion, type TypeChecker, TypeFlags, type TypeNode, type VariableDeclaration } from "../_namespaces/ts.ts";
const fixIdPlain = "fixJSDocTypes_plain";
const fixIdNullable = "fixJSDocTypes_nullable";
const errorCodes = [
    Diagnostics.JSDoc_types_can_only_be_used_inside_documentation_comments.code,
    Diagnostics._0_at_the_end_of_a_type_is_not_valid_TypeScript_syntax_Did_you_mean_to_write_1.code,
    Diagnostics._0_at_the_start_of_a_type_is_not_valid_TypeScript_syntax_Did_you_mean_to_write_1.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile } = context;
        const checker = context.program.getTypeChecker();
        const info = getInfo(sourceFile, context.span.start, checker);
        if (!info)
            return undefined;
        const { typeNode, type } = info;
        const original = requireCompilerMember(typeNode, "getText").getText(sourceFile);
        const actions = [fix(type, fixIdPlain, Diagnostics.Change_all_jsdoc_style_types_to_TypeScript)];
        if (typeNode.kind === SyntaxKind.JSDocNullableType) {
            // for nullable types, suggest the flow-compatible `T | null | undefined`
            // in addition to the jsdoc/closure-compatible `T | null`
            actions.push(fix(type, fixIdNullable, Diagnostics.Change_all_jsdoc_style_types_to_TypeScript_and_add_undefined_to_nullable_types));
        }
        return actions;
        function fix(type: Type, fixId: string, fixAllDescription: DiagnosticMessage): CodeFixAction {
            const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, typeNode, type, checker));
            return createCodeFixAction("jdocTypes", changes, [Diagnostics.Change_0_to_1, original, checker.typeToString(type)], fixId, fixAllDescription);
        }
    },
    fixIds: [fixIdPlain, fixIdNullable],
    getAllCodeActions(context) {
        const { fixId, program, sourceFile } = context;
        const checker = program.getTypeChecker();
        return codeFixAll(context, errorCodes, (changes, err) => {
            const info = getInfo(err.file, err.start, checker);
            if (!info)
                return;
            const { typeNode, type } = info;
            const fixedType = typeNode.kind === SyntaxKind.JSDocNullableType && fixId === fixIdNullable ? checker.getNullableType(type, TypeFlags.Undefined) : type;
            doChange(changes, sourceFile, typeNode, fixedType, checker);
        });
    },
});
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, oldTypeNode: TypeNode, newType: Type, checker: TypeChecker): void {
    changes.replaceNode(sourceFile, oldTypeNode, (checker.typeToTypeNode(newType, /*enclosingDeclaration*/ oldTypeNode, /*flags*/ undefined))!); // TODO: GH#18217
}
function getInfo(sourceFile: SourceFile, pos: number, checker: TypeChecker): {
    typeNode: TypeNode;
    type: Type;
} | undefined {
    const decl = findAncestor(getTokenAtPosition(sourceFile, pos), isTypeContainer);
    const typeNode = decl && decl.type;
    return typeNode && { typeNode, type: getType(checker, typeNode) };
}
// TODO: GH#19856 Node & { type: TypeNode }
type TypeContainer = AsExpression | CallSignatureDeclaration | ConstructSignatureDeclaration | FunctionDeclaration | GetAccessorDeclaration | IndexSignatureDeclaration | MappedTypeNode | MethodDeclaration | MethodSignature | ParameterDeclaration | PropertyDeclaration | PropertySignature | SetAccessorDeclaration | TypeAliasDeclaration | TypeAssertion | VariableDeclaration;
function isTypeContainer(node: Node): node is TypeContainer {
    // NOTE: Some locations are not handled yet:
    // MappedTypeNode.typeParameters and SignatureDeclaration.typeParameters, as well as CallExpression.typeArguments
    switch (node.kind) {
        case SyntaxKind.AsExpression:
        case SyntaxKind.CallSignature:
        case SyntaxKind.ConstructSignature:
        case SyntaxKind.FunctionDeclaration:
        case SyntaxKind.GetAccessor:
        case SyntaxKind.IndexSignature:
        case SyntaxKind.MappedType:
        case SyntaxKind.MethodDeclaration:
        case SyntaxKind.MethodSignature:
        case SyntaxKind.Parameter:
        case SyntaxKind.PropertyDeclaration:
        case SyntaxKind.PropertySignature:
        case SyntaxKind.SetAccessor:
        case SyntaxKind.TypeAliasDeclaration:
        case SyntaxKind.TypeAssertionExpression:
        case SyntaxKind.VariableDeclaration:
            return true;
        default:
            return false;
    }
}
function getType(checker: TypeChecker, node: TypeNode) {
    if (isJSDocNullableType(node)) {
        const type = checker.getTypeFromTypeNode(node.type);
        if (type === checker.getNeverType() || type === checker.getVoidType()) {
            return type;
        }
        return checker.getUnionType(append([type, checker.getUndefinedType()], node.postfix ? undefined : checker.getNullType()));
    }
    return checker.getTypeFromTypeNode(node);
}
