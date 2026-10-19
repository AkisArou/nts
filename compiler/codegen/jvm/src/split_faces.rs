//! Faces of fields that a class holds without extending: stage C of this
//! backend's field families.
//!
//! **One representation was the cause of four refusals.** A face that carries
//! state was a JVM *class*, because a JVM interface holds no instance field. A
//! class that fits it by shape, or declares that it implements it, does not
//! extend it -- so storing one where the face is declared, reading an erased one
//! back as the face, converting one through a licensed `FieldView` and calling a
//! family accessor through the face each had no spelling here. That was 325
//! declines across the runtime on 77a5da490, where C reads the face's fields
//! through the holder's struct by position and never needs one.
//!
//! Such a face is a [`split`] face. Its class stays, holding its fields, and a
//! companion interface, `L$Face` ([`interface_name`]), declares its slots --
//! its methods and its field families' accessors -- and an accessor per field
//! ([`accessor`]). A value of the face is referred to as the interface, which
//! the face's class and every holder implement, so a store, a cast and a view
//! need nothing. A read through the face is an accessor call: a family's, which
//! the core's `Materialize` access writes and a holder answers with its row or
//! the family's default; or, for a field no family moves, the field's own,
//! which a holder answers from the field it holds where the face does
//! ([`positional`]) -- the JVM's spelling of C reading the face's field out of
//! the holder's struct.
//!
//! Wasm GC's typed references meet the same wall, and take the same way out:
//! `codegen/wasm/src/gc.rs` types a face other owners reach at its root and
//! dispatches its reads.

use nts_core::hir::{Field, HirType, Layout};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::class::access;
use nts_jvm_emitter::code::Code;
use nts_jvm_emitter::insn;
use nts_jvm_emitter::{Class, ClassBuilder, Kind, Pool, VType};
use nts_semantic_schema::TypeId;
use rustc_hash::FxHashSet;

use crate::program::JvmProgram;
use crate::{body, hierarchy, types, widen};

/// Whether `layout` is a face: a TypeScript interface or object type.
///
/// **Only a face may be referred to as an interface.** `instanceof` names a
/// class, and a class referred to as an interface its holders implement would
/// answer it for every one of them. A face is never asked.
#[must_use]
pub(crate) fn is_face(program: &JvmProgram<'_>, layout: &Layout) -> bool {
    program
        .interface_identities
        .iter()
        .any(|identity| identity.types.iter().any(|id| layout.types.contains(id)))
}

/// Whether `face`'s holders are worth asking for: a face, through which a
/// value of another can flow, whether or not it splits itself.
#[must_use]
pub(crate) fn candidate(program: &JvmProgram<'_>, face: &Layout) -> bool {
    is_face(program, face)
}

/// Whether `face` may split. One that is a JVM interface already is left as
/// it is. One with a JVM superclass of its own may split only where that
/// superclass is its proved declared ancestry
/// ([`JvmProgram::declared_proved`]): the companion then extends the
/// ancestors' companions, so it never has to stand for a superclass the
/// declarations do not explain. Fields or none: a face of methods alone
/// that no edge names is not a JVM interface either
/// (`hierarchy::is_interface` is told by edges), so a class fitting it by
/// shape was refused a store the same way.
#[must_use]
pub(crate) fn eligible(program: &JvmProgram<'_>, face: &Layout) -> bool {
    !hierarchy::is_interface(program, face)
        && (hierarchy::jvm_base(program, face).is_none() || program.declared_proved(face))
}

/// The layouts other than `face`'s own whose values a value of `face` can be
/// directly: the receivers the core proves reach it (`Plan::prefix_receivers`
/// and `Plan::other_receivers`, for each type the layout holds), and the
/// classes that declare that they implement it -- those of them that can be a
/// value of it ([`fills`], [`keeps`]). In layout order. The closure through
/// holders that are faces is [`JvmProgram`]'s.
///
/// Built from those and **not from a family's `owners`**, which list only the
/// owners that move a field: a row is owed to them alone, and every other
/// holder reads the field where the face does (`Plan::default_for`).
#[must_use]
pub(crate) fn holders<'a>(program: &'a JvmProgram<'_>, face: &Layout) -> Vec<&'a Layout> {
    let plan = &program.interface_access;
    let reached: FxHashSet<TypeId> = face
        .types
        .iter()
        .flat_map(|id| {
            plan.prefix_receivers(*id)
                .unwrap_or_default()
                .iter()
                .chain(plan.other_receivers(*id).unwrap_or_default())
        })
        .copied()
        .collect();
    program
        .layouts
        .iter()
        .filter(|layout| {
            !std::ptr::eq(*layout, face)
                && (layout.types.iter().any(|id| reached.contains(id))
                    || layout.interfaces.iter().any(|id| face.types.contains(id)))
                && can_be(program, face, layout)
        })
        .collect()
}

/// Whether `face` is a split face. See the module.
#[must_use]
pub(crate) fn split(program: &JvmProgram<'_>, face: &Layout) -> bool {
    program.is_split(face)
}

/// The companion interface of a split face: what a value of the face is
/// referred to as (`types::reference_class`), what every holder implements and
/// what a dispatch through the face names. The face's own class keeps its
/// fields, its constructor and every access to them, and implements this too.
#[must_use]
pub(crate) fn interface_name(package: &str, layout: &Layout) -> String {
    format!("{}$Face", types::class_name(package, layout))
}

/// The accessor a positional access to field `at` of a split face calls: one
/// name, a getter `()T` and a setter `(T)V`.
#[must_use]
pub(crate) fn accessor(at: u32) -> String {
    format!("nts$field${at}")
}

/// Whether split face `face` can hold a value of `layout`.
#[must_use]
pub(crate) fn receives(program: &JvmProgram<'_>, face: &Layout, layout: &Layout) -> bool {
    program.member(face, layout)
}

/// Whether a value of `layout` can be a value of `face` in a program C answers:
/// it fills the face's live methods and keeps the fields reached through it.
/// Asked of a direct holder and of every member the closure adds.
#[must_use]
pub(crate) fn can_be(program: &JvmProgram<'_>, face: &Layout, layout: &Layout) -> bool {
    fills(program, face, layout) && keeps(program, face, layout)
}

/// Whether `layout` fills every method slot `face` declares, field families'
/// aside: what a value of the face can be, since a call through the face on
/// one that does not would find nothing there on C either.
///
/// **The receivers over-approximate a face of methods.** Every layout's fields
/// begin with none, so a face without fields counts every layout that flows
/// into it as a prefix receiver -- 53 in `assert` for `ReadableStreamBYOBHost`,
/// none of which has its methods. Taken as holders they made the face split
/// and gave each a refusing stub per method, for a store this backend could
/// already make.
///
/// **Only a slot some class fills** ([`JvmProgram::live`]): a method no call
/// reaches is pruned from its implementer and still declared by the face, and
/// asking for it refused `MemoryHttpCacheBody`, which `implements
/// HttpCacheBody`, as a holder of it in the seventeen modules that never call
/// `open` -- and the store `MemoryHttpCacheWriter#commit` makes with it.
fn fills(program: &JvmProgram<'_>, face: &Layout, layout: &Layout) -> bool {
    face.methods.iter().enumerate().all(|(slot, entry)| {
        entry.is_none()
            || program.selector(slot).is_some()
            || !program.live(slot)
            || layout.methods.get(slot).is_some_and(Option::is_some)
    })
}

/// Whether `layout` keeps every field of `face` where a read through the face
/// finds it: at the face's index, with its name and type ([`positional`]), or
/// moved and answered by a row of its own in the field's family.
///
/// **The same over-approximation, of fields.** A read of a field no family
/// moves is positional through the face -- C reads it at the face's offset --
/// so a receiver without it there is not a value of the face in any program C
/// answers. Taken as holders they were 1005 refusing accessor stubs in `util`
/// alone, for reads nothing could make, and an interface on each.
///
/// **Only a field something reaches by position through the face**
/// ([`JvmProgram::reached`]): a family is made for a field only where a read
/// through the face needs one, so a field nothing reads that way has none,
/// and asking for it refused `RequestContext` -- `ResponseContext`'s fields in
/// another order -- as a holder, and the view `createCacheStorage` makes of it
/// in seventeen modules.
fn keeps(program: &JvmProgram<'_>, face: &Layout, layout: &Layout) -> bool {
    (0..face.fields.len()).all(|at| {
        let at32 = u32::try_from(at).unwrap_or(u32::MAX);
        !program.reached(face, at32)
            || positional(layout, face, at32).is_some()
            || program.interface_access.families.iter().any(|family| {
                face.types.contains(&family.face)
                    && family.field == Some(at32)
                    && layout
                        .methods
                        .get(family.getter.slot as usize)
                        .is_some_and(Option::is_some)
            })
    })
}

/// The split faces `layout`'s class implements itself: those it belongs to
/// and no class above it implements already. In layout order.
#[must_use]
pub(crate) fn implemented<'a>(program: &'a JvmProgram<'_>, layout: &Layout) -> Vec<&'a Layout> {
    program.implemented(layout)
}

/// The field a holder reads where the face does: the holder's own field at the
/// face's index, if it has the face's name and type there.
///
/// That is the contract a family default rests on (`Plan::default_for`): a
/// receiver with no row holds the field where the face does. C reads it out of
/// the holder's struct at the face's offset. A JVM class has no offsets, so the
/// holder answers for itself, from the field it declares or inherits at that
/// index. `None` where it does not hold the face's field there, which is a
/// receiver the plan gives a row -- and its accessor refuses by name.
#[must_use]
pub(crate) fn positional<'a>(holder: &'a Layout, face: &Layout, at: u32) -> Option<&'a Field> {
    let theirs = face.fields.get(at as usize)?;
    let mine = holder.fields.get(at as usize)?;
    (mine.name == theirs.name && mine.ty == theirs.ty).then_some(mine)
}

/// One method a split face's interface declares.
pub(crate) enum Member {
    /// A dispatch slot of the face's: a method, or a field family's accessor.
    Slot { slot: usize },
    /// The accessor of the face's field `at`, a getter or (`writes`) a setter.
    Field { at: u32, writes: bool },
}

pub(crate) struct Declared {
    pub(crate) member: String,
    pub(crate) descriptor: String,
    pub(crate) kind: Member,
}

/// How `owner`'s class holds its field `at`: a `double` where the widen plan
/// says so, else as its type. The declaration and every access ask this.
fn held(
    program: &JvmProgram<'_>,
    package: &str,
    plan: &widen::Plan,
    owner: &Layout,
    at: usize,
) -> Option<String> {
    let field = owner.fields.get(at)?;
    let name = hierarchy::field_name(program, owner, at);
    let ty = if plan.field(&types::class_name(package, owner), &name) {
        HirType::Float { bits: 64 }
    } else {
        field.ty.clone()
    };
    types::field_descriptor(types::Shape::packaged(program, package), &ty)
}

/// The descriptor field `at` of split face `face` is read and written at
/// through its accessor: as the class that declares the field holds it,
/// which is what the positional access the accessor stands for leaves on
/// the stack. The declaring class rather than the face, so a child face
/// and the parent that declared an inherited field spell its accessor one
/// way -- the widen plan keys a field on its declaring class, and the two
/// companions would otherwise declare one accessor at two descriptors.
#[must_use]
pub(crate) fn field_descriptor(
    program: &JvmProgram<'_>,
    package: &str,
    plan: &widen::Plan,
    face: &Layout,
    at: u32,
) -> Option<String> {
    let owner = hierarchy::declares_field(program, face, at as usize);
    held(program, package, plan, owner, at as usize)
}

/// Every method a split face's interface declares: its slots, then a getter
/// and a setter per field. One derivation for the interface and for every class
/// that implements it, because two would drift and the drift is an
/// `AbstractMethodError` the verifier does not see.
///
/// # Errors
/// A slot or field with no JVM representation, by name.
pub(crate) fn members<'a>(
    program: &'a JvmProgram<'_>,
    package: &str,
    plan: &widen::Plan,
    face: &'a Layout,
) -> Result<Vec<Declared>, String> {
    let mut out: Vec<Declared> = Vec::new();
    // A field family's accessors, from the families whose face this is and by
    // their declared functions: the face's own table holds a row at such a
    // slot only where the face is itself allocated, and a call names the
    // declaration either way (`JvmProgram::selector`).
    let declared = program
        .interface_access
        .families
        .iter()
        .filter(|family| face.types.contains(&family.face))
        .flat_map(|family| {
            std::iter::once(&family.getter)
                .chain(family.setter.iter())
                .chain(family.raising.iter())
        })
        .map(|entry| (entry.slot as usize, Some(entry.declared.clone())));
    let own = face
        .methods
        .iter()
        .enumerate()
        .filter(|(slot, _)| program.selector(*slot).is_none())
        .map(|(slot, entry)| (slot, entry.clone()));
    let mut slots: Vec<(usize, Option<String>)> = own.chain(declared).collect();
    slots.sort_by_key(|(slot, _)| *slot);
    for (slot, entry) in slots {
        let Some(name) = entry else { continue };
        let Some(func) = program.funcs.iter().find(|f| f.name == name) else {
            // A family accessor reachability removed is one no call names: a
            // face read and never written keeps its setter's entry and loses
            // its declaration.
            if program.selector(slot).is_some() {
                continue;
            }
            return Err(format!(
                "`{}` declares slot {slot} as `{name}`, which this program does not define",
                face.name
            ));
        };
        let Some(descriptor) = crate::instance_descriptor(package, program, func) else {
            return Err(format!(
                "`{name}`, a slot of `{}`, has no JVM signature",
                face.name
            ));
        };
        let member = program.selector(slot).map_or_else(
            || {
                hierarchy::declared_member(program, face, slot)
                    .unwrap_or_else(|| hierarchy::member_name(&name))
            },
            hierarchy::member_name,
        );
        if out
            .iter()
            .any(|known| known.member == member && known.descriptor == descriptor)
        {
            continue;
        }
        out.push(Declared {
            member,
            descriptor,
            kind: Member::Slot { slot },
        });
    }
    for at in 0..face.fields.len() {
        let at = u32::try_from(at).map_err(|_| format!("`{}` has too many fields", face.name))?;
        // Only a field something reaches by position through the face has an
        // accessor: no other call names one.
        if !program.reached(face, at) {
            continue;
        }
        let Some(held) = field_descriptor(program, package, plan, face, at) else {
            return Err(format!(
                "field {at} of `{}` has no JVM representation",
                face.name
            ));
        };
        out.push(Declared {
            member: accessor(at),
            descriptor: format!("(){held}"),
            kind: Member::Field { at, writes: false },
        });
        out.push(Declared {
            member: accessor(at),
            descriptor: format!("({held})V"),
            kind: Member::Field { at, writes: true },
        });
    }
    Ok(out)
}

/// The companion interface of split face `face`, declaring [`members`]. It
/// extends the JVM interfaces the face's layout declares, and the
/// companions of its declared parents ([`JvmProgram::declared_parents`]) --
/// and **no other companion**: a member class implements each companion it
/// belongs to itself (`JvmProgram::settle_faces`), so two faces that merely
/// flow into each other are not two interfaces extending each other. The
/// declared graph is acyclic where proved, which is all that stands
/// between these edges and that circularity.
///
/// # Errors
/// A member with no representation, by name.
pub(crate) fn interface_class(
    program: &JvmProgram<'_>,
    package: &str,
    plan: &widen::Plan,
    face: &Layout,
    origin: &nts_semantic_schema::Origin,
) -> Result<Class, Diagnostic> {
    let refused = |why: String| Diagnostic::error("NTS4004", why, origin.location);
    let mut builder =
        ClassBuilder::new(interface_name(package, face), "java/lang/Object".to_owned());
    builder.access = access::PUBLIC | access::INTERFACE | access::ABSTRACT;
    builder.source_file = Some("nts".to_owned());
    for declared in face
        .interfaces
        .iter()
        .filter_map(|id| program.layout(*id))
        .filter(|at| hierarchy::is_interface(program, at))
    {
        builder
            .interfaces
            .push(types::class_name(package, declared));
    }
    // Its declared parents, every one of them: a diamond's two arms both,
    // never a first parent. A split parent is extended at its companion; a
    // parent emitted as a JVM interface is extended as itself.
    for parent in program.declared_parents(face) {
        let name = if program.is_split(parent) {
            interface_name(package, parent)
        } else if hierarchy::is_interface(program, parent) {
            types::class_name(package, parent)
        } else {
            continue;
        };
        if !builder.interfaces.contains(&name) {
            builder.interfaces.push(name);
        }
    }
    for declared in members(program, package, plan, face).map_err(refused)? {
        builder.method(
            access::PUBLIC | access::ABSTRACT,
            declared.member,
            declared.descriptor,
            None,
        );
    }
    builder
        .build(Pool::new())
        .map_err(|error| refused(format!("`{}`'s interface: {error}", face.name)))
}

/// Answer, on `layout`'s class, every companion member it must and neither
/// declares already nor inherits: those of its own face where it splits, and of
/// each split face it holds that no superclass does.
///
/// Also a face's own field families where it does not split: a dispatch through
/// the face names its class, so the class answers with the family's default.
///
/// # Errors
/// A member with no representation, by name.
#[allow(clippy::too_many_arguments)]
pub(crate) fn implement(
    program: &JvmProgram<'_>,
    package: &str,
    plan: &widen::Plan,
    layout: &Layout,
    builder: &mut ClassBuilder,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<(), Diagnostic> {
    let refused = |why: String| Diagnostic::error("NTS4003", why, origin.location);
    let present = |builder: &ClassBuilder, member: &str, descriptor: &str| {
        builder
            .methods
            .iter()
            .any(|m| m.name == member && m.descriptor == descriptor)
    };
    // Its own families' accessors, which a split face's members include: a
    // dispatch through a face that does not split names its class.
    if !split(program, layout) {
        for declared in members(program, package, plan, layout).map_err(&refused)? {
            let Member::Slot { slot } = declared.kind else {
                continue;
            };
            if program.selector(slot).is_none()
                || present(builder, &declared.member, &declared.descriptor)
            {
                continue;
            }
            let body = slot_body(
                program,
                package,
                layout,
                layout,
                slot,
                &declared.member,
                &declared.descriptor,
                pool,
                origin,
            )?;
            builder.method(
                access::PUBLIC,
                declared.member,
                declared.descriptor,
                Some(body),
            );
        }
    }
    let mut faces: Vec<&Layout> = Vec::new();
    if split(program, layout) {
        faces.push(layout);
    }
    faces.extend(implemented(program, layout));
    for face in faces {
        for declared in members(program, package, plan, face).map_err(&refused)? {
            if present(builder, &declared.member, &declared.descriptor) {
                continue;
            }
            let body = match declared.kind {
                Member::Slot { slot, .. } => slot_body(
                    program,
                    package,
                    layout,
                    face,
                    slot,
                    &declared.member,
                    &declared.descriptor,
                    pool,
                    origin,
                )?,
                Member::Field { at, writes } => field_body(
                    program,
                    package,
                    plan,
                    layout,
                    face,
                    at,
                    writes,
                    &declared.descriptor,
                    pool,
                    origin,
                )?,
            };
            builder.method(
                access::PUBLIC,
                declared.member,
                declared.descriptor,
                Some(body),
            );
        }
    }
    Ok(())
}

/// A slot of `face` that `layout`'s class has no method for: a field family's
/// accessor answers with the family's default, which reads the face's storage
/// through the field accessors; any other slot refuses by name.
#[allow(clippy::too_many_arguments)]
fn slot_body(
    program: &JvmProgram<'_>,
    package: &str,
    layout: &Layout,
    face: &Layout,
    slot: usize,
    member: &str,
    descriptor: &str,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Body, Diagnostic> {
    let class = types::class_name(package, layout);
    let default = u32::try_from(slot)
        .ok()
        .filter(|slot| program.interface_access.contains_selector(*slot))
        .and_then(|slot| program.interface_access.default_for(slot))
        .and_then(|name| program.funcs.iter().find(|f| f.name == name));
    let Some(default) = default else {
        return refusing(
            &class,
            descriptor,
            &format!(
                "`{}` holds `{}` and has no `{member}`",
                layout.name, face.name
            ),
            pool,
            origin,
        );
    };
    let Some(full) = body::signature(package, program, default) else {
        return Err(Diagnostic::error(
            "NTS4003",
            format!("`{}`, a family default, has no JVM signature", default.name),
            origin.location,
        ));
    };
    let parameters = nts_jvm_emitter::descriptor::parameters(descriptor).unwrap_or_default();
    let mut locals = vec![VType::Object(class)];
    for parameter in &parameters {
        locals.push(vtype_of(parameter));
    }
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);
    code.load(origin, Kind::Ref, 0);
    let mut at: u16 = 1;
    for parameter in &parameters {
        let kind = kind_of(parameter);
        code.load(origin, kind, at);
        at += kind.words();
    }
    code.invoke_static(
        origin,
        pool,
        &body::program_class(package),
        &body::method_name(&default.name),
        &full,
    );
    code.ret(origin, returned(descriptor));
    code.finish(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4003",
            format!("`{}`'s `{member}`: {error}", layout.name),
            origin.location,
        )
    })
}

/// The accessor of `face`'s field `at` on `layout`'s class: the field it holds
/// there, read or written as the face holds it.
#[allow(clippy::too_many_arguments)]
fn field_body(
    program: &JvmProgram<'_>,
    package: &str,
    plan: &widen::Plan,
    layout: &Layout,
    face: &Layout,
    at: u32,
    writes: bool,
    descriptor: &str,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Body, Diagnostic> {
    let class = types::class_name(package, layout);
    let wanted = if writes {
        nts_jvm_emitter::descriptor::parameters(descriptor)
            .and_then(|list| list.first().map(|one| (*one).to_owned()))
    } else {
        descriptor.strip_prefix("()").map(str::to_owned)
    };
    let holds = std::ptr::eq(layout, face) || positional(layout, face, at).is_some();
    let owner = hierarchy::declares_field(program, layout, at as usize);
    let have = held(program, package, plan, owner, at as usize);
    let (Some(wanted), true, Some(have)) = (wanted, holds, have) else {
        // Which of the two it is, said in the stub so a census of class files
        // can count them apart: a field a family moves is read through the
        // holder's row and never through this; one no family moves would be a
        // positional read through the face, which C would make at the face's
        // offset in the holder's struct.
        let moved = program
            .interface_access
            .families
            .iter()
            .any(|family| face.types.contains(&family.face) && family.field == Some(at));
        return refusing(
            &class,
            descriptor,
            &format!(
                "`{}` holds `{}` without its field `{}` where the face has it ({})",
                layout.name,
                face.name,
                face.fields
                    .get(at as usize)
                    .map_or("?", |f| f.name.as_str()),
                if moved {
                    "a family row answers for it"
                } else {
                    "no family moves it"
                }
            ),
            pool,
            origin,
        );
    };
    // The one difference two holders of one field can have: the widen plan
    // holding it as a `double` in one class and not the other.
    let (into, out) = match (have.as_str(), wanted.as_str()) {
        (h, w) if h == w => (None, None),
        ("D", "I") => (Some(insn::I2D), Some(insn::D2I)),
        ("I", "D") => (Some(insn::D2I), Some(insn::I2D)),
        _ => {
            return refusing(
                &class,
                descriptor,
                &format!(
                    "`{}` holds `{}`'s field {at} as `{have}` where the face holds `{wanted}`",
                    layout.name, face.name
                ),
                pool,
                origin,
            );
        }
    };
    let name = hierarchy::field_name(program, owner, at as usize);
    let owner_class = types::class_name(package, owner);
    let mut locals = vec![VType::Object(class)];
    if writes {
        locals.push(vtype_of(&wanted));
    }
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);
    code.load(origin, Kind::Ref, 0);
    if writes {
        code.load(origin, kind_of(&wanted), 1);
        if let Some(opcode) = into {
            code.convert(origin, opcode, kind_of(&wanted), kind_of(&have));
        }
        code.put_field(origin, pool, &owner_class, &name, &have);
        code.ret(origin, None);
    } else {
        code.get_field(origin, pool, &owner_class, &name, &have);
        if let Some(opcode) = out {
            code.convert(origin, opcode, kind_of(&have), kind_of(&wanted));
        }
        code.ret(origin, Some(kind_of(&wanted)));
    }
    code.finish(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4003",
            format!("`{}`'s accessor of field {at}: {error}", layout.name),
            origin.location,
        )
    })
}

/// A method that refuses by name when called, the way a declined function's
/// stub does: for a member the plan says this class never answers.
pub(crate) fn refusing(
    class: &str,
    descriptor: &str,
    why: &str,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Body, Diagnostic> {
    let parameters = nts_jvm_emitter::descriptor::parameters(descriptor).unwrap_or_default();
    let mut locals = vec![VType::Object(class.to_owned())];
    for parameter in &parameters {
        locals.push(vtype_of(parameter));
    }
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);
    code.const_string(origin, pool, why);
    code.invoke_static(
        origin,
        pool,
        body::RUNTIME,
        "refused",
        "(Ljava/lang/String;)V",
    );
    code.const_null(origin);
    code.athrow(origin);
    code.finish(pool)
        .map_err(|error| Diagnostic::error("NTS4003", format!("{why}: {error}"), origin.location))
}

fn kind_of(descriptor: &str) -> Kind {
    match descriptor.as_bytes().first() {
        Some(b'J') => Kind::Long,
        Some(b'F') => Kind::Float,
        Some(b'D') => Kind::Double,
        Some(b'L' | b'[') => Kind::Ref,
        _ => Kind::Int,
    }
}

fn vtype_of(descriptor: &str) -> VType {
    match descriptor.as_bytes().first() {
        Some(b'J') => VType::Long,
        Some(b'F') => VType::Float,
        Some(b'D') => VType::Double,
        Some(b'L') => VType::Object(descriptor[1..descriptor.len() - 1].to_owned()),
        Some(b'[') => VType::Object(descriptor.to_owned()),
        _ => VType::Integer,
    }
}

fn returned(descriptor: &str) -> Option<Kind> {
    let result = descriptor.rsplit(')').next()?;
    (result != "V").then(|| kind_of(result))
}
