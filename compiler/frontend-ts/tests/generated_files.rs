//! Files a build adds to a project: a generator's, over rounds, and a
//! target's surface. The project is opened with them besides its own files,
//! however its config names those.
//!

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_frontend_ts::generated::{Complaint, Generated};
use nts_semantic_schema::SemanticSnapshot;

const MAIN: &str = r#"import { a } from "gen:a";
import { b } from "gen:b";
export const sum: number = a + b + extra();
"#;

/// A project whose config names its file as `names` says -- `"files"`,
/// `"include"`, or nothing, which is the default include -- importing two
/// modules only a generator declares, and calling one only `extra.d.ts` does.
fn project(name: &str, names: &str) -> Utf8PathBuf {
    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!("nts-generated-files-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::create_dir_all(dir.join("generated")).unwrap();
    let listing = match names {
        "files" => r#", "files": ["src/main.ts"]"#,
        "include" => r#", "include": ["src"]"#,
        _ => "",
    };
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{ "compilerOptions": {{ "strict": true, "noEmit": true, "target": "es2022", "module": "esnext" }}{listing} }}"#),
    )
    .unwrap();
    std::fs::write(dir.join("src/main.ts"), MAIN).unwrap();
    std::fs::write(
        dir.join("generated/extra.d.ts"),
        "declare function extra(): number;\n",
    )
    .unwrap();
    dir.join("tsconfig.json").canonicalize_utf8().unwrap()
}

/// Declares one module the checker cannot find per round, so a program
/// importing two takes two rounds: the second opens the project again with
/// both. What it was asked, kept for the test.
#[derive(Debug)]
struct OnePerRound {
    declared: Vec<Utf8PathBuf>,
    rounds: Arc<Mutex<u32>>,
}

impl Generated for OnePerRound {
    fn identity(&self) -> String {
        "one-per-round".to_owned()
    }

    fn import_prefixes(&self) -> Option<&[&str]> {
        Some(&["gen:"])
    }

    fn files(
        &mut self,
        tsconfig: &Utf8Path,
        _roots: &[String],
        complaints: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        *self.rounds.lock().unwrap() += 1;
        let missing = complaints.iter().find_map(|complaint| {
            (complaint.code == 2307)
                .then(|| complaint.text.split('\'').nth(1).map(str::to_owned))
                .flatten()
        });
        let Some(module) = missing else {
            return Ok(None);
        };
        let short = module.trim_start_matches("gen:");
        let file = tsconfig
            .parent()
            .unwrap()
            .join(format!("generated/{short}.d.ts"));
        std::fs::write(
            &file,
            format!("declare module {module:?} {{ export const {short}: number; }}\n"),
        )
        .unwrap();
        self.declared.push(file);
        Ok(Some(self.declared.clone()))
    }
}

fn open(tsconfig: &Utf8Path, added: &[Utf8PathBuf]) -> (SemanticSnapshot, u32) {
    let rounds = Arc::new(Mutex::new(0));
    let mut source = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .with_generated(Box::new(OnePerRound {
            declared: Vec::new(),
            rounds: Arc::clone(&rounds),
        }))
        .with_added(added);
    let snapshot = source.snapshot(tsconfig).unwrap();
    let rounds = *rounds.lock().unwrap();
    (snapshot, rounds)
}

fn has_source(snapshot: &SemanticSnapshot, file: &str) -> bool {
    snapshot
        .sources
        .iter()
        .any(|source| source.display_path.ends_with(file))
}

/// However the config names the program's own file, the program opened is
/// that file, both generated modules and the added surface, and checks clean.
///
/// **A config's `files` replaces the one it extends'**: the generators each
/// opened `{ "extends": project, "files": generated }`, which compiled none of
/// the program's own files under `"files"` or the default include.
#[test]
fn the_project_keeps_its_own_files_however_its_config_names_them() {
    for names in ["files", "include", "default"] {
        let tsconfig = project(names, names);
        let extra = tsconfig.parent().unwrap().join("generated/extra.d.ts");
        let (snapshot, rounds) = open(&tsconfig, &[extra]);
        assert!(
            has_source(&snapshot, "src/main.ts"),
            "{names}: the program's own file is compiled"
        );
        assert!(
            has_source(&snapshot, "generated/a.d.ts") && has_source(&snapshot, "generated/b.d.ts"),
            "{names}: both rounds' files"
        );
        assert!(
            has_source(&snapshot, "generated/extra.d.ts"),
            "{names}: the added file"
        );
        assert_eq!(
            rounds, 3,
            "{names}: a round per module, and one that adds nothing"
        );
        let errors: Vec<_> = snapshot
            .diagnostics
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect();
        assert!(errors.is_empty(), "{names}: checks clean, said {errors:?}");
    }
}

#[derive(Debug)]
struct NoFiles {
    complaints: Arc<Mutex<Option<Vec<Complaint>>>>,
}

impl Generated for NoFiles {
    fn identity(&self) -> String {
        "no-files".to_owned()
    }

    fn import_prefixes(&self) -> Option<&[&str]> {
        Some(&["gi:", "c:"])
    }

    fn files(
        &mut self,
        _tsconfig: &Utf8Path,
        _roots: &[String],
        complaints: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        *self.complaints.lock().unwrap() = Some(complaints.to_vec());
        Ok(None)
    }
}

/// Asking for diagnostics before capture allocates the checker's unique-symbol
/// names in a different order. A generator that does nothing must not do that.
#[test]
fn an_inactive_generator_preserves_the_snapshot() {
    let config = project("inactive", "files");
    std::fs::write(
        config.parent().unwrap().join("src/main.ts"),
        r#"const first = Symbol("first");
const second = Symbol("second");
export class Box {
    [second] = 2;
    [first] = 1;
}
export function answer(box: Box): number { return box[first] + box[second]; }
export const ordinary = 'gi:cairo';
// import type { Context } from "gi:cairo";
"#,
    )
    .unwrap();
    let control = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let complaints = Arc::new(Mutex::new(None));
    let subject = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .with_generated(Box::new(NoFiles {
            complaints: Arc::clone(&complaints),
        }))
        .snapshot(&config)
        .unwrap();
    assert_eq!(
        serde_json::to_value(subject).unwrap(),
        serde_json::to_value(control).unwrap(),
        "an inactive generator must leave the complete snapshot unchanged"
    );
    assert!(complaints.lock().unwrap().is_none());

    // The control differs by one real import. Only it may ask for complaints.
    let file = config.parent().unwrap().join("src/main.ts");
    let text = std::fs::read_to_string(&file).unwrap();
    std::fs::write(
        &file,
        format!("import type {{ Context }} from \"gi:cairo\";\n{text}"),
    )
    .unwrap();
    Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .with_generated(Box::new(NoFiles {
            complaints: Arc::clone(&complaints),
        }))
        .snapshot(&config)
        .unwrap();
    assert!(
        complaints
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .iter()
            .any(|d| { d.code == 2307 && d.text.contains("gi:cairo") }),
        "the one-import control must reach the generator"
    );
}

/// The preflight follows the parser's module list, across syntax forms and
/// imported sources outside the config's roots. Escapes are already cooked.
#[test]
fn generator_imports_are_found_in_every_module_form() {
    let config = project("module-forms", "files");
    let root = config.parent().unwrap();
    std::fs::create_dir_all(root.join("vendor")).unwrap();
    // This source is reached through an import, not listed in tsconfig.files.
    std::fs::write(
        root.join("src/main.ts"),
        "import '../vendor/imports';\nexport const answer = 1;\n",
    )
    .unwrap();
    for form in [
        "import { Context } from 'gi:cairo';",
        "import 'gi:cairo';",
        "import type { Context } from 'gi:cairo';",
        "export { Context } from 'gi:cairo';",
        "export * from 'gi:cairo';",
        "export type Context = import('gi:cairo').Context;",
        "export const loading = import('gi:cairo');",
        r"import type { Context } from 'gi:\u0063airo';",
        "import type { Context } from 'c:cairo';",
    ] {
        std::fs::write(root.join("vendor/imports.ts"), form).unwrap();
        let complaints = Arc::new(Mutex::new(None));
        Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .with_generated(Box::new(NoFiles {
                complaints: Arc::clone(&complaints),
            }))
            .snapshot(&config)
            .unwrap();
        assert!(
            complaints.lock().unwrap().is_some(),
            "the generator must be called for {form}"
        );
    }
}
