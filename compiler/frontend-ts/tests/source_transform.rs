//! Source transforms: text tsgo reads in place of a file's, and the driver
//! that offers files, checks the rewrite and has the transform back off.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::transform::{NodeTypes, SourceTransform, TransformInput};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::SemanticSnapshot;

fn tsgo() -> Option<Utf8PathBuf> {
    let path = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    path.exists().then_some(path)
}

fn example(name: &str) -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"))
}

/// A one-file project under the temporary directory, as its tsconfig.
fn project(name: &str, main: &str) -> Utf8PathBuf {
    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-source-transform-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("tsconfig.json"), r#"{ "compilerOptions": { "strict": true, "noEmit": true, "target": "es2022", "module": "esnext" }, "include": ["main.ts"] }"#).unwrap();
    std::fs::write(dir.join("main.ts"), main).unwrap();
    dir.join("tsconfig.json").canonicalize_utf8().unwrap()
}

fn has_error(snapshot: &SemanticSnapshot, code: &str) -> bool {
    snapshot.diagnostics.iter().any(|d| d.code == code)
}

/// What a test transform was asked, shared with the test after the
/// transform has moved into the frontend.
#[derive(Debug, Default)]
struct Asked {
    offered: Vec<Utf8PathBuf>,
    revisions: Vec<Vec<(u32, u32)>>,
}

/// Rewrites `from` to `to` in every file it is offered, and on revision
/// backs off to the text as written if `backs_off`.
#[derive(Debug)]
struct Replace {
    from: &'static str,
    to: &'static str,
    backs_off: bool,
    written: Option<String>,
    asked: Arc<Mutex<Asked>>,
}

impl SourceTransform for Replace {
    fn identity(&self) -> String {
        format!("replace {} with {}", self.from, self.to)
    }

    fn transform(&mut self, file: &TransformInput<'_>, _: &mut dyn NodeTypes) -> Option<String> {
        self.asked.lock().unwrap().offered.push(file.path.to_owned());
        if !file.text.contains(self.from) {
            return None;
        }
        self.written = Some(file.text.to_owned());
        Some(file.text.replace(self.from, self.to))
    }

    fn revise(&mut self, _: &Utf8Path, errors: &[(u32, u32)]) -> Option<String> {
        self.asked.lock().unwrap().revisions.push(errors.to_vec());
        if self.backs_off { self.written.take() } else { None }
    }
}

fn replacing(from: &'static str, to: &'static str, backs_off: bool) -> (Box<Replace>, Arc<Mutex<Asked>>) {
    let asked = Arc::new(Mutex::new(Asked::default()));
    (Box::new(Replace { from, to, backs_off, written: None, asked: Arc::clone(&asked) }), asked)
}

/// The whole safety argument for projects without a transform, and for
/// files a transform leaves alone: tsgo reading through the client, with
/// nothing overlaid, is today's snapshot bit for bit.
#[test]
fn a_transform_that_rewrites_nothing_leaves_the_snapshot_as_it_was() {
    let Some(tsgo) = tsgo() else { return };
    for name in ["jsx", "classes"] {
        let tsconfig = example(name);
        let today = TsgoApi::for_compilation(&tsgo).snapshot(&tsconfig).unwrap();
        let (transform, asked) = replacing("\u{0}never present\u{0}", "", false);
        let through = TsgoApi::for_compilation(&tsgo).with_transform(transform).snapshot(&tsconfig).unwrap();
        assert!(!asked.lock().unwrap().offered.is_empty(), "examples/{name}: the transform was offered no file, so this compared nothing");
        assert_eq!(today.digest().unwrap(), through.digest().unwrap(), "examples/{name}: a transform that rewrote nothing changed the snapshot");
    }
}

#[test]
fn a_rewrite_is_what_nts_reads() {
    let Some(tsgo) = tsgo() else { return };
    let tsconfig = project("rewrite", "export const answer: number = 1;\n");
    let as_written = TsgoApi::new(&tsgo).snapshot(&tsconfig).unwrap();
    assert!(!has_error(&as_written, "TS2322"), "the control: the file as written typechecks");
    let (transform, asked) = replacing("= 1", "= \"one\"", false);
    let rewritten = TsgoApi::new(&tsgo).with_transform(transform).snapshot(&tsconfig).unwrap();
    assert!(has_error(&rewritten, "TS2322"), "tsgo checked the rewrite, not the disk");
    assert_eq!(asked.lock().unwrap().revisions.len(), 1, "the rewrite's error was offered for revision");
    // The error survived, and its position is in text no disk holds: the
    // file says it was rewritten, and by what, for whatever renders it.
    let error = rewritten.diagnostics.iter().find(|d| d.code == "TS2322").unwrap();
    let source = &rewritten.sources[error.primary.file.0 as usize];
    assert_eq!(source.rewritten_by.as_deref(), Some("replace = 1 with = \"one\""));
    assert!(as_written.sources.iter().all(|s| s.rewritten_by.is_none()), "the control: nothing is marked without a rewrite");
}

/// Revises forever: each revision draws an error the last did not.
#[derive(Debug)]
struct Restless {
    round: usize,
}

impl SourceTransform for Restless {
    fn identity(&self) -> String {
        "restless".to_owned()
    }

    fn transform(&mut self, file: &TransformInput<'_>, _: &mut dyn NodeTypes) -> Option<String> {
        Some(format!("{}\nexport const wrong0: number = \"0\";\n", file.text))
    }

    fn revise(&mut self, _: &Utf8Path, _: &[(u32, u32)]) -> Option<String> {
        self.round += 1;
        Some(format!("export const wrong{}: number = \"{}\";\n", self.round, self.round))
    }
}

#[test]
fn a_transform_that_never_settles_is_stopped_by_the_cap_and_says_so() {
    let Some(tsgo) = tsgo() else { return };
    let tsconfig = project("restless", "export const answer: number = 1;\n");
    let error = TsgoApi::new(&tsgo).with_transform(Box::new(Restless { round: 0 })).snapshot(&tsconfig).unwrap_err().to_string();
    assert!(error.contains("restless was still revising") && error.contains("after 4 rounds") && error.contains("the cap"), "{error}");
}

#[test]
fn a_rewrite_that_does_not_typecheck_is_revised_away() {
    let Some(tsgo) = tsgo() else { return };
    let main = "export const answer: number = 1;\n";
    let tsconfig = project("revise", main);
    let (transform, asked) = replacing("= 1", "= \"one\"", true);
    let snapshot = TsgoApi::new(&tsgo).with_transform(transform).snapshot(&tsconfig).unwrap();
    assert!(!has_error(&snapshot, "TS2322"), "the revision, the text as written, is what nts read");
    let revisions = &asked.lock().unwrap().revisions;
    assert_eq!(revisions.len(), 1, "revised once, then clean");
    // The error is on `answer`, in the rewritten text.
    let rewritten = main.replace("= 1", "= \"one\"");
    let (start, _) = revisions[0][0];
    assert!(rewritten[start as usize..].starts_with("answer"), "the error's span is in the rewritten text: {:?}", &rewritten[start as usize..]);
}
