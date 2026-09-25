//! A COM method call: a cast of the receiver's table slot, which is how C
//! calls through a vtable and what a `lpVtbl->Method(...)` macro expands to.

use super::{CodeWriter, Origin, Program};
use nts_codegen_common::com::{delegate_hop_symbol, delegate_invoke_symbol, delegate_signatures};
use nts_codegen_common::objc::{Carried, hop_arguments};
use nts_core::hir::native::{FnPointer, Function, Type, Vtable};

/// A pointer is `void *` in the cast, the receiver first: every COM method
/// takes its instance as `This`, and one it writes through -- a result slot --
/// is not `const`. One C only reads keeps its `const` (`const void *`): a
/// byte array lent as `const uint8_t *` passed to a plain `void *` discards
/// the qualifier, which `-Werror` refuses.
fn spelled(ty: &Type) -> String {
    match ty {
        Type::Pointer(_) if ty.c_type().starts_with("const ") => "const void *".to_owned(),
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
///
/// Called off the thread owning the closure -- the delegate is agile, so a
/// source calls it where it completes -- the call is carried there
/// (`nts_com_carry`): the arguments packed, the objects among them held, and
/// `run` unpacking them into the bridge. A signature whose arguments cannot
/// be carried keeps the bridge's own check, which ends the process by name.
pub(super) fn delegates(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    for signature in delegate_signatures(program) {
        let bridge_type = {
            let mut types: Vec<String> = signature.parameters.iter().map(|ty| ty.c_type().into_owned()).collect();
            types.push("void *".to_owned());
            format!("void (*)({})", types.join(", "))
        };
        let hop = hop_arguments(signature).map(|carried| hop(writer, origin, signature, &carried, &bridge_type));
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
                "static int32_t {}({}) {{ {}const NtsComDelegate *d = self; ((void (*)({}))d->bridge)({}); return 0; }}",
                delegate_invoke_symbol(signature),
                parameters.join(", "),
                hop.unwrap_or_default(),
                bridge.join(", "),
                arguments.join(", ")
            ),
        );
    }
}

/// A signature's carried call: the arguments' type, the offsets of the
/// objects in it, and `run`, which unpacks them on the owning thread into the
/// bridge. Returns the test the `Invoke` adapter starts with.
fn hop(writer: &mut CodeWriter, origin: &Origin, signature: &FnPointer, carried: &[Carried], bridge_type: &str) -> String {
    let hop = delegate_hop_symbol(signature);
    let mut fields = Vec::new();
    let mut packed = Vec::new();
    let mut objects = Vec::new();
    let mut arguments = Vec::new();
    for (at, (ty, carriage)) in signature.parameters.iter().zip(carried).enumerate() {
        fields.push(format!("{} a{at};", ty.c_type()));
        packed.push(format!("a{at}"));
        arguments.push(format!("h->a{at}"));
        if matches!(carriage, Carried::Counted(_)) {
            objects.push(format!("(uint32_t)offsetof(struct {hop}, a{at})"));
        }
    }
    if fields.is_empty() {
        fields.push("char unused;".to_owned());
        packed.push("0".to_owned());
    }
    arguments.push("d->context".to_owned());
    writer.line(origin, format!("struct {hop} {{ {} }};", fields.join(" ")));
    writer.line(
        origin,
        format!(
            "static void {hop}_run(void *self, void *arguments) {{ const NtsComDelegate *d = self; struct {hop} *h = arguments; (({bridge_type})d->bridge)({}); }}",
            arguments.join(", ")
        ),
    );
    let table = if objects.is_empty() {
        "0".to_owned()
    } else {
        writer.line(origin, format!("static const uint32_t {hop}_objects[] = {{ {} }};", objects.join(", ")));
        format!("{hop}_objects")
    };
    format!(
        "if (!nts_is_owner_thread()) {{ struct {hop} h = {{ {} }}; nts_com_carry(self, &h, sizeof h, {table}, {}u, {hop}_run); return 0; }} ",
        packed.join(", "),
        objects.len()
    )
}
