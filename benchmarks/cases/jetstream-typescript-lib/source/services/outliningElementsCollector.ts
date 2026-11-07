// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/outliningElementsCollector.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../checked.ts";
import { isNodeLayout_d6df4b360db4, isNodeLayout_5c66c7b04427, isNodeLayout_f1f315b6081f } from "../checkedLayouts.ts";
import { testCompilerLayout } from "../checked.ts";
import { isBlock as checked_isBlock } from "./_namespaces/ts.ts";
import { isCallExpression as checked_isCallExpression } from "./_namespaces/ts.ts";
import { isParenthesizedExpression as checked_isParenthesizedExpression } from "./_namespaces/ts.ts";
import { checkedCompilerLayout, present } from "../checked.ts";
import { isTryStatement as checked_isTryStatement } from "../compiler/factory/nodeTests.ts";
import { isJsxElement as checked_isJsxElement } from "../compiler/factory/nodeTests.ts";
import { isJsxFragment as checked_isJsxFragment } from "../compiler/factory/nodeTests.ts";
import { isJsxOpeningLikeElement as checked_isJsxOpeningLikeElement } from "../compiler/utilitiesPublic.ts";
import { isArrowFunction as checked_isArrowFunction } from "../compiler/factory/nodeTests.ts";
import { type ArrowFunction, type Block, type CallExpression, type CancellationToken, type CaseClause, createTextSpanFromBounds, createTextSpanFromNode, createTextSpanFromRange, Debug, type DefaultClause, findChildOfKind, getLeadingCommentRanges, type ImportAttributes, isAnyImportSyntax, isArrayLiteralExpression, isBinaryExpression, isBindingElement, isBlock, isCallExpression, isCallOrNewExpression, isClassLike, isDeclaration, isFunctionLike, isIfStatement, isInComment, isInterfaceDeclaration, isJsxText, isModuleBlock, isNodeArrayMultiLine, isParenthesizedExpression, isPropertyAccessExpression, isReturnStatement, isTupleTypeNode, isVariableStatement, type JsxAttributes, type JsxElement, type JsxFragment, type JsxOpeningLikeElement, type NamedExports, type NamedImports, type Node, type NodeArray, type NoSubstitutionTemplateLiteral, type OutliningSpan, OutliningSpanKind, type ParenthesizedExpression, positionsAreOnSameLine, type SignatureDeclaration, type SourceFile, startsWith, SyntaxKind, type TemplateExpression, type TextSpan, type TryStatement } from "./_namespaces/ts.ts";
/** @internal */
export function collectElements(sourceFile: SourceFile, cancellationToken: CancellationToken): OutliningSpan[] {
    const res: OutliningSpan[] = [];
    addNodeOutliningSpans(sourceFile, cancellationToken, res);
    addRegionOutliningSpans(sourceFile, res);
    res.sort((span1, span2) => span1.textSpan.start - span2.textSpan.start);
    return res;
}
function addNodeOutliningSpans(sourceFile: SourceFile, cancellationToken: CancellationToken, out: OutliningSpan[]): void {
    let depthRemaining = 40;
    let current = 0;
    const statements = sourceFile.statements;
    const n = statements.length;
    while (current < n) {
        while (current < n && !isAnyImportSyntax(statements[current])) {
            visitNode(statements[current]);
            current++;
        }
        if (current === n)
            break;
        const firstImport = current;
        while (current < n && isAnyImportSyntax(statements[current])) {
            visitNode(statements[current]);
            current++;
        }
        const lastImport = current - 1;
        if (lastImport !== firstImport) {
            out.push(createOutliningSpanFromBounds(requireCompilerMember((findChildOfKind(statements[firstImport], SyntaxKind.ImportKeyword, sourceFile))!, "getStart").getStart(sourceFile), requireCompilerMember(statements[lastImport], "getEnd").getEnd(), OutliningSpanKind.Imports));
        }
    }
    // Visit the EOF Token so that comments which aren't attached to statements are included.
    visitNode(sourceFile.endOfFileToken);
    function visitNode(n: Node) {
        if (depthRemaining === 0)
            return;
        cancellationToken.throwIfCancellationRequested();
        if (isDeclaration(n) || isVariableStatement(n) || isReturnStatement(n) || isCallOrNewExpression(n) || n.kind === SyntaxKind.EndOfFileToken) {
            addOutliningForLeadingCommentsForNode(n, sourceFile, cancellationToken, out);
        }
        if (isFunctionLike(n) && testCompilerLayout(n.parent, isBinaryExpression) && isPropertyAccessExpression(n.parent.left)) {
            addOutliningForLeadingCommentsForNode(n.parent.left, sourceFile, cancellationToken, out);
        }
        if (isBlock(n) || isModuleBlock(n)) {
            addOutliningForLeadingCommentsForPos(n.statements.end, sourceFile, cancellationToken, out);
        }
        if (isClassLike(n) || isInterfaceDeclaration(n)) {
            addOutliningForLeadingCommentsForPos(n.members.end, sourceFile, cancellationToken, out);
        }
        const span = getOutliningSpanForNode(n, sourceFile);
        if (span)
            out.push(span);
        depthRemaining--;
        if (isCallExpression(n)) {
            depthRemaining++;
            visitNode(n.expression);
            depthRemaining--;
            n.arguments.forEach(visitNode);
            n.typeArguments?.forEach(visitNode);
        }
        else if (isIfStatement(n) && n.elseStatement && isIfStatement(n.elseStatement)) {
            // Consider an 'else if' to be on the same depth as the 'if'.
            visitNode(n.expression);
            visitNode(n.thenStatement);
            depthRemaining++;
            visitNode(n.elseStatement);
            depthRemaining--;
        }
        else {
            requireCompilerMember(n, "forEachChild").forEachChild(visitNode);
        }
        depthRemaining++;
    }
}
function addRegionOutliningSpans(sourceFile: SourceFile, out: OutliningSpan[]): void {
    const regions: OutliningSpan[] = [];
    const lineStarts = requireCompilerMember(sourceFile, "getLineStarts").getLineStarts();
    for (const currentLineStart of lineStarts) {
        const lineEnd = requireCompilerMember(sourceFile, "getLineEndOfPosition").getLineEndOfPosition(currentLineStart);
        const lineText = sourceFile.text.substring(currentLineStart, lineEnd);
        const result = parseRegionDelimiter(lineText);
        if (!result || isInComment(sourceFile, currentLineStart)) {
            continue;
        }
        if (result.isStart) {
            const span = createTextSpanFromBounds(sourceFile.text.indexOf("//", currentLineStart), lineEnd);
            regions.push(createOutliningSpan(span, OutliningSpanKind.Region, span, /*autoCollapse*/ false, result.name || "#region"));
        }
        else {
            const region = regions.pop();
            if (region) {
                region.textSpan.length = lineEnd - region.textSpan.start;
                region.hintSpan.length = lineEnd - region.textSpan.start;
                out.push(region);
            }
        }
    }
}
const regionDelimiterRegExp = /^#(end)?region(.*)\r?$/;
function parseRegionDelimiter(lineText: string) {
    // We trim the leading whitespace and // without the regex since the
    // multiple potential whitespace matches can make for some gnarly backtracking behavior
    lineText = lineText.trimStart();
    if (!startsWith(lineText, "//")) {
        return null; // eslint-disable-line no-restricted-syntax
    }
    lineText = lineText.slice(2).trim();
    const result = regionDelimiterRegExp.exec(lineText);
    if (result) {
        return { isStart: !result[1], name: result[2].trim() };
    }
    return undefined;
}
function addOutliningForLeadingCommentsForPos(pos: number, sourceFile: SourceFile, cancellationToken: CancellationToken, out: OutliningSpan[]): void {
    const comments = getLeadingCommentRanges(sourceFile.text, pos);
    if (!comments)
        return;
    let firstSingleLineCommentStart = -1;
    let lastSingleLineCommentEnd = -1;
    let singleLineCommentCount = 0;
    const sourceText = requireCompilerMember(sourceFile, "getFullText").getFullText();
    for (const { kind, pos, end } of comments) {
        cancellationToken.throwIfCancellationRequested();
        switch (kind) {
            case SyntaxKind.SingleLineCommentTrivia:
                // never fold region delimiters into single-line comment regions
                const commentText = sourceText.slice(pos, end);
                if (parseRegionDelimiter(commentText)) {
                    combineAndAddMultipleSingleLineComments();
                    singleLineCommentCount = 0;
                    break;
                }
                // For single line comments, combine consecutive ones (2 or more) into
                // a single span from the start of the first till the end of the last
                if (singleLineCommentCount === 0) {
                    firstSingleLineCommentStart = pos;
                }
                lastSingleLineCommentEnd = end;
                singleLineCommentCount++;
                break;
            case SyntaxKind.MultiLineCommentTrivia:
                combineAndAddMultipleSingleLineComments();
                out.push(createOutliningSpanFromBounds(pos, end, OutliningSpanKind.Comment));
                singleLineCommentCount = 0;
                break;
            default:
                Debug.assertNever(kind);
        }
    }
    combineAndAddMultipleSingleLineComments();
    function combineAndAddMultipleSingleLineComments(): void {
        // Only outline spans of two or more consecutive single line comments
        if (singleLineCommentCount > 1) {
            out.push(createOutliningSpanFromBounds(firstSingleLineCommentStart, lastSingleLineCommentEnd, OutliningSpanKind.Comment));
        }
    }
}
function addOutliningForLeadingCommentsForNode(n: Node, sourceFile: SourceFile, cancellationToken: CancellationToken, out: OutliningSpan[]): void {
    if (isJsxText(n))
        return;
    addOutliningForLeadingCommentsForPos(n.pos, sourceFile, cancellationToken, out);
}
function createOutliningSpanFromBounds(pos: number, end: number, kind: OutliningSpanKind): OutliningSpan {
    return createOutliningSpan(createTextSpanFromBounds(pos, end), kind);
}
function getOutliningSpanForNode(n: Node, sourceFile: SourceFile): OutliningSpan | undefined {
    switch (n.kind) {
        case SyntaxKind.Block:
            if (isFunctionLike(n.parent)) {
                return functionSpan(n.parent, checkedCompilerLayout(n, checked_isBlock), sourceFile);
            }
            // Check if the block is standalone, or 'attached' to some parent statement.
            // If the latter, we want to collapse the block, but consider its hint span
            // to be the entire span of the parent.
            switch ((n.parent)!.kind) {
                case SyntaxKind.DoStatement:
                case SyntaxKind.ForInStatement:
                case SyntaxKind.ForOfStatement:
                case SyntaxKind.ForStatement:
                case SyntaxKind.IfStatement:
                case SyntaxKind.WhileStatement:
                case SyntaxKind.WithStatement:
                case SyntaxKind.CatchClause:
                    return spanForNode((n.parent)!);
                case SyntaxKind.TryStatement:
                    // Could be the try-block, or the finally-block.
                    const tryStatement = checkedCompilerLayout(n.parent, checked_isTryStatement);
                    if ((tryStatement)!.tryBlock === n) {
                        return spanForNode((n.parent)!);
                    }
                    else if ((tryStatement)!.finallyBlock === n) {
                        const node = findChildOfKind((tryStatement)!, SyntaxKind.FinallyKeyword, sourceFile);
                        if (node)
                            return spanForNode(node);
                    }
                // falls through
                default:
                    // Block was a standalone block.  In this case we want to only collapse
                    // the span of the block, independent of any parent span.
                    return createOutliningSpan(createTextSpanFromNode(n, sourceFile), OutliningSpanKind.Code);
            }
        case SyntaxKind.ModuleBlock:
            return spanForNode((n.parent)!);
        case SyntaxKind.ClassDeclaration:
        case SyntaxKind.ClassExpression:
        case SyntaxKind.InterfaceDeclaration:
        case SyntaxKind.EnumDeclaration:
        case SyntaxKind.CaseBlock:
        case SyntaxKind.TypeLiteral:
        case SyntaxKind.ObjectBindingPattern:
            return spanForNode(n);
        case SyntaxKind.TupleType:
            return spanForNode(n, /*autoCollapse*/ false, /*useFullStart*/ !testCompilerLayout(n.parent, isTupleTypeNode), SyntaxKind.OpenBracketToken);
        case SyntaxKind.CaseClause:
        case SyntaxKind.DefaultClause:
            return spanForNodeArray(checkedCompilerLayout((n), isNodeLayout_d6df4b360db4).statements);
        case SyntaxKind.ObjectLiteralExpression:
            return spanForObjectOrArrayLiteral(n);
        case SyntaxKind.ArrayLiteralExpression:
            return spanForObjectOrArrayLiteral(n, SyntaxKind.OpenBracketToken);
        case SyntaxKind.JsxElement:
            return spanForJSXElement(checkedCompilerLayout(n, checked_isJsxElement));
        case SyntaxKind.JsxFragment:
            return spanForJSXFragment(checkedCompilerLayout(n, checked_isJsxFragment));
        case SyntaxKind.JsxSelfClosingElement:
        case SyntaxKind.JsxOpeningElement:
            return spanForJSXAttributes((checkedCompilerLayout(n, checked_isJsxOpeningLikeElement)).attributes);
        case SyntaxKind.TemplateExpression:
        case SyntaxKind.NoSubstitutionTemplateLiteral:
            return spanForTemplateLiteral(checkedCompilerLayout(n, isNodeLayout_5c66c7b04427));
        case SyntaxKind.ArrayBindingPattern:
            return spanForNode(n, /*autoCollapse*/ false, /*useFullStart*/ !testCompilerLayout(n.parent, isBindingElement), SyntaxKind.OpenBracketToken);
        case SyntaxKind.ArrowFunction:
            return spanForArrowFunction(checkedCompilerLayout(n, checked_isArrowFunction));
        case SyntaxKind.CallExpression:
            return spanForCallExpression(checkedCompilerLayout(n, checked_isCallExpression));
        case SyntaxKind.ParenthesizedExpression:
            return spanForParenthesizedExpression(checkedCompilerLayout(n, checked_isParenthesizedExpression));
        case SyntaxKind.NamedImports:
        case SyntaxKind.NamedExports:
        case SyntaxKind.ImportAttributes:
            return spanForImportExportElements(checkedCompilerLayout(n, isNodeLayout_f1f315b6081f));
    }
    function spanForImportExportElements(node: NamedImports | NamedExports | ImportAttributes) {
        if (!node.elements.length) {
            return undefined;
        }
        const openToken = findChildOfKind(node, SyntaxKind.OpenBraceToken, sourceFile);
        const closeToken = findChildOfKind(node, SyntaxKind.CloseBraceToken, sourceFile);
        if (!openToken || !closeToken || positionsAreOnSameLine(openToken.pos, closeToken.pos, sourceFile)) {
            return undefined;
        }
        return spanBetweenTokens(openToken, closeToken, node, sourceFile, /*autoCollapse*/ false, /*useFullStart*/ false);
    }
    function spanForCallExpression(node: CallExpression): OutliningSpan | undefined {
        if (!node.arguments.length) {
            return undefined;
        }
        const openToken = findChildOfKind(node, SyntaxKind.OpenParenToken, sourceFile);
        const closeToken = findChildOfKind(node, SyntaxKind.CloseParenToken, sourceFile);
        if (!openToken || !closeToken || positionsAreOnSameLine(openToken.pos, closeToken.pos, sourceFile)) {
            return undefined;
        }
        return spanBetweenTokens(openToken, closeToken, node, sourceFile, /*autoCollapse*/ false, /*useFullStart*/ true);
    }
    function spanForArrowFunction(node: ArrowFunction): OutliningSpan | undefined {
        if (isBlock(node.body) || isParenthesizedExpression(node.body) || positionsAreOnSameLine(requireCompilerMember(node.body, "getFullStart").getFullStart(), requireCompilerMember(node.body, "getEnd").getEnd(), sourceFile)) {
            return undefined;
        }
        const textSpan = createTextSpanFromBounds(requireCompilerMember(node.body, "getFullStart").getFullStart(), requireCompilerMember(node.body, "getEnd").getEnd());
        return createOutliningSpan(textSpan, OutliningSpanKind.Code, createTextSpanFromNode(node));
    }
    function spanForJSXElement(node: JsxElement): OutliningSpan | undefined {
        const textSpan = createTextSpanFromBounds(requireCompilerMember(node.openingElement, "getStart").getStart(sourceFile), requireCompilerMember(node.closingElement, "getEnd").getEnd());
        const tagName = requireCompilerMember(node.openingElement.tagName, "getText").getText(sourceFile);
        const bannerText = "<" + tagName + ">...</" + tagName + ">";
        return createOutliningSpan(textSpan, OutliningSpanKind.Code, textSpan, /*autoCollapse*/ false, bannerText);
    }
    function spanForJSXFragment(node: JsxFragment): OutliningSpan | undefined {
        const textSpan = createTextSpanFromBounds(requireCompilerMember(node.openingFragment, "getStart").getStart(sourceFile), requireCompilerMember(node.closingFragment, "getEnd").getEnd());
        const bannerText = "<>...</>";
        return createOutliningSpan(textSpan, OutliningSpanKind.Code, textSpan, /*autoCollapse*/ false, bannerText);
    }
    function spanForJSXAttributes(node: JsxAttributes): OutliningSpan | undefined {
        if (node.properties.length === 0) {
            return undefined;
        }
        return createOutliningSpanFromBounds(requireCompilerMember(node, "getStart").getStart(sourceFile), requireCompilerMember(node, "getEnd").getEnd(), OutliningSpanKind.Code);
    }
    function spanForTemplateLiteral(node: TemplateExpression | NoSubstitutionTemplateLiteral) {
        if (node.kind === SyntaxKind.NoSubstitutionTemplateLiteral && node.text.length === 0) {
            return undefined;
        }
        return createOutliningSpanFromBounds(requireCompilerMember(node, "getStart").getStart(sourceFile), requireCompilerMember(node, "getEnd").getEnd(), OutliningSpanKind.Code);
    }
    function spanForObjectOrArrayLiteral(node: Node, open: typeof SyntaxKind.OpenBraceToken | typeof SyntaxKind.OpenBracketToken = SyntaxKind.OpenBraceToken): OutliningSpan | undefined {
        // If the block has no leading keywords and is inside an array literal or call expression,
        // we only want to collapse the span of the block.
        // Otherwise, the collapsed section will include the end of the previous line.
        return spanForNode(node, /*autoCollapse*/ false, /*useFullStart*/ !testCompilerLayout(node.parent, isArrayLiteralExpression) && !testCompilerLayout(node.parent, isCallExpression), open);
    }
    function spanForNode(hintSpanNode: Node, autoCollapse = false, useFullStart = true, open: typeof SyntaxKind.OpenBraceToken | typeof SyntaxKind.OpenBracketToken = SyntaxKind.OpenBraceToken, close: SyntaxKind = open === SyntaxKind.OpenBraceToken ? SyntaxKind.CloseBraceToken : SyntaxKind.CloseBracketToken): OutliningSpan | undefined {
        const openToken = findChildOfKind(n, open, sourceFile);
        const closeToken = findChildOfKind(n, close, sourceFile);
        return openToken && closeToken && spanBetweenTokens(openToken, closeToken, hintSpanNode, sourceFile, autoCollapse, useFullStart);
    }
    function spanForNodeArray(nodeArray: NodeArray<Node>): OutliningSpan | undefined {
        return nodeArray.length ? createOutliningSpan(createTextSpanFromRange(nodeArray), OutliningSpanKind.Code) : undefined;
    }
    function spanForParenthesizedExpression(node: ParenthesizedExpression): OutliningSpan | undefined {
        if (positionsAreOnSameLine(requireCompilerMember(node, "getStart").getStart(), requireCompilerMember(node, "getEnd").getEnd(), sourceFile))
            return undefined;
        const textSpan = createTextSpanFromBounds(requireCompilerMember(node, "getStart").getStart(), requireCompilerMember(node, "getEnd").getEnd());
        return createOutliningSpan(textSpan, OutliningSpanKind.Code, createTextSpanFromNode(node));
    }
}
function functionSpan(node: SignatureDeclaration, body: Block, sourceFile: SourceFile): OutliningSpan | undefined {
    const openToken = tryGetFunctionOpenToken(node, body, sourceFile);
    const closeToken = findChildOfKind(body, SyntaxKind.CloseBraceToken, sourceFile);
    return openToken && closeToken && spanBetweenTokens(openToken, closeToken, node, sourceFile, /*autoCollapse*/ node.kind !== SyntaxKind.ArrowFunction);
}
function spanBetweenTokens(openToken: Node, closeToken: Node, hintSpanNode: Node, sourceFile: SourceFile, autoCollapse = false, useFullStart = true): OutliningSpan {
    const textSpan = createTextSpanFromBounds(useFullStart ? requireCompilerMember(openToken, "getFullStart").getFullStart() : requireCompilerMember(openToken, "getStart").getStart(sourceFile), requireCompilerMember(closeToken, "getEnd").getEnd());
    return createOutliningSpan(textSpan, OutliningSpanKind.Code, createTextSpanFromNode(hintSpanNode, sourceFile), autoCollapse);
}
function createOutliningSpan(textSpan: TextSpan, kind: OutliningSpanKind, hintSpan: TextSpan = textSpan, autoCollapse = false, bannerText = "..."): OutliningSpan {
    return { textSpan, kind, hintSpan, bannerText, autoCollapse };
}
function tryGetFunctionOpenToken(node: SignatureDeclaration, body: Block, sourceFile: SourceFile): Node | undefined {
    if (isNodeArrayMultiLine(node.parameters, sourceFile)) {
        const openParenToken = findChildOfKind(node, SyntaxKind.OpenParenToken, sourceFile);
        if (openParenToken) {
            return openParenToken;
        }
    }
    return findChildOfKind(body, SyntaxKind.OpenBraceToken, sourceFile);
}
