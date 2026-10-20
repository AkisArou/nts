//! A program that holds a `GObject` in a closure and uses a struct a header
//! lays out compiles. The closure counts the object through the pair it
//! declares itself -- `g_object_ref_sink`, `g_object_unref` -- and the
//! struct's layout is asserted against the header, so the program includes
//! the headers, where glib-object.h defines `g_object_ref_sink` as a
//! function-like macro. Before the pair was declared through a
//! parenthesised name (b748be3aa), that declaration did not compile.
//!
//! `PangoRectangle` is the struct (a GIR record with no `GType`, a
//! `Struct`), and a `PangoContext` the `GObject`. The control differs in one
//! thing: it uses no `PangoRectangle`, so no header is included.

#![cfg(target_os = "linux")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("bind-gir-struct-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch directory");
    dir
}

fn pango_flags() -> Option<Vec<String>> {
    let output = Command::new("pkg-config")
        .args(["--cflags", "pango"])
        .output()
        .ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    })
}

/// `main.ts` in `dir`, emitted by `nts emit-c` against the bindings in
/// `bindings` into `dir/c`, with nothing refused; then `program.c` compiled.
fn compiles(dir: &Path, bindings: &Path, main: &str, flags: &[String]) -> std::process::Output {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("main.ts"), main).unwrap();
    let mut files = vec!["main.ts".to_owned()];
    for entry in std::fs::read_dir(bindings).unwrap() {
        let path = entry.unwrap().path();
        if path.to_string_lossy().ends_with(".d.ts") {
            files.push(path.display().to_string());
        }
    }
    files.push(repo.join("runtime/native/libc.d.ts").display().to_string());
    std::fs::write(
        dir.join("tsconfig.json"),
        serde_json::json!({ "extends": repo.join("tsconfig.fixtures.json"), "files": files })
            .to_string(),
    )
    .unwrap();
    let emitted = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("emit-c")
        .arg(dir.join("tsconfig.json"))
        .arg("--out")
        .arg(dir.join("c"))
        .output()
        .expect("running nts emit-c");
    let said = String::from_utf8_lossy(&emitted.stderr);
    assert!(emitted.status.success() && !said.contains("NTS"), "{said}");
    Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-w"])
        .arg(format!("-I{}", dir.join("c").display()))
        .args(flags)
        .arg(dir.join("c/program.c"))
        .output()
        .expect("running clang")
}

const HELD: &str = "import { pango_context_new, pango_extents_to_pixels } from \"c:Pango-1.0\";\n\
import type { PangoContext, PangoRectangle } from \"c:Pango-1.0\";\n\
import { local } from \"c:memory\";\n\
export function holder(): () => PangoContext {\n\
  const context = pango_context_new();\n\
  return () => context;\n\
}\n\
export function pixels(): number {\n\
  const extents = local<PangoRectangle>();\n\
  extents.width = 2048;\n\
  pango_extents_to_pixels(extents, null);\n\
  return extents.width;\n\
}\n";

const CONTROL: &str = "import { pango_context_new } from \"c:Pango-1.0\";\n\
import type { PangoContext } from \"c:Pango-1.0\";\n\
export function holder(): () => PangoContext {\n\
  const context = pango_context_new();\n\
  return () => context;\n\
}\n";

#[test]
fn a_header_struct_beside_a_gobject_compiles() {
    let Some(flags) = pango_flags() else {
        eprintln!("skipping: no pango pkg-config entry");
        return;
    };
    if !Path::new("/usr/share/gir-1.0/Pango-1.0.gir").exists() {
        eprintln!("skipping: no Pango-1.0.gir");
        return;
    }
    let dir = scratch("held");
    let bindings = dir.join("bindings");
    let bound = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-gir", "Pango-1.0", "--out"])
        .arg(&bindings)
        .output()
        .expect("running nts bind-gir");
    assert!(
        bound.status.success(),
        "{}",
        String::from_utf8_lossy(&bound.stderr)
    );
    let control = compiles(&dir.join("control"), &bindings, CONTROL, &flags);
    assert!(
        control.status.success(),
        "the control: {}",
        String::from_utf8_lossy(&control.stderr)
    );
    let held = compiles(&dir.join("held"), &bindings, HELD, &flags);
    assert!(
        held.status.success(),
        "{}",
        String::from_utf8_lossy(&held.stderr)
    );
    std::fs::remove_dir_all(dir).unwrap();
}
