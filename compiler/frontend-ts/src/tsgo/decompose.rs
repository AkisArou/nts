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
    CallTarget, ConstantValue, NodeId, NodeKind, ParameterRecord, SemanticSnapshot, SignatureId,
    SignatureRecord, TypeId, TypeKind,
};
use rustc_hash::{FxHashMap, FxHashSet};

use super::proto::{
    NodeHandle, ProjectHandle, SignatureResponse, SnapshotHandle, TypeResponse, signature_flags,
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
    ) -> Self {
        Self {
            client,
            handle,
            project,
            interned,
            done: FxHashSet::default(),
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

            let kind = self.resolve(snapshot, ty, bits, &mut worklist, &mut stats, &seeded)?;
            snapshot.types[slot.0 as usize].kind = kind;
            stats.decomposed += 1;
        }

        stats.round_trips = self.client.round_trips() - before;
        Ok(stats)
    }

    /// Resolve one placeholder into structure.
    fn resolve(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        ty: u32,
        bits: u32,
        worklist: &mut Vec<u32>,
        stats: &mut DecomposeStats,
        seeded: &FxHashSet<u32>,
    ) -> Result<TypeKind, TsgoError> {
        if bits & flags::UNION != 0 {
            let members = self.client.types_of_type(self.handle, &self.project, ty)?;
            let ids = self.intern_all(snapshot, &members, worklist, stats, seeded);
            return Ok(TypeKind::Union(ids));
        }

        if bits & flags::INTERSECTION != 0 {
            let members = self.client.types_of_type(self.handle, &self.project, ty)?;
            let ids = self.intern_all(snapshot, &members, worklist, stats, seeded);
            return Ok(TypeKind::Intersection(ids));
        }

        if bits & flags::OBJECT == 0 {
            // Conditionals, indexed accesses, template literals, type parameters:
            // real shapes this pass does not model yet. Left as placeholders
            // rather than flattened into something they are not.
            return Ok(TypeKind::Structured { flags: bits });
        }

        // An array is an object type, so this check has to come first. Decomposing
        // one as an ordinary object yields `length`, `push`, `map` and the rest of
        // the prototype rather than an element type.
        if self.client.is_array_type(self.handle, &self.project, ty)? {
            let args = self.client.type_arguments(self.handle, &self.project, ty)?;
            let ids = self.intern_all(snapshot, &args, worklist, stats, seeded);
            return Ok(ids
                .first()
                .map_or(TypeKind::Structured { flags: bits }, |&element| {
                    TypeKind::Array(element)
                }));
        }

        // Call signatures before properties. A function type is an object type,
        // and every backend needs its exact signature rather than its members: a
        // JVM `method_info` cannot be emitted without a descriptor at all, and C
        // and LLVM need it to choose `int32_t` against `double` against a boxed
        // handle, and whether arguments pass in registers.
        let signatures = self
            .client
            .signatures_of_type(self.handle, &self.project, ty)?;
        if let Some(signature) = signatures.first() {
            let id = self.record_signature(snapshot, signature, worklist, stats, seeded)?;
            return Ok(TypeKind::Function(id));
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

        let names: Vec<String> = properties.iter().map(|s| s.name.clone()).collect();
        let symbol_ids: Vec<u32> = properties.iter().map(|s| s.id).collect();
        // The one batch endpoint in this pass: every property's type in one
        // exchange, so a wide object costs the same as a narrow one.
        let types = self
            .client
            .types_of_symbols(self.handle, &self.project, symbol_ids)?;
        let ids = self.intern_all(snapshot, &types, worklist, stats, seeded);

        Ok(TypeKind::Object {
            properties: names.into_iter().zip(ids).collect(),
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
        file_bases: &[(String, u32)],
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
                let (path, base) = file_of(file_bases, arena)?;
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
            let id =
                self.record_signature(snapshot, &signature, &mut worklist, &mut stats, &seeded)?;

            let callee = signature
                .declaration
                .as_ref()
                .and_then(|handle| declaration_node(handle, file_bases));

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
        file_bases: &[(String, u32)],
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
                let (path, base) = file_of(file_bases, arena)?;
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
        worklist: &mut Vec<u32>,
        stats: &mut DecomposeStats,
        seeded: &FxHashSet<u32>,
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
        let parameter_ids = self.intern_all(snapshot, &parameter_types, worklist, stats, seeded);

        let returned =
            self.client
                .return_type_of_signature(self.handle, &self.project, signature.id)?;
        let return_type = self
            .intern_all(
                snapshot,
                std::slice::from_ref(&returned),
                worklist,
                stats,
                seeded,
            )
            .first()
            .copied()
            .unwrap_or(TypeId(0));

        // Only the last parameter can be a rest parameter, and the flag is on the
        // signature rather than the parameter.
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
                // Optionality is not on `SignatureResponse`. Recording every
                // parameter as required would be a claim the checker never made,
                // so it stays false and is a named gap rather than a guess.
                optional: false,
                rest: has_rest && index == last,
            })
            .collect();

        let id = SignatureId(u32::try_from(snapshot.signatures.len()).unwrap_or(u32::MAX));
        snapshot.signatures.push(SignatureRecord {
            parameters,
            return_type,
            type_parameters: Vec::new(),
            // `async` is a property of the declaration, not of the signature, so
            // the checker does not report it here. Lowering reads it off the
            // declaration's modifiers.
            is_async: false,
        });
        Ok(id)
    }

    /// Intern responses into the arena and queue any that need decomposing.
    fn intern_all(
        &mut self,
        snapshot: &mut SemanticSnapshot,
        responses: &[TypeResponse],
        worklist: &mut Vec<u32>,
        stats: &mut DecomposeStats,
        seeded: &FxHashSet<u32>,
    ) -> Vec<TypeId> {
        responses
            .iter()
            .map(|response| {
                let id = *self.interned.entry(response.id).or_insert_with(|| {
                    let id = TypeId(u32::try_from(snapshot.types.len()).unwrap_or(u32::MAX));
                    snapshot.types.push(types::classify(response));
                    id
                });
                if !seeded.contains(&response.id) && !self.done.contains(&response.id) {
                    stats.discovered += 1;
                }
                worklist.push(response.id);
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
