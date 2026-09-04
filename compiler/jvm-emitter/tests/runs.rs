//! Hand-built classes, written to disk, loaded and run by a real JVM.
//!
//! # Why this test exists before any lowering does
//!
//! A verifier message is about bytes. If the first class this crate ever
//! produces comes out of a HIR lowering, then every rejection is two bugs at
//! once and neither can be isolated. So the format is proved here, against
//! classes written by hand, with no compiler in the picture.
//!
//! **`java -Xverify:all` is the point of the test.** It is a free second
//! opinion on the constant pool, the code array and -- especially -- the
//! `StackMapTable`, and it is available from the first commit. `-Xverify:none`
//! was removed in JDK 13, so there is no way to accidentally run these without
//! the check.
//!
//! Skips when no JDK is on `PATH`, and fails when one is present and a class
//! does not verify. That asymmetry is the same rule `codegen/llvm`'s signature
//! test states for clang: a missing toolchain is not a passing test.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::process::Command;

use nts_diagnostics::{Location, SourceId, Span};
use nts_jvm_emitter::class::access;
use nts_jvm_emitter::code::Code;
use nts_jvm_emitter::{ClassBuilder, Compare, Kind, Pool, VType, insn, text};
use nts_semantic_schema::Origin;

fn origin() -> Origin {
    Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    })
}

/// The JDK, or `None` -- in which case every test here reports success without
/// having proved anything, which is why the gate step that runs them will
/// require one.
fn java_home_bin(tool: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(tool);
        if path.exists() {
            return Some(path);
        }
    }
    let found = Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {tool}"))
        .output()
        .ok()?;
    if !found.status.success() {
        return None;
    }
    let path = String::from_utf8(found.stdout).ok()?;
    Some(PathBuf::from(path.trim()))
}

fn work_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nts-jvm-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// One class with a `main`, built, verified and run. Returns its stdout.
///
/// `locals` is the whole slot table including slot 0, which is `main`'s
/// `String[]`; `fill` writes the body after the prologue that assigns every
/// other slot.
fn run_main(
    name: &str,
    locals: Vec<VType>,
    fill: impl FnOnce(&mut Code, &mut Pool, &Origin),
) -> Option<String> {
    let java = java_home_bin("java")?;
    let origin = origin();
    let mut pool = Pool::new();
    let max_locals = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, max_locals);
    // Slot 0 is the argument array and arrives assigned.
    code.initialize_locals(&origin, 1);
    fill(&mut code, &mut pool, &origin);
    code.ret(&origin, None);
    let body = code.finish(&pool).expect("a body the emitter could finish");
    let listing = text::listing(&body);

    let mut class = ClassBuilder::new(name, "java/lang/Object");
    class.source_file = Some(format!("{name}.ts"));
    class.default_constructor(&origin, &mut pool).expect("<init>");
    class.method(
        access::PUBLIC | access::STATIC,
        "main",
        "([Ljava/lang/String;)V",
        Some(body),
    );
    let built = class.build(pool).expect("a class the emitter could build");

    let dir = work_dir(name);
    std::fs::write(dir.join(built.path()), &built.bytes).expect("write the class");
    let output = Command::new(java)
        .arg("-Xverify:all")
        // Two JVMs starting at once contend for the hsperfdata file and the
        // loser prints a warning -- on *stdout*, which is what this test
        // compares. The program was right and the capture was wrong. Killing
        // the contention at the source beats trimming the output, which would
        // make the test tolerant of anything else the JVM decides to say.
        .arg("-XX:-UsePerfData")
        .arg("-cp")
        .arg(&dir)
        .arg(name)
        .output()
        .expect("run java");
    assert!(
        output.status.success(),
        "`{name}` did not run:\n{}\n--- listing ---\n{listing}",
        String::from_utf8_lossy(&output.stderr)
    );
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// `System.out.println(value)`, for whichever overload the descriptor names.
fn println(code: &mut Code, pool: &mut Pool, origin: &Origin, descriptor: &str) {
    code.invoke_virtual(
        origin,
        pool,
        "java/io/PrintStream",
        "println",
        &format!("({descriptor})V"),
    );
}

fn out(code: &mut Code, pool: &mut Pool, origin: &Origin) {
    code.get_static(origin, pool, "java/lang/System", "out", "Ljava/io/PrintStream;");
}

const ARGS: &str = "[Ljava/lang/String;";

#[test]
fn prints_a_constant() {
    let Some(stdout) = run_main("Constant", vec![VType::Object(ARGS.into())], |code, pool, o| {
        out(code, pool, o);
        code.const_int(o, pool, 7);
        println(code, pool, o, "I");
    }) else {
        return;
    };
    assert_eq!(stdout, "7");
}

#[test]
fn arithmetic_on_doubles() {
    let Some(stdout) = run_main("Arith", vec![VType::Object(ARGS.into())], |code, pool, o| {
        out(code, pool, o);
        code.const_double(o, pool, 2.5);
        code.const_double(o, pool, 4.0);
        code.arithmetic(o, insn::MUL, Kind::Double);
        code.const_double(o, pool, 1.0);
        code.arithmetic(o, insn::SUB, Kind::Double);
        println(code, pool, o, "D");
    }) else {
        return;
    };
    assert_eq!(stdout, "9.0");
}

#[test]
fn a_counted_loop_verifies_and_sums() {
    // The first test with branches, so the first with a `StackMapTable`. Every
    // block boundary here is a frame, and a wrong offset delta is a verifier
    // rejection rather than a wrong answer -- which is the property that makes
    // this cheap to get right.
    let locals = vec![
        VType::Object(ARGS.into()),
        VType::Integer, // the counter
        VType::Integer, // the total
    ];
    let Some(stdout) = run_main("Loop", locals, |code, pool, o| {
        let head = code.label();
        let done = code.label();
        code.goto(o, head);
        code.bind(head);
        code.load(o, Kind::Int, 1);
        code.const_int(o, pool, 10);
        code.branch_int(o, Compare::Ge, done);
        code.load(o, Kind::Int, 2);
        code.load(o, Kind::Int, 1);
        code.arithmetic(o, insn::ADD, Kind::Int);
        code.store(o, Kind::Int, 2);
        code.load(o, Kind::Int, 1);
        code.const_int(o, pool, 1);
        code.arithmetic(o, insn::ADD, Kind::Int);
        code.store(o, Kind::Int, 1);
        code.goto(o, head);
        code.bind(done);
        out(code, pool, o);
        code.load(o, Kind::Int, 2);
        println(code, pool, o, "I");
    }) else {
        return;
    };
    assert_eq!(stdout, "45", "0 through 9");
}

#[test]
fn a_wide_local_is_one_frame_entry_and_two_slots() {
    // JVMS 4.7.4: a `Long` entry stands for the slot after it too. Counting
    // slots where the format counts entries shifts every later local by one,
    // and the verifier reports it far from the cause -- so this is the test
    // that pins the rule.
    let locals = vec![
        VType::Object(ARGS.into()),
        VType::Long,    // slots 1 and 2
        VType::Double,  // slots 3 and 4
        VType::Integer, // slot 5
    ];
    let Some(stdout) = run_main("Wide", locals, |code, pool, o| {
        code.const_long(o, pool, 4_000_000_000);
        code.store(o, Kind::Long, 1);
        code.const_double(o, pool, 0.5);
        code.store(o, Kind::Double, 3);
        code.const_int(o, pool, 3);
        code.store(o, Kind::Int, 5);
        // A branch, so a frame gets written and the entry/slot rule is checked.
        let done = code.label();
        code.load(o, Kind::Int, 5);
        code.branch_zero(o, Compare::Eq, done);
        code.bind(done);
        out(code, pool, o);
        code.load(o, Kind::Long, 1);
        code.convert(o, insn::L2D, Kind::Long, Kind::Double);
        code.load(o, Kind::Double, 3);
        code.arithmetic(o, insn::MUL, Kind::Double);
        println(code, pool, o, "D");
    }) else {
        return;
    };
    assert_eq!(stdout, "2.0E9");
}

#[test]
fn slots_past_255_take_the_wide_prefix() {
    // One slot per SSA value means a large function reaches three digits, and
    // the one-byte operand stops fitting at 256. Deciding that inside the
    // emitter rather than at the call site is why this is not a second code
    // path in the backend.
    let mut locals = vec![VType::Object(ARGS.into())];
    locals.extend(std::iter::repeat_n(VType::Integer, 300));
    let Some(stdout) = run_main("WideSlots", locals, |code, pool, o| {
        code.const_int(o, pool, 42);
        code.store(o, Kind::Int, 299);
        out(code, pool, o);
        code.load(o, Kind::Int, 299);
        println(code, pool, o, "I");
    }) else {
        return;
    };
    assert_eq!(stdout, "42");
}

#[test]
fn negative_zero_is_not_zero() {
    // `dconst_0` pushes `+0.0`, and `-0.0 == 0.0` is true in Rust as in
    // JavaScript -- so a value comparison in `const_double` would emit the
    // wrong constant and `1 / -0` would print `Infinity`.
    let Some(stdout) = run_main("NegZero", vec![VType::Object(ARGS.into())], |code, pool, o| {
        out(code, pool, o);
        code.const_double(o, pool, 1.0);
        code.const_double(o, pool, -0.0);
        code.arithmetic(o, insn::DIV, Kind::Double);
        println(code, pool, o, "D");
    }) else {
        return;
    };
    assert_eq!(stdout, "-Infinity");
}

#[test]
fn nan_comparisons_take_the_form_that_answers_false() {
    // `NaN < 1` and `NaN > 1` must both be false, and `NaN != 1` must be true.
    // Each needs a different `dcmp` form, which is why `branch_float` picks it
    // rather than leaving the pairing to a caller -- the first version of this
    // crate left it to the caller and had the rule backwards.
    let Some(stdout) = run_main("NanCmp", vec![VType::Object(ARGS.into())], |code, pool, o| {
        for compare in [Compare::Lt, Compare::Le, Compare::Gt, Compare::Ge, Compare::Eq, Compare::Ne] {
            let taken = code.label();
            let done = code.label();
            code.const_double(o, pool, f64::NAN);
            code.const_double(o, pool, 1.0);
            code.branch_float(o, compare, Kind::Double, taken);
            out(code, pool, o);
            code.const_int(o, pool, 0);
            println(code, pool, o, "I");
            code.goto(o, done);
            code.bind(taken);
            out(code, pool, o);
            code.const_int(o, pool, 1);
            println(code, pool, o, "I");
            code.bind(done);
        }
    }) else {
        return;
    };
    assert_eq!(
        stdout.split_whitespace().collect::<Vec<_>>(),
        ["0", "0", "0", "0", "0", "1"],
        "every relational operator is false against NaN, and `!=` is true"
    );
}

#[test]
fn a_string_literal_survives_modified_utf8() {
    // A literal with a NUL, a two-byte character and an astral one: the three
    // places Java's encoding is not UTF-8. A round trip through the class file
    // and out of `println` checks all three at once.
    let text = "a\u{0}b\u{00e9}c\u{1F600}";
    let Some(stdout) = run_main("Literal", vec![VType::Object(ARGS.into())], |code, pool, o| {
        out(code, pool, o);
        code.const_string(o, pool, text);
        println(code, pool, o, "Ljava/lang/String;");
    }) else {
        return;
    };
    assert_eq!(stdout.chars().count(), text.chars().count());
    assert!(stdout.ends_with('\u{1F600}'));
}

#[test]
fn arrays_are_allocated_stored_and_measured() {
    let locals = vec![VType::Object(ARGS.into()), VType::Object("[D".into())];
    let Some(stdout) = run_main("Arrays", locals, |code, pool, o| {
        code.const_int(o, pool, 4);
        code.new_array(o, pool, "D");
        code.store(o, Kind::Ref, 1);
        code.load(o, Kind::Ref, 1);
        code.const_int(o, pool, 2);
        code.const_double(o, pool, 1.5);
        code.array_store(o, "D");
        out(code, pool, o);
        code.load(o, Kind::Ref, 1);
        code.const_int(o, pool, 2);
        code.array_load(o, "D");
        code.load(o, Kind::Ref, 1);
        code.array_length(o);
        code.convert(o, insn::I2D, Kind::Int, Kind::Double);
        code.arithmetic(o, insn::MUL, Kind::Double);
        println(code, pool, o, "D");
    }) else {
        return;
    };
    assert_eq!(stdout, "6.0");
}

#[test]
fn a_generated_class_with_a_field() {
    let Some(java) = java_home_bin("java") else {
        return;
    };
    let origin = origin();
    let mut pool = Pool::new();

    // The value class: one double field, a default constructor, nothing else.
    let mut point = ClassBuilder::new("Point", "java/lang/Object");
    point.field(access::PUBLIC, "x", "D");
    point.default_constructor(&origin, &mut pool).expect("<init>");
    // Two classes cannot share a pool -- indices are per class file -- so the
    // second gets its own.
    let point = point.build(pool).expect("build Point");

    let mut pool = Pool::new();
    let locals = vec![VType::Object(ARGS.into()), VType::Object("Point".into())];
    let max_locals = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, max_locals);
    code.initialize_locals(&origin, 1);
    code.new_object(&origin, &mut pool, "Point");
    code.dup(&origin);
    code.invoke_special(&origin, &mut pool, "Point", "<init>", "()V");
    code.store(&origin, Kind::Ref, 1);
    code.load(&origin, Kind::Ref, 1);
    code.const_double(&origin, &mut pool, 2.25);
    code.put_field(&origin, &mut pool, "Point", "x", "D");
    out(&mut code, &mut pool, &origin);
    code.load(&origin, Kind::Ref, 1);
    code.get_field(&origin, &mut pool, "Point", "x", "D");
    println(&mut code, &mut pool, &origin, "D");
    code.ret(&origin, None);
    let body = code.finish(&pool).expect("finish main");

    let mut main = ClassBuilder::new("UsePoint", "java/lang/Object");
    main.default_constructor(&origin, &mut pool).expect("<init>");
    main.method(
        access::PUBLIC | access::STATIC,
        "main",
        "([Ljava/lang/String;)V",
        Some(body),
    );
    let main = main.build(pool).expect("build UsePoint");

    let dir = work_dir("UsePoint");
    for class in [&point, &main] {
        std::fs::write(dir.join(class.path()), &class.bytes).expect("write");
    }
    let output = Command::new(java)
        .arg("-Xverify:all")
        // Two JVMs starting at once contend for the hsperfdata file and the
        // loser prints a warning -- on *stdout*, which is what this test
        // compares. The program was right and the capture was wrong. Killing
        // the contention at the source beats trimming the output, which would
        // make the test tolerant of anything else the JVM decides to say.
        .arg("-XX:-UsePerfData")
        .arg("-cp")
        .arg(&dir)
        .arg("UsePoint")
        .output()
        .expect("run java");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "2.25");
}

#[test]
fn the_listing_agrees_with_javap() {
    // Two independent readings of the same bytes: ours decodes the code array,
    // javap decodes the class file. A disagreement is an encoding bug, which is
    // the whole reason the listing is a decoder rather than a log of what the
    // emitter meant to write.
    let (Some(java), Some(javap)) = (java_home_bin("java"), java_home_bin("javap")) else {
        return;
    };
    let _ = java;
    let origin = origin();
    let mut pool = Pool::new();
    let locals = vec![VType::Object(ARGS.into()), VType::Integer];
    let max_locals = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, max_locals);
    code.initialize_locals(&origin, 1);
    let done = code.label();
    code.const_int(&origin, &mut pool, 300);
    code.store(&origin, Kind::Int, 1);
    code.load(&origin, Kind::Int, 1);
    code.branch_zero(&origin, Compare::Eq, done);
    code.load(&origin, Kind::Int, 1);
    code.const_int(&origin, &mut pool, 7);
    code.arithmetic(&origin, insn::MUL, Kind::Int);
    code.store(&origin, Kind::Int, 1);
    code.bind(done);
    code.ret(&origin, None);
    let body = code.finish(&pool).expect("finish");
    let ours = text::listing(&body);

    let mut class = ClassBuilder::new("Listing", "java/lang/Object");
    class.default_constructor(&origin, &mut pool).expect("<init>");
    class.method(
        access::PUBLIC | access::STATIC,
        "main",
        "([Ljava/lang/String;)V",
        Some(body),
    );
    let built = class.build(pool).expect("build");
    let dir = work_dir("Listing");
    std::fs::write(dir.join(built.path()), &built.bytes).expect("write");

    let output = Command::new(javap)
        .arg("-c")
        .arg("-p")
        .arg(dir.join("Listing.class"))
        .output()
        .expect("run javap");
    assert!(output.status.success(), "javap rejected the class");
    let theirs = String::from_utf8_lossy(&output.stdout);

    // javap prints every method; take the one after `main`, and compare the
    // `offset: mnemonic` pairs rather than the operand rendering, which the two
    // spell differently on purpose.
    let main = theirs
        .split("public static void main(")
        .nth(1)
        .expect("javap printed main");
    let expected: Vec<String> = main
        .lines()
        .filter_map(|line| {
            let (at, rest) = line.trim().split_once(": ")?;
            let at: u16 = at.trim().parse().ok()?;
            let mnemonic = rest.split_whitespace().next()?;
            Some(format!("{at} {mnemonic}"))
        })
        .collect();
    let got: Vec<String> = ours
        .lines()
        .filter_map(|line| {
            let (at, rest) = line.get(1..)?.split_once(": ")?;
            let at: u16 = at.trim().parse().ok()?;
            let mnemonic = rest.split_whitespace().next()?;
            Some(format!("{at} {mnemonic}"))
        })
        .collect();
    assert!(!expected.is_empty(), "javap output was not parsed:\n{main}");
    assert_eq!(got, expected, "\nours:\n{ours}\ntheirs:\n{main}");
}
