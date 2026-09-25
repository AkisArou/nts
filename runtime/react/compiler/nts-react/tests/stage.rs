//! A file through the stage, against tsgo: what it compiles, and that a
//! function handed back as failing is printed exactly as the user wrote it.
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_react::print::{NoTypes, PrintOptions};
use nts_react::project::Session;
use nts_react::stage::{self, FunctionState, Outcome};
use nts_react::tsgo::Nodes;

fn session() -> Option<Session> {
    let tsgo = std::env::var("NTS_TSGO").ok()?;
    if !Utf8Path::new(&tsgo).exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/jsx-lowering/tsconfig.json").canonicalize_utf8().expect("checked in");
    Some(Session::open(&tsconfig).expect("tsgo opens the fixtures"))
}

fn compile(session: &mut Session, name: &str, print: &PrintOptions) -> (String, Outcome) {
    let path: Utf8PathBuf = session.own_sources().unwrap().into_iter().find(|p| p.file_name() == Some(name)).expect("a fixture");
    let tree = session.file(&path).unwrap();
    let code = std::fs::read_to_string(&path).unwrap();
    let outcome = stage::compile_file(&code, Nodes::new(&tree.nodes), path.as_str(), &stage::default_options(), &mut NoTypes, print).expect("the stage takes it");
    (code, outcome)
}

#[test]
fn a_component_compiles_and_reports_where_it_went() {
    let Some(mut session) = session() else { return };
    let (_, outcome) = compile(&mut session, "keys.tsx", &PrintOptions::default());
    let keys = outcome.functions.iter().find(|f| f.name.as_deref() == Some("Keys")).expect("Keys is reported");
    assert_eq!(keys.state, FunctionState::Compiled);
    let (start, end) = keys.output.expect("printed from the compiler's output");
    let printed: String = String::from_utf16_lossy(&outcome.text.encode_utf16().collect::<Vec<_>>()[start as usize..end as usize]);
    assert!(printed.starts_with("function Keys(") && printed.contains("$[0]"), "the range is the compiled function: {printed}");
}

#[test]
fn a_function_handed_back_is_printed_as_written() {
    let Some(mut session) = session() else { return };
    let (code, compiled) = compile(&mut session, "keys.tsx", &PrintOptions::default());
    let keys = compiled.functions.iter().find(|f| f.name.as_deref() == Some("Keys")).unwrap();
    let as_written = PrintOptions { as_written: [keys.span].into_iter().collect(), ..PrintOptions::default() };
    let (_, fallen_back) = compile(&mut session, "keys.tsx", &as_written);
    let source: Vec<u16> = code.encode_utf16().collect();
    let original = String::from_utf16_lossy(&source[keys.span.0 as usize..keys.span.1 as usize]);
    assert!(fallen_back.text.contains(&original), "the user's Keys, verbatim");
    assert!(!fallen_back.text.contains("$[0]"), "and no compiled Keys beside it");
    let keys = fallen_back.functions.iter().find(|f| f.name.as_deref() == Some("Keys")).unwrap();
    assert_eq!(keys.output, None, "a function printed as written has no compiled range");
}
