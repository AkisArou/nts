use std::collections::hash_map::DefaultHasher;
use std::fmt::Write as _;
use std::hash::{Hash, Hasher};
use std::num::NonZeroU16;

use crate::*;

fn plain(name: SymbolName<'_>) -> &str {
    let SymbolName::Plain(text) = name else {
        panic!("expected ordinary name, got {name:?}");
    };
    text.utf8().expect("Unicode user name")
}

fn private_symbol(class: Node<'_>) -> Symbol<'_> {
    class
        .list(ListRole::ClassDeclarationMembers)
        .expect("class members")
        .iter()
        .next()
        .expect("field")
        .child(ChildRole::PropertyDeclarationName)
        .expect("private name")
        .symbol()
        .expect("private symbol")
}

fn options(count: u16) -> SessionOptions {
    let mut options = SessionOptions::new("/__nts_semantic_test__");
    options.checker_count = NonZeroU16::new(count);
    options
}
fn spec(source: &str) -> ProjectSpec {
    let mut spec = ProjectSpec::new("tsconfig.json");
    spec.overlays.insert(
        "tsconfig.json".into(),
        r#"{"compilerOptions":{"strict":true,"target":"ESNext"},"files":["main.ts"]}"#.to_owned(),
    );
    spec.overlays.insert("main.ts".into(), source.to_owned());
    spec
}
fn source<'p>(checked: &'p Checked<'_>) -> File<'p> {
    checked
        .projects()
        .next()
        .expect("program")
        .files()
        .find(|f| f.path().ends_with("main.ts"))
        .expect("main source")
}
fn statements(file: File<'_>) -> Vec<Node<'_>> {
    file.root()
        .list(ListRole::SourceFileStatements)
        .expect("statements")
        .iter()
        .collect()
}
fn hash(value: impl Hash) -> u64 {
    let mut hash = DefaultHasher::new();
    value.hash(&mut hash);
    hash.finish()
}

fn heritage_reference(owner: Node<'_>) -> Reference<'_> {
    owner
        .list(ListRole::ClassDeclarationHeritageClauses)
        .expect("heritage clauses")
        .iter()
        .next()
        .expect("implements")
        .list(ListRole::HeritageClauseTypes)
        .expect("heritage types")
        .iter()
        .next()
        .expect("heritage reference")
        .ty()
        .reference()
        .expect("receiver-bound reference")
}

#[test]
fn reference_arity_separates_declared_this_arguments_and_receiver_bindings() {
    let text = "interface Pair<T, U> { left: T; right: U; self: this; }\n\
class PairOwner implements Pair<number, PairOwner> {\n\
left = 1; right: PairOwner = this; self: this = this; pair!: Pair<number, this>;\n\
}\n\
interface Zero { self: this; }\n\
class ZeroOwner implements Zero { self: this = this; }\n";
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session.open(spec(text)).expect("reference arity fixture");
            // Match by the public name role, not native kind ordinals.
            let class = |name: &str| {
                statements(source(&checked))
                    .into_iter()
                    .find(|node| {
                        node.child(ChildRole::ClassDeclarationName)
                            .is_some_and(|name_node| name_node.name_text() == Some(name))
                    })
                    .expect("class declaration")
            };
            let owner = class("PairOwner");
            let bound = heritage_reference(owner);
            assert_eq!(bound.declared_parameter_count, Some(2));
            assert_eq!(bound.arguments.len(), 3);
            let pair = owner
                .list(ListRole::ClassDeclarationMembers)
                .expect("members")
                .iter()
                .find(|node| {
                    node.child(ChildRole::PropertyDeclarationName)
                        .is_some_and(|name| name.name_text() == Some("pair"))
                })
                .expect("pair field")
                .ty()
                .reference()
                .expect("declared prefix reference");
            assert_eq!(pair.declared_parameter_count, Some(2));
            assert_eq!(pair.arguments.len(), 2);
            assert_eq!(
                pair.arguments[1].kind(),
                TypeKind::TypeParameter,
                "a declared argument may itself be polymorphic this"
            );
            let zero = heritage_reference(class("ZeroOwner"));
            assert_eq!(zero.declared_parameter_count, Some(0));
            assert_eq!(zero.arguments.len(), 1);
            assert_eq!(checked.diagnose_fixture_files().finish().diagnostics(), []);
        });
    }
}

#[test]
fn function_smoke_keeps_semantic_identity_and_owned_facts_at_one_and_four_checkers() {
    fn capture(count: u16) -> (String, TypeKind, Vec<String>, Vec<Diagnostic>) {
        run(options(count), |session| {
            let checked = session
                .open(spec("export function value(): number { return 1; }"))
                .expect("project");
            let file = source(&checked);
            let function = statements(file)[0];
            let name = function
                .child(ChildRole::FunctionDeclarationName)
                .expect("name");
            let symbol = name.symbol().expect("function symbol");
            assert!(symbol.classification().function);
            assert!(!symbol.classification().alias);
            assert_eq!(symbol.declarations().collect::<Vec<_>>(), vec![function]);
            let exports = file.module_symbol().expect("module").exports();
            assert_eq!(exports.len(), 1);
            assert_eq!(exports[0].symbol, symbol);
            assert_eq!(hash(exports[0].symbol), hash(symbol));
            assert_eq!(name.ty(), symbol.ty());
            assert_eq!(hash(name.ty()), hash(symbol.ty()));
            let signatures = symbol.ty().signatures(SignatureKind::Call);
            assert_eq!(signatures.len(), 1);
            let signature = signatures[0];
            assert_eq!(signature.declaration(), Some(function));
            assert!(signature.parameters().is_empty());
            assert_eq!(signature.return_type().kind(), TypeKind::Number);
            assert!(signature.predicate().is_none());
            assert!(signature.this_parameter().is_none());
            assert_eq!(signature.type_parameters(), []);
            assert!(
                signature
                    .return_type()
                    .assignable_to(signature.return_type())
            );
            (
                plain(symbol.name()).to_owned(),
                signature.return_type().kind(),
                exports
                    .into_iter()
                    .map(|e| plain(e.name).to_owned())
                    .collect(),
                checked.diagnose_fixture_files().finish().diagnostics(),
            )
        })
    }
    assert_eq!(capture(1), capture(4));
}

#[test]
fn predicates_include_inference_asserts_and_this_subjects() {
    run(options(1), |session| {
        let checked = session
            .open(spec(
                r#"
export function inferred(x: unknown) { return typeof x === "string"; }
export function asserted(x: unknown): asserts x { if (!x) throw Error(); }
export interface Shape { valid(): this is Shape; }
"#,
            ))
            .expect("project");
        let declarations = statements(source(&checked));
        let signatures: Vec<_> = declarations[..2]
            .iter()
            .map(|d| {
                d.child(ChildRole::FunctionDeclarationName)
                    .expect("name")
                    .ty()
                    .signatures(SignatureKind::Call)[0]
            })
            .collect();
        let inferred = signatures[0].predicate().expect("inferred type predicate");
        assert!(!inferred.asserts);
        assert!(
            matches!(inferred.subject, PredicateSubject::Parameter { name, index: 0 } if name.utf8() == Some("x"))
        );
        assert_eq!(
            inferred.narrowed_type.expect("narrowed string").kind(),
            TypeKind::String
        );
        let asserted = signatures[1].predicate().expect("asserts predicate");
        assert!(asserted.asserts);
        assert!(asserted.narrowed_type.is_none());
        let interface = declarations[2]
            .child(ChildRole::InterfaceDeclarationName)
            .expect("interface")
            .symbol()
            .expect("symbol")
            .declared_type()
            .expect("declared type");
        // The method node itself is the location used to obtain its callable type.
        let method = declarations[2]
            .list(ListRole::InterfaceDeclarationMembers)
            .expect("members")
            .iter()
            .next()
            .expect("method");
        let predicate = method.ty().signatures(SignatureKind::Call)[0]
            .predicate()
            .expect("this predicate");
        assert!(matches!(predicate.subject, PredicateSubject::This));
        assert_eq!(predicate.narrowed_type.expect("Shape"), interface);
    });
}

#[test]
fn erroneous_predicate_subjects_keep_checker_diagnostics_before_and_after_capture() {
    for count in [1, 4] {
        for (subject, expected_errors) in [("condition", 1), ("_condition", 0)] {
            let source_text = format!(
                "export function assertCondition(_condition: boolean): asserts {subject} {{ \
                 if (!_condition) throw new Error('Condition failed'); }} \
                 export function test() {{ assertCondition(false); }}"
            );
            let without_capture = run(options(count), |session| {
                session
                    .open(spec(&source_text))
                    .expect("predicate project")
                    .diagnose_fixture_files()
                    .finish()
                    .diagnostics()
            });
            assert_eq!(
                without_capture.iter().filter(|d| d.code == 1225).count(),
                expected_errors
            );
            let after_capture = run(options(count), |session| {
                let checked = session.open(spec(&source_text)).expect("predicate project");
                let declaration = statements(source(&checked))[0];
                let signature = declaration
                    .child(ChildRole::FunctionDeclarationName)
                    .expect("assertion function name")
                    .ty()
                    .signatures(SignatureKind::Call)[0];
                // This semantic question precedes diagnostic finalization, as
                // it does in the builder. Erroneous source is not an invariant.
                let predicate = signature.predicate().expect("written predicate");
                assert!(predicate.asserts);
                assert!(predicate.narrowed_type.is_none());
                if expected_errors == 0 {
                    assert!(matches!(predicate.subject,
                        PredicateSubject::Parameter { name, index: 0 }
                        if name.utf8() == Some("_condition")));
                } else {
                    assert!(matches!(predicate.subject,
                        PredicateSubject::UnresolvedIdentifier { name }
                        if name.utf8() == Some("condition")));
                }
                checked.diagnose_fixture_files().finish().diagnostics()
            });
            assert_eq!(after_capture, without_capture);
        }
    }
}

#[test]
fn erroneous_declarations_keep_registered_sources_and_complete_type_payloads() {
    const CASES: &[&str] = &[
        "export interface Broken<T> extends Missing { value: T; }",
        "export type Conditional<T> = T extends Missing ? T : never;",
        "export type Indexed<T> = T[Missing];",
        "export class Broken<T> extends Missing<T> { value!: T; }",
        "export function broken(value: Missing): Missing { return value; }",
        "export type Incomplete<T = > = [T, Missing];",
    ];
    for count in [1, 4] {
        for &text in CASES {
            let baseline = run(options(count), |session| {
                session
                    .open(spec(text))
                    .expect("erroneous project")
                    .diagnose_fixture_files()
                    .finish()
                    .diagnostics()
            });
            assert!(
                baseline
                    .iter()
                    .any(|d| d.category == DiagnosticCategory::Error)
            );
            let captured = run(options(count), |session| {
                let checked = session.open(spec(text)).expect("erroneous project");
                let file = source(&checked);
                for export in file.module_symbol().expect("exporting module").exports() {
                    let symbol = export.symbol;
                    for declaration in symbol.declarations() {
                        assert_eq!(declaration.source_file().path(), file.path());
                    }
                    let ty = symbol.declared_type().unwrap_or_else(|| symbol.ty());
                    let _ = (
                        ty.reference(),
                        ty.conditional(),
                        ty.indexed_access(),
                        ty.substitution(),
                    );
                    for signature in ty.signatures(SignatureKind::Call) {
                        if let Some(declaration) = signature.declaration() {
                            assert_eq!(declaration.source_file().path(), file.path());
                        }
                        let _ = signature.predicate();
                        for parameter in signature.parameters() {
                            for declaration in parameter.declarations {
                                assert_eq!(declaration.source_file().path(), file.path());
                            }
                        }
                    }
                }
                checked.diagnose_fixture_files().finish().diagnostics()
            });
            assert_eq!(captured, baseline, "{text}");
        }
    }
}

#[test]
fn parameters_keep_defaults_rest_this_and_generic_types() {
    run(options(4), |session| {
        let checked = session.open(spec("export function args<T extends string>(this: Date, first: T, defaulted = 1, optional?: number, ...rest: string[]): T { return first; }")).expect("project");
        let declaration = statements(source(&checked))[0];
        let signature = declaration
            .child(ChildRole::FunctionDeclarationName)
            .expect("name")
            .ty()
            .signatures(SignatureKind::Call)[0];
        let parameters = signature.parameters();
        assert_eq!(
            parameters.iter().map(|p| plain(p.name)).collect::<Vec<_>>(),
            ["first", "defaulted", "optional", "rest"]
        );
        assert!(!parameters[0].optional);
        assert!(parameters[1].has_initializer);
        assert!(!parameters[1].optional);
        assert!(parameters[2].optional);
        assert!(!parameters[2].has_initializer);
        assert!(parameters[3].rest);
        assert!(!parameters[0].rest);
        assert_eq!(parameters[0].ty, signature.return_type());
        assert_eq!(signature.type_parameters(), vec![parameters[0].ty]);
        let this = signature.this_parameter().expect("explicit this");
        assert_eq!(this.name, SymbolName::Internal(InternalName::This));
        assert_eq!(this.declarations.len(), 1);
    });
}

#[test]
fn aliases_merged_symbols_literals_and_constants_remain_distinct() {
    run(options(1), |session| {
        let checked = session
            .open(spec(
                r#"
export function merge() { return 1; }
export namespace merge { export const tag = "hello"; }
export { merge as renamed };
export const text = "\ud800";
export const integer = 12n;
export const truth = true;
export const enum Values { Number = 3, Text = "\ud800", Infinity = 1 / 0, NotNumber = 0 / 0 }
"#,
            ))
            .expect("project");
        let file = source(&checked);
        let declarations = statements(file);
        let exports = file.module_symbol().expect("module").exports();
        let exported = |name: &str| {
            exports
                .iter()
                .find(|e| matches!(e.name, SymbolName::Plain(text) if text.utf8() == Some(name)))
                .expect("export")
                .symbol
        };
        let merged = exported("merge");
        assert!(merged.classification().function && merged.classification().module);
        assert_eq!(merged.declarations().len(), 2);
        let alias = exported("renamed");
        assert!(alias.classification().alias);
        assert_eq!(alias.alias_target(), Some(merged));
        assert!(
            matches!(exported("text").ty().literal(), Some(TypeLiteral::String(s)) if s.utf16() == [0xd800] && s.utf8().is_none())
        );
        assert!(matches!(
            exported("integer").ty().literal(),
            Some(TypeLiteral::BigInt {
                negative: false,
                digits: "12"
            })
        ));
        assert!(matches!(
            exported("truth").ty().literal(),
            Some(TypeLiteral::Boolean(true))
        ));
        let members: Vec<_> = declarations
            .last()
            .expect("enum")
            .list(ListRole::EnumDeclarationMembers)
            .expect("members")
            .iter()
            .collect();
        assert!(matches!(members[0].constant(), Some(Constant::Number(3.0))));
        assert!(
            matches!(members[1].constant(), Some(Constant::String(s)) if s.utf16() == [0xd800])
        );
        assert!(matches!(members[2].constant(), Some(Constant::Number(n)) if n == f64::INFINITY));
        assert!(matches!(members[3].constant(), Some(Constant::Number(n)) if n.is_nan()));
    });
}

#[test]
#[should_panic(
    expected = "different programs: /__nts_semantic_test__/one.json and /__nts_semantic_test__/two.json"
)]
fn cross_program_assignability_is_a_bug_with_both_config_paths() {
    run(options(1), |_| {
        let project_spec = |name: &str| {
            let mut project = spec("export const value = 1;");
            let config = project
                .overlays
                .remove(&camino::Utf8PathBuf::from("tsconfig.json"))
                .expect("config");
            project.config_path = name.into();
            project.overlays.insert(name.into(), config);
            project
        };
        let one = crate::program::OwnedProgram::open(&options(1), &project_spec("one.json"))
            .expect("one program");
        let two = crate::program::OwnedProgram::open(&options(1), &project_spec("two.json"))
            .expect("two program");
        let checked_one = Checked::new(&one, CaseSensitivity::Sensitive);
        let checked_two = Checked::new(&two, CaseSensitivity::Sensitive);
        let ty_one = source(&checked_one)
            .module_symbol()
            .expect("module")
            .exports()[0]
            .symbol
            .ty();
        let ty_two = source(&checked_two)
            .module_symbol()
            .expect("module")
            .exports()[0]
            .symbol
            .ty();
        let _ = ty_one.assignable_to(ty_two);
    });
}

fn with_graph(test: fn(&Checked<'_>)) {
    for count in [1, 4] {
        run(options(count), move |session| {
            let checked = session
                .open(spec(
                    r#"
export interface Root { base: boolean }
export interface Box<T extends string> extends Root {
    readonly value: T;
    optional?: number;
    method(x: T): T;
    get accessor(): number;
    set accessor(value: number);
    readonly [key: number]: string;
}
export type Ref = Box<"ok">;
export type Union = string | number;
export type Intersection = Root & { other: string };
export type Tuple = [number, string?];
export type Empty = [];
export type Array = number[];
export type Conditional<T> = T extends string ? number : boolean;
export type Indexed<T extends { value: unknown }> = T["value"];
export type Template<T extends string> = `left${T}right`;
export type Substitution<T> = T extends { value: unknown } ? T : never;
export declare const unique: unique symbol;
export declare const ordinary: symbol;
export type Nothing = {};
"#,
                ))
                .expect("project");
            test(&checked);
            let finished = checked.diagnose_fixture_files().finish();
            assert!(
                finished.diagnostics().is_empty(),
                "{:?}",
                finished.diagnostics()
            );
        });
    }
}

#[test]
fn structured_graph_preserves_instantiation_order_members_and_absence() {
    with_graph(|checked| {
        let exports = source(checked).module_symbol().expect("module").exports();
        let symbol = |name: &str| {
            exports
                .iter()
                .find(|e| matches!(e.name, SymbolName::Plain(text) if text.utf8() == Some(name)))
                .expect("export")
                .symbol
        };
        let ty = |name: &str| symbol(name).declared_type().expect("type alias/interface");
        assert_eq!(
            ty("Union")
                .constituents()
                .expect("union")
                .iter()
                .map(|t| t.kind())
                .collect::<Vec<_>>(),
            [TypeKind::String, TypeKind::Number]
        );
        let intersection = ty("Intersection");
        assert_eq!(intersection.kind(), TypeKind::Intersection);
        assert_eq!(
            intersection.constituents().expect("intersection")[0],
            ty("Root")
        );
        let tuple = ty("Tuple");
        assert_eq!(tuple.kind(), TypeKind::Tuple);
        assert_eq!(tuple.tuple_elements().expect("tuple").len(), 2);
        assert_eq!(ty("Empty").tuple_elements().expect("empty tuple"), []);
        let array = ty("Array");
        assert!(array.is_array());
        assert!(array.tuple_elements().is_none());
        assert_eq!(
            array.reference().expect("array reference").arguments[0].kind(),
            TypeKind::Number
        );
        assert!(ty("Root").reference().is_none());
        let reference = ty("Ref").reference().expect("generic reference");
        assert_eq!(reference.target, ty("Box"));
        assert!(
            matches!(reference.arguments[0].literal(), Some(TypeLiteral::String(s)) if s.utf8() == Some("ok"))
        );
        let parameter = reference
            .target
            .reference()
            .expect("generic target is its own reference")
            .arguments[0];
        let parameter_facts = parameter.type_parameter().expect("type parameter");
        assert_eq!(parameter_facts.name.utf8(), Some("T"));
        assert_eq!(
            parameter_facts.constraint.expect("constraint").kind(),
            TypeKind::String
        );
        assert_eq!(ty("Box").bases(), vec![ty("Root")]);
        let properties = ty("Ref").properties();
        assert_eq!(
            properties.iter().map(|p| plain(p.name)).collect::<Vec<_>>(),
            ["value", "optional", "method", "accessor", "base"]
        );
        assert!(properties[0].readonly && properties[0].declared_readonly);
        assert_eq!(properties[0].ty, reference.arguments[0]);
        assert!(properties[1].optional);
        assert_eq!(properties[2].kind, PropertyKind::Method);
        assert_eq!(properties[3].kind, PropertyKind::GetterSetter);
        assert_eq!(
            properties[4].declarations[0].source_file().path(),
            source(checked).path()
        );
        let indices = ty("Ref").index_signatures();
        assert_eq!(indices.len(), 1);
        assert!(indices[0].readonly);
        assert_eq!(indices[0].key.kind(), TypeKind::Number);
        assert_eq!(indices[0].value.kind(), TypeKind::String);
        assert!(ty("Nothing").properties().is_empty());
        assert!(ty("Nothing").index_signatures().is_empty());
        assert!(ty("Nothing").conditional().is_none());
    });
}

#[test]
fn generic_conditional_index_template_and_substitution_facts_are_native() {
    with_graph(|checked| {
        let exports = source(checked).module_symbol().expect("module").exports();
        let symbol = |name: &str| {
            exports
                .iter()
                .find(|e| matches!(e.name, SymbolName::Plain(text) if text.utf8() == Some(name)))
                .expect("export")
                .symbol
        };
        let ty = |name: &str| symbol(name).declared_type().expect("type alias/interface");
        let conditional = ty("Conditional")
            .conditional()
            .expect("generic conditional");
        assert_eq!(conditional.check.kind(), TypeKind::TypeParameter);
        assert_eq!(conditional.extends.kind(), TypeKind::String);
        assert_eq!(conditional.true_type.kind(), TypeKind::Number);
        assert_eq!(conditional.false_type.kind(), TypeKind::Boolean);
        let indexed = ty("Indexed").indexed_access().expect("indexed access");
        assert_eq!(indexed.object.kind(), TypeKind::TypeParameter);
        assert!(
            matches!(indexed.index.literal(), Some(TypeLiteral::String(s)) if s.utf8() == Some("value"))
        );
        let template = ty("Template").template().expect("template");
        assert_eq!(
            template
                .texts
                .iter()
                .map(|s| s.utf8().expect("text"))
                .collect::<Vec<_>>(),
            ["left", "right"]
        );
        assert_eq!(template.types[0].kind(), TypeKind::TypeParameter);
        let substituted = ty("Substitution")
            .conditional()
            .expect("conditional")
            .true_type;
        assert_eq!(substituted.kind(), TypeKind::Substitution);
        let substitution = substituted
            .substitution()
            .expect("narrowed generic substitution");
        assert_eq!(substitution.base.kind(), TypeKind::TypeParameter);
        assert_eq!(plain(substitution.constraint.properties()[0].name), "value");
        assert_eq!(symbol("unique").ty().kind(), TypeKind::UniqueSymbol);
        assert_eq!(symbol("ordinary").ty().kind(), TypeKind::Symbol);
    });
}

fn descendants<S: ViewPhase>(node: Node<'_, S>) -> Vec<Node<'_, S>> {
    let mut pending = vec![node];
    let mut nodes = Vec::new();
    while let Some(node) = pending.pop() {
        nodes.push(node);
        let children: Vec<_> = node
            .edges()
            .flat_map(|edge| match edge {
                Edge::Node { node, .. } => vec![node],
                Edge::List { list, .. } => list.iter().collect(),
            })
            .collect();
        pending.extend(children.into_iter().rev());
    }
    nodes
}

#[test]
fn finishing_preserves_syntax_metadata_and_finishes_diagnostics() {
    run(options(1), |session| {
        let checked = session
            .open(spec("export const value: number = 1;"))
            .expect("project");
        let digest = source(&checked).content_digest();
        let before = descendants(source(&checked).root()).len();
        let finished = checked.diagnose_fixture_files().finish();
        assert!(
            finished.diagnostics().is_empty(),
            "{:?}",
            finished.diagnostics()
        );
        let project = finished.projects().next().expect("program");
        assert_eq!(project.diagnostics(), finished.diagnostics());
        let file = project
            .files()
            .find(|f| f.path().ends_with("main.ts"))
            .expect("source");
        assert_eq!(file.content_digest(), digest);
        assert_eq!(descendants(file.root()).len(), before);
        assert!(file.text().contains("export const value"));
        assert!(file.root().span().is_some());
        assert_eq!(project.root_paths().len(), 1);
        assert_ne!(finished.inputs(), []);
    });
}

#[test]
fn pristine_capture_and_private_fixture_facts_do_not_depend_on_checker_count() {
    type CapturedNode = (u16, Option<usize>, usize);
    #[expect(
        clippy::mutable_key_type,
        reason = "opaque semantic Eq/Hash identities do not depend on interior caches"
    )]
    fn capture(count: u16) -> (Vec<CapturedNode>, Vec<Diagnostic>) {
        run(options(count), |session| {
            let fixture = include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../tests/programs/two-private-names-that-collide/src/main.ts"
            ));
            let checked = session.open(spec(fixture)).expect("private fixture");
            let facts = {
                let mut symbols = std::collections::HashMap::new();
                let mut types = std::collections::HashMap::new();
                descendants(source(&checked).root())
                    .into_iter()
                    .map(|node| {
                        let symbol = node.symbol().map(|symbol| {
                            let next = symbols.len();
                            *symbols.entry(symbol).or_insert(next)
                        });
                        let next = types.len();
                        let ty = *types.entry(node.ty()).or_insert(next);
                        (node.kind(), symbol, ty)
                    })
                    .collect()
            };
            let finished = checked.diagnose_fixture_files().finish();
            (facts, finished.diagnostics())
        })
    }
    let one = capture(1);
    assert!(one.1.is_empty(), "{:?}", one.1);
    assert_eq!(one, capture(4));
}

#[test]
fn builtin_bindings_use_checker_identity_and_ignore_legal_local_shadows() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session.open(spec("export function builtins() { return [undefined, NaN, Infinity, globalThis, arguments]; } export function shadow() { const NaN = 1, Infinity = 2, undefined = 3, globalThis = 4; return [NaN, Infinity, undefined, globalThis]; }")).expect("project");
            let declarations = statements(source(&checked));
            let bindings: Vec<_> = descendants(declarations[0])
                .into_iter()
                .filter_map(|node| node.symbol().and_then(Symbol::builtin_binding))
                .collect();
            for expected in [
                BuiltinBinding::Undefined,
                BuiltinBinding::NaN,
                BuiltinBinding::Infinity,
                BuiltinBinding::GlobalThis,
                BuiltinBinding::Arguments,
            ] {
                assert!(
                    bindings.contains(&expected),
                    "{expected:?} absent from {bindings:?}"
                );
            }
            assert!(
                descendants(declarations[1])
                    .into_iter()
                    .filter_map(Node::symbol)
                    .all(|symbol| symbol.builtin_binding().is_none())
            );
            let finished = checked.diagnose_fixture_files().finish();
            assert!(
                finished.diagnostics().is_empty(),
                "{:?}",
                finished.diagnostics()
            );
        });
    }
}

#[test]
fn a_parameter_named_arguments_is_not_the_checker_builtin() {
    run(options(1), |session| {
        let checked = session
            .open(spec(
                "function shadow(arguments: number) { return arguments; }",
            ))
            .expect("parameter project");
        let names: Vec<_> = descendants(source(&checked).root())
            .into_iter()
            .filter(|node| node.name_text() == Some("arguments"))
            .collect();
        assert_eq!(names.len(), 2);
        for node in names {
            assert_eq!(
                node.symbol().expect("parameter symbol").builtin_binding(),
                None
            );
        }
        // TypeScript 7.1 checks TypeScript in strict mode. Even an invalid
        // local binding must not be mistaken for the checker's builtin.
        assert!(
            checked
                .diagnose_fixture_files()
                .finish()
                .diagnostics()
                .iter()
                .any(|d| d.code == 1100)
        );
    });
}

#[test]
fn tagged_template_calls_have_a_native_selected_signature() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session.open(spec("export function tag(strings: TemplateStringsArray, value: number): number { return value; } export const result = tag`value=${1}`;")).expect("tagged project");
            let nodes = descendants(source(&checked).root());
            let tagged = nodes
                .iter()
                .find(|node| node.native.kind() == tsrs_ast::Kind::TaggedTemplateExpression)
                .expect("tagged call");
            let signature = tagged
                .resolved_signature()
                .expect("selected tagged signature");
            assert_eq!(signature.parameters().len(), 2);
            assert_eq!(signature.return_type().kind(), TypeKind::Number);
            assert_eq!(
                signature
                    .declaration()
                    .expect("tag declaration")
                    .child(ChildRole::FunctionDeclarationName)
                    .and_then(Node::name_text),
                Some("tag")
            );
            let literal = nodes
                .iter()
                .find(|node| node.native.kind() == tsrs_ast::Kind::NumericLiteral)
                .expect("substitution");
            assert!(literal.resolved_signature().is_none());
            let finished = checked.diagnose_fixture_files().finish();
            assert!(
                finished.diagnostics().is_empty(),
                "{:?}",
                finished.diagnostics()
            );
        });
    }
}

#[test]
fn resolved_calls_constructs_and_library_declarations_keep_source_identity() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session
                .open(spec(
                    r"
export function pick(value: string): string;
export function pick(value: number): number;
export function pick(value: string | number): string | number { return value; }
export class Maker { constructor(public readonly value: number) {} }
export const picked = pick(1);
export const made = new Maker(2);
export const date = new Date();
",
                ))
                .expect("project");
            let file = source(&checked);
            for node in descendants(file.root()) {
                if let Some(signature) = node.resolved_signature() {
                    let declaration = signature.declaration().expect("selected declaration");
                    if declaration.source_file().is_default_library() {
                        assert!(declaration.source_file().is_declaration());
                        assert!(declaration.source_file().path().as_str().contains("lib.es"));
                        let date_symbol = node.ty().symbol().expect("Date instance symbol");
                        assert!(
                            date_symbol
                                .declarations()
                                .all(|d| d.source_file().is_default_library())
                        );
                    } else if declaration.native.kind() == tsrs_ast::Kind::FunctionDeclaration {
                        assert_eq!(signature.return_type().kind(), TypeKind::Number);
                        assert_eq!(signature.parameters()[0].ty.kind(), TypeKind::Number);
                        assert_eq!(node.ty(), signature.return_type());
                    } else {
                        assert_eq!(declaration.native.kind(), tsrs_ast::Kind::Constructor);
                        assert_eq!(signature.parameters()[0].ty.kind(), TypeKind::Number);
                        assert_eq!(
                            plain(signature.return_type().symbol().expect("Maker").name()),
                            "Maker"
                        );
                    }
                }
            }
        });
    }
}

#[test]
fn semantic_views_release_with_each_revision_and_session() {
    for _ in 0..4 {
        run(options(1), |session| {
            {
                let checked = session
                    .open(spec("export function value() { return 1; }"))
                    .expect("project");
                let function = statements(source(&checked))[0];
                let name = function
                    .child(ChildRole::FunctionDeclarationName)
                    .expect("name");
                assert!(name.type_text().contains("number"));
                assert_eq!(
                    name.ty().signatures(SignatureKind::Call)[0]
                        .return_type()
                        .kind(),
                    TypeKind::Number
                );
            }
            let mut change = SourceChanges::default();
            change.overlays.insert(
                "main.ts".into(),
                Some("export function value() { return 'changed'; }".to_owned()),
            );
            let checked = session.revise(change).expect("revision");
            let function = statements(source(&checked))[0];
            let name = function
                .child(ChildRole::FunctionDeclarationName)
                .expect("name");
            assert!(name.type_text().contains("string"));
            assert_eq!(
                name.ty().signatures(SignatureKind::Call)[0]
                    .return_type()
                    .kind(),
                TypeKind::String
            );
        });
    }
    run(options(1), |session| {
        let checked = session.open(spec("const local = 1;")).expect("script");
        assert!(source(&checked).module_symbol().is_none());
    });
}

#[test]
fn unrepresentable_module_paths_never_become_public_invalid_utf8() {
    fn capture(escaped: &str) -> Vec<Input> {
        run(options(1), |session| {
            let checked = session
                .open(spec(&format!(
                    "import {{ value }} from './{escaped}'; export {{ value }};"
                )))
                .expect("project");
            let finished = checked.diagnose_fixture_files().finish();
            assert!(finished.diagnostics().iter().any(|d| d.code == 2307));
            finished.inputs()
        })
    }
    let invalid = capture(r"\ud800");
    let control = capture(r"\ufffd");
    assert!(control.iter().all(|i| i.path.utf8().is_some()));
    assert!(
        control
            .iter()
            .any(|i| i.path.utf8().is_some_and(|p| p.as_str().contains('�')))
    );
    let absent: Vec<_> = invalid.iter().filter(|i| i.path.utf8().is_none()).collect();
    assert_ne!(absent, [] as [&Input; 0]);
    for input in absent {
        assert!(input.path.utf16().contains(&0xd800));
        assert_eq!(input.fingerprint, input.kind.absent_fingerprint());
        assert!(input.path.to_string().contains("\\uD800"));
    }
    assert!(
        invalid
            .iter()
            .filter_map(|i| i.path.utf8())
            .all(|p| std::str::from_utf8(p.as_str().as_bytes()).is_ok())
    );
}

#[test]
fn unrepresentable_config_roots_are_a_named_load_error() {
    run(options(1), |session| {
        let mut project = spec("");
        project.overlays.insert(
            "tsconfig.json".into(),
            r#"{"compilerOptions":{"noLib":true},"files":["\ud800.ts"]}"#.to_owned(),
        );
        let error = session
            .open(project)
            .expect_err("non-Unicode root cannot name a UTF-8 file");
        assert!(error.to_string().contains("no UTF-8 filesystem path"));
        assert!(error.to_string().contains("uD800"));
        let mut control = spec("");
        control.overlays.insert(
            "tsconfig.json".into(),
            r#"{"compilerOptions":{"noLib":true},"files":["\ufffd.ts"]}"#.to_owned(),
        );
        control
            .overlays
            .insert("�.ts".into(), "export const value = 1;".to_owned());
        let checked = session
            .open(control)
            .expect("Unicode replacement is a real filename");
        let project = checked.projects().next().expect("program");
        assert!(project.root_paths().all(|p| p.as_str().ends_with("�.ts")));
        assert!(project.files().all(|f| f.path().as_str().ends_with("�.ts")));
    });
}

#[test]
fn every_host_observation_rejects_non_unicode_before_the_filesystem() {
    use tsrs_vfs::FS;
    run(options(1), |session| {
        let checked = session
            .open(spec(r#"import "./\ud800";"#))
            .expect("project");
        let file = source(&checked);
        let raw = file.native_source().imports.get()[0].text();
        let host =
            crate::host::Host::new("/__nts_semantic_test__", &std::collections::BTreeMap::new());
        assert!(!host.file_exists(raw));
        assert!(host.read_file(raw).is_none());
        assert!(!host.directory_exists(raw));
        let entries = host.get_accessible_entries(raw);
        assert!(entries.files.is_empty() && entries.directories.is_empty());
        assert!(host.stat(raw).is_none());
        assert_eq!(host.realpath(raw), "");
        let inputs = host.inputs();
        assert_eq!(inputs.len(), 6);
        for input in inputs {
            assert_eq!(
                input.path.utf16().as_ref(),
                "./".encode_utf16().chain([0xd800]).collect::<Vec<_>>()
            );
            assert!(input.path.utf8().is_none());
            assert_eq!(input.fingerprint, input.kind.absent_fingerprint());
        }
    });
}

#[test]
fn a_surrogate_pair_module_name_resolves_to_a_real_unicode_file() {
    run(options(1), |session| {
        let mut project = spec(r"export { value } from './\ud83d\ude00';");
        project
            .overlays
            .insert("😀.ts".into(), "export const value = 1;".to_owned());
        let checked = session.open(project).expect("project");
        assert!(
            checked
                .projects()
                .next()
                .expect("program")
                .files()
                .any(|f| f.path().ends_with("😀.ts"))
        );
        assert!(
            checked
                .inputs()
                .iter()
                .all(|input| input.path.utf8().is_some())
        );
    });
}

#[test]
fn private_names_keep_written_spelling_and_distinct_class_identity() {
    run(options(1), |session| {
        let checked = session.open(spec("export class A { #count = 1; } export class B { #count = 2; } export const ___three = 3;")).expect("project");
        let file = source(&checked);
        let declarations = statements(file);
        let first = private_symbol(declarations[0]);
        let second = private_symbol(declarations[1]);
        assert_ne!(first, second);
        assert!(matches!(first.name(), SymbolName::Private(name) if name.utf8() == Some("#count")));
        assert!(
            matches!(second.name(), SymbolName::Private(name) if name.utf8() == Some("#count"))
        );
        let exported = file.module_symbol().expect("module").exports();
        assert!(exported.iter().any(
            |entry| matches!(entry.name, SymbolName::Plain(name) if name.utf8() == Some("___three"))
        ));
        let written = declarations[0]
            .child(ChildRole::ClassDeclarationName)
            .expect("class")
            .symbol()
            .expect("class symbol")
            .declared_type()
            .expect("class type")
            .properties();
        assert!(
            matches!(written[0].name, SymbolName::Private(name) if name.utf8() == Some("#count"))
        );
    });
}

#[test]
fn special_export_names_are_semantic_while_member_names_are_plain() {
    for text in [
        "const value = 1; export default value;",
        "const value = 1; export { value as default };",
        "const value = 1; export = value;",
    ] {
        run(options(1), |session| {
            let checked = session.open(spec(text)).expect("project");
            let exports = source(&checked).module_symbol().expect("module").exports();
            let expected = if text.contains("export =") {
                InternalName::ExportEquals
            } else {
                InternalName::Default
            };
            assert!(
                exports
                    .iter()
                    .any(|entry| entry.name == SymbolName::Internal(expected)),
                "{exports:?}"
            );
            assert!(
                exports
                    .iter()
                    .any(|entry| entry.symbol.name() == SymbolName::Internal(expected)),
                "{exports:?}"
            );
        });
    }
    run(options(1), |session| {
        let checked = session
            .open(spec(
                "export const object = { default: 1, 'module.exports': 2, 'export=': 3, this: 4 };",
            ))
            .expect("project");
        let properties = source(&checked).module_symbol().expect("module").exports()[0]
            .symbol
            .ty()
            .properties();
        assert_eq!(
            properties
                .iter()
                .map(|property| plain(property.name))
                .collect::<Vec<_>>(),
            ["default", "module.exports", "export=", "this"]
        );
        assert!(
            properties
                .iter()
                .all(|property| matches!(property.symbol.name(), SymbolName::Plain(_)))
        );
    });
}

#[test]
fn commonjs_exports_use_the_native_export_table() {
    run(options(1), |session| {
        let mut project = spec("");
        project.overlays.insert("tsconfig.json".into(), r#"{"compilerOptions":{"allowJs":true,"checkJs":true,"noLib":true,"module":"CommonJS"},"files":["main.js"]}"#.to_owned());
        project.overlays.insert(
            "main.js".into(),
            "module.exports = { default: 1, 'module.exports': 2 };".to_owned(),
        );
        let checked = session.open(project).expect("JS program");
        let file = checked
            .projects()
            .next()
            .expect("program")
            .files()
            .find(|f| f.path().ends_with("main.js"))
            .expect("JS file");
        let exports = file.module_symbol().expect("CommonJS module").exports();
        assert!(
            exports
                .iter()
                .any(|entry| entry.name == SymbolName::Internal(InternalName::ExportEquals)),
            "{exports:?}"
        );
    });
}

#[test]
fn symbol_keyed_properties_preserve_the_unique_key_type_and_declaration() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session.open(spec("export const key: unique symbol = Symbol('key'); export interface Keys { [key]: number; [Symbol.iterator](): Iterator<number>; }")).expect("project");
            let file = source(&checked);
            let declarations = statements(file);
            let key = file
                .module_symbol()
                .expect("module")
                .exports()
                .into_iter()
                .find(|e| matches!(e.name, SymbolName::Plain(name) if name.utf8() == Some("key")))
                .expect("key export")
                .symbol
                .ty();
            let interface = declarations[1]
                .child(ChildRole::InterfaceDeclarationName)
                .expect("interface name")
                .symbol()
                .expect("interface symbol")
                .declared_type()
                .expect("interface type");
            let keys: Vec<_> = interface
                .properties()
                .into_iter()
                .map(|property| {
                    let SymbolName::Keyed(key) = property.name else {
                        panic!("expected unique-symbol key, got {:?}", property.name);
                    };
                    assert_eq!(key.kind(), TypeKind::UniqueSymbol);
                    key
                })
                .collect();
            assert_eq!(keys.len(), 2);
            assert!(keys.contains(&key));
            let iterator = keys
                .into_iter()
                .find(|ty| *ty != key)
                .expect("well-known key");
            let symbol = iterator.symbol().expect("key declaration symbol");
            assert_eq!(plain(symbol.name()), "iterator");
            let declaration = symbol
                .declarations()
                .next()
                .expect("library property declaration");
            assert!(declaration.source_file().is_default_library());
            let parent = declaration.parent().expect("SymbolConstructor interface");
            assert_eq!(
                parent
                    .child(ChildRole::InterfaceDeclarationName)
                    .and_then(Node::name_text),
                Some("SymbolConstructor")
            );
        });
    }
}

#[test]
fn well_known_keys_require_the_default_library_property_identity() {
    let expected = [
        ("asyncIterator", WellKnownSymbol::AsyncIterator),
        ("hasInstance", WellKnownSymbol::HasInstance),
        ("isConcatSpreadable", WellKnownSymbol::IsConcatSpreadable),
        ("iterator", WellKnownSymbol::Iterator),
        ("match", WellKnownSymbol::Match),
        ("matchAll", WellKnownSymbol::MatchAll),
        ("replace", WellKnownSymbol::Replace),
        ("search", WellKnownSymbol::Search),
        ("species", WellKnownSymbol::Species),
        ("split", WellKnownSymbol::Split),
        ("toPrimitive", WellKnownSymbol::ToPrimitive),
        ("toStringTag", WellKnownSymbol::ToStringTag),
        ("unscopables", WellKnownSymbol::Unscopables),
        ("dispose", WellKnownSymbol::Dispose),
        ("asyncDispose", WellKnownSymbol::AsyncDispose),
    ];
    for count in [1, 4] {
        run(options(count), |session| {
            let mut source_text = String::from(
                "declare const iterator: unique symbol; declare global { interface SymbolConstructor { readonly ntsAugmented: unique symbol; } } export const user = iterator; export const augmented = Symbol.ntsAugmented; export const keys = [",
            );
            for (name, _) in expected {
                write!(source_text, "Symbol.{name},").expect("String write");
            }
            source_text.push_str("];");
            let checked = session.open(spec(&source_text)).expect("symbol keys");
            let nodes = descendants(source(&checked).root());
            let mut library_keys = 0;
            let mut user_names = 0;
            for node in nodes {
                if node.native.kind() == tsrs_ast::Kind::PropertyAccessExpression {
                    let name = node
                        .child(ChildRole::PropertyAccessExpressionName)
                        .and_then(Node::name_text)
                        .expect("property name");
                    let ty = node.ty();
                    assert_eq!(ty.kind(), TypeKind::UniqueSymbol);
                    if name == "ntsAugmented" {
                        assert_eq!(ty.well_known_symbol(), None);
                    } else {
                        let key = expected
                            .iter()
                            .find(|(text, _)| *text == name)
                            .expect("known key")
                            .1;
                        assert_eq!(ty.well_known_symbol(), Some(key));
                        library_keys += 1;
                    }
                } else if node.name_text() == Some("iterator")
                    && node.native.kind() == tsrs_ast::Kind::Identifier
                    && node.parent().is_some_and(|parent| {
                        parent.native.kind() != tsrs_ast::Kind::PropertyAccessExpression
                    })
                {
                    assert_eq!(node.ty().kind(), TypeKind::UniqueSymbol);
                    assert_eq!(node.ty().well_known_symbol(), None);
                    user_names += 1;
                }
            }
            assert_eq!(library_keys, expected.len());
            assert_eq!(user_names, 2);
            assert_eq!(checked.diagnose_fixture_files().finish().diagnostics(), []);
        });
    }
}

#[test]
fn rest_tail_is_not_an_ordinary_optional_parameter() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session
                .open(spec(include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../tests/programs/parameters-are-rest-optional-or-initialized/src/main.ts"
                ))))
                .expect("parameter controls");
            let declarations = statements(source(&checked));
            let parameters: Vec<_> = declarations
                .iter()
                .take(5)
                .map(|declaration| {
                    declaration
                        .child(ChildRole::FunctionDeclarationName)
                        .expect("name")
                        .ty()
                        .signatures(SignatureKind::Call)[0]
                        .parameters()
                })
                .collect();
            assert!(!parameters[0][1].rest && !parameters[0][1].optional);
            assert!(parameters[1][1].rest);
            assert!(
                !parameters[1][1].optional,
                "a zero-length rest tail is not a question-optional argument"
            );
            assert!(!parameters[2][1].rest && parameters[2][1].optional);
            assert!(!parameters[3][1].rest && !parameters[3][1].optional);
            assert!(parameters[3][1].has_initializer);
            assert!(!parameters[4][0].optional && parameters[4][0].has_initializer);
            assert!(!parameters[4][1].optional && !parameters[4][1].has_initializer);
            assert_eq!(checked.diagnose_fixture_files().finish().diagnostics(), []);
        });
    }
}

#[test]
fn polymorphic_this_is_independent_of_display_names_and_ordinary_constraints() {
    let text = r"
export class Named { value = 1; self(): this { return this; } }
export class Derived extends Named { override self(): this { return this; } }
export const Anonymous = class { self(): this { return this; } };
export function bounded<T extends Named>(value: T): T { return value; }
export function shadow<Named extends Derived>(value: Named): Named { return value; }
";
    let mut previous = None;
    for count in [1, 4] {
        let facts = run(options(count), |session| {
            let checked = session.open(spec(text)).expect("this parameter fixture");
            let all = descendants(source(&checked).root());
            let mut receivers = 0;
            let mut ordinary = 0;
            let mut facts = Vec::new();
            for node in all {
                let receiver = node.native.kind() == tsrs_ast::Kind::ThisType;
                let parameter = node.native.kind() == tsrs_ast::Kind::TypeParameter;
                if !receiver && !parameter {
                    continue;
                }
                let fact = node.ty().type_parameter().expect("native type parameter");
                assert_eq!(fact.is_this, receiver);
                assert!(fact.constraint.is_some());
                receivers += usize::from(receiver);
                ordinary += usize::from(parameter);
                facts.push((fact.name.utf8().expect("name").to_owned(), fact.is_this));
            }
            assert_eq!(receivers, 3, "named, derived and anonymous receivers");
            assert_eq!(ordinary, 2, "ordinary constrained T and a shadowing name");
            assert_eq!(checked.diagnose_fixture_files().finish().diagnostics(), []);
            facts
        });
        if let Some(previous) = previous {
            assert_eq!(previous, facts);
        }
        previous = Some(facts);
    }
}
