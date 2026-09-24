//! Objective-C message sends, as LLVM IR. The C backend's `emit/objc.rs` in
//! the other spelling, and the same rules: every send calls `objc_msgSend`
//! with the exact function type spelled at the call site (never variadically),
//! and each selector and class is looked up once, by an `internal` function
//! with its own cached global.

use std::fmt::Write as _;

use nts_codegen_common::objc::{class_symbol, lookups, selector_symbol};
use nts_core::hir::native::{Function, Send};
use nts_core::hir::{Func, HirType, Program, ValueId};
use nts_diagnostics::Diagnostic;

use super::{extension, name, refuse, ty_of};

/// A C string as an LLVM constant. Selectors and class names are identifier
/// characters and colons only (checked where they are read), so no byte here
/// needs an escape.
fn constant(global: &str, text: &str) -> String {
    format!(
        "{global} = private unnamed_addr constant [{} x i8] c\"{text}\\00\"",
        text.len() + 1
    )
}

/// One cached lookup: `define internal ptr @symbol()` loading `@symbol.cache`,
/// and on the first call asking `lookup(name)` and storing the answer. The
/// symbol is the C backend's, from `nts_codegen_common::objc`.
fn lookup(text: &mut String, symbol: &str, lookup: &str, spelled: &str) {
    let base = format!("@{symbol}");
    let _ = writeln!(text, "{}", constant(&format!("{base}.name"), spelled));
    let _ = writeln!(text, "{base}.cache = internal global ptr null");
    let _ = writeln!(text, "define internal ptr {base}() {{");
    let _ = writeln!(text, "  %cached = load ptr, ptr {base}.cache");
    let _ = writeln!(text, "  %missing = icmp eq ptr %cached, null");
    let _ = writeln!(text, "  br i1 %missing, label %miss, label %hit");
    let _ = writeln!(text, "hit:");
    let _ = writeln!(text, "  ret ptr %cached");
    let _ = writeln!(text, "miss:");
    let _ = writeln!(text, "  %found = call ptr @{lookup}(ptr {base}.name)");
    let _ = writeln!(text, "  store ptr %found, ptr {base}.cache");
    let _ = writeln!(text, "  ret ptr %found");
    let _ = writeln!(text, "}}");
}

/// The runtime declarations and the lookups, when the program sends anything.
pub(super) fn module(program: &Program) -> String {
    if !program.objc {
        return String::new();
    }
    let found = lookups(program);
    let mut text = String::new();
    let _ = writeln!(text, "declare ptr @sel_registerName(ptr)");
    // Required, not `objc_getClass`: a missing class ends the process by
    // name, where nil would answer every message with zero.
    let _ = writeln!(text, "declare ptr @objc_getRequiredClass(ptr)");
    // Declared with no parameters, as Apple's header does; every call spells
    // the function type it actually makes.
    let _ = writeln!(text, "declare void @objc_msgSend()");
    for selector in found.selectors {
        lookup(&mut text, &selector_symbol(selector), "sel_registerName", selector);
    }
    for class in found.classes {
        lookup(&mut text, &class_symbol(class), "objc_getRequiredClass", class);
    }
    text
}

/// `%out = call R (ptr, ptr, A...) @objc_msgSend(ptr %receiver, ptr %sel, A %a...)`.
pub(super) fn send(
    func: &Func,
    target: &Function,
    send: &Send,
    args: &[ValueId],
    result: &HirType,
    out: &str,
) -> Result<String, Diagnostic> {
    let instance = send.class.is_none();
    if args.len() != target.parameters.len() || *result != target.result.representation() {
        return Err(refuse(func, "an Objective-C message whose HIR disagrees with its declared ABI"));
    }
    let mut before = Vec::new();
    let receiver = match &send.class {
        Some(class) => {
            let receiver = format!("{out}.receiver");
            before.push(format!("{receiver} = call ptr @{}()", class_symbol(class)));
            receiver
        }
        None => name(args[0]),
    };
    let selector = format!("{out}.selector");
    before.push(format!("{selector} = call ptr @{}()", selector_symbol(&send.selector)));
    let mut types = vec!["ptr".to_owned(), "ptr".to_owned()];
    let mut values = vec![format!("ptr {receiver}"), format!("ptr {selector}")];
    let rest = &args[usize::from(instance)..];
    for (at, arg) in rest.iter().enumerate() {
        let ty = &func.values[arg.0 as usize].ty;
        if *ty == HirType::Erased {
            return Err(refuse(func, "an Objective-C message with an erased argument"));
        }
        types.push(ty_of(ty, func)?.to_owned());
        let temp = format!("{out}.arg{at}");
        values.extend(super::arguments(func, &temp, &[*arg], &mut before)?);
    }
    let prefix = if *result == HirType::Void { String::new() } else { format!("{out} = ") };
    before.push(format!(
        "{prefix}call {}{} ({}) @objc_msgSend({})",
        extension(result),
        ty_of(result, func)?,
        types.join(", "),
        values.join(", ")
    ));
    Ok(before.join("\n"))
}
