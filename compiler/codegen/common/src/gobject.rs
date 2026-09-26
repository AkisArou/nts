//! What both backends ask of the `GObject` classes a program writes.

use nts_core::hir::native::{Family, PROGRAM_GTYPE};
use nts_core::hir::{Callee, ForeignClass, OpKind, Program};

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
    let gobject = |name: &str| program.foreign_classes.iter().find(|class| class.family == Family::GObject && class.name == name);
    let mut wanted: Vec<&str> = Vec::new();
    for op in program.funcs.iter().flat_map(|func| &func.values) {
        let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
        let name = target.name.as_str();
        if let Some(made) = name.strip_prefix("nts_gobject_new_").or_else(|| name.strip_prefix(PROGRAM_GTYPE)) {
            wanted.push(made);
        } else if let Some((class, _)) =
            name.strip_prefix("nts_gobject_notify_").or_else(|| name.strip_prefix("nts_gobject_child_")).and_then(|rest| rest.rsplit_once('_'))
        {
            wanted.push(class);
        } else if let Some((class, _)) = name.strip_prefix("nts_gobject_chain_").and_then(|rest| rest.rsplit_once('_')) {
            wanted.extend(gobject(class).and_then(|class| class.superclass.strip_prefix(PROGRAM_GTYPE)));
        }
    }
    let mut order: Vec<&ForeignClass> = Vec::new();
    for name in wanted {
        let mut chain = Vec::new();
        let mut at = gobject(name);
        while let Some(class) = at.filter(|class| !order.iter().chain(&chain).any(|seen| seen.name == class.name)) {
            chain.push(class);
            at = class.superclass.strip_prefix(PROGRAM_GTYPE).and_then(gobject);
        }
        order.extend(chain.into_iter().rev());
    }
    order
}
