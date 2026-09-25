//! A project as tsgo checks it, held open for the whole run.
//!
//! One live session serves everything the stage asks: the list of the
//! project's files, each file's syntax tree, and -- for restoring types on the
//! compiler's output -- the checker's type at a node. The converter reads
//! only syntax (kinds, children, text, spans), so nothing here builds nts's
//! full semantic snapshot, which would decompose every type in the program.

use anyhow::{Context, Result, anyhow};
use camino::{Utf8Path, Utf8PathBuf};
use nts_diagnostics::SourceId;
use nts_frontend_ts::tsgo::ast::{EncodedSourceFile, decode};
use nts_frontend_ts::tsgo::proto::{ProjectHandle, SnapshotHandle};
use nts_frontend_ts::tsgo::{self, Client};

#[derive(Debug)]
pub struct Session {
    client: Client,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    directory: Utf8PathBuf,
}

impl Session {
    /// Starts tsgo and loads the project `tsconfig` names.
    pub fn open(tsconfig: &Utf8Path) -> Result<Self> {
        let executable = tsgo::locate().ok_or_else(|| anyhow!("no tsgo: set NTS_TSGO, or build it (target/tsgo)"))?;
        let directory = tsconfig.parent().context("a tsconfig path has a directory")?.to_owned();
        let mut client = Client::spawn(&executable, &directory).with_context(|| format!("cannot start {executable}"))?;
        client.initialize().context("tsgo did not initialise")?;
        let response = client.open_project(tsconfig).with_context(|| format!("tsgo could not load {tsconfig}"))?;
        let project = response.projects.first().map(|p| p.id.clone()).with_context(|| format!("{tsconfig} opened no project"))?;
        Ok(Self { client, snapshot: response.snapshot, project, directory })
    }

    /// The project's own TypeScript sources: under the project directory, not
    /// declarations, not reached through `node_modules`.
    pub fn own_sources(&mut self) -> Result<Vec<Utf8PathBuf>> {
        let names = self.client.source_file_names(self.snapshot, &self.project).context("tsgo listed no files")?;
        let mut own: Vec<Utf8PathBuf> = names
            .into_iter()
            .map(Utf8PathBuf::from)
            .filter(|path| {
                path.starts_with(&self.directory)
                    && !path.as_str().contains("/node_modules/")
                    && !path.as_str().ends_with(".d.ts")
                    && matches!(path.extension(), Some("ts" | "tsx"))
            })
            .collect();
        own.sort();
        Ok(own)
    }

    /// One file's syntax tree. Its nodes are numbered from 0, the `SourceFile`,
    /// and a node's tsgo handle is its number plus one (tsgo's index 0 is nil).
    pub fn file(&mut self, path: &Utf8Path) -> Result<EncodedSourceFile> {
        let payload = self.client.source_file(self.snapshot, &self.project, path).with_context(|| format!("tsgo has no {path}"))?;
        decode(&payload, SourceId(0)).map_err(|error| anyhow!("{path} does not decode: {error}"))
    }
}
