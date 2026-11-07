//! Where a test keeps its scratch, by the rule tooling/gate/test-scratch.ts
//! gives the TypeScript tests: under TMPDIR when that is inside ~/.cache, as
//! the gate's canonical environment makes it (inside the run, so what a stopped
//! run leaves goes with it), else under ~/.cache/nts/tests, never /tmp's
//! tmpfs. Each test makes its own folder there and removes it.

use camino::Utf8PathBuf;

pub(crate) fn base() -> Utf8PathBuf {
    let cache = Utf8PathBuf::from(std::env::var("HOME").expect("test home")).join(".cache");
    match std::env::var("TMPDIR").map(Utf8PathBuf::from) {
        Ok(tmp) if tmp.starts_with(&cache) && tmp != cache => tmp,
        _ => cache.join("nts/tests"),
    }
}
