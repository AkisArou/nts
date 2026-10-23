// Native struct field roles, derived from the pinned native visitor.
// No syntax-kind conversion or encoded AST data is involved.
use super::{Edge, Edges, Node};
use tsrs_ast::NodeData;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChildRole {
    /// one
    QualifiedNameLeft,
    /// one
    QualifiedNameRight,
    /// one
    ComputedPropertyNameExpression,
    /// one
    DecoratorExpression,
    /// one
    IfStatementExpression,
    /// one
    IfStatementThenStatement,
    /// optional
    IfStatementElseStatement,
    /// one
    DoStatementStatement,
    /// one
    DoStatementExpression,
    /// one
    WhileStatementExpression,
    /// one
    WhileStatementStatement,
    /// optional
    ForStatementInitializer,
    /// optional
    ForStatementCondition,
    /// optional
    ForStatementIncrementor,
    /// one
    ForStatementStatement,
    /// optional
    ForInOrOfStatementAwaitModifier,
    /// one
    ForInOrOfStatementInitializer,
    /// one
    ForInOrOfStatementExpression,
    /// one
    ForInOrOfStatementStatement,
    /// optional
    BreakStatementLabel,
    /// optional
    ContinueStatementLabel,
    /// optional
    ReturnStatementExpression,
    /// one
    WithStatementExpression,
    /// one
    WithStatementStatement,
    /// one
    SwitchStatementExpression,
    /// one
    SwitchStatementCaseBlock,
    /// optional
    CaseOrDefaultClauseExpression,
    /// one
    ThrowStatementExpression,
    /// one
    TryStatementTryBlock,
    /// optional
    TryStatementCatchClause,
    /// optional
    TryStatementFinallyBlock,
    /// optional
    CatchClauseVariableDeclaration,
    /// one
    CatchClauseBlock,
    /// one
    LabeledStatementLabel,
    /// one
    LabeledStatementStatement,
    /// one
    ExpressionStatementExpression,
    /// one
    VariableStatementDeclarationList,
    /// one
    VariableDeclarationName,
    /// optional
    VariableDeclarationExclamationToken,
    /// optional
    VariableDeclarationType,
    /// optional
    VariableDeclarationInitializer,
    /// optional
    ParameterDeclarationDotDotDotToken,
    /// one
    ParameterDeclarationName,
    /// optional
    ParameterDeclarationQuestionToken,
    /// optional
    ParameterDeclarationType,
    /// optional
    ParameterDeclarationInitializer,
    /// optional
    BindingElementDotDotDotToken,
    /// optional
    BindingElementPropertyName,
    /// optional
    BindingElementName,
    /// optional
    BindingElementInitializer,
    /// optional
    FunctionDeclarationAsteriskToken,
    /// optional
    FunctionDeclarationName,
    /// optional
    FunctionDeclarationType,
    /// optional
    FunctionDeclarationFullSignature,
    /// optional
    FunctionDeclarationBody,
    /// optional
    ClassDeclarationName,
    /// optional
    ClassExpressionName,
    /// one
    InterfaceDeclarationName,
    /// one
    TypeAliasDeclarationName,
    /// optional
    TypeAliasDeclarationType,
    /// one
    EnumMemberName,
    /// optional
    EnumMemberInitializer,
    /// one
    EnumDeclarationName,
    /// optional
    ImportDeclarationImportClause,
    /// one
    ImportDeclarationModuleSpecifier,
    /// optional
    ImportDeclarationAttributes,
    /// one
    ExternalModuleReferenceExpression,
    /// one
    NamespaceImportName,
    /// optional
    ExportAssignmentType,
    /// one
    ExportAssignmentExpression,
    /// one
    NamespaceExportDeclarationName,
    /// one
    NamespaceExportName,
    /// optional
    ExportSpecifierPropertyName,
    /// one
    ExportSpecifierName,
    /// optional
    CallSignatureDeclarationType,
    /// optional
    ConstructSignatureDeclarationType,
    /// optional
    ConstructorDeclarationType,
    /// optional
    ConstructorDeclarationFullSignature,
    /// optional
    ConstructorDeclarationBody,
    /// one
    GetAccessorDeclarationName,
    /// optional
    GetAccessorDeclarationType,
    /// optional
    GetAccessorDeclarationFullSignature,
    /// optional
    GetAccessorDeclarationBody,
    /// one
    SetAccessorDeclarationName,
    /// optional
    SetAccessorDeclarationType,
    /// optional
    SetAccessorDeclarationFullSignature,
    /// optional
    SetAccessorDeclarationBody,
    /// optional
    IndexSignatureDeclarationType,
    /// one
    MethodSignatureDeclarationName,
    /// optional
    MethodSignatureDeclarationPostfixToken,
    /// optional
    MethodSignatureDeclarationType,
    /// optional
    MethodDeclarationAsteriskToken,
    /// one
    MethodDeclarationName,
    /// optional
    MethodDeclarationPostfixToken,
    /// optional
    MethodDeclarationType,
    /// optional
    MethodDeclarationFullSignature,
    /// optional
    MethodDeclarationBody,
    /// one
    PropertySignatureDeclarationName,
    /// optional
    PropertySignatureDeclarationPostfixToken,
    /// optional
    PropertySignatureDeclarationType,
    /// optional
    PropertySignatureDeclarationInitializer,
    /// one
    PropertyDeclarationName,
    /// optional
    PropertyDeclarationPostfixToken,
    /// optional
    PropertyDeclarationType,
    /// optional
    PropertyDeclarationInitializer,
    /// one
    ClassStaticBlockDeclarationBody,
    /// one
    BinaryExpressionLeft,
    /// optional
    BinaryExpressionType,
    /// one
    BinaryExpressionOperatorToken,
    /// one
    BinaryExpressionRight,
    /// one
    PrefixUnaryExpressionOperand,
    /// one
    PostfixUnaryExpressionOperand,
    /// optional
    YieldExpressionAsteriskToken,
    /// optional
    YieldExpressionExpression,
    /// optional
    ArrowFunctionType,
    /// optional
    ArrowFunctionFullSignature,
    /// optional
    ArrowFunctionEqualsGreaterThanToken,
    /// optional
    ArrowFunctionBody,
    /// optional
    FunctionExpressionAsteriskToken,
    /// optional
    FunctionExpressionName,
    /// optional
    FunctionExpressionType,
    /// optional
    FunctionExpressionFullSignature,
    /// optional
    FunctionExpressionBody,
    /// one
    AsExpressionExpression,
    /// one
    AsExpressionType,
    /// one
    SatisfiesExpressionExpression,
    /// one
    SatisfiesExpressionType,
    /// one
    ConditionalExpressionCondition,
    /// one
    ConditionalExpressionQuestionToken,
    /// one
    ConditionalExpressionWhenTrue,
    /// one
    ConditionalExpressionColonToken,
    /// one
    ConditionalExpressionWhenFalse,
    /// one
    PropertyAccessExpressionExpression,
    /// optional
    PropertyAccessExpressionQuestionDotToken,
    /// one
    PropertyAccessExpressionName,
    /// one
    ElementAccessExpressionExpression,
    /// optional
    ElementAccessExpressionQuestionDotToken,
    /// one
    ElementAccessExpressionArgumentExpression,
    /// one
    CallExpressionExpression,
    /// optional
    CallExpressionQuestionDotToken,
    /// one
    NewExpressionExpression,
    /// one
    MetaPropertyName,
    /// one
    NonNullExpressionExpression,
    /// one
    SpreadElementExpression,
    /// one
    TemplateExpressionHead,
    /// one
    TemplateSpanExpression,
    /// one
    TemplateSpanLiteral,
    /// one
    TaggedTemplateExpressionTag,
    /// optional
    TaggedTemplateExpressionQuestionDotToken,
    /// one
    TaggedTemplateExpressionTemplate,
    /// one
    ParenthesizedExpressionExpression,
    /// one
    SpreadAssignmentExpression,
    /// one
    PropertyAssignmentName,
    /// optional
    PropertyAssignmentPostfixToken,
    /// optional
    PropertyAssignmentType,
    /// one
    PropertyAssignmentInitializer,
    /// one
    ShorthandPropertyAssignmentName,
    /// optional
    ShorthandPropertyAssignmentPostfixToken,
    /// optional
    ShorthandPropertyAssignmentType,
    /// optional
    ShorthandPropertyAssignmentEqualsToken,
    /// optional
    ShorthandPropertyAssignmentObjectAssignmentInitializer,
    /// one
    DeleteExpressionExpression,
    /// one
    TypeOfExpressionExpression,
    /// one
    VoidExpressionExpression,
    /// one
    AwaitExpressionExpression,
    /// one
    TypeAssertionType,
    /// one
    TypeAssertionExpression,
    /// one
    ConditionalTypeNodeCheckType,
    /// one
    ConditionalTypeNodeExtendsType,
    /// one
    ConditionalTypeNodeTrueType,
    /// one
    ConditionalTypeNodeFalseType,
    /// one
    TypeOperatorNodeType,
    /// one
    InferTypeNodeTypeParameter,
    /// one
    ArrayTypeNodeElementType,
    /// one
    IndexedAccessTypeNodeObjectType,
    /// one
    IndexedAccessTypeNodeIndexType,
    /// one
    TypeReferenceNodeTypeName,
    /// one
    ExpressionWithTypeArgumentsExpression,
    /// one
    LiteralTypeNodeLiteral,
    /// optional
    TypePredicateNodeAssertsModifier,
    /// one
    TypePredicateNodeParameterName,
    /// optional
    TypePredicateNodeType,
    /// optional
    ImportAttributeName,
    /// one
    ImportAttributeValue,
    /// one
    TypeQueryNodeExprName,
    /// optional
    MappedTypeNodeReadonlyToken,
    /// one
    MappedTypeNodeTypeParameter,
    /// optional
    MappedTypeNodeNameType,
    /// optional
    MappedTypeNodeQuestionToken,
    /// optional
    MappedTypeNodeType,
    /// optional
    NamedTupleMemberDotDotDotToken,
    /// one
    NamedTupleMemberName,
    /// optional
    NamedTupleMemberQuestionToken,
    /// one
    NamedTupleMemberType,
    /// one
    OptionalTypeNodeType,
    /// one
    RestTypeNodeType,
    /// one
    ParenthesizedTypeNodeType,
    /// optional
    FunctionTypeNodeType,
    /// optional
    ConstructorTypeNodeType,
    /// one
    TemplateLiteralTypeNodeHead,
    /// one
    TemplateLiteralTypeSpanType,
    /// one
    TemplateLiteralTypeSpanLiteral,
    /// optional
    SyntheticExpressionTupleNameSource,
    /// one
    PartiallyEmittedExpressionExpression,
    /// one
    JsxElementOpeningElement,
    /// one
    JsxElementClosingElement,
    /// one
    JsxNamespacedNameNamespace,
    /// one
    JsxNamespacedNameName,
    /// one
    JsxOpeningElementTagName,
    /// one
    JsxOpeningElementAttributes,
    /// one
    JsxSelfClosingElementTagName,
    /// one
    JsxSelfClosingElementAttributes,
    /// one
    JsxFragmentOpeningFragment,
    /// one
    JsxFragmentClosingFragment,
    /// one
    JsxAttributeName,
    /// optional
    JsxAttributeInitializer,
    /// one
    JsxSpreadAttributeExpression,
    /// one
    JsxClosingElementTagName,
    /// optional
    JsxExpressionDotDotDotToken,
    /// optional
    JsxExpressionExpression,
    /// one
    JSDocTypeExpressionType,
    /// one
    JSDocNonNullableTypeType,
    /// one
    JSDocNullableTypeType,
    /// one
    JSDocVariadicTypeType,
    /// one
    JSDocOptionalTypeType,
    /// one
    JSDocTypeTagTagName,
    /// one
    JSDocTypeTagTypeExpression,
    /// one
    JSDocUnknownTagTagName,
    /// one
    JSDocTemplateTagTagName,
    /// optional
    JSDocTemplateTagConstraint,
    /// one
    JSDocReturnTagTagName,
    /// optional
    JSDocReturnTagTypeExpression,
    /// one
    JSDocPublicTagTagName,
    /// one
    JSDocPrivateTagTagName,
    /// one
    JSDocProtectedTagTagName,
    /// one
    JSDocReadonlyTagTagName,
    /// one
    JSDocOverrideTagTagName,
    /// one
    JSDocDeprecatedTagTagName,
    /// one
    JSDocSeeTagTagName,
    /// optional
    JSDocSeeTagNameExpression,
    /// one
    JSDocImplementsTagTagName,
    /// one
    JSDocImplementsTagClassName,
    /// one
    JSDocAugmentsTagTagName,
    /// one
    JSDocAugmentsTagClassName,
    /// one
    JSDocSatisfiesTagTagName,
    /// one
    JSDocSatisfiesTagTypeExpression,
    /// one
    JSDocThrowsTagTagName,
    /// optional
    JSDocThrowsTagTypeExpression,
    /// one
    JSDocThisTagTagName,
    /// one
    JSDocThisTagTypeExpression,
    /// one
    JSDocImportTagTagName,
    /// optional
    JSDocImportTagImportClause,
    /// one
    JSDocImportTagModuleSpecifier,
    /// optional
    JSDocImportTagAttributes,
    /// one
    JSDocCallbackTagTagName,
    /// one
    JSDocCallbackTagTypeExpression,
    /// optional
    JSDocCallbackTagName,
    /// one
    JSDocOverloadTagTagName,
    /// one
    JSDocOverloadTagTypeExpression,
    /// one
    JSDocTypedefTagTagName,
    /// optional
    JSDocTypedefTagTypeExpression,
    /// optional
    JSDocTypedefTagName,
    /// optional
    JSDocSignatureType,
    /// one
    JSDocNameReferenceName,
    /// one
    ModuleDeclarationName,
    /// optional
    ModuleDeclarationAttributes,
    /// optional
    ModuleDeclarationBody,
    /// one
    ImportEqualsDeclarationName,
    /// one
    ImportEqualsDeclarationModuleReference,
    /// optional
    ExportDeclarationExportClause,
    /// optional
    ExportDeclarationModuleSpecifier,
    /// optional
    ExportDeclarationAttributes,
    /// one
    ImportTypeNodeArgument,
    /// optional
    ImportTypeNodeAttributes,
    /// optional
    ImportTypeNodeQualifier,
    /// optional
    ImportClauseName,
    /// optional
    ImportClauseNamedBindings,
    /// optional
    ImportSpecifierPropertyName,
    /// one
    ImportSpecifierName,
    /// optional
    JSDocLinkName,
    /// optional
    JSDocLinkPlainName,
    /// optional
    JSDocLinkCodeName,
    /// one
    TypeParameterDeclarationName,
    /// optional
    TypeParameterDeclarationConstraint,
    /// optional
    TypeParameterDeclarationExpression,
    /// optional
    TypeParameterDeclarationDefaultType,
    /// one
    SyntheticReferenceExpressionExpression,
    /// one
    SyntheticReferenceExpressionThisArg,
    /// one
    JSDocParameterOrPropertyTagTagName,
    /// one
    JSDocParameterOrPropertyTagName,
    /// optional
    JSDocParameterOrPropertyTagTypeExpression,
    /// one
    SourceFileEndOfFileToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ListRole {
    /// list
    CaseBlockClauses,
    /// list
    CaseOrDefaultClauseStatements,
    /// list
    BlockStatements,
    /// optional-list
    VariableStatementModifiers,
    /// list
    VariableDeclarationListDeclarations,
    /// list
    BindingPatternElements,
    /// optional-list
    ParameterDeclarationModifiers,
    /// optional-list
    MissingDeclarationModifiers,
    /// optional-list
    FunctionDeclarationModifiers,
    /// optional-list
    FunctionDeclarationTypeParameters,
    /// optional-list
    FunctionDeclarationParameters,
    /// optional-list
    ClassDeclarationModifiers,
    /// optional-list
    ClassDeclarationTypeParameters,
    /// optional-list
    ClassDeclarationHeritageClauses,
    /// list
    ClassDeclarationMembers,
    /// optional-list
    ClassExpressionModifiers,
    /// optional-list
    ClassExpressionTypeParameters,
    /// optional-list
    ClassExpressionHeritageClauses,
    /// list
    ClassExpressionMembers,
    /// list
    HeritageClauseTypes,
    /// optional-list
    InterfaceDeclarationModifiers,
    /// optional-list
    InterfaceDeclarationTypeParameters,
    /// optional-list
    InterfaceDeclarationHeritageClauses,
    /// list
    InterfaceDeclarationMembers,
    /// optional-list
    TypeAliasDeclarationModifiers,
    /// optional-list
    TypeAliasDeclarationTypeParameters,
    /// optional-list
    EnumDeclarationModifiers,
    /// list
    EnumDeclarationMembers,
    /// list
    ModuleBlockStatements,
    /// optional-list
    ImportDeclarationModifiers,
    /// list
    NamedImportsElements,
    /// optional-list
    ExportAssignmentModifiers,
    /// optional-list
    NamespaceExportDeclarationModifiers,
    /// list
    NamedExportsElements,
    /// optional-list
    CallSignatureDeclarationTypeParameters,
    /// optional-list
    CallSignatureDeclarationParameters,
    /// optional-list
    ConstructSignatureDeclarationTypeParameters,
    /// optional-list
    ConstructSignatureDeclarationParameters,
    /// optional-list
    ConstructorDeclarationModifiers,
    /// optional-list
    ConstructorDeclarationTypeParameters,
    /// optional-list
    ConstructorDeclarationParameters,
    /// optional-list
    GetAccessorDeclarationModifiers,
    /// optional-list
    GetAccessorDeclarationTypeParameters,
    /// optional-list
    GetAccessorDeclarationParameters,
    /// optional-list
    SetAccessorDeclarationModifiers,
    /// optional-list
    SetAccessorDeclarationTypeParameters,
    /// optional-list
    SetAccessorDeclarationParameters,
    /// optional-list
    IndexSignatureDeclarationModifiers,
    /// optional-list
    IndexSignatureDeclarationParameters,
    /// optional-list
    MethodSignatureDeclarationModifiers,
    /// optional-list
    MethodSignatureDeclarationTypeParameters,
    /// optional-list
    MethodSignatureDeclarationParameters,
    /// optional-list
    MethodDeclarationModifiers,
    /// optional-list
    MethodDeclarationTypeParameters,
    /// optional-list
    MethodDeclarationParameters,
    /// optional-list
    PropertySignatureDeclarationModifiers,
    /// optional-list
    PropertyDeclarationModifiers,
    /// optional-list
    ClassStaticBlockDeclarationModifiers,
    /// optional-list
    BinaryExpressionModifiers,
    /// optional-list
    ArrowFunctionModifiers,
    /// optional-list
    ArrowFunctionTypeParameters,
    /// optional-list
    ArrowFunctionParameters,
    /// optional-list
    FunctionExpressionModifiers,
    /// optional-list
    FunctionExpressionTypeParameters,
    /// optional-list
    FunctionExpressionParameters,
    /// optional-list
    CallExpressionTypeArguments,
    /// list
    CallExpressionArguments,
    /// optional-list
    NewExpressionTypeArguments,
    /// optional-list
    NewExpressionArguments,
    /// list
    TemplateExpressionTemplateSpans,
    /// optional-list
    TaggedTemplateExpressionTypeArguments,
    /// list
    ArrayLiteralExpressionElements,
    /// list
    ObjectLiteralExpressionProperties,
    /// optional-list
    PropertyAssignmentModifiers,
    /// optional-list
    ShorthandPropertyAssignmentModifiers,
    /// list
    UnionTypeNodeTypes,
    /// list
    IntersectionTypeNodeTypes,
    /// optional-list
    TypeReferenceNodeTypeArguments,
    /// optional-list
    ExpressionWithTypeArgumentsTypeArguments,
    /// list
    ImportAttributesAttributes,
    /// optional-list
    TypeQueryNodeTypeArguments,
    /// optional-list
    MappedTypeNodeMembers,
    /// list
    TypeLiteralNodeMembers,
    /// list
    TupleTypeNodeElements,
    /// optional-list
    FunctionTypeNodeTypeParameters,
    /// optional-list
    FunctionTypeNodeParameters,
    /// optional-list
    ConstructorTypeNodeModifiers,
    /// optional-list
    ConstructorTypeNodeTypeParameters,
    /// optional-list
    ConstructorTypeNodeParameters,
    /// list
    TemplateLiteralTypeNodeTemplateSpans,
    /// list
    JsxElementChildren,
    /// list
    JsxAttributesProperties,
    /// optional-list
    JsxOpeningElementTypeArguments,
    /// optional-list
    JsxSelfClosingElementTypeArguments,
    /// list
    JsxFragmentChildren,
    /// list
    SyntaxListChildren,
    /// list
    JSDocComment,
    /// optional-list
    JSDocTags,
    /// optional-list
    JSDocTypeTagComment,
    /// optional-list
    JSDocUnknownTagComment,
    /// list
    JSDocTemplateTagTypeParameters,
    /// optional-list
    JSDocTemplateTagComment,
    /// optional-list
    JSDocReturnTagComment,
    /// optional-list
    JSDocPublicTagComment,
    /// optional-list
    JSDocPrivateTagComment,
    /// optional-list
    JSDocProtectedTagComment,
    /// optional-list
    JSDocReadonlyTagComment,
    /// optional-list
    JSDocOverrideTagComment,
    /// optional-list
    JSDocDeprecatedTagComment,
    /// optional-list
    JSDocSeeTagComment,
    /// optional-list
    JSDocImplementsTagComment,
    /// optional-list
    JSDocAugmentsTagComment,
    /// optional-list
    JSDocSatisfiesTagComment,
    /// optional-list
    JSDocThrowsTagComment,
    /// optional-list
    JSDocThisTagComment,
    /// optional-list
    JSDocImportTagComment,
    /// optional-list
    JSDocCallbackTagComment,
    /// optional-list
    JSDocOverloadTagComment,
    /// optional-list
    JSDocTypedefTagComment,
    /// optional-list
    JSDocSignatureTypeParameters,
    /// optional-list
    JSDocSignatureParameters,
    /// optional-list
    ModuleDeclarationModifiers,
    /// optional-list
    ImportEqualsDeclarationModifiers,
    /// optional-list
    ExportDeclarationModifiers,
    /// optional-list
    ImportTypeNodeTypeArguments,
    /// optional-list
    TypeParameterDeclarationModifiers,
    /// list
    JSDocTypeLiteralJsdocPropertyTags,
    /// optional-list
    JSDocParameterOrPropertyTagComment,
    /// list
    SourceFileStatements,
}

#[expect(
    clippy::too_many_lines,
    clippy::match_same_arms,
    reason = "mechanical exhaustive native-node dispatch retains one arm per upstream payload"
)]
pub(super) fn edges<S: crate::ViewPhase>(node: Node<'_, S>) -> Vec<Edge<'_, S>> {
    let mut edges = Edges::new(node);
    match node.native.data() {
        NodeData::Token => {}
        NodeData::Identifier(_data) => {}
        NodeData::PrivateIdentifier(_data) => {}
        NodeData::QualifiedName(data) => {
            edges.child(ChildRole::QualifiedNameLeft, data.left());
            edges.child(ChildRole::QualifiedNameRight, data.right());
        }
        NodeData::ComputedPropertyName(data) => {
            edges.child(ChildRole::ComputedPropertyNameExpression, data.expression());
        }
        NodeData::Decorator(data) => {
            edges.child(ChildRole::DecoratorExpression, data.expression());
        }
        NodeData::EmptyStatement(_data) => {}
        NodeData::IfStatement(data) => {
            edges.child(ChildRole::IfStatementExpression, data.expression());
            edges.child(ChildRole::IfStatementThenStatement, data.then_statement());
            edges.child(ChildRole::IfStatementElseStatement, data.else_statement());
        }
        NodeData::DoStatement(data) => {
            edges.child(ChildRole::DoStatementStatement, data.statement());
            edges.child(ChildRole::DoStatementExpression, data.expression());
        }
        NodeData::WhileStatement(data) => {
            edges.child(ChildRole::WhileStatementExpression, data.expression());
            edges.child(ChildRole::WhileStatementStatement, data.statement());
        }
        NodeData::ForStatement(data) => {
            edges.child(ChildRole::ForStatementInitializer, data.initializer());
            edges.child(ChildRole::ForStatementCondition, data.condition());
            edges.child(ChildRole::ForStatementIncrementor, data.incrementor());
            edges.child(ChildRole::ForStatementStatement, data.statement());
        }
        NodeData::ForInOrOfStatement(data) => {
            edges.child(
                ChildRole::ForInOrOfStatementAwaitModifier,
                data.await_modifier(),
            );
            edges.child(ChildRole::ForInOrOfStatementInitializer, data.initializer());
            edges.child(ChildRole::ForInOrOfStatementExpression, data.expression());
            edges.child(ChildRole::ForInOrOfStatementStatement, data.statement());
        }
        NodeData::BreakStatement(data) => {
            edges.child(ChildRole::BreakStatementLabel, data.label());
        }
        NodeData::ContinueStatement(data) => {
            edges.child(ChildRole::ContinueStatementLabel, data.label());
        }
        NodeData::ReturnStatement(data) => {
            edges.child(ChildRole::ReturnStatementExpression, data.expression());
        }
        NodeData::WithStatement(data) => {
            edges.child(ChildRole::WithStatementExpression, data.expression());
            edges.child(ChildRole::WithStatementStatement, data.statement());
        }
        NodeData::SwitchStatement(data) => {
            edges.child(ChildRole::SwitchStatementExpression, data.expression());
            edges.child(ChildRole::SwitchStatementCaseBlock, data.case_block());
        }
        NodeData::CaseBlock(data) => {
            edges.list(ListRole::CaseBlockClauses, data.clauses());
        }
        NodeData::CaseOrDefaultClause(data) => {
            edges.child(ChildRole::CaseOrDefaultClauseExpression, data.expression());
            edges.list(ListRole::CaseOrDefaultClauseStatements, data.statements());
        }
        NodeData::ThrowStatement(data) => {
            edges.child(ChildRole::ThrowStatementExpression, data.expression());
        }
        NodeData::TryStatement(data) => {
            edges.child(ChildRole::TryStatementTryBlock, data.try_block());
            edges.child(ChildRole::TryStatementCatchClause, data.catch_clause());
            edges.child(ChildRole::TryStatementFinallyBlock, data.finally_block());
        }
        NodeData::CatchClause(data) => {
            edges.child(
                ChildRole::CatchClauseVariableDeclaration,
                data.variable_declaration(),
            );
            edges.child(ChildRole::CatchClauseBlock, data.block());
        }
        NodeData::DebuggerStatement(_data) => {}
        NodeData::LabeledStatement(data) => {
            edges.child(ChildRole::LabeledStatementLabel, data.label());
            edges.child(ChildRole::LabeledStatementStatement, data.statement());
        }
        NodeData::ExpressionStatement(data) => {
            edges.child(ChildRole::ExpressionStatementExpression, data.expression());
        }
        NodeData::Block(data) => {
            edges.list(ListRole::BlockStatements, data.statements());
        }
        NodeData::VariableStatement(data) => {
            edges.modifiers(ListRole::VariableStatementModifiers, data.modifiers());
            edges.child(
                ChildRole::VariableStatementDeclarationList,
                data.declaration_list(),
            );
        }
        NodeData::VariableDeclaration(data) => {
            edges.child(ChildRole::VariableDeclarationName, data.name());
            edges.child(
                ChildRole::VariableDeclarationExclamationToken,
                data.exclamation_token(),
            );
            edges.child(ChildRole::VariableDeclarationType, data.type_());
            edges.child(
                ChildRole::VariableDeclarationInitializer,
                data.initializer(),
            );
        }
        NodeData::VariableDeclarationList(data) => {
            edges.list(
                ListRole::VariableDeclarationListDeclarations,
                data.declarations(),
            );
        }
        NodeData::BindingPattern(data) => {
            edges.list(ListRole::BindingPatternElements, data.elements());
        }
        NodeData::ParameterDeclaration(data) => {
            edges.modifiers(ListRole::ParameterDeclarationModifiers, data.modifiers());
            edges.child(
                ChildRole::ParameterDeclarationDotDotDotToken,
                data.dot_dot_dot_token(),
            );
            edges.child(ChildRole::ParameterDeclarationName, data.name());
            edges.child(
                ChildRole::ParameterDeclarationQuestionToken,
                data.question_token(),
            );
            edges.child(ChildRole::ParameterDeclarationType, data.type_());
            edges.child(
                ChildRole::ParameterDeclarationInitializer,
                data.initializer(),
            );
        }
        NodeData::BindingElement(data) => {
            edges.child(
                ChildRole::BindingElementDotDotDotToken,
                data.dot_dot_dot_token(),
            );
            edges.child(ChildRole::BindingElementPropertyName, data.property_name());
            edges.child(ChildRole::BindingElementName, data.name());
            edges.child(ChildRole::BindingElementInitializer, data.initializer());
        }
        NodeData::MissingDeclaration(data) => {
            edges.modifiers(ListRole::MissingDeclarationModifiers, data.modifiers());
        }
        NodeData::FunctionDeclaration(data) => {
            edges.modifiers(ListRole::FunctionDeclarationModifiers, data.modifiers());
            edges.child(
                ChildRole::FunctionDeclarationAsteriskToken,
                data.asterisk_token(),
            );
            edges.child(ChildRole::FunctionDeclarationName, data.name());
            edges.list(
                ListRole::FunctionDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::FunctionDeclarationParameters, data.parameters());
            edges.child(ChildRole::FunctionDeclarationType, data.type_());
            edges.child(
                ChildRole::FunctionDeclarationFullSignature,
                data.full_signature(),
            );
            edges.child(ChildRole::FunctionDeclarationBody, data.body());
        }
        NodeData::ClassDeclaration(data) => {
            edges.modifiers(ListRole::ClassDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::ClassDeclarationName, data.name());
            edges.list(
                ListRole::ClassDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::ClassDeclarationHeritageClauses,
                data.heritage_clauses(),
            );
            edges.list(ListRole::ClassDeclarationMembers, data.members());
        }
        NodeData::ClassExpression(data) => {
            edges.modifiers(ListRole::ClassExpressionModifiers, data.modifiers());
            edges.child(ChildRole::ClassExpressionName, data.name());
            edges.list(
                ListRole::ClassExpressionTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::ClassExpressionHeritageClauses,
                data.heritage_clauses(),
            );
            edges.list(ListRole::ClassExpressionMembers, data.members());
        }
        NodeData::HeritageClause(data) => {
            edges.list(ListRole::HeritageClauseTypes, data.types());
        }
        NodeData::InterfaceDeclaration(data) => {
            edges.modifiers(ListRole::InterfaceDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::InterfaceDeclarationName, data.name());
            edges.list(
                ListRole::InterfaceDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::InterfaceDeclarationHeritageClauses,
                data.heritage_clauses(),
            );
            edges.list(ListRole::InterfaceDeclarationMembers, data.members());
        }
        NodeData::TypeAliasDeclaration(data) => {
            edges.modifiers(ListRole::TypeAliasDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::TypeAliasDeclarationName, data.name());
            edges.list(
                ListRole::TypeAliasDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.child(ChildRole::TypeAliasDeclarationType, data.type_());
        }
        NodeData::EnumMember(data) => {
            edges.child(ChildRole::EnumMemberName, data.name());
            edges.child(ChildRole::EnumMemberInitializer, data.initializer());
        }
        NodeData::EnumDeclaration(data) => {
            edges.modifiers(ListRole::EnumDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::EnumDeclarationName, data.name());
            edges.list(ListRole::EnumDeclarationMembers, data.members());
        }
        NodeData::ModuleBlock(data) => {
            edges.list(ListRole::ModuleBlockStatements, data.statements());
        }
        NodeData::NotEmittedStatement(_data) => {}
        NodeData::NotEmittedTypeElement(_data) => {}
        NodeData::ImportDeclaration(data) => {
            edges.modifiers(ListRole::ImportDeclarationModifiers, data.modifiers());
            edges.child(
                ChildRole::ImportDeclarationImportClause,
                data.import_clause(),
            );
            edges.child(
                ChildRole::ImportDeclarationModuleSpecifier,
                data.module_specifier(),
            );
            edges.child(ChildRole::ImportDeclarationAttributes, data.attributes());
        }
        NodeData::ExternalModuleReference(data) => {
            edges.child(
                ChildRole::ExternalModuleReferenceExpression,
                data.expression(),
            );
        }
        NodeData::NamespaceImport(data) => {
            edges.child(ChildRole::NamespaceImportName, data.name());
        }
        NodeData::NamedImports(data) => {
            edges.list(ListRole::NamedImportsElements, data.elements());
        }
        NodeData::ExportAssignment(data) => {
            edges.modifiers(ListRole::ExportAssignmentModifiers, data.modifiers());
            edges.child(ChildRole::ExportAssignmentType, data.type_());
            edges.child(ChildRole::ExportAssignmentExpression, data.expression());
        }
        NodeData::NamespaceExportDeclaration(data) => {
            edges.modifiers(
                ListRole::NamespaceExportDeclarationModifiers,
                data.modifiers(),
            );
            edges.child(ChildRole::NamespaceExportDeclarationName, data.name());
        }
        NodeData::NamespaceExport(data) => {
            edges.child(ChildRole::NamespaceExportName, data.name());
        }
        NodeData::NamedExports(data) => {
            edges.list(ListRole::NamedExportsElements, data.elements());
        }
        NodeData::ExportSpecifier(data) => {
            edges.child(ChildRole::ExportSpecifierPropertyName, data.property_name());
            edges.child(ChildRole::ExportSpecifierName, data.name());
        }
        NodeData::CallSignatureDeclaration(data) => {
            edges.list(
                ListRole::CallSignatureDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::CallSignatureDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::CallSignatureDeclarationType, data.type_());
        }
        NodeData::ConstructSignatureDeclaration(data) => {
            edges.list(
                ListRole::ConstructSignatureDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::ConstructSignatureDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::ConstructSignatureDeclarationType, data.type_());
        }
        NodeData::ConstructorDeclaration(data) => {
            edges.modifiers(ListRole::ConstructorDeclarationModifiers, data.modifiers());
            edges.list(
                ListRole::ConstructorDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::ConstructorDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::ConstructorDeclarationType, data.type_());
            edges.child(
                ChildRole::ConstructorDeclarationFullSignature,
                data.full_signature(),
            );
            edges.child(ChildRole::ConstructorDeclarationBody, data.body());
        }
        NodeData::GetAccessorDeclaration(data) => {
            edges.modifiers(ListRole::GetAccessorDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::GetAccessorDeclarationName, data.name());
            edges.list(
                ListRole::GetAccessorDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::GetAccessorDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::GetAccessorDeclarationType, data.type_());
            edges.child(
                ChildRole::GetAccessorDeclarationFullSignature,
                data.full_signature(),
            );
            edges.child(ChildRole::GetAccessorDeclarationBody, data.body());
        }
        NodeData::SetAccessorDeclaration(data) => {
            edges.modifiers(ListRole::SetAccessorDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::SetAccessorDeclarationName, data.name());
            edges.list(
                ListRole::SetAccessorDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::SetAccessorDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::SetAccessorDeclarationType, data.type_());
            edges.child(
                ChildRole::SetAccessorDeclarationFullSignature,
                data.full_signature(),
            );
            edges.child(ChildRole::SetAccessorDeclarationBody, data.body());
        }
        NodeData::IndexSignatureDeclaration(data) => {
            edges.modifiers(
                ListRole::IndexSignatureDeclarationModifiers,
                data.modifiers(),
            );
            edges.list(
                ListRole::IndexSignatureDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::IndexSignatureDeclarationType, data.type_());
        }
        NodeData::MethodSignatureDeclaration(data) => {
            edges.modifiers(
                ListRole::MethodSignatureDeclarationModifiers,
                data.modifiers(),
            );
            edges.child(ChildRole::MethodSignatureDeclarationName, data.name());
            edges.child(
                ChildRole::MethodSignatureDeclarationPostfixToken,
                data.postfix_token(),
            );
            edges.list(
                ListRole::MethodSignatureDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(
                ListRole::MethodSignatureDeclarationParameters,
                data.parameters(),
            );
            edges.child(ChildRole::MethodSignatureDeclarationType, data.type_());
        }
        NodeData::MethodDeclaration(data) => {
            edges.modifiers(ListRole::MethodDeclarationModifiers, data.modifiers());
            edges.child(
                ChildRole::MethodDeclarationAsteriskToken,
                data.asterisk_token(),
            );
            edges.child(ChildRole::MethodDeclarationName, data.name());
            edges.child(
                ChildRole::MethodDeclarationPostfixToken,
                data.postfix_token(),
            );
            edges.list(
                ListRole::MethodDeclarationTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::MethodDeclarationParameters, data.parameters());
            edges.child(ChildRole::MethodDeclarationType, data.type_());
            edges.child(
                ChildRole::MethodDeclarationFullSignature,
                data.full_signature(),
            );
            edges.child(ChildRole::MethodDeclarationBody, data.body());
        }
        NodeData::PropertySignatureDeclaration(data) => {
            edges.modifiers(
                ListRole::PropertySignatureDeclarationModifiers,
                data.modifiers(),
            );
            edges.child(ChildRole::PropertySignatureDeclarationName, data.name());
            edges.child(
                ChildRole::PropertySignatureDeclarationPostfixToken,
                data.postfix_token(),
            );
            edges.child(ChildRole::PropertySignatureDeclarationType, data.type_());
            edges.child(
                ChildRole::PropertySignatureDeclarationInitializer,
                data.initializer(),
            );
        }
        NodeData::PropertyDeclaration(data) => {
            edges.modifiers(ListRole::PropertyDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::PropertyDeclarationName, data.name());
            edges.child(
                ChildRole::PropertyDeclarationPostfixToken,
                data.postfix_token(),
            );
            edges.child(ChildRole::PropertyDeclarationType, data.type_());
            edges.child(
                ChildRole::PropertyDeclarationInitializer,
                data.initializer(),
            );
        }
        NodeData::SemicolonClassElement(_data) => {}
        NodeData::ClassStaticBlockDeclaration(data) => {
            edges.modifiers(
                ListRole::ClassStaticBlockDeclarationModifiers,
                data.modifiers(),
            );
            edges.child(ChildRole::ClassStaticBlockDeclarationBody, data.body());
        }
        NodeData::OmittedExpression => {}
        NodeData::KeywordExpression(_data) => {}
        NodeData::StringLiteral(_data) => {}
        NodeData::NumericLiteral(_data) => {}
        NodeData::BigIntLiteral(_data) => {}
        NodeData::RegularExpressionLiteral(_data) => {}
        NodeData::NoSubstitutionTemplateLiteral(_data) => {}
        NodeData::BinaryExpression(data) => {
            edges.modifiers(ListRole::BinaryExpressionModifiers, data.modifiers());
            edges.child(ChildRole::BinaryExpressionLeft, data.left());
            edges.child(ChildRole::BinaryExpressionType, data.type_());
            edges.child(
                ChildRole::BinaryExpressionOperatorToken,
                data.operator_token(),
            );
            edges.child(ChildRole::BinaryExpressionRight, data.right());
        }
        NodeData::PrefixUnaryExpression(data) => {
            edges.child(ChildRole::PrefixUnaryExpressionOperand, data.operand());
        }
        NodeData::PostfixUnaryExpression(data) => {
            edges.child(ChildRole::PostfixUnaryExpressionOperand, data.operand());
        }
        NodeData::YieldExpression(data) => {
            edges.child(
                ChildRole::YieldExpressionAsteriskToken,
                data.asterisk_token(),
            );
            edges.child(ChildRole::YieldExpressionExpression, data.expression());
        }
        NodeData::ArrowFunction(data) => {
            edges.modifiers(ListRole::ArrowFunctionModifiers, data.modifiers());
            edges.list(
                ListRole::ArrowFunctionTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::ArrowFunctionParameters, data.parameters());
            edges.child(ChildRole::ArrowFunctionType, data.type_());
            edges.child(ChildRole::ArrowFunctionFullSignature, data.full_signature());
            edges.child(
                ChildRole::ArrowFunctionEqualsGreaterThanToken,
                data.equals_greater_than_token(),
            );
            edges.child(ChildRole::ArrowFunctionBody, data.body());
        }
        NodeData::FunctionExpression(data) => {
            edges.modifiers(ListRole::FunctionExpressionModifiers, data.modifiers());
            edges.child(
                ChildRole::FunctionExpressionAsteriskToken,
                data.asterisk_token(),
            );
            edges.child(ChildRole::FunctionExpressionName, data.name());
            edges.list(
                ListRole::FunctionExpressionTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::FunctionExpressionParameters, data.parameters());
            edges.child(ChildRole::FunctionExpressionType, data.type_());
            edges.child(
                ChildRole::FunctionExpressionFullSignature,
                data.full_signature(),
            );
            edges.child(ChildRole::FunctionExpressionBody, data.body());
        }
        NodeData::AsExpression(data) => {
            edges.child(ChildRole::AsExpressionExpression, data.expression());
            edges.child(ChildRole::AsExpressionType, data.type_());
        }
        NodeData::SatisfiesExpression(data) => {
            edges.child(ChildRole::SatisfiesExpressionExpression, data.expression());
            edges.child(ChildRole::SatisfiesExpressionType, data.type_());
        }
        NodeData::ConditionalExpression(data) => {
            edges.child(ChildRole::ConditionalExpressionCondition, data.condition());
            edges.child(
                ChildRole::ConditionalExpressionQuestionToken,
                data.question_token(),
            );
            edges.child(ChildRole::ConditionalExpressionWhenTrue, data.when_true());
            edges.child(
                ChildRole::ConditionalExpressionColonToken,
                data.colon_token(),
            );
            edges.child(ChildRole::ConditionalExpressionWhenFalse, data.when_false());
        }
        NodeData::PropertyAccessExpression(data) => {
            edges.child(
                ChildRole::PropertyAccessExpressionExpression,
                data.expression(),
            );
            edges.child(
                ChildRole::PropertyAccessExpressionQuestionDotToken,
                data.question_dot_token(),
            );
            edges.child(ChildRole::PropertyAccessExpressionName, data.name());
        }
        NodeData::ElementAccessExpression(data) => {
            edges.child(
                ChildRole::ElementAccessExpressionExpression,
                data.expression(),
            );
            edges.child(
                ChildRole::ElementAccessExpressionQuestionDotToken,
                data.question_dot_token(),
            );
            edges.child(
                ChildRole::ElementAccessExpressionArgumentExpression,
                data.argument_expression(),
            );
        }
        NodeData::CallExpression(data) => {
            edges.child(ChildRole::CallExpressionExpression, data.expression());
            edges.child(
                ChildRole::CallExpressionQuestionDotToken,
                data.question_dot_token(),
            );
            edges.list(ListRole::CallExpressionTypeArguments, data.type_arguments());
            edges.list(ListRole::CallExpressionArguments, data.arguments());
        }
        NodeData::NewExpression(data) => {
            edges.child(ChildRole::NewExpressionExpression, data.expression());
            edges.list(ListRole::NewExpressionTypeArguments, data.type_arguments());
            edges.list(ListRole::NewExpressionArguments, data.arguments());
        }
        NodeData::MetaProperty(data) => {
            edges.child(ChildRole::MetaPropertyName, data.name());
        }
        NodeData::NonNullExpression(data) => {
            edges.child(ChildRole::NonNullExpressionExpression, data.expression());
        }
        NodeData::SpreadElement(data) => {
            edges.child(ChildRole::SpreadElementExpression, data.expression());
        }
        NodeData::TemplateExpression(data) => {
            edges.child(ChildRole::TemplateExpressionHead, data.head());
            edges.list(
                ListRole::TemplateExpressionTemplateSpans,
                data.template_spans(),
            );
        }
        NodeData::TemplateSpan(data) => {
            edges.child(ChildRole::TemplateSpanExpression, data.expression());
            edges.child(ChildRole::TemplateSpanLiteral, data.literal());
        }
        NodeData::TaggedTemplateExpression(data) => {
            edges.child(ChildRole::TaggedTemplateExpressionTag, data.tag());
            edges.child(
                ChildRole::TaggedTemplateExpressionQuestionDotToken,
                data.question_dot_token(),
            );
            edges.list(
                ListRole::TaggedTemplateExpressionTypeArguments,
                data.type_arguments(),
            );
            edges.child(ChildRole::TaggedTemplateExpressionTemplate, data.template());
        }
        NodeData::ParenthesizedExpression(data) => {
            edges.child(
                ChildRole::ParenthesizedExpressionExpression,
                data.expression(),
            );
        }
        NodeData::ArrayLiteralExpression(data) => {
            edges.list(ListRole::ArrayLiteralExpressionElements, data.elements());
        }
        NodeData::ObjectLiteralExpression(data) => {
            edges.list(
                ListRole::ObjectLiteralExpressionProperties,
                data.properties(),
            );
        }
        NodeData::SpreadAssignment(data) => {
            edges.child(ChildRole::SpreadAssignmentExpression, data.expression());
        }
        NodeData::PropertyAssignment(data) => {
            edges.modifiers(ListRole::PropertyAssignmentModifiers, data.modifiers());
            edges.child(ChildRole::PropertyAssignmentName, data.name());
            edges.child(
                ChildRole::PropertyAssignmentPostfixToken,
                data.postfix_token(),
            );
            edges.child(ChildRole::PropertyAssignmentType, data.type_());
            edges.child(ChildRole::PropertyAssignmentInitializer, data.initializer());
        }
        NodeData::ShorthandPropertyAssignment(data) => {
            edges.modifiers(
                ListRole::ShorthandPropertyAssignmentModifiers,
                data.modifiers(),
            );
            edges.child(ChildRole::ShorthandPropertyAssignmentName, data.name());
            edges.child(
                ChildRole::ShorthandPropertyAssignmentPostfixToken,
                data.postfix_token(),
            );
            edges.child(ChildRole::ShorthandPropertyAssignmentType, data.type_());
            edges.child(
                ChildRole::ShorthandPropertyAssignmentEqualsToken,
                data.equals_token(),
            );
            edges.child(
                ChildRole::ShorthandPropertyAssignmentObjectAssignmentInitializer,
                data.object_assignment_initializer(),
            );
        }
        NodeData::DeleteExpression(data) => {
            edges.child(ChildRole::DeleteExpressionExpression, data.expression());
        }
        NodeData::TypeOfExpression(data) => {
            edges.child(ChildRole::TypeOfExpressionExpression, data.expression());
        }
        NodeData::VoidExpression(data) => {
            edges.child(ChildRole::VoidExpressionExpression, data.expression());
        }
        NodeData::AwaitExpression(data) => {
            edges.child(ChildRole::AwaitExpressionExpression, data.expression());
        }
        NodeData::TypeAssertion(data) => {
            edges.child(ChildRole::TypeAssertionType, data.type_());
            edges.child(ChildRole::TypeAssertionExpression, data.expression());
        }
        NodeData::KeywordTypeNode => {}
        NodeData::UnionTypeNode(data) => {
            edges.list(ListRole::UnionTypeNodeTypes, data.types());
        }
        NodeData::IntersectionTypeNode(data) => {
            edges.list(ListRole::IntersectionTypeNodeTypes, data.types());
        }
        NodeData::ConditionalTypeNode(data) => {
            edges.child(ChildRole::ConditionalTypeNodeCheckType, data.check_type());
            edges.child(
                ChildRole::ConditionalTypeNodeExtendsType,
                data.extends_type(),
            );
            edges.child(ChildRole::ConditionalTypeNodeTrueType, data.true_type());
            edges.child(ChildRole::ConditionalTypeNodeFalseType, data.false_type());
        }
        NodeData::TypeOperatorNode(data) => {
            edges.child(ChildRole::TypeOperatorNodeType, data.type_());
        }
        NodeData::InferTypeNode(data) => {
            edges.child(ChildRole::InferTypeNodeTypeParameter, data.type_parameter());
        }
        NodeData::ArrayTypeNode(data) => {
            edges.child(ChildRole::ArrayTypeNodeElementType, data.element_type());
        }
        NodeData::IndexedAccessTypeNode(data) => {
            edges.child(
                ChildRole::IndexedAccessTypeNodeObjectType,
                data.object_type(),
            );
            edges.child(ChildRole::IndexedAccessTypeNodeIndexType, data.index_type());
        }
        NodeData::TypeReferenceNode(data) => {
            edges.child(ChildRole::TypeReferenceNodeTypeName, data.type_name());
            edges.list(
                ListRole::TypeReferenceNodeTypeArguments,
                data.type_arguments(),
            );
        }
        NodeData::ExpressionWithTypeArguments(data) => {
            edges.child(
                ChildRole::ExpressionWithTypeArgumentsExpression,
                data.expression(),
            );
            edges.list(
                ListRole::ExpressionWithTypeArgumentsTypeArguments,
                data.type_arguments(),
            );
        }
        NodeData::LiteralTypeNode(data) => {
            edges.child(ChildRole::LiteralTypeNodeLiteral, data.literal());
        }
        NodeData::ThisTypeNode => {}
        NodeData::TypePredicateNode(data) => {
            edges.child(
                ChildRole::TypePredicateNodeAssertsModifier,
                data.asserts_modifier(),
            );
            edges.child(
                ChildRole::TypePredicateNodeParameterName,
                data.parameter_name(),
            );
            edges.child(ChildRole::TypePredicateNodeType, data.type_());
        }
        NodeData::ImportAttribute(data) => {
            edges.child(ChildRole::ImportAttributeName, data.name());
            edges.child(ChildRole::ImportAttributeValue, data.value());
        }
        NodeData::ImportAttributes(data) => {
            edges.list(ListRole::ImportAttributesAttributes, data.attributes());
        }
        NodeData::TypeQueryNode(data) => {
            edges.child(ChildRole::TypeQueryNodeExprName, data.expr_name());
            edges.list(ListRole::TypeQueryNodeTypeArguments, data.type_arguments());
        }
        NodeData::MappedTypeNode(data) => {
            edges.child(
                ChildRole::MappedTypeNodeReadonlyToken,
                data.readonly_token(),
            );
            edges.child(
                ChildRole::MappedTypeNodeTypeParameter,
                data.type_parameter(),
            );
            edges.child(ChildRole::MappedTypeNodeNameType, data.name_type());
            edges.child(
                ChildRole::MappedTypeNodeQuestionToken,
                data.question_token(),
            );
            edges.child(ChildRole::MappedTypeNodeType, data.type_());
            edges.list(ListRole::MappedTypeNodeMembers, data.members());
        }
        NodeData::TypeLiteralNode(data) => {
            edges.list(ListRole::TypeLiteralNodeMembers, data.members());
        }
        NodeData::TupleTypeNode(data) => {
            edges.list(ListRole::TupleTypeNodeElements, data.elements());
        }
        NodeData::NamedTupleMember(data) => {
            edges.child(
                ChildRole::NamedTupleMemberDotDotDotToken,
                data.dot_dot_dot_token(),
            );
            edges.child(ChildRole::NamedTupleMemberName, data.name());
            edges.child(
                ChildRole::NamedTupleMemberQuestionToken,
                data.question_token(),
            );
            edges.child(ChildRole::NamedTupleMemberType, data.type_());
        }
        NodeData::OptionalTypeNode(data) => {
            edges.child(ChildRole::OptionalTypeNodeType, data.type_());
        }
        NodeData::RestTypeNode(data) => {
            edges.child(ChildRole::RestTypeNodeType, data.type_());
        }
        NodeData::ParenthesizedTypeNode(data) => {
            edges.child(ChildRole::ParenthesizedTypeNodeType, data.type_());
        }
        NodeData::FunctionTypeNode(data) => {
            edges.list(
                ListRole::FunctionTypeNodeTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::FunctionTypeNodeParameters, data.parameters());
            edges.child(ChildRole::FunctionTypeNodeType, data.type_());
        }
        NodeData::ConstructorTypeNode(data) => {
            edges.modifiers(ListRole::ConstructorTypeNodeModifiers, data.modifiers());
            edges.list(
                ListRole::ConstructorTypeNodeTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::ConstructorTypeNodeParameters, data.parameters());
            edges.child(ChildRole::ConstructorTypeNodeType, data.type_());
        }
        NodeData::TemplateHead(_data) => {}
        NodeData::TemplateMiddle(_data) => {}
        NodeData::TemplateTail(_data) => {}
        NodeData::TemplateLiteralTypeNode(data) => {
            edges.child(ChildRole::TemplateLiteralTypeNodeHead, data.head());
            edges.list(
                ListRole::TemplateLiteralTypeNodeTemplateSpans,
                data.template_spans(),
            );
        }
        NodeData::TemplateLiteralTypeSpan(data) => {
            edges.child(ChildRole::TemplateLiteralTypeSpanType, data.type_());
            edges.child(ChildRole::TemplateLiteralTypeSpanLiteral, data.literal());
        }
        NodeData::SyntheticExpression(data) => {
            edges.child(
                ChildRole::SyntheticExpressionTupleNameSource,
                data.tuple_name_source(),
            );
        }
        NodeData::PartiallyEmittedExpression(data) => {
            edges.child(
                ChildRole::PartiallyEmittedExpressionExpression,
                data.expression(),
            );
        }
        NodeData::JsxElement(data) => {
            edges.child(ChildRole::JsxElementOpeningElement, data.opening_element());
            edges.list(ListRole::JsxElementChildren, data.children());
            edges.child(ChildRole::JsxElementClosingElement, data.closing_element());
        }
        NodeData::JsxAttributes(data) => {
            edges.list(ListRole::JsxAttributesProperties, data.properties());
        }
        NodeData::JsxNamespacedName(data) => {
            edges.child(ChildRole::JsxNamespacedNameNamespace, data.namespace());
            edges.child(ChildRole::JsxNamespacedNameName, data.name());
        }
        NodeData::JsxOpeningElement(data) => {
            edges.child(ChildRole::JsxOpeningElementTagName, data.tag_name());
            edges.list(
                ListRole::JsxOpeningElementTypeArguments,
                data.type_arguments(),
            );
            edges.child(ChildRole::JsxOpeningElementAttributes, data.attributes());
        }
        NodeData::JsxSelfClosingElement(data) => {
            edges.child(ChildRole::JsxSelfClosingElementTagName, data.tag_name());
            edges.list(
                ListRole::JsxSelfClosingElementTypeArguments,
                data.type_arguments(),
            );
            edges.child(
                ChildRole::JsxSelfClosingElementAttributes,
                data.attributes(),
            );
        }
        NodeData::JsxFragment(data) => {
            edges.child(
                ChildRole::JsxFragmentOpeningFragment,
                data.opening_fragment(),
            );
            edges.list(ListRole::JsxFragmentChildren, data.children());
            edges.child(
                ChildRole::JsxFragmentClosingFragment,
                data.closing_fragment(),
            );
        }
        NodeData::JsxOpeningFragment => {}
        NodeData::JsxClosingFragment => {}
        NodeData::JsxAttribute(data) => {
            edges.child(ChildRole::JsxAttributeName, data.name());
            edges.child(ChildRole::JsxAttributeInitializer, data.initializer());
        }
        NodeData::JsxSpreadAttribute(data) => {
            edges.child(ChildRole::JsxSpreadAttributeExpression, data.expression());
        }
        NodeData::JsxClosingElement(data) => {
            edges.child(ChildRole::JsxClosingElementTagName, data.tag_name());
        }
        NodeData::JsxExpression(data) => {
            edges.child(
                ChildRole::JsxExpressionDotDotDotToken,
                data.dot_dot_dot_token(),
            );
            edges.child(ChildRole::JsxExpressionExpression, data.expression());
        }
        NodeData::JsxText(_data) => {}
        NodeData::SyntaxList(data) => {
            edges.slice(ListRole::SyntaxListChildren, data.children());
        }
        NodeData::JSDoc(data) => {
            edges.list(ListRole::JSDocComment, data.comment());
            edges.list(ListRole::JSDocTags, data.tags());
        }
        NodeData::JSDocTypeExpression(data) => {
            edges.child(ChildRole::JSDocTypeExpressionType, data.type_());
        }
        NodeData::JSDocNonNullableType(data) => {
            edges.child(ChildRole::JSDocNonNullableTypeType, data.type_());
        }
        NodeData::JSDocNullableType(data) => {
            edges.child(ChildRole::JSDocNullableTypeType, data.type_());
        }
        NodeData::JSDocAllType => {}
        NodeData::JSDocVariadicType(data) => {
            edges.child(ChildRole::JSDocVariadicTypeType, data.type_());
        }
        NodeData::JSDocOptionalType(data) => {
            edges.child(ChildRole::JSDocOptionalTypeType, data.type_());
        }
        NodeData::JSDocTypeTag(data) => {
            edges.child(ChildRole::JSDocTypeTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocTypeTagTypeExpression,
                data.type_expression(),
            );
            edges.list(ListRole::JSDocTypeTagComment, data.comment());
        }
        NodeData::JSDocUnknownTag(data) => {
            edges.child(ChildRole::JSDocUnknownTagTagName, data.tag_name());
            edges.list(ListRole::JSDocUnknownTagComment, data.comment());
        }
        NodeData::JSDocTemplateTag(data) => {
            edges.child(ChildRole::JSDocTemplateTagTagName, data.tag_name());
            edges.child(ChildRole::JSDocTemplateTagConstraint, data.constraint());
            edges.list(
                ListRole::JSDocTemplateTagTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::JSDocTemplateTagComment, data.comment());
        }
        NodeData::JSDocReturnTag(data) => {
            edges.child(ChildRole::JSDocReturnTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocReturnTagTypeExpression,
                data.type_expression(),
            );
            edges.list(ListRole::JSDocReturnTagComment, data.comment());
        }
        NodeData::JSDocPublicTag(data) => {
            edges.child(ChildRole::JSDocPublicTagTagName, data.tag_name());
            edges.list(ListRole::JSDocPublicTagComment, data.comment());
        }
        NodeData::JSDocPrivateTag(data) => {
            edges.child(ChildRole::JSDocPrivateTagTagName, data.tag_name());
            edges.list(ListRole::JSDocPrivateTagComment, data.comment());
        }
        NodeData::JSDocProtectedTag(data) => {
            edges.child(ChildRole::JSDocProtectedTagTagName, data.tag_name());
            edges.list(ListRole::JSDocProtectedTagComment, data.comment());
        }
        NodeData::JSDocReadonlyTag(data) => {
            edges.child(ChildRole::JSDocReadonlyTagTagName, data.tag_name());
            edges.list(ListRole::JSDocReadonlyTagComment, data.comment());
        }
        NodeData::JSDocOverrideTag(data) => {
            edges.child(ChildRole::JSDocOverrideTagTagName, data.tag_name());
            edges.list(ListRole::JSDocOverrideTagComment, data.comment());
        }
        NodeData::JSDocDeprecatedTag(data) => {
            edges.child(ChildRole::JSDocDeprecatedTagTagName, data.tag_name());
            edges.list(ListRole::JSDocDeprecatedTagComment, data.comment());
        }
        NodeData::JSDocSeeTag(data) => {
            edges.child(ChildRole::JSDocSeeTagTagName, data.tag_name());
            edges.child(ChildRole::JSDocSeeTagNameExpression, data.name_expression());
            edges.list(ListRole::JSDocSeeTagComment, data.comment());
        }
        NodeData::JSDocImplementsTag(data) => {
            edges.child(ChildRole::JSDocImplementsTagTagName, data.tag_name());
            edges.child(ChildRole::JSDocImplementsTagClassName, data.class_name());
            edges.list(ListRole::JSDocImplementsTagComment, data.comment());
        }
        NodeData::JSDocAugmentsTag(data) => {
            edges.child(ChildRole::JSDocAugmentsTagTagName, data.tag_name());
            edges.child(ChildRole::JSDocAugmentsTagClassName, data.class_name());
            edges.list(ListRole::JSDocAugmentsTagComment, data.comment());
        }
        NodeData::JSDocSatisfiesTag(data) => {
            edges.child(ChildRole::JSDocSatisfiesTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocSatisfiesTagTypeExpression,
                data.type_expression(),
            );
            edges.list(ListRole::JSDocSatisfiesTagComment, data.comment());
        }
        NodeData::JSDocThrowsTag(data) => {
            edges.child(ChildRole::JSDocThrowsTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocThrowsTagTypeExpression,
                data.type_expression(),
            );
            edges.list(ListRole::JSDocThrowsTagComment, data.comment());
        }
        NodeData::JSDocThisTag(data) => {
            edges.child(ChildRole::JSDocThisTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocThisTagTypeExpression,
                data.type_expression(),
            );
            edges.list(ListRole::JSDocThisTagComment, data.comment());
        }
        NodeData::JSDocImportTag(data) => {
            edges.child(ChildRole::JSDocImportTagTagName, data.tag_name());
            edges.child(ChildRole::JSDocImportTagImportClause, data.import_clause());
            edges.child(
                ChildRole::JSDocImportTagModuleSpecifier,
                data.module_specifier(),
            );
            edges.child(ChildRole::JSDocImportTagAttributes, data.attributes());
            edges.list(ListRole::JSDocImportTagComment, data.comment());
        }
        NodeData::JSDocCallbackTag(data) => {
            edges.child(ChildRole::JSDocCallbackTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocCallbackTagTypeExpression,
                data.type_expression(),
            );
            edges.child(ChildRole::JSDocCallbackTagName, data.name());
            edges.list(ListRole::JSDocCallbackTagComment, data.comment());
        }
        NodeData::JSDocOverloadTag(data) => {
            edges.child(ChildRole::JSDocOverloadTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocOverloadTagTypeExpression,
                data.type_expression(),
            );
            edges.list(ListRole::JSDocOverloadTagComment, data.comment());
        }
        NodeData::JSDocTypedefTag(data) => {
            edges.child(ChildRole::JSDocTypedefTagTagName, data.tag_name());
            edges.child(
                ChildRole::JSDocTypedefTagTypeExpression,
                data.type_expression(),
            );
            edges.child(ChildRole::JSDocTypedefTagName, data.name());
            edges.list(ListRole::JSDocTypedefTagComment, data.comment());
        }
        NodeData::JSDocSignature(data) => {
            edges.list(
                ListRole::JSDocSignatureTypeParameters,
                data.type_parameters(),
            );
            edges.list(ListRole::JSDocSignatureParameters, data.parameters());
            edges.child(ChildRole::JSDocSignatureType, data.type_());
        }
        NodeData::JSDocNameReference(data) => {
            edges.child(ChildRole::JSDocNameReferenceName, data.name());
        }
        NodeData::SourceFile(data) => {
            edges.list(ListRole::SourceFileStatements, data.statements);
            edges.child(ChildRole::SourceFileEndOfFileToken, data.end_of_file_token);
        }
        NodeData::ModuleDeclaration(data) => {
            edges.modifiers(ListRole::ModuleDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::ModuleDeclarationName, data.name());
            edges.child(ChildRole::ModuleDeclarationAttributes, data.attributes());
            edges.child(ChildRole::ModuleDeclarationBody, data.body());
        }
        NodeData::ImportEqualsDeclaration(data) => {
            edges.modifiers(ListRole::ImportEqualsDeclarationModifiers, data.modifiers());
            edges.child(ChildRole::ImportEqualsDeclarationName, data.name());
            edges.child(
                ChildRole::ImportEqualsDeclarationModuleReference,
                data.module_reference(),
            );
        }
        NodeData::ExportDeclaration(data) => {
            edges.modifiers(ListRole::ExportDeclarationModifiers, data.modifiers());
            edges.child(
                ChildRole::ExportDeclarationExportClause,
                data.export_clause(),
            );
            edges.child(
                ChildRole::ExportDeclarationModuleSpecifier,
                data.module_specifier(),
            );
            edges.child(ChildRole::ExportDeclarationAttributes, data.attributes());
        }
        NodeData::ImportTypeNode(data) => {
            edges.child(ChildRole::ImportTypeNodeArgument, data.argument());
            edges.child(ChildRole::ImportTypeNodeAttributes, data.attributes());
            edges.child(ChildRole::ImportTypeNodeQualifier, data.qualifier());
            edges.list(ListRole::ImportTypeNodeTypeArguments, data.type_arguments());
        }
        NodeData::ImportClause(data) => {
            edges.child(ChildRole::ImportClauseName, data.name());
            edges.child(ChildRole::ImportClauseNamedBindings, data.named_bindings());
        }
        NodeData::ImportSpecifier(data) => {
            edges.child(ChildRole::ImportSpecifierPropertyName, data.property_name());
            edges.child(ChildRole::ImportSpecifierName, data.name());
        }
        NodeData::JSDocText(_data) => {}
        NodeData::JSDocLink(data) => {
            edges.child(ChildRole::JSDocLinkName, data.name());
        }
        NodeData::JSDocLinkPlain(data) => {
            edges.child(ChildRole::JSDocLinkPlainName, data.name());
        }
        NodeData::JSDocLinkCode(data) => {
            edges.child(ChildRole::JSDocLinkCodeName, data.name());
        }
        NodeData::TypeParameterDeclaration(data) => {
            edges.modifiers(
                ListRole::TypeParameterDeclarationModifiers,
                data.modifiers(),
            );
            edges.child(ChildRole::TypeParameterDeclarationName, data.name());
            edges.child(
                ChildRole::TypeParameterDeclarationConstraint,
                data.constraint(),
            );
            edges.child(
                ChildRole::TypeParameterDeclarationExpression,
                data.expression(),
            );
            edges.child(
                ChildRole::TypeParameterDeclarationDefaultType,
                data.default_type(),
            );
        }
        NodeData::SyntheticReferenceExpression(data) => {
            edges.child(
                ChildRole::SyntheticReferenceExpressionExpression,
                data.expression(),
            );
            edges.child(
                ChildRole::SyntheticReferenceExpressionThisArg,
                data.this_arg(),
            );
        }
        NodeData::JSDocTypeLiteral(data) => {
            edges.slice(
                ListRole::JSDocTypeLiteralJsdocPropertyTags,
                data.jsdoc_property_tags(),
            );
        }
        NodeData::JSDocParameterOrPropertyTag(data) => {
            edges.child(
                ChildRole::JSDocParameterOrPropertyTagTagName,
                data.tag_name(),
            );
            if data.is_name_first {
                edges.child(ChildRole::JSDocParameterOrPropertyTagName, data.name);
                edges.child(
                    ChildRole::JSDocParameterOrPropertyTagTypeExpression,
                    data.type_expression,
                );
            } else {
                edges.child(
                    ChildRole::JSDocParameterOrPropertyTagTypeExpression,
                    data.type_expression,
                );
                edges.child(ChildRole::JSDocParameterOrPropertyTagName, data.name);
            }
            edges.list(ListRole::JSDocParameterOrPropertyTagComment, data.comment());
        }
        NodeData::FlowSwitchClauseData(_data) => {}
        NodeData::FlowReduceLabelData(_data) => {}
    }
    edges.finish()
}

impl ChildRole {
    pub(super) fn marks_initializer(self) -> bool {
        matches!(
            self,
            Self::ForStatementInitializer
                | Self::ForInOrOfStatementInitializer
                | Self::VariableDeclarationInitializer
                | Self::ParameterDeclarationInitializer
                | Self::BindingElementInitializer
                | Self::EnumMemberInitializer
                | Self::PropertySignatureDeclarationInitializer
                | Self::PropertyDeclarationInitializer
                | Self::PropertyAssignmentInitializer
                | Self::ShorthandPropertyAssignmentObjectAssignmentInitializer
                | Self::JsxAttributeInitializer
        )
    }
    pub(super) fn marks_body(self) -> bool {
        matches!(
            self,
            Self::FunctionDeclarationBody
                | Self::ConstructorDeclarationBody
                | Self::GetAccessorDeclarationBody
                | Self::SetAccessorDeclarationBody
                | Self::MethodDeclarationBody
                | Self::ClassStaticBlockDeclarationBody
                | Self::ArrowFunctionBody
                | Self::FunctionExpressionBody
                | Self::ModuleDeclarationBody
        )
    }
    pub(super) fn marks_asterisk(self) -> bool {
        matches!(
            self,
            Self::FunctionDeclarationAsteriskToken
                | Self::MethodDeclarationAsteriskToken
                | Self::YieldExpressionAsteriskToken
                | Self::FunctionExpressionAsteriskToken
        )
    }
    pub(super) fn marks_rest(self) -> bool {
        matches!(
            self,
            Self::ParameterDeclarationDotDotDotToken
                | Self::BindingElementDotDotDotToken
                | Self::NamedTupleMemberDotDotDotToken
                | Self::JsxExpressionDotDotDotToken
        )
    }
    pub(super) fn marks_question(self) -> bool {
        matches!(
            self,
            Self::ParameterDeclarationQuestionToken
                | Self::MethodSignatureDeclarationPostfixToken
                | Self::MethodDeclarationPostfixToken
                | Self::PropertySignatureDeclarationPostfixToken
                | Self::PropertyDeclarationPostfixToken
                | Self::ConditionalExpressionQuestionToken
                | Self::PropertyAssignmentPostfixToken
                | Self::ShorthandPropertyAssignmentPostfixToken
                | Self::MappedTypeNodeQuestionToken
                | Self::NamedTupleMemberQuestionToken
        )
    }
}
