// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/transformers/es2021.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type AssignmentExpression, type Bundle, chainBundle, getNonAssignmentOperatorForCompoundAssignment, isAccessExpression, isExpression, isLeftHandSideExpression, isLogicalOrCoalescingAssignmentExpression, isPropertyAccessExpression, isSimpleCopiableExpression, type LogicalOrCoalescingAssignmentOperator, type Node, skipParentheses, type SourceFile, type Token, type TransformationContext, TransformFlags, visitEachChild, visitNode, type VisitResult } from "../_namespaces/ts.ts";
/** @internal */
export function transformES2021(context: TransformationContext): (x: SourceFile | Bundle) => SourceFile | Bundle {
    const { hoistVariableDeclaration, factory, } = context;
    return chainBundle(context, transformSourceFile);
    function transformSourceFile(node: SourceFile) {
        if (node.isDeclarationFile) {
            return node;
        }
        return visitEachChild(node, visitor, context);
    }
    function visitor(node: Node): VisitResult<Node> {
        if ((node.transformFlags & TransformFlags.ContainsES2021) === 0) {
            return node;
        }
        if (isLogicalOrCoalescingAssignmentExpression(node)) {
            return transformLogicalAssignment(node);
        }
        return visitEachChild(node, visitor, context);
    }
    function transformLogicalAssignment(binaryExpression: AssignmentExpression<Token<LogicalOrCoalescingAssignmentOperator>>): VisitResult<Node> {
        const operator = binaryExpression.operatorToken;
        const nonAssignmentOperator = getNonAssignmentOperatorForCompoundAssignment(operator.kind);
        let left = skipParentheses(visitNode(binaryExpression.left, visitor, isLeftHandSideExpression));
        let assignmentTarget = left;
        const right = skipParentheses(visitNode(binaryExpression.right, visitor, isExpression));
        if (isAccessExpression(left)) {
            const propertyAccessTargetSimpleCopiable = isSimpleCopiableExpression(left.expression);
            const propertyAccessTarget = propertyAccessTargetSimpleCopiable ? left.expression :
                factory.createTempVariable(hoistVariableDeclaration);
            const propertyAccessTargetAssignment = propertyAccessTargetSimpleCopiable ? left.expression : factory.createAssignment(propertyAccessTarget, left.expression);
            if (isPropertyAccessExpression(left)) {
                assignmentTarget = factory.createPropertyAccessExpression(propertyAccessTarget, left.name);
                left = factory.createPropertyAccessExpression(propertyAccessTargetAssignment, left.name);
            }
            else {
                const elementAccessArgumentSimpleCopiable = isSimpleCopiableExpression(left.argumentExpression);
                const elementAccessArgument = elementAccessArgumentSimpleCopiable ? left.argumentExpression :
                    factory.createTempVariable(hoistVariableDeclaration);
                assignmentTarget = factory.createElementAccessExpression(propertyAccessTarget, elementAccessArgument);
                left = factory.createElementAccessExpression(propertyAccessTargetAssignment, elementAccessArgumentSimpleCopiable ? left.argumentExpression : factory.createAssignment(elementAccessArgument, left.argumentExpression));
            }
        }
        return factory.createBinaryExpression(left, nonAssignmentOperator, factory.createParenthesizedExpression(factory.createAssignment(assignmentTarget, right)));
    }
}
