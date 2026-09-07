//! What a class extends, and the dispatch that depends on it.
//!
//! The other two backends do not need this module. C survives on base-first
//! field order, which makes an upcast a pointer cast; LLVM survives because
//! `ptr` is opaque. **The JVM verifier survives on neither**: passing a `Square`
//! where `Shape` is declared is rejected at link time unless `nts/gen/Square`
//! really has `nts/gen/Shape` as its `super_class`. So this lane is the one that
//! has to know the hierarchy, and `Layout.base` is what carries it.
//!
//! Before that field existed this backend guessed, by refusing any program where
//! one layout's fields were a proper prefix of another's. The guess was
//! *unsound in the direction that matters*: `class Bounce extends Benchmark`
//! with no fields on either side is a prefix of nothing, so all eight `awfy-*`
//! cases walked straight through the check and would have emitted a class the
//! verifier rejects. A refusal that over-refuses is safe; one that under-refuses
//! is a broken artifact, and only the field made the difference visible.

use nts_core::hir::{Field, Layout, Program};
use nts_semantic_schema::TypeId;

/// Every layout from `layout` up to the root, `layout` first.
#[must_use]
pub fn ancestry<'a>(program: &'a Program, layout: &'a Layout) -> Vec<&'a Layout> {
    let mut chain = vec![layout];
    let mut current = layout;
    // Bounded by the layout count, because a cycle in `base` would otherwise
    // hang the compiler rather than refuse. `verify` rejects one upstream; this
    // is the cheap belt for a fact this module cannot check for itself.
    for _ in 0..program.layouts.len() {
        let Some(at) = program.base_layout(current) else { break };
        let Some(next) = program.layouts.get(at) else { break };
        chain.push(next);
        current = next;
    }
    chain
}

/// How many of a layout's fields it inherits rather than declares.
///
/// A base's fields are a prefix of the derived's -- `hir::verify` checks it --
/// so the count is the base's length and the declared fields are the tail. The
/// JVM needs the split because a field declared in both a class and its
/// superclass is two fields, and `getfield` on the wrong one reads the wrong
/// storage rather than failing.
#[must_use]
pub fn inherited(program: &Program, layout: &Layout) -> usize {
    program
        .base_layout(layout)
        .and_then(|at| program.layouts.get(at))
        .map_or(0, |base| base.fields.len())
}

/// The fields a class declares itself.
#[must_use]
pub fn declared<'a>(program: &Program, layout: &'a Layout) -> &'a [Field] {
    let from = inherited(program, layout).min(layout.fields.len());
    &layout.fields[from..]
}

/// The class that declares one field, by the index `FieldGet`/`FieldSet` carry.
///
/// The index is into the *derived* layout's field list, and fields are
/// base-first, so the declaring class is the highest ancestor still long enough
/// to contain it.
#[must_use]
pub fn declares_field<'a>(program: &'a Program, layout: &'a Layout, field: usize) -> &'a Layout {
    let mut owner = layout;
    for ancestor in ancestry(program, layout) {
        if ancestor.fields.len() > field {
            owner = ancestor;
        }
    }
    owner
}

/// Whether anything extends this layout, which is the whole of what decides
/// `ACC_FINAL`.
#[must_use]
pub fn extended(program: &Program, layout: &Layout) -> bool {
    let Some(mine) = program.layouts.iter().position(|c| std::ptr::eq(c, layout)) else {
        return true;
    };
    program
        .layouts
        .iter()
        .any(|other| program.base_layout(other) == Some(mine))
}

/// The JVM member name of a lowered method.
///
/// `Benchmark#benchmark` becomes `benchmark`, not `Benchmark$benchmark`: an
/// override and the thing it overrides must agree on the name or the JVM sees
/// two unrelated methods and dispatch silently picks the wrong one. The class
/// half of the lowered name is exactly what must *not* survive here.
#[must_use]
pub fn member_name(func_name: &str) -> String {
    let tail = func_name.rsplit('#').next().unwrap_or(func_name);
    crate::body::method_name(tail)
}

/// Is this layout emitted as a JVM *interface* rather than as a class?
///
/// True of a layout some other layout declares itself to implement. That is the
/// whole test: `Layout.interfaces` is the program's `implements` edges, so a
/// layout on the receiving end of one is a dispatch root and a layout on the
/// giving end is a class. A root with no implementers is not asked about,
/// because nothing can be stored into it and no call can reach it.
///
/// **Not decided from "has only abstract methods".** A base class every
/// subclass overrides looks exactly like that, and making it an interface would
/// silently drop its fields and its constructor.
#[must_use]
pub fn is_interface(program: &Program, layout: &Layout) -> bool {
    let named = program
        .layouts
        .iter()
        .any(|other| other.interfaces.iter().any(|id| layout.types.contains(id)));
    if !named {
        return false;
    }
    // **Named is not sufficient, and `examples/declared-wider` is why.**
    // `interface Tagged extends Error` puts `Error` in `Tagged.interfaces`,
    // and `Error` is a class with a `message` field. A JVM interface has no
    // instance fields and no subclasses that reach it through `super_class`,
    // so treating it as one refused the example by name -- correctly, but for
    // a relation that is a class relation wearing an interface's spelling.
    //
    // A dispatch root that carries state, or that something extends, is that
    // class. `Layout.base` already relates the two, and the assignability
    // check reports it when it does not.
    declared(program, layout).is_empty() && !extended(program, layout)
}

/// The interfaces this layout declares, as binary class names.
///
/// In `Layout.interfaces` order, which the IR sorts, so one input gives one
/// byte sequence -- the class file's `interfaces[]` is written in this order and
/// the jar-drift test compares bytes.
#[must_use]
pub fn implemented(program: &Program, layout: &Layout) -> Vec<String> {
    layout
        .interfaces
        .iter()
        .filter_map(|id| program.layout(*id))
        // Only what is *emitted* as an interface. `interface Tagged extends
        // Error` records `Error` here, and `Error` is a class -- declaring it
        // in `interfaces[]` gives `IncompatibleClassChangeError: class
        // nts.gen.Tagged can not implement nts.gen.Error, because it is not an
        // interface`, at load rather than at a call. The two halves have to
        // agree, so they ask the same question.
        .filter(|at| is_interface(program, at))
        .map(crate::types::class_name)
        .collect()
}

/// Does `layout`, or anything it extends, declare `id` as an interface?
///
/// The class half has to be walked here even though `Layout.interfaces` is
/// closed over interface *extension*: `class B extends A` where `A implements
/// Sink` leaves `B.interfaces` empty, and `B` is still assignable to `Sink`
/// because the JVM resolves a superclass's interfaces too.
#[must_use]
pub fn implements(program: &Program, layout: &Layout, id: TypeId) -> bool {
    ancestry(program, layout).iter().any(|at| at.interfaces.contains(&id))
}
