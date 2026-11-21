//! A product named with `--entry` is prepared open or closed by its shape.
//!
//! An executable's named entries are closed (`Roots::Entry`): nothing outside
//! calls into it. An addon's or a library's are its declared surface
//! (`Roots::Declared`): the host calls them and what they return. Until the
//! shape chose, every `--entry` was closed, so `--napi --entry` and a named
//! library pruned what their host calls: a generator's resume and an exported
//! closure's call entry.
//!
//! The fixture's executable form (`--main --entry`) is the control that
//! differs in the shape alone, and it keeps pruning both.

use std::path::Path;
use std::process::Command;

const FIXTURE: &str = "tests/programs/an-addon-built-with-entry-is-prepared-open/tsconfig.json";
const ENTRY: &str = "joiner,lastSeen,upTo";
/// What only the host calls: `upTo`'s resume and `joiner`'s call entry.
const HOST_CALLED: [&str; 2] = ["upTo__resume", "Closure0#call"];

/// The functions a prepared listing defines, by name.
fn prepared(backend: &str, shape: Option<&str>) -> Vec<String> {
    let config = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(FIXTURE);
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("hir")
        .arg(&config)
        .args(["--prepared", "--backend", backend, "--checkers", "1"])
        .args(shape)
        .args(["--entry", ENTRY])
        .output()
        .expect("running nts hir");
    assert!(
        output.status.success(),
        "nts hir --backend {backend} {shape:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("a listing is UTF-8")
        .lines()
        .filter_map(|line| {
            let line = line.strip_prefix("export ").unwrap_or(line);
            let name = line.strip_prefix("func ")?;
            Some(name.split_once('(')?.0.to_owned())
        })
        .collect()
}

#[test]
fn an_addon_or_library_named_with_entry_keeps_what_its_host_calls() {
    for backend in ["c", "llvm", "jvm"] {
        for shape in [Some("--napi"), None] {
            let defined = prepared(backend, shape);
            for name in HOST_CALLED {
                assert!(
                    defined.iter().any(|func| func == name),
                    "{backend} {shape:?} --entry {ENTRY} pruned `{name}`, which its host calls: {defined:?}"
                );
            }
        }
    }
}

#[test]
fn an_executable_named_with_entry_stays_closed() {
    for backend in ["c", "llvm", "jvm"] {
        let defined = prepared(backend, Some("--main"));
        assert!(
            defined.iter().any(|func| func == "lastSeen"),
            "{backend}: the listing must define the named entries: {defined:?}"
        );
        for name in HOST_CALLED {
            assert!(
                defined.iter().all(|func| func != name),
                "{backend} --main --entry {ENTRY} kept `{name}`, which nothing in an executable calls"
            );
        }
    }
}
