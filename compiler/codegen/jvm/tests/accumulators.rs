//! Which string values the JVM holds as a `StringBuilder` (`builder.rs`).
//!
//! Each function in the fixture is one shape, and what is asserted is the
//! representation `javap` shows: a held accumulator constructs a
//! `java/lang/StringBuilder` and calls no `String.concat`, and a refused one is
//! the reverse. Each of the module note's refusals has an arm here -- a
//! straight line read by more than its return (`straight`), one consumer
//! (`twice`, `after`, `inLoop`, `measuredAfter`), one materialisation a
//! lifetime (`perIteration`), no prepend (`prepended`) -- beside the held
//! shapes they must not cost: `linear`, `perRound` (measured by the builder,
//! `json-build-append`'s shape), `argument` (materialised once) and `returned`
//! (a straight line read only by its return). What the shapes answer is the
//! business of `tests/programs/a-string-accumulator-appended-twice` and
//! `tests/programs/a-string-accumulator-read-once-a-lifetime`, on every
//! backend.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::Frontend;

mod common;

/// Each function's body in a `javap -c -p` listing, keyed by its name.
fn bodies(listing: &str) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = Vec::new();
    for line in listing.lines() {
        let trimmed = line.trim();
        if line.starts_with("  ") && !line.starts_with("   ") && trimmed.ends_with(");") {
            let name = trimmed
                .split('(')
                .next()
                .and_then(|head| head.rsplit(' ').next())
                .unwrap_or_default();
            found.push((name.to_owned(), String::new()));
        } else if let Some((_, body)) = found.last_mut() {
            body.push_str(trimmed);
            body.push('\n');
        }
    }
    found
}

#[test]
fn an_accumulator_is_held_only_where_the_three_rules_allow() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/accumulators/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let program = common::prepare(&snapshot).expect("valid HIR").program;
    assert!(
        program.refused_bodies().next().is_none(),
        "{:?}",
        program.uncompiled
    );
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted.diagnostics.is_empty(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect::<Vec<_>>()
    );

    let Some(disassembler) = common::tool("javap") else {
        eprintln!("SKIP accumulators: no JDK, so javap has not been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-accumulators-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let listed = nts_codegen_jvm::toolchain::command(&disassembler)
        .args(["-c", "-p", "-cp"])
        .arg(&dir)
        .arg("nts.gen.Program")
        .output()
        .unwrap();
    assert!(
        listed.status.success(),
        "{}",
        String::from_utf8_lossy(&listed.stderr)
    );
    let bodies = bodies(&String::from_utf8_lossy(&listed.stdout));
    assert_representations(&bodies);
    compare_unit_reads_with_node(&dir);
    std::fs::remove_dir_all(&dir).unwrap();
}

fn assert_representations(bodies: &[(String, String)]) {
    let body = |name: &str| {
        bodies.iter().find(|(found, _)| found == name).map_or_else(
            || panic!("no `{name}` in the program class"),
            |(_, body)| body.as_str(),
        )
    };

    for kept in [
        "linear",
        "perRound",
        "argument",
        "returned",
        "unitsUnchecked",
        "unitsChecked",
        "unitsDuringAppend",
    ] {
        let held = body(kept);
        assert!(held.contains("java/lang/StringBuilder"), "{kept}:\n{held}");
        assert!(!held.contains("java/lang/String.concat"), "{kept}:\n{held}");
    }
    // The two reads a held accumulator allows, each in its own spelling.
    let measured = body("perRound");
    assert!(
        measured.contains("java/lang/StringBuilder.length:()I"),
        "perRound:\n{measured}"
    );
    let materialised = body("argument");
    assert!(
        materialised.contains("java/lang/StringBuilder.toString:()Ljava/lang/String;"),
        "argument:\n{materialised}"
    );
    let unchecked = body("unitsUnchecked");
    assert!(
        unchecked.contains("java/lang/StringBuilder.charAt:(I)C"),
        "{unchecked}"
    );
    let checked = body("unitsChecked");
    assert!(
        checked.contains("charCodeAt:(Ljava/lang/CharSequence;D)D"),
        "{checked}"
    );
    for name in ["unitsUnchecked", "unitsChecked", "unitsDuringAppend"] {
        assert!(
            !body(name).contains("java/lang/StringBuilder.toString"),
            "{name}:\n{}",
            body(name)
        );
    }
    for refused in [
        "straight",
        "twice",
        "after",
        "inLoop",
        "measuredAfter",
        "perIteration",
        "prepended",
        "unitAfterAppend",
    ] {
        let listing = body(refused);
        assert!(
            !listing.contains("java/lang/StringBuilder"),
            "{refused} holds a builder another consumer would see:\n{listing}"
        );
        assert!(
            listing.contains("java/lang/String.concat"),
            "{refused}:\n{listing}"
        );
    }
}

fn compare_unit_reads_with_node(dir: &std::path::Path) {
    let javac = common::tool("javac").expect("the JDK used for javap has javac");
    let java = common::tool("java").expect("the JDK used for javap has java");
    let fixture = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/accumulators");
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let classpath = format!("{}:{}", dir.display(), jar.display());
    let compiled = nts_codegen_jvm::toolchain::command(javac)
        .args(["-cp", &classpath, "-d"])
        .arg(dir)
        .arg(fixture.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = nts_codegen_jvm::toolchain::command(java)
        .args(["-Xverify:all", "-cp", &classpath, "Drive"])
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(
        ran.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    let node = std::process::Command::new("node")
        .arg(fixture.join("drive.mjs"))
        .arg(fixture.join("src/main.ts"))
        .output()
        .unwrap();
    assert!(
        node.status.success(),
        "{}",
        String::from_utf8_lossy(&node.stderr)
    );
    assert_eq!(
        ran.stdout, node.stdout,
        "UTF-16 reads, checked indices and old-string aliases"
    );
}
