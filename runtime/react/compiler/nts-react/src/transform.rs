//! The stage as nts runs it: a [`SourceTransform`] the frontend drives
//! before it reads a project.
//!
//! Each of the project's own files is compiled ([`stage::compile_file`]). A
//! rewritten file whose output has errors is revised: every compiled
//! function an error falls inside is printed as the user wrote it instead,
//! and the file is printed again from what was already learned -- the syntax
//! tree and the checker's answers are those of the source, which a revision
//! does not change. A revision that finds no compiled function to give back
//! keeps the text, and its errors are the build's.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::ast::EncodedSourceFile;
use nts_diagnostics::Severity;
use nts_frontend_ts::tsgo::transform::{NodeTypes, Reported, SourceTransform, TransformInput};
use nts_semantic_schema::NodeId;
use rustc_hash::FxHashMap;
use serde_json::Value;

use crate::print::{PrintOptions, TypeOracle};
use crate::stage::{self, Function, FunctionState};
use crate::tsgo::Nodes;

/// The React Compiler revision this stage runs: third_party/react-compiler.
pub const COMPILER_PIN: &str = "1d34f91dfde6bba84d08b683aaba164c7194dacb";

/// What the stage did to a project, by file: filled in as the frontend runs
/// it, read by whoever reports on the build.
pub type Report = Arc<Mutex<FxHashMap<Utf8PathBuf, FileReport>>>;

#[derive(Debug, Clone, Default)]
pub struct FileReport {
    pub functions: Vec<Function>,
    /// Compiled functions printed as written because their compiled form did
    /// not typecheck, by original span.
    pub fell_back: Vec<(u32, u32)>,
    /// Why the file could not go through the stage, if it could not.
    pub refused: Option<String>,
}

#[derive(Debug)]
pub struct ReactTransform {
    options: Value,
    lower_jsx: bool,
    files: FxHashMap<Utf8PathBuf, FileState>,
    report: Report,
}

/// What a revision needs to print a file again.
#[derive(Debug)]
struct FileState {
    code: String,
    tree: EncodedSourceFile,
    /// The checker's answers, by node, as the first print asked them.
    types: FxHashMap<u32, Option<String>>,
    print: PrintOptions,
    functions: Vec<Function>,
}

impl ReactTransform {
    /// The stage with the compiler's `options` ([`stage::default_options`]),
    /// lowering JSX; and the report it fills in.
    #[must_use]
    pub fn new(options: Value) -> (Self, Report) {
        let report = Report::default();
        (Self { options, lower_jsx: true, files: FxHashMap::default(), report: Arc::clone(&report) }, report)
    }

    fn print(&self, path: &Utf8Path, state: &mut FileState, types: &mut dyn TypeOracle) -> Option<stage::Outcome> {
        let nodes = Nodes::new(&state.tree.nodes);
        match stage::compile_file(&state.code, nodes, path.as_str(), &self.options, types, &state.print) {
            Ok(outcome) => Some(outcome),
            Err(why) => {
                self.report.lock().ok()?.entry(path.to_owned()).or_default().refused = Some(why.to_string());
                None
            }
        }
    }

    fn record(&self, path: &Utf8Path, state: &FileState) {
        if let Ok(mut report) = self.report.lock() {
            let entry = report.entry(path.to_owned()).or_default();
            entry.functions.clone_from(&state.functions);
            entry.fell_back = state.print.as_written.iter().copied().collect();
            entry.fell_back.sort_unstable();
        }
    }
}

/// The checker's answers, remembered as they are given.
struct Remembering<'a> {
    types: &'a mut dyn NodeTypes,
    answers: &'a mut FxHashMap<u32, Option<String>>,
}

impl TypeOracle for Remembering<'_> {
    fn type_at(&mut self, node: u32) -> Option<String> {
        if let Some(answer) = self.answers.get(&node) {
            return answer.clone();
        }
        let answer = self.types.type_at(NodeId(node));
        self.answers.insert(node, answer.clone());
        answer
    }
}

/// The answers a first print remembered; a node it never asked about has none.
struct Remembered<'a>(&'a FxHashMap<u32, Option<String>>);

impl TypeOracle for Remembered<'_> {
    fn type_at(&mut self, node: u32) -> Option<String> {
        self.0.get(&node).cloned().flatten()
    }
}

/// A function as a reader finds it in their own file on disk -- not in the
/// rewritten text, which no disk holds: its name where the compiler knows
/// it, and where it is.
fn described(function: &Function, path: &Utf8Path, code: &str) -> String {
    let units: Vec<u16> = code.encode_utf16().collect();
    let before = String::from_utf16_lossy(&units[..(function.span.0 as usize).min(units.len())]);
    let line = before.matches('\n').count() + 1;
    match &function.name {
        Some(name) => format!("`{name}` ({path}:{line})"),
        None => format!("the function at {path}:{line}"),
    }
}

impl SourceTransform for ReactTransform {
    fn identity(&self) -> String {
        let options = serde_json::to_string(&self.options).unwrap_or_default();
        format!("react-compiler@{COMPILER_PIN} jsx={} {:032x}", self.lower_jsx, xxhash_rust::xxh3::xxh3_128(options.as_bytes()))
    }

    fn transform(&mut self, file: &TransformInput<'_>, types: &mut dyn NodeTypes) -> Option<String> {
        let mut state = FileState {
            code: file.text.to_owned(),
            tree: file.tree.clone(),
            types: FxHashMap::default(),
            print: PrintOptions { lower_jsx: self.lower_jsx, ..PrintOptions::default() },
            functions: Vec::new(),
        };
        let mut answers = std::mem::take(&mut state.types);
        let outcome = self.print(file.path, &mut state, &mut Remembering { types, answers: &mut answers });
        state.types = answers;
        let outcome = outcome?;
        state.functions = outcome.functions;
        self.record(file.path, &state);
        let rewritten = outcome.changed.then_some(outcome.text);
        self.files.insert(file.path.to_owned(), state);
        rewritten
    }

    fn diagnostics(&self, path: &Utf8Path) -> Vec<Reported> {
        let warning = |code, message| Reported { severity: Severity::Warning, code, message };
        let mut reported = Vec::new();
        if let Some(why) = self.report.lock().ok().and_then(|report| report.get(path).and_then(|r| r.refused.clone())) {
            reported.push(warning("NTS0006", format!("the React stage could not take {path}, so it is read as written: {why}")));
        }
        let Some(state) = self.files.get(path) else { return reported };
        for function in &state.functions {
            let message = if state.print.as_written.contains(&function.span) {
                format!(
                    "{} is built as written: the React Compiler's form of it did not typecheck, so it is not memoized",
                    described(function, path, &state.code)
                )
            } else if let FunctionState::Failed(reason) = &function.state {
                format!("the React Compiler left {} as written: {reason}", described(function, path, &state.code))
            } else {
                continue;
            };
            let code = if state.print.as_written.contains(&function.span) { "NTS0004" } else { "NTS0005" };
            reported.push(warning(code, message));
        }
        reported
    }

    fn revise(&mut self, path: &Utf8Path, errors: &[(u32, u32)]) -> Option<String> {
        let mut state = self.files.remove(path)?;
        let failing: Vec<(u32, u32)> = state
            .functions
            .iter()
            .filter(|f| f.state == FunctionState::Compiled && !state.print.as_written.contains(&f.span))
            .filter(|f| f.output.is_some_and(|(start, end)| errors.iter().any(|(at, _)| (start..end).contains(at))))
            .map(|f| f.span)
            .collect();
        let revised = if failing.is_empty() {
            None
        } else {
            state.print.as_written.extend(failing);
            let answers = std::mem::take(&mut state.types);
            let outcome = self.print(path, &mut state, &mut Remembered(&answers));
            state.types = answers;
            outcome.map(|outcome| {
                state.functions = outcome.functions;
                outcome.text
            })
        };
        self.record(path, &state);
        self.files.insert(path.to_owned(), state);
        revised
    }
}
