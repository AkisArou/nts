// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/refactors/convertOverloadListToSingleSignature.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { isNodeLayout_7ec425b974e0, isNodeLayout_d52cb5681306, isNodeLayout_8f76ff81a90b, isNodeLayout_a77162bc9fd1, isNodeLayout_12007efa0aa9, isNodeLayout_4be0fcab5bfa, isNodeLayout_b74b1ef9bfcc } from "../../checkedLayouts.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { type ApplicableRefactorInfo, type CallSignatureDeclaration, type ConstructorDeclaration, type ConstructSignatureDeclaration, Debug, Diagnostics, displayPartsToString, EmitFlags, emptyArray, every, factory, findAncestor, type FunctionDeclaration, getLocaleSpecificMessage, getSourceFileOfNode, getSyntheticLeadingComments, getTokenAtPosition, isFunctionLikeDeclaration, isIdentifier, length, map, mapDefined, type MethodDeclaration, type MethodSignature, type NamedTupleMember, type Node, type NodeArray, type ParameterDeclaration, type Program, rangeContainsPosition, type RefactorContext, type RefactorEditInfo, setEmitFlags, setSyntheticLeadingComments, setTextRange, some, type SourceFile, SyntaxKind, textChanges, type TupleTypeNode } from "../_namespaces/ts.ts";
import { registerRefactor } from "../_namespaces/ts.refactor.ts";
const refactorName = "Convert overload list to single signature";
const refactorDescription = getLocaleSpecificMessage(Diagnostics.Convert_overload_list_to_single_signature);
const functionOverloadAction = {
    name: refactorName,
    description: refactorDescription,
    kind: "refactor.rewrite.function.overloadList",
};
registerRefactor(refactorName, {
    kinds: [functionOverloadAction.kind],
    getEditsForAction: getRefactorEditsToConvertOverloadsToOneSignature,
    getAvailableActions: getRefactorActionsToConvertOverloadsToOneSignature,
});
function getRefactorActionsToConvertOverloadsToOneSignature(context: RefactorContext): readonly ApplicableRefactorInfo[] {
    const { file, startPosition, program } = context;
    const info = getConvertableOverloadListAtPosition(file, startPosition, program);
    if (!info)
        return emptyArray;
    return [{
            name: refactorName,
            description: refactorDescription,
            actions: [functionOverloadAction],
        }];
}
function getRefactorEditsToConvertOverloadsToOneSignature(context: RefactorContext): RefactorEditInfo | undefined {
    const { file, startPosition, program } = context;
    const signatureDecls = getConvertableOverloadListAtPosition(file, startPosition, program);
    if (!signatureDecls)
        return undefined;
    const checker = program.getTypeChecker();
    const lastDeclaration = signatureDecls[signatureDecls.length - 1];
    let updated = lastDeclaration;
    switch (lastDeclaration.kind) {
        case SyntaxKind.MethodSignature: {
            updated = factory.updateMethodSignature(checkedCompilerLayout(lastDeclaration, isNodeLayout_7ec425b974e0), lastDeclaration.modifiers, lastDeclaration.name, lastDeclaration.questionToken, lastDeclaration.typeParameters, getNewParametersForCombinedSignature(signatureDecls), lastDeclaration.type);
            break;
        }
        case SyntaxKind.MethodDeclaration: {
            updated = factory.updateMethodDeclaration(checkedCompilerLayout(lastDeclaration, isNodeLayout_d52cb5681306), lastDeclaration.modifiers, lastDeclaration.asteriskToken, lastDeclaration.name, lastDeclaration.questionToken, lastDeclaration.typeParameters, getNewParametersForCombinedSignature(signatureDecls), lastDeclaration.type, lastDeclaration.body);
            break;
        }
        case SyntaxKind.CallSignature: {
            updated = factory.updateCallSignature(checkedCompilerLayout(lastDeclaration, isNodeLayout_8f76ff81a90b), lastDeclaration.typeParameters, getNewParametersForCombinedSignature(signatureDecls), lastDeclaration.type);
            break;
        }
        case SyntaxKind.Constructor: {
            updated = factory.updateConstructorDeclaration(checkedCompilerLayout(lastDeclaration, isNodeLayout_a77162bc9fd1), lastDeclaration.modifiers, getNewParametersForCombinedSignature(signatureDecls), lastDeclaration.body);
            break;
        }
        case SyntaxKind.ConstructSignature: {
            updated = factory.updateConstructSignature(checkedCompilerLayout(lastDeclaration, isNodeLayout_12007efa0aa9), lastDeclaration.typeParameters, getNewParametersForCombinedSignature(signatureDecls), lastDeclaration.type);
            break;
        }
        case SyntaxKind.FunctionDeclaration: {
            updated = factory.updateFunctionDeclaration(checkedCompilerLayout(lastDeclaration, isNodeLayout_4be0fcab5bfa), lastDeclaration.modifiers, lastDeclaration.asteriskToken, lastDeclaration.name, lastDeclaration.typeParameters, getNewParametersForCombinedSignature(signatureDecls), lastDeclaration.type, lastDeclaration.body);
            break;
        }
        default:
            return Debug.failBadSyntaxKind(lastDeclaration, "Unhandled signature kind in overload list conversion refactoring");
    }
    if (updated === lastDeclaration) {
        return; // No edits to apply, do nothing
    }
    const edits = textChanges.ChangeTracker.with(context, t => {
        t.replaceNodeRange(file, signatureDecls[0], signatureDecls[signatureDecls.length - 1], updated);
    });
    return { renameFilename: undefined, renameLocation: undefined, edits };
    function getNewParametersForCombinedSignature(signatureDeclarations: (MethodSignature | MethodDeclaration | CallSignatureDeclaration | ConstructorDeclaration | ConstructSignatureDeclaration | FunctionDeclaration)[]): NodeArray<ParameterDeclaration> {
        const lastSig = signatureDeclarations[signatureDeclarations.length - 1];
        if (isFunctionLikeDeclaration(lastSig) && lastSig.body) {
            // Trim away implementation signature arguments (they should already be compatible with overloads, but are likely less precise to guarantee compatability with the overloads)
            signatureDeclarations = signatureDeclarations.slice(0, signatureDeclarations.length - 1);
        }
        return factory.createNodeArray([
            factory.createParameterDeclaration(
            /*modifiers*/ undefined, factory.createToken(SyntaxKind.DotDotDotToken), "args", 
            /*questionToken*/ undefined, factory.createUnionTypeNode(map(signatureDeclarations, convertSignatureParametersToTuple))),
        ]);
    }
    function convertSignatureParametersToTuple(decl: MethodSignature | MethodDeclaration | CallSignatureDeclaration | ConstructorDeclaration | ConstructSignatureDeclaration | FunctionDeclaration): TupleTypeNode {
        const members = map(decl.parameters, convertParameterToNamedTupleMember);
        return setEmitFlags(factory.createTupleTypeNode(members), some(members, m => !!length(getSyntheticLeadingComments(m))) ? EmitFlags.None : EmitFlags.SingleLine);
    }
    function convertParameterToNamedTupleMember(p: ParameterDeclaration): NamedTupleMember {
        Debug.assert(isIdentifier(p.name)); // This is checked during refactoring applicability checking
        const result = setTextRange(factory.createNamedTupleMember(p.dotDotDotToken, p.name, p.questionToken, p.type || factory.createKeywordTypeNode(SyntaxKind.AnyKeyword)), p);
        const parameterDocComment = p.symbol && requireCompilerMember(p.symbol, "getDocumentationComment").getDocumentationComment(checker);
        if (parameterDocComment) {
            const newComment = displayPartsToString(parameterDocComment);
            if (newComment.length) {
                setSyntheticLeadingComments(result, [{
                        text: `*
${newComment.split("\n").map(c => ` * ${c}`).join("\n")}
 `,
                        kind: SyntaxKind.MultiLineCommentTrivia,
                        pos: -1,
                        end: -1,
                        hasTrailingNewLine: true,
                        hasLeadingNewline: true,
                    }]);
            }
        }
        return result;
    }
}
function isConvertableSignatureDeclaration(d: Node): d is MethodSignature | MethodDeclaration | CallSignatureDeclaration | ConstructorDeclaration | ConstructSignatureDeclaration | FunctionDeclaration {
    switch (d.kind) {
        case SyntaxKind.MethodSignature:
        case SyntaxKind.MethodDeclaration:
        case SyntaxKind.CallSignature:
        case SyntaxKind.Constructor:
        case SyntaxKind.ConstructSignature:
        case SyntaxKind.FunctionDeclaration:
            return true;
    }
    return false;
}
function getConvertableOverloadListAtPosition(file: SourceFile, startPosition: number, program: Program) {
    const node = getTokenAtPosition(file, startPosition);
    const containingDecl = findAncestor(node, isConvertableSignatureDeclaration);
    if (!containingDecl) {
        return;
    }
    if (isFunctionLikeDeclaration(containingDecl) && containingDecl.body && rangeContainsPosition(containingDecl.body, startPosition)) {
        return;
    }
    const checker = program.getTypeChecker();
    const signatureSymbol = containingDecl.symbol;
    if (!signatureSymbol) {
        return;
    }
    const decls = signatureSymbol.declarations;
    if (length(decls) <= 1) {
        return;
    }
    if (!every(decls, d => getSourceFileOfNode(d) === file)) {
        return;
    }
    if (!isConvertableSignatureDeclaration((decls)![0])) {
        return;
    }
    const kindOne = (decls)![0].kind;
    if (!every(decls, d => d.kind === kindOne)) {
        return;
    }
    const signatureDecls = requireConvertibleSignatureDeclarations((decls)!);
    if (some(signatureDecls, d => !!d.typeParameters || some(d.parameters, p => !!p.modifiers || !isIdentifier(p.name)))) {
        return;
    }
    const signatures = mapDefined(signatureDecls, d => checker.getSignatureFromDeclaration(checkedCompilerLayout(d, isNodeLayout_b74b1ef9bfcc)));
    if (length(signatures) !== length(decls)) {
        return;
    }
    const returnOne = checker.getReturnTypeOfSignature(signatures[0]);
    if (!every(signatures, s => checker.getReturnTypeOfSignature(s) === returnOne)) {
        return;
    }
    return signatureDecls;
}

type ConvertibleSignatureDeclaration = MethodSignature | MethodDeclaration | CallSignatureDeclaration | ConstructorDeclaration | ConstructSignatureDeclaration | FunctionDeclaration;
function isConvertibleSignatureDeclarations(decls: import("../../compiler/types.ts").Declaration[]): decls is ConvertibleSignatureDeclaration[] {
    return decls.every(isConvertableSignatureDeclaration);
}
function requireConvertibleSignatureDeclarations(decls: import("../../compiler/types.ts").Declaration[]): ConvertibleSignatureDeclaration[] {
    if (isConvertibleSignatureDeclarations(decls)) return decls;
    throw new TypeError("Expected convertible signature declarations");
}
