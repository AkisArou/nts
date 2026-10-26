//! In-process TypeScript capture, including nts's generated/source stages.

mod driver;

use std::num::NonZeroU16;
use std::time::Instant;

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_tsrs::{self as native, SessionOptions};
use nts_semantic_schema::{SemanticSnapshot, SnapshotError};

use crate::{FrontendStats, generated::Generated, transform::SourceTransform};

/// The sole native frontend configuration. Session state and borrowed checker
/// views stay on the checking thread; only an owned snapshot returns.
#[derive(Debug)]
pub struct Frontend {
    options: SessionOptions,
    generated: Option<Box<dyn Generated>>,
    transform: Option<Box<dyn SourceTransform>>,
    added: Vec<Utf8PathBuf>,
    stats: FrontendStats,
}

impl Frontend {
    /// Inspect the checked syntax and request rendered types only where a
    /// consumer needs them. No semantic type graph is built. Each callback
    /// runs on the native session thread; only its owned result leaves it.
    ///
    /// # Errors
    /// A program cannot be loaded, its syntax cannot be captured, or the
    /// visitor returns an error.
    pub fn inspect<R: Send, E: From<SnapshotError> + Send>(
        &self,
        config: &Utf8Path,
        visitor: impl FnMut(
            &crate::transform::TransformInput<'_>,
            &crate::transform::NodeTypes<'_>,
        ) -> Result<R, E>
        + Send,
    ) -> Result<Vec<R>, E> {
        let config = if config.is_absolute() {
            config.to_owned()
        } else {
            self.options.cwd.join(config)
        };
        native::run(self.options.clone(), |session| {
            driver::inspect(session, config, visitor)
        })
    }

    /// `cwd` is explicit and absolute. No process directory or environment is
    /// changed while checking a project.
    #[must_use]
    pub fn new(cwd: impl Into<Utf8PathBuf>) -> Self {
        Self {
            options: SessionOptions::new(cwd),
            generated: None,
            transform: None,
            added: Vec::new(),
            stats: FrontendStats::default(),
        }
    }

    /// Default: the native compiler chooses its checker pool size. Batch
    /// runners set this to one for each isolated worker process.
    #[must_use]
    pub fn with_checkers(mut self, count: NonZeroU16) -> Self {
        self.options.checker_count = Some(count);
        self
    }

    #[must_use]
    pub fn with_library_path(mut self, path: Utf8PathBuf) -> Self {
        self.options.library_path = Some(path);
        self
    }

    #[must_use]
    pub fn with_generated(mut self, generated: Box<dyn Generated>) -> Self {
        self.generated = Some(generated);
        self
    }

    #[must_use]
    pub fn with_transform(mut self, transform: Box<dyn SourceTransform>) -> Self {
        self.transform = Some(transform);
        self
    }

    #[must_use]
    pub fn with_added(mut self, files: &[Utf8PathBuf]) -> Self {
        self.added = files
            .iter()
            .map(|path| {
                if path.is_absolute() {
                    path.clone()
                } else {
                    self.options.cwd.join(path)
                }
            })
            .collect();
        self
    }
}

impl Frontend {
    /// Capture the requested program through the native checker.
    ///
    /// # Errors
    /// Loading, syntax capture, or semantic graph validation failed.
    pub fn snapshot(&mut self, config: &Utf8Path) -> Result<SemanticSnapshot, SnapshotError> {
        let started = Instant::now();
        let config = if config.is_absolute() {
            config.to_owned()
        } else {
            self.options.cwd.join(config)
        };
        let snapshot = native::run(self.options.clone(), |session| {
            driver::capture(self, session, config)
        })?;
        self.stats = driver::stats(&snapshot, started.elapsed());
        Ok(snapshot)
    }

    /// Work measured by the most recent capture.
    #[must_use]
    pub fn stats(&self) -> FrontendStats {
        self.stats
    }

    /// Configuration and source-stage identities that determine a capture.
    #[must_use]
    pub fn identity(&self) -> String {
        format!(
            "native:{:032x}:{:?}:{:?}:{}:{}:{:?}",
            crate::FRONTEND_STAMP,
            self.options.checker_count,
            self.options.library_path,
            self.generated
                .as_ref()
                .map_or_else(String::new, |generated| generated.identity()),
            self.transform
                .as_ref()
                .map_or_else(String::new, |transform| transform.identity()),
            self.added
        )
    }
}
