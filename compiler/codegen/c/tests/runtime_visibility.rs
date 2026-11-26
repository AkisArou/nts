//! Every runtime source keeps its symbols to the product that carries it (#977).
//!
//! Each product links its own copy of the runtime. At default visibility an
//! `nts build` addon published about 500 runtime symbols in its dynamic table,
//! and two addons loaded `RTLD_GLOBAL` in one node bound 57 of the second one's
//! references to the first one's runtime. `nts_runtime.h`'s
//! `NTS_RUNTIME_SYMBOLS_BEGIN` hides everything a runtime source defines after
//! its system includes. These tests hold every source in `runtime/c` to that
//! rule, including a source added later, and without any build flag: a
//! hand-written build passes no `-fvisibility=hidden` either.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::node_deps;

/// What a Linux-built runtime source needs on its include path.
#[derive(Clone, Copy, Debug)]
enum Needs {
    Nothing,
    Uv,
    Glib(&'static str),
}

/// Every runtime source that builds on Linux, by name.
const LINUX: [(&str, Needs); 8] = [
    ("nts_runtime.c", Needs::Nothing),
    ("nts_unicode.c", Needs::Nothing),
    ("nts_json.c", Needs::Nothing),
    ("nts_test_host.c", Needs::Nothing),
    ("nts_uv_host.c", Needs::Uv),
    ("nts_glib_host.c", Needs::Glib("glib-2.0")),
    ("nts_gobject.c", Needs::Glib("gobject-2.0")),
    ("nts_gtk.c", Needs::Glib("gtk4")),
];

/// The sources only another platform compiles. Their regions are the same
/// macro, which expands to nothing on COFF; Apple's is the ELF pragma, unrun
/// here by policy.
const ELSEWHERE: [&str; 3] = ["nts_cf_host.c", "nts_win_host.c", "nts_winrt.c"];

fn runtime() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/c")
}

/// A new runtime source is named here, so it cannot escape the check below.
#[test]
fn every_runtime_source_is_named_by_the_visibility_check() {
    let present: BTreeSet<String> = std::fs::read_dir(runtime())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "c"))
        .map(|path| path.file_name().unwrap().to_str().unwrap().to_owned())
        .collect();
    let named: BTreeSet<String> = LINUX
        .iter()
        .map(|(name, _)| *name)
        .chain(ELSEWHERE)
        .map(str::to_owned)
        .collect();
    assert_eq!(
        present, named,
        "runtime/c's sources and the visibility check's list disagree: \
         a new source belongs in LINUX, or in ELSEWHERE with its platform"
    );
}

/// Each source's objects define nothing at default visibility, and linked into
/// one shared object they publish nothing.
///
/// The link is the half that catches a libc declaration inside a region: it
/// fails with `hidden symbol ... isn't defined` rather than misbinding.
#[test]
fn no_runtime_source_exports_a_symbol() {
    let out = crate::scratch::StdScratchDir::in_std_target("runtime-visibility");
    // `nts_unicode.c` includes the tables the compiler generates.
    for file in nts_codegen_c::support_files(nts_codegen_c::UnicodeNeeds::ALL) {
        if file.name == "nts_unicode_tables.h" {
            file.write(&out).unwrap();
        }
    }
    assert!(
        out.join("nts_unicode_tables.h").is_file(),
        "no generated tables"
    );

    let mut objects = Vec::new();
    let mut exported = Vec::new();
    for (source, needs) in LINUX {
        let Some(flags) = include_flags(needs) else {
            eprintln!("skipping {source}: no {needs:?} headers");
            continue;
        };
        let object = out.join(source.replace(".c", ".o"));
        let compiled = Command::new("clang")
            .args(["-std=c11", "-O1", "-fPIC", "-D_GNU_SOURCE", "-c", "-I"])
            .arg(&*out)
            .arg("-I")
            .arg(runtime())
            .args(&flags)
            .arg(runtime().join(source))
            .arg("-o")
            .arg(&object)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{source} did not compile:\n{}",
            String::from_utf8_lossy(&compiled.stderr)
        );
        exported.extend(
            default_definitions(&object)
                .into_iter()
                .map(|symbol| format!("{source}: {symbol}")),
        );
        objects.push(object);
    }
    assert!(
        exported.is_empty(),
        "runtime definitions outside NTS_RUNTIME_SYMBOLS_BEGIN/END: {exported:#?}"
    );

    let library = out.join("libruntime.so");
    let linked = Command::new("clang")
        .args(["-shared", "-fPIC"])
        .args(&objects)
        .args(["-lm", "-o"])
        .arg(&library)
        .output()
        .unwrap();
    assert!(
        linked.status.success(),
        "the runtime did not link as a shared object:\n{}",
        String::from_utf8_lossy(&linked.stderr)
    );
    let listed = Command::new("nm")
        .args(["-D", "--defined-only"])
        .arg(&library)
        .output()
        .unwrap();
    assert!(listed.status.success());
    let published = String::from_utf8_lossy(&listed.stdout).into_owned();
    assert!(
        published.trim().is_empty(),
        "the runtime publishes symbols:\n{published}"
    );
}

fn include_flags(needs: Needs) -> Option<Vec<String>> {
    match needs {
        Needs::Nothing => Some(Vec::new()),
        Needs::Uv => Some(node_deps::get().include_flags.clone()),
        Needs::Glib(module) => {
            let mut flags = node_deps::get().include_flags.clone();
            let found = Command::new("pkg-config")
                .args(["--cflags", module])
                .output()
                .ok()
                .filter(|output| output.status.success())?;
            flags.extend(
                String::from_utf8_lossy(&found.stdout)
                    .split_whitespace()
                    .map(str::to_owned),
            );
            Some(flags)
        }
    }
}

/// Defined global or weak symbols an object gives default visibility.
fn default_definitions(object: &Path) -> Vec<String> {
    let listed = Command::new("readelf")
        .args(["--syms", "--wide"])
        .arg(object)
        .output()
        .unwrap();
    assert!(listed.status.success());
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .filter_map(|line| {
            // Num: Value Size Type Bind Vis Ndx Name
            let fields: Vec<_> = line.split_whitespace().collect();
            let [_, _, _, _, bind, vis, ndx, name] = fields.as_slice() else {
                return None;
            };
            ((*bind == "GLOBAL" || *bind == "WEAK") && *vis == "DEFAULT" && *ndx != "UND")
                .then(|| (*name).to_owned())
        })
        .collect()
}
