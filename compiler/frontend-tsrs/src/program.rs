//! Native configuration, program ownership, and borrowed project/file views.

use std::cell::OnceCell;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use rustc_hash::FxHashMap;
use tsrs_ast::{Diagnostic as NativeDiagnostic, SourceFile};
use tsrs_compiler::{Context, Program, ProgramOptions, ProgramRegions};
use tsrs_core::{P, Tristate, arena::Region, tspath};
use tsrs_tsoptions::ParsedCommandLine;
use xxhash_rust::xxh3::xxh3_128;

use crate::host::{Host, Input};
use crate::session::{CaseSensitivity, SessionOptions};
use crate::text::{BytePos, Utf16Index, Utf16Span};

/// The native config to open, additional root files, and in-memory source text.
#[derive(Debug, Clone)]
pub struct ProjectSpec {
    pub config_path: Utf8PathBuf,
    pub roots: Vec<Utf8PathBuf>,
    pub overlays: BTreeMap<Utf8PathBuf, String>,
}

impl ProjectSpec {
    #[must_use]
    pub fn new(config_path: impl Into<Utf8PathBuf>) -> Self {
        Self {
            config_path: config_path.into(),
            roots: Vec::new(),
            overlays: BTreeMap::new(),
        }
    }
}

/// Text replacements (`None` removes an overlay), and optional new extra roots.
#[derive(Debug, Clone, Default)]
pub struct SourceChanges {
    pub overlays: BTreeMap<Utf8PathBuf, Option<String>>,
    pub roots: Option<Vec<Utf8PathBuf>>,
}

/// A failure to load a project. TypeScript diagnostics are on `Checked` instead.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("cannot load native config {path}: {messages:?}")]
    Config {
        path: Utf8PathBuf,
        messages: Vec<String>,
    },
    #[error("cannot revise before opening a project")]
    NoProject,
}

/// An owned diagnostic, with no native handle or borrowed message text.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Diagnostic {
    pub path: Option<Utf8PathBuf>,
    pub span: Option<Utf16Span>,
    pub category: DiagnosticCategory,
    pub code: i32,
    pub message: String,
    pub chain: Vec<Diagnostic>,
    pub related: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DiagnosticCategory {
    Warning,
    Error,
    Suggestion,
    Message,
}

/// Effective native settings that can change emitted runtime semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "these six independent effective compiler settings are semantic booleans"
)]
pub struct ProjectSemantics {
    pub use_define_for_class_fields: bool,
    pub experimental_decorators: bool,
    pub emit_decorator_metadata: bool,
    pub verbatim_module_syntax: bool,
    pub preserve_const_enums: bool,
    pub isolated_modules: bool,
}

struct NativeProject {
    program: &'static Program,
    files: Vec<NativeFile>,
    file_index: FxHashMap<P<SourceFile>, usize>,
    diagnostics: Vec<Diagnostic>,
    strings: crate::strings::StringPool,
}

struct NativeFile {
    source: P<SourceFile>,
    utf16: OnceCell<Utf16Index>,
}

impl NativeFile {
    fn index(&self) -> &Utf16Index {
        self.utf16
            .get_or_init(|| Utf16Index::new(self.source.text()))
    }
}

pub(crate) struct OwnedProgram {
    projects: Vec<NativeProject>,
    host: Arc<Host>,
    config_diagnostics: Vec<P<NativeDiagnostic>>,
    diagnostics: Vec<Diagnostic>,
    // The outer region owns configs and lazy work on the capture thread. The
    // loader has per-worker scratch regions, avoiding a cross-thread owner lock.
    _region: Region,
    _loader_regions: Arc<ProgramRegions>,
}

impl OwnedProgram {
    pub(crate) fn open(options: &SessionOptions, spec: &ProjectSpec) -> Result<Self, LoadError> {
        let region = Region::new_scratch(1 << 20);
        let scope = region.enter();
        let loader_regions = Arc::new(ProgramRegions::default());
        let host = Arc::new(Host::new(options.cwd.as_str(), &spec.overlays));
        let (config, diagnostics) = tsrs_tsoptions::get_parsed_command_line_of_config_file(
            spec.config_path.as_str(),
            None,
            None,
            &*host,
            None,
        );
        let config = config.ok_or_else(|| LoadError::Config {
            path: spec.config_path.clone(),
            messages: diagnostics
                .iter()
                .map(|d| crate::strings::display(d.localize().as_bytes()))
                .collect(),
        })?;
        let mut owned = Self {
            projects: Vec::new(),
            host,
            config_diagnostics: diagnostics,
            diagnostics: Vec::new(),
            _region: region.clone(),
            _loader_regions: Arc::clone(&loader_regions),
        };
        let library_path = options
            .library_path
            .as_ref()
            .map_or_else(tsrs_vfs::bundled::lib_path, ToString::to_string);
        let fs: Arc<dyn tsrs_vfs::FS> = owned.host.clone();
        let compiler_host = tsrs_compiler::new_compiler_host(
            options.cwd.as_str(),
            fs,
            &library_path,
            None,
            None,
            None,
        );
        let mut roots = validated_roots(&config, spec)?;
        for root in &spec.roots {
            let root = tspath::get_normalized_absolute_path(root.as_str(), options.cwd.as_str());
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
        let config = config.with_file_names(roots);
        // One requested program. Native reference redirects load its imported
        // source files; referenced configs do not require separate programs.
        {
            let config = P::new(config);
            let config = pin_settings(config, options);
            let mut program_options = ProgramOptions::new(config, Arc::clone(&compiler_host));
            program_options.use_source_of_project_reference = true;
            program_options.single_threaded = if options.checker_count.is_some_and(|n| n.get() == 1)
            {
                Tristate::True
            } else if options.checker_count.is_some() {
                Tristate::False
            } else {
                Tristate::Unknown
            };
            program_options.checker_regions = true;
            program_options.checker_diagnostic_regions = true;
            program_options.regions = Some(Arc::clone(&loader_regions));
            let program = tsrs_compiler::new_program(program_options);
            // Register ownership immediately, before any further native call.
            owned.projects.push(NativeProject {
                program,
                files: Vec::new(),
                file_index: FxHashMap::default(),
                diagnostics: Vec::new(),
                strings: crate::strings::StringPool::new(region.clone()),
            });
            owned.projects.last_mut().expect("program registered").files = program
                .source_files()
                .iter()
                .copied()
                .map(|source| NativeFile {
                    source,
                    utf16: OnceCell::new(),
                })
                .collect();
            let project = owned.projects.last_mut().expect("program registered");
            project.file_index = project
                .files
                .iter()
                .enumerate()
                .map(|(index, file)| (file.source, index))
                .collect();
        }
        // Finish all pool work before exposing any capture view. Later semantic
        // questions use only this program's persistent first checker.
        owned.diagnostics = owned.collect_diagnostics();
        owned.projects[0].diagnostics.clone_from(&owned.diagnostics);
        drop(scope);
        Ok(owned)
    }

    fn diagnostic(&self, native: P<NativeDiagnostic>) -> Diagnostic {
        let file = native.file();
        let span = file.and_then(|file| {
            let start = native.pos()?;
            let end = native.end()?;
            let index = self
                .projects
                .iter()
                .flat_map(|p| &p.files)
                .find(|f| f.source == file);
            Some(if let Some(file) = index {
                file.index().span(BytePos(start), BytePos(end))
            } else {
                // Config diagnostic sources are outside the program file list.
                Utf16Index::new(file.text()).span(BytePos(start), BytePos(end))
            })
        });
        Diagnostic {
            path: file.map(|f| crate::host::native_path(f.file_name()).to_owned()),
            span,
            category: match native.category() {
                tsrs_diagnostics::Category::Warning => DiagnosticCategory::Warning,
                tsrs_diagnostics::Category::Error => DiagnosticCategory::Error,
                tsrs_diagnostics::Category::Suggestion => DiagnosticCategory::Suggestion,
                tsrs_diagnostics::Category::Message => DiagnosticCategory::Message,
            },
            code: native.code(),
            message: crate::strings::display(native.localize().as_bytes()),
            chain: native
                .message_chain()
                .iter()
                .map(|&d| self.diagnostic(d))
                .collect(),
            related: native
                .related_information()
                .iter()
                .map(|&d| self.diagnostic(d))
                .collect(),
        }
    }

    fn collect_diagnostics(&self) -> Vec<Diagnostic> {
        let ctx = Context::default();
        let mut native = self.config_diagnostics.clone();
        for project in &self.projects {
            let program = project.program;
            native.extend(program.get_config_file_parsing_diagnostics());
            native.extend(program.get_program_diagnostics());
            native.extend(program.get_syntactic_diagnostics(&ctx, None));
            native.extend(program.get_bind_diagnostics(&ctx, None));
            native.extend(program.get_semantic_diagnostics(&ctx, None));
            native.extend(program.get_global_diagnostics(&ctx));
            // Ordinary JS still has ECMAScript early errors. Expose the native
            // checker's unfiltered facts; selecting nts refusals is builder policy.
            for &file in program.source_files() {
                if tsrs_ast::is_source_file_js(file) {
                    let mut checker = program.get_type_checker_for_file(&ctx, file);
                    native.extend(checker.get_diagnostics_exported(&ctx, file));
                }
            }
        }
        let mut diagnostics: Vec<_> = native.into_iter().map(|d| self.diagnostic(d)).collect();
        diagnostics.extend(crate::environment::initialize().notes());
        diagnostics.sort();
        diagnostics.dedup();
        diagnostics
    }
}

fn validated_roots(
    config: &ParsedCommandLine,
    spec: &ProjectSpec,
) -> Result<Vec<String>, LoadError> {
    // JSON strings may contain unpaired surrogates. The public root-path
    // contract is UTF-8, so refuse before copying native WTF-8 into a String.
    config
        .file_names()
        .iter()
        .map(|root| {
            std::str::from_utf8(root.as_bytes())
                .map(str::to_owned)
                .map_err(|_| LoadError::Config {
                    path: spec.config_path.clone(),
                    messages: vec![format!(
                        "configured root has no UTF-8 filesystem path: {}",
                        crate::strings::display(root.as_bytes())
                    )],
                })
        })
        .collect()
}

fn pin_settings(config: P<ParsedCommandLine>, options: &SessionOptions) -> P<ParsedCommandLine> {
    let mut parsed = config.with_file_names(config.file_names().to_vec());
    let mut compiler_options = config
        .compiler_options()
        .expect("parsed compiler options")
        .get()
        .clone();
    compiler_options.stable_type_ordering = Tristate::True;
    if let Some(count) = options.checker_count {
        compiler_options.checkers = Some(i64::from(count.get()));
        compiler_options.single_threaded = if count.get() == 1 {
            Tristate::True
        } else {
            Tristate::False
        };
    }
    parsed.parsed_config.compiler_options = Some(P::new(compiler_options));
    P::new(parsed)
}

impl Drop for OwnedProgram {
    fn drop(&mut self) {
        // All safe views borrow this owner. No checker handle is retained by
        // this version yet, and these programs never use update/reuse_program.
        for project in self.projects.drain(..).rev() {
            #[expect(
                unsafe_code,
                reason = "sole owner; views ended and no native program data is shared"
            )]
            // SAFETY: only new_program builds these; they never share processed
            // files/mappers. All regions remain live until every program is gone.
            unsafe {
                tsrs_compiler::free_unshared_program(project.program);
            }
        }
    }
}

/// Borrowed access to one checked revision. Dropping it permits `revise`.
///
/// All pool diagnostics finish before this view exists. Capture questions use
/// the persistent first checker with a scoped guard, and never run with pool
/// work. AST/file views may stay live during a question; no guard escapes it.
#[derive(Clone, Copy)]
pub struct Checked<'s> {
    owner: &'s OwnedProgram,
    case_sensitivity: CaseSensitivity,
}

impl fmt::Debug for Checked<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Checked")
            .field("projects", &self.owner.projects.len())
            .finish_non_exhaustive()
    }
}

impl<'s> Checked<'s> {
    pub(crate) fn new(owner: &'s OwnedProgram, case_sensitivity: CaseSensitivity) -> Self {
        Self {
            owner,
            case_sensitivity,
        }
    }
    #[must_use]
    pub const fn case_sensitivity(self) -> CaseSensitivity {
        self.case_sensitivity
    }
    pub fn projects(self) -> impl ExactSizeIterator<Item = Project<'s>> {
        self.owner.projects.iter().map(|native| Project { native })
    }
    #[must_use]
    pub fn inputs(self) -> Vec<Input> {
        self.owner.host.inputs()
    }
    #[must_use]
    pub fn diagnostics(self) -> Vec<Diagnostic> {
        self.owner.diagnostics.clone()
    }
}

/// The requested native config's program, including imported reference sources.
#[derive(Clone, Copy)]
pub struct Project<'s> {
    native: &'s NativeProject,
}

impl fmt::Debug for Project<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Project")
            .field("config_path", &self.config_path())
            .finish_non_exhaustive()
    }
}

impl<'s> Project<'s> {
    /// Diagnostics only for this program/config, completed before capture.
    #[must_use]
    pub fn diagnostics(self) -> Vec<Diagnostic> {
        self.native.diagnostics.clone()
    }
    #[must_use]
    pub fn semantics(self) -> ProjectSemantics {
        let options = self.native.program.options();
        ProjectSemantics {
            use_define_for_class_fields: options.get_use_define_for_class_fields(),
            experimental_decorators: options.experimental_decorators.is_true(),
            emit_decorator_metadata: options.emit_decorator_metadata.is_true(),
            verbatim_module_syntax: options.verbatim_module_syntax.is_true(),
            preserve_const_enums: options.should_preserve_const_enums(),
            isolated_modules: options.get_isolated_modules(),
        }
    }
    #[must_use]
    pub fn config_path(self) -> &'s Utf8Path {
        crate::host::native_path(self.native.program.command_line().get().config_name())
    }
    #[must_use]
    pub fn cwd(self) -> &'s Utf8Path {
        crate::host::native_path(self.native.program.get_current_directory())
    }
    pub fn root_paths(self) -> impl ExactSizeIterator<Item = &'s Utf8Path> {
        self.native
            .program
            .command_line()
            .get()
            .file_names()
            .iter()
            .map(|path| crate::host::native_path(path))
    }
    #[must_use]
    pub fn checker_count(self) -> usize {
        self.native.program.checker_count()
    }
    pub fn files(self) -> impl ExactSizeIterator<Item = File<'s>> {
        self.native.files.iter().map(move |native| File {
            native,
            project: self.native,
        })
    }
}

/// One native source file. Its text and UTF-16 index belong to this revision.
#[derive(Clone, Copy)]
pub struct File<'s> {
    native: &'s NativeFile,
    project: &'s NativeProject,
}

impl fmt::Debug for File<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("File")
            .field("path", &self.path())
            .finish_non_exhaustive()
    }
}

impl<'s> File<'s> {
    pub(crate) fn program_path(self) -> &'s Utf8Path {
        crate::host::native_path(self.project.program.command_line().get().config_name())
    }
    pub(crate) fn program_identity(self) -> usize {
        std::ptr::from_ref(self.project).addr()
    }
    pub(crate) fn same_program(self, other: Self) -> bool {
        std::ptr::eq(self.project, other.project)
    }
    pub(crate) fn assert_same_program(self, other: Self) {
        assert!(
            self.same_program(other),
            "native semantic views belong to different programs: {} and {}",
            self.program_path(),
            other.program_path()
        );
    }
    /// Every question acquires the same persistent first checker. No guard
    /// survives this call, and all pool diagnostics have already finished.
    pub(crate) fn with_checker<R>(
        self,
        question: impl FnOnce(&mut tsrs_compiler::Checker) -> R,
    ) -> R {
        let mut checker = self.project.program.get_type_checker(&Context::default());
        question(&mut checker)
    }
    pub(crate) fn node_view(self, native: P<tsrs_ast::Node>) -> Option<crate::Node<'s>> {
        let source = tsrs_ast::get_source_file_of_node(native)?;
        let index = *self.project.file_index.get(&source)?;
        Some(crate::Node::new(
            native,
            Self {
                native: &self.project.files[index],
                project: self.project,
            },
        ))
    }
    pub(crate) fn native_scope(self) -> tsrs_core::arena::RegionScope {
        self.project.strings.enter()
    }
    pub(crate) fn intern_string(self, bytes: &[u8]) -> crate::JsString<'s> {
        self.project.strings.intern(bytes)
    }
    pub(crate) fn native_source(self) -> P<SourceFile> {
        self.native.source
    }
    pub(crate) fn identity(self) -> usize {
        std::ptr::from_ref(self.native).addr()
    }
    pub(crate) fn same_identity(self, other: Self) -> bool {
        std::ptr::eq(self.native, other.native)
    }
    #[must_use]
    pub fn root(self) -> crate::Node<'s> {
        crate::Node::new(self.native.source.as_node(), self)
    }
    #[must_use]
    pub fn path(self) -> &'s Utf8Path {
        crate::host::native_path(self.native.source.file_name())
    }
    #[must_use]
    pub fn text(self) -> &'s str {
        std::str::from_utf8(self.native.source.text().as_bytes())
            .expect("source text supplied by UTF-8 host")
    }
    #[must_use]
    pub fn content_digest(self) -> u128 {
        xxh3_128(self.text().as_bytes())
    }
    #[must_use]
    pub fn is_declaration(self) -> bool {
        self.native.source.is_declaration_file()
    }
    #[must_use]
    pub fn is_default_library(self) -> bool {
        self.project
            .program
            .is_source_file_default_library(self.native.source.path())
    }
    #[must_use]
    pub fn is_external_library(self) -> bool {
        self.project
            .program
            .is_source_file_from_external_library(self.native.source)
    }
    #[must_use]
    pub fn span(self, start: BytePos, end: BytePos) -> Utf16Span {
        self.native.index().span(start, end)
    }
    pub fn imports(self) -> impl Iterator<Item = crate::JsString<'s>> {
        self.native
            .source
            .imports
            .get()
            .iter()
            .map(move |node| self.intern_string(node.text().as_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Session, run};
    use std::num::NonZeroU16;
    use std::sync::Mutex;

    fn options(count: u16) -> SessionOptions {
        let mut options = SessionOptions::new("/__nts_native_session_test__");
        options.checker_count = NonZeroU16::new(count);
        options
    }

    fn project() -> ProjectSpec {
        let mut spec = ProjectSpec::new("tsconfig.json");
        for (name, text) in [
            (
                "tsconfig.json",
                r#"{"compilerOptions":{"noLib":true,"strict":true},"files":["a.ts","b.ts","c.ts","d.ts"]}"#,
            ),
            ("a.ts", "export const value: number = 1;"),
            (
                "b.ts",
                "import { value } from './a'; export const wrong: string = value;",
            ),
            ("c.ts", "export const text = '😀';"),
            ("d.ts", "export interface Shape { value: number }"),
        ] {
            spec.overlays.insert(name.into(), text.to_owned());
        }
        spec
    }

    #[test]
    fn one_checker_is_exact_and_runs_on_the_checking_thread() {
        run(options(1), |session| {
            let checked = session.open(project()).expect("inline project loads");
            let project = checked.projects().next().expect("root program");
            assert_eq!(project.checker_count(), 1);
            assert!(project.native.program.single_threaded());
            let workers = Mutex::new(Vec::new());
            project
                .native
                .program
                .for_each_checker_parallel(|index, _| {
                    workers
                        .lock()
                        .expect("worker list")
                        .push((index, std::thread::current().id()));
                });
            assert_eq!(
                *workers.lock().expect("worker list"),
                vec![(0, std::thread::current().id())]
            );
        });
    }

    fn capture(count: u16) -> (Vec<(String, String)>, Vec<Diagnostic>) {
        run(options(count), |session| {
            let checked = session.open(project()).expect("inline project loads");
            let project = checked.projects().next().expect("root program");
            assert_eq!(project.checker_count(), usize::from(count));
            let mut files: Vec<_> = project
                .files()
                .map(|f| (f.path().to_string(), f.text().to_owned()))
                .collect();
            files.sort();
            (files, checked.diagnostics())
        })
    }

    #[test]
    fn file_facts_and_owned_diagnostics_are_identical_at_one_and_four_checkers() {
        let one = capture(1);
        assert!(
            one.1.iter().any(|d| d.code == 2322),
            "type mismatch was checked"
        );
        assert_eq!(one, capture(4));
    }

    #[test]
    fn revisions_replace_text_and_repeated_sessions_release_programs() {
        for _ in 0..8 {
            run(options(1), |session| {
                {
                    let checked = session.open(project()).expect("initial project");
                    let file = checked
                        .projects()
                        .next()
                        .expect("project")
                        .files()
                        .find(|f| f.path().ends_with("c.ts"))
                        .expect("astral source");
                    let start = u32::try_from(file.text().find('😀').expect("astral text"))
                        .expect("offset");
                    let span = file.span(BytePos(start), BytePos(start + 4));
                    assert_eq!(span.end.0 - span.start.0, 2);
                }
                let mut changes = SourceChanges::default();
                changes.overlays.insert(
                    "a.ts".into(),
                    Some("export const value: string = 'now';".to_owned()),
                );
                let checked = session.revise(changes).expect("revision loads");
                assert!(!checked.diagnostics().iter().any(|d| d.code == 2322));
                assert!(
                    checked
                        .inputs()
                        .iter()
                        .any(|i| i.kind == crate::InputKind::File
                            && i.path.utf8().is_some_and(|p| p.ends_with("a.ts")))
                );
                let project = checked.projects().next().expect("project");
                assert!(
                    project
                        .files()
                        .find(|f| f.path().ends_with("a.ts"))
                        .expect("changed file")
                        .text()
                        .contains("'now'")
                );
                assert_eq!(
                    project
                        .files()
                        .find(|f| f.path().ends_with("b.ts"))
                        .expect("importing file")
                        .imports()
                        .map(|name| name.utf8().expect("UTF8 module path"))
                        .collect::<Vec<_>>(),
                    ["./a"]
                );
            });
        }
    }

    #[test]
    fn extends_and_composite_references_remain_native_at_both_counts() {
        for count in [1, 4] {
            run(options(count), |session| {
                let mut spec = ProjectSpec::new("app/tsconfig.json");
                for (name, text) in [
                    (
                        "base.json",
                        r#"{"compilerOptions":{"noLib":true,"strict":true,"composite":true}}"#,
                    ),
                    (
                        "lib/tsconfig.json",
                        r#"{"extends":"../base.json","files":["index.ts","b.ts","c.ts","d.ts"]}"#,
                    ),
                    ("lib/index.ts", "export const value: number = 1;"),
                    ("lib/b.ts", "export const b = 2;"),
                    ("lib/c.ts", "export const c = 3;"),
                    ("lib/d.ts", "export const d = 4;"),
                    (
                        "app/tsconfig.json",
                        r#"{"extends":"../base.json","references":[{"path":"../lib"}],"files":["index.ts","b.ts","c.ts","d.ts"]}"#,
                    ),
                    (
                        "app/index.ts",
                        "import { value } from '../lib'; export const wrong: string = value;",
                    ),
                    ("app/b.ts", "export const b = 2;"),
                    ("app/c.ts", "export const c = 3;"),
                    ("app/d.ts", "export const d = 4;"),
                ] {
                    spec.overlays.insert(name.into(), text.to_owned());
                }
                let checked = session.open(spec).expect("reference graph loads");
                assert_eq!(checked.projects().len(), 1);
                assert_eq!(
                    checked
                        .projects()
                        .next()
                        .expect("root program")
                        .native
                        .program
                        .get_resolved_project_references()
                        .len(),
                    1
                );
                for project in checked.projects() {
                    assert_eq!(project.checker_count(), usize::from(count));
                    assert!(project.native.program.options().composite.is_true());
                    assert!(project.native.program.options().strict.is_true());
                }
                assert!(checked.diagnostics().iter().any(|d| d.code == 2322));
            });
        }
    }

    #[test]
    #[should_panic(expected = "panic after a live native program")]
    fn panic_drops_a_live_program_and_propagates() {
        run(options(1), |session: &mut Session| {
            let _checked = session.open(project()).expect("inline project");
            panic!("panic after a live native program");
        });
    }

    #[test]
    fn unchecked_javascript_still_reports_native_early_errors() {
        run(options(1), |session| {
            let mut spec = ProjectSpec::new("tsconfig.json");
            spec.overlays.insert("tsconfig.json".into(), r#"{"compilerOptions":{"allowJs":true,"noLib":true,"noEmit":true},"files":["index.js"]}"#.to_owned());
            spec.overlays.insert(
                "index.js".into(),
                "let duplicate; let duplicate;".to_owned(),
            );
            let checked = session.open(spec).expect("JavaScript config");
            assert!(checked.diagnostics().iter().any(|d| d.code == 2451));
        });
    }

    #[test]
    fn runtime_semantics_use_native_effective_defaults_and_overrides() {
        for (settings, define, isolated) in [
            (r#""target":"es2015""#, false, false),
            (r#""target":"es2022""#, true, false),
            (
                r#""target":"es2022","useDefineForClassFields":false"#,
                false,
                false,
            ),
            (
                r#""target":"es2015","useDefineForClassFields":true,"verbatimModuleSyntax":true"#,
                true,
                true,
            ),
        ] {
            run(options(1), |session| {
                let mut spec = ProjectSpec::new("tsconfig.json");
                spec.overlays.insert(
                    "tsconfig.json".into(),
                    format!(
                        r#"{{"compilerOptions":{{"noLib":true,{settings}}},"files":["index.ts"]}}"#
                    ),
                );
                spec.overlays.insert(
                    "index.ts".into(),
                    "export class Value { value = 1; }".to_owned(),
                );
                let checked = session.open(spec).expect("semantics config");
                let semantics = checked.projects().next().expect("root program").semantics();
                assert_eq!(semantics.use_define_for_class_fields, define);
                assert_eq!(semantics.isolated_modules, isolated);
                assert_eq!(semantics.preserve_const_enums, isolated);
            });
        }
    }

    #[test]
    fn workspace_capture_opens_only_requested_config_and_redirects_sources() {
        let cwd = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        for count in [1, 4] {
            let mut options = SessionOptions::new(cwd.clone());
            options.checker_count = NonZeroU16::new(count);
            run(options, |session| {
                let checked = session
                    .open(ProjectSpec::new("tests/workspace/apps/node/tsconfig.json"))
                    .expect("node workspace app");
                assert_eq!(checked.projects().len(), 1);
                let project = checked.projects().next().expect("requested program");
                assert_eq!(project.root_paths().len(), 1);
                let mut sources: Vec<_> = project
                    .files()
                    .filter(|f| !f.is_declaration())
                    .map(|f| {
                        f.path()
                            .as_str()
                            .split("/tests/workspace/")
                            .nth(1)
                            .expect("workspace source")
                            .to_owned()
                    })
                    .collect();
                sources.sort();
                assert_eq!(
                    sources,
                    [
                        "apps/node/src/main.ts",
                        "packages/crypto-core/src/index.ts",
                        "packages/storage/src/index.ts"
                    ]
                );
                assert_eq!(project.diagnostics(), checked.diagnostics());
                let checked = session
                    .open(ProjectSpec::new("tests/workspace/tsconfig.solution.json"))
                    .expect("workspace solution");
                assert_eq!(checked.projects().len(), 1);
                let project = checked.projects().next().expect("solution program");
                assert_eq!(project.root_paths().len(), 0);
                assert_eq!(project.files().len(), 0);
            });
        }
    }

    #[test]
    #[ignore = "child-process helper for the shared-graph environment test"]
    fn shared_graph_environment_probe() {
        let one = capture(1);
        assert_eq!(one, capture(4));
        let has_note = one
            .1
            .iter()
            .any(|d| d.code == 0 && d.message.starts_with("TSRS_SHARED_GRAPH="));
        assert_eq!(has_note, std::env::var_os("TSRS_SHARED_GRAPH").is_some());
        let semantic: Vec<_> = one
            .1
            .iter()
            .filter(|d| d.code != 0 || d.category != DiagnosticCategory::Message)
            .collect();
        let fingerprint = xxh3_128(format!("{:?}{semantic:?}", one.0).as_bytes());
        println!("NTS_NATIVE_FACTS {fingerprint:032x}");
        println!("NTS_NATIVE_ID {}", run(options(1), |s| s.cache_identity()));
    }

    #[test]
    fn shared_graph_environment_preserves_one_and_four_checker_facts() {
        let exe = std::env::current_exe().expect("native test binary");
        let mut facts = Vec::new();
        let mut identities = Vec::new();
        for (shared, rayon) in [(false, false), (true, false), (false, true), (true, true)] {
            let mut command = std::process::Command::new(&exe);
            command.args([
                "--ignored",
                "--exact",
                "program::tests::shared_graph_environment_probe",
                "--nocapture",
            ]);
            if shared {
                command.env("TSRS_SHARED_GRAPH", "1");
            } else {
                command.env_remove("TSRS_SHARED_GRAPH");
            }
            if rayon {
                command.env("RAYON_NUM_THREADS", "2");
            } else {
                command.env_remove("RAYON_NUM_THREADS");
            }
            let output = command.output().expect("native environment child");
            assert!(
                output.status.success(),
                "native environment child failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let stdout = String::from_utf8(output.stdout).expect("test output UTF-8");
            let field = |marker: &str| {
                stdout
                    .lines()
                    .find_map(|line| {
                        line.split_once(marker)
                            .map(|(_, value)| value.trim().to_owned())
                    })
                    .expect("child evidence")
            };
            facts.push(field("NTS_NATIVE_FACTS "));
            identities.push(field("NTS_NATIVE_ID "));
        }
        assert!(facts.iter().all(|fact| fact == &facts[0]));
        assert_eq!(
            identities[0], identities[2],
            "Rayon parser threads do not alter checker identity"
        );
        assert_eq!(identities[1], identities[3]);
        assert_ne!(
            identities[0], identities[1],
            "native environment changes cache identity"
        );
    }
}
