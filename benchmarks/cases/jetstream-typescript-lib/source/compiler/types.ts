// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/types.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type BaseNodeFactory, type CreateSourceFileOptions, type EmitHelperFactory, type GetCanonicalFileName, type MapLike, type ModeAwareCache, type ModeAwareCacheKey, type ModuleResolutionCache, type MultiMap, NodeFactoryFlags, type OptionsNameMap, type PackageJsonInfo, type PackageJsonInfoCache, type Pattern, type ProgramDiagnostics, type SymlinkCache, type ThisContainer } from "./_namespaces/ts.ts";
// branded string type used to store absolute, normalized and canonicalized paths
// arbitrary file name can be converted to Path via toPath function
export type Path = string;
/** @internal */
export type MatchingKeys<TRecord, TMatch, K extends keyof TRecord = keyof TRecord> = K extends (TRecord[K] extends TMatch ? K : never) ? K : never;
export interface TextRange {
    pos: number;
    end: number;
}
export interface ReadonlyTextRange {
    pos: number;
    end: number;
}
// token > SyntaxKind.Identifier => token is a keyword
// Also, If you add a new SyntaxKind be sure to keep the `Markers` section at the bottom in sync
export type SyntaxKind = number;
// token > SyntaxKind.Identifier => token is a keyword
// Also, If you add a new SyntaxKind be sure to keep the `Markers` section at the bottom in sync
export const SyntaxKind: {
    readonly Unknown: 0;
    readonly EndOfFileToken: 1;
    readonly SingleLineCommentTrivia: 2;
    readonly MultiLineCommentTrivia: 3;
    readonly NewLineTrivia: 4;
    readonly WhitespaceTrivia: 5;
    readonly ShebangTrivia: 6;
    readonly ConflictMarkerTrivia: 7;
    readonly NonTextFileMarkerTrivia: 8;
    readonly NumericLiteral: 9;
    readonly BigIntLiteral: 10;
    readonly StringLiteral: 11;
    readonly JsxText: 12;
    readonly JsxTextAllWhiteSpaces: 13;
    readonly RegularExpressionLiteral: 14;
    readonly NoSubstitutionTemplateLiteral: 15;
    readonly TemplateHead: 16;
    readonly TemplateMiddle: 17;
    readonly TemplateTail: 18;
    readonly OpenBraceToken: 19;
    readonly CloseBraceToken: 20;
    readonly OpenParenToken: 21;
    readonly CloseParenToken: 22;
    readonly OpenBracketToken: 23;
    readonly CloseBracketToken: 24;
    readonly DotToken: 25;
    readonly DotDotDotToken: 26;
    readonly SemicolonToken: 27;
    readonly CommaToken: 28;
    readonly QuestionDotToken: 29;
    readonly LessThanToken: 30;
    readonly LessThanSlashToken: 31;
    readonly GreaterThanToken: 32;
    readonly LessThanEqualsToken: 33;
    readonly GreaterThanEqualsToken: 34;
    readonly EqualsEqualsToken: 35;
    readonly ExclamationEqualsToken: 36;
    readonly EqualsEqualsEqualsToken: 37;
    readonly ExclamationEqualsEqualsToken: 38;
    readonly EqualsGreaterThanToken: 39;
    readonly PlusToken: 40;
    readonly MinusToken: 41;
    readonly AsteriskToken: 42;
    readonly AsteriskAsteriskToken: 43;
    readonly SlashToken: 44;
    readonly PercentToken: 45;
    readonly PlusPlusToken: 46;
    readonly MinusMinusToken: 47;
    readonly LessThanLessThanToken: 48;
    readonly GreaterThanGreaterThanToken: 49;
    readonly GreaterThanGreaterThanGreaterThanToken: 50;
    readonly AmpersandToken: 51;
    readonly BarToken: 52;
    readonly CaretToken: 53;
    readonly ExclamationToken: 54;
    readonly TildeToken: 55;
    readonly AmpersandAmpersandToken: 56;
    readonly BarBarToken: 57;
    readonly QuestionToken: 58;
    readonly ColonToken: 59;
    readonly AtToken: 60;
    readonly QuestionQuestionToken: 61;
    readonly BacktickToken: 62;
    readonly HashToken: 63;
    readonly EqualsToken: 64;
    readonly PlusEqualsToken: 65;
    readonly MinusEqualsToken: 66;
    readonly AsteriskEqualsToken: 67;
    readonly AsteriskAsteriskEqualsToken: 68;
    readonly SlashEqualsToken: 69;
    readonly PercentEqualsToken: 70;
    readonly LessThanLessThanEqualsToken: 71;
    readonly GreaterThanGreaterThanEqualsToken: 72;
    readonly GreaterThanGreaterThanGreaterThanEqualsToken: 73;
    readonly AmpersandEqualsToken: 74;
    readonly BarEqualsToken: 75;
    readonly BarBarEqualsToken: 76;
    readonly AmpersandAmpersandEqualsToken: 77;
    readonly QuestionQuestionEqualsToken: 78;
    readonly CaretEqualsToken: 79;
    readonly Identifier: 80;
    readonly PrivateIdentifier: 81;
    readonly JSDocCommentTextToken: 82;
    readonly BreakKeyword: 83;
    readonly CaseKeyword: 84;
    readonly CatchKeyword: 85;
    readonly ClassKeyword: 86;
    readonly ConstKeyword: 87;
    readonly ContinueKeyword: 88;
    readonly DebuggerKeyword: 89;
    readonly DefaultKeyword: 90;
    readonly DeleteKeyword: 91;
    readonly DoKeyword: 92;
    readonly ElseKeyword: 93;
    readonly EnumKeyword: 94;
    readonly ExportKeyword: 95;
    readonly ExtendsKeyword: 96;
    readonly FalseKeyword: 97;
    readonly FinallyKeyword: 98;
    readonly ForKeyword: 99;
    readonly FunctionKeyword: 100;
    readonly IfKeyword: 101;
    readonly ImportKeyword: 102;
    readonly InKeyword: 103;
    readonly InstanceOfKeyword: 104;
    readonly NewKeyword: 105;
    readonly NullKeyword: 106;
    readonly ReturnKeyword: 107;
    readonly SuperKeyword: 108;
    readonly SwitchKeyword: 109;
    readonly ThisKeyword: 110;
    readonly ThrowKeyword: 111;
    readonly TrueKeyword: 112;
    readonly TryKeyword: 113;
    readonly TypeOfKeyword: 114;
    readonly VarKeyword: 115;
    readonly VoidKeyword: 116;
    readonly WhileKeyword: 117;
    readonly WithKeyword: 118;
    readonly ImplementsKeyword: 119;
    readonly InterfaceKeyword: 120;
    readonly LetKeyword: 121;
    readonly PackageKeyword: 122;
    readonly PrivateKeyword: 123;
    readonly ProtectedKeyword: 124;
    readonly PublicKeyword: 125;
    readonly StaticKeyword: 126;
    readonly YieldKeyword: 127;
    readonly AbstractKeyword: 128;
    readonly AccessorKeyword: 129;
    readonly AsKeyword: 130;
    readonly AssertsKeyword: 131;
    readonly AssertKeyword: 132;
    readonly AnyKeyword: 133;
    readonly AsyncKeyword: 134;
    readonly AwaitKeyword: 135;
    readonly BooleanKeyword: 136;
    readonly ConstructorKeyword: 137;
    readonly DeclareKeyword: 138;
    readonly GetKeyword: 139;
    readonly InferKeyword: 140;
    readonly IntrinsicKeyword: 141;
    readonly IsKeyword: 142;
    readonly KeyOfKeyword: 143;
    readonly ModuleKeyword: 144;
    readonly NamespaceKeyword: 145;
    readonly NeverKeyword: 146;
    readonly OutKeyword: 147;
    readonly ReadonlyKeyword: 148;
    readonly RequireKeyword: 149;
    readonly NumberKeyword: 150;
    readonly ObjectKeyword: 151;
    readonly SatisfiesKeyword: 152;
    readonly SetKeyword: 153;
    readonly StringKeyword: 154;
    readonly SymbolKeyword: 155;
    readonly TypeKeyword: 156;
    readonly UndefinedKeyword: 157;
    readonly UniqueKeyword: 158;
    readonly UnknownKeyword: 159;
    readonly UsingKeyword: 160;
    readonly FromKeyword: 161;
    readonly GlobalKeyword: 162;
    readonly BigIntKeyword: 163;
    readonly OverrideKeyword: 164;
    readonly OfKeyword: 165;
    readonly DeferKeyword: 166;
    readonly QualifiedName: 167;
    readonly ComputedPropertyName: 168;
    readonly TypeParameter: 169;
    readonly Parameter: 170;
    readonly Decorator: 171;
    readonly PropertySignature: 172;
    readonly PropertyDeclaration: 173;
    readonly MethodSignature: 174;
    readonly MethodDeclaration: 175;
    readonly ClassStaticBlockDeclaration: 176;
    readonly Constructor: 177;
    readonly GetAccessor: 178;
    readonly SetAccessor: 179;
    readonly CallSignature: 180;
    readonly ConstructSignature: 181;
    readonly IndexSignature: 182;
    readonly TypePredicate: 183;
    readonly TypeReference: 184;
    readonly FunctionType: 185;
    readonly ConstructorType: 186;
    readonly TypeQuery: 187;
    readonly TypeLiteral: 188;
    readonly ArrayType: 189;
    readonly TupleType: 190;
    readonly OptionalType: 191;
    readonly RestType: 192;
    readonly UnionType: 193;
    readonly IntersectionType: 194;
    readonly ConditionalType: 195;
    readonly InferType: 196;
    readonly ParenthesizedType: 197;
    readonly ThisType: 198;
    readonly TypeOperator: 199;
    readonly IndexedAccessType: 200;
    readonly MappedType: 201;
    readonly LiteralType: 202;
    readonly NamedTupleMember: 203;
    readonly TemplateLiteralType: 204;
    readonly TemplateLiteralTypeSpan: 205;
    readonly ImportType: 206;
    readonly ObjectBindingPattern: 207;
    readonly ArrayBindingPattern: 208;
    readonly BindingElement: 209;
    readonly ArrayLiteralExpression: 210;
    readonly ObjectLiteralExpression: 211;
    readonly PropertyAccessExpression: 212;
    readonly ElementAccessExpression: 213;
    readonly CallExpression: 214;
    readonly NewExpression: 215;
    readonly TaggedTemplateExpression: 216;
    readonly TypeAssertionExpression: 217;
    readonly ParenthesizedExpression: 218;
    readonly FunctionExpression: 219;
    readonly ArrowFunction: 220;
    readonly DeleteExpression: 221;
    readonly TypeOfExpression: 222;
    readonly VoidExpression: 223;
    readonly AwaitExpression: 224;
    readonly PrefixUnaryExpression: 225;
    readonly PostfixUnaryExpression: 226;
    readonly BinaryExpression: 227;
    readonly ConditionalExpression: 228;
    readonly TemplateExpression: 229;
    readonly YieldExpression: 230;
    readonly SpreadElement: 231;
    readonly ClassExpression: 232;
    readonly OmittedExpression: 233;
    readonly ExpressionWithTypeArguments: 234;
    readonly AsExpression: 235;
    readonly NonNullExpression: 236;
    readonly MetaProperty: 237;
    readonly SyntheticExpression: 238;
    readonly SatisfiesExpression: 239;
    readonly TemplateSpan: 240;
    readonly SemicolonClassElement: 241;
    readonly Block: 242;
    readonly EmptyStatement: 243;
    readonly VariableStatement: 244;
    readonly ExpressionStatement: 245;
    readonly IfStatement: 246;
    readonly DoStatement: 247;
    readonly WhileStatement: 248;
    readonly ForStatement: 249;
    readonly ForInStatement: 250;
    readonly ForOfStatement: 251;
    readonly ContinueStatement: 252;
    readonly BreakStatement: 253;
    readonly ReturnStatement: 254;
    readonly WithStatement: 255;
    readonly SwitchStatement: 256;
    readonly LabeledStatement: 257;
    readonly ThrowStatement: 258;
    readonly TryStatement: 259;
    readonly DebuggerStatement: 260;
    readonly VariableDeclaration: 261;
    readonly VariableDeclarationList: 262;
    readonly FunctionDeclaration: 263;
    readonly ClassDeclaration: 264;
    readonly InterfaceDeclaration: 265;
    readonly TypeAliasDeclaration: 266;
    readonly EnumDeclaration: 267;
    readonly ModuleDeclaration: 268;
    readonly ModuleBlock: 269;
    readonly CaseBlock: 270;
    readonly NamespaceExportDeclaration: 271;
    readonly ImportEqualsDeclaration: 272;
    readonly ImportDeclaration: 273;
    readonly ImportClause: 274;
    readonly NamespaceImport: 275;
    readonly NamedImports: 276;
    readonly ImportSpecifier: 277;
    readonly ExportAssignment: 278;
    readonly ExportDeclaration: 279;
    readonly NamedExports: 280;
    readonly NamespaceExport: 281;
    readonly ExportSpecifier: 282;
    readonly MissingDeclaration: 283;
    readonly ExternalModuleReference: 284;
    readonly JsxElement: 285;
    readonly JsxSelfClosingElement: 286;
    readonly JsxOpeningElement: 287;
    readonly JsxClosingElement: 288;
    readonly JsxFragment: 289;
    readonly JsxOpeningFragment: 290;
    readonly JsxClosingFragment: 291;
    readonly JsxAttribute: 292;
    readonly JsxAttributes: 293;
    readonly JsxSpreadAttribute: 294;
    readonly JsxExpression: 295;
    readonly JsxNamespacedName: 296;
    readonly CaseClause: 297;
    readonly DefaultClause: 298;
    readonly HeritageClause: 299;
    readonly CatchClause: 300;
    readonly ImportAttributes: 301;
    readonly ImportAttribute: 302;
    readonly AssertClause: 301;
    readonly AssertEntry: 302;
    readonly ImportTypeAssertionContainer: 303;
    readonly PropertyAssignment: 304;
    readonly ShorthandPropertyAssignment: 305;
    readonly SpreadAssignment: 306;
    readonly EnumMember: 307;
    readonly SourceFile: 308;
    readonly Bundle: 309;
    readonly JSDocTypeExpression: 310;
    readonly JSDocNameReference: 311;
    readonly JSDocMemberName: 312;
    readonly JSDocAllType: 313;
    readonly JSDocUnknownType: 314;
    readonly JSDocNullableType: 315;
    readonly JSDocNonNullableType: 316;
    readonly JSDocOptionalType: 317;
    readonly JSDocFunctionType: 318;
    readonly JSDocVariadicType: 319;
    readonly JSDocNamepathType: 320;
    readonly JSDoc: 321;
    readonly JSDocComment: 321;
    readonly JSDocText: 322;
    readonly JSDocTypeLiteral: 323;
    readonly JSDocSignature: 324;
    readonly JSDocLink: 325;
    readonly JSDocLinkCode: 326;
    readonly JSDocLinkPlain: 327;
    readonly JSDocTag: 328;
    readonly JSDocAugmentsTag: 329;
    readonly JSDocImplementsTag: 330;
    readonly JSDocAuthorTag: 331;
    readonly JSDocDeprecatedTag: 332;
    readonly JSDocClassTag: 333;
    readonly JSDocPublicTag: 334;
    readonly JSDocPrivateTag: 335;
    readonly JSDocProtectedTag: 336;
    readonly JSDocReadonlyTag: 337;
    readonly JSDocOverrideTag: 338;
    readonly JSDocCallbackTag: 339;
    readonly JSDocOverloadTag: 340;
    readonly JSDocEnumTag: 341;
    readonly JSDocParameterTag: 342;
    readonly JSDocReturnTag: 343;
    readonly JSDocThisTag: 344;
    readonly JSDocTypeTag: 345;
    readonly JSDocTemplateTag: 346;
    readonly JSDocTypedefTag: 347;
    readonly JSDocSeeTag: 348;
    readonly JSDocPropertyTag: 349;
    readonly JSDocThrowsTag: 350;
    readonly JSDocSatisfiesTag: 351;
    readonly JSDocImportTag: 352;
    readonly SyntaxList: 353;
    readonly NotEmittedStatement: 354;
    readonly NotEmittedTypeElement: 355;
    readonly PartiallyEmittedExpression: 356;
    readonly CommaListExpression: 357;
    readonly SyntheticReferenceExpression: 358;
    readonly Count: 359;
    readonly FirstAssignment: 64;
    readonly LastAssignment: 79;
    readonly FirstCompoundAssignment: 65;
    readonly LastCompoundAssignment: 79;
    readonly FirstReservedWord: 83;
    readonly LastReservedWord: 118;
    readonly FirstKeyword: 83;
    readonly LastKeyword: 166;
    readonly FirstFutureReservedWord: 119;
    readonly LastFutureReservedWord: 127;
    readonly FirstTypeNode: 183;
    readonly LastTypeNode: 206;
    readonly FirstPunctuation: 19;
    readonly LastPunctuation: 79;
    readonly FirstToken: 0;
    readonly LastToken: 166;
    readonly FirstTriviaToken: 2;
    readonly LastTriviaToken: 7;
    readonly FirstLiteralToken: 9;
    readonly LastLiteralToken: 15;
    readonly FirstTemplateToken: 15;
    readonly LastTemplateToken: 18;
    readonly FirstBinaryOperator: 30;
    readonly LastBinaryOperator: 79;
    readonly FirstStatement: 244;
    readonly LastStatement: 260;
    readonly FirstNode: 167;
    readonly FirstJSDocNode: 310;
    readonly LastJSDocNode: 352;
    readonly FirstJSDocTagNode: 328;
    readonly LastJSDocTagNode: 352;
    readonly FirstContextualKeyword: 128;
    readonly LastContextualKeyword: 166;
    [index: number]: string;
} = {
    Unknown: 0,
    "0": "FirstToken",
    EndOfFileToken: 1,
    "1": "EndOfFileToken",
    SingleLineCommentTrivia: 2,
    "2": "FirstTriviaToken",
    MultiLineCommentTrivia: 3,
    "3": "MultiLineCommentTrivia",
    NewLineTrivia: 4,
    "4": "NewLineTrivia",
    WhitespaceTrivia: 5,
    "5": "WhitespaceTrivia",
    ShebangTrivia: 6,
    "6": "ShebangTrivia",
    ConflictMarkerTrivia: 7,
    "7": "LastTriviaToken",
    NonTextFileMarkerTrivia: 8,
    "8": "NonTextFileMarkerTrivia",
    NumericLiteral: 9,
    "9": "FirstLiteralToken",
    BigIntLiteral: 10,
    "10": "BigIntLiteral",
    StringLiteral: 11,
    "11": "StringLiteral",
    JsxText: 12,
    "12": "JsxText",
    JsxTextAllWhiteSpaces: 13,
    "13": "JsxTextAllWhiteSpaces",
    RegularExpressionLiteral: 14,
    "14": "RegularExpressionLiteral",
    NoSubstitutionTemplateLiteral: 15,
    "15": "FirstTemplateToken",
    TemplateHead: 16,
    "16": "TemplateHead",
    TemplateMiddle: 17,
    "17": "TemplateMiddle",
    TemplateTail: 18,
    "18": "LastTemplateToken",
    OpenBraceToken: 19,
    "19": "FirstPunctuation",
    CloseBraceToken: 20,
    "20": "CloseBraceToken",
    OpenParenToken: 21,
    "21": "OpenParenToken",
    CloseParenToken: 22,
    "22": "CloseParenToken",
    OpenBracketToken: 23,
    "23": "OpenBracketToken",
    CloseBracketToken: 24,
    "24": "CloseBracketToken",
    DotToken: 25,
    "25": "DotToken",
    DotDotDotToken: 26,
    "26": "DotDotDotToken",
    SemicolonToken: 27,
    "27": "SemicolonToken",
    CommaToken: 28,
    "28": "CommaToken",
    QuestionDotToken: 29,
    "29": "QuestionDotToken",
    LessThanToken: 30,
    "30": "FirstBinaryOperator",
    LessThanSlashToken: 31,
    "31": "LessThanSlashToken",
    GreaterThanToken: 32,
    "32": "GreaterThanToken",
    LessThanEqualsToken: 33,
    "33": "LessThanEqualsToken",
    GreaterThanEqualsToken: 34,
    "34": "GreaterThanEqualsToken",
    EqualsEqualsToken: 35,
    "35": "EqualsEqualsToken",
    ExclamationEqualsToken: 36,
    "36": "ExclamationEqualsToken",
    EqualsEqualsEqualsToken: 37,
    "37": "EqualsEqualsEqualsToken",
    ExclamationEqualsEqualsToken: 38,
    "38": "ExclamationEqualsEqualsToken",
    EqualsGreaterThanToken: 39,
    "39": "EqualsGreaterThanToken",
    PlusToken: 40,
    "40": "PlusToken",
    MinusToken: 41,
    "41": "MinusToken",
    AsteriskToken: 42,
    "42": "AsteriskToken",
    AsteriskAsteriskToken: 43,
    "43": "AsteriskAsteriskToken",
    SlashToken: 44,
    "44": "SlashToken",
    PercentToken: 45,
    "45": "PercentToken",
    PlusPlusToken: 46,
    "46": "PlusPlusToken",
    MinusMinusToken: 47,
    "47": "MinusMinusToken",
    LessThanLessThanToken: 48,
    "48": "LessThanLessThanToken",
    GreaterThanGreaterThanToken: 49,
    "49": "GreaterThanGreaterThanToken",
    GreaterThanGreaterThanGreaterThanToken: 50,
    "50": "GreaterThanGreaterThanGreaterThanToken",
    AmpersandToken: 51,
    "51": "AmpersandToken",
    BarToken: 52,
    "52": "BarToken",
    CaretToken: 53,
    "53": "CaretToken",
    ExclamationToken: 54,
    "54": "ExclamationToken",
    TildeToken: 55,
    "55": "TildeToken",
    AmpersandAmpersandToken: 56,
    "56": "AmpersandAmpersandToken",
    BarBarToken: 57,
    "57": "BarBarToken",
    QuestionToken: 58,
    "58": "QuestionToken",
    ColonToken: 59,
    "59": "ColonToken",
    AtToken: 60,
    "60": "AtToken",
    QuestionQuestionToken: 61,
    "61": "QuestionQuestionToken",
    BacktickToken: 62,
    "62": "BacktickToken",
    HashToken: 63,
    "63": "HashToken",
    EqualsToken: 64,
    "64": "FirstAssignment",
    PlusEqualsToken: 65,
    "65": "FirstCompoundAssignment",
    MinusEqualsToken: 66,
    "66": "MinusEqualsToken",
    AsteriskEqualsToken: 67,
    "67": "AsteriskEqualsToken",
    AsteriskAsteriskEqualsToken: 68,
    "68": "AsteriskAsteriskEqualsToken",
    SlashEqualsToken: 69,
    "69": "SlashEqualsToken",
    PercentEqualsToken: 70,
    "70": "PercentEqualsToken",
    LessThanLessThanEqualsToken: 71,
    "71": "LessThanLessThanEqualsToken",
    GreaterThanGreaterThanEqualsToken: 72,
    "72": "GreaterThanGreaterThanEqualsToken",
    GreaterThanGreaterThanGreaterThanEqualsToken: 73,
    "73": "GreaterThanGreaterThanGreaterThanEqualsToken",
    AmpersandEqualsToken: 74,
    "74": "AmpersandEqualsToken",
    BarEqualsToken: 75,
    "75": "BarEqualsToken",
    BarBarEqualsToken: 76,
    "76": "BarBarEqualsToken",
    AmpersandAmpersandEqualsToken: 77,
    "77": "AmpersandAmpersandEqualsToken",
    QuestionQuestionEqualsToken: 78,
    "78": "QuestionQuestionEqualsToken",
    CaretEqualsToken: 79,
    "79": "LastBinaryOperator",
    Identifier: 80,
    "80": "Identifier",
    PrivateIdentifier: 81,
    "81": "PrivateIdentifier",
    JSDocCommentTextToken: 82,
    "82": "JSDocCommentTextToken",
    BreakKeyword: 83,
    "83": "FirstKeyword",
    CaseKeyword: 84,
    "84": "CaseKeyword",
    CatchKeyword: 85,
    "85": "CatchKeyword",
    ClassKeyword: 86,
    "86": "ClassKeyword",
    ConstKeyword: 87,
    "87": "ConstKeyword",
    ContinueKeyword: 88,
    "88": "ContinueKeyword",
    DebuggerKeyword: 89,
    "89": "DebuggerKeyword",
    DefaultKeyword: 90,
    "90": "DefaultKeyword",
    DeleteKeyword: 91,
    "91": "DeleteKeyword",
    DoKeyword: 92,
    "92": "DoKeyword",
    ElseKeyword: 93,
    "93": "ElseKeyword",
    EnumKeyword: 94,
    "94": "EnumKeyword",
    ExportKeyword: 95,
    "95": "ExportKeyword",
    ExtendsKeyword: 96,
    "96": "ExtendsKeyword",
    FalseKeyword: 97,
    "97": "FalseKeyword",
    FinallyKeyword: 98,
    "98": "FinallyKeyword",
    ForKeyword: 99,
    "99": "ForKeyword",
    FunctionKeyword: 100,
    "100": "FunctionKeyword",
    IfKeyword: 101,
    "101": "IfKeyword",
    ImportKeyword: 102,
    "102": "ImportKeyword",
    InKeyword: 103,
    "103": "InKeyword",
    InstanceOfKeyword: 104,
    "104": "InstanceOfKeyword",
    NewKeyword: 105,
    "105": "NewKeyword",
    NullKeyword: 106,
    "106": "NullKeyword",
    ReturnKeyword: 107,
    "107": "ReturnKeyword",
    SuperKeyword: 108,
    "108": "SuperKeyword",
    SwitchKeyword: 109,
    "109": "SwitchKeyword",
    ThisKeyword: 110,
    "110": "ThisKeyword",
    ThrowKeyword: 111,
    "111": "ThrowKeyword",
    TrueKeyword: 112,
    "112": "TrueKeyword",
    TryKeyword: 113,
    "113": "TryKeyword",
    TypeOfKeyword: 114,
    "114": "TypeOfKeyword",
    VarKeyword: 115,
    "115": "VarKeyword",
    VoidKeyword: 116,
    "116": "VoidKeyword",
    WhileKeyword: 117,
    "117": "WhileKeyword",
    WithKeyword: 118,
    "118": "LastReservedWord",
    ImplementsKeyword: 119,
    "119": "FirstFutureReservedWord",
    InterfaceKeyword: 120,
    "120": "InterfaceKeyword",
    LetKeyword: 121,
    "121": "LetKeyword",
    PackageKeyword: 122,
    "122": "PackageKeyword",
    PrivateKeyword: 123,
    "123": "PrivateKeyword",
    ProtectedKeyword: 124,
    "124": "ProtectedKeyword",
    PublicKeyword: 125,
    "125": "PublicKeyword",
    StaticKeyword: 126,
    "126": "StaticKeyword",
    YieldKeyword: 127,
    "127": "LastFutureReservedWord",
    AbstractKeyword: 128,
    "128": "FirstContextualKeyword",
    AccessorKeyword: 129,
    "129": "AccessorKeyword",
    AsKeyword: 130,
    "130": "AsKeyword",
    AssertsKeyword: 131,
    "131": "AssertsKeyword",
    AssertKeyword: 132,
    "132": "AssertKeyword",
    AnyKeyword: 133,
    "133": "AnyKeyword",
    AsyncKeyword: 134,
    "134": "AsyncKeyword",
    AwaitKeyword: 135,
    "135": "AwaitKeyword",
    BooleanKeyword: 136,
    "136": "BooleanKeyword",
    ConstructorKeyword: 137,
    "137": "ConstructorKeyword",
    DeclareKeyword: 138,
    "138": "DeclareKeyword",
    GetKeyword: 139,
    "139": "GetKeyword",
    InferKeyword: 140,
    "140": "InferKeyword",
    IntrinsicKeyword: 141,
    "141": "IntrinsicKeyword",
    IsKeyword: 142,
    "142": "IsKeyword",
    KeyOfKeyword: 143,
    "143": "KeyOfKeyword",
    ModuleKeyword: 144,
    "144": "ModuleKeyword",
    NamespaceKeyword: 145,
    "145": "NamespaceKeyword",
    NeverKeyword: 146,
    "146": "NeverKeyword",
    OutKeyword: 147,
    "147": "OutKeyword",
    ReadonlyKeyword: 148,
    "148": "ReadonlyKeyword",
    RequireKeyword: 149,
    "149": "RequireKeyword",
    NumberKeyword: 150,
    "150": "NumberKeyword",
    ObjectKeyword: 151,
    "151": "ObjectKeyword",
    SatisfiesKeyword: 152,
    "152": "SatisfiesKeyword",
    SetKeyword: 153,
    "153": "SetKeyword",
    StringKeyword: 154,
    "154": "StringKeyword",
    SymbolKeyword: 155,
    "155": "SymbolKeyword",
    TypeKeyword: 156,
    "156": "TypeKeyword",
    UndefinedKeyword: 157,
    "157": "UndefinedKeyword",
    UniqueKeyword: 158,
    "158": "UniqueKeyword",
    UnknownKeyword: 159,
    "159": "UnknownKeyword",
    UsingKeyword: 160,
    "160": "UsingKeyword",
    FromKeyword: 161,
    "161": "FromKeyword",
    GlobalKeyword: 162,
    "162": "GlobalKeyword",
    BigIntKeyword: 163,
    "163": "BigIntKeyword",
    OverrideKeyword: 164,
    "164": "OverrideKeyword",
    OfKeyword: 165,
    "165": "OfKeyword",
    DeferKeyword: 166,
    "166": "LastContextualKeyword",
    QualifiedName: 167,
    "167": "FirstNode",
    ComputedPropertyName: 168,
    "168": "ComputedPropertyName",
    TypeParameter: 169,
    "169": "TypeParameter",
    Parameter: 170,
    "170": "Parameter",
    Decorator: 171,
    "171": "Decorator",
    PropertySignature: 172,
    "172": "PropertySignature",
    PropertyDeclaration: 173,
    "173": "PropertyDeclaration",
    MethodSignature: 174,
    "174": "MethodSignature",
    MethodDeclaration: 175,
    "175": "MethodDeclaration",
    ClassStaticBlockDeclaration: 176,
    "176": "ClassStaticBlockDeclaration",
    Constructor: 177,
    "177": "Constructor",
    GetAccessor: 178,
    "178": "GetAccessor",
    SetAccessor: 179,
    "179": "SetAccessor",
    CallSignature: 180,
    "180": "CallSignature",
    ConstructSignature: 181,
    "181": "ConstructSignature",
    IndexSignature: 182,
    "182": "IndexSignature",
    TypePredicate: 183,
    "183": "FirstTypeNode",
    TypeReference: 184,
    "184": "TypeReference",
    FunctionType: 185,
    "185": "FunctionType",
    ConstructorType: 186,
    "186": "ConstructorType",
    TypeQuery: 187,
    "187": "TypeQuery",
    TypeLiteral: 188,
    "188": "TypeLiteral",
    ArrayType: 189,
    "189": "ArrayType",
    TupleType: 190,
    "190": "TupleType",
    OptionalType: 191,
    "191": "OptionalType",
    RestType: 192,
    "192": "RestType",
    UnionType: 193,
    "193": "UnionType",
    IntersectionType: 194,
    "194": "IntersectionType",
    ConditionalType: 195,
    "195": "ConditionalType",
    InferType: 196,
    "196": "InferType",
    ParenthesizedType: 197,
    "197": "ParenthesizedType",
    ThisType: 198,
    "198": "ThisType",
    TypeOperator: 199,
    "199": "TypeOperator",
    IndexedAccessType: 200,
    "200": "IndexedAccessType",
    MappedType: 201,
    "201": "MappedType",
    LiteralType: 202,
    "202": "LiteralType",
    NamedTupleMember: 203,
    "203": "NamedTupleMember",
    TemplateLiteralType: 204,
    "204": "TemplateLiteralType",
    TemplateLiteralTypeSpan: 205,
    "205": "TemplateLiteralTypeSpan",
    ImportType: 206,
    "206": "LastTypeNode",
    ObjectBindingPattern: 207,
    "207": "ObjectBindingPattern",
    ArrayBindingPattern: 208,
    "208": "ArrayBindingPattern",
    BindingElement: 209,
    "209": "BindingElement",
    ArrayLiteralExpression: 210,
    "210": "ArrayLiteralExpression",
    ObjectLiteralExpression: 211,
    "211": "ObjectLiteralExpression",
    PropertyAccessExpression: 212,
    "212": "PropertyAccessExpression",
    ElementAccessExpression: 213,
    "213": "ElementAccessExpression",
    CallExpression: 214,
    "214": "CallExpression",
    NewExpression: 215,
    "215": "NewExpression",
    TaggedTemplateExpression: 216,
    "216": "TaggedTemplateExpression",
    TypeAssertionExpression: 217,
    "217": "TypeAssertionExpression",
    ParenthesizedExpression: 218,
    "218": "ParenthesizedExpression",
    FunctionExpression: 219,
    "219": "FunctionExpression",
    ArrowFunction: 220,
    "220": "ArrowFunction",
    DeleteExpression: 221,
    "221": "DeleteExpression",
    TypeOfExpression: 222,
    "222": "TypeOfExpression",
    VoidExpression: 223,
    "223": "VoidExpression",
    AwaitExpression: 224,
    "224": "AwaitExpression",
    PrefixUnaryExpression: 225,
    "225": "PrefixUnaryExpression",
    PostfixUnaryExpression: 226,
    "226": "PostfixUnaryExpression",
    BinaryExpression: 227,
    "227": "BinaryExpression",
    ConditionalExpression: 228,
    "228": "ConditionalExpression",
    TemplateExpression: 229,
    "229": "TemplateExpression",
    YieldExpression: 230,
    "230": "YieldExpression",
    SpreadElement: 231,
    "231": "SpreadElement",
    ClassExpression: 232,
    "232": "ClassExpression",
    OmittedExpression: 233,
    "233": "OmittedExpression",
    ExpressionWithTypeArguments: 234,
    "234": "ExpressionWithTypeArguments",
    AsExpression: 235,
    "235": "AsExpression",
    NonNullExpression: 236,
    "236": "NonNullExpression",
    MetaProperty: 237,
    "237": "MetaProperty",
    SyntheticExpression: 238,
    "238": "SyntheticExpression",
    SatisfiesExpression: 239,
    "239": "SatisfiesExpression",
    TemplateSpan: 240,
    "240": "TemplateSpan",
    SemicolonClassElement: 241,
    "241": "SemicolonClassElement",
    Block: 242,
    "242": "Block",
    EmptyStatement: 243,
    "243": "EmptyStatement",
    VariableStatement: 244,
    "244": "FirstStatement",
    ExpressionStatement: 245,
    "245": "ExpressionStatement",
    IfStatement: 246,
    "246": "IfStatement",
    DoStatement: 247,
    "247": "DoStatement",
    WhileStatement: 248,
    "248": "WhileStatement",
    ForStatement: 249,
    "249": "ForStatement",
    ForInStatement: 250,
    "250": "ForInStatement",
    ForOfStatement: 251,
    "251": "ForOfStatement",
    ContinueStatement: 252,
    "252": "ContinueStatement",
    BreakStatement: 253,
    "253": "BreakStatement",
    ReturnStatement: 254,
    "254": "ReturnStatement",
    WithStatement: 255,
    "255": "WithStatement",
    SwitchStatement: 256,
    "256": "SwitchStatement",
    LabeledStatement: 257,
    "257": "LabeledStatement",
    ThrowStatement: 258,
    "258": "ThrowStatement",
    TryStatement: 259,
    "259": "TryStatement",
    DebuggerStatement: 260,
    "260": "LastStatement",
    VariableDeclaration: 261,
    "261": "VariableDeclaration",
    VariableDeclarationList: 262,
    "262": "VariableDeclarationList",
    FunctionDeclaration: 263,
    "263": "FunctionDeclaration",
    ClassDeclaration: 264,
    "264": "ClassDeclaration",
    InterfaceDeclaration: 265,
    "265": "InterfaceDeclaration",
    TypeAliasDeclaration: 266,
    "266": "TypeAliasDeclaration",
    EnumDeclaration: 267,
    "267": "EnumDeclaration",
    ModuleDeclaration: 268,
    "268": "ModuleDeclaration",
    ModuleBlock: 269,
    "269": "ModuleBlock",
    CaseBlock: 270,
    "270": "CaseBlock",
    NamespaceExportDeclaration: 271,
    "271": "NamespaceExportDeclaration",
    ImportEqualsDeclaration: 272,
    "272": "ImportEqualsDeclaration",
    ImportDeclaration: 273,
    "273": "ImportDeclaration",
    ImportClause: 274,
    "274": "ImportClause",
    NamespaceImport: 275,
    "275": "NamespaceImport",
    NamedImports: 276,
    "276": "NamedImports",
    ImportSpecifier: 277,
    "277": "ImportSpecifier",
    ExportAssignment: 278,
    "278": "ExportAssignment",
    ExportDeclaration: 279,
    "279": "ExportDeclaration",
    NamedExports: 280,
    "280": "NamedExports",
    NamespaceExport: 281,
    "281": "NamespaceExport",
    ExportSpecifier: 282,
    "282": "ExportSpecifier",
    MissingDeclaration: 283,
    "283": "MissingDeclaration",
    ExternalModuleReference: 284,
    "284": "ExternalModuleReference",
    JsxElement: 285,
    "285": "JsxElement",
    JsxSelfClosingElement: 286,
    "286": "JsxSelfClosingElement",
    JsxOpeningElement: 287,
    "287": "JsxOpeningElement",
    JsxClosingElement: 288,
    "288": "JsxClosingElement",
    JsxFragment: 289,
    "289": "JsxFragment",
    JsxOpeningFragment: 290,
    "290": "JsxOpeningFragment",
    JsxClosingFragment: 291,
    "291": "JsxClosingFragment",
    JsxAttribute: 292,
    "292": "JsxAttribute",
    JsxAttributes: 293,
    "293": "JsxAttributes",
    JsxSpreadAttribute: 294,
    "294": "JsxSpreadAttribute",
    JsxExpression: 295,
    "295": "JsxExpression",
    JsxNamespacedName: 296,
    "296": "JsxNamespacedName",
    CaseClause: 297,
    "297": "CaseClause",
    DefaultClause: 298,
    "298": "DefaultClause",
    HeritageClause: 299,
    "299": "HeritageClause",
    CatchClause: 300,
    "300": "CatchClause",
    ImportAttributes: 301,
    "301": "AssertClause",
    ImportAttribute: 302,
    "302": "AssertEntry",
    AssertClause: 301,
    AssertEntry: 302,
    ImportTypeAssertionContainer: 303,
    "303": "ImportTypeAssertionContainer",
    PropertyAssignment: 304,
    "304": "PropertyAssignment",
    ShorthandPropertyAssignment: 305,
    "305": "ShorthandPropertyAssignment",
    SpreadAssignment: 306,
    "306": "SpreadAssignment",
    EnumMember: 307,
    "307": "EnumMember",
    SourceFile: 308,
    "308": "SourceFile",
    Bundle: 309,
    "309": "Bundle",
    JSDocTypeExpression: 310,
    "310": "FirstJSDocNode",
    JSDocNameReference: 311,
    "311": "JSDocNameReference",
    JSDocMemberName: 312,
    "312": "JSDocMemberName",
    JSDocAllType: 313,
    "313": "JSDocAllType",
    JSDocUnknownType: 314,
    "314": "JSDocUnknownType",
    JSDocNullableType: 315,
    "315": "JSDocNullableType",
    JSDocNonNullableType: 316,
    "316": "JSDocNonNullableType",
    JSDocOptionalType: 317,
    "317": "JSDocOptionalType",
    JSDocFunctionType: 318,
    "318": "JSDocFunctionType",
    JSDocVariadicType: 319,
    "319": "JSDocVariadicType",
    JSDocNamepathType: 320,
    "320": "JSDocNamepathType",
    JSDoc: 321,
    "321": "JSDocComment",
    JSDocComment: 321,
    JSDocText: 322,
    "322": "JSDocText",
    JSDocTypeLiteral: 323,
    "323": "JSDocTypeLiteral",
    JSDocSignature: 324,
    "324": "JSDocSignature",
    JSDocLink: 325,
    "325": "JSDocLink",
    JSDocLinkCode: 326,
    "326": "JSDocLinkCode",
    JSDocLinkPlain: 327,
    "327": "JSDocLinkPlain",
    JSDocTag: 328,
    "328": "FirstJSDocTagNode",
    JSDocAugmentsTag: 329,
    "329": "JSDocAugmentsTag",
    JSDocImplementsTag: 330,
    "330": "JSDocImplementsTag",
    JSDocAuthorTag: 331,
    "331": "JSDocAuthorTag",
    JSDocDeprecatedTag: 332,
    "332": "JSDocDeprecatedTag",
    JSDocClassTag: 333,
    "333": "JSDocClassTag",
    JSDocPublicTag: 334,
    "334": "JSDocPublicTag",
    JSDocPrivateTag: 335,
    "335": "JSDocPrivateTag",
    JSDocProtectedTag: 336,
    "336": "JSDocProtectedTag",
    JSDocReadonlyTag: 337,
    "337": "JSDocReadonlyTag",
    JSDocOverrideTag: 338,
    "338": "JSDocOverrideTag",
    JSDocCallbackTag: 339,
    "339": "JSDocCallbackTag",
    JSDocOverloadTag: 340,
    "340": "JSDocOverloadTag",
    JSDocEnumTag: 341,
    "341": "JSDocEnumTag",
    JSDocParameterTag: 342,
    "342": "JSDocParameterTag",
    JSDocReturnTag: 343,
    "343": "JSDocReturnTag",
    JSDocThisTag: 344,
    "344": "JSDocThisTag",
    JSDocTypeTag: 345,
    "345": "JSDocTypeTag",
    JSDocTemplateTag: 346,
    "346": "JSDocTemplateTag",
    JSDocTypedefTag: 347,
    "347": "JSDocTypedefTag",
    JSDocSeeTag: 348,
    "348": "JSDocSeeTag",
    JSDocPropertyTag: 349,
    "349": "JSDocPropertyTag",
    JSDocThrowsTag: 350,
    "350": "JSDocThrowsTag",
    JSDocSatisfiesTag: 351,
    "351": "JSDocSatisfiesTag",
    JSDocImportTag: 352,
    "352": "LastJSDocTagNode",
    SyntaxList: 353,
    "353": "SyntaxList",
    NotEmittedStatement: 354,
    "354": "NotEmittedStatement",
    NotEmittedTypeElement: 355,
    "355": "NotEmittedTypeElement",
    PartiallyEmittedExpression: 356,
    "356": "PartiallyEmittedExpression",
    CommaListExpression: 357,
    "357": "CommaListExpression",
    SyntheticReferenceExpression: 358,
    "358": "SyntheticReferenceExpression",
    Count: 359,
    "359": "Count",
    FirstAssignment: 64,
    LastAssignment: 79,
    FirstCompoundAssignment: 65,
    LastCompoundAssignment: 79,
    FirstReservedWord: 83,
    LastReservedWord: 118,
    FirstKeyword: 83,
    LastKeyword: 166,
    FirstFutureReservedWord: 119,
    LastFutureReservedWord: 127,
    FirstTypeNode: 183,
    LastTypeNode: 206,
    FirstPunctuation: 19,
    LastPunctuation: 79,
    FirstToken: 0,
    LastToken: 166,
    FirstTriviaToken: 2,
    LastTriviaToken: 7,
    FirstLiteralToken: 9,
    LastLiteralToken: 15,
    FirstTemplateToken: 15,
    LastTemplateToken: 18,
    FirstBinaryOperator: 30,
    LastBinaryOperator: 79,
    FirstStatement: 244,
    LastStatement: 260,
    FirstNode: 167,
    FirstJSDocNode: 310,
    LastJSDocNode: 352,
    FirstJSDocTagNode: 328,
    LastJSDocTagNode: 352,
    FirstContextualKeyword: 128,
    LastContextualKeyword: 166
};
export type TriviaSyntaxKind = typeof SyntaxKind.SingleLineCommentTrivia | typeof SyntaxKind.MultiLineCommentTrivia | typeof SyntaxKind.NewLineTrivia | typeof SyntaxKind.WhitespaceTrivia | typeof SyntaxKind.ShebangTrivia | typeof SyntaxKind.ConflictMarkerTrivia;
export type LiteralSyntaxKind = typeof SyntaxKind.NumericLiteral | typeof SyntaxKind.BigIntLiteral | typeof SyntaxKind.StringLiteral | typeof SyntaxKind.JsxText | typeof SyntaxKind.JsxTextAllWhiteSpaces | typeof SyntaxKind.RegularExpressionLiteral | typeof SyntaxKind.NoSubstitutionTemplateLiteral;
export type PseudoLiteralSyntaxKind = typeof SyntaxKind.TemplateHead | typeof SyntaxKind.TemplateMiddle | typeof SyntaxKind.TemplateTail;
export type PunctuationSyntaxKind = typeof SyntaxKind.OpenBraceToken | typeof SyntaxKind.CloseBraceToken | typeof SyntaxKind.OpenParenToken | typeof SyntaxKind.CloseParenToken | typeof SyntaxKind.OpenBracketToken | typeof SyntaxKind.CloseBracketToken | typeof SyntaxKind.DotToken | typeof SyntaxKind.DotDotDotToken | typeof SyntaxKind.SemicolonToken | typeof SyntaxKind.CommaToken | typeof SyntaxKind.QuestionDotToken | typeof SyntaxKind.LessThanToken | typeof SyntaxKind.LessThanSlashToken | typeof SyntaxKind.GreaterThanToken | typeof SyntaxKind.LessThanEqualsToken | typeof SyntaxKind.GreaterThanEqualsToken | typeof SyntaxKind.EqualsEqualsToken | typeof SyntaxKind.ExclamationEqualsToken | typeof SyntaxKind.EqualsEqualsEqualsToken | typeof SyntaxKind.ExclamationEqualsEqualsToken | typeof SyntaxKind.EqualsGreaterThanToken | typeof SyntaxKind.PlusToken | typeof SyntaxKind.MinusToken | typeof SyntaxKind.AsteriskToken | typeof SyntaxKind.AsteriskAsteriskToken | typeof SyntaxKind.SlashToken | typeof SyntaxKind.PercentToken | typeof SyntaxKind.PlusPlusToken | typeof SyntaxKind.MinusMinusToken | typeof SyntaxKind.LessThanLessThanToken | typeof SyntaxKind.GreaterThanGreaterThanToken | typeof SyntaxKind.GreaterThanGreaterThanGreaterThanToken | typeof SyntaxKind.AmpersandToken | typeof SyntaxKind.BarToken | typeof SyntaxKind.CaretToken | typeof SyntaxKind.ExclamationToken | typeof SyntaxKind.TildeToken | typeof SyntaxKind.AmpersandAmpersandToken | typeof SyntaxKind.AmpersandAmpersandEqualsToken | typeof SyntaxKind.BarBarToken | typeof SyntaxKind.BarBarEqualsToken | typeof SyntaxKind.QuestionQuestionToken | typeof SyntaxKind.QuestionQuestionEqualsToken | typeof SyntaxKind.QuestionToken | typeof SyntaxKind.ColonToken | typeof SyntaxKind.AtToken | typeof SyntaxKind.BacktickToken | typeof SyntaxKind.HashToken | typeof SyntaxKind.EqualsToken | typeof SyntaxKind.PlusEqualsToken | typeof SyntaxKind.MinusEqualsToken | typeof SyntaxKind.AsteriskEqualsToken | typeof SyntaxKind.AsteriskAsteriskEqualsToken | typeof SyntaxKind.SlashEqualsToken | typeof SyntaxKind.PercentEqualsToken | typeof SyntaxKind.LessThanLessThanEqualsToken | typeof SyntaxKind.GreaterThanGreaterThanEqualsToken | typeof SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken | typeof SyntaxKind.AmpersandEqualsToken | typeof SyntaxKind.BarEqualsToken | typeof SyntaxKind.CaretEqualsToken;
/** @internal */
export type PunctuationOrKeywordSyntaxKind = PunctuationSyntaxKind | KeywordSyntaxKind;
export type KeywordSyntaxKind = typeof SyntaxKind.AbstractKeyword | typeof SyntaxKind.AccessorKeyword | typeof SyntaxKind.AnyKeyword | typeof SyntaxKind.AsKeyword | typeof SyntaxKind.AssertsKeyword | typeof SyntaxKind.AssertKeyword | typeof SyntaxKind.AsyncKeyword | typeof SyntaxKind.AwaitKeyword | typeof SyntaxKind.BigIntKeyword | typeof SyntaxKind.BooleanKeyword | typeof SyntaxKind.BreakKeyword | typeof SyntaxKind.CaseKeyword | typeof SyntaxKind.CatchKeyword | typeof SyntaxKind.ClassKeyword | typeof SyntaxKind.ConstKeyword | typeof SyntaxKind.ConstructorKeyword | typeof SyntaxKind.ContinueKeyword | typeof SyntaxKind.DebuggerKeyword | typeof SyntaxKind.DeclareKeyword | typeof SyntaxKind.DefaultKeyword | typeof SyntaxKind.DeferKeyword | typeof SyntaxKind.DeleteKeyword | typeof SyntaxKind.DoKeyword | typeof SyntaxKind.ElseKeyword | typeof SyntaxKind.EnumKeyword | typeof SyntaxKind.ExportKeyword | typeof SyntaxKind.ExtendsKeyword | typeof SyntaxKind.FalseKeyword | typeof SyntaxKind.FinallyKeyword | typeof SyntaxKind.ForKeyword | typeof SyntaxKind.FromKeyword | typeof SyntaxKind.FunctionKeyword | typeof SyntaxKind.GetKeyword | typeof SyntaxKind.GlobalKeyword | typeof SyntaxKind.IfKeyword | typeof SyntaxKind.ImplementsKeyword | typeof SyntaxKind.ImportKeyword | typeof SyntaxKind.InferKeyword | typeof SyntaxKind.InKeyword | typeof SyntaxKind.InstanceOfKeyword | typeof SyntaxKind.InterfaceKeyword | typeof SyntaxKind.IntrinsicKeyword | typeof SyntaxKind.IsKeyword | typeof SyntaxKind.KeyOfKeyword | typeof SyntaxKind.LetKeyword | typeof SyntaxKind.ModuleKeyword | typeof SyntaxKind.NamespaceKeyword | typeof SyntaxKind.NeverKeyword | typeof SyntaxKind.NewKeyword | typeof SyntaxKind.NullKeyword | typeof SyntaxKind.NumberKeyword | typeof SyntaxKind.ObjectKeyword | typeof SyntaxKind.OfKeyword | typeof SyntaxKind.PackageKeyword | typeof SyntaxKind.PrivateKeyword | typeof SyntaxKind.ProtectedKeyword | typeof SyntaxKind.PublicKeyword | typeof SyntaxKind.ReadonlyKeyword | typeof SyntaxKind.OutKeyword | typeof SyntaxKind.OverrideKeyword | typeof SyntaxKind.RequireKeyword | typeof SyntaxKind.ReturnKeyword | typeof SyntaxKind.SatisfiesKeyword | typeof SyntaxKind.SetKeyword | typeof SyntaxKind.StaticKeyword | typeof SyntaxKind.StringKeyword | typeof SyntaxKind.SuperKeyword | typeof SyntaxKind.SwitchKeyword | typeof SyntaxKind.SymbolKeyword | typeof SyntaxKind.ThisKeyword | typeof SyntaxKind.ThrowKeyword | typeof SyntaxKind.TrueKeyword | typeof SyntaxKind.TryKeyword | typeof SyntaxKind.TypeKeyword | typeof SyntaxKind.TypeOfKeyword | typeof SyntaxKind.UndefinedKeyword | typeof SyntaxKind.UniqueKeyword | typeof SyntaxKind.UnknownKeyword | typeof SyntaxKind.UsingKeyword | typeof SyntaxKind.VarKeyword | typeof SyntaxKind.VoidKeyword | typeof SyntaxKind.WhileKeyword | typeof SyntaxKind.WithKeyword | typeof SyntaxKind.YieldKeyword;
export type ModifierSyntaxKind = typeof SyntaxKind.AbstractKeyword | typeof SyntaxKind.AccessorKeyword | typeof SyntaxKind.AsyncKeyword | typeof SyntaxKind.ConstKeyword | typeof SyntaxKind.DeclareKeyword | typeof SyntaxKind.DefaultKeyword | typeof SyntaxKind.ExportKeyword | typeof SyntaxKind.InKeyword | typeof SyntaxKind.PrivateKeyword | typeof SyntaxKind.ProtectedKeyword | typeof SyntaxKind.PublicKeyword | typeof SyntaxKind.ReadonlyKeyword | typeof SyntaxKind.OutKeyword | typeof SyntaxKind.OverrideKeyword | typeof SyntaxKind.StaticKeyword;
export type KeywordTypeSyntaxKind = typeof SyntaxKind.AnyKeyword | typeof SyntaxKind.BigIntKeyword | typeof SyntaxKind.BooleanKeyword | typeof SyntaxKind.IntrinsicKeyword | typeof SyntaxKind.NeverKeyword | typeof SyntaxKind.NumberKeyword | typeof SyntaxKind.ObjectKeyword | typeof SyntaxKind.StringKeyword | typeof SyntaxKind.SymbolKeyword | typeof SyntaxKind.UndefinedKeyword | typeof SyntaxKind.UnknownKeyword | typeof SyntaxKind.VoidKeyword;
/** @internal */
export type TypeNodeSyntaxKind = KeywordTypeSyntaxKind | typeof SyntaxKind.Identifier | typeof SyntaxKind.QualifiedName | typeof SyntaxKind.TypeParameter | typeof SyntaxKind.TypePredicate | typeof SyntaxKind.TypeReference | typeof SyntaxKind.FunctionType | typeof SyntaxKind.ConstructorType | typeof SyntaxKind.TypeQuery | typeof SyntaxKind.TypeLiteral | typeof SyntaxKind.ArrayType | typeof SyntaxKind.TupleType | typeof SyntaxKind.NamedTupleMember | typeof SyntaxKind.OptionalType | typeof SyntaxKind.RestType | typeof SyntaxKind.UnionType | typeof SyntaxKind.IntersectionType | typeof SyntaxKind.ConditionalType | typeof SyntaxKind.InferType | typeof SyntaxKind.ParenthesizedType | typeof SyntaxKind.ThisType | typeof SyntaxKind.TypeOperator | typeof SyntaxKind.IndexedAccessType | typeof SyntaxKind.MappedType | typeof SyntaxKind.LiteralType | typeof SyntaxKind.TemplateLiteralType | typeof SyntaxKind.TemplateLiteralTypeSpan | typeof SyntaxKind.ImportType | typeof SyntaxKind.ExpressionWithTypeArguments | typeof SyntaxKind.JSDocTypeExpression | typeof SyntaxKind.JSDocAllType | typeof SyntaxKind.JSDocUnknownType | typeof SyntaxKind.JSDocNonNullableType | typeof SyntaxKind.JSDocNullableType | typeof SyntaxKind.JSDocOptionalType | typeof SyntaxKind.JSDocFunctionType | typeof SyntaxKind.JSDocVariadicType | typeof SyntaxKind.JSDocNamepathType | typeof SyntaxKind.JSDocSignature | typeof SyntaxKind.JSDocTypeLiteral;
export type TokenSyntaxKind = typeof SyntaxKind.Unknown | typeof SyntaxKind.EndOfFileToken | TriviaSyntaxKind | LiteralSyntaxKind | PseudoLiteralSyntaxKind | PunctuationSyntaxKind | typeof SyntaxKind.Identifier | KeywordSyntaxKind;
export type JsxTokenSyntaxKind = typeof SyntaxKind.LessThanSlashToken | typeof SyntaxKind.EndOfFileToken | typeof SyntaxKind.ConflictMarkerTrivia | typeof SyntaxKind.JsxText | typeof SyntaxKind.JsxTextAllWhiteSpaces | typeof SyntaxKind.OpenBraceToken | typeof SyntaxKind.LessThanToken;
export type JSDocSyntaxKind = typeof SyntaxKind.EndOfFileToken | typeof SyntaxKind.WhitespaceTrivia | typeof SyntaxKind.AtToken | typeof SyntaxKind.NewLineTrivia | typeof SyntaxKind.AsteriskToken | typeof SyntaxKind.OpenBraceToken | typeof SyntaxKind.CloseBraceToken | typeof SyntaxKind.LessThanToken | typeof SyntaxKind.GreaterThanToken | typeof SyntaxKind.OpenBracketToken | typeof SyntaxKind.CloseBracketToken | typeof SyntaxKind.OpenParenToken | typeof SyntaxKind.CloseParenToken | typeof SyntaxKind.EqualsToken | typeof SyntaxKind.CommaToken | typeof SyntaxKind.DotToken | typeof SyntaxKind.Identifier | typeof SyntaxKind.BacktickToken | typeof SyntaxKind.HashToken | typeof SyntaxKind.Unknown | KeywordSyntaxKind;
// dprint-ignore
export type NodeFlags = number;
// dprint-ignore
export const NodeFlags: {
    readonly None: 0;
    readonly Let: 1;
    readonly Const: 2;
    readonly Using: 4;
    readonly AwaitUsing: 6;
    readonly NestedNamespace: 8;
    readonly Synthesized: 16;
    readonly Namespace: 32;
    readonly OptionalChain: 64;
    readonly ExportContext: 128;
    readonly ContainsThis: 256;
    readonly HasImplicitReturn: 512;
    readonly HasExplicitReturn: 1024;
    readonly GlobalAugmentation: 2048;
    readonly HasAsyncFunctions: 4096;
    readonly DisallowInContext: 8192;
    readonly YieldContext: 16384;
    readonly DecoratorContext: 32768;
    readonly AwaitContext: 65536;
    readonly DisallowConditionalTypesContext: 131072;
    readonly ThisNodeHasError: 262144;
    readonly JavaScriptFile: 524288;
    readonly ThisNodeOrAnySubNodesHasError: 1048576;
    readonly HasAggregatedChildData: 2097152;
    readonly PossiblyContainsDynamicImport: 4194304;
    readonly PossiblyContainsImportMeta: 8388608;
    readonly JSDoc: 16777216;
    readonly Ambient: 33554432;
    readonly InWithStatement: 67108864;
    readonly JsonFile: 134217728;
    readonly TypeCached: 268435456;
    readonly Deprecated: 536870912;
    readonly BlockScoped: 7;
    readonly Constant: 6;
    readonly ReachabilityCheckFlags: 1536;
    readonly ReachabilityAndEmitFlags: 5632;
    readonly ContextFlags: 101441536;
    readonly TypeExcludesFlags: 81920;
    readonly PermanentlySetIncrementalFlags: 12582912;
    readonly IdentifierHasExtendedUnicodeEscape: 256;
    readonly IdentifierIsInJSDocNamespace: 4096;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Let: 1,
    "1": "Let",
    Const: 2,
    "2": "Const",
    Using: 4,
    "4": "Using",
    AwaitUsing: 6,
    "6": "Constant",
    NestedNamespace: 8,
    "8": "NestedNamespace",
    Synthesized: 16,
    "16": "Synthesized",
    Namespace: 32,
    "32": "Namespace",
    OptionalChain: 64,
    "64": "OptionalChain",
    ExportContext: 128,
    "128": "ExportContext",
    ContainsThis: 256,
    "256": "IdentifierHasExtendedUnicodeEscape",
    HasImplicitReturn: 512,
    "512": "HasImplicitReturn",
    HasExplicitReturn: 1024,
    "1024": "HasExplicitReturn",
    GlobalAugmentation: 2048,
    "2048": "GlobalAugmentation",
    HasAsyncFunctions: 4096,
    "4096": "IdentifierIsInJSDocNamespace",
    DisallowInContext: 8192,
    "8192": "DisallowInContext",
    YieldContext: 16384,
    "16384": "YieldContext",
    DecoratorContext: 32768,
    "32768": "DecoratorContext",
    AwaitContext: 65536,
    "65536": "AwaitContext",
    DisallowConditionalTypesContext: 131072,
    "131072": "DisallowConditionalTypesContext",
    ThisNodeHasError: 262144,
    "262144": "ThisNodeHasError",
    JavaScriptFile: 524288,
    "524288": "JavaScriptFile",
    ThisNodeOrAnySubNodesHasError: 1048576,
    "1048576": "ThisNodeOrAnySubNodesHasError",
    HasAggregatedChildData: 2097152,
    "2097152": "HasAggregatedChildData",
    PossiblyContainsDynamicImport: 4194304,
    "4194304": "PossiblyContainsDynamicImport",
    PossiblyContainsImportMeta: 8388608,
    "8388608": "PossiblyContainsImportMeta",
    JSDoc: 16777216,
    "16777216": "JSDoc",
    Ambient: 33554432,
    "33554432": "Ambient",
    InWithStatement: 67108864,
    "67108864": "InWithStatement",
    JsonFile: 134217728,
    "134217728": "JsonFile",
    TypeCached: 268435456,
    "268435456": "TypeCached",
    Deprecated: 536870912,
    "536870912": "Deprecated",
    BlockScoped: 7,
    "7": "BlockScoped",
    Constant: 6,
    ReachabilityCheckFlags: 1536,
    "1536": "ReachabilityCheckFlags",
    ReachabilityAndEmitFlags: 5632,
    "5632": "ReachabilityAndEmitFlags",
    ContextFlags: 101441536,
    "101441536": "ContextFlags",
    TypeExcludesFlags: 81920,
    "81920": "TypeExcludesFlags",
    PermanentlySetIncrementalFlags: 12582912,
    "12582912": "PermanentlySetIncrementalFlags",
    IdentifierHasExtendedUnicodeEscape: 256,
    IdentifierIsInJSDocNamespace: 4096
};
// dprint-ignore
export type ModifierFlags = number;
// dprint-ignore
export const ModifierFlags: {
    readonly None: 0;
    readonly Public: 1;
    readonly Private: 2;
    readonly Protected: 4;
    readonly Readonly: 8;
    readonly Override: 16;
    readonly Export: 32;
    readonly Abstract: 64;
    readonly Ambient: 128;
    readonly Static: 256;
    readonly Accessor: 512;
    readonly Async: 1024;
    readonly Default: 2048;
    readonly Const: 4096;
    readonly In: 8192;
    readonly Out: 16384;
    readonly Decorator: 32768;
    readonly Deprecated: 65536;
    readonly JSDocPublic: 8388608;
    readonly JSDocPrivate: 16777216;
    readonly JSDocProtected: 33554432;
    readonly JSDocReadonly: 67108864;
    readonly JSDocOverride: 134217728;
    readonly SyntacticOrJSDocModifiers: 31;
    readonly SyntacticOnlyModifiers: 65504;
    readonly SyntacticModifiers: 65535;
    readonly JSDocCacheOnlyModifiers: 260046848;
    readonly JSDocOnlyModifiers: 65536;
    readonly NonCacheOnlyModifiers: 131071;
    readonly HasComputedJSDocModifiers: 268435456;
    readonly HasComputedFlags: 536870912;
    readonly AccessibilityModifier: 7;
    readonly ParameterPropertyModifier: 31;
    readonly NonPublicAccessibilityModifier: 6;
    readonly TypeScriptModifier: 28895;
    readonly ExportDefault: 2080;
    readonly All: 131071;
    readonly Modifier: 98303;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Public: 1,
    "1": "Public",
    Private: 2,
    "2": "Private",
    Protected: 4,
    "4": "Protected",
    Readonly: 8,
    "8": "Readonly",
    Override: 16,
    "16": "Override",
    Export: 32,
    "32": "Export",
    Abstract: 64,
    "64": "Abstract",
    Ambient: 128,
    "128": "Ambient",
    Static: 256,
    "256": "Static",
    Accessor: 512,
    "512": "Accessor",
    Async: 1024,
    "1024": "Async",
    Default: 2048,
    "2048": "Default",
    Const: 4096,
    "4096": "Const",
    In: 8192,
    "8192": "In",
    Out: 16384,
    "16384": "Out",
    Decorator: 32768,
    "32768": "Decorator",
    Deprecated: 65536,
    "65536": "JSDocOnlyModifiers",
    JSDocPublic: 8388608,
    "8388608": "JSDocPublic",
    JSDocPrivate: 16777216,
    "16777216": "JSDocPrivate",
    JSDocProtected: 33554432,
    "33554432": "JSDocProtected",
    JSDocReadonly: 67108864,
    "67108864": "JSDocReadonly",
    JSDocOverride: 134217728,
    "134217728": "JSDocOverride",
    SyntacticOrJSDocModifiers: 31,
    "31": "ParameterPropertyModifier",
    SyntacticOnlyModifiers: 65504,
    "65504": "SyntacticOnlyModifiers",
    SyntacticModifiers: 65535,
    "65535": "SyntacticModifiers",
    JSDocCacheOnlyModifiers: 260046848,
    "260046848": "JSDocCacheOnlyModifiers",
    JSDocOnlyModifiers: 65536,
    NonCacheOnlyModifiers: 131071,
    "131071": "All",
    HasComputedJSDocModifiers: 268435456,
    "268435456": "HasComputedJSDocModifiers",
    HasComputedFlags: 536870912,
    "536870912": "HasComputedFlags",
    AccessibilityModifier: 7,
    "7": "AccessibilityModifier",
    ParameterPropertyModifier: 31,
    NonPublicAccessibilityModifier: 6,
    "6": "NonPublicAccessibilityModifier",
    TypeScriptModifier: 28895,
    "28895": "TypeScriptModifier",
    ExportDefault: 2080,
    "2080": "ExportDefault",
    All: 131071,
    Modifier: 98303,
    "98303": "Modifier"
};
export type JsxFlags = number;
export const JsxFlags: {
    readonly None: 0;
    readonly IntrinsicNamedElement: 1;
    readonly IntrinsicIndexedElement: 2;
    readonly IntrinsicElement: 3;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    IntrinsicNamedElement: 1,
    "1": "IntrinsicNamedElement",
    IntrinsicIndexedElement: 2,
    "2": "IntrinsicIndexedElement",
    IntrinsicElement: 3,
    "3": "IntrinsicElement"
};
// dprint-ignore
/** @internal */
export type RelationComparisonResult = number;
// dprint-ignore
/** @internal */
export const RelationComparisonResult: {
    readonly None: 0;
    readonly Succeeded: 1;
    readonly Failed: 2;
    readonly ReportsUnmeasurable: 8;
    readonly ReportsUnreliable: 16;
    readonly ReportsMask: 24;
    readonly ComplexityOverflow: 32;
    readonly StackDepthOverflow: 64;
    readonly Overflow: 96;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Succeeded: 1,
    "1": "Succeeded",
    Failed: 2,
    "2": "Failed",
    ReportsUnmeasurable: 8,
    "8": "ReportsUnmeasurable",
    ReportsUnreliable: 16,
    "16": "ReportsUnreliable",
    ReportsMask: 24,
    "24": "ReportsMask",
    ComplexityOverflow: 32,
    "32": "ComplexityOverflow",
    StackDepthOverflow: 64,
    "64": "StackDepthOverflow",
    Overflow: 96,
    "96": "Overflow"
};
/** @internal */
export type PredicateSemantics = number;
/** @internal */
export const PredicateSemantics: {
    readonly None: 0;
    readonly Always: 1;
    readonly Never: 2;
    readonly Sometimes: 3;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Always: 1,
    "1": "Always",
    Never: 2,
    "2": "Never",
    Sometimes: 3,
    "3": "Sometimes"
};
/** @internal */
export type NodeId = number;
export interface Node extends ReadonlyTextRange {
    /** Original tracing instrumentation field. */
    tracingPath?: string;
    /** Identifier metadata is absent on the other node kinds accepted by keyword lookup. */
    escapedText?: string;
    kind: SyntaxKind;
    flags: NodeFlags;
    /** @internal */ modifierFlagsCache?: ModifierFlags;
    /** @internal */ transformFlags: TransformFlags; // Flags for transforms
    /** @internal */ id?: NodeId; // Unique id (used to look up NodeLinks)
    parent: (Node) | undefined; // Parent node (initialized by binding)
    /** @internal */ original?: (Node) | undefined; // The original node if this is an updated node.
    /** @internal */ emitNode?: (EmitNode) | undefined; // Associated EmitNode (initialized by transforms)
}
export interface JSDocContainer extends Node {
    /** @internal */ jsDoc?: (JSDocArray) | undefined; // JSDoc that directly precedes this node
}
/** @internal */
export interface JSDocArray extends Array<JSDoc> {
    jsDocCache?: (readonly JSDocTag[]) | undefined; // Cache for getJSDocTags
}
export interface LocalsContainer extends Node {
    /** @internal */ locals?: (SymbolTable) | undefined; // Locals associated with node (initialized by binding)
    /** @internal */ nextContainer?: (HasLocals) | undefined; // Next container in declaration order (initialized by binding)
}
export interface FlowContainer extends Node {
    /** @internal */ flowNode?: (FlowNode) | undefined; // Associated FlowNode (initialized by binding)
}
/** @internal */
export type HasFlowNode = Identifier | ThisExpression | SuperExpression | QualifiedName | MetaProperty | ElementAccessExpression | PropertyAccessExpression | BindingElement | FunctionExpression | ArrowFunction | MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | VariableStatement | ExpressionStatement | IfStatement | DoStatement | WhileStatement | ForStatement | ForInStatement | ForOfStatement | ContinueStatement | BreakStatement | ReturnStatement | WithStatement | SwitchStatement | LabeledStatement | ThrowStatement | TryStatement | DebuggerStatement;
// Ideally, `ForEachChildNodes` and `VisitEachChildNodes` would not differ.
// However, `forEachChild` currently processes JSDoc comment syntax and missing declarations more thoroughly.
// On the other hand, `visitEachChild` actually processes `Identifier`s (which really *shouldn't* have children,
// but are constructed as if they could for faked-up `QualifiedName`s in the language service.)
/** @internal */
export type ForEachChildNodes = HasChildren | MissingDeclaration | JSDocTypeExpression | JSDocNonNullableType | JSDocNullableType | JSDocOptionalType | JSDocVariadicType | JSDocFunctionType | JSDoc | JSDocSeeTag | JSDocNameReference | JSDocMemberName | JSDocParameterTag | JSDocPropertyTag | JSDocAuthorTag | JSDocImplementsTag | JSDocAugmentsTag | JSDocTemplateTag | JSDocTypedefTag | JSDocCallbackTag | JSDocReturnTag | JSDocTypeTag | JSDocThisTag | JSDocEnumTag | JSDocSignature | JSDocLink | JSDocLinkCode | JSDocLinkPlain | JSDocTypeLiteral | JSDocUnknownTag | JSDocClassTag | JSDocPublicTag | JSDocPrivateTag | JSDocProtectedTag | JSDocReadonlyTag | JSDocDeprecatedTag | JSDocThrowsTag | JSDocOverrideTag | JSDocSatisfiesTag | JSDocOverloadTag | JSDocImportTag;
/** @internal */
export type HasChildren = QualifiedName | ComputedPropertyName | TypeParameterDeclaration | ParameterDeclaration | Decorator | PropertySignature | PropertyDeclaration | MethodSignature | MethodDeclaration | ConstructorDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | ClassStaticBlockDeclaration | CallSignatureDeclaration | ConstructSignatureDeclaration | IndexSignatureDeclaration | TypePredicateNode | TypeReferenceNode | FunctionTypeNode | ConstructorTypeNode | TypeQueryNode | TypeLiteralNode | ArrayTypeNode | TupleTypeNode | OptionalTypeNode | RestTypeNode | UnionTypeNode | IntersectionTypeNode | ConditionalTypeNode | InferTypeNode | ImportTypeNode | ImportTypeAssertionContainer | NamedTupleMember | ParenthesizedTypeNode | TypeOperatorNode | IndexedAccessTypeNode | MappedTypeNode | LiteralTypeNode | TemplateLiteralTypeNode | TemplateLiteralTypeSpan | ObjectBindingPattern | ArrayBindingPattern | BindingElement | ArrayLiteralExpression | ObjectLiteralExpression | PropertyAccessExpression | ElementAccessExpression | CallExpression | NewExpression | TaggedTemplateExpression | TypeAssertion | ParenthesizedExpression | FunctionExpression | ArrowFunction | DeleteExpression | TypeOfExpression | VoidExpression | AwaitExpression | PrefixUnaryExpression | PostfixUnaryExpression | BinaryExpression | ConditionalExpression | TemplateExpression | YieldExpression | SpreadElement | ClassExpression | ExpressionWithTypeArguments | AsExpression | NonNullExpression | SatisfiesExpression | MetaProperty | TemplateSpan | Block | VariableStatement | ExpressionStatement | IfStatement | DoStatement | WhileStatement | ForStatement | ForInStatement | ForOfStatement | ContinueStatement | BreakStatement | ReturnStatement | WithStatement | SwitchStatement | LabeledStatement | ThrowStatement | TryStatement | VariableDeclaration | VariableDeclarationList | FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration | ModuleDeclaration | ModuleBlock | CaseBlock | NamespaceExportDeclaration | ImportEqualsDeclaration | ImportDeclaration | AssertClause | AssertEntry | ImportAttributes | ImportAttribute | ImportClause | NamespaceImport | NamespaceExport | NamedImports | ImportSpecifier | ExportAssignment | ExportDeclaration | NamedExports | ExportSpecifier | ExternalModuleReference | JsxElement | JsxSelfClosingElement | JsxOpeningElement | JsxClosingElement | JsxFragment | JsxAttribute | JsxAttributes | JsxSpreadAttribute | JsxExpression | JsxNamespacedName | CaseClause | DefaultClause | HeritageClause | CatchClause | PropertyAssignment | ShorthandPropertyAssignment | SpreadAssignment | EnumMember | SourceFile | PartiallyEmittedExpression | CommaListExpression;
export type HasJSDoc = AccessorDeclaration | ArrowFunction | BinaryExpression | Block | BreakStatement | CallSignatureDeclaration | CaseClause | ClassLikeDeclaration | ClassStaticBlockDeclaration | ConstructorDeclaration | ConstructorTypeNode | ConstructSignatureDeclaration | ContinueStatement | DebuggerStatement | DoStatement | ElementAccessExpression | EmptyStatement | EndOfFileToken | EnumDeclaration | EnumMember | ExportAssignment | ExportDeclaration | ExportSpecifier | ExpressionStatement | ForInStatement | ForOfStatement | ForStatement | FunctionDeclaration | FunctionExpression | FunctionTypeNode | Identifier | IfStatement | ImportDeclaration | ImportEqualsDeclaration | IndexSignatureDeclaration | InterfaceDeclaration | JSDocFunctionType | JSDocSignature | LabeledStatement | MethodDeclaration | MethodSignature | ModuleDeclaration | NamedTupleMember | NamespaceExportDeclaration | ObjectLiteralExpression | ParameterDeclaration | ParenthesizedExpression | PropertyAccessExpression | PropertyAssignment | PropertyDeclaration | PropertySignature | ReturnStatement | SemicolonClassElement | ShorthandPropertyAssignment | SpreadAssignment | SwitchStatement | ThrowStatement | TryStatement | TypeAliasDeclaration | TypeParameterDeclaration | VariableDeclaration | VariableStatement | WhileStatement | WithStatement;
export type HasType = SignatureDeclaration | VariableDeclaration | ParameterDeclaration | PropertySignature | PropertyDeclaration | TypePredicateNode | ParenthesizedTypeNode | TypeOperatorNode | MappedTypeNode | AssertionExpression | TypeAliasDeclaration | JSDocTypeExpression | JSDocNonNullableType | JSDocNullableType | JSDocOptionalType | JSDocVariadicType;
// NOTE: Changing the following list requires changes to:
// - `canHaveIllegalType` in factory/utilities.ts
/** @internal */
export type HasIllegalType = ConstructorDeclaration | SetAccessorDeclaration;
// NOTE: Changing the following list requires changes to:
// - `canHaveIllegalTypeParameters` in factory/utilities.ts
/** @internal */
export type HasIllegalTypeParameters = ConstructorDeclaration | SetAccessorDeclaration | GetAccessorDeclaration;
export type HasTypeArguments = CallExpression | NewExpression | TaggedTemplateExpression | JsxOpeningElement | JsxSelfClosingElement;
export type HasInitializer = HasExpressionInitializer | ForStatement | ForInStatement | ForOfStatement | JsxAttribute;
export type HasExpressionInitializer = VariableDeclaration | ParameterDeclaration | BindingElement | PropertyDeclaration | PropertyAssignment | EnumMember;
/** @internal @knipignore */
export type HasIllegalExpressionInitializer = PropertySignature;
// NOTE: Changing the following list requires changes to:
// - `canHaveDecorators` in factory/utilities.ts
// - `updateModifiers` in factory/nodeFactory.ts
export type HasDecorators = ParameterDeclaration | PropertyDeclaration | MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | ClassExpression | ClassDeclaration;
// NOTE: Changing the following list requires changes to:
// - `canHaveIllegalDecorators` in factory/utilities.ts
/** @internal */
export type HasIllegalDecorators = PropertyAssignment | ShorthandPropertyAssignment | FunctionDeclaration | ConstructorDeclaration | IndexSignatureDeclaration | ClassStaticBlockDeclaration | MissingDeclaration | VariableStatement | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration | ModuleDeclaration | ImportEqualsDeclaration | ImportDeclaration | NamespaceExportDeclaration | ExportDeclaration | ExportAssignment;
// NOTE: Changing the following list requires changes to:
// - `canHaveModifiers` in factory/utilitiesPublic.ts
// - `updateModifiers` in factory/nodeFactory.ts
export type HasModifiers = TypeParameterDeclaration | ParameterDeclaration | ConstructorTypeNode | PropertySignature | PropertyDeclaration | MethodSignature | MethodDeclaration | ConstructorDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | IndexSignatureDeclaration | FunctionExpression | ArrowFunction | ClassExpression | VariableStatement | FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration | ModuleDeclaration | ImportEqualsDeclaration | ImportDeclaration | ExportAssignment | ExportDeclaration;
// NOTE: Changing the following list requires changes to:
// - `canHaveIllegalModifiers` in factory/utilities.ts
/** @internal */
export type HasIllegalModifiers = ClassStaticBlockDeclaration | PropertyAssignment | ShorthandPropertyAssignment | MissingDeclaration | NamespaceExportDeclaration;
/** @internal */
export type PrimitiveLiteral = BooleanLiteral | NumericLiteral | StringLiteral | NoSubstitutionTemplateLiteral | BigIntLiteral | (PrefixUnaryExpression & {
    operator: typeof SyntaxKind.PlusToken;
    operand: NumericLiteral;
}) | (PrefixUnaryExpression & {
    operator: typeof SyntaxKind.MinusToken;
    operand: NumericLiteral | BigIntLiteral;
});
/**
 * Declarations that can contain other declarations. Corresponds with `ContainerFlags.IsContainer` in binder.ts.
 *
 * @internal
 */
export type IsContainer = ClassExpression | ClassDeclaration | EnumDeclaration | ObjectLiteralExpression | TypeLiteralNode | JSDocTypeLiteral | JsxAttributes | InterfaceDeclaration | ModuleDeclaration | TypeAliasDeclaration | MappedTypeNode | IndexSignatureDeclaration | SourceFile | GetAccessorDeclaration | SetAccessorDeclaration | MethodDeclaration | ConstructorDeclaration | FunctionDeclaration | MethodSignature | CallSignatureDeclaration | JSDocSignature | JSDocFunctionType | FunctionTypeNode | ConstructSignatureDeclaration | ConstructorTypeNode | ClassStaticBlockDeclaration | FunctionExpression | ArrowFunction;
/**
 * Nodes that introduce a new block scope. Corresponds with `ContainerFlags.IsBlockScopedContainer` in binder.ts.
 *
 * @internal
 */
export type IsBlockScopedContainer = IsContainer | CatchClause | ForStatement | ForInStatement | ForOfStatement | CaseBlock | Block;
/**
 * Corresponds with `ContainerFlags.IsControlFlowContainer` in binder.ts.
 *
 * @internal
 */
export type IsControlFlowContainer = SourceFile | GetAccessorDeclaration | SetAccessorDeclaration | MethodDeclaration | ConstructorDeclaration | FunctionDeclaration | MethodSignature | CallSignatureDeclaration | JSDocSignature | JSDocFunctionType | FunctionTypeNode | ConstructSignatureDeclaration | ConstructorTypeNode | ClassStaticBlockDeclaration | FunctionExpression | ArrowFunction | ModuleBlock | PropertyDeclaration;
/**
 * Corresponds with `ContainerFlags.IsFunctionLike` in binder.ts.
 *
 * @internal
 */
export type IsFunctionLike = GetAccessorDeclaration | SetAccessorDeclaration | MethodDeclaration | ConstructorDeclaration | FunctionDeclaration | MethodSignature | CallSignatureDeclaration | JSDocSignature | JSDocFunctionType | FunctionTypeNode | ConstructSignatureDeclaration | ConstructorTypeNode | ClassStaticBlockDeclaration | FunctionExpression | ArrowFunction;
/**
 * Corresponds with `ContainerFlags.IsFunctionExpression` in binder.ts.
 *
 * @internal
 */
export type IsFunctionExpression = FunctionExpression | ArrowFunction;
/**
 * Nodes that can have local symbols. Corresponds with `ContainerFlags.HasLocals`. Constituents should extend
 * {@link LocalsContainer}.
 *
 * @internal
 */
export type HasLocals = ArrowFunction | Block | CallSignatureDeclaration | CaseBlock | CatchClause | ClassStaticBlockDeclaration | ConditionalTypeNode | ConstructorDeclaration | ConstructorTypeNode | ConstructSignatureDeclaration | ForStatement | ForInStatement | ForOfStatement | FunctionDeclaration | FunctionExpression | FunctionTypeNode | GetAccessorDeclaration | IndexSignatureDeclaration | JSDocCallbackTag | JSDocEnumTag | JSDocFunctionType | JSDocSignature | JSDocTypedefTag | MappedTypeNode | MethodDeclaration | MethodSignature | ModuleDeclaration | SetAccessorDeclaration | SourceFile | TypeAliasDeclaration;
/**
 * Corresponds with `ContainerFlags.IsInterface` in binder.ts.
 *
 * @internal
 */
export type IsInterface = InterfaceDeclaration;
/**
 * Corresponds with `ContainerFlags.IsObjectLiteralOrClassExpressionMethodOrAccessor` in binder.ts.
 *
 * @internal
 */
export type IsObjectLiteralOrClassExpressionMethodOrAccessor = GetAccessorDeclaration | SetAccessorDeclaration | MethodDeclaration;
/**
 * Corresponds with `ContainerFlags` in binder.ts.
 *
 * @internal
 */
export type HasContainerFlags = IsContainer | IsBlockScopedContainer | IsControlFlowContainer | IsFunctionLike | IsFunctionExpression | HasLocals | IsInterface | IsObjectLiteralOrClassExpressionMethodOrAccessor;
/** @internal */
export interface MutableNodeArray<T extends Node> extends Array<T>, TextRange {
    hasTrailingComma: boolean;
    /** @internal */ transformFlags: TransformFlags; // Flags for transforms, possibly undefined
}
export interface NodeArray<T extends Node> extends ReadonlyArray<T>, ReadonlyTextRange {
    hasTrailingComma: boolean;
    /** @internal */ transformFlags: TransformFlags; // Flags for transforms, possibly undefined
}
// TODO(rbuckton): Constraint 'TKind' to 'TokenSyntaxKind'
export interface Token<TKind extends SyntaxKind> extends Node {
    kind: TKind;
}
export type EndOfFileToken = Token<typeof SyntaxKind.EndOfFileToken> & JSDocContainer;
// Punctuation
export interface PunctuationToken<TKind extends PunctuationSyntaxKind> extends Token<TKind> {
}
export type DotToken = PunctuationToken<typeof SyntaxKind.DotToken>;
export type DotDotDotToken = PunctuationToken<typeof SyntaxKind.DotDotDotToken>;
export type QuestionToken = PunctuationToken<typeof SyntaxKind.QuestionToken>;
export type ExclamationToken = PunctuationToken<typeof SyntaxKind.ExclamationToken>;
export type ColonToken = PunctuationToken<typeof SyntaxKind.ColonToken>;
export type EqualsToken = PunctuationToken<typeof SyntaxKind.EqualsToken>;
export type AmpersandAmpersandEqualsToken = PunctuationToken<typeof SyntaxKind.AmpersandAmpersandEqualsToken>;
export type BarBarEqualsToken = PunctuationToken<typeof SyntaxKind.BarBarEqualsToken>;
export type QuestionQuestionEqualsToken = PunctuationToken<typeof SyntaxKind.QuestionQuestionEqualsToken>;
export type AsteriskToken = PunctuationToken<typeof SyntaxKind.AsteriskToken>;
export type EqualsGreaterThanToken = PunctuationToken<typeof SyntaxKind.EqualsGreaterThanToken>;
export type PlusToken = PunctuationToken<typeof SyntaxKind.PlusToken>;
export type MinusToken = PunctuationToken<typeof SyntaxKind.MinusToken>;
export type QuestionDotToken = PunctuationToken<typeof SyntaxKind.QuestionDotToken>;
// Keywords
export interface KeywordToken<TKind extends KeywordSyntaxKind> extends Token<TKind> {
}
export type AssertsKeyword = KeywordToken<typeof SyntaxKind.AssertsKeyword>;
export type AssertKeyword = KeywordToken<typeof SyntaxKind.AssertKeyword>;
export type AwaitKeyword = KeywordToken<typeof SyntaxKind.AwaitKeyword>;
export type CaseKeyword = KeywordToken<typeof SyntaxKind.CaseKeyword>;
export interface ModifierToken<TKind extends ModifierSyntaxKind> extends KeywordToken<TKind> {
}
export type AbstractKeyword = ModifierToken<typeof SyntaxKind.AbstractKeyword>;
export type AccessorKeyword = ModifierToken<typeof SyntaxKind.AccessorKeyword>;
export type AsyncKeyword = ModifierToken<typeof SyntaxKind.AsyncKeyword>;
export type ConstKeyword = ModifierToken<typeof SyntaxKind.ConstKeyword>;
export type DeclareKeyword = ModifierToken<typeof SyntaxKind.DeclareKeyword>;
export type DefaultKeyword = ModifierToken<typeof SyntaxKind.DefaultKeyword>;
export type ExportKeyword = ModifierToken<typeof SyntaxKind.ExportKeyword>;
export type InKeyword = ModifierToken<typeof SyntaxKind.InKeyword>;
export type PrivateKeyword = ModifierToken<typeof SyntaxKind.PrivateKeyword>;
export type ProtectedKeyword = ModifierToken<typeof SyntaxKind.ProtectedKeyword>;
export type PublicKeyword = ModifierToken<typeof SyntaxKind.PublicKeyword>;
export type ReadonlyKeyword = ModifierToken<typeof SyntaxKind.ReadonlyKeyword>;
export type OutKeyword = ModifierToken<typeof SyntaxKind.OutKeyword>;
export type OverrideKeyword = ModifierToken<typeof SyntaxKind.OverrideKeyword>;
export type StaticKeyword = ModifierToken<typeof SyntaxKind.StaticKeyword>;
export type Modifier = AbstractKeyword | AccessorKeyword | AsyncKeyword | ConstKeyword | DeclareKeyword | DefaultKeyword | ExportKeyword | InKeyword | PrivateKeyword | ProtectedKeyword | PublicKeyword | OutKeyword | OverrideKeyword | ReadonlyKeyword | StaticKeyword;
export type ModifierLike = Modifier | Decorator;
export type AccessibilityModifier = PublicKeyword | PrivateKeyword | ProtectedKeyword;
export type ParameterPropertyModifier = AccessibilityModifier | ReadonlyKeyword;
export type ClassMemberModifier = AccessibilityModifier | ReadonlyKeyword | StaticKeyword | AccessorKeyword;
export type ModifiersArray = NodeArray<Modifier>;
// dprint-ignore
export type GeneratedIdentifierFlags = number;
// dprint-ignore
export const GeneratedIdentifierFlags: {
    readonly None: 0;
    readonly Auto: 1;
    readonly Loop: 2;
    readonly Unique: 3;
    readonly Node: 4;
    readonly KindMask: 7;
    readonly ReservedInNestedScopes: 8;
    readonly Optimistic: 16;
    readonly FileLevel: 32;
    readonly AllowNameSubstitution: 64;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Auto: 1,
    "1": "Auto",
    Loop: 2,
    "2": "Loop",
    Unique: 3,
    "3": "Unique",
    Node: 4,
    "4": "Node",
    KindMask: 7,
    "7": "KindMask",
    ReservedInNestedScopes: 8,
    "8": "ReservedInNestedScopes",
    Optimistic: 16,
    "16": "Optimistic",
    FileLevel: 32,
    "32": "FileLevel",
    AllowNameSubstitution: 64,
    "64": "AllowNameSubstitution"
};
export interface Identifier extends PrimaryExpression, Declaration, JSDocContainer, FlowContainer {
    kind: typeof SyntaxKind.Identifier;
    /**
     * Prefer to use `id.unescapedText`. (Note: This is available only in services, not internally to the TypeScript compiler.)
     * Text of identifier, but if the identifier begins with two underscores, this will begin with three.
     */
    escapedText: __String;
}
// Transient identifier node (marked by id === -1)
export interface TransientIdentifier extends Identifier {
    resolvedSymbol: Symbol;
}
// dprint-ignore
/** @internal */
export interface AutoGenerateInfo {
    flags: GeneratedIdentifierFlags; // Specifies whether to auto-generate the text for an identifier.
    id: number; // Ensures unique generated identifiers get unique names, but clones get the same name.
    prefix?: string | GeneratedNamePart;
    suffix?: string;
}
/** @internal */
export interface GeneratedIdentifier extends Identifier {
    emitNode: EmitNode & {
        autoGenerate: AutoGenerateInfo;
    };
}
export interface QualifiedName extends Node, FlowContainer {
    kind: typeof SyntaxKind.QualifiedName;
    left: EntityName;
    right: Identifier;
}
export type EntityName = Identifier | QualifiedName;
export type PropertyName = Identifier | StringLiteral | NoSubstitutionTemplateLiteral | NumericLiteral | ComputedPropertyName | PrivateIdentifier | BigIntLiteral;
export type MemberName = Identifier | PrivateIdentifier;
export type DeclarationName = PropertyName | JsxAttributeName | StringLiteralLike | ElementAccessExpression | BindingPattern | EntityNameExpression;
export interface Declaration extends Node {
    /** @internal */ symbol: (Symbol) | undefined; // Symbol declared by node (initialized by binding)
    /** @internal */ localSymbol?: Symbol; // Local symbol declared by node (initialized by binding only for exported nodes)
}
export interface NamedDeclaration extends Declaration {
    name?: DeclarationName;
}
/** @internal */
export interface DynamicNamedDeclaration extends NamedDeclaration {
    name: ComputedPropertyName;
}
/** @internal */
export interface DynamicNamedBinaryExpression extends BinaryExpression {
    left: ElementAccessExpression;
}
/** @internal */
// A declaration that supports late-binding (used in checker)
export interface LateBoundDeclaration extends DynamicNamedDeclaration {
    name: LateBoundName;
}
/** @internal */
export interface LateBoundBinaryExpressionDeclaration extends DynamicNamedBinaryExpression {
    left: LateBoundElementAccessExpression;
}
/** @internal */
export interface LateBoundElementAccessExpression extends ElementAccessExpression {
    argumentExpression: EntityNameExpression;
}
export interface DeclarationStatement extends NamedDeclaration, Statement {
    name?: Identifier | StringLiteral | NumericLiteral;
}
export interface ComputedPropertyName extends Node {
    kind: typeof SyntaxKind.ComputedPropertyName;
    parent: Declaration;
    expression: Expression;
}
// Typed as a PrimaryExpression due to its presence in BinaryExpressions (#field in expr)
export interface PrivateIdentifier extends PrimaryExpression {
    kind: typeof SyntaxKind.PrivateIdentifier;
    // escaping not strictly necessary
    // avoids gotchas in transforms and utils
    escapedText: __String;
}
/** @internal */
export interface GeneratedPrivateIdentifier extends PrivateIdentifier {
    emitNode: EmitNode & {
        autoGenerate: AutoGenerateInfo;
    };
}
/** @internal */
// A name that supports late-binding (used in checker)
export interface LateBoundName extends ComputedPropertyName {
    expression: EntityNameExpression;
}
export interface Decorator extends Node {
    kind: typeof SyntaxKind.Decorator;
    parent: NamedDeclaration;
    expression: LeftHandSideExpression;
}
export interface TypeParameterDeclaration extends NamedDeclaration, JSDocContainer {
    kind: typeof SyntaxKind.TypeParameter;
    parent: DeclarationWithTypeParameterChildren | InferTypeNode;
    modifiers?: NodeArray<Modifier>;
    name: Identifier;
    /** Note: Consider calling `getEffectiveConstraintOfTypeParameter` */
    constraint?: TypeNode;
    default?: TypeNode;
    // For error recovery purposes (see `isGrammarError` in utilities.ts).
    expression?: (Expression) | undefined;
}
export interface SignatureDeclarationBase extends NamedDeclaration, JSDocContainer {
    modifiers?: NodeArray<ModifierLike>;
    /** Shared signature metadata; declaration-only signatures have no body or generator token. */
    body?: Block | Expression;
    endFlowNode?: FlowNode;
    asteriskToken?: AsteriskToken;
    questionToken?: QuestionToken;
    exclamationToken?: ExclamationToken;
    kind: SignatureDeclaration["kind"];
    name?: PropertyName;
    typeParameters?: NodeArray<TypeParameterDeclaration> | undefined;
    parameters: NodeArray<ParameterDeclaration>;
    type?: TypeNode | undefined;
    /** @internal */ typeArguments?: (NodeArray<TypeNode>) | undefined; // Used for quick info, replaces typeParameters for instantiated signatures
}
export type SignatureDeclaration = CallSignatureDeclaration | ConstructSignatureDeclaration | MethodSignature | IndexSignatureDeclaration | FunctionTypeNode | ConstructorTypeNode | JSDocFunctionType | FunctionDeclaration | MethodDeclaration | ConstructorDeclaration | AccessorDeclaration | FunctionExpression | ArrowFunction;
export interface CallSignatureDeclaration extends SignatureDeclarationBase, TypeElement, LocalsContainer {
    kind: typeof SyntaxKind.CallSignature;
}
export interface ConstructSignatureDeclaration extends SignatureDeclarationBase, TypeElement, LocalsContainer {
    kind: typeof SyntaxKind.ConstructSignature;
}
export type BindingName = Identifier | BindingPattern;
// dprint-ignore
export interface VariableDeclaration extends NamedDeclaration, JSDocContainer {
    kind: typeof SyntaxKind.VariableDeclaration;
    parent: VariableDeclarationList | CatchClause;
    name: BindingName; // Declared variable name
    exclamationToken?: ExclamationToken; // Optional definite assignment assertion
    type?: TypeNode; // Optional type annotation
    initializer?: Expression; // Optional initializer
}
/** @internal */
export type InitializedVariableDeclaration = VariableDeclaration & {
    initializer: Expression;
};
export interface VariableDeclarationList extends Node {
    kind: typeof SyntaxKind.VariableDeclarationList;
    parent: VariableStatement | ForStatement | ForOfStatement | ForInStatement;
    declarations: NodeArray<VariableDeclaration>;
}
// dprint-ignore
export interface ParameterDeclaration extends NamedDeclaration, JSDocContainer {
    kind: typeof SyntaxKind.Parameter;
    parent: SignatureDeclaration;
    modifiers?: (NodeArray<ModifierLike>) | undefined;
    dotDotDotToken?: DotDotDotToken; // Present on rest parameter
    name: BindingName; // Declared parameter name.
    questionToken?: QuestionToken; // Present on optional parameter
    type?: TypeNode; // Optional type annotation
    initializer?: Expression; // Optional initializer
}
// dprint-ignore
export interface BindingElement extends NamedDeclaration, FlowContainer {
    kind: typeof SyntaxKind.BindingElement;
    parent: BindingPattern;
    propertyName?: PropertyName; // Binding property name (in object binding pattern)
    dotDotDotToken?: DotDotDotToken; // Present on rest element (in object binding pattern)
    name: BindingName; // Declared binding element name
    initializer?: Expression; // Optional initializer
}
/** @internal */
export type BindingElementGrandparent = BindingElement["parent"]["parent"];
// dprint-ignore
export interface PropertySignature extends TypeElement, JSDocContainer {
    kind: typeof SyntaxKind.PropertySignature;
    parent: TypeLiteralNode | InterfaceDeclaration;
    modifiers?: NodeArray<Modifier>;
    name: PropertyName; // Declared property name
    questionToken?: QuestionToken; // Present on optional property
    type?: TypeNode; // Optional type annotation
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ initializer?: Expression | undefined; // A property signature cannot have an initializer
}
// dprint-ignore
export interface PropertyDeclaration extends ClassElement, JSDocContainer {
    kind: typeof SyntaxKind.PropertyDeclaration;
    parent: ClassLikeDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name: PropertyName;
    questionToken?: QuestionToken; // Present for use with reporting a grammar error for auto-accessors (see `isGrammarError` in utilities.ts)
    exclamationToken?: ExclamationToken;
    type?: TypeNode;
    initializer?: Expression; // Optional initializer
}
export interface AutoAccessorPropertyDeclaration extends PropertyDeclaration {
}
/** @internal */
export interface PrivateIdentifierPropertyDeclaration extends PropertyDeclaration {
    name: PrivateIdentifier;
}
/** @internal */
export interface PrivateIdentifierAutoAccessorPropertyDeclaration extends AutoAccessorPropertyDeclaration {
    name: PrivateIdentifier;
}
/** @internal */
export interface PrivateIdentifierMethodDeclaration extends MethodDeclaration {
    name: PrivateIdentifier;
}
/** @internal */
export interface PrivateIdentifierGetAccessorDeclaration extends GetAccessorDeclaration {
    name: PrivateIdentifier;
}
/** @internal */
export interface PrivateIdentifierSetAccessorDeclaration extends SetAccessorDeclaration {
    name: PrivateIdentifier;
}
/** @internal */
export type PrivateIdentifierAccessorDeclaration = PrivateIdentifierGetAccessorDeclaration | PrivateIdentifierSetAccessorDeclaration;
/** @internal */
export type PrivateClassElementDeclaration = PrivateIdentifierPropertyDeclaration | PrivateIdentifierAutoAccessorPropertyDeclaration | PrivateIdentifierMethodDeclaration | PrivateIdentifierGetAccessorDeclaration | PrivateIdentifierSetAccessorDeclaration;
/** @internal */
export type InitializedPropertyDeclaration = PropertyDeclaration & {
    initializer: Expression;
};
export interface ObjectLiteralElement extends NamedDeclaration {
    name?: PropertyName;
}
/** Unlike ObjectLiteralElement, excludes JSXAttribute and JSXSpreadAttribute. */
export type ObjectLiteralElementLike = PropertyAssignment | ShorthandPropertyAssignment | SpreadAssignment | MethodDeclaration | AccessorDeclaration;
export interface PropertyAssignment extends ObjectLiteralElement, JSDocContainer {
    kind: typeof SyntaxKind.PropertyAssignment;
    parent: ObjectLiteralExpression;
    name: PropertyName;
    initializer: Expression;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ modifiers?: NodeArray<ModifierLike> | undefined; // property assignment cannot have decorators or modifiers
    /** @internal */ questionToken?: QuestionToken | undefined; // property assignment cannot have a question token
    /** @internal */ exclamationToken?: ExclamationToken | undefined; // property assignment cannot have an exclamation token
}
export interface ShorthandPropertyAssignment extends ObjectLiteralElement, JSDocContainer {
    kind: typeof SyntaxKind.ShorthandPropertyAssignment;
    parent: ObjectLiteralExpression;
    name: Identifier;
    // used when ObjectLiteralExpression is used in ObjectAssignmentPattern
    // it is a grammar error to appear in actual object initializer (see `isGrammarError` in utilities.ts):
    equalsToken?: (EqualsToken) | undefined;
    objectAssignmentInitializer?: Expression;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ modifiers?: NodeArray<ModifierLike> | undefined; // shorthand property assignment cannot have decorators or modifiers
    /** @internal */ questionToken?: QuestionToken | undefined; // shorthand property assignment cannot have a question token
    /** @internal */ exclamationToken?: ExclamationToken | undefined; // shorthand property assignment cannot have an exclamation token
}
export interface SpreadAssignment extends ObjectLiteralElement, JSDocContainer {
    kind: typeof SyntaxKind.SpreadAssignment;
    parent: ObjectLiteralExpression;
    expression: Expression;
}
export type VariableLikeDeclaration = VariableDeclaration | ParameterDeclaration | BindingElement | PropertyDeclaration | PropertyAssignment | PropertySignature | JsxAttribute | ShorthandPropertyAssignment | EnumMember | JSDocPropertyTag | JSDocParameterTag;
export interface ObjectBindingPattern extends Node {
    kind: typeof SyntaxKind.ObjectBindingPattern;
    parent: VariableDeclaration | ParameterDeclaration | BindingElement;
    elements: NodeArray<BindingElement>;
}
export interface ArrayBindingPattern extends Node {
    kind: typeof SyntaxKind.ArrayBindingPattern;
    parent: VariableDeclaration | ParameterDeclaration | BindingElement;
    elements: NodeArray<ArrayBindingElement>;
}
export type BindingPattern = ObjectBindingPattern | ArrayBindingPattern;
export type ArrayBindingElement = BindingElement | OmittedExpression;
/**
 * Several node kinds share function-like features such as a signature,
 * a name, and a body. These nodes should extend FunctionLikeDeclarationBase.
 * Examples:
 * - FunctionDeclaration
 * - MethodDeclaration
 * - AccessorDeclaration
 */
export interface FunctionLikeDeclarationBase extends SignatureDeclarationBase {
    asteriskToken?: AsteriskToken | undefined;
    questionToken?: QuestionToken | undefined;
    exclamationToken?: ExclamationToken | undefined;
    body?: Block | Expression | undefined;
    /** @internal */ endFlowNode?: (FlowNode) | undefined;
    /** @internal */ returnFlowNode?: (FlowNode) | undefined;
}
export type FunctionLikeDeclaration = FunctionDeclaration | MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | ConstructorDeclaration | FunctionExpression | ArrowFunction;
/** @deprecated Use SignatureDeclaration */
export type FunctionLike = SignatureDeclaration;
export interface FunctionDeclaration extends FunctionLikeDeclarationBase, DeclarationStatement, LocalsContainer {
    kind: typeof SyntaxKind.FunctionDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name?: Identifier;
    body?: FunctionBody;
}
export interface MethodSignature extends SignatureDeclarationBase, TypeElement, LocalsContainer {
    kind: typeof SyntaxKind.MethodSignature;
    parent: TypeLiteralNode | InterfaceDeclaration;
    modifiers?: NodeArray<Modifier>;
    name: PropertyName;
}
// Note that a MethodDeclaration is considered both a ClassElement and an ObjectLiteralElement.
// Both the grammars for ClassDeclaration and ObjectLiteralExpression allow for MethodDeclarations
// as child elements, and so a MethodDeclaration satisfies both interfaces.  This avoids the
// alternative where we would need separate kinds/types for ClassMethodDeclaration and
// ObjectLiteralMethodDeclaration, which would look identical.
//
// Because of this, it may be necessary to determine what sort of MethodDeclaration you have
// at later stages of the compiler pipeline.  In that case, you can either check the parent kind
// of the method, or use helpers like isObjectLiteralMethodDeclaration
export interface MethodDeclaration extends FunctionLikeDeclarationBase, ClassElement, ObjectLiteralElement, JSDocContainer, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.MethodDeclaration;
    parent: ClassLikeDeclaration | ObjectLiteralExpression;
    modifiers?: NodeArray<ModifierLike> | undefined;
    name: PropertyName;
    body?: FunctionBody | undefined;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ exclamationToken?: ExclamationToken | undefined; // A method cannot have an exclamation token
}
export interface ConstructorDeclaration extends FunctionLikeDeclarationBase, ClassElement, JSDocContainer, LocalsContainer {
    kind: typeof SyntaxKind.Constructor;
    parent: ClassLikeDeclaration;
    modifiers?: NodeArray<ModifierLike> | undefined;
    body?: FunctionBody | undefined;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ typeParameters?: (NodeArray<TypeParameterDeclaration>) | undefined; // A constructor cannot have type parameters
    /** @internal */ type?: (TypeNode) | undefined; // A constructor cannot have a return type annotation
}
/** For when we encounter a semicolon in a class declaration. ES6 allows these as class elements. */
export interface SemicolonClassElement extends ClassElement, JSDocContainer {
    kind: typeof SyntaxKind.SemicolonClassElement;
    parent: ClassLikeDeclaration;
}
// See the comment on MethodDeclaration for the intuition behind GetAccessorDeclaration being a
// ClassElement and an ObjectLiteralElement.
export interface GetAccessorDeclaration extends FunctionLikeDeclarationBase, ClassElement, TypeElement, ObjectLiteralElement, JSDocContainer, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.GetAccessor;
    parent: ClassLikeDeclaration | ObjectLiteralExpression | TypeLiteralNode | InterfaceDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name: PropertyName;
    body?: FunctionBody;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ typeParameters?: NodeArray<TypeParameterDeclaration> | undefined; // A get accessor cannot have type parameters
}
// See the comment on MethodDeclaration for the intuition behind SetAccessorDeclaration being a
// ClassElement and an ObjectLiteralElement.
export interface SetAccessorDeclaration extends FunctionLikeDeclarationBase, ClassElement, TypeElement, ObjectLiteralElement, JSDocContainer, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.SetAccessor;
    parent: ClassLikeDeclaration | ObjectLiteralExpression | TypeLiteralNode | InterfaceDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name: PropertyName;
    body?: FunctionBody;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ typeParameters?: NodeArray<TypeParameterDeclaration> | undefined; // A set accessor cannot have type parameters
    /** @internal */ type?: TypeNode | undefined; // A set accessor cannot have a return type
}
export type AccessorDeclaration = GetAccessorDeclaration | SetAccessorDeclaration;
export interface IndexSignatureDeclaration extends SignatureDeclarationBase, ClassElement, TypeElement, LocalsContainer {
    kind: typeof SyntaxKind.IndexSignature;
    parent: ObjectTypeDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    type?: TypeNode;
}
export interface ClassStaticBlockDeclaration extends ClassElement, JSDocContainer, LocalsContainer {
    kind: typeof SyntaxKind.ClassStaticBlockDeclaration;
    parent: ClassDeclaration | ClassExpression;
    body: Block;
    /** @internal */ endFlowNode?: (FlowNode) | undefined;
    /** @internal */ returnFlowNode?: (FlowNode) | undefined;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ modifiers?: NodeArray<ModifierLike> | undefined;
}
export interface TypeNode extends Node {
}
/** @internal */
export interface TypeNode extends Node {
    kind: TypeNodeSyntaxKind;
}
export interface KeywordTypeNode<TKind extends KeywordTypeSyntaxKind = KeywordTypeSyntaxKind> extends KeywordToken<TKind>, TypeNode {
    kind: TKind;
}
/** @deprecated */
export interface ImportTypeAssertionContainer extends Node {
    kind: typeof SyntaxKind.ImportTypeAssertionContainer;
    parent: ImportTypeNode;
    /** @deprecated */ assertClause: AssertClause;
    multiLine?: boolean;
}
export interface ImportTypeNode extends NodeWithTypeArguments {
    kind: typeof SyntaxKind.ImportType;
    isTypeOf: boolean;
    argument: TypeNode;
    /** @deprecated */ assertions?: ImportTypeAssertionContainer;
    attributes?: ImportAttributes;
    qualifier?: EntityName;
}
/** @internal */
export type LiteralImportTypeNode = ImportTypeNode & {
    argument: LiteralTypeNode & {
        literal: StringLiteral;
    };
};
export interface ThisTypeNode extends TypeNode {
    kind: typeof SyntaxKind.ThisType;
}
export type FunctionOrConstructorTypeNode = FunctionTypeNode | ConstructorTypeNode;
export interface FunctionOrConstructorTypeNodeBase extends TypeNode, SignatureDeclarationBase {
    kind: typeof SyntaxKind.FunctionType | typeof SyntaxKind.ConstructorType;
    type: TypeNode;
}
export interface FunctionTypeNode extends FunctionOrConstructorTypeNodeBase, LocalsContainer {
    kind: typeof SyntaxKind.FunctionType;
    // A function type cannot have modifiers
    /** @internal */ modifiers?: undefined;
}
export interface ConstructorTypeNode extends FunctionOrConstructorTypeNodeBase, LocalsContainer {
    kind: typeof SyntaxKind.ConstructorType;
    modifiers?: NodeArray<Modifier>;
}
export interface NodeWithTypeArguments extends TypeNode {
    typeArguments?: NodeArray<TypeNode>;
}
export type TypeReferenceType = TypeReferenceNode | ExpressionWithTypeArguments;
export interface TypeReferenceNode extends NodeWithTypeArguments {
    kind: typeof SyntaxKind.TypeReference;
    typeName: EntityName;
}
export interface TypePredicateNode extends TypeNode {
    kind: typeof SyntaxKind.TypePredicate;
    parent: SignatureDeclaration | JSDocTypeExpression;
    assertsModifier?: AssertsKeyword;
    parameterName: Identifier | ThisTypeNode;
    type?: TypeNode;
}
export interface TypeQueryNode extends NodeWithTypeArguments {
    kind: typeof SyntaxKind.TypeQuery;
    exprName: EntityName;
}
// A TypeLiteral is the declaration node for an anonymous symbol.
export interface TypeLiteralNode extends TypeNode, Declaration {
    kind: typeof SyntaxKind.TypeLiteral;
    members: NodeArray<TypeElement>;
}
export interface ArrayTypeNode extends TypeNode {
    kind: typeof SyntaxKind.ArrayType;
    elementType: TypeNode;
}
export interface TupleTypeNode extends TypeNode {
    kind: typeof SyntaxKind.TupleType;
    elements: NodeArray<TypeNode | NamedTupleMember>;
}
export interface NamedTupleMember extends TypeNode, Declaration, JSDocContainer {
    kind: typeof SyntaxKind.NamedTupleMember;
    dotDotDotToken?: Token<typeof SyntaxKind.DotDotDotToken>;
    name: Identifier;
    questionToken?: Token<typeof SyntaxKind.QuestionToken>;
    type: TypeNode;
}
export interface OptionalTypeNode extends TypeNode {
    kind: typeof SyntaxKind.OptionalType;
    type: TypeNode;
}
export interface RestTypeNode extends TypeNode {
    kind: typeof SyntaxKind.RestType;
    type: TypeNode;
}
export type UnionOrIntersectionTypeNode = UnionTypeNode | IntersectionTypeNode;
export interface UnionTypeNode extends TypeNode {
    kind: typeof SyntaxKind.UnionType;
    types: NodeArray<TypeNode>;
}
export interface IntersectionTypeNode extends TypeNode {
    kind: typeof SyntaxKind.IntersectionType;
    types: NodeArray<TypeNode>;
}
export interface ConditionalTypeNode extends TypeNode, LocalsContainer {
    kind: typeof SyntaxKind.ConditionalType;
    checkType: TypeNode;
    extendsType: TypeNode;
    trueType: TypeNode;
    falseType: TypeNode;
}
export interface InferTypeNode extends TypeNode {
    kind: typeof SyntaxKind.InferType;
    typeParameter: TypeParameterDeclaration;
}
export interface ParenthesizedTypeNode extends TypeNode {
    kind: typeof SyntaxKind.ParenthesizedType;
    type: TypeNode;
}
export interface TypeOperatorNode extends TypeNode {
    kind: typeof SyntaxKind.TypeOperator;
    operator: typeof SyntaxKind.KeyOfKeyword | typeof SyntaxKind.UniqueKeyword | typeof SyntaxKind.ReadonlyKeyword;
    type: TypeNode;
}
/** @internal @knipignore */
export interface UniqueTypeOperatorNode extends TypeOperatorNode {
    operator: typeof SyntaxKind.UniqueKeyword;
}
export interface IndexedAccessTypeNode extends TypeNode {
    kind: typeof SyntaxKind.IndexedAccessType;
    objectType: TypeNode;
    indexType: TypeNode;
}
export interface MappedTypeNode extends TypeNode, Declaration, LocalsContainer {
    kind: typeof SyntaxKind.MappedType;
    readonlyToken?: ReadonlyKeyword | PlusToken | MinusToken;
    typeParameter: TypeParameterDeclaration;
    nameType?: TypeNode;
    questionToken?: QuestionToken | PlusToken | MinusToken;
    type?: TypeNode;
    /** Used only to produce grammar errors */
    members?: NodeArray<TypeElement>;
}
export interface LiteralTypeNode extends TypeNode {
    kind: typeof SyntaxKind.LiteralType;
    literal: NullLiteral | BooleanLiteral | LiteralExpression | PrefixUnaryExpression;
}
export interface StringLiteral extends LiteralExpression, Declaration {
    kind: typeof SyntaxKind.StringLiteral;
    /** @internal */
    textSourceNode?: Identifier | StringLiteralLike | NumericLiteral | PrivateIdentifier | JsxNamespacedName | BigIntLiteral; // Allows a StringLiteral to get its text from another node (used by transforms).
    /**
     * Note: this is only set when synthesizing a node, not during parsing.
     *
     * @internal
     */
    singleQuote?: boolean;
}
export type StringLiteralLike = StringLiteral | NoSubstitutionTemplateLiteral;
export type PropertyNameLiteral = Identifier | StringLiteralLike | NumericLiteral | JsxNamespacedName | BigIntLiteral;
export interface TemplateLiteralTypeNode extends TypeNode {
    kind: typeof SyntaxKind.TemplateLiteralType;
    head: TemplateHead;
    templateSpans: NodeArray<TemplateLiteralTypeSpan>;
}
export interface TemplateLiteralTypeSpan extends TypeNode {
    kind: typeof SyntaxKind.TemplateLiteralTypeSpan;
    parent: TemplateLiteralTypeNode;
    type: TypeNode;
    literal: TemplateMiddle | TemplateTail;
}
// Note: 'brands' in our syntax nodes serve to give us a small amount of nominal typing.
// Consider 'Expression'.  Without the brand, 'Expression' is actually no different
// (structurally) than 'Node'.  Because of this you can pass any Node to a function that
// takes an Expression without any error.  By using the 'brands' we ensure that the type
// checker actually thinks you have something of the right type.  Note: the brands are
// never actually given values.  At runtime they have zero cost.
export interface Expression extends Node {
}
export interface OmittedExpression extends Expression {
    kind: typeof SyntaxKind.OmittedExpression;
}
// Represents an expression that is elided as part of a transformation to emit comments on a
// not-emitted node. The 'expression' property of a PartiallyEmittedExpression should be emitted.
export interface PartiallyEmittedExpression extends LeftHandSideExpression {
    kind: typeof SyntaxKind.PartiallyEmittedExpression;
    expression: Expression;
}
export interface UnaryExpression extends Expression {
}
/** Deprecated, please use UpdateExpression */
export type IncrementExpression = UpdateExpression;
export interface UpdateExpression extends UnaryExpression {
}
// see: https://tc39.github.io/ecma262/#prod-UpdateExpression
// see: https://tc39.github.io/ecma262/#prod-UnaryExpression
export type PrefixUnaryOperator = typeof SyntaxKind.PlusPlusToken | typeof SyntaxKind.MinusMinusToken | typeof SyntaxKind.PlusToken | typeof SyntaxKind.MinusToken | typeof SyntaxKind.TildeToken | typeof SyntaxKind.ExclamationToken;
export interface PrefixUnaryExpression extends UpdateExpression {
    kind: typeof SyntaxKind.PrefixUnaryExpression;
    operator: PrefixUnaryOperator;
    operand: UnaryExpression;
}
// see: https://tc39.github.io/ecma262/#prod-UpdateExpression
export type PostfixUnaryOperator = typeof SyntaxKind.PlusPlusToken | typeof SyntaxKind.MinusMinusToken;
export interface PostfixUnaryExpression extends UpdateExpression {
    kind: typeof SyntaxKind.PostfixUnaryExpression;
    operand: LeftHandSideExpression;
    operator: PostfixUnaryOperator;
}
export interface LeftHandSideExpression extends UpdateExpression {
}
export interface MemberExpression extends LeftHandSideExpression {
}
export interface PrimaryExpression extends MemberExpression {
}
export interface NullLiteral extends PrimaryExpression {
    kind: typeof SyntaxKind.NullKeyword;
}
export interface TrueLiteral extends PrimaryExpression {
    kind: typeof SyntaxKind.TrueKeyword;
}
export interface FalseLiteral extends PrimaryExpression {
    kind: typeof SyntaxKind.FalseKeyword;
}
export type BooleanLiteral = TrueLiteral | FalseLiteral;
export interface ThisExpression extends PrimaryExpression, FlowContainer {
    kind: typeof SyntaxKind.ThisKeyword;
}
export interface SuperExpression extends PrimaryExpression, FlowContainer {
    kind: typeof SyntaxKind.SuperKeyword;
}
export interface ImportExpression extends PrimaryExpression {
    kind: typeof SyntaxKind.ImportKeyword;
}
export interface DeleteExpression extends UnaryExpression {
    kind: typeof SyntaxKind.DeleteExpression;
    expression: UnaryExpression;
}
export interface TypeOfExpression extends UnaryExpression {
    kind: typeof SyntaxKind.TypeOfExpression;
    expression: UnaryExpression;
}
export interface VoidExpression extends UnaryExpression {
    kind: typeof SyntaxKind.VoidExpression;
    expression: UnaryExpression;
}
export interface AwaitExpression extends UnaryExpression {
    kind: typeof SyntaxKind.AwaitExpression;
    expression: UnaryExpression;
}
export interface YieldExpression extends Expression {
    kind: typeof SyntaxKind.YieldExpression;
    asteriskToken?: AsteriskToken;
    expression?: Expression;
}
export interface SyntheticExpression extends Expression {
    kind: typeof SyntaxKind.SyntheticExpression;
    isSpread: boolean;
    type: Type;
    tupleNameSource?: ParameterDeclaration | NamedTupleMember;
}
// see: https://tc39.github.io/ecma262/#prod-ExponentiationExpression
export type ExponentiationOperator = typeof SyntaxKind.AsteriskAsteriskToken;
// see: https://tc39.github.io/ecma262/#prod-MultiplicativeOperator
export type MultiplicativeOperator = typeof SyntaxKind.AsteriskToken | typeof SyntaxKind.SlashToken | typeof SyntaxKind.PercentToken;
// see: https://tc39.github.io/ecma262/#prod-MultiplicativeExpression
export type MultiplicativeOperatorOrHigher = ExponentiationOperator | MultiplicativeOperator;
// see: https://tc39.github.io/ecma262/#prod-AdditiveExpression
export type AdditiveOperator = typeof SyntaxKind.PlusToken | typeof SyntaxKind.MinusToken;
// see: https://tc39.github.io/ecma262/#prod-AdditiveExpression
export type AdditiveOperatorOrHigher = MultiplicativeOperatorOrHigher | AdditiveOperator;
// see: https://tc39.github.io/ecma262/#prod-ShiftExpression
export type ShiftOperator = typeof SyntaxKind.LessThanLessThanToken | typeof SyntaxKind.GreaterThanGreaterThanToken | typeof SyntaxKind.GreaterThanGreaterThanGreaterThanToken;
// see: https://tc39.github.io/ecma262/#prod-ShiftExpression
export type ShiftOperatorOrHigher = AdditiveOperatorOrHigher | ShiftOperator;
// see: https://tc39.github.io/ecma262/#prod-RelationalExpression
export type RelationalOperator = typeof SyntaxKind.LessThanToken | typeof SyntaxKind.LessThanEqualsToken | typeof SyntaxKind.GreaterThanToken | typeof SyntaxKind.GreaterThanEqualsToken | typeof SyntaxKind.InstanceOfKeyword | typeof SyntaxKind.InKeyword;
// see: https://tc39.github.io/ecma262/#prod-RelationalExpression
export type RelationalOperatorOrHigher = ShiftOperatorOrHigher | RelationalOperator;
// see: https://tc39.github.io/ecma262/#prod-EqualityExpression
export type EqualityOperator = typeof SyntaxKind.EqualsEqualsToken | typeof SyntaxKind.EqualsEqualsEqualsToken | typeof SyntaxKind.ExclamationEqualsEqualsToken | typeof SyntaxKind.ExclamationEqualsToken;
// see: https://tc39.github.io/ecma262/#prod-EqualityExpression
export type EqualityOperatorOrHigher = RelationalOperatorOrHigher | EqualityOperator;
// see: https://tc39.github.io/ecma262/#prod-BitwiseANDExpression
// see: https://tc39.github.io/ecma262/#prod-BitwiseXORExpression
// see: https://tc39.github.io/ecma262/#prod-BitwiseORExpression
export type BitwiseOperator = typeof SyntaxKind.AmpersandToken | typeof SyntaxKind.BarToken | typeof SyntaxKind.CaretToken;
// see: https://tc39.github.io/ecma262/#prod-BitwiseANDExpression
// see: https://tc39.github.io/ecma262/#prod-BitwiseXORExpression
// see: https://tc39.github.io/ecma262/#prod-BitwiseORExpression
export type BitwiseOperatorOrHigher = EqualityOperatorOrHigher | BitwiseOperator;
// see: https://tc39.github.io/ecma262/#prod-LogicalANDExpression
// see: https://tc39.github.io/ecma262/#prod-LogicalORExpression
export type LogicalOperator = typeof SyntaxKind.AmpersandAmpersandToken | typeof SyntaxKind.BarBarToken;
// see: https://tc39.github.io/ecma262/#prod-LogicalANDExpression
// see: https://tc39.github.io/ecma262/#prod-LogicalORExpression
export type LogicalOperatorOrHigher = BitwiseOperatorOrHigher | LogicalOperator;
// see: https://tc39.github.io/ecma262/#prod-AssignmentOperator
export type CompoundAssignmentOperator = typeof SyntaxKind.PlusEqualsToken | typeof SyntaxKind.MinusEqualsToken | typeof SyntaxKind.AsteriskAsteriskEqualsToken | typeof SyntaxKind.AsteriskEqualsToken | typeof SyntaxKind.SlashEqualsToken | typeof SyntaxKind.PercentEqualsToken | typeof SyntaxKind.AmpersandEqualsToken | typeof SyntaxKind.BarEqualsToken | typeof SyntaxKind.CaretEqualsToken | typeof SyntaxKind.LessThanLessThanEqualsToken | typeof SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken | typeof SyntaxKind.GreaterThanGreaterThanEqualsToken | typeof SyntaxKind.BarBarEqualsToken | typeof SyntaxKind.AmpersandAmpersandEqualsToken | typeof SyntaxKind.QuestionQuestionEqualsToken;
// see: https://tc39.github.io/ecma262/#prod-AssignmentExpression
export type AssignmentOperator = typeof SyntaxKind.EqualsToken | CompoundAssignmentOperator;
// see: https://tc39.github.io/ecma262/#prod-AssignmentExpression
export type AssignmentOperatorOrHigher = typeof SyntaxKind.QuestionQuestionToken | LogicalOperatorOrHigher | AssignmentOperator;
// see: https://tc39.github.io/ecma262/#prod-Expression
export type BinaryOperator = AssignmentOperatorOrHigher | typeof SyntaxKind.CommaToken;
export type LogicalOrCoalescingAssignmentOperator = typeof SyntaxKind.AmpersandAmpersandEqualsToken | typeof SyntaxKind.BarBarEqualsToken | typeof SyntaxKind.QuestionQuestionEqualsToken;
export type BinaryOperatorToken = Token<BinaryOperator>;
export interface BinaryExpression extends Expression, Declaration, JSDocContainer {
    kind: typeof SyntaxKind.BinaryExpression;
    left: Expression;
    operatorToken: BinaryOperatorToken;
    right: Expression;
}
export type AssignmentOperatorToken = Token<AssignmentOperator>;
export interface AssignmentExpression<TOperator extends AssignmentOperatorToken> extends BinaryExpression {
    left: LeftHandSideExpression;
    operatorToken: TOperator;
}
export interface ObjectDestructuringAssignment extends AssignmentExpression<EqualsToken> {
    left: ObjectLiteralExpression;
}
export interface ArrayDestructuringAssignment extends AssignmentExpression<EqualsToken> {
    left: ArrayLiteralExpression;
}
export type DestructuringAssignment = ObjectDestructuringAssignment | ArrayDestructuringAssignment;
export type BindingOrAssignmentElement = VariableDeclaration | ParameterDeclaration | ObjectBindingOrAssignmentElement | ArrayBindingOrAssignmentElement;
export type ObjectBindingOrAssignmentElement = BindingElement | PropertyAssignment // AssignmentProperty
 | ShorthandPropertyAssignment // AssignmentProperty
 | SpreadAssignment // AssignmentRestProperty
;
/** @internal @knipignore */
export type ObjectAssignmentElement = Exclude<ObjectBindingOrAssignmentElement, BindingElement>;
export type ArrayBindingOrAssignmentElement = BindingElement | OmittedExpression // Elision
 | SpreadElement // AssignmentRestElement
 | ArrayLiteralExpression // ArrayAssignmentPattern
 | ObjectLiteralExpression // ObjectAssignmentPattern
 | AssignmentExpression<EqualsToken> // AssignmentElement
 | Identifier // DestructuringAssignmentTarget
 | PropertyAccessExpression // DestructuringAssignmentTarget
 | ElementAccessExpression // DestructuringAssignmentTarget
;
/** @internal */
export type ArrayAssignmentElement = Exclude<ArrayBindingOrAssignmentElement, BindingElement>;
export type BindingOrAssignmentElementRestIndicator = DotDotDotToken // from BindingElement
 | SpreadElement // AssignmentRestElement
 | SpreadAssignment // AssignmentRestProperty
;
export type BindingOrAssignmentElementTarget = BindingOrAssignmentPattern | Identifier | PropertyAccessExpression | ElementAccessExpression | OmittedExpression;
/** @internal @knipignore */
export type AssignmentElementTarget = Exclude<BindingOrAssignmentElementTarget, BindingPattern>;
export type ObjectBindingOrAssignmentPattern = ObjectBindingPattern | ObjectLiteralExpression // ObjectAssignmentPattern
;
export type ArrayBindingOrAssignmentPattern = ArrayBindingPattern | ArrayLiteralExpression // ArrayAssignmentPattern
;
export type AssignmentPattern = ObjectLiteralExpression | ArrayLiteralExpression;
export type BindingOrAssignmentPattern = ObjectBindingOrAssignmentPattern | ArrayBindingOrAssignmentPattern;
export interface ConditionalExpression extends Expression {
    kind: typeof SyntaxKind.ConditionalExpression;
    condition: Expression;
    questionToken: QuestionToken;
    whenTrue: Expression;
    colonToken: ColonToken;
    whenFalse: Expression;
    /** @internal*/
    flowNodeWhenTrue: FlowNode | undefined;
    /** @internal */
    flowNodeWhenFalse: FlowNode | undefined;
}
export type FunctionBody = Block;
export type ConciseBody = FunctionBody | Expression;
export interface FunctionExpression extends PrimaryExpression, FunctionLikeDeclarationBase, JSDocContainer, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.FunctionExpression;
    modifiers?: NodeArray<Modifier>;
    name?: Identifier;
    body: FunctionBody; // Required, whereas the member inherited from FunctionDeclaration is optional
}
export interface ArrowFunction extends Expression, FunctionLikeDeclarationBase, JSDocContainer, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.ArrowFunction;
    modifiers?: NodeArray<Modifier>;
    equalsGreaterThanToken: EqualsGreaterThanToken;
    body: ConciseBody;
    name: never;
}
// The text property of a LiteralExpression stores the interpreted value of the literal in text form. For a StringLiteral,
// or any literal of a template, this means quotes have been removed and escapes have been converted to actual characters.
// For a NumericLiteral, the stored value is the toString() representation of the number. For example 1, 1.00, and 1e0 are all stored as just "1".
export interface LiteralLikeNode extends Node {
    text: string;
    isUnterminated?: boolean;
    hasExtendedUnicodeEscape?: boolean;
}
export interface TemplateLiteralLikeNode extends LiteralLikeNode {
    rawText?: string;
    /** @internal */
    templateFlags?: TokenFlags;
}
// The text property of a LiteralExpression stores the interpreted value of the literal in text form. For a StringLiteral,
// or any literal of a template, this means quotes have been removed and escapes have been converted to actual characters.
// For a NumericLiteral, the stored value is the toString() representation of the number. For example 1, 1.00, and 1e0 are all stored as just "1".
export interface LiteralExpression extends LiteralLikeNode, PrimaryExpression {
}
export interface RegularExpressionLiteral extends LiteralExpression {
    kind: typeof SyntaxKind.RegularExpressionLiteral;
}
// dprint-ignore
/** @internal */
export type RegularExpressionFlags = number;
// dprint-ignore
/** @internal */
export const RegularExpressionFlags: {
    readonly None: 0;
    readonly HasIndices: 1;
    readonly Global: 2;
    readonly IgnoreCase: 4;
    readonly Multiline: 8;
    readonly DotAll: 16;
    readonly Unicode: 32;
    readonly UnicodeSets: 64;
    readonly Sticky: 128;
    readonly AnyUnicodeMode: 96;
    readonly Modifiers: 28;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    HasIndices: 1,
    "1": "HasIndices",
    Global: 2,
    "2": "Global",
    IgnoreCase: 4,
    "4": "IgnoreCase",
    Multiline: 8,
    "8": "Multiline",
    DotAll: 16,
    "16": "DotAll",
    Unicode: 32,
    "32": "Unicode",
    UnicodeSets: 64,
    "64": "UnicodeSets",
    Sticky: 128,
    "128": "Sticky",
    AnyUnicodeMode: 96,
    "96": "AnyUnicodeMode",
    Modifiers: 28,
    "28": "Modifiers"
};
export interface NoSubstitutionTemplateLiteral extends LiteralExpression, TemplateLiteralLikeNode, Declaration {
    kind: typeof SyntaxKind.NoSubstitutionTemplateLiteral;
    /** @internal */
    templateFlags?: TokenFlags;
}
// dprint-ignore
export type TokenFlags = number;
// dprint-ignore
export const TokenFlags: {
    readonly None: 0;
    readonly PrecedingLineBreak: 1;
    readonly PrecedingJSDocComment: 2;
    readonly Unterminated: 4;
    readonly ExtendedUnicodeEscape: 8;
    readonly Scientific: 16;
    readonly Octal: 32;
    readonly HexSpecifier: 64;
    readonly BinarySpecifier: 128;
    readonly OctalSpecifier: 256;
    readonly ContainsSeparator: 512;
    readonly UnicodeEscape: 1024;
    readonly ContainsInvalidEscape: 2048;
    readonly HexEscape: 4096;
    readonly ContainsLeadingZero: 8192;
    readonly ContainsInvalidSeparator: 16384;
    readonly PrecedingJSDocLeadingAsterisks: 32768;
    readonly BinaryOrOctalSpecifier: 384;
    readonly WithSpecifier: 448;
    readonly StringLiteralFlags: 7176;
    readonly NumericLiteralFlags: 25584;
    readonly TemplateLiteralLikeFlags: 7176;
    readonly IsInvalid: 26656;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    PrecedingLineBreak: 1,
    "1": "PrecedingLineBreak",
    PrecedingJSDocComment: 2,
    "2": "PrecedingJSDocComment",
    Unterminated: 4,
    "4": "Unterminated",
    ExtendedUnicodeEscape: 8,
    "8": "ExtendedUnicodeEscape",
    Scientific: 16,
    "16": "Scientific",
    Octal: 32,
    "32": "Octal",
    HexSpecifier: 64,
    "64": "HexSpecifier",
    BinarySpecifier: 128,
    "128": "BinarySpecifier",
    OctalSpecifier: 256,
    "256": "OctalSpecifier",
    ContainsSeparator: 512,
    "512": "ContainsSeparator",
    UnicodeEscape: 1024,
    "1024": "UnicodeEscape",
    ContainsInvalidEscape: 2048,
    "2048": "ContainsInvalidEscape",
    HexEscape: 4096,
    "4096": "HexEscape",
    ContainsLeadingZero: 8192,
    "8192": "ContainsLeadingZero",
    ContainsInvalidSeparator: 16384,
    "16384": "ContainsInvalidSeparator",
    PrecedingJSDocLeadingAsterisks: 32768,
    "32768": "PrecedingJSDocLeadingAsterisks",
    BinaryOrOctalSpecifier: 384,
    "384": "BinaryOrOctalSpecifier",
    WithSpecifier: 448,
    "448": "WithSpecifier",
    StringLiteralFlags: 7176,
    "7176": "TemplateLiteralLikeFlags",
    NumericLiteralFlags: 25584,
    "25584": "NumericLiteralFlags",
    TemplateLiteralLikeFlags: 7176,
    IsInvalid: 26656,
    "26656": "IsInvalid"
};
export interface NumericLiteral extends LiteralExpression, Declaration {
    kind: typeof SyntaxKind.NumericLiteral;
    /** @internal */
    numericLiteralFlags: TokenFlags;
}
export interface BigIntLiteral extends LiteralExpression {
    kind: typeof SyntaxKind.BigIntLiteral;
}
export type LiteralToken = NumericLiteral | BigIntLiteral | StringLiteral | JsxText | RegularExpressionLiteral | NoSubstitutionTemplateLiteral;
export interface TemplateHead extends TemplateLiteralLikeNode {
    kind: typeof SyntaxKind.TemplateHead;
    parent: TemplateExpression | TemplateLiteralTypeNode;
    /** @internal */
    templateFlags?: TokenFlags;
}
export interface TemplateMiddle extends TemplateLiteralLikeNode {
    kind: typeof SyntaxKind.TemplateMiddle;
    parent: TemplateSpan | TemplateLiteralTypeSpan;
    /** @internal */
    templateFlags?: TokenFlags;
}
export interface TemplateTail extends TemplateLiteralLikeNode {
    kind: typeof SyntaxKind.TemplateTail;
    parent: TemplateSpan | TemplateLiteralTypeSpan;
    /** @internal */
    templateFlags?: TokenFlags;
}
export type PseudoLiteralToken = TemplateHead | TemplateMiddle | TemplateTail;
export type TemplateLiteralToken = NoSubstitutionTemplateLiteral | PseudoLiteralToken;
export interface TemplateExpression extends PrimaryExpression {
    kind: typeof SyntaxKind.TemplateExpression;
    head: TemplateHead;
    templateSpans: NodeArray<TemplateSpan>;
}
export type TemplateLiteral = TemplateExpression | NoSubstitutionTemplateLiteral;
// Each of these corresponds to a substitution expression and a template literal, in that order.
// The template literal must have kind TemplateMiddleLiteral or TemplateTailLiteral.
export interface TemplateSpan extends Node {
    kind: typeof SyntaxKind.TemplateSpan;
    parent: TemplateExpression;
    expression: Expression;
    literal: TemplateMiddle | TemplateTail;
}
export interface ParenthesizedExpression extends PrimaryExpression, JSDocContainer {
    kind: typeof SyntaxKind.ParenthesizedExpression;
    expression: Expression;
}
/** @internal */
export interface JSDocTypeAssertion extends ParenthesizedExpression {
}
export interface ArrayLiteralExpression extends PrimaryExpression {
    kind: typeof SyntaxKind.ArrayLiteralExpression;
    elements: NodeArray<Expression>;
    /** @internal */
    multiLine?: boolean;
}
export interface SpreadElement extends Expression {
    kind: typeof SyntaxKind.SpreadElement;
    parent: ArrayLiteralExpression | CallExpression | NewExpression;
    expression: Expression;
}
/**
 * This interface is a base interface for ObjectLiteralExpression and JSXAttributes to extend from. JSXAttributes is similar to
 * ObjectLiteralExpression in that it contains array of properties; however, JSXAttributes' properties can only be
 * JSXAttribute or JSXSpreadAttribute. ObjectLiteralExpression, on the other hand, can only have properties of type
 * ObjectLiteralElement (e.g. PropertyAssignment, ShorthandPropertyAssignment etc.)
 */
export interface ObjectLiteralExpressionBase<T extends ObjectLiteralElement> extends PrimaryExpression, Declaration {
    properties: NodeArray<T>;
}
// An ObjectLiteralExpression is the declaration node for an anonymous symbol.
export interface ObjectLiteralExpression extends ObjectLiteralExpressionBase<ObjectLiteralElementLike>, JSDocContainer {
    kind: typeof SyntaxKind.ObjectLiteralExpression;
    /** @internal */
    multiLine?: boolean;
}
export type EntityNameExpression = Identifier | PropertyAccessEntityNameExpression;
export type EntityNameOrEntityNameExpression = EntityName | EntityNameExpression;
export type AccessExpression = PropertyAccessExpression | ElementAccessExpression;
export interface PropertyAccessExpression extends MemberExpression, NamedDeclaration, JSDocContainer, FlowContainer {
    kind: typeof SyntaxKind.PropertyAccessExpression;
    expression: LeftHandSideExpression;
    questionDotToken?: QuestionDotToken;
    name: MemberName;
}
/** @internal */
export interface PrivateIdentifierPropertyAccessExpression extends PropertyAccessExpression {
    name: PrivateIdentifier;
}
export interface PropertyAccessChain extends PropertyAccessExpression {
    name: MemberName;
}
/** @internal */
export interface PropertyAccessChainRoot extends PropertyAccessChain {
    questionDotToken: QuestionDotToken;
}
export interface SuperPropertyAccessExpression extends PropertyAccessExpression {
    expression: SuperExpression;
}
/** Brand for a PropertyAccessExpression which, like a QualifiedName, consists of a sequence of identifiers separated by dots. */
export interface PropertyAccessEntityNameExpression extends PropertyAccessExpression {
    expression: EntityNameExpression;
    name: Identifier;
}
export interface ElementAccessExpression extends MemberExpression, Declaration, JSDocContainer, FlowContainer {
    kind: typeof SyntaxKind.ElementAccessExpression;
    expression: LeftHandSideExpression;
    questionDotToken?: QuestionDotToken;
    argumentExpression: Expression;
}
export interface ElementAccessChain extends ElementAccessExpression {
}
/** @internal */
export interface ElementAccessChainRoot extends ElementAccessChain {
    questionDotToken: QuestionDotToken;
}
export interface SuperElementAccessExpression extends ElementAccessExpression {
    expression: SuperExpression;
}
// see: https://tc39.github.io/ecma262/#prod-SuperProperty
export type SuperProperty = SuperPropertyAccessExpression | SuperElementAccessExpression;
export interface CallExpression extends LeftHandSideExpression, Declaration {
    kind: typeof SyntaxKind.CallExpression;
    expression: LeftHandSideExpression;
    questionDotToken?: QuestionDotToken;
    typeArguments?: NodeArray<TypeNode>;
    arguments: NodeArray<Expression>;
}
export interface CallChain extends CallExpression {
}
/** @internal */
export interface CallChainRoot extends CallChain {
    questionDotToken: QuestionDotToken;
}
export type OptionalChain = PropertyAccessChain | ElementAccessChain | CallChain | NonNullChain;
/** @internal */
export type OptionalChainRoot = PropertyAccessChainRoot | ElementAccessChainRoot | CallChainRoot;
/** @internal */
export type BindableObjectDefinePropertyCall = CallExpression & {
    arguments: readonly [
        BindableStaticNameExpression,
        StringLiteralLike | NumericLiteral,
        ObjectLiteralExpression
    ] & Readonly<TextRange>;
};
/** @internal */
export type BindableStaticNameExpression = EntityNameExpression | BindableStaticElementAccessExpression;
/** @internal */
export type LiteralLikeElementAccessExpression = ElementAccessExpression & Declaration & {
    argumentExpression: StringLiteralLike | NumericLiteral;
};
/** @internal */
export type BindableStaticElementAccessExpression = LiteralLikeElementAccessExpression & {
    expression: BindableStaticNameExpression;
};
/** @internal */
export type BindableElementAccessExpression = ElementAccessExpression & {
    expression: BindableStaticNameExpression;
};
/** @internal */
export type BindableStaticAccessExpression = PropertyAccessEntityNameExpression | BindableStaticElementAccessExpression;
/** @internal */
export type BindableAccessExpression = PropertyAccessEntityNameExpression | BindableElementAccessExpression;
/** @internal */
export interface BindableStaticPropertyAssignmentExpression extends BinaryExpression {
    left: BindableStaticAccessExpression;
}
/** @internal */
export interface BindablePropertyAssignmentExpression extends BinaryExpression {
    left: BindableAccessExpression;
}
// see: https://tc39.github.io/ecma262/#prod-SuperCall
export interface SuperCall extends CallExpression {
    expression: SuperExpression;
}
export interface ImportCall extends CallExpression {
    expression: ImportExpression | ImportDeferProperty;
}
export interface ExpressionWithTypeArguments extends MemberExpression, NodeWithTypeArguments {
    kind: typeof SyntaxKind.ExpressionWithTypeArguments;
    expression: LeftHandSideExpression;
}
export interface NewExpression extends PrimaryExpression, Declaration {
    questionDotToken?: QuestionDotToken;
    kind: typeof SyntaxKind.NewExpression;
    expression: LeftHandSideExpression;
    typeArguments?: NodeArray<TypeNode>;
    arguments?: NodeArray<Expression>;
}
export interface TaggedTemplateExpression extends MemberExpression {
    kind: typeof SyntaxKind.TaggedTemplateExpression;
    tag: LeftHandSideExpression;
    typeArguments?: NodeArray<TypeNode>;
    template: TemplateLiteral;
    /** @internal */ questionDotToken?: QuestionDotToken; // NOTE: Invalid syntax, only used to report a grammar error.
}
export interface InstanceofExpression extends BinaryExpression {
    operatorToken: Token<typeof SyntaxKind.InstanceOfKeyword>;
}
export type CallLikeExpression = CallExpression | NewExpression | TaggedTemplateExpression | Decorator | JsxCallLike | InstanceofExpression;
export interface AsExpression extends Expression {
    kind: typeof SyntaxKind.AsExpression;
    expression: Expression;
    type: TypeNode;
}
export interface TypeAssertion extends UnaryExpression {
    kind: typeof SyntaxKind.TypeAssertionExpression;
    type: TypeNode;
    expression: UnaryExpression;
}
export interface SatisfiesExpression extends Expression {
    kind: typeof SyntaxKind.SatisfiesExpression;
    expression: Expression;
    type: TypeNode;
}
export type AssertionExpression = TypeAssertion | AsExpression;
export interface NonNullExpression extends LeftHandSideExpression {
    kind: typeof SyntaxKind.NonNullExpression;
    expression: Expression;
}
export interface NonNullChain extends NonNullExpression {
}
// NOTE: MetaProperty is really a MemberExpression, but we consider it a PrimaryExpression
//       for the same reasons we treat NewExpression as a PrimaryExpression.
export interface MetaProperty extends PrimaryExpression, FlowContainer {
    kind: typeof SyntaxKind.MetaProperty;
    keywordToken: typeof SyntaxKind.NewKeyword | typeof SyntaxKind.ImportKeyword;
    name: Identifier;
}
/** @internal */
export interface ImportMetaProperty extends MetaProperty {
    keywordToken: typeof SyntaxKind.ImportKeyword;
    name: Identifier & {
        escapedText: __String & "meta";
    };
}
export interface ImportDeferProperty extends MetaProperty {
    keywordToken: typeof SyntaxKind.ImportKeyword;
    name: Identifier & {
        escapedText: __String & "defer";
    };
}
/// A JSX expression of the form <TagName attrs>...</TagName>
export interface JsxElement extends PrimaryExpression {
    kind: typeof SyntaxKind.JsxElement;
    openingElement: JsxOpeningElement;
    children: NodeArray<JsxChild>;
    closingElement: JsxClosingElement;
}
/// Either the opening tag in a <Tag>...</Tag> pair or the lone <Tag /> in a self-closing form
export type JsxOpeningLikeElement = JsxSelfClosingElement | JsxOpeningElement;
export type JsxCallLike = JsxOpeningLikeElement | JsxOpeningFragment;
export type JsxAttributeLike = JsxAttribute | JsxSpreadAttribute;
export type JsxAttributeName = Identifier | JsxNamespacedName;
export type JsxTagNameExpression = Identifier | ThisExpression | JsxTagNamePropertyAccess | JsxNamespacedName;
export interface JsxTagNamePropertyAccess extends PropertyAccessExpression {
    expression: Identifier | ThisExpression | JsxTagNamePropertyAccess;
}
export interface JsxAttributes extends PrimaryExpression, Declaration {
    properties: NodeArray<JsxAttributeLike>;
    kind: typeof SyntaxKind.JsxAttributes;
    parent: JsxOpeningLikeElement;
}
export interface JsxNamespacedName extends Node {
    kind: typeof SyntaxKind.JsxNamespacedName;
    name: Identifier;
    namespace: Identifier;
}
/// The opening element of a <Tag>...</Tag> JsxElement
export interface JsxOpeningElement extends Expression {
    kind: typeof SyntaxKind.JsxOpeningElement;
    parent: JsxElement;
    tagName: JsxTagNameExpression;
    typeArguments?: NodeArray<TypeNode>;
    attributes: JsxAttributes;
}
/// A JSX expression of the form <TagName attrs />
export interface JsxSelfClosingElement extends PrimaryExpression {
    kind: typeof SyntaxKind.JsxSelfClosingElement;
    tagName: JsxTagNameExpression;
    typeArguments?: NodeArray<TypeNode>;
    attributes: JsxAttributes;
}
/// A JSX expression of the form <>...</>
export interface JsxFragment extends PrimaryExpression {
    kind: typeof SyntaxKind.JsxFragment;
    openingFragment: JsxOpeningFragment;
    children: NodeArray<JsxChild>;
    closingFragment: JsxClosingFragment;
}
/// The opening element of a <>...</> JsxFragment
export interface JsxOpeningFragment extends Expression {
    kind: typeof SyntaxKind.JsxOpeningFragment;
    parent: JsxFragment;
}
/// The closing element of a <>...</> JsxFragment
export interface JsxClosingFragment extends Expression {
    kind: typeof SyntaxKind.JsxClosingFragment;
    parent: JsxFragment;
}
export interface JsxAttribute extends Declaration {
    kind: typeof SyntaxKind.JsxAttribute;
    parent: JsxAttributes;
    name: JsxAttributeName;
    /// JSX attribute initializers are optional; <X y /> is sugar for <X y={true} />
    initializer?: JsxAttributeValue;
}
export type JsxAttributeValue = StringLiteral | JsxExpression | JsxElement | JsxSelfClosingElement | JsxFragment | BinaryExpression;
export interface JsxSpreadAttribute extends ObjectLiteralElement {
    kind: typeof SyntaxKind.JsxSpreadAttribute;
    parent: JsxAttributes;
    expression: Expression;
}
export interface JsxClosingElement extends Node {
    kind: typeof SyntaxKind.JsxClosingElement;
    parent: JsxElement;
    tagName: JsxTagNameExpression;
}
export interface JsxExpression extends Expression {
    kind: typeof SyntaxKind.JsxExpression;
    parent: JsxElement | JsxFragment | JsxAttributeLike;
    dotDotDotToken?: Token<typeof SyntaxKind.DotDotDotToken>;
    expression?: Expression;
}
export interface JsxText extends LiteralLikeNode {
    kind: typeof SyntaxKind.JsxText;
    parent: JsxElement | JsxFragment;
    containsOnlyTriviaWhiteSpaces: boolean;
}
export type JsxChild = JsxText | JsxExpression | JsxElement | JsxSelfClosingElement | JsxFragment;
export interface Statement extends Node, JSDocContainer {
}
// Represents a statement that is elided as part of a transformation to emit comments on a
// not-emitted node.
export interface NotEmittedStatement extends Statement {
    kind: typeof SyntaxKind.NotEmittedStatement;
}
export interface NotEmittedTypeElement extends TypeElement {
    kind: typeof SyntaxKind.NotEmittedTypeElement;
}
/**
 * A list of comma-separated expressions. This node is only created by transformations.
 */
export interface CommaListExpression extends Expression {
    kind: typeof SyntaxKind.CommaListExpression;
    elements: NodeArray<Expression>;
}
/** @internal */
export interface SyntheticReferenceExpression extends LeftHandSideExpression {
    kind: typeof SyntaxKind.SyntheticReferenceExpression;
    expression: Expression;
    thisArg: Expression;
}
export interface EmptyStatement extends Statement {
    kind: typeof SyntaxKind.EmptyStatement;
}
export interface DebuggerStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.DebuggerStatement;
}
export interface MissingDeclaration extends DeclarationStatement, PrimaryExpression {
    kind: typeof SyntaxKind.MissingDeclaration;
    name?: Identifier;
    // The following properties are used only to report grammar errors
    /** @internal */ modifiers?: NodeArray<ModifierLike> | undefined;
}
export type BlockLike = SourceFile | Block | ModuleBlock | CaseOrDefaultClause;
export interface Block extends Statement, LocalsContainer {
    kind: typeof SyntaxKind.Block;
    statements: NodeArray<Statement>;
    /** @internal */ multiLine?: boolean;
}
export interface VariableStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.VariableStatement;
    modifiers?: NodeArray<ModifierLike>;
    declarationList: VariableDeclarationList;
}
export interface ExpressionStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.ExpressionStatement;
    expression: Expression;
}
/** @internal */
export interface PrologueDirective extends ExpressionStatement {
    expression: StringLiteral;
}
export interface IfStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.IfStatement;
    expression: Expression;
    thenStatement: Statement;
    elseStatement?: Statement;
}
export interface IterationStatement extends Statement {
    statement: Statement;
}
export interface DoStatement extends IterationStatement, FlowContainer {
    kind: typeof SyntaxKind.DoStatement;
    expression: Expression;
}
export interface WhileStatement extends IterationStatement, FlowContainer {
    kind: typeof SyntaxKind.WhileStatement;
    expression: Expression;
}
export type ForInitializer = VariableDeclarationList | Expression;
export interface ForStatement extends IterationStatement, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.ForStatement;
    initializer?: ForInitializer;
    condition?: Expression;
    incrementor?: Expression;
}
export type ForInOrOfStatement = ForInStatement | ForOfStatement;
export interface ForInStatement extends IterationStatement, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.ForInStatement;
    initializer: ForInitializer;
    expression: Expression;
}
export interface ForOfStatement extends IterationStatement, LocalsContainer, FlowContainer {
    kind: typeof SyntaxKind.ForOfStatement;
    awaitModifier?: AwaitKeyword;
    initializer: ForInitializer;
    expression: Expression;
}
export interface BreakStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.BreakStatement;
    label?: Identifier;
}
export interface ContinueStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.ContinueStatement;
    label?: Identifier;
}
export type BreakOrContinueStatement = BreakStatement | ContinueStatement;
export interface ReturnStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.ReturnStatement;
    expression?: Expression;
}
export interface WithStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.WithStatement;
    expression: Expression;
    statement: Statement;
}
export interface SwitchStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.SwitchStatement;
    expression: Expression;
    caseBlock: CaseBlock;
    possiblyExhaustive?: boolean; // initialized by binding
}
export interface CaseBlock extends Node, LocalsContainer {
    kind: typeof SyntaxKind.CaseBlock;
    parent: SwitchStatement;
    clauses: NodeArray<CaseOrDefaultClause>;
}
export interface CaseClause extends Node, JSDocContainer {
    kind: typeof SyntaxKind.CaseClause;
    parent: CaseBlock;
    expression: Expression;
    statements: NodeArray<Statement>;
    /** @internal */ fallthroughFlowNode?: FlowNode;
}
export interface DefaultClause extends Node {
    kind: typeof SyntaxKind.DefaultClause;
    parent: CaseBlock;
    statements: NodeArray<Statement>;
    /** @internal */ fallthroughFlowNode?: FlowNode;
}
export type CaseOrDefaultClause = CaseClause | DefaultClause;
export interface LabeledStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.LabeledStatement;
    label: Identifier;
    statement: Statement;
}
export interface ThrowStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.ThrowStatement;
    expression: Expression;
}
export interface TryStatement extends Statement, FlowContainer {
    kind: typeof SyntaxKind.TryStatement;
    tryBlock: Block;
    catchClause?: CatchClause;
    finallyBlock?: Block;
}
export interface CatchClause extends Node, LocalsContainer {
    kind: typeof SyntaxKind.CatchClause;
    parent: TryStatement;
    variableDeclaration?: VariableDeclaration;
    block: Block;
}
export type ObjectTypeDeclaration = ClassLikeDeclaration | InterfaceDeclaration | TypeLiteralNode;
export type DeclarationWithTypeParameters = DeclarationWithTypeParameterChildren | JSDocTypedefTag | JSDocCallbackTag | JSDocSignature;
export type DeclarationWithTypeParameterChildren = SignatureDeclaration | ClassLikeDeclaration | InterfaceDeclaration | TypeAliasDeclaration | JSDocTemplateTag;
export interface ClassLikeDeclarationBase extends NamedDeclaration, JSDocContainer {
    kind: typeof SyntaxKind.ClassDeclaration | typeof SyntaxKind.ClassExpression;
    name?: Identifier;
    typeParameters?: NodeArray<TypeParameterDeclaration>;
    heritageClauses?: NodeArray<HeritageClause>;
    members: NodeArray<ClassElement>;
}
export interface ClassDeclaration extends ClassLikeDeclarationBase, DeclarationStatement {
    kind: typeof SyntaxKind.ClassDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    /** May be undefined in `export default class { ... }`. */
    name?: Identifier;
}
export interface ClassExpression extends ClassLikeDeclarationBase, PrimaryExpression {
    kind: typeof SyntaxKind.ClassExpression;
    modifiers?: NodeArray<ModifierLike>;
}
export type ClassLikeDeclaration = ClassDeclaration | ClassExpression;
export interface ClassElement extends NamedDeclaration {
    name?: PropertyName;
}
export interface TypeElement extends NamedDeclaration {
    name?: PropertyName;
    questionToken?: QuestionToken | undefined;
}
export interface InterfaceDeclaration extends DeclarationStatement, JSDocContainer {
    kind: typeof SyntaxKind.InterfaceDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name: Identifier;
    typeParameters?: NodeArray<TypeParameterDeclaration>;
    heritageClauses?: NodeArray<HeritageClause>;
    members: NodeArray<TypeElement>;
}
export interface HeritageClause extends Node {
    kind: typeof SyntaxKind.HeritageClause;
    parent: InterfaceDeclaration | ClassLikeDeclaration;
    token: typeof SyntaxKind.ExtendsKeyword | typeof SyntaxKind.ImplementsKeyword;
    types: NodeArray<ExpressionWithTypeArguments>;
}
export interface TypeAliasDeclaration extends DeclarationStatement, JSDocContainer, LocalsContainer {
    kind: typeof SyntaxKind.TypeAliasDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name: Identifier;
    typeParameters?: NodeArray<TypeParameterDeclaration>;
    type: TypeNode;
}
export interface EnumMember extends NamedDeclaration, JSDocContainer {
    kind: typeof SyntaxKind.EnumMember;
    parent: EnumDeclaration;
    // This does include ComputedPropertyName, but the parser will give an error
    // if it parses a ComputedPropertyName in an EnumMember
    name: PropertyName;
    initializer?: Expression;
}
export interface EnumDeclaration extends DeclarationStatement, JSDocContainer {
    kind: typeof SyntaxKind.EnumDeclaration;
    modifiers?: NodeArray<ModifierLike>;
    name: Identifier;
    members: NodeArray<EnumMember>;
}
export type ModuleName = Identifier | StringLiteral;
export type ModuleBody = NamespaceBody | JSDocNamespaceBody;
/** @internal */
export interface AmbientModuleDeclaration extends ModuleDeclaration {
    body?: ModuleBlock;
}
export interface ModuleDeclaration extends DeclarationStatement, JSDocContainer, LocalsContainer {
    kind: typeof SyntaxKind.ModuleDeclaration;
    parent: ModuleBody | SourceFile;
    modifiers?: NodeArray<ModifierLike>;
    name: ModuleName;
    body?: ModuleBody | JSDocNamespaceDeclaration;
}
export type NamespaceBody = ModuleBlock | NamespaceDeclaration;
export interface NamespaceDeclaration extends ModuleDeclaration {
    name: Identifier;
    body: NamespaceBody;
}
export type JSDocNamespaceBody = Identifier | JSDocNamespaceDeclaration;
export interface JSDocNamespaceDeclaration extends ModuleDeclaration {
    name: Identifier;
    body?: JSDocNamespaceBody;
}
export interface ModuleBlock extends Node, Statement {
    kind: typeof SyntaxKind.ModuleBlock;
    parent: ModuleDeclaration;
    statements: NodeArray<Statement>;
}
export type ModuleReference = EntityName | ExternalModuleReference;
/**
 * One of:
 * - import x = require("mod");
 * - import x = M.x;
 */
export interface ImportEqualsDeclaration extends DeclarationStatement, JSDocContainer {
    kind: typeof SyntaxKind.ImportEqualsDeclaration;
    parent: SourceFile | ModuleBlock;
    modifiers?: NodeArray<ModifierLike>;
    name: Identifier;
    isTypeOnly: boolean;
    // 'EntityName' for an internal module reference, 'ExternalModuleReference' for an external
    // module reference.
    moduleReference: ModuleReference;
}
export interface ExternalModuleReference extends Node {
    kind: typeof SyntaxKind.ExternalModuleReference;
    parent: ImportEqualsDeclaration;
    expression: Expression;
}
// In case of:
// import "mod"  => importClause = undefined, moduleSpecifier = "mod"
// In rest of the cases, module specifier is string literal corresponding to module
// ImportClause information is shown at its declaration below.
export interface ImportDeclaration extends Statement {
    kind: typeof SyntaxKind.ImportDeclaration;
    parent: SourceFile | ModuleBlock;
    modifiers?: NodeArray<ModifierLike>;
    importClause?: ImportClause;
    /** If this is not a StringLiteral it will be a grammar error. */
    moduleSpecifier: Expression;
    /** @deprecated */ assertClause?: AssertClause;
    attributes?: ImportAttributes;
}
export type NamedImportBindings = NamespaceImport | NamedImports;
export type NamedExportBindings = NamespaceExport | NamedExports;
// In case of:
// import d from "mod" => name = d, namedBinding = undefined
// import * as ns from "mod" => name = undefined, namedBinding: NamespaceImport = { name: ns }
// import d, * as ns from "mod" => name = d, namedBinding: NamespaceImport = { name: ns }
// import { a, b as x } from "mod" => name = undefined, namedBinding: NamedImports = { elements: [{ name: a }, { name: x, propertyName: b}]}
// import d, { a, b as x } from "mod" => name = d, namedBinding: NamedImports = { elements: [{ name: a }, { name: x, propertyName: b}]}
export interface ImportClause extends NamedDeclaration {
    kind: typeof SyntaxKind.ImportClause;
    parent: ImportDeclaration | JSDocImportTag;
    /** @deprecated Use `phaseModifier` instead */
    isTypeOnly: boolean;
    phaseModifier: undefined | ImportPhaseModifierSyntaxKind;
    name?: Identifier; // Default binding
    namedBindings?: NamedImportBindings;
}
export type ImportPhaseModifierSyntaxKind = typeof SyntaxKind.TypeKeyword | typeof SyntaxKind.DeferKeyword;
/** @deprecated */
export type AssertionKey = ImportAttributeName;
/** @deprecated */
export interface AssertEntry extends ImportAttribute {
}
/** @deprecated */
export interface AssertClause extends ImportAttributes {
}
export type ImportAttributeName = Identifier | StringLiteral;
export interface ImportAttribute extends Node {
    kind: typeof SyntaxKind.ImportAttribute;
    parent: ImportAttributes;
    name: ImportAttributeName;
    value: Expression;
}
export interface ImportAttributes extends Node {
    token: SyntaxKind;
    kind: typeof SyntaxKind.ImportAttributes;
    parent: ImportDeclaration | ExportDeclaration;
    elements: NodeArray<ImportAttribute>;
    multiLine?: boolean;
}
export interface NamespaceImport extends NamedDeclaration {
    kind: typeof SyntaxKind.NamespaceImport;
    parent: ImportClause;
    name: Identifier;
}
export interface NamespaceExport extends NamedDeclaration {
    kind: typeof SyntaxKind.NamespaceExport;
    parent: ExportDeclaration;
    name: ModuleExportName;
}
export interface NamespaceExportDeclaration extends DeclarationStatement, JSDocContainer {
    kind: typeof SyntaxKind.NamespaceExportDeclaration;
    name: Identifier;
    // The following properties are used only to report grammar errors (see `isGrammarError` in utilities.ts)
    /** @internal */ modifiers?: NodeArray<ModifierLike> | undefined;
}
export interface ExportDeclaration extends DeclarationStatement, JSDocContainer {
    kind: typeof SyntaxKind.ExportDeclaration;
    parent: SourceFile | ModuleBlock;
    modifiers?: NodeArray<ModifierLike>;
    isTypeOnly: boolean;
    /** Will not be assigned in the case of `export * from "foo";` */
    exportClause?: NamedExportBindings;
    /** If this is not a StringLiteral it will be a grammar error. */
    moduleSpecifier?: Expression;
    /** @deprecated */ assertClause?: AssertClause;
    attributes?: ImportAttributes;
}
export interface NamedImports extends Node {
    kind: typeof SyntaxKind.NamedImports;
    parent: ImportClause;
    elements: NodeArray<ImportSpecifier>;
}
export interface NamedExports extends Node {
    kind: typeof SyntaxKind.NamedExports;
    parent: ExportDeclaration;
    elements: NodeArray<ExportSpecifier>;
}
export type NamedImportsOrExports = NamedImports | NamedExports;
export interface ImportSpecifier extends NamedDeclaration {
    kind: typeof SyntaxKind.ImportSpecifier;
    parent: NamedImports;
    propertyName?: ModuleExportName; // Name preceding "as" keyword (or undefined when "as" is absent)
    name: Identifier; // Declared name
    isTypeOnly: boolean;
}
export interface ExportSpecifier extends NamedDeclaration, JSDocContainer {
    kind: typeof SyntaxKind.ExportSpecifier;
    parent: NamedExports;
    isTypeOnly: boolean;
    propertyName?: ModuleExportName; // Name preceding "as" keyword (or undefined when "as" is absent)
    name: ModuleExportName; // Declared name
}
export type ModuleExportName = Identifier | StringLiteral;
export type ImportOrExportSpecifier = ImportSpecifier | ExportSpecifier;
export type TypeOnlyCompatibleAliasDeclaration = ImportClause | ImportEqualsDeclaration | NamespaceImport | ImportOrExportSpecifier | ExportDeclaration | NamespaceExport;
export type TypeOnlyImportDeclaration = (ImportClause & {
    isTypeOnly: true;
    name: Identifier;
}) | (ImportEqualsDeclaration & {
    isTypeOnly: true;
}) | (NamespaceImport & {
    parent: ImportClause & {
        isTypeOnly: true;
    };
}) | (ImportSpecifier & ({
    isTypeOnly: true;
} | {
    parent: NamedImports & {
        parent: ImportClause & {
            isTypeOnly: true;
        };
    };
}));
export type TypeOnlyExportDeclaration = (ExportSpecifier & ({
    isTypeOnly: true;
} | {
    parent: NamedExports & {
        parent: ExportDeclaration & {
            isTypeOnly: true;
        };
    };
})) | (ExportDeclaration & {
    isTypeOnly: true;
    moduleSpecifier: Expression;
} // export * from "mod"
) | (NamespaceExport & {
    parent: ExportDeclaration & {
        isTypeOnly: true;
        moduleSpecifier: Expression;
    };
}) // export * as ns from "mod"
;
export type TypeOnlyAliasDeclaration = TypeOnlyImportDeclaration | TypeOnlyExportDeclaration;
/**
 * This is either an `export =` or an `export default` declaration.
 * Unless `isExportEquals` is set, this node was parsed as an `export default`.
 */
export interface ExportAssignment extends DeclarationStatement, JSDocContainer {
    kind: typeof SyntaxKind.ExportAssignment;
    parent: SourceFile;
    modifiers?: NodeArray<ModifierLike>;
    isExportEquals?: boolean;
    expression: Expression;
}
export interface FileReference extends TextRange {
    fileName: string;
    resolutionMode?: ResolutionMode;
    preserve?: boolean;
}
export interface CheckJsDirective extends TextRange {
    enabled: boolean;
}
export type CommentKind = typeof SyntaxKind.SingleLineCommentTrivia | typeof SyntaxKind.MultiLineCommentTrivia;
export interface CommentRange extends TextRange {
    hasTrailingNewLine?: boolean;
    kind: CommentKind;
}
export interface SynthesizedComment extends CommentRange {
    text: string;
    pos: -1;
    end: -1;
    hasLeadingNewline?: boolean;
}
// represents a top level: { type } expression in a JSDoc comment.
export interface JSDocTypeExpression extends TypeNode {
    kind: typeof SyntaxKind.JSDocTypeExpression;
    type: TypeNode;
}
export interface JSDocNameReference extends Node {
    kind: typeof SyntaxKind.JSDocNameReference;
    name: EntityName | JSDocMemberName;
}
/** Class#method reference in JSDoc */
export interface JSDocMemberName extends Node {
    kind: typeof SyntaxKind.JSDocMemberName;
    left: EntityName | JSDocMemberName;
    right: Identifier;
}
export interface JSDocType extends TypeNode {
}
export interface JSDocAllType extends JSDocType {
    kind: typeof SyntaxKind.JSDocAllType;
}
export interface JSDocUnknownType extends JSDocType {
    kind: typeof SyntaxKind.JSDocUnknownType;
}
export interface JSDocNonNullableType extends JSDocType {
    kind: typeof SyntaxKind.JSDocNonNullableType;
    type: TypeNode;
    postfix: boolean;
}
export interface JSDocNullableType extends JSDocType {
    kind: typeof SyntaxKind.JSDocNullableType;
    type: TypeNode;
    postfix: boolean;
}
export interface JSDocOptionalType extends JSDocType {
    kind: typeof SyntaxKind.JSDocOptionalType;
    type: TypeNode;
}
export interface JSDocFunctionType extends JSDocType, SignatureDeclarationBase, LocalsContainer {
    kind: typeof SyntaxKind.JSDocFunctionType;
}
export interface JSDocVariadicType extends JSDocType {
    kind: typeof SyntaxKind.JSDocVariadicType;
    type: TypeNode;
}
export interface JSDocNamepathType extends JSDocType {
    kind: typeof SyntaxKind.JSDocNamepathType;
    type: TypeNode;
}
export type JSDocTypeReferencingNode = JSDocVariadicType | JSDocOptionalType | JSDocNullableType | JSDocNonNullableType;
export interface JSDoc extends Node {
    kind: typeof SyntaxKind.JSDoc;
    parent: HasJSDoc;
    tags?: NodeArray<JSDocTag>;
    comment?: string | NodeArray<JSDocComment>;
}
export interface JSDocTag extends Node {
    parent: JSDoc | JSDocTypeLiteral;
    tagName: Identifier;
    comment?: string | NodeArray<JSDocComment>;
}
export interface JSDocLink extends Node {
    kind: typeof SyntaxKind.JSDocLink;
    name?: EntityName | JSDocMemberName;
    text: string;
}
export interface JSDocLinkCode extends Node {
    kind: typeof SyntaxKind.JSDocLinkCode;
    name?: EntityName | JSDocMemberName;
    text: string;
}
export interface JSDocLinkPlain extends Node {
    kind: typeof SyntaxKind.JSDocLinkPlain;
    name?: EntityName | JSDocMemberName;
    text: string;
}
export type JSDocComment = JSDocText | JSDocLink | JSDocLinkCode | JSDocLinkPlain;
export interface JSDocText extends Node {
    kind: typeof SyntaxKind.JSDocText;
    text: string;
}
export interface JSDocUnknownTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocTag;
}
/**
 * Note that `@extends` is a synonym of `@augments`.
 * Both tags are represented by this interface.
 */
export interface JSDocAugmentsTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocAugmentsTag;
    class: ExpressionWithTypeArguments & {
        expression: Identifier | PropertyAccessEntityNameExpression;
    };
}
export interface JSDocImplementsTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocImplementsTag;
    class: ExpressionWithTypeArguments & {
        expression: Identifier | PropertyAccessEntityNameExpression;
    };
}
export interface JSDocAuthorTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocAuthorTag;
}
export interface JSDocDeprecatedTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocDeprecatedTag;
}
export interface JSDocClassTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocClassTag;
}
export interface JSDocPublicTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocPublicTag;
}
export interface JSDocPrivateTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocPrivateTag;
}
export interface JSDocProtectedTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocProtectedTag;
}
export interface JSDocReadonlyTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocReadonlyTag;
}
export interface JSDocOverrideTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocOverrideTag;
}
export interface JSDocEnumTag extends JSDocTag, Declaration, LocalsContainer {
    kind: typeof SyntaxKind.JSDocEnumTag;
    parent: JSDoc;
    typeExpression: JSDocTypeExpression;
}
export interface JSDocThisTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocThisTag;
    typeExpression: JSDocTypeExpression;
}
export interface JSDocTemplateTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocTemplateTag;
    constraint: JSDocTypeExpression | undefined;
    typeParameters: NodeArray<TypeParameterDeclaration>;
}
export interface JSDocSeeTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocSeeTag;
    name?: JSDocNameReference;
}
export interface JSDocReturnTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocReturnTag;
    typeExpression?: JSDocTypeExpression;
}
export interface JSDocTypeTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocTypeTag;
    typeExpression: JSDocTypeExpression;
}
export interface JSDocTypedefTag extends JSDocTag, NamedDeclaration, LocalsContainer {
    kind: typeof SyntaxKind.JSDocTypedefTag;
    parent: JSDoc;
    fullName?: JSDocNamespaceDeclaration | Identifier;
    name?: Identifier;
    typeExpression?: JSDocTypeExpression | JSDocTypeLiteral;
}
export interface JSDocCallbackTag extends JSDocTag, NamedDeclaration, LocalsContainer {
    kind: typeof SyntaxKind.JSDocCallbackTag;
    parent: JSDoc;
    fullName?: JSDocNamespaceDeclaration | Identifier;
    name?: Identifier;
    typeExpression: JSDocSignature;
}
export interface JSDocOverloadTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocOverloadTag;
    parent: JSDoc;
    typeExpression: JSDocSignature;
}
export interface JSDocThrowsTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocThrowsTag;
    typeExpression?: JSDocTypeExpression;
}
export interface JSDocSignature extends JSDocType, Declaration, JSDocContainer, LocalsContainer {
    kind: typeof SyntaxKind.JSDocSignature;
    typeParameters?: readonly JSDocTemplateTag[];
    parameters: readonly (JSDocParameterTag | JSDocThisTag)[];
    type: JSDocReturnTag | undefined;
}
export interface JSDocPropertyLikeTag extends JSDocTag, Declaration {
    parent: JSDoc;
    name: EntityName;
    typeExpression?: JSDocTypeExpression;
    /** Whether the property name came before the type -- non-standard for JSDoc, but Typescript-like */
    isNameFirst: boolean;
    isBracketed: boolean;
}
export interface JSDocPropertyTag extends JSDocPropertyLikeTag {
    kind: typeof SyntaxKind.JSDocPropertyTag;
}
export interface JSDocParameterTag extends JSDocPropertyLikeTag {
    kind: typeof SyntaxKind.JSDocParameterTag;
}
export interface JSDocTypeLiteral extends JSDocType, Declaration {
    kind: typeof SyntaxKind.JSDocTypeLiteral;
    jsDocPropertyTags?: readonly (JSDocPropertyLikeTag | JSDocThisTag)[];
    /** If true, then this type literal represents an *array* of its type. */
    isArrayType: boolean;
}
export interface JSDocSatisfiesTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocSatisfiesTag;
    typeExpression: JSDocTypeExpression;
}
/** @internal */
export interface JSDocSatisfiesExpression extends ParenthesizedExpression {
}
export interface JSDocImportTag extends JSDocTag {
    kind: typeof SyntaxKind.JSDocImportTag;
    parent: JSDoc;
    importClause?: ImportClause;
    moduleSpecifier: Expression;
    attributes?: ImportAttributes;
}
// NOTE: Ensure this is up-to-date with src/debug/debug.ts
// dprint-ignore
/** @internal */
export type FlowFlags = number;
// NOTE: Ensure this is up-to-date with src/debug/debug.ts
// dprint-ignore
/** @internal */
export const FlowFlags: {
    readonly Unreachable: 1;
    readonly Start: 2;
    readonly BranchLabel: 4;
    readonly LoopLabel: 8;
    readonly Assignment: 16;
    readonly TrueCondition: 32;
    readonly FalseCondition: 64;
    readonly SwitchClause: 128;
    readonly ArrayMutation: 256;
    readonly Call: 512;
    readonly ReduceLabel: 1024;
    readonly Referenced: 2048;
    readonly Shared: 4096;
    readonly Label: 12;
    readonly Condition: 96;
    [index: number]: string;
} = {
    Unreachable: 1,
    "1": "Unreachable",
    Start: 2,
    "2": "Start",
    BranchLabel: 4,
    "4": "BranchLabel",
    LoopLabel: 8,
    "8": "LoopLabel",
    Assignment: 16,
    "16": "Assignment",
    TrueCondition: 32,
    "32": "TrueCondition",
    FalseCondition: 64,
    "64": "FalseCondition",
    SwitchClause: 128,
    "128": "SwitchClause",
    ArrayMutation: 256,
    "256": "ArrayMutation",
    Call: 512,
    "512": "Call",
    ReduceLabel: 1024,
    "1024": "ReduceLabel",
    Referenced: 2048,
    "2048": "Referenced",
    Shared: 4096,
    "4096": "Shared",
    Label: 12,
    "12": "Label",
    Condition: 96,
    "96": "Condition"
};
/** @internal */
export type FlowNode = FlowNodeBase;
/** @internal */
export interface FlowNodeBase {
    flags: FlowFlags;
    id: number; // Node id used by flow type cache in checker
    node: unknown; // Node or other data
    antecedent: FlowNode | FlowNode[] | undefined;
}
/** @internal */
export interface FlowUnreachable extends FlowNodeBase {
    node: undefined;
    antecedent: undefined;
}
// FlowStart represents the start of a control flow. For a function expression or arrow
// function, the node property references the function (which in turn has a flowNode
// property for the containing control flow).
/** @internal */
export interface FlowStart extends FlowNodeBase {
    node: FunctionExpression | ArrowFunction | MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | undefined;
    antecedent: undefined;
}
// FlowLabel represents a junction with multiple possible preceding control flows.
/** @internal */
export interface FlowLabel extends FlowNodeBase {
    node: undefined;
    antecedent: FlowNode[] | undefined;
}
// FlowAssignment represents a node that assigns a value to a narrowable reference,
// i.e. an identifier or a dotted name that starts with an identifier or 'this'.
/** @internal */
export interface FlowAssignment extends FlowNodeBase {
    node: Expression | VariableDeclaration | BindingElement;
    antecedent: FlowNode;
}
/** @internal */
export interface FlowCall extends FlowNodeBase {
    node: CallExpression;
    antecedent: FlowNode;
}
// FlowCondition represents a condition that is known to be true or false at the
// node's location in the control flow.
/** @internal */
export interface FlowCondition extends FlowNodeBase {
    node: Expression;
    antecedent: FlowNode;
}
// dprint-ignore
/** @internal */
export interface FlowSwitchClause extends FlowNodeBase {
    node: FlowSwitchClauseData;
    antecedent: FlowNode;
}
/** @internal */
export interface FlowSwitchClauseData {
    switchStatement: SwitchStatement;
    clauseStart: number; // Start index of case/default clause range
    clauseEnd: number; // End index of case/default clause range
}
// FlowArrayMutation represents a node potentially mutates an array, i.e. an
// operation of the form 'x.push(value)', 'x.unshift(value)' or 'x[n] = value'.
/** @internal */
export interface FlowArrayMutation extends FlowNodeBase {
    node: CallExpression | BinaryExpression;
    antecedent: FlowNode;
}
/** @internal */
export interface FlowReduceLabel extends FlowNodeBase {
    node: FlowReduceLabelData;
    antecedent: FlowNode;
}
/** @internal */
export interface FlowReduceLabelData {
    target: FlowLabel;
    antecedents: FlowNode[];
}
export type FlowType = Type | IncompleteType;
// Incomplete types occur during control flow analysis of loops. An IncompleteType
// is distinguished from a regular type by a flags value of zero. Incomplete type
// objects are internal to the getFlowTypeOfReference function and never escape it.
// dprint-ignore
export interface IncompleteType {
    flags: TypeFlags | 0; // No flags set
    type: Type; // The type marked incomplete
}
export interface AmdDependency {
    path: string;
    name?: string;
}
/**
 * Subset of properties from SourceFile that are used in multiple utility functions
 */
export interface SourceFileLike {
    text: string;
    /** @internal */
    lineMap?: readonly number[];
    /** @internal */
    getPositionOfLineAndCharacter?(line: number, character: number, allowEdits?: true): number;
    languageVariant?: LanguageVariant;
}
/** @internal */
export interface FutureSourceFile {
    path: Path;
    fileName: string;
    impliedNodeFormat?: ResolutionMode;
    packageJsonScope?: PackageJsonInfo;
    externalModuleIndicator?: true | undefined;
    commonJsModuleIndicator?: true | undefined;
    statements: readonly never[];
    imports: readonly never[];
}
/** @internal */
export interface RedirectInfo {
    /** Source file this redirects to. */
    redirectTarget: SourceFile;
    /**
     * Source file for the duplicate package. This will not be used by the Program,
     * but we need to keep this around so we can watch for changes in underlying.
     */
    unredirected: SourceFile;
}
export type ResolutionMode = typeof ModuleKind.ESNext | typeof ModuleKind.CommonJS | undefined;
// Source files are declarations when they are external modules.
export interface SourceFile extends Declaration, LocalsContainer {
    kind: typeof SyntaxKind.SourceFile;
    statements: NodeArray<Statement>;
    endOfFileToken: Token<typeof SyntaxKind.EndOfFileToken>;
    fileName: string;
    /** @internal */ path: Path;
    text: string;
    /** Resolved path can be different from path property,
     * when file is included through project reference is mapped to its output instead of source
     * in that case resolvedPath = path to output file
     * path = input file's path
     *
     * @internal
     */
    resolvedPath: Path;
    /** Original file name that can be different from fileName,
     * when file is included through project reference is mapped to its output instead of source
     * in that case originalFileName = name of input file
     * fileName = output file's name
     *
     * @internal
     */
    originalFileName: string;
    /**
     * If two source files are for the same version of the same package, one will redirect to the other.
     * (See `createRedirectSourceFile` in program.ts.)
     * The redirect will have this set. The redirected-to source file will be in `redirectTargetsMap`.
     *
     * @internal
     */
    redirectInfo?: RedirectInfo;
    amdDependencies: (readonly AmdDependency[]) | undefined;
    moduleName?: string;
    referencedFiles: (readonly FileReference[]) | undefined;
    typeReferenceDirectives: (readonly FileReference[]) | undefined;
    libReferenceDirectives: (readonly FileReference[]) | undefined;
    languageVariant: LanguageVariant;
    isDeclarationFile: boolean;
    // this map is used by transpiler to supply alternative names for dependencies (i.e. in case of bundling)
    /** @internal */
    renamedDependencies?: ReadonlyMap<string, string>;
    /**
     * lib.d.ts should have a reference comment like
     *
     *  /// <reference no-default-lib="true"/>
     *
     * If any other file has this comment, it signals not to include lib.d.ts
     * because this containing file is intended to act as a default library.
     */
    hasNoDefaultLib: boolean | undefined;
    languageVersion: ScriptTarget;
    /**
     * When `module` is `Node16` or `NodeNext`, this field controls whether the
     * source file in question is an ESNext-output-format file, or a CommonJS-output-format
     * module. This is derived by the module resolver as it looks up the file, since
     * it is derived from either the file extension of the module, or the containing
     * `package.json` context, and affects both checking and emit.
     *
     * It is _public_ so that (pre)transformers can set this field,
     * since it switches the builtin `node` module transform. Generally speaking, if unset,
     * the field is treated as though it is `ModuleKind.CommonJS`.
     *
     * Note that this field is only set by the module resolution process when
     * `moduleResolution` is `Node16` or `NodeNext`, which is implied by the `module` setting
     * of `Node16` or `NodeNext`, respectively, but may be overriden (eg, by a `moduleResolution`
     * of `node`). If so, this field will be unset and source files will be considered to be
     * CommonJS-output-format by the node module transformer and type checker, regardless of extension or context.
     */
    impliedNodeFormat?: (ResolutionMode) | undefined;
    /** @internal */ packageJsonLocations?: (readonly string[]) | undefined;
    /** @internal */ packageJsonScope?: (PackageJsonInfo) | undefined;
    /** @internal */ scriptKind: ScriptKind;
    /**
     * The first "most obvious" node that makes a file an external module.
     * This is intended to be the first top-level import/export,
     * but could be arbitrarily nested (e.g. `import.meta`).
     *
     * @internal
     */
    externalModuleIndicator?: (Node | true) | undefined;
    /**
     * The callback used to set the external module indicator - this is saved to
     * be later reused during incremental reparsing, which otherwise lacks the information
     * to set this field
     *
     * @internal
     */
    setExternalModuleIndicator?: ((file: SourceFile) => void) | undefined;
    // The first node that causes this file to be a CommonJS module
    /** @internal */ commonJsModuleIndicator?: Node;
    // JS identifier-declarations that are intended to merge with globals
    /** @internal */ jsGlobalAugmentations?: SymbolTable;
    /** @internal */ identifiers: (ReadonlyMap<string, string>) | undefined; // Map from a string to an interned string
    /** @internal */ nodeCount: number;
    /** @internal */ identifierCount: number;
    /** @internal */ symbolCount: number;
    // File-level diagnostics reported by the parser (includes diagnostics about /// references
    // as well as code diagnostics).
    /** @internal */ parseDiagnostics: (DiagnosticWithLocation[]) | undefined;
    // File-level diagnostics reported by the binder.
    /** @internal */ bindDiagnostics: (DiagnosticWithLocation[]) | undefined;
    /** @internal */ bindSuggestionDiagnostics?: (DiagnosticWithLocation[]) | undefined;
    // File-level JSDoc diagnostics reported by the JSDoc parser
    /** @internal */ jsDocDiagnostics?: DiagnosticWithLocation[];
    // Stores additional file-level diagnostics reported by the program
    /** @internal */ additionalSyntacticDiagnostics?: readonly DiagnosticWithLocation[];
    // Stores a line map for the file.
    // This field should never be used directly to obtain line map, use getLineMap function instead.
    /** @internal */ lineMap: (readonly number[]) | undefined;
    /** @internal */ classifiableNames?: (ReadonlySet<__String>) | undefined;
    // Comments containing @ts-* directives, in order.
    /** @internal */ commentDirectives?: (CommentDirective[]) | undefined;
    /** @internal */ imports: (readonly StringLiteralLike[]) | undefined;
    // Identifier only if `declare global`
    /** @internal */ moduleAugmentations: (readonly (StringLiteral | Identifier)[]) | undefined;
    /** @internal */ patternAmbientModules?: PatternAmbientModule[];
    /** @internal */ ambientModuleNames: (readonly string[]) | undefined;
    /** @internal */ checkJsDirective?: (CheckJsDirective) | undefined;
    /** @internal */ version: string;
    /** @internal */ pragmas: (ReadonlyPragmaMap) | undefined;
    /** @internal */ localJsxNamespace?: __String;
    /** @internal */ localJsxFragmentNamespace?: __String;
    /** @internal */ localJsxFactory?: EntityName;
    /** @internal */ localJsxFragmentFactory?: EntityName;
    /** @internal */ endFlowNode?: (FlowNode) | undefined;
    /** @internal */ jsDocParsingMode?: JSDocParsingMode;
}
/** @internal */
export interface ReadonlyPragmaContext {
    languageVersion: ScriptTarget;
    pragmas?: ReadonlyPragmaMap;
    checkJsDirective?: (CheckJsDirective) | undefined;
    referencedFiles: readonly FileReference[] | undefined;
    typeReferenceDirectives: readonly FileReference[] | undefined;
    libReferenceDirectives: readonly FileReference[] | undefined;
    amdDependencies: readonly AmdDependency[] | undefined;
    hasNoDefaultLib?: boolean;
    moduleName?: string;
}
/** @internal */
export interface PragmaContext extends ReadonlyPragmaContext {
    pragmas?: PragmaMap;
    referencedFiles: FileReference[];
    typeReferenceDirectives: FileReference[];
    libReferenceDirectives: FileReference[];
    amdDependencies: AmdDependency[];
}
/** @internal */
export interface SourceFile extends ReadonlyPragmaContext {
}
/** @internal */
export interface CommentDirective {
    range: TextRange;
    type: CommentDirectiveType;
}
/** @internal */
export type CommentDirectiveType = number;
/** @internal */
export const CommentDirectiveType: {
    readonly ExpectError: 0;
    readonly Ignore: 1;
    [index: number]: string;
} = {
    ExpectError: 0,
    "0": "ExpectError",
    Ignore: 1,
    "1": "Ignore"
};
export interface Bundle extends Node {
    kind: typeof SyntaxKind.Bundle;
    sourceFiles: readonly SourceFile[];
    /** @internal */ syntheticFileReferences?: (readonly FileReference[]) | undefined;
    /** @internal */ syntheticTypeReferences?: (readonly FileReference[]) | undefined;
    /** @internal */ syntheticLibReferences?: (readonly FileReference[]) | undefined;
    /** @internal */ hasNoDefaultLib?: (boolean) | undefined;
}
export interface JsonSourceFile extends SourceFile {
    statements: NodeArray<JsonObjectExpressionStatement>;
}
export interface TsConfigSourceFile extends JsonSourceFile {
    extendedSourceFiles?: string[];
    /** @internal */ configFileSpecs?: ConfigFileSpecs;
}
export interface JsonMinusNumericLiteral extends PrefixUnaryExpression {
    kind: typeof SyntaxKind.PrefixUnaryExpression;
    operator: typeof SyntaxKind.MinusToken;
    operand: NumericLiteral;
}
export type JsonObjectExpression = ObjectLiteralExpression | ArrayLiteralExpression | JsonMinusNumericLiteral | NumericLiteral | StringLiteral | BooleanLiteral | NullLiteral;
export interface JsonObjectExpressionStatement extends ExpressionStatement {
    expression: JsonObjectExpression;
}
export interface ScriptReferenceHost {
    getCompilerOptions(): CompilerOptions;
    getSourceFile(fileName: string): SourceFile | undefined;
    getSourceFileByPath(path: Path): SourceFile | undefined;
    getCurrentDirectory(): string;
}
export interface ParseConfigHost extends ModuleResolutionHost {
    useCaseSensitiveFileNames: boolean;
    readDirectory(rootDir: string, extensions: readonly string[], excludes: readonly string[] | undefined, includes: readonly string[], depth?: number): readonly string[];
    /**
     * Gets a value indicating whether the specified path exists and is a file.
     * @param path The path to test.
     */
    fileExists(path: string): boolean;
    readFile(path: string): string | undefined;
    trace?(s: string): void;
}
/**
 * Branded string for keeping track of when we've turned an ambiguous path
 * specified like "./blah" to an absolute path to an actual
 * tsconfig file, e.g. "/root/blah/tsconfig.json"
 */
export type ResolvedConfigFileName = string;
/** @internal */
export interface ResolvedRefAndOutputDts {
    resolvedRef: ResolvedProjectReference;
    outputDts?: string; // Not set if its a json source file
}
/** @internal */
export interface ResolvedRefAndSource {
    resolvedRef: ResolvedProjectReference;
    source?: string; // Not set if options have --outFile
}
export interface WriteFileCallbackData {
    /** @internal */ sourceMapUrlPos?: number;
    /** @internal */ buildInfo?: BuildInfo;
    /** @internal */ diagnostics?: readonly DiagnosticWithLocation[];
    /** @internal */ differsOnlyInMap?: true;
    /** @internal */ skippedDtsWrite?: true;
}
export type WriteFileCallback = (fileName: string, text: string, writeByteOrderMark: boolean, onError?: (message: string) => void, sourceFiles?: readonly SourceFile[], data?: WriteFileCallbackData) => void;
export class OperationCanceledException {
}
export interface CancellationToken {
    isCancellationRequested(): boolean;
    /** @throws OperationCanceledException if isCancellationRequested is true */
    throwIfCancellationRequested(): void;
}
/** @internal */
export type FileIncludeKind = number;
/** @internal */
export const FileIncludeKind: {
    readonly RootFile: 0;
    readonly SourceFromProjectReference: 1;
    readonly OutputFromProjectReference: 2;
    readonly Import: 3;
    readonly ReferenceFile: 4;
    readonly TypeReferenceDirective: 5;
    readonly LibFile: 6;
    readonly LibReferenceDirective: 7;
    readonly AutomaticTypeDirectiveFile: 8;
    [index: number]: string;
} = {
    RootFile: 0,
    "0": "RootFile",
    SourceFromProjectReference: 1,
    "1": "SourceFromProjectReference",
    OutputFromProjectReference: 2,
    "2": "OutputFromProjectReference",
    Import: 3,
    "3": "Import",
    ReferenceFile: 4,
    "4": "ReferenceFile",
    TypeReferenceDirective: 5,
    "5": "TypeReferenceDirective",
    LibFile: 6,
    "6": "LibFile",
    LibReferenceDirective: 7,
    "7": "LibReferenceDirective",
    AutomaticTypeDirectiveFile: 8,
    "8": "AutomaticTypeDirectiveFile"
};
/** @internal */
export interface RootFile {
    kind: typeof FileIncludeKind.RootFile;
    index: number;
}
/** @internal */
export interface LibFile {
    kind: typeof FileIncludeKind.LibFile;
    index?: number;
}
/** @internal */
export type ProjectReferenceFileKind = typeof FileIncludeKind.SourceFromProjectReference | typeof FileIncludeKind.OutputFromProjectReference;
/** @internal */
export interface ProjectReferenceFile {
    kind: ProjectReferenceFileKind;
    index: number;
}
/** @internal */
export type ReferencedFileKind = typeof FileIncludeKind.Import | typeof FileIncludeKind.ReferenceFile | typeof FileIncludeKind.TypeReferenceDirective | typeof FileIncludeKind.LibReferenceDirective;
/** @internal */
export interface ReferencedFile {
    kind: ReferencedFileKind;
    file: Path;
    index: number;
}
/** @internal */
export interface AutomaticTypeDirectiveFile {
    kind: typeof FileIncludeKind.AutomaticTypeDirectiveFile;
    typeReference: string;
    packageId: PackageId | undefined;
}
/** @internal */
export type FileIncludeReason = RootFile | LibFile | ProjectReferenceFile | ReferencedFile | AutomaticTypeDirectiveFile;
/** @internal */
export type FilePreprocessingDiagnosticsKind = number;
/** @internal */
export const FilePreprocessingDiagnosticsKind: {
    readonly FilePreprocessingLibReferenceDiagnostic: 0;
    readonly FilePreprocessingFileExplainingDiagnostic: 1;
    readonly ResolutionDiagnostics: 2;
    [index: number]: string;
} = {
    FilePreprocessingLibReferenceDiagnostic: 0,
    "0": "FilePreprocessingLibReferenceDiagnostic",
    FilePreprocessingFileExplainingDiagnostic: 1,
    "1": "FilePreprocessingFileExplainingDiagnostic",
    ResolutionDiagnostics: 2,
    "2": "ResolutionDiagnostics"
};
/** @internal */
export interface FilePreprocessingLibReferenceDiagnostic {
    kind: typeof FilePreprocessingDiagnosticsKind.FilePreprocessingLibReferenceDiagnostic;
    reason: ReferencedFile & {
        kind: typeof FileIncludeKind.LibReferenceDirective;
    };
}
/** @internal */
export interface FilePreprocessingFileExplainingDiagnostic {
    kind: typeof FilePreprocessingDiagnosticsKind.FilePreprocessingFileExplainingDiagnostic;
    file: Path | undefined;
    fileProcessingReason: FileIncludeReason;
    diagnostic: DiagnosticMessage;
    args: DiagnosticArguments;
}
/** @internal */
export interface ResolutionDiagnostics {
    kind: typeof FilePreprocessingDiagnosticsKind.ResolutionDiagnostics;
    diagnostics: readonly Diagnostic[];
}
/** @internal */
export type FilePreprocessingDiagnostics = FilePreprocessingLibReferenceDiagnostic | FilePreprocessingFileExplainingDiagnostic | ResolutionDiagnostics;
/** @internal */
export type EmitOnly = number;
/** @internal */
export const EmitOnly: {
    readonly Js: 0;
    readonly Dts: 1;
    readonly BuilderSignature: 2;
    [index: number]: string;
} = {
    Js: 0,
    "0": "Js",
    Dts: 1,
    "1": "Dts",
    BuilderSignature: 2,
    "2": "BuilderSignature"
};
/** @internal */
export interface LibResolution<T extends ResolvedModuleWithFailedLookupLocations = ResolvedModuleWithFailedLookupLocations> {
    resolution: T;
    actual: string;
}
export interface Program extends ScriptReferenceHost {
    getCurrentDirectory(): string;
    /**
     * Get a list of root file names that were passed to a 'createProgram'
     */
    getRootFileNames(): readonly string[];
    /**
     * Get a list of files in the program
     */
    getSourceFiles(): readonly SourceFile[];
    /**
     * Get a list of file names that were passed to 'createProgram' or referenced in a
     * program source file but could not be located.
     *
     * @internal
     */
    getMissingFilePaths(): Map<Path, string>;
    /** @internal */
    getModuleResolutionCache(): ModuleResolutionCache | undefined;
    /** @internal */
    getFilesByNameMap(): Map<Path, SourceFile | false | undefined>;
    /** @internal */
    resolvedModules: Map<Path, ModeAwareCache<ResolvedModuleWithFailedLookupLocations>> | undefined;
    /** @internal */
    resolvedTypeReferenceDirectiveNames: Map<Path, ModeAwareCache<ResolvedTypeReferenceDirectiveWithFailedLookupLocations>> | undefined;
    /** @internal */
    getResolvedModule(f: SourceFile, moduleName: string, mode: ResolutionMode): ResolvedModuleWithFailedLookupLocations | undefined;
    /** @internal */
    getResolvedModuleFromModuleSpecifier(moduleSpecifier: StringLiteralLike, sourceFile?: SourceFile): ResolvedModuleWithFailedLookupLocations | undefined;
    /** @internal */
    getResolvedTypeReferenceDirective(f: SourceFile, typeDirectiveName: string, mode: ResolutionMode): ResolvedTypeReferenceDirectiveWithFailedLookupLocations | undefined;
    /** @internal */
    getResolvedTypeReferenceDirectiveFromTypeReferenceDirective(typedRef: FileReference, sourceFile: SourceFile): ResolvedTypeReferenceDirectiveWithFailedLookupLocations | undefined;
    /** @internal */
    forEachResolvedModule(callback: (resolution: ResolvedModuleWithFailedLookupLocations, moduleName: string, mode: ResolutionMode, filePath: Path) => void, file?: SourceFile): void;
    /** @internal */
    forEachResolvedTypeReferenceDirective(callback: (resolution: ResolvedTypeReferenceDirectiveWithFailedLookupLocations, moduleName: string, mode: ResolutionMode, filePath: Path) => void, file?: SourceFile): void;
    /**
     * Emits the JavaScript and declaration files.  If targetSourceFile is not specified, then
     * the JavaScript and declaration files will be produced for all the files in this program.
     * If targetSourceFile is specified, then only the JavaScript and declaration for that
     * specific file will be generated.
     *
     * If writeFile is not specified then the writeFile callback from the compiler host will be
     * used for writing the JavaScript and declaration files.  Otherwise, the writeFile parameter
     * will be invoked when writing the JavaScript and declaration files.
     */
    emit(targetSourceFile?: SourceFile, writeFile?: WriteFileCallback, cancellationToken?: CancellationToken, emitOnlyDtsFiles?: boolean, customTransformers?: CustomTransformers): EmitResult;
    /** @internal */
    emit(targetSourceFile?: SourceFile, writeFile?: WriteFileCallback, cancellationToken?: CancellationToken, emitOnly?: boolean | EmitOnly, customTransformers?: CustomTransformers, forceDtsEmit?: boolean, skipBuildInfo?: boolean): EmitResult;
    getOptionsDiagnostics(cancellationToken?: CancellationToken): readonly Diagnostic[];
    getGlobalDiagnostics(cancellationToken?: CancellationToken): readonly Diagnostic[];
    getSyntacticDiagnostics(sourceFile?: SourceFile, cancellationToken?: CancellationToken): readonly DiagnosticWithLocation[];
    /** The first time this is called, it will return global diagnostics (no location). */
    getSemanticDiagnostics(sourceFile?: SourceFile, cancellationToken?: CancellationToken): readonly Diagnostic[];
    /** @internal */
    getSemanticDiagnostics(sourceFile: SourceFile | undefined, cancellationToken: CancellationToken | undefined, nodesToCheck: Node[]): readonly Diagnostic[];
    getDeclarationDiagnostics(sourceFile?: SourceFile, cancellationToken?: CancellationToken): readonly DiagnosticWithLocation[];
    getConfigFileParsingDiagnostics(): readonly Diagnostic[];
    /** @internal */ getSuggestionDiagnostics(sourceFile: SourceFile, cancellationToken?: CancellationToken): readonly DiagnosticWithLocation[];
    /** @internal */ getBindAndCheckDiagnostics(sourceFile: SourceFile, cancellationToken?: CancellationToken): readonly Diagnostic[];
    /** @internal */ getProgramDiagnostics(sourceFile: SourceFile, cancellationToken?: CancellationToken): readonly Diagnostic[];
    /**
     * Gets a type checker that can be used to semantically analyze source files in the program.
     */
    getTypeChecker(): TypeChecker;
    /** @internal */ getCommonSourceDirectory(): string;
    /** @internal */ getCachedSemanticDiagnostics(sourceFile: SourceFile): readonly Diagnostic[] | undefined;
    /** @internal */ getClassifiableNames(): Set<__String>;
    getNodeCount(): number;
    getIdentifierCount(): number;
    getSymbolCount(): number;
    getTypeCount(): number;
    getInstantiationCount(): number;
    getRelationCacheSizes(): {
        assignable: number;
        identity: number;
        subtype: number;
        strictSubtype: number;
    };
    /** @internal */ getFileProcessingDiagnostics(): FilePreprocessingDiagnostics[] | undefined;
    /** @internal */ getAutomaticTypeDirectiveNames(): string[];
    /** @internal */ getAutomaticTypeDirectiveResolutions(): ModeAwareCache<ResolvedTypeReferenceDirectiveWithFailedLookupLocations>;
    isSourceFileFromExternalLibrary(file: SourceFile): boolean;
    isSourceFileDefaultLibrary(file: SourceFile): boolean;
    /**
     * Calculates the final resolution mode for a given module reference node. This function only returns a result when module resolution
     * settings allow differing resolution between ESM imports and CJS requires, or when a mode is explicitly provided via import attributes,
     * which cause an `import` or `require` condition to be used during resolution regardless of module resolution settings. In absence of
     * overriding attributes, and in modes that support differing resolution, the result indicates the syntax the usage would emit to JavaScript.
     * Some examples:
     *
     * ```ts
     * // tsc foo.mts --module nodenext
     * import {} from "mod";
     * // Result: ESNext - the import emits as ESM due to `impliedNodeFormat` set by .mts file extension
     *
     * // tsc foo.cts --module nodenext
     * import {} from "mod";
     * // Result: CommonJS - the import emits as CJS due to `impliedNodeFormat` set by .cts file extension
     *
     * // tsc foo.ts --module preserve --moduleResolution bundler
     * import {} from "mod";
     * // Result: ESNext - the import emits as ESM due to `--module preserve` and `--moduleResolution bundler`
     * // supports conditional imports/exports
     *
     * // tsc foo.ts --module preserve --moduleResolution node10
     * import {} from "mod";
     * // Result: undefined - the import emits as ESM due to `--module preserve`, but `--moduleResolution node10`
     * // does not support conditional imports/exports
     *
     * // tsc foo.ts --module commonjs --moduleResolution node10
     * import type {} from "mod" with { "resolution-mode": "import" };
     * // Result: ESNext - conditional imports/exports always supported with "resolution-mode" attribute
     * ```
     */
    getModeForUsageLocation(file: SourceFile, usage: StringLiteralLike): ResolutionMode;
    /**
     * Calculates the final resolution mode for an import at some index within a file's `imports` list. This function only returns a result
     * when module resolution settings allow differing resolution between ESM imports and CJS requires, or when a mode is explicitly provided
     * via import attributes, which cause an `import` or `require` condition to be used during resolution regardless of module resolution
     * settings. In absence of overriding attributes, and in modes that support differing resolution, the result indicates the syntax the
     * usage would emit to JavaScript. Some examples:
     *
     * ```ts
     * // tsc foo.mts --module nodenext
     * import {} from "mod";
     * // Result: ESNext - the import emits as ESM due to `impliedNodeFormat` set by .mts file extension
     *
     * // tsc foo.cts --module nodenext
     * import {} from "mod";
     * // Result: CommonJS - the import emits as CJS due to `impliedNodeFormat` set by .cts file extension
     *
     * // tsc foo.ts --module preserve --moduleResolution bundler
     * import {} from "mod";
     * // Result: ESNext - the import emits as ESM due to `--module preserve` and `--moduleResolution bundler`
     * // supports conditional imports/exports
     *
     * // tsc foo.ts --module preserve --moduleResolution node10
     * import {} from "mod";
     * // Result: undefined - the import emits as ESM due to `--module preserve`, but `--moduleResolution node10`
     * // does not support conditional imports/exports
     *
     * // tsc foo.ts --module commonjs --moduleResolution node10
     * import type {} from "mod" with { "resolution-mode": "import" };
     * // Result: ESNext - conditional imports/exports always supported with "resolution-mode" attribute
     * ```
     */
    getModeForResolutionAtIndex(file: SourceFile, index: number): ResolutionMode;
    /**
     * @internal
     * The resolution mode to use for module resolution or module specifier resolution
     * outside the context of an existing module reference, where
     * `program.getModeForUsageLocation` should be used instead.
     */
    getDefaultResolutionModeForFile(sourceFile: SourceFile): ResolutionMode;
    /** @internal */ getImpliedNodeFormatForEmit(sourceFile: SourceFile): ResolutionMode;
    /** @internal */ getEmitModuleFormatOfFile(sourceFile: SourceFile): ModuleKind;
    /** @internal */ shouldTransformImportCall(sourceFile: SourceFile): boolean;
    // For testing purposes only.
    // This is set on created program to let us know how the program was created using old program
    /** @internal */ structureIsReused: StructureIsReused;
    /** @internal */ getSourceFileFromReference(referencingFile: SourceFile, ref: FileReference): SourceFile | undefined;
    /** @internal */ getLibFileFromReference(ref: FileReference): SourceFile | undefined;
    /**
     * Given a source file, get the name of the package it was imported from.
     *
     * @internal
     */
    sourceFileToPackageName: Map<Path, string>;
    /**
     * Set of all source files that some other source file redirects to.
     *
     * @internal
     */
    redirectTargetsMap: MultiMap<Path, string>;
    /**
     * Whether any (non-external, non-declaration) source files use `node:`-prefixed module specifiers
     * (except for those that are not available without the prefix).
     * `false` indicates that an unprefixed builtin module was seen; `undefined` indicates that no
     * builtin modules (or only modules exclusively available with the prefix) were seen.
     *
     * @internal
     */
    usesUriStyleNodeCoreModules: boolean | undefined;
    /**
     * Map from libFileName to actual resolved location of the lib
     * @internal
     */
    resolvedLibReferences: Map<string, LibResolution> | undefined;
    /** @internal */ getProgramDiagnosticsContainer: () => ProgramDiagnostics;
    /** @internal */ getCurrentPackagesMap(): Map<string, boolean> | undefined;
    /**
     * Is the file emitted file
     *
     * @internal
     */
    isEmittedFile(file: string): boolean;
    /** @internal */ getFileIncludeReasons(): MultiMap<Path, FileIncludeReason>;
    /** @internal */ useCaseSensitiveFileNames(): boolean;
    /** @internal */ getCanonicalFileName: GetCanonicalFileName;
    getProjectReferences(): readonly ProjectReference[] | undefined;
    getResolvedProjectReferences(): readonly (ResolvedProjectReference | undefined)[] | undefined;
    /**
     * @internal
     * Get the referenced project if the file is input file from that reference project
     */
    getRedirectFromSourceFile(fileName: string): ResolvedRefAndOutputDts | undefined;
    /** @internal */ forEachResolvedProjectReference<T>(cb: (resolvedProjectReference: ResolvedProjectReference) => T | undefined): T | undefined;
    /** @internal */ getResolvedProjectReferenceByPath(projectReferencePath: Path): ResolvedProjectReference | undefined;
    /** @internal */ getRedirectFromOutput(filePath: Path): ResolvedRefAndSource | undefined;
    /** @internal */ isSourceOfProjectReferenceRedirect(fileName: string): boolean;
    /** @internal */ getCompilerOptionsForFile(file: SourceFile): CompilerOptions;
    /** @internal */ getBuildInfo?(): BuildInfo;
    /** @internal */ emitBuildInfo(writeFile?: WriteFileCallback, cancellationToken?: CancellationToken): EmitResult;
    /**
     * This implementation handles file exists to be true if file is source of project reference redirect when program is created using useSourceOfProjectReferenceRedirect
     *
     * @internal
     */
    fileExists(fileName: string): boolean;
    /**
     * Call compilerHost.writeFile on host program was created with
     *
     * @internal
     */
    writeFile: WriteFileCallback;
}
/** @internal */
export interface Program extends TypeCheckerHost, ModuleSpecifierResolutionHost {
}
/** @internal */
export type RedirectTargetsMap = ReadonlyMap<Path, readonly string[]>;
export interface ResolvedProjectReference {
    commandLine: ParsedCommandLine;
    sourceFile: SourceFile;
    references?: readonly (ResolvedProjectReference | undefined)[];
}
/** @internal */
export type StructureIsReused = number;
/** @internal */
export const StructureIsReused: {
    readonly Not: 0;
    readonly SafeModules: 1;
    readonly Completely: 2;
    [index: number]: string;
} = {
    Not: 0,
    "0": "Not",
    SafeModules: 1,
    "1": "SafeModules",
    Completely: 2,
    "2": "Completely"
};
export type CustomTransformerFactory = (context: TransformationContext) => CustomTransformer;
export interface CustomTransformer {
    transformSourceFile(node: SourceFile): SourceFile;
    transformBundle(node: Bundle): Bundle;
}
export interface CustomTransformers {
    /** Custom transformers to evaluate before built-in .js transformations. */
    before?: (TransformerFactory<SourceFile> | CustomTransformerFactory)[];
    /** Custom transformers to evaluate after built-in .js transformations. */
    after?: (TransformerFactory<SourceFile> | CustomTransformerFactory)[];
    /** Custom transformers to evaluate after built-in .d.ts transformations. */
    afterDeclarations?: (TransformerFactory<Bundle | SourceFile> | CustomTransformerFactory)[];
}
/** @internal */
export interface EmitTransformers {
    scriptTransformers: readonly TransformerFactory<SourceFile | Bundle>[];
    declarationTransformers: readonly TransformerFactory<SourceFile | Bundle>[];
}
export interface SourceMapSpan {
    /** Line number in the .js file. */
    emittedLine: number;
    /** Column number in the .js file. */
    emittedColumn: number;
    /** Line number in the .ts file. */
    sourceLine: number;
    /** Column number in the .ts file. */
    sourceColumn: number;
    /** Optional name (index into names array) associated with this span. */
    nameIndex?: number;
    /** .ts file (index into sources array) associated with this span */
    sourceIndex: number;
}
/** @internal */
export interface SourceMapEmitResult {
    inputSourceFileNames: readonly string[]; // Input source file (which one can use on program to get the file), 1:1 mapping with the sourceMap.sources list
    sourceMap: RawSourceMap;
}
/** Return code used by getEmitOutput function to indicate status of the function */
export type ExitStatus = number;
/** Return code used by getEmitOutput function to indicate status of the function */
export const ExitStatus: {
    readonly Success: 0;
    readonly DiagnosticsPresent_OutputsSkipped: 1;
    readonly DiagnosticsPresent_OutputsGenerated: 2;
    readonly InvalidProject_OutputsSkipped: 3;
    readonly ProjectReferenceCycle_OutputsSkipped: 4;
    [index: number]: string;
} = {
    Success: 0,
    "0": "Success",
    DiagnosticsPresent_OutputsSkipped: 1,
    "1": "DiagnosticsPresent_OutputsSkipped",
    DiagnosticsPresent_OutputsGenerated: 2,
    "2": "DiagnosticsPresent_OutputsGenerated",
    InvalidProject_OutputsSkipped: 3,
    "3": "InvalidProject_OutputsSkipped",
    ProjectReferenceCycle_OutputsSkipped: 4,
    "4": "ProjectReferenceCycle_OutputsSkipped"
};
export interface EmitResult {
    emitSkipped: boolean;
    /** Contains declaration emit diagnostics */
    diagnostics: readonly Diagnostic[];
    emittedFiles?: string[]; // Array of files the compiler wrote to disk
    /** @internal */ sourceMaps?: SourceMapEmitResult[]; // Array of sourceMapData if compiler emitted sourcemaps
}
/** @internal */
export interface TypeCheckerHost extends ModuleSpecifierResolutionHost, SourceFileMayBeEmittedHost {
    getCompilerOptions(): CompilerOptions;
    getSourceFiles(): readonly SourceFile[];
    getSourceFile(fileName: string): SourceFile | undefined;
    getRedirectFromSourceFile(fileName: string): ResolvedRefAndOutputDts | undefined;
    isSourceOfProjectReferenceRedirect(fileName: string): boolean;
    getEmitSyntaxForUsageLocation(file: SourceFile, usage: StringLiteralLike): ResolutionMode;
    getRedirectFromOutput(filePath: Path): ResolvedRefAndSource | undefined;
    getModeForUsageLocation(file: SourceFile, usage: StringLiteralLike): ResolutionMode;
    getDefaultResolutionModeForFile(sourceFile: SourceFile): ResolutionMode;
    getImpliedNodeFormatForEmit(sourceFile: SourceFile): ResolutionMode;
    getEmitModuleFormatOfFile(sourceFile: SourceFile): ModuleKind;
    getResolvedModule(f: SourceFile, moduleName: string, mode: ResolutionMode): ResolvedModuleWithFailedLookupLocations | undefined;
    redirectTargetsMap: RedirectTargetsMap;
    typesPackageExists(packageName: string): boolean;
    packageBundlesTypes(packageName: string): boolean;
    isSourceFileDefaultLibrary(file: SourceFile): boolean;
}
/** @internal */
export interface WriterContextOut {
    /** Whether increasing the expansion depth will cause us to expand more types. */
    canIncreaseExpansionDepth: boolean;
    truncated: boolean;
}
export interface TypeChecker {
    getTypeOfSymbolAtLocation(symbol: Symbol, node: Node): Type;
    getTypeOfSymbol(symbol: Symbol): Type;
    getDeclaredTypeOfSymbol(symbol: Symbol): Type;
    getPropertiesOfType(type: Type): Symbol[];
    getPropertyOfType(type: Type, propertyName: string): Symbol | undefined;
    getPrivateIdentifierPropertyOfType(leftType: Type, name: string, location: Node): Symbol | undefined;
    /** @internal */ getTypeOfPropertyOfType(type: Type, propertyName: string): Type | undefined;
    getIndexInfoOfType(type: Type, kind: IndexKind): IndexInfo | undefined;
    getIndexInfosOfType(type: Type): readonly IndexInfo[];
    getIndexInfosOfIndexSymbol: (indexSymbol: Symbol, siblingSymbols?: Symbol[] | undefined) => IndexInfo[];
    getSignaturesOfType(type: Type, kind: SignatureKind): readonly Signature[];
    getIndexTypeOfType(type: Type, kind: IndexKind): Type | undefined;
    /** @internal */ getIndexType(type: Type): Type;
    getBaseTypes(type: InterfaceType): BaseType[];
    getBaseTypeOfLiteralType(type: Type): Type;
    getWidenedType(type: Type): Type;
    /** @internal */
    getWidenedLiteralType(type: Type): Type;
    /** @internal */
    getPromisedTypeOfPromise(promise: Type, errorNode?: Node): Type | undefined;
    /**
     * Gets the "awaited type" of a type.
     *
     * If an expression has a Promise-like type, the "awaited type" of the expression is
     * derived from the type of the first argument of the fulfillment callback for that
     * Promise's `then` method. If the "awaited type" is itself a Promise-like, it is
     * recursively unwrapped in the same manner until a non-promise type is found.
     *
     * If an expression does not have a Promise-like type, its "awaited type" is the type
     * of the expression.
     *
     * If the resulting "awaited type" is a generic object type, then it is wrapped in
     * an `Awaited<T>`.
     *
     * In the event the "awaited type" circularly references itself, or is a non-Promise
     * object-type with a callable `then()` method, an "awaited type" cannot be determined
     * and the value `undefined` will be returned.
     *
     * This is used to reflect the runtime behavior of the `await` keyword.
     */
    getAwaitedType(type: Type): Type | undefined;
    /** @internal */
    isEmptyAnonymousObjectType(type: Type): boolean;
    getReturnTypeOfSignature(signature: Signature): Type;
    /**
     * Gets the type of a parameter at a given position in a signature.
     * Returns `any` if the index is not valid.
     *
     * @internal
     */
    getParameterType(signature: Signature, parameterIndex: number): Type;
    /** @internal */ getParameterIdentifierInfoAtPosition(signature: Signature, parameterIndex: number): {
        parameter: Identifier;
        parameterName: __String;
        isRestParameter: boolean;
    } | undefined;
    getNullableType(type: Type, flags: TypeFlags): Type;
    getNonNullableType(type: Type): Type;
    /** @internal */ getNonOptionalType(type: Type): Type;
    /** @internal */ isNullableType(type: Type): boolean;
    getTypeArguments(type: TypeReference): readonly Type[];
    // TODO: GH#18217 `xToDeclaration` calls are frequently asserted as defined.
    /** Note that the resulting nodes cannot be checked. */
    typeToTypeNode(type: Type, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): TypeNode | undefined;
    /** @internal */ typeToTypeNode(type: Type, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined, internalFlags?: InternalNodeBuilderFlags | undefined, tracker?: SymbolTracker): TypeNode | undefined; // eslint-disable-line @typescript-eslint/unified-signatures
    /** @internal */ typePredicateToTypePredicateNode(typePredicate: TypePredicate, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined, internalFlags?: InternalNodeBuilderFlags | undefined, tracker?: SymbolTracker): TypePredicateNode | undefined;
    /** Note that the resulting nodes cannot be checked. */
    signatureToSignatureDeclaration(signature: Signature, kind: SyntaxKind, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): SignatureDeclaration & {
        typeArguments?: NodeArray<TypeNode>;
    } | undefined;
    /** @internal */ signatureToSignatureDeclaration(signature: Signature, kind: SyntaxKind, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined, internalFlags?: InternalNodeBuilderFlags | undefined, tracker?: SymbolTracker): SignatureDeclaration & {
        typeArguments?: NodeArray<TypeNode>;
    } | undefined; // eslint-disable-line @typescript-eslint/unified-signatures
    /** Note that the resulting nodes cannot be checked. */
    indexInfoToIndexSignatureDeclaration(indexInfo: IndexInfo, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): IndexSignatureDeclaration | undefined;
    /** @internal */ indexInfoToIndexSignatureDeclaration(indexInfo: IndexInfo, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined, internalFlags?: InternalNodeBuilderFlags | undefined, tracker?: SymbolTracker): IndexSignatureDeclaration | undefined; // eslint-disable-line @typescript-eslint/unified-signatures
    /** Note that the resulting nodes cannot be checked. */
    symbolToEntityName(symbol: Symbol, meaning: SymbolFlags | undefined, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): EntityName | undefined;
    /** Note that the resulting nodes cannot be checked. */
    symbolToExpression(symbol: Symbol, meaning: SymbolFlags | undefined, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): Expression | undefined;
    /**
     * Note that the resulting nodes cannot be checked.
     *
     * @internal
     */
    symbolToNode(symbol: Symbol, meaning: SymbolFlags | undefined, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined, internalFlags: InternalNodeBuilderFlags | undefined): Node | undefined;
    /** Note that the resulting nodes cannot be checked. */
    symbolToTypeParameterDeclarations(symbol: Symbol, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): NodeArray<TypeParameterDeclaration> | undefined;
    /** Note that the resulting nodes cannot be checked. */
    symbolToParameterDeclaration(symbol: Symbol, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): ParameterDeclaration | undefined;
    /** Note that the resulting nodes cannot be checked. */
    typeParameterToDeclaration(parameter: TypeParameter, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined): TypeParameterDeclaration | undefined;
    /** @internal */ typeParameterToDeclaration(parameter: TypeParameter, enclosingDeclaration: Node | undefined, flags: NodeBuilderFlags | undefined, internalFlags?: InternalNodeBuilderFlags, tracker?: SymbolTracker, maximumLength?: number, verbosityLevel?: number, out?: WriterContextOut): TypeParameterDeclaration | undefined;
    getSymbolsInScope(location: Node, meaning: SymbolFlags | undefined): Symbol[];
    getSymbolAtLocation(node: Node): Symbol | undefined;
    /** @internal */ getIndexInfosAtLocation(node: Node): readonly IndexInfo[] | undefined;
    getSymbolsOfParameterPropertyDeclaration(parameter: ParameterDeclaration, parameterName: string): Symbol[];
    /**
     * The function returns the value (local variable) symbol of an identifier in the short-hand property assignment.
     * This is necessary as an identifier in short-hand property assignment can contains two meaning: property name and property value.
     */
    getShorthandAssignmentValueSymbol(location: Node | undefined): Symbol | undefined;
    getExportSpecifierLocalTargetSymbol(location: ExportSpecifier | Identifier): Symbol | undefined;
    /**
     * If a symbol is a local symbol with an associated exported symbol, returns the exported symbol.
     * Otherwise returns its input.
     * For example, at `export type T = number;`:
     *     - `getSymbolAtLocation` at the location `T` will return the exported symbol for `T`.
     *     - But the result of `getSymbolsInScope` will contain the *local* symbol for `T`, not the exported symbol.
     *     - Calling `getExportSymbolOfSymbol` on that local symbol will return the exported symbol.
     */
    getExportSymbolOfSymbol(symbol: Symbol): Symbol;
    getPropertySymbolOfDestructuringAssignment(location: Identifier): Symbol | undefined;
    getTypeOfAssignmentPattern(pattern: AssignmentPattern): Type;
    getTypeAtLocation(node: Node): Type;
    getTypeFromTypeNode(node: TypeNode): Type;
    signatureToString(signature: Signature, enclosingDeclaration?: Node, flags?: TypeFormatFlags, kind?: SignatureKind): string;
    typeToString(type: Type, enclosingDeclaration?: Node, flags?: TypeFormatFlags): string;
    symbolToString(symbol: Symbol, enclosingDeclaration?: Node, meaning?: SymbolFlags | undefined, flags?: SymbolFormatFlags): string;
    typePredicateToString(predicate: TypePredicate, enclosingDeclaration?: Node, flags?: TypeFormatFlags): string;
    /** @internal */ writeSignature(signature: Signature, enclosingDeclaration?: Node, flags?: TypeFormatFlags, kind?: SignatureKind, writer?: EmitTextWriter, maximumLength?: number, verbosityLevel?: number, out?: WriterContextOut): string;
    /** @internal */ writeType(type: Type, enclosingDeclaration?: Node, flags?: TypeFormatFlags, writer?: EmitTextWriter, maximumLength?: number, verbosityLevel?: number, out?: WriterContextOut): string;
    /** @internal */ writeSymbol(symbol: Symbol, enclosingDeclaration?: Node, meaning?: SymbolFlags | undefined, flags?: SymbolFormatFlags, writer?: EmitTextWriter): string;
    /** @internal */ writeTypePredicate(predicate: TypePredicate, enclosingDeclaration?: Node, flags?: TypeFormatFlags, writer?: EmitTextWriter): string;
    getFullyQualifiedName(symbol: Symbol): string;
    getAugmentedPropertiesOfType(type: Type): Symbol[];
    getRootSymbols(symbol: Symbol): readonly Symbol[];
    getSymbolOfExpando(node: Node, allowDeclaration: boolean): Symbol | undefined;
    getContextualType(node: Expression): Type | undefined;
    /** @internal */ getContextualType(node: Expression, contextFlags?: ContextFlags): Type | undefined; // eslint-disable-line @typescript-eslint/unified-signatures
    /** @internal */ getContextualTypeForObjectLiteralElement(element: ObjectLiteralElementLike): Type | undefined;
    /** @internal */ getContextualTypeForArgumentAtIndex(call: CallLikeExpression, argIndex: number): Type | undefined;
    /** @internal */ getContextualTypeForJsxAttribute(attribute: JsxAttribute | JsxSpreadAttribute): Type | undefined;
    /** @internal */ isContextSensitive(node: Expression | MethodDeclaration | ObjectLiteralElementLike | JsxAttributeLike): boolean;
    /** @internal */ getTypeOfPropertyOfContextualType(type: Type, name: __String): Type | undefined;
    /**
     * returns unknownSignature in the case of an error.
     * returns undefined if the node is not valid.
     * @param argumentCount Apparent number of arguments, passed in case of a possibly incomplete call. This should come from an ArgumentListInfo. See `signatureHelp.ts`.
     */
    getResolvedSignature(node: CallLikeExpression, candidatesOutArray?: Signature[], argumentCount?: number): Signature | undefined;
    /** @internal */ getResolvedSignatureForSignatureHelp(node: CallLikeExpression, candidatesOutArray?: Signature[], argumentCount?: number): Signature | undefined;
    /** @internal */ getCandidateSignaturesForStringLiteralCompletions(call: CallLikeExpression, editingArgument: Node): Signature[];
    /** @internal */ getExpandedParameters(sig: Signature): readonly (readonly Symbol[])[];
    /** @internal */ hasEffectiveRestParameter(sig: Signature): boolean;
    /** @internal */ containsArgumentsReference(declaration: SignatureDeclaration): boolean;
    getSignatureFromDeclaration(declaration: SignatureDeclaration): Signature | undefined;
    isImplementationOfOverload(node: SignatureDeclaration): boolean | undefined;
    isUndefinedSymbol(symbol: Symbol): boolean;
    isArgumentsSymbol(symbol: Symbol): boolean;
    isUnknownSymbol(symbol: Symbol): boolean;
    getMergedSymbol(symbol: Symbol): Symbol;
    /** @internal */ symbolIsValue(symbol: Symbol, includeTypeOnlyMembers?: boolean): boolean;
    getConstantValue(node: EnumMember | PropertyAccessExpression | ElementAccessExpression): string | number | undefined;
    isValidPropertyAccess(node: PropertyAccessExpression | QualifiedName | ImportTypeNode, propertyName: string): boolean;
    /**
     * Exclude accesses to private properties.
     *
     * @internal
     */
    isValidPropertyAccessForCompletions(node: PropertyAccessExpression | ImportTypeNode | QualifiedName, type: Type, property: Symbol): boolean;
    /** Follow all aliases to get the original symbol. */
    getAliasedSymbol(symbol: Symbol): Symbol;
    /** Follow a *single* alias to get the immediately aliased symbol. */
    getImmediateAliasedSymbol(symbol: Symbol): Symbol | undefined;
    getExportsOfModule(moduleSymbol: Symbol): Symbol[];
    /**
     * Unlike `getExportsOfModule`, this includes properties of an `export =` value.
     *
     * @internal
     */
    getExportsAndPropertiesOfModule(moduleSymbol: Symbol): Symbol[];
    /** @internal */ forEachExportAndPropertyOfModule(moduleSymbol: Symbol, cb: (symbol: Symbol, key: __String) => void): void;
    getJsxIntrinsicTagNamesAt(location: Node): Symbol[];
    isOptionalParameter(node: ParameterDeclaration): boolean;
    getAmbientModules(): Symbol[];
    tryGetMemberInModuleExports(memberName: string, moduleSymbol: Symbol): Symbol | undefined;
    /**
     * Unlike `tryGetMemberInModuleExports`, this includes properties of an `export =` value.
     * Does *not* return properties of primitive types.
     *
     * @internal
     */
    tryGetMemberInModuleExportsAndProperties(memberName: string, moduleSymbol: Symbol): Symbol | undefined;
    getApparentType(type: Type): Type;
    /** @internal */ getSuggestedSymbolForNonexistentProperty(name: MemberName | string, containingType: Type): Symbol | undefined;
    /** @internal */ getSuggestedSymbolForNonexistentJSXAttribute(name: Identifier | string, containingType: Type): Symbol | undefined;
    /** @internal */ getSuggestedSymbolForNonexistentSymbol(location: Node, name: string, meaning: SymbolFlags | undefined): Symbol | undefined;
    /** @internal */ getSuggestedSymbolForNonexistentModule(node: Identifier, target: Symbol): Symbol | undefined;
    /** @internal */ getSuggestedSymbolForNonexistentClassMember(name: string, baseType: Type): Symbol | undefined;
    getBaseConstraintOfType(type: Type): Type | undefined;
    getDefaultFromTypeParameter(type: Type): Type | undefined;
    /**
     * Gets the intrinsic `any` type. There are multiple types that act as `any` used internally in the compiler,
     * so the type returned by this function should not be used in equality checks to determine if another type
     * is `any`. Instead, use `type.flags & TypeFlags.Any`.
     */
    getAnyType(): Type;
    getStringType(): Type;
    getStringLiteralType(value: string): StringLiteralType;
    getNumberType(): Type;
    getNumberLiteralType(value: number): NumberLiteralType;
    getBigIntType(): Type;
    getBigIntLiteralType(value: PseudoBigInt): BigIntLiteralType;
    getBooleanType(): Type;
    getUnknownType(): Type;
    /* eslint-disable @typescript-eslint/unified-signatures */
    /** @internal */
    getFalseType(fresh?: boolean): Type;
    getFalseType(): Type;
    /** @internal */
    getTrueType(fresh?: boolean): Type;
    getTrueType(): Type;
    /* eslint-enable @typescript-eslint/unified-signatures */
    getVoidType(): Type;
    /**
     * Gets the intrinsic `undefined` type. There are multiple types that act as `undefined` used internally in the compiler
     * depending on compiler options, so the type returned by this function should not be used in equality checks to determine
     * if another type is `undefined`. Instead, use `type.flags & TypeFlags.Undefined`.
     */
    getUndefinedType(): Type;
    /**
     * Gets the intrinsic `null` type. There are multiple types that act as `null` used internally in the compiler,
     * so the type returned by this function should not be used in equality checks to determine if another type
     * is `null`. Instead, use `type.flags & TypeFlags.Null`.
     */
    getNullType(): Type;
    getESSymbolType(): Type;
    /**
     * Gets the intrinsic `never` type. There are multiple types that act as `never` used internally in the compiler,
     * so the type returned by this function should not be used in equality checks to determine if another type
     * is `never`. Instead, use `type.flags & TypeFlags.Never`.
     */
    getNeverType(): Type;
    /**
     * Gets the intrinsic `object` type.
     */
    getNonPrimitiveType(): Type;
    /** @internal */ getOptionalType(): Type;
    /** @internal */ getUnionType(types: Type[], subtypeReduction?: UnionReduction): Type;
    /** @internal */ createArrayType(elementType: Type): Type;
    /** @internal */ getElementTypeOfArrayType(arrayType: Type): Type | undefined;
    /** @internal */ createPromiseType(type: Type): Type;
    /** @internal */ getPromiseType(): Type;
    /** @internal */ getPromiseLikeType(): Type;
    /** @internal */ getAnyAsyncIterableType(): Type | undefined;
    /**
     * Returns true if the "source" type is assignable to the "target" type.
     *
     * ```ts
     * declare const abcLiteral: ts.Type; // Type of "abc"
     * declare const stringType: ts.Type; // Type of string
     *
     * isTypeAssignableTo(abcLiteral, abcLiteral); // true; "abc" is assignable to "abc"
     * isTypeAssignableTo(abcLiteral, stringType); // true; "abc" is assignable to string
     * isTypeAssignableTo(stringType, abcLiteral); // false; string is not assignable to "abc"
     * isTypeAssignableTo(stringType, stringType); // true; string is assignable to string
     * ```
     */
    isTypeAssignableTo(source: Type, target: Type): boolean;
    /** @internal */ createAnonymousType(symbol: Symbol | undefined, members: SymbolTable, callSignatures: Signature[], constructSignatures: Signature[], indexInfos: IndexInfo[]): Type;
    /** @internal */ createSignature(declaration: SignatureDeclaration | undefined, typeParameters: readonly TypeParameter[] | undefined, thisParameter: Symbol | undefined, parameters: readonly Symbol[], resolvedReturnType: Type, typePredicate: TypePredicate | undefined, minArgumentCount: number, flags: SignatureFlags): Signature;
    /** @internal */ createSymbol(flags: SymbolFlags, name: __String): TransientSymbol;
    /** @internal */ createIndexInfo(keyType: Type, type: Type, isReadonly: boolean, declaration?: SignatureDeclaration): IndexInfo;
    /** @internal */ isSymbolAccessible(symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: SymbolFlags | undefined, shouldComputeAliasToMarkVisible: boolean): SymbolAccessibilityResult;
    /** @internal */ tryFindAmbientModule(moduleName: string): Symbol | undefined;
    /** @internal */ getSymbolWalker(accept?: (symbol: Symbol) => boolean): SymbolWalker;
    // Should not be called directly.  Should only be accessed through the Program instance.
    /** @internal */ getDiagnostics(sourceFile?: SourceFile, cancellationToken?: CancellationToken, nodesToCheck?: Node[]): Diagnostic[];
    /** @internal */ getGlobalDiagnostics(): Diagnostic[];
    /** @internal */ getEmitResolver(sourceFile?: SourceFile, cancellationToken?: CancellationToken, forceDts?: boolean): EmitResolver;
    /** @internal */ requiresAddingImplicitUndefined(parameter: ParameterDeclaration | JSDocParameterTag, enclosingDeclaration: Node | undefined): boolean;
    /** @internal */ getNodeCount(): number;
    /** @internal */ getIdentifierCount(): number;
    /** @internal */ getSymbolCount(): number;
    /** @internal */ getTypeCount(): number;
    /** @internal */ getInstantiationCount(): number;
    /** @internal */ getRelationCacheSizes(): {
        assignable: number;
        identity: number;
        subtype: number;
        strictSubtype: number;
    };
    /** @internal */ getRecursionIdentity(type: Type): object | undefined;
    /** @internal */ getUnmatchedProperties(source: Type, target: Type, requireOptionalProperties: boolean, matchDiscriminantProperties: boolean): IterableIterator<Symbol>;
    /**
     * True if this type is the `Array` or `ReadonlyArray` type from lib.d.ts.
     * This function will _not_ return true if passed a type which
     * extends `Array` (for example, the TypeScript AST's `NodeArray` type).
     */
    isArrayType(type: Type): boolean;
    /**
     * True if this type is a tuple type. This function will _not_ return true if
     * passed a type which extends from a tuple.
     */
    isTupleType(type: Type): boolean;
    /**
     * True if this type is assignable to `ReadonlyArray<any>`.
     */
    isArrayLikeType(type: Type): boolean;
    /**
     * True if `contextualType` should not be considered for completions because
     * e.g. it specifies `kind: "a"` and obj has `kind: "b"`.
     *
     * @internal
     */
    isTypeInvalidDueToUnionDiscriminant(contextualType: Type, obj: ObjectLiteralExpression | JsxAttributes): boolean;
    /** @internal */ getExactOptionalProperties(type: Type): Symbol[];
    /**
     * For a union, will include a property if it's defined in *any* of the member types.
     * So for `{ a } | { b }`, this will include both `a` and `b`.
     * Does not include properties of primitive types.
     *
     * @internal
     */
    getAllPossiblePropertiesOfTypes(type: readonly Type[]): Symbol[];
    resolveName(name: string, location: Node | undefined, meaning: SymbolFlags | undefined, excludeGlobals: boolean): Symbol | undefined;
    /** @internal */ getJsxNamespace(location?: Node): string;
    /** @internal */ getJsxFragmentFactory(location: Node): string | undefined;
    /**
     * Note that this will return undefined in the following case:
     *     // a.ts
     *     export namespace N { export class C { } }
     *     // b.ts
     *     <<enclosingDeclaration>>
     * Where `C` is the symbol we're looking for.
     * This should be called in a loop climbing parents of the symbol, so we'll get `N`.
     *
     * @internal
     */
    getAccessibleSymbolChain(symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: SymbolFlags | undefined, useOnlyExternalAliasing: boolean): Symbol[] | undefined;
    getTypePredicateOfSignature(signature: Signature): TypePredicate | undefined;
    /** @internal */ resolveExternalModuleName(moduleSpecifier: Expression): Symbol | undefined;
    /**
     * An external module with an 'export =' declaration resolves to the target of the 'export =' declaration,
     * and an external module with no 'export =' declaration resolves to the module itself.
     *
     * @internal
     */
    resolveExternalModuleSymbol(symbol: Symbol): Symbol;
    /**
     * @param node A location where we might consider accessing `this`. Not necessarily a ThisExpression.
     *
     * @internal
     */
    tryGetThisTypeAt(node: Node, includeGlobalThis?: boolean, container?: ThisContainer): Type | undefined;
    /** @internal */ getTypeArgumentConstraint(node: TypeNode): Type | undefined;
    /**
     * Does *not* get *all* suggestion diagnostics, just the ones that were convenient to report in the checker.
     * Others are added in computeSuggestionDiagnostics.
     *
     * @internal
     */
    getSuggestionDiagnostics(file: SourceFile, cancellationToken?: CancellationToken): readonly DiagnosticWithLocation[];
    /**
     * Depending on the operation performed, it may be appropriate to throw away the checker
     * if the cancellation token is triggered. Typically, if it is used for error checking
     * and the operation is cancelled, then it should be discarded, otherwise it is safe to keep.
     */
    runWithCancellationToken<T>(token: CancellationToken, cb: (checker: TypeChecker) => T): T;
    /**@internal */
    runWithCancellationToken<T>(token: CancellationToken | undefined, cb: (checker: TypeChecker) => T): T; // eslint-disable-line @typescript-eslint/unified-signatures
    /** @internal */ getLocalTypeParametersOfClassOrInterfaceOrTypeAlias(symbol: Symbol): readonly TypeParameter[] | undefined;
    /** @internal */ isDeclarationVisible(node: Declaration | AnyImportSyntax): boolean;
    /** @internal */ isPropertyAccessible(node: Node, isSuper: boolean, isWrite: boolean, containingType: Type, property: Symbol): boolean;
    /** @internal */ getTypeOnlyAliasDeclaration(symbol: Symbol): TypeOnlyAliasDeclaration | undefined;
    /** @internal */ getMemberOverrideModifierStatus(node: ClassLikeDeclaration, member: ClassElement, memberSymbol: Symbol): MemberOverrideStatus;
    /** @internal */ isTypeParameterPossiblyReferenced(tp: TypeParameter, node: Node): boolean;
    /** @internal */ typeHasCallOrConstructSignatures(type: Type): boolean;
    /** @internal */ getSymbolFlags(symbol: Symbol): SymbolFlags;
    /** @internal */ fillMissingTypeArguments(typeArguments: readonly Type[], typeParameters: readonly TypeParameter[] | undefined, minTypeArgumentCount: number, isJavaScriptImplicitAny: boolean): Type[];
    getTypeArgumentsForResolvedSignature(signature: Signature): readonly Type[] | undefined;
    /** @internal */ isLibType(type: Type): boolean;
}
/** @internal */
export type MemberOverrideStatus = number;
/** @internal */
export const MemberOverrideStatus: {
    readonly Ok: 0;
    readonly NeedsOverride: 1;
    readonly HasInvalidOverride: 2;
    [index: number]: string;
} = {
    Ok: 0,
    "0": "Ok",
    NeedsOverride: 1,
    "1": "NeedsOverride",
    HasInvalidOverride: 2,
    "2": "HasInvalidOverride"
};
/** @internal */
export type UnionReduction = number;
/** @internal */
export const UnionReduction: {
    readonly None: 0;
    readonly Literal: 1;
    readonly Subtype: 2;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Literal: 1,
    "1": "Literal",
    Subtype: 2,
    "2": "Subtype"
};
/** @internal */
export type IntersectionFlags = number;
/** @internal */
export const IntersectionFlags: {
    readonly None: 0;
    readonly NoSupertypeReduction: 1;
    readonly NoConstraintReduction: 2;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NoSupertypeReduction: 1,
    "1": "NoSupertypeReduction",
    NoConstraintReduction: 2,
    "2": "NoConstraintReduction"
};
// dprint-ignore
/** @internal */
export type ContextFlags = number;
// dprint-ignore
/** @internal */
export const ContextFlags: {
    readonly None: 0;
    readonly Signature: 1;
    readonly NoConstraints: 2;
    readonly Completions: 4;
    readonly SkipBindingPatterns: 8;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Signature: 1,
    "1": "Signature",
    NoConstraints: 2,
    "2": "NoConstraints",
    Completions: 4,
    "4": "Completions",
    SkipBindingPatterns: 8,
    "8": "SkipBindingPatterns"
};
// NOTE: If modifying this enum, must modify `TypeFormatFlags` too!
// dprint-ignore
export type NodeBuilderFlags = number;
// NOTE: If modifying this enum, must modify `TypeFormatFlags` too!
// dprint-ignore
export const NodeBuilderFlags: {
    readonly None: 0;
    readonly NoTruncation: 1;
    readonly WriteArrayAsGenericType: 2;
    readonly GenerateNamesForShadowedTypeParams: 4;
    readonly UseStructuralFallback: 8;
    readonly ForbidIndexedAccessSymbolReferences: 16;
    readonly WriteTypeArgumentsOfSignature: 32;
    readonly UseFullyQualifiedType: 64;
    readonly UseOnlyExternalAliasing: 128;
    readonly SuppressAnyReturnType: 256;
    readonly WriteTypeParametersInQualifiedName: 512;
    readonly MultilineObjectLiterals: 1024;
    readonly WriteClassExpressionAsTypeLiteral: 2048;
    readonly UseTypeOfFunction: 4096;
    readonly OmitParameterModifiers: 8192;
    readonly UseAliasDefinedOutsideCurrentScope: 16384;
    readonly UseSingleQuotesForStringLiteralType: 268435456;
    readonly NoTypeReduction: 536870912;
    readonly OmitThisParameter: 33554432;
    readonly AllowThisInObjectLiteral: 32768;
    readonly AllowQualifiedNameInPlaceOfIdentifier: 65536;
    readonly AllowAnonymousIdentifier: 131072;
    readonly AllowEmptyUnionOrIntersection: 262144;
    readonly AllowEmptyTuple: 524288;
    readonly AllowUniqueESSymbolType: 1048576;
    readonly AllowEmptyIndexInfoType: 2097152;
    readonly AllowNodeModulesRelativePaths: 67108864;
    readonly IgnoreErrors: 70221824;
    readonly InObjectTypeLiteral: 4194304;
    readonly InTypeAlias: 8388608;
    readonly InInitialEntityName: 16777216;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NoTruncation: 1,
    "1": "NoTruncation",
    WriteArrayAsGenericType: 2,
    "2": "WriteArrayAsGenericType",
    GenerateNamesForShadowedTypeParams: 4,
    "4": "GenerateNamesForShadowedTypeParams",
    UseStructuralFallback: 8,
    "8": "UseStructuralFallback",
    ForbidIndexedAccessSymbolReferences: 16,
    "16": "ForbidIndexedAccessSymbolReferences",
    WriteTypeArgumentsOfSignature: 32,
    "32": "WriteTypeArgumentsOfSignature",
    UseFullyQualifiedType: 64,
    "64": "UseFullyQualifiedType",
    UseOnlyExternalAliasing: 128,
    "128": "UseOnlyExternalAliasing",
    SuppressAnyReturnType: 256,
    "256": "SuppressAnyReturnType",
    WriteTypeParametersInQualifiedName: 512,
    "512": "WriteTypeParametersInQualifiedName",
    MultilineObjectLiterals: 1024,
    "1024": "MultilineObjectLiterals",
    WriteClassExpressionAsTypeLiteral: 2048,
    "2048": "WriteClassExpressionAsTypeLiteral",
    UseTypeOfFunction: 4096,
    "4096": "UseTypeOfFunction",
    OmitParameterModifiers: 8192,
    "8192": "OmitParameterModifiers",
    UseAliasDefinedOutsideCurrentScope: 16384,
    "16384": "UseAliasDefinedOutsideCurrentScope",
    UseSingleQuotesForStringLiteralType: 268435456,
    "268435456": "UseSingleQuotesForStringLiteralType",
    NoTypeReduction: 536870912,
    "536870912": "NoTypeReduction",
    OmitThisParameter: 33554432,
    "33554432": "OmitThisParameter",
    AllowThisInObjectLiteral: 32768,
    "32768": "AllowThisInObjectLiteral",
    AllowQualifiedNameInPlaceOfIdentifier: 65536,
    "65536": "AllowQualifiedNameInPlaceOfIdentifier",
    AllowAnonymousIdentifier: 131072,
    "131072": "AllowAnonymousIdentifier",
    AllowEmptyUnionOrIntersection: 262144,
    "262144": "AllowEmptyUnionOrIntersection",
    AllowEmptyTuple: 524288,
    "524288": "AllowEmptyTuple",
    AllowUniqueESSymbolType: 1048576,
    "1048576": "AllowUniqueESSymbolType",
    AllowEmptyIndexInfoType: 2097152,
    "2097152": "AllowEmptyIndexInfoType",
    AllowNodeModulesRelativePaths: 67108864,
    "67108864": "AllowNodeModulesRelativePaths",
    IgnoreErrors: 70221824,
    "70221824": "IgnoreErrors",
    InObjectTypeLiteral: 4194304,
    "4194304": "InObjectTypeLiteral",
    InTypeAlias: 8388608,
    "8388608": "InTypeAlias",
    InInitialEntityName: 16777216,
    "16777216": "InInitialEntityName"
};
/** @internal */
// dprint-ignore
export type InternalNodeBuilderFlags = number;
/** @internal */
// dprint-ignore
export const InternalNodeBuilderFlags: {
    readonly None: 0;
    readonly WriteComputedProps: 1;
    readonly NoSyntacticPrinter: 2;
    readonly DoNotIncludeSymbolChain: 4;
    readonly AllowUnresolvedNames: 8;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    WriteComputedProps: 1,
    "1": "WriteComputedProps",
    NoSyntacticPrinter: 2,
    "2": "NoSyntacticPrinter",
    DoNotIncludeSymbolChain: 4,
    "4": "DoNotIncludeSymbolChain",
    AllowUnresolvedNames: 8,
    "8": "AllowUnresolvedNames"
};
// Ensure the shared flags between this and `NodeBuilderFlags` stay in alignment
// dprint-ignore
export type TypeFormatFlags = number;
// Ensure the shared flags between this and `NodeBuilderFlags` stay in alignment
// dprint-ignore
export const TypeFormatFlags: {
    readonly None: 0;
    readonly NoTruncation: 1;
    readonly WriteArrayAsGenericType: 2;
    readonly GenerateNamesForShadowedTypeParams: 4;
    readonly UseStructuralFallback: 8;
    readonly WriteTypeArgumentsOfSignature: 32;
    readonly UseFullyQualifiedType: 64;
    readonly SuppressAnyReturnType: 256;
    readonly MultilineObjectLiterals: 1024;
    readonly WriteClassExpressionAsTypeLiteral: 2048;
    readonly UseTypeOfFunction: 4096;
    readonly OmitParameterModifiers: 8192;
    readonly UseAliasDefinedOutsideCurrentScope: 16384;
    readonly UseSingleQuotesForStringLiteralType: 268435456;
    readonly NoTypeReduction: 536870912;
    readonly OmitThisParameter: 33554432;
    readonly AllowUniqueESSymbolType: 1048576;
    readonly AddUndefined: 131072;
    readonly WriteArrowStyleSignature: 262144;
    readonly InArrayType: 524288;
    readonly InElementType: 2097152;
    readonly InFirstTypeArgument: 4194304;
    readonly InTypeAlias: 8388608;
    readonly NodeBuilderFlagsMask: 848330095;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NoTruncation: 1,
    "1": "NoTruncation",
    WriteArrayAsGenericType: 2,
    "2": "WriteArrayAsGenericType",
    GenerateNamesForShadowedTypeParams: 4,
    "4": "GenerateNamesForShadowedTypeParams",
    UseStructuralFallback: 8,
    "8": "UseStructuralFallback",
    WriteTypeArgumentsOfSignature: 32,
    "32": "WriteTypeArgumentsOfSignature",
    UseFullyQualifiedType: 64,
    "64": "UseFullyQualifiedType",
    SuppressAnyReturnType: 256,
    "256": "SuppressAnyReturnType",
    MultilineObjectLiterals: 1024,
    "1024": "MultilineObjectLiterals",
    WriteClassExpressionAsTypeLiteral: 2048,
    "2048": "WriteClassExpressionAsTypeLiteral",
    UseTypeOfFunction: 4096,
    "4096": "UseTypeOfFunction",
    OmitParameterModifiers: 8192,
    "8192": "OmitParameterModifiers",
    UseAliasDefinedOutsideCurrentScope: 16384,
    "16384": "UseAliasDefinedOutsideCurrentScope",
    UseSingleQuotesForStringLiteralType: 268435456,
    "268435456": "UseSingleQuotesForStringLiteralType",
    NoTypeReduction: 536870912,
    "536870912": "NoTypeReduction",
    OmitThisParameter: 33554432,
    "33554432": "OmitThisParameter",
    AllowUniqueESSymbolType: 1048576,
    "1048576": "AllowUniqueESSymbolType",
    AddUndefined: 131072,
    "131072": "AddUndefined",
    WriteArrowStyleSignature: 262144,
    "262144": "WriteArrowStyleSignature",
    InArrayType: 524288,
    "524288": "InArrayType",
    InElementType: 2097152,
    "2097152": "InElementType",
    InFirstTypeArgument: 4194304,
    "4194304": "InFirstTypeArgument",
    InTypeAlias: 8388608,
    "8388608": "InTypeAlias",
    NodeBuilderFlagsMask: 848330095,
    "848330095": "NodeBuilderFlagsMask"
};
// dprint-ignore
export type SymbolFormatFlags = number;
// dprint-ignore
export const SymbolFormatFlags: {
    readonly None: 0;
    readonly WriteTypeParametersOrArguments: 1;
    readonly UseOnlyExternalAliasing: 2;
    readonly AllowAnyNodeKind: 4;
    readonly UseAliasDefinedOutsideCurrentScope: 8;
    readonly WriteComputedProps: 16;
    readonly DoNotIncludeSymbolChain: 32;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    WriteTypeParametersOrArguments: 1,
    "1": "WriteTypeParametersOrArguments",
    UseOnlyExternalAliasing: 2,
    "2": "UseOnlyExternalAliasing",
    AllowAnyNodeKind: 4,
    "4": "AllowAnyNodeKind",
    UseAliasDefinedOutsideCurrentScope: 8,
    "8": "UseAliasDefinedOutsideCurrentScope",
    WriteComputedProps: 16,
    "16": "WriteComputedProps",
    DoNotIncludeSymbolChain: 32,
    "32": "DoNotIncludeSymbolChain"
};
/** @internal */
export interface SymbolWalker {
    /** Note: Return values are not ordered. */
    walkType(root: Type): {
        visitedTypes: readonly Type[];
        visitedSymbols: readonly Symbol[];
    };
    /** Note: Return values are not ordered. */
    walkSymbol(root: Symbol): {
        visitedTypes: readonly Type[];
        visitedSymbols: readonly Symbol[];
    };
}
// This was previously deprecated in our public API, but is still used internally
/** @internal */
export interface SymbolWriter {
    writeKeyword(text: string): void;
    writeOperator(text: string): void;
    writePunctuation(text: string): void;
    writeSpace(text: string): void;
    writeStringLiteral(text: string): void;
    writeParameter(text: string): void;
    writeProperty(text: string): void;
    writeSymbol(text: string, symbol: Symbol): void;
    writeLine(force?: boolean): void;
    increaseIndent(): void;
    decreaseIndent(): void;
    clear(): void;
}
/** @internal */
export type SymbolAccessibility = number;
/** @internal */
export const SymbolAccessibility: {
    readonly Accessible: 0;
    readonly NotAccessible: 1;
    readonly CannotBeNamed: 2;
    readonly NotResolved: 3;
    [index: number]: string;
} = {
    Accessible: 0,
    "0": "Accessible",
    NotAccessible: 1,
    "1": "NotAccessible",
    CannotBeNamed: 2,
    "2": "CannotBeNamed",
    NotResolved: 3,
    "3": "NotResolved"
};
export type TypePredicateKind = number;
export const TypePredicateKind: {
    readonly This: 0;
    readonly Identifier: 1;
    readonly AssertsThis: 2;
    readonly AssertsIdentifier: 3;
    [index: number]: string;
} = {
    This: 0,
    "0": "This",
    Identifier: 1,
    "1": "Identifier",
    AssertsThis: 2,
    "2": "AssertsThis",
    AssertsIdentifier: 3,
    "3": "AssertsIdentifier"
};
export interface TypePredicateBase {
    kind: TypePredicateKind;
    type: Type | undefined;
}
export interface ThisTypePredicate extends TypePredicateBase {
    kind: typeof TypePredicateKind.This;
    parameterName: undefined;
    parameterIndex: undefined;
    type: Type;
}
export interface IdentifierTypePredicate extends TypePredicateBase {
    kind: typeof TypePredicateKind.Identifier;
    parameterName: string;
    parameterIndex: number;
    type: Type;
}
export interface AssertsThisTypePredicate extends TypePredicateBase {
    kind: typeof TypePredicateKind.AssertsThis;
    parameterName: undefined;
    parameterIndex: undefined;
    type: Type | undefined;
}
export interface AssertsIdentifierTypePredicate extends TypePredicateBase {
    kind: typeof TypePredicateKind.AssertsIdentifier;
    parameterName: string;
    parameterIndex: number;
    type: Type | undefined;
}
export type TypePredicate = ThisTypePredicate | IdentifierTypePredicate | AssertsThisTypePredicate | AssertsIdentifierTypePredicate;
/** @internal */
export type AnyImportSyntax = ImportDeclaration | ImportEqualsDeclaration;
/** @internal */
export type AnyImportOrJsDocImport = AnyImportSyntax | JSDocImportTag;
/** @internal */
export type AnyImportOrRequire = AnyImportOrJsDocImport | VariableDeclarationInitializedTo<RequireOrImportCall>;
/** @internal */
export type AnyImportOrBareOrAccessedRequire = AnyImportSyntax | VariableDeclarationInitializedTo<RequireOrImportCall | AccessExpression>;
/** @internal */
export type AliasDeclarationNode = ImportEqualsDeclaration | VariableDeclarationInitializedTo<RequireOrImportCall | AccessExpression> | ImportClause | NamespaceImport | ImportSpecifier | ExportSpecifier | NamespaceExport | BindingElementOfBareOrAccessedRequire;
/** @internal */
export type BindingElementOfBareOrAccessedRequire = BindingElement & {
    parent: {
        parent: VariableDeclarationInitializedTo<RequireOrImportCall | AccessExpression>;
    };
};
/** @internal */
export type AnyImportOrRequireStatement = AnyImportSyntax | RequireVariableStatement;
/** @internal */
export type AnyImportOrReExport = AnyImportSyntax | ExportDeclaration;
/** @internal */
export interface ValidImportTypeNode extends ImportTypeNode {
    argument: LiteralTypeNode & {
        literal: StringLiteral;
    };
}
/** @internal */
export type AnyValidImportOrReExport = (ImportDeclaration | ExportDeclaration | JSDocImportTag) & {
    moduleSpecifier: StringLiteral;
} | ImportEqualsDeclaration & {
    moduleReference: ExternalModuleReference & {
        expression: StringLiteral;
    };
} | RequireOrImportCall | ValidImportTypeNode;
/** @internal */
export type RequireOrImportCall = CallExpression & {
    expression: Identifier;
    arguments: [
        StringLiteralLike
    ];
};
/** @internal */
export interface VariableDeclarationInitializedTo<T extends Expression> extends VariableDeclaration {
    initializer: T;
}
/** @internal */
export interface RequireVariableStatement extends VariableStatement {
    declarationList: RequireVariableDeclarationList;
}
/** @internal */
export interface RequireVariableDeclarationList extends VariableDeclarationList {
    declarations: NodeArray<VariableDeclarationInitializedTo<RequireOrImportCall>>;
}
/** @internal */
export type CanHaveModuleSpecifier = AnyImportOrBareOrAccessedRequire | AliasDeclarationNode | ExportDeclaration | ImportTypeNode;
/** @internal */
export type LateVisibilityPaintedStatement = AnyImportOrJsDocImport | VariableStatement | ClassDeclaration | FunctionDeclaration | ModuleDeclaration | TypeAliasDeclaration | InterfaceDeclaration | EnumDeclaration;
/** @internal */
export interface SymbolVisibilityResult {
    accessibility: SymbolAccessibility;
    aliasesToMakeVisible?: LateVisibilityPaintedStatement[]; // aliases that need to have this symbol visible
    errorSymbolName?: string; // Optional symbol name that results in error
    errorNode?: Node; // optional node that results in error
}
/** @internal */
export interface SymbolAccessibilityResult extends SymbolVisibilityResult {
    errorModuleName?: string; // If the symbol is not visible from module, module's name
}
/** @internal */
export interface AllAccessorDeclarations {
    firstAccessor: AccessorDeclaration;
    secondAccessor: AccessorDeclaration | undefined;
    getAccessor: GetAccessorDeclaration | undefined;
    setAccessor: SetAccessorDeclaration | undefined;
}
/** @internal */
export interface AllDecorators {
    decorators: readonly Decorator[] | undefined;
    parameters?: readonly (readonly Decorator[] | undefined)[];
    getDecorators?: readonly Decorator[] | undefined;
    setDecorators?: readonly Decorator[] | undefined;
}
/**
 * Indicates how to serialize the name for a TypeReferenceNode when emitting decorator metadata
 *
 * @internal
 */
export type TypeReferenceSerializationKind = number;
/**
 * Indicates how to serialize the name for a TypeReferenceNode when emitting decorator metadata
 *
 * @internal
 */
export const TypeReferenceSerializationKind: {
    readonly Unknown: 0;
    readonly TypeWithConstructSignatureAndValue: 1;
    readonly VoidNullableOrNeverType: 2;
    readonly NumberLikeType: 3;
    readonly BigIntLikeType: 4;
    readonly StringLikeType: 5;
    readonly BooleanType: 6;
    readonly ArrayLikeType: 7;
    readonly ESSymbolType: 8;
    readonly Promise: 9;
    readonly TypeWithCallSignature: 10;
    readonly ObjectType: 11;
    [index: number]: string;
} = {
    Unknown: 0,
    "0": "Unknown",
    TypeWithConstructSignatureAndValue: 1,
    "1": "TypeWithConstructSignatureAndValue",
    VoidNullableOrNeverType: 2,
    "2": "VoidNullableOrNeverType",
    NumberLikeType: 3,
    "3": "NumberLikeType",
    BigIntLikeType: 4,
    "4": "BigIntLikeType",
    StringLikeType: 5,
    "5": "StringLikeType",
    BooleanType: 6,
    "6": "BooleanType",
    ArrayLikeType: 7,
    "7": "ArrayLikeType",
    ESSymbolType: 8,
    "8": "ESSymbolType",
    Promise: 9,
    "9": "Promise",
    TypeWithCallSignature: 10,
    "10": "TypeWithCallSignature",
    ObjectType: 11,
    "11": "ObjectType"
};
/** @internal */
export type LazyNodeCheckFlags = typeof NodeCheckFlags.SuperInstance | typeof NodeCheckFlags.SuperStatic | typeof NodeCheckFlags.MethodWithSuperPropertyAccessInAsync | typeof NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync | typeof NodeCheckFlags.ContainsSuperPropertyInStaticInitializer | typeof NodeCheckFlags.CaptureArguments | typeof NodeCheckFlags.ContainsCapturedBlockScopeBinding | typeof NodeCheckFlags.NeedsLoopOutParameter | typeof NodeCheckFlags.ContainsConstructorReference | typeof NodeCheckFlags.ConstructorReference | typeof NodeCheckFlags.CapturedBlockScopedBinding | typeof NodeCheckFlags.BlockScopedBindingInLoop | typeof NodeCheckFlags.LoopWithCapturedBlockScopedBinding;
/** @internal */
export interface EmitResolver {
    hasGlobalName(name: string): boolean;
    getReferencedExportContainer(node: Identifier, prefixLocals?: boolean): SourceFile | ModuleDeclaration | EnumDeclaration | undefined;
    getReferencedImportDeclaration(node: Identifier): Declaration | undefined;
    getReferencedDeclarationWithCollidingName(node: Identifier): Declaration | undefined;
    isDeclarationWithCollidingName(node: Declaration): boolean;
    isValueAliasDeclaration(node: Node): boolean;
    isReferencedAliasDeclaration(node: Node, checkChildren?: boolean): boolean;
    isTopLevelValueImportEqualsWithEntityName(node: ImportEqualsDeclaration): boolean;
    hasNodeCheckFlag(node: Node, flags: LazyNodeCheckFlags): boolean;
    isDeclarationVisible(node: Declaration | AnyImportSyntax): boolean;
    isLateBound(node: Declaration): node is LateBoundDeclaration;
    collectLinkedAliases(node: ModuleExportName, setVisibility?: boolean): Node[] | undefined;
    markLinkedReferences(node: Node): void;
    isImplementationOfOverload(node: SignatureDeclaration): boolean | undefined;
    requiresAddingImplicitUndefined(node: ParameterDeclaration, enclosingDeclaration: Node | undefined): boolean;
    isExpandoFunctionDeclaration(node: FunctionDeclaration | VariableDeclaration): boolean;
    getPropertiesOfContainerFunction(node: Declaration): Symbol[];
    createTypeOfDeclaration(declaration: HasInferredType, enclosingDeclaration: Node, flags: NodeBuilderFlags, internalFlags: InternalNodeBuilderFlags, tracker: SymbolTracker): TypeNode | undefined;
    createReturnTypeOfSignatureDeclaration(signatureDeclaration: SignatureDeclaration, enclosingDeclaration: Node, flags: NodeBuilderFlags, internalFlags: InternalNodeBuilderFlags, tracker: SymbolTracker): TypeNode | undefined;
    createTypeOfExpression(expr: Expression, enclosingDeclaration: Node, flags: NodeBuilderFlags, internalFlags: InternalNodeBuilderFlags, tracker: SymbolTracker): TypeNode | undefined;
    createLiteralConstValue(node: VariableDeclaration | PropertyDeclaration | PropertySignature | ParameterDeclaration, tracker: SymbolTracker): Expression;
    isSymbolAccessible(symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: SymbolFlags | undefined, shouldComputeAliasToMarkVisible: boolean): SymbolAccessibilityResult;
    isEntityNameVisible(entityName: EntityNameOrEntityNameExpression, enclosingDeclaration: Node): SymbolVisibilityResult;
    // Returns the constant value this property access resolves to, or 'undefined' for a non-constant
    getConstantValue(node: EnumMember | PropertyAccessExpression | ElementAccessExpression): string | number | undefined;
    getEnumMemberValue(node: EnumMember): EvaluatorResult | undefined;
    getReferencedValueDeclaration(reference: Identifier): Declaration | undefined;
    getReferencedValueDeclarations(reference: Identifier): Declaration[] | undefined;
    getTypeReferenceSerializationKind(typeName: EntityName, location?: Node): TypeReferenceSerializationKind;
    isOptionalParameter(node: ParameterDeclaration): boolean;
    isArgumentsLocalBinding(node: Identifier): boolean;
    getExternalModuleFileFromDeclaration(declaration: ImportEqualsDeclaration | ImportDeclaration | ExportDeclaration | ModuleDeclaration | ImportTypeNode | ImportCall): SourceFile | undefined;
    isLiteralConstDeclaration(node: VariableDeclaration | PropertyDeclaration | PropertySignature | ParameterDeclaration): boolean;
    getJsxFactoryEntity(location?: Node): EntityName | undefined;
    getJsxFragmentFactoryEntity(location?: Node): EntityName | undefined;
    isBindingCapturedByNode(node: Node, decl: VariableDeclaration | BindingElement): boolean;
    getDeclarationStatementsForSourceFile(node: SourceFile, flags: NodeBuilderFlags, internalFlags: InternalNodeBuilderFlags, tracker: SymbolTracker): Statement[] | undefined;
    isImportRequiredByAugmentation(decl: ImportDeclaration): boolean;
    isDefinitelyReferenceToGlobalSymbolObject(node: Node): boolean;
    createLateBoundIndexSignatures(cls: ClassLikeDeclaration, enclosingDeclaration: Node, flags: NodeBuilderFlags, internalFlags: InternalNodeBuilderFlags, tracker: SymbolTracker): (IndexSignatureDeclaration | PropertyDeclaration)[] | undefined;
    symbolToDeclarations(symbol: Symbol, meaning: SymbolFlags | undefined, flags: NodeBuilderFlags, maximumLength?: number, verbosityLevel?: number, out?: WriterContextOut): Declaration[];
}
// dprint-ignore
export type SymbolFlags = number;
// dprint-ignore
export const SymbolFlags: {
    readonly None: 0;
    readonly FunctionScopedVariable: 1;
    readonly BlockScopedVariable: 2;
    readonly Property: 4;
    readonly EnumMember: 8;
    readonly Function: 16;
    readonly Class: 32;
    readonly Interface: 64;
    readonly ConstEnum: 128;
    readonly RegularEnum: 256;
    readonly ValueModule: 512;
    readonly NamespaceModule: 1024;
    readonly TypeLiteral: 2048;
    readonly ObjectLiteral: 4096;
    readonly Method: 8192;
    readonly Constructor: 16384;
    readonly GetAccessor: 32768;
    readonly SetAccessor: 65536;
    readonly Signature: 131072;
    readonly TypeParameter: 262144;
    readonly TypeAlias: 524288;
    readonly ExportValue: 1048576;
    readonly Alias: 2097152;
    readonly Prototype: 4194304;
    readonly ExportStar: 8388608;
    readonly Optional: 16777216;
    readonly Transient: 33554432;
    readonly Assignment: 67108864;
    readonly ModuleExports: 134217728;
    readonly All: -1;
    readonly Enum: 384;
    readonly Variable: 3;
    readonly Value: 111551;
    readonly Type: 788968;
    readonly Namespace: 1920;
    readonly Module: 1536;
    readonly Accessor: 98304;
    readonly FunctionScopedVariableExcludes: 111550;
    readonly BlockScopedVariableExcludes: 111551;
    readonly ParameterExcludes: 111551;
    readonly PropertyExcludes: 0;
    readonly EnumMemberExcludes: 900095;
    readonly FunctionExcludes: 110991;
    readonly ClassExcludes: 899503;
    readonly InterfaceExcludes: 788872;
    readonly RegularEnumExcludes: 899327;
    readonly ConstEnumExcludes: 899967;
    readonly ValueModuleExcludes: 110735;
    readonly NamespaceModuleExcludes: 0;
    readonly MethodExcludes: 103359;
    readonly GetAccessorExcludes: 46015;
    readonly SetAccessorExcludes: 78783;
    readonly AccessorExcludes: 13247;
    readonly TypeParameterExcludes: 526824;
    readonly TypeAliasExcludes: 788968;
    readonly AliasExcludes: 2097152;
    readonly ModuleMember: 2623475;
    readonly ExportHasLocal: 944;
    readonly BlockScoped: 418;
    readonly PropertyOrAccessor: 98308;
    readonly ClassMember: 106500;
    readonly ExportSupportsDefaultModifier: 112;
    readonly ExportDoesNotSupportDefaultModifier: -113;
    readonly Classifiable: 2885600;
    readonly LateBindingContainer: 6256;
    [index: number]: string;
} = {
    None: 0,
    "0": "NamespaceModuleExcludes",
    FunctionScopedVariable: 1,
    "1": "FunctionScopedVariable",
    BlockScopedVariable: 2,
    "2": "BlockScopedVariable",
    Property: 4,
    "4": "Property",
    EnumMember: 8,
    "8": "EnumMember",
    Function: 16,
    "16": "Function",
    Class: 32,
    "32": "Class",
    Interface: 64,
    "64": "Interface",
    ConstEnum: 128,
    "128": "ConstEnum",
    RegularEnum: 256,
    "256": "RegularEnum",
    ValueModule: 512,
    "512": "ValueModule",
    NamespaceModule: 1024,
    "1024": "NamespaceModule",
    TypeLiteral: 2048,
    "2048": "TypeLiteral",
    ObjectLiteral: 4096,
    "4096": "ObjectLiteral",
    Method: 8192,
    "8192": "Method",
    Constructor: 16384,
    "16384": "Constructor",
    GetAccessor: 32768,
    "32768": "GetAccessor",
    SetAccessor: 65536,
    "65536": "SetAccessor",
    Signature: 131072,
    "131072": "Signature",
    TypeParameter: 262144,
    "262144": "TypeParameter",
    TypeAlias: 524288,
    "524288": "TypeAlias",
    ExportValue: 1048576,
    "1048576": "ExportValue",
    Alias: 2097152,
    "2097152": "AliasExcludes",
    Prototype: 4194304,
    "4194304": "Prototype",
    ExportStar: 8388608,
    "8388608": "ExportStar",
    Optional: 16777216,
    "16777216": "Optional",
    Transient: 33554432,
    "33554432": "Transient",
    Assignment: 67108864,
    "67108864": "Assignment",
    ModuleExports: 134217728,
    "134217728": "ModuleExports",
    All: -1,
    "-1": "All",
    Enum: 384,
    "384": "Enum",
    Variable: 3,
    "3": "Variable",
    Value: 111551,
    "111551": "ParameterExcludes",
    Type: 788968,
    "788968": "TypeAliasExcludes",
    Namespace: 1920,
    "1920": "Namespace",
    Module: 1536,
    "1536": "Module",
    Accessor: 98304,
    "98304": "Accessor",
    FunctionScopedVariableExcludes: 111550,
    "111550": "FunctionScopedVariableExcludes",
    BlockScopedVariableExcludes: 111551,
    ParameterExcludes: 111551,
    PropertyExcludes: 0,
    EnumMemberExcludes: 900095,
    "900095": "EnumMemberExcludes",
    FunctionExcludes: 110991,
    "110991": "FunctionExcludes",
    ClassExcludes: 899503,
    "899503": "ClassExcludes",
    InterfaceExcludes: 788872,
    "788872": "InterfaceExcludes",
    RegularEnumExcludes: 899327,
    "899327": "RegularEnumExcludes",
    ConstEnumExcludes: 899967,
    "899967": "ConstEnumExcludes",
    ValueModuleExcludes: 110735,
    "110735": "ValueModuleExcludes",
    NamespaceModuleExcludes: 0,
    MethodExcludes: 103359,
    "103359": "MethodExcludes",
    GetAccessorExcludes: 46015,
    "46015": "GetAccessorExcludes",
    SetAccessorExcludes: 78783,
    "78783": "SetAccessorExcludes",
    AccessorExcludes: 13247,
    "13247": "AccessorExcludes",
    TypeParameterExcludes: 526824,
    "526824": "TypeParameterExcludes",
    TypeAliasExcludes: 788968,
    AliasExcludes: 2097152,
    ModuleMember: 2623475,
    "2623475": "ModuleMember",
    ExportHasLocal: 944,
    "944": "ExportHasLocal",
    BlockScoped: 418,
    "418": "BlockScoped",
    PropertyOrAccessor: 98308,
    "98308": "PropertyOrAccessor",
    ClassMember: 106500,
    "106500": "ClassMember",
    ExportSupportsDefaultModifier: 112,
    "112": "ExportSupportsDefaultModifier",
    ExportDoesNotSupportDefaultModifier: -113,
    "-113": "ExportDoesNotSupportDefaultModifier",
    Classifiable: 2885600,
    "2885600": "Classifiable",
    LateBindingContainer: 6256,
    "6256": "LateBindingContainer"
};
/** @internal */
export type SymbolId = number;
// dprint-ignore
export interface Symbol {
    /** Attached by the original optional debug instrumentation. */
    __debugFlags?: string;
    /** Transient-symbol metadata is absent on ordinary symbols. */
    links?: SymbolLinks;
    flags: SymbolFlags; // Symbol flags
    escapedName: __String; // Name of symbol
    declarations?: (Declaration[]) | undefined; // Declarations associated with this symbol
    valueDeclaration?: (Declaration) | undefined; // First value declaration of the symbol
    members?: (SymbolTable) | undefined; // Class, interface or object literal instance members
    exports?: (SymbolTable) | undefined; // Module exports
    globalExports?: SymbolTable; // Conditional global UMD exports
    /** @internal */ id: SymbolId; // Unique id (used to look up SymbolLinks)
    /** @internal */ mergeId: number; // Merge id (used to look up merged symbol)
    /** @internal */ parent?: (Symbol) | undefined; // Parent symbol
    /** @internal */ exportSymbol?: (Symbol) | undefined; // Exported symbol associated with this symbol
    /** @internal */ constEnumOnlyModule: boolean | undefined; // True if module contains only const enums or other modules with only const enums
    /** @internal */ isReferenced?: (SymbolFlags) | undefined; // True if the symbol is referenced elsewhere. Keeps track of the meaning of a reference in case a symbol is both a type parameter and parameter.
    /** @internal */ lastAssignmentPos?: (number) | undefined; // Source position of last node that assigns value to symbol. Negative if it is assigned anywhere definitely
    /** @internal */ isReplaceableByMethod?: boolean; // Can this Javascript class property be replaced by a method symbol?
    /** @internal */ assignmentDeclarationMembers?: Map<number, Declaration>; // detected late-bound assignment declarations associated with the symbol
}
// dprint-ignore
/** @internal */
export interface SymbolLinks {
    checkFlags?: CheckFlags;
    immediateTarget?: Symbol; // Immediate target of an alias. May be another alias. Do not access directly, use `checker.getImmediateAliasedSymbol` instead.
    aliasTarget?: Symbol; // Resolved (non-alias) target of an alias
    target?: Symbol; // Original version of an instantiated symbol
    type?: (Type) | undefined; // Type of value symbol
    writeType?: Type; // Type of value symbol in write contexts
    nameType?: Type; // Type associated with a late-bound symbol
    uniqueESSymbolType?: Type; // UniqueESSymbol type for a symbol
    declaredType?: Type; // Type of class, interface, enum, type alias, or type parameter
    typeParameters?: TypeParameter[]; // Type parameters of type alias (undefined if non-generic)
    instantiations?: Map<string, Type>; // Instantiations of generic type alias (undefined if non-generic)
    inferredClassSymbol?: Map<SymbolId, TransientSymbol>; // Symbol of an inferred ES5 constructor function
    mapper?: TypeMapper; // Type mapper for instantiation alias
    referenced?: boolean; // True if alias symbol has been referenced as a value that can be emitted
    containingType?: UnionOrIntersectionType; // Containing union or intersection type for synthetic property
    leftSpread?: Symbol; // Left source for synthetic spread property
    rightSpread?: Symbol; // Right source for synthetic spread property
    syntheticOrigin?: Symbol; // For a property on a mapped or spread type, points back to the original property
    isDiscriminantProperty?: boolean; // True if discriminant synthetic property
    resolvedExports?: (SymbolTable) | undefined; // Resolved exports of module or combined early- and late-bound static members of a class.
    resolvedMembers?: (SymbolTable) | undefined; // Combined early- and late-bound members of a symbol
    exportsChecked?: boolean; // True if exports of external module have been checked
    typeParametersChecked?: boolean; // True if type parameters of merged class and interface declarations have been checked.
    isDeclarationWithCollidingName?: boolean; // True if symbol is block scoped redeclaration
    originatingImport?: ImportDeclaration | ImportCall; // Import declaration which produced the symbol, present if the symbol is marked as uncallable but had call signatures in `resolveESModuleSymbol`
    lateSymbol?: Symbol; // Late-bound symbol for a computed property
    specifierCache?: Map<ModeAwareCacheKey, string>; // For symbols corresponding to external modules, a cache of incoming path -> module specifier name mappings
    extendedContainers?: Symbol[]; // Containers (other than the parent) which this symbol is aliased in
    extendedContainersByFile?: Map<NodeId, Symbol[]>; // Containers (other than the parent) which this symbol is aliased in
    variances?: VarianceFlags[]; // Alias symbol type argument variance cache
    deferralConstituents?: Type[]; // Calculated list of constituents for a deferred type
    deferralWriteConstituents?: Type[]; // Constituents of a deferred `writeType`
    deferralParent?: Type; // Source union/intersection of a deferred type
    cjsExportMerged?: Symbol; // Version of the symbol with all non export= exports merged with the export= target
    typeOnlyDeclaration?: TypeOnlyAliasDeclaration | false; // First resolved alias declaration that makes the symbol only usable in type constructs
    typeOnlyExportStarMap?: Map<__String, ExportDeclaration & {
        isTypeOnly: true;
        moduleSpecifier: Expression;
    }>; // Set on a module symbol when some of its exports were resolved through a 'export type * from "mod"' declaration
    typeOnlyExportStarName?: __String; // Set to the name of the symbol re-exported by an 'export type *' declaration, when different from the symbol name
    isConstructorDeclaredProperty?: boolean; // Property declared through 'this.x = ...' assignment in constructor
    tupleLabelDeclaration?: NamedTupleMember | ParameterDeclaration; // Declaration associated with the tuple's label
    accessibleChainCache?: Map<string, Symbol[] | undefined>;
    filteredIndexSymbolCache?: Map<string, Symbol>; //Symbol with applicable declarations
    requestedExternalEmitHelpers?: ExternalEmitHelpers; // External emit helpers already checked for this symbol.
}
// dprint-ignore
/** @internal */
export type CheckFlags = number;
// dprint-ignore
/** @internal */
export const CheckFlags: {
    readonly None: 0;
    readonly Instantiated: 1;
    readonly SyntheticProperty: 2;
    readonly SyntheticMethod: 4;
    readonly Readonly: 8;
    readonly ReadPartial: 16;
    readonly WritePartial: 32;
    readonly HasNonUniformType: 64;
    readonly HasLiteralType: 128;
    readonly ContainsPublic: 256;
    readonly ContainsProtected: 512;
    readonly ContainsPrivate: 1024;
    readonly ContainsStatic: 2048;
    readonly Late: 4096;
    readonly ReverseMapped: 8192;
    readonly OptionalParameter: 16384;
    readonly RestParameter: 32768;
    readonly DeferredType: 65536;
    readonly HasNeverType: 131072;
    readonly Mapped: 262144;
    readonly StripOptional: 524288;
    readonly Unresolved: 1048576;
    readonly Synthetic: 6;
    readonly Discriminant: 192;
    readonly Partial: 48;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Instantiated: 1,
    "1": "Instantiated",
    SyntheticProperty: 2,
    "2": "SyntheticProperty",
    SyntheticMethod: 4,
    "4": "SyntheticMethod",
    Readonly: 8,
    "8": "Readonly",
    ReadPartial: 16,
    "16": "ReadPartial",
    WritePartial: 32,
    "32": "WritePartial",
    HasNonUniformType: 64,
    "64": "HasNonUniformType",
    HasLiteralType: 128,
    "128": "HasLiteralType",
    ContainsPublic: 256,
    "256": "ContainsPublic",
    ContainsProtected: 512,
    "512": "ContainsProtected",
    ContainsPrivate: 1024,
    "1024": "ContainsPrivate",
    ContainsStatic: 2048,
    "2048": "ContainsStatic",
    Late: 4096,
    "4096": "Late",
    ReverseMapped: 8192,
    "8192": "ReverseMapped",
    OptionalParameter: 16384,
    "16384": "OptionalParameter",
    RestParameter: 32768,
    "32768": "RestParameter",
    DeferredType: 65536,
    "65536": "DeferredType",
    HasNeverType: 131072,
    "131072": "HasNeverType",
    Mapped: 262144,
    "262144": "Mapped",
    StripOptional: 524288,
    "524288": "StripOptional",
    Unresolved: 1048576,
    "1048576": "Unresolved",
    Synthetic: 6,
    "6": "Synthetic",
    Discriminant: 192,
    "192": "Discriminant",
    Partial: 48,
    "48": "Partial"
};
/** @internal */
export interface TransientSymbolLinks extends SymbolLinks {
    checkFlags?: CheckFlags;
}
/** @internal */
export interface TransientSymbol extends Symbol {
    links: TransientSymbolLinks;
}
/** @internal */
export interface MappedSymbolLinks extends TransientSymbolLinks {
    mappedType: MappedType;
    keyType: Type;
}
/** @internal */
export interface MappedSymbol extends TransientSymbol {
    links: MappedSymbolLinks;
}
/** @internal */
export interface ReverseMappedSymbolLinks extends TransientSymbolLinks {
    propertyType: Type;
    mappedType: MappedType;
    constraintType: IndexType;
}
/** @internal */
export interface ReverseMappedSymbol extends TransientSymbol {
    links: ReverseMappedSymbolLinks;
}
export type InternalSymbolName = "__call" | "__constructor" | "__new" | "__index" | "__export" | "__global" | "__missing" | "__type" | "__object" | "__jsxAttributes" | "__class" | "__function" | "__computed" | "__resolving__" | "export=" | "default" | "this" | "__instantiationExpression" | "__importAttributes";
export const InternalSymbolName: {
    readonly Call: "__call";
    readonly Constructor: "__constructor";
    readonly New: "__new";
    readonly Index: "__index";
    readonly ExportStar: "__export";
    readonly Global: "__global";
    readonly Missing: "__missing";
    readonly Type: "__type";
    readonly Object: "__object";
    readonly JSXAttributes: "__jsxAttributes";
    readonly Class: "__class";
    readonly Function: "__function";
    readonly Computed: "__computed";
    readonly Resolving: "__resolving__";
    readonly ExportEquals: "export=";
    readonly Default: "default";
    readonly This: "this";
    readonly InstantiationExpression: "__instantiationExpression";
    readonly ImportAttributes: "__importAttributes";
} = {
    Call: "__call",
    Constructor: "__constructor",
    New: "__new",
    Index: "__index",
    ExportStar: "__export",
    Global: "__global",
    Missing: "__missing",
    Type: "__type",
    Object: "__object",
    JSXAttributes: "__jsxAttributes",
    Class: "__class",
    Function: "__function",
    Computed: "__computed",
    Resolving: "__resolving__",
    ExportEquals: "export=",
    Default: "default",
    This: "this",
    InstantiationExpression: "__instantiationExpression",
    ImportAttributes: "__importAttributes"
};
/**
 * This represents a string whose leading underscore have been escaped by adding extra leading underscores.
 * The shape of this brand is rather unique compared to others we've used.
 * Instead of just an intersection of a string and an object, it is that union-ed
 * with an intersection of void and an object. This makes it wholly incompatible
 * with a normal string (which is good, it cannot be misused on assignment or on usage),
 * while still being comparable with a normal string via === (also good) and castable from a string.
 */
export type __String = string;
/** @deprecated Use ReadonlyMap<__String, T> instead. */
export type ReadonlyUnderscoreEscapedMap<T> = ReadonlyMap<__String, T>;
/** @deprecated Use Map<__String, T> instead. */
export type UnderscoreEscapedMap<T> = Map<__String, T>;
/** SymbolTable based on ES6 Map interface. */
export type SymbolTable = Map<__String, Symbol>;
/**
 * Used to track a `declare module "foo*"`-like declaration.
 *
 * @internal
 */
export interface PatternAmbientModule {
    pattern: Pattern;
    symbol: Symbol;
}
// dprint-ignore
/** @internal */
export type NodeCheckFlags = number;
// dprint-ignore
/** @internal */
export const NodeCheckFlags: {
    readonly None: 0;
    readonly TypeChecked: 1;
    readonly LexicalThis: 2;
    readonly CaptureThis: 4;
    readonly CaptureNewTarget: 8;
    readonly SuperInstance: 16;
    readonly SuperStatic: 32;
    readonly ContextChecked: 64;
    readonly MethodWithSuperPropertyAccessInAsync: 128;
    readonly MethodWithSuperPropertyAssignmentInAsync: 256;
    readonly CaptureArguments: 512;
    readonly EnumValuesComputed: 1024;
    readonly LexicalModuleMergesWithClass: 2048;
    readonly LoopWithCapturedBlockScopedBinding: 4096;
    readonly ContainsCapturedBlockScopeBinding: 8192;
    readonly CapturedBlockScopedBinding: 16384;
    readonly BlockScopedBindingInLoop: 32768;
    readonly NeedsLoopOutParameter: 65536;
    readonly AssignmentsMarked: 131072;
    readonly ContainsConstructorReference: 262144;
    readonly ConstructorReference: 536870912;
    readonly ContainsClassWithPrivateIdentifiers: 1048576;
    readonly ContainsSuperPropertyInStaticInitializer: 2097152;
    readonly InCheckIdentifier: 4194304;
    readonly PartiallyTypeChecked: 8388608;
    readonly LazyFlags: 539358128;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    TypeChecked: 1,
    "1": "TypeChecked",
    LexicalThis: 2,
    "2": "LexicalThis",
    CaptureThis: 4,
    "4": "CaptureThis",
    CaptureNewTarget: 8,
    "8": "CaptureNewTarget",
    SuperInstance: 16,
    "16": "SuperInstance",
    SuperStatic: 32,
    "32": "SuperStatic",
    ContextChecked: 64,
    "64": "ContextChecked",
    MethodWithSuperPropertyAccessInAsync: 128,
    "128": "MethodWithSuperPropertyAccessInAsync",
    MethodWithSuperPropertyAssignmentInAsync: 256,
    "256": "MethodWithSuperPropertyAssignmentInAsync",
    CaptureArguments: 512,
    "512": "CaptureArguments",
    EnumValuesComputed: 1024,
    "1024": "EnumValuesComputed",
    LexicalModuleMergesWithClass: 2048,
    "2048": "LexicalModuleMergesWithClass",
    LoopWithCapturedBlockScopedBinding: 4096,
    "4096": "LoopWithCapturedBlockScopedBinding",
    ContainsCapturedBlockScopeBinding: 8192,
    "8192": "ContainsCapturedBlockScopeBinding",
    CapturedBlockScopedBinding: 16384,
    "16384": "CapturedBlockScopedBinding",
    BlockScopedBindingInLoop: 32768,
    "32768": "BlockScopedBindingInLoop",
    NeedsLoopOutParameter: 65536,
    "65536": "NeedsLoopOutParameter",
    AssignmentsMarked: 131072,
    "131072": "AssignmentsMarked",
    ContainsConstructorReference: 262144,
    "262144": "ContainsConstructorReference",
    ConstructorReference: 536870912,
    "536870912": "ConstructorReference",
    ContainsClassWithPrivateIdentifiers: 1048576,
    "1048576": "ContainsClassWithPrivateIdentifiers",
    ContainsSuperPropertyInStaticInitializer: 2097152,
    "2097152": "ContainsSuperPropertyInStaticInitializer",
    InCheckIdentifier: 4194304,
    "4194304": "InCheckIdentifier",
    PartiallyTypeChecked: 8388608,
    "8388608": "PartiallyTypeChecked",
    LazyFlags: 539358128,
    "539358128": "LazyFlags"
};
/** @internal */
export interface EvaluatorResult<T extends string | number | undefined = string | number | undefined> {
    value: T;
    isSyntacticallyString: boolean;
    resolvedOtherFiles: boolean;
    hasExternalReferences: boolean;
}
// dprint-ignore
/** @internal */
export interface NodeLinks {
    flags: NodeCheckFlags; // Set of flags specific to Node
    calculatedFlags?: NodeCheckFlags; // Set of flags which have definitely been calculated already
    resolvedType?: Type; // Cached type of type node
    resolvedSignature?: (Signature) | undefined; // Cached signature of signature node or call expression
    resolvedSymbol?: Symbol; // Cached name resolution result
    effectsSignature?: Signature; // Signature with possible control flow effects
    enumMemberValue?: EvaluatorResult; // Constant value of enum member
    isVisible?: boolean; // Is this node visible
    containsArgumentsReference?: boolean; // Whether a function-like declaration contains an 'arguments' reference
    hasReportedStatementInAmbientContext?: boolean; // Cache boolean if we report statements in ambient context
    jsxFlags?: JsxFlags; // flags for knowing what kind of element/attributes we're dealing with
    resolvedJsxElementAttributesType?: Type; // resolved element attributes type of a JSX openinglike element
    resolvedJSDocType?: Type; // Resolved type of a JSDoc type reference
    switchTypes?: Type[]; // Cached array of switch case expression types
    jsxNamespace?: Symbol | false; // Resolved jsx namespace symbol for this node
    jsxImplicitImportContainer?: Symbol | false; // Resolved module symbol the implicit jsx import of this file should refer to
    jsxFragmentType?: Type; // Type of the JSX fragment element, set per SourceFile if a jsxFragment is checked in the file
    contextFreeType?: Type; // Cached context-free type used by the first pass of inference; used when a function's return is partially contextually sensitive
    deferredNodes?: (Set<Node>) | undefined; // Set of nodes whose checking has been deferred
    capturedBlockScopeBindings?: Symbol[]; // Block-scoped bindings captured beneath this part of an IterationStatement
    outerTypeParameters?: TypeParameter[]; // Outer type parameters of anonymous object type
    isExhaustive?: boolean | 0; // Is node an exhaustive switch statement (0 indicates in-process resolution)
    skipDirectInference?: (true) | undefined; // Flag set by the API `getContextualType` call on a node when `Completions` is passed to force the checker to skip making inferences to a node's type
    declarationRequiresScopeChange?: boolean; // Set by `useOuterVariableScopeInParameter` in checker when downlevel emit would change the name resolution scope inside of a parameter.
    serializedTypes?: Map<string, SerializedTypeEntry>; // Collection of types serialized at this location
    decoratorSignature?: Signature; // Signature for decorator as if invoked by the runtime.
    spreadIndices?: {
        first: number | undefined;
        last: number | undefined;
    }; // Indices of first and last spread elements in array literal
    parameterInitializerContainsUndefined?: boolean; // True if this is a parameter declaration whose type annotation contains "undefined".
    fakeScopeForSignatureDeclaration?: "params" | "typeParams"; // If present, this is a fake scope injected into an enclosing declaration chain.
    assertionExpressionType?: Type; // Cached type of the expression of a type assertion
    potentialThisCollisions?: Node[];
    potentialNewTargetCollisions?: Node[];
    potentialWeakMapSetCollisions?: Node[];
    potentialReflectCollisions?: Node[];
    potentialUnusedRenamedBindingElementsInTypes?: BindingElement[];
    externalHelpersModule?: Symbol; // Resolved symbol for the external helpers module
    instantiationExpressionTypes?: Map<number, Type>; // Cache of instantiation expression types for the node
    nonExistentPropCheckCache?: Set<string>;
}
/** @internal */
export type TrackedSymbol = [
    symbol: Symbol,
    enclosingDeclaration: Node | undefined,
    meaning: SymbolFlags
];
/** @internal */
export interface SerializedTypeEntry {
    node: TypeNode;
    truncating?: boolean;
    addedLength: number;
    trackedSymbols: readonly TrackedSymbol[] | undefined;
}
// dprint-ignore
export type TypeFlags = number;
// dprint-ignore
export const TypeFlags: {
    readonly Any: 1;
    readonly Unknown: 2;
    readonly String: 4;
    readonly Number: 8;
    readonly Boolean: 16;
    readonly Enum: 32;
    readonly BigInt: 64;
    readonly StringLiteral: 128;
    readonly NumberLiteral: 256;
    readonly BooleanLiteral: 512;
    readonly EnumLiteral: 1024;
    readonly BigIntLiteral: 2048;
    readonly ESSymbol: 4096;
    readonly UniqueESSymbol: 8192;
    readonly Void: 16384;
    readonly Undefined: 32768;
    readonly Null: 65536;
    readonly Never: 131072;
    readonly TypeParameter: 262144;
    readonly Object: 524288;
    readonly Union: 1048576;
    readonly Intersection: 2097152;
    readonly Index: 4194304;
    readonly IndexedAccess: 8388608;
    readonly Conditional: 16777216;
    readonly Substitution: 33554432;
    readonly NonPrimitive: 67108864;
    readonly TemplateLiteral: 134217728;
    readonly StringMapping: 268435456;
    readonly Reserved1: 536870912;
    readonly Reserved2: 1073741824;
    readonly AnyOrUnknown: 3;
    readonly Nullable: 98304;
    readonly Literal: 2944;
    readonly Unit: 109472;
    readonly Freshable: 2976;
    readonly StringOrNumberLiteral: 384;
    readonly StringOrNumberLiteralOrUnique: 8576;
    readonly DefinitelyFalsy: 117632;
    readonly PossiblyFalsy: 117724;
    readonly Intrinsic: 67359327;
    readonly StringLike: 402653316;
    readonly NumberLike: 296;
    readonly BigIntLike: 2112;
    readonly BooleanLike: 528;
    readonly EnumLike: 1056;
    readonly ESSymbolLike: 12288;
    readonly VoidLike: 49152;
    readonly Primitive: 402784252;
    readonly DefinitelyNonNullable: 470302716;
    readonly DisjointDomains: 469892092;
    readonly UnionOrIntersection: 3145728;
    readonly StructuredType: 3670016;
    readonly TypeVariable: 8650752;
    readonly InstantiableNonPrimitive: 58982400;
    readonly InstantiablePrimitive: 406847488;
    readonly Instantiable: 465829888;
    readonly StructuredOrInstantiable: 469499904;
    readonly ObjectFlagsType: 3899393;
    readonly Simplifiable: 25165824;
    readonly Singleton: 67358815;
    readonly Narrowable: 536624127;
    readonly IncludesMask: 473694207;
    readonly IncludesMissingType: 262144;
    readonly IncludesNonWideningType: 4194304;
    readonly IncludesWildcard: 8388608;
    readonly IncludesEmptyObject: 16777216;
    readonly IncludesInstantiable: 33554432;
    readonly IncludesConstrainedTypeVariable: 536870912;
    readonly IncludesError: 1073741824;
    readonly NotPrimitiveUnion: 36323331;
    [index: number]: string;
} = {
    Any: 1,
    "1": "Any",
    Unknown: 2,
    "2": "Unknown",
    String: 4,
    "4": "String",
    Number: 8,
    "8": "Number",
    Boolean: 16,
    "16": "Boolean",
    Enum: 32,
    "32": "Enum",
    BigInt: 64,
    "64": "BigInt",
    StringLiteral: 128,
    "128": "StringLiteral",
    NumberLiteral: 256,
    "256": "NumberLiteral",
    BooleanLiteral: 512,
    "512": "BooleanLiteral",
    EnumLiteral: 1024,
    "1024": "EnumLiteral",
    BigIntLiteral: 2048,
    "2048": "BigIntLiteral",
    ESSymbol: 4096,
    "4096": "ESSymbol",
    UniqueESSymbol: 8192,
    "8192": "UniqueESSymbol",
    Void: 16384,
    "16384": "Void",
    Undefined: 32768,
    "32768": "Undefined",
    Null: 65536,
    "65536": "Null",
    Never: 131072,
    "131072": "Never",
    TypeParameter: 262144,
    "262144": "IncludesMissingType",
    Object: 524288,
    "524288": "Object",
    Union: 1048576,
    "1048576": "Union",
    Intersection: 2097152,
    "2097152": "Intersection",
    Index: 4194304,
    "4194304": "IncludesNonWideningType",
    IndexedAccess: 8388608,
    "8388608": "IncludesWildcard",
    Conditional: 16777216,
    "16777216": "IncludesEmptyObject",
    Substitution: 33554432,
    "33554432": "IncludesInstantiable",
    NonPrimitive: 67108864,
    "67108864": "NonPrimitive",
    TemplateLiteral: 134217728,
    "134217728": "TemplateLiteral",
    StringMapping: 268435456,
    "268435456": "StringMapping",
    Reserved1: 536870912,
    "536870912": "IncludesConstrainedTypeVariable",
    Reserved2: 1073741824,
    "1073741824": "IncludesError",
    AnyOrUnknown: 3,
    "3": "AnyOrUnknown",
    Nullable: 98304,
    "98304": "Nullable",
    Literal: 2944,
    "2944": "Literal",
    Unit: 109472,
    "109472": "Unit",
    Freshable: 2976,
    "2976": "Freshable",
    StringOrNumberLiteral: 384,
    "384": "StringOrNumberLiteral",
    StringOrNumberLiteralOrUnique: 8576,
    "8576": "StringOrNumberLiteralOrUnique",
    DefinitelyFalsy: 117632,
    "117632": "DefinitelyFalsy",
    PossiblyFalsy: 117724,
    "117724": "PossiblyFalsy",
    Intrinsic: 67359327,
    "67359327": "Intrinsic",
    StringLike: 402653316,
    "402653316": "StringLike",
    NumberLike: 296,
    "296": "NumberLike",
    BigIntLike: 2112,
    "2112": "BigIntLike",
    BooleanLike: 528,
    "528": "BooleanLike",
    EnumLike: 1056,
    "1056": "EnumLike",
    ESSymbolLike: 12288,
    "12288": "ESSymbolLike",
    VoidLike: 49152,
    "49152": "VoidLike",
    Primitive: 402784252,
    "402784252": "Primitive",
    DefinitelyNonNullable: 470302716,
    "470302716": "DefinitelyNonNullable",
    DisjointDomains: 469892092,
    "469892092": "DisjointDomains",
    UnionOrIntersection: 3145728,
    "3145728": "UnionOrIntersection",
    StructuredType: 3670016,
    "3670016": "StructuredType",
    TypeVariable: 8650752,
    "8650752": "TypeVariable",
    InstantiableNonPrimitive: 58982400,
    "58982400": "InstantiableNonPrimitive",
    InstantiablePrimitive: 406847488,
    "406847488": "InstantiablePrimitive",
    Instantiable: 465829888,
    "465829888": "Instantiable",
    StructuredOrInstantiable: 469499904,
    "469499904": "StructuredOrInstantiable",
    ObjectFlagsType: 3899393,
    "3899393": "ObjectFlagsType",
    Simplifiable: 25165824,
    "25165824": "Simplifiable",
    Singleton: 67358815,
    "67358815": "Singleton",
    Narrowable: 536624127,
    "536624127": "Narrowable",
    IncludesMask: 473694207,
    "473694207": "IncludesMask",
    IncludesMissingType: 262144,
    IncludesNonWideningType: 4194304,
    IncludesWildcard: 8388608,
    IncludesEmptyObject: 16777216,
    IncludesInstantiable: 33554432,
    IncludesConstrainedTypeVariable: 536870912,
    IncludesError: 1073741824,
    NotPrimitiveUnion: 36323331,
    "36323331": "NotPrimitiveUnion"
};
export type DestructuringPattern = BindingPattern | ObjectLiteralExpression | ArrayLiteralExpression;
/** @internal */
export type TypeId = number;
// Properties common to all types
// dprint-ignore
export interface Type {
    /** Caches attached lazily by the original checker. */
    promisedTypeOfPromise?: Type;
    awaitedTypeOfType?: Type;
    defaultOnlyType?: Type;
    syntheticType?: Type;
    /** Attached by the original optional debug instrumentation. */
    __debugTypeToString?: () => string;
    flags: TypeFlags; // Flags
    /** @internal */ id: TypeId; // Unique ID
    /** @internal */ checker?: TypeChecker;
    symbol: Symbol | undefined; // Symbol associated with type (if any)
    pattern?: DestructuringPattern; // Destructuring pattern represented by type (if any)
    aliasSymbol?: Symbol; // Alias associated with type
    aliasTypeArguments?: readonly Type[]; // Alias type arguments (if any)
    /** @internal */
    permissiveInstantiation?: Type; // Instantiation with type parameters mapped to wildcard type
    /** @internal */
    restrictiveInstantiation?: Type; // Instantiation with type parameters mapped to unconstrained form
    /** @internal */
    immediateBaseConstraint?: Type; // Immediate base constraint cache
    /** @internal */
    widened?: Type; // Cached widened form of the type
}
/** @internal */
// Intrinsic types (TypeFlags.Intrinsic)
export interface IntrinsicType extends Type {
    intrinsicName: string; // Name of intrinsic type
    debugIntrinsicName: string | undefined;
    objectFlags: ObjectFlags;
}
/** @internal */
export interface NullableType extends IntrinsicType {
    objectFlags: ObjectFlags;
}
export interface FreshableType extends Type {
    freshType: FreshableType; // Fresh version of type
    regularType: FreshableType; // Regular version of type
}
/** @internal */
export interface FreshableIntrinsicType extends FreshableType, IntrinsicType {
}
// String literal types (TypeFlags.StringLiteral)
// Numeric literal types (TypeFlags.NumberLiteral)
// BigInt literal types (TypeFlags.BigIntLiteral)
export interface LiteralType extends FreshableType {
    value: string | number | PseudoBigInt; // Value of literal
}
// Unique symbol types (TypeFlags.UniqueESSymbol)
export interface UniqueESSymbolType extends Type {
    symbol: Symbol;
    escapedName: __String;
}
export interface StringLiteralType extends LiteralType {
    value: string;
}
export interface NumberLiteralType extends LiteralType {
    value: number;
}
export interface BigIntLiteralType extends LiteralType {
    value: PseudoBigInt;
}
// Enum types (TypeFlags.Enum)
export interface EnumType extends FreshableType {
}
// Types included in TypeFlags.ObjectFlagsType have an objectFlags property. Some ObjectFlags
// are specific to certain types and reuse the same bit position. Those ObjectFlags require a check
// for a certain TypeFlags value to determine their meaning.
// dprint-ignore
export type ObjectFlags = number;
// Types included in TypeFlags.ObjectFlagsType have an objectFlags property. Some ObjectFlags
// are specific to certain types and reuse the same bit position. Those ObjectFlags require a check
// for a certain TypeFlags value to determine their meaning.
// dprint-ignore
export const ObjectFlags: {
    readonly None: 0;
    readonly Class: 1;
    readonly Interface: 2;
    readonly Reference: 4;
    readonly Tuple: 8;
    readonly Anonymous: 16;
    readonly Mapped: 32;
    readonly Instantiated: 64;
    readonly ObjectLiteral: 128;
    readonly EvolvingArray: 256;
    readonly ObjectLiteralPatternWithComputedProperties: 512;
    readonly ReverseMapped: 1024;
    readonly JsxAttributes: 2048;
    readonly JSLiteral: 4096;
    readonly FreshLiteral: 8192;
    readonly ArrayLiteral: 16384;
    readonly PrimitiveUnion: 32768;
    readonly ContainsWideningType: 65536;
    readonly ContainsObjectOrArrayLiteral: 131072;
    readonly NonInferrableType: 262144;
    readonly CouldContainTypeVariablesComputed: 524288;
    readonly CouldContainTypeVariables: 1048576;
    readonly SingleSignatureType: 134217728;
    readonly ClassOrInterface: 3;
    readonly RequiresWidening: 196608;
    readonly PropagatingFlags: 458752;
    readonly InstantiatedMapped: 96;
    readonly ObjectTypeKindMask: 1343;
    readonly ContainsSpread: 2097152;
    readonly ObjectRestType: 4194304;
    readonly InstantiationExpressionType: 8388608;
    readonly IsClassInstanceClone: 16777216;
    readonly IdenticalBaseTypeCalculated: 33554432;
    readonly IdenticalBaseTypeExists: 67108864;
    readonly IsGenericTypeComputed: 2097152;
    readonly IsGenericObjectType: 4194304;
    readonly IsGenericIndexType: 8388608;
    readonly IsGenericType: 12582912;
    readonly ContainsIntersections: 16777216;
    readonly IsUnknownLikeUnionComputed: 33554432;
    readonly IsUnknownLikeUnion: 67108864;
    readonly IsNeverIntersectionComputed: 16777216;
    readonly IsNeverIntersection: 33554432;
    readonly IsConstrainedTypeVariable: 67108864;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Class: 1,
    "1": "Class",
    Interface: 2,
    "2": "Interface",
    Reference: 4,
    "4": "Reference",
    Tuple: 8,
    "8": "Tuple",
    Anonymous: 16,
    "16": "Anonymous",
    Mapped: 32,
    "32": "Mapped",
    Instantiated: 64,
    "64": "Instantiated",
    ObjectLiteral: 128,
    "128": "ObjectLiteral",
    EvolvingArray: 256,
    "256": "EvolvingArray",
    ObjectLiteralPatternWithComputedProperties: 512,
    "512": "ObjectLiteralPatternWithComputedProperties",
    ReverseMapped: 1024,
    "1024": "ReverseMapped",
    JsxAttributes: 2048,
    "2048": "JsxAttributes",
    JSLiteral: 4096,
    "4096": "JSLiteral",
    FreshLiteral: 8192,
    "8192": "FreshLiteral",
    ArrayLiteral: 16384,
    "16384": "ArrayLiteral",
    PrimitiveUnion: 32768,
    "32768": "PrimitiveUnion",
    ContainsWideningType: 65536,
    "65536": "ContainsWideningType",
    ContainsObjectOrArrayLiteral: 131072,
    "131072": "ContainsObjectOrArrayLiteral",
    NonInferrableType: 262144,
    "262144": "NonInferrableType",
    CouldContainTypeVariablesComputed: 524288,
    "524288": "CouldContainTypeVariablesComputed",
    CouldContainTypeVariables: 1048576,
    "1048576": "CouldContainTypeVariables",
    SingleSignatureType: 134217728,
    "134217728": "SingleSignatureType",
    ClassOrInterface: 3,
    "3": "ClassOrInterface",
    RequiresWidening: 196608,
    "196608": "RequiresWidening",
    PropagatingFlags: 458752,
    "458752": "PropagatingFlags",
    InstantiatedMapped: 96,
    "96": "InstantiatedMapped",
    ObjectTypeKindMask: 1343,
    "1343": "ObjectTypeKindMask",
    ContainsSpread: 2097152,
    "2097152": "IsGenericTypeComputed",
    ObjectRestType: 4194304,
    "4194304": "IsGenericObjectType",
    InstantiationExpressionType: 8388608,
    "8388608": "IsGenericIndexType",
    IsClassInstanceClone: 16777216,
    "16777216": "IsNeverIntersectionComputed",
    IdenticalBaseTypeCalculated: 33554432,
    "33554432": "IsNeverIntersection",
    IdenticalBaseTypeExists: 67108864,
    "67108864": "IsConstrainedTypeVariable",
    IsGenericTypeComputed: 2097152,
    IsGenericObjectType: 4194304,
    IsGenericIndexType: 8388608,
    IsGenericType: 12582912,
    "12582912": "IsGenericType",
    ContainsIntersections: 16777216,
    IsUnknownLikeUnionComputed: 33554432,
    IsUnknownLikeUnion: 67108864,
    IsNeverIntersectionComputed: 16777216,
    IsNeverIntersection: 33554432,
    IsConstrainedTypeVariable: 67108864
};
/** @internal */
export type ObjectFlagsType = NullableType | ObjectType | UnionType | IntersectionType;
// Object types (TypeFlags.ObjectType)
// dprint-ignore
export interface ObjectType extends Type {
    /** Cached mapped-type error state is absent on the other object types. */
    containsError?: boolean;
    objectFlags: ObjectFlags;
    /** @internal */ members?: (SymbolTable) | undefined; // Properties by name
    /** @internal */ properties?: (Symbol[]) | undefined; // Properties
    /** @internal */ callSignatures?: (readonly Signature[]) | undefined; // Call signatures of type
    /** @internal */ constructSignatures?: (readonly Signature[]) | undefined; // Construct signatures of type
    /** @internal */ indexInfos?: (readonly IndexInfo[]) | undefined; // Index signatures
    /** @internal */ objectTypeWithoutAbstractConstructSignatures?: ObjectType;
}
/** Class and interface types (ObjectFlags.Class and ObjectFlags.Interface). */
// dprint-ignore
export interface InterfaceType extends ObjectType {
    typeParameters: TypeParameter[] | undefined; // Type parameters (undefined if non-generic)
    outerTypeParameters: TypeParameter[] | undefined; // Outer type parameters (undefined if none)
    localTypeParameters: TypeParameter[] | undefined; // Local type parameters (undefined if none)
    thisType: TypeParameter | undefined; // The "this" type (undefined if none)
    /** @internal */
    resolvedBaseConstructorType?: Type; // Resolved base constructor type of class
    /** @internal */
    resolvedBaseTypes: BaseType[]; // Resolved base types
    /** @internal */
    baseTypesResolved?: boolean;
}
// Object type or intersection of object types
export type BaseType = ObjectType | IntersectionType | TypeVariable; // Also `any` and `object`
// dprint-ignore
export interface InterfaceTypeWithDeclaredMembers extends InterfaceType {
    declaredProperties: Symbol[]; // Declared members
    declaredCallSignatures: Signature[]; // Declared call signatures
    declaredConstructSignatures: Signature[]; // Declared construct signatures
    declaredIndexInfos: IndexInfo[]; // Declared index signatures
}
/**
 * Type references (ObjectFlags.Reference). When a class or interface has type parameters or
 * a "this" type, references to the class or interface are made using type references. The
 * typeArguments property specifies the types to substitute for the type parameters of the
 * class or interface and optionally includes an extra element that specifies the type to
 * substitute for "this" in the resulting instantiation. When no extra argument is present,
 * the type reference itself is substituted for "this". The typeArguments property is undefined
 * if the class or interface has no type parameters and the reference isn't specifying an
 * explicit "this" argument.
 */
export interface TypeReference extends ObjectType {
    target: GenericType; // Type reference target
    node?: TypeReferenceNode | ArrayTypeNode | TupleTypeNode;
    /** @internal */
    mapper?: TypeMapper;
    /** @internal */
    resolvedTypeArguments?: readonly Type[]; // Resolved type reference type arguments
    /** @internal */
    literalType?: TypeReference; // Clone of type with ObjectFlags.ArrayLiteral set
    /** @internal */
    cachedEquivalentBaseType?: Type; // Only set on references to class or interfaces with a single base type and no augmentations
}
export interface DeferredTypeReference extends TypeReference {
    /** @internal */
    node: TypeReferenceNode | ArrayTypeNode | TupleTypeNode;
    /** @internal */
    mapper?: TypeMapper;
    /** @internal */
    instantiations?: Map<string, Type>; // Instantiations of generic type alias (undefined if non-generic)
}
// dprint-ignore
/** @internal */
export type VarianceFlags = number;
// dprint-ignore
/** @internal */
export const VarianceFlags: {
    readonly Invariant: 0;
    readonly Covariant: 1;
    readonly Contravariant: 2;
    readonly Bivariant: 3;
    readonly Independent: 4;
    readonly VarianceMask: 7;
    readonly Unmeasurable: 8;
    readonly Unreliable: 16;
    readonly AllowsStructuralFallback: 24;
    [index: number]: string;
} = {
    Invariant: 0,
    "0": "Invariant",
    Covariant: 1,
    "1": "Covariant",
    Contravariant: 2,
    "2": "Contravariant",
    Bivariant: 3,
    "3": "Bivariant",
    Independent: 4,
    "4": "Independent",
    VarianceMask: 7,
    "7": "VarianceMask",
    Unmeasurable: 8,
    "8": "Unmeasurable",
    Unreliable: 16,
    "16": "Unreliable",
    AllowsStructuralFallback: 24,
    "24": "AllowsStructuralFallback"
};
// Generic class and interface types
export interface GenericType extends InterfaceType, TypeReference {
    /** @internal */
    instantiations: Map<string, TypeReference>; // Generic instantiation cache
    /** @internal */
    variances?: VarianceFlags[]; // Variance of each type parameter
}
// dprint-ignore
export type ElementFlags = number;
// dprint-ignore
export const ElementFlags: {
    readonly Required: 1;
    readonly Optional: 2;
    readonly Rest: 4;
    readonly Variadic: 8;
    readonly Fixed: 3;
    readonly Variable: 12;
    readonly NonRequired: 14;
    readonly NonRest: 11;
    [index: number]: string;
} = {
    Required: 1,
    "1": "Required",
    Optional: 2,
    "2": "Optional",
    Rest: 4,
    "4": "Rest",
    Variadic: 8,
    "8": "Variadic",
    Fixed: 3,
    "3": "Fixed",
    Variable: 12,
    "12": "Variable",
    NonRequired: 14,
    "14": "NonRequired",
    NonRest: 11,
    "11": "NonRest"
};
export interface TupleType extends GenericType {
    elementFlags: readonly ElementFlags[];
    /** Number of required or variadic elements */
    minLength: number;
    /** Number of initial required or optional elements */
    fixedLength: number;
    /**
     * True if tuple has any rest or variadic elements
     *
     * @deprecated Use `.combinedFlags & ElementFlags.Variable` instead
     */
    hasRestElement: boolean;
    combinedFlags: ElementFlags;
    readonly: boolean;
    labeledElementDeclarations?: readonly (NamedTupleMember | ParameterDeclaration | undefined)[];
}
export interface TupleTypeReference extends TypeReference {
    target: TupleType;
}
export interface UnionOrIntersectionType extends Type {
    /** Structured member tables are populated by the same resolver used for object types. */
    members?: SymbolTable;
    properties?: Symbol[];
    callSignatures?: readonly Signature[];
    constructSignatures?: readonly Signature[];
    indexInfos?: readonly IndexInfo[];

    types: Type[]; // Constituent types
    /** @internal */
    objectFlags: ObjectFlags;
    /** @internal */
    propertyCache?: SymbolTable; // Cache of resolved properties
    /** @internal */
    propertyCacheWithoutObjectFunctionPropertyAugment?: SymbolTable; // Cache of resolved properties that does not augment function or object type properties
    /** @internal */
    resolvedProperties: Symbol[];
    /** @internal */
    resolvedIndexType: IndexType;
    /** @internal */
    resolvedStringIndexType: IndexType;
    /** @internal */
    resolvedBaseConstraint: Type;
}
export interface UnionType extends UnionOrIntersectionType {
    /** @internal */
    resolvedReducedType?: Type;
    /** @internal */
    regularType?: UnionType;
    /** @internal */
    origin?: Type; // Denormalized union, intersection, or index type in which union originates
    /** @internal */
    keyPropertyName?: __String; // Property with unique unit type that exists in every object/intersection in union type
    /** @internal */
    constituentMap?: Map<TypeId, Type> | ""; // Constituents keyed by unit type discriminants
    /** @internal */
    arrayFallbackSignatures?: readonly Signature[]; // Special remapped signature list for unions of arrays
}
export interface IntersectionType extends UnionOrIntersectionType {
    /** @internal */
    resolvedApparentType: Type;
    /** @internal */
    uniqueLiteralFilledInstantiation?: Type; // Instantiation with type parameters mapped to never type
}
export type StructuredType = ObjectType | UnionType | IntersectionType;
/** @internal */
// An instantiated anonymous type has a target and a mapper
export interface AnonymousType extends ObjectType {
    target?: AnonymousType; // Instantiation target
    mapper?: TypeMapper; // Instantiation mapper
    instantiations?: Map<string, Type>; // Instantiations of generic type alias (undefined if non-generic)
}
/** @internal */
export interface InstantiationExpressionType extends AnonymousType {
    node: NodeWithTypeArguments;
}
/** @internal */
export interface MappedType extends AnonymousType {
    declaration: MappedTypeNode;
    typeParameter?: TypeParameter;
    constraintType?: Type;
    nameType?: Type;
    templateType?: Type;
    modifiersType?: Type;
    resolvedApparentType?: Type;
    containsError?: boolean;
}
export interface EvolvingArrayType extends ObjectType {
    elementType: Type; // Element expressions of evolving array type
    finalArrayType?: Type; // Final array type of evolving array type
}
/** @internal */
export interface ReverseMappedType extends ObjectType {
    source: Type;
    mappedType: MappedType;
    constraintType: IndexType;
}
/** @internal */
// Resolved object, union, or intersection type
// dprint-ignore
export interface ResolvedType extends ObjectType {
    /** Union/intersection caches are absent on the other resolved object types. */
    types?: Type[];
    propertyCache?: SymbolTable;
    propertyCacheWithoutObjectFunctionPropertyAugment?: SymbolTable;
    resolvedProperties?: Symbol[];
    resolvedIndexType?: IndexType;
    resolvedStringIndexType?: IndexType;
    resolvedBaseConstraint?: Type;

    members: SymbolTable; // Properties by name
    properties: Symbol[]; // Properties
    callSignatures: readonly Signature[]; // Call signatures of type
    constructSignatures: readonly Signature[]; // Construct signatures of type
    indexInfos: readonly IndexInfo[]; // Index signatures
}
/** @internal */
// Object literals are initially marked fresh. Freshness disappears following an assignment,
// before a type assertion, or when an object literal's type is widened. The regular
// version of a fresh type is identical except for the TypeFlags.FreshObjectLiteral flag.
export interface FreshObjectLiteralType extends ResolvedType {
    regularType: ResolvedType; // Regular version of fresh type
}
/** @internal */
export interface IterationTypes {
    yieldType: Type;
    returnType: Type;
    nextType: Type;
}
// Just a place to cache element types of iterables and iterators
/** @internal */
export interface IterableOrIteratorType extends ObjectType, UnionType {
    iterationTypesOfGeneratorReturnType?: IterationTypes;
    iterationTypesOfAsyncGeneratorReturnType?: IterationTypes;
    iterationTypesOfIterable?: IterationTypes;
    iterationTypesOfIterator?: IterationTypes;
    iterationTypesOfAsyncIterable?: IterationTypes;
    iterationTypesOfAsyncIterator?: IterationTypes;
    iterationTypesOfIteratorResult?: IterationTypes;
}
/** @internal */
export interface PromiseOrAwaitableType extends ObjectType, UnionType {
    promiseTypeOfPromiseConstructor?: Type;
    promisedTypeOfPromise?: Type;
    awaitedTypeOfType?: Type;
}
/** @internal */
export interface SyntheticDefaultModuleType extends Type {
    syntheticType?: Type;
    defaultOnlyType?: Type;
}
export interface InstantiableType extends Type {
    /** @internal */
    resolvedBaseConstraint?: Type;
    /** @internal */
    resolvedIndexType?: IndexType;
    /** @internal */
    resolvedStringIndexType?: IndexType;
}
// Type parameters (TypeFlags.TypeParameter)
// dprint-ignore
export interface TypeParameter extends InstantiableType {
    /**
     * Retrieve using getConstraintFromTypeParameter
     *
     * @internal
     */
    constraint?: Type; // Constraint
    /** @internal */
    default?: Type;
    /** @internal */
    target?: TypeParameter; // Instantiation target
    /** @internal */
    mapper?: TypeMapper; // Instantiation mapper
    /** @internal */
    isThisType?: boolean;
    /** @internal */
    resolvedDefaultType?: Type;
}
/** @internal */
export type AccessFlags = number;
/** @internal */
export const AccessFlags: {
    readonly None: 0;
    readonly IncludeUndefined: 1;
    readonly NoIndexSignatures: 2;
    readonly Writing: 4;
    readonly CacheSymbol: 8;
    readonly AllowMissing: 16;
    readonly ExpressionPosition: 32;
    readonly ReportDeprecated: 64;
    readonly SuppressNoImplicitAnyError: 128;
    readonly Contextual: 256;
    readonly Persistent: 1;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    IncludeUndefined: 1,
    "1": "Persistent",
    NoIndexSignatures: 2,
    "2": "NoIndexSignatures",
    Writing: 4,
    "4": "Writing",
    CacheSymbol: 8,
    "8": "CacheSymbol",
    AllowMissing: 16,
    "16": "AllowMissing",
    ExpressionPosition: 32,
    "32": "ExpressionPosition",
    ReportDeprecated: 64,
    "64": "ReportDeprecated",
    SuppressNoImplicitAnyError: 128,
    "128": "SuppressNoImplicitAnyError",
    Contextual: 256,
    "256": "Contextual",
    Persistent: 1
};
// Indexed access types (TypeFlags.IndexedAccess)
// Possible forms are T[xxx], xxx[T], or xxx[keyof T], where T is a type variable
export interface IndexedAccessType extends InstantiableType {
    objectType: Type;
    indexType: Type;
    /** @internal */
    accessFlags: AccessFlags; // Only includes AccessFlags.Persistent
    constraint?: Type;
    simplifiedForReading?: Type;
    simplifiedForWriting?: Type;
}
export type TypeVariable = TypeParameter | IndexedAccessType;
/** @internal */
export type IndexFlags = number;
/** @internal */
export const IndexFlags: {
    readonly None: 0;
    readonly StringsOnly: 1;
    readonly NoIndexSignatures: 2;
    readonly NoReducibleCheck: 4;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    StringsOnly: 1,
    "1": "StringsOnly",
    NoIndexSignatures: 2,
    "2": "NoIndexSignatures",
    NoReducibleCheck: 4,
    "4": "NoReducibleCheck"
};
// keyof T types (TypeFlags.Index)
export interface IndexType extends InstantiableType {
    type: InstantiableType | UnionOrIntersectionType;
    /** @internal */
    indexFlags: IndexFlags;
}
export interface ConditionalRoot {
    node: ConditionalTypeNode;
    checkType: Type;
    extendsType: Type;
    isDistributive: boolean;
    inferTypeParameters?: TypeParameter[];
    outerTypeParameters?: TypeParameter[];
    instantiations?: Map<string, Type>;
    aliasSymbol?: Symbol;
    aliasTypeArguments?: Type[];
}
// T extends U ? X : Y (TypeFlags.Conditional)
export interface ConditionalType extends InstantiableType {
    root: ConditionalRoot;
    checkType: Type;
    extendsType: Type;
    resolvedTrueType?: Type;
    resolvedFalseType?: Type;
    /** @internal */
    resolvedInferredTrueType?: Type; // The `trueType` instantiated with the `combinedMapper`, if present
    /** @internal */
    resolvedDefaultConstraint?: Type;
    /** @internal */
    resolvedConstraintOfDistributive?: Type | false;
    /** @internal */
    mapper?: TypeMapper;
    /** @internal */
    combinedMapper?: TypeMapper;
}
export interface TemplateLiteralType extends InstantiableType {
    texts: readonly string[]; // Always one element longer than types
    types: readonly Type[]; // Always at least one element
}
export interface StringMappingType extends InstantiableType {
    symbol: Symbol;
    type: Type;
}
// Type parameter substitution (TypeFlags.Substitution)
// Substitution types are created for type parameters or indexed access types that occur in the
// true branch of a conditional type. For example, in 'T extends string ? Foo<T> : Bar<T>', the
// reference to T in Foo<T> is resolved as a substitution type that substitutes 'string & T' for T.
// Thus, if Foo has a 'string' constraint on its type parameter, T will satisfy it.
// Substitution type are also created for NoInfer<T> types. Those are represented as substitution
// types where the constraint is type 'unknown' (which is never generated for the case above).
export interface SubstitutionType extends InstantiableType {
    objectFlags: ObjectFlags;
    baseType: Type; // Target type
    constraint: Type; // Constraint that target type is known to satisfy
}
/** @internal */
export type JsxReferenceKind = number;
/** @internal */
export const JsxReferenceKind: {
    readonly Component: 0;
    readonly Function: 1;
    readonly Mixed: 2;
    [index: number]: string;
} = {
    Component: 0,
    "0": "Component",
    Function: 1,
    "1": "Function",
    Mixed: 2,
    "2": "Mixed"
};
export type SignatureKind = number;
export const SignatureKind: {
    readonly Call: 0;
    readonly Construct: 1;
    [index: number]: string;
} = {
    Call: 0,
    "0": "Call",
    Construct: 1,
    "1": "Construct"
};
// dprint-ignore
/** @internal */
export type SignatureFlags = number;
// dprint-ignore
/** @internal */
export const SignatureFlags: {
    readonly None: 0;
    readonly HasRestParameter: 1;
    readonly HasLiteralTypes: 2;
    readonly Abstract: 4;
    readonly IsInnerCallChain: 8;
    readonly IsOuterCallChain: 16;
    readonly IsUntypedSignatureInJSFile: 32;
    readonly IsNonInferrable: 64;
    readonly IsSignatureCandidateForOverloadFailure: 128;
    readonly PropagatingFlags: 167;
    readonly CallChainFlags: 24;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    HasRestParameter: 1,
    "1": "HasRestParameter",
    HasLiteralTypes: 2,
    "2": "HasLiteralTypes",
    Abstract: 4,
    "4": "Abstract",
    IsInnerCallChain: 8,
    "8": "IsInnerCallChain",
    IsOuterCallChain: 16,
    "16": "IsOuterCallChain",
    IsUntypedSignatureInJSFile: 32,
    "32": "IsUntypedSignatureInJSFile",
    IsNonInferrable: 64,
    "64": "IsNonInferrable",
    IsSignatureCandidateForOverloadFailure: 128,
    "128": "IsSignatureCandidateForOverloadFailure",
    PropagatingFlags: 167,
    "167": "PropagatingFlags",
    CallChainFlags: 24,
    "24": "CallChainFlags"
};
// dprint-ignore
export interface Signature {
    /** @internal */ flags: SignatureFlags;
    /** @internal */ checker?: TypeChecker;
    declaration?: SignatureDeclaration | JSDocSignature; // Originating declaration
    typeParameters?: readonly TypeParameter[]; // Type parameters (undefined if non-generic)
    parameters: readonly Symbol[]; // Parameters
    thisParameter?: Symbol; // symbol of this-type parameter
    /** @internal */
    // See comment in `instantiateSignature` for why these are set lazily.
    resolvedReturnType?: Type; // Lazily set by `getReturnTypeOfSignature`.
    /** @internal */
    // Lazily set by `getTypePredicateOfSignature`.
    // `undefined` indicates a type predicate that has not yet been computed.
    // Uses a special `noTypePredicate` sentinel value to indicate that there is no type predicate. This looks like a TypePredicate at runtime to avoid polymorphism.
    resolvedTypePredicate?: TypePredicate;
    /** @internal */
    minArgumentCount: number; // Number of non-optional parameters
    /** @internal */
    resolvedMinArgumentCount?: (number) | undefined; // Number of non-optional parameters (excluding trailing `void`)
    /** @internal */
    target?: (Signature) | undefined; // Instantiation target
    /** @internal */
    mapper?: (TypeMapper) | undefined; // Instantiation mapper
    /** @internal */
    compositeSignatures?: (Signature[]) | undefined; // Underlying signatures of a union/intersection signature
    /** @internal */
    compositeKind?: (TypeFlags) | undefined; // TypeFlags.Union if the underlying signatures are from union members, otherwise TypeFlags.Intersection
    /** @internal */
    erasedSignatureCache?: Signature; // Erased version of signature (deferred)
    /** @internal */
    canonicalSignatureCache?: Signature; // Canonical version of signature (deferred)
    /** @internal */
    baseSignatureCache?: Signature; // Base version of signature (deferred)
    /** @internal */
    optionalCallSignatureCache?: {
        inner?: Signature;
        outer?: Signature;
    }; // Optional chained call version of signature (deferred)
    /** @internal */
    isolatedSignatureType?: ObjectType; // A manufactured type that just contains the signature for purposes of signature comparison
    /** @internal */
    instantiations?: Map<string, Signature>; // Generic signature instantiation cache
}
export type IndexKind = number;
export const IndexKind: {
    readonly String: 0;
    readonly Number: 1;
    [index: number]: string;
} = {
    String: 0,
    "0": "String",
    Number: 1,
    "1": "Number"
};
export type ElementWithComputedPropertyName = (ClassElement | ObjectLiteralElement) & {
    name: ComputedPropertyName;
};
export interface IndexInfo {
    keyType: Type;
    type: Type;
    isReadonly: boolean;
    declaration?: IndexSignatureDeclaration;
    components?: ElementWithComputedPropertyName[];
}
/** @internal */
export type TypeMapKind = number;
/** @internal */
export const TypeMapKind: {
    readonly Simple: 0;
    readonly Array: 1;
    readonly Deferred: 2;
    readonly Function: 3;
    readonly Composite: 4;
    readonly Merged: 5;
    [index: number]: string;
} = {
    Simple: 0,
    "0": "Simple",
    Array: 1,
    "1": "Array",
    Deferred: 2,
    "2": "Deferred",
    Function: 3,
    "3": "Function",
    Composite: 4,
    "4": "Composite",
    Merged: 5,
    "5": "Merged"
};
/** @internal */
export type TypeMapper = ({
    kind: typeof TypeMapKind.Simple;
    source: Type;
    target: Type;
} | {
    kind: typeof TypeMapKind.Array;
    sources: readonly Type[];
    targets: readonly Type[] | undefined;
} | {
    kind: typeof TypeMapKind.Deferred;
    sources: readonly Type[];
    targets: (() => Type)[];
} | {
    kind: typeof TypeMapKind.Function;
    func: (t: Type) => Type;
    debugInfo?: () => string;
} | {
    kind: typeof TypeMapKind.Composite | typeof TypeMapKind.Merged;
    mapper1: TypeMapper;
    mapper2: TypeMapper;
}) & { __debugToString?: () => string };
// dprint-ignore
export type InferencePriority = number;
// dprint-ignore
export const InferencePriority: {
    readonly None: 0;
    readonly NakedTypeVariable: 1;
    readonly SpeculativeTuple: 2;
    readonly SubstituteSource: 4;
    readonly HomomorphicMappedType: 8;
    readonly PartialHomomorphicMappedType: 16;
    readonly MappedTypeConstraint: 32;
    readonly ContravariantConditional: 64;
    readonly ReturnType: 128;
    readonly LiteralKeyof: 256;
    readonly NoConstraints: 512;
    readonly AlwaysStrict: 1024;
    readonly MaxValue: 2048;
    readonly PriorityImpliesCombination: 416;
    readonly Circularity: -1;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NakedTypeVariable: 1,
    "1": "NakedTypeVariable",
    SpeculativeTuple: 2,
    "2": "SpeculativeTuple",
    SubstituteSource: 4,
    "4": "SubstituteSource",
    HomomorphicMappedType: 8,
    "8": "HomomorphicMappedType",
    PartialHomomorphicMappedType: 16,
    "16": "PartialHomomorphicMappedType",
    MappedTypeConstraint: 32,
    "32": "MappedTypeConstraint",
    ContravariantConditional: 64,
    "64": "ContravariantConditional",
    ReturnType: 128,
    "128": "ReturnType",
    LiteralKeyof: 256,
    "256": "LiteralKeyof",
    NoConstraints: 512,
    "512": "NoConstraints",
    AlwaysStrict: 1024,
    "1024": "AlwaysStrict",
    MaxValue: 2048,
    "2048": "MaxValue",
    PriorityImpliesCombination: 416,
    "416": "PriorityImpliesCombination",
    Circularity: -1,
    "-1": "Circularity"
};
// dprint-ignore
/** @internal */
export interface InferenceInfo {
    typeParameter: TypeParameter; // Type parameter for which inferences are being made
    candidates: Type[] | undefined; // Candidates in covariant positions (or undefined)
    contraCandidates: Type[] | undefined; // Candidates in contravariant positions (or undefined)
    inferredType?: (Type) | undefined; // Cache for resolved inferred type
    priority?: InferencePriority; // Priority of current inference set
    topLevel: boolean; // True if all inferences are to top level occurrences
    isFixed: boolean; // True if inferences are fixed
    impliedArity?: number;
}
// dprint-ignore
/** @internal */
export type InferenceFlags = number;
// dprint-ignore
/** @internal */
export const InferenceFlags: {
    readonly None: 0;
    readonly NoDefault: 1;
    readonly AnyDefault: 2;
    readonly SkippedGenericFunction: 4;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NoDefault: 1,
    "1": "NoDefault",
    AnyDefault: 2,
    "2": "AnyDefault",
    SkippedGenericFunction: 4,
    "4": "SkippedGenericFunction"
};
/**
 * Ternary values are defined such that
 * x & y picks the lesser in the order False < Unknown < Maybe < True, and
 * x | y picks the greater in the order False < Unknown < Maybe < True.
 * Generally, Ternary.Maybe is used as the result of a relation that depends on itself, and
 * Ternary.Unknown is used as the result of a variance check that depends on itself. We make
 * a distinction because we don't want to cache circular variance check results.
 *
 * @internal
 */
export type Ternary = number;
/**
 * Ternary values are defined such that
 * x & y picks the lesser in the order False < Unknown < Maybe < True, and
 * x | y picks the greater in the order False < Unknown < Maybe < True.
 * Generally, Ternary.Maybe is used as the result of a relation that depends on itself, and
 * Ternary.Unknown is used as the result of a variance check that depends on itself. We make
 * a distinction because we don't want to cache circular variance check results.
 *
 * @internal
 */
export const Ternary: {
    readonly False: 0;
    readonly Unknown: 1;
    readonly Maybe: 3;
    readonly True: -1;
    [index: number]: string;
} = {
    False: 0,
    "0": "False",
    Unknown: 1,
    "1": "Unknown",
    Maybe: 3,
    "3": "Maybe",
    True: -1,
    "-1": "True"
};
/** @internal */
export type TypeComparer = (s: Type, t: Type, reportErrors?: boolean) => Ternary;
// dprint-ignore
/** @internal */
export interface InferenceContext {
    inferences: InferenceInfo[]; // Inferences made for each type parameter
    signature?: Signature; // Generic signature for which inferences are made (if any)
    flags: InferenceFlags; // Inference flags
    compareTypes: TypeComparer; // Type comparer function
    mapper: TypeMapper; // Mapper that fixes inferences
    nonFixingMapper: TypeMapper; // Mapper that doesn't fix inferences
    returnMapper?: TypeMapper; // Type mapper for inferences from return types (if any)
    outerReturnMapper?: TypeMapper; // Type mapper for inferences from return types of outer function (if any)
    inferredTypeParameters?: readonly TypeParameter[]; // Inferred type parameters for function result
    intraExpressionInferenceSites?: (IntraExpressionInferenceSite[]) | undefined;
}
/** @internal */
export interface IntraExpressionInferenceSite {
    node: Expression | MethodDeclaration;
    type: Type;
}
// dprint-ignore
/** @internal */
export interface WideningContext {
    parent?: WideningContext; // Parent context
    propertyName?: __String; // Name of property in parent
    siblings?: Type[]; // Types of siblings
    resolvedProperties?: Symbol[]; // Properties occurring in sibling object literals
}
/** @internal */
export type AssignmentDeclarationKind = number;
/** @internal */
export const AssignmentDeclarationKind: {
    readonly None: 0;
    readonly ExportsProperty: 1;
    readonly ModuleExports: 2;
    readonly PrototypeProperty: 3;
    readonly ThisProperty: 4;
    readonly Property: 5;
    readonly Prototype: 6;
    readonly ObjectDefinePropertyValue: 7;
    readonly ObjectDefinePropertyExports: 8;
    readonly ObjectDefinePrototypeProperty: 9;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    ExportsProperty: 1,
    "1": "ExportsProperty",
    ModuleExports: 2,
    "2": "ModuleExports",
    PrototypeProperty: 3,
    "3": "PrototypeProperty",
    ThisProperty: 4,
    "4": "ThisProperty",
    Property: 5,
    "5": "Property",
    Prototype: 6,
    "6": "Prototype",
    ObjectDefinePropertyValue: 7,
    "7": "ObjectDefinePropertyValue",
    ObjectDefinePropertyExports: 8,
    "8": "ObjectDefinePropertyExports",
    ObjectDefinePrototypeProperty: 9,
    "9": "ObjectDefinePrototypeProperty"
};
export interface FileExtensionInfo {
    extension: string;
    isMixedContent: boolean;
    scriptKind?: ScriptKind;
}
export interface DiagnosticMessage {
    key: string;
    category: DiagnosticCategory;
    code: number;
    message: string;
    reportsUnnecessary?: {};
    reportsDeprecated?: {};
    /** @internal */
    elidedInCompatabilityPyramid?: boolean;
}
/** @internal */
export interface RepopulateModuleNotFoundDiagnosticChain {
    moduleReference: string;
    mode: ResolutionMode;
    packageName: string | undefined;
}
/** @internal */
export type RepopulateModeMismatchDiagnosticChain = true;
/** @internal */
export type RepopulateDiagnosticChainInfo = RepopulateModuleNotFoundDiagnosticChain | RepopulateModeMismatchDiagnosticChain;
/**
 * A linked list of formatted diagnostic messages to be used as part of a multiline message.
 * It is built from the bottom up, leaving the head to be the "main" diagnostic.
 * While it seems that DiagnosticMessageChain is structurally similar to DiagnosticMessage,
 * the difference is that messages are all preformatted in DMC.
 */
export interface DiagnosticMessageChain {
    messageText: string;
    category: DiagnosticCategory;
    code: number;
    next?: DiagnosticMessageChain[];
    /** @internal */
    repopulateInfo?: () => RepopulateDiagnosticChainInfo;
    /** @internal */
    canonicalHead?: CanonicalDiagnostic;
}
export interface Diagnostic extends DiagnosticRelatedInformation {
    /** May store more in future. For now, this will simply be `true` to indicate when a diagnostic is an unused-identifier diagnostic. */
    reportsUnnecessary?: {};
    reportsDeprecated?: {};
    source?: string;
    relatedInformation?: DiagnosticRelatedInformation[];
    /** @internal */ skippedOn?: keyof CompilerOptions;
    /**
     * @internal
     * Used for deduplication and comparison.
     * Whenever it is possible for two diagnostics that report the same problem to be produced with
     * different messages (e.g. "Cannot find name 'foo'" vs "Cannot find name 'foo'. Did you mean 'bar'?"),
     * this property can be set to a canonical message,
     * so that those two diagnostics are appropriately considered to be the same.
     */
    canonicalHead?: CanonicalDiagnostic;
}
/** @internal */
export interface CanonicalDiagnostic {
    code: number;
    messageText: string;
}
/** @internal */
// Diagnostic formatting deliberately accepts arbitrary thrown/message values.
export type DiagnosticArguments = unknown[];
/** @internal */
export type DiagnosticAndArguments = [
    message: DiagnosticMessage,
    ...args: DiagnosticArguments
];
export interface DiagnosticRelatedInformation {
    /** A diagnostic converted from a message-chain can retain the original continuation. */
    next?: DiagnosticMessageChain[];
    category: DiagnosticCategory;
    code: number;
    file: SourceFile | undefined;
    start: number | undefined;
    length: number | undefined;
    messageText: string | DiagnosticMessageChain;
}
export interface DiagnosticWithLocation extends Diagnostic {
    file: SourceFile;
    start: number;
    length: number;
}
/** @internal */
export interface DiagnosticWithDetachedLocation extends Diagnostic {
    file: undefined;
    fileName: string;
    start: number;
    length: number;
}
export type DiagnosticCategory = 0 | 1 | 2 | 3;
export const DiagnosticCategory: {
    readonly Warning: 0;
    readonly Error: 1;
    readonly Suggestion: 2;
    readonly Message: 3;
    [index: number]: string;
} = {
    Warning: 0,
    "0": "Warning",
    Error: 1,
    "1": "Error",
    Suggestion: 2,
    "2": "Suggestion",
    Message: 3,
    "3": "Message"
};
/** @internal */
export function diagnosticCategoryName(d: {
    category: DiagnosticCategory;
}, lowerCase = true): string {
    const name = DiagnosticCategory[d.category];
    return lowerCase ? name.toLowerCase() : name;
}
export type ModuleResolutionKind = number;
export const ModuleResolutionKind: {
    readonly Classic: 1;
    readonly NodeJs: 2;
    readonly Node10: 2;
    readonly Node16: 3;
    readonly NodeNext: 99;
    readonly Bundler: 100;
    [index: number]: string;
} = {
    Classic: 1,
    "1": "Classic",
    NodeJs: 2,
    "2": "Node10",
    Node10: 2,
    Node16: 3,
    "3": "Node16",
    NodeNext: 99,
    "99": "NodeNext",
    Bundler: 100,
    "100": "Bundler"
};
export type ModuleDetectionKind = 1 | 2 | 3;
export const ModuleDetectionKind: {
    readonly Legacy: 1;
    readonly Auto: 2;
    readonly Force: 3;
    [index: number]: string;
} = {
    Legacy: 1,
    "1": "Legacy",
    Auto: 2,
    "2": "Auto",
    Force: 3,
    "3": "Force"
};
export interface PluginImport {
    /** Original server-created global plugin entry. */
    global?: boolean;
    name: string;
}
export interface ProjectReference {
    /** A normalized path on disk */
    path: string;
    /** The path as the user originally wrote it */
    originalPath?: string;
    /** @deprecated */
    prepend?: boolean;
    /** True if it is intended that this reference form a circularity */
    circular?: boolean;
}
export type WatchFileKind = number;
export const WatchFileKind: {
    readonly FixedPollingInterval: 0;
    readonly PriorityPollingInterval: 1;
    readonly DynamicPriorityPolling: 2;
    readonly FixedChunkSizePolling: 3;
    readonly UseFsEvents: 4;
    readonly UseFsEventsOnParentDirectory: 5;
    [index: number]: string;
} = {
    FixedPollingInterval: 0,
    "0": "FixedPollingInterval",
    PriorityPollingInterval: 1,
    "1": "PriorityPollingInterval",
    DynamicPriorityPolling: 2,
    "2": "DynamicPriorityPolling",
    FixedChunkSizePolling: 3,
    "3": "FixedChunkSizePolling",
    UseFsEvents: 4,
    "4": "UseFsEvents",
    UseFsEventsOnParentDirectory: 5,
    "5": "UseFsEventsOnParentDirectory"
};
export type WatchDirectoryKind = number;
export const WatchDirectoryKind: {
    readonly UseFsEvents: 0;
    readonly FixedPollingInterval: 1;
    readonly DynamicPriorityPolling: 2;
    readonly FixedChunkSizePolling: 3;
    [index: number]: string;
} = {
    UseFsEvents: 0,
    "0": "UseFsEvents",
    FixedPollingInterval: 1,
    "1": "FixedPollingInterval",
    DynamicPriorityPolling: 2,
    "2": "DynamicPriorityPolling",
    FixedChunkSizePolling: 3,
    "3": "FixedChunkSizePolling"
};
export type PollingWatchKind = number;
export const PollingWatchKind: {
    readonly FixedInterval: 0;
    readonly PriorityInterval: 1;
    readonly DynamicPriority: 2;
    readonly FixedChunkSize: 3;
    [index: number]: string;
} = {
    FixedInterval: 0,
    "0": "FixedInterval",
    PriorityInterval: 1,
    "1": "PriorityInterval",
    DynamicPriority: 2,
    "2": "DynamicPriority",
    FixedChunkSize: 3,
    "3": "FixedChunkSize"
};
export type CompilerOptionsValue = string | number | boolean | unknown[] | MapLike<unknown> | PluginImport[] | ProjectReference[] | null | undefined; // eslint-disable-line no-restricted-syntax
export interface CompilerOptions {
    /** @internal */ all?: boolean;
    allowImportingTsExtensions?: boolean;
    allowJs?: boolean;
    /** @internal */ allowNonTsExtensions?: boolean;
    allowArbitraryExtensions?: boolean;
    allowSyntheticDefaultImports?: boolean;
    allowUmdGlobalAccess?: boolean;
    allowUnreachableCode?: boolean;
    allowUnusedLabels?: boolean;
    alwaysStrict?: boolean; // Always combine with strict property
    baseUrl?: string;
    /**
     * An error if set - this should only go through the -b pipeline and not actually be observed
     *
     * @internal
     */
    build?: boolean;
    /** @deprecated */
    charset?: string;
    checkJs?: boolean;
    /** @internal */ configFilePath?: string;
    /**
     * configFile is set as non enumerable property so as to avoid checking of json source files
     *
     * @internal
     */
    configFile?: TsConfigSourceFile;
    customConditions?: string[];
    declaration?: boolean;
    declarationMap?: boolean;
    emitDeclarationOnly?: boolean;
    declarationDir?: string;
    /** @internal */ diagnostics?: boolean;
    /** @internal */ extendedDiagnostics?: boolean;
    disableSizeLimit?: boolean;
    disableSourceOfProjectReferenceRedirect?: boolean;
    disableSolutionSearching?: boolean;
    disableReferencedProjectLoad?: boolean;
    downlevelIteration?: boolean;
    emitBOM?: boolean;
    emitDecoratorMetadata?: boolean;
    exactOptionalPropertyTypes?: boolean;
    experimentalDecorators?: boolean;
    forceConsistentCasingInFileNames?: boolean;
    /** @internal */ generateCpuProfile?: string;
    /** @internal */ generateTrace?: string;
    /** @internal */ help?: boolean;
    ignoreDeprecations?: string;
    importHelpers?: boolean;
    /** @deprecated */
    importsNotUsedAsValues?: ImportsNotUsedAsValues;
    /** @internal */ init?: boolean;
    inlineSourceMap?: boolean;
    inlineSources?: boolean;
    isolatedModules?: boolean;
    isolatedDeclarations?: boolean;
    jsx?: JsxEmit;
    /** @deprecated */
    keyofStringsOnly?: boolean;
    lib?: string[];
    libReplacement?: boolean;
    /** @internal */ listEmittedFiles?: boolean;
    /** @internal */ listFiles?: boolean;
    /** @internal */ explainFiles?: boolean;
    /** @internal */ listFilesOnly?: boolean;
    locale?: string;
    mapRoot?: string;
    maxNodeModuleJsDepth?: (number) | undefined;
    module?: ModuleKind;
    moduleResolution?: ModuleResolutionKind;
    moduleSuffixes?: string[];
    moduleDetection?: ModuleDetectionKind;
    newLine?: NewLineKind;
    noEmit?: boolean;
    noCheck?: boolean;
    /** @internal */ noEmitForJsFiles?: boolean;
    noEmitHelpers?: boolean;
    noEmitOnError?: boolean;
    noErrorTruncation?: boolean;
    noFallthroughCasesInSwitch?: boolean;
    noImplicitAny?: boolean; // Always combine with strict property
    noImplicitReturns?: boolean;
    noImplicitThis?: boolean; // Always combine with strict property
    /** @deprecated */
    noStrictGenericChecks?: boolean;
    noUnusedLocals?: boolean;
    noUnusedParameters?: boolean;
    /** @deprecated */
    noImplicitUseStrict?: boolean;
    noPropertyAccessFromIndexSignature?: boolean;
    assumeChangesOnlyAffectDirectDependencies?: boolean;
    noLib?: boolean;
    noResolve?: boolean;
    /** @internal */
    noDtsResolution?: boolean;
    noUncheckedIndexedAccess?: boolean;
    /** @deprecated */
    out?: string;
    outDir?: string;
    outFile?: string;
    paths?: MapLike<string[]>;
    /**
     * The directory of the config file that specified 'paths'. Used to resolve relative paths when 'baseUrl' is absent.
     *
     * @internal
     */
    pathsBasePath?: string;
    /** @internal */ plugins?: PluginImport[];
    preserveConstEnums?: boolean;
    noImplicitOverride?: boolean;
    preserveSymlinks?: boolean;
    /** @deprecated */
    preserveValueImports?: boolean;
    /** @internal */ preserveWatchOutput?: boolean;
    project?: string;
    /** @internal */ pretty?: boolean;
    reactNamespace?: string;
    jsxFactory?: string;
    jsxFragmentFactory?: string;
    jsxImportSource?: string;
    composite?: boolean;
    incremental?: boolean;
    tsBuildInfoFile?: string;
    removeComments?: boolean;
    resolvePackageJsonExports?: boolean;
    resolvePackageJsonImports?: boolean;
    rewriteRelativeImportExtensions?: boolean;
    rootDir?: string;
    rootDirs?: string[];
    skipLibCheck?: boolean;
    skipDefaultLibCheck?: boolean;
    sourceMap?: boolean;
    sourceRoot?: string;
    strict?: boolean;
    strictFunctionTypes?: boolean; // Always combine with strict property
    strictBindCallApply?: boolean; // Always combine with strict property
    strictNullChecks?: boolean; // Always combine with strict property
    strictPropertyInitialization?: boolean; // Always combine with strict property
    strictBuiltinIteratorReturn?: boolean; // Always combine with strict property
    stripInternal?: boolean;
    /** @deprecated */
    suppressExcessPropertyErrors?: boolean;
    /** @deprecated */
    suppressImplicitAnyIndexErrors?: boolean;
    /** @internal */ suppressOutputPathCheck?: boolean;
    target?: ScriptTarget;
    traceResolution?: boolean;
    useUnknownInCatchVariables?: boolean;
    noUncheckedSideEffectImports?: boolean;
    resolveJsonModule?: boolean;
    types?: string[];
    /** Paths used to compute primary types search locations */
    typeRoots?: string[];
    verbatimModuleSyntax?: boolean;
    erasableSyntaxOnly?: boolean;
    /** @internal */ version?: boolean;
    /** @internal */ watch?: boolean;
    esModuleInterop?: boolean;
    /** @internal */ showConfig?: boolean;
    useDefineForClassFields?: boolean;
    /** @internal */ tscBuild?: boolean;
    [option: string]: CompilerOptionsValue | TsConfigSourceFile | undefined;
}
export interface WatchOptions {
    watchFile?: WatchFileKind;
    watchDirectory?: WatchDirectoryKind;
    fallbackPolling?: PollingWatchKind;
    synchronousWatchDirectory?: boolean;
    excludeDirectories?: string[];
    excludeFiles?: string[];
    [option: string]: CompilerOptionsValue | undefined;
}
export interface TypeAcquisition {
    enable?: boolean;
    include?: string[];
    exclude?: string[];
    disableFilenameBasedTypeAcquisition?: boolean;
    [option: string]: CompilerOptionsValue | undefined;
}
export type ModuleKind = number;
export const ModuleKind: {
    readonly None: 0;
    readonly CommonJS: 1;
    readonly AMD: 2;
    readonly UMD: 3;
    readonly System: 4;
    readonly ES2015: 5;
    readonly ES2020: 6;
    readonly ES2022: 7;
    readonly ESNext: 99;
    readonly Node16: 100;
    readonly Node18: 101;
    readonly Node20: 102;
    readonly NodeNext: 199;
    readonly Preserve: 200;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    CommonJS: 1,
    "1": "CommonJS",
    AMD: 2,
    "2": "AMD",
    UMD: 3,
    "3": "UMD",
    System: 4,
    "4": "System",
    ES2015: 5,
    "5": "ES2015",
    ES2020: 6,
    "6": "ES2020",
    ES2022: 7,
    "7": "ES2022",
    ESNext: 99,
    "99": "ESNext",
    Node16: 100,
    "100": "Node16",
    Node18: 101,
    "101": "Node18",
    Node20: 102,
    "102": "Node20",
    NodeNext: 199,
    "199": "NodeNext",
    Preserve: 200,
    "200": "Preserve"
};
export type JsxEmit = number;
export const JsxEmit: {
    readonly None: 0;
    readonly Preserve: 1;
    readonly React: 2;
    readonly ReactNative: 3;
    readonly ReactJSX: 4;
    readonly ReactJSXDev: 5;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Preserve: 1,
    "1": "Preserve",
    React: 2,
    "2": "React",
    ReactNative: 3,
    "3": "ReactNative",
    ReactJSX: 4,
    "4": "ReactJSX",
    ReactJSXDev: 5,
    "5": "ReactJSXDev"
};
/** @deprecated */
export type ImportsNotUsedAsValues = number;
/** @deprecated */
export const ImportsNotUsedAsValues: {
    readonly Remove: 0;
    readonly Preserve: 1;
    readonly Error: 2;
    [index: number]: string;
} = {
    Remove: 0,
    "0": "Remove",
    Preserve: 1,
    "1": "Preserve",
    Error: 2,
    "2": "Error"
};
export type NewLineKind = 0 | 1;
export const NewLineKind: {
    readonly CarriageReturnLineFeed: 0;
    readonly LineFeed: 1;
    [index: number]: string;
} = {
    CarriageReturnLineFeed: 0,
    "0": "CarriageReturnLineFeed",
    LineFeed: 1,
    "1": "LineFeed"
};
export interface LineAndCharacter {
    /** 0-based. */
    line: number;
    /*
     * 0-based. This value denotes the character position in line and is different from the 'column' because of tab characters.
     */
    character: number;
}
export type ScriptKind = number;
export const ScriptKind: {
    readonly Unknown: 0;
    readonly JS: 1;
    readonly JSX: 2;
    readonly TS: 3;
    readonly TSX: 4;
    readonly External: 5;
    readonly JSON: 6;
    readonly Deferred: 7;
    [index: number]: string;
} = {
    Unknown: 0,
    "0": "Unknown",
    JS: 1,
    "1": "JS",
    JSX: 2,
    "2": "JSX",
    TS: 3,
    "3": "TS",
    TSX: 4,
    "4": "TSX",
    External: 5,
    "5": "External",
    JSON: 6,
    "6": "JSON",
    Deferred: 7,
    "7": "Deferred"
};
// NOTE: We must reevaluate the target for upcoming features when each successive TC39 edition is ratified in
//       June of each year. This includes changes to `LanguageFeatureMinimumTarget`, `ScriptTarget`,
//       `ScriptTargetFeatures` transformers/esnext.ts, compiler/commandLineParser.ts,
//       compiler/utilitiesPublic.ts, and the contents of each lib/esnext.*.d.ts file.
export type ScriptTarget = number;
// NOTE: We must reevaluate the target for upcoming features when each successive TC39 edition is ratified in
//       June of each year. This includes changes to `LanguageFeatureMinimumTarget`, `ScriptTarget`,
//       `ScriptTargetFeatures` transformers/esnext.ts, compiler/commandLineParser.ts,
//       compiler/utilitiesPublic.ts, and the contents of each lib/esnext.*.d.ts file.
export const ScriptTarget: {
    readonly ES3: 0;
    readonly ES5: 1;
    readonly ES2015: 2;
    readonly ES2016: 3;
    readonly ES2017: 4;
    readonly ES2018: 5;
    readonly ES2019: 6;
    readonly ES2020: 7;
    readonly ES2021: 8;
    readonly ES2022: 9;
    readonly ES2023: 10;
    readonly ES2024: 11;
    readonly ESNext: 99;
    readonly JSON: 100;
    readonly Latest: 99;
    [index: number]: string;
} = {
    ES3: 0,
    "0": "ES3",
    ES5: 1,
    "1": "ES5",
    ES2015: 2,
    "2": "ES2015",
    ES2016: 3,
    "3": "ES2016",
    ES2017: 4,
    "4": "ES2017",
    ES2018: 5,
    "5": "ES2018",
    ES2019: 6,
    "6": "ES2019",
    ES2020: 7,
    "7": "ES2020",
    ES2021: 8,
    "8": "ES2021",
    ES2022: 9,
    "9": "ES2022",
    ES2023: 10,
    "10": "ES2023",
    ES2024: 11,
    "11": "ES2024",
    ESNext: 99,
    "99": "Latest",
    JSON: 100,
    "100": "JSON",
    Latest: 99
};
export type LanguageVariant = number;
export const LanguageVariant: {
    readonly Standard: 0;
    readonly JSX: 1;
    [index: number]: string;
} = {
    Standard: 0,
    "0": "Standard",
    JSX: 1,
    "1": "JSX"
};
/** Either a parsed command line or a parsed tsconfig.json */
export interface ParsedCommandLine {
    options: CompilerOptions;
    typeAcquisition?: TypeAcquisition;
    fileNames: string[];
    projectReferences?: readonly ProjectReference[];
    watchOptions?: WatchOptions;
    raw?: unknown;
    errors: Diagnostic[];
    wildcardDirectories?: MapLike<WatchDirectoryFlags>;
    compileOnSave?: boolean;
}
export type WatchDirectoryFlags = number;
export const WatchDirectoryFlags: {
    readonly None: 0;
    readonly Recursive: 1;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Recursive: 1,
    "1": "Recursive"
};
/** @internal */
export interface ConfigFileSpecs {
    filesSpecs: readonly string[] | undefined;
    /**
     * Present to report errors (user specified specs), validatedIncludeSpecs are used for file name matching
     */
    includeSpecs: readonly string[] | undefined;
    /**
     * Present to report errors (user specified specs), validatedExcludeSpecs are used for file name matching
     */
    excludeSpecs: readonly string[] | undefined;
    validatedFilesSpec: readonly string[] | undefined;
    validatedIncludeSpecs: readonly string[] | undefined;
    validatedExcludeSpecs: readonly string[] | undefined;
    validatedFilesSpecBeforeSubstitution: readonly string[] | undefined;
    validatedIncludeSpecsBeforeSubstitution: readonly string[] | undefined;
    validatedExcludeSpecsBeforeSubstitution: readonly string[] | undefined;
    isDefaultIncludeSpec: boolean;
}
/** @internal */
export type ModuleImportResult<T = unknown> = {
    module: T;
    modulePath?: string;
    error: undefined;
} | {
    module: undefined;
    modulePath?: undefined;
    error: unknown;
};
export interface CreateProgramOptions {
    rootNames: readonly string[];
    options: CompilerOptions;
    projectReferences?: readonly ProjectReference[];
    host?: CompilerHost;
    oldProgram?: Program;
    configFileParsingDiagnostics?: readonly Diagnostic[];
    /** @internal */
    typeScriptVersion?: string;
}
// dprint-ignore
/** @internal */
export interface CommandLineOptionBase {
    /** Optional metadata probed by the original JSON conversion for every option kind. */
    element?: CommandLineOption;
    elementOptions?: Map<string, CommandLineOption>;
    extraKeyDiagnostics?: DidYouMeanOptionsDiagnostics;
    name: string;
    type: "string" | "number" | "boolean" | "object" | "list" | "listOrElement" | Map<string, number | string>; // a value of a primitive type, or an object literal mapping named values to actual values
    isFilePath?: boolean; // True if option value is a path or fileName
    shortName?: string; // A short mnemonic for convenience - for instance, 'h' can be used in place of 'help'
    description?: DiagnosticMessage; // The message describing what the command line switch does.
    defaultValueDescription?: string | number | boolean | DiagnosticMessage | undefined; // The message describing what the dafault value is. string type is prepared for fixed chosen like "false" which do not need I18n.
    paramType?: DiagnosticMessage; // The name to be used for a non-boolean option's parameter
    isTSConfigOnly?: boolean; // True if option can only be specified via tsconfig.json file
    isCommandLineOnly?: boolean;
    showInSimplifiedHelpView?: boolean;
    category?: DiagnosticMessage;
    strictFlag?: true; // true if the option is one of the flag under strict
    allowJsFlag?: true;
    affectsSourceFile?: true; // true if we should recreate SourceFiles after this option changes
    affectsModuleResolution?: true; // currently same effect as `affectsSourceFile`
    affectsBindDiagnostics?: true; // true if this affects binding (currently same effect as `affectsSourceFile`)
    affectsSemanticDiagnostics?: true; // true if option affects semantic diagnostics
    affectsEmit?: true; // true if the options affects emit
    affectsProgramStructure?: true; // true if program should be reconstructed from root files if option changes and does not affect module resolution as affectsModuleResolution indirectly means program needs to reconstructed
    affectsDeclarationPath?: true; // true if the options affects declaration file path computed
    affectsBuildInfo?: true; // true if this options should be emitted in buildInfo
    transpileOptionValue?: boolean | undefined; // If set this means that the option should be set to this value when transpiling
    extraValidation?: (value: CompilerOptionsValue) => [
        DiagnosticMessage,
        ...string[]
    ] | undefined; // Additional validation to be performed for the value to be valid
    disallowNullOrUndefined?: true; // If set option does not allow setting null
    allowConfigDirTemplateSubstitution?: true; // If set option allows substitution of `${configDir}` in the value
}
/** @internal */
export interface CommandLineOptionOfStringType extends CommandLineOptionBase {
    type: "string";
    defaultValueDescription?: string | undefined | DiagnosticMessage;
}
/** @internal */
export interface CommandLineOptionOfNumberType extends CommandLineOptionBase {
    type: "number";
    defaultValueDescription: number | undefined | DiagnosticMessage;
}
/** @internal */
export interface CommandLineOptionOfBooleanType extends CommandLineOptionBase {
    type: "boolean";
    defaultValueDescription: boolean | undefined | DiagnosticMessage;
}
/** @internal */
export interface CommandLineOptionOfCustomType extends CommandLineOptionBase {
    type: Map<string, number | string>; // an object literal mapping named values to actual values
    defaultValueDescription: number | string | undefined | DiagnosticMessage;
    deprecatedKeys?: Set<string>;
}
/** @internal */
export interface AlternateModeDiagnostics {
    diagnostic: DiagnosticMessage;
    getOptionsNameMap: () => OptionsNameMap;
}
/** @internal */
export interface DidYouMeanOptionsDiagnostics {
    alternateMode?: AlternateModeDiagnostics;
    optionDeclarations: CommandLineOption[];
    unknownOptionDiagnostic: DiagnosticMessage;
    unknownDidYouMeanDiagnostic: DiagnosticMessage;
}
/** @internal */
export interface TsConfigOnlyOption extends CommandLineOptionBase {
    type: "object";
    elementOptions?: Map<string, CommandLineOption>;
    extraKeyDiagnostics?: DidYouMeanOptionsDiagnostics;
}
/** @internal */
export interface CommandLineOptionOfListType extends CommandLineOptionBase {
    type: "list" | "listOrElement";
    element: CommandLineOptionOfCustomType | CommandLineOptionOfStringType | CommandLineOptionOfNumberType | CommandLineOptionOfBooleanType | TsConfigOnlyOption;
    listPreserveFalsyValues?: boolean;
}
/** @internal */
export type CommandLineOption = CommandLineOptionOfCustomType | CommandLineOptionOfStringType | CommandLineOptionOfNumberType | CommandLineOptionOfBooleanType | TsConfigOnlyOption | CommandLineOptionOfListType;
// dprint-ignore
/** @internal */
export type CharacterCodes = number;
// dprint-ignore
/** @internal */
export const CharacterCodes: {
    readonly EOF: -1;
    readonly nullCharacter: 0;
    readonly maxAsciiCharacter: 127;
    readonly lineFeed: 10;
    readonly carriageReturn: 13;
    readonly lineSeparator: 8232;
    readonly paragraphSeparator: 8233;
    readonly nextLine: 133;
    readonly space: 32;
    readonly nonBreakingSpace: 160;
    readonly enQuad: 8192;
    readonly emQuad: 8193;
    readonly enSpace: 8194;
    readonly emSpace: 8195;
    readonly threePerEmSpace: 8196;
    readonly fourPerEmSpace: 8197;
    readonly sixPerEmSpace: 8198;
    readonly figureSpace: 8199;
    readonly punctuationSpace: 8200;
    readonly thinSpace: 8201;
    readonly hairSpace: 8202;
    readonly zeroWidthSpace: 8203;
    readonly narrowNoBreakSpace: 8239;
    readonly ideographicSpace: 12288;
    readonly mathematicalSpace: 8287;
    readonly ogham: 5760;
    readonly replacementCharacter: 65533;
    readonly _: 95;
    readonly $: 36;
    readonly _0: 48;
    readonly _1: 49;
    readonly _2: 50;
    readonly _3: 51;
    readonly _4: 52;
    readonly _5: 53;
    readonly _6: 54;
    readonly _7: 55;
    readonly _8: 56;
    readonly _9: 57;
    readonly a: 97;
    readonly b: 98;
    readonly c: 99;
    readonly d: 100;
    readonly e: 101;
    readonly f: 102;
    readonly g: 103;
    readonly h: 104;
    readonly i: 105;
    readonly j: 106;
    readonly k: 107;
    readonly l: 108;
    readonly m: 109;
    readonly n: 110;
    readonly o: 111;
    readonly p: 112;
    readonly q: 113;
    readonly r: 114;
    readonly s: 115;
    readonly t: 116;
    readonly u: 117;
    readonly v: 118;
    readonly w: 119;
    readonly x: 120;
    readonly y: 121;
    readonly z: 122;
    readonly A: 65;
    readonly B: 66;
    readonly C: 67;
    readonly D: 68;
    readonly E: 69;
    readonly F: 70;
    readonly G: 71;
    readonly H: 72;
    readonly I: 73;
    readonly J: 74;
    readonly K: 75;
    readonly L: 76;
    readonly M: 77;
    readonly N: 78;
    readonly O: 79;
    readonly P: 80;
    readonly Q: 81;
    readonly R: 82;
    readonly S: 83;
    readonly T: 84;
    readonly U: 85;
    readonly V: 86;
    readonly W: 87;
    readonly X: 88;
    readonly Y: 89;
    readonly Z: 90;
    readonly ampersand: 38;
    readonly asterisk: 42;
    readonly at: 64;
    readonly backslash: 92;
    readonly backtick: 96;
    readonly bar: 124;
    readonly caret: 94;
    readonly closeBrace: 125;
    readonly closeBracket: 93;
    readonly closeParen: 41;
    readonly colon: 58;
    readonly comma: 44;
    readonly dot: 46;
    readonly doubleQuote: 34;
    readonly equals: 61;
    readonly exclamation: 33;
    readonly greaterThan: 62;
    readonly hash: 35;
    readonly lessThan: 60;
    readonly minus: 45;
    readonly openBrace: 123;
    readonly openBracket: 91;
    readonly openParen: 40;
    readonly percent: 37;
    readonly plus: 43;
    readonly question: 63;
    readonly semicolon: 59;
    readonly singleQuote: 39;
    readonly slash: 47;
    readonly tilde: 126;
    readonly backspace: 8;
    readonly formFeed: 12;
    readonly byteOrderMark: 65279;
    readonly tab: 9;
    readonly verticalTab: 11;
    [index: number]: string;
} = {
    EOF: -1,
    "-1": "EOF",
    nullCharacter: 0,
    "0": "nullCharacter",
    maxAsciiCharacter: 127,
    "127": "maxAsciiCharacter",
    lineFeed: 10,
    "10": "lineFeed",
    carriageReturn: 13,
    "13": "carriageReturn",
    lineSeparator: 8232,
    "8232": "lineSeparator",
    paragraphSeparator: 8233,
    "8233": "paragraphSeparator",
    nextLine: 133,
    "133": "nextLine",
    space: 32,
    "32": "space",
    nonBreakingSpace: 160,
    "160": "nonBreakingSpace",
    enQuad: 8192,
    "8192": "enQuad",
    emQuad: 8193,
    "8193": "emQuad",
    enSpace: 8194,
    "8194": "enSpace",
    emSpace: 8195,
    "8195": "emSpace",
    threePerEmSpace: 8196,
    "8196": "threePerEmSpace",
    fourPerEmSpace: 8197,
    "8197": "fourPerEmSpace",
    sixPerEmSpace: 8198,
    "8198": "sixPerEmSpace",
    figureSpace: 8199,
    "8199": "figureSpace",
    punctuationSpace: 8200,
    "8200": "punctuationSpace",
    thinSpace: 8201,
    "8201": "thinSpace",
    hairSpace: 8202,
    "8202": "hairSpace",
    zeroWidthSpace: 8203,
    "8203": "zeroWidthSpace",
    narrowNoBreakSpace: 8239,
    "8239": "narrowNoBreakSpace",
    ideographicSpace: 12288,
    "12288": "ideographicSpace",
    mathematicalSpace: 8287,
    "8287": "mathematicalSpace",
    ogham: 5760,
    "5760": "ogham",
    replacementCharacter: 65533,
    "65533": "replacementCharacter",
    _: 95,
    "95": "_",
    $: 36,
    "36": "$",
    _0: 48,
    "48": "_0",
    _1: 49,
    "49": "_1",
    _2: 50,
    "50": "_2",
    _3: 51,
    "51": "_3",
    _4: 52,
    "52": "_4",
    _5: 53,
    "53": "_5",
    _6: 54,
    "54": "_6",
    _7: 55,
    "55": "_7",
    _8: 56,
    "56": "_8",
    _9: 57,
    "57": "_9",
    a: 97,
    "97": "a",
    b: 98,
    "98": "b",
    c: 99,
    "99": "c",
    d: 100,
    "100": "d",
    e: 101,
    "101": "e",
    f: 102,
    "102": "f",
    g: 103,
    "103": "g",
    h: 104,
    "104": "h",
    i: 105,
    "105": "i",
    j: 106,
    "106": "j",
    k: 107,
    "107": "k",
    l: 108,
    "108": "l",
    m: 109,
    "109": "m",
    n: 110,
    "110": "n",
    o: 111,
    "111": "o",
    p: 112,
    "112": "p",
    q: 113,
    "113": "q",
    r: 114,
    "114": "r",
    s: 115,
    "115": "s",
    t: 116,
    "116": "t",
    u: 117,
    "117": "u",
    v: 118,
    "118": "v",
    w: 119,
    "119": "w",
    x: 120,
    "120": "x",
    y: 121,
    "121": "y",
    z: 122,
    "122": "z",
    A: 65,
    "65": "A",
    B: 66,
    "66": "B",
    C: 67,
    "67": "C",
    D: 68,
    "68": "D",
    E: 69,
    "69": "E",
    F: 70,
    "70": "F",
    G: 71,
    "71": "G",
    H: 72,
    "72": "H",
    I: 73,
    "73": "I",
    J: 74,
    "74": "J",
    K: 75,
    "75": "K",
    L: 76,
    "76": "L",
    M: 77,
    "77": "M",
    N: 78,
    "78": "N",
    O: 79,
    "79": "O",
    P: 80,
    "80": "P",
    Q: 81,
    "81": "Q",
    R: 82,
    "82": "R",
    S: 83,
    "83": "S",
    T: 84,
    "84": "T",
    U: 85,
    "85": "U",
    V: 86,
    "86": "V",
    W: 87,
    "87": "W",
    X: 88,
    "88": "X",
    Y: 89,
    "89": "Y",
    Z: 90,
    "90": "Z",
    ampersand: 38,
    "38": "ampersand",
    asterisk: 42,
    "42": "asterisk",
    at: 64,
    "64": "at",
    backslash: 92,
    "92": "backslash",
    backtick: 96,
    "96": "backtick",
    bar: 124,
    "124": "bar",
    caret: 94,
    "94": "caret",
    closeBrace: 125,
    "125": "closeBrace",
    closeBracket: 93,
    "93": "closeBracket",
    closeParen: 41,
    "41": "closeParen",
    colon: 58,
    "58": "colon",
    comma: 44,
    "44": "comma",
    dot: 46,
    "46": "dot",
    doubleQuote: 34,
    "34": "doubleQuote",
    equals: 61,
    "61": "equals",
    exclamation: 33,
    "33": "exclamation",
    greaterThan: 62,
    "62": "greaterThan",
    hash: 35,
    "35": "hash",
    lessThan: 60,
    "60": "lessThan",
    minus: 45,
    "45": "minus",
    openBrace: 123,
    "123": "openBrace",
    openBracket: 91,
    "91": "openBracket",
    openParen: 40,
    "40": "openParen",
    percent: 37,
    "37": "percent",
    plus: 43,
    "43": "plus",
    question: 63,
    "63": "question",
    semicolon: 59,
    "59": "semicolon",
    singleQuote: 39,
    "39": "singleQuote",
    slash: 47,
    "47": "slash",
    tilde: 126,
    "126": "tilde",
    backspace: 8,
    "8": "backspace",
    formFeed: 12,
    "12": "formFeed",
    byteOrderMark: 65279,
    "65279": "byteOrderMark",
    tab: 9,
    "9": "tab",
    verticalTab: 11,
    "11": "verticalTab"
};
export interface ModuleResolutionHost {
    // TODO: GH#18217 Optional methods frequently used as non-optional
    fileExists(fileName: string): boolean;
    // readFile function is used to read arbitrary text files on disk, i.e. when resolution procedure needs the content of 'package.json'
    // to determine location of bundled typings for node module
    readFile(fileName: string): string | undefined;
    trace?(s: string): void;
    directoryExists?(directoryName: string): boolean;
    /**
     * Resolve a symbolic link.
     * @see https://nodejs.org/api/fs.html#fs_fs_realpathsync_path_options
     */
    realpath?(path: string): string;
    getCurrentDirectory?(): string;
    getDirectories?(path: string): string[];
    useCaseSensitiveFileNames?: boolean | (() => boolean) | undefined;
    /** @internal */ getGlobalTypingsCacheLocation?(): string | undefined;
}
/**
 * Used by services to specify the minimum host area required to set up source files under any compilation settings
 */
export interface MinimalResolutionCacheHost extends ModuleResolutionHost {
    getCompilationSettings(): CompilerOptions;
    getCompilerHost?(): CompilerHost | undefined;
}
/**
 * Represents the result of module resolution.
 * Module resolution will pick up tsx/jsx/js files even if '--jsx' and '--allowJs' are turned off.
 * The Program will then filter results based on these flags.
 *
 * Prefer to return a `ResolvedModuleFull` so that the file type does not have to be inferred.
 */
export interface ResolvedModule {
    /** Present on the original newer-host result; legacy hosts omit it. */
    extension?: string;
    /** Path of the file the module was resolved to. */
    resolvedFileName: string;
    /** True if `resolvedFileName` comes from `node_modules`. */
    isExternalLibraryImport?: boolean;
    /**
     * True if the original module reference used a .ts extension to refer directly to a .ts file,
     * which should produce an error during checking if emit is enabled.
     */
    resolvedUsingTsExtension?: boolean;
}
/**
 * ResolvedModule with an explicitly provided `extension` property.
 * Prefer this over `ResolvedModule`.
 * If changing this, remember to change `moduleResolutionIsEqualTo`.
 */
export interface ResolvedModuleFull extends ResolvedModule {
    /**
     * @internal
     * This is a file name with preserved original casing, not a normalized `Path`.
     */
    originalPath?: string;
    /**
     * Extension of resolvedFileName. This must match what's at the end of resolvedFileName.
     * This is optional for backwards-compatibility, but will be added if not provided.
     */
    extension: string;
    packageId?: PackageId;
}
/**
 * Unique identifier with a package name and version.
 * If changing this, remember to change `packageIdIsEqual`.
 */
export interface PackageId {
    /**
     * Name of the package.
     * Should not include `@types`.
     * If accessing a non-index file, this should include its name e.g. "foo/bar".
     */
    name: string;
    /**
     * Name of a submodule within this package.
     * May be "".
     */
    subModuleName: string;
    /** Version of the package, e.g. "1.2.3" */
    version: string;
    /** @internal*/ peerDependencies?: string;
}
export type Extension = ".ts" | ".tsx" | ".d.ts" | ".js" | ".jsx" | ".json" | ".tsbuildinfo" | ".mjs" | ".mts" | ".d.mts" | ".cjs" | ".cts" | ".d.cts";
export const Extension: {
    readonly Ts: ".ts";
    readonly Tsx: ".tsx";
    readonly Dts: ".d.ts";
    readonly Js: ".js";
    readonly Jsx: ".jsx";
    readonly Json: ".json";
    readonly TsBuildInfo: ".tsbuildinfo";
    readonly Mjs: ".mjs";
    readonly Mts: ".mts";
    readonly Dmts: ".d.mts";
    readonly Cjs: ".cjs";
    readonly Cts: ".cts";
    readonly Dcts: ".d.cts";
} = {
    Ts: ".ts",
    Tsx: ".tsx",
    Dts: ".d.ts",
    Js: ".js",
    Jsx: ".jsx",
    Json: ".json",
    TsBuildInfo: ".tsbuildinfo",
    Mjs: ".mjs",
    Mts: ".mts",
    Dmts: ".d.mts",
    Cjs: ".cjs",
    Cts: ".cts",
    Dcts: ".d.cts"
};
export interface ResolvedModuleWithFailedLookupLocations {
    resolvedModule: ResolvedModuleFull | undefined;
    /** @internal */
    failedLookupLocations?: string[];
    /** @internal */
    affectingLocations?: string[];
    /** @internal */
    resolutionDiagnostics?: Diagnostic[];
    /**
     * @internal
     * Used to issue a better diagnostic when an unresolvable module may
     * have been resolvable under different module resolution settings.
     */
    alternateResult?: string;
}
export interface ResolvedTypeReferenceDirective {
    // True if the type declaration file was found in a primary lookup location
    primary: boolean;
    // The location of the .d.ts file we located, or undefined if resolution failed
    resolvedFileName: string | undefined;
    /**
     * @internal
     * The location of the symlink to the .d.ts file we found, if `resolvedFileName` was the realpath.
     * This is a file name with preserved original casing, not a normalized `Path`.
     */
    originalPath?: string;
    packageId?: PackageId;
    /** True if `resolvedFileName` comes from `node_modules`. */
    isExternalLibraryImport?: boolean;
}
export interface ResolvedTypeReferenceDirectiveWithFailedLookupLocations {
    resolvedTypeReferenceDirective: ResolvedTypeReferenceDirective | undefined;
    /** @internal */ failedLookupLocations?: string[];
    /** @internal */ affectingLocations?: string[];
    /** @internal */ resolutionDiagnostics?: Diagnostic[];
}
/** @internal */
export type HasInvalidatedResolutions = (sourceFile: Path) => boolean;
/** @internal */
export type HasInvalidatedLibResolutions = (libFileName: string) => boolean;
/** @internal */
export type HasChangedAutomaticTypeDirectiveNames = () => boolean;
export interface CompilerHost extends ModuleResolutionHost {
    getSourceFile(fileName: string, languageVersionOrOptions: ScriptTarget | CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): SourceFile | undefined;
    getSourceFileByPath?(fileName: string, path: Path, languageVersionOrOptions: ScriptTarget | CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): SourceFile | undefined;
    getCancellationToken?(): CancellationToken;
    getDefaultLibFileName(options: CompilerOptions): string;
    getDefaultLibLocation?(): string;
    writeFile: WriteFileCallback;
    getCurrentDirectory(): string;
    getCanonicalFileName(fileName: string): string;
    useCaseSensitiveFileNames(): boolean;
    getNewLine(): string;
    readDirectory?(rootDir: string, extensions: readonly string[], excludes: readonly string[] | undefined, includes: readonly string[], depth?: number): string[];
    /*
     * CompilerHost must either implement resolveModuleNames (in case if it wants to be completely in charge of
     * module name resolution) or provide implementation for methods from ModuleResolutionHost (in this case compiler
     * will apply built-in module resolution logic and use members of ModuleResolutionHost to ask host specific questions).
     * If resolveModuleNames is implemented then implementation for members from ModuleResolutionHost can be just
     * 'throw new Error("NotImplemented")'
     */
    /** @deprecated supply resolveModuleNameLiterals instead for resolution that can handle newer resolution modes like nodenext */
    resolveModuleNames?(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile?: SourceFile): (ResolvedModule | undefined)[];
    /**
     * Returns the module resolution cache used by a provided `resolveModuleNames` implementation so that any non-name module resolution operations (eg, package.json lookup) can reuse it
     */
    getModuleResolutionCache?(): ModuleResolutionCache | undefined;
    /**
     * @deprecated supply resolveTypeReferenceDirectiveReferences instead for resolution that can handle newer resolution modes like nodenext
     *
     * This method is a companion for 'resolveModuleNames' and is used to resolve 'types' references to actual type declaration files
     */
    resolveTypeReferenceDirectives?(typeReferenceDirectiveNames: string[] | readonly FileReference[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingFileMode?: ResolutionMode): (ResolvedTypeReferenceDirective | undefined)[];
    resolveModuleNameLiterals?(moduleLiterals: readonly StringLiteralLike[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile, reusedNames: readonly StringLiteralLike[] | undefined): readonly ResolvedModuleWithFailedLookupLocations[];
    resolveTypeReferenceDirectiveReferences?<T extends FileReference | string>(typeDirectiveReferences: readonly T[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile | undefined, reusedNames: readonly T[] | undefined): readonly ResolvedTypeReferenceDirectiveWithFailedLookupLocations[];
    /** @internal */
    resolveLibrary?(libraryName: string, resolveFrom: string, options: CompilerOptions, libFileName: string): ResolvedModuleWithFailedLookupLocations;
    /**
     * If provided along with custom resolveLibrary, used to determine if we should redo library resolutions
     * @internal
     */
    hasInvalidatedLibResolutions?(libFileName: string): boolean;
    getEnvironmentVariable?(name: string): string | undefined;
    /** @internal */ onReleaseOldSourceFile?(oldSourceFile: SourceFile, oldOptions: CompilerOptions, hasSourceFileByPath: boolean, newSourceFileByResolvedPath: SourceFile | undefined): void;
    /** @internal */ onReleaseParsedCommandLine?(configFileName: string, oldResolvedRef: ResolvedProjectReference | undefined, optionOptions: CompilerOptions): void;
    /** If provided along with custom resolveModuleNames or resolveTypeReferenceDirectives, used to determine if unchanged file path needs to re-resolve modules/type reference directives */
    hasInvalidatedResolutions?(filePath: Path): boolean;
    /** @internal */ hasChangedAutomaticTypeDirectiveNames?: HasChangedAutomaticTypeDirectiveNames;
    createHash?(data: string): string;
    getParsedCommandLine?(fileName: string): ParsedCommandLine | undefined;
    /** @internal */ useSourceOfProjectReferenceRedirect?(): boolean;
    // TODO: later handle this in better way in builder host instead once the api for tsbuild finalizes and doesn't use compilerHost as base
    /** @internal */ createDirectory?(directory: string): void;
    /** @internal */ getSymlinkCache?(): SymlinkCache;
    // For testing:
    /** @internal */ storeSignatureInfo?: boolean;
    /** @internal */ getBuildInfo?(fileName: string, configFilePath: string | undefined): unknown;
    jsDocParsingMode?: JSDocParsingMode;
}
/** @internal */
export type TransformFlags = number;
/** @internal */
export const TransformFlags: {
    readonly None: 0;
    readonly ContainsTypeScript: 1;
    readonly ContainsJsx: 2;
    readonly ContainsESNext: 4;
    readonly ContainsES2022: 8;
    readonly ContainsES2021: 16;
    readonly ContainsES2020: 32;
    readonly ContainsES2019: 64;
    readonly ContainsES2018: 128;
    readonly ContainsES2017: 256;
    readonly ContainsES2016: 512;
    readonly ContainsES2015: 1024;
    readonly ContainsGenerator: 2048;
    readonly ContainsDestructuringAssignment: 4096;
    readonly ContainsTypeScriptClassSyntax: 8192;
    readonly ContainsLexicalThis: 16384;
    readonly ContainsRestOrSpread: 32768;
    readonly ContainsObjectRestOrSpread: 65536;
    readonly ContainsComputedPropertyName: 131072;
    readonly ContainsBlockScopedBinding: 262144;
    readonly ContainsBindingPattern: 524288;
    readonly ContainsYield: 1048576;
    readonly ContainsAwait: 2097152;
    readonly ContainsHoistedDeclarationOrCompletion: 4194304;
    readonly ContainsDynamicImport: 8388608;
    readonly ContainsClassFields: 16777216;
    readonly ContainsDecorators: 33554432;
    readonly ContainsPossibleTopLevelAwait: 67108864;
    readonly ContainsLexicalSuper: 134217728;
    readonly ContainsUpdateExpressionForIdentifier: 268435456;
    readonly ContainsPrivateIdentifierInExpression: 536870912;
    readonly HasComputedFlags: -2147483648;
    readonly AssertTypeScript: 1;
    readonly AssertJsx: 2;
    readonly AssertESNext: 4;
    readonly AssertES2022: 8;
    readonly AssertES2021: 16;
    readonly AssertES2020: 32;
    readonly AssertES2019: 64;
    readonly AssertES2018: 128;
    readonly AssertES2017: 256;
    readonly AssertES2016: 512;
    readonly AssertES2015: 1024;
    readonly AssertGenerator: 2048;
    readonly AssertDestructuringAssignment: 4096;
    readonly OuterExpressionExcludes: -2147483648;
    readonly PropertyAccessExcludes: -2147483648;
    readonly NodeExcludes: -2147483648;
    readonly ArrowFunctionExcludes: -2072174592;
    readonly FunctionExcludes: -1937940480;
    readonly ConstructorExcludes: -1937948672;
    readonly MethodOrAccessorExcludes: -2005057536;
    readonly PropertyExcludes: -2013249536;
    readonly ClassExcludes: -2147344384;
    readonly ModuleExcludes: -1941676032;
    readonly TypeExcludes: -2;
    readonly ObjectLiteralExcludes: -2147278848;
    readonly ArrayLiteralOrCallOrNewExcludes: -2147450880;
    readonly VariableDeclarationListExcludes: -2146893824;
    readonly ParameterExcludes: -2147483648;
    readonly CatchClauseExcludes: -2147418112;
    readonly BindingPatternExcludes: -2147450880;
    readonly ContainsLexicalThisOrSuper: 134234112;
    readonly PropertyNamePropagatingFlags: 134234112;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    ContainsTypeScript: 1,
    "1": "AssertTypeScript",
    ContainsJsx: 2,
    "2": "AssertJsx",
    ContainsESNext: 4,
    "4": "AssertESNext",
    ContainsES2022: 8,
    "8": "AssertES2022",
    ContainsES2021: 16,
    "16": "AssertES2021",
    ContainsES2020: 32,
    "32": "AssertES2020",
    ContainsES2019: 64,
    "64": "AssertES2019",
    ContainsES2018: 128,
    "128": "AssertES2018",
    ContainsES2017: 256,
    "256": "AssertES2017",
    ContainsES2016: 512,
    "512": "AssertES2016",
    ContainsES2015: 1024,
    "1024": "AssertES2015",
    ContainsGenerator: 2048,
    "2048": "AssertGenerator",
    ContainsDestructuringAssignment: 4096,
    "4096": "AssertDestructuringAssignment",
    ContainsTypeScriptClassSyntax: 8192,
    "8192": "ContainsTypeScriptClassSyntax",
    ContainsLexicalThis: 16384,
    "16384": "ContainsLexicalThis",
    ContainsRestOrSpread: 32768,
    "32768": "ContainsRestOrSpread",
    ContainsObjectRestOrSpread: 65536,
    "65536": "ContainsObjectRestOrSpread",
    ContainsComputedPropertyName: 131072,
    "131072": "ContainsComputedPropertyName",
    ContainsBlockScopedBinding: 262144,
    "262144": "ContainsBlockScopedBinding",
    ContainsBindingPattern: 524288,
    "524288": "ContainsBindingPattern",
    ContainsYield: 1048576,
    "1048576": "ContainsYield",
    ContainsAwait: 2097152,
    "2097152": "ContainsAwait",
    ContainsHoistedDeclarationOrCompletion: 4194304,
    "4194304": "ContainsHoistedDeclarationOrCompletion",
    ContainsDynamicImport: 8388608,
    "8388608": "ContainsDynamicImport",
    ContainsClassFields: 16777216,
    "16777216": "ContainsClassFields",
    ContainsDecorators: 33554432,
    "33554432": "ContainsDecorators",
    ContainsPossibleTopLevelAwait: 67108864,
    "67108864": "ContainsPossibleTopLevelAwait",
    ContainsLexicalSuper: 134217728,
    "134217728": "ContainsLexicalSuper",
    ContainsUpdateExpressionForIdentifier: 268435456,
    "268435456": "ContainsUpdateExpressionForIdentifier",
    ContainsPrivateIdentifierInExpression: 536870912,
    "536870912": "ContainsPrivateIdentifierInExpression",
    HasComputedFlags: -2147483648,
    "-2147483648": "ParameterExcludes",
    AssertTypeScript: 1,
    AssertJsx: 2,
    AssertESNext: 4,
    AssertES2022: 8,
    AssertES2021: 16,
    AssertES2020: 32,
    AssertES2019: 64,
    AssertES2018: 128,
    AssertES2017: 256,
    AssertES2016: 512,
    AssertES2015: 1024,
    AssertGenerator: 2048,
    AssertDestructuringAssignment: 4096,
    OuterExpressionExcludes: -2147483648,
    PropertyAccessExcludes: -2147483648,
    NodeExcludes: -2147483648,
    ArrowFunctionExcludes: -2072174592,
    "-2072174592": "ArrowFunctionExcludes",
    FunctionExcludes: -1937940480,
    "-1937940480": "FunctionExcludes",
    ConstructorExcludes: -1937948672,
    "-1937948672": "ConstructorExcludes",
    MethodOrAccessorExcludes: -2005057536,
    "-2005057536": "MethodOrAccessorExcludes",
    PropertyExcludes: -2013249536,
    "-2013249536": "PropertyExcludes",
    ClassExcludes: -2147344384,
    "-2147344384": "ClassExcludes",
    ModuleExcludes: -1941676032,
    "-1941676032": "ModuleExcludes",
    TypeExcludes: -2,
    "-2": "TypeExcludes",
    ObjectLiteralExcludes: -2147278848,
    "-2147278848": "ObjectLiteralExcludes",
    ArrayLiteralOrCallOrNewExcludes: -2147450880,
    "-2147450880": "BindingPatternExcludes",
    VariableDeclarationListExcludes: -2146893824,
    "-2146893824": "VariableDeclarationListExcludes",
    ParameterExcludes: -2147483648,
    CatchClauseExcludes: -2147418112,
    "-2147418112": "CatchClauseExcludes",
    BindingPatternExcludes: -2147450880,
    ContainsLexicalThisOrSuper: 134234112,
    "134234112": "PropertyNamePropagatingFlags",
    PropertyNamePropagatingFlags: 134234112
};
export interface SourceMapRange extends TextRange {
    source?: SourceMapSource;
}
export interface SourceMapSource {
    fileName: string;
    text: string;
    /** @internal */ lineMap?: readonly number[];
    skipTrivia?: (pos: number) => number;
}
/** @internal */
// NOTE: Any new properties should be accounted for in `mergeEmitNode` in factory/nodeFactory.ts
// dprint-ignore
export interface EmitNode {
    flags?: EmitFlags; // Flags that customize emit
    internalFlags?: InternalEmitFlags; // Internal flags that customize emit
    annotatedNodes?: Node[]; // Tracks Parse-tree nodes with EmitNodes for eventual cleanup.
    leadingComments?: (SynthesizedComment[]) | undefined; // Synthesized leading comments
    trailingComments?: (SynthesizedComment[]) | undefined; // Synthesized trailing comments
    commentRange?: TextRange; // The text range to use when emitting leading or trailing comments
    sourceMapRange?: SourceMapRange; // The text range to use when emitting leading or trailing source mappings
    tokenSourceMapRanges?: (SourceMapRange | undefined)[]; // The text range to use when emitting source mappings for tokens
    constantValue?: string | number; // The constant value of an expression
    externalHelpersModuleName?: Identifier; // The local name for an imported helpers module
    externalHelpers?: boolean;
    helpers?: EmitHelper[]; // Emit helpers for the node
    startsOnNewLine?: boolean; // If the node should begin on a new line
    snippetElement?: SnippetElement; // Snippet element of the node
    typeNode?: TypeNode; // VariableDeclaration type
    classThis?: Identifier; // Identifier that points to a captured static `this` for a class which may be updated after decorators are applied
    assignedName?: Expression; // Expression used as the assigned name of a class or function
    identifierTypeArguments?: NodeArray<TypeNode | TypeParameterDeclaration>; // Only defined on synthesized identifiers. Though not syntactically valid, used in emitting diagnostics, quickinfo, and signature help.
    autoGenerate?: AutoGenerateInfo | undefined; // Used for auto-generated identifiers and private identifiers.
    generatedImportReference?: ImportSpecifier; // Reference to the generated import specifier this identifier refers to
}
/** @internal */
export type SnippetElement = TabStop | Placeholder;
/** @internal */
export interface TabStop {
    kind: typeof SnippetKind.TabStop;
    order: number;
}
/** @internal */
export interface Placeholder {
    kind: typeof SnippetKind.Placeholder;
    order: number;
}
// Reference: https://code.visualstudio.com/docs/editor/userdefinedsnippets#_snippet-syntax
// dprint-ignore
/** @internal */
export type SnippetKind = number;
// Reference: https://code.visualstudio.com/docs/editor/userdefinedsnippets#_snippet-syntax
// dprint-ignore
/** @internal */
export const SnippetKind: {
    readonly TabStop: 0;
    readonly Placeholder: 1;
    readonly Choice: 2;
    readonly Variable: 3;
    [index: number]: string;
} = {
    TabStop: 0,
    "0": "TabStop",
    Placeholder: 1,
    "1": "Placeholder",
    Choice: 2,
    "2": "Choice",
    Variable: 3,
    "3": "Variable"
};
// dprint-ignore
export type EmitFlags = number;
// dprint-ignore
export const EmitFlags: {
    readonly None: 0;
    readonly SingleLine: 1;
    readonly MultiLine: 2;
    readonly AdviseOnEmitNode: 4;
    readonly NoSubstitution: 8;
    readonly CapturesThis: 16;
    readonly NoLeadingSourceMap: 32;
    readonly NoTrailingSourceMap: 64;
    readonly NoSourceMap: 96;
    readonly NoNestedSourceMaps: 128;
    readonly NoTokenLeadingSourceMaps: 256;
    readonly NoTokenTrailingSourceMaps: 512;
    readonly NoTokenSourceMaps: 768;
    readonly NoLeadingComments: 1024;
    readonly NoTrailingComments: 2048;
    readonly NoComments: 3072;
    readonly NoNestedComments: 4096;
    readonly HelperName: 8192;
    readonly ExportName: 16384;
    readonly LocalName: 32768;
    readonly InternalName: 65536;
    readonly Indented: 131072;
    readonly NoIndentation: 262144;
    readonly AsyncFunctionBody: 524288;
    readonly ReuseTempVariableScope: 1048576;
    readonly CustomPrologue: 2097152;
    readonly NoHoisting: 4194304;
    readonly Iterator: 8388608;
    readonly NoAsciiEscaping: 16777216;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    SingleLine: 1,
    "1": "SingleLine",
    MultiLine: 2,
    "2": "MultiLine",
    AdviseOnEmitNode: 4,
    "4": "AdviseOnEmitNode",
    NoSubstitution: 8,
    "8": "NoSubstitution",
    CapturesThis: 16,
    "16": "CapturesThis",
    NoLeadingSourceMap: 32,
    "32": "NoLeadingSourceMap",
    NoTrailingSourceMap: 64,
    "64": "NoTrailingSourceMap",
    NoSourceMap: 96,
    "96": "NoSourceMap",
    NoNestedSourceMaps: 128,
    "128": "NoNestedSourceMaps",
    NoTokenLeadingSourceMaps: 256,
    "256": "NoTokenLeadingSourceMaps",
    NoTokenTrailingSourceMaps: 512,
    "512": "NoTokenTrailingSourceMaps",
    NoTokenSourceMaps: 768,
    "768": "NoTokenSourceMaps",
    NoLeadingComments: 1024,
    "1024": "NoLeadingComments",
    NoTrailingComments: 2048,
    "2048": "NoTrailingComments",
    NoComments: 3072,
    "3072": "NoComments",
    NoNestedComments: 4096,
    "4096": "NoNestedComments",
    HelperName: 8192,
    "8192": "HelperName",
    ExportName: 16384,
    "16384": "ExportName",
    LocalName: 32768,
    "32768": "LocalName",
    InternalName: 65536,
    "65536": "InternalName",
    Indented: 131072,
    "131072": "Indented",
    NoIndentation: 262144,
    "262144": "NoIndentation",
    AsyncFunctionBody: 524288,
    "524288": "AsyncFunctionBody",
    ReuseTempVariableScope: 1048576,
    "1048576": "ReuseTempVariableScope",
    CustomPrologue: 2097152,
    "2097152": "CustomPrologue",
    NoHoisting: 4194304,
    "4194304": "NoHoisting",
    Iterator: 8388608,
    "8388608": "Iterator",
    NoAsciiEscaping: 16777216,
    "16777216": "NoAsciiEscaping"
};
// dprint-ignore
/** @internal */
export type InternalEmitFlags = number;
// dprint-ignore
/** @internal */
export const InternalEmitFlags: {
    readonly None: 0;
    readonly TypeScriptClassWrapper: 1;
    readonly NeverApplyImportHelper: 2;
    readonly IgnoreSourceNewlines: 4;
    readonly Immutable: 8;
    readonly IndirectCall: 16;
    readonly TransformPrivateStaticElements: 32;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    TypeScriptClassWrapper: 1,
    "1": "TypeScriptClassWrapper",
    NeverApplyImportHelper: 2,
    "2": "NeverApplyImportHelper",
    IgnoreSourceNewlines: 4,
    "4": "IgnoreSourceNewlines",
    Immutable: 8,
    "8": "Immutable",
    IndirectCall: 16,
    "16": "IndirectCall",
    TransformPrivateStaticElements: 32,
    "32": "TransformPrivateStaticElements"
};
// dprint-ignore
export interface EmitHelperBase {
    name: string; // A unique name for this helper.
    scoped: boolean; // Indicates whether the helper MUST be emitted in the current scope.
    text: string | ((node: EmitHelperUniqueNameCallback) => string); // ES3-compatible raw script text, or a function yielding such a string
    priority?: number; // Helpers with a higher priority are emitted earlier than other helpers on the node.
    dependencies?: EmitHelper[];
}
export interface ScopedEmitHelper extends EmitHelperBase {
    scoped: true;
}
// dprint-ignore
export interface UnscopedEmitHelper extends EmitHelperBase {
    scoped: false; // Indicates whether the helper MUST be emitted in the current scope.
    /** @internal */
    importName?: string; // The name of the helper to use when importing via `--importHelpers`.
    text: string; // ES3-compatible raw script text, or a function yielding such a string
}
export type EmitHelper = ScopedEmitHelper | UnscopedEmitHelper;
export type EmitHelperUniqueNameCallback = (name: string) => string;
/** @internal */
export type LanugageFeatures = 
// ES2015 Features
"Classes" | "ForOf" | "Generators" | "Iteration" | "SpreadElements" | "RestElements" | "TaggedTemplates" | "DestructuringAssignment" | "BindingPatterns" | "ArrowFunctions" | "BlockScopedVariables" | "ObjectAssign" | "RegularExpressionFlagsUnicode" | "RegularExpressionFlagsSticky"
// ES2016 Features
 | "Exponentiation" // `x ** y`
// ES2017 Features
 | "AsyncFunctions" // `async function f() {}`
// ES2018 Features
 | "ForAwaitOf" // `for await (const x of y)`
 | "AsyncGenerators" // `async function * f() { }`
 | "AsyncIteration" // `Symbol.asyncIterator`
 | "ObjectSpreadRest" // `{ ...obj }`
 | "RegularExpressionFlagsDotAll"
// ES2019 Features
 | "BindinglessCatch" // `try { } catch { }`
// ES2020 Features
 | "BigInt" // `0n`
 | "NullishCoalesce" // `a ?? b`
 | "OptionalChaining" // `a?.b`
// ES2021 Features
 | "LogicalAssignment" // `a ||= b`| `a &&= b`| `a ??= b`
// ES2022 Features
 | "TopLevelAwait" | "ClassFields" | "PrivateNamesAndClassStaticBlocks" // `class C { static {} #x = y| #m() {} }`| `#x in y`
 | "RegularExpressionFlagsHasIndices"
// ES2023 Features
 | "ShebangComments"
// ES2024 Features
 | "RegularExpressionFlagsUnicodeSets"
// Upcoming Features
// NOTE: We must reevaluate the target for upcoming features when each successive TC39 edition is ratified in
//       June of each year. This includes changes to `LanguageFeatureMinimumTarget`, `ScriptTarget`,
//       `ScriptTargetFeatures` transformers/esnext.ts, compiler/commandLineParser.ts,
//       compiler/utilitiesPublic.ts, and the contents of each lib/esnext.*.d.ts file.
 | "UsingAndAwaitUsing" // `using x = y`, `await using x = y`
 | "ClassAndClassElementDecorators" // `@dec class C {}`, `class C { @dec m() {} }`
;
/**
 * Indicates the minimum `ScriptTarget` (inclusive) after which a specific language feature is no longer transpiled.
 *
 * @internal
 */
export const LanguageFeatureMinimumTarget: Record<LanugageFeatures, ScriptTarget> = {
    Classes: ScriptTarget.ES2015,
    ForOf: ScriptTarget.ES2015,
    Generators: ScriptTarget.ES2015,
    Iteration: ScriptTarget.ES2015,
    SpreadElements: ScriptTarget.ES2015,
    RestElements: ScriptTarget.ES2015,
    TaggedTemplates: ScriptTarget.ES2015,
    DestructuringAssignment: ScriptTarget.ES2015,
    BindingPatterns: ScriptTarget.ES2015,
    ArrowFunctions: ScriptTarget.ES2015,
    BlockScopedVariables: ScriptTarget.ES2015,
    ObjectAssign: ScriptTarget.ES2015,
    RegularExpressionFlagsUnicode: ScriptTarget.ES2015,
    RegularExpressionFlagsSticky: ScriptTarget.ES2015,
    Exponentiation: ScriptTarget.ES2016,
    AsyncFunctions: ScriptTarget.ES2017,
    ForAwaitOf: ScriptTarget.ES2018,
    AsyncGenerators: ScriptTarget.ES2018,
    AsyncIteration: ScriptTarget.ES2018,
    ObjectSpreadRest: ScriptTarget.ES2018,
    RegularExpressionFlagsDotAll: ScriptTarget.ES2018,
    BindinglessCatch: ScriptTarget.ES2019,
    BigInt: ScriptTarget.ES2020,
    NullishCoalesce: ScriptTarget.ES2020,
    OptionalChaining: ScriptTarget.ES2020,
    LogicalAssignment: ScriptTarget.ES2021,
    TopLevelAwait: ScriptTarget.ES2022,
    ClassFields: ScriptTarget.ES2022,
    PrivateNamesAndClassStaticBlocks: ScriptTarget.ES2022,
    RegularExpressionFlagsHasIndices: ScriptTarget.ES2022,
    ShebangComments: ScriptTarget.ES2023,
    RegularExpressionFlagsUnicodeSets: ScriptTarget.ES2024,
    UsingAndAwaitUsing: ScriptTarget.ESNext,
    ClassAndClassElementDecorators: ScriptTarget.ESNext,
};
// dprint-ignore
/**
 * Used by the checker, this enum keeps track of external emit helpers that should be type
 * checked.
 *
 * @internal
 */
export type ExternalEmitHelpers = number;
// dprint-ignore
/**
 * Used by the checker, this enum keeps track of external emit helpers that should be type
 * checked.
 *
 * @internal
 */
export const ExternalEmitHelpers: {
    readonly Extends: 1;
    readonly Assign: 2;
    readonly Rest: 4;
    readonly Decorate: 8;
    readonly ESDecorateAndRunInitializers: 8;
    readonly Metadata: 16;
    readonly Param: 32;
    readonly Awaiter: 64;
    readonly Generator: 128;
    readonly Values: 256;
    readonly Read: 512;
    readonly SpreadArray: 1024;
    readonly Await: 2048;
    readonly AsyncGenerator: 4096;
    readonly AsyncDelegator: 8192;
    readonly AsyncValues: 16384;
    readonly ExportStar: 32768;
    readonly ImportStar: 65536;
    readonly ImportDefault: 131072;
    readonly MakeTemplateObject: 262144;
    readonly ClassPrivateFieldGet: 524288;
    readonly ClassPrivateFieldSet: 1048576;
    readonly ClassPrivateFieldIn: 2097152;
    readonly SetFunctionName: 4194304;
    readonly PropKey: 8388608;
    readonly AddDisposableResourceAndDisposeResources: 16777216;
    readonly RewriteRelativeImportExtension: 33554432;
    readonly FirstEmitHelper: 1;
    readonly LastEmitHelper: 16777216;
    readonly ForOfIncludes: 256;
    readonly ForAwaitOfIncludes: 16384;
    readonly AsyncGeneratorIncludes: 6144;
    readonly AsyncDelegatorIncludes: 26624;
    readonly SpreadIncludes: 1536;
    [index: number]: string;
} = {
    Extends: 1,
    "1": "FirstEmitHelper",
    Assign: 2,
    "2": "Assign",
    Rest: 4,
    "4": "Rest",
    Decorate: 8,
    "8": "ESDecorateAndRunInitializers",
    ESDecorateAndRunInitializers: 8,
    Metadata: 16,
    "16": "Metadata",
    Param: 32,
    "32": "Param",
    Awaiter: 64,
    "64": "Awaiter",
    Generator: 128,
    "128": "Generator",
    Values: 256,
    "256": "ForOfIncludes",
    Read: 512,
    "512": "Read",
    SpreadArray: 1024,
    "1024": "SpreadArray",
    Await: 2048,
    "2048": "Await",
    AsyncGenerator: 4096,
    "4096": "AsyncGenerator",
    AsyncDelegator: 8192,
    "8192": "AsyncDelegator",
    AsyncValues: 16384,
    "16384": "ForAwaitOfIncludes",
    ExportStar: 32768,
    "32768": "ExportStar",
    ImportStar: 65536,
    "65536": "ImportStar",
    ImportDefault: 131072,
    "131072": "ImportDefault",
    MakeTemplateObject: 262144,
    "262144": "MakeTemplateObject",
    ClassPrivateFieldGet: 524288,
    "524288": "ClassPrivateFieldGet",
    ClassPrivateFieldSet: 1048576,
    "1048576": "ClassPrivateFieldSet",
    ClassPrivateFieldIn: 2097152,
    "2097152": "ClassPrivateFieldIn",
    SetFunctionName: 4194304,
    "4194304": "SetFunctionName",
    PropKey: 8388608,
    "8388608": "PropKey",
    AddDisposableResourceAndDisposeResources: 16777216,
    "16777216": "LastEmitHelper",
    RewriteRelativeImportExtension: 33554432,
    "33554432": "RewriteRelativeImportExtension",
    FirstEmitHelper: 1,
    LastEmitHelper: 16777216,
    ForOfIncludes: 256,
    ForAwaitOfIncludes: 16384,
    AsyncGeneratorIncludes: 6144,
    "6144": "AsyncGeneratorIncludes",
    AsyncDelegatorIncludes: 26624,
    "26624": "AsyncDelegatorIncludes",
    SpreadIncludes: 1536,
    "1536": "SpreadIncludes"
};
// dprint-ignore
export type EmitHint = number;
// dprint-ignore
export const EmitHint: {
    readonly SourceFile: 0;
    readonly Expression: 1;
    readonly IdentifierName: 2;
    readonly MappedTypeParameter: 3;
    readonly Unspecified: 4;
    readonly EmbeddedStatement: 5;
    readonly JsxAttributeValue: 6;
    readonly ImportTypeNodeAttributes: 7;
    [index: number]: string;
} = {
    SourceFile: 0,
    "0": "SourceFile",
    Expression: 1,
    "1": "Expression",
    IdentifierName: 2,
    "2": "IdentifierName",
    MappedTypeParameter: 3,
    "3": "MappedTypeParameter",
    Unspecified: 4,
    "4": "Unspecified",
    EmbeddedStatement: 5,
    "5": "EmbeddedStatement",
    JsxAttributeValue: 6,
    "6": "JsxAttributeValue",
    ImportTypeNodeAttributes: 7,
    "7": "ImportTypeNodeAttributes"
};
/** @internal */
export interface SourceFileMayBeEmittedHost {
    getCompilerOptions(): CompilerOptions;
    isSourceFileFromExternalLibrary(file: SourceFile): boolean;
    getRedirectFromSourceFile(fileName: string): ResolvedRefAndOutputDts | undefined;
    isSourceOfProjectReferenceRedirect(fileName: string): boolean;
    getCurrentDirectory(): string;
    getCanonicalFileName: GetCanonicalFileName;
    useCaseSensitiveFileNames(): boolean;
}
/** @internal */
export interface EmitHost extends ScriptReferenceHost, ModuleSpecifierResolutionHost, SourceFileMayBeEmittedHost {
    getSourceFiles(): readonly SourceFile[];
    useCaseSensitiveFileNames(): boolean;
    getCurrentDirectory(): string;
    getCommonSourceDirectory(): string;
    getCanonicalFileName(fileName: string): string;
    isEmitBlocked(emitFileName: string): boolean;
    shouldTransformImportCall(sourceFile: SourceFile): boolean;
    getEmitModuleFormatOfFile(sourceFile: SourceFile): ModuleKind;
    writeFile: WriteFileCallback;
    getBuildInfo(): BuildInfo | undefined;
    getSourceFileFromReference: Program["getSourceFileFromReference"];
    redirectTargetsMap: RedirectTargetsMap;
    createHash?(data: string): string;
}
/** @internal */
export interface PropertyDescriptorAttributes {
    enumerable?: boolean | Expression;
    configurable?: boolean | Expression;
    writable?: boolean | Expression;
    value?: Expression;
    get?: Expression;
    set?: Expression;
}
export type OuterExpressionKinds = number;
export const OuterExpressionKinds: {
    readonly Parentheses: 1;
    readonly TypeAssertions: 2;
    readonly NonNullAssertions: 4;
    readonly PartiallyEmittedExpressions: 8;
    readonly ExpressionsWithTypeArguments: 16;
    readonly Satisfies: 32;
    readonly Assertions: 38;
    readonly All: 63;
    readonly ExcludeJSDocTypeAssertion: -2147483648;
    [index: number]: string;
} = {
    Parentheses: 1,
    "1": "Parentheses",
    TypeAssertions: 2,
    "2": "TypeAssertions",
    NonNullAssertions: 4,
    "4": "NonNullAssertions",
    PartiallyEmittedExpressions: 8,
    "8": "PartiallyEmittedExpressions",
    ExpressionsWithTypeArguments: 16,
    "16": "ExpressionsWithTypeArguments",
    Satisfies: 32,
    "32": "Satisfies",
    Assertions: 38,
    "38": "Assertions",
    All: 63,
    "63": "All",
    ExcludeJSDocTypeAssertion: -2147483648,
    "-2147483648": "ExcludeJSDocTypeAssertion"
};
/** @internal */
export type OuterExpression = ParenthesizedExpression | TypeAssertion | SatisfiesExpression | AsExpression | NonNullExpression | ExpressionWithTypeArguments | PartiallyEmittedExpression;
/** @internal */
export type WrappedExpression<T extends Expression> = (OuterExpression & {
    expression: WrappedExpression<T>;
}) | T;
/** @internal */
export type TypeOfTag = "null" | "undefined" | "number" | "bigint" | "boolean" | "string" | "symbol" | "object" | "function";
/** @internal */
export interface CallBinding {
    target: LeftHandSideExpression;
    thisArg: Expression;
}
/** @internal */
export interface ParenthesizerRules {
    getParenthesizeLeftSideOfBinaryForOperator(binaryOperator: SyntaxKind): (leftSide: Expression) => Expression;
    getParenthesizeRightSideOfBinaryForOperator(binaryOperator: SyntaxKind): (rightSide: Expression) => Expression;
    parenthesizeLeftSideOfBinary(binaryOperator: SyntaxKind, leftSide: Expression): Expression;
    parenthesizeRightSideOfBinary(binaryOperator: SyntaxKind, leftSide: Expression | undefined, rightSide: Expression): Expression;
    parenthesizeExpressionOfComputedPropertyName(expression: Expression): Expression;
    parenthesizeConditionOfConditionalExpression(condition: Expression): Expression;
    parenthesizeBranchOfConditionalExpression(branch: Expression): Expression;
    parenthesizeExpressionOfExportDefault(expression: Expression): Expression;
    parenthesizeExpressionOfNew(expression: Expression): LeftHandSideExpression;
    parenthesizeLeftSideOfAccess(expression: Expression, optionalChain?: boolean): LeftHandSideExpression;
    parenthesizeOperandOfPostfixUnary(operand: Expression): LeftHandSideExpression;
    parenthesizeOperandOfPrefixUnary(operand: Expression): UnaryExpression;
    parenthesizeExpressionsOfCommaDelimitedList(elements: readonly Expression[]): NodeArray<Expression>;
    parenthesizeExpressionForDisallowedComma(expression: Expression): Expression;
    parenthesizeExpressionOfExpressionStatement(expression: Expression): Expression;
    parenthesizeConciseBodyOfArrowFunction(body: Expression): Expression;
    parenthesizeConciseBodyOfArrowFunction(body: ConciseBody): ConciseBody;
    parenthesizeCheckTypeOfConditionalType(type: TypeNode): TypeNode;
    parenthesizeExtendsTypeOfConditionalType(type: TypeNode): TypeNode;
    parenthesizeOperandOfTypeOperator(type: TypeNode): TypeNode;
    parenthesizeOperandOfReadonlyTypeOperator(type: TypeNode): TypeNode;
    parenthesizeNonArrayTypeOfPostfixType(type: TypeNode): TypeNode;
    parenthesizeElementTypesOfTupleType(types: readonly (TypeNode | NamedTupleMember)[]): NodeArray<TypeNode>;
    parenthesizeElementTypeOfTupleType(type: TypeNode | NamedTupleMember): TypeNode | NamedTupleMember;
    parenthesizeTypeOfOptionalType(type: TypeNode): TypeNode;
    parenthesizeConstituentTypeOfUnionType(type: TypeNode): TypeNode;
    parenthesizeConstituentTypesOfUnionType(constituents: readonly TypeNode[]): NodeArray<TypeNode>;
    parenthesizeConstituentTypeOfIntersectionType(type: TypeNode): TypeNode;
    parenthesizeConstituentTypesOfIntersectionType(constituents: readonly TypeNode[]): NodeArray<TypeNode>;
    parenthesizeLeadingTypeArgument(typeNode: TypeNode): TypeNode;
    parenthesizeTypeArguments(typeParameters: readonly TypeNode[] | undefined): NodeArray<TypeNode> | undefined;
}
/** @internal */
export interface NodeConverters {
    convertToFunctionBlock(node: ConciseBody, multiLine?: boolean): Block;
    convertToFunctionExpression(node: FunctionDeclaration): FunctionExpression;
    convertToClassExpression(node: ClassDeclaration): ClassExpression;
    convertToArrayAssignmentElement(element: ArrayBindingOrAssignmentElement): Expression;
    convertToObjectAssignmentElement(element: ObjectBindingOrAssignmentElement): ObjectLiteralElementLike;
    convertToAssignmentPattern(node: BindingOrAssignmentPattern): AssignmentPattern;
    convertToObjectAssignmentPattern(node: ObjectBindingOrAssignmentPattern): ObjectLiteralExpression;
    convertToArrayAssignmentPattern(node: ArrayBindingOrAssignmentPattern): ArrayLiteralExpression;
    convertToAssignmentElementTarget(node: BindingOrAssignmentElementTarget): Expression;
}
/** @internal */
export interface GeneratedNamePart {
    /** an additional prefix to insert before the text sourced from `node` */
    prefix?: string;
    node: Identifier | PrivateIdentifier;
    /** an additional suffix to insert after the text sourced from `node` */
    suffix?: string;
}
export type ImmediatelyInvokedFunctionExpression = CallExpression & {
    expression: FunctionExpression;
};
export type ImmediatelyInvokedArrowFunction = CallExpression & {
    expression: ParenthesizedExpression & {
        expression: ArrowFunction;
    };
};
export interface NodeFactory {
    /** @internal */ parenthesizer: ParenthesizerRules;
    /** @internal */ converters: NodeConverters;
    /** @internal */ baseFactory: BaseNodeFactory;
    /** @internal */ flags: NodeFactoryFlags;
    createNodeArray<T extends Node>(elements?: readonly T[], hasTrailingComma?: boolean): NodeArray<T>;
    //
    // Literals
    //
    createNumericLiteral(value: string | number, numericLiteralFlags?: TokenFlags): NumericLiteral;
    createBigIntLiteral(value: string | PseudoBigInt): BigIntLiteral;
    createStringLiteral(text: string, isSingleQuote?: boolean): StringLiteral;
    /** @internal */ createStringLiteral(text: string, isSingleQuote?: boolean, hasExtendedUnicodeEscape?: boolean): StringLiteral; // eslint-disable-line @typescript-eslint/unified-signatures
    createStringLiteralFromNode(sourceNode: PropertyNameLiteral | PrivateIdentifier, isSingleQuote?: boolean): StringLiteral;
    createRegularExpressionLiteral(text: string): RegularExpressionLiteral;
    //
    // Identifiers
    //
    createIdentifier(text: string): Identifier;
    /** @internal */ createIdentifier(text: string, originalKeywordKind?: SyntaxKind, hasExtendedUnicodeEscape?: boolean): Identifier; // eslint-disable-line @typescript-eslint/unified-signatures
    /**
     * Create a unique temporary variable.
     * @param recordTempVariable An optional callback used to record the temporary variable name. This
     * should usually be a reference to `hoistVariableDeclaration` from a `TransformationContext`, but
     * can be `undefined` if you plan to record the temporary variable manually.
     * @param reservedInNestedScopes When `true`, reserves the temporary variable name in all nested scopes
     * during emit so that the variable can be referenced in a nested function body. This is an alternative to
     * setting `EmitFlags.ReuseTempVariableScope` on the nested function itself.
     */
    createTempVariable(recordTempVariable: ((node: Identifier) => void) | undefined, reservedInNestedScopes?: boolean): Identifier;
    /** @internal */ createTempVariable(recordTempVariable: ((node: Identifier) => void) | undefined, reservedInNestedScopes?: boolean, prefix?: string | GeneratedNamePart, suffix?: string): Identifier; // eslint-disable-line @typescript-eslint/unified-signatures
    /**
     * Create a unique temporary variable for use in a loop.
     * @param reservedInNestedScopes When `true`, reserves the temporary variable name in all nested scopes
     * during emit so that the variable can be referenced in a nested function body. This is an alternative to
     * setting `EmitFlags.ReuseTempVariableScope` on the nested function itself.
     */
    createLoopVariable(reservedInNestedScopes?: boolean): Identifier;
    /** Create a unique name based on the supplied text. */
    createUniqueName(text: string, flags?: GeneratedIdentifierFlags): Identifier;
    /** @internal */ createUniqueName(text: string, flags?: GeneratedIdentifierFlags, prefix?: string | GeneratedNamePart, suffix?: string): Identifier; // eslint-disable-line @typescript-eslint/unified-signatures
    /** Create a unique name generated for a node. */
    getGeneratedNameForNode(node: Node | undefined, flags?: GeneratedIdentifierFlags): Identifier;
    /** @internal */ getGeneratedNameForNode(node: Node | undefined, flags?: GeneratedIdentifierFlags, prefix?: string | GeneratedNamePart, suffix?: string): Identifier; // eslint-disable-line @typescript-eslint/unified-signatures
    createPrivateIdentifier(text: string): PrivateIdentifier;
    createUniquePrivateName(text?: string): PrivateIdentifier;
    /** @internal */ createUniquePrivateName(text?: string, prefix?: string | GeneratedNamePart, suffix?: string): PrivateIdentifier; // eslint-disable-line @typescript-eslint/unified-signatures
    getGeneratedPrivateNameForNode(node: Node): PrivateIdentifier;
    /** @internal */ getGeneratedPrivateNameForNode(node: Node, prefix?: string | GeneratedNamePart, suffix?: string): PrivateIdentifier; // eslint-disable-line @typescript-eslint/unified-signatures
    //
    // Punctuation
    //
    createToken(token: typeof SyntaxKind.SuperKeyword): SuperExpression;
    createToken(token: typeof SyntaxKind.ThisKeyword): ThisExpression;
    createToken(token: typeof SyntaxKind.NullKeyword): NullLiteral;
    createToken(token: typeof SyntaxKind.TrueKeyword): TrueLiteral;
    createToken(token: typeof SyntaxKind.FalseKeyword): FalseLiteral;
    createToken(token: typeof SyntaxKind.EndOfFileToken): EndOfFileToken;
    createToken(token: typeof SyntaxKind.Unknown): Token<typeof SyntaxKind.Unknown>;
    createToken<TKind extends PunctuationSyntaxKind>(token: TKind): PunctuationToken<TKind>;
    createToken<TKind extends KeywordTypeSyntaxKind>(token: TKind): KeywordTypeNode<TKind>;
    createToken<TKind extends ModifierSyntaxKind>(token: TKind): ModifierToken<TKind>;
    createToken<TKind extends KeywordSyntaxKind>(token: TKind): KeywordToken<TKind>;
    /** @internal */ createToken<TKind extends SyntaxKind>(token: TKind): Token<TKind>;
    //
    // Reserved words
    //
    createSuper(): SuperExpression;
    createThis(): ThisExpression;
    createNull(): NullLiteral;
    createTrue(): TrueLiteral;
    createFalse(): FalseLiteral;
    //
    // Modifiers
    //
    createModifier<T extends ModifierSyntaxKind>(kind: T): ModifierToken<T>;
    createModifiersFromModifierFlags(flags: ModifierFlags): Modifier[] | undefined;
    //
    // Names
    //
    createQualifiedName(left: EntityName, right: string | Identifier): QualifiedName;
    updateQualifiedName(node: QualifiedName, left: EntityName, right: Identifier): QualifiedName;
    createComputedPropertyName(expression: Expression): ComputedPropertyName;
    updateComputedPropertyName(node: ComputedPropertyName, expression: Expression): ComputedPropertyName;
    //
    // Signature elements
    //
    createTypeParameterDeclaration(modifiers: readonly Modifier[] | undefined, name: string | Identifier, constraint?: TypeNode, defaultType?: TypeNode): TypeParameterDeclaration;
    updateTypeParameterDeclaration(node: TypeParameterDeclaration, modifiers: readonly Modifier[] | undefined, name: Identifier, constraint: TypeNode | undefined, defaultType: TypeNode | undefined): TypeParameterDeclaration;
    createParameterDeclaration(modifiers: readonly ModifierLike[] | undefined, dotDotDotToken: DotDotDotToken | undefined, name: string | BindingName, questionToken?: QuestionToken, type?: TypeNode, initializer?: Expression): ParameterDeclaration;
    updateParameterDeclaration(node: ParameterDeclaration, modifiers: readonly ModifierLike[] | undefined, dotDotDotToken: DotDotDotToken | undefined, name: string | BindingName, questionToken: QuestionToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined): ParameterDeclaration;
    createDecorator(expression: Expression): Decorator;
    updateDecorator(node: Decorator, expression: Expression): Decorator;
    //
    // Type Elements
    //
    createPropertySignature(modifiers: readonly Modifier[] | undefined, name: PropertyName | string, questionToken: QuestionToken | undefined, type: TypeNode | undefined): PropertySignature;
    updatePropertySignature(node: PropertySignature, modifiers: readonly Modifier[] | undefined, name: PropertyName, questionToken: QuestionToken | undefined, type: TypeNode | undefined): PropertySignature;
    createPropertyDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, questionOrExclamationToken: QuestionToken | ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined): PropertyDeclaration;
    updatePropertyDeclaration(node: PropertyDeclaration, modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, questionOrExclamationToken: QuestionToken | ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined): PropertyDeclaration;
    createMethodSignature(modifiers: readonly Modifier[] | undefined, name: string | PropertyName, questionToken: QuestionToken | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): MethodSignature;
    updateMethodSignature(node: MethodSignature, modifiers: readonly Modifier[] | undefined, name: PropertyName, questionToken: QuestionToken | undefined, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode | undefined): MethodSignature;
    createMethodDeclaration(modifiers: readonly ModifierLike[] | undefined, asteriskToken: AsteriskToken | undefined, name: string | PropertyName, questionToken: QuestionToken | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined): MethodDeclaration;
    updateMethodDeclaration(node: MethodDeclaration, modifiers: readonly ModifierLike[] | undefined, asteriskToken: AsteriskToken | undefined, name: PropertyName, questionToken: QuestionToken | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined): MethodDeclaration;
    createConstructorDeclaration(modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], body: Block | undefined): ConstructorDeclaration;
    updateConstructorDeclaration(node: ConstructorDeclaration, modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], body: Block | undefined): ConstructorDeclaration;
    createGetAccessorDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined): GetAccessorDeclaration;
    updateGetAccessorDeclaration(node: GetAccessorDeclaration, modifiers: readonly ModifierLike[] | undefined, name: PropertyName, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined): GetAccessorDeclaration;
    createSetAccessorDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | PropertyName, parameters: readonly ParameterDeclaration[], body: Block | undefined): SetAccessorDeclaration;
    updateSetAccessorDeclaration(node: SetAccessorDeclaration, modifiers: readonly ModifierLike[] | undefined, name: PropertyName, parameters: readonly ParameterDeclaration[], body: Block | undefined): SetAccessorDeclaration;
    createCallSignature(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): CallSignatureDeclaration;
    updateCallSignature(node: CallSignatureDeclaration, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode | undefined): CallSignatureDeclaration;
    createConstructSignature(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): ConstructSignatureDeclaration;
    updateConstructSignature(node: ConstructSignatureDeclaration, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode | undefined): ConstructSignatureDeclaration;
    createIndexSignature(modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode): IndexSignatureDeclaration;
    /** @internal */ createIndexSignature(modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): IndexSignatureDeclaration; // eslint-disable-line @typescript-eslint/unified-signatures
    updateIndexSignature(node: IndexSignatureDeclaration, modifiers: readonly ModifierLike[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): IndexSignatureDeclaration;
    createTemplateLiteralTypeSpan(type: TypeNode, literal: TemplateMiddle | TemplateTail): TemplateLiteralTypeSpan;
    updateTemplateLiteralTypeSpan(node: TemplateLiteralTypeSpan, type: TypeNode, literal: TemplateMiddle | TemplateTail): TemplateLiteralTypeSpan;
    createClassStaticBlockDeclaration(body: Block): ClassStaticBlockDeclaration;
    updateClassStaticBlockDeclaration(node: ClassStaticBlockDeclaration, body: Block): ClassStaticBlockDeclaration;
    //
    // Types
    //
    createKeywordTypeNode<TKind extends KeywordTypeSyntaxKind>(kind: TKind): KeywordTypeNode<TKind>;
    createTypePredicateNode(assertsModifier: AssertsKeyword | undefined, parameterName: Identifier | ThisTypeNode | string, type: TypeNode | undefined): TypePredicateNode;
    updateTypePredicateNode(node: TypePredicateNode, assertsModifier: AssertsKeyword | undefined, parameterName: Identifier | ThisTypeNode, type: TypeNode | undefined): TypePredicateNode;
    createTypeReferenceNode(typeName: string | EntityName, typeArguments?: readonly TypeNode[]): TypeReferenceNode;
    updateTypeReferenceNode(node: TypeReferenceNode, typeName: EntityName, typeArguments: NodeArray<TypeNode> | undefined): TypeReferenceNode;
    createFunctionTypeNode(typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode): FunctionTypeNode;
    updateFunctionTypeNode(node: FunctionTypeNode, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode): FunctionTypeNode;
    createConstructorTypeNode(modifiers: readonly Modifier[] | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode): ConstructorTypeNode;
    updateConstructorTypeNode(node: ConstructorTypeNode, modifiers: readonly Modifier[] | undefined, typeParameters: NodeArray<TypeParameterDeclaration> | undefined, parameters: NodeArray<ParameterDeclaration>, type: TypeNode): ConstructorTypeNode;
    createTypeQueryNode(exprName: EntityName, typeArguments?: readonly TypeNode[]): TypeQueryNode;
    updateTypeQueryNode(node: TypeQueryNode, exprName: EntityName, typeArguments?: readonly TypeNode[]): TypeQueryNode;
    createTypeLiteralNode(members: readonly TypeElement[] | undefined): TypeLiteralNode;
    updateTypeLiteralNode(node: TypeLiteralNode, members: NodeArray<TypeElement>): TypeLiteralNode;
    createArrayTypeNode(elementType: TypeNode): ArrayTypeNode;
    updateArrayTypeNode(node: ArrayTypeNode, elementType: TypeNode): ArrayTypeNode;
    createTupleTypeNode(elements: readonly (TypeNode | NamedTupleMember)[]): TupleTypeNode;
    updateTupleTypeNode(node: TupleTypeNode, elements: readonly (TypeNode | NamedTupleMember)[]): TupleTypeNode;
    createNamedTupleMember(dotDotDotToken: DotDotDotToken | undefined, name: Identifier, questionToken: QuestionToken | undefined, type: TypeNode): NamedTupleMember;
    updateNamedTupleMember(node: NamedTupleMember, dotDotDotToken: DotDotDotToken | undefined, name: Identifier, questionToken: QuestionToken | undefined, type: TypeNode): NamedTupleMember;
    createOptionalTypeNode(type: TypeNode): OptionalTypeNode;
    updateOptionalTypeNode(node: OptionalTypeNode, type: TypeNode): OptionalTypeNode;
    createRestTypeNode(type: TypeNode): RestTypeNode;
    updateRestTypeNode(node: RestTypeNode, type: TypeNode): RestTypeNode;
    createUnionTypeNode(types: readonly TypeNode[]): UnionTypeNode;
    updateUnionTypeNode(node: UnionTypeNode, types: NodeArray<TypeNode>): UnionTypeNode;
    createIntersectionTypeNode(types: readonly TypeNode[]): IntersectionTypeNode;
    updateIntersectionTypeNode(node: IntersectionTypeNode, types: NodeArray<TypeNode>): IntersectionTypeNode;
    createConditionalTypeNode(checkType: TypeNode, extendsType: TypeNode, trueType: TypeNode, falseType: TypeNode): ConditionalTypeNode;
    updateConditionalTypeNode(node: ConditionalTypeNode, checkType: TypeNode, extendsType: TypeNode, trueType: TypeNode, falseType: TypeNode): ConditionalTypeNode;
    createInferTypeNode(typeParameter: TypeParameterDeclaration): InferTypeNode;
    updateInferTypeNode(node: InferTypeNode, typeParameter: TypeParameterDeclaration): InferTypeNode;
    createImportTypeNode(argument: TypeNode, attributes?: ImportAttributes, qualifier?: EntityName, typeArguments?: readonly TypeNode[], isTypeOf?: boolean): ImportTypeNode;
    updateImportTypeNode(node: ImportTypeNode, argument: TypeNode, attributes: ImportAttributes | undefined, qualifier: EntityName | undefined, typeArguments: readonly TypeNode[] | undefined, isTypeOf?: boolean): ImportTypeNode;
    createParenthesizedType(type: TypeNode): ParenthesizedTypeNode;
    updateParenthesizedType(node: ParenthesizedTypeNode, type: TypeNode): ParenthesizedTypeNode;
    createThisTypeNode(): ThisTypeNode;
    createTypeOperatorNode(operator: typeof SyntaxKind.KeyOfKeyword | typeof SyntaxKind.UniqueKeyword | typeof SyntaxKind.ReadonlyKeyword, type: TypeNode): TypeOperatorNode;
    updateTypeOperatorNode(node: TypeOperatorNode, type: TypeNode): TypeOperatorNode;
    createIndexedAccessTypeNode(objectType: TypeNode, indexType: TypeNode): IndexedAccessTypeNode;
    updateIndexedAccessTypeNode(node: IndexedAccessTypeNode, objectType: TypeNode, indexType: TypeNode): IndexedAccessTypeNode;
    createMappedTypeNode(readonlyToken: ReadonlyKeyword | PlusToken | MinusToken | undefined, typeParameter: TypeParameterDeclaration, nameType: TypeNode | undefined, questionToken: QuestionToken | PlusToken | MinusToken | undefined, type: TypeNode | undefined, members: NodeArray<TypeElement> | undefined): MappedTypeNode;
    updateMappedTypeNode(node: MappedTypeNode, readonlyToken: ReadonlyKeyword | PlusToken | MinusToken | undefined, typeParameter: TypeParameterDeclaration, nameType: TypeNode | undefined, questionToken: QuestionToken | PlusToken | MinusToken | undefined, type: TypeNode | undefined, members: NodeArray<TypeElement> | undefined): MappedTypeNode;
    createLiteralTypeNode(literal: LiteralTypeNode["literal"]): LiteralTypeNode;
    updateLiteralTypeNode(node: LiteralTypeNode, literal: LiteralTypeNode["literal"]): LiteralTypeNode;
    createTemplateLiteralType(head: TemplateHead, templateSpans: readonly TemplateLiteralTypeSpan[]): TemplateLiteralTypeNode;
    updateTemplateLiteralType(node: TemplateLiteralTypeNode, head: TemplateHead, templateSpans: readonly TemplateLiteralTypeSpan[]): TemplateLiteralTypeNode;
    //
    // Binding Patterns
    //
    createObjectBindingPattern(elements: readonly BindingElement[]): ObjectBindingPattern;
    updateObjectBindingPattern(node: ObjectBindingPattern, elements: readonly BindingElement[]): ObjectBindingPattern;
    createArrayBindingPattern(elements: readonly ArrayBindingElement[]): ArrayBindingPattern;
    updateArrayBindingPattern(node: ArrayBindingPattern, elements: readonly ArrayBindingElement[]): ArrayBindingPattern;
    createBindingElement(dotDotDotToken: DotDotDotToken | undefined, propertyName: string | PropertyName | undefined, name: string | BindingName, initializer?: Expression): BindingElement;
    updateBindingElement(node: BindingElement, dotDotDotToken: DotDotDotToken | undefined, propertyName: PropertyName | undefined, name: BindingName, initializer: Expression | undefined): BindingElement;
    //
    // Expression
    //
    createArrayLiteralExpression(elements?: readonly Expression[], multiLine?: boolean): ArrayLiteralExpression;
    updateArrayLiteralExpression(node: ArrayLiteralExpression, elements: readonly Expression[]): ArrayLiteralExpression;
    createObjectLiteralExpression(properties?: readonly ObjectLiteralElementLike[], multiLine?: boolean): ObjectLiteralExpression;
    updateObjectLiteralExpression(node: ObjectLiteralExpression, properties: readonly ObjectLiteralElementLike[]): ObjectLiteralExpression;
    createPropertyAccessExpression(expression: Expression, name: string | MemberName): PropertyAccessExpression;
    updatePropertyAccessExpression(node: PropertyAccessExpression, expression: Expression, name: MemberName): PropertyAccessExpression;
    createPropertyAccessChain(expression: Expression, questionDotToken: QuestionDotToken | undefined, name: string | MemberName): PropertyAccessChain;
    updatePropertyAccessChain(node: PropertyAccessChain, expression: Expression, questionDotToken: QuestionDotToken | undefined, name: MemberName): PropertyAccessChain;
    createElementAccessExpression(expression: Expression, index: number | Expression): ElementAccessExpression;
    updateElementAccessExpression(node: ElementAccessExpression, expression: Expression, argumentExpression: Expression): ElementAccessExpression;
    createElementAccessChain(expression: Expression, questionDotToken: QuestionDotToken | undefined, index: number | Expression): ElementAccessChain;
    updateElementAccessChain(node: ElementAccessChain, expression: Expression, questionDotToken: QuestionDotToken | undefined, argumentExpression: Expression): ElementAccessChain;
    createCallExpression(expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined): CallExpression;
    updateCallExpression(node: CallExpression, expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[]): CallExpression;
    createCallChain(expression: Expression, questionDotToken: QuestionDotToken | undefined, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined): CallChain;
    updateCallChain(node: CallChain, expression: Expression, questionDotToken: QuestionDotToken | undefined, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[]): CallChain;
    createNewExpression(expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined): NewExpression;
    updateNewExpression(node: NewExpression, expression: Expression, typeArguments: readonly TypeNode[] | undefined, argumentsArray: readonly Expression[] | undefined): NewExpression;
    createTaggedTemplateExpression(tag: Expression, typeArguments: readonly TypeNode[] | undefined, template: TemplateLiteral): TaggedTemplateExpression;
    updateTaggedTemplateExpression(node: TaggedTemplateExpression, tag: Expression, typeArguments: readonly TypeNode[] | undefined, template: TemplateLiteral): TaggedTemplateExpression;
    createTypeAssertion(type: TypeNode, expression: Expression): TypeAssertion;
    updateTypeAssertion(node: TypeAssertion, type: TypeNode, expression: Expression): TypeAssertion;
    createParenthesizedExpression(expression: Expression): ParenthesizedExpression;
    updateParenthesizedExpression(node: ParenthesizedExpression, expression: Expression): ParenthesizedExpression;
    createFunctionExpression(modifiers: readonly Modifier[] | undefined, asteriskToken: AsteriskToken | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[] | undefined, type: TypeNode | undefined, body: Block): FunctionExpression;
    updateFunctionExpression(node: FunctionExpression, modifiers: readonly Modifier[] | undefined, asteriskToken: AsteriskToken | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block): FunctionExpression;
    createArrowFunction(modifiers: readonly Modifier[] | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, equalsGreaterThanToken: EqualsGreaterThanToken | undefined, body: ConciseBody): ArrowFunction;
    updateArrowFunction(node: ArrowFunction, modifiers: readonly Modifier[] | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, equalsGreaterThanToken: EqualsGreaterThanToken, body: ConciseBody): ArrowFunction;
    createDeleteExpression(expression: Expression): DeleteExpression;
    updateDeleteExpression(node: DeleteExpression, expression: Expression): DeleteExpression;
    createTypeOfExpression(expression: Expression): TypeOfExpression;
    updateTypeOfExpression(node: TypeOfExpression, expression: Expression): TypeOfExpression;
    createVoidExpression(expression: Expression): VoidExpression;
    updateVoidExpression(node: VoidExpression, expression: Expression): VoidExpression;
    createAwaitExpression(expression: Expression): AwaitExpression;
    updateAwaitExpression(node: AwaitExpression, expression: Expression): AwaitExpression;
    createPrefixUnaryExpression(operator: PrefixUnaryOperator, operand: Expression): PrefixUnaryExpression;
    updatePrefixUnaryExpression(node: PrefixUnaryExpression, operand: Expression): PrefixUnaryExpression;
    createPostfixUnaryExpression(operand: Expression, operator: PostfixUnaryOperator): PostfixUnaryExpression;
    updatePostfixUnaryExpression(node: PostfixUnaryExpression, operand: Expression): PostfixUnaryExpression;
    createBinaryExpression(left: Expression, operator: BinaryOperator | BinaryOperatorToken, right: Expression): BinaryExpression;
    updateBinaryExpression(node: BinaryExpression, left: Expression, operator: BinaryOperator | BinaryOperatorToken, right: Expression): BinaryExpression;
    createConditionalExpression(condition: Expression, questionToken: QuestionToken | undefined, whenTrue: Expression, colonToken: ColonToken | undefined, whenFalse: Expression): ConditionalExpression;
    updateConditionalExpression(node: ConditionalExpression, condition: Expression, questionToken: QuestionToken, whenTrue: Expression, colonToken: ColonToken, whenFalse: Expression): ConditionalExpression;
    createTemplateExpression(head: TemplateHead, templateSpans: readonly TemplateSpan[]): TemplateExpression;
    updateTemplateExpression(node: TemplateExpression, head: TemplateHead, templateSpans: readonly TemplateSpan[]): TemplateExpression;
    createTemplateHead(text: string, rawText?: string, templateFlags?: TokenFlags): TemplateHead;
    createTemplateHead(text: string | undefined, rawText: string, templateFlags?: TokenFlags): TemplateHead;
    createTemplateMiddle(text: string, rawText?: string, templateFlags?: TokenFlags): TemplateMiddle;
    createTemplateMiddle(text: string | undefined, rawText: string, templateFlags?: TokenFlags): TemplateMiddle;
    createTemplateTail(text: string, rawText?: string, templateFlags?: TokenFlags): TemplateTail;
    createTemplateTail(text: string | undefined, rawText: string, templateFlags?: TokenFlags): TemplateTail;
    createNoSubstitutionTemplateLiteral(text: string, rawText?: string): NoSubstitutionTemplateLiteral;
    createNoSubstitutionTemplateLiteral(text: string | undefined, rawText: string): NoSubstitutionTemplateLiteral;
    /** @internal */ createLiteralLikeNode(kind: LiteralToken["kind"] | typeof SyntaxKind.JsxTextAllWhiteSpaces, text: string): LiteralToken;
    /** @internal */ createTemplateLiteralLikeNode(kind: TemplateLiteralToken["kind"], text: string, rawText: string, templateFlags: TokenFlags | undefined): TemplateLiteralLikeNode;
    createYieldExpression(asteriskToken: AsteriskToken, expression: Expression): YieldExpression;
    createYieldExpression(asteriskToken: undefined, expression: Expression | undefined): YieldExpression;
    /** @internal */ createYieldExpression(asteriskToken: AsteriskToken | undefined, expression: Expression | undefined): YieldExpression; // eslint-disable-line @typescript-eslint/unified-signatures
    updateYieldExpression(node: YieldExpression, asteriskToken: AsteriskToken | undefined, expression: Expression | undefined): YieldExpression;
    createSpreadElement(expression: Expression): SpreadElement;
    updateSpreadElement(node: SpreadElement, expression: Expression): SpreadElement;
    createClassExpression(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]): ClassExpression;
    updateClassExpression(node: ClassExpression, modifiers: readonly ModifierLike[] | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]): ClassExpression;
    createOmittedExpression(): OmittedExpression;
    createExpressionWithTypeArguments(expression: Expression, typeArguments: readonly TypeNode[] | undefined): ExpressionWithTypeArguments;
    updateExpressionWithTypeArguments(node: ExpressionWithTypeArguments, expression: Expression, typeArguments: readonly TypeNode[] | undefined): ExpressionWithTypeArguments;
    createAsExpression(expression: Expression, type: TypeNode): AsExpression;
    updateAsExpression(node: AsExpression, expression: Expression, type: TypeNode): AsExpression;
    createNonNullExpression(expression: Expression): NonNullExpression;
    updateNonNullExpression(node: NonNullExpression, expression: Expression): NonNullExpression;
    createNonNullChain(expression: Expression): NonNullChain;
    updateNonNullChain(node: NonNullChain, expression: Expression): NonNullChain;
    createMetaProperty(keywordToken: MetaProperty["keywordToken"], name: Identifier): MetaProperty;
    updateMetaProperty(node: MetaProperty, name: Identifier): MetaProperty;
    createSatisfiesExpression(expression: Expression, type: TypeNode): SatisfiesExpression;
    updateSatisfiesExpression(node: SatisfiesExpression, expression: Expression, type: TypeNode): SatisfiesExpression;
    //
    // Misc
    //
    createTemplateSpan(expression: Expression, literal: TemplateMiddle | TemplateTail): TemplateSpan;
    updateTemplateSpan(node: TemplateSpan, expression: Expression, literal: TemplateMiddle | TemplateTail): TemplateSpan;
    createSemicolonClassElement(): SemicolonClassElement;
    //
    // Element
    //
    createBlock(statements: readonly Statement[], multiLine?: boolean): Block;
    updateBlock(node: Block, statements: readonly Statement[]): Block;
    createVariableStatement(modifiers: readonly ModifierLike[] | undefined, declarationList: VariableDeclarationList | readonly VariableDeclaration[]): VariableStatement;
    updateVariableStatement(node: VariableStatement, modifiers: readonly ModifierLike[] | undefined, declarationList: VariableDeclarationList): VariableStatement;
    createEmptyStatement(): EmptyStatement;
    createExpressionStatement(expression: Expression): ExpressionStatement;
    updateExpressionStatement(node: ExpressionStatement, expression: Expression): ExpressionStatement;
    createIfStatement(expression: Expression, thenStatement: Statement, elseStatement?: Statement): IfStatement;
    updateIfStatement(node: IfStatement, expression: Expression, thenStatement: Statement, elseStatement: Statement | undefined): IfStatement;
    createDoStatement(statement: Statement, expression: Expression): DoStatement;
    updateDoStatement(node: DoStatement, statement: Statement, expression: Expression): DoStatement;
    createWhileStatement(expression: Expression, statement: Statement): WhileStatement;
    updateWhileStatement(node: WhileStatement, expression: Expression, statement: Statement): WhileStatement;
    createForStatement(initializer: ForInitializer | undefined, condition: Expression | undefined, incrementor: Expression | undefined, statement: Statement): ForStatement;
    updateForStatement(node: ForStatement, initializer: ForInitializer | undefined, condition: Expression | undefined, incrementor: Expression | undefined, statement: Statement): ForStatement;
    createForInStatement(initializer: ForInitializer, expression: Expression, statement: Statement): ForInStatement;
    updateForInStatement(node: ForInStatement, initializer: ForInitializer, expression: Expression, statement: Statement): ForInStatement;
    createForOfStatement(awaitModifier: AwaitKeyword | undefined, initializer: ForInitializer, expression: Expression, statement: Statement): ForOfStatement;
    updateForOfStatement(node: ForOfStatement, awaitModifier: AwaitKeyword | undefined, initializer: ForInitializer, expression: Expression, statement: Statement): ForOfStatement;
    createContinueStatement(label?: string | Identifier): ContinueStatement;
    updateContinueStatement(node: ContinueStatement, label: Identifier | undefined): ContinueStatement;
    createBreakStatement(label?: string | Identifier): BreakStatement;
    updateBreakStatement(node: BreakStatement, label: Identifier | undefined): BreakStatement;
    createReturnStatement(expression?: Expression): ReturnStatement;
    updateReturnStatement(node: ReturnStatement, expression: Expression | undefined): ReturnStatement;
    createWithStatement(expression: Expression, statement: Statement): WithStatement;
    updateWithStatement(node: WithStatement, expression: Expression, statement: Statement): WithStatement;
    createSwitchStatement(expression: Expression, caseBlock: CaseBlock): SwitchStatement;
    updateSwitchStatement(node: SwitchStatement, expression: Expression, caseBlock: CaseBlock): SwitchStatement;
    createLabeledStatement(label: string | Identifier, statement: Statement): LabeledStatement;
    updateLabeledStatement(node: LabeledStatement, label: Identifier, statement: Statement): LabeledStatement;
    createThrowStatement(expression: Expression): ThrowStatement;
    updateThrowStatement(node: ThrowStatement, expression: Expression): ThrowStatement;
    createTryStatement(tryBlock: Block, catchClause: CatchClause | undefined, finallyBlock: Block | undefined): TryStatement;
    updateTryStatement(node: TryStatement, tryBlock: Block, catchClause: CatchClause | undefined, finallyBlock: Block | undefined): TryStatement;
    createDebuggerStatement(): DebuggerStatement;
    createVariableDeclaration(name: string | BindingName, exclamationToken?: ExclamationToken, type?: TypeNode, initializer?: Expression): VariableDeclaration;
    updateVariableDeclaration(node: VariableDeclaration, name: BindingName, exclamationToken: ExclamationToken | undefined, type: TypeNode | undefined, initializer: Expression | undefined): VariableDeclaration;
    createVariableDeclarationList(declarations: readonly VariableDeclaration[], flags?: NodeFlags): VariableDeclarationList;
    updateVariableDeclarationList(node: VariableDeclarationList, declarations: readonly VariableDeclaration[]): VariableDeclarationList;
    createFunctionDeclaration(modifiers: readonly ModifierLike[] | undefined, asteriskToken: AsteriskToken | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined): FunctionDeclaration;
    updateFunctionDeclaration(node: FunctionDeclaration, modifiers: readonly ModifierLike[] | undefined, asteriskToken: AsteriskToken | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined, body: Block | undefined): FunctionDeclaration;
    createClassDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]): ClassDeclaration;
    updateClassDeclaration(node: ClassDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier | undefined, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly ClassElement[]): ClassDeclaration;
    createInterfaceDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly TypeElement[]): InterfaceDeclaration;
    updateInterfaceDeclaration(node: InterfaceDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, heritageClauses: readonly HeritageClause[] | undefined, members: readonly TypeElement[]): InterfaceDeclaration;
    createTypeAliasDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, type: TypeNode): TypeAliasDeclaration;
    updateTypeAliasDeclaration(node: TypeAliasDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier, typeParameters: readonly TypeParameterDeclaration[] | undefined, type: TypeNode): TypeAliasDeclaration;
    createEnumDeclaration(modifiers: readonly ModifierLike[] | undefined, name: string | Identifier, members: readonly EnumMember[]): EnumDeclaration;
    updateEnumDeclaration(node: EnumDeclaration, modifiers: readonly ModifierLike[] | undefined, name: Identifier, members: readonly EnumMember[]): EnumDeclaration;
    createModuleDeclaration(modifiers: readonly ModifierLike[] | undefined, name: ModuleName, body: ModuleBody | undefined, flags?: NodeFlags): ModuleDeclaration;
    updateModuleDeclaration(node: ModuleDeclaration, modifiers: readonly ModifierLike[] | undefined, name: ModuleName, body: ModuleBody | undefined): ModuleDeclaration;
    createModuleBlock(statements: readonly Statement[]): ModuleBlock;
    updateModuleBlock(node: ModuleBlock, statements: readonly Statement[]): ModuleBlock;
    createCaseBlock(clauses: readonly CaseOrDefaultClause[]): CaseBlock;
    updateCaseBlock(node: CaseBlock, clauses: readonly CaseOrDefaultClause[]): CaseBlock;
    createNamespaceExportDeclaration(name: string | Identifier): NamespaceExportDeclaration;
    updateNamespaceExportDeclaration(node: NamespaceExportDeclaration, name: Identifier): NamespaceExportDeclaration;
    createImportEqualsDeclaration(modifiers: readonly ModifierLike[] | undefined, isTypeOnly: boolean, name: string | Identifier, moduleReference: ModuleReference): ImportEqualsDeclaration;
    updateImportEqualsDeclaration(node: ImportEqualsDeclaration, modifiers: readonly ModifierLike[] | undefined, isTypeOnly: boolean, name: Identifier, moduleReference: ModuleReference): ImportEqualsDeclaration;
    createImportDeclaration(modifiers: readonly ModifierLike[] | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes?: ImportAttributes): ImportDeclaration;
    updateImportDeclaration(node: ImportDeclaration, modifiers: readonly ModifierLike[] | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes: ImportAttributes | undefined): ImportDeclaration;
    createImportClause(phaseModifier: ImportPhaseModifierSyntaxKind | undefined, name: Identifier | undefined, namedBindings: NamedImportBindings | undefined): ImportClause;
    // eslint-disable-next-line @typescript-eslint/unified-signatures -- Cannot unify due to the @deprecated tag
    /** @deprecated */ createImportClause(isTypeOnly: boolean, name: Identifier | undefined, namedBindings: NamedImportBindings | undefined): ImportClause;
    updateImportClause(node: ImportClause, phaseModifier: ImportPhaseModifierSyntaxKind | undefined, name: Identifier | undefined, namedBindings: NamedImportBindings | undefined): ImportClause;
    // eslint-disable-next-line @typescript-eslint/unified-signatures -- Cannot unify due to the @deprecated tag
    /** @deprecated */ updateImportClause(node: ImportClause, isTypeOnly: boolean, name: Identifier | undefined, namedBindings: NamedImportBindings | undefined): ImportClause;
    /** @deprecated */ createAssertClause(elements: NodeArray<AssertEntry>, multiLine?: boolean): AssertClause;
    /** @deprecated */ updateAssertClause(node: AssertClause, elements: NodeArray<AssertEntry>, multiLine?: boolean): AssertClause;
    /** @deprecated */ createAssertEntry(name: AssertionKey, value: Expression): AssertEntry;
    /** @deprecated */ updateAssertEntry(node: AssertEntry, name: AssertionKey, value: Expression): AssertEntry;
    /** @deprecated */ createImportTypeAssertionContainer(clause: AssertClause, multiLine?: boolean): ImportTypeAssertionContainer;
    /** @deprecated */ updateImportTypeAssertionContainer(node: ImportTypeAssertionContainer, clause: AssertClause, multiLine?: boolean): ImportTypeAssertionContainer;
    createImportAttributes(elements: NodeArray<ImportAttribute>, multiLine?: boolean): ImportAttributes;
    /** @internal */ createImportAttributes(elements: NodeArray<ImportAttribute>, multiLine?: boolean, token?: ImportAttributes["token"]): ImportAttributes; // eslint-disable-line @typescript-eslint/unified-signatures
    updateImportAttributes(node: ImportAttributes, elements: NodeArray<ImportAttribute>, multiLine?: boolean): ImportAttributes;
    createImportAttribute(name: ImportAttributeName, value: Expression): ImportAttribute;
    updateImportAttribute(node: ImportAttribute, name: ImportAttributeName, value: Expression): ImportAttribute;
    createNamespaceImport(name: Identifier): NamespaceImport;
    updateNamespaceImport(node: NamespaceImport, name: Identifier): NamespaceImport;
    createNamespaceExport(name: ModuleExportName): NamespaceExport;
    updateNamespaceExport(node: NamespaceExport, name: ModuleExportName): NamespaceExport;
    createNamedImports(elements: readonly ImportSpecifier[]): NamedImports;
    updateNamedImports(node: NamedImports, elements: readonly ImportSpecifier[]): NamedImports;
    createImportSpecifier(isTypeOnly: boolean, propertyName: ModuleExportName | undefined, name: Identifier): ImportSpecifier;
    updateImportSpecifier(node: ImportSpecifier, isTypeOnly: boolean, propertyName: ModuleExportName | undefined, name: Identifier): ImportSpecifier;
    createExportAssignment(modifiers: readonly ModifierLike[] | undefined, isExportEquals: boolean | undefined, expression: Expression): ExportAssignment;
    updateExportAssignment(node: ExportAssignment, modifiers: readonly ModifierLike[] | undefined, expression: Expression): ExportAssignment;
    createExportDeclaration(modifiers: readonly ModifierLike[] | undefined, isTypeOnly: boolean, exportClause: NamedExportBindings | undefined, moduleSpecifier?: Expression, attributes?: ImportAttributes): ExportDeclaration;
    updateExportDeclaration(node: ExportDeclaration, modifiers: readonly ModifierLike[] | undefined, isTypeOnly: boolean, exportClause: NamedExportBindings | undefined, moduleSpecifier: Expression | undefined, attributes: ImportAttributes | undefined): ExportDeclaration;
    createNamedExports(elements: readonly ExportSpecifier[]): NamedExports;
    updateNamedExports(node: NamedExports, elements: readonly ExportSpecifier[]): NamedExports;
    createExportSpecifier(isTypeOnly: boolean, propertyName: string | ModuleExportName | undefined, name: string | ModuleExportName): ExportSpecifier;
    updateExportSpecifier(node: ExportSpecifier, isTypeOnly: boolean, propertyName: ModuleExportName | undefined, name: ModuleExportName): ExportSpecifier;
    /** @internal */ createMissingDeclaration(): MissingDeclaration;
    //
    // Module references
    //
    createExternalModuleReference(expression: Expression): ExternalModuleReference;
    updateExternalModuleReference(node: ExternalModuleReference, expression: Expression): ExternalModuleReference;
    //
    // JSDoc
    //
    createJSDocAllType(): JSDocAllType;
    createJSDocUnknownType(): JSDocUnknownType;
    createJSDocNonNullableType(type: TypeNode, postfix?: boolean): JSDocNonNullableType;
    updateJSDocNonNullableType(node: JSDocNonNullableType, type: TypeNode): JSDocNonNullableType;
    createJSDocNullableType(type: TypeNode, postfix?: boolean): JSDocNullableType;
    updateJSDocNullableType(node: JSDocNullableType, type: TypeNode): JSDocNullableType;
    createJSDocOptionalType(type: TypeNode): JSDocOptionalType;
    updateJSDocOptionalType(node: JSDocOptionalType, type: TypeNode): JSDocOptionalType;
    createJSDocFunctionType(parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): JSDocFunctionType;
    updateJSDocFunctionType(node: JSDocFunctionType, parameters: readonly ParameterDeclaration[], type: TypeNode | undefined): JSDocFunctionType;
    createJSDocVariadicType(type: TypeNode): JSDocVariadicType;
    updateJSDocVariadicType(node: JSDocVariadicType, type: TypeNode): JSDocVariadicType;
    createJSDocNamepathType(type: TypeNode): JSDocNamepathType;
    updateJSDocNamepathType(node: JSDocNamepathType, type: TypeNode): JSDocNamepathType;
    createJSDocTypeExpression(type: TypeNode): JSDocTypeExpression;
    updateJSDocTypeExpression(node: JSDocTypeExpression, type: TypeNode): JSDocTypeExpression;
    createJSDocNameReference(name: EntityName | JSDocMemberName): JSDocNameReference;
    updateJSDocNameReference(node: JSDocNameReference, name: EntityName | JSDocMemberName): JSDocNameReference;
    createJSDocMemberName(left: EntityName | JSDocMemberName, right: Identifier): JSDocMemberName;
    updateJSDocMemberName(node: JSDocMemberName, left: EntityName | JSDocMemberName, right: Identifier): JSDocMemberName;
    createJSDocLink(name: EntityName | JSDocMemberName | undefined, text: string): JSDocLink;
    updateJSDocLink(node: JSDocLink, name: EntityName | JSDocMemberName | undefined, text: string): JSDocLink;
    createJSDocLinkCode(name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkCode;
    updateJSDocLinkCode(node: JSDocLinkCode, name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkCode;
    createJSDocLinkPlain(name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkPlain;
    updateJSDocLinkPlain(node: JSDocLinkPlain, name: EntityName | JSDocMemberName | undefined, text: string): JSDocLinkPlain;
    createJSDocTypeLiteral(jsDocPropertyTags?: readonly (JSDocPropertyLikeTag | JSDocThisTag)[], isArrayType?: boolean): JSDocTypeLiteral;
    updateJSDocTypeLiteral(node: JSDocTypeLiteral, jsDocPropertyTags: readonly (JSDocPropertyLikeTag | JSDocThisTag)[] | undefined, isArrayType: boolean | undefined): JSDocTypeLiteral;
    createJSDocSignature(typeParameters: readonly JSDocTemplateTag[] | undefined, parameters: readonly (JSDocParameterTag | JSDocThisTag)[], type?: JSDocReturnTag): JSDocSignature;
    updateJSDocSignature(node: JSDocSignature, typeParameters: readonly JSDocTemplateTag[] | undefined, parameters: readonly (JSDocParameterTag | JSDocThisTag)[], type: JSDocReturnTag | undefined): JSDocSignature;
    createJSDocTemplateTag(tagName: Identifier | undefined, constraint: JSDocTypeExpression | undefined, typeParameters: readonly TypeParameterDeclaration[], comment?: string | NodeArray<JSDocComment>): JSDocTemplateTag;
    updateJSDocTemplateTag(node: JSDocTemplateTag, tagName: Identifier | undefined, constraint: JSDocTypeExpression | undefined, typeParameters: readonly TypeParameterDeclaration[], comment: string | NodeArray<JSDocComment> | undefined): JSDocTemplateTag;
    createJSDocTypedefTag(tagName: Identifier | undefined, typeExpression?: JSDocTypeExpression | JSDocTypeLiteral, fullName?: Identifier | JSDocNamespaceDeclaration, comment?: string | NodeArray<JSDocComment>): JSDocTypedefTag;
    updateJSDocTypedefTag(node: JSDocTypedefTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression | JSDocTypeLiteral | undefined, fullName: Identifier | JSDocNamespaceDeclaration | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocTypedefTag;
    createJSDocParameterTag(tagName: Identifier | undefined, name: EntityName, isBracketed: boolean, typeExpression?: JSDocTypeExpression, isNameFirst?: boolean, comment?: string | NodeArray<JSDocComment>): JSDocParameterTag;
    updateJSDocParameterTag(node: JSDocParameterTag, tagName: Identifier | undefined, name: EntityName, isBracketed: boolean, typeExpression: JSDocTypeExpression | undefined, isNameFirst: boolean, comment: string | NodeArray<JSDocComment> | undefined): JSDocParameterTag;
    createJSDocPropertyTag(tagName: Identifier | undefined, name: EntityName, isBracketed: boolean, typeExpression?: JSDocTypeExpression, isNameFirst?: boolean, comment?: string | NodeArray<JSDocComment>): JSDocPropertyTag;
    updateJSDocPropertyTag(node: JSDocPropertyTag, tagName: Identifier | undefined, name: EntityName, isBracketed: boolean, typeExpression: JSDocTypeExpression | undefined, isNameFirst: boolean, comment: string | NodeArray<JSDocComment> | undefined): JSDocPropertyTag;
    createJSDocTypeTag(tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>): JSDocTypeTag;
    updateJSDocTypeTag(node: JSDocTypeTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment: string | NodeArray<JSDocComment> | undefined): JSDocTypeTag;
    createJSDocSeeTag(tagName: Identifier | undefined, nameExpression: JSDocNameReference | undefined, comment?: string | NodeArray<JSDocComment>): JSDocSeeTag;
    updateJSDocSeeTag(node: JSDocSeeTag, tagName: Identifier | undefined, nameExpression: JSDocNameReference | undefined, comment?: string | NodeArray<JSDocComment>): JSDocSeeTag;
    createJSDocReturnTag(tagName: Identifier | undefined, typeExpression?: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>): JSDocReturnTag;
    updateJSDocReturnTag(node: JSDocReturnTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocReturnTag;
    createJSDocThisTag(tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>): JSDocThisTag;
    updateJSDocThisTag(node: JSDocThisTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocThisTag;
    createJSDocEnumTag(tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>): JSDocEnumTag;
    updateJSDocEnumTag(node: JSDocEnumTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment: string | NodeArray<JSDocComment> | undefined): JSDocEnumTag;
    createJSDocCallbackTag(tagName: Identifier | undefined, typeExpression: JSDocSignature, fullName?: Identifier | JSDocNamespaceDeclaration, comment?: string | NodeArray<JSDocComment>): JSDocCallbackTag;
    updateJSDocCallbackTag(node: JSDocCallbackTag, tagName: Identifier | undefined, typeExpression: JSDocSignature, fullName: Identifier | JSDocNamespaceDeclaration | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocCallbackTag;
    createJSDocOverloadTag(tagName: Identifier | undefined, typeExpression: JSDocSignature, comment?: string | NodeArray<JSDocComment>): JSDocOverloadTag;
    updateJSDocOverloadTag(node: JSDocOverloadTag, tagName: Identifier | undefined, typeExpression: JSDocSignature, comment: string | NodeArray<JSDocComment> | undefined): JSDocOverloadTag;
    createJSDocAugmentsTag(tagName: Identifier | undefined, className: JSDocAugmentsTag["class"], comment?: string | NodeArray<JSDocComment>): JSDocAugmentsTag;
    updateJSDocAugmentsTag(node: JSDocAugmentsTag, tagName: Identifier | undefined, className: JSDocAugmentsTag["class"], comment: string | NodeArray<JSDocComment> | undefined): JSDocAugmentsTag;
    createJSDocImplementsTag(tagName: Identifier | undefined, className: JSDocImplementsTag["class"], comment?: string | NodeArray<JSDocComment>): JSDocImplementsTag;
    updateJSDocImplementsTag(node: JSDocImplementsTag, tagName: Identifier | undefined, className: JSDocImplementsTag["class"], comment: string | NodeArray<JSDocComment> | undefined): JSDocImplementsTag;
    createJSDocAuthorTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocAuthorTag;
    updateJSDocAuthorTag(node: JSDocAuthorTag, tagName: Identifier | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocAuthorTag;
    createJSDocClassTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocClassTag;
    updateJSDocClassTag(node: JSDocClassTag, tagName: Identifier | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocClassTag;
    createJSDocPublicTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocPublicTag;
    updateJSDocPublicTag(node: JSDocPublicTag, tagName: Identifier | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocPublicTag;
    createJSDocPrivateTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocPrivateTag;
    updateJSDocPrivateTag(node: JSDocPrivateTag, tagName: Identifier | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocPrivateTag;
    createJSDocProtectedTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocProtectedTag;
    updateJSDocProtectedTag(node: JSDocProtectedTag, tagName: Identifier | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocProtectedTag;
    createJSDocReadonlyTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocReadonlyTag;
    updateJSDocReadonlyTag(node: JSDocReadonlyTag, tagName: Identifier | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocReadonlyTag;
    createJSDocUnknownTag(tagName: Identifier, comment?: string | NodeArray<JSDocComment>): JSDocUnknownTag;
    updateJSDocUnknownTag(node: JSDocUnknownTag, tagName: Identifier, comment: string | NodeArray<JSDocComment> | undefined): JSDocUnknownTag;
    createJSDocDeprecatedTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocDeprecatedTag;
    updateJSDocDeprecatedTag(node: JSDocDeprecatedTag, tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocDeprecatedTag;
    createJSDocOverrideTag(tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocOverrideTag;
    updateJSDocOverrideTag(node: JSDocOverrideTag, tagName: Identifier | undefined, comment?: string | NodeArray<JSDocComment>): JSDocOverrideTag;
    createJSDocThrowsTag(tagName: Identifier, typeExpression: JSDocTypeExpression | undefined, comment?: string | NodeArray<JSDocComment>): JSDocThrowsTag;
    updateJSDocThrowsTag(node: JSDocThrowsTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression | undefined, comment?: string | NodeArray<JSDocComment> | undefined): JSDocThrowsTag;
    createJSDocSatisfiesTag(tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment?: string | NodeArray<JSDocComment>): JSDocSatisfiesTag;
    updateJSDocSatisfiesTag(node: JSDocSatisfiesTag, tagName: Identifier | undefined, typeExpression: JSDocTypeExpression, comment: string | NodeArray<JSDocComment> | undefined): JSDocSatisfiesTag;
    createJSDocImportTag(tagName: Identifier | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes?: ImportAttributes, comment?: string | NodeArray<JSDocComment>): JSDocImportTag;
    updateJSDocImportTag(node: JSDocImportTag, tagName: Identifier | undefined, importClause: ImportClause | undefined, moduleSpecifier: Expression, attributes: ImportAttributes | undefined, comment: string | NodeArray<JSDocComment> | undefined): JSDocImportTag;
    createJSDocText(text: string): JSDocText;
    updateJSDocText(node: JSDocText, text: string): JSDocText;
    createJSDocComment(comment?: string | NodeArray<JSDocComment> | undefined, tags?: readonly JSDocTag[] | undefined): JSDoc;
    updateJSDocComment(node: JSDoc, comment: string | NodeArray<JSDocComment> | undefined, tags: readonly JSDocTag[] | undefined): JSDoc;
    //
    // JSX
    //
    createJsxElement(openingElement: JsxOpeningElement, children: readonly JsxChild[], closingElement: JsxClosingElement): JsxElement;
    updateJsxElement(node: JsxElement, openingElement: JsxOpeningElement, children: readonly JsxChild[], closingElement: JsxClosingElement): JsxElement;
    createJsxSelfClosingElement(tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes): JsxSelfClosingElement;
    updateJsxSelfClosingElement(node: JsxSelfClosingElement, tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes): JsxSelfClosingElement;
    createJsxOpeningElement(tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes): JsxOpeningElement;
    updateJsxOpeningElement(node: JsxOpeningElement, tagName: JsxTagNameExpression, typeArguments: readonly TypeNode[] | undefined, attributes: JsxAttributes): JsxOpeningElement;
    createJsxClosingElement(tagName: JsxTagNameExpression): JsxClosingElement;
    updateJsxClosingElement(node: JsxClosingElement, tagName: JsxTagNameExpression): JsxClosingElement;
    createJsxFragment(openingFragment: JsxOpeningFragment, children: readonly JsxChild[], closingFragment: JsxClosingFragment): JsxFragment;
    createJsxText(text: string, containsOnlyTriviaWhiteSpaces?: boolean): JsxText;
    updateJsxText(node: JsxText, text: string, containsOnlyTriviaWhiteSpaces?: boolean): JsxText;
    createJsxOpeningFragment(): JsxOpeningFragment;
    createJsxJsxClosingFragment(): JsxClosingFragment;
    updateJsxFragment(node: JsxFragment, openingFragment: JsxOpeningFragment, children: readonly JsxChild[], closingFragment: JsxClosingFragment): JsxFragment;
    createJsxAttribute(name: JsxAttributeName, initializer: JsxAttributeValue | undefined): JsxAttribute;
    updateJsxAttribute(node: JsxAttribute, name: JsxAttributeName, initializer: JsxAttributeValue | undefined): JsxAttribute;
    createJsxAttributes(properties: readonly JsxAttributeLike[]): JsxAttributes;
    updateJsxAttributes(node: JsxAttributes, properties: readonly JsxAttributeLike[]): JsxAttributes;
    createJsxSpreadAttribute(expression: Expression): JsxSpreadAttribute;
    updateJsxSpreadAttribute(node: JsxSpreadAttribute, expression: Expression): JsxSpreadAttribute;
    createJsxExpression(dotDotDotToken: DotDotDotToken | undefined, expression: Expression | undefined): JsxExpression;
    updateJsxExpression(node: JsxExpression, expression: Expression | undefined): JsxExpression;
    createJsxNamespacedName(namespace: Identifier, name: Identifier): JsxNamespacedName;
    updateJsxNamespacedName(node: JsxNamespacedName, namespace: Identifier, name: Identifier): JsxNamespacedName;
    //
    // Clauses
    //
    createCaseClause(expression: Expression, statements: readonly Statement[]): CaseClause;
    updateCaseClause(node: CaseClause, expression: Expression, statements: readonly Statement[]): CaseClause;
    createDefaultClause(statements: readonly Statement[]): DefaultClause;
    updateDefaultClause(node: DefaultClause, statements: readonly Statement[]): DefaultClause;
    createHeritageClause(token: HeritageClause["token"], types: readonly ExpressionWithTypeArguments[]): HeritageClause;
    updateHeritageClause(node: HeritageClause, types: readonly ExpressionWithTypeArguments[]): HeritageClause;
    createCatchClause(variableDeclaration: string | BindingName | VariableDeclaration | undefined, block: Block): CatchClause;
    updateCatchClause(node: CatchClause, variableDeclaration: VariableDeclaration | undefined, block: Block): CatchClause;
    //
    // Property assignments
    //
    createPropertyAssignment(name: string | PropertyName, initializer: Expression): PropertyAssignment;
    updatePropertyAssignment(node: PropertyAssignment, name: PropertyName, initializer: Expression): PropertyAssignment;
    createShorthandPropertyAssignment(name: string | Identifier, objectAssignmentInitializer?: Expression): ShorthandPropertyAssignment;
    updateShorthandPropertyAssignment(node: ShorthandPropertyAssignment, name: Identifier, objectAssignmentInitializer: Expression | undefined): ShorthandPropertyAssignment;
    createSpreadAssignment(expression: Expression): SpreadAssignment;
    updateSpreadAssignment(node: SpreadAssignment, expression: Expression): SpreadAssignment;
    //
    // Enum
    //
    createEnumMember(name: string | PropertyName, initializer?: Expression): EnumMember;
    updateEnumMember(node: EnumMember, name: PropertyName, initializer: Expression | undefined): EnumMember;
    //
    // Top-level nodes
    //
    createSourceFile(statements: readonly Statement[], endOfFileToken: EndOfFileToken, flags: NodeFlags): SourceFile;
    updateSourceFile(node: SourceFile, statements: readonly Statement[], isDeclarationFile?: boolean, referencedFiles?: readonly FileReference[], typeReferences?: readonly FileReference[], hasNoDefaultLib?: boolean, libReferences?: readonly FileReference[]): SourceFile;
    /** @internal */ createRedirectedSourceFile(redirectInfo: RedirectInfo): SourceFile;
    //
    // Synthetic Nodes
    //
    /** @internal */ createSyntheticExpression(type: Type, isSpread?: boolean, tupleNameSource?: ParameterDeclaration | NamedTupleMember): SyntheticExpression;
    /** @internal */ createSyntaxList(children: readonly Node[]): SyntaxList;
    //
    // Transformation nodes
    //
    createNotEmittedStatement(original: Node): NotEmittedStatement;
    createNotEmittedTypeElement(): NotEmittedTypeElement;
    createPartiallyEmittedExpression(expression: Expression, original?: Node): PartiallyEmittedExpression;
    updatePartiallyEmittedExpression(node: PartiallyEmittedExpression, expression: Expression): PartiallyEmittedExpression;
    /** @internal */ createSyntheticReferenceExpression(expression: Expression, thisArg: Expression): SyntheticReferenceExpression;
    /** @internal */ updateSyntheticReferenceExpression(node: SyntheticReferenceExpression, expression: Expression, thisArg: Expression): SyntheticReferenceExpression;
    createCommaListExpression(elements: readonly Expression[]): CommaListExpression;
    updateCommaListExpression(node: CommaListExpression, elements: readonly Expression[]): CommaListExpression;
    createBundle(sourceFiles: readonly SourceFile[]): Bundle;
    updateBundle(node: Bundle, sourceFiles: readonly SourceFile[]): Bundle;
    //
    // Common operators
    //
    createComma(left: Expression, right: Expression): BinaryExpression;
    createAssignment(left: ObjectLiteralExpression | ArrayLiteralExpression, right: Expression): DestructuringAssignment;
    createAssignment(left: Expression, right: Expression): AssignmentExpression<EqualsToken>;
    createLogicalOr(left: Expression, right: Expression): BinaryExpression;
    createLogicalAnd(left: Expression, right: Expression): BinaryExpression;
    createBitwiseOr(left: Expression, right: Expression): BinaryExpression;
    createBitwiseXor(left: Expression, right: Expression): BinaryExpression;
    createBitwiseAnd(left: Expression, right: Expression): BinaryExpression;
    createStrictEquality(left: Expression, right: Expression): BinaryExpression;
    createStrictInequality(left: Expression, right: Expression): BinaryExpression;
    createEquality(left: Expression, right: Expression): BinaryExpression;
    createInequality(left: Expression, right: Expression): BinaryExpression;
    createLessThan(left: Expression, right: Expression): BinaryExpression;
    createLessThanEquals(left: Expression, right: Expression): BinaryExpression;
    createGreaterThan(left: Expression, right: Expression): BinaryExpression;
    createGreaterThanEquals(left: Expression, right: Expression): BinaryExpression;
    createLeftShift(left: Expression, right: Expression): BinaryExpression;
    createRightShift(left: Expression, right: Expression): BinaryExpression;
    createUnsignedRightShift(left: Expression, right: Expression): BinaryExpression;
    createAdd(left: Expression, right: Expression): BinaryExpression;
    createSubtract(left: Expression, right: Expression): BinaryExpression;
    createMultiply(left: Expression, right: Expression): BinaryExpression;
    createDivide(left: Expression, right: Expression): BinaryExpression;
    createModulo(left: Expression, right: Expression): BinaryExpression;
    createExponent(left: Expression, right: Expression): BinaryExpression;
    createPrefixPlus(operand: Expression): PrefixUnaryExpression;
    createPrefixMinus(operand: Expression): PrefixUnaryExpression;
    createPrefixIncrement(operand: Expression): PrefixUnaryExpression;
    createPrefixDecrement(operand: Expression): PrefixUnaryExpression;
    createBitwiseNot(operand: Expression): PrefixUnaryExpression;
    createLogicalNot(operand: Expression): PrefixUnaryExpression;
    createPostfixIncrement(operand: Expression): PostfixUnaryExpression;
    createPostfixDecrement(operand: Expression): PostfixUnaryExpression;
    //
    // Compound Nodes
    //
    createImmediatelyInvokedFunctionExpression(statements: readonly Statement[]): CallExpression;
    createImmediatelyInvokedFunctionExpression(statements: readonly Statement[], param: ParameterDeclaration, paramValue: Expression): CallExpression;
    createImmediatelyInvokedArrowFunction(statements: readonly Statement[]): ImmediatelyInvokedArrowFunction;
    createImmediatelyInvokedArrowFunction(statements: readonly Statement[], param: ParameterDeclaration, paramValue: Expression): ImmediatelyInvokedArrowFunction;
    createVoidZero(): VoidExpression;
    createExportDefault(expression: Expression): ExportAssignment;
    createExternalModuleExport(exportName: Identifier): ExportDeclaration;
    /** @internal */ createTypeCheck(value: Expression, tag: TypeOfTag): Expression;
    /** @internal */ createIsNotTypeCheck(value: Expression, tag: TypeOfTag): Expression;
    /** @internal */ createMethodCall(object: Expression, methodName: string | Identifier, argumentsList: readonly Expression[]): CallExpression;
    /** @internal */ createGlobalMethodCall(globalObjectName: string, globalMethodName: string, argumentsList: readonly Expression[]): CallExpression;
    /** @internal */ createFunctionBindCall(target: Expression, thisArg: Expression, argumentsList: readonly Expression[]): CallExpression;
    /** @internal */ createFunctionCallCall(target: Expression, thisArg: Expression, argumentsList: readonly Expression[]): CallExpression;
    /** @internal */ createFunctionApplyCall(target: Expression, thisArg: Expression, argumentsExpression: Expression): CallExpression;
    /** @internal */ createObjectDefinePropertyCall(target: Expression, propertyName: string | Expression, attributes: Expression): CallExpression;
    /** @internal */ createObjectGetOwnPropertyDescriptorCall(target: Expression, propertyName: string | Expression): CallExpression;
    /** @internal */ createReflectGetCall(target: Expression, propertyKey: Expression, receiver?: Expression): CallExpression;
    /** @internal */ createReflectSetCall(target: Expression, propertyKey: Expression, value: Expression, receiver?: Expression): CallExpression;
    /** @internal */ createPropertyDescriptor(attributes: PropertyDescriptorAttributes, singleLine?: boolean): ObjectLiteralExpression;
    /** @internal */ createArraySliceCall(array: Expression, start?: number | Expression): CallExpression;
    /** @internal */ createArrayConcatCall(array: Expression, values: readonly Expression[]): CallExpression;
    /** @internal */ createCallBinding(expression: Expression, recordTempVariable: (temp: Identifier) => void, languageVersion?: ScriptTarget, cacheIdentifiers?: boolean): CallBinding;
    /**
     * Wraps an expression that cannot be an assignment target in an expression that can be.
     *
     * Given a `paramName` of `_a`:
     * ```
     * Reflect.set(obj, "x", _a)
     * ```
     * Becomes
     * ```ts
     * ({ set value(_a) { Reflect.set(obj, "x", _a); } }).value
     * ```
     *
     * @param paramName
     * @param expression
     *
     * @internal
     */
    createAssignmentTargetWrapper(paramName: Identifier, expression: Expression): PropertyAccessExpression;
    /** @internal */ inlineExpressions(expressions: readonly Expression[]): Expression | undefined;
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
     *
     * @internal
     */
    getInternalName(node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean): Identifier;
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
     *
     * @internal
     */
    getLocalName(node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean, ignoreAssignedName?: boolean): Identifier;
    /**
     * Gets the export name of a declaration. This is primarily used for declarations that can be
     * referred to by name in the declaration's immediate scope (classes, enums, namespaces). An
     * export name will *always* be prefixed with a module or namespace export modifier like
     * `"exports."` when emitted as an expression if the name points to an exported symbol.
     *
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     *
     * @internal
     */
    getExportName(node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean): Identifier;
    /**
     * Gets the name of a declaration for use in declarations.
     *
     * @param node The declaration.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     *
     * @internal
     */
    getDeclarationName(node: Declaration | undefined, allowComments?: boolean, allowSourceMaps?: boolean): Identifier;
    /**
     * Gets a namespace-qualified name for use in expressions.
     *
     * @param ns The namespace identifier.
     * @param name The name.
     * @param allowComments A value indicating whether comments may be emitted for the name.
     * @param allowSourceMaps A value indicating whether source maps may be emitted for the name.
     *
     * @internal
     */
    getNamespaceMemberName(ns: Identifier, name: Identifier, allowComments?: boolean, allowSourceMaps?: boolean): PropertyAccessExpression;
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
     *
     * @internal
     */
    getExternalModuleOrNamespaceExportName(ns: Identifier | undefined, node: Declaration, allowComments?: boolean, allowSourceMaps?: boolean): Identifier | PropertyAccessExpression;
    //
    // Utilities
    //
    restoreOuterExpressions(outerExpression: Expression | undefined, innerExpression: Expression, kinds?: OuterExpressionKinds): Expression;
    /** @internal */ restoreEnclosingLabel(node: Statement, outermostLabeledStatement: LabeledStatement | undefined, afterRestoreLabelCallback?: (node: LabeledStatement) => void): Statement;
    /** @internal */ createUseStrictPrologue(): PrologueDirective;
    /**
     * Copies any necessary standard and custom prologue-directives into target array.
     * @param source origin statements array
     * @param target result statements array
     * @param ensureUseStrict boolean determining whether the function need to add prologue-directives
     * @param visitor Optional callback used to visit any custom prologue directives.
     *
     * @internal
     */
    copyPrologue(source: readonly Statement[], target: Statement[], ensureUseStrict?: boolean, visitor?: (node: Node) => VisitResult<Node | undefined>): number;
    /**
     * Copies only the standard (string-expression) prologue-directives into the target statement-array.
     * @param source origin statements array
     * @param target result statements array
     * @param statementOffset The offset at which to begin the copy.
     * @param ensureUseStrict boolean determining whether the function need to add prologue-directives
     *
     * @internal
     */
    copyStandardPrologue(source: readonly Statement[], target: Statement[], statementOffset: number | undefined, ensureUseStrict?: boolean): number;
    /**
     * Copies only the custom prologue-directives into target statement-array.
     * @param source origin statements array
     * @param target result statements array
     * @param statementOffset The offset at which to begin the copy.
     * @param visitor Optional callback used to visit any custom prologue directives.
     *
     * @internal
     */
    copyCustomPrologue(source: readonly Statement[], target: Statement[], statementOffset: number, visitor?: (node: Node) => VisitResult<Node | undefined>, filter?: (node: Statement) => boolean): number;
    /** @internal */ copyCustomPrologue(source: readonly Statement[], target: Statement[], statementOffset: number | undefined, visitor?: (node: Node) => VisitResult<Node | undefined>, filter?: (node: Statement) => boolean): number | undefined;
    /** @internal */ ensureUseStrict(statements: NodeArray<Statement>): NodeArray<Statement>;
    /** @internal */ liftToBlock(nodes: readonly Node[]): Statement;
    /**
     * Merges generated lexical declarations into a new statement list.
     *
     * @internal
     */
    mergeLexicalEnvironment(statements: NodeArray<Statement>, declarations: readonly Statement[] | undefined): NodeArray<Statement>;
    /**
     * Appends generated lexical declarations to an array of statements.
     *
     * @internal
     */
    mergeLexicalEnvironment(statements: Statement[], declarations: readonly Statement[] | undefined): Statement[];
    /**
     * Creates a shallow, memberwise clone of a node.
     * - The result will have its `original` pointer set to `node`.
     * - The result will have its `pos` and `end` set to `-1`.
     * - *DO NOT USE THIS* if a more appropriate function is available.
     *
     * @internal
     */
    cloneNode<T extends Node | undefined>(node: T): T;
    /**
     * Updates a node that may contain modifiers, replacing only the modifiers of the node.
     */
    replaceModifiers<T extends HasModifiers>(node: T, modifiers: readonly Modifier[] | ModifierFlags | undefined): T;
    /**
     * Updates a node that may contain decorators or modifiers, replacing only the decorators and modifiers of the node.
     */
    replaceDecoratorsAndModifiers<T extends HasModifiers & HasDecorators>(node: T, modifiers: readonly ModifierLike[] | undefined): T;
    /**
     * Updates a node that contains a property name, replacing only the name of the node.
     */
    replacePropertyName<T extends AccessorDeclaration | MethodDeclaration | MethodSignature | PropertyDeclaration | PropertySignature | PropertyAssignment>(node: T, name: T["name"]): T;
}
/** @internal */
export type LexicalEnvironmentFlags = number;
/** @internal */
export const LexicalEnvironmentFlags: {
    readonly None: 0;
    readonly InParameters: 1;
    readonly VariablesHoistedInParameters: 2;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    InParameters: 1,
    "1": "InParameters",
    VariablesHoistedInParameters: 2,
    "2": "VariablesHoistedInParameters"
};
export interface CoreTransformationContext {
    factory: NodeFactory;
    /** Gets the compiler options supplied to the transformer. */
    getCompilerOptions(): CompilerOptions;
    /** Starts a new lexical environment. */
    startLexicalEnvironment(): void;
    /** @internal */ setLexicalEnvironmentFlags(flags: LexicalEnvironmentFlags, value: boolean): void;
    /** @internal */ getLexicalEnvironmentFlags(): LexicalEnvironmentFlags;
    /** Suspends the current lexical environment, usually after visiting a parameter list. */
    suspendLexicalEnvironment(): void;
    /** Resumes a suspended lexical environment, usually before visiting a function body. */
    resumeLexicalEnvironment(): void;
    /** Ends a lexical environment, returning any declarations. */
    endLexicalEnvironment(): Statement[] | undefined;
    /** Hoists a function declaration to the containing scope. */
    hoistFunctionDeclaration(node: FunctionDeclaration): void;
    /** Hoists a variable declaration to the containing scope. */
    hoistVariableDeclaration(node: Identifier): void;
    /** @internal */ startBlockScope(): void;
    /** @internal */ endBlockScope(): Statement[] | undefined;
    /** @internal */ addBlockScopedVariable(node: Identifier): void;
    /**
     * Adds an initialization statement to the top of the lexical environment.
     *
     * @internal
     */
    addInitializationStatement(node: Statement): void;
}
export interface TransformationContext extends CoreTransformationContext {
    /** @internal */ getEmitResolver(): EmitResolver;
    /** @internal */ getEmitHost(): EmitHost;
    /** @internal */ getEmitHelperFactory(): EmitHelperFactory;
    /** Records a request for a non-scoped emit helper in the current context. */
    requestEmitHelper(helper: EmitHelper): void;
    /** Gets and resets the requested non-scoped emit helpers. */
    readEmitHelpers(): EmitHelper[] | undefined;
    /** Enables expression substitutions in the pretty printer for the provided SyntaxKind. */
    enableSubstitution(kind: SyntaxKind): void;
    /** Determines whether expression substitutions are enabled for the provided node. */
    isSubstitutionEnabled(node: Node): boolean;
    /**
     * Hook used by transformers to substitute expressions just before they
     * are emitted by the pretty printer.
     *
     * NOTE: Transformation hooks should only be modified during `Transformer` initialization,
     * before returning the `NodeTransformer` callback.
     */
    onSubstituteNode: (hint: EmitHint, node: Node) => Node;
    /**
     * Enables before/after emit notifications in the pretty printer for the provided
     * SyntaxKind.
     */
    enableEmitNotification(kind: SyntaxKind): void;
    /**
     * Determines whether before/after emit notifications should be raised in the pretty
     * printer when it emits a node.
     */
    isEmitNotificationEnabled(node: Node): boolean;
    /**
     * Hook used to allow transformers to capture state before or after
     * the printer emits a node.
     *
     * NOTE: Transformation hooks should only be modified during `Transformer` initialization,
     * before returning the `NodeTransformer` callback.
     */
    onEmitNode: (hint: EmitHint, node: Node, emitCallback: (hint: EmitHint, node: Node) => void) => void;
    /** @internal */ addDiagnostic(diag: DiagnosticWithLocation): void;
}
export interface TransformationResult<T extends Node> {
    /** Gets the transformed source files. */
    transformed: T[];
    /** Gets diagnostics for the transformation. */
    diagnostics?: DiagnosticWithLocation[];
    /**
     * Gets a substitute for a node, if one is available; otherwise, returns the original node.
     *
     * @param hint A hint as to the intended usage of the node.
     * @param node The node to substitute.
     */
    substituteNode(hint: EmitHint, node: Node): Node;
    /**
     * Emits a node with possible notification.
     *
     * @param hint A hint as to the intended usage of the node.
     * @param node The node to emit.
     * @param emitCallback A callback used to emit the node.
     */
    emitNodeWithNotification(hint: EmitHint, node: Node, emitCallback: (hint: EmitHint, node: Node) => void): void;
    /**
     * Indicates if a given node needs an emit notification
     *
     * @param node The node to emit.
     */
    isEmitNotificationEnabled?(node: Node): boolean;
    /**
     * Clean up EmitNode entries on any parse-tree nodes.
     */
    dispose(): void;
}
/**
 * A function that is used to initialize and return a `Transformer` callback, which in turn
 * will be used to transform one or more nodes.
 */
export type TransformerFactory<T extends Node> = (context: TransformationContext) => Transformer<T>;
/**
 * A function that transforms a node.
 */
export type Transformer<T extends Node> = (node: T) => T;
/**
 * A function that accepts and possibly transforms a node.
 */
export type Visitor<TIn extends Node = Node, TOut extends Node | undefined = TIn | undefined> = (node: TIn) => VisitResult<TOut>;
/**
 * A function that walks a node using the given visitor, lifting node arrays into single nodes,
 * returning an node which satisfies the test.
 *
 * - If the input node is undefined, then the output is undefined.
 * - If the visitor returns undefined, then the output is undefined.
 * - If the output node is not undefined, then it will satisfy the test function.
 * - In order to obtain a return type that is more specific than `Node`, a test
 *   function _must_ be provided, and that function must be a type predicate.
 *
 * For the canonical implementation of this type, @see {visitNode}.
 */
export interface NodeVisitor {
    <TIn extends Node | undefined, TVisited extends Node | undefined, TOut extends Node>(node: TIn, visitor: Visitor<NonNullable<TIn>, TVisited>, test: (node: Node) => node is TOut, lift?: (node: readonly Node[]) => Node): TOut | (TIn & undefined) | (TVisited & undefined);
    <TIn extends Node | undefined, TVisited extends Node | undefined>(node: TIn, visitor: Visitor<NonNullable<TIn>, TVisited>, test?: (node: Node) => boolean, lift?: (node: readonly Node[]) => Node): Node | (TIn & undefined) | (TVisited & undefined);
}
/**
 * A function that walks a node array using the given visitor, returning an array whose contents satisfy the test.
 *
 * - If the input node array is undefined, the output is undefined.
 * - If the visitor can return undefined, the node it visits in the array will be reused.
 * - If the output node array is not undefined, then its contents will satisfy the test.
 * - In order to obtain a return type that is more specific than `NodeArray<Node>`, a test
 *   function _must_ be provided, and that function must be a type predicate.
 *
 * For the canonical implementation of this type, @see {visitNodes}.
 */
export interface NodesVisitor {
    <TIn extends Node, TInArray extends NodeArray<TIn> | undefined, TOut extends Node>(nodes: TInArray, visitor: Visitor<TIn, Node | undefined>, test: (node: Node) => node is TOut, start?: number, count?: number): NodeArray<TOut> | (TInArray & undefined);
    <TIn extends Node, TInArray extends NodeArray<TIn> | undefined>(nodes: TInArray, visitor: Visitor<TIn, Node | undefined>, test?: (node: Node) => boolean, start?: number, count?: number): NodeArray<Node> | (TInArray & undefined);
}
export type VisitResult<T extends Node | undefined> = T | readonly Node[];
export interface Printer {
    /**
     * Print a node and its subtree as-is, without any emit transformations.
     * @param hint A value indicating the purpose of a node. This is primarily used to
     * distinguish between an `Identifier` used in an expression position, versus an
     * `Identifier` used as an `IdentifierName` as part of a declaration. For most nodes you
     * should just pass `Unspecified`.
     * @param node The node to print. The node and its subtree are printed as-is, without any
     * emit transformations.
     * @param sourceFile A source file that provides context for the node. The source text of
     * the file is used to emit the original source content for literals and identifiers, while
     * the identifiers of the source file are used when generating unique names to avoid
     * collisions.
     */
    printNode(hint: EmitHint, node: Node, sourceFile: SourceFile): string;
    /**
     * Prints a list of nodes using the given format flags
     */
    printList<T extends Node>(format: ListFormat, list: NodeArray<T>, sourceFile: SourceFile): string;
    /**
     * Prints a source file as-is, without any emit transformations.
     */
    printFile(sourceFile: SourceFile): string;
    /**
     * Prints a bundle of source files as-is, without any emit transformations.
     */
    printBundle(bundle: Bundle): string;
    /** @internal */ writeNode(hint: EmitHint, node: Node, sourceFile: SourceFile | undefined, writer: EmitTextWriter): void;
    /** @internal */ writeList<T extends Node>(format: ListFormat, list: NodeArray<T> | undefined, sourceFile: SourceFile | undefined, writer: EmitTextWriter): void;
    /** @internal */ writeFile(sourceFile: SourceFile, writer: EmitTextWriter, sourceMapGenerator: SourceMapGenerator | undefined): void;
    /** @internal */ writeBundle(bundle: Bundle, writer: EmitTextWriter, sourceMapGenerator: SourceMapGenerator | undefined): void;
}
/** @internal */
export interface BuildInfo {
    version: string;
}
/** @internal */
export interface BuildInfoFileVersionMap {
    fileInfos: Map<Path, string>;
    roots: Map<Path, Path | undefined>;
}
export interface PrintHandlers {
    /**
     * A hook used by the Printer when generating unique names to avoid collisions with
     * globally defined names that exist outside of the current source file.
     */
    hasGlobalName?(name: string): boolean;
    /**
     * A hook used by the Printer to provide notifications prior to emitting a node. A
     * compatible implementation **must** invoke `emitCallback` with the provided `hint` and
     * `node` values.
     * @param hint A hint indicating the intended purpose of the node.
     * @param node The node to emit.
     * @param emitCallback A callback that, when invoked, will emit the node.
     * @example
     * ```ts
     * var printer = createPrinter(printerOptions, {
     *   onEmitNode(hint, node, emitCallback) {
     *     // set up or track state prior to emitting the node...
     *     emitCallback(hint, node);
     *     // restore state after emitting the node...
     *   }
     * });
     * ```
     */
    onEmitNode?(hint: EmitHint, node: Node, emitCallback: (hint: EmitHint, node: Node) => void): void;
    /**
     * A hook used to check if an emit notification is required for a node.
     * @param node The node to emit.
     */
    isEmitNotificationEnabled?(node: Node): boolean;
    /**
     * A hook used by the Printer to perform just-in-time substitution of a node. This is
     * primarily used by node transformations that need to substitute one node for another,
     * such as replacing `myExportedVar` with `exports.myExportedVar`.
     * @param hint A hint indicating the intended purpose of the node.
     * @param node The node to emit.
     * @example
     * ```ts
     * var printer = createPrinter(printerOptions, {
     *   substituteNode(hint, node) {
     *     // perform substitution if necessary...
     *     return node;
     *   }
     * });
     * ```
     */
    substituteNode?(hint: EmitHint, node: Node): Node;
    /** @internal */ onEmitSourceMapOfNode?: (hint: EmitHint, node: Node, emitCallback: (hint: EmitHint, node: Node) => void) => void;
    /** @internal */ onEmitSourceMapOfToken?: (node: Node | undefined, token: SyntaxKind, writer: (s: string) => void, pos: number, emitCallback: (token: SyntaxKind, writer: (s: string) => void, pos: number) => number) => number;
    /** @internal */ onEmitSourceMapOfPosition?: (pos: number) => void;
    /** @internal */ onSetSourceFile?: (node: SourceFile) => void;
    /** @internal */ onBeforeEmitNode?: (node: Node | undefined) => void;
    /** @internal */ onAfterEmitNode?: (node: Node | undefined) => void;
    /** @internal */ onBeforeEmitNodeArray?: (nodes: NodeArray<Node> | undefined) => void;
    /** @internal */ onAfterEmitNodeArray?: (nodes: NodeArray<Node> | undefined) => void;
    /** @internal */ onBeforeEmitToken?: (node: Node) => void;
    /** @internal */ onAfterEmitToken?: (node: Node) => void;
}
export interface PrinterOptions {
    removeComments?: boolean;
    newLine?: NewLineKind;
    omitTrailingSemicolon?: boolean;
    noEmitHelpers?: boolean;
    /** @internal */ module?: CompilerOptions["module"];
    /** @internal */ moduleResolution?: CompilerOptions["moduleResolution"];
    /** @internal */ target?: CompilerOptions["target"];
    /** @internal */ sourceMap?: boolean;
    /** @internal */ inlineSourceMap?: boolean;
    /** @internal */ inlineSources?: boolean;
    /** @internal*/ omitBraceSourceMapPositions?: boolean;
    /** @internal */ extendedDiagnostics?: boolean;
    /** @internal */ onlyPrintJsDocStyle?: boolean;
    /** @internal */ neverAsciiEscape?: boolean;
    /** @internal */ stripInternal?: boolean;
    /** @internal */ preserveSourceNewlines?: boolean;
    /** @internal */ terminateUnterminatedLiterals?: boolean;
}
/** @internal */
export interface RawSourceMap {
    version: 3;
    file: string;
    sourceRoot?: string | null; // eslint-disable-line no-restricted-syntax
    sources: string[];
    sourcesContent?: (string | null)[] | null; // eslint-disable-line no-restricted-syntax
    mappings: string;
    names?: string[] | null; // eslint-disable-line no-restricted-syntax
}
/**
 * Generates a source map.
 *
 * @internal
 */
export interface SourceMapGenerator {
    getSources(): readonly string[];
    /**
     * Adds a source to the source map.
     */
    addSource(fileName: string): number;
    /**
     * Set the content for a source.
     */
    setSourceContent(sourceIndex: number, content: string | null): void; // eslint-disable-line no-restricted-syntax
    /**
     * Adds a name.
     */
    addName(name: string): number;
    /**
     * Adds a mapping without source information.
     */
    addMapping(generatedLine: number, generatedCharacter: number): void;
    /**
     * Adds a mapping with source information.
     */
    addMapping(generatedLine: number, generatedCharacter: number, sourceIndex: number, sourceLine: number, sourceCharacter: number, nameIndex?: number): void;
    /**
     * Appends a source map.
     */
    appendSourceMap(generatedLine: number, generatedCharacter: number, sourceMap: RawSourceMap, sourceMapPath: string, start?: LineAndCharacter, end?: LineAndCharacter): void;
    /**
     * Gets the source map as a `RawSourceMap` object.
     */
    toJSON(): RawSourceMap;
    /**
     * Gets the string representation of the source map.
     */
    toString(): string;
}
/** @internal */
export interface DocumentPositionMapperHost {
    getSourceFileLike(fileName: string): SourceFileLike | undefined;
    getCanonicalFileName(path: string): string;
    log(text: string): void;
}
/**
 * Maps positions between source and generated files.
 *
 * @internal
 */
export interface DocumentPositionMapper {
    getSourcePosition(input: DocumentPosition): DocumentPosition;
    getGeneratedPosition(input: DocumentPosition): DocumentPosition;
}
/** @internal */
export interface DocumentPosition {
    fileName: string;
    pos: number;
}
/** @internal */
export interface EmitTextWriter extends SymbolWriter {
    write(s: string): void;
    writeTrailingSemicolon(text: string): void;
    writeComment(text: string): void;
    getText(): string;
    rawWrite(s: string): void;
    writeLiteral(s: string): void;
    getTextPos(): number;
    getLine(): number;
    getColumn(): number;
    getIndent(): number;
    isAtStartOfLine(): boolean;
    hasTrailingComment(): boolean;
    hasTrailingWhitespace(): boolean;
    nonEscapingWrite?(text: string): void;
}
export interface GetEffectiveTypeRootsHost {
    getCurrentDirectory?(): string;
}
/** @internal */
export interface HasCurrentDirectory {
    getCurrentDirectory(): string;
}
/** @internal */
export interface ModuleSpecifierResolutionHost {
    useCaseSensitiveFileNames(): boolean;
    fileExists(path: string): boolean;
    getCurrentDirectory(): string;
    directoryExists?(path: string): boolean;
    readFile?(path: string): string | undefined;
    realpath?(path: string): string;
    getSymlinkCache?(): SymlinkCache;
    getModuleSpecifierCache?(): ModuleSpecifierCache;
    getPackageJsonInfoCache?(): PackageJsonInfoCache | undefined;
    getGlobalTypingsCacheLocation?(): string | undefined;
    getNearestAncestorDirectoryWithPackageJson?(fileName: string, rootDir?: string): string | undefined;
    redirectTargetsMap: RedirectTargetsMap;
    getRedirectFromSourceFile(fileName: string): ResolvedRefAndOutputDts | undefined;
    isSourceOfProjectReferenceRedirect(fileName: string): boolean;
    getFileIncludeReasons(): MultiMap<Path, FileIncludeReason>;
    getCommonSourceDirectory(): string;
    getDefaultResolutionModeForFile(sourceFile: SourceFile): ResolutionMode;
    getModeForResolutionAtIndex(file: SourceFile, index: number): ResolutionMode;
    getModuleResolutionCache?(): ModuleResolutionCache | undefined;
    trace?(s: string): void;
}
/** @internal */
export interface ModulePath {
    path: string;
    isInNodeModules: boolean;
    isRedirect: boolean;
}
/** @internal */
export interface ResolvedModuleSpecifierInfo {
    kind: "node_modules" | "paths" | "redirect" | "relative" | "ambient" | undefined;
    modulePaths: readonly ModulePath[] | undefined;
    packageName: string | undefined;
    moduleSpecifiers: readonly string[] | undefined;
    isBlockedByPackageJsonDependencies: boolean | undefined;
}
/** @internal */
export interface ModuleSpecifierOptions {
    overrideImportMode?: ResolutionMode;
}
/** @internal */
export interface ModuleSpecifierCache {
    get(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions): Readonly<ResolvedModuleSpecifierInfo> | undefined;
    set(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions, kind: ResolvedModuleSpecifierInfo["kind"], modulePaths: readonly ModulePath[], moduleSpecifiers: readonly string[]): void;
    setBlockedByPackageJsonDependencies(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions, packageName: string | undefined, isBlockedByPackageJsonDependencies: boolean): void;
    setModulePaths(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions, modulePaths: readonly ModulePath[]): void;
    clear(): void;
    count(): number;
}
// Note: this used to be deprecated in our public API, but is still used internally
/** @internal */
export interface SymbolTracker {
    // Called when the symbol writer encounters a symbol to write.  Currently only used by the
    // declaration emitter to help determine if it should patch up the final declaration file
    // with import statements it previously saw (but chose not to emit).
    trackSymbol?(symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: SymbolFlags | undefined): boolean;
    reportInaccessibleThisError?(): void;
    reportPrivateInBaseOfClassExpression?(propertyName: string): void;
    reportInaccessibleUniqueSymbolError?(): void;
    reportCyclicStructureError?(): void;
    reportLikelyUnsafeImportRequiredError?(specifier: string): void;
    reportTruncationError?(): void;
    moduleResolverHost?: ModuleSpecifierResolutionHost & {
        getCommonSourceDirectory(): string;
    };
    reportNonlocalAugmentation?(containingFile: SourceFile, parentSymbol: Symbol, augmentingSymbol: Symbol): void;
    reportNonSerializableProperty?(propertyName: string): void;
    reportInferenceFallback?(node: Node): void;
    pushErrorFallbackNode?(node: Declaration | undefined): void;
    popErrorFallbackNode?(): void;
}
export interface TextSpan {
    start: number;
    length: number;
}
export interface TextChangeRange {
    span: TextSpan;
    newLength: number;
}
/** @internal */
export interface ErrorOutputContainer {
    errors?: Diagnostic[];
    skipLogging?: boolean;
}
/** @internal */
export interface DiagnosticCollection {
    // Adds a diagnostic to this diagnostic collection.
    add(diagnostic: Diagnostic): void;
    // Returns the first existing diagnostic that is equivalent to the given one (sans related information)
    lookup(diagnostic: Diagnostic): Diagnostic | undefined;
    // Gets all the diagnostics that aren't associated with a file.
    getGlobalDiagnostics(): Diagnostic[];
    // If fileName is provided, gets all the diagnostics associated with that file name.
    // Otherwise, returns all the diagnostics (global and file associated) in this collection.
    getDiagnostics(): Diagnostic[];
    getDiagnostics(fileName: string): DiagnosticWithLocation[];
}
// SyntaxKind.SyntaxList
export interface SyntaxList extends Node {
    kind: typeof SyntaxKind.SyntaxList;
    // Unlike other nodes which may or may not have their child nodes calculated,
    // the entire purpose of a SyntaxList is to hold child nodes.
    // Instead of using the WeakMap machinery in `nodeChildren.ts`,
    // we just store the children directly on the SyntaxList.
    /** @internal */ _children: readonly Node[];
}
// dprint-ignore
export type ListFormat = number;
// dprint-ignore
export const ListFormat: {
    readonly None: 0;
    readonly SingleLine: 0;
    readonly MultiLine: 1;
    readonly PreserveLines: 2;
    readonly LinesMask: 3;
    readonly NotDelimited: 0;
    readonly BarDelimited: 4;
    readonly AmpersandDelimited: 8;
    readonly CommaDelimited: 16;
    readonly AsteriskDelimited: 32;
    readonly DelimitersMask: 60;
    readonly AllowTrailingComma: 64;
    readonly Indented: 128;
    readonly SpaceBetweenBraces: 256;
    readonly SpaceBetweenSiblings: 512;
    readonly Braces: 1024;
    readonly Parenthesis: 2048;
    readonly AngleBrackets: 4096;
    readonly SquareBrackets: 8192;
    readonly BracketsMask: 15360;
    readonly OptionalIfUndefined: 16384;
    readonly OptionalIfEmpty: 32768;
    readonly Optional: 49152;
    readonly PreferNewLine: 65536;
    readonly NoTrailingNewLine: 131072;
    readonly NoInterveningComments: 262144;
    readonly NoSpaceIfEmpty: 524288;
    readonly SingleElement: 1048576;
    readonly SpaceAfterList: 2097152;
    readonly Modifiers: 2359808;
    readonly HeritageClauses: 512;
    readonly SingleLineTypeLiteralMembers: 768;
    readonly MultiLineTypeLiteralMembers: 32897;
    readonly SingleLineTupleTypeElements: 528;
    readonly MultiLineTupleTypeElements: 657;
    readonly UnionTypeConstituents: 516;
    readonly IntersectionTypeConstituents: 520;
    readonly ObjectBindingPatternElements: 525136;
    readonly ArrayBindingPatternElements: 524880;
    readonly ObjectLiteralExpressionProperties: 526226;
    readonly ImportAttributes: 526226;
    readonly ImportClauseEntries: 526226;
    readonly ArrayLiteralExpressionElements: 8914;
    readonly CommaListElements: 528;
    readonly CallExpressionArguments: 2576;
    readonly NewExpressionArguments: 18960;
    readonly TemplateExpressionSpans: 262144;
    readonly SingleLineBlockStatements: 768;
    readonly MultiLineBlockStatements: 129;
    readonly VariableDeclarationList: 528;
    readonly SingleLineFunctionBodyStatements: 768;
    readonly MultiLineFunctionBodyStatements: 1;
    readonly ClassHeritageClauses: 0;
    readonly ClassMembers: 129;
    readonly InterfaceMembers: 129;
    readonly EnumMembers: 145;
    readonly CaseBlockClauses: 129;
    readonly NamedImportsOrExportsElements: 525136;
    readonly JsxElementOrFragmentChildren: 262144;
    readonly JsxElementAttributes: 262656;
    readonly CaseOrDefaultClauseStatements: 163969;
    readonly HeritageClauseTypes: 528;
    readonly SourceFileStatements: 131073;
    readonly Decorators: 2146305;
    readonly TypeArguments: 53776;
    readonly TypeParameters: 53776;
    readonly Parameters: 2576;
    readonly IndexSignatureParameters: 8848;
    readonly JSDocComment: 33;
    [index: number]: string;
} = {
    None: 0,
    "0": "ClassHeritageClauses",
    SingleLine: 0,
    MultiLine: 1,
    "1": "MultiLineFunctionBodyStatements",
    PreserveLines: 2,
    "2": "PreserveLines",
    LinesMask: 3,
    "3": "LinesMask",
    NotDelimited: 0,
    BarDelimited: 4,
    "4": "BarDelimited",
    AmpersandDelimited: 8,
    "8": "AmpersandDelimited",
    CommaDelimited: 16,
    "16": "CommaDelimited",
    AsteriskDelimited: 32,
    "32": "AsteriskDelimited",
    DelimitersMask: 60,
    "60": "DelimitersMask",
    AllowTrailingComma: 64,
    "64": "AllowTrailingComma",
    Indented: 128,
    "128": "Indented",
    SpaceBetweenBraces: 256,
    "256": "SpaceBetweenBraces",
    SpaceBetweenSiblings: 512,
    "512": "HeritageClauses",
    Braces: 1024,
    "1024": "Braces",
    Parenthesis: 2048,
    "2048": "Parenthesis",
    AngleBrackets: 4096,
    "4096": "AngleBrackets",
    SquareBrackets: 8192,
    "8192": "SquareBrackets",
    BracketsMask: 15360,
    "15360": "BracketsMask",
    OptionalIfUndefined: 16384,
    "16384": "OptionalIfUndefined",
    OptionalIfEmpty: 32768,
    "32768": "OptionalIfEmpty",
    Optional: 49152,
    "49152": "Optional",
    PreferNewLine: 65536,
    "65536": "PreferNewLine",
    NoTrailingNewLine: 131072,
    "131072": "NoTrailingNewLine",
    NoInterveningComments: 262144,
    "262144": "JsxElementOrFragmentChildren",
    NoSpaceIfEmpty: 524288,
    "524288": "NoSpaceIfEmpty",
    SingleElement: 1048576,
    "1048576": "SingleElement",
    SpaceAfterList: 2097152,
    "2097152": "SpaceAfterList",
    Modifiers: 2359808,
    "2359808": "Modifiers",
    HeritageClauses: 512,
    SingleLineTypeLiteralMembers: 768,
    "768": "SingleLineFunctionBodyStatements",
    MultiLineTypeLiteralMembers: 32897,
    "32897": "MultiLineTypeLiteralMembers",
    SingleLineTupleTypeElements: 528,
    "528": "HeritageClauseTypes",
    MultiLineTupleTypeElements: 657,
    "657": "MultiLineTupleTypeElements",
    UnionTypeConstituents: 516,
    "516": "UnionTypeConstituents",
    IntersectionTypeConstituents: 520,
    "520": "IntersectionTypeConstituents",
    ObjectBindingPatternElements: 525136,
    "525136": "NamedImportsOrExportsElements",
    ArrayBindingPatternElements: 524880,
    "524880": "ArrayBindingPatternElements",
    ObjectLiteralExpressionProperties: 526226,
    "526226": "ImportClauseEntries",
    ImportAttributes: 526226,
    ImportClauseEntries: 526226,
    ArrayLiteralExpressionElements: 8914,
    "8914": "ArrayLiteralExpressionElements",
    CommaListElements: 528,
    CallExpressionArguments: 2576,
    "2576": "Parameters",
    NewExpressionArguments: 18960,
    "18960": "NewExpressionArguments",
    TemplateExpressionSpans: 262144,
    SingleLineBlockStatements: 768,
    MultiLineBlockStatements: 129,
    "129": "CaseBlockClauses",
    VariableDeclarationList: 528,
    SingleLineFunctionBodyStatements: 768,
    MultiLineFunctionBodyStatements: 1,
    ClassHeritageClauses: 0,
    ClassMembers: 129,
    InterfaceMembers: 129,
    EnumMembers: 145,
    "145": "EnumMembers",
    CaseBlockClauses: 129,
    NamedImportsOrExportsElements: 525136,
    JsxElementOrFragmentChildren: 262144,
    JsxElementAttributes: 262656,
    "262656": "JsxElementAttributes",
    CaseOrDefaultClauseStatements: 163969,
    "163969": "CaseOrDefaultClauseStatements",
    HeritageClauseTypes: 528,
    SourceFileStatements: 131073,
    "131073": "SourceFileStatements",
    Decorators: 2146305,
    "2146305": "Decorators",
    TypeArguments: 53776,
    "53776": "TypeParameters",
    TypeParameters: 53776,
    Parameters: 2576,
    IndexSignatureParameters: 8848,
    "8848": "IndexSignatureParameters",
    JSDocComment: 33,
    "33": "JSDocComment"
};
/** @internal */
export type PragmaKindFlags = number;
/** @internal */
export const PragmaKindFlags: {
    readonly None: 0;
    readonly TripleSlashXML: 1;
    readonly SingleLine: 2;
    readonly MultiLine: 4;
    readonly All: 7;
    readonly Default: 7;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    TripleSlashXML: 1,
    "1": "TripleSlashXML",
    SingleLine: 2,
    "2": "SingleLine",
    MultiLine: 4,
    "4": "MultiLine",
    All: 7,
    "7": "Default",
    Default: 7
};
/** @internal */
export interface PragmaArgumentSpecification<TName extends string> {
    name: TName; // Determines the name of the key in the resulting parsed type, type parameter to cause literal type inference
    optional?: boolean;
    captureSpan?: boolean;
}
/** @internal */
export interface PragmaDefinition<T1 extends string = string, T2 extends string = string, T3 extends string = string, T4 extends string = string> {
    args?: readonly [
        PragmaArgumentSpecification<T1>
    ] | readonly [
        PragmaArgumentSpecification<T1>,
        PragmaArgumentSpecification<T2>
    ] | readonly [
        PragmaArgumentSpecification<T1>,
        PragmaArgumentSpecification<T2>,
        PragmaArgumentSpecification<T3>
    ] | readonly [
        PragmaArgumentSpecification<T1>,
        PragmaArgumentSpecification<T2>,
        PragmaArgumentSpecification<T3>,
        PragmaArgumentSpecification<T4>
    ];
    // If not present, defaults to PragmaKindFlags.Default
    kind?: PragmaKindFlags;
}
// While not strictly a type, this is here because `PragmaMap` needs to be here to be used with `SourceFile`, and we don't
//  fancy effectively defining it twice, once in value-space and once in type-space
/** @internal */
export const commentPragmas: ConcretePragmaSpecs = {
    "reference": {
        args: [
            { name: "types", optional: true, captureSpan: true },
            { name: "lib", optional: true, captureSpan: true },
            { name: "path", optional: true, captureSpan: true },
            { name: "no-default-lib", optional: true },
            { name: "resolution-mode", optional: true },
            { name: "preserve", optional: true },
        ],
        kind: PragmaKindFlags.TripleSlashXML,
    },
    "amd-dependency": {
        args: [{ name: "path" }, { name: "name", optional: true }],
        kind: PragmaKindFlags.TripleSlashXML,
    },
    "amd-module": {
        args: [{ name: "name" }],
        kind: PragmaKindFlags.TripleSlashXML,
    },
    "ts-check": {
        kind: PragmaKindFlags.SingleLine,
    },
    "ts-nocheck": {
        kind: PragmaKindFlags.SingleLine,
    },
    "jsx": {
        args: [{ name: "factory" }],
        kind: PragmaKindFlags.MultiLine,
    },
    "jsxfrag": {
        args: [{ name: "factory" }],
        kind: PragmaKindFlags.MultiLine,
    },
    "jsximportsource": {
        args: [{ name: "factory" }],
        kind: PragmaKindFlags.MultiLine,
    },
    "jsxruntime": {
        args: [{ name: "factory" }],
        kind: PragmaKindFlags.MultiLine,
    },
} as const;
export type JSDocParsingMode = number;
export const JSDocParsingMode: {
    readonly ParseAll: 0;
    readonly ParseNone: 1;
    readonly ParseForTypeErrors: 2;
    readonly ParseForTypeInfo: 3;
    [index: number]: string;
} = {
    ParseAll: 0,
    "0": "ParseAll",
    ParseNone: 1,
    "1": "ParseNone",
    ParseForTypeErrors: 2,
    "2": "ParseForTypeErrors",
    ParseForTypeInfo: 3,
    "3": "ParseForTypeInfo"
};
/** @internal */
export type PragmaArgTypeMaybeCapture<TDesc> = TDesc extends {
    captureSpan: true;
} ? {
    value: string;
    pos: number;
    end: number;
} : string;
/** @internal */
export type PragmaArgTypeOptional<TDesc, TName extends string> = TDesc extends {
    optional: true;
} ? {
    [K in TName]?: PragmaArgTypeMaybeCapture<TDesc>;
} : {
    [K in TName]: PragmaArgTypeMaybeCapture<TDesc>;
};
/** @internal */
export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
/** @internal */
export type ArgumentDefinitionToFieldUnion<T extends readonly PragmaArgumentSpecification<string>[]> = {
    [K in keyof T]: PragmaArgTypeOptional<T[K], T[K] extends {
        name: infer TName;
    } ? TName extends string ? TName : never : never>;
}[Extract<keyof T, number>]; // The mapped type maps over only the tuple members, but this reindex gets _all_ members - by extracting only `number` keys, we get only the tuple members
/**
 * Maps a pragma definition into the desired shape for its arguments object
 *
 * @internal
 */
export type PragmaArgumentType<KPrag extends keyof ConcretePragmaSpecs> = KPrag extends "jsx" | "jsxfrag" | "jsximportsource" | "jsxruntime" ? { factory?: string } : ConcretePragmaSpecs[KPrag] extends {
    args: readonly PragmaArgumentSpecification<string>[];
} ? UnionToIntersection<ArgumentDefinitionToFieldUnion<ConcretePragmaSpecs[KPrag]["args"]>> : {};
/** @internal */
export interface ConcretePragmaSpecs {
    "reference": {
        args: readonly [
            {
                name: "types";
                optional: true;
                captureSpan: true;
            },
            {
                name: "lib";
                optional: true;
                captureSpan: true;
            },
            {
                name: "path";
                optional: true;
                captureSpan: true;
            },
            {
                name: "no-default-lib";
                optional: true;
            },
            {
                name: "resolution-mode";
                optional: true;
            },
            {
                name: "preserve";
                optional: true;
            }
        ];
        kind: typeof PragmaKindFlags.TripleSlashXML;
    };
    "amd-dependency": {
        args: readonly [
            {
                name: "path";
            },
            {
                name: "name";
                optional: true;
            }
        ];
        kind: typeof PragmaKindFlags.TripleSlashXML;
    };
    "amd-module": {
        args: readonly [
            {
                name: "name";
            }
        ];
        kind: typeof PragmaKindFlags.TripleSlashXML;
    };
    "ts-check": {
        kind: typeof PragmaKindFlags.SingleLine;
    };
    "ts-nocheck": {
        kind: typeof PragmaKindFlags.SingleLine;
    };
    "jsx": {
        args: readonly [
            {
                name: "factory";
            }
        ];
        kind: typeof PragmaKindFlags.MultiLine;
    };
    "jsxfrag": {
        args: readonly [
            {
                name: "factory";
            }
        ];
        kind: typeof PragmaKindFlags.MultiLine;
    };
    "jsximportsource": {
        args: readonly [
            {
                name: "factory";
            }
        ];
        kind: typeof PragmaKindFlags.MultiLine;
    };
    "jsxruntime": {
        args: readonly [
            {
                name: "factory";
            }
        ];
        kind: typeof PragmaKindFlags.MultiLine;
    };
}
/** @internal */
export type PragmaPseudoMap = {
    [K in keyof ConcretePragmaSpecs]: {
        arguments: PragmaArgumentType<K>;
        range: CommentRange;
    };
};
/** @internal */
export type PragmaPseudoMapEntry = {
    [K in keyof PragmaPseudoMap]: {
        name: K;
        args: PragmaPseudoMap[K];
    };
}[keyof PragmaPseudoMap];
/** @internal */
export interface ReadonlyPragmaMap extends ReadonlyMap<string, PragmaPseudoMap[keyof PragmaPseudoMap] | PragmaPseudoMap[keyof PragmaPseudoMap][]> {
    get<TKey extends keyof PragmaPseudoMap>(key: TKey): PragmaPseudoMap[TKey] | PragmaPseudoMap[TKey][] | undefined;
    forEach(action: <TKey extends keyof PragmaPseudoMap>(value: PragmaPseudoMap[TKey] | PragmaPseudoMap[TKey][], key: TKey, map: ReadonlyPragmaMap) => void): void;
}
/**
 * A strongly-typed es6 map of pragma entries, the values of which are either a single argument
 * value (if only one was found), or an array of multiple argument values if the pragma is present
 * in multiple places
 *
 * @internal
 */
export interface PragmaMap extends Map<string, PragmaPseudoMap[keyof PragmaPseudoMap] | PragmaPseudoMap[keyof PragmaPseudoMap][]>, ReadonlyPragmaMap {
    set<TKey extends keyof PragmaPseudoMap>(key: TKey, value: PragmaPseudoMap[TKey] | PragmaPseudoMap[TKey][]): this;
    get<TKey extends keyof PragmaPseudoMap>(key: TKey): PragmaPseudoMap[TKey] | PragmaPseudoMap[TKey][] | undefined;
    forEach(action: <TKey extends keyof PragmaPseudoMap>(value: PragmaPseudoMap[TKey] | PragmaPseudoMap[TKey][], key: TKey, map: PragmaMap) => void): void;
}
/** @internal */
export interface CommentDirectivesMap {
    getUnusedExpectations(): CommentDirective[];
    markUsed(matchedLine: number): boolean;
}
export interface UserPreferences {
    disableSuggestions?: boolean;
    quotePreference?: "auto" | "double" | "single";
    /**
     * If enabled, TypeScript will search through all external modules' exports and add them to the completions list.
     * This affects lone identifier completions but not completions on the right hand side of `obj.`.
     */
    includeCompletionsForModuleExports?: boolean;
    /**
     * Enables auto-import-style completions on partially-typed import statements. E.g., allows
     * `import write|` to be completed to `import { writeFile } from "fs"`.
     */
    includeCompletionsForImportStatements?: boolean;
    /**
     * Allows completions to be formatted with snippet text, indicated by `CompletionItem["isSnippet"]`.
     */
    includeCompletionsWithSnippetText?: boolean;
    /**
     * Unless this option is `false`, or `includeCompletionsWithInsertText` is not enabled,
     * member completion lists triggered with `.` will include entries on potentially-null and potentially-undefined
     * values, with insertion text to replace preceding `.` tokens with `?.`.
     */
    includeAutomaticOptionalChainCompletions?: boolean;
    /**
     * If enabled, the completion list will include completions with invalid identifier names.
     * For those entries, The `insertText` and `replacementSpan` properties will be set to change from `.x` property access to `["x"]`.
     */
    includeCompletionsWithInsertText?: boolean;
    /**
     * If enabled, completions for class members (e.g. methods and properties) will include
     * a whole declaration for the member.
     * E.g., `class A { f| }` could be completed to `class A { foo(): number {} }`, instead of
     * `class A { foo }`.
     */
    includeCompletionsWithClassMemberSnippets?: boolean;
    /**
     * If enabled, object literal methods will have a method declaration completion entry in addition
     * to the regular completion entry containing just the method name.
     * E.g., `const objectLiteral: T = { f| }` could be completed to `const objectLiteral: T = { foo(): void {} }`,
     * in addition to `const objectLiteral: T = { foo }`.
     */
    includeCompletionsWithObjectLiteralMethodSnippets?: boolean;
    /**
     * Indicates whether {@link CompletionEntry.labelDetails completion entry label details} are supported.
     * If not, contents of `labelDetails` may be included in the {@link CompletionEntry.name} property.
     */
    useLabelDetailsInCompletionEntries?: boolean;
    allowIncompleteCompletions?: boolean;
    importModuleSpecifierPreference?: "shortest" | "project-relative" | "relative" | "non-relative";
    /** Determines whether we import `foo/index.ts` as "foo", "foo/index", or "foo/index.js" */
    importModuleSpecifierEnding?: "auto" | "minimal" | "index" | "js";
    allowTextChangesInNewFiles?: boolean;
    providePrefixAndSuffixTextForRename?: boolean;
    includePackageJsonAutoImports?: "auto" | "on" | "off";
    provideRefactorNotApplicableReason?: boolean;
    jsxAttributeCompletionStyle?: "auto" | "braces" | "none";
    includeInlayParameterNameHints?: "none" | "literals" | "all";
    includeInlayParameterNameHintsWhenArgumentMatchesName?: boolean;
    includeInlayFunctionParameterTypeHints?: boolean;
    includeInlayVariableTypeHints?: boolean;
    includeInlayVariableTypeHintsWhenTypeMatchesName?: boolean;
    includeInlayPropertyDeclarationTypeHints?: boolean;
    includeInlayFunctionLikeReturnTypeHints?: boolean;
    includeInlayEnumMemberValueHints?: boolean;
    interactiveInlayHints?: boolean;
    allowRenameOfImportPath?: boolean;
    autoImportFileExcludePatterns?: string[];
    autoImportSpecifierExcludeRegexes?: string[];
    preferTypeOnlyAutoImports?: boolean;
    /**
     * Indicates whether imports should be organized in a case-insensitive manner.
     */
    organizeImportsIgnoreCase?: "auto" | boolean;
    /**
     * Indicates whether imports should be organized via an "ordinal" (binary) comparison using the numeric value
     * of their code points, or via "unicode" collation (via the
     * [Unicode Collation Algorithm](https://unicode.org/reports/tr10/#Scope)) using rules associated with the locale
     * specified in {@link organizeImportsCollationLocale}.
     *
     * Default: `"ordinal"`.
     */
    organizeImportsCollation?: "ordinal" | "unicode";
    /**
     * Indicates the locale to use for "unicode" collation. If not specified, the locale `"en"` is used as an invariant
     * for the sake of consistent sorting. Use `"auto"` to use the detected UI locale.
     *
     * This preference is ignored if {@link organizeImportsCollation} is not `"unicode"`.
     *
     * Default: `"en"`
     */
    organizeImportsLocale?: string;
    /**
     * Indicates whether numeric collation should be used for digit sequences in strings. When `true`, will collate
     * strings such that `a1z < a2z < a100z`. When `false`, will collate strings such that `a1z < a100z < a2z`.
     *
     * This preference is ignored if {@link organizeImportsCollation} is not `"unicode"`.
     *
     * Default: `false`
     */
    organizeImportsNumericCollation?: boolean;
    /**
     * Indicates whether accents and other diacritic marks are considered unequal for the purpose of collation. When
     * `true`, characters with accents and other diacritics will be collated in the order defined by the locale specified
     * in {@link organizeImportsCollationLocale}.
     *
     * This preference is ignored if {@link organizeImportsCollation} is not `"unicode"`.
     *
     * Default: `true`
     */
    organizeImportsAccentCollation?: boolean;
    /**
     * Indicates whether upper case or lower case should sort first. When `false`, the default order for the locale
     * specified in {@link organizeImportsCollationLocale} is used.
     *
     * This preference is ignored if {@link organizeImportsCollation} is not `"unicode"`. This preference is also
     * ignored if we are using case-insensitive sorting, which occurs when {@link organizeImportsIgnoreCase} is `true`,
     * or if {@link organizeImportsIgnoreCase} is `"auto"` and the auto-detected case sensitivity is determined to be
     * case-insensitive.
     *
     * Default: `false`
     */
    organizeImportsCaseFirst?: "upper" | "lower" | false;
    /**
     * Indicates where named type-only imports should sort. "inline" sorts named imports without regard to if the import is
     * type-only.
     *
     * Default: `last`
     */
    organizeImportsTypeOrder?: OrganizeImportsTypeOrder;
    /**
     * Indicates whether to exclude standard library and node_modules file symbols from navTo results.
     */
    excludeLibrarySymbolsInNavTo?: boolean;
    lazyConfiguredProjectsFromExternalProject?: boolean;
    displayPartsForJSDoc?: boolean;
    generateReturnInDocTemplate?: boolean;
    disableLineTextInReferences?: boolean;
    /**
     * A positive integer indicating the maximum length of a hover text before it is truncated.
     *
     * Default: `500`
     */
    maximumHoverLength?: number;
}
export type OrganizeImportsTypeOrder = "last" | "inline" | "first";
/** Represents a bigint literal value without requiring bigint support */
export interface PseudoBigInt {
    negative: boolean;
    base10Value: string;
}
/** @internal */
export interface Queue<T> {
    enqueue(...items: T[]): void;
    dequeue(): T;
    isEmpty(): boolean;
}
/** @internal */
export interface EvaluationResolver {
    evaluateEntityNameExpression(expr: EntityNameExpression, location: Declaration | undefined): EvaluatorResult;
    evaluateElementAccessExpression(expr: ElementAccessExpression, location: Declaration | undefined): EvaluatorResult;
}
/** @internal */
export type HasInferredType = Exclude<VariableLikeDeclaration, JsxAttribute | EnumMember> | PropertyAccessExpression | ElementAccessExpression | BinaryExpression | ExportAssignment;
/** @internal */
export interface SyntacticTypeNodeBuilderContext {
    flags: NodeBuilderFlags;
    tracker: Required<Pick<SymbolTracker, "reportInferenceFallback">>;
    enclosingFile: SourceFile | undefined;
    enclosingDeclaration: Node | undefined;
    approximateLength: number;
    noInferenceFallback?: boolean;
    suppressReportInferenceFallback: boolean;
}
/** @internal */
export interface SyntacticTypeNodeBuilderResolver<TContext extends SyntacticTypeNodeBuilderContext = SyntacticTypeNodeBuilderContext> {
    isOptionalParameter(p: ParameterDeclaration): boolean;
    isUndefinedIdentifierExpression(name: Identifier): boolean;
    isExpandoFunctionDeclaration(name: FunctionDeclaration | VariableDeclaration): boolean;
    getAllAccessorDeclarations(declaration: AccessorDeclaration): AllAccessorDeclarations;
    requiresAddingImplicitUndefined(declaration: ParameterDeclaration | PropertySignature | JSDocParameterTag | JSDocPropertyTag | PropertyDeclaration, symbol: Symbol | undefined, enclosingDeclaration: Node | undefined): boolean;
    isDefinitelyReferenceToGlobalSymbolObject(node: Node): boolean;
    isEntityNameVisible(context: TContext, entityName: EntityNameOrEntityNameExpression, shouldComputeAliasToMakeVisible?: boolean): SymbolVisibilityResult;
    serializeExistingTypeNode(context: TContext, node: TypeNode, addUndefined?: boolean): TypeNode | undefined;
    serializeReturnTypeForSignature(context: TContext, signatureDeclaration: SignatureDeclaration | JSDocSignature, symbol: Symbol | undefined): TypeNode | undefined;
    serializeTypeOfExpression(context: TContext, expr: Expression): TypeNode;
    serializeTypeOfDeclaration(context: TContext, node: HasInferredType | GetAccessorDeclaration | SetAccessorDeclaration, symbol: Symbol | undefined): TypeNode | undefined;
    serializeNameOfParameter(context: TContext, parameter: ParameterDeclaration): BindingName | string;
    serializeTypeName(context: TContext, node: EntityName, isTypeOf?: boolean, typeArguments?: readonly TypeNode[]): TypeNode | undefined;
    serializeEntityName(context: TContext, node: EntityNameExpression): Expression | undefined;
    getJsDocPropertyOverride(context: TContext, jsDocTypeLiteral: JSDocTypeLiteral, jsDocProperty: JSDocPropertyLikeTag): TypeNode | undefined;
    enterNewScope(context: TContext, node: IntroducesNewScopeNode | ConditionalTypeNode): () => void;
    markNodeReuse<T extends Node>(context: TContext, range: T, location: Node | undefined): T;
    trackExistingEntityName<T extends EntityNameOrEntityNameExpression>(context: TContext, node: T): {
        introducesError: boolean;
        node: T;
    };
    trackComputedName(context: TContext, accessExpression: EntityNameOrEntityNameExpression): void;
    evaluateEntityNameExpression(expression: EntityNameExpression): EvaluatorResult;
    getModuleSpecifierOverride(context: TContext, parent: ImportTypeNode, lit: StringLiteral): string | undefined;
    canReuseTypeNode(context: TContext, existing: TypeNode): boolean;
    canReuseTypeNodeAnnotation(context: TContext, node: Declaration, existing: TypeNode, symbol: Symbol | undefined, requiresAddingUndefined?: boolean): boolean;
    shouldRemoveDeclaration(context: TContext, node: DynamicNamedDeclaration): boolean;
    hasLateBindableName(node: Declaration): node is LateBoundDeclaration | LateBoundBinaryExpressionDeclaration;
    createRecoveryBoundary(context: TContext): {
        startRecoveryScope(): () => void;
        finalizeBoundary(): boolean;
        markError(): void;
        hadError(): boolean;
    };
}
/** @internal */
export interface SyntacticNodeBuilder<TContext extends SyntacticTypeNodeBuilderContext = SyntacticTypeNodeBuilderContext> {
    serializeTypeOfDeclaration: (node: HasInferredType, symbol: Symbol, context: TContext) => TypeNode | undefined;
    serializeReturnTypeForSignature: (signature: SignatureDeclaration | JSDocSignature, symbol: Symbol, context: TContext) => TypeNode | undefined;
    serializeTypeOfExpression: (expr: Expression | JsxAttributeValue, context: TContext, addUndefined?: boolean, preserveLiterals?: boolean) => TypeNode;
    tryReuseExistingTypeNode: (context: TContext, existing: TypeNode) => TypeNode | undefined;
    serializeTypeOfAccessor: (accessor: AccessorDeclaration, symbol: Symbol, context: TContext) => TypeNode | undefined;
}
/** @internal */
export type IntroducesNewScopeNode = SignatureDeclaration | JSDocSignature | MappedTypeNode;
