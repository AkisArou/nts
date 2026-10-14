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
        for (target, source) in self.cast_sources_by_scan() {
            if held.insert((target, source)) {
                subtypes[target].push(source);
            }
        }

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
                    self.reaches(&field.ty, &mut reached);
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

    fn cast_sources_by_scan(&self) -> Vec<(usize, usize)> {
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
        for to in &unerased {
            for from in &erased {
                self.cast_pairs(from, to, &mut pairs);
            }
        }
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
                count == 0 && self_reference,
                "only a base with actual closures is a signature"
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
        program.cycles();
        let steps = work();
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
        equivalent(&program);
    }
}

#[test]
fn explicit_casts_and_erased_container_pairs_keep_the_scan_answers() {
    let array = |ty| HirType::Managed(ManagedType::Array(Box::new(ty)));
    let origin = || {
        nts_semantic_schema::Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 1),
        })
    };
    for container in [false, true] {
        let wrap = |ty| if container { array(ty) } else { ty };
        for erasure in [false, true] {
            let mut values = vec![Op {
                kind: OpKind::ObjectNew { frame: false },
                ty: wrap(object(3)),
                origin: origin(),
            }];
            if erasure {
                values.push(Op {
                    kind: OpKind::Erase {
                        value: ValueId(0),
                        absent: Absent::Null,
                    },
                    ty: HirType::Erased,
                    origin: origin(),
                });
                values.push(Op {
                    kind: OpKind::Unerase { value: ValueId(1) },
                    ty: wrap(object(1)),
                    origin: origin(),
                });
            } else {
                values.push(Op {
                    kind: OpKind::Convert(ValueId(0)),
                    ty: wrap(object(1)),
                    origin: origin(),
                });
            }
            let ops = (0..values.len())
                .map(|at| ValueId(u32::try_from(at).unwrap()))
                .collect();
            let program = Program {
                layouts: vec![
                    layout(1, vec![field("wanted", HirType::NUMBER)]),
                    layout(2, vec![field("view", object(1))]),
                    layout(3, vec![field("owner", object(2))]),
                ],
                funcs: vec![Func {
                    name: "cast".into(),
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
                    initializes_receiver: false,
                    async_result: None,
                    frame: None,
                    abstract_declaration: false,
                    obligations: Vec::new(),
                    written_return: None,
                    written_return_elements: Vec::new(),
                }],
                ..Program::default()
            };
            let answer = equivalent(&program);
            assert_eq!(answer.cyclic, [false, true, true]);
            assert!(answer.array(&object(1)));
        }
    }
}
