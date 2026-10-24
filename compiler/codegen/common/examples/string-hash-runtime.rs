//! Regenerate the private C hash primitives from their shared definition.
use nts_codegen_common::string_hash::{BEGIN, END, runtime_source};
use std::{fs, path::Path};

fn main() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/c/nts_runtime.c");
    let mut source = fs::read_to_string(&path).expect("read C runtime");
    let begin = source.find(BEGIN).expect("generated hash block begins");
    let end = source.find(END).expect("generated hash block ends") + END.len() + 1;
    source.replace_range(begin..end, &runtime_source());
    fs::write(&path, source).expect("write C runtime");
}
