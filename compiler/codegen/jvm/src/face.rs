//! The typed face a written signature publishes to Java: the callback
//! interface it implements, the `call` a Java caller invokes, and the shape a
//! Java lambda adapts into.
//!
//! # Why this reads `Program::signature_faces` and nothing else
//!
//! It used to read the signature layout's typed `call` slot, and on
//! 2026-09-30 that slot stopped existing: A6 (519195e49) gave every signature
//! the uniform erased entry and removed the pass that declared a typed `call`
//! on one (`declare_unfilled_signatures`/`signature_shell`). Nothing went red.
//! `implements NtsNumberCallback`, `call(double)`, `Fn…$Lambda` and the
//! `eachUpTo(double, NtsNumberCallback)` overload all vanished together, and
//! Java could no longer pass a callback at all -- found six weeks of commits
//! later by the first full run of `interop`/`ts-from-java`. The reader lived in
//! this crate and the fact in lowering, so the coupling was invisible.
//!
//! The face now comes from the checker's signature on the layout's own type
//! id, carried by lowering as `signature_faces` for exactly the written
//! signatures `declare_erased_entries` declares an entry on. A position that
//! cannot be typed is a `None` there, and publishes no typed face -- the
//! erased entry still exists, so the class is callable from TypeScript and
//! only the Java face is absent, by name, rather than everything at once.

use nts_core::hir::{HirType, Layout, Program};
use nts_jvm_emitter::code::Code;
use nts_jvm_emitter::{Kind, Pool, VType};

use crate::{hierarchy, types};

/// A written signature's Java face.
pub(crate) struct Face {
    /// The runtime callback interface the typed descriptor is.
    pub(crate) interface: &'static str,
    /// The typed descriptor Java calls, `(D)V` for `(x: number) => void`.
    pub(crate) typed: String,
    /// The written parameters, represented, in order.
    pub(crate) params: Vec<HirType>,
    /// The uniform entry's member name and descriptor, which the typed face
    /// forwards to and a lambda adapter implements.
    pub(crate) member: String,
    pub(crate) erased: String,
}

/// The face `layout` publishes, or `None` where it has none: not a written
/// signature, a position with no representation, a rest parameter, or a
/// descriptor no runtime callback interface names.
#[must_use]
pub(crate) fn of(package: &str, program: &Program, layout: &Layout) -> Option<Face> {
    if !types::is_signature(program, layout) {
        return None;
    }
    let face = program.signature_faces.get(layout.types.first()?)?;
    let shape = types::Shape::packaged(program, package);
    let mut params = Vec::with_capacity(face.params.len());
    let mut spelled = Vec::with_capacity(face.params.len());
    for part in &face.params {
        if part.rest {
            return None;
        }
        let ty = part.ty.clone()?;
        spelled.push(types::descriptor(shape, &ty)?);
        params.push(ty);
    }
    let returns = types::return_descriptor(shape, face.returns.as_ref()?)?;
    let borrowed: Vec<&str> = spelled.iter().map(String::as_str).collect();
    let typed = nts_jvm_emitter::descriptor::method(&borrowed, &returns);
    let interface = types::callback_interface(&typed)?;
    let slot = program.erased_call_slot?;
    let name = layout.methods.get(slot as usize)?.as_ref()?;
    let func = program.funcs.iter().find(|f| &f.name == name)?;
    let erased = crate::instance_descriptor(package, program, func)?;
    let member = hierarchy::declared_member(program, layout, slot as usize)
        .unwrap_or_else(|| hierarchy::member_name(name));
    // Every value the typed face boxes and a lambda unboxes has to be one of
    // the two this file can convert; anything else publishes no face.
    if !params.iter().all(convertible) {
        return None;
    }
    Some(Face {
        interface,
        typed,
        params,
        member,
        erased,
    })
}

/// The kinds of parameter a callback interface can carry that this face
/// converts: a number, and a string.
fn convertible(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Float { bits: 64 } | HirType::Managed(nts_core::hir::ManagedType::String)
    )
}

/// Box the typed value on the stack into an `NtsValue`.
pub(crate) fn boxed(
    code: &mut Code,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
    ty: &HirType,
) {
    if let HirType::Float { .. } = ty {
        code.invoke_static(
            origin,
            pool,
            types::VALUE,
            "ofNumber",
            "(D)Lnts/rt/NtsValue;",
        );
    } else {
        code.invoke_static(
            origin,
            pool,
            types::VALUE,
            "ofString",
            "(Ljava/lang/String;)Lnts/rt/NtsValue;",
        );
    }
}

/// Unbox the `NtsValue` on the stack to the typed value.
pub(crate) fn unboxed(
    code: &mut Code,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
    ty: &HirType,
) {
    if let HirType::Float { .. } = ty {
        code.get_field(origin, pool, types::VALUE, "num", "D");
    } else {
        code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
        code.check_cast(origin, pool, "java/lang/String");
    }
}

/// The verification type and kind of one converted parameter.
pub(crate) fn slot_of(ty: &HirType) -> (VType, Kind) {
    if let HirType::Float { .. } = ty {
        (VType::Double, Kind::Double)
    } else {
        (VType::Object("java/lang/String".to_owned()), Kind::Ref)
    }
}

/// The signature class's concrete typed `call`: box each argument, pad to the
/// program's width with `undefined`, dispatch the uniform entry, and discard
/// its answer -- every callback interface returns `void`.
///
/// Concrete rather than abstract, so it holds whichever closure the class is
/// extended by: a Java caller invoking `call(double)` on any value of the
/// signature reaches that closure's body through the entry every call site
/// already uses, and no closure has to declare a typed method of its own.
pub(crate) fn typed_call(
    package: &str,
    layout: &Layout,
    face: &Face,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Body, nts_jvm_emitter::Error> {
    let class = types::class_name(package, layout);
    let mut locals = vec![VType::Object(class.clone())];
    locals.extend(face.params.iter().map(|ty| slot_of(ty).0));
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);
    code.load(origin, Kind::Ref, 0);
    // The call's `this` (`hir::UNIFORM_THIS`): a Java caller has none to give,
    // so `undefined`, as a plain JavaScript call passes.
    code.get_static(
        origin,
        pool,
        types::VALUE,
        "UNDEFINED_VALUE",
        types::VALUE_DESCRIPTOR,
    );
    let mut at: u16 = 1;
    for ty in &face.params {
        let (vtype, kind) = slot_of(ty);
        code.load(origin, kind, at);
        boxed(&mut code, pool, origin, ty);
        at += vtype.slots();
    }
    // The erased entry's descriptor names the `this` and then the arguments.
    let width = nts_jvm_emitter::descriptor::parameters(&face.erased).map_or(0, |list| list.len());
    for _ in face.params.len() + 1..width {
        code.get_static(
            origin,
            pool,
            types::VALUE,
            "UNDEFINED_VALUE",
            types::VALUE_DESCRIPTOR,
        );
    }
    code.invoke_virtual(origin, pool, &class, &face.member, &face.erased);
    code.pop(origin, 1);
    code.ret(origin, None);
    code.finish(pool)
}
