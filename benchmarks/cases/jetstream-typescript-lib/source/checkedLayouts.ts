// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked discriminant views corresponding to the original compiler's node casts.
import type * as Layout from "./compiler/_namespaces/ts.ts";

export function isNodeLayout_e00bb4ab6ed7(value: Layout.Node): value is Layout.PrivateIdentifier | Layout.PropertyNameLiteral {
    return value.kind === 9 || value.kind === 10 || value.kind === 11 || value.kind === 15 || value.kind === 80 || value.kind === 81 || value.kind === 296;
}

export function isNodeLayout_0d1c1d26f210(value: Layout.Node): value is Layout.IsContainer | Layout.EntityNameExpression {
    return value.kind === 80 || value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 188 || value.kind === 201 || value.kind === 211 || value.kind === 212 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 267 || value.kind === 268 || value.kind === 293 || value.kind === 308 || value.kind === 318 || value.kind === 323 || value.kind === 324;
}

export function isNodeLayout_600cf1f85714(value: Layout.Node): value is Layout.HasLocals {
    return value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 195 || value.kind === 201 || value.kind === 219 || value.kind === 220 || value.kind === 242 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 263 || value.kind === 266 || value.kind === 268 || value.kind === 270 || value.kind === 300 || value.kind === 308 || value.kind === 318 || value.kind === 324 || value.kind === 339 || value.kind === 341 || value.kind === 347;
}

export function isNodeLayout_14c3351fbd82(value: Layout.Node): value is Layout.FunctionLikeDeclaration | Layout.ClassStaticBlockDeclaration {
    return value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 219 || value.kind === 220 || value.kind === 263;
}

export function isNodeLayout_be4fe828352c(value: Layout.Node): value is Layout.SourceFile {
    return value.kind === 308;
}

export function isNodeLayout_a2c3b9faba9e(value: Layout.Node): value is Layout.HasFlowNode {
    return value.kind === 80 || value.kind === 108 || value.kind === 110 || value.kind === 167 || value.kind === 175 || value.kind === 178 || value.kind === 179 || value.kind === 209 || value.kind === 212 || value.kind === 213 || value.kind === 219 || value.kind === 220 || value.kind === 237 || value.kind === 244 || value.kind === 245 || value.kind === 246 || value.kind === 247 || value.kind === 248 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 252 || value.kind === 253 || value.kind === 254 || value.kind === 255 || value.kind === 256 || value.kind === 257 || value.kind === 258 || value.kind === 259 || value.kind === 260;
}

export function isNodeLayout_755449ef1692(value: Layout.Node): value is Layout.ReturnStatement | Layout.ThrowStatement {
    return value.kind === 254 || value.kind === 258;
}

export function isNodeLayout_9a802a30e2ab(value: Layout.Node): value is Layout.JSDocCallbackTag | Layout.JSDocEnumTag | Layout.JSDocTypedefTag {
    return value.kind === 339 || value.kind === 341 || value.kind === 347;
}

export function isNodeLayout_e9d807005dd2(value: Layout.Node): value is Layout.ParenthesizedExpression | Layout.NonNullExpression {
    return value.kind === 218 || value.kind === 236;
}

export function isNodeLayout_508ea53b7ce6(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.ParenthesizedExpression | Layout.NonNullExpression {
    return value.kind === 212 || value.kind === 218 || value.kind === 236;
}

export function isNodeLayout_a61ebc25756c(value: Layout.Node): value is Layout.IfStatement | Layout.WhileStatement | Layout.DoStatement {
    return value.kind === 246 || value.kind === 247 || value.kind === 248;
}

export function isNodeLayout_e075bff63eea(value: Layout.Node): value is Layout.ForStatement | Layout.ConditionalExpression {
    return value.kind === 228 || value.kind === 249;
}

export function isNodeLayout_53f0329af33f(value: Layout.Node): value is Layout.Identifier {
    return value.kind === 80;
}

export function isNodeLayout_d282b5732892(value: Layout.Node): value is Layout.QualifiedName | Layout.DeclarationName {
    return value.kind === 9 || value.kind === 10 || value.kind === 11 || value.kind === 15 || value.kind === 80 || value.kind === 81 || value.kind === 167 || value.kind === 168 || value.kind === 207 || value.kind === 208 || value.kind === 212 || value.kind === 213 || value.kind === 296;
}

export function isNodeLayout_1442152216cb(value: Layout.Node): value is Layout.Mutable<Layout.HasContainerFlags> {
    return value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 188 || value.kind === 195 || value.kind === 201 || value.kind === 211 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 242 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 267 || value.kind === 268 || value.kind === 269 || value.kind === 270 || value.kind === 293 || value.kind === 300 || value.kind === 308 || value.kind === 318 || value.kind === 323 || value.kind === 324 || value.kind === 339 || value.kind === 341 || value.kind === 347;
}

export function isNodeLayout_c1dae7a07cc4(value: Layout.Node): value is Layout.Identifier | Layout.ThisExpression {
    return value.kind === 80 || value.kind === 110;
}

export function isNodeLayout_8cdd75b32d06(value: Layout.Node): value is Layout.MetaProperty | Layout.SuperExpression {
    return value.kind === 108 || value.kind === 237;
}

export function isNodeLayout_dcd838bcdcc6(value: Layout.Node): value is Layout.ElementAccessExpression | Layout.PropertyAccessExpression {
    return value.kind === 212 || value.kind === 213;
}

export function isNodeLayout_31faa6d37977(value: Layout.Node): value is Layout.BindableStaticPropertyAssignmentExpression {
    return value.kind === 227;
}

export function isNodeLayout_18553e50e6e0(value: Layout.Node): value is Layout.BindablePropertyAssignmentExpression {
    return value.kind === 227;
}

export function isNodeLayout_e3ae7881397e(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.LiteralLikeElementAccessExpression | Layout.BindablePropertyAssignmentExpression {
    return value.kind === 212 || value.kind === 213 || value.kind === 227;
}

export function isNodeLayout_5474267d330f(value: Layout.Node): value is Layout.PropertySignature | Layout.PropertyDeclaration {
    return value.kind === 172 || value.kind === 173;
}

export function isNodeLayout_495119267bfe(value: Layout.Node): value is Layout.JSDocSignature | Layout.SignatureDeclaration {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 263 || value.kind === 318 || value.kind === 324;
}

export function isNodeLayout_5259474764f2(value: Layout.Node): value is Layout.MappedTypeNode | Layout.TypeLiteralNode | Layout.JSDocTypeLiteral {
    return value.kind === 188 || value.kind === 201 || value.kind === 323;
}

export function isNodeLayout_714a4a2a9324(value: Layout.Node): value is Layout.ArrowFunction | Layout.FunctionExpression {
    return value.kind === 219 || value.kind === 220;
}

export function isNodeLayout_8c8b2989dc16(value: Layout.Node): value is Layout.CallExpression {
    return value.kind === 214;
}

export function isNodeLayout_6ee9ddb99b2e(value: Layout.Node): value is Layout.Block | Layout.ModuleBlock {
    return value.kind === 242 || value.kind === 269;
}

export function isNodeLayout_21be3da6c843(value: Layout.Node): value is Layout.ModuleExportName {
    return value.kind === 11 || value.kind === 80;
}

export function isNodeLayout_f31804b1862a(value: Layout.Node): value is Layout.ImportDeclaration | Layout.ExportDeclaration | Layout.JSDocImportTag {
    return value.kind === 273 || value.kind === 279 || value.kind === 352;
}

export function isNodeLayout_803c550fb259(value: Layout.Node): value is Layout.VariableDeclaration | Layout.ImportEqualsDeclaration {
    return value.kind === 261 || value.kind === 272;
}

export function isNodeLayout_c02e91eae898(value: Layout.Node): value is Layout.BindingElement | Layout.ImportSpecifier {
    return value.kind === 209 || value.kind === 277;
}

export function isNodeLayout_56a8f9d8a2de(value: Layout.Node): value is Layout.BinaryExpression | Layout.ExportAssignment {
    return value.kind === 227 || value.kind === 278;
}

export function isNodeLayout_e3ae92a8a76d(value: Layout.Node): value is Layout.ExportDeclaration & {
    isTypeOnly: true;
    moduleSpecifier: Layout.Expression;
} {
    return value.kind === 279;
}

export function isNodeLayout_e950f9b61677(value: Layout.Node): value is Layout.TypeReferenceNode | Layout.ImportTypeNode {
    return value.kind === 184 || value.kind === 206;
}

export function isNodeLayout_69176c08124f(value: Layout.Node): value is Layout.TypeNode {
    return value.kind === 80 || value.kind === 167 || value.kind === 116 || value.kind === 133 || value.kind === 136 || value.kind === 141 || value.kind === 146 || value.kind === 150 || value.kind === 151 || value.kind === 154 || value.kind === 155 || value.kind === 157 || value.kind === 159 || value.kind === 163 || value.kind === 183 || value.kind === 184 || value.kind === 185 || value.kind === 186 || value.kind === 187 || value.kind === 188 || value.kind === 189 || value.kind === 190 || value.kind === 191 || value.kind === 192 || value.kind === 193 || value.kind === 194 || value.kind === 195 || value.kind === 196 || value.kind === 197 || value.kind === 198 || value.kind === 199 || value.kind === 200 || value.kind === 201 || value.kind === 202 || value.kind === 203 || value.kind === 204 || value.kind === 205 || value.kind === 206 || value.kind === 234 || value.kind === 310 || value.kind === 313 || value.kind === 314 || value.kind === 315 || value.kind === 316 || value.kind === 317 || value.kind === 318 || value.kind === 319 || value.kind === 320 || value.kind === 323 || value.kind === 324 || value.kind === 169;
}

export function isNodeLayout_d5f567f189e9(value: Layout.Node): value is Layout.HasModifiers {
    return value.kind === 169 || value.kind === 170 || value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 182 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 244 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 267 || value.kind === 268 || value.kind === 272 || value.kind === 273 || value.kind === 278 || value.kind === 279;
}

export function isNodeLayout_c2d158fae344(value: Layout.Node): value is Layout.ExportDeclaration {
    return value.kind === 279;
}

export function isNodeLayout_7a0ef5c1df44(value: Layout.Node): value is Layout.StringLiteral | Layout.NumericLiteral {
    return value.kind === 9 || value.kind === 11;
}

export function isNodeLayout_ba831efb76f1(value: Layout.Node): value is Layout.SourceFile | Layout.ModuleBody {
    return value.kind === 80 || value.kind === 268 || value.kind === 269 || value.kind === 308;
}

export function isNodeLayout_2f42e74fcfb0(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.PropertyAssignment | Layout.ShorthandPropertyAssignment {
    return value.kind === 212 || value.kind === 304 || value.kind === 305;
}

export function isNodeLayout_d2850ccd358e(value: Layout.Node): value is Layout.EntityNameOrEntityNameExpression {
    return value.kind === 80 || value.kind === 167 || value.kind === 212;
}

export function isNodeLayout_a648d96caf69(value: Layout.Node): value is Layout.BindingElement {
    return value.kind === 209;
}

export function isNodeLayout_921f9ec3167e(value: Layout.Node): value is Layout.PropertyAssignment | Layout.ShorthandPropertyAssignment {
    return value.kind === 304 || value.kind === 305;
}

export function isNodeLayout_26896d9e16e6(value: Layout.Node): value is Layout.BindingPattern | Layout.ArrayLiteralExpression {
    return value.kind === 207 || value.kind === 208 || value.kind === 210;
}

export function isNodeLayout_3dde6d9ae0fc(value: Layout.Node): value is Layout.HasInitializer {
    return value.kind === 170 || value.kind === 173 || value.kind === 209 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 261 || value.kind === 292 || value.kind === 304 || value.kind === 307;
}

export function isNodeLayout_4a216ad4c778(value: Layout.Node): value is Layout.DeclarationWithTypeParameters {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 318 || value.kind === 324 || value.kind === 339 || value.kind === 346 || value.kind === 347;
}

export function isNodeLayout_1ca01a4c8123(value: Layout.Node): value is Layout.FunctionLikeDeclaration {
    return value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 219 || value.kind === 220 || value.kind === 263;
}

export function isNodeLayout_c6818aedab3e(value: Layout.Node): value is Layout.CallExpression | Layout.BinaryExpression {
    return value.kind === 214 || value.kind === 227;
}

export function isNodeLayout_ee03c9438d74(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.ElementAccessExpression {
    return value.kind === 212 || value.kind === 213;
}

export function isNodeLayout_253e30f908b4(value: Layout.Node): value is Layout.JSDocTemplateTag {
    return value.kind === 346;
}

export function isNodeLayout_5a3f81e85d21(value: Layout.Node): value is Layout.ParenthesizedTypeNode | Layout.OptionalTypeNode | Layout.JSDocTypeReferencingNode | Layout.NamedTupleMember {
    return value.kind === 191 || value.kind === 197 || value.kind === 203 || value.kind === 315 || value.kind === 316 || value.kind === 317 || value.kind === 319;
}

export function isNodeLayout_e4c864e1cdf6(value: Layout.Node): value is Layout.UnionOrIntersectionTypeNode {
    return value.kind === 193 || value.kind === 194;
}

export function isNodeLayout_faf26078ed12(value: Layout.Node): value is Layout.Identifier | Layout.ComputedPropertyName | Layout.JsxNamespacedName | Layout.NumericLiteral | Layout.StringLiteral | Layout.NoSubstitutionTemplateLiteral | Layout.BigIntLiteral | Layout.PrivateIdentifier {
    return value.kind === 9 || value.kind === 10 || value.kind === 11 || value.kind === 15 || value.kind === 80 || value.kind === 81 || value.kind === 168 || value.kind === 296;
}

export function isNodeLayout_c43bd610d92d(value: Layout.Node): value is Layout.RestTypeNode | Layout.NamedTupleMember {
    return value.kind === 192 || value.kind === 203;
}

export function isNodeLayout_79b461dc5fbc(value: Layout.Node): value is Layout.ThisExpression | Layout.ThisTypeNode {
    return value.kind === 110 || value.kind === 198;
}

export function isNodeLayout_3eecdf98ac20(value: Layout.Node): value is Layout.ArrayTypeNode | Layout.TupleTypeNode {
    return value.kind === 189 || value.kind === 190;
}

export function isNodeLayout_b42753c1ebc3(value: Layout.Node): value is Layout.ParenthesizedTypeNode | Layout.JSDocTypeReferencingNode | Layout.JSDocTypeExpression | Layout.NamedTupleMember {
    return value.kind === 197 || value.kind === 203 || value.kind === 310 || value.kind === 315 || value.kind === 316 || value.kind === 317 || value.kind === 319;
}

export function isNodeLayout_441b6c17eacf(value: Layout.Node): value is Layout.JSDocFunctionType | Layout.JSDocSignature | Layout.TypeLiteralNode | Layout.JSDocTypeLiteral | Layout.FunctionOrConstructorTypeNode {
    return value.kind === 185 || value.kind === 186 || value.kind === 188 || value.kind === 318 || value.kind === 323 || value.kind === 324;
}

export function isNodeLayout_a9d248e5a93a(value: Layout.Node): value is Layout.AsExpression | Layout.ParenthesizedExpression | Layout.JsxExpression {
    return value.kind === 218 || value.kind === 235 || value.kind === 295;
}

export function isNodeLayout_e247de7fc7f9(value: Layout.Node): value is Layout.EnumMember {
    return value.kind === 307;
}

export function isNodeLayout_0e64bf83a600(value: Layout.Node): value is Layout.NonNullExpression | Layout.ParenthesizedExpression {
    return value.kind === 218 || value.kind === 236;
}

export function isNodeLayout_b47203f53206(value: Layout.Node): value is Layout.NonNullExpression | Layout.ParenthesizedExpression | Layout.SatisfiesExpression {
    return value.kind === 218 || value.kind === 236 || value.kind === 239;
}

export function isNodeLayout_3f2e944cc2a5(value: Layout.Node): value is Layout.BindingElement | Layout.VariableDeclaration {
    return value.kind === 209 || value.kind === 261;
}

export function isNodeLayout_cfe458d84bdd(value: Layout.Node): value is Layout.InstanceofExpression {
    return value.kind === 227;
}

export function isNodeLayout_08b9b15d7ce5(value: Layout.Node): value is Layout.ParenthesizedExpression | Layout.NonNullExpression | Layout.SatisfiesExpression {
    return value.kind === 218 || value.kind === 236 || value.kind === 239;
}

export function isNodeLayout_93c8d581a30d(value: Layout.Node): value is Layout.QualifiedName | Layout.PropertyAccessExpression {
    return value.kind === 167 || value.kind === 212;
}

export function isNodeLayout_a0551c11f120(value: Layout.Node): value is Layout.JsxOpeningLikeElement | Layout.JsxOpeningFragment {
    return value.kind === 286 || value.kind === 287 || value.kind === 290;
}

export function isNodeLayout_44188bc79ed7(value: Layout.Node): value is Layout.MethodSignature | Layout.FunctionLikeDeclaration {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 219 || value.kind === 220 || value.kind === 263;
}

export function isNodeLayout_feebc7a44c8e(value: Layout.Node): value is Layout.HasDecorators {
    return value.kind === 170 || value.kind === 173 || value.kind === 175 || value.kind === 178 || value.kind === 179 || value.kind === 232 || value.kind === 264;
}

export function isNodeLayout_9cd5fe781a87(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.ParenthesizedExpression {
    return value.kind === 212 || value.kind === 218;
}

export function isNodeLayout_67e4a7abe298(value: Layout.Node): value is Layout.CallLikeExpression {
    return value.kind === 171 || value.kind === 214 || value.kind === 215 || value.kind === 216 || value.kind === 227 || value.kind === 286 || value.kind === 287 || value.kind === 290;
}

export function isNodeLayout_57cedac23d90(value: Layout.Node): value is Layout.ObjectLiteralElementLike {
    return value.kind === 175 || value.kind === 178 || value.kind === 179 || value.kind === 304 || value.kind === 305 || value.kind === 306;
}

export function isNodeLayout_9623dfb79a55(value: Layout.Node): value is Layout.JsxAttribute | Layout.JsxSpreadAttribute {
    return value.kind === 292 || value.kind === 294;
}

export function isNodeLayout_4b93d3ed465e(value: Layout.Node): value is Layout.JsxOpeningElement | Layout.JsxSelfClosingElement {
    return value.kind === 286 || value.kind === 287;
}

export function isNodeLayout_ba512d17b919(value: Layout.Node): value is Layout.CallExpression | Layout.TaggedTemplateExpression | Layout.JsxOpeningLikeElement {
    return value.kind === 214 || value.kind === 216 || value.kind === 286 || value.kind === 287;
}

export function isNodeLayout_b9382bd9034f(value: Layout.Node): value is Layout.Decorator | Layout.CallExpression | Layout.NewExpression {
    return value.kind === 171 || value.kind === 214 || value.kind === 215;
}

export function isNodeLayout_28668821e93d(value: Layout.Node): value is Layout.Identifier | Layout.PrivateIdentifier {
    return value.kind === 80 || value.kind === 81;
}

export function isNodeLayout_877e3f715d0a(value: Layout.Node): value is Layout.MethodDeclaration | Layout.PropertyDeclaration | Layout.AccessorDeclaration {
    return value.kind === 173 || value.kind === 175 || value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_8cf433cf511b(value: Layout.Node): value is Layout.ArrowFunction | Layout.FunctionExpression | Layout.MethodDeclaration {
    return value.kind === 175 || value.kind === 219 || value.kind === 220;
}

export function isNodeLayout_280ac8cd2378(value: Layout.Node): value is Layout.JSDocOverloadTag | Layout.JSDocCallbackTag {
    return value.kind === 339 || value.kind === 340;
}

export function isNodeLayout_b176001fd0f9(value: Layout.Node): value is Layout.ParenthesizedTypeNode | Layout.NamedTupleMember {
    return value.kind === 197 || value.kind === 203;
}

export function isNodeLayout_5e8c395d07b4(value: Layout.Node): value is Layout.StringLiteral | Layout.NoSubstitutionTemplateLiteral {
    return value.kind === 11 || value.kind === 15;
}

export function isNodeLayout_d6fb934c5f09(value: Layout.Node): value is Layout.VariableDeclaration | Layout.BindingElement {
    return value.kind === 209 || value.kind === 261;
}

export function isNodeLayout_b74b1ef9bfcc(value: Layout.Node): value is Layout.SignatureDeclaration {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 263 || value.kind === 318;
}

export function isNodeLayout_d5545e677da5(value: Layout.Node): value is Layout.MethodDeclaration | Layout.MethodSignature {
    return value.kind === 174 || value.kind === 175;
}

export function isNodeLayout_ccee868737b9(value: Layout.Node): value is Layout.ParenthesizedTypeNode | Layout.OptionalTypeNode | Layout.RestTypeNode {
    return value.kind === 191 || value.kind === 192 || value.kind === 197;
}

export function isNodeLayout_6fc51043a5e6(value: Layout.Node): value is Layout.JSDocLink | Layout.JSDocLinkCode | Layout.JSDocLinkPlain {
    return value.kind === 325 || value.kind === 326 || value.kind === 327;
}

export function isNodeLayout_2dc737ff7f6e(value: Layout.Node): value is Layout.JSDocPublicTag | Layout.JSDocPrivateTag | Layout.JSDocProtectedTag {
    return value.kind === 334 || value.kind === 335 || value.kind === 336;
}

export function isNodeLayout_40e9e73c014b(value: Layout.Node): value is Layout.Block {
    return value.kind === 242;
}

export function isNodeLayout_35938052afa2(value: Layout.Node): value is Layout.AssertionExpression | Layout.JSDocTypeAssertion {
    return value.kind === 217 || value.kind === 218 || value.kind === 235;
}

export function isNodeLayout_dabc24114aa6(value: Layout.Node): value is Layout.TypeParameterDeclaration & {
    parent: Layout.JSDocTemplateTag;
} {
    return value.kind === 169;
}

export function isNodeLayout_a7735cccca1a(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.JSDocMemberName | Layout.EntityName | Layout.PrivateIdentifier {
    return value.kind === 80 || value.kind === 81 || value.kind === 167 || value.kind === 212 || value.kind === 312;
}

export function isNodeLayout_9ab328ecf262(value: Layout.Node): value is Layout.StringLiteral | Layout.NumericLiteral {
    return value.kind === 9 || value.kind === 11;
}

export function isNodeLayout_335966166310(value: Layout.Node): value is Layout.ComputedPropertyName {
    return value.kind === 168;
}

export function isNodeLayout_a990b8a67edc(value: Layout.Node): value is Layout.MethodDeclaration | Layout.MethodSignature | Layout.PropertySignature | Layout.PropertyDeclaration | Layout.AccessorDeclaration {
    return value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_96031c121c71(value: Layout.Node): value is Layout.ArrayLiteralExpression {
    return value.kind === 210;
}

export function isNodeLayout_43c21d4235e3(value: Layout.Node): value is Layout.ArrayLiteralExpression {
    return value.kind === 210;
}

export function isNodeLayout_b6f9f36b54cc(value: Layout.Node): value is Layout.RestTypeNode | Layout.JSDocVariadicType {
    return value.kind === 192 || value.kind === 319;
}

export function isNodeLayout_7f0f1e43651c(value: Layout.Node): value is Layout.JSDocImplementsTag | Layout.JSDocAugmentsTag {
    return value.kind === 329 || value.kind === 330;
}

export function isNodeLayout_c002a8ba6f65(value: Layout.Node): value is Layout.JSDocEnumTag | Layout.JSDocReturnTag | Layout.JSDocTypeTag | Layout.JSDocThisTag | Layout.JSDocThrowsTag | Layout.JSDocSatisfiesTag {
    return value.kind === 341 || value.kind === 343 || value.kind === 344 || value.kind === 345 || value.kind === 350 || value.kind === 351;
}

export function isNodeLayout_a94c8d63fc88(value: Layout.Node): value is Layout.NumericLiteral | Layout.BigIntLiteral {
    return value.kind === 9 || value.kind === 10;
}

export function isNodeLayout_285fbf0b7b95(value: Layout.Node): value is Layout.TypeAssertion {
    return value.kind === 217;
}

export function isNodeLayout_3f199906bb30(value: Layout.Node): value is Layout.LabeledStatement | Layout.WithStatement | Layout.DoStatement | Layout.WhileStatement {
    return value.kind === 247 || value.kind === 248 || value.kind === 255 || value.kind === 257;
}

export function isNodeLayout_41cd9dec7349(value: Layout.Node): value is Layout.ForStatement | Layout.ForInOrOfStatement {
    return value.kind === 249 || value.kind === 250 || value.kind === 251;
}

export function isNodeLayout_1232dc68b726(value: Layout.Node): value is Layout.ModuleDeclaration | Layout.EnumDeclaration {
    return value.kind === 267 || value.kind === 268;
}

export function isNodeLayout_ad42b2f26883(value: Layout.Node): value is Layout.ImportDeclaration | Layout.ExportDeclaration {
    return value.kind === 273 || value.kind === 279;
}

export function isNodeLayout_ad8e3ffcc71c(value: Layout.Node): value is Layout.ClassDeclaration | Layout.FunctionDeclaration {
    return value.kind === 263 || value.kind === 264;
}

export function isNodeLayout_3a8b779942f2(value: Layout.Node): value is Layout.MethodDeclaration | Layout.AccessorDeclaration {
    return value.kind === 175 || value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_a4b843632e5e(value: Layout.Node): value is Layout.AsExpression | Layout.TypeAssertion {
    return value.kind === 217 || value.kind === 235;
}

export function isNodeLayout_f913f2cb333c(value: Layout.Node): value is Layout.PrimitiveLiteral {
    return value.kind === 9 || value.kind === 10 || value.kind === 11 || value.kind === 15 || value.kind === 97 || value.kind === 112 || value.kind === 225;
}

export function isNodeLayout_34583df818d8(value: Layout.Node): value is Layout.UnionTypeNode | Layout.IntersectionTypeNode {
    return value.kind === 193 || value.kind === 194;
}

export function isNodeLayout_d3bc2d641bbb(value: Layout.Node): value is Layout.Mutable<Layout.SuperExpression> {
    return value.kind === 108;
}

export function isNodeLayout_1bf25640bb33(value: Layout.Node): value is Layout.Mutable<Layout.ThisExpression> {
    return value.kind === 110;
}

export function isNodeLayout_fd49999be36b(value: Layout.Node): value is Layout.Mutable<Layout.TypeAssertion> {
    return value.kind === 217;
}

export function isNodeLayout_99b92dd8f0c5(value: Layout.Node): value is Layout.Mutable<Layout.JSDocEnumTag> {
    return value.kind === 341;
}

export function isNodeLayout_ae2cefde45f1(value: Layout.Node): value is Layout.Mutable<Layout.SyntheticReferenceExpression> {
    return value.kind === 358;
}

export function isNodeLayout_3dc5dc1b841e(value: Layout.Node): value is Layout.AccessorDeclaration & {
    name: Layout.Identifier | Layout.ComputedPropertyName | Layout.NumericLiteral | Layout.StringLiteral | Layout.NoSubstitutionTemplateLiteral | Layout.BigIntLiteral;
} {
    return value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_9df34524530d(value: Layout.Node): value is Layout.HasJSDoc {
    return value.kind === 1 || value.kind === 80 || value.kind === 169 || value.kind === 170 || value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 203 || value.kind === 211 || value.kind === 212 || value.kind === 213 || value.kind === 218 || value.kind === 219 || value.kind === 220 || value.kind === 227 || value.kind === 232 || value.kind === 241 || value.kind === 242 || value.kind === 243 || value.kind === 244 || value.kind === 245 || value.kind === 246 || value.kind === 247 || value.kind === 248 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 252 || value.kind === 253 || value.kind === 254 || value.kind === 255 || value.kind === 256 || value.kind === 257 || value.kind === 258 || value.kind === 259 || value.kind === 260 || value.kind === 261 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 267 || value.kind === 268 || value.kind === 271 || value.kind === 272 || value.kind === 273 || value.kind === 278 || value.kind === 279 || value.kind === 282 || value.kind === 297 || value.kind === 304 || value.kind === 305 || value.kind === 306 || value.kind === 307 || value.kind === 318 || value.kind === 324;
}

export function isNodeLayout_27d27ce40162(value: Layout.Node): value is Layout.ModuleBody {
    return value.kind === 80 || value.kind === 268 || value.kind === 269;
}

export function isNodeLayout_2a67a53ef824(value: Layout.Node): value is Layout.Identifier | Layout.JSDocNamespaceDeclaration {
    return value.kind === 80 || value.kind === 268;
}

export function isNodeLayout_20b8debbba03(value: Layout.Node): value is Layout.ParameterDeclaration | Layout.PropertyDeclaration | Layout.MethodDeclaration {
    return value.kind === 170 || value.kind === 173 || value.kind === 175;
}

export function isNodeLayout_b4fcbab9d459(value: Layout.Node): value is Layout.FunctionLikeDeclaration | Layout.VariableDeclaration | Layout.ParameterDeclaration | Layout.PropertyDeclaration {
    return value.kind === 170 || value.kind === 173 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 219 || value.kind === 220 || value.kind === 261 || value.kind === 263;
}

export function isNodeLayout_7acd53b9f155(value: Layout.Node): value is Layout.NodeWithTypeArguments {
    return value.kind === 116 || value.kind === 133 || value.kind === 136 || value.kind === 141 || value.kind === 146 || value.kind === 150 || value.kind === 151 || value.kind === 154 || value.kind === 155 || value.kind === 157 || value.kind === 159 || value.kind === 163 || value.kind === 183 || value.kind === 184 || value.kind === 185 || value.kind === 186 || value.kind === 187 || value.kind === 188 || value.kind === 189 || value.kind === 190 || value.kind === 191 || value.kind === 192 || value.kind === 193 || value.kind === 194 || value.kind === 195 || value.kind === 196 || value.kind === 197 || value.kind === 198 || value.kind === 199 || value.kind === 200 || value.kind === 201 || value.kind === 202 || value.kind === 203 || value.kind === 204 || value.kind === 205 || value.kind === 206 || value.kind === 234 || value.kind === 310 || value.kind === 313 || value.kind === 314 || value.kind === 315 || value.kind === 316 || value.kind === 317 || value.kind === 318 || value.kind === 319 || value.kind === 320 || value.kind === 323 || value.kind === 324;
}

export function isNodeLayout_6c3951d430db(value: Layout.Node): value is Layout.TsConfigSourceFile {
    return value.kind === 308;
}

export function isNodeLayout_6c0b136a59c7(value: Layout.Node): value is Layout.PrefixUnaryExpression | Layout.PostfixUnaryExpression {
    return value.kind === 225 || value.kind === 226;
}

export function isNodeLayout_869b79c91faa(value: Layout.Node): value is Layout.ThisExpression {
    return value.kind === 110;
}

export function isNodeLayout_29d04b1e4179(value: Layout.Node): value is Layout.PrivateIdentifierPropertyDeclaration | Layout.PrivateIdentifierMethodDeclaration | Layout.PrivateIdentifierAccessorDeclaration {
    return value.kind === 173 || value.kind === 175 || value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_e16b19fcaf20(value: Layout.Node): value is Layout.Identifier | Layout.ElementAccessExpression | Layout.PropertyAccessExpression | Layout.ArrayLiteralExpression | Layout.ObjectLiteralExpression | Layout.AssignmentExpression<Layout.EqualsToken> {
    return value.kind === 80 || value.kind === 210 || value.kind === 211 || value.kind === 212 || value.kind === 213 || value.kind === 227;
}

export function isNodeLayout_0f2410e47c55(value: Layout.Node): value is Layout.ParameterDeclaration | Layout.PropertySignature | Layout.PropertyDeclaration | Layout.VariableDeclaration {
    return value.kind === 170 || value.kind === 172 || value.kind === 173 || value.kind === 261;
}

export function isNodeLayout_e5e811464d78(value: Layout.Node): value is Layout.SuperExpression {
    return value.kind === 108;
}

export function isNodeLayout_40fc5b9bd427(value: Layout.Node): value is Layout.DoStatement | Layout.WhileStatement {
    return value.kind === 247 || value.kind === 248;
}

export function isNodeLayout_a1cde841f749(value: Layout.Node): value is Layout.MethodDeclaration | Layout.MethodSignature | Layout.PropertySignature | Layout.PropertyDeclaration | Layout.PropertyAssignment | Layout.AccessorDeclaration {
    return value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 178 || value.kind === 179 || value.kind === 304;
}

export function isNodeLayout_e187c6930e8c(value: Layout.Node): value is Layout.ForStatement | Layout.ForInStatement | Layout.ForOfStatement {
    return value.kind === 249 || value.kind === 250 || value.kind === 251;
}

export function isNodeLayout_476015d35fe6(value: Layout.Node): value is Layout.JsxAttribute {
    return value.kind === 292;
}

export function isNodeLayout_63f000756beb(value: Layout.Node): value is Layout.VoidExpression {
    return value.kind === 223;
}

export function isNodeLayout_be7e46fed140(value: Layout.Node): value is Layout.FunctionDeclaration | Layout.ModuleDeclaration | Layout.ClassDeclaration | Layout.EnumDeclaration {
    return value.kind === 263 || value.kind === 264 || value.kind === 267 || value.kind === 268;
}

export function isNodeLayout_556e11ad371e(value: Layout.Node): value is Layout.ImportEqualsDeclaration | Layout.ImportDeclaration | Layout.ExportAssignment | Layout.ExportDeclaration {
    return value.kind === 272 || value.kind === 273 || value.kind === 278 || value.kind === 279;
}

export function isNodeLayout_e811dd07e204(value: Layout.Node): value is Layout.JSDocNullableType | Layout.JSDocNonNullableType | Layout.JSDocOptionalType {
    return value.kind === 315 || value.kind === 316 || value.kind === 317;
}

export function isNodeLayout_9b15fa0d1197(value: Layout.Node): value is Layout.HasType {
    return value.kind === 170 || value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 183 || value.kind === 185 || value.kind === 186 || value.kind === 197 || value.kind === 199 || value.kind === 201 || value.kind === 217 || value.kind === 219 || value.kind === 220 || value.kind === 235 || value.kind === 261 || value.kind === 263 || value.kind === 266 || value.kind === 310 || value.kind === 315 || value.kind === 316 || value.kind === 317 || value.kind === 318 || value.kind === 319;
}

export function isNodeLayout_3783293b55b3(value: Layout.Node): value is Layout.CallExpression | Layout.TaggedTemplateExpression {
    return value.kind === 214 || value.kind === 216;
}

export function isNodeLayout_015883beaf07(value: Layout.Node): value is Layout.AnyValidImportOrReExport {
    return value.kind === 206 || value.kind === 214 || value.kind === 272 || value.kind === 273 || value.kind === 279 || value.kind === 352;
}

export function isNodeLayout_5268997014b5(value: Layout.Node): value is Layout.ParameterDeclaration | Layout.MethodDeclaration | Layout.PropertyDeclaration {
    return value.kind === 170 || value.kind === 173 || value.kind === 175;
}

export function isNodeLayout_2383f9d030fb(value: Layout.Node): value is Layout.HasTypeArguments {
    return value.kind === 214 || value.kind === 215 || value.kind === 216 || value.kind === 286 || value.kind === 287;
}

export function isNodeLayout_c1933222576d(value: Layout.Node): value is Layout.ForInStatement | Layout.ForOfStatement | Layout.PrefixUnaryExpression | Layout.PostfixUnaryExpression | Layout.BinaryExpression {
    return value.kind === 225 || value.kind === 226 || value.kind === 227 || value.kind === 250 || value.kind === 251;
}

export function isNodeLayout_d9c6caad5d9c(value: Layout.Node): value is Layout.BindableStaticNameExpression {
    return value.kind === 80 || value.kind === 212 || value.kind === 213;
}

export function isNodeLayout_6cc9d75ae746(value: Layout.Node): value is Layout.AnonymousFunctionDefinition {
    return value.kind === 219 || value.kind === 220 || value.kind === 232;
}

export function isNodeLayout_01135a3055af(value: Layout.Node): value is Layout.EnumDeclaration | Layout.ModuleDeclaration {
    return value.kind === 267 || value.kind === 268;
}

export function isNodeLayout_5447b158efe1(value: Layout.Node): value is Layout.ForInStatement | Layout.ForOfStatement {
    return value.kind === 250 || value.kind === 251;
}

export function isNodeLayout_89d4a23668fe(value: Layout.Node): value is Layout.CallExpression | Layout.PropertyAccessExpression | Layout.ElementAccessExpression | Layout.AsExpression | Layout.NonNullExpression | Layout.PartiallyEmittedExpression | Layout.SatisfiesExpression {
    return value.kind === 212 || value.kind === 213 || value.kind === 214 || value.kind === 235 || value.kind === 236 || value.kind === 239 || value.kind === 356;
}

export function isNodeLayout_c7b64b07950d(value: Layout.Node): value is Layout.TypeLiteralNode | Layout.InterfaceDeclaration {
    return value.kind === 188 || value.kind === 265;
}

export function isNodeLayout_c1dea1044e05(value: Layout.Node): value is Layout.TupleTypeNode | Layout.ArrayLiteralExpression | Layout.CommaListExpression | Layout.NamedImports | Layout.NamedExports {
    return value.kind === 190 || value.kind === 210 || value.kind === 276 || value.kind === 280 || value.kind === 357;
}

export function isNodeLayout_039e3b07a553(value: Layout.Node): value is Layout.CallExpression | Layout.NewExpression {
    return value.kind === 214 || value.kind === 215;
}

export function isNodeLayout_b9f77c078db1(value: Layout.Node): value is Layout.JsxElement | Layout.JsxFragment {
    return value.kind === 285 || value.kind === 289;
}

export function isNodeLayout_4154153f4842(value: Layout.Node): value is Layout.Block | Layout.CaseOrDefaultClause | Layout.ModuleBlock {
    return value.kind === 242 || value.kind === 269 || value.kind === 297 || value.kind === 298;
}

export function isNodeLayout_a7bbf85736d6(value: Layout.Node): value is Layout.PropertyDeclaration | Layout.PropertySignature {
    return value.kind === 172 || value.kind === 173;
}

export function isNodeLayout_9217ecc49c86(value: Layout.Node): value is Layout.MethodDeclaration | Layout.AccessorDeclaration | Layout.PropertyAssignment {
    return value.kind === 175 || value.kind === 178 || value.kind === 179 || value.kind === 304;
}

export function isNodeLayout_81af5a8c761a(value: Layout.Node): value is Layout.SignatureDeclaration | Layout.PropertyDeclaration {
    return value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 263 || value.kind === 318;
}

export function isNodeLayout_d1f0252fdd0b(value: Layout.Node): value is Layout.FunctionExpression | Layout.ArrowFunction {
    return value.kind === 219 || value.kind === 220;
}

export function isNodeLayout_ec9c5ff1c177(value: Layout.Node): value is Layout.PropertySignature | Layout.PropertyDeclaration | Layout.VariableDeclaration {
    return value.kind === 172 || value.kind === 173 || value.kind === 261;
}

export function isNodeLayout_f909bad38188(value: Layout.Node): value is Layout.DestructuringPattern {
    return value.kind === 207 || value.kind === 208 || value.kind === 210 || value.kind === 211;
}

export function isNodeLayout_0b87a3ec757c(value: Layout.Node): value is Layout.TypeAssertion | Layout.AsExpression {
    return value.kind === 217 || value.kind === 235;
}

export function isNodeLayout_dca1ed623986(value: Layout.Node): value is Layout.VariableDeclaration | Layout.ParameterDeclaration {
    return value.kind === 170 || value.kind === 261;
}

export function isNodeLayout_f2f6e6ec751c(value: Layout.Node): value is Layout.JSDocThisTag | Layout.JSDocEnumTag {
    return value.kind === 341 || value.kind === 344;
}

export function isNodeLayout_5932c401b054(value: Layout.Node): value is Layout.ObjectLiteralExpression | Layout.AccessExpression {
    return value.kind === 211 || value.kind === 212 || value.kind === 213;
}

export function isNodeLayout_c1ad0907a2b3(value: Layout.Node): value is Layout.PropertyAccessExpression & {
    name: Layout.Identifier;
} {
    return value.kind === 212;
}

export function isNodeLayout_ab196bc35365(value: Layout.Node): value is Layout.BindingName {
    return value.kind === 80 || value.kind === 207 || value.kind === 208;
}

export function isNodeLayout_ff7acee78d0d(value: Layout.Node): value is Layout.BinaryExpression & {
    left: Layout.PropertyAccessExpression;
} {
    return value.kind === 227;
}

export function isNodeLayout_a9aa2b938ccb(value: Layout.Node): value is Layout.NamedImports {
    return value.kind === 276;
}

export function isNodeLayout_a6bc63cd7fbc(value: Layout.Node): value is Layout.QualifiedName & {
    left: Layout.Identifier;
} {
    return value.kind === 167;
}

export function isNodeLayout_ee724129a7be(value: Layout.Node): value is Layout.ExpressionStatement & {
    expression: Layout.CallExpression;
} {
    return value.kind === 245;
}

export function isNodeLayout_ae9401269231(value: Layout.Node): value is Layout.NamedTupleMember {
    return value.kind === 203;
}

export function isNodeLayout_d01568ece20e(value: Layout.Node): value is Layout.OptionalTypeNode | Layout.RestTypeNode | Layout.ParenthesizedTypeNode {
    return value.kind === 191 || value.kind === 192 || value.kind === 197;
}

export function isNodeLayout_50176be2887c(value: Layout.Node): value is Layout.ParameterDeclaration | Layout.PropertyDeclaration | Layout.VariableDeclaration {
    return value.kind === 170 || value.kind === 173 || value.kind === 261;
}

export function isNodeLayout_bd1908686ab2(value: Layout.Node): value is Layout.ObjectBindingPattern | Layout.ArrayBindingPattern {
    return value.kind === 207 || value.kind === 208;
}

export function isNodeLayout_4d3e7c4f0984(value: Layout.Node): value is Layout.QualifiedName | Layout.PropertyAccessExpression | Layout.ImportTypeNode {
    return value.kind === 167 || value.kind === 206 || value.kind === 212;
}

export function isNodeLayout_7424d94dd559(value: Layout.Node): value is Layout.ThisContainer {
    return value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 219 || value.kind === 263 || value.kind === 267 || value.kind === 268 || value.kind === 308;
}

export function isNodeLayout_783350f52824(value: Layout.Node): value is Layout.ImportEqualsDeclaration | Layout.ImportDeclaration | Layout.ImportSpecifier | Layout.JSDocImportTag | Layout.Token<typeof Layout.SyntaxKind.ImportKeyword> {
    return value.kind === 102 || value.kind === 272 || value.kind === 273 || value.kind === 277 || value.kind === 352;
}

export function isNodeLayout_684c7a650030(value: Layout.Node): value is Layout.NamedImportBindings {
    return value.kind === 275 || value.kind === 276;
}

export function isNodeLayout_8fd1c68f77c2(value: Layout.Node): value is Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.ConstructorDeclaration | Layout.MethodDeclaration | Layout.GetAccessorDeclaration | Layout.SetAccessorDeclaration {
    return value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 219 || value.kind === 263;
}

export function isNodeLayout_cd3ecaf715fe(value: Layout.Node): value is Layout.VariableDeclaration | Layout.PropertyDeclaration {
    return value.kind === 173 || value.kind === 261;
}

export function isNodeLayout_088c356f87ae(value: Layout.Node): value is Layout.ParameterDeclaration {
    return value.kind === 170;
}

export function isNodeLayout_553d8ae75609(value: Layout.Node): value is Layout.PrivateIdentifier | Layout.Identifier {
    return value.kind === 80 || value.kind === 81;
}

export function isNodeLayout_c489cd110ae8(value: Layout.Node): value is Layout.FunctionExpression | Layout.FunctionDeclaration {
    return value.kind === 219 || value.kind === 263;
}

export function isNodeLayout_f863d2efa6f9(value: Layout.Node): value is Layout.ClassLikeDeclaration | Layout.ObjectLiteralExpression {
    return value.kind === 211 || value.kind === 232 || value.kind === 264;
}

export function isNodeLayout_b76525ec62ce(value: Layout.Node): value is Layout.ClassDeclaration | Layout.ClassExpression | Layout.InterfaceDeclaration | Layout.TypeAliasDeclaration | Layout.JSDocTemplateTag {
    return value.kind === 232 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 346;
}

export function isNodeLayout_37557e5b1be8(value: Layout.Node): value is Layout.Identifier | Layout.CallExpression | Layout.ImportEqualsDeclaration | Layout.ImportDeclaration | Layout.ExportDeclaration | Layout.JSDocImportTag | Layout.ValidImportTypeNode {
    return value.kind === 80 || value.kind === 206 || value.kind === 214 || value.kind === 272 || value.kind === 273 || value.kind === 279 || value.kind === 352;
}

export function isNodeLayout_2ce83353fcb3(value: Layout.Node): value is Layout.ImportClause | Layout.NamespaceImport {
    return value.kind === 274 || value.kind === 275;
}

export function isNodeLayout_68fb5d777f27(value: Layout.Node): value is Layout.JSDocTypeTag | Layout.JSDocSatisfiesTag {
    return value.kind === 345 || value.kind === 351;
}

export function isNodeLayout_f1e859c4963f(value: Layout.Node): value is Layout.ImportClause | Layout.ImportSpecifier | Layout.ImportEqualsDeclaration {
    return value.kind === 272 || value.kind === 274 || value.kind === 277;
}

export function isNodeLayout_2ad9cd634a46(value: Layout.Node): value is Layout.BindingElement | Layout.PropertyDeclaration | Layout.VariableDeclaration | Layout.PropertyAssignment {
    return value.kind === 173 || value.kind === 209 || value.kind === 261 || value.kind === 304;
}

export function isNodeLayout_cfa7218fdd13(value: Layout.Node): value is Layout.AccessExpression {
    return value.kind === 212 || value.kind === 213;
}

export function isNodeLayout_f35dac544f77(value: Layout.Node): value is Layout.ArrowFunction | Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.ClassLikeDeclaration {
    return value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 263 || value.kind === 264;
}

export function isNodeLayout_d6df4b360db4(value: Layout.Node): value is Layout.CaseClause | Layout.DefaultClause {
    return value.kind === 297 || value.kind === 298;
}

export function isNodeLayout_5c66c7b04427(value: Layout.Node): value is Layout.TemplateExpression | Layout.NoSubstitutionTemplateLiteral {
    return value.kind === 15 || value.kind === 229;
}

export function isNodeLayout_f1f315b6081f(value: Layout.Node): value is Layout.ImportAttributes | Layout.NamedImports | Layout.NamedExports {
    return value.kind === 276 || value.kind === 280 || value.kind === 301;
}

export function isNodeLayout_beb74bd086d0(value: Layout.Node): value is Layout.StringLiteral {
    return value.kind === 11;
}

export function isNodeLayout_7ec425b974e0(value: Layout.Node): value is Layout.MethodSignature {
    return value.kind === 174;
}

export function isNodeLayout_d52cb5681306(value: Layout.Node): value is Layout.MethodDeclaration {
    return value.kind === 175;
}

export function isNodeLayout_8f76ff81a90b(value: Layout.Node): value is Layout.CallSignatureDeclaration {
    return value.kind === 180;
}

export function isNodeLayout_a77162bc9fd1(value: Layout.Node): value is Layout.ConstructorDeclaration {
    return value.kind === 177;
}

export function isNodeLayout_12007efa0aa9(value: Layout.Node): value is Layout.ConstructSignatureDeclaration {
    return value.kind === 181;
}

export function isNodeLayout_4be0fcab5bfa(value: Layout.Node): value is Layout.FunctionDeclaration {
    return value.kind === 263;
}

export function isNodeLayout_ed99856f39b9(value: Layout.Node): value is Layout.BreakStatement | Layout.ContinueStatement {
    return value.kind === 252 || value.kind === 253;
}

export function isNodeLayout_9bb832a7697a(value: Layout.Node): value is Layout.ArrowFunction | Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.MethodDeclaration {
    return value.kind === 175 || value.kind === 219 || value.kind === 220 || value.kind === 263;
}

export function isNodeLayout_9762855d4f33(value: Layout.Node): value is (Layout.ImportDeclaration & {
    moduleSpecifier: Layout.StringLiteralLike;
}) | (Layout.ImportEqualsDeclaration & {
    moduleReference: Layout.ExternalModuleReference & {
        expression: Layout.StringLiteralLike;
    };
}) | (Layout.VariableDeclaration & {
    initializer: Layout.RequireOrImportCall;
}) {
    return value.kind === 261 || value.kind === 272 || value.kind === 273;
}

export function isNodeLayout_f4877ea45d6c(value: Layout.Node): value is Layout.VariableDeclaration {
    return value.kind === 261;
}

export function isNodeLayout_77f0fcaf5cab(value: Layout.Node): value is Layout.EndOfFileToken {
    return value.kind === 1;
}

export function isNodeLayout_97f6ef97b9c1(value: Layout.Node): value is Layout.ExportDeclaration | Layout.ImportDeclaration {
    return value.kind === 273 || value.kind === 279;
}

export function isNodeLayout_e9a03eb3cf80(value: Layout.Node): value is Layout.ClassExpression | Layout.ClassDeclaration {
    return value.kind === 232 || value.kind === 264;
}

export function isNodeLayout_6b40be6e5215(value: Layout.Node): value is Layout.FunctionDeclaration | Layout.FunctionExpression {
    return value.kind === 219 || value.kind === 263;
}

export function isNodeLayout_1be734b78697(value: Layout.Node): value is Layout.IsBlockScopedContainer {
    return value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 188 || value.kind === 201 || value.kind === 211 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 242 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 267 || value.kind === 268 || value.kind === 270 || value.kind === 293 || value.kind === 300 || value.kind === 308 || value.kind === 318 || value.kind === 323 || value.kind === 324;
}

export function isNodeLayout_417f28611fe3(value: Layout.Node): value is Layout.PropertyAccessExpression | Layout.LiteralLikeElementAccessExpression {
    return value.kind === 212 || value.kind === 213;
}

export function isNodeLayout_7f3a9fffb6cc(value: Layout.Node): value is Layout.EntityName {
    return value.kind === 80 || value.kind === 167;
}

export function isNodeLayout_9aa59f142477(value: Layout.Node): value is Layout.ObjectLiteralExpression {
    return value.kind === 211;
}

export function isNodeLayout_f0623b5fe96d(value: Layout.Node): value is Layout.AccessorDeclaration {
    return value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_99312bfcd887(value: Layout.Node): value is Layout.GeneratedIdentifier | Layout.GeneratedPrivateIdentifier {
    return value.kind === 80 || value.kind === 81;
}

export function isNodeLayout_36363d80c5aa(value: Layout.Node): value is Layout.Block | Layout.CaseBlock | Layout.SourceFile | Layout.ModuleBlock {
    return value.kind === 242 || value.kind === 269 || value.kind === 270 || value.kind === 308;
}

export function isNodeLayout_da20ba9c0fd8(value: Layout.Node): value is Layout.ElementAccessExpression | Layout.PropertyAccessExpression | Layout.BinaryExpression {
    return value.kind === 212 || value.kind === 213 || value.kind === 227;
}

export function isNodeLayout_419bad5b034b(value: Layout.Node): value is Layout.CallExpression | Layout.NewExpression | Layout.TaggedTemplateExpression | Layout.JsxOpeningLikeElement {
    return value.kind === 214 || value.kind === 215 || value.kind === 216 || value.kind === 286 || value.kind === 287;
}

export function isNodeLayout_7956af0f59b1(value: Layout.Node): value is Layout.ClassLikeDeclaration {
    return value.kind === 232 || value.kind === 264;
}

export function isNodeLayout_b5fe47e62817(value: Layout.Node): value is Layout.InterfaceDeclaration | Layout.ClassLikeDeclaration {
    return value.kind === 232 || value.kind === 264 || value.kind === 265;
}

export function isNodeLayout_41b578461bc0(value: Layout.Node): value is Layout.ArrowFunction | Layout.Block | Layout.CallSignatureDeclaration | Layout.CaseBlock | Layout.ConstructorDeclaration | Layout.ConstructorTypeNode | Layout.ConstructSignatureDeclaration | Layout.ForStatement | Layout.ForInStatement | Layout.ForOfStatement | Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.FunctionTypeNode | Layout.GetAccessorDeclaration | Layout.MethodDeclaration | Layout.MethodSignature | Layout.ModuleDeclaration | Layout.SetAccessorDeclaration | Layout.SourceFile | Layout.TypeAliasDeclaration | Layout.InferTypeNode | Layout.ClassExpression | Layout.ClassDeclaration | Layout.InterfaceDeclaration {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 185 || value.kind === 186 || value.kind === 196 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 242 || value.kind === 249 || value.kind === 250 || value.kind === 251 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 268 || value.kind === 270 || value.kind === 308;
}

export function isNodeLayout_231a0273459b(value: Layout.Node): value is Layout.ArrowFunction | Layout.ClassStaticBlockDeclaration | Layout.ConstructorDeclaration | Layout.ConstructorTypeNode | Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.GetAccessorDeclaration | Layout.IndexSignatureDeclaration | Layout.MethodDeclaration | Layout.MethodSignature | Layout.ModuleDeclaration | Layout.SetAccessorDeclaration | Layout.TypeAliasDeclaration | Layout.VariableStatement | Layout.TypeParameterDeclaration | Layout.ParameterDeclaration | Layout.PropertySignature | Layout.PropertyDeclaration | Layout.ClassExpression | Layout.ClassDeclaration | Layout.InterfaceDeclaration | Layout.EnumDeclaration | Layout.NamespaceExportDeclaration | Layout.ImportEqualsDeclaration | Layout.ImportDeclaration | Layout.ExportAssignment | Layout.ExportDeclaration | Layout.PropertyAssignment | Layout.ShorthandPropertyAssignment | Layout.MissingDeclaration {
    return value.kind === 169 || value.kind === 170 || value.kind === 172 || value.kind === 173 || value.kind === 174 || value.kind === 175 || value.kind === 176 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 182 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 244 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 267 || value.kind === 268 || value.kind === 271 || value.kind === 272 || value.kind === 273 || value.kind === 278 || value.kind === 279 || value.kind === 283 || value.kind === 304 || value.kind === 305;
}

export function isNodeLayout_f39722694012(value: Layout.Node): value is Layout.ConditionalTypeNode | Layout.IntroducesNewScopeNode {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 195 || value.kind === 201 || value.kind === 219 || value.kind === 220 || value.kind === 263 || value.kind === 318 || value.kind === 324;
}

export function isNodeLayout_242c5f41efd4(value: Layout.Node): value is Layout.GetAccessorDeclaration | Layout.SetAccessorDeclaration {
    return value.kind === 178 || value.kind === 179;
}

export function isNodeLayout_7096999eac23(value: Layout.Node): value is Layout.ComputedPropertyName | Layout.ShorthandPropertyAssignment | Layout.SpreadAssignment {
    return value.kind === 168 || value.kind === 305 || value.kind === 306;
}

export function isNodeLayout_7e43de7f18ba(value: Layout.Node): value is Layout.ArrayLiteralExpression | Layout.SpreadElement {
    return value.kind === 210 || value.kind === 231;
}

export function isNodeLayout_d625d22ebbd2(value: Layout.Node): value is Layout.ArrowFunction | Layout.ConstructSignatureDeclaration | Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.MethodDeclaration {
    return value.kind === 175 || value.kind === 181 || value.kind === 219 || value.kind === 220 || value.kind === 263;
}

export function isNodeLayout_d4a63dc64ddc(value: Layout.Node): value is Layout.PropertyDeclaration | Layout.VariableDeclaration {
    return value.kind === 173 || value.kind === 261;
}

export function isNodeLayout_3ac832b676ee(value: Layout.Node): value is Layout.DeclarationWithTypeParameterChildren {
    return value.kind === 174 || value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 180 || value.kind === 181 || value.kind === 182 || value.kind === 185 || value.kind === 186 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 263 || value.kind === 264 || value.kind === 265 || value.kind === 266 || value.kind === 318 || value.kind === 346;
}

export function isNodeLayout_fcecece54f50(value: Layout.Node): value is Layout.TypeLiteralNode | Layout.InterfaceDeclaration | Layout.ClassLikeDeclaration {
    return value.kind === 188 || value.kind === 232 || value.kind === 264 || value.kind === 265;
}

export function isNodeLayout_667f8326fbf8(value: Layout.Node): value is Layout.ArrowFunction | Layout.ConstructorDeclaration | Layout.FunctionDeclaration | Layout.FunctionExpression | Layout.GetAccessorDeclaration | Layout.MethodDeclaration | Layout.SetAccessorDeclaration | Layout.SourceFile | Layout.ClassExpression | Layout.ClassDeclaration | Layout.ModuleBlock {
    return value.kind === 175 || value.kind === 177 || value.kind === 178 || value.kind === 179 || value.kind === 219 || value.kind === 220 || value.kind === 232 || value.kind === 263 || value.kind === 264 || value.kind === 269 || value.kind === 308;
}
