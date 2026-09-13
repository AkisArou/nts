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

    expect("static readonly MAX: number;");    // every integral width is `number` now
    // A `ConstantValue` field IS its constant, so it is provably never null --
    // without this it read `string | null` for a compile-time string literal.
    expect("static readonly NAME: string;");
    // But a `static final` reference that is NOT a constant stays nullable,
    // because the class file genuinely cannot prove it. That pair is the
    // control: a rule that made every static non-null would pass the line
    // above and fail this one.
    expect("static readonly DEFAULT_KIND: Kind | null;");
    expect("hits: number;");                         // a public mutable field
    expect("id(): bigint;");                         // J -> bigint, never number
    expect("counts(): Int32Array");                  // [I -> a typed array, not int[]
    expect("bytes(): Uint8Array");                   // [B
    // Varargs spread at the call site; the ABI type is still the array, which
    // is what `javac` packs into.
    expect("sum(...a0: number[]): number;");
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
    let module =
        nts_jvm_emitter::bind::module_of("com.example", &[("com/example/Catalog".to_owned(), body)]);
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
    assert!(body.contains("find(a0: number): number;"), "a primitive argument is unchanged:\n{body}");
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
    assert!(body.contains("static readonly SMALL: Kind;"), "{body}");
    assert!(body.contains("static readonly LARGE: Kind;"), "{body}");
    assert!(!body.contains("SMALL: Kind | null"), "an enum constant is never null");

    // The control: an unannotated reference return on the SAME class is still
    // nullable, so this is about `ACC_ENUM` rather than about the class.
    assert!(body.contains("weight(): number;"), "{body}");
    assert!(
        body.contains("static valueOf(a0: string): Kind | null;"),
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
    // A method's own type variable, **declared** as well as used. Without the
    // `<T>` the generated file does not compile: the `T` in the body would
    // refer to nothing. Found by running the generator on the real jar and
    // reading the output, not by reasoning about it.
    expect("repeat<T>(a0: T, a1: number): java.util.List<T> | null;");
    // The control: a method with no type parameters of its own gains no angle
    // brackets, so this is about the `<...>` block rather than about every
    // method.
    expect("total(a0: java.util.List<java.lang.Number>): number;");
    assert!(!body.contains("total<"), "a non-generic method declares no parameters:\n{body}");
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

    assert!(only_fixture.contains("weight(): number;"), "declared members still render");

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
    // **Inherited FIELDS, which the first version of this walk missed
    // entirely.** `right` is a public field on `Widget`, and `panel.right` in
    // android-shape's `main.ts` was `TS2339 Property 'right' does not exist` --
    // found by compiling the project, not by this test. `Rect`-shaped geometry
    // is exactly public fields read through a subclass, so a generator that
    // inherits methods only cannot express the surface it exists for.
    assert!(
        with.contains("left: number;") && with.contains("right: number;"),
        "Widget's public fields must appear on View:\n{with}"
    );
    assert!(
        !without.contains("left: number;"),
        "and not without a resolver, or the assertion above is about nothing:\n{without}"
    );

    // A functional interface parameter takes **both** forms, because Java
    // accepts both: a lambda, and an object implementing the interface.
    // Surfacing only the function type makes `class Handler implements
    // View.OnTouch` inexpressible; surfacing only the interface makes an arrow
    // function inexpressible. Cost 8 is the first half; the second half is what
    // makes the matrix's "TS implements a Java interface" row reachable at all.
    assert!(
        with.contains("setOnTouch(a0: View.OnTouch | ((a0: number, a1: number) => boolean)): void;"),
        "a SAM parameter takes the interface or a closure:\n{with}"
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

/// The escape analysis, against methods whose behaviour is obvious by reading.
#[test]
fn a_parameter_only_read_does_not_escape() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let catalog = ours(&classes, "com.example.Catalog");
    let of = |name: &str| {
        let method = catalog.methods.iter().find(|m| m.name == name).expect(name);
        nts_jvm_emitter::escapes::of(method)
    };

    // `find(String)` returns `key.length()` -- the parameter is the receiver of
    // one call. Any invoke escapes the whole stack, so this is reported as
    // escaping: the conservative answer, and the honest one to assert.
    let by_text = of("find");
    assert!(by_text.analysed, "a method with a body is analysed");

    // `find(int)` returns its parameter directly. `areturn` does not apply to
    // an `int`, and `ireturn` is not an escape -- a primitive cannot outlive
    // anything. So nothing escapes.
    let ints: Vec<_> = catalog
        .methods
        .iter()
        .filter(|m| m.name == "find" && m.descriptor == "(I)I")
        .map(nts_jvm_emitter::escapes::of)
        .collect();
    assert_eq!(ints.len(), 1, "there is one find(int)");
    assert!(ints[0].escaping.is_empty(), "a primitive parameter returned by value escapes nothing");

    // **The control that the analysis is not simply answering `[]`.**
    // `Catalog(String label)` stores its parameter into `this.label`, which is
    // a `putfield` -- the textbook escape, and it must be reported.
    let ctor = catalog
        .methods
        .iter()
        .find(|m| m.name == "<init>")
        .expect("the constructor");
    let kept = nts_jvm_emitter::escapes::of(ctor);
    assert!(
        kept.escaping.contains(&0),
        "a parameter stored into a field escapes -- got {:?}",
        kept.escaping
    );
}

/// A method with no body cannot be analysed, and saying so is not the same as
/// saying nothing escapes.
#[test]
fn an_abstract_or_native_method_is_unanalysed_rather_than_empty() {
    let Some(ui) = android_shape() else {
        eprintln!("SKIP reads: the android-shape fixture did not build");
        return;
    };
    let bytes = std::fs::read(ui.join("com/example/ui/View$OnTouch.class")).expect("the interface");
    let interface = nts_jvm_emitter::read::class_file(&bytes).expect("parses");
    let only = interface.methods.iter().find(|m| m.name == "onTouch").expect("onTouch");

    let kept = nts_jvm_emitter::escapes::of(only);
    assert!(!kept.analysed, "an abstract method has no code to analyse");
    // And its answer is the pessimistic one, not the empty one. A caller that
    // read `escaping.is_empty()` without checking `analysed` would conclude
    // that nothing escapes, which is exactly backwards.
    assert_eq!(kept.escaping, vec![0, 1], "every parameter is assumed to escape");
}

/// `android.jar` is a stub jar, and its bodies are not its behaviour.
///
/// Every method in it is `new RuntimeException; dup; ldc "Stub!"; invokespecial;
/// athrow`. The parameter is never loaded, so an escape analysis that only asks
/// "did anything publish it" answers **nothing escapes** -- a *permissive* wrong
/// answer about a method whose real implementation may retain everything.
///
/// Before the guard this read 2,411 of 2,724 methods proved non-escaping, an
/// 88.5% yield. This test is the thing that would have caught it.
#[test]
fn a_body_that_only_throws_is_not_evidence() {
    let Some(sdk) = std::env::var("ANDROID_HOME")
        .or_else(|_| std::env::var("ANDROID_SDK_ROOT"))
        .ok()
        .map(PathBuf::from)
    else {
        eprintln!("SKIP reads/stub: no ANDROID_HOME");
        return;
    };
    let mut jars: Vec<PathBuf> = std::fs::read_dir(sdk.join("platforms"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|it| it.path().join("android.jar"))
        .filter(|it| it.exists())
        .collect();
    jars.sort();
    let Some(jar) = jars.last() else {
        eprintln!("SKIP reads/stub: no android.jar");
        return;
    };

    let extracted = Command::new("unzip")
        .arg("-p")
        .arg(jar)
        .arg("android/graphics/Rect.class")
        .output()
        .expect("unzip runs");
    assert!(extracted.status.success(), "could not extract Rect.class");
    let rect = nts_jvm_emitter::read::class_file(&extracted.stdout).expect("Rect parses");

    let set = rect
        .methods
        .iter()
        .find(|m| m.name == "set" && m.descriptor == "(Landroid/graphics/Rect;)V")
        .expect("Rect.set(Rect)");

    // It HAS a body -- that is the trap. The body just never returns.
    assert!(set.code.is_some(), "a stub still carries a Code attribute");

    let kept = nts_jvm_emitter::escapes::of(set);
    assert!(
        !kept.analysed,
        "a body that only throws must not be treated as evidence -- it reported {:?}",
        kept.escaping
    );
    assert_eq!(kept.escaping, vec![0], "and the answer is pessimistic, not empty");

    // **The control**: a method in OUR fixture, with a real body that returns,
    // must still be analysed. Without this the guard could be rejecting
    // everything and the assertion above would still pass.
    let Some(classes) = fixture() else { return };
    let catalog = ours(&classes, "com.example.Catalog");
    let real = catalog.methods.iter().find(|m| m.name == "weight" || m.name == "find").expect("a real method");
    assert!(
        nts_jvm_emitter::escapes::of(real).analysed,
        "a body that returns normally is still analysed"
    );
}

/// The direction the analysis fails in, pinned on a method whose behaviour is
/// not in dispute.
///
/// `FilterOutputStream.write(byte[])` calls `write(b, 0, b.length)`, so `b` is
/// demonstrably passed on. An earlier version answered `escaping=[]` for it --
/// a **permissive** wrong answer about the textbook case -- because the
/// unmodelled-opcode arm cleared the stack, losing the parameter at
/// `arraylength` two instructions before the `invoke` that publishes it.
///
/// Skips without a JDK holding `java.base`, because the SDK cannot supply this:
/// `android.jar` has no bodies at all, which is the point of the test beside it.
#[test]
fn an_unmodelled_instruction_fails_closed() {
    let Some(java_home) = std::env::var("JAVA_HOME").ok().map(PathBuf::from) else {
        eprintln!("SKIP reads/fail-closed: no JAVA_HOME");
        return;
    };
    let Some(jmod) = tool("jmod") else {
        eprintln!("SKIP reads/fail-closed: no jmod");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-jb-{}", std::process::id()));
    if !out.join("classes/java/io/FilterOutputStream.class").exists() {
        let _ = std::fs::create_dir_all(&out);
        let extracted = Command::new(&jmod)
            .args(["extract", "--dir"])
            .arg(&out)
            .arg(java_home.join("jmods/java.base.jmod"))
            .output();
        if !extracted.is_ok_and(|it| it.status.success()) {
            eprintln!("SKIP reads/fail-closed: could not extract java.base");
            return;
        }
    }
    let Ok(bytes) = std::fs::read(out.join("classes/java/io/FilterOutputStream.class")) else {
        eprintln!("SKIP reads/fail-closed: no FilterOutputStream");
        return;
    };
    let class = nts_jvm_emitter::read::class_file(&bytes).expect("parses");
    let of = |descriptor: &str| {
        let method = class
            .methods
            .iter()
            .find(|m| m.name == "write" && m.descriptor == descriptor)
            .unwrap_or_else(|| panic!("write{descriptor}"));
        nts_jvm_emitter::escapes::of(method)
    };

    // Passed to another method: escapes. This is the assertion that was wrong.
    assert_eq!(of("([B)V").escaping, vec![0], "a byte[] passed on must escape");
    assert_eq!(of("([BII)V").escaping, vec![0], "likewise with an offset and length");

    // **The control, and without it "everything escapes" would pass.**
    // `write(int)` has no reference parameter to escape, so the answer must be
    // empty -- a fail-closed default that marked everything would fail here.
    assert!(of("(I)V").escaping.is_empty(), "a primitive parameter escapes nothing");
    assert!(of("(I)V").analysed, "and it was actually analysed");
}

/// The table the binding carries, and the property that makes it worth keying
/// by descriptor.
///
/// The test that matters for the `keeps` routing is not "this key answers `[0]`"
/// -- it is **"this key answers `[0]` and a key differing only in descriptor
/// does not"**. Without that, a lookup that ignored the descriptor entirely
/// would pass.
#[test]
fn the_keeps_table_distinguishes_overloads_by_descriptor() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let table = nts_jvm_emitter::escapes::table(&ours(&classes, "com.example.Catalog"));
    let get = |key: &str| {
        table.iter().find(|(name, _)| name == key).map(|(_, escaping)| escaping.clone())
    };

    // Same name, different descriptors, different answers.
    assert_eq!(
        get("com/example/Catalog.find:(I)I"),
        Some(vec![]),
        "a primitive parameter escapes nothing"
    );
    assert_eq!(
        get("com/example/Catalog.find:(Ljava/lang/String;)I"),
        Some(vec![0]),
        "a String handed to a call is assumed to escape"
    );

    // **Methods the analysis could not read are absent, not empty.** An absent
    // entry means "assume everything escapes", which is sound; an empty entry
    // is a *claim* that nothing does. A table that recorded `[]` for an
    // unreadable method would turn ignorance into permission.
    assert!(
        !table.iter().any(|(name, _)| name.contains("<init>")),
        "constructors are not in the table"
    );

    // And the key format is the one `hir::runtime::foreign_key` defines, so
    // the generator and the reader share one derivation rather than two.
    assert!(
        table.iter().all(|(name, _)| name.contains('/') && name.contains(':')),
        "every key is owner.member:descriptor"
    );
}

/// A Java interface is emitted as a TypeScript `interface`, so it can be
/// implemented.
///
/// Before this it was not nameable at all -- it only ever appeared inlined at a
/// parameter as a function type -- so a TypeScript class could not declare that
/// it implements one, and the coverage matrix's row for it was satisfied by a
/// **comment** mentioning `implements`. A grep for a keyword is not coverage.
#[test]
fn a_java_interface_is_emitted_as_an_interface() {
    let Some(ui) = android_shape() else {
        eprintln!("SKIP reads: the android-shape fixture did not build");
        return;
    };
    let bytes = std::fs::read(ui.join("com/example/ui/View$OnTouch.class")).expect("the interface");
    let class = nts_jvm_emitter::read::class_file(&bytes).expect("parses");
    let body = nts_jvm_emitter::bind::declarations(&class).expect("renders");

    assert!(body.contains("export interface OnTouch {"), "an interface, not a class:\n{body}");
    assert!(body.contains("onTouch(a0: number, a1: number): boolean;"), "{body}");
    // An interface has no constructor, and emitting one is a syntax error in
    // TypeScript -- which is the control that this is not just a renamed class.
    assert!(!body.contains("constructor("), "an interface declares no constructor:\n{body}");

    // The control on the other side: a real class still emits as a class with
    // its constructor, so the branch is about `ACC_INTERFACE` rather than about
    // every type.
    let rect = std::fs::read(ui.join("com/example/ui/Rect.class")).expect("Rect");
    let rect = nts_jvm_emitter::read::class_file(&rect).expect("parses");
    let rendered = nts_jvm_emitter::bind::declarations(&rect).expect("renders");
    assert!(rendered.contains("export class Rect {"), "{rendered}");
    assert!(rendered.contains("constructor("), "a class still declares one:\n{rendered}");
}

/// The opcode width table, checked against every method `javac` wrote in
/// `java.base`.
///
/// `escapes::width` is a transcription of JVMS 6.5, and a transcription is a
/// second derivation this crate cannot otherwise verify: a wrong width for a
/// *known* opcode does not fail, it **desynchronises**. The walk resumes a byte
/// off, reads an operand as an opcode, and -- at 200-odd assigned opcodes --
/// usually finds a valid one and keeps going over nonsense.
///
/// An exact landing is a checksum: every width has to be right for the total to
/// come out, and being wrong in one place almost never cancels another.
///
/// **And the failure is permissive, which is why the assertion is worth its
/// runtime.** Measured by changing one 3-byte width to 4: methods analysed fell
/// 89.1% -> 34.4%, and the proportion *proved non-escaping* **rose**, 4.5% ->
/// 8.5%. A desynchronised walk loses track of the parameter and reports that
/// nothing published it -- so the table being wrong makes the analysis look
/// better.
#[test]
fn the_width_table_walks_real_bytecode_exactly() {
    let Some(classes) = java_base() else {
        eprintln!("SKIP reads/widths: java.base is not available");
        return;
    };

    let mut walked = 0usize;
    let mut bodies = 0usize;
    let mut files = Vec::new();
    collect_classes(&classes, &mut files);

    for path in &files {
        let Ok(bytes) = std::fs::read(path) else { continue };
        let Ok(class) = nts_jvm_emitter::read::class_file(&bytes) else { continue };
        for method in &class.methods {
            if method.code.is_none() {
                continue;
            }
            bodies += 1;
            // `of` fails closed on a desynchronised walk, so `analysed` is the
            // observable: a body whose widths do not add up is refused.
            if nts_jvm_emitter::escapes::of(method).analysed {
                walked += 1;
            }
        }
    }

    assert!(bodies > 5_000, "expected thousands of real bodies, got {bodies}");
    // Not 100%: a body that only throws is refused by design, and so is one
    // whose descriptor this subset cannot parse. The bar is set well above the
    // 34.4% a single wrong width produced and well below the 89.1% that is
    // correct, so it fails on a desynchronised table and passes on a correct one.
    let rate = (walked * 100) / bodies;
    assert!(
        rate > 70,
        "only {rate}% of {bodies} real method bodies walked cleanly -- a width in \
         `escapes::width` disagrees with the bytecode `javac` emits"
    );
}

/// Every `.class` under a directory.
fn collect_classes(at: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else { return };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            collect_classes(&path, found);
        } else if path.extension().is_some_and(|it| it == "class") {
            found.push(path);
        }
    }
}

/// `java.base`'s classes, extracted once. The JDK is the only corpus to hand
/// with real bodies in it -- `android.jar` is stubs, which is its own test.
fn java_base() -> Option<PathBuf> {
    static BUILT: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    BUILT
        .get_or_init(|| {
            let home = PathBuf::from(std::env::var("JAVA_HOME").ok()?);
            let jmod = home.join("jmods/java.base.jmod");
            if !jmod.exists() {
                return None;
            }
            let out = std::env::temp_dir().join("nts-java-base-widths");
            let classes = out.join("classes");
            if !classes.exists() {
                let _ = std::fs::create_dir_all(&out);
                let ran = Command::new(tool("jmod")?)
                    .args(["extract", "--dir"])
                    .arg(&out)
                    .arg(&jmod)
                    .output()
                    .ok()?;
                if !ran.status.success() {
                    return None;
                }
            }
            classes.exists().then_some(classes)
        })
        .clone()
}

/// The two type renderers agree about a primitive array.
///
/// `bind` has a plain renderer and a generic one. They used to carry separate
/// typed-array tables, and the generic copy keyed on the **rendered** name --
/// `"int" => "Int32Array"` -- which was correct while brands existed and became
/// wrong the moment they were removed, because every integral width renders as
/// `number` now.
///
/// **Nothing caught it**, because catching it needs a method that is *both*
/// generic and takes a primitive array, and the fixture had none: `counts()`
/// went through the plain renderer and was right, `repeat<T>` went through the
/// generic one and had no array. `Catalog.tally` exists to be both.
#[test]
fn both_renderers_agree_about_a_primitive_array() {
    let Some(classes) = fixture() else {
        eprintln!("SKIP reads: no JDK");
        return;
    };
    let body = nts_jvm_emitter::bind::declarations(&ours(&classes, "com.example.Catalog"))
        .expect("renders");

    // The plain renderer, on `()[I`.
    assert!(body.contains("counts(): Int32Array | null;"), "{body}");
    // The generic renderer, on `(TT;[I)` -- the same `[I`.
    assert!(
        body.contains("tally<T>(a0: T, a1: Int32Array): java.util.List<T> | null;"),
        "a primitive array renders the same in a generic signature:\n{body}"
    );
    // And specifically not the wrong width, which is what the second table gave.
    assert!(
        !body.contains("tally<T>(a0: T, a1: Float64Array)"),
        "`[I` is an Int32Array in both renderers, not a Float64Array:\n{body}"
    );
}
