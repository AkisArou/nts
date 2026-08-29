//! Whether the runtime's own suites can still fail.
//!
//! # Why this exists as a test rather than as a habit
//!
//! A suite that passes tells you nothing until something has tried to make it
//! fail. Both sessions on this project have been running sabotages by hand --
//! break one line, rebuild, check the suite goes red -- and reporting the
//! result in a message. That evidence is unreproducible by anyone, including
//! whoever produced it, a week later.
//!
//! Worse, it decays. A sabotage anchored on a line of C stops meaning what it
//! meant the moment that line appears somewhere else in the file. That is not
//! hypothetical: `nts_promise_fulfill_value` retains with
//! `nts_retain(value.as.reference);`, a later `nts_value_retain` was added
//! containing the identical line *above* it, and a by-hand sabotage patching
//! the first occurrence silently began breaking the wrong function. The suite
//! passed. Nothing was wrong with the suite, and nothing said so.
//!
//! # What it asserts, and in which order
//!
//! For each sabotage, in this order, because each step is a different failure:
//!
//! 1. the named function exists;
//! 2. the pattern occurs **exactly once inside that function** -- presence is
//!    not uniqueness, and uniqueness across the file is not location;
//! 3. the patched runtime still compiles, so a sabotage that merely breaks the
//!    build is not counted as caught;
//! 4. the suite then **fails**, by any means: a reported check, an abort, or a
//!    hang. Counting `FAIL` lines misses two of those three, which is how the
//!    strongest sabotage here once looked clean.

use std::path::{Path, PathBuf};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// One way to break the runtime, and where.
struct Sabotage {
    /// The suite that should notice.
    suite: &'static str,
    /// The function to break, so a pattern that moves cannot land elsewhere.
    function: &'static str,
    pattern: &'static str,
    replacement: &'static str,
    /// What the suite would stop checking if this went unnoticed.
    guards: &'static str,
}

const SABOTAGES: &[Sabotage] = &[
    // The four below were written against a promise that decomposed an erased
    // value into a tag beside two typed slots. The payload is one `NtsValue`
    // now, stored whole and listed in the descriptor's erased table, so each
    // pattern moved -- but every one guards the property it guarded before,
    // which is the only thing that had to survive the change.
    Sabotage {
        suite: "erased",
        function: "nts_promise_fulfill",
        pattern: "promise->value = value;",
        replacement: "promise->value = value; promise->value.tag = NTS_TAG_UNDEFINED;",
        guards: "that the tag survives, which is the whole point of the payload",
    },
    Sabotage {
        suite: "erased",
        function: "nts_promise_fulfill",
        pattern: "nts_retain(value.as.reference);",
        replacement: "(void)0;",
        guards: "that a settled reference is retained rather than aliased",
    },
    Sabotage {
        suite: "erased",
        function: "nts_promise_value",
        pattern: "return promise->value;",
        replacement: "{ NtsValue v = promise->value; v.tag = NTS_TAG_NUMBER; return v; }",
        guards: "that the reader reports the tag it was given",
    },
    Sabotage {
        suite: "erased",
        function: "nts_promise_fulfill_reference",
        // The derivation moved when the compiler stopped needing it: a caller
        // that knows the tag now calls `nts_promise_fulfill_tagged` directly,
        // and this helper is the one-line wrapper for callers that do not. The
        // property is the same and so is the sabotage.
        pattern: "nts_tag_of_reference(object)",
        replacement: "NTS_TAG_OBJECT",
        guards: "that a string settled through the typed helper still says it is a string",
    },
    Sabotage {
        suite: "erased",
        function: "nts_promise_forward",
        pattern: "nts_promise_fulfill_value(to, from->value);",
        replacement: "nts_promise_fulfill_void(to);",
        guards: "that `race` forwards an erased payload instead of `undefined`",
    },
];

/// The body of `name`, from its opening line to the first line that is a lone
/// closing brace.
///
/// Crude, and adequate because the runtime is formatted: what matters is that
/// it is *bounded by the function*, so a pattern cannot be matched in a
/// neighbour that happens to contain the same line.
fn function_body(source: &str, name: &str) -> (usize, usize) {
    let signature = format!("\n{name}(");
    let at = source
        .find(&signature)
        .or_else(|| source.find(&format!(" {name}(")))
        .unwrap_or_else(|| panic!("`{name}` is not in the runtime any more"));
    let start = source[..at].rfind('\n').map_or(0, |n| n + 1);
    let end = source[start..]
        .find("\n}\n")
        .unwrap_or_else(|| panic!("`{name}` has no closing brace"))
        + start;
    (start, end)
}

/// Build `suite` against a runtime with one line changed, and report whether
/// the suite noticed.
fn survives(sabotage: &Sabotage) -> bool {
    let root = repository();
    let runtime = root.join("runtime/c");
    let source = std::fs::read_to_string(runtime.join("nts_runtime.c")).expect("the runtime");

    let (start, end) = function_body(&source, sabotage.function);
    let body = &source[start..end];
    let hits = body.matches(sabotage.pattern).count();
    assert_eq!(
        hits, 1,
        "`{}` occurs {hits} times inside `{}`; a sabotage that is not unique \
         inside its own function patches something else and reports a clean run",
        sabotage.pattern, sabotage.function
    );

    let patched = format!(
        "{}{}{}",
        &source[..start],
        body.replace(sabotage.pattern, sabotage.replacement),
        &source[end..]
    );

    let out = std::env::temp_dir().join(format!(
        "nts-sabotage-{}-{}-{}",
        sabotage.suite,
        sabotage.function,
        std::process::id()
    ));
    std::fs::create_dir_all(&out).expect("a build directory");
    let runtime_c = out.join("nts_runtime.c");
    std::fs::write(&runtime_c, patched).expect("the patched runtime");
    let binary = out.join("suite");

    let compile = std::process::Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-O1", "-DNTS_PROVIDER_RC"])
        .arg("-I")
        .arg(&runtime)
        .arg("-o")
        .arg(&binary)
        .arg(runtime.join(format!("tests/{}.c", sabotage.suite)))
        .arg(runtime.join("nts_test_host.c"))
        .arg(&runtime_c)
        .arg("-lm")
        .output()
        .expect("clang should run");
    // Not `-Werror`: a sabotage may leave a variable unused, and a suite that
    // "caught" it by failing to build would be catching the wrong thing.
    assert!(
        compile.status.success(),
        "the sabotaged runtime did not compile, so nothing was measured:\n{}",
        String::from_utf8_lossy(&compile.stderr)
    );

    // Bounded, because a sabotage can make the suite *hang* rather than fail:
    // freeing a payload something still points at sends the allocator round a
    // loop. A timeout is a caught sabotage, not an inconclusive one.
    let run = std::process::Command::new("timeout")
        .arg("60")
        .arg(&binary)
        .output()
        .expect("the suite should run");

    let _ = std::fs::remove_dir_all(&out);
    // Success means the suite passed against a runtime that is wrong.
    run.status.success()
}

#[test]
fn every_sabotage_of_the_erased_payload_is_caught() {
    let mut survived = Vec::new();
    for sabotage in SABOTAGES {
        if survives(sabotage) {
            survived.push(format!(
                "  {}: breaking `{}` in `{}` changed nothing, so the suite is \
                 not checking {}",
                sabotage.suite, sabotage.pattern, sabotage.function, sabotage.guards
            ));
        }
    }
    assert!(
        survived.is_empty(),
        "{} sabotage(s) went unnoticed:\n{}",
        survived.len(),
        survived.join("\n")
    );
}
