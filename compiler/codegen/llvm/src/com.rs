//! The Windows Runtime's delegates: the C backend's `com::delegates`, in the
//! other spelling.

use std::fmt::Write as _;

use nts_codegen_common::com::{delegate_hop_symbol, delegate_invoke_symbol, delegate_signatures};
use nts_codegen_common::objc::{Carried, hop_arguments};
use nts_core::hir::Program;
use nts_core::hir::native::{FnPointer, Type};

use super::objc::{abi, bare};

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
            let spelled = abi(ty);
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
