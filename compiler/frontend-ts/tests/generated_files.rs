//! Files a build adds to a project: a generator's, over rounds, and a
//! target's surface. The project is opened with them besides its own files,
//! however its config names those.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::generated::{Complaint, Generated};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::SemanticSnapshot;

fn tsgo() -> Option<Utf8PathBuf> {
    let path = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    path.exists().then_some(path)
}

const MAIN: &str = r#"import { a } from "gen:a";
import { b } from "gen:b";
export const sum: number = a + b + extra();
"#;

/// A project whose config names its file as `names` says -- `"files"`,
/// `"include"`, or nothing, which is the default include -- importing two
/// modules only a generator declares, and calling one only `extra.d.ts` does.
fn project(name: &str, names: &str) -> Utf8PathBuf {
    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-generated-files-{}-{name}", std::process::id()));
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
    std::fs::write(dir.join("generated/extra.d.ts"), "declare function extra(): number;\n").unwrap();
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

    fn files(&mut self, tsconfig: &Utf8Path, _roots: &[String], complaints: &[Complaint]) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        *self.rounds.lock().unwrap() += 1;
        let missing = complaints.iter().find_map(|complaint| {
            (complaint.code == 2307).then(|| complaint.text.split('\'').nth(1).map(str::to_owned)).flatten()
        });
        let Some(module) = missing else { return Ok(None) };
        let short = module.trim_start_matches("gen:");
        let file = tsconfig.parent().unwrap().join(format!("generated/{short}.d.ts"));
        std::fs::write(&file, format!("declare module {module:?} {{ export const {short}: number; }}\n")).unwrap();
        self.declared.push(file);
        Ok(Some(self.declared.clone()))
    }
}

fn open(tsconfig: &Utf8Path, added: &[Utf8PathBuf]) -> (SemanticSnapshot, u32) {
    let rounds = Arc::new(Mutex::new(0));
    let mut source = TsgoApi::new(tsgo().unwrap())
        .with_generated(Box::new(OnePerRound { declared: Vec::new(), rounds: Arc::clone(&rounds) }))
        .with_added(added);
    let snapshot = source.snapshot(tsconfig).unwrap();
    let rounds = *rounds.lock().unwrap();
    (snapshot, rounds)
}

fn has_source(snapshot: &SemanticSnapshot, file: &str) -> bool {
    snapshot.sources.iter().any(|source| source.display_path.ends_with(file))
}

/// However the config names the program's own file, the program opened is
/// that file, both generated modules and the added surface, and checks clean.
///
/// **A config's `files` replaces the one it extends'**: the generators each
/// opened `{ "extends": project, "files": generated }`, which compiled none of
/// the program's own files under `"files"` or the default include.
#[test]
fn the_project_keeps_its_own_files_however_its_config_names_them() {
    if tsgo().is_none() {
        eprintln!("skipping: NTS_TSGO not set");
        return;
    }
    for names in ["files", "include", "default"] {
        let tsconfig = project(names, names);
        let extra = tsconfig.parent().unwrap().join("generated/extra.d.ts");
        let (snapshot, rounds) = open(&tsconfig, &[extra]);
        assert!(has_source(&snapshot, "src/main.ts"), "{names}: the program's own file is compiled");
        assert!(has_source(&snapshot, "generated/a.d.ts") && has_source(&snapshot, "generated/b.d.ts"), "{names}: both rounds' files");
        assert!(has_source(&snapshot, "generated/extra.d.ts"), "{names}: the added file");
        assert_eq!(rounds, 3, "{names}: a round per module, and one that adds nothing");
        let errors: Vec<_> = snapshot.diagnostics.iter().map(|d| format!("{} {}", d.code, d.message)).collect();
        assert!(errors.is_empty(), "{names}: checks clean, said {errors:?}");
    }
}
