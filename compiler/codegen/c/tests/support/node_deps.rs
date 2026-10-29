use nts_build::node_deps::{Artifacts, Request};
use std::{path::PathBuf, sync::OnceLock};

pub(super) fn get() -> &'static Artifacts {
    static BUILT: OnceLock<Artifacts> = OnceLock::new();
    BUILT.get_or_init(|| {
        let cache = std::env::var_os("XDG_CACHE_HOME")
            .map_or_else(
                || {
                    PathBuf::from(std::env::var_os("HOME").expect("native dependency cache HOME"))
                        .join(".cache")
                },
                PathBuf::from,
            )
            .join("nts/node-deps");
        nts_build::node_deps::ensure(&Request {
            target: nts_build::node_deps::recipe().target.clone(),
            compiler: vec!["clang".into()],
            archiver: vec!["llvm-ar".into()],
            flags: vec![],
            libraries: vec!["uv".into()],
            cache,
            jobs: 2,
        })
        .expect("verified bundled libuv")
    })
}
