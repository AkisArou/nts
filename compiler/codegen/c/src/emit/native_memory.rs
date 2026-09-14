//! Native payloads have no managed header. C independently checks the shared
//! layout calculator on every emitted definition.
use super::{CodeWriter, Diagnostic, Origin, Program, Func, OpKind, HirType, value_name};
use nts_core::hir::native::Pointee;

pub(super) fn types(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<(), Diagnostic> {
    let layouts = nts_codegen_common::native::layouts(program)
        .map_err(|why| Diagnostic::error("NTS2006", why, origin.location))?;
    for name in &layouts.tags { writer.line(origin, format!("struct {name};")); }
    for layout in layouts.structs.values() {
        let placed = nts_codegen_common::layout::native_place(layout)
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

pub(super) fn operation(func: &Func, kind: &OpKind, name: &str, origin: &Origin) -> Result<String, Diagnostic> {
    Ok(match *kind {
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
