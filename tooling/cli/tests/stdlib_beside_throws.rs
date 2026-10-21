//! A program may use the compiler's own memory operations -- `malloc` and
//! `free` from `c:stdlib` -- beside a binding that throws. The collision
//! rule (`nts_codegen_common::native::layouts`) refuses a program that uses
//! them and also calls a native `malloc` or `free` declared otherwise than C
//! declares it. Lowering releases the message `@ntsThrows`' converter hands
//! back (`nts_gerror_take_message`) with C's own `free`, and until the rule
//! compared declarations rather than names, that release counted as a
//! binding's: the program below was refused with "native `free` collides
//! with the compiler's memory operations; use c:stdlib", at a location in
//! `GLib`'s generated values module rather than in the program.
//!
//! The control differs in one thing: it calls nothing that throws.

#![cfg(target_os = "linux")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "stdlib-beside-throws-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch directory");
    dir
}

/// `main.ts` in `dir`, emitted by `nts emit-c` against the bindings in
/// `bindings`: what it said on stderr, and whether it succeeded.
fn emitted(dir: &Path, bindings: &Path, main: &str) -> (bool, String) {
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
    let said = String::from_utf8_lossy(&emitted.stderr).into_owned();
    (emitted.status.success() && !said.contains("NTS"), said)
}

const KEPT: &str = "import { sizeof } from \"c:memory\";\n\
import { free, malloc } from \"c:stdlib\";\n\
import type { c_int } from \"@nts/scalars\";\n\
export function kept(): number {\n\
  const cell = malloc<c_int>(sizeof<c_int>());\n\
  if (cell === null) {\n\
    return -1;\n\
  }\n\
  cell[0] = 7;\n\
  const value = cell[0];\n\
  free(cell);\n\
  return value;\n\
}\n";

const THROWS: &str = "import { g_key_file_load_from_data, g_key_file_new } from \"c:GLib-2.0\";\n\
export function parsed(): boolean {\n\
  try {\n\
    g_key_file_load_from_data(g_key_file_new(), \"[broken\", 7);\n\
    return true;\n\
  } catch (error) {\n\
    return false;\n\
  }\n\
}\n";

#[test]
fn the_compilers_memory_operations_sit_beside_a_binding_that_throws() {
    if !Path::new("/usr/share/gir-1.0/GLib-2.0.gir").exists() {
        eprintln!("skipping: no GLib-2.0.gir");
        return;
    }
    let dir = scratch("held");
    let bindings = dir.join("bindings");
    let bound = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-gir", "GLib-2.0", "--out"])
        .arg(&bindings)
        .output()
        .expect("running nts bind-gir");
    assert!(
        bound.status.success(),
        "{}",
        String::from_utf8_lossy(&bound.stderr)
    );
    let (control, said) = emitted(&dir.join("control"), &bindings, KEPT);
    assert!(control, "the control: {said}");
    let (held, said) = emitted(&dir.join("held"), &bindings, &format!("{KEPT}{THROWS}"));
    assert!(held, "{said}");
    std::fs::remove_dir_all(dir).unwrap();
}
