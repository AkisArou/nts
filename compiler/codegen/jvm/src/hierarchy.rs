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

use crate::program::JvmProgram;
use nts_core::hir::{Field, HirType, Layout, ManagedType};
use nts_semantic_schema::TypeId;

/// Names and declaring owners are facts of the immutable layout graph. Build
/// them once; a wide record must not rescan a prefix at every field access.
#[derive(Debug, Default)]
pub(crate) struct Fields {
    rows: Vec<FieldRow>,
}

#[derive(Debug)]
struct FieldRow {
    names: Vec<Result<String, String>>,
    owners: Vec<usize>,
}

/// One indexed answer, consumed by component storage without resolving the
/// same owner and name a second time.
#[derive(Clone, Copy)]
pub(crate) struct ResolvedField<'a> {
    pub(crate) owner: &'a Layout,
    pub(crate) index: usize,
    pub(crate) name: &'a str,
    pub(crate) field: &'a Field,
}

/// The emitted single-parent relation, with parent-first order and subtree
/// intervals. Ancestry membership never walks a chain for each stored slot.
#[derive(Debug, Default)]
pub(crate) struct Bases {
    parents: Vec<Option<usize>>,
    order: Vec<usize>,
    intervals: Vec<Option<(usize, usize)>>,
}

impl Bases {
    pub(crate) fn new(program: &JvmProgram<'_>) -> Self {
        let parents: Vec<_> = program
            .layouts
            .iter()
            .map(|l| resolve_base(program, l))
            .collect();
        let mut children = vec![Vec::new(); parents.len()];
        let mut roots = Vec::new();
        for (at, parent) in parents.iter().enumerate() {
            if let Some(parent) = parent {
                children[*parent].push(at);
            } else {
                roots.push(at);
            }
        }
        let mut order = Vec::with_capacity(parents.len());
        let mut intervals = vec![None; parents.len()];
        let mut starts = vec![0; parents.len()];
        let mut stack: Vec<_> = roots.into_iter().rev().map(|at| (at, false)).collect();
        while let Some((at, exit)) = stack.pop() {
            if exit {
                intervals[at] = Some((starts[at], order.len()));
                continue;
            }
            starts[at] = order.len();
            order.push(at);
            stack.push((at, true));
            stack.extend(children[at].iter().rev().map(|&child| (child, false)));
        }
        // Core verification rejects cycles. Keep malformed disconnected cycles
        // bounded here, without certifying their ancestry.
        order.extend(
            intervals
                .iter()
                .enumerate()
                .filter_map(|(at, span)| span.is_none().then_some(at)),
        );
        Self {
            parents,
            order,
            intervals,
        }
    }

    fn contains(&self, ancestor: usize, descendant: usize) -> bool {
        if ancestor == descendant {
            return true;
        }
        match (self.intervals[ancestor], self.intervals[descendant]) {
            (Some((a, z)), Some((b, y))) => a <= b && y <= z,
            _ => false,
        }
    }
}

impl Fields {
    pub(crate) fn new(program: &JvmProgram<'_>) -> Self {
        let mut rows: Vec<FieldRow> = (0..program.layouts.len())
            .map(|_| FieldRow {
                names: Vec::new(),
                owners: Vec::new(),
            })
            .collect();
        let mut fallbacks: Vec<Vec<usize>> = vec![Vec::new(); rows.len()];
        for &layout_at in &program.bases.order {
            let layout = &program.layouts[layout_at];
            let parent = program.bases.parents[layout_at];
            for (at, field) in layout.fields.iter().enumerate() {
                #[cfg(test)]
                field_cost::note(|c| {
                    c.name_materializations += 1;
                    c.owner_steps += 1;
                });
                let name = crate::member_identity::property(program, &field.name)
                    .map(|identity| crate::generated_members::storage_field(&identity));
                // A synthesized field inherits the base-most storage, even
                // when the parent has a nearer explicit source declaration.
                let inherited = parent.and_then(|parent| fallbacks[parent].get(at).copied());
                #[cfg(test)]
                if inherited.is_some() {
                    field_cost::note(|c| c.owner_steps += 1);
                }
                let fallback = inherited.unwrap_or(layout_at);
                let owner = field
                    .declared_by
                    .and_then(|id| program.layout_index(id))
                    // Source ownership selects storage only in the emitted
                    // ancestry, within the contiguous chain holding this slot.
                    .filter(|&owner| {
                        program.bases.contains(owner, layout_at)
                            && program.bases.contains(fallback, owner)
                    })
                    .unwrap_or(fallback);
                fallbacks[layout_at].push(fallback);
                rows[layout_at].names.push(name);
                rows[layout_at].owners.push(owner);
            }
        }
        Self { rows }
    }

    pub(crate) fn name(&self, layout: usize, field: usize) -> Option<&str> {
        self.rows
            .get(layout)?
            .names
            .get(field)?
            .as_ref()
            .ok()
            .map(String::as_str)
    }

    pub(crate) fn names(&self, layout: usize) -> Option<&[Result<String, String>]> {
        Some(&self.rows.get(layout)?.names)
    }

    pub(crate) fn resolve<'a>(
        &'a self,
        program: &'a JvmProgram<'_>,
        layout: &Layout,
        at: usize,
    ) -> Option<ResolvedField<'a>> {
        let owner_at = *self.rows.get(program.index(layout)?)?.owners.get(at)?;
        let owner = program.layouts.get(owner_at)?;
        Some(ResolvedField {
            owner,
            index: at,
            name: self.name(owner_at, at)?,
            field: owner.fields.get(at)?,
        })
    }
}

pub(crate) fn resolved_field<'a>(
    program: &'a JvmProgram<'_>,
    layout: &Layout,
    at: usize,
) -> Option<ResolvedField<'a>> {
    program.resolved_field(layout, at)
}

#[cfg(test)]
pub(crate) mod field_cost {
    use std::cell::Cell;
    #[derive(Clone, Copy, Debug, Default)]
    pub(crate) struct Counts {
        pub(crate) name_requests: usize,
        pub(crate) name_materializations: usize,
        pub(crate) prefix_visits: usize,
        pub(crate) owner_requests: usize,
        pub(crate) owner_steps: usize,
        pub(crate) index_visits: usize,
    }
    thread_local! { static COUNTS: Cell<Counts> = const { Cell::new(Counts {
        name_requests: 0, name_materializations: 0, prefix_visits: 0,
        owner_requests: 0, owner_steps: 0, index_visits: 0,
    }) }; }
    pub(crate) fn note(update: impl FnOnce(&mut Counts)) {
        COUNTS.with(|counts| {
            let mut value = counts.get();
            update(&mut value);
            counts.set(value);
        });
    }
    pub(crate) fn reset() {
        COUNTS.with(|counts| counts.set(Counts::default()));
    }
    pub(crate) fn get() -> Counts {
        COUNTS.with(Cell::get)
    }
}

/// The layout this one's class extends on the JVM: its `Layout.base`, or --
/// for a record with none -- its declared parent, `Program::record_parents`.
///
/// **Why a record's parent is a class relation here and nowhere else.** `interface
/// DetailJSON extends EntryJSON` is a declaration, and the layouts leave it out
/// on purpose: `Layout.base` takes part in representation identity
/// (`same_shape`), so a literal written at `DetailJSON` would stop sharing its
/// layout. C and LLVM never ask. The JVM does, because `perf_hooks`'
/// `PerformanceNodeEntry.toJSON(): PerformanceEntryDetailJSON` overrides
/// `toJSON(): PerformanceEntryJSON`, and a covariant return is bridged only
/// between related classes -- so it declined the class under NTS4009, and net,
/// dgram, process, `perf_hooks`, cluster and http with it.
///
/// Taken only where it is a base in every sense this backend relies on: every id
/// the layout holds that names a parent names the same parent layout; the
/// parent's fields are a prefix of this layout's, name and type -- which is
/// what `inherited`, `declared` and `declares_field` rest on; the parent carries
/// state, so it is no JVM interface; and neither side has ordinary method
/// dispatch. Native field-family entries do not change this record relation:
/// their shared slot contracts already agree, and stage B declines calls to
/// those selectors on the JVM. Otherwise `None`, and the refusal the JVM would have
/// given still stands. Deliberately free of `is_interface`, which asks this.
#[must_use]
pub fn jvm_base(program: &JvmProgram<'_>, layout: &Layout) -> Option<usize> {
    program
        .index(layout)
        .and_then(|at| program.bases.parents.get(at).copied())
        .unwrap_or_else(|| resolve_base(program, layout))
}

fn resolve_base(program: &JvmProgram<'_>, layout: &Layout) -> Option<usize> {
    if let Some(at) = program.base_layout(layout) {
        return Some(at);
    }
    let mut parent: Option<usize> = None;
    for id in &layout.types {
        let Some(declared) = program.record_parents.get(id) else {
            continue;
        };
        let at = program.layout_index(*declared)?;
        if parent.is_some_and(|seen| seen != at) {
            return None;
        }
        parent = Some(at);
    }
    let at = parent?;
    let base = program.layouts.get(at)?;
    let prefix = !base.fields.is_empty()
        && base.fields.len() < layout.fields.len()
        && base
            .fields
            .iter()
            .zip(&layout.fields)
            .all(|(theirs, mine)| theirs.name == mine.name && theirs.ty == mine.ty);
    let dispatches = |l: &Layout| {
        l.methods.iter().enumerate().any(|(slot, method)| {
            method.is_some()
                && u32::try_from(slot)
                    .ok()
                    .is_none_or(|slot| !program.interface_access.contains_selector(slot))
        })
    };
    (prefix && !dispatches(base) && !dispatches(layout) && !std::ptr::eq(base, layout))
        .then_some(at)
}

/// Every layout from `layout` up to the root, `layout` first.
#[must_use]
pub fn ancestry<'a>(program: &'a JvmProgram<'a>, layout: &'a Layout) -> Vec<&'a Layout> {
    let mut chain = vec![layout];
    let mut current = layout;
    // Bounded by the layout count, because a cycle in `base` would otherwise
    // hang the compiler rather than refuse. `verify` rejects one upstream; this
    // is the cheap belt for a fact this module cannot check for itself.
    for _ in 0..program.layouts.len() {
        let Some(at) = jvm_base(program, current) else {
            break;
        };
        let Some(next) = program.layouts.get(at) else {
            break;
        };
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
pub fn inherited(program: &JvmProgram<'_>, layout: &Layout) -> usize {
    jvm_base(program, layout)
        .and_then(|at| program.layouts.get(at))
        .map_or(0, |base| base.fields.len())
}

/// The JVM name of the field at `at` in `owner`, the layout that declares it.
///
/// Names come from the producer-owned property key and the catalogue's payload
/// role. Inherited accesses keep their declaring owner's name. Synthetic frame
/// keys occupy a separate private domain, so an authored parameter called
/// `state` cannot collide with the frame's state slot. Missing source identity
/// remains unavailable and is refused before any class is published.
#[must_use]
pub fn field_name(program: &JvmProgram<'_>, owner: &Layout, at: usize) -> Option<String> {
    #[cfg(test)]
    field_cost::note(|c| c.name_requests += 1);
    program.field_name(owner, at).map(str::to_owned)
}

/// [`field_name`] for each field a class declares itself, in order.
pub fn declared_names(program: &JvmProgram<'_>, layout: &Layout) -> Result<Vec<String>, String> {
    let from = inherited(program, layout).min(layout.fields.len());
    program
        .field_names(layout)
        .and_then(|names| names.get(from..))
        .ok_or_else(|| format!("layout {} has no field identity row", layout.name))?
        .iter()
        .cloned()
        .collect()
}

/// The fields a class declares itself.
#[must_use]
pub fn declared<'a>(program: &JvmProgram<'_>, layout: &'a Layout) -> &'a [Field] {
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
pub fn declares_field<'a>(
    program: &'a JvmProgram<'a>,
    layout: &'a Layout,
    field: usize,
) -> &'a Layout {
    #[cfg(test)]
    field_cost::note(|c| c.owner_requests += 1);
    resolved_field(program, layout, field).map_or(layout, |resolved| resolved.owner)
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
/// and twelve classes across the twenty-two `runtime/node` modules. One class
/// gets an identity too where a literal typed by it is laid out as it -- the
/// core decides both cases, `Program::distinct_identities`.
///
/// **Every class of a layout emitted as a JVM interface** ([`is_interface`]),
/// even a lone one, and its identity implements the interface rather than
/// extending it. Every implementer is an instance of the interface, so the
/// layout's own spelling answers `instanceof` for the class and for all of
/// them: `net`'s field-less `BoundSocket` is laid out as `EventTargetLike`,
/// and `instanceof BoundSocket` was true of a `{}` literal and of anything
/// implementing `EventTargetLike`.
#[must_use]
pub fn identities<'a>(
    program: &'a JvmProgram<'a>,
    layout: &Layout,
) -> Vec<&'a nts_core::hir::ClassIdentity> {
    if is_interface(program, layout) {
        return program.classes_laid_out_as(layout);
    }
    program.distinct_identities(layout)
}

/// The class a type id names, when its layout is shared by more than one.
#[must_use]
pub fn identity_of<'a>(
    program: &'a JvmProgram<'_>,
    id: TypeId,
) -> Option<&'a nts_core::hir::ClassIdentity> {
    let layout = program.layout(id)?;
    identities(program, layout)
        .into_iter()
        .find(|class| class.types.contains(&id))
}

/// Whether anything extends this layout, which is the whole of what decides
/// `ACC_FINAL`.
#[must_use]
pub fn extended(program: &JvmProgram<'_>, layout: &Layout) -> bool {
    // A layout whose classes have their own subclasses is extended by them, so
    // it cannot be `final`. Asked first because it is the cheaper question.
    !identities(program, layout).is_empty() || extended_by_a_base(program, layout)
}

/// Whether another layout's JVM superclass is this one. A layout not in the
/// program answers yes, as `extended` always has: final is the claim to prove.
pub(crate) fn extended_by_a_base(program: &JvmProgram<'_>, layout: &Layout) -> bool {
    let Some(mine) = program.layouts.iter().position(|c| std::ptr::eq(c, layout)) else {
        return true;
    };
    program
        .layouts
        .iter()
        .any(|other| jvm_base(program, other) == Some(mine))
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

/// A member slot's published raising identity, or its existing declared name.
/// The map is owned `Hierarchy` authority, not a test of the selected body.
pub fn slot_member(
    program: &JvmProgram<'_>,
    slot: usize,
    declared: &str,
) -> Result<String, String> {
    resolve_member(program, slot, true, || Some(member_name(declared)))?
        .ok_or_else(|| "a call has no declared member".to_owned())
}

/// The only dispatch-name resolver, shared by calls and both declaration views.
/// Read the catalogue role before resolving the owned declaration. In particular,
/// a family's declaration exists even when its face was never allocated and has
/// no concrete method-table row. An unrelated absent slot still has no member.
fn resolve_member(
    program: &JvmProgram<'_>,
    slot: usize,
    guarded: bool,
    declaration: impl FnOnce() -> Option<String>,
) -> Result<Option<String>, String> {
    let catalogue = if let Some(member) = uniform_member(program, slot) {
        Some(member)
    } else if let Some(member) = program.protocol_member(slot)? {
        Some(member)
    } else if guarded {
        program.guarded_spelling(slot)?.map(str::to_owned)
    } else {
        None
    };
    Ok(declaration().map(|authored| catalogue.unwrap_or(authored)))
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
///
/// **And an interface declares a slot too**, which the superclass walk cannot
/// see: `Quiet implements Sink` fills `Sink`'s raising slot for `take` with its
/// ordinary `Quiet#take`, because it cannot raise, and the walk named the
/// forwarder `take` -- a duplicate of the ordinary one, dropped, so `Quiet`
/// had no `take$raises` and `invokeinterface Sink.take$raises` was an
/// `AbstractMethodError` the verifier waves through (2026-10-02, the first
/// interface root a raising copy dispatched at). So an interface this layout
/// implements that declares the slot names it, ahead of any class.
///
/// **A field family's slot is named by its declared accessor**, ahead of all
/// of that: every row, the face's own included, fills it under a name of its
/// owner's, and the call names the family's (`JvmProgram::selector`).
pub fn declared_member(
    program: &JvmProgram<'_>,
    layout: &Layout,
    slot: usize,
) -> Result<Option<String>, String> {
    resolve_member(program, slot, true, || {
        authored_declared_member(program, layout, slot)
    })
}

/// The unchanged public spelling, also used by a default internal selector.
pub(crate) fn original_declared_member(
    program: &JvmProgram<'_>,
    layout: &Layout,
    slot: usize,
) -> Result<Option<String>, String> {
    resolve_member(program, slot, false, || {
        authored_declared_member(program, layout, slot)
    })
}

fn authored_declared_member(
    program: &JvmProgram<'_>,
    layout: &Layout,
    slot: usize,
) -> Option<String> {
    if let Some(declared) = program.declared_selector(layout, slot) {
        return Some(member_name(declared));
    }
    let mut at = layout;
    let mut name = at.methods.get(slot)?.as_ref()?;
    if let Some(declared) =
        declaring_interface(program, layout, slot).and_then(|i| i.methods.get(slot)?.as_ref())
    {
        return Some(member_name(declared));
    }
    // Up the chain while a base also declares this slot: the first declaration
    // is the one the JVM resolved against.
    while let Some(base) = jvm_base(program, at).and_then(|id| program.layouts.get(id)) {
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

/// The base-most layout above this one, which is where a field shared by a
/// whole hierarchy belongs.
#[must_use]
pub fn root<'a>(program: &'a JvmProgram<'a>, layout: &'a Layout) -> &'a Layout {
    let mut at = layout;
    while let Some(base) = jvm_base(program, at).and_then(|id| program.layouts.get(id)) {
        at = base;
    }
    at
}

/// Whether this layout carries the optional-property presence word.
///
/// **Only a hierarchy's root does, and every class under it inherits it.** A
/// presence call names a receiver by whatever type the expression had, which may
/// be a base; putting the word at the root means one field answers for every
/// receiver type in the chain, and base-first layout means the bit indices agree
/// all the way down -- which is the assumption the compiler lane derives the
/// index from and which `declared`'s `fields[inherited..]` slice already rests
/// on.
///
/// Scanned from the operations rather than flagged on the layout, for the reason
/// `resumes` gives: which layouts are asked about is a fact about the program's
/// *calls*, and `object_class` sees one layout at a time. Pay-for-what-you-use
/// falls out -- a program that never tests an optional property carries no extra
/// field anywhere.
#[must_use]
pub fn holds_presence(package: &str, program: &JvmProgram<'_>, layout: &Layout) -> bool {
    if jvm_base(program, layout).is_some() {
        return false;
    }
    let wanted = crate::types::class_name(package, layout);
    for func in &program.funcs {
        for op in &func.values {
            let nts_core::hir::OpKind::Call { callee, args, .. } = &op.kind else {
                continue;
            };
            let nts_core::hir::Callee::External(name) = callee else {
                continue;
            };
            if !name.starts_with("nts_presence_") {
                continue;
            }
            let Some(&receiver) = args.first() else {
                continue;
            };
            let nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id)) =
                func.values[receiver.0 as usize].ty
            else {
                continue;
            };
            if program
                .layout(id)
                .map(|held| crate::types::class_name(package, root(program, held)))
                == Some(wanted.clone())
            {
                return true;
            }
        }
    }
    false
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
///
/// A face of fields that holders do not extend stays a class, which holds its
/// fields; it is *referred to* as a companion interface instead
/// ([`crate::faces`]), which every holder implements.
#[must_use]
pub fn is_interface(program: &JvmProgram<'_>, layout: &Layout) -> bool {
    let named = program
        .layouts
        .iter()
        .any(|other| other.interfaces.iter().any(|id| layout.types.contains(id)));
    if !named {
        return false;
    }
    // **Named is not sufficient, and `tests/programs/declared-wider` is why.**
    // `interface Tagged extends Error` puts `Error` in `Tagged.interfaces`,
    // and `Error` is a class with a `message` field. A JVM interface has no
    // instance fields and no subclasses that reach it through `super_class`,
    // so treating it as one refused the example by name -- correctly, but for
    // a relation that is a class relation wearing an interface's spelling.
    //
    // A dispatch root that carries state, or that something extends, is that
    // class. `Layout.base` already relates the two, and the assignability
    // check reports it when it does not.
    //
    // **Extended by a base, not by an identity.** The classes laid out as an
    // interface implement it (`identities`), so they are no reason to make it
    // a class. Asking `extended` here did: one literal beside `BoundSocket`
    // in `EventTargetLike`'s layout gave it an identity, which made it a class
    // that `dgram` and `net` returned other objects at -- "Bad return type".
    declared(program, layout).is_empty() && !extended_by_a_base(program, layout)
}

/// A layout something claims to implement and does not extend.
///
/// **The shape a `checkcast` to it cannot survive.** `interface C { seen:
/// number; m(): void }` with `class A implements C` is ordinary TypeScript, and
/// it has no JVM spelling: `C` carries state so it cannot be an interface
/// (`is_interface` says so and why), and `implements` is not `extends` so
/// `Layout.base` relates nothing. `A` therefore extends `Object`, and a value
/// erased from `A` and unerased to `C` is a `checkcast nts/gen/C` that throws.
///
/// Distinguished from the case that *is* fine: `interface Tagged extends Error`
/// records `Error` in `Tagged.interfaces` and `Error` is a class, but there
/// `Layout.base` does relate them -- so `ancestry` finds it and this is false.
/// The question is not "is it named as an interface" but "is it named by
/// something that does not reach it through `base`".
#[must_use]
pub fn claimed_without_extending(program: &JvmProgram<'_>, layout: &Layout) -> bool {
    if is_interface(program, layout) || program.is_split(layout) {
        return false;
    }
    program.layouts.iter().any(|other| {
        other.interfaces.iter().any(|id| layout.types.contains(id))
            && !ancestry(program, other)
                .iter()
                .any(|at| std::ptr::eq(*at, layout))
    })
}

/// A face of fields that a class holds by shape and does not extend.
///
/// **The same cast as [`claimed_without_extending`], reached without an
/// edge.** `Layout.interfaces` is written only for faces that declare methods,
/// so a face of fields alone -- `interface Circle { kind: number; radius:
/// number }` -- is named by nothing, and a class that fits it by shape arrives
/// unannounced: an erased `Both` narrowed to `Circle` by `"radius" in s`
/// compiled to `checkcast nts/gen/Circle` and threw `ClassCastException`
/// (`tests/programs/an-interface-arm-read-after-in-on-a-class-of-another-layout`,
/// which a split face answers now).
/// The accessor families record who holds such a face -- the owners whose rows
/// native dispatch fills -- and this backend preserves the field access, so an
/// owner that does not extend the face is a value the cast cannot take.
///
/// **A family lists who could, not who arrives**, so this is not a refusal.
/// `tests/programs/in-operator` narrows `Reader | Writer | Duplex` with `"duplex" in
/// s` before it reads `s.read`: `Duplex` fits `Reader` and owns a row in its
/// family, and no `Duplex` ever reaches that read. Refusing every unerase to
/// `Reader` declined a function that agreed on all 377 cases, so the caller
/// tests the value at run time instead and refuses only the one that arrives.
#[must_use]
pub fn held_without_extending(program: &JvmProgram<'_>, layout: &Layout) -> bool {
    if is_interface(program, layout) || program.is_split(layout) {
        return false;
    }
    program
        .interface_access
        .families
        .iter()
        .filter(|family| layout.types.contains(&family.face))
        .flat_map(|family| &family.owners)
        .filter_map(|owner| program.layout(*owner))
        .any(|owner| {
            !ancestry(program, owner)
                .iter()
                .any(|at| std::ptr::eq(*at, layout))
        })
}

/// The face an unerase to `ty` tests its value against before the cast, if
/// any: an object type [`held_without_extending`].
///
/// **One answer for the two places that ask.** `ops::test_held_cast` writes
/// the test, and `body::puts_label` has to know the test puts a label inside
/// its block, or a slot the cast reloads after that label is `Top` at its
/// frame -- "Type top (current frame, locals[1])" at `undestroy`'s second
/// load of `_readableState`, in eight modules.
#[must_use]
pub fn held_cast<'p>(program: &'p JvmProgram<'p>, ty: &HirType) -> Option<&'p Layout> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return None;
    };
    program
        .layout(*id)
        .filter(|layout| held_without_extending(program, layout))
}

/// The interfaces this layout declares, as binary class names.
///
/// In `Layout.interfaces` order, which the IR sorts, so one input gives one
/// byte sequence -- the class file's `interfaces[]` is written in this order and
/// the jar-drift test compares bytes.
///
/// Then the companion interfaces of the split faces it holds
/// ([`crate::split_faces::implemented`]), declared or by shape, in layout order.
#[must_use]
pub fn implemented(package: &str, program: &JvmProgram<'_>, layout: &Layout) -> Vec<String> {
    let mut names: Vec<String> = layout
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
        .map(|at| crate::types::class_name(package, at))
        .collect();
    for face in crate::split_faces::implemented(program, layout) {
        let name = crate::split_faces::interface_name(package, face);
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// The JVM name of a **uniform** slot -- the erased entry and its raising
/// variant -- which the callable root declares and every callable fills, so it
/// is a fact about the program and not about any one layout's chain.
///
/// Derived from one place rather than from whatever fills the slot. Lowering
/// fills a callable's raising slot with its *ordinary* erased entry wherever no
/// raising body exists (`declare_raising_entries`), so the function there is
/// `Closure2#erased_call`; with a signature base the walk above found the
/// base's declaration and named it `erased_call$raises`, but a base-less
/// closure -- a module-scope IIFE, called directly, which nothing relates to a
/// signature -- fell through to the function's own name, `erased_call`,
/// collapsed into the ordinary method, and left the root's abstract
/// `erased_call$raises` unimplemented: UNFILLED in `buffer` and `string_decoder`
/// on 1cf6a7ebe, the day `.then` let their module initializers compile.
///
/// The raising slot is named only in a program where some callable has a
/// raising body there; see the comment at that branch.
#[must_use]
pub fn uniform_member(program: &JvmProgram<'_>, slot: usize) -> Option<String> {
    let erased = program.erased_call_slot? as usize;
    let raising_slot = program.raising_call_slot.map(|slot| slot as usize);
    // The ordinary entry's member, from a layout that fills it -- or, where every
    // callable fills only the raising one, from that body's name less its
    // suffix: the two are one member and its raising variant.
    let ordinary = || {
        let filled = |slot: usize| {
            program
                .layouts
                .iter()
                .find_map(|layout| layout.methods.get(slot)?.as_ref())
        };
        filled(erased)
            .or_else(|| filled(raising_slot?))
            .map(|_| crate::generated_members::ERASED_CALL.to_owned())
    };
    if slot == erased {
        return ordinary();
    }
    if program
        .raising_call_slot
        .is_some_and(|raising| raising as usize == slot)
    {
        // Only where some callable fills it with a raising body. A program
        // whose every raising entry is the ordinary one makes no raising call,
        // and naming the slot anyway published `erased_call$raises` on every
        // closure and on the root -- a Java-visible API change in
        // interop/ts-from-java for an entry nothing can reach (c58629073). The
        // slot then collapses into the ordinary method, as before.
        let raises = program.layouts.iter().any(|layout| {
            layout
                .methods
                .get(slot)
                .and_then(Option::as_ref)
                .is_some_and(|name| name.ends_with("@raises"))
        });
        return if raises {
            ordinary().map(|_| crate::generated_members::RAISING_CALL.to_owned())
        } else {
            ordinary()
        };
    }
    None
}

/// The interface, emitted as one, that `layout` or anything it extends
/// implements and that declares `slot` -- the base a forwarder at that slot
/// overrides when no superclass declares it.
#[must_use]
pub fn declaring_interface<'a>(
    program: &'a JvmProgram<'a>,
    layout: &Layout,
    slot: usize,
) -> Option<&'a Layout> {
    program.layouts.iter().find(|interface| {
        !std::ptr::eq(*interface, layout)
            && interface.methods.get(slot).is_some_and(Option::is_some)
            && interface
                .types
                .iter()
                .any(|id| implements(program, layout, *id))
    })
}

/// Does `layout`, or anything it extends, declare `id` as an interface?
///
/// The class half has to be walked here even though `Layout.interfaces` is
/// closed over interface *extension*: `class B extends A` where `A implements
/// Sink` leaves `B.interfaces` empty, and `B` is still assignable to `Sink`
/// because the JVM resolves a superclass's interfaces too.
#[must_use]
pub fn implements(program: &JvmProgram<'_>, layout: &Layout, id: TypeId) -> bool {
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
    //
    // **A split face is implemented by every holder, edge or not**
    // ([`crate::faces`]): a class fitting `interface Point { x: number }` by
    // shape implements `Point` on this lane, and nothing in `interfaces` says
    // so. The receivers test is the cheap half, so a layout no face reaches is
    // never asked whether one splits.
    let Some(target) = program.layout(id) else {
        return false;
    };
    let chain = ancestry(program, layout);
    if chain.iter().any(|at| at.interfaces.contains(&id)) {
        return is_interface(program, target) || crate::split_faces::split(program, target);
    }
    !target.fields.is_empty()
        && chain
            .iter()
            .any(|at| crate::split_faces::receives(program, target, at))
        && crate::split_faces::split(program, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_core::hir::Program;

    #[test]
    fn owned_raising_slot_names_do_not_depend_on_the_implementation() {
        let mut program = Program::default();
        program.raising_members.insert(
            5,
            nts_core::hir::RaisingMember {
                member: "step".to_owned(),
                ordinary_slot: Some(0),
            },
        );
        crate::member_identity::synthetic_rows(&mut program, &[(5, 0, "step", true)]);
        let facts = JvmProgram::new(&program);
        for body in ["Base#step", "Child#step@raises", "another_body"] {
            assert_eq!(
                slot_member(&facts, 5, body).expect("fixture member identity"),
                facts.dispatch_name(5).expect("fixture member identity")
            );
        }
        assert_eq!(
            slot_member(&facts, 0, "Base#step").expect("fixture member identity"),
            "step"
        );
        assert_eq!(
            slot_member(&facts, 6, "Base#step").expect("fixture member identity"),
            "step"
        );
    }

    #[test]
    fn a_field_familys_selector_keeps_its_face_and_raising_identity() {
        use nts_core::hir::interface_access::{Entry, Family};

        let mut program = Program::default();
        program.raising_members.insert(
            6,
            nts_core::hir::RaisingMember {
                member: "get_x".to_owned(),
                ordinary_slot: Some(4),
            },
        );
        program.interface_access.families.push(Family {
            face: nts_semantic_schema::TypeId(7),
            member: nts_semantic_schema::PropertyKey::Name("x".into()),
            field: Some(0),
            getter: Entry {
                slot: 4,
                declared: "Face#get_x@interface7".to_owned(),
            },
            setter: None,
            raising: vec![Entry {
                slot: 6,
                declared: "Face#get_x@interface7@raises".to_owned(),
            }],
            owners: Vec::new(),
            eager: false,
            pending: false,
            stored_dispatch: true,
        });
        let face = Layout {
            types: vec![TypeId(7)],
            name: "Face".to_owned(),
            fields: Vec::new(),
            methods: vec![None; 7],
            interfaces: Vec::new(),
            base: None,
        };
        let mut allocated = face.clone();
        allocated.name = "AllocatedFace".to_owned();
        allocated.methods[4] = Some("actual_getter_row".to_owned());
        allocated.methods[6] = Some("actual_raising_row".to_owned());
        program.layouts = vec![face, allocated];
        crate::member_identity::synthetic_rows(
            &mut program,
            &[(4, 7, "x", false), (6, 7, "x", true)],
        );
        let facts = JvmProgram::new(&program);
        for slot in [4, 6] {
            let expected = facts.dispatch_name(slot).expect("fixture member identity");
            assert_eq!(
                declared_member(&facts, &program.layouts[1], slot)
                    .expect("fixture member identity"),
                Some(expected.clone()),
                "allocated-face declaration control"
            );
            assert_eq!(
                declared_member(&facts, &program.layouts[0], slot)
                    .expect("fixture member identity"),
                Some(expected),
                "a declared family exists without a concrete face row"
            );
        }
        assert_eq!(
            declared_member(&facts, &program.layouts[0], 3).expect("fixture member identity"),
            None
        );
        assert_eq!(
            slot_member(&facts, 4, "any_body").expect("fixture member identity"),
            facts.dispatch_name(4).expect("fixture member identity")
        );
        assert_eq!(
            slot_member(&facts, 6, "any_body").expect("fixture member identity"),
            facts.dispatch_name(6).expect("fixture member identity")
        );
    }

    #[test]
    fn a_flattened_record_field_belongs_to_its_emitted_class() {
        let field = |name: &str, owner| Field {
            name: name.to_owned().into(),
            ty: HirType::Float { bits: 64 },
            written: None,
            declared_by: Some(TypeId(owner)),
            readonly: true,
        };
        let metadata = Layout {
            types: vec![TypeId(1)],
            name: "Metadata".to_owned(),
            fields: vec![field("status", 1)],
            methods: Vec::new(),
            interfaces: Vec::new(),
            base: None,
        };
        let entry = Layout {
            types: vec![TypeId(2)],
            name: "Entry".to_owned(),
            fields: vec![field("status", 1), field("body", 2)],
            methods: vec![Some("status_helper".to_owned())],
            interfaces: Vec::new(),
            base: None,
        };
        let mut program = Program {
            layouts: vec![metadata, entry],
            ..Program::default()
        };
        program.record_parents.insert(TypeId(2), TypeId(1));
        assert!(jvm_base(&JvmProgram::new(&program), &program.layouts[1]).is_none());
        assert_eq!(
            declares_field(&JvmProgram::new(&program), &program.layouts[1], 0).name,
            "Entry"
        );
        // With a real emitted superclass, the same field is inherited.
        program.layouts[1].base = Some(TypeId(1));
        assert_eq!(
            declares_field(&JvmProgram::new(&program), &program.layouts[1], 0).name,
            "Metadata"
        );
        program.layouts[1].fields.push(field("status", 2));
        assert_eq!(
            declares_field(&JvmProgram::new(&program), &program.layouts[1], 2).name,
            "Entry"
        );
    }
}
