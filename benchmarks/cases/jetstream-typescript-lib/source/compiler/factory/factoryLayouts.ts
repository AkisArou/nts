// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// The factory allocates a fixed compiler layout selected by its original SyntaxKind.
// These finite correlations replace the original unrestricted generic casts.
import {SyntaxKind, type Node, type JSDocAllType, type JSDocUnknownType, type JSDocNonNullableType, type JSDocNullableType, type JSDocOptionalType, type JSDocVariadicType, type JSDocNamepathType, type JSDocTemplateTag, type JSDocTypedefTag, type JSDocParameterTag, type JSDocPropertyTag, type JSDocCallbackTag, type JSDocOverloadTag, type JSDocAugmentsTag, type JSDocImplementsTag, type JSDocSeeTag, type JSDocUnknownTag, type JSDocEnumTag, type JSDocImportTag, type JSDocAuthorTag, type JSDocClassTag, type JSDocPublicTag, type JSDocPrivateTag, type JSDocProtectedTag, type JSDocReadonlyTag, type JSDocOverrideTag, type JSDocDeprecatedTag, type JSDocTypeTag, type JSDocReturnTag, type JSDocThisTag, type JSDocThrowsTag, type JSDocSatisfiesTag, type TypeAssertion, type TemplateHead, type TemplateMiddle, type TemplateTail, type NoSubstitutionTemplateLiteral, type UnionTypeNode, type IntersectionTypeNode, type NotEmittedTypeElement, type SyntheticReferenceExpression, type JSDocText} from "../types.ts";
export interface FactoryNodeLayouts {
  [SyntaxKind.JSDocAllType]: JSDocAllType;
  [SyntaxKind.JSDocUnknownType]: JSDocUnknownType;
  [SyntaxKind.JSDocNonNullableType]: JSDocNonNullableType;
  [SyntaxKind.JSDocNullableType]: JSDocNullableType;
  [SyntaxKind.JSDocOptionalType]: JSDocOptionalType;
  [SyntaxKind.JSDocVariadicType]: JSDocVariadicType;
  [SyntaxKind.JSDocNamepathType]: JSDocNamepathType;
  [SyntaxKind.JSDocTemplateTag]: JSDocTemplateTag;
  [SyntaxKind.JSDocTypedefTag]: JSDocTypedefTag;
  [SyntaxKind.JSDocParameterTag]: JSDocParameterTag;
  [SyntaxKind.JSDocPropertyTag]: JSDocPropertyTag;
  [SyntaxKind.JSDocCallbackTag]: JSDocCallbackTag;
  [SyntaxKind.JSDocOverloadTag]: JSDocOverloadTag;
  [SyntaxKind.JSDocAugmentsTag]: JSDocAugmentsTag;
  [SyntaxKind.JSDocImplementsTag]: JSDocImplementsTag;
  [SyntaxKind.JSDocSeeTag]: JSDocSeeTag;
  [SyntaxKind.JSDocTag]: JSDocUnknownTag;
  [SyntaxKind.JSDocEnumTag]: JSDocEnumTag;
  [SyntaxKind.JSDocImportTag]: JSDocImportTag;
  [SyntaxKind.JSDocAuthorTag]: JSDocAuthorTag;
  [SyntaxKind.JSDocClassTag]: JSDocClassTag;
  [SyntaxKind.JSDocPublicTag]: JSDocPublicTag;
  [SyntaxKind.JSDocPrivateTag]: JSDocPrivateTag;
  [SyntaxKind.JSDocProtectedTag]: JSDocProtectedTag;
  [SyntaxKind.JSDocReadonlyTag]: JSDocReadonlyTag;
  [SyntaxKind.JSDocOverrideTag]: JSDocOverrideTag;
  [SyntaxKind.JSDocDeprecatedTag]: JSDocDeprecatedTag;
  [SyntaxKind.JSDocTypeTag]: JSDocTypeTag;
  [SyntaxKind.JSDocReturnTag]: JSDocReturnTag;
  [SyntaxKind.JSDocThisTag]: JSDocThisTag;
  [SyntaxKind.JSDocThrowsTag]: JSDocThrowsTag;
  [SyntaxKind.JSDocSatisfiesTag]: JSDocSatisfiesTag;
  [SyntaxKind.TypeAssertionExpression]: TypeAssertion;
  [SyntaxKind.TemplateHead]: TemplateHead;
  [SyntaxKind.TemplateMiddle]: TemplateMiddle;
  [SyntaxKind.TemplateTail]: TemplateTail;
  [SyntaxKind.NoSubstitutionTemplateLiteral]: NoSubstitutionTemplateLiteral;
  [SyntaxKind.UnionType]: UnionTypeNode;
  [SyntaxKind.IntersectionType]: IntersectionTypeNode;
  [SyntaxKind.NotEmittedTypeElement]: NotEmittedTypeElement;
  [SyntaxKind.SyntheticReferenceExpression]: SyntheticReferenceExpression;
  [SyntaxKind.JSDocText]: JSDocText;
}
export type JSDocPrimaryKind = typeof SyntaxKind.JSDocAllType | typeof SyntaxKind.JSDocUnknownType;
export type JSDocPrePostfixKind = typeof SyntaxKind.JSDocNonNullableType | typeof SyntaxKind.JSDocNullableType;
export type JSDocUnaryKind = typeof SyntaxKind.JSDocOptionalType | typeof SyntaxKind.JSDocVariadicType | typeof SyntaxKind.JSDocNamepathType | typeof SyntaxKind.JSDocNonNullableType | typeof SyntaxKind.JSDocNullableType;
export type JSDocSimpleTagKind = typeof SyntaxKind.JSDocAuthorTag | typeof SyntaxKind.JSDocClassTag | typeof SyntaxKind.JSDocPublicTag | typeof SyntaxKind.JSDocPrivateTag | typeof SyntaxKind.JSDocProtectedTag | typeof SyntaxKind.JSDocReadonlyTag | typeof SyntaxKind.JSDocOverrideTag | typeof SyntaxKind.JSDocDeprecatedTag;
export type JSDocTypeLikeTagKind = typeof SyntaxKind.JSDocTypeTag | typeof SyntaxKind.JSDocReturnTag | typeof SyntaxKind.JSDocThisTag | typeof SyntaxKind.JSDocThrowsTag | typeof SyntaxKind.JSDocSatisfiesTag;
export type JSDocTagKind = typeof SyntaxKind.JSDocTemplateTag | typeof SyntaxKind.JSDocTypedefTag | typeof SyntaxKind.JSDocParameterTag | typeof SyntaxKind.JSDocPropertyTag | typeof SyntaxKind.JSDocCallbackTag | typeof SyntaxKind.JSDocOverloadTag | typeof SyntaxKind.JSDocAugmentsTag | typeof SyntaxKind.JSDocImplementsTag | typeof SyntaxKind.JSDocSeeTag | typeof SyntaxKind.JSDocTag | typeof SyntaxKind.JSDocEnumTag | typeof SyntaxKind.JSDocImportTag | typeof SyntaxKind.JSDocAuthorTag | typeof SyntaxKind.JSDocClassTag | typeof SyntaxKind.JSDocPublicTag | typeof SyntaxKind.JSDocPrivateTag | typeof SyntaxKind.JSDocProtectedTag | typeof SyntaxKind.JSDocReadonlyTag | typeof SyntaxKind.JSDocOverrideTag | typeof SyntaxKind.JSDocDeprecatedTag | typeof SyntaxKind.JSDocTypeTag | typeof SyntaxKind.JSDocReturnTag | typeof SyntaxKind.JSDocThisTag | typeof SyntaxKind.JSDocThrowsTag | typeof SyntaxKind.JSDocSatisfiesTag;
export type JSDocTagDeclarationKind = typeof SyntaxKind.JSDocTypedefTag | typeof SyntaxKind.JSDocParameterTag | typeof SyntaxKind.JSDocPropertyTag | typeof SyntaxKind.JSDocCallbackTag | typeof SyntaxKind.JSDocEnumTag;
function isFactoryNodeKind<K extends keyof FactoryNodeLayouts>(value: Node, kind: K): value is FactoryNodeLayouts[K] {
    return value.kind === kind;
}
export function requireFactoryNodeKind<K extends keyof FactoryNodeLayouts>(value: Node, kind: K): FactoryNodeLayouts[K] {
    if (isFactoryNodeKind(value, kind)) return value;
    throw new TypeError("Unexpected node kind from the compiler allocator");
}
