//! The Windows Runtime's delegates: the C backend's `com::delegates`, in the
//! other spelling.

use std::fmt::Write as _;

use nts_codegen_common::com::{
    adapter_symbol, class_symbol, delegate_hop_symbol, delegate_invoke_symbol, delegate_signatures, forward_symbol, interfaces, interfaces_symbol, table_symbol,
    Answer, OUTER_SLOTS,
};
use nts_codegen_common::objc::{Carried, hop_arguments};
use nts_core::hir::native::{FnPointer, Type};
use nts_core::hir::{ForeignMethod, Func, HirType, Program};
use nts_diagnostics::Diagnostic;

use super::objc::{abi_parameter, bare};
use super::{Platform, conversion, is_not_zero, refuse, symbol, text_constant, ty_of};

/// One `Invoke` adapter per delegate signature: `i32 (ptr %self, A...)`, the
/// bridge and the context out of the object (`NtsComDelegate`: the table, the
/// bridge, the context, a word each), the bridge called with the context
/// last, and `S_OK` -- or, called off the thread owning the closure, the call
/// carried there (`nts_com_carry`), as the C backend's adapter carries it.
pub(super) fn delegates(program: &Program) -> String {
    let mut text = String::new();
    for signature in delegate_signatures(program) {
        let mut parameters = vec!["ptr %self".to_owned()];
        let mut types = Vec::new();
        let mut arguments = Vec::new();
        for (at, ty) in signature.parameters.iter().enumerate() {
            let spelled = abi_parameter(ty);
            parameters.push(format!("{spelled} %a{at}"));
            types.push(bare(&ty.representation()).to_owned());
            arguments.push(format!("{spelled} %a{at}"));
        }
        types.push("ptr".to_owned());
        arguments.push("ptr %context".to_owned());
        // Not for a record by value, which this adapter receives as its
        // address; that one keeps the bridge's owner check.
        let carried = hop_arguments(signature).filter(|_| !signature.parameters.iter().any(|ty| matches!(ty, Type::Record(_))));
        if let Some(carried) = &carried {
            hop(&mut text, signature, carried, &types, &arguments);
        }
        let _ = writeln!(text, "define internal i32 @{}({}) {{", delegate_invoke_symbol(signature), parameters.join(", "));
        if let Some(carried) = &carried {
            let hop = delegate_hop_symbol(signature);
            let counted = carried.iter().filter(|c| matches!(c, Carried::Counted(_))).count();
            let objects = if counted == 0 { "null".to_owned() } else { format!("@{hop}.objects") };
            let _ = writeln!(text, "  %owned = call zeroext i1 @nts_is_owner_thread()");
            let _ = writeln!(text, "  br i1 %owned, label %here, label %carry");
            let _ = writeln!(text, "carry:");
            let _ = writeln!(text, "  %h = alloca %{hop}");
            for (at, ty) in signature.parameters.iter().enumerate() {
                let _ = writeln!(text, "  %h{at} = getelementptr inbounds %{hop}, ptr %h, i32 0, i32 {at}");
                let _ = writeln!(text, "  store {} %a{at}, ptr %h{at}", bare(&ty.representation()));
            }
            let _ = writeln!(text, "  %size.at = getelementptr %{hop}, ptr null, i32 1");
            let _ = writeln!(text, "  %size = ptrtoint ptr %size.at to i64");
            let _ = writeln!(text, "  call void @nts_com_carry(ptr %self, ptr %h, i64 %size, ptr {objects}, i32 {counted}, ptr @{hop}.run)");
            let _ = writeln!(text, "  ret i32 0");
            let _ = writeln!(text, "here:");
        }
        let _ = writeln!(text, "  %bridge.slot = getelementptr inbounds i8, ptr %self, i64 8");
        let _ = writeln!(text, "  %bridge = load ptr, ptr %bridge.slot");
        let _ = writeln!(text, "  %context.slot = getelementptr inbounds i8, ptr %self, i64 16");
        let _ = writeln!(text, "  %context = load ptr, ptr %context.slot");
        let _ = writeln!(text, "  call void ({}) %bridge({})", types.join(", "), arguments.join(", "));
        let _ = writeln!(text, "  ret i32 0");
        let _ = writeln!(text, "}}");
    }
    text
}

/// A signature's carried call: the arguments' type, the offsets of the
/// objects in it, and `run`, which unpacks them on the owning thread into the
/// bridge -- the C backend's `hop`, in the other spelling.
fn hop(text: &mut String, signature: &FnPointer, carried: &[Carried], types: &[String], arguments: &[String]) {
    let hop = delegate_hop_symbol(signature);
    // The bare types: an extension is a parameter's attribute, which neither
    // a type nor a load may carry.
    let fields: Vec<&str> = signature.parameters.iter().map(|ty| bare(&ty.representation())).collect();
    let _ = writeln!(text, "%{hop} = type {{ {} }}", if fields.is_empty() { "i8".to_owned() } else { fields.join(", ") });
    let offsets: Vec<String> = carried
        .iter()
        .enumerate()
        .filter(|(_, c)| matches!(c, Carried::Counted(_)))
        .map(|(at, _)| format!("i32 ptrtoint (ptr getelementptr (%{hop}, ptr null, i32 0, i32 {at}) to i32)"))
        .collect();
    if !offsets.is_empty() {
        let _ = writeln!(text, "@{hop}.objects = private constant [{} x i32] [{}]", offsets.len(), offsets.join(", "));
    }
    let _ = writeln!(text, "define internal void @{hop}.run(ptr %self, ptr %h) {{");
    for (at, field) in fields.iter().enumerate() {
        let _ = writeln!(text, "  %h{at} = getelementptr inbounds %{hop}, ptr %h, i32 0, i32 {at}");
        let _ = writeln!(text, "  %a{at} = load {field}, ptr %h{at}");
    }
    let _ = writeln!(text, "  %bridge.slot = getelementptr inbounds i8, ptr %self, i64 8");
    let _ = writeln!(text, "  %bridge = load ptr, ptr %bridge.slot");
    let _ = writeln!(text, "  %context.slot = getelementptr inbounds i8, ptr %self, i64 16");
    let _ = writeln!(text, "  %context = load ptr, ptr %context.slot");
    let _ = writeln!(text, "  call void ({}) %bridge({})", types.join(", "), arguments.join(", "));
    let _ = writeln!(text, "  ret void\n}}");
}

/// The classes the program writes over composable Windows Runtime classes,
/// as the C backend's `emit/com.rs` writes them: an adapter per override --
/// the interface pointer the table was called through turned back into the
/// instance, then the arguments converted to what the compiled method takes
/// -- a table per interface, the runtime's `NtsComClass` for each class, and
/// one constructor registering them all before `main`. Returns the text and
/// that constructor's name.
pub(super) fn classes(program: &Program, platform: Platform, callbacks_declared: &mut bool) -> Result<(String, Option<&'static str>), Diagnostic> {
    let classes = nts_codegen_common::com::classes(program);
    let mut out = String::new();
    // Every class is the program's, so it has a function to name a refusal by.
    let Some(first) = program.funcs.first() else { return Ok((out, None)) };
    if classes.is_empty() {
        return Ok((out, None));
    }
    super::declare_callbacks(&mut out, callbacks_declared);
    out.push_str("declare void @nts_com_register(ptr)\ndeclare ptr @nts_com_outer_instance(ptr)\ndeclare ptr @nts_com_outer_base(ptr)\n");
    for slot in OUTER_SLOTS {
        let _ = writeln!(out, "declare void @{slot}()");
    }
    let mut registrations = Vec::new();
    for class in &classes {
        for (at, method) in class.methods.iter().enumerate() {
            let compiled = program
                .funcs
                .iter()
                .find(|func| func.name == method.function)
                .ok_or_else(|| refuse(first, "an override whose compiled function this program does not define"))?;
            adapter(&mut out, platform, &adapter_symbol(&class.name, at), method, compiled)?;
        }
        let Some(composition) = &class.composition else {
            return Err(refuse(first, "a class written over a composable class with no factory"));
        };
        for (at, forward) in composition.forwarded.iter().enumerate() {
            forwarder(&mut out, platform, &forward_symbol(&class.name, at), forward).map_err(|why| refuse(first, &why))?;
        }
        let answered = interfaces(class);
        let mut rows = Vec::new();
        for (index, interface) in answered.iter().enumerate() {
            let mut slots: Vec<String> = OUTER_SLOTS.iter().map(|slot| format!("ptr @{slot}")).collect();
            for (slot, answer) in &interface.slots {
                if *slot as usize != slots.len() {
                    return Err(refuse(first, "an override table with a gap, which lowering refuses"));
                }
                let symbol = match answer {
                    Answer::Override(at) => adapter_symbol(&class.name, *at),
                    Answer::Forward(at) => forward_symbol(&class.name, *at),
                };
                slots.push(format!("ptr @{symbol}"));
            }
            let table = table_symbol(&class.name, index);
            let _ = writeln!(out, "@{table} = internal constant [{} x ptr] [{}]", slots.len(), slots.join(", "));
            // An IID word's bits, which IR writes as a signed literal.
            rows.push(format!("{{ i64, i64, ptr }} {{ i64 {}, i64 {}, ptr @{table} }}", interface.low.cast_signed(), interface.high.cast_signed()));
        }
        let (low, high) = nts_core::hir::native::iid_words(&composition.factory).unwrap_or_default();
        let descriptor = class_symbol(&class.name);
        let array = interfaces_symbol(&class.name);
        let _ = writeln!(out, "@{array} = internal constant [{} x {{ i64, i64, ptr }}] [{}]", rows.len(), rows.join(", "));
        text_constant(&mut out, &format!("{descriptor}.name"), &class.name);
        text_constant(&mut out, &format!("{descriptor}.base"), &composition.class);
        // `NtsComClass`: natural alignment places it as C does. The last
        // field is the factory the runtime keeps, so it is not a constant.
        let _ = writeln!(
            out,
            "@{descriptor} = internal global {{ ptr, ptr, i64, i64, i32, ptr, i32, i8, ptr }} {{ ptr @{descriptor}.name, ptr @{descriptor}.base, i64 {}, i64 {}, i32 {}, ptr @{array}, i32 {}, i8 {}, ptr null }}",
            low.cast_signed(),
            high.cast_signed(),
            composition.slot,
            answered.len(),
            u8::from(composition.xaml)
        );
        registrations.push(format!("  call void @nts_com_register(ptr @{descriptor})"));
    }
    let _ = writeln!(out, "define internal void @nts_com_register_classes() {{\n{}\n  ret void\n}}", registrations.join("\n"));
    Ok((out, Some("nts_com_register_classes")))
}

/// One override's adapter, `i32 (ptr face, A...)`: the compiled method
/// called with the instance and its arguments, and `S_OK`.
fn adapter(out: &mut String, platform: Platform, name: &str, method: &ForeignMethod, compiled: &Func) -> Result<(), Diagnostic> {
    // An override may take fewer parameters than its slot is called with, as
    // TypeScript lets it: the rest are not passed on.
    if compiled.params.len() > method.signature.parameters.len() {
        return Err(refuse(compiled, "an override taking more parameters than its slot is called with"));
    }
    let mut parameters = Vec::new();
    let mut arguments = Vec::new();
    let mut body = String::from("  call void @nts_callback_enter()\n");
    for (slot, foreign) in method.signature.parameters.iter().enumerate() {
        if matches!(foreign, Type::Record(_)) {
            return Err(refuse(compiled, "an override taking a record by value, which only the C backend's adapter receives"));
        }
        let from = foreign.abi(platform.abi);
        let from_ty = ty_of(&from, compiled)?;
        parameters.push(format!("{} %a{slot}", abi_parameter(foreign)));
        let Some(to) = compiled.params.get(slot).map(|param| param.ty.clone()) else { continue };
        let to_ty = ty_of(&to, compiled)?;
        if slot == 0 {
            let _ = writeln!(body, "  %p0 = call ptr @nts_com_outer_instance(ptr %a0)");
            arguments.push(format!("{to_ty} %p0"));
        } else if from == to {
            arguments.push(format!("{to_ty} %a{slot}"));
        } else if to == HirType::Bool {
            let _ = writeln!(body, "  {}", is_not_zero(&format!("%p{slot}"), &from, from_ty, &format!("%a{slot}")));
            arguments.push(format!("{to_ty} %p{slot}"));
        } else {
            let instruction = conversion(&from, &to, compiled)?;
            let _ = writeln!(body, "  %p{slot} = {instruction} {from_ty} %a{slot} to {to_ty}");
            arguments.push(format!("{to_ty} %p{slot}"));
        }
    }
    let _ = writeln!(out, "define internal i32 @{name}({}) nounwind {{", parameters.join(", "));
    out.push_str(&body);
    let result = ty_of(&compiled.return_type, compiled)?;
    let _ = writeln!(out, "  call {result} {}({})", symbol(&compiled.name), arguments.join(", "));
    let _ = writeln!(out, "  call void @nts_callback_leave()\n  ret i32 0\n}}");
    Ok(())
}

/// A slot the class leaves to its base: the same slot of the base's own
/// implementation, called with the same arguments and answering its HRESULT.
/// No TypeScript runs, so there is no callback to enter.
///
/// A record by value is passed on as Win64 passes it, whatever its fields: in
/// an integer register when it is 1, 2, 4 or 8 bytes, and otherwise as the
/// address of the caller's copy. The register's *class* is the whole of it:
/// a forwarder passes the bits through, so `ptr` would serve for 8 bytes as
/// `i64` does, and a `Size` spelled by its `float` fields would read XMM
/// registers the caller never wrote.
fn forwarder(out: &mut String, platform: Platform, name: &str, forward: &nts_core::hir::native::Forwarded) -> Result<(), String> {
    let mut spelled = Vec::new();
    for ty in &forward.signature.parameters {
        spelled.push(match ty {
            Type::Record(record) => {
                if platform.abi != nts_core::hir::native::NativeAbi::Win64 {
                    return Err("a forwarded record by value off Win64, where the Windows Runtime is not".to_owned());
                }
                match super::aggregate::extent_of(record, platform) {
                    Some((size @ (1 | 2 | 4 | 8), _)) => format!("i{}", size * 8),
                    Some(_) => "ptr".to_owned(),
                    None => return Err(format!("a forwarded record, `{}`, whose layout this backend cannot place", record.name)),
                }
            }
            other => abi_parameter(other),
        });
    }
    let parameters: Vec<String> = spelled.iter().enumerate().map(|(at, ty)| format!("{ty} %a{at}")).collect();
    let arguments: Vec<String> = std::iter::once("ptr %base".to_owned())
        .chain(spelled.iter().enumerate().skip(1).map(|(at, ty)| format!("{ty} %a{at}")))
        .collect();
    let _ = writeln!(out, "define internal i32 @{name}({}) nounwind {{", parameters.join(", "));
    let _ = writeln!(out, "  %base = call ptr @nts_com_outer_base(ptr %a0)");
    let _ = writeln!(out, "  %table = load ptr, ptr %base");
    let _ = writeln!(out, "  %slot = getelementptr inbounds ptr, ptr %table, i64 {}", forward.slot);
    let _ = writeln!(out, "  %base.fn = load ptr, ptr %slot");
    let _ = writeln!(out, "  %r = call i32 %base.fn({})", arguments.join(", "));
    let _ = writeln!(out, "  ret i32 %r\n}}");
    Ok(())
}
