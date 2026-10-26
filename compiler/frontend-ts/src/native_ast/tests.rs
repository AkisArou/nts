//! Capture tests exercise the owned arena consumed by lowering and React.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::num::NonZeroU16;

use super::*;
use native::{ProjectSpec, SessionOptions};
use nts_semantic_schema::ImportPhase;

fn tree(source: &'static str, count: u16) -> SyntaxTree {
    let mut options = SessionOptions::new("/__nts_native_capture_test__");
    options.checker_count = NonZeroU16::new(count);
    native::run(options, move |session| {
        let mut spec = ProjectSpec::new("tsconfig.json");
        spec.overlays.insert(
            "tsconfig.json".into(),
            r#"{"compilerOptions":{"noLib":true,"target":"esnext"},"files":["main.ts"]}"#.into(),
        );
        spec.overlays.insert("main.ts".into(), source.into());
        let checked = session.open(spec).expect("inline project");
        let project = checked.projects().next().expect("requested project");
        let file = project
            .files()
            .find(|file| file.path().ends_with("main.ts"))
            .unwrap();
        let captured = capture(file, SourceId(0)).expect("capture native syntax");
        assert_eq!(captured.native_nodes.len(), captured.tree.nodes.len());
        for (node, id) in &captured.by_node {
            assert_eq!(captured.native_nodes[id.0 as usize], Some(*node));
        }
        captured.tree
    })
}

fn node(tree: &SyntaxTree, kind: u16) -> &NodeRecord {
    tree.nodes
        .iter()
        .find(|node| node.kind == NodeKind::Syntax(kind))
        .unwrap()
}

fn property<'a>(tree: &'a SyntaxTree, node: &NodeRecord, name: &str) -> &'a NodeRecord {
    let NodeKind::Syntax(kind) = node.kind else {
        panic!("syntax parent")
    };
    let NodeData::Children { present, .. } = node.data else {
        panic!("child presence")
    };
    let slot = children::properties(kind)
        .iter()
        .position(|field| *field == name)
        .unwrap();
    let bit = 1_u8 << slot;
    assert_ne!(present & bit, 0, "present {name}");
    let index = (present & (bit - 1)).count_ones() as usize;
    &tree.nodes[node.children[index].0 as usize]
}

#[test]
fn native_method_body_and_empty_parameter_list_keep_the_semantic_layout() {
    let tree = tree("export class Value { answer(): number { return 1; } }", 1);
    let method = node(&tree, syntax::METHOD_DECLARATION);
    let NodeData::Children { present, .. } = method.data else {
        panic!("method children")
    };
    assert_ne!(present & (1 << 7), 0, "body is slot seven");
    assert_eq!(
        property(&tree, method, "body").kind,
        NodeKind::Syntax(syntax::BLOCK)
    );
    let parameters = property(&tree, method, "parameters");
    assert_eq!(parameters.kind, NodeKind::List);
    assert_eq!(parameters.data, NodeData::ListLength(0));
    let root = &tree.nodes[0];
    assert_eq!(root.kind, NodeKind::Syntax(syntax::SOURCE_FILE));
    assert_eq!(
        property(&tree, root, "statements").data,
        NodeData::ListLength(1)
    );
    for (index, node) in tree.nodes.iter().enumerate() {
        for child in &node.children {
            assert_eq!(
                tree.nodes[child.0 as usize].parent,
                Some(NodeId(index.try_into().unwrap()))
            );
        }
    }
}

#[test]
fn native_text_and_spans_preserve_cooked_unicode_and_raw_numbers() {
    const SOURCE: &str = "export const text = '😀é'; const number = 0x10; const big = 0x20n; const lone = '\\uD800';";
    let tree = tree(SOURCE, 1);
    let text = tree
        .nodes
        .iter()
        .find(|node| node.text.as_ref().and_then(|text| text.as_utf8()) == Some("😀é"))
        .unwrap();
    let start = SOURCE.find('\'').unwrap();
    let at = SOURCE[..start].encode_utf16().count();
    assert_eq!(
        text.origin.location.span,
        Span::new(at.try_into().unwrap(), (at + 5).try_into().unwrap())
    );
    assert!(
        tree.nodes
            .iter()
            .any(|node| node.text.as_ref().and_then(|text| text.as_utf8()) == Some("0x10"))
    );
    assert!(
        tree.nodes
            .iter()
            .any(|node| node.text.as_ref().and_then(|text| text.as_utf8()) == Some("0x20n"))
    );
    let strings: Vec<_> = tree
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Syntax(syntax::STRING_LITERAL))
        .collect();
    assert_eq!(strings.len(), 2);
    assert_eq!(
        strings[1].text.as_ref().map(|text| text.utf16()),
        Some(std::borrow::Cow::Borrowed([0xd800].as_slice())),
        "a surrogate is never replaced with a different string"
    );
}

#[test]
fn a_tagged_template_keeps_cooked_lone_units_and_raw_source_spelling() {
    const SOURCE: &str = "declare function tag(parts: TemplateStringsArray): string; export const text = tag`\\ud800`;";
    let tree = tree(SOURCE, 1);
    let template = node(&tree, syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL);
    assert_eq!(template.text.as_ref().unwrap().utf16().as_ref(), &[0xd800]);
    let span = template.origin.location.span;
    let units: Vec<_> = SOURCE.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&units[span.start as usize..span.end as usize]).unwrap(),
        "`\\ud800`"
    );
}

#[test]
fn native_flags_and_documentation_carry_the_facts_lowering_reads() {
    let tree = tree(
        "/** @ntsHeader <native.h> */\n/** @ntsAbi c */\nexport declare function external(): number;\nexport function* values() { yield* []; }\nlet n = 1; n++; const x = -n; const y = object?.value.next;\nimport value from 'value'; import type { Type } from 'type'; import defer * as later from 'later'; import source source from 'source';",
        1,
    );
    let function = node(&tree, syntax::FUNCTION_DECLARATION);
    assert!(function.modifiers.contains(DeclarationModifiers::EXPORT));
    assert!(function.modifiers.contains(DeclarationModifiers::DECLARE));
    assert_eq!(function.native.as_ref().unwrap().abi.as_deref(), Some("c"));
    assert!(
        tree.nodes
            .iter()
            .any(|node| node.modifiers.contains(DeclarationModifiers::GENERATOR))
    );
    let postfix = node(&tree, syntax::POSTFIX_UNARY_EXPRESSION);
    assert_eq!(
        postfix.data,
        NodeData::Children {
            present: 1,
            small: syntax::postfix_operator::PLUS_PLUS
        }
    );
    let prefix = node(&tree, syntax::PREFIX_UNARY_EXPRESSION);
    assert_eq!(
        prefix.data,
        NodeData::Children {
            present: 1,
            small: syntax::prefix_operator::MINUS
        }
    );
    assert!(
        tree.nodes
            .iter()
            .any(|node| node.flags & syntax::NODE_FLAGS_OPTIONAL_CHAIN != 0)
    );
    let phases: Vec<_> = tree
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Syntax(syntax::IMPORT_CLAUSE))
        .map(|node| ImportPhase::from_data(node.data).unwrap())
        .collect();
    assert_eq!(
        phases,
        [
            ImportPhase::Value,
            ImportPhase::Type,
            ImportPhase::Defer,
            ImportPhase::Source
        ]
    );
}

#[test]
fn native_capture_is_identical_with_one_or_four_checkers() {
    const SOURCE: &str = "export function value(x: number = 1): number { return x + 1; }";
    let one = tree(SOURCE, 1);
    let four = tree(SOURCE, 4);
    assert_eq!(one.digest, four.digest);
    assert_eq!(one.nodes, four.nodes);
    assert_eq!(one.diagnostics, four.diagnostics);
}

#[test]
fn interface_heritage_keeps_the_native_type_reference_shape() {
    let tree = tree(
        "interface Base { read(): number } interface Child extends Base {}",
        1,
    );
    let clause = node(&tree, syntax::HERITAGE_CLAUSE);
    let types = property(&tree, clause, "types");
    let base = &tree.nodes[types.children[0].0 as usize];
    assert_eq!(base.kind, NodeKind::Syntax(syntax::TYPE_REFERENCE));
    assert_eq!(
        property(&tree, base, "typeName")
            .text
            .as_ref()
            .and_then(|text| text.as_utf8()),
        Some("Base")
    );
}

#[test]
fn an_empty_list_after_a_comment_starts_at_the_following_token() {
    const SOURCE: &str = "export function value() { return f(/* c */); }";
    let tree = tree(SOURCE, 1);
    let call = node(&tree, syntax::CALL_EXPRESSION);
    let arguments = property(&tree, call, "arguments");
    let close = SOURCE.find("*/)").unwrap() + 2;
    assert_eq!(
        arguments.origin.location.span.start,
        u32::try_from(close).unwrap()
    );
    assert_eq!(arguments.data, NodeData::ListLength(0));
}
