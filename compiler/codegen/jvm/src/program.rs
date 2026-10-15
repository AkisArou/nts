//! The program this backend renders, with the facts it derives once.
//!
//! **A whole-program fact asked per descriptor has to be computed once.**
//! Whether a face is split ([`crate::split_faces`]) changes how every value of
//! it is spelled, so `types::reference_class` asks it for each object type it
//! names -- every parameter, field, frame entry and call. Answered from the
//! layouts each time, that is a scan of the program per descriptor. So the
//! answer is taken once, here, and every function of this backend is handed
//! this rather than the bare `Program`, which it dereferences to: the core's
//! questions are asked of it unchanged, and the compiler says where a fact of
//! this backend's has to reach.

use std::ops::Deref;

use nts_core::hir::{Layout, Program};
use nts_semantic_schema::TypeId;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug)]
pub struct JvmProgram<'a> {
    program: &'a Program,
    /// Every type a split face's layout holds; see [`crate::split_faces`].
    split: FxHashSet<TypeId>,
    /// Per split face, by layout index, every layout whose values it can hold:
    /// see [`Self::member`].
    members: FxHashMap<usize, FxHashSet<usize>>,
    /// Per layout, the split faces its class implements itself, in layout
    /// order: see [`Self::implemented`].
    implemented: FxHashMap<usize, Vec<usize>>,
    /// Each field family slot's declared accessor, which is what a call
    /// through the slot names; see [`Self::selector`].
    selectors: FxHashMap<u32, &'a str>,
    /// The dispatch slots some layout fills with a body; see [`Self::live`].
    live: FxHashSet<usize>,
    /// `(layout, field)` for every field some operation reads or writes by
    /// position through a value of that layout's type; see [`Self::reached`].
    positional: FxHashSet<(usize, u32)>,
    /// Each module global's static field, by global index; see
    /// [`Self::global_field`].
    global_fields: Vec<String>,
}

impl<'a> JvmProgram<'a> {
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        let selectors = program
            .interface_access
            .families
            .iter()
            .flat_map(|family| {
                std::iter::once(&family.getter)
                    .chain(family.setter.iter())
                    .chain(family.raising.iter())
            })
            .map(|entry| (entry.slot, entry.declared.as_str()))
            .collect();
        let bodies: FxHashSet<&str> = program
            .funcs
            .iter()
            .filter(|func| !func.abstract_declaration)
            .map(|func| func.name.as_str())
            .collect();
        let live = program
            .layouts
            .iter()
            .flat_map(|layout| layout.methods.iter().enumerate())
            .filter(|(_, entry)| entry.as_deref().is_some_and(|name| bodies.contains(name)))
            .map(|(slot, _)| slot)
            .collect();
        let mut facts = Self {
            program,
            split: FxHashSet::default(),
            members: FxHashMap::default(),
            implemented: FxHashMap::default(),
            selectors,
            live,
            positional: FxHashSet::default(),
            global_fields: global_fields(program),
        };
        facts.positional = facts.positional_accesses();
        facts.settle_faces();
        facts
    }

    /// Every field read or written by position through a value of its
    /// layout's type, in any function -- a family default's included, since a
    /// default reads the face's own storage.
    fn positional_accesses(&self) -> FxHashSet<(usize, u32)> {
        let program = self.program;
        let mut found = FxHashSet::default();
        for func in &program.funcs {
            for op in &func.values {
                let (nts_core::hir::OpKind::FieldGet { object, field }
                | nts_core::hir::OpKind::FieldSet { object, field, .. }) = &op.kind
                else {
                    continue;
                };
                let Some(nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id))) =
                    func.values.get(object.0 as usize).map(|value| &value.ty)
                else {
                    continue;
                };
                if let Some(at) = program.layout(*id).and_then(|layout| self.index(layout)) {
                    found.insert((at, *field));
                }
            }
        }
        found
    }

    /// Whether some operation reads or writes field `field` by position
    /// through a value of `layout`'s type. A field of a face no operation
    /// reaches that way is one no holder has to keep where the face does, and
    /// one its companion interface needs no accessor for.
    #[must_use]
    pub fn reached(&self, layout: &Layout, field: u32) -> bool {
        self.index(layout)
            .is_some_and(|at| self.positional.contains(&(at, field)))
    }

    /// Which faces split, who belongs to each, and who implements which.
    ///
    /// **A face's values are its holders' and its holders' values.** A class
    /// holding face `L`, where `L` itself flows into face `M`, is a value of
    /// `M` too, and an `invokeinterface M$Face` reaches it. So each split face's
    /// members are the closure of its direct holders through every holder that
    /// is a face, and every member class implements the companion interface
    /// itself. The companion interfaces extend none of each other: two faces
    /// that flow into each other made them extend each other, and the JVM
    /// refused every class that loaded either -- `ClassCircularityError` in
    /// `in-operator` and four runtime modules.
    fn settle_faces(&mut self) {
        let program = self.program;
        let direct: Vec<Vec<usize>> = program
            .layouts
            .iter()
            .map(|face| {
                if crate::split_faces::candidate(self, face) {
                    crate::split_faces::holders(self, face)
                        .into_iter()
                        .filter_map(|holder| self.index(holder))
                        .collect()
                } else {
                    Vec::new()
                }
            })
            .collect();
        for (at, face) in program.layouts.iter().enumerate() {
            if direct[at].is_empty() || !crate::split_faces::is_face(self, face) {
                continue;
            }
            let mut members: FxHashSet<usize> = FxHashSet::default();
            let mut queue: Vec<usize> = direct[at].clone();
            while let Some(next) = queue.pop() {
                // A holder of a holder is a member only if it can be a value
                // of *this* face: one keeping the field it reaches somewhere
                // else is not, whatever the face between them allows -- 3258
                // refusing accessor stubs when the closure did not ask.
                if next == at
                    || members.contains(&next)
                    || !crate::split_faces::can_be(self, face, &program.layouts[next])
                {
                    continue;
                }
                members.insert(next);
                queue.extend(direct[next].iter().copied());
            }
            let descends = |member: usize| {
                crate::hierarchy::ancestry(self, &program.layouts[member])
                    .iter()
                    .any(|above| std::ptr::eq(*above, face))
            };
            if crate::split_faces::eligible(self, face)
                && members.iter().any(|member| !descends(*member))
            {
                self.split.extend(face.types.iter().copied());
                self.members.insert(at, members);
            }
        }
        // Each member implements the interface itself unless its class is the
        // face's or one below it, or a class above it is a member already.
        let mut implemented: FxHashMap<usize, Vec<usize>> = FxHashMap::default();
        let mut faces: Vec<&usize> = self.members.keys().collect();
        faces.sort_unstable();
        for &face in faces {
            let set = &self.members[&face];
            for &member in set {
                let chain = crate::hierarchy::ancestry(self, &program.layouts[member]);
                let inherits = chain.iter().skip(1).any(|above| {
                    self.index(above)
                        .is_some_and(|at| at == face || set.contains(&at))
                });
                let is_face = chain.iter().any(|at| self.index(at) == Some(face));
                if !inherits && !is_face {
                    implemented.entry(member).or_default().push(face);
                }
            }
        }
        self.implemented = implemented;
    }

    /// The core's program, for a caller that needs the type itself.
    #[must_use]
    pub fn program(&self) -> &'a Program {
        self.program
    }

    /// `layout`'s index in the program's layouts, if it is one of them.
    #[must_use]
    pub fn index(&self, layout: &Layout) -> Option<usize> {
        let range = self.program.layouts.as_ptr_range();
        let at = std::ptr::from_ref(layout);
        range
            .contains(&at)
            .then(|| (at as usize - range.start as usize) / std::mem::size_of::<Layout>())
    }

    /// Whether some layout fills dispatch slot `slot` with a body: a slot that
    /// no class does is one no call reaches, since reachability keeps a body
    /// wherever a call can. A face still declares it.
    #[must_use]
    pub fn live(&self, slot: usize) -> bool {
        self.live.contains(&slot)
    }

    /// Whether `layout` is a split face.
    #[must_use]
    pub fn is_split(&self, layout: &Layout) -> bool {
        layout.types.iter().any(|id| self.split.contains(id))
    }

    /// Whether split face `face` can hold a value of `layout`: `layout` is one
    /// of its members ([`Self::settle_faces`]).
    #[must_use]
    pub fn member(&self, face: &Layout, layout: &Layout) -> bool {
        let (Some(face), Some(layout)) = (self.index(face), self.index(layout)) else {
            return false;
        };
        self.members
            .get(&face)
            .is_some_and(|members| members.contains(&layout))
    }

    /// The split faces `layout`'s class implements itself, in layout order.
    #[must_use]
    pub fn implemented(&self, layout: &Layout) -> Vec<&'a Layout> {
        let program = self.program;
        self.index(layout)
            .and_then(|at| self.implemented.get(&at))
            .map(|faces| faces.iter().map(|&at| &program.layouts[at]).collect())
            .unwrap_or_default()
    }

    /// The declared accessor of a field family's slot: the name a call through
    /// the slot carries (`Callee::Virtual`), and so the name every class's
    /// method there must have. A layout's own table holds its *row* at the
    /// slot -- `Point#nts$get$x@interface1@1` on the face itself -- and naming
    /// a method after that was a member the call never reached.
    /// The static field module global `index` is stored in.
    ///
    /// Its name mangled for the JVM (`body::method_name`), except where an
    /// earlier global mangles alike: then `<name>_<index>`, the rule properties
    /// are told apart by (`hierarchy::field_name`), with the index bumped past
    /// any global's own spelling. The mangling is not one-to-one -- every
    /// character DEX forbids becomes `$`, and so do ZWNJ and ZWJ, which an
    /// ECMAScript identifier may contain -- so test262's
    /// `identifiers/part-zwj-zwnj-escaped`, three globals `$`, `$‍` and
    /// `$‌`, declared one field three times and the class was refused.
    #[must_use]
    pub fn global_field(&self, index: usize) -> &str {
        &self.global_fields[index]
    }

    #[must_use]
    pub fn selector(&self, slot: usize) -> Option<&'a str> {
        u32::try_from(slot)
            .ok()
            .and_then(|slot| self.selectors.get(&slot).copied())
    }
}

impl Deref for JvmProgram<'_> {
    type Target = Program;

    fn deref(&self) -> &Program {
        self.program
    }
}

/// [`JvmProgram::global_field`] for every global, in index order.
///
/// **Every global's own spelling is reserved first**, so a generated name never
/// takes one -- not even a later global's. `$‍` and `$‌` both mangle
/// to `$$`, and the second became `$$_1`, which a third global spelled `$$_1`
/// then declared again. A generated name bumps its index until it is free.
/// Linear in the globals, with sets, since a runtime module has thousands.
fn global_fields(program: &Program) -> Vec<String> {
    let spelled: Vec<String> = program
        .globals
        .iter()
        .map(|global| crate::body::method_name(&global.name))
        .collect();
    let reserved: FxHashSet<&str> = spelled.iter().map(String::as_str).collect();
    let mut taken: FxHashSet<String> = FxHashSet::default();
    spelled
        .iter()
        .enumerate()
        .map(|(at, name)| {
            if taken.insert(name.clone()) {
                return name.clone();
            }
            // At most `n` spellings are reserved and `n` names taken, so one of
            // any `2n + 1` consecutive candidates is free.
            let free = (at..)
                .take(2 * spelled.len() + 1)
                .map(|index| format!("{name}_{index}"))
                .find(|candidate| {
                    !reserved.contains(candidate.as_str()) && !taken.contains(candidate)
                })
                .unwrap_or_else(|| format!("{name}_{at}"));
            taken.insert(free.clone());
            free
        })
        .collect()
}
