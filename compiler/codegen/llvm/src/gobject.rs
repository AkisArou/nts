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
        if let Some(made) = target.name.strip_prefix("nts_gobject_new_").or_else(|| target.name.strip_prefix(PROGRAM_GTYPE)) {
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

/// Whether a native callee is a thunk this module defines -- a chain-up or a
/// signal's emit -- which the program therefore must not also declare: LLVM
/// refuses a definition of a name already declared.
pub(super) fn defined_here(name: &str) -> bool {
    is_chain(name)
        || name.starts_with("nts_gobject_emit_")
        || name.starts_with("nts_gobject_notify_")
        || name.starts_with("nts_gobject_child_")
}

pub(super) fn classes(program: &Program, platform: Platform, callbacks_declared: bool) -> Result<String, Diagnostic> {
    // A parent's `get_type`, declared once however many classes extend it
    // and chain up to it: LLVM, unlike C, refuses a second declaration.
    let mut parents = std::collections::BTreeSet::new();
    let mut out = chains(program, platform, &mut parents)?;
    out.push_str(&emits(program, platform)?);
    out.push_str(&notifies(program));
    out.push_str(&children(program));
    let classes = registered(program);
    if classes.is_empty() {
        return Ok(out);
    }
    if !callbacks_declared {
        out.push_str("declare void @nts_callback_enter()\ndeclare void @nts_callback_leave()\n");
    }
    out.push_str("declare i64 @nts_gobject_register(i64, ptr, ptr, i64, ptr, ptr, ptr)\ndeclare ptr @nts_gobject_new(i64)\n");
    if classes.iter().any(|class| class.template.is_some()) {
        out.push_str("declare void @nts_gtk_class_template(ptr, ptr, i64, ptr, i64)\ndeclare void @nts_gtk_init_template(ptr)\n");
    }
    if classes.iter().any(|class| !class.signals.is_empty()) {
        out.push_str("declare i32 @nts_gobject_add_signal(i64, ptr, ptr)\n");
    }
    if classes.iter().any(|class| !class.properties.is_empty()) {
        out.push_str("declare void @nts_gobject_set_properties(i64, ptr, i64)\n");
    }
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
        // Its signals, added to the type the moment it exists.
        let hooks = template(&mut out, class);
        let mut signals = registrations(&mut out, class);
        if let Some(table) = properties(&mut out, program, class)? {
            let _ = writeln!(signals, "  call void @nts_gobject_set_properties(i64 %made, ptr {table}, i64 {})", class.properties.len());
        }
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
             \x20 %made = call i64 @nts_gobject_register(i64 %parent, ptr @nts_gobject_name_{name}, ptr {table}, i64 {}, ptr {make_state}, {hooks})\n\
             {signals}\
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

/// A class's template: the `class_setup` hook setting it and binding each
/// child it names, and `nts_gtk_init_template` for each instance
/// (`nts_gtk.c`). The two hook arguments registration passes.
fn template(out: &mut String, class: &ForeignClass) -> String {
    let Some(template) = &class.template else { return "ptr null, ptr null".to_owned() };
    let name = &class.name;
    bytes_constant(out, &format!("nts_gobject_template_{name}"), &template.xml);
    let mut names = Vec::new();
    for (at, child) in template.children.iter().enumerate() {
        bytes_constant(out, &format!("nts_gobject_child_name_{name}_{at}"), child);
        names.push(format!("ptr @nts_gobject_child_name_{name}_{at}"));
    }
    let table = if names.is_empty() {
        "null".to_owned()
    } else {
        let _ = writeln!(out, "@nts_gobject_children_{name} = internal constant [{} x ptr] [{}]", names.len(), names.join(", "));
        format!("@nts_gobject_children_{name}")
    };
    let _ = writeln!(
        out,
        "define internal void @nts_gobject_class_setup_{name}(ptr %klass) nounwind {{\n  call void @nts_gtk_class_template(ptr %klass, ptr @nts_gobject_template_{name}, i64 {}, ptr {table}, i64 {})\n  ret void\n}}",
        template.xml.len(),
        names.len()
    );
    format!("ptr @nts_gobject_class_setup_{name}, ptr @nts_gtk_init_template")
}

/// Each `nts_gobject_child_{Class}_{index}` the program calls, defined as
/// `gtk_widget_get_template_child` by the child's id, which lends it.
fn children(program: &Program) -> String {
    let mut out = String::new();
    let mut done = std::collections::BTreeSet::new();
    for target in program.funcs.iter().flat_map(|func| &func.values).filter_map(|op| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_child_") => Some(target),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let Some((class, index)) = target.name.trim_start_matches("nts_gobject_child_").rsplit_once('_') else { continue };
        let Some(id) = program
            .foreign_classes
            .iter()
            .find(|foreign| foreign.family == Family::GObject && foreign.name == class)
            .and_then(|foreign| foreign.template.as_ref())
            .and_then(|template| template.children.get(index.parse::<usize>().ok()?))
        else {
            continue;
        };
        if done.len() == 1 {
            out.push_str("declare ptr @nts_gtk_template_child(ptr, i64, ptr)\n");
        }
        let thunk = &target.name;
        bytes_constant(&mut out, &format!("{thunk}.id"), id);
        let _ = writeln!(
            out,
            "define ptr @{thunk}(ptr %self) nounwind {{\n  %type = call i64 @{PROGRAM_GTYPE}{class}()\n  %child = call ptr @nts_gtk_template_child(ptr %self, i64 %type, ptr @{thunk}.id)\n  ret ptr %child\n}}"
        );
    }
    out
}

/// The calls adding a class's signals to its `GType` (`%made`), one per
/// signal, with the constants they name written to `out`.
fn registrations(out: &mut String, class: &ForeignClass) -> String {
    let name = &class.name;
    let mut calls = String::new();
    for (at, signal) in class.signals.iter().enumerate() {
        bytes_constant(out, &format!("nts_gobject_signal_{name}_{at}"), &signal.name);
        bytes_constant(out, &format!("nts_gobject_kinds_{name}_{at}"), &signal.kinds);
        let _ = writeln!(
            calls,
            "  call i32 @nts_gobject_add_signal(i64 %made, ptr @nts_gobject_signal_{name}_{at}, ptr @nts_gobject_kinds_{name}_{at})"
        );
    }
    calls
}

/// A class's properties as the runtime's `get_property` and `set_property`
/// reach them: a wrapper per accessor, entered and left as an entry point is,
/// and the `{ name, kind, get, set }` table registration hands over. `None`
/// for a class with none.
fn properties(out: &mut String, program: &Program, class: &ForeignClass) -> Result<Option<String>, Diagnostic> {
    if class.properties.is_empty() {
        return Ok(None);
    }
    let name = &class.name;
    let mut rows = Vec::new();
    for (at, property) in class.properties.iter().enumerate() {
        let find = |wanted: &str| program.funcs.iter().find(|func| func.name == wanted);
        let (Some(get), Some(set)) = (find(&property.getter), find(&property.setter)) else {
            let missing = "a GObject property whose accessor this program does not define";
            return match program.funcs.first() {
                Some(func) => Err(refuse(func, missing)),
                None => Ok(None),
            };
        };
        let value = ty_of(&get.return_type, get)?;
        let _ = writeln!(
            out,
            "define internal {value} @nts_gobject_get_{name}_{at}(ptr %self) nounwind {{\n  call void @nts_callback_enter()\n  %r = call {value} {}(ptr %self)\n  call void @nts_callback_leave()\n  ret {value} %r\n}}",
            symbol(&get.name)
        );
        let _ = writeln!(
            out,
            "define internal void @nts_gobject_set_{name}_{at}(ptr %self, {value} %v) nounwind {{\n  call void @nts_callback_enter()\n  call void {}(ptr %self, {value} %v)\n  call void @nts_callback_leave()\n  ret void\n}}",
            symbol(&set.name)
        );
        bytes_constant(out, &format!("nts_gobject_property_{name}_{at}"), &property.name);
        rows.push(format!(
            "{{ ptr, i8, ptr, ptr }} {{ ptr @nts_gobject_property_{name}_{at}, i8 {}, ptr @nts_gobject_get_{name}_{at}, ptr @nts_gobject_set_{name}_{at} }}",
            u32::from(property.kind)
        ));
    }
    let _ = writeln!(
        out,
        "@nts_gobject_properties_{name} = internal constant [{} x {{ ptr, i8, ptr, ptr }}] [{}]",
        rows.len(),
        rows.join(", ")
    );
    Ok(Some(format!("@nts_gobject_properties_{name}")))
}

/// Each `nts_gobject_notify_{Class}_{index}` the program calls -- a write of
/// a property's field -- defined as `g_object_notify_by_pspec` with the
/// property's spec, found once and kept.
fn notifies(program: &Program) -> String {
    let mut out = String::new();
    let mut done = std::collections::BTreeSet::new();
    for target in program.funcs.iter().flat_map(|func| &func.values).filter_map(|op| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_notify_") => Some(target),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let Some((class, index)) = target.name.trim_start_matches("nts_gobject_notify_").rsplit_once('_') else { continue };
        if done.len() == 1 {
            out.push_str("declare ptr @nts_gobject_property_spec(i64, i32)\ndeclare void @g_object_notify_by_pspec(ptr, ptr)\n");
        }
        let thunk = &target.name;
        let _ = writeln!(
            out,
            "@{thunk}.spec = internal global ptr null\n\
             define void @{thunk}(ptr %self) nounwind {{\nentry:\n\
             \x20 %kept = load ptr, ptr @{thunk}.spec\n  %none = icmp eq ptr %kept, null\n  br i1 %none, label %find, label %have\n\
             find:\n  %type = call i64 @{PROGRAM_GTYPE}{class}()\n  %found = call ptr @nts_gobject_property_spec(i64 %type, i32 {index})\n\
             \x20 store ptr %found, ptr @{thunk}.spec\n  br label %have\n\
             have:\n  %spec = phi ptr [ %kept, %entry ], [ %found, %find ]\n\
             \x20 call void @g_object_notify_by_pspec(ptr %self, ptr %spec)\n  ret void\n}}"
        );
    }
    out
}

/// A NUL-terminated byte string constant, escaped as IR spells one: a signal's
/// name is a property name the program wrote, and may hold anything.
fn bytes_constant(out: &mut String, name: &str, value: &str) {
    let mut escaped = String::new();
    for byte in value.bytes() {
        match byte {
            b'"' | b'\\' => {
                let _ = write!(escaped, "\\{byte:02X}");
            }
            b' '..=b'~' => escaped.push(char::from(byte)),
            _ => {
                let _ = write!(escaped, "\\{byte:02X}");
            }
        }
    }
    let _ = writeln!(out, "@{name} = private unnamed_addr constant [{} x i8] c\"{escaped}\\00\"", value.len() + 1);
}

/// Each `nts_gobject_emit_{kinds}__{name}` the program calls, defined as its
/// prototype declares it: `g_signal_emit` by the signal's id, which
/// `nts_gobject_signal_id` finds on the instance's type once and keeps in
/// the thunk's cache. `g_signal_emit` is variadic, and C promotes what it
/// passes there: a `bool` is widened to the `int` a `gboolean` is.
fn emits(program: &Program, platform: Platform) -> Result<String, Diagnostic> {
    let mut out = String::new();
    let mut done = std::collections::BTreeSet::new();
    for (func, target) in program.funcs.iter().flat_map(|func| func.values.iter().map(move |op| (func, op))).filter_map(|(func, op)| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_emit_") => Some((func, target)),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let Some((_, signal)) = target.name.trim_start_matches("nts_gobject_emit_").split_once("__") else {
            return Err(refuse(func, "an emit thunk whose name does not say its signal"));
        };
        if done.len() == 1 {
            out.push_str("declare i32 @nts_gobject_signal_id(ptr, ptr, ptr)\ndeclare void @g_signal_emit(ptr, i32, i32, ...)\n");
        }
        let thunk = &target.name;
        bytes_constant(&mut out, &format!("{thunk}.name"), signal);
        let types = target.parameters.iter().map(|ty| ty_of(&ty.abi(platform.abi), func).map(str::to_owned)).collect::<Result<Vec<_>, _>>()?;
        let parameters: Vec<String> = types.iter().enumerate().map(|(at, ty)| format!("{ty} %a{at}")).collect();
        let mut body = String::new();
        let mut passed = Vec::new();
        for (at, ty) in types.iter().enumerate().skip(1) {
            if matches!(ty.as_str(), "i1" | "i8" | "i16") {
                let _ = writeln!(body, "  %p{at} = zext {ty} %a{at} to i32");
                passed.push(format!("i32 %p{at}"));
            } else {
                passed.push(format!("{ty} %a{at}"));
            }
        }
        let mut rest = String::new();
        for arg in &passed {
            let _ = write!(rest, ", {arg}");
        }
        let _ = writeln!(
            out,
            "@{thunk}.cache = internal global [2 x i64] zeroinitializer\n\
             define void @{thunk}({}) nounwind {{\nentry:\n\
             \x20 %id = call i32 @nts_gobject_signal_id(ptr %a0, ptr @{thunk}.name, ptr @{thunk}.cache)\n\
             {body}\
             \x20 call void (ptr, i32, i32, ...) @g_signal_emit(ptr %a0, i32 %id, i32 0{rest})\n  ret void\n}}",
            parameters.join(", ")
        );
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
