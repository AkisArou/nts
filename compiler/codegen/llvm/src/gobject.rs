//! `GObject` classes the program writes, as the C backend's `emit/gobject.rs`
//! writes them: per class the program makes, an entry point per `vfunc_`
//! override converting to what the compiled method takes, a table of
//! `{ offset, entry point }` for the support file's `class_init`, the
//! `GType` registered the first time one is made, and `nts_gobject_new_{Class}`
//! for `new`. No constructor before `main`: registration is lazy, as `GObject`'s
//! own `get_type` functions are.

use std::fmt::Write as _;

use nts_core::hir::native::{Family, Type};
use nts_core::hir::{Callee, ForeignClass, ForeignMethod, Func, HirType, OpKind, Program};
use nts_diagnostics::Diagnostic;

use super::{Platform, conversion, is_not_zero, refuse, symbol, text_constant, ty_of};

/// The function `new` of `class` calls, which this section defines.
pub(super) fn maker(class: &ForeignClass) -> String {
    format!("nts_gobject_new_{}", class.name)
}

/// Whether the program makes one of `class`: nothing is registered for a
/// class it never constructs.
fn made(program: &Program, class: &ForeignClass) -> bool {
    let make = maker(class);
    program.funcs.iter().flat_map(|func| &func.values).any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::Native(target), .. } if target.name == make)
    })
}

/// Whether the program calls `name` as a foreign function, and so declares it.
fn called(program: &Program, name: &str) -> bool {
    program.funcs.iter().flat_map(|func| &func.values).any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::Native(target), .. } if target.name == name)
    })
}

pub(super) fn classes(program: &Program, platform: Platform, callbacks_declared: bool) -> Result<String, Diagnostic> {
    let classes: Vec<&ForeignClass> =
        program.foreign_classes.iter().filter(|class| class.family == Family::GObject && made(program, class)).collect();
    let mut out = String::new();
    if classes.is_empty() {
        return Ok(out);
    }
    if !callbacks_declared {
        out.push_str("declare void @nts_callback_enter()\ndeclare void @nts_callback_leave()\n");
    }
    out.push_str("declare i64 @nts_gobject_register(i64, ptr, ptr, i64)\ndeclare ptr @nts_gobject_new(i64)\n");
    for class in classes {
        let name = &class.name;
        let mut slots = Vec::new();
        for (at, method) in class.methods.iter().enumerate() {
            let Some(compiled) = program.funcs.iter().find(|func| func.name == method.function) else {
                let missing = "a GObject virtual function whose compiled function this program does not define";
                return match program.funcs.first() {
                    Some(func) => Err(refuse(func, missing)),
                    None => Ok(String::new()),
                };
            };
            let offset = method
                .selector()
                .split_whitespace()
                .nth(2)
                .ok_or_else(|| refuse(compiled, "a GObject virtual function whose slot has no offset"))?;
            let entry = format!("nts_gobject_{name}_{at}");
            entry_point(&mut out, platform, &entry, method, compiled)?;
            slots.push(format!("{{ i64, ptr }} {{ i64 {offset}, ptr @{entry} }}"));
        }
        let table = if slots.is_empty() {
            "null".to_owned()
        } else {
            let _ = writeln!(out, "@nts_gobject_slots_{name} = internal constant [{} x {{ i64, ptr }}] [{}]", slots.len(), slots.join(", "));
            format!("@nts_gobject_slots_{name}")
        };
        text_constant(&mut out, &format!("nts_gobject_name_{name}"), &format!("Nts_{name}"));
        let parent = &class.superclass;
        if !called(program, parent) {
            let _ = writeln!(out, "declare i64 @{parent}()");
        }
        let _ = writeln!(
            out,
            "@nts_gobject_type_{name}.cache = internal global i64 0\n\
             define internal i64 @nts_gobject_type_{name}() nounwind {{\n\
             entry:\n  %cached = load i64, ptr @nts_gobject_type_{name}.cache\n  %none = icmp eq i64 %cached, 0\n\
             \x20 br i1 %none, label %register, label %done\n\
             register:\n  %parent = call i64 @{parent}()\n\
             \x20 %made = call i64 @nts_gobject_register(i64 %parent, ptr @nts_gobject_name_{name}, ptr {table}, i64 {})\n\
             \x20 store i64 %made, ptr @nts_gobject_type_{name}.cache\n  br label %done\n\
             done:\n  %type = phi i64 [ %cached, %entry ], [ %made, %register ]\n  ret i64 %type\n}}",
            slots.len()
        );
        let _ = writeln!(
            out,
            "define ptr @{}() nounwind {{\n  %type = call i64 @nts_gobject_type_{name}()\n  %made = call ptr @nts_gobject_new(i64 %type)\n  ret ptr %made\n}}",
            maker(class)
        );
    }
    Ok(out)
}

/// One override's entry point, `nts_gobject_<Class>_<at>`: the slot's C
/// arguments converted to the compiled method's, and its result back.
fn entry_point(out: &mut String, platform: Platform, entry: &str, method: &ForeignMethod, compiled: &Func) -> Result<(), Diagnostic> {
    if compiled.params.len() != method.signature.parameters.len() {
        return Err(refuse(compiled, "a GObject virtual function whose entry point and compiled function disagree about arity"));
    }
    if method.signature.parameters.iter().chain(std::iter::once(&*method.signature.result)).any(|ty| matches!(ty, Type::Record(_))) {
        return Err(refuse(compiled, "a GObject virtual function taking or returning a record by value"));
    }
    let mut parameters = Vec::new();
    let mut arguments = Vec::new();
    let mut body = String::new();
    for (slot, (foreign, want)) in method.signature.parameters.iter().zip(&compiled.params).enumerate() {
        let from = foreign.abi(platform.abi);
        let from_ty = ty_of(&from, compiled)?;
        parameters.push(format!("{from_ty} %a{slot}"));
        let to_ty = ty_of(&want.ty, compiled)?;
        if from == want.ty {
            arguments.push(format!("{to_ty} %a{slot}"));
        } else if want.ty == HirType::Bool {
            let _ = writeln!(body, "  {}", is_not_zero(&format!("%p{slot}"), &from, from_ty, &format!("%a{slot}")));
            arguments.push(format!("{to_ty} %p{slot}"));
        } else {
            let instruction = conversion(&from, &want.ty, compiled)?;
            let _ = writeln!(body, "  %p{slot} = {instruction} {from_ty} %a{slot} to {to_ty}");
            arguments.push(format!("{to_ty} %p{slot}"));
        }
    }
    let want = method.signature.result.abi(platform.abi);
    let have = compiled.return_type.clone();
    let call = format!("call {} {}({})", ty_of(&have, compiled)?, symbol(&compiled.name), arguments.join(", "));
    if want == HirType::Void {
        let _ = writeln!(out, "define internal void @{entry}({}) nounwind {{", parameters.join(", "));
        out.push_str(&body);
        let _ = writeln!(out, "  call void @nts_callback_enter()\n  {call}\n  call void @nts_callback_leave()\n  ret void\n}}");
    } else {
        let want_ty = ty_of(&want, compiled)?;
        let _ = writeln!(out, "define internal {want_ty} @{entry}({}) nounwind {{", parameters.join(", "));
        out.push_str(&body);
        let _ = writeln!(out, "  call void @nts_callback_enter()\n  %r = {call}\n  call void @nts_callback_leave()");
        if have == want {
            let _ = writeln!(out, "  ret {want_ty} %r\n}}");
        } else {
            let instruction = conversion(&have, &want, compiled)?;
            let _ = writeln!(out, "  %c = {instruction} {} %r to {want_ty}\n  ret {want_ty} %c\n}}", ty_of(&have, compiled)?);
        }
    }
    Ok(())
}
