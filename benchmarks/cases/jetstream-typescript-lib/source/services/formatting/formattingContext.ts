// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/formatting/formattingContext.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { type TextRangeWithKind } from "../_namespaces/ts.formatting.ts";
import { Debug, findChildOfKind, type FormatCodeSettings, type Node, type SourceFileLike, SyntaxKind } from "../_namespaces/ts.ts";
/** @internal */
export type FormattingRequestKind = number;
/** @internal */
export const FormattingRequestKind: {
    readonly FormatDocument: 0;
    readonly FormatSelection: 1;
    readonly FormatOnEnter: 2;
    readonly FormatOnSemicolon: 3;
    readonly FormatOnOpeningCurlyBrace: 4;
    readonly FormatOnClosingCurlyBrace: 5;
    [index: number]: string;
} = {
    FormatDocument: 0,
    "0": "FormatDocument",
    FormatSelection: 1,
    "1": "FormatSelection",
    FormatOnEnter: 2,
    "2": "FormatOnEnter",
    FormatOnSemicolon: 3,
    "3": "FormatOnSemicolon",
    FormatOnOpeningCurlyBrace: 4,
    "4": "FormatOnOpeningCurlyBrace",
    FormatOnClosingCurlyBrace: 5,
    "5": "FormatOnClosingCurlyBrace"
};
/** @internal */
export class FormattingContext {
    constructor(sourceFile: SourceFileLike, formattingRequestKind: FormattingRequestKind, options: FormatCodeSettings) {
        this.sourceFile = sourceFile;
        this.formattingRequestKind = formattingRequestKind;
        this.options = options;
    }
    declare public currentTokenSpan: TextRangeWithKind;
    declare public nextTokenSpan: TextRangeWithKind;
    declare public contextNode: Node;
    declare public currentTokenParent: Node;
    declare public nextTokenParent: Node;
    declare private contextNodeAllOnSameLine: boolean | undefined;
    declare private nextNodeAllOnSameLine: boolean | undefined;
    declare private tokensAreOnSameLine: boolean | undefined;
    declare private contextNodeBlockIsOnOneLine: boolean | undefined;
    declare private nextNodeBlockIsOnOneLine: boolean | undefined;
    public updateContext(currentRange: TextRangeWithKind, currentTokenParent: Node, nextRange: TextRangeWithKind, nextTokenParent: Node, commonParent: Node): void {
        this.currentTokenSpan = Debug.checkDefined(currentRange);
        this.currentTokenParent = Debug.checkDefined(currentTokenParent);
        this.nextTokenSpan = Debug.checkDefined(nextRange);
        this.nextTokenParent = Debug.checkDefined(nextTokenParent);
        this.contextNode = Debug.checkDefined(commonParent);
        // drop cached results
        this.contextNodeAllOnSameLine = undefined;
        this.nextNodeAllOnSameLine = undefined;
        this.tokensAreOnSameLine = undefined;
        this.contextNodeBlockIsOnOneLine = undefined;
        this.nextNodeBlockIsOnOneLine = undefined;
    }
    public ContextNodeAllOnSameLine(): boolean {
        if (this.contextNodeAllOnSameLine === undefined) {
            this.contextNodeAllOnSameLine = this.NodeIsOnOneLine(this.contextNode);
        }
        return this.contextNodeAllOnSameLine;
    }
    public NextNodeAllOnSameLine(): boolean {
        if (this.nextNodeAllOnSameLine === undefined) {
            this.nextNodeAllOnSameLine = this.NodeIsOnOneLine(this.nextTokenParent);
        }
        return this.nextNodeAllOnSameLine;
    }
    public TokensAreOnSameLine(): boolean {
        if (this.tokensAreOnSameLine === undefined) {
            const startLine = requireCompilerMember(this.sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(this.currentTokenSpan.pos).line;
            const endLine = requireCompilerMember(this.sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(this.nextTokenSpan.pos).line;
            this.tokensAreOnSameLine = startLine === endLine;
        }
        return this.tokensAreOnSameLine;
    }
    public ContextNodeBlockIsOnOneLine(): boolean {
        if (this.contextNodeBlockIsOnOneLine === undefined) {
            this.contextNodeBlockIsOnOneLine = this.BlockIsOnOneLine(this.contextNode);
        }
        return this.contextNodeBlockIsOnOneLine;
    }
    public NextNodeBlockIsOnOneLine(): boolean {
        if (this.nextNodeBlockIsOnOneLine === undefined) {
            this.nextNodeBlockIsOnOneLine = this.BlockIsOnOneLine(this.nextTokenParent);
        }
        return this.nextNodeBlockIsOnOneLine;
    }
    private NodeIsOnOneLine(node: Node): boolean {
        const startLine = requireCompilerMember(this.sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(node, "getStart").getStart(this.sourceFile)).line;
        const endLine = requireCompilerMember(this.sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(node, "getEnd").getEnd()).line;
        return startLine === endLine;
    }
    private BlockIsOnOneLine(node: Node): boolean {
        const openBrace = findChildOfKind(node, SyntaxKind.OpenBraceToken, this.sourceFile);
        const closeBrace = findChildOfKind(node, SyntaxKind.CloseBraceToken, this.sourceFile);
        if (openBrace && closeBrace) {
            const startLine = requireCompilerMember(this.sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(openBrace, "getEnd").getEnd()).line;
            const endLine = requireCompilerMember(this.sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(closeBrace, "getStart").getStart(this.sourceFile)).line;
            return startLine === endLine;
        }
        return false;
    }
    declare public sourceFile: SourceFileLike;
    declare public formattingRequestKind: FormattingRequestKind;
    declare public options: FormatCodeSettings;
}
