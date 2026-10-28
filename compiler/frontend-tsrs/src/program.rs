//! Native configuration, program ownership, and borrowed project/file views.

use std::cell::{OnceCell, RefCell};
use std::collections::BTreeMap;
use std::fmt;
use std::marker::PhantomData;

use crate::{CapturePhase, SyntaxPhase, ViewPhase};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use rustc_hash::{FxHashMap, FxHashSet};
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

/// A failure to load a project. TypeScript diagnostics are on `Finished` instead.
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

/// Effective native checker settings and emitted-runtime settings.
#[derive(Debug, Clone, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent effective compiler settings are semantic booleans"
)]
pub struct ProjectSemantics {
    pub use_define_for_class_fields: bool,
    pub experimental_decorators: bool,
    pub emit_decorator_metadata: bool,
    pub verbatim_module_syntax: bool,
    pub preserve_const_enums: bool,
    pub isolated_modules: bool,
    pub strict: bool,
    pub strict_null_checks: bool,
    pub no_implicit_any: bool,
    pub strict_function_types: bool,
    pub strict_bind_call_apply: bool,
    pub strict_property_initialization: bool,
    pub strict_builtin_iterator_return: bool,
    pub no_implicit_this: bool,
    pub use_unknown_in_catch_variables: bool,
    pub always_strict: bool,
    pub no_unchecked_indexed_access: bool,
    pub exact_optional_property_types: bool,
    pub disabled_strict_sources: Vec<crate::StrictOptionSource>,
}

/// Files to check for diagnostics. Config, program/options and global errors
/// are always collected. `Files` must name files of this revision and excludes
/// default libraries; choose `Program` explicitly to check those too.
#[derive(Debug, Clone, Copy)]
pub enum DiagnosticScope<'a> {
    Files(&'a [Utf8PathBuf]),
    Program,
}

/// A capture revision whose diagnostic scope has not yet been chosen.
#[derive(Debug)]
pub enum DiagnosticsUnselected {}

/// A capture revision with an explicit diagnostic scope; it can be finished.
#[derive(Debug)]
pub enum DiagnosticsSelected {}

#[derive(Clone)]
enum NativeDiagnosticScope {
    Files(Vec<P<SourceFile>>),
    Program,
}

struct NativeProject {
    program: &'static Program,
    disabled_strict_sources: Vec<crate::StrictOptionSource>,
    capture: RefCell<Option<Box<tsrs_checker::Checker>>>,
    capture_region: Region,
    diagnostics_task: RefCell<Option<std::thread::JoinHandle<NativeDiagnostics>>>,
    diagnostic_results: OnceCell<NativeDiagnostics>,
    diagnostic_scope: OnceCell<NativeDiagnosticScope>,
    parallel_capture: bool,
    files: Vec<NativeFile>,
    file_index: FxHashMap<P<SourceFile>, usize>,
    strings: crate::strings::StringPool,
}

struct NativeDiagnostics {
    ordinary: Vec<P<NativeDiagnostic>>,
    plain_js: Vec<P<NativeDiagnostic>>,
    _region: Region,
    #[cfg(test)]
    thread: std::thread::ThreadId,
}

impl NativeDiagnostics {
    fn collect(program: &'static Program, selected: &NativeDiagnosticScope) -> Self {
        let region = Region::new_scratch(1 << 20);
        let scope = region.enter();
        let ctx = Context::default();
        let mut ordinary = program.get_config_file_parsing_diagnostics().clone();
        ordinary.extend(program.get_program_diagnostics());
        let files = match selected {
            NativeDiagnosticScope::Program => {
                ordinary.extend(program.get_syntactic_diagnostics(&ctx, None));
                ordinary.extend(program.get_semantic_diagnostics(&ctx, None));
                program.source_files()
            }
            NativeDiagnosticScope::Files(files) => {
                for &file in files {
                    ordinary.extend(program.get_syntactic_diagnostics(&ctx, Some(file)));
                }
                ordinary.extend(semantic_diagnostics_for_files(program, &ctx, files));
                files.as_slice()
            }
        };
        ordinary.extend(program.get_global_diagnostics(&ctx));
        let mut plain_js = Vec::new();
        for &file in files {
            if tsrs_ast::is_plain_js_file(Some(file), program.options().check_js)
                && !program.skip_type_checking(file, false)
            {
                let mut checker = program.get_type_checker_for_file(&ctx, file);
                plain_js.extend_from_slice(file.bind_diagnostics());
                plain_js.extend(checker.get_diagnostics_exported(&ctx, file));
            }
        }
        drop(scope);
        Self {
            ordinary,
            plain_js,
            _region: region,
            #[cfg(test)]
            thread: std::thread::current().id(),
        }
    }
}

// The incremental-shaped API is the public file-set scheduler. It already
// applies checkJs and preceding directives. Compose the two public ordinary
// steps it omits, without issuing a second checker computation. Its deferred
// globals are also collected explicitly by NativeDiagnostics::collect.
fn semantic_diagnostics_for_files(
    program: &'static Program,
    ctx: &Context,
    files: &[P<SourceFile>],
) -> Vec<P<NativeDiagnostic>> {
    let mut by_file = program.get_semantic_diagnostics_for_incremental(ctx, files);
    let mut diagnostics = Vec::new();
    for &file in files {
        diagnostics.extend(tsrs_compiler::filter_no_emit_semantic_diagnostics(
            by_file.remove(&file).expect(
                "native scheduler returns one result for each explicitly selected source file",
            ),
            &program.options(),
        ));
        diagnostics.extend(program.get_include_processor_diagnostics(file));
    }
    diagnostics
}

impl NativeProject {
    fn start_capture(&mut self) {
        {
            let _scope = self.capture_region.enter_scratch();
            *self.capture.get_mut() = Some(tsrs_checker::new_checker(self.program));
        }
    }

    fn start_diagnostics(&self, selected: NativeDiagnosticScope) {
        self.diagnostic_scope.set(selected.clone()).ok().expect(
            "consuming DiagnosticsUnselected permits selecting the diagnostic scope only once",
        );
        if self.parallel_capture {
            let program = self.program;
            *self.diagnostics_task.borrow_mut() = Some(
                std::thread::Builder::new()
                    .name("nts-tsrs-diagnostics".to_owned())
                    .stack_size(512 << 20)
                    .spawn(move || NativeDiagnostics::collect(program, &selected))
                    .expect("OS could not start the native diagnostic thread"),
            );
        }
    }

    fn finish_diagnostics(&self) -> &NativeDiagnostics {
        self.diagnostic_results.get_or_init(|| {
            self.diagnostics_task.borrow_mut().take().map_or_else(
                || {
                    NativeDiagnostics::collect(
                        self.program,
                        self.diagnostic_scope
                            .get()
                            .expect("diagnostics run only after the caller selected a scope"),
                    )
                },
                |task| match task.join() {
                    Ok(results) => results,
                    Err(panic) => std::panic::resume_unwind(panic),
                },
            )
        })
    }
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
    diagnostics: OnceCell<Vec<Diagnostic>>,
    plain_js_unfiltered: OnceCell<Vec<Diagnostic>>,
    // The outer region owns configs and lazy work on the capture thread. The
    // loader has per-worker scratch regions, avoiding a cross-thread owner lock.
    region: Region,
    _loader_regions: Arc<ProgramRegions>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BuildMode {
    Capture,
    Resolution,
}

impl OwnedProgram {
    pub(crate) fn open(options: &SessionOptions, spec: &ProjectSpec) -> Result<Self, LoadError> {
        Self::build(options, spec, BuildMode::Capture)
    }

    pub(crate) fn resolve(options: &SessionOptions, spec: &ProjectSpec) -> Result<Self, LoadError> {
        let owned = Self::build(options, spec, BuildMode::Resolution)?;
        let _scope = owned.region.enter();
        let mut native = owned.config_diagnostics.clone();
        for project in &owned.projects {
            native.extend(project.program.get_config_file_parsing_diagnostics());
            native.extend(project.program.get_program_diagnostics());
            native.extend(
                project
                    .program
                    .get_syntactic_diagnostics(&Context::default(), None),
            );
        }
        let mut diagnostics: Vec<_> = native.into_iter().map(|d| owned.diagnostic(d)).collect();
        diagnostics.extend(crate::environment::initialize().notes());
        diagnostics.sort();
        diagnostics.dedup();
        owned
            .diagnostics
            .set(diagnostics)
            .expect("new resolution owns an uninitialized diagnostics cell");
        // No checker facts exist on a resolution-only revision.
        owned
            .plain_js_unfiltered
            .set(Vec::new())
            .expect("new resolution owns an uninitialized plain-JS diagnostics cell");
        Ok(owned)
    }

    fn build(
        options: &SessionOptions,
        spec: &ProjectSpec,
        mode: BuildMode,
    ) -> Result<Self, LoadError> {
        let region = Region::new_scratch(1 << 20);
        let scope = region.enter();
        let loader_regions = Arc::new(ProgramRegions::default());
        let host = Arc::new(Host::new(options.cwd.as_str(), &spec.overlays));
        let LoadedConfig {
            config,
            diagnostics,
            disabled_strict_sources,
        } = load_config(&host, spec)?;
        let mut owned = Self {
            projects: Vec::new(),
            host,
            config_diagnostics: diagnostics,
            diagnostics: OnceCell::new(),
            plain_js_unfiltered: OnceCell::new(),
            region: region.clone(),
            _loader_regions: Arc::clone(&loader_regions),
        };
        let library_path = options
            .library_path
            .as_ref()
            .map_or_else(tsrs_vfs::bundled::lib_path, ToString::to_string);
        let compiler_host = tsrs_compiler::new_compiler_host(
            options.cwd.as_str(),
            owned.host.clone(),
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
            program_options.single_threaded = if options.checker_count.is_some_and(|n| n.get() <= 2)
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
                disabled_strict_sources,
                capture: RefCell::new(None),
                capture_region: Region::new_scratch(1 << 20),
                diagnostics_task: RefCell::new(None),
                diagnostic_results: OnceCell::new(),
                diagnostic_scope: OnceCell::new(),
                parallel_capture: options
                    .checker_count
                    .map_or_else(|| !program.single_threaded(), |count| count.get() > 1),
                files: Vec::new(),
                file_index: FxHashMap::default(),
                strings: crate::strings::StringPool::new(region.clone()),
            });
            let project = owned.projects.last_mut().expect("project was just pushed");
            project.files = program
                .source_files()
                .iter()
                .copied()
                .map(|source| NativeFile {
                    source,
                    utf16: OnceCell::new(),
                })
                .collect();
            project.file_index = project
                .files
                .iter()
                .enumerate()
                .map(|(index, file)| (file.source, index))
                .collect();
            if mode == BuildMode::Capture {
                project.start_capture();
            }
        }
        // Capture's pristine C0 never belongs to the diagnostics pool. No
        // diagnostic work starts until the caller explicitly selects its files.
        drop(scope);
        Ok(owned)
    }

    fn finish(&self) {
        let _scope = self.region.enter();
        for project in &self.projects {
            project.finish_diagnostics();
        }
        self.diagnostics.get_or_init(|| self.collect_diagnostics());
        self.plain_js_unfiltered
            .get_or_init(|| self.collect_plain_js_unfiltered());
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
        let mut native = self.config_diagnostics.clone();
        for project in &self.projects {
            native.extend(&project.finish_diagnostics().ordinary);
        }
        let mut diagnostics: Vec<_> = native.into_iter().map(|d| self.diagnostic(d)).collect();
        diagnostics.extend(crate::environment::initialize().notes());
        diagnostics.sort();
        // Diagnostic's derived Eq compares every field, including file, span,
        // code, full message chain and related information. This also removes
        // deferred globals returned by the file-set API and the explicit sweep.
        diagnostics.dedup();
        diagnostics
    }

    fn collect_plain_js_unfiltered(&self) -> Vec<Diagnostic> {
        let mut native = Vec::new();
        for project in &self.projects {
            native.extend(&project.finish_diagnostics().plain_js);
        }
        let mut diagnostics: Vec<_> = native.into_iter().map(|d| self.diagnostic(d)).collect();
        diagnostics.sort();
        diagnostics.dedup();
        diagnostics
    }
}

struct LoadedConfig {
    config: ParsedCommandLine,
    diagnostics: Vec<P<NativeDiagnostic>>,
    disabled_strict_sources: Vec<crate::StrictOptionSource>,
}

fn load_config(host: &Host, spec: &ProjectSpec) -> Result<LoadedConfig, LoadError> {
    let sources = crate::config_sources::ConfigSources::new(host, spec.config_path.as_str());
    let (config, diagnostics) = tsrs_tsoptions::get_parsed_command_line_of_config_file(
        spec.config_path.as_str(),
        None,
        None,
        host,
        Some(&sources),
    );
    let config = config.ok_or_else(|| LoadError::Config {
        path: spec.config_path.clone(),
        messages: diagnostics
            .iter()
            .map(|d| crate::strings::display(d.localize().as_bytes()))
            .collect(),
    })?;
    let disabled_strict_sources = sources.disabled(
        config
            .compiler_options()
            .expect("native parsed config owns compiler options")
            .get(),
    );
    Ok(LoadedConfig {
        config,
        diagnostics,
        disabled_strict_sources,
    })
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
        .expect("top-level config parsing initializes compiler options even when it reports errors")
        .get()
        .clone();
    // nts owns emission, so TypeScript's emit options cannot apply. Check the
    // project as `tsc --noEmit` does; only this cloned effective option changes,
    // never the user's tsconfig on disk.
    compiler_options.no_emit = Tristate::True;
    compiler_options.stable_type_ordering = Tristate::True;
    if let Some(count) = options.checker_count {
        let diagnostics = count.get().saturating_sub(1).max(1);
        compiler_options.checkers = Some(i64::from(diagnostics));
        compiler_options.single_threaded = if diagnostics == 1 {
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
        // Join before freeing on every path, including capture unwinding. The
        // capture checker is destroyed before its Program and both arenas stay
        // alive until after freeing. No program uses update/reuse_program.
        for project in self.projects.drain(..).rev() {
            if project.diagnostics_task.borrow().is_some() {
                project.finish_diagnostics();
            }
            project.capture.borrow_mut().take();
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

/// Capture phase of one native revision, on its pristine designated checker.
///
/// First choose an explicit scope with `start_diagnostics`. It consumes the
/// unselected state, so reborrow semantic views afterwards. Only the selected
/// state has `finish`, which ends capture and joins independent diagnostics
/// (running them then at one checker). Capture never feeds the diagnostic pool.
/// Dropping the current phase and all its views permits `Session::revise`.
///
/// ```compile_fail
/// use nts_frontend_tsrs::{Session, ProjectSpec};
/// fn invalid(session: &mut Session, spec: ProjectSpec) {
///     let unselected = session.open(spec).unwrap();
///     let _ = unselected.finish(); // choose a DiagnosticScope first
/// }
/// ```
pub struct Checked<'s, State = DiagnosticsUnselected> {
    owner: &'s OwnedProgram,
    case_sensitivity: CaseSensitivity,
    state: PhantomData<State>,
}
impl<State> fmt::Debug for Checked<'_, State> {
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
            state: PhantomData,
        }
    }

    /// Test fixtures check their own source/imported files, never bundled libs.
    #[cfg(test)]
    pub(crate) fn diagnose_fixture_files(self) -> Checked<'s, DiagnosticsSelected> {
        let paths: Vec<_> = self
            .projects()
            .flat_map(Project::files)
            .filter(|file| !file.is_default_library())
            .map(|file| file.path().to_owned())
            .collect();
        self.start_diagnostics(DiagnosticScope::Files(&paths))
    }

    /// Select the diagnostic scope before finishing or starting pool work.
    /// Paths are copied into revision-local native identities; the input slice
    /// need not outlive this call. At N >= 2 this starts the independent pool.
    #[must_use]
    pub fn start_diagnostics(self, scope: DiagnosticScope<'_>) -> Checked<'s, DiagnosticsSelected> {
        for project in &self.owner.projects {
            let selected = match scope {
                DiagnosticScope::Program => NativeDiagnosticScope::Program,
                DiagnosticScope::Files(paths) => {
                    let mut files = Vec::with_capacity(paths.len());
                    let mut seen = FxHashSet::default();
                    for path in paths {
                        let file = project
                            .program
                            .get_source_file(path.as_str())
                            .unwrap_or_else(|| {
                                panic!(
                                    "diagnostic file {path} is not in {}",
                                    project.program.command_line().get().config_name()
                                )
                            });
                        assert!(
                            !project.program.is_source_file_default_library(file.path()),
                            "default library {path} requires DiagnosticScope::Program"
                        );
                        if seen.insert(file) {
                            files.push(file);
                        }
                    }
                    NativeDiagnosticScope::Files(files)
                }
            };
            project.start_diagnostics(selected);
        }
        Checked {
            owner: self.owner,
            case_sensitivity: self.case_sensitivity,
            state: PhantomData,
        }
    }
}

impl<State> Checked<'_, State> {
    #[must_use]
    pub const fn case_sensitivity(&self) -> CaseSensitivity {
        self.case_sensitivity
    }
    pub fn projects(&self) -> impl ExactSizeIterator<Item = Project<'_>> {
        self.owner.projects.iter().map(|native| Project {
            native,
            owner: self.owner,
            phase: PhantomData,
        })
    }
    #[must_use]
    pub fn inputs(&self) -> Vec<Input> {
        self.owner.host.inputs()
    }
}

impl<'s> Checked<'s, DiagnosticsSelected> {
    /// End semantic capture and join only the explicitly selected diagnostic work.
    #[must_use]
    pub fn finish(self) -> Finished<'s> {
        self.owner.finish();
        Finished {
            owner: self.owner,
            case_sensitivity: self.case_sensitivity,
        }
    }
}

/// Resolution-only revision. Building it starts no capture checker or
/// diagnostic pool. Its diagnostics contain config, program and syntax facts
/// only; a later ordinary `open`/`finish` performs the one full check.
///
/// ```compile_fail
/// use nts_frontend_tsrs::{Session, ProjectSpec};
/// fn no_semantic_questions(session: &mut Session) {
///     let resolved = session.resolve(ProjectSpec::new("tsconfig.json")).unwrap();
///     let project = resolved.projects().next().unwrap();
///     let file = project.files().next().unwrap();
///     let _ = file.root().ty();
/// }
/// ```
#[derive(Debug)]
pub struct Resolved<'s> {
    revision: Finished<'s>,
}

impl<'s> Resolved<'s> {
    pub(crate) fn new(owner: &'s OwnedProgram, case_sensitivity: CaseSensitivity) -> Self {
        Self {
            revision: Finished {
                owner,
                case_sensitivity,
            },
        }
    }
    #[must_use]
    pub const fn case_sensitivity(&self) -> CaseSensitivity {
        self.revision.case_sensitivity()
    }
    pub fn projects(&self) -> impl ExactSizeIterator<Item = Project<'_, SyntaxPhase>> {
        self.revision.projects()
    }
    #[must_use]
    pub fn inputs(&self) -> Vec<Input> {
        self.revision.inputs()
    }
    /// Config, program and syntactic diagnostics only; no semantic errors.
    #[must_use]
    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        self.revision.diagnostics()
    }
}

/// Finished revision: diagnostics, inputs, and syntax-only borrowed views.
pub struct Finished<'s> {
    owner: &'s OwnedProgram,
    case_sensitivity: CaseSensitivity,
}
impl fmt::Debug for Finished<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Finished")
            .field("projects", &self.owner.projects.len())
            .finish_non_exhaustive()
    }
}
impl Finished<'_> {
    #[must_use]
    pub const fn case_sensitivity(&self) -> CaseSensitivity {
        self.case_sensitivity
    }
    pub fn projects(&self) -> impl ExactSizeIterator<Item = Project<'_, SyntaxPhase>> {
        self.owner.projects.iter().map(|native| Project {
            native,
            owner: self.owner,
            phase: PhantomData,
        })
    }
    #[must_use]
    pub fn inputs(&self) -> Vec<Input> {
        self.owner.host.inputs()
    }
    #[must_use]
    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        self.owner
            .diagnostics
            .get()
            .expect("Finished is constructed only after all program diagnostics were collected")
            .clone()
    }
    /// Raw bind/check facts only for native plain JS, before its error filter.
    /// The consumer applies its own allowlist; this is not a program error list.
    #[must_use]
    pub fn plain_js_unfiltered(&self) -> Vec<Diagnostic> {
        self.owner
            .plain_js_unfiltered
            .get()
            .expect("Finished is constructed only after plain-JS diagnostics were collected")
            .clone()
    }
}

/// The requested native config's program, including imported reference sources.
#[derive(Clone, Copy)]
pub struct Project<'s, S: ViewPhase = CapturePhase> {
    native: &'s NativeProject,
    owner: &'s OwnedProgram,
    phase: PhantomData<S>,
}

impl<S: ViewPhase> fmt::Debug for Project<'_, S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Project")
            .field("config_path", &self.config_path())
            .finish_non_exhaustive()
    }
}

impl Project<'_, SyntaxPhase> {
    /// Diagnostics of this requested program/config, after capture.
    #[must_use]
    pub fn diagnostics(self) -> Vec<Diagnostic> {
        self.owner
            .diagnostics
            .get()
            .expect("Finished is constructed only after all program diagnostics were collected")
            .clone()
    }
    /// Raw bind/check facts only for native plain JS, before its error filter.
    /// The consumer applies its own allowlist; this is not a program error list.
    #[must_use]
    pub fn plain_js_unfiltered(self) -> Vec<Diagnostic> {
        self.owner
            .plain_js_unfiltered
            .get()
            .expect("Finished is constructed only after plain-JS diagnostics were collected")
            .clone()
    }
}

impl<'s, S: ViewPhase> Project<'s, S> {
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
            // Use the same effective default/inheritance as the native checker
            // (CompilerOptions::get_strict_option_value), not tsconfig text.
            strict: options.get_strict_option_value(options.strict),
            strict_null_checks: options.get_strict_option_value(options.strict_null_checks),
            no_implicit_any: options.get_strict_option_value(options.no_implicit_any),
            strict_function_types: options.get_strict_option_value(options.strict_function_types),
            strict_bind_call_apply: options.get_strict_option_value(options.strict_bind_call_apply),
            strict_property_initialization: options
                .get_strict_option_value(options.strict_property_initialization),
            strict_builtin_iterator_return: options
                .get_strict_option_value(options.strict_builtin_iterator_return),
            no_implicit_this: options.get_strict_option_value(options.no_implicit_this),
            use_unknown_in_catch_variables: options
                .get_strict_option_value(options.use_unknown_in_catch_variables),
            always_strict: !options.always_strict.is_false(),
            no_unchecked_indexed_access: options.no_unchecked_indexed_access.is_true(),
            exact_optional_property_types: options.exact_optional_property_types.is_true(),
            disabled_strict_sources: self.native.disabled_strict_sources.clone(),
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
        if self.native.capture.borrow().is_none() {
            0
        } else if self.native.parallel_capture {
            self.native.program.checker_count() + 1
        } else {
            1
        }
    }
    pub fn files(self) -> impl ExactSizeIterator<Item = File<'s, S>> {
        self.native.files.iter().map(move |native| File {
            native,
            project: self.native,
            phase: PhantomData,
        })
    }
}

/// A native import resolution in this source file's import order.
///
/// nts-deps derives package name/directory from the last `node_modules`
/// component of `resolved_path`, and declaration status from its extension
/// (`.d.ts`, `.d.mts`, `.d.cts`); those are not separate checker facts.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedImport<'p> {
    pub specifier: crate::JsString<'p>,
    /// The checker's chosen physical source or declaration path; None if unresolved.
    pub resolved_path: Option<&'p Utf8Path>,
    /// Only the version recorded in the native `PackageId`; no manifest fallback.
    pub package_version: Option<crate::JsString<'p>>,
}

/// One native source file. Its text and UTF-16 index belong to this revision.
#[derive(Clone, Copy)]
pub struct File<'s, S: ViewPhase = CapturePhase> {
    native: &'s NativeFile,
    project: &'s NativeProject,
    phase: PhantomData<S>,
}

impl<S: ViewPhase> fmt::Debug for File<'_, S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("File")
            .field("path", &self.path())
            .finish_non_exhaustive()
    }
}

impl<'s, S: ViewPhase> File<'s, S> {
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
    pub fn root(self) -> crate::Node<'s, S> {
        crate::Node::new(self.native.source.as_node(), self)
    }
    #[must_use]
    pub fn path(self) -> &'s Utf8Path {
        crate::host::native_path(self.native.source.file_name())
    }
    #[must_use]
    pub fn text(self) -> &'s str {
        std::str::from_utf8(self.native.source.text().as_bytes()).expect(
            "source text comes from validated overlays or the native UTF-8/UTF-16 file decoder",
        )
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
    /// The same native resolutions used to build the program, without a new lookup.
    /// Available during capture and after diagnostics; checker state is untouched.
    pub fn resolved_imports(self) -> impl ExactSizeIterator<Item = ResolvedImport<'s>> {
        self.native.source.imports.get().iter().map(move |node| {
            let resolved = self
                .project
                .program
                .get_resolved_module_from_module_specifier(self.native.source, *node)
                .filter(|module| module.is_resolved());
            ResolvedImport {
                specifier: self.intern_string(node.text().as_bytes()),
                resolved_path: resolved
                    .map(|module| crate::host::native_path(module.resolved_file_name)),
                package_version: resolved.and_then(|module| {
                    (!module.package_id.name.is_empty())
                        .then(|| self.intern_string(module.package_id.version.as_bytes()))
                }),
            }
        })
    }
}

impl<'s> File<'s> {
    /// Every question borrows the same persistent capture checker, outside the
    /// diagnostics pool. No borrow survives this call; its errors are discarded.
    pub(crate) fn with_checker<R>(
        self,
        question: impl FnOnce(&mut tsrs_compiler::Checker) -> R,
    ) -> R {
        let _scope = self.project.capture_region.enter_scratch();
        let mut checker = self.project.capture.borrow_mut();
        question(checker.as_mut().expect(
            "only capture-phase views may ask questions, after their checker was initialized",
        ))
    }
    pub(crate) fn node_view(self, native: P<tsrs_ast::Node>) -> Option<crate::Node<'s>> {
        let source = tsrs_ast::get_source_file_of_node(native)?;
        let index = *self.project.file_index.get(&source)?;
        Some(crate::Node::new(
            native,
            Self {
                native: &self.project.files[index],
                project: self.project,
                phase: PhantomData,
            },
        ))
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
            let capture = session.open(project()).expect("inline project loads");
            let native = &capture.owner.projects[0];
            assert!(native.diagnostics_task.borrow().is_none());
            assert!(native.diagnostic_results.get().is_none());
            let checked = capture.diagnose_fixture_files().finish();
            let project = checked.projects().next().expect("root program");
            assert_eq!(project.checker_count(), 1);
            assert_eq!(
                project
                    .native
                    .diagnostic_results
                    .get()
                    .expect("diagnostics finished")
                    .thread,
                std::thread::current().id(),
                "one checker never starts a second checker thread"
            );
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

    #[test]
    fn parallel_capture_uses_a_separate_diagnostic_thread_within_the_total_budget() {
        run(options(4), |session| {
            let unselected = session.open(project()).expect("inline project loads");
            assert!(
                unselected.owner.projects[0]
                    .diagnostics_task
                    .borrow()
                    .is_none()
            );
            let capture = unselected.diagnose_fixture_files();
            assert!(
                capture.owner.projects[0]
                    .diagnostics_task
                    .borrow()
                    .is_some()
            );
            let finished = capture.finish();
            let project = finished.projects().next().expect("requested project");
            assert_eq!(project.checker_count(), 4);
            assert_eq!(project.native.program.checker_count(), 3);
            assert_ne!(
                project
                    .native
                    .diagnostic_results
                    .get()
                    .expect("diagnostics finished")
                    .thread,
                std::thread::current().id()
            );
        });
    }

    #[test]
    #[should_panic(expected = "capture unwinds while independent diagnostics run")]
    fn capture_unwind_joins_diagnostics_before_freeing_the_program() {
        run(options(4), |session| {
            let _capture = session
                .open(project())
                .expect("inline project loads")
                .diagnose_fixture_files();
            panic!("capture unwinds while independent diagnostics run");
        });
    }

    fn capture(count: u16) -> (Vec<(String, String)>, Vec<Diagnostic>) {
        run(options(count), |session| {
            let checked = session
                .open(project())
                .expect("inline project loads")
                .diagnose_fixture_files()
                .finish();
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
                    let checked = session
                        .open(project())
                        .expect("initial project")
                        .diagnose_fixture_files()
                        .finish();
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
                let checked = session
                    .revise(changes)
                    .expect("revision loads")
                    .diagnose_fixture_files()
                    .finish();
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
                let checked = session
                    .open(spec)
                    .expect("reference graph loads")
                    .diagnose_fixture_files()
                    .finish();
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
            let checked = session
                .open(spec)
                .expect("JavaScript config")
                .diagnose_fixture_files()
                .finish();
            assert!(checked.plain_js_unfiltered().iter().any(|d| d.code == 2451));
        });
    }

    #[test]
    fn strictness_uses_effective_native_defaults_inheritance_and_overrides() {
        for (settings, expected) in [
            ("", [true, true, false, false]),
            (r#""strict":false"#, [false, false, false, false]),
            (
                r#""strict":true,"strictNullChecks":false"#,
                [true, false, false, false],
            ),
            (
                r#""strict":false,"strictNullChecks":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true"#,
                [false, true, true, true],
            ),
        ] {
            run(options(1), |session| {
                let mut spec = ProjectSpec::new("tsconfig.json");
                spec.overlays.insert(
                    "tsconfig.json".into(),
                    format!(r#"{{"compilerOptions":{{{settings}}},"files":["index.ts"]}}"#),
                );
                spec.overlays
                    .insert("index.ts".into(), "export const value = 1;".into());
                let checked = session.open(spec).expect("strictness config");
                let semantics = checked
                    .projects()
                    .next()
                    .expect("requested program")
                    .semantics();
                assert_eq!(
                    [
                        semantics.strict,
                        semantics.strict_null_checks,
                        semantics.no_unchecked_indexed_access,
                        semantics.exact_optional_property_types
                    ],
                    expected,
                    "{settings}"
                );
                assert_eq!(checked.diagnose_fixture_files().finish().diagnostics(), []);
            });
        }
        run(options(1), |session| {
            let mut spec = ProjectSpec::new("tsconfig.json");
            spec.overlays.insert("base.json".into(), r#"{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true}}"#.into());
            spec.overlays.insert("tsconfig.json".into(), r#"{"extends":"./base.json","compilerOptions":{"noUncheckedIndexedAccess":false},"files":["index.ts"]}"#.into());
            spec.overlays
                .insert("index.ts".into(), "export const value = 1;".into());
            let checked = session.open(spec).expect("strictness config");
            let semantics = checked
                .projects()
                .next()
                .expect("requested program")
                .semantics();
            assert!(semantics.strict);
            assert!(semantics.strict_null_checks);
            assert!(!semantics.no_unchecked_indexed_access);
            assert!(semantics.exact_optional_property_types);
            assert_eq!(checked.diagnose_fixture_files().finish().diagnostics(), []);
        });
    }

    #[test]
    fn disabled_strict_sources_follow_native_extends_order_and_null_resets() {
        for (root_options, any_setting, any_config) in [
            (
                r#""noImplicitAny":true,"strictNullChecks":false"#,
                None,
                None,
            ),
            (
                r#""noImplicitAny":null,"strictNullChecks":false"#,
                Some("strict"),
                Some("base.json"),
            ),
        ] {
            run(options(1), |session| {
                let mut spec = ProjectSpec::new("tsconfig.json");
                for (name, text) in [
                    ("tsconfig.json", format!(r#"{{"extends":["./first.json","./second.json"],"compilerOptions":{{{root_options}}},"files":["index.ts"]}}"#)),
                    ("first.json", r#"{"compilerOptions":{"strict":false,"strictFunctionTypes":false}}"#.into()),
                    ("second.json", r#"{"extends":"./base.json","compilerOptions":{"strictFunctionTypes":true,"noImplicitAny":false}}"#.into()),
                    ("base.json", r#"{"compilerOptions":{"strict":false}}"#.into()),
                    ("index.ts", "export const value = 1;".into()),
                ] {
                    spec.overlays.insert(name.into(), text);
                }
                let checked = session.open(spec).expect("inherited strict configuration");
                let semantics = checked.projects().next().expect("root program").semantics();
                assert!(
                    semantics.strict_function_types,
                    "the later base overrides the first one"
                );
                let sources = semantics.disabled_strict_sources;
                let null = sources
                    .iter()
                    .find(|s| s.name == "strictNullChecks")
                    .expect("disabled null check");
                assert_eq!(null.setting, "strictNullChecks");
                assert_eq!(null.configuration.file_name(), Some("tsconfig.json"));
                let bind = sources
                    .iter()
                    .find(|s| s.name == "strictBindCallApply")
                    .expect("disabled bundle member");
                assert_eq!(bind.setting, "strict");
                assert_eq!(bind.configuration.file_name(), Some("base.json"));
                let any = sources.iter().find(|s| s.name == "noImplicitAny");
                assert_eq!(any.map(|s| s.setting), any_setting);
                assert_eq!(any.and_then(|s| s.configuration.file_name()), any_config);
            });
        }
    }

    #[test]
    fn individual_strict_options_can_enable_the_whole_group_with_strict_false() {
        run(options(1), |session| {
            let mut spec = ProjectSpec::new("tsconfig.json");
            let members = crate::config_sources::STRICT_OPTIONS
                .iter()
                .map(|(name, _)| format!("\"{name}\":true"))
                .collect::<Vec<_>>()
                .join(",");
            spec.overlays.insert(
                "tsconfig.json".into(),
                format!(
                    r#"{{"compilerOptions":{{"strict":false,{members}}},"files":["index.ts"]}}"#
                ),
            );
            spec.overlays
                .insert("index.ts".into(), "export const value = 1;".into());
            let checked = session.open(spec).expect("individually strict project");
            let semantics = checked.projects().next().expect("root program").semantics();
            assert!(!semantics.strict);
            assert_eq!(semantics.disabled_strict_sources, []);
            assert!(
                [
                    semantics.no_implicit_any,
                    semantics.strict_null_checks,
                    semantics.strict_function_types,
                    semantics.strict_bind_call_apply,
                    semantics.strict_property_initialization,
                    semantics.strict_builtin_iterator_return,
                    semantics.no_implicit_this,
                    semantics.use_unknown_in_catch_variables,
                    semantics.always_strict,
                ]
                .into_iter()
                .all(|enabled| enabled)
            );
        });
    }

    #[test]
    fn always_strict_false_is_a_removed_native_option_not_a_sloppy_mode() {
        run(options(1), |session| {
            let mut spec = ProjectSpec::new("tsconfig.json");
            spec.overlays.insert(
                "tsconfig.json".into(),
                r#"{"compilerOptions":{"alwaysStrict":false},"files":["index.ts"]}"#.into(),
            );
            spec.overlays
                .insert("index.ts".into(), "export const value = 1;".into());
            let checked = session.open(spec).expect("native config");
            let semantics = checked.projects().next().expect("root program").semantics();
            assert!(!semantics.always_strict);
            let finished = checked.diagnose_fixture_files().finish();
            assert!(
                finished
                    .diagnostics()
                    .iter()
                    .any(|d| d.message.contains("alwaysStrict") && d.message.contains("removed")),
                "{:?}",
                finished.diagnostics()
            );
        });
    }

    #[test]
    fn always_strict_uses_its_independent_default_and_native_extends_precedence() {
        for (local, expected) in [
            ("", false),
            (r#", "alwaysStrict": true"#, true),
            (r#", "alwaysStrict": null"#, true),
        ] {
            run(options(1), |session| {
                let mut spec = ProjectSpec::new("tsconfig.json");
                spec.overlays.insert(
                    "base.json".into(),
                    r#"{"compilerOptions":{"alwaysStrict":false}}"#.into(),
                );
                spec.overlays.insert("tsconfig.json".into(), format!(r#"{{"extends":"./base.json","compilerOptions":{{"strict":false{local}}},"files":["index.ts"]}}"#));
                spec.overlays
                    .insert("index.ts".into(), "const value = 1;".into());
                let checked = session.open(spec).expect("alwaysStrict inheritance");
                let semantics = checked.projects().next().expect("root program").semantics();
                assert_eq!(semantics.always_strict, expected, "{local}");
                let source = semantics
                    .disabled_strict_sources
                    .iter()
                    .find(|source| source.name == "alwaysStrict");
                assert_eq!(
                    source.map(|source| source.configuration.file_name()),
                    if expected {
                        None
                    } else {
                        Some(Some("base.json"))
                    }
                );
            });
        }
    }

    #[test]
    fn native_always_strict_false_survives_every_provenance_bound() {
        for bound in ["nodes", "edges", "bytes"] {
            run(options(1), |session| {
                let mut spec = ProjectSpec::new("tsconfig.json");
                let mut root = serde_json::json!({"files":["index.ts"]});
                match bound {
                    "nodes" => {
                        root["extends"] = "./base-0.json".into();
                        for i in 0..crate::config_sources::MAX_CONFIGS {
                            let config = if i + 1 < crate::config_sources::MAX_CONFIGS {
                                serde_json::json!({"extends":format!("./base-{}.json",i+1)})
                            } else {
                                serde_json::json!({"compilerOptions":{"alwaysStrict":false}})
                            };
                            spec.overlays
                                .insert(format!("base-{i}.json").into(), config.to_string());
                        }
                    }
                    "edges" => {
                        root["extends"] = serde_json::json!(vec![
                            "./base.json";
                            crate::config_sources::MAX_EDGES
                                + 1
                        ]);
                        spec.overlays.insert(
                            "base.json".into(),
                            r#"{"compilerOptions":{"alwaysStrict":false}}"#.into(),
                        );
                    }
                    "bytes" => {
                        root["compilerOptions"] = serde_json::json!({"alwaysStrict":false});
                    }
                    _ => unreachable!(),
                }
                let text = if bound == "bytes" {
                    format!("/*{}*/{}", " ".repeat(1024 * 1024 + 1), root)
                } else {
                    root.to_string()
                };
                spec.overlays.insert("tsconfig.json".into(), text);
                spec.overlays
                    .insert("index.ts".into(), "const value = 1;".into());
                let checked = session.open(spec).expect("native config still resolves");
                let semantics = checked.projects().next().expect("root program").semantics();
                assert!(
                    !semantics.always_strict,
                    "{bound} exhaustion must not waive actual false"
                );
                assert!(
                    !semantics
                        .disabled_strict_sources
                        .iter()
                        .any(|source| source.name == "alwaysStrict"),
                    "{bound} provenance is unavailable"
                );
            });
        }
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
                let checked = session
                    .open(spec)
                    .expect("semantics config")
                    .diagnose_fixture_files()
                    .finish();
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
                    .expect("node workspace app")
                    .diagnose_fixture_files()
                    .finish();
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
                    .expect("workspace solution")
                    .diagnose_fixture_files()
                    .finish();
                assert_eq!(checked.projects().len(), 1);
                let project = checked.projects().next().expect("solution program");
                assert_eq!(project.root_paths().len(), 0);
                assert_eq!(project.files().len(), 0);
            });
        }
    }

    #[test]
    fn resolution_starts_no_checker_and_has_only_config_program_and_syntax_diagnostics() {
        run(options(4), |session| {
            {
                let resolved = session.resolve(project()).expect("resolution only");
                let project = resolved.projects().next().expect("requested project");
                assert_eq!(project.checker_count(), 0);
                assert!(project.native.capture.borrow().is_none());
                assert!(project.native.diagnostics_task.borrow().is_none());
                assert!(project.native.diagnostic_results.get().is_none());
                assert!(!resolved.diagnostics().iter().any(|d| d.code == 2322));
                assert_ne!(resolved.inputs(), []);
            }
            let checked = session
                .open(project())
                .expect("full check")
                .diagnose_fixture_files()
                .finish();
            assert!(checked.diagnostics().iter().any(|d| d.code == 2322));
        });
    }

    fn resolutions(project: Project<'_, SyntaxPhase>) -> Vec<String> {
        project
            .files()
            .flat_map(|file| {
                file.resolved_imports().map(move |import| {
                    format!(
                        "{}: {:?} -> {:?} ({:?})",
                        file.path(),
                        import.specifier.utf16(),
                        import.resolved_path,
                        import.package_version.map(crate::JsString::utf16)
                    )
                })
            })
            .collect()
    }

    #[test]
    fn workspace_resolution_matches_full_program_imports_without_any_checker() {
        let cwd = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        for count in [1, 4] {
            let mut options = SessionOptions::new(cwd.clone());
            options.checker_count = NonZeroU16::new(count);
            run(options, |session| {
                let config = "tests/workspace/apps/node/tsconfig.json";
                let resolution = {
                    let resolved = session
                        .resolve(ProjectSpec::new(config))
                        .expect("resolution");
                    let project = resolved.projects().next().expect("requested project");
                    assert_eq!(project.checker_count(), 0);
                    assert_eq!(project.root_paths().len(), 1);
                    resolutions(project)
                };
                assert_ne!(resolution, [] as [String; 0]);
                let checked = session
                    .open(ProjectSpec::new(config))
                    .expect("full program")
                    .diagnose_fixture_files()
                    .finish();
                assert_eq!(
                    resolution,
                    resolutions(checked.projects().next().expect("project"))
                );
            });
        }
    }

    #[test]
    #[ignore = "child-process helper for the shared-graph environment test"]
    fn shared_graph_environment_probe() {
        let one = capture(1);
        assert_eq!(one, capture(4));
        let flags = public_object_flag_facts(1);
        assert_eq!(flags, public_object_flag_facts(4));
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
        let fingerprint = xxh3_128(format!("{:?}{semantic:?}{flags:?}", one.0).as_bytes());
        println!("NTS_NATIVE_FACTS {fingerprint:032x}");
        println!("NTS_NATIVE_ID {}", run(options(1), |s| s.cache_identity()));
    }

    fn public_object_flag_facts(count: u16) -> Vec<String> {
        use crate::{SignatureKind, SymbolName, TypeKind};
        run(options(count), |session| {
            let mut spec = ProjectSpec::new("tsconfig.json");
            spec.overlays.insert("tsconfig.json".into(),
                r#"{"compilerOptions":{"strict":true,"target":"ESNext","types":[]},"files":["main.ts"]}"#.into());
            spec.overlays.insert(
                "main.ts".into(),
                r"
export type Numbers = number[];
export type Tuple = [number, string];
export interface Box<T> { value: T; method(value: T): T; }
export type Boxed = Box<string>;
export const callable = (value: number) => value;
"
                .into(),
            );
            let checked = session.open(spec).expect("semantic flag project");
            let file = checked
                .projects()
                .next()
                .expect("project")
                .files()
                .find(|file| file.path().ends_with("main.ts"))
                .expect("source");
            let mut facts = Vec::new();
            let mut references = 0;
            for export in file.module_symbol().expect("module").exports() {
                let SymbolName::Plain(name) = export.name else {
                    panic!("plain export");
                };
                let name = name.utf8().expect("Unicode export");
                let ty = export
                    .symbol
                    .declared_type()
                    .unwrap_or_else(|| export.symbol.ty());
                let before = (ty.kind(), ty.non_inferrable(), ty.evolving_any());
                let arguments = ty.reference().map(|reference| {
                    reference
                        .arguments
                        .iter()
                        .map(|argument| argument.kind())
                        .collect::<Vec<_>>()
                });
                references += usize::from(arguments.is_some());
                if name == "Numbers" {
                    assert_eq!(before, (TypeKind::Reference, false, false));
                    assert_eq!(arguments, Some(vec![TypeKind::Number]));
                }
                let mut properties: Vec<_> = ty
                    .properties()
                    .iter()
                    .filter_map(|property| {
                        let SymbolName::Plain(name) = property.name else {
                            return None;
                        };
                        Some((
                            name.utf8().expect("Unicode property").to_owned(),
                            property.ty.kind(),
                        ))
                    })
                    .collect();
                properties.sort_by(|a, b| a.0.cmp(&b.0));
                let signatures: Vec<_> = ty
                    .signatures(SignatureKind::Call)
                    .iter()
                    .map(|signature| signature.return_type().kind())
                    .collect();
                assert_eq!(
                    before,
                    (ty.kind(), ty.non_inferrable(), ty.evolving_any()),
                    "lazy member/signature queries changed semantic bits for {name}"
                );
                facts.push(format!(
                    "{name}:{before:?}:{arguments:?}:{properties:?}:{signatures:?}"
                ));
            }
            assert!(
                references >= 3,
                "array, tuple and instantiated interface queried"
            );
            facts.sort();
            let diagnostics = checked.diagnose_fixture_files().finish().diagnostics();
            assert!(
                diagnostics.iter().all(|diagnostic| diagnostic.category
                    == DiagnosticCategory::Message
                    && diagnostic.code == 0),
                "{diagnostics:?}"
            );
            facts
        })
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

#[cfg(test)]
#[path = "resolution_test.rs"]
mod resolution_tests;

#[cfg(test)]
#[path = "diagnostics_test.rs"]
mod diagnostic_tests;

#[cfg(test)]
#[path = "diagnostic_scope_test.rs"]
mod diagnostic_scope_tests;

#[cfg(test)]
#[path = "no_emit_test.rs"]
mod no_emit_tests;
