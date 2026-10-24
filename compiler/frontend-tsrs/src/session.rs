//! Native checking-thread and program ownership.
//!
//! Capture uses one independently owned checker for every semantic question.
//! Its diagnostics are never program diagnostics. At a total count of one,
//! the separate diagnostic pool runs on the same thread after capture; at N >= 2
//! it runs concurrently with at most N - 1 checkers. Its handles never feed capture identities.
//! Stable type ordering is pinned on. AST/file views may be live during a
//! typing question, but no internal checker borrow escapes a query method.

use std::marker::PhantomData;
use std::num::NonZeroU16;
use std::rc::Rc;

use crate::program::{Checked, LoadError, OwnedProgram, ProjectSpec, Resolved, SourceChanges};
use camino::Utf8PathBuf;

/// The host filesystem's name comparison semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CaseSensitivity {
    Sensitive,
    Insensitive,
}

/// Configuration of the native checking session, independent of any CLI.
#[derive(Debug, Clone)]
pub struct SessionOptions {
    /// Explicit absolute working directory. The process never changes directory.
    pub cwd: Utf8PathBuf,
    /// An explicit library override; otherwise tsrs's embedded libraries.
    pub library_path: Option<Utf8PathBuf>,
    /// Total checker concurrency. One runs capture then diagnostics on the same
    /// thread; N >= 2 reserves one for capture and N - 1 for diagnostics.
    /// `None` uses the upstream diagnostic pool's default, plus capture.
    /// The supported explicit range is 1 through 256.
    pub checker_count: Option<NonZeroU16>,
}

impl SessionOptions {
    #[must_use]
    pub fn new(cwd: impl Into<Utf8PathBuf>) -> Self {
        Self {
            cwd: cwd.into(),
            library_path: None,
            checker_count: None,
        }
    }
}

/// One session, constructed and destroyed on its checking thread.
///
/// Its native state and all checked views are neither `Send` nor `Sync`.
pub struct Session {
    options: SessionOptions,
    case_sensitivity: CaseSensitivity,
    _thread_bound: PhantomData<Rc<()>>,
    current: Option<OwnedProgram>,
    spec: Option<ProjectSpec>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("options", &self.options)
            .field("case_sensitivity", &self.case_sensitivity)
            .finish_non_exhaustive()
    }
}

impl Session {
    fn new(options: SessionOptions) -> Self {
        assert!(options.cwd.is_absolute(), "native cwd must be absolute");
        assert!(
            options.checker_count.is_none_or(|count| count.get() <= 256),
            "native checker count must be between 1 and 256"
        );
        let case_sensitivity = if tsrs_vfs::osvfs::fs().use_case_sensitive_file_names() {
            CaseSensitivity::Sensitive
        } else {
            CaseSensitivity::Insensitive
        };
        Self {
            options,
            case_sensitivity,
            _thread_bound: PhantomData,
            current: None,
            spec: None,
        }
    }

    #[must_use]
    pub fn options(&self) -> &SessionOptions {
        &self.options
    }

    #[must_use]
    pub const fn case_sensitivity(&self) -> CaseSensitivity {
        self.case_sensitivity
    }

    /// Vendor, adapter, pinned mode, library override, checker settings and
    /// immutable native runtime environment. Actual source reads are additional
    /// cache inputs supplied by `Checked::inputs`.
    #[must_use]
    pub fn cache_identity(&self) -> String {
        crate::environment::initialize().cache_identity(&self.options)
    }

    /// Replace the checked project. No views of the previous program can be live.
    pub fn open(&mut self, spec: ProjectSpec) -> Result<Checked<'_>, LoadError> {
        crate::environment::initialize();
        self.current = None;
        self.spec = Some(spec);
        let program = OwnedProgram::open(&self.options, self.spec.as_ref().expect("project set"))?;
        self.current = Some(program);
        Ok(Checked::new(
            self.current.as_ref().expect("program set"),
            self.case_sensitivity,
        ))
    }

    /// Resolve config, roots and imports without constructing any checker.
    /// Syntax-only views and config/program/syntactic diagnostics are available;
    /// dependency acquisition can settle before the one full ordinary check.
    pub fn resolve(&mut self, spec: ProjectSpec) -> Result<Resolved<'_>, LoadError> {
        crate::environment::initialize();
        self.current = None;
        self.spec = Some(spec);
        self.current = Some(OwnedProgram::resolve(
            &self.options,
            self.spec.as_ref().expect("project set"),
        )?);
        Ok(Resolved::new(
            self.current.as_ref().expect("program set"),
            self.case_sensitivity,
        ))
    }

    /// Rebuild using changed source text and optional replacement extra roots.
    pub fn revise(&mut self, changes: SourceChanges) -> Result<Checked<'_>, LoadError> {
        let mut spec = self.spec.clone().ok_or(LoadError::NoProject)?;
        for (path, text) in changes.overlays {
            if let Some(text) = text {
                spec.overlays.insert(path, text);
            } else {
                spec.overlays.remove(&path);
            }
        }
        if let Some(roots) = changes.roots {
            spec.roots = roots;
        }
        self.open(spec)
    }
}

/// Run the whole frontend on the stack required by the native checker.
///
/// Only the owned result leaves the checking thread. An upstream panic runs
/// its original hook there and is resumed on the caller; nothing recovers it.
pub fn run<R: Send>(options: SessionOptions, build: impl FnOnce(&mut Session) -> R + Send) -> R {
    crate::environment::initialize();
    std::thread::scope(|scope| {
        let checking = std::thread::Builder::new()
            .name("nts-tsrs".to_owned())
            .stack_size(512 << 20)
            .spawn_scoped(scope, move || build(&mut Session::new(options)))
            .expect("could not start the native checking thread");
        match checking.join() {
            Ok(output) => output,
            Err(payload) => std::panic::resume_unwind(payload),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> SessionOptions {
        SessionOptions::new(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn owned_output_returns_from_a_distinct_named_checking_thread() {
        let caller = std::thread::current().id();
        let output = run(options(), |session| {
            assert_ne!(std::thread::current().id(), caller);
            assert_eq!(std::thread::current().name(), Some("nts-tsrs"));
            assert!(session.options().cwd.is_absolute());
            "owned snapshot output".to_owned()
        });
        assert_eq!(output, "owned snapshot output");
    }

    #[test]
    #[should_panic(expected = "native panic payload stays a panic")]
    fn panic_is_resumed_on_the_calling_thread() {
        run(options(), |_| panic!("native panic payload stays a panic"));
    }
}
