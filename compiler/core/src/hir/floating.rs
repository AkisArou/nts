//! A `GObject` a never-free program receives is the program's to keep.
//!
//! Under reference counting the program's first retain of a `GObject` is
//! `g_object_ref_sink` (the family's counting, `native::Family::GObject`), so
//! a widget born floating becomes the program's the moment it holds one.
//! Without counting nothing retains, and a floating widget belonged to the
//! first container it was put in -- which finalized it on letting go while a
//! TypeScript name still held it (react-gtk's list: a label taken out of its
//! row and put back).
//!
//! So a never-free program takes the floating reference of every `GObject` a
//! foreign call hands it (`nts_gobject_made`), and gives it back never, as it
//! gives back nothing else. Every foreign call, not only a constructor: a
//! handle that is not floating is left alone at run time, and one that is was
//! made for this caller whatever the function is called. Nothing is inserted
//! under counting, which sinks already.

use super::{Callee, HirType, Op, OpKind, Program, ValueId};

/// Insert `nts_gobject_made` after each foreign call answering a `GObject`.
/// Returns how many were inserted.
pub fn sink(program: &mut Program) -> usize {
    let mut inserted = 0;
    for func in &mut program.funcs {
        for at in 0..func.blocks.len() {
            let ops = std::mem::take(&mut func.blocks[at].ops);
            let mut rebuilt = Vec::with_capacity(ops.len());
            for value in ops {
                rebuilt.push(value);
                let op = &func.values[value.0 as usize];
                let answers_a_gobject = matches!(op.kind, OpKind::Call { callee: Callee::Native(_), .. })
                    && matches!(&op.ty, HirType::NativePointer(pointee) if pointee.family() == Some(super::native::Family::GObject));
                if !answers_a_gobject {
                    continue;
                }
                let origin = op.origin.clone();
                let made = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
                func.values.push(Op {
                    kind: OpKind::Call { callee: Callee::External("nts_gobject_made".to_owned()), args: vec![value], frame: None },
                    ty: HirType::Void,
                    origin,
                });
                rebuilt.push(made);
                inserted += 1;
            }
            func.blocks[at].ops = rebuilt;
        }
    }
    inserted
}
