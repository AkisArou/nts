// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/addOptionalPropertyUndefined.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { isNodeLayout_b74b1ef9bfcc } from "../../checkedLayouts.ts";
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { isIdentifier as checked_isIdentifier } from "../_namespaces/ts.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isUnionTypeNode as checked_isUnionTypeNode } from "../../compiler/factory/nodeTests.ts";
import { createCodeFixActionWithoutFixAll, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, emptyArray, factory, getFixableErrorSpanExpression, getSourceFileOfNode, type Identifier, isBinaryExpression, isCallExpression, isExpression, isFunctionLikeKind, isIdentifier, isPropertyAccessExpression, isPropertyAssignment, isPropertyDeclaration, isPropertySignature, isShorthandPropertyAssignment, isVariableDeclaration, type Node, type PropertyAccessExpression, type SignatureDeclaration, type SourceFile, type Symbol, SyntaxKind, textChanges, type TextSpan, type TypeChecker, type UnionTypeNode } from "../_namespaces/ts.ts";
const addOptionalPropertyUndefined = "addOptionalPropertyUndefined";
const errorCodes = [
    Diagnostics.Type_0_is_not_assignable_to_type_1_with_exactOptionalPropertyTypes_Colon_true_Consider_adding_undefined_to_the_type_of_the_target.code,
    Diagnostics.Type_0_is_not_assignable_to_type_1_with_exactOptionalPropertyTypes_Colon_true_Consider_adding_undefined_to_the_types_of_the_target_s_properties.code,
    Diagnostics.Argument_of_type_0_is_not_assignable_to_parameter_of_type_1_with_exactOptionalPropertyTypes_Colon_true_Consider_adding_undefined_to_the_types_of_the_target_s_properties.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const typeChecker = context.program.getTypeChecker();
        const toAdd = getPropertiesToAdd(context.sourceFile, context.span, typeChecker);
        if (!toAdd.length) {
            return undefined;
        }
        const changes = textChanges.ChangeTracker.with(context, t => addUndefinedToOptionalProperty(t, toAdd));
        return [createCodeFixActionWithoutFixAll(addOptionalPropertyUndefined, changes, Diagnostics.Add_undefined_to_optional_property_type)];
    },
    fixIds: [addOptionalPropertyUndefined],
});
function getPropertiesToAdd(file: SourceFile, span: TextSpan, checker: TypeChecker): Symbol[] {
    const sourceTarget = getSourceTarget(getFixableErrorSpanExpression(file, span), checker);
    if (!sourceTarget) {
        return emptyArray;
    }
    const { source: sourceNode, target: targetNode } = sourceTarget;
    const target = shouldUseParentTypeOfProperty(sourceNode, targetNode, checker)
        ? checker.getTypeAtLocation(targetNode.expression)
        : checker.getTypeAtLocation(targetNode);
    if (target.symbol?.declarations?.some(d => getSourceFileOfNode(d).fileName.match(/\.d\.ts$/))) {
        return emptyArray;
    }
    return checker.getExactOptionalProperties(target);
}
function shouldUseParentTypeOfProperty(sourceNode: Node, targetNode: Node, checker: TypeChecker): targetNode is PropertyAccessExpression {
    return isPropertyAccessExpression(targetNode)
        && !!checker.getExactOptionalProperties(checker.getTypeAtLocation(targetNode.expression)).length
        && checker.getTypeAtLocation(sourceNode) === checker.getUndefinedType();
}
/**
 * Find the source and target of the incorrect assignment.
 * The call is recursive for property assignments.
 */
function getSourceTarget(errorNode: Node | undefined, checker: TypeChecker): {
    source: Node;
    target: Node;
} | undefined {
    if (!errorNode) {
        return undefined;
    }
    else if (testCompilerLayout(errorNode.parent, isBinaryExpression) && errorNode.parent.operatorToken.kind === SyntaxKind.EqualsToken) {
        return { source: errorNode.parent.right, target: errorNode.parent.left };
    }
    else if (testCompilerLayout(errorNode.parent, isVariableDeclaration) && errorNode.parent.initializer) {
        return { source: errorNode.parent.initializer, target: errorNode.parent.name };
    }
    else if (testCompilerLayout(errorNode.parent, isCallExpression)) {
        const n = checker.getSymbolAtLocation(errorNode.parent.expression);
        if (!n?.valueDeclaration || !isFunctionLikeKind(n.valueDeclaration.kind))
            return undefined;
        if (!isExpression(errorNode))
            return undefined;
        const i = errorNode.parent.arguments.indexOf(errorNode);
        if (i === -1)
            return undefined;
        const name = checkedCompilerLayout((n.valueDeclaration), isNodeLayout_b74b1ef9bfcc).parameters[i].name;
        if (isIdentifier(name))
            return { source: errorNode, target: name };
    }
    else if (testCompilerLayout(errorNode.parent, isPropertyAssignment) && isIdentifier(errorNode.parent.name) || testCompilerLayout(errorNode.parent, isShorthandPropertyAssignment)) {
        const parentTarget = getSourceTarget(errorNode.parent.parent, checker);
        if (!parentTarget)
            return undefined;
        const prop = checker.getPropertyOfType(checker.getTypeAtLocation(parentTarget.target), ((checkedCompilerLayout(errorNode.parent.name, checked_isIdentifier)).text)!);
        const declaration = prop?.declarations?.[0];
        if (!declaration)
            return undefined;
        return {
            source: isPropertyAssignment(errorNode.parent) ? errorNode.parent.initializer : errorNode.parent.name,
            target: declaration,
        };
    }
    return undefined;
}
function addUndefinedToOptionalProperty(changes: textChanges.ChangeTracker, toAdd: Symbol[]) {
    for (const add of toAdd) {
        const d = add.valueDeclaration;
        if (d && (isPropertySignature(d) || isPropertyDeclaration(d)) && d.type) {
            const t = factory.createUnionTypeNode([
                ...d.type.kind === SyntaxKind.UnionType ? (checkedCompilerLayout(d.type, checked_isUnionTypeNode)).types : [d.type],
                factory.createTypeReferenceNode("undefined"),
            ]);
            changes.replaceNode(requireCompilerMember(d, "getSourceFile").getSourceFile(), d.type, t);
        }
    }
}
