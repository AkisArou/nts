use super::*;
use crate::{ProjectSpec, SessionOptions, run};

fn with_file(source: &str, inspect: impl for<'p> FnOnce(File<'p>) + Send) {
    let options = SessionOptions::new("/__nts_ast_test__");
    run(options, |session| {
        let mut spec = ProjectSpec::new("tsconfig.json");
        spec.overlays.insert("tsconfig.json".into(), r#"{"compilerOptions":{"noLib":true,"target":"esnext","module":"preserve"},"files":["index.ts"]}"#.to_owned());
        spec.overlays.insert("index.ts".into(), source.to_owned());
        let checked = session.open(spec).expect("inline AST project");
        inspect(
            checked
                .projects()
                .next()
                .expect("program")
                .files()
                .find(|f| !f.is_declaration())
                .expect("source"),
        );
    });
}

fn nodes(file: File<'_>) -> Vec<Node<'_>> {
    let mut result = Vec::new();
    let mut pending = vec![file.root()];
    while let Some(node) = pending.pop() {
        result.push(node);
        let children: Vec<_> = node
            .edges()
            .flat_map(|edge| match edge {
                Edge::Node { node, .. } => vec![node],
                Edge::List { list, .. } => list.iter().collect(),
            })
            .collect();
        pending.extend(children.into_iter().rev());
    }
    result
}

#[test]
fn field_edges_preserve_native_order_alias_names_and_list_presence() {
    with_file(
        "import { original as local, type T } from './dep'; export { local as exposed }; export function empty() {} const text = `head${1}tail`;",
        |file| {
            let all = nodes(file);
            for &node in &all {
                let actual: Vec<_> = node
                    .edges()
                    .flat_map(|edge| match edge {
                        Edge::Node { node, .. } => vec![node.native],
                        Edge::List { list, .. } => list.iter().map(|n| n.native).collect(),
                    })
                    .collect();
                assert_eq!(
                    actual,
                    node.native.iter_children(),
                    "visitor order for {:?}",
                    node.native.kind()
                );
            }
            let alias = all
                .iter()
                .find(|n| {
                    n.native.kind() == Kind::ImportSpecifier
                        && n.child(ChildRole::ImportSpecifierPropertyName).is_some()
                })
                .expect("aliased import");
            assert_eq!(
                alias
                    .child(ChildRole::ImportSpecifierPropertyName)
                    .and_then(Node::name_text),
                Some("original")
            );
            assert_eq!(
                alias
                    .child(ChildRole::ImportSpecifierName)
                    .and_then(Node::name_text),
                Some("local")
            );
            assert!(
                all.iter()
                    .any(|n| n.native.kind() == Kind::ImportSpecifier && n.attributes().type_only)
            );
            let function = all
                .iter()
                .find(|n| n.native.kind() == Kind::FunctionDeclaration)
                .expect("function");
            assert_eq!(
                function
                    .list(ListRole::FunctionDeclarationParameters)
                    .expect("present empty parameters")
                    .iter()
                    .len(),
                0
            );
            assert!(
                function
                    .list(ListRole::FunctionDeclarationTypeParameters)
                    .is_none()
            );
            assert!(function.child(ChildRole::FunctionDeclarationBody).is_some());
            let span = all
                .iter()
                .find(|n| n.native.kind() == Kind::TemplateSpan)
                .expect("template span");
            assert_eq!(
                span.child(ChildRole::TemplateSpanExpression)
                    .expect("expression")
                    .literal()
                    .expect("number")
                    .raw,
                "1"
            );
            assert_eq!(
                span.child(ChildRole::TemplateSpanLiteral)
                    .expect("literal")
                    .literal()
                    .expect("template text")
                    .cooked,
                Some("tail".encode_utf16().collect::<Vec<_>>().as_slice())
            );
        },
    );
}

#[test]
fn utf16_literal_values_raw_spellings_and_spans_are_lossless() {
    with_file(
        "/* 😀 */ const lone='\\uD800', pair='\\uD83D\\uDE00', astral='😀', number=0xff_ff, big=12_345n; const invalid=tag`\\unicode`;",
        |file| {
            let all = nodes(file);
            let literal = |raw: &str| {
                all.iter()
                    .filter_map(|n| n.literal())
                    .find(|l| l.raw == raw)
                    .expect("literal spelling")
            };
            assert_eq!(literal("'\\uD800'").cooked, Some([0xd800].as_slice()));
            assert_eq!(
                literal("'\\uD83D\\uDE00'").cooked,
                Some([0xd83d, 0xde00].as_slice())
            );
            assert_eq!(literal("'😀'").cooked, Some([0xd83d, 0xde00].as_slice()));
            assert_eq!(literal("0xff_ff").kind, LiteralKind::Number);
            assert_eq!(literal("12_345n").kind, LiteralKind::BigInt);
            let invalid = literal("`\\unicode`");
            assert!(invalid.invalid_template_escape);
            assert!(invalid.cooked.is_none());
            let astral = all
                .iter()
                .find(|n| n.literal().is_some_and(|l| l.raw == "'😀'"))
                .expect("astral token");
            let span = astral.span().expect("source span");
            assert_eq!(span.end.0 - astral.token_start().expect("token start").0, 4);
            let byte = file.text().find("'😀'").expect("source spelling");
            assert_eq!(
                astral.token_start().expect("UTF16 token start").0 as usize,
                file.text()[..byte].encode_utf16().count()
            );
        },
    );
}

#[test]
fn semantic_attributes_keep_inherited_ambient_chain_and_export_meta_facts() {
    with_file(
        "declare namespace Ambient { interface Box { value: number } } const chain=x?.y.z; function target(){ return new.target; } const meta=import.meta; export default 1; const a=1; let b=2; var c=3; using d=resource; await using e=resource;",
        |file| {
            let all = nodes(file);
            let member = all
                .iter()
                .find(|n| n.native.kind() == Kind::PropertySignature)
                .expect("ambient member");
            assert!(member.attributes().ambient_context);
            assert!(!member.attributes().modifiers.declare);
            let outer = all
                .iter()
                .find(|n| {
                    n.native.kind() == Kind::PropertyAccessExpression && n.raw() == Some("x?.y.z")
                })
                .expect("outer optional chain");
            assert!(outer.attributes().optional_chain);
            assert!(
                all.iter()
                    .any(|n| n.attributes().meta_property == Some(MetaProperty::ImportMeta))
            );
            assert!(
                all.iter()
                    .any(|n| n.attributes().meta_property == Some(MetaProperty::NewTarget))
            );
            assert!(
                all.iter().any(
                    |n| n.attributes().export_assignment == Some(ExportAssignmentKind::Default)
                )
            );
            let kinds: Vec<_> = all
                .iter()
                .filter(|n| n.native.kind() == Kind::VariableDeclarationList)
                .filter_map(|n| n.attributes().variable_kind)
                .collect();
            for kind in [
                VariableKind::Const,
                VariableKind::Let,
                VariableKind::Var,
                VariableKind::Using,
                VariableKind::AwaitUsing,
            ] {
                assert!(kinds.contains(&kind), "{kind:?}");
            }
        },
    );
}

#[test]
fn phase_import_callees_have_distinct_typed_meta_properties() {
    with_file(
        "import.source('./dep'); import.defer('./dep'); const m = import.meta; function f() { return new.target; }",
        |file| {
            let properties: Vec<_> = nodes(file)
                .iter()
                .filter_map(|node| node.attributes().meta_property)
                .collect();
            assert_eq!(
                properties,
                [
                    MetaProperty::ImportSource,
                    MetaProperty::ImportDefer,
                    MetaProperty::ImportMeta,
                    MetaProperty::NewTarget
                ]
            );
        },
    );
}

#[test]
fn documentation_retains_tag_text_and_source_association() {
    with_file(
        "/** Greeting 😀\n * @nts.native entry_point\n * @jvm.name Work\n */\nexport function value(): number { return 1; }",
        |file| {
            let function = nodes(file)
                .into_iter()
                .find(|n| n.native.kind() == Kind::FunctionDeclaration)
                .expect("documented function");
            let docs: Vec<_> = function.documentation().collect();
            assert_eq!(docs.len(), 1);
            assert!(docs[0].raw.starts_with("/** Greeting 😀"));
            assert_eq!(docs[0].source_file.path(), file.path());
            assert!(docs[0].span.is_some());
            assert!(
                docs[0]
                    .tags
                    .iter()
                    .any(|tag| tag.name == "nts" && tag.text.contains(".native entry_point"))
            );
            assert!(
                docs[0]
                    .tags
                    .iter()
                    .any(|tag| tag.name == "jvm" && tag.text.contains(".name Work"))
            );
        },
    );
}

#[test]
fn empty_argument_list_token_start_skips_comments_to_closing_parenthesis() {
    with_file("const value = f(/* c */);", |file| {
        let call = nodes(file)
            .into_iter()
            .find(|n| n.native.kind() == Kind::CallExpression)
            .expect("call");
        let arguments = call
            .list(ListRole::CallExpressionArguments)
            .expect("present arguments");
        assert_eq!(arguments.iter().len(), 0);
        let closing = file.text().find(')').expect("closing delimiter");
        assert_eq!(
            arguments.token_start().expect("empty list token").0 as usize,
            file.text()[..closing].encode_utf16().count()
        );
        assert!(
            arguments.span().expect("raw list span").start.0
                < arguments.token_start().expect("token start").0
        );
    });
}

#[test]
fn source_file_keeps_its_statement_list_and_eof_in_native_order() {
    for (source, statements) in [
        ("", 0),
        ("const a = 1; export function f() { return a; }", 2),
    ] {
        with_file(source, move |file| {
            let root = file.root();
            let list = root
                .list(ListRole::SourceFileStatements)
                .expect("every source file owns a present statement list");
            assert_eq!(list.iter().len(), statements);
            let eof = root
                .child(ChildRole::SourceFileEndOfFileToken)
                .expect("every source file owns its EOF token");
            assert_eq!(eof.native.kind(), Kind::EndOfFile);
            let actual: Vec<_> = root
                .edges()
                .flat_map(|edge| match edge {
                    Edge::Node { node, .. } => vec![node.native],
                    Edge::List { list, .. } => list.iter().map(|node| node.native).collect(),
                })
                .collect();
            assert_eq!(actual, root.native.iter_children());
        });
    }
}
