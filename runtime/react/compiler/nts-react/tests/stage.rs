//! A file through the native stage: what it compiles, and that a
//! function handed back as failing is printed exactly as the user wrote it.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_react::print::{NoTypes, PrintOptions};
use nts_react::stage::{self, FunctionState, Outcome};
use nts_react::syntax::Nodes;

fn compile(name: &str, print: &PrintOptions) -> (String, Outcome) {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/jsx-lowering/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked in");
    nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .inspect(
            &tsconfig,
            |file, _| -> Result<_, nts_semantic_schema::SnapshotError> {
                Ok(
                    if file.path.starts_with(tsconfig.parent().unwrap())
                        && file.path.file_name() == Some(name)
                    {
                        let outcome = stage::compile_file(
                            file.text,
                            Nodes::new(&file.tree.nodes),
                            file.path.as_str(),
                            &stage::default_options(),
                            &mut NoTypes,
                            print,
                        )
                        .expect("the stage takes it");
                        Some((file.text.to_owned(), outcome))
                    } else {
                        None
                    },
                )
            },
        )
        .unwrap()
        .into_iter()
        .flatten()
        .next()
        .expect("a fixture")
}

#[test]
fn a_component_compiles_and_reports_where_it_went() {
    let (_, outcome) = compile("keys.tsx", &PrintOptions::default());
    let keys = outcome
        .functions
        .iter()
        .find(|f| f.name.as_deref() == Some("Keys"))
        .expect("Keys is reported");
    assert_eq!(keys.state, FunctionState::Compiled);
    let (start, end) = keys.output.expect("printed from the compiler's output");
    let printed: String = String::from_utf16_lossy(
        &outcome.text.encode_utf16().collect::<Vec<_>>()[start as usize..end as usize],
    );
    assert!(
        printed.starts_with("function Keys(") && printed.contains("$[0]"),
        "the range is the compiled function: {printed}"
    );
}

#[test]
fn a_function_handed_back_is_printed_as_written() {
    let (code, compiled) = compile("keys.tsx", &PrintOptions::default());
    let keys = compiled
        .functions
        .iter()
        .find(|f| f.name.as_deref() == Some("Keys"))
        .unwrap();
    let as_written = PrintOptions {
        as_written: [keys.span].into_iter().collect(),
        ..PrintOptions::default()
    };
    let (_, fallen_back) = compile("keys.tsx", &as_written);
    let source: Vec<u16> = code.encode_utf16().collect();
    let original = String::from_utf16_lossy(&source[keys.span.0 as usize..keys.span.1 as usize]);
    assert!(
        fallen_back.text.contains(&original),
        "the user's Keys, verbatim"
    );
    assert!(
        !fallen_back.text.contains("$[0]"),
        "and no compiled Keys beside it"
    );
    let keys = fallen_back
        .functions
        .iter()
        .find(|f| f.name.as_deref() == Some("Keys"))
        .unwrap();
    assert_eq!(
        keys.output, None,
        "a function printed as written has no compiled range"
    );
}
