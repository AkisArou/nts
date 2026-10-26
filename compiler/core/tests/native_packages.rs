//! A binding module's pkg-config packages (`@ntsPackage`) reach a program
//! on the terms its headers do: the modules it holds a declaration from -- a
//! function it calls, a struct it lays out -- and no other, each package with
//! the module naming it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::Utf8Path;
use nts_core::hir::{self, NativePackage};
use nts_frontend_ts::Frontend;

/// A program of `main` beside `bindings`, a script of `declare module`s.
fn snapshot(name: &str, bindings: &str, main: &str) -> nts_semantic_schema::SemanticSnapshot {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/native-package-tests"), name);
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","bindings.d.ts","{root}/runtime/native/libc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("bindings.d.ts"), bindings).unwrap();
    std::fs::write(dir.join("main.ts"), main).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    snapshot
}

const BINDINGS: &str = r#"/**
 * @ntsHeader called.h
 * @ntsPackage alpha
 */
declare module "c:called" {
  import type { c_int } from "@nts/scalars";
  export function called_value(): c_int;
}
/**
 * @ntsHeader laid.h
 * @ntsPackage beta beta-extra
 */
declare module "c:laid" {
  import type { c_int } from "@nts/scalars";
  import type { Struct } from "c:types";
  export type laid_point = Struct<{ x: c_int }, "laid_point">;
}
/**
 * @ntsHeader unused.h
 * @ntsPackage gamma
 */
declare module "c:unused" {
  import type { c_int } from "@nts/scalars";
  export function unused_value(): c_int;
}
"#;

#[test]
fn a_program_takes_the_packages_of_the_modules_it_uses() {
    let used = snapshot(
        "packages",
        BINDINGS,
        r#"import { called_value } from "c:called";
import type { laid_point } from "c:laid";
import { local } from "c:memory";
export function run(): number {
  const point = local<laid_point>();
  point.x = 1;
  return called_value() + point.x;
}
"#,
    );
    let prepared = hir::prepare(&used).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let package = |name: &str, module: &str| NativePackage {
        name: name.to_owned(),
        module: module.to_owned(),
    };
    assert_eq!(
        prepared.program.native_packages,
        [
            package("alpha", "c:called"),
            package("beta", "c:laid"),
            package("beta-extra", "c:laid"),
        ]
    );
}

#[test]
fn a_package_named_like_a_flag_is_refused_at_its_module() {
    let flagged = snapshot(
        "packages-bad",
        "/**\n * @ntsHeader f.h\n * @ntsPackage --libs\n */\ndeclare module \"c:flagged\" {\n  import type { c_int } from \"@nts/scalars\";\n  export function flagged_value(): c_int;\n}\n",
        "import { flagged_value } from \"c:flagged\";\nexport function run(): number { return flagged_value(); }\n",
    );
    let prepared = hir::prepare(&flagged).unwrap();
    // The source's error, said once and whole: no lowering-gap suffix.
    assert!(
        prepared.diagnostics.iter().any(|d| d.code == "NTS0005"
            && d.message
                == "@ntsPackage names pkg-config packages as pkg-config takes them, as in \
                    `@ntsPackage gtk4 harfbuzz-gobject` (letters, digits, `_`, `-`, `+`, `.`), \
                    and `--libs` is not one"),
        "a flag passed as a package was accepted, or refused in other words: {:?}",
        prepared.diagnostics
    );
    assert_eq!(
        prepared.program.native_packages,
        [] as [nts_core::hir::NativePackage; 0]
    );
}
