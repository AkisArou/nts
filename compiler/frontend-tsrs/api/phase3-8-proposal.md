# Native semantic services proposal

Reviewed service surface, implemented in `src/semantic.rs` and
`src/semantic_graph.rs`. All `Symbol`, `Type` and `Signature` views
are Copy/Eq/Hash, neither Send nor Sync, and borrow the same checked revision
as Node. A declaration is a Node, including uncaptured library declarations;
the source path is always available through its File. No arena/checker handle
or native numeric identity is public. Collections preserve checker order.

Every semantic question borrows one persistent capture checker C0, constructed
independently of Program's diagnostics pool. Its scratch region and checker
persist for the revision; the borrow is released before returning a view.
Recycling stays off and stableTypeOrdering stays on. C0 starts pristine and
never contributes diagnostics. Queries may record checker-local errors, but
those are never program errors. With a total concurrency of one, finish runs
the independent diagnostic checker sequentially on the capture thread. With
N >= 2, a separate large-stack coordinator runs at most N - 1 pool checkers
concurrently with C0. Without an explicit count the native pool chooses its
own size, plus C0. `Checked::finish(self)` ends capture and joins diagnostics,
returning `Finished` with owned diagnostics and syntax-only reborrows. Drop
also joins before freeing the program, including during unwinding. Capture
identity and its initial cache state never depend on diagnostic scheduling.
Question inputs must belong to the same program; cross-program assignability
is a release-mode assertion naming both config paths, never a bool answer.
Within each program every route to a logical type/symbol/signature uses that
one checker and gives consistent Eq/Hash identity, independent of pool count.
Session::open builds only the requested program. Native source redirects
resolve its imported references, without checking separate referenced programs.

Program identities are deliberately distinct if multiple sessions are live;
misuse asserts in release mode with both config paths. Checked currently
contains only the requested program. Native JavaScript strings can contain
lone UTF-16 surrogates.
The proposed semantic names use UTF-16 rather than exposing tsrs's internal
WTF-8 sentinel strings as Rust `str`. ASCII/valid Unicode names can have a
convenience UTF-8 projection; preserving non-Unicode names in nts is builder
and schema policy, not a fabricated missing name in this adapter.

```rust
pub type Declaration<'p> = Node<'p>;
pub struct JsString<'p> { /* opaque, borrowed valid UTF-16 code units */ }
impl<'p> JsString<'p> {
    pub fn utf16(self) -> &'p [u16];
    pub fn utf8(self) -> Option<&'p str>; // None exactly for lone surrogates
}

pub enum SymbolName<'p> {
    Plain(JsString<'p>), // user spelling, including leading underscores
    Private(JsString<'p>), // written #name; identity belongs to Symbol
    Internal(InternalName<'p>), // generated native constants + Other(JsString)
    Keyed(Type<'p>), // exactly UniqueSymbol, declaration through Type::symbol
}
// InternalName is generated from api/internal-names.json. The four ordinary
// spellings default/export=/this/module.exports use checker-table context.

impl<'p> Node<'p> {
    pub fn symbol(self) -> Option<Symbol<'p>>;
    pub fn ty(self) -> Type<'p>;
    pub fn resolved_signature(self) -> Option<Signature<'p>>; // call/new/tagged template
    pub fn constant(self) -> Option<Constant<'p>>;
    pub fn type_text(self) -> String; // native rendering at this location
}
impl<'p> File<'p> {
    pub fn module_symbol(self) -> Option<Symbol<'p>>; // a script has none
}
impl<'p> Symbol<'p> {
    pub fn name(self) -> SymbolName<'p>;
    pub fn classification(self) -> SymbolClassification;
    pub fn builtin_binding(self) -> Option<BuiltinBinding>; // checker identity, never spelling
    pub fn declarations(self) -> impl ExactSizeIterator<Item = Declaration<'p>>;
    pub fn alias_target(self) -> Option<Symbol<'p>>; // final target; non-alias None
    pub fn exports(self) -> Vec<Export<'p>>; // non-module/empty module: empty
    pub fn ty(self) -> Type<'p>;
    pub fn ty_at(self, location: Node<'p>) -> Option<Type<'p>>;
    pub fn declared_type(self) -> Option<Type<'p>>; // non-type declaration None
    pub fn readonly(self) -> bool; // computed checker result
}
pub enum BuiltinBinding { Undefined, NaN, Infinity, GlobalThis, Arguments }
pub struct SymbolClassification {
    pub alias: bool, pub module: bool, pub type_literal: bool,
    pub object_literal: bool, pub method: bool, pub getter: bool,
    pub setter: bool, pub optional: bool,
    pub variable: bool, pub function: bool, pub class: bool,
    pub interface: bool, pub type_alias: bool, pub enum_: bool, pub property: bool,
}
pub struct Export<'p> { pub name: SymbolName<'p>, pub symbol: Symbol<'p> }

pub use nts_semantic_schema::WellKnownSymbol;
impl<'p> Type<'p> {
    pub fn well_known_symbol(self) -> Option<WellKnownSymbol>; // UniqueSymbol declared in the default library SymbolConstructor
    pub fn kind(self) -> TypeKind;
    pub fn symbol(self) -> Option<Symbol<'p>>;
    pub fn literal(self) -> Option<TypeLiteral<'p>>;
    pub fn non_inferrable(self) -> bool;
    pub fn evolving_any(self) -> bool;
    pub fn constituents(self) -> Option<Vec<Type<'p>>>; // union/intersection
    pub fn is_array(self) -> bool;
    pub fn tuple_elements(self) -> Option<Vec<Type<'p>>>; // Some(empty) preserved
    pub fn reference(self) -> Option<Reference<'p>>;
    pub fn type_parameter(self) -> Option<TypeParameter<'p>>;
    pub fn bases(self) -> Vec<Type<'p>>;
    pub fn conditional(self) -> Option<Conditional<'p>>;
    pub fn indexed_access(self) -> Option<IndexedAccess<'p>>;
    pub fn template(self) -> Option<Template<'p>>;
    pub fn substitution(self) -> Option<Substitution<'p>>;
    pub fn properties(self) -> Vec<Property<'p>>;
    pub fn index_signatures(self) -> Vec<IndexSignature<'p>>;
    pub fn signatures(self, kind: SignatureKind) -> Vec<Signature<'p>>;
    pub fn assignable_to(self, target: Type<'p>) -> bool;
}
pub enum TypeKind {
    Any, Unknown, Never, Void, Undefined, Null, Boolean, String, Number,
    BigInt, Symbol, UniqueSymbol, Literal, TypeParameter, Union, Intersection, Tuple,
    Reference, Object, Conditional, IndexedAccess, Template, Substitution,
    NonPrimitive, // TypeScript's `object`
    Other, // builder MUST emit a named Unsupported/refusal; never erase or use any
}
pub enum TypeLiteral<'p> {
    String(JsString<'p>), Number(f64), Boolean(bool),
    BigInt { negative: bool, digits: &'p str },
}
pub struct Reference<'p> { pub target: Type<'p>, pub arguments: Vec<Type<'p>> }
pub struct TypeParameter<'p> {
    pub name: JsString<'p>, pub constraint: Option<Type<'p>>,
}
pub struct Conditional<'p> {
    pub check: Type<'p>, pub extends: Type<'p>,
    pub true_type: Type<'p>, pub false_type: Type<'p>,
}
pub struct IndexedAccess<'p> { pub object: Type<'p>, pub index: Type<'p> }
pub struct Template<'p> { pub texts: Vec<JsString<'p>>, pub types: Vec<Type<'p>> }
pub struct Substitution<'p> { pub base: Type<'p>, pub constraint: Type<'p> }
pub struct Property<'p> {
    pub symbol: Symbol<'p>, pub name: SymbolName<'p>, pub ty: Type<'p>,
    pub optional: bool, pub readonly: bool, pub declared_readonly: bool,
    pub kind: PropertyKind, pub declarations: Vec<Declaration<'p>>,
}
pub enum PropertyKind { Field, Method, Getter, Setter, GetterSetter }
pub struct IndexSignature<'p> {
    pub key: Type<'p>, pub value: Type<'p>, pub readonly: bool,
}

pub enum SignatureKind { Call, Construct }
impl<'p> Signature<'p> {
    pub fn declaration(self) -> Option<Declaration<'p>>;
    pub fn parameters(self) -> Vec<Parameter<'p>>;
    pub fn return_type(self) -> Type<'p>;
    pub fn type_parameters(self) -> Vec<Type<'p>>;
    pub fn this_parameter(self) -> Option<Parameter<'p>>;
    pub fn predicate(self) -> Option<TypePredicate<'p>>;
}
pub struct Parameter<'p> {
    pub symbol: Symbol<'p>, pub name: SymbolName<'p>, pub ty: Type<'p>,
    pub declarations: Vec<Declaration<'p>>, pub optional: bool,
    pub has_initializer: bool, pub rest: bool,
}
pub struct TypePredicate<'p> {
    pub asserts: bool, pub subject: PredicateSubject<'p>,
    pub narrowed_type: Option<Type<'p>>, // `asserts x` has no type
}
pub enum PredicateSubject<'p> {
    This, Parameter { name: JsString<'p>, index: usize },
}
pub enum Constant<'p> { Number(f64), String(JsString<'p>) }
```

Option means semantic absence/non-applicability, never a panic fallback or
missing transport answer. Native number constants retain NaN and infinities.
`Type::reference` checks the native semantic reference flag before reading a
target: native interface/tuple storage sharing a reference layout does not
make every such type a semantic reference.
The existing owned Diagnostic and Input records finish phase 8; rewrites use
Session::revise and never retain views into the previous program. Graph
budgets, library classification, inherited-property policy, binding rules,
constant-folding selection and snapshot IDs remain builder policy.

The first implementation group after AST was the small complete smoke path:
node/file symbol, symbol identity/declarations/exports, node/symbol type,
primitive/literal classification, and call-signature parameters/return.
Structured graph methods are covered by inline projects at one and four
checkers. Borrowed views cannot be Send or used after `revise`, as compile-fail
documentation tests also check.

## Coverage of the 42 approved reads

| Read | Required fact | Answer or builder policy |
| --- | --- | --- |
| 1 (1) | Resolved compiler options, project/config identity and current directory, explicit root files, source files in the program, and filesystem case sensitivity. | Project::{semantics,config_path,cwd,root_paths,files}; Checked::case_sensitivity. Checker-only options stay native; runtime fields are effective ProjectSemantics. |
| 2 (1) | Per-file normalized path, declaration-file status, default-library status and external-library status. These decide which ASTs nts captures; they do not replace declaration-source identity for symbols outside that set. | File::{path,is_declaration,is_default_library,is_external_library}. Inclusion is builder policy. |
| 3 (1) | The program's parse/configuration/options/syntactic/semantic diagnostics, including diagnostics for ordinary JavaScript that are ECMAScript early errors. | Project<SyntaxPhase>::diagnostics (requested config scope) and Finished::diagnostics, completed by Checked::finish after capture; ordinary diagnostics retain native filters/directives; Project/Finished::plain_js_unfiltered separately exposes native plain-JS bind/check facts only when is_plain_js_file and skip_type_checking permit. The consumer applies its own early-error allowlist; explicit checkJs:false and ts-nocheck have no raw list. |
| 4 (1) | Source contents plus added/generated root files and rewritten source contents. Revisions must recheck the affected program and expose the resulting files and diagnostics. | File::text, Session::{open,revise}, ProjectSpec roots/overlays and SourceChanges. |
| 5 (1) | Each source's actual imported module specifiers, including re-exports, import types and literal import calls. Generated-source preflight consumes this semantic list. | File::imports. |
| 6 (1) | Package manifests and nts surface declarations used for source inclusion and surface validation; these filesystem reads remain nts policy and must be tracked as inputs. | Builder filesystem/surface policy; native host answers in Checked::inputs. |
| 7 (2) | For every captured syntax node: native syntax kind, parent, syntactic children in source/visitor order, and the named child roles and list membership needed to distinguish parameters, arguments, members, statements, modifiers and optional branches. | Node::{kind,parent,edges,child,list}; ChildRole/ListRole and roles.json; single stable-kind mapping is builder policy. |
| 8 (2) | Exact source spans in the schema's existing UTF-16 code-unit coordinates, including a token start excluding leading trivia. Native position units must be stated explicitly and converted correctly from source text where necessary. | Node::{span,token_start}, File::span, List::span; one lazy per-file UTF-16 index. |
| 9 (2) | Identifier/private-identifier names; literal token text; cooked string/template segment values; invalid-template-escape status; raw source text where the literal spelling is authoritative (numbers and bigints). | Node::{name_text,literal}; Literal raw/cooked UTF-16/invalid_template_escape. |
| 10 (2) | Operator identity for unary, binary and assignment expressions; variable declaration kind (var/let/const/using/await-using); declaration modifiers; generator asterisk; optional/rest/initializer/body presence; heritage extends-vs-implements; import value/type/defer/source phase. | Node::attributes; semantic modifiers, variable kind, operator, heritage, import phase, export assignment/meta identity. |
| 11 (2) | External/ambient module names, source-file module relationships, and literal module specifiers. | Node AST child/literal fields, File::module_symbol and Symbol::{name,exports}. |
| 12 (2) | Leading declaration documentation and tag values, plus their source association: @nts native ABI/binding/layout/surface attributes, JVM attributes and rewritten-source maps. Parsing nts-specific annotations remains nts logic. | Node::documentation and DocumentationTag source association; annotation parsing is builder policy. |
| 13 (3) | The symbol resolved at a syntax node, its stable identity, name and semantic classification: alias/module/type/object literal/method/getter/setter/optional member, plus computed readonly status. | Node::symbol; Symbol::{classification,name,readonly}; merged variable/function/class/interface/type_alias/enum/property categories are independent booleans. |
| 14 (3) | All declarations of a symbol, with native declaration identity, source-file path and source association. Preserve declaration order, merged declarations, and distinctions between declarations already captured and declarations outside the captured set. | Symbol::declarations (Node identity) and Node::source_file; capture association/merged-declaration interning is builder policy. |
| 15 (3) | The final target of an alias and each module's exports as exported-name/declaring-symbol pairs, including re-export aliases. A script has no module symbol/exports. | Symbol::{alias_target,exports}; Export preserves exported name. File::module_symbol is None for scripts. |
| 16 (3) | The type of a symbol and the symbol that declares a type. Anonymous internal type/object symbols must remain distinguishable from nominal declarations. | Symbol::{ty,declared_type}, Type::symbol; anonymous type/object literal symbol categories. |
| 17 (3) | The first declaration's source identity for shared Library::of_path classification; adding any captured declaration later clears library identity. | Symbol::declarations -> first Node::source_file::path; shared Library classification/clearing is builder policy. |
| 18 (3) | Parent/ancestor relationships of member declarations needed to tell an own member from an inherited member and to find actual declaration modifiers/initializers. | Node::parent, Node::attributes and child/list field roles; own-member selection is builder policy. |
| 19 (4) | The checker type at each node whose value/type is needed by nts, and the type of each needed symbol. | Node::ty and Symbol::{ty,ty_at}. |
| 20 (4) | Stable type identity and declaring-symbol identity; primitive categories any/unknown/never/void/undefined/null/boolean/string/number/bigint/symbol. | Type::{kind,symbol}, including distinct Symbol/UniqueSymbol and all primitive classes. |
| 21 (4) | Literal category and actual typed value (string, number, boolean, bigint sign/digits); distinguish literal from widened primitive and do not invent a default for an unavailable value. | Type::literal -> typed TypeLiteral, UTF-16 JsString and bigint sign/digits; no fabricated value. |
| 22 (4) | The checker's non-inferrable/evolving-any fact, including on intrinsic types; reference/tuple/object classifications needed before deeper inspection. | Type::{non_inferrable,evolving_any,kind,is_array,tuple_elements,reference}. |
| 23 (4) | Template-literal literal text segments, retained until their placeholder types are explored. | Type::template texts; graph traversal may defer its types. |
| 24 (5) | Union and intersection constituent types, in checker order. | Type::constituents preserves native order. |
| 25 (5) | Tuple-vs-array classification, ordered tuple element types and array element/type arguments. Current tuple arity is derived from its captured element list; no richer tuple metadata is a requirement unless separately agreed. | Type::{tuple_elements,is_array,reference}; tuple arity is builder policy from element list. |
| 26 (5) | Type parameter name and constraint; reference target and type arguments; class/interface base types. | Type::{type_parameter,reference,bases}. |
| 27 (5) | Conditional check/extends/true/false types; indexed-access object/index types; template placeholder types and literal segments; substitution/constraint facts used by the current resolver. | Type::{conditional,indexed_access,template,substitution}. |
| 28 (5) | Ordered properties: name, type, optionality, readonly (computed and declared), field/method/getter/setter classification, declaration identity and own-versus-inherited relationship. | Type::properties; Symbol/Node declaration views retain identity/modifiers/ancestry for builder own-member policy. |
| 29 (5) | Index signatures: key type, value type and readonly status, including an honestly empty property/index list. | Type::index_signatures preserves honest empty lists. |
| 30 (5) | Call signatures and construct signatures of a type. | Type::signatures(SignatureKind::{Call,Construct}). |
| 31 (5) | Pairwise checker assignability used for type relationships and source-to-bound/native type mapping. | Type::assignable_to; cross-program misuse asserts with config paths. |
| 32 (6) | Stable signature identity and its declaration where present; selected resolved signature for a call/new expression. | Signature identity/declaration; Node::resolved_signature. |
| 33 (6) | Ordered parameter symbols and their types, names, declarations, optionality and initializer presence; whether the last parameter is rest. | Signature::parameters -> Parameter metadata/symbol/type/declarations, including rest and initializer facts. |
| 34 (6) | Return type, type parameters and their constraints, construct-versus-call distinction, and the separate this parameter/type. | Signature::{return_type,type_parameters,this_parameter}; Type::type_parameter constraint; selected SignatureKind is preserved by builder. |
| 35 (6) | Type predicates: asserts versus ordinary predicate, this versus named/indexed parameter, narrowed type. | Signature::predicate -> asserts, this or indexed/named parameter, optional narrowed type. |
| 36 (6) | Actual callee declaration when it belongs to the captured program, so nts can link a direct call to its declaration. | Signature::declaration -> source-associated Node; captured-versus-external linkage is builder policy. |
| 37 (7) | The checker constant value at eligible nodes: number including NaN and signed infinities, or string, and an honest absence where not constant. | Node::constant -> typed number (NaN/infinities preserved) or JsString; raw-spelling authority/budget are builder policy. |
| 38 (7) | The checker-rendered type text at a transform's requested AST node/location. This is a transform input, not a serialized type protocol. | Node::type_text renders with this source location, also usable by compiler refusal messages. |
| 39 (7) | Diagnostics after a source rewrite, with per-file error spans, so transforms can revise or stop at their existing limit. | Session::revise returns a fresh capture revision; Checked::finish returns Finished::diagnostics; transform stopping limits are builder policy. |
| 40 (8) | Source identity/content digest and any rewrite origin/map for every captured source and configuration input. | File::{path,content_digest}; Checked::inputs; rewrite origin/map retained by builder transform policy. |
| 41 (8) | Diagnostics with severity/category, code, primary and related/nested message text, filename and exact span. | Finished::diagnostics -> category/code/message/path/UTF-16 span/chain/related. |
| 42 (8) | The complete facts accumulated above for module linking, native/scalar bindings, JVM attribute validation and schema validation. | Methods above provide facts; final module linking, bindings/JVM attributes, tally and snapshot validation are builder policy. |
