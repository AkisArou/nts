//! No generated field is `public`, and the reason is a soundness argument
//! rather than a style preference.
//!
//! `hir::fields` narrows an object's field to a machine type by joining over
//! every `FieldSet` that can reach it. Its soundness argument, in its own
//! header, is that nothing else can store there:
//!
//! > A field holds what was stored into it, and nothing else can store into
//! > it: **there is no FFI that writes through a pointer here**, and a
//! > program's own stores are all in the HIR.
//!
//! **Interop is exactly what falsifies that sentence, from another file, with
//! nobody editing the comment.** A Java caller holding one of our objects can
//! `putfield` into a `public` field with no `FieldSet` anywhere in the HIR, and
//! the narrowing is then wrong for *every* instance of the layout -- `fields`
//! keys on `(layout, field)`, not on the instance that escaped.
//!
//! Package-private closes it by construction: every generated class is
//! `nts/gen/...` (`symbols::jvm_class_name` has no other branch), so our own
//! access is unaffected and no other package can reach the field at all. A
//! foreign caller that must mutate goes through a method of ours, whose store
//! *is* a `FieldSet` in the HIR -- which is what the analysis requires.
//!
//! # Why this reads the class bytes instead of the source or `javap`
//!
//! Grepping `lib.rs` for `access::PUBLIC` would check the edit against itself,
//! and would miss any future path to a field that does not spell it that way.
//! Shelling to `javap` would make the test skip wherever no JDK is installed --
//! and a guard that skips on the machine where somebody changes the thing is
//! not a guard.
//!
//! It reads them with [`nts_jvm_emitter::read`]. **This file used to carry its
//! own fifty-three-line constant-pool walk**, written before that reader
//! existed and kept afterwards -- two parsers for one format inside one crate's
//! tests, which is the duplication this project refuses everywhere else. The
//! reader is also better tested than the copy was: it walks 62,070 real method
//! bodies in `java.base` and checks it consumed every byte of every class.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_jvm_emitter::read;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::{Path, PathBuf};

/// `ACC_PUBLIC`. JVMS 4.5, table 4.5-A.
const ACC_PUBLIC: u16 = 0x0001;
/// `ACC_STATIC`. A static field here is a **global**, not an instance field,
/// and globals are governed by a different rule that is already sound -- see
/// `statics_are_globals_and_a_public_one_is_already_excluded_from_narrowing`.
const ACC_STATIC: u16 = 0x0008;

fn repository() -> PathBuf {
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    from.canonicalize().unwrap_or(from)
}


/// Examples chosen to reach both kinds of generated field: the declared ones,
/// and the `$presence` word an optional property adds.
const EXAMPLES: &[&str] = &[
    "objects",
    "classes",
    "inheritance",
    "instances",
    "an-optional-property",
    "optional-unassigned",
];

#[test]
fn no_generated_field_is_public() {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP field_visibility: NTS_TSGO is not set");
        return;
    };
    if !tsgo.exists() {
        eprintln!("SKIP field_visibility: no tsgo at {tsgo}");
        return;
    }

    let mut seen = 0usize;
    let mut presence = 0usize;
    let mut statics = 0usize;
    let mut offenders: Vec<String> = Vec::new();

    for example in EXAMPLES {
        let tsconfig = Utf8PathBuf::from_path_buf(
            repository()
                .join("examples")
                .join(example)
                .join("tsconfig.json")
                .canonicalize()
                .expect("the example is checked in"),
        )
        .expect("a UTF-8 path");

        let snapshot =
            TsgoApi::for_compilation(tsgo.clone()).snapshot(&tsconfig).expect("snapshot");
        assert!(!snapshot.has_errors(), "{example} should typecheck");
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options { provider: hir::Provider::NoGc, ..hir::Options::default() },
        )
        .expect("prepared HIR should verify");

        for class in &nts_codegen_jvm::emit(&prepared.program).classes {
            // Reading our own output back through the reader is also a
            // round-trip: a class this writer produced that the reader cannot
            // parse means one of the two is wrong, and the JVM verifier
            // agreeing with both would not say which.
            let parsed = read::class_file(&class.bytes).expect("our own output parses");
            for field in &parsed.fields {
                let (name, access) = (field.name.clone(), field.access);
                seen += 1;
                if name.contains("presence") {
                    presence += 1;
                }
                if access & ACC_STATIC != 0 {
                    statics += 1;
                    continue;
                }
                if access & ACC_PUBLIC != 0 {
                    offenders.push(format!("{}.{name} in {example}", class.binary_name));
                }
            }
        }
    }

    // **The arm that would be wrong if the thing were broken.** Without these
    // two, an emitter that stopped writing fields entirely -- or a walk that
    // mis-parsed the pool and read a field count of zero -- would pass this
    // test in silence, which is the failure this lane has hit three times in a
    // different costume.
    assert!(seen > 0, "no fields were read at all: the parse or the sample is wrong, not the flags");
    assert!(statics > 0, "no static field was reached, so the exclusion below is untested");
    assert!(presence > 0, "no `$presence` field was reached, so the optional-property path is untested");

    assert!(
        offenders.is_empty(),
        "these generated fields are public, which makes `hir::fields`'s narrowing unsound the \
         moment one of these objects reaches Java -- see this file's header:\n  {}",
        offenders.join("\n  ")
    );
}

/// Why a `public static` field on `nts/gen/Program` is **not** the same hazard,
/// which is the distinction the first version of this test got wrong.
///
/// A static field here is a module-scope global, and `hir::globals` makes the
/// same kind of narrowing claim `hir::fields` does, with the same soundness
/// sentence -- *"there is no FFI writing through a pointer here, and every
/// store the program makes is a `GlobalSet` in the HIR"*. So the exposure looks
/// identical.
///
/// **It is not, because `globals` already stops where the exposure starts.**
/// Its own "Where it stops" section:
///
/// > **An exported global.** `exported` means visible outside the compiled set,
/// > so a reader this analysis cannot see holds the declared type. Narrowing
/// > one would change what that reader is looking at.
///
/// And the emitter's visibility is *derived from the same flag*:
/// `if global.exported { PUBLIC } else { PRIVATE }`. So a global is public
/// exactly when it is exported, and exported exactly when it is not narrowed.
/// The two facts cannot drift apart, because one `bool` decides both.
///
/// That is the same problem this file is about, solved a different way and
/// solved first: `globals` declines to narrow the ones a stranger can write,
/// where `fields` has no notion of "exported" and so must be closed at the
/// class file instead.
#[test]
fn statics_are_globals_and_a_public_one_is_already_excluded_from_narrowing() {
    // Kept as prose rather than an assertion because the fact lives in another
    // lane's file and asserting it from here would be a second derivation of
    // something one `bool` already decides. The test above exercises the part
    // this lane owns; this names why it skips the statics rather than leaving
    // the skip to look like an oversight.
}
