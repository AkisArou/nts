//! The two crates agree about what a foreign key looks like.
//!
//! `hir::runtime::foreign_key` builds `owner.member:descriptor` and
//! `bind::split_key` takes it apart. They are in different crates on purpose --
//! `nts-jvm-emitter` knows nothing of HIR -- which means neither can import the
//! other's idea of the format, and the only thing stopping them drifting is an
//! assertion somewhere that depends on both.
//!
//! This crate is that somewhere. Without it the disagreement surfaces as a
//! foreign call emitted against a name assembled from the wrong halves: a
//! `NoSuchMethodError` in the user's program, at a call site that looks correct
//! in the source.

/// Round trip, over the shapes a real jar produces.
#[test]
fn a_key_built_upstream_splits_downstream() {
    let cases = [
        ("com/example/Catalog", "find", "(I)I"),
        // A descriptor full of the separators a naive split would trip on.
        ("java/util/HashMap", "get", "(Ljava/lang/Object;)Ljava/lang/Object;"),
        ("com/example/Catalog", "<init>", "(Ljava/lang/String;)V"),
        ("com/example/Catalog$Cursor", "next", "()Z"),
        ("Demo", "run", "()V"),
        ("nts/rt/NtsArrayD", "setLength", "(Lnts/rt/NtsArrayD;D)V"),
    ];
    for (owner, member, descriptor) in cases {
        let key = nts_core::hir::runtime::foreign_key(owner, member, descriptor);
        assert!(
            nts_core::hir::runtime::is_foreign_key(&key) || !owner.contains('/'),
            "`{key}` is not recognised as a foreign key by the crate that built it"
        );
        let split = nts_jvm_emitter::bind::split_key(&key)
            .unwrap_or_else(|| panic!("`{key}` built upstream did not split downstream"));
        assert_eq!(split, (owner, member, descriptor), "round trip for `{key}`");
    }
}

/// `is_foreign_key` and `split_key` must not disagree about what they accept.
///
/// A key the first calls foreign and the second cannot split is a call that
/// passes the upstream guard and then has nothing downstream to emit -- the
/// gap between two checks, which is where a refusal goes missing.
#[test]
fn the_two_guards_accept_the_same_keys() {
    let keys = [
        "com/example/Catalog.find:(I)I",
        "java/util/List.get:(I)Ljava/lang/Object;",
        "android/view/View.setOnTouchListener:(Landroid/view/View$OnTouchListener;)V",
    ];
    for key in keys {
        assert!(nts_core::hir::runtime::is_foreign_key(key), "{key}");
        assert!(nts_jvm_emitter::bind::split_key(key).is_some(), "{key}");
    }

    // And the runtime helpers, which are the other thing a `Callee::External`
    // can be, must be rejected by both -- or a helper name would be taken for a
    // Java member and emitted as an invoke against a class that does not exist.
    for helper in ["nts_array_set_length", "nts_string_concat", "nts_map_next"] {
        assert!(!nts_core::hir::runtime::is_foreign_key(helper), "{helper}");
        assert!(nts_jvm_emitter::bind::split_key(helper).is_none(), "{helper}");
    }
}

/// The case that tells `rsplit_once` from `split_once`, and the reason the
/// splitter uses the former.
///
/// Added after a sabotage run found the original cases could not tell them
/// apart: a *binary* owner separates packages with `/`, so `owner.member` holds
/// exactly one dot and both splits agree on every well-formed key. The
/// justification comment claimed otherwise for an hour.
///
/// A **source-form** owner is where they differ. It is malformed input rather
/// than something `foreign_key` produces, but splitting from the left turns it
/// into two plausible-looking strings -- owner `com`, member
/// `example.Catalog.find` -- and an invoke against a class that does not exist.
#[test]
fn a_source_form_owner_keeps_its_member() {
    let (owner, member, descriptor) =
        nts_jvm_emitter::bind::split_key("com.example.Catalog.find:(I)I").expect("splits");
    assert_eq!(member, "find", "the member must survive a source-form owner");
    assert_eq!(owner, "com.example.Catalog");
    assert_eq!(descriptor, "(I)I");
}

/// The escape table's keys are the same keys, built a third way.
///
/// `escapes::table` writes `format!("{}.{}:{}", binary_name, name, descriptor)`
/// by hand, because `nts-jvm-emitter` cannot call `foreign_key` -- it has no
/// dependency on HIR, deliberately. So the format now has three derivations:
/// upstream's builder, this crate's splitter, and that formatter.
///
/// **The consequence if they drift is silent and costs only speed**, which is
/// the worst kind. `foreign_keeps` returns `None` for a key it does not
/// recognise, and `None` means "assume every argument escapes" -- always
/// correct, never wrong, just pessimistic. A mis-built key would therefore
/// produce a program that works and is slower, with nothing failing anywhere.
/// `runtime.rs` says exactly this about the lookup and it is why the assertion
/// belongs here rather than in a comment.
#[test]
fn the_escape_table_builds_the_same_key() {
    let Some(ui) = fixture_classes() else {
        eprintln!("SKIP foreign_key_format: no android-shape fixture");
        return;
    };
    let bytes = std::fs::read(ui.join("com/example/ui/Widget.class")).expect("Widget");
    let class = nts_jvm_emitter::read::class_file(&bytes).expect("parses");
    let rows = nts_jvm_emitter::escapes::table(&class);
    assert!(!rows.is_empty(), "the fixture must produce escape rows, or this asserts nothing");

    for (key, _) in &rows {
        let (owner, member, descriptor) = nts_jvm_emitter::bind::split_key(key)
            .unwrap_or_else(|| panic!("the escape table built `{key}`, which does not split"));
        // And it must equal what upstream would have built from the same parts.
        assert_eq!(
            *key,
            nts_core::hir::runtime::foreign_key(owner, member, descriptor),
            "the escape table and `foreign_key` disagree"
        );
        assert!(nts_core::hir::runtime::is_foreign_key(key), "`{key}` is not recognised");
    }
}

/// Compile the android-shape fixture's sources, and return where they landed.
///
/// **From the committed sources rather than from `target/classes`.** The first
/// version pointed at the build output, which exists on my machine because I
/// had just run `build.sh` and does not exist in a clean checkout -- so the
/// test would have skipped silently wherever nobody had built it first, which
/// is every gate run in a fresh worktree. A test that asserts nothing and says
/// `ok` is the failure this whole file is about.
///
/// Same shape as `reads.rs`'s `android_shape`: javac over checked-in `.java`,
/// so the only thing it depends on beyond the repository is a JDK.
fn fixture_classes() -> Option<std::path::PathBuf> {
    static BUILT: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
    BUILT
        .get_or_init(|| {
            let home = std::env::var("JAVA_HOME").ok()?;
            let javac = std::path::Path::new(&home).join("bin/javac");
            if !javac.exists() {
                return None;
            }
            let sources = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../examples/interop/android-shape/java/com/example/ui");
            if !sources.exists() {
                return None;
            }
            let out = std::env::temp_dir().join(format!("nts-fkf-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&out);
            std::fs::create_dir_all(&out).ok()?;
            let files: Vec<std::path::PathBuf> = std::fs::read_dir(&sources)
                .ok()?
                .filter_map(|it| it.ok().map(|e| e.path()))
                .filter(|p| p.extension().is_some_and(|e| e == "java"))
                .collect();
            let built = std::process::Command::new(&javac)
                .args(["--release", "8", "-nowarn", "-d"])
                .arg(&out)
                .args(&files)
                .output()
                .ok()?;
            built.status.success().then_some(out)
        })
        .clone()
}
