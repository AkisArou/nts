//! Follow reachable native type structure without recursive arena insertion.

use nts_frontend_tsrs::{self as native, Type};
use nts_semantic_schema::{
    Accessor, IndexSignature, MemberKind, NodeKind, PropertyRecord, SignatureId, SnapshotError,
    SymbolFlags, TypeId, TypeKind, syntax,
};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{Capture, symbols::required_text};

#[cfg(test)]
#[path = "graph_test.rs"]
mod tests;

impl<'p> Capture<'p, '_> {
    pub(super) fn expand_types(&mut self, seeds: Vec<TypeId>) -> Result<(), SnapshotError> {
        let allowance = seeds.len().saturating_mul(16).max(4096);
        self.expand_types_with_allowance(seeds, allowance)
    }

    fn expand_types_with_allowance(
        &mut self,
        seeds: Vec<TypeId>,
        allowance: usize,
    ) -> Result<(), SnapshotError> {
        // Explicit native overloads can have distinct inline parameter types
        // behind one callable type. Follow only their already-owned syntax
        // edges when that callable is actually reached, through the same
        // charged expansion queue as every other type dependency.
        let native_parameters = native_parameter_demands(&self.snapshot)?;
        let mut work = seeds;
        let mut expanded = FxHashSet::default();
        let mut next = 0;
        let mut decomposed = 0;
        let mut forms = Vec::new();
        let mut deferred_forms = FxHashSet::default();
        let mut form_level = None;
        let mut storage = StorageDemands::default();
        loop {
            let storage_id = storage.pending.pop();
            let Some(&id) = storage_id.as_ref().or_else(|| work.get(next)) else {
                // Concrete types get the whole first pass. Own generic forms and
                // their discoveries advance breadth-first for three levels, as in
                // the existing builder: never the closure of fresh instantiations.
                let level = form_level.map_or(0, |level| level + 1);
                if forms.is_empty() || level == 3 {
                    break;
                }
                work = std::mem::take(&mut forms);
                next = 0;
                form_level = Some(level);
                continue;
            };
            if storage_id.is_none() {
                next += 1;
            }
            let ty = self.type_work[id.0 as usize];
            if storage_id.is_some()
                && (expanded.contains(&id)
                    || !matches!(
                        self.snapshot.types[id.0 as usize].kind,
                        TypeKind::Unsupported { .. } | TypeKind::Structured
                    ))
            {
                self.follow_storage(id, &mut storage);
            }
            // A generic signature's shallow return can be requested later by
            // a real call contract, syntax fact or member. It remains eligible
            // until an actual expansion enters `expanded` below.
            if !matches!(
                self.snapshot.types[id.0 as usize].kind,
                TypeKind::Unsupported { .. } | TypeKind::Structured
            ) || matches!(
                ty.kind(),
                native::TypeKind::Other | native::TypeKind::Literal
            ) {
                continue;
            }
            // A deferred form can occur again in the concrete queue. That is
            // not an expansion: marking it done there would suppress its later
            // form pass, depending on how many paths reached the same type.
            if !expanded.insert(id) {
                continue;
            }
            if decomposed >= allowance {
                self.record_exhausted_budget(allowance);
                break;
            }
            // Charge before every native service, including generic-form
            // classification/argument queries which can discover a fresh
            // provided-container instantiation without expanding its members.
            // Owned-edge-only replay above performs no native service.
            decomposed += 1;
            #[cfg(test)]
            self.type_query_trace.push(TypeQuery::Service(id));
            // Copied class methods need the finite contracts of carried
            // iteration/result types even at their owner's parameters. The
            // member boundary below already promises these shapes; applying
            // generic deferral first would hide them from ABI substitution.
            // Generic signatures still leave their unused returns shallow.
            let carried = self.snapshot.types[id.0 as usize]
                .symbol
                .is_some_and(|symbol| carries_members(&self.snapshot.symbols[symbol.0 as usize]));
            if !carried && generic_form(ty) && (form_level.is_none() || !self.declares_form(id, ty))
            {
                self.record_arguments(id, ty, &mut work)?;
                self.snapshot.types[id.0 as usize].kind = TypeKind::Structured;
                if self.member_boundary(id) == MemberBoundary::Provided {
                    self.follow_storage(id, &mut storage);
                }
                if self.declares_form(id, ty) {
                    expanded.remove(&id);
                    if deferred_forms.insert(id) {
                        forms.push(id);
                    }
                }
                continue;
            }
            let mut discoveries = Vec::new();
            self.snapshot.types[id.0 as usize].kind = self.expand_type(id, ty, &mut discoveries)?;
            if matches!(
                self.snapshot.types[id.0 as usize].kind,
                TypeKind::Function(_)
            ) && let Some(parameters) = native_parameters.get(&id)
            {
                discoveries.extend(parameters);
            }
            if storage_id.is_some() || self.member_boundary(id) == MemberBoundary::Provided {
                self.follow_storage(id, &mut storage);
            }
            if form_level.is_some() {
                forms.extend(discoveries);
            } else {
                work.extend(discoveries);
            }
        }
        Ok(())
    }

    fn record_exhausted_budget(&mut self, allowance: usize) {
        #[cfg(test)]
        self.type_query_trace.push(TypeQuery::Exhausted);
        self.type_budget_exhausted = true;
        self.snapshot.diagnostics.push(nts_diagnostics::Diagnostic {
            severity: nts_diagnostics::Severity::Warning,
            code: "NTS0003".into(),
            message: format!("the type graph is partial: native capture stopped at its budget of {allowance} types"),
            primary: nts_diagnostics::Location { file: nts_diagnostics::SourceId(0), span: nts_diagnostics::Span::new(0, 0) },
            labels: Vec::new(),
        });
    }

    /// Provided containers need their payload's storage shape for
    /// `provided_representation`/`slot_for`, including anonymous fields, unions
    /// and arrays. These ABI dependencies use the same expansion/budget loop;
    /// they do not consume another generic-form level or open library members.
    fn follow_storage(&mut self, id: TypeId, storage: &mut StorageDemands) {
        if !storage.followed.insert(id) {
            return;
        }
        #[cfg(test)]
        self.type_query_trace.push(TypeQuery::Owned(id));
        let record = &self.snapshot.types[id.0 as usize];
        let mut dependencies = Vec::new();
        match &record.kind {
            TypeKind::Structured if self.member_boundary(id) == MemberBoundary::Provided => {
                dependencies.extend(self.snapshot.type_arguments.get(&id).into_iter().flatten());
            }
            TypeKind::Array(element) => dependencies.push(element),
            TypeKind::Tuple(parts) | TypeKind::Union(parts) | TypeKind::Intersection(parts) => {
                dependencies.extend(parts);
            }
            TypeKind::Object { properties } => {
                dependencies.extend(properties.iter().map(|property| &property.ty));
            }
            TypeKind::Function(signature) => {
                let signature = &self.snapshot.signatures[signature.0 as usize];
                dependencies.extend(signature.parameters.iter().map(|parameter| &parameter.ty));
                dependencies.extend(signature.this_type.as_ref());
                // A generic callable's unused return remains shallow even when
                // the callable itself is stored in a payload.
                if signature.type_parameters.is_empty() {
                    dependencies.push(&signature.return_type);
                }
            }
            _ => {}
        }
        dependencies.extend(self.snapshot.base_types.get(&id).into_iter().flatten());
        for index in self
            .snapshot
            .index_signatures
            .get(&id)
            .into_iter()
            .flatten()
        {
            dependencies.extend([&index.key, &index.value]);
        }
        for &dependency in dependencies {
            // A named program class/interface still follows the three form
            // levels. Its members are not an anonymous storage wrapper.
            if !self.has_nominal_declaration(dependency) && storage.requested.insert(dependency) {
                storage.pending.push(dependency);
            }
        }
    }

    fn reached_type(
        &mut self,
        ty: Type<'p>,
        work: &mut Vec<TypeId>,
    ) -> Result<TypeId, SnapshotError> {
        let id = self.intern_type(ty)?;
        work.push(id);
        Ok(id)
    }

    fn reached_types(
        &mut self,
        types: impl IntoIterator<Item = Type<'p>>,
        work: &mut Vec<TypeId>,
    ) -> Result<Vec<TypeId>, SnapshotError> {
        types
            .into_iter()
            .map(|ty| self.reached_type(ty, work))
            .collect()
    }

    fn expand_type(
        &mut self,
        id: TypeId,
        ty: Type<'p>,
        work: &mut Vec<TypeId>,
    ) -> Result<TypeKind, SnapshotError> {
        use native::TypeKind as N;

        #[cfg(test)]
        self.type_query_trace.push(TypeQuery::Expansion(id));
        let unsupported = || TypeKind::Unsupported {
            rendered: format!(
                "a native {:?} type without its required semantic data",
                ty.kind()
            ),
        };
        Ok(match ty.kind() {
            N::Union => match ty.constituents() {
                Some(parts) => TypeKind::Union(self.reached_types(parts, work)?),
                None => unsupported(),
            },
            N::Intersection => match ty.constituents() {
                Some(parts) => TypeKind::Intersection(self.reached_types(parts, work)?),
                None => unsupported(),
            },
            N::TypeParameter => match ty.type_parameter() {
                Some(parameter) => TypeKind::TypeParameter {
                    name: required_text(parameter.name, "type parameter name")?.to_owned(),
                    is_this: parameter.is_this,
                    constraint: match parameter.constraint {
                        Some(ty) => Some(self.reached_type(ty, work)?),
                        None => None,
                    },
                },
                None => unsupported(),
            },
            N::Conditional => match ty.conditional() {
                Some(conditional) => TypeKind::Conditional {
                    check: self.reached_type(conditional.check, work)?,
                    extends: self.reached_type(conditional.extends, work)?,
                    true_type: Some(self.reached_type(conditional.true_type, work)?),
                    false_type: Some(self.reached_type(conditional.false_type, work)?),
                },
                None => unsupported(),
            },
            N::IndexedAccess => match ty.indexed_access() {
                Some(indexed) => TypeKind::IndexedAccess {
                    object: self.reached_type(indexed.object, work)?,
                    index: self.reached_type(indexed.index, work)?,
                },
                None => unsupported(),
            },
            N::Template => match ty.template() {
                Some(template) => TypeKind::TemplateLiteral {
                    texts: template
                        .texts
                        .into_iter()
                        .map(|text| required_text(text, "template type segment").map(str::to_owned))
                        .collect::<Result<_, _>>()?,
                    types: self.reached_types(template.types, work)?,
                },
                None => unsupported(),
            },
            N::Object | N::Reference | N::Tuple => self.expand_object(id, ty, work)?,
            _ => unsupported(),
        })
    }

    fn expand_object(
        &mut self,
        id: TypeId,
        ty: Type<'p>,
        work: &mut Vec<TypeId>,
    ) -> Result<TypeKind, SnapshotError> {
        if let Some(elements) = ty.tuple_elements() {
            return Ok(TypeKind::Tuple(self.reached_types(elements, work)?));
        }
        let arguments = self.record_arguments(id, ty, work)?;
        if ty.is_array() {
            return Ok(match arguments.first() {
                Some(element) => TypeKind::Array(*element),
                None => TypeKind::Unsupported {
                    rendered: "a native array without its element type".into(),
                },
            });
        }
        let boundary = self.member_boundary(id);
        if boundary == MemberBoundary::Provided {
            return Ok(TypeKind::Structured);
        }
        if let Some(signature) = self.callable(ty, work)? {
            return Ok(TypeKind::Function(signature));
        }
        if boundary == MemberBoundary::Library {
            return Ok(TypeKind::Structured);
        }
        let bases = self.reached_types(ty.bases(), work)?;
        if !bases.is_empty() {
            self.snapshot.base_types.insert(id, bases);
        }
        let mut indexes = Vec::new();
        for index in ty.index_signatures() {
            indexes.push(IndexSignature {
                key: self.reached_type(index.key, work)?,
                value: self.reached_type(index.value, work)?,
                readonly: index.readonly,
            });
        }
        if !indexes.is_empty() {
            self.snapshot.index_signatures.insert(id, indexes);
        }
        let own: Vec<_> = ty
            .symbol()
            .into_iter()
            .flat_map(nts_frontend_tsrs::Symbol::declarations)
            .collect();
        let mut properties = Vec::new();
        for property in ty.properties() {
            let declaration = property
                .declarations
                .iter()
                .find_map(|node| self.nodes.get(node).copied());
            let own = property.declarations.iter().any(|node| {
                let mut at = node.parent();
                while let Some(parent) = at {
                    if own.contains(&parent) {
                        return true;
                    }
                    at = parent.parent();
                }
                false
            });
            let member_type = if boundary == MemberBoundary::ForeignMembers {
                self.shallow_type(property.ty)?
            } else {
                self.reached_type(property.ty, work)?
            };
            properties.push(PropertyRecord {
                name: self.property_key(property.name)?,
                ty: member_type,
                readonly: property.readonly,
                optional: property.optional,
                declaration,
                kind: match property.kind {
                    native::PropertyKind::Field => MemberKind::Field,
                    native::PropertyKind::Method => MemberKind::Method,
                    native::PropertyKind::Getter => MemberKind::Accessor(Accessor::Get),
                    native::PropertyKind::Setter => MemberKind::Accessor(Accessor::Set),
                    native::PropertyKind::GetterSetter => MemberKind::Accessor(Accessor::GetSet),
                },
                own,
            });
        }
        Ok(TypeKind::Object { properties })
    }

    fn callable(
        &mut self,
        ty: Type<'p>,
        work: &mut Vec<TypeId>,
    ) -> Result<Option<SignatureId>, SnapshotError> {
        for (kind, construct) in [
            (native::SignatureKind::Call, false),
            (native::SignatureKind::Construct, true),
        ] {
            if let Some(signature) = ty.signatures(kind).first().copied() {
                let signature = self.intern_signature(signature, construct)?;
                let record = &self.snapshot.signatures[signature.0 as usize];
                work.extend(record.parameters.iter().map(|parameter| parameter.ty));
                let returned = record.return_type;
                let generic = !record.type_parameters.is_empty();
                if !generic {
                    work.push(returned);
                }
                work.extend(record.type_parameters.iter().copied());
                work.extend(record.this_type);
                work.extend(
                    record
                        .type_predicate
                        .as_ref()
                        .and_then(|predicate| predicate.narrowed_to),
                );
                if generic
                    && matches!(
                        &self.snapshot.types[returned.0 as usize].kind,
                        TypeKind::Unsupported { rendered }
                            if rendered == "a native type whose graph has not been requested"
                    )
                {
                    // An uninstantiated generic contract records a shallow
                    // return. Resolving it here can generate fresh FlatArray
                    // instantiations forever. Reached call contracts seed their
                    // actual returns separately; a subsequent request reopens
                    // this slot through the same worklist eligibility rule.
                    self.snapshot.types[returned.0 as usize].kind = TypeKind::Structured;
                }
                return Ok(Some(signature));
            }
        }
        Ok(None)
    }

    fn record_arguments(
        &mut self,
        id: TypeId,
        ty: Type<'p>,
        work: &mut Vec<TypeId>,
    ) -> Result<Vec<TypeId>, SnapshotError> {
        #[cfg(test)]
        self.type_query_trace.push(TypeQuery::Arguments(id));
        let Some(reference) = ty.reference() else {
            return Ok(Vec::new());
        };
        // Carried dispatch is the current consumer of this fact. Do not add
        // unused arity metadata to every other library/program reference.
        if nts_semantic_schema::iteration_protocol_of(&self.snapshot, id).is_some()
            && let Some(count) = reference.declared_parameter_count
        {
            self.snapshot
                .reference_parameter_counts
                .insert(id, super::arena_index(count)?);
        }
        let arguments = self.reached_types(reference.arguments, work)?;
        self.snapshot.type_arguments.insert(id, arguments.clone());
        Ok(arguments)
    }

    /// The existing builder's single member boundary. Arrays and tuples are
    /// handled before this call: their library declaration never hides their
    /// element storage. Every other object enters through this decision.
    fn member_boundary(&self, id: TypeId) -> MemberBoundary {
        let Some(symbol_id) = self.snapshot.types[id.0 as usize].symbol else {
            return MemberBoundary::Expand;
        };
        let symbol = &self.snapshot.symbols[symbol_id.0 as usize];
        if !self.snapshot.implements_its_own(symbol_id)
            && matches!(
                symbol.name.public_name(),
                Some(
                    "Promise"
                        | "Map"
                        | "ReadonlyMap"
                        | "Set"
                        | "ReadonlySet"
                        | "Generator"
                        | "AsyncGenerator"
                        | "Date"
                )
            )
        {
            return MemberBoundary::Provided;
        }
        if symbol.declarations.is_empty() && !carries_members(symbol) {
            return MemberBoundary::Library;
        }
        let foreign_class = symbol.declarations.iter().any(|id| {
            self.snapshot.nodes[id.0 as usize]
                .native
                .as_deref()
                .is_some_and(|native| native.class.is_some() || native.protocol.is_some())
        });
        let declared_module = symbol.flags.contains(SymbolFlags::MODULE)
            && !symbol.declarations.is_empty()
            && symbol.declarations.iter().all(|id| {
                let node = &self.snapshot.nodes[id.0 as usize];
                nts_semantic_schema::reachability::is_declaration_file(
                    self.snapshot.sources[node.origin.location.file.0 as usize]
                        .display_path
                        .as_str(),
                )
            });
        if foreign_class || declared_module {
            MemberBoundary::ForeignMembers
        } else {
            MemberBoundary::Expand
        }
    }

    fn declares_form(&self, id: TypeId, ty: Type<'p>) -> bool {
        self.has_nominal_declaration(id)
            && ty.reference().is_some_and(|reference| {
                reference
                    .arguments
                    .iter()
                    .all(|arg| arg.kind() == native::TypeKind::TypeParameter)
            })
    }

    fn has_nominal_declaration(&self, id: TypeId) -> bool {
        self.snapshot.types[id.0 as usize]
            .symbol
            .is_some_and(|symbol| {
                self.snapshot.symbols[symbol.0 as usize]
                    .declarations
                    .iter()
                    .any(|id| {
                        matches!(
                            self.snapshot.nodes[id.0 as usize].kind,
                            NodeKind::Syntax(
                                syntax::CLASS_DECLARATION
                                    | syntax::CLASS_EXPRESSION
                                    | syntax::INTERFACE_DECLARATION
                            )
                        )
                    })
            })
    }
}

/// Parameter edges from explicitly native method declarations, grouped once
/// by the callable type capture already owns. Building this index performs no
/// checker query and makes no new root; unreferenced library methods remain
/// shallow. Discovery order follows source nodes and written parameters.
fn native_parameter_demands(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Result<FxHashMap<TypeId, Vec<TypeId>>, SnapshotError> {
    let mut demands: FxHashMap<TypeId, Vec<TypeId>> = FxHashMap::default();
    let mut seen = FxHashSet::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if !matches!(
            node.kind,
            NodeKind::Syntax(syntax::METHOD_SIGNATURE | syntax::METHOD_DECLARATION)
        ) || node
            .native
            .as_ref()
            .is_none_or(|native| native.symbol.is_none())
        {
            continue;
        }
        let id = nts_semantic_schema::NodeId(super::arena_index(index)?);
        let Some(&callable) = snapshot.node_types.get(&id) else {
            continue;
        };
        for parameter in nts_semantic_schema::walk::children(snapshot, id) {
            if nts_semantic_schema::walk::kind_of(snapshot, parameter) != Some(syntax::PARAMETER) {
                continue;
            }
            if let Some(&ty) = snapshot.node_types.get(&parameter)
                && seen.insert((callable, ty))
            {
                demands.entry(callable).or_default().push(ty);
            }
        }
    }
    Ok(demands)
}

/// Pending storage edges and already followed owned shapes are separate from
/// native expansion: a shape reached earlier can acquire an ABI demand later
/// without querying it twice or losing that newly required dependency.
#[derive(Default)]
struct StorageDemands {
    pending: Vec<TypeId>,
    requested: FxHashSet<TypeId>,
    followed: FxHashSet<TypeId>,
}

/// Test-only observations at the actual service/argument/expansion boundaries.
/// No native query or extra checker work is performed by the observer.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TypeQuery {
    Service(TypeId),
    Arguments(TypeId),
    Expansion(TypeId),
    Owned(TypeId),
    Exhausted,
}

/// The explicit library contracts whose members lowering already consumes.
fn carries_members(symbol: &nts_semantic_schema::SymbolRecord) -> bool {
    matches!(
        symbol.name.public_name(),
        Some("PromiseWithResolvers" | "IteratorYieldResult" | "IteratorReturnResult")
    ) || symbol
        .name
        .public_name()
        .is_some_and(nts_semantic_schema::is_an_iteration_protocol)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MemberBoundary {
    Expand,
    /// Owned by another program/library; callable contracts are still needed.
    Library,
    /// nts already supplies its storage and behaviour; only arguments matter.
    Provided,
    /// Record foreign members without traversing an entire framework.
    ForeignMembers,
}

fn generic_form(ty: Type<'_>) -> bool {
    fn mentions_parameter(ty: Type<'_>, depth: u8) -> bool {
        if depth > 8 {
            return false;
        }
        match ty.kind() {
            native::TypeKind::TypeParameter => true,
            native::TypeKind::Union => ty.constituents().is_some_and(|parts| {
                parts
                    .into_iter()
                    .any(|part| mentions_parameter(part, depth + 1))
            }),
            _ => false,
        }
    }
    if ty.is_array() || ty.kind() == native::TypeKind::Tuple {
        return false;
    }
    ty.reference().is_some_and(|reference| {
        reference
            .arguments
            .into_iter()
            .any(|arg| mentions_parameter(arg, 0))
    })
}
