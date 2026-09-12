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
/// **`Field::declared_by`, not arithmetic.** This used to answer "the highest
/// ancestor still long enough to contain this index", which is right until two
/// classes declare one name -- and `class Base { #count }` with
/// `class Derived extends Base { #count }` is two fields in JavaScript. That
/// derivation is the same shape of reasoning as C's offset assumption, one
/// level up, and it is why the first fix for that case produced
///
/// ```text
/// NoSuchFieldError: nts.gen.Base does not have member field 'int $count$t1'
/// ```
///
/// rather than a wrong answer: a rename in the derived layout left two layouts
/// disagreeing about the name of one slot, which cannot matter to a lane that
/// addresses a field by index and is fatal to one that addresses it by name and
/// class. See record 0265.
///
/// `None` is a field no class declares -- a tuple's `_0`, a closure's capture,
/// an anonymous object type's member -- and the layout holding it is the owner.
///
/// The id may name a type merged into this layout rather than the layout's own:
/// structurally identical classes share one `Layout` under the first one's
/// name. `program.layout` resolves that to the layout actually emitted, which
/// is the class name a `Fieldref` needs.
#[must_use]
pub fn declares_field<'a>(program: &'a Program, layout: &'a Layout, field: usize) -> &'a Layout {
    layout
        .fields
        .get(field)
        .and_then(|at| at.declared_by)
        .and_then(|id| program.layout(id))
        .unwrap_or(layout)
}

/// The declared classes sharing one layout, when more than one does.
///
/// **Two classes with identical fields are one `Layout` on purpose** --
/// structural typing requires it, so `readA(new B())` passes -- and that gave
/// them one JVM class and therefore one identity: `new B() instanceof A`
/// answered true where node says false, with nothing refused and nothing
/// printed.
///
/// The layout's class stays and holds the fields; each class sharing it gets an
/// empty subclass, and `new` and `instanceof` name that while parameters and
/// fields keep the base. So identity separates and assignability does not move.
/// The C lane does the same thing with a descriptor per class over one struct --
/// `nts_desc_NtsObj_A__A` beside `nts_desc_NtsObj_A__B` -- and this is that
/// with the JVM's own spelling.
///
/// Empty when one class owns the layout, which is nearly always: five groups
/// and twelve classes across the twenty-two `runtime/node` modules.
#[must_use]
pub fn identities<'a>(program: &'a Program, layout: &Layout) -> Vec<&'a nts_core::hir::ClassIdentity> {
    let sharing: Vec<&nts_core::hir::ClassIdentity> = program
        .classes
        .iter()
        .filter(|class| class.types.iter().any(|at| layout.types.contains(at)))
        .collect();
    if sharing.len() < 2 { Vec::new() } else { sharing }
}

/// The class a type id names, when its layout is shared by more than one.
#[must_use]
pub fn identity_of(program: &Program, id: TypeId) -> Option<&nts_core::hir::ClassIdentity> {
    let layout = program.layout(id)?;
    identities(program, layout).into_iter().find(|class| class.types.contains(&id))
}

/// Whether anything extends this layout, which is the whole of what decides
/// `ACC_FINAL`.
#[must_use]
pub fn extended(program: &Program, layout: &Layout) -> bool {
    // A layout whose classes have their own subclasses is extended by them, so
    // it cannot be `final`. Asked first because it is the cheaper question.
    if !identities(program, layout).is_empty() {
        return true;
    }
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

/// The JVM name a dispatch slot is known by, which is the *declaring* layout's
/// and not the implementing function's.
///
/// The JVM resolves a virtual call by name and descriptor, so an override has to
/// carry the name the base declared. For an ordinary hierarchy that falls out of
/// [`member_name`] on its own: an implementer of `Shape#area` is called
/// `Square#area`, and both sides of the `#` agree by construction.
///
/// **A generator resumption does not agree.** `Generator0` declares the slot as
/// `Generator0#resume` and the frame that fills it is `upTo__resume` -- a free
/// function with no `#` in it at all -- so naming the forwarder after the
/// implementer emitted `public boolean upTo__resume()` on a class whose
/// superclass declares `abstract boolean resume()`. Both methods exist, neither
/// overrides the other, and the failure is
///
/// ```text
/// java.lang.AbstractMethodError: Receiver class nts.gen.upTo$frame does not
/// define or inherit an implementation of the resolved method
/// 'abstract boolean resume()' of abstract class nts.gen.Generator0
/// ```
///
/// which the verifier does not catch, because an override is checked at the call
/// and not at load.
///
/// So the name is taken from the base-most layout that declares the slot. That
/// is the same correction `Field::declared_by` made for fields -- the class that
/// *declares* a member is a different question from the one that implements it,
/// and only the first decides what the JVM calls it.
#[must_use]
pub fn declared_member(program: &Program, layout: &Layout, slot: usize) -> Option<String> {
    let mut at = layout;
    let mut name = at.methods.get(slot)?.as_ref()?;
    // Up the chain while a base also declares this slot: the first declaration
    // is the one the JVM resolved against.
    while let Some(base) = program.base_layout(at).and_then(|id| program.layouts.get(id)) {
        match base.methods.get(slot).and_then(Option::as_ref) {
            Some(inherited) => {
                name = inherited;
                at = base;
            }
            None => break,
        }
    }
    Some(member_name(name))
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
    // The edge, **and** that the target is emitted as an interface. `implemented`
    // below already filters by `is_interface` and its comment says the two
    // halves have to agree -- there are three, and this was the one that did
    // not ask.
    //
    // `interface Named { name: string }` is the case. It declares a property,
    // so `is_interface` refuses it and it is emitted as a *class*; `implemented`
    // then leaves it out of `Thing`'s `interfaces[]`, so the class file relates
    // them not at all. This function said the edge existed, the assignability
    // check believed it, and the store was emitted:
    //
    // ```text
    // nts/gen/Program.subject(D)D @14: invokestatic
    //   Type 'nts/gen/Thing' is not assignable to 'nts/gen/Named'
    // ```
    //
    // A `VerifyError` is the one outcome this backend is supposed to make
    // impossible, and it is the corpus's `unverifiable class` row. Refusing by
    // name is correct here: an interface carrying state is not expressible as a
    // JVM interface, and the program relates the two in a way this lane cannot
    // spell.
    //
    // The edge test is first because it is a `contains` and `is_interface`
    // scans every layout.
    ancestry(program, layout).iter().any(|at| at.interfaces.contains(&id))
        && program.layout(id).is_some_and(|target| is_interface(program, target))
}
