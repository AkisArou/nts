//! The tracked runtime is immutable during ordinary tests. Regeneration runs
//! only its exact test; normal drift checks build a separate temporary jar.

use std::path::{Path, PathBuf};

pub(crate) fn runtime_jar(repository: &Path) -> PathBuf {
    std::env::var_os("NTS_JVM_RUNTIME_JAR").map_or_else(
        || repository.join("runtime/jvm/nts-runtime.jar"),
        PathBuf::from,
    )
}
