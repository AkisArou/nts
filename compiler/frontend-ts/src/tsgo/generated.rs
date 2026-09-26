//! Files a build generates for the program it checks, added to the project.
//!
//! A program that imports `{ NSWindow } from "objc:AppKit"` declares nothing
//! about `NSWindow`: the declaration is generated from the import, by
//! something that reads the program first. The project's own config does not
//! list the generated files and should not have to, so the generator answers a
//! config of its own -- one that `extends` the project's and adds them under
//! `files` -- and that config is opened in the project's place.
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

    /// The config to open in place of `tsconfig`, given the project's own
    /// files (`roots`) and what the checker said of the config opened last
    /// (`complaints`, empty the first time). `None` opens the project as it
    /// is, or keeps the config opened last.
    ///
    /// # Errors
    /// Why the files could not be generated, said to the person building.
    fn config(&mut self, tsconfig: &Utf8Path, roots: &[String], complaints: &[Complaint]) -> Result<Option<Utf8PathBuf>, String>;
}
