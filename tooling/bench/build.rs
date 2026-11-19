// nts-bench's source identity: a run requires it to be the measured commit's
// sources, and a launch row requires the same of the `nts` beside it.
include!("../cli/source_identity.rs");

fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    emit_source_identity(&root, "NTS_BENCH", "nts-bench");
}
