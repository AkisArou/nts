//! Native payloads have no managed header. C independently checks the shared
//! layout calculator on every emitted definition.
use super::{CodeWriter, Diagnostic, Origin, Program, Func, OpKind, HirType, value_name, native_prototype};
use nts_core::hir::Callee;
use nts_core::hir::native::{Pointee, Type};

pub(super) fn types(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<(), Diagnostic> {
    let layouts = nts_codegen_common::native::layouts(program)
        .map_err(|why| Diagnostic::error("NTS2006", why, origin.location))?;
    for name in &layouts.tags { writer.line(origin, format!("struct {name};")); }
    for layout in layouts.structs.values() {
        let placed = nts_core::hir::layout::native_place(layout)
            .ok_or_else(|| Diagnostic::error("NTS2006", "native struct has no C layout", origin.location))?;
        writer.line(origin, format!("struct {} {{", layout.name));
        for field in &layout.fields { writer.line(origin, format!("    {} {};", field.ty.c_type(), field.name)); }
        writer.line(origin, "};");
        let tag = format!("struct {}", layout.name);
        writer.line(origin, format!("_Static_assert(sizeof({tag}) == {}u, \"native struct size\");", placed.size));
        writer.line(origin, format!("_Static_assert(_Alignof({tag}) == {}u, \"native struct alignment\");", placed.align));
        for (field, offset) in layout.fields.iter().zip(placed.offsets) {
            writer.line(origin, format!("_Static_assert(offsetof({tag}, {}) == {offset}u, \"native field offset\");", field.name));
        }
    }
    Ok(())
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
            format!("{name} = &{}->{};", value_name(pointer), field.name)
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
            writer.line(origin, format!(
                "_Static_assert(_Generic(&((({tag} *)0)->{}), {}: 1, default: 0), \"{}.{} type\");",
                field.name, field.ty.pointer_type(), layout.name, field.name));
        }
        wrote = true;
    }
    let mut declared: std::collections::BTreeMap<&str, String> = std::collections::BTreeMap::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| &func.values[value.0 as usize]) {
            let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
            if !target.parameters.iter().chain(std::iter::once(&target.result)).all(names_only_foreign) { continue; }
            declared.entry(target.name.as_str()).or_insert_with(|| native_prototype(&target.name, target));
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
        Pointee::Pointer(inner) => pointee_is_foreign(inner),
    }
}
