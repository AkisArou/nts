// nts-bench's source identity: the run record names this commit, and a
// launch row requires the `nts` beside it to name the same one.
include!("../cli/source_identity.rs");

fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    emit_source_identity(
        &root,
        "NTS_BENCH",
        &["compiler", "runtime", "build", "tooling/bench"],
    );
}
