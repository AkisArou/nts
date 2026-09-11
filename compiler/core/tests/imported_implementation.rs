//! A name from a package is not a builtin, and the refusal has to say which.
//!
//! # Why this is a test and not a wording preference
//!
//! Two different failures wore one sentence. A callee the checker resolved to
//! no declaration is either a builtin this compiler has not implemented, or a
//! name whose package published no TypeScript to compile — and the second
//! became the common case the moment dependencies started being acquired,
//! because most packages publish only generated JavaScript.
//!
//! Reported as a missing builtin, it sends its reader to `hir::builtin` to look
//! for something that is not missing. The two are told apart from the *import*
//! rather than from the declaration: `SymbolRecord::declarations` is empty for
//! a symbol declared outside the decoded file set, so a `lib.d.ts` name has
//! none, and an imported one declares at its own import specifier — which is
//! decoded, because this program wrote it.
//!
//! The fixture is built rather than checked in: what is under test is a
//! *layout* — a package that resolves to declarations with no implementation —
//! and the code that makes one reads better than the directory would.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};

use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn write(at: &Utf8Path, text: &str) {
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(at, text).unwrap();
}

/// A project importing one name from a package that ships no TypeScript, and
/// calling one `lib.d.ts` global that this compiler does not provide.
fn fixture(name: &str) -> Utf8PathBuf {
    let root = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&root);

    write(
        &root.join("node_modules/leftpad/package.json"),
        r#"{"name":"leftpad","version":"1.0.0","main":"./index.js","types":"./index.d.ts"}"#,
    );
    write(
        &root.join("node_modules/leftpad/index.js"),
        "module.exports = { pad: (s) => s };\n",
    );
    write(
        &root.join("node_modules/leftpad/index.d.ts"),
        "export declare function pad(s: string): string;\n",
    );
    write(
        &root.join("src/main.ts"),
        "import { pad } from \"leftpad\";\n\
         \n\
         export function fromPackage(n: number): number {\n\
         \x20 return pad(\"x\").length + n;\n\
         }\n\
         \n\
         export function fromLib(n: number): number {\n\
         \x20 return decodeURIComponent(String(n)).length + n;\n\
         }\n",
    );
    write(
        &root.join("tsconfig.json"),
        r#"{ "compilerOptions": { "lib": ["ESNext"], "module": "preserve",
             "target": "esnext", "moduleResolution": "bundler",
             "moduleDetection": "force", "strict": true, "noEmit": true,
             "skipLibCheck": true, "types": [] },
             "include": ["src/**/*"] }"#,
    );
    root
}

/// Every refusal the program produced, as text.
fn refusals(root: &Utf8Path) -> Option<Vec<String>> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = root.join("tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).ok()?;
    let prepared = hir::prepare(&snapshot).ok()?;
    Some(
        prepared
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.clone())
            .collect(),
    )
}

/// The two cases produce two different sentences, and only one of them is
/// about builtins.
#[test]
fn an_imported_name_is_not_reported_as_a_missing_builtin() {
    let root = fixture("imported-implementation");
    let Some(refusals) = refusals(&root) else {
        // No tsgo built: the same skip every frontend-dependent test takes.
        return;
    };

    let imported: Vec<&String> = refusals
        .iter()
        .filter(|line| line.contains("`pad`"))
        .collect();
    assert!(
        !imported.is_empty(),
        "`pad` has no implementation here and must be refused; got {refusals:#?}"
    );
    for line in &imported {
        assert!(
            line.contains("an imported name whose implementation is not in this program"),
            "a name from a package must say so, not send its reader to `hir::builtin`: {line}"
        );
        assert!(
            !line.contains("a builtin this compiler does not provide"),
            "and must not claim to be a builtin: {line}"
        );
    }
}

/// The other half, which is what keeps the first honest: a name that really is
/// a `lib.d.ts` global this compiler has not implemented keeps saying so.
///
/// Without this, "never say builtin" would pass by never saying it.
///
/// **The global has to be swapped as they are implemented**, which is the cost
/// of testing a negative and is worth paying rather than weakening the
/// assertion. This was `parseFloat` until it was provided on 2026-09-11, and
/// the test failing that day is the test working: it is pinned to a name that
/// is genuinely absent, not to a shape that resembles absence.
/// `decodeURIComponent` is the current one, and
/// `blockers/missing-builtin` is where its own cone is recorded.
#[test]
fn a_library_global_is_still_reported_as_a_builtin() {
    let root = fixture("library-global");
    let Some(refusals) = refusals(&root) else {
        return;
    };

    let library: Vec<&String> = refusals
        .iter()
        .filter(|line| line.contains("`decodeURIComponent`"))
        .collect();
    assert!(
        !library.is_empty(),
        "`decodeURIComponent` is not provided and must be refused; got {refusals:#?}"
    );
    for line in &library {
        assert!(
            line.contains("a builtin this compiler does not provide"),
            "a `lib.d.ts` global has no import to blame, and this is where a \
             reader should look in `hir::builtin`: {line}"
        );
    }
}
