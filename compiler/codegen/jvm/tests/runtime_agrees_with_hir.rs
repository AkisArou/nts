//! Every runtime name this lane can render resolves to a method the jar has.
//!
//! `hir::runtime::declared_names` is the single answer about what a
//! `Callee::External` can be. This lane answers a *subset* of them -- the rest
//! are refused by name, which is the contract -- and the question this file
//! exists to ask is whether the ones it claims to answer are real.
//!
//! **The gap it closes was found the expensive way.** The mapping had no entry
//! for `nts_array_set_length` while `runtime/jvm` had the Java method, so the
//! lane refused a call it could have rendered. Nothing failed until another
//! session's lowering started emitting it, and then the failure was in *their*
//! gate step. A typo in a descriptor is worse again: it resolves here and dies
//! as `NoSuchMethodError` when the class is finally run.
//!
//! Two directions, and they catch different things. A name that maps to a
//! method the jar does not have is a typo. A name the jar *does* have a method
//! for but the mapping cannot reach is the `set_length` shape -- capability
//! that exists and is unreachable, which no other test in this crate looks for.

use std::collections::BTreeSet;
use std::process::Command;

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().expect("root")
}

fn tool(name: &str) -> Option<std::path::PathBuf> {
    let home = std::env::var("JAVA_HOME").ok()?;
    let at = std::path::Path::new(&home).join("bin").join(name);
    at.exists().then_some(at)
}

/// Every `owner.method:descriptor` the runtime jar publishes, read back with
/// `javap` rather than from a list in this file -- a list would be a second
/// copy of the jar's contents and would go stale in the quiet direction.
fn published() -> Option<BTreeSet<String>> {
    let javap = tool("javap")?;
    let jar = root().join("runtime/jvm/nts-runtime.jar");
    // **Enumerated from the jar, not listed here.** The first version of this
    // file hardcoded six class names, and the test's own doc comment two
    // paragraphs up says why that is wrong -- a list is a second copy of the
    // jar's contents. It reported sixteen missing methods on its first run,
    // every one of them in a class the list did not mention. The instrument
    // found itself before it found anything else.
    let listing = Command::new(tool("jar")?).args(["--list", "--file"]).arg(&jar).output().ok()?;
    let names = String::from_utf8_lossy(&listing.stdout).into_owned();
    let classes: Vec<String> = names
        .lines()
        .filter_map(|line| line.strip_suffix(".class"))
        .map(|line| line.replace('/', "."))
        .collect();
    let mut out = BTreeSet::new();
    for class in &classes {
        let listing = Command::new(&javap)
            .args(["-p", "-s", "-cp"])
            .arg(&jar)
            .arg(class.as_str())
            .output()
            .ok()?;
        if !listing.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&listing.stdout).into_owned();
        // `javap -s` prints the member, then `descriptor: (..)V` beneath it.
        let mut member: Option<String> = None;
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(descriptor) = trimmed.strip_prefix("descriptor: ") {
                if let Some(name) = member.take() {
                    out.insert(format!("{}.{name}:{descriptor}", class.replace('.', "/")));
                }
            } else if trimmed.ends_with(");") {
                // `public static void setLength(nts.rt.NtsArrayD, double);`
                //
                // **Requires the parenthesis.** Without it this also matched
                // `public static final double[] EMPTY;` and counted a field as
                // an unreachable helper, which is how the first floor came back
                // at 64 with fields in it.
                let head = trimmed.split('(').next().unwrap_or("");
                member = head.rsplit_once(' ').map(|(_, name)| name.to_owned());
            }
        }
    }
    Some(out)
}

#[test]
fn every_name_this_lane_renders_names_a_method_the_jar_has() {
    let Some(published) = published() else {
        eprintln!("SKIP runtime_agrees_with_hir: no JAVA_HOME/javap");
        return;
    };
    assert!(
        published.len() > 50,
        "the listing read {} members, which is too few to be the real jar -- the parse is \
         probably wrong, and a parse that finds nothing makes every assertion below vacuous",
        published.len()
    );

    // The array helpers need to be told what the array holds; the name alone
    // does not say. Trying each is what a call site does, one width at a time.
    let resolve = |name: &str| -> Vec<(String, String)> {
        let mut found = Vec::new();
        if let Some((owner, method, descriptor)) = nts_codegen_jvm::ops::external(name) {
            found.push((format!("{owner}.{method}:{descriptor}"), "external".to_owned()));
        }
        for holds in ["D", "Z", "L"] {
            if let Some((owner, method, descriptor)) =
                nts_codegen_jvm::ops::growable_external(name, holds)
            {
                found.push((format!("{owner}.{method}:{descriptor}"), format!("growable/{holds}")));
            }
            if let Some((owner, method, descriptor)) =
                nts_codegen_jvm::ops::array_external(name, holds)
            {
                found.push((format!("{owner}.{method}:{descriptor}"), format!("array/{holds}")));
            }
        }
        found
    };

    let mut rendered = 0usize;
    let mut refused = 0usize;
    let mut typos: Vec<String> = Vec::new();
    let mut reached: BTreeSet<String> = BTreeSet::new();
    for name in nts_core::hir::runtime::declared_names() {
        let found = resolve(name);
        if found.is_empty() {
            refused += 1;
            continue;
        }
        rendered += 1;
        // **At least one, not all of them.** Asking whether *every* width
        // resolves to a real method asks more than the contract: the helpers
        // take a width the name does not carry, so `resolve` tries all three
        // and some combinations -- `arrayAt` on a boolean array answering a
        // double -- are shapes no lowering emits. Requiring all of them
        // reported eighteen failures, none of them real. A typo, which is what
        // this direction is for, makes *none* of the widths land.
        let real: Vec<&(String, String)> =
            found.iter().filter(|(member, _)| published.contains(member)).collect();
        if real.is_empty() {
            typos.push(format!(
                "{name} -> {}",
                found.iter().map(|(m, _)| m.as_str()).collect::<Vec<_>>().join(", ")
            ));
        }
        for (member, _) in real {
            reached.insert(member.clone());
        }
    }

    assert!(
        typos.is_empty(),
        "{} name(s) map to no method the runtime jar publishes, at any width:\n  {}",
        typos.len(),
        typos.join("\n  ")
    );

    // **The other direction, and the one that would have caught `set_length`.**
    //
    // Not "which jar methods does no name reach" -- that was tried and measures
    // the wrong population. The backend reaches a helper two ways: through this
    // external table, and through the op lowering, where `ArrayGet` becomes
    // `NtsArrayD.get` with no `nts_` name involved at all. From the jar those
    // are indistinguishable, so the count came back at 28 with `get`, `set` and
    // `count` in it, every one of them wired up perfectly well.
    //
    // The population that *is* visible from here is the names `hir` declares
    // and this lane cannot render. `nts_array_set_length` sat in that set from
    // the moment `hir::runtime` gained the name until another session's
    // lowering emitted it -- so a floor over this number is the instrument that
    // would have spoken first, in my crate rather than in their gate step.
    //
    // It may fall and it may not rise, which means a new runtime helper reds
    // this test until this lane maps it. That is deliberate: the alternative is
    // the lane quietly refusing a call it could render.
    eprintln!("runtime_agrees_with_hir: {rendered} rendered, {refused} refused by name");
    assert!(
        rendered >= 1,
        "this lane rendered no runtime names at all, which means `resolve` is broken rather \
         than the lane being empty"
    );
    assert!(
        refused <= REFUSED_FLOOR,
        "this lane now refuses {refused} runtime names by name, was {REFUSED_FLOOR}. A new \
         helper in `hir::runtime` with no entry in `ops::external` is a call this backend \
         could render and declines to -- add the mapping, or lower the floor if the refusal \
         is deliberate."
    );
}

/// Runtime names `hir` declares that this lane cannot render.
///
/// Measured, not chosen. Most are deliberate -- `Date`, `RegExp` and the
/// generator helpers are refused on every backend -- and the rest are the
/// queue. It may fall; it may not rise.
///
/// 75 since the C-boundary helpers: `nts_string_to_cstring`,
/// `nts_cstring_release` and the `nts_closure_*` three exist to hand a string
/// or a closure to a C function, and this lane refuses native calls outright,
/// so it has no call that could reach them. Deliberate, and not the queue.
const REFUSED_FLOOR: usize = 75;
