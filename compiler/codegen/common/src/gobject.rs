//! What both backends ask of the `GObject` classes a program writes.

use nts_core::hir::native::{Family, Function, GObjectThunk};
use nts_core::hir::{Callee, ForeignClass, OpKind, Program};

/// Only genuine lowering producers enter the generated-function inventory.
pub fn thunks(program: &Program) -> impl Iterator<Item = (&Function, &GObjectThunk)> {
    program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter_map(|op| {
            let OpKind::Call {
                callee: Callee::Native(target),
                ..
            } = &op.kind
            else {
                return None;
            };
            target.thunk.as_ref().map(|thunk| (target.as_ref(), thunk))
        })
}

/// The classes the program writes whose `GType` it needs: each it makes, each
/// a thunk of its own reads the type of -- a property's notify, a template
/// child's read -- each a chain-up reaches the parent of, and each one of
/// those's ancestors the program wrote too. Parents first, as nothing
/// requires but a reader expects.
///
/// A class's thunks can outlive every `new` of it: a program whose makers the
/// lowering refused still calls a setter's notify, which asks for the type.
#[must_use]
pub fn registered(program: &Program) -> Vec<&ForeignClass> {
    let gobject = |name: &str| {
        program
            .foreign_classes
            .iter()
            .find(|class| class.family == Family::GObject && class.name == name)
    };
    let mut wanted: Vec<&str> = Vec::new();
    for (_, thunk) in thunks(program) {
        match thunk {
            GObjectThunk::Type { class }
            | GObjectThunk::New { class }
            | GObjectThunk::Child { class, .. }
            | GObjectThunk::Notify { class, .. } => {
                wanted.push(class.as_str());
            }
            GObjectThunk::Chain { class, .. } => wanted.extend(
                gobject(class)
                    .and_then(|class| class.superclass.gtype())
                    .and_then(nts_core::hir::native::GType::program_class),
            ),
            GObjectThunk::Signal { .. } | GObjectThunk::Property { .. } => {}
        }
    }
    let mut order: Vec<&ForeignClass> = Vec::new();
    for name in wanted {
        let mut chain = Vec::new();
        let mut at = gobject(name);
        while let Some(class) = at.filter(|class| {
            !order
                .iter()
                .chain(&chain)
                .any(|seen| seen.name == class.name)
        }) {
            chain.push(class);
            at = class
                .superclass
                .gtype()
                .and_then(nts_core::hir::native::GType::program_class)
                .and_then(gobject);
        }
        order.extend(chain.into_iter().rev());
    }
    order
}
