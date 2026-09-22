//! The instantiations a generic body makes of *other* generics, written into
//! the snapshot as the checker would have written them.
//!
//! # The gap
//!
//! A generic class is lowered once per instantiation, and an instantiation is a
//! type record the checker materialised: `Inner<number>` exists because some
//! expression has that type. Inside `class Outer<T> { make() { return new
//! Inner<T>(…) } }` the expression's type is `Inner<T>` -- a *template*, whose
//! argument is `Outer`'s parameter -- and if nothing else in the program ever
//! names `Inner<number>`, the checker never makes it. `Outer<number>`'s copy
//! then has a `new` of a class with no copies, every member of which refuses
//! as `a member of `Inner`, a class this compiler has no type for`. The web
//! platform's streams are built entirely this way: `PipeState<T>`,
//! `TeeState<T>`, `ReadableStreamAsyncIterator<T>` are made only from inside
//! `ReadableStream<T>`, and 99 sites in the census were this one gap.
//!
//! # What this does
//!
//! For every template `D<args>` whose arguments mention the parameters of an
//! enclosing generic `C` (a class or interface, or a function with pinned
//! instantiations), and for every instantiation `C<σ>` that exists, the
//! instantiation `D<σ(args)>` is materialised: a real `TypeRecord` with `D`'s
//! declared properties substituted, its bases and index signatures likewise,
//! and a `type_arguments` entry -- exactly the record the checker produces when
//! a program spells the type out. Composite types met on the way (`T[]`,
//! `(x: T) => T`, `{ value: T }`) are substituted into records of their own,
//! reusing an existing identical record where there is one.
//!
//! To a fixpoint, because a materialised `D<number>` is itself an
//! instantiation whose body has templates. Then everything downstream --
//! `instantiations`, the hierarchy, layouts, the copies -- sees the new
//! records as it sees the checker's, and nothing there has to know.
//!
//! # And how a copy finds them
//!
//! The bodies are shared: the `new Inner<T>` node still has type `Inner<T>`.
//! A copy's `Substitution` carries, beside each parameter's representation,
//! the map from each template it contains to the instantiation it makes of it
//! -- [`Templates::instances`], the same lookup this module used to decide
//! what to create, run once more without creating -- and `representation_of`
//! answers the instantiation's id for the template's. That is the one place
//! the lowering learns of any of this.
//!
//! # What is bounded
//!
//! Polymorphic recursion -- `class Node<T> { next: Node<Node<T>> }` -- has no
//! finite set of instantiations. Substitution stops at a nesting depth of
//! [`DEPTH`], materialisation at [`BUDGET`] new records and [`ROUNDS`]
//! rounds, and an instantiation whose arguments still mention a parameter is
//! never made; past any of those the template keeps the refusal it has today.

use nts_semantic_schema::{
    IndexSignature, NodeId, NodeKind, PropertyRecord, SemanticSnapshot, SignatureId,
    SignatureRecord, SymbolId, TypeId, TypeKind, TypeRecord, syntax,
};
use rustc_hash::FxHashMap;
use std::collections::BTreeMap;

/// How deep into a type's structure substitution follows before giving up on
/// a template: the nesting of `Node<Node<Node<T>>>`, not the size of the
/// program.
const DEPTH: u32 = 12;
/// How many records one materialisation may add.
const BUDGET: usize = 20_000;
/// How many rounds the fixpoint runs; each round materialises everything the
/// last one made reachable, so this bounds template nesting across classes.
const ROUNDS: usize = 8;

/// What an instantiation binds each type parameter to, by id.
pub type Sigma = BTreeMap<TypeId, TypeId>;

/// What a substitution walk has already answered: a type under a sigma.
type Memo = FxHashMap<(TypeId, Vec<(TypeId, TypeId)>), Option<TypeId>>;

/// The generic that declares a type parameter.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Owner {
    /// A class or interface, by the symbol that declares it.
    Type(SymbolId),
    /// A function or method, by its declaration node.
    Function(NodeId),
}

/// Materialise every instantiation a generic body implies. `None` when the
/// snapshot already holds them all -- the common case, and the one where a
/// clone of the snapshot would buy nothing.
#[must_use]
pub fn materialise(snapshot: &SemanticSnapshot) -> Option<SemanticSnapshot> {
    let mut owned: Option<SemanticSnapshot> = None;
    for _ in 0..ROUNDS {
        let current = owned.as_ref().unwrap_or(snapshot);
        let templates = Templates::new(current);
        let plan = templates.plan();
        let bases = templates.bases_to_settle();
        if plan.is_empty() && bases.is_empty() {
            break;
        }
        let mut next = current.clone();
        let (created, settled) = {
            let mut writer = Writer::new(&mut next, templates.index, templates.declarations);
            for (template, sigma) in plan {
                if writer.created >= BUDGET {
                    break;
                }
                let _ = substitute(&mut writer, template, &sigma, 0);
            }
            let settled = writer.settle_bases(&bases);
            (writer.created, settled)
        };
        if created == 0 && settled == 0 {
            break;
        }
        owned = Some(next);
    }
    owned
}

/// The sigma a class instantiation binds: the declaration's own parameters to
/// the instantiation's arguments.
#[must_use]
pub fn sigma_of_instance(snapshot: &SemanticSnapshot, declaration: TypeId, instance: TypeId) -> Sigma {
    let parameters = arguments(snapshot, declaration);
    let concrete = arguments(snapshot, instance);
    parameters.into_iter().zip(concrete).collect()
}

/// The generics of a snapshot, as the materialiser and the copies read them:
/// which records are declarations, which are templates and of whose
/// parameters, and where every `(symbol, arguments)` lives. Built once per
/// snapshot.
#[derive(Debug)]
pub struct Templates<'a> {
    snapshot: &'a SemanticSnapshot,
    /// `(symbol, arguments)` -> the record with them: the instantiations that
    /// exist, and the declarations (whose arguments are their own parameters).
    index: FxHashMap<(SymbolId, Vec<TypeId>), TypeId>,
    /// Each generic's declaration record, the one whose arguments are its own
    /// parameters, by symbol.
    declarations: FxHashMap<SymbolId, TypeId>,
    /// The templates -- records with arguments that mention exactly one other
    /// generic's parameters -- by that generic.
    by_owner: FxHashMap<Owner, Vec<TypeId>>,
    /// Which generic declares each type parameter.
    owners: FxHashMap<TypeId, Owner>,
}

impl<'a> Templates<'a> {
    #[must_use]
    pub fn new(snapshot: &'a SemanticSnapshot) -> Self {
        let owners = parameter_owners(snapshot);
        let mut index = FxHashMap::default();
        let mut declarations = FxHashMap::default();
        for (at, record) in snapshot.types.iter().enumerate() {
            let ty = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
            let Some(symbol) = record.symbol else {
                continue;
            };
            let args = arguments(snapshot, ty);
            if args.is_empty() {
                continue;
            }
            // The declaration: every argument is one of its own parameters.
            // Its own -- a method returning `Entry<V, K>` also has all-
            // parameter arguments, and so does `Inner<T>` written inside
            // `Outer<T>`, which is exactly a template.
            if args.iter().all(|arg| owners.get(arg) == Some(&Owner::Type(symbol))) {
                declarations.entry(symbol).or_insert(ty);
            }
            index.entry((symbol, args)).or_insert(ty);
        }
        let mut templates: FxHashMap<Owner, Vec<TypeId>> = FxHashMap::default();
        for (at, record) in snapshot.types.iter().enumerate() {
            let ty = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
            let Some(symbol) = record.symbol else {
                continue;
            };
            if !declarations.contains_key(&symbol) {
                continue;
            }
            let args = arguments(snapshot, ty);
            if args.is_empty() {
                continue;
            }
            let mut mentioned = Vec::new();
            for arg in &args {
                parameters_in(snapshot, *arg, &mut mentioned, 0);
            }
            let mentioned: Vec<Owner> = mentioned
                .iter()
                .filter_map(|parameter| owners.get(parameter).copied())
                .collect();
            // Two owners at once -- a generic method's parameter beside its
            // class's -- is left alone. A template of its *own* owner stays:
            // `next: Link<T> | null` inside `Link<T>` is the form itself, which
            // a copy over `number` must read as `Link<number>` -- the instance
            // it is -- or the field initialiser stores the form's id where the
            // instance's is wanted, a pointer cast between two `Link`s.
            let Some(&owner) = mentioned.first() else {
                continue;
            };
            if mentioned.iter().any(|it| *it != owner) {
                continue;
            }
            templates.entry(owner).or_default().push(ty);
        }
        for list in templates.values_mut() {
            list.sort_by_key(|ty| ty.0);
            list.dedup();
        }
        Self {
            snapshot,
            index,
            declarations,
            by_owner: templates,
            owners,
        }
    }

    /// Every instantiation of the generic that declares `parameter`, with what
    /// that parameter is bound to in each.
    ///
    /// The question a *call* inside a generic body asks: `extractSize(strategy)`
    /// written in `WritableStream<W>` pins the callee's `T` to `W`, which is
    /// not a type anything can be compiled for -- but `W` is `number` in one
    /// copy of the class and `Uint8Array` in another, and those are.
    ///
    /// Only a class or interface parameter. A *function*'s parameter is bound
    /// by its own call sites, which is the mechanism this one is an extension
    /// of rather than a case of.
    #[must_use]
    pub fn bindings_of(&self, parameter: TypeId) -> Vec<(TypeId, TypeId)> {
        let Some(Owner::Type(symbol)) = self.owners.get(&parameter).copied() else {
            return Vec::new();
        };
        let Some(&declaration) = self.declarations.get(&symbol) else {
            return Vec::new();
        };
        let parameters = arguments(self.snapshot, declaration);
        let Some(at) = parameters.iter().position(|p| *p == parameter) else {
            return Vec::new();
        };
        let mut found: Vec<(TypeId, TypeId)> = self
            .index
            .iter()
            .filter(|((of, args), ty)| {
                *of == symbol && **ty != declaration && args.len() == parameters.len()
            })
            .filter_map(|((_, args), ty)| {
                let bound = *args.get(at)?;
                (!mentions_a_parameter(self.snapshot, bound)).then_some((*ty, bound))
            })
            .collect();
        // Sorted, so one compiler on one input makes the copies in one order.
        found.sort();
        found.dedup();
        found
    }

    /// The templates a copy of `owner` under `sigma` resolves, each to the
    /// instantiation it makes of it -- by lookup only; [`materialise`] has
    /// already made every record this can name.
    #[must_use]
    pub fn instances(&self, owner: Owner, sigma: &Sigma) -> FxHashMap<TypeId, TypeId> {
        let mut found = FxHashMap::default();
        let mut lookup = Lookup::new(self);
        for template in self.by_owner.get(&owner).into_iter().flatten() {
            if let Some(instance) = substitute(&mut lookup, *template, sigma, 0)
                && instance != *template
            {
                found.insert(*template, instance);
            }
        }
        found
    }

    /// What to materialise this round: each template, under each sigma of
    /// its owner's instantiations, where the result does not exist yet.
    fn plan(&self) -> Vec<(TypeId, Sigma)> {
        let functions = super::generics::function_instantiations(self.snapshot);
        let mut plan = Vec::new();
        let mut owners: Vec<Owner> = self.by_owner.keys().copied().collect();
        owners.sort_by_key(|owner| match owner {
            Owner::Type(symbol) => (0, symbol.0),
            Owner::Function(node) => (1, node.0),
        });
        // One walk for the whole plan: its memo is keyed by the sigma as well
        // as the type, so an answer is reusable across owners and sigmas alike.
        let mut lookup = Lookup::new(self);
        for owner in owners {
            for sigma in self.sigmas_of(owner, &functions) {
                for template in self.by_owner.get(&owner).into_iter().flatten() {
                    if substitute(&mut lookup, *template, &sigma, 0).is_none() {
                        plan.push((*template, sigma.clone()));
                    }
                }
            }
        }
        plan
    }

    /// The instantiations whose base is still written as the form's -- the
    /// checker records `Derived<number>`'s base as `Base<T, this>`, the
    /// declaration's, and never makes `Base<number>` -- each with its sigma,
    /// so the writer can substitute the base and make what it names.
    fn bases_to_settle(&self) -> Vec<(TypeId, Sigma)> {
        let mut settle = Vec::new();
        for ((symbol, args), &ty) in &self.index {
            let Some(&declaration) = self.declarations.get(symbol) else {
                continue;
            };
            if ty == declaration || args.iter().any(|arg| mentions_a_parameter(self.snapshot, *arg)) {
                continue;
            }
            // The instance's own entry, or -- as `collect_hierarchy` falls
            // back -- the declaration's, which is the form's base and mentions
            // its parameters by construction.
            let Some(bases) = self
                .snapshot
                .base_types
                .get(&ty)
                .or_else(|| self.snapshot.base_types.get(&declaration))
            else {
                continue;
            };
            if bases.iter().any(|base| mentions_a_parameter(self.snapshot, *base)) {
                settle.push((ty, sigma_of_instance(self.snapshot, declaration, ty)));
            }
        }
        settle.sort();
        settle
    }

    /// Every sigma an owner's instantiations bind, with no parameter left in
    /// any binding.
    fn sigmas_of(&self, owner: Owner, functions: &super::generics::GenericFunctions) -> Vec<Sigma> {
        let mut sigmas: Vec<Sigma> = match owner {
            Owner::Type(symbol) => {
                let Some(&declaration) = self.declarations.get(&symbol) else {
                    return Vec::new();
                };
                let parameters = arguments(self.snapshot, declaration);
                self.index
                    .iter()
                    .filter(|((of, args), ty)| {
                        *of == symbol && **ty != declaration && args.len() == parameters.len()
                    })
                    .map(|((_, args), _)| parameters.iter().copied().zip(args.iter().copied()).collect())
                    .collect()
            }
            Owner::Function(declaration) => functions
                .copies
                .get(&declaration)
                .into_iter()
                .flatten()
                .map(|copy| copy.sources.iter().map(|(k, v)| (*k, *v)).collect())
                .collect(),
        };
        sigmas.retain(|sigma: &Sigma| {
            !sigma
                .values()
                .any(|bound| mentions_a_parameter(self.snapshot, *bound))
        });
        sigmas.sort();
        sigmas.dedup();
        sigmas
    }
}
/// One substitution walk, over a snapshot that either answers or grows.
///
/// Substituting a sigma into a type is one rule -- an array of `T` is an array
/// of what `T` is bound to, a `D<T>` is `D<that>` -- and the two callers differ
/// in one thing: what to do when the record the answer names does not exist.
/// [`materialise`] makes it; a copy looking one up cannot, because by then the
/// snapshot is read-only and everything it can name has already been made.
///
/// Written twice they could disagree, and the disagreement would be silent:
/// the materialiser would create `Inner<number>` and the copy would ask for
/// something else, find nothing, and refuse -- which is exactly the gap this
/// module exists to close, reappearing as a bug in its fix.
trait Site {
    fn snapshot(&self) -> &SemanticSnapshot;
    /// What this walk has already answered, so a type graph that reaches
    /// itself is walked once.
    fn memo(&mut self) -> &mut Memo;
    /// Whether there is room to go on: the nesting of a template, and for the
    /// writer the number of records it may still add.
    fn may_continue(&self, depth: u32) -> bool;
    /// The id of a composite -- an array, a union, a substituted literal --
    /// with this shape.
    fn composite(&mut self, wanted: TypeKind, symbol: Option<SymbolId>) -> Option<TypeId>;
    /// The id of the instantiation `D<args>`, where `D` is `declaration`.
    fn instance(
        &mut self,
        symbol: SymbolId,
        declaration: TypeId,
        args: Vec<TypeId>,
        depth: u32,
    ) -> Option<TypeId>;
    /// The id of a signature with this shape.
    fn signature(&mut self, wanted: SignatureRecord) -> Option<SignatureId>;
    /// Where the declaration of each generic symbol is.
    fn declarations(&self) -> &FxHashMap<SymbolId, TypeId>;
}

fn substitute_all(site: &mut impl Site, types: &[TypeId], sigma: &Sigma, depth: u32) -> Option<Vec<TypeId>> {
    types.iter().map(|ty| substitute(site, *ty, sigma, depth)).collect()
}

/// The id `ty` has under `sigma`, or `None` where this site cannot name one.
fn substitute(site: &mut impl Site, ty: TypeId, sigma: &Sigma, depth: u32) -> Option<TypeId> {
    if depth > DEPTH || !site.may_continue(depth) {
        return None;
    }
    if let Some(&bound) = sigma.get(&ty) {
        return Some(bound);
    }
    // Nothing to substitute: the type is already what it will be, whatever the
    // sigma says. This is what stops the walk at every concrete leaf.
    if !mentions_a_parameter(site.snapshot(), ty) {
        return Some(ty);
    }
    let key = (ty, sigma.iter().map(|(k, v)| (*k, *v)).collect());
    if let Some(known) = site.memo().get(&key) {
        return *known;
    }
    let answer = substitute_kind(site, ty, sigma, depth);
    site.memo().insert(key, answer);
    answer
}

fn substitute_kind(site: &mut impl Site, ty: TypeId, sigma: &Sigma, depth: u32) -> Option<TypeId> {
    // Cloned rather than borrowed because the walk below asks the site for
    // records, and the writing site holds the snapshot mutably.
    let record = site.snapshot().types.get(ty.0 as usize)?.clone();
    let wanted = match &record.kind {
        TypeKind::Object { properties } => {
            // A template of a generic this program declares -- `Inner<T>` --
            // is the *instantiation* `Inner<σ(T)>`, not a fresh object with
            // substituted members: it has a symbol, a hierarchy and copies of
            // its own, and an anonymous twin of it would have none of them.
            if let Some(symbol) = record.symbol
                && let Some(&declaration) = site.declarations().get(&symbol)
            {
                let args = instantiation_arguments(site.snapshot(), ty, declaration);
                let args = substitute_all(site, &args, sigma, depth + 1)?;
                // A binding that is itself a parameter leaves the result a
                // template, and a template is not something to materialise.
                if args.iter().any(|arg| mentions_a_parameter(site.snapshot(), *arg)) {
                    return None;
                }
                return site.instance(symbol, declaration, args, depth + 1);
            }
            TypeKind::Object {
                properties: substitute_properties(site, properties, sigma, depth + 1)?,
            }
        }
        TypeKind::Array(element) => TypeKind::Array(substitute(site, *element, sigma, depth + 1)?),
        TypeKind::Tuple(items) => TypeKind::Tuple(substitute_all(site, items, sigma, depth + 1)?),
        TypeKind::Union(items) => TypeKind::Union(substitute_all(site, items, sigma, depth + 1)?),
        TypeKind::Intersection(items) => {
            TypeKind::Intersection(substitute_all(site, items, sigma, depth + 1)?)
        }
        TypeKind::Function(signature) => {
            let signature = site.snapshot().signatures.get(signature.0 as usize)?.clone();
            let substituted = substitute_signature(&signature, depth + 1, &mut |ty, depth| {
                substitute(site, ty, sigma, depth)
            })?;
            TypeKind::Function(site.signature(substituted)?)
        }
        // A parameter bound by no sigma, a conditional, a mapped type: this
        // walk has nothing to say, and saying nothing leaves the refusal the
        // template already had.
        _ => return None,
    };
    site.composite(wanted, record.symbol)
}

fn substitute_properties(
    site: &mut impl Site,
    properties: &[PropertyRecord],
    sigma: &Sigma,
    depth: u32,
) -> Option<Vec<PropertyRecord>> {
    properties
        .iter()
        .map(|property| {
            Some(PropertyRecord {
                ty: substitute(site, property.ty, sigma, depth)?,
                ..property.clone()
            })
        })
        .collect()
}

/// The site that only answers: the id a type has under a sigma, where every
/// record it needs already exists. `None` where one does not.
struct Lookup<'t, 'a> {
    templates: &'t Templates<'a>,
    memo: Memo,
}

impl<'t, 'a> Lookup<'t, 'a> {
    fn new(templates: &'t Templates<'a>) -> Self {
        Self {
            templates,
            memo: FxHashMap::default(),
        }
    }
}

impl Site for Lookup<'_, '_> {
    fn snapshot(&self) -> &SemanticSnapshot {
        self.templates.snapshot
    }

    fn memo(&mut self) -> &mut Memo {
        &mut self.memo
    }

    fn may_continue(&self, _depth: u32) -> bool {
        true
    }

    fn composite(&mut self, wanted: TypeKind, symbol: Option<SymbolId>) -> Option<TypeId> {
        find_record(self.templates.snapshot, &wanted, symbol)
    }

    fn instance(
        &mut self,
        symbol: SymbolId,
        _declaration: TypeId,
        args: Vec<TypeId>,
        _depth: u32,
    ) -> Option<TypeId> {
        self.templates.index.get(&(symbol, args)).copied()
    }

    fn signature(&mut self, wanted: SignatureRecord) -> Option<SignatureId> {
        find_signature(self.templates.snapshot, &wanted)
    }

    fn declarations(&self) -> &FxHashMap<SymbolId, TypeId> {
        &self.templates.declarations
    }
}

/// The site that creates: the same walk, appending the records that do not
/// exist.
struct Writer<'s> {
    snapshot: &'s mut SemanticSnapshot,
    index: FxHashMap<(SymbolId, Vec<TypeId>), TypeId>,
    declarations: FxHashMap<SymbolId, TypeId>,
    memo: Memo,
    created: usize,
}

impl<'s> Writer<'s> {
    fn new(
        snapshot: &'s mut SemanticSnapshot,
        index: FxHashMap<(SymbolId, Vec<TypeId>), TypeId>,
        declarations: FxHashMap<SymbolId, TypeId>,
    ) -> Self {
        Self {
            snapshot,
            index,
            declarations,
            memo: FxHashMap::default(),
            created: 0,
        }
    }

    /// Rewrite each listed instantiation's bases under its sigma, making the
    /// base instantiations that do not exist. How many entries changed.
    fn settle_bases(&mut self, settle: &[(TypeId, Sigma)]) -> usize {
        let mut changed = 0;
        for (ty, sigma) in settle {
            let declaration = self
                .snapshot
                .types
                .get(ty.0 as usize)
                .and_then(|record| record.symbol)
                .and_then(|symbol| self.declarations.get(&symbol).copied());
            let Some(bases) = self
                .snapshot
                .base_types
                .get(ty)
                .or_else(|| declaration.and_then(|declaration| self.snapshot.base_types.get(&declaration)))
                .cloned()
            else {
                continue;
            };
            let settled: Vec<TypeId> = bases
                .iter()
                .map(|base| substitute(self, *base, sigma, 0).unwrap_or(*base))
                .collect();
            if self.snapshot.base_types.get(ty) != Some(&settled) {
                self.snapshot.base_types.insert(*ty, settled);
                changed += 1;
            }
        }
        changed
    }

    fn push(&mut self, record: TypeRecord) -> TypeId {
        self.snapshot.types.push(record);
        self.created += 1;
        TypeId(u32::try_from(self.snapshot.types.len() - 1).unwrap_or(u32::MAX))
    }
}

impl Site for Writer<'_> {
    fn snapshot(&self) -> &SemanticSnapshot {
        self.snapshot
    }

    fn memo(&mut self) -> &mut Memo {
        &mut self.memo
    }

    fn may_continue(&self, _depth: u32) -> bool {
        self.created < BUDGET
    }

    fn composite(&mut self, wanted: TypeKind, symbol: Option<SymbolId>) -> Option<TypeId> {
        if let Some(found) = find_record(self.snapshot, &wanted, symbol) {
            return Some(found);
        }
        Some(self.push(TypeRecord { kind: wanted, symbol }))
    }

    /// `D<args>`: the record with those arguments, made if it does not exist.
    ///
    /// Registered in the index **before** its properties are substituted, so
    /// a class that mentions itself -- `next: Node<T> | null` -- finds the
    /// record it is in the middle of making rather than making it again.
    fn instance(
        &mut self,
        symbol: SymbolId,
        declaration: TypeId,
        args: Vec<TypeId>,
        depth: u32,
    ) -> Option<TypeId> {
        if let Some(&known) = self.index.get(&(symbol, args.clone())) {
            return Some(known);
        }
        let id = self.push(TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new(),
            },
            symbol: Some(symbol),
        });
        self.snapshot.type_arguments.insert(id, args.clone());
        self.index.insert((symbol, args.clone()), id);

        let own: Sigma = arguments(self.snapshot, declaration).into_iter().zip(args).collect();
        let Some(TypeKind::Object { properties }) =
            self.snapshot.types.get(declaration.0 as usize).map(|record| record.kind.clone())
        else {
            return Some(id);
        };
        // **A property whose type cannot be substituted is left out.** It
        // used to keep the declaration's type, on the reasoning that a
        // refusal at its use beats a member gone missing -- and that
        // reasoning was wrong about which of the two it produced. The
        // declaration's type for `stream: WritableStreamState<T>` is the
        // *form*, which has a layout of its own, so the instance carried a
        // field typed `WritableStreamState<T>` while every reader of it
        // substituted to `WritableStreamState<Uint8Array>`: the backend wrote
        // `v2 = v1->stream` between two unrelated structs and clang refused
        // the C. Nine lines of three node modules, and it is the exact defect
        // this module exists to remove, reintroduced by its own fallback.
        //
        // A concrete type is kept, because substituting it is the identity.
        // What is dropped is a member whose type still mentions a parameter,
        // and dropping it is the missing member -- which refuses by name at
        // its use rather than lowering to a cast.
        let properties: Vec<PropertyRecord> = properties
            .iter()
            .filter_map(|property| {
                let ty = substitute(self, property.ty, &own, depth).or_else(|| {
                    (!mentions_a_parameter(self.snapshot, property.ty)).then_some(property.ty)
                })?;
                Some(PropertyRecord { ty, ..property.clone() })
            })
            .collect();
        if let Some(record) = self.snapshot.types.get_mut(id.0 as usize) {
            record.kind = TypeKind::Object { properties };
        }
        if let Some(bases) = self.snapshot.base_types.get(&declaration).cloned() {
            // A base that cannot be substituted is dropped for the reason
            // the properties are: the declaration's base is the form's, and
            // an instance inheriting a form is the same cast one level up.
            let bases: Vec<TypeId> = bases
                .into_iter()
                .filter_map(|base| {
                    substitute(self, base, &own, depth).or_else(|| {
                        (!mentions_a_parameter(self.snapshot, base)).then_some(base)
                    })
                })
                .collect();
            self.snapshot.base_types.insert(id, bases);
        }
        if let Some(signatures) = self.snapshot.index_signatures.get(&declaration).cloned() {
            let signatures: Vec<IndexSignature> = signatures
                .into_iter()
                .filter_map(|signature| {
                    Some(IndexSignature {
                        key: substitute(self, signature.key, &own, depth)?,
                        value: substitute(self, signature.value, &own, depth)?,
                        ..signature
                    })
                })
                .collect();
            self.snapshot.index_signatures.insert(id, signatures);
        }
        Some(id)
    }

    fn signature(&mut self, wanted: SignatureRecord) -> Option<SignatureId> {
        if let Some(found) = find_signature(self.snapshot, &wanted) {
            return Some(found);
        }
        self.snapshot.signatures.push(wanted);
        Some(SignatureId(
            u32::try_from(self.snapshot.signatures.len() - 1).unwrap_or(u32::MAX),
        ))
    }

    fn declarations(&self) -> &FxHashMap<SymbolId, TypeId> {
        &self.declarations
    }
}

/// A signature with every type in it substituted, by whichever walk is asking.
fn substitute_signature(
    signature: &SignatureRecord,
    depth: u32,
    substitute: &mut dyn FnMut(TypeId, u32) -> Option<TypeId>,
) -> Option<SignatureRecord> {
    let mut substituted = signature.clone();
    for parameter in &mut substituted.parameters {
        parameter.ty = substitute(parameter.ty, depth)?;
    }
    substituted.return_type = substitute(signature.return_type, depth)?;
    if let Some(predicate) = &mut substituted.type_predicate
        && let Some(narrowed) = predicate.narrowed_to
    {
        predicate.narrowed_to = Some(substitute(narrowed, depth)?);
    }
    Some(substituted)
}

/// Each type parameter's owner: the class, interface or function whose
/// declaration its own declaration sits in.
fn parameter_owners(snapshot: &SemanticSnapshot) -> FxHashMap<TypeId, Owner> {
    let mut owners = FxHashMap::default();
    for (at, record) in snapshot.types.iter().enumerate() {
        if !matches!(record.kind, TypeKind::TypeParameter { .. }) {
            continue;
        }
        let ty = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
        let Some(symbol) = record.symbol else {
            continue;
        };
        let Some(declaration) = snapshot
            .symbols
            .get(symbol.0 as usize)
            .and_then(|symbol| symbol.declarations.first().copied())
        else {
            continue;
        };
        // Past the list the parameters sit in: the encoder puts a
        // declaration's type parameters in a node list, so the parent of
        // `T` is not the class but the list, whose parent is.
        let mut parent = snapshot
            .nodes
            .get(declaration.0 as usize)
            .and_then(|node| node.parent);
        while let Some(at) = parent
            && snapshot.nodes.get(at.0 as usize).is_some_and(|node| node.kind == NodeKind::List)
        {
            parent = snapshot.nodes[at.0 as usize].parent;
        }
        let Some(parent) = parent else {
            continue;
        };
        let Some(node) = snapshot.nodes.get(parent.0 as usize) else {
            continue;
        };
        // A declaration's symbol is on its name, not on the declaration node
        // -- `generic_classes` reads it the same way.
        let named = || {
            node.children.iter().find_map(|child| {
                let child = snapshot.nodes.get(child.0 as usize)?;
                (child.kind == NodeKind::Syntax(syntax::IDENTIFIER)).then_some(child.symbol)?
            })
        };
        let owner = match node.kind {
            NodeKind::Syntax(
                syntax::CLASS_DECLARATION
                | syntax::CLASS_EXPRESSION
                | syntax::INTERFACE_DECLARATION
                | syntax::TYPE_ALIAS_DECLARATION,
            ) => node.symbol.or_else(named).map(Owner::Type),
            NodeKind::Syntax(
                syntax::FUNCTION_DECLARATION
                | syntax::FUNCTION_EXPRESSION
                | syntax::ARROW_FUNCTION
                | syntax::METHOD_DECLARATION,
            ) => Some(Owner::Function(parent)),
            _ => None,
        };
        if let Some(owner) = owner {
            owners.insert(ty, owner);
        }
    }
    owners
}

fn arguments(snapshot: &SemanticSnapshot, ty: TypeId) -> Vec<TypeId> {
    snapshot.type_arguments.get(&ty).cloned().unwrap_or_default()
}

/// An instantiation's arguments, as many as the declaration has parameters.
///
/// The checker writes a class's base as `Base<T, this>`: the `this` type
/// appended after the declared parameters. It is a parameter nothing binds,
/// so an instantiation carrying it could never be made, and a derived class's
/// base kept the form's -- `Derived<number>` extending `Base<T>`, whose
/// `value: T` then had no representation. Truncated to the declaration's
/// arity, `Base<T, this>` under `T := number` is `Base<number>`.
fn instantiation_arguments(snapshot: &SemanticSnapshot, ty: TypeId, declaration: TypeId) -> Vec<TypeId> {
    let mut args = arguments(snapshot, ty);
    args.truncate(arguments(snapshot, declaration).len());
    args
}

/// The type parameters a type mentions, through arrays, unions, tuples,
/// functions and instantiations.
fn parameters_in(snapshot: &SemanticSnapshot, ty: TypeId, into: &mut Vec<TypeId>, depth: u32) {
    if depth > DEPTH {
        return;
    }
    match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::TypeParameter { .. }) => {
            if !into.contains(&ty) {
                into.push(ty);
            }
        }
        Some(TypeKind::Array(element)) => parameters_in(snapshot, *element, into, depth + 1),
        Some(TypeKind::Tuple(items) | TypeKind::Union(items) | TypeKind::Intersection(items)) => {
            for item in items {
                parameters_in(snapshot, *item, into, depth + 1);
            }
        }
        Some(TypeKind::Function(signature)) => {
            if let Some(signature) = snapshot.signatures.get(signature.0 as usize) {
                for parameter in &signature.parameters {
                    parameters_in(snapshot, parameter.ty, into, depth + 1);
                }
                parameters_in(snapshot, signature.return_type, into, depth + 1);
            }
        }
        // **Whatever its kind, a type's arguments are part of it.** This was
        // an `Object` arm, and a form the frontend left a placeholder is
        // `Structured` -- so `WritableWriterState<W>` written inside
        // `WritableStreamState<W>` mentioned no parameter as far as this
        // could tell, was taken for a concrete type, and was never
        // instantiated. Its readers substituted and its layout did not.
        _ => {
            for arg in arguments(snapshot, ty) {
                parameters_in(snapshot, arg, into, depth + 1);
            }
        }
    }
}

fn mentions_a_parameter(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let mut found = Vec::new();
    parameters_in(snapshot, ty, &mut found, 0);
    !found.is_empty()
}

/// An existing record equal to `wanted`, with the same declaring symbol.
fn find_record(snapshot: &SemanticSnapshot, wanted: &TypeKind, symbol: Option<SymbolId>) -> Option<TypeId> {
    snapshot
        .types
        .iter()
        .position(|record| record.symbol == symbol && record.kind == *wanted)
        .map(|at| TypeId(u32::try_from(at).unwrap_or(u32::MAX)))
}

fn find_signature(snapshot: &SemanticSnapshot, wanted: &SignatureRecord) -> Option<SignatureId> {
    snapshot
        .signatures
        .iter()
        .position(|signature| signature == wanted)
        .map(|at| SignatureId(u32::try_from(at).unwrap_or(u32::MAX)))
}
