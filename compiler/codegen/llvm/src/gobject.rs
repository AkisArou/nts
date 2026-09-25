//! `GObject` classes the program writes, as the C backend's `emit/gobject.rs`
//! writes them: per class the program makes, an entry point per `vfunc_`
//! override converting to what the compiled method takes, a table of
//! `{ offset, entry point }` for the support file's `class_init`, the
//! `GType` registered the first time one is made, and `nts_gobject_new_{Class}`
//! for `new`. No constructor before `main`: registration is lazy, as `GObject`'s
//! own `get_type` functions are.

use std::fmt::Write as _;

use nts_core::hir::native::{Family, PROGRAM_GTYPE, Type};
use nts_core::hir::{Callee, ForeignClass, ForeignMethod, Func, HirType, OpKind, Program};
use nts_diagnostics::Diagnostic;

use super::{Platform, conversion, is_not_zero, refuse, symbol, text_constant, ty_of};

/// The function `new` of `class` calls, which this section defines.
pub(super) fn maker(class: &ForeignClass) -> String {
    format!("nts_gobject_new_{}", class.name)
}

/// Whether the program makes one of `class`, and so defines its `new`.
fn made(program: &Program, class: &ForeignClass) -> bool {
    called(program, &maker(class))
}

/// The classes the program writes whose `GType` it needs, parents first: each
/// it makes, each a chain-up reaches the parent of, and each one of those's
/// ancestors that the program wrote too -- as the C backend's `registered`.
fn registered(program: &Program) -> Vec<&ForeignClass> {
    let gobject = |name: &str| program.foreign_classes.iter().find(|class| class.family == Family::GObject && class.name == name);
    let mut wanted: Vec<&str> = Vec::new();
    for op in program.funcs.iter().flat_map(|func| &func.values) {
        let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
        if let Some(made) = target.name.strip_prefix("nts_gobject_new_") {
            wanted.push(made);
        } else if let Some((class, _)) = target.name.strip_prefix("nts_gobject_chain_").and_then(|rest| rest.rsplit_once('_')) {
            wanted.extend(gobject(class).and_then(|class| class.superclass.strip_prefix(PROGRAM_GTYPE)));
        }
    }
    let mut order: Vec<&ForeignClass> = Vec::new();
    for name in wanted {
        let mut chain = Vec::new();
        let mut at = gobject(name);
        while let Some(class) = at.filter(|class| !order.iter().chain(&chain).any(|seen| seen.name == class.name)) {
            chain.push(class);
            at = class.superclass.strip_prefix(PROGRAM_GTYPE).and_then(gobject);
        }
        order.extend(chain.into_iter().rev());
    }
    order
}

/// Whether the program calls `name` as a foreign function, and so declares it.
fn called(program: &Program, name: &str) -> bool {
    program.funcs.iter().flat_map(|func| &func.values).any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::Native(target), .. } if target.name == name)
    })
}

/// Whether `name` is a chain-up thunk this section defines.
pub(super) fn is_chain(name: &str) -> bool {
    name.starts_with("nts_gobject_chain_")
}

pub(super) fn classes(program: &Program, platform: Platform, callbacks_declared: bool) -> Result<String, Diagnostic> {
    // A parent's `get_type`, declared once however many classes extend it
    // and chain up to it: LLVM, unlike C, refuses a second declaration.
    let mut parents = std::collections::BTreeSet::new();
    let mut out = chains(program, platform, &mut parents)?;
    let classes = registered(program);
    if classes.is_empty() {
        return Ok(out);
    }
    if !callbacks_declared {
        out.push_str("declare void @nts_callback_enter()\ndeclare void @nts_callback_leave()\n");
    }
    out.push_str("declare i64 @nts_gobject_register(i64, ptr, ptr, i64, ptr)\ndeclare ptr @nts_gobject_new(i64)\n");
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
        // The fields' maker, entered and left as an entry point is:
        // `instance_init` runs wherever GTK makes one.
        let make_state = match &class.state {
            Some(state) => {
                let Some(compiled) = program.funcs.iter().find(|func| &func.name == state) else {
                    let missing = "a GObject class whose fields' maker this program does not define";
                    return match program.funcs.first() {
                        Some(func) => Err(refuse(func, missing)),
                        None => Ok(String::new()),
                    };
                };
                let _ = writeln!(
                    out,
                    "define internal ptr @nts_gobject_state_maker_{name}() nounwind {{\n  call void @nts_callback_enter()\n  %made = call ptr {}()\n  call void @nts_callback_leave()\n  ret ptr %made\n}}",
                    symbol(&compiled.name)
                );
                format!("@nts_gobject_state_maker_{name}")
            }
            None => "null".to_owned(),
        };
        // A parent the program wrote is defined here, not declared.
        let parent = &class.superclass;
        if !parent.starts_with(PROGRAM_GTYPE) && !called(program, parent) && parents.insert(parent.clone()) {
            let _ = writeln!(out, "declare i64 @{parent}()");
        }
        let _ = writeln!(
            out,
            "@nts_gobject_type_{name}.cache = internal global i64 0\n\
             define internal i64 @nts_gobject_type_{name}() nounwind {{\n\
             entry:\n  %cached = load i64, ptr @nts_gobject_type_{name}.cache\n  %none = icmp eq i64 %cached, 0\n\
             \x20 br i1 %none, label %register, label %done\n\
             register:\n  %parent = call i64 @{parent}()\n\
             \x20 %made = call i64 @nts_gobject_register(i64 %parent, ptr @nts_gobject_name_{name}, ptr {table}, i64 {}, ptr {make_state})\n\
             \x20 store i64 %made, ptr @nts_gobject_type_{name}.cache\n  br label %done\n\
             done:\n  %type = phi i64 [ %cached, %entry ], [ %made, %register ]\n  ret i64 %type\n}}",
            slots.len()
        );
        if made(program, class) {
            let _ = writeln!(
                out,
                "define ptr @{}() nounwind {{\n  %type = call i64 @nts_gobject_type_{name}()\n  %made = call ptr @nts_gobject_new(i64 %type)\n  ret ptr %made\n}}",
                maker(class)
            );
        }
    }
    Ok(out)
}

/// Each chain-up thunk the program calls (`super.vfunc_clicked()`): the
/// parent's slot at the offset its name carries, called if it is there.
fn chains(program: &Program, platform: Platform, parents: &mut std::collections::BTreeSet<String>) -> Result<String, Diagnostic> {
    let mut out = String::new();
    let mut done = std::collections::BTreeSet::new();
    for (func, target) in program.funcs.iter().flat_map(|func| func.values.iter().map(move |op| (func, op))).filter_map(|(func, op)| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if is_chain(&target.name) => Some((func, target)),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        if done.len() == 1 {
            out.push_str("declare ptr @nts_gobject_parent_slot(i64, i64)\n");
        }
        let Some((class, offset)) = target.name.trim_start_matches("nts_gobject_chain_").rsplit_once('_') else {
            return Err(refuse(func, "a chain-up whose name does not say its class and slot"));
        };
        let Some(parent) = program.foreign_classes.iter().find(|foreign| foreign.family == Family::GObject && foreign.name == class).map(|foreign| foreign.superclass.clone()) else {
            return Err(refuse(func, "a chain-up in a class this program does not register"));
        };
        if !parent.starts_with(PROGRAM_GTYPE) && !called(program, &parent) && parents.insert(parent.clone()) {
            let _ = writeln!(out, "declare i64 @{parent}()");
        }
        let types = target.parameters.iter().map(|ty| ty_of(&ty.abi(platform.abi), func).map(str::to_owned)).collect::<Result<Vec<_>, _>>()?;
        let parameters: Vec<String> = types.iter().enumerate().map(|(at, ty)| format!("{ty} %a{at}")).collect();
        let result = target.result.abi(platform.abi);
        let returns = if result == HirType::Void { "void".to_owned() } else { ty_of(&result, func)?.to_owned() };
        let _ = writeln!(
            out,
            "define {returns} @{}({}) nounwind {{\nentry:\n  %parent = call i64 @{parent}()\n  %slot = call ptr @nts_gobject_parent_slot(i64 %parent, i64 {offset})\n  %none = icmp eq ptr %slot, null\n  br i1 %none, label %skip, label %call\ncall:",
            target.name,
            parameters.join(", ")
        );
        let arguments = parameters.join(", ");
        if returns == "void" {
            let _ = writeln!(out, "  call void %slot({arguments})\n  ret void\nskip:\n  ret void\n}}");
        } else {
            let zero = if returns == "ptr" { "null".to_owned() } else if returns.starts_with('i') { "0".to_owned() } else { "0.0".to_owned() };
            let _ = writeln!(out, "  %r = call {returns} %slot({arguments})\n  ret {returns} %r\nskip:\n  ret {returns} {zero}\n}}");
        }
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
        // One handle as another -- the slot's `GtkWidget *` as the method's
        // `GtkButton *` `this`, which is what the instance is, since GTK
        // calls this class's slot with this class's instances -- is the same
        // pointer.
        let handles = matches!((&from, &want.ty), (HirType::NativePointer(_), HirType::NativePointer(_)));
        if from == want.ty || handles {
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
