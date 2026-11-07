// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/factory/nodeFactory.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireFactoryNodeKind, type FactoryNodeLayouts, type JSDocPrimaryKind, type JSDocPrePostfixKind, type JSDocUnaryKind, type JSDocSimpleTagKind, type JSDocTypeLikeTagKind, type JSDocTagKind, type JSDocTagDeclarationKind } from "./factoryLayouts.ts";
import { isNodeLayout_d3bc2d641bbb, isNodeLayout_1bf25640bb33, isNodeLayout_fd49999be36b, isNodeLayout_99b92dd8f0c5, isNodeLayout_ae2cefde45f1 } from "../../checkedLayouts.ts";
import { isStringLiteral as checked_isStringLiteral } from "../_namespaces/ts.ts";
import { isIdentifier as checked_isIdentifier } from "../_namespaces/ts.ts";
import { isGeneratedIdentifier as checked_isGeneratedIdentifier } from "../_namespaces/ts.ts";
import { isPrivateIdentifier as checked_isPrivateIdentifier } from "../_namespaces/ts.ts";
import { isComputedPropertyName as checked_isComputedPropertyName } from "../_namespaces/ts.ts";
import { isTypeParameterDeclaration as checked_isTypeParameterDeclaration } from "../_namespaces/ts.ts";
import { isParameter as checked_isParameter } from "../_namespaces/ts.ts";
import { isPropertySignature as checked_isPropertySignature } from "../_namespaces/ts.ts";
import { isPropertyDeclaration as checked_isPropertyDeclaration } from "../_namespaces/ts.ts";
import { isMethodSignature as checked_isMethodSignature } from "../_namespaces/ts.ts";
import { isMethodDeclaration as checked_isMethodDeclaration } from "../_namespaces/ts.ts";
import { isConstructorDeclaration as checked_isConstructorDeclaration } from "../_namespaces/ts.ts";
import { isIndexSignatureDeclaration as checked_isIndexSignatureDeclaration } from "../_namespaces/ts.ts";
import { isConstructorTypeNode as checked_isConstructorTypeNode } from "../_namespaces/ts.ts";
import { isArrayLiteralExpression as checked_isArrayLiteralExpression } from "../_namespaces/ts.ts";
import { isObjectLiteralExpression as checked_isObjectLiteralExpression } from "../_namespaces/ts.ts";
import { isPropertyAccessExpression as checked_isPropertyAccessExpression } from "../_namespaces/ts.ts";
import { isElementAccessExpression as checked_isElementAccessExpression } from "../_namespaces/ts.ts";
import { isParenthesizedExpression as checked_isParenthesizedExpression } from "../_namespaces/ts.ts";
import { isFunctionExpression as checked_isFunctionExpression } from "../_namespaces/ts.ts";
import { isArrowFunction as checked_isArrowFunction } from "../_namespaces/ts.ts";
import { isBinaryExpression as checked_isBinaryExpression } from "../_namespaces/ts.ts";
import { isClassExpression as checked_isClassExpression } from "../_namespaces/ts.ts";
import { isOmittedExpression as checked_isOmittedExpression } from "../_namespaces/ts.ts";
import { isNonNullChain as checked_isNonNullChain } from "../_namespaces/ts.ts";
import { isVariableStatement as checked_isVariableStatement } from "../_namespaces/ts.ts";
import { isLabeledStatement as checked_isLabeledStatement } from "../_namespaces/ts.ts";
import { isVariableDeclaration as checked_isVariableDeclaration } from "../_namespaces/ts.ts";
import { isFunctionDeclaration as checked_isFunctionDeclaration } from "../_namespaces/ts.ts";
import { isClassDeclaration as checked_isClassDeclaration } from "../_namespaces/ts.ts";
import { isInterfaceDeclaration as checked_isInterfaceDeclaration } from "../_namespaces/ts.ts";
import { isTypeAliasDeclaration as checked_isTypeAliasDeclaration } from "../_namespaces/ts.ts";
import { isEnumDeclaration as checked_isEnumDeclaration } from "../_namespaces/ts.ts";
import { isModuleDeclaration as checked_isModuleDeclaration } from "../_namespaces/ts.ts";
import { isImportEqualsDeclaration as checked_isImportEqualsDeclaration } from "../_namespaces/ts.ts";
import { isImportDeclaration as checked_isImportDeclaration } from "../_namespaces/ts.ts";
import { isExportAssignment as checked_isExportAssignment } from "../_namespaces/ts.ts";
import { isExportDeclaration as checked_isExportDeclaration } from "../_namespaces/ts.ts";
import { isExternalModuleReference as checked_isExternalModuleReference } from "../_namespaces/ts.ts";
import { isSourceFile as checked_isSourceFile } from "../_namespaces/ts.ts";
import { isNotEmittedStatement as checked_isNotEmittedStatement } from "../_namespaces/ts.ts";
import { isCommaListExpression as checked_isCommaListExpression } from "../_namespaces/ts.ts";
import { isGeneratedPrivateIdentifier as checked_isGeneratedPrivateIdentifier } from "../_namespaces/ts.ts";
import { isPrologueDirective as checked_isPrologueDirective } from "../_namespaces/ts.ts";
import { isStatement as checked_isStatement } from "../_namespaces/ts.ts";
import { checkedCompilerLayout, present, dictionaryValue } from "../../checked.ts";
import { isNumericLiteral as checked_isNumericLiteral } from "./nodeTests.ts";
import { isBigIntLiteral as checked_isBigIntLiteral } from "./nodeTests.ts";
import { isRegularExpressionLiteral as checked_isRegularExpressionLiteral } from "./nodeTests.ts";
import { isNoSubstitutionTemplateLiteral as checked_isNoSubstitutionTemplateLiteral } from "./nodeTests.ts";
import { isQualifiedName as checked_isQualifiedName } from "./nodeTests.ts";
import { isDecorator as checked_isDecorator } from "./nodeTests.ts";
import { isClassStaticBlockDeclaration as checked_isClassStaticBlockDeclaration } from "./nodeTests.ts";
import { isGetAccessor as checked_isGetAccessor } from "../utilitiesPublic.ts";
import { isSetAccessor as checked_isSetAccessor } from "../utilitiesPublic.ts";
import { isCallSignatureDeclaration as checked_isCallSignatureDeclaration } from "./nodeTests.ts";
import { isConstructSignatureDeclaration as checked_isConstructSignatureDeclaration } from "./nodeTests.ts";
import { isTemplateLiteralTypeSpan as checked_isTemplateLiteralTypeSpan } from "./nodeTests.ts";
import { isTypePredicateNode as checked_isTypePredicateNode } from "./nodeTests.ts";
import { isTypeReferenceNode as checked_isTypeReferenceNode } from "./nodeTests.ts";
import { isFunctionTypeNode as checked_isFunctionTypeNode } from "./nodeTests.ts";
import { isTypeQueryNode as checked_isTypeQueryNode } from "./nodeTests.ts";
import { isTypeLiteralNode as checked_isTypeLiteralNode } from "./nodeTests.ts";
import { isArrayTypeNode as checked_isArrayTypeNode } from "./nodeTests.ts";
import { isTupleTypeNode as checked_isTupleTypeNode } from "./nodeTests.ts";
import { isNamedTupleMember as checked_isNamedTupleMember } from "./nodeTests.ts";
import { isOptionalTypeNode as checked_isOptionalTypeNode } from "./nodeTests.ts";
import { isRestTypeNode as checked_isRestTypeNode } from "./nodeTests.ts";
import { isUnionTypeNode as checked_isUnionTypeNode } from "./nodeTests.ts";
import { isIntersectionTypeNode as checked_isIntersectionTypeNode } from "./nodeTests.ts";
import { isConditionalTypeNode as checked_isConditionalTypeNode } from "./nodeTests.ts";
import { isInferTypeNode as checked_isInferTypeNode } from "./nodeTests.ts";
import { isTemplateLiteralTypeNode as checked_isTemplateLiteralTypeNode } from "./nodeTests.ts";
import { isImportTypeNode as checked_isImportTypeNode } from "./nodeTests.ts";
import { isParenthesizedTypeNode as checked_isParenthesizedTypeNode } from "./nodeTests.ts";
import { isThisTypeNode as checked_isThisTypeNode } from "./nodeTests.ts";
import { isTypeOperatorNode as checked_isTypeOperatorNode } from "./nodeTests.ts";
import { isIndexedAccessTypeNode as checked_isIndexedAccessTypeNode } from "./nodeTests.ts";
import { isMappedTypeNode as checked_isMappedTypeNode } from "./nodeTests.ts";
import { isLiteralTypeNode as checked_isLiteralTypeNode } from "./nodeTests.ts";
import { isObjectBindingPattern as checked_isObjectBindingPattern } from "./nodeTests.ts";
import { isArrayBindingPattern as checked_isArrayBindingPattern } from "./nodeTests.ts";
import { isBindingElement as checked_isBindingElement } from "./nodeTests.ts";
import { isCallExpression as checked_isCallExpression } from "./nodeTests.ts";
import { isNewExpression as checked_isNewExpression } from "./nodeTests.ts";
import { isTaggedTemplateExpression as checked_isTaggedTemplateExpression } from "./nodeTests.ts";
import { isDeleteExpression as checked_isDeleteExpression } from "./nodeTests.ts";
import { isTypeOfExpression as checked_isTypeOfExpression } from "./nodeTests.ts";
import { isVoidExpression as checked_isVoidExpression } from "./nodeTests.ts";
import { isAwaitExpression as checked_isAwaitExpression } from "./nodeTests.ts";
import { isPrefixUnaryExpression as checked_isPrefixUnaryExpression } from "./nodeTests.ts";
import { isPostfixUnaryExpression as checked_isPostfixUnaryExpression } from "./nodeTests.ts";
import { isConditionalExpression as checked_isConditionalExpression } from "./nodeTests.ts";
import { isTemplateExpression as checked_isTemplateExpression } from "./nodeTests.ts";
import { isTemplateHead as checked_isTemplateHead } from "./nodeTests.ts";
import { isTemplateMiddle as checked_isTemplateMiddle } from "./nodeTests.ts";
import { isTemplateTail as checked_isTemplateTail } from "./nodeTests.ts";
import { isYieldExpression as checked_isYieldExpression } from "./nodeTests.ts";
import { isSpreadElement as checked_isSpreadElement } from "./nodeTests.ts";
import { isExpressionWithTypeArguments as checked_isExpressionWithTypeArguments } from "./nodeTests.ts";
import { isAsExpression as checked_isAsExpression } from "./nodeTests.ts";
import { isNonNullExpression as checked_isNonNullExpression } from "./nodeTests.ts";
import { isSatisfiesExpression as checked_isSatisfiesExpression } from "./nodeTests.ts";
import { isMetaProperty as checked_isMetaProperty } from "./nodeTests.ts";
import { isTemplateSpan as checked_isTemplateSpan } from "./nodeTests.ts";
import { isSemicolonClassElement as checked_isSemicolonClassElement } from "./nodeTests.ts";
import { isBlock as checked_isBlock } from "./nodeTests.ts";
import { isEmptyStatement as checked_isEmptyStatement } from "./nodeTests.ts";
import { isExpressionStatement as checked_isExpressionStatement } from "./nodeTests.ts";
import { isIfStatement as checked_isIfStatement } from "./nodeTests.ts";
import { isDoStatement as checked_isDoStatement } from "./nodeTests.ts";
import { isWhileStatement as checked_isWhileStatement } from "./nodeTests.ts";
import { isForStatement as checked_isForStatement } from "./nodeTests.ts";
import { isForInStatement as checked_isForInStatement } from "./nodeTests.ts";
import { isForOfStatement as checked_isForOfStatement } from "./nodeTests.ts";
import { isContinueStatement as checked_isContinueStatement } from "./nodeTests.ts";
import { isBreakStatement as checked_isBreakStatement } from "./nodeTests.ts";
import { isReturnStatement as checked_isReturnStatement } from "./nodeTests.ts";
import { isWithStatement as checked_isWithStatement } from "./nodeTests.ts";
import { isSwitchStatement as checked_isSwitchStatement } from "./nodeTests.ts";
import { isThrowStatement as checked_isThrowStatement } from "./nodeTests.ts";
import { isTryStatement as checked_isTryStatement } from "./nodeTests.ts";
import { isDebuggerStatement as checked_isDebuggerStatement } from "./nodeTests.ts";
import { isVariableDeclarationList as checked_isVariableDeclarationList } from "./nodeTests.ts";
import { isModuleBlock as checked_isModuleBlock } from "./nodeTests.ts";
import { isCaseBlock as checked_isCaseBlock } from "./nodeTests.ts";
import { isNamespaceExportDeclaration as checked_isNamespaceExportDeclaration } from "./nodeTests.ts";
import { isImportClause as checked_isImportClause } from "./nodeTests.ts";
import { isAssertClause as checked_isAssertClause } from "./nodeTests.ts";
import { isAssertEntry as checked_isAssertEntry } from "./nodeTests.ts";
import { isImportTypeAssertionContainer as checked_isImportTypeAssertionContainer } from "./nodeTests.ts";
import { isImportAttributes as checked_isImportAttributes } from "./nodeTests.ts";
import { isImportAttribute as checked_isImportAttribute } from "./nodeTests.ts";
import { isNamespaceImport as checked_isNamespaceImport } from "./nodeTests.ts";
import { isNamespaceExport as checked_isNamespaceExport } from "./nodeTests.ts";
import { isNamedImports as checked_isNamedImports } from "./nodeTests.ts";
import { isImportSpecifier as checked_isImportSpecifier } from "./nodeTests.ts";
import { isNamedExports as checked_isNamedExports } from "./nodeTests.ts";
import { isExportSpecifier as checked_isExportSpecifier } from "./nodeTests.ts";
import { isMissingDeclaration as checked_isMissingDeclaration } from "./nodeTests.ts";
import { isJSDocFunctionType as checked_isJSDocFunctionType } from "./nodeTests.ts";
import { isJSDocTypeLiteral as checked_isJSDocTypeLiteral } from "./nodeTests.ts";
import { isJSDocTypeExpression as checked_isJSDocTypeExpression } from "./nodeTests.ts";
import { isJSDocSignature as checked_isJSDocSignature } from "./nodeTests.ts";
import { isJSDocNameReference as checked_isJSDocNameReference } from "./nodeTests.ts";
import { isJSDocMemberName as checked_isJSDocMemberName } from "./nodeTests.ts";
import { isJSDocLink as checked_isJSDocLink } from "./nodeTests.ts";
import { isJSDocLinkCode as checked_isJSDocLinkCode } from "./nodeTests.ts";
import { isJSDocLinkPlain as checked_isJSDocLinkPlain } from "./nodeTests.ts";
import { isJSDoc as checked_isJSDoc } from "./nodeTests.ts";
import { isJsxElement as checked_isJsxElement } from "./nodeTests.ts";
import { isJsxSelfClosingElement as checked_isJsxSelfClosingElement } from "./nodeTests.ts";
import { isJsxOpeningElement as checked_isJsxOpeningElement } from "./nodeTests.ts";
import { isJsxClosingElement as checked_isJsxClosingElement } from "./nodeTests.ts";
import { isJsxFragment as checked_isJsxFragment } from "./nodeTests.ts";
import { isJsxText as checked_isJsxText } from "./nodeTests.ts";
import { isJsxOpeningFragment as checked_isJsxOpeningFragment } from "./nodeTests.ts";
import { isJsxClosingFragment as checked_isJsxClosingFragment } from "./nodeTests.ts";
import { isJsxAttribute as checked_isJsxAttribute } from "./nodeTests.ts";
import { isJsxAttributes as checked_isJsxAttributes } from "./nodeTests.ts";
import { isJsxSpreadAttribute as checked_isJsxSpreadAttribute } from "./nodeTests.ts";
import { isJsxExpression as checked_isJsxExpression } from "./nodeTests.ts";
import { isJsxNamespacedName as checked_isJsxNamespacedName } from "./nodeTests.ts";
import { isCaseClause as checked_isCaseClause } from "./nodeTests.ts";
import { isDefaultClause as checked_isDefaultClause } from "./nodeTests.ts";
import { isHeritageClause as checked_isHeritageClause } from "./nodeTests.ts";
import { isCatchClause as checked_isCatchClause } from "./nodeTests.ts";
import { isPropertyAssignment as checked_isPropertyAssignment } from "./nodeTests.ts";
import { isShorthandPropertyAssignment as checked_isShorthandPropertyAssignment } from "./nodeTests.ts";
import { isSpreadAssignment as checked_isSpreadAssignment } from "./nodeTests.ts";
import { isEnumMember as checked_isEnumMember } from "./nodeTests.ts";
import { isBundle as checked_isBundle } from "./nodeTests.ts";
import { isSyntheticExpression as checked_isSyntheticExpression } from "./nodeTests.ts";
import { isSyntaxList as checked_isSyntaxList } from "./nodeTests.ts";
import { isPartiallyEmittedExpression as checked_isPartiallyEmittedExpression } from "./nodeTests.ts";
import { type __String, type AccessorDeclaration, addRange, append, appendIfUnique, type ArrayBindingElement, type ArrayBindingPattern, type ArrayLiteralExpression, type ArrayTypeNode, type ArrowFunction, type AsExpression, type AssertClause, type AssertEntry, type AssertionKey, type AssertsKeyword, type AssignmentPattern, type AsteriskToken, type AwaitExpression, type AwaitKeyword, type BaseNodeFactory, type BigIntLiteral, type BinaryExpression, type BinaryOperator, type BinaryOperatorToken, type BindingElement, type BindingName, type BindingPattern, type Block, type BooleanLiteral, type BreakStatement, type Bundle, type CallBinding, type CallChain, type CallExpression, type CallSignatureDeclaration, type CaseBlock, type CaseClause, type CaseOrDefaultClause, cast, type CatchClause, CharacterCodes, type ClassDeclaration, type ClassElement, type ClassExpression, type ClassStaticBlockDeclaration, type ColonToken, type CommaListExpression, type ComputedPropertyName, type ConciseBody, type ConditionalExpression, type ConditionalTypeNode, type ConstructorDeclaration, type ConstructorTypeNode, type ConstructSignatureDeclaration, containsObjectRestOrSpread, type ContinueStatement, createBaseNodeFactory, createNodeConverters, createParenthesizerRules, createScanner, Debug, type DebuggerStatement, type Declaration, type DeclarationName, type Decorator, type DefaultClause, type DeleteExpression, type DoStatement, type DotDotDotToken, type ElementAccessChain, type ElementAccessExpression, EmitFlags, type EmitNode, emptyArray, type EmptyStatement, type EndOfFileToken, type EntityName, type EnumDeclaration, type EnumMember, type EqualsGreaterThanToken, escapeLeadingUnderscores, every, type ExclamationToken, type ExportAssignment, type ExportDeclaration, type ExportSpecifier, type Expression, type ExpressionStatement, type ExpressionWithTypeArguments, type ExternalModuleReference, type FalseLiteral, type FileReference, findUseStrictPrologue, forEach, type ForInitializer, type ForInStatement, formatGeneratedName, type ForOfStatement, type ForStatement, type FunctionDeclaration, type FunctionExpression, type FunctionTypeNode, type GeneratedIdentifier, GeneratedIdentifierFlags, type GeneratedNamePart, type GeneratedPrivateIdentifier, type GetAccessorDeclaration, getCommentRange, getEmitFlags, getIdentifierTypeArguments, getJSDocTypeAliasName, getNameOfDeclaration, getNodeId, getNonAssignedNameOfDeclaration, getSourceMapRange, getSyntheticLeadingComments, getSyntheticTrailingComments, getTextOfIdentifierOrLiteral, type HasDecorators, hasInvalidEscape, type HasModifiers, hasProperty, hasSyntacticModifier, type HeritageClause, type Identifier, identity, idText, type IfStatement, type ImmediatelyInvokedArrowFunction, type ImmediatelyInvokedFunctionExpression, type ImportAttribute, type ImportAttributeName, type ImportAttributes, type ImportClause, type ImportDeclaration, type ImportEqualsDeclaration, type ImportPhaseModifierSyntaxKind, type ImportSpecifier, type ImportTypeAssertionContainer, type ImportTypeNode, type IndexedAccessTypeNode, type IndexSignatureDeclaration, type InferTypeNode, type InterfaceDeclaration, InternalEmitFlags, type IntersectionTypeNode, isArray, isArrayLiteralExpression, isArrowFunction, isBinaryExpression, isCallChain, isClassDeclaration, isClassExpression, isCommaListExpression, isCommaToken, isComputedPropertyName, isConstructorDeclaration, isConstructorTypeNode, isCustomPrologue, isElementAccessChain, isElementAccessExpression, isEnumDeclaration, isExclamationToken, isExportAssignment, isExportDeclaration, isExternalModuleReference, isFunctionDeclaration, isFunctionExpression, isGeneratedIdentifier, isGeneratedPrivateIdentifier, isGetAccessorDeclaration, isHoistedFunction, isHoistedVariableStatement, isIdentifier, isImportDeclaration, isImportEqualsDeclaration, isImportKeyword, isIndexSignatureDeclaration, isInterfaceDeclaration, isLabeledStatement, isLocalName, isLogicalOrCoalescingAssignmentOperator, isMemberName, isMethodDeclaration, isMethodSignature, isModuleDeclaration, isNamedDeclaration, isNodeArray, isNodeKind, isNonNullChain, isNotEmittedStatement, isObjectLiteralExpression, isOmittedExpression, isOuterExpression, isParameter, isParenthesizedExpression, isParseTreeNode, isPrivateIdentifier, isPrologueDirective, isPropertyAccessChain, isPropertyAccessExpression, isPropertyDeclaration, isPropertyName, isPropertySignature, isQuestionToken, isSetAccessorDeclaration, isSourceFile, isStatement, isStatementOrBlock, isStringLiteral, isSuperKeyword, isSuperProperty, isThisIdentifier, isTypeAliasDeclaration, isTypeParameterDeclaration, isVariableDeclaration, isVariableStatement, type JSDoc, type JSDocAllType, type JSDocAugmentsTag, type JSDocAuthorTag, type JSDocCallbackTag, type JSDocClassTag, type JSDocComment, type JSDocDeprecatedTag, type JSDocEnumTag, type JSDocFunctionType, type JSDocImplementsTag, type JSDocImportTag, type JSDocLink, type JSDocLinkCode, type JSDocLinkPlain, type JSDocMemberName, type JSDocNamepathType, type JSDocNameReference, type JSDocNamespaceDeclaration, type JSDocNonNullableType, type JSDocNullableType, type JSDocOptionalType, type JSDocOverloadTag, type JSDocOverrideTag, type JSDocParameterTag, type JSDocPrivateTag, type JSDocPropertyLikeTag, type JSDocPropertyTag, type JSDocProtectedTag, type JSDocPublicTag, type JSDocReadonlyTag, type JSDocReturnTag, type JSDocSatisfiesTag, type JSDocSeeTag, type JSDocSignature, type JSDocTag, type JSDocTemplateTag, type JSDocText, type JSDocThisTag, type JSDocThrowsTag, type JSDocType, type JSDocTypedefTag, type JSDocTypeExpression, type JSDocTypeLiteral, type JSDocTypeTag, type JSDocUnknownTag, type JSDocUnknownType, type JSDocVariadicType, type JsxAttribute, type JsxAttributeLike, type JsxAttributeName, type JsxAttributes, type JsxAttributeValue, type JsxChild, type JsxClosingElement, type JsxClosingFragment, type JsxElement, type JsxExpression, type JsxFragment, type JsxNamespacedName, type JsxOpeningElement, type JsxOpeningFragment, type JsxSelfClosingElement, type JsxSpreadAttribute, type JsxTagNameExpression, type JsxText, type KeywordSyntaxKind, type KeywordToken, type KeywordTypeNode, type KeywordTypeSyntaxKind, type LabeledStatement, LanguageVariant, lastOrUndefined, type LeftHandSideExpression, type LiteralToken, type LiteralTypeNode, type MappedTypeNode, type MemberName, memoize, memoizeOne, type MetaProperty, type MethodDeclaration, type MethodSignature, type MinusToken, type MissingDeclaration, type Modifier, ModifierFlags, type ModifierLike, modifiersToFlags, type ModifierSyntaxKind, type ModifierToken, type ModuleBlock, type ModuleBody, type ModuleDeclaration, type ModuleExportName, type ModuleName, type ModuleReference, type Mutable, type MutableNodeArray, type NamedExportBindings, type NamedExports, type NamedImportBindings, type NamedImports, type NamedTupleMember, type NamespaceExport, type NamespaceExportDeclaration, type NamespaceImport, type NewExpression, type Node, type NodeArray, type NodeFactory, NodeFlags, nodeIsSynthesized, type NonNullChain, type NonNullExpression, type NoSubstitutionTemplateLiteral, type NotEmittedStatement, type NotEmittedTypeElement, type NullLiteral, nullNodeConverters, nullParenthesizerRules, type NumericLiteral, objectAllocator, type ObjectBindingPattern, type ObjectLiteralElementLike, type ObjectLiteralExpression, type OmittedExpression, type OptionalTypeNode, type OuterExpression, OuterExpressionKinds, type ParameterDeclaration, type ParenthesizedExpression, type ParenthesizedTypeNode, type PartiallyEmittedExpression, type Path, type PlusToken, type PostfixUnaryExpression, type PostfixUnaryOperator, type PrefixUnaryExpression, type PrefixUnaryOperator, type PrimaryExpression, type PrivateIdentifier, type PrologueDirective, type PropertyAccessChain, type PropertyAccessExpression, type PropertyAssignment, type PropertyDeclaration, type PropertyDescriptorAttributes, type PropertyName, type PropertyNameLiteral, type PropertySignature, type PseudoBigInt, pseudoBigIntToString, type PunctuationSyntaxKind, type PunctuationToken, type QualifiedName, type QuestionDotToken, type QuestionToken, type ReadonlyKeyword, type RedirectInfo, reduceLeft, type RegularExpressionLiteral, type RestTypeNode, type ReturnStatement, returnTrue, sameFlatMap, type SatisfiesExpression, type Scanner, ScriptTarget, type SemicolonClassElement, type SetAccessorDeclaration, setEmitFlags, setIdentifierAutoGenerate, setIdentifierTypeArguments, setParent, setTextRange, type ShorthandPropertyAssignment, type SignatureDeclarationBase, singleOrUndefined, skipOuterExpressions, skipParentheses, some, type SourceFile, type SourceMapSource, type SpreadAssignment, type SpreadElement, startOnNewLine, startsWith, type Statement, type StringLiteral, stringToToken, type SuperExpression, type SwitchStatement, SyntaxKind, type SyntaxList, type SyntheticExpression, type SyntheticReferenceExpression, type TaggedTemplateExpression, type TemplateExpression, type TemplateHead, type TemplateLiteral, type TemplateLiteralLikeNode, type TemplateLiteralToken, type TemplateLiteralTypeNode, type TemplateLiteralTypeSpan, type TemplateMiddle, type TemplateSpan, type TemplateTail, type TextRange, type ThisExpression, type ThisTypeNode, type ThrowStatement, type Token, TokenFlags, TransformFlags, type TrueLiteral, type TryStatement, type TupleTypeNode, type Type, type TypeAliasDeclaration, type TypeAssertion, type TypeElement, type TypeLiteralNode, type TypeNode, type TypeOfExpression, type TypeOfTag, type TypeOperatorNode, type TypeParameterDeclaration, type TypePredicateNode, type TypeQueryNode, type TypeReferenceNode, type UnionOrIntersectionTypeNode, type UnionTypeNode, type VariableDeclaration, type VariableDeclarationList, type VariableStatement, visitNode, type VisitResult, type VoidExpression, type WhileStatement, type WithStatement, type YieldExpression } from "../_namespaces/ts.ts";
let nextAutoGenerateId = 0;
/** @internal */
export type NodeFactoryFlags = number;
/** @internal */
export const NodeFactoryFlags: {
    readonly None: 0;
    readonly NoParenthesizerRules: 1;
    readonly NoNodeConverters: 2;
    readonly NoIndentationOnFreshPropertyAccess: 4;
    readonly NoOriginalNode: 8;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NoParenthesizerRules: 1,
    "1": "NoParenthesizerRules",
    NoNodeConverters: 2,
    "2": "NoNodeConverters",
    NoIndentationOnFreshPropertyAccess: 4,
    "4": "NoIndentationOnFreshPropertyAccess",
    NoOriginalNode: 8,
    "8": "NoOriginalNode"
};
const nodeFactoryPatchers: ((factory: NodeFactory) => void)[] = [];
/** @internal @knipignore */
export function addNodeFactoryPatcher(fn: (factory: NodeFactory) => void): void {
    nodeFactoryPatchers.push(fn);
}
/**
 * Creates a `NodeFactory` that can be used to create and update a syntax tree.
 * @param flags Flags that control factory behavior.
 * @param baseFactory A `BaseNodeFactory` used to create the base `Node` objects.
 *
 * @internal
 */
export function createNodeFactory(flags: NodeFactoryFlags, baseFactory: BaseNodeFactory): NodeFactory {
    const setOriginal = flags & NodeFactoryFlags.NoOriginalNode ? identity : setOriginalNode;
    // Lazily load the parenthesizer, node converters, and some factory methods until they are used.
    const parenthesizerRules = memoize(() => flags & NodeFactoryFlags.NoParenthesizerRules ? nullParenthesizerRules : createParenthesizerRules(factory));
    const converters = memoize(() => flags & NodeFactoryFlags.NoNodeConverters ? nullNodeConverters : createNodeConverters(factory));
    // lazy initializaton of common operator factories
    type BinaryCreateCallbackResult<K extends BinaryOperator> = K extends typeof SyntaxKind.EqualsToken ? NodeFactory["createAssignment"] : (left: Expression, right: Expression) => BinaryExpression;
    function binaryCreateCallback<K extends BinaryOperator>(operator: K): BinaryCreateCallbackResult<K>;
    function binaryCreateCallback(operator: BinaryOperator) {
        return (left: Expression, right: Expression) => createBinaryExpression(left, operator, right);
    }
    const getBinaryCreateFunction = memoizeOne(binaryCreateCallback);
    const getPrefixUnaryCreateFunction = memoizeOne((operator: PrefixUnaryOperator) => (operand: Expression) => createPrefixUnaryExpression(operator, operand));
    const getPostfixUnaryCreateFunction = memoizeOne((operator: PostfixUnaryOperator) => (operand: Expression) => createPostfixUnaryExpression(operand, operator));
    const getJSDocPrimaryTypeCreateFunction = memoizeOne(<K extends JSDocPrimaryKind>(kind: K) => () => createJSDocPrimaryTypeWorker(kind));
    const getJSDocUnaryTypeCreateFunction = memoizeOne(<K extends JSDocUnaryKind>(kind: K) => (type: FactoryNodeLayouts[K]["type"]) => createJSDocUnaryTypeWorker<K>(kind, type));
    const getJSDocUnaryTypeUpdateFunction = memoizeOne(<K extends JSDocUnaryKind>(kind: K) => (node: FactoryNodeLayouts[K], type: FactoryNodeLayouts[K]["type"]) => updateJSDocUnaryTypeWorker<K>(kind, node, type));
    const getJSDocPrePostfixUnaryTypeCreateFunction = memoizeOne(<K extends JSDocPrePostfixKind>(kind: K) => (type: FactoryNodeLayouts[K]["type"], postfix?: boolean) => createJSDocPrePostfixUnaryTypeWorker<K>(kind, type, postfix));
    const getJSDocPrePostfixUnaryTypeUpdateFunction = memoizeOne(<K extends JSDocPrePostfixKind>(kind: K) => (node: FactoryNodeLayouts[K], type: FactoryNodeLayouts[K]["type"]) => updateJSDocPrePostfixUnaryTypeWorker<K>(kind, node, type));
    const getJSDocSimpleTagCreateFunction = memoizeOne(<K extends JSDocSimpleTagKind>(kind: K) => (tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>) => createJSDocSimpleTagWorker(kind, tagName, comment));
    const getJSDocSimpleTagUpdateFunction = memoizeOne(<K extends JSDocSimpleTagKind>(kind: K) => (node: FactoryNodeLayouts[K], tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>) => updateJSDocSimpleTagWorker(kind, node, tagName, comment));
    const getJSDocTypeLikeTagCreateFunction = memoizeOne(<K extends JSDocTypeLikeTagKind>(kind: K) => (tagName: Identifier | undefined, typeExpression?: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>) => createJSDocTypeLikeTagWorker(kind, tagName, typeExpression, comment));
    const getJSDocTypeLikeTagUpdateFunction = memoizeOne(<K extends JSDocTypeLikeTagKind>(kind: K) => (node: FactoryNodeLayouts[K], tagName: Identifier | undefined, typeExpression?: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>) => updateJSDocTypeLikeTagWorker(kind, node, tagName, typeExpression, comment));
    const factory: NodeFactory = {
        get parenthesizer() {
            return parenthesizerRules();
        },
        get converters() {
            return converters();
        },
        baseFactory,
        flags,
        createNodeArray,
        createNumericLiteral,
        createBigIntLiteral,
        createStringLiteral,
        createStringLiteralFromNode,
        createRegularExpressionLiteral,
        createLiteralLikeNode,
        createIdentifier,
        createTempVariable,
        createLoopVariable,
        createUniqueName,
        getGeneratedNameForNode,
        createPrivateIdentifier,
        createUniquePrivateName,
        getGeneratedPrivateNameForNode,
        createToken,
        createSuper,
        createThis,
        createNull,
        createTrue,
        createFalse,
        createModifier,
        createModifiersFromModifierFlags,
        createQualifiedName,
        updateQualifiedName,
        createComputedPropertyName,
        updateComputedPropertyName,
        createTypeParameterDeclaration,
        updateTypeParameterDeclaration,
        createParameterDeclaration,
        updateParameterDeclaration,
        createDecorator,
        updateDecorator,
        createPropertySignature,
        updatePropertySignature,
        createPropertyDeclaration,
        updatePropertyDeclaration,
        createMethodSignature,
        updateMethodSignature,
        createMethodDeclaration,
        updateMethodDeclaration,
        createConstructorDeclaration,
        updateConstructorDeclaration,
        createGetAccessorDeclaration,
        updateGetAccessorDeclaration,
        createSetAccessorDeclaration,
        updateSetAccessorDeclaration,
        createCallSignature,
        updateCallSignature,
        createConstructSignature,
        updateConstructSignature,
        createIndexSignature,
        updateIndexSignature,
        createClassStaticBlockDeclaration,
        updateClassStaticBlockDeclaration,
        createTemplateLiteralTypeSpan,
        updateTemplateLiteralTypeSpan,
        createKeywordTypeNode,
        createTypePredicateNode,
        updateTypePredicateNode,
        createTypeReferenceNode,
        updateTypeReferenceNode,
        createFunctionTypeNode,
        updateFunctionTypeNode,
        createConstructorTypeNode,
        updateConstructorTypeNode,
        createTypeQueryNode,
        updateTypeQueryNode,
        createTypeLiteralNode,
        updateTypeLiteralNode,
        createArrayTypeNode,
        updateArrayTypeNode,
        createTupleTypeNode,
        updateTupleTypeNode,
        createNamedTupleMember,
        updateNamedTupleMember,
        createOptionalTypeNode,
        updateOptionalTypeNode,
        createRestTypeNode,
        updateRestTypeNode,
        createUnionTypeNode,
        updateUnionTypeNode,
        createIntersectionTypeNode,
        updateIntersectionTypeNode,
        createConditionalTypeNode,
        updateConditionalTypeNode,
        createInferTypeNode,
        updateInferTypeNode,
        createImportTypeNode,
        updateImportTypeNode,
        createParenthesizedType,
        updateParenthesizedType,
        createThisTypeNode,
        createTypeOperatorNode,
        updateTypeOperatorNode,
        createIndexedAccessTypeNode,
        updateIndexedAccessTypeNode,
        createMappedTypeNode,
        updateMappedTypeNode,
        createLiteralTypeNode,
        updateLiteralTypeNode,
        createTemplateLiteralType,
        updateTemplateLiteralType,
        createObjectBindingPattern,
        updateObjectBindingPattern,
        createArrayBindingPattern,
        updateArrayBindingPattern,
        createBindingElement,
        updateBindingElement,
        createArrayLiteralExpression,
        updateArrayLiteralExpression,
        createObjectLiteralExpression,
        updateObjectLiteralExpression,
        createPropertyAccessExpression: flags & NodeFactoryFlags.NoIndentationOnFreshPropertyAccess ?
            (expression, name) => setEmitFlags(createPropertyAccessExpression(expression, name), EmitFlags.NoIndentation) :
            createPropertyAccessExpression,
        updatePropertyAccessExpression,
        createPropertyAccessChain: flags & NodeFactoryFlags.NoIndentationOnFreshPropertyAccess ?
            (expression, questionDotToken, name: string) => setEmitFlags(createPropertyAccessChain(expression, questionDotToken, name), EmitFlags.NoIndentation) :
            createPropertyAccessChain,
        updatePropertyAccessChain,
        createElementAccessExpression,
        updateElementAccessExpression,
        createElementAccessChain,
        updateElementAccessChain,
        createCallExpression,
        updateCallExpression,
        createCallChain,
        updateCallChain,
        createNewExpression,
        updateNewExpression,
        createTaggedTemplateExpression,
        updateTaggedTemplateExpression,
        createTypeAssertion,
        updateTypeAssertion,
        createParenthesizedExpression,
        updateParenthesizedExpression,
        createFunctionExpression,
        updateFunctionExpression,
        createArrowFunction,
        updateArrowFunction,
        createDeleteExpression,
        updateDeleteExpression,
        createTypeOfExpression,
        updateTypeOfExpression,
        createVoidExpression,
        updateVoidExpression,
        createAwaitExpression,
        updateAwaitExpression,
        createPrefixUnaryExpression,
        updatePrefixUnaryExpression,
        createPostfixUnaryExpression,
        updatePostfixUnaryExpression,
        createBinaryExpression,
        updateBinaryExpression,
        createConditionalExpression,
        updateConditionalExpression,
        createTemplateExpression,
        updateTemplateExpression,
        createTemplateHead,
        createTemplateMiddle,
        createTemplateTail,
        createNoSubstitutionTemplateLiteral,
        createTemplateLiteralLikeNode,
        createYieldExpression,
        updateYieldExpression,
        createSpreadElement,
        updateSpreadElement,
        createClassExpression,
        updateClassExpression,
        createOmittedExpression,
        createExpressionWithTypeArguments,
        updateExpressionWithTypeArguments,
        createAsExpression,
        updateAsExpression,
        createNonNullExpression,
        updateNonNullExpression,
        createSatisfiesExpression,
        updateSatisfiesExpression,
        createNonNullChain,
        updateNonNullChain,
        createMetaProperty,
        updateMetaProperty,
        createTemplateSpan,
        updateTemplateSpan,
        createSemicolonClassElement,
        createBlock,
        updateBlock,
        createVariableStatement,
        updateVariableStatement,
        createEmptyStatement,
        createExpressionStatement,
        updateExpressionStatement,
        createIfStatement,
        updateIfStatement,
        createDoStatement,
        updateDoStatement,
        createWhileStatement,
        updateWhileStatement,
        createForStatement,
        updateForStatement,
        createForInStatement,
        updateForInStatement,
        createForOfStatement,
        updateForOfStatement,
        createContinueStatement,
        updateContinueStatement,
        createBreakStatement,
        updateBreakStatement,
        createReturnStatement,
        updateReturnStatement,
        createWithStatement,
        updateWithStatement,
        createSwitchStatement,
        updateSwitchStatement,
        createLabeledStatement,
        updateLabeledStatement,
        createThrowStatement,
        updateThrowStatement,
        createTryStatement,
        updateTryStatement,
        createDebuggerStatement,
        createVariableDeclaration,
        updateVariableDeclaration,
        createVariableDeclarationList,
        updateVariableDeclarationList,
        createFunctionDeclaration,
        updateFunctionDeclaration,
        createClassDeclaration,
        updateClassDeclaration,
        createInterfaceDeclaration,
        updateInterfaceDeclaration,
        createTypeAliasDeclaration,
        updateTypeAliasDeclaration,
        createEnumDeclaration,
        updateEnumDeclaration,
        createModuleDeclaration,
        updateModuleDeclaration,
        createModuleBlock,
        updateModuleBlock,
        createCaseBlock,
        updateCaseBlock,
        createNamespaceExportDeclaration,
        updateNamespaceExportDeclaration,
        createImportEqualsDeclaration,
        updateImportEqualsDeclaration,
        createImportDeclaration,
        updateImportDeclaration,
        createImportClause,
        updateImportClause,
        createAssertClause,
        updateAssertClause,
        createAssertEntry,
        updateAssertEntry,
        createImportTypeAssertionContainer,
        updateImportTypeAssertionContainer,
        createImportAttributes,
        updateImportAttributes,
        createImportAttribute,
        updateImportAttribute,
        createNamespaceImport,
        updateNamespaceImport,
        createNamespaceExport,
        updateNamespaceExport,
        createNamedImports,
        updateNamedImports,
        createImportSpecifier,
        updateImportSpecifier,
        createExportAssignment,
        updateExportAssignment,
        createExportDeclaration,
        updateExportDeclaration,
        createNamedExports,
        updateNamedExports,
        createExportSpecifier,
        updateExportSpecifier,
        createMissingDeclaration,
        createExternalModuleReference,
        updateExternalModuleReference,
        // lazily load factory members for JSDoc types with similar structure
        get createJSDocAllType() {
            return getJSDocPrimaryTypeCreateFunction<typeof SyntaxKind.JSDocAllType>(SyntaxKind.JSDocAllType);
        },
        get createJSDocUnknownType() {
            return getJSDocPrimaryTypeCreateFunction<typeof SyntaxKind.JSDocUnknownType>(SyntaxKind.JSDocUnknownType);
        },
        get createJSDocNonNullableType() {
            return getJSDocPrePostfixUnaryTypeCreateFunction<typeof SyntaxKind.JSDocNonNullableType>(SyntaxKind.JSDocNonNullableType);
        },
        get updateJSDocNonNullableType() {
            return getJSDocPrePostfixUnaryTypeUpdateFunction<typeof SyntaxKind.JSDocNonNullableType>(SyntaxKind.JSDocNonNullableType);
        },
        get createJSDocNullableType() {
            return getJSDocPrePostfixUnaryTypeCreateFunction<typeof SyntaxKind.JSDocNullableType>(SyntaxKind.JSDocNullableType);
        },
        get updateJSDocNullableType() {
            return getJSDocPrePostfixUnaryTypeUpdateFunction<typeof SyntaxKind.JSDocNullableType>(SyntaxKind.JSDocNullableType);
        },
        get createJSDocOptionalType() {
            return getJSDocUnaryTypeCreateFunction<typeof SyntaxKind.JSDocOptionalType>(SyntaxKind.JSDocOptionalType);
        },
        get updateJSDocOptionalType() {
            return getJSDocUnaryTypeUpdateFunction<typeof SyntaxKind.JSDocOptionalType>(SyntaxKind.JSDocOptionalType);
        },
        get createJSDocVariadicType() {
            return getJSDocUnaryTypeCreateFunction<typeof SyntaxKind.JSDocVariadicType>(SyntaxKind.JSDocVariadicType);
        },
        get updateJSDocVariadicType() {
            return getJSDocUnaryTypeUpdateFunction<typeof SyntaxKind.JSDocVariadicType>(SyntaxKind.JSDocVariadicType);
        },
        get createJSDocNamepathType() {
            return getJSDocUnaryTypeCreateFunction<typeof SyntaxKind.JSDocNamepathType>(SyntaxKind.JSDocNamepathType);
        },
        get updateJSDocNamepathType() {
            return getJSDocUnaryTypeUpdateFunction<typeof SyntaxKind.JSDocNamepathType>(SyntaxKind.JSDocNamepathType);
        },
        createJSDocFunctionType,
        updateJSDocFunctionType,
        createJSDocTypeLiteral,
        updateJSDocTypeLiteral,
        createJSDocTypeExpression,
        updateJSDocTypeExpression,
        createJSDocSignature,
        updateJSDocSignature,
        createJSDocTemplateTag,
        updateJSDocTemplateTag,
        createJSDocTypedefTag,
        updateJSDocTypedefTag,
        createJSDocParameterTag,
        updateJSDocParameterTag,
        createJSDocPropertyTag,
        updateJSDocPropertyTag,
        createJSDocCallbackTag,
        updateJSDocCallbackTag,
        createJSDocOverloadTag,
        updateJSDocOverloadTag,
        createJSDocAugmentsTag,
        updateJSDocAugmentsTag,
        createJSDocImplementsTag,
        updateJSDocImplementsTag,
        createJSDocSeeTag,
        updateJSDocSeeTag,
        createJSDocImportTag,
        updateJSDocImportTag,
        createJSDocNameReference,
        updateJSDocNameReference,
        createJSDocMemberName,
        updateJSDocMemberName,
        createJSDocLink,
        updateJSDocLink,
        createJSDocLinkCode,
        updateJSDocLinkCode,
        createJSDocLinkPlain,
        updateJSDocLinkPlain,
        // lazily load factory members for JSDoc tags with similar structure
        get createJSDocTypeTag() {
            return getJSDocTypeLikeTagCreateFunction<typeof SyntaxKind.JSDocTypeTag>(SyntaxKind.JSDocTypeTag);
        },
        get updateJSDocTypeTag() {
            return getJSDocTypeLikeTagUpdateFunction<typeof SyntaxKind.JSDocTypeTag>(SyntaxKind.JSDocTypeTag);
        },
        get createJSDocReturnTag() {
            return getJSDocTypeLikeTagCreateFunction<typeof SyntaxKind.JSDocReturnTag>(SyntaxKind.JSDocReturnTag);
        },
        get updateJSDocReturnTag() {
            return getJSDocTypeLikeTagUpdateFunction<typeof SyntaxKind.JSDocReturnTag>(SyntaxKind.JSDocReturnTag);
        },
        get createJSDocThisTag() {
            return getJSDocTypeLikeTagCreateFunction<typeof SyntaxKind.JSDocThisTag>(SyntaxKind.JSDocThisTag);
        },
        get updateJSDocThisTag() {
            return getJSDocTypeLikeTagUpdateFunction<typeof SyntaxKind.JSDocThisTag>(SyntaxKind.JSDocThisTag);
        },
        get createJSDocAuthorTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocAuthorTag>(SyntaxKind.JSDocAuthorTag);
        },
        get updateJSDocAuthorTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocAuthorTag>(SyntaxKind.JSDocAuthorTag);
        },
        get createJSDocClassTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocClassTag>(SyntaxKind.JSDocClassTag);
        },
        get updateJSDocClassTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocClassTag>(SyntaxKind.JSDocClassTag);
        },
        get createJSDocPublicTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocPublicTag>(SyntaxKind.JSDocPublicTag);
        },
        get updateJSDocPublicTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocPublicTag>(SyntaxKind.JSDocPublicTag);
        },
        get createJSDocPrivateTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocPrivateTag>(SyntaxKind.JSDocPrivateTag);
        },
        get updateJSDocPrivateTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocPrivateTag>(SyntaxKind.JSDocPrivateTag);
        },
        get createJSDocProtectedTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocProtectedTag>(SyntaxKind.JSDocProtectedTag);
        },
        get updateJSDocProtectedTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocProtectedTag>(SyntaxKind.JSDocProtectedTag);
        },
        get createJSDocReadonlyTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocReadonlyTag>(SyntaxKind.JSDocReadonlyTag);
        },
        get updateJSDocReadonlyTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocReadonlyTag>(SyntaxKind.JSDocReadonlyTag);
        },
        get createJSDocOverrideTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocOverrideTag>(SyntaxKind.JSDocOverrideTag);
        },
        get updateJSDocOverrideTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocOverrideTag>(SyntaxKind.JSDocOverrideTag);
        },
        get createJSDocDeprecatedTag() {
            return getJSDocSimpleTagCreateFunction<typeof SyntaxKind.JSDocDeprecatedTag>(SyntaxKind.JSDocDeprecatedTag);
        },
        get updateJSDocDeprecatedTag() {
            return getJSDocSimpleTagUpdateFunction<typeof SyntaxKind.JSDocDeprecatedTag>(SyntaxKind.JSDocDeprecatedTag);
        },
        get createJSDocThrowsTag() {
            return getJSDocTypeLikeTagCreateFunction<typeof SyntaxKind.JSDocThrowsTag>(SyntaxKind.JSDocThrowsTag);
        },
        get updateJSDocThrowsTag() {
            return getJSDocTypeLikeTagUpdateFunction<typeof SyntaxKind.JSDocThrowsTag>(SyntaxKind.JSDocThrowsTag);
        },
        get createJSDocSatisfiesTag() {
            return getJSDocTypeLikeTagCreateFunction<typeof SyntaxKind.JSDocSatisfiesTag>(SyntaxKind.JSDocSatisfiesTag);
        },
        get updateJSDocSatisfiesTag() {
            return getJSDocTypeLikeTagUpdateFunction<typeof SyntaxKind.JSDocSatisfiesTag>(SyntaxKind.JSDocSatisfiesTag);
        },
        createJSDocEnumTag,
        updateJSDocEnumTag,
        createJSDocUnknownTag,
        updateJSDocUnknownTag,
        createJSDocText,
        updateJSDocText,
        createJSDocComment,
        updateJSDocComment,
        createJsxElement,
        updateJsxElement,
        createJsxSelfClosingElement,
        updateJsxSelfClosingElement,
        createJsxOpeningElement,
        updateJsxOpeningElement,
        createJsxClosingElement,
        updateJsxClosingElement,
        createJsxFragment,
        createJsxText,
        updateJsxText,
        createJsxOpeningFragment,
        createJsxJsxClosingFragment,
        updateJsxFragment,
        createJsxAttribute,
        updateJsxAttribute,
        createJsxAttributes,
        updateJsxAttributes,
        createJsxSpreadAttribute,
        updateJsxSpreadAttribute,
        createJsxExpression,
        updateJsxExpression,
        createJsxNamespacedName,
        updateJsxNamespacedName,
        createCaseClause,
        updateCaseClause,
        createDefaultClause,
        updateDefaultClause,
        createHeritageClause,
        updateHeritageClause,
        createCatchClause,
        updateCatchClause,
        createPropertyAssignment,
        updatePropertyAssignment,
        createShorthandPropertyAssignment,
        updateShorthandPropertyAssignment,
        createSpreadAssignment,
        updateSpreadAssignment,
        createEnumMember,
        updateEnumMember,
        createSourceFile,
        updateSourceFile,
        createRedirectedSourceFile,
        createBundle,
        updateBundle,
        createSyntheticExpression,
        createSyntaxList,
        createNotEmittedStatement,
        createNotEmittedTypeElement,
        createPartiallyEmittedExpression,
        updatePartiallyEmittedExpression,
        createCommaListExpression,
        updateCommaListExpression,
        createSyntheticReferenceExpression,
        updateSyntheticReferenceExpression,
        cloneNode,
        // Lazily load factory methods for common operator factories and utilities
        get createComma() {
            return getBinaryCreateFunction(SyntaxKind.CommaToken);
        },
        get createAssignment() {
            return getBinaryCreateFunction(SyntaxKind.EqualsToken);
        },
        get createLogicalOr() {
            return getBinaryCreateFunction(SyntaxKind.BarBarToken);
        },
        get createLogicalAnd() {
            return getBinaryCreateFunction(SyntaxKind.AmpersandAmpersandToken);
        },
        get createBitwiseOr() {
            return getBinaryCreateFunction(SyntaxKind.BarToken);
        },
        get createBitwiseXor() {
            return getBinaryCreateFunction(SyntaxKind.CaretToken);
        },
        get createBitwiseAnd() {
            return getBinaryCreateFunction(SyntaxKind.AmpersandToken);
        },
        get createStrictEquality() {
            return getBinaryCreateFunction(SyntaxKind.EqualsEqualsEqualsToken);
        },
        get createStrictInequality() {
            return getBinaryCreateFunction(SyntaxKind.ExclamationEqualsEqualsToken);
        },
        get createEquality() {
            return getBinaryCreateFunction(SyntaxKind.EqualsEqualsToken);
        },
        get createInequality() {
            return getBinaryCreateFunction(SyntaxKind.ExclamationEqualsToken);
        },
        get createLessThan() {
            return getBinaryCreateFunction(SyntaxKind.LessThanToken);
        },
        get createLessThanEquals() {
            return getBinaryCreateFunction(SyntaxKind.LessThanEqualsToken);
        },
        get createGreaterThan() {
            return getBinaryCreateFunction(SyntaxKind.GreaterThanToken);
        },
        get createGreaterThanEquals() {
            return getBinaryCreateFunction(SyntaxKind.GreaterThanEqualsToken);
        },
        get createLeftShift() {
            return getBinaryCreateFunction(SyntaxKind.LessThanLessThanToken);
        },
        get createRightShift() {
            return getBinaryCreateFunction(SyntaxKind.GreaterThanGreaterThanToken);
        },
        get createUnsignedRightShift() {
            return getBinaryCreateFunction(SyntaxKind.GreaterThanGreaterThanGreaterThanToken);
        },
        get createAdd() {
            return getBinaryCreateFunction(SyntaxKind.PlusToken);
        },
        get createSubtract() {
            return getBinaryCreateFunction(SyntaxKind.MinusToken);
        },
        get createMultiply() {
            return getBinaryCreateFunction(SyntaxKind.AsteriskToken);
        },
        get createDivide() {
            return getBinaryCreateFunction(SyntaxKind.SlashToken);
        },
        get createModulo() {
            return getBinaryCreateFunction(SyntaxKind.PercentToken);
        },
        get createExponent() {
            return getBinaryCreateFunction(SyntaxKind.AsteriskAsteriskToken);
        },
        get createPrefixPlus() {
            return getPrefixUnaryCreateFunction(SyntaxKind.PlusToken);
        },
        get createPrefixMinus() {
            return getPrefixUnaryCreateFunction(SyntaxKind.MinusToken);
        },
        get createPrefixIncrement() {
            return getPrefixUnaryCreateFunction(SyntaxKind.PlusPlusToken);
        },
        get createPrefixDecrement() {
            return getPrefixUnaryCreateFunction(SyntaxKind.MinusMinusToken);
        },
        get createBitwiseNot() {
            return getPrefixUnaryCreateFunction(SyntaxKind.TildeToken);
        },
        get createLogicalNot() {
            return getPrefixUnaryCreateFunction(SyntaxKind.ExclamationToken);
        },
        get createPostfixIncrement() {
            return getPostfixUnaryCreateFunction(SyntaxKind.PlusPlusToken);
        },
        get createPostfixDecrement() {
            return getPostfixUnaryCreateFunction(SyntaxKind.MinusMinusToken);
        },
        // Compound nodes
        createImmediatelyInvokedFunctionExpression,
        createImmediatelyInvokedArrowFunction,
        createVoidZero,
        createExportDefault,
        createExternalModuleExport,
        createTypeCheck,
        createIsNotTypeCheck,
        createMethodCall,
        createGlobalMethodCall,
        createFunctionBindCall,
        createFunctionCallCall,
        createFunctionApplyCall,
        createArraySliceCall,
        createArrayConcatCall,
        createObjectDefinePropertyCall,
        createObjectGetOwnPropertyDescriptorCall,
        createReflectGetCall,
        createReflectSetCall,
        createPropertyDescriptor,
        createCallBinding,
        createAssignmentTargetWrapper,
        // Utilities
        inlineExpressions,
        getInternalName,
        getLocalName,
        getExportName,
        getDeclarationName,
        getNamespaceMemberName,
        getExternalModuleOrNamespaceExportName,
        restoreOuterExpressions,
        restoreEnclosingLabel,
        createUseStrictPrologue,
        copyPrologue,
        copyStandardPrologue,
        copyCustomPrologue,
        ensureUseStrict,
        liftToBlock,
        mergeLexicalEnvironment,
        replaceModifiers,
        replaceDecoratorsAndModifiers,
        replacePropertyName,
    };
    forEach(nodeFactoryPatchers, fn => fn(factory));
    return factory;
    // @api
    function createNodeArray<T extends Node>(elements?: readonly T[], hasTrailingComma?: boolean): NodeArray<T> {
        if (elements === undefined || elements === emptyArray) {
            elements = [];
        }
        else if (isNodeArray(elements)) {
            if (hasTrailingComma === undefined || elements.hasTrailingComma === hasTrailingComma) {
                // Ensure the transform flags have been aggregated for this NodeArray
                if (elements.transformFlags === undefined) {
                    aggregateChildrenFlags(elements);
                }
                Debug.attachNodeArrayDebugInfo(elements);
                return elements;
            }
            // This *was* a `NodeArray`, but the `hasTrailingComma` option differs. Recreate the
            // array with the same elements, text range, and transform flags but with the updated
            // value for `hasTrailingComma`
            const array: T[] & Partial<NodeArray<T>> = elements.slice();
            array.pos = elements.pos;
            array.end = elements.end;
            array.hasTrailingComma = hasTrailingComma;
            array.transformFlags = elements.transformFlags;
            requireCompleteNodeArray(array);
            Debug.attachNodeArrayDebugInfo(array);
            return array;
        }
        // Since the element list of a node array is typically created by starting with an empty array and
        // repeatedly calling push(), the list may not have the optimal memory layout. We invoke slice() for
        // small arrays (1 to 4 elements) to give the VM a chance to allocate an optimal representation.
        const length = elements.length;
        const array: readonly T[] & Partial<NodeArray<T>> = (length >= 1 && length <= 4 ? elements.slice() : elements);
        array.pos = -1;
        array.end = -1;
        array.hasTrailingComma = !!hasTrailingComma;
        array.transformFlags = TransformFlags.None;
        aggregateChildrenFlags(array);
        requireCompleteNodeArray(array);
        Debug.attachNodeArrayDebugInfo(array);
        return array;
    }
    function createBaseNode<T extends Node>(kind: T["kind"]) {
        return baseFactory.createBaseNode(kind);
    }
    function createBaseDeclaration<T extends Declaration>(kind: T["kind"]) {
        const node: Node & Partial<Pick<Declaration, "symbol" | "localSymbol">> = createBaseNode(kind);
        node.symbol = undefined; // initialized by binder
        node.localSymbol = undefined; // initialized by binder
        return node;
    }
    function finishUpdateBaseSignatureDeclaration<T extends SignatureDeclarationBase>(updated: Mutable<T>, original: T) {
        if (updated !== original) {
            // copy children used for quick info
            updated.typeArguments = original.typeArguments;
        }
        return update(updated, original);
    }
    //
    // Literals
    //
    // @api
    function createNumericLiteral(value: string | number, numericLiteralFlags: TokenFlags = TokenFlags.None): NumericLiteral {
        const text = typeof value === "number" ? value + "" : value;
        Debug.assert(text.charCodeAt(0) !== CharacterCodes.minus, "Negative numbers should be created in combination with createPrefixUnaryExpression");
        const node = checkedCompilerLayout(createBaseDeclaration<NumericLiteral>(SyntaxKind.NumericLiteral), checked_isNumericLiteral);
        node.text = text;
        node.numericLiteralFlags = numericLiteralFlags;
        if (numericLiteralFlags & TokenFlags.BinaryOrOctalSpecifier)
            node.transformFlags |= TransformFlags.ContainsES2015;
        return node;
    }
    // @api
    function createBigIntLiteral(value: string | PseudoBigInt): BigIntLiteral {
        const node = checkedCompilerLayout(createBaseToken<BigIntLiteral>(SyntaxKind.BigIntLiteral), checked_isBigIntLiteral);
        node.text = typeof value === "string" ? value : pseudoBigIntToString(value) + "n";
        node.transformFlags |= TransformFlags.ContainsES2020;
        return node;
    }
    function createBaseStringLiteral(text: string, isSingleQuote?: boolean) {
        const node = checkedCompilerLayout(createBaseDeclaration<StringLiteral>(SyntaxKind.StringLiteral), checked_isStringLiteral);
        node.text = text;
        node.singleQuote = isSingleQuote;
        return node;
    }
    // @api
    function createStringLiteral(text: string, isSingleQuote?: boolean, hasExtendedUnicodeEscape?: boolean): StringLiteral {
        const node = createBaseStringLiteral(text, isSingleQuote);
        node.hasExtendedUnicodeEscape = hasExtendedUnicodeEscape;
        if (hasExtendedUnicodeEscape)
            node.transformFlags |= TransformFlags.ContainsES2015;
        return node;
    }
    // @api
    function createStringLiteralFromNode(sourceNode: PropertyNameLiteral | PrivateIdentifier): StringLiteral {
        const node = createBaseStringLiteral(getTextOfIdentifierOrLiteral(sourceNode), /*isSingleQuote*/ undefined);
        node.textSourceNode = sourceNode;
        return node;
    }
    // @api
    function createRegularExpressionLiteral(text: string): RegularExpressionLiteral {
        const node = checkedCompilerLayout(createBaseToken<RegularExpressionLiteral>(SyntaxKind.RegularExpressionLiteral), checked_isRegularExpressionLiteral);
        node.text = text;
        return node;
    }
    // @api
    function createLiteralLikeNode(kind: LiteralToken["kind"] | typeof SyntaxKind.JsxTextAllWhiteSpaces, text: string): LiteralToken {
        switch (kind) {
            case SyntaxKind.NumericLiteral:
                return createNumericLiteral(text, /*numericLiteralFlags*/ 0);
            case SyntaxKind.BigIntLiteral:
                return createBigIntLiteral(text);
            case SyntaxKind.StringLiteral:
                return createStringLiteral(text, /*isSingleQuote*/ undefined);
            case SyntaxKind.JsxText:
                return createJsxText(text, /*containsOnlyTriviaWhiteSpaces*/ false);
            case SyntaxKind.JsxTextAllWhiteSpaces:
                return createJsxText(text, /*containsOnlyTriviaWhiteSpaces*/ true);
            case SyntaxKind.RegularExpressionLiteral:
                return createRegularExpressionLiteral(text);
            case SyntaxKind.NoSubstitutionTemplateLiteral:
                return checkedCompilerLayout(createTemplateLiteralLikeNode(kind, text, /*rawText*/ undefined, /*templateFlags*/ 0), checked_isNoSubstitutionTemplateLiteral);
        }
    }
    //
    // Identifiers
    //
    function createBaseIdentifier(escapedText: __String) {
        const node = checkedCompilerLayout(baseFactory.createBaseIdentifierNode(SyntaxKind.Identifier), checked_isIdentifier);
        node.escapedText = escapedText;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.symbol = undefined; // initialized by checker
        return node;
    }
    function createBaseGeneratedIdentifier(text: string, autoGenerateFlags: GeneratedIdentifierFlags, prefix: string | GeneratedNamePart | undefined, suffix: string | undefined) {
        const node = createBaseIdentifier(escapeLeadingUnderscores(text));
        setIdentifierAutoGenerate(node, {
            flags: autoGenerateFlags,
            id: nextAutoGenerateId,
            prefix,
            suffix,
        });
        nextAutoGenerateId++;
        return checkedCompilerLayout(node, checked_isGeneratedIdentifier);
    }
    // @api
    function createIdentifier(text: string, originalKeywordKind?: (SyntaxKind) | undefined, hasExtendedUnicodeEscape?: boolean): Identifier {
        if (originalKeywordKind === undefined && text) {
            originalKeywordKind = stringToToken(text);
        }
        if (originalKeywordKind === SyntaxKind.Identifier) {
            originalKeywordKind = undefined;
        }
        const node = createBaseIdentifier(escapeLeadingUnderscores(text));
        if (hasExtendedUnicodeEscape)
            node.flags |= NodeFlags.IdentifierHasExtendedUnicodeEscape;
        // NOTE: we do not include transform flags of typeArguments in an identifier as they do not contribute to transformations
        if (node.escapedText === "await") {
            node.transformFlags |= TransformFlags.ContainsPossibleTopLevelAwait;
        }
        if (node.flags & NodeFlags.IdentifierHasExtendedUnicodeEscape) {
            node.transformFlags |= TransformFlags.ContainsES2015;
        }
        return node;
    }
    // @api
    function createTempVariable(recordTempVariable: ((node: Identifier) => void) | undefined, reservedInNestedScopes?: boolean, prefix?: string | GeneratedNamePart, suffix?: string): GeneratedIdentifier {
        let flags: GeneratedIdentifierFlags = GeneratedIdentifierFlags.Auto;
        if (reservedInNestedScopes)
            flags |= GeneratedIdentifierFlags.ReservedInNestedScopes;
        const name = createBaseGeneratedIdentifier("", flags, prefix, suffix);
        if (recordTempVariable) {
            recordTempVariable(name);
        }
        return name;
    }
    /** Create a unique temporary variable for use in a loop. */
    // @api
    function createLoopVariable(reservedInNestedScopes?: boolean): Identifier {
        let flags: GeneratedIdentifierFlags = GeneratedIdentifierFlags.Loop;
        if (reservedInNestedScopes)
            flags |= GeneratedIdentifierFlags.ReservedInNestedScopes;
        return createBaseGeneratedIdentifier("", flags, /*prefix*/ undefined, /*suffix*/ undefined);
    }
    /** Create a unique name based on the supplied text. */
    // @api
    function createUniqueName(text: string, flags: GeneratedIdentifierFlags = GeneratedIdentifierFlags.None, prefix?: string | GeneratedNamePart, suffix?: string): Identifier {
        Debug.assert(!(flags & GeneratedIdentifierFlags.KindMask), "Argument out of range: flags");
        Debug.assert((flags & (GeneratedIdentifierFlags.Optimistic | GeneratedIdentifierFlags.FileLevel)) !== GeneratedIdentifierFlags.FileLevel, "GeneratedIdentifierFlags.FileLevel cannot be set without also setting GeneratedIdentifierFlags.Optimistic");
        return createBaseGeneratedIdentifier(text, GeneratedIdentifierFlags.Unique | flags, prefix, suffix);
    }
    /** Create a unique name generated for a node. */
    // @api
    function getGeneratedNameForNode(node: Node | undefined, flags: GeneratedIdentifierFlags = 0, prefix?: string | GeneratedNamePart, suffix?: string): Identifier {
        Debug.assert(!(flags & GeneratedIdentifierFlags.KindMask), "Argument out of range: flags");
        const text = !node ? "" :
            isMemberName(node) ? formatGeneratedName(/*privateName*/ false, prefix, node, suffix, idText) :
                `generated@${getNodeId(node)}`;
        if (prefix || suffix)
            flags |= GeneratedIdentifierFlags.Optimistic;
        const name = createBaseGeneratedIdentifier(text, GeneratedIdentifierFlags.Node | flags, prefix, suffix);
        name.original = node;
        return name;
    }
    function createBasePrivateIdentifier(escapedText: __String) {
        const node = checkedCompilerLayout(baseFactory.createBasePrivateIdentifierNode(SyntaxKind.PrivateIdentifier), checked_isPrivateIdentifier);
        node.escapedText = escapedText;
        node.transformFlags |= TransformFlags.ContainsClassFields;
        return node;
    }
    // @api
    function createPrivateIdentifier(text: string): PrivateIdentifier {
        if (!startsWith(text, "#"))
            Debug.fail("First character of private identifier must be #: " + text);
        return createBasePrivateIdentifier(escapeLeadingUnderscores(text));
    }
    function createBaseGeneratedPrivateIdentifier(text: string, autoGenerateFlags: GeneratedIdentifierFlags, prefix: string | GeneratedNamePart | undefined, suffix: string | undefined) {
        const node = createBasePrivateIdentifier(escapeLeadingUnderscores(text));
        setIdentifierAutoGenerate(node, {
            flags: autoGenerateFlags,
            id: nextAutoGenerateId,
            prefix,
            suffix,
        });
        nextAutoGenerateId++;
        return node;
    }
    /** Create a unique name based on the supplied text. */
    // @api
    function createUniquePrivateName(text?: string, prefix?: string | GeneratedNamePart, suffix?: string): PrivateIdentifier {
        if (text && !startsWith(text, "#"))
            Debug.fail("First character of private identifier must be #: " + text);
        const autoGenerateFlags = GeneratedIdentifierFlags.ReservedInNestedScopes |
            (text ? GeneratedIdentifierFlags.Unique : GeneratedIdentifierFlags.Auto);
        return createBaseGeneratedPrivateIdentifier(text ?? "", autoGenerateFlags, prefix, suffix);
    }
    // @api
    function getGeneratedPrivateNameForNode(node: Node, prefix?: string | GeneratedNamePart, suffix?: string): PrivateIdentifier {
        const text = isMemberName(node) ? formatGeneratedName(/*privateName*/ true, prefix, node, suffix, idText) :
            `#generated@${getNodeId(node)}`;
        const flags = prefix || suffix ? GeneratedIdentifierFlags.Optimistic : GeneratedIdentifierFlags.None;
        const name = createBaseGeneratedPrivateIdentifier(text, GeneratedIdentifierFlags.Node | flags, prefix, suffix);
        name.original = node;
        return name;
    }
    //
    // Punctuation
    //
    function createBaseToken<T extends Node>(kind: T["kind"]) {
        return baseFactory.createBaseTokenNode(kind);
    }
    // @api
    function createToken(token: typeof SyntaxKind.SuperKeyword): SuperExpression;
    function createToken(token: typeof SyntaxKind.ThisKeyword): ThisExpression;
    function createToken(token: typeof SyntaxKind.NullKeyword): NullLiteral;
    function createToken(token: typeof SyntaxKind.TrueKeyword): TrueLiteral;
    function createToken(token: typeof SyntaxKind.FalseKeyword): FalseLiteral;
    function createToken(token: typeof SyntaxKind.EndOfFileToken): EndOfFileToken;
    function createToken(token: typeof SyntaxKind.Unknown): Token<typeof SyntaxKind.Unknown>;
    function createToken<TKind extends PunctuationSyntaxKind>(token: TKind): PunctuationToken<TKind>;
    function createToken<TKind extends KeywordTypeSyntaxKind>(token: TKind): KeywordTypeNode<TKind>;
    function createToken<TKind extends ModifierSyntaxKind>(token: TKind): ModifierToken<TKind>;
    function createToken<TKind extends KeywordSyntaxKind>(token: TKind): KeywordToken<TKind>;
    function createToken<TKind extends SyntaxKind>(token: TKind): Token<TKind>;
    function createToken<TKind extends SyntaxKind>(token: TKind) {
        Debug.assert(token >= SyntaxKind.FirstToken && token <= SyntaxKind.LastToken, "Invalid token");
        Debug.assert(token <= SyntaxKind.FirstTemplateToken || token >= SyntaxKind.LastTemplateToken, "Invalid token. Use 'createTemplateLiteralLikeNode' to create template literals.");
        Debug.assert(token <= SyntaxKind.FirstLiteralToken || token >= SyntaxKind.LastLiteralToken, "Invalid token. Use 'createLiteralLikeNode' to create literals.");
        Debug.assert(token !== SyntaxKind.Identifier, "Invalid token. Use 'createIdentifier' to create identifiers");
        const node = createBaseToken<Token<TKind>>(token);
        let transformFlags: TransformFlags = TransformFlags.None;
        switch (token) {
            case SyntaxKind.AsyncKeyword:
                // 'async' modifier is ES2017 (async functions) or ES2018 (async generators)
                transformFlags = TransformFlags.ContainsES2017 |
                    TransformFlags.ContainsES2018;
                break;
            case SyntaxKind.UsingKeyword:
                transformFlags = TransformFlags.ContainsESNext;
                break;
            case SyntaxKind.PublicKeyword:
            case SyntaxKind.PrivateKeyword:
            case SyntaxKind.ProtectedKeyword:
            case SyntaxKind.ReadonlyKeyword:
            case SyntaxKind.AbstractKeyword:
            case SyntaxKind.DeclareKeyword:
            case SyntaxKind.ConstKeyword:
            case SyntaxKind.AnyKeyword:
            case SyntaxKind.NumberKeyword:
            case SyntaxKind.BigIntKeyword:
            case SyntaxKind.NeverKeyword:
            case SyntaxKind.ObjectKeyword:
            case SyntaxKind.InKeyword:
            case SyntaxKind.OutKeyword:
            case SyntaxKind.OverrideKeyword:
            case SyntaxKind.StringKeyword:
            case SyntaxKind.BooleanKeyword:
            case SyntaxKind.SymbolKeyword:
            case SyntaxKind.VoidKeyword:
            case SyntaxKind.UnknownKeyword:
            case SyntaxKind.UndefinedKeyword: // `undefined` is an Identifier in the expression case.
                transformFlags = TransformFlags.ContainsTypeScript;
                break;
            case SyntaxKind.SuperKeyword:
                transformFlags = TransformFlags.ContainsES2015 | TransformFlags.ContainsLexicalSuper;
                checkedCompilerLayout((node), isNodeLayout_d3bc2d641bbb).flowNode = undefined; // initialized by binder (FlowContainer)
                break;
            case SyntaxKind.StaticKeyword:
                transformFlags = TransformFlags.ContainsES2015;
                break;
            case SyntaxKind.AccessorKeyword:
                transformFlags = TransformFlags.ContainsClassFields;
                break;
            case SyntaxKind.ThisKeyword:
                // 'this' indicates a lexical 'this'
                transformFlags = TransformFlags.ContainsLexicalThis;
                checkedCompilerLayout((node), isNodeLayout_1bf25640bb33).flowNode = undefined; // initialized by binder (FlowContainer)
                break;
        }
        if (transformFlags) {
            node.transformFlags |= transformFlags;
        }
        return node;
    }
    //
    // Reserved words
    //
    // @api
    function createSuper() {
        return createToken(SyntaxKind.SuperKeyword);
    }
    // @api
    function createThis() {
        return createToken(SyntaxKind.ThisKeyword);
    }
    // @api
    function createNull() {
        return createToken(SyntaxKind.NullKeyword);
    }
    // @api
    function createTrue() {
        return createToken(SyntaxKind.TrueKeyword);
    }
    // @api
    function createFalse() {
        return createToken(SyntaxKind.FalseKeyword);
    }
    //
    // Modifiers
    //
    // @api
    function createModifier<T extends ModifierSyntaxKind>(kind: T) {
        return createToken(kind);
    }
    // @api
    function createModifiersFromModifierFlags(flags: ModifierFlags) {
        const result: Modifier[] = [];
        if (flags & ModifierFlags.Export)
            result.push(createModifier(SyntaxKind.ExportKeyword));
        if (flags & ModifierFlags.Ambient)
            result.push(createModifier(SyntaxKind.DeclareKeyword));
        if (flags & ModifierFlags.Default)
            result.push(createModifier(SyntaxKind.DefaultKeyword));
        if (flags & ModifierFlags.Const)
            result.push(createModifier(SyntaxKind.ConstKeyword));
        if (flags & ModifierFlags.Public)
            result.push(createModifier(SyntaxKind.PublicKeyword));
        if (flags & ModifierFlags.Private)
            result.push(createModifier(SyntaxKind.PrivateKeyword));
        if (flags & ModifierFlags.Protected)
            result.push(createModifier(SyntaxKind.ProtectedKeyword));
        if (flags & ModifierFlags.Abstract)
            result.push(createModifier(SyntaxKind.AbstractKeyword));
        if (flags & ModifierFlags.Static)
            result.push(createModifier(SyntaxKind.StaticKeyword));
        if (flags & ModifierFlags.Override)
            result.push(createModifier(SyntaxKind.OverrideKeyword));
        if (flags & ModifierFlags.Readonly)
            result.push(createModifier(SyntaxKind.ReadonlyKeyword));
        if (flags & ModifierFlags.Accessor)
            result.push(createModifier(SyntaxKind.AccessorKeyword));
        if (flags & ModifierFlags.Async)
            result.push(createModifier(SyntaxKind.AsyncKeyword));
        if (flags & ModifierFlags.In)
            result.push(createModifier(SyntaxKind.InKeyword));
        if (flags & ModifierFlags.Out)
            result.push(createModifier(SyntaxKind.OutKeyword));
        return result.length ? result : undefined;
    }
    //
    // Names
    //
    // @api
    function createQualifiedName(left: EntityName, right: string | Identifier) {
        const node = checkedCompilerLayout(createBaseNode<QualifiedName>(SyntaxKind.QualifiedName), checked_isQualifiedName);
        node.left = left;
        node.right = asName(right);
        node.transformFlags |= propagateChildFlags(node.left) |
            propagateIdentifierNameFlags(node.right);
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateQualifiedName(node: QualifiedName, left: EntityName, right: Identifier) {
        return node.left !== left
            || node.right !== right
            ? update(createQualifiedName(left, right), node)
            : node;
    }
    // @api
    function createComputedPropertyName(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<ComputedPropertyName>(SyntaxKind.ComputedPropertyName), checked_isComputedPropertyName);
        node.expression = parenthesizerRules().parenthesizeExpressionOfComputedPropertyName(expression);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsES2015 |
            TransformFlags.ContainsComputedPropertyName;
        return node;
    }
    // @api
    function updateComputedPropertyName(node: ComputedPropertyName, expression: Expression) {
        return node.expression !== expression
            ? update(createComputedPropertyName(expression), node)
            : node;
    }
    //
    // Signature elements
    //
    // @api
    function createTypeParameterDeclaration(modifiers: readonly Modifier[] | undefined, name: string | Identifier, constraint?: TypeNode, defaultType?: TypeNode): TypeParameterDeclaration {
        const node = checkedCompilerLayout(createBaseDeclaration<TypeParameterDeclaration>(SyntaxKind.TypeParameter), checked_isTypeParameterDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.constraint = constraint;
        node.default = defaultType;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.expression = undefined; // initialized by parser to report grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateTypeParameterDeclaration(node: TypeParameterDeclaration, modifiers: readonly Modifier[] | undefined, name: Identifier, constraint: TypeNode | undefined, defaultType: TypeNode | undefined): TypeParameterDeclaration {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.constraint !== constraint
            || node.default !== defaultType
            ? update(createTypeParameterDeclaration(modifiers, name, constraint, defaultType), node)
            : node;
    }
    // @api
    function createParameterDeclaration(modifiers: readonly ModifierLike[] | undefined, dotDotDotToken: DotDotDotToken | undefined, name: string | BindingName, questionToken?: QuestionToken, type?: TypeNode, initializer?: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<ParameterDeclaration>(SyntaxKind.Parameter), checked_isParameter);
        node.modifiers = asNodeArray(modifiers);
        node.dotDotDotToken = dotDotDotToken;
        node.name = asName(name);
        node.questionToken = questionToken;
        node.type = type;
        node.initializer = asInitializer(initializer);
        if (isThisIdentifier(node.name)) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            node.transformFlags = propagateChildrenFlags(node.modifiers) |
                propagateChildFlags(node.dotDotDotToken) |
                propagateNameFlags(node.name) |
                propagateChildFlags(node.questionToken) |
                propagateChildFlags(node.initializer) |
                (node.questionToken ?? node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
                (node.dotDotDotToken ?? node.initializer ? TransformFlags.ContainsES2015 : TransformFlags.None) |
                (modifiersToFlags(node.modifiers) & ModifierFlags.ParameterPropertyModifier ? TransformFlags.ContainsTypeScriptClassSyntax : TransformFlags.None);
        }
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateParameterDeclaration(node: ParameterDeclaration, modifiers: readonly ModifierLike[] | undefined, dotDotDotToken: DotDotDotToken | undefined, name: string | BindingName, questionToken: QuestionToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined) {
        return node.modifiers !== modifiers
            || node.dotDotDotToken !== dotDotDotToken
            || node.name !== name
            || node.questionToken !== questionToken
            || node.type !== type
            || node.initializer !== initializer
            ? update(createParameterDeclaration(modifiers, dotDotDotToken, name, questionToken, type, initializer), node)
            : node;
    }
    // @api
    function createDecorator(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<Decorator>(SyntaxKind.Decorator), checked_isDecorator);
        node.expression = parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsTypeScript |
            TransformFlags.ContainsTypeScriptClassSyntax |
            TransformFlags.ContainsDecorators;
        return node;
    }
    // @api
    function updateDecorator(node: Decorator, expression: Expression) {
        return node.expression !== expression
            ? update(createDecorator(expression), node)
            : node;
    }
    //
    // Type Elements
    //
    // @api
    function createPropertySignature(modifiers: readonly Modifier[] | undefined, name: PropertyName | string, questionToken: QuestionToken | undefined, type: TypeNode | undefined): PropertySignature {
        const node = checkedCompilerLayout(createBaseDeclaration<PropertySignature>(SyntaxKind.PropertySignature), checked_isPropertySignature);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.type = type;
        node.questionToken = questionToken;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.initializer = undefined; // initialized by parser to report grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updatePropertySignature(node: PropertySignature, modifiers: readonly Modifier[] | undefined, name: PropertyName, questionToken: QuestionToken | undefined, type: TypeNode | undefined) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.questionToken !== questionToken
            || node.type !== type
            ? finishUpdatePropertySignature(createPropertySignature(modifiers, name, questionToken, type), node)
            : node;
    }
    function finishUpdatePropertySignature(updated: Mutable<PropertySignature>, original: PropertySignature) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.initializer = original.initializer;
        }
        return update(updated, original);
    }
    // @api
    function createPropertyDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, questionOrExclamationToken: QuestionToken | ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<PropertyDeclaration>(SyntaxKind.PropertyDeclaration), checked_isPropertyDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.questionToken = questionOrExclamationToken && isQuestionToken(questionOrExclamationToken) ? questionOrExclamationToken : undefined;
        node.exclamationToken = questionOrExclamationToken && isExclamationToken(questionOrExclamationToken) ? questionOrExclamationToken : undefined;
        node.type = type;
        node.initializer = asInitializer(initializer);
        const isAmbient = node.flags & NodeFlags.Ambient || modifiersToFlags(node.modifiers) & ModifierFlags.Ambient;
        node.transformFlags = propagateChildrenFlags(node.modifiers) |
            propagateNameFlags(node.name) |
            propagateChildFlags(node.initializer) |
            (isAmbient || node.questionToken || node.exclamationToken || node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
            (isComputedPropertyName(node.name) || modifiersToFlags(node.modifiers) & ModifierFlags.Static && node.initializer ? TransformFlags.ContainsTypeScriptClassSyntax : TransformFlags.None) |
            TransformFlags.ContainsClassFields;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updatePropertyDeclaration(node: PropertyDeclaration, modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, questionOrExclamationToken: QuestionToken | ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.questionToken !== (questionOrExclamationToken !== undefined && isQuestionToken(questionOrExclamationToken) ? questionOrExclamationToken : undefined)
            || node.exclamationToken !== (questionOrExclamationToken !== undefined && isExclamationToken(questionOrExclamationToken) ? questionOrExclamationToken : undefined)
            || node.type !== type
            || node.initializer !== initializer
            ? update(createPropertyDeclaration(modifiers, name, questionOrExclamationToken, type, initializer), node)
            : node;
    }
    // @api
    function createMethodSignature(modifiers: readonly Modifier[] | undefined, name: string | PropertyName, questionToken: QuestionToken | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<MethodSignature>(SyntaxKind.MethodSignature), checked_isMethodSignature);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.questionToken = questionToken;
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = asNodeArray(parameters);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    // @api
    function updateMethodSignature(node: MethodSignature, modifiers: readonly Modifier[] | undefined, name: PropertyName, questionToken: QuestionToken | undefined, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode | undefined) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.questionToken !== questionToken
            || node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            ? finishUpdateBaseSignatureDeclaration(createMethodSignature(modifiers, name, questionToken, typeParameters, parameters, type), node)
            : node;
    }
    // @api
    function createMethodDeclaration(modifiers: readonly ModifierLike[] | undefined, asteriskToken: AsteriskToken | undefined, name: string | PropertyName, questionToken: QuestionToken | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<MethodDeclaration>(SyntaxKind.MethodDeclaration), checked_isMethodDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.asteriskToken = asteriskToken;
        node.name = asName(name);
        node.questionToken = questionToken;
        node.exclamationToken = undefined; // initialized by parser for grammar errors
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = createNodeArray(parameters);
        node.type = type;
        node.body = body;
        if (!node.body) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            const isAsync = modifiersToFlags(node.modifiers) & ModifierFlags.Async;
            const isGenerator = !!node.asteriskToken;
            const isAsyncGenerator = isAsync && isGenerator;
            node.transformFlags = propagateChildrenFlags(node.modifiers) |
                propagateChildFlags(node.asteriskToken) |
                propagateNameFlags(node.name) |
                propagateChildFlags(node.questionToken) |
                propagateChildrenFlags(node.typeParameters) |
                propagateChildrenFlags(node.parameters) |
                propagateChildFlags(node.type) |
                (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
                (isAsyncGenerator ? TransformFlags.ContainsES2018 :
                    isAsync ? TransformFlags.ContainsES2017 :
                        isGenerator ? TransformFlags.ContainsGenerator :
                            TransformFlags.None) |
                (node.questionToken || node.typeParameters || node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
                TransformFlags.ContainsES2015;
        }
        node.typeArguments = undefined; // used in quick info
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateMethodDeclaration(node: MethodDeclaration, modifiers: readonly ModifierLike[] | undefined, asteriskToken: AsteriskToken | undefined, name: PropertyName, questionToken: QuestionToken | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined) {
        return node.modifiers !== modifiers
            || node.asteriskToken !== asteriskToken
            || node.name !== name
            || node.questionToken !== questionToken
            || node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            || node.body !== body
            ? finishUpdateMethodDeclaration(createMethodDeclaration(modifiers, asteriskToken, name, questionToken, typeParameters, parameters, type, body), node)
            : node;
    }
    function finishUpdateMethodDeclaration(updated: Mutable<MethodDeclaration>, original: MethodDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.exclamationToken = original.exclamationToken;
        }
        return update(updated, original);
    }
    // @api
    function createClassStaticBlockDeclaration(body: Block): ClassStaticBlockDeclaration {
        const node = checkedCompilerLayout(createBaseDeclaration<ClassStaticBlockDeclaration>(SyntaxKind.ClassStaticBlockDeclaration), checked_isClassStaticBlockDeclaration);
        node.body = body;
        node.transformFlags = propagateChildFlags(body) | TransformFlags.ContainsClassFields;
        node.modifiers = undefined; // initialized by parser for grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateClassStaticBlockDeclaration(node: ClassStaticBlockDeclaration, body: Block): ClassStaticBlockDeclaration {
        return node.body !== body
            ? finishUpdateClassStaticBlockDeclaration(createClassStaticBlockDeclaration(body), node)
            : node;
    }
    function finishUpdateClassStaticBlockDeclaration(updated: Mutable<ClassStaticBlockDeclaration>, original: ClassStaticBlockDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.modifiers = original.modifiers;
        }
        return update(updated, original);
    }
    // @api
    function createConstructorDeclaration(modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], body: Block | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<ConstructorDeclaration>(SyntaxKind.Constructor), checked_isConstructorDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.parameters = createNodeArray(parameters);
        node.body = body;
        if (!node.body) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            node.transformFlags = propagateChildrenFlags(node.modifiers) |
                propagateChildrenFlags(node.parameters) |
                (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
                TransformFlags.ContainsES2015;
        }
        node.typeParameters = undefined; // initialized by parser for grammar errors
        node.type = undefined; // initialized by parser for grammar errors
        node.typeArguments = undefined; // used in quick info
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateConstructorDeclaration(node: ConstructorDeclaration, modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], body: Block | undefined) {
        return node.modifiers !== modifiers
            || node.parameters !== parameters
            || node.body !== body
            ? finishUpdateConstructorDeclaration(createConstructorDeclaration(modifiers, parameters, body), node)
            : node;
    }
    function finishUpdateConstructorDeclaration(updated: Mutable<ConstructorDeclaration>, original: ConstructorDeclaration) {
        if (updated !== original) {
            updated.typeParameters = original.typeParameters;
            updated.type = original.type;
        }
        return finishUpdateBaseSignatureDeclaration(updated, original);
    }
    // @api
    function createGetAccessorDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<GetAccessorDeclaration>(SyntaxKind.GetAccessor), checked_isGetAccessor);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.parameters = createNodeArray(parameters);
        node.type = type;
        node.body = body;
        if (!node.body) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            node.transformFlags = propagateChildrenFlags(node.modifiers) |
                propagateNameFlags(node.name) |
                propagateChildrenFlags(node.parameters) |
                propagateChildFlags(node.type) |
                (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
                (node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None);
        }
        node.typeArguments = undefined; // used in quick info
        node.typeParameters = undefined; // initialized by parser for grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateGetAccessorDeclaration(node: GetAccessorDeclaration, modifiers: readonly ModifierLike[] | undefined, name: PropertyName, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.parameters !== parameters
            || node.type !== type
            || node.body !== body
            ? finishUpdateGetAccessorDeclaration(createGetAccessorDeclaration(modifiers, name, parameters, type, body), node)
            : node;
    }
    function finishUpdateGetAccessorDeclaration(updated: Mutable<GetAccessorDeclaration>, original: GetAccessorDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.typeParameters = original.typeParameters;
        }
        return finishUpdateBaseSignatureDeclaration(updated, original);
    }
    // @api
    function createSetAccessorDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, parameters: readonly ParameterDeclaration[], body: Block | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<SetAccessorDeclaration>(SyntaxKind.SetAccessor), checked_isSetAccessor);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.parameters = createNodeArray(parameters);
        node.body = body;
        if (!node.body) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            node.transformFlags = propagateChildrenFlags(node.modifiers) |
                propagateNameFlags(node.name) |
                propagateChildrenFlags(node.parameters) |
                (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
                (node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None);
        }
        node.typeArguments = undefined; // used in quick info
        node.typeParameters = undefined; // initialized by parser for grammar errors
        node.type = undefined; // initialized by parser for grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateSetAccessorDeclaration(node: SetAccessorDeclaration, modifiers: readonly ModifierLike[] | undefined, name: PropertyName, parameters: readonly ParameterDeclaration[], body: Block | undefined) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.parameters !== parameters
            || node.body !== body
            ? finishUpdateSetAccessorDeclaration(createSetAccessorDeclaration(modifiers, name, parameters, body), node)
            : node;
    }
    function finishUpdateSetAccessorDeclaration(updated: Mutable<SetAccessorDeclaration>, original: SetAccessorDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.typeParameters = original.typeParameters;
            updated.type = original.type;
        }
        return finishUpdateBaseSignatureDeclaration(updated, original);
    }
    // @api
    function createCallSignature(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): CallSignatureDeclaration {
        const node = checkedCompilerLayout(createBaseDeclaration<CallSignatureDeclaration>(SyntaxKind.CallSignature), checked_isCallSignatureDeclaration);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = asNodeArray(parameters);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    // @api
    function updateCallSignature(node: CallSignatureDeclaration, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode | undefined) {
        return node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            ? finishUpdateBaseSignatureDeclaration(createCallSignature(typeParameters, parameters, type), node)
            : node;
    }
    // @api
    function createConstructSignature(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): ConstructSignatureDeclaration {
        const node = checkedCompilerLayout(createBaseDeclaration<ConstructSignatureDeclaration>(SyntaxKind.ConstructSignature), checked_isConstructSignatureDeclaration);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = asNodeArray(parameters);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    // @api
    function updateConstructSignature(node: ConstructSignatureDeclaration, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode | undefined) {
        return node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            ? finishUpdateBaseSignatureDeclaration(createConstructSignature(typeParameters, parameters, type), node)
            : node;
    }
    // @api
    function createIndexSignature(modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): IndexSignatureDeclaration {
        const node = checkedCompilerLayout(createBaseDeclaration<IndexSignatureDeclaration>(SyntaxKind.IndexSignature), checked_isIndexSignatureDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.parameters = asNodeArray(parameters);
        node.type = type; // TODO(rbuckton): We mark this as required in IndexSignatureDeclaration, but it looks like the parser allows it to be elided.
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    // @api
    function updateIndexSignature(node: IndexSignatureDeclaration, modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined) {
        return node.parameters !== parameters
            || node.type !== type
            || node.modifiers !== modifiers
            ? finishUpdateBaseSignatureDeclaration(createIndexSignature(modifiers, parameters, type), node)
            : node;
    }
    // @api
    function createTemplateLiteralTypeSpan(type: TypeNode, literal: TemplateMiddle | TemplateTail) {
        const node = checkedCompilerLayout(createBaseNode<TemplateLiteralTypeSpan>(SyntaxKind.TemplateLiteralTypeSpan), checked_isTemplateLiteralTypeSpan);
        node.type = type;
        node.literal = literal;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTemplateLiteralTypeSpan(node: TemplateLiteralTypeSpan, type: TypeNode, literal: TemplateMiddle | TemplateTail) {
        return node.type !== type
            || node.literal !== literal
            ? update(createTemplateLiteralTypeSpan(type, literal), node)
            : node;
    }
    //
    // Types
    //
    // @api
    function createKeywordTypeNode<TKind extends KeywordTypeSyntaxKind>(kind: TKind) {
        return createToken(kind);
    }
    // @api
    function createTypePredicateNode(assertsModifier: AssertsKeyword | undefined, parameterName: Identifier | ThisTypeNode | string, type: TypeNode | undefined) {
        const node = checkedCompilerLayout(createBaseNode<TypePredicateNode>(SyntaxKind.TypePredicate), checked_isTypePredicateNode);
        node.assertsModifier = assertsModifier;
        node.parameterName = asName(parameterName);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTypePredicateNode(node: TypePredicateNode, assertsModifier: AssertsKeyword | undefined, parameterName: Identifier | ThisTypeNode, type: TypeNode | undefined) {
        return node.assertsModifier !== assertsModifier
            || node.parameterName !== parameterName
            || node.type !== type
            ? update(createTypePredicateNode(assertsModifier, parameterName, type), node)
            : node;
    }
    // @api
    function createTypeReferenceNode(typeName: string | EntityName, typeArguments: readonly TypeNode[] | undefined) {
        const node = checkedCompilerLayout(createBaseNode<TypeReferenceNode>(SyntaxKind.TypeReference), checked_isTypeReferenceNode);
        node.typeName = asName(typeName);
        node.typeArguments = typeArguments && parenthesizerRules().parenthesizeTypeArguments(createNodeArray(typeArguments));
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTypeReferenceNode(node: TypeReferenceNode, typeName: EntityName, typeArguments: NodeArray<TypeNode> | undefined) {
        return node.typeName !== typeName
            || node.typeArguments !== typeArguments
            ? update(createTypeReferenceNode(typeName, typeArguments), node)
            : node;
    }
    // @api
    function createFunctionTypeNode(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode): FunctionTypeNode {
        const node = checkedCompilerLayout(createBaseDeclaration<FunctionTypeNode>(SyntaxKind.FunctionType), checked_isFunctionTypeNode);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = asNodeArray(parameters);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.modifiers = undefined; // initialized by parser for grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    // @api
    function updateFunctionTypeNode(node: FunctionTypeNode, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode) {
        return node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            ? finishUpdateFunctionTypeNode(createFunctionTypeNode(typeParameters, parameters, type), node)
            : node;
    }
    function finishUpdateFunctionTypeNode(updated: Mutable<FunctionTypeNode>, original: FunctionTypeNode) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.modifiers = original.modifiers;
        }
        return finishUpdateBaseSignatureDeclaration(updated, original);
    }
    // @api
    function createConstructorTypeNode(...args: Parameters<typeof createConstructorTypeNode1 | typeof createConstructorTypeNode2>) {
        return args.length === 4 ? createConstructorTypeNode1(...args) :
            args.length === 3 ? createConstructorTypeNode2(...args) :
                Debug.fail("Incorrect number of arguments specified.");
    }
    function createConstructorTypeNode1(modifiers: readonly Modifier[] | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode): ConstructorTypeNode {
        const node = checkedCompilerLayout(createBaseDeclaration<ConstructorTypeNode>(SyntaxKind.ConstructorType), checked_isConstructorTypeNode);
        node.modifiers = asNodeArray(modifiers);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = asNodeArray(parameters);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    /** @deprecated */
    function createConstructorTypeNode2(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode): ConstructorTypeNode {
        return createConstructorTypeNode1(/*modifiers*/ undefined, typeParameters, parameters, type);
    }
    // @api
    function updateConstructorTypeNode(...args: Parameters<typeof updateConstructorTypeNode1 | typeof updateConstructorTypeNode2>) {
        return args.length === 5 ? updateConstructorTypeNode1(...args) :
            args.length === 4 ? updateConstructorTypeNode2(...args) :
                Debug.fail("Incorrect number of arguments specified.");
    }
    function updateConstructorTypeNode1(node: ConstructorTypeNode, modifiers: readonly Modifier[] | undefined, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode) {
        return node.modifiers !== modifiers
            || node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            ? finishUpdateBaseSignatureDeclaration(createConstructorTypeNode(modifiers, typeParameters, parameters, type), node)
            : node;
    }
    /** @deprecated */
    function updateConstructorTypeNode2(node: ConstructorTypeNode, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode) {
        return updateConstructorTypeNode1(node, node.modifiers, typeParameters, parameters, type);
    }
    // @api
    function createTypeQueryNode(exprName: EntityName, typeArguments?: readonly TypeNode[]) {
        const node = checkedCompilerLayout(createBaseNode<TypeQueryNode>(SyntaxKind.TypeQuery), checked_isTypeQueryNode);
        node.exprName = exprName;
        node.typeArguments = typeArguments && parenthesizerRules().parenthesizeTypeArguments(typeArguments);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTypeQueryNode(node: TypeQueryNode, exprName: EntityName, typeArguments?: readonly TypeNode[]) {
        return node.exprName !== exprName
            || node.typeArguments !== typeArguments
            ? update(createTypeQueryNode(exprName, typeArguments), node)
            : node;
    }
    // @api
    function createTypeLiteralNode(members: readonly TypeElement[] | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<TypeLiteralNode>(SyntaxKind.TypeLiteral), checked_isTypeLiteralNode);
        node.members = createNodeArray(members);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTypeLiteralNode(node: TypeLiteralNode, members: NodeArray<TypeElement>) {
        return node.members !== members
            ? update(createTypeLiteralNode(members), node)
            : node;
    }
    // @api
    function createArrayTypeNode(elementType: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<ArrayTypeNode>(SyntaxKind.ArrayType), checked_isArrayTypeNode);
        node.elementType = parenthesizerRules().parenthesizeNonArrayTypeOfPostfixType(elementType);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateArrayTypeNode(node: ArrayTypeNode, elementType: TypeNode): ArrayTypeNode {
        return node.elementType !== elementType
            ? update(createArrayTypeNode(elementType), node)
            : node;
    }
    // @api
    function createTupleTypeNode(elements: readonly (TypeNode | NamedTupleMember)[]) {
        const node = checkedCompilerLayout(createBaseNode<TupleTypeNode>(SyntaxKind.TupleType), checked_isTupleTypeNode);
        node.elements = createNodeArray(parenthesizerRules().parenthesizeElementTypesOfTupleType(elements));
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTupleTypeNode(node: TupleTypeNode, elements: readonly (TypeNode | NamedTupleMember)[]) {
        return node.elements !== elements
            ? update(createTupleTypeNode(elements), node)
            : node;
    }
    // @api
    function createNamedTupleMember(dotDotDotToken: DotDotDotToken | undefined, name: Identifier, questionToken: QuestionToken | undefined, type: TypeNode) {
        const node = checkedCompilerLayout(createBaseDeclaration<NamedTupleMember>(SyntaxKind.NamedTupleMember), checked_isNamedTupleMember);
        node.dotDotDotToken = dotDotDotToken;
        node.name = name;
        node.questionToken = questionToken;
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateNamedTupleMember(node: NamedTupleMember, dotDotDotToken: DotDotDotToken | undefined, name: Identifier, questionToken: QuestionToken | undefined, type: TypeNode) {
        return node.dotDotDotToken !== dotDotDotToken
            || node.name !== name
            || node.questionToken !== questionToken
            || node.type !== type
            ? update(createNamedTupleMember(dotDotDotToken, name, questionToken, type), node)
            : node;
    }
    // @api
    function createOptionalTypeNode(type: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<OptionalTypeNode>(SyntaxKind.OptionalType), checked_isOptionalTypeNode);
        node.type = parenthesizerRules().parenthesizeTypeOfOptionalType(type);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateOptionalTypeNode(node: OptionalTypeNode, type: TypeNode): OptionalTypeNode {
        return node.type !== type
            ? update(createOptionalTypeNode(type), node)
            : node;
    }
    // @api
    function createRestTypeNode(type: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<RestTypeNode>(SyntaxKind.RestType), checked_isRestTypeNode);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateRestTypeNode(node: RestTypeNode, type: TypeNode): RestTypeNode {
        return node.type !== type
            ? update(createRestTypeNode(type), node)
            : node;
    }
    function createUnionOrIntersectionTypeNode(kind: typeof SyntaxKind.UnionType | typeof SyntaxKind.IntersectionType, types: readonly TypeNode[], parenthesize: (nodes: readonly TypeNode[]) => readonly TypeNode[]) {
        const node = requireFactoryNodeKind(createBaseNode<UnionTypeNode | IntersectionTypeNode>(kind), kind);
        node.types = factory.createNodeArray(parenthesize(types));
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    function updateUnionOrIntersectionTypeNode(node: UnionTypeNode, types: NodeArray<TypeNode>, parenthesize: (nodes: readonly TypeNode[]) => readonly TypeNode[]): UnionTypeNode;
    function updateUnionOrIntersectionTypeNode(node: IntersectionTypeNode, types: NodeArray<TypeNode>, parenthesize: (nodes: readonly TypeNode[]) => readonly TypeNode[]): IntersectionTypeNode;
    function updateUnionOrIntersectionTypeNode(node: UnionOrIntersectionTypeNode, types: NodeArray<TypeNode>, parenthesize: (nodes: readonly TypeNode[]) => readonly TypeNode[]): UnionOrIntersectionTypeNode {
        return node.types !== types
            ? update(createUnionOrIntersectionTypeNode(node.kind, types, parenthesize), node)
            : node;
    }
    // @api
    function createUnionTypeNode(types: readonly TypeNode[]): UnionTypeNode {
        return checkedCompilerLayout(createUnionOrIntersectionTypeNode(SyntaxKind.UnionType, types, parenthesizerRules().parenthesizeConstituentTypesOfUnionType), checked_isUnionTypeNode);
    }
    // @api
    function updateUnionTypeNode(node: UnionTypeNode, types: NodeArray<TypeNode>) {
        return updateUnionOrIntersectionTypeNode(node, types, parenthesizerRules().parenthesizeConstituentTypesOfUnionType);
    }
    // @api
    function createIntersectionTypeNode(types: readonly TypeNode[]): IntersectionTypeNode {
        return checkedCompilerLayout(createUnionOrIntersectionTypeNode(SyntaxKind.IntersectionType, types, parenthesizerRules().parenthesizeConstituentTypesOfIntersectionType), checked_isIntersectionTypeNode);
    }
    // @api
    function updateIntersectionTypeNode(node: IntersectionTypeNode, types: NodeArray<TypeNode>) {
        return updateUnionOrIntersectionTypeNode(node, types, parenthesizerRules().parenthesizeConstituentTypesOfIntersectionType);
    }
    // @api
    function createConditionalTypeNode(checkType: TypeNode, extendsType: TypeNode, trueType: TypeNode, falseType: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<ConditionalTypeNode>(SyntaxKind.ConditionalType), checked_isConditionalTypeNode);
        node.checkType = parenthesizerRules().parenthesizeCheckTypeOfConditionalType(checkType);
        node.extendsType = parenthesizerRules().parenthesizeExtendsTypeOfConditionalType(extendsType);
        node.trueType = trueType;
        node.falseType = falseType;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateConditionalTypeNode(node: ConditionalTypeNode, checkType: TypeNode, extendsType: TypeNode, trueType: TypeNode, falseType: TypeNode) {
        return node.checkType !== checkType
            || node.extendsType !== extendsType
            || node.trueType !== trueType
            || node.falseType !== falseType
            ? update(createConditionalTypeNode(checkType, extendsType, trueType, falseType), node)
            : node;
    }
    // @api
    function createInferTypeNode(typeParameter: TypeParameterDeclaration) {
        const node = checkedCompilerLayout(createBaseNode<InferTypeNode>(SyntaxKind.InferType), checked_isInferTypeNode);
        node.typeParameter = typeParameter;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateInferTypeNode(node: InferTypeNode, typeParameter: TypeParameterDeclaration) {
        return node.typeParameter !== typeParameter
            ? update(createInferTypeNode(typeParameter), node)
            : node;
    }
    // @api
    function createTemplateLiteralType(head: TemplateHead, templateSpans: readonly TemplateLiteralTypeSpan[]) {
        const node = checkedCompilerLayout(createBaseNode<TemplateLiteralTypeNode>(SyntaxKind.TemplateLiteralType), checked_isTemplateLiteralTypeNode);
        node.head = head;
        node.templateSpans = createNodeArray(templateSpans);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTemplateLiteralType(node: TemplateLiteralTypeNode, head: TemplateHead, templateSpans: readonly TemplateLiteralTypeSpan[]) {
        return node.head !== head
            || node.templateSpans !== templateSpans
            ? update(createTemplateLiteralType(head, templateSpans), node)
            : node;
    }
    // @api
    function createImportTypeNode(argument: TypeNode, attributes?: ImportAttributes, qualifier?: EntityName, typeArguments?: readonly TypeNode[], isTypeOf = false): ImportTypeNode {
        const node = checkedCompilerLayout(createBaseNode<ImportTypeNode>(SyntaxKind.ImportType), checked_isImportTypeNode);
        node.argument = argument;
        node.attributes = attributes;
        if (node.assertions && node.assertions.assertClause && node.attributes) {
            (node.assertions).assertClause = node.attributes;
        }
        node.qualifier = qualifier;
        node.typeArguments = typeArguments && parenthesizerRules().parenthesizeTypeArguments(typeArguments);
        node.isTypeOf = isTypeOf;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateImportTypeNode(node: ImportTypeNode, argument: TypeNode, attributes: ImportAttributes | undefined, qualifier: EntityName | undefined, typeArguments: readonly TypeNode[] | undefined, isTypeOf: boolean = node.isTypeOf): ImportTypeNode {
        return node.argument !== argument
            || node.attributes !== attributes
            || node.qualifier !== qualifier
            || node.typeArguments !== typeArguments
            || node.isTypeOf !== isTypeOf
            ? update(createImportTypeNode(argument, attributes, qualifier, typeArguments, isTypeOf), node)
            : node;
    }
    // @api
    function createParenthesizedType(type: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<ParenthesizedTypeNode>(SyntaxKind.ParenthesizedType), checked_isParenthesizedTypeNode);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateParenthesizedType(node: ParenthesizedTypeNode, type: TypeNode) {
        return node.type !== type
            ? update(createParenthesizedType(type), node)
            : node;
    }
    // @api
    function createThisTypeNode() {
        const node = checkedCompilerLayout(createBaseNode<ThisTypeNode>(SyntaxKind.ThisType), checked_isThisTypeNode);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function createTypeOperatorNode(operator: typeof SyntaxKind.KeyOfKeyword | typeof SyntaxKind.UniqueKeyword | typeof SyntaxKind.ReadonlyKeyword, type: TypeNode): TypeOperatorNode {
        const node = checkedCompilerLayout(createBaseNode<TypeOperatorNode>(SyntaxKind.TypeOperator), checked_isTypeOperatorNode);
        node.operator = operator;
        node.type = operator === SyntaxKind.ReadonlyKeyword ?
            parenthesizerRules().parenthesizeOperandOfReadonlyTypeOperator(type) :
            parenthesizerRules().parenthesizeOperandOfTypeOperator(type);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTypeOperatorNode(node: TypeOperatorNode, type: TypeNode) {
        return node.type !== type
            ? update(createTypeOperatorNode(node.operator, type), node)
            : node;
    }
    // @api
    function createIndexedAccessTypeNode(objectType: TypeNode, indexType: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<IndexedAccessTypeNode>(SyntaxKind.IndexedAccessType), checked_isIndexedAccessTypeNode);
        node.objectType = parenthesizerRules().parenthesizeNonArrayTypeOfPostfixType(objectType);
        node.indexType = indexType;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateIndexedAccessTypeNode(node: IndexedAccessTypeNode, objectType: TypeNode, indexType: TypeNode) {
        return node.objectType !== objectType
            || node.indexType !== indexType
            ? update(createIndexedAccessTypeNode(objectType, indexType), node)
            : node;
    }
    // @api
    function createMappedTypeNode(readonlyToken: ReadonlyKeyword | PlusToken | MinusToken | undefined, typeParameter: TypeParameterDeclaration, nameType: TypeNode | undefined, questionToken: QuestionToken | PlusToken | MinusToken | undefined, type: TypeNode | undefined, members: readonly TypeElement[] | undefined): MappedTypeNode {
        const node = checkedCompilerLayout(createBaseDeclaration<MappedTypeNode>(SyntaxKind.MappedType), checked_isMappedTypeNode);
        node.readonlyToken = readonlyToken;
        node.typeParameter = typeParameter;
        node.nameType = nameType;
        node.questionToken = questionToken;
        node.type = type;
        node.members = members && createNodeArray(members);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateMappedTypeNode(node: MappedTypeNode, readonlyToken: ReadonlyKeyword | PlusToken | MinusToken | undefined, typeParameter: TypeParameterDeclaration, nameType: TypeNode | undefined, questionToken: QuestionToken | PlusToken | MinusToken | undefined, type: TypeNode | undefined, members: readonly TypeElement[] | undefined): MappedTypeNode {
        return node.readonlyToken !== readonlyToken
            || node.typeParameter !== typeParameter
            || node.nameType !== nameType
            || node.questionToken !== questionToken
            || node.type !== type
            || node.members !== members
            ? update(createMappedTypeNode(readonlyToken, typeParameter, nameType, questionToken, type, members), node)
            : node;
    }
    // @api
    function createLiteralTypeNode(literal: LiteralTypeNode["literal"]) {
        const node = checkedCompilerLayout(createBaseNode<LiteralTypeNode>(SyntaxKind.LiteralType), checked_isLiteralTypeNode);
        node.literal = literal;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateLiteralTypeNode(node: LiteralTypeNode, literal: LiteralTypeNode["literal"]) {
        return node.literal !== literal
            ? update(createLiteralTypeNode(literal), node)
            : node;
    }
    //
    // Binding Patterns
    //
    // @api
    function createObjectBindingPattern(elements: readonly BindingElement[]) {
        const node = checkedCompilerLayout(createBaseNode<ObjectBindingPattern>(SyntaxKind.ObjectBindingPattern), checked_isObjectBindingPattern);
        node.elements = createNodeArray(elements);
        node.transformFlags |= propagateChildrenFlags(node.elements) |
            TransformFlags.ContainsES2015 |
            TransformFlags.ContainsBindingPattern;
        if (node.transformFlags & TransformFlags.ContainsRestOrSpread) {
            node.transformFlags |= TransformFlags.ContainsES2018 |
                TransformFlags.ContainsObjectRestOrSpread;
        }
        return node;
    }
    // @api
    function updateObjectBindingPattern(node: ObjectBindingPattern, elements: readonly BindingElement[]) {
        return node.elements !== elements
            ? update(createObjectBindingPattern(elements), node)
            : node;
    }
    // @api
    function createArrayBindingPattern(elements: readonly ArrayBindingElement[]) {
        const node = checkedCompilerLayout(createBaseNode<ArrayBindingPattern>(SyntaxKind.ArrayBindingPattern), checked_isArrayBindingPattern);
        node.elements = createNodeArray(elements);
        node.transformFlags |= propagateChildrenFlags(node.elements) |
            TransformFlags.ContainsES2015 |
            TransformFlags.ContainsBindingPattern;
        return node;
    }
    // @api
    function updateArrayBindingPattern(node: ArrayBindingPattern, elements: readonly ArrayBindingElement[]) {
        return node.elements !== elements
            ? update(createArrayBindingPattern(elements), node)
            : node;
    }
    // @api
    function createBindingElement(dotDotDotToken: DotDotDotToken | undefined, propertyName: string | PropertyName | undefined, name: string | BindingName, initializer?: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<BindingElement>(SyntaxKind.BindingElement), checked_isBindingElement);
        node.dotDotDotToken = dotDotDotToken;
        node.propertyName = asName(propertyName);
        node.name = asName(name);
        node.initializer = asInitializer(initializer);
        node.transformFlags |= propagateChildFlags(node.dotDotDotToken) |
            propagateNameFlags(node.propertyName) |
            propagateNameFlags(node.name) |
            propagateChildFlags(node.initializer) |
            (node.dotDotDotToken ? TransformFlags.ContainsRestOrSpread : TransformFlags.None) |
            TransformFlags.ContainsES2015;
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateBindingElement(node: BindingElement, dotDotDotToken: DotDotDotToken | undefined, propertyName: PropertyName | undefined, name: BindingName, initializer: Expression | undefined) {
        return node.propertyName !== propertyName
            || node.dotDotDotToken !== dotDotDotToken
            || node.name !== name
            || node.initializer !== initializer
            ? update(createBindingElement(dotDotDotToken, propertyName, name, initializer), node)
            : node;
    }
    //
    // Expression
    //
    // @api
    function createArrayLiteralExpression(elements?: readonly Expression[], multiLine?: boolean) {
        const node = checkedCompilerLayout(createBaseNode<ArrayLiteralExpression>(SyntaxKind.ArrayLiteralExpression), checked_isArrayLiteralExpression);
        // Ensure we add a trailing comma for something like `[NumericLiteral(1), NumericLiteral(2), OmittedExpresion]` so that
        // we end up with `[1, 2, ,]` instead of `[1, 2, ]` otherwise the `OmittedExpression` will just end up being treated like
        // a trailing comma.
        const lastElement = elements && lastOrUndefined(elements);
        const elementsArray = createNodeArray(elements, lastElement && isOmittedExpression(lastElement) ? true : undefined);
        node.elements = parenthesizerRules().parenthesizeExpressionsOfCommaDelimitedList(elementsArray);
        node.multiLine = multiLine;
        node.transformFlags |= propagateChildrenFlags(node.elements);
        return node;
    }
    // @api
    function updateArrayLiteralExpression(node: ArrayLiteralExpression, elements: readonly Expression[]) {
        return node.elements !== elements
            ? update(createArrayLiteralExpression(elements, node.multiLine), node)
            : node;
    }
    // @api
    function createObjectLiteralExpression(properties?: readonly ObjectLiteralElementLike[], multiLine?: boolean) {
        const node = checkedCompilerLayout(createBaseDeclaration<ObjectLiteralExpression>(SyntaxKind.ObjectLiteralExpression), checked_isObjectLiteralExpression);
        node.properties = createNodeArray(properties);
        node.multiLine = multiLine;
        node.transformFlags |= propagateChildrenFlags(node.properties);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateObjectLiteralExpression(node: ObjectLiteralExpression, properties: readonly ObjectLiteralElementLike[]) {
        return node.properties !== properties
            ? update(createObjectLiteralExpression(properties, node.multiLine), node)
            : node;
    }
    function createBasePropertyAccessExpression(expression: LeftHandSideExpression, questionDotToken: QuestionDotToken | undefined, name: MemberName) {
        const node = checkedCompilerLayout(createBaseDeclaration<PropertyAccessExpression>(SyntaxKind.PropertyAccessExpression), checked_isPropertyAccessExpression);
        node.expression = expression;
        node.questionDotToken = questionDotToken;
        node.name = name;
        node.transformFlags = propagateChildFlags(node.expression) |
            propagateChildFlags(node.questionDotToken) |
            (isIdentifier(node.name) ?
                propagateIdentifierNameFlags(node.name) :
                propagateChildFlags(node.name) | TransformFlags.ContainsPrivateIdentifierInExpression);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function createPropertyAccessExpression(expression: Expression, name: string | Identifier | PrivateIdentifier) {
        const node = createBasePropertyAccessExpression(parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false), 
        /*questionDotToken*/ undefined, asName(name));
        if (isSuperKeyword(expression)) {
            // super method calls require a lexical 'this'
            // super method calls require 'super' hoisting in ES2017 and ES2018 async functions and async generators
            node.transformFlags |= TransformFlags.ContainsES2017 |
                TransformFlags.ContainsES2018;
        }
        return node;
    }
    // @api
    function updatePropertyAccessExpression(node: PropertyAccessExpression, expression: Expression, name: Identifier | PrivateIdentifier) {
        if (isPropertyAccessChain(node)) {
            return updatePropertyAccessChain(node, expression, node.questionDotToken, cast(name, isIdentifier));
        }
        return node.expression !== expression
            || node.name !== name
            ? update(createPropertyAccessExpression(expression, name), node)
            : node;
    }
    // @api
    function createPropertyAccessChain(expression: Expression, questionDotToken: QuestionDotToken | undefined, name: string | Identifier | PrivateIdentifier) {
        const node = createBasePropertyAccessExpression(parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ true), questionDotToken, asName(name));
        node.flags |= NodeFlags.OptionalChain;
        node.transformFlags |= TransformFlags.ContainsES2020;
        return node;
    }
    // @api
    function updatePropertyAccessChain(node: PropertyAccessChain, expression: Expression, questionDotToken: QuestionDotToken | undefined, name: Identifier | PrivateIdentifier) {
        Debug.assert(!!(node.flags & NodeFlags.OptionalChain), "Cannot update a PropertyAccessExpression using updatePropertyAccessChain. Use updatePropertyAccess instead.");
        // Because we are updating an existing PropertyAccessChain we want to inherit its emitFlags
        // instead of using the default from createPropertyAccess
        return node.expression !== expression
            || node.questionDotToken !== questionDotToken
            || node.name !== name
            ? update(createPropertyAccessChain(expression, questionDotToken, name), node)
            : node;
    }
    function createBaseElementAccessExpression(expression: LeftHandSideExpression, questionDotToken: QuestionDotToken | undefined, argumentExpression: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<ElementAccessExpression>(SyntaxKind.ElementAccessExpression), checked_isElementAccessExpression);
        node.expression = expression;
        node.questionDotToken = questionDotToken;
        node.argumentExpression = argumentExpression;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.questionDotToken) |
            propagateChildFlags(node.argumentExpression);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function createElementAccessExpression(expression: Expression, index: number | Expression) {
        const node = createBaseElementAccessExpression(parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false), 
        /*questionDotToken*/ undefined, asExpression(index));
        if (isSuperKeyword(expression)) {
            // super method calls require a lexical 'this'
            // super method calls require 'super' hoisting in ES2017 and ES2018 async functions and async generators
            node.transformFlags |= TransformFlags.ContainsES2017 |
                TransformFlags.ContainsES2018;
        }
        return node;
    }
    // @api
    function updateElementAccessExpression(node: ElementAccessExpression, expression: Expression, argumentExpression: Expression) {
        if (isElementAccessChain(node)) {
            return updateElementAccessChain(node, expression, node.questionDotToken, argumentExpression);
        }
        return node.expression !== expression
            || node.argumentExpression !== argumentExpression
            ? update(createElementAccessExpression(expression, argumentExpression), node)
            : node;
    }
    // @api
    function createElementAccessChain(expression: Expression, questionDotToken: QuestionDotToken | undefined, index: number | Expression) {
        const node = createBaseElementAccessExpression(parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ true), questionDotToken, asExpression(index));
        node.flags |= NodeFlags.OptionalChain;
        node.transformFlags |= TransformFlags.ContainsES2020;
        return node;
    }
    // @api
    function updateElementAccessChain(node: ElementAccessChain, expression: Expression, questionDotToken: QuestionDotToken | undefined, argumentExpression: Expression) {
        Debug.assert(!!(node.flags & NodeFlags.OptionalChain), "Cannot update a ElementAccessExpression using updateElementAccessChain. Use updateElementAccess instead.");
        // Because we are updating an existing ElementAccessChain we want to inherit its emitFlags
        // instead of using the default from createElementAccess
        return node.expression !== expression
            || node.questionDotToken !== questionDotToken
            || node.argumentExpression !== argumentExpression
            ? update(createElementAccessChain(expression, questionDotToken, argumentExpression), node)
            : node;
    }
    function createBaseCallExpression(expression: LeftHandSideExpression, questionDotToken: QuestionDotToken | undefined, typeArguments: NodeArray<TypeNode> | undefined, argumentsArray: NodeArray<Expression>) {
        const node = checkedCompilerLayout(createBaseDeclaration<CallExpression>(SyntaxKind.CallExpression), checked_isCallExpression);
        node.expression = expression;
        node.questionDotToken = questionDotToken;
        node.typeArguments = typeArguments;
        node.arguments = argumentsArray;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.questionDotToken) |
            propagateChildrenFlags(node.typeArguments) |
            propagateChildrenFlags(node.arguments);
        if (node.typeArguments) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        if (isSuperProperty(node.expression)) {
            node.transformFlags |= TransformFlags.ContainsLexicalThis;
        }
        return node;
    }
    // @api
    function createCallExpression(expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined) {
        const node = createBaseCallExpression(parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false), 
        /*questionDotToken*/ undefined, asNodeArray(typeArguments), parenthesizerRules().parenthesizeExpressionsOfCommaDelimitedList(createNodeArray(argumentsArray)));
        if (isImportKeyword(node.expression)) {
            node.transformFlags |= TransformFlags.ContainsDynamicImport;
        }
        return node;
    }
    // @api
    function updateCallExpression(node: CallExpression, expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[]) {
        if (isCallChain(node)) {
            return updateCallChain(node, expression, node.questionDotToken, typeArguments, argumentsArray);
        }
        return node.expression !== expression
            || node.typeArguments !== typeArguments
            || node.arguments !== argumentsArray
            ? update(createCallExpression(expression, typeArguments, argumentsArray), node)
            : node;
    }
    // @api
    function createCallChain(expression: Expression, questionDotToken: QuestionDotToken | undefined, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined) {
        const node = createBaseCallExpression(parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ true), questionDotToken, asNodeArray(typeArguments), parenthesizerRules().parenthesizeExpressionsOfCommaDelimitedList(createNodeArray(argumentsArray)));
        node.flags |= NodeFlags.OptionalChain;
        node.transformFlags |= TransformFlags.ContainsES2020;
        return node;
    }
    // @api
    function updateCallChain(node: CallChain, expression: Expression, questionDotToken: QuestionDotToken | undefined, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[]) {
        Debug.assert(!!(node.flags & NodeFlags.OptionalChain), "Cannot update a CallExpression using updateCallChain. Use updateCall instead.");
        return node.expression !== expression
            || node.questionDotToken !== questionDotToken
            || node.typeArguments !== typeArguments
            || node.arguments !== argumentsArray
            ? update(createCallChain(expression, questionDotToken, typeArguments, argumentsArray), node)
            : node;
    }
    // @api
    function createNewExpression(expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<NewExpression>(SyntaxKind.NewExpression), checked_isNewExpression);
        node.expression = parenthesizerRules().parenthesizeExpressionOfNew(expression);
        node.typeArguments = asNodeArray(typeArguments);
        node.arguments = argumentsArray ? parenthesizerRules().parenthesizeExpressionsOfCommaDelimitedList(argumentsArray) : undefined;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildrenFlags(node.typeArguments) |
            propagateChildrenFlags(node.arguments) |
            TransformFlags.ContainsES2020;
        if (node.typeArguments) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        return node;
    }
    // @api
    function updateNewExpression(node: NewExpression, expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined) {
        return node.expression !== expression
            || node.typeArguments !== typeArguments
            || node.arguments !== argumentsArray
            ? update(createNewExpression(expression, typeArguments, argumentsArray), node)
            : node;
    }
    // @api
    function createTaggedTemplateExpression(tag: Expression, typeArguments: readonly TypeNode[] | undefined, template: TemplateLiteral) {
        const node = checkedCompilerLayout(createBaseNode<TaggedTemplateExpression>(SyntaxKind.TaggedTemplateExpression), checked_isTaggedTemplateExpression);
        node.tag = parenthesizerRules().parenthesizeLeftSideOfAccess(tag, /*optionalChain*/ false);
        node.typeArguments = asNodeArray(typeArguments);
        node.template = template;
        node.transformFlags |= propagateChildFlags(node.tag) |
            propagateChildrenFlags(node.typeArguments) |
            propagateChildFlags(node.template) |
            TransformFlags.ContainsES2015;
        if (node.typeArguments) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        if (hasInvalidEscape(node.template)) {
            node.transformFlags |= TransformFlags.ContainsES2018;
        }
        return node;
    }
    // @api
    function updateTaggedTemplateExpression(node: TaggedTemplateExpression, tag: Expression, typeArguments: readonly TypeNode[] | undefined, template: TemplateLiteral) {
        return node.tag !== tag
            || node.typeArguments !== typeArguments
            || node.template !== template
            ? update(createTaggedTemplateExpression(tag, typeArguments, template), node)
            : node;
    }
    // @api
    function createTypeAssertion(type: TypeNode, expression: Expression) {
        const node = requireFactoryNodeKind(createBaseNode<TypeAssertion>(SyntaxKind.TypeAssertionExpression), SyntaxKind.TypeAssertionExpression);
        node.expression = parenthesizerRules().parenthesizeOperandOfPrefixUnary(expression);
        node.type = type;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.type) |
            TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateTypeAssertion(node: TypeAssertion, type: TypeNode, expression: Expression) {
        return node.type !== type
            || node.expression !== expression
            ? update(checkedCompilerLayout(createTypeAssertion(type, expression), isNodeLayout_fd49999be36b), node)
            : node;
    }
    // @api
    function createParenthesizedExpression(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<ParenthesizedExpression>(SyntaxKind.ParenthesizedExpression), checked_isParenthesizedExpression);
        node.expression = expression;
        node.transformFlags = propagateChildFlags(node.expression);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateParenthesizedExpression(node: ParenthesizedExpression, expression: Expression) {
        return node.expression !== expression
            ? update(createParenthesizedExpression(expression), node)
            : node;
    }
    // @api
    function createFunctionExpression(modifiers: readonly Modifier[] | undefined, asteriskToken: AsteriskToken | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[] | undefined, type: TypeNode | undefined, body: Block) {
        const node = checkedCompilerLayout(createBaseDeclaration<FunctionExpression>(SyntaxKind.FunctionExpression), checked_isFunctionExpression);
        node.modifiers = asNodeArray(modifiers);
        node.asteriskToken = asteriskToken;
        node.name = asName(name);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = createNodeArray(parameters);
        node.type = type;
        node.body = body;
        const isAsync = modifiersToFlags(node.modifiers) & ModifierFlags.Async;
        const isGenerator = !!node.asteriskToken;
        const isAsyncGenerator = isAsync && isGenerator;
        node.transformFlags = propagateChildrenFlags(node.modifiers) |
            propagateChildFlags(node.asteriskToken) |
            propagateNameFlags(node.name) |
            propagateChildrenFlags(node.typeParameters) |
            propagateChildrenFlags(node.parameters) |
            propagateChildFlags(node.type) |
            (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
            (isAsyncGenerator ? TransformFlags.ContainsES2018 :
                isAsync ? TransformFlags.ContainsES2017 :
                    isGenerator ? TransformFlags.ContainsGenerator :
                        TransformFlags.None) |
            (node.typeParameters || node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
            TransformFlags.ContainsHoistedDeclarationOrCompletion;
        node.typeArguments = undefined; // used in quick info
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateFunctionExpression(node: FunctionExpression, modifiers: readonly Modifier[] | undefined, asteriskToken: AsteriskToken | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block) {
        return node.name !== name
            || node.modifiers !== modifiers
            || node.asteriskToken !== asteriskToken
            || node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            || node.body !== body
            ? finishUpdateBaseSignatureDeclaration(createFunctionExpression(modifiers, asteriskToken, name, typeParameters, parameters, type, body), node)
            : node;
    }
    // @api
    function createArrowFunction(modifiers: readonly Modifier[] | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, equalsGreaterThanToken: EqualsGreaterThanToken | undefined, body: ConciseBody) {
        const node = checkedCompilerLayout(createBaseDeclaration<ArrowFunction>(SyntaxKind.ArrowFunction), checked_isArrowFunction);
        node.modifiers = asNodeArray(modifiers);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = createNodeArray(parameters);
        node.type = type;
        node.equalsGreaterThanToken = equalsGreaterThanToken ?? createToken(SyntaxKind.EqualsGreaterThanToken);
        node.body = parenthesizerRules().parenthesizeConciseBodyOfArrowFunction(body);
        const isAsync = modifiersToFlags(node.modifiers) & ModifierFlags.Async;
        node.transformFlags = propagateChildrenFlags(node.modifiers) |
            propagateChildrenFlags(node.typeParameters) |
            propagateChildrenFlags(node.parameters) |
            propagateChildFlags(node.type) |
            propagateChildFlags(node.equalsGreaterThanToken) |
            (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
            (node.typeParameters || node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
            (isAsync ? TransformFlags.ContainsES2017 | TransformFlags.ContainsLexicalThis : TransformFlags.None) |
            TransformFlags.ContainsES2015;
        node.typeArguments = undefined; // used in quick info
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateArrowFunction(node: ArrowFunction, modifiers: readonly Modifier[] | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, equalsGreaterThanToken: EqualsGreaterThanToken, body: ConciseBody): ArrowFunction {
        return node.modifiers !== modifiers
            || node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            || node.equalsGreaterThanToken !== equalsGreaterThanToken
            || node.body !== body
            ? finishUpdateBaseSignatureDeclaration(createArrowFunction(modifiers, typeParameters, parameters, type, equalsGreaterThanToken, body), node)
            : node;
    }
    // @api
    function createDeleteExpression(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<DeleteExpression>(SyntaxKind.DeleteExpression), checked_isDeleteExpression);
        node.expression = parenthesizerRules().parenthesizeOperandOfPrefixUnary(expression);
        node.transformFlags |= propagateChildFlags(node.expression);
        return node;
    }
    // @api
    function updateDeleteExpression(node: DeleteExpression, expression: Expression) {
        return node.expression !== expression
            ? update(createDeleteExpression(expression), node)
            : node;
    }
    // @api
    function createTypeOfExpression(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<TypeOfExpression>(SyntaxKind.TypeOfExpression), checked_isTypeOfExpression);
        node.expression = parenthesizerRules().parenthesizeOperandOfPrefixUnary(expression);
        node.transformFlags |= propagateChildFlags(node.expression);
        return node;
    }
    // @api
    function updateTypeOfExpression(node: TypeOfExpression, expression: Expression) {
        return node.expression !== expression
            ? update(createTypeOfExpression(expression), node)
            : node;
    }
    // @api
    function createVoidExpression(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<VoidExpression>(SyntaxKind.VoidExpression), checked_isVoidExpression);
        node.expression = parenthesizerRules().parenthesizeOperandOfPrefixUnary(expression);
        node.transformFlags |= propagateChildFlags(node.expression);
        return node;
    }
    // @api
    function updateVoidExpression(node: VoidExpression, expression: Expression) {
        return node.expression !== expression
            ? update(createVoidExpression(expression), node)
            : node;
    }
    // @api
    function createAwaitExpression(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<AwaitExpression>(SyntaxKind.AwaitExpression), checked_isAwaitExpression);
        node.expression = parenthesizerRules().parenthesizeOperandOfPrefixUnary(expression);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsES2017 |
            TransformFlags.ContainsES2018 |
            TransformFlags.ContainsAwait;
        return node;
    }
    // @api
    function updateAwaitExpression(node: AwaitExpression, expression: Expression) {
        return node.expression !== expression
            ? update(createAwaitExpression(expression), node)
            : node;
    }
    // @api
    function createPrefixUnaryExpression(operator: PrefixUnaryOperator, operand: Expression) {
        const node = checkedCompilerLayout(createBaseNode<PrefixUnaryExpression>(SyntaxKind.PrefixUnaryExpression), checked_isPrefixUnaryExpression);
        node.operator = operator;
        node.operand = parenthesizerRules().parenthesizeOperandOfPrefixUnary(operand);
        node.transformFlags |= propagateChildFlags(node.operand);
        // Only set this flag for non-generated identifiers and non-"local" names. See the
        // comment in `visitPreOrPostfixUnaryExpression` in module.ts
        if ((operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) &&
            isIdentifier(node.operand) &&
            !isGeneratedIdentifier(node.operand) &&
            !isLocalName(node.operand)) {
            node.transformFlags |= TransformFlags.ContainsUpdateExpressionForIdentifier;
        }
        return node;
    }
    // @api
    function updatePrefixUnaryExpression(node: PrefixUnaryExpression, operand: Expression) {
        return node.operand !== operand
            ? update(createPrefixUnaryExpression(node.operator, operand), node)
            : node;
    }
    // @api
    function createPostfixUnaryExpression(operand: Expression, operator: PostfixUnaryOperator) {
        const node = checkedCompilerLayout(createBaseNode<PostfixUnaryExpression>(SyntaxKind.PostfixUnaryExpression), checked_isPostfixUnaryExpression);
        node.operator = operator;
        node.operand = parenthesizerRules().parenthesizeOperandOfPostfixUnary(operand);
        node.transformFlags |= propagateChildFlags(node.operand);
        // Only set this flag for non-generated identifiers and non-"local" names. See the
        // comment in `visitPreOrPostfixUnaryExpression` in module.ts
        if (isIdentifier(node.operand) &&
            !isGeneratedIdentifier(node.operand) &&
            !isLocalName(node.operand)) {
            node.transformFlags |= TransformFlags.ContainsUpdateExpressionForIdentifier;
        }
        return node;
    }
    // @api
    function updatePostfixUnaryExpression(node: PostfixUnaryExpression, operand: Expression) {
        return node.operand !== operand
            ? update(createPostfixUnaryExpression(operand, node.operator), node)
            : node;
    }
    // @api
    function createBinaryExpression(left: Expression, operator: BinaryOperator | BinaryOperatorToken, right: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<BinaryExpression>(SyntaxKind.BinaryExpression), checked_isBinaryExpression);
        const operatorToken = asToken(operator);
        const operatorKind = operatorToken.kind;
        node.left = parenthesizerRules().parenthesizeLeftSideOfBinary(operatorKind, left);
        node.operatorToken = operatorToken;
        node.right = parenthesizerRules().parenthesizeRightSideOfBinary(operatorKind, node.left, right);
        node.transformFlags |= propagateChildFlags(node.left) |
            propagateChildFlags(node.operatorToken) |
            propagateChildFlags(node.right);
        if (operatorKind === SyntaxKind.QuestionQuestionToken) {
            node.transformFlags |= TransformFlags.ContainsES2020;
        }
        else if (operatorKind === SyntaxKind.EqualsToken) {
            if (isObjectLiteralExpression(node.left)) {
                node.transformFlags |= TransformFlags.ContainsES2015 |
                    TransformFlags.ContainsES2018 |
                    TransformFlags.ContainsDestructuringAssignment |
                    propagateAssignmentPatternFlags(node.left);
            }
            else if (isArrayLiteralExpression(node.left)) {
                node.transformFlags |= TransformFlags.ContainsES2015 |
                    TransformFlags.ContainsDestructuringAssignment |
                    propagateAssignmentPatternFlags(node.left);
            }
        }
        else if (operatorKind === SyntaxKind.AsteriskAsteriskToken || operatorKind === SyntaxKind.AsteriskAsteriskEqualsToken) {
            node.transformFlags |= TransformFlags.ContainsES2016;
        }
        else if (isLogicalOrCoalescingAssignmentOperator(operatorKind)) {
            node.transformFlags |= TransformFlags.ContainsES2021;
        }
        if (operatorKind === SyntaxKind.InKeyword && isPrivateIdentifier(node.left)) {
            node.transformFlags |= TransformFlags.ContainsPrivateIdentifierInExpression;
        }
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    function propagateAssignmentPatternFlags(node: AssignmentPattern): TransformFlags {
        return containsObjectRestOrSpread(node) ? TransformFlags.ContainsObjectRestOrSpread : TransformFlags.None;
    }
    // @api
    function updateBinaryExpression(node: BinaryExpression, left: Expression, operator: BinaryOperatorToken, right: Expression) {
        return node.left !== left
            || node.operatorToken !== operator
            || node.right !== right
            ? update(createBinaryExpression(left, operator, right), node)
            : node;
    }
    // @api
    function createConditionalExpression(condition: Expression, questionToken: QuestionToken | undefined, whenTrue: Expression, colonToken: ColonToken | undefined, whenFalse: Expression) {
        const node = checkedCompilerLayout(createBaseNode<ConditionalExpression>(SyntaxKind.ConditionalExpression), checked_isConditionalExpression);
        node.condition = parenthesizerRules().parenthesizeConditionOfConditionalExpression(condition);
        node.questionToken = questionToken ?? createToken(SyntaxKind.QuestionToken);
        node.whenTrue = parenthesizerRules().parenthesizeBranchOfConditionalExpression(whenTrue);
        node.colonToken = colonToken ?? createToken(SyntaxKind.ColonToken);
        node.whenFalse = parenthesizerRules().parenthesizeBranchOfConditionalExpression(whenFalse);
        node.transformFlags |= propagateChildFlags(node.condition) |
            propagateChildFlags(node.questionToken) |
            propagateChildFlags(node.whenTrue) |
            propagateChildFlags(node.colonToken) |
            propagateChildFlags(node.whenFalse);
        node.flowNodeWhenFalse = undefined;
        node.flowNodeWhenTrue = undefined;
        return node;
    }
    // @api
    function updateConditionalExpression(node: ConditionalExpression, condition: Expression, questionToken: Token<typeof SyntaxKind.QuestionToken>, whenTrue: Expression, colonToken: Token<typeof SyntaxKind.ColonToken>, whenFalse: Expression): ConditionalExpression {
        return node.condition !== condition
            || node.questionToken !== questionToken
            || node.whenTrue !== whenTrue
            || node.colonToken !== colonToken
            || node.whenFalse !== whenFalse
            ? update(createConditionalExpression(condition, questionToken, whenTrue, colonToken, whenFalse), node)
            : node;
    }
    // @api
    function createTemplateExpression(head: TemplateHead, templateSpans: readonly TemplateSpan[]) {
        const node = checkedCompilerLayout(createBaseNode<TemplateExpression>(SyntaxKind.TemplateExpression), checked_isTemplateExpression);
        node.head = head;
        node.templateSpans = createNodeArray(templateSpans);
        node.transformFlags |= propagateChildFlags(node.head) |
            propagateChildrenFlags(node.templateSpans) |
            TransformFlags.ContainsES2015;
        return node;
    }
    // @api
    function updateTemplateExpression(node: TemplateExpression, head: TemplateHead, templateSpans: readonly TemplateSpan[]) {
        return node.head !== head
            || node.templateSpans !== templateSpans
            ? update(createTemplateExpression(head, templateSpans), node)
            : node;
    }
    function checkTemplateLiteralLikeNode(kind: TemplateLiteralToken["kind"], text: string | undefined, rawText: string | undefined, templateFlags: TokenFlags = TokenFlags.None) {
        Debug.assert(!(templateFlags & ~TokenFlags.TemplateLiteralLikeFlags), "Unsupported template flags.");
        // NOTE: without the assignment to `undefined`, we don't narrow the initial type of `cooked`.
        // eslint-disable-next-line no-undef-init
        let cooked: string | object | undefined = undefined;
        if (rawText !== undefined && rawText !== text) {
            cooked = getCookedText(kind, rawText);
            if (typeof cooked === "object") {
                return Debug.fail("Invalid raw text");
            }
        }
        if (text === undefined) {
            if (cooked === undefined) {
                return Debug.fail("Arguments 'text' and 'rawText' may not both be undefined.");
            }
            text = cooked;
        }
        else if (cooked !== undefined) {
            Debug.assert(text === cooked, "Expected argument 'text' to be the normalized (i.e. 'cooked') version of argument 'rawText'.");
        }
        return text;
    }
    function getTransformFlagsOfTemplateLiteralLike(templateFlags: TokenFlags) {
        let transformFlags: TransformFlags = TransformFlags.ContainsES2015;
        if (templateFlags) {
            transformFlags |= TransformFlags.ContainsES2018;
        }
        return transformFlags;
    }
    // NOTE: `createTemplateLiteralLikeToken` and `createTemplateLiteralLikeDeclaration` are identical except for
    //       the underlying nodes they create. To avoid polymorphism due to two different node shapes, these
    //       functions are intentionally duplicated.
    function createTemplateLiteralLikeToken(kind: TemplateLiteralToken["kind"], text: string, rawText: string | undefined, templateFlags: TokenFlags | undefined) {
        const node = requireFactoryNodeKind(createBaseToken<TemplateLiteralLikeNode>(kind), kind);
        node.text = text;
        node.rawText = rawText;
        node.templateFlags = Number(templateFlags) & TokenFlags.TemplateLiteralLikeFlags;
        node.transformFlags = getTransformFlagsOfTemplateLiteralLike(node.templateFlags);
        return node;
    }
    function createTemplateLiteralLikeDeclaration(kind: typeof SyntaxKind.NoSubstitutionTemplateLiteral, text: string, rawText: string | undefined, templateFlags: TokenFlags | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<NoSubstitutionTemplateLiteral>(kind), checked_isNoSubstitutionTemplateLiteral);
        node.text = text;
        node.rawText = rawText;
        node.templateFlags = Number(templateFlags) & TokenFlags.TemplateLiteralLikeFlags;
        node.transformFlags = getTransformFlagsOfTemplateLiteralLike(node.templateFlags);
        return node;
    }
    // @api
    function createTemplateLiteralLikeNode(kind: TemplateLiteralToken["kind"], text: string, rawText: string | undefined, templateFlags: TokenFlags | undefined) {
        if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
            return createTemplateLiteralLikeDeclaration(kind, text, rawText, templateFlags);
        }
        return createTemplateLiteralLikeToken(kind, text, rawText, templateFlags);
    }
    // @api
    function createTemplateHead(text: string | undefined, rawText?: string, templateFlags?: TokenFlags) {
        text = checkTemplateLiteralLikeNode(SyntaxKind.TemplateHead, text, rawText, templateFlags);
        return checkedCompilerLayout(createTemplateLiteralLikeNode(SyntaxKind.TemplateHead, text, rawText, templateFlags), checked_isTemplateHead);
    }
    // @api
    function createTemplateMiddle(text: string | undefined, rawText?: string, templateFlags?: TokenFlags) {
        text = checkTemplateLiteralLikeNode(SyntaxKind.TemplateHead, text, rawText, templateFlags);
        return checkedCompilerLayout(createTemplateLiteralLikeNode(SyntaxKind.TemplateMiddle, text, rawText, templateFlags), checked_isTemplateMiddle);
    }
    // @api
    function createTemplateTail(text: string | undefined, rawText?: string, templateFlags?: TokenFlags) {
        text = checkTemplateLiteralLikeNode(SyntaxKind.TemplateHead, text, rawText, templateFlags);
        return checkedCompilerLayout(createTemplateLiteralLikeNode(SyntaxKind.TemplateTail, text, rawText, templateFlags), checked_isTemplateTail);
    }
    // @api
    function createNoSubstitutionTemplateLiteral(text: string | undefined, rawText?: string, templateFlags?: TokenFlags) {
        text = checkTemplateLiteralLikeNode(SyntaxKind.TemplateHead, text, rawText, templateFlags);
        return createTemplateLiteralLikeDeclaration(SyntaxKind.NoSubstitutionTemplateLiteral, text, rawText, templateFlags);
    }
    // @api
    function createYieldExpression(asteriskToken: AsteriskToken | undefined, expression: Expression | undefined): YieldExpression {
        Debug.assert(!asteriskToken || !!expression, "A `YieldExpression` with an asteriskToken must have an expression.");
        const node = checkedCompilerLayout(createBaseNode<YieldExpression>(SyntaxKind.YieldExpression), checked_isYieldExpression);
        node.expression = expression && parenthesizerRules().parenthesizeExpressionForDisallowedComma(expression);
        node.asteriskToken = asteriskToken;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.asteriskToken) |
            TransformFlags.ContainsES2015 |
            TransformFlags.ContainsES2018 |
            TransformFlags.ContainsYield;
        return node;
    }
    // @api
    function updateYieldExpression(node: YieldExpression, asteriskToken: AsteriskToken | undefined, expression: Expression) {
        return node.expression !== expression
            || node.asteriskToken !== asteriskToken
            ? update(createYieldExpression(asteriskToken, expression), node)
            : node;
    }
    // @api
    function createSpreadElement(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<SpreadElement>(SyntaxKind.SpreadElement), checked_isSpreadElement);
        node.expression = parenthesizerRules().parenthesizeExpressionForDisallowedComma(expression);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsES2015 |
            TransformFlags.ContainsRestOrSpread;
        return node;
    }
    // @api
    function updateSpreadElement(node: SpreadElement, expression: Expression) {
        return node.expression !== expression
            ? update(createSpreadElement(expression), node)
            : node;
    }
    // @api
    function createClassExpression(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]) {
        const node = checkedCompilerLayout(createBaseDeclaration<ClassExpression>(SyntaxKind.ClassExpression), checked_isClassExpression);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.typeParameters = asNodeArray(typeParameters);
        node.heritageClauses = asNodeArray(heritageClauses);
        node.members = createNodeArray(members);
        node.transformFlags |= propagateChildrenFlags(node.modifiers) |
            propagateNameFlags(node.name) |
            propagateChildrenFlags(node.typeParameters) |
            propagateChildrenFlags(node.heritageClauses) |
            propagateChildrenFlags(node.members) |
            (node.typeParameters ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
            TransformFlags.ContainsES2015;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateClassExpression(node: ClassExpression, modifiers: readonly ModifierLike[] | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.typeParameters !== typeParameters
            || node.heritageClauses !== heritageClauses
            || node.members !== members
            ? update(createClassExpression(modifiers, name, typeParameters, heritageClauses, members), node)
            : node;
    }
    // @api
    function createOmittedExpression() {
        return checkedCompilerLayout(createBaseNode<OmittedExpression>(SyntaxKind.OmittedExpression), checked_isOmittedExpression);
    }
    // @api
    function createExpressionWithTypeArguments(expression: Expression, typeArguments: readonly TypeNode[] | undefined) {
        const node = checkedCompilerLayout(createBaseNode<ExpressionWithTypeArguments>(SyntaxKind.ExpressionWithTypeArguments), checked_isExpressionWithTypeArguments);
        node.expression = parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false);
        node.typeArguments = typeArguments && parenthesizerRules().parenthesizeTypeArguments(typeArguments);
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildrenFlags(node.typeArguments) |
            TransformFlags.ContainsES2015;
        return node;
    }
    // @api
    function updateExpressionWithTypeArguments(node: ExpressionWithTypeArguments, expression: Expression, typeArguments: readonly TypeNode[] | undefined) {
        return node.expression !== expression
            || node.typeArguments !== typeArguments
            ? update(createExpressionWithTypeArguments(expression, typeArguments), node)
            : node;
    }
    // @api
    function createAsExpression(expression: Expression, type: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<AsExpression>(SyntaxKind.AsExpression), checked_isAsExpression);
        node.expression = expression;
        node.type = type;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.type) |
            TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateAsExpression(node: AsExpression, expression: Expression, type: TypeNode) {
        return node.expression !== expression
            || node.type !== type
            ? update(createAsExpression(expression, type), node)
            : node;
    }
    // @api
    function createNonNullExpression(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<NonNullExpression>(SyntaxKind.NonNullExpression), checked_isNonNullExpression);
        node.expression = parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateNonNullExpression(node: NonNullExpression, expression: Expression) {
        if (isNonNullChain(node)) {
            return updateNonNullChain(node, expression);
        }
        return node.expression !== expression
            ? update(createNonNullExpression(expression), node)
            : node;
    }
    // @api
    function createSatisfiesExpression(expression: Expression, type: TypeNode) {
        const node = checkedCompilerLayout(createBaseNode<SatisfiesExpression>(SyntaxKind.SatisfiesExpression), checked_isSatisfiesExpression);
        node.expression = expression;
        node.type = type;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.type) |
            TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateSatisfiesExpression(node: SatisfiesExpression, expression: Expression, type: TypeNode) {
        return node.expression !== expression
            || node.type !== type
            ? update(createSatisfiesExpression(expression, type), node)
            : node;
    }
    // @api
    function createNonNullChain(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<NonNullChain>(SyntaxKind.NonNullExpression), checked_isNonNullChain);
        node.flags |= NodeFlags.OptionalChain;
        node.expression = parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ true);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsTypeScript;
        return node;
    }
    // @api
    function updateNonNullChain(node: NonNullChain, expression: Expression) {
        Debug.assert(!!(node.flags & NodeFlags.OptionalChain), "Cannot update a NonNullExpression using updateNonNullChain. Use updateNonNullExpression instead.");
        return node.expression !== expression
            ? update(createNonNullChain(expression), node)
            : node;
    }
    // @api
    function createMetaProperty(keywordToken: MetaProperty["keywordToken"], name: Identifier) {
        const node = checkedCompilerLayout(createBaseNode<MetaProperty>(SyntaxKind.MetaProperty), checked_isMetaProperty);
        node.keywordToken = keywordToken;
        node.name = name;
        node.transformFlags |= propagateChildFlags(node.name);
        switch (keywordToken) {
            case SyntaxKind.NewKeyword:
                node.transformFlags |= TransformFlags.ContainsES2015;
                break;
            case SyntaxKind.ImportKeyword:
                node.transformFlags |= TransformFlags.ContainsES2020;
                break;
            default:
                return Debug.assertNever(keywordToken);
        }
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateMetaProperty(node: MetaProperty, name: Identifier) {
        return node.name !== name
            ? update(createMetaProperty(node.keywordToken, name), node)
            : node;
    }
    //
    // Misc
    //
    // @api
    function createTemplateSpan(expression: Expression, literal: TemplateMiddle | TemplateTail) {
        const node = checkedCompilerLayout(createBaseNode<TemplateSpan>(SyntaxKind.TemplateSpan), checked_isTemplateSpan);
        node.expression = expression;
        node.literal = literal;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.literal) |
            TransformFlags.ContainsES2015;
        return node;
    }
    // @api
    function updateTemplateSpan(node: TemplateSpan, expression: Expression, literal: TemplateMiddle | TemplateTail) {
        return node.expression !== expression
            || node.literal !== literal
            ? update(createTemplateSpan(expression, literal), node)
            : node;
    }
    // @api
    function createSemicolonClassElement() {
        const node = checkedCompilerLayout(createBaseNode<SemicolonClassElement>(SyntaxKind.SemicolonClassElement), checked_isSemicolonClassElement);
        node.transformFlags |= TransformFlags.ContainsES2015;
        return node;
    }
    //
    // Element
    //
    // @api
    function createBlock(statements: readonly Statement[], multiLine?: boolean): Block {
        const node = checkedCompilerLayout(createBaseNode<Block>(SyntaxKind.Block), checked_isBlock);
        node.statements = createNodeArray(statements);
        node.multiLine = multiLine;
        node.transformFlags |= propagateChildrenFlags(node.statements);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateBlock(node: Block, statements: readonly Statement[]) {
        return node.statements !== statements
            ? update(createBlock(statements, node.multiLine), node)
            : node;
    }
    // @api
    function createVariableStatement(modifiers: readonly ModifierLike[] | undefined, declarationList: VariableDeclarationList | readonly VariableDeclaration[]) {
        const node = checkedCompilerLayout(createBaseNode<VariableStatement>(SyntaxKind.VariableStatement), checked_isVariableStatement);
        node.modifiers = asNodeArray(modifiers);
        node.declarationList = isArray(declarationList) ? createVariableDeclarationList(declarationList) : declarationList;
        node.transformFlags |= propagateChildrenFlags(node.modifiers) |
            propagateChildFlags(node.declarationList);
        if (modifiersToFlags(node.modifiers) & ModifierFlags.Ambient) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateVariableStatement(node: VariableStatement, modifiers: readonly ModifierLike[] | undefined, declarationList: VariableDeclarationList) {
        return node.modifiers !== modifiers
            || node.declarationList !== declarationList
            ? update(createVariableStatement(modifiers, declarationList), node)
            : node;
    }
    // @api
    function createEmptyStatement() {
        const node = checkedCompilerLayout(createBaseNode<EmptyStatement>(SyntaxKind.EmptyStatement), checked_isEmptyStatement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function createExpressionStatement(expression: Expression): ExpressionStatement {
        const node = checkedCompilerLayout(createBaseNode<ExpressionStatement>(SyntaxKind.ExpressionStatement), checked_isExpressionStatement);
        node.expression = parenthesizerRules().parenthesizeExpressionOfExpressionStatement(expression);
        node.transformFlags |= propagateChildFlags(node.expression);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateExpressionStatement(node: ExpressionStatement, expression: Expression) {
        return node.expression !== expression
            ? update(createExpressionStatement(expression), node)
            : node;
    }
    // @api
    function createIfStatement(expression: Expression, thenStatement: Statement, elseStatement?: Statement) {
        const node = checkedCompilerLayout(createBaseNode<IfStatement>(SyntaxKind.IfStatement), checked_isIfStatement);
        node.expression = expression;
        node.thenStatement = asEmbeddedStatement(thenStatement);
        node.elseStatement = asEmbeddedStatement(elseStatement);
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.thenStatement) |
            propagateChildFlags(node.elseStatement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateIfStatement(node: IfStatement, expression: Expression, thenStatement: Statement, elseStatement: Statement | undefined) {
        return node.expression !== expression
            || node.thenStatement !== thenStatement
            || node.elseStatement !== elseStatement
            ? update(createIfStatement(expression, thenStatement, elseStatement), node)
            : node;
    }
    // @api
    function createDoStatement(statement: Statement, expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<DoStatement>(SyntaxKind.DoStatement), checked_isDoStatement);
        node.statement = asEmbeddedStatement(statement);
        node.expression = expression;
        node.transformFlags |= propagateChildFlags(node.statement) |
            propagateChildFlags(node.expression);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateDoStatement(node: DoStatement, statement: Statement, expression: Expression) {
        return node.statement !== statement
            || node.expression !== expression
            ? update(createDoStatement(statement, expression), node)
            : node;
    }
    // @api
    function createWhileStatement(expression: Expression, statement: Statement) {
        const node = checkedCompilerLayout(createBaseNode<WhileStatement>(SyntaxKind.WhileStatement), checked_isWhileStatement);
        node.expression = expression;
        node.statement = asEmbeddedStatement(statement);
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.statement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateWhileStatement(node: WhileStatement, expression: Expression, statement: Statement) {
        return node.expression !== expression
            || node.statement !== statement
            ? update(createWhileStatement(expression, statement), node)
            : node;
    }
    // @api
    function createForStatement(initializer: ForInitializer | undefined, condition: Expression | undefined, incrementor: Expression | undefined, statement: Statement) {
        const node = checkedCompilerLayout(createBaseNode<ForStatement>(SyntaxKind.ForStatement), checked_isForStatement);
        node.initializer = initializer;
        node.condition = condition;
        node.incrementor = incrementor;
        node.statement = asEmbeddedStatement(statement);
        node.transformFlags |= propagateChildFlags(node.initializer) |
            propagateChildFlags(node.condition) |
            propagateChildFlags(node.incrementor) |
            propagateChildFlags(node.statement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateForStatement(node: ForStatement, initializer: ForInitializer | undefined, condition: Expression | undefined, incrementor: Expression | undefined, statement: Statement) {
        return node.initializer !== initializer
            || node.condition !== condition
            || node.incrementor !== incrementor
            || node.statement !== statement
            ? update(createForStatement(initializer, condition, incrementor, statement), node)
            : node;
    }
    // @api
    function createForInStatement(initializer: ForInitializer, expression: Expression, statement: Statement) {
        const node = checkedCompilerLayout(createBaseNode<ForInStatement>(SyntaxKind.ForInStatement), checked_isForInStatement);
        node.initializer = initializer;
        node.expression = expression;
        node.statement = asEmbeddedStatement(statement);
        node.transformFlags |= propagateChildFlags(node.initializer) |
            propagateChildFlags(node.expression) |
            propagateChildFlags(node.statement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateForInStatement(node: ForInStatement, initializer: ForInitializer, expression: Expression, statement: Statement) {
        return node.initializer !== initializer
            || node.expression !== expression
            || node.statement !== statement
            ? update(createForInStatement(initializer, expression, statement), node)
            : node;
    }
    // @api
    function createForOfStatement(awaitModifier: AwaitKeyword | undefined, initializer: ForInitializer, expression: Expression, statement: Statement) {
        const node = checkedCompilerLayout(createBaseNode<ForOfStatement>(SyntaxKind.ForOfStatement), checked_isForOfStatement);
        node.awaitModifier = awaitModifier;
        node.initializer = initializer;
        node.expression = parenthesizerRules().parenthesizeExpressionForDisallowedComma(expression);
        node.statement = asEmbeddedStatement(statement);
        node.transformFlags |= propagateChildFlags(node.awaitModifier) |
            propagateChildFlags(node.initializer) |
            propagateChildFlags(node.expression) |
            propagateChildFlags(node.statement) |
            TransformFlags.ContainsES2015;
        if (awaitModifier)
            node.transformFlags |= TransformFlags.ContainsES2018;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateForOfStatement(node: ForOfStatement, awaitModifier: AwaitKeyword | undefined, initializer: ForInitializer, expression: Expression, statement: Statement) {
        return node.awaitModifier !== awaitModifier
            || node.initializer !== initializer
            || node.expression !== expression
            || node.statement !== statement
            ? update(createForOfStatement(awaitModifier, initializer, expression, statement), node)
            : node;
    }
    // @api
    function createContinueStatement(label?: string | Identifier): ContinueStatement {
        const node = checkedCompilerLayout(createBaseNode<ContinueStatement>(SyntaxKind.ContinueStatement), checked_isContinueStatement);
        node.label = asName(label);
        node.transformFlags |= propagateChildFlags(node.label) |
            TransformFlags.ContainsHoistedDeclarationOrCompletion;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateContinueStatement(node: ContinueStatement, label: Identifier | undefined) {
        return node.label !== label
            ? update(createContinueStatement(label), node)
            : node;
    }
    // @api
    function createBreakStatement(label?: string | Identifier): BreakStatement {
        const node = checkedCompilerLayout(createBaseNode<BreakStatement>(SyntaxKind.BreakStatement), checked_isBreakStatement);
        node.label = asName(label);
        node.transformFlags |= propagateChildFlags(node.label) |
            TransformFlags.ContainsHoistedDeclarationOrCompletion;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateBreakStatement(node: BreakStatement, label: Identifier | undefined) {
        return node.label !== label
            ? update(createBreakStatement(label), node)
            : node;
    }
    // @api
    function createReturnStatement(expression?: Expression): ReturnStatement {
        const node = checkedCompilerLayout(createBaseNode<ReturnStatement>(SyntaxKind.ReturnStatement), checked_isReturnStatement);
        node.expression = expression;
        // return in an ES2018 async generator must be awaited
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsES2018 |
            TransformFlags.ContainsHoistedDeclarationOrCompletion;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateReturnStatement(node: ReturnStatement, expression: Expression | undefined) {
        return node.expression !== expression
            ? update(createReturnStatement(expression), node)
            : node;
    }
    // @api
    function createWithStatement(expression: Expression, statement: Statement) {
        const node = checkedCompilerLayout(createBaseNode<WithStatement>(SyntaxKind.WithStatement), checked_isWithStatement);
        node.expression = expression;
        node.statement = asEmbeddedStatement(statement);
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.statement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateWithStatement(node: WithStatement, expression: Expression, statement: Statement) {
        return node.expression !== expression
            || node.statement !== statement
            ? update(createWithStatement(expression, statement), node)
            : node;
    }
    // @api
    function createSwitchStatement(expression: Expression, caseBlock: CaseBlock): SwitchStatement {
        const node = checkedCompilerLayout(createBaseNode<SwitchStatement>(SyntaxKind.SwitchStatement), checked_isSwitchStatement);
        node.expression = parenthesizerRules().parenthesizeExpressionForDisallowedComma(expression);
        node.caseBlock = caseBlock;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.caseBlock);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        node.possiblyExhaustive = false; // initialized by binder
        return node;
    }
    // @api
    function updateSwitchStatement(node: SwitchStatement, expression: Expression, caseBlock: CaseBlock) {
        return node.expression !== expression
            || node.caseBlock !== caseBlock
            ? update(createSwitchStatement(expression, caseBlock), node)
            : node;
    }
    // @api
    function createLabeledStatement(label: string | Identifier, statement: Statement) {
        const node = checkedCompilerLayout(createBaseNode<LabeledStatement>(SyntaxKind.LabeledStatement), checked_isLabeledStatement);
        node.label = asName(label);
        node.statement = asEmbeddedStatement(statement);
        node.transformFlags |= propagateChildFlags(node.label) |
            propagateChildFlags(node.statement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateLabeledStatement(node: LabeledStatement, label: Identifier, statement: Statement) {
        return node.label !== label
            || node.statement !== statement
            ? update(createLabeledStatement(label, statement), node)
            : node;
    }
    // @api
    function createThrowStatement(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<ThrowStatement>(SyntaxKind.ThrowStatement), checked_isThrowStatement);
        node.expression = expression;
        node.transformFlags |= propagateChildFlags(node.expression);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateThrowStatement(node: ThrowStatement, expression: Expression) {
        return node.expression !== expression
            ? update(createThrowStatement(expression), node)
            : node;
    }
    // @api
    function createTryStatement(tryBlock: Block, catchClause: CatchClause | undefined, finallyBlock: Block | undefined) {
        const node = checkedCompilerLayout(createBaseNode<TryStatement>(SyntaxKind.TryStatement), checked_isTryStatement);
        node.tryBlock = tryBlock;
        node.catchClause = catchClause;
        node.finallyBlock = finallyBlock;
        node.transformFlags |= propagateChildFlags(node.tryBlock) |
            propagateChildFlags(node.catchClause) |
            propagateChildFlags(node.finallyBlock);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function updateTryStatement(node: TryStatement, tryBlock: Block, catchClause: CatchClause | undefined, finallyBlock: Block | undefined) {
        return node.tryBlock !== tryBlock
            || node.catchClause !== catchClause
            || node.finallyBlock !== finallyBlock
            ? update(createTryStatement(tryBlock, catchClause, finallyBlock), node)
            : node;
    }
    // @api
    function createDebuggerStatement() {
        const node = checkedCompilerLayout(createBaseNode<DebuggerStatement>(SyntaxKind.DebuggerStatement), checked_isDebuggerStatement);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.flowNode = undefined; // initialized by binder (FlowContainer)
        return node;
    }
    // @api
    function createVariableDeclaration(name: string | BindingName, exclamationToken: ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<VariableDeclaration>(SyntaxKind.VariableDeclaration), checked_isVariableDeclaration);
        node.name = asName(name);
        node.exclamationToken = exclamationToken;
        node.type = type;
        node.initializer = asInitializer(initializer);
        node.transformFlags |= propagateNameFlags(node.name) |
            propagateChildFlags(node.initializer) |
            (node.exclamationToken ?? node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateVariableDeclaration(node: VariableDeclaration, name: BindingName, exclamationToken: ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined) {
        return node.name !== name
            || node.type !== type
            || node.exclamationToken !== exclamationToken
            || node.initializer !== initializer
            ? update(createVariableDeclaration(name, exclamationToken, type, initializer), node)
            : node;
    }
    // @api
    function createVariableDeclarationList(declarations: readonly VariableDeclaration[], flags: NodeFlags = NodeFlags.None) {
        const node = checkedCompilerLayout(createBaseNode<VariableDeclarationList>(SyntaxKind.VariableDeclarationList), checked_isVariableDeclarationList);
        node.flags |= flags & NodeFlags.BlockScoped;
        node.declarations = createNodeArray(declarations);
        node.transformFlags |= propagateChildrenFlags(node.declarations) |
            TransformFlags.ContainsHoistedDeclarationOrCompletion;
        if (flags & NodeFlags.BlockScoped) {
            node.transformFlags |= TransformFlags.ContainsES2015 |
                TransformFlags.ContainsBlockScopedBinding;
        }
        if (flags & NodeFlags.Using) {
            node.transformFlags |= TransformFlags.ContainsESNext;
        }
        return node;
    }
    // @api
    function updateVariableDeclarationList(node: VariableDeclarationList, declarations: readonly VariableDeclaration[]) {
        return node.declarations !== declarations
            ? update(createVariableDeclarationList(declarations, node.flags), node)
            : node;
    }
    // @api
    function createFunctionDeclaration(modifiers: readonly Modifier[] | undefined, asteriskToken: AsteriskToken | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<FunctionDeclaration>(SyntaxKind.FunctionDeclaration), checked_isFunctionDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.asteriskToken = asteriskToken;
        node.name = asName(name);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = createNodeArray(parameters);
        node.type = type;
        node.body = body;
        if (!node.body || modifiersToFlags(node.modifiers) & ModifierFlags.Ambient) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            const isAsync = modifiersToFlags(node.modifiers) & ModifierFlags.Async;
            const isGenerator = !!node.asteriskToken;
            const isAsyncGenerator = isAsync && isGenerator;
            node.transformFlags = propagateChildrenFlags(node.modifiers) |
                propagateChildFlags(node.asteriskToken) |
                propagateNameFlags(node.name) |
                propagateChildrenFlags(node.typeParameters) |
                propagateChildrenFlags(node.parameters) |
                propagateChildFlags(node.type) |
                (propagateChildFlags(node.body) & ~TransformFlags.ContainsPossibleTopLevelAwait) |
                (isAsyncGenerator ? TransformFlags.ContainsES2018 :
                    isAsync ? TransformFlags.ContainsES2017 :
                        isGenerator ? TransformFlags.ContainsGenerator :
                            TransformFlags.None) |
                (node.typeParameters || node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
                TransformFlags.ContainsHoistedDeclarationOrCompletion;
        }
        node.typeArguments = undefined; // used in quick info
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.endFlowNode = undefined;
        node.returnFlowNode = undefined;
        return node;
    }
    // @api
    function updateFunctionDeclaration(node: FunctionDeclaration, modifiers: readonly Modifier[] | undefined, asteriskToken: AsteriskToken | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined) {
        return node.modifiers !== modifiers
            || node.asteriskToken !== asteriskToken
            || node.name !== name
            || node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            || node.body !== body
            ? finishUpdateFunctionDeclaration(createFunctionDeclaration(modifiers, asteriskToken, name, typeParameters, parameters, type, body), node)
            : node;
    }
    function finishUpdateFunctionDeclaration(updated: Mutable<FunctionDeclaration>, original: FunctionDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            if (updated.modifiers === original.modifiers) {
                updated.modifiers = original.modifiers;
            }
        }
        return finishUpdateBaseSignatureDeclaration(updated, original);
    }
    // @api
    function createClassDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]) {
        const node = checkedCompilerLayout(createBaseDeclaration<ClassDeclaration>(SyntaxKind.ClassDeclaration), checked_isClassDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.typeParameters = asNodeArray(typeParameters);
        node.heritageClauses = asNodeArray(heritageClauses);
        node.members = createNodeArray(members);
        if (modifiersToFlags(node.modifiers) & ModifierFlags.Ambient) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            node.transformFlags |= propagateChildrenFlags(node.modifiers) |
                propagateNameFlags(node.name) |
                propagateChildrenFlags(node.typeParameters) |
                propagateChildrenFlags(node.heritageClauses) |
                propagateChildrenFlags(node.members) |
                (node.typeParameters ? TransformFlags.ContainsTypeScript : TransformFlags.None) |
                TransformFlags.ContainsES2015;
            if (node.transformFlags & TransformFlags.ContainsTypeScriptClassSyntax) {
                node.transformFlags |= TransformFlags.ContainsTypeScript;
            }
        }
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateClassDeclaration(node: ClassDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.typeParameters !== typeParameters
            || node.heritageClauses !== heritageClauses
            || node.members !== members
            ? update(createClassDeclaration(modifiers, name, typeParameters, heritageClauses, members), node)
            : node;
    }
    // @api
    function createInterfaceDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly TypeElement[]) {
        const node = checkedCompilerLayout(createBaseDeclaration<InterfaceDeclaration>(SyntaxKind.InterfaceDeclaration), checked_isInterfaceDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.typeParameters = asNodeArray(typeParameters);
        node.heritageClauses = asNodeArray(heritageClauses);
        node.members = createNodeArray(members);
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateInterfaceDeclaration(node: InterfaceDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly TypeElement[]) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.typeParameters !== typeParameters
            || node.heritageClauses !== heritageClauses
            || node.members !== members
            ? update(createInterfaceDeclaration(modifiers, name, typeParameters, heritageClauses, members), node)
            : node;
    }
    // @api
    function createTypeAliasDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, type: TypeNode) {
        const node = checkedCompilerLayout(createBaseDeclaration<TypeAliasDeclaration>(SyntaxKind.TypeAliasDeclaration), checked_isTypeAliasDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.typeParameters = asNodeArray(typeParameters);
        node.type = type;
        node.transformFlags = TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateTypeAliasDeclaration(node: TypeAliasDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, type: TypeNode) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.typeParameters !== typeParameters
            || node.type !== type
            ? update(createTypeAliasDeclaration(modifiers, name, typeParameters, type), node)
            : node;
    }
    // @api
    function createEnumDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier, members: readonly EnumMember[]) {
        const node = checkedCompilerLayout(createBaseDeclaration<EnumDeclaration>(SyntaxKind.EnumDeclaration), checked_isEnumDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.members = createNodeArray(members);
        node.transformFlags |= propagateChildrenFlags(node.modifiers) |
            propagateChildFlags(node.name) |
            propagateChildrenFlags(node.members) |
            TransformFlags.ContainsTypeScript;
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // Enum declarations cannot contain `await`
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateEnumDeclaration(node: EnumDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier, members: readonly EnumMember[]) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.members !== members
            ? update(createEnumDeclaration(modifiers, name, members), node)
            : node;
    }
    // @api
    function createModuleDeclaration(modifiers: readonly ModifierLike[] | undefined, name: ModuleName, body: ModuleBody | undefined, flags: NodeFlags = NodeFlags.None) {
        const node = checkedCompilerLayout(createBaseDeclaration<ModuleDeclaration>(SyntaxKind.ModuleDeclaration), checked_isModuleDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.flags |= flags & (NodeFlags.Namespace | NodeFlags.NestedNamespace | NodeFlags.GlobalAugmentation);
        node.name = name;
        node.body = body;
        if (modifiersToFlags(node.modifiers) & ModifierFlags.Ambient) {
            node.transformFlags = TransformFlags.ContainsTypeScript;
        }
        else {
            node.transformFlags |= propagateChildrenFlags(node.modifiers) |
                propagateChildFlags(node.name) |
                propagateChildFlags(node.body) |
                TransformFlags.ContainsTypeScript;
        }
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // Module declarations cannot contain `await`.
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateModuleDeclaration(node: ModuleDeclaration, modifiers: readonly ModifierLike[] | undefined, name: ModuleName, body: ModuleBody | undefined) {
        return node.modifiers !== modifiers
            || node.name !== name
            || node.body !== body
            ? update(createModuleDeclaration(modifiers, name, body, node.flags), node)
            : node;
    }
    // @api
    function createModuleBlock(statements: readonly Statement[]) {
        const node = checkedCompilerLayout(createBaseNode<ModuleBlock>(SyntaxKind.ModuleBlock), checked_isModuleBlock);
        node.statements = createNodeArray(statements);
        node.transformFlags |= propagateChildrenFlags(node.statements);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateModuleBlock(node: ModuleBlock, statements: readonly Statement[]) {
        return node.statements !== statements
            ? update(createModuleBlock(statements), node)
            : node;
    }
    // @api
    function createCaseBlock(clauses: readonly CaseOrDefaultClause[]): CaseBlock {
        const node = checkedCompilerLayout(createBaseNode<CaseBlock>(SyntaxKind.CaseBlock), checked_isCaseBlock);
        node.clauses = createNodeArray(clauses);
        node.transformFlags |= propagateChildrenFlags(node.clauses);
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateCaseBlock(node: CaseBlock, clauses: readonly CaseOrDefaultClause[]) {
        return node.clauses !== clauses
            ? update(createCaseBlock(clauses), node)
            : node;
    }
    // @api
    function createNamespaceExportDeclaration(name: string | Identifier) {
        const node = checkedCompilerLayout(createBaseDeclaration<NamespaceExportDeclaration>(SyntaxKind.NamespaceExportDeclaration), checked_isNamespaceExportDeclaration);
        node.name = asName(name);
        node.transformFlags |= propagateIdentifierNameFlags(node.name) |
            TransformFlags.ContainsTypeScript;
        node.modifiers = undefined; // initialized by parser to report grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateNamespaceExportDeclaration(node: NamespaceExportDeclaration, name: Identifier) {
        return node.name !== name
            ? finishUpdateNamespaceExportDeclaration(createNamespaceExportDeclaration(name), node)
            : node;
    }
    function finishUpdateNamespaceExportDeclaration(updated: Mutable<NamespaceExportDeclaration>, original: NamespaceExportDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.modifiers = original.modifiers;
        }
        return update(updated, original);
    }
    // @api
    function createImportEqualsDeclaration(modifiers: readonly ModifierLike[] | undefined, isTypeOnly: boolean, name: string | Identifier, moduleReference: ModuleReference) {
        const node = checkedCompilerLayout(createBaseDeclaration<ImportEqualsDeclaration>(SyntaxKind.ImportEqualsDeclaration), checked_isImportEqualsDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.name = asName(name);
        node.isTypeOnly = isTypeOnly;
        node.moduleReference = moduleReference;
        node.transformFlags |= propagateChildrenFlags(node.modifiers) |
            propagateIdentifierNameFlags(node.name) |
            propagateChildFlags(node.moduleReference);
        if (!isExternalModuleReference(node.moduleReference)) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // Import= declaration is always parsed in an Await context
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateImportEqualsDeclaration(node: ImportEqualsDeclaration, modifiers: readonly ModifierLike[] | undefined, isTypeOnly: boolean, name: Identifier, moduleReference: ModuleReference) {
        return node.modifiers !== modifiers
            || node.isTypeOnly !== isTypeOnly
            || node.name !== name
            || node.moduleReference !== moduleReference
            ? update(createImportEqualsDeclaration(modifiers, isTypeOnly, name, moduleReference), node)
            : node;
    }
    // @api
    function createImportDeclaration(modifiers: readonly ModifierLike[] | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes: ImportAttributes | undefined): ImportDeclaration {
        const node = checkedCompilerLayout(createBaseNode<ImportDeclaration>(SyntaxKind.ImportDeclaration), checked_isImportDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.importClause = importClause;
        node.moduleSpecifier = moduleSpecifier;
        node.attributes = node.assertClause = attributes;
        node.transformFlags |= propagateChildFlags(node.importClause) |
            propagateChildFlags(node.moduleSpecifier);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateImportDeclaration(node: ImportDeclaration, modifiers: readonly ModifierLike[] | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes: ImportAttributes | undefined) {
        return node.modifiers !== modifiers
            || node.importClause !== importClause
            || node.moduleSpecifier !== moduleSpecifier
            || node.attributes !== attributes
            ? update(createImportDeclaration(modifiers, importClause, moduleSpecifier, attributes), node)
            : node;
    }
    // @api
    function createImportClause(phaseModifier: ImportPhaseModifierSyntaxKind | boolean | undefined, name: Identifier | undefined, namedBindings: NamedImportBindings | undefined): ImportClause {
        const node = checkedCompilerLayout(createBaseDeclaration<ImportClause>(SyntaxKind.ImportClause), checked_isImportClause);
        if (typeof phaseModifier === "boolean") {
            phaseModifier = phaseModifier ? SyntaxKind.TypeKeyword : undefined;
        }
        node.isTypeOnly = phaseModifier === SyntaxKind.TypeKeyword;
        node.phaseModifier = phaseModifier;
        node.name = name;
        node.namedBindings = namedBindings;
        node.transformFlags |= propagateChildFlags(node.name) |
            propagateChildFlags(node.namedBindings);
        if (phaseModifier === SyntaxKind.TypeKeyword) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateImportClause(node: ImportClause, phaseModifier: ImportPhaseModifierSyntaxKind | boolean | undefined, name: Identifier | undefined, namedBindings: NamedImportBindings | undefined) {
        if (typeof phaseModifier === "boolean") {
            phaseModifier = phaseModifier ? SyntaxKind.TypeKeyword : undefined;
        }
        return node.phaseModifier !== phaseModifier
            || node.name !== name
            || node.namedBindings !== namedBindings
            ? update(createImportClause(phaseModifier, name, namedBindings), node)
            : node;
    }
    // @api
    function createAssertClause(elements: readonly AssertEntry[], multiLine?: boolean): AssertClause {
        const node = checkedCompilerLayout(createBaseNode<AssertClause>(SyntaxKind.AssertClause), checked_isAssertClause);
        node.elements = createNodeArray(elements);
        node.multiLine = multiLine;
        node.token = SyntaxKind.AssertKeyword;
        node.transformFlags |= TransformFlags.ContainsESNext;
        return node;
    }
    // @api
    function updateAssertClause(node: AssertClause, elements: readonly AssertEntry[], multiLine?: boolean): AssertClause {
        return node.elements !== elements
            || node.multiLine !== multiLine
            ? update(createAssertClause(elements, multiLine), node)
            : node;
    }
    // @api
    function createAssertEntry(name: AssertionKey, value: Expression): AssertEntry {
        const node = checkedCompilerLayout(createBaseNode<AssertEntry>(SyntaxKind.AssertEntry), checked_isAssertEntry);
        node.name = name;
        node.value = value;
        node.transformFlags |= TransformFlags.ContainsESNext;
        return node;
    }
    // @api
    function updateAssertEntry(node: AssertEntry, name: AssertionKey, value: Expression): AssertEntry {
        return node.name !== name
            || node.value !== value
            ? update(createAssertEntry(name, value), node)
            : node;
    }
    // @api
    function createImportTypeAssertionContainer(clause: AssertClause, multiLine?: boolean): ImportTypeAssertionContainer {
        const node = checkedCompilerLayout(createBaseNode<ImportTypeAssertionContainer>(SyntaxKind.ImportTypeAssertionContainer), checked_isImportTypeAssertionContainer);
        node.assertClause = clause;
        node.multiLine = multiLine;
        return node;
    }
    // @api
    function updateImportTypeAssertionContainer(node: ImportTypeAssertionContainer, clause: AssertClause, multiLine?: boolean): ImportTypeAssertionContainer {
        return node.assertClause !== clause
            || node.multiLine !== multiLine
            ? update(createImportTypeAssertionContainer(clause, multiLine), node)
            : node;
    }
    // @api
    function createImportAttributes(elements: readonly ImportAttribute[], multiLine?: boolean): ImportAttributes;
    function createImportAttributes(elements: readonly ImportAttribute[], multiLine?: boolean, token?: ImportAttributes["token"]): ImportAttributes;
    function createImportAttributes(elements: readonly ImportAttribute[], multiLine?: boolean, token?: ImportAttributes["token"]): ImportAttributes {
        const node = checkedCompilerLayout(createBaseNode<ImportAttributes>(SyntaxKind.ImportAttributes), checked_isImportAttributes);
        node.token = token ?? SyntaxKind.WithKeyword;
        node.elements = createNodeArray(elements);
        node.multiLine = multiLine;
        node.transformFlags |= TransformFlags.ContainsESNext;
        return node;
    }
    // @api
    function updateImportAttributes(node: ImportAttributes, elements: readonly ImportAttribute[], multiLine?: boolean): ImportAttributes {
        return node.elements !== elements
            || node.multiLine !== multiLine
            ? update(createImportAttributes(elements, multiLine, node.token), node)
            : node;
    }
    // @api
    function createImportAttribute(name: ImportAttributeName, value: Expression): ImportAttribute {
        const node = checkedCompilerLayout(createBaseNode<ImportAttribute>(SyntaxKind.ImportAttribute), checked_isImportAttribute);
        node.name = name;
        node.value = value;
        node.transformFlags |= TransformFlags.ContainsESNext;
        return node;
    }
    // @api
    function updateImportAttribute(node: ImportAttribute, name: ImportAttributeName, value: Expression): ImportAttribute {
        return node.name !== name
            || node.value !== value
            ? update(createImportAttribute(name, value), node)
            : node;
    }
    // @api
    function createNamespaceImport(name: Identifier): NamespaceImport {
        const node = checkedCompilerLayout(createBaseDeclaration<NamespaceImport>(SyntaxKind.NamespaceImport), checked_isNamespaceImport);
        node.name = name;
        node.transformFlags |= propagateChildFlags(node.name);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateNamespaceImport(node: NamespaceImport, name: Identifier) {
        return node.name !== name
            ? update(createNamespaceImport(name), node)
            : node;
    }
    // @api
    function createNamespaceExport(name: ModuleExportName): NamespaceExport {
        const node = checkedCompilerLayout(createBaseDeclaration<NamespaceExport>(SyntaxKind.NamespaceExport), checked_isNamespaceExport);
        node.name = name;
        node.transformFlags |= propagateChildFlags(node.name) |
            TransformFlags.ContainsES2020;
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateNamespaceExport(node: NamespaceExport, name: ModuleExportName) {
        return node.name !== name
            ? update(createNamespaceExport(name), node)
            : node;
    }
    // @api
    function createNamedImports(elements: readonly ImportSpecifier[]): NamedImports {
        const node = checkedCompilerLayout(createBaseNode<NamedImports>(SyntaxKind.NamedImports), checked_isNamedImports);
        node.elements = createNodeArray(elements);
        node.transformFlags |= propagateChildrenFlags(node.elements);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateNamedImports(node: NamedImports, elements: readonly ImportSpecifier[]) {
        return node.elements !== elements
            ? update(createNamedImports(elements), node)
            : node;
    }
    // @api
    function createImportSpecifier(isTypeOnly: boolean, propertyName: ModuleExportName | undefined, name: Identifier) {
        const node = checkedCompilerLayout(createBaseDeclaration<ImportSpecifier>(SyntaxKind.ImportSpecifier), checked_isImportSpecifier);
        node.isTypeOnly = isTypeOnly;
        node.propertyName = propertyName;
        node.name = name;
        node.transformFlags |= propagateChildFlags(node.propertyName) |
            propagateChildFlags(node.name);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateImportSpecifier(node: ImportSpecifier, isTypeOnly: boolean, propertyName: ModuleExportName | undefined, name: Identifier) {
        return node.isTypeOnly !== isTypeOnly
            || node.propertyName !== propertyName
            || node.name !== name
            ? update(createImportSpecifier(isTypeOnly, propertyName, name), node)
            : node;
    }
    // @api
    function createExportAssignment(modifiers: readonly ModifierLike[] | undefined, isExportEquals: boolean | undefined, expression: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<ExportAssignment>(SyntaxKind.ExportAssignment), checked_isExportAssignment);
        node.modifiers = asNodeArray(modifiers);
        node.isExportEquals = isExportEquals;
        node.expression = isExportEquals
            ? parenthesizerRules().parenthesizeRightSideOfBinary(SyntaxKind.EqualsToken, /*leftSide*/ undefined, expression)
            : parenthesizerRules().parenthesizeExpressionOfExportDefault(expression);
        node.transformFlags |= propagateChildrenFlags(node.modifiers) | propagateChildFlags(node.expression);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateExportAssignment(node: ExportAssignment, modifiers: readonly ModifierLike[] | undefined, expression: Expression) {
        return node.modifiers !== modifiers
            || node.expression !== expression
            ? update(createExportAssignment(modifiers, node.isExportEquals, expression), node)
            : node;
    }
    // @api
    function createExportDeclaration(modifiers: readonly Modifier[] | undefined, isTypeOnly: boolean, exportClause: NamedExportBindings | undefined, moduleSpecifier?: Expression, attributes?: ImportAttributes) {
        const node = checkedCompilerLayout(createBaseDeclaration<ExportDeclaration>(SyntaxKind.ExportDeclaration), checked_isExportDeclaration);
        node.modifiers = asNodeArray(modifiers);
        node.isTypeOnly = isTypeOnly;
        node.exportClause = exportClause;
        node.moduleSpecifier = moduleSpecifier;
        node.attributes = node.assertClause = attributes;
        node.transformFlags |= propagateChildrenFlags(node.modifiers) |
            propagateChildFlags(node.exportClause) |
            propagateChildFlags(node.moduleSpecifier);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateExportDeclaration(node: ExportDeclaration, modifiers: readonly Modifier[] | undefined, isTypeOnly: boolean, exportClause: NamedExportBindings | undefined, moduleSpecifier: Expression | undefined, attributes: ImportAttributes | undefined) {
        return node.modifiers !== modifiers
            || node.isTypeOnly !== isTypeOnly
            || node.exportClause !== exportClause
            || node.moduleSpecifier !== moduleSpecifier
            || node.attributes !== attributes
            ? finishUpdateExportDeclaration(createExportDeclaration(modifiers, isTypeOnly, exportClause, moduleSpecifier, attributes), node)
            : node;
    }
    function finishUpdateExportDeclaration(updated: Mutable<ExportDeclaration>, original: ExportDeclaration) {
        if (updated !== original) {
            // copy children used only for error reporting
            if (updated.modifiers === original.modifiers) {
                updated.modifiers = original.modifiers;
            }
        }
        return update(updated, original);
    }
    // @api
    function createNamedExports(elements: readonly ExportSpecifier[]) {
        const node = checkedCompilerLayout(createBaseNode<NamedExports>(SyntaxKind.NamedExports), checked_isNamedExports);
        node.elements = createNodeArray(elements);
        node.transformFlags |= propagateChildrenFlags(node.elements);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateNamedExports(node: NamedExports, elements: readonly ExportSpecifier[]) {
        return node.elements !== elements
            ? update(createNamedExports(elements), node)
            : node;
    }
    // @api
    function createExportSpecifier(isTypeOnly: boolean, propertyName: string | ModuleExportName | undefined, name: string | ModuleExportName) {
        const node = checkedCompilerLayout(createBaseNode<ExportSpecifier>(SyntaxKind.ExportSpecifier), checked_isExportSpecifier);
        node.isTypeOnly = isTypeOnly;
        node.propertyName = asName(propertyName);
        node.name = asName(name);
        node.transformFlags |= propagateChildFlags(node.propertyName) |
            propagateChildFlags(node.name);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateExportSpecifier(node: ExportSpecifier, isTypeOnly: boolean, propertyName: ModuleExportName | undefined, name: ModuleExportName) {
        return node.isTypeOnly !== isTypeOnly
            || node.propertyName !== propertyName
            || node.name !== name
            ? update(createExportSpecifier(isTypeOnly, propertyName, name), node)
            : node;
    }
    // @api
    function createMissingDeclaration(): MissingDeclaration {
        const node = checkedCompilerLayout(createBaseDeclaration<MissingDeclaration>(SyntaxKind.MissingDeclaration), checked_isMissingDeclaration);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    //
    // Module references
    //
    // @api
    function createExternalModuleReference(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<ExternalModuleReference>(SyntaxKind.ExternalModuleReference), checked_isExternalModuleReference);
        node.expression = expression;
        node.transformFlags |= propagateChildFlags(node.expression);
        node.transformFlags &= ~TransformFlags.ContainsPossibleTopLevelAwait; // always parsed in an Await context
        return node;
    }
    // @api
    function updateExternalModuleReference(node: ExternalModuleReference, expression: Expression) {
        return node.expression !== expression
            ? update(createExternalModuleReference(expression), node)
            : node;
    }
    //
    // JSDoc
    //
    // @api
    // createJSDocAllType
    // createJSDocUnknownType
    function createJSDocPrimaryTypeWorker<K extends JSDocPrimaryKind>(kind: K) {
        return requireFactoryNodeKind(createBaseNode(kind), kind);
    }
    // @api
    // createJSDocNullableType
    // createJSDocNonNullableType
    function createJSDocPrePostfixUnaryTypeWorker<K extends JSDocPrePostfixKind>(kind: K, type: FactoryNodeLayouts[K]["type"], postfix = false): FactoryNodeLayouts[K] {
        const node = createJSDocUnaryTypeWorker(kind, postfix ? type && parenthesizerRules().parenthesizeNonArrayTypeOfPostfixType(type) : type);
        node.postfix = postfix;
        return node;
    }
    // @api
    // createJSDocOptionalType
    // createJSDocVariadicType
    // createJSDocNamepathType
    function createJSDocUnaryTypeWorker<K extends JSDocUnaryKind>(kind: K, type: FactoryNodeLayouts[K]["type"]): FactoryNodeLayouts[K] {
        const node = requireFactoryNodeKind(createBaseNode(kind), kind);
        node.type = type;
        return node;
    }
    // @api
    // updateJSDocNonNullableType
    // updateJSDocNullableType
    function updateJSDocPrePostfixUnaryTypeWorker<K extends JSDocPrePostfixKind>(kind: K, node: FactoryNodeLayouts[K], type: FactoryNodeLayouts[K]["type"]): FactoryNodeLayouts[K] {
        return node.type !== type
            ? update(createJSDocPrePostfixUnaryTypeWorker(kind, type, node.postfix), node)
            : node;
    }
    // @api
    // updateJSDocOptionalType
    // updateJSDocVariadicType
    // updateJSDocNamepathType
    function updateJSDocUnaryTypeWorker<K extends JSDocUnaryKind>(kind: K, node: FactoryNodeLayouts[K], type: FactoryNodeLayouts[K]["type"]): FactoryNodeLayouts[K] {
        return node.type !== type
            ? update(createJSDocUnaryTypeWorker(kind, type), node)
            : node;
    }
    // @api
    function createJSDocFunctionType(parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): JSDocFunctionType {
        const node = checkedCompilerLayout(createBaseDeclaration<JSDocFunctionType>(SyntaxKind.JSDocFunctionType), checked_isJSDocFunctionType);
        node.parameters = asNodeArray(parameters);
        node.type = type;
        node.transformFlags = propagateChildrenFlags(node.parameters) |
            (node.type ? TransformFlags.ContainsTypeScript : TransformFlags.None);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.typeArguments = undefined; // used in quick info
        return node;
    }
    // @api
    function updateJSDocFunctionType(node: JSDocFunctionType, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): JSDocFunctionType {
        return node.parameters !== parameters
            || node.type !== type
            ? update(createJSDocFunctionType(parameters, type), node)
            : node;
    }
    // @api
    function createJSDocTypeLiteral(propertyTags?: readonly (JSDocPropertyLikeTag | JSDocThisTag)[], isArrayType = false): JSDocTypeLiteral {
        const node = checkedCompilerLayout(createBaseDeclaration<JSDocTypeLiteral>(SyntaxKind.JSDocTypeLiteral), checked_isJSDocTypeLiteral);
        node.jsDocPropertyTags = asNodeArray(propertyTags);
        node.isArrayType = isArrayType;
        return node;
    }
    // @api
    function updateJSDocTypeLiteral(node: JSDocTypeLiteral, propertyTags: readonly (JSDocPropertyLikeTag | JSDocThisTag)[] | undefined, isArrayType: boolean): JSDocTypeLiteral {
        return node.jsDocPropertyTags !== propertyTags
            || node.isArrayType !== isArrayType
            ? update(createJSDocTypeLiteral(propertyTags, isArrayType), node)
            : node;
    }
    // @api
    function createJSDocTypeExpression(type: TypeNode): JSDocTypeExpression {
        const node = checkedCompilerLayout(createBaseNode<JSDocTypeExpression>(SyntaxKind.JSDocTypeExpression), checked_isJSDocTypeExpression);
        node.type = type;
        return node;
    }
    // @api
    function updateJSDocTypeExpression(node: JSDocTypeExpression, type: TypeNode): JSDocTypeExpression {
        return node.type !== type
            ? update(createJSDocTypeExpression(type), node)
            : node;
    }
    // @api
    function createJSDocSignature(typeParameters: readonly JSDocTemplateTag[] | undefined, parameters: readonly (JSDocParameterTag | JSDocThisTag)[], type?: JSDocReturnTag): JSDocSignature {
        const node = checkedCompilerLayout(createBaseDeclaration<JSDocSignature>(SyntaxKind.JSDocSignature), checked_isJSDocSignature);
        node.typeParameters = asNodeArray(typeParameters);
        node.parameters = createNodeArray(parameters);
        node.type = type;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateJSDocSignature(node: JSDocSignature, typeParameters: readonly JSDocTemplateTag[] | undefined, parameters: readonly (JSDocParameterTag | JSDocThisTag)[], type: JSDocReturnTag | undefined): JSDocSignature {
        return node.typeParameters !== typeParameters
            || node.parameters !== parameters
            || node.type !== type
            ? update(createJSDocSignature(typeParameters, parameters, type), node)
            : node;
    }
    function getDefaultTagName(node: JSDocTag) {
        const defaultTagName = getDefaultTagNameForKind(node.kind);
        return node.tagName.escapedText === escapeLeadingUnderscores(defaultTagName)
            ? node.tagName
            : createIdentifier(defaultTagName);
    }
    // @api
    function createBaseJSDocTag<K extends JSDocTagKind>(kind: K, tagName: Identifier, comment: string | NodeArray<JSDocComment> | undefined) {
        const node = requireFactoryNodeKind(createBaseNode(kind), kind);
        node.tagName = tagName;
        node.comment = comment;
        return node;
    }
    function createBaseJSDocTagDeclaration<K extends JSDocTagDeclarationKind>(kind: K, tagName: Identifier, comment: string | NodeArray<JSDocComment> | undefined) {
        const node = requireFactoryNodeKind(createBaseDeclaration(kind), kind);
        node.tagName = tagName;
        node.comment = comment;
        return node;
    }
    // @api
    function createJSDocTemplateTag(tagName: Identifier | undefined, constraint: JSDocTypeExpression | undefined, typeParameters: readonly TypeParameterDeclaration[], comment?: string | NodeArray<JSDocComment>): JSDocTemplateTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocTemplateTag>(SyntaxKind.JSDocTemplateTag, tagName ?? createIdentifier("template"), comment);
        node.constraint = constraint;
        node.typeParameters = createNodeArray(typeParameters);
        return node;
    }
    // @api
    function updateJSDocTemplateTag(node: JSDocTemplateTag, tagName: Identifier = getDefaultTagName(node), constraint: JSDocTypeExpression | undefined, typeParameters: readonly TypeParameterDeclaration[], comment: string | NodeArray<JSDocComment> | undefined): JSDocTemplateTag {
        return node.tagName !== tagName
            || node.constraint !== constraint
            || node.typeParameters !== typeParameters
            || node.comment !== comment
            ? update(createJSDocTemplateTag(tagName, constraint, typeParameters, comment), node)
            : node;
    }
    // @api
    function createJSDocTypedefTag(tagName: Identifier | undefined, typeExpression?: JSDocTypeExpression, fullName?: Identifier | JSDocNamespaceDeclaration, comment?: string | NodeArray<JSDocComment>): JSDocTypedefTag {
        const node = createBaseJSDocTagDeclaration<typeof SyntaxKind.JSDocTypedefTag>(SyntaxKind.JSDocTypedefTag, tagName ?? createIdentifier("typedef"), comment);
        node.typeExpression = typeExpression;
        node.fullName = fullName;
        node.name = getJSDocTypeAliasName(fullName);
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateJSDocTypedefTag(node: JSDocTypedefTag, tagName: Identifier = getDefaultTagName(node), typeExpression: JSDocTypeExpression | undefined, fullName: Identifier | JSDocNamespaceDeclaration | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocTypedefTag {
        return node.tagName !== tagName
            || node.typeExpression !== typeExpression
            || node.fullName !== fullName
            || node.comment !== comment
            ? update(createJSDocTypedefTag(tagName, typeExpression, fullName, comment), node)
            : node;
    }
    // @api
    function createJSDocParameterTag(tagName: Identifier | undefined, name: EntityName, isBracketed: boolean, typeExpression?: JSDocTypeExpression, isNameFirst?: boolean, comment?: string | NodeArray<JSDocComment>): JSDocParameterTag {
        const node = createBaseJSDocTagDeclaration<typeof SyntaxKind.JSDocParameterTag>(SyntaxKind.JSDocParameterTag, tagName ?? createIdentifier("param"), comment);
        node.typeExpression = typeExpression;
        node.name = name;
        node.isNameFirst = !!isNameFirst;
        node.isBracketed = isBracketed;
        return node;
    }
    // @api
    function updateJSDocParameterTag(node: JSDocParameterTag, tagName: Identifier = getDefaultTagName(node), name: EntityName, isBracketed: boolean, typeExpression: JSDocTypeExpression | undefined, isNameFirst: boolean, comment: string | NodeArray<JSDocComment> | undefined): JSDocParameterTag {
        return node.tagName !== tagName
            || node.name !== name
            || node.isBracketed !== isBracketed
            || node.typeExpression !== typeExpression
            || node.isNameFirst !== isNameFirst
            || node.comment !== comment
            ? update(createJSDocParameterTag(tagName, name, isBracketed, typeExpression, isNameFirst, comment), node)
            : node;
    }
    // @api
    function createJSDocPropertyTag(tagName: Identifier | undefined, name: EntityName, isBracketed: boolean, typeExpression?: JSDocTypeExpression, isNameFirst?: boolean, comment?: string | NodeArray<JSDocComment>): JSDocPropertyTag {
        const node = createBaseJSDocTagDeclaration<typeof SyntaxKind.JSDocPropertyTag>(SyntaxKind.JSDocPropertyTag, tagName ?? createIdentifier("prop"), comment);
        node.typeExpression = typeExpression;
        node.name = name;
        node.isNameFirst = !!isNameFirst;
        node.isBracketed = isBracketed;
        return node;
    }
    // @api
    function updateJSDocPropertyTag(node: JSDocPropertyTag, tagName: Identifier = getDefaultTagName(node), name: EntityName, isBracketed: boolean, typeExpression: JSDocTypeExpression | undefined, isNameFirst: boolean, comment: string | NodeArray<JSDocComment> | undefined): JSDocPropertyTag {
        return node.tagName !== tagName
            || node.name !== name
            || node.isBracketed !== isBracketed
            || node.typeExpression !== typeExpression
            || node.isNameFirst !== isNameFirst
            || node.comment !== comment
            ? update(createJSDocPropertyTag(tagName, name, isBracketed, typeExpression, isNameFirst, comment), node)
            : node;
    }
    // @api
    function createJSDocCallbackTag(tagName: Identifier | undefined, typeExpression: JSDocSignature, fullName?: Identifier | JSDocNamespaceDeclaration, comment?: string | NodeArray<JSDocComment>): JSDocCallbackTag {
        const node = createBaseJSDocTagDeclaration<typeof SyntaxKind.JSDocCallbackTag>(SyntaxKind.JSDocCallbackTag, tagName ?? createIdentifier("callback"), comment);
        node.typeExpression = typeExpression;
        node.fullName = fullName;
        node.name = getJSDocTypeAliasName(fullName);
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateJSDocCallbackTag(node: JSDocCallbackTag, tagName: Identifier = getDefaultTagName(node), typeExpression: JSDocSignature, fullName: Identifier | JSDocNamespaceDeclaration | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocCallbackTag {
        return node.tagName !== tagName
            || node.typeExpression !== typeExpression
            || node.fullName !== fullName
            || node.comment !== comment
            ? update(createJSDocCallbackTag(tagName, typeExpression, fullName, comment), node)
            : node;
    }
    // @api
    function createJSDocOverloadTag(tagName: Identifier | undefined, typeExpression: JSDocSignature, comment?: string | NodeArray<JSDocComment>): JSDocOverloadTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocOverloadTag>(SyntaxKind.JSDocOverloadTag, tagName ?? createIdentifier("overload"), comment);
        node.typeExpression = typeExpression;
        return node;
    }
    // @api
    function updateJSDocOverloadTag(node: JSDocOverloadTag, tagName: Identifier = getDefaultTagName(node), typeExpression: JSDocSignature, comment: string | NodeArray<JSDocComment> | undefined): JSDocOverloadTag {
        return node.tagName !== tagName
            || node.typeExpression !== typeExpression
            || node.comment !== comment
            ? update(createJSDocOverloadTag(tagName, typeExpression, comment), node)
            : node;
    }
    // @api
    function createJSDocAugmentsTag(tagName: Identifier | undefined, className: JSDocAugmentsTag["class"], comment?: string | NodeArray<JSDocComment>): JSDocAugmentsTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocAugmentsTag>(SyntaxKind.JSDocAugmentsTag, tagName ?? createIdentifier("augments"), comment);
        node.class = className;
        return node;
    }
    // @api
    function updateJSDocAugmentsTag(node: JSDocAugmentsTag, tagName: Identifier = getDefaultTagName(node), className: JSDocAugmentsTag["class"], comment: string | NodeArray<JSDocComment> | undefined): JSDocAugmentsTag {
        return node.tagName !== tagName
            || node.class !== className
            || node.comment !== comment
            ? update(createJSDocAugmentsTag(tagName, className, comment), node)
            : node;
    }
    // @api
    function createJSDocImplementsTag(tagName: Identifier | undefined, className: JSDocImplementsTag["class"], comment?: string | NodeArray<JSDocComment>): JSDocImplementsTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocImplementsTag>(SyntaxKind.JSDocImplementsTag, tagName ?? createIdentifier("implements"), comment);
        node.class = className;
        return node;
    }
    // @api
    function createJSDocSeeTag(tagName: Identifier | undefined, name: JSDocNameReference | undefined, comment?: string | NodeArray<JSDocComment>): JSDocSeeTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocSeeTag>(SyntaxKind.JSDocSeeTag, tagName ?? createIdentifier("see"), comment);
        node.name = name;
        return node;
    }
    // @api
    function updateJSDocSeeTag(node: JSDocSeeTag, tagName: Identifier | undefined, name: JSDocNameReference | undefined, comment?: string | NodeArray<JSDocComment>): JSDocSeeTag {
        return node.tagName !== tagName
            || node.name !== name
            || node.comment !== comment
            ? update(createJSDocSeeTag(tagName, name, comment), node)
            : node;
    }
    // @api
    function createJSDocNameReference(name: EntityName | JSDocMemberName): JSDocNameReference {
        const node = checkedCompilerLayout(createBaseNode<JSDocNameReference>(SyntaxKind.JSDocNameReference), checked_isJSDocNameReference);
        node.name = name;
        return node;
    }
    // @api
    function updateJSDocNameReference(node: JSDocNameReference, name: EntityName | JSDocMemberName): JSDocNameReference {
        return node.name !== name
            ? update(createJSDocNameReference(name), node)
            : node;
    }
    // @api
    function createJSDocMemberName(left: EntityName | JSDocMemberName, right: Identifier) {
        const node = checkedCompilerLayout(createBaseNode<JSDocMemberName>(SyntaxKind.JSDocMemberName), checked_isJSDocMemberName);
        node.left = left;
        node.right = right;
        node.transformFlags |= propagateChildFlags(node.left) |
            propagateChildFlags(node.right);
        return node;
    }
    // @api
    function updateJSDocMemberName(node: JSDocMemberName, left: EntityName | JSDocMemberName, right: Identifier) {
        return node.left !== left
            || node.right !== right
            ? update(createJSDocMemberName(left, right), node)
            : node;
    }
    // @api
    function createJSDocLink(name: EntityName | JSDocMemberName | undefined, text: string): JSDocLink {
        const node = checkedCompilerLayout(createBaseNode<JSDocLink>(SyntaxKind.JSDocLink), checked_isJSDocLink);
        node.name = name;
        node.text = text;
        return node;
    }
    // @api
    function updateJSDocLink(node: JSDocLink, name: EntityName | JSDocMemberName | undefined, text: string): JSDocLink {
        return node.name !== name
            ? update(createJSDocLink(name, text), node)
            : node;
    }
    // @api
    function createJSDocLinkCode(name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkCode {
        const node = checkedCompilerLayout(createBaseNode<JSDocLinkCode>(SyntaxKind.JSDocLinkCode), checked_isJSDocLinkCode);
        node.name = name;
        node.text = text;
        return node;
    }
    // @api
    function updateJSDocLinkCode(node: JSDocLinkCode, name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkCode {
        return node.name !== name
            ? update(createJSDocLinkCode(name, text), node)
            : node;
    }
    // @api
    function createJSDocLinkPlain(name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkPlain {
        const node = checkedCompilerLayout(createBaseNode<JSDocLinkPlain>(SyntaxKind.JSDocLinkPlain), checked_isJSDocLinkPlain);
        node.name = name;
        node.text = text;
        return node;
    }
    // @api
    function updateJSDocLinkPlain(node: JSDocLinkPlain, name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkPlain {
        return node.name !== name
            ? update(createJSDocLinkPlain(name, text), node)
            : node;
    }
    // @api
    function updateJSDocImplementsTag(node: JSDocImplementsTag, tagName: Identifier = getDefaultTagName(node), className: JSDocImplementsTag["class"], comment: string | NodeArray<JSDocComment> | undefined): JSDocImplementsTag {
        return node.tagName !== tagName
            || node.class !== className
            || node.comment !== comment
            ? update(createJSDocImplementsTag(tagName, className, comment), node)
            : node;
    }
    // @api
    // createJSDocAuthorTag
    // createJSDocClassTag
    // createJSDocPublicTag
    // createJSDocPrivateTag
    // createJSDocProtectedTag
    // createJSDocReadonlyTag
    // createJSDocDeprecatedTag
    function createJSDocSimpleTagWorker<K extends JSDocSimpleTagKind>(kind: K, tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>) {
        const node = createBaseJSDocTag<K>(kind, tagName ?? createIdentifier(getDefaultTagNameForKind(kind)), comment);
        return node;
    }
    // @api
    // updateJSDocAuthorTag
    // updateJSDocClassTag
    // updateJSDocPublicTag
    // updateJSDocPrivateTag
    // updateJSDocProtectedTag
    // updateJSDocReadonlyTag
    // updateJSDocDeprecatedTag
    function updateJSDocSimpleTagWorker<K extends JSDocSimpleTagKind>(kind: K, node: FactoryNodeLayouts[K], tagName: Identifier = getDefaultTagName(node), comment: string | NodeArray<JSDocComment> | undefined) {
        return node.tagName !== tagName
            || node.comment !== comment
            ? update(createJSDocSimpleTagWorker(kind, tagName, comment), node) :
            node;
    }
    // @api
    // createJSDocTypeTag
    // createJSDocReturnTag
    // createJSDocThisTag
    // createJSDocEnumTag
    // createJSDocSatisfiesTag
    function createJSDocTypeLikeTagWorker<K extends JSDocTypeLikeTagKind>(kind: K, tagName: Identifier | undefined, typeExpression?: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>) {
        const node = createBaseJSDocTag<K>(kind, tagName ?? createIdentifier(getDefaultTagNameForKind(kind)), comment);
        node.typeExpression = typeExpression;
        return node;
    }
    // @api
    // updateJSDocTypeTag
    // updateJSDocReturnTag
    // updateJSDocThisTag
    // updateJSDocEnumTag
    // updateJSDocSatisfiesTag
    function updateJSDocTypeLikeTagWorker<K extends JSDocTypeLikeTagKind>(kind: K, node: FactoryNodeLayouts[K], tagName: Identifier = getDefaultTagName(node), typeExpression: JSDocTypeExpression | undefined, comment: string | NodeArray<JSDocComment> | undefined) {
        return node.tagName !== tagName
            || node.typeExpression !== typeExpression
            || node.comment !== comment
            ? update(createJSDocTypeLikeTagWorker(kind, tagName, typeExpression, comment), node)
            : node;
    }
    // @api
    function createJSDocUnknownTag(tagName: Identifier, comment?: string | NodeArray<JSDocComment>): JSDocUnknownTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocTag>(SyntaxKind.JSDocTag, tagName, comment);
        return node;
    }
    // @api
    function updateJSDocUnknownTag(node: JSDocUnknownTag, tagName: Identifier, comment: string | NodeArray<JSDocComment> | undefined): JSDocUnknownTag {
        return node.tagName !== tagName
            || node.comment !== comment
            ? update(createJSDocUnknownTag(tagName, comment), node)
            : node;
    }
    // @api
    function createJSDocEnumTag(tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>) {
        const node = createBaseJSDocTagDeclaration<typeof SyntaxKind.JSDocEnumTag>(SyntaxKind.JSDocEnumTag, tagName ?? createIdentifier(getDefaultTagNameForKind(SyntaxKind.JSDocEnumTag)), comment);
        node.typeExpression = typeExpression;
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateJSDocEnumTag(node: JSDocEnumTag, tagName: Identifier = getDefaultTagName(node), typeExpression: JSDocTypeExpression, comment: string | NodeArray<JSDocComment> | undefined) {
        return node.tagName !== tagName
            || node.typeExpression !== typeExpression
            || node.comment !== comment
            ? update(checkedCompilerLayout(createJSDocEnumTag(tagName, typeExpression, comment), isNodeLayout_99b92dd8f0c5), node)
            : node;
    }
    // @api
    function createJSDocImportTag(tagName: Identifier | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes?: ImportAttributes, comment?: string | NodeArray<JSDocComment>): JSDocImportTag {
        const node = createBaseJSDocTag<typeof SyntaxKind.JSDocImportTag>(SyntaxKind.JSDocImportTag, tagName ?? createIdentifier("import"), comment);
        node.importClause = importClause;
        node.moduleSpecifier = moduleSpecifier;
        node.attributes = attributes;
        node.comment = comment;
        return node;
    }
    function updateJSDocImportTag(node: JSDocImportTag, tagName: Identifier | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes: ImportAttributes | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocImportTag {
        return node.tagName !== tagName
            || node.comment !== comment
            || node.importClause !== importClause
            || node.moduleSpecifier !== moduleSpecifier
            || node.attributes !== attributes
            ? update(createJSDocImportTag(tagName, importClause, moduleSpecifier, attributes, comment), node)
            : node;
    }
    // @api
    function createJSDocText(text: string): JSDocText {
        const node = requireFactoryNodeKind(createBaseNode<JSDocText>(SyntaxKind.JSDocText), SyntaxKind.JSDocText);
        node.text = text;
        return node;
    }
    // @api
    function updateJSDocText(node: JSDocText, text: string): JSDocText {
        return node.text !== text
            ? update(createJSDocText(text), node)
            : node;
    }
    // @api
    function createJSDocComment(comment?: string | NodeArray<JSDocComment> | undefined, tags?: readonly JSDocTag[] | undefined) {
        const node = checkedCompilerLayout(createBaseNode<JSDoc>(SyntaxKind.JSDoc), checked_isJSDoc);
        node.comment = comment;
        node.tags = asNodeArray(tags);
        return node;
    }
    // @api
    function updateJSDocComment(node: JSDoc, comment: string | NodeArray<JSDocComment> | undefined, tags: readonly JSDocTag[] | undefined) {
        return node.comment !== comment
            || node.tags !== tags
            ? update(createJSDocComment(comment, tags), node)
            : node;
    }
    //
    // JSX
    //
    // @api
    function createJsxElement(openingElement: JsxOpeningElement, children: readonly JsxChild[], closingElement: JsxClosingElement) {
        const node = checkedCompilerLayout(createBaseNode<JsxElement>(SyntaxKind.JsxElement), checked_isJsxElement);
        node.openingElement = openingElement;
        node.children = createNodeArray(children);
        node.closingElement = closingElement;
        node.transformFlags |= propagateChildFlags(node.openingElement) |
            propagateChildrenFlags(node.children) |
            propagateChildFlags(node.closingElement) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxElement(node: JsxElement, openingElement: JsxOpeningElement, children: readonly JsxChild[], closingElement: JsxClosingElement) {
        return node.openingElement !== openingElement
            || node.children !== children
            || node.closingElement !== closingElement
            ? update(createJsxElement(openingElement, children, closingElement), node)
            : node;
    }
    // @api
    function createJsxSelfClosingElement(tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes) {
        const node = checkedCompilerLayout(createBaseNode<JsxSelfClosingElement>(SyntaxKind.JsxSelfClosingElement), checked_isJsxSelfClosingElement);
        node.tagName = tagName;
        node.typeArguments = asNodeArray(typeArguments);
        node.attributes = attributes;
        node.transformFlags |= propagateChildFlags(node.tagName) |
            propagateChildrenFlags(node.typeArguments) |
            propagateChildFlags(node.attributes) |
            TransformFlags.ContainsJsx;
        if (node.typeArguments) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        return node;
    }
    // @api
    function updateJsxSelfClosingElement(node: JsxSelfClosingElement, tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes) {
        return node.tagName !== tagName
            || node.typeArguments !== typeArguments
            || node.attributes !== attributes
            ? update(createJsxSelfClosingElement(tagName, typeArguments, attributes), node)
            : node;
    }
    // @api
    function createJsxOpeningElement(tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes) {
        const node = checkedCompilerLayout(createBaseNode<JsxOpeningElement>(SyntaxKind.JsxOpeningElement), checked_isJsxOpeningElement);
        node.tagName = tagName;
        node.typeArguments = asNodeArray(typeArguments);
        node.attributes = attributes;
        node.transformFlags |= propagateChildFlags(node.tagName) |
            propagateChildrenFlags(node.typeArguments) |
            propagateChildFlags(node.attributes) |
            TransformFlags.ContainsJsx;
        if (typeArguments) {
            node.transformFlags |= TransformFlags.ContainsTypeScript;
        }
        return node;
    }
    // @api
    function updateJsxOpeningElement(node: JsxOpeningElement, tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes) {
        return node.tagName !== tagName
            || node.typeArguments !== typeArguments
            || node.attributes !== attributes
            ? update(createJsxOpeningElement(tagName, typeArguments, attributes), node)
            : node;
    }
    // @api
    function createJsxClosingElement(tagName: JsxTagNameExpression) {
        const node = checkedCompilerLayout(createBaseNode<JsxClosingElement>(SyntaxKind.JsxClosingElement), checked_isJsxClosingElement);
        node.tagName = tagName;
        node.transformFlags |= propagateChildFlags(node.tagName) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxClosingElement(node: JsxClosingElement, tagName: JsxTagNameExpression) {
        return node.tagName !== tagName
            ? update(createJsxClosingElement(tagName), node)
            : node;
    }
    // @api
    function createJsxFragment(openingFragment: JsxOpeningFragment, children: readonly JsxChild[], closingFragment: JsxClosingFragment) {
        const node = checkedCompilerLayout(createBaseNode<JsxFragment>(SyntaxKind.JsxFragment), checked_isJsxFragment);
        node.openingFragment = openingFragment;
        node.children = createNodeArray(children);
        node.closingFragment = closingFragment;
        node.transformFlags |= propagateChildFlags(node.openingFragment) |
            propagateChildrenFlags(node.children) |
            propagateChildFlags(node.closingFragment) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxFragment(node: JsxFragment, openingFragment: JsxOpeningFragment, children: readonly JsxChild[], closingFragment: JsxClosingFragment) {
        return node.openingFragment !== openingFragment
            || node.children !== children
            || node.closingFragment !== closingFragment
            ? update(createJsxFragment(openingFragment, children, closingFragment), node)
            : node;
    }
    // @api
    function createJsxText(text: string, containsOnlyTriviaWhiteSpaces?: boolean) {
        const node = checkedCompilerLayout(createBaseNode<JsxText>(SyntaxKind.JsxText), checked_isJsxText);
        node.text = text;
        node.containsOnlyTriviaWhiteSpaces = !!containsOnlyTriviaWhiteSpaces;
        node.transformFlags |= TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxText(node: JsxText, text: string, containsOnlyTriviaWhiteSpaces?: boolean) {
        return node.text !== text
            || node.containsOnlyTriviaWhiteSpaces !== containsOnlyTriviaWhiteSpaces
            ? update(createJsxText(text, containsOnlyTriviaWhiteSpaces), node)
            : node;
    }
    // @api
    function createJsxOpeningFragment() {
        const node = checkedCompilerLayout(createBaseNode<JsxOpeningFragment>(SyntaxKind.JsxOpeningFragment), checked_isJsxOpeningFragment);
        node.transformFlags |= TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function createJsxJsxClosingFragment() {
        const node = checkedCompilerLayout(createBaseNode<JsxClosingFragment>(SyntaxKind.JsxClosingFragment), checked_isJsxClosingFragment);
        node.transformFlags |= TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function createJsxAttribute(name: JsxAttributeName, initializer: JsxAttributeValue | undefined) {
        const node = checkedCompilerLayout(createBaseDeclaration<JsxAttribute>(SyntaxKind.JsxAttribute), checked_isJsxAttribute);
        node.name = name;
        node.initializer = initializer;
        node.transformFlags |= propagateChildFlags(node.name) |
            propagateChildFlags(node.initializer) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxAttribute(node: JsxAttribute, name: JsxAttributeName, initializer: JsxAttributeValue | undefined) {
        return node.name !== name
            || node.initializer !== initializer
            ? update(createJsxAttribute(name, initializer), node)
            : node;
    }
    // @api
    function createJsxAttributes(properties: readonly JsxAttributeLike[]) {
        const node = checkedCompilerLayout(createBaseDeclaration<JsxAttributes>(SyntaxKind.JsxAttributes), checked_isJsxAttributes);
        node.properties = createNodeArray(properties);
        node.transformFlags |= propagateChildrenFlags(node.properties) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxAttributes(node: JsxAttributes, properties: readonly JsxAttributeLike[]) {
        return node.properties !== properties
            ? update(createJsxAttributes(properties), node)
            : node;
    }
    // @api
    function createJsxSpreadAttribute(expression: Expression) {
        const node = checkedCompilerLayout(createBaseNode<JsxSpreadAttribute>(SyntaxKind.JsxSpreadAttribute), checked_isJsxSpreadAttribute);
        node.expression = expression;
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxSpreadAttribute(node: JsxSpreadAttribute, expression: Expression) {
        return node.expression !== expression
            ? update(createJsxSpreadAttribute(expression), node)
            : node;
    }
    // @api
    function createJsxExpression(dotDotDotToken: DotDotDotToken | undefined, expression: Expression | undefined) {
        const node = checkedCompilerLayout(createBaseNode<JsxExpression>(SyntaxKind.JsxExpression), checked_isJsxExpression);
        node.dotDotDotToken = dotDotDotToken;
        node.expression = expression;
        node.transformFlags |= propagateChildFlags(node.dotDotDotToken) |
            propagateChildFlags(node.expression) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxExpression(node: JsxExpression, expression: Expression | undefined) {
        return node.expression !== expression
            ? update(createJsxExpression(node.dotDotDotToken, expression), node)
            : node;
    }
    // @api
    function createJsxNamespacedName(namespace: Identifier, name: Identifier) {
        const node = checkedCompilerLayout(createBaseNode<JsxNamespacedName>(SyntaxKind.JsxNamespacedName), checked_isJsxNamespacedName);
        node.namespace = namespace;
        node.name = name;
        node.transformFlags |= propagateChildFlags(node.namespace) |
            propagateChildFlags(node.name) |
            TransformFlags.ContainsJsx;
        return node;
    }
    // @api
    function updateJsxNamespacedName(node: JsxNamespacedName, namespace: Identifier, name: Identifier) {
        return node.namespace !== namespace
            || node.name !== name
            ? update(createJsxNamespacedName(namespace, name), node)
            : node;
    }
    //
    // Clauses
    //
    // @api
    function createCaseClause(expression: Expression, statements: readonly Statement[]) {
        const node = checkedCompilerLayout(createBaseNode<CaseClause>(SyntaxKind.CaseClause), checked_isCaseClause);
        node.expression = parenthesizerRules().parenthesizeExpressionForDisallowedComma(expression);
        node.statements = createNodeArray(statements);
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildrenFlags(node.statements);
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateCaseClause(node: CaseClause, expression: Expression, statements: readonly Statement[]) {
        return node.expression !== expression
            || node.statements !== statements
            ? update(createCaseClause(expression, statements), node)
            : node;
    }
    // @api
    function createDefaultClause(statements: readonly Statement[]) {
        const node = checkedCompilerLayout(createBaseNode<DefaultClause>(SyntaxKind.DefaultClause), checked_isDefaultClause);
        node.statements = createNodeArray(statements);
        node.transformFlags = propagateChildrenFlags(node.statements);
        return node;
    }
    // @api
    function updateDefaultClause(node: DefaultClause, statements: readonly Statement[]) {
        return node.statements !== statements
            ? update(createDefaultClause(statements), node)
            : node;
    }
    // @api
    function createHeritageClause(token: HeritageClause["token"], types: readonly ExpressionWithTypeArguments[]) {
        const node = checkedCompilerLayout(createBaseNode<HeritageClause>(SyntaxKind.HeritageClause), checked_isHeritageClause);
        node.token = token;
        node.types = createNodeArray(types);
        node.transformFlags |= propagateChildrenFlags(node.types);
        switch (token) {
            case SyntaxKind.ExtendsKeyword:
                node.transformFlags |= TransformFlags.ContainsES2015;
                break;
            case SyntaxKind.ImplementsKeyword:
                node.transformFlags |= TransformFlags.ContainsTypeScript;
                break;
            default:
                return Debug.assertNever(token);
        }
        return node;
    }
    // @api
    function updateHeritageClause(node: HeritageClause, types: readonly ExpressionWithTypeArguments[]) {
        return node.types !== types
            ? update(createHeritageClause(node.token, types), node)
            : node;
    }
    // @api
    function createCatchClause(variableDeclaration: string | BindingName | VariableDeclaration | undefined, block: Block) {
        const node = checkedCompilerLayout(createBaseNode<CatchClause>(SyntaxKind.CatchClause), checked_isCatchClause);
        node.variableDeclaration = asVariableDeclaration(variableDeclaration);
        node.block = block;
        node.transformFlags |= propagateChildFlags(node.variableDeclaration) |
            propagateChildFlags(node.block) |
            (!variableDeclaration ? TransformFlags.ContainsES2019 : TransformFlags.None);
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        return node;
    }
    // @api
    function updateCatchClause(node: CatchClause, variableDeclaration: VariableDeclaration | undefined, block: Block) {
        return node.variableDeclaration !== variableDeclaration
            || node.block !== block
            ? update(createCatchClause(variableDeclaration, block), node)
            : node;
    }
    //
    // Property assignments
    //
    // @api
    function createPropertyAssignment(name: string | PropertyName, initializer: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<PropertyAssignment>(SyntaxKind.PropertyAssignment), checked_isPropertyAssignment);
        node.name = asName(name);
        node.initializer = parenthesizerRules().parenthesizeExpressionForDisallowedComma(initializer);
        node.transformFlags |= propagateNameFlags(node.name) |
            propagateChildFlags(node.initializer);
        node.modifiers = undefined; // initialized by parser to report grammar errors
        node.questionToken = undefined; // initialized by parser to report grammar errors
        node.exclamationToken = undefined; // initialized by parser to report grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updatePropertyAssignment(node: PropertyAssignment, name: PropertyName, initializer: Expression) {
        return node.name !== name
            || node.initializer !== initializer
            ? finishUpdatePropertyAssignment(createPropertyAssignment(name, initializer), node)
            : node;
    }
    function finishUpdatePropertyAssignment(updated: Mutable<PropertyAssignment>, original: PropertyAssignment) {
        // copy children used only for error reporting
        if (updated !== original) {
            // copy children used only for error reporting
            updated.modifiers = original.modifiers;
            updated.questionToken = original.questionToken;
            updated.exclamationToken = original.exclamationToken;
        }
        return update(updated, original);
    }
    // @api
    function createShorthandPropertyAssignment(name: string | Identifier, objectAssignmentInitializer?: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<ShorthandPropertyAssignment>(SyntaxKind.ShorthandPropertyAssignment), checked_isShorthandPropertyAssignment);
        node.name = asName(name);
        node.objectAssignmentInitializer = objectAssignmentInitializer && parenthesizerRules().parenthesizeExpressionForDisallowedComma(objectAssignmentInitializer);
        node.transformFlags |= propagateIdentifierNameFlags(node.name) |
            propagateChildFlags(node.objectAssignmentInitializer) |
            TransformFlags.ContainsES2015;
        node.equalsToken = undefined; // initialized by parser to report grammar errors
        node.modifiers = undefined; // initialized by parser to report grammar errors
        node.questionToken = undefined; // initialized by parser to report grammar errors
        node.exclamationToken = undefined; // initialized by parser to report grammar errors
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateShorthandPropertyAssignment(node: ShorthandPropertyAssignment, name: Identifier, objectAssignmentInitializer: Expression | undefined) {
        return node.name !== name
            || node.objectAssignmentInitializer !== objectAssignmentInitializer
            ? finishUpdateShorthandPropertyAssignment(createShorthandPropertyAssignment(name, objectAssignmentInitializer), node)
            : node;
    }
    function finishUpdateShorthandPropertyAssignment(updated: Mutable<ShorthandPropertyAssignment>, original: ShorthandPropertyAssignment) {
        if (updated !== original) {
            // copy children used only for error reporting
            updated.modifiers = original.modifiers;
            updated.questionToken = original.questionToken;
            updated.exclamationToken = original.exclamationToken;
            updated.equalsToken = original.equalsToken;
        }
        return update(updated, original);
    }
    // @api
    function createSpreadAssignment(expression: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<SpreadAssignment>(SyntaxKind.SpreadAssignment), checked_isSpreadAssignment);
        node.expression = parenthesizerRules().parenthesizeExpressionForDisallowedComma(expression);
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsES2018 |
            TransformFlags.ContainsObjectRestOrSpread;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateSpreadAssignment(node: SpreadAssignment, expression: Expression) {
        return node.expression !== expression
            ? update(createSpreadAssignment(expression), node)
            : node;
    }
    //
    // Enum
    //
    // @api
    function createEnumMember(name: string | PropertyName, initializer?: Expression) {
        const node = checkedCompilerLayout(createBaseDeclaration<EnumMember>(SyntaxKind.EnumMember), checked_isEnumMember);
        node.name = asName(name);
        node.initializer = initializer && parenthesizerRules().parenthesizeExpressionForDisallowedComma(initializer);
        node.transformFlags |= propagateChildFlags(node.name) |
            propagateChildFlags(node.initializer) |
            TransformFlags.ContainsTypeScript;
        node.jsDoc = undefined; // initialized by parser (JsDocContainer)
        return node;
    }
    // @api
    function updateEnumMember(node: EnumMember, name: PropertyName, initializer: Expression | undefined) {
        return node.name !== name
            || node.initializer !== initializer
            ? update(createEnumMember(name, initializer), node)
            : node;
    }
    //
    // Top-level nodes
    //
    // @api
    function createSourceFile(statements: readonly Statement[], endOfFileToken: EndOfFileToken, flags: NodeFlags) {
        const node = checkedCompilerLayout(baseFactory.createBaseSourceFileNode(SyntaxKind.SourceFile), checked_isSourceFile);
        node.statements = createNodeArray(statements);
        node.endOfFileToken = endOfFileToken;
        node.flags |= flags;
        node.text = "";
        node.fileName = "";
        node.path = "";
        node.resolvedPath = "";
        node.originalFileName = "";
        node.languageVersion = ScriptTarget.ES5;
        node.languageVariant = 0;
        node.scriptKind = 0;
        node.isDeclarationFile = false;
        node.hasNoDefaultLib = false;
        node.transformFlags |= propagateChildrenFlags(node.statements) |
            propagateChildFlags(node.endOfFileToken);
        node.locals = undefined; // initialized by binder (LocalsContainer)
        node.nextContainer = undefined; // initialized by binder (LocalsContainer)
        node.endFlowNode = undefined;
        node.nodeCount = 0;
        node.identifierCount = 0;
        node.symbolCount = 0;
        node.parseDiagnostics = undefined;
        node.bindDiagnostics = undefined;
        node.bindSuggestionDiagnostics = undefined;
        node.lineMap = undefined;
        node.externalModuleIndicator = undefined;
        node.setExternalModuleIndicator = undefined;
        node.pragmas = undefined;
        node.checkJsDirective = undefined;
        node.referencedFiles = undefined;
        node.typeReferenceDirectives = undefined;
        node.libReferenceDirectives = undefined;
        node.amdDependencies = undefined;
        node.commentDirectives = undefined;
        node.identifiers = undefined;
        node.packageJsonLocations = undefined;
        node.packageJsonScope = undefined;
        node.imports = undefined;
        node.moduleAugmentations = undefined;
        node.ambientModuleNames = undefined;
        node.classifiableNames = undefined;
        node.impliedNodeFormat = undefined;
        return node;
    }
    function createRedirectedSourceFile(redirectInfo: RedirectInfo) {
        const node: SourceFile = Object.create(redirectInfo.redirectTarget);
        Object.defineProperties(node, {
            id: {
                get(this: SourceFile) {
                    return (this.redirectInfo)!.redirectTarget.id;
                },
                set(this: SourceFile, value: SourceFile["id"]) {
                    (this.redirectInfo)!.redirectTarget.id = value;
                },
            },
            symbol: {
                get(this: SourceFile) {
                    return (this.redirectInfo)!.redirectTarget.symbol;
                },
                set(this: SourceFile, value: SourceFile["symbol"]) {
                    (this.redirectInfo)!.redirectTarget.symbol = value;
                },
            },
        });
        node.redirectInfo = redirectInfo;
        return node;
    }
    function cloneRedirectedSourceFile(source: SourceFile) {
        const node = createRedirectedSourceFile((source.redirectInfo)!);
        node.flags |= source.flags & ~NodeFlags.Synthesized;
        node.fileName = source.fileName;
        node.path = source.path;
        node.resolvedPath = source.resolvedPath;
        node.originalFileName = source.originalFileName;
        node.packageJsonLocations = source.packageJsonLocations;
        node.packageJsonScope = source.packageJsonScope;
        node.emitNode = undefined;
        return node;
    }
    function cloneSourceFileWorker(source: SourceFile) {
        // TODO: This mechanism for cloning results in megamorphic property reads and writes. In future perf-related
        //       work, we should consider switching explicit property assignments instead of using `for..in`.
        const node = checkedCompilerLayout(baseFactory.createBaseSourceFileNode(SyntaxKind.SourceFile), checked_isSourceFile);
        node.flags |= source.flags & ~NodeFlags.Synthesized;
        for (const p in source) {
            if (hasProperty(node, p) || !hasProperty(source, p)) {
                continue;
            }
            if (p === "emitNode") {
                node.emitNode = undefined;
                continue;
            }
            dictionaryValue(node)[p] = dictionaryValue(source)[p];
        }
        return node;
    }
    function cloneSourceFile(source: SourceFile) {
        const node = source.redirectInfo ? cloneRedirectedSourceFile(source) : cloneSourceFileWorker(source);
        setOriginal(node, source);
        return node;
    }
    function cloneSourceFileWithChanges(source: SourceFile, statements: readonly Statement[], isDeclarationFile: boolean, referencedFiles: readonly FileReference[] | undefined, typeReferences: readonly FileReference[] | undefined, hasNoDefaultLib: boolean | undefined, libReferences: readonly FileReference[] | undefined) {
        const node = cloneSourceFile(source);
        node.statements = createNodeArray(statements);
        node.isDeclarationFile = isDeclarationFile;
        node.referencedFiles = referencedFiles;
        node.typeReferenceDirectives = typeReferences;
        node.hasNoDefaultLib = hasNoDefaultLib;
        node.libReferenceDirectives = libReferences;
        node.transformFlags = propagateChildrenFlags(node.statements) |
            propagateChildFlags(node.endOfFileToken);
        return node;
    }
    // @api
    function updateSourceFile(node: SourceFile, statements: readonly Statement[], isDeclarationFile = node.isDeclarationFile, referencedFiles = node.referencedFiles, typeReferenceDirectives = node.typeReferenceDirectives, hasNoDefaultLib = node.hasNoDefaultLib, libReferenceDirectives = node.libReferenceDirectives) {
        return node.statements !== statements
            || node.isDeclarationFile !== isDeclarationFile
            || node.referencedFiles !== referencedFiles
            || node.typeReferenceDirectives !== typeReferenceDirectives
            || node.hasNoDefaultLib !== hasNoDefaultLib
            || node.libReferenceDirectives !== libReferenceDirectives
            ? update(cloneSourceFileWithChanges(node, statements, isDeclarationFile, referencedFiles, typeReferenceDirectives, hasNoDefaultLib, libReferenceDirectives), node)
            : node;
    }
    // @api
    function createBundle(sourceFiles: readonly SourceFile[]) {
        const node = checkedCompilerLayout(createBaseNode<Bundle>(SyntaxKind.Bundle), checked_isBundle);
        node.sourceFiles = sourceFiles;
        node.syntheticFileReferences = undefined;
        node.syntheticTypeReferences = undefined;
        node.syntheticLibReferences = undefined;
        node.hasNoDefaultLib = undefined;
        return node;
    }
    // @api
    function updateBundle(node: Bundle, sourceFiles: readonly SourceFile[]) {
        return node.sourceFiles !== sourceFiles
            ? update(createBundle(sourceFiles), node)
            : node;
    }
    //
    // Synthetic Nodes (used by checker)
    //
    // @api
    function createSyntheticExpression(type: Type, isSpread = false, tupleNameSource?: ParameterDeclaration | NamedTupleMember) {
        const node = checkedCompilerLayout(createBaseNode<SyntheticExpression>(SyntaxKind.SyntheticExpression), checked_isSyntheticExpression);
        node.type = type;
        node.isSpread = isSpread;
        node.tupleNameSource = tupleNameSource;
        return node;
    }
    // @api
    function createSyntaxList(children: readonly Node[]) {
        const node = checkedCompilerLayout(createBaseNode<SyntaxList>(SyntaxKind.SyntaxList), checked_isSyntaxList);
        node._children = children;
        return node;
    }
    //
    // Transformation nodes
    //
    /**
     * Creates a synthetic statement to act as a placeholder for a not-emitted statement in
     * order to preserve comments.
     *
     * @param original The original statement.
     */
    // @api
    function createNotEmittedStatement(original: Node) {
        const node = checkedCompilerLayout(createBaseNode<NotEmittedStatement>(SyntaxKind.NotEmittedStatement), checked_isNotEmittedStatement);
        node.original = original;
        setTextRange(node, original);
        return node;
    }
    /**
     * Creates a synthetic expression to act as a placeholder for a not-emitted expression in
     * order to preserve comments or sourcemap positions.
     *
     * @param expression The inner expression to emit.
     * @param original The original outer expression.
     */
    // @api
    function createPartiallyEmittedExpression(expression: Expression, original?: Node) {
        const node = checkedCompilerLayout(createBaseNode<PartiallyEmittedExpression>(SyntaxKind.PartiallyEmittedExpression), checked_isPartiallyEmittedExpression);
        node.expression = expression;
        node.original = original;
        node.transformFlags |= propagateChildFlags(node.expression) |
            TransformFlags.ContainsTypeScript;
        setTextRange(node, original);
        return node;
    }
    // @api
    function updatePartiallyEmittedExpression(node: PartiallyEmittedExpression, expression: Expression) {
        return node.expression !== expression
            ? update(createPartiallyEmittedExpression(expression, node.original), node)
            : node;
    }
    // @api
    function createNotEmittedTypeElement() {
        return requireFactoryNodeKind(createBaseNode<NotEmittedTypeElement>(SyntaxKind.NotEmittedTypeElement), SyntaxKind.NotEmittedTypeElement);
    }
    function flattenCommaElements(node: Expression): Expression | readonly Expression[] {
        if (nodeIsSynthesized(node) && !isParseTreeNode(node) && !node.original && !node.emitNode && !node.id) {
            if (isCommaListExpression(node)) {
                return node.elements;
            }
            if (isBinaryExpression(node) && isCommaToken(node.operatorToken)) {
                return [node.left, node.right];
            }
        }
        return node;
    }
    // @api
    function createCommaListExpression(elements: readonly Expression[]) {
        const node = checkedCompilerLayout(createBaseNode<CommaListExpression>(SyntaxKind.CommaListExpression), checked_isCommaListExpression);
        node.elements = createNodeArray(sameFlatMap(elements, flattenCommaElements));
        node.transformFlags |= propagateChildrenFlags(node.elements);
        return node;
    }
    // @api
    function updateCommaListExpression(node: CommaListExpression, elements: readonly Expression[]) {
        return node.elements !== elements
            ? update(createCommaListExpression(elements), node)
            : node;
    }
    // @api
    function createSyntheticReferenceExpression(expression: Expression, thisArg: Expression) {
        const node = requireFactoryNodeKind(createBaseNode<SyntheticReferenceExpression>(SyntaxKind.SyntheticReferenceExpression), SyntaxKind.SyntheticReferenceExpression);
        node.expression = expression;
        node.thisArg = thisArg;
        node.transformFlags |= propagateChildFlags(node.expression) |
            propagateChildFlags(node.thisArg);
        return node;
    }
    // @api
    function updateSyntheticReferenceExpression(node: SyntheticReferenceExpression, expression: Expression, thisArg: Expression) {
        return node.expression !== expression
            || node.thisArg !== thisArg
            ? update(checkedCompilerLayout(createSyntheticReferenceExpression(expression, thisArg), isNodeLayout_ae2cefde45f1), node)
            : node;
    }
    function cloneGeneratedIdentifier(node: GeneratedIdentifier): GeneratedIdentifier {
        const clone = createBaseIdentifier(node.escapedText);
        clone.flags |= node.flags & ~NodeFlags.Synthesized;
        clone.transformFlags = node.transformFlags;
        setOriginal(clone, node);
        setIdentifierAutoGenerate(clone, { ...node.emitNode.autoGenerate });
        return checkedCompilerLayout(clone, checked_isGeneratedIdentifier);
    }
    function cloneIdentifier(node: Identifier): Identifier {
        const clone = createBaseIdentifier(node.escapedText);
        clone.flags |= node.flags & ~NodeFlags.Synthesized;
        clone.jsDoc = node.jsDoc;
        clone.flowNode = node.flowNode;
        clone.symbol = node.symbol;
        clone.transformFlags = node.transformFlags;
        setOriginal(clone, node);
        // clone type arguments for emitter/typeWriter
        const typeArguments = getIdentifierTypeArguments(node);
        if (typeArguments)
            setIdentifierTypeArguments(clone, typeArguments);
        return clone;
    }
    function cloneGeneratedPrivateIdentifier(node: GeneratedPrivateIdentifier): GeneratedPrivateIdentifier {
        const clone = createBasePrivateIdentifier(node.escapedText);
        clone.flags |= node.flags & ~NodeFlags.Synthesized;
        clone.transformFlags = node.transformFlags;
        setOriginal(clone, node);
        setIdentifierAutoGenerate(clone, { ...node.emitNode.autoGenerate });
        return checkedCompilerLayout(clone, checked_isGeneratedPrivateIdentifier);
    }
    function clonePrivateIdentifier(node: PrivateIdentifier): PrivateIdentifier {
        const clone = createBasePrivateIdentifier(node.escapedText);
        clone.flags |= node.flags & ~NodeFlags.Synthesized;
        clone.transformFlags = node.transformFlags;
        setOriginal(clone, node);
        return clone;
    }
    // @api
    function cloneNode<T extends Node | undefined>(node: T): T;
    function cloneNode<T extends Node>(node: T) {
        // We don't use "clone" from core.ts here, as we need to preserve the prototype chain of
        // the original node. We also need to exclude specific properties and only include own-
        // properties (to skip members already defined on the shared prototype).
        if (node === undefined) {
            return node;
        }
        if (isSourceFile(node)) {
            return cloneSourceFile(node);
        }
        if (isGeneratedIdentifier(node)) {
            return cloneGeneratedIdentifier(node);
        }
        if (isIdentifier(node)) {
            return cloneIdentifier(node);
        }
        if (isGeneratedPrivateIdentifier(node)) {
            return cloneGeneratedPrivateIdentifier(node);
        }
        if (isPrivateIdentifier(node)) {
            return clonePrivateIdentifier(node);
        }
        const clone = !isNodeKind(node.kind) ? baseFactory.createBaseTokenNode(node.kind) :
            baseFactory.createBaseNode(node.kind);
        (clone).flags |= node.flags & ~NodeFlags.Synthesized;
        (clone).transformFlags = node.transformFlags;
        setOriginal(clone, node);
        for (const key in node) {
            if (hasProperty(clone, key) || !hasProperty(node, key)) {
                continue;
            }
            dictionaryValue(clone)[key] = node[key];
        }
        return clone;
    }
    // compound nodes
    function createImmediatelyInvokedFunctionExpression(statements: readonly Statement[]): ImmediatelyInvokedFunctionExpression;
    function createImmediatelyInvokedFunctionExpression(statements: readonly Statement[], param: ParameterDeclaration, paramValue: Expression): ImmediatelyInvokedFunctionExpression;
    function createImmediatelyInvokedFunctionExpression(statements: readonly Statement[], param?: ParameterDeclaration, paramValue?: Expression) {
        return createCallExpression(createFunctionExpression(
        /*modifiers*/ undefined, 
        /*asteriskToken*/ undefined, 
        /*name*/ undefined, 
        /*typeParameters*/ undefined, 
        /*parameters*/ param ? [param] : [], 
        /*type*/ undefined, createBlock(statements, /*multiLine*/ true)), 
        /*typeArguments*/ undefined, 
        /*argumentsArray*/ paramValue ? [paramValue] : []);
    }
    function createImmediatelyInvokedArrowFunction(statements: readonly Statement[]): ImmediatelyInvokedArrowFunction;
    function createImmediatelyInvokedArrowFunction(statements: readonly Statement[], param: ParameterDeclaration, paramValue: Expression): ImmediatelyInvokedArrowFunction;
    function createImmediatelyInvokedArrowFunction(statements: readonly Statement[], param?: ParameterDeclaration, paramValue?: Expression) {
        return createCallExpression(createArrowFunction(
        /*modifiers*/ undefined, 
        /*typeParameters*/ undefined, 
        /*parameters*/ param ? [param] : [], 
        /*type*/ undefined, 
        /*equalsGreaterThanToken*/ undefined, createBlock(statements, /*multiLine*/ true)), 
        /*typeArguments*/ undefined, 
        /*argumentsArray*/ paramValue ? [paramValue] : []);
    }
    function createVoidZero() {
        return createVoidExpression(createNumericLiteral("0"));
    }
    function createExportDefault(expression: Expression) {
        return createExportAssignment(
        /*modifiers*/ undefined, 
        /*isExportEquals*/ false, expression);
    }
    function createExternalModuleExport(exportName: Identifier) {
        return createExportDeclaration(
        /*modifiers*/ undefined, 
        /*isTypeOnly*/ false, createNamedExports([
            createExportSpecifier(/*isTypeOnly*/ false, /*propertyName*/ undefined, exportName),
        ]));
    }
    //
    // Utilities
    //
    function createTypeCheck(value: Expression, tag: TypeOfTag) {
        return tag === "null" ? factory.createStrictEquality(value, createNull()) :
            tag === "undefined" ? factory.createStrictEquality(value, createVoidZero()) :
                factory.createStrictEquality(createTypeOfExpression(value), createStringLiteral(tag));
    }
    function createIsNotTypeCheck(value: Expression, tag: TypeOfTag) {
        return tag === "null" ? factory.createStrictInequality(value, createNull()) :
            tag === "undefined" ? factory.createStrictInequality(value, createVoidZero()) :
                factory.createStrictInequality(createTypeOfExpression(value), createStringLiteral(tag));
    }
    function createMethodCall(object: Expression, methodName: string | Identifier, argumentsList: readonly Expression[]) {
        // Preserve the optionality of `object`.
        if (isCallChain(object)) {
            return createCallChain(createPropertyAccessChain(object, /*questionDotToken*/ undefined, methodName), 
            /*questionDotToken*/ undefined, 
            /*typeArguments*/ undefined, argumentsList);
        }
        return createCallExpression(createPropertyAccessExpression(object, methodName), 
        /*typeArguments*/ undefined, argumentsList);
    }
    function createFunctionBindCall(target: Expression, thisArg: Expression, argumentsList: readonly Expression[]) {
        return createMethodCall(target, "bind", [thisArg, ...argumentsList]);
    }
    function createFunctionCallCall(target: Expression, thisArg: Expression, argumentsList: readonly Expression[]) {
        return createMethodCall(target, "call", [thisArg, ...argumentsList]);
    }
    function createFunctionApplyCall(target: Expression, thisArg: Expression, argumentsExpression: Expression) {
        return createMethodCall(target, "apply", [thisArg, argumentsExpression]);
    }
    function createGlobalMethodCall(globalObjectName: string, methodName: string, argumentsList: readonly Expression[]) {
        return createMethodCall(createIdentifier(globalObjectName), methodName, argumentsList);
    }
    function createArraySliceCall(array: Expression, start?: number | Expression) {
        return createMethodCall(array, "slice", start === undefined ? [] : [asExpression(start)]);
    }
    function createArrayConcatCall(array: Expression, argumentsList: readonly Expression[]) {
        return createMethodCall(array, "concat", argumentsList);
    }
    function createObjectDefinePropertyCall(target: Expression, propertyName: string | Expression, attributes: Expression) {
        return createGlobalMethodCall("Object", "defineProperty", [target, asExpression(propertyName), attributes]);
    }
    function createObjectGetOwnPropertyDescriptorCall(target: Expression, propertyName: string | Expression) {
        return createGlobalMethodCall("Object", "getOwnPropertyDescriptor", [target, asExpression(propertyName)]);
    }
    function createReflectGetCall(target: Expression, propertyKey: Expression, receiver?: Expression): CallExpression {
        return createGlobalMethodCall("Reflect", "get", receiver ? [target, propertyKey, receiver] : [target, propertyKey]);
    }
    function createReflectSetCall(target: Expression, propertyKey: Expression, value: Expression, receiver?: Expression): CallExpression {
        return createGlobalMethodCall("Reflect", "set", receiver ? [target, propertyKey, value, receiver] : [target, propertyKey, value]);
    }
    function tryAddPropertyAssignment(properties: PropertyAssignment[], propertyName: string, expression: Expression | undefined) {
        if (expression) {
            properties.push(createPropertyAssignment(propertyName, expression));
            return true;
        }
        return false;
    }
    function createPropertyDescriptor(attributes: PropertyDescriptorAttributes, singleLine?: boolean) {
        const properties: PropertyAssignment[] = [];
        tryAddPropertyAssignment(properties, "enumerable", asExpression(attributes.enumerable));
        tryAddPropertyAssignment(properties, "configurable", asExpression(attributes.configurable));
        let isData = tryAddPropertyAssignment(properties, "writable", asExpression(attributes.writable));
        isData = tryAddPropertyAssignment(properties, "value", attributes.value) || isData;
        let isAccessor = tryAddPropertyAssignment(properties, "get", attributes.get);
        isAccessor = tryAddPropertyAssignment(properties, "set", attributes.set) || isAccessor;
        Debug.assert(!(isData && isAccessor), "A PropertyDescriptor may not be both an accessor descriptor and a data descriptor.");
        return createObjectLiteralExpression(properties, !singleLine);
    }
    function updateOuterExpression(outerExpression: OuterExpression, expression: Expression) {
        switch (outerExpression.kind) {
            case SyntaxKind.ParenthesizedExpression:
                return updateParenthesizedExpression(outerExpression, expression);
            case SyntaxKind.TypeAssertionExpression:
                return updateTypeAssertion(outerExpression, outerExpression.type, expression);
            case SyntaxKind.AsExpression:
                return updateAsExpression(outerExpression, expression, outerExpression.type);
            case SyntaxKind.SatisfiesExpression:
                return updateSatisfiesExpression(outerExpression, expression, outerExpression.type);
            case SyntaxKind.NonNullExpression:
                return updateNonNullExpression(outerExpression, expression);
            case SyntaxKind.ExpressionWithTypeArguments:
                return updateExpressionWithTypeArguments(outerExpression, expression, outerExpression.typeArguments);
            case SyntaxKind.PartiallyEmittedExpression:
                return updatePartiallyEmittedExpression(outerExpression, expression);
        }
    }
    /**
     * Determines whether a node is a parenthesized expression that can be ignored when recreating outer expressions.
     *
     * A parenthesized expression can be ignored when all of the following are true:
     *
     * - It's `pos` and `end` are not -1
     * - It does not have a custom source map range
     * - It does not have a custom comment range
     * - It does not have synthetic leading or trailing comments
     *
     * If an outermost parenthesized expression is ignored, but the containing expression requires a parentheses around
     * the expression to maintain precedence, a new parenthesized expression should be created automatically when
     * the containing expression is created/updated.
     */
    function isIgnorableParen(node: Expression) {
        return isParenthesizedExpression(node)
            && nodeIsSynthesized(node)
            && nodeIsSynthesized(getSourceMapRange(node))
            && nodeIsSynthesized(getCommentRange(node))
            && !some(getSyntheticLeadingComments(node))
            && !some(getSyntheticTrailingComments(node));
    }
    function restoreOuterExpressions(outerExpression: Expression | undefined, innerExpression: Expression, kinds: OuterExpressionKinds = OuterExpressionKinds.All): Expression {
        if (outerExpression && isOuterExpression(outerExpression, kinds) && !isIgnorableParen(outerExpression)) {
            return updateOuterExpression(outerExpression, restoreOuterExpressions(outerExpression.expression, innerExpression));
        }
        return innerExpression;
    }
    function restoreEnclosingLabel(node: Statement, outermostLabeledStatement: LabeledStatement | undefined, afterRestoreLabelCallback?: (node: LabeledStatement) => void): Statement {
        if (!outermostLabeledStatement) {
            return node;
        }
        const updated = updateLabeledStatement(outermostLabeledStatement, outermostLabeledStatement.label, isLabeledStatement(outermostLabeledStatement.statement)
            ? restoreEnclosingLabel(node, outermostLabeledStatement.statement)
            : node);
        if (afterRestoreLabelCallback) {
            afterRestoreLabelCallback(outermostLabeledStatement);
        }
        return updated;
    }
    function shouldBeCapturedInTempVariable(node: Expression, cacheIdentifiers: boolean): boolean {
        const target = skipParentheses(node);
        switch (target.kind) {
            case SyntaxKind.Identifier:
                return cacheIdentifiers;
            case SyntaxKind.ThisKeyword:
            case SyntaxKind.NumericLiteral:
            case SyntaxKind.BigIntLiteral:
            case SyntaxKind.StringLiteral:
                return false;
            case SyntaxKind.ArrayLiteralExpression:
                const elements = (checkedCompilerLayout(target, checked_isArrayLiteralExpression)).elements;
                if (elements.length === 0) {
                    return false;
                }
                return true;
            case SyntaxKind.ObjectLiteralExpression:
                return (checkedCompilerLayout(target, checked_isObjectLiteralExpression)).properties.length > 0;
            default:
                return true;
        }
    }
    function createCallBinding(expression: Expression, recordTempVariable: (temp: Identifier) => void, languageVersion?: ScriptTarget, cacheIdentifiers = false): CallBinding {
        const callee = skipOuterExpressions(expression, OuterExpressionKinds.All);
        let thisArg: Expression;
        let target: LeftHandSideExpression;
        if (isSuperProperty(callee)) {
            thisArg = createThis();
            target = callee;
        }
        else if (isSuperKeyword(callee)) {
            thisArg = createThis();
            target = languageVersion !== undefined && languageVersion < ScriptTarget.ES2015
                ? setTextRange(createIdentifier("_super"), callee)
                : callee;
        }
        else if (getEmitFlags(callee) & EmitFlags.HelperName) {
            thisArg = createVoidZero();
            target = parenthesizerRules().parenthesizeLeftSideOfAccess(callee, /*optionalChain*/ false);
        }
        else if (isPropertyAccessExpression(callee)) {
            if (shouldBeCapturedInTempVariable(callee.expression, cacheIdentifiers)) {
                // for `a.b()` target is `(_a = a).b` and thisArg is `_a`
                thisArg = createTempVariable(recordTempVariable);
                target = createPropertyAccessExpression(setTextRange(factory.createAssignment(thisArg, callee.expression), callee.expression), callee.name);
                setTextRange(target, callee);
            }
            else {
                thisArg = callee.expression;
                target = callee;
            }
        }
        else if (isElementAccessExpression(callee)) {
            if (shouldBeCapturedInTempVariable(callee.expression, cacheIdentifiers)) {
                // for `a[b]()` target is `(_a = a)[b]` and thisArg is `_a`
                thisArg = createTempVariable(recordTempVariable);
                target = createElementAccessExpression(setTextRange(factory.createAssignment(thisArg, callee.expression), callee.expression), callee.argumentExpression);
                setTextRange(target, callee);
            }
            else {
                thisArg = callee.expression;
                target = callee;
            }
        }
        else {
            // for `a()` target is `a` and thisArg is `void 0`
            thisArg = createVoidZero();
            target = parenthesizerRules().parenthesizeLeftSideOfAccess(expression, /*optionalChain*/ false);
        }
        return { target, thisArg };
    }
    function createAssignmentTargetWrapper(paramName: Identifier, expression: Expression): PropertyAccessExpression {
        return createPropertyAccessExpression(
        // Explicit parens required because of v8 regression (https://bugs.chromium.org/p/v8/issues/detail?id=9560)
        createParenthesizedExpression(createObjectLiteralExpression([
            createSetAccessorDeclaration(
            /*modifiers*/ undefined, "value", [createParameterDeclaration(
                /*modifiers*/ undefined, 
                /*dotDotDotToken*/ undefined, paramName, 
                /*questionToken*/ undefined, 
                /*type*/ undefined, 
                /*initializer*/ undefined)], createBlock([
                createExpressionStatement(expression),
            ])),
        ])), "value");
    }
    function inlineExpressions(expressions: readonly Expression[]) {
        // Avoid deeply nested comma expressions as traversing them during emit can result in "Maximum call
        // stack size exceeded" errors.
        return expressions.length > 10
            ? createCommaListExpression(expressions)
            : reduceLeft(expressions, factory.createComma);
    }
    function getName(node: Declaration | undefined, allowComments?: boolean, allowSourceMaps?: boolean, emitFlags: EmitFlags = 0, ignoreAssignedName?: boolean) {
        const nodeName = ignoreAssignedName ? node && getNonAssignedNameOfDeclaration(node) : getNameOfDeclaration(node);
        if (nodeName && isIdentifier(nodeName) && !isGeneratedIdentifier(nodeName)) {
            // TODO(rbuckton): Does this need to be parented?
            const name = setParent(setTextRange(cloneNode(nodeName), nodeName), nodeName.parent);
            emitFlags |= getEmitFlags(nodeName);
            if (!allowSourceMaps)
                emitFlags |= EmitFlags.NoSourceMap;
            if (!allowComments)
                emitFlags |= EmitFlags.NoComments;
            if (emitFlags)
                setEmitFlags(name, emitFlags);
            return name;
        }
        return getGeneratedNameForNode(node);
    }
    /**
     * Gets the internal name of a declaration. This is primarily used for declarations that can be
     * referred to by name in the body of an ES5 class function body. An internal name will *never*
     * be prefixed with an module or namespace export modifier like "exports." when emitted as an
     * expression. An internal name will also *never* be renamed due to a collision with a block
     * scoped variable.
     *
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     */
    function getInternalName(node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean) {
        return getName(node, allowComments, allowSourceMaps, EmitFlags.LocalName | EmitFlags.InternalName);
    }
    /**
     * Gets the local name of a declaration. This is primarily used for declarations that can be
     * referred to by name in the declaration's immediate scope (classes, enums, namespaces). A
     * local name will *never* be prefixed with an module or namespace export modifier like
     * "exports." when emitted as an expression.
     *
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     * @param ignoreAssignedName Indicates that the assigned name of a declaration shouldn't be considered.
     */
    function getLocalName(node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean, ignoreAssignedName?: boolean) {
        return getName(node, allowComments, allowSourceMaps, EmitFlags.LocalName, ignoreAssignedName);
    }
    /**
     * Gets the export name of a declaration. This is primarily used for declarations that can be
     * referred to by name in the declaration's immediate scope (classes, enums, namespaces). An
     * export name will *always* be prefixed with an module or namespace export modifier like
     * `"exports."` when emitted as an expression if the name points to an exported symbol.
     *
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     */
    function getExportName(node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean): Identifier {
        return getName(node, allowComments, allowSourceMaps, EmitFlags.ExportName);
    }
    /**
     * Gets the name of a declaration for use in declarations.
     *
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     */
    function getDeclarationName(node: Declaration | undefined, allowComments?: boolean, allowSourceMaps?: boolean) {
        return getName(node, allowComments, allowSourceMaps);
    }
    /**
     * Gets a namespace-qualified name for use in expressions.
     *
     * @param ns The namespace identifier.
     * @param name The name.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     */
    function getNamespaceMemberName(ns: Identifier, name: Identifier, allowComments?: boolean, allowSourceMaps?: boolean): PropertyAccessExpression {
        const qualifiedName = createPropertyAccessExpression(ns, nodeIsSynthesized(name) ? name : cloneNode(name));
        setTextRange(qualifiedName, name);
        let emitFlags: EmitFlags = 0;
        if (!allowSourceMaps)
            emitFlags |= EmitFlags.NoSourceMap;
        if (!allowComments)
            emitFlags |= EmitFlags.NoComments;
        if (emitFlags)
            setEmitFlags(qualifiedName, emitFlags);
        return qualifiedName;
    }
    /**
     * Gets the exported name of a declaration for use in expressions.
     *
     * An exported name will *always* be prefixed with an module or namespace export modifier like
     * "exports." if the name points to an exported symbol.
     *
     * @param ns The namespace identifier.
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     */
    function getExternalModuleOrNamespaceExportName(ns: Identifier | undefined, node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean): Identifier | PropertyAccessExpression {
        if (ns && hasSyntacticModifier(node, ModifierFlags.Export)) {
            return getNamespaceMemberName(ns, getName(node), allowComments, allowSourceMaps);
        }
        return getExportName(node, allowComments, allowSourceMaps);
    }
    /**
     * Copies any necessary standard and custom prologue-directives into target array.
     * @param source origin statements array
     * @param target result statements array
     * @param ensureUseStrict boolean determining whether the function need to add prologue-directives
     * @param visitor Optional callback used to visit any custom prologue directives.
     */
    function copyPrologue(source: readonly Statement[], target: Statement[], ensureUseStrict?: boolean, visitor?: (node: Node) => VisitResult<Node>): number {
        const offset = copyStandardPrologue(source, target, 0, ensureUseStrict);
        return copyCustomPrologue(source, target, offset, visitor);
    }
    function isUseStrictPrologue(node: ExpressionStatement): boolean {
        return isStringLiteral(node.expression) && node.expression.text === "use strict";
    }
    function createUseStrictPrologue() {
        return checkedCompilerLayout(startOnNewLine(createExpressionStatement(createStringLiteral("use strict"))), checked_isPrologueDirective);
    }
    /**
     * Copies only the standard (string-expression) prologue-directives into the target statement-array.
     * @param source origin statements array
     * @param target result statements array
     * @param statementOffset The offset at which to begin the copy.
     * @param ensureUseStrict boolean determining whether the function need to add prologue-directives
     * @returns Count of how many directive statements were copied.
     */
    function copyStandardPrologue(source: readonly Statement[], target: Statement[], statementOffset = 0, ensureUseStrict?: boolean): number {
        Debug.assert(target.length === 0, "Prologue directives should be at the first statement in the target statements array");
        let foundUseStrict = false;
        const numStatements = source.length;
        while (statementOffset < numStatements) {
            const statement = source[statementOffset];
            if (isPrologueDirective(statement)) {
                if (isUseStrictPrologue(statement)) {
                    foundUseStrict = true;
                }
                target.push(statement);
            }
            else {
                break;
            }
            statementOffset++;
        }
        if (ensureUseStrict && !foundUseStrict) {
            target.push(createUseStrictPrologue());
        }
        return statementOffset;
    }
    /**
     * Copies only the custom prologue-directives into target statement-array.
     * @param source origin statements array
     * @param target result statements array
     * @param statementOffset The offset at which to begin the copy.
     * @param visitor Optional callback used to visit any custom prologue directives.
     */
    function copyCustomPrologue(source: readonly Statement[], target: Statement[], statementOffset: number, visitor?: (node: Node) => VisitResult<Node>, filter?: (node: Statement) => boolean): number;
    function copyCustomPrologue(source: readonly Statement[], target: Statement[], statementOffset: number | undefined, visitor?: (node: Node) => VisitResult<Node>, filter?: (node: Statement) => boolean): number | undefined;
    function copyCustomPrologue(source: readonly Statement[], target: Statement[], statementOffset: number | undefined, visitor?: (node: Node) => VisitResult<Node>, filter: (node: Statement) => boolean = returnTrue): number | undefined {
        const numStatements = source.length;
        while (statementOffset !== undefined && statementOffset < numStatements) {
            const statement = source[statementOffset];
            if (getEmitFlags(statement) & EmitFlags.CustomPrologue && filter(statement)) {
                append(target, visitor ? visitNode(statement, visitor, isStatement) : statement);
            }
            else {
                break;
            }
            statementOffset++;
        }
        return statementOffset;
    }
    /**
     * Ensures "use strict" directive is added
     *
     * @param statements An array of statements
     */
    function ensureUseStrict(statements: NodeArray<Statement>): NodeArray<Statement> {
        const foundUseStrict = findUseStrictPrologue(statements);
        if (!foundUseStrict) {
            return setTextRange(createNodeArray<Statement>([createUseStrictPrologue(), ...statements]), statements);
        }
        return statements;
    }
    /**
     * Lifts a NodeArray containing only Statement nodes to a block.
     *
     * @param nodes The NodeArray.
     */
    function liftToBlock(nodes: readonly Node[]): Statement {
        Debug.assert(every(nodes, isStatementOrBlock), "Cannot lift nodes to a Block.");
        return (singleOrUndefined(nodes)) || createBlock(nodes);
    }
    function findSpanEnd<T>(array: readonly T[], test: (value: T) => boolean, start: number) {
        let i = start;
        while (i < array.length && test(array[i])) {
            i++;
        }
        return i;
    }
    function mergeLexicalEnvironment(statements: NodeArray<Statement>, declarations: readonly Statement[] | undefined): NodeArray<Statement>;
    function mergeLexicalEnvironment(statements: Statement[], declarations: readonly Statement[] | undefined): Statement[];
    function mergeLexicalEnvironment(statements: Statement[] | NodeArray<Statement>, declarations: readonly Statement[] | undefined) {
        if (!some(declarations)) {
            return statements;
        }
        // When we merge new lexical statements into an existing statement list, we merge them in the following manner:
        //
        // Given:
        //
        // | Left                               | Right                               |
        // |------------------------------------|-------------------------------------|
        // | [standard prologues (left)]        | [standard prologues (right)]        |
        // | [hoisted functions (left)]         | [hoisted functions (right)]         |
        // | [hoisted variables (left)]         | [hoisted variables (right)]         |
        // | [lexical init statements (left)]   | [lexical init statements (right)]   |
        // | [other statements (left)]          |                                     |
        //
        // The resulting statement list will be:
        //
        // | Result                              |
        // |-------------------------------------|
        // | [standard prologues (right)]        |
        // | [standard prologues (left)]         |
        // | [hoisted functions (right)]         |
        // | [hoisted functions (left)]          |
        // | [hoisted variables (right)]         |
        // | [hoisted variables (left)]          |
        // | [lexical init statements (right)]   |
        // | [lexical init statements (left)]    |
        // | [other statements (left)]           |
        //
        // NOTE: It is expected that new lexical init statements must be evaluated before existing lexical init statements,
        // as the prior transformation may depend on the evaluation of the lexical init statements to be in the correct state.
        // find standard prologues on left in the following order: standard directives, hoisted functions, hoisted variables, other custom
        const leftStandardPrologueEnd = findSpanEnd(statements, isPrologueDirective, 0);
        const leftHoistedFunctionsEnd = findSpanEnd(statements, isHoistedFunction, leftStandardPrologueEnd);
        const leftHoistedVariablesEnd = findSpanEnd(statements, isHoistedVariableStatement, leftHoistedFunctionsEnd);
        // find standard prologues on right in the following order: standard directives, hoisted functions, hoisted variables, other custom
        const rightStandardPrologueEnd = findSpanEnd(declarations, isPrologueDirective, 0);
        const rightHoistedFunctionsEnd = findSpanEnd(declarations, isHoistedFunction, rightStandardPrologueEnd);
        const rightHoistedVariablesEnd = findSpanEnd(declarations, isHoistedVariableStatement, rightHoistedFunctionsEnd);
        const rightCustomPrologueEnd = findSpanEnd(declarations, isCustomPrologue, rightHoistedVariablesEnd);
        Debug.assert(rightCustomPrologueEnd === declarations.length, "Expected declarations to be valid standard or custom prologues");
        // splice prologues from the right into the left. We do this in reverse order
        // so that we don't need to recompute the index on the left when we insert items.
        const left = isNodeArray(statements) ? statements.slice() : statements;
        // splice other custom prologues from right into left
        if (rightCustomPrologueEnd > rightHoistedVariablesEnd) {
            left.splice(leftHoistedVariablesEnd, 0, ...declarations.slice(rightHoistedVariablesEnd, rightCustomPrologueEnd));
        }
        // splice hoisted variables from right into left
        if (rightHoistedVariablesEnd > rightHoistedFunctionsEnd) {
            left.splice(leftHoistedFunctionsEnd, 0, ...declarations.slice(rightHoistedFunctionsEnd, rightHoistedVariablesEnd));
        }
        // splice hoisted functions from right into left
        if (rightHoistedFunctionsEnd > rightStandardPrologueEnd) {
            left.splice(leftStandardPrologueEnd, 0, ...declarations.slice(rightStandardPrologueEnd, rightHoistedFunctionsEnd));
        }
        // splice standard prologues from right into left (that are not already in left)
        if (rightStandardPrologueEnd > 0) {
            if (leftStandardPrologueEnd === 0) {
                left.splice(0, 0, ...declarations.slice(0, rightStandardPrologueEnd));
            }
            else {
                const leftPrologues = new Map<string, boolean>();
                for (let i = 0; i < leftStandardPrologueEnd; i++) {
                    const leftPrologue = checkedCompilerLayout(statements[i], checked_isPrologueDirective);
                    leftPrologues.set(leftPrologue.expression.text, true);
                }
                for (let i = rightStandardPrologueEnd - 1; i >= 0; i--) {
                    const rightPrologue = checkedCompilerLayout(declarations[i], checked_isPrologueDirective);
                    if (!leftPrologues.has(rightPrologue.expression.text)) {
                        left.unshift(rightPrologue);
                    }
                }
            }
        }
        if (isNodeArray(statements)) {
            return setTextRange(createNodeArray(left, statements.hasTrailingComma), statements);
        }
        return statements;
    }
    function replaceModifiers<T extends HasModifiers>(node: T, modifiers: readonly Modifier[] | ModifierFlags): T;
    function replaceModifiers(node: HasModifiers, modifiers: readonly Modifier[] | ModifierFlags) {
        let modifierArray: readonly Modifier[] | undefined;
        if (typeof modifiers === "number") {
            modifierArray = createModifiersFromModifierFlags(modifiers);
        }
        else {
            modifierArray = modifiers;
        }
        return isTypeParameterDeclaration(node) ? updateTypeParameterDeclaration(node, modifierArray, node.name, node.constraint, node.default) :
            isParameter(node) ? updateParameterDeclaration(node, modifierArray, node.dotDotDotToken, node.name, node.questionToken, node.type, node.initializer) :
                isConstructorTypeNode(node) ? updateConstructorTypeNode1(node, modifierArray, node.typeParameters, node.parameters, node.type) :
                    isPropertySignature(node) ? updatePropertySignature(node, modifierArray, node.name, node.questionToken, node.type) :
                        isPropertyDeclaration(node) ? updatePropertyDeclaration(node, modifierArray, node.name, node.questionToken ?? node.exclamationToken, node.type, node.initializer) :
                            isMethodSignature(node) ? updateMethodSignature(node, modifierArray, node.name, node.questionToken, node.typeParameters, node.parameters, node.type) :
                                isMethodDeclaration(node) ? updateMethodDeclaration(node, modifierArray, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, node.body) :
                                    isConstructorDeclaration(node) ? updateConstructorDeclaration(node, modifierArray, node.parameters, node.body) :
                                        isGetAccessorDeclaration(node) ? updateGetAccessorDeclaration(node, modifierArray, node.name, node.parameters, node.type, node.body) :
                                            isSetAccessorDeclaration(node) ? updateSetAccessorDeclaration(node, modifierArray, node.name, node.parameters, node.body) :
                                                isIndexSignatureDeclaration(node) ? updateIndexSignature(node, modifierArray, node.parameters, node.type) :
                                                    isFunctionExpression(node) ? updateFunctionExpression(node, modifierArray, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, node.body) :
                                                        isArrowFunction(node) ? updateArrowFunction(node, modifierArray, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, node.body) :
                                                            isClassExpression(node) ? updateClassExpression(node, modifierArray, node.name, node.typeParameters, node.heritageClauses, node.members) :
                                                                isVariableStatement(node) ? updateVariableStatement(node, modifierArray, node.declarationList) :
                                                                    isFunctionDeclaration(node) ? updateFunctionDeclaration(node, modifierArray, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, node.body) :
                                                                        isClassDeclaration(node) ? updateClassDeclaration(node, modifierArray, node.name, node.typeParameters, node.heritageClauses, node.members) :
                                                                            isInterfaceDeclaration(node) ? updateInterfaceDeclaration(node, modifierArray, node.name, node.typeParameters, node.heritageClauses, node.members) :
                                                                                isTypeAliasDeclaration(node) ? updateTypeAliasDeclaration(node, modifierArray, node.name, node.typeParameters, node.type) :
                                                                                    isEnumDeclaration(node) ? updateEnumDeclaration(node, modifierArray, node.name, node.members) :
                                                                                        isModuleDeclaration(node) ? updateModuleDeclaration(node, modifierArray, node.name, node.body) :
                                                                                            isImportEqualsDeclaration(node) ? updateImportEqualsDeclaration(node, modifierArray, node.isTypeOnly, node.name, node.moduleReference) :
                                                                                                isImportDeclaration(node) ? updateImportDeclaration(node, modifierArray, node.importClause, node.moduleSpecifier, node.attributes) :
                                                                                                    isExportAssignment(node) ? updateExportAssignment(node, modifierArray, node.expression) :
                                                                                                        isExportDeclaration(node) ? updateExportDeclaration(node, modifierArray, node.isTypeOnly, node.exportClause, node.moduleSpecifier, node.attributes) :
                                                                                                            Debug.assertNever(node);
    }
    function replaceDecoratorsAndModifiers<T extends HasModifiers & HasDecorators>(node: T, modifiers: readonly ModifierLike[]): T;
    function replaceDecoratorsAndModifiers(node: HasModifiers & HasDecorators, modifierArray: readonly ModifierLike[]) {
        return isParameter(node) ? updateParameterDeclaration(node, modifierArray, node.dotDotDotToken, node.name, node.questionToken, node.type, node.initializer) :
            isPropertyDeclaration(node) ? updatePropertyDeclaration(node, modifierArray, node.name, node.questionToken ?? node.exclamationToken, node.type, node.initializer) :
                isMethodDeclaration(node) ? updateMethodDeclaration(node, modifierArray, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, node.body) :
                    isGetAccessorDeclaration(node) ? updateGetAccessorDeclaration(node, modifierArray, node.name, node.parameters, node.type, node.body) :
                        isSetAccessorDeclaration(node) ? updateSetAccessorDeclaration(node, modifierArray, node.name, node.parameters, node.body) :
                            isClassExpression(node) ? updateClassExpression(node, modifierArray, node.name, node.typeParameters, node.heritageClauses, node.members) :
                                isClassDeclaration(node) ? updateClassDeclaration(node, modifierArray, node.name, node.typeParameters, node.heritageClauses, node.members) :
                                    Debug.assertNever(node);
    }
    function replacePropertyName<T extends AccessorDeclaration | MethodDeclaration | MethodSignature | PropertyDeclaration | PropertySignature | PropertyAssignment>(node: T, name: T["name"]): T;
    function replacePropertyName(node: AccessorDeclaration | MethodDeclaration | MethodSignature | PropertyDeclaration | PropertySignature | PropertyAssignment, name: PropertyName) {
        switch (node.kind) {
            case SyntaxKind.GetAccessor:
                return updateGetAccessorDeclaration(node, node.modifiers, name, node.parameters, node.type, node.body);
            case SyntaxKind.SetAccessor:
                return updateSetAccessorDeclaration(node, node.modifiers, name, node.parameters, node.body);
            case SyntaxKind.MethodDeclaration:
                return updateMethodDeclaration(node, node.modifiers, node.asteriskToken, name, node.questionToken, node.typeParameters, node.parameters, node.type, node.body);
            case SyntaxKind.MethodSignature:
                return updateMethodSignature(node, node.modifiers, name, node.questionToken, node.typeParameters, node.parameters, node.type);
            case SyntaxKind.PropertyDeclaration:
                return updatePropertyDeclaration(node, node.modifiers, name, node.questionToken ?? node.exclamationToken, node.type, node.initializer);
            case SyntaxKind.PropertySignature:
                return updatePropertySignature(node, node.modifiers, name, node.questionToken, node.type);
            case SyntaxKind.PropertyAssignment:
                return updatePropertyAssignment(node, name, node.initializer);
        }
    }
    function asNodeArray<T extends Node>(array: readonly T[]): NodeArray<T>;
    function asNodeArray<T extends Node>(array: readonly T[] | undefined): NodeArray<T> | undefined;
    function asNodeArray<T extends Node>(array: readonly T[] | undefined): NodeArray<T> | undefined {
        return array ? createNodeArray(array) : undefined;
    }
    function asName<T extends DeclarationName | Identifier | BindingName | PropertyName | NoSubstitutionTemplateLiteral | EntityName | ThisTypeNode | undefined>(name: string | T): T | Identifier {
        return typeof name === "string" ? createIdentifier(name) :
            name;
    }
    function asExpression<T extends Expression | undefined>(value: string | number | boolean | T): T | StringLiteral | NumericLiteral | BooleanLiteral {
        return typeof value === "string" ? createStringLiteral(value) :
            typeof value === "number" ? createNumericLiteral(value) :
                typeof value === "boolean" ? value ? createTrue() : createFalse() :
                    value;
    }
    function asInitializer(node: Expression | undefined) {
        return node && parenthesizerRules().parenthesizeExpressionForDisallowedComma(node);
    }
    function asToken<TKind extends SyntaxKind>(value: TKind | Token<TKind>): Token<TKind> {
        return typeof value === "number" ? createToken(value) : value;
    }
    function asEmbeddedStatement<T extends Node>(statement: T): T | EmptyStatement;
    function asEmbeddedStatement<T extends Node>(statement: T | undefined): T | EmptyStatement | undefined;
    function asEmbeddedStatement<T extends Node>(statement: T | undefined): T | EmptyStatement | undefined {
        return statement && isNotEmittedStatement(statement) ? setTextRange(setOriginal(createEmptyStatement(), statement), statement) : statement;
    }
    function asVariableDeclaration(variableDeclaration: string | BindingName | VariableDeclaration | undefined) {
        if (typeof variableDeclaration === "string" || variableDeclaration && !isVariableDeclaration(variableDeclaration)) {
            return createVariableDeclaration(variableDeclaration, 
            /*exclamationToken*/ undefined, 
            /*type*/ undefined, 
            /*initializer*/ undefined);
        }
        return variableDeclaration;
    }
    function update<T extends Node>(updated: Mutable<T>, original: T): T {
        if (updated !== original) {
            setOriginal(updated, original);
            setTextRange(updated, original);
        }
        return updated;
    }
}
function getDefaultTagNameForKind(kind: JSDocTag["kind"]): string {
    switch (kind) {
        case SyntaxKind.JSDocTypeTag:
            return "type";
        case SyntaxKind.JSDocReturnTag:
            return "returns";
        case SyntaxKind.JSDocThisTag:
            return "this";
        case SyntaxKind.JSDocEnumTag:
            return "enum";
        case SyntaxKind.JSDocAuthorTag:
            return "author";
        case SyntaxKind.JSDocClassTag:
            return "class";
        case SyntaxKind.JSDocPublicTag:
            return "public";
        case SyntaxKind.JSDocPrivateTag:
            return "private";
        case SyntaxKind.JSDocProtectedTag:
            return "protected";
        case SyntaxKind.JSDocReadonlyTag:
            return "readonly";
        case SyntaxKind.JSDocOverrideTag:
            return "override";
        case SyntaxKind.JSDocTemplateTag:
            return "template";
        case SyntaxKind.JSDocTypedefTag:
            return "typedef";
        case SyntaxKind.JSDocParameterTag:
            return "param";
        case SyntaxKind.JSDocPropertyTag:
            return "prop";
        case SyntaxKind.JSDocCallbackTag:
            return "callback";
        case SyntaxKind.JSDocOverloadTag:
            return "overload";
        case SyntaxKind.JSDocAugmentsTag:
            return "augments";
        case SyntaxKind.JSDocImplementsTag:
            return "implements";
        case SyntaxKind.JSDocImportTag:
            return "import";
        default:
            return Debug.fail(`Unsupported kind: ${Debug.formatSyntaxKind(kind)}`);
    }
}
let rawTextScanner: Scanner | undefined;
const invalidValueSentinel: object = {};
function getCookedText(kind: TemplateLiteralToken["kind"], rawText: string) {
    if (!rawTextScanner) {
        rawTextScanner = createScanner(ScriptTarget.Latest, /*skipTrivia*/ false, LanguageVariant.Standard);
    }
    switch (kind) {
        case SyntaxKind.NoSubstitutionTemplateLiteral:
            rawTextScanner.setText("`" + rawText + "`");
            break;
        case SyntaxKind.TemplateHead:
            rawTextScanner.setText("`" + rawText + "${");
            break;
        case SyntaxKind.TemplateMiddle:
            rawTextScanner.setText("}" + rawText + "${");
            break;
        case SyntaxKind.TemplateTail:
            rawTextScanner.setText("}" + rawText + "`");
            break;
    }
    let token = rawTextScanner.scan();
    if (token === SyntaxKind.CloseBraceToken) {
        token = rawTextScanner.reScanTemplateToken(/*isTaggedTemplate*/ false);
    }
    if (rawTextScanner.isUnterminated()) {
        rawTextScanner.setText(undefined);
        return invalidValueSentinel;
    }
    let tokenValue: string | undefined;
    switch (token) {
        case SyntaxKind.NoSubstitutionTemplateLiteral:
        case SyntaxKind.TemplateHead:
        case SyntaxKind.TemplateMiddle:
        case SyntaxKind.TemplateTail:
            tokenValue = rawTextScanner.getTokenValue();
            break;
    }
    if (tokenValue === undefined || rawTextScanner.scan() !== SyntaxKind.EndOfFileToken) {
        rawTextScanner.setText(undefined);
        return invalidValueSentinel;
    }
    rawTextScanner.setText(undefined);
    return tokenValue;
}
function propagateNameFlags(node: PropertyName | BindingPattern | NoSubstitutionTemplateLiteral | undefined) {
    return node && isIdentifier(node) ? propagateIdentifierNameFlags(node) : propagateChildFlags(node);
}
function propagateIdentifierNameFlags(node: Identifier) {
    // An IdentifierName is allowed to be `await`
    return propagateChildFlags(node) & ~TransformFlags.ContainsPossibleTopLevelAwait;
}
function propagatePropertyNameFlagsOfChild(node: PropertyName, transformFlags: TransformFlags) {
    return transformFlags | (node.transformFlags & TransformFlags.PropertyNamePropagatingFlags);
}
function propagateChildFlags(child: Node | undefined): TransformFlags {
    if (!child)
        return TransformFlags.None;
    const childFlags = child.transformFlags & ~getTransformFlagsSubtreeExclusions(child.kind);
    return isNamedDeclaration(child) && isPropertyName(child.name) ? propagatePropertyNameFlagsOfChild(child.name, childFlags) : childFlags;
}
function propagateChildrenFlags(children: NodeArray<Node> | undefined): TransformFlags {
    return children ? children.transformFlags : TransformFlags.None;
}
function aggregateChildrenFlags(children: readonly Node[] & {
    transformFlags?: TransformFlags;
}) {
    let subtreeFlags: TransformFlags = TransformFlags.None;
    for (const child of children) {
        subtreeFlags |= propagateChildFlags(child);
    }
    children.transformFlags = subtreeFlags;
}
/**
 * Gets the transform flags to exclude when unioning the transform flags of a subtree.
 */
function getTransformFlagsSubtreeExclusions(kind: SyntaxKind) {
    if (kind >= SyntaxKind.FirstTypeNode && kind <= SyntaxKind.LastTypeNode) {
        return TransformFlags.TypeExcludes;
    }
    switch (kind) {
        case SyntaxKind.CallExpression:
        case SyntaxKind.NewExpression:
        case SyntaxKind.ArrayLiteralExpression:
            return TransformFlags.ArrayLiteralOrCallOrNewExcludes;
        case SyntaxKind.ModuleDeclaration:
            return TransformFlags.ModuleExcludes;
        case SyntaxKind.Parameter:
            return TransformFlags.ParameterExcludes;
        case SyntaxKind.ArrowFunction:
            return TransformFlags.ArrowFunctionExcludes;
        case SyntaxKind.FunctionExpression:
        case SyntaxKind.FunctionDeclaration:
            return TransformFlags.FunctionExcludes;
        case SyntaxKind.VariableDeclarationList:
            return TransformFlags.VariableDeclarationListExcludes;
        case SyntaxKind.ClassDeclaration:
        case SyntaxKind.ClassExpression:
            return TransformFlags.ClassExcludes;
        case SyntaxKind.Constructor:
            return TransformFlags.ConstructorExcludes;
        case SyntaxKind.PropertyDeclaration:
            return TransformFlags.PropertyExcludes;
        case SyntaxKind.MethodDeclaration:
        case SyntaxKind.GetAccessor:
        case SyntaxKind.SetAccessor:
            return TransformFlags.MethodOrAccessorExcludes;
        case SyntaxKind.AnyKeyword:
        case SyntaxKind.NumberKeyword:
        case SyntaxKind.BigIntKeyword:
        case SyntaxKind.NeverKeyword:
        case SyntaxKind.StringKeyword:
        case SyntaxKind.ObjectKeyword:
        case SyntaxKind.BooleanKeyword:
        case SyntaxKind.SymbolKeyword:
        case SyntaxKind.VoidKeyword:
        case SyntaxKind.TypeParameter:
        case SyntaxKind.PropertySignature:
        case SyntaxKind.MethodSignature:
        case SyntaxKind.CallSignature:
        case SyntaxKind.ConstructSignature:
        case SyntaxKind.IndexSignature:
        case SyntaxKind.InterfaceDeclaration:
        case SyntaxKind.TypeAliasDeclaration:
            return TransformFlags.TypeExcludes;
        case SyntaxKind.ObjectLiteralExpression:
            return TransformFlags.ObjectLiteralExcludes;
        case SyntaxKind.CatchClause:
            return TransformFlags.CatchClauseExcludes;
        case SyntaxKind.ObjectBindingPattern:
        case SyntaxKind.ArrayBindingPattern:
            return TransformFlags.BindingPatternExcludes;
        case SyntaxKind.TypeAssertionExpression:
        case SyntaxKind.SatisfiesExpression:
        case SyntaxKind.AsExpression:
        case SyntaxKind.PartiallyEmittedExpression:
        case SyntaxKind.ParenthesizedExpression:
        case SyntaxKind.SuperKeyword:
            return TransformFlags.OuterExpressionExcludes;
        case SyntaxKind.PropertyAccessExpression:
        case SyntaxKind.ElementAccessExpression:
            return TransformFlags.PropertyAccessExcludes;
        default:
            return TransformFlags.NodeExcludes;
    }
}
const baseFactory = createBaseNodeFactory();
function makeSynthetic(node: Node) {
    (node).flags |= NodeFlags.Synthesized;
    return node;
}
const syntheticFactory: BaseNodeFactory = {
    createBaseSourceFileNode: kind => makeSynthetic(baseFactory.createBaseSourceFileNode(kind)),
    createBaseIdentifierNode: kind => makeSynthetic(baseFactory.createBaseIdentifierNode(kind)),
    createBasePrivateIdentifierNode: kind => makeSynthetic(baseFactory.createBasePrivateIdentifierNode(kind)),
    createBaseTokenNode: kind => makeSynthetic(baseFactory.createBaseTokenNode(kind)),
    createBaseNode: kind => makeSynthetic(baseFactory.createBaseNode(kind)),
};
export const factory: NodeFactory = createNodeFactory(NodeFactoryFlags.NoIndentationOnFreshPropertyAccess, syntheticFactory);
let SourceMapSource: new (fileName: string, text: string, skipTrivia?: (pos: number) => number) => SourceMapSource;
/**
 * Create an external source map source file reference
 */
export function createSourceMapSource(fileName: string, text: string, skipTrivia?: (pos: number) => number): SourceMapSource {
    return new (SourceMapSource || (SourceMapSource = objectAllocator.getSourceMapSourceConstructor()))(fileName, text, skipTrivia);
}
// Utilities
export function setOriginalNode<T extends Node>(node: T, original: Node | undefined): T {
    if (node.original !== original) {
        node.original = original;
        if (original) {
            const emitNode = original.emitNode;
            if (emitNode)
                node.emitNode = mergeEmitNode(emitNode, node.emitNode);
        }
    }
    return node;
}
function mergeEmitNode(sourceEmitNode: EmitNode, destEmitNode: EmitNode | undefined) {
    const { flags, internalFlags, leadingComments, trailingComments, commentRange, sourceMapRange, tokenSourceMapRanges, constantValue, helpers, startsOnNewLine, snippetElement, classThis, assignedName, } = sourceEmitNode;
    if (!destEmitNode)
        destEmitNode = {};
    // NOTE: We should have one or more lines here for each property in EmitNode, even if the line
    // consists only of a comment indicating the property does not merge
    // `flags` overwrites the destination
    if (flags) {
        (destEmitNode)!.flags = flags;
    }
    // `internalFlags` overwrites the destination. We do not copy over the immutability of the source.
    if (internalFlags) {
        (destEmitNode)!.internalFlags = internalFlags & ~InternalEmitFlags.Immutable;
    }
    // `annotatedNodes` are not merged as they should only present on the parse tree node of a `SourceFile`.
    // `leadingComments` are concatenated with any existing leading comments on the destination
    if (leadingComments) {
        // We use `.slice()` in case `destEmitNode.leadingComments` is pushed to later
        (destEmitNode)!.leadingComments = addRange(leadingComments.slice(), (destEmitNode)!.leadingComments);
    }
    // `trailingComments` are concatenated with any existing trailing comments on the destination
    if (trailingComments) {
        // We use `.slice()` in case `destEmitNode.trailingComments` is pushed to later
        (destEmitNode)!.trailingComments = addRange(trailingComments.slice(), (destEmitNode)!.trailingComments);
    }
    // `commentRange` overwrites the destination
    if (commentRange) {
        (destEmitNode)!.commentRange = commentRange;
    }
    // `sourceMapRange` overwrites the destination
    if (sourceMapRange) {
        (destEmitNode)!.sourceMapRange = sourceMapRange;
    }
    // `tokenSourceMapRanges` are merged with the destination
    if (tokenSourceMapRanges) {
        (destEmitNode)!.tokenSourceMapRanges = mergeTokenSourceMapRanges(tokenSourceMapRanges, ((destEmitNode)!.tokenSourceMapRanges)!);
    }
    // `constantValue` overwrites the destination
    if (constantValue !== undefined) {
        (destEmitNode)!.constantValue = constantValue;
    }
    // `externalHelpersModuleName` is not merged
    // `externalHelpers` is not merged
    // `helpers` are merged into the destination
    if (helpers) {
        for (const helper of helpers) {
            (destEmitNode)!.helpers = appendIfUnique((destEmitNode)!.helpers, helper);
        }
    }
    // `startsOnNewLine` overwrites the destination
    if (startsOnNewLine !== undefined) {
        (destEmitNode)!.startsOnNewLine = startsOnNewLine;
    }
    // `snippetElement` overwrites the destination
    if (snippetElement !== undefined) {
        (destEmitNode)!.snippetElement = snippetElement;
    }
    // `typeNode` is not merged as it only applies to comment emit for a variable declaration.
    // TODO: `typeNode` should overwrite the destination
    // `classThis` overwrites the destination
    if (classThis) {
        (destEmitNode)!.classThis = classThis;
    }
    // `assignedName` overwrites the destination
    if (assignedName) {
        (destEmitNode)!.assignedName = assignedName;
    }
    // `identifierTypeArguments` are not merged as they only apply to an Identifier in quick info
    // `autoGenerate` is not merged as it only applies to a specific generated Identifier/PrivateIdentifier
    // `generatedImportReference` is not merged as it only applies to an Identifier
    return destEmitNode;
}
function mergeTokenSourceMapRanges(sourceRanges: (TextRange | undefined)[], destRanges: (TextRange | undefined)[]) {
    if (!destRanges)
        destRanges = [];
    for (const key in sourceRanges) {
        destRanges[key] = sourceRanges[key];
    }
    return destRanges;
}
function requireCompleteNodeArray<T extends Node>(value: readonly T[] & Partial<NodeArray<T>>): asserts value is NodeArray<T> {
    if (typeof value.pos !== "number" || typeof value.end !== "number" || typeof value.hasTrailingComma !== "boolean" || typeof value.transformFlags !== "number") {
        throw new TypeError("Incomplete compiler node array");
    }
}
