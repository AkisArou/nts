// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/transformers/es2019.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { checkedCompilerLayout } from "../../checked.ts";
import { isCatchClause as checked_isCatchClause } from "../factory/nodeTests.ts";
import { type Bundle, type CatchClause, chainBundle, isBlock, type Node, type SourceFile, SyntaxKind, type TransformationContext, TransformFlags, visitEachChild, visitNode, type VisitResult } from "../_namespaces/ts.ts";
/** @internal */
export function transformES2019(context: TransformationContext): (x: SourceFile | Bundle) => SourceFile | Bundle {
    const factory = context.factory;
    return chainBundle(context, transformSourceFile);
    function transformSourceFile(node: SourceFile) {
        if (node.isDeclarationFile) {
            return node;
        }
        return visitEachChild(node, visitor, context);
    }
    function visitor(node: Node): VisitResult<Node> {
        if ((node.transformFlags & TransformFlags.ContainsES2019) === 0) {
            return node;
        }
        switch (node.kind) {
            case SyntaxKind.CatchClause:
                return visitCatchClause(checkedCompilerLayout(node, checked_isCatchClause));
            default:
                return visitEachChild(node, visitor, context);
        }
    }
    function visitCatchClause(node: CatchClause): CatchClause {
        if (!node.variableDeclaration) {
            return factory.updateCatchClause(node, factory.createVariableDeclaration(factory.createTempVariable(/*recordTempVariable*/ undefined)), visitNode(node.block, visitor, isBlock));
        }
        return visitEachChild(node, visitor, context);
    }
}
