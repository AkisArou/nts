//! Objective-C message sends, as plain C.
//!
//! A send is `objc_msgSend` cast to the exact function type the declaration
//! spells, with the receiver and the selector first. That is what clang emits
//! for `[receiver selector:argument]`, and it is the only correct call: the
//! function is declared variadic, and calling it that way is wrong on arm64,
//! where variadic arguments go on the stack and the method reads registers.
//!
//! **No `<objc/runtime.h>`.** Its typedefs (`id`, `Class`, `SEL`, `BOOL`,
//! `Method`) and macros (`nil`, `YES`, `NO`) would take names a TypeScript
//! program is entitled to use, the hazard `native_preamble`'s `#undef`s exist
//! for. The three entry points a send needs are declared here, with the types
//! the header gives them, so a translation unit that does include it agrees
//! rather than conflicts.
//!
//! **Selectors and classes are looked up once**, each by a `static` function
//! holding its own cache. The first call registers the selector (or finds the
//! class), and later calls read the cache. Not thread-safe by construction,
//! and not required to be: every send runs on the program's owner thread, as
//! every other call does.

use super::{CodeWriter, Origin, Program};
use nts_codegen_common::objc::{class_symbol, lookups, selector_symbol};
use nts_core::hir::native::{Function, Send, Type};

/// The runtime declarations and the lookup functions, when the program sends
/// anything. Written before the function bodies, which call them.
pub(super) fn declarations(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    if !program.objc {
        return;
    }
    let found = lookups(program);
    writer.line(origin, "/* The Objective-C runtime, declared rather than included: see `emit/objc.rs`. */");
    writer.line(origin, "struct objc_selector;");
    writer.line(origin, "struct objc_class;");
    writer.line(origin, "extern struct objc_selector *sel_registerName(const char *name);");
    // `objc_getClass` answers nil for a class that is not loaded, and a message
    // to nil answers zero: the program would carry on with a null handle it was
    // promised was an object. The required form ends the process, naming it.
    writer.line(origin, "extern struct objc_class *objc_getRequiredClass(const char *name);");
    writer.line(origin, "extern void objc_msgSend(void);");
    for selector in found.selectors {
        let name = selector_symbol(selector);
        writer.line(origin, format!("static struct objc_selector *{name}(void) {{"));
        writer.line(origin, "    static struct objc_selector *cached;");
        writer.line(origin, format!("    if (!cached) cached = sel_registerName(\"{selector}\");"));
        writer.line(origin, "    return cached;");
        writer.line(origin, "}");
    }
    for class in found.classes {
        let name = class_symbol(class);
        writer.line(origin, format!("static struct objc_class *{name}(void) {{"));
        writer.line(origin, "    static struct objc_class *cached;");
        writer.line(origin, format!("    if (!cached) cached = objc_getRequiredClass(\"{class}\");"));
        writer.line(origin, "    return cached;");
        writer.line(origin, "}");
    }
}

/// A parameter's type in the cast. Every pointer is `const void *`, because
/// the ABI is one machine word whatever it points to, and a handle's
/// `struct NSString` would otherwise be declared for the first time inside a
/// cast, where it is a different type from the one the argument has.
/// `const`, so a `const char *` argument converts without a diagnostic.
fn parameter(ty: &Type) -> String {
    match ty {
        Type::Pointer(_) => "const void *".to_owned(),
        other => other.c_type().into_owned(),
    }
}

fn result(ty: &Type) -> String {
    match ty {
        Type::Pointer(_) => "void *".to_owned(),
        other => other.c_type().into_owned(),
    }
}

/// `((R (*)(const void *, struct objc_selector *, A...))objc_msgSend)(r, sel, a...)`.
pub(super) fn send_expression(target: &Function, send: &Send, arguments: &[String]) -> String {
    let (receiver, rest, receiver_type) = match &send.class {
        Some(class) => (format!("{}()", class_symbol(class)), arguments, "struct objc_class *".to_owned()),
        None => (
            arguments.first().cloned().unwrap_or_else(|| "0".to_owned()),
            arguments.get(1..).unwrap_or(&[]),
            "const void *".to_owned(),
        ),
    };
    let skip = usize::from(send.class.is_none());
    let mut types = vec![receiver_type, "struct objc_selector *".to_owned()];
    types.extend(target.parameters.iter().skip(skip).map(parameter));
    let mut values = vec![receiver, format!("{}()", selector_symbol(&send.selector))];
    values.extend(rest.iter().cloned());
    format!(
        "(({} (*)({}))objc_msgSend)({})",
        result(&target.result),
        types.join(", "),
        values.join(", ")
    )
}
