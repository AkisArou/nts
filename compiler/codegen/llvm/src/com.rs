//! The Windows Runtime's delegates: the C backend's `com::delegates`, in the
//! other spelling.

use std::fmt::Write as _;

use nts_codegen_common::com::{delegate_invoke_symbol, delegate_signatures};
use nts_core::hir::Program;

use super::objc::{abi, bare};

/// One `Invoke` adapter per delegate signature: `i32 (ptr %self, A...)`, the
/// bridge and the context out of the object (`NtsComDelegate`: the table, the
/// bridge, the context, a word each), the bridge called with the context
/// last, and `S_OK`.
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
        let _ = writeln!(text, "define internal i32 @{}({}) {{", delegate_invoke_symbol(signature), parameters.join(", "));
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
