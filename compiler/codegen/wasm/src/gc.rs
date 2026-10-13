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
    AbstractHeapType, ArrayType, CompositeInnerType, CompositeType, FieldType, HeapType, RefType,
    StorageType, StructType, SubType, TypeSection,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct NodeId(usize);

/// What an array's storage is keyed by. An object or array element is keyed
/// by the storage it maps to, so two element types that are one layout (two
/// names for one function type, say) share one array type; any other
/// element by its own type, whose kind and conversions are part of it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum ArrayKey {
    Storage(NodeId),
    Element(HirType),
}

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
    /// `{ tag, v128 }`: an erased bigint, when the program boxes one.
    pub(crate) bigint: Option<u32>,
}

/// The fields every descriptor starts with: semantic identity, runtime kind
/// and ancestry. A class with virtual methods has a vtable: a descriptor
/// subtype whose further fields are its method entries.
pub(crate) const DESCRIPTOR_HEADER: u32 = 3;

#[derive(Debug, Clone, Copy)]
pub(crate) struct RootTypes {
    pub(crate) ancestry: u32,
    pub(crate) descriptor: u32,
    pub(crate) object: u32,
    /// The row array a descriptor holds when calls through an interface read
    /// it: one entry per native column, a function or null.
    pub(crate) rows: Option<u32>,
}
#[derive(Debug, Clone, Copy)]
struct RootNodes {
    ancestry: NodeId,
    descriptor: NodeId,
    object: NodeId,
    rows: Option<NodeId>,
}

#[derive(Debug, Clone, Copy)]
struct ErasedNodes {
    tagged: NodeId,
    number: NodeId,
    boolean: NodeId,
    bigint: Option<NodeId>,
}

#[derive(Debug, Clone, Copy)]
struct BufferNodes {
    bytes: NodeId,
    buffer: NodeId,
    view: NodeId,
    dataview: NodeId,
}

#[derive(Debug, Clone, Copy)]
struct PromiseNodes {
    promise: NodeId,
    run: NodeId,
    task: NodeId,
    tasks: NodeId,
    adoption: NodeId,
    promises: NodeId,
}

/// A promise and the tasks its settlement queues, as the C runtime's
/// `NtsPromise` and `NtsTask`: see `promises.rs`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PromiseTypes {
    pub(crate) promise: u32,
    /// `(anyref) -> ()`: every task's `run`, so a queue calls any of them.
    pub(crate) run: u32,
    /// `{ run, state }`.
    pub(crate) task: u32,
    /// A growable array of tasks: a reaction list or a queue.
    pub(crate) tasks: u32,
    /// `{ outer, inner }`, the state of an adoption's two tasks.
    pub(crate) adoption: u32,
    /// The rejected promises nothing listened to yet.
    pub(crate) promises: u32,
    pub(crate) descriptor: u32,
    /// The first field after the object root's.
    pub(crate) base: u32,
}

impl PromiseTypes {
    /// 0 pending, 1 fulfilled, 2 rejected.
    pub(crate) const fn state(self) -> u32 {
        self.base
    }
    /// The settlement, erased: the value or the reason.
    pub(crate) const fn value(self) -> u32 {
        self.base + 1
    }
    /// Which pair of resolving functions may resolve it now.
    pub(crate) const fn resolutions(self) -> u32 {
        self.base + 2
    }
    /// Whether anything subscribed, which an unhandled rejection asks.
    pub(crate) const fn handled(self) -> u32 {
        self.base + 3
    }
    pub(crate) const fn reactions(self) -> u32 {
        self.base + 4
    }
    pub(crate) const fn count(self) -> u32 {
        self.base + 5
    }
}

/// An `ArrayBuffer`, a typed-array view and a `DataView`, as the C runtime's
/// `NtsBuffer`, `NtsView` and `NtsDataView`: see `buffers.rs`.
///
/// One view type for every element kind and for `ArrayBufferView`: the kind is
/// a field, as it is in C, because `set` between two views and an
/// `instanceof` on an open value ask it at run time.
#[derive(Debug, Clone, Copy)]
pub(crate) struct BufferTypes {
    /// `(array (mut i8))`: a buffer's bytes, which every view over it shares.
    pub(crate) bytes: u32,
    /// `{ length, reserved, resizable, bytes }` after the root; `bytes` is
    /// null once detached.
    pub(crate) buffer: u32,
    /// `{ buffer, offset, length, kind, width, tracking }` after the root.
    pub(crate) view: u32,
    /// `{ buffer, offset, length, tracking }` after the root.
    pub(crate) dataview: u32,
    pub(crate) buffer_descriptor: u32,
    pub(crate) view_descriptor: u32,
    pub(crate) dataview_descriptor: u32,
}

/// A symbol, as the C runtime's `NtsSymbol`: an object-root struct holding
/// its description, under a descriptor whose kind is `SYMBOL`. See
/// `symbols.rs`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SymbolTypes {
    pub(crate) symbol: u32,
    pub(crate) descriptor: u32,
}

#[derive(Debug)]
pub(crate) struct Array {
    pub(crate) ty: HirType,
    pub(crate) element: HirType,
    pub(crate) wrapper: u32,
    pub(crate) backing: u32,
    pub(crate) descriptor: u32,
}

/// How a collection's keys are stored, hashed and compared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum KeyKind {
    /// A JS string, hashed over its code units and compared by content.
    String,
    /// A number, compared by `SameValueZero`: one NaN, and -0 stored as +0.
    Number,
    /// An erased value, hashed and compared by its tag.
    Erased,
    /// An object, an array or a function, hashed by its identity hash and
    /// compared by reference.
    Reference,
}

/// The storage a collection's values take: a number or a boolean typed, and
/// anything else erased, because a null reference slot cannot say which
/// absence it held.
pub(crate) fn collection_value(value: &HirType) -> HirType {
    match value {
        HirType::Float { bits: 64 } | HirType::Bool => value.clone(),
        _ => HirType::Erased,
    }
}

/// What a collection type's keys are, or why they are refused.
pub(crate) fn collection_key(key: &HirType) -> Result<KeyKind, String> {
    match key {
        HirType::Managed(ManagedType::String) => Ok(KeyKind::String),
        HirType::Float { bits: 64 } => Ok(KeyKind::Number),
        HirType::Erased => Ok(KeyKind::Erased),
        HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_) | ManagedType::Symbol) => {
            Ok(KeyKind::Reference)
        }
        _ => Err(format!("a map or set key of type {key:?}")),
    }
}

/// A Map, Set or Table: an insertion-ordered table, as the C runtime's
/// `NtsMap`. Its fields follow the object root's: the live count (`size`),
/// the entries written (holes included), the keys, each entry's hash (zero
/// for a hole), the probe index, and for a Map or Table the values.
#[derive(Debug, Clone)]
pub(crate) struct Collection {
    pub(crate) key: KeyKind,
    /// The values' storage type; none for a Set.
    pub(crate) value: Option<HirType>,
    /// A `Record` table rather than a `Map`: one storage, and a type of its
    /// own, so `instanceof Map` tells them apart as C's descriptor does.
    pub(crate) table: bool,
    pub(crate) wrapper: u32,
    pub(crate) keys: u32,
    pub(crate) values: Option<u32>,
    /// `(array (mut i32))`, for the hashes and the index.
    pub(crate) ints: u32,
    /// The first field after the object root's.
    pub(crate) base: u32,
    pub(crate) descriptor: u32,
}

impl Collection {
    pub(crate) const fn live(&self) -> u32 {
        self.base
    }
    pub(crate) const fn used(&self) -> u32 {
        self.base + 1
    }
    pub(crate) const fn key_field(&self) -> u32 {
        self.base + 2
    }
    pub(crate) const fn hashes(&self) -> u32 {
        self.base + 3
    }
    pub(crate) const fn index(&self) -> u32 {
        self.base + 4
    }
    pub(crate) const fn value_field(&self) -> u32 {
        self.base + 5
    }
}

/// A collection's keys, values and ints arrays, once completed.
type CollectionArrays = (NodeId, Option<NodeId>, NodeId);

type Metadata = (
    crate::object_plan::Plan,
    BTreeMap<u32, Array>,
    BTreeMap<u32, Collection>,
);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CollectionKey {
    key: KeyKind,
    value: Option<HirType>,
    table: bool,
}

#[derive(Debug)]
struct CallableNodes {
    base: NodeId,
    entries: BTreeMap<u32, NodeId>,
}

/// What a defined type is, which decides the abstract types above it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Struct,
    Array,
    Func,
}

/// `count` descriptors for a runtime type that is not a class, under one new
/// identity no class has, of `kind` to `typeof` (an object, or a symbol). The
/// first one's index.
fn builtins(
    objects: &mut crate::object_plan::Plan,
    count: usize,
    kind: u32,
) -> Result<u32, String> {
    let first = u32::try_from(objects.descriptors.len()).map_err(|_| "too many descriptors")?;
    if count > 0 {
        let identity = objects
            .descriptors
            .iter()
            .map(|d| d.identity)
            .max()
            .map_or(Some(0), |id| id.checked_add(1))
            .ok_or_else(|| "too many semantic identities".to_owned())?;
        for _ in 0..count {
            objects.descriptors.push(crate::object_plan::Descriptor {
                identity,
                kind,
                ancestry: Vec::new(),
                class: None,
            });
        }
    }
    Ok(first)
}

/// Module-local storage assignments. Numeric operations still use the smaller
/// scalar Slot type, so a reference cannot accidentally select integer code.
#[derive(Debug, Default)]
pub(crate) struct Plan {
    slots: FxHashMap<HirType, Physical>,
    groups: Vec<Vec<SubType>>,
    /// Each defined type's declared supertype and kind, by type index.
    supers: Vec<(Option<u32>, Kind)>,
    count: u32,
    pub(crate) erased: Option<ErasedTypes>,
    pub(crate) promise: Option<PromiseTypes>,
    pub(crate) buffers: Option<BufferTypes>,
    pub(crate) symbol: Option<SymbolTypes>,
    pub(crate) root: Option<RootTypes>,
    pub(crate) objects: crate::object_plan::Plan,
    pub(crate) arrays: BTreeMap<u32, Array>,
    pub(crate) collections: BTreeMap<u32, Collection>,
    pub(crate) callables: BTreeMap<usize, crate::callable_plan::Resolved>,
    pub(crate) virtuals: BTreeMap<usize, crate::callable_plan::Resolved>,
    /// The callable root and its uniform entries: every function value's
    /// storage extends it, so a call through any function value reads the
    /// entry here without a cast.
    pub(crate) uniform: Option<crate::callable_plan::Resolved>,
    /// Each slot called through an interface, and the function type every
    /// entry of its row column has: the receiver as the object root, then
    /// the declaration's own parameters and result.
    pub(crate) row_signatures: BTreeMap<u32, u32>,
    /// What each row slot's entries take after the receiver and answer.
    pub(crate) row_conventions: BTreeMap<u32, Convention>,
}

/// A row column's convention: the types its entries take after the receiver,
/// and the type they answer. Read off the entries themselves, which the core
/// builds to one convention per column; a call adapts to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Convention {
    pub(crate) params: Vec<HirType>,
    pub(crate) result: HirType,
}

/// How many fields the object root has, its descriptor and its identity hash:
/// every object, array and collection struct starts with them, so a field
/// after the root is numbered from here.
pub(crate) const ROOT_FIELDS: u32 = 2;
/// The root's identity hash: zero until something hashes the object, then
/// fixed, which is what an object as a Map or Set key needs.
pub(crate) const IDENTITY_HASH: u32 = 1;
/// An array wrapper's fields after the root: its length, then its backing.
pub(crate) const ARRAY_LENGTH: u32 = ROOT_FIELDS;
pub(crate) const ARRAY_BACKING: u32 = ROOT_FIELDS + 1;

/// Where a descriptor's field holding its row sits, after identity, kind and
/// ancestry.
pub(crate) const ROWS_FIELD: u32 = 3;

impl Plan {
    #[cfg(test)]
    pub(crate) fn build(program: &Program) -> Result<Self, crate::EmitError> {
        Self::with_resources(program, &crate::demand::build(program))
    }

    pub(crate) fn with_resources(
        program: &Program,
        resources: &crate::demand::Demand,
    ) -> Result<Self, crate::EmitError> {
        let callables = crate::callable_plan::Plan::build(program, &resources.closure_calls, true)?;
        let virtuals = crate::callable_plan::Plan::build(program, &resources.virtual_calls, false)?;
        let mut builder = Builder::new(program, callables, virtuals);
        builder.rows = !resources.row_calls.is_empty();
        builder
            .plan_prefix_parents()
            .map_err(|reason| crate::EmitError::UnsupportedSurface {
                name: "managed type graph".into(),
                reason,
            })?;
        builder.plan_presence(&resources.presence);
        for (&slot, (declared, use_)) in &resources.row_calls {
            builder
                .row_signature(slot, declared)
                .map_err(|why| Failure::Unsupported(why).at(&use_.function, &use_.origin))?;
        }
        // A job or a timer is a task, run at a checkpoint.
        if resources.services.tasks {
            builder.promise_types();
        }
        // `Symbol.for` keeps its registry in a string-keyed table.
        if resources.services.symbol_registry {
            builder
                .request(&crate::symbols::registry_type())
                .map_err(crate::EmitError::InvalidWasm)?;
            builder.symbol_type();
        }
        // A raise carries an erased payload.
        if resources.raising {
            builder
                .request(&HirType::Erased)
                .map_err(crate::EmitError::InvalidWasm)?;
        }
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
            .and_then(|()| builder.check_face_chains())
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

    pub(crate) fn collection(&self, ty: &HirType) -> Result<&Collection, Failure> {
        if !matches!(
            ty,
            HirType::Managed(ManagedType::Map(..) | ManagedType::Table(..) | ManagedType::Set(_))
        ) {
            return Err(format!("collection storage for {ty:?}").into());
        }
        let Physical::Reference(RefType {
            heap_type: HeapType::Concrete(wrapper),
            ..
        }) = self.value_slot(ty)?
        else {
            return Err(Failure::Invariant("non-concrete collection storage".into()));
        };
        self.collections
            .get(&wrapper)
            .ok_or_else(|| Failure::Invariant(format!("unplanned collection wrapper {wrapper}")))
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

    /// Whether every value of heap type `a` is a value of `b`: a defined
    /// type's declared supertype chain, then the abstract types above it.
    pub(crate) fn heap_subtype(&self, a: HeapType, b: HeapType) -> bool {
        use AbstractHeapType as A;
        if a == b {
            return true;
        }
        let kind = |at: u32| self.supers.get(at as usize).map(|&(_, kind)| kind);
        match (a, b) {
            (HeapType::Concrete(mut at), HeapType::Concrete(want)) => loop {
                if at == want {
                    return true;
                }
                match self.supers.get(at as usize) {
                    Some(&(Some(parent), _)) => at = parent,
                    _ => return false,
                }
            },
            (HeapType::Concrete(at), HeapType::Abstract { shared: false, ty }) => matches!(
                (kind(at), ty),
                (Some(Kind::Struct), A::Struct | A::Eq | A::Any)
                    | (Some(Kind::Array), A::Array | A::Eq | A::Any)
                    | (Some(Kind::Func), A::Func)
            ),
            (HeapType::Abstract { shared: false, ty }, HeapType::Concrete(at)) => matches!(
                (ty, kind(at)),
                (A::None, Some(Kind::Struct | Kind::Array)) | (A::NoFunc, Some(Kind::Func))
            ),
            (
                HeapType::Abstract {
                    shared: false,
                    ty: from,
                },
                HeapType::Abstract {
                    shared: false,
                    ty: to,
                },
            ) => matches!(
                (from, to),
                (A::I31 | A::Struct | A::Array, A::Eq | A::Any)
                    | (A::Eq, A::Any)
                    | (A::None, A::I31 | A::Struct | A::Array | A::Eq | A::Any)
                    | (A::NoExtern, A::Extern)
                    | (A::NoFunc, A::Func)
            ),
            _ => false,
        }
    }

    /// Whether every value of reference type `a` is a value of `b`.
    pub(crate) fn ref_subtype(&self, a: RefType, b: RefType) -> bool {
        (b.nullable || !a.nullable) && self.heap_subtype(a.heap_type, b.heap_type)
    }
}

enum Work {
    Object(usize, NodeId),
    Array(HirType, NodeId),
    Collection(NodeId),
}

struct Builder<'a> {
    program: &'a Program,
    slots: FxHashMap<HirType, PendingSlot>,
    nodes: Vec<Node>,
    objects: FxHashMap<usize, NodeId>,
    arrays: FxHashMap<ArrayKey, NodeId>,
    /// Each array node's element type: the first that keyed it.
    array_elements: FxHashMap<NodeId, HirType>,
    backings: FxHashMap<NodeId, NodeId>,
    collections: FxHashMap<CollectionKey, NodeId>,
    /// Each collection node's key and value storage, and its arrays once
    /// completed: keys, values, ints.
    collection_shapes: FxHashMap<NodeId, (CollectionKey, Option<CollectionArrays>)>,
    /// One array type per element storage, shared by every collection.
    plain_arrays: FxHashMap<HirType, NodeId>,
    root: Option<RootNodes>,
    work: Vec<Work>,
    erased: Option<ErasedNodes>,
    promise: Option<PromiseNodes>,
    buffers: Option<BufferNodes>,
    symbol: Option<NodeId>,
    callable_plan: crate::callable_plan::Plan,
    callables: BTreeMap<usize, CallableNodes>,
    virtual_plan: crate::callable_plan::Plan,
    virtuals: BTreeMap<usize, CallableNodes>,
    callable_root: Option<CallableNodes>,
    /// Whether descriptors hold rows, and each row slot's function type.
    rows: bool,
    row_signatures: BTreeMap<u32, NodeId>,
    row_conventions: BTreeMap<u32, Convention>,
    /// Every program function by name: one index for the row conventions.
    funcs: FxHashMap<&'a str, &'a nts_core::hir::Func>,
    /// Each row column's function type and convention, shared by every slot
    /// that reads the column.
    column_rows: BTreeMap<u32, (NodeId, Convention)>,
    /// Each layout's Wasm parent where interfaces hold it as a prefix: from
    /// the layout to the parent's layout and the type to plan it by.
    prefix_parents: FxHashMap<usize, (usize, TypeId)>,
    /// The layouts whose storage carries a presence word.
    presence: BTreeSet<usize>,
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
            array_elements: FxHashMap::default(),
            backings: FxHashMap::default(),
            collections: FxHashMap::default(),
            collection_shapes: FxHashMap::default(),
            plain_arrays: FxHashMap::default(),
            root: None,
            work: Vec::new(),
            erased: None,
            promise: None,
            buffers: None,
            symbol: None,
            callable_plan,
            callables: BTreeMap::new(),
            virtual_plan,
            virtuals: BTreeMap::new(),
            callable_root: None,
            rows: false,
            row_signatures: BTreeMap::new(),
            row_conventions: BTreeMap::new(),
            prefix_parents: FxHashMap::default(),
            presence: BTreeSet::new(),
            funcs: program.funcs.iter().map(|f| (f.name.as_str(), f)).collect(),
            column_rows: BTreeMap::new(),
        }
    }

    /// The function type of `slot`'s row column, from the declaration a call
    /// through an interface names: the receiver as the object root, so every
    /// class's entry in the column has this one type.
    /// The function type of `slot`'s row column. It belongs to the column, not
    /// the slot: two slots that read one column (one adapter can fill two
    /// interfaces' columns) share the type and the convention by construction,
    /// so a call's cast to its slot's type holds for every entry there.
    fn row_signature(&mut self, slot: u32, declared: &str) -> Result<(), String> {
        let column = self
            .program
            .native_column(slot)
            .ok_or_else(|| format!("interface slot {slot} has no native column"))?;
        let (signature, convention) = self.column_row(column, declared)?;
        self.row_signatures.insert(slot, signature);
        self.row_conventions.insert(slot, convention);
        Ok(())
    }

    /// A row column's function type and convention, made once per column.
    fn column_row(&mut self, column: u32, declared: &str) -> Result<(NodeId, Convention), String> {
        if let Some(known) = self.column_rows.get(&column) {
            return Ok(known.clone());
        }
        let convention = self.column_convention(column, declared)?;
        let object = self.root();
        let mut params = vec![PendingSlot::Defined(object, true)];
        for ty in &convention.params {
            params.push(
                self.request(ty)?
                    .ok_or_else(|| format!("interface parameter {ty:?} has no storage"))?,
            );
        }
        let result = self.request(&convention.result)?;
        let signature = self.add(
            format!("row<{column}>"),
            None,
            true,
            Shape::Function(params, result),
        );
        self.column_rows
            .insert(column, (signature, convention.clone()));
        Ok((signature, convention))
    }

    /// The convention of a row column: what the bodies the rows hold there
    /// take and answer, which may be another declaration's than the one a
    /// call names. Bodies that disagree are refused by name; a column with
    /// none takes the call's own declaration.
    fn column_convention(&self, column: u32, declared: &str) -> Result<Convention, String> {
        let of = |name: &str| -> Result<Convention, String> {
            let func = self
                .funcs
                .get(name)
                .ok_or_else(|| format!("unresolved interface body `{name}`"))?;
            Ok(Convention {
                params: func.params.iter().skip(1).map(|p| p.ty.clone()).collect(),
                result: func.return_type.clone(),
            })
        };
        let mut found: Option<(String, Convention)> = None;
        for layout in &self.program.layouts {
            let methods = self.program.native_methods(layout)?;
            let Some(Some(body)) = methods.get(column as usize) else {
                continue;
            };
            // An interface's own row names its declaration, which no call
            // reaches: only bodies set the column's convention.
            if self.funcs.get(body).is_some_and(|f| f.abstract_declaration) {
                continue;
            }
            let convention = of(body)?;
            match &found {
                Some((first, known)) if *known != convention => {
                    return Err(format!(
                        "`{first}` and `{body}` fill one interface column with other types"
                    ));
                }
                Some(_) => {}
                None => found = Some(((*body).to_owned(), convention)),
            }
        }
        match found {
            Some((_, convention)) => Ok(convention),
            None => of(declared),
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
        let mut header = vec![
            Field::value(PendingSlot::Scalar(Slot::I32), false), // semantic identity
            Field::value(PendingSlot::Scalar(Slot::I32), false), // runtime kind
            Field::value(PendingSlot::Defined(ancestry, true), false),
        ];
        let rows = self.rows.then(|| {
            self.add(
                "rows".into(),
                None,
                true,
                Shape::Array(Field::value(
                    PendingSlot::Reference(RefType::FUNCREF),
                    false,
                )),
            )
        });
        if let Some(rows) = rows {
            header.push(Field::value(PendingSlot::Defined(rows, true), false));
        }
        let descriptor = self.add("descriptor".into(), None, false, Shape::Struct(header));
        let root = self.add(
            "object root".into(),
            None,
            false,
            Shape::Struct(vec![
                Field::value(PendingSlot::Defined(descriptor, false), false),
                Field::value(PendingSlot::Scalar(Slot::I32), true),
            ]),
        );
        self.root = Some(RootNodes {
            ancestry,
            descriptor,
            object: root,
            rows,
        });
        root
    }

    /// The promise, task and queue types, planned once.
    fn promise_types(&mut self) -> PromiseNodes {
        if let Some(nodes) = self.promise {
            return nodes;
        }
        self.erased_types();
        let root = self.root();
        let anyref = PendingSlot::Reference(RefType::ANYREF);
        let run = self.add(
            "task.run".into(),
            None,
            true,
            Shape::Function(vec![anyref], None),
        );
        let task = self.add(
            "task".into(),
            None,
            true,
            Shape::Struct(vec![
                Field::value(PendingSlot::Defined(run, false), false),
                Field::value(anyref, false),
            ]),
        );
        let tasks = self.add(
            "tasks".into(),
            None,
            true,
            Shape::Array(Field::value(PendingSlot::Defined(task, true), true)),
        );
        let Shape::Struct(mut fields) = self.nodes[root.0].shape.clone() else {
            unreachable!("the object root is a struct")
        };
        let promise = self.add(
            "promise".into(),
            Some(root),
            true,
            Shape::Struct(Vec::new()),
        );
        fields.extend([
            Field::value(PendingSlot::Scalar(Slot::I32), true),
            Field::value(anyref, true),
            Field::value(PendingSlot::Scalar(Slot::I32), true),
            Field::value(PendingSlot::Scalar(Slot::I32), true),
            Field::value(PendingSlot::Defined(tasks, true), true),
            Field::value(PendingSlot::Scalar(Slot::I32), true),
        ]);
        self.nodes[promise.0].shape = Shape::Struct(fields);
        let adoption = self.add(
            "adoption".into(),
            None,
            true,
            Shape::Struct(vec![
                Field::value(PendingSlot::Defined(promise, false), false),
                Field::value(PendingSlot::Defined(promise, false), false),
            ]),
        );
        let promises = self.add(
            "promises".into(),
            None,
            true,
            Shape::Array(Field::value(PendingSlot::Defined(promise, true), true)),
        );
        let nodes = PromiseNodes {
            promise,
            run,
            task,
            tasks,
            adoption,
            promises,
        };
        self.promise = Some(nodes);
        nodes
    }

    /// The buffer, view and `DataView` types, planned together: a view holds its
    /// buffer, and an erased value's tests ask for any of the three.
    fn buffer_types(&mut self) -> BufferNodes {
        if let Some(nodes) = self.buffers {
            return nodes;
        }
        let root = self.root();
        let i32 = |mutable| Field::value(PendingSlot::Scalar(Slot::I32), mutable);
        let bytes = self.add(
            "bytes".into(),
            None,
            true,
            Shape::Array(Field {
                slot: PendingSlot::Scalar(Slot::I32),
                packed: Some(StorageType::I8),
                mutable: true,
            }),
        );
        let Shape::Struct(prefix) = self.nodes[root.0].shape.clone() else {
            unreachable!("the object root is a struct")
        };
        let mut fields = prefix.clone();
        fields.extend([
            i32(true),
            i32(true),
            i32(true),
            Field::value(PendingSlot::Defined(bytes, true), true),
        ]);
        let buffer = self.add("buffer".into(), Some(root), true, Shape::Struct(fields));
        let window = |kind: bool| {
            let mut fields = prefix.clone();
            fields.extend([
                Field::value(PendingSlot::Defined(buffer, false), false),
                i32(false),
                i32(false),
            ]);
            if kind {
                fields.extend([i32(false), i32(false)]);
            }
            fields.push(i32(false));
            Shape::Struct(fields)
        };
        let view = self.add("view".into(), Some(root), true, window(true));
        let dataview = self.add("dataview".into(), Some(root), true, window(false));
        let nodes = BufferNodes {
            bytes,
            buffer,
            view,
            dataview,
        };
        self.buffers = Some(nodes);
        nodes
    }

    /// The symbol type: the object root, then the description, a JS string or
    /// null.
    fn symbol_type(&mut self) -> NodeId {
        if let Some(id) = self.symbol {
            return id;
        }
        let root = self.root();
        let Shape::Struct(mut fields) = self.nodes[root.0].shape.clone() else {
            unreachable!("the object root is a struct")
        };
        fields.push(Field::value(
            PendingSlot::Reference(RefType::EXTERNREF),
            false,
        ));
        let id = self.add("symbol".into(), Some(root), true, Shape::Struct(fields));
        self.symbol = Some(id);
        id
    }

    /// An erased bigint's box: the erased tag, then the value, as the number
    /// box holds a double. Its tag is `BIGINT`, so `typeof` answers "bigint".
    fn bigint_box(&mut self) -> NodeId {
        self.erased_types();
        let Some(nodes) = self.erased else {
            unreachable!("erased types planned above")
        };
        if let Some(id) = nodes.bigint {
            return id;
        }
        let tag = Field::value(PendingSlot::Scalar(Slot::I32), false);
        let id = self.add(
            "erased bigint".into(),
            Some(nodes.tagged),
            true,
            Shape::Struct(vec![
                tag,
                Field::value(PendingSlot::Scalar(Slot::V128), false),
            ]),
        );
        if let Some(erased) = self.erased.as_mut() {
            erased.bigint = Some(id);
        }
        id
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
        // A string is not boxed: the JS string itself, internalized into
        // anyref, is neither an i31 nor a struct.
        self.erased = Some(ErasedNodes {
            tagged,
            number,
            boolean,
            bigint: None,
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
                let storage = self.object(*id)?;
                // An interface that owners other than its prefix receivers
                // reach holds objects whose storage does not extend its own,
                // so its values are the root; reads through it dispatch, and
                // its positional reads cast to its storage.
                let reached_otherwise = crate::demand::is_face(self.program, *id)
                    && self
                        .program
                        .interface_access
                        .other_receivers(*id)
                        .is_some_and(|others| !others.is_empty());
                let node = if reached_otherwise {
                    self.root()
                } else {
                    storage
                };
                PendingSlot::Defined(node, true)
            }
            HirType::Managed(ManagedType::Array(element)) => {
                PendingSlot::Defined(self.array(element)?, true)
            }
            HirType::Erased => {
                self.erased_types();
                PendingSlot::Reference(RefType::ANYREF)
            }
            HirType::BigInt => PendingSlot::Scalar(Slot::V128),
            HirType::Managed(ManagedType::BoxedBigInt) => {
                PendingSlot::Defined(self.bigint_box(), true)
            }
            HirType::Managed(ManagedType::Template) => {
                return Err("tagged-template storage outside M1b".into());
            }
            HirType::Managed(ManagedType::Promise(_)) => {
                PendingSlot::Defined(self.promise_types().promise, true)
            }
            HirType::Managed(ManagedType::Map(key, value)) => {
                PendingSlot::Defined(self.collection(key, Some(value), false)?, true)
            }
            HirType::Managed(ManagedType::Table(key, value)) => {
                PendingSlot::Defined(self.collection(key, Some(value), true)?, true)
            }
            HirType::Managed(ManagedType::Set(key)) => {
                PendingSlot::Defined(self.collection(key, None, false)?, true)
            }
            HirType::Managed(ManagedType::Date) => {
                return Err(format!("collection/date storage outside M1b: {ty:?}"));
            }
            HirType::Managed(ManagedType::Buffer) => {
                PendingSlot::Defined(self.buffer_types().buffer, true)
            }
            HirType::Managed(ManagedType::View(element)) => {
                if crate::buffers::kind(element).is_none() {
                    return Err(format!("a view of {element:?}, which has no element kind"));
                }
                PendingSlot::Defined(self.buffer_types().view, true)
            }
            HirType::Managed(ManagedType::AnyView) => {
                PendingSlot::Defined(self.buffer_types().view, true)
            }
            HirType::Managed(ManagedType::DataView) => {
                PendingSlot::Defined(self.buffer_types().dataview, true)
            }
            HirType::Managed(ManagedType::Symbol) => PendingSlot::Defined(self.symbol_type(), true),
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
            | HirType::BigInt
            | HirType::Erased
            | HirType::Managed(_) => None,
            HirType::Void
            | HirType::Never
            | HirType::Int { .. }
            | HirType::Float { .. }
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
            // An interface with no fields holds nothing a layout must agree
            // on, so its values are any object: the root. Its calls read rows.
            let fieldless = self
                .program
                .layout(ty)
                .is_some_and(|layout| layout.fields.is_empty());
            if fieldless {
                // Registered, so a literal allocated at the interface and its
                // descriptor (whose row holds the literal's methods) resolve.
                let root = self.root();
                if let Some(at) = self
                    .program
                    .layouts
                    .iter()
                    .position(|l| l.types.contains(&ty))
                {
                    self.objects.entry(at).or_insert(root);
                }
                return Ok(root);
            }
            // One with fields is storage of its own, which every layout it
            // holds as a prefix extends. The core names those layouts; where
            // it names none, nothing says which, and that is refused.
            if self.program.interface_access.prefix_receivers(ty).is_none() {
                return Err(format!(
                    "interface `{}`, whose prefix receivers the plan does not name",
                    interface.name
                ));
            }
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
        let layout = &self.program.layouts[at];
        if crate::callable_plan::is_signature(self.program, layout) {
            if !layout.fields.is_empty() {
                return Err(format!("signature `{}` declares fields", layout.name));
            }
            let id = self.callable_root()?;
            self.objects.insert(at, id);
            return Ok(id);
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
                Work::Collection(id) => self.complete_collection(id)?,
            }
        }
        Ok(())
    }

    fn complete_object(&mut self, at: usize, id: NodeId) -> Result<(), String> {
        let layout = &self.program.layouts[at];
        let vtable = self
            .virtual_plan
            .members
            .get(&at)
            .copied()
            .map(|root| self.dispatch(root))
            .transpose()?;
        let callable = self
            .callable_plan
            .members
            .get(&at)
            .copied()
            .map(|root| self.callable(root))
            .transpose()?;
        // A closure's storage starts with its group's typed entries, or with
        // the callable root's, so every function value extends the root.
        let callable = match callable {
            Some(group) => Some(group),
            None if crate::callable_plan::is_callable_storage(self.program, layout) => {
                Some(self.callable_root()?)
            }
            None => None,
        };
        let base = match layout.base {
            Some(base) => {
                let base = self.object(base)?;
                // A signature base is the callable root, and a closure with
                // a typed group extends that group, which extends the root.
                if Some(base) == self.callable_root.as_ref().map(|nodes| nodes.base) {
                    callable.unwrap_or(base)
                } else {
                    base
                }
            }
            None => callable.unwrap_or_else(|| self.root()),
        };
        let root = callable.unwrap_or_else(|| self.root());
        let mut fields = match &self.nodes[root.0].shape {
            Shape::Struct(fields) => fields.clone(),
            Shape::Array(_) | Shape::Function(..) => {
                return Err(format!("base of `{}` is not an object", layout.name));
            }
        };
        // Every class of a dispatch hierarchy holds its exact vtable type: an
        // immutable field may narrow in a subtype, so a virtual call reads its
        // entries without a cast.
        if let Some(vtable) = vtable {
            fields[0] = Field::value(PendingSlot::Defined(vtable, false), false);
        }
        // Which optional properties were written: one word ahead of the
        // fields, at the same place in every storage of the family.
        if self.presence.contains(&at) {
            fields.push(Field::value(PendingSlot::Scalar(Slot::I32), true));
        }
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
        // Where interfaces hold this layout as a prefix, its parent is the
        // next shorter prefix; the declared base keeps its place otherwise.
        let declared = layout.base.and_then(|ty| self.layout_of(ty));
        let base = match self.prefix_parents.get(&at).copied() {
            Some((parent, ty)) if Some(parent) != declared => self.object(ty)?,
            _ => base,
        };
        self.nodes[id.0].base = Some(base);
        self.nodes[id.0].shape = Shape::Struct(fields);
        Ok(())
    }

    /// The layouts whose storage carries a presence word: every layout of a
    /// family in which one is a presence receiver. A family is what a Wasm
    /// subtype follows, declared bases and interface prefixes, so the word
    /// sits at one field in all of them and a value of any reads it there,
    /// as C reads its header's flags. A family holding a function value's
    /// storage carries none: its header continues with entries, and a
    /// presence call on it is refused by name. Pay for what is asked: a
    /// program that records no presence adds no field anywhere.
    fn plan_presence(&mut self, receivers: &BTreeMap<TypeId, crate::demand::ObjectUse>) {
        fn find(family: &mut [usize], mut at: usize) -> usize {
            while family[at] != at {
                family[at] = family[family[at]];
                at = family[at];
            }
            at
        }
        let layouts = &self.program.layouts;
        let mut family: Vec<usize> = (0..layouts.len()).collect();
        for (at, layout) in layouts.iter().enumerate() {
            let base = layout.base.and_then(|ty| self.layout_of(ty));
            let prefix = self.prefix_parents.get(&at).map(|&(parent, _)| parent);
            for other in base.into_iter().chain(prefix) {
                let (a, b) = (find(&mut family, at), find(&mut family, other));
                family[a.max(b)] = a.min(b);
            }
        }
        let (mut carrying, mut callable) = (BTreeSet::new(), BTreeSet::new());
        for (at, layout) in layouts.iter().enumerate() {
            let root = find(&mut family, at);
            if crate::callable_plan::is_signature(self.program, layout)
                || crate::callable_plan::is_callable_storage(self.program, layout)
                || self.callable_plan.members.contains_key(&at)
            {
                callable.insert(root);
            }
            if layout.types.iter().any(|ty| receivers.contains_key(ty)) {
                carrying.insert(root);
            }
        }
        self.presence = (0..layouts.len())
            .filter(|&at| {
                let root = find(&mut family, at);
                carrying.contains(&root) && !callable.contains(&root)
            })
            .collect();
    }

    /// The interfaces whose prefix receivers include the layout at `at`, by
    /// layout index, longest first.
    fn faces_holding(&self, at: usize) -> Result<Vec<(usize, TypeId)>, String> {
        let layout = &self.program.layouts[at];
        let mut faces: Vec<(usize, TypeId)> = Vec::new();
        for identity in &self.program.interface_identities {
            for &face in &identity.types {
                let Some(receivers) = self.program.interface_access.prefix_receivers(face) else {
                    continue;
                };
                if !receivers.iter().any(|ty| layout.types.contains(ty)) {
                    continue;
                }
                let face_at = self
                    .program
                    .layouts
                    .iter()
                    .position(|l| l.types.contains(&face))
                    .ok_or_else(|| format!("interface type {face:?} has no layout"))?;
                // An interface with no fields is the root, above every layout.
                if self.program.layouts[face_at].fields.is_empty() {
                    continue;
                }
                if face_at != at && !faces.iter().any(|(known, _)| *known == face_at) {
                    faces.push((face_at, face));
                }
            }
        }
        faces.sort_by_key(|(face_at, _)| {
            std::cmp::Reverse(self.program.layouts[*face_at].fields.len())
        });
        Ok(faces)
    }

    fn layout_of(&self, ty: TypeId) -> Option<usize> {
        self.program
            .layouts
            .iter()
            .position(|l| l.types.contains(&ty))
    }

    /// Each layout's Wasm parent where interfaces hold it as a prefix. A
    /// layout's declared ancestors and the interfaces holding it are all
    /// prefixes of it, so they are ordered by length, and each sits directly
    /// below the next shorter one: a fact of the storages, which a positional
    /// read through an interface needs to validate, not a semantic relation.
    /// At one length a class sits below an interface, and a subclass below its
    /// base. Refused by name: two interfaces of one length and two storages,
    /// two holders that disagree about a parent, and an interface below a
    /// class whose descriptor is its own vtable type.
    fn plan_prefix_parents(&mut self) -> Result<(), String> {
        let layouts = &self.program.layouts;
        let named = |face: TypeId| {
            self.program
                .interface_identities
                .iter()
                .find(|identity| identity.types.contains(&face))
                .map_or_else(|| format!("{face:?}"), |identity| identity.name.clone())
        };
        let mut parents: FxHashMap<usize, (usize, TypeId)> = FxHashMap::default();
        for at in 0..layouts.len() {
            let faces = self.faces_holding(at)?;
            if faces.is_empty() {
                continue;
            }
            for pair in faces.windows(2) {
                if layouts[pair[0].0].fields.len() == layouts[pair[1].0].fields.len() {
                    return Err(format!(
                        "`{}` is held as a prefix of interfaces `{}` and `{}`, of one length and two storages",
                        layouts[at].name,
                        named(pair[0].1),
                        named(pair[1].1)
                    ));
                }
            }
            // The layout and its declared ancestors, deepest first.
            let mut classes = Vec::new();
            let mut current = Some((at, layouts[at].types.first().copied()));
            while let Some((here, Some(ty))) = current {
                classes.push((here, ty));
                current = layouts[here]
                    .base
                    .map(|base| (self.layout_of(base).unwrap_or(usize::MAX), Some(base)))
                    .filter(|(base_at, _)| *base_at != usize::MAX);
            }
            // Merged by length, longest first; at one length, classes first.
            let mut chain: Vec<(usize, TypeId, bool)> = Vec::new();
            let (mut c, mut f) = (classes.iter().peekable(), faces.iter().peekable());
            loop {
                let take_class = match (c.peek(), f.peek()) {
                    (Some(&&(class, _)), Some(&&(face, _))) => {
                        layouts[class].fields.len() >= layouts[face].fields.len()
                    }
                    (Some(_), None) => true,
                    (None, Some(_)) => false,
                    (None, None) => break,
                };
                if take_class {
                    let &(class, ty) = c.next().ok_or("chain ended early")?;
                    chain.push((class, ty, false));
                } else {
                    let &(face, ty) = f.next().ok_or("chain ended early")?;
                    chain.push((face, ty, true));
                }
            }
            for pair in chain.windows(2) {
                let ((child, _, child_face), (parent, parent_ty, parent_face)) = (pair[0], pair[1]);
                if child_face && !parent_face && self.virtual_plan.members.contains_key(&parent) {
                    return Err(format!(
                        "interface storage `{}` would sit below class `{}`, whose descriptor is its own vtable",
                        layouts[child].name, layouts[parent].name
                    ));
                }
                match parents.insert(child, (parent, parent_ty)) {
                    Some((known, _)) if known != parent => {
                        return Err(format!(
                            "`{}` would sit below both `{}` and `{}`",
                            layouts[child].name, layouts[known].name, layouts[parent].name
                        ));
                    }
                    _ => {}
                }
            }
        }
        self.prefix_parents = parents;
        Ok(())
    }

    /// Every planned layout an interface holds as a prefix extends the
    /// interface's storage, or the plan is refused by name: a positional read
    /// through the interface is only valid on such storage.
    fn check_face_chains(&self) -> Result<(), String> {
        for identity in &self.program.interface_identities {
            for &face in &identity.types {
                let Some(receivers) = self.program.interface_access.prefix_receivers(face) else {
                    continue;
                };
                let Some(face_at) = self
                    .program
                    .layouts
                    .iter()
                    .position(|l| l.types.contains(&face))
                else {
                    continue;
                };
                let Some(&face_node) = self.objects.get(&face_at) else {
                    continue;
                };
                for receiver in receivers {
                    let Some(at) = self
                        .program
                        .layouts
                        .iter()
                        .position(|l| l.types.contains(receiver))
                    else {
                        continue;
                    };
                    let Some(&node) = self.objects.get(&at) else {
                        continue;
                    };
                    let mut current = Some(node);
                    let mut found = false;
                    while let Some(here) = current {
                        if here == face_node {
                            found = true;
                            break;
                        }
                        current = self.nodes[here.0].base;
                    }
                    if !found {
                        return Err(format!(
                            "`{}` is held as a prefix of interface `{}`, but its storage does not extend the interface's",
                            self.program.layouts[at].name, identity.name
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// The root every function value's storage extends: the object header,
    /// then one immutable entry per uniform slot the program calls, each
    /// taking the callable and the program-wide number of erased arguments.
    fn callable_root(&mut self) -> Result<NodeId, String> {
        if let Some(nodes) = &self.callable_root {
            return Ok(nodes.base);
        }
        let object = self.root();
        let Shape::Struct(mut fields) = self.nodes[object.0].shape.clone() else {
            return Err("object root is not a struct".into());
        };
        let base = self.add(
            "callable".into(),
            Some(object),
            false,
            Shape::Struct(Vec::new()),
        );
        // Published before the entries, whose signatures name it.
        self.callable_root = Some(CallableNodes {
            base,
            entries: BTreeMap::new(),
        });
        let erased = self
            .request(&HirType::Erased)?
            .ok_or("erased values have no storage")?;
        let mut entries = BTreeMap::new();
        for (slot, width) in self.callable_plan.uniform.clone() {
            let mut params = vec![PendingSlot::Defined(base, true)];
            params.extend(std::iter::repeat_n(erased, width));
            let signature = self.add(
                format!("uniform<{slot}>"),
                None,
                true,
                Shape::Function(params, Some(erased)),
            );
            fields.push(Field::value(PendingSlot::Defined(signature, false), false));
            entries.insert(slot, signature);
        }
        self.nodes[base.0].shape = Shape::Struct(fields);
        self.callable_root = Some(CallableNodes { base, entries });
        Ok(base)
    }

    fn callable(&mut self, root: usize) -> Result<NodeId, String> {
        if let Some(nodes) = self.callables.get(&root) {
            return Ok(nodes.base);
        }
        let object = self.callable_root()?;
        let Shape::Struct(mut fields) = self.nodes[object.0].shape.clone() else {
            return Err("callable root is not a struct".into());
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

    /// The vtable of one dispatch hierarchy: the descriptor header, then one
    /// immutable entry per virtual slot the program calls.
    fn dispatch(&mut self, root: usize) -> Result<NodeId, String> {
        if let Some(nodes) = self.virtuals.get(&root) {
            return Ok(nodes.base);
        }
        let object = self.root();
        let descriptor = self
            .root
            .map(|nodes| nodes.descriptor)
            .ok_or("missing object root")?;
        let Shape::Struct(mut fields) = self.nodes[descriptor.0].shape.clone() else {
            return Err("descriptor is not a struct".into());
        };
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
            format!("vtable<{}>", self.program.layouts[root].name),
            Some(descriptor),
            true,
            Shape::Struct(fields),
        );
        self.virtuals.insert(root, CallableNodes { base, entries });
        Ok(base)
    }
    fn array(&mut self, element: &HirType) -> Result<NodeId, String> {
        let key = match element {
            HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_)) => {
                match self.request(element)? {
                    Some(PendingSlot::Defined(node, _)) => ArrayKey::Storage(node),
                    _ => ArrayKey::Element(element.clone()),
                }
            }
            _ => ArrayKey::Element(element.clone()),
        };
        if let Some(id) = self.arrays.get(&key) {
            return Ok(*id);
        }
        let root = self.root();
        let id = self.add(
            format!("array<{element:?}>"),
            Some(root),
            true,
            Shape::Struct(Vec::new()),
        );
        self.arrays.insert(key, id);
        self.array_elements.insert(id, element.clone());
        self.work.push(Work::Array(element.clone(), id));
        Ok(id)
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

    fn collection(
        &mut self,
        key: &HirType,
        value: Option<&HirType>,
        table: bool,
    ) -> Result<NodeId, String> {
        let shape = CollectionKey {
            key: collection_key(key)?,
            value: value.map(collection_value),
            table,
        };
        if let Some(id) = self.collections.get(&shape) {
            return Ok(*id);
        }
        let root = self.root();
        let id = self.add(
            format!(
                "{}<{:?}, {:?}>",
                if table { "table" } else { "collection" },
                shape.key,
                shape.value
            ),
            Some(root),
            true,
            Shape::Struct(Vec::new()),
        );
        self.collections.insert(shape.clone(), id);
        self.collection_shapes.insert(id, (shape, None));
        self.work.push(Work::Collection(id));
        Ok(id)
    }

    /// An array type for one element storage, shared by every collection.
    fn plain_array(&mut self, element: &HirType) -> Result<NodeId, String> {
        if let Some(id) = self.plain_arrays.get(element) {
            return Ok(*id);
        }
        let mut field = self.field(element)?;
        field.packed = None;
        let id = self.add(
            format!("entries<{element:?}>"),
            None,
            true,
            Shape::Array(field),
        );
        self.plain_arrays.insert(element.clone(), id);
        Ok(id)
    }

    fn complete_collection(&mut self, id: NodeId) -> Result<(), String> {
        let root = self.root();
        let (shape, _) = self.collection_shapes[&id].clone();
        let key_storage = match shape.key {
            KeyKind::String => HirType::Managed(ManagedType::String),
            KeyKind::Number => HirType::NUMBER,
            KeyKind::Erased | KeyKind::Reference => HirType::Erased,
        };
        let keys = self.plain_array(&key_storage)?;
        let values = shape
            .value
            .as_ref()
            .map(|value| self.plain_array(value))
            .transpose()?;
        let ints = self.plain_array(&HirType::Int {
            bits: 32,
            signed: true,
        })?;
        let Shape::Struct(mut fields) = self.nodes[root.0].shape.clone() else {
            return Err("object root is not a struct".into());
        };
        fields.push(Field::value(PendingSlot::Scalar(Slot::I32), true));
        fields.push(Field::value(PendingSlot::Scalar(Slot::I32), true));
        fields.push(Field::value(PendingSlot::Defined(keys, false), true));
        fields.push(Field::value(PendingSlot::Defined(ints, false), true));
        fields.push(Field::value(PendingSlot::Defined(ints, false), true));
        if let Some(values) = values {
            fields.push(Field::value(PendingSlot::Defined(values, false), true));
        }
        self.nodes[id.0].shape = Shape::Struct(fields);
        self.collection_shapes
            .insert(id, (shape, Some((keys, values, ints))));
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
    fn metadata(&self, indices: &[u32]) -> Result<Metadata, String> {
        let mut objects = crate::object_plan::Plan::build(
            self.program,
            &self
                .objects
                .iter()
                .map(|(&at, id)| (at, indices[id.0]))
                .collect(),
        )?;
        let mut arrays = self
            .array_elements
            .iter()
            .map(|(id, element)| {
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
        // A function value's fields follow the header, the uniform entries
        // and its group's typed entries.
        let uniform = u32::try_from(self.callable_plan.uniform.len())
            .map_err(|_| "too many uniform slots")?;
        for &at in self.objects.keys() {
            let layout = &self.program.layouts[at];
            let root = self.callable_plan.members.get(&at).copied();
            if root.is_none() && !crate::callable_plan::is_callable_storage(self.program, layout) {
                continue;
            }
            let typed = root.map_or(Ok(0), |root| {
                u32::try_from(self.callable_plan.groups[&root].len())
                    .map_err(|_| "too many callable slots")
            })?;
            for ty in &layout.types {
                objects.attach_callable(*ty, root, ROOT_FIELDS + uniform + typed)?;
            }
        }
        for (&at, &root) in &self.virtual_plan.members {
            if self.objects.contains_key(&at) {
                for ty in &self.program.layouts[at].types {
                    objects.attach_virtual(*ty, root)?;
                }
            }
        }
        self.attach_presence(indices, &mut objects)?;
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
                class: None,
            });
        }
        let collections = self.collection_metadata(indices, identity, &mut objects)?;
        Ok((objects, arrays, collections))
    }

    /// Each carrying layout's presence word, and the topmost storage of each
    /// family: the one whose parent carries none.
    fn attach_presence(
        &self,
        indices: &[u32],
        objects: &mut crate::object_plan::Plan,
    ) -> Result<(), String> {
        let root = self.root.map(|root| root.object);
        let carrying = self
            .presence
            .iter()
            .filter_map(|at| self.objects.get(at).copied())
            .filter(|&id| Some(id) != root)
            .collect::<BTreeSet<_>>();
        let mut tops = BTreeSet::new();
        for at in &self.presence {
            let Some(&id) = self.objects.get(at) else {
                continue;
            };
            if !carrying.contains(&id) {
                continue;
            }
            let mut word = None;
            for ty in &self.program.layouts[*at].types {
                word = Some(objects.attach_presence(*ty)?);
            }
            if let Some(word) = word
                && !self.nodes[id.0]
                    .base
                    .is_some_and(|parent| carrying.contains(&parent))
            {
                tops.insert((indices[id.0], word));
            }
        }
        objects.presence_tops = tops.into_iter().collect();
        Ok(())
    }

    /// Each collection's storage and descriptor: an object, as `typeof`
    /// answers for a Map, a Set or a table.
    fn collection_metadata(
        &self,
        indices: &[u32],
        identity: u32,
        objects: &mut crate::object_plan::Plan,
    ) -> Result<BTreeMap<u32, Collection>, String> {
        let base = self
            .root
            .map_or(Ok(0), |root| match &self.nodes[root.object.0].shape {
                Shape::Struct(fields) => {
                    u32::try_from(fields.len()).map_err(|_| "too many root fields".to_owned())
                }
                _ => Err("object root is not a struct".to_owned()),
            })?;
        let mut collections = BTreeMap::new();
        for (id, (shape, arrays)) in &self.collection_shapes {
            let (keys, values, ints) =
                arrays.ok_or_else(|| format!("incomplete collection {}", self.nodes[id.0].name))?;
            let descriptor = u32::try_from(objects.descriptors.len())
                .map_err(|_| "too many collection descriptors")?;
            objects.descriptors.push(crate::object_plan::Descriptor {
                identity,
                kind: nts_core::hir::tags::OBJECT,
                ancestry: Vec::new(),
                class: None,
            });
            collections.insert(
                indices[id.0],
                Collection {
                    key: shape.key,
                    value: shape.value.clone(),
                    table: shape.table,
                    wrapper: indices[id.0],
                    keys: indices[keys.0],
                    values: values.map(|values| indices[values.0]),
                    ints: indices[ints.0],
                    base,
                    descriptor,
                },
            );
        }
        Ok(collections)
    }
    fn resolved_callables(
        &self,
        indices: &[u32],
    ) -> BTreeMap<usize, crate::callable_plan::Resolved> {
        let uniform = u32::try_from(self.callable_plan.uniform.len()).unwrap_or(u32::MAX);
        Self::resolve_entries(
            &self.callables,
            &self.callable_plan,
            indices,
            ROOT_FIELDS + uniform,
        )
    }

    /// Each dispatch hierarchy's vtable entries, after the descriptor header.
    fn resolved_virtuals(
        &self,
        indices: &[u32],
    ) -> BTreeMap<usize, crate::callable_plan::Resolved> {
        Self::resolve_entries(
            &self.virtuals,
            &self.virtual_plan,
            indices,
            DESCRIPTOR_HEADER + u32::from(self.rows),
        )
    }

    /// The callable root and its uniform entries, each a field after the
    /// header taking erased arguments and answering an erased value.
    fn resolved_uniform(&self, indices: &[u32]) -> Option<crate::callable_plan::Resolved> {
        let nodes = self.callable_root.as_ref()?;
        let entries = self
            .callable_plan
            .uniform
            .iter()
            .enumerate()
            .map(|(at, (&slot, &width))| {
                (
                    slot,
                    crate::callable_plan::ResolvedEntry {
                        slot,
                        field: ROOT_FIELDS + crate::module::index(at),
                        signature: indices[nodes.entries[&slot].0],
                        params: vec![HirType::Erased; width],
                        result: HirType::Erased,
                    },
                )
            })
            .collect();
        Some(crate::callable_plan::Resolved {
            base: indices[nodes.base.0],
            entries,
        })
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
        let components = self.one_group(components(&graph), &graph);
        let ordered = self.order_bases(components)?;
        let mut indices = vec![0; self.nodes.len()];
        let mut count = 0_u32;
        for group in &ordered {
            for &id in group {
                indices[id] = count;
                count = count.checked_add(1).ok_or("too many wasm types")?;
            }
        }
        let supers = self.supers(&ordered, &indices);
        let groups = self.encode(&ordered, &indices);
        let (mut objects, arrays, collections) = self.metadata(&indices)?;
        let object = nts_core::hir::tags::OBJECT;
        let promise_descriptor =
            builtins(&mut objects, usize::from(self.promise.is_some()), object)?;
        let buffer_descriptor = builtins(
            &mut objects,
            3 * usize::from(self.buffers.is_some()),
            object,
        )?;
        let symbol_descriptor = builtins(
            &mut objects,
            usize::from(self.symbol.is_some()),
            nts_core::hir::tags::SYMBOL,
        )?;
        Ok(Plan {
            arrays,
            collections,
            callables: self.resolved_callables(&indices),
            uniform: self.resolved_uniform(&indices),
            virtuals: self.resolved_virtuals(&indices),
            root: self.root.map(|nodes| RootTypes {
                ancestry: indices[nodes.ancestry.0],
                descriptor: indices[nodes.descriptor.0],
                object: indices[nodes.object.0],
                rows: nodes.rows.map(|rows| indices[rows.0]),
            }),
            row_signatures: self
                .row_signatures
                .iter()
                .map(|(&slot, node)| (slot, indices[node.0]))
                .collect(),
            row_conventions: self.row_conventions,
            objects,
            erased: self.erased.map(|nodes| ErasedTypes {
                tagged: indices[nodes.tagged.0],
                number: indices[nodes.number.0],
                boolean: indices[nodes.boolean.0],
                bigint: nodes.bigint.map(|node| indices[node.0]),
            }),
            promise: self.promise.map(|nodes| PromiseTypes {
                promise: indices[nodes.promise.0],
                run: indices[nodes.run.0],
                task: indices[nodes.task.0],
                tasks: indices[nodes.tasks.0],
                adoption: indices[nodes.adoption.0],
                promises: indices[nodes.promises.0],
                descriptor: promise_descriptor,
                base: ROOT_FIELDS,
            }),
            symbol: self.symbol.map(|node| SymbolTypes {
                symbol: indices[node.0],
                descriptor: symbol_descriptor,
            }),
            buffers: self.buffers.map(|nodes| BufferTypes {
                bytes: indices[nodes.bytes.0],
                buffer: indices[nodes.buffer.0],
                view: indices[nodes.view.0],
                dataview: indices[nodes.dataview.0],
                buffer_descriptor,
                view_descriptor: buffer_descriptor + 1,
                dataview_descriptor: buffer_descriptor + 2,
            }),
            slots: self
                .slots
                .into_iter()
                .map(|(ty, slot)| (ty, resolve(&indices, slot)))
                .collect(),
            groups,
            supers,
            count,
        })
    }
    /// The type section's rec groups, each type with its declared supertype.
    fn encode(&self, ordered: &[Vec<usize>], indices: &[u32]) -> Vec<Vec<SubType>> {
        let encode_field = |field: &Field| FieldType {
            element_type: field
                .packed
                .unwrap_or_else(|| StorageType::Val(resolve(indices, field.slot).wasm())),
            mutable: field.mutable,
        };
        ordered
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
                                    params.iter().map(|slot| resolve(indices, *slot).wasm()),
                                    result.map(|slot| resolve(indices, slot).wasm()),
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
            .collect()
    }
    /// Each type's declared supertype and kind, in type-index order.
    fn supers(&self, ordered: &[Vec<usize>], indices: &[u32]) -> Vec<(Option<u32>, Kind)> {
        ordered
            .iter()
            .flatten()
            .map(|&id| {
                let node = &self.nodes[id];
                let kind = match node.shape {
                    Shape::Struct(_) => Kind::Struct,
                    Shape::Array(_) => Kind::Array,
                    Shape::Function(..) => Kind::Func,
                };
                (node.base.map(|base| indices[base.0]), kind)
            })
            .collect()
    }
    /// Every type shares one rec group, except a function signature that names
    /// no other defined type.
    ///
    /// The engine canonicalizes types iso-recursively: two structurally equal
    /// types in separate rec groups are one type, so a `ref.test` or
    /// `ref.cast` between them cannot tell them apart. `Swapped { b; a }` and
    /// `Pair { a; b }`, both two f64s on the object root, were one type, and a
    /// test for `Pair` passed a `Swapped` and read its fields in the wrong
    /// order (interface-same-shape-owner). In one group, types at different
    /// positions are distinct, so every test and cast on object types is
    /// nominal. `J2Wasm`, `Kotlin/Wasm` and `dart2wasm` emit their types the same
    /// way. A leaf signature stays apart because an import's type must equal
    /// the engine's own for a builtin, which is a group of one.
    fn one_group(&self, components: Vec<Vec<usize>>, graph: &[Vec<usize>]) -> Vec<Vec<usize>> {
        let (leaves, rest): (Vec<_>, Vec<_>) = components.into_iter().partition(|component| {
            matches!(component.as_slice(), [id]
                if graph[*id].is_empty() && matches!(self.nodes[*id].shape, Shape::Function(..)))
        });
        let mut groups = leaves;
        let shared: Vec<usize> = rest.into_iter().flatten().collect();
        if !shared.is_empty() {
            groups.push(shared);
        }
        groups
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
/// A planned slot's physical type, once every node has its index.
fn resolve(indices: &[u32], slot: PendingSlot) -> Physical {
    match slot {
        PendingSlot::Scalar(slot) => Physical::Scalar(slot),
        PendingSlot::Reference(reference) => Physical::Reference(reference),
        PendingSlot::Defined(id, nullable) => Physical::Reference(RefType {
            nullable,
            heap_type: HeapType::Concrete(indices[id.0]),
        }),
    }
}

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

    /// A presence word goes only where a call records presence, and then to
    /// every storage of that family at one field, right after the header: a
    /// subclass's sits where its base's does, with its fields after it. A
    /// layout of another family carries none, and its first field stays the
    /// first after the header.
    #[test]
    fn a_presence_word_follows_the_header_in_each_storage_of_its_family() {
        let mut f = function("records", &[object(2)], HirType::Void);
        let receiver = value(&mut f, OpKind::Param(0), object(2));
        let bit = value(&mut f, OpKind::ConstInt(0), test_common::U32);
        let set = value(
            &mut f,
            OpKind::Call {
                callee: nts_core::hir::Callee::External("nts_presence_set".into()),
                args: vec![receiver, bit],
                frame: None,
            },
            HirType::Void,
        );
        f.blocks
            .push(block(&[receiver], &[bit, set], Terminator::Return(None)));
        let mut asks = function("asks", &[object(1), object(3)], HirType::Void);
        asks.blocks.push(block(&[], &[], Terminator::Return(None)));
        let mut p = program(vec![f, asks]);
        p.public_api.clear();
        let number = HirType::Float { bits: 64 };
        p.layouts.push(layout(
            1,
            "Base",
            vec![field("x", number.clone()), field("maybe", HirType::Erased)],
            None,
        ));
        p.layouts.push(layout(
            2,
            "Derived",
            vec![
                field("x", number.clone()),
                field("maybe", HirType::Erased),
                field("y", number.clone()),
            ],
            Some(1),
        ));
        p.layouts
            .push(layout(3, "Apart", vec![field("x", number)], None));
        let plan = Plan::build(&p).unwrap();
        let storage = |id| plan.objects.object(&object(id)).unwrap();
        for id in [1, 2] {
            assert_eq!(storage(id).presence, Some(ROOT_FIELDS), "{id}");
            assert_eq!(storage(id).field_base, ROOT_FIELDS + 1, "{id}");
        }
        assert_eq!(storage(3).presence, None);
        assert_eq!(storage(3).field_base, ROOT_FIELDS);
        assert_eq!(
            plan.objects.presence_tops,
            vec![(storage(1).physical, ROOT_FIELDS)]
        );
        assert!(plan.heap_subtype(
            HeapType::Concrete(storage(2).physical),
            HeapType::Concrete(storage(1).physical)
        ));
        crate::validate(&bytes(&plan)).unwrap();
    }

    /// Layouts are related only through their declared parents: two layouts
    /// of one shape stay unrelated, although the engine would treat them as
    /// one type, because their vtables may give one slot two meanings. An
    /// array is keyed by its element's storage, so arrays of two names for
    /// one layout are one array type. Whatever the relation admits, the
    /// validator admits too.
    #[test]
    fn layouts_relate_by_parentage_and_arrays_by_element_storage() {
        let array = |id| HirType::Managed(ManagedType::Array(Box::new(object(id))));
        let mut p = typed_program(&[
            object(1),
            object(2),
            object(4),
            array(1),
            array(2),
            array(4),
        ]);
        let mut shared = layout(
            1,
            "One",
            vec![field("x", HirType::Float { bits: 64 })],
            None,
        );
        shared.types.push(TypeId(4));
        p.layouts.push(shared);
        p.layouts.push(layout(
            2,
            "Same",
            vec![field("x", HirType::Float { bits: 64 })],
            None,
        ));
        let plan = Plan::build(&p).unwrap();
        let heap = |ty: HirType| match plan.value_slot(&ty).unwrap() {
            Physical::Reference(reference) => reference.heap_type,
            Physical::Scalar(_) => unreachable!(),
        };
        let validates = |from: HeapType, to: HeapType| {
            let mut types = plan.encode();
            let reference = |heap_type| {
                wasm_encoder::ValType::Ref(RefType {
                    nullable: true,
                    heap_type,
                })
            };
            types.ty().function([reference(from)], [reference(to)]);
            let mut functions = wasm_encoder::FunctionSection::new();
            functions.function(plan.count());
            let mut code = wasm_encoder::CodeSection::new();
            let mut body = wasm_encoder::Function::new([]);
            body.instruction(&wasm_encoder::Instruction::LocalGet(0));
            body.instruction(&wasm_encoder::Instruction::End);
            code.function(&body);
            let mut module = wasm_encoder::Module::new();
            module.section(&types).section(&functions).section(&code);
            crate::validate(&module.finish()).is_ok()
        };
        // Two names for one layout: one object type, one array type.
        assert_eq!(heap(object(1)), heap(object(4)));
        assert_eq!(heap(array(1)), heap(array(4)));
        for (from, to, related) in [
            (object(1), object(2), false),
            (object(2), object(1), false),
            (array(1), array(2), false),
            (array(1), array(4), true),
        ] {
            let (from, to) = (heap(from), heap(to));
            assert_eq!(plan.heap_subtype(from, to), related, "{from:?} -> {to:?}");
            if related {
                assert!(validates(from, to), "validator: {from:?} -> {to:?}");
            }
        }
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
        // Every type but a leaf signature shares one rec group.
        assert_eq!(plan.groups.iter().map(Vec::len).max(), Some(5));
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
        // Every type but a leaf signature shares one rec group.
        assert_eq!(plan.groups.iter().map(Vec::len).max(), Some(515));
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
