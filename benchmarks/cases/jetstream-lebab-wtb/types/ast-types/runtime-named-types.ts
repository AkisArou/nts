// Type layouts from ast-types 0.16.1 generated namedTypes and kinds (MIT).
// Categories use their original concrete-kind unions; no AST or validator is replaced.
import type {Type} from "./types.js";
import type * as K from "./gen/kinds.js";
import {exportsReady} from "../../webpack.ts";
export interface RuntimeNamedTypes {
  Printable: Type<K.PrintableKind>;
  SourceLocation: Type<K.SourceLocationKind>;
  Node: Type<K.NodeKind>;
  Comment: Type<K.CommentKind>;
  Position: Type<K.PositionKind>;
  File: Type<K.FileKind>;
  Program: Type<K.ProgramKind>;
  Statement: Type<K.StatementKind>;
  Function: Type<K.FunctionKind>;
  Expression: Type<K.ExpressionKind>;
  Pattern: Type<K.PatternKind>;
  Identifier: Type<K.IdentifierKind>;
  BlockStatement: Type<K.BlockStatementKind>;
  EmptyStatement: Type<K.EmptyStatementKind>;
  ExpressionStatement: Type<K.ExpressionStatementKind>;
  IfStatement: Type<K.IfStatementKind>;
  LabeledStatement: Type<K.LabeledStatementKind>;
  BreakStatement: Type<K.BreakStatementKind>;
  ContinueStatement: Type<K.ContinueStatementKind>;
  WithStatement: Type<K.WithStatementKind>;
  SwitchStatement: Type<K.SwitchStatementKind>;
  SwitchCase: Type<K.SwitchCaseKind>;
  ReturnStatement: Type<K.ReturnStatementKind>;
  ThrowStatement: Type<K.ThrowStatementKind>;
  TryStatement: Type<K.TryStatementKind>;
  CatchClause: Type<K.CatchClauseKind>;
  WhileStatement: Type<K.WhileStatementKind>;
  DoWhileStatement: Type<K.DoWhileStatementKind>;
  ForStatement: Type<K.ForStatementKind>;
  Declaration: Type<K.DeclarationKind>;
  VariableDeclaration: Type<K.VariableDeclarationKind>;
  ForInStatement: Type<K.ForInStatementKind>;
  DebuggerStatement: Type<K.DebuggerStatementKind>;
  FunctionDeclaration: Type<K.FunctionDeclarationKind>;
  FunctionExpression: Type<K.FunctionExpressionKind>;
  VariableDeclarator: Type<K.VariableDeclaratorKind>;
  ThisExpression: Type<K.ThisExpressionKind>;
  ArrayExpression: Type<K.ArrayExpressionKind>;
  ObjectExpression: Type<K.ObjectExpressionKind>;
  Property: Type<K.PropertyKind>;
  Literal: Type<K.LiteralKind>;
  SequenceExpression: Type<K.SequenceExpressionKind>;
  UnaryExpression: Type<K.UnaryExpressionKind>;
  BinaryExpression: Type<K.BinaryExpressionKind>;
  AssignmentExpression: Type<K.AssignmentExpressionKind>;
  ChainElement: Type<K.ChainElementKind>;
  MemberExpression: Type<K.MemberExpressionKind>;
  UpdateExpression: Type<K.UpdateExpressionKind>;
  LogicalExpression: Type<K.LogicalExpressionKind>;
  ConditionalExpression: Type<K.ConditionalExpressionKind>;
  NewExpression: Type<K.NewExpressionKind>;
  CallExpression: Type<K.CallExpressionKind>;
  RestElement: Type<K.RestElementKind>;
  TypeAnnotation: Type<K.TypeAnnotationKind>;
  TSTypeAnnotation: Type<K.TSTypeAnnotationKind>;
  SpreadElementPattern: Type<K.SpreadElementPatternKind>;
  ArrowFunctionExpression: Type<K.ArrowFunctionExpressionKind>;
  ForOfStatement: Type<K.ForOfStatementKind>;
  YieldExpression: Type<K.YieldExpressionKind>;
  GeneratorExpression: Type<K.GeneratorExpressionKind>;
  ComprehensionBlock: Type<K.ComprehensionBlockKind>;
  ComprehensionExpression: Type<K.ComprehensionExpressionKind>;
  ObjectProperty: Type<K.ObjectPropertyKind>;
  PropertyPattern: Type<K.PropertyPatternKind>;
  ObjectPattern: Type<K.ObjectPatternKind>;
  ArrayPattern: Type<K.ArrayPatternKind>;
  SpreadElement: Type<K.SpreadElementKind>;
  AssignmentPattern: Type<K.AssignmentPatternKind>;
  MethodDefinition: Type<K.MethodDefinitionKind>;
  ClassPropertyDefinition: Type<K.ClassPropertyDefinitionKind>;
  ClassProperty: Type<K.ClassPropertyKind>;
  StaticBlock: Type<K.StaticBlockKind>;
  ClassBody: Type<K.ClassBodyKind>;
  ClassDeclaration: Type<K.ClassDeclarationKind>;
  ClassExpression: Type<K.ClassExpressionKind>;
  Super: Type<K.SuperKind>;
  Specifier: Type<K.SpecifierKind>;
  ModuleSpecifier: Type<K.ModuleSpecifierKind>;
  ImportSpecifier: Type<K.ImportSpecifierKind>;
  ImportDefaultSpecifier: Type<K.ImportDefaultSpecifierKind>;
  ImportNamespaceSpecifier: Type<K.ImportNamespaceSpecifierKind>;
  ImportDeclaration: Type<K.ImportDeclarationKind>;
  ExportNamedDeclaration: Type<K.ExportNamedDeclarationKind>;
  ExportSpecifier: Type<K.ExportSpecifierKind>;
  ExportDefaultDeclaration: Type<K.ExportDefaultDeclarationKind>;
  ExportAllDeclaration: Type<K.ExportAllDeclarationKind>;
  TaggedTemplateExpression: Type<K.TaggedTemplateExpressionKind>;
  TemplateLiteral: Type<K.TemplateLiteralKind>;
  TemplateElement: Type<K.TemplateElementKind>;
  MetaProperty: Type<K.MetaPropertyKind>;
  AwaitExpression: Type<K.AwaitExpressionKind>;
  SpreadProperty: Type<K.SpreadPropertyKind>;
  SpreadPropertyPattern: Type<K.SpreadPropertyPatternKind>;
  ImportExpression: Type<K.ImportExpressionKind>;
  ChainExpression: Type<K.ChainExpressionKind>;
  OptionalCallExpression: Type<K.OptionalCallExpressionKind>;
  OptionalMemberExpression: Type<K.OptionalMemberExpressionKind>;
  Decorator: Type<K.DecoratorKind>;
  PrivateName: Type<K.PrivateNameKind>;
  ClassPrivateProperty: Type<K.ClassPrivatePropertyKind>;
  ImportAttribute: Type<K.ImportAttributeKind>;
  RecordExpression: Type<K.RecordExpressionKind>;
  ObjectMethod: Type<K.ObjectMethodKind>;
  TupleExpression: Type<K.TupleExpressionKind>;
  ModuleExpression: Type<K.ModuleExpressionKind>;
  JSXAttribute: Type<K.JSXAttributeKind>;
  JSXIdentifier: Type<K.JSXIdentifierKind>;
  JSXNamespacedName: Type<K.JSXNamespacedNameKind>;
  JSXExpressionContainer: Type<K.JSXExpressionContainerKind>;
  JSXElement: Type<K.JSXElementKind>;
  JSXFragment: Type<K.JSXFragmentKind>;
  JSXMemberExpression: Type<K.JSXMemberExpressionKind>;
  JSXSpreadAttribute: Type<K.JSXSpreadAttributeKind>;
  JSXEmptyExpression: Type<K.JSXEmptyExpressionKind>;
  JSXText: Type<K.JSXTextKind>;
  JSXSpreadChild: Type<K.JSXSpreadChildKind>;
  JSXOpeningElement: Type<K.JSXOpeningElementKind>;
  JSXClosingElement: Type<K.JSXClosingElementKind>;
  JSXOpeningFragment: Type<K.JSXOpeningFragmentKind>;
  JSXClosingFragment: Type<K.JSXClosingFragmentKind>;
  TypeParameterDeclaration: Type<K.TypeParameterDeclarationKind>;
  TSTypeParameterDeclaration: Type<K.TSTypeParameterDeclarationKind>;
  TypeParameterInstantiation: Type<K.TypeParameterInstantiationKind>;
  TSTypeParameterInstantiation: Type<K.TSTypeParameterInstantiationKind>;
  ClassImplements: Type<K.ClassImplementsKind>;
  TSType: Type<K.TSTypeKind>;
  TSHasOptionalTypeParameterInstantiation: Type<K.TSHasOptionalTypeParameterInstantiationKind>;
  TSExpressionWithTypeArguments: Type<K.TSExpressionWithTypeArgumentsKind>;
  Flow: Type<K.FlowKind>;
  FlowType: Type<K.FlowTypeKind>;
  AnyTypeAnnotation: Type<K.AnyTypeAnnotationKind>;
  EmptyTypeAnnotation: Type<K.EmptyTypeAnnotationKind>;
  MixedTypeAnnotation: Type<K.MixedTypeAnnotationKind>;
  VoidTypeAnnotation: Type<K.VoidTypeAnnotationKind>;
  SymbolTypeAnnotation: Type<K.SymbolTypeAnnotationKind>;
  NumberTypeAnnotation: Type<K.NumberTypeAnnotationKind>;
  BigIntTypeAnnotation: Type<K.BigIntTypeAnnotationKind>;
  NumberLiteralTypeAnnotation: Type<K.NumberLiteralTypeAnnotationKind>;
  NumericLiteralTypeAnnotation: Type<K.NumericLiteralTypeAnnotationKind>;
  BigIntLiteralTypeAnnotation: Type<K.BigIntLiteralTypeAnnotationKind>;
  StringTypeAnnotation: Type<K.StringTypeAnnotationKind>;
  StringLiteralTypeAnnotation: Type<K.StringLiteralTypeAnnotationKind>;
  BooleanTypeAnnotation: Type<K.BooleanTypeAnnotationKind>;
  BooleanLiteralTypeAnnotation: Type<K.BooleanLiteralTypeAnnotationKind>;
  NullableTypeAnnotation: Type<K.NullableTypeAnnotationKind>;
  NullLiteralTypeAnnotation: Type<K.NullLiteralTypeAnnotationKind>;
  NullTypeAnnotation: Type<K.NullTypeAnnotationKind>;
  ThisTypeAnnotation: Type<K.ThisTypeAnnotationKind>;
  ExistsTypeAnnotation: Type<K.ExistsTypeAnnotationKind>;
  ExistentialTypeParam: Type<K.ExistentialTypeParamKind>;
  FunctionTypeAnnotation: Type<K.FunctionTypeAnnotationKind>;
  FunctionTypeParam: Type<K.FunctionTypeParamKind>;
  ArrayTypeAnnotation: Type<K.ArrayTypeAnnotationKind>;
  ObjectTypeAnnotation: Type<K.ObjectTypeAnnotationKind>;
  ObjectTypeProperty: Type<K.ObjectTypePropertyKind>;
  ObjectTypeSpreadProperty: Type<K.ObjectTypeSpreadPropertyKind>;
  ObjectTypeIndexer: Type<K.ObjectTypeIndexerKind>;
  ObjectTypeCallProperty: Type<K.ObjectTypeCallPropertyKind>;
  ObjectTypeInternalSlot: Type<K.ObjectTypeInternalSlotKind>;
  Variance: Type<K.VarianceKind>;
  QualifiedTypeIdentifier: Type<K.QualifiedTypeIdentifierKind>;
  GenericTypeAnnotation: Type<K.GenericTypeAnnotationKind>;
  MemberTypeAnnotation: Type<K.MemberTypeAnnotationKind>;
  IndexedAccessType: Type<K.IndexedAccessTypeKind>;
  OptionalIndexedAccessType: Type<K.OptionalIndexedAccessTypeKind>;
  UnionTypeAnnotation: Type<K.UnionTypeAnnotationKind>;
  IntersectionTypeAnnotation: Type<K.IntersectionTypeAnnotationKind>;
  TypeofTypeAnnotation: Type<K.TypeofTypeAnnotationKind>;
  TypeParameter: Type<K.TypeParameterKind>;
  InterfaceTypeAnnotation: Type<K.InterfaceTypeAnnotationKind>;
  InterfaceExtends: Type<K.InterfaceExtendsKind>;
  InterfaceDeclaration: Type<K.InterfaceDeclarationKind>;
  DeclareInterface: Type<K.DeclareInterfaceKind>;
  TypeAlias: Type<K.TypeAliasKind>;
  DeclareTypeAlias: Type<K.DeclareTypeAliasKind>;
  OpaqueType: Type<K.OpaqueTypeKind>;
  DeclareOpaqueType: Type<K.DeclareOpaqueTypeKind>;
  TypeCastExpression: Type<K.TypeCastExpressionKind>;
  TupleTypeAnnotation: Type<K.TupleTypeAnnotationKind>;
  DeclareVariable: Type<K.DeclareVariableKind>;
  DeclareFunction: Type<K.DeclareFunctionKind>;
  FlowPredicate: Type<K.FlowPredicateKind>;
  DeclareClass: Type<K.DeclareClassKind>;
  DeclareModule: Type<K.DeclareModuleKind>;
  DeclareModuleExports: Type<K.DeclareModuleExportsKind>;
  DeclareExportDeclaration: Type<K.DeclareExportDeclarationKind>;
  ExportBatchSpecifier: Type<K.ExportBatchSpecifierKind>;
  DeclareExportAllDeclaration: Type<K.DeclareExportAllDeclarationKind>;
  InferredPredicate: Type<K.InferredPredicateKind>;
  DeclaredPredicate: Type<K.DeclaredPredicateKind>;
  EnumDeclaration: Type<K.EnumDeclarationKind>;
  EnumBooleanBody: Type<K.EnumBooleanBodyKind>;
  EnumNumberBody: Type<K.EnumNumberBodyKind>;
  EnumStringBody: Type<K.EnumStringBodyKind>;
  EnumSymbolBody: Type<K.EnumSymbolBodyKind>;
  EnumBooleanMember: Type<K.EnumBooleanMemberKind>;
  EnumNumberMember: Type<K.EnumNumberMemberKind>;
  EnumStringMember: Type<K.EnumStringMemberKind>;
  EnumDefaultedMember: Type<K.EnumDefaultedMemberKind>;
  ExportDeclaration: Type<K.ExportDeclarationKind>;
  Block: Type<K.BlockKind>;
  Line: Type<K.LineKind>;
  Noop: Type<K.NoopKind>;
  DoExpression: Type<K.DoExpressionKind>;
  BindExpression: Type<K.BindExpressionKind>;
  ParenthesizedExpression: Type<K.ParenthesizedExpressionKind>;
  ExportNamespaceSpecifier: Type<K.ExportNamespaceSpecifierKind>;
  ExportDefaultSpecifier: Type<K.ExportDefaultSpecifierKind>;
  CommentBlock: Type<K.CommentBlockKind>;
  CommentLine: Type<K.CommentLineKind>;
  Directive: Type<K.DirectiveKind>;
  DirectiveLiteral: Type<K.DirectiveLiteralKind>;
  InterpreterDirective: Type<K.InterpreterDirectiveKind>;
  StringLiteral: Type<K.StringLiteralKind>;
  NumericLiteral: Type<K.NumericLiteralKind>;
  BigIntLiteral: Type<K.BigIntLiteralKind>;
  DecimalLiteral: Type<K.DecimalLiteralKind>;
  NullLiteral: Type<K.NullLiteralKind>;
  BooleanLiteral: Type<K.BooleanLiteralKind>;
  RegExpLiteral: Type<K.RegExpLiteralKind>;
  ClassMethod: Type<K.ClassMethodKind>;
  ClassPrivateMethod: Type<K.ClassPrivateMethodKind>;
  TSHasOptionalTypeAnnotation: Type<K.TSHasOptionalTypeAnnotationKind>;
  ClassAccessorProperty: Type<K.ClassAccessorPropertyKind>;
  RestProperty: Type<K.RestPropertyKind>;
  ForAwaitStatement: Type<K.ForAwaitStatementKind>;
  Import: Type<K.ImportKind>;
  V8IntrinsicIdentifier: Type<K.V8IntrinsicIdentifierKind>;
  TopicReference: Type<K.TopicReferenceKind>;
  TSQualifiedName: Type<K.TSQualifiedNameKind>;
  TSTypeReference: Type<K.TSTypeReferenceKind>;
  TSHasOptionalTypeParameters: Type<K.TSHasOptionalTypeParametersKind>;
  TSAsExpression: Type<K.TSAsExpressionKind>;
  TSTypeCastExpression: Type<K.TSTypeCastExpressionKind>;
  TSSatisfiesExpression: Type<K.TSSatisfiesExpressionKind>;
  TSNonNullExpression: Type<K.TSNonNullExpressionKind>;
  TSAnyKeyword: Type<K.TSAnyKeywordKind>;
  TSBigIntKeyword: Type<K.TSBigIntKeywordKind>;
  TSBooleanKeyword: Type<K.TSBooleanKeywordKind>;
  TSNeverKeyword: Type<K.TSNeverKeywordKind>;
  TSNullKeyword: Type<K.TSNullKeywordKind>;
  TSNumberKeyword: Type<K.TSNumberKeywordKind>;
  TSObjectKeyword: Type<K.TSObjectKeywordKind>;
  TSStringKeyword: Type<K.TSStringKeywordKind>;
  TSSymbolKeyword: Type<K.TSSymbolKeywordKind>;
  TSUndefinedKeyword: Type<K.TSUndefinedKeywordKind>;
  TSUnknownKeyword: Type<K.TSUnknownKeywordKind>;
  TSVoidKeyword: Type<K.TSVoidKeywordKind>;
  TSIntrinsicKeyword: Type<K.TSIntrinsicKeywordKind>;
  TSThisType: Type<K.TSThisTypeKind>;
  TSArrayType: Type<K.TSArrayTypeKind>;
  TSLiteralType: Type<K.TSLiteralTypeKind>;
  TSUnionType: Type<K.TSUnionTypeKind>;
  TSIntersectionType: Type<K.TSIntersectionTypeKind>;
  TSConditionalType: Type<K.TSConditionalTypeKind>;
  TSInferType: Type<K.TSInferTypeKind>;
  TSTypeParameter: Type<K.TSTypeParameterKind>;
  TSParenthesizedType: Type<K.TSParenthesizedTypeKind>;
  TSFunctionType: Type<K.TSFunctionTypeKind>;
  TSConstructorType: Type<K.TSConstructorTypeKind>;
  TSDeclareFunction: Type<K.TSDeclareFunctionKind>;
  TSDeclareMethod: Type<K.TSDeclareMethodKind>;
  TSMappedType: Type<K.TSMappedTypeKind>;
  TSTupleType: Type<K.TSTupleTypeKind>;
  TSNamedTupleMember: Type<K.TSNamedTupleMemberKind>;
  TSRestType: Type<K.TSRestTypeKind>;
  TSOptionalType: Type<K.TSOptionalTypeKind>;
  TSIndexedAccessType: Type<K.TSIndexedAccessTypeKind>;
  TSTypeOperator: Type<K.TSTypeOperatorKind>;
  TSIndexSignature: Type<K.TSIndexSignatureKind>;
  TSPropertySignature: Type<K.TSPropertySignatureKind>;
  TSMethodSignature: Type<K.TSMethodSignatureKind>;
  TSTypePredicate: Type<K.TSTypePredicateKind>;
  TSCallSignatureDeclaration: Type<K.TSCallSignatureDeclarationKind>;
  TSConstructSignatureDeclaration: Type<K.TSConstructSignatureDeclarationKind>;
  TSEnumMember: Type<K.TSEnumMemberKind>;
  TSTypeQuery: Type<K.TSTypeQueryKind>;
  TSImportType: Type<K.TSImportTypeKind>;
  TSTypeLiteral: Type<K.TSTypeLiteralKind>;
  TSTypeAssertion: Type<K.TSTypeAssertionKind>;
  TSInstantiationExpression: Type<K.TSInstantiationExpressionKind>;
  TSEnumDeclaration: Type<K.TSEnumDeclarationKind>;
  TSTypeAliasDeclaration: Type<K.TSTypeAliasDeclarationKind>;
  TSModuleBlock: Type<K.TSModuleBlockKind>;
  TSModuleDeclaration: Type<K.TSModuleDeclarationKind>;
  TSImportEqualsDeclaration: Type<K.TSImportEqualsDeclarationKind>;
  TSExternalModuleReference: Type<K.TSExternalModuleReferenceKind>;
  TSExportAssignment: Type<K.TSExportAssignmentKind>;
  TSNamespaceExportDeclaration: Type<K.TSNamespaceExportDeclarationKind>;
  TSInterfaceBody: Type<K.TSInterfaceBodyKind>;
  TSInterfaceDeclaration: Type<K.TSInterfaceDeclarationKind>;
  TSParameterProperty: Type<K.TSParameterPropertyKind>;
}
export const namedTypeKeys = [
  "Printable",
  "SourceLocation",
  "Node",
  "Comment",
  "Position",
  "File",
  "Program",
  "Statement",
  "Function",
  "Expression",
  "Pattern",
  "Identifier",
  "BlockStatement",
  "EmptyStatement",
  "ExpressionStatement",
  "IfStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
  "WithStatement",
  "SwitchStatement",
  "SwitchCase",
  "ReturnStatement",
  "ThrowStatement",
  "TryStatement",
  "CatchClause",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "Declaration",
  "VariableDeclaration",
  "ForInStatement",
  "DebuggerStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "VariableDeclarator",
  "ThisExpression",
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "Literal",
  "SequenceExpression",
  "UnaryExpression",
  "BinaryExpression",
  "AssignmentExpression",
  "ChainElement",
  "MemberExpression",
  "UpdateExpression",
  "LogicalExpression",
  "ConditionalExpression",
  "NewExpression",
  "CallExpression",
  "RestElement",
  "TypeAnnotation",
  "TSTypeAnnotation",
  "SpreadElementPattern",
  "ArrowFunctionExpression",
  "ForOfStatement",
  "YieldExpression",
  "GeneratorExpression",
  "ComprehensionBlock",
  "ComprehensionExpression",
  "ObjectProperty",
  "PropertyPattern",
  "ObjectPattern",
  "ArrayPattern",
  "SpreadElement",
  "AssignmentPattern",
  "MethodDefinition",
  "ClassPropertyDefinition",
  "ClassProperty",
  "StaticBlock",
  "ClassBody",
  "ClassDeclaration",
  "ClassExpression",
  "Super",
  "Specifier",
  "ModuleSpecifier",
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportSpecifier",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TaggedTemplateExpression",
  "TemplateLiteral",
  "TemplateElement",
  "MetaProperty",
  "AwaitExpression",
  "SpreadProperty",
  "SpreadPropertyPattern",
  "ImportExpression",
  "ChainExpression",
  "OptionalCallExpression",
  "OptionalMemberExpression",
  "Decorator",
  "PrivateName",
  "ClassPrivateProperty",
  "ImportAttribute",
  "RecordExpression",
  "ObjectMethod",
  "TupleExpression",
  "ModuleExpression",
  "JSXAttribute",
  "JSXIdentifier",
  "JSXNamespacedName",
  "JSXExpressionContainer",
  "JSXElement",
  "JSXFragment",
  "JSXMemberExpression",
  "JSXSpreadAttribute",
  "JSXEmptyExpression",
  "JSXText",
  "JSXSpreadChild",
  "JSXOpeningElement",
  "JSXClosingElement",
  "JSXOpeningFragment",
  "JSXClosingFragment",
  "TypeParameterDeclaration",
  "TSTypeParameterDeclaration",
  "TypeParameterInstantiation",
  "TSTypeParameterInstantiation",
  "ClassImplements",
  "TSType",
  "TSHasOptionalTypeParameterInstantiation",
  "TSExpressionWithTypeArguments",
  "Flow",
  "FlowType",
  "AnyTypeAnnotation",
  "EmptyTypeAnnotation",
  "MixedTypeAnnotation",
  "VoidTypeAnnotation",
  "SymbolTypeAnnotation",
  "NumberTypeAnnotation",
  "BigIntTypeAnnotation",
  "NumberLiteralTypeAnnotation",
  "NumericLiteralTypeAnnotation",
  "BigIntLiteralTypeAnnotation",
  "StringTypeAnnotation",
  "StringLiteralTypeAnnotation",
  "BooleanTypeAnnotation",
  "BooleanLiteralTypeAnnotation",
  "NullableTypeAnnotation",
  "NullLiteralTypeAnnotation",
  "NullTypeAnnotation",
  "ThisTypeAnnotation",
  "ExistsTypeAnnotation",
  "ExistentialTypeParam",
  "FunctionTypeAnnotation",
  "FunctionTypeParam",
  "ArrayTypeAnnotation",
  "ObjectTypeAnnotation",
  "ObjectTypeProperty",
  "ObjectTypeSpreadProperty",
  "ObjectTypeIndexer",
  "ObjectTypeCallProperty",
  "ObjectTypeInternalSlot",
  "Variance",
  "QualifiedTypeIdentifier",
  "GenericTypeAnnotation",
  "MemberTypeAnnotation",
  "IndexedAccessType",
  "OptionalIndexedAccessType",
  "UnionTypeAnnotation",
  "IntersectionTypeAnnotation",
  "TypeofTypeAnnotation",
  "TypeParameter",
  "InterfaceTypeAnnotation",
  "InterfaceExtends",
  "InterfaceDeclaration",
  "DeclareInterface",
  "TypeAlias",
  "DeclareTypeAlias",
  "OpaqueType",
  "DeclareOpaqueType",
  "TypeCastExpression",
  "TupleTypeAnnotation",
  "DeclareVariable",
  "DeclareFunction",
  "FlowPredicate",
  "DeclareClass",
  "DeclareModule",
  "DeclareModuleExports",
  "DeclareExportDeclaration",
  "ExportBatchSpecifier",
  "DeclareExportAllDeclaration",
  "InferredPredicate",
  "DeclaredPredicate",
  "EnumDeclaration",
  "EnumBooleanBody",
  "EnumNumberBody",
  "EnumStringBody",
  "EnumSymbolBody",
  "EnumBooleanMember",
  "EnumNumberMember",
  "EnumStringMember",
  "EnumDefaultedMember",
  "ExportDeclaration",
  "Block",
  "Line",
  "Noop",
  "DoExpression",
  "BindExpression",
  "ParenthesizedExpression",
  "ExportNamespaceSpecifier",
  "ExportDefaultSpecifier",
  "CommentBlock",
  "CommentLine",
  "Directive",
  "DirectiveLiteral",
  "InterpreterDirective",
  "StringLiteral",
  "NumericLiteral",
  "BigIntLiteral",
  "DecimalLiteral",
  "NullLiteral",
  "BooleanLiteral",
  "RegExpLiteral",
  "ClassMethod",
  "ClassPrivateMethod",
  "TSHasOptionalTypeAnnotation",
  "ClassAccessorProperty",
  "RestProperty",
  "ForAwaitStatement",
  "Import",
  "V8IntrinsicIdentifier",
  "TopicReference",
  "TSQualifiedName",
  "TSTypeReference",
  "TSHasOptionalTypeParameters",
  "TSAsExpression",
  "TSTypeCastExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSAnyKeyword",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSUndefinedKeyword",
  "TSUnknownKeyword",
  "TSVoidKeyword",
  "TSIntrinsicKeyword",
  "TSThisType",
  "TSArrayType",
  "TSLiteralType",
  "TSUnionType",
  "TSIntersectionType",
  "TSConditionalType",
  "TSInferType",
  "TSTypeParameter",
  "TSParenthesizedType",
  "TSFunctionType",
  "TSConstructorType",
  "TSDeclareFunction",
  "TSDeclareMethod",
  "TSMappedType",
  "TSTupleType",
  "TSNamedTupleMember",
  "TSRestType",
  "TSOptionalType",
  "TSIndexedAccessType",
  "TSTypeOperator",
  "TSIndexSignature",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSTypePredicate",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSEnumMember",
  "TSTypeQuery",
  "TSImportType",
  "TSTypeLiteral",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "TSEnumDeclaration",
  "TSTypeAliasDeclaration",
  "TSModuleBlock",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
  "TSInterfaceBody",
  "TSInterfaceDeclaration",
  "TSParameterProperty"
] satisfies (keyof RuntimeNamedTypes)[];
export function completeNamedTypes(table: Partial<RuntimeNamedTypes>): RuntimeNamedTypes {
  if (!exportsReady(table, namedTypeKeys)) throw new TypeError("Incomplete original ast-types definitions");
  return table;
}
