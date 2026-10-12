//! Resolve managed storage once, with deterministic dependency-first rec groups.

use crate::{
    error::Failure,
    types::{self, Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, Program};
use nts_semantic_schema::TypeId;
use rustc_hash::FxHashMap;
use std::collections::{BTreeMap, BTreeSet};
use wasm_encoder::{
    ArrayType, CompositeInnerType, CompositeType, FieldType, HeapType, RefType, StorageType,
    StructType, SubType, TypeSection,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct NodeId(usize);

#[derive(Debug, Clone, Copy)]
enum PendingSlot {
    Scalar(Slot),
    Reference(RefType),
    Defined(NodeId, bool),
}

#[derive(Debug, Clone, Copy)]
struct Field {
    slot: PendingSlot,
    packed: Option<StorageType>,
    mutable: bool,
}

impl Field {
    const fn value(slot: PendingSlot, mutable: bool) -> Self {
        Self {
            slot,
            packed: None,
            mutable,
        }
    }
}

#[derive(Debug, Clone)]
enum Shape {
    Struct(Vec<Field>),
    Array(Field),
    Function(Vec<PendingSlot>, Option<PendingSlot>),
}

#[derive(Debug)]
struct Node {
    name: String,
    base: Option<NodeId>,
    final_: bool,
    shape: Shape,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ErasedTypes {
    pub(crate) tagged: u32,
    pub(crate) number: u32,
    pub(crate) boolean: u32,
    pub(crate) string: u32,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RootTypes {
    pub(crate) ancestry: u32,
    pub(crate) descriptor: u32,
    pub(crate) object: u32,
}
#[derive(Debug, Clone, Copy)]
struct RootNodes {
    ancestry: NodeId,
    descriptor: NodeId,
    object: NodeId,
}

#[derive(Debug, Clone, Copy)]
struct ErasedNodes {
    tagged: NodeId,
    number: NodeId,
    boolean: NodeId,
    string: NodeId,
}

#[derive(Debug)]
pub(crate) struct Array {
    pub(crate) ty: HirType,
    pub(crate) element: HirType,
    pub(crate) wrapper: u32,
    pub(crate) backing: u32,
    pub(crate) descriptor: u32,
}

#[derive(Debug)]
struct CallableNodes {
    base: NodeId,
    entries: BTreeMap<u32, NodeId>,
}

/// Module-local storage assignments. Numeric operations still use the smaller
/// scalar Slot type, so a reference cannot accidentally select integer code.
#[derive(Debug, Default)]
pub(crate) struct Plan {
    slots: FxHashMap<HirType, Physical>,
    groups: Vec<Vec<SubType>>,
    count: u32,
    pub(crate) erased: Option<ErasedTypes>,
    pub(crate) root: Option<RootTypes>,
    pub(crate) objects: crate::object_plan::Plan,
    pub(crate) arrays: BTreeMap<u32, Array>,
    pub(crate) callables: BTreeMap<usize, crate::callable_plan::Resolved>,
    pub(crate) virtuals: BTreeMap<usize, crate::callable_plan::Resolved>,
}

impl Plan {
    #[cfg(test)]
    pub(crate) fn build(program: &Program) -> Result<Self, crate::EmitError> {
        Self::with_resources(program, &crate::requirements::build(program))
    }

    pub(crate) fn with_resources(
        program: &Program,
        resources: &crate::requirements::Requirements,
    ) -> Result<Self, crate::EmitError> {
        let callables = crate::callable_plan::Plan::build(program, &resources.closure_calls)?;
        let virtuals = crate::callable_plan::Plan::build(program, &resources.virtual_calls)?;
        let mut builder = Builder::new(program, callables, virtuals);
        for (ty, use_) in &resources.referenced_objects {
            builder
                .request(&HirType::Managed(ManagedType::Object(*ty)))
                .map_err(|why| Failure::Unsupported(why).at(&use_.function, &use_.origin))?;
        }
        for func in program.funcs.iter().filter(|f| !f.abstract_declaration) {
            for param in &func.params {
                builder.request(&param.ty).map_err(|why| {
                    crate::EmitError::Declined(vec![crate::refuse(func, &param.origin, why)])
                })?;
            }
            builder.request(&func.return_type).map_err(|why| {
                crate::EmitError::Declined(vec![crate::refuse(func, &func.origin, why)])
            })?;
            for block in nts_codegen_common::block_order(func) {
                let block = &func.blocks[block.0 as usize];
                for id in block.params.iter().chain(&block.ops) {
                    let op = func.value(*id);
                    builder.request(&op.ty).map_err(|why| {
                        crate::EmitError::Declined(vec![crate::refuse(func, &op.origin, why)])
                    })?;
                }
            }
        }
        for global in &program.globals {
            builder.request(&global.ty).map_err(|why| {
                crate::EmitError::Declined(vec![nts_diagnostics::Diagnostic::error(
                    "NTS5001",
                    format!("wasm declines global `{}`: {why}", global.name),
                    global.origin.location,
                )])
            })?;
        }
        let plan = builder
            .complete()
            .and_then(|()| builder.finish())
            .map_err(|reason| crate::EmitError::UnsupportedSurface {
                name: "managed type graph".into(),
                reason,
            })?;
        crate::callable_plan::check_virtual(program, &plan, &resources.virtual_declarations)?;
        Ok(plan)
    }

    pub(crate) fn slot(&self, ty: &HirType) -> Result<Option<Physical>, Failure> {
        if matches!(ty, HirType::Void | HirType::Never) {
            return Ok(None);
        }
        self.slots
            .get(ty)
            .copied()
            .map(Some)
            .ok_or_else(|| Failure::Invariant(format!("unplanned physical type {ty:?}")))
    }

    pub(crate) fn value_slot(&self, ty: &HirType) -> Result<Physical, Failure> {
        self.slot(ty)?
            .ok_or_else(|| Failure::Invariant(format!("no value slot for {ty:?}")))
    }

    pub(crate) fn array(&self, ty: &HirType) -> Result<&Array, Failure> {
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(format!("array storage for {ty:?}").into());
        }
        let Physical::Reference(RefType {
            heap_type: HeapType::Concrete(wrapper),
            ..
        }) = self.value_slot(ty)?
        else {
            return Err(Failure::Invariant("non-concrete array storage".into()));
        };
        self.arrays
            .get(&wrapper)
            .ok_or_else(|| Failure::Invariant(format!("unplanned array wrapper {wrapper}")))
    }

    pub(crate) fn encode(&self) -> TypeSection {
        let mut section = TypeSection::new();
        for group in &self.groups {
            section.ty().rec(group.iter().cloned());
        }
        section
    }

    pub(crate) fn requires_gc(&self) -> bool {
        self.slots.values().copied().any(crate::abi::requires_gc)
    }

    pub(crate) const fn count(&self) -> u32 {
        self.count
    }
}

enum Work {
    Object(usize, NodeId),
    Array(HirType, NodeId),
}

struct Builder<'a> {
    program: &'a Program,
    slots: FxHashMap<HirType, PendingSlot>,
    nodes: Vec<Node>,
    objects: FxHashMap<usize, NodeId>,
    arrays: FxHashMap<HirType, NodeId>,
    backings: FxHashMap<NodeId, NodeId>,
    root: Option<RootNodes>,
    work: Vec<Work>,
    erased: Option<ErasedNodes>,
    callable_plan: crate::callable_plan::Plan,
    callables: BTreeMap<usize, CallableNodes>,
    virtual_plan: crate::callable_plan::Plan,
    virtuals: BTreeMap<usize, CallableNodes>,
}

impl<'a> Builder<'a> {
    fn new(
        program: &'a Program,
        callable_plan: crate::callable_plan::Plan,
        virtual_plan: crate::callable_plan::Plan,
    ) -> Self {
        Self {
            program,
            slots: FxHashMap::default(),
            nodes: Vec::new(),
            objects: FxHashMap::default(),
            arrays: FxHashMap::default(),
            backings: FxHashMap::default(),
            root: None,
            work: Vec::new(),
            erased: None,
            callable_plan,
            callables: BTreeMap::new(),
            virtual_plan,
            virtuals: BTreeMap::new(),
        }
    }

    fn add(&mut self, name: String, base: Option<NodeId>, final_: bool, shape: Shape) -> NodeId {
        let id = NodeId(self.nodes.len());
        self.nodes.push(Node {
            name,
            base,
            final_,
            shape,
        });
        id
    }

    fn root(&mut self) -> NodeId {
        if let Some(id) = self.root {
            return id.object;
        }
        let ancestry = self.add(
            "ancestry".into(),
            None,
            true,
            Shape::Array(Field::value(PendingSlot::Scalar(Slot::I32), false)),
        );
        let descriptor = self.add(
            "descriptor".into(),
            None,
            true,
            Shape::Struct(vec![
                Field::value(PendingSlot::Scalar(Slot::I32), false), // semantic identity
                Field::value(PendingSlot::Scalar(Slot::I32), false), // runtime kind
                Field::value(PendingSlot::Defined(ancestry, true), false),
                Field::value(PendingSlot::Reference(RefType::ANYREF), false), // dispatch object
            ]),
        );
        let root = self.add(
            "object root".into(),
            None,
            false,
            Shape::Struct(vec![Field::value(
                PendingSlot::Defined(descriptor, false),
                false,
            )]),
        );
        self.root = Some(RootNodes {
            ancestry,
            descriptor,
            object: root,
        });
        root
    }

    fn erased_types(&mut self) {
        if self.erased.is_some() {
            return;
        }
        let tag = Field::value(PendingSlot::Scalar(Slot::I32), false);
        let tagged = self.add("erased tag".into(), None, false, Shape::Struct(vec![tag]));
        let number = self.add(
            "erased number".into(),
            Some(tagged),
            true,
            Shape::Struct(vec![
                tag,
                Field::value(PendingSlot::Scalar(Slot::F64), false),
            ]),
        );
        let boolean = self.add(
            "erased boolean".into(),
            Some(tagged),
            true,
            Shape::Struct(vec![
                tag,
                Field::value(PendingSlot::Scalar(Slot::I32), false),
            ]),
        );
        let string = self.add(
            "erased string".into(),
            Some(tagged),
            true,
            Shape::Struct(vec![
                tag,
                Field::value(PendingSlot::Reference(RefType::EXTERNREF), false),
            ]),
        );
        self.erased = Some(ErasedNodes {
            tagged,
            number,
            boolean,
            string,
        });
    }

    fn request(&mut self, ty: &HirType) -> Result<Option<PendingSlot>, String> {
        if matches!(ty, HirType::Void | HirType::Never) {
            return Ok(None);
        }
        if let Some(slot) = self.slots.get(ty) {
            return Ok(Some(*slot));
        }
        let slot = match ty {
            HirType::Bool | HirType::Int { .. } | HirType::Float { .. } => {
                PendingSlot::Scalar(types::value_slot(ty)?)
            }
            HirType::Managed(ManagedType::String) => PendingSlot::Reference(RefType::EXTERNREF),
            HirType::Managed(ManagedType::Object(id)) => {
                PendingSlot::Defined(self.object(*id)?, true)
            }
            HirType::Managed(ManagedType::Array(element)) => {
                PendingSlot::Defined(self.array(element), true)
            }
            HirType::Erased => {
                self.erased_types();
                PendingSlot::Reference(RefType::ANYREF)
            }
            HirType::Managed(ManagedType::BoxedBigInt) | HirType::BigInt => {
                return Err("bigint storage outside M1b".into());
            }
            HirType::Managed(ManagedType::Template) => {
                return Err("tagged-template storage outside M1b".into());
            }
            HirType::Managed(ManagedType::Promise(_)) => {
                return Err("promise/scheduler storage outside M1b".into());
            }
            HirType::Managed(
                ManagedType::Map(_, _)
                | ManagedType::Table(_, _)
                | ManagedType::Set(_)
                | ManagedType::Date,
            ) => return Err(format!("collection/date storage outside M1b: {ty:?}")),
            HirType::Managed(
                ManagedType::Buffer
                | ManagedType::View(_)
                | ManagedType::AnyView
                | ManagedType::DataView,
            ) => return Err(format!("buffer/view storage outside M1b: {ty:?}")),
            HirType::Managed(ManagedType::Symbol) => {
                return Err("symbol storage outside M1b".into());
            }
            HirType::NativePointer(_) => return Err("native pointer storage outside wasm".into()),
            HirType::Void | HirType::Never => return Ok(None),
        };
        self.slots.insert(ty.clone(), slot);
        Ok(Some(slot))
    }

    fn field(&mut self, ty: &HirType) -> Result<Field, String> {
        let slot = self
            .request(ty)?
            .ok_or_else(|| format!("field has no storage: {ty:?}"))?;
        let packed = match ty {
            HirType::Int { bits: 8, .. } => Some(StorageType::I8),
            HirType::Int { bits: 16, .. } => Some(StorageType::I16),
            HirType::Bool
            | HirType::Int { bits: 32 | 64, .. }
            | HirType::Float { bits: 32 | 64 }
            | HirType::Erased
            | HirType::Managed(_) => None,
            HirType::Void
            | HirType::Never
            | HirType::Int { .. }
            | HirType::Float { .. }
            | HirType::BigInt
            | HirType::NativePointer(_) => {
                return Err(format!("field storage outside M1b: {ty:?}"));
            }
        };
        Ok(Field {
            slot,
            packed,
            mutable: true,
        })
    }

    fn object(&mut self, ty: TypeId) -> Result<NodeId, String> {
        if let Some(interface) = self
            .program
            .interface_identities
            .iter()
            .find(|i| i.types.contains(&ty))
        {
            return Err(format!(
                "interface object storage `{}` outside M1b",
                interface.name
            ));
        }
        let at = self
            .program
            .layouts
            .iter()
            .position(|l| l.types.contains(&ty))
            .ok_or_else(|| format!("object type {ty:?} has no layout"))?;
        if let Some(id) = self.objects.get(&at) {
            return Ok(*id);
        }
        let id = self.add(
            self.program.layouts[at].name.clone(),
            None,
            false,
            Shape::Struct(Vec::new()),
        );
        self.objects.insert(at, id);
        self.work.push(Work::Object(at, id));
        Ok(id)
    }

    fn complete(&mut self) -> Result<(), String> {
        while let Some(work) = self.work.pop() {
            match work {
                Work::Object(at, id) => self.complete_object(at, id)?,
                Work::Array(element, id) => self.complete_array(&element, id)?,
            }
        }
        Ok(())
    }

    fn complete_object(&mut self, at: usize, id: NodeId) -> Result<(), String> {
        let layout = &self.program.layouts[at];
        if let Some(&root) = self.virtual_plan.members.get(&at) {
            self.dispatch(root)?;
        }
        let callable = self
            .callable_plan
            .members
            .get(&at)
            .copied()
            .map(|root| self.callable(root))
            .transpose()?;
        let base = if let Some(base) = layout.base {
            self.object(base)?
        } else {
            callable.unwrap_or_else(|| self.root())
        };
        let root = callable.unwrap_or_else(|| self.root());
        let mut fields = match &self.nodes[root.0].shape {
            Shape::Struct(fields) => fields.clone(),
            Shape::Array(_) | Shape::Function(..) => {
                return Err(format!("base of `{}` is not an object", layout.name));
            }
        };
        // HIR fields include the base prefix; the descriptor is physical only.
        if let Some(base) = self.program.base_layout(layout) {
            let base_layout = &self.program.layouts[base];
            if base_layout.fields.len() > layout.fields.len() {
                return Err(format!("class `{}` lacks base fields", layout.name));
            }
            for (parent, child) in base_layout.fields.iter().zip(&layout.fields) {
                if parent.ty != child.ty || !parent.names_the_same_member(child) {
                    return Err(format!(
                        "class `{}` has incompatible mutable base field `{}`",
                        layout.name, child.name
                    ));
                }
            }
        }
        for field in &layout.fields {
            fields.push(
                self.field(&field.ty).map_err(|why| {
                    format!("class `{}` field `{}`: {why}", layout.name, field.name)
                })?,
            );
        }
        self.nodes[id.0].base = Some(base);
        self.nodes[id.0].shape = Shape::Struct(fields);
        Ok(())
    }

    fn callable(&mut self, root: usize) -> Result<NodeId, String> {
        if let Some(nodes) = self.callables.get(&root) {
            return Ok(nodes.base);
        }
        let object = self.root();
        let Shape::Struct(mut fields) = self.nodes[object.0].shape.clone() else {
            return Err("object root is not a struct".into());
        };
        let base = self.add(
            format!("callable<{}>", self.program.layouts[root].name),
            Some(object),
            false,
            Shape::Struct(Vec::new()),
        );
        let mut entries = BTreeMap::new();
        for entry in self.callable_plan.groups[&root]
            .values()
            .cloned()
            .collect::<Vec<_>>()
        {
            let mut params = vec![PendingSlot::Defined(base, true)];
            for ty in &entry.params {
                params.push(
                    self.request(ty)?
                        .ok_or_else(|| format!("callable parameter {ty:?} has no storage"))?,
                );
            }
            let result = self.request(&entry.result)?;
            let signature = self.add(
                format!("entry<{},{}>", self.program.layouts[root].name, entry.slot),
                None,
                true,
                Shape::Function(params, result),
            );
            fields.push(Field::value(PendingSlot::Defined(signature, false), false));
            entries.insert(entry.slot, signature);
        }
        self.nodes[base.0].shape = Shape::Struct(fields);
        self.callables.insert(root, CallableNodes { base, entries });
        Ok(base)
    }

    fn dispatch(&mut self, root: usize) -> Result<NodeId, String> {
        if let Some(nodes) = self.virtuals.get(&root) {
            return Ok(nodes.base);
        }
        let object = self.root();
        let mut fields = Vec::new();
        let mut entries = BTreeMap::new();
        for entry in self.virtual_plan.groups[&root]
            .values()
            .cloned()
            .collect::<Vec<_>>()
        {
            let mut params = vec![PendingSlot::Defined(object, true)];
            for ty in &entry.params {
                params.push(
                    self.request(ty)?
                        .ok_or_else(|| format!("dispatch parameter {ty:?} has no storage"))?,
                );
            }
            let result = self.request(&entry.result)?;
            let signature = self.add(
                format!("method<{},{}>", self.program.layouts[root].name, entry.slot),
                None,
                true,
                Shape::Function(params, result),
            );
            fields.push(Field::value(PendingSlot::Defined(signature, false), false));
            entries.insert(entry.slot, signature);
        }
        let base = self.add(
            format!("dispatch<{}>", self.program.layouts[root].name),
            None,
            true,
            Shape::Struct(fields),
        );
        self.virtuals.insert(root, CallableNodes { base, entries });
        Ok(base)
    }
    fn array(&mut self, element: &HirType) -> NodeId {
        if let Some(id) = self.arrays.get(element) {
            return *id;
        }
        let root = self.root();
        let id = self.add(
            format!("array<{element:?}>"),
            Some(root),
            true,
            Shape::Struct(Vec::new()),
        );
        self.arrays.insert(element.clone(), id);
        self.work.push(Work::Array(element.clone(), id));
        id
    }

    fn complete_array(&mut self, element: &HirType, id: NodeId) -> Result<(), String> {
        let root = self.root();
        let field = self.field(element)?;
        let backing = self.add(
            format!("backing<{element:?}>"),
            None,
            true,
            Shape::Array(field),
        );
        self.backings.insert(id, backing);
        let Shape::Struct(mut fields) = self.nodes[root.0].shape.clone() else {
            return Err("object root is not a struct".into());
        };
        fields.push(Field::value(PendingSlot::Scalar(Slot::I32), true));
        fields.push(Field::value(PendingSlot::Defined(backing, false), true));
        self.nodes[id.0].shape = Shape::Struct(fields);
        Ok(())
    }

    fn dependencies(&self) -> Vec<Vec<usize>> {
        self.nodes
            .iter()
            .map(|node| {
                let mut deps = BTreeSet::new();
                if let Some(base) = node.base {
                    deps.insert(base.0);
                }
                let slots = match &node.shape {
                    Shape::Struct(fields) => fields.iter().map(|f| f.slot).collect::<Vec<_>>(),
                    Shape::Array(field) => vec![field.slot],
                    Shape::Function(params, result) => {
                        params.iter().chain(result).copied().collect()
                    }
                };
                for slot in slots {
                    if let PendingSlot::Defined(id, _) = slot {
                        deps.insert(id.0);
                    }
                }
                deps.into_iter().collect()
            })
            .collect()
    }
    fn metadata(
        &self,
        indices: &[u32],
    ) -> Result<(crate::object_plan::Plan, BTreeMap<u32, Array>), String> {
        let mut objects = crate::object_plan::Plan::build(
            self.program,
            &self
                .objects
                .iter()
                .map(|(&at, id)| (at, indices[id.0]))
                .collect(),
        )?;
        let mut arrays = self
            .arrays
            .iter()
            .map(|(element, id)| {
                (
                    indices[id.0],
                    Array {
                        ty: HirType::Managed(ManagedType::Array(Box::new(element.clone()))),
                        element: element.clone(),
                        wrapper: indices[id.0],
                        backing: indices[self.backings[id].0],
                        descriptor: 0,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        for (&at, &root) in &self.callable_plan.members {
            if self.objects.contains_key(&at) {
                for ty in &self.program.layouts[at].types {
                    objects.attach_callable(
                        *ty,
                        root,
                        u32::try_from(self.callable_plan.groups[&root].len())
                            .map_err(|_| "too many callable slots")?
                            + 1,
                    )?;
                }
            }
        }
        for (&at, &root) in &self.virtual_plan.members {
            if self.objects.contains_key(&at) {
                for ty in &self.program.layouts[at].types {
                    objects.attach_virtual(*ty, root)?;
                }
            }
        }
        let identity = objects
            .descriptors
            .iter()
            .map(|d| d.identity)
            .max()
            .map_or(Some(0), |id| id.checked_add(1))
            .ok_or_else(|| "too many semantic identities".to_owned())?;
        for array in arrays.values_mut() {
            array.descriptor = u32::try_from(objects.descriptors.len())
                .map_err(|_| "too many array descriptors")?;
            objects.descriptors.push(crate::object_plan::Descriptor {
                identity,
                kind: nts_core::hir::tags::of_reference(&ManagedType::Array(Box::new(
                    array.element.clone(),
                ))),
                ancestry: Vec::new(),
                object: None,
            });
        }
        Ok((objects, arrays))
    }
    fn resolved_callables(
        &self,
        indices: &[u32],
    ) -> BTreeMap<usize, crate::callable_plan::Resolved> {
        Self::resolve_entries(&self.callables, &self.callable_plan, indices, 1)
    }
    fn resolve_entries(
        nodes: &BTreeMap<usize, CallableNodes>,
        plan: &crate::callable_plan::Plan,
        indices: &[u32],
        offset: u32,
    ) -> BTreeMap<usize, crate::callable_plan::Resolved> {
        nodes
            .iter()
            .map(|(&root, nodes)| {
                (
                    root,
                    crate::callable_plan::Resolved {
                        base: indices[nodes.base.0],
                        entries: plan.groups[&root]
                            .iter()
                            .enumerate()
                            .map(|(field, (&slot, entry))| {
                                (
                                    slot,
                                    crate::callable_plan::ResolvedEntry {
                                        slot,
                                        field: crate::module::index(field) + offset,
                                        signature: indices[nodes.entries[&slot].0],
                                        params: entry.params.clone(),
                                        result: entry.result.clone(),
                                    },
                                )
                            })
                            .collect(),
                    },
                )
            })
            .collect()
    }
    fn finish(self) -> Result<Plan, String> {
        let graph = self.dependencies();
        let components = components(&graph);
        let ordered = self.order_bases(components)?;
        let mut indices = vec![0; self.nodes.len()];
        let mut count = 0_u32;
        for group in &ordered {
            for &id in group {
                indices[id] = count;
                count = count.checked_add(1).ok_or("too many wasm types")?;
            }
        }
        let resolve = |slot| -> Physical {
            match slot {
                PendingSlot::Scalar(slot) => Physical::Scalar(slot),
                PendingSlot::Reference(reference) => Physical::Reference(reference),
                PendingSlot::Defined(id, nullable) => Physical::Reference(RefType {
                    nullable,
                    heap_type: HeapType::Concrete(indices[id.0]),
                }),
            }
        };
        let encode_field = |field: &Field| FieldType {
            element_type: field
                .packed
                .unwrap_or_else(|| StorageType::Val(resolve(field.slot).wasm())),
            mutable: field.mutable,
        };
        let groups = ordered
            .iter()
            .map(|group| {
                group
                    .iter()
                    .map(|&id| {
                        let node = &self.nodes[id];
                        let inner = match &node.shape {
                            Shape::Struct(fields) => CompositeInnerType::Struct(StructType {
                                fields: fields.iter().map(encode_field).collect(),
                            }),
                            Shape::Array(field) => {
                                CompositeInnerType::Array(ArrayType(encode_field(field)))
                            }
                            Shape::Function(params, result) => {
                                CompositeInnerType::Func(wasm_encoder::FuncType::new(
                                    params.iter().map(|slot| resolve(*slot).wasm()),
                                    result.map(|slot| resolve(slot).wasm()),
                                ))
                            }
                        };
                        SubType {
                            is_final: node.final_,
                            supertype_idxs: node
                                .base
                                .map(|base| indices[base.0])
                                .into_iter()
                                .collect(),
                            composite_type: CompositeType {
                                inner,
                                shared: false,
                                descriptor: None,
                                describes: None,
                            },
                        }
                    })
                    .collect()
            })
            .collect();
        let (objects, arrays) = self.metadata(&indices)?;
        Ok(Plan {
            arrays,
            callables: self.resolved_callables(&indices),
            virtuals: Self::resolve_entries(&self.virtuals, &self.virtual_plan, &indices, 0),
            root: self.root.map(|nodes| RootTypes {
                ancestry: indices[nodes.ancestry.0],
                descriptor: indices[nodes.descriptor.0],
                object: indices[nodes.object.0],
            }),
            objects,
            erased: self.erased.map(|nodes| ErasedTypes {
                tagged: indices[nodes.tagged.0],
                number: indices[nodes.number.0],
                boolean: indices[nodes.boolean.0],
                string: indices[nodes.string.0],
            }),
            slots: self
                .slots
                .into_iter()
                .map(|(ty, slot)| (ty, resolve(slot)))
                .collect(),
            groups,
            count,
        })
    }
    fn order_bases(&self, components: Vec<Vec<usize>>) -> Result<Vec<Vec<usize>>, String> {
        let mut ordered = Vec::new();
        for component in components {
            let members: BTreeSet<_> = component.into_iter().collect();
            let mut ready = BTreeSet::new();
            let mut children: FxHashMap<usize, Vec<usize>> = FxHashMap::default();
            for &id in &members {
                if let Some(base) = self.nodes[id].base.filter(|base| members.contains(&base.0)) {
                    children.entry(base.0).or_default().push(id);
                } else {
                    ready.insert(id);
                }
            }
            let mut group = Vec::new();
            while let Some(id) = ready.pop_first() {
                group.push(id);
                if let Some(children) = children.remove(&id) {
                    ready.extend(children);
                }
            }
            if group.len() != members.len() {
                let cyclic: BTreeSet<_> = children.values().flatten().copied().collect();
                return Err(format!(
                    "wasm declines cyclic class ancestry: {}",
                    cyclic
                        .iter()
                        .map(|&id| self.nodes[id].name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            ordered.push(group);
        }
        Ok(ordered)
    }
}

/// Iterative Kosaraju, with dependency components first. No graph recursion can
/// exhaust the compiler stack on a large mutually recursive object family.
fn components(graph: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut seen = vec![false; graph.len()];
    let mut order = Vec::new();
    for start in 0..graph.len() {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        let mut stack = vec![(start, 0)];
        while let Some((id, next)) = stack.last_mut() {
            if let Some(&child) = graph[*id].get(*next) {
                *next += 1;
                if !seen[child] {
                    seen[child] = true;
                    stack.push((child, 0));
                }
            } else {
                order.push(*id);
                stack.pop();
            }
        }
    }
    let mut reverse = vec![Vec::new(); graph.len()];
    for (id, children) in graph.iter().enumerate() {
        for &child in children {
            reverse[child].push(id);
        }
    }
    seen.fill(false);
    let mut groups = Vec::new();
    for &start in order.iter().rev() {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        let mut stack = vec![start];
        let mut group = Vec::new();
        while let Some(id) = stack.pop() {
            group.push(id);
            for &child in &reverse[id] {
                if !seen[child] {
                    seen[child] = true;
                    stack.push(child);
                }
            }
        }
        groups.push(group);
    }
    groups.reverse();
    groups
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::test_common;
    use crate::test_common::{block, function, program, value};
    use nts_core::hir::{Field as HirField, Layout, OpKind, Terminator};
    use std::io::Write;

    fn object(id: u32) -> HirType {
        HirType::Managed(ManagedType::Object(TypeId(id)))
    }

    fn field(name: &str, ty: HirType) -> HirField {
        HirField {
            name: name.into(),
            ty,
            written: None,
            declared_by: None,
            readonly: false,
        }
    }

    fn layout(id: u32, name: &str, fields: Vec<HirField>, base: Option<u32>) -> Layout {
        Layout {
            types: vec![TypeId(id)],
            name: name.into(),
            fields,
            methods: vec![],
            interfaces: vec![],
            base: base.map(TypeId),
        }
    }

    fn typed_program(types: &[HirType]) -> Program {
        let mut f = function("privateTyped", types, HirType::Void);
        f.blocks.push(block(&[], &[], Terminator::Return(None)));
        let mut p = program(vec![f]);
        p.public_api.clear();
        p
    }

    fn bytes(plan: &Plan) -> Vec<u8> {
        let mut module = wasm_encoder::Module::new();
        module.section(&plan.encode());
        module.finish()
    }

    #[test]
    fn a_base_field_can_refer_forward_to_its_derived_class() {
        let mut p = typed_program(&[object(1)]);
        p.layouts = vec![
            layout(1, "Base", vec![field("next", object(2))], None),
            layout(
                2,
                "Derived",
                vec![field("next", object(2)), field("extra", test_common::I32)],
                Some(1),
            ),
        ];
        let plan = Plan::build(&p).unwrap();
        assert_eq!(plan.count(), 5);
        assert_eq!(plan.groups.iter().map(Vec::len).max(), Some(2));
        let encoded = bytes(&plan);
        crate::validate(&encoded).unwrap();
        assert_eq!(encoded, bytes(&Plan::build(&p).unwrap()));

        // The two class types share a rec group: function indexes count TYPES,
        // not TypeSection entries (rec groups). Exercise the real module path.
        let mut smoke = function("smoke", &[], HirType::Bool);
        let answer = value(&mut smoke, OpKind::ConstBool(true), HirType::Bool);
        smoke
            .blocks
            .push(block(&[], &[answer], Terminator::Return(Some(answer))));
        p.funcs.push(smoke);
        p.public_api.push(("smoke".into(), "smoke".into()));
        let emitted = crate::emit(&p).unwrap();
        let script = "const b=require('node:fs').readFileSync(0); const i=new WebAssembly.Instance(new WebAssembly.Module(b)); if(i.exports.smoke()!==1) process.exit(1)";
        let mut child = std::process::Command::new("node")
            .args(["-e", script])
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&emitted.bytes)
            .unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[test]
    fn packed_and_nested_array_storage_validate() {
        let byte = HirType::Int {
            bits: 8,
            signed: false,
        };
        let short = HirType::Int {
            bits: 16,
            signed: true,
        };
        let arrays = [byte, short, object(1), HirType::Erased]
            .map(|ty| HirType::Managed(ManagedType::Array(Box::new(ty))));
        let mut roots = arrays.to_vec();
        roots.push(HirType::Managed(ManagedType::Array(Box::new(
            arrays[2].clone(),
        ))));
        let mut p = typed_program(&roots);
        p.layouts
            .push(layout(1, "Node", vec![field("next", object(1))], None));
        let plan = Plan::build(&p).unwrap();
        let packed: Vec<_> = plan
            .groups
            .iter()
            .flatten()
            .filter_map(|ty| match &ty.composite_type.inner {
                CompositeInnerType::Array(ArrayType(FieldType {
                    element_type: StorageType::I8 | StorageType::I16,
                    ..
                })) => Some(()),
                CompositeInnerType::Array(_)
                | CompositeInnerType::Struct(_)
                | CompositeInnerType::Func(_)
                | CompositeInnerType::Cont(_) => None,
            })
            .collect();
        assert_eq!(packed.len(), 2);
        crate::validate(&bytes(&plan)).unwrap();
    }

    #[test]
    fn recursive_storage_is_iterative_and_unused_layouts_are_absent() {
        let mut p = typed_program(&[object(0)]);
        for id in 0..512 {
            p.layouts.push(layout(
                id,
                &format!("Node{id}"),
                vec![field("next", object((id + 1) % 512))],
                None,
            ));
        }
        // An unreachable unsupported layout must not add a family or refusal.
        p.layouts.push(layout(
            512,
            "Unused",
            vec![field("big", HirType::BigInt)],
            None,
        ));
        let plan = Plan::build(&p).unwrap();
        assert_eq!(plan.count(), 515);
        assert_eq!(plan.groups.iter().map(Vec::len).max(), Some(512));
        crate::validate(&bytes(&plan)).unwrap();
        let scalar = Plan::build(&typed_program(&[test_common::F64])).unwrap();
        assert_eq!(scalar.count(), 0);
    }

    #[test]
    fn cyclic_ancestry_and_invariant_field_mismatches_are_named_declines() {
        let mut p = typed_program(&[object(1)]);
        p.layouts = vec![
            layout(1, "A", vec![], Some(2)),
            layout(2, "B", vec![], Some(1)),
        ];
        let error = Plan::build(&p).unwrap_err().to_string();
        assert!(
            error.contains("cyclic class ancestry") && error.contains('A') && error.contains('B')
        );
        p.layouts = vec![
            layout(1, "Base", vec![field("value", test_common::I32)], None),
            layout(
                2,
                "Derived",
                vec![field("value", test_common::F64)],
                Some(1),
            ),
        ];
        p.funcs[0].params[0].ty = object(2);
        let error = Plan::build(&p).unwrap_err().to_string();
        assert!(
            error.contains("Derived")
                && error.contains("value")
                && error.contains("mutable base field")
        );
    }
}
