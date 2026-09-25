//! A COM method call: a cast of the receiver's table slot, which is how C
//! calls through a vtable and what a `lpVtbl->Method(...)` macro expands to.

use super::{c_identifier, c_type_of, CodeWriter, Diagnostic, Origin, Program};
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

/// The classes the program writes over composable Windows Runtime classes:
/// for each override, the adapter its interface's table calls -- the
/// interface pointer, then the arguments -- which finds the instance and
/// calls the compiled method with it; a table per interface, slots 0 to 5
/// the outer object's; the class's descriptor; and one constructor
/// registering them all before `main`, as Objective-C classes are.
pub(super) fn classes(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<(), Diagnostic> {
    use nts_codegen_common::com::{adapter_symbol, class_symbol, forward_symbol, interfaces, interfaces_symbol, table_symbol, Answer, OUTER_SLOTS};
    let classes = nts_codegen_common::com::classes(program);
    if classes.is_empty() {
        return Ok(());
    }
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    writer.line(origin, "/* Classes written over composable Windows Runtime classes: see `emit/com.rs`. */");
    for class in &classes {
        for (at, method) in class.methods.iter().enumerate() {
            let compiled = program
                .funcs
                .iter()
                .find(|func| func.name == method.function)
                .ok_or_else(|| refuse("an override whose compiled function this program does not define"))?;
            // An override may take fewer parameters than its slot is called
            // with, as TypeScript lets it: the rest are not passed on.
            if compiled.params.len() > method.signature.parameters.len() {
                return Err(refuse("an override taking more parameters than its slot is called with"));
            }
            let mut parameters = Vec::new();
            let mut arguments = Vec::new();
            for (slot, ty) in method.signature.parameters.iter().enumerate() {
                // An interface pointer as `void *`: a struct the compiled
                // method never names would be declared by nothing, and each
                // argument passed on is cast to what the method takes.
                let spelled = if matches!(ty, nts_core::hir::native::Type::Pointer(_)) { std::borrow::Cow::Borrowed("void *") } else { ty.c_type() };
                parameters.push(format!("{spelled} a{slot}"));
                let Some(want) = compiled.params.get(slot) else { continue };
                let value = if slot == 0 { "nts_com_outer_instance(a0)".to_owned() } else { format!("a{slot}") };
                arguments.push(format!("({}){value}", c_type_of(program, &want.ty, &want.origin)?));
            }
            writer.line(
                origin,
                format!(
                    "static int32_t {}({}) {{ nts_callback_enter(); {}({}); nts_callback_leave(); return 0; }}",
                    adapter_symbol(&class.name, at),
                    parameters.join(", "),
                    c_identifier(&compiled.name),
                    arguments.join(", ")
                ),
            );
        }
        let Some(composition) = &class.composition else {
            return Err(refuse("a class written over a composable class with no factory"));
        };
        for (at, forward) in composition.forwarded.iter().enumerate() {
            forwarder(writer, origin, &forward_symbol(&class.name, at), forward);
        }
        let answered = interfaces(class);
        let mut rows = Vec::new();
        for (index, interface) in answered.iter().enumerate() {
            let mut slots: Vec<String> = OUTER_SLOTS.iter().map(|slot| format!("(const void *){slot}")).collect();
            for (slot, answer) in &interface.slots {
                if *slot as usize != slots.len() {
                    return Err(refuse("an override table with a gap, which lowering refuses"));
                }
                let symbol = match answer {
                    Answer::Override(at) => adapter_symbol(&class.name, *at),
                    Answer::Forward(at) => forward_symbol(&class.name, *at),
                };
                slots.push(format!("(const void *){symbol}"));
            }
            let table = table_symbol(&class.name, index);
            writer.line(origin, format!("static const void *const {table}[] = {{ {} }};", slots.join(", ")));
            rows.push(format!("{{ {}ull, {}ull, {table} }}", interface.low, interface.high));
        }
        let (low, high) = nts_core::hir::native::iid_words(&composition.factory).unwrap_or_default();
        let interfaces_array = interfaces_symbol(&class.name);
        writer.line(origin, format!("static const NtsComInterface {interfaces_array}[] = {{ {} }};", rows.join(", ")));
        writer.line(
            origin,
            format!(
                "static NtsComClass {} = {{ \"{}\", \"{}\", {low}ull, {high}ull, {}u, {interfaces_array}, {}u, {}, 0 }};",
                class_symbol(&class.name),
                class.name,
                composition.class,
                composition.slot,
                answered.len(),
                composition.xaml
            ),
        );
    }
    writer.line(origin, "__attribute__((constructor)) static void nts_com_register_classes(void) {");
    for class in &classes {
        writer.line(origin, format!("    nts_com_register(&{});", class_symbol(&class.name)));
    }
    writer.line(origin, "}");
    Ok(())
}

/// A slot the class leaves to its base: the same slot of the base's own
/// implementation, called with the same arguments and answering its HRESULT.
/// No TypeScript runs, so there is no callback to enter.
fn forwarder(writer: &mut CodeWriter, origin: &Origin, name: &str, forward: &nts_core::hir::native::Forwarded) {
    let types: Vec<String> = forward
        .signature
        .parameters
        .iter()
        .map(|ty| match ty {
            nts_core::hir::native::Type::Pointer(_) => "void *".to_owned(),
            other => other.c_type().into_owned(),
        })
        .collect();
    let parameters: Vec<String> = types.iter().enumerate().map(|(at, ty)| format!("{ty} a{at}")).collect();
    let arguments: Vec<String> = std::iter::once("base".to_owned()).chain((1..types.len()).map(|at| format!("a{at}"))).collect();
    writer.line(
        origin,
        format!(
            "static int32_t {name}({}) {{ void *base = nts_com_outer_base(a0); return ((int32_t (*)({}))(*(void ***)base)[{}])({}); }}",
            parameters.join(", "),
            types.join(", "),
            forward.slot,
            arguments.join(", ")
        ),
    );
}
