//! TypeScript compiled to JVM, calling the fixed networking intrinsics.
//!
//! # Why this test exists when nine others already drive the same code
//!
//! The plan says host Java tests alone are insufficient, and it is right in a
//! way that is easy to miss: `transport.rs`, `environment.rs`, `gzip.rs` and
//! the rest all call `nts.rt` from a Java `main`. Every one of them would stay
//! green if the JVM backend could not emit a call to the runtime at all. What
//! sits between a working runtime and a program that can reach it is one table
//! -- `ops::web_external` -- and a name missing from it is a refusal that no
//! amount of Java testing can see. It was missing until this test existed, and
//! the four refusals it produced are quoted in the record.
//!
//! # The direction is the point
//!
//! Java opens the sockets and the compiled TypeScript counts them. State
//! created on one side of the intrinsic boundary is observed on the other, so a
//! wrong entry -- a name mapped to some other method that also returns a
//! `double` -- changes a number rather than nothing. The fixture existed for a
//! minute in a form where every function returned zero, which would have passed
//! against a table with all four names mapped wrongly.
//!
//! # Four of nine
//!
//! `runtime/jvm/web-platform/intrinsics.d.ts` declares nine. Five take an
//! environment handle or a byte view; there is no common environment type and
//! `ManagedType::View` does not exist, so those five cannot be written in
//! TypeScript yet. They are named as gated there and absent here, rather than
//! left to look like the four that work are all there ever were.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn tool(name: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return Some(path);
        }
    }
    let found = Command::new("sh").arg("-c").arg(format!("command -v {name}")).output().ok()?;
    found
        .status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&found.stdout).trim().to_owned()))
}

/// What the driver must print. Three connections rather than one, because one
/// would not tell a count from a boolean and two would not tell a count from a
/// toggle; and `changed` twice, because the second sweep has nothing to close
/// and must say so rather than repeat the first answer.
const EXPECTED: &str = "\
random set
outside 0
inside set
detached read TypeError
open 3
after close 2
after cancel 2
changed 2
open 0
changed 0
round-trip open 1 live 1
round-trip wrote 5
round-trip read 5
round-trip checksum 492
";

#[test]
fn typescript_reaches_the_provider_through_the_intrinsic_table() {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        // Announced, because a skip that prints nothing is indistinguishable
        // from a pass.
        eprintln!("SKIP intrinsics: NTS_TSGO is not set");
        return;
    };
    if !tsgo.exists() {
        eprintln!("SKIP intrinsics: no tsgo at {tsgo}");
        return;
    }
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else {
        eprintln!("SKIP intrinsics: no JDK");
        return;
    };

    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/intrinsics");
    let tsconfig = Utf8PathBuf::from_path_buf(
        fixture.join("tsconfig.json").canonicalize().expect("fixture is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).expect("snapshot");
    assert!(!snapshot.has_errors(), "the intrinsics fixture should typecheck");

    // `NoGc`, which is what this lane ships: a tracing collector owns these
    // objects, so `Retain` and `Release` are refused by name rather than
    // emitted as nothing.
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options { provider: hir::Provider::NoGc, ..hir::Options::default() },
    )
    .expect("prepared HIR should verify");

    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(
        emitted.diagnostics.is_empty(),
        "the backend declined {}: {}",
        emitted.diagnostics.len(),
        emitted
            .diagnostics
            .iter()
            .map(|it| it.message.clone())
            .collect::<Vec<_>>()
            .join("; ")
    );

    let dir = std::env::temp_dir().join(format!("nts-intrinsics-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a temp dir");

    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().expect("a class has a package")).expect("mkdir");
        std::fs::write(&path, &class.bytes).expect("write a class");
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).expect("write the jar");

    let compiled = Command::new(&javac)
        .args(["--release", "8", "-Xlint:all,-options", "-Werror", "-cp"])
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(fixture.join("Drive.java"))
        .output()
        .expect("javac runs");
    assert!(
        compiled.status.success(),
        "the driver should compile: {}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    // `-Xverify:all` because the verifier is a free second opinion on the
    // StackMapTable, and because a class this backend wrote is the one in the
    // classpath that has not been through `javac`.
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", dir.display(), jar.display()))
        .arg("Drive")
        .current_dir(repository())
        .output()
        .expect("java runs");
    let out = String::from_utf8_lossy(&ran.stdout);
    assert!(
        ran.status.success(),
        "the driver should exit cleanly: {}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert_eq!(out, EXPECTED, "stderr: {}", String::from_utf8_lossy(&ran.stderr));

    let _ = std::fs::remove_dir_all(&dir);
}

/// Split a parameter list on the commas that separate parameters.
///
/// Not `split(',')`: a callback parameter is `(code: string, message: string)
/// => void`, whose own comma is not a separator. That version parsed every
/// scalar declaration correctly and could not see a single one that took a
/// closure -- which was fine while none did.
fn parameters(list: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut depth = 0i32;
    let mut one = String::new();
    // Not `<` and `>`. The arrow in `=> void` is a `>`, so counting it as a
    // closer put the depth at -1 and the separator after a callback parameter
    // then never matched -- which read as "this declaration has one parameter"
    // rather than as an error. No declaration here is generic; if one ever is,
    // this needs to tell an arrow from a bracket rather than gaining a case.
    for c in list.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                found.push(std::mem::take(&mut one));
                continue;
            }
            _ => {}
        }
        one.push(c);
    }
    if !one.trim().is_empty() {
        found.push(one);
    }
    found
}

/// How a declared type is spelled in a descriptor.
///
/// `None` for a type this cannot spell, which then fails loudly rather than
/// defaulting. A **function** type is spelled by building its own descriptor
/// and asking `types::callback_interface` for the `nts.rt` interface with that
/// shape -- so this checks the callback ABI as well as this one, and a closure
/// shape nothing implements is a failure here rather than a `NoSuchMethodError`
/// at run time.
fn descriptor_of(ts: &str) -> Option<String> {
    let ts = ts.trim();
    // `string | null` is a string; the absence is `null` either way, and Java
    // has no other spelling for it.
    let ts = ts.strip_suffix("| null").map_or(ts, str::trim_end);
    if let Some((arguments, returns)) = ts.split_once("=>") {
        let arguments = arguments.trim().strip_prefix('(')?.strip_suffix(')')?;
        let mut shape = String::from("(");
        for one in parameters(arguments) {
            shape.push_str(&descriptor_of(one.split_once(':')?.1)?);
        }
        shape.push(')');
        shape.push_str(&descriptor_of(returns)?);
        let interface = nts_codegen_jvm::types::callback_interface(&shape)?;
        return Some(format!("L{interface};"));
    }
    Some(
        match ts {
            "number" => "D",
            "void" => "V",
            "boolean" => "Z",
            "string" => "Ljava/lang/String;",
            "JvmBytes" | "Uint8Array" => "Lnts/rt/NtsViewU8;",
            _ => return None,
        }
        .to_owned(),
    )
}

/// Every `declare function nts_jvm_web_*` in the declarations, as
/// `(name, descriptor_or_none, wired)`.
fn declarations() -> Vec<(String, Option<String>, bool)> {
    let text = std::fs::read_to_string(
        repository().join("runtime/jvm/web-platform/intrinsics.d.ts"),
    )
    .expect("the declarations are checked in");

    let mut found = Vec::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("declare function nts_jvm_web_") {
        // The doc comment immediately before this declaration: between the last
        // `/**` and its `*/`, and only when nothing but whitespace separates
        // that `*/` from the `declare`. The version without that last condition
        // let a declaration with no doc of its own inherit the previous one's
        // marker, which would have made every entry after a WIRED one look
        // wired too.
        let before = &rest[..at];
        let wired = before.rfind("*/").is_some_and(|close| {
            before[close + 2..].trim().is_empty()
                && before[..close]
                    .rfind("/**")
                    .is_some_and(|open| before[open..close].contains("WIRED"))
        });

        rest = &rest[at + "declare function ".len()..];
        let end = rest.find(';').expect("a declaration ends");
        let signature = &rest[..end];
        rest = &rest[end..];

        let open = signature.find('(').expect("a declaration has parameters");
        let name = signature[..open].trim().to_owned();
        let close = signature.rfind(')').expect("a declaration closes them");

        let mut descriptor = String::from("(");
        let mut spellable = true;
        for one in parameters(&signature[open + 1..close]) {
            match one.split_once(':').and_then(|it| descriptor_of(it.1)) {
                Some(it) => descriptor.push_str(&it),
                None => spellable = false,
            }
        }
        descriptor.push(')');
        match descriptor_of(signature[close + 1..].trim_start_matches(':')) {
            Some(it) => descriptor.push_str(&it),
            None => spellable = false,
        }
        found.push((name, spellable.then_some(descriptor), wired));
    }
    found
}

/// The declarations, the compiler's table, and the shipped Java are three
/// statements of one ABI. This is the assertion that keeps them one fact.
///
/// Record 0077's rule: where two things must agree and only one can be deleted,
/// make the second assert rather than compute. There were four copies of these
/// signatures an hour ago -- the declarations, the compiler's table, the Java,
/// and a set the test fixture restated for itself. The fixture's copy is gone
/// (it now includes the real declarations, which had been in no tsconfig at
/// all), and the remaining three are checked here.
#[test]
fn the_declarations_the_table_and_the_jar_agree() {
    let declared = declarations();
    assert!(
        declared.len() >= nts_codegen_jvm::ops::WEB_INTRINSICS.len(),
        "there are more entries in the table than declarations to justify them"
    );

    for entry in nts_codegen_jvm::ops::WEB_INTRINSICS {
        let found = declared
            .iter()
            .find(|it| it.0 == entry.declared)
            .unwrap_or_else(|| panic!("`{}` is in the table and not declared", entry.declared));
        assert_eq!(
            found.1.as_deref(),
            Some(entry.descriptor),
            "`{}`: the declaration and the table disagree",
            entry.declared
        );
        assert!(found.2, "`{}` is wired and its declaration does not say WIRED", entry.declared);
    }

    // The complement, so marking something WIRED is a claim rather than a
    // comment: a declaration that says it while no table entry exists fails
    // here, and so does a gated one that quietly grew an implementation.
    for (name, _, wired) in &declared {
        let in_table =
            nts_codegen_jvm::ops::WEB_INTRINSICS.iter().any(|it| it.declared == *name);
        assert_eq!(
            *wired, in_table,
            "`{name}`: the declaration says {}, the table says {}",
            if *wired { "WIRED" } else { "GATED" },
            if in_table { "wired" } else { "absent" }
        );
    }

    let Some(javap) = tool("javap") else {
        eprintln!("SKIP the jar half: no JDK");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-intrinsic-drift-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a temp dir");
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).expect("write the jar");

    // Every class the table names, read from the table rather than written
    // down again -- the version that hardcoded one owner passed until the day
    // an entry moved, and then failed on the owner rather than on anything
    // about the ABI.
    let mut owners: Vec<&str> =
        nts_codegen_jvm::ops::WEB_INTRINSICS.iter().map(|it| it.owner).collect();
    owners.sort_unstable();
    owners.dedup();

    // `-s` prints descriptors, so this compares the emitted descriptor against
    // the shipped method's rather than against its Java signature reformatted.
    let listed = Command::new(&javap)
        .args(["-p", "-s", "-cp"])
        .arg(&jar)
        .args(owners.iter().map(|it| it.replace('/', ".")))
        .output()
        .expect("javap runs");
    assert!(listed.status.success(), "{}", String::from_utf8_lossy(&listed.stderr));
    let text = String::from_utf8_lossy(&listed.stdout);
    let _ = std::fs::remove_dir_all(&dir);

    for entry in nts_codegen_jvm::ops::WEB_INTRINSICS {
        let at = text
            .find(&format!(" {}(", entry.member))
            .unwrap_or_else(|| panic!("`{}` is not in the shipped jar", entry.member));
        let following = &text[at..];
        let descriptor = following
            .lines()
            .nth(1)
            .and_then(|it| it.trim().strip_prefix("descriptor: "))
            .unwrap_or_else(|| panic!("javap printed no descriptor for `{}`", entry.member));
        assert_eq!(
            descriptor, entry.descriptor,
            "`{}`: the table and the shipped Java disagree",
            entry.declared
        );
    }
}
