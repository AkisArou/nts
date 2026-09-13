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
