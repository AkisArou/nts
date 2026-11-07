// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/symbolWalker.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type Declaration, type TypeNode, isTypeQueryNode } from "./_namespaces/ts.ts";
import { checkedCompilerLayout } from "../checked.ts";
import { isCompilerObjectType as checked_isCompilerObjectType } from "../checkedTypes.ts";
import { isCompilerTypeReference as checked_isCompilerTypeReference } from "../checkedTypes.ts";
import { isCompilerMappedType as checked_isCompilerMappedType } from "../checkedTypes.ts";
import { isCompilerInterfaceType as checked_isCompilerInterfaceType } from "../checkedTypes.ts";
import { isCompilerUnionOrIntersectionType as checked_isCompilerUnionOrIntersectionType } from "../checkedTypes.ts";
import { isCompilerIndexType as checked_isCompilerIndexType } from "../checkedTypes.ts";
import { isCompilerIndexedAccessType as checked_isCompilerIndexedAccessType } from "../checkedTypes.ts";
import { type BaseType, clear, type EntityNameOrEntityNameExpression, forEach, getOwnValues, getSymbolId, type Identifier, type IndexedAccessType, type IndexType, type InterfaceType, type MappedType, ObjectFlags, type ObjectType, type ResolvedType, type Signature, type Symbol, type SymbolWalker, SyntaxKind, type Type, TypeFlags, type TypeParameter, type TypePredicate, type TypeQueryNode, type TypeReference, type UnionOrIntersectionType } from "./_namespaces/ts.ts";
/** @internal */
export function createGetSymbolWalker(getRestTypeOfSignature: (sig: Signature) => Type, getTypePredicateOfSignature: (sig: Signature) => TypePredicate | undefined, getReturnTypeOfSignature: (sig: Signature) => Type, getBaseTypes: (type: InterfaceType) => BaseType[], resolveStructuredTypeMembers: (type: ObjectType) => ResolvedType, getTypeOfSymbol: (sym: Symbol) => Type, getResolvedSymbol: (node: Identifier) => Symbol, getConstraintOfTypeParameter: (typeParameter: TypeParameter) => Type | undefined, getFirstIdentifier: (node: EntityNameOrEntityNameExpression) => Identifier, getTypeArguments: (type: TypeReference) => readonly Type[]): (accept?: (symbol: Symbol) => boolean) => SymbolWalker {
    return getSymbolWalker;
    function getSymbolWalker(accept: (symbol: Symbol) => boolean = () => true): SymbolWalker {
        const visitedTypes: Type[] = []; // Sparse array from id to type
        const visitedSymbols: Symbol[] = []; // Sparse array from id to symbol
        return {
            walkType: type => {
                try {
                    visitType(type);
                    return { visitedTypes: getOwnValues(visitedTypes), visitedSymbols: getOwnValues(visitedSymbols) };
                }
                finally {
                    clear(visitedTypes);
                    clear(visitedSymbols);
                }
            },
            walkSymbol: symbol => {
                try {
                    visitSymbol(symbol);
                    return { visitedTypes: getOwnValues(visitedTypes), visitedSymbols: getOwnValues(visitedSymbols) };
                }
                finally {
                    clear(visitedTypes);
                    clear(visitedSymbols);
                }
            },
        };
        function visitType(type: Type | undefined): void {
            if (!type) {
                return;
            }
            if (visitedTypes[type.id]) {
                return;
            }
            visitedTypes[type.id] = type;
            // Reuse visitSymbol to visit the type's symbol,
            //  but be sure to bail on recuring into the type if accept declines the symbol.
            const shouldBail = visitSymbol(type.symbol);
            if (shouldBail)
                return;
            // Visit the type's related types, if any
            if (type.flags & TypeFlags.Object) {
                const objectType = checkedCompilerLayout(type, checked_isCompilerObjectType);
                const objectFlags = objectType.objectFlags;
                if (objectFlags & ObjectFlags.Reference) {
                    visitTypeReference(checkedCompilerLayout(type, checked_isCompilerTypeReference));
                }
                if (objectFlags & ObjectFlags.Mapped) {
                    visitMappedType(checkedCompilerLayout(type, checked_isCompilerMappedType));
                }
                if (objectFlags & (ObjectFlags.Class | ObjectFlags.Interface)) {
                    visitInterfaceType(checkedCompilerLayout(type, checked_isCompilerInterfaceType));
                }
                if (objectFlags & (ObjectFlags.Tuple | ObjectFlags.Anonymous)) {
                    visitObjectType(objectType);
                }
            }
            if (type.flags & TypeFlags.TypeParameter) {
                visitTypeParameter(type);
            }
            if (type.flags & TypeFlags.UnionOrIntersection) {
                visitUnionOrIntersectionType(checkedCompilerLayout(type, checked_isCompilerUnionOrIntersectionType));
            }
            if (type.flags & TypeFlags.Index) {
                visitIndexType(checkedCompilerLayout(type, checked_isCompilerIndexType));
            }
            if (type.flags & TypeFlags.IndexedAccess) {
                visitIndexedAccessType(checkedCompilerLayout(type, checked_isCompilerIndexedAccessType));
            }
        }
        function visitTypeReference(type: TypeReference): void {
            visitType(type.target);
            forEach(getTypeArguments(type), visitType);
        }
        function visitTypeParameter(type: TypeParameter): void {
            visitType(getConstraintOfTypeParameter(type));
        }
        function visitUnionOrIntersectionType(type: UnionOrIntersectionType): void {
            forEach(type.types, visitType);
        }
        function visitIndexType(type: IndexType): void {
            visitType(type.type);
        }
        function visitIndexedAccessType(type: IndexedAccessType): void {
            visitType(type.objectType);
            visitType(type.indexType);
            visitType(type.constraint);
        }
        function visitMappedType(type: MappedType): void {
            visitType(type.typeParameter);
            visitType(type.constraintType);
            visitType(type.templateType);
            visitType(type.modifiersType);
        }
        function visitSignature(signature: Signature): void {
            const typePredicate = getTypePredicateOfSignature(signature);
            if (typePredicate) {
                visitType(typePredicate.type);
            }
            forEach(signature.typeParameters, visitType);
            for (const parameter of signature.parameters) {
                visitSymbol(parameter);
            }
            visitType(getRestTypeOfSignature(signature));
            visitType(getReturnTypeOfSignature(signature));
        }
        function visitInterfaceType(interfaceT: InterfaceType): void {
            visitObjectType(interfaceT);
            forEach(interfaceT.typeParameters, visitType);
            forEach(getBaseTypes(interfaceT), visitType);
            visitType(interfaceT.thisType);
        }
        function visitObjectType(type: ObjectType): void {
            const resolved = resolveStructuredTypeMembers(type);
            for (const info of resolved.indexInfos) {
                visitType(info.keyType);
                visitType(info.type);
            }
            for (const signature of resolved.callSignatures) {
                visitSignature(signature);
            }
            for (const signature of resolved.constructSignatures) {
                visitSignature(signature);
            }
            for (const p of resolved.properties) {
                visitSymbol(p);
            }
        }
        function visitSymbol(symbol: Symbol | undefined): boolean {
            if (!symbol) {
                return false;
            }
            const symbolId = getSymbolId(symbol);
            if (visitedSymbols[symbolId]) {
                return false;
            }
            visitedSymbols[symbolId] = symbol;
            if (!accept(symbol)) {
                return true;
            }
            const t = getTypeOfSymbol(symbol);
            visitType(t); // Should handle members on classes and such
            if (symbol.exports) {
                symbol.exports.forEach(visitSymbol);
            }
            forEach(symbol.declarations, (d: Declaration & {type?: TypeNode}) => {
                // Type queries are too far resolved when we just visit the symbol's type
                //  (their type resolved directly to the member deeply referenced)
                // So to get the intervening symbols, we need to check if there's a type
                // query node on any of the symbol's declarations and get symbols there
                if ((d).type && (d).type.kind === SyntaxKind.TypeQuery) {
                    const query = checkedCompilerLayout((d).type, isTypeQueryNode);
                    const entity = getResolvedSymbol(getFirstIdentifier(query.exprName));
                    visitSymbol(entity);
                }
            });
            return false;
        }
    }
}
