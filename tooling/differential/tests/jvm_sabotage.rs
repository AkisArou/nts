//! Whether the JVM lane's differential can still fail.
//!
//! # What this asserts that the floor does not
//!
//! `tooling/gate/all.sh` counts examples that agree with node and refuses to
//! let the count fall. That is a good ratchet and it is silent about the
//! question underneath it: *would it notice?* A harness that compared nothing,
//! or compared it wrongly, would report the same number and go on reporting it.
//!
//! `examples/unsupported` is why this is not hypothetical. Its gate assertion --
//! that the fixture fails to compile -- passed for years because **node could
//! not parse the file**, so the compiler was never asked. Removing the
//! accidental cause turned it red. A green check that has never exercised its
//! subject is worse than a missing one: a missing check leaves a hole somebody
//! might notice, and a false one closes it.
//!
//! # Why standing, rather than by hand
//!
//! Breaking a check on purpose at the moment of writing proves it *could* fail
//! then. It says nothing about now. The `unsupported` assertion was almost
//! certainly verified when written, by someone who was right at the time, and
//! the code around it moved. A check written years ago and never re-mutated is
//! in the same position as one never mutated at all, and from outside they are
//! the same colour.
//!
//! So what a standing sabotage buys is not "the suite works" but "the suite was
//! exercised recently" -- a date on the claim rather than the claim.
//!
//! # How
//!
//! Patch one method of the Java runtime, rebuild the jar to a temporary path,
//! point `NTS_JVM_RUNTIME_JAR` at it, and require the named example to *stop*
//! agreeing with node. In this order, because each step is a different failure:
//!
//! 1. the example agrees with the real runtime, so the sabotage is what moved it;
//! 2. the pattern occurs **exactly once inside the named method** -- presence is
//!    not uniqueness, and uniqueness across the file is not location;
//! 3. the patched runtime still builds, so a sabotage that merely breaks the
//!    build is not counted as caught;
//! 4. the example then disagrees, is refused, or errors. Any of the three is the
//!    harness noticing; counting only reported disagreements misses the other two.
//!
//! Skips without a JDK or without `tsgo`, and the gate step that runs it
//! requires both.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// One way to break the runtime, and the example that should notice.
struct Sabotage {
    /// The Java file, relative to `runtime/jvm/src`.
    file: &'static str,
    /// The method to break, so a pattern that moves cannot land elsewhere.
    method: &'static str,
    pattern: &'static str,
    replacement: &'static str,
    /// The example whose agreement with node depends on this being right.
    example: &'static str,
    /// What stops being checked if this goes unnoticed.
    guards: &'static str,
}

const SABOTAGES: &[Sabotage] = &[
    Sabotage {
        file: "nts/rt/NtsRuntime.java",
        method: "toInt32",
        // Re-anchored when `toInt32` became bit-based: the old body rounded a
        // double and wrapped modulo 2^32, and the line this used to patch no
        // longer exists. The test refused to run rather than patch nothing and
        // report that every sabotage was noticed, which is the whole point of
        // requiring the pattern to be unique inside its method.
        pattern: "return bits < 0 ? -low : low;",
        replacement: "return bits < 0 ? -low : low + 1;",
        example: "bitwise",
        guards: "`|0` and every other `ToInt32`, which Java's `d2i` saturates \
                 where JavaScript wraps",
    },
    Sabotage {
        file: "nts/rt/NtsValue.java",
        method: "ofNumber",
        pattern: "return new NtsValue(NUMBER, value, null);",
        replacement: "return new NtsValue(NUMBER, value + 1.0, null);",
        // `unions` rather than `unknown`, on evidence. Adding one to every
        // erased number leaves `unknown`, `unknown-returns`,
        // `unknown-references` and `typeof` all reporting agreement -- they
        // erase numbers and then only ever ask what *kind* of thing came back,
        // never what it was. Four fixtures named for erasure, none of them
        // checking that an erased number keeps its value.
        example: "unions",
        guards: "every erasure of a number keeping its value, which four \
                 examples named for erasure do not check",
    },
];

fn tool(name: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return Some(path);
        }
    }
    let found = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {name}"))
        .output()
        .ok()?;
    if !found.status.success() {
        return None;
    }
    let text = String::from_utf8(found.stdout).ok()?;
    Some(PathBuf::from(text.trim()))
}

/// The body of one method, so a pattern cannot match elsewhere in the file.
///
/// Brace counting from the signature. Crude, and sufficient: these are small
/// static methods with no nested class in them, and the alternative is a Java
/// parser to run a test.
fn method_body<'a>(source: &'a str, method: &str) -> Option<(usize, &'a str)> {
    let at = source.find(&format!(" {method}("))?;
    let open = source[at..].find('{')? + at;
    let mut depth = 0usize;
    for (offset, ch) in source[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((open, &source[open..=open + offset]));
                }
            }
            _ => {}
        }
    }
    None
}

/// The compiler under test. `NTS_BIN` names it, as everywhere else in the gate:
/// three sessions build into different target directories, and a hard-coded
/// path can measure somebody else's binary.
fn binary() -> Option<PathBuf> {
    let named = std::env::var("NTS_BIN").ok().map(PathBuf::from);
    let path = named.unwrap_or_else(|| repository().join("target/release/nts"));
    path.exists().then_some(path)
}

/// Whether the example agrees with node, with this runtime.
///
/// Anything other than a clean agreement counts as the harness noticing --
/// a reported disagreement, a refusal, a crash, or a non-zero exit. Looking
/// only for reported disagreements would miss the other three, which is how
/// the strongest sabotage in the C suite once looked clean.
fn run(binary: &Path, tsconfig: &Path, runtime: Option<&Path>) -> bool {
    let mut command = std::process::Command::new(binary);
    command.arg("check").arg(tsconfig).env("NTS_BACKEND", "jvm");
    match runtime {
        Some(jar) => command.env("NTS_JVM_RUNTIME_JAR", jar),
        None => command.env_remove("NTS_JVM_RUNTIME_JAR"),
    };
    let Ok(output) = command.output() else { return false };
    let text = String::from_utf8_lossy(&output.stdout);
    output.status.success() && text.contains("agreed on every case")
}

#[test]
fn every_sabotage_of_the_jvm_runtime_is_noticed() {
    let root = repository();
    if tool("javac").is_none() || tool("java").is_none() {
        return;
    }
    let tsgo = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    if !Path::new(&tsgo).exists() && tool("tsgo").is_none() {
        return;
    }

    let scratch = std::env::temp_dir().join(format!("nts-jvm-sabotage-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).unwrap();

    for sabotage in SABOTAGES {
        let source_path = root.join("runtime/jvm/src").join(sabotage.file);
        let original = std::fs::read_to_string(&source_path)
            .unwrap_or_else(|_| panic!("{} exists", sabotage.file));

        let (open, body) = method_body(&original, sabotage.method).unwrap_or_else(|| {
            panic!("`{}` has no method `{}`", sabotage.file, sabotage.method)
        });
        let hits = body.matches(sabotage.pattern).count();
        assert_eq!(
            hits, 1,
            "`{}` occurs {hits} times in `{}` -- a sabotage that is not unique \
             inside its method patches whichever copy comes first, and the one \
             it was written for keeps working",
            sabotage.pattern, sabotage.method,
        );

        let patched_body = body.replacen(sabotage.pattern, sabotage.replacement, 1);
        let mut patched = String::with_capacity(original.len() + 32);
        patched.push_str(&original[..open]);
        patched.push_str(&patched_body);
        patched.push_str(&original[open + body.len()..]);

        let jar = scratch.join(format!("{}-broken.jar", sabotage.method));
        std::fs::write(&source_path, &patched).unwrap();
        let built = std::process::Command::new("sh")
            .arg(root.join("runtime/jvm/build.sh"))
            .arg(&jar)
            .output();
        // Put the real source back before asserting anything, so a failure here
        // does not leave the tree broken for whoever runs next.
        std::fs::write(&source_path, &original).unwrap();
        let built = built.unwrap();
        assert!(
            built.status.success(),
            "the sabotaged runtime must still compile, or the suite is only \
             catching a build break: {}",
            String::from_utf8_lossy(&built.stderr)
        );

        // Run the harness as a subprocess rather than calling `check` here.
        // Not only because this crate forbids `unsafe` and `set_var` is unsafe
        // since the 2024 edition: a differential that shares a process with the
        // thing testing it also shares any state either of them leaks, and the
        // whole point is to observe the harness from outside.
        let Some(binary) = binary() else { return };
        let tsconfig = root.join("examples").join(sabotage.example).join("tsconfig.json");

        let honest = run(&binary, &tsconfig, None);
        let broken = run(&binary, &tsconfig, Some(&jar));

        assert!(
            honest,
            "`examples/{}` has to agree with node *before* the sabotage, or it \
             proves nothing about {}",
            sabotage.example, sabotage.method,
        );
        // Two causes look identical here and the message has to name both,
        // because telling them apart took reading `javap` the one time it
        // fired. Either the harness is blind, or the anchor is wrong -- the
        // method is compiled into the example and still not on a path whose
        // result anybody compares.
        //
        // That happened: `ofNumber` appears six times in `examples/unknown` and
        // the fixture still agreed under sabotage, because the middle end had
        // elided every erasure whose payload is read and the boxes that
        // survived were only ever asked for their tag. So no check on the
        // *artifact* can settle it -- "is this method on a path that affects an
        // answer" is not a fact about the class file, it is the statement "the
        // output changed", which is this assertion.
        assert!(
            !broken,
            "breaking `{}` changed nothing that `examples/{}` reports. Either \
             the harness is not checking {} -- or the anchor is wrong and that \
             method, though compiled in, is not on a path whose result the \
             differential compares. Read the emitted class before assuming the \
             first.",
            sabotage.method, sabotage.example, sabotage.guards,
        );
    }
    let _ = std::fs::remove_dir_all(&scratch);
}
