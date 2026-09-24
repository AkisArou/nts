//! A COM method call: a cast of the receiver's table slot, which is how C
//! calls through a vtable and what a `lpVtbl->Method(...)` macro expands to.

use super::{CodeWriter, Origin, Program};
use nts_codegen_common::com::{delegate_invoke_symbol, delegate_signatures};
use nts_core::hir::native::{Function, Type, Vtable};

/// A pointer is `void *` in the cast, the receiver first: every COM method
/// takes its instance as `This`, and one it writes through -- a result slot --
/// is not `const`.
fn spelled(ty: &Type) -> String {
    match ty {
        Type::Pointer(_) => "void *".to_owned(),
        other => other.c_type().into_owned(),
    }
}

/// `((R (*)(void *, A...))(*(void ***)r)[slot])(r, a...)`: the function in
/// slot `slot` of the table the receiver's first word points at, called with
/// the receiver and the rest.
pub(super) fn vtable_expression(target: &Function, vtable: &Vtable, arguments: &[String]) -> String {
    let receiver = arguments.first().cloned().unwrap_or_else(|| "0".to_owned());
    let types: Vec<String> = target.parameters.iter().map(spelled).collect();
    format!(
        "(({} (*)({}))(*(void ***){receiver})[{}])({})",
        spelled(&target.result),
        types.join(", "),
        vtable.slot,
        arguments.join(", ")
    )
}

/// One `Invoke` adapter per delegate signature the program makes an object
/// for: `HRESULT (void *self, A...)`, which calls the bridge the object holds
/// with the context it holds last (`NtsComDelegate`) and answers `S_OK`.
pub(super) fn delegates(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    for signature in delegate_signatures(program) {
        let mut parameters = vec!["void *self".to_owned()];
        let mut bridge = Vec::new();
        let mut arguments = Vec::new();
        for (at, ty) in signature.parameters.iter().enumerate() {
            parameters.push(format!("{} a{at}", ty.c_type()));
            bridge.push(ty.c_type().into_owned());
            arguments.push(format!("a{at}"));
        }
        bridge.push("void *".to_owned());
        arguments.push("d->context".to_owned());
        writer.line(
            origin,
            format!(
                "static int32_t {}({}) {{ const NtsComDelegate *d = self; ((void (*)({}))d->bridge)({}); return 0; }}",
                delegate_invoke_symbol(signature),
                parameters.join(", "),
                bridge.join(", "),
                arguments.join(", ")
            ),
        );
    }
}
