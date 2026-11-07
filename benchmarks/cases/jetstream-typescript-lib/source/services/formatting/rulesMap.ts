// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/formatting/rulesMap.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { anyContext, type FormatContext, FormattingContext, getAllRules, type Rule, RuleAction, type RuleSpec } from "../_namespaces/ts.formatting.ts";
import { Debug, every, type FormatCodeSettings, type FormattingHost, SyntaxKind } from "../_namespaces/ts.ts";
/** @internal */
export function getFormatContext(options: FormatCodeSettings, host: FormattingHost): FormatContext {
    return { options, getRules: getRulesMap(), host };
}
let rulesMapCache: RulesMap | undefined;
function getRulesMap(): RulesMap {
    if (rulesMapCache === undefined) {
        rulesMapCache = createRulesMap(getAllRules());
    }
    return rulesMapCache;
}
/**
 * For a given rule action, gets a mask of other rule actions that
 * cannot be applied at the same position.
 */
function getRuleActionExclusion(ruleAction: RuleAction): RuleAction {
    let mask: RuleAction = RuleAction.None;
    if (ruleAction & RuleAction.StopProcessingSpaceActions) {
        mask |= RuleAction.ModifySpaceAction;
    }
    if (ruleAction & RuleAction.StopProcessingTokenActions) {
        mask |= RuleAction.ModifyTokenAction;
    }
    if (ruleAction & RuleAction.ModifySpaceAction) {
        mask |= RuleAction.ModifySpaceAction;
    }
    if (ruleAction & RuleAction.ModifyTokenAction) {
        mask |= RuleAction.ModifyTokenAction;
    }
    return mask;
}
/** @internal */
export type RulesMap = (context: FormattingContext) => readonly Rule[] | undefined;
function createRulesMap(rules: readonly RuleSpec[]): RulesMap {
    const map = buildMap(rules);
    return context => {
        const bucket = map[getRuleBucketIndex(context.currentTokenSpan.kind, context.nextTokenSpan.kind)];
        if (bucket) {
            const rules: Rule[] = [];
            let ruleActionMask: RuleAction = 0;
            for (const rule of bucket) {
                const acceptRuleActions = ~getRuleActionExclusion(ruleActionMask);
                if (rule.action & acceptRuleActions && every(rule.context, c => c(context))) {
                    rules.push(rule);
                    ruleActionMask |= rule.action;
                }
            }
            if (rules.length) {
                return rules;
            }
        }
    };
}
function buildMap(rules: readonly RuleSpec[]): readonly (readonly Rule[])[] {
    // Map from bucket index to array of rules
    const map: Rule[][] = new Array(mapRowLength * mapRowLength);
    // This array is used only during construction of the rulesbucket in the map
    const rulesBucketConstructionStateList = new Array<number>(map.length);
    for (const rule of rules) {
        const specificRule = rule.leftTokenRange.isSpecific && rule.rightTokenRange.isSpecific;
        for (const left of rule.leftTokenRange.tokens) {
            for (const right of rule.rightTokenRange.tokens) {
                const index = getRuleBucketIndex(left, right);
                let rulesBucket = map[index];
                if (rulesBucket === undefined) {
                    rulesBucket = map[index] = [];
                }
                addRule(rulesBucket, rule.rule, specificRule, rulesBucketConstructionStateList, index);
            }
        }
    }
    return map;
}
function getRuleBucketIndex(row: number, column: number): number {
    Debug.assert(row <= SyntaxKind.LastKeyword && column <= SyntaxKind.LastKeyword, "Must compute formatting context from tokens");
    return (row * mapRowLength) + column;
}
const maskBitSize = 5;
const mask = 0b11111; // MaskBitSize bits
const mapRowLength = SyntaxKind.LastToken + 1;
type RulesPosition = number;
const RulesPosition: {
    readonly StopRulesSpecific: 0;
    readonly StopRulesAny: 5;
    readonly ContextRulesSpecific: 10;
    readonly ContextRulesAny: 15;
    readonly NoContextRulesSpecific: 20;
    readonly NoContextRulesAny: 25;
    [index: number]: string;
} = {
    StopRulesSpecific: 0,
    "0": "StopRulesSpecific",
    StopRulesAny: 5,
    "5": "StopRulesAny",
    ContextRulesSpecific: 10,
    "10": "ContextRulesSpecific",
    ContextRulesAny: 15,
    "15": "ContextRulesAny",
    NoContextRulesSpecific: 20,
    "20": "NoContextRulesSpecific",
    NoContextRulesAny: 25,
    "25": "NoContextRulesAny"
};
// The Rules list contains all the inserted rules into a rulebucket in the following order:
//    1- Ignore rules with specific token combination
//    2- Ignore rules with any token combination
//    3- Context rules with specific token combination
//    4- Context rules with any token combination
//    5- Non-context rules with specific token combination
//    6- Non-context rules with any token combination
//
// The member rulesInsertionIndexBitmap is used to describe the number of rules
// in each sub-bucket (above) hence can be used to know the index of where to insert
// the next rule. It's a bitmap which contains 6 different sections each is given 5 bits.
//
// Example:
// In order to insert a rule to the end of sub-bucket (3), we get the index by adding
// the values in the bitmap segments 3rd, 2nd, and 1st.
function addRule(rules: Rule[], rule: Rule, specificTokens: boolean, constructionState: number[], rulesBucketIndex: number): void {
    const position = rule.action & RuleAction.StopAction ?
        specificTokens ? RulesPosition.StopRulesSpecific : RulesPosition.StopRulesAny :
        rule.context !== anyContext ?
            specificTokens ? RulesPosition.ContextRulesSpecific : RulesPosition.ContextRulesAny :
            specificTokens ? RulesPosition.NoContextRulesSpecific : RulesPosition.NoContextRulesAny;
    const state = constructionState[rulesBucketIndex] || 0;
    rules.splice(getInsertionIndex(state, position), 0, rule);
    constructionState[rulesBucketIndex] = increaseInsertionIndex(state, position);
}
function getInsertionIndex(indexBitmap: number, maskPosition: RulesPosition) {
    let index = 0;
    for (let pos = 0; pos <= maskPosition; pos += maskBitSize) {
        index += indexBitmap & mask;
        indexBitmap >>= maskBitSize;
    }
    return index;
}
function increaseInsertionIndex(indexBitmap: number, maskPosition: RulesPosition): number {
    const value = ((indexBitmap >> maskPosition) & mask) + 1;
    Debug.assert((value & mask) === value, "Adding more rules into the sub-bucket than allowed. Maximum allowed is 32 rules.");
    return (indexBitmap & ~(mask << maskPosition)) | (value << maskPosition);
}
