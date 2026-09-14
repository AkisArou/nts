//! One native-layout inventory for both emitters. C tag collisions are errors,
//! never resolved by whichever declaration happened to be visited first.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use nts_core::hir::{HirType, Program, native::{Pointee, Struct}};

#[derive(Debug, Default)]
pub struct Layouts {
    pub tags: BTreeSet<String>,
    pub structs: BTreeMap<String, Arc<Struct>>,
}

impl Layouts {
    fn visit(&mut self, pointee: &Pointee) -> Result<(), String> {
        match pointee {
            // Neither names a struct this program must define: a scalar has no
            // tag, and `void` has no type at all.
            Pointee::Scalar(_) | Pointee::Void => {}

            // Both name whatever they are a view of, so the struct either one
            // reaches still needs its definition emitted. One arm rather than
            // two identical ones: they differ in what they mean and not in what
            // this has to do about it.
            Pointee::Pointer(pointee) | Pointee::Const(pointee) => self.visit(pointee)?,
            // An array's element may be a struct, and that struct still needs
            // its definition emitted -- stored inline, so before this one.
            Pointee::Array { element, .. } => self.visit(element)?,
            Pointee::Opaque(name) => self.tag(name)?,
            Pointee::Struct(layout) => {
                self.tag(&layout.name)?;
                if let Some(existing) = self.structs.get(&layout.name) {
                    if existing != layout { return Err(format!("conflicting native layouts for C struct `{}`", layout.name)); }
                    return Ok(());
                }
                self.structs.insert(layout.name.clone(), layout.clone());
                for field in &layout.fields {
                    if !super::symbols::is_native_c_identifier(&field.name) {
                        return Err(format!("native field `{}` is not a C member identifier", field.name));
                    }
                    self.visit(&field.ty)?;
                }
            }
        }
        Ok(())
    }

    fn tag(&mut self, name: &str) -> Result<(), String> {
        if !super::symbols::is_native_c_identifier(name) {
            return Err(format!("native pointee `{name}` is not a C struct tag"));
        }
        self.tags.insert(name.to_owned());
        Ok(())
    }
}

/// Collect from lowered values, including closure/object fields. The immutable
/// pointee carried by each value is the source of both ABI and memory layout.
///
/// # Errors
/// A tag has conflicting layouts, or a name cannot be represented in C.
pub fn layouts(program: &Program) -> Result<Layouts, String> {
    let storage = program.funcs.iter().flat_map(|f| &f.values).any(|v| matches!(v.kind,
        nts_core::hir::OpKind::NativeMalloc { .. } | nts_core::hir::OpKind::NativeFree { .. }));
    if storage {
        for op in program.funcs.iter().flat_map(|f| f.blocks.iter().flat_map(|b| b.ops.iter().map(|v| f.value(*v)))) {
            if let nts_core::hir::OpKind::Call { callee: nts_core::hir::Callee::Native(target), .. } = &op.kind
                && matches!(target.name.as_str(), "malloc" | "free" | "nts_native_malloc") {
                return Err(format!("native `{}` collides with the compiler's memory operations; use c:stdlib", target.name));
            }
        }
    }
    let mut found = Layouts::default();
    for ty in program.funcs.iter().flat_map(|func| {
        std::iter::once(&func.return_type).chain(func.params.iter().map(|p| &p.ty)).chain(func.values.iter().map(|v| &v.ty))
    }).chain(program.layouts.iter().flat_map(|l| l.fields.iter().map(|f| &f.ty)))
        .chain(program.globals.iter().map(|g| &g.ty)) {
        if let HirType::NativePointer(pointee) = ty { found.visit(pointee)?; }
    }
    Ok(found)
}
