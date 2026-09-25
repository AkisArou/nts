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
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/objc/objc.d.ts"]}}"#
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
  import type {{ CString }} from "objc:types";
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
  export function stringWithUTF8String(text: CString): NSString;
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

    let emitted = nts_codegen_c::emit(program, nts_core::hir::native::NativeAbi::SysV);
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
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for expected in [
        "struct nts_block {",
        "extern void *_NSConcreteStackBlock[32];",
        // The block's own signature, as clang encodes `void (^)(int)`.
        "\"v12@?0i8\"",
        // A copy checks the thread before touching the count; a release off
        // it is carried to it, as is a call.
        "nts_block_on_owner(\"copied\");",
        "if (!nts_is_owner_thread()) { nts_block_unlend(context); return; }",
        "nts_block_carry(block, &h, sizeof h, 0, 0u, nts_block_hop_",
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

const CLASSES: &str = r#"/**
 * @ntsFramework AppKit
 */
declare module "objc:AppKit" {
  import type { ObjcClass, ObjcMeta } from "objc:types";
  export type NSWindow = ObjcClass<"NSWindow">;
  export interface NSWindowStatics {
    /** @ntsSelector alloc */
    alloc(this: NSWindowMeta): NSWindow;
  }
  export type NSWindowMeta = ObjcMeta<"NSWindow"> & NSWindowStatics;
  export const NSWindow: NSWindowMeta;
  export const Misnamed: ObjcMeta<"not a class">;
}
declare module "c:elsewhere" {
  import type { ObjcMeta } from "objc:types";
  export const Stray: ObjcMeta<"NSWindow">;
}
"#;

/// `NSWindow` as a value is its class object: the cached, required lookup a
/// class send makes, so `NSWindow.alloc()` is a message to it. The module's
/// frameworks come with it.
#[test]
fn a_class_is_a_value_and_a_class_method_a_message_to_it() {
    let source = "import { NSWindow } from \"objc:AppKit\";\nexport function run(): void {\n  NSWindow.alloc();\n}\n";
    let Some((_, prepared)) = prepare("class-value", CLASSES, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let program = &prepared.program;
    assert!(program.objc, "a program that names a class links libobjc");
    assert_eq!(program.native_frameworks, ["AppKit"]);
    let emitted = nts_codegen_c::emit(program, nts_core::hir::native::NativeAbi::SysV);
    let text = emitted.writer.text();
    assert!(text.contains("objc_getRequiredClass(\"NSWindow\")"), "{text}");
    let lookup = text.lines().find(|line| line.contains("= nts_objc_class_NSWindow();")).unwrap_or_default();
    let value = lookup.trim().split(' ').next().unwrap_or_default().to_owned();
    assert!(
        !value.is_empty() && text.contains(&format!("objc_msgSend)({value}, nts_objc_sel_alloc())")),
        "alloc is not sent to the class value:\n{text}"
    );
}

/// Only a constant an `objc:` module declares is a class, and only one whose
/// brand names a class.
#[test]
fn a_class_value_is_declared_by_an_objc_module_with_a_class_name() {
    for (name, import, module, expected) in [
        ("stray", "Stray", "c:elsewhere", "an ambient constant holding a native handle"),
        ("misnamed", "Misnamed", "objc:AppKit", "`not a class` is not one"),
    ] {
        let source = format!(
            "import {{ {import} }} from \"{module}\";\nimport type {{ ObjcMeta }} from \"objc:types\";\nexport function run(): ObjcMeta<string> {{\n  return {import};\n}}\n"
        );
        let Some((_, prepared)) = prepare(&format!("class-{name}"), CLASSES, &source) else {
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

const PROPERTIES: &str = r#"/**
 * @ntsFramework AppKit
 */
declare module "objc:AppKit" {
  import type { ObjcClass } from "objc:types";
  export type NSString = ObjcClass<"NSString">;
  export interface NSWindowOwnMethods {
    title: NSString;
    /** @ntsSelector isVisible */
    visible: boolean;
    readonly windowNumber: number;
  }
  export type NSWindow = ObjcClass<"NSWindow"> & NSWindowOwnMethods;
}
"#;

/// A property is two messages: the getter, named for the property or by
/// `@ntsSelector` (`getter=isVisible`), and the setter Cocoa's `@property`
/// makes, `set` and the name capitalized.
#[test]
fn a_property_reads_and_writes_by_message() {
    let source = "import type { NSString, NSWindow } from \"objc:AppKit\";\n\
                  export function run(w: NSWindow, s: NSString): boolean {\n  w.title = s;\n  w.visible = !w.visible;\n  return w.title === s;\n}\n";
    let Some((_, prepared)) = prepare("properties", PROPERTIES, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    let text = emitted.writer.text();
    for selector in ["\"title\"", "\"setTitle:\"", "\"isVisible\"", "\"setVisible:\""] {
        assert!(text.contains(&format!("sel_registerName({selector})")), "no {selector}:\n{text}");
    }
    assert!(!text.contains("sel_registerName(\"visible\")"), "the getter override was ignored:\n{text}");
}

const CLASSES_AS_CLASSES: &str = r#"/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
    /** @ntsSelector isEqual: */
    isEqual(object: NSObject | null): boolean;
  }
  /** @ntsClass NSTimer */
  export class Timer extends NSObject {
    /** @ntsSelector invalidate */
    invalidate(): void;
    static readonly current: Timer;
  }
}
"#;

/// An Objective-C class a binding declares is a TypeScript class: `new` is
/// `+alloc` then the constructor's `init`, sent to what `alloc` answered; a
/// method is a message to the object and a `static` member one to the class,
/// by its Objective-C name (`Timer` is `NSTimer`); `instanceof` asks
/// `isKindOfClass:`.
#[test]
fn an_objective_c_class_is_a_typescript_class() {
    let source = "import { NSObject, Timer } from \"objc:Foundation\";\n\
                  export function run(): boolean {\n  const made = new Timer();\n  made.invalidate();\n  return Timer.current.isEqual(made) && made instanceof NSObject;\n}\n";
    let Some((_, prepared)) = prepare("objc-classes", CLASSES_AS_CLASSES, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let line = |needle: &str| text.lines().find(|line| line.contains(needle)).unwrap_or_default().trim().to_owned();
    // `alloc` goes to the class the program named, by its Objective-C name.
    let alloc = line("nts_objc_sel_alloc()");
    assert!(alloc.contains("(nts_objc_class_NSTimer(), nts_objc_sel_alloc())"), "{text}");
    // `init` goes to exactly what `alloc` answered.
    let allocated = alloc.split(" = ").next().unwrap_or_default();
    assert!(line("nts_objc_sel_init()").contains(&format!("({allocated}, nts_objc_sel_init())")), "{text}");
    // A class property's getter goes to the class.
    assert!(text.contains("(nts_objc_class_NSTimer(), nts_objc_sel_current())"), "{text}");
    assert!(text.contains("nts_objc_sel_invalidate()"), "{text}");
    assert!(text.contains("sel_registerName(\"isKindOfClass:\")"), "{text}");
}

/// Swift's labels, `move(_:x:y:)` in TypeScript as `view.move(v, { x, y })`:
/// one object literal the compiler never builds. Its properties are evaluated
/// in the order the program writes them, which is JavaScript's rule, and
/// passed in the order the selector declares them, whatever order that was.
#[test]
fn labels_are_passed_without_building_an_object() {
    let binding = r#"/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { c_double } from "c:types";
  /** @ntsClass NSView */
  export class NSView {
    /** @ntsSelector init */
    constructor();
    /** @ntsSelector moveView:toX:y: */
    move(other: NSView, labels: { x: c_double; y: c_double }): void;
  }
}
"#;
    let source = "import { NSView } from \"objc:Foundation\";\n\
                  import type { c_double } from \"c:types\";\n\
                  export function first(): c_double { return 1 as c_double; }\n\
                  export function second(): c_double { return 2 as c_double; }\n\
                  export function run(view: NSView): void {\n  view.move(view, { y: second(), x: first() });\n}\n";
    let Some((_, prepared)) = prepare("labels", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let body = text.split("void run(").nth(2).or_else(|| text.split("void run(").nth(1)).unwrap_or_default();
    assert!(!body.contains("nts_object") && !body.contains("NtsObj_"), "the labels were built:\n{body}");
    // `second()` is written first and so evaluated first.
    let (second, first) = (body.find("second(").unwrap_or(usize::MAX), body.find("first(").unwrap_or(0));
    assert!(second < first, "the labels were not evaluated as written:\n{body}");
    // And passed as the selector declares them: x, then y.
    let send = body.lines().find(|line| line.contains("nts_objc_sel_moveView_ctoX_cy_c()")).unwrap_or_default();
    let x = body.lines().find(|l| l.contains("= first(")).and_then(|l| l.trim().split(' ').next()).unwrap_or("?");
    let y = body.lines().find(|l| l.contains("= second(")).and_then(|l| l.trim().split(' ').next()).unwrap_or("?");
    assert!(send.contains(&format!(", {x}, {y})")), "x and y not in the selector's order:\n{body}");
}

/// Labels held in a variable -- as a wrapper passes on the ones it was
/// given -- are an object like any other, and each label is its field, read
/// at the call and passed in the selector's order.
#[test]
fn labels_that_are_not_a_literal_are_read_from_their_fields() {
    let binding = r#"/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { c_double } from "c:types";
  /** @ntsClass NSView */
  export class NSView {
    /** @ntsSelector setX:y: */
    move(labels: { x: c_double; y: c_double }): void;
  }
}
"#;
    let source = "import { NSView } from \"objc:Foundation\";\n\
                  import type { c_double } from \"c:types\";\n\
                  export function run(view: NSView, at: { y: c_double; x: c_double }): void {\n  view.move(at);\n}\n";
    let Some((_, prepared)) = prepare("labels-variable", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let body = text.split("void run(").nth(2).or_else(|| text.split("void run(").nth(1)).unwrap_or_default();
    let send = body.lines().find(|line| line.contains("nts_objc_sel_setX_cy_c()")).unwrap_or_default();
    assert!(!send.is_empty(), "no send:\n{body}");
    // The two fields are read, and `x` -- declared second in the object's
    // type -- is passed first, as the selector declares it.
    let named = |field: &str| {
        body.lines()
            .find(|line| line.contains(&format!("->{field}")) || line.contains(&format!("->f_{field}")))
            .and_then(|line| line.trim().split(' ').next())
            .unwrap_or("?")
            .to_owned()
    };
    let (x, y) = (named("x"), named("y"));
    assert!(send.contains(&format!(", {x}, {y})")), "x and y not in the selector's order (x={x}, y={y}):\n{body}");
}

/// Swift's numbers: a binding says `Int`, `UInt` or `CGFloat`, a program
/// passes a plain `number`, and the send carries the brand's C type --
/// `long`, `unsigned long`, `double` -- with no cast written anywhere.
#[test]
fn swift_numbers_take_plain_numbers_and_cross_as_c_types() {
    let binding = r#"declare module "objc:Foundation" {
  import type { CGFloat, Int, UInt } from "objc:types";
  /** @ntsClass NSScaler */
  export class NSScaler {
    /** @ntsSelector scale:by:at: */
    scale(count: Int, labels: { by: CGFloat; at: UInt }): Int;
  }
}
"#;
    let source = "import { NSScaler } from \"objc:Foundation\";\n\
                  export function run(s: NSScaler, n: number): number {\n  return s.scale(n + 1, { by: 1.5, at: 2 }) * 2;\n}\n";
    let Some((_, prepared)) = prepare("swift-numbers", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        text.contains("((long (*)(const void *, struct objc_selector *, long, double, unsigned long))objc_msgSend)("),
        "the send does not carry long, double and unsigned long:\n{text}"
    );
}

/// Swift's `String` at a message: a plain `string` argument is an `NSString`
/// the CF host makes of it (`nts_nsstring_of`, released after), a plain
/// `string` result is copied back out of the `NSString` it is
/// (`nts_string_of_nsstring`), and a `CString` is still the C string a C
/// function would get.
#[test]
fn a_string_crosses_a_message_as_an_nsstring() {
    let binding = r#"declare module "objc:Foundation" {
  import type { CString } from "objc:types";
  /** @ntsClass NSString */
  export class NSString {
    /** @ntsSelector initWithUTF8String: */
    constructor(text: CString);
    /** @ntsSelector stringByAppendingString: */
    appending(other: string): string;
  }
}
"#;
    let source = "import { NSString } from \"objc:Foundation\";\n\
                  export function run(): string {\n  return new NSString(\"a\").appending(\"b\");\n}\n";
    let Some((_, prepared)) = prepare("nsstring", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    // The constructor's `CString` is a UTF-8 C string.
    assert!(text.contains("nts_string_to_cstring("), "{text}");
    // The message's `string` is an `NSString` made of its storage...
    let made = text.lines().find(|l| l.contains("= nts_nsstring_of(")).unwrap_or_default();
    let object = made.trim().split(' ').next().unwrap_or("?");
    // ...passed to the message. (Its release after the send is ARC's +1 rule,
    // and shows under `--rc`, which `macos-classes` runs.)
    assert!(text.contains(&format!("nts_objc_sel_stringByAppendingString_c(), {object})")), "{text}");
    // And the result is copied back out of the `NSString`.
    assert!(text.contains("nts_string_of_nsstring("), "{text}");
}

/// Swift's `class Counter: NSObject`: a class the program writes over an
/// Objective-C class is one, registered before `main` under its own name.
/// Each method gets an entry point the runtime calls -- `self`, `_cmd`, then
/// its arguments -- with clang's type encoding, a `number` crosses as Swift's
/// `Double`, and a call the program writes goes straight to the compiled
/// method.
#[test]
fn a_class_extending_an_objective_c_class_is_registered_with_the_runtime() {
    let binding = r#"declare module "objc:Foundation" {
  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
  }
}
"#;
    let source = "import { NSObject } from \"objc:Foundation\";\n\
                  class Counter extends NSObject {\n  bump(by: number): number { return this.twice(by) + 1; }\n  twice(n: number): number { return n * 2; }\n}\n\
                  export function run(): number {\n  return new Counter().bump(3);\n}\n";
    let Some((_, prepared)) = prepare("objc-subclass-registered", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for expected in [
        // The runtime's entry point: `self` and `_cmd`, then a `double`.
        "static double nts_imp_Counter_0(struct Counter * a0, void * a1, double a2)",
        // The selector Swift's `@objc` rule makes, with clang's encoding.
        "{ \"bump:\", (void (*)(void))nts_imp_Counter_0, \"d24@0:8d16\" }",
        // Registered before `main`, under its own name, over its superclass.
        "__attribute__((constructor)) static void nts_objc_register_classes(void)",
        // No fields, so nothing to make at `init`.
        "nts_objc_register_class(\"Counter\", \"NSObject\", nts_objc_methods_Counter, 2u, 0);",
        // `new Counter()` is the runtime's class, found by that name.
        "objc_getRequiredClass(\"Counter\")",
    ] {
        assert!(text.contains(expected), "no `{expected}` in:\n{text}");
    }
    // `this.twice(by)` is the compiled method, called directly.
    let bump = text.split("static double Counter__bump(struct Counter * v0, double v1) {").nth(1).unwrap_or_default();
    assert!(bump.split("\n}").next().unwrap_or_default().contains("Counter__twice(v0,"), "{text}");
}

/// Swift's `override func draw(_:)`: an override answers the selector of the
/// method it overrides, `drawRect:`, where Swift's naming rule would make
/// `draw:`. The runtime passes it a rectangle by value, which its entry point
/// takes as C does and hands the compiled method by address, with the type
/// encoding clang writes for it; `super.draw(r)` is `[super drawRect:r]`. And
/// an optional chain as a statement, whose
/// value -- a handle, `null` or `undefined` -- nothing reads, compiles.
#[test]
fn an_override_takes_the_selector_it_replaces_and_a_record_by_value() {
    let binding = r#"declare module "objc:Foundation" {
  import type { ByValue, Struct, c_double } from "c:types";
  export type Size = Struct<{ width: c_double; height: c_double }, "Size">;
  export type Box = Struct<{ origin: Size; size: Size }, "Box">;
  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
  }
  /** @ntsClass Surface */
  export class Surface extends NSObject {
    /** @ntsSelector drawRect: */
    draw(dirtyRect: ByValue<Box>): void;
    readonly parent: Surface | null;
  }
}
"#;
    let source = "import { Surface, type Box } from \"objc:Foundation\";\n\
                  import type { ByValue } from \"c:types\";\n\
                  let seen = 0;\n\
                  class Canvas extends Surface {\n  draw(dirtyRect: ByValue<Box>): void { seen = dirtyRect.size.width; super.draw(dirtyRect); }\n}\n\
                  export function run(): number {\n  const canvas = new Canvas();\n  canvas.parent?.parent;\n  return seen;\n}\n";
    let Some((_, prepared)) = prepare("objc-override-record", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for expected in [
        "{ \"drawRect:\", (void (*)(void))nts_imp_Canvas_0, \"v48@0:8{Box={Size=dd}{Size=dd}}16\" }",
        "struct Box a2) { nts_callback_enter(); Canvas__draw((struct Canvas *)a0, (struct Box *)&a2);",
        // `super.draw(r)` is `[super drawRect:r]`: from the superclass of the
        // program's class, the receiver unchanged.
        "objc_msgSendSuper)(&(struct nts_objc_super){ ",
        "class_getSuperclass(nts_objc_class_Canvas()) }, nts_objc_sel_drawRect_c(), ",
    ] {
        assert!(text.contains(expected), "no `{expected}` in:\n{text}");
    }
}

/// Swift's `#selector`: `selector(Controller, "pressed")` is the selector the
/// method was registered under -- Swift's `@objc` rule, `pressed:` with its
/// one argument and `tick` with none -- and an inherited method of a class a
/// binding declares is its `@ntsSelector`, named through the class that
/// inherits it or through the import of the class itself. Each is the cached lookup a send
/// to it uses, so a selector the program names and one it sends are one
/// registration.
#[test]
fn a_selector_is_the_one_its_method_was_registered_under() {
    let binding = r#"declare module "objc:Foundation" {
  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
    /** @ntsSelector isEqual: */
    isEqual(object: NSObject | null): boolean;
  }
}
"#;
    let source = "import { NSObject } from \"objc:Foundation\";\n\
                  import { selector, type Selector } from \"objc:runtime\";\n\
                  class Controller extends NSObject {\n  pressed(sender: NSObject): void {}\n  tick(): void {}\n}\n\
                  export function pick(n: number): Selector {\n  \
                  return n === 0 ? selector(Controller, \"pressed\") : n === 1 ? selector(Controller, \"tick\") : n === 2 ? selector(Controller, \"isEqual\") : selector(NSObject, \"isEqual\");\n}\n";
    let Some((_, prepared)) = prepare("objc-selector", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for expected in [
        "if (!cached) cached = sel_registerName(\"pressed:\");",
        "if (!cached) cached = sel_registerName(\"tick\");",
        "if (!cached) cached = sel_registerName(\"isEqual:\");",
        "= nts_objc_sel_pressed_c();",
        "= nts_objc_sel_tick();",
        "= nts_objc_sel_isEqual_c();",
        // The one the runtime registers the method under is the same.
        "{ \"pressed:\", ",
    ] {
        assert!(text.contains(expected), "no `{expected}` in:\n{text}");
    }
}

/// Swift's stored properties: fields of such a class live in an object its
/// ivar holds (`Held#state`), made by the `init` the runtime adds -- whose
/// maker the registration hands over -- and every read and write goes
/// through `nts_objc_state`.
#[test]
fn the_fields_of_an_objective_c_subclass_live_in_its_state() {
    let binding = r#"declare module "objc:Foundation" {
  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
  }
}
"#;
    let source = "import { NSObject } from \"objc:Foundation\";\n\
                  class Held extends NSObject {\n  count = 1;\n  names: string[] = [];\n  tick(): number { this.count += 2; return this.count; }\n}\n\
                  export function run(): number {\n  const held = new Held();\n  held.count = 5;\n  return held.tick();\n}\n";
    let Some((_, prepared)) = prepare("objc-subclass-fields", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::SysV);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for expected in [
        // The fields' object, and its maker running the initialisers.
        "struct NtsObj_Held_state {",
        "static NtsObj_Held_state * Held__state(void)",
        // The maker, entered as a callback, handed to the registration.
        "static void *nts_objc_state_Held(void) { nts_callback_enter();",
        "nts_objc_register_class(\"Held\", \"NSObject\", nts_objc_methods_Held, 1u, nts_objc_state_Held);",
        // Reads and writes, from a method and from outside, through the ivar.
        "= nts_objc_state(",
    ] {
        assert!(text.contains(expected), "no `{expected}` in:\n{text}");
    }
}

/// What such a class cannot yet hold is refused by name: a constructor that
/// does not open with its `super(...)`, whose `this` would be made part way
/// through; and a field initialiser that could run code
/// -- a call, or `this` -- inside `init`, before the instance holds its fields.
#[test]
fn a_constructor_or_a_reaching_initializer_on_an_objective_c_subclass_is_refused_by_name() {
    let binding = r#"declare module "objc:Foundation" {
  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
  }
}
"#;
    let source = "import { NSObject } from \"objc:Foundation\";\n\
                  function start(): number { return 3; }\n\
                  export class Held extends NSObject {\n  count = start();\n  constructor() { const n = start(); super(); void n; }\n  tick(): void {}\n}\n\
                  export class Selfish extends NSObject {\n  me = this;\n}\n";
    let Some((_, prepared)) = prepare("objc-subclass-refused", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let messages: Vec<&str> = prepared.diagnostics.iter().map(|d| d.message.as_str()).collect();
    let reaching = "a field initialiser of a class extending a foreign class (Objective-C, `GObject` or a composable Windows Runtime class) that calls, reads a member or reads `this`";
    assert_eq!(messages.iter().filter(|m| m.contains(reaching)).count(), 2, "{messages:?}");
    assert!(messages.iter().any(|m| m.contains("does not open with its `super(...)`")), "{messages:?}");
}
