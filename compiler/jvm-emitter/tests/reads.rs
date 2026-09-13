//! The reader against `javap`, on class files this project did not write.
//!
//! Reading back what we emitted would only prove the two halves of this crate
//! agree with each other. The inputs here come from `javac`, and the oracle is
//! `javap -p -s`, which is what the JDK thinks the same bytes mean. That
//! pairing has caught three things in this lane already.
//!
//! The fixture is `examples/interop/java-from-ts`, which is checked in and
//! deliberately awkward -- statics with and without `ConstantValue`, a public
//! field, generics, a wildcard, varargs, a `throws` clause, an enum, a static
//! nested class and a true inner one. Sharing it means the binding project and
//! the reader cannot drift apart about what a hard case is.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_jvm_emitter::read;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repository() -> PathBuf {
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    from.canonicalize().unwrap_or(from)
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

/// Compile the checked-in fixture once, and hand every test the same directory.
///
/// **A `OnceLock` rather than a call per test, because the first version was a
/// race.** The directory was keyed on the process id, which is the same for
/// every test in one binary, and each test began by deleting and recreating it
/// -- so with `cargo test`'s default parallelism one test removed the class
/// files another was midway through reading. It passed with five tests and
/// broke on the sixth, reporting `the class file ends inside a value`, which
/// reads exactly like a reader bug and is not one.
fn fixture() -> Option<PathBuf> {
    static BUILT: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    BUILT.get_or_init(build_fixture).clone()
}

fn build_fixture() -> Option<PathBuf> {
    let javac = tool("javac")?;
    let sources = repository().join("examples/interop/java-from-ts/java/com/example");
    if !sources.exists() {
        eprintln!("SKIP reads: the fixture is missing at {}", sources.display());
        return None;
    }
    let out = std::env::temp_dir().join(format!("nts-reads-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).expect("a temp dir");

    let files: Vec<PathBuf> = std::fs::read_dir(&sources)
        .expect("the fixture directory")
        .filter_map(|it| it.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "java"))
        .collect();

    let built = Command::new(&javac)
        .args(["--release", "8", "-Xlint:all,-options", "-d"])
        .arg(&out)
        .args(&files)
        .output()
        .expect("javac runs");
    assert!(built.status.success(), "javac: {}", String::from_utf8_lossy(&built.stderr));
    Some(out)
}

/// Every `name descriptor` pair `javap -p -s` prints for a class.
///
/// `javap` prints the signature line then an indented `descriptor:` line, so
/// the descriptors arrive in declaration order and the names are recoverable
/// from them alone -- which is what makes this a comparison of two *readings*
/// rather than of one reading and a regex.
fn javap_descriptors(javap: &Path, classes: &Path, class: &str) -> BTreeSet<String> {
    let listed = Command::new(javap)
        .args(["-p", "-s", "-cp"])
        .arg(classes)
        .arg(class)
        .output()
        .expect("javap runs");
    assert!(listed.status.success(), "javap: {}", String::from_utf8_lossy(&listed.stderr));
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .filter_map(|line| line.trim().strip_prefix("descriptor: "))
        .map(str::to_owned)
        .collect()
}

fn ours(classes: &Path, class: &str) -> read::ClassFile {
    let path = classes.join(format!("{}.class", class.replace('.', "/")));
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    read::class_file(&bytes).expect("the class file should parse")
}

#[test]
fn every_descriptor_agrees_with_javap() {
    let (Some(classes), Some(javap)) = (fixture(), tool("javap")) else {
        eprintln!("SKIP reads: no JDK");
        return;
    };

    let mut checked = 0usize;
    for class in ["com.example.Catalog", "com.example.Kind", "com.example.Catalog$Entry", "com.example.Catalog$Cursor"] {
        let mine: BTreeSet<String> = ours(&classes, class)
            .fields
            .iter()
            .chain(ours(&classes, class).methods.iter())
            .map(|m| m.descriptor.clone())
            .collect();
        let theirs = javap_descriptors(&javap, &classes, class);
        assert!(!theirs.is_empty(), "javap printed no descriptors for {class}");
        assert_eq!(mine, theirs, "descriptors disagree for {class}");
        checked += theirs.len();
    }
    // Vacuity guard: an empty comparison is an agreement about nothing.
    assert!(checked > 20, "only {checked} descriptors compared, which is too few to mean anything");
}

/// The inner-class fact the plan first got wrong, read out of the bytes.
#[test]
fn an_inner_class_takes_its_outer_instance_first() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let cursor = ours(&classes, "com.example.Catalog$Cursor");

    let ctor = cursor
        .methods
        .iter()
        .find(|m| m.name == "<init>")
        .expect("the inner class has a constructor");
    assert_eq!(
        ctor.descriptor, "(Lcom/example/Catalog;I)V",
        "a true inner class's constructor takes the outer instance as its synthetic first \
         parameter -- this is what makes `outer.newInner(n)` mechanical rather than a workaround"
    );

    // And `InnerClasses` names the outer, which is how the generator tells a
    // true inner class from a static nested one.
    assert!(
        cursor
            .inner_classes
            .iter()
            .any(|(inner, outer)| inner == "com/example/Catalog$Cursor" && outer == "com/example/Catalog"),
        "InnerClasses should name the outer class, got {:?}",
        cursor.inner_classes
    );

    // The static nested one has no outer instance in its descriptor, which is
    // the control: without it this test would pass for a reader that put a
    // leading parameter on everything.
    let entry = ours(&classes, "com.example.Catalog$Entry");
    let entry_ctor =
        entry.methods.iter().find(|m| m.name == "<init>").expect("a constructor");
    assert_eq!(entry_ctor.descriptor, "(Ljava/lang/String;)V");
}

/// `ConstantValue` is what decides `ldc` against `getstatic`.
#[test]
fn only_primitive_and_string_statics_carry_a_constant_value() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let catalog = ours(&classes, "com.example.Catalog");
    let field = |name: &str| {
        catalog.fields.iter().find(|f| f.name == name).unwrap_or_else(|| panic!("no field {name}"))
    };

    assert!(field("MAX").constant, "an `int` static inlines");
    assert!(field("NAME").constant, "a `String` static inlines");
    assert!(
        !field("DEFAULT_KIND").constant,
        "a reference static has no ConstantValue, so it is a real getstatic and runs <clinit>"
    );
    assert!(!field("hits").constant, "an instance field never has one");
}

/// Generics survive erasure in `Signature`, which is what lets the binding
/// surface `List<String>` rather than `List<unknown>`.
#[test]
fn the_signature_attribute_carries_generics_the_descriptor_lost() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let catalog = ours(&classes, "com.example.Catalog");
    let names = catalog.methods.iter().find(|m| m.name == "names").expect("names()");

    assert_eq!(names.descriptor, "()Ljava/util/List;", "the descriptor is erased");
    assert_eq!(
        names.signature.as_deref(),
        Some("()Ljava/util/List<Ljava/lang/String;>;"),
        "and the Signature attribute still has the parameter"
    );

    // The raw method is the control: same erased descriptor, and no Signature,
    // which is exactly how a raw type is told from a generic one.
    let raw = catalog.methods.iter().find(|m| m.name == "raw").expect("raw()");
    assert_eq!(raw.descriptor, "()Ljava/util/List;");
    assert_eq!(raw.signature, None, "a raw List has no Signature, so it becomes List<unknown>");
}

/// A `throws` clause is readable, which is what tells the generator which call
/// sites need an exception handler.
#[test]
fn a_throws_clause_is_readable() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let catalog = ours(&classes, "com.example.Catalog");
    let parse = catalog.methods.iter().find(|m| m.name == "parse").expect("parse()");
    assert_eq!(parse.throws, vec!["java/lang/NumberFormatException".to_owned()]);

    let names = catalog.methods.iter().find(|m| m.name == "names").expect("names()");
    assert!(names.throws.is_empty(), "a method with no throws clause has none");
}

/// The Android SDK, which is the input this reader exists for.
///
/// Skips without an SDK, because most machines do not have one -- but it does
/// **not** skip quietly on a machine that does, and the numbers below are the
/// ones `javap -v` reports for the same class.
///
/// The load-bearing assertion is the invisible table. `androidx.annotation`
/// is `CLASS`-retention, so a reader that walks only `RuntimeVisibleAnnotations`
/// finds **zero** nullability on `android.view.View` and every generated
/// declaration silently loses its `| null`. That is the failure this test
/// exists to make loud.
#[test]
fn android_view_carries_its_nullability_in_the_invisible_table() {
    let Some(sdk) = std::env::var("ANDROID_HOME")
        .or_else(|_| std::env::var("ANDROID_SDK_ROOT"))
        .ok()
        .map(PathBuf::from)
    else {
        eprintln!("SKIP reads/android: no ANDROID_HOME");
        return;
    };
    let platforms = sdk.join("platforms");
    let Ok(entries) = std::fs::read_dir(&platforms) else {
        eprintln!("SKIP reads/android: no platforms at {}", platforms.display());
        return;
    };
    let mut jars: Vec<PathBuf> =
        entries.filter_map(Result::ok).map(|it| it.path().join("android.jar")).filter(|it| it.exists()).collect();
    jars.sort();
    let Some(jar) = jars.last() else {
        eprintln!("SKIP reads/android: no android.jar under {}", platforms.display());
        return;
    };

    let extracted = Command::new("unzip")
        .args(["-p"])
        .arg(jar)
        .arg("android/view/View.class")
        .output()
        .expect("unzip runs");
    assert!(extracted.status.success(), "could not extract View.class from {}", jar.display());

    let view = read::class_file(&extracted.stdout).expect("android.view.View should parse");
    assert_eq!(view.binary_name, "android/view/View");

    // Member annotations AND parameter annotations. On this class the second
    // is the larger half -- 79 sites against 38 -- so counting only the first
    // reads 38 where the truth is 142, which is how the gap was found.
    let count = |needle: &str| {
        view.methods
            .iter()
            .chain(view.fields.iter())
            .flat_map(|m| m.annotations.iter().chain(m.parameter_annotations.iter().flatten()))
            .filter(|a| a.ends_with(needle))
            .count()
    };
    let nullable = count("/Nullable");
    let nonnull = count("/NonNull");

    // `javap -v` on android-36 resolves **76** `android.annotation.Nullable`
    // and **66** `NonNull` annotation sites on this class, counted as sites
    // rather than as string occurrences -- an earlier count of the same thing
    // via `grep -oE` over the whole verbose dump was inflated by the constant
    // pool's own Utf8 entries.
    //
    // The bound is well below those and well above 38, which is what this
    // reader returns when parameter annotations are skipped. So it fails both
    // ways it can be wrong: zero if the invisible table is skipped, and ~38 if
    // the parameter tables are.
    assert!(
        nullable >= 60 && nonnull >= 55,
        "expected ~76 @Nullable and ~66 @NonNull sites on android.view.View, got {nullable} and \
         {nonnull} -- near zero means RuntimeInvisibleAnnotations is unread, and near 38 means \
         RuntimeInvisibleParameterAnnotations is"
    );

    // And the class parses far enough to be worth generating from.
    assert!(view.methods.len() > 100, "View should have many methods, got {}", view.methods.len());
    assert_eq!(view.super_name.as_deref(), Some("java/lang/Object"));
}

/// The generator, against the same fixture the reader is tested on.
///
/// The checked-in `examples/interop/java-from-ts/types/com.example.d.ts` was
/// written by hand as the **specification** for this function. Comparing the
/// two is how the spec stops being aspirational -- where they differ, one of
/// them is wrong, and the difference is the work list.
#[test]
fn the_generator_produces_declarations_for_the_fixture() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let catalog = ours(&classes, "com.example.Catalog");
    let body = nts_jvm_emitter::bind::declarations(&catalog).expect("Catalog should render");

    // The decisions, each measured or forced, asserted individually so a
    // failure names which one moved rather than printing a diff of the whole
    // file.
    let expect = |needle: &str| {
        assert!(body.contains(needle), "expected `{needle}` in:\n{body}");
    };

    expect("static readonly MAX: int;");       // I -> branded int
    // A `ConstantValue` field IS its constant, so it is provably never null --
    // without this it read `string | null` for a compile-time string literal.
    expect("static readonly NAME: string;");
    // But a `static final` reference that is NOT a constant stays nullable,
    // because the class file genuinely cannot prove it. That pair is the
    // control: a rule that made every static non-null would pass the line
    // above and fail this one.
    expect("static readonly DEFAULT_KIND: com.example.Kind | null;");
    expect("hits: int;");                            // a public mutable field
    expect("id(): bigint;");                         // J -> bigint, never number
    expect("counts(): Int32Array");                  // [I -> a typed array, not int[]
    expect("bytes(): Uint8Array");                   // [B
    expect("sum(a0: Int32Array): int;");             // varargs are an array at the ABI
    expect("constructor(a0: string");                // <init> becomes a constructor

    // `ConstantValue` is surfaced, because it decides whether touching the
    // member loads the class at all.
    expect("Inlined at the call site");
    expect("A real `getstatic`");

    // A `throws` clause reaches the declaration.
    expect("Throws java.lang.NumberFormatException");

    // `Object` is `unknown`, never `any`.
    let rendered = nts_jvm_emitter::bind::declarations(&ours(&classes, "com.example.Catalog"))
        .expect("renders");
    assert!(!rendered.contains(": any"), "`any` must never be generated");

    // And the module wrapper produces something importable.
    let module = nts_jvm_emitter::bind::module("com.example", &[body]);
    assert!(module.contains("declare module \"java:com.example\""));
    assert!(module.starts_with("// GENERATED"), "the header says not to edit it");
}

/// The nullability rules run in opposite directions for a return and an
/// argument, and getting that backwards is a silent hole.
#[test]
fn nullability_is_asymmetric_between_returns_and_arguments() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let body = nts_jvm_emitter::bind::declarations(&ours(&classes, "com.example.Catalog"))
        .expect("renders");

    // A RETURN defaults to `| null` when unannotated: the class file does not
    // say, and guessing non-null produces an NPE the types promised could not
    // happen.
    assert!(body.contains("name(): string | null;"), "an unannotated return is nullable:\n{body}");

    // An ARGUMENT does not get `| null` added by default. The error a caller
    // wants kept is passing null where the callee never said it accepts one,
    // so widening every parameter would delete exactly that check.
    assert!(
        body.contains("render(a0: string): string | null;"),
        "an unannotated argument stays non-null:\n{body}"
    );
    // The control: `find(a0: number)` proves a primitive argument is untouched
    // by either rule, so the two assertions above are about nullability rather
    // than about parameters in general.
    assert!(body.contains("find(a0: number): int;"), "a primitive argument is unchanged:\n{body}");
}

/// Print the generated declarations, for reading rather than asserting.
/// `cargo test --test reads show_generated -- --nocapture --ignored`
#[test]
#[ignore = "output for a human, not an assertion"]
fn show_generated() {
    let Some(classes) = fixture() else { return };
    for class in ["com.example.Catalog", "com.example.Kind"] {
        match nts_jvm_emitter::bind::declarations(&ours(&classes, class)) {
            Ok(body) => println!("{body}"),
            Err(why) => println!("REFUSED {why}"),
        }
    }
}

/// An enum's own constants are never null, and the class file says so.
#[test]
fn enum_constants_are_not_nullable() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let body =
        nts_jvm_emitter::bind::declarations(&ours(&classes, "com.example.Kind")).expect("renders");

    // `ACC_ENUM` on both the class and the field. The JLS guarantees `<clinit>`
    // creates every constant before any is observable, so `| null` here would
    // be a check that can never fire.
    assert!(body.contains("static readonly SMALL: com.example.Kind;"), "{body}");
    assert!(body.contains("static readonly LARGE: com.example.Kind;"), "{body}");
    assert!(!body.contains("SMALL: com.example.Kind | null"), "an enum constant is never null");

    // The control: an unannotated reference return on the SAME class is still
    // nullable, so this is about `ACC_ENUM` rather than about the class.
    assert!(body.contains("weight(): int;"), "{body}");
    assert!(
        body.contains("static valueOf(a0: string): com.example.Kind | null;"),
        "an unannotated return is still nullable on an enum:\n{body}"
    );

    // **A gap this test also pins.** `Kind.name()` and `Kind.ordinal()` come
    // from `java.lang.Enum` and are NOT declared on `Kind`, so they do not
    // appear -- this generator surfaces declared members only. Inherited
    // members need walking the superclass chain, which needs the jar rather
    // than one class file, and that is the next thing after generics.
    assert!(!body.contains("ordinal()"), "inherited members are not surfaced yet; if this \
        starts failing, the superclass walk landed and this assertion is the one to delete");
}

/// Generics survive into the declarations, which is what makes an element
/// access typed rather than a cast.
#[test]
fn generic_signatures_are_rendered() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let body = nts_jvm_emitter::bind::declarations(&ours(&classes, "com.example.Catalog"))
        .expect("renders");
    let expect = |needle: &str| assert!(body.contains(needle), "expected `{needle}` in:\n{body}");

    // A parameterised return: the descriptor says `Ljava/util/List;` and only
    // the Signature attribute still has the `String`.
    expect("names(): java.util.List<string> | null;");
    // Two arguments, one of them boxed because a Java map cannot hold a
    // primitive -- Java's cost, and visible rather than hidden.
    expect("index(): java.util.HashMap<string, java.lang.Integer> | null;");
    // A method's own type variable, rendered by name at each use.
    expect("repeat(a0: T, a1: int): java.util.List<T> | null;");
    // `List<? extends Number>`: TypeScript has no wildcard, so a covariant
    // bound renders as the bound itself.
    expect("total(a0: java.util.List<java.lang.Number>): number;");

    // **The control, and it is the one that proves the Signature attribute is
    // what is being read.** `raw()` has the same erased descriptor as
    // `names()` -- `()Ljava/util/List;` -- and no Signature at all. If these
    // two rendered the same, the generics above would be coming from the
    // descriptor, which does not contain them.
    expect("raw(): java.util.List | null;");
    assert!(
        !body.contains("raw(): java.util.List<"),
        "a raw type has no Signature and must not gain type arguments:\n{body}"
    );
}

/// Resolves a class out of a directory of compiled class files.
struct FromDirectory(PathBuf);

impl nts_jvm_emitter::bind::Resolve for FromDirectory {
    fn find(&self, binary_name: &str) -> Option<nts_jvm_emitter::read::ClassFile> {
        let bytes = std::fs::read(self.0.join(format!("{binary_name}.class"))).ok()?;
        nts_jvm_emitter::read::class_file(&bytes).ok()
    }
}

/// Inherited members, which need more than one class file.
#[test]
fn inherited_members_are_surfaced_through_a_resolver() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };

    let kind = ours(&classes, "com.example.Kind");

    // Without a resolver, nothing inherited appears -- the single-class case.
    let alone = nts_jvm_emitter::bind::declarations(&kind).expect("renders");
    assert!(!alone.contains("ordinal()"), "no resolver means no inherited members:\n{alone}");

    // `java/lang/Enum` is in the JDK rather than the fixture, so a resolver
    // that only knows the fixture directory still finds nothing. That is the
    // control: it proves the next assertion is about resolution and not about
    // the flag.
    let only_fixture = nts_jvm_emitter::bind::declarations_with(&kind, &FromDirectory(classes.clone()))
        .expect("renders");
    assert!(
        !only_fixture.contains("ordinal()"),
        "java.lang.Enum is not in the fixture, so this should still find nothing:\n{only_fixture}"
    );

    assert!(only_fixture.contains("weight(): int;"), "declared members still render");

    // **The positive arm, and without it the three assertions above would all
    // pass with `inherited` returning nothing at all.** `android-shape` has a
    // real chain -- `View extends Widget` -- so a resolver that can see
    // `Widget` must surface its members on `View`.
    let Some(ui) = android_shape() else {
        eprintln!("SKIP reads: the android-shape fixture did not build");
        return;
    };
    let view = {
        let bytes = std::fs::read(ui.join("com/example/ui/View.class")).expect("View.class");
        nts_jvm_emitter::read::class_file(&bytes).expect("parses")
    };

    let without = nts_jvm_emitter::bind::declarations(&view).expect("renders");
    assert!(
        !without.contains("setBounds"),
        "`setBounds` is declared on Widget, not View, so it must be absent without a resolver:\n{without}"
    );

    let with = nts_jvm_emitter::bind::declarations_with(&view, &FromDirectory(ui)).expect("renders");
    assert!(
        with.contains("setBounds") && with.contains("/** Inherited. */"),
        "with a resolver, Widget's members appear on View:\n{with}"
    );
    // `dispatchTouch` is declared on View itself and must NOT be marked
    // inherited -- the control that the two sets are told apart.
    let marked_inherited = with
        .split("/** Inherited. */")
        .skip(1)
        .any(|chunk| chunk.lines().next().is_some_and(|line| line.contains("dispatchTouch")));
    assert!(!marked_inherited, "a declared member must not be marked inherited:\n{with}");
}

/// The `android-shape` fixture, compiled. Its `View extends Widget` is the only
/// real inheritance chain checked in to this repository's interop projects.
fn android_shape() -> Option<PathBuf> {
    static BUILT: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    BUILT
        .get_or_init(|| {
            let javac = tool("javac")?;
            let sources = repository().join("examples/interop/android-shape/java/com/example/ui");
            if !sources.exists() {
                return None;
            }
            let out = std::env::temp_dir().join(format!("nts-ui-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&out);
            std::fs::create_dir_all(&out).ok()?;
            let files: Vec<PathBuf> = std::fs::read_dir(&sources)
                .ok()?
                .filter_map(|it| it.ok().map(|e| e.path()))
                .filter(|p| p.extension().is_some_and(|e| e == "java"))
                .collect();
            let built = Command::new(&javac)
                .args(["--release", "8", "-nowarn", "-d"])
                .arg(&out)
                .args(&files)
                .output()
                .ok()?;
            built.status.success().then_some(out)
        })
        .clone()
}
