//! ARC's ownership rules, on both backends, against a stub Objective-C runtime.
//!
//! `examples/interop/macos-foundation` checks the same rules against Apple's
//! Foundation on a Mac. This file checks them wherever the gate runs, with a
//! runtime small enough to count every retain and release per object:
//!
//! - `+new` and `-copy` hand over an object (+1), released once when the last
//!   TypeScript reference dies;
//! - `-child` lends one (+0) the receiver owns, retained while held and given
//!   back, never freed by the program;
//! - `-init` consumes its receiver and hands over a different object;
//! - an object held in a field of a heap object, or captured by a closure, is
//!   released when that object dies (the descriptor's foreign slots);
//! - under `NoGc` nothing is released (the control: the same program, one
//!   variable).
//!
//! What a stub cannot see is the autorelease pool, since it has none. The
//! Mac fixture asserts an empty stderr for that.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

const BINDING: &str = r#"
declare module "objc:Stub" {
  import type { ObjcClass } from "objc:types";
  export interface ThingOwnMethods {
    /**
     * @ntsSelector copy
     */
    copy(this: Thing): Thing;
    /**
     * @ntsSelector child
     */
    child(this: Thing): Thing;
    /**
     * @ntsSelector init
     */
    init(this: Thing): Thing;
    /**
     * @ntsSelector touch
     */
    touch(this: Thing): void;
  }
  export type Thing = ObjcClass<"Thing"> & ThingOwnMethods;
  /**
   * @ntsSelector new
   * @ntsClass Thing
   */
  export function newThing(): Thing;
  /**
   * @ntsSelector alloc
   * @ntsClass Thing
   */
  export function allocThing(): Thing;
}
"#;

const PROGRAM: &str = r#"
import { allocThing, newThing, type Thing } from "objc:Stub";

// Held past a call that could free it, so a missing retain is a
// use-after-free the stub catches rather than a lucky read.
function use(thing: Thing): void {
  thing.touch();
}

// Returned, so it lives on the heap, and its field is the only reference to
// its thing. When the holder dies, its descriptor has to give the thing up.
class Holder {
  constructor(public thing: Thing) {}
}
function holding(): Holder {
  return new Holder(newThing());
}

// The closure's environment is the only reference to `captured`.
function capturing(): () => void {
  const captured = newThing();
  return () => captured.touch();
}

export function run(): number {
  const a = newThing();
  const b = a.copy();
  const c = a.child();
  const d = allocThing().init();
  use(c);
  use(b);
  use(d);
  use(a);
  const holder = holding();
  use(holder.thing);
  const touch = capturing();
  touch();
  return 0;
}
"#;

/// Objects with counts. `objc_msgSend` is called through casts to exactly
/// `void *(const void *, void *)`, which is what every send here is, so the
/// stub defines that and nothing variadic.
const STUB: &str = r#"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Thing { int count; int freed; int id; struct Thing *child; } Thing;
static Thing things[32];
static int made;
static int class_token;

static Thing *make(void) {
  if (made == 32) abort();
  Thing *thing = &things[made];
  thing->count = 1;
  thing->id = made++;
  return thing;
}

void *sel_registerName(const char *name) { return (void *)name; }
void *objc_getRequiredClass(const char *name) { (void)name; return &class_token; }

void *objc_retain(void *object) {
  Thing *thing = object;
  if (thing->freed) { fprintf(stderr, "retain of freed %d\n", thing->id); abort(); }
  thing->count++;
  return object;
}

void objc_release(void *object) {
  Thing *thing = object;
  if (thing->freed || thing->count <= 0) { fprintf(stderr, "over-release of %d\n", thing->id); abort(); }
  if (--thing->count == 0) {
    thing->freed = 1;
    if (thing->child) objc_release(thing->child);
  }
}

void *objc_msgSend(void *receiver, const char *selector) {
  if (receiver == &class_token) {
    if (!strcmp(selector, "new") || !strcmp(selector, "alloc")) return make();
    abort();
  }
  Thing *thing = receiver;
  if (thing->freed) { fprintf(stderr, "%s sent to freed %d\n", selector, thing->id); abort(); }
  if (!strcmp(selector, "copy")) return make();
  if (!strcmp(selector, "child")) {
    if (!thing->child) thing->child = make();
    return thing->child;
  }
  if (!strcmp(selector, "init")) {
    Thing *replacement = make();
    objc_release(thing);
    return replacement;
  }
  if (!strcmp(selector, "touch")) return 0;
  abort();
}

/* How many objects are still alive, and whether every one the program owned
 * is gone. `child` is never the program's, and dies with its parent. */
int stub_alive(void) {
  int alive = 0;
  for (int at = 0; at < made; at++) alive += !things[at].freed;
  return alive;
}
int stub_made(void) { return made; }
"#;

const CALLER: &str = r#"
#include <stdio.h>
#include "program.h"
int stub_alive(void);
int stub_made(void);
int main(void) {
  run();
  printf("%d %d\n", stub_made(), stub_alive());
  return 0;
}
"#;

fn prepare(name: &str, provider: hir::Provider) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
    let dir = root.join(format!("target/objc-arc-tests/{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","stub.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/objc/objc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("stub.d.ts"), BINDING).unwrap();
    std::fs::write(dir.join("main.ts"), PROGRAM).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare_with(&snapshot, &hir::Options { provider, ..hir::Options::default() }).unwrap()))
}

fn clang(dir: &Utf8Path, args: &[&str]) {
    let result = Command::new("clang").current_dir(dir).args(args).output().unwrap();
    assert!(result.status.success(), "{args:?}: {}", String::from_utf8_lossy(&result.stderr));
}

/// `(objects made, objects still alive)` after `run()`, per backend.
fn made_and_alive(provider: hir::Provider, label: &str) -> Option<Vec<(String, u32, u32)>> {
    let (dir, prepared) = prepare(label, provider)?;
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("stub.c"), STUB).unwrap();
    std::fs::write(dir.join("caller.c"), CALLER).unwrap();
    let counted: &[&str] = if provider == hir::Provider::ReferenceCounting { &["-DNTS_PROVIDER_RC"] } else { &[] };
    clang(&dir, &["-std=c11", "-O2", "-Wall", "-Werror", "-c", "stub.c", "caller.c"]);
    clang(&dir, &[&["-std=c11", "-O2", "-c", "nts_runtime.c"][..], counted].concat());
    let mut answers = Vec::new();
    for (source, object, executable) in [("program.c", "c.o", "c-run"), ("program.ll", "llvm.o", "llvm-run")] {
        clang(&dir, &[&["-O2", "-Wno-override-module", "-c", source, "-o", object][..], counted].concat());
        clang(&dir, &[object, "stub.o", "caller.o", "nts_runtime.o", "-lm", "-o", executable]);
        let run = Command::new(dir.join(executable)).output().unwrap();
        assert!(
            run.status.success(),
            "{label}/{executable} aborted: {}",
            String::from_utf8_lossy(&run.stderr)
        );
        let text = String::from_utf8_lossy(&run.stdout).into_owned();
        let mut numbers = text.split_whitespace().map(|n| n.parse::<u32>().unwrap());
        answers.push((executable.to_owned(), numbers.next().unwrap(), numbers.next().unwrap()));
    }
    Some(answers)
}

#[test]
fn every_object_the_program_owns_is_released_once_on_both_backends() {
    let Some(counted) = made_and_alive(hir::Provider::ReferenceCounting, "rc") else {
        eprintln!("skipped: no tsgo");
        return;
    };
    // `new`, `copy`, `child`, `alloc`, the object `init` returns, the
    // holder's and the closure's: seven. All gone, `child` with its parent.
    // No abort means no object was retained after it was freed, released
    // below zero, or sent a message after it died.
    for (backend, made, alive) in &counted {
        assert_eq!(*made, 7, "{backend}: the program made {made} objects, not 7");
        assert_eq!(*alive, 0, "{backend}: {alive} object(s) outlived the program's last reference");
    }
    // The control: the same program with nothing counted. `alloc`'s object is
    // still consumed by `init` (the stub's `init` releases it), so six live on.
    let Some(uncounted) = made_and_alive(hir::Provider::NoGc, "nogc") else { return };
    for (backend, made, alive) in &uncounted {
        assert_eq!(*made, 7, "{backend}");
        assert_eq!(*alive, 6, "{backend}: under NoGc {alive} object(s) are alive, where nothing releases them but init");
    }
}

/// What ARC reserves, and a claim of ownership nothing would honour, are
/// refused where the declaration is read.
#[test]
fn arc_reserved_selectors_and_uncounted_ownership_are_refused() {
    let cases = [
        (
            "    /**\n     * @ntsSelector release\n     */\n    release(this: Thing): void;",
            "import { newThing } from \"objc:Stub\";\nexport function run(): number { newThing().release(); return 0; }\n",
            "`release` sent to an Objective-C object the program counts",
        ),
        (
            "",
            "import { makePlain } from \"objc:Stub\";\nexport function run(): number { makePlain(); return 0; }\n",
            "declare its class with `ObjcClass`",
        ),
    ];
    for (at, (method, program, expected)) in cases.into_iter().enumerate() {
        let binding = BINDING
            .replace("    touch(this: Thing): void;\n", &format!("    touch(this: Thing): void;\n{method}\n"))
            .replace(
                "  export type Thing = ObjcClass",
                "  export type Plain = import(\"c:types\").Class<\"Plain\">;\n  /**\n   * @ntsSelector new\n   * @ntsClass Plain\n   */\n  export function makePlain(): Plain;\n  export type Thing = ObjcClass",
            );
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else { return };
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
        let dir = root.join(format!("target/objc-arc-tests/{}-refuse-{at}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(
                r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","stub.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/objc/objc.d.ts"]}}"#
            ),
        )
        .unwrap();
        std::fs::write(dir.join("stub.d.ts"), binding).unwrap();
        std::fs::write(dir.join("main.ts"), program).unwrap();
        let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = hir::prepare(&snapshot).unwrap();
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(expected)),
            "no refusal saying `{expected}`: {:?}",
            prepared.diagnostics
        );
    }
}
