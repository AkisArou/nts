//! Exact-answer oracle and scaling controls for cycle analysis.
//! The old scans stay here only for tests.

use super::*;
use std::cell::Cell;

thread_local! {
    static WORK: Cell<usize> = const { Cell::new(0) };
}

pub(super) fn record_work(steps: usize) {
    WORK.with(|work| work.set(work.get() + steps));
}

fn work() -> usize {
    WORK.with(Cell::get)
}

fn reset_work() {
    WORK.with(|work| work.set(0));
}

impl Program {
    fn cycles_by_scan(&self) -> Cycles {
        // Which layouts each layout is a *base* of, directly. A field declares
        // the type it is written as and holds any subtype of it, so an edge to a
        // layout is an edge to everything that can be stored through it.
        //
        // **A closure field is the case that matters and it was missed.**
        // `class Holder { run: ((n: number) => void) | null }` declares the
        // *signature* layout, which is fieldless -- so `Holder` had no outgoing
        // edge at all, `cyclic` was emitted as 0, and `nts_possible_root`
        // returns on its first line for a descriptor that says so. The closure
        // actually stored there captures `this` and points straight back.
        //
        // What that costs is not a slow path but a permanent one: the object is
        // never offered to the cycle collector, so `h.run = (v) => { h.count +=
        // v }` leaks for the life of the program. It shows up only where the
        // cycle *cannot* be torn down by hand -- an object that never escapes
        // gets its fields released at the end of the scope, which breaks the
        // cycle without the collector, and that is why every fixture that had
        // this shape passed until one of them handed the object to a callee.
        let count = self.layouts.len();
        // The first layout naming each type, as `position` over the layouts
        // answered it -- asked once here instead of once per question.
        let mut layout_of: rustc_hash::FxHashMap<TypeId, usize> = rustc_hash::FxHashMap::default();
        for (at, layout) in self.layouts.iter().enumerate() {
            for ty in &layout.types {
                layout_of.entry(*ty).or_insert(at);
            }
        }
        let mut subtypes: Vec<Vec<usize>> = vec![Vec::new(); count];
        for (at, layout) in self.layouts.iter().enumerate() {
            let Some(base) = layout.base else {
                continue;
            };
            if let Some(&above) = layout_of.get(&base) {
                subtypes[above].push(at);
            }
        }
        // **A subclass is not the only thing a slot holds, and treating it as
        // one leaked.** A structural prefix cast stores a `Node` where a `Leaf`
        // is wanted when `Node` holds `Leaf`'s fields first, and an `Unerase`
        // makes whatever was erased into whatever it is narrowed to, unchecked.
        // `class Node { value: number; kids: Leaf[] }` with `n.kids.push(n)`
        // reached only `Leaf` from `Node`, so `Node` was emitted acyclic and the
        // cycle was found only while the array happened to be retained around
        // the `push`; elide that pair and five nodes leaked. So a layout's slot
        // holds what the program actually casts into it, as well as what
        // derives from it.
        let mut held: rustc_hash::FxHashSet<(usize, usize)> = subtypes
            .iter()
            .enumerate()
            .flat_map(|(above, below)| below.iter().map(move |at| (above, *at)))
            .collect();
        let (casts, erased, unerased) = self.cast_sources_by_scan();
        for (target, source) in casts {
            if held.insert((target, source)) {
                subtypes[target].push(source);
            }
        }
        for (target, source) in self.unerase_sources_by_scan(&subtypes, &erased, &unerased) {
            if held.insert((target, source)) {
                subtypes[target].push(source);
            }
        }

        // The layouts a promise's reactions can hold: each frame suspended on
        // one and each closure subscribed to one, read off the operations.
        let reactions = self.reactions_by_scan();

        // Edges: which layouts a layout's reference fields can lead to, and
        // everything derived from those.
        //
        // Deduplicated through a set rather than `contains`: since an erased
        // field reaches every layout (bdd57aa29), a list here can be as long as
        // the program has layouts, and a linear test per insert made this
        // cubic -- `runtime/node/http` spent 420 of its 700 seconds here.
        let mut seen = vec![false; count];
        let edges: Vec<Vec<usize>> = self
            .layouts
            .iter()
            .map(|layout| {
                let mut reached = Vec::new();
                for field in &layout.fields {
                    self.reaches(&field.ty, &reactions, &mut reached);
                }
                let mut targets = Vec::new();
                for at in reached {
                    if !std::mem::replace(&mut seen[at], true) {
                        targets.push(at);
                    }
                }
                // Transitively, because a base's subtype may itself be a base.
                let mut at = 0;
                while at < targets.len() {
                    let next = targets[at];
                    at += 1;
                    for &below in &subtypes[next] {
                        if !std::mem::replace(&mut seen[below], true) {
                            targets.push(below);
                        }
                    }
                }
                for &at in &targets {
                    seen[at] = false;
                }
                targets
            })
            .collect();

        // A layout is cyclic when a path of edges leads from it back to it:
        // its strongly connected component has another member, or it has an
        // edge to itself. This was a search per layout, on the ground that the
        // layout count is small; with an erased field reaching every layout the
        // edges are not, and the searches were cubic.
        let component = strongly_connected(&edges);
        let mut members = vec![0usize; count];
        for &of in &component {
            members[of] += 1;
        }
        let cyclic: Vec<bool> = (0..count)
            .map(|at| members[component[at]] > 1 || edges[at].contains(&at))
            .collect();
        // Whether an array whose elements are of each layout can be in a
        // cycle: some layout its elements can lead to, through what a slot
        // holds and where fields go, is cyclic. Every layout's answer at once,
        // walking backwards from the cyclic ones, where [`Cycles::array`] used
        // to walk forwards from its element on every call.
        let mut leads_to: Vec<Vec<usize>> = vec![Vec::new(); count];
        for at in 0..count {
            for &next in subtypes[at].iter().chain(&edges[at]) {
                leads_to[next].push(at);
            }
        }
        let mut reaches_a_cycle = cyclic.clone();
        let mut work: Vec<usize> = (0..count).filter(|&at| cyclic[at]).collect();
        while let Some(at) = work.pop() {
            for &from in &leads_to[at] {
                if !std::mem::replace(&mut reaches_a_cycle[from], true) {
                    work.push(from);
                }
            }
        }
        Cycles {
            cyclic,
            layout_of,
            reaches_a_cycle,
        }
    }

    /// The layouts of every reaction's state the program subscribes to a
    /// promise, with every layout for state that has none here.
    fn reactions_by_scan(&self) -> Vec<usize> {
        let mut reactions = Vec::new();
        for func in &self.funcs {
            for op in &func.values {
                let (OpKind::Suspend {
                    promise: Some(_),
                    frame: state,
                    ..
                }
                | OpKind::PromiseSubscribe {
                    reaction: state, ..
                }) = &op.kind
                else {
                    continue;
                };
                match &func.values[state.0 as usize].ty {
                    HirType::Managed(ManagedType::Object(id)) => {
                        match self.layouts.iter().position(|l| l.types.contains(id)) {
                            Some(at) => reactions.push(at),
                            None => reactions.extend(0..self.layouts.len()),
                        }
                    }
                    _ => reactions.extend(0..self.layouts.len()),
                }
            }
        }
        reactions.sort_unstable();
        reactions.dedup();
        reactions
    }

    /// The explicit and structural cast pairs, and the layouts of the object
    /// types erased and unerased (`None` for one with no layout).
    #[expect(clippy::type_complexity, reason = "an oracle's three scans, read once")]
    fn cast_sources_by_scan(
        &self,
    ) -> (Vec<(usize, usize)>, Vec<Option<usize>>, Vec<Option<usize>>) {
        let mut pairs = Vec::new();
        let mut erased: Vec<&HirType> = Vec::new();
        let mut unerased: Vec<&HirType> = Vec::new();
        for func in &self.funcs {
            for op in &func.values {
                match &op.kind {
                    OpKind::Convert(from) | OpKind::FieldView { value: from, .. } => {
                        self.cast_pairs(&func.values[from.0 as usize].ty, &op.ty, &mut pairs);
                    }
                    OpKind::Erase { value, .. } => {
                        let ty = &func.values[value.0 as usize].ty;
                        if !erased.contains(&ty) {
                            erased.push(ty);
                        }
                    }
                    OpKind::Unerase { .. } if !unerased.contains(&&op.ty) => unerased.push(&op.ty),
                    _ => {}
                }
            }
        }
        let objects = |types: &[&HirType]| {
            let mut objects = Vec::new();
            for ty in types {
                self.objects_by_scan(ty, &mut objects);
            }
            objects
        };
        let (erased, unerased) = (objects(&erased), objects(&unerased));
        // **A structural cast usually leaves no operation behind**, which is
        // why the scan above is not enough on its own. `add(node, node)` where
        // `add` takes a `Leaf` is specialized into `add@1obj5`, whose parameter
        // already *is* a `Node`, and its `push` into a `Leaf[]` stores one with
        // nothing in between to read. So the pairs come from the rule that
        // admits the cast, applied to the layouts: a slot of `T` can hold any
        // layout that holds `T`'s fields first, in order (`lower::same_slot`).
        //
        // A fieldless target is a prefix of everything. A closure signature is
        // one -- the base its closures name -- and only a closure is admitted
        // there, already its subtype, so it takes nothing more; widening every
        // callback field to every layout would make every class that holds one
        // cyclic. Any other fieldless type, `{}` or an empty interface, can be
        // handed any object, and takes every layout.
        let signatures: Vec<usize> = (0..self.layouts.len())
            .filter(|&at| {
                self.layouts.iter().any(|layout| {
                    layout
                        .base
                        .is_some_and(|base| self.layouts[at].types.contains(&base))
                        && layout.types.iter().copied().any(is_closure_type)
                })
            })
            .collect();
        for (target, wanted) in self.layouts.iter().enumerate() {
            if wanted.fields.is_empty() && signatures.contains(&target) {
                continue;
            }
            for (source, held) in self.layouts.iter().enumerate() {
                if source != target
                    && wanted.fields.len() <= held.fields.len()
                    && wanted
                        .fields
                        .iter()
                        .zip(&held.fields)
                        .all(|(want, have)| lower::same_slot(want, have))
                {
                    pairs.push((target, source));
                }
            }
        }
        (pairs, erased, unerased)
    }

    fn objects_by_scan(&self, ty: &HirType, into: &mut Vec<Option<usize>>) {
        match ty {
            HirType::PossiblyUndefined(inner)
            | HirType::Managed(
                ManagedType::Array(inner)
                | ManagedType::View(inner)
                | ManagedType::Set(inner)
                | ManagedType::Promise(inner),
            ) => self.objects_by_scan(inner, into),
            HirType::Managed(ManagedType::Map(key, value) | ManagedType::Table(key, value)) => {
                self.objects_by_scan(key, into);
                self.objects_by_scan(value, into);
            }
            HirType::Managed(ManagedType::Object(id)) => {
                into.push(self.layouts.iter().position(|l| l.types.contains(id)));
            }
            _ => {}
        }
    }

    /// `(target, source)` for every layout an `Unerase` to `target` can
    /// produce, by brute force: every layout an erased type's slot holds,
    /// transitively through `held`, that holds each member `target` requires
    /// as a field of the same identity or as an owner of its family.
    fn unerase_sources_by_scan(
        &self,
        held: &[Vec<usize>],
        erased: &[Option<usize>],
        unerased: &[Option<usize>],
    ) -> Vec<(usize, usize)> {
        let count = self.layouts.len();
        if erased.is_empty() {
            return Vec::new();
        }
        let mut erasable = vec![erased.contains(&None); count];
        let mut work = Vec::new();
        for &at in erased.iter().flatten() {
            if !std::mem::replace(&mut erasable[at], true) {
                work.push(at);
            }
        }
        while let Some(at) = work.pop() {
            for &next in &held[at] {
                if !std::mem::replace(&mut erasable[next], true) {
                    work.push(next);
                }
            }
        }
        let supplies = |target: usize, source: usize, wanted: &Field| {
            self.layouts[source]
                .fields
                .iter()
                .any(|have| wanted.names_the_same_member(have))
                || self.interface_access.families.iter().any(|family| {
                    family.member == wanted.name
                        && self.layouts[target].types.contains(&family.face)
                        && family
                            .owners
                            .iter()
                            .any(|owner| self.layouts[source].types.contains(owner))
                })
        };
        let mut pairs = Vec::new();
        for &target in unerased.iter().flatten() {
            for source in (0..count).filter(|&source| source != target && erasable[source]) {
                if self.layouts[target]
                    .fields
                    .iter()
                    .filter(|field| super::cycles::requires(field))
                    .all(|wanted| supplies(target, source, wanted))
                {
                    pairs.push((target, source));
                }
            }
        }
        pairs
    }
}

fn object(id: u32) -> HirType {
    HirType::Managed(ManagedType::Object(TypeId(id)))
}

fn field(name: &str, ty: HirType) -> Field {
    Field {
        name: name.into(),
        ty,
        written: None,
        declared_by: None,
        readonly: false,
    }
}

fn layout(id: u32, fields: Vec<Field>) -> Layout {
    Layout {
        types: vec![TypeId(id)],
        name: format!("L{id}"),
        fields,
        methods: Vec::new(),
        interfaces: Vec::new(),
        base: None,
    }
}

fn equivalent(program: &Program) -> Cycles {
    let expected = program.cycles_by_scan();
    let actual = program.cycles();
    assert_eq!(actual.cyclic, expected.cyclic, "layout answers");
    assert_eq!(
        actual.layout_of, expected.layout_of,
        "first layout per type"
    );
    assert_eq!(
        actual.reaches_a_cycle, expected.reaches_a_cycle,
        "array answers"
    );
    for ty in program.layouts.iter().flat_map(|layout| &layout.types) {
        let ty = HirType::Managed(ManagedType::Object(*ty));
        assert_eq!(actual.array(&ty), expected.array(&ty), "{ty:?}");
    }
    for ty in [
        object(123_456),
        HirType::Erased,
        HirType::NUMBER,
        HirType::Managed(ManagedType::String),
        HirType::Managed(ManagedType::Template),
        HirType::Managed(ManagedType::Array(Box::new(object(1)))),
    ] {
        assert_eq!(actual.array(&ty), expected.array(&ty), "{ty:?}");
    }
    actual
}

fn closures(count: u32, self_reference: bool) -> Program {
    let mut layouts = vec![layout(1, Vec::new())];
    for at in 0..count {
        let mut closure = layout(SYNTHETIC_CLOSURES + at, Vec::new());
        closure.base = Some(TypeId(1));
        layouts.push(closure);
    }
    if self_reference {
        layouts.push(layout(2, vec![field("next", object(2))]));
    }
    Program {
        layouts,
        ..Program::default()
    }
}

#[test]
fn fieldless_views_can_hold_referenceful_objects() {
    // Empty {}, Holder { item: Empty }, Node { owner: Holder }. Empty cannot
    // start a cycle but its structural sources can: pruning the empty target
    // would lose both real-layout answers and array(Empty).
    let program = Program {
        layouts: vec![
            layout(1, Vec::new()),
            layout(2, vec![field("item", object(1))]),
            layout(3, vec![field("owner", object(2))]),
        ],
        ..Program::default()
    };
    let answer = equivalent(&program);
    assert_eq!(answer.cyclic, [false, true, true]);
    assert!(answer.array(&object(1)));
    // One-change control: a scalar slot cannot carry that reference cycle.
    let mut control = program.clone();
    control.layouts[1].fields[0].ty = HirType::NUMBER;
    let answer = equivalent(&control);
    assert_eq!(answer.cyclic, [false, false, false]);
    assert!(!answer.array(&object(1)));
}

#[test]
fn fieldless_closures_match_the_scan_with_and_without_a_real_cycle() {
    for count in [0, 1, 31, 127] {
        for self_reference in [false, true] {
            let answer = equivalent(&closures(count, self_reference));
            assert!(
                answer.cyclic[..=count as usize]
                    .iter()
                    .all(|cyclic| !cyclic)
            );
            assert_eq!(
                answer.array(&object(1)),
                self_reference,
                "a signature can reach a cycle through a concrete empty closure view"
            );
            if self_reference {
                assert!(answer.cyclic[count as usize + 1]);
                assert!(
                    answer.array(&object(SYNTHETIC_CLOSURES)),
                    "a concrete empty closure is still a structural view"
                );
            }
        }
    }
}

fn assert_linear(self_reference: bool) {
    // The old scan materializes N*N relationships in both arms. Count actual
    // candidate visits / compressed graph entries, not elapsed shared CPU time.
    let mut previous = None;
    for count in [64, 128, 256] {
        let program = closures(count, self_reference);
        reset_work();
        let _ = program.cycles();
        let steps = work();
        eprintln!(
            "cycle construction: closures={count}, reference={self_reference}, entries={steps}"
        );
        assert!(steps > 0, "the construction counter must run");
        assert!(
            steps <= 10 * program.layouts.len() + 32,
            "{count} closures, self-reference={self_reference}: {steps} construction steps"
        );
        if let Some(previous) = previous {
            assert!(steps <= previous * 2 + 16, "doubling repeated a pair scan");
        }
        previous = Some(steps);
    }
}

#[test]
fn fieldless_closure_relationship_work_is_linear() {
    assert_linear(false);
}

#[test]
fn one_reference_class_does_not_repeat_fieldless_relationships() {
    assert_linear(true);
}

#[test]
fn prefix_keys_keep_private_owners_public_names_and_exact_types() {
    let private = |owner| Field {
        name: nts_semantic_schema::PropertyKey::Private("#next".to_owned()),
        declared_by: Some(TypeId(owner)),
        ..field("#next", object(1))
    };
    let public = |owner| Field {
        declared_by: Some(TypeId(owner)),
        ..field("next", object(1))
    };
    for (first, second, matches) in [
        (private(4), private(4), true),
        (private(4), private(5), false),
        (public(4), public(5), true),
        (public(4), field("next", object(99)), false),
    ] {
        let program = Program {
            layouts: vec![layout(1, vec![first]), layout(2, vec![second])],
            ..Program::default()
        };
        let answer = equivalent(&program);
        assert_eq!(
            answer.cyclic[1],
            matches || program.layouts[1].fields[0].ty == object(99)
        );
    }
}

#[test]
fn mixed_graphs_keep_every_old_layout_and_array_answer() {
    // Deterministic generated shapes exercise repeated prefixes, base chains,
    // duplicate type ids, unknown/erased references and nested containers.
    for seed in 0..128u32 {
        let mut program = Program::default();
        for at in 0..12u32 {
            let target = (seed.wrapping_mul(17) + at * 7) % 15 + 1;
            let ty = match (seed + at) % 8 {
                0 => HirType::NUMBER,
                1 => HirType::Managed(ManagedType::String),
                2 => object(target),
                3 => HirType::Erased,
                4 => HirType::Managed(ManagedType::Array(Box::new(object(target)))),
                5 => HirType::Managed(ManagedType::Promise(Box::new(object(target)))),
                6 => HirType::Managed(ManagedType::Map(
                    Box::new(object(target)),
                    Box::new(HirType::NUMBER),
                )),
                _ => HirType::NativePointer(native::gobject_root()),
            };
            let fields = if (seed + at) % 5 == 0 {
                Vec::new()
            } else {
                vec![field("shared", HirType::NUMBER), field("next", ty)]
            };
            let mut entry = layout(at + 1, fields);
            if at > 0 && (seed + at) % 3 == 0 {
                entry.base = Some(TypeId(at));
            }
            if at == 11 {
                entry.types.push(TypeId(1));
            }
            program.layouts.push(entry);
        }
        // Reactions: a frame, a closure, or state with no layout here.
        if seed % 2 == 1 {
            let state = if seed % 16 == 7 { 99 } else { seed % 15 + 1 };
            program.funcs.push(subscribe(object(state), seed % 4 == 1));
        }
        equivalent(&program);
    }
}

#[test]
fn all_small_prefix_graphs_keep_the_scan_answers() {
    // Three layouts drawn from empty, scalar and every object-reference shape.
    // This includes acyclic chains as well as each possible back edge, without
    // an erased field making every referenceful layout cyclic at once.
    for code in 0..216u32 {
        let mut shape = code;
        let mut program = Program::default();
        for id in 1..=3 {
            let choice = shape % 6;
            shape /= 6;
            let fields = match choice {
                0 => Vec::new(),
                1 => vec![field("next", HirType::NUMBER)],
                2 => vec![field("next", HirType::Managed(ManagedType::String))],
                _ => vec![field("next", object(choice - 2))],
            };
            program.layouts.push(layout(id, fields));
        }
        equivalent(&program);
    }
}

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

/// One exported function allocating a `from` and casting it to `to`: through
/// an `Erase` and an `Unerase` when `erasure`, else through a `Convert`.
fn cast(from: HirType, to: HirType, erasure: bool) -> Func {
    let mut values = vec![Op {
        kind: OpKind::ObjectNew { frame: false },
        ty: from,
        origin: origin(),
    }];
    if erasure {
        values.push(Op {
            kind: OpKind::Erase {
                value: ValueId(0),
                absent: Absent::Null,
                slots: Absent::Impossible,
            },
            ty: HirType::Erased,
            origin: origin(),
        });
        values.push(Op {
            kind: OpKind::unerase(ValueId(1)),
            ty: to,
            origin: origin(),
        });
    } else {
        values.push(Op {
            kind: OpKind::Convert(ValueId(0)),
            ty: to,
            origin: origin(),
        });
    }
    func("cast", values)
}

/// One exported function subscribing a `state` to a promise: as the frame a
/// `Suspend` hands it when `frame`, else as a `then` reaction.
fn subscribe(state: HirType, frame: bool) -> Func {
    let promise = HirType::Managed(ManagedType::Promise(Box::new(HirType::NUMBER)));
    let subscription = if frame {
        OpKind::Suspend {
            promise: Some(ValueId(0)),
            frame: ValueId(1),
            resume: "resume".into(),
        }
    } else {
        OpKind::PromiseSubscribe {
            promise: ValueId(0),
            reaction: ValueId(1),
            slot: 0,
        }
    };
    let values = [
        (OpKind::ConstNull, promise),
        (OpKind::ObjectNew { frame: false }, state),
        (subscription, HirType::Void),
    ]
    .into_iter()
    .map(|(kind, ty)| Op {
        kind,
        ty,
        origin: origin(),
    })
    .collect();
    func("subscribe", values)
}

fn func(name: &str, values: Vec<Op>) -> Func {
    let ops = (0..values.len())
        .map(|at| ValueId(u32::try_from(at).expect("small fixture value id")))
        .collect();
    Func {
        name: name.into(),
        params: Vec::new(),
        return_type: HirType::Void,
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops,
            terminator: Terminator::Return(None),
        }],
        origin: origin(),
        exported: true,
        raises: false,
        initializes_receiver: false,
        async_result: None,
        frame: None,
        abstract_declaration: false,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
        written_return: None,
        result_absent: crate::hir::Absent::Impossible,
        validation: None,
        written_return_elements: Vec::new(),
    }
}

#[test]
fn explicit_casts_and_erased_container_pairs_keep_the_scan_answers() {
    let array = |ty| HirType::Managed(ManagedType::Array(Box::new(ty)));
    for container in [false, true] {
        let wrap = |ty| if container { array(ty) } else { ty };
        for erasure in [false, true] {
            // `L3` holding `L1`'s field second: never a prefix, so only the
            // cast or the unerase can put an `L3` in an `L1` slot.
            for holds_wanted in [false, true] {
                let mut owner = vec![field("owner", object(2))];
                if holds_wanted {
                    owner.push(field("wanted", HirType::NUMBER));
                }
                let program = Program {
                    layouts: vec![
                        layout(1, vec![field("wanted", HirType::NUMBER)]),
                        layout(2, vec![field("view", object(1))]),
                        layout(3, owner),
                    ],
                    funcs: vec![cast(wrap(object(3)), wrap(object(1)), erasure)],
                    ..Program::default()
                };
                let answer = equivalent(&program);
                // A `Convert` stores what it converts. An `Unerase` to `L1`
                // produces only an object that can be read as one, and an
                // `L3` without `wanted` cannot.
                let held = !erasure || holds_wanted;
                assert_eq!(
                    answer.cyclic,
                    [false, held, held],
                    "container {container}, erasure {erasure}, holds {holds_wanted}"
                );
                assert_eq!(answer.array(&object(1)), held);
            }
        }
    }
}

/// An erased `Base` can be any layout a `Base` slot holds, so an `Unerase` to
/// `Leaf` reaches a `Derived` erased as its base when `Derived` holds `n`,
/// and an `Unerase` to an interface reaches an owner of its family that holds
/// the member only as a getter. Neither is a prefix of the unerased type.
#[test]
fn unerasures_follow_what_an_erased_slot_holds_and_what_reads_as_the_type() {
    for supplies in [false, true] {
        let mut derived = layout(
            3,
            vec![field("a", HirType::NUMBER), field("back", object(3))],
        );
        if supplies {
            derived.fields.push(field("n", HirType::NUMBER));
        }
        derived.base = Some(TypeId(2));
        let program = Program {
            layouts: vec![
                layout(
                    1,
                    vec![
                        field("n", HirType::NUMBER),
                        // Optional: an object without it is still read as one.
                        field(
                            "note",
                            HirType::PossiblyUndefined(Box::new(HirType::NUMBER)),
                        ),
                    ],
                ),
                layout(2, vec![field("a", HirType::NUMBER)]),
                derived,
            ],
            funcs: vec![cast(object(2), object(1), true)],
            ..Program::default()
        };
        let answer = equivalent(&program);
        assert_eq!(answer.cyclic, [false, false, true]);
        assert_eq!(
            answer.array(&object(1)),
            supplies,
            "subclass supplies n: {supplies}"
        );
    }
    for family in [false, true] {
        let mut program = Program {
            layouts: vec![
                layout(1, vec![field("w", HirType::NUMBER)]),
                layout(2, vec![field("next", object(2))]),
            ],
            funcs: vec![cast(object(2), object(1), true)],
            ..Program::default()
        };
        if family {
            program
                .interface_access
                .families
                .push(super::interface_access::Family {
                    face: TypeId(1),
                    member: "w".into(),
                    field: Some(0),
                    getter: super::interface_access::Entry {
                        slot: 0,
                        declared: "Face#get w".into(),
                    },
                    setter: None,
                    raising: Vec::new(),
                    owners: vec![TypeId(1), TypeId(2)],
                    eager: false,
                    pending: false,
                    stored_dispatch: true,
                });
        }
        let answer = equivalent(&program);
        assert_eq!(answer.cyclic, [false, true]);
        assert_eq!(answer.array(&object(1)), family, "family owner: {family}");
    }
}

/// A promise holds its reactions, each holding its state: the frame suspended
/// on it or the closure subscribed to it. `L1` holds a promise and is
/// subscribed, so it is in a cycle through the runtime's promise; `L3`, which
/// it holds, holds a promise too and is in the same one. `L2` holds a promise
/// no reaction leads back to, and stays acyclic. The one-change controls: no
/// subscription at all, and subscribing state that holds nothing.
#[test]
fn a_promise_leads_to_the_state_of_its_reactions() {
    let promise = |ty| HirType::Managed(ManagedType::Promise(Box::new(ty)));
    let program = |subscribed: Option<u32>, frame: bool| Program {
        layouts: vec![
            layout(
                1,
                vec![
                    field("awaited", promise(HirType::Void)),
                    field("held", object(3)),
                ],
            ),
            // Not named as `L3`'s field, so not a structural prefix of it
            // that an `L3` slot could hold.
            layout(2, vec![field("q", promise(HirType::NUMBER))]),
            layout(3, vec![field("p", promise(HirType::NUMBER))]),
            layout(4, vec![field("n", HirType::NUMBER)]),
        ],
        funcs: subscribed
            .map(|state| subscribe(object(state), frame))
            .into_iter()
            .collect(),
        ..Program::default()
    };
    for frame in [false, true] {
        let answer = equivalent(&program(Some(1), frame));
        assert_eq!(answer.cyclic, [true, false, true, false], "frame {frame}");
        assert!(
            answer.array(&object(2)),
            "L2 reaches the cycle it is not in"
        );
        assert!(!answer.array(&object(4)));
        let answer = equivalent(&program(Some(4), frame));
        assert_eq!(answer.cyclic, [false; 4], "frame {frame}");
        // State with no layout here could be anything, and every promise
        // holder can lead back to itself through it.
        let answer = equivalent(&program(Some(99), frame));
        assert_eq!(answer.cyclic, [true, true, true, false], "frame {frame}");
    }
    let answer = equivalent(&program(None, false));
    assert_eq!(answer.cyclic, [false; 4]);
}

/// A counted Objective-C handle, which a freed object gives up.
fn handle() -> HirType {
    HirType::NativePointer(super::native::Pointee::Opaque(super::native::Handle {
        tag: "Element".to_owned(),
        ancestors: vec!["NSObject".to_owned()],
        family: super::native::Family::Objc,
        interface: false,
        spelling: super::native::Spelling::Tag,
    }))
}

/// Whether releasing an `L1` can free a foreign handle, in a program of these
/// layouts and functions.
fn releases_foreign(layouts: Vec<Layout>, funcs: Vec<Func>) -> bool {
    Program {
        layouts,
        funcs,
        ..Program::default()
    }
    .foreign_releases()
    .release_can_reenter(&object(1))
}

/// Each edge a cycle follows also carries a foreign release: a plain field,
/// a container, a base's slot holding a subclass, a structural prefix, an
/// unerasure and a promise's reactions. Each case's control differs in one
/// thing and reaches no handle or erased field, so its release runs no code.
#[test]
fn a_release_reaches_a_handle_through_every_edge_a_slot_or_field_follows() {
    let held = |foreign: bool| if foreign { handle() } else { HirType::NUMBER };
    let array = |ty| HirType::Managed(ManagedType::Array(Box::new(ty)));
    for foreign in [false, true] {
        // A plain field: `L1 { inner: L2 }`, `L2 { h }`.
        assert_eq!(
            releases_foreign(
                vec![
                    layout(1, vec![field("inner", object(2))]),
                    layout(2, vec![field("h", held(foreign))]),
                ],
                Vec::new(),
            ),
            foreign,
            "field edge"
        );
        // Through a container the field owns, and a container of objects.
        assert_eq!(
            releases_foreign(
                vec![layout(1, vec![field("hs", array(held(foreign)))])],
                Vec::new()
            ),
            foreign,
            "container of handles"
        );
        assert_eq!(
            releases_foreign(
                vec![
                    layout(1, vec![field("items", array(object(2)))]),
                    layout(2, vec![field("h", held(foreign))]),
                ],
                Vec::new(),
            ),
            foreign,
            "container of objects"
        );
        // A base's slot holds its subclass. `h` comes first, so the subclass
        // is no structural prefix match and only the base edge leads to it.
        let mut derived = layout(
            2,
            vec![field("h", held(foreign)), field("a", HirType::NUMBER)],
        );
        derived.base = Some(TypeId(1));
        assert_eq!(
            releases_foreign(
                vec![layout(1, vec![field("a", HirType::NUMBER)]), derived],
                Vec::new()
            ),
            foreign,
            "subclass edge"
        );
        // A structural prefix: an `L1 { a }` slot holds an `L2 { a, h }`.
        assert_eq!(
            releases_foreign(
                vec![
                    layout(1, vec![field("a", HirType::NUMBER)]),
                    layout(
                        2,
                        vec![field("a", HirType::NUMBER), field("h", held(foreign))]
                    ),
                ],
                Vec::new(),
            ),
            foreign,
            "prefix edge"
        );
        // An unerasure: an erased `L2 { h, w }` read back as an `L1 { w }`.
        assert_eq!(
            releases_foreign(
                vec![
                    layout(1, vec![field("w", HirType::NUMBER)]),
                    layout(
                        2,
                        vec![field("h", held(foreign)), field("w", HirType::NUMBER)]
                    ),
                ],
                vec![cast(object(2), object(1), true)],
            ),
            foreign,
            "unerasure edge"
        );
        // A promise's reactions: `L1` awaits, and `L2` is subscribed state.
        assert_eq!(
            releases_foreign(
                vec![
                    layout(
                        1,
                        vec![field(
                            "awaited",
                            HirType::Managed(ManagedType::Promise(Box::new(HirType::Void))),
                        )],
                    ),
                    layout(2, vec![field("h", held(foreign))]),
                ],
                vec![subscribe(object(2), false)],
            ),
            foreign,
            "reaction edge"
        );
    }
    // Each edge is what carries it: with the handle present but the edge
    // removed, the release reaches nothing.
    assert!(!releases_foreign(
        vec![
            layout(1, vec![field("w", HirType::NUMBER)]),
            layout(2, vec![field("h", handle()), field("w", HirType::NUMBER)]),
        ],
        Vec::new(),
    ));
    assert!(!releases_foreign(
        vec![
            layout(
                1,
                vec![field(
                    "awaited",
                    HirType::Managed(ManagedType::Promise(Box::new(HirType::Void))),
                )],
            ),
            layout(2, vec![field("h", handle())]),
            layout(3, vec![field("n", HirType::NUMBER)]),
        ],
        vec![subscribe(object(3), false)],
    ));
    // An erased field can be a handle itself; a type with no layout here can
    // be any layout, and leads to a handle exactly when some layout holds one.
    assert!(releases_foreign(
        vec![layout(1, vec![field("e", HirType::Erased)])],
        Vec::new()
    ));
    for foreign in [false, true] {
        let releases = Program {
            layouts: vec![layout(2, vec![field("h", held(foreign))])],
            ..Program::default()
        }
        .foreign_releases();
        assert_eq!(releases.release_can_reenter(&object(99)), foreign);
        assert!(!releases.release_can_reenter(&HirType::Managed(ManagedType::String)));
        assert!(releases.release_can_reenter(&HirType::Erased));
    }
}
