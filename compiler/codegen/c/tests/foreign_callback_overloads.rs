//! Inline overload callback types must cross the same ABI as a shared alias.
//! Each arm takes one normal snapshot and one RC preparation, control first.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{SemanticSnapshot, TypeKind, walk};
use scratch::ScratchDir;

fn assert_callback_shapes(snapshot: &SemanticSnapshot) {
    let mut declarations = 0;
    for (at, node) in snapshot.nodes.iter().enumerate().filter(|(_, node)| {
        node.native
            .as_ref()
            .and_then(|native| native.symbol.as_deref())
            .is_some_and(|symbol| matches!(symbol, "x_ticker_once" | "x_ticker_every"))
    }) {
        let id = nts_semantic_schema::NodeId(u32::try_from(at).unwrap());
        let callback = walk::children(snapshot, id)
            .into_iter()
            .find(|parameter| {
                walk::children(snapshot, *parameter)
                    .into_iter()
                    .any(|name| walk::text_of(snapshot, name) == Some("callback"))
            })
            .expect("the exact binding declaration's callback parameter");
        let ty = snapshot.node_types[&callback];
        let TypeKind::Intersection(parts) = &snapshot.types[ty.0 as usize].kind else {
            panic!(
                "callback on {:?} remained shallow: {:?}",
                node.native, snapshot.types[ty.0 as usize]
            );
        };
        println!(
            "binding {:?}, callback {callback:?}, type {ty:?}, parts {parts:?}",
            node.native
        );
        assert!(
            parts
                .iter()
                .any(|id| matches!(snapshot.types[id.0 as usize].kind, TypeKind::Function(_))),
            "{parts:?}"
        );
        assert!(parts.iter().any(|id| matches!(&snapshot.types[id.0 as usize].kind,
            TypeKind::Object { properties } if properties.iter().any(|p| p.name.is_name("__c_closure")))), "{parts:?}");
        declarations += 1;
    }
    assert_eq!(declarations, 2, "both separately written native overloads");
}

fn materialise(shared_alias: bool) -> ScratchDir {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let label = if shared_alias {
        "shared-alias-control"
    } else {
        "inline-subject"
    };
    let dir = ScratchDir::new(&root.join("target/native-c-tests"), label);
    let original = include_str!(
        "../../../../tests/refusals/an-overload-whose-callback-is-its-own-type/types/ticker.d.ts"
    );
    let binding = if shared_alias {
        let inline = "Closure<(at: Float64) => void>";
        assert_eq!(original.matches(inline).count(), 2);
        original.replace(inline, "Callback").replace(
            "  import type { Float64, c_int } from \"@nts/scalars\";",
            "  import type { Float64, c_int } from \"@nts/scalars\";\n  type Callback = Closure<(at: Float64) => void>;",
        )
    } else {
        original.to_owned()
    };
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(
        dir.join("main.ts"),
        include_str!(
            "../../../../tests/refusals/an-overload-whose-callback-is-its-own-type/src/main.ts"
        ),
    )
    .unwrap();
    std::fs::write(dir.join("tsconfig.json"), format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts"]}}"#)).unwrap();
    dir
}

fn check_arm(shared_alias: bool) {
    let label = if shared_alias {
        "shared-alias-control"
    } else {
        "inline-subject"
    };
    let dir = materialise(shared_alias);
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(
        !snapshot.has_errors(),
        "{label}: {:?}",
        snapshot.diagnostics
    );
    assert_callback_shapes(&snapshot);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::ReferenceCounting,
            ..hir::Options::default()
        },
    )
    .unwrap_or_else(|why| panic!("{label}: {}", why.render(&snapshot.sources)));
    std::fs::write(dir.join("prepared.txt"), format!("{:#?}", prepared.program)).unwrap();
    let go = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "go" && f.exported)
        .unwrap_or_else(|| {
            panic!(
                "{label}: missing export go: {:?}",
                prepared.program.uncompiled
            )
        });
    let calls: Vec<_> = go
        .blocks
        .iter()
        .flat_map(|b| &b.ops)
        .filter_map(|id| match &go.values[id.0 as usize].kind {
            OpKind::Call {
                callee: Callee::Native(target),
                args,
                ..
            } if target.name == "x_ticker_every" => Some((target, args)),
            _ => None,
        })
        .collect();
    assert_eq!(calls.len(), 1, "{label}: {calls:?}");
    let (target, args) = calls[0];
    println!("{label}: actual native {target:?}; argument values {args:?}");
    assert_eq!(
        target.parameters.len(),
        5,
        "receiver/callback/context/destroy/every"
    );
    assert_eq!(args.len(), 5, "{label}: {args:?}");
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    assert!(emitted.is_complete(), "{label}: {:?}", emitted.diagnostics);
    assert!(
        emitted.diagnostics.is_empty(),
        "{label}: {:?}",
        emitted.diagnostics
    );
    assert!(
        emitted.writer.text().contains(" = x_ticker_every("),
        "{label}"
    );
}

#[test]
fn inline_foreign_overload_callbacks_have_the_shared_alias_abi() {
    check_arm(true);
    check_arm(false);
}
