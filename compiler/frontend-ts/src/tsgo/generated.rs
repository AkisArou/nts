//! Files a build generates for the program it checks, added to the project.
//!
//! A program that imports `{ NSWindow } from "objc:AppKit"` declares nothing
//! about `NSWindow`: the declaration is generated from the import, by
//! something that reads the program first. The project's own config does not
//! list the generated files and should not have to, so the generator answers
//! the files, and the frontend opens the project with them besides its own
//! (`open_adding`).
//!
//! Only the opening changes. Everything else keyed on the project's config --
//! its directory, the `nts.config.ts` beside it, the snapshot cache -- still
//! reads the project's, which is what the caller passed.

use camino::{Utf8Path, Utf8PathBuf};

/// One complaint of the checker's about the last config opened: its code and
/// its message, which is what a generator reads to learn what it left out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Complaint {
    pub code: i32,
    pub text: String,
}

/// A generator of files for the program at `tsconfig`.
pub trait Generated: std::fmt::Debug {
    /// What decides the generated files beside the program's own: it keys the
    /// snapshot cache, as a source transform's identity does.
    fn identity(&self) -> String;

    /// The files to open the project at `tsconfig` with, besides its own
    /// (`roots`), given what the checker said of the program opened last --
    /// the project's own, the first time. `None` opens the project as it is,
    /// or keeps what was opened last.
    ///
    /// # Errors
    /// Why the files could not be generated, said to the person building.
    fn files(
        &mut self,
        tsconfig: &Utf8Path,
        roots: &[String],
        complaints: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String>;
}
