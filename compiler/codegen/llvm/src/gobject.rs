//! `GObject` classes the program writes, as the C backend's `emit/gobject.rs`
//! writes them: per class the program makes, an entry point per `vfunc_`
//! override converting to what the compiled method takes, a table of
//! `{ offset, entry point }` for the support file's `class_init`, the
//! `GType` registered the first time one is made, and `nts_gobject_new_{Class}`
//! for `new`. No constructor before `main`: registration is lazy, as `GObject`'s
//! own `get_type` functions are.

use std::fmt::Write as _;

use crate::runtime_call::{self, DirectCallee, Operand, Site};

use super::Emission as Program;

use nts_core::hir::native::{Family, GObjectThunk, GType, PropertyOperation, Type};
use nts_core::hir::{Callee, ForeignClass, ForeignMethod, Func, HirType, OpKind, TemplateText};
use nts_diagnostics::Diagnostic;

use super::{Platform, conversion, is_not_zero, refuse, text_constant, ty_of};

/// Each product support function, with its fixed ABI from the support files
/// (`nts_gobject.h`, `nts_gtk.h`), independent of the canonical runtime. One
/// list makes the enum, its signatures and the exported table, so a helper and
/// its declaration cannot be paired wrongly. Declaration rendering, call
/// checking and the source audit share these data.
macro_rules! support {
    ($($helper:ident => $name:literal, $returns:literal, $params:expr;)*) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        enum Support {
            $($helper,)*
        }

        impl Support {
            const ALL: &[Self] = &[$(Self::$helper,)*];

            const fn signature(self) -> &'static crate::signatures::Signature {
                match self {
                    $(Self::$helper => &crate::signatures::Signature {
                        name: $name,
                        returns: $returns,
                        params: $params,
                        attributes: &[],
                    },)*
                }
            }
        }

        pub const SUPPORT_SIGNATURES: &[crate::signatures::Signature] = &[
            $(*Support::$helper.signature(),)*
        ];
    };
}

support! {
    Register => "nts_gobject_register", "i64", &["i64", "ptr", "ptr", "i64", "ptr", "ptr", "ptr"];
    New => "nts_gobject_new", "ptr", &["i64"];
    ClassChildren => "nts_gtk_class_children", "void", &["ptr", "ptr", "i64"];
    InitTemplate => "nts_gtk_init_template", "void", &["ptr"];
    ClassTemplate => "nts_gtk_class_template", "void", &["ptr", "ptr", "i64"];
    ClassTemplateText => "nts_gtk_class_template_text", "void", &["ptr", "ptr"];
    BindCallback => "nts_gtk_bind_callback", "void", &["ptr", "ptr", "ptr"];
    AddSignal => "nts_gobject_add_signal", "i32", &["i64", "ptr", "ptr"];
    SetProperties => "nts_gobject_set_properties", "void", &["i64", "ptr", "i64"];
    AddInterfaces => "nts_gobject_add_interfaces", "void", &["i64", "ptr", "i64"];
    TemplateChild => "nts_gtk_template_child", "ptr", &["ptr", "i64", "ptr"];
    PropertySpec => "nts_gobject_property_spec", "ptr", &["i64", "i32"];
    SignalId => "nts_gobject_signal_id", "i32", &["ptr", "ptr", "ptr"];
    ParentSlot => "nts_gobject_parent_slot", "ptr", &["i64", "i64"];
    WithBuilderAdd => "nts_gobject_with_builder_add", "void", &["ptr", "ptr", crate::signatures::VARIADIC_TAIL];
}

const _: () = assert!(
    Support::ALL.len() <= Declarations::WIDTH,
    "more GObject support helpers than `Declarations` has bits: widen its integer (u16 to u32) and `Declarations::WIDTH` follows"
);

/// The support helper `name` names, if any.
fn support(name: &str) -> Option<Support> {
    static INDEX: std::sync::OnceLock<std::collections::HashMap<&'static str, Support>> =
        std::sync::OnceLock::new();
    INDEX
        .get_or_init(|| {
            Support::ALL
                .iter()
                .map(|&helper| (helper.signature().name, helper))
                .collect()
        })
        .get(name)
        .copied()
}

/// The declaration of the support helper `name`, if it is one.
pub(super) fn signature(name: &str) -> Option<&'static crate::signatures::Signature> {
    support(name).map(Support::signature)
}

/// The declarations this emission actually writes. The same selection grants
/// producer sites authority to call them; ordinary sites have no such grant.
#[derive(Clone, Copy, Default)]
pub(super) struct Declarations(u16);

impl Declarations {
    /// How many support helpers one selection can hold.
    const WIDTH: usize = u16::BITS as usize;

    fn insert(&mut self, helper: Support) {
        self.0 |= 1 << helper as usize;
    }

    fn has(self, helper: Support) -> bool {
        self.0 & (1 << helper as usize) != 0
    }

    pub(super) fn contains(self, name: &str) -> bool {
        support(name).is_some_and(|helper| self.has(helper))
    }

    fn declare(self, out: &mut String, helper: Support) -> bool {
        if !self.has(helper) {
            return false;
        }
        let known = helper.signature();
        let _ = writeln!(
            out,
            "declare {} @{}({})",
            known.returns,
            known.name,
            known.params.join(", ")
        );
        true
    }

    fn for_program(program: &Program, classes: &[&ForeignClass]) -> Self {
        let mut selected = Self::default();
        if program.funcs.is_empty() {
            return selected;
        }
        if !classes.is_empty() {
            selected.insert(Support::Register);
            selected.insert(Support::New);
        }
        for class in classes {
            if let Some(template) = &class.template {
                selected.insert(Support::ClassChildren);
                selected.insert(Support::InitTemplate);
                selected.insert(match template.text {
                    TemplateText::Literal(_) => Support::ClassTemplate,
                    TemplateText::Read(_) => Support::ClassTemplateText,
                });
                if !template.callbacks.is_empty() {
                    selected.insert(Support::BindCallback);
                }
            }
            if !class.signals.is_empty() {
                selected.insert(Support::AddSignal);
            }
            if !class.properties.is_empty() {
                selected.insert(Support::SetProperties);
            }
            if !class.protocols.is_empty() {
                selected.insert(Support::AddInterfaces);
            }
        }
        for target in program
            .native_funcs()
            .flat_map(|func| &func.values)
            .filter_map(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Native(target),
                    ..
                } => Some(target),
                _ => None,
            })
        {
            match &target.thunk {
                Some(GObjectThunk::Child { class, index })
                    if template_child(program, class, *index).is_some() =>
                {
                    selected.insert(Support::TemplateChild);
                }
                Some(GObjectThunk::Property {
                    operation: PropertyOperation::Construct,
                    ..
                }) => selected.insert(Support::WithBuilderAdd),
                Some(GObjectThunk::Notify { .. }) => selected.insert(Support::PropertySpec),
                Some(GObjectThunk::Signal { .. }) => selected.insert(Support::SignalId),
                Some(GObjectThunk::Chain { .. }) => selected.insert(Support::ParentSlot),
                _ => {}
            }
        }
        selected
    }
}

/// The id of child `index` in the template of the `GObject` class `class`,
/// which a `Child` thunk is valid only with. Selecting the thunk's support
/// declaration and emitting the thunk both ask this, so they cannot disagree.
fn template_child<'a>(program: &'a Program, class: &str, index: usize) -> Option<&'a str> {
    program
        .foreign_classes
        .iter()
        .find(|foreign| foreign.family == Family::GObject && foreign.name.as_str() == class)
        .and_then(|foreign| foreign.template.as_ref())
        .and_then(|template| template.children.get(index))
        .map(String::as_str)
}

/// The function `new` of `class` calls, which this section defines.
fn maker<'a>(program: &'a Program, class: &ForeignClass) -> Option<&'a str> {
    nts_codegen_common::gobject::thunks(program).find_map(|(target, thunk)| {
        matches!(thunk, GObjectThunk::New { class: name } if *name == class.name)
            .then(|| program.native_name(target))
    })
}

/// Whether the program calls `name` as a foreign function, and so declares it.
fn called(program: &Program, name: &str) -> bool {
    program.native_funcs().flat_map(|func| &func.values).any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::Native(target), .. } if program.native_name(target) == name)
    })
}

#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
pub(super) fn classes(
    program: &Program,
    platform: Platform,
    callbacks_declared: bool,
) -> Result<String, Diagnostic> {
    let Some(provenance_origin) = program.funcs.first() else {
        return Ok(String::new());
    };
    let classes = nts_codegen_common::gobject::registered(program);
    let support = Declarations::for_program(program, &classes);
    // A parent's `get_type`, declared once however many classes extend it
    // and chain up to it: LLVM, unlike C, refuses a second declaration.
    let mut parents = std::collections::BTreeSet::new();
    let mut out = chains(program, platform, &mut parents, support)?;
    out.push_str(&emits(program, platform, support)?);
    out.push_str(&set_by_name(program, platform, support)?);
    out.push_str(&get_by_name(program, platform)?);
    out.push_str(&notifies(program, provenance_origin, platform, support)?);
    out.push_str(&children(program, provenance_origin, platform, support)?);
    if classes.is_empty() {
        return Ok(out);
    }
    if !callbacks_declared {
        out.push_str("declare void @nts_callback_enter()\ndeclare void @nts_callback_leave()\n");
    }
    declarations(&mut out, support);
    for class in classes {
        let name = &class.name;
        let mut slots = Vec::new();
        // One table per interface the class implements, filled by the
        // methods whose slot is in that interface's struct.
        let mut interfaces: Vec<Vec<String>> = vec![Vec::new(); class.protocols.len()];
        for (at, method) in class.methods.iter().enumerate() {
            let Some(compiled) = program
                .funcs
                .iter()
                .find(|func| func.name == method.function)
            else {
                let missing = "a GObject virtual function whose compiled function this program does not define";
                return match program.funcs.first() {
                    Some(func) => Err(refuse(func, missing)),
                    None => Ok(String::new()),
                };
            };
            let offset = method.selector().split_whitespace().nth(2).ok_or_else(|| {
                refuse(
                    compiled,
                    "a GObject virtual function whose slot has no offset",
                )
            })?;
            let entry = format!("__nts_gobject_{name}_{at}");
            entry_point(program, &mut out, platform, &entry, method, compiled)?;
            let structure = method.selector().split_whitespace().next();
            let table = match class
                .protocols
                .iter()
                .position(|interface| interface.split_whitespace().next() == structure)
            {
                Some(interface) => &mut interfaces[interface],
                None => &mut slots,
            };
            table.push(format!("{{ i64, ptr }} {{ i64 {offset}, ptr @{entry} }}"));
        }
        let table = if slots.is_empty() {
            "null".to_owned()
        } else {
            let _ = writeln!(
                out,
                "@__nts_gobject_slots_{name} = internal constant [{} x {{ i64, ptr }}] [{}]",
                slots.len(),
                slots.join(", ")
            );
            format!("@__nts_gobject_slots_{name}")
        };
        text_constant(
            &mut out,
            &format!("__nts_gobject_name_{name}"),
            class.type_name.as_deref().unwrap_or(name.as_str()),
        );
        // The fields' maker, entered and left as an entry point is:
        // `instance_init` runs wherever GTK makes one.
        let make_state = match &class.state {
            Some(state) => {
                let Some(compiled) = program.funcs.iter().find(|func| &func.name == state) else {
                    let missing =
                        "a GObject class whose fields' maker this program does not define";
                    return match program.funcs.first() {
                        Some(func) => Err(refuse(func, missing)),
                        None => Ok(String::new()),
                    };
                };
                let _ = writeln!(
                    out,
                    "define internal ptr @__nts_gobject_state_maker_{name}() nounwind {{\n  {runtime_0}\n  %made = {0}\n  {runtime_1}\n  ret ptr %made\n}}",
                    runtime_call::direct(
                        "ptr",
                        &DirectCallee::compiled(
                            Site::synthetic(program, "classes"),
                            platform,
                            program,
                            &compiled.name
                        )?,
                        ""
                    ),
                    runtime_0 = runtime_call::call(
                        Site::synthetic(program, "classes"),
                        platform,
                        "nts_callback_enter",
                        &[]
                    )?,
                    runtime_1 = runtime_call::call(
                        Site::synthetic(program, "classes"),
                        platform,
                        "nts_callback_leave",
                        &[]
                    )?
                );
                format!("@__nts_gobject_state_maker_{name}")
            }
            None => "null".to_owned(),
        };
        // Its signals, added to the type the moment it exists.
        let hooks = template(&mut out, program, platform, class, support)?;
        let mut signals = registrations(&mut out, program, platform, class, support)?;
        signals.push_str(&implementations(
            &mut out,
            program,
            (class, &interfaces),
            &mut parents,
            platform,
            support,
        )?);
        if let Some(table) = properties(&mut out, program, platform, class)? {
            let _ = writeln!(
                signals,
                "  {}",
                runtime_call::call(
                    Site::synthetic(program, "classes").with_gobject(support),
                    platform,
                    "nts_gobject_set_properties",
                    &[
                        Operand::new("i64", "%made"),
                        Operand::new("ptr", table),
                        Operand::new("i64", class.properties.len().to_string())
                    ]
                )?
            );
        }
        // A parent the program wrote is defined here, not declared.
        let parent_type = class.superclass.gtype().ok_or_else(|| {
            refuse(
                provenance_origin,
                "a GObject class without typed parent provenance",
            )
        })?;
        let parent = program.gtype_name(parent_type).ok_or_else(|| {
            refuse(
                provenance_origin,
                "a GObject parent this program does not register",
            )
        })?;
        let type_symbol = program.class_gtype(name).ok_or_else(|| {
            refuse(
                provenance_origin,
                "a GObject class outside the emission index",
            )
        })?;
        if matches!(parent_type, GType::Declared(_))
            && !called(program, parent)
            && parents.insert(parent.to_owned())
        {
            let _ = writeln!(out, "declare i64 @{parent}()");
        }
        let parent_call = runtime_call::external(
            Site::function(provenance_origin),
            platform,
            parent,
            "i64",
            &[],
        )?;
        let register = runtime_call::call(
            Site::synthetic(program, "classes").with_gobject(support),
            platform,
            "nts_gobject_register",
            &[
                Operand::new("i64", "%parent"),
                Operand::new("ptr", format!("@__nts_gobject_name_{name}")),
                Operand::new("ptr", table),
                Operand::new("i64", slots.len().to_string()),
                Operand::new("ptr", make_state),
                hooks[0].clone(),
                hooks[1].clone(),
            ],
        )?;
        let _ = writeln!(
            out,
            "@{type_symbol}.cache = internal global i64 0\n\
             define internal i64 @{type_symbol}() nounwind {{\n\
             entry:\n  %cached = load i64, ptr @{type_symbol}.cache\n  %none = icmp eq i64 %cached, 0\n\
             \x20 br i1 %none, label %register, label %done\n\
             register:\n  %parent = {parent_call}\n\
             \x20 %made = {register}\n\
             {signals}\
             \x20 store i64 %made, ptr @{type_symbol}.cache\n  br label %done\n\
             done:\n  %type = phi i64 [ %cached, %entry ], [ %made, %register ]\n  ret i64 %type\n}}"
        );
        if let Some(make) = maker(program, class) {
            let type_call = runtime_call::external(
                Site::function(provenance_origin),
                platform,
                type_symbol,
                "i64",
                &[],
            )?;
            let _ = writeln!(
                out,
                "define ptr @{make}() nounwind {{\n  %type = {type_call}\n  %made = {make_call}\n  ret ptr %made\n}}",
                make_call = runtime_call::call(
                    Site::synthetic(program, "classes").with_gobject(support),
                    platform,
                    "nts_gobject_new",
                    &[Operand::new("i64", "%type")]
                )?
            );
        }
    }
    Ok(out)
}

/// The interfaces a class implements: each one's table of the slots its
/// methods fill, and the call adding them all to the class's `GType`
/// (`%made`) once it is registered -- in an order `GLib` accepts, which the
/// runtime finds. Each `GType` function is declared once, as a parent's is,
/// unless the program calls it itself.
fn implementations(
    out: &mut String,
    program: &Program,
    (class, tables): (&ForeignClass, &[Vec<String>]),
    declared: &mut std::collections::BTreeSet<String>,
    platform: Platform,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let name = &class.name;
    let mut rows = Vec::new();
    for (at, (interface, slots)) in class.protocols.iter().zip(tables).enumerate() {
        // The lowering writes both words; a bare struct name has no `GType`
        // function to ask.
        let Some(get_type) = interface.split_whitespace().nth(1) else {
            continue;
        };
        if !called(program, get_type) && declared.insert(get_type.to_owned()) {
            let _ = writeln!(out, "declare i64 @{get_type}()");
        }
        let table = if slots.is_empty() {
            "null".to_owned()
        } else {
            let _ = writeln!(
                out,
                "@__nts_gobject_interface_{name}_{at} = internal constant [{} x {{ i64, ptr }}] [{}]",
                slots.len(),
                slots.join(", ")
            );
            format!("@__nts_gobject_interface_{name}_{at}")
        };
        rows.push(format!(
            "{{ ptr, ptr, i64 }} {{ ptr @{get_type}, ptr {table}, i64 {} }}",
            slots.len()
        ));
    }
    if rows.is_empty() {
        return Ok(String::new());
    }
    let _ = writeln!(
        out,
        "@__nts_gobject_interfaces_{name} = internal constant [{} x {{ ptr, ptr, i64 }}] [{}]",
        rows.len(),
        rows.join(", ")
    );
    Ok(format!(
        "  {}\n",
        runtime_call::call(
            Site::synthetic(program, "implementations").with_gobject(support),
            platform,
            "nts_gobject_add_interfaces",
            &[
                Operand::new("i64", "%made"),
                Operand::new("ptr", format!("@__nts_gobject_interfaces_{name}")),
                Operand::new("i64", rows.len().to_string())
            ]
        )?
    ))
}

/// The support files' functions the classes' registrations call, each declared
/// once, and only where a class calls it.
fn declarations(out: &mut String, support: Declarations) {
    for helper in [
        Support::Register,
        Support::New,
        Support::ClassChildren,
        Support::InitTemplate,
        Support::ClassTemplate,
        Support::ClassTemplateText,
        Support::BindCallback,
        Support::AddSignal,
        Support::SetProperties,
        Support::AddInterfaces,
    ] {
        support.declare(out, helper);
    }
}

/// A class's template: the `class_setup` hook setting it and binding each
/// child it names, and `nts_gtk_init_template` for each instance
/// (`nts_gtk.c`). The two hook arguments registration passes.
fn template(
    out: &mut String,
    program: &Program,
    platform: Platform,
    class: &ForeignClass,
    support: Declarations,
) -> Result<[Operand<'static>; 2], Diagnostic> {
    let Some(template) = &class.template else {
        return Ok([Operand::new("ptr", "null"), Operand::new("ptr", "null")]);
    };
    let name = &class.name;
    let binds = callbacks(out, program, platform, class, &template.callbacks, support)?;
    let set = match &template.text {
        TemplateText::Literal(text) => {
            bytes_constant(out, &format!("__nts_gobject_template_{name}"), text);
            format!(
                "  {}\n",
                runtime_call::call(
                    Site::synthetic(program, "template").with_gobject(support),
                    platform,
                    "nts_gtk_class_template",
                    &[
                        Operand::new("ptr", "%klass"),
                        Operand::new("ptr", format!("@__nts_gobject_template_{name}")),
                        Operand::new("i64", text.len().to_string())
                    ]
                )?
            )
        }
        // The reader's string, lent to GTK for the call, entered and left
        // as an entry point is; its result is the caller's to release only
        // where the program counts.
        TemplateText::Read(reader) => {
            let Some(compiled) = program.funcs.iter().find(|func| &func.name == reader) else {
                let missing = "a template whose reader this program does not define";
                return match program.funcs.first() {
                    Some(func) => Err(refuse(func, missing)),
                    None => Ok([Operand::new("ptr", "null"), Operand::new("ptr", "null")]),
                };
            };
            read_template(program, platform, compiled, support)?
        }
    };
    let mut names = Vec::new();
    for (at, child) in template.children.iter().enumerate() {
        bytes_constant(out, &format!("__nts_gobject_child_name_{name}_{at}"), child);
        names.push(format!("ptr @__nts_gobject_child_name_{name}_{at}"));
    }
    let table = if names.is_empty() {
        "null".to_owned()
    } else {
        let _ = writeln!(
            out,
            "@__nts_gobject_children_{name} = internal constant [{} x ptr] [{}]",
            names.len(),
            names.join(", ")
        );
        format!("@__nts_gobject_children_{name}")
    };
    let _ = writeln!(
        out,
        "define internal void @__nts_gobject_class_setup_{name}(ptr %klass) nounwind {{\n{set}  {children}\n{binds}  ret void\n}}",
        children = runtime_call::call(
            Site::synthetic(program, "template").with_gobject(support),
            platform,
            "nts_gtk_class_children",
            &[
                Operand::new("ptr", "%klass"),
                Operand::new("ptr", table),
                Operand::new("i64", names.len().to_string())
            ]
        )?
    );
    Ok([
        Operand::new("ptr", format!("@__nts_gobject_class_setup_{name}")),
        Operand::new("ptr", "@nts_gtk_init_template"),
    ])
}

/// The runtime template reader lends its string only for the GTK setup call.
fn read_template(
    program: &Program,
    platform: Platform,
    compiled: &Func,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let release = if program.provider == nts_core::hir::Memory::ReferenceCounting {
        format!(
            "  {}\n",
            runtime_call::call(
                Site::function(compiled),
                platform,
                "nts_release",
                &[Operand::new("ptr", "%text")]
            )?
        )
    } else {
        String::new()
    };
    Ok(format!(
        "  {runtime_0}\n  %text = {0}\n  %c = {runtime_1}\n  \
                 {set_template}\n  {runtime_2}\n{release}  \
                 {runtime_3}\n",
        runtime_call::direct(
            "ptr",
            &DirectCallee::compiled(Site::function(compiled), platform, program, &compiled.name)?,
            ""
        ),
        set_template = runtime_call::call(
            Site::synthetic(program, "template").with_gobject(support),
            platform,
            "nts_gtk_class_template_text",
            &[Operand::new("ptr", "%klass"), Operand::new("ptr", "%c")]
        )?,
        runtime_0 = runtime_call::call(
            Site::synthetic(program, "template"),
            platform,
            "nts_callback_enter",
            &[]
        )?,
        runtime_1 = runtime_call::call(
            Site::synthetic(program, "template"),
            platform,
            "nts_string_to_cstring",
            &[Operand::new("ptr", "%text")]
        )?,
        runtime_2 = runtime_call::call(
            Site::synthetic(program, "template"),
            platform,
            "nts_cstring_release",
            &[Operand::new("ptr", "%text"), Operand::new("ptr", "%c")]
        )?,
        runtime_3 = runtime_call::call(
            Site::synthetic(program, "template"),
            platform,
            "nts_callback_leave",
            &[]
        )?
    ))
}

/// Each method a template names as a signal's handler: the entry point a
/// virtual function's would be, instance first, and the shim GTK calls with
/// the signal's arguments and the instance last, its user data. Returns the
/// `class_setup` calls binding each by name.
fn callbacks(
    out: &mut String,
    program: &Program,
    platform: Platform,
    class: &ForeignClass,
    callbacks: &[ForeignMethod],
    support: Declarations,
) -> Result<String, Diagnostic> {
    let name = &class.name;
    let mut binds = String::new();
    for (at, callback) in callbacks.iter().enumerate() {
        let Some(compiled) = program
            .funcs
            .iter()
            .find(|func| func.name == callback.function)
        else {
            let missing =
                "a template's handler whose compiled function this program does not define";
            return match program.funcs.first() {
                Some(func) => Err(refuse(func, missing)),
                None => Ok(String::new()),
            };
        };
        let entry = format!("__nts_gobject_entry_{name}_cb_{at}");
        entry_point(program, out, platform, &entry, callback, compiled)?;
        let types = callback
            .signature
            .parameters
            .iter()
            .map(|ty| ty_of(&ty.abi(platform.abi), compiled).map(str::to_owned))
            .collect::<Result<Vec<_>, _>>()?;
        let result = callback.signature.result.abi(platform.abi);
        let returns = if result == HirType::Void {
            "void".to_owned()
        } else {
            ty_of(&result, compiled)?.to_owned()
        };
        let parameters: Vec<String> = types
            .iter()
            .enumerate()
            .skip(1)
            .map(|(at, ty)| format!("{ty} %a{at}"))
            .chain(["ptr %self".to_owned()])
            .collect();
        let arguments: Vec<Operand<'_>> = std::iter::once(Operand::new("ptr", "%self"))
            .chain(
                types
                    .iter()
                    .enumerate()
                    .skip(1)
                    .map(|(at, ty)| Operand::new(ty.as_str(), format!("%a{at}"))),
            )
            .collect();
        let shim = format!("__nts_gobject_callback_{name}_{at}");
        let called = runtime_call::external(
            Site::function(compiled),
            platform,
            &entry,
            &returns,
            &arguments,
        )?;
        if returns == "void" {
            let _ = writeln!(
                out,
                "define internal void @{shim}({}) nounwind {{\n  {called}\n  ret void\n}}",
                parameters.join(", ")
            );
        } else {
            let _ = writeln!(
                out,
                "define internal {returns} @{shim}({}) nounwind {{\n  %r = {called}\n  ret {returns} %r\n}}",
                parameters.join(", ")
            );
        }
        let handler = callback.selector().trim_start_matches("callback ");
        bytes_constant(out, &format!("{shim}.name"), handler);
        let _ = writeln!(
            binds,
            "  {}",
            runtime_call::call(
                Site::function(compiled).with_gobject(support),
                platform,
                "nts_gtk_bind_callback",
                &[
                    Operand::new("ptr", "%klass"),
                    Operand::new("ptr", format!("@{shim}.name")),
                    Operand::new("ptr", format!("@{shim}"))
                ]
            )?
        );
    }
    Ok(binds)
}

/// Each `nts_gobject_child_{Class}_{index}` the program calls, defined as
/// `gtk_widget_get_template_child` by the child's id, which lends it.
fn children(
    program: &Program,
    func: &Func,
    platform: Platform,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let mut out = String::new();
    support.declare(&mut out, Support::TemplateChild);
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
        let Some(id) = template_child(program, class, *index) else {
            continue;
        };
        let type_symbol = program.class_gtype(class).ok_or_else(|| {
            refuse(
                func,
                "a GObject thunk whose class is not in the emission index",
            )
        })?;
        let thunk = program.native_name(target);
        bytes_constant(&mut out, &format!("{thunk}.id"), id);
        let type_call =
            runtime_call::external(Site::function(func), platform, type_symbol, "i64", &[])?;
        let _ = writeln!(
            out,
            "define ptr @{thunk}(ptr %self) nounwind {{\n  %type = {type_call}\n  %child = {child_call}\n  ret ptr %child\n}}",
            child_call = runtime_call::call(
                Site::function(func).with_gobject(support),
                platform,
                "nts_gtk_template_child",
                &[
                    Operand::new("ptr", "%self"),
                    Operand::new("i64", "%type"),
                    Operand::new("ptr", format!("@{thunk}.id"))
                ]
            )?
        );
    }
    Ok(out)
}

/// The calls adding a class's signals to its `GType` (`%made`), one per
/// signal, with the constants they name written to `out`.
fn registrations(
    out: &mut String,
    program: &Program,
    platform: Platform,
    class: &ForeignClass,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let name = &class.name;
    let mut calls = String::new();
    for (at, signal) in class.signals.iter().enumerate() {
        bytes_constant(
            out,
            &format!("__nts_gobject_signal_{name}_{at}"),
            &signal.name,
        );
        bytes_constant(
            out,
            &format!("__nts_gobject_kinds_{name}_{at}"),
            &signal.kinds,
        );
        let _ = writeln!(
            calls,
            "  {}",
            runtime_call::call(
                Site::synthetic(program, "registrations").with_gobject(support),
                platform,
                "nts_gobject_add_signal",
                &[
                    Operand::new("i64", "%made"),
                    Operand::new("ptr", format!("@__nts_gobject_signal_{name}_{at}")),
                    Operand::new("ptr", format!("@__nts_gobject_kinds_{name}_{at}"))
                ]
            )?
        );
    }
    Ok(calls)
}

/// A class's properties as the runtime's `get_property` and `set_property`
/// reach them: a wrapper per accessor, entered and left as an entry point is,
/// and the `{ name, kind, get, set }` table registration hands over. `None`
/// for a class with none.
fn properties(
    out: &mut String,
    program: &Program,
    platform: Platform,
    class: &ForeignClass,
) -> Result<Option<String>, Diagnostic> {
    if class.properties.is_empty() {
        return Ok(None);
    }
    let name = &class.name;
    let mut rows = Vec::new();
    for (at, property) in class.properties.iter().enumerate() {
        let find = |wanted: &str| program.funcs.iter().find(|func| func.name == wanted);
        let (Some(get), Some(set)) = (find(&property.getter), find(&property.setter)) else {
            let missing = "a GObject property whose accessor this program does not define";
            return match program.funcs.first() {
                Some(func) => Err(refuse(func, missing)),
                None => Ok(None),
            };
        };
        let value = ty_of(&get.return_type, get)?;
        let _ = writeln!(
            out,
            "define internal {value} @__nts_gobject_get_{name}_{at}(ptr %self) nounwind {{\n  {runtime_0}\n  %r = {0}\n  {runtime_1}\n  ret {value} %r\n}}",
            runtime_call::direct(
                value,
                &DirectCallee::compiled(Site::function(get), platform, program, &get.name)?,
                "ptr %self"
            ),
            runtime_0 = runtime_call::call(
                Site::synthetic(program, "properties"),
                platform,
                "nts_callback_enter",
                &[]
            )?,
            runtime_1 = runtime_call::call(
                Site::synthetic(program, "properties"),
                platform,
                "nts_callback_leave",
                &[]
            )?
        );
        let _ = writeln!(
            out,
            "define internal void @__nts_gobject_set_{name}_{at}(ptr %self, {value} %v) nounwind {{\n  {runtime_0}\n  {0}\n  {runtime_1}\n  ret void\n}}",
            runtime_call::direct(
                "void",
                &DirectCallee::compiled(Site::function(set), platform, program, &set.name)?,
                format!("ptr %self, {value} %v")
            ),
            runtime_0 = runtime_call::call(
                Site::synthetic(program, "properties"),
                platform,
                "nts_callback_enter",
                &[]
            )?,
            runtime_1 = runtime_call::call(
                Site::synthetic(program, "properties"),
                platform,
                "nts_callback_leave",
                &[]
            )?
        );
        bytes_constant(
            out,
            &format!("__nts_gobject_property_{name}_{at}"),
            &property.name,
        );
        rows.push(format!(
            "{{ ptr, i8, ptr, ptr }} {{ ptr @__nts_gobject_property_{name}_{at}, i8 {}, ptr @__nts_gobject_get_{name}_{at}, ptr @__nts_gobject_set_{name}_{at} }}",
            u32::from(property.kind)
        ));
    }
    let _ = writeln!(
        out,
        "@__nts_gobject_properties_{name} = internal constant [{} x {{ ptr, i8, ptr, ptr }}] [{}]",
        rows.len(),
        rows.join(", ")
    );
    Ok(Some(format!("@__nts_gobject_properties_{name}")))
}

/// Each `nts_gobject_notify_{Class}_{index}` the program calls -- a write of
/// a property's field -- defined as `g_object_notify_by_pspec` with the
/// property's spec, found once and kept.
fn notifies(
    program: &Program,
    func: &Func,
    platform: Platform,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let mut out = String::new();
    if support.declare(&mut out, Support::PropertySpec) {
        out.push_str("declare void @g_object_notify_by_pspec(ptr, ptr)\n");
    }
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
        let type_symbol = program.class_gtype(class).ok_or_else(|| {
            refuse(
                func,
                "a GObject thunk whose class is not in the emission index",
            )
        })?;
        let thunk = program.native_name(target);
        let type_call =
            runtime_call::external(Site::function(func), platform, type_symbol, "i64", &[])?;
        let _ = writeln!(
            out,
            "@{thunk}.spec = internal global ptr null\n\
             define void @{thunk}(ptr %self) nounwind {{\nentry:\n\
             \x20 %kept = load ptr, ptr @{thunk}.spec\n  %none = icmp eq ptr %kept, null\n  br i1 %none, label %find, label %have\n\
             find:\n  %type = {type_call}\n  %found = {spec_call}\n\
             \x20 store ptr %found, ptr @{thunk}.spec\n  br label %have\n\
             have:\n  %spec = phi ptr [ %kept, %entry ], [ %found, %find ]\n\
             \x20 call void @g_object_notify_by_pspec(ptr %self, ptr %spec)\n  ret void\n}}",
            spec_call = runtime_call::call(
                Site::function(func).with_gobject(support),
                platform,
                "nts_gobject_property_spec",
                &[
                    Operand::new("i64", "%type"),
                    Operand::new("i32", index.to_string())
                ]
            )?
        );
    }
    Ok(out)
}

/// A NUL-terminated byte string constant, escaped as IR spells one: a signal's
/// name is a property name the program wrote, and may hold anything.
fn bytes_constant(out: &mut String, name: &str, value: &str) {
    let mut escaped = String::new();
    for byte in value.bytes() {
        match byte {
            b'"' | b'\\' => {
                let _ = write!(escaped, "\\{byte:02X}");
            }
            b' '..=b'~' => escaped.push(char::from(byte)),
            _ => {
                let _ = write!(escaped, "\\{byte:02X}");
            }
        }
    }
    let _ = writeln!(
        out,
        "@{name} = private unnamed_addr constant [{} x i8] c\"{escaped}\\00\"",
        value.len() + 1
    );
}

/// Each `nts_gobject_emit_{kinds}__{name}` the program calls, defined as its
/// prototype declares it: `g_signal_emit` by the signal's id, which
/// `nts_gobject_signal_id` finds on the instance's type once and keeps in
/// the thunk's cache. `g_signal_emit` is variadic, and C promotes what it
/// passes there: a `bool` is widened to the `int` a `gboolean` is.
fn emits(
    program: &Program,
    platform: Platform,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let mut out = String::new();
    if support.declare(&mut out, Support::SignalId) {
        out.push_str("declare void @g_signal_emit(ptr, i32, i32, ...)\n");
    }
    let mut done = std::collections::BTreeSet::new();
    for (func, target) in program
        .native_funcs()
        .flat_map(|func| func.values.iter().map(move |op| (func, op)))
        .filter_map(|(func, op)| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(&target.thunk, Some(GObjectThunk::Signal { .. })) => Some((func, target)),
            _ => None,
        })
    {
        if !done.insert(program.native_name(target)) {
            continue;
        }
        let Some(GObjectThunk::Signal { name: signal, .. }) = &target.thunk else {
            continue;
        };
        let thunk = program.native_name(target);
        bytes_constant(&mut out, &format!("{thunk}.name"), signal);
        let types = target
            .parameters
            .iter()
            .map(|ty| ty_of(&ty.abi(platform.abi), func).map(str::to_owned))
            .collect::<Result<Vec<_>, _>>()?;
        let parameters: Vec<String> = types
            .iter()
            .enumerate()
            .map(|(at, ty)| format!("{ty} %a{at}"))
            .collect();
        let mut body = String::new();
        let mut passed = Vec::new();
        for (at, ty) in types.iter().enumerate().skip(1) {
            let slot = target.parameters[at].abi(platform.abi);
            passed.push(promoted(&mut body, at, ty, &slot));
        }
        let mut rest = String::new();
        for arg in &passed {
            let _ = write!(rest, ", {arg}");
        }
        // A signal that answers writes its handlers' result through a
        // location passed after the parameters, which the thunk returns.
        let (returns, slot, answer) = if matches!(target.result, Type::Void) {
            ("void".to_owned(), String::new(), "  ret void\n".to_owned())
        } else {
            let ty = ty_of(&target.result.abi(platform.abi), func)?.to_owned();
            let zero = if matches!(ty.as_str(), "float" | "double") {
                "0.0"
            } else {
                "0"
            };
            let _ = write!(rest, ", ptr %r");
            (
                ty.clone(),
                format!("  %r = alloca {ty}\n  store {ty} {zero}, ptr %r\n"),
                format!("  %v = load {ty}, ptr %r\n  ret {ty} %v\n"),
            )
        };
        let _ = writeln!(
            out,
            "@{thunk}.cache = internal global [2 x i64] zeroinitializer\n\
             define {returns} @{thunk}({}) nounwind {{\nentry:\n{slot}\
             \x20 %id = {id_call}\n\
             {body}\
             \x20 call void (ptr, i32, i32, ...) @g_signal_emit(ptr %a0, i32 %id, i32 0{rest})\n{answer}}}",
            parameters.join(", "),
            id_call = runtime_call::call(
                Site::function(func).with_gobject(support),
                platform,
                "nts_gobject_signal_id",
                &[
                    Operand::new("ptr", "%a0"),
                    Operand::new("ptr", format!("@{thunk}.name")),
                    Operand::new("ptr", format!("@{thunk}.cache"))
                ]
            )?
        );
    }
    Ok(out)
}

/// Argument `at` (`%a{at}`, of LLVM type `ty`, the target's `slot` for it)
/// as C passes it through `...`: a `bool` or narrow integer widened to `int`
/// -- signed as the target holds it, so a `char` is extended by its row's
/// sign -- and a `float` to `double`, which is what the callee's `va_arg`
/// reads.
fn promoted(body: &mut String, at: usize, ty: &str, slot: &HirType) -> Operand<'static> {
    let signed = matches!(slot, HirType::Int { signed: true, .. });
    match ty {
        "i1" | "i8" | "i16" => {
            let widen = if signed { "sext" } else { "zext" };
            let _ = writeln!(body, "  %p{at} = {widen} {ty} %a{at} to i32");
            Operand::new("i32", format!("%p{at}"))
        }
        "float" => {
            let _ = writeln!(body, "  %p{at} = fpext float %a{at} to double");
            Operand::new("double", format!("%p{at}"))
        }
        _ => Operand::new(ty.to_owned(), format!("%a{at}")),
    }
}

/// Each `nts_gobject_prop_{kind}__{name}` the program calls -- a write of a
/// property with no setter method -- defined as its prototype declares it:
/// `g_object_set` by the property's name, the value promoted as C's varargs
/// promote it.
fn set_by_name(
    program: &Program,
    platform: Platform,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let mut out = String::new();
    // A write of a property with no setter method, to `g_object_set`; a
    // construct-only property a construction gives, to the support file's
    // builder. Each thunk is `{prefix}{kind}__{name}`.
    for operation in [PropertyOperation::Set, PropertyOperation::Construct] {
        let mut done = std::collections::BTreeSet::new();
        for (func, target) in program
            .native_funcs()
            .flat_map(|func| func.values.iter().map(move |op| (func, op)))
            .filter_map(|(func, op)| match &op.kind {
                OpKind::Call {
                    callee: Callee::Native(target),
                    ..
                } if matches!(&target.thunk, Some(GObjectThunk::Property { operation: found, .. }) if *found == operation) => {
                    Some((func, target))
                }
                _ => None,
            })
        {
            if !done.insert(program.native_name(target)) {
                continue;
            }
            let Some(GObjectThunk::Property { name: property, .. }) = &target.thunk else { continue; };
            let [object, value] = target.parameters.as_slice() else {
                return Err(refuse(
                    func,
                    "a property thunk that does not take an object and a value",
                ));
            };
            if done.len() == 1 {
                match operation {
                    PropertyOperation::Set => {
                        out.push_str("declare void @g_object_set(ptr, ptr, ...)\n");
                    }
                    PropertyOperation::Construct => {
                        support.declare(&mut out, Support::WithBuilderAdd);
                    }
                    PropertyOperation::Get => unreachable!("the property setter's two operations"),
                }
            }
            let thunk = program.native_name(target);
            bytes_constant(
                &mut out,
                &format!("{thunk}.name"),
                &property.clone(),
            );
            let object = ty_of(&object.abi(platform.abi), func)?;
            let slot = value.abi(platform.abi);
            let value = ty_of(&slot, func)?;
            let mut body = String::new();
            let operands = [
                Operand::new(object, "%a0"),
                Operand::new("ptr", format!("@{thunk}.name")),
                promoted(&mut body, 1, value, &slot),
                Operand::new("ptr", "null"),
            ];
            let called = match operation {
                PropertyOperation::Set => runtime_call::direct(
                    "void (ptr, ptr, ...)",
                    &DirectCallee::symbol(Site::function(func), platform, "g_object_set")?,
                    runtime_call::operands_text(&operands),
                ),
                PropertyOperation::Construct => runtime_call::call(
                    Site::function(func).with_gobject(support),
                    platform,
                    "nts_gobject_with_builder_add",
                    &operands,
                )?,
                PropertyOperation::Get => unreachable!("the property setter's two operations"),
            };
            let _ = writeln!(
                out,
                "define void @{thunk}({object} %a0, {value} %a1) nounwind {{\nentry:\n{body}\x20 {called}\n  ret void\n}}"
            );
        }
    }
    Ok(out)
}

/// Each `nts_gobject_propget_{kind}__{name}` the program calls -- a read of
/// a property with no getter method -- defined as `g_object_get` into a
/// local of the property's own type.
fn get_by_name(program: &Program, platform: Platform) -> Result<String, Diagnostic> {
    let mut out = String::new();
    let mut done = std::collections::BTreeSet::new();
    for (func, target) in program
        .native_funcs()
        .flat_map(|func| func.values.iter().map(move |op| (func, op)))
        .filter_map(|(func, op)| match &op.kind {
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
                Some((func, target))
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
        if done.len() == 1 {
            out.push_str("declare void @g_object_get(ptr, ptr, ...)\n");
        }
        let thunk = program.native_name(target);
        bytes_constant(&mut out, &format!("{thunk}.name"), &property.clone());
        let value = ty_of(&target.result.abi(platform.abi), func)?.to_owned();
        let zero = match value.as_str() {
            "float" | "double" => "0.0",
            "ptr" => "null",
            _ => "0",
        };
        let _ = writeln!(
            out,
            "define {value} @{thunk}(ptr %a0) nounwind {{\nentry:\n  %r = alloca {value}\n  store {value} {zero}, ptr %r\n\x20 call void (ptr, ptr, ...) @g_object_get(ptr %a0, ptr @{thunk}.name, ptr %r, ptr null)\n  %v = load {value}, ptr %r\n  ret {value} %v\n}}"
        );
    }
    Ok(out)
}

/// Each chain-up thunk the program calls (`super.vfunc_clicked()`): the
/// parent's slot at the offset its name carries, called if it is there.
fn chains(
    program: &Program,
    platform: Platform,
    parents: &mut std::collections::BTreeSet<String>,
    support: Declarations,
) -> Result<String, Diagnostic> {
    let mut out = String::new();
    support.declare(&mut out, Support::ParentSlot);
    let mut done = std::collections::BTreeSet::new();
    for (func, target) in program
        .native_funcs()
        .flat_map(|func| func.values.iter().map(move |op| (func, op)))
        .filter_map(|(func, op)| match &op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } if matches!(&target.thunk, Some(GObjectThunk::Chain { .. })) => Some((func, target)),
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
        let Some(parent) = program
            .foreign_classes
            .iter()
            .find(|foreign| {
                foreign.family == Family::GObject && foreign.name.as_str() == class.as_str()
            })
            .map(|foreign| foreign.superclass.clone())
        else {
            return Err(refuse(
                func,
                "a chain-up in a class this program does not register",
            ));
        };
        let parent_type = parent
            .gtype()
            .ok_or_else(|| refuse(func, "a GObject chain-up without typed parent provenance"))?;
        let parent = program.gtype_name(parent_type).ok_or_else(|| {
            refuse(
                func,
                "a GObject chain-up parent this program does not register",
            )
        })?;
        if matches!(parent_type, GType::Declared(_))
            && !called(program, parent)
            && parents.insert(parent.to_owned())
        {
            let _ = writeln!(out, "declare i64 @{parent}()");
        }
        let types = target
            .parameters
            .iter()
            .map(|ty| ty_of(&ty.abi(platform.abi), func).map(str::to_owned))
            .collect::<Result<Vec<_>, _>>()?;
        let parameters: Vec<String> = types
            .iter()
            .enumerate()
            .map(|(at, ty)| format!("{ty} %a{at}"))
            .collect();
        let result = target.result.abi(platform.abi);
        let returns = if result == HirType::Void {
            "void".to_owned()
        } else {
            ty_of(&result, func)?.to_owned()
        };
        let parent_call =
            runtime_call::external(Site::function(func), platform, parent, "i64", &[])?;
        let _ = writeln!(
            out,
            "define {returns} @{}({}) nounwind {{\nentry:\n  %parent = {parent_call}\n  %slot = {slot_call}\n  %none = icmp eq ptr %slot, null\n  br i1 %none, label %skip, label %call\ncall:",
            program.native_name(target),
            parameters.join(", "),
            slot_call = runtime_call::call(
                Site::function(func).with_gobject(support),
                platform,
                "nts_gobject_parent_slot",
                &[
                    Operand::new("i64", "%parent"),
                    Operand::new("i64", offset.to_string())
                ]
            )?
        );
        chain_call(&mut out, &returns, &parameters.join(", "));
    }
    Ok(out)
}

/// A missing parent slot has the same zero result as the C support thunk.
fn chain_call(out: &mut String, returns: &str, arguments: &str) {
    if returns == "void" {
        let _ = writeln!(
            out,
            "  call void %slot({arguments})\n  ret void\nskip:\n  ret void\n}}"
        );
    } else {
        let zero = if returns == "ptr" {
            "null".to_owned()
        } else if returns.starts_with('i') {
            "0".to_owned()
        } else {
            "0.0".to_owned()
        };
        let _ = writeln!(
            out,
            "  %r = call {returns} %slot({arguments})\n  ret {returns} %r\nskip:\n  ret {returns} {zero}\n}}"
        );
    }
}

/// One override's entry point, `nts_gobject_<Class>_<at>`: the slot's C
/// arguments converted to the compiled method's, and its result back.
#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
fn entry_point(
    program: &Program,
    out: &mut String,
    platform: Platform,
    entry: &str,
    method: &ForeignMethod,
    compiled: &Func,
) -> Result<(), Diagnostic> {
    if compiled.params.len() != method.signature.parameters.len() {
        return Err(refuse(
            compiled,
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
            compiled,
            "a GObject virtual function taking or returning a record by value",
        ));
    }
    // A `string` the slot answers is one GTK holds past the call, and nothing
    // yet says whose copy that is.
    if nts_core::hir::native::lent_string(&method.signature.result, &compiled.return_type) {
        return Err(refuse(
            compiled,
            "a GObject virtual function answering a string",
        ));
    }
    let mut parameters = Vec::new();
    let mut arguments = Vec::new();
    let mut body = String::new();
    // What the entry makes inside the callback and gives back before leaving
    // it, as the C backend's entry and both closure bridges do.
    let (mut copies, mut releases) = (String::new(), String::new());
    for (slot, (foreign, want)) in method
        .signature
        .parameters
        .iter()
        .zip(&compiled.params)
        .enumerate()
    {
        let from = foreign.abi(platform.abi);
        let from_ty = ty_of(&from, compiled)?;
        parameters.push(format!("{from_ty} %a{slot}"));
        // A string GTK lends: copied in for the call, given back after it.
        // Read as the method's `NtsString *` it is bytes taken for a header.
        if nts_core::hir::native::lent_string(foreign, &want.ty) {
            let _ = writeln!(
                copies,
                "  %s{slot} = {runtime_0}",
                runtime_0 = runtime_call::call(
                    Site::function(compiled),
                    platform,
                    "nts_string_from_cstring",
                    &[Operand::new("ptr", format!("%a{slot}"))]
                )?
            );
            let _ = writeln!(
                releases,
                "  {runtime_0}",
                runtime_0 = runtime_call::call(
                    Site::function(compiled),
                    platform,
                    "nts_release",
                    &[Operand::new("ptr", format!("%s{slot}"))]
                )?
            );
            arguments.push(format!("ptr %s{slot}"));
            continue;
        }
        let to_ty = ty_of(&want.ty, compiled)?;
        // One handle as another -- the slot's `GtkWidget *` as the method's
        // `GtkButton *` `this`, which is what the instance is, since GTK
        // calls this class's slot with this class's instances -- is the same
        // pointer.
        let handles = matches!(
            (&from, &want.ty),
            (HirType::NativePointer(_), HirType::NativePointer(_))
        );
        if from == want.ty || handles {
            arguments.push(format!("{to_ty} %a{slot}"));
        } else if want.ty == HirType::Bool {
            let _ = writeln!(
                body,
                "  {}",
                is_not_zero(&format!("%p{slot}"), &from, from_ty, &format!("%a{slot}"))
            );
            arguments.push(format!("{to_ty} %p{slot}"));
        } else {
            let instruction = conversion(&from, &want.ty, compiled)?;
            let _ = writeln!(
                body,
                "  %p{slot} = {instruction} {from_ty} %a{slot} to {to_ty}"
            );
            arguments.push(format!("{to_ty} %p{slot}"));
        }
    }
    crate::entry_parameters::pad(program, compiled, &mut arguments, platform, &mut body)?;
    let want = method.signature.result.abi(platform.abi);
    let have = compiled.return_type.clone();
    let call = runtime_call::direct(
        ty_of(&have, compiled)?,
        &DirectCallee::compiled(Site::function(compiled), platform, program, &compiled.name)?,
        arguments.join(", "),
    );
    if want == HirType::Void {
        let _ = writeln!(
            out,
            "define internal void @{entry}({}) nounwind {{",
            parameters.join(", ")
        );
        out.push_str(&body);
        let _ = writeln!(
            out,
            "  {runtime_0}\n{copies}  {call}\n{releases}  {runtime_1}\n  ret void\n}}",
            runtime_0 = runtime_call::call(
                Site::function(compiled),
                platform,
                "nts_callback_enter",
                &[]
            )?,
            runtime_1 = runtime_call::call(
                Site::function(compiled),
                platform,
                "nts_callback_leave",
                &[]
            )?
        );
    } else {
        let want_ty = ty_of(&want, compiled)?;
        let _ = writeln!(
            out,
            "define internal {want_ty} @{entry}({}) nounwind {{",
            parameters.join(", ")
        );
        out.push_str(&body);
        let _ = writeln!(
            out,
            "  {runtime_0}\n{copies}  %r = {call}\n{releases}  {runtime_1}",
            runtime_0 = runtime_call::call(
                Site::function(compiled),
                platform,
                "nts_callback_enter",
                &[]
            )?,
            runtime_1 = runtime_call::call(
                Site::function(compiled),
                platform,
                "nts_callback_leave",
                &[]
            )?
        );
        // And back: the method's `GtkLabel *` as the slot's `gpointer`
        // (`GListModelInterface get_item`) is the same pointer.
        let handles = matches!(
            (&have, &want),
            (HirType::NativePointer(_), HirType::NativePointer(_))
        );
        if have == want || handles {
            let _ = writeln!(out, "  ret {want_ty} %r\n}}");
        } else {
            let instruction = conversion(&have, &want, compiled)?;
            let _ = writeln!(
                out,
                "  %c = {instruction} {} %r to {want_ty}\n  ret {want_ty} %c\n}}",
                ty_of(&have, compiled)?
            );
        }
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn every_support_helper_is_exported_with_its_own_signature() {
        assert_eq!(SUPPORT_SIGNATURES.len(), Support::ALL.len());
        for (exported, &helper) in SUPPORT_SIGNATURES.iter().zip(Support::ALL) {
            let known = helper.signature();
            assert_eq!(exported.name, known.name);
            assert_eq!(exported.returns, known.returns);
            assert_eq!(exported.params, known.params);
            assert_eq!(
                signature(known.name).map(|found| found.name),
                Some(known.name)
            );
        }
    }

    /// The builder's fixed operands are checked exactly; its tail is rendered
    /// at the callee's function type, and only promoted types may fill it.
    #[test]
    fn a_variadic_support_call_checks_its_fixed_prefix_and_promoted_tail() {
        let program = nts_core::hir::Program::default();
        let mut selected = Declarations::default();
        selected.insert(Support::WithBuilderAdd);
        let site = Site::synthetic(&program, "builder").with_gobject(selected);
        let fixed = [Operand::new("ptr", "%a0"), Operand::new("ptr", "@n")];
        for platform in [
            Platform::SYSV_X86_64,
            Platform::WIN64_X86_64,
            Platform::APPLE_ARM64,
            Platform::LINUX_ARM64,
            Platform::WINDOWS_ARM64,
        ] {
            let call = |operands: &[Operand<'_>]| {
                runtime_call::call(site, platform, "nts_gobject_with_builder_add", operands)
            };
            let mut operands = fixed.to_vec();
            operands.extend([Operand::new("i32", "%a1"), Operand::new("ptr", "null")]);
            // Rendered calls are compared after `call `, so these expected
            // texts are not themselves read as calls by the source audit.
            let rendered = |operands: &[Operand<'_>]| {
                call(operands)
                    .expect("typed control")
                    .strip_prefix("call ")
                    .unwrap()
                    .to_owned()
            };
            assert_eq!(
                rendered(&operands),
                "void (ptr, ptr, ...) @nts_gobject_with_builder_add(ptr %a0, ptr @n, i32 %a1, ptr null)"
            );
            assert_eq!(
                rendered(&fixed),
                "void (ptr, ptr, ...) @nts_gobject_with_builder_add(ptr %a0, ptr @n)"
            );
            let mut wrong = operands.clone();
            wrong[0] = Operand::new("double", "%a0");
            assert_eq!(
                call(&wrong).expect_err("a mistyped fixed argument").message,
                "runtime helper nts_gobject_with_builder_add parameter 1: expected ptr, found double (in `builder`)"
            );
            assert_eq!(
                call(&fixed[..1])
                    .expect_err("a missing fixed argument")
                    .message,
                "runtime helper nts_gobject_with_builder_add parameter 2: expected ptr, found <missing argument> (in `builder`)"
            );
            for unpromoted in ["i1", "i8", "i16", "half", "bfloat", "float"] {
                let mut tail = operands.clone();
                tail[2] = Operand::new(unpromoted, "%a1");
                assert_eq!(
                    call(&tail)
                        .expect_err("an unpromoted tail argument")
                        .message,
                    format!(
                        "runtime helper nts_gobject_with_builder_add variadic argument 3: {unpromoted} is not a type C's default argument promotions pass through `...` (in `builder`)"
                    )
                );
            }
            for promoted in ["i32", "i64", "double", "ptr"] {
                let mut tail = operands.clone();
                tail[2] = Operand::new(promoted, "%a1");
                assert!(call(&tail).is_ok(), "{promoted}");
            }
        }
    }

    #[test]
    fn support_calls_require_their_declaration_and_check_each_argument() {
        let program = nts_core::hir::Program::default();
        let site = Site::synthetic(&program, "support-control");
        for (at, &helper) in Support::ALL.iter().enumerate() {
            let known = helper.signature();
            assert_eq!(support(known.name), Some(helper));
            let mut selected = Declarations::default();
            selected.insert(helper);
            let scoped = site.with_gobject(selected);
            let unselected = Support::ALL[(at + 1) % Support::ALL.len()].signature();
            let error = runtime_call::call(scoped, Platform::SYSV_X86_64, unselected.name, &[])
                .expect_err("a different support declaration is not granted");
            assert!(error.message.contains("this program does not emit"));
            let operands: Vec<_> = known
                .fixed()
                .iter()
                .map(|ty| Operand::new(*ty, "%v"))
                .collect();
            let function_type = if known.variadic() {
                format!("({}) ", known.params.join(", "))
            } else {
                String::new()
            };
            for platform in [
                Platform::SYSV_X86_64,
                Platform::WIN64_X86_64,
                Platform::APPLE_ARM64,
                Platform::LINUX_ARM64,
                Platform::WINDOWS_ARM64,
            ] {
                let refused = runtime_call::call(site, platform, known.name, &operands)
                    .expect_err("missing scope");
                assert!(refused.message.contains(&format!(
                    "{}, whose GObject support declaration this program does not emit",
                    known.name
                )));
                let control = runtime_call::call(scoped, platform, known.name, &operands)
                    .expect("selected declaration");
                assert_eq!(
                    control.strip_prefix("call ").unwrap(),
                    format!(
                        "{} {function_type}@{}({})",
                        known.returns,
                        known.name,
                        runtime_call::operands_text(&operands)
                    )
                );
                assert_eq!(
                    runtime_call::external(scoped, platform, known.name, known.returns, &operands)
                        .unwrap(),
                    control
                );
                assert!(
                    runtime_call::external(site, platform, known.name, known.returns, &operands)
                        .is_err()
                );
                for position in 0..operands.len() {
                    let mut wrong = operands.clone();
                    wrong[position].ty = "double".into();
                    let error = runtime_call::call(scoped, platform, known.name, &wrong)
                        .expect_err("wrong producer type");
                    assert_eq!(error.code, "NTS3001");
                    assert_eq!(
                        error.message,
                        format!(
                            "runtime helper {} parameter {}: expected {}, found double (in `support-control`)",
                            known.name,
                            position + 1,
                            known.fixed()[position]
                        )
                    );
                    assert!(
                        runtime_call::external(scoped, platform, known.name, known.returns, &wrong)
                            .is_err()
                    );
                    assert!(
                        runtime_call::external_quoted(
                            scoped,
                            platform,
                            known.name,
                            known.returns,
                            &wrong
                        )
                        .is_err()
                    );
                }
                for spelling in [
                    format!("@{}", known.name),
                    format!("@\"{}\"", known.name),
                    format!("@\"{}\"", known.name.replacen('_', "\\5F", 1)),
                ] {
                    assert!(DirectCallee::global(scoped, platform, spelling).is_err());
                }
            }
        }
    }
}
