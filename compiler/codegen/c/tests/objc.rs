//! Objective-C message sends (`@ntsSelector`): what lowering refuses, and the C
//! a send becomes.
//!
//! Nothing here needs a Mac. The emitted program declares the three runtime
//! entry points itself rather than including `<objc/runtime.h>`, so it
//! compiles on any host; linking and running it is
//! `examples/interop/macos-foundation`'s job, against a C oracle on the lane's
//! VM.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

/// A program whose binding is an ambient declaration file of its own, the way
/// a real one is. See `native.rs`'s helper of the same name for why.
fn prepare(name: &str, binding: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = root.join(format!("target/objc-c-tests/{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

/// A binding with one class method and two instance methods. `{extra}` is
/// spliced into `NSStringOwnMethods` for the refusal cases.
fn binding(extra: &str, functions: &str) -> String {
    format!(
        r#"/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {{
  import type {{ Class, c_ulong }} from "c:types";
  export interface NSStringOwnMethods {{
    /**
     * @ntsSelector length
     */
    length(this: NSString): c_ulong;
    /**
     * @ntsSelector stringByAppendingString:
     */
    stringByAppendingString(this: NSString, other: NSString): NSString;
{extra}
  }}
  export type NSString = Class<"NSString"> & NSStringOwnMethods;
  /**
   * @ntsSelector stringWithUTF8String:
   * @ntsClass NSString
   */
  export function stringWithUTF8String(text: string): NSString;
{functions}
}}
"#
    )
}

const PROGRAM: &str = r#"import { stringWithUTF8String } from "objc:Foundation";
export function run(): bigint {
  const a = stringWithUTF8String("a");
  return a.stringByAppendingString(a).length() as bigint;
}
"#;

#[test]
fn a_message_is_a_typed_cast_of_objc_msg_send() {
    let Some((dir, prepared)) = prepare("send", &binding("", ""), PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let program = &prepared.program;
    assert!(program.objc, "a program that sends a message links libobjc");
    assert_eq!(program.native_frameworks, ["Foundation"]);

    let emitted = nts_codegen_c::emit(program);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    // The class method: the class object, the selector, and the C string, in
    // one cast with exactly those three parameter types.
    assert!(
        text.contains("((void * (*)(struct objc_class *, struct objc_selector *, const void *))objc_msgSend)(nts_objc_class_NSString(), nts_objc_sel_stringWithUTF8String_c(), "),
        "no typed class send:\n{text}"
    );
    // An instance method with an object argument, and one with none, whose
    // result is `NSUInteger`.
    assert!(
        text.contains("((void * (*)(const void *, struct objc_selector *, const void *))objc_msgSend)(")
            && text.contains("nts_objc_sel_stringByAppendingString_c()"),
        "no typed instance send with an argument:\n{text}"
    );
    assert!(
        text.contains("((unsigned long (*)(const void *, struct objc_selector *))objc_msgSend)("),
        "no typed send returning NSUInteger:\n{text}"
    );
    // **Never variadic.** The name appears in its one declaration, and
    // otherwise only as the operand of a cast: `...))objc_msgSend)(`.
    let declaration = "extern void objc_msgSend(void);";
    assert_eq!(text.matches(declaration).count(), 1, "{text}");
    assert_eq!(
        text.matches("objc_msgSend").count(),
        1 + text.matches("))objc_msgSend)(").count(),
        "objc_msgSend used other than cast:\n{text}"
    );
    // A message is not a C symbol: neither the TypeScript names nor the
    // selectors become prototypes, and the witness has nothing to compare.
    for name in ["stringWithUTF8String(", " length(", "stringByAppendingString("] {
        assert!(!text.contains(&format!("extern {name}")) && !text.lines().any(|l| l.ends_with(';') && l.contains(name) && !l.contains("objc_msgSend")),
            "`{name}` was declared as a C function:\n{text}");
    }
    // The selector is registered with its colon, by the one lookup the cast
    // calls, and the class is required rather than looked up leniently.
    assert!(text.contains("sel_registerName(\"stringWithUTF8String:\")"), "{text}");
    assert!(text.contains("objc_getRequiredClass(\"NSString\")"), "{text}");
    assert!(!text.contains("#include <objc/"), "the runtime header was included:\n{text}");

    // And it is C: the file compiles on this host, which has no Objective-C
    // runtime headers at all -- which is the point of declaring them.
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), text).unwrap();
    let cc = std::env::var("CC").unwrap_or_else(|_| "clang".to_owned());
    let compiled = Command::new(&cc)
        .args(["-std=c11", "-Wall", "-Werror", "-fsyntax-only"])
        .arg(dir.join("program.c"))
        .output();
    let Ok(compiled) = compiled else {
        eprintln!("skipped the compile: no {cc}");
        return;
    };
    assert!(
        compiled.status.success(),
        "the emitted program does not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
}

/// Each way a message declaration can be wrong is refused where it is read,
/// naming the fault, rather than sent and answered by
/// `unrecognized selector`.
#[test]
fn a_malformed_message_is_refused_by_name() {
    let cases: [(&str, &str, &str, &str); 5] = [
        (
            "arity",
            "    /**\n     * @ntsSelector substringFromIndex\n     */\n    substringFromIndex(this: NSString, from: c_ulong): NSString;",
            "a.substringFromIndex(1n as c_ulong);",
            "takes 0 argument(s) where the declaration passes 1",
        ),
        (
            "class-on-method",
            "    /**\n     * @ntsSelector uppercaseString\n     * @ntsClass NSString\n     */\n    uppercaseString(this: NSString): NSString;",
            "a.uppercaseString();",
            "@ntsClass on a method",
        ),
        (
            "symbol-and-selector",
            "    /**\n     * @ntsSelector uppercaseString\n     * @ntsSymbol CFStringUppercase\n     */\n    uppercaseString(this: NSString): NSString;",
            "a.uppercaseString();",
            "both an Objective-C message",
        ),
        (
            "spelling",
            "    /**\n     * @ntsSelector upper:case:String\n     */\n    upperCase(this: NSString, a: c_ulong): NSString;",
            "a.upperCase(1n as c_ulong);",
            "@ntsSelector names one selector",
        ),
        (
            "no-receiver",
            "",
            "",
            "an Objective-C message with no receiver",
        ),
    ];
    for (name, method, call, expected) in cases {
        let functions = if name == "no-receiver" {
            "  /**\n   * @ntsSelector new\n   */\n  export function orphan(): NSString;"
        } else {
            ""
        };
        let call = if name == "no-receiver" { "orphan();" } else { call };
        let import = if name == "no-receiver" { ", orphan" } else { "" };
        let source = format!(
            "import {{ stringWithUTF8String{import} }} from \"objc:Foundation\";\n\
             import type {{ c_ulong }} from \"c:types\";\n\
             export function run(): void {{\n  const a = stringWithUTF8String(\"a\");\n  {call}\n}}\n"
        );
        let Some((_, prepared)) = prepare(&format!("refuse-{name}"), &binding(method, functions), &source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(expected)),
            "{name}: no refusal saying `{expected}`: {:?}",
            prepared.diagnostics
        );
    }
}

/// A TypeScript closure passed where Objective-C takes a block: a stack block
/// in the caller's frame, one invoke adapter and one descriptor for its
/// signature, and copy and dispose helpers that check the thread before they
/// touch the closure's count.
#[test]
fn a_closure_crosses_as_a_stack_block() {
    let binding = r#"/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { c_int } from "c:types";
  import type { Block, ObjcClass } from "objc:types";
  export interface NSThingOwnMethods {
    /**
     * @ntsSelector each:
     */
    each(this: NSThing, block: Block<(n: c_int) => void>): void;
  }
  export type NSThing = ObjcClass<"NSThing"> & NSThingOwnMethods;
  /**
   * @ntsSelector new
   * @ntsClass NSThing
   */
  export function newThing(): NSThing;
}
"#;
    let program = r#"import { newThing } from "objc:Foundation";
export function run(): number {
  let seen = 0;
  newThing().each((n) => { seen += n; });
  return seen;
}
"#;
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
    let dir = root.join(format!("target/objc-c-tests/{}-block", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/objc/objc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(dir.join("main.ts"), program).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for expected in [
        "struct nts_block {",
        "extern void *_NSConcreteStackBlock[32];",
        // The block's own signature, as clang encodes `void (^)(int)`.
        "\"v12@?0i8\"",
        // Copy and dispose check the thread before touching the count.
        "nts_block_on_owner(\"copied\");",
        "nts_block_on_owner(\"released\");",
        // The adapter reads the bridge and the context out of the block.
        "b->bridge)(a0, b->context);",
        // `BLOCK_HAS_COPY_DISPOSE | BLOCK_HAS_SIGNATURE` on a stack block.
        "_block.flags = (1 << 25) | (1 << 30);",
        "_block.isa = _NSConcreteStackBlock;",
    ] {
        assert!(text.contains(expected), "no `{expected}`:\n{text}");
    }
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), text).unwrap();
    let cc = std::env::var("CC").unwrap_or_else(|_| "clang".to_owned());
    let Ok(compiled) = Command::new(&cc)
        .args(["-std=c11", "-Wall", "-Werror", "-fsyntax-only"])
        .arg(dir.join("program.c"))
        .output()
    else {
        eprintln!("skipped the compile: no {cc}");
        return;
    };
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}
