//! Name, collect, and canonicalize object layouts.

use super::{
    Callee, Diagnostic, FuncBuilder, Hierarchy, HirType, Layout, ManagedType, MemberKey, NodeData,
    NodeId, NodeKind, OpKind, Program, SemanticSnapshot, TypeId, TypeKind, TypeRecord,
    class_symbol, declared_record_parent, describe, implemented_member, instantiation_suffix,
    is_a_generic_declaration, module_of_namespace, named, named_class_source,
    provided_error_identities, signature_key, signature_layout, syntax,
};
#[cfg(test)]
use super::{LayoutCollector, collection_tests};

/// Anonymous object types that declare methods, so a call through one resolves.
///
/// `{ v: 1, twice() { return this.v * 2 } }` is an object with a method, and
/// the method is reached the way a class's is: `declaring` walks
/// `hierarchy.declares`, which `collect_classes` and `collect_interfaces` fill
/// from *declarations*. An object literal has none -- its type is made by the
/// checker -- so nothing was ever in it and the call refused with `a method
/// `twice` with no declaration in the hierarchy`.
///
/// **Over types rather than over literal nodes**, and that is the whole reason
/// it works. `const o = { v, twice() {} }` gives the literal expression one
/// anonymous type and widens `o` to another; a walk over nodes registers the
/// first and the call site asks about the second. Every anonymous object type
/// carrying a method is registered here, so which one a given site holds stops
/// mattering.
///
/// **Anonymous only**, and `or_insert` besides. A named type went through the
/// passes above, and answering for it from two sources is how the two come to
/// disagree -- a class whose method is missing from `declares` is a bug in that
/// pass rather than something to paper over here.
///
/// The keys are exactly the ones `accessor_callee` and `callee_for` build, and
/// the record says which apply: `MemberKind::Method` is the bare name and
/// `Accessor` carries whether it declares a getter, a setter or both.
/// Whether a symbol name is the checker's placeholder for an anonymous shape.
///
/// **A name that is not one.** TypeScript gives every object type a symbol and
/// calls the ones with no declaration `__object` or `__type`, so *every*
/// anonymous shape in a program carries the same name -- and `__class` for an
/// anonymous *class*, which is the same problem wearing a third word.
/// `decompose.rs` already
/// refuses to publish those as nominal identities, for the reason it states --
/// "unrelated anonymous shapes appear named alike" -- and one leaks through for
/// a literal that declares a member.
///
/// It leaked harmlessly while nothing was named after such a layout. It stopped
/// being harmless the moment an object literal's methods were emitted as
/// `{layout}#{member}`: two literals in one file each declaring `twice` both
/// produced `__object#twice`, and lowering refused the program with
/// `DuplicateFunction`. The `Type{id}` fallback beside this is what every other
/// anonymous shape already gets, and it is unique by construction.
/// Whether a syntax kind declares a class.
///
/// **Two kinds do.** A class expression is a class in every way a walk over the
/// program cares about -- fields, methods, statics, a base, interfaces -- and
/// differs in exactly one: it binds no name of its own. Every walk that read
/// `CLASS_DECLARATION` and stopped there lowered a class expression's *fields*
/// and none of its members, so `const C = class { v = 7 }` compiled and agreed
/// with node while adding a method to it refused with ``a method `m` with no
/// declaration in the hierarchy``. That message names the symptom; the cause is
/// that no walk ever visited the class.
///
/// The one thing the missing name costs is the name a member is emitted under.
/// [`is_anonymous_shape`] answers it, because the checker calls an anonymous
/// class's symbol `__class` and *every* anonymous class in the program shares
/// that -- the same collision two `__object` literals produced, one construct
/// over.
/// What a type is called: its symbol's name, or the unique stand-in an anonymous
/// shape gets.
///
/// **One derivation, because three things are named from it and they have to
/// agree letter for letter.** A layout takes this name, a member is emitted as
/// `{name}#{member}`, and a call site names its callee the same way. A second
/// answer here is not a second opinion -- it is a call to a function nothing
/// defines, and the linker reports it a compilation stage away from the choice
/// that caused it.
pub(super) fn nominal_or_stand_in(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    named(snapshot, ty)
        .filter(|_| !is_anonymous_shape(snapshot, ty))
        .map_or_else(|| format!("Type{}", ty.0), ToOwned::to_owned)
}

/// The type a `new` of this class produces.
///
/// **A class declaration and a class expression disagree about what their node's
/// type is, and both are right.** The frontend maps a declaration to the type it
/// declares -- the instance -- because a declaration is not an expression and has
/// no other type to have. It maps a class *expression* to the type of the
/// expression, which is the constructor: `#2 `__class` Function(() -> #7)`.
///
/// Every walk below wants `#7`. That is the type a layout is built for, the type
/// a `new` expression has, and the type a method's `this` is, so a walk that
/// takes the node's type directly keys the hierarchy on the constructor and then
/// names a method `Type2#m` while its only call site asks for `Type7#m` -- one C
/// function defined nowhere and called once, reported by the linker a stage away
/// from the choice that caused it.
///
/// Reading the construct signature's result answers both without asking which
/// kind of node this is.
pub(super) fn instance_type_of(snapshot: &SemanticSnapshot, class: NodeId) -> Option<TypeId> {
    let ty = snapshot.node_types.get(&class).copied()?;
    let TypeKind::Function(signature) = snapshot.types.get(ty.0 as usize)?.kind else {
        return Some(ty);
    };
    Some(snapshot.signatures.get(signature.0 as usize)?.return_type)
}

pub(super) fn declares_a_class(kind: u16) -> bool {
    matches!(kind, syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION)
}

/// Whether the declaration has no program-written nominal name. A class
/// expression assigned to Foo is still anonymous; Foo names the binding, not
/// the class. The shared child layout records the class's own name slot.
pub(super) fn is_anonymous_shape(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let Some(symbol) = snapshot
        .types
        .get(ty.0 as usize)
        .and_then(|record| record.symbol)
        .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
    else {
        return false;
    };
    !symbol.declarations.is_empty() && symbol.declarations.iter().all(|id| {
        let Some(node) = snapshot.nodes.get(id.0 as usize) else { return false; };
        match node.kind {
            NodeKind::Syntax(syntax::OBJECT_LITERAL_EXPRESSION | syntax::TYPE_LITERAL) => true,
            NodeKind::Syntax(syntax::CLASS_EXPRESSION) => {
                let Some(slot) = nts_semantic_schema::children::properties(syntax::CLASS_EXPRESSION)
                    .iter().position(|name| *name == "name") else { return false; };
                matches!(node.data, NodeData::Children { present, .. } if present & (1 << slot) == 0)
            }
            _ => false,
        }
    })
}

/// Why `new SharedArrayBuffer` refuses while the *type* lowers.
///
/// `representation_within` answers `ManagedType::Buffer` for a
/// `SharedArrayBuffer`, which is what lets the
/// `ArrayBufferView | ArrayBuffer | SharedArrayBuffer` unions the corpus writes
/// lower at all --- 81 refusal sites in `runtime/node`.
///
/// `lower_new_provided` then dispatches on that representation and cannot tell
/// the two apart, so `new SharedArrayBuffer(8)` built a value carrying
/// `ArrayBuffer`'s descriptor and `s instanceof ArrayBuffer` answered **true**
/// where node answers false. Measured rather than reasoned about: the probe
/// came back `DISAGREE node=0 nts=1`. That is a wrong answer where this was a
/// missing one, which is the more expensive of the two.
///
/// Refused at the *name*, because one line further on the program is a
/// `Buffer` and the question can no longer be asked. It costs two sites in the
/// corpus, both of which refused before this change as well since the type had
/// no representation at all. What it buys is that with no way to construct
/// one, every value a compiled program holds at that representation really is
/// an `ArrayBuffer`, so `instanceof` stays right for the values that exist.
///
/// Lifting it means a descriptor of its own --- the way `Map` and `Set` share
/// one struct and are told apart by a bit --- after which `new` and
/// `instanceof` both work rather than both refusing.
/// What a name with no definition here is: a builtin no provider supplies,
/// refused as NTS1100 (`FuncBuilder::unprovided`), or a construct this lowering
/// cannot represent, refused as NTS1001.
pub(super) enum Nameless {
    Unprovided {
        what: String,
        why: Option<&'static str>,
        /// The feature the name is (`es:JSON`), where its library says
        /// (`SymbolRecord::library`).
        feature: Option<String>,
    },
    /// A builtin no target will ever have: `eval` evaluates source text, and a
    /// program compiled ahead of time carries no evaluator. NTS1101.
    Never(String),
    Unsupported(String),
}

impl Nameless {
    pub(super) const fn unprovided(what: String) -> Self {
        Self::Unprovided {
            what,
            why: None,
            feature: None,
        }
    }

    /// The same answer, naming the feature it is.
    pub(super) fn of_feature(self, named: Option<String>) -> Self {
        match self {
            Self::Unprovided { what, why, .. } => Self::Unprovided {
                what,
                why,
                feature: named,
            },
            other => other,
        }
    }
}

/// The feature a library's global is: its library and its name, `es:JSON`,
/// `dom:document`. Only where the name *is* the feature -- a global of
/// TypeScript's own libraries. A package's or `@types/node`'s symbol may be a
/// module's export, whose feature is the module (`node:assert`), which the
/// symbol alone does not say.
pub(super) fn feature_of(record: &nts_semantic_schema::SymbolRecord) -> Option<String> {
    let prefix = match record.library.as_ref()? {
        nts_semantic_schema::Library::Es => "es",
        nts_semantic_schema::Library::Dom => "dom",
        nts_semantic_schema::Library::Node | nts_semantic_schema::Library::Package(_) => {
            return None;
        }
    };
    Some(format!("{prefix}:{}", record.name))
}

pub(super) const SHARED_BUFFER_REFUSAL: &str = "`new SharedArrayBuffer`, which would carry `ArrayBuffer`'s descriptor and answer \
     `instanceof ArrayBuffer` with `true`";

pub(super) fn collect_anonymous_objects(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &mut Hierarchy,
) {
    for (index, record) in snapshot.types.iter().enumerate() {
        let TypeKind::Object { properties } = &record.kind else {
            continue;
        };
        let ty = TypeId(u32::try_from(index).unwrap_or(u32::MAX));
        // `is_anonymous_shape` and not `named(..).is_none()`: the checker
        // names an object type with a member `__object`, so the simpler test is
        // true of `{}` and false of `{ v, twice() {} }` -- which is how the
        // first version of this walked past every type it was written for.
        if named(snapshot, ty).is_some() && !is_anonymous_shape(snapshot, ty) {
            continue;
        }
        let mut declared = Vec::new();
        for property in properties {
            // **Only a member with a body.** An anonymous object type is made
            // by the checker for two different things: an object *literal*,
            // whose members are lowered as functions, and a *type literal* --
            // `(e: { emit(s: string): boolean })` -- whose members are a shape
            // and nothing else. Registering the second makes `declaring`
            // resolve a call to a function nobody wrote, turning a refusal that
            // named the receiver's shape into a cascade naming `Type11#emit`.
            //
            // The property record tells them apart by where it was declared: a
            // literal's member is a `METHOD_DECLARATION` or an accessor, a type
            // literal's is a `METHOD_SIGNATURE`. And the widened type a
            // `const` takes carries the *same* declaration node as the literal
            // it came from, which is what lets both be registered from one
            // rule.
            if !property
                .declaration
                .is_some_and(|node| implemented_member(probe, node))
            {
                continue;
            }
            // The same three keys `accessor_callee` and `callee_for` build, and
            // the record says exactly which apply: a method is its bare name,
            // an accessor is `get `/`set ` and carries which of the two it
            // declares. `GetSet` declares both.
            match property.kind {
                nts_semantic_schema::MemberKind::Method => {
                    declared.push(MemberKey::method(property.name.clone()));
                }
                nts_semantic_schema::MemberKind::Accessor(accessor) => {
                    if matches!(
                        accessor,
                        nts_semantic_schema::Accessor::Get | nts_semantic_schema::Accessor::GetSet
                    ) {
                        declared.push(MemberKey::get(property.name.clone()));
                    }
                    if matches!(
                        accessor,
                        nts_semantic_schema::Accessor::Set | nts_semantic_schema::Accessor::GetSet
                    ) {
                        declared.push(MemberKey::set(property.name.clone()));
                    }
                }
                nts_semantic_schema::MemberKind::Field => {}
            }
        }
        if !declared.is_empty() {
            // **Named, so that two literals of one shape stay two functions.**
            // A layout is a *representation* and identical shapes deliberately
            // share one, so `{ which() { return 1 } }` and
            // `{ which() { return 2 } }` are one layout -- correct, they are
            // the same storage -- and the name a member is emitted under came
            // from it. One `Type4#which` was defined, both call sites called
            // it, and `b.which()` returned `1`. No diagnostic, on every
            // backend, and the existing coverage missed it because its two
            // literals declare different *fields* and so do not merge.
            //
            // A name for dispatch is not a representation. This one is the
            // type's, which is what the checker gave each literal separately.
            hierarchy
                .name
                .entry(ty)
                .or_insert_with(|| nominal_or_stand_in(snapshot, ty));
            hierarchy.declares.entry(ty).or_insert(declared);
        }
    }
}

/// Read every class declaration's name, base and own methods.
/// What the hierarchy calls a class -- the name an instance method is spelled
/// `Name#member` with, and what a `new` and every call site name as well.
pub(super) fn hierarchy_class_name(
    probe: &FuncBuilder<'_>,
    snapshot: &SemanticSnapshot,
    qualified: &rustc_hash::FxHashMap<NodeId, String>,
    id: NodeId,
    ty: TypeId,
) -> String {
    // An anonymous class expression has no identifier, and its stand-in
    // is what its members were named for.
    //
    // **Without an entry here two of them become one.** A layout is a
    // *representation* and identical shapes deliberately share one --
    // `class Alpha {}` and `class Beta {}` print as `Alpha [1 2]`, see
    // [`stands_for_a_class`] -- so the name a call site falls back to
    // when the hierarchy has none is the merged layout's. For a named
    // class that fallback is never reached; for an anonymous one it
    // named every structurally identical class alike, and
    // `new Second().which()` called `First`'s function and returned
    // `1`. It agreed with node on 264 of 319 cases, which is what a
    // silently wrong answer looks like from the outside.
    //
    // **And the qualified name where the identifier is not unique**, by
    // the same map `class_name_for`'s static arm reads. Two modules each
    // exporting a `Thing` both spelled their methods `Thing#value`, so
    // one C function was defined twice -- except that nothing defined it
    // at all: no vtable was emitted, all three descriptors carried a
    // null `methods`, and `total`'s virtual call went through it.
    // `exit 139`, no refusal, and the React lane found it because
    // libadwaita's generated `HeaderBarNode` shares a name with GTK's.
    //
    // The comment above the walk that builds that map already said this
    // -- "it collides happily with a method of *another class of the
    // same name*, and `dgram` and `net` both export a `Socket`" -- and
    // only the static arm was reading it.
    qualified
        .get(&id)
        .cloned()
        .or_else(|| {
            probe
                .children(id)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| {
                    probe
                        .node(child)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
        })
        .unwrap_or_else(|| nominal_or_stand_in(snapshot, ty))
}

/// Merge a function's discovered layouts into the program's.
///
/// A layout is a property of the type, not of the function that happened to
/// mention it first.
/// Whether a layout's name was invented here rather than declared.
///
/// An anonymous object type is named `Type` followed by its type id. Matching
/// on the prefix alone is not enough and was wrong about exactly the class this
/// mattered for: `TypeError` starts with `Type`, so it read as generated, so it
/// merged with `RangeError` by shape and the two shared one descriptor.
pub(super) fn generated_name(name: &str) -> bool {
    name.strip_prefix("Type")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
}

/// A function type's layout name, from its *signature* rather than its type id.
///
/// Two ids for one written signature must share a layout -- the arrow's
/// inferred type and the declared type of the slot it is stored into are
/// different ids over the same contents -- and two different signatures must
/// not. Neither is a question `same_shape` can answer, because every function
/// type's layout is empty.
///
/// So the name carries the signature: parameter type ids, then `__`, then the
/// return's. The separator matters -- `Fn2_2__2` is `(a, b) => c` and `Fn2__2`
/// is `(a) => b`, and joining with one underscore would make those the same
/// string.
///
/// There is deliberately no marker for `async`. There was one -- an `A` -- and
/// it never appeared in a name, because the flag behind it was the constant
/// `false`. It should not come back: `async function f(): Promise<T>` and
/// `function f(): Promise<T>` are one type to the checker, so an `A` would give
/// a single type two layout names, and for a function type the name *is* the
/// identity. See `SignatureRecord`.
pub(super) fn signature_name(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some((params, returns)) = signature_key(snapshot, ty) else {
        return format!("Fn{}", ty.0);
    };
    let params: Vec<String> = params.iter().map(|param| param.0.to_string()).collect();
    format!("Fn{}__{}", params.join("_"), returns.0)
}

/// Whether a layout name was made by [`signature_name`].
///
/// By prefix and shape rather than by a flag on the layout: `Layout` is what
/// three backends read, and a field that exists to tell two of its own names
/// apart is a field they would all have to ignore.
pub(in crate::hir) fn is_signature_name(name: &str) -> bool {
    name.starts_with("Fn") && name.contains("__")
}

/// Whether this layout's **name** is its identity.
///
/// Three families of layout are deliberately empty, or deliberately identical
/// in shape, and each is nominal: a provided error class, a function type, and
/// a class used as a value. Record 0096 predicted the family and said why --
/// shape cannot answer a nominal question about a shape with nothing in it --
/// and the guard against it was then written three times, once per family, each
/// time requiring the *same* family on both sides.
///
/// Three same-family guards leave the three CROSS-family pairs open, and node's
/// `path` walked into one. `Ctor_Error` is an empty token; `Fn...` is an empty
/// signature; neither guard looked at the other, so `same_shape` merged them.
/// The result was `normalizeString`'s fourth parameter -- `isPathSeparator`, a
/// function -- emitted with the type of the `Error` constructor, and the only
/// vtable in the program naming a `Ctor_Error#call` that no pass ever emits.
/// The C did not compile, which is the good outcome; the same merge in a
/// program without that slot is a wrong type nobody is told about.
///
/// So the rule is stated once and over both sides rather than one side twice: a
/// layout whose name is its identity does not merge with a differently-named
/// layout, whatever family the other one is in.
/// Whether two layouts may be merged on shape alone, by their names.
///
/// **One derivation, because there were two and only one of them checked.**
/// `collapse` asked this and `layout_of` did not, so a layout that reached
/// `layout_of` first joined whatever field-less layout was already there --
/// and a bound Java class is deliberately field-less, because the binding
/// surfaces its members through the table rather than as our field ops.
///
/// `java.util.HashMap`, `java.lang.Integer` and `com.example.Kind` therefore
/// became one layout, and the store of a `HashMap` into a slot the frame
/// declared as `Kind` failed at class load with `Inconsistent stackmap
/// frames`. The verifier caught it; nothing before the verifier did.
pub(super) fn may_merge(one: &str, other: &str) -> bool {
    let named_apart = one != other && (nominal_name(one) || nominal_name(other));
    let tuple_apart =
        crate::hir::is_tuple_layout_name(one) != crate::hir::is_tuple_layout_name(other);
    !named_apart && !tuple_apart
}

pub(super) fn nominal_name(name: &str) -> bool {
    crate::hir::builtin::is_error(name)
        || is_signature_name(name)
        || crate::hir::builtin::is_constructor_name(name)
        || is_foreign_name(name)
}

/// Whether this layout stands for a class we did not lay out.
///
/// A **fourth** member of the family above, and it arrives for the same reason
/// the other three did: a foreign layout is deliberately field-less -- the
/// binding surfaces its members through the binding table rather than as our
/// field ops -- so shape cannot tell two of them apart.
///
/// **By prefix and shape rather than by a flag**, matching
/// [`is_signature_name`]: a foreign layout is named by its JVM binary name,
/// `java/lang/Runnable`, and `/` cannot appear in a TypeScript identifier.
///
/// # Why this one cannot be repaired downstream, where the others can
///
/// Measured on 2026-09-13: `class Alpha {}` and `class Beta {}` **do** merge --
/// `nts layouts` prints one line, `Alpha [1 2]` -- and identical method lists do
/// not separate them either. The JVM emitter then repairs it, by making the
/// merged layout a shared base and giving each original type a subclass:
/// `nts/gen/Alpha`, with `Alpha__Alpha` and `Alpha__Beta` extending it.
///
/// **That repair works precisely because we own the names and can invent
/// `Alpha__Beta`.** A `java.lang.Runnable` cannot be made to extend an
/// `nts/gen/...` base: it already exists, its binary name *is* its identity, and
/// its supertype chain is fixed by the jar. So a foreign layout is the one merge
/// no backend can undo, which is a stronger argument than "a collision is
/// possible" and is why this belongs here rather than in a backend.
pub(super) fn is_foreign_name(name: &str) -> bool {
    crate::hir::runtime::is_foreign_layout_name(name)
}

pub(super) fn collect_class_identities(program: &mut Program, snapshot: &SemanticSnapshot) {
    // **A provided error class is a class.** `TypeError` has no declaring
    // symbol -- the library declares an interface and a variable -- so it had
    // no identity, and a backend that tests identity nominally (Wasm) refused
    // every `instanceof TypeError`, the largest family of its declines. The
    // hierarchy already knows which types are which provided error, the
    // library's and the synthetic alike (`provided_error_identities`); a
    // declared class of the same name is asked about first and stays itself.
    let provided = provided_error_identities(snapshot);
    let mut sources = rustc_hash::FxHashMap::default();
    for layout in &program.layouts {
        let mut here: Vec<crate::hir::ClassIdentity> = Vec::new();
        for ty in &layout.types {
            let identity = match (class_symbol(snapshot, *ty), provided.get(ty)) {
                (Some(symbol), _) => {
                    let source = sources.entry(symbol).or_insert_with(|| {
                        snapshot.symbols.get(symbol as usize)?.declarations.iter().find_map(|id| {
                            let node = snapshot.nodes.get(id.0 as usize)?;
                            matches!(node.kind, NodeKind::Syntax(kind) if declares_a_class(kind))
                                .then(|| named_class_source(snapshot, *id, symbol))
                                .flatten()
                        })
                    });
                    class_identity(snapshot, symbol, *ty, source.clone())
                }
                (None, Some(index)) => crate::hir::ClassIdentity {
                    symbol: crate::hir::provided_error_symbol(*index),
                    name: crate::hir::PROVIDED_ERROR_NAMES[*index].to_owned(),
                    source: None,
                    types: vec![*ty],
                },
                (None, None) => continue,
            };
            match here
                .iter_mut()
                .find(|class| class.symbol == identity.symbol)
            {
                Some(known) => known.types.push(*ty),
                None => here.push(identity),
            }
        }
        program.classes.extend(here);
    }
}

/// The object types allocated in a class's layout that are not the class: what
/// [`super::Program::plain_records`] holds. Read off the allocations once the
/// layouts and the identities are both settled.
pub(super) fn collect_plain_records(program: &mut Program) {
    let classed: rustc_hash::FxHashSet<TypeId> = program
        .classes
        .iter()
        .flat_map(|class| class.types.iter().copied())
        .collect();
    let index = crate::hir::fields::LayoutIndex::build(program);
    let mut plain = std::collections::BTreeSet::new();
    for op in program.funcs.iter().flat_map(|func| &func.values) {
        let (OpKind::ObjectNew { .. }, HirType::Managed(ManagedType::Object(ty))) =
            (&op.kind, &op.ty)
        else {
            continue;
        };
        if classed.contains(ty) {
            continue;
        }
        let shares_a_class = index.of_class(*ty).is_some_and(|at| {
            program.layouts[at]
                .types
                .iter()
                .any(|other| classed.contains(other))
        });
        if shares_a_class {
            plain.insert(*ty);
        }
    }
    program.plain_records = plain;
}

/// One [`crate::hir::ClassIdentity`], named for the declaration rather than for the
/// layout.
///
/// A layout's name is the *first* declared name to reach it, so a merged layout
/// reports one class's name for all of them -- a second, quieter wrongness of
/// the same merge, and this is where it stops.
fn class_identity(
    snapshot: &SemanticSnapshot,
    symbol: u32,
    ty: TypeId,
    source: Option<crate::hir::NamedClassSource>,
) -> crate::hir::ClassIdentity {
    let name = nominal_or_stand_in(snapshot, ty);
    crate::hir::ClassIdentity {
        symbol,
        name,
        source,
        types: vec![ty],
    }
}

#[cfg(test)]
pub(super) fn collect_layouts(program: &mut Program, layouts: Vec<Layout>) {
    let mut collector = LayoutCollector::new(std::mem::take(&mut program.layouts));
    collector.collect(program, layouts);
    program.layouts = collector.into_layouts();
}

/// A layout name no other layout in this program already has.
///
/// A layout is named after its declaring **symbol**, so two classes called
/// `Frame` in modules that never import each other get one spelling and two
/// structs -- a `redefinition of NtsObj_Frame` and a failed size assertion,
/// which stopped twelve of the twenty-two node modules from building.
///
/// They are correctly **not merged**: `same_shape` is false because the fields
/// differ, so the compiler had the hard half right. An inspect walk's frame is
/// `{ isArray, start, items, keys, values }` and a WebSocket's is
/// `{ fin, opcode, payload, compressed }`, and merging them would have been a
/// wrong answer at run time rather than a build failure.
///
/// Suffixed with the type id, which is what the anonymous fallback already uses
/// -- an object type with no symbol is `Type{id}` -- so this is the established
/// spelling for "unique and deterministic" rather than a second one.
///
/// # Why a suffix is safe here
///
/// Four predicates read a layout name and decide something by it, and every one
/// is a prefix or infix test: [`is_signature_name`] wants `Fn` and `__`,
/// [`super::builtin::is_constructor_name`] wants `Ctor_`,
/// [`super::is_tuple_layout_name`] and [`generated_name`] likewise. `Frame1234`
/// matches none of them, exactly as `Frame` matches none, so `nominal_name` is
/// unchanged and nothing that decides a *descriptor kind* moves.
///
/// The JVM backend takes its class names from this field, so a rename is
/// visible there; it was named to that session before it landed.
/// `name`, or `name{id}` where another layout already holds it.
///
/// The one rule behind both ways a layout comes to be named: pushed under its
/// own name, or renamed on merge when a declared name beats a generated one.
/// A layout that *is* the holder -- its first type id is `own` -- keeps the
/// name; anything else sharing it is the collision this exists for.
#[cfg(test)]
pub(super) fn unshared_layout_name_for(
    existing: &[Layout],
    name: &str,
    own: Option<TypeId>,
) -> String {
    let held_elsewhere = existing.iter().any(|known| {
        #[cfg(test)]
        collection_tests::note(|counts| counts.name_candidates += 1);
        known.name == name && known.types.first().copied() != own
    });
    match (held_elsewhere, own) {
        (true, Some(ty)) => format!("{name}{}", ty.0),
        _ => name.to_owned(),
    }
}

/// Every object type id in `ty`, the ones inside a container included.
pub(super) fn objects_in(ty: &HirType, into: &mut Vec<TypeId>) {
    let HirType::Managed(managed) = ty else {
        return;
    };
    match managed {
        ManagedType::Object(id) => into.push(*id),
        ManagedType::Array(inner)
        | ManagedType::Promise(inner)
        | ManagedType::Set(inner)
        | ManagedType::View(inner) => {
            objects_in(inner, into);
        }
        ManagedType::Map(key, value) | ManagedType::Table(key, value) => {
            objects_in(key, into);
            objects_in(value, into);
        }
        ManagedType::String
        | ManagedType::BoxedBigInt
        | ManagedType::Template
        | ManagedType::Date
        | ManagedType::Region
        | ManagedType::Buffer
        | ManagedType::AnyView
        | ManagedType::DataView
        | ManagedType::Symbol => {}
    }
}

/// Canonicalize storage aliases while preserving declared identities.
///
/// The frontend can give anonymous aliases of one structural shape different
/// IDs, even after `collect_layouts` has merged their storage. Canonicalizing
/// those aliases avoids conversions between pointers to the same struct.
///
/// Anonymous types take their layout's representative. Class and interface
/// contracts survive independently of that shared representation.
pub(super) fn canonicalize_objects(program: &mut Program) {
    // **A class is its own representative, and that is what keeps identity.**
    //
    // Rewriting to the *layout's* representative erased the one thing telling
    // two same-shaped classes apart: `new B()` arrived at the backend as
    // `Object(A)`, so it was allocated with A's descriptor and
    // `new B() instanceof A` answered `true`. The checker had it right and this
    // pass took it away -- `lower_new` pushes `Object(B)` and the printed HIR
    // said `obj#1`.
    //
    // Per class rather than per layout costs nothing it was buying. Both ids
    // resolve to the same layout and therefore the same C struct and the same
    // JVM field table. Storage stays shared while allocation and `instanceof`
    // retain the class identity.
    //
    // An interface's schema ID keeps its contract, independently of storage:
    // two empty declarations can share a layout, and two instantiations can
    // share pointer fields while disagreeing about null versus undefined.
    // Anonymous types still take their layout's representative. Index once,
    // because every parameter, result and operation asks this same question.
    let representatives = object_representatives(program);

    let canonical = |ty: &mut HirType| {
        if let HirType::Managed(ManagedType::Object(id)) = ty
            && let Some(representative) = representatives.get(id)
        {
            *id = *representative;
        }
    };

    // **And a native call's own signature**, where it names an object: a
    // closure a foreign function answers (`Closure<F>`, request 14) is the
    // program's object of `F`'s signature type. The getter and the property
    // reading it spell that type twice -- two ids, one layout -- so the call's
    // value was rewritten to the representative and its callee's result was
    // not, and the verifier saw them disagree.
    let canonical_native = |ty: &mut crate::hir::native::Type| {
        if let crate::hir::native::Type::Managed(managed @ ManagedType::Object(_)) = ty {
            let mut whole = HirType::Managed(managed.clone());
            canonical(&mut whole);
            if let HirType::Managed(object) = whole {
                *managed = object;
            }
        }
    };

    for func in &mut program.funcs {
        canonical(&mut func.return_type);
        for param in &mut func.params {
            canonical(&mut param.ty);
        }
        for value in &mut func.values {
            canonical(&mut value.ty);
            if let OpKind::Call {
                callee: Callee::Native(target),
                ..
            } = &mut value.kind
                && matches!(
                    &target.result,
                    crate::hir::native::Type::Managed(ManagedType::Object(_))
                )
            {
                canonical_native(&mut std::sync::Arc::make_mut(target).result);
            }
        }
    }
}

/// Class aliases first, then each interface contract and each plain record,
/// then anonymous storage. First entry wins, preserving the canonicalizer's
/// declared-identity priority.
fn object_representatives(program: &Program) -> rustc_hash::FxHashMap<TypeId, TypeId> {
    let mut representatives = rustc_hash::FxHashMap::default();
    for class in &program.classes {
        if let Some(&representative) = class.types.first() {
            for &ty in &class.types {
                representatives.entry(ty).or_insert(representative);
            }
        }
    }
    for ty in program.structural_faces() {
        representatives.entry(ty).or_insert(ty);
    }
    // A literal allocated in a class's layout keeps itself too: taking the
    // layout's representative would make it the class again, which is the
    // `instanceof` it must not answer (`Program::plain_records`).
    for ty in &program.plain_records {
        representatives.entry(*ty).or_insert(*ty);
    }
    for layout in &program.layouts {
        if let Some(&representative) = layout.types.first() {
            for &ty in &layout.types {
                representatives.entry(ty).or_insert(representative);
            }
        }
    }
    representatives
}

impl FuncBuilder<'_> {
    /// A type reached where a layout is wanted, that the frontend did not expand.
    ///
    /// **It names the type, and that is the whole of the change.** One sentence was
    /// carrying three unlike causes: over `runtime/node/http` alone it is `this`
    /// standing for a class (`NodeError`, `UVAddressError`, `UVExceptionError`,
    /// `ReadableState`) at four sites and an uninstantiated type parameter `T` at
    /// four more -- a polymorphic receiver and a missing copy, which are different
    /// work with different fixes.
    ///
    /// Found because the largest of them **does not reduce**. `fatalError` in
    /// `internal/async-hooks.ts` refuses here and 44 functions in that module stand
    /// on it -- every `catch` body that calls it -- while five arms of the same
    /// narrowing compiled cleanly in a six-line fixture, each answering a
    /// *different* sentence. With the type in the message the answer arrived in one
    /// command: `this`, which stands for `NodeError`. Without it there is nothing to
    /// bisect from, in a file where several types could be the one meant.
    fn not_decomposed(&self, id: NodeId, ty: TypeId) -> Diagnostic {
        self.unsupported(
            id,
            &format!(
                "an object type that was not decomposed ({})",
                describe(self.snapshot, ty)
            ),
        )
    }

    /// The class a polymorphic `this` stands for, and `ty` unchanged otherwise.
    ///
    /// TypeScript models `this` as a type parameter named after its class and
    /// constrained to it, so it is **not** a `TypeKind::Object` and
    /// [`Self::layout_of`] refused it as "an object type that was not decomposed"
    /// -- which is what `runtime/node/internal/async-hooks.ts:410` said, with 44
    /// functions of `http` standing on it once a `try` stops failing open. The
    /// sentence named no type until `8af9bdc07`, and with the type in it the
    /// answer took one command: the type is `this`, standing for `NodeError`.
    ///
    /// **Resolved before `layout_of`'s cache lookup**, so `this` and its class
    /// share *one* layout. Two layouts over one set of fields is the silent type
    /// confusion this file is most careful about, and a resolution after the
    /// lookup would build exactly that.
    ///
    /// Sound for a subclass receiver because `put_bases_first` makes a subclass's
    /// layout a prefix-compatible extension of its base's -- the argument
    /// `verify::compatible` already rests on for `Object`/`Object`.
    ///
    /// And **not a new derivation**: `representation_within` already resolves a
    /// `this` type through its constraint, so this makes the layout agree with the
    /// representation rather than inventing a rule. A representation and a layout
    /// disagreeing about one value is precisely how this goes wrong.
    pub(super) fn class_behind(&self, ty: TypeId) -> TypeId {
        self.snapshot.polymorphic_this_constraint(ty).unwrap_or(ty)
    }

    /// Whether a type is a call signature rather than something with fields.
    pub(super) fn is_a_signature(&self, ty: TypeId) -> bool {
        self.snapshot
            .types
            .get(ty.0 as usize)
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
    }

    /// The JVM binary name of the class a **bound** record stands for, if it
    /// is one.
    ///
    /// Any member of the declaration carries it: every row for one class names
    /// the same owner, so the first that resolves answers for all of them.
    /// Split out of [`Self::layout_of`] to keep that function under its line
    /// limit, and because "which jar class is this" is its own question.
    pub(super) fn foreign_owner(&self, record: &TypeRecord) -> Option<String> {
        record
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map(|symbol| symbol.declarations.clone())
            .into_iter()
            .flatten()
            .flat_map(|declaration| self.children(declaration))
            .find_map(|member| {
                let at = self.location(member);
                let row = self.foreign.get(&(at.file.0, at.span.end))?;
                row.key
                    .split_once(':')?
                    .0
                    .rsplit_once('.')
                    .map(|(owner, _)| owner.to_owned())
            })
    }

    pub(super) fn layout_of(&mut self, id: NodeId, ty: TypeId) -> Result<Layout, Diagnostic> {
        // Before the lookup below, so `this` and its class share one layout:
        // see [`Self::class_behind`].
        let ty = self.class_behind(ty);
        if let Some(known) = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
        {
            return Ok(known.clone());
        }
        // Before the snapshot lookup, because the union this stands for is not
        // a `TypeKind::Object` and would be refused as "not an object type"
        // three lines down.
        if let Some(provided) = self.provided_iterator_layout(id, ty) {
            return provided;
        }
        // The box a GLib boxed record lives in: a synthetic type, laid out
        // here rather than read from the snapshot.
        if ty == TypeId(crate::hir::BOXED_RECORD) {
            self.boxed_record_layout();
            return self.layout_of(id, ty);
        }
        let record =
            self.snapshot.types.get(ty.0 as usize).ok_or_else(|| {
                self.unsupported(id, "an object type that is not in the snapshot")
            })?;
        if matches!(record.kind, TypeKind::Function(_)) {
            let layout = signature_layout(self.snapshot, ty);
            self.layouts.push(layout.clone());
            return Ok(layout);
        }
        // **A module's namespace has no fields either.** Its properties are the
        // module's exports, and a read of one goes to the export itself, through
        // the type (`holds_a_namespace`) -- a field per export would be a second
        // copy of each, stale the moment a `let` export was reassigned, and live
        // bindings are what the language promises. So a namespace value is the
        // module's one static instance (`ClosureStatic`), the same object on
        // every `import()`, and nothing in it is read.
        if let Some(module) = module_of_namespace(self.snapshot, ty) {
            return Ok(self.namespace_layout(module, ty));
        }
        // A tuple is a fixed-length heterogeneous sequence, which is what an
        // object with positional fields already is. Naming the fields `0`, `1`
        // is not a trick to make it fit: `[string, number]` *is* a two-field
        // struct, and saying so gives it the layout machinery, field access,
        // escape analysis and reference counting rather than a second mechanism
        // that would need all four again.
        //
        // Not an array, which is the other tempting answer: an array has one
        // element type and a length the compiler does not fix, and a tuple has
        // neither.
        if let TypeKind::Tuple(elements) = &record.kind {
            let elements = elements.elements.clone();
            return self.tuple_layout(id, ty, &elements);
        }
        // A class this compiler provides rather than decomposes. It never
        // reaches the arm below, because it is never an `Object`: `Error`
        // arrives as a structured type and stays one.
        if let Some(layout) = self.provided_layout(ty) {
            return Ok(layout);
        }
        // The abstract generator, which the frontend does not decompose: it is
        // `lib.d.ts`'s `Generator<T, …>`, and its members describe a protocol
        // object this compiler does not build. What it is here is the class
        // every frame that yields `T` extends.
        if let Some(layout) = self.abstract_generator_layout(ty) {
            self.layouts.push(layout.clone());
            return Ok(layout);
        }
        let TypeKind::Object { properties } = &record.kind else {
            return Err(self.not_decomposed(id, ty));
        };
        // Cloned so the borrow of the snapshot ends here: `fields_of` builds
        // the layouts of the object types its fields hold, which needs `&mut`.
        // Once per type, and a layout is built once.
        let properties = properties.clone();
        self.representable_bases(id, ty)?;

        let mut fields = self.fields_of(id, ty, &properties)?;

        // What this type extends, where the program declares it. Needed twice
        // below: once to order the fields base-first, and once so that two types
        // differing only in their base do not merge -- `class B extends A {}`
        // adding nothing is the case, and it merged into `A` until this.
        let base = self.hierarchy.base.get(&ty).copied();

        // Base first, so a derived object's fields start with exactly the base's
        // and a pointer to one is a pointer to the other. That is what makes an
        // upcast free: `Square#area` and `Shape#doubled` read the same offsets
        // for the fields they share, so passing a `Square*` where a `Shape*` is
        // expected needs no work at all.
        //
        // The checker's property list is flattened -- it already contains the
        // inherited members with nothing to say where they came from -- so the
        // order has to be recovered from the base rather than read off.
        //
        // From the base's *layout*, which is the authoritative answer and cannot
        // disagree with itself. Re-deriving it from the base type's properties
        // is what this did before, and it silently produced nothing whenever the
        // base's type record was not the `Object` kind -- which is every
        // `abstract class` in `runtime/node`'s error hierarchy. The order then
        // fell back to the checker's, which puts a class's *own* declarations
        // first, so `ERR_INVALID_ARG_TYPE` laid out `["code", "name",
        // "message"]` against its base's `["message", "name", "code"]`.
        //
        // Same fields, different order, and every backend's upcast is a pointer
        // cast that assumes otherwise. Nothing caught it because nothing
        // asserted base-first layout until `Layout.base` gave `verify` something
        // to assert it against; the check found this on its first run.
        // Taken *from* the base's layout rather than sorted towards it, which
        // fixes a second thing at the same time. A field whose type has exactly
        // one value needs no storage and is elided -- `override readonly code =
        // "ERR_INVALID_ARG_TYPE"` is a string literal type -- so a derived class
        // could drop a slot its base keeps. `ERR_INVALID_ARG_TYPE_FUNCTION` laid
        // out `["message", "name"]` under a base laid out `["message", "name",
        // "code"]`, and an upcast would have read past the end of it.
        //
        // Whatever the base stores, the derived stores, at the same offsets, in
        // the same order. Then its own additions. That is base-first layout
        // stated as a construction instead of hoped for as a sort.
        if let Some(base) = base {
            fields = self.after_the_base(id, base, fields)?;
        } else if let Some(parent) = declared_record_parent(self.snapshot, self.hierarchy, ty) {
            // **A record with a declared parent is laid out parent-first too**, for
            // the reason the class above is: every upcast in every backend is a
            // pointer cast that assumes it.
            //
            // A record had no `base` to key that off, so it took the written order
            // -- and the written order is per program. `PerformanceEntryDetailJSON`
            // is `[detail, name, entryType, startTime, duration]` in `net`, detail
            // first, and parent-first in `perf_hooks`' own program. `net`'s is the
            // one that ships: the override returns that struct through
            // `PerformanceEntry#toJSON`'s slot, so **C reads `name` at `detail`'s
            // offset** -- the live-on-C `outcomes/a-covariant-record-with-the-base-
            // fields-reordered`, happening in the runtime. The JVM lane found it by
            // refusing the store and declining to relax the prefix check, which was
            // the right call: presence bits for optional fields are indexed by
            // position too.
            //
            // **Order only.** This does not give a record a `base` and nothing here
            // reads one: `same_shape` and the merge are untouched, so a `{...}`
            // literal at the child's type still shares the child's layout. That
            // separation is the whole design of `record_parents` and this is the
            // half of it that costs nothing to identity.
            fields = self.after_the_base(id, parent, fields)?;
        } else {
            fields = self.as_the_program_writes_them(fields);
        }

        // The declared name where there is one. An anonymous object type —
        // `{ x: number }` written inline — has no symbol, so it is named after
        // its type id, which is at least stable and unique.
        // **A bound foreign class is named by its binary name**, which is its
        // identity: `com/probe/Box`, not `Box`. `nominal_name` already treats a
        // name with a `/` as foreign and refuses to merge it with a differently
        // named layout, so the family exists and only the name was missing.
        //
        // Taken from the binding table rather than invented. A row's key is
        // `owner.member:descriptor`, and every member of one class carries the
        // same owner, so the first row found answers it. Deriving it from the
        // module specifier instead would put `java:` in the middle end, which
        // `bind.rs` is deliberately the only place to know.
        let bound = self.foreign_owner(record);
        let name = nominal_or_stand_in(self.snapshot, ty);
        // `Vector<Body>` and `Vector<double>` share the declaring symbol and so
        // share this name, and they are different classes with different field
        // widths. The type id tells them apart, and `<>` cannot appear in a
        // TypeScript identifier so the qualified name cannot collide with a
        // plain one. `nts types` is what reads the number back.
        // A foreign class takes no instantiation suffix: its binary name is
        // what the jar calls it, and `Box<T>` and `Box<U>` are one class there.
        let name =
            bound.unwrap_or_else(|| format!("{name}{}", instantiation_suffix(self.snapshot, ty)));
        let methods = self.overridden_entries(ty, &fields, base, &name);

        // Structural, so a type whose shape is already laid out joins that
        // layout rather than getting one of its own. The first name wins, which
        // is usually the declared one -- an anonymous literal type tends to be
        // discovered second.
        if let Some(at) = self.layouts.find_shape(&name, &fields, &methods, base) {
            // **A generic declaration joins nothing.** `Box<T>` with `T`
            // unbound has no values: everything at run time is some
            // `Box<number>`, and a copy asks for the declaration's layout only
            // to be told what the instantiation it is lowering looks like. So
            // the answer is handed back and the id is *not* recorded here --
            // because recording it puts one type id in several layouts, and
            // `collect_layouts` merges two layouts that share one regardless
            // of shape.
            //
            // That is how four instantiations of
            // `WritableStreamDefaultWriter<W>` became one layout on
            // 2026-09-22: each copy laid the declaration out under its own
            // substitution, correctly and differently, and each pushed `2517`
            // into its own layout -- so at the program level all four
            // overlapped on `2517` and merged into the first. Every copy then
            // read its `[writableWriterState]` field through one layout that
            // can only hold one of the four field types, and `zlib` emitted
            // `v5 = v2->stream` between two unrelated structs.
            if !is_a_generic_declaration(self.snapshot, ty) {
                self.layouts.add_type(at, ty);
            }
            // A declared name beats a generated one, whichever was seen first.
            // The anonymous type of a literal is usually discovered before the
            // interface it is assigned to, and `NtsObj_Point` reads better than
            // `NtsObj_Type5`.
            if self.layouts[at].name.starts_with("Type") && !name.starts_with("Type") {
                self.layouts.rename(at, name);
            }
            return Ok(self.layouts[at].clone());
        }

        // Transitively closed and sorted -- see `Layout::interfaces`. Each one
        // is laid out here, because a backend handed a type id needs a layout
        // to get a name from and an interface reached only as a local's
        // declared type had none.
        let interfaces = self.hierarchy.interfaces_of(ty);
        for face in &interfaces {
            let _ = self.layout_of(id, *face);
        }
        let layout = Layout {
            types: vec![ty],
            name,
            // Transitively closed and sorted -- see `Layout::interfaces`. The
            // JVM does not walk `interface A extends B` at a call site, and a
            // hash-ordered list would make one input emit two byte sequences.
            interfaces: interfaces.clone(),
            fields,
            methods,
            base,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }
}
