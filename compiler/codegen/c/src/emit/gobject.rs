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
//!   as the binding recorded it (`@ntsVfunc GtkButtonClass clicked 408`),
//!   which the support file's `class_init` writes -- so `program.c`, which
//!   does not include `GLib`'s headers, never needs a class struct's type.
//!   The witness asks the headers the program is built with whether the slot
//!   is there and of the entry's type (`slot_claims`): the binder asked the
//!   headers it was bound against, which need not be the same;
//! - `nts_gobject_type_{Class}`, registering `Nts_{Class}` below the parent's
//!   `get_type` (`nts_gobject_register`), as GJS registers its `Gjs_{Class}`;
//! - `nts_gobject_new_{Class}`, which the lowering calls for `new`: one
//!   reference the caller owns (`nts_gobject_new` sinks a floating one).
//!
//! A class over one the program wrote (`class Derived extends Base`) names
//! `nts_gobject_type_Base` as its parent, so `Base` is registered wherever a
//! `Derived` is made, whether or not the program makes a `Base` itself.

use std::fmt::Write as _;

use super::Emission as Program;
use nts_core::hir::native::{Family, FnPointer, GObjectThunk, GType, PropertyOperation, Type};
use nts_core::hir::{Callee, ForeignClass, ForeignMethod, OpKind, TemplateText};

use super::c_string;

use super::{CodeWriter, Diagnostic, Origin, c_type_of};

#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
pub(super) fn classes(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
) -> Result<(), Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let registered = nts_codegen_common::gobject::registered(program);
    let wrote = !registered.is_empty();
    if wrote {
        header(writer, origin, program, &registered);
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
                return Err(refuse(
                    "a GObject virtual function whose entry point and compiled function disagree about arity",
                ));
            }
            if method
                .signature
                .parameters
                .iter()
                .chain(std::iter::once(&*method.signature.result))
                .any(|ty| matches!(ty, Type::Record(_)))
            {
                return Err(refuse(
                    "a GObject virtual function taking or returning a record by value",
                ));
            }
            let offset = method
                .selector()
                .split_whitespace()
                .nth(2)
                .ok_or_else(|| refuse("a GObject virtual function whose slot has no offset"))?;
            // A `string` the slot answers is one GTK holds past the call, and
            // nothing yet says whose copy that is.
            if nts_core::hir::native::lent_string(&method.signature.result, &compiled.return_type) {
                return Err(refuse("a GObject virtual function answering a string"));
            }
            let (returns, spelled) = entry_spelling(&method.signature);
            let mut parameters = Vec::new();
            let mut arguments = Vec::new();
            let (mut copies, mut releases) = (String::new(), String::new());
            for (slot, (ty, want)) in method
                .signature
                .parameters
                .iter()
                .zip(&compiled.params)
                .enumerate()
            {
                parameters.push(format!("{} __nts_a{slot}", spelled[slot]));
                if let Some(copy) = super::native_memory::lent_string(
                    ty,
                    &want.ty,
                    slot,
                    (&mut copies, &mut releases),
                ) {
                    arguments.push(copy);
                    continue;
                }
                arguments.push(format!(
                    "({})__nts_a{slot}",
                    c_type_of(program, &want.ty, &want.origin)?
                ));
            }
            let call = format!(
                "{}({})",
                program.function(&compiled.name),
                arguments.join(", ")
            );
            let entry = format!("__nts_gobject_{name}_{at}");
            let body = if matches!(*method.signature.result, Type::Void) {
                format!("nts_callback_enter();{copies} {call};{releases} nts_callback_leave();")
            } else {
                format!(
                    "nts_callback_enter();{copies} {returns} __nts_r = ({returns}){call};{releases} nts_callback_leave(); return __nts_r;"
                )
            };
            writer.line(
                origin,
                format!(
                    "static {returns} {entry}({}) {{ {body} }}",
                    parameters.join(", ")
                ),
            );
            let structure = method.selector().split_whitespace().next();
            let table = match class
                .protocols
                .iter()
                .position(|interface| interface.split_whitespace().next() == structure)
            {
                Some(interface) => &mut interfaces[interface],
                None => &mut slots,
            };
            table.push(format!("{{ {offset}u, (void (*)(void)){entry} }}"));
        }
        let table = if slots.is_empty() {
            "0".to_owned()
        } else {
            writer.line(
                origin,
                format!(
                    "static const struct __nts_gobject_slot __nts_gobject_slots_{name}[] = {{ {} }};",
                    slots.join(", ")
                ),
            );
            format!("__nts_gobject_slots_{name}")
        };
        // The fields' maker, which `instance_init` calls wherever GTK makes
        // one -- a builder file's included -- so it enters and leaves as an
        // entry point does.
        let make_state = state_maker(writer, origin, program, class)?;
        let parent_type = class
            .superclass
            .gtype()
            .ok_or_else(|| refuse("a GObject class without typed parent provenance"))?;
        let parent_symbol = program
            .gtype_name(parent_type)
            .ok_or_else(|| refuse("a GObject parent this program does not register"))?;
        let type_symbol = program
            .class_gtype(name)
            .ok_or_else(|| refuse("a GObject class outside the emission index"))?;
        if matches!(parent_type, GType::Declared(_)) {
            writer.line(origin, format!("size_t {parent_symbol}(void);"));
        }
        // Its signals, added to the type the moment it exists: before any
        // instance can be made or connected to.
        let hooks = template(writer, origin, program, class)?;
        let mut signals = registrations(class);
        if !signals.is_empty() {
            writer.line(origin, "unsigned nts_gobject_add_signal(size_t __nts_type, const char *__nts_name, const char *__nts_kinds);");
        }
        signals.push_str(&implementations(writer, origin, class, &interfaces)?);
        if let Some(table) = properties(writer, origin, program, class)? {
            let _ = write!(
                signals,
                " nts_gobject_set_properties(__nts_type, {table}, {}u);",
                class.properties.len()
            );
        }
        writer.line(
            origin,
            format!(
                "size_t {type_symbol}(void) {{ static size_t __nts_type = 0; if (__nts_type == 0) {{ \
                 __nts_type = nts_gobject_register({parent_symbol}(), {}, {table}, {}u, {make_state}, {hooks});{signals} }} return __nts_type; }}",
                c_string(class.type_name.as_deref().unwrap_or(name.as_str())),
                slots.len()
            ),
        );
        // What `new` makes, as the lowering spelled it: the prototype the
        // program already declares, which this definition has to match. An
        // ancestor made only through its descendants has none.
        if let Some((make, result)) = program
            .native_funcs()
            .flat_map(|func| &func.values)
            .find_map(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Native(target),
                    ..
                } if matches!(&target.thunk, Some(GObjectThunk::New { class }) if class == name) => Some((program.native_name(target), target.result.c_type())),
                _ => None,
            })
        {
            writer.line(origin, format!("{result} {make}(void) {{ return ({result})nts_gobject_new({type_symbol}()); }}"));
        }
    }
    let wrote = chains(writer, origin, program, wrote)?;
    let wrote = notifies(writer, origin, program, wrote)?;
    let wrote = children(writer, origin, program, wrote)?;
    let wrote = set_by_name(writer, origin, program, wrote);
    let wrote = get_by_name(writer, origin, program, wrote);
    emits(writer, origin, program, wrote);
    Ok(())
}

/// What the classes' code below needs declared first: the support file's
/// registration calls, the tables' types, and each class's `GType` function.
fn header(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    registered: &[&ForeignClass],
) {
    writer.line(
        origin,
        "/* GObject classes the program declares: see `emit/gobject.rs`. */",
    );
    writer.line(
        origin,
        "size_t nts_gobject_register(size_t __nts_parent, const char *__nts_name, const void *__nts_slots, size_t __nts_count, void *(*__nts_make_state)(void), void (*__nts_class_setup)(void *), void (*__nts_instance_setup)(void *));",
    );
    writer.line(origin, "void *nts_gobject_new(size_t __nts_type);");
    writer.line(
        origin,
        "struct __nts_gobject_slot { size_t __nts_offset; void (*__nts_entry)(void); };",
    );
    if registered.iter().any(|class| !class.properties.is_empty()) {
        writer.line(origin, "struct __nts_gobject_property { const char *__nts_name; char __nts_kind; void (*__nts_get)(void); void (*__nts_set)(void); };");
        writer.line(
            origin,
            "void nts_gobject_set_properties(size_t __nts_type, const void *__nts_properties, size_t __nts_count);",
        );
    }
    if registered.iter().any(|class| !class.protocols.is_empty()) {
        writer.line(
            origin,
            "void nts_gobject_add_interfaces(size_t __nts_type, const void *__nts_interfaces, size_t __nts_count);",
        );
        writer.line(origin, "struct __nts_gobject_interface { size_t (*__nts_get_type)(void); const struct __nts_gobject_slot *__nts_slots; size_t __nts_count; };");
    }
    // Each class's `GType` function, before any class names it as a
    // parent or a chain-up calls it. Not `static`: an `instanceof` calls it
    // too, as the native function it is, and that call's prototype is
    // printed with every other native's, above this.
    for class in registered {
        writer.line(
            origin,
            format!(
                "size_t {}(void);",
                program
                    .class_gtype(&class.name)
                    .expect("registered class has an emission index entry")
            ),
        );
    }
}

/// What a slot's entry point is defined with, and so what the slot holds: its
/// result and its parameters as C spells them. One spelling, which the entry's
/// definition and the witness's claim about the slot both take, so what is
/// asserted is what is emitted.
fn entry_spelling(signature: &FnPointer) -> (String, Vec<String>) {
    (
        signature.result.c_type().into_owned(),
        signature
            .parameters
            .iter()
            .map(|ty| ty.c_type().into_owned())
            .collect(),
    )
}

/// The witness's claims about every class struct slot the program fills --
/// the slots `classes` writes, from the same walk: that it sits at the offset
/// the binding recorded (`@ntsVfunc GtkButtonClass clicked 408`), and holds
/// the function type its entry point is defined as. Asked of the headers the
/// program is built with, which the binder, asking those it was bound
/// against, could not: a slot that moved since, or changed its type, is a
/// failed assertion rather than an entry written at the wrong place.
pub(super) fn slot_claims(program: &Program) -> Vec<String> {
    let mut claims = Vec::new();
    for class in nts_codegen_common::gobject::registered(program) {
        for method in &class.methods {
            let mut words = method.selector().split_whitespace();
            let (Some(structure), Some(member), Some(offset)) =
                (words.next(), words.next(), words.next())
            else {
                continue;
            };
            let (returns, parameters) = entry_spelling(&method.signature);
            let parameters = if parameters.is_empty() {
                "void".to_owned()
            } else {
                parameters.join(", ")
            };
            claims.push(format!(
                "_Static_assert(offsetof({structure}, {member}) == {offset}u, \
                 \"{structure}.{member} is where the binding placed it\");"
            ));
            claims.push(format!(
                "_Static_assert(__builtin_types_compatible_p(__typeof__((({structure} *)0)->{member}), \
                 {returns} (*)({parameters})), \"{structure}.{member} holds the function type its entry is\");"
            ));
        }
    }
    claims
}

/// The interfaces a class implements: each one's table of the slots its
/// methods fill, and the call adding them all to the class's `GType` once it
/// is registered -- in an order `GLib` accepts, which the runtime finds.
fn implementations(
    writer: &mut CodeWriter,
    origin: &Origin,
    class: &ForeignClass,
    tables: &[Vec<String>],
) -> Result<String, Diagnostic> {
    if class.protocols.is_empty() {
        return Ok(String::new());
    }
    let name = &class.name;
    let mut rows = Vec::new();
    for (at, (interface, slots)) in class.protocols.iter().zip(tables).enumerate() {
        let get_type = interface.split_whitespace().nth(1).ok_or_else(|| {
            Diagnostic::error(
                "NTS2006",
                format!("an interface `{interface}` with no `GType` function"),
                origin.location,
            )
        })?;
        writer.line(origin, format!("size_t {get_type}(void);"));
        let table = if slots.is_empty() {
            "0".to_owned()
        } else {
            writer.line(origin, format!("static const struct __nts_gobject_slot __nts_gobject_interface_{name}_{at}[] = {{ {} }};", slots.join(", ")));
            format!("__nts_gobject_interface_{name}_{at}")
        };
        rows.push(format!("{{ {get_type}, {table}, {}u }}", slots.len()));
    }
    writer.line(
        origin,
        format!(
            "static const struct __nts_gobject_interface __nts_gobject_interfaces_{name}[] = {{ {} }};",
            rows.join(", ")
        ),
    );
    Ok(format!(
        " nts_gobject_add_interfaces(__nts_type, __nts_gobject_interfaces_{name}, {}u);",
        rows.len()
    ))
}

/// The by-name thunks, each `{prefix}{kind}__{name}` the program calls,
/// and the varargs function each hands its value to by the property's name,
/// read back with `-` for `_`: a write of a property with no setter method,
/// `widget.width_request = 80`, to `g_object_set`; and a construct-only
/// property a construction gives, `new GThemedIcon({ name })`, to the
/// support file's builder.
const BY_NAME: [(PropertyOperation, &str, &str); 2] = [
    (
        PropertyOperation::Set,
        "g_object_set",
        "void g_object_set(void *__nts_object, const char *__nts_first_property_name, ...);",
    ),
    (
        PropertyOperation::Construct,
        "nts_gobject_with_builder_add",
        "void nts_gobject_with_builder_add(void *__nts_builder, const char *__nts_name, ...);",
    ),
];

/// Each by-name thunk the program calls (`BY_NAME`), defined as its
/// prototype declares it: the value is C's varargs promote it, as the
/// function it calls reads it.
fn set_by_name(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    mut wrote: bool,
) -> bool {
    for (operation, callee, declaration) in BY_NAME {
        let mut done = std::collections::BTreeSet::new();
        for target in program
            .native_funcs()
            .flat_map(|func| &func.values)
            .filter_map(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Native(target),
                    ..
                } if matches!(&target.thunk, Some(GObjectThunk::Property { operation: found, .. }) if *found == operation) => Some(target),
                _ => None,
            })
        {
            let Some(GObjectThunk::Property { name: property, .. }) = &target.thunk else {
                continue;
            };
            if !done.insert(program.native_name(target)) {
                continue;
            }
            let [object, value] = target.parameters.as_slice() else {
                continue;
            };
            if !wrote {
                writer.line(
                    origin,
                    "/* GObject classes the program declares: see `emit/gobject.rs`. */",
                );
                wrote = true;
            }
            if done.len() == 1 {
                writer.line(origin, declaration);
            }
            writer.line(
                origin,
                format!(
                    "void {}({} __nts_a0, {} __nts_a1) {{ {callee}(__nts_a0, {}, __nts_a1, (void *)0); }}",
                    program.native_name(target),
                    object.c_type(),
                    value.c_type(),
                    c_string(property)
                ),
            );
        }
    }
    wrote
}

/// Each `nts_gobject_propget_{kind}__{name}` the program calls -- a read of
/// a property with no getter method -- defined as `g_object_get` into a
/// local of the property's own type.
fn get_by_name(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    mut wrote: bool,
) -> bool {
    let mut done = std::collections::BTreeSet::new();
    for target in program
        .native_funcs()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(
                &target.thunk,
                Some(GObjectThunk::Property {
                    operation: PropertyOperation::Get,
                    ..
                })
            ) =>
            {
                Some(target)
            }
            _ => None,
        })
    {
        if !done.insert(program.native_name(target)) {
            continue;
        }
        let Some(GObjectThunk::Property { name: property, .. }) = &target.thunk else {
            continue;
        };
        let [object] = target.parameters.as_slice() else {
            continue;
        };
        if !wrote {
            writer.line(
                origin,
                "/* GObject classes the program declares: see `emit/gobject.rs`. */",
            );
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(
                origin,
                "void g_object_get(void *__nts_object, const char *__nts_first_property_name, ...);",
            );
        }
        let value = target.result.c_type();
        writer.line(
            origin,
            format!(
                "{value} {}({} __nts_a0) {{ {value} __nts_r = 0; g_object_get(__nts_a0, {}, &__nts_r, (void *)0); return __nts_r; }}",
                program.native_name(target),
                object.c_type(),
                c_string(property)
            ),
        );
    }
    wrote
}

/// Each `nts_gobject_child_{Class}_{index}` the program calls -- a read of a
/// child the class's template names -- defined as `gtk_widget_get_template_child`
/// by the child's id, which lends it.
fn children(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    mut wrote: bool,
) -> Result<bool, Diagnostic> {
    let mut done = std::collections::BTreeSet::new();
    for target in program
        .native_funcs()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(&target.thunk, Some(GObjectThunk::Child { .. })) => Some(target),
            _ => None,
        })
    {
        if !done.insert(program.native_name(target)) {
            continue;
        }
        let Some(GObjectThunk::Child { class, index }) = &target.thunk else {
            continue;
        };
        let Some(id) = program
            .foreign_classes
            .iter()
            .find(|foreign| {
                foreign.family == Family::GObject && foreign.name.as_str() == class.as_str()
            })
            .and_then(|foreign| foreign.template.as_ref())
            .and_then(|template| template.children.get(*index))
        else {
            continue;
        };
        if !wrote {
            writer.line(
                origin,
                "/* GObject classes the program declares: see `emit/gobject.rs`. */",
            );
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(
                origin,
                "void *nts_gtk_template_child(void *__nts_widget, size_t __nts_type, const char *__nts_id);",
            );
        }
        let returns = target.result.c_type();
        let instance = target
            .parameters
            .first()
            .map_or_else(|| "void *".into(), Type::c_type);
        let type_symbol = program.class_gtype(class).ok_or_else(|| {
            Diagnostic::error(
                "NTS2006",
                "a GObject thunk whose class is not in the emission index".to_owned(),
                origin.location,
            )
        })?;
        writer.line(
            origin,
            format!(
                "{returns} {}({instance} __nts_a0) {{ return ({returns})nts_gtk_template_child(__nts_a0, {type_symbol}(), {}); }}",
                program.native_name(target),
                c_string(id)
            ),
        );
    }
    Ok(wrote)
}

/// Each `nts_gobject_notify_{Class}_{index}` the program calls -- a write of
/// a property's field -- defined as `g_object_notify_by_pspec` with the
/// property's spec, found once and kept.
fn notifies(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    mut wrote: bool,
) -> Result<bool, Diagnostic> {
    let mut done = std::collections::BTreeSet::new();
    for target in program
        .native_funcs()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(&target.thunk, Some(GObjectThunk::Notify { .. })) => Some(target),
            _ => None,
        })
    {
        if !done.insert(program.native_name(target)) {
            continue;
        }
        let Some(GObjectThunk::Notify { class, index }) = &target.thunk else {
            continue;
        };
        if !wrote {
            writer.line(
                origin,
                "/* GObject classes the program declares: see `emit/gobject.rs`. */",
            );
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(
                origin,
                "void *nts_gobject_property_spec(size_t __nts_type, unsigned __nts_index);",
            );
            writer.line(
                origin,
                "void g_object_notify_by_pspec(void *__nts_object, void *__nts_pspec);",
            );
        }
        let type_symbol = program.class_gtype(class).ok_or_else(|| {
            Diagnostic::error(
                "NTS2006",
                "a GObject thunk whose class is not in the emission index".to_owned(),
                origin.location,
            )
        })?;
        writer.line(
            origin,
            format!(
                "void {}(void *__nts_self) {{ static void *__nts_spec; if (!__nts_spec) __nts_spec = nts_gobject_property_spec({type_symbol}(), {index}u); g_object_notify_by_pspec(__nts_self, __nts_spec); }}",
                program.native_name(target)
            ),
        );
    }
    Ok(wrote)
}

/// A class's template (`static readonly template`): `class_init` sets it and
/// binds each child the class names, and `instance_init` makes the children
/// (`nts_gtk.c`). The two hooks registration passes, `0, 0` without one.
fn template(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    class: &ForeignClass,
) -> Result<String, Diagnostic> {
    let Some(template) = &class.template else {
        return Ok("0, 0".to_owned());
    };
    let name = &class.name;
    writer.line(
        origin,
        "void nts_gtk_class_children(void *__nts_klass, const char *const *children, size_t __nts_count);",
    );
    writer.line(origin, "void nts_gtk_init_template(void *__nts_instance);");
    let set = match &template.text {
        TemplateText::Literal(text) => {
            writer.line(
                origin,
                "void nts_gtk_class_template(void *__nts_klass, const char *__nts_text, size_t __nts_length);",
            );
            format!(
                "nts_gtk_class_template(__nts_klass, {}, {}u);",
                c_string(text),
                text.len()
            )
        }
        // The reader's string, lent to GTK for the call, entered and left
        // as an entry point is; its result is the caller's to release only
        // where the program counts.
        TemplateText::Read(reader) => {
            writer.line(
                origin,
                "void nts_gtk_class_template_text(void *__nts_klass, const char *__nts_text);",
            );
            let compiled = program
                .funcs
                .iter()
                .find(|func| &func.name == reader)
                .ok_or_else(|| {
                    Diagnostic::error(
                        "NTS2006",
                        "a template whose reader this program does not define".to_owned(),
                        origin.location,
                    )
                })?;
            let release = if program.provider == nts_core::hir::Memory::ReferenceCounting {
                " nts_release((NtsHeader *)__nts_text);"
            } else {
                ""
            };
            format!(
                "nts_callback_enter(); NtsString *__nts_text = {}(); const char *__nts_c = nts_string_to_cstring(__nts_text); \
                 nts_gtk_class_template_text(__nts_klass, __nts_c); nts_cstring_release(__nts_text, __nts_c);{release} nts_callback_leave();",
                program.function(&compiled.name)
            )
        }
    };
    let binds = callbacks(writer, origin, program, class, &template.callbacks)?;
    let children: Vec<String> = template
        .children
        .iter()
        .map(|child| c_string(child))
        .collect();
    let table = if children.is_empty() {
        "0".to_owned()
    } else {
        writer.line(
            origin,
            format!(
                "static const char *const __nts_gobject_children_{name}[] = {{ {} }};",
                children.join(", ")
            ),
        );
        format!("__nts_gobject_children_{name}")
    };
    writer.line(
        origin,
        format!(
            "static void __nts_gobject_class_setup_{name}(void *__nts_klass) {{ {set} nts_gtk_class_children(__nts_klass, {table}, {}u);{binds} }}",
            children.len()
        ),
    );
    Ok(format!(
        "__nts_gobject_class_setup_{name}, nts_gtk_init_template"
    ))
}

/// Each method a template names as a signal's handler: an entry point GTK
/// calls with the signal's arguments and then the instance, its user data,
/// which calls the compiled method with the instance as `this`, entered and
/// left as any entry point is. Returns the calls binding each by name.
fn callbacks(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    class: &ForeignClass,
    callbacks: &[ForeignMethod],
) -> Result<String, Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    if callbacks.is_empty() {
        return Ok(String::new());
    }
    writer.line(
        origin,
        "void nts_gtk_bind_callback(void *__nts_klass, const char *__nts_name, void (*__nts_callback)(void));",
    );
    let name = &class.name;
    let mut binds = String::new();
    for (at, callback) in callbacks.iter().enumerate() {
        let compiled = program
            .funcs
            .iter()
            .find(|func| func.name == callback.function)
            .ok_or_else(|| {
                refuse("a template's handler whose compiled function this program does not define")
            })?;
        let signature = &callback.signature;
        if compiled.params.len() != signature.parameters.len() {
            return Err(refuse(
                "a template's handler whose entry point and compiled function disagree about arity",
            ));
        }
        let receiver = "__nts_self";
        let mut parameters = Vec::new();
        let mut arguments = vec![format!(
            "({}){receiver}",
            c_type_of(program, &compiled.params[0].ty, &compiled.params[0].origin)?
        )];
        for (slot, (ty, want)) in signature
            .parameters
            .iter()
            .zip(&compiled.params)
            .enumerate()
            .skip(1)
        {
            parameters.push(format!("{} __nts_a{slot}", ty.c_type()));
            arguments.push(format!(
                "({})__nts_a{slot}",
                c_type_of(program, &want.ty, &want.origin)?
            ));
        }
        parameters.push(format!("void *{receiver}"));
        let call = format!(
            "{}({})",
            program.function(&compiled.name),
            arguments.join(", ")
        );
        let returns = signature.result.c_type();
        let body = if matches!(*signature.result, Type::Void) {
            format!("nts_callback_enter(); {call}; nts_callback_leave();")
        } else {
            format!(
                "nts_callback_enter(); {returns} __nts_r = ({returns}){call}; nts_callback_leave(); return __nts_r;"
            )
        };
        let entry = format!("__nts_gobject_callback_{name}_{at}");
        writer.line(
            origin,
            format!(
                "static {returns} {entry}({}) {{ {body} }}",
                parameters.join(", ")
            ),
        );
        let handler = callback.selector().trim_start_matches("callback ");
        let _ = write!(
            binds,
            " nts_gtk_bind_callback(__nts_klass, {}, (void (*)(void)){entry});",
            c_string(handler)
        );
    }
    Ok(binds)
}

/// The maker of a class's fields, entered and left as an entry point is, or
/// `0` for a class with none.
fn state_maker(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    class: &ForeignClass,
) -> Result<String, Diagnostic> {
    let Some(state) = &class.state else {
        return Ok("0".to_owned());
    };
    let compiled = program
        .funcs
        .iter()
        .find(|func| &func.name == state)
        .ok_or_else(|| {
            Diagnostic::error(
                "NTS2006",
                "a GObject class whose fields' maker this program does not define".to_owned(),
                origin.location,
            )
        })?;
    let name = &class.name;
    writer.line(
        origin,
        format!(
            "static void *__nts_gobject_state_maker_{name}(void) {{ nts_callback_enter(); void *__nts_made = (void *){}(); nts_callback_leave(); return __nts_made; }}",
            program.function(&compiled.name)
        ),
    );
    Ok(format!("__nts_gobject_state_maker_{name}"))
}

/// A class's properties as the runtime's `get_property` and `set_property`
/// reach them: a wrapper per accessor, entered and left as an entry point is,
/// and the `{ name, kind, get, set }` table registration hands over. `None`
/// for a class with none.
fn properties(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    class: &ForeignClass,
) -> Result<Option<String>, Diagnostic> {
    if class.properties.is_empty() {
        return Ok(None);
    }
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let name = &class.name;
    let mut rows = Vec::new();
    for (at, property) in class.properties.iter().enumerate() {
        let find = |wanted: &str| {
            program
                .funcs
                .iter()
                .find(|func| func.name == wanted)
                .ok_or_else(|| {
                    refuse("a GObject property whose accessor this program does not define")
                })
        };
        let (get, set) = (find(&property.getter)?, find(&property.setter)?);
        let instance = c_type_of(program, &get.params[0].ty, &get.params[0].origin)?;
        let value = c_type_of(program, &get.return_type, &get.origin)?;
        writer.line(
            origin,
            format!(
                "static {value} __nts_gobject_get_{name}_{at}(void *__nts_self) {{ nts_callback_enter(); {value} __nts_r = {}(({instance})__nts_self); nts_callback_leave(); return __nts_r; }}",
                program.function(&get.name)
            ),
        );
        writer.line(
            origin,
            format!(
                "static void __nts_gobject_set_{name}_{at}(void *__nts_self, {value} __nts_v) {{ nts_callback_enter(); {}(({instance})__nts_self, __nts_v); nts_callback_leave(); }}",
                program.function(&set.name)
            ),
        );
        rows.push(format!(
            "{{ {}, '{}', (void (*)(void))__nts_gobject_get_{name}_{at}, (void (*)(void))__nts_gobject_set_{name}_{at} }}",
            c_string(&property.name),
            property.kind
        ));
    }
    writer.line(
        origin,
        format!(
            "static const struct __nts_gobject_property __nts_gobject_properties_{name}[] = {{ {} }};",
            rows.join(", ")
        ),
    );
    Ok(Some(format!("__nts_gobject_properties_{name}")))
}

/// The calls adding a class's signals to its `GType`, one per signal.
fn registrations(class: &ForeignClass) -> String {
    let mut out = String::new();
    for signal in &class.signals {
        let _ = write!(
            out,
            " nts_gobject_add_signal(__nts_type, {}, \"{}\");",
            c_string(&signal.name),
            signal.kinds
        );
    }
    out
}

/// Each `nts_gobject_emit_{kinds}__{name}` the program calls -- `emit` of a
/// signal a class it wrote declares -- defined as its prototype declares it:
/// `g_signal_emit` by the signal's id, which `nts_gobject_signal_id` finds
/// on the instance's type once and keeps. The name is the thunk's, read
/// back with `_` for `-`, which `GLib` treats as the same signal.
fn emits(writer: &mut CodeWriter, origin: &Origin, program: &Program, mut wrote: bool) {
    let mut done = std::collections::BTreeSet::new();
    for target in program
        .native_funcs()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(&target.thunk, Some(GObjectThunk::Signal { .. })) => Some(target),
            _ => None,
        })
    {
        if !done.insert(program.native_name(target)) {
            continue;
        }
        let Some(GObjectThunk::Signal { name: signal, .. }) = &target.thunk else {
            continue;
        };
        if !wrote {
            writer.line(
                origin,
                "/* GObject classes the program declares: see `emit/gobject.rs`. */",
            );
            wrote = true;
        }
        if done.len() == 1 {
            writer.line(origin, "unsigned nts_gobject_signal_id(void *__nts_instance, const char *__nts_name, size_t __nts_cache[2]);");
            writer.line(
                origin,
                "void g_signal_emit(void *__nts_instance, unsigned __nts_signal, unsigned __nts_detail, ...);",
            );
        }
        let parameters: Vec<String> = target
            .parameters
            .iter()
            .enumerate()
            .map(|(at, ty)| format!("{} __nts_a{at}", ty.c_type()))
            .collect();
        let mut arguments = String::new();
        for at in 1..target.parameters.len() {
            let _ = write!(arguments, ", __nts_a{at}");
        }
        // A signal that answers writes its handlers' result through a
        // location passed after the parameters, which the thunk returns.
        let result = "__nts_r";
        let (returns, slot, answer, location) = if matches!(target.result, Type::Void) {
            (
                "void".to_owned(),
                String::new(),
                String::new(),
                String::new(),
            )
        } else {
            let ty = target.result.c_type();
            (
                ty.to_string(),
                format!(" {ty} {result} = 0;"),
                format!(" return {result};"),
                format!(", &{result}"),
            )
        };
        writer.line(
            origin,
            format!(
                "{returns} {}({}) {{ static size_t __nts_cache[2];{slot} g_signal_emit(__nts_a0, nts_gobject_signal_id(__nts_a0, {}, __nts_cache), 0u{arguments}{location});{answer} }}",
                program.native_name(target),
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
fn chains(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    mut wrote: bool,
) -> Result<bool, Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    let mut done = std::collections::BTreeSet::new();
    for target in program
        .native_funcs()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(&target.thunk, Some(GObjectThunk::Chain { .. })) => Some(target),
            _ => None,
        })
    {
        if !done.insert(program.native_name(target)) {
            continue;
        }
        let Some(GObjectThunk::Chain {
            class,
            slot: offset,
        }) = &target.thunk
        else {
            continue;
        };
        let parent = program
            .foreign_classes
            .iter()
            .find(|foreign| {
                foreign.family == Family::GObject && foreign.name.as_str() == class.as_str()
            })
            .map(|foreign| foreign.superclass.clone())
            .ok_or_else(|| refuse("a chain-up in a class this program does not register"))?;
        if target
            .parameters
            .iter()
            .chain(std::iter::once(&target.result))
            .any(|ty| matches!(ty, Type::Record(_)))
        {
            return Err(refuse(
                "a chain-up to a virtual function taking or returning a record by value",
            ));
        }
        if !wrote {
            writer.line(
                origin,
                "/* GObject classes the program declares: see `emit/gobject.rs`. */",
            );
            wrote = true;
        }
        writer.line(
            origin,
            "void *nts_gobject_parent_slot(size_t __nts_parent, size_t __nts_offset);",
        );
        let parent_type = parent
            .gtype()
            .ok_or_else(|| refuse("a GObject chain-up without typed parent provenance"))?;
        let parent_symbol = program
            .gtype_name(parent_type)
            .ok_or_else(|| refuse("a GObject chain-up parent this program does not register"))?;
        if matches!(parent_type, GType::Declared(_)) {
            writer.line(origin, format!("size_t {parent_symbol}(void);"));
        }
        let parameters: Vec<String> = target
            .parameters
            .iter()
            .enumerate()
            .map(|(at, ty)| format!("{} __nts_a{at}", ty.c_type()))
            .collect();
        let types: Vec<String> = target
            .parameters
            .iter()
            .map(|ty| ty.c_type().into_owned())
            .collect();
        let arguments: Vec<String> = (0..target.parameters.len())
            .map(|at| format!("__nts_a{at}"))
            .collect();
        let returns = target.result.c_type();
        let call = format!(
            "(({returns} (*)({}))__nts_slot)({})",
            types.join(", "),
            arguments.join(", ")
        );
        let body = if matches!(target.result, Type::Void) {
            format!("if (__nts_slot) {call};")
        } else {
            format!("return __nts_slot ? {call} : ({returns})0;")
        };
        writer.line(
            origin,
            format!(
                "{returns} {}({}) {{ void *__nts_slot = nts_gobject_parent_slot({}(), {offset}u); {body} }}",
                program.native_name(target),
                parameters.join(", "),
                parent_symbol
            ),
        );
    }
    Ok(wrote)
}
