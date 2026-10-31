// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixExtendsInterfaceBecomesImplements.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { present } from "../../checked.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, getContainingClass, getTokenAtPosition, type HeritageClause, isWhiteSpaceSingleLine, type Node, type SourceFile, SyntaxKind, textChanges } from "../_namespaces/ts.ts";
const fixId = "extendsInterfaceBecomesImplements";
const errorCodes = [Diagnostics.Cannot_extend_an_interface_0_Did_you_mean_implements.code];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { sourceFile } = context;
        const nodes = getNodes(sourceFile, context.span.start);
        if (!nodes)
            return undefined;
        const { extendsToken, heritageClauses } = nodes;
        const changes = textChanges.ChangeTracker.with(context, t => doChanges(t, sourceFile, (extendsToken)!, (heritageClauses)!));
        return [createCodeFixAction(fixId, changes, Diagnostics.Change_extends_to_implements, fixId, Diagnostics.Change_all_extended_interfaces_to_implements)];
    },
    fixIds: [fixId],
    getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
        const nodes = getNodes(diag.file, diag.start);
        if (nodes)
            doChanges(changes, diag.file, (nodes.extendsToken)!, (nodes.heritageClauses)!);
    }),
});
function getNodes(sourceFile: SourceFile, pos: number) {
    const token = getTokenAtPosition(sourceFile, pos);
    const heritageClauses = (getContainingClass(token))!.heritageClauses;
    const extendsToken = requireCompilerMember((heritageClauses)![0], "getFirstToken").getFirstToken();
    return (extendsToken)!.kind === SyntaxKind.ExtendsKeyword ? { extendsToken, heritageClauses } : undefined;
}
function doChanges(changes: textChanges.ChangeTracker, sourceFile: SourceFile, extendsToken: Node, heritageClauses: readonly HeritageClause[]): void {
    changes.replaceNode(sourceFile, extendsToken, factory.createToken(SyntaxKind.ImplementsKeyword));
    // If there is already an implements clause, replace the implements keyword with a comma.
    if (heritageClauses.length === 2 &&
        heritageClauses[0].token === SyntaxKind.ExtendsKeyword &&
        heritageClauses[1].token === SyntaxKind.ImplementsKeyword) {
        const implementsToken = requireCompilerMember(heritageClauses[1], "getFirstToken").getFirstToken();
        const implementsFullStart = requireCompilerMember((implementsToken)!, "getFullStart").getFullStart();
        changes.replaceRange(sourceFile, { pos: implementsFullStart, end: implementsFullStart }, factory.createToken(SyntaxKind.CommaToken));
        // Rough heuristic: delete trailing whitespace after keyword so that it's not excessive.
        // (Trailing because leading might be indentation, which is more sensitive.)
        const text = sourceFile.text;
        let end = (implementsToken)!.end;
        while (end < text.length && isWhiteSpaceSingleLine(text.charCodeAt(end))) {
            end++;
        }
        changes.deleteRange(sourceFile, { pos: requireCompilerMember((implementsToken)!, "getStart").getStart(), end });
    }
}
