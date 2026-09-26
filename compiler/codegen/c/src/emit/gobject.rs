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

use std::fmt::Write as _;

use nts_core::hir::native::{Family, PROGRAM_GTYPE, Type};
use nts_core::hir::{Callee, ForeignClass, ForeignMethod, OpKind, Program};

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
        if let Some(made) = target.name.strip_prefix("nts_gobject_new_").or_else(|| target.name.strip_prefix(PROGRAM_GTYPE)) {
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
        header(writer, origin, &registered);
    }
    for class in registered {
        let name = &class.name;
        let mut slots = Vec::new();
        // One table per interface the class implements, filled by the
        // methods whose slot is in that interface's struct.
        let mut interfaces: Vec<Vec<String>> = vec![Vec::new(); class.protocols.len()];
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
            let structure = method.selector().split_whitespace().next();
            let table = match class.protocols.iter().position(|interface| interface.split_whitespace().next() == structure) {
                Some(interface) => &mut interfaces[interface],
                None => &mut slots,
            };
            table.push(format!("{{ {offset}u, (void (*)(void)){entry} }}"));
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
        let make_state = state_maker(writer, origin, program, class)?;
        let parent = &class.superclass;
        if !parent.starts_with(PROGRAM_GTYPE) {
            writer.line(origin, format!("size_t {parent}(void);"));
        }
        // Its signals, added to the type the moment it exists: before any
        // instance can be made or connected to.
        let hooks = template(writer, origin, program, class)?;
        let mut signals = registrations(class);
        if !signals.is_empty() {
            writer.line(origin, "unsigned nts_gobject_add_signal(size_t type, const char *name, const char *kinds);");
        }
        signals.push_str(&implementations(writer, origin, class, &interfaces)?);
        if let Some(table) = properties(writer, origin, program, class)? {
            let _ = write!(signals, " nts_gobject_set_properties(type, {table}, {}u);", class.properties.len());
        }
        writer.line(
            origin,
            format!(
                "size_t nts_gobject_type_{name}(void) {{ static size_t type = 0; if (type == 0) {{ \
                 type = nts_gobject_register({parent}(), \"Nts_{name}\", {table}, {}u, {make_state}, {hooks});{signals} }} return type; }}",
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
    let wrote = chains(writer, origin, program, wrote)?;
    let wrote = notifies(writer, origin, program, wrote);
    let wrote = children(writer, origin, program, wrote);
    emits(writer, origin, program, wrote);
    Ok(())
}

/// What the classes' code below needs declared first: the support file's
/// registration calls, the tables' types, and each class's `GType` function.
fn header(writer: &mut CodeWriter, origin: &Origin, registered: &[&ForeignClass]) {
    writer.line(origin, "/* GObject classes the program declares: see `emit/gobject.rs`. */");
    writer.line(
        origin,
        "size_t nts_gobject_register(size_t parent, const char *name, const void *slots, size_t count, void *(*make_state)(void), void (*class_setup)(void *), void (*instance_setup)(void *));",
    );
    writer.line(origin, "void *nts_gobject_new(size_t type);");
    writer.line(origin, "struct nts_gobject_slot { size_t offset; void (*entry)(void); };");
    if registered.iter().any(|class| !class.protocols.is_empty()) {
        writer.line(origin, "void nts_gobject_add_interfaces(size_t type, const void *interfaces, size_t count);");
        writer.line(origin, "struct nts_gobject_interface { size_t (*get_type)(void); const struct nts_gobject_slot *slots; size_t count; };");
    }
    // Each class's `GType` function, before any class names it as a
    // parent or a chain-up calls it. Not `static`: an `instanceof` calls it
    // too, as the native function it is, and that call's prototype is
    // printed with every other native's, above this.
    for class in registered {
        writer.line(origin, format!("size_t {PROGRAM_GTYPE}{}(void);", class.name));
    }
}

/// The interfaces a class implements: each one's table of the slots its
/// methods fill, and the call adding them all to the class's `GType` once it
/// is registered -- in an order `GLib` accepts, which the runtime finds.
fn implementations(writer: &mut CodeWriter, origin: &Origin, class: &ForeignClass, tables: &[Vec<String>]) -> Result<String, Diagnostic> {
    if class.protocols.is_empty() {
        return Ok(String::new());
    }
    let name = &class.name;
    let mut rows = Vec::new();
    for (at, (interface, slots)) in class.protocols.iter().zip(tables).enumerate() {
        let get_type = interface.split_whitespace().nth(1).ok_or_else(|| {
            Diagnostic::error("NTS2006", format!("an interface `{interface}` with no `GType` function"), origin.location)
        })?;
        writer.line(origin, format!("size_t {get_type}(void);"));
        let table = if slots.is_empty() {
            "0".to_owned()
        } else {
            writer.line(origin, format!("static const struct nts_gobject_slot nts_gobject_interface_{name}_{at}[] = {{ {} }};", slots.join(", ")));
            format!("nts_gobject_interface_{name}_{at}")
        };
        rows.push(format!("{{ {get_type}, {table}, {}u }}", slots.len()));
    }
    writer.line(origin, format!("static const struct nts_gobject_interface nts_gobject_interfaces_{name}[] = {{ {} }};", rows.join(", ")));
    Ok(format!(" nts_gobject_add_interfaces(type, nts_gobject_interfaces_{name}, {}u);", rows.len()))
}

/// Each `nts_gobject_child_{Class}_{index}` the program calls -- a read of a
/// child the class's template names -- defined as `gtk_widget_get_template_child`
/// by the child's id, which lends it.
fn children(writer: &mut CodeWriter, origin: &Origin, program: &Program, mut wrote: bool) -> bool {
    let mut done = std::collections::BTreeSet::new();
    for target in program.funcs.iter().flat_map(|func| &func.values).filter_map(|op| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_child_") => Some(target),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let Some((class, index)) = target.name.trim_start_matches("nts_gobject_child_").rsplit_once('_') else { continue };
        let Some(id) = program
            .foreign_classes
            .iter()
            .find(|foreign| foreign.family == Family::GObject && foreign.name == class)
            .and_then(|foreign| foreign.template.as_ref())
            .and_then(|template| template.children.get(index.parse::<usize>().ok()?))
        else {
            continue;
        };
        if !wrote {
            writer.line(origin, "/* GObject classes the program declares: see `emit/gobject.rs`. */");
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(origin, "void *nts_gtk_template_child(void *widget, size_t type, const char *id);");
        }
        let returns = target.result.c_type();
        let instance = target.parameters.first().map_or_else(|| "void *".into(), Type::c_type);
        writer.line(
            origin,
            format!(
                "{returns} {}({instance} a0) {{ return ({returns})nts_gtk_template_child(a0, {PROGRAM_GTYPE}{class}(), {}); }}",
                target.name,
                c_string(id)
            ),
        );
    }
    wrote
}

/// Each `nts_gobject_notify_{Class}_{index}` the program calls -- a write of
/// a property's field -- defined as `g_object_notify_by_pspec` with the
/// property's spec, found once and kept.
fn notifies(writer: &mut CodeWriter, origin: &Origin, program: &Program, mut wrote: bool) -> bool {
    let mut done = std::collections::BTreeSet::new();
    for target in program.funcs.iter().flat_map(|func| &func.values).filter_map(|op| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_notify_") => Some(target),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let Some((class, index)) = target.name.trim_start_matches("nts_gobject_notify_").rsplit_once('_') else { continue };
        if !wrote {
            writer.line(origin, "/* GObject classes the program declares: see `emit/gobject.rs`. */");
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(origin, "void *nts_gobject_property_spec(size_t type, unsigned index);");
            writer.line(origin, "void g_object_notify_by_pspec(void *object, void *pspec);");
        }
        writer.line(
            origin,
            format!(
                "void {}(void *self) {{ static void *spec; if (!spec) spec = nts_gobject_property_spec({PROGRAM_GTYPE}{class}(), {index}u); g_object_notify_by_pspec(self, spec); }}",
                target.name
            ),
        );
    }
    wrote
}

/// A class's template (`static readonly template`): `class_init` sets it and
/// binds each child the class names, and `instance_init` makes the children
/// (`nts_gtk.c`). The two hooks registration passes, `0, 0` without one.
fn template(writer: &mut CodeWriter, origin: &Origin, program: &Program, class: &ForeignClass) -> Result<String, Diagnostic> {
    let Some(template) = &class.template else { return Ok("0, 0".to_owned()) };
    let name = &class.name;
    writer.line(origin, "void nts_gtk_class_template(void *klass, const char *xml, size_t length, const char *const *children, size_t count);");
    writer.line(origin, "void nts_gtk_init_template(void *instance);");
    let binds = callbacks(writer, origin, program, class, &template.callbacks)?;
    let children: Vec<String> = template.children.iter().map(|child| c_string(child)).collect();
    let table = if children.is_empty() {
        "0".to_owned()
    } else {
        writer.line(origin, format!("static const char *const nts_gobject_children_{name}[] = {{ {} }};", children.join(", ")));
        format!("nts_gobject_children_{name}")
    };
    writer.line(
        origin,
        format!(
            "static void nts_gobject_class_setup_{name}(void *klass) {{ nts_gtk_class_template(klass, {}, {}u, {table}, {}u);{binds} }}",
            c_string(&template.xml),
            template.xml.len(),
            children.len()
        ),
    );
    Ok(format!("nts_gobject_class_setup_{name}, nts_gtk_init_template"))
}

/// Each method a template names as a signal's handler: an entry point GTK
/// calls with the signal's arguments and then the instance, its user data,
/// which calls the compiled method with the instance as `this`, entered and
/// left as any entry point is. Returns the calls binding each by name.
fn callbacks(writer: &mut CodeWriter, origin: &Origin, program: &Program, class: &ForeignClass, callbacks: &[ForeignMethod]) -> Result<String, Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    if callbacks.is_empty() {
        return Ok(String::new());
    }
    writer.line(origin, "void nts_gtk_bind_callback(void *klass, const char *name, void (*callback)(void));");
    let name = &class.name;
    let mut binds = String::new();
    for (at, callback) in callbacks.iter().enumerate() {
        let compiled = program
            .funcs
            .iter()
            .find(|func| func.name == callback.function)
            .ok_or_else(|| refuse("a template's handler whose compiled function this program does not define"))?;
        let signature = &callback.signature;
        if compiled.params.len() != signature.parameters.len() {
            return Err(refuse("a template's handler whose entry point and compiled function disagree about arity"));
        }
        let mut parameters = Vec::new();
        let mut arguments = vec![format!("({})self", c_type_of(program, &compiled.params[0].ty, &compiled.params[0].origin)?)];
        for (slot, (ty, want)) in signature.parameters.iter().zip(&compiled.params).enumerate().skip(1) {
            parameters.push(format!("{} a{slot}", ty.c_type()));
            arguments.push(format!("({})a{slot}", c_type_of(program, &want.ty, &want.origin)?));
        }
        parameters.push("void *self".to_owned());
        let call = format!("{}({})", c_identifier(&compiled.name), arguments.join(", "));
        let returns = signature.result.c_type();
        let body = if matches!(*signature.result, Type::Void) {
            format!("nts_callback_enter(); {call}; nts_callback_leave();")
        } else {
            format!("nts_callback_enter(); {returns} r = ({returns}){call}; nts_callback_leave(); return r;")
        };
        let entry = format!("nts_gobject_callback_{name}_{at}");
        writer.line(origin, format!("static {returns} {entry}({}) {{ {body} }}", parameters.join(", ")));
        let handler = callback.selector().trim_start_matches("callback ");
        let _ = write!(binds, " nts_gtk_bind_callback(klass, {}, (void (*)(void)){entry});", c_string(handler));
    }
    Ok(binds)
}

/// The maker of a class's fields, entered and left as an entry point is, or
/// `0` for a class with none.
fn state_maker(writer: &mut CodeWriter, origin: &Origin, program: &Program, class: &ForeignClass) -> Result<String, Diagnostic> {
    let Some(state) = &class.state else { return Ok("0".to_owned()) };
    let compiled = program.funcs.iter().find(|func| &func.name == state).ok_or_else(|| {
        Diagnostic::error("NTS2006", "a GObject class whose fields' maker this program does not define".to_owned(), origin.location)
    })?;
    let name = &class.name;
    writer.line(
        origin,
        format!(
            "static void *nts_gobject_state_maker_{name}(void) {{ nts_callback_enter(); void *made = (void *){}(); nts_callback_leave(); return made; }}",
            c_identifier(&compiled.name)
        ),
    );
    Ok(format!("nts_gobject_state_maker_{name}"))
}

/// A class's properties as the runtime's `get_property` and `set_property`
/// reach them: a wrapper per accessor, entered and left as an entry point is,
/// and the `{ name, kind, get, set }` table registration hands over. `None`
/// for a class with none.
fn properties(writer: &mut CodeWriter, origin: &Origin, program: &Program, class: &ForeignClass) -> Result<Option<String>, Diagnostic> {
    if class.properties.is_empty() {
        return Ok(None);
    }
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let name = &class.name;
    writer.line(origin, "struct nts_gobject_property { const char *name; char kind; void (*get)(void); void (*set)(void); };");
    writer.line(origin, "void nts_gobject_set_properties(size_t type, const void *properties, size_t count);");
    let mut rows = Vec::new();
    for (at, property) in class.properties.iter().enumerate() {
        let find = |wanted: &str| {
            program.funcs.iter().find(|func| func.name == wanted).ok_or_else(|| refuse("a GObject property whose accessor this program does not define"))
        };
        let (get, set) = (find(&property.getter)?, find(&property.setter)?);
        let instance = c_type_of(program, &get.params[0].ty, &get.params[0].origin)?;
        let value = c_type_of(program, &get.return_type, &get.origin)?;
        writer.line(
            origin,
            format!(
                "static {value} nts_gobject_get_{name}_{at}(void *self) {{ nts_callback_enter(); {value} r = {}(({instance})self); nts_callback_leave(); return r; }}",
                c_identifier(&get.name)
            ),
        );
        writer.line(
            origin,
            format!(
                "static void nts_gobject_set_{name}_{at}(void *self, {value} v) {{ nts_callback_enter(); {}(({instance})self, v); nts_callback_leave(); }}",
                c_identifier(&set.name)
            ),
        );
        rows.push(format!(
            "{{ {}, '{}', (void (*)(void))nts_gobject_get_{name}_{at}, (void (*)(void))nts_gobject_set_{name}_{at} }}",
            c_string(&property.name),
            property.kind
        ));
    }
    writer.line(origin, format!("static const struct nts_gobject_property nts_gobject_properties_{name}[] = {{ {} }};", rows.join(", ")));
    Ok(Some(format!("nts_gobject_properties_{name}")))
}

/// The calls adding a class's signals to its `GType`, one per signal.
fn registrations(class: &ForeignClass) -> String {
    let mut out = String::new();
    for signal in &class.signals {
        let _ = write!(out, " nts_gobject_add_signal(type, {}, \"{}\");", c_string(&signal.name), signal.kinds);
    }
    out
}

/// A C string literal: the signal names a program declares are TypeScript
/// property names, which may hold anything a C literal must escape.
fn c_string(text: &str) -> String {
    let mut out = String::from("\"");
    for byte in text.bytes() {
        match byte {
            b'"' | b'\\' => {
                out.push('\\');
                out.push(char::from(byte));
            }
            b' '..=b'~' => out.push(char::from(byte)),
            _ => {
                let _ = write!(out, "\\{byte:03o}");
            }
        }
    }
    out.push('"');
    out
}

/// Each `nts_gobject_emit_{kinds}__{name}` the program calls -- `emit` of a
/// signal a class it wrote declares -- defined as its prototype declares it:
/// `g_signal_emit` by the signal's id, which `nts_gobject_signal_id` finds
/// on the instance's type once and keeps. The name is the thunk's, read
/// back with `_` for `-`, which `GLib` treats as the same signal.
fn emits(writer: &mut CodeWriter, origin: &Origin, program: &Program, mut wrote: bool) {
    let mut done = std::collections::BTreeSet::new();
    for target in program.funcs.iter().flat_map(|func| &func.values).filter_map(|op| match &op.kind {
        OpKind::Call { callee: Callee::Native(target), .. } if target.name.starts_with("nts_gobject_emit_") => Some(target),
        _ => None,
    }) {
        if !done.insert(target.name.clone()) {
            continue;
        }
        let Some((_, signal)) = target.name.trim_start_matches("nts_gobject_emit_").split_once("__") else { continue };
        if !wrote {
            writer.line(origin, "/* GObject classes the program declares: see `emit/gobject.rs`. */");
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(origin, "unsigned nts_gobject_signal_id(void *instance, const char *name, size_t cache[2]);");
            writer.line(origin, "void g_signal_emit(void *instance, unsigned signal, unsigned detail, ...);");
        }
        let parameters: Vec<String> = target.parameters.iter().enumerate().map(|(at, ty)| format!("{} a{at}", ty.c_type())).collect();
        let mut arguments = String::new();
        for at in 1..target.parameters.len() {
            let _ = write!(arguments, ", a{at}");
        }
        writer.line(
            origin,
            format!(
                "void {}({}) {{ static size_t cache[2]; g_signal_emit(a0, nts_gobject_signal_id(a0, {}, cache), 0u{arguments}); }}",
                target.name,
                parameters.join(", "),
                c_string(signal),
            ),
        );
    }
    if wrote {
        writer.blank(origin);
    }
}

/// Each `nts_gobject_chain_{Class}_{offset}` the program calls -- a chain-up,
/// `super.vfunc_clicked()` -- defined as its prototype declares it: the
/// parent's slot at `offset`, called if it is there and skipped if not.
fn chains(writer: &mut CodeWriter, origin: &Origin, program: &Program, mut wrote: bool) -> Result<bool, Diagnostic> {
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
    Ok(wrote)
}
