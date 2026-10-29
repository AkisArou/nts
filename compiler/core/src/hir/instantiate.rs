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
use rustc_hash::{FxHashMap, FxHashSet};
use std::cell::{OnceCell, RefCell};
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
pub fn sigma_of_instance(
    snapshot: &SemanticSnapshot,
    declaration: TypeId,
    instance: TypeId,
) -> Sigma {
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
    /// Function types mentioning exactly one owner's type parameters, by owner.
    ///
    /// **A second list because a function type cannot be a template.**
    /// `by_owner` holds *instantiations of a generic declaration* -- `Link<T>`,
    /// `Inner<T>` inside `Outer<T>` -- recognised by having a `symbol` and type
    /// `arguments`. An anonymous `(seed: U) => T` has neither, so it fails both
    /// tests and is never collected, and widening what counts as a template
    /// would change the machinery every class instantiation runs through.
    ///
    /// What it costs to leave out: a copy's parameter keeps `U -> T` while the
    /// call site's argument is typed at the instantiated signature, and only one
    /// of the two has a layout. `apply<number, string>(1, "s")` with the optional
    /// `map` omitted gave `NTS2006 an object type with no layout`, because the
    /// absent argument is pushed straight as `ConstUndefined` at the call's type
    /// with no `coerce` to reconcile it -- a *written* argument is fixed on the
    /// way in, which is why the same call with `map` supplied compiles. That is
    /// the root of React's component chain: every compiled component segfaulted
    /// through the empty table of a closure whose `#call` this refusal had
    /// dropped.
    ///
    /// These are **not** added to `plan()`, so `materialise` is never asked to
    /// invent one: the instantiated form already exists, because the checker made
    /// it when the call wrote its type arguments. Where it genuinely does not,
    /// `substitute` answers `None`, nothing is recorded, and the behaviour is
    /// what it was.
    function_forms: FxHashMap<Owner, Vec<TypeId>>,
    /// Composite types a recorded call needs in a concrete generic function.
    /// These roots can be absent even when that caller has a real copy: the
    /// checker records `Action<S>`, not every `Action<number>` its copies need.
    /// Separate from the lookup-only function forms so a declaration's entire
    /// signature is never materialised merely because it is generic.
    required_call_forms: OnceCell<FxHashMap<Owner, Vec<TypeId>>>,
    /// Which generic declares each type parameter.
    owners: FxHashMap<TypeId, Owner>,
    /// Built on the first composite lookup and reused by every local walk.
    lookup_index: OnceCell<LookupIndex>,
    /// Only complete root queries are cached; nested depth limits remain local.
    resolved: RefCell<Memo>,
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
            if args
                .iter()
                .all(|arg| owners.get(arg) == Some(&Owner::Type(symbol)))
            {
                declarations.entry(symbol).or_insert(ty);
            }
            index.entry((symbol, args)).or_insert(ty);
        }
        let mut templates: FxHashMap<Owner, Vec<TypeId>> = FxHashMap::default();
        let mut function_forms: FxHashMap<Owner, Vec<TypeId>> = FxHashMap::default();
        for (at, record) in snapshot.types.iter().enumerate() {
            let ty = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
            // In this loop rather than a second pass over the type table: it
            // already walks every record, and a snapshot holds a hundred
            // thousand of them. Before the `symbol` gate below, which a function
            // type -- being anonymous -- never passes. See `function_forms`.
            // **A generic function's forms only, not a generic class's.** The
            // broad version was measured and is not landable: over the runtime
            // corpus it made `Timeout<N>#invoke` a **phantom** in five projects
            // -- recorded as refused while the program emits it -- and gave
            // `Timeout#invoke` a refusal row of its own. `Timeout` is a generic
            // *class* with a callback field mentioning its parameter, so mapping
            // that form to an instance changed which name its member is recorded
            // under, which is `8482afb63`'s family: a member emitted as one name
            // and recorded as another.
            //
            // A class already has the whole template mechanism for this --
            // `by_owner` collects its instantiations and `materialise` makes
            // them, which is why `Link<T>`'s field reads as `Link<number>` in a
            // copy. What has no mechanism is a generic **function**'s
            // function-typed parameter, which is the case this exists for and
            // the only one with a witness.
            if matches!(record.kind, TypeKind::Function(_))
                && let Some(owner @ Owner::Function(_)) = one_owner_of(snapshot, &owners, ty)
            {
                function_forms.entry(owner).or_default().push(ty);
            }
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
                parameters_in(snapshot, *arg, &mut mentioned);
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
        for list in templates.values_mut().chain(function_forms.values_mut()) {
            list.sort_by_key(|ty| ty.0);
            list.dedup();
        }
        Self {
            snapshot,
            index,
            declarations,
            by_owner: templates,
            function_forms,
            required_call_forms: OnceCell::new(),
            owners,
            lookup_index: OnceCell::new(),
            resolved: RefCell::new(FxHashMap::default()),
        }
    }

    /// The single generic whose parameters `ty` mentions.
    ///
    /// Asked by the caller of [`Self::bindings_of`], which answers for a class
    /// and deliberately not for a function: the two are found in different
    /// places -- a class's instantiations are types and a function's are copies
    /// keyed by a suffix -- and the caller has to know which question it is
    /// asking before it asks.
    #[must_use]
    pub fn owner_of(&self, ty: TypeId) -> Option<Owner> {
        one_owner_of(self.snapshot, &self.owners, ty)
    }

    /// Resolve a type under a caller's concrete bindings, by the same lookup
    /// used for its templates. A nested argument such as `S | ((s: S) => S)`
    /// needs the whole substitution, rather than a lookup of `S` alone.
    #[must_use]
    pub fn resolve(&self, ty: TypeId, sigma: &Sigma) -> Option<TypeId> {
        let key = (ty, sigma.iter().map(|(k, v)| (*k, *v)).collect());
        if let Some(found) = self.resolved.borrow().get(&key) {
            return *found;
        }
        let found = substitute(&mut Lookup::new(self), ty, sigma, 0);
        self.resolved.borrow_mut().insert(key, found);
        found
    }

    /// Every instantiation of the single generic whose parameters `ty` mentions,
    /// with the concrete type the entire argument resolves to in each.
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
    pub fn bindings_of(&self, ty: TypeId) -> Vec<(TypeId, TypeId)> {
        let Some(Owner::Type(symbol)) = self.owner_of(ty) else {
            return Vec::new();
        };
        let Some(&declaration) = self.declarations.get(&symbol) else {
            return Vec::new();
        };
        let parameters = arguments(self.snapshot, declaration);
        let mut found: Vec<(TypeId, TypeId)> = self
            .index
            .iter()
            .filter(|((of, args), ty)| {
                *of == symbol && **ty != declaration && args.len() == parameters.len()
            })
            .filter_map(|((_, args), instance)| {
                let sigma = parameters
                    .iter()
                    .copied()
                    .zip(args.iter().copied())
                    .collect();
                let bound = self.resolve(ty, &sigma)?;
                (!mentions_a_parameter(self.snapshot, bound)).then_some((*instance, bound))
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
        // The forms as well as the templates. `substitute` already handles a
        // `TypeKind::Function` -- it substitutes the signature and interns the
        // result -- so this needs no new walk, and `representation_of`'s existing
        // `subst.instance_of(ty)` is what reads the answer.
        for template in self
            .by_owner
            .get(&owner)
            .into_iter()
            .flatten()
            .chain(self.function_forms.get(&owner).into_iter().flatten())
        {
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
        // Lowering's lookup-only Templates never pays for this collection.
        let required = self
            .required_call_forms
            .get_or_init(|| required_call_forms(self.snapshot, &self.owners));
        let mut plan = Vec::new();
        let mut owners: Vec<Owner> = self
            .by_owner
            .keys()
            .chain(required.keys())
            .copied()
            .collect();
        owners.sort_by_key(|owner| match owner {
            Owner::Type(symbol) => (0, symbol.0),
            Owner::Function(node) => (1, node.0),
        });
        owners.dedup();
        // One walk for the whole plan: its memo is keyed by the sigma as well
        // as the type, so an answer is reusable across owners and sigmas alike.
        let mut lookup = Lookup::new(self);
        for owner in owners {
            for sigma in self.sigmas_of(owner, &functions) {
                for template in self
                    .by_owner
                    .get(&owner)
                    .into_iter()
                    .flatten()
                    .chain(required.get(&owner).into_iter().flatten())
                {
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
            if ty == declaration
                || args
                    .iter()
                    .any(|arg| mentions_a_parameter(self.snapshot, *arg))
            {
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
            if bases
                .iter()
                .any(|base| mentions_a_parameter(self.snapshot, *base))
            {
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
                    .map(|((_, args), _)| {
                        parameters
                            .iter()
                            .copied()
                            .zip(args.iter().copied())
                            .collect()
                    })
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

/// Only the dependency roots of actual recorded calls, never all generic types.
/// Each unique root gets one bounded ownership walk. An owner with no concrete
/// offered copy has no sigma in `plan` and therefore materialises nothing.
fn required_call_forms(
    snapshot: &SemanticSnapshot,
    owners: &FxHashMap<TypeId, Owner>,
) -> FxHashMap<Owner, Vec<TypeId>> {
    let mut roots = rustc_hash::FxHashSet::default();
    for target in snapshot.call_targets.values() {
        let Some(signature) = snapshot.signatures.get(target.signature.0 as usize) else {
            continue;
        };
        roots.extend(signature.parameters.iter().map(|param| param.ty));
        roots.insert(signature.return_type);
    }
    let mut roots: Vec<TypeId> = roots.into_iter().collect();
    roots.sort();
    let mut found: FxHashMap<Owner, Vec<TypeId>> = FxHashMap::default();
    for ty in roots {
        if !snapshot.types.get(ty.0 as usize).is_some_and(|record| {
            matches!(
                record.kind,
                TypeKind::Function(_)
                    | TypeKind::Union(_)
                    | TypeKind::Array(_)
                    | TypeKind::Tuple(_)
                    | TypeKind::Intersection(_)
                    | TypeKind::Object { .. }
            )
        }) {
            continue;
        }
        if let Some(owner @ Owner::Function(_)) = one_owner_of(snapshot, owners, ty) {
            found.entry(owner).or_default().push(ty);
        }
    }
    found
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

fn substitute_all(
    site: &mut impl Site,
    types: &[TypeId],
    sigma: &Sigma,
    depth: u32,
) -> Option<Vec<TypeId>> {
    types
        .iter()
        .map(|ty| substitute(site, *ty, sigma, depth))
        .collect()
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
    // A template of a generic this program declares -- `Inner<T>` --
    // is the *instantiation* `Inner<σ(T)>`, not a fresh object with
    // substituted members: it has a symbol, a hierarchy and copies of
    // its own, and an anonymous twin of it would have none of them.
    // A demanded named formal may intentionally be captured shallowly. Its
    // own complete declaration and recorded arguments already own the answer;
    // no native expansion is needed to resolve it under concrete bindings.
    let named = record.symbol.and_then(|symbol| {
        site.declarations()
            .get(&symbol)
            .copied()
            .map(|declaration| (symbol, declaration))
    });
    if let Some((symbol, declaration)) = named {
        let is_owned_shallow = matches!(&record.kind, TypeKind::Structured)
            && matches!(
                site.snapshot()
                    .types
                    .get(declaration.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Object { .. })
            )
            && arguments(site.snapshot(), ty).len()
                == arguments(site.snapshot(), declaration).len();
        if matches!(&record.kind, TypeKind::Object { .. }) || is_owned_shallow {
            let args = instantiation_arguments(site.snapshot(), ty, declaration);
            let args = substitute_all(site, &args, sigma, depth + 1)?;
            // A binding that is itself a parameter leaves the result a
            // template, and a template is not something to materialise.
            if args
                .iter()
                .any(|arg| mentions_a_parameter(site.snapshot(), *arg))
            {
                return None;
            }
            return site.instance(symbol, declaration, args, depth + 1);
        }
    }
    let wanted = match &record.kind {
        TypeKind::Object { properties } => TypeKind::Object {
            properties: substitute_properties(site, properties, sigma, depth + 1)?,
        },
        TypeKind::Array(element) => TypeKind::Array(substitute(site, *element, sigma, depth + 1)?),
        TypeKind::Tuple(tuple) => TypeKind::Tuple(nts_semantic_schema::TupleType {
            elements: substitute_all(site, &tuple.elements, sigma, depth + 1)?,
            ..tuple.clone()
        }),
        TypeKind::Union(items) => TypeKind::Union(substitute_all(site, items, sigma, depth + 1)?),
        TypeKind::Intersection(items) => {
            TypeKind::Intersection(substitute_all(site, items, sigma, depth + 1)?)
        }
        TypeKind::Function(signature) => {
            let signature = site
                .snapshot()
                .signatures
                .get(signature.0 as usize)?
                .clone();
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

/// A cheap exact-equality bucket, followed by full `SignatureRecord` equality.
/// Parameter names, optional/rest flags and predicates still participate in the
/// final comparison; a bucket never supplies semantic equivalence by itself.
#[derive(Debug, PartialEq, Eq, Hash)]
struct SignatureBucket {
    parameters: Vec<TypeId>,
    returns: TypeId,
    type_parameters: Vec<TypeId>,
    construct: bool,
    this: Option<TypeId>,
}

impl From<&SignatureRecord> for SignatureBucket {
    fn from(signature: &SignatureRecord) -> Self {
        Self {
            parameters: signature.parameters.iter().map(|param| param.ty).collect(),
            returns: signature.return_type,
            type_parameters: signature.type_parameters.clone(),
            construct: signature.is_construct,
            this: signature.this_type,
        }
    }
}

#[derive(Debug, PartialEq, Eq, Hash)]
enum CompositeBucket {
    Array(TypeId),
    Tuple(Vec<TypeId>),
    Intersection(Vec<TypeId>),
    Object(Vec<TypeId>),
    Other(std::mem::Discriminant<TypeKind>),
}

impl From<&TypeKind> for CompositeBucket {
    fn from(kind: &TypeKind) -> Self {
        match kind {
            TypeKind::Array(element) => Self::Array(*element),
            TypeKind::Tuple(tuple) => Self::Tuple(tuple.elements.clone()),
            TypeKind::Intersection(items) => Self::Intersection(items.clone()),
            TypeKind::Object { properties } => {
                Self::Object(properties.iter().map(|prop| prop.ty).collect())
            }
            _ => Self::Other(std::mem::discriminant(kind)),
        }
    }
}

/// Immutable snapshot indices. Duplicate records retain the first match, just
/// as the former table scan did -- except a function type, which prefers the
/// record whose signature is the canonical one; nominal symbols remain part of
/// every key.
#[derive(Debug, Default)]
struct LookupIndex {
    signatures: FxHashMap<SignatureBucket, Vec<SignatureId>>,
    functions: FxHashMap<(Option<SymbolId>, SignatureId), TypeId>,
    unions: FxHashMap<(Option<SymbolId>, Vec<UnionMember>), TypeId>,
    composites: FxHashMap<(Option<SymbolId>, CompositeBucket), Vec<TypeId>>,
}

impl LookupIndex {
    fn new(snapshot: &SemanticSnapshot) -> Self {
        let mut index = Self::default();
        let mut canonical = Vec::with_capacity(snapshot.signatures.len());
        for (at, signature) in snapshot.signatures.iter().enumerate() {
            let id = SignatureId(u32::try_from(at).unwrap_or(u32::MAX));
            let bucket = index
                .signatures
                .entry(SignatureBucket::from(signature))
                .or_default();
            let first = bucket
                .iter()
                .copied()
                .find(|found| snapshot.signatures.get(found.0 as usize) == Some(signature))
                .unwrap_or(id);
            if first == id {
                bucket.push(id);
            }
            canonical.push(first);
        }
        for (at, record) in snapshot.types.iter().enumerate() {
            let id = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
            match &record.kind {
                // **The type carrying the canonical signature itself wins over
                // a duplicate that only matches it.** Anonymous `() => number`
                // is recorded under several ids -- a parameter's, a callback's,
                // a copy's return -- and the first in table order is whichever
                // the program happened to mention first. The checker types a
                // call's result with the one whose signature is the canonical
                // id, so a copy of `captured<T>(): () => T` resolving its return
                // to an earlier duplicate gave the closure a layout under one
                // id while its call was typed with another (NTS2006, "an object
                // type with no layout": a-specialized-function-carrying-a-throw).
                // A duplicate still answers where no exact one carries the
                // symbol the form needs, which is what matching by shape is for.
                TypeKind::Function(signature) => {
                    if let Some(first) = canonical.get(signature.0 as usize) {
                        let slot = index.functions.entry((record.symbol, *first)).or_insert(id);
                        if signature == first
                            && !matches!(snapshot.types.get(slot.0 as usize)
                            .map(|found| &found.kind), Some(TypeKind::Function(found)) if found == first)
                        {
                            *slot = id;
                        }
                    }
                }
                TypeKind::Union(members) => {
                    if let Some(members) = union_members(snapshot, members) {
                        index.unions.entry((record.symbol, members)).or_insert(id);
                    }
                }
                _ => index
                    .composites
                    .entry((record.symbol, CompositeBucket::from(&record.kind)))
                    .or_default()
                    .push(id),
            }
        }
        index
    }

    fn signature(
        &self,
        snapshot: &SemanticSnapshot,
        wanted: &SignatureRecord,
    ) -> Option<SignatureId> {
        self.signatures
            .get(&SignatureBucket::from(wanted))?
            .iter()
            .copied()
            .find(|id| snapshot.signatures.get(id.0 as usize) == Some(wanted))
    }

    fn composite(
        &self,
        snapshot: &SemanticSnapshot,
        wanted: &TypeKind,
        symbol: Option<SymbolId>,
    ) -> Option<TypeId> {
        match wanted {
            TypeKind::Function(signature) => {
                let wanted = snapshot.signatures.get(signature.0 as usize)?;
                let canonical = self.signature(snapshot, wanted)?;
                self.functions.get(&(symbol, canonical)).copied()
            }
            TypeKind::Union(members) => self
                .unions
                .get(&(symbol, union_members(snapshot, members)?))
                .copied(),
            _ => self
                .composites
                .get(&(symbol, CompositeBucket::from(wanted)))?
                .iter()
                .copied()
                .find(|id| {
                    snapshot
                        .types
                        .get(id.0 as usize)
                        .is_some_and(|record| record.kind == *wanted)
                }),
        }
    }
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
        self.templates
            .lookup_index
            .get_or_init(|| LookupIndex::new(self.templates.snapshot))
            .composite(self.templates.snapshot, &wanted, symbol)
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
        self.templates
            .lookup_index
            .get_or_init(|| LookupIndex::new(self.templates.snapshot))
            .signature(self.templates.snapshot, &wanted)
    }

    fn declarations(&self) -> &FxHashMap<SymbolId, TypeId> {
        &self.templates.declarations
    }
}

/// The semantic members of a finite union, in a stable order. Substitution can
/// put a union inside another union, while the checker flattens it; likewise
/// `boolean` is stored on its own and as `false | true` inside a wider union.
/// Only those two equivalences are used: references and function shapes retain
/// their type identities, and `null` and `undefined` remain separate members.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum UnionMember {
    Type(TypeId),
    False,
    True,
}

fn union_members(snapshot: &SemanticSnapshot, members: &[TypeId]) -> Option<Vec<UnionMember>> {
    let mut work: Vec<_> = members.iter().map(|ty| (*ty, 0, false)).collect();
    let mut active = rustc_hash::FxHashSet::default();
    let mut done = rustc_hash::FxHashSet::default();
    let mut found = Vec::new();
    while let Some((ty, depth, leaving)) = work.pop() {
        if leaving {
            active.remove(&ty);
            done.insert(ty);
            continue;
        }
        if depth > DEPTH {
            return None;
        }
        match &snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Union(items) => {
                if done.contains(&ty) {
                    continue;
                }
                if !active.insert(ty) {
                    return None;
                }
                work.push((ty, depth, true));
                work.extend(items.iter().map(|item| (*item, depth + 1, false)));
            }
            TypeKind::Boolean => found.extend([UnionMember::False, UnionMember::True]),
            TypeKind::Literal(nts_semantic_schema::LiteralValue::Boolean(false)) => {
                found.push(UnionMember::False);
            }
            TypeKind::Literal(nts_semantic_schema::LiteralValue::Boolean(true)) => {
                found.push(UnionMember::True);
            }
            _ => found.push(UnionMember::Type(ty)),
        }
    }
    found.sort();
    found.dedup();
    Some(found)
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
                .or_else(|| {
                    declaration.and_then(|declaration| self.snapshot.base_types.get(&declaration))
                })
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

    fn push(&mut self, record: TypeRecord) -> Option<TypeId> {
        // Substituting a child can consume the final record after the
        // parent's entry check. Enforce the limit at the allocation itself,
        // before either caller publishes a new record's sidecars or index.
        if self.created >= BUDGET {
            return None;
        }
        self.snapshot.types.push(record);
        self.created += 1;
        Some(TypeId(
            u32::try_from(self.snapshot.types.len() - 1).unwrap_or(u32::MAX),
        ))
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
        self.push(TypeRecord {
            kind: wanted,
            symbol,
        })
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
        })?;
        self.snapshot.type_arguments.insert(id, args.clone());
        if let Some(&count) = self.snapshot.reference_parameter_counts.get(&declaration) {
            self.snapshot.reference_parameter_counts.insert(id, count);
        }
        self.index.insert((symbol, args.clone()), id);

        let own: Sigma = arguments(self.snapshot, declaration)
            .into_iter()
            .zip(args)
            .collect();
        let Some(TypeKind::Object { properties }) = self
            .snapshot
            .types
            .get(declaration.0 as usize)
            .map(|record| record.kind.clone())
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
                Some(PropertyRecord {
                    ty,
                    ..property.clone()
                })
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
                    substitute(self, base, &own, depth)
                        .or_else(|| (!mentions_a_parameter(self.snapshot, base)).then_some(base))
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
            && snapshot
                .nodes
                .get(at.0 as usize)
                .is_some_and(|node| node.kind == NodeKind::List)
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
    snapshot
        .type_arguments
        .get(&ty)
        .cloned()
        .unwrap_or_default()
}

/// An instantiation's arguments, as many as the declaration has parameters.
///
/// The checker writes a class's base as `Base<T, this>`: the `this` type
/// appended after the declared parameters. It is a parameter nothing binds,
/// so an instantiation carrying it could never be made, and a derived class's
/// base kept the form's -- `Derived<number>` extending `Base<T>`, whose
/// `value: T` then had no representation. Truncated to the declaration's
/// arity, `Base<T, this>` under `T := number` is `Base<number>`.
fn instantiation_arguments(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    declaration: TypeId,
) -> Vec<TypeId> {
    let mut args = arguments(snapshot, ty);
    args.truncate(arguments(snapshot, declaration).len());
    args
}

/// The single owner whose type parameters a type mentions, where there is one.
///
/// `None` in three cases, and the third is a deliberate divergence from the
/// template loop below rather than a copy of it:
///
/// - a type mentioning **no** parameter: it is concrete and needs no
///   instantiation;
/// - one mentioning **two** owners at once -- a generic method's parameter
///   beside its class's -- which the template loop has always left alone for the
///   same reason: no single sigma answers for it;
/// - one mentioning a parameter with **no known owner**. The template loop
///   reaches that case through a `filter_map`, which *skips* the parameter and
///   decides on the rest; this rejects the type. Both are safe there and only
///   one is safe here: skipping would record an instance for a form whose other
///   parameter nothing substitutes, and a *wrong* instance is what
///   `representation_of` would then hand every reader. Rejecting falls back to
///   the unsubstituted form, which is the behaviour that existed before
///   `function_forms`.
///
/// Used by `function_forms` and deferred argument resolution. The template loop keeps its own
/// inline test, because changing what counts as a template is the change this
/// was written to avoid.
fn one_owner_of(
    snapshot: &SemanticSnapshot,
    owners: &FxHashMap<TypeId, Owner>,
    ty: TypeId,
) -> Option<Owner> {
    let mut mentioned = Vec::new();
    parameters_in(snapshot, ty, &mut mentioned);
    let mut seen: Option<Owner> = None;
    for parameter in &mentioned {
        let owner = *owners.get(parameter)?;
        match seen {
            None => seen = Some(owner),
            Some(first) if first == owner => {}
            Some(_) => return None,
        }
    }
    seen
}

/// The type parameters a type mentions, through arrays, unions, tuples,
/// functions and instantiations.
fn parameters_in(snapshot: &SemanticSnapshot, ty: TypeId, into: &mut Vec<TypeId>) {
    // The type graph is finite, but it need not be shallow or acyclic. Every
    // type enters once, so absence means the complete graph has no parameter;
    // it never means that a recursion depth stopped the search early.
    let mut pending = vec![ty];
    let mut visited = FxHashSet::default();
    let mut found: FxHashSet<_> = into.iter().copied().collect();
    while let Some(ty) = pending.pop() {
        if !visited.insert(ty) {
            continue;
        }
        match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
            Some(TypeKind::TypeParameter { .. }) => {
                if found.insert(ty) {
                    into.push(ty);
                }
            }
            Some(TypeKind::Array(element)) => pending.push(*element),
            Some(TypeKind::Tuple(tuple)) => {
                pending.extend(tuple.elements.iter().rev().copied());
            }
            Some(TypeKind::Union(items) | TypeKind::Intersection(items)) => {
                pending.extend(items.iter().rev().copied());
            }
            Some(TypeKind::Function(signature)) => {
                if let Some(signature) = snapshot.signatures.get(signature.0 as usize) {
                    pending.push(signature.return_type);
                    pending.extend(
                        signature
                            .parameters
                            .iter()
                            .rev()
                            .map(|parameter| parameter.ty),
                    );
                }
            }
            // Arguments also belong to opaque/Structured forms, not only
            // Object records. This is the same edge policy as the old walk.
            _ => pending.extend(arguments(snapshot, ty).into_iter().rev()),
        }
    }
}

pub(super) fn mentions_a_parameter(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let mut found = Vec::new();
    parameters_in(snapshot, ty, &mut found);
    !found.is_empty()
}

/// An existing record equal to `wanted`, with the same declaring symbol.
fn find_record(
    snapshot: &SemanticSnapshot,
    wanted: &TypeKind,
    symbol: Option<SymbolId>,
) -> Option<TypeId> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use nts_semantic_schema::{LiteralValue, ParameterRecord, TypeRecord};

    #[test]
    fn created_instances_keep_known_zero_and_nonzero_reference_arity() {
        for count in [None, Some(0), Some(1)] {
            let mut snapshot = snapshot(vec![
                TypeKind::Object {
                    properties: Vec::new(),
                },
                TypeKind::TypeParameter {
                    name: "T".into(),
                    is_this: false,
                    constraint: None,
                },
                TypeKind::Number,
            ]);
            let (declared, actual) = if count == Some(1) {
                (vec![TypeId(1)], vec![TypeId(2)])
            } else {
                (Vec::new(), Vec::new())
            };
            snapshot.type_arguments.insert(TypeId(0), declared);
            if let Some(count) = count {
                snapshot.reference_parameter_counts.insert(TypeId(0), count);
            }
            let mut writer = Writer::new(&mut snapshot, FxHashMap::default(), FxHashMap::default());
            let created = writer
                .instance(SymbolId(0), TypeId(0), actual, 0)
                .expect("empty owned instance");
            assert_eq!(
                writer
                    .snapshot
                    .reference_parameter_counts
                    .get(&created)
                    .copied(),
                count
            );
        }
    }

    #[test]
    fn parameter_presence_and_ownership_cover_deep_and_cyclic_type_graphs() {
        let mut kinds = vec![
            TypeKind::TypeParameter {
                name: "T".into(),
                is_this: false,
                constraint: None,
            },
            TypeKind::TypeParameter {
                name: "U".into(),
                is_this: false,
                constraint: None,
            },
        ];
        let mut deep = TypeId(1);
        for _ in 0..40 {
            kinds.push(TypeKind::Array(deep));
            deep = TypeId(u32::try_from(kinds.len() - 1).expect("small graph"));
        }
        let root = TypeId(u32::try_from(kinds.len()).expect("small graph"));
        kinds.push(TypeKind::Tuple(nts_semantic_schema::TupleType {
            elements: vec![TypeId(0), deep],
            element_flags: vec![nts_semantic_schema::TupleElementKind::Required; 2],
            fixed_length: 2,
            readonly: false,
        }));
        let mut graph = snapshot(kinds);
        let owners = FxHashMap::from_iter([
            (TypeId(0), Owner::Function(NodeId(10))),
            (TypeId(1), Owner::Function(NodeId(11))),
        ]);
        assert!(
            mentions_a_parameter(&graph, deep),
            "a deep parameter is not concrete"
        );
        assert_eq!(
            one_owner_of(&graph, &owners, root),
            None,
            "a deep second owner cannot be omitted"
        );
        // One difference: both parameters really have the same owner.
        let same = FxHashMap::from_iter([
            (TypeId(0), Owner::Function(NodeId(10))),
            (TypeId(1), Owner::Function(NodeId(10))),
        ]);
        assert_eq!(
            one_owner_of(&graph, &same, root),
            Some(Owner::Function(NodeId(10)))
        );
        let cycle = TypeId(u32::try_from(graph.types.len()).expect("small graph"));
        graph.types.push(TypeRecord {
            kind: TypeKind::Structured,
            symbol: None,
        });
        graph.type_arguments.insert(cycle, vec![cycle, root]);
        let mut all = Vec::new();
        parameters_in(&graph, cycle, &mut all);
        assert_eq!(all, vec![TypeId(0), TypeId(1)]);
        graph.type_arguments.insert(cycle, vec![cycle]);
        assert!(
            !mentions_a_parameter(&graph, cycle),
            "a closed parameter-free cycle completes"
        );
    }

    fn snapshot(kinds: Vec<TypeKind>) -> SemanticSnapshot {
        SemanticSnapshot {
            types: kinds
                .into_iter()
                .map(|kind| TypeRecord { kind, symbol: None })
                .collect(),
            ..SemanticSnapshot::default()
        }
    }

    // The captured declaration is Box<T,P>, the shallow formal Box<F,unknown>,
    // and the already captured concrete parameter is Box<unknown,unknown>.
    fn owned_form_snapshot() -> SemanticSnapshot {
        let field = |name: &str, ty: TypeId| PropertyRecord {
            name: name.into(),
            ty,
            readonly: true,
            optional: false,
            declaration: None,
            kind: nts_semantic_schema::MemberKind::Field,
            own: true,
        };
        let parameter = |name: &str| TypeKind::TypeParameter {
            name: name.into(),
            constraint: None,
            is_this: false,
        };
        let mut snapshot = snapshot(vec![
            TypeKind::Object {
                properties: vec![field("value", TypeId(1)), field("payload", TypeId(2))],
            },
            parameter("T"),
            parameter("P"),
            parameter("F"),
            TypeKind::Unknown,
            TypeKind::Structured,
            TypeKind::Object {
                properties: vec![field("value", TypeId(4)), field("payload", TypeId(4))],
            },
        ]);
        for id in [0, 5, 6] {
            snapshot.types[id].symbol = Some(SymbolId(0));
        }
        snapshot
            .type_arguments
            .insert(TypeId(0), vec![TypeId(1), TypeId(2)]);
        snapshot
            .type_arguments
            .insert(TypeId(5), vec![TypeId(3), TypeId(4)]);
        snapshot
            .type_arguments
            .insert(TypeId(6), vec![TypeId(4), TypeId(4)]);
        snapshot
    }

    #[test]
    fn a_shallow_owned_form_reuses_the_exact_concrete_parameter() {
        for shallow in [false, true] {
            let mut snapshot = owned_form_snapshot();
            if !shallow {
                snapshot.types[5].kind = TypeKind::Object {
                    properties: Vec::new(),
                };
            }
            let index =
                FxHashMap::from_iter([((SymbolId(0), vec![TypeId(4), TypeId(4)]), TypeId(6))]);
            let declarations = FxHashMap::from_iter([(SymbolId(0), TypeId(0))]);
            let sigma = Sigma::from([(TypeId(3), TypeId(4))]);
            // Both the writer and the read-only lookup must find the same
            // nominal instance, with no new records when it already exists.
            let mut templates = Templates::new(&snapshot);
            templates.index = index.clone();
            templates.declarations = declarations.clone();
            assert_eq!(templates.resolve(TypeId(5), &sigma), Some(TypeId(6)));
            let length = snapshot.types.len();
            let mut writer = Writer::new(&mut snapshot, index, declarations);
            assert_eq!(
                substitute(&mut writer, TypeId(5), &sigma, 0),
                Some(TypeId(6))
            );
            assert_eq!(writer.created, 0);
            assert_eq!(writer.snapshot.types.len(), length);
        }
    }

    #[test]
    fn a_shallow_form_can_materialise_only_the_owned_declaration_members() {
        let mut snapshot = owned_form_snapshot();
        snapshot.types.pop();
        snapshot.type_arguments.remove(&TypeId(6));
        let declarations = FxHashMap::from_iter([(SymbolId(0), TypeId(0))]);
        let sigma = Sigma::from([(TypeId(3), TypeId(4))]);
        let mut writer = Writer::new(&mut snapshot, FxHashMap::default(), declarations);
        let found = substitute(&mut writer, TypeId(5), &sigma, 0).expect("owned concrete instance");
        assert_eq!(writer.created, 1);
        assert_eq!(
            writer.snapshot.types[found.0 as usize].symbol,
            Some(SymbolId(0))
        );
        assert_eq!(
            writer.snapshot.type_arguments[&found],
            vec![TypeId(4), TypeId(4)]
        );
        let TypeKind::Object { properties } = &writer.snapshot.types[found.0 as usize].kind else {
            panic!("the owned declaration supplies an object");
        };
        assert_eq!(properties.len(), 2);
        assert!(properties.iter().all(|property| property.ty == TypeId(4)));
    }

    #[test]
    fn shallow_forms_do_not_rescue_missing_contracts_or_open_bindings() {
        for case in 0..6 {
            let mut snapshot = owned_form_snapshot();
            let mut declarations = FxHashMap::from_iter([(SymbolId(0), TypeId(0))]);
            let mut sigma = Sigma::from([(TypeId(3), TypeId(4))]);
            match case {
                0 => declarations.clear(),
                1 => snapshot.types[0].kind = TypeKind::Structured,
                2 => {
                    snapshot.types[5].symbol = None;
                }
                3 => {
                    snapshot.type_arguments.insert(TypeId(5), vec![TypeId(3)]);
                }
                4 => {
                    snapshot
                        .type_arguments
                        .insert(TypeId(5), vec![TypeId(3), TypeId(4), TypeId(4)]);
                }
                _ => sigma.clear(),
            }
            let length = snapshot.types.len();
            let mut writer = Writer::new(&mut snapshot, FxHashMap::default(), declarations);
            assert_eq!(
                substitute(&mut writer, TypeId(5), &sigma, 0),
                None,
                "case {case}"
            );
            assert_eq!(writer.created, 0, "case {case}");
            assert_eq!(writer.snapshot.types.len(), length);
            assert!(matches!(
                writer.snapshot.types[5].kind,
                TypeKind::Structured
            ));
        }
    }

    #[test]
    fn nominal_parents_cannot_exceed_the_record_cap_after_their_argument() {
        for shallow in [false, true] {
            let mut snapshot = owned_form_snapshot();
            if !shallow {
                snapshot.types[5].kind = TypeKind::Object {
                    properties: Vec::new(),
                };
            }
            snapshot.types.push(TypeRecord {
                kind: TypeKind::Array(TypeId(3)),
                symbol: None,
            });
            snapshot.type_arguments.insert(TypeId(0), vec![TypeId(1)]);
            snapshot.type_arguments.insert(TypeId(5), vec![TypeId(7)]);
            snapshot.reference_parameter_counts.insert(TypeId(0), 1);
            let length = snapshot.types.len();
            let arguments_before = snapshot.type_arguments.clone();
            let counts_before = snapshot.reference_parameter_counts.clone();
            let declarations = FxHashMap::from_iter([(SymbolId(0), TypeId(0))]);
            let sigma = Sigma::from([(TypeId(3), TypeId(4))]);
            let mut writer = Writer::new(&mut snapshot, FxHashMap::default(), declarations);
            // Inject the accounting edge without allocating 20,000 filler
            // records: Array<unknown> takes the last slot, its parent cannot.
            writer.created = BUDGET - 1;
            assert_eq!(substitute(&mut writer, TypeId(5), &sigma, 0), None);
            assert_eq!(writer.created, BUDGET);
            assert_eq!(writer.snapshot.types.len(), length + 1);
            assert_eq!(
                writer.snapshot.types[length].kind,
                TypeKind::Array(TypeId(4))
            );
            assert!(
                writer.index.is_empty(),
                "unexpected instance index: {:?}",
                writer.index
            );
            assert_eq!(writer.snapshot.type_arguments, arguments_before);
            assert_eq!(writer.snapshot.reference_parameter_counts, counts_before);
        }
    }

    #[test]
    fn composite_parents_cannot_exceed_the_record_cap_when_unwinding() {
        let mut snapshot = snapshot(vec![
            TypeKind::TypeParameter {
                name: "F".into(),
                constraint: None,
                is_this: false,
            },
            TypeKind::Number,
            TypeKind::Array(TypeId(0)),
            TypeKind::Array(TypeId(2)),
        ]);
        let length = snapshot.types.len();
        let sigma = Sigma::from([(TypeId(0), TypeId(1))]);
        let mut writer = Writer::new(&mut snapshot, FxHashMap::default(), FxHashMap::default());
        writer.created = BUDGET - 1;
        assert_eq!(substitute(&mut writer, TypeId(3), &sigma, 0), None);
        assert_eq!(writer.created, BUDGET);
        assert_eq!(writer.snapshot.types.len(), length + 1);
        assert_eq!(
            writer.snapshot.types[length].kind,
            TypeKind::Array(TypeId(1))
        );
        assert!(
            writer.index.is_empty(),
            "unexpected instance index: {:?}",
            writer.index
        );
        assert!(
            writer.snapshot.type_arguments.is_empty(),
            "unexpected type-argument sidecars: {:?}",
            writer.snapshot.type_arguments
        );
    }

    #[test]
    fn the_record_cap_preserves_exact_existing_instance_and_composite_reuse() {
        let mut snapshot = owned_form_snapshot();
        let length = snapshot.types.len();
        let index = FxHashMap::from_iter([((SymbolId(0), vec![TypeId(4), TypeId(4)]), TypeId(6))]);
        let declarations = FxHashMap::from_iter([(SymbolId(0), TypeId(0))]);
        let mut writer = Writer::new(&mut snapshot, index.clone(), declarations);
        writer.created = BUDGET;
        assert_eq!(
            writer.instance(SymbolId(0), TypeId(0), vec![TypeId(4), TypeId(4)], 0),
            Some(TypeId(6))
        );
        assert_eq!(writer.composite(TypeKind::Unknown, None), Some(TypeId(4)));
        assert_eq!(writer.created, BUDGET);
        assert_eq!(writer.snapshot.types.len(), length);
        assert_eq!(writer.index, index);
    }

    #[test]
    fn union_lookup_preserves_absences_symbols_and_distinct_shapes() {
        let mut snapshot = snapshot(vec![
            TypeKind::Boolean,
            TypeKind::Literal(LiteralValue::Boolean(false)),
            TypeKind::Literal(LiteralValue::Boolean(true)),
            TypeKind::Null,
            TypeKind::Undefined,
            TypeKind::Union(vec![TypeId(1), TypeId(2), TypeId(3)]),
            TypeKind::Union(vec![TypeId(1), TypeId(2), TypeId(4)]),
            TypeKind::Union(vec![TypeId(0), TypeId(3)]),
        ]);
        snapshot.types[7].symbol = Some(SymbolId(0));
        let templates = Templates::new(&snapshot);
        let mut lookup = Lookup::new(&templates);
        assert_eq!(
            lookup.composite(TypeKind::Union(vec![TypeId(0), TypeId(3)]), None),
            Some(TypeId(5))
        );
        assert_eq!(
            lookup.composite(TypeKind::Union(vec![TypeId(0), TypeId(4)]), None),
            Some(TypeId(6))
        );
        assert_eq!(
            lookup.composite(
                TypeKind::Union(vec![TypeId(5), TypeId(3)]),
                Some(SymbolId(0))
            ),
            Some(TypeId(7))
        );
        assert_eq!(
            lookup.composite(TypeKind::Union(vec![TypeId(3), TypeId(4)]), None),
            None
        );
    }

    #[test]
    fn recursive_union_is_not_replaced_by_its_finite_leaves() {
        let snapshot = snapshot(vec![
            TypeKind::Number,
            TypeKind::Union(vec![TypeId(0), TypeId(1)]),
        ]);
        assert!(union_members(&snapshot, &[TypeId(1)]).is_none());
        let templates = Templates::new(&snapshot);
        assert_eq!(
            Lookup::new(&templates).composite(TypeKind::Union(vec![TypeId(0)]), None),
            None
        );
    }

    #[test]
    fn callback_lookup_compares_the_full_signature_and_original_symbol() {
        let mut snapshot = snapshot(vec![
            TypeKind::Number,
            TypeKind::Function(SignatureId(0)),
            TypeKind::Function(SignatureId(1)),
            TypeKind::Function(SignatureId(2)),
        ]);
        let signature = SignatureRecord {
            parameters: vec![ParameterRecord {
                name: "value".to_owned(),
                ty: TypeId(0),
                optional: false,
                rest: false,
            }],
            return_type: TypeId(0),
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        snapshot.signatures = vec![signature.clone(), signature.clone(), signature];
        snapshot.signatures[2].parameters[0].optional = true;
        snapshot.types[1].symbol = Some(SymbolId(0));
        let templates = Templates::new(&snapshot);
        let mut lookup = Lookup::new(&templates);
        assert_eq!(
            lookup.composite(TypeKind::Function(SignatureId(0)), None),
            Some(TypeId(2))
        );
        assert_eq!(
            lookup.composite(TypeKind::Function(SignatureId(2)), None),
            Some(TypeId(3))
        );
        assert_eq!(
            lookup.composite(TypeKind::Function(SignatureId(2)), Some(SymbolId(0))),
            None
        );
    }

    #[test]
    fn coarse_object_bucket_preserves_member_flags_and_identity() {
        let property = PropertyRecord {
            name: "value".to_owned().into(),
            ty: TypeId(0),
            readonly: false,
            optional: false,
            declaration: None,
            kind: nts_semantic_schema::MemberKind::Field,
            own: true,
        };
        let mut optional = property.clone();
        optional.optional = true;
        let mut readonly = property.clone();
        readonly.readonly = true;
        let mut renamed = property.clone();
        renamed.name = "other".to_owned().into();
        let snapshot = snapshot(vec![
            TypeKind::Number,
            TypeKind::Object {
                properties: vec![property.clone()],
            },
            TypeKind::Object {
                properties: vec![optional],
            },
            TypeKind::Object {
                properties: vec![readonly],
            },
            TypeKind::Object {
                properties: vec![renamed],
            },
        ]);
        let index = LookupIndex::new(&snapshot);
        for at in 1..5 {
            let kind = &snapshot.types[at].kind;
            assert_eq!(
                index.composite(&snapshot, kind, None),
                Some(TypeId(u32::try_from(at).expect("four records")))
            );
            assert_eq!(index.composite(&snapshot, kind, Some(SymbolId(0))), None);
        }
    }

    #[test]
    fn tuple_substitution_keeps_kinds_fixed_prefix_and_readonly_identity() {
        use nts_semantic_schema::{
            TupleElementKind::{Required, Rest},
            TupleType,
        };
        let shape = |elements, element_flags, fixed_length, readonly| {
            TypeKind::Tuple(TupleType {
                elements,
                element_flags,
                fixed_length,
                readonly,
            })
        };
        let snapshot = snapshot(vec![
            TypeKind::TypeParameter {
                name: "T".into(),
                constraint: None,
                is_this: false,
            },
            TypeKind::Number,
            TypeKind::String,
            shape(vec![TypeId(0), TypeId(1)], vec![Required, Rest], 1, true),
            shape(vec![TypeId(2), TypeId(1)], vec![Required; 2], 2, true),
            shape(vec![TypeId(2), TypeId(1)], vec![Required, Rest], 1, false),
            shape(vec![TypeId(2), TypeId(1)], vec![Required, Rest], 1, true),
        ]);
        let templates = Templates::new(&snapshot);
        let sigma = Sigma::from([(TypeId(0), TypeId(2))]);
        assert_eq!(templates.resolve(TypeId(3), &sigma), Some(TypeId(6)));
        let TypeKind::Tuple(tuple) = &snapshot.types[6].kind else {
            unreachable!()
        };
        assert_eq!(tuple.elements, [TypeId(2), TypeId(1)]);
        assert_eq!(tuple.element_flags, [Required, Rest]);
        assert_eq!(tuple.fixed_length, 1);
        assert!(tuple.readonly);
    }

    #[test]
    fn root_resolution_cache_is_separate_for_each_sigma() {
        let snapshot = snapshot(vec![
            TypeKind::TypeParameter {
                name: "T".to_owned(),
                is_this: false,
                constraint: None,
            },
            TypeKind::Array(TypeId(0)),
            TypeKind::Number,
            TypeKind::String,
            TypeKind::Array(TypeId(2)),
            TypeKind::Array(TypeId(3)),
        ]);
        let templates = Templates::new(&snapshot);
        let number = Sigma::from([(TypeId(0), TypeId(2))]);
        let string = Sigma::from([(TypeId(0), TypeId(3))]);
        assert_eq!(templates.resolve(TypeId(1), &number), Some(TypeId(4)));
        assert_eq!(templates.resolve(TypeId(1), &string), Some(TypeId(5)));
        assert_eq!(templates.resolve(TypeId(1), &number), Some(TypeId(4)));
        assert_eq!(templates.resolved.borrow().len(), 2);
    }

    #[test]
    fn call_form_roots_exclude_unused_class_and_mixed_owners() {
        let parameter = |name: &str| TypeKind::TypeParameter {
            name: name.to_owned(),
            is_this: false,
            constraint: None,
        };
        let mut snapshot = snapshot(vec![
            parameter("T"),
            parameter("U"),
            parameter("ClassT"),
            TypeKind::Number,
            TypeKind::Union(vec![TypeId(0), TypeId(3)]),
            TypeKind::Tuple(nts_semantic_schema::TupleType {
                elements: vec![TypeId(0), TypeId(1)],
                element_flags: vec![nts_semantic_schema::TupleElementKind::Required; 2],
                fixed_length: 2,
                readonly: false,
            }),
            TypeKind::Function(SignatureId(0)),
            TypeKind::Array(TypeId(1)), // Not mentioned by any recorded call.
        ]);
        let signature = |types: &[TypeId]| SignatureRecord {
            parameters: types
                .iter()
                .enumerate()
                .map(|(at, ty)| ParameterRecord {
                    name: format!("p{at}"),
                    ty: *ty,
                    optional: false,
                    rest: false,
                })
                .collect(),
            return_type: TypeId(3),
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        snapshot.signatures = vec![
            signature(&[TypeId(2)]),
            signature(&[TypeId(4), TypeId(5), TypeId(6), TypeId(4)]),
        ];
        snapshot.call_targets.insert(
            NodeId(0),
            nts_semantic_schema::CallTarget {
                signature: SignatureId(1),
                callee: None,
                declaration: None,
            },
        );
        let owner = Owner::Function(NodeId(10));
        let owners = FxHashMap::from_iter([
            (TypeId(0), owner),
            (TypeId(1), Owner::Function(NodeId(11))),
            (TypeId(2), Owner::Type(SymbolId(0))),
        ]);
        assert_eq!(
            required_call_forms(&snapshot, &owners),
            FxHashMap::from_iter([(owner, vec![TypeId(4)])])
        );
    }
}
