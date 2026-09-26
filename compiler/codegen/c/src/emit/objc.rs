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

use std::fmt::Write as _;
use super::{c_identifier, c_type_of, CodeWriter, Diagnostic, Origin, Program};
use nts_codegen_common::objc::{
    block_descriptor_symbol, block_encoding, block_invoke_symbol, block_signatures, class_symbol, lookups,
    selector_symbol,
};
use nts_core::hir::native::{FnPointer, Function, Send, Type};

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
    if found.supers {
        // `[super m]`: the receiver, and the class whose implementation the
        // runtime starts looking from, `struct objc_super`'s two words.
        writer.line(origin, "struct nts_objc_super { const void *receiver; struct objc_class *super_class; };");
        writer.line(origin, "extern void objc_msgSendSuper(void);");
        writer.line(origin, "extern struct objc_class *class_getSuperclass(struct objc_class *cls);");
    }
    if found.returns_records {
        // x86_64 returns a record in memory -- larger than 16 bytes, since
        // nothing packed crosses by value -- through a hidden pointer, and the
        // runtime needs a second entry point that knows the receiver is not
        // the first argument. arm64 has one entry point for every result, and
        // no `objc_msgSend_stret` to link against. `sizeof` is a constant, so
        // each slice keeps one of the two.
        writer.line(origin, "#if defined(__x86_64__)");
        writer.line(origin, "extern void objc_msgSend_stret(void);");
        writer.line(origin, "extern void objc_msgSendSuper_stret(void);");
        writer.line(origin, "#define NTS_OBJC_SEND_FOR(size) ((size) > 16 ? objc_msgSend_stret : objc_msgSend)");
        writer.line(origin, "#define NTS_OBJC_SUPER_FOR(size) ((size) > 16 ? objc_msgSendSuper_stret : objc_msgSendSuper)");
        writer.line(origin, "#else");
        writer.line(origin, "#define NTS_OBJC_SEND_FOR(size) objc_msgSend");
        writer.line(origin, "#define NTS_OBJC_SUPER_FOR(size) objc_msgSendSuper");
        writer.line(origin, "#endif");
    }
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

/// One method's entry point, `nts_imp_<Class>_<at>`: the runtime's arguments
/// -- `self`, `_cmd`, then the method's -- converted to the compiled method's
/// (a lent `NSString` copied into a string, a record read through its
/// address), and its result answered as the runtime takes it (a string as
/// an `NSString`, an object at +0 where the program counts).
fn entry_point(
    program: &Program,
    (method, compiled): (&nts_core::hir::ForeignMethod, &nts_core::hir::Func),
    symbol: &str,
    counted: bool,
    refuse: &dyn Fn(&str) -> Diagnostic,
) -> Result<String, Diagnostic> {
    // A record result is written through an address the entry point
    // passes the compiled method last.
    let record_out = matches!(*method.signature.result, Type::Record(_));
    if compiled.params.len() + 1 != method.signature.parameters.len() + usize::from(record_out) {
        return Err(refuse("an Objective-C method whose entry point and compiled function disagree about arity"));
    }
    let mut parameters = Vec::new();
    let mut arguments = Vec::new();
    let (mut copies, mut releases) = (String::new(), String::new());
    for (slot, ty) in method.signature.parameters.iter().enumerate() {
        parameters.push(format!("{} a{slot}", ty.c_type()));
        // `_cmd` is the runtime's; the compiled method never reads it.
        if slot == 1 {
            continue;
        }
        let want = compiled.params[if slot == 0 { 0 } else { slot - 1 }].clone();
        // An `NSString` the runtime lends, where the method takes a
        // string: copied in for the call and given back after it, as
        // a callback bridge does a C string's.
        if nts_core::hir::native::lent_ns_string(ty, &want.ty) {
            let _ = write!(copies, " NtsString *s{slot} = nts_string_of_nsstring(a{slot});");
            let _ = write!(releases, " nts_release((NtsHeader *)s{slot});");
            arguments.push(format!("s{slot}"));
            continue;
        }
        // A record arrives by value and the compiled method reads it
        // through its address, as every `ByValue<T>` is carried.
        let by_value = if matches!(ty, Type::Record(_)) { "&" } else { "" };
        arguments.push(format!("({}){by_value}a{slot}", c_type_of(program, &want.ty, &want.origin)?));
    }
    if record_out {
        arguments.push("&r".to_owned());
    }
    let call = format!("{}({})", c_identifier(&compiled.name), arguments.join(", "));
    let result = method.signature.result.c_type();
    let body = if record_out {
        format!("{result} r; nts_callback_enter();{copies} {call};{releases} nts_callback_leave(); return r;")
    } else if matches!(*method.signature.result, Type::Void) {
        format!("nts_callback_enter();{copies} {call};{releases} nts_callback_leave();")
    } else if nts_core::hir::native::answered_ns_string(&method.signature.result, &compiled.return_type) {
        // A string answered as the `NSString` Swift's `String` result
        // is: made of the method's, which is given back, and answered
        // at +0 where the program counts, as an object is.
        let answer = if counted { "objc_autoreleaseReturnValue((void *)made)" } else { "made" };
        format!(
            "nts_callback_enter();{copies} NtsString *t = {call};{releases} {result} made = ({result})nts_nsstring_of(t); nts_release((NtsHeader *)t); nts_callback_leave(); return ({result}){answer};"
        )
    } else if counted && returns_object(&method.signature.result) {
        // An object answered at +0, as a message that is no `new` or
        // `copy` answers under ARC: the compiled method hands over
        // its own count, which goes to the pool. Without counting it
        // owns nothing to give.
        format!(
            "nts_callback_enter();{copies} {result} r = ({result}){call};{releases} nts_callback_leave(); return ({result})objc_autoreleaseReturnValue((void *)r);"
        )
    } else {
        format!("nts_callback_enter();{copies} {result} r = ({result}){call};{releases} nts_callback_leave(); return r;")
    };
    Ok(format!("static {result} {symbol}({}) {{ {body} }}", parameters.join(", ")))
}

/// What every block in the program shares: the layout, the two helpers the
/// block runtime calls on a copy and its final release, and the stack block's
/// class. Then one invoke adapter and one descriptor per signature.
///
/// The layout is `Block_layout` (libclosure's `Block_private.h`) and two
/// captured words: the closure, lent for the call that built the block, and
/// the bridge into its compiled body. A callee that keeps the block copies it;
/// `nts_block_copy` lends the closure again for the copy, and
/// `nts_block_dispose` gives that back when the copy is released. A callee
/// that keeps the block *without* copying it holds a pointer into a frame that
/// is gone, which is the same bug in C.
///
/// **Copy and dispose check the thread.** They touch the closure's count,
/// which only its owning thread may, and they run without the block being
/// invoked (a timer invalidated before it fires still disposes its block).
/// So the guard is here, not only in the bridge an invoke goes through.
/// The Objective-C classes the program writes over a binding's: for each
/// method, the entry point the runtime calls -- `self` and `_cmd`, then the
/// arguments, converted to what the compiled method takes as a callback
/// bridge converts them -- and a table per class, registered before `main` by
/// one constructor, base class first.
pub(super) fn classes(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<(), Diagnostic> {
    let classes = nts_codegen_common::objc::classes_in_order(program);
    if classes.is_empty() {
        return Ok(());
    }
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    writer.line(origin, "/* Objective-C classes the program declares: see `emit/objc.rs`. */");
    let counted = program.provider == nts_core::hir::Provider::ReferenceCounting;
    // `returns_object` holds for an `NSString` result too, which is what a
    // `string` one answers as.
    if counted && classes.iter().flat_map(|class| &class.methods).any(|method| returns_object(&method.signature.result)) {
        writer.line(origin, "extern void *objc_autoreleaseReturnValue(void *value);");
    }
    for class in &classes {
        let mut rows = Vec::new();
        for (at, method) in class.methods.iter().enumerate() {
            let compiled = program
                .funcs
                .iter()
                .find(|func| func.name == method.function)
                .ok_or_else(|| refuse("an Objective-C method whose compiled function this program does not define"))?;
            let symbol = nts_codegen_common::objc::imp_symbol(&class.name, at);
            writer.line(origin, entry_point(program, (method, compiled), &symbol, counted, &refuse)?);
            rows.push(format!(
                "{{ \"{}\", (void (*)(void)){symbol}, \"{}\" }}",
                method.selector(),
                nts_codegen_common::objc::method_encoding(&method.signature)
            ));
        }
        // The fields' maker, which the runtime calls from the `init` it adds,
        // on whatever stack sent `init` -- the platform's included -- so it
        // enters and leaves as an entry point does.
        if let Some(state) = &class.state {
            let compiled = program
                .funcs
                .iter()
                .find(|func| &func.name == state)
                .ok_or_else(|| refuse("an Objective-C class whose fields' maker this program does not define"))?;
            writer.line(
                origin,
                format!(
                    "static void *{}(void) {{ nts_callback_enter(); void *made = (void *){}(); nts_callback_leave(); return made; }}",
                    nts_codegen_common::objc::state_symbol(&class.name),
                    c_identifier(&compiled.name)
                ),
            );
        }
        let table = nts_codegen_common::objc::methods_symbol(&class.name);
        if rows.is_empty() {
            writer.line(origin, format!("static const NtsObjcMethod *const {table} = 0;"));
        } else {
            writer.line(origin, format!("static const NtsObjcMethod {table}[] = {{ {} }};", rows.join(", ")));
        }
    }
    writer.line(origin, "__attribute__((constructor)) static void nts_objc_register_classes(void) {");
    for class in &classes {
        writer.line(
            origin,
            format!(
                "    nts_objc_register_class(\"{}\", \"{}\", {}, {}u, {});",
                class.name,
                class.superclass,
                nts_codegen_common::objc::methods_symbol(&class.name),
                class.methods.len(),
                class.state.as_ref().map_or_else(|| "0".to_owned(), |_| nts_codegen_common::objc::state_symbol(&class.name))
            ),
        );
        for protocol in &class.protocols {
            writer.line(origin, format!("    nts_objc_adopt(\"{}\", \"{protocol}\");", class.name));
        }
    }
    writer.line(origin, "}");
    Ok(())
}

pub(super) fn blocks(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    let signatures = block_signatures(program);
    if signatures.is_empty() {
        return;
    }
    writer.line(origin, "/* Objective-C blocks: see `emit/objc.rs`. */");
    writer.line(
        origin,
        "struct nts_block { void *isa; int flags; int reserved; void *invoke; const void *descriptor; void *context; void *bridge; };",
    );
    writer.line(
        origin,
        "struct nts_block_descriptor { unsigned long reserved; unsigned long size; void (*copy)(void *, const void *); void (*dispose)(const void *); const char *signature; const char *layout; };",
    );
    writer.line(origin, "extern void *_NSConcreteStackBlock[32];");
    // A block returning an object hands it back at +0, as ARC's caller
    // expects (`objc_retainAutoreleasedReturnValue`): the closure's own count
    // of it, which reference counting makes it return, goes to the pool.
    // Without counting the closure owns nothing to give.
    writer.line(origin, "extern void *objc_autoreleaseReturnValue(void *value);");
    writer.line(origin, "#if defined(NTS_PROVIDER_RC)");
    writer.line(origin, "#define NTS_BLOCK_RETURNED(value) objc_autoreleaseReturnValue((void *)(value))");
    writer.line(origin, "#else");
    writer.line(origin, "#define NTS_BLOCK_RETURNED(value) (value)");
    writer.line(origin, "#endif");
    writer.line(origin, "extern void abort(void);");
    writer.line(origin, "extern int dprintf(int descriptor, const char *format, ...);");
    writer.line(origin, "static void nts_block_on_owner(const char *what) {");
    writer.line(origin, "    if (nts_is_owner_thread()) return;");
    writer.line(
        origin,
        "    dprintf(2, \"nts: a block was %s off the thread that owns its closure\\n\", what);",
    );
    writer.line(origin, "    abort();");
    writer.line(origin, "}");
    writer.line(origin, "static void nts_block_copy(void *copy, const void *block) {");
    writer.line(origin, "    (void)copy;");
    writer.line(origin, "    nts_block_on_owner(\"copied\");");
    writer.line(origin, "    (void)nts_closure_lend((NtsHeader *)((const struct nts_block *)block)->context);");
    writer.line(origin, "}");
    // A platform releases a handler on whatever thread called it, and the
    // closure's count is the owning thread's: the release is carried there.
    writer.line(origin, "static void nts_block_dispose(const void *block) {");
    writer.line(origin, "    void *context = ((const struct nts_block *)block)->context;");
    writer.line(origin, "    if (!nts_is_owner_thread()) { nts_block_unlend(context); return; }");
    writer.line(origin, "    nts_closure_unlend(context);");
    writer.line(origin, "}");
    for signature in signatures {
        let result = signature.result.c_type();
        let mut parameters = vec!["void *block".to_owned()];
        let mut bridge_types = Vec::new();
        let mut arguments = Vec::new();
        for (at, ty) in signature.parameters.iter().enumerate() {
            parameters.push(format!("{} a{at}", ty.c_type()));
            bridge_types.push(ty.c_type().into_owned());
            arguments.push(format!("a{at}"));
        }
        bridge_types.push("void *".to_owned());
        arguments.push("b->context".to_owned());
        let give = if matches!(*signature.result, Type::Void) { "" } else { "return " };
        let bridge = format!("(({result} (*)({}))b->bridge)", bridge_types.join(", "));
        let hop = nts_codegen_common::objc::hop_arguments(signature).map(|carried| hop(writer, origin, signature, &carried, &bridge));
        let call = format!("{bridge}({})", arguments.join(", "));
        let call = if returns_object(&signature.result) { format!("({result})NTS_BLOCK_RETURNED({call})") } else { call };
        writer.line(
            origin,
            format!(
                "static {result} {}({}) {{ const struct nts_block *b = block; {}{give}{call}; }}",
                block_invoke_symbol(signature),
                parameters.join(", "),
                hop.unwrap_or_default(),
            ),
        );
        writer.line(
            origin,
            format!(
                "static const struct nts_block_descriptor {} = {{ 0, sizeof(struct nts_block), nts_block_copy, nts_block_dispose, \"{}\", 0 }};",
                block_descriptor_symbol(signature),
                block_encoding(signature)
            ),
        );
    }
}

/// A block called off the thread owning its closure, carried there by the
/// host (`nts_block_carry`): its arguments packed here, the objects' offsets
/// named, and `run` unpacking them on the owning thread into the bridge.
/// Returns the test the invoke adapter starts with.
fn hop(writer: &mut CodeWriter, origin: &Origin, signature: &FnPointer, carried: &[nts_codegen_common::objc::Carried], bridge: &str) -> String {
    use nts_codegen_common::objc::Carried;
    let hop = nts_codegen_common::objc::block_hop_symbol(signature);
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
    arguments.push("b->context".to_owned());
    writer.line(origin, format!("struct {hop} {{ {} }};", fields.join(" ")));
    writer.line(
        origin,
        format!(
            "static void {hop}_run(const void *block, void *arguments) {{ const struct nts_block *b = block; struct {hop} *h = arguments; {bridge}({}); }}",
            arguments.join(", ")
        ),
    );
    let objects_table = if objects.is_empty() {
        "0".to_owned()
    } else {
        writer.line(origin, format!("static const uint32_t {hop}_objects[] = {{ {} }};", objects.join(", ")));
        format!("{hop}_objects")
    };
    format!(
        "if (!nts_is_owner_thread()) {{ struct {hop} h = {{ {} }}; nts_block_carry(block, &h, sizeof h, {objects_table}, {}u, {hop}_run); return; }} ",
        packed.join(", "),
        objects.len()
    )
}

/// Whether a block's result is an Objective-C object, which it hands back at
/// +0.
fn returns_object(result: &Type) -> bool {
    matches!(result, Type::Pointer(nts_core::hir::native::Pointee::Opaque(handle)) if handle.family == nts_core::hir::native::Family::Objc)
}

/// The statements that fill a `NativeBlock`'s frame slot and take its address.
pub(super) fn block_expression(name: &str, invoke: &str, context: &str, signature: &FnPointer) -> String {
    // `BLOCK_HAS_COPY_DISPOSE` and `BLOCK_HAS_SIGNATURE`; a stack block's
    // reference count bits are zero.
    format!(
        "{name}_block.isa = _NSConcreteStackBlock; {name}_block.flags = (1 << 25) | (1 << 30); {name}_block.reserved = 0; \
         {name}_block.invoke = (void *){}; {name}_block.descriptor = &{}; {name}_block.context = {context}; \
         {name}_block.bridge = (void *){invoke}; {name} = &{name}_block;",
        block_invoke_symbol(signature),
        block_descriptor_symbol(signature)
    )
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
    let result = result(&target.result);
    // `[super m]`: from the superclass of the program's class, the receiver
    // unchanged -- and a record returned in memory on x86_64 through
    // `objc_msgSendSuper_stret`, as `objc_msgSend_stret` is for any receiver.
    if let Some(class) = &send.super_of {
        let mut types = vec!["struct nts_objc_super *".to_owned(), "struct objc_selector *".to_owned()];
        types.extend(target.parameters.iter().skip(skip).map(parameter));
        let mut values = vec![
            format!("&(struct nts_objc_super){{ {receiver}, class_getSuperclass({}()) }}", class_symbol(class)),
            format!("{}()", selector_symbol(&send.selector)),
        ];
        values.extend(rest.iter().cloned());
        let entry = match target.result {
            Type::Record(_) => format!("(NTS_OBJC_SUPER_FOR(sizeof({result})))"),
            _ => "objc_msgSendSuper".to_owned(),
        };
        return format!("(({result} (*)({})){entry})({})", types.join(", "), values.join(", "));
    }
    let mut types = vec![receiver_type, "struct objc_selector *".to_owned()];
    types.extend(target.parameters.iter().skip(skip).map(parameter));
    let mut values = vec![receiver, format!("{}()", selector_symbol(&send.selector))];
    values.extend(rest.iter().cloned());
    let entry = match target.result {
        Type::Record(_) => format!("(NTS_OBJC_SEND_FOR(sizeof({result})))"),
        _ => "objc_msgSend".to_owned(),
    };
    format!("(({result} (*)({})){entry})({})", types.join(", "), values.join(", "))
}
