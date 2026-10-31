// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/convertConstToLet.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { createCodeFixActionMaybeFixAll, createCombinedCodeActions, eachDiagnostic, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { addToSeen, Diagnostics, factory, findChildOfKind, getSymbolId, getTokenAtPosition, isVariableDeclarationList, type Program, type SourceFile, type Symbol, SyntaxKind, textChanges, type Token, tryCast } from "../_namespaces/ts.ts";
const fixId = "fixConvertConstToLet";
const errorCodes = [Diagnostics.Cannot_assign_to_0_because_it_is_a_constant.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToConvertConstToLet(context) {
        const { sourceFile, span, program } = context;
        const info = getInfo(sourceFile, span.start, program);
        if (info === undefined)
            return;
        const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, info.token));
        return [createCodeFixActionMaybeFixAll(fixId, changes, Diagnostics.Convert_const_to_let, fixId, Diagnostics.Convert_all_const_to_let)];
    },
    getAllCodeActions: context => {
        const { program } = context;
        const seen = new Set<number>();
        return createCombinedCodeActions(textChanges.ChangeTracker.with(context, changes => {
            eachDiagnostic(context, errorCodes, diag => {
                const info = getInfo(diag.file, diag.start, program);
                if (info) {
                    if (addToSeen(seen, getSymbolId(info.symbol))) {
                        return doChange(changes, diag.file, info.token);
                    }
                }
                return undefined;
            });
        }));
    },
    fixIds: [fixId],
});
interface Info {
    symbol: Symbol;
    token: Token<typeof SyntaxKind.ConstKeyword>;
}
function getInfo(sourceFile: SourceFile, pos: number, program: Program): Info | undefined {
    const checker = program.getTypeChecker();
    const symbol = checker.getSymbolAtLocation(getTokenAtPosition(sourceFile, pos));
    if (symbol === undefined)
        return;
    const declaration = tryCast(symbol?.valueDeclaration?.parent, isVariableDeclarationList);
    if (declaration === undefined)
        return;
    const constToken = findChildOfKind<Token<typeof SyntaxKind.ConstKeyword>>(declaration, SyntaxKind.ConstKeyword, sourceFile);
    if (constToken === undefined)
        return;
    return { symbol, token: constToken };
}
function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, token: Token<typeof SyntaxKind.ConstKeyword>) {
    changes.replaceNode(sourceFile, token, factory.createToken(SyntaxKind.LetKeyword));
}
