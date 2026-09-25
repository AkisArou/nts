//! `GObject` classes the program writes: `class Counter extends GtkButton`.
//!
//! Each is a `GType` of its own, registered the first time one is made --
//! `GObject`'s own convention, `*_get_type` registering lazily -- so there is
//! no constructor to run before `main` and nothing to order against other
//! classes: a parent is registered by its own `get_type` when the child's
//! asks for it. Per class, only when the program makes one:
//!
//! - an entry point per `vfunc_` override, defined as exactly the class
//!   struct slot's type, converting to what the compiled method takes;
//! - a table of `{ offset, entry point }`, the offset `offsetof` of the slot
//!   as the binding recorded it (`@ntsVfunc GtkButtonClass clicked 408`) and
//!   its witness checked, which the support file's `class_init` writes --
//!   so `program.c`, which does not include `GLib`'s headers, never needs a
//!   class struct's type;
//! - `nts_gobject_type_{Class}`, registering `Nts_{Class}` below the parent's
//!   `get_type` (`nts_gobject_register`), as GJS registers its `Gjs_{Class}`;
//! - `nts_gobject_new_{Class}`, which the lowering calls for `new`: one
//!   reference the caller owns (`nts_gobject_new` sinks a floating one).
//!
//! A class over one the program wrote (`class Derived extends Base`) names
//! `nts_gobject_type_Base` as its parent, so `Base` is registered wherever a
//! `Derived` is made, whether or not the program makes a `Base` itself.

use nts_core::hir::native::{Family, PROGRAM_GTYPE, Type};
use nts_core::hir::{Callee, ForeignClass, OpKind, Program};

use super::{CodeWriter, Diagnostic, Origin, c_identifier, c_type_of};

/// The classes the program writes whose `GType` it needs: each it makes, each
/// a chain-up reaches the parent of, and each one of those's ancestors that
/// the program wrote too. Parents first, as nothing requires but a reader
/// expects.
pub(crate) fn registered(program: &Program) -> Vec<&ForeignClass> {
    let gobject = |name: &str| program.foreign_classes.iter().find(|class| class.family == Family::GObject && class.name == name);
    let mut wanted: Vec<&str> = Vec::new();
    for op in program.funcs.iter().flat_map(|func| &func.values) {
        let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
        if let Some(made) = target.name.strip_prefix("nts_gobject_new_") {
            wanted.push(made);
        } else if let Some((class, _)) = target.name.strip_prefix("nts_gobject_chain_").and_then(|rest| rest.rsplit_once('_')) {
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

pub(super) fn classes(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<(), Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let registered = registered(program);
    let wrote = !registered.is_empty();
    if wrote {
        writer.line(origin, "/* GObject classes the program declares: see `emit/gobject.rs`. */");
        writer.line(
            origin,
            "size_t nts_gobject_register(size_t parent, const char *name, const void *slots, size_t count, void *(*make_state)(void));",
        );
        writer.line(origin, "void *nts_gobject_new(size_t type);");
        writer.line(origin, "struct nts_gobject_slot { size_t offset; void (*entry)(void); };");
        // Each class's `GType` function, before any class names it as a
        // parent or a chain-up calls it.
        for class in &registered {
            writer.line(origin, format!("static size_t {PROGRAM_GTYPE}{}(void);", class.name));
        }
    }
    for class in registered {
        let name = &class.name;
        let mut slots = Vec::new();
        for (at, method) in class.methods.iter().enumerate() {
            let compiled = program
                .funcs
                .iter()
                .find(|func| func.name == method.function)
                .ok_or_else(|| refuse("a GObject virtual function whose compiled function this program does not define"))?;
            if compiled.params.len() != method.signature.parameters.len() {
                return Err(refuse("a GObject virtual function whose entry point and compiled function disagree about arity"));
            }
            if method.signature.parameters.iter().chain(std::iter::once(&*method.signature.result)).any(|ty| matches!(ty, Type::Record(_))) {
                return Err(refuse("a GObject virtual function taking or returning a record by value"));
            }
            let offset = method
                .selector()
                .split_whitespace()
                .nth(2)
                .ok_or_else(|| refuse("a GObject virtual function whose slot has no offset"))?;
            let mut parameters = Vec::new();
            let mut arguments = Vec::new();
            for (slot, (ty, want)) in method.signature.parameters.iter().zip(&compiled.params).enumerate() {
                parameters.push(format!("{} a{slot}", ty.c_type()));
                arguments.push(format!("({})a{slot}", c_type_of(program, &want.ty, &want.origin)?));
            }
            let call = format!("{}({})", c_identifier(&compiled.name), arguments.join(", "));
            let entry = format!("nts_gobject_{name}_{at}");
            let returns = method.signature.result.c_type();
            let body = if matches!(*method.signature.result, Type::Void) {
                format!("nts_callback_enter(); {call}; nts_callback_leave();")
            } else {
                format!("nts_callback_enter(); {returns} r = ({returns}){call}; nts_callback_leave(); return r;")
            };
            writer.line(origin, format!("static {returns} {entry}({}) {{ {body} }}", parameters.join(", ")));
            slots.push(format!("{{ {offset}u, (void (*)(void)){entry} }}"));
        }
        let table = if slots.is_empty() {
            "0".to_owned()
        } else {
            writer.line(origin, format!("static const struct nts_gobject_slot nts_gobject_slots_{name}[] = {{ {} }};", slots.join(", ")));
            format!("nts_gobject_slots_{name}")
        };
        // The fields' maker, which `instance_init` calls wherever GTK makes
        // one -- a builder file's included -- so it enters and leaves as an
        // entry point does.
        let make_state = match &class.state {
            Some(state) => {
                let compiled = program
                    .funcs
                    .iter()
                    .find(|func| &func.name == state)
                    .ok_or_else(|| refuse("a GObject class whose fields' maker this program does not define"))?;
                writer.line(
                    origin,
                    format!(
                        "static void *nts_gobject_state_maker_{name}(void) {{ nts_callback_enter(); void *made = (void *){}(); nts_callback_leave(); return made; }}",
                        c_identifier(&compiled.name)
                    ),
                );
                format!("nts_gobject_state_maker_{name}")
            }
            None => "0".to_owned(),
        };
        let parent = &class.superclass;
        if !parent.starts_with(PROGRAM_GTYPE) {
            writer.line(origin, format!("size_t {parent}(void);"));
        }
        writer.line(
            origin,
            format!(
                "static size_t nts_gobject_type_{name}(void) {{ static size_t type = 0; if (type == 0) \
                 type = nts_gobject_register({parent}(), \"Nts_{name}\", {table}, {}u, {make_state}); return type; }}",
                slots.len()
            ),
        );
        // What `new` makes, as the lowering spelled it: the prototype the
        // program already declares, which this definition has to match. An
        // ancestor made only through its descendants has none.
        let make = format!("nts_gobject_new_{name}");
        if let Some(result) = program.funcs.iter().flat_map(|func| &func.values).find_map(|op| match &op.kind {
            OpKind::Call { callee: Callee::Native(target), .. } if target.name == make => Some(target.result.c_type()),
            _ => None,
        }) {
            writer.line(origin, format!("{result} {make}(void) {{ return ({result})nts_gobject_new(nts_gobject_type_{name}()); }}"));
        }
    }
    chains(writer, origin, program, wrote)?;
    Ok(())
}

/// Each `nts_gobject_chain_{Class}_{offset}` the program calls -- a chain-up,
/// `super.vfunc_clicked()` -- defined as its prototype declares it: the
/// parent's slot at `offset`, called if it is there and skipped if not.
fn chains(writer: &mut CodeWriter, origin: &Origin, program: &Program, mut wrote: bool) -> Result<(), Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let mut done = std::collections::BTreeSet::new();
    for target in program.funcs.iter().flat_map(|func| &func.values).filter_map(|op| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_chain_") => Some(target),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let (class, offset) = target
            .name
            .trim_start_matches("nts_gobject_chain_")
            .rsplit_once('_')
            .ok_or_else(|| refuse("a chain-up whose name does not say its class and slot"))?;
        let parent = program
            .foreign_classes
            .iter()
            .find(|foreign| foreign.family == Family::GObject && foreign.name == class)
            .map(|foreign| foreign.superclass.clone())
            .ok_or_else(|| refuse("a chain-up in a class this program does not register"))?;
        if target.parameters.iter().chain(std::iter::once(&target.result)).any(|ty| matches!(ty, Type::Record(_))) {
            return Err(refuse("a chain-up to a virtual function taking or returning a record by value"));
        }
        if !wrote {
            writer.line(origin, "/* GObject classes the program declares: see `emit/gobject.rs`. */");
            wrote = true;
        }
        writer.line(origin, "void *nts_gobject_parent_slot(size_t parent, size_t offset);");
        if !parent.starts_with(PROGRAM_GTYPE) {
            writer.line(origin, format!("size_t {parent}(void);"));
        }
        let parameters: Vec<String> = target.parameters.iter().enumerate().map(|(at, ty)| format!("{} a{at}", ty.c_type())).collect();
        let types: Vec<String> = target.parameters.iter().map(|ty| ty.c_type().into_owned()).collect();
        let arguments: Vec<String> = (0..target.parameters.len()).map(|at| format!("a{at}")).collect();
        let returns = target.result.c_type();
        let call = format!("(({returns} (*)({}))slot)({})", types.join(", "), arguments.join(", "));
        let body = if matches!(target.result, Type::Void) {
            format!("if (slot) {call};")
        } else {
            format!("return slot ? {call} : ({returns})0;")
        };
        writer.line(
            origin,
            format!(
                "{returns} {}({}) {{ void *slot = nts_gobject_parent_slot({parent}(), {offset}u); {body} }}",
                target.name,
                parameters.join(", ")
            ),
        );
    }
    if wrote {
        writer.blank(origin);
    }
    Ok(())
}
