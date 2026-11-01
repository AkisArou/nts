//! `VIEW_SIZE` and `VIEW_BUFFER_OFFSET` are the runtime header's
//! `sizeof(NtsView)` and `offsetof(NtsView, buffer)`. The LLVM backend writes a
//! view class's descriptor with them, where the C backend writes `sizeof` and
//! `offsetof` and lets clang answer; this asks clang the same question.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn the_view_constants_are_the_headers() {
    let runtime = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/c");
    let scratch = std::env::temp_dir().join(format!("nts-view-constants-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).unwrap();
    let source = scratch.join("view.c");
    std::fs::write(
        &source,
        format!(
            "#include <stddef.h>\n#include \"nts_runtime.h\"\n\
             _Static_assert(sizeof(NtsView) == {}, \"VIEW_SIZE\");\n\
             _Static_assert(offsetof(NtsView, buffer) == {}, \"VIEW_BUFFER_OFFSET\");\n",
            nts_codegen_llvm::VIEW_SIZE,
            nts_codegen_llvm::VIEW_BUFFER_OFFSET
        ),
    )
    .unwrap();
    let checked = Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-I"])
        .arg(&runtime)
        .arg(&source)
        .output()
        .expect("clang runs");
    let _ = std::fs::remove_dir_all(&scratch);
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
}
