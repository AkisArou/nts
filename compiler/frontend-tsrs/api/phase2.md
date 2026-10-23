# Native file and AST declarations

Phase 1–2 contract for direct capture. Signatures below are declarations,
not implementations. Session/file primitives already exist in `src/`; AST
views are the next implementation group. No upstream handle is public.

`Checked`, `Project`, `File`, `Node` and `List` are borrowed views, neither
Send nor Sync. Nodes/lists implement Copy, Eq and Hash using one identity
within a checked revision. Owned snapshot data may leave `run`. Checked
borrows Session exclusively until its last use, so revise cannot invalidate
a live view. AST/file borrows may be live during checker questions; no
internal exclusive checker borrow escapes a service method.

```rust
pub fn run<R: Send>(options: SessionOptions, build: impl FnOnce(&mut Session) -> R + Send) -> R;
pub struct SessionOptions {
    pub cwd: Utf8PathBuf,
    pub library_path: Option<Utf8PathBuf>,
    pub checker_count: Option<NonZeroU16>, // None: native default; 1: exactly one
}
pub enum CaseSensitivity { Sensitive, Insensitive }
pub struct ProjectSpec {
    pub config_path: Utf8PathBuf,
    pub roots: Vec<Utf8PathBuf>, // extra roots, relative to SessionOptions.cwd
    pub overlays: BTreeMap<Utf8PathBuf, String>, // likewise relative to cwd
}
pub struct SourceChanges {
    pub overlays: BTreeMap<Utf8PathBuf, Option<String>>, // None removes overlay
    pub roots: Option<Vec<Utf8PathBuf>>, // None retains existing extra roots
}
impl Session {
    pub fn open(&mut self, spec: ProjectSpec) -> Result<Checked<'_>, LoadError>;
    pub fn revise(&mut self, changes: SourceChanges) -> Result<Checked<'_>, LoadError>;
    pub fn options(&self) -> &SessionOptions;
    pub fn cache_identity(&self) -> String;
    pub fn case_sensitivity(&self) -> CaseSensitivity;
}
impl<'p> Checked<'p> {
    pub fn projects(self) -> impl ExactSizeIterator<Item = Project<'p>>; // requested config only; native source redirects resolve references
    pub fn case_sensitivity(self) -> CaseSensitivity;
    pub fn diagnostics(self) -> Vec<Diagnostic>;
    pub fn inputs(self) -> Vec<Input>;
}
impl<'p> Project<'p> {
    pub fn config_path(self) -> &'p Utf8Path;
    pub fn cwd(self) -> &'p Utf8Path;
    pub fn root_paths(self) -> impl ExactSizeIterator<Item = &'p Utf8Path>;
    pub fn diagnostics(self) -> Vec<Diagnostic>; // this requested program only
    pub fn checker_count(self) -> usize; // effective count, never misreports 1
    pub fn files(self) -> impl ExactSizeIterator<Item = File<'p>>;
    pub fn semantics(self) -> ProjectSemantics;
}
impl<'p> File<'p> {
    pub fn path(self) -> &'p Utf8Path;
    pub fn text(self) -> &'p str; // original UTF-8 source
    pub fn content_digest(self) -> u128;
    pub fn is_declaration(self) -> bool;
    pub fn is_default_library(self) -> bool;
    pub fn is_external_library(self) -> bool;
    pub fn root(self) -> Node<'p>;
    pub fn imports(self) -> impl Iterator<Item = &'p str>;
    pub fn span(self, start: BytePos, end: BytePos) -> Utf16Span;
}
pub type NativeKind = u16; // the ONE native->nts mapping belongs to capture
pub struct BytePos(pub u32);
pub struct Utf16Pos(pub u32);
pub struct Utf16Span { pub start: Utf16Pos, pub end: Utf16Pos }
impl<'p> Node<'p> {
    pub fn kind(self) -> NativeKind;
    pub fn source_file(self) -> File<'p>;
    pub fn parent(self) -> Option<Node<'p>>;
    pub fn span(self) -> Option<Utf16Span>; // synthetic: None
    pub fn token_start(self) -> Option<Utf16Pos>; // excludes trivia; synthetic: None
    pub fn edges(self) -> impl Iterator<Item = Edge<'p>>;
    pub fn child(self, role: ChildRole) -> Option<Node<'p>>;
    pub fn list(self, role: ListRole) -> Option<List<'p>>;
    pub fn name_text(self) -> Option<&'p str>; // identifier/private identifier
    pub fn literal(self) -> Option<Literal<'p>>;
    pub fn attributes(self) -> NodeAttributes;
    pub fn documentation(self) -> impl Iterator<Item = Documentation<'p>>;
}
pub enum Edge<'p> {
    Node { role: ChildRole, node: Node<'p> },
    List { role: ListRole, list: List<'p> },
}
impl<'p> List<'p> {
    pub fn span(self) -> Option<Utf16Span>;
    pub fn iter(self) -> impl ExactSizeIterator<Item = Node<'p>>;
    pub fn has_trailing_comma(self) -> bool;
}
pub struct ProjectSemantics {
    pub use_define_for_class_fields: bool, // effective, native target-derived default
    pub experimental_decorators: bool,
    pub emit_decorator_metadata: bool,
    pub verbatim_module_syntax: bool,
    pub preserve_const_enums: bool, // effective; includes isolated_modules
    pub isolated_modules: bool, // effective; includes verbatim_module_syntax
}
pub enum LiteralKind { String, Number, BigInt, RegExp, Template, JsxText }
pub struct Literal<'p> {
    pub kind: LiteralKind,
    pub raw: &'p str, // exact spelling; authoritative for number/bigint
    pub cooked: Option<&'p [u16]>, // preserves lone surrogates; no lossy UTF-8
    pub invalid_template_escape: bool,
}
pub enum VariableKind { Var, Let, Const, Using, AwaitUsing }
pub enum ImportPhase { Value, Type, Defer, Source }
pub enum ExportAssignmentKind { Default, Equals }
pub enum MetaProperty { ImportMeta, NewTarget }
pub enum HeritageKind { Extends, Implements }
pub struct Modifiers {
    pub export: bool, pub default: bool, pub declare: bool,
    pub public: bool, pub private: bool, pub protected: bool,
    pub static_: bool, pub readonly: bool, pub abstract_: bool,
    pub async_: bool, pub const_: bool, pub override_: bool,
    pub accessor: bool, pub in_: bool, pub out: bool,
}
pub struct NodeAttributes {
    pub modifiers: Modifiers,
    pub ambient_context: bool, // inherited, including declare-namespace members
    pub optional_chain: bool, // includes .z in x?.y.z
    pub variable_kind: Option<VariableKind>,
    pub operator: Option<NativeKind>,
    pub heritage: Option<HeritageKind>,
    pub import_phase: Option<ImportPhase>,
    pub type_only: bool, // per-specifier as well as per-declaration
    pub export_assignment: Option<ExportAssignmentKind>,
    pub meta_property: Option<MetaProperty>,
    pub generator: bool, pub optional: bool, pub rest: bool,
    pub has_initializer: bool, pub has_body: bool,
}
pub struct Documentation<'p> {
    pub source_file: File<'p>, pub span: Option<Utf16Span>,
    pub raw: &'p str, pub tags: Vec<DocumentationTag<'p>>,
}
pub struct DocumentationTag<'p> {
    pub span: Option<Utf16Span>, pub name: &'p str, pub text: &'p str,
}
```

Every distinct native struct field has its own role below. `roles.json`
records all 167 native node structs, each field's required/optional/list
cardinality, and visitor ordering. Examples: TemplateSpanExpression vs
TemplateSpanLiteral, ImportSpecifierPropertyName vs ImportSpecifierName.
List roles describe membership; no fake AST list nodes or wire indexes.

```rust
pub enum ChildRole {
    QualifiedNameLeft, // one
    QualifiedNameRight, // one
    ComputedPropertyNameExpression, // one
    DecoratorExpression, // one
    IfStatementExpression, // one
    IfStatementThenStatement, // one
    IfStatementElseStatement, // optional
    DoStatementStatement, // one
    DoStatementExpression, // one
    WhileStatementExpression, // one
    WhileStatementStatement, // one
    ForStatementInitializer, // optional
    ForStatementCondition, // optional
    ForStatementIncrementor, // optional
    ForStatementStatement, // one
    ForInOrOfStatementAwaitModifier, // optional
    ForInOrOfStatementInitializer, // one
    ForInOrOfStatementExpression, // one
    ForInOrOfStatementStatement, // one
    BreakStatementLabel, // optional
    ContinueStatementLabel, // optional
    ReturnStatementExpression, // optional
    WithStatementExpression, // one
    WithStatementStatement, // one
    SwitchStatementExpression, // one
    SwitchStatementCaseBlock, // one
    CaseOrDefaultClauseExpression, // optional
    ThrowStatementExpression, // one
    TryStatementTryBlock, // one
    TryStatementCatchClause, // optional
    TryStatementFinallyBlock, // optional
    CatchClauseVariableDeclaration, // optional
    CatchClauseBlock, // one
    LabeledStatementLabel, // one
    LabeledStatementStatement, // one
    ExpressionStatementExpression, // one
    VariableStatementDeclarationList, // one
    VariableDeclarationName, // one
    VariableDeclarationExclamationToken, // optional
    VariableDeclarationType, // optional
    VariableDeclarationInitializer, // optional
    ParameterDeclarationDotDotDotToken, // optional
    ParameterDeclarationName, // one
    ParameterDeclarationQuestionToken, // optional
    ParameterDeclarationType, // optional
    ParameterDeclarationInitializer, // optional
    BindingElementDotDotDotToken, // optional
    BindingElementPropertyName, // optional
    BindingElementName, // optional
    BindingElementInitializer, // optional
    FunctionDeclarationAsteriskToken, // optional
    FunctionDeclarationName, // optional
    FunctionDeclarationType, // optional
    FunctionDeclarationFullSignature, // optional
    FunctionDeclarationBody, // optional
    ClassDeclarationName, // optional
    ClassExpressionName, // optional
    InterfaceDeclarationName, // one
    TypeAliasDeclarationName, // one
    TypeAliasDeclarationType, // optional
    EnumMemberName, // one
    EnumMemberInitializer, // optional
    EnumDeclarationName, // one
    ImportDeclarationImportClause, // optional
    ImportDeclarationModuleSpecifier, // one
    ImportDeclarationAttributes, // optional
    ExternalModuleReferenceExpression, // one
    NamespaceImportName, // one
    ExportAssignmentType, // optional
    ExportAssignmentExpression, // one
    NamespaceExportDeclarationName, // one
    NamespaceExportName, // one
    ExportSpecifierPropertyName, // optional
    ExportSpecifierName, // one
    CallSignatureDeclarationType, // optional
    ConstructSignatureDeclarationType, // optional
    ConstructorDeclarationType, // optional
    ConstructorDeclarationFullSignature, // optional
    ConstructorDeclarationBody, // optional
    GetAccessorDeclarationName, // one
    GetAccessorDeclarationType, // optional
    GetAccessorDeclarationFullSignature, // optional
    GetAccessorDeclarationBody, // optional
    SetAccessorDeclarationName, // one
    SetAccessorDeclarationType, // optional
    SetAccessorDeclarationFullSignature, // optional
    SetAccessorDeclarationBody, // optional
    IndexSignatureDeclarationType, // optional
    MethodSignatureDeclarationName, // one
    MethodSignatureDeclarationPostfixToken, // optional
    MethodSignatureDeclarationType, // optional
    MethodDeclarationAsteriskToken, // optional
    MethodDeclarationName, // one
    MethodDeclarationPostfixToken, // optional
    MethodDeclarationType, // optional
    MethodDeclarationFullSignature, // optional
    MethodDeclarationBody, // optional
    PropertySignatureDeclarationName, // one
    PropertySignatureDeclarationPostfixToken, // optional
    PropertySignatureDeclarationType, // optional
    PropertySignatureDeclarationInitializer, // optional
    PropertyDeclarationName, // one
    PropertyDeclarationPostfixToken, // optional
    PropertyDeclarationType, // optional
    PropertyDeclarationInitializer, // optional
    ClassStaticBlockDeclarationBody, // one
    BinaryExpressionLeft, // one
    BinaryExpressionType, // optional
    BinaryExpressionOperatorToken, // one
    BinaryExpressionRight, // one
    PrefixUnaryExpressionOperand, // one
    PostfixUnaryExpressionOperand, // one
    YieldExpressionAsteriskToken, // optional
    YieldExpressionExpression, // optional
    ArrowFunctionType, // optional
    ArrowFunctionFullSignature, // optional
    ArrowFunctionEqualsGreaterThanToken, // optional
    ArrowFunctionBody, // optional
    FunctionExpressionAsteriskToken, // optional
    FunctionExpressionName, // optional
    FunctionExpressionType, // optional
    FunctionExpressionFullSignature, // optional
    FunctionExpressionBody, // optional
    AsExpressionExpression, // one
    AsExpressionType, // one
    SatisfiesExpressionExpression, // one
    SatisfiesExpressionType, // one
    ConditionalExpressionCondition, // one
    ConditionalExpressionQuestionToken, // one
    ConditionalExpressionWhenTrue, // one
    ConditionalExpressionColonToken, // one
    ConditionalExpressionWhenFalse, // one
    PropertyAccessExpressionExpression, // one
    PropertyAccessExpressionQuestionDotToken, // optional
    PropertyAccessExpressionName, // one
    ElementAccessExpressionExpression, // one
    ElementAccessExpressionQuestionDotToken, // optional
    ElementAccessExpressionArgumentExpression, // one
    CallExpressionExpression, // one
    CallExpressionQuestionDotToken, // optional
    NewExpressionExpression, // one
    MetaPropertyName, // one
    NonNullExpressionExpression, // one
    SpreadElementExpression, // one
    TemplateExpressionHead, // one
    TemplateSpanExpression, // one
    TemplateSpanLiteral, // one
    TaggedTemplateExpressionTag, // one
    TaggedTemplateExpressionQuestionDotToken, // optional
    TaggedTemplateExpressionTemplate, // one
    ParenthesizedExpressionExpression, // one
    SpreadAssignmentExpression, // one
    PropertyAssignmentName, // one
    PropertyAssignmentPostfixToken, // optional
    PropertyAssignmentType, // optional
    PropertyAssignmentInitializer, // one
    ShorthandPropertyAssignmentName, // one
    ShorthandPropertyAssignmentPostfixToken, // optional
    ShorthandPropertyAssignmentType, // optional
    ShorthandPropertyAssignmentEqualsToken, // optional
    ShorthandPropertyAssignmentObjectAssignmentInitializer, // optional
    DeleteExpressionExpression, // one
    TypeOfExpressionExpression, // one
    VoidExpressionExpression, // one
    AwaitExpressionExpression, // one
    TypeAssertionType, // one
    TypeAssertionExpression, // one
    ConditionalTypeNodeCheckType, // one
    ConditionalTypeNodeExtendsType, // one
    ConditionalTypeNodeTrueType, // one
    ConditionalTypeNodeFalseType, // one
    TypeOperatorNodeType, // one
    InferTypeNodeTypeParameter, // one
    ArrayTypeNodeElementType, // one
    IndexedAccessTypeNodeObjectType, // one
    IndexedAccessTypeNodeIndexType, // one
    TypeReferenceNodeTypeName, // one
    ExpressionWithTypeArgumentsExpression, // one
    LiteralTypeNodeLiteral, // one
    TypePredicateNodeAssertsModifier, // optional
    TypePredicateNodeParameterName, // one
    TypePredicateNodeType, // optional
    ImportAttributeName, // optional
    ImportAttributeValue, // one
    TypeQueryNodeExprName, // one
    MappedTypeNodeReadonlyToken, // optional
    MappedTypeNodeTypeParameter, // one
    MappedTypeNodeNameType, // optional
    MappedTypeNodeQuestionToken, // optional
    MappedTypeNodeType, // optional
    NamedTupleMemberDotDotDotToken, // optional
    NamedTupleMemberName, // one
    NamedTupleMemberQuestionToken, // optional
    NamedTupleMemberType, // one
    OptionalTypeNodeType, // one
    RestTypeNodeType, // one
    ParenthesizedTypeNodeType, // one
    FunctionTypeNodeType, // optional
    ConstructorTypeNodeType, // optional
    TemplateLiteralTypeNodeHead, // one
    TemplateLiteralTypeSpanType, // one
    TemplateLiteralTypeSpanLiteral, // one
    SyntheticExpressionTupleNameSource, // optional
    PartiallyEmittedExpressionExpression, // one
    JsxElementOpeningElement, // one
    JsxElementClosingElement, // one
    JsxNamespacedNameNamespace, // one
    JsxNamespacedNameName, // one
    JsxOpeningElementTagName, // one
    JsxOpeningElementAttributes, // one
    JsxSelfClosingElementTagName, // one
    JsxSelfClosingElementAttributes, // one
    JsxFragmentOpeningFragment, // one
    JsxFragmentClosingFragment, // one
    JsxAttributeName, // one
    JsxAttributeInitializer, // optional
    JsxSpreadAttributeExpression, // one
    JsxClosingElementTagName, // one
    JsxExpressionDotDotDotToken, // optional
    JsxExpressionExpression, // optional
    JSDocTypeExpressionType, // one
    JSDocNonNullableTypeType, // one
    JSDocNullableTypeType, // one
    JSDocVariadicTypeType, // one
    JSDocOptionalTypeType, // one
    JSDocTypeTagTagName, // one
    JSDocTypeTagTypeExpression, // one
    JSDocUnknownTagTagName, // one
    JSDocTemplateTagTagName, // one
    JSDocTemplateTagConstraint, // optional
    JSDocReturnTagTagName, // one
    JSDocReturnTagTypeExpression, // optional
    JSDocPublicTagTagName, // one
    JSDocPrivateTagTagName, // one
    JSDocProtectedTagTagName, // one
    JSDocReadonlyTagTagName, // one
    JSDocOverrideTagTagName, // one
    JSDocDeprecatedTagTagName, // one
    JSDocSeeTagTagName, // one
    JSDocSeeTagNameExpression, // optional
    JSDocImplementsTagTagName, // one
    JSDocImplementsTagClassName, // one
    JSDocAugmentsTagTagName, // one
    JSDocAugmentsTagClassName, // one
    JSDocSatisfiesTagTagName, // one
    JSDocSatisfiesTagTypeExpression, // one
    JSDocThrowsTagTagName, // one
    JSDocThrowsTagTypeExpression, // optional
    JSDocThisTagTagName, // one
    JSDocThisTagTypeExpression, // one
    JSDocImportTagTagName, // one
    JSDocImportTagImportClause, // optional
    JSDocImportTagModuleSpecifier, // one
    JSDocImportTagAttributes, // optional
    JSDocCallbackTagTagName, // one
    JSDocCallbackTagTypeExpression, // one
    JSDocCallbackTagName, // optional
    JSDocOverloadTagTagName, // one
    JSDocOverloadTagTypeExpression, // one
    JSDocTypedefTagTagName, // one
    JSDocTypedefTagTypeExpression, // optional
    JSDocTypedefTagName, // optional
    JSDocSignatureType, // optional
    JSDocNameReferenceName, // one
    ModuleDeclarationName, // one
    ModuleDeclarationAttributes, // optional
    ModuleDeclarationBody, // optional
    ImportEqualsDeclarationName, // one
    ImportEqualsDeclarationModuleReference, // one
    ExportDeclarationExportClause, // optional
    ExportDeclarationModuleSpecifier, // optional
    ExportDeclarationAttributes, // optional
    ImportTypeNodeArgument, // one
    ImportTypeNodeAttributes, // optional
    ImportTypeNodeQualifier, // optional
    ImportClauseName, // optional
    ImportClauseNamedBindings, // optional
    ImportSpecifierPropertyName, // optional
    ImportSpecifierName, // one
    JSDocLinkName, // optional
    JSDocLinkPlainName, // optional
    JSDocLinkCodeName, // optional
    TypeParameterDeclarationName, // one
    TypeParameterDeclarationConstraint, // optional
    TypeParameterDeclarationExpression, // optional
    TypeParameterDeclarationDefaultType, // optional
    SyntheticReferenceExpressionExpression, // one
    SyntheticReferenceExpressionThisArg, // one
    JSDocParameterOrPropertyTagTagName, // one
    JSDocParameterOrPropertyTagName, // one
    JSDocParameterOrPropertyTagTypeExpression, // optional
    SourceFileEndOfFileToken, // one
}
pub enum ListRole {
    CaseBlockClauses, // list
    CaseOrDefaultClauseStatements, // list
    BlockStatements, // list
    VariableStatementModifiers, // optional-list
    VariableDeclarationListDeclarations, // list
    BindingPatternElements, // list
    ParameterDeclarationModifiers, // optional-list
    MissingDeclarationModifiers, // optional-list
    FunctionDeclarationModifiers, // optional-list
    FunctionDeclarationTypeParameters, // optional-list
    FunctionDeclarationParameters, // optional-list
    ClassDeclarationModifiers, // optional-list
    ClassDeclarationTypeParameters, // optional-list
    ClassDeclarationHeritageClauses, // optional-list
    ClassDeclarationMembers, // list
    ClassExpressionModifiers, // optional-list
    ClassExpressionTypeParameters, // optional-list
    ClassExpressionHeritageClauses, // optional-list
    ClassExpressionMembers, // list
    HeritageClauseTypes, // list
    InterfaceDeclarationModifiers, // optional-list
    InterfaceDeclarationTypeParameters, // optional-list
    InterfaceDeclarationHeritageClauses, // optional-list
    InterfaceDeclarationMembers, // list
    TypeAliasDeclarationModifiers, // optional-list
    TypeAliasDeclarationTypeParameters, // optional-list
    EnumDeclarationModifiers, // optional-list
    EnumDeclarationMembers, // list
    ModuleBlockStatements, // list
    ImportDeclarationModifiers, // optional-list
    NamedImportsElements, // list
    ExportAssignmentModifiers, // optional-list
    NamespaceExportDeclarationModifiers, // optional-list
    NamedExportsElements, // list
    CallSignatureDeclarationTypeParameters, // optional-list
    CallSignatureDeclarationParameters, // optional-list
    ConstructSignatureDeclarationTypeParameters, // optional-list
    ConstructSignatureDeclarationParameters, // optional-list
    ConstructorDeclarationModifiers, // optional-list
    ConstructorDeclarationTypeParameters, // optional-list
    ConstructorDeclarationParameters, // optional-list
    GetAccessorDeclarationModifiers, // optional-list
    GetAccessorDeclarationTypeParameters, // optional-list
    GetAccessorDeclarationParameters, // optional-list
    SetAccessorDeclarationModifiers, // optional-list
    SetAccessorDeclarationTypeParameters, // optional-list
    SetAccessorDeclarationParameters, // optional-list
    IndexSignatureDeclarationModifiers, // optional-list
    IndexSignatureDeclarationParameters, // optional-list
    MethodSignatureDeclarationModifiers, // optional-list
    MethodSignatureDeclarationTypeParameters, // optional-list
    MethodSignatureDeclarationParameters, // optional-list
    MethodDeclarationModifiers, // optional-list
    MethodDeclarationTypeParameters, // optional-list
    MethodDeclarationParameters, // optional-list
    PropertySignatureDeclarationModifiers, // optional-list
    PropertyDeclarationModifiers, // optional-list
    ClassStaticBlockDeclarationModifiers, // optional-list
    BinaryExpressionModifiers, // optional-list
    ArrowFunctionModifiers, // optional-list
    ArrowFunctionTypeParameters, // optional-list
    ArrowFunctionParameters, // optional-list
    FunctionExpressionModifiers, // optional-list
    FunctionExpressionTypeParameters, // optional-list
    FunctionExpressionParameters, // optional-list
    CallExpressionTypeArguments, // optional-list
    CallExpressionArguments, // list
    NewExpressionTypeArguments, // optional-list
    NewExpressionArguments, // optional-list
    TemplateExpressionTemplateSpans, // list
    TaggedTemplateExpressionTypeArguments, // optional-list
    ArrayLiteralExpressionElements, // list
    ObjectLiteralExpressionProperties, // list
    PropertyAssignmentModifiers, // optional-list
    ShorthandPropertyAssignmentModifiers, // optional-list
    UnionTypeNodeTypes, // list
    IntersectionTypeNodeTypes, // list
    TypeReferenceNodeTypeArguments, // optional-list
    ExpressionWithTypeArgumentsTypeArguments, // optional-list
    ImportAttributesAttributes, // list
    TypeQueryNodeTypeArguments, // optional-list
    MappedTypeNodeMembers, // optional-list
    TypeLiteralNodeMembers, // list
    TupleTypeNodeElements, // list
    FunctionTypeNodeTypeParameters, // optional-list
    FunctionTypeNodeParameters, // optional-list
    ConstructorTypeNodeModifiers, // optional-list
    ConstructorTypeNodeTypeParameters, // optional-list
    ConstructorTypeNodeParameters, // optional-list
    TemplateLiteralTypeNodeTemplateSpans, // list
    JsxElementChildren, // list
    JsxAttributesProperties, // list
    JsxOpeningElementTypeArguments, // optional-list
    JsxSelfClosingElementTypeArguments, // optional-list
    JsxFragmentChildren, // list
    SyntaxListChildren, // list
    JSDocComment, // list
    JSDocTags, // optional-list
    JSDocTypeTagComment, // optional-list
    JSDocUnknownTagComment, // optional-list
    JSDocTemplateTagTypeParameters, // list
    JSDocTemplateTagComment, // optional-list
    JSDocReturnTagComment, // optional-list
    JSDocPublicTagComment, // optional-list
    JSDocPrivateTagComment, // optional-list
    JSDocProtectedTagComment, // optional-list
    JSDocReadonlyTagComment, // optional-list
    JSDocOverrideTagComment, // optional-list
    JSDocDeprecatedTagComment, // optional-list
    JSDocSeeTagComment, // optional-list
    JSDocImplementsTagComment, // optional-list
    JSDocAugmentsTagComment, // optional-list
    JSDocSatisfiesTagComment, // optional-list
    JSDocThrowsTagComment, // optional-list
    JSDocThisTagComment, // optional-list
    JSDocImportTagComment, // optional-list
    JSDocCallbackTagComment, // optional-list
    JSDocOverloadTagComment, // optional-list
    JSDocTypedefTagComment, // optional-list
    JSDocSignatureTypeParameters, // optional-list
    JSDocSignatureParameters, // optional-list
    ModuleDeclarationModifiers, // optional-list
    ImportEqualsDeclarationModifiers, // optional-list
    ExportDeclarationModifiers, // optional-list
    ImportTypeNodeTypeArguments, // optional-list
    TypeParameterDeclarationModifiers, // optional-list
    JSDocTypeLiteralJsdocPropertyTags, // list
    JSDocParameterOrPropertyTagComment, // optional-list
    SourceFileStatements, // list
}
```
