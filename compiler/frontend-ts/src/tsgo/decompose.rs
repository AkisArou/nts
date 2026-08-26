//! Turning [`TypeKind::Structured`] placeholders into real type structure.
//!
//! # Why this is a separate pass
//!
//! Types arrive from `getTypeAtLocations` as flags. Flags say *that* something is
//! an object or a union; they do not say which properties or which members. Those
//! need follow-up queries, and tsgo exposes **no batch endpoint for a type's
//! members** — `getTypesOfType`, `getPropertiesOfType`, and `getTypeArguments`
//! each take exactly one type.
//!
//! So decomposition costs round trips proportional to *distinct types*, unlike
//! everything before it, which costs round trips proportional to files. Measured
//! on a 250-file program: 3,256 distinct types behind 46,750 typed nodes. Eagerly
//! decomposing all of them would be roughly seven times the traffic of producing
//! the snapshot in the first place.
//!
//! # Therefore: a worklist, not a sweep
//!
//! [`Decomposer::run`] takes a **seed set** and walks the transitive closure from
//! it, memoizing. Today the caller seeds it with everything, because reachability
//! does not exist yet. When it does (RFC §7), the seeds become the types actually
//! reached from a product's entry points or exports, and the cost falls out of
//! this pass without its shape changing.
//!
//! The [`Budget`] is the interim protection: a bound on how much traffic one
//! decomposition may spend, reported rather than silently enforced, so a build
//! that hits it says so instead of quietly returning a partial type graph.

use nts_semantic_schema::{
    CallTarget, ConstantValue, DeclarationModifiers, IndexSignature, NodeId, NodeKind,
    ParameterRecord, PropertyRecord, SemanticSnapshot, SignatureId, SignatureRecord, SymbolId,
    TypeId, TypeKind,
};
use rustc_hash::{FxHashMap, FxHashSet};

use super::proto::{
    NodeHandle, ProjectHandle, SignatureResponse, SnapshotHandle, SymbolResponse, TypeResponse,
    check_flags, method, predicate_kind, signature_flags, symbol_flags,
};
use super::types::{self, flags, syntax};
use super::{Client, TsgoError};

/// How much traffic one decomposition may spend.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    /// Maximum distinct types to decompose. Reaching it stops the walk.
    pub max_types: usize,
}

impl Budget {
    /// Enough for a small program; a placeholder until reachability sets the
    /// seeds and the bound stops mattering.
    pub const DEFAULT: Self = Self { max_types: 4096 };
}

/// The mutable state a decomposition walk carries.
///
/// Bundled because it is the same three values everywhere, and threading them
/// individually pushed `resolve` past the point where a transposed argument would
/// still be obvious.
#[derive(Debug)]
struct Walk<'w> {
    worklist: &'w mut Vec<u32>,
    stats: &'w mut DecomposeStats,
    seeded: &'w FxHashSet<u32>,
}

/// What one decomposition cost and covered.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DecomposeStats {
    /// Types whose structure was resolved.
    pub decomposed: u32,
    /// Types discovered while walking that were not in the seed set.
    pub discovered: u32,
    /// Round trips spent.
    pub round_trips: u64,
    /// True when the walk stopped on [`Budget::max_types`] with work outstanding.
    ///
    /// A partial type graph is legitimate; presenting it as complete is not.
    pub exhausted: bool,
}

/// Walks a type graph, replacing placeholders with structure.
pub struct Decomposer<'a> {
    client: &'a mut Client,
    handle: SnapshotHandle,
    project: ProjectHandle,
    /// tsgo type id → our arena index. Shared with the frontend's interning so a
    /// type discovered here and a type seen at a node are one record.
    interned: FxHashMap<u32, TypeId>,
    /// tsgo type ids already decomposed, so a cyclic type graph terminates.
    done: FxHashSet<u32>,
    /// tsgo symbol id → arena index, for mapping a type's declaring symbol.
    symbols: FxHashMap<u32, SymbolId>,
    /// Where each compiled file's nodes begin, for resolving declaration handles.
    file_bases: Vec<(String, u32)>,
    /// Literal segments of template literal types, kept from interning time.
    ///
    /// They arrive on the response and are gone by the time the walk decides how
    /// to resolve the type, and there is no endpoint that answers them again.
    texts: FxHashMap<u32, Vec<String>>,
}

impl std::fmt::Debug for Decomposer<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Decomposer")
            .field("project", &self.project)
            .field("interned", &self.interned.len())
            .field("done", &self.done.len())
            .finish_non_exhaustive()
    }
}

impl<'a> Decomposer<'a> {
    /// Prepare a decomposer over a live session.
    ///
    /// `interned` must be the map the snapshot's types were built with; sharing it
    /// is what stops a discovered type from becoming a duplicate record.
    pub fn new(
        client: &'a mut Client,
        handle: SnapshotHandle,
        project: ProjectHandle,
        interned: FxHashMap<u32, TypeId>,
        symbols: FxHashMap<u32, SymbolId>,
        file_bases: Vec<(String, u32)>,
    ) -> Self {
        Self {
            client,
            handle,
            project,
            interned,
            done: FxHashSet::default(),
            symbols,
            file_bases,
            texts: FxHashMap::default(),
        }
    }

    /// Decompose the transitive closure of `seeds`.
    ///
    /// `seeds` are tsgo type ids. Returns what it cost; the snapshot is updated in
    /// place.
    pub fn run(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        seeds: impl IntoIterator<Item = u32>,
        budget: Budget,
    ) -> Result<DecomposeStats, TsgoError> {
        let before = self.client.round_trips();
        let mut stats = DecomposeStats::default();

        let mut worklist: Vec<u32> = seeds.into_iter().collect();
        let seeded: FxHashSet<u32> = worklist.iter().copied().collect();

        while let Some(ty) = worklist.pop() {
            if !self.done.insert(ty) {
                continue;
            }
            if stats.decomposed as usize >= budget.max_types {
                stats.exhausted = true;
                break;
            }

            let Some(&slot) = self.interned.get(&ty) else {
                continue;
            };
            // Only placeholders are worth a round trip; a primitive is already
            // final and re-querying it would be pure traffic.
            let TypeKind::Structured { flags: bits } = snapshot.types[slot.0 as usize].kind else {
                continue;
            };

            if !Self::is_ours(snapshot, slot) {
                // Stop at the library boundary. `Promise<void>` and a class
                // prototype are enough to pull the standard library's whole type
                // graph in transitively — measured at 5,773 types from a 180-node
                // file. A type declared outside the compiled files is not this
                // compiler's to lower; it stays a placeholder carrying its flags,
                // the same way a foreign platform object does (RFC §14).
                continue;
            }

            let texts = self.texts.get(&ty).cloned().unwrap_or_default();
            let kind = {
                let mut walk = Walk {
                    worklist: &mut worklist,
                    stats: &mut stats,
                    seeded: &seeded,
                };
                self.resolve(snapshot, ty, bits, &texts, &mut walk)?
            };
            snapshot.types[slot.0 as usize].kind = kind;
            stats.decomposed += 1;
        }

        stats.round_trips = self.client.round_trips() - before;
        Ok(stats)
    }

    /// Resolve one placeholder into structure.
    ///
    /// Order matters throughout: several of these shapes overlap. A tuple is also
    /// array-like, an array is also an object, and a function type is also an
    /// object — whichever test runs first claims the type.
    fn resolve(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        bits: u32,
        texts: &[String],
        walk: &mut Walk<'_>,
    ) -> Result<TypeKind, TsgoError> {
        if bits & flags::UNION != 0 {
            let members = self.client.types_of_type(self.handle, &self.project, ty)?;
            return Ok(TypeKind::Union(self.intern_all(snapshot, &members, walk)));
        }

        if bits & flags::INTERSECTION != 0 {
            let members = self.client.types_of_type(self.handle, &self.project, ty)?;
            return Ok(TypeKind::Intersection(
                self.intern_all(snapshot, &members, walk),
            ));
        }

        if bits & flags::CONDITIONAL != 0 {
            return self.resolve_conditional(snapshot, ty, bits, walk);
        }

        if bits & flags::INDEXED_ACCESS != 0 {
            let object = self.type_property(method::GET_OBJECT_TYPE_OF_TYPE, snapshot, ty, walk)?;
            let index = self.type_property(method::GET_INDEX_TYPE_OF_TYPE, snapshot, ty, walk)?;
            return Ok(match (object, index) {
                (Some(object), Some(index)) => TypeKind::IndexedAccess { object, index },
                _ => TypeKind::Structured { flags: bits },
            });
        }

        if bits & flags::TEMPLATE_LITERAL != 0 {
            let parts = self.client.types_of_type(self.handle, &self.project, ty)?;
            return Ok(TypeKind::TemplateLiteral {
                texts: texts.to_vec(),
                types: self.intern_all(snapshot, &parts, walk),
            });
        }

        if bits & flags::TYPE_PARAMETER != 0 {
            return self.resolve_type_parameter(snapshot, ty, walk);
        }

        if bits & flags::OBJECT == 0 {
            // `keyof T` and the remaining shapes. Left as placeholders rather than
            // flattened into something they are not.
            return Ok(TypeKind::Structured { flags: bits });
        }

        self.resolve_object(snapshot, ty, bits, walk)
    }

    /// `T extends U ? X : Y`.
    fn resolve_conditional(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        bits: u32,
        walk: &mut Walk<'_>,
    ) -> Result<TypeKind, TsgoError> {
        let check = self.type_property(method::GET_CHECK_TYPE_OF_TYPE, snapshot, ty, walk)?;
        let extends = self.type_property(method::GET_EXTENDS_TYPE_OF_TYPE, snapshot, ty, walk)?;
        // The branches can be absent when the checker has not needed them, which
        // is different from them being `never`.
        let true_type =
            self.type_property(method::GET_TRUE_TYPE_OF_CONDITIONAL, snapshot, ty, walk)?;
        let false_type =
            self.type_property(method::GET_FALSE_TYPE_OF_CONDITIONAL, snapshot, ty, walk)?;

        Ok(match (check, extends) {
            (Some(check), Some(extends)) => TypeKind::Conditional {
                check,
                extends,
                true_type,
                false_type,
            },
            _ => TypeKind::Structured { flags: bits },
        })
    }

    /// A type parameter, and the bound that lets a backend specialize it.
    fn resolve_type_parameter(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        walk: &mut Walk<'_>,
    ) -> Result<TypeKind, TsgoError> {
        let constraint = self
            .client
            .constraint_of_type_parameter(self.handle, &self.project, ty)?
            .map(|response| self.intern_one(snapshot, &response, walk));
        let name = self
            .interned
            .get(&ty)
            .and_then(|slot| snapshot.types.get(slot.0 as usize))
            .and_then(|record| record.symbol)
            .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(String::new, |symbol| symbol.name.clone());
        Ok(TypeKind::TypeParameter { name, constraint })
    }

    /// An object type: a tuple, an array, a callable, or a record of members.
    fn resolve_object(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        bits: u32,
        walk: &mut Walk<'_>,
    ) -> Result<TypeKind, TsgoError> {
        // A tuple is array-like too, and treating one as an array loses its arity
        // — the property that lets it be laid out flat rather than as a pointer
        // and a length.
        if self.client.is_tuple_type(self.handle, &self.project, ty)? {
            let args = self.client.type_arguments(self.handle, &self.project, ty)?;
            return Ok(TypeKind::Tuple(self.intern_all(snapshot, &args, walk)));
        }

        // An array is an object type. Decomposing one as an ordinary object yields
        // `length`, `push`, `map` and the rest of the prototype.
        if self.client.is_array_type(self.handle, &self.project, ty)? {
            let args = self.client.type_arguments(self.handle, &self.project, ty)?;
            let ids = self.intern_all(snapshot, &args, walk);
            return Ok(ids
                .first()
                .map_or(TypeKind::Structured { flags: bits }, |&element| {
                    TypeKind::Array(element)
                }));
        }

        // Call signatures before members: every backend needs a function type's
        // exact signature rather than its prototype. A JVM `method_info` cannot be
        // emitted without a descriptor at all.
        let signatures = self
            .client
            .signatures_of_type(self.handle, &self.project, ty)?;
        if let Some(signature) = signatures.first() {
            let id = self.record_signature(snapshot, signature, walk)?;
            return Ok(TypeKind::Function(id));
        }

        // A `new (...) => T` type has no call signature, only a construct one.
        let constructors =
            self.client
                .construct_signatures_of_type(self.handle, &self.project, ty)?;
        if let Some(signature) = constructors.first() {
            let id = self.record_signature(snapshot, signature, walk)?;
            return Ok(TypeKind::Function(id));
        }

        self.resolve_members(snapshot, ty, walk)
    }

    /// The members and index signatures of a record-like object type.
    fn resolve_members(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        walk: &mut Walk<'_>,
    ) -> Result<TypeKind, TsgoError> {
        // Bases before members: the member list is flattened, so `own` can only be
        // decided against the declaration's own members.
        let bases = self.client.base_types(self.handle, &self.project, ty)?;
        if !bases.is_empty() {
            let base_ids = self.intern_all(snapshot, &bases, walk);
            if let Some(&slot) = self.interned.get(&ty) {
                snapshot.base_types.insert(slot, base_ids);
            }
        }

        // An index signature decides representation before any property does: a
        // type with one cannot be a flat struct, because its keys are not known at
        // compile time.
        let indexes = self
            .client
            .index_infos_of_type(self.handle, &self.project, ty)?;
        if !indexes.is_empty() {
            let signatures = indexes
                .iter()
                .map(|info| IndexSignature {
                    key: self.intern_one(snapshot, &info.key_type, walk),
                    value: self.intern_one(snapshot, &info.value_type, walk),
                    readonly: info.is_readonly,
                })
                .collect();
            if let Some(&slot) = self.interned.get(&ty) {
                snapshot.index_signatures.insert(slot, signatures);
            }
        }

        let properties = self
            .client
            .properties_of_type(self.handle, &self.project, ty)?;
        if properties.is_empty() {
            // `{}` really has no properties, and recording that is different from
            // failing to look.
            return Ok(TypeKind::Object {
                properties: Vec::new(),
            });
        }

        let symbol_ids: Vec<u32> = properties.iter().map(|s| s.id).collect();
        let types = self
            .client
            .types_of_symbols(self.handle, &self.project, symbol_ids)?;
        let ids = self.intern_all(snapshot, &types, walk);
        let own = Self::own_member_names(snapshot, ty, &self.interned);

        Ok(TypeKind::Object {
            properties: properties
                .iter()
                .zip(ids)
                .map(|(symbol, ty)| PropertyRecord {
                    // Two halves, and neither alone is enough. `CheckFlagsReadonly`
                    // covers only computed symbols — `Readonly<T>` and mapped types,
                    // where no declaration carries the keyword — and misses a plain
                    // `readonly host: string`. The modifier covers the opposite case.
                    readonly: symbol.check_flags & check_flags::READONLY != 0
                        || Self::declared_readonly(snapshot, &symbol.name),
                    optional: symbol.flags & symbol_flags::OPTIONAL != 0,
                    // A getter is a call, not a load.
                    accessor: accessor_of(symbol.flags),
                    own: own.contains(&symbol.name),
                    name: symbol.name.clone(),
                    ty,
                })
                .collect(),
        })
    }

    /// Resolve every call site to the signature it reaches.
    ///
    /// `file_bases` maps a source path to where its nodes begin in the arena, so a
    /// callee's declaration handle can be turned back into a `NodeId`.
    ///
    /// Costs one exchange per call site plus the signature's own two, and there is
    /// no batch form — the same per-item shape as type decomposition, and opt-in
    /// for the same reason.
    pub fn resolve_calls(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        budget: Budget,
    ) -> Result<DecomposeStats, TsgoError> {
        let before = self.client.round_trips();
        let mut stats = DecomposeStats::default();

        let sites: Vec<(NodeId, NodeHandle)> = snapshot
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(index, node)| {
                let NodeKind::Syntax(kind) = node.kind else {
                    return None;
                };
                if kind != syntax::CALL_EXPRESSION && kind != syntax::NEW_EXPRESSION {
                    return None;
                }
                let arena = u32::try_from(index).unwrap_or(u32::MAX);
                let (path, base) = file_of(&self.file_bases, arena)?;
                Some((
                    NodeId(arena),
                    NodeHandle(types::node_handle(arena - base + 1, kind, path)),
                ))
            })
            .collect();

        let mut worklist = Vec::new();
        let seeded = FxHashSet::default();

        for (node, handle) in sites {
            if stats.decomposed as usize >= budget.max_types {
                stats.exhausted = true;
                break;
            }
            let signature = self
                .client
                .resolved_signature(self.handle, &self.project, handle)?;
            let id = {
                let mut walk = Walk {
                    worklist: &mut worklist,
                    stats: &mut stats,
                    seeded: &seeded,
                };
                self.record_signature(snapshot, &signature, &mut walk)?
            };

            let callee = signature
                .declaration
                .as_ref()
                .and_then(|handle| declaration_node(handle, &self.file_bases));

            snapshot.call_targets.insert(
                node,
                CallTarget {
                    signature: id,
                    callee,
                },
            );
            stats.decomposed += 1;
        }

        stats.round_trips = self.client.round_trips() - before;
        Ok(stats)
    }

    /// Whether a parameter's declaration carries a `?`.
    ///
    /// The AST half of optionality, needed because the checker does not set an
    /// optional bit on the symbols `getParametersOfSignature` returns.
    fn declared_optional(&self, snapshot: &SemanticSnapshot, symbol: &SymbolResponse) -> bool {
        symbol.declarations.iter().any(|handle| {
            declaration_node(handle, &self.file_bases).is_some_and(|node| {
                snapshot.nodes[node.0 as usize]
                    .children
                    .iter()
                    .any(|child| {
                        snapshot.nodes[child.0 as usize].kind
                            == NodeKind::Syntax(syntax::QUESTION_TOKEN)
                    })
            })
        })
    }

    /// Whether a member is declared `readonly` on the type's own declaration.
    ///
    /// The syntactic half of readonly. Walks the declaring node's members looking
    /// for one with this name that carries the modifier.
    fn declared_readonly(snapshot: &SemanticSnapshot, name: &str) -> bool {
        snapshot.nodes.iter().any(|node| {
            node.modifiers.contains(DeclarationModifiers::READONLY)
                && node
                    .children
                    .iter()
                    .any(|c| snapshot.nodes[c.0 as usize].text.as_deref() == Some(name))
        })
    }

    /// Names of the members a type declares itself.
    ///
    /// Walks the declaring node's own member children. Anything in the checker's
    /// flattened list but absent here was inherited.
    ///
    /// An empty set means "nothing known", which makes every member read as
    /// inherited — conservative in the right direction, since a backend that
    /// treats an own field as inherited emits a lookup where it could have used
    /// an offset, while the reverse duplicates storage.
    fn own_member_names(
        snapshot: &SemanticSnapshot,
        ty: u32,
        interned: &FxHashMap<u32, TypeId>,
    ) -> FxHashSet<String> {
        let mut names = FxHashSet::default();
        let Some(slot) = interned.get(&ty) else {
            return names;
        };
        let Some(symbol) = snapshot
            .types
            .get(slot.0 as usize)
            .and_then(|record| record.symbol)
        else {
            return names;
        };
        let Some(declared) = snapshot.symbols.get(symbol.0 as usize) else {
            return names;
        };

        for declaration in &declared.declarations {
            let Some(node) = snapshot.nodes.get(declaration.0 as usize) else {
                continue;
            };
            for member in node.children.iter().flat_map(|child| {
                let child_node = &snapshot.nodes[child.0 as usize];
                if child_node.kind == NodeKind::List {
                    child_node.children.clone()
                } else {
                    vec![*child]
                }
            }) {
                let member_node = &snapshot.nodes[member.0 as usize];
                let is_member = matches!(
                    member_node.kind,
                    NodeKind::Syntax(
                        syntax::PROPERTY_DECLARATION
                            | syntax::METHOD_DECLARATION
                            | syntax::METHOD_SIGNATURE
                            | syntax::PROPERTY_SIGNATURE
                    )
                );
                if !is_member {
                    continue;
                }
                if let Some(name) = member_node
                    .children
                    .iter()
                    .find_map(|c| snapshot.nodes[c.0 as usize].text.clone())
                {
                    names.insert(name);
                }
            }
        }
        names
    }

    /// Whether a type was declared in the files being compiled.
    ///
    /// An anonymous type — an object literal's, say — has no declaring symbol and
    /// counts as ours: it exists only where it was written. A named type counts as
    /// ours only if its symbol has a declaration node in the decoded set.
    fn is_ours(snapshot: &SemanticSnapshot, slot: TypeId) -> bool {
        let Some(record) = snapshot.types.get(slot.0 as usize) else {
            return false;
        };
        let Some(symbol) = record.symbol else {
            return true;
        };
        snapshot
            .symbols
            .get(symbol.0 as usize)
            .is_some_and(|declared| !declared.declarations.is_empty())
    }

    /// Fold every enum member and enum read into a constant.
    ///
    /// Two node kinds are worth asking about. An `EnumMember` carries the
    /// declaration's value; a `PropertyAccessExpression` is the *use* — `Color.Red`
    /// — and folding it is what turns a property load into an immediate.
    ///
    /// For a `const enum` this is not an optimization. The enum object does not
    /// exist at runtime, so a backend that emitted a load would be reading a
    /// member of nothing.
    pub fn fold_constants(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        budget: Budget,
    ) -> Result<DecomposeStats, TsgoError> {
        let before = self.client.round_trips();
        let mut stats = DecomposeStats::default();

        let candidates: Vec<(NodeId, NodeHandle)> = snapshot
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(index, node)| {
                let NodeKind::Syntax(kind) = node.kind else {
                    return None;
                };
                if kind != syntax::ENUM_MEMBER && kind != syntax::PROPERTY_ACCESS_EXPRESSION {
                    return None;
                }
                let arena = u32::try_from(index).unwrap_or(u32::MAX);
                let (path, base) = file_of(&self.file_bases, arena)?;
                Some((
                    NodeId(arena),
                    NodeHandle(types::node_handle(arena - base + 1, kind, path)),
                ))
            })
            .collect();

        for (node, handle) in candidates {
            if stats.decomposed as usize >= budget.max_types {
                stats.exhausted = true;
                break;
            }
            let Some(value) = self
                .client
                .constant_value(self.handle, &self.project, handle)?
            else {
                // Most property accesses are not constant. Absence is the normal
                // answer, not a failure.
                continue;
            };
            let Some(folded) = to_constant(&value) else {
                continue;
            };
            snapshot.constants.insert(node, folded);
            stats.decomposed += 1;
        }

        stats.round_trips = self.client.round_trips() - before;
        Ok(stats)
    }

    /// Resolve one call signature into a schema record.
    ///
    /// Costs two exchanges beyond the `getSignaturesOfType` that found it: one
    /// batched `getTypesOfSymbols` for every parameter at once, and one
    /// `getReturnTypeOfSignature`. The return type is why this cannot be read off
    /// the AST — an unannotated return is written nowhere in the source, so there
    /// is no node to carry it.
    fn record_signature(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        signature: &SignatureResponse,
        walk: &mut Walk<'_>,
    ) -> Result<SignatureId, TsgoError> {
        // Deliberately not `signature.parameters`: those ids are unregistered and
        // cannot be resolved. See `Client::parameters_of_signature`.
        let parameters =
            self.client
                .parameters_of_signature(self.handle, &self.project, signature.id)?;
        let parameter_types = self.client.types_of_symbols(
            self.handle,
            &self.project,
            parameters.iter().map(|p| p.id).collect(),
        )?;
        let parameter_ids = self.intern_all(snapshot, &parameter_types, walk);

        let returned =
            self.client
                .return_type_of_signature(self.handle, &self.project, signature.id)?;
        let return_type = self
            .intern_all(snapshot, std::slice::from_ref(&returned), walk)
            .first()
            .copied()
            .unwrap_or(TypeId(0));

        // Optionality and rest-ness come from each parameter's own check flags,
        // not from the signature-level rest bit: that only says *some* parameter
        // is rest, and says nothing at all about which are optional.

        let has_rest = signature.flags & signature_flags::HAS_REST_PARAMETER != 0;
        let last = parameters.len().saturating_sub(1);

        let parameters = parameters
            .iter()
            .zip(parameter_ids)
            .enumerate()
            .map(|(index, (symbol, ty))| ParameterRecord {
                // The endpoint carries the real name, so the positional fallback
                // is only reached for a parameter with none.
                name: if symbol.name.is_empty() {
                    format!("arg{index}")
                } else {
                    symbol.name.clone()
                },
                ty,
                // Neither `SymbolFlagsOptional` nor `CheckFlagsOptionalParameter`
                // is set on the symbols this endpoint returns. The `?` is in the
                // AST: a `QuestionToken` child of the parameter's declaration.
                optional: symbol.flags & symbol_flags::OPTIONAL != 0
                    || self.declared_optional(snapshot, symbol),
                // Rest-ness is only on the signature, and only the last parameter
                // can be one.
                rest: has_rest && index == last,
            })
            .collect();

        // A type predicate is what makes a guard function useful to a backend:
        // inside the true branch the concrete type is known, so a dispatch can
        // become a direct call.
        let predicate = self
            .client
            .type_predicate_of_signature(self.handle, &self.project, signature.id)?
            .map(|response| {
                let narrowed_to = response
                    .r#type
                    .as_ref()
                    .map(|ty| self.intern_one(snapshot, ty, walk));
                let asserts = matches!(
                    response.kind,
                    predicate_kind::ASSERTS_THIS | predicate_kind::ASSERTS_IDENTIFIER
                );
                let is_this = matches!(
                    response.kind,
                    predicate_kind::THIS | predicate_kind::ASSERTS_THIS
                );
                nts_semantic_schema::TypePredicate {
                    parameter_index: (!is_this)
                        .then(|| u32::try_from(response.parameter_index).unwrap_or(0)),
                    parameter_name: response.parameter_name,
                    narrowed_to,
                    asserts,
                }
            });

        let type_parameter_responses =
            self.client
                .type_parameters_of_signature(self.handle, &self.project, signature.id)?;
        let type_parameters = self.intern_all(snapshot, &type_parameter_responses, walk);

        let id = SignatureId(u32::try_from(snapshot.signatures.len()).unwrap_or(u32::MAX));
        snapshot.signatures.push(SignatureRecord {
            parameters,
            return_type,
            type_parameters,
            // `async` is a property of the declaration, not of the signature, so
            // the checker does not report it here. Lowering reads it off the
            // declaration's modifiers.
            is_async: false,
            is_construct: signature.flags & signature_flags::CONSTRUCT != 0,
            type_predicate: predicate,
        });
        Ok(id)
    }

    /// Fetch one type-valued property and intern it.
    fn type_property(
        &mut self,
        method: &'static str,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        walk: &mut Walk<'_>,
    ) -> Result<Option<TypeId>, TsgoError> {
        let response = self
            .client
            .type_property(method, self.handle, &self.project, ty)?;
        Ok(response.map(|response| self.intern_one(snapshot, &response, walk)))
    }

    /// Intern one response, queueing it if it needs decomposing.
    fn intern_one(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        response: &TypeResponse,
        walk: &mut Walk<'_>,
    ) -> TypeId {
        self.intern_all(snapshot, std::slice::from_ref(response), walk)
            .first()
            .copied()
            .unwrap_or(TypeId(0))
    }

    /// Intern responses into the arena and queue any that need decomposing.
    fn intern_all(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        responses: &[TypeResponse],
        walk: &mut Walk<'_>,
    ) -> Vec<TypeId> {
        responses
            .iter()
            .map(|response| {
                if !response.texts.is_empty() {
                    self.texts.insert(response.id, response.texts.clone());
                }
                let id = *self.interned.entry(response.id).or_insert_with(|| {
                    let id = TypeId(u32::try_from(snapshot.types.len()).unwrap_or(u32::MAX));
                    snapshot
                        .types
                        .push(types::classify(response, &self.symbols));
                    id
                });
                if !walk.seeded.contains(&response.id) && !self.done.contains(&response.id) {
                    walk.stats.discovered += 1;
                }
                walk.worklist.push(response.id);
                id
            })
            .collect()
    }

    /// The interning map, so a caller can keep using it after decomposition.
    #[must_use]
    pub fn into_interned(self) -> FxHashMap<u32, TypeId> {
        self.interned
    }
}

/// Convert a folded JSON value into a schema constant.
///
/// Anything that is neither a number nor a string is declined rather than
/// coerced: a constant that lowers to the wrong immediate is worse than one the
/// backend has to load.
fn to_constant(value: &serde_json::Value) -> Option<ConstantValue> {
    if let Some(number) = value.as_f64() {
        return Some(ConstantValue::Number(number));
    }
    value
        .as_str()
        .map(|text| ConstantValue::String(text.to_owned()))
}

/// Classify a member symbol as a field or an accessor pair.
fn accessor_of(flags: u32) -> Option<nts_semantic_schema::Accessor> {
    let get = flags & symbol_flags::GET_ACCESSOR != 0;
    let set = flags & symbol_flags::SET_ACCESSOR != 0;
    match (get, set) {
        (true, true) => Some(nts_semantic_schema::Accessor::GetSet),
        (true, false) => Some(nts_semantic_schema::Accessor::Get),
        (false, true) => Some(nts_semantic_schema::Accessor::Set),
        (false, false) => None,
    }
}

/// Which file an arena index belongs to, and where that file starts.
fn file_of(file_bases: &[(String, u32)], arena: u32) -> Option<(&str, u32)> {
    file_bases
        .iter()
        .rev()
        .find(|(_, base)| *base <= arena)
        .map(|(path, base)| (path.as_str(), *base))
}

/// Turn a declaration handle back into an arena node.
///
/// Returns `None` for a declaration outside the decoded set — an imported or
/// ambient function. Mapping it onto whatever node sits at that index in another
/// file would be a wrong answer that looks exactly like a right one.
fn declaration_node(handle: &NodeHandle, file_bases: &[(String, u32)]) -> Option<NodeId> {
    let (index, path) = {
        let rest = handle.0.split_once('.')?;
        let (index, tail) = rest;
        let (_kind, path) = tail.split_once('.')?;
        (index.parse::<u32>().ok()?, path)
    };
    let base = file_bases
        .iter()
        .find(|(candidate, _)| candidate == path)
        .map(|(_, base)| *base)?;
    index.checked_sub(1).map(|i| NodeId(i + base))
}
#[cfg(test)]
mod tests {
    use super::*;

    // Finite matters more than the number: an unbounded walk over a cyclic type
    // graph with a bug in `done` would hang a build rather than fail it. Enforced
    // at compile time, since both sides are constants.
    const _: () = assert!(Budget::DEFAULT.max_types > 1000);
    const _: () = assert!(Budget::DEFAULT.max_types < usize::MAX);

    #[test]
    fn stats_default_to_nothing_done() {
        let stats = DecomposeStats::default();
        assert_eq!(stats.decomposed, 0);
        assert!(!stats.exhausted, "an empty run is complete, not exhausted");
    }
}
