// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/formatting/rule.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { FormattingContext } from "../_namespaces/ts.formatting.ts";
import { emptyArray, SyntaxKind } from "../_namespaces/ts.ts";
/** @internal */
export interface Rule {
    // Used for debugging to identify each rule based on the property name it's assigned to.
    debugName: string;
    context: readonly ContextPredicate[];
    action: RuleAction;
    flags: RuleFlags;
}
/** @internal */
export type ContextPredicate = (context: FormattingContext) => boolean;
/** @internal */
export const anyContext: readonly ContextPredicate[] = emptyArray;
// dprint-ignore
/** @internal */
export type RuleAction = number;
// dprint-ignore
/** @internal */
export const RuleAction: {
    readonly None: 0;
    readonly StopProcessingSpaceActions: 1;
    readonly StopProcessingTokenActions: 2;
    readonly InsertSpace: 4;
    readonly InsertNewLine: 8;
    readonly DeleteSpace: 16;
    readonly DeleteToken: 32;
    readonly InsertTrailingSemicolon: 64;
    readonly StopAction: 3;
    readonly ModifySpaceAction: 28;
    readonly ModifyTokenAction: 96;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    StopProcessingSpaceActions: 1,
    "1": "StopProcessingSpaceActions",
    StopProcessingTokenActions: 2,
    "2": "StopProcessingTokenActions",
    InsertSpace: 4,
    "4": "InsertSpace",
    InsertNewLine: 8,
    "8": "InsertNewLine",
    DeleteSpace: 16,
    "16": "DeleteSpace",
    DeleteToken: 32,
    "32": "DeleteToken",
    InsertTrailingSemicolon: 64,
    "64": "InsertTrailingSemicolon",
    StopAction: 3,
    "3": "StopAction",
    ModifySpaceAction: 28,
    "28": "ModifySpaceAction",
    ModifyTokenAction: 96,
    "96": "ModifyTokenAction"
};
/** @internal */
export type RuleFlags = number;
/** @internal */
export const RuleFlags: {
    readonly None: 0;
    readonly CanDeleteNewLines: 1;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    CanDeleteNewLines: 1,
    "1": "CanDeleteNewLines"
};
/** @internal */
export interface TokenRange {
    tokens: readonly SyntaxKind[];
    isSpecific: boolean;
}
