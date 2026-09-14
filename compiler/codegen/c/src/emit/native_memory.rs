//! Native payloads have no managed header. C independently checks the shared
//! layout calculator on every emitted definition.
use super::{CodeWriter, Diagnostic, Origin, Program, Func, OpKind, HirType, value_name, native_prototype, layout_of, c_type_of, c_identifier, return_c_type, static_closure_name, Spelling};
use nts_core::hir::Callee;
use nts_core::hir::native::{Pointee, Type};

/// Whether this program needs a type one of its bindings' headers defines.
///
/// The includes exist to supply *struct definitions*, so a program that names
/// no header-backed struct gets none -- which matters because an include is not
/// free here. `<stdlib.h>` declares `div`, a name a TypeScript program is
/// entitled to export, and the C compiler would then have two incompatible
/// declarations of it. Including only what a layout needs keeps that collision
/// confined to programs that actually describe a C struct, where the alternative
/// is worse: this file defining its own copy of a type a header also defines.
#[must_use]
pub(super) fn needs_headers(program: &Program) -> bool {
    nts_codegen_common::native::layouts(program)
        .is_ok_and(|layouts| layouts.structs.values().any(|layout| layout.from_header))
}

pub(super) fn types(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<(), Diagnostic> {
    let layouts = nts_codegen_common::native::layouts(program)
        .map_err(|why| Diagnostic::error("NTS2006", why, origin.location))?;
    for name in &layouts.tags { writer.line(origin, format!("struct {name};")); }
    // Definition order matters now that a member can be a struct stored inline:
    // C wants a *complete* type for that, and a forward declaration is not one.
    // `layouts.structs` is keyed by name, so emitting in map order put
    // `itimerval` before the `timeval` it contains and produced a translation
    // unit that says `field has incomplete type`.
    //
    // A pointer member needs no such ordering -- that is the whole reason C can
    // have recursive types -- so only inline members constrain this, and a cycle
    // among those is a type C cannot express. The schema already refuses to
    // build one, so an unorderable set here would mean the two disagree; it is
    // reported rather than silently truncated.
    let mut ordered: Vec<&std::sync::Arc<nts_core::hir::native::Struct>> = Vec::new();
    let mut placed: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    // A struct whose binding named a header is complete before this file says
    // anything: the include is above. It is placed first so that one of ours
    // containing it inline is orderable, and it is never defined below.
    for layout in layouts.structs.values() {
        if layout.from_header {
            placed.insert(layout.name.as_str());
            ordered.push(layout);
        }
    }
    while placed.len() < layouts.structs.len() {
        let before = placed.len();
        for layout in layouts.structs.values() {
            if placed.contains(layout.name.as_str()) { continue; }
            let ready = layout.fields.iter().all(|field| match &field.ty {
                Pointee::Struct(inner) => placed.contains(inner.name.as_str()),
                _ => true,
            });
            if ready {
                placed.insert(layout.name.as_str());
                ordered.push(layout);
            }
        }
        if placed.len() == before {
            return Err(Diagnostic::error(
                "NTS2006",
                "native structs contain each other by value, which C cannot lay out",
                origin.location,
            ));
        }
    }
    for layout in ordered {
        let shape = nts_core::hir::layout::native_place(layout)
            .ok_or_else(|| Diagnostic::error("NTS2006", "native struct has no C layout", origin.location))?;
        // Asserted for every native struct, whether defined here or included.
        // For one of ours both sides come from a single field list and this
        // only checks the arithmetic; for a header's, the C compiler answers
        // about the real type, which makes it the strongest check emitted.
        if layout.from_header {
            layout_asserts(writer, origin, layout, &shape);
            continue;
        }
        writer.line(origin, format!("struct {} {{", layout.name));
        for field in &layout.fields {
            // C spells an array's length in the *declarator*, after the name:
            // `uint8_t bytes[8]`, never `uint8_t[8] bytes`. A type spelling
            // alone cannot carry it, which is why it is written here and why
            // `Pointee::Array::c_type` answers with the element.
            let suffix = match &field.ty {
                Pointee::Array { length, .. } => format!("[{length}]"),
                _ => String::new(),
            };
            writer.line(origin, format!("    {} {}{suffix};", field.ty.c_type(), field.name));
        }
        writer.line(origin, "};");
        layout_asserts(writer, origin, layout, &shape);
    }
    Ok(())
}

/// The size, alignment and offsets this program believes, put to the C compiler.
fn layout_asserts(
    writer: &mut CodeWriter,
    origin: &Origin,
    layout: &nts_core::hir::native::Struct,
    shape: &nts_core::hir::layout::Placement,
) {
    let tag = format!("struct {}", layout.name);
    writer.line(origin, format!("_Static_assert(sizeof({tag}) == {}u, \"native struct size\");", shape.size));
    writer.line(origin, format!("_Static_assert(_Alignof({tag}) == {}u, \"native struct alignment\");", shape.align));
    for (field, offset) in layout.fields.iter().zip(&shape.offsets) {
        writer.line(origin, format!("_Static_assert(offsetof({tag}, {}) == {offset}u, \"native field offset\");", field.name));
    }
}

pub(super) fn operation(func: &Func, kind: &OpKind, result: &HirType, name: &str, origin: &Origin) -> Result<String, Diagnostic> {
    Ok(match *kind {
        OpKind::NativeLocal { .. } => format!("memset({name}_storage, 0, sizeof {name}_storage); {name} = {name}_storage;"),
        OpKind::NativeMalloc { bytes } => {
            let HirType::NativePointer(element) = result else { return Err(Diagnostic::error("NTS2006", "malloc needs a native layout", origin.location)); };
            let minimum = nts_core::hir::layout::native_shape(element).ok_or_else(|| Diagnostic::error("NTS2006", "malloc needs a native layout", origin.location))?.size;
            let call = format!("nts_native_malloc({}, {minimum});", value_name(bytes));
            // Like an ordinary effectful call, an ignored allocation result
            // needs no C local. Keep the call even when its value is unused.
            if name.is_empty() { call } else { format!("{name} = {call}") }
        },
        OpKind::NativeFree { pointer } => format!("free({});", value_name(pointer)),
        OpKind::NativeLoad { pointer, index } => format!("{name} = {}[{}];", value_name(pointer), value_name(index)),
        OpKind::NativeStore { pointer, index, value } => format!("{}[{}] = {};", value_name(pointer), value_name(index), value_name(value)),
        OpKind::NativeIndexAddress { pointer, index } => format!("{name} = {} + {};", value_name(pointer), value_name(index)),
        OpKind::NativeFieldAddress { pointer, field } => {
            let HirType::NativePointer(Pointee::Struct(layout)) = &func.value(pointer).ty else {
                return Err(Diagnostic::error("NTS2006", "field address without a native struct", origin.location));
            };
            let field = layout.fields.get(field as usize)
                .ok_or_else(|| Diagnostic::error("NTS2006", "invalid native field index", origin.location))?;
            // An array member is already an address: `p->name` decays to a
            // pointer to its first element, and `&p->name` is a pointer to the
            // *array*, which is a different type C will not assign across.
            match &field.ty {
                Pointee::Array { .. } => format!("{name} = {}->{};", value_name(pointer), field.name),
                _ => format!("{name} = &{}->{};", value_name(pointer), field.name),
            }
        }
        _ => unreachable!("only native memory operations are routed here"),
    })
}

pub(super) fn helpers(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    if program.funcs.iter().any(|f| f.values.iter().any(|v| matches!(v.kind, OpKind::NativeMalloc { .. }))) {
        writer.line(origin, "extern void *malloc(size_t); ");
        writer.line(origin, "static inline void *nts_native_malloc(double bytes, size_t minimum) {");
        writer.line(origin, "    if (!(bytes >= (double)minimum && bytes <= 9007199254740991.0) || trunc(bytes) != bytes) return NULL;");
        writer.line(origin, "    return malloc((size_t)bytes);");
        writer.line(origin, "}");
    }
    if program.funcs.iter().any(|f| f.values.iter().any(|v| matches!(v.kind, OpKind::NativeFree { .. }))) {
        writer.line(origin, "extern void free(void *);");
    }
}

/// What this program believes about foreign types and functions, in a form that
/// a translation unit including the real headers can refuse.
///
/// The assertions in `program.c` do check the layout calculator against C's --
/// but for the struct *this program declared*, since both sides are computed
/// from one field list. They cannot notice that the declaration disagrees with
/// the library it names. This carries the same claims to where the real
/// declarations are visible, and adds the two that layout numbers cannot
/// express:
///
/// - `_Generic` over the **address** of each field. A field's own qualifiers do
///   not survive lvalue conversion -- a `const int` member answers `int` -- so
///   the value form accepts a declaration that silently drops the `const`.
/// - the prototype, because an incompatible redeclaration is an error. A call
///   expression that merely compiles is not the same check: the arguments of
///   `poll(p, n, t)` convert, so a wrong parameter width still builds.
///
/// Size, alignment and offsets do not settle it on their own. Changing a
/// field's signedness, or its pointee to another type of the same width, moves
/// none of those numbers, so a witness built only from them passes a schema
/// that is wrong about every value read through it.
///
/// There are no `#include` lines for the bindings. Which header declares
/// `poll`, under which target, sysroot and defines, is the consumer's fact and
/// not this program's; inventing one here would assert something nobody told
/// us. `<stddef.h>` is not an exception to that -- `offsetof` is the assertion
/// mechanism itself, not a binding.
///
/// Only foreign declarations appear. A layout this program invented names
/// nothing outside it, so there is no header to ask about it, and naming it
/// here would make the witness fail for a disagreement that cannot exist.
///
/// # Errors
///
/// If a native layout has no C placement. `types` reports that first for the
/// same layouts; this cannot be the only place it is noticed.
pub(super) fn witness(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<bool, Diagnostic> {
    let layouts = nts_codegen_common::native::layouts(program)
        .map_err(|why| Diagnostic::error("NTS2006", why, origin.location))?;
    let mut wrote = false;
    for layout in layouts.structs.values() {
        if !layout.foreign { continue; }
        let placed = nts_core::hir::layout::native_place(layout)
            .ok_or_else(|| Diagnostic::error("NTS2006", "native struct has no C layout", origin.location))?;
        let tag = format!("struct {}", layout.name);
        writer.line(origin, format!("_Static_assert(sizeof({tag}) == {}u, \"{} size\");", placed.size, layout.name));
        writer.line(origin, format!("_Static_assert(_Alignof({tag}) == {}u, \"{} alignment\");", placed.align, layout.name));
        for (field, offset) in layout.fields.iter().zip(placed.offsets) {
            writer.line(origin, format!(
                "_Static_assert(offsetof({tag}, {}) == {offset}u, \"{}.{} offset\");",
                field.name, layout.name, field.name));
            // The address of a member, spelled as its own type. An array's is
            // `T (*)[N]` -- a pointer to the array, not to an element -- and
            // writing `T *` there would assert something true of a decayed
            // value and not of the member, which is what is being checked.
            let address = match &field.ty {
                Pointee::Array { element, length } => {
                    format!("{} (*)[{length}]", element.c_type())
                }
                other => other.pointer_type(),
            };
            writer.line(origin, format!(
                "_Static_assert(_Generic(&((({tag} *)0)->{}), {address}: 1, default: 0), \"{}.{} type\");",
                field.name, layout.name, field.name));
        }
        wrote = true;
    }
    let mut declared: std::collections::BTreeMap<&str, String> = std::collections::BTreeMap::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| &func.values[value.0 as usize]) {
            let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
            if !target.parameters.iter().chain(std::iter::once(&target.result)).all(names_only_foreign) { continue; }
            declared
                .entry(target.name.as_str())
                .or_insert_with(|| native_prototype(&target.name, target, Spelling::Expanded));
        }
    }
    for prototype in declared.values() {
        writer.line(origin, format!("extern {prototype}"));
        wrote = true;
    }
    Ok(wrote)
}

/// Whether every struct this type names is one a header defines.
///
/// A prototype mentioning a layout invented for this program would name a tag
/// no header declares, and the witness would fail to compile for a reason that
/// is not a disagreement about anything.
fn names_only_foreign(ty: &Type) -> bool {
    match ty {
        Type::Pointer(pointee) => pointee_is_foreign(pointee),
        Type::Scalar(_) | Type::Bool | Type::Void => true,
        // A function pointer names whatever its own signature names, so it is
        // witnessable exactly when every part of that signature is.
        Type::FnPointer(signature) => signature
            .parameters
            .iter()
            .chain(std::iter::once(&*signature.result))
            .all(names_only_foreign),
        Type::Managed(_) | Type::Erased | Type::BigInt => false,
    }
}

fn pointee_is_foreign(pointee: &Pointee) -> bool {
    match pointee {
        // None of these names a struct this program invented: a scalar and
        // `void` name no struct at all, and an opaque tag names one the
        // declaration authored -- a header defines it or the witness will say so.
        Pointee::Scalar(_) | Pointee::Opaque(_) | Pointee::Void => true,
        Pointee::Struct(layout) => layout.foreign,
        Pointee::Pointer(inner) | Pointee::Const(inner) | Pointee::Array { element: inner, .. } => {
            pointee_is_foreign(inner)
        }
    }
}

/// The C name of the bridge for one function reached through one signature.
///
/// Both halves are in it because neither alone identifies the bridge: the same
/// function can be handed to two callbacks with different C signatures, and two
/// functions can share one signature.
pub(super) fn bridge_name(target: &str, signature: &nts_core::hir::native::FnPointer) -> String {
    format!("NtsBridge_{}_{}", c_identifier(target), signature.name)
}

/// The typedefs and definitions the program's `NativeBridge` operations need.
///
/// A bridge is a real C function with the foreign signature that calls the
/// compiled one, which is the only honest way across: a TypeScript function
/// value is a managed closure object, and C wants something it can call.
///
/// Emitted from a walk of the operations rather than from a list built at
/// lowering, so the set cannot drift from the uses.
///
/// # Errors
///
/// If a bridge's closure has no method, if the function it names is not in this
/// program, or if the foreign signature and the compiled function disagree
/// about arity.
pub(super) fn bridges(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<bool, Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let mut wanted: std::collections::BTreeMap<String, (std::sync::Arc<nts_core::hir::native::FnPointer>, &Func, String)> =
        std::collections::BTreeMap::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| &func.values[value.0 as usize]) {
            let OpKind::NativeBridge { closure, signature } = &op.kind else { continue };
            let layout = layout_of(program, &func.values[closure.0 as usize].ty, origin)?;
            let target = layout
                .methods
                .first()
                .and_then(|method| method.as_deref())
                .ok_or_else(|| refuse(&format!(
                    "a callback bridge whose closure publishes no function (layout `{}`, {} method slot(s))",
                    layout.name,
                    layout.methods.len()
                )))?;
            let compiled = program
                .funcs
                .iter()
                .find(|candidate| candidate.name == target)
                .ok_or_else(|| refuse("a callback bridge naming a function this program does not define"))?;
            // The closure's call method takes the closure as its first
            // parameter -- that is how every call through one works -- so the
            // bridge supplies it and the foreign signature describes the rest.
            if compiled.params.len() != signature.parameters.len() + 1 {
                return Err(refuse("a callback bridge whose foreign signature and compiled function disagree about arity"));
            }
            wanted.insert(
                bridge_name(target, signature),
                (signature.clone(), compiled, static_closure_name(layout)),
            );
        }
    }
    if wanted.is_empty() {
        return Ok(false);
    }
    for (name, (signature, compiled, receiver)) in &wanted {
        let mut parameters = Vec::new();
        // The receiver is the static closure itself: one immortal object per
        // closure with no captured state, which is exactly why only a
        // non-capturing function may be bridged.
        let mut arguments = vec![format!("&{receiver}")];
        for (at, ty) in signature.parameters.iter().enumerate() {
            let slot = format!("a{at}");
            parameters.push(format!("{} {slot}", ty.c_type()));
            // The compiled function takes the managed representation -- a
            // `number` is a `double` there and an `int` here -- so each argument
            // is converted on the way in and the result on the way out. C's own
            // conversions do the work; what this supplies is the target type,
            // which is the compiled function's and not the foreign one's.
            let want = c_type_of(program, &compiled.params[at + 1].ty, &compiled.params[at + 1].origin)?;
            arguments.push(format!("({want}){slot}"));
        }
        let parameters = if parameters.is_empty() { "void".to_owned() } else { parameters.join(", ") };
        let call = format!("{}({})", c_identifier(&compiled.name), arguments.join(", "));
        let result = signature.result.c_type();
        // `nts_callback_enter` around the call, so a `throw` inside it stops
        // here instead of jumping past the C frames that called us. They belong
        // to a library that knows nothing about a non-local jump, and a C
        // function pointer's signature has no error channel to deliver one
        // through -- inventing a return value would be worse than stopping,
        // since a comparator answering 0 because it failed sorts wrongly and
        // says nothing.
        let body = if matches!(&*signature.result, nts_core::hir::native::Type::Void) {
            format!("nts_callback_enter(); {call}; nts_callback_leave();")
        } else {
            let _ = return_c_type(program, &compiled.return_type, &compiled.origin)?;
            format!(
                "nts_callback_enter(); {result} r = ({result}){call}; nts_callback_leave(); return r;"
            )
        };
        writer.line(origin, format!("static {result} {name}({parameters}) {{ {body} }}"));
    }
    Ok(true)
}

/// Every C function pointer typedef this program's foreign signatures need.
///
/// Separate from the bridge definitions and emitted much earlier, because a
/// *prototype* mentions the typedef: `int takes(NtsFn_int_int);` is a syntax
/// error before the typedef exists, and C reads it as an old-style parameter
/// list rather than reporting the missing name. The same ordering trap as an
/// inline struct member, in a different spelling.
///
/// Walked from the signatures rather than from a list built alongside them, so
/// a signature that reaches a prototype cannot fail to reach this.
pub(super) fn function_pointer_types(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    let mut seen: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| &func.values[value.0 as usize]) {
            let nts_core::hir::OpKind::Call { callee: nts_core::hir::Callee::Native(target), .. } = &op.kind else {
                continue;
            };
            for ty in target.parameters.iter().chain(std::iter::once(&target.result)) {
                if let nts_core::hir::native::Type::FnPointer(signature) = ty {
                    seen.insert(signature.name.clone(), signature.typedef());
                }
            }
        }
    }
    for typedef in seen.values() {
        writer.line(origin, typedef.clone());
    }
}
