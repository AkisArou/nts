// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/preparePasteEdits.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../checked.ts";
import { requireCompilerMember } from "../checked.ts";
import { findAncestor, forEachChild, getTokenAtPosition, isIdentifier, rangeContainsPosition, rangeContainsRange, type SourceFile, SymbolFlags, type TextRange, type TypeChecker } from "./_namespaces/ts.ts";
import { isInImport } from "./refactors/moveToFile.ts";
/** @internal */
export function preparePasteEdits(sourceFile: SourceFile, copiedFromRange: TextRange[], checker: TypeChecker): boolean {
    let shouldProvidePasteEdits = false;
    copiedFromRange.forEach(range => {
        const enclosingNode = findAncestor(getTokenAtPosition(sourceFile, range.pos), ancestorNode => rangeContainsRange(ancestorNode, range));
        if (!enclosingNode)
            return;
        forEachChild(enclosingNode, function checkNameResolution(node) {
            if (shouldProvidePasteEdits)
                return;
            if (isIdentifier(node) && rangeContainsPosition(range, requireCompilerMember(node, "getStart").getStart(sourceFile))) {
                const resolvedSymbol = checker.resolveName((node.text)!, node, SymbolFlags.All, /*excludeGlobals*/ false);
                if (resolvedSymbol && resolvedSymbol.declarations) {
                    for (const decl of resolvedSymbol.declarations) {
                        if (isInImport(decl) || !!(node.text && sourceFile.symbol && sourceFile.symbol.exports?.has(node.escapedText))) {
                            shouldProvidePasteEdits = true;
                            return;
                        }
                    }
                }
            }
            requireCompilerMember(node, "forEachChild").forEachChild(checkNameResolution);
        });
        if (shouldProvidePasteEdits)
            return;
    });
    return shouldProvidePasteEdits;
}
