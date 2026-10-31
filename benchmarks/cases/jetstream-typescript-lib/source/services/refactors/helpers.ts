// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/refactors/helpers.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../../checked.ts";
import { checkedCompilerLayout, compilerPropertyObject } from "../../checked.ts";
import { type ClassLikeDeclaration, codefix, Debug, findAncestor, type FunctionLikeDeclaration, getUniqueName, identifierToKeywordKind, isAnyImportOrRequireStatement, isClassLike, isPrivateIdentifier, isPropertyAccessExpression, type ModuleBlock, type Node, type Program, skipAlias, type SourceFile, type Symbol, SymbolFlags, type TypeChecker } from "../_namespaces/ts.ts";
import { addImportsForMovedSymbols } from "./moveToFile.ts";
/**
 * Returned by refactor functions when some error message needs to be surfaced to users.
 *
 * @internal
 */
export interface RefactorErrorInfo {
    error: string;
}
/**
 * Checks if some refactor info has refactor error info.
 *
 * @internal
 */
export function isRefactorErrorInfo(info: unknown): info is RefactorErrorInfo {
    return compilerPropertyObject(info).error !== undefined;
}
/**
 * Checks if string "known" begins with string "requested".
 * Used to match requested kinds with a known kind.
 *
 * @internal
 */
export function refactorKindBeginsWith(known: string, requested: string | undefined): boolean {
    if (!requested)
        return true;
    return known.substr(0, requested.length) === requested;
}
/**
 * Try to come up with a unique name for a given node within the scope for the
 * use of being used as a property/variable name.
 *
 * @internal
 */
export function getIdentifierForNode(node: Node, scope: FunctionLikeDeclaration | SourceFile | ModuleBlock | ClassLikeDeclaration, checker: TypeChecker, file: SourceFile): string {
    return isPropertyAccessExpression(node) && !isClassLike(scope) && !checker.resolveName((node.name.text)!, node, SymbolFlags.Value, /*excludeGlobals*/ false) && !isPrivateIdentifier(node.name) && !identifierToKeywordKind(node.name)
        ? (node.name.text)! : getUniqueName(isClassLike(scope) ? "newProperty" : "newLocal", file);
}
/** @internal */
export function addTargetFileImports(oldFile: SourceFile, importsToCopy: Map<Symbol, [
    boolean,
    codefix.ImportOrRequireAliasDeclaration | undefined
]>, targetFileImportsFromOldFile: Map<Symbol, boolean>, checker: TypeChecker, program: Program, importAdder: codefix.ImportAdder): void {
    /**
     * Recomputing the imports is preferred with importAdder because it manages multiple import additions for a file and writes then to a ChangeTracker,
     * but sometimes it fails because of unresolved imports from files, or when a source file is not available for the target file (in this case when creating a new file).
     * So in that case, fall back to copying the import verbatim.
     */
    importsToCopy.forEach(([isValidTypeOnlyUseSite, declaration], symbol) => {
        const targetSymbol = skipAlias(symbol, checker);
        if (checker.isUnknownSymbol(targetSymbol)) {
            importAdder.addVerbatimImport(Debug.checkDefined(declaration ?? findAncestor(symbol.declarations?.[0], isAnyImportOrRequireStatement)));
        }
        else if (targetSymbol.parent === undefined) {
            Debug.assert(declaration !== undefined, "expected module symbol to have a declaration");
            importAdder.addImportForModuleSymbol(symbol, isValidTypeOnlyUseSite, declaration);
        }
        else {
            importAdder.addImportFromExportedSymbol(targetSymbol, isValidTypeOnlyUseSite, declaration);
        }
    });
    addImportsForMovedSymbols(targetFileImportsFromOldFile, oldFile.fileName, importAdder, program);
}
