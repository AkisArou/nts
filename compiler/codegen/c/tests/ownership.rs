//! Who owes a reference on the way out of a method, when the caller cannot see
//! which method it called.
//!
//! `own::Summaries::hands_back` means "the caller is holding this already, so I
//! owe nothing on the way out", and a caller that reached the function through a
//! **dispatch slot** cannot know that: it sees one `Callee::Virtual` and several
//! possible bodies, some of which may hand a parameter back and some of which
//! return something fresh. So the convention has to be uniform, and the way to
//! make it uniform is to normalise the *callee*.
//!
//! The React lane found it under `--rc`: a virtual call to a `return this` method
//! stole a reference at every store, their GTK driver lost its root Box and
//! Button, and it surfaced as `GTK_IS_BUTTON failed` at the next checkpoint --
//! long after the store that caused it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// The C for `source`, compiled for reference counting.
fn counted(name: &str, source: &str) -> Option<String> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
    let dir = Utf8Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    let options = hir::Options {
        provider: hir::Provider::ReferenceCounting,
        ..hir::Options::default()
    };
    let prepared = hir::prepare_with(&snapshot, &options).unwrap();
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    Some(emitted.writer.text().to_owned())
}

/// One function's **definition** out of the emitted C, by name.
///
/// Line-wise, and the reason is that the first version was not: it took the first
/// occurrence of the name and then scanned forward for `) {`, which for a function
/// with a forward declaration found the *declaration* and then the body of whatever
/// came next. It reported `Leaf__self`'s retain as `attachDirect`'s, so the test
/// failed on a compiler that was right. A definition's header line ends with `{`
/// and a declaration's with `;`, which is the whole of the difference.
fn body(text: &str, name: &str) -> String {
    let wanted = format!("{name}(");
    let mut lines = text.lines().skip_while(|line| !(line.contains(&wanted) && line.ends_with('{')));
    let head = lines
        .next()
        .unwrap_or_else(|| panic!("no definition of `{name}` in the emitted C"));
    let mut out = String::from(head);
    for line in lines {
        out.push('\n');
        out.push_str(line);
        if line == "}" {
            break;
        }
    }
    out
}

/// A `return this` reached through a slot returns an **owned** reference.
///
/// Both call sites are then right without either knowing which body ran: the
/// callee retains, and neither caller does.
#[test]
fn a_method_returning_its_receiver_is_owned_when_a_table_holds_it() {
    let Some(text) = counted(
        "ownership-hands-back",
        r"
class Holder { child: Leaf | null = null; }
abstract class Base { abstract self(): Leaf | null; }
class Leaf extends Base { label = 'leaf'; override self(): Leaf | null { return this; } }
class Other extends Base { override self(): Leaf | null { return null; } }

function attachVirtual(holder: Holder, node: Base): void {
  const leaf = node.self();
  if (leaf !== null) { holder.child = leaf; }
}
function attachDirect(holder: Holder, node: Leaf): void {
  const leaf = node.self();
  if (leaf !== null) { holder.child = leaf; }
}
export function run(n: number): number {
  const holder = new Holder();
  const leaf = new Leaf();
  const node: Base = n > 0 ? leaf : new Other();
  attachVirtual(holder, node);
  attachDirect(holder, leaf);
  return holder.child === null ? -1 : holder.child.label.length;
}
",
    ) else {
        eprintln!("SKIP ownership: tsgo is required");
        return;
    };

    // The callee owes the reference now, because one of its callers cannot.
    assert!(
        body(&text, "Leaf__self").contains("nts_retain"),
        "`Leaf__self` hands back its receiver through a dispatch slot and must \
         retain it, or a virtual caller storing the result steals a reference; \
         its body is:{}",
        body(&text, "Leaf__self")
    );

    // And the direct caller must not retain as well, or the two together leak.
    // This is the half that says the fix is a *normalisation* rather than a
    // retain added at the virtual site.
    assert!(
        !body(&text, "attachDirect").contains("nts_retain"),
        "`attachDirect` must not retain what the callee now owns; its body is:{}",
        body(&text, "attachDirect")
    );

    // The control: the virtual site was always written as though the result were
    // owned, and that is now true rather than assumed.
    assert!(
        !body(&text, "attachVirtual").contains("nts_retain"),
        "the virtual site takes the result as owned; its body is:{}",
        body(&text, "attachVirtual")
    );
}

/// And a method that returns something **fresh** is untouched.
///
/// Without this arm the assertions above would pass on a compiler that retained
/// at every return, which leaks one reference per call.
#[test]
fn a_method_returning_a_fresh_object_still_owes_nothing_extra() {
    let Some(text) = counted(
        "ownership-fresh",
        r"
class Leaf { label = 'leaf'; }
abstract class Base { abstract make(): Leaf; }
class One extends Base { override make(): Leaf { return new Leaf(); } }
class Two extends Base { override make(): Leaf { return new Leaf(); } }
export function run(n: number): number {
  const base: Base = n > 0 ? new One() : new Two();
  return base.make().label.length;
}
",
    ) else {
        eprintln!("SKIP ownership: tsgo is required");
        return;
    };

    assert!(
        !body(&text, "One__make").contains("nts_retain"),
        "a freshly allocated result is already owned and must not be retained \
         again; its body is:{}",
        body(&text, "One__make")
    );
}
