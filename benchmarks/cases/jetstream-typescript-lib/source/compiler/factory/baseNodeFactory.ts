// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/factory/baseNodeFactory.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type Node, objectAllocator, SyntaxKind } from "../_namespaces/ts.ts";
/**
 * A `BaseNodeFactory` is an abstraction over an `ObjectAllocator` that handles caching `Node` constructors
 * and allocating `Node` instances based on a set of predefined types.
 *
 * @internal
 */
export interface BaseNodeFactory {
    createBaseSourceFileNode(kind: typeof SyntaxKind.SourceFile): Node;
    createBaseIdentifierNode(kind: typeof SyntaxKind.Identifier): Node;
    createBasePrivateIdentifierNode(kind: typeof SyntaxKind.PrivateIdentifier): Node;
    createBaseTokenNode(kind: SyntaxKind): Node;
    createBaseNode(kind: SyntaxKind): Node;
}
/**
 * Creates a `BaseNodeFactory` which can be used to create `Node` instances from the constructors provided by the object allocator.
 *
 * @internal
 */
export function createBaseNodeFactory(): BaseNodeFactory {
    let NodeConstructor: new (kind: SyntaxKind, pos: number, end: number) => Node;
    let TokenConstructor: new (kind: SyntaxKind, pos: number, end: number) => Node;
    let IdentifierConstructor: new (kind: typeof SyntaxKind.Identifier, pos: number, end: number) => Node;
    let PrivateIdentifierConstructor: new (kind: typeof SyntaxKind.PrivateIdentifier, pos: number, end: number) => Node;
    let SourceFileConstructor: new (kind: typeof SyntaxKind.SourceFile, pos: number, end: number) => Node;
    return {
        createBaseSourceFileNode,
        createBaseIdentifierNode,
        createBasePrivateIdentifierNode,
        createBaseTokenNode,
        createBaseNode,
    };
    function createBaseSourceFileNode(kind: typeof SyntaxKind.SourceFile): Node {
        return new (SourceFileConstructor || (SourceFileConstructor = objectAllocator.getSourceFileConstructor()))(kind, /*pos*/ -1, /*end*/ -1);
    }
    function createBaseIdentifierNode(kind: typeof SyntaxKind.Identifier): Node {
        return new (IdentifierConstructor || (IdentifierConstructor = objectAllocator.getIdentifierConstructor()))(kind, /*pos*/ -1, /*end*/ -1);
    }
    function createBasePrivateIdentifierNode(kind: typeof SyntaxKind.PrivateIdentifier): Node {
        return new (PrivateIdentifierConstructor || (PrivateIdentifierConstructor = objectAllocator.getPrivateIdentifierConstructor()))(kind, /*pos*/ -1, /*end*/ -1);
    }
    function createBaseTokenNode(kind: SyntaxKind): Node {
        return new (TokenConstructor || (TokenConstructor = objectAllocator.getTokenConstructor()))(kind, /*pos*/ -1, /*end*/ -1);
    }
    function createBaseNode(kind: SyntaxKind): Node {
        return new (NodeConstructor || (NodeConstructor = objectAllocator.getNodeConstructor()))(kind, /*pos*/ -1, /*end*/ -1);
    }
}
