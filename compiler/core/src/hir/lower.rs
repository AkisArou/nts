//! Lowering a semantic snapshot into HIR.
//!
//! # Scope
//!
//! The first slice: functions, parameters, literals, binary arithmetic, and
//! `return`. Enough to carry a program end to end through a backend, which is
//! what makes the next design decisions answerable by a consumer rather than
//! guessed at.
//!
//! Anything outside it is refused rather than approximated. RFC §4.1 requires
//! that unsupported *reachable* behavior produce a precise diagnostic, and a
//! lowering that silently emits nothing for a statement it did not understand
//! produces a program that runs and is wrong.

use nts_diagnostics::{Diagnostic, Location};
use nts_semantic_schema::{
    DeclarationModifiers, LiteralValue, NodeData, NodeId, NodeKind, Origin, SemanticSnapshot,
    SymbolFlags, SymbolId, SymbolRecord, TypeId, TypeKind, TypeRecord, syntax,
};

use super::facts::Facts;
use super::{
    BinOp, Block, BlockId, Callee, Field, Func, HirType, Layout, ManagedType, Op, OpKind, Param,
    ParamShape, Program, Terminator, UnOp, ValueId,
};

/// What a lowering produced, and what it could not.
#[derive(Debug, Default)]
pub struct Lowered {
    pub program: Program,
    /// Constructs the lowering did not understand.
    ///
    /// Collected rather than returned as an error so one run reports every
    /// unsupported construct instead of the first.
    pub diagnostics: Vec<Diagnostic>,
}

impl Lowered {
    /// Whether anything was refused.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

/// What a module declares outside any function.
///
/// Two maps rather than one, because the two are not the same thing. A `const`
/// with a constant initializer is resolved to its value at each use, so it costs
/// nothing and reads like an immediate; a `let` is storage that every function
/// shares.
#[derive(Debug, Clone, Default)]
struct ModuleScope {
    /// Symbol to value, for a `const` this could evaluate.
    constants: rustc_hash::FxHashMap<u32, f64>,
    /// Symbol to index in [`Program::globals`].
    variables: rustc_hash::FxHashMap<u32, u32>,
    /// The type of each global, by the same index.
    types: Vec<HirType>,
    /// The globals themselves, handed to the program once collection is done.
    globals: Vec<super::Global>,
    /// Symbols whose initializer is not a constant, and the expression that
    /// computes it.
    ///
    /// A module-scope binding is a global, and a global's `initial` has to be a
    /// number the artifact can carry. `let total = bump(41)` is not one -- so
    /// the whole declaration used to be refused, which is why `export const
    /// derived = imported + 1`, the most ordinary line in a module, did not
    /// compile. It is a global whose initial value is zero and whose real value
    /// is assigned by `module#init`, in evaluation order with everything else.
    deferred: rustc_hash::FxHashMap<u32, NodeId>,
    /// Symbols this declares but cannot represent, and why.
    ///
    /// Kept rather than refused on sight. A module-scope variable no function
    /// reads costs nothing and should be refused by nothing -- and a corpus of
    /// real files is mostly declarations that the file under test never touches.
    /// Reporting them eagerly took the share of TypeScript's own test cases that
    /// lower completely from 54 files to 25.
    unsupported: rustc_hash::FxHashMap<u32, String>,
    /// The layouts the globals need.
    ///
    /// A global of object type is a `struct` in the emitted C, and naming one
    /// requires its layout. Every other layout is built by the *function* that
    /// uses the type -- so a global whose initializer was refused had none
    /// built for it by anybody, and the backend failed with `an object type
    /// with no layout` on a program the lowering had called clean.
    layouts: Vec<Layout>,
    /// Declarations refused on sight rather than on use.
    ///
    /// The laziness above is right for *data* — a constant nothing reads is not
    /// a problem — and wrong for *code*. `export const bag = { f() {…} }` is a
    /// function the author wrote, and it was neither lowered nor reported:
    /// nothing walks into an object literal looking for methods, and the
    /// declaration itself is only refused if something reads the name. The file
    /// compiled to "0 functions, nothing refused".
    refusals: Vec<Diagnostic>,
}

/// The class hierarchy, as far as method dispatch needs it.
///
/// The checker's property list is flattened, so a derived type's members give no
/// hint which class declared them -- and the name of the function to call is
/// exactly "the class that declared it". This recovers that, and answers the
/// other question a call site has to ask: whether anything overrides the method,
/// because a method nothing overrides is a static call and a method something
/// overrides is not.
#[derive(Debug, Clone, Default)]
struct Hierarchy {
    /// A class's superclass, by instance type.
    base: rustc_hash::FxHashMap<TypeId, TypeId>,
    /// The methods a class declares itself, as opposed to inherits.
    declares: rustc_hash::FxHashMap<TypeId, Vec<String>>,
    /// A class's name, which is half of the function name a call emits.
    name: rustc_hash::FxHashMap<TypeId, String>,
    /// The dispatch slot of each overridden method, keyed by the class that
    /// *first* declares it.
    ///
    /// Keyed by the root rather than by the overrider, because a slot has to
    /// mean the same thing everywhere in a hierarchy: a `Shape*` and a
    /// `Square*` both look up `area` at the same index, which is the whole
    /// mechanism.
    slots: rustc_hash::FxHashMap<(TypeId, String), u32>,
    /// The classes that declare a constructor.
    ///
    /// A class without one has nothing to run at `new`: the allocation is
    /// zeroed and that is the whole of it. Calling a constructor that was never
    /// declared is a link error, and an implicit one that forwards to a base's
    /// is a call to *the base's* rather than to a function of its own.
    constructs: rustc_hash::FxHashSet<TypeId>,
    /// The one slot every closure's `call` goes in, where the program has
    /// closures at all.
    ///
    /// One rather than one per function type, because there is nothing to tell
    /// apart: a class is never also a closure, and a call through the slot
    /// spells the signature it is making, so two closure types sharing an index
    /// cannot be confused for each other. A slot per type would make every
    /// dispatch table in the program as long as the number of function types in
    /// it, for no distinction anyone can observe.
    closure_slot: Option<u32>,
}

impl Hierarchy {
    /// The nearest class at or above `ty` that declares `member`.
    fn declaring(&self, ty: TypeId, member: &str) -> Option<TypeId> {
        let mut at = Some(ty);
        // Bounded, because a hierarchy that contains a cycle is not one and
        // walking it would not stop.
        for _ in 0..64 {
            let here = at?;
            if self
                .declares
                .get(&here)
                .is_some_and(|names| names.iter().any(|name| name == member))
            {
                return Some(here);
            }
            at = self.base.get(&here).copied();
        }
        None
    }

    /// The highest class at or above `ty` that declares `member`.
    ///
    /// The slot belongs to this one. `declaring` finds the *implementation* to
    /// call; this finds the class the slot is numbered against.
    fn root_declaring(&self, ty: TypeId, member: &str) -> Option<TypeId> {
        let mut found = None;
        let mut at = Some(ty);
        for _ in 0..64 {
            let Some(here) = at else { break };
            if self
                .declares
                .get(&here)
                .is_some_and(|names| names.iter().any(|name| name == member))
            {
                found = Some(here);
            }
            at = self.base.get(&here).copied();
        }
        found
    }

    /// How many slots a dispatch table has.
    fn table_size(&self) -> usize {
        self.slots.len() + usize::from(self.closure_slot.is_some())
    }

    /// The nearest class at or above `ty` that declares a constructor.
    fn constructor(&self, ty: TypeId) -> Option<TypeId> {
        let mut at = Some(ty);
        for _ in 0..64 {
            let here = at?;
            if self.constructs.contains(&here) {
                return Some(here);
            }
            at = self.base.get(&here).copied();
        }
        None
    }

    /// The dispatch slot a call on `ty` would use, if it needs one.
    fn slot_for(&self, ty: TypeId, member: &str) -> Option<u32> {
        let root = self.root_declaring(ty, member)?;
        self.slots.get(&(root, member.to_owned())).copied()
    }

    /// Whether `ty` is `ancestor` or descends from it.
    fn descends_from(&self, ty: TypeId, ancestor: TypeId) -> bool {
        let mut at = Some(ty);
        for _ in 0..64 {
            let Some(here) = at else { return false };
            if here == ancestor {
                return true;
            }
            at = self.base.get(&here).copied();
        }
        false
    }

    /// Whether a call on a receiver of type `ty` could reach more than one
    /// implementation of `member`.
    ///
    /// True exactly when some class below `ty` declares it and is not the one
    /// `ty` itself would reach. That is the whole condition for needing dynamic
    /// dispatch, and it is why a class hierarchy with no overriding costs
    /// nothing: every call in it is static.
    fn overridden(&self, ty: TypeId, member: &str) -> bool {
        let Some(target) = self.declaring(ty, member) else {
            return false;
        };
        self.declares.iter().any(|(class, names)| {
            *class != target
                && names.iter().any(|name| name == member)
                && self.descends_from(*class, ty)
        })
    }
}

/// Which class declarations are generic, and what each was instantiated at.
///
/// Keyed by the declaration rather than by its symbol, because the lowering
/// walks nodes.
fn generic_classes(
    snapshot: &SemanticSnapshot,
) -> rustc_hash::FxHashMap<NodeId, Vec<super::generics::Instantiation>> {
    let by_symbol = super::generics::instantiations(snapshot);
    let probe = FuncBuilder::new(snapshot);
    snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.kind == NodeKind::Syntax(syntax::CLASS_DECLARATION))
        .filter_map(|(index, _)| {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let symbol = probe
                .children(id)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| probe.node(child).symbol)?;
            Some((id, by_symbol.get(&symbol)?.clone()))
        })
        .collect()
}

/// Read every class declaration's name, base and own methods.
fn collect_hierarchy(snapshot: &SemanticSnapshot, closures: &[ClosureInfo]) -> Hierarchy {
    let mut hierarchy = Hierarchy::default();
    let probe = FuncBuilder::new(snapshot);
    let instantiations = super::generics::instantiations(snapshot);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::CLASS_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(declared) = snapshot.node_types.get(&id).copied() else {
            continue;
        };
        // A generic class's facts belong to each *instantiation*, because that
        // is the type a `new` and a method call name. The declaration's own type
        // is never constructed and never laid out.
        let types: Vec<TypeId> = probe
            .children(id)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| probe.node(child).symbol)
            .and_then(|symbol| instantiations.get(&symbol))
            .map_or_else(
                || vec![declared],
                |instances| instances.iter().map(|instance| instance.ty).collect(),
            );

        for ty in types {
            if let Some(name) = probe
                .children(id)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| probe.node(child).text.clone())
            {
                // Qualified for an instantiation, by the same construction
                // `layout_of` uses: a call site names its callee through this
                // map and the function was named through that one, so the two
                // have to agree letter for letter.
                hierarchy
                    .name
                    .insert(ty, format!("{name}{}", instantiation_suffix(snapshot, ty)));
            }
            // `extends` first, then `implements`, and a class extends at most one
            // class. An interface contributes no implementation, so it is not a
            // base for dispatch even though it is one for assignability.
            if let Some(base) = snapshot.base_types.get(&ty).and_then(|bases| bases.first()) {
                hierarchy.base.insert(ty, *base);
            }

            let declared_methods: Vec<String> = probe
                .children(id)
                .into_iter()
                .filter_map(|child| {
                    // An accessor is a member like a method, under a name that
                    // says which it is -- a class may declare `get x` and `set
                    // x` together, and a method `x` is a third thing.
                    let prefix = match probe.kind_of(child) {
                        Some(syntax::METHOD_DECLARATION) => "",
                        Some(syntax::GET_ACCESSOR) => "get ",
                        Some(syntax::SET_ACCESSOR) => "set ",
                        _ => return None,
                    };
                    // A symbol-keyed method is named the same way here as at
                    // its declaration and at its call sites -- three places that
                    // have to agree letter for letter, and did not. The
                    // hierarchy skipped what it could not name, so
                    // `c[kStep](2)` resolved to `__@kStep@2` and then found no
                    // declaration for it.
                    let name = probe
                        .member_name(child)
                        .or_else(|| probe.symbol_member_name(id, child, Some(ty)))?;
                    Some(format!("{prefix}{name}"))
                })
                .collect();
            if probe
                .children(id)
                .into_iter()
                .any(|child| probe.kind_of(child) == Some(syntax::CONSTRUCTOR))
            {
                hierarchy.constructs.insert(ty);
            }
            hierarchy.declares.insert(ty, declared_methods.clone());
        }
    }

    // A slot for every method something overrides, numbered against the class
    // that first declares it. A method nothing overrides gets none, which is why
    // a hierarchy with no overriding pays nothing: every call in it is static
    // and no class carries a table.
    let mut roots: Vec<(TypeId, String)> = Vec::new();
    for (class, names) in &hierarchy.declares {
        for name in names {
            let Some(root) = hierarchy.root_declaring(*class, name) else {
                continue;
            };
            if hierarchy.overridden(root, name) && !roots.contains(&(root, name.clone())) {
                roots.push((root, name.clone()));
            }
        }
    }
    // Sorted, so one compiler on one input numbers the slots one way.
    roots.sort_by(|a, b| a.0.0.cmp(&b.0.0).then_with(|| a.1.cmp(&b.1)));
    for (at, key) in roots.into_iter().enumerate() {
        hierarchy
            .slots
            .insert(key, u32::try_from(at).unwrap_or(u32::MAX));
    }
    // One more slot on the end, if anything in the program is a closure. A
    // program with none carries no table at all, which is what it should carry.
    if closures.iter().any(|closure| closure.refusal.is_none()) {
        hierarchy.closure_slot = Some(u32::try_from(hierarchy.slots.len()).unwrap_or(u32::MAX));
    }
    hierarchy
}

/// One arrow function, and what its body reads from the scope around it.
///
/// # Why a closure is an object
///
/// A closure is captured state plus code. So is an object. Saying so rather
/// than inventing a second mechanism means a closure gets the object machinery
/// exactly as written: a base-first layout, escape analysis that leaves it in
/// the frame when it does not outlive the call, reference counting with the
/// same rules as everything else, and dispatch through a slot. None of the four
/// needed a line of new code.
///
/// The class is the compiler's own -- the checker has a type for the
/// *signature*, which is what a value holding the closure is declared as, but
/// nothing for the thing that carries the captures.
#[derive(Clone, Debug)]
struct ClosureInfo {
    /// The arrow function node, or -- when [`Self::wraps`] -- the declaration of
    /// the named function this exists to be.
    node: NodeId,
    /// What the body reads from outside itself, in a fixed order.
    captures: Vec<Capture>,
    /// Why it cannot be lowered, if it cannot.
    ///
    /// Recorded here rather than raised here, so that a program containing one
    /// closure this does not handle still compiles the rest -- and so the
    /// reason is reported at the arrow rather than at whatever read it.
    refusal: Option<&'static str>,
    /// Whether this closure is a *named function* used as a value rather than
    /// an arrow.
    ///
    /// `nextTick(finish, stream)` passes `finish` where JavaScript's answer is
    /// a function object. This compiler's answer is a closure with no captures
    /// whose `call` forwards to `finish` -- one static instance, so `finish`
    /// is the same object everywhere it is written. An event emitter removing
    /// a listener depends on exactly that.
    wraps: bool,
}

/// The symbol a captured `this` is filed under.
///
/// `this` is not a name a program declares, so it has no symbol of its own --
/// and it is captured for exactly the reasons every other free name is: an
/// arrow does not bind one, so the `this` in its body belongs to the enclosing
/// method and has to travel with the closure.
///
/// Reserved rather than synthesised, because both sides of a capture look it up
/// by symbol and one number has to mean the same thing in both. No real symbol
/// reaches `u32::MAX`: symbols index a table the frontend built.
const THIS_CAPTURE: u32 = u32::MAX;

/// A name the closure body reads and the enclosing scope binds.
#[derive(Clone, Debug)]
struct Capture {
    symbol: u32,
    /// The field name, which is the source name: a dump of the layout should
    /// read like the program.
    name: String,
    /// A node that reads it, for the type and for a diagnostic's location.
    at: NodeId,
    /// Whether the name is declared *below* the closure that reads it.
    ///
    /// The cell then exists before it holds anything, and a body that runs in
    /// that window would read a zero where JavaScript throws a
    /// `ReferenceError`. Such a cell carries a `ready` flag and its reads are
    /// guarded, so the program stops instead of answering.
    ///
    /// Only a *closure* can reach that window: TypeScript rejects a direct use
    /// before declaration in the same scope, so there is no other way in.
    forward: bool,
    /// Whether the closure captures the *binding* rather than its value.
    ///
    /// JavaScript closures always capture the binding. For a name nothing
    /// writes to that is the same thing as capturing the value, and capturing
    /// the value is free -- so that is what happens, and it is the common case
    /// by a wide margin.
    ///
    /// For a name something *does* write to the two differ, and observably:
    ///
    /// ```ts
    /// let called = false;
    /// const onDestroy = () => { if (called) return; called = true; };
    /// ```
    ///
    /// Both the enclosing function and the closure have to see one `called`.
    /// So the variable moves into a one-slot cell on the heap, both hold a
    /// pointer to it, and every read and write goes through the cell. The
    /// pointer is what gets captured, still by value.
    by_reference: bool,
}

/// Whether a name is reached *by name* rather than carried in a closure.
///
/// There is one of it for the whole program and every function already reaches
/// it, so copying it into a closure object would be storage for nothing. That
/// covers a function, a class, an import of either, and anything declared at
/// module scope -- and a *type*, which is not a value at all.
///
/// Getting this wrong does not produce a wrong answer, it produces a refusal
/// that blames the wrong thing: the closure is refused for finding no value for
/// a name that never had one, and the message can only say how far away the
/// declaration was.
fn reached_by_name(
    probe: &FuncBuilder,
    snapshot: &SemanticSnapshot,
    symbol: SymbolId,
    record: &SymbolRecord,
) -> bool {
    // There is one of it for the whole program, so copying a pointer to
    // it into every closure would be storage for nothing.
    if record.declarations.iter().any(|declaration| {
        matches!(
            probe.kind_of(*declaration),
            Some(syntax::FUNCTION_DECLARATION | syntax::CLASS_DECLARATION)
        )
    }) {
        return true;
    }
    // The same, for a name that arrived through an import -- whose
    // declaration is an import specifier rather than the thing itself
    // -- and for a name that is not a value at all.
    //
    // `(callback as Callback<Stats>)` mentions `Callback`, a type
    // alias, inside an arrow. It has a symbol and it is declared
    // outside, so without this it looked like something to capture, and
    // the closure was refused for failing to find a value for a name
    // that never had one. `Buffer`, `Stats` and `uvException` are the
    // same mistake one step further out: imported, so the declaration
    // test above does not see what they are.
    let denoted = probe.denoted_symbol(symbol);
    let record = snapshot.symbols.get(denoted.0 as usize).unwrap_or(record);
    if [
        SymbolFlags::FUNCTION,
        SymbolFlags::CLASS,
        SymbolFlags::INTERFACE,
        SymbolFlags::TYPE_ALIAS,
        SymbolFlags::ENUM,
        SymbolFlags::MODULE,
    ]
    .iter()
    .any(|flag| record.flags.contains(*flag))
    {
        return true;
    }
    // A module-scope name, for the same reason: one of it for the whole
    // program, reached by name. `const BASE64 = "..."` and `const
    // weakSetHas = WeakSet.prototype.has` are not things a closure
    // carries a copy of.
    if record
        .declarations
        .iter()
        .all(|declaration| probe.is_module_scope(*declaration))
    {
        return true;
    }
    // A name something writes to is captured by reference: it moves
    // into a cell, and the cell pointer is what the closure holds.
    //
    // Except when the binding is per-iteration. `for (let i = 0; ...)`
    // gives each turn of the loop its own `i` -- a closure made in the
    // body captures that turn's value, and JavaScript is explicit about
    // it. One cell for the whole loop would hand every closure the
    // value the loop ended on, so it is named and refused rather than
    // answered wrongly.
    false
}

/// The symbols a program captures *by reference*, in a stable order.
///
/// Each one becomes a cell, and its position here is the cell's identity. A
/// sorted list rather than a set because that position is baked into a type id
/// and a struct name, and two runs of one compiler have to agree.
fn guarded_symbols(closures: &[ClosureInfo]) -> Vec<u32> {
    let mut found: Vec<u32> = closures
        .iter()
        .filter(|closure| closure.refusal.is_none())
        .flat_map(|closure| &closure.captures)
        .filter(|capture| capture.forward)
        .map(|capture| capture.symbol)
        .collect();
    found.sort_unstable();
    found.dedup();
    found
}

/// The symbols whose cell has to say whether it has been filled in yet.
///
/// A cell for a name declared *below* the closure that reads it exists before
/// the declaration runs. Reading it then is a `ReferenceError` in JavaScript
/// and would be a zero here, so those cells carry a flag and their reads inside
/// a closure are guarded. Every other cell has no such window and carries
/// nothing.
fn boxed_symbols(closures: &[ClosureInfo]) -> Vec<u32> {
    let mut found: Vec<u32> = closures
        .iter()
        .filter(|closure| closure.refusal.is_none())
        .flat_map(|closure| &closure.captures)
        .filter(|capture| capture.by_reference)
        .map(|capture| capture.symbol)
        .collect();
    found.sort_unstable();
    found.dedup();
    found
}

/// The type id of the `n`th cell, and the name of its struct.
///
/// Synthetic like a closure's, and from the *bottom* of the synthetic band
/// rather than the top: closures count down from `u32::MAX` and the suspension
/// machine takes the half above `FLOOR + 2^19`, so this is the space left.
fn cell_type(index: usize) -> TypeId {
    let id = super::SYNTHETIC_CELLS + u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id < super::SYNTHETIC_FRAMES,
        "more captured-by-reference variables than the synthetic id space holds"
    );
    TypeId(id)
}

fn cell_name(index: usize) -> String {
    format!("Cell{index}")
}

/// The type id of the `n`th closure class.
///
/// Synthetic. The checker's type for an arrow is its signature; the class that
/// carries what it captured is this compiler's own construction and needs an
/// identity to hang a layout on. Numbered down from the top, so it cannot
/// collide with anything the snapshot assigned.
fn closure_type(index: usize) -> TypeId {
    let id = u32::MAX - u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id >= super::SYNTHETIC_CLOSURES,
        "more closures than the synthetic id space holds",
    );
    TypeId(id)
}

/// What a `for...of` head binds. See [`Lowering::for_of_head`].
enum Head {
    /// Names taking the values the walk produces, in order.
    InOrder(Vec<NodeId>),
    /// A pattern applied to the one value the walk produces.
    Pattern(NodeId),
}

/// The name of the `n`th closure's class, and of its one method.
/// The function holding a module's top-level statements.
///
/// `#` cannot appear in a TypeScript identifier, which is why the qualified
/// names use it: no program can declare something that collides with this.
pub const MODULE_INIT: &str = "module#init";

/// Whether a node at module scope is a statement rather than a declaration.
///
/// An allow-list, and deliberately not the complement of one. A kind that is
/// neither is *refused* below rather than skipped, because skipping silently
/// is the defect this exists to fix: a `total = bump(41)` at module scope was
/// dropped, and the program compiled, ran, and answered as though the line
/// were not there.
///
/// `return`, `break` and `continue` are absent because they are illegal at
/// module scope, and `VariableStatement` because a module-scope declaration is
/// a global with a static initializer, which needs no code to run.
fn is_module_statement(kind: u16) -> bool {
    matches!(
        kind,
        syntax::BLOCK
            | syntax::IF_STATEMENT
            | syntax::WHILE_STATEMENT
            | syntax::DO_STATEMENT
            | syntax::SWITCH_STATEMENT
            | syntax::FOR_STATEMENT
            | syntax::FOR_OF_STATEMENT
            | syntax::EMPTY_STATEMENT
            | syntax::THROW_STATEMENT
            | syntax::EXPRESSION_STATEMENT
            // A declaration whose initializer is code runs at evaluation time,
            // and its position among the other statements is observable.
            | syntax::VARIABLE_STATEMENT
    )
}

/// Whether a node is a declaration the rest of the lowering already walks.
///
/// Its body is its own business, which is why [`carries_code`] stops at one: a
/// function inside a namespace is lowered by the loop in [`lower`], and the
/// namespace has nothing to run because of it.
fn is_module_declaration(kind: u16) -> bool {
    matches!(
        kind,
        syntax::FUNCTION_DECLARATION
            | syntax::CLASS_DECLARATION
            | syntax::INTERFACE_DECLARATION
            | syntax::ENUM_DECLARATION
            | syntax::END_OF_FILE_TOKEN
    )
}

/// Whether a module-scope node has anything for module evaluation to run.
///
/// The alternative was a list of kinds to skip -- type alias, import, export
/// clause, ambient namespace -- read off real output and extended whenever a
/// program used something new. This asks the question directly instead, so a
/// construct nobody has seen yet is classified correctly the first time: it
/// carries a statement or it does not.
fn carries_code(probe: &FuncBuilder, id: NodeId) -> bool {
    probe.children(id).iter().any(|child| {
        let Some(kind) = probe.kind_of(*child) else {
            return false;
        };
        if is_module_statement(kind) {
            return true;
        }
        if is_module_declaration(kind) {
            return false;
        }
        carries_code(probe, *child)
    })
}

/// Every descendant of one syntax kind, in source order.
fn collect_kind(snapshot: &SemanticSnapshot, id: NodeId, kind: u16, into: &mut Vec<NodeId>) {
    let Some(node) = snapshot.nodes.get(id.0 as usize) else {
        return;
    };
    if node.kind == NodeKind::Syntax(kind) {
        into.push(id);
    }
    for child in &node.children {
        collect_kind(snapshot, *child, kind, into);
    }
}

fn closure_names(index: usize) -> (String, String) {
    let class = format!("Closure{index}");
    let method = format!("{class}#call");
    (class, method)
}

/// The class name behind a synthetic closure type id.
///
/// The inverse of [`closure_type`], for the passes that meet the id rather than
/// the arrow it came from.
#[must_use]
pub fn closure_class(ty: TypeId) -> String {
    closure_names((u32::MAX - ty.0) as usize).0
}

/// The one method a closure class implements.
#[must_use]
pub fn closure_method(ty: TypeId) -> String {
    closure_names((u32::MAX - ty.0) as usize).1
}

/// Find every arrow function and work out what it captures.
///
/// This runs before any lowering because both sides have to agree: the
/// enclosing function writes the captures into the object in this order, and
/// the closure body reads them back from the same fields.
fn collect_closures(snapshot: &SemanticSnapshot) -> Vec<ClosureInfo> {
    let probe = FuncBuilder::new(snapshot);

    // A variable that is *ever* assigned cannot be captured, because this
    // captures by value and JavaScript captures by reference. For a name
    // nothing writes to the two are the same thing; for one something writes to
    // they are observably different, and quietly picking the wrong one would
    // make a program compute a stale answer rather than fail to compile.
    let mut assigned = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind == NodeKind::Syntax(syntax::SOURCE_FILE) {
            probe.assigned_symbols(
                NodeId(u32::try_from(index).unwrap_or(u32::MAX)),
                &mut assigned,
            );
        }
    }

    let mut closures = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // An arrow, and a `function` expression that does not bind its own
        // `this`.
        //
        // The refusal for the second used to say it out loud -- "it uses no
        // `this`, so an arrow function with the same body lowers today" -- and
        // that is a message telling the author to retype their program. The
        // difference between the two forms is exactly `this`: an arrow inherits
        // the enclosing one, which is why it is captured here like any other
        // free name, and a `function` binds its own. One that never mentions
        // `this` has no such binding to be wrong about, so it is the same
        // closure.
        let is_closure = match node.kind {
            NodeKind::Syntax(syntax::ARROW_FUNCTION) => true,
            NodeKind::Syntax(syntax::FUNCTION_EXPRESSION) => !probe.binds_this(id),
            _ => false,
        };
        if !is_closure {
            continue;
        }
        let mut info = ClosureInfo {
            node: id,
            captures: Vec::new(),
            refusal: None,
            wraps: false,
        };

        let mut subtree = Vec::new();
        probe.subtree(id, &mut subtree);

        // `this` first, so its field index is stable and a layout dump reads
        // the way the program does.
        //
        // An arrow does not bind `this`; it inherits the enclosing one, which
        // makes it a free variable like any other and it was the only one not
        // treated as such. `self.this` inside a closure was the *closure
        // object*, so `this.emit(...)` looked for `emit` on the closure's own
        // layout and did not find it -- 17 sites named `emit`, 8 `#inScope`,
        // and the whole of the "`v`, which `an anonymous type` does not
        // declare" row, which is the same thing said about a field.
        //
        // `mentions_this` already knew how to ask: it stops at anything that
        // rebinds `this` and descends through arrows, which is the rule.
        if let Some(at) = probe
            .node(id)
            .children
            .iter()
            .find_map(|child| probe.first_this(*child))
        {
            info.captures.push(Capture {
                symbol: THIS_CAPTURE,
                name: "this".to_owned(),
                at,
                forward: false,
                by_reference: false,
            });
        }

        for read in &subtree {
            let Some(symbol) = probe.node(*read).symbol else {
                continue;
            };
            if probe.kind_of(*read) != Some(syntax::IDENTIFIER) {
                continue;
            }
            // The name after a dot is a property, not a binding, and so is the
            // key of `{ x: 1 }`. Both have symbols, and both are declared
            // outside the arrow, so without this they would look like captures.
            if probe.names_a_member(*read) {
                continue;
            }
            if info.captures.iter().any(|had| had.symbol == symbol.0) {
                continue;
            }
            let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
                continue;
            };
            // Nothing to capture: a name declared outside the decoded files, or
            // one the arrow declares itself.
            if record.declarations.is_empty()
                || record
                    .declarations
                    .iter()
                    .any(|declaration| subtree.contains(declaration))
            {
                continue;
            }
            if reached_by_name(&probe, snapshot, symbol, record) {
                continue;
            }
            // A name declared *below* the arrow that reads it. The closure
            // captures the binding, and where the closure is built that binding
            // has no value -- so there is nothing to copy and it has to go
            // through a cell, whether or not anything writes to it:
            //
            //     const onListening = () => { ...cleanup...; };
            //     const cleanup = ...;
            //
            // Legal, because the body runs later.
            let arrow = probe.node(id).origin.location;
            let below = record.declarations.iter().all(|declaration| {
                let declared = probe.node(*declaration).origin.location;
                declared.file == arrow.file && declared.span.start > arrow.span.start
            });
            let by_reference = assigned.contains(&symbol.0) || below;
            if by_reference && probe.is_per_iteration(record) {
                info.refusal = Some(
                    "a closure over a `for` loop's own variable, which JavaScript \
                     rebinds on every iteration",
                );
                break;
            }
            info.captures.push(Capture {
                symbol: symbol.0,
                name: record.name.clone(),
                at: *read,
                by_reference,
                forward: below,
            });
        }
        closures.push(info);
    }

    collect_function_values(snapshot, &probe, &mut closures);
    closures
}

/// The named functions a program uses as *values*, as closures that forward.
///
/// Separate from the arrow walk above because it asks a different question of
/// a different node: not "what does this arrow capture" but "is this name being
/// passed rather than called".
///
/// Only for functions something actually uses this way. A wrapper for every
/// declaration would give a closure table to every program that has a function,
/// and a program of ordinary calls should carry no table at all.
fn collect_function_values(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    closures: &mut Vec<ClosureInfo>,
) {
    // One per declaration rather than one per use, which is what makes a single
    // static instance meaningful: two mentions of `finish` are the same object,
    // as they are in JavaScript.
    let mut wrapped: Vec<NodeId> = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::IDENTIFIER) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // Being called is not being used as a value, and neither is being the
        // name after a dot.
        if probe.is_callee(id) || probe.names_a_member(id) {
            continue;
        }
        let Some(symbol) = node.symbol else {
            continue;
        };
        let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
            continue;
        };
        if !record.flags.contains(SymbolFlags::FUNCTION) {
            continue;
        }
        for declaration in &record.declarations {
            if probe.kind_of(*declaration) != Some(syntax::FUNCTION_DECLARATION) {
                continue;
            }
            // The name in `function finish(...)` is an identifier for the same
            // symbol, and declaring a function is not using it as a value.
            if node.parent == Some(*declaration) {
                continue;
            }
            if !wrapped.contains(declaration) {
                wrapped.push(*declaration);
            }
        }
    }
    for declaration in wrapped {
        closures.push(ClosureInfo {
            node: declaration,
            captures: Vec::new(),
            refusal: None,
            wraps: true,
        });
    }
}

/// Collect what a module declares outside any function.
///
/// Scalars only. A managed global is a *root* -- reachable without being on any
/// stack -- so a collector has to be told about it, and RFC §10.2 puts root
/// registration in the memory provider rather than in a backend. Until that
/// exists, refusing is better than a global nothing traces.
///
/// An initializer that is not a constant is refused for a different reason:
/// running it needs a module initializer, which is a real thing to design (what
/// order, and what happens when one throws) rather than something to improvise
/// here.
impl FuncBuilder<'_> {
    /// The first method an object literal declares, if it declares one.
    ///
    /// Both spellings: `{ f() {} }` is a method declaration, and
    /// `{ f: () => {} }` is a property whose value is a function. Neither is
    /// lowered, and the point of finding one is to say so.
    fn method_of_an_object_literal(&self, initializer: NodeId) -> Option<NodeId> {
        if self.kind_of(initializer) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            return None;
        }
        self.children(initializer)
            .into_iter()
            .find(|member| match self.kind_of(*member) {
                Some(syntax::METHOD_DECLARATION) => true,
                Some(syntax::PROPERTY_ASSIGNMENT) => self
                    .children(*member)
                    .into_iter()
                    .any(|part| self.kind_of(part) == Some(syntax::ARROW_FUNCTION)),
                _ => false,
            })
    }
}

/// What each function declaration is emitted as, and which cannot be.
#[derive(Default)]
struct Naming {
    /// The emitted name, for a declaration whose plain name is taken.
    qualified: rustc_hash::FxHashMap<NodeId, String>,
    /// Declarations that cannot be told apart by anything this compiler has.
    ambiguous: rustc_hash::FxHashSet<NodeId>,
    /// Which generator each `function*` is, in source order.
    ///
    /// Here rather than counted as the lowering goes, because a builder is made
    /// fresh per function and a counter on one cannot be seen by the next. It
    /// decides an *identity* that has to be the same in two places -- the frame
    /// the generator fills and the frame the `for...of` walks -- which is what
    /// the rest of this struct is for.
    generators: rustc_hash::FxHashMap<NodeId, usize>,
}

/// Decide what every function declaration is called in the emitted program.
///
/// Two C functions may not share a name, and two TypeScript functions may.
/// There are two ways it happens and they want opposite answers:
///
/// - **Different modules.** `path/posix.ts` and `path/win32.ts` both declare
///   `basename`, because `path` genuinely has two implementations of one
///   interface and Node ships both. These are ordinary module-private helpers
///   and refusing them refuses the module. They are *qualified* by the file
///   they come from: `basename@posix`. `@` cannot appear in a TypeScript
///   identifier, so the qualified name cannot collide with a plain one.
/// - **The same module.** Two namespaces in one file each exporting `area`.
///   Nothing here distinguishes them — a namespace's members are lowered under
///   their unqualified names — so both are refused. Both, rather than the
///   second: emitting the first and dropping the second is a program that
///   compiles and calls the wrong one.
///
/// Overload signatures share a name legitimately and only the implementation
/// has a body, so a declaration without one does not count. Methods are spelled
/// `Class#method` and cannot collide with a plain function.
/// The shortest tail of a file's path that tells it from the others in a group.
///
/// One component if that is enough -- `posix` against `win32` -- and more where
/// it is not: `dgram/src/main.ts` and `net/src/main.ts` share every component
/// but the third from the end.
fn distinguishing_tail(snapshot: &SemanticSnapshot, group: &[NodeId], id: NodeId) -> String {
    let components = |at: NodeId| -> Vec<String> {
        let file = snapshot
            .nodes
            .get(at.0 as usize)
            .map_or(nts_diagnostics::SourceId(0), |node| {
                node.origin.location.file
            });
        snapshot
            .sources
            .get(file.0 as usize)
            .map_or_else(Vec::new, |source| {
                source
                    .display_path
                    .as_str()
                    .trim_end_matches(".ts")
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .map(|part| part.replace(['.', '-'], "_"))
                    .collect()
            })
    };
    let mine = components(id);
    let others: Vec<Vec<String>> = group
        .iter()
        .filter(|other| **other != id)
        .map(|other| components(*other))
        .collect();
    let tail = |parts: &[String], take: usize| -> String {
        parts[parts.len().saturating_sub(take)..].join("_")
    };
    for take in 1..=mine.len().max(1) {
        let candidate = tail(&mine, take);
        if others.iter().all(|other| tail(other, take) != candidate) {
            return candidate;
        }
    }
    tail(&mine, mine.len())
}

fn naming(snapshot: &SemanticSnapshot) -> Naming {
    let probe = FuncBuilder::new(snapshot);
    let mut declarations: rustc_hash::FxHashMap<String, Vec<NodeId>> =
        rustc_hash::FxHashMap::default();
    let mut generators: rustc_hash::FxHashMap<NodeId, usize> = rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
        {
            let next = generators.len();
            generators.insert(NodeId(u32::try_from(index).unwrap_or(u32::MAX)), next);
        }
    }
    for (index, node) in snapshot.nodes.iter().enumerate() {
        // Classes as well as functions. A method is spelled `Class#method`, so
        // it cannot collide with a plain function -- but it collides happily
        // with a method of *another class of the same name*, and `dgram` and
        // `net` both export a `Socket`. That emitted two `Socket#ref`, which
        // is one C function defined twice and whichever the linker picked.
        let is_named_declaration = matches!(
            node.kind,
            NodeKind::Syntax(syntax::FUNCTION_DECLARATION | syntax::CLASS_DECLARATION)
        );
        if !is_named_declaration {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // A body is what separates an implementation from an overload
        // signature. A class always has one.
        if node.kind == NodeKind::Syntax(syntax::FUNCTION_DECLARATION) && !probe.has_a_body(id) {
            continue;
        }
        if let Some(name) = probe.declared_name(id) {
            declarations.entry(name).or_default().push(id);
        }
    }

    let mut naming = Naming::default();
    for (name, ids) in declarations {
        if ids.len() < 2 {
            continue;
        }
        for id in &ids {
            let file = probe.node(*id).origin.location.file;
            // Another declaration of this name in the same file: nothing here
            // tells them apart.
            if ids
                .iter()
                .any(|other| other != id && probe.node(*other).origin.location.file == file)
            {
                naming.ambiguous.insert(*id);
                continue;
            }
            // The shortest tail of the path that tells this declaration from
            // the others of its name. The stem alone is not enough:
            // `path/posix.ts` and `path/win32.ts` differ by it, and
            // `dgram/src/main.ts` and `net/src/main.ts` do not -- both are
            // `main`, so qualifying by the stem produced the same name twice
            // and fixed nothing. The whole path always works and reads like a
            // machine wrote it, so this takes components from the end until
            // they are distinct: `dgram_src_main`, not `_home_akisarou_...`.
            let module = distinguishing_tail(snapshot, &ids, *id);
            naming.qualified.insert(*id, format!("{name}@{module}"));
        }
    }
    naming.generators = generators;
    naming
}

/// Whether a module-scope variable can be a global, and why not.
///
/// One decision in three questions, together because the walk that asks them is
/// long enough without them and because each is a way the same thing goes
/// wrong: a global whose type the backend cannot emit.
fn storable(probe: &mut FuncBuilder<'_>, name: NodeId, ty: &HirType) -> Result<(), String> {
    if !ty.can_be_global() {
        return Err("a module-scope variable holding a reference".to_owned());
    }
    // A function type is `Managed(Object(..))` like any other object, and a
    // global of one holds a *closure* -- a different object, with its own
    // layout. Both are references, so nothing between here and the backend
    // objected: `coerce_to_slot` converts representations and the verifier asks
    // the same question. It surfaced as clang refusing to assign an
    // `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.
    //
    // Module state holding a closure is a feature rather than an oversight, so
    // it is refused in those words until it is one.
    if probe.is_function_typed(name) {
        // A `const` arrow no longer reaches here: it is typed by the closure it
        // becomes, which is the one object that can ever be in the slot. What
        // is left is a *mutable* one, where two arrows are two layouts and the
        // slot cannot be both.
        return Err("a module-scope `let` holding a function, which may be reassigned with a closure of another layout".to_owned());
    }
    // The layout, here, because nothing else will build it: every other one is
    // built by a function that uses the type, and a global whose initializer
    // was refused is used by no function at all. That left the backend with
    // `an object type with no layout` on a program the lowering called clean.
    probe
        .materialize(name, ty)
        .map_err(|diagnostic| diagnostic.message)
}

/// A name for a module global that no other module global has.
///
/// Two module-scope bindings can share a spelling and be different variables:
/// `for (let x of ...)` twice over declares two `x`, each scoped to its own
/// loop. They are separate symbols and need separate storage, and taking the
/// source text for both emitted a translation unit with `x` defined twice.
///
/// Latent until the declarations reached here at all -- a loop variable has no
/// initializer, and that was refused before it could collide.
fn unshared_name(existing: &[super::Global], spelling: Option<String>, at: u32) -> String {
    let Some(spelling) = spelling else {
        return format!("global{at}");
    };
    if existing.iter().any(|global| global.name == spelling) {
        return format!("{spelling}{at}");
    }
    spelling
}

/// The type a module-scope binding takes when it holds an arrow.
///
/// A `const f = (x) => x * 2` holds the *closure* the arrow becomes, not a
/// value of its function type. Those are two different objects with two
/// different layouts, and typing the global by the declaration produced a slot
/// the initializer could not fill: clang refused to assign an
/// `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.
///
/// Both are references, so nothing between the lowering and the backend
/// objected -- the same coarse rule that let an array of `i32` into a slot of
/// `f64`, and the third time this week that "two pointers" answered a question
/// only the layout could.
///
/// `const` only, and that is the whole soundness argument: a slot typed by a
/// closure holds exactly the closure it was typed by. A `let` can be reassigned
/// with a *different* arrow, which is a different layout -- clang says so
/// directly, `assigning to 'NtsObj_Closure2 *' from 'NtsObj_Closure3 *'` -- so a
/// mutable one keeps the refusal in `storable`.
fn closure_typed_global(
    probe: &mut FuncBuilder,
    closures: &[ClosureInfo],
    kind: nts_semantic_schema::VariableKind,
    initializer: Option<NodeId>,
) -> Option<HirType> {
    let node = initializer
        .filter(|_| kind == nts_semantic_schema::VariableKind::Const)
        .filter(|node| probe.kind_of(*node) == Some(syntax::ARROW_FUNCTION))?;
    // A refused closure has no layout to name, so the binding falls through to
    // the ordinary path and is refused there with its own reason.
    let index = closures
        .iter()
        .position(|closure| closure.node == node && closure.refusal.is_none())?;
    Some(HirType::Managed(ManagedType::Object(closure_type(index))))
}

/// Declare a global holding a closure, with the initializer deferred to
/// `module#init` -- an arrow is code, never a constant to fold.
fn declare_a_closure_global(
    scope: &mut ModuleScope,
    probe: &mut FuncBuilder,
    name_node: NodeId,
    symbol: SymbolId,
    ty: HirType,
    initializer: Option<NodeId>,
) {
    let global = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
    let spelling = probe.node(name_node).text.clone();
    scope.globals.push(super::Global {
        name: unshared_name(&scope.globals, spelling, global),
        ty: ty.clone(),
        initial: 0.0,
        exported: false,
        origin: probe.origin(name_node),
    });
    scope.variables.insert(symbol.0, global);
    scope.types.push(ty);
    if let Some(initializer) = initializer {
        scope.deferred.insert(symbol.0, initializer);
    }
}

fn collect_module_scope(snapshot: &SemanticSnapshot, closures: &[ClosureInfo]) -> ModuleScope {
    let mut scope = ModuleScope::default();
    let mut probe = FuncBuilder::new(snapshot);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::VARIABLE_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // Inside a function, and therefore an ordinary local.
        if probe.is_within_a_function(id) {
            continue;
        }

        let children = probe.children(id);
        // The *first* child, and only when it is a name. A declaration's name
        // comes before everything else in it, so searching for "the first
        // identifier" instead found the initializer whenever the name was a
        // pattern: `export const [a, b] = arr` declared a global called `arr`,
        // beside the real one, and the emitted C said `redefinition of 'arr'`.
        //
        // A destructuring declaration is left alone rather than half-handled.
        // Its names are the pattern's, and binding them is `bind_pattern`'s job
        // inside a function -- at module scope there is nothing here that does
        // it, and inventing one name for several is worse than declaring none.
        let Some(name_node) = children
            .first()
            .filter(|child| probe.kind_of(**child) == Some(syntax::IDENTIFIER))
        else {
            continue;
        };
        let Some(symbol) = probe.node(*name_node).symbol else {
            continue;
        };
        // The last child that is neither the name nor the type annotation.
        //
        // By what it *is*, not by what it is not: skipping identifiers took
        // `let held: Box | undefined = undefined` to mean the type annotation,
        // which `module#init` then tried to lower as an expression -- and it
        // made `let x = y` a declaration with no initializer at all, because
        // `y` is an identifier too.
        let initializer = children
            .iter()
            .rev()
            .find(|child| {
                **child != *name_node
                    && !syntax::is_type_node(probe.kind_of(**child).unwrap_or_default())
            })
            .copied();

        // An erased global's initial value needs a *tag*, and `Global.initial`
        // is one `f64` with no room for one. So a constant initializer is not
        // taken as one here: the declaration is deferred to `module#init`,
        // where lowering erases it and the tag comes from the value's own
        // type. Folding it instead put `0` in the payload with the tag left at
        // `undefined`, and `typeof` then answered "undefined" for a global the
        // source initialised to a number -- which the differential caught
        // against node.
        let erased = probe.type_of(*name_node) == Some(HirType::Erased);

        // `let x: number;` -- declared here, written later. There is nothing to
        // fold and nothing to defer, and the storage starts at the type's zero,
        // which is what `hir::fields` already does for a class field written in
        // its constructor: "zero, because that is what the allocator leaves".
        //
        // An *erased* one is refused, and now says which of the two it is. Its
        // initial value would have to be `undefined`, which is a tag, and there
        // is nowhere to put one -- so this is the representation talking rather
        // than a lowering nobody wrote yet.
        if initializer.is_none() && erased {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope variable with no initializer, whose type has no \
                 representation for the `undefined` it starts as"
                    .to_owned(),
            );
            continue;
        }

        let constant = match initializer {
            Some(initializer) if !erased => probe.constant_value(initializer, &scope.constants),
            _ => None,
        };
        if let (None, Some(initializer)) = (constant, initializer) {
            // Code, rather than data this file happens not to use. Reported
            // here because nothing downstream will: the methods of an object
            // literal are not walked, so they are not lowered and not refused.
            if let Some(member) = probe.method_of_an_object_literal(initializer) {
                scope
                    .refusals
                    .push(probe.unsupported(member, "a method on an object literal"));
                scope.unsupported.insert(
                    symbol.0,
                    "a module-scope variable whose initializer is not constant".to_owned(),
                );
                continue;
            }
        }
        let value = constant.unwrap_or(0.0);
        let Some(ty) = probe.type_of(*name_node) else {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope variable of unrepresentable type".to_owned(),
            );
            continue;
        };
        // `const` is a value, not storage. The kind lives on the enclosing
        // `VariableDeclarationList`, which is the declaration's parent -- except
        // when the encoder wraps the list in a `VariableStatement`, so the flags
        // are taken from whichever ancestor is the list.
        let kind = probe
            .ancestor(id, syntax::VARIABLE_DECLARATION_LIST)
            .map_or(nts_semantic_schema::VariableKind::Var, |list| {
                nts_semantic_schema::VariableKind::from_flags(probe.node(list).flags)
            });
        // A `const` whose initializer folds is a value rather than storage: the
        // reader gets the number and nothing is allocated. One whose
        // initializer is code is storage like any other, written once by
        // `module#init`.
        if kind == nts_semantic_schema::VariableKind::Const && constant.is_some() {
            scope.constants.insert(symbol.0, value);
            continue;
        }

        if let Some(ty) = closure_typed_global(&mut probe, closures, kind, initializer) {
            declare_a_closure_global(&mut scope, &mut probe, *name_node, symbol, ty, initializer);
            continue;
        }

        if let Err(reason) = storable(&mut probe, *name_node, &ty) {
            scope.unsupported.insert(symbol.0, reason);
            continue;
        }
        let global = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
        let spelling = probe.node(*name_node).text.clone();
        scope.globals.push(super::Global {
            name: unshared_name(&scope.globals, spelling, global),
            ty: ty.clone(),
            initial: value,
            exported: false,
            origin: probe.origin(*name_node),
        });
        scope.variables.insert(symbol.0, global);
        scope.types.push(ty);
        // Only where there is one to lower. A declaration with no initializer
        // has nothing deferred; its storage is already the zero above.
        if let (None, Some(initializer)) = (constant, initializer) {
            scope.deferred.insert(symbol.0, initializer);
        }
    }
    // What materializing the globals' types produced. Nothing else collects
    // from this walk, which is why they were missing.
    scope.layouts = probe.layouts;
    scope
}

/// Lower every function declaration in a snapshot.
#[must_use]
/// The copies of a function to lower.
///
/// A generic function is lowered once per instantiation and not at all as
/// itself: a parameter of type `T` has no width. The instantiations come from
/// the *calls*, because that is where the checker puts them — see
/// [`super::generics::function_instantiations`]. One that nothing calls is
/// dead, and lowering it would report a refusal for a program nobody wrote.
fn function_copies(
    snapshot: &SemanticSnapshot,
    generic: &super::generics::GenericFunctions,
    id: NodeId,
) -> Vec<(Substitution, String)> {
    match generic.copies.get(&id) {
        Some(instances) => instances
            .iter()
            .map(|instance| (instance.substitution.clone(), instance.suffix.clone()))
            .collect(),
        None if is_generic_function(snapshot, id) => Vec::new(),
        None => vec![(Substitution::default(), String::new())],
    }
}

/// Whether a function declaration has type parameters of its own.
fn is_generic_function(snapshot: &SemanticSnapshot, id: NodeId) -> bool {
    super::generics::declared_type_parameters(snapshot, id) > 0
}

/// The methods and constructors a class declares.
fn members_of(snapshot: &SemanticSnapshot, id: NodeId) -> Vec<NodeId> {
    let probe = FuncBuilder::new(snapshot);
    probe
        .children(id)
        .into_iter()
        .filter(|child| {
            matches!(
                probe.kind_of(*child),
                Some(
                    syntax::METHOD_DECLARATION
                        | syntax::CONSTRUCTOR
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                )
            )
        })
        .collect()
}

/// The copies of a class to lower.
///
/// A generic class is lowered once per instantiation and not at all as itself:
/// a field of type `T` has no width, and `Vector<Body>` and `Vector<double>` are
/// two classes that happen to share a source. A class with type parameters that
/// nothing instantiates is dead, and lowering it would report a refusal for a
/// program nobody wrote.
fn copies_of(
    generic: &rustc_hash::FxHashMap<NodeId, Vec<super::generics::Instantiation>>,
    id: NodeId,
) -> Vec<(Option<TypeId>, Substitution)> {
    generic.get(&id).map_or_else(
        || vec![(None, Substitution::default())],
        |instances| {
            instances
                .iter()
                .map(|instance| (Some(instance.ty), instance.substitution.clone()))
                .collect()
        },
    )
}

/// What every function's lowering needs from the program around it.
///
/// Bundled because each of these is decided once for the whole program and read
/// by every copy: the module scope, the hierarchy, the closures, what each
/// function is *called*, and which copies of a generic to make.
struct Shared {
    module: ModuleScope,
    hierarchy: Hierarchy,
    closures: Vec<ClosureInfo>,
    naming: Naming,
    generics: super::generics::GenericFunctions,
}

impl Shared {
    /// What every function's lowering needs and none of them computes: the
    /// module scope, the class hierarchy, the closures, the qualified names,
    /// and which generic functions were instantiated at what.
    fn whole_program(
        snapshot: &SemanticSnapshot,
        module: &ModuleScope,
        hierarchy: &Hierarchy,
        closures: &[ClosureInfo],
    ) -> Self {
        Self {
            module: module.clone(),
            hierarchy: hierarchy.clone(),
            closures: closures.to_vec(),
            naming: naming(snapshot),
            generics: super::generics::function_instantiations(snapshot),
        }
    }

    /// A builder for one copy, wired to the program-wide naming.
    fn builder<'a>(
        &self,
        snapshot: &'a SemanticSnapshot,
        substitution: Substitution,
        suffix: String,
    ) -> FuncBuilder<'a> {
        let mut builder = FuncBuilder::instantiating(
            snapshot,
            self.module.clone(),
            self.hierarchy.clone(),
            self.closures.clone(),
            substitution,
            suffix,
        );
        builder.generic_calls.clone_from(&self.generics.at_call);
        builder.qualified.clone_from(&self.naming.qualified);
        builder.generators.clone_from(&self.naming.generators);
        builder
    }
}

/// Reads that happen before the module declaring them has evaluated.
///
/// This is the compile-time half of what node reports at runtime as
/// `ReferenceError: Cannot access 'x' before initialization`, and it is the one
/// thing a compiler can do here that a runtime cannot: node finds out when the
/// read executes, and only for the path it took.
///
/// The shape needs a cycle to exist at all. `b` importing `a` puts `a` first,
/// so a read in `b`'s module body is always safe -- unless `a` also imports
/// `b`, which is what lets the walk reach `b` first and leaves `a`'s bindings
/// in their dead zone while `b`'s body runs. That is why this arrived with
/// cycles rather than before them.
///
/// Without this the program compiles and is *wrong quietly*: a module-scope
/// binding is a global with a static initializer, so the read finds the
/// initializer rather than nothing, and the compiled program answers 7 where
/// node refuses to answer at all.
///
/// # What is and is not looked at
///
/// Only module-scope variable bindings, and only reads that module evaluation
/// actually performs. A read inside a function body is not one: by the time
/// anything calls it every module has evaluated, which is exactly how the
/// legal half of a cycle is written and why `examples/module-cycle-late`
/// compiles.
///
/// A class is a dead-zone binding too, and is not checked here. Its heritage
/// clause is walked -- `class X extends Imported` does read at evaluation --
/// but the map is built from variable declarations, so nothing matches yet.
/// Instance property initializers are skipped for the opposite reason: they
/// run at construction, and treating them as evaluation would refuse programs
/// that are fine.
fn dead_zone_reads(snapshot: &SemanticSnapshot, order: &[usize]) -> Vec<Diagnostic> {
    let probe = FuncBuilder::new(snapshot);

    let mut position = vec![usize::MAX; snapshot.modules.len()];
    for (rank, at) in order.iter().enumerate() {
        if let Some(slot) = position.get_mut(*at) {
            *slot = rank;
        }
    }

    // Which module declares each module-scope binding. Keyed by the
    // declaration's own symbol, which is what an import alias resolves to.
    let mut declared_in: rustc_hash::FxHashMap<u32, usize> = rustc_hash::FxHashMap::default();
    for (at, module) in snapshot.modules.iter().enumerate() {
        for child in probe.children(module.root) {
            if probe.kind_of(child) != Some(syntax::VARIABLE_STATEMENT) {
                continue;
            }
            let mut names = Vec::new();
            probe.declared_symbols(child, &mut names);
            for symbol in names {
                declared_in.insert(symbol, at);
            }
        }
    }

    let mut found = Vec::new();
    for (at, module) in snapshot.modules.iter().enumerate() {
        let mine = position[at];
        for child in probe.children(module.root) {
            evaluated_reads(&probe, child, &mut |id| {
                let Some(symbol) = probe.node(id).symbol else {
                    return;
                };
                let target = probe.denoted_symbol(symbol);
                let Some(&declaring) = declared_in.get(&target.0) else {
                    return;
                };
                if declaring == at || position[declaring] <= mine {
                    return;
                }
                let name = &snapshot.symbols[target.0 as usize].name;
                let file = snapshot
                    .sources
                    .get(snapshot.modules[declaring].file.0 as usize)
                    .map_or_else(|| "another module".to_owned(), |source| source.uri.clone());
                found.push(Diagnostic::error(
                    "NTS1004",
                    format!(
                        "`{name}` is read here while evaluating this module, and `{file}` -- \
                         which declares it -- has not been evaluated yet; the two modules \
                         import each other, so one of them runs first and this is the one. \
                         Node reports the same program as `ReferenceError: Cannot access \
                         '{name}' before initialization`, at the moment the read runs"
                    ),
                    probe.location(id),
                ));
            });
        }
    }
    found
}

/// Identifiers a module's evaluation actually reads.
///
/// The walk stops at anything deferred. A function body runs when it is
/// called, not when the module is evaluated, and descending into one would
/// refuse the legal way to cross a cycle. An import clause names a binding
/// rather than reading it, and would otherwise report every import in a cycle
/// as a dead-zone read of itself.
fn evaluated_reads(probe: &FuncBuilder, id: NodeId, visit: &mut impl FnMut(NodeId)) {
    let Some(kind) = probe.kind_of(id) else {
        // A `NodeList` -- an argument list, a declaration list -- which has no
        // syntax kind. Stopping here truncated the walk at the first one, and
        // a variable declaration is reached through exactly one: the
        // initializer of `export const derived = imported + 1` was never
        // looked at, which is the shape the check exists for.
        for child in &probe.node(id).children {
            evaluated_reads(probe, *child, visit);
        }
        return;
    };
    match kind {
        syntax::FUNCTION_DECLARATION
        | syntax::ARROW_FUNCTION
        | syntax::METHOD_DECLARATION
        | syntax::CONSTRUCTOR
        | syntax::GET_ACCESSOR
        | syntax::SET_ACCESSOR
        | syntax::PROPERTY_DECLARATION
        | syntax::IMPORT_DECLARATION
        | syntax::EXPORT_DECLARATION
        | syntax::INTERFACE_DECLARATION => return,
        syntax::IDENTIFIER => visit(id),
        _ => {}
    }
    for child in &probe.node(id).children {
        evaluated_reads(probe, *child, visit);
    }
}

#[must_use]
/// Every top-level statement in the program, in the order they must run.
///
/// Within a file that is source order. *Across* files it is the module graph,
/// which the snapshot does not carry -- so a program with top-level statements
/// in more than one file is refused rather than run in an order this guessed
/// at. One file's statements are the common case and the whole of what can be
/// ordered honestly today.
fn module_statements(
    snapshot: &SemanticSnapshot,
) -> (Option<(NodeId, Vec<NodeId>)>, Vec<Diagnostic>) {
    let probe = FuncBuilder::new(snapshot);
    let mut refusals = Vec::new();

    let mut per_module: Vec<Vec<NodeId>> = vec![Vec::new(); snapshot.modules.len()];
    for (at, module) in snapshot.modules.iter().enumerate() {
        for child in probe.children(module.root) {
            let Some(kind) = probe.kind_of(child) else {
                continue;
            };
            if is_module_statement(kind) {
                per_module[at].push(child);
            } else if !is_module_declaration(kind) && carries_code(&probe, child) {
                // Something with code in it that module evaluation does not
                // run -- a `namespace` with a statement in its body is the
                // shape. Refused rather than dropped, which is the whole point
                // of this pass.
                refusals.push(probe.unsupported(
                    child,
                    &format!(
                        "{}, which has code in it",
                        spell(kind, "a module-scope construct")
                    ),
                ));
            }
        }
    }

    let (order, cycles) = evaluation_order(snapshot);

    // Cycles are *evaluated*, not refused. ES modules specify them, node runs
    // them, and the post-order walk above already handles one the way
    // `InnerModuleEvaluation` does: a module still being visited is not
    // re-entered, so it keeps the position it already has.
    //
    // Nothing to collect from `cycles` itself: a cycle is evaluated rather than
    // refused, and the walk above already orders one the way
    // `InnerModuleEvaluation` does. What a cycle *does* enable is a read of a
    // binding whose module has not run, which is checked here rather than
    // there because the check needs the order and the cycle set does not.
    let _ = cycles;
    refusals.extend(dead_zone_reads(snapshot, &order));

    // Concatenated in evaluation order rather than emitted per module: with
    // top-level `await` refused, and a read across a cycle refused above, what
    // a program can observe of module evaluation is the order of its
    // statements -- and one function in that order says exactly that.
    let mut statements = Vec::new();
    let mut anchor = None;
    for at in order {
        if per_module[at].is_empty() {
            continue;
        }
        if anchor.is_none() {
            anchor = Some(snapshot.modules[at].root);
        }
        statements.extend(per_module[at].iter().copied());
    }
    (anchor.map(|file| (file, statements)), refusals)
}

/// Evaluation order, and any cycles found on the way.
///
/// # Cycles are evaluated, not refused
///
/// ES modules specify them and node runs them, so refusing them was wrong --
/// and far too coarse. `node:fs` had four and every one was harmless: the only
/// thing crossing them was a *function*, which is hoisted and callable before
/// its module has evaluated. Refusing cost that module its whole
/// initialization to guard against something it was not doing.
///
/// The one thing a cycle can do that this compiler must not accept is a read of
/// a module-scope binding whose module has not evaluated -- a temporal dead
/// zone, where node throws a `ReferenceError` and this would quietly answer the
/// binding's static initializer. [`dead_zone_reads`] is that check, and the
/// order computed here is what makes it decidable: the violation is a read
/// whose declaring module sits *later* in this list than the module doing the
/// reading.
///
/// Post-order over each module's imports in source order, which is what
/// `InnerModuleEvaluation` specifies: a module's dependencies evaluate before
/// it, each exactly once. Verified against node with a diamond -- `d, a, b,
/// main`, and `d, b, a, main` when the entry's two import lines are swapped, so
/// the *order* of a module's imports is observable and the graph stores them
/// ordered.
///
/// Rooted at the modules nothing imports, then at every other module in index
/// order. The two-stage roll call matters: rooting at every module in index
/// order put `ex-cycle`'s `a` before `b` where node runs `b` first, because the
/// walk entered the cycle at whichever member the file order happened to reach
/// first rather than at the entry. Modules with no incoming edge are the
/// entries, and starting there is what makes the walk agree.
///
/// Every other module is still a root afterwards, because the frontend does not
/// know the product: a library's surface is its exports and an executable's is
/// its entry, and that choice is made after lowering. The cost is that an
/// executable may evaluate a module nothing imports, which node would not; the
/// alternative is not evaluating a library's modules at all.
#[must_use]
fn evaluation_order(snapshot: &SemanticSnapshot) -> (Vec<usize>, Vec<Vec<usize>>) {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Unseen,
        OnStack,
        Done,
    }
    let mut marks = vec![Mark::Unseen; snapshot.modules.len()];
    let mut order = Vec::new();
    let mut cycles = Vec::new();
    let mut path: Vec<usize> = Vec::new();

    // Entries first: a module nothing imports. That is what node starts from,
    // and inside a cycle it decides the answer -- for `b <-> a` reached from
    // `main`, node evaluates `b, a, main`, and starting the walk at `b` instead
    // gives `a, b, main`. Both are valid dependency orders and only one is
    // node's.
    //
    // The remaining modules are roots too, in index order, so a component
    // every member of which is imported -- a cycle with nothing outside it --
    // is still evaluated rather than skipped.
    let mut imported = vec![false; snapshot.modules.len()];
    for module in &snapshot.modules {
        for target in &module.imports {
            if let Some(flag) = imported.get_mut(target.0 as usize) {
                *flag = true;
            }
        }
    }
    let roots = (0..snapshot.modules.len())
        .filter(|at| !imported[*at])
        .chain(0..snapshot.modules.len());

    // An explicit stack rather than recursion: a module graph is program input,
    // and a deep one must not decide how much C stack this compiler has.
    let mut work: Vec<(usize, usize)> = Vec::new();
    for root in roots {
        if marks[root] != Mark::Unseen {
            continue;
        }
        work.push((root, 0));
        marks[root] = Mark::OnStack;
        path.push(root);
        while let Some((at, next)) = work.pop() {
            let imports = &snapshot.modules[at].imports;
            if next < imports.len() {
                work.push((at, next + 1));
                let target = imports[next].0 as usize;
                match marks.get(target) {
                    Some(Mark::Unseen) => {
                        marks[target] = Mark::OnStack;
                        path.push(target);
                        work.push((target, 0));
                    }
                    // A back edge: the target is still being visited, so the
                    // path from it to here closes a loop.
                    Some(Mark::OnStack) => {
                        if let Some(from) = path.iter().position(|on| *on == target) {
                            cycles.push(path[from..].to_vec());
                        }
                    }
                    _ => {}
                }
                continue;
            }
            marks[at] = Mark::Done;
            path.pop();
            order.push(at);
        }
    }
    (order, cycles)
}

/// The module initializer: every module-scope statement, in evaluation order,
/// as one function. Separate from `lower` because losing it has a consequence
/// worth stating at length, and because it is the one lowering that is about
/// the program rather than about a declaration in it.
/// Find the declarations whose initializer cannot lower, and record them on the
/// module so that reading one refuses.
///
/// Probed against a `Shared` built from the module as it stands and then folded
/// back into it. Two of them and not one, because the second has to carry the
/// answer the first was built to find, and this runs before any function is
/// lowered so that the answer reaches them.
fn mark_refused_initializers(
    snapshot: &SemanticSnapshot,
    module: &mut ModuleScope,
    hierarchy: &Hierarchy,
    closures: &[ClosureInfo],
    lowered: &mut Lowered,
) -> rustc_hash::FxHashSet<u32> {
    let probing = Shared::whole_program(snapshot, module, hierarchy, closures);
    let refused = refused_initializers(snapshot, &probing, lowered);
    drop(probing);
    for symbol in &refused {
        module.unsupported.entry(*symbol).or_insert_with(|| {
            "a module-scope variable whose initializer was refused above".to_owned()
        });
    }
    refused
}

/// Which module-scope declarations have an initializer that cannot lower.
///
/// A module-scope declaration whose initializer cannot lower has to be refused
/// *by itself*. It used to be, because it was never part of module evaluation;
/// now that it is, one unrepresentable declaration would take the whole
/// initializer with it -- every other module's evaluation included -- and `url`
/// has one, so this is not hypothetical. Trying it apart costs lowering these
/// expressions twice and buys a refusal that names the declaration rather than
/// the program.
///
/// Apart is also *equivalent*: a module-scope initializer reads globals and
/// constants, never a local, so it lowers the same alone as in sequence.
///
/// Asked *before* any function is lowered, which is the half that was missing.
/// The initializer was dropped and the variable kept, so every function that
/// read it was emitted against a global nothing had written -- a `let rendered:
/// string = String(source)` whose conversion is refused left `rendered` a null
/// pointer, and `rendered.length` was compiled and run. The refusal was
/// printed, the program was produced, and the harness called it agreed on
/// every case because every case had stopped.
fn refused_initializers(
    snapshot: &SemanticSnapshot,
    shared: &Shared,
    lowered: &mut Lowered,
) -> rustc_hash::FxHashSet<u32> {
    let mut refused = rustc_hash::FxHashSet::default();
    for (symbol, initializer) in &shared.module.deferred {
        let mut probe = shared.builder(snapshot, Substitution::default(), String::new());
        if let Err(diagnostic) = probe.lower_expression(*initializer) {
            lowered.diagnostics.push(diagnostic);
            refused.insert(*symbol);
        }
    }
    refused
}

fn lower_module_initializer(
    snapshot: &SemanticSnapshot,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
    refused: &rustc_hash::FxHashSet<u32>,
) {
    // Module-level statements. Nothing above walks them: the loop finds
    // declarations, and `total = bump(41)` is not one -- so it was dropped, and
    // the program compiled, ran, and answered as though the line were not
    // there. Lowered *after* the declarations so that a closure it allocates
    // joins the worklist below rather than missing it.
    let (initializer, refusals) = module_statements(snapshot);
    lowered.diagnostics.extend(refusals);

    if let Some((file, mut statements)) = initializer {
        // And the same for whole statements, for the same reason at a larger
        // scale. One unsupported top-level statement used to cost the program
        // *every* top-level statement -- and it was not hypothetical either:
        // eighteen of the nineteen node profile modules lost all module
        // evaluation to a single `for...of` in `util/inspect`. When that one
        // was fixed the number stayed at eighteen, because the next
        // unsupported statement in the same file took over. It is a queue, and
        // one line of it darkens eighteen modules at a time.
        //
        // Statement-level granularity turns "this module is dark" into "this
        // line is dark", which is worth more than any individual lowering: it
        // is the difference between a diagnostic that names a construct and
        // one that names a program.
        //
        // Sound apart for the reason a declaration is: a module-scope
        // statement reads and writes *globals*, never a local of the
        // initializer, because a module-scope binding is a global. A block
        // that declares its own local also consumes it.
        let mut lost = Vec::new();
        statements.retain(|statement| {
            let mut probe = shared.builder(snapshot, Substitution::default(), String::new());
            let attempt = if probe.kind_of(*statement) == Some(syntax::VARIABLE_STATEMENT) {
                probe.lower_module_binding(*statement, refused)
            } else {
                probe.lower_statement(*statement)
            };
            match attempt {
                Ok(()) => true,
                Err(diagnostic) => {
                    // The *statement's* span, not the cause's. The message
                    // below says "this statement" and pointed at the
                    // expression inside it, which is a different claim -- and
                    // it also left every function declared in the statement
                    // looking unaccounted for, because `super::unaccounted`
                    // asks whether a refusal covers one. Fifty-one object
                    // literal methods in the node profile were reported as
                    // functions outside every walk for exactly that reason.
                    lost.push((probe.origin(*statement).location, diagnostic));
                    false
                }
            }
        });
        for (statement, diagnostic) in lost {
            lowered.diagnostics.push(diagnostic);
            // A *consequence*, and coded as one. The cause is the diagnostic
            // pushed just above; this says what losing the statement costs.
            // Sharing `NTS1001` with the causes made it the largest row in the
            // corpus histogram -- 37 of 184 files -- which read as a feature
            // thirty-seven programs were waiting on and was a tally of how
            // often anything at all went wrong at module scope.
            lowered.diagnostics.push(Diagnostic::error(
                "NTS1005",
                "this statement, which module evaluation therefore skips; the rest of the \
                 module's evaluation still runs, and every value this line would have \
                 computed keeps whatever it held before it"
                    .to_owned(),
                statement,
            ));
        }

        let mut builder = shared.builder(snapshot, Substitution::default(), String::new());
        match builder.lower_module_init(file, &statements, refused) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => {
                // The consequence, said out loud. One refused statement loses
                // the *whole* initializer, and that does not stop the build:
                // the program is emitted, runs, and answers from static
                // initializers alone. A wrong answer with exit status 0.
                //
                // The refusal above names a construct; what a caller notices is
                // a number, so the two are worth separate sentences.
                //
                // Whether it should stop the build is a policy question about
                // what a refusal means -- `Severity::Error` is documented as
                // "the build cannot produce an artifact" and today does not --
                // and that is a decision about every refusal, not this one.
                let origin = diagnostic.primary;
                lowered.diagnostics.push(diagnostic);
                lowered.diagnostics.push(Diagnostic::error(
                "NTS1001",
                "module evaluation, which the refusal above loses in full and so will not run; \
                 the program still builds, and every module-scope value it would have computed \
                 stays at its static initializer"
                    .to_owned(),
                origin,
            ));
            }
        }
        wanted.extend(builder.used_closures.iter().copied());
        collect_layouts(&mut lowered.program, builder.layouts);
    }
}

#[must_use]
pub fn lower(snapshot: &SemanticSnapshot) -> Lowered {
    let mut lowered = Lowered::default();
    // Closures first, because a module-scope `const f = () => ...` is typed by
    // the *closure* the arrow becomes rather than by its function type, and the
    // closure's layout is decided here. `collect_closures` reads only the
    // snapshot, so the order is free.
    let closures = collect_closures(snapshot);
    let mut module = collect_module_scope(snapshot, &closures);
    lowered.diagnostics.extend(module.refusals.iter().cloned());
    let hierarchy = collect_hierarchy(snapshot, &closures);
    lowered.program.globals.clone_from(&module.globals);
    collect_layouts(&mut lowered.program, module.layouts.clone());
    let mut wanted: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();

    let generic = generic_classes(snapshot);
    let refused =
        mark_refused_initializers(snapshot, &mut module, &hierarchy, &closures, &mut lowered);
    let shared = Shared::whole_program(snapshot, &module, &hierarchy, &closures);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));

        // A class contributes one function per method and constructor, each
        // taking the instance as its first parameter. There is no dispatch to
        // arrange: the checker resolved every call site, so a method call is a
        // static call and `this` is an ordinary argument.
        if node.kind == NodeKind::Syntax(syntax::CLASS_DECLARATION) {
            let members = members_of(snapshot, id);
            // A generic class is lowered once per instantiation and not at all
            // as itself: a field of type `T` has no width, and `Vector<Body>`
            // and `Vector<double>` are two classes that happen to share a
            // source. A class with type parameters that nothing instantiates is
            // dead, and lowering it would report a refusal for a program nobody
            // wrote.
            let copies = copies_of(&generic, id);

            for (instance, substitution) in copies {
                for &member in &members {
                    let mut builder = shared.builder(snapshot, substitution.clone(), String::new());
                    match builder.lower_method_of(id, member, instance) {
                        Ok(func) => lowered.program.funcs.push(func),
                        Err(diagnostic) => lowered.diagnostics.push(diagnostic),
                    }
                    wanted.extend(builder.used_closures.iter().copied());
                    collect_layouts(&mut lowered.program, builder.layouts);
                }
            }
            continue;
        }

        if node.kind != NodeKind::Syntax(syntax::FUNCTION_DECLARATION) {
            continue;
        }
        // An `async` function is refused rather than lowered, and the reason it
        // needs saying is that it was neither before. `Promise<number>` has no
        // representation, so the return type resolved to `void`, the returned
        // value was converted away, and the verifier accepted the result -- a
        // function that computes the right number and discards it, with no
        // diagnostic. `await` and `new Promise` were both properly refused; it
        // was bare `async` that was accepted and wrong.
        //
        // Refusing it is not the feature. A promise is a value with a
        // representation and a suspension is a transformation of the function,
        // and neither exists yet; until they do, saying so is the whole of what
        // this compiler can honestly do.
        // The shapes that are refused *by name*, ahead of the blanket refusal
        // below.
        //
        // Ordered this way on purpose. While `async` is refused wholesale these
        // three are refused with it, so a specific diagnostic added afterwards
        // would be a rule with no case reaching it -- and the day the blanket
        // comes off, each of these would silently start compiling as though the
        // hard part were not there. Checking them first means they are live and
        // testable now, and stay so.
        if let Some(what) = refused_by_name(snapshot, id) {
            lowered
                .diagnostics
                .push(FuncBuilder::new(snapshot).unsupported(id, what));
            continue;
        }

        // `declare function f(): number` has no body because it is *external*,
        // not because this lowering failed to understand it. Refusing it says
        // the opposite, and -- since a caller of a refused function is refused
        // too -- took every function that reaches the platform with it. An
        // overload signature has the same shape and the same answer: the
        // implementation that follows is the one to lower.
        if !FuncBuilder::new(snapshot).has_a_body(id) {
            continue;
        }
        // Two functions cannot share a name: the emitted C would define one
        // twice. Where they come from different modules `naming` qualifies
        // them; where they come from the same one there is nothing to qualify
        // with, and both are refused rather than the second -- emitting the
        // first and dropping the second is a program that compiles and calls
        // the wrong one.
        if shared.naming.ambiguous.contains(&id) {
            let name = FuncBuilder::new(snapshot)
                .declared_name(id)
                .unwrap_or_else(|| "?".to_owned());
            lowered
                .diagnostics
                .push(FuncBuilder::new(snapshot).unsupported(
                    id,
                    &format!("a second function named `{name}` in the same file"),
                ));
            continue;
        }
        let copies = function_copies(snapshot, &shared.generics, id);
        for (substitution, suffix) in copies {
            let mut builder = shared.builder(snapshot, substitution, suffix);
            match builder.lower_function(id) {
                Ok(func) => lowered.program.funcs.push(func),
                Err(diagnostic) => lowered.diagnostics.push(diagnostic),
            }
            wanted.extend(builder.used_closures.iter().copied());
            collect_layouts(&mut lowered.program, builder.layouts);
        }
    }

    lower_module_initializer(snapshot, &shared, &mut lowered, &mut wanted, &refused);

    // Each closure something allocated, and each as a function of its own.
    // Nothing about it depends on the function that allocates it -- that is the
    // point of putting the captures in an object rather than on a chain of
    // frames.
    //
    // A worklist rather than a pass, because a closure body can allocate
    // another one. Taken in index order, so one compiler on one input emits its
    // functions in one order.
    let mut done: rustc_hash::FxHashSet<usize> = rustc_hash::FxHashSet::default();
    while let Some(index) = wanted.iter().copied().find(|at| !done.contains(at)) {
        done.insert(index);
        let mut builder = FuncBuilder::within(
            snapshot,
            module.clone(),
            hierarchy.clone(),
            closures.clone(),
        );
        // The qualified names, which this builder needs for the same reason
        // every other one does: a wrapper forwards to the function it stands
        // for, and where two modules declare that name the function is emitted
        // under the qualified one. Without this the wrapper called a name the
        // program does not define -- see `lower_closure`, which is where the
        // consequence is written down.
        builder.qualified.clone_from(&shared.naming.qualified);
        builder.generators.clone_from(&shared.naming.generators);
        match builder.lower_closure(index, &closures[index]) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => lowered.diagnostics.push(diagnostic),
        }
        wanted.extend(builder.used_closures.iter().copied());
        collect_layouts(&mut lowered.program, builder.layouts);
    }

    relate_closures_to_signatures(snapshot, &closures, &hierarchy, &mut lowered.program);

    canonicalize_objects(&mut lowered.program);
    // The conservation law, enforced rather than merely measured: every
    // function the checker knows about is either lowered or refused, and never
    // neither. `super::unaccounted` explains why that is worth asking; this is
    // what happens when the answer is no.
    //
    // A construct marked "not done" has to be *refused*. Several were silently
    // absent instead — a method of a class expression is the clearest, since
    // nothing walks a class expression at all — and a function that vanishes
    // takes its callers' correctness with it while the compiler reports
    // success.
    for location in super::unaccounted(
        snapshot,
        &lowered.program,
        &lowered.diagnostics,
        &shared.generics,
    ) {
        lowered.diagnostics.push(Diagnostic::error(
            "NTS1001",
            "a function declaration outside every walk".to_owned(),
            location,
        ));
    }

    lowered
}

/// The index of a `message: string` field, if a type has one.
///
/// Used by `throw` to hand the runtime something to print. By shape, not by
/// name: the four classes in [`super::builtin`] have such a field, and so does
/// every user class that extends one, and nothing here needs to tell them
/// apart.
fn message_field(layouts: &[Layout], ty: &HirType) -> Option<u32> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return None;
    };
    let layout = layouts.iter().find(|layout| layout.types.contains(id))?;
    layout
        .fields
        .iter()
        .position(|field| {
            field.name == "message" && matches!(field.ty, HirType::Managed(ManagedType::String))
        })
        .and_then(|at| u32::try_from(at).ok())
}

/// Merge a function's discovered layouts into the program's.
///
/// A layout is a property of the type, not of the function that happened to
/// mention it first.
/// Whether a layout's name was invented here rather than declared.
///
/// An anonymous object type is named `Type` followed by its type id. Matching
/// on the prefix alone is not enough and was wrong about exactly the class this
/// mattered for: `TypeError` starts with `Type`, so it read as generated, so it
/// merged with `RangeError` by shape and the two shared one descriptor.
fn generated_name(name: &str) -> bool {
    name.strip_prefix("Type")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
}

/// A function type's layout name, from its *signature* rather than its type id.
///
/// Two ids for one written signature must share a layout -- the arrow's
/// inferred type and the declared type of the slot it is stored into are
/// different ids over the same contents -- and two different signatures must
/// not. Neither is a question `same_shape` can answer, because every function
/// type's layout is empty.
///
/// So the name carries the signature: parameter type ids, then `__`, then the
/// return's. The separator matters -- `Fn2_2__2` is `(a, b) => c` and `Fn2__2`
/// is `(a) => b`, and joining with one underscore would make those the same
/// string. `A` marks an async signature, whose return is a promise the caller
/// sees differently.
fn signature_name(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some((params, returns, asynchronous)) = signature_key(snapshot, ty) else {
        return format!("Fn{}", ty.0);
    };
    let params: Vec<String> = params.iter().map(|param| param.0.to_string()).collect();
    format!(
        "Fn{}{}__{}",
        if asynchronous { "A" } else { "" },
        params.join("_"),
        returns.0
    )
}

/// Whether a layout name was made by [`signature_name`].
///
/// By prefix and shape rather than by a flag on the layout: `Layout` is what
/// three backends read, and a field that exists to tell two of its own names
/// apart is a field they would all have to ignore.
fn is_signature_name(name: &str) -> bool {
    name.starts_with("Fn") && name.contains("__")
}

fn collect_layouts(program: &mut Program, layouts: Vec<Layout>) {
    for layout in layouts {
        if let Some(existing) = program.layouts.iter_mut().find(|known| {
            // The same type, however the two were built. A layout is named
            // after its type, so two of them for one type emit two `struct`s
            // of the same name -- which is what happened once the module scope
            // started contributing layouts as well as the functions, and it
            // was `redefinition of NtsObj_A` rather than anything the merge
            // below would have noticed: it compares *shape*, and the two
            // disagreed about their method tables while describing one type.
            // Shape is the right test almost everywhere, and it is what makes
            // TypeScript's structural typing work: `Point` and the `{ x, y }` of
            // a literal are one type, and two interfaces of one shape are
            // interchangeable, so they must share a struct or a call cannot pass
            // one where the other is declared. Widening this guard beyond the
            // case below broke `function-values` and `readonly` for exactly that
            // reason.
            //
            // The provided error classes are the exception, because they are the
            // one family this compiler asks a *nominal* question about. All four
            // hold a `message` and a `name` and nothing else, so shape merged
            // them into one layout with one descriptor -- and `e instanceof
            // TypeError` was then true of a `RangeError`, and an uncaught
            // `TypeError` printed whichever of the four had been laid out first.
            // Nothing could see either until `instanceof` existed.
            let two_errors = super::builtin::is_error(&known.name)
                && super::builtin::is_error(&layout.name)
                && known.name != layout.name;
            // Function types are the second family shape cannot answer for, and
            // for the same reason: every one of them is *empty*. A function
            // type is a signature rather than a class, so `Fn` layouts have no
            // fields, no methods and no base -- and `same_shape` therefore says
            // all of them are one layout.
            //
            // That was harmless while nothing dispatched through a function
            // type. It stopped being harmless the moment a closure declared its
            // `call` in one: `examples/function-values` collapsed
            // `(number) => number`, `(number) => void` and
            // `(number, number) => number` into a single layout holding eight
            // type ids, and every closure then declared it overrode a signature
            // two thirds of them do not have. The JVM said so --
            // `Closure9.call is (D)V where the method it overrides is (D)D` --
            // and nothing on a lane with pointers could.
            //
            // The names are structural, so this merges two ids for one written
            // signature and separates two signatures. That is the distinction
            // `same_shape` cannot make about a shape that is empty.
            let two_signatures = is_signature_name(&known.name)
                && is_signature_name(&layout.name)
                && known.name != layout.name;
            known.types.iter().any(|ty| layout.types.contains(ty))
                || (!two_errors
                    && !two_signatures
                    && known.same_shape(&layout.fields, &layout.methods, layout.base))
        }) {
            for ty in layout.types {
                if !existing.types.contains(&ty) {
                    existing.types.push(ty);
                }
            }
            // A declared name beats a generated one, and the two functions that
            // mention a type may be discovered in either order.
            if generated_name(&existing.name) && !generated_name(&layout.name) {
                existing.name = layout.name;
            }
        } else {
            program.layouts.push(layout);
        }
    }
}

/// A function type's signature as the ids it is made of, or `None` when the
/// type is not a function.
///
/// Two type ids for one written signature compare equal here, which is the
/// whole point: the checker interns the parameter and return types, so the
/// inferred type of an arrow and the declared type of the variable it is
/// assigned to are different ids over the same contents.
fn signature_key(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<(Vec<TypeId>, TypeId, bool)> {
    let record = snapshot.types.get(ty.0 as usize)?;
    let TypeKind::Function(signature) = record.kind else {
        return None;
    };
    let signature = snapshot.signatures.get(signature.0 as usize)?;
    Some((
        signature.parameters.iter().map(|param| param.ty).collect(),
        signature.return_type,
        signature.is_async,
    ))
}

/// Give a closure's layout the function type it is a value of as its base, and
/// give that function type an abstract declaration to dispatch through.
///
/// # Why the base alone is not enough
///
/// `closure_layout` builds `Closure{index}` with the closure's `call` in the
/// shared closure slot; the function-type arm of `layout_of` builds `Fn{ty}`
/// with **no fields and no methods**, because a function type is a signature
/// rather than a class. Relating them by `base` alone therefore produces a
/// base that declares nothing, and a call through an `Fn{ty}`-typed value has
/// no method to reach -- on a machine with a vtable that is a null slot, and on
/// the JVM it is a class that will not verify.
///
/// So the function type also gets an [`Func::abstract_declaration`], which is
/// exactly what that field means: a signature the program declares, that
/// nothing calls directly, and that every reachable receiver overrides. It was
/// added for `abstract` methods and it turns out to name the same concept here.
///
/// # The signature is taken from the closure rather than from the checker
///
/// Every closure that is a value of one function type must agree with the
/// others about the descriptor, or dispatch through the base is meaningless --
/// which is the same requirement an override already has. Taking the signature
/// from the first closure makes that agreement *checkable* rather than assumed:
/// a backend comparing an override against what it overrides sees a real
/// disagreement, where a signature synthesized from the checker would have
/// quietly been a third opinion neither closure held.
///
/// # Named function types only
///
/// An inline `(x: number) => number` written in two places can be two type ids
/// for one structural type, and two closures would then extend two different
/// bases for the same signature. A type with no symbol is left alone, which
/// leaves those programs exactly as they are today rather than differently
/// wrong.
fn relate_closures_to_signatures(
    snapshot: &SemanticSnapshot,
    closures: &[ClosureInfo],
    hierarchy: &Hierarchy,
    program: &mut Program,
) {
    let Some(slot) = hierarchy.closure_slot.map(|slot| slot as usize) else {
        return;
    };
    // Collected first and applied after, because deciding needs the funcs and
    // the layouts at once and applying mutates both.
    let mut relate: Vec<(usize, TypeId, String)> = Vec::new();
    let mut declare: Vec<(usize, Func)> = Vec::new();
    // One declaration per signature, not per closure. Every closure of a type
    // queues the same relation, and the layout is only written after the loop,
    // so a test against the layout is a test against the state before any of
    // them -- sixteen `Fn2#call`s in `captured-by-reference`, which `verify`
    // caught as `DuplicateFunction` on the first run.
    let mut declared_for: rustc_hash::FxHashSet<usize> = rustc_hash::FxHashSet::default();


    for (index, info) in closures.iter().enumerate() {
        let (class, method) = closure_names(index);
        let Some(at) = program.layouts.iter().position(|layout| layout.name == class) else {
            continue;
        };
        let Some(&ty) = snapshot.node_types.get(&info.node) else {
            continue;
        };
        let Some(record) = snapshot.types.get(ty.0 as usize) else {
            continue;
        };
        // A function type, and one the program named. See above.
        if !matches!(record.kind, TypeKind::Function(_)) || record.symbol.is_none() {
            continue;
        }
        // *Not* the layout for this exact type id. The arrow's own type is the
        // signature the checker inferred for it, and the slot it is stored into
        // is declared with the type the program *wrote* -- two ids for one
        // signature, and only the second has a layout. `function-values` has
        // the arrow at type 1 and the declaration at type 8.
        //
        // So the two are related by their signatures rather than by their ids:
        // the parameter types and the return type, which are themselves ids the
        // checker has already interned. That is asking the checker whether two
        // function types are the same signature, which it can answer, rather
        // than guessing from a shape.
        let Some(key) = signature_key(snapshot, ty) else {
            continue;
        };
        let matching: Vec<usize> = program
            .layouts
            .iter()
            .enumerate()
            .filter(|(_, layout)| {
                layout.types.iter().any(|&other| {
                    other != ty && signature_key(snapshot, other).is_some_and(|found| found == key)
                })
            })
            .map(|(at, _)| at)
            .collect();
        // Exactly one, or leave it alone. Two layouts for one signature is the
        // case that would give two closures two different bases for the same
        // type, which is what this is forbidden from guessing at.
        let [signature] = matching[..] else {
            continue;
        };
        let Some(call) = program.funcs.iter().find(|func| func.name == method) else {
            continue;
        };
        // The id the *signature's layout* carries, not the arrow's. `base` is
        // resolved by finding the layout that holds the id, and no layout holds
        // the arrow's own -- which is the whole reason the two had to be
        // matched by signature rather than by identity a few lines up. The
        // declaration's receiver is typed with it for the same reason: a
        // parameter whose type no layout answers for has no representation,
        // and the backend refuses the dispatch rather than the type.
        let Some(&base) = program.layouts[signature].types.first() else {
            continue;
        };
        let declared = format!("{}#call", program.layouts[signature].name);
        if declared_for.insert(signature)
            && program.layouts[signature].methods.get(slot).is_none_or(Option::is_none)
        {
            let mut shell = call.clone();
            shell.name.clone_from(&declared);
            if let Some(receiver) = shell.params.first_mut() {
                receiver.ty = HirType::Managed(ManagedType::Object(base));
            }
            // A declaration is its signature. The parameters keep their value
            // ops because those *are* the signature in this IR; everything the
            // body computed goes, and the single block says so.
            shell.values.truncate(shell.params.len());
            shell.blocks = vec![Block {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: Terminator::Unreachable,
            }];
            shell.exported = false;
            shell.initializes_receiver = false;
            shell.async_result = None;
            shell.abstract_declaration = true;
            declare.push((signature, shell));
        }
        relate.push((at, base, declared));
    }

    for (signature, shell) in declare {
        let table = hierarchy.table_size();
        if program.layouts[signature].methods.len() < table {
            program.layouts[signature].methods.resize(table, None);
        }
        program.layouts[signature].methods[slot] = Some(shell.name.clone());
        program.funcs.push(shell);
    }
    for (at, ty, _) in relate {
        program.layouts[at].base = Some(ty);
    }
}

/// Give structurally identical object types one identity.
///
/// TypeScript is structurally typed, so `Point` and the anonymous
/// `{ x: number; y: number }` of a literal returned as one *are* the same type
/// — but the checker gives them different ids, and `HirType` compares by id.
/// Left alone, a `return { x, y }` from a function declared to return `Point`
/// looks like a representation change and earns a conversion between two
/// pointers to the same struct.
///
/// Rewriting every object type to its layout's representative makes `HirType`
/// equality mean what it should: *the same representation*.
fn canonicalize_objects(program: &mut Program) {
    let representatives: Vec<(Vec<TypeId>, TypeId)> = program
        .layouts
        .iter()
        .filter_map(|layout| Some((layout.types.clone(), *layout.types.first()?)))
        .collect();

    let canonical = |ty: &mut HirType| {
        if let HirType::Managed(ManagedType::Object(id)) = ty
            && let Some((_, representative)) = representatives
                .iter()
                .find(|(members, _)| members.contains(id))
        {
            *id = *representative;
        }
    };

    for func in &mut program.funcs {
        canonical(&mut func.return_type);
        for param in &mut func.params {
            canonical(&mut param.ty);
        }
        for value in &mut func.values {
            canonical(&mut value.ty);
        }
    }
}

/// Choose a representation for a source type.
///
/// The decision the whole layer exists to make. Unspecialized, so `number`
/// becomes `f64` — correct, and the thing specialization improves on once
/// analysis can show a value is integral and in range.
/// A JavaScript numeric literal, as the double it denotes.
///
/// Every spelling the language has: decimal with an optional exponent, and
/// `0x`/`0o`/`0b` integers. Numeric separators are removed first — `1_000_000`
/// is the same literal as `1000000`, and only the reader was meant to notice
/// the difference.
///
/// Returns `None` rather than guessing. A `1n` is a `BigInt` and not this, and a
/// spelling that is not here should reach the fallback rather than a wrong
/// number.
#[must_use]
pub fn parse_number(text: &str) -> Option<f64> {
    let text = text.replace('_', "");
    if text.ends_with('n') {
        // A BigInt literal, which is a different type with different arithmetic.
        return None;
    }
    // `get(..2)` and not `[..2]`: `0` is a whole literal and is one byte long.
    let radix = match text
        .get(..2)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "0x" => 16,
        "0o" => 8,
        "0b" => 2,
        _ => {
            // Decimal, where Rust's parser is correctly rounded and is the whole
            // of the answer.
            return text.parse::<f64>().ok();
        }
    };
    // An integer literal in another base. `u128` because `0x` literals wider
    // than `u64` are legal to write; the conversion to `f64` rounds, which is
    // exactly what JavaScript does with an integer above 2^53.
    #[expect(
        clippy::cast_precision_loss,
        reason = "rounding a large integer to the nearest double is the semantics"
    )]
    u128::from_str_radix(&text[2..], radix)
        .ok()
        .map(|value| value as f64)
}

/// A short name for a type, for a diagnostic to quote.
///
/// A refusal that says only "unrepresentable" is not a work queue. Run over a
/// corpus, "a parameter of an unrepresentable type" was the largest bar in the
/// histogram by a factor of two, and it said nothing about what to build. The
/// checker's own rendering is in the snapshot for exactly this.
#[must_use]
/// Whether a union member means "there is no value here".
///
/// All three spellings, because TypeScript uses them interchangeably at a
/// boundary: `void` is what a function returns when it returns nothing, and it
/// appears in a union for the same reason `undefined` does.
/// Which absent value a union member is, where it is one.
///
/// The distinction matters for exactly one decision -- whether a union's
/// absences fit in a pointer -- but it matters absolutely there: `null` and
/// `undefined` are different values and a program can compare them.
///
/// `void` is `undefined`. It is the type of an expression that produced no
/// value, and the value it did not produce is `undefined`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Absence {
    Null,
    Undefined,
}

/// Whether an erased value can be read back as this.
///
/// `Unerase` is a load out of the payload, so it needs a representation to load
/// *as*. A `Void` has none -- there is nothing in the payload for `undefined`,
/// the tag is the whole value -- and neither has a `Never`, an erased value, or
/// a table.
///
/// Asked in two places, which is why it is a function rather than a `matches!`:
/// [`FuncBuilder::narrowed`] reads back what the checker narrowed, and
/// [`FuncBuilder::present_of`] reads back what a `?.` test established. The two
/// have different licences and the same question about the destination.
fn readable_back(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Float { .. }
            | HirType::Int { .. }
            | HirType::Bool
            | HirType::Managed(
                ManagedType::String | ManagedType::Object(_) | ManagedType::Array(_)
            )
    )
}

fn absence_of_member(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Absence> {
    match snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Null => Some(Absence::Null),
        TypeKind::Undefined | TypeKind::Void => Some(Absence::Undefined),
        _ => None,
    }
}

/// A union member's name, short enough to put several on one line.
fn short(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return "?".to_owned();
    };
    match &record.kind {
        TypeKind::Void => "void".to_owned(),
        TypeKind::Undefined => "undefined".to_owned(),
        TypeKind::Never => "never".to_owned(),
        TypeKind::Boolean => "boolean".to_owned(),
        TypeKind::Number => "number".to_owned(),
        TypeKind::String => "string".to_owned(),
        // A literal's *value* is not what makes a union hard; its
        // representation is. `1 | 2 | 3` and `1 | 2 | 4` are one problem.
        TypeKind::Literal(LiteralValue::Number(_)) => "a number literal".to_owned(),
        TypeKind::Literal(LiteralValue::String(_)) => "a string literal".to_owned(),
        TypeKind::Literal(LiteralValue::Boolean(_)) => "a boolean literal".to_owned(),
        TypeKind::Object { .. } => "an object".to_owned(),
        TypeKind::Array(_) => "an array".to_owned(),
        _ => describe(snapshot, ty),
    }
}

/// What to call a syntax kind in a refusal.
///
/// "an expression of kind 216" names nothing, and naming the thing is the whole
/// rule for a refusal: it is a *tagged template*, and the difference between
/// those two messages is the difference between a number in a report and an
/// item on a queue. Six of the corpus's refusals were `kind 268`, which is a
/// `namespace`.
///
/// Falls back to the number for a kind the table does not carry, which is what
/// a tsgo bump that adds one would produce.
fn spell(kind: u16, fallback: &str) -> String {
    nts_semantic_schema::syntax::name_of(kind).map_or_else(
        || format!("{fallback} of kind {kind}"),
        |name| {
            // The table humanises a `PascalCase` kind by splitting it into
            // words, which is right for nearly all of them and wrong for the
            // two whose name is a keyword pair rather than English.
            let name = match name {
                "for in statement" => "`for...in` statement",
                "for of statement" => "`for...of` statement",
                other => other,
            };
            let article = if name.starts_with(['a', 'e', 'i', 'o', 'u']) {
                "an"
            } else {
                "a"
            };
            format!("{article} {name}")
        },
    )
}


/// Whether a type declares a property, and whether the answer is usable.
enum Declares {
    /// Declared, and always present.
    Always,
    /// Not declared, so `in` is false for a value of this type.
    Never,
    /// Declared `x?: T`. The slot exists here whether or not the program wrote
    /// it, and JavaScript can tell the difference -- `{}` and
    /// `{ a: undefined }` disagree about `"a" in o` -- so this is refused
    /// rather than answered by the slot.
    Optionally,
    /// Not an object type. `"a" in 5` is a `TypeError` in JavaScript, and a
    /// union arm that is not an object makes the whole test one.
    NotAnObject,
}

/// How an operator token is written, for a refusal that has to name it.
///
/// By kind, because a token node carries no text. The number is the fallback
/// rather than the answer: a refusal nobody can group by is a refusal nobody
/// can rank, and "this operator" was twenty-eight of them at once.
fn spelling(kind: u16) -> String {
    let named = match kind {
        syntax::QUESTION_QUESTION_TOKEN => "??",
        syntax::AMPERSAND_AMPERSAND_TOKEN => "&&",
        syntax::BAR_BAR_TOKEN => "||",
        syntax::IN_KEYWORD => "in",
        syntax::INSTANCEOF_KEYWORD => "instanceof",
        _ => return spell(kind, "an operator"),
    };
    format!("`{named}`")
}

/// A type's declared name, or `fallback` where it has none.
///
/// Anonymous shapes -- an inline `{ a: number }`, a synthesized instantiation --
/// genuinely have no name to give, and the category is then all there is.
fn named_or(snapshot: &SemanticSnapshot, record: &TypeRecord, fallback: &str) -> String {
    let Some(symbol) = record.symbol else {
        return fallback.to_owned();
    };
    snapshot
        .symbols
        .get(symbol.0 as usize)
        .filter(|declared| !declared.name.is_empty())
        .map_or_else(
            || fallback.to_owned(),
            |declared| format!("`{}`", declared.name),
        )
}

/// Which hash and comparison a table of these keys is built with.
///
/// The whole of what a `Map`'s key type costs at run time: a `Map<string, V>`
/// gets the string hash and compares with `nts_string_eq`, and its probe loop
/// never reads a tag. Only a key type that is genuinely several things gets
/// `ERASED`, which is the one that dispatches.
///
/// These are `NTS_KEY_*` in the runtime header; the two are a pair and neither
/// is meaningful alone.
fn key_kind_of(key: &HirType) -> u32 {
    match key {
        HirType::Managed(ManagedType::String) => 1,
        HirType::Float { .. } | HirType::Int { .. } => 2,
        // Every other managed value is a pointer, and identity is what
        // JavaScript compares objects by, so one entry serves them all.
        HirType::Managed(_) => 3,
        // A boolean key is rare enough not to be worth a hash of its own, and
        // an erased one has to read its tag by definition.
        _ => 0,
    }
}

#[must_use]
pub fn describe(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return "an unknown type".to_owned();
    };
    match &record.kind {
        TypeKind::Any => "any".to_owned(),
        TypeKind::Unknown => "unknown".to_owned(),
        TypeKind::Null => "null".to_owned(),
        TypeKind::BigInt => "bigint".to_owned(),
        TypeKind::Symbol => "symbol".to_owned(),
        // Named by its members, because "a union" is a category and the work
        // queue is ordered by what is actually in the corpus. `number |
        // undefined` and `string | number` want different representations, and
        // one refusal message cannot tell them apart.
        TypeKind::Union(members) => {
            let mut named: Vec<String> = members
                .iter()
                .map(|member| short(snapshot, *member))
                .collect();
            named.sort();
            named.dedup();
            format!("a union of {}", named.join(" | "))
        }
        TypeKind::Intersection(_) => "an intersection".to_owned(),
        TypeKind::Tuple(_) => "a tuple".to_owned(),
        TypeKind::Function(_) => "a function type".to_owned(),
        // TypeScript models the polymorphic `this` as a type parameter named
        // after its class and constrained to it, so "the type parameter `Box`"
        // is what a reader of `ref(): this` was told -- which sends them
        // looking for a generic they never wrote.
        TypeKind::TypeParameter {
            name,
            constraint: Some(constraint),
        } if named(snapshot, *constraint) == Some(name.as_str()) => {
            format!("`this`, which stands for `{name}` here")
        }
        TypeKind::TypeParameter { name, .. } => format!("the type parameter `{name}`"),
        TypeKind::Conditional { .. } => "a conditional type".to_owned(),
        TypeKind::IndexedAccess { .. } => "an indexed access".to_owned(),
        TypeKind::TemplateLiteral { .. } => "a template literal type".to_owned(),
        // `Map<K, V>` and `Set<T>` spelled with their arguments.
        //
        // The table is the same table whatever it holds, so a refusal naming
        // one is never about the Map -- it is about a key or a value with no
        // representation, and `Map` sends the reader to a feature that is
        // already built. 100 refusals in the node profile said `Map` and could
        // not be grouped by what actually blocks them.
        TypeKind::Object { .. } | TypeKind::Structured { .. }
            if matches!(
                named(snapshot, ty),
                Some("Map" | "Set" | "WeakMap" | "WeakSet")
            ) =>
        {
            let name = named(snapshot, ty).unwrap_or("Map");
            match snapshot.type_arguments.get(&ty) {
                Some(arguments) if !arguments.is_empty() => {
                    let spelled: Vec<String> = arguments
                        .iter()
                        .map(|argument| short(snapshot, *argument))
                        .collect();
                    format!("`{name}<{}>`", spelled.join(", "))
                }
                // No recorded arguments is its own answer: the frontend stopped
                // at the library boundary before it got them, which is why the
                // representation could not be built either.
                _ => format!("`{name}` with no recorded arguments"),
            }
        }
        TypeKind::Object { .. } => named_or(snapshot, record, "an object type"),
        // Worth distinguishing, because the two are refused for entirely
        // different reasons and only one of them is about *this* type. An
        // ordinary array is refused when its element is; `type Tree = Tree[]`
        // is refused because there is no finite `HirType` that spells it.
        TypeKind::Array(_) => {
            if contains_a_cycle(snapshot, ty, &mut Vec::new()) {
                "a recursive array type".to_owned()
            } else {
                "an array type".to_owned()
            }
        }
        // A placeholder the decomposition did not open. The flags say which
        // checker category it fell in, which no reader can rank; the symbol
        // says `Set` or `AsyncIterableIterator`, which is the whole question.
        // Three rows totalling 223 in the node profile were unreadable until
        // this named them, and they turned out to be two features.
        TypeKind::Structured { flags } => named_or(
            snapshot,
            record,
            &format!("a structured type (flags {flags:#x})"),
        ),
        TypeKind::Unsupported { rendered, .. } => format!("`{rendered}`"),
        TypeKind::Void
        | TypeKind::Undefined
        | TypeKind::Never
        | TypeKind::Boolean
        | TypeKind::Number
        | TypeKind::String
        | TypeKind::Literal(_) => "a representable type".to_owned(),
    }
}

/// Whether following element and member types from here ever revisits a type.
///
/// A *cycle* rather than a return to the starting type: `type Tree = Tree[]`
/// reaches this compiler as an instantiation whose element is the alias whose
/// element is the alias, so the loop that has no finite representation need not
/// pass through the type being asked about. `type A = B[]; type B = A[]` is the
/// same shape with the ids spelled out.
///
/// Only through arrays and unions, which are the two kinds whose representation
/// is built out of another's. An object stops the walk for the reason it
/// terminates in [`representation`]: its representation is a pointer, and a
/// pointer to something that leads back here is an ordinary linked list.
fn contains_a_cycle(snapshot: &SemanticSnapshot, ty: TypeId, path: &mut Vec<TypeId>) -> bool {
    if path.contains(&ty) {
        return true;
    }
    path.push(ty);
    let found = match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::Array(element)) => contains_a_cycle(snapshot, *element, path),
        Some(TypeKind::Union(members)) => members
            .iter()
            .any(|member| contains_a_cycle(snapshot, *member, path)),
        _ => false,
    };
    path.pop();
    found
}

/// `<id>` where a type is a generic *instantiation*, and nothing otherwise.
///
/// The declaration is not one: its arguments are its own type parameters, and
/// it is never laid out — a field of type `T` has no width.
fn instantiation_suffix(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let arguments = snapshot.type_arguments.get(&ty);
    let instantiated = arguments.is_some_and(|arguments| {
        !arguments.is_empty()
            && !arguments.iter().all(|argument| {
                matches!(
                    snapshot.types.get(argument.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::TypeParameter { .. })
                )
            })
    });
    if instantiated {
        format!("<{}>", ty.0)
    } else {
        String::new()
    }
}

#[must_use]
pub fn representation(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    representation_with(snapshot, ty, &Substitution::default())
}

/// What a type parameter stands for, while lowering one instantiation.
///
/// Keyed by the *type parameter's* own [`TypeId`], which is what a body's nodes
/// resolve to: the AST inside a generic method is shared by every
/// instantiation, so the checker leaves `T` there and this is what turns it
/// into the machine type for the copy being lowered.
pub type Substitution = rustc_hash::FxHashMap<TypeId, HirType>;

/// The declared name of a type, where it has one.
fn named(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    let symbol = snapshot.types.get(ty.0 as usize)?.symbol?;
    Some(snapshot.symbols.get(symbol.0 as usize)?.name.as_str())
}

/// [`representation`], resolving type parameters through a substitution.
#[must_use]
pub fn representation_with(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    subst: &Substitution,
) -> Option<HirType> {
    representation_within(snapshot, ty, &mut Vec::new(), subst)
}

/// [`representation`], refusing a type that contains itself.
///
/// # Why a type can do that at all
///
/// `class Node { next: Node }` is fine and common, and it terminates here
/// because an object's representation is a *pointer* — the arm returns without
/// looking at the fields. `type Tree = Tree[]` does not: an array's
/// representation names its element type, and the element is the array. There
/// is no finite `HirType` for it, so building one recurses until the stack ends.
///
/// # Why refusing is the answer for now and not forever
///
/// The runtime is already more relaxed than this: an array of references uses
/// one descriptor for all of them, because *every* reference is a pointer and
/// the descriptor describes the element's shape rather than what it points at.
/// So a representation exists; what is missing is a way to *spell* it, which
/// means a recursion marker in `HirType` and every pass agreeing about what it
/// means. That is a type-system change and is refused rather than guessed at.
///
/// The list is a path rather than a set: two sibling fields of the same array
/// type are not a cycle, and treating them as one would refuse ordinary code.
/// The element type of a typed array this type descends from.
///
/// By the same walk `provided_error_base` uses, and for the same reason: the
/// checker's property list is flattened, so nothing in it says a member came
/// from a base whose storage this compiler models itself.
fn inherited_typed_array(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    let mut stack = vec![(ty, 0u32)];
    while let Some((at, depth)) = stack.pop() {
        // A type that reaches itself through its bases is not a hierarchy.
        if depth > 32 {
            continue;
        }
        if at != ty
            && let Some(name) = named(snapshot, at)
            && let Some(element) = super::builtin::typed_array_element(name)
        {
            return Some(element);
        }
        for base in snapshot.base_types.get(&at).into_iter().flatten() {
            stack.push((*base, depth + 1));
        }
    }
    None
}

/// Whether a type declares storage of its own.
///
/// Neither a method nor an accessor is a field, and `MemberKind` says which is
/// which. It used to be asked of the *type* -- "a property whose type is a
/// function" -- which cannot tell a method from a field holding a closure.
/// `own` is what separates what the class wrote from what the flattened list
/// inherited.
fn declares_storage(properties: &[nts_semantic_schema::PropertyRecord]) -> bool {
    properties
        .iter()
        .any(|property| property.own && property.kind.is_stored())
}

fn representation_within(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Substitution,
) -> Option<HirType> {
    if path.contains(&ty) {
        return None;
    }
    path.push(ty);
    let result = representation_of(snapshot, ty, path, subst);
    path.pop();
    result
}

/// What a tuple represents as.
///
/// Two answers, and the difference is whether the elements agree.
///
/// A tuple whose elements share a representation *is* an array of it:
/// `[number, number]` is two doubles in a row, which is what `number[]` is, and
/// what the tuple adds is a length -- which is not part of a representation.
///
/// A heterogeneous one is a struct with positional fields, which needs a layout
/// rather than an element type. `layout_of` builds it, and it is a reference
/// like any other object. Before that existed this was refused, at a cost of 40
/// refusals in the node profile -- 38 of them a `Map` value, where naming the
/// argument is what made them visible at all.
fn tuple_representation(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    elements: &[TypeId],
    path: &mut Vec<TypeId>,
    subst: &Substitution,
) -> Option<HirType> {
    let mut shared: Option<HirType> = None;
    let mut mixed = false;
    for element in elements {
        let element = representation_within(snapshot, *element, path, subst)?;
        match &shared {
            Some(existing) if *existing != element => mixed = true,
            _ => shared = Some(element),
        }
    }
    if mixed || shared.is_none() {
        return Some(HirType::Managed(ManagedType::Object(ty)));
    }
    Some(HirType::Managed(ManagedType::Array(Box::new(shared?))))
}

fn representation_of(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Substitution,
) -> Option<HirType> {
    let record = snapshot.types.get(ty.0 as usize)?;
    Some(match &record.kind {
        TypeKind::Unknown => HirType::Erased,
        TypeKind::Void | TypeKind::Undefined => HirType::Void,
        TypeKind::Never => HirType::Never,
        // A literal shares its widened type's representation. The literal *value*
        // is still known and can become an immediate; what it cannot have is a
        // representation narrower than the type it widens to.
        TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => HirType::Bool,
        TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => HirType::NUMBER,
        // `bigint` is an exact integer, and TypeScript keeps it apart from
        // `number` for us: mixing the two is a type error the checker has
        // already rejected, so nothing here has to guard the arithmetic against
        // a double turning up in it.
        //
        // 128 bits, which is not what the specification says. See
        // `lower_bigint`, where the boundary is drawn and made visible.
        TypeKind::BigInt | TypeKind::Literal(LiteralValue::BigInt(_)) => HirType::BigInt,
        TypeKind::String | TypeKind::Literal(LiteralValue::String(_)) => {
            HirType::Managed(ManagedType::String)
        }
        TypeKind::Array(element) => {
            let element = representation_within(snapshot, *element, path, subst)?;
            HirType::Managed(ManagedType::Array(Box::new(element)))
        }
        // A function value is an object with one method, which is why it shares
        // this arm rather than getting one. That is not a trick to make it fit:
        // a closure *is* captured state plus code, which is what an object is,
        // and saying so means it gets the object machinery -- a base-first
        // layout, escape analysis that keeps it in the frame when it does not
        // escape, reference counting, and dispatch -- rather than a second
        // mechanism that would need all four again.
        //
        // The layout for the function type itself has no fields. What varies
        // between two closures of one type is what they captured, and that
        // belongs to the closure's own class, which has this one as its base.
        // `Promise<T>`, recognized by name the way the rest of the provided
        // surface is. The same caveat applies as for `Math`: a program that
        // declared its own `Promise` would be mis-read, and the principled
        // version is `docs/any-unknown.md`'s profiles, which tie a trusted
        // *declaration identity* to compiler-owned semantics.
        //
        // The payload comes from the checker's type arguments rather than from
        // the return annotation, so an inferred `Promise<number>` works as well
        // as a written one. `Promise` with no argument is `Promise<void>`,
        // which is what an `async` function with no `return` has.
        TypeKind::Object { .. } | TypeKind::Structured { .. }
            if named(snapshot, ty) == Some("Promise") =>
        {
            // No recorded argument is *not* `Promise<void>`. `Promise<void>`
            // has one argument and it is `void`; none at all means the
            // frontend did not get them -- it stops at the library boundary,
            // and a file large enough to exhaust its type budget stops
            // earlier still.
            //
            // Defaulting to `void` was a guess that reads as an answer: every
            // payload became nothing, the settle discarded the value, and the
            // resumption read a slot that was never filled. Refusing says so.
            let argument = *snapshot
                .type_arguments
                .get(&ty)
                .and_then(|arguments| arguments.first())?;
            let payload = representation_within(snapshot, argument, path, subst)?;
            HirType::Managed(ManagedType::Promise(Box::new(payload)))
        }
        // `Map<K, V>` and `Set<T>`, recognized the same way and stopping at the
        // library boundary for the same reason -- decomposing one would pull in
        // `forEach`, `entries` and the rest of a type this compiler represents
        // itself.
        //
        // Both arguments are required, and a missing one refuses rather than
        // defaulting, exactly as the promise above does. A `Map` whose key
        // representation was guessed would hash with the wrong function and
        // find nothing, which is the kind of wrong that looks like an empty
        // table rather than like a bug.
        TypeKind::Object { .. } | TypeKind::Structured { .. }
            if named(snapshot, ty) == Some("Map") =>
        {
            let arguments = snapshot.type_arguments.get(&ty)?;
            let key = representation_within(snapshot, *arguments.first()?, path, subst)?;
            let value = representation_within(snapshot, *arguments.get(1)?, path, subst)?;
            HirType::Managed(ManagedType::Map(Box::new(key), Box::new(value)))
        }
        TypeKind::Object { .. } | TypeKind::Structured { .. }
            if named(snapshot, ty) == Some("Set") =>
        {
            let arguments = snapshot.type_arguments.get(&ty)?;
            let element = representation_within(snapshot, *arguments.first()?, path, subst)?;
            HirType::Managed(ManagedType::Set(Box::new(element)))
        }
        // A class that extends a typed array and adds no storage of its own
        // *is* that typed array. `Buffer extends Uint8Array` is the whole of
        // this in the node profile -- it declares methods and not one field, so
        // an instance is an `NtsArray` of bytes and nothing else.
        //
        // Giving it an object layout instead is what the refusal above
        // `representable_bases` describes: `class Bytes extends Uint8Array {}`
        // came out as five `int32_t` and no bytes, and `b.length` read the
        // fifth field of a struct nothing allocates.
        //
        // A subclass that declares a field is a different type and stays
        // refused. An array's items are inline and variable-length, so there is
        // nowhere to put one -- that is a real layout question and not this
        // one.
        TypeKind::Object { properties } => match inherited_typed_array(snapshot, ty) {
            Some(element) if !declares_storage(properties) => {
                HirType::Managed(ManagedType::Array(Box::new(element)))
            }
            _ => HirType::Managed(ManagedType::Object(ty)),
        },
        TypeKind::Function(_) => HirType::Managed(ManagedType::Object(ty)),

        // A tuple whose elements share a representation *is* an array of that
        // representation. `[number, number]` is two doubles in a row, which is
        // what `number[]` is -- what the tuple adds is a length, and a length is
        // not part of a representation.
        //
        // A heterogeneous tuple is a struct with positional fields, which is a
        // different thing: it needs a layout rather than an element type, and
        // it is refused rather than approximated by the widest member.
        TypeKind::Tuple(elements) => tuple_representation(snapshot, ty, elements, path, subst)?,

        // A union whose members all share one representation has that
        // representation. `0 | 1 | 2` is three literal types and one machine
        // type, and refusing it would reject the most useful thing TypeScript
        // can tell this compiler about a parameter.
        //
        // `T | undefined` and `T | null` are what real TypeScript is made of,
        // and for a managed `T` they cost nothing: a reference already has a
        // value that is not an object, and the null pointer is it. So the
        // absent member is dropped and what is left has to agree.
        //
        // *One* absent member. `T | null | undefined` has two, and a pointer
        // has one spare value to spend on them -- so representing it as one
        // made `null === undefined` answer `true`, which is a wrong answer
        // rather than a missing feature, and the profile writes that union
        // thirty-eight times. Two absent members go to an erased value, where
        // each has a tag of its own.
        //
        // A number has no spare value. `number | undefined` needs a tag beside
        // it or a NaN payload inside it, and both change the representation of
        // every number that could reach the slot — so it is refused rather than
        // guessed at, as is any union whose members genuinely disagree.
        TypeKind::Union(members) => {
            let mut shared: Option<HirType> = None;
            // Which absences are present, not how many members carry them:
            // `void` and `undefined` are the same value, so a union with both
            // still has one.
            let mut has_null = false;
            let mut has_undefined = false;
            let mut mixed = false;
            for member in members {
                match absence_of_member(snapshot, *member) {
                    Some(Absence::Null) => {
                        has_null = true;
                        continue;
                    }
                    Some(Absence::Undefined) => {
                        has_undefined = true;
                        continue;
                    }
                    None => {}
                }
                // Each member still has to have a representation of its own:
                // erasing something is putting it in a payload, and a member
                // with no representation has nothing to put there.
                let member = representation_within(snapshot, *member, path, subst)?;
                match &shared {
                    Some(existing) if *existing != member => mixed = true,
                    _ => shared = Some(member),
                }
            }
            // Nothing left to be: `null | undefined` on its own.
            let shared = shared?;
            // One representation, and at most one absence for the null pointer
            // to stand for. Two absences need two values and a pointer has one.
            let absences = usize::from(has_null) + usize::from(has_undefined);
            let absence_has_a_home = absences == 0 || (absences == 1 && shared.is_managed());
            if !mixed && absence_has_a_home {
                return Some(shared);
            }
            // Otherwise a tag says which -- two representations, or an absence
            // a scalar has no room for.
            //
            // This is the same value `unknown` lowers to, and deliberately: a
            // heterogeneous union is a *closed* erased value where `unknown` is
            // the open one, and the difference is what the checker knows rather
            // than what the machine holds. `Erase`, `TagOf`, `Unerase`, the
            // collector's erased slots and both specialization passes apply
            // unchanged -- so `number | undefined` costs what it costs and
            // nothing new had to be built for it.
            //
            // The tag domain being smaller than five is not exploited yet. It
            // is what would let `number | undefined` be a double and a bit
            // rather than a double and a word, and it is the same question
            // specialization asks.
            HirType::Erased
        }

        // A type parameter has no representation of its own -- that is what
        // makes it one. It has the representation of whatever this instantiation
        // put there, and outside an instantiation there is nothing to say.
        // The polymorphic `this`, which TypeScript models as a type parameter
        // named after its class and constrained to it. `ref(): this` is the
        // fluent-interface shape and it is everywhere in a stream API: 62
        // refusals across 17 classes in the node profile, `Socket`, `Server`,
        // `Readable` and `Buffer` among them.
        //
        // Its representation is the receiver's, exactly. `this` in a method of
        // `Socket` is a `Socket` pointer, and in a subclass it is a pointer to
        // the subclass -- which under base-first layout is the same pointer and
        // is the rule `verify::compatible` already applies to a return, a store
        // and a call argument. So this is not an approximation of the
        // polymorphism; it is what the polymorphism costs at run time, which is
        // nothing.
        //
        // A genuine type parameter still goes through the substitution below.
        // The two are told apart by the name: `<T extends Socket>` is named `T`
        // and this is named `Socket`.
        TypeKind::TypeParameter {
            name,
            constraint: Some(constraint),
        } if named(snapshot, *constraint) == Some(name.as_str()) => {
            representation_within(snapshot, *constraint, path, subst)?
        }
        TypeKind::TypeParameter { .. } => subst.get(&ty)?.clone(),

        // The named types this compiler provides rather than reads. Neither
        // `Error` nor `Uint8Array` is ever decomposed -- see `super::builtin`
        // for why the first cannot be -- so both arrive structured and would
        // otherwise have no representation at all.
        TypeKind::Structured { .. } => {
            let name = named(snapshot, ty)?;
            if let Some(element) = super::builtin::typed_array_element(name) {
                HirType::Managed(ManagedType::Array(Box::new(element)))
            } else if super::builtin::is_error(name) {
                HirType::Managed(ManagedType::Object(ty))
            } else {
                return None;
            }
        }

        // `any` and `unknown` fall here and are refused, which is right for one
        // of them and wrong for the other.
        //
        // `docs/any-unknown.md` settles it: `any` is not a runtime type at all
        // and none may reach MIR — application `any` is rejected, while
        // declaration-originated `any` (from `lib.*.d.ts` or `@types`) is tracked
        // as *unchecked* rather than rejected, so the ecosystem stays usable.
        // `unknown`, by contrast, is a fully supported top type that "must not be
        // rejected merely because it requires an erased representation", and its
        // representation is chosen by whole-program analysis — a primitive, a
        // managed reference, a closed union, a handle, or a general erased value,
        // whichever is cheapest across all reachable uses.
        //
        // Refusing `unknown` therefore rejects valid programs today. Implementing
        // it needs the provenance tracking and representation analysis that
        // document describes, not another arm in this match.
        _ => return None,
    })
}

/// A block under construction.
struct PartialBlock {
    params: Vec<ValueId>,
    ops: Vec<ValueId>,
    /// `None` until the block is terminated. A block that reaches its end without
    /// one is still open and will be given a jump or a return.
    terminator: Option<Terminator>,
}

/// Builds one function.
/// A construct `break` can leave.
///
/// A loop is one and so is a `switch`, and the difference between them is
/// exactly `continue`: a loop has a latch to restart, a switch has none, and a
/// `continue` written inside a switch belongs to the loop around it.
/// The array method a name spells, for the three compiled as a loop.
///
/// `xs.forEach(f)` where `f` is a *variable* is a genuine dispatch and is not
/// one of these -- the caller checks that the argument is an arrow written at
/// the call site before taking this path.
/// A method on an array of numbers: the runtime function, how many arguments
/// follow the receiver, and what it evaluates to.
///
/// `absent_result` is the checker having left the `undefined` in. `pop`, `shift`
/// and `at` each have a form that can say `undefined` and a form that cannot,
/// and the one that cannot is what a caller who has narrowed it away gets.
fn numeric_array_method(
    name: &str,
    absent_result: bool,
    array: &HirType,
) -> Option<(&'static str, usize, HirType)> {
    Some(match name {
        "pop" if absent_result => ("nts_array_pop_value", 0, HirType::Erased),
        "pop" => ("nts_array_pop", 0, HirType::NUMBER),
        "shift" if absent_result => ("nts_array_shift_value", 0, HirType::Erased),
        "shift" => ("nts_array_shift", 0, HirType::NUMBER),
        "at" if absent_result => ("nts_array_at_value", 1, HirType::Erased),
        "at" => ("nts_array_at", 1, HirType::NUMBER),
        "indexOf" => ("nts_array_index_of", 1, HirType::NUMBER),
        "lastIndexOf" => ("nts_array_last_index_of", 1, HirType::NUMBER),
        "includes" => ("nts_array_includes", 1, HirType::Bool),
        "concat" => ("nts_array_concat", 1, array.clone()),
        "fill" => ("nts_array_fill", 1, array.clone()),
        "reverse" => ("nts_array_reverse", 0, array.clone()),
        "slice" => ("nts_array_slice", 2, array.clone()),
        "splice" => ("nts_array_splice", 2, array.clone()),
        _ => return None,
    })
}

fn iteration_method(name: &str) -> Option<Iteration> {
    Some(match name {
        "forEach" => Iteration::ForEach,
        "map" => Iteration::Map,
        "reduce" => Iteration::Reduce,
        "some" => Iteration::Any,
        "every" => Iteration::All,
        "findIndex" => Iteration::FindIndex,
        "filter" => Iteration::Filter,
        "find" => Iteration::Find,
        _ => return None,
    })
}

/// What a loop does between one iteration and the next.
///
/// Three shapes rather than an `Option<NodeId>`, because an array method
/// compiled as a loop steps an index the source never wrote, and there is no
/// node to point at. It used to step at the end of the *body* instead, which
/// works right up until something jumps to the latch -- a `return` inside the
/// callback did, and the loop never finished.
#[derive(Clone)]
enum Step {
    /// Nothing between iterations; the header is the latch.
    None,
    /// A source expression, as `for (;; i++)` writes it.
    Expression(NodeId),
    /// One added to a carried name, for a loop this compiler synthesized.
    Increment(u32),
    /// The cursor of a `for...of`, advanced the way its walk requires.
    ///
    /// In the latch rather than at the end of the body, which is the whole
    /// point: `continue` jumps to the latch, and a step written into the body
    /// is a step `continue` skips. That was true of `for...of` over an array
    /// from the beginning and nothing in the suite wrote one, so it hung
    /// rather than failed.
    Walk {
        cursor: u32,
        walk: Walk,
        sequence: ValueId,
    },
}

/// What an `async` function returns, and what it settles with.
#[derive(Clone)]
struct AsyncResult {
    /// The promise allocated on entry. Every `return` settles this one and
    /// hands it back, so the function's HIR return type is the promise rather
    /// than the payload.
    promise: ValueId,
    /// The payload's representation, which is what says whether settling emits
    /// `nts_promise_fulfill_number`, `_reference` or `_void`.
    payload: HirType,
}

/// What `resolve` or `reject` names inside a `new Promise` executor.
///
/// The executor runs *synchronously* -- `new Promise(f)` calls `f` before it
/// returns -- so its body is lowered at the construction site and these two
/// names are not values at all. A call to one is the settle it stands for.
#[derive(Clone)]
struct Settler {
    /// The promise being constructed, and the payload it settles with.
    result: AsyncResult,
    /// `reject` rather than `resolve`.
    rejects: bool,
}

/// An array method that is a loop with the callback's body inlined.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Iteration {
    ForEach,
    Map,
    Reduce,
    /// `some`. Spelled `Any` because `Some` is taken by the language.
    Any,
    /// `every`.
    All,
    /// `findIndex`.
    FindIndex,
    /// `filter`.
    Filter,
    /// `find`.
    Find,
}

impl Iteration {
    /// What the source calls it, for a diagnostic that names the method the
    /// author wrote rather than the shape this compiler turned it into.
    const fn name(self) -> &'static str {
        match self {
            Self::ForEach => "forEach",
            Self::Map => "map",
            Self::Reduce => "reduce",
            Self::Any => "some",
            Self::All => "every",
            Self::FindIndex => "findIndex",
            Self::Filter => "filter",
            Self::Find => "find",
        }
    }

    /// How many callback parameters this lowering binds.
    ///
    /// The index and the array are the ones every callback of these *may*
    /// take, and neither is bound: the index would need the loop counter's
    /// identity to survive into the body, and this has no test for that yet.
    const fn parameters(self) -> usize {
        match self {
            Self::ForEach
            | Self::Map
            | Self::Any
            | Self::All
            | Self::FindIndex
            | Self::Filter
            | Self::Find => 1,
            Self::Reduce => 2,
        }
    }
}

/// What becomes of the value an inlined callback body produces.
///
/// The whole difference between the three methods, which is why it is one type
/// rather than a branch in three places -- and why a `return` inside a block
/// body works the same in all three: it delivers through this before it jumps.
#[derive(Clone, Copy)]
enum CallbackResult {
    /// `forEach`, whose callback returns `void`. TypeScript still allows
    /// `return e` there, contextually typed as void, so the value is lowered
    /// for its effects and then dropped rather than refused.
    Discard,
    /// `reduce`: it becomes the accumulator, which the loop carries.
    Accumulate(u32),
    /// `map`: it is stored at the current index of the array allocated before
    /// the loop.
    Store { array: ValueId, index: u32 },
    /// `some` and `every`: it decides whether to stop.
    ///
    /// Both are the same loop asking the same question and differ only in
    /// which answer ends it -- `some` stops at the first `true` and is `false`
    /// if it never does, `every` stops at the first `false` and is `true`. So
    /// `exits_on` is both the value that breaks and the value the result takes
    /// when it breaks, and the seed is its negation.
    Decide { symbol: u32, exits_on: bool },
    /// `findIndex`: the index the first `true` was reached at.
    ///
    /// The seed is `-1`, which is the answer for an array that never decides
    /// and is what the method returns for one -- so the loop-carried name needs
    /// no separate "was it found" beside it.
    Locate { symbol: u32, index: u32 },
    /// `filter`: the element is kept when the value is true.
    ///
    /// `element` is the value itself rather than the name bound to it. A
    /// callback may assign to its own parameter, and `filter` keeps what the
    /// array held either way.
    ///
    /// `push` because the result is allocated with room and no length -- see
    /// [`FuncBuilder::iteration_result_array`] -- so appending is what writing
    /// a kept element *is*, and the count the two paths would otherwise
    /// disagree about lives in the array instead.
    Keep {
        array: ValueId,
        element: ValueId,
        push: &'static str,
    },
}

/// Where a `return` inside an inlined callback body goes.
#[derive(Clone, Copy)]
struct CallbackReturn {
    /// The synthesized loop, as a depth into `breakables`. A `return` leaves
    /// the *iteration*, which is what `continue` does, so it goes to the latch.
    depth: usize,
    /// What the method does with the value.
    result: CallbackResult,
}

#[derive(Debug, Clone)]
struct Breakable {
    /// The block after the construct, and its parameters — **created on first
    /// use**.
    ///
    /// A construct nothing leaves has no block after it. `for (;;) { return }`
    /// is the plain case, and a `switch` whose every clause returns is another.
    /// Allocating an exit for those would leave a block no edge reaches, which
    /// is invalid SSA rather than merely dead code — the verifier says so, and
    /// it was saying so about infinite loops before this was lazy.
    exit: Option<(BlockId, Vec<ValueId>)>,
    /// What an exit parameter would be typed, per carried name, and where to
    /// say it came from when one is finally made.
    exit_types: Vec<HirType>,
    origin: Origin,
    /// Where `continue` goes, for the things that have one.
    latch: Option<BlockId>,
    /// The symbols this construct carries, in parameter order.
    carried: Vec<u32>,
    /// The label written on this construct, if it has one.
    ///
    /// `break outer` names a construct rather than taking the innermost one,
    /// and this is what it names. By text, because a label is not a binding:
    /// the checker gives it no symbol, so there is no id to match on. Nesting
    /// makes that safe -- the innermost construct carrying the name is the one
    /// the name refers to, which is what `rposition` finds.
    label: Option<String>,
    /// How deep the exit stack was when this construct began.
    ///
    /// A `break` leaves every `try` between it and here, so it has to run the
    /// `finally` of each -- and this is what says which those are.
    exits_at: usize,
}

/// One loop under construction: where it jumps back to, where it leaves
/// through, and what it carries between the two.
#[derive(Debug, Clone)]
struct Loop {
    header: BlockId,
    body: BlockId,
    /// Where this loop sits on the enclosing-construct stack, which is how its
    /// exit is reached: the exit is created on demand and shared, so it lives
    /// there rather than here.
    depth: usize,
    /// Where an iteration *ends*, and so where `continue` goes.
    ///
    /// The header for a loop with no update. For `for (;; i++)` it is a block
    /// of its own that runs the update before jumping back, because `continue`
    /// must not skip it — `for (;; i++) { continue; }` that jumped straight to
    /// the header would never step and never finish.
    latch: BlockId,
    /// The latch's parameters, when it is a block of its own.
    latch_params: Vec<ValueId>,
    /// The symbols the loop carries, in parameter order.
    carried: Vec<u32>,
    /// Each carried name's value at the top of an iteration.
    header_params: Vec<ValueId>,
}

/// One reason a `try` has to be noticed while the statements inside it lower.
///
/// A `catch` *stops* a `throw`; a `finally` is *run through* by every way out.
/// One stack rather than two, because interleaving them is exactly what leaving
/// a `try` has to get right: a `throw` runs the `finally`s above the nearest
/// `catch` and stops there, a `return` runs every one of them, and a `break`
/// runs the ones that are inside its loop.
enum Exit {
    Handler(Handler),
    /// A `finally` body, lowered again at each way out of its `try`.
    ///
    /// Duplicated rather than shared. Sharing it needs a variable saying where
    /// to continue afterwards and a switch on that variable at the bottom --
    /// a branch per exit, and a value carried to feed it -- where duplication
    /// is a second copy of a block that is usually three lines. It is also the
    /// only version that composes with `return`, which has to run the body and
    /// then leave rather than come back.
    Finally(NodeId),
}

/// A `try` whose body is being lowered, and every `throw` that has reached it.
struct Handler {
    /// The block the handler's code will go in, once something needs one.
    ///
    /// Created by the first `throw` rather than by the `try`, because a body
    /// that cannot throw should leave nothing behind: a block with no
    /// predecessors is one the verifier rejects, and creating it eagerly meant
    /// every defensive `try` around code that cannot throw produced an invalid
    /// function.
    block: Option<BlockId>,
    /// One per `throw` in the body, in the order they were lowered.
    edges: Vec<Edge>,
}

/// One `throw`'s jump into a handler, before the handler has parameters.
struct Edge {
    /// The block the `throw` ended.
    from: BlockId,
    /// The thrown value, already erased.
    thrown: ValueId,
    /// What every name held at the `throw`.
    ///
    /// Cloned rather than referenced because it is a snapshot: the body goes on
    /// being lowered after this edge is recorded, and the map keeps changing.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
}

struct FuncBuilder<'a> {
    snapshot: &'a SemanticSnapshot,
    /// Every value the function defines.
    values: Vec<Op>,
    blocks: Vec<PartialBlock>,
    current: BlockId,
    /// Symbol index → the value holding it.
    ///
    /// This is what makes two identifiers with one symbol become one value
    /// rather than two loads.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
    /// A label just read, waiting for the loop or `switch` it is written on.
    ///
    /// Read by the next construct that pushes a [`Breakable`], which is the
    /// one immediately inside the label -- [`Self::lower_labeled`] refuses a
    /// label on anything else, so there is nothing else it could reach.
    pending_label: Option<String>,
    /// `resolve` and `reject`, while a `new Promise` executor is being lowered.
    ///
    /// By symbol, so a name that shadows one outside the executor is unaffected
    /// and a nested `new Promise` shadows correctly -- the inner binding
    /// replaces the outer for its own symbol and nothing else.
    settlers: rustc_hash::FxHashMap<u32, Settler>,
    /// The `try` blocks this statement is inside, innermost last.
    ///
    /// On the builder and not passed down, because a `throw` can be at any
    /// depth of statement nesting below the `try` and every level between would
    /// otherwise have to carry it. Per-function by construction: a builder is
    /// one function, so a `throw` inside a closure written inside a `try` finds
    /// an empty stack -- which is correct, since the closure runs when it is
    /// called and not where it is written.
    exits: Vec<Exit>,
    /// Layouts discovered while lowering this function.
    layouts: Vec<Layout>,
    /// The receiver, in a method.
    this: Option<ValueId>,
    /// What this copy's name carries, for one instantiation of a generic
    /// The type this function's `return` statements must produce.
    ///
    /// Kept on the builder because a `return` needs it while the body is being
    /// lowered, and until now it was only known at `close_body`. A returned
    /// value is coerced to it -- `function f(): unknown { return n }` returns
    /// an erased value -- and without that the mismatch lowered with nothing
    /// refused and failed in C, because the verifier checks call arguments and
    /// not returns.
    returns: HirType,
    /// function. Empty for everything else.
    suffix: String,
    /// What each function declaration is emitted as, where its plain name is
    /// taken by another module's.
    qualified: rustc_hash::FxHashMap<NodeId, String>,
    /// What each *call* to a generic function names, by call node.
    ///
    /// A call has to reach the copy made for its own instantiation, and the
    /// copy's name is the only thing that distinguishes one from another.
    generic_calls: rustc_hash::FxHashMap<NodeId, String>,
    /// Whether this function is a constructor.
    ///
    /// The one place a `readonly` field may be written: TypeScript permits it
    /// and this compiler was refusing it, which is a refusal of valid code
    /// rather than a construct it does not understand.
    in_constructor: bool,
    /// What the module declares outside any function.
    module: ModuleScope,
    /// What every class in the program declares, and what it extends.
    hierarchy: Hierarchy,
    /// The class this method's own class extends, if it extends one.
    ///
    /// `super(...)` and `super.m()` name it, and nothing else can: the checker
    /// resolves a `super` call to the base's declaration, but the *name* of the
    /// function to emit is this compiler's own construction.
    base: Option<String>,
    /// Every arrow function in the program, so that one written here can be
    /// matched to the class that was collected for it.
    closures: Vec<ClosureInfo>,
    /// The symbols whose cell needs a `ready` flag, sorted.
    ///
    /// A subset of `boxed`: only a name declared below the closure that reads
    /// it has a window in which the cell exists and holds nothing.
    guarded: Vec<u32>,
    /// Whether the body being lowered is a closure's.
    ///
    /// The guard above is needed there and nowhere else: a direct read before a
    /// declaration in the same scope is rejected by the typechecker, so a
    /// closure body is the only way into that window.
    in_closure: bool,
    /// Every symbol some closure captures by reference, sorted.
    ///
    /// Derived from `closures` rather than passed alongside it, so the two
    /// cannot disagree. A symbol's position here is its cell's identity, and
    /// every function that mentions the variable resolves to the same one.
    boxed: Vec<u32>,
    /// What each type parameter stands for, while lowering one instantiation of
    /// a generic class. Empty everywhere else, which is every function that is
    /// not one of those copies.
    substitution: Substitution,
    /// The type a bare `null` should take, where the caller knows it.
    ///
    /// `contextual_type` recovers this from the tree for the shapes the tree
    /// describes. What it cannot reach is a call whose signature the checker
    /// resolved into `lib.d.ts` -- `piles.fill(null)` is an array method, and
    /// the parameter type is the element type this compiler decided rather
    /// than one any node carries.
    expecting: Option<HirType>,
    /// How many names this lowering has invented.
    ///
    /// A `for...of` needs an index the source does not name, and the loop
    /// machinery is keyed by symbol. Numbering down from the top keeps a
    /// synthetic name from colliding with one the checker assigned.
    synthetic: u32,
    /// What encloses the statement being lowered, innermost last.
    ///
    /// `break` and `continue` name no target in the source, so the target is
    /// wherever they are — which is a stack rather than a value.
    breakables: Vec<Breakable>,
    /// Where a `return` goes when the body being lowered is an *inlined*
    /// callback, innermost last.
    ///
    /// An array method compiled as a loop puts the callback's body inside the
    /// caller, and a `return` there means "this element is done", not "this
    /// function is done". Lowering it as an ordinary return emitted `return;`
    /// in the middle of a function with a result -- C that clang rejects, from
    /// a lowering that reported nothing refused.
    ///
    /// Empty everywhere else, so `return` keeps its ordinary meaning outside
    /// one of these bodies.
    callback_returns: Vec<CallbackReturn>,
    /// The promise an `async` function settles, and what it settles with.
    ///
    /// Set for the whole of an `async` body and `None` everywhere else, so
    /// `return e` means "settle this and hand the promise back" there and
    /// keeps its ordinary meaning otherwise.
    async_result: Option<AsyncResult>,
    /// The frame a `function*` yields into, where this is one.
    ///
    /// The mirror of `async_result` and set the same way: for the whole of a
    /// generator body and `None` everywhere else, so `yield` means something
    /// there and is refused everywhere else.
    generator: Option<super::GeneratorFrame>,
    /// Which generator each `function*` is, decided once by [`naming`].
    generators: rustc_hash::FxHashMap<NodeId, usize>,
    /// Which of them this function allocated.
    ///
    /// A closure nobody creates is not lowered at all. That is the rule
    /// module-scope declarations already follow, for the same reason: a file
    /// that declares one thing this compiler cannot represent should not be
    /// reported as failing on it unless something reaches it.
    used_closures: Vec<usize>,
}

impl<'a> FuncBuilder<'a> {
    fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self {
            snapshot,
            boxed: Vec::new(),
            guarded: Vec::new(),
            in_closure: false,
            values: Vec::new(),
            blocks: vec![PartialBlock {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: None,
            }],
            current: BlockId(0),
            bindings: rustc_hash::FxHashMap::default(),
            settlers: rustc_hash::FxHashMap::default(),
            pending_label: None,
            exits: Vec::new(),
            returns: HirType::Void,
            layouts: Vec::new(),
            this: None,
            suffix: String::new(),
            qualified: rustc_hash::FxHashMap::default(),
            generic_calls: rustc_hash::FxHashMap::default(),
            in_constructor: false,
            hierarchy: Hierarchy::default(),
            base: None,
            module: ModuleScope::default(),
            closures: Vec::new(),
            expecting: None,
            synthetic: 0,
            breakables: Vec::new(),
            callback_returns: Vec::new(),
            async_result: None,
            generator: None,
            generators: rustc_hash::FxHashMap::default(),
            used_closures: Vec::new(),
            substitution: Substitution::default(),
        }
    }

    /// The same, knowing what the module and its classes declare.
    fn within(
        snapshot: &'a SemanticSnapshot,
        module: ModuleScope,
        hierarchy: Hierarchy,
        closures: Vec<ClosureInfo>,
    ) -> Self {
        Self {
            module,
            hierarchy,
            boxed: boxed_symbols(&closures),
            guarded: guarded_symbols(&closures),
            closures,
            ..Self::new(snapshot)
        }
    }

    /// The same, lowering one instantiation of a generic class.
    fn instantiating(
        snapshot: &'a SemanticSnapshot,
        module: ModuleScope,
        hierarchy: Hierarchy,
        closures: Vec<ClosureInfo>,
        substitution: Substitution,
        suffix: String,
    ) -> Self {
        Self {
            suffix,
            substitution,
            ..Self::within(snapshot, module, hierarchy, closures)
        }
    }

    /// Add a parameter to a block and return the value it defines.
    ///
    /// A block parameter is a value like any other, but it belongs to the block
    /// rather than to the operation list — nothing computes it, a predecessor
    /// supplies it.
    fn push_block_param(&mut self, block: BlockId, ty: HirType, origin: Origin) -> ValueId {
        let index = u32::try_from(self.blocks[block.0 as usize].params.len()).unwrap_or(0);
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::BlockParam(index),
            ty,
            origin,
        });
        self.blocks[block.0 as usize].params.push(id);
        id
    }

    /// Start a new block and return its id. Does not switch to it.
    fn new_block(&mut self) -> BlockId {
        self.blocks.push(PartialBlock {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: None,
        });
        BlockId(u32::try_from(self.blocks.len() - 1).unwrap_or(u32::MAX))
    }

    fn switch_to(&mut self, block: BlockId) {
        self.current = block;
    }

    /// Whether the current block has already ended.
    ///
    /// A `return` inside a branch terminates its block, and appending a jump
    /// after it would put two terminators in one block.
    fn is_terminated(&self) -> bool {
        self.blocks[self.current.0 as usize].terminator.is_some()
    }

    /// End the current block, unless something already did.
    fn terminate(&mut self, terminator: Terminator) {
        let block = &mut self.blocks[self.current.0 as usize];
        if block.terminator.is_none() {
            block.terminator = Some(terminator);
        }
    }

    fn node(&self, id: NodeId) -> &'a nts_semantic_schema::NodeRecord {
        &self.snapshot.nodes[id.0 as usize]
    }

    fn origin(&self, id: NodeId) -> Origin {
        self.node(id).origin.clone()
    }

    fn location(&self, id: NodeId) -> Location {
        self.node(id).origin.location
    }

    /// Children, with list nodes flattened away.
    ///
    /// A `NodeList` is an encoding artifact rather than a construct, so it is not
    /// something the lowering should have to know about at every step.
    fn children(&self, id: NodeId) -> Vec<NodeId> {
        self.node(id)
            .children
            .iter()
            .flat_map(|child| {
                let node = self.node(*child);
                if node.kind == NodeKind::List {
                    node.children.clone()
                } else {
                    vec![*child]
                }
            })
            .collect()
    }

    /// The parent a child would name, with list nodes stepped over.
    ///
    /// [`Self::children`] flattens a `List` -- an argument list, a parameter
    /// list -- so a call's children are its callee and its arguments. The
    /// `parent` link does not: an argument's parent is the list, whose kind is
    /// no syntax at all. Anything that asks what encloses a node and then looks
    /// for it among that node's children has to agree with `children` about
    /// which node that is, and this is the half that was missing: every
    /// argument's parent was a `List`, so `f(null)` matched no arm of
    /// [`Self::contextual_type`] and the `null` was refused for standing in for
    /// nothing.
    fn syntactic_parent(&self, id: NodeId) -> Option<NodeId> {
        let mut at = self.node(id).parent?;
        while self.node(at).kind == NodeKind::List {
            at = self.node(at).parent?;
        }
        Some(at)
    }

    /// Every node at or below `id`, in source order.
    fn subtree(&self, id: NodeId, into: &mut Vec<NodeId>) {
        into.push(id);
        for child in self.children(id) {
            self.subtree(child, into);
        }
    }

    /// Whether an identifier names a member rather than a binding.
    ///
    /// `p.x` and `{ x: 1 }` both put a symbol on `x`, and that symbol is
    /// declared wherever the type is -- outside whatever is being scanned. So a
    /// scan for free variables has to know the difference, and the difference
    /// is entirely positional.
    fn names_a_member(&self, id: NodeId) -> bool {
        let Some(parent) = self.node(id).parent else {
            return false;
        };
        match self.kind_of(parent) {
            // `a.b` — the second child is the member. The first is an ordinary
            // read of `a`, which may well be a capture.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => self.children(parent).first() != Some(&id),
            // `{ x: v }` — the first child is the key. `{ x }` is both at once,
            // so it is not a member: it reads `x`.
            Some(syntax::PROPERTY_ASSIGNMENT) => self.children(parent).first() == Some(&id),
            _ => false,
        }
    }

    fn kind_of(&self, id: NodeId) -> Option<u16> {
        match self.node(id).kind {
            NodeKind::Syntax(kind) => Some(kind),
            NodeKind::List => None,
        }
    }

    /// What a function declaration returns.
    ///
    /// From its *signature*, not from an annotation node. Reading the annotation
    /// works for `function f(): number` and silently gives `void` for
    /// `function f()` -- so an un-annotated function had its result dropped, in
    /// the generated C and in every analysis. TypeScript infers a return type
    /// whether or not one is written down, and the inferred one is in the
    /// snapshot exactly like the written one.
    /// What a function returns, or a refusal naming what it declares.
    ///
    /// `declared_return` answers `None` to two different questions -- "declares
    /// nothing" and "declares something with no representation" -- and the
    /// callers used to default both to `void`. Only the first is void.
    ///
    /// The second built a function whose HIR said it returned nothing and whose
    /// body returned a value. `ref(): this` is the shape: TypeScript models the
    /// polymorphic `this` as a type parameter constrained to the class, which
    /// has no representation here, so the method lowered as `-> void` with `ret
    /// %0` in it and the C came out as `void FSWatcher__ref(...)` returning a
    /// pointer. Nothing caught it: the lowering reported the function as
    /// complete, and the verifier runs on the *pruned* program while an addon
    /// emits every export.
    fn return_type_of(&mut self, id: NodeId) -> Result<HirType, Diagnostic> {
        if let Some(ty) = self.declared_return(id) {
            return Ok(ty);
        }
        // Nothing representable came back. A function that genuinely returns
        // nothing is void; anything else is refused, and named.
        if let Some(ty) = self.snapshot.node_types.get(&id).copied()
            && let Some(record) = self.snapshot.types.get(ty.0 as usize)
            && let TypeKind::Function(signature) = record.kind
            && let Some(signature) = self.snapshot.signatures.get(signature.0 as usize)
        {
            let returned = signature.return_type;
            let is_nothing = matches!(
                self.snapshot
                    .types
                    .get(returned.0 as usize)
                    .map(|r| &r.kind),
                Some(TypeKind::Void | TypeKind::Undefined)
            );
            // A generator returns a `Generator<...>`, which has no
            // representation -- but refusing it here names the *consequence*
            // and buries the cause. The body's `yield` is the cause, it is
            // refused by name, and its message is the one a work-list can
            // group by. So this defers, and the `void` below never survives:
            // the `yield` refuses the function before anything reads it.
            if !is_nothing && !self.mentions(id, syntax::YIELD_EXPRESSION) {
                let what = describe(self.snapshot, returned);
                return Err(self.unsupported(id, &format!("a function returning {what}")));
            }
        }
        Ok(HirType::Void)
    }

    /// Whether a node's subtree contains one of a kind.
    ///
    /// Bounded by the subtree rather than by depth: a function body is the only
    /// thing this is asked about, and it is asked once, on a path that is about
    /// to refuse anyway.
    fn mentions(&self, id: NodeId, kind: u16) -> bool {
        if self.kind_of(id) == Some(kind) {
            return true;
        }
        self.children(id)
            .into_iter()
            .any(|child| self.mentions(child, kind))
    }

    /// What a call through this closure *value* produces.
    ///
    /// From the callee's own function type rather than from the call
    /// expression's type, and the difference is load-bearing for `f?.(x)`: the
    /// expression is `T | undefined`, because the `?.` can skip the call, and
    /// the call itself still returns `T`. Spelling the expression's type as the
    /// call's result cast a `double`-returning implementation to one returning
    /// `NtsValue`, and the answer came back as the bit pattern of a struct.
    fn returned_by(&self, callee: ValueId) -> Option<HirType> {
        let HirType::Managed(ManagedType::Object(ty)) = self.values[callee.0 as usize].ty else {
            return None;
        };
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let nts_semantic_schema::TypeKind::Function(signature) = record.kind else {
            return None;
        };
        let signature = self.snapshot.signatures.get(signature.0 as usize)?;
        self.represent(signature.return_type)
    }

    fn declared_return(&self, id: NodeId) -> Option<HirType> {
        if let Some(ty) = self.snapshot.node_types.get(&id)
            && let Some(record) = self.snapshot.types.get(ty.0 as usize)
            && let nts_semantic_schema::TypeKind::Function(signature) = record.kind
            && let Some(signature) = self.snapshot.signatures.get(signature.0 as usize)
            && let Some(returned) = self.represent(signature.return_type)
        {
            return Some(returned);
        }

        // No decomposed signature. That does not happen under the frontend
        // configuration the compiler uses, and does happen under a lighter one,
        // so the written annotation is read instead -- which is what this did
        // before, and is right whenever there is one.
        let body = self
            .children(id)
            .into_iter()
            .rev()
            .find(|child| self.kind_of(*child) == Some(syntax::BLOCK));
        // Whatever is neither the name, a parameter, nor the body. By node
        // rather than by kind: `set ["size"](n: number)` has no return
        // annotation at all, and reading its name as one gave the setter a
        // `number` return it never produces -- which the emitter honestly
        // rendered as a store followed by `__builtin_unreachable()`, and the C
        // compiler then took as a licence to compute anything at all in the
        // caller.
        let name = self.name_node(id);
        self.children(id)
            .into_iter()
            .filter(|child| {
                self.kind_of(*child) != Some(syntax::PARAMETER)
                    && Some(*child) != body
                    && Some(*child) != name
            })
            .find_map(|child| self.type_of(child))
    }

    /// Make sure an object type has a layout, because a signature mentions it.
    ///
    /// A layout is otherwise discovered by whatever *constructs* the object,
    /// and a function that only receives or returns one constructs nothing. A
    /// function type is the case that made this visible: no program ever
    /// constructs a signature, only closures that have it as their base.
    fn materialize(&mut self, at: NodeId, ty: &HirType) -> Result<(), Diagnostic> {
        self.materialize_within(at, ty, 0)
    }

    /// Every layout a type needs, not only its own.
    ///
    /// An array of objects needs one for its element as much as for itself, and
    /// the layout it is missing belongs to a type no *function* mentioned.
    ///
    /// Through *containers* and not through an object's fields. Recursing into
    /// fields as well demanded a layout for every field type whether or not
    /// anything reads it, which refused a class for holding a `Map` it never
    /// touches -- 81 functions in the node profile, to fix nothing: the case
    /// that prompted it was not reached this way either.
    ///
    /// Bounded rather than tracked: a field may hold the type it belongs to,
    /// and a list node is the ordinary case rather than a strange one. The
    /// depth is a backstop, not a limit -- the work is idempotent, so a type
    /// reached twice is a lookup and not a rebuild.
    fn materialize_within(
        &mut self,
        at: NodeId,
        ty: &HirType,
        depth: u32,
    ) -> Result<(), Diagnostic> {
        if depth > 16 {
            return Ok(());
        }
        match ty {
            HirType::Managed(ManagedType::Object(object)) => {
                self.layout_of(at, *object)?;
            }
            HirType::Managed(ManagedType::Array(element)) => {
                self.materialize_within(at, element, depth + 1)?;
            }
            HirType::Managed(ManagedType::Promise(payload)) => {
                self.materialize_within(at, payload, depth + 1)?;
            }
            _ => {}
        }
        Ok(())
    }

    /// Whether an expression's type is a signature -- so its value is a closure.
    fn is_function_typed(&self, id: NodeId) -> bool {
        self.snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
    }

    /// What `typeof` answers for a value, where its representation fixes it.
    ///
    /// A *declared* signature keeps its TypeScript type id rather than a
    /// synthetic closure one -- `cb?: (x: number) => number` is stored as the
    /// function type itself -- so the closure-id test alone calls it an object.
    /// It is the same value either way, and `typeof` says `"function"` for
    /// both. A synthetic id is above every real one, so the lookup simply
    /// misses for cells, frames and closures, and the free function answers.
    fn spelling_for(&self, ty: &HirType) -> Option<&'static str> {
        if let HirType::Managed(ManagedType::Object(id)) = ty
            && self
                .snapshot
                .types
                .get(id.0 as usize)
                .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
        {
            return Some("function");
        }
        spelling_of(ty)
    }

    /// Whether a callee names a function or class declaration rather than a
    /// value that happens to hold one.
    ///
    /// This is what separates `f(x)` the static call from `f(x)` the dispatch,
    /// and it is a question about the *declaration*, not about the spelling. A
    /// name with no declaration at all is one this compilation cannot see, which
    /// means an import: a direct call to a definition the linker supplies.
    fn names_a_declared_function(&self, id: NodeId) -> bool {
        let Some(symbol) = self.node(id).symbol else {
            return false;
        };
        // A local binding shadows nothing here -- a parameter and a function
        // declaration never share a symbol -- but if the name is bound to a
        // value in this frame, that value is what is being called.
        if self.bindings.contains_key(&symbol.0) {
            return false;
        }
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return false;
        };
        record.declarations.is_empty()
            || record.declarations.iter().any(|declaration| {
                matches!(
                    self.kind_of(*declaration),
                    Some(
                        syntax::FUNCTION_DECLARATION
                            | syntax::CLASS_DECLARATION
                            | syntax::METHOD_DECLARATION
                            | syntax::METHOD_SIGNATURE
                    )
                )
            })
    }

    fn type_of(&self, id: NodeId) -> Option<HirType> {
        let ty = self.snapshot.node_types.get(&id)?;
        self.represent(*ty)
    }

    /// A type's machine representation, with this instantiation's substitution
    /// applied. The one place the two are combined.
    fn represent(&self, ty: TypeId) -> Option<HirType> {
        representation_with(self.snapshot, ty, &self.substitution)
    }

    fn push(&mut self, kind: OpKind, ty: HirType, origin: Origin) -> ValueId {
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op { kind, ty, origin });
        self.blocks[self.current.0 as usize].ops.push(id);
        id
    }

    /// Refuse, naming the type that could not be represented.
    fn unrepresentable(&self, id: NodeId, what: &str) -> Diagnostic {
        let named = self.snapshot.node_types.get(&id).map_or_else(
            || "an untyped node".to_owned(),
            |ty| describe(self.snapshot, *ty),
        );
        self.unsupported(id, &format!("{what} of unrepresentable type ({named})"))
    }

    /// The same, for a type that is not the node's own.
    ///
    /// A layout fails on one of its *properties*, and the node it fails at is
    /// whatever asked for the layout — a `new` expression, a parameter. Naming
    /// the node's type there describes the class and not the property, so
    /// `context: unknown` was reported as "a property of unrepresentable type
    /// (an object type)" — which reads as though records could not nest, and
    /// cost a reader a day.
    fn unrepresentable_member(&self, id: NodeId, what: &str, name: &str, ty: TypeId) -> Diagnostic {
        let named = describe(self.snapshot, ty);
        self.unsupported(
            id,
            &format!("{what} `{name}` of unrepresentable type ({named})"),
        )
    }

    /// The symbol a name ultimately denotes, following an import alias.
    ///
    /// Every reference to an imported name resolves to a symbol declared at the
    /// *import site*, not to the declaration it stands for. Module scope is
    /// keyed by the declaration, so a read of an imported value used to look
    /// itself up, find nothing, and be refused as a name from an enclosing
    /// scope -- the refusal that made the temporal dead zone unreachable.
    ///
    /// The frontend follows the whole chain, so this is one hop in every case
    /// it has produced. The loop is a bound rather than an algorithm: a
    /// self-referential chain would be a bug in the frontend, and a lowering
    /// should refuse such a program rather than hang on it.
    fn denoted_symbol(&self, symbol: SymbolId) -> SymbolId {
        let mut at = symbol;
        for _ in 0..8 {
            match self.snapshot.symbols[at.0 as usize].aliased {
                Some(next) => at = next,
                None => return at,
            }
        }
        at
    }

    /// What kind of name the lowering ran out of places to look for.
    ///
    /// This used to be one message — `a name declared outside this function` —
    /// for every name that was not a local, not a module constant and not a
    /// module variable. It was the largest single refusal in the corpus at 12
    /// files, which made it look like the most valuable thing to implement, and
    /// it is not a thing at all: a namespace, a global this runtime does not
    /// provide, and a variable captured from an enclosing function are three
    /// features, and counting them together ranks none of them.
    ///
    /// The symbol says which. `declarations` is empty exactly when the symbol
    /// was declared outside the decoded file set, which is what separates
    /// `console` from a name the program itself wrote.
    fn describe_name(&self, id: NodeId, symbol: SymbolId) -> String {
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return "an unresolved name".to_owned();
        };
        let is = |flag: SymbolFlags| record.flags.contains(flag);
        // A class this compiler provides, reached as a *value*. `Error` is a
        // class here and not a constructor object, so `Error.captureStackTrace`
        // fails on the name -- and reporting the name as unprovided is wrong
        // twice over, since `Error` is provided and the member is what is not.
        // Reported by the Node session, who had just written `class MyError
        // extends Error` and seen it work.
        if super::builtin::is_error(&record.name)
            || super::builtin::typed_array_element(&record.name).is_some()
        {
            let name = &record.name;
            return match self.member_read_from(id) {
                Some(member) => {
                    format!("`{name}.{member}`, not a member of this compiler's `{name}`")
                }
                None => format!("`{name}` used as a value rather than as a type"),
            };
        }
        if is(SymbolFlags::MODULE) {
            return format!("`{}`, a namespace", record.name);
        }
        if is(SymbolFlags::ENUM) {
            // A *member* access is a constant and is lowered as one. Reaching
            // here means the enum itself is wanted as an object -- which is
            // `Colour[1]`, the reverse mapping, and that needs the table a
            // plain enum emits alongside its members. Saying which keeps this
            // from reading as "enums are unsupported", which they are not.
            return format!(
                "`{}` as an object rather than a member, which is the reverse mapping",
                record.name
            );
        }
        if record.declarations.is_empty() {
            // Nothing in the compiled set declares it, so it is a global the
            // host is expected to have. Which one matters: `Math` is a table of
            // functions this compiler could provide, and `document` is not.
            //
            // So `Math` names the member, the way `Error` does above. The
            // corpus reported `Math.random()` as "`Math`, a global with no
            // definition here" -- true, and not the reason: `Math` is provided
            // and `random` is the part that is not. It is absent deliberately,
            // being the one member of the family no differential can check.
            if record.name == "Math"
                && let Some(member) = self.member_read_from(id)
            {
                return format!("`Math.{member}`, not a member of this compiler's `Math`");
            }
            // With the member, when one is being read. `Object` was 44
            // refusals that could not be told apart, and they are not one
            // thing: `Object.keys` is a list the compiler is holding and
            // `Object.defineProperty` is a shape it does not have.
            if let Some(member) = self.member_read_from(id) {
                return format!(
                    "`{}.{member}`, a global member with no definition here",
                    record.name
                );
            }
            return format!("`{}`, a global with no definition here", record.name);
        }
        // `resolve` and `reject` are not values. The executor's body is lowered
        // where the promise is built, so a call to one is the settle it stands
        // for -- and there is nothing to hand to anything that wants it as a
        // function. Saying so beats "a name from an enclosing scope", which is
        // true of the symbol and says nothing about why.
        if self
            .node(id)
            .symbol
            .is_some_and(|symbol| self.settlers.contains_key(&symbol.0))
        {
            return format!(
                "`{}` used as a value rather than called, which needs the executor to be a \
                 real closure over the promise",
                record.name
            );
        }
        if is(SymbolFlags::FUNCTION) {
            return format!("`{}`, a function used as a value", record.name);
        }
        if is(SymbolFlags::CLASS) {
            return format!("`{}`, a class used as a value", record.name);
        }
        // Declared in this program, in a scope between here and module scope.
        format!("`{}`, a name from an enclosing scope", record.name)
    }

    /// Whether a declaration sits at module scope.
    ///
    /// A module-scope name is never captured. There is one of it for the whole
    /// program and every function already reaches it by name, so copying it
    /// into a closure would be storage for nothing -- the same reason a
    /// function, a class and an import are skipped.
    ///
    /// It also puts the refusal in the right place when the module scope cannot
    /// represent the name. At the arrow all that can be said is how far away it
    /// was declared; at the read, `lower_identifier` can say what it *is* --
    /// a module-scope variable holding a function, an enum, a builtin this
    /// compiler does not provide.
    fn is_module_scope(&self, declaration: NodeId) -> bool {
        let mut at = self.node(declaration).parent;
        for _ in 0..64 {
            // No parent left is the file itself, which is module scope.
            let Some(node) = at else { return true };
            match self.kind_of(node) {
                Some(syntax::SOURCE_FILE) => return true,
                Some(
                    syntax::FUNCTION_DECLARATION
                    | syntax::FUNCTION_EXPRESSION
                    | syntax::ARROW_FUNCTION
                    | syntax::METHOD_DECLARATION
                    | syntax::CONSTRUCTOR
                    | syntax::GET_ACCESSOR
                    | syntax::SET_ACCESSOR,
                ) => return false,
                _ => at = self.node(node).parent,
            }
        }
        false
    }

    /// Whether a symbol's binding is created afresh on every loop iteration.
    ///
    /// True only for a `for` statement's *own* variable -- `for (let i = 0;
    /// ...)`. A `let` in the body is a different declaration each time round
    /// anyway, so it needs nothing special; this is about the one the loop
    /// header owns, which JavaScript rebinds per iteration even though it is
    /// written once.
    fn is_per_iteration(&self, record: &SymbolRecord) -> bool {
        record.declarations.iter().any(|declaration| {
            // Up from the declaration to the loop that owns it, stopping at the
            // first block. A loop's *header* has no block between it and the
            // declaration; a `let` in the body is inside one, and that one is a
            // fresh declaration every time round anyway.
            let mut at = self.node(*declaration).parent;
            for _ in 0..8 {
                let Some(node) = at else { return false };
                match self.kind_of(node) {
                    Some(syntax::FOR_STATEMENT | syntax::FOR_OF_STATEMENT) => return true,
                    Some(syntax::BLOCK) => return false,
                    _ => at = self.node(node).parent,
                }
            }
            false
        })
    }

    /// Whether this name is the thing being *called* rather than a value.
    ///
    /// `finish(x)` calls it and needs no function object at all; `f(finish)`
    /// passes it and does. The distinction is what keeps a program of ordinary
    /// calls free of a closure table.
    fn is_callee(&self, id: NodeId) -> bool {
        let Some(parent) = self.node(id).parent else {
            return false;
        };
        if self.kind_of(parent) != Some(syntax::CALL_EXPRESSION) {
            return false;
        }
        self.children(parent).first() == Some(&id)
    }

    /// The member being read, when this name is the target of a property access.
    fn member_read_from(&self, id: NodeId) -> Option<String> {
        let parent = self.node(id).parent?;
        if self.kind_of(parent) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(parent);
        let [target, member] = parts.as_slice() else {
            return None;
        };
        (*target == id)
            .then(|| self.node(*member).text.clone())
            .flatten()
    }

    /// The nearest ancestor of a given kind.
    fn ancestor(&self, id: NodeId, kind: u16) -> Option<NodeId> {
        let mut at = self.node(id).parent;
        while let Some(parent) = at {
            if self.kind_of(parent) == Some(kind) {
                return Some(parent);
            }
            at = self.node(parent).parent;
        }
        None
    }

    /// Whether a node has a function or method above it.
    fn is_within_a_function(&self, id: NodeId) -> bool {
        let mut at = self.node(id).parent;
        while let Some(parent) = at {
            if matches!(
                self.kind_of(parent),
                Some(
                    syntax::FUNCTION_DECLARATION | syntax::METHOD_DECLARATION | syntax::CONSTRUCTOR
                )
            ) {
                return true;
            }
            at = self.node(parent).parent;
        }
        false
    }

    /// An expression's value, when it is one the checker or this compiler can
    /// work out without running anything.
    /// What an expression is worth at compile time, if anything.
    ///
    /// `known` is the module-scope constants declared *before* this one, and
    /// that is the right set rather than a convenient one: JavaScript gives
    /// `const` a temporal dead zone, so an initializer naming a later `const` is
    /// a run-time error rather than a program with a value to fold. Empty for
    /// every caller that is not collecting module scope.
    fn constant_value(&self, id: NodeId, known: &rustc_hash::FxHashMap<u32, f64>) -> Option<f64> {
        match self.kind_of(id) {
            // A boolean's storage is its truth value. `Global::ty` says which of
            // the two a zero means.
            Some(syntax::TRUE_KEYWORD) => Some(1.0),
            Some(syntax::FALSE_KEYWORD) => Some(0.0),
            Some(syntax::NUMERIC_LITERAL) => self
                .node(id)
                .text
                .as_deref()
                .and_then(parse_number)
                .or_else(|| match self.snapshot.constants.get(&id) {
                    Some(nts_semantic_schema::ConstantValue::Number(value)) => Some(*value),
                    _ => None,
                }),
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(id).data else {
                    return None;
                };
                let inner = self.constant_value(*self.children(id).first()?, known)?;
                match small & syntax::prefix_operator::MASK {
                    syntax::prefix_operator::MINUS => Some(-inner),
                    syntax::prefix_operator::PLUS => Some(inner),
                    _ => None,
                }
            }
            // Arithmetic on two constants is a constant. Worth folding here
            // because a module-scope initializer has nowhere to run: it is a
            // static initializer in the emitted C, so `4 * PI * PI` is either
            // computed now or refused, and refusing it means a program cannot
            // name a derived constant.
            //
            // In `f64` and in the source's order, because that is what the
            // program would compute at run time -- floating-point addition does
            // not reassociate, and a fold that gets a different answer than the
            // code it replaces is not a fold.
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(id);
                let [lhs, operator, rhs] = children.as_slice() else {
                    return None;
                };
                let lhs = self.constant_value(*lhs, known)?;
                let rhs = self.constant_value(*rhs, known)?;
                match self.kind_of(*operator)? {
                    syntax::PLUS_TOKEN => Some(lhs + rhs),
                    syntax::MINUS_TOKEN => Some(lhs - rhs),
                    syntax::ASTERISK_TOKEN => Some(lhs * rhs),
                    syntax::SLASH_TOKEN => Some(lhs / rhs),
                    _ => None,
                }
            }
            // A name that is itself a module-scope constant. `SOLAR_MASS` is
            // `4 * PI * PI`, and a compiler that folds arithmetic but not names
            // folds nothing anyone writes.
            Some(syntax::IDENTIFIER) => self
                .node(id)
                .symbol
                .and_then(|symbol| known.get(&symbol.0).copied()),
            _ => match self.snapshot.constants.get(&id) {
                Some(nts_semantic_schema::ConstantValue::Number(value)) => Some(*value),
                _ => None,
            },
        }
    }

    /// Whether a declaration carries an implementation.
    ///
    /// What separates a function this program *defines* from one it only names:
    /// an ambient `declare`, an overload signature, and a method signature on an
    /// interface all lack one.
    fn has_a_body(&self, id: NodeId) -> bool {
        self.children(id)
            .into_iter()
            .any(|child| self.kind_of(child) == Some(syntax::BLOCK))
    }

    /// `what` is interpolated into a sentence, so it has to end in a noun.
    ///
    /// "a global this compiler does not provide" became "…does not provide is
    /// not supported by this lowering yet", which reads as a missing word
    /// rather than as a diagnostic. Every message here is a noun phrase, and a
    /// relative clause in one ends on its object.
    fn unsupported(&self, id: NodeId, what: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS1001",
            format!("{what} is not supported by this lowering yet"),
            self.location(id),
        )
    }

    /// One method or constructor of a class, as a function taking the instance.
    ///
    /// There is no dispatch to arrange. The checker resolved every call site, so
    /// `c.advance()` names one target and lowers to a static call with `c` as
    /// the first argument — which is what a method *is* once the receiver is
    /// explicit. A vtable only becomes necessary where a call site has more than
    /// one possible target, and TypeScript tells us when that is.
    /// One method, of one class — or of one *instantiation* of a generic class,
    /// which is a different class with the same source.
    ///
    /// `instance` is the instantiated object type. Its properties the checker
    /// already substituted, so the layout needs nothing; what needs the
    /// substitution this builder carries is the body, whose nodes are shared
    /// with every other copy.
    /// Whether this member is the implementation behind overload signatures.
    ///
    /// Detected from the *siblings* rather than from the member itself: an
    /// overload implementation looks exactly like an ordinary method, and what
    /// makes it one is that another member of the same class shares its name and
    /// has no body. `abstract` is excluded, which is the whole reason this is a
    /// separate question -- an abstract method in a base and an implementation
    /// in a subclass are two classes, so they are never siblings, and an
    /// abstract declaration beside its own implementation is not legal
    /// TypeScript.
    fn is_an_overload(&mut self, class: NodeId, member: NodeId) -> bool {
        let Some(name) = self.member_key(member) else {
            return false;
        };
        // Collected first, because the checks below take `&mut self` and a
        // closure holding the iterator would hold a borrow across them.
        let siblings: Vec<NodeId> = members_of(self.snapshot, class)
            .into_iter()
            .filter(|sibling| *sibling != member)
            .collect();
        for sibling in siblings {
            if self.member_key(sibling).as_deref() != Some(name.as_str()) {
                continue;
            }
            let modifiers = self.node(sibling).modifiers;
            if modifiers.contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT) {
                continue;
            }
            let has_body = self
                .children(sibling)
                .into_iter()
                .any(|child| self.kind_of(child) == Some(syntax::BLOCK));
            if !has_body {
                return true;
            }
        }
        false
    }

    /// The name a member is declared under, for comparing two of them.
    fn member_key(&mut self, member: NodeId) -> Option<String> {
        self.children(member)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(child).text.clone())
    }

    /// The block a method's code is in, where it has one.
    ///
    /// An `abstract` method is the one declaration that is *meant* to have no
    /// body, and `None` says so. Anything else without one is a declaration
    /// whose code this lowering cannot see -- an overload signature, an ambient
    /// declaration -- and stays refused, because emitting an unreachable
    /// function for one of those would be a function that *can* be reached and
    /// does nothing. The call goes to the implementation below it.
    fn method_body(
        &mut self,
        class: NodeId,
        member: NodeId,
        is_abstract: bool,
    ) -> Result<Option<NodeId>, Diagnostic> {
        // An overload *implementation* is refused, not only its signatures.
        //
        // Refusing the signatures alone left the implementation lowered and the
        // call sites resolving against the signature TypeScript picked, whose
        // parameter list is not the implementation's: `pick(a: number)` beside
        // `pick(a: number, b?: number) { .. }` gave
        // `CallArgumentCount { expected: 3, found: 2 }` -- invalid HIR from a
        // program every refusal had been reported for. A refusal that leaves a
        // broken artifact is worse than no refusal, because the diagnostics say
        // the compiler noticed.
        if self.is_an_overload(class, member) {
            return Err(self.unsupported(
                member,
                "an overloaded method, whose call sites resolve against a signature that is not \
                 the implementation's",
            ));
        }
        let body = self
            .children(member)
            .into_iter()
            .rev()
            .find(|child| self.kind_of(*child) == Some(syntax::BLOCK));
        match (body, is_abstract) {
            (Some(body), _) => Ok(Some(body)),
            (None, true) => Ok(None),
            (None, false) => Err(self.unsupported(member, "a method without a body")),
        }
    }

    fn lower_method_of(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let class_name = match instance {
            // The layout's name rather than the declaration's, because two
            // instantiations of one class must not produce one function.
            Some(ty) => self.layout_of(class, ty)?.name,
            // Through the same naming that keeps two functions of one name
            // apart. A method is spelled `Class#method`, which cannot collide
            // with a plain function and collides readily with a method of
            // another class of the same name: `dgram` and `net` both export a
            // `Socket`, and both emitted `Socket#ref`.
            None => self.qualified.get(&class).cloned().map_or_else(
                || {
                    self.children(class)
                        .into_iter()
                        .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                        .and_then(|child| self.node(child).text.clone())
                        .ok_or_else(|| self.unsupported(class, "an anonymous class"))
                },
                Ok,
            )?,
        };

        // A static method has no receiver: it is a namespaced function, and its
        // call sites name the class rather than an instance. So it is lowered
        // without the `this` parameter, and without a slot -- nothing overrides
        // a static method, because a call site names the class it is written on.
        let modifiers = self.node(member).modifiers;
        let is_static = modifiers.contains(nts_semantic_schema::DeclarationModifiers::STATIC);
        // As for a function: `Promise<T>` has no representation, so an `async`
        // method resolved to `-> void` and returned an `f64` from it anyway.
        if modifiers.contains(nts_semantic_schema::DeclarationModifiers::ASYNC) {
            return Err(self.unsupported(member, "an `async` method"));
        }
        // An `abstract` method declares a dispatch slot and nothing else. It is
        // lowered rather than refused because the *signature* is needed: a call
        // through `Shape#area` on a `Shape` receiver is an indirect call, and
        // the backend takes the function-pointer type from the declaration --
        // `virtual_signature` looks the name up in `program.funcs` and said "no
        // declaration for `Shape#area` to take a signature from" when this was
        // refused.
        //
        // So it becomes a function with the declared parameters and return type
        // and no body. The block is left open, which `finish` terminates as
        // `Unreachable`, and that is the truth rather than a placeholder: an
        // abstract class is never instantiated, so its slot is never the one
        // dispatch lands on. Every reachable receiver is a subclass whose
        // override fills the slot.
        let is_abstract =
            modifiers.contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT);

        let is_constructor = self.kind_of(member) == Some(syntax::CONSTRUCTOR);
        self.in_constructor = is_constructor;
        // An accessor shares its *name* with the property it presents, so the
        // emitted name has to say which it is: a class may declare `get x` and
        // `set x` together, and both are functions taking the receiver. The
        // space is punctuation no TypeScript identifier may contain, like the
        // `#` beside it.
        let accessor = match self.kind_of(member) {
            Some(syntax::GET_ACCESSOR) => "get ",
            Some(syntax::SET_ACCESSOR) => "set ",
            _ => "",
        };
        let member_name = if is_constructor {
            "constructor".to_owned()
        } else {
            self.member_name(member)
                .or_else(|| self.symbol_member_name(class, member, instance))
                .ok_or_else(|| {
                    self.unsupported(member, "a member whose name the program computes")
                })?
        };

        // Neither `#` nor `.` can appear in a TypeScript identifier, so a
        // qualified name cannot collide with a plain function's -- and the two
        // spellings keep `static foo()` and `foo()` apart, which one class is
        // allowed to declare together.
        let name = if is_static {
            format!("{class_name}.{accessor}{member_name}")
        } else {
            format!("{class_name}#{accessor}{member_name}")
        };

        let origin = self.origin(member);
        let mut params = Vec::new();
        if is_static {
            // No receiver, so no `this` and no base to resolve `super` against.
            // Reaching either inside a static method is a TypeScript error, so
            // there is nothing to refuse here that the checker has not.
            self.this = None;
            self.base = None;
        } else {
            // `this` is parameter zero. Its type is the class's instance type,
            // which is what the checker gives the class declaration's name --
            // or, for one copy of a generic class, the instantiation's.
            let instance = match instance {
                Some(ty) => HirType::Managed(ManagedType::Object(ty)),
                None => self
                    .type_of(class)
                    .ok_or_else(|| self.unrepresentable(member, "a class"))?,
            };
            // `this` is a parameter like any other and needs its layout to
            // exist. Nothing else builds it for a class nothing constructs --
            // an abstract base whose only role is to be extended is exactly
            // that.
            //
            // Reported against the *member*, not the class. The failure is
            // about the class's layout and the thing being refused is this
            // method, so pointing at the class gave one identical diagnostic
            // per method at the same line -- and left each method looking as
            // though nothing had been said about it at all.
            self.materialize(member, &instance)?;
            let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
            self.this = Some(receiver);
            self.base = self.base_class(class);
            params.push(Param {
                name: "this".to_owned(),
                shape: ParamShape::Ordinary,
                ty: instance,
                origin: origin.clone(),
                known: Facts::TOP,
            });
        }

        let mut declared = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            if self.declares_a_field(child) {
                declared.push((child, index));
            }
            params.push(self.lower_param(child, index)?);
        }

        self.store_parameter_properties(&declared)?;

        let body = self.method_body(class, member, is_abstract)?;

        // A constructor returns nothing. It could return the instance -- it has
        // one in hand -- but the caller allocated that instance and already
        // names it, so returning it hands the caller a second reference to an
        // object it is already holding. Under reference counting that is a
        // retain and a release per construction for no gain, and under any
        // provider it is a copy the C compiler has to see through.
        //
        // A setter likewise, and by the language's rule rather than by reading
        // the declaration: `set x(v)` may not annotate a return type and may
        // not return a value, so there is nothing to look up and nothing a
        // lookup could get wrong. Deriving it once gave `set ["size"](n:
        // number)` an `f64` return it never produces, and the emitter rendered
        // that honestly as a store followed by `__builtin_unreachable()` --
        // which the C compiler reads as a licence to compute anything at all
        // in the caller.
        let return_type = if is_constructor || self.kind_of(member) == Some(syntax::SET_ACCESSOR) {
            HirType::Void
        } else {
            self.return_type_of(member)?
        };
        self.materialize(member, &return_type)?;

        self.returns = return_type.clone();
        if let Some(body) = body {
            self.lower_block(body)?;
            self.close_body(&return_type);
        }

        // A method is reachable from outside exactly when its class is, so the
        // class's `export` is what makes it a root.
        let exported = self
            .node(class)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        let mut func = self.finish(name, params, return_type, origin, exported);
        // A constructor runs over an object `new` allocated a moment ago, so
        // every field it writes is writing over a zero.
        func.initializes_receiver = is_constructor;
        // A signature and nothing else. `body` is `None` exactly when the
        // method is `abstract`, which `method_body` is the only decider of.
        func.abstract_declaration = body.is_none();
        Ok(func)
    }

    /// Whether a `function` expression could have been an arrow, and why not.
    ///
    /// The refusal is the same either way -- neither lowers -- but which one it
    /// is decides whether the suggestion is safe, and that is a question the
    /// compiler can answer rather than one a reader should have to. `function`
    /// and `=>` differ in `this`: `util.deprecate` wraps a method by writing
    /// `function (this: unknown, ...args)` and forwarding the caller's receiver
    /// into `Reflect.apply`, and an arrow there would silently rebind `this` to
    /// the module scope. A deprecated method quietly operating on the wrong
    /// object is worse than a refusal by a wide margin, so a diagnostic that
    /// suggested the rewrite unconditionally would be actively harmful.
    ///
    /// An explicit `this` parameter or any `this` in the body settles it. The
    /// walk descends into nested *arrows*, which inherit `this` from here, and
    /// stops at anything that binds its own -- a nested `function`, a method,
    /// an accessor, a class.
    fn why_not_arrow(&self, id: NodeId) -> String {
        if self.binds_this(id) {
            return "a `function` expression that uses its own `this`, which an arrow function \
                    does not have"
                .to_owned();
        }
        // Unreachable from the statement dispatch, which lowers this case now.
        // Kept because the collector and the dispatch ask `binds_this`
        // separately, and a disagreement between them should say something
        // rather than reach `lower_arrow` and fail to find a closure.
        "a `function` expression the closure collector did not see".to_owned()
    }

    /// Whether a function expression's own `this` is reachable from its body.
    fn binds_this(&self, id: NodeId) -> bool {
        // `function (this: T, ...)` declares the receiver explicitly, which is
        // how a wrapper says it forwards one.
        if self.children(id).into_iter().any(|child| {
            self.kind_of(child) == Some(syntax::PARAMETER)
                && self
                    .children(child)
                    .into_iter()
                    .any(|part| self.node(part).text.as_deref() == Some("this"))
        }) {
            return true;
        }
        let mut found = false;
        for child in &self.node(id).children {
            self.mentions_this(*child, &mut found);
        }
        found
    }

    /// The first `this` in a subtree that belongs to the enclosing scope.
    ///
    /// [`Self::mentions_this`] answers whether there is one; this returns it,
    /// because a capture needs a node to take its *type* from and the arrow's
    /// own node has the arrow's type. Same walk, same rule about what rebinds.
    fn first_this(&self, id: NodeId) -> Option<NodeId> {
        match self.kind_of(id) {
            Some(syntax::THIS_KEYWORD) => return Some(id),
            Some(
                syntax::FUNCTION_EXPRESSION
                | syntax::FUNCTION_DECLARATION
                | syntax::METHOD_DECLARATION
                | syntax::CONSTRUCTOR
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
                | syntax::CLASS_DECLARATION,
            ) => return None,
            _ => {}
        }
        self.node(id)
            .children
            .iter()
            .find_map(|child| self.first_this(*child))
    }

    /// `this` in a subtree, not counting one that rebinds it.
    fn mentions_this(&self, id: NodeId, found: &mut bool) {
        if *found {
            return;
        }
        match self.kind_of(id) {
            Some(syntax::THIS_KEYWORD) => {
                *found = true;
                return;
            }
            // Binds its own `this`, so anything inside is not about ours.
            // `ARROW_FUNCTION` is deliberately absent: an arrow inherits.
            Some(
                syntax::FUNCTION_EXPRESSION
                | syntax::FUNCTION_DECLARATION
                | syntax::METHOD_DECLARATION
                | syntax::CONSTRUCTOR
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
                | syntax::CLASS_DECLARATION,
            ) => return,
            _ => {}
        }
        for child in &self.node(id).children {
            self.mentions_this(*child, found);
        }
    }

    /// A read of an erased binding at the type the checker narrowed it to.
    ///
    /// This is the whole of `Unerase`, and it is one function on purpose. The
    /// binding is `unknown`; the *use* inside `if (typeof v === "number")` has
    /// static type `number`, because the checker narrowed it. Lowering notices
    /// that disagreement and reads the payload.
    ///
    /// Unchecked, and safe for one reason: the checker only narrows on a path
    /// where the test succeeded. Emitting it anywhere the checker did not
    /// narrow would read a payload the tag does not describe -- a double out of
    /// a pointer -- which is silent. So the licence comes from `node_types` and
    /// from nothing else, at every one of the call sites: each passes the node
    /// whose narrowed type it wants, and none of them names a type itself.
    ///
    /// [`FuncBuilder::present_of`] is the one read-back that does *not* come
    /// from here, because its licence is different -- see it for why.
    fn narrowed(&mut self, id: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        if self.values[value.0 as usize].ty != HirType::Erased {
            return Ok(value);
        }
        let Some(want) = self.type_of(id) else {
            return Ok(value);
        };
        if want == HirType::Erased {
            return Ok(value);
        }
        // Narrowed to an absence, which is not a payload to read. After `v =
        // undefined` the checker types every later read of `v` as `undefined`,
        // whose representation is `Void` -- nothing at all. The erased value
        // already *is* that answer, tag and all, so the read stands as it is.
        //
        // Widening rather than narrowing, and safe for the same reason the
        // narrowing was: an erased value describes itself. `String(v)` reads
        // the tag and spells "undefined", which is what node does.
        //
        // `Never` is *not* this, and letting it through here emitted C that
        // would not compile. Inside `if (v !== undefined)` on a `v` the checker
        // already knows is `undefined`, the narrowed type is `never` -- the
        // branch is unreachable, and `never` is assignable to everything, so
        // the erased value flowed into a multiplication typed `f64` and the
        // backend cast a struct to a double. Refused instead, by the arm below.
        if want == HirType::Void {
            return Ok(value);
        }
        if !readable_back(&want) {
            return Err(self.unsupported(
                id,
                &format!("an `unknown` narrowed to {want:?}, which it cannot be read back as"),
            ));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Unerase { value }, want, origin))
    }

    /// The name a declaration or a key node spells.
    ///
    /// One function, because a name is asked for in a dozen places that must
    /// agree -- most sharply for a class member, where the name decides both
    /// the function a member is *emitted* as and the table a call site *finds*
    /// it through. Fixing one and not the other produces a method the emitter
    /// names and nothing can reach.
    ///
    /// Three spellings resolve to the same name. `record`, `"record"` and
    /// `["record"]` are one member; the quotes and the brackets are how a
    /// program writes a name the bare grammar will not take. Node's own
    /// `internal/errors` writes `get ["constructor"]()` for exactly that
    /// reason, since `get constructor()` is a type error.
    ///
    /// Only a literal. `[kSymbol]` and `[prefix + n]` are names the program
    /// decides at run time; both want a property map rather than a field, and
    /// reading one as a name would collide two members into a single slot.
    /// The field a member keyed by a *symbol* names.
    ///
    /// `o[kFlag]` indexes by a symbol, and the index's own name is `kFlag` --
    /// the variable holding the symbol, not the member. The snapshot reports
    /// the property under TypeScript's own spelling, `__@kFlag@2`: the symbol's
    /// description and the checker's id for it, which is the name the checker
    /// does lookup by and so the name the layout carries.
    ///
    /// The id is tsgo's and does not survive into this snapshot, so the match
    /// is on the description alone -- and an ambiguity is *refused* by
    /// returning nothing rather than guessed at. Two distinct symbols sharing
    /// one description and keying one type is the case that would otherwise
    /// pick a field silently.
    fn symbol_keyed(layout: &Layout, member: &str) -> Option<u32> {
        let prefix = format!("__@{member}@");
        let mut found = layout
            .fields
            .iter()
            .enumerate()
            .filter(|(_, field)| {
                field.name.starts_with(&prefix)
                    && field.name[prefix.len()..]
                        .bytes()
                        .all(|b| b.is_ascii_digit())
            })
            .map(|(at, _)| u32::try_from(at).unwrap_or(0));
        let first = found.next()?;
        found.next().is_none().then_some(first)
    }

    fn literal_name(&self, name: NodeId) -> Option<String> {
        if let Some(text) = self.node(name).text.clone() {
            return Some(text);
        }
        match self.kind_of(name) {
            // The decoder carries no text on a literal. The checker does carry
            // the *symbol* the name binds, and its name is the answer for every
            // spelling -- `"quoted"`, `["bracketed"]` and `[0]` all name a
            // symbol called what they say. That is also the name TypeScript
            // itself does property lookup by, so taking it here means the
            // compiler and the checker cannot disagree about which member a
            // call site meant.
            Some(syntax::STRING_LITERAL | syntax::NUMERIC_LITERAL) => self
                .node(name)
                .symbol
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .map(|record| record.name.clone())
                // No symbol: a literal in an index position, where the type is
                // the constant. Read from the same place `lower_string` reads.
                .or_else(|| {
                    match &self
                        .snapshot
                        .types
                        .get(self.snapshot.node_types.get(&name)?.0 as usize)?
                        .kind
                    {
                        TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
                        TypeKind::Literal(LiteralValue::Number(value)) => Some(value.to_string()),
                        _ => None,
                    }
                }),
            // A *literal* child only, and checked here rather than by
            // recursing: an identifier in brackets is a variable, not a name.
            // Reading `[kTag]` as the name `kTag` would put it in the same slot
            // as `["kTag"]`, which is the collision this whole refusal exists
            // to prevent.
            Some(syntax::COMPUTED_PROPERTY_NAME) => match self.children(name).as_slice() {
                [only]
                    if matches!(
                        self.kind_of(*only),
                        Some(syntax::STRING_LITERAL | syntax::NUMERIC_LITERAL)
                    ) =>
                {
                    self.literal_name(*only)
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// Which child of a declaration is spelling its name.
    ///
    /// A declaration's children are its name, its parameters, its return
    /// annotation and its body, and more than one reader has to tell them
    /// apart. Answering by kind alone is what put `["size"]` in the return
    /// annotation's place, so callers exclude the node this found rather than
    /// the kinds it accepts.
    fn name_node(&self, declaration: NodeId) -> Option<NodeId> {
        self.children(declaration).into_iter().find(|child| {
            matches!(
                self.kind_of(*child),
                Some(
                    syntax::IDENTIFIER
                        // `#check` is a name, and a node kind of its own rather
                        // than an identifier spelled oddly -- so leaving it out
                        // meant a private *method* had no name at all. It was
                        // refused as "a member whose name the program
                        // computes", and the members declared after it in the
                        // same class were neither lowered nor refused.
                        | syntax::PRIVATE_IDENTIFIER
                        | syntax::STRING_LITERAL
                        | syntax::NUMERIC_LITERAL
                        | syntax::COMPUTED_PROPERTY_NAME
                )
            )
        })
    }

    /// The name a class member is declared under, from the member itself.
    fn member_name(&self, member: NodeId) -> Option<String> {
        self.literal_name(self.name_node(member)?)
    }

    /// The name a member keyed by a *symbol* carries in its type.
    ///
    /// `[Symbol.iterator]() {}` and `[kFlag]() {}` are not names the program
    /// decides at run time, however much the brackets suggest it. Each resolves
    /// to exactly one property, and the checker spells it `__@iterator@5`: the
    /// symbol's description and the checker's own id for it. That is the name
    /// the layout carries, the name a lookup finds the member by, and so the
    /// name the method has to be emitted under.
    ///
    /// A symbol-keyed *field* has worked all along, because a layout takes its
    /// field names straight from the checker's members. A symbol-keyed *method*
    /// did not, because a method's name comes from its declaration -- and the
    /// declaration node carries no symbol at all. One rule with one of its two
    /// halves written, which is the same shape as `nts_string_eq` existing
    /// while `<` compared two addresses.
    ///
    /// So the name is found the way [`Self::symbol_keyed`] finds a field: by the
    /// description the brackets spell, matched against the type's own property
    /// list. The id is tsgo's and is not reproducible here, so the match is on
    /// the description alone -- and an ambiguity is *refused* by returning
    /// nothing rather than guessed at, which is the rule the field side states
    /// for the same reason.
    ///
    /// `[prefix + n]` has no such property and still refuses. The checker cannot
    /// name what the program computes, so there is nothing to find.
    fn symbol_member_name(
        &self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Option<String> {
        let described = self.symbol_description(self.name_node(member)?)?;
        // A generic instantiation arrives with its type; an ordinary class does
        // not, and is lowered once with `instance` unset. The instance type is
        // still there to be found -- it is what the checker gives the class
        // declaration's name, which is where `this` takes its type from too.
        let instance = instance.or_else(|| self.declared_instance_type(class))?;
        self.symbol_property_name(instance, &described)
    }

    /// The property a type declares under a symbol with this description.
    ///
    /// `__@kFlag@2`: the description the brackets spell and the checker's own id
    /// for the symbol. The id is tsgo's and is not reproducible here, so the
    /// match is on the description alone -- and two symbols sharing one
    /// description on one type is *refused* by returning nothing rather than
    /// resolved to whichever came first. [`Self::symbol_keyed`] states the same
    /// rule for the layout side and exists for the same reason.
    fn symbol_property_name(&self, ty: TypeId, described: &str) -> Option<String> {
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        let prefix = format!("__@{described}@");
        let mut found = properties.iter().map(|property| &property.name).filter(|name| {
            name.starts_with(&prefix) && name[prefix.len()..].bytes().all(|b| b.is_ascii_digit())
        });
        let first = found.next()?.clone();
        found.next().is_none().then_some(first)
    }

    /// The *instance* type a class declaration names.
    ///
    /// A class symbol's own type is the constructor's, and what `new` produces
    /// is a different type sharing that symbol. Found by the symbol rather than
    /// by the name, because two modules may each declare a `Point`.
    fn declared_instance_type(&self, class: NodeId) -> Option<TypeId> {
        // The same source `this` takes its type from a few lines below: the
        // checker gives a class declaration's name the *instance* type, not the
        // constructor's. Asked through `type_of` rather than by searching the
        // type table for the class's symbol, because a declaration node in this
        // snapshot carries no symbol at all -- which is what made the first two
        // attempts at this return nothing.
        match self.type_of(class)? {
            HirType::Managed(ManagedType::Object(ty)) => Some(ty),
            _ => None,
        }
    }

    /// The description of the symbol a computed member name spells.
    ///
    /// `[kFlag]` describes `kFlag` and `[Symbol.iterator]` describes `iterator`
    /// -- in both cases the last identifier written, which is what the checker
    /// puts between the `@`s. A well-known symbol and a `Symbol("...")` bound to
    /// a `const` reach this the same way, which is why one rule covers both.
    fn symbol_description(&self, name: NodeId) -> Option<String> {
        if self.kind_of(name) != Some(syntax::COMPUTED_PROPERTY_NAME) {
            return None;
        }
        let expression = self.children(name).first().copied()?;
        // `Symbol.iterator` is a property access whose *name* is the
        // description; `kFlag` is an identifier and is its own.
        let described = self
            .children(expression)
            .last()
            .copied()
            .filter(|_| self.names_a_property(expression))
            .unwrap_or(expression);
        self.node(described).text.clone()
    }

    /// Whether an expression names a module rather than a value.
    ///
    /// `import * as C from "./m"` binds `C` to the module itself. `C.x` is a
    /// reference to `m`'s export `x` -- resolved by the checker to that
    /// export's own symbol -- and not a field of an object this program
    /// allocates. There is no value for `C`, which is why lowering one asked
    /// for "a name from an enclosing scope" and named a module path.
    fn denotes_a_module(&self, id: NodeId) -> bool {
        let Some(local) = self.node(id).symbol else {
            return false;
        };
        // Declared by `* as ns`, which binds a name to the module and to
        // nothing in it. Asked of the *local* binding rather than of what it
        // aliases, because the module symbol is not reliably described: with a
        // default export in the imported file it arrives with no declarations
        // at all, and a predicate that looked for a source file among them
        // said no. The import is the thing that is actually written down.
        let declared_as_a_namespace =
            self.snapshot
                .symbols
                .get(local.0 as usize)
                .is_some_and(|record| {
                    record
                        .declarations
                        .iter()
                        .any(|node| self.kind_of(*node) == Some(syntax::NAMESPACE_IMPORT))
                });
        declared_as_a_namespace
            || self
                .snapshot
                .symbols
                .get(self.denoted_symbol(local).0 as usize)
                .is_some_and(|record| {
                    record
                        .declarations
                        .iter()
                        .any(|node| self.kind_of(*node) == Some(syntax::SOURCE_FILE))
                })
    }

    /// Whether an expression names a property of an object.
    ///
    /// `o.x` and `o["x"]` are one thing said two ways, and their node shapes
    /// already agree: an object beside a name. What separates them is the kind
    /// of the name node, which [`Self::literal_name`] resolves either way.
    ///
    /// The object's type is what keeps `xs[0]` out. An array index is also a
    /// literal in brackets, and it means something else entirely -- so this
    /// asks the checker what the receiver is rather than what the brackets
    /// contain.
    fn names_a_property(&self, id: NodeId) -> bool {
        match self.kind_of(id) {
            // A module's member is not one: there is no receiver, so a call
            // through it is a plain call and an access is a plain name. Saying
            // so here is what lets `C.scale(n)` reach the direct-callee path,
            // which resolves it from the checker's target like any other.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => match self.children(id).as_slice() {
                [object, _] => !self.denotes_a_module(*object),
                _ => true,
            },
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => match self.children(id).as_slice() {
                [object, index] => {
                    matches!(
                        self.type_of(*object),
                        Some(HirType::Managed(ManagedType::Object(_)))
                    ) && self.literal_name(*index).is_some()
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether every arm of this node's union type is the given class or below
    /// it.
    ///
    /// False for a node whose type is not a union, and deliberately: a single
    /// type that needed widening would already have the target's
    /// representation, so reaching here with one means something else is going
    /// on and the refusal should say so.
    fn every_arm_descends_from(&mut self, id: NodeId, target: TypeId) -> bool {
        // The node whose type is the union. For a call argument or a return
        // that is `id` itself; for a variable declaration it is the
        // *initializer*, because the declaration's own type is the declared one
        // -- which is the target, so asking it would compare `Shape` with
        // `Shape` and answer nothing. Found by kind rather than by trying `id`
        // and falling back, so the two cases stay distinguishable.
        let id = if self.kind_of(id) == Some(syntax::VARIABLE_DECLARATION) {
            let children = self.children(id);
            let Some(initializer) = children.iter().rev().find(|child| {
                !syntax::is_type_node(self.kind_of(**child).unwrap_or_default())
                    && self.kind_of(**child) != Some(syntax::IDENTIFIER)
            }) else {
                return false;
            };
            *initializer
        } else {
            id
        };
        let Some(ty) = self.snapshot.node_types.get(&id).copied() else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Union(members) = &record.kind else {
            return false;
        };
        let members = members.clone();
        // `all` rather than `any`, and it is defence in depth rather than a
        // check a program can reach. TypeScript's own assignability already
        // requires every arm to satisfy the target, so no well-typed source can
        // tell the two apart -- weakening this to `any` fails no test and leaves
        // the corpus at `invalid HIR 0`, which was verified rather than assumed.
        //
        // It stays because the lowering should not depend on the checker having
        // run: `Unerase` is the one operation here whose being wrong is silent
        // rather than loud, and its other emitter is licensed by a tag test on
        // the path. This one is licensed by a claim about types, and the claim
        // is cheap to make locally.
        //
        // An empty union cannot license anything.
        !members.is_empty()
            && members
                .iter()
                .all(|member| *member == target || self.descends_from(*member, target))
    }

    /// A value where a slot of a possibly different type expects it.
    ///
    /// Only erasure today. Every other pair either already matches or is a
    /// mismatch the verifier now reports -- it checks call argument types as of
    /// this change, which is how the missing conversion was found rather than
    /// compiled: a `NtsString *` passed into a `NtsValue` parameter is a struct
    /// initialised from a pointer, and C accepts it.
    ///
    /// References are refused by name rather than erased. A payload that is
    /// sometimes a pointer needs retain and release that switch on the tag, and
    /// reference counting that is subtly wrong does not announce itself.
    fn coerce(
        &mut self,
        value: ValueId,
        want: &HirType,
        id: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let have = self.values[value.0 as usize].ty.clone();
        if have == *want {
            return Ok(value);
        }
        // A slot of type `never` cannot receive a value, and one is arriving.
        // `{ from: "x" as never }` is how a program gets here: the assertion
        // typechecks and is false, so the field's declared type says nothing
        // can be stored where a string is being stored. Refusing is the honest
        // answer -- the alternative is to represent the field by whatever the
        // first store happens to be, and a layout is shared by every value of
        // the type.
        if *want == HirType::Never {
            return Err(self.unsupported(id, "a value asserted to be `never`"));
        }
        if *want != HirType::Erased {
            // The absent constant is the one value that can be re-made at
            // another representation without asking what it holds: `null` is a
            // null pointer as a reference and a tag as an erased value, and it
            // is the same `null` either way.
            //
            // It arrives here because a conditional's own type can be narrower
            // than the declaration it flows into. `const v: string | null |
            // undefined = n < 10 ? null : "x"` types the conditional `string |
            // null` -- one absence, so a pointer -- while the literal took the
            // declaration's two-absence type, which is erased.
            if have == HirType::Erased
                && want.is_managed()
                && matches!(
                    self.values[value.0 as usize].kind,
                    OpKind::ConstNull | OpKind::ConstUndefined
                )
            {
                let kind = self.values[value.0 as usize].kind.clone();
                let origin = self.origin(id);
                return Ok(self.push(kind, want.clone(), origin));
            }
            // An erased union every arm of which is the wanted class.
            //
            // `const shape: Shape = n > 0 ? new Circle(n) : new Square(-n)` is
            // the shape, and it is how anyone writes a hierarchy. The
            // conditional's own type is `Circle | Square` -- two
            // representations, so an erased value -- and the declaration says
            // `Shape`, which both of them are.
            //
            // That is an *upcast*, and base-first layout makes it free: a
            // pointer to a `Circle` is a pointer to a `Shape` at the same
            // address with the base's fields at the same offsets. The tag is
            // read off and thrown away, which is what `Unerase` is.
            //
            // The license is the checker's rather than a narrowing's, and it is
            // the stronger of the two: narrowing licenses an unerase because a
            // tag was tested on the path that reaches it, and this licenses one
            // because *every* arm satisfies the target, so no path can arrive
            // with anything else. `descends_from` is asked of each arm rather
            // than of the union, because a union is not a class.
            if let (HirType::Erased, HirType::Managed(ManagedType::Object(target))) =
                (&have, want)
                && self.every_arm_descends_from(id, *target)
            {
                let origin = self.origin(id);
                return Ok(self.push(OpKind::Unerase { value }, want.clone(), origin));
            }
            // Anything else erased, arriving where something concrete is
            // wanted, is refused rather than passed through. Passing it through
            // is what put an `NtsValue` on a block edge declared as a pointer:
            // the verifier caught it, and nothing before the verifier did.
            if have == HirType::Erased {
                return Err(self.unsupported(
                    id,
                    "an erased value where a concrete representation is wanted",
                ));
            }
            // Two managed types is an upcast, which base-first layout makes a
            // no-op pointer cast -- the verifier accepts it for that reason,
            // and the typechecker already decided it was legal. A managed value
            // where a scalar is wanted, or a scalar where a reference is, is
            // not a conversion at all, and passing it through is what put a
            // `bool` on a block edge declared as an object pointer.
            //
            // `||` is where it comes from. `a || b || (typeof f === "function")`
            // has an object on one arm and a boolean on another, and the join
            // takes the whole expression's type -- so one arm agrees with it and
            // the other is handed over unchanged. It reached the verifier as
            // `EdgeType { expected: Managed(Object(606)), found: Bool }` and
            // nothing before the verifier said a word, because this line was
            // the last one and it said yes to everything left.
            if have.is_managed() != want.is_managed() {
                return Err(self.unsupported(
                    id,
                    &format!("a value of type {have:?} where {want:?} is wanted"),
                ));
            }
            return Ok(value);
        }
        if !matches!(
            have,
            HirType::Float { .. }
                | HirType::Int { .. }
                | HirType::Bool
                | HirType::Void
                | HirType::Managed(
                    ManagedType::String | ManagedType::Object(_) | ManagedType::Array(_)
                )
        ) {
            return Err(self.unsupported(
                id,
                &format!("a value of type {have:?} where `unknown` is expected"),
            ));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Erase { value }, HirType::Erased, origin))
    }

    /// One argument, at the type the callee's parameter declares.
    ///
    /// The parameter type comes from the checker's resolved signature rather
    /// than from the callee's lowered `Func`, because the callee may not be
    /// lowered yet: `lower` walks declarations in index order and a call can
    /// precede its target.
    fn coerce_to_parameter(
        &mut self,
        call: NodeId,
        at: usize,
        value: ValueId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(want) = self.parameter_representation(call, at) else {
            return Ok(value);
        };
        self.coerce(value, &want, argument)
    }

    /// How a call's `at`th parameter is represented, from the resolved
    /// signature rather than from the argument.
    fn parameter_representation(&self, call: NodeId, at: usize) -> Option<HirType> {
        let target = self.snapshot.call_targets.get(&call)?;
        let signature = self.snapshot.signatures.get(target.signature.0 as usize)?;
        self.represent(signature.parameters.get(at)?.ty)
    }

    /// `delete o.x`, which TypeScript permits only where `x` is optional.
    ///
    /// `TS2790: The operand of a 'delete' operator must be optional` -- so the
    /// property being deleted always holds `T | undefined` and always has a slot
    /// with a tag in it. Deleting it is writing the `undefined` tag.
    ///
    /// # Why that is the whole of it
    ///
    /// JavaScript distinguishes a deleted property from one set to `undefined`:
    /// `"x" in o` is false after the first and true after the second, and
    /// `Object.keys` differs the same way. This representation cannot tell them
    /// apart -- an optional slot is zeroed at allocation and zero *is* the
    /// `undefined` tag.
    ///
    /// So the conflation would be a wrong answer, except that every operator
    /// that could see it already refuses on an optional property: `in` names it,
    /// `Object.keys` and `Object.hasOwn` name it, and `for...in` is refused
    /// outright. Three refusals that were each argued on their own terms, and
    /// together they are what makes this one sound. If any of them is ever
    /// implemented for an optional property, this becomes wrong on the same day
    /// -- which is why they all name the *property* rather than the feature.
    ///
    /// The result is `true`. In a strict-mode program every deletable property
    /// is configurable, and TypeScript has refused the rest above.
    fn lower_delete(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [target] = children.as_slice() else {
            return Err(self.unsupported(id, "a `delete` of unexpected shape"));
        };
        let origin = self.origin(id);
        // A property access only. `delete o[k]` for a computed `k` is a
        // question about a value, and the slot it names is not known here.
        if self.kind_of(*target) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return Err(self.unsupported(
                *target,
                "a `delete` of something other than a named property",
            ));
        }
        // Through `place_of` and `write_place`, which is what an ordinary
        // assignment uses. A setter or an element is refused by the property
        // check above; what reaches here is a field, and `coerce_to_slot` builds
        // the `undefined` at the slot's own representation rather than at a
        // guess.
        let place = self.place_of(*target)?;
        if !matches!(place, Place::Field { .. }) {
            return Err(self.unsupported(
                *target,
                "a `delete` of something that is not a stored field",
            ));
        }
        let absent = self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone());
        self.write_place(id, &place, absent);
        Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin))
    }

    /// `typeof x`, where `x` has one known primitive type.
    ///
    /// In a typed compiler this is a constant. If `value` is a `number` then
    /// `typeof value` is `"number"` and there is nothing to evaluate -- the
    /// operand is not read at all, which is why this folds rather than emitting
    /// anything.
    ///
    /// Worth doing because real code is full of it. Node's validators open with
    /// `if (typeof value !== "number") throw ...` on a parameter already
    /// declared `number`, guarding against callers JavaScript allows and
    /// TypeScript does not. Eight distinct sites across the node profile were
    /// refused for it, each costing its module a statement or a function, and
    /// all eight were reported as "this expression" -- an anonymous refusal
    /// that no work-list could see.
    ///
    /// Restricted to a single known primitive, and the restriction is the whole
    /// of the correctness argument. `typeof` on a union, an object, `any` or
    /// `unknown` is a property of the *value* rather than of its type, and
    /// answering it needs a runtime tag this compiler has not decided on. Those
    /// stay refused, by name now.
    fn lower_typeof(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let operand = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "`typeof` with no operand"))?;
        let answer = self
            .snapshot
            .node_types
            .get(&operand)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => Some("number"),
                TypeKind::String | TypeKind::Literal(LiteralValue::String(_)) => Some("string"),
                TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => Some("boolean"),
                TypeKind::BigInt => Some("bigint"),
                _ => None,
            })
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "`typeof` on a value whose type is not a single primitive, which needs a \
                     runtime tag",
                )
            });
        // An erased value *has* the runtime tag the message above asks for, and
        // reading it is what `typeof` means. The tag is an integer and the
        // expression's type is a string, so it goes through `nts_tag_name`.
        //
        // Almost every use is `typeof v === "number"`, which this turns into a
        // string allocation and a string comparison where an integer compare
        // would do. That fold is a peephole -- match the comparison, replace it
        // with `TagOf == constant` -- and it is deliberately not here: it is an
        // optimization over correct code rather than a special case inside the
        // lowering, and doing it here would put the tag table in two places.
        if answer.is_err() {
            let value = self.lower_expression(operand)?;
            // A representation `typeof` can answer from, with no tag to read.
            //
            // A class instance is `"object"`, a closure is `"function"`, an
            // array is `"object"` -- the *representation* says which, and it
            // says so at compile time. This used to refuse anything the checker
            // did not call a single primitive, which meant refusing `typeof obj
            // === "object"` on an object.
            //
            // Only where the type admits no absence. A `T | undefined` is one
            // pointer whose answer differs by what it holds -- `"object"` or
            // `"undefined"` -- and that is a runtime question this cannot fold.
            if self.values[value.0 as usize].ty != HirType::Erased
                && self
                    .absences_of(operand)
                    .is_some_and(|absent| absent.is_empty())
                && let Some(spelling) = self.spelling_for(&self.values[value.0 as usize].ty)
            {
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::ConstString(spelling.to_owned()),
                    HirType::Managed(ManagedType::String),
                    origin,
                ));
            }
            // One absence and a pointer: two answers, chosen by whether the
            // pointer is there. `typeof callback` on a `Callback | undefined`
            // is "undefined" or "function", and the profile asks it that way
            // twenty-odd times -- `if (typeof callback === "function")` is how
            // an optional callback is checked.
            //
            // A branch rather than a tag, because a pointer has no tag. Where
            // there are *two* absences the type is erased and the tag path
            // below answers it.
            if let Some(absent) = self.absences_of(operand)
                && let [only] = absent.as_slice()
                && let Some(present) = self.spelling_for(&self.values[value.0 as usize].ty)
                && self.values[value.0 as usize].ty != HirType::Erased
            {
                let missing = if *only == super::tags::NULL {
                    "object"
                } else {
                    "undefined"
                };
                let text = HirType::Managed(ManagedType::String);
                let origin = self.origin(id);
                let when_absent = self.push(
                    OpKind::ConstString(missing.to_owned()),
                    text.clone(),
                    origin.clone(),
                );
                let when_present = self.push(OpKind::ConstString(present.to_owned()), text, origin);
                let Some(condition) = self.absence_of(id, value) else {
                    return Err(self.unsupported(id, "`typeof` on a value with no absence to test"));
                };
                return self.lower_branching_value(
                    id,
                    condition,
                    Branch::Value(when_absent),
                    Branch::Value(when_present),
                );
            }
            if self.values[value.0 as usize].ty == HirType::Erased {
                let origin = self.origin(id);
                let tag = self.push(
                    OpKind::TagOf { value },
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    origin.clone(),
                );
                return Ok(self.runtime_call(
                    "nts_tag_name",
                    vec![tag],
                    HirType::Managed(ManagedType::String),
                    origin,
                ));
            }
        }
        let answer = answer?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstString(answer.to_owned()),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A module-scope declaration, as the assignment it is.
    ///
    /// Not `lower_statement`: that would bind the name as a *local* of the
    /// initializer function, and every function that reads the name reads the
    /// global -- so the value would be computed, stored in a local, and thrown
    /// away, leaving the global at zero. The declaration and the store are the
    /// same line here.
    ///
    /// Declarations whose initializer folded to a constant are skipped: their
    /// value is already in the artifact, either as the global's `initial` or,
    /// for a `const`, inlined at every read. `deferred` is exactly the set that
    /// needs code, which is why the decision is made once in
    /// `collect_module_scope` rather than re-derived here.
    fn lower_module_binding(
        &mut self,
        statement: NodeId,
        refused: &rustc_hash::FxHashSet<u32>,
    ) -> Result<(), Diagnostic> {
        let mut declarations = Vec::new();
        collect_kind(
            self.snapshot,
            statement,
            syntax::VARIABLE_DECLARATION,
            &mut declarations,
        );
        for declaration in declarations {
            let children = self.children(declaration);
            let Some(name) = children
                .iter()
                .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            else {
                continue;
            };
            let Some(symbol) = self.node(*name).symbol else {
                continue;
            };
            // Already refused on its own, above. Its global keeps the zero it
            // was given, and the program is missing one value rather than all
            // of them.
            if refused.contains(&symbol.0) {
                continue;
            }
            let Some(initializer) = self.module.deferred.get(&symbol.0).copied() else {
                continue;
            };
            let Some(global) = self.module.variables.get(&symbol.0).copied() else {
                continue;
            };
            // At the global's type, like every other slot a value meets. An
            // erased global is the case that needs the coercion: the
            // initializer is a number and the global holds a tag beside a
            // payload.
            //
            // Lowered *expecting* that type rather than lowered and then
            // converted, because some literals decide nothing on their own and
            // take their shape from the slot. `[]` is the one: its element type
            // is `never`, and inside a function the declaration supplies the
            // real one while a module-scope initializer had nothing to ask.
            let want = self.module.types[global as usize].clone();
            let value = self.lower_expecting(initializer, &want)?;
            let value = self.coerce(value, &want, declaration)?;
            self.write_place(declaration, &Place::Global(global), value);
        }
        Ok(())
    }

    /// A module's top-level statements, as one function.
    ///
    /// Module evaluation is itself a job (`docs/async.md` §3), so what this
    /// function queues is drained at the checkpoint after it rather than
    /// interleaved with it -- which is why it is an ordinary function the
    /// embedder calls, and not something the runtime runs implicitly.
    fn lower_module_init(
        &mut self,
        file: NodeId,
        statements: &[NodeId],
        refused: &rustc_hash::FxHashSet<u32>,
    ) -> Result<Func, Diagnostic> {
        let origin = self.origin(file);
        for statement in statements {
            if self.kind_of(*statement) == Some(syntax::VARIABLE_STATEMENT) {
                self.lower_module_binding(*statement, refused)?;
                continue;
            }
            self.lower_statement(*statement)?;
        }
        self.terminate(Terminator::Return(None));
        Ok(self.finish(
            MODULE_INIT.to_owned(),
            Vec::new(),
            HirType::Void,
            origin,
            true,
        ))
    }

    fn lower_function(&mut self, id: NodeId) -> Result<Func, Diagnostic> {
        let children = self.children(id);

        let name = children
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(*child).text.clone())
            .ok_or_else(|| self.unsupported(id, "an anonymous function"))?;
        // Qualified where another module declares the same name, and suffixed
        // where this is one copy of a generic. Neither `@` nor `<>` can appear
        // in a TypeScript identifier, so neither can collide with a plain name.
        let name = self.qualified.get(&id).cloned().unwrap_or(name);
        let name = format!("{name}{}", self.suffix);

        let mut params = Vec::new();
        for child in &children {
            if self.kind_of(*child) != Some(syntax::PARAMETER) {
                continue;
            }
            params.push(self.lower_param(*child, u32::try_from(params.len()).unwrap_or(0))?);
        }

        // The return type comes from the annotation when there is one. Without it
        // the checker's inferred type is on the signature, not on any node, so an
        // unannotated function is refused rather than guessed at.
        let body = children
            .iter()
            .rev()
            .find(|child| self.kind_of(**child) == Some(syntax::BLOCK))
            .copied()
            .ok_or_else(|| self.unsupported(id, "a function without a body"))?;

        // A generator's *declared* return type is `Generator<T, ...>`, which
        // has no representation and is not what the compiled function hands
        // back. What it hands back is the frame, so that is its return type
        // here -- reserved now, because the `for...of` that walks one has to
        // name the same type and `hir::suspend` has not run yet.
        let generated = self.begin_generator(id)?;
        let return_type = if let Some(frame) = &generated {
            HirType::Managed(ManagedType::Object(frame.ty))
        } else {
            let return_type = self.return_type_of(id)?;
            // A frame has no snapshot type to materialize a layout from:
            // `hir::suspend` builds its layout, and it is the only thing that
            // can, because what goes in one is what survives a suspension.
            self.materialize(id, &return_type)?;
            return_type
        };

        // An `async` function allocates its promise before the body runs, so
        // that every `return` has one to settle -- and so that the allocation
        // happens once rather than on each path out.
        let asynchronous = self.begin_async(id, &return_type)?;

        self.returns = return_type.clone();
        self.lower_block(body)?;

        if let Some(result) = asynchronous {
            // Falling off the end of an `async` function resolves it with
            // `undefined`, which is what `return;` does -- so the two are the
            // same path rather than the second being a special case.
            if !self.is_terminated() {
                self.settle_and_return(id, &result, None)?;
            }
        } else if generated.is_some() {
            // Falling off the end of a generator is the end of the walk, and
            // `return e` in one is the `TReturn` of `Generator<T, TReturn>`,
            // which a `for...of` discards. So both are the same exit, and
            // `hir::suspend` turns it into the *done* the resumption answers.
            if !self.is_terminated() {
                self.terminate(Terminator::Return(None));
            }
        } else {
            self.close_body(&return_type);
        }

        let origin = self.origin(id);
        let exported = self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        Ok(self.finish(name, params, return_type, origin, exported))
    }

    /// Reserve the frame a `function*` yields into, if this is one.
    ///
    /// Returns `None` for an ordinary function. The reservation is two facts --
    /// a synthetic type id and what `yield` produces -- and both are said
    /// *here* because two passes have to agree about them: [`super::suspend`]
    /// builds the layout, and the `for...of` that walks the generator reads the
    /// element out of it. A disagreement between those two is a load typed one
    /// way against a store typed the other, at the same offset of the same
    /// object, which is a wrong answer rather than an error.
    fn begin_generator(&mut self, id: NodeId) -> Result<Option<super::GeneratorFrame>, Diagnostic> {
        if !self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
        {
            return Ok(None);
        }
        if self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        {
            return Err(self.unsupported(id, "an `async` generator"));
        }
        // `Generator<T, TReturn, TNext>`, and `T` is the element. Read from the
        // checker's type arguments rather than from the annotation, so an
        // unannotated `function*` works the same way -- which is how the
        // promise's payload is read three functions below.
        let Some(returned) = self.snapshot.node_types.get(&id).copied() else {
            return Err(self.unsupported(id, "a generator whose type the checker did not give"));
        };
        let Some(TypeKind::Function(signature)) =
            self.snapshot.types.get(returned.0 as usize).map(|r| &r.kind)
        else {
            return Err(self.unsupported(id, "a generator with no call signature"));
        };
        let signature = *signature;
        let Some(signature) = self.snapshot.signatures.get(signature.0 as usize) else {
            return Err(self.unsupported(id, "a generator with no call signature"));
        };
        let declared = signature.return_type;
        let Some(argument) = self
            .snapshot
            .type_arguments
            .get(&declared)
            .and_then(|arguments| arguments.first())
            .copied()
        else {
            // No recorded argument is not `Generator<void>`: it means the
            // frontend stopped at the library boundary. Defaulting to `void`
            // would make every element nothing, and the walk would read a slot
            // no `yield` ever filled.
            return Err(self.unsupported(id, "a generator whose element type is not recorded"));
        };
        let Some(yields) = self.represent(argument) else {
            return Err(self.unrepresentable(id, "a generator's element"));
        };
        let Some(index) = self.generators.get(&id).copied() else {
            return Err(self.unsupported(id, "a generator outside every walk"));
        };
        let frame = super::GeneratorFrame {
            ty: super::generator_frame(index),
            yields,
        };
        self.generator = Some(frame.clone());
        Ok(Some(frame))
    }

    /// Allocate the promise an `async` function settles, if this is one.
    ///
    /// Returns `None` for an ordinary function, which is the signal to close
    /// the body the ordinary way.
    fn begin_async(
        &mut self,
        id: NodeId,
        return_type: &HirType,
    ) -> Result<Option<AsyncResult>, Diagnostic> {
        if !self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        {
            return Ok(None);
        }
        // The checker gives an `async` function a `Promise<T>` return type
        // whether or not the source wrote one, so anything else here is a type
        // this lowering could not represent rather than a function that is not
        // async.
        let HirType::Managed(ManagedType::Promise(payload)) = return_type else {
            return Err(self.unrepresentable(id, "an `async` function's result"));
        };
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), return_type.clone(), origin);
        let result = AsyncResult {
            promise,
            payload: (**payload).clone(),
        };
        self.async_result = Some(result.clone());
        Ok(Some(result))
    }

    /// One arrow function, as the `call` method of a class.
    ///
    /// The class's fields are what the body reads from the scope around it, in
    /// the order `collect_closures` fixed -- the same order the allocating side
    /// writes them in. `this` is the closure, so a free variable becomes a
    /// field read on parameter zero and everything downstream sees an ordinary
    /// object.
    fn lower_closure(&mut self, index: usize, info: &ClosureInfo) -> Result<Func, Diagnostic> {
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(info.node, reason));
        }
        let id = info.node;
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(id);

        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        self.this = Some(receiver);
        self.in_closure = true;
        let mut params = vec![Param {
            name: "this".to_owned(),
                shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
        }];
        let mut forwarded = Vec::new();
        for child in self.children(id) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let at = u32::try_from(params.len()).unwrap_or(0);
            params.push(self.lower_param(child, at)?);
            // `lower_param` pushed the value and bound it by symbol. A wrapper
            // has no body to read that binding, so the value is kept here --
            // it is the only `Param(at)` this function will hold.
            if let Some(value) = self.param_value(at) {
                forwarded.push(value);
            }
        }

        // The captures, read back and bound to the names the body writes. A
        // field read rather than a copy into a local: the value is already
        // there, and `FieldGet` is what every other object read is.
        let fields = self.bind_captures(receiver, info, &origin)?;
        self.layouts.push(self.closure_layout(index, fields));

        let return_type = self.return_type_of(id)?;
        self.materialize(id, &return_type)?;

        // A wrapper has no body of its own. It forwards to the function it
        // stands for, which keeps that function's one definition the only one:
        // re-lowering the declaration's body here would compile it twice and
        // give recursion two things to mean.
        if info.wraps {
            // The name the wrapped function is *emitted* under, which is not
            // always the name written on it: where two modules declare the same
            // one, `Naming` qualifies both apart, and the definition is emitted
            // under the qualified name.
            //
            // Reading the identifier's text instead called a name that does not
            // exist. Nothing said so -- the call was to a function the program
            // does not define, the wrapper was refused for calling something
            // refused, and the wrapper *is* the closure's only method -- so the
            // vtable came out null and the compiled program dereferenced it.
            // `path` has `isPosixPathSeparator` in both `posix.ts` and
            // `win32.ts` and passes it to `normalizeString`, which is exactly
            // this shape.
            let called = self
                .qualified
                .get(&id)
                .cloned()
                .or_else(|| self.declared_name(id))
                .ok_or_else(|| self.unsupported(id, "a function declaration with no name"))?;
            if forwarded.len() + 1 != params.len() {
                return Err(self.unsupported(
                    id,
                    "a function used as a value whose parameters are not plain names",
                ));
            }
            let call = self.push(
                OpKind::Call {
                    callee: Callee::Direct(called),
                    args: forwarded,
                    frame: None,
                },
                return_type.clone(),
                origin.clone(),
            );
            let carried = (!matches!(return_type, HirType::Void)).then_some(call);
            self.terminate(Terminator::Return(carried));
            return Ok(self.finish(name, params, return_type, origin, false));
        }

        // `x => x * 2` and `x => { return x * 2; }` are the same function, and
        // the first is much the more common. The body is the last child either
        // way: parameters and a return annotation both precede it.
        let body = self
            .children(id)
            .last()
            .copied()
            .ok_or_else(|| self.unsupported(id, "an arrow function with no body"))?;
        // A closure's `return` is its own. This was never set here, so a
        // `return x` inside a closure coerced to whatever the function *around*
        // it returned -- latent for as long as the two agreed, and immediate
        // once a void function's `return f()` learned to drop its value: a
        // closure returning an array, inside a void function, dropped it.
        //
        // Saved and restored rather than assigned, because closures nest.
        let enclosing = std::mem::replace(&mut self.returns, return_type.clone());
        let lowered = if self.kind_of(body) == Some(syntax::BLOCK) {
            let outcome = self.lower_block(body);
            if outcome.is_ok() {
                // `close_body` rather than an unconditional `Return(None)`: a
                // block reaching its end returns nothing only when nothing is
                // what it owes, and `FellThrough` is what says the difference
                // has not been proven. The unconditional form built closures
                // that promised an array and returned none.
                self.close_body(&return_type);
            }
            outcome
        } else {
            self.lower_expression(body).map(|value| {
                // `x => f(x)` where `f` returns nothing. The call happens and
                // there is no value to carry: C cannot `return` one from a
                // void function, and the emitter declares no variable for a
                // void-typed value to live in.
                let carried = (!matches!(return_type, HirType::Void)).then_some(value);
                self.terminate(Terminator::Return(carried));
            })
        };
        self.returns = enclosing;
        lowered?;

        // Not exported: a closure has no name to import. It stays only because
        // something dispatches through its slot, which `hir::reachable` decides
        // the same way it decides an override's fate.
        Ok(self.finish(name, params, return_type, origin, false))
    }

    /// The value a parameter was lowered to, by its index.
    ///
    /// `lower_param` binds by symbol, which is what a body wants and what a
    /// forwarding wrapper cannot use -- it has no body and no mention of the
    /// name. An index is unique within a function, so this is unambiguous.
    fn param_value(&self, index: u32) -> Option<ValueId> {
        self.values
            .iter()
            .position(|op| matches!(op.kind, OpKind::Param(at) if at == index))
            .map(|at| ValueId(u32::try_from(at).unwrap_or(u32::MAX)))
    }

    /// Read a closure's captures back out of its object and bind them.
    ///
    /// Returns the fields, which the layout is then built from -- and the
    /// creation side builds the same list, so the two are checked against each
    /// other by `collect_layouts` merging them into one layout rather than two.
    fn bind_captures(
        &mut self,
        receiver: ValueId,
        info: &ClosureInfo,
        origin: &Origin,
    ) -> Result<Vec<Field>, Diagnostic> {
        let mut fields = Vec::new();
        for (at, capture) in info.captures.iter().enumerate() {
            let held = self
                .type_of(capture.at)
                .ok_or_else(|| self.unrepresentable(capture.at, "a captured variable"))?;
            // By reference, the field holds the *cell* rather than the value,
            // and the binding below is the cell -- so every read and write of
            // the name in this body goes through it, exactly as it does in the
            // function that opened it.
            let ty = match self.cell_of(capture.symbol) {
                Some(index) => {
                    self.layouts.push(self.cell_layout(index, held));
                    HirType::Managed(ManagedType::Object(cell_type(index)))
                }
                None => held,
            };
            let field = u32::try_from(at).unwrap_or(0);
            let value = self.push(
                OpKind::FieldGet {
                    object: receiver,
                    field,
                },
                ty.clone(),
                origin.clone(),
            );
            if capture.symbol == THIS_CAPTURE {
                // Not a name in `bindings` -- `this` is not looked up that way
                // -- but the receiver every `this` in this body means.
                self.this = Some(value);
            } else {
                self.bindings.insert(capture.symbol, value);
            }
            // The field itself is never reassigned either way: by value it is
            // the captured value, and by reference it is a pointer to storage
            // that is written *through* rather than replaced.
            fields.push(Field {
                name: capture.name.clone(),
                ty,
                readonly: true,
            });
        }
        Ok(fields)
    }

    /// The cell a symbol lives in, where something captures it by reference.
    ///
    /// `None` is the ordinary case: the name is an SSA value like any other and
    /// costs nothing. That is what keeps a program full of locals free of cells.
    fn cell_of(&self, symbol: u32) -> Option<usize> {
        self.boxed.iter().position(|held| *held == symbol)
    }

    /// The one-field object a captured-and-written variable lives in.
    fn cell_layout(&self, index: usize, ty: HirType) -> Layout {
        let mut fields = vec![Field {
            name: "value".to_owned(),
            ty,
            // Written by definition -- being written is why it exists.
            readonly: false,
        }];
        // Zero until the declaration runs, which is what the guard reads. Only
        // on a cell that has the window; every other one carries nothing.
        if self.is_guarded(index) {
            fields.push(Field {
                name: "ready".to_owned(),
                ty: HirType::Bool,
                readonly: false,
            });
        }
        Layout {
            types: vec![cell_type(index)],
            name: cell_name(index),
            fields,
            methods: vec![None; self.hierarchy.table_size()],
            // A cell is storage a closure shares, not a class.
            base: None,
        }
    }

    /// Whether the cell at `index` carries a `ready` flag.
    fn is_guarded(&self, index: usize) -> bool {
        self.boxed
            .get(index)
            .is_some_and(|symbol| self.guarded.contains(symbol))
    }

    /// Move a name into its cell, and bind the name to the cell.
    ///
    /// Everything afterwards reads and writes through the cell, in this
    /// function and in every closure that captured it.
    fn open_cell(&mut self, symbol: u32, value: ValueId, at: NodeId) -> ValueId {
        let Some(index) = self.cell_of(symbol) else {
            return value;
        };
        // A closure written above this declaration already opened the cell, so
        // this is a store into it rather than a new one -- which is the whole
        // point: the closure and the declaration have to name one cell.
        if let Some(cell) = self.opened_cell(symbol, index) {
            let origin = self.origin(at);
            self.push(
                OpKind::FieldSet {
                    object: cell,
                    field: 0,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
            // The cell was opened empty, above. This is the moment it stops
            // being, and the flag is what a closure's read consults.
            if self.is_guarded(index) {
                let ready = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
                self.push(
                    OpKind::FieldSet {
                        object: cell,
                        field: 1,
                        value: ready,
                    },
                    HirType::Void,
                    origin,
                );
            }
            return cell;
        }
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(at);
        let cell_ty = HirType::Managed(ManagedType::Object(cell_type(index)));
        self.layouts.push(self.cell_layout(index, ty));
        let cell = self.push(OpKind::ObjectNew { frame: false }, cell_ty, origin.clone());
        self.push(
            OpKind::FieldSet {
                object: cell,
                field: 0,
                value,
            },
            HirType::Void,
            origin,
        );
        cell
    }

    /// The cell already standing for this symbol, if one is.
    ///
    /// The type is the test rather than the binding's presence: a name from an
    /// enclosing scope can be bound to something that is not this cell, and
    /// storing into that would write to the wrong place.
    fn opened_cell(&self, symbol: u32, index: usize) -> Option<ValueId> {
        let bound = self.bindings.get(&symbol).copied()?;
        let wanted = HirType::Managed(ManagedType::Object(cell_type(index)));
        (self.values[bound.0 as usize].ty == wanted).then_some(bound)
    }

    /// Open a cell in the *entry* block, for a name read above its declaration.
    ///
    /// In the entry block rather than beside the closure, because it has to
    /// dominate both the closure that reads it and the declaration that fills
    /// it, and those can be in different branches. The entry block dominates
    /// everything, so this is the one placement that always holds.
    ///
    /// The cell is zeroed until the declaration runs. JavaScript throws a
    /// `ReferenceError` for a read in that window; this answers with the zero.
    /// The two differ only for a program that would throw, which is the same
    /// bargain the rest of this compiler makes with exceptions.
    fn open_cell_early(&mut self, symbol: u32, at: NodeId) -> Option<ValueId> {
        let index = self.cell_of(symbol)?;
        let ty = self.type_of(at)?;
        let origin = self.origin(at);
        self.layouts.push(self.cell_layout(index, ty));
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::ObjectNew { frame: false },
            ty: HirType::Managed(ManagedType::Object(cell_type(index))),
            origin,
        });
        self.blocks[0].ops.insert(0, id);
        self.bindings.insert(symbol, id);
        Some(id)
    }

    /// Read a name that lives in a cell.
    fn read_cell(&mut self, symbol: u32, cell: ValueId, at: NodeId) -> Option<ValueId> {
        let index = self.cell_of(symbol)?;
        let ty = self
            .program_layout_field(index)
            .or_else(|| self.type_of(at))?;
        let origin = self.origin(at);
        // Inside a closure only. A read before the declaration is the one thing
        // the typechecker cannot catch here, because the body runs later; a
        // direct one in the same scope it rejects itself.
        if self.in_closure && self.is_guarded(index) {
            let name = self
                .node(at)
                .text
                .clone()
                .unwrap_or_else(|| "a name".to_owned());
            self.push(
                OpKind::CellReady { cell, name },
                HirType::Void,
                origin.clone(),
            );
        }
        Some(self.push(
            OpKind::FieldGet {
                object: cell,
                field: 0,
            },
            ty,
            origin,
        ))
    }

    /// The type a cell holds, from the layout this function already pushed.
    fn program_layout_field(&self, index: usize) -> Option<HirType> {
        self.layouts
            .iter()
            .find(|layout| layout.types.contains(&cell_type(index)))
            .and_then(|layout| layout.fields.first())
            .map(|field| field.ty.clone())
    }

    /// The class a closure allocates, with its one method in the shared slot.
    fn closure_layout(&self, index: usize, fields: Vec<Field>) -> Layout {
        let (class, method) = closure_names(index);
        let mut methods = vec![None; self.hierarchy.table_size()];
        if let Some(slot) = self.hierarchy.closure_slot {
            methods[slot as usize] = Some(method);
        }
        Layout {
            types: vec![closure_type(index)],
            name: class,
            fields,
            methods,
            // Every closure is its own class and extends nothing.
            base: None,
        }
    }

    /// Assemble what has been built into a function.
    fn finish(
        &mut self,
        name: String,
        params: Vec<Param>,
        return_type: HirType,
        origin: Origin,
        exported: bool,
    ) -> Func {
        let blocks = std::mem::take(&mut self.blocks)
            .into_iter()
            .map(|block| Block {
                params: block.params,
                ops: block.ops,
                // Every block is terminated by construction: an open one is only
                // possible if a lowering forgot, and Unreachable states that
                // rather than leaving a malformed function.
                terminator: block.terminator.unwrap_or(Terminator::Unreachable),
            })
            .collect();

        Func {
            name,
            params,
            return_type,
            values: std::mem::take(&mut self.values),
            blocks,
            origin,
            exported,
            // Set by the caller: `finish` does not know what it is assembling,
            // and a seventh positional bool next to `exported` would be a
            // parameter waiting to be passed in the wrong order.
            initializes_receiver: false,
            abstract_declaration: false,
            // Not the caller's, because this one is not a property of what is
            // being assembled but of what the body did -- and the body has just
            // finished saying so.
            async_result: self.async_result.as_ref().map(|result| result.promise),
            frame: self.generator.clone(),
        }
    }

    /// A parameter's default, as the expression node that produces it.
    ///
    /// The grammar puts it last -- `modifiers name ? : type = initializer` --
    /// so the last child is the initializer whenever it is not the name, the
    /// type annotation, or the `?`. A modifier cannot be last and neither can
    /// the `...` of a rest, which is what makes reading the end precise rather
    /// than a guess at which child is which.
    fn default_of(&self, param: NodeId) -> Option<NodeId> {
        let children = self.children(param);
        let last = *children.last()?;
        let name = *children
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))?;
        (last != name
            && !syntax::is_type_node(self.kind_of(last).unwrap_or(0))
            && self.kind_of(last) != Some(syntax::QUESTION_TOKEN))
        .then_some(last)
    }

    /// Whether an expression reads one of the parameters `declaration` declares.
    ///
    /// `f(a: number, b: number = a * 2)` is legal and this compiler cannot fill
    /// it: the default is lowered at the *call*, where `a` is the caller's
    /// argument expression rather than the callee's binding, and evaluating it
    /// twice is a different program whenever it has an effect. Naming the
    /// parameter it reads is worth more than saying it is complicated.
    fn reads_a_parameter(&self, expr: NodeId, declaration: NodeId) -> Option<String> {
        let params: rustc_hash::FxHashSet<u32> = self
            .children(declaration)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .filter_map(|param| {
                self.children(param)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            })
            .filter_map(|name| self.node(name).symbol)
            .map(|symbol| symbol.0)
            .collect();
        let mut stack = vec![expr];
        while let Some(at) = stack.pop() {
            if self.kind_of(at) == Some(syntax::IDENTIFIER)
                && self
                    .node(at)
                    .symbol
                    .is_some_and(|symbol| params.contains(&symbol.0))
            {
                return self.node(at).text.clone();
            }
            stack.extend(self.children(at));
        }
        None
    }

    /// The arguments a call passes, with the defaults it leaves to the callee.
    ///
    /// JavaScript evaluates a default at the call, in the callee's scope, after
    /// every argument that *was* provided. Lowering it here, in that order, is
    /// the same program — and it costs nothing at run time, because the value
    /// arrives as an ordinary argument rather than as a test the callee makes
    /// on every call.
    ///
    /// Which parameters were omitted is read from the callee's declaration,
    /// which the checker resolved: `call_targets` answers for a method and a
    /// constructor as well as a plain function, so one helper covers every path
    /// that builds an argument list.
    fn lower_arguments(
        &mut self,
        call: NodeId,
        arguments: &[NodeId],
    ) -> Result<Vec<ValueId>, Diagnostic> {
        // Where the callee's rest parameter starts, if it has one. Everything
        // from there is one array rather than one argument each.
        let rest = self
            .snapshot
            .call_targets
            .get(&call)
            .and_then(|target| self.snapshot.signatures.get(target.signature.0 as usize))
            .and_then(|signature| signature.parameters.iter().position(|p| p.rest));

        let mut args = Vec::new();
        for (at, argument) in arguments.iter().enumerate() {
            if rest == Some(at) {
                let gathered = self.gather_rest(call, at, &arguments[at..])?;
                args.push(gathered);
                return Ok(args);
            }
            let value = self.lower_expression(*argument)?;
            args.push(self.coerce_to_parameter(call, args.len(), value, *argument)?);
        }
        // A rest the call gave nothing to still takes an array, an empty one.
        // `f()` and `f(1)` reach the same function and it reads `xs.length`.
        if rest == Some(args.len()) {
            let gathered = self.gather_rest(call, args.len(), &[])?;
            args.push(gathered);
            return Ok(args);
        }
        for omitted in self.omitted_after(call, arguments.len())? {
            let value = match omitted {
                Omitted::Default(node) => {
                    let value = self.lower_expression(node)?;
                    self.coerce_to_parameter(call, args.len(), value, node)?
                }
                Omitted::Absent => self.absent_argument(call, args.len())?,
            };
            args.push(value);
        }
        // The rest can be reached *after* the defaults are filled, and the
        // check above cannot see that: it fires only when the call itself
        // stopped exactly at the rest. `f(a)` against
        // `f(a, b = 5, ...rest: number[])` supplies `a`, the loop supplies `b`,
        // and the array is still owed -- which reached the verifier as
        // `CallArgumentCount { callee: "f", expected: 3, found: 2 }`.
        //
        // Both checks, rather than moving the first one down here. The early
        // one returns before `omitted_after` runs, and that ordering is what
        // keeps a call that stops at the rest from asking the signature about
        // parameters past it.
        if rest == Some(args.len()) {
            let gathered = self.gather_rest(call, args.len(), &[])?;
            args.push(gathered);
        }
        Ok(args)
    }

    /// The trailing arguments of a call, as the array its callee declared.
    ///
    /// Built here rather than at the declaration because that is where the
    /// values are: `f(1, 2, 3)` and `f()` reach the same one-parameter function
    /// and differ only in what this puts in the array.
    fn gather_rest(
        &mut self,
        call: NodeId,
        at: usize,
        elements: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .parameter_representation(call, at)
            .ok_or_else(|| self.unsupported(call, "a rest parameter of unrepresentable type"))?;
        let HirType::Managed(ManagedType::Array(element)) = ty.clone() else {
            return Err(self.unsupported(call, "a rest parameter that is not an array"));
        };
        let origin = self.origin(call);
        #[allow(clippy::cast_precision_loss)]
        let count = elements.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                zeroed: true,
            },
            ty,
            origin.clone(),
        );
        for (index, node) in elements.iter().enumerate() {
            let value = self.lower_expression(*node)?;
            // At the element's type, like every other store into a slot.
            let value = self.coerce(value, &element, *node)?;
            #[allow(clippy::cast_precision_loss)]
            let position = index as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: true,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// The value a call passes for an optional parameter it did not reach.
    ///
    /// `f(a?: T)` called as `f()` still calls a function of one parameter, so
    /// the absence has to be a value -- and it is the same `undefined` the
    /// program could have written there, needing the same thing: a home in
    /// `T`'s representation. A reference has one, the null pointer; an erased
    /// value has one, its `undefined` tag; an `f64` has none.
    ///
    /// Before this the argument was simply not passed, and the call went out
    /// one short. That is only visible once `a?: string` has a representation
    /// at all: while the union was refused the declaration never lowered, so
    /// no call to it existed to be wrong.
    fn absent_argument(&mut self, call: NodeId, at: usize) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(call);
        match self.parameter_representation(call, at) {
            Some(HirType::Erased) => Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin)),
            Some(ty) if ty.is_managed() => Ok(self.push(OpKind::ConstUndefined, ty, origin)),
            _ => Err(self.unsupported(
                call,
                "an omitted argument for a parameter with nowhere to put `undefined`",
            )),
        }
    }

    /// What a call has to supply for a parameter its argument list did not
    /// reach.
    ///
    /// Both are work at the *call* rather than a note on the declaration: a
    /// default has to be evaluated once per call that omits it, and an absence
    /// has to be a value in the argument list because the callee has a
    /// parameter for it either way.
    ///
    /// Refuses the same default `lower_param` refuses, in the same words. The
    /// declaration is not always lowered before the call -- and when it is, the
    /// call would otherwise fail here on the *parameter name*, reporting `a` as
    /// a name from an enclosing scope, which is true of the expression as this
    /// site sees it and says nothing about the cause.
    fn omitted_after(&self, call: NodeId, provided: usize) -> Result<Vec<Omitted>, Diagnostic> {
        let Some(target) = self.snapshot.call_targets.get(&call) else {
            return Ok(Vec::new());
        };
        let Some(signature) = self.snapshot.signatures.get(target.signature.0 as usize) else {
            return Ok(Vec::new());
        };
        // The declaration's parameter list, where there is one. The signature
        // is what the verifier counts against, but the *default expression*
        // only exists in the syntax.
        let declared: Vec<NodeId> = target
            .callee
            .map(|callee| {
                self.children(callee)
                    .into_iter()
                    .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
                    .collect()
            })
            .unwrap_or_default();
        let mut omitted = Vec::new();
        for (at, parameter) in signature.parameters.iter().enumerate().skip(provided) {
            // The rest is `lower_arguments`'s to fill, not this function's:
            // filling it here would build the array it is supposed to collect,
            // and everything after a rest is inside it. So this stops and the
            // caller checks again once the defaults are in.
            //
            // The comment here used to say a rest parameter was refused at the
            // declaration, which stopped being true when rest parameters
            // landed. The `break` stayed correct and the reason for it did not,
            // and the gap between them was one missing empty array.
            if parameter.rest {
                break;
            }
            let declaration = declared.get(at).copied();
            if let Some(default) = declaration.and_then(|param| self.default_of(param)) {
                let callee = target.callee.unwrap_or(call);
                if let Some(read) = self.reads_a_parameter(default, callee) {
                    return Err(self.unsupported(
                        call,
                        &format!("a parameter default that reads `{read}`, another parameter"),
                    ));
                }
                omitted.push(Omitted::Default(default));
                continue;
            }
            // Only where the declaration agrees there is a parameter here. An
            // overload's signature and the implementation's parameter list are
            // two different lists, and passing against the wrong one would put
            // the arity out in the other direction.
            if parameter.optional && (target.callee.is_none() || declaration.is_some()) {
                omitted.push(Omitted::Absent);
            }
        }
        Ok(omitted)
    }

    /// `constructor(private x: number)`: the store the modifier implies.
    ///
    /// A parameter property is two things wearing one syntax -- a parameter,
    /// and a member of the class initialised from it. The checker reports the
    /// member like any other, so the layout already has the slot; only the
    /// assignment was missing, which is why this was a refusal rather than a
    /// gap.
    ///
    /// Before the body, because that is where JavaScript puts it and the body
    /// may read `this.x` on its first line. In declaration order, because the
    /// initialisers of two of them can be told apart by a getter.
    ///
    /// Node cannot run this in strip-only mode -- a parameter property is not
    /// erasable, so the oracle refuses the program rather than disagreeing with
    /// it. The differential passes `--experimental-transform-types` for exactly
    /// this and for `enum`, the other non-erasable construct.
    fn store_parameter_properties(
        &mut self,
        declared: &[(NodeId, u32)],
    ) -> Result<(), Diagnostic> {
        for (child, index) in declared.iter().copied() {
            let name = self
                .name_node(child)
                .and_then(|node| self.literal_name(node))
                .ok_or_else(|| {
                    self.unsupported(child, "a parameter property whose name is not a literal")
                })?;
            let receiver = self
                .this
                .ok_or_else(|| self.unsupported(child, "a parameter property outside a class"))?;
            let HirType::Managed(ManagedType::Object(owner)) =
                self.values[receiver.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(child, "a parameter property on a receiver with no layout"));
            };
            let layout = self.layout_of(child, owner)?;
            let field = layout
                .index_of(&name)
                .ok_or_else(|| self.absent_member(child, owner, &name))?;
            let value = self
                .values
                .iter()
                .position(|op| matches!(op.kind, OpKind::Param(at) if at == index))
                .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
                .ok_or_else(|| self.unsupported(child, "a parameter property with no parameter"))?;
            let want = layout.fields[field as usize].ty.clone();
            let value = self.coerce(value, &want, child)?;
            let origin = self.origin(child);
            self.push(
                OpKind::FieldSet {
                    object: receiver,
                    field,
                    value,
                },
                HirType::Void,
                origin,
            );
        }
        Ok(())
    }

    /// Whether a parameter also declares a field.
    ///
    /// `constructor(private x: number)` is two things wearing one syntax: a
    /// parameter, and a member of the class initialised from it. TypeScript
    /// permits the modifier nowhere else, and the checker already reports the
    /// member -- so the layout has the field and what was missing was the
    /// store.
    fn declares_a_field(&self, id: NodeId) -> bool {
        let modifiers = self.node(id).modifiers;
        [
            DeclarationModifiers::PRIVATE,
            DeclarationModifiers::PROTECTED,
            DeclarationModifiers::PUBLIC,
            DeclarationModifiers::READONLY,
        ]
        .into_iter()
        .any(|flag| modifiers.contains(flag))
    }

    fn lower_param(&mut self, id: NodeId, index: u32) -> Result<Param, Diagnostic> {
        let children = self.children(id);
        // A name, or a pattern standing where one would be. `function f({ x }:
        // P)` is one parameter carrying one value, and the pattern is what the
        // body reads out of it.
        let name_node = children
            .iter()
            .find(|child| {
                matches!(
                    self.kind_of(**child),
                    Some(
                        syntax::IDENTIFIER
                            | syntax::OBJECT_BINDING_PATTERN
                            | syntax::ARRAY_BINDING_PATTERN
                    )
                )
            })
            .copied()
            .ok_or_else(|| self.unsupported(id, "a parameter with no name"))?;

        // A parameter list that does not line up with the argument list, one
        // way or the other. Both were *silently* lowered as ordinary
        // parameters, which is the shape that matters: no diagnostic, and C
        // that does not compile. A default emitted a call with too few
        // arguments; a rest emitted a `double` cast to an array pointer
        // followed by the remaining arguments.
        //
        // A default needs the initializer evaluated at every call that omits
        // it, and a rest needs an array built there, so both are real work at
        // the *call* rather than a note on the declaration.
        // A rest parameter *is* an ordinary parameter of array type. What was
        // missing was never the declaration -- it is the call, which has to
        // gather its trailing arguments into that array; `lower_arguments` is
        // the other half of this.
        //
        // What is still refused is a rest whose element has no representation:
        // `...args: A` where `A extends unknown[]` has none until an
        // instantiation supplies one.
        if children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN))
            && !matches!(
                self.type_of(name_node),
                Some(HirType::Managed(ManagedType::Array(_)))
            )
        {
            return Err(self.unsupported(
                id,
                "a rest parameter whose element type has no representation",
            ));
        }
        // A default is supplied by the calls that omit it, which is where
        // JavaScript evaluates it. What that cannot reach is the callee's own
        // scope, so a default that reads another parameter is refused here
        // rather than mis-lowered there.
        if let Some(default) = self.default_of(id)
            && let Some(parent) = self.node(id).parent
            && let Some(read) = self.reads_a_parameter(default, parent)
        {
            return Err(self.unsupported(
                id,
                &format!("a parameter default that reads `{read}`, another parameter"),
            ));
        }

        let name = self
            .node(name_node)
            .text
            .clone()
            .unwrap_or_else(|| format!("arg{index}"));
        let ty = self
            .type_of(name_node)
            .ok_or_else(|| self.unrepresentable(name_node, "a parameter"))?;
        self.materialize(name_node, &ty)?;

        let origin = self.origin(name_node);
        // What the declared type says, before anything in the body is seen.
        let known = self
            .snapshot
            .node_types
            .get(&name_node)
            .map_or(Facts::TOP, |declared| {
                known_values(self.snapshot, *declared, 0)
            });
        let value = self.push(OpKind::Param(index), ty.clone(), origin.clone());
        // Bound by symbol, so every later mention of this name resolves to the
        // same value rather than to a fresh load. A pattern has no symbol of
        // its own -- its *elements* do, and each is a read of the parameter.
        if matches!(
            self.kind_of(name_node),
            Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
        ) {
            self.bind_pattern(name_node, value)?;
        } else if let Some(symbol) = self.node(name_node).symbol {
            // A parameter is a name like any other, and `callback =
            // asRequest(callback)` before a closure reads it is common enough
            // in the profile that missing this emitted C that did not compile.
            let value = self.open_cell(symbol.0, value, name_node);
            self.bindings.insert(symbol.0, value);
        }

        // What the declaration said, beyond the type. Both halves were already
        // computed above -- the rest check reads `DOT_DOT_DOT_TOKEN` and the
        // default check calls `default_of` -- and both were discarded.
        //
        // Order matters: a rest parameter cannot be optional or defaulted, and
        // `x?: T = e` is not legal TypeScript, so the three are exclusive and
        // the first match is the answer.
        let shape = if children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN))
        {
            ParamShape::Rest
        } else if self.default_of(id).is_some() {
            ParamShape::Defaulted
        } else if children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN))
        {
            ParamShape::Optional
        } else {
            ParamShape::Ordinary
        };

        Ok(Param {
            name,
            ty,
            origin,
            shape,
            known,
        })
    }

    fn lower_block(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        for statement in self.children(id) {
            // Everything after a `return` in the same block is dead. Lowering it
            // would put operations in a block that has already ended.
            if self.is_terminated() {
                break;
            }
            self.lower_statement(statement)?;
        }
        Ok(())
    }

    /// Symbols assigned anywhere inside a subtree.
    ///
    /// Collected before a loop body is lowered, because the header needs a
    /// parameter for each of them *before* the body can refer to it — the body
    /// reads the value the previous iteration produced, which does not exist yet.
    fn assigned_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        // Every form that writes to a name, not just `=`. Missing one does not
        // fail loudly: the header simply gets no parameter for that name, the
        // loop reads the value it had on entry, and the back edge never passes
        // the update. `for (let i = 0; i < n; i++)` then runs forever, and the
        // only thing that catches it is the SSA verifier noticing that the exit
        // reads a value the body defined.
        let written = match self.kind_of(root) {
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(root);
                match children.as_slice() {
                    [target, operator, _] => {
                        let token = self.kind_of(*operator).unwrap_or(0);
                        // A logical assignment writes on only one path, but
                        // "assigned anywhere in this subtree" is the question
                        // here, and a conditional write is still a write: the
                        // header needs the parameter or the merge has nothing
                        // to carry the updated value through.
                        if token == syntax::EQUALS_TOKEN
                            || compound_operator(token).is_some()
                            || logical_assignment(token).is_some()
                        {
                            Some(*target)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(root).data else {
                    return;
                };
                matches!(
                    small & syntax::prefix_operator::MASK,
                    syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
                )
                .then(|| self.children(root).first().copied())
                .flatten()
            }
            // Every postfix operator is a step, so no operator check is needed.
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.children(root).first().copied(),
            _ => None,
        };

        // Only a bare name is carried. `box.cell = c` and `xs[i] = c` write
        // *through* a reference and leave the reference itself alone, so they
        // need no loop parameter -- and taking the target's symbol anyway would
        // pick up the class member `cell`, a symbol no local scope declares,
        // which then looks like an assignment to a name from an enclosing scope
        // and gets the loop refused.
        if let Some(target) = written
            && self.kind_of(target) == Some(syntax::IDENTIFIER)
            && let Some(symbol) = self.node(target).symbol
            && !into.contains(&symbol.0)
        {
            into.push(symbol.0);
        }

        for child in &self.node(root).children {
            self.assigned_symbols(*child, into);
        }
    }

    /// Symbols *declared* anywhere inside a subtree.
    ///
    /// A name declared inside a loop body is fresh on every iteration, so it is
    /// not carried across the back edge however often the body assigns it.
    /// Treating it as carried asks the header for a value that does not exist
    /// before the loop — which is the shape of `let x = 0` inside an outer loop,
    /// and therefore of every nested loop written the obvious way.
    fn declared_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        if self.kind_of(root) == Some(syntax::VARIABLE_DECLARATION)
            && let Some(name) = self.children(root).first()
            && let Some(symbol) = self.node(*name).symbol
        {
            into.push(symbol.0);
        }
        for child in &self.node(root).children {
            self.declared_symbols(*child, into);
        }
    }

    /// `while (c) { .. }`.
    ///
    /// # Where block parameters earn their keep
    ///
    /// A variable the body assigns has a different value on each iteration, and
    /// the header has to see whichever one the previous iteration produced. That
    /// is exactly a block parameter: the entry passes the initial value, the back
    /// edge passes the updated one, and the body reads the parameter.
    ///
    /// The parameters are created before the body is lowered, because the body
    /// refers to them. Which variables need one is a syntactic question —
    /// [`Self::assigned_symbols`] — answered by scanning the body first.
    fn lower_while(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [condition, body] = children.as_slice() else {
            return Err(self.unsupported(id, "a `while` of unexpected shape"));
        };

        let mut carried = Vec::new();
        self.assigned_symbols(*body, &mut carried);
        let mut declared = Vec::new();
        self.declared_symbols(*body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let origin = self.origin(id);
        let record = self.begin_loop(id, &carried, false, &origin)?;
        self.enter_loop(&record, Some(*condition))?;

        self.lower_statement(*body)?;
        self.end_loop(&record, Step::None)
    }

    /// `switch (x) { case a: .. }`.
    ///
    /// # Two orders, and they are not the same order
    ///
    /// A `switch` is *tested* in source order until something matches, and it
    /// is *laid out* in source order so that a clause without a `break` falls
    /// into the next one. `default` takes part in the second and not the first:
    /// it is reached only when every case has been tried, wherever it was
    /// written. So the tests form a chain that skips it and ends at it, while
    /// the clause blocks are threaded together in the order they appear.
    ///
    /// # Why every clause block takes parameters
    ///
    /// A clause is a merge: control arrives either from its own test or by
    /// falling out of the clause above, and those two disagree about what the
    /// carried names hold. That is the same reason a loop's exit takes
    /// parameters, for the same kind of reason.
    ///
    /// The comparison is `===` on the discriminant, which for the numbers and
    /// strings this compiler represents is what the specification's
    /// `StrictEquals` reduces to.
    fn lower_switch(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [discriminant, case_block] = children.as_slice() else {
            return Err(self.unsupported(id, "a `switch` of unexpected shape"));
        };
        let (discriminant, case_block) = (*discriminant, *case_block);
        if self.kind_of(case_block) != Some(syntax::CASE_BLOCK) {
            return Err(self.unsupported(id, "a `switch` without a case block"));
        }
        let clauses = self.children(case_block);
        let origin = self.origin(id);

        let mut carried = Vec::new();
        let mut declared = Vec::new();
        for clause in &clauses {
            self.assigned_symbols(*clause, &mut carried);
            self.declared_symbols(*clause, &mut declared);
        }
        carried.retain(|symbol| !declared.contains(symbol));

        let subject = self.lower_expression(discriminant)?;

        // Every block a clause or the exit needs, with its parameters, before
        // anything is lowered into one -- a fall-through edge is written before
        // the block it lands in has been visited.
        let mut blocks = Vec::new();
        for _ in &clauses {
            blocks.push(self.new_block());
        }
        let entering = self.carried_now(&carried);
        let mut exit_types = Vec::new();
        let mut clause_params: Vec<Vec<ValueId>> = vec![Vec::new(); clauses.len()];
        for value in &entering {
            let ty = self.values[value.0 as usize].ty.clone();
            exit_types.push(ty.clone());
            for (clause, block) in clause_params.iter_mut().zip(&blocks) {
                clause.push(self.push_block_param(*block, ty.clone(), origin.clone()));
            }
        }

        let depth = self.breakables.len();
        self.breakables.push(Breakable {
            exit: None,
            exit_types,
            origin: origin.clone(),
            latch: None,
            carried: carried.clone(),
            label: self.pending_label.take(),
            exits_at: self.exits.len(),
        });

        let chain = CaseChain {
            clauses: &clauses,
            blocks: &blocks,
            carried: &carried,
            origin: &origin,
            depth,
            exhaustive: self.covers_every_case(discriminant, &clauses),
        };
        self.lower_case_chain(&chain, subject)?;

        // The clauses, threaded in source order so a missing `break` falls
        // through -- which is what it means.
        for (at, clause) in clauses.iter().enumerate() {
            self.switch_to(blocks[at]);
            for (symbol, param) in carried.iter().zip(&clause_params[at]) {
                self.bindings.insert(*symbol, *param);
            }
            let statements: Vec<NodeId> = self
                .children(*clause)
                .into_iter()
                .skip(usize::from(
                    self.kind_of(*clause) == Some(syntax::CASE_CLAUSE),
                ))
                .collect();
            for statement in statements {
                if self.is_terminated() {
                    break;
                }
                self.lower_statement(statement)?;
            }
            if !self.is_terminated() {
                let reached = self.carried_now(&carried);
                let next = match blocks.get(at + 1) {
                    Some(block) => *block,
                    None => self.exit_of(depth).0,
                };
                self.terminate(Terminator::Jump {
                    target: next,
                    args: reached,
                });
            }
        }

        // A `switch` every clause returns from, with a `default` so nothing
        // falls past it, has nothing after it.
        let left = self.breakables[depth].exit.clone();
        self.breakables.pop();
        if let Some((exit, params)) = left {
            self.switch_to(exit);
            for (symbol, param) in carried.iter().zip(&params) {
                self.bindings.insert(*symbol, *param);
            }
        }
        Ok(())
    }

    /// The comparison chain a `switch` tests through, in source order.
    ///
    /// `default` is not in it. It is reached when every case has been tried,
    /// which is where the chain ends rather than somewhere along it — and that
    /// is true wherever in the source it was written.
    fn lower_case_chain(
        &mut self,
        chain: &CaseChain<'_>,
        subject: ValueId,
    ) -> Result<(), Diagnostic> {
        let CaseChain {
            clauses,
            blocks,
            carried,
            origin,
            depth,
            exhaustive,
        } = *chain;
        let default_at = clauses
            .iter()
            .position(|clause| self.kind_of(*clause) == Some(syntax::DEFAULT_CLAUSE));
        let cases: Vec<usize> = (0..clauses.len())
            .filter(|at| Some(*at) != default_at)
            .collect();

        // `switch (x) { }` and `switch (x) { default: }` have nothing to test.
        if cases.is_empty() {
            let reached = self.carried_now(carried);
            let target = match default_at {
                Some(at) => blocks[at],
                None => self.exit_of(depth).0,
            };
            self.terminate(Terminator::Jump {
                target,
                args: reached,
            });
            return Ok(());
        }

        // A `default` covers whatever the labels do not, so coverage only
        // matters where there is none.
        let exhaustive = exhaustive && default_at.is_none();
        let mut unreachable_tail = None;

        for (which, at) in cases.iter().enumerate() {
            let clause = clauses[*at];
            let label = *self
                .children(clause)
                .first()
                .ok_or_else(|| self.unsupported(clause, "a `case` with no label"))?;
            let label = self.lower_expression(label)?;
            // `Eq` on a string-typed operand reaches the backend as
            // `nts_string_eq`, so this one operation is `===` for every type
            // this compiler can switch on.
            let matched = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: subject,
                    rhs: label,
                },
                HirType::Bool,
                origin.clone(),
            );

            let reached = self.carried_now(carried);
            // A block in the middle of the chain is straight-line: control
            // arrives one way and the names are unchanged, so it takes no
            // parameters. Only the ends of the chain are merges.
            let chaining = which + 1 < cases.len();
            let (otherwise, otherwise_args) = if chaining {
                (self.new_block(), Vec::new())
            } else if let Some(at) = default_at {
                (blocks[at], reached.clone())
            } else if exhaustive {
                // Every value the discriminant can hold is a label, so the last
                // test's `else` is a point control does not reach. Saying so is
                // what keeps a `switch` whose every clause returns from looking
                // like a function that falls out of its end owing a value --
                // which is how `byteLengthIn` read, and TypeScript accepts it
                // precisely because the exit is unreachable.
                //
                // `Unreachable` rather than `FellThrough`: coverage is checked
                // below rather than assumed, so this is a claim with a proof.
                let nowhere = self.new_block();
                unreachable_tail = Some(nowhere);
                (nowhere, Vec::new())
            } else {
                (self.exit_of(depth).0, reached.clone())
            };
            self.terminate(Terminator::Branch {
                cond: matched,
                then_target: blocks[*at],
                then_args: reached,
                else_target: otherwise,
                else_args: otherwise_args,
            });
            if chaining {
                self.switch_to(otherwise);
            }
        }
        if let Some(nowhere) = unreachable_tail {
            let here = self.current;
            self.switch_to(nowhere);
            self.terminate(Terminator::Unreachable);
            self.switch_to(here);
        }
        Ok(())
    }

    /// Whether the `case` labels cover every value the discriminant can hold.
    ///
    /// Only where that is *decidable here*: a union of literal types, each of
    /// which some label matches. Anything else answers no, which costs a
    /// reachable exit and never costs a wrong one -- and a wrong one is a block
    /// the emitter fills with `__builtin_unreachable()`.
    ///
    /// TypeScript does this analysis too, and better; what it does not do is
    /// tell us the answer. So this is the narrow version of it, and the
    /// narrowness is the point.
    fn covers_every_case(&self, discriminant: NodeId, clauses: &[NodeId]) -> bool {
        let literal_of = |ty: &TypeId| -> Option<LiteralValue> {
            match &self.snapshot.types.get(ty.0 as usize)?.kind {
                TypeKind::Literal(value) => Some(value.clone()),
                _ => None,
            }
        };
        let Some(subject) = self.snapshot.node_types.get(&discriminant) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(subject.0 as usize) else {
            return false;
        };
        let TypeKind::Union(members) = &record.kind else {
            return false;
        };
        let Some(wanted) = members.iter().map(literal_of).collect::<Option<Vec<_>>>() else {
            return false;
        };
        let labels: Vec<LiteralValue> = clauses
            .iter()
            .filter_map(|clause| self.children(*clause).first().copied())
            .filter_map(|label| self.snapshot.node_types.get(&label))
            .filter_map(literal_of)
            .collect();
        !wanted.is_empty() && wanted.iter().all(|value| labels.contains(value))
    }

    /// `do { .. } while (c)`.
    ///
    /// The same loop as `while`, entered at the body instead of at the test.
    /// The header still holds the parameters, because the back edge still
    /// arrives there — what changes is only that the first pass reaches the
    /// body without asking.
    fn lower_do_while(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [body, condition] = children.as_slice() else {
            return Err(self.unsupported(id, "a `do` of unexpected shape"));
        };
        let (body, condition) = (*body, *condition);

        let mut carried = Vec::new();
        self.assigned_symbols(body, &mut carried);
        let mut declared = Vec::new();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let origin = self.origin(id);
        // A `do` loop tests at the *end*, so the header is where the test goes
        // and the body is entered from it unconditionally on every pass. The
        // first pass reaches the header through the entry edge like any other,
        // which is what makes "runs at least once" fall out rather than be
        // arranged: the header's only job is to hold the parameters.
        let record = self.begin_loop(id, &carried, true, &origin)?;
        self.enter_loop(&record, None)?;

        self.lower_statement(body)?;
        // The latch is where the test lives, so `continue` reaches it and the
        // condition is evaluated -- which is what `do { continue; } while (c)`
        // means.
        if !self.is_terminated() {
            let reached = self.carried_now(&record.carried);
            self.terminate(Terminator::Jump {
                target: record.latch,
                args: reached,
            });
        }
        self.switch_to(record.latch);
        for (symbol, param) in record.carried.iter().zip(&record.latch_params) {
            self.bindings.insert(*symbol, *param);
        }
        let cond = self.lower_expression(condition)?;
        let cond = self.truthy(condition, cond);
        let carried_here = self.carried_now(&record.carried);
        let (exit, exit_params) = self.exit_of(record.depth);
        self.terminate(Terminator::Branch {
            cond,
            then_target: record.header,
            then_args: carried_here.clone(),
            else_target: exit,
            else_args: carried_here,
        });

        self.breakables.pop();
        self.switch_to(exit);
        for (symbol, param) in record.carried.iter().zip(&exit_params) {
            self.bindings.insert(*symbol, *param);
        }
        Ok(())
    }

    /// Open a loop: jump to the header, give it a parameter per carried name,
    /// test the condition, and leave the builder positioned in the body.
    ///
    /// Returns the header's parameters and the exit block.
    /// Jump into a loop's header and give it a parameter per carried name.
    ///
    /// Stops there, in the header, because what comes next is the *test* --
    /// and a test is lowered where its operations belong, which is the header
    /// rather than the block before it. A `while` lowers an expression there; a
    /// `for...of` builds a comparison there that no source node describes.
    /// Begin a loop: the blocks, the parameters, and the record `break` and
    /// `continue` will look up.
    ///
    /// # Why the exit takes parameters
    ///
    /// A loop can be left two ways and they disagree about what its carried
    /// names hold. Leaving by the test means the *header's* parameters are the
    /// answer — the value at the top of the iteration that failed. Leaving by a
    /// `break` means whatever the body had reached at that point.
    ///
    /// So the exit is a merge, and a merge takes parameters here like any
    /// other. Before `break` existed there was one way out, the exit needed
    /// none, and the names were rebound to the header's — which was correct for
    /// exactly as long as it was the only way out.
    fn begin_loop(
        &mut self,
        id: NodeId,
        carried: &[u32],
        steps: bool,
        origin: &Origin,
    ) -> Result<Loop, Diagnostic> {
        let header = self.new_block();
        let body = self.new_block();
        let latch = if steps { self.new_block() } else { header };

        // The values entering the loop, in the order the parameters take them.
        let mut incoming = Vec::new();
        for symbol in carried {
            let value = *self.bindings.get(symbol).ok_or_else(|| {
                self.unsupported(id, "a loop assigning a name declared outside it")
            })?;
            incoming.push(value);
        }
        self.terminate(Terminator::Jump {
            target: header,
            args: incoming.clone(),
        });

        // Inside the loop, each carried name *is* its header parameter.
        self.switch_to(header);
        let mut header_params = Vec::new();
        let mut latch_params = Vec::new();
        let mut exit_types = Vec::new();
        for (symbol, entering) in carried.iter().zip(&incoming) {
            let ty = self.values[entering.0 as usize].ty.clone();
            let param = self.push_block_param(header, ty.clone(), origin.clone());
            self.bindings.insert(*symbol, param);
            header_params.push(param);
            exit_types.push(ty.clone());
            if latch != header {
                latch_params.push(self.push_block_param(latch, ty, origin.clone()));
            }
        }

        let depth = self.breakables.len();
        self.breakables.push(Breakable {
            exit: None,
            exit_types,
            origin: origin.clone(),
            latch: Some(latch),
            carried: carried.to_vec(),
            label: self.pending_label.take(),
            exits_at: self.exits.len(),
        });
        Ok(Loop {
            header,
            body,
            depth,
            latch,
            latch_params,
            carried: carried.to_vec(),
            header_params,
        })
    }

    /// Emit the loop's test and switch to its body.
    ///
    /// `None` is `for (;;)`, whose exit is reachable only through a `break` or
    /// a `return` — which is what the source says.
    fn enter_loop(&mut self, record: &Loop, condition: Option<NodeId>) -> Result<(), Diagnostic> {
        match condition {
            Some(condition) => {
                let cond = self.lower_expression(condition)?;
                let cond = self.truthy(condition, cond);
                self.test_loop(cond, record);
            }
            None => self.terminate(Terminator::Jump {
                target: record.body,
                args: Vec::new(),
            }),
        }
        self.switch_to(record.body);
        Ok(())
    }

    /// Into the body, or out of the loop with what the header holds.
    fn test_loop(&mut self, cond: ValueId, record: &Loop) {
        // A condition that is constantly true is `for (;;)` written another
        // way, and lowers the same way. The difference is not cosmetic: the
        // *test* is what creates the exit block, and a loop nothing leaves must
        // not have one -- `Breakable::exit` is lazy for exactly that reason,
        // and branching to it here defeats it. A `break` still makes one, which
        // is the only thing that should.
        //
        // Without this, `while (true)` left the function falling out of a block
        // it could never reach: `FellThrough` in a body that owes a value,
        // which the verifier rejects because nothing about the block tells it
        // apart from a wrong return type. It also emitted the dead branch.
        if matches!(self.values[cond.0 as usize].kind, OpKind::ConstBool(true)) {
            self.terminate(Terminator::Jump {
                target: record.body,
                args: Vec::new(),
            });
            return;
        }
        let (exit, _) = self.exit_of(record.depth);
        self.terminate(Terminator::Branch {
            cond,
            then_target: record.body,
            then_args: Vec::new(),
            else_target: exit,
            else_args: record.header_params.clone(),
        });
    }

    /// The block after an enclosing construct, made the first time something
    /// needs one.
    fn exit_of(&mut self, depth: usize) -> (BlockId, Vec<ValueId>) {
        if let Some(made) = &self.breakables[depth].exit {
            return made.clone();
        }
        let types = self.breakables[depth].exit_types.clone();
        let origin = self.breakables[depth].origin.clone();
        let block = self.new_block();
        let params: Vec<ValueId> = types
            .into_iter()
            .map(|ty| self.push_block_param(block, ty, origin.clone()))
            .collect();
        let made = (block, params);
        self.breakables[depth].exit = Some(made.clone());
        made
    }

    /// Close the iteration, run the update where there is one, and leave the
    /// loop with its names bound to the exit's parameters — which is where
    /// every way out of it agrees.
    fn end_loop(&mut self, record: &Loop, step: Step) -> Result<(), Diagnostic> {
        // The body falls into the latch, which is the header unless the loop
        // steps.
        if !self.is_terminated() {
            let reached = self.carried_now(&record.carried);
            self.terminate(Terminator::Jump {
                target: record.latch,
                args: reached,
            });
        }

        if record.latch != record.header {
            self.switch_to(record.latch);
            for (symbol, param) in record.carried.iter().zip(&record.latch_params) {
                self.bindings.insert(*symbol, *param);
            }
            match step {
                Step::None => {}
                Step::Expression(update) => {
                    self.lower_expression(update)?;
                }
                Step::Walk {
                    cursor,
                    walk,
                    sequence,
                } => {
                    let origin = self.breakables[record.depth].origin.clone();
                    let at = self.bindings[&cursor];
                    let next = self.advance(&walk, sequence, at, &origin);
                    self.bindings.insert(cursor, next);
                }
                Step::Increment(symbol) => {
                    let origin = self.breakables[record.depth].origin.clone();
                    let at = self.bindings[&symbol];
                    let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                    let next = self.push(
                        OpKind::Binary {
                            op: BinOp::Add,
                            lhs: at,
                            rhs: one,
                        },
                        HirType::NUMBER,
                        origin,
                    );
                    self.bindings.insert(symbol, next);
                }
            }
            let stepped = self.carried_now(&record.carried);
            self.terminate(Terminator::Jump {
                target: record.header,
                args: stepped,
            });
        }

        // A loop nothing leaves has no exit, and what follows it is
        // unreachable -- so the enclosing block stays closed, exactly as it
        // does when both arms of an `if` end.
        let left = self.breakables[record.depth].exit.clone();
        self.breakables.pop();
        if let Some((exit, params)) = left {
            self.switch_to(exit);
            for (symbol, param) in record.carried.iter().zip(&params) {
                self.bindings.insert(*symbol, *param);
            }
        }
        Ok(())
    }

    /// Terminate whatever block a body ended in.
    ///
    /// Falling off the end of a `void` function returns nothing, which is what
    /// it means. Falling off the end of one that returns a value cannot happen:
    /// TypeScript rejects a function that might, so the point is unreachable
    /// and saying `return;` there is a type error in C rather than a
    /// conservative choice.
    ///
    /// `while (true) { ... return x; }` is the ordinary way to arrive here. The
    /// loop's exit is a real edge — the condition is constant but the branch is
    /// not folded when this runs — and nothing follows it.
    fn close_body(&mut self, return_type: &HirType) {
        if matches!(return_type, HirType::Void) {
            self.terminate(Terminator::Return(None));
        } else {
            // Not `Unreachable`: this is an absence rather than a claim, and
            // the verifier holds it to being dead.
            self.terminate(Terminator::FellThrough);
        }
    }

    /// What each carried name holds right here.
    fn carried_now(&self, carried: &[u32]) -> Vec<ValueId> {
        carried.iter().map(|symbol| self.bindings[symbol]).collect()
    }

    /// `break` — leave the innermost loop or switch, carrying what has been
    /// reached.
    fn lower_break(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let depth = self.enclosing(id, "break", |it| it.latch.is_some() || it.latch.is_none())?;
        // Every `try` between here and the loop is left, so each one's
        // `finally` runs -- before the carried names are read, because a
        // `finally` that assigns one of them assigns it before the loop ends.
        self.run_finallys_to(self.breakables[depth].exits_at)?;
        if self.is_terminated() {
            return Ok(());
        }
        let carried = self.breakables[depth].carried.clone();
        let args = self.carried_now(&carried);
        let (exit, _) = self.exit_of(depth);
        self.terminate(Terminator::Jump { target: exit, args });
        Ok(())
    }

    /// `continue` — begin the next iteration with what the body has reached.
    ///
    /// It looks past a `switch`, which is not a thing to continue.
    fn lower_continue(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let depth = self.enclosing(id, "continue", |it| it.latch.is_some())?;
        // The same as `break`: an iteration that ends early still leaves every
        // `try` inside the loop that it was in.
        self.run_finallys_to(self.breakables[depth].exits_at)?;
        if self.is_terminated() {
            return Ok(());
        }
        let it = self.breakables[depth].clone();
        let args = self.carried_now(&it.carried);
        let latch = it.latch.expect("the predicate above admits only loops");
        self.terminate(Terminator::Jump {
            target: latch,
            args,
        });
        Ok(())
    }

    /// `yield e`.
    ///
    /// Lowered to [`OpKind::Yield`] and left there, for the reason `await` is:
    /// which values have to survive the suspension is a whole-function question
    /// and this walk cannot answer it. See [`super::suspend`].
    ///
    /// Two things are refused here rather than downstream, because both are
    /// about what the *walk* on the other end can do.
    ///
    /// `yield*` delegates to another iterable, which is a loop the caller
    /// cannot see -- one `next` on this generator is an unbounded number of
    /// steps on the inner one, and the state machine would need a nested cursor
    /// in the frame rather than a state number.
    ///
    /// The **value** of a `yield` is what the caller passed to `next(v)`, and a
    /// `for...of` never passes one: it calls `next()` with nothing, so the
    /// expression is always `undefined` there. Using it means the program
    /// expects a two-way conversation, and answering `undefined` to that is a
    /// wrong answer rather than a missing feature.
    fn lower_yield(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if self.generator.is_none() {
            return Err(self.unsupported(id, "a `yield` outside a generator"));
        }
        if self
            .children(id)
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::ASTERISK_TOKEN))
        {
            return Err(self.unsupported(id, "a `yield*`"));
        }
        if !self.is_a_statement(id) {
            return Err(self.unsupported(id, "the value of a `yield`"));
        }
        let operand = *self
            .children(id)
            .iter()
            .find(|child| self.kind_of(**child) != Some(syntax::ASTERISK_TOKEN))
            .ok_or_else(|| self.unsupported(id, "a `yield` of nothing"))?;
        let yields = self
            .generator
            .as_ref()
            .map_or(HirType::Void, |frame| frame.yields.clone());
        let value = self.lower_expression(operand)?;
        // At the frame's representation, exactly as a `return` is at the
        // function's: the store and the walk's load are the same field, and
        // coercing at one end only is how they come to disagree.
        let value = self.coerce(value, &yields, operand)?;
        let origin = self.origin(id);
        Ok(self.push(OpKind::Yield { value }, HirType::Void, origin))
    }

    /// Whether an expression is the whole of an expression statement.
    fn is_a_statement(&self, id: NodeId) -> bool {
        self.snapshot
            .nodes
            .get(id.0 as usize)
            .and_then(|node| node.parent)
            .is_some_and(|parent| self.kind_of(parent) == Some(syntax::EXPRESSION_STATEMENT))
    }

    /// `await e`.
    ///
    /// Lowered to [`OpKind::Await`] and left there. Turning it into a
    /// suspension needs the frame layout, and the frame layout needs to know
    /// which values are live across *every* await in the function -- which is a
    /// whole-function question this walk is in no position to answer. See
    /// [`super::suspend`].
    ///
    /// `await` outside an `async` function is top-level await, which is a
    /// different thing again: the module becomes the suspending body and its
    /// exports settle when it finishes.
    fn lower_await(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if self.async_result.is_none() {
            return Err(self.unsupported(id, "a top-level `await`"));
        }
        let operand = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "an `await` of nothing"))?;
        let promise = self.lower_expression(operand)?;
        let HirType::Managed(ManagedType::Promise(payload)) =
            self.values[promise.0 as usize].ty.clone()
        else {
            // `await 1` is legal and means `Promise.resolve(1)`, which is a
            // suspension of one tick rather than none. Refused rather than
            // treated as the identity, because the tick is observable.
            return Err(self.unsupported(id, "an `await` of something that is not a promise"));
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::Await { promise }, *payload, origin))
    }

    /// `Promise.resolve(v)` and `Promise.reject(e)`.
    ///
    /// `None` when the callee is not one of them, which is a different answer
    /// from `Some(Err(..))`: the second is one of these given something it
    /// cannot take, and it says so rather than falling through to a diagnostic
    /// about a member of `Promise` that does not exist.
    ///
    /// Already settled, which is not the same as synchronous. A reaction
    /// subscribed to one of these still runs on the microtask queue, one tick
    /// later, because running it inline would be a different observable order.
    /// That is the runtime's rule and this does not have to restate it.
    /// A static whose answer the checker's types already contain.
    ///
    /// `Array.isArray(x)` is a constant wherever the argument has a static
    /// type, and so is `Object.hasOwn(o, "k")` wherever the layout is known:
    /// there is nothing to ask at run time, because the question was settled
    /// when the type was. `Object.keys(o)` is the same fact one step further --
    /// the field names of a layout, which is a list the compiler is holding.
    ///
    /// Answered from the *checker's* type rather than from the representation,
    /// which is the whole subtlety. A `Uint8Array` is a `Managed(Array(u8))`
    /// here, and `Array.isArray(new Uint8Array(4))` is **false** in node -- a
    /// typed array is not an Array. Reading the representation would have
    /// answered `true` and been wrong in a way nothing else would catch.
    fn lower_decided_static(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let [object, member] = parts.as_slice() else {
            return None;
        };
        if self.kind_of(*object) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let global = self.node(*object).text.clone()?;
        let name = self.node(*member).text.clone()?;

        match (global.as_str(), name.as_str(), arguments) {
            ("Array", "isArray", [argument]) => Some(self.decide_is_array(id, *argument)),
            // `Array.from(xs)` where `xs` is already an array is a copy, which
            // is what `[...xs]` is and what `slice` already does. Twelve of the
            // twenty-two `Array.from` calls in `runtime/node` take one
            // argument; the ones that take a mapper, or something that is
            // iterable without being an array, are a different question and
            // fall through to being refused by name.
            ("Array", "from", [argument]) => Some(self.lower_array_from(id, *argument)),
            // The two-argument form is two features wearing one name. With an
            // iterable it is `map` fused into the walk, which the callback
            // machinery does for `xs.map(f)` and would have to do here; with
            // `{ length: n }` it is not an iteration at all -- an *array-like*
            // is read by index, and `Array.from({ length: 4 })` builds four
            // `undefined`s from an object that has no elements. Both are in
            // `runtime/node`, and neither is this.
            ("Array", "from", [_, _]) => Some(Err(self.unsupported(
                id,
                "an `Array.from` with a mapping callback, or over an array-like",
            ))),
            ("Object", "keys", [argument]) => Some(self.decide_object_keys(id, *argument)),
            ("Object", "hasOwn", [argument, key]) => Some(self.decide_has_own(id, *argument, *key)),
            // `BigInt.asIntN(64, v)`, which is how the profile reads a signed
            // 64-bit quantity back out of an unsigned one. A width and a value,
            // both already machine types here.
            ("BigInt", helper @ ("asIntN" | "asUintN"), [width, value]) => {
                let call = if helper == "asIntN" {
                    "nts_bigint_as_intn"
                } else {
                    "nts_bigint_as_uintn"
                };
                Some(self.decide_as_n(id, call, *width, *value))
            }
            _ => None,
        }
    }

    /// `Array.from(xs)`: the walk, appending.
    ///
    /// # Why this is the walk and not four special cases
    ///
    /// `Array.from` takes *anything iterable*, and this compiler already knows
    /// how to iterate five things -- an array, a typed array, a string by code
    /// point, a `Map` or `Set`, a user type with `[Symbol.iterator]`, and a
    /// generator. [`Self::walk_of`] is that knowledge, and it is the same
    /// function a `for...of` asks. So this is a loop over the walk with an
    /// append where the body would be, and every shape `for...of` learns
    /// afterwards arrives here for nothing.
    ///
    /// It replaced a version that handled one case: `Array.from(xs)` where
    /// `xs` was already an array, lowered as `slice`. That refused a typed
    /// array by name (`slice` reads doubles or pointers and a `Uint8Array` is
    /// neither), refused a string, and refused a `Set` -- which together are
    /// **eight of the ten `Array.from` calls in `runtime/node`**, and the copy
    /// it did handle is the one case that had `[...xs]` as an alternative.
    ///
    /// # What the loop looks like
    ///
    /// The array is allocated empty *before* the loop and appended to, so it
    /// dominates the body and is not a carried name -- only the cursor is. That
    /// is the same reason `for...of` does not carry the sequence.
    ///
    /// The length is not known in advance for three of the five shapes: a
    /// `Map` with holes, a string by code point, and a generator. Asking for it
    /// where it *is* known would size the allocation exactly and cost a second
    /// path through this function to be wrong in; the growth strategy record
    /// 0029 describes is what makes appending the right answer for all five.
    fn lower_array_from(&mut self, id: NodeId, argument: NodeId) -> Result<ValueId, Diagnostic> {
        // An array source keeps its `slice`, and the reason is measured rather
        // than assumed. 256 elements copied two thousand times, against a C++
        // reference at 41.65 us:
        //
        //     walked   462.77 us   12.18x C++   3.80x node
        //     sliced    53.07 us    1.27x C++   0.45x node
        //
        // **8.7x**, and sliced it beats node. A `slice` is a memcpy of one run
        // of memory whose length is known before it starts; the walk is a
        // bounds check, a load and a store per element.
        //
        // This comment said 1.34x for a while, from a benchmark run under a
        // provider that never frees -- so both variants were measuring page
        // faults and the difference between them nearly vanished. Record 0102
        // is about that.
        //
        // Every other shape has no run of memory to copy: a `Set` with holes, a
        // string by code point, a generator. So this is one specialization with
        // a number on it rather than two paths kept in step.
        //
        // Exactly the two element widths `slice` reads -- a double and a
        // pointer. A **typed** array is `Array` too and is neither, and routing
        // one here refused it by name: `slice` moves eight bytes or a word, and
        // a `Uint8Array` holds one. That was a regression this file's own
        // example caught within the hour, and it is why the test asks for the
        // typed source rather than for "an array".
        if matches!(
            self.type_of(argument),
            Some(HirType::Managed(ManagedType::Array(element)))
                if matches!(*element, HirType::Float { bits: 64 } | HirType::Managed(_))
        ) && let Some(ty) = self.type_of(id)
        {
            let origin = self.origin(id);
            return self.lower_array_copy(argument, &ty, &origin);
        }
        let (sequence, forced) = self.table_source(argument);
        let sequence_value = self.lower_expression(sequence)?;
        let walk = self.walk_of(sequence, sequence_value, forced, 1)?;

        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "what `Array.from` builds"))?;
        let HirType::Managed(ManagedType::Array(element_ty)) = ty.clone() else {
            return Err(self.unsupported(id, "an `Array.from` that does not build an array"));
        };
        let append = match *element_ty {
            HirType::Managed(_) => "nts_array_push_ref",
            HirType::Float { bits: 64 } => "nts_array_push",
            // A narrower element is a *typed* array being built, which
            // `Array.from` does not do -- `Uint8Array.from` does, and is its
            // own question.
            _ => return Err(self.unsupported(id, "an `Array.from` building a typed array")),
        };

        // How many elements are coming, where that is known before the walk
        // starts. Three of the five shapes know: an array and a typed array
        // from their length, a `Map` or `Set` from its live entry count --
        // which is the same `Length`, because a table keeps it in the header
        // field an array uses.
        //
        // Two do not, and cannot. A string's code points are one or two units
        // each, so its `length` is an upper bound and not an answer; a
        // generator's elements do not exist until it is asked for them.
        //
        // The difference is worth a branch here, and the evidence is *not* the
        // timing: `Array.from(set)` over 256 elements two thousand times reads
        // 1.86 ms growing against 1.84 ms sized, which is no change. It is the
        // allocation count, which goes from nine to five for a sixteen-element
        // walk -- `tooling/memory/cases/array-from`. Doubling makes the copying
        // about one extra pass, and one extra pass over two kilobytes is not
        // what a timing harness can see.
        //
        // Measured twice, under both providers, because the sibling decision
        // above was measured under the wrong one and had to be retracted.
        let counted = matches!(
            walk,
            Walk::Counted(_) | Walk::Table { .. } | Walk::Entries { .. }
        );
        let start = if counted {
            self.push(OpKind::Length(sequence_value), HirType::NUMBER, origin.clone())
        } else {
            self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone())
        };
        let out = self.push(
            OpKind::ArrayNew {
                length: start,
                zeroed: true,
            },
            ty.clone(),
            origin.clone(),
        );

        let index = self.walk_cursor(&walk, sequence_value, &origin);
        // Where the *next element goes*, which is not the cursor: a table's
        // cursor is an entry index and its holes are not elements, so a walk
        // that wrote at the cursor would leave gaps and run off the end.
        let filled = self.synthetic_symbol();
        if counted {
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            self.bindings.insert(filled, zero);
        }
        let mut carried: Vec<u32> = index.into_iter().collect();
        if counted {
            carried.push(filled);
        }
        let steps = !matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. });
        let record = self.begin_loop(id, &carried, steps, &origin)?;

        let (stepped, at) = if let Some(index) = index {
            (None, self.bindings[&index])
        } else {
            let (step, done) = self.protocol_step(id, &walk, &origin)?;
            (Some(step), done)
        };
        let cond = self.walk_condition(&walk, at, sequence_value, &origin);
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let element = self.walk_element(&walk, sequence_value, at, stepped, &origin);
        let element = self.coerce(element, &element_ty, sequence)?;
        if counted {
            let position = self.bindings[&filled];
            self.push(
                OpKind::ArraySet {
                    array: out,
                    index: position,
                    value: element,
                    // Checked, and `hir::bounds` is what should remove it: the
                    // array was allocated at the walk's own length and the
                    // position advances once per element, so a proof exists.
                    // Asserting it here instead would be this lowering
                    // promising something no pass had verified.
                    checked: true,
                },
                HirType::Void,
                origin.clone(),
            );
            let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
            let next = self.push(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: position,
                    rhs: one,
                },
                HirType::NUMBER,
                origin.clone(),
            );
            self.bindings.insert(filled, next);
        } else {
            self.runtime_call(append, vec![out, element], HirType::Void, origin.clone());
        }

        let step = match index {
            None => Step::None,
            Some(cursor) => Step::Walk {
                cursor,
                walk,
                sequence: sequence_value,
            },
        };
        self.end_loop(&record, step)?;
        Ok(out)
    }

    /// The one value a walk hands the body, whichever kind of walk it is.
    ///
    /// The two cursorless walks read theirs out of what the step returned --
    /// a generator's frame, or the `{ value, done }` an iterator built -- and
    /// the three with a cursor read the sequence at it. Written once because
    /// `for...of` and `Array.from` both need exactly this and had it inline.
    fn walk_element(
        &mut self,
        walk: &Walk,
        sequence: ValueId,
        at: ValueId,
        stepped: Option<ValueId>,
        origin: &Origin,
    ) -> ValueId {
        match (walk, stepped) {
            (Walk::Generator { element, .. }, Some(frame)) => {
                let element = element.clone();
                self.push(
                    OpKind::FieldGet {
                        object: frame,
                        field: super::suspend::FIELD_YIELDED,
                    },
                    element,
                    origin.clone(),
                )
            }
            (Walk::Protocol { value, element, .. }, Some(step)) => {
                let (value, element) = (*value, element.clone());
                self.push(
                    OpKind::FieldGet {
                        object: step,
                        field: value,
                    },
                    element,
                    origin.clone(),
                )
            }
            _ => {
                let mut values = self.read_element(walk, sequence, at, origin);
                values.remove(0)
            }
        }
    }

    /// The field names of whatever the argument's layout is.
    fn own_names(&mut self, id: NodeId, argument: NodeId) -> Result<Vec<String>, Diagnostic> {
        let ty = self
            .snapshot
            .node_types
            .get(&argument)
            .copied()
            .map(|ty| self.class_behind(ty))
            .ok_or_else(|| self.unsupported(id, "a static over a value with no type"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = self
            .represent(ty)
            .ok_or_else(|| self.unrepresentable(id, "the argument of an `Object` static"))?
        else {
            return Err(self.unsupported(
                id,
                "an `Object` static over something that is not an object here",
            ));
        };
        // An **optional** property is not a name the layout can answer for.
        //
        // `Object.keys` and `Object.hasOwn` report what an object *has*, and an
        // optional property's slot exists whether or not it was written -- so
        // the declaration says `maybe` is there and the value may disagree.
        // `{ keep: 1 }` against `interface Bag { keep: number; maybe?: number }`
        // gave `["keep", "maybe"]` where node gives `["keep"]`, which the
        // differential reported on 29 of 29 cases once a fixture asked.
        //
        // Refused rather than answered from the tag, and the reason is the same
        // one `in` gives for the same property: an optional slot holds
        // `T | undefined` and a fresh allocation is zeroed, which is already the
        // `undefined` tag -- so `{}` and `{ maybe: undefined }` are one object
        // here and JavaScript says their key lists differ.
        //
        // A run-time answer is possible and is a different feature: a loop over
        // the layout testing each optional tag, producing an array whose length
        // is not known until it runs. Nothing in the profile asks for it.
        if let Some(optional) = self.optional_property_of(type_id) {
            return Err(self.unsupported(
                id,
                &format!(
                    "an `Object` static over a type with the optional property `{optional}`, \
                     whose presence is a fact about the value rather than the type"
                ),
            ));
        }
        let layout = self.layout_of(id, type_id)?;
        Ok(layout
            .fields
            .iter()
            .map(|field| field.name.clone())
            .collect())
    }

    /// The first optional property a type declares, where it has one.
    fn optional_property_of(&self, ty: TypeId) -> Option<String> {
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        properties
            .iter()
            .find(|property| property.optional)
            .map(|property| property.name.clone())
    }

    /// `map.forEach(cb)` and `set.forEach(cb)`, as the walk they are.
    ///
    /// The same loop `for...of` builds over a table -- `walk_cursor` for the
    /// entry index, `walk_condition` for the test, `read_element` for the reads,
    /// `Step::Walk` for the advance -- with the callback's body inlined where
    /// the head's bindings would go. Nothing is allocated and nothing is called
    /// indirectly, which is what `examples/callbacks` says about the array
    /// methods and is now true of these.
    ///
    /// # The callback's parameters
    ///
    /// `(value, key, map)` for a `Map`, which is **not** the order the table
    /// stores them in: `read_element` answers `[key, value]` because that is
    /// what `for (const [k, v] of map)` binds, and `forEach` hands the value
    /// first. Getting that backwards does not fail -- it computes a different
    /// number -- so the example asks node about a map whose keys and values are
    /// different.
    ///
    /// A `Set` has no values, and node passes the element **twice**:
    /// `s.forEach((v, k) => ...)` sees `v === k`. So the second parameter is the
    /// same read as the first rather than an error, which is what the language
    /// says and what the differential checks.
    fn lower_table_for_each(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        table: &HirType,
        callback: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let parameters = self.callback_parameters(callback, "forEach")?;
        // The value, optionally the key. The third parameter is the table
        // itself, refused for the reason the array's third is: handing the
        // receiver to the body lets it be stored where the loop cannot see.
        if parameters.is_empty() || parameters.len() > 2 {
            return Err(self.unsupported(
                callback,
                &format!(
                    "a `forEach` callback taking {} parameters, where it may take 1 or 2 -- \
                     the value and the key",
                    parameters.len()
                ),
            ));
        }
        let body = *self
            .children(callback)
            .last()
            .ok_or_else(|| self.unsupported(callback, "a `forEach` callback with no body"))?;

        // Entries for a `Map`, and the same read twice for a `Set`.
        let walk = match table {
            HirType::Managed(ManagedType::Map(key, value)) => Walk::Entries {
                key: (**key).clone(),
                value: (**value).clone(),
                value_read: "nts_map_value_at",
            },
            HirType::Managed(ManagedType::Set(element)) => Walk::Entries {
                key: (**element).clone(),
                value: (**element).clone(),
                value_read: "nts_map_key_at",
            },
            _ => {
                return Err(self.unsupported(id, "a `forEach` over something that is not a table"));
            }
        };

        let origin = self.origin(id);
        let cursor = self
            .walk_cursor(&walk, receiver, &origin)
            .ok_or_else(|| self.unsupported(id, "a table walk with no cursor"))?;
        let synthetic = vec![cursor];
        let carried = self.carried_across(body, &synthetic, &parameters);
        let record = self.begin_loop(id, &carried, true, &origin)?;

        let at = self.bindings[&cursor];
        let cond = self.walk_condition(&walk, at, receiver, &origin);
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let at = self.bindings[&cursor];
        let read = self.read_element(&walk, receiver, at, &origin);
        let [key, value] = read.as_slice() else {
            return Err(self.unsupported(id, "a table walk that did not read a pair"));
        };
        // Value first. See above.
        self.bindings.insert(parameters[0], *value);
        if let Some(second) = parameters.get(1) {
            self.bindings.insert(*second, *key);
        }

        // `forEach` drops whatever the body produces, and a `return` inside it
        // is a `continue` -- the same delivery the array's `forEach` uses.
        let result = CallbackResult::Discard;
        self.callback_returns.push(CallbackReturn {
            depth: record.depth,
            result,
        });
        let concise = self.kind_of(body) != Some(syntax::BLOCK);
        let lowered = if concise {
            self.lower_expression(body).map(|_| ())
        } else {
            self.lower_statement(body)
        };
        self.callback_returns.pop();
        lowered?;

        self.end_loop(
            &record,
            Step::Walk {
                cursor,
                walk,
                sequence: receiver,
            },
        )?;
        // `forEach` evaluates to `undefined`, which is `void` here.
        Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
    }

    /// `Object.keys(o)`, as the array of names the layout already holds.
    ///
    /// Insertion order is declaration order, which is what a layout is: fields
    /// are laid out base-first and in the order the class declares them, and
    /// that is the order `Object.keys` is specified to produce for string keys
    /// that are not array indices.
    fn decide_object_keys(&mut self, id: NodeId, argument: NodeId) -> Result<ValueId, Diagnostic> {
        // Lowered for its effects even though the answer does not depend on it:
        // `Object.keys(f())` calls `f`.
        let _ = self.lower_expression(argument)?;
        let names = self.own_names(id, argument)?;
        let origin = self.origin(id);
        let element = HirType::Managed(ManagedType::String);
        let ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        #[allow(clippy::cast_precision_loss)]
        let count = names.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                zeroed: true,
            },
            ty.clone(),
            origin.clone(),
        );
        for (at, name) in names.into_iter().enumerate() {
            #[allow(clippy::cast_precision_loss)]
            let position = at as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            let value = self.push(OpKind::ConstString(name), element.clone(), origin.clone());
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: false,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// `Object.hasOwn(o, "k")`, which a layout answers with a constant.
    fn decide_has_own(
        &mut self,
        id: NodeId,
        argument: NodeId,
        key: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let _ = self.lower_expression(argument)?;
        let Some(wanted) = self.literal_name(key) else {
            // A computed key is a question about a *value*, and a layout cannot
            // answer it. Named rather than guessed.
            return Err(self.unsupported(key, "`Object.hasOwn` with a key the program computes"));
        };
        let names = self.own_names(id, argument)?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstBool(names.contains(&wanted)),
            HirType::Bool,
            origin,
        ))
    }

    /// `BigInt.asIntN(bits, v)` and its unsigned twin.
    fn decide_as_n(
        &mut self,
        id: NodeId,
        helper: &str,
        width: NodeId,
        value: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let width = self.lower_expression(width)?;
        let value = self.lower_expression(value)?;
        if self.values[value.0 as usize].ty != HirType::BigInt {
            return Err(self.unsupported(id, "`BigInt.asIntN` of something that is not a `bigint`"));
        }
        let origin = self.origin(id);
        Ok(self.call_runtime(helper, vec![width, value], HirType::BigInt, &origin))
    }

    /// `Array.isArray(x)`, from the checker's type rather than the machine one.
    fn decide_is_array(&mut self, id: NodeId, argument: NodeId) -> Result<ValueId, Diagnostic> {
        let _ = self.lower_expression(argument)?;
        let ty = self
            .snapshot
            .node_types
            .get(&argument)
            .copied()
            .ok_or_else(|| self.unsupported(id, "`Array.isArray` of a value with no type"))?;
        let record = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .ok_or_else(|| self.unsupported(id, "`Array.isArray` of an unknown type"))?;
        let answer = match &record.kind {
            // A tuple *is* an Array: `Array.isArray([1, "a"])` is true, however
            // this compiler chooses to lay it out -- a heterogeneous one is a
            // struct here and still an Array in the language.
            TypeKind::Array(_) | TypeKind::Tuple(_) => true,
            // Anything the checker has left open cannot be decided here, and a
            // guess would be a wrong answer rather than a missing one. A tag
            // test is what this needs, and the tag does not distinguish an
            // array from an object yet.
            TypeKind::Any | TypeKind::Unknown | TypeKind::Union(_) => {
                return Err(self.unsupported(
                    id,
                    "`Array.isArray` of a value whose type is open, which needs a runtime tag",
                ));
            }
            // Everything else is not an Array -- including a `Uint8Array`,
            // which this compiler represents as one and node does not call one.
            _ => false,
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstBool(answer), HirType::Bool, origin))
    }

    /// The call forms that are not ordinary calls.
    ///
    /// Three kinds, and they are asked in this order because each is narrower
    /// than the last:
    ///
    /// `Math.floor(x)` and friends are *operations*. Lowering them as
    /// operations is what lets the analysis see that the result is a whole
    /// number, which is the entire reason an author writes `Math.floor` rather
    /// than a division.
    ///
    /// `Array.isArray(x)`, `Object.keys(o)` and `Object.hasOwn(o, "k")` are
    /// questions the *types* already answer, so they become constants.
    ///
    /// `Promise.resolve(v)` and `Promise.reject(e)` are constructors: each
    /// allocates a promise and settles it before anyone can subscribe.
    fn lower_special_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if let Some(intrinsic) = self.intrinsic_of(callee) {
            return Some(self.lower_intrinsic(id, intrinsic, arguments));
        }
        if let Some(decided) = self.lower_decided_static(id, callee, arguments) {
            return Some(decided);
        }
        self.lower_promise_static(id, callee, arguments)
    }

    fn lower_promise_static(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let object = *parts.first()?;
        let member = *parts.last()?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self.node(object).text.as_deref() != Some("Promise")
        {
            return None;
        }
        let member = self.node(member).text.clone()?;
        Some(match member.as_str() {
            "resolve" => self.settled_promise(id, arguments, false),
            "reject" => self.settled_promise(id, arguments, true),
            "all" => self.combinator(id, arguments, true),
            "race" => self.combinator(id, arguments, false),
            _ => return None,
        })
    }

    /// `Promise.all(xs)` and `Promise.race(xs)`.
    ///
    /// One function because they are one machine with two dials, which is the
    /// same claim the runtime makes: both subscribe to every element in order
    /// before returning, and both settle their result once. What differs is
    /// whether the values are kept.
    ///
    /// `collecting` is `all`. The result array is allocated *here* rather than
    /// in the runtime: whether a payload is a double or a pointer is a fact
    /// about the type, and an array carries its own descriptor, so allocating
    /// it on this side says that fact once instead of passing it separately.
    ///
    /// A heterogeneous tuple -- `Promise.all([Promise<number>, Promise<string>])`,
    /// whose result is `Promise<[number, string]>` -- needs no rule here. A
    /// tuple whose elements do not share a representation has none either, so
    /// the type is refused before this is reached.
    fn combinator(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        collecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise` combinator result"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
            return Err(self.unrepresentable(id, "a `Promise` combinator result"));
        };
        let [only] = arguments else {
            // `Promise.all()` and `Promise.all(a, b)` are both type errors, so
            // arriving here means the shape is not what this reads.
            return Err(self.unsupported(id, "a `Promise` combinator with these arguments"));
        };
        let promises = self.lower_expression(*only)?;
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[promises.0 as usize].ty.clone()
        else {
            // An iterable that is not an array: legal JavaScript, and it needs
            // the iteration protocol rather than a length and an index.
            return Err(self.unsupported(id, "a `Promise` combinator over a non-array"));
        };
        let HirType::Managed(ManagedType::Promise(settles)) = *element else {
            // `Promise.all([1, 2])` is legal and fulfils with the values
            // unchanged. Supporting it means a per-element test for whether a
            // value is a promise at all, which is a different mechanism from
            // this one rather than a bigger version of it.
            return Err(self.unsupported(id, "a `Promise` combinator over non-promises"));
        };
        let origin = self.origin(id);
        if !collecting {
            if *payload != *settles {
                return Err(self.unrepresentable(id, "a `Promise.race` result"));
            }
            return Ok(self.runtime_call("nts_promise_race", vec![promises], ty, origin));
        }
        // The checker's answer is `Promise<T[]>`; the argument's is `Promise<T>[]`.
        // They agree by construction, and disagreeing means this read one of
        // them wrong rather than that the program is unusual.
        let HirType::Managed(ManagedType::Array(collected)) = &*payload else {
            return Err(self.unrepresentable(id, "a `Promise.all` result"));
        };
        if **collected != *settles {
            return Err(self.unrepresentable(id, "a `Promise.all` result"));
        }
        let length = self.push(OpKind::Length(promises), HirType::NUMBER, origin.clone());
        let values = self.push(
            // Zeroed, because a rejection leaves it partly filled and a
            // collector that walked the rest would follow whatever was there.
            OpKind::ArrayNew {
                length,
                zeroed: true,
            },
            HirType::Managed(ManagedType::Array(collected.clone())),
            origin.clone(),
        );
        Ok(self.runtime_call("nts_promise_all", vec![promises, values], ty, origin))
    }

    /// The body of [`Self::lower_promise_static`], once the shape is known.
    fn settled_promise(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise` this compiler can settle"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
            return Err(self.unrepresentable(id, "a `Promise.resolve` result"));
        };
        let value = match arguments {
            [] => None,
            [only] => Some(self.lower_expression(*only)?),
            // `Promise.resolve(v, extra)` is not a thing the signature admits,
            // so reaching here means the shape is not what this reads.
            _ => return Err(self.unsupported(id, "a `Promise` call with this many arguments")),
        };
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty, origin);
        if rejecting {
            let reason =
                value.ok_or_else(|| self.unsupported(id, "a `Promise.reject` with no reason"))?;
            let origin = self.origin(id);
            self.runtime_call(
                "nts_promise_reject",
                vec![promise, reason],
                HirType::Void,
                origin,
            );
            return Ok(promise);
        }
        let result = AsyncResult {
            promise,
            payload: *payload,
        };
        self.settle(id, &result, value)?;
        Ok(promise)
    }

    /// Settle an `async` function's promise and hand it back.
    ///
    /// The function's HIR return type is the promise, not the payload, so every
    /// `return` in the body becomes two steps: settle, then return the promise
    /// that was allocated on entry.
    ///
    /// Which `fulfill` depends on the payload's representation, which is the
    /// whole reason [`ManagedType::Promise`] carries one. The runtime stores a
    /// tagged union and the tag has to be right: a number written into the
    /// reference slot is a pointer the collector would follow.
    fn settle_and_return(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        self.settle(id, result, value)?;
        self.terminate(Terminator::Return(Some(result.promise)));
        Ok(())
    }

    /// Write a value into a promise, through the helper its payload needs.
    ///
    /// Which one depends on the payload's representation, which is the whole
    /// reason [`ManagedType::Promise`] carries one. The runtime stores a tagged
    /// union and the tag has to be right: a number written into the reference
    /// slot is a pointer the collector would follow.
    fn settle(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // Settling a promise *with* a promise is adoption: the outer one
        // subscribes to the inner, waits, and takes its value -- two extra
        // ticks that a program can see through any interleaving. Storing the
        // inner promise in the payload slot instead would be a different value
        // of a different type.
        //
        // It was already an error, but the C compiler's: `NtsPromise *` does
        // not go where a `double` is wanted, so `return g(n)` from an `async`
        // function reported a clang diagnostic against generated code. That
        // reads as a compiler defect rather than as a construct this does not
        // implement, and only the number payload was loud -- a reference
        // payload would have compiled and settled with the wrong object.
        if let Some(value) = value
            && matches!(
                self.values[value.0 as usize].ty,
                HirType::Managed(ManagedType::Promise(_))
            )
        {
            return Err(self.unsupported(id, "a promise settled with another promise"));
        }
        let origin = self.origin(id);
        let (helper, args) = match (&result.payload, value) {
            (HirType::Void, _) | (_, None) => ("nts_promise_fulfill_void", vec![result.promise]),
            (HirType::Float { .. } | HirType::Int { .. } | HirType::Bool, Some(value)) => {
                ("nts_promise_fulfill_number", vec![result.promise, value])
            }
            // A promise settles through a two-slot union of a double and a
            // pointer, and a `bigint` is 128 bits of neither. Refused rather
            // than narrowed: settling one through the number slot would keep
            // the low 53 bits of a value whose whole reason for existing is
            // that 53 are not enough.
            (HirType::BigInt, Some(_)) => {
                return Err(self.unsupported(
                    id,
                    "an `async` function settling with a `bigint`, which does not fit the \
                     promise's payload",
                ));
            }
            // The tag, supplied rather than derived. The compiler emitted the
            // type, so it knows whether this is a string; making the runtime
            // read the header back to find out is asking a question that was
            // already answered.
            (HirType::Managed(managed), Some(value)) => {
                let tag = super::tags::of_reference(managed);
                let origin = self.origin(id);
                let tag = self.push(
                    OpKind::ConstInt(i128::from(tag)),
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    origin,
                );
                (
                    "nts_promise_fulfill_tagged",
                    vec![result.promise, value, tag],
                )
            }
            (HirType::Never, Some(_)) => {
                return Err(self.unrepresentable(id, "an `async` function returning `never`"));
            }
            // The runtime settles a promise with a number or with a reference,
            // and an erased value is neither: it is a tag beside a payload, so
            // fulfilling with one needs a third helper that knows the layout.
            // Refused rather than settled through whichever arm looks closest,
            // which is how a reference payload would have gone out as a double.
            (HirType::Erased, Some(_)) => {
                return Err(self.unsupported(id, "an `async` function settling with `unknown`"));
            }
        };
        Ok(self.runtime_call(helper, args, HirType::Void, origin))
    }

    /// `return` inside an inlined callback: end this iteration, not the
    /// function.
    ///
    /// The same jump `continue` makes, plus the binding of the value where the
    /// method reads one. Binding before taking the carried arguments is what
    /// makes the value arrive: the result name is one of the loop's carried
    /// symbols, so `carried_now` picks up what was just written.
    fn return_from_callback(
        &mut self,
        id: NodeId,
        target: CallbackReturn,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        self.deliver(id, &target.result, target.depth, value)?;
        let it = self.breakables[target.depth].clone();
        let args = self.carried_now(&it.carried);
        let latch = it
            .latch
            .expect("an inlined callback body is always inside a loop");
        self.terminate(Terminator::Jump {
            target: latch,
            args,
        });
        Ok(())
    }

    /// What a bare `break` or `continue` belongs to.
    ///
    /// A label is refused rather than ignored: `break outer` and `break` are
    /// different statements, and lowering one as the other would compile and
    /// leave the wrong construct.
    fn enclosing(
        &mut self,
        id: NodeId,
        what: &str,
        mut wanted: impl FnMut(&Breakable) -> bool,
    ) -> Result<usize, Diagnostic> {
        // `break outer` names the construct rather than taking the innermost
        // one. The name is the whole difference: everything below is the same
        // jump to the same block, with a different index chosen for it.
        if let Some(named) = self
            .children(id)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
        {
            let Some(name) = self.node(named).text.clone() else {
                return Err(self.unsupported(id, &format!("a labelled `{what}` with no name")));
            };
            return self
                .breakables
                .iter()
                .rposition(|it| it.label.as_deref() == Some(name.as_str()) && wanted(it))
                .ok_or_else(|| {
                    self.unsupported(
                        id,
                        &format!("a `{what}` naming a label that is not on a loop around it"),
                    )
                });
        }
        self.breakables
            .iter()
            .rposition(&mut wanted)
            .ok_or_else(|| self.unsupported(id, &format!("a `{what}` outside a loop")))
    }

    /// `for (init; cond; update) body`.
    ///
    /// The same shape as a `while`, with two differences that matter. The
    /// initializer runs once *before* the header, so a name it declares is in
    /// scope at the header and is carried across the back edge — unlike a name
    /// declared in the body, which is fresh each iteration. And the update runs
    /// at the end of the body, so the back edge carries what it produced.
    ///
    /// A missing condition is `for (;;)`: the loop is entered unconditionally.
    fn lower_for(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let Some([initializer, condition, update, body]) = self.child_slots::<4>(id) else {
            return Err(self.unsupported(id, "a `for` of unexpected shape"));
        };
        let Some(body) = body else {
            return Err(self.unsupported(id, "a `for` without a body"));
        };

        if let Some(initializer) = initializer {
            if self.kind_of(initializer) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                self.lower_variable_statement(initializer)?;
            } else {
                self.lower_expression(initializer)?;
            }
        }

        // The update assigns the loop variable too, so it counts toward what is
        // carried. Missing it is how `i` ends up defined in the body and read
        // from the header.
        let mut carried = Vec::new();
        self.assigned_symbols(body, &mut carried);
        if let Some(update) = update {
            self.assigned_symbols(update, &mut carried);
        }
        let mut declared = Vec::new();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let origin = self.origin(id);
        let record = self.begin_loop(id, &carried, update.is_some(), &origin)?;
        self.enter_loop(&record, condition)?;

        self.lower_statement(body)?;
        self.end_loop(&record, update.map_or(Step::None, Step::Expression))
    }

    /// A node's children assigned to their declared property slots.
    ///
    /// [`Self::children`] returns only the children that are *present*, so
    /// nothing about a position identifies which property it is. The node's
    /// presence bitmask does, one bit per property in visitor order.
    ///
    /// Reading positionally instead is wrong in two different ways, both of
    /// which happened: `for (;; i++)` becomes an infinite loop with `i++` as its
    /// condition, and `c ? a : b` picks up the `:` token as its true branch —
    /// which at least fails loudly, being a token where an expression belongs.
    /// `for (const x of xs)` over an array.
    ///
    /// Desugared to an index loop, which is what it is: the source names the
    /// element and this names the index. There is no iterator protocol here --
    /// `Symbol.iterator` is a dynamic dispatch through a property, and an array
    /// is the one case where the answer is known and the loop is a counter.
    /// Whether the loop runs again, built rather than lowered: the source has
    /// no node for this test.
    ///
    /// A position runs while it is inside the length; an entry index runs until
    /// the table says there is no next live entry; the protocol runs until the
    /// step it already took said it was done.
    fn walk_condition(
        &mut self,
        walk: &Walk,
        at: ValueId,
        sequence: ValueId,
        origin: &Origin,
    ) -> ValueId {
        match walk {
        // `done` says when to *stop*, so the loop runs while it is false.
        Walk::Protocol { .. } | Walk::Generator { .. } => self.push(
            OpKind::Unary {
                op: UnOp::Not,
                operand: at,
            },
            HirType::Bool,
            origin.clone(),
        ),
        Walk::Counted(_) | Walk::Text => {
            let length = self.push(
                OpKind::Length(sequence),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::Binary {
                    op: BinOp::Lt,
                    lhs: at,
                    rhs: length,
                },
                HirType::Bool,
                origin.clone(),
            )
        }
        Walk::Table { .. } | Walk::Entries { .. } => {
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            self.push(
                OpKind::Binary {
                    op: BinOp::Ge,
                    lhs: at,
                    rhs: zero,
                },
                HirType::Bool,
                origin.clone(),
            )
        }
        }
    }

    /// The cursor a walk steps, and `None` for the one that has none.
    ///
    /// A double, like the counter a hand-written `for` produces, so that
    /// specialization decides its machine type by the same rule rather than by
    /// which loop it came from. For an array and for text it is a position and
    /// starts at zero; for a table it is an entry index, and the entries are
    /// not contiguous, so the first live one is asked for rather than assumed.
    ///
    /// The protocol has none at all: the iterator holds its own place and
    /// `next()` is what moves it.
    fn walk_cursor(&mut self, walk: &Walk, sequence: ValueId, origin: &Origin) -> Option<u32> {
        if matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. }) {
            return None;
        }
        let index = self.synthetic_symbol();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let start = match walk {
            Walk::Table { .. } | Walk::Entries { .. } => {
                self.call_runtime("nts_map_next", vec![sequence, zero], HirType::NUMBER, origin)
            }
            _ => zero,
        };
        self.bindings.insert(index, start);
        Some(index)
    }

    /// One turn of the iteration protocol: the call that advances the iterator,
    /// and the `done` it answered with.
    ///
    /// Both come from a single `next()`, and the result is handed back so the
    /// body can read the element out of the same one.
    fn protocol_step(
        &mut self,
        id: NodeId,
        walk: &Walk,
        origin: &Origin,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        if let Walk::Generator { frame, resume, .. } = walk {
            let (frame, resume) = (*frame, resume.clone());
            // The frame is the state and the resumption is the step, so this is
            // one call and no loads. It answers `done`; the element it left
            // behind is read in the body, off the same frame.
            let answered = self.push(
                OpKind::Call {
                    callee: resume,
                    args: vec![frame],
                    frame: None,
                },
                HirType::Bool,
                origin.clone(),
            );
            return Ok((frame, answered));
        }
        let Walk::Protocol {
            iterator,
            next,
            result,
            done,
            ..
        } = walk
        else {
            return Err(self.unsupported(id, "a `for...of` with no cursor and no iterator"));
        };
        let (iterator, next, result, done) = (*iterator, next.clone(), result.clone(), *done);
        let step = self.push(
            OpKind::Call {
                callee: next,
                args: vec![iterator],
                frame: None,
            },
            result,
            origin.clone(),
        );
        let answered = self.push(
            OpKind::FieldGet {
                object: step,
                field: done,
            },
            HirType::Bool,
            origin.clone(),
        );
        Ok((step, answered))
    }

    /// A generator's frame, and what stepping it looks like.
    ///
    /// The frame is already here -- calling the generator made it, and calling
    /// one runs none of the body -- so unlike [`Self::protocol_walk`] this
    /// builds nothing. What it has to find is the *name* of the resumption,
    /// which does not exist yet: [`super::suspend`] splits the generator into
    /// an entry and a resumption long after this runs. The name is derived from
    /// the generator's, and the generator is whatever call produced this value.
    ///
    /// So a generator has to be walked where it was made. Handed to another
    /// function it arrives as a parameter, and a parameter has no call behind it
    /// to take a name from -- refused, by name, rather than guessed at.
    fn generator_walk(&mut self, sequence: NodeId, value: ValueId) -> Result<Walk, Diagnostic> {
        let OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } = &self.values[value.0 as usize].kind
        else {
            return Err(self.unsupported(
                sequence,
                "a `for...of` over a generator that was not called here",
            ));
        };
        let resume = Callee::Direct(super::suspend::resume_name(name));
        let HirType::Managed(ManagedType::Object(frame)) = self.values[value.0 as usize].ty else {
            unreachable!("the caller matched an object type");
        };
        let Some(layout) = self.generator_element(frame) else {
            return Err(self.unsupported(sequence, "a generator whose element was not reserved"));
        };
        Ok(Walk::Generator {
            frame: value,
            resume,
            element: layout,
        })
    }

    /// What the `n`th generator yields, from the reservation the lowering made.
    ///
    /// The frames are handed out in source order, so the id says which
    /// generator this is; asking the frame's *layout* would not work, because
    /// [`super::suspend`] has not built one yet.
    fn generator_element(&self, frame: TypeId) -> Option<HirType> {
        let which = (frame.0 - super::SYNTHETIC_GENERATOR_FRAMES) as usize;
        let node = self
            .generators
            .iter()
            .find(|(_, index)| **index == which)
            .map(|(node, _)| *node)?;
        let ty = self.snapshot.node_types.get(&node).copied()?;
        let TypeKind::Function(signature) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let declared = self.snapshot.signatures.get(signature.0 as usize)?.return_type;
        let argument = *self
            .snapshot
            .type_arguments
            .get(&declared)
            .and_then(|arguments| arguments.first())?;
        self.represent(argument)
    }

    /// `[Symbol.iterator]()` on a user type, and what stepping it looks like.
    ///
    /// The iterator is built *here* rather than in the loop, because the
    /// language builds it once: `for (const x of thing)` calls
    /// `[Symbol.iterator]` a single time however many elements come out.
    ///
    /// Everything else this returns is resolved once too -- the callee for
    /// `next`, and which fields of its result hold `done` and `value` -- so the
    /// loop emits a call and two loads an iteration and asks no questions.
    fn protocol_walk(
        &mut self,
        sequence: NodeId,
        value: ValueId,
        ty: TypeId,
    ) -> Result<Walk, Diagnostic> {
        let Some(iterator_member) = self.symbol_property_name(ty, "iterator") else {
            return Err(self.unsupported(sequence, "a `for...of` over a type with no iterator"));
        };
        let callee = self.callee_for(sequence, ty, &iterator_member)?;
        let Some(iterator_ty) = self.member_returns(ty, &iterator_member) else {
            return Err(self.unsupported(
                sequence,
                "a `[Symbol.iterator]()` whose result has no representation",
            ));
        };
        let origin = self.origin(sequence);
        let iterator = self.push(
            OpKind::Call {
                callee,
                args: vec![value],
                frame: None,
            },
            iterator_ty.clone(),
            origin,
        );

        let HirType::Managed(ManagedType::Object(iterator_id)) = iterator_ty else {
            return Err(self.unsupported(sequence, "an iterator that is not an object"));
        };
        let next = self.callee_for(sequence, iterator_id, "next")?;
        let Some(result) = self.member_returns(iterator_id, "next") else {
            return Err(self.unsupported(sequence, "a `next()` whose result has no representation"));
        };
        // `{ value, done }`, by name and in whatever order the type declares
        // them. `IteratorResult<T>` from `lib.d.ts` does not reach here: it is a
        // union of two object types whose `value` is `T` in one and `any` in the
        // other, so they lay out differently and the union has no layout at all.
        // A hand-written `{ value: T; done: boolean }` does.
        let HirType::Managed(ManagedType::Object(result_id)) = result else {
            return Err(self.unsupported(sequence, "a `next()` that does not return an object"));
        };
        let layout = self.layout_of(sequence, result_id)?;
        let (Some(done), Some(value_at)) = (layout.index_of("done"), layout.index_of("value"))
        else {
            return Err(self.unsupported(
                sequence,
                "a `next()` result without both `value` and `done`",
            ));
        };
        let element = layout.fields[value_at as usize].ty.clone();
        Ok(Walk::Protocol {
            iterator,
            next,
            result,
            done,
            value: value_at,
            element,
        })
    }

    /// Whether this type declares this property `readonly`.
    ///
    /// From the snapshot rather than from the layout, because a layout is
    /// shared between every type of the same shape and this is not a question
    /// about shape. See the note at the one call site.
    ///
    /// A property the type does not have is not readonly: the caller has
    /// already resolved the field, so absence here means the name reached the
    /// layout by a route the type's own property list does not describe -- a
    /// tuple index, or a symbol-keyed member -- and none of those is written
    /// with the modifier.
    fn property_is_readonly(&self, ty: TypeId, name: &str) -> bool {
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return false;
        };
        properties
            .iter()
            .find(|property| property.name == name)
            .is_some_and(|property| property.readonly)
    }

    /// What a method declared on a type returns, as a representation.
    fn member_returns(&self, ty: TypeId, member: &str) -> Option<HirType> {
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        let property = properties.iter().find(|property| property.name == member)?;
        let function = self.snapshot.types.get(property.ty.0 as usize)?;
        let TypeKind::Function(signature) = function.kind else {
            return None;
        };
        let signature = self.snapshot.signatures.get(signature.0 as usize)?;
        self.represent(signature.return_type)
    }

    /// A call to an external runtime function.
    fn call_runtime(
        &mut self,
        name: &str,
        args: Vec<ValueId>,
        ty: HirType,
        origin: &Origin,
    ) -> ValueId {
        self.push(
            OpKind::Call {
                callee: Callee::External(name.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin.clone(),
        )
    }

    /// `m.keys()` in the head of a `for...of`, reduced to `m` and which slot to
    /// read.
    ///
    /// Only for a table. `xs.keys()` on an *array* yields indices rather than
    /// elements, so stripping the call there would iterate the wrong thing
    /// quietly -- which is why this asks the checker for the receiver's type
    /// rather than trusting the method name.
    fn table_source(&self, sequence: NodeId) -> (NodeId, Option<&'static str>) {
        let plain = (sequence, None);
        if self.kind_of(sequence) != Some(syntax::CALL_EXPRESSION)
            || !self.arguments_of(sequence).is_empty()
        {
            return plain;
        }
        let Some(callee) = self.children(sequence).first().copied() else {
            return plain;
        };
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return plain;
        }
        let parts = self.children(callee);
        let [receiver, member] = parts.as_slice() else {
            return plain;
        };
        if !matches!(
            self.type_of(*receiver),
            Some(HirType::Managed(
                ManagedType::Map(_, _) | ManagedType::Set(_)
            ))
        ) {
            return plain;
        }
        match self.literal_name(*member).as_deref() {
            Some("keys") => (*receiver, Some("keys")),
            Some("values") => (*receiver, Some("values")),
            Some("entries") => (*receiver, Some("entries")),
            _ => plain,
        }
    }

    /// Which walk a lowered sequence supports, or why it supports none.
    fn walk_of(
        &mut self,
        sequence: NodeId,
        value: ValueId,
        forced: Option<&'static str>,
        binds: usize,
    ) -> Result<Walk, Diagnostic> {
        let ty = self.values[value.0 as usize].ty.clone();
        // `for (const [k, v] of map)`, and `of map.entries()`, which is the
        // same walk written the other way. Two names, two reads, no pair.
        if binds == 2
            && let HirType::Managed(ManagedType::Map(key, val)) = &ty
            && matches!(forced, None | Some("entries"))
        {
            return Ok(Walk::Entries {
                key: (**key).clone(),
                value: (**val).clone(),
                value_read: "nts_map_value_at",
            });
        }
        // A `Set`'s `entries()` yields `[v, v]`, which node agrees is the same
        // value twice.
        if binds == 2
            && let HirType::Managed(ManagedType::Set(element)) = &ty
            && forced == Some("entries")
        {
            return Ok(Walk::Entries {
                key: (**element).clone(),
                value: (**element).clone(),
                value_read: "nts_map_key_at",
            });
        }
        if binds != 1 {
            return Err(self.unsupported(
                sequence,
                &format!("a `for...of` binding {binds} names over this sequence"),
            ));
        }
        match (&ty, forced) {
            (HirType::Managed(ManagedType::Array(element)), None) => {
                Ok(Walk::Counted((**element).clone()))
            }
            (HirType::Managed(ManagedType::String), None) => Ok(Walk::Text),
            // A `Set`'s elements are its keys, so iterating one, its `keys()`
            // and its `values()` are the same walk -- which is what JavaScript
            // says too.
            (HirType::Managed(ManagedType::Set(element)), None | Some("keys" | "values")) => {
                Ok(Walk::Table {
                    read: "nts_map_key_at",
                    element: (**element).clone(),
                })
            }
            (HirType::Managed(ManagedType::Map(key, _)), Some("keys")) => Ok(Walk::Table {
                read: "nts_map_key_at",
                element: (**key).clone(),
            }),
            (HirType::Managed(ManagedType::Map(_, value)), Some("values")) => Ok(Walk::Table {
                read: "nts_map_value_at",
                element: (**value).clone(),
            }),
            // Iterating a `Map` itself yields a `[key, value]` pair, which is a
            // tuple this compiler cannot represent and which is only useful
            // through a destructuring binding. Both are real features and
            // neither is this one, so it says which.
            (HirType::Managed(ManagedType::Map(_, _)), None) => Err(self.unsupported(
                sequence,
                "a `for...of` over a `Map` binding one name, which would be the \
                 `[key, value]` pair itself; bind `[key, value]` instead",
            )),
            // A user type that declares `[Symbol.iterator]`. Last, so every
            // built-in above keeps its own walk: an array is a counted loop and
            // a `Map` is a table read, and routing either through the protocol
            // would allocate an iterator to arrive at the same elements.
            // A generator, recognised by the type its call produced: the frame
            // ids are their own part of the synthetic space, so nothing else
            // can be mistaken for one.
            (HirType::Managed(ManagedType::Object(ty)), None)
                if ty.0 >= super::SYNTHETIC_GENERATOR_FRAMES && ty.0 < super::SYNTHETIC_CLOSURES =>
            {
                self.generator_walk(sequence, value)
            }
            (HirType::Managed(ManagedType::Object(ty)), None)
                if self.symbol_property_name(*ty, "iterator").is_some() =>
            {
                let ty = *ty;
                self.protocol_walk(sequence, value, ty)
            }
            (_, Some(method)) => Err(self.unsupported(
                sequence,
                &format!("`{method}()` on this type, which needs the iteration protocol"),
            )),
            _ => {
                let named = self
                    .snapshot
                    .node_types
                    .get(&sequence)
                    .map(|ty| describe(self.snapshot, *ty));
                Err(self.unsupported(
                    sequence,
                    &match named {
                        Some(what) => format!("a `for...of` over {what}"),
                        None => "a `for...of` over something with no iteration".to_owned(),
                    },
                ))
            }
        }
    }

    /// The cursor of a `for...of`, moved on by one element.
    ///
    /// Built in the loop's latch, which is where `continue` lands.
    fn advance(&mut self, walk: &Walk, sequence: ValueId, at: ValueId, origin: &Origin) -> ValueId {
        match walk {
            // The protocol advances itself: `next()` moves the iterator, and
            // there is no cursor for a latch to step. `lower_for_of` gives it
            // `Step::None` for exactly this reason, so nothing reaches here.
            Walk::Protocol { .. } | Walk::Generator { .. } => {
                unreachable!("a cursorless walk has no cursor; its step is `Step::None`")
            }
            Walk::Counted(_) => {
                let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: one,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                )
            }
            // The width is asked for again rather than carried out of the body.
            // It is a pure read of two code units, and carrying it would mean a
            // second loop-carried name existing only to cross one block edge.
            Walk::Text => {
                let width = self.call_runtime(
                    "nts_str_point_width",
                    vec![sequence, at],
                    HirType::NUMBER,
                    origin,
                );
                self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: width,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                )
            }
            Walk::Table { .. } | Walk::Entries { .. } => {
                let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                let after = self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: one,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                self.call_runtime(
                    "nts_map_next",
                    vec![sequence, after],
                    HirType::NUMBER,
                    origin,
                )
            }
        }
    }

    /// The element a cursor is currently on.
    fn read_element(
        &mut self,
        walk: &Walk,
        sequence: ValueId,
        at: ValueId,
        origin: &Origin,
    ) -> Vec<ValueId> {
        // A table read comes back erased, because that is what the table
        // stores. Where the element type is concrete the payload is read back
        // here, so the body sees a `Socket` rather than sixteen bytes.
        let unerased = |lower: &mut Self, slot: ValueId, want: &HirType| {
            if *want == HirType::Erased {
                slot
            } else {
                lower.push(
                    OpKind::Unerase { value: slot },
                    want.clone(),
                    origin.clone(),
                )
            }
        };
        if let Walk::Entries {
            key,
            value,
            value_read,
        } = walk
        {
            let k = self.call_runtime(
                "nts_map_key_at",
                vec![sequence, at],
                HirType::Erased,
                origin,
            );
            let k = unerased(self, k, key);
            let v = self.call_runtime(value_read, vec![sequence, at], HirType::Erased, origin);
            let v = unerased(self, v, value);
            return vec![k, v];
        }
        vec![match walk {
            // Checked: the length was read once and the bounds pass is what
            // proves the index inside it.
            Walk::Counted(element) => self.push(
                OpKind::ArrayGet {
                    array: sequence,
                    index: at,
                    checked: true,
                },
                element.clone(),
                origin.clone(),
            ),
            Walk::Table { read, element } => {
                let slot = self.call_runtime(read, vec![sequence, at], HirType::Erased, origin);
                // The table stores erased values. Where the element type is
                // concrete the payload is read back here, so the body sees a
                // `Socket` rather than sixteen bytes it has to unpack itself.
                if *element == HirType::Erased {
                    slot
                } else {
                    self.push(
                        OpKind::Unerase { value: slot },
                        element.clone(),
                        origin.clone(),
                    )
                }
            }
            Walk::Text => {
                let width = self.call_runtime(
                    "nts_str_point_width",
                    vec![sequence, at],
                    HirType::NUMBER,
                    origin,
                );
                let end = self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: at,
                        rhs: width,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                self.call_runtime(
                    "nts_str_slice",
                    vec![sequence, at, end],
                    HirType::Managed(ManagedType::String),
                    origin,
                )
            }
            // Handled above, before this match: it is the one shape that reads
            // more than a single value.
            Walk::Entries { .. } => unreachable!("entries reads two and returned already"),
            Walk::Protocol { .. } | Walk::Generator { .. } => {
                unreachable!("a cursorless walk reads its element from the step")
            }
        }]
    }

    /// What a `for...of` head binds.
    ///
    /// One identifier is the ordinary case. An array pattern is
    /// `for (const [k, v] of map)`, whose two names are the two values the walk
    /// over a table produces -- positional, and read directly rather than
    /// through a pair object that would be built only to be taken apart.
    ///
    /// An **object** pattern is not positional. `for (const { x, y } of points)`
    /// binds by property name off the one value the walk produces, which is
    /// what [`Self::bind_pattern`] already does for `const { x, y } = p` --
    /// renames, nesting and all. It was refused here only because this returned
    /// names in order, and an order is the one thing an object pattern does not
    /// have.
    fn for_of_head(&self, initializer: NodeId) -> Result<Head, Diagnostic> {
        let declaration = self
            .children(initializer)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::VARIABLE_DECLARATION))
            .ok_or_else(|| self.unsupported(initializer, "a `for...of` without a declaration"))?;
        let parts = self.children(declaration);
        if let Some(name) = parts
            .iter()
            .copied()
            .find(|part| self.kind_of(*part) == Some(syntax::IDENTIFIER))
        {
            return Ok(Head::InOrder(vec![name]));
        }
        if let Some(pattern) = parts
            .iter()
            .copied()
            .find(|part| self.kind_of(*part) == Some(syntax::OBJECT_BINDING_PATTERN))
        {
            return Ok(Head::Pattern(pattern));
        }
        let pattern = parts
            .iter()
            .copied()
            .find(|part| self.kind_of(*part) == Some(syntax::ARRAY_BINDING_PATTERN))
            .ok_or_else(|| self.unsupported(initializer, "a `for...of` binding of this shape"))?;

        let mut names = Vec::new();
        for element in self.children(pattern) {
            if self.kind_of(element) != Some(syntax::BINDING_ELEMENT) {
                return Err(self.unsupported(element, "a hole in a destructuring pattern"));
            }
            // A name and nothing else. A default carries an initializer, a rest
            // a `...`, and a nested pattern a pattern -- each arrives as a
            // second child.
            let inner = self.children(element);
            let [name] = inner.as_slice() else {
                return Err(
                    self.unsupported(element, "a destructuring element that is more than a name")
                );
            };
            if self.kind_of(*name) != Some(syntax::IDENTIFIER) {
                return Err(self.unsupported(*name, "a nested destructuring pattern"));
            }
            names.push(*name);
        }
        Ok(Head::InOrder(names))
    }

    /// Every symbol a binding pattern declares, however deeply.
    ///
    /// The loop needs them so that a name the head binds is not mistaken for one
    /// the body carries round.
    fn pattern_symbols(&self, pattern: NodeId, into: &mut Vec<u32>) {
        for child in self.children(pattern) {
            match self.kind_of(child) {
                Some(syntax::IDENTIFIER) => {
                    if let Some(symbol) = self.node(child).symbol {
                        into.push(symbol.0);
                    }
                }
                _ => self.pattern_symbols(child, into),
            }
        }
    }

    /// Give a `for...of` head the values the walk produced.
    ///
    /// Names take them in order. A pattern takes the one value there is and
    /// goes through [`Self::bind_pattern`], the same function a declaration
    /// uses, so a rename or a nested pattern needs nothing here.
    fn bind_head(
        &mut self,
        id: NodeId,
        head: &Head,
        symbols: &[u32],
        values: Vec<ValueId>,
    ) -> Result<(), Diagnostic> {
        match head {
            Head::InOrder(_) => {
                for (symbol, value) in symbols.iter().zip(values) {
                    self.bindings.insert(*symbol, value);
                }
                Ok(())
            }
            Head::Pattern(pattern) => {
                let [element] = values.as_slice() else {
                    return Err(self.unsupported(id, "a `for...of` pattern over a walk of pairs"));
                };
                let (pattern, element) = (*pattern, *element);
                self.bind_pattern(pattern, element)
            }
        }
    }

    fn lower_for_of(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [initializer, sequence, body] = children.as_slice() else {
            // An `await` modifier makes four. `for await` needs the async
            // machinery rather than a different loop shape.
            return Err(self.unsupported(id, "a `for...of` of unexpected shape"));
        };
        let (initializer, sequence, body) = (*initializer, *sequence, *body);

        // What the head binds: one name, the two of `[key, value]`, or a
        // pattern taken apart from the single value the walk produces.
        let head = self.for_of_head(initializer)?;
        let mut element_symbols = Vec::new();
        if let Head::InOrder(names) = &head {
            for name in names {
                element_symbols.push(
                    self.node(*name)
                        .symbol
                        .ok_or_else(|| self.unsupported(*name, "a `for...of` name with no symbol"))?
                        .0,
                );
            }
        }
        // A pattern reads one value and takes it apart; the names in it are not
        // what the walk hands over.
        let wanted = match &head {
            Head::InOrder(names) => names.len(),
            Head::Pattern(_) => 1,
        };

        // `for (const k of m.keys())` reads the table directly. Lowering the
        // call would build an iterator object, step it once per element and
        // throw it away, to arrive at this same walk with an indirection in
        // it -- so the method is recognized here and never lowered.
        let (sequence, forced) = self.table_source(sequence);
        let sequence_value = self.lower_expression(sequence)?;
        let walk = self.walk_of(sequence, sequence_value, forced, wanted)?;

        let origin = self.origin(id);
        // The cursor. A double, like the counter a hand-written `for` produces,
        // so that specialization decides its machine type by the same rule
        // rather than by which loop it came from.
        //
        // For an array and for text it is a position and starts at zero. For a
        // table it is an entry index, and the entries are not contiguous, so
        // the first live one is asked for rather than assumed.
        let index = self.walk_cursor(&walk, sequence_value, &origin);

        let mut carried: Vec<u32> = index.into_iter().collect();
        self.assigned_symbols(body, &mut carried);
        let mut declared = element_symbols.clone();
        if let Head::Pattern(pattern) = &head {
            self.pattern_symbols(*pattern, &mut declared);
        }
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| Some(*symbol) == index || !declared.contains(symbol));

        // `steps: true` where there is a cursor, so the loop has a latch of its
        // own: the cursor is advanced there rather than at the end of the body,
        // because `continue` jumps to the latch and would otherwise skip the
        // advance and hang.
        //
        // The protocol takes `false`, which makes the *header* the latch -- and
        // that is not a saving but the requirement. `next()` is called in the
        // header, so `continue` has to arrive there; a protocol loop with a
        // latch of its own would step the iterator nowhere and spin.
        let steps = !matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. });
        let record = self.begin_loop(id, &carried, steps, &origin)?;

        // The test, built rather than lowered: the source has no node for it.
        // A position runs while it is inside the length; an entry index runs
        // until the table says there is no next live entry.
        // For the protocol `at` is the `done` the step answered, and `stepped`
        // is the result it came out of -- read again in the body, which the
        // header dominates. One call answers "again?" here and "with what?"
        // there; calling `next()` for each would drop every other element.
        let (stepped, at) = if let Some(index) = index {
            (None, self.bindings[&index])
        } else {
            let (step, done) = self.protocol_step(id, &walk, &origin)?;
            (Some(step), done)
        };
        let cond = self.walk_condition(&walk, at, sequence_value, &origin);
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let values = if stepped.is_some() {
            vec![self.walk_element(&walk, sequence_value, at, stepped, &origin)]
        } else {
            self.read_element(&walk, sequence_value, at, &origin)
        };
        self.bind_head(id, &head, &element_symbols, values)?;

        self.lower_statement(body)?;
        let step = match index {
            // Nothing between iterations: the header is the latch, and the
            // header is where `next()` is called.
            None => Step::None,
            Some(cursor) => Step::Walk {
                cursor,
                walk,
                sequence: sequence_value,
            },
        };
        self.end_loop(&record, step)
    }

    /// `throw new Error("...")`.
    ///
    /// # A throw is a termination, for now
    ///
    /// There is no `try`/`catch`, so every throw in a compiled program is
    /// uncaught by construction -- and an uncaught throw *is* a termination.
    /// So this reports the message and stops, which is what the program means
    /// and what node does with the same code. RFC §17 has the real thing;
    /// when handlers arrive this becomes the last resort rather than the only
    /// one, and no program that compiles today changes behaviour.
    ///
    /// What it will not do is guess at a value it cannot print. `throw x` where
    /// `x` is an object would need the object's `message`, which means knowing
    /// it has one.
    fn lower_throw(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let thrown = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "a `throw` with nothing to throw"))?;

        let origin = self.origin(id);
        // The whole value, not a message taken out of it.
        //
        // What stood here reduced `new Error(m)` to `m`, on the reasoning that
        // `Error` was `lib.d.ts`'s and could not be constructed. It is
        // [`super::builtin`]'s and has been for some time, and the reduction
        // was only invisible because nothing could observe the difference: an
        // uncaught throw prints and aborts either way. A `catch` binding is
        // exactly what observes it.
        //
        // Erased, because `catch (e)` is `unknown`. That is the language's own
        // answer to what a handler receives, and taking it means `throw "text"`
        // and `throw new Error(m)` are one operation at one representation
        // rather than two shapes to keep in agreement.
        let value = self.lower_expression(thrown)?;
        let thrown_ty = self.values[value.0 as usize].ty.clone();

        let erased = self.push(OpKind::Erase { value }, HirType::Erased, origin.clone());

        // A `throw` with a handler in this function is a jump to it and nothing
        // more. The value rides the edge as a block argument, so it never
        // reaches the runtime's slot -- which is the common case worth making
        // free, and it is free because releasing what a frame owns along an
        // edge is what [`super::rc`] already does for every other edge here.
        //
        // The arguments are filled in later: the handler's parameters are not
        // known until the whole body has been lowered. See [`Self::lower_try`].
        // The nearest `catch` stops this throw; every `finally` between here
        // and it runs on the way. The value was computed before any of them,
        // which is when the language says it is computed.
        let caught_at = self
            .exits
            .iter()
            .rposition(|exit| matches!(exit, Exit::Handler(_)));
        self.run_finallys_to(caught_at.map_or(0, |at| at + 1))?;
        if self.is_terminated() {
            // A `finally` left by itself, so this `throw` never arrives.
            return Ok(());
        }

        if let Some(at) = caught_at {
            let mut target = match &self.exits[at] {
                Exit::Handler(frame) => frame.block,
                Exit::Finally(_) => unreachable!("rposition found a handler"),
            };
            if target.is_none() {
                let block = self.new_block();
                if let Exit::Handler(frame) = &mut self.exits[at] {
                    frame.block = Some(block);
                }
                target = Some(block);
            }
            let Some(target) = target else {
                unreachable!("just created above")
            };
            let edge = Edge {
                from: self.current,
                thrown: erased,
                bindings: self.bindings.clone(),
            };
            if let Exit::Handler(frame) = &mut self.exits[at] {
                frame.edges.push(edge);
            }
            self.terminate(Terminator::Jump {
                target,
                args: Vec::new(),
            });
            return Ok(());
        }

        // An `async` function's `throw` rejects the promise it already owns and
        // hands it back, which is exactly what its `return` does with `settle`.
        // Without this it ended the program: node rejects, and every caller
        // awaiting it sees a rejection rather than a dead process.
        //
        // The reference and not the erased value, because the runtime holds a
        // reason as an `NtsHeader *`. A thrown number has none to hold, and
        // writing one into that slot would be a pointer the collector follows.
        if let Some(result) = self.async_result.clone() {
            if !matches!(thrown_ty, HirType::Managed(_)) {
                return Err(self.unsupported(
                    id,
                    "an `async` function throwing something that is not a reference",
                ));
            }
            self.runtime_call(
                "nts_promise_reject",
                vec![result.promise, value],
                HirType::Void,
                origin,
            );
            self.terminate(Terminator::Return(Some(result.promise)));
            return Ok(());
        }

        // Only on the path that ends the program, and after the check above so
        // that a caught `throw` does not load a field nothing reads.
        //
        // A descriptor records where an object's references *are*, not what
        // they are called, so the runtime cannot find `message` by name and
        // this can. Matched by shape rather than against the four builtin error
        // classes: any object with a string `message` renders, which covers
        // every `class MyError extends Error` without needing to know that any
        // of them is one.
        let detail = match message_field(&self.layouts, &thrown_ty) {
            Some(field) => self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
            None => self.push(
                OpKind::ConstNull,
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
        };
        self.push(
            OpKind::Call {
                callee: Callee::External("nts_uncaught".to_owned()),
                args: vec![erased, detail],
                frame: None,
            },
            HirType::Void,
            origin,
        );
        // Control does not continue. Saying so is what lets the C compiler
        // treat the code after a throw as unreachable, which it is.
        self.terminate(Terminator::Unreachable);
        Ok(())
    }

    /// `"k" in value`.
    ///
    /// The same operation as `instanceof` with a different question in front of
    /// it. `instanceof` asks whether the value's class is one of a set the
    /// compiler computed from the hierarchy; this asks whether it is one of the
    /// set that *declares a property* -- and the set is computed the same way,
    /// from the static type, so it needs no new operation, no runtime helper,
    /// and nothing added to a descriptor.
    ///
    /// That is the whole design, and the reason it is small. A property table
    /// in the descriptor was the first plan: names in rodata beside the
    /// reference map, and a `nts_has_property` that walks them. It would have
    /// been an ABI change in three backends to answer a question the compiler
    /// already knows the answer to.
    ///
    /// # What it declines
    ///
    /// A key the compiler cannot see -- `k in o` for a variable `k` -- because
    /// the set cannot be computed without the name.
    ///
    /// An **optional** property, which is the decision `docs/conformance`
    /// recorded as the blocker for this row. The slot exists here whether or
    /// not the program ever wrote it, and JavaScript distinguishes `{}` from
    /// `{ a: undefined }`: `"a" in` the first is false and in the second is
    /// true. Nothing in this representation separates them, so the honest
    /// answer is a refusal rather than a slot that is always there.
    ///
    /// A union arm that is not an object type, because `"a" in 5` throws.
    fn lower_in(&mut self, id: NodeId, lhs: NodeId, rhs: NodeId) -> Result<ValueId, Diagnostic> {
        let Some(key) = self.literal_key(lhs) else {
            return Err(self.unsupported(
                lhs,
                "an `in` whose key is not a literal the compiler can see",
            ));
        };
        let Some(ty) = self.snapshot.node_types.get(&rhs).copied() else {
            return Err(self.unsupported(rhs, "an `in` on a value with no type"));
        };
        let members = match &self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
            Some(TypeKind::Union(members)) => members.clone(),
            Some(_) => vec![ty],
            None => return Err(self.unsupported(rhs, "an `in` on a value with no type")),
        };

        // Every class the value can actually *be*: each arm and everything
        // below it.
        //
        // The first version of this asked the arms alone and was wrong in the
        // direction that folds to a constant. `const v: Shape | Other = ...`
        // with `Circle extends Shape`: neither `Shape` nor `Other` declares
        // `r`, so `"r" in v` folded to `false` -- and at run time `v` is a
        // `Circle`, which has one. Node says true, nts said false, and the
        // differential said so on 20 of 29 cases.
        //
        // Inheritance is additive, so a subclass declares everything its base
        // does and possibly more. That makes the `true` direction safe with the
        // arms alone and the `false` direction unsafe, which is exactly the
        // asymmetry a "no arm has it" fold walks into.
        let mut members = members;
        let below: Vec<TypeId> = self
            .hierarchy
            .name
            .keys()
            .copied()
            .filter(|ty| {
                !members.contains(ty) && members.iter().any(|arm| self.descends_from(*ty, *arm))
            })
            .collect();
        members.extend(below);
        members.sort_unstable_by_key(|ty| ty.0);
        members.dedup();

        // Which of them declare it. The set is what the test becomes.
        let mut declaring: Vec<TypeId> = Vec::new();
        for member in &members {
            match self.declares(*member, &key) {
                Declares::Always => declaring.push(*member),
                Declares::Never => {}
                Declares::Optionally => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "an `in` naming `{key}`, which is optional -- its slot exists here \
                             whether or not it was written, and `{{}}` and `{{ {key}: undefined }}` \
                             disagree in JavaScript"
                        ),
                    ));
                }
                Declares::NotAnObject => {
                    return Err(self.unsupported(
                        rhs,
                        "an `in` on something that is not an object, which JavaScript throws for",
                    ));
                }
            }
        }

        let origin = self.origin(id);
        // Every arm declares it, or none does. The operand is still evaluated:
        // `in` has no short circuit and the left side of `&&` chains here often
        // has an effect.
        if declaring.len() == members.len() || declaring.is_empty() {
            let answer = declaring.len() == members.len();
            self.lower_expression(rhs)?;
            return Ok(self.push(OpKind::ConstBool(answer), HirType::Bool, origin));
        }

        // Mixed, so the answer is the value's own class. Every arm needs a
        // layout before the test can name it -- `layout_of` is what builds one,
        // and a type that reaches here without one would be an `InstanceOf`
        // against a class no backend has.
        for member in &declaring {
            self.layout_of(id, *member)?;
        }
        declaring.sort_unstable_by_key(|ty| ty.0);
        declaring.dedup();

        let value = self.lower_expression(rhs)?;
        // Erased first, for the reason `lower_instanceof` gives: the operation
        // asks an object for its class, and a value that might not be one has
        // to say so.
        let value = match self.values[value.0 as usize].ty {
            HirType::Erased => value,
            _ => self.push(OpKind::Erase { value }, HirType::Erased, origin.clone()),
        };
        Ok(self.push(
            OpKind::InstanceOf {
                value,
                classes: declaring,
            },
            HirType::Bool,
            origin,
        ))
    }

    /// Whether a type declares a property under this name.
    fn declares(&self, ty: TypeId, key: &str) -> Declares {
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return Declares::NotAnObject;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return Declares::NotAnObject;
        };
        match properties.iter().find(|property| property.name == key) {
            Some(property) if property.optional => Declares::Optionally,
            Some(_) => Declares::Always,
            None => Declares::Never,
        }
    }

    /// The text of a string literal used as a key, where it is one.
    fn literal_key(&self, node: NodeId) -> Option<String> {
        match &self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&node)?.0 as usize)?
            .kind
        {
            TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
            _ => None,
        }
    }


    /// `x instanceof C`.
    ///
    /// # The answer is a comparison, not a walk
    ///
    /// JavaScript's `instanceof` walks a prototype chain, because a program can
    /// change one while it runs. A compiled program cannot: the classes that
    /// extend `C` are all of them, they are known here, and nothing can be
    /// added after the binary is built. So the question "is this object a `C`"
    /// is "is its class one of these", and *these* is usually one.
    ///
    /// The right side is resolved through the **symbol** the class declares
    /// rather than through its name. Two modules may each declare a `Point`,
    /// and a name would pick whichever the map happened to hold.
    fn lower_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(symbol) = self.node(rhs).symbol else {
            return Err(self.unsupported(rhs, "an `instanceof` whose right side is not a class"));
        };
        // The class's *instance* type. The right operand names the constructor,
        // whose type is not the type of what `new` produces, so it is found by
        // the symbol both share -- and by the symbol rather than by the name,
        // because two modules may each declare a `Point`.
        let mut named: Vec<TypeId> = self
            .snapshot
            .types
            .iter()
            .enumerate()
            .filter(|(_, record)| {
                record.symbol == Some(symbol)
                    && matches!(record.kind, nts_semantic_schema::TypeKind::Object { .. })
            })
            .filter_map(|(at, _)| u32::try_from(at).ok().map(TypeId))
            .collect();
        named.sort_unstable_by_key(|ty| ty.0);
        // A provided error class is found by *name*. `lib.d.ts` declares
        // `TypeError` as a variable of type `TypeErrorConstructor`, so the
        // symbol the right operand resolves to is the constructor's and never
        // the instance's -- there is no symbol the two share. Name is what
        // [`super::builtin`] identifies these four by everywhere else, and they
        // are global, so there is nothing else they could be.
        let class = named.first().copied().or_else(|| {
            let text = self.node(rhs).text.clone()?;
            if !super::builtin::is_error(&text) {
                return None;
            }
            self.type_named(&text)
        });
        let Some(class) = class else {
            return Err(self.unsupported(
                rhs,
                "an `instanceof` against something this compiler has no class for",
            ));
        };

        // `C` and everything that extends it, directly or not. Sorted, because
        // the sources are hash maps and a list that varied between runs would
        // emit a different program from the same input.
        let mut classes: Vec<TypeId> = vec![class];
        classes.extend(
            self.hierarchy
                .name
                .keys()
                .copied()
                .filter(|ty| *ty != class && self.descends_from(*ty, class)),
        );
        // The provided error classes are not declarations in this program, so
        // the hierarchy has never heard of them -- and `TypeError extends Error`
        // all the same. `e instanceof Error` inside a `catch` is the reason
        // `instanceof` is worth having, so the relation is spelled here rather
        // than left to a hierarchy that cannot see it.
        if super::builtin::is_error(self.name_of_type(class).unwrap_or_default()) {
            classes.extend(self.provided_errors_under(class));
        }
        classes.sort_unstable_by_key(|ty| ty.0);
        classes.dedup();

        let value = self.lower_expression(lhs)?;
        let origin = self.origin(id);
        // Erased first, whatever it arrived as. The operation asks an object
        // for its class, and a value that might not be an object has to say so
        // -- which is what a tag is. An erase of something already known to be
        // an object is one inline word.
        let value = match self.values[value.0 as usize].ty {
            HirType::Erased => value,
            _ => self.push(OpKind::Erase { value }, HirType::Erased, origin.clone()),
        };
        Ok(self.push(OpKind::InstanceOf { value, classes }, HirType::Bool, origin))
    }

    /// The first object type declared with this name.
    fn type_named(&self, wanted: &str) -> Option<TypeId> {
        // No filter on the type's *kind*. `Error` reaches the compiler as
        // whatever `lib.d.ts` declares it as, which is not the object kind a
        // class declaration produces -- and the name is what identifies these
        // four everywhere else here.
        (0..self.snapshot.types.len())
            .filter_map(|at| u32::try_from(at).ok().map(TypeId))
            .find(|ty| self.name_of_type(*ty) == Some(wanted))
    }

    /// A type's declared name, where it has one.
    fn name_of_type(&self, ty: TypeId) -> Option<&str> {
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        self.snapshot
            .symbols
            .get(symbol.0 as usize)
            .map(|record| record.name.as_str())
    }

    /// The provided error classes that satisfy `instanceof class`.
    ///
    /// `Error` is the base of the other three, so it admits all of them; each
    /// of the others admits only itself. That is the whole hierarchy, and it is
    /// four names rather than a structure because [`super::builtin`] provides
    /// exactly four.
    fn provided_errors_under(&self, class: TypeId) -> Vec<TypeId> {
        if self.name_of_type(class) != Some("Error") {
            return Vec::new();
        }
        self.snapshot
            .types
            .iter()
            .enumerate()
            .filter_map(|(at, _)| u32::try_from(at).ok().map(TypeId))
            .filter(|ty| {
                self.name_of_type(*ty)
                    .is_some_and(super::builtin::is_error)
            })
            .collect()
    }

    /// Whether `ty` is `class` or extends it, at any depth.
    fn descends_from(&self, ty: TypeId, class: TypeId) -> bool {
        let mut at = ty;
        // Bounded rather than trusted: a cycle in the base map would hang the
        // compiler, and no hierarchy is this deep.
        for _ in 0..64 {
            if at == class {
                return true;
            }
            match self.hierarchy.base.get(&at) {
                Some(base) => at = *base,
                None => return false,
            }
        }
        false
    }

    /// `outer: for (…) { … }`.
    ///
    /// The label is not a construct of its own: it names the loop written under
    /// it, so that a `break` or `continue` inside can say which loop it means.
    /// So this records the name and lowers the loop, and the loop takes the name
    /// when it pushes its [`Breakable`].
    ///
    /// A label on anything *other* than a loop or a `switch` is refused. `outer:
    /// { … break outer … }` is legal JavaScript -- a labelled block, where the
    /// `break` is a forward jump to the end of it -- and it needs a breakable
    /// with an exit and no latch, which is a block this does not build. Refusing
    /// it also keeps [`Self::pending_label`] honest: with nothing between the
    /// label and the loop, the next construct to push is always the one the
    /// label was written on, and the name cannot land on a loop nested inside
    /// something else.
    fn lower_labeled(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [name, statement] = children.as_slice() else {
            return Err(self.unsupported(id, "a labelled statement of unexpected shape"));
        };
        let (name, statement) = (*name, *statement);
        if !matches!(
            self.kind_of(statement),
            Some(
                syntax::FOR_STATEMENT
                    | syntax::FOR_OF_STATEMENT
                    | syntax::WHILE_STATEMENT
                    | syntax::DO_STATEMENT
                    | syntax::SWITCH_STATEMENT
            )
        ) {
            return Err(self.unsupported(id, "a label on something that is not a loop"));
        }
        let Some(text) = self.node(name).text.clone() else {
            return Err(self.unsupported(name, "a label with no name"));
        };
        self.pending_label = Some(text);
        let lowered = self.lower_statement(statement);
        // Cleared whatever happened: a loop that refused never took it, and a
        // name left here would be picked up by the next loop in the function.
        self.pending_label = None;
        lowered
    }

    /// `try { … } catch (e) { … }`.
    ///
    /// # A handler is a block, and a `throw` is a jump to it
    ///
    /// Nothing here unwinds, and nothing needs to. An unwinder's tables exist
    /// to *recover*, from a machine frame at run time, which values that frame
    /// owns; this compiler computes that at compile time already, in
    /// [`super::own`], and [`super::rc`] emits the releases an edge implies for
    /// every other edge in the program. A handler edge is not a special kind of
    /// edge, so it needs no special machinery -- it needs to be an edge.
    ///
    /// # Why the parameters cannot be decided first
    ///
    /// Every `throw` in the body is one edge into the handler, and they need
    /// not agree about anything: a name the body assigns before the first
    /// `throw` holds one value there and another at the second. So the handler
    /// block is created empty, each `throw` records the bindings it had, and
    /// the parameter list is computed once the body is finished -- one
    /// parameter for the thrown value, and one for each name the edges
    /// disagree about. A name they all agree about is bound to that value
    /// outright, which is most of them.
    fn lower_try(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let parts = self.children(id);
        let Some(&body) = parts.first() else {
            return Err(self.unsupported(id, "a `try` with nothing in it"));
        };
        // The children are the block, an optional catch clause, and an optional
        // `finally` block. Which is which is read off the shape rather than off
        // a `CatchClause` kind number: every constant in `syntax` was read from
        // a real encoded program and pinned by a test, and this one would have
        // been inferred from the order of a Go `iota` list instead. `has_finally`
        // reads the same node the same way.
        let ends_in_block =
            parts.len() >= 2 && self.kind_of(parts[parts.len() - 1]) == Some(syntax::BLOCK);
        let (clause, finally_body) = match (parts.len(), ends_in_block) {
            (2, false) => (parts.get(1).copied(), None),
            (2, true) => (None, parts.get(1).copied()),
            (3, true) => (parts.get(1).copied(), parts.get(2).copied()),
            _ => return Err(self.unsupported(id, "a `try` of unexpected shape")),
        };

        // Pushed before the handler, because the `finally` encloses the `catch`:
        // a `throw` in the body is stopped by the `catch` and runs no `finally`,
        // and a `throw` in the `catch` runs it on the way out.
        if let Some(body) = finally_body {
            self.exits.push(Exit::Finally(body));
        }
        let guarded = self.lower_guarded(id, body, clause);
        if finally_body.is_some() {
            self.exits.pop();
        }
        guarded?;

        // Normal completion runs it too, and this is the copy that most
        // programs execute.
        if let Some(body) = finally_body.filter(|_| !self.is_terminated()) {
            self.lower_statement(body)?;
        }
        Ok(())
    }

    /// The `try` and its `catch`, with whatever `finally` encloses them already
    /// on the exit stack.
    fn lower_guarded(
        &mut self,
        id: NodeId,
        body: NodeId,
        clause: Option<NodeId>,
    ) -> Result<(), Diagnostic> {
        let Some(clause) = clause else {
            // `try { … } finally { … }`. Nothing catches, so the body is lowered
            // as it stands -- a `throw` in it finds the `finally` on the stack
            // and whatever encloses that.
            return self.lower_statement(body);
        };
        let clause_parts = self.children(clause);
        let Some(&handler_body) = clause_parts.last() else {
            return Err(self.unsupported(clause, "a `catch` with no body"));
        };
        // `catch { }` is legal and binds nothing.
        let caught = if clause_parts.len() >= 2 {
            Some(clause_parts[0])
        } else {
            None
        };

        let origin = self.origin(id);
        let entry = self.bindings.clone();

        self.exits.push(Exit::Handler(Handler {
            block: None,
            edges: Vec::new(),
        }));
        let lowered = self.lower_statement(body);
        // Popped before the refusal is raised, so a refused body does not leave
        // the stack claiming a handler that is no longer being built. Popped
        // before the *handler body* is lowered too, which is what makes a
        // `throw` inside a `catch` belong to the enclosing `try`.
        let Some(Exit::Handler(frame)) = self.exits.pop() else {
            unreachable!("pushed immediately above")
        };
        lowered?;

        let body_tail = self.current;
        let body_open = !self.is_terminated();
        let body_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        let Some(handler) = frame.block else {
            // Nothing in the body throws, so the `catch` is dead. Not an error
            // and not a warning: a `try` around code that cannot throw is how a
            // person writes defensively, and the right answer is to emit the
            // body and nothing else. No block was ever created for it.
            self.bindings = body_bindings;
            return Ok(());
        };

        let thrown = self.open_handler(handler, &frame, &entry, &origin);
        self.switch_to(handler);
        if let Some(declaration) = caught {
            self.bind_caught(declaration, thrown)?;
        }
        self.lower_statement(handler_body)?;
        let handler_tail = self.current;
        let handler_open = !self.is_terminated();
        let handler_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        self.join_try(
            &origin,
            (body_tail, body_open, body_bindings),
            (handler_tail, handler_open, handler_bindings),
            entry,
        );
        Ok(())
    }

    /// Lower the `finally` bodies above `floor`, innermost first.
    ///
    /// For a path that is leaving all of them -- a `throw` on its way to a
    /// handler further out, a `return`, a `break` out of the loop they are in.
    ///
    /// Each body is lowered *here*, inline, which is what makes a `finally`
    /// duplicated rather than shared. See [`Exit::Finally`].
    fn run_finallys_to(&mut self, floor: usize) -> Result<(), Diagnostic> {
        let mut at = self.exits.len();
        while at > floor {
            at -= 1;
            let body = match &self.exits[at] {
                Exit::Finally(body) => *body,
                Exit::Handler(_) => continue,
            };
            // Taken off the stack while it runs, and put back after. A `throw`
            // inside a `finally` belongs to whatever encloses the `try`, not to
            // the `try` whose `finally` it is -- and without this it would find
            // its own `catch` and loop back into it.
            let above = self.exits.split_off(at);
            let lowered = self.lower_statement(body);
            self.exits.extend(above);
            lowered?;
            // A `finally` that returns or throws replaces the completion that
            // was on its way out, so nothing further runs -- not the outer
            // `finally`s, and not the `return` this was called for.
            if self.is_terminated() {
                return Ok(());
            }
        }
        Ok(())
    }

    /// Give a handler its parameters and fill in the arguments every edge owes.
    ///
    /// Returns the parameter holding the thrown value, and sets `self.bindings`
    /// to what the handler's first statement sees.
    fn open_handler(
        &mut self,
        handler: BlockId,
        frame: &Handler,
        entry: &rustc_hash::FxHashMap<u32, ValueId>,
        origin: &Origin,
    ) -> ValueId {
        // The thrown value first, so its position does not depend on how many
        // names the edges disagreed about.
        let thrown = self.push_block_param(handler, HirType::Erased, origin.clone());

        // Sorted, for the same reason the merge in `lower_if` sorts: the source
        // is a hash map, and a parameter list that varies between runs would
        // stop the snapshot digest being a cache key.
        let mut names: Vec<u32> = entry.keys().copied().collect();
        names.sort_unstable();

        let at = |edge: &Edge, symbol: u32| {
            edge.bindings
                .get(&symbol)
                .copied()
                .or_else(|| entry.get(&symbol).copied())
        };

        let mut disagreed = Vec::new();
        let mut bindings = entry.clone();
        for symbol in names {
            let mut values = frame.edges.iter().filter_map(|edge| at(edge, symbol));
            let Some(first) = values.next() else {
                continue;
            };
            if values.all(|value| value == first) {
                // Every edge arrives with the same value, so the handler can
                // read it directly. This is most names, and each one is a
                // parameter and an argument per edge that never exist.
                bindings.insert(symbol, first);
            } else {
                disagreed.push(symbol);
            }
        }

        for &symbol in &disagreed {
            let ty = frame
                .edges
                .iter()
                .find_map(|edge| at(edge, symbol))
                .map_or(HirType::Erased, |value| {
                    self.values[value.0 as usize].ty.clone()
                });
            let param = self.push_block_param(handler, ty, origin.clone());
            bindings.insert(symbol, param);
        }

        for edge in &frame.edges {
            let mut args = Vec::with_capacity(1 + disagreed.len());
            args.push(edge.thrown);
            args.extend(disagreed.iter().filter_map(|&symbol| at(edge, symbol)));
            if let Some(Terminator::Jump { args: slot, .. }) =
                &mut self.blocks[edge.from.0 as usize].terminator
            {
                *slot = args;
            }
        }

        self.bindings = bindings;
        thrown
    }

    /// Bind `catch (e)`'s name to the thrown value.
    fn bind_caught(&mut self, declaration: NodeId, thrown: ValueId) -> Result<(), Diagnostic> {
        // The declaration's own symbol if it carries one, and otherwise its
        // name's -- the same two places every other binding is read from.
        let symbol = self.node(declaration).symbol.or_else(|| {
            self.children(declaration)
                .first()
                .and_then(|&name| self.node(name).symbol)
        });
        let Some(symbol) = symbol else {
            // `catch ({ code })`. The value is there and nothing names it.
            return Err(self.unsupported(declaration, "a `catch` that destructures"));
        };
        let value = self.open_cell(symbol.0, thrown, declaration);
        self.bindings.insert(symbol.0, value);
        Ok(())
    }

    /// Merge the two ways out of a `try`.
    fn join_try(
        &mut self,
        origin: &Origin,
        body: (BlockId, bool, rustc_hash::FxHashMap<u32, ValueId>),
        handler: (BlockId, bool, rustc_hash::FxHashMap<u32, ValueId>),
        entry: rustc_hash::FxHashMap<u32, ValueId>,
    ) {
        let (body_tail, body_open, body_bindings) = body;
        let (handler_tail, handler_open, handler_bindings) = handler;
        if !body_open && !handler_open {
            // Both ways out ended in a `return` or a `throw`. Anything after
            // the `try` is unreachable and the block is already closed.
            return;
        }

        let merge = self.new_block();
        let mut merged: Vec<(u32, ValueId, ValueId)> = Vec::new();
        if body_open && handler_open {
            for (symbol, entering) in &entry {
                let from_body = body_bindings.get(symbol).copied().unwrap_or(*entering);
                let from_handler = handler_bindings.get(symbol).copied().unwrap_or(*entering);
                if from_body != from_handler {
                    merged.push((*symbol, from_body, from_handler));
                }
            }
            merged.sort_unstable();
        }

        let mut params = Vec::new();
        for (symbol, from_body, _) in &merged {
            let ty = self.values[from_body.0 as usize].ty.clone();
            params.push((*symbol, self.push_block_param(merge, ty, origin.clone())));
        }

        if body_open {
            self.switch_to(body_tail);
            let args = merged.iter().map(|(_, from_body, _)| *from_body).collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }
        if handler_open {
            self.switch_to(handler_tail);
            let args = merged
                .iter()
                .map(|(_, _, from_handler)| *from_handler)
                .collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }

        self.switch_to(merge);
        self.bindings = match (body_open, handler_open) {
            (true, false) => body_bindings,
            (false, true) => handler_bindings,
            _ => {
                let mut live = entry;
                for (symbol, param) in params {
                    live.insert(symbol, param);
                }
                live
            }
        };
    }

    /// Lower an expression knowing what type a bare `null` in it should take.
    fn lower_expecting(&mut self, id: NodeId, ty: &HirType) -> Result<ValueId, Diagnostic> {
        let saved = self.expecting.replace(ty.clone());
        let value = self.lower_expression(id);
        self.expecting = saved;
        value
    }

    /// A name no source can have, for a value only the lowering knows about.
    fn synthetic_symbol(&mut self) -> u32 {
        self.synthetic += 1;
        u32::MAX - self.synthetic
    }

    fn child_slots<const N: usize>(&self, id: NodeId) -> Option<[Option<NodeId>; N]> {
        let NodeData::Children { present, .. } = self.node(id).data else {
            return None;
        };
        let mut children = self.children(id).into_iter();
        let mut slots = [None; N];
        for (bit, slot) in slots.iter_mut().enumerate() {
            if present & (1 << bit) != 0 {
                *slot = children.next();
            }
        }
        Some(slots)
    }

    /// `i++` / `i--`, whose value is what the name held *before* the step.
    fn lower_postfix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a step expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a step expression of unexpected shape"));
        };
        // One bit, not the prefix table: `++` is 0 and `--` is 1.
        let op = if small & syntax::postfix_operator::MASK == syntax::postfix_operator::MINUS_MINUS
        {
            BinOp::Sub
        } else {
            BinOp::Add
        };
        let (before, _) = self.step(id, *operand, op)?;
        Ok(before)
    }

    /// `target = value`, for each kind of target.
    ///
    /// Three different operations wear one spelling. A name rebinds, which
    /// emits nothing at all -- the binding *is* the assignment. A field or an
    /// element writes through a reference, where there is no name to rebind and
    /// the store is the whole of the effect.
    fn lower_assignment(
        &mut self,
        id: NodeId,
        target: NodeId,
        source: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        // `[a, b] = [b, a]` and `({ x, y } = p)`. A pattern on the left is not
        // one place, so it cannot go through `place_of` at all: the value is
        // lowered *once* and each target is assigned a read of it, which is
        // what makes the swap idiom a swap rather than two copies of `b`.
        if matches!(
            self.kind_of(target),
            Some(syntax::ARRAY_LITERAL_EXPRESSION | syntax::OBJECT_LITERAL_EXPRESSION)
        ) {
            let value = self.lower_expression(source)?;
            self.assign_pattern(target, value)?;
            return Ok(value);
        }

        // The place first, then the value: `xs[i()] = v()` evaluates the array,
        // then the index, then the value, and JavaScript says so.
        let place = self.place_of(target)?;
        let value = self.lower_expression(source)?;
        self.write_place(id, &place, value);
        Ok(value)
    }

    /// Assign through a pattern written as a literal.
    ///
    /// The mirror of [`Self::bind_pattern`], and a separate function because
    /// the targets are *existing places* rather than new names: `[a, b] = …`
    /// writes to two locals, and `[o.x, xs[i]] = …` writes to a field and an
    /// element. So each target goes through `place_of` exactly as it would have
    /// on its own.
    ///
    /// The same shapes refuse, for the same reasons, and by the same names.
    fn assign_pattern(&mut self, target: NodeId, value: ValueId) -> Result<(), Diagnostic> {
        let object = self.kind_of(target) == Some(syntax::OBJECT_LITERAL_EXPRESSION);
        for (position, element) in self.children(target).into_iter().enumerate() {
            let origin = self.origin(element);
            let (property, destination) = if object {
                let parts = self.children(element);
                match (self.kind_of(element), parts.as_slice()) {
                    // `{ x: o.y } = p`: the property, then where it goes.
                    (Some(syntax::PROPERTY_ASSIGNMENT), [from, to]) => (*from, *to),
                    // `({ x } = p)`: one identifier standing for both the
                    // property *and* the variable it writes to -- and the
                    // symbol on it is the **property's**, not the variable's.
                    // Assigning through it wrote to a symbol nothing reads, so
                    // `x` kept its old value and the compiler said nothing.
                    //
                    // Resolving it needs the checker's
                    // `getShorthandAssignmentValueSymbol`, which this frontend
                    // does not ask for. Until it does, the explicit form
                    // `({ x: x } = p)` is the one that works, and this is
                    // refused rather than guessed at by name -- a guess would
                    // be wrong exactly where a local shadows an outer one.
                    (Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT), _) => {
                        return Err(self.unsupported(
                            element,
                            "a shorthand in an assignment pattern, whose name resolves to the property",
                        ));
                    }
                    _ => {
                        return Err(self.unsupported(
                            element,
                            "an assignment pattern with a default or a rest",
                        ));
                    }
                }
            } else {
                (element, element)
            };

            let read = if object {
                let HirType::Managed(ManagedType::Object(type_id)) =
                    self.values[value.0 as usize].ty.clone()
                else {
                    return Err(self.unsupported(element, "destructuring something with no fields"));
                };
                let layout = self.layout_of(element, type_id)?;
                let name = self
                    .literal_name(property)
                    .ok_or_else(|| self.unsupported(element, "a computed property name"))?;
                let Some(field) = layout
                    .index_of(&name)
                    .or_else(|| Self::symbol_keyed(&layout, &name))
                else {
                    return Err(self.absent_member(element, type_id, &name));
                };
                let ty = layout.fields[field as usize].ty.clone();
                self.push(
                    OpKind::FieldGet {
                        object: value,
                        field,
                    },
                    ty,
                    origin,
                )
            } else if let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[value.0 as usize].ty.clone()
            {
                // `const [a, b] = pair` where `pair` is a tuple. Written like an
                // array and read like an object, because that is what a tuple
                // is here: the position is the field.
                let layout = self.layout_of(element, type_id)?;
                let field = u32::try_from(position).unwrap_or(0);
                let Some(slot) = layout.fields.get(position) else {
                    return Err(self.unsupported(
                        element,
                        &format!(
                            "position {position} of a tuple with {} element(s)",
                            layout.fields.len()
                        ),
                    ));
                };
                let ty = slot.ty.clone();
                self.push(
                    OpKind::FieldGet {
                        object: value,
                        field,
                    },
                    ty,
                    origin,
                )
            } else {
                let HirType::Managed(ManagedType::Array(element_ty)) =
                    self.values[value.0 as usize].ty.clone()
                else {
                    return Err(
                        self.unsupported(element, "destructuring something that is not an array")
                    );
                };
                #[allow(clippy::cast_precision_loss)]
                let at = position as f64;
                let index = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
                self.push(
                    OpKind::ArrayGet {
                        array: value,
                        index,
                        checked: true,
                    },
                    *element_ty,
                    origin,
                )
            };

            let place = self.place_of(destination)?;
            self.write_place(destination, &place, read);
        }
        Ok(())
    }

    /// Work out *where* an assignment writes, evaluating the parts that decide
    /// it exactly once.
    ///
    /// Once is the whole point. `xs[next()] += 1` calls `next` a single time in
    /// JavaScript, so the index cannot be lowered again for the store -- and a
    /// compound assignment that re-lowered its target would call it twice.
    fn place_of(&mut self, target: NodeId) -> Result<Place, Diagnostic> {
        if self.names_a_property(target) {
            let children = self.children(target);
            let [object_node, member] = children.as_slice() else {
                return Err(self.unsupported(target, "a property of unexpected shape"));
            };
            let object = self.lower_expression(*object_node)?;
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[object.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(target, "assigning to this property"));
            };
            let layout = self.layout_of(target, type_id)?;
            let name = self
                .literal_name(*member)
                .ok_or_else(|| self.unsupported(*member, "a computed property name"))?;
            // `pair[0] = x`, which is the read's positional rule from the
            // other side. A tuple has no names, so the number is the field.
            let positional = name
                .parse::<usize>()
                .ok()
                .filter(|_| self.is_tuple(type_id))
                .filter(|at| *at < layout.fields.len())
                .and_then(|at| u32::try_from(at).ok());
            let Some(field) = positional
                .or_else(|| layout.index_of(&name))
                .or_else(|| Self::symbol_keyed(&layout, &name))
            else {
                // A setter, for the same reason.
                if let Some(callee) = self.accessor_callee(type_id, &name, "set ") {
                    return Ok(Place::Setter { object, callee });
                }
                return Err(self.absent_member(target, type_id, &name));
            };
            // A `readonly` field may be written by the constructor of the
            // object it belongs to, which is what TypeScript permits and what
            // makes the modifier usable at all -- a field nothing may ever
            // write is a field with no value. `readonly` is not emitted as a C
            // `const`, so there is nothing to write through: see the note in
            // the C backend for why the qualifier was dropped.
            //
            // On `this` specifically. A constructor assigning another object's
            // readonly field is refused, as TypeScript refuses it.
            // Asked of the **type**, not of the layout.
            //
            // A layout is shared by every type with the same shape, and
            // `same_shape` deliberately ignores `readonly` -- correctly, since
            // storage does not depend on who may write to it, and splitting
            // `Point` from `Readonly<Point>` would be two descriptors for one
            // arrangement of bytes. But writability is a fact about a *type*,
            // and reading it off a shared structure gives whichever type was
            // laid out first: `class Frozen { readonly count: number }` beside
            // `class Counter { count = 0 }` is one layout, and writing to the
            // counter was refused under the frozen one's name.
            //
            // The same mistake as the one in `declared_readonly` a level up,
            // which asked the whole program by name. Twice, a property's
            // writability was asked of something shared instead of of the
            // declaration that decides it.
            if self.property_is_readonly(type_id, &name)
                && !(self.in_constructor && Some(object) == self.this)
            {
                return Err(self.unsupported(
                    target,
                    &format!(
                        "assigning to `{}`.`{name}`, which is readonly outside the constructor of the object it belongs to",
                        layout.name,
                    ),
                ));
            }
            return Ok(Place::Field { object, field });
        }

        if self.kind_of(target) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            let (array, index) = self.element_access_parts(target)?;
            return Ok(Place::Element { array, index });
        }

        let symbol = self
            .node(target)
            .symbol
            .ok_or_else(|| self.unsupported(target, "assignment to a computed target"))?;
        // No alias resolution here, unlike the read: assigning to an imported
        // binding is a type error, so an alias symbol cannot be the target of
        // an assignment in a program that got this far.
        //
        // A module-scope variable is a store, not a rebinding: every function
        // sees the same one, so there is nothing to shadow.
        if !self.bindings.contains_key(&symbol.0)
            && let Some(global) = self.module.variables.get(&symbol.0).copied()
        {
            return Ok(Place::Global(global));
        }
        if self.module.constants.contains_key(&symbol.0) {
            return Err(self.unsupported(target, "assigning to a `const`"));
        }
        // From the target, which is where the checker gives the *declared*
        // type: the left of an assignment is not narrowed by what came before
        // it, because the assignment is what does the narrowing.
        let ty = self.type_of(target);
        Ok(Place::Binding {
            symbol: symbol.0,
            ty,
        })
    }

    /// What a place currently holds.
    ///
    /// Asked by the three forms that read a place before writing it: a compound
    /// assignment, a step, and a logical assignment. A plain `=` does not come
    /// here, which is what keeps the accessor refusal below narrow.
    fn read_place(&mut self, id: NodeId, place: &Place) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        Ok(match *place {
            Place::Field { object, field } => {
                let layout = match self.values[object.0 as usize].ty.clone() {
                    HirType::Managed(ManagedType::Object(ty)) => self.layout_of(id, ty)?,
                    _ => return Err(self.unsupported(id, "reading a field of something else")),
                };
                let ty = layout.fields[field as usize].ty.clone();
                // An erased field read where the checker narrowed is the same
                // question an erased *binding* read is, and gets the same
                // answer: `if (o.limit !== undefined) o.limit * 2` reads a
                // number, and the declaration says `number | undefined`.
                let read = self.push(OpKind::FieldGet { object, field }, ty, origin);
                self.narrowed(id, read)?
            }
            // `o.x += 1` and `o.x ??= 1` where `x` is an accessor read
            // through the *getter* and write through the setter, and this place
            // knows only the setter. Refused rather than guessed at, which is a
            // narrower gap than it looks: a plain `o.x = v` does not come here.
            //
            // Named for what it is rather than for one of the forms that asks.
            // The message said "a compound assignment" while `??=` was refused
            // by it too, which is a refusal naming a construct the source does
            // not contain.
            Place::Setter { .. } => {
                return Err(self.unsupported(id, "an assignment that reads through an accessor"));
            }
            Place::Element { array, index } => {
                let HirType::Managed(ManagedType::Array(element)) =
                    self.values[array.0 as usize].ty.clone()
                else {
                    return Err(self.not_an_array(id));
                };
                self.push(
                    OpKind::ArrayGet {
                        array,
                        index,
                        checked: true,
                    },
                    *element,
                    origin,
                )
            }
            Place::Global(global) => {
                let ty = self.module.types[global as usize].clone();
                self.push(OpKind::GlobalGet(global), ty, origin)
            }
            Place::Binding { symbol, .. } => {
                let bound = *self
                    .bindings
                    .get(&symbol)
                    .ok_or_else(|| self.unsupported(id, "reading a name before it is bound"))?;
                self.read_cell(symbol, bound, id).unwrap_or(bound)
            }
        })
    }

    /// What actually gets stored into an array slot.
    ///
    /// For a `number[]` the value *is* what is stored. For a typed array it is
    /// not: `u8[i] = 300` stores 44, `i32[i] = 1.7` stores 1, and `u8[i] = NaN`
    /// stores 0 — ECMAScript truncates toward zero and takes the result modulo
    /// the width, with every non-finite case going to zero.
    ///
    /// C's `(uint8_t)someDouble` is *undefined behaviour* for all three, so the
    /// conversion is a named helper rather than a cast left to the backend. The
    /// helper is `static inline` and folds to nothing where the range is
    /// already known, which is the common case in a loop that built the value.
    fn coerce_element(&mut self, id: NodeId, array: ValueId, value: ValueId) -> ValueId {
        let numeric = |ty: &HirType| matches!(ty, HirType::Int { .. } | HirType::Float { .. });
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return value;
        };
        let held = self.values[value.0 as usize].ty.clone();
        // An erased element is the general case rather than a numeric
        // coercion: the value is tagged on the way in, whatever it was. It
        // comes first because the numeric guard below would return the value
        // unchanged, and a `double` stored into an `NtsValue` slot is what the
        // C compiler then reports -- which is how this was found, four
        // conversion sites after the first.
        if *element == HirType::Erased && held != HirType::Erased {
            return self.coerce(value, &HirType::Erased, id).unwrap_or(value);
        }
        if held == *element || !numeric(&element) || !numeric(&held) {
            return value;
        }
        let origin = self.origin(id);
        match super::builtin::element_coercion(&element) {
            Some(helper) => self.push(
                OpKind::Call {
                    callee: Callee::External(helper.to_owned()),
                    args: vec![value],
                    frame: None,
                },
                (*element).clone(),
                origin,
            ),
            // A defined narrowing — `double` to `float` — or nothing at all.
            None => self.push(OpKind::Convert(value), (*element).clone(), origin),
        }
    }

    /// Both sides of a string `+` have to *be* strings.
    ///
    /// `+` resolves to concatenation from the *result* type, which is right —
    /// `"a" + "b"` is a string and `1 + 2` is not — and says nothing about the
    /// operands. `"" + n` is a string result with a `double` operand, and it
    /// reached the backend as `(NtsString *)v0`: a cast from a double to a
    /// pointer, which is not merely wrong but is C that does not compile. The
    /// lowering reported success and clang reported the error, with no source
    /// location and nothing pointing at the `+`.
    ///
    /// What it needs is `ToString`, and there is no cheap version of that for a
    /// number: the shortest decimal that round-trips through a `double` is a
    /// real algorithm — Ryū, Grisu — and `%.17g` is not it. So this is refused
    /// rather than approximated.
    /// `` `a${x}b` ``, which is a concatenation written with fewer plus signs.
    ///
    /// The tree is a head, then one span per substitution, each span holding
    /// its expression and the literal text that follows it. So the lowering is
    /// the same walk left to right that the source reads as, and the
    /// substitutions are evaluated in that order — which is observable, because
    /// one of them may call something.
    ///
    /// Each substitution goes through [`Self::as_string`], so `` `${n}` `` is
    /// `String(n)` and gets ECMAScript's conversion rather than a `printf` one.
    /// An empty literal part contributes no concatenation: `` `${a}${b}` `` is
    /// one join rather than three.
    fn lower_template(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        let mut result: Option<ValueId> = None;

        for part in self.children(id) {
            match self.kind_of(part) {
                Some(syntax::TEMPLATE_HEAD) => {
                    let literal = self.node(part).text.clone().unwrap_or_default();
                    if !literal.is_empty() {
                        let origin = self.origin(part);
                        result =
                            Some(self.push(OpKind::ConstString(literal), text.clone(), origin));
                    }
                }
                Some(syntax::TEMPLATE_SPAN) => {
                    let pieces = self.children(part);
                    let [expression, literal] = pieces.as_slice() else {
                        return Err(self.unsupported(part, "a template span of unexpected shape"));
                    };
                    let value = self.lower_expression(*expression)?;
                    let value = self.as_string(*expression, value)?;
                    result = Some(self.join(part, result, value, &text));

                    let literal_text = self.node(*literal).text.clone().unwrap_or_default();
                    if !literal_text.is_empty() {
                        let origin = self.origin(*literal);
                        let piece =
                            self.push(OpKind::ConstString(literal_text), text.clone(), origin);
                        result = Some(self.join(part, result, piece, &text));
                    }
                }
                _ => return Err(self.unsupported(part, "a template part of unexpected shape")),
            }
        }

        // `` `` `` has no parts at all, and a template of empty ones reduces to
        // the same nothing. Both are the empty string.
        if let Some(value) = result {
            return Ok(value);
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstString(String::new()), text, origin))
    }

    /// Concatenate onto what a template has built so far, or start it.
    fn join(
        &mut self,
        at: NodeId,
        left: Option<ValueId>,
        right: ValueId,
        text: &HirType,
    ) -> ValueId {
        let Some(left) = left else {
            return right;
        };
        let origin = self.origin(at);
        self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: left,
                rhs: right,
            },
            text.clone(),
            origin,
        )
    }

    /// A value as a string, converting a number the way JavaScript does.
    ///
    /// `+` resolves to concatenation from the *result* type, which is right —
    /// `"a" + "b"` is a string and `1 + 2` is not — and says nothing about the
    /// operands. `"" + n` is a string result with a `double` operand, and it
    /// used to reach the backend as `(NtsString *)v0`: a cast from a double to
    /// a pointer, which clang rejects.
    ///
    /// So the operands are converted here, by `nts_number_to_string` —
    /// ECMAScript's `Number::toString` rather than a `printf` conversion,
    /// because `%.17g` prints `0.1` as `0.10000000000000001` and switches to
    /// exponential notation at a threshold that is not JavaScript's.
    ///
    /// Everything else is refused. `String(true)` is `"true"` and an object's
    /// is `toString` off the prototype chain, and neither is a conversion this
    /// compiler has.
    fn as_string(&mut self, from: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        match self.values[value.0 as usize].ty {
            // A `string | null` is one pointer and the null in it is not a
            // string. Passing it through handed the concatenation a null
            // pointer, and the program aborted on the first thing that read it
            // -- which the differential reports as a *declined* case rather
            // than a disagreement, so "agreed on every case" was counting only
            // the runs that reached the end.
            //
            // `String(null)` is "null" and `String(undefined)` is "undefined".
            // Which one is a property of the type, exactly as it is for `===`.
            HirType::Managed(ManagedType::String)
                if matches!(self.absences_of(from).as_deref(), Some([_])) =>
            {
                let absent = self.absences_of(from).unwrap_or_default();
                let spelling = if absent.first() == Some(&super::tags::NULL) {
                    "null"
                } else {
                    "undefined"
                };
                let origin = self.origin(from);
                let when_absent = self.push(OpKind::ConstString(spelling.to_owned()), text, origin);
                // The type is that absence and nothing else -- what the checker
                // leaves a binding at after `v = null`. There is no branch to
                // build, and trying to build one asked for the representation
                // of `null`, which there is none of.
                if self.only_absences(from) {
                    return Ok(when_absent);
                }
                let Some(condition) = self.absence_of(from, value) else {
                    return Ok(value);
                };
                self.lower_branching_value(
                    from,
                    condition,
                    Branch::Value(when_absent),
                    Branch::Value(value),
                )
            }
            HirType::Managed(ManagedType::String) => Ok(value),
            // An erased value carries the tag that says which spelling it
            // wants, and five of the seven tags spell themselves exactly. The
            // other two want `toString` off a prototype chain, so the question
            // is asked of the *type* rather than left to the tag: a union of
            // scalars and absences converts, one that can hold an object does
            // not, and `String(unknown)` stays refused.
            //
            // `String(xs.pop())` is the case that made this necessary. The
            // checker types it `number | undefined` and there is no doubling
            // back from that: the absent answer has to survive the conversion.
            HirType::Erased if self.spells_itself(from) => {
                let origin = self.origin(from);
                Ok(self.push(
                    OpKind::Call {
                        callee: Callee::External("nts_value_to_string".to_owned()),
                        args: vec![value],
                        frame: None,
                    },
                    text,
                    origin,
                ))
            }
            // A `bool` and a `bigint` each have an exact spelling of their
            // own: two words, and decimal with no exponent however large.
            // Neither is something a double's formatter can be handed.
            HirType::Float { .. } | HirType::Int { .. } | HirType::Bool | HirType::BigInt => {
                let helper = match self.values[value.0 as usize].ty {
                    HirType::Bool => "nts_bool_to_string",
                    HirType::BigInt => "nts_bigint_to_string",
                    _ => "nts_number_to_string",
                };
                let origin = self.origin(from);
                Ok(self.push(
                    OpKind::Call {
                        callee: Callee::External(helper.to_owned()),
                        args: vec![value],
                        frame: None,
                    },
                    text,
                    origin,
                ))
            }
            _ => Err(self.unsupported(from, "a conversion to string from this type")),
        }
    }

    /// Whether every member of a node's type has an exact spelling as text.
    ///
    /// An object's is `toString` off the prototype chain -- `"[object Object]"`
    /// for a plain one, the joined elements for an array -- which is §13's and
    /// does not exist here. A number, a string, a boolean, a bigint, `null` and
    /// `undefined` each spell themselves and nothing else is consulted.
    fn spells_itself(&self, node: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&node) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let members: Vec<TypeId> = match &record.kind {
            TypeKind::Union(members) => members.clone(),
            _ => vec![*ty],
        };
        members.iter().all(|member| {
            self.snapshot
                .types
                .get(member.0 as usize)
                .is_some_and(|record| {
                    matches!(
                        record.kind,
                        TypeKind::Number
                            | TypeKind::String
                            | TypeKind::Boolean
                            | TypeKind::BigInt
                            | TypeKind::Null
                            | TypeKind::Undefined
                            | TypeKind::Void
                            | TypeKind::Literal(_)
                    )
                })
        })
    }

    /// Put a value into a place.
    /// A store converts, and which conversion it is depends on the *slot*.
    ///
    /// One function for every kind of place, because doing it per site is how
    /// this kept going wrong: an erased array element, then an erased field,
    /// then an erased global were each found separately, one C compile error
    /// or one rejected SSA form at a time. A store is the only thing that
    /// reaches a slot, and this is the only thing a store goes through.
    ///
    /// A setter is not a slot -- it is a call, and its parameter is converted
    /// where every other argument is.
    fn coerce_to_slot(&mut self, id: NodeId, place: &Place, value: ValueId) -> ValueId {
        let want = match *place {
            Place::Element { array, .. } => return self.coerce_element(id, array, value),
            Place::Field { object, field } => {
                let HirType::Managed(ManagedType::Object(ty)) =
                    self.values[object.0 as usize].ty.clone()
                else {
                    return value;
                };
                match self.layout_of(id, ty) {
                    Ok(layout) => layout
                        .fields
                        .get(field as usize)
                        .map(|slot| slot.ty.clone()),
                    Err(_) => None,
                }
            }
            Place::Global(global) => self.module.types.get(global as usize).cloned(),
            // A binding is an SSA value rather than a slot, and it still has a
            // declared type that every assignment has to keep: `let held:
            // unknown = "text"; held = n` rebound `held` to an `f64`, and a
            // later `typeof held` then had no tag to read.
            Place::Binding { ref ty, .. } => ty.clone(),
            Place::Setter { .. } => None,
        };
        let Some(want) = want else {
            return value;
        };
        // Unchanged where there is nothing to do, which is every store in a
        // program with no erased values in it.
        self.coerce(value, &want, id).unwrap_or(value)
    }

    fn write_place(&mut self, id: NodeId, place: &Place, value: ValueId) {
        let origin = self.origin(id);
        let value = self.coerce_to_slot(id, place, value);
        match *place {
            Place::Field { object, field } => {
                self.push(
                    OpKind::FieldSet {
                        object,
                        field,
                        value,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Setter { object, ref callee } => {
                self.push(
                    OpKind::Call {
                        callee: Callee::Direct(callee.clone()),
                        args: vec![object, value],
                        frame: None,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Element { array, index } => {
                self.push(
                    OpKind::ArraySet {
                        array,
                        index,
                        value,
                        checked: true,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Global(global) => {
                self.push(OpKind::GlobalSet { global, value }, HirType::Void, origin);
            }
            Place::Binding { symbol, .. } => {
                // A cell is storage, so the write is a store rather than a new
                // binding: the closure holding the same cell has to see it.
                match self
                    .cell_of(symbol)
                    .and(self.bindings.get(&symbol).copied())
                {
                    Some(cell) => {
                        self.push(
                            OpKind::FieldSet {
                                object: cell,
                                field: 0,
                                value,
                            },
                            HirType::Void,
                            origin,
                        );
                    }
                    None => {
                        self.bindings.insert(symbol, value);
                    }
                }
            }
        }
    }

    fn push_bitwise(
        &mut self,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
        ty: HirType,
        origin: &Origin,
    ) -> ValueId {
        // A `bigint`'s bitwise operators are not JavaScript's. `1n << 40n` is
        // 2^40, where `1 << 40` is 256 -- a number's shift count is masked to
        // five bits and its operands are truncated to int32, and a `bigint` has
        // neither rule. TypeScript will not let the two mix, so the operand type
        // is enough to tell which set applies.
        //
        // Caught by the differential: `x <<= 40n` came back as 1 where node said
        // 2^32, because 40 & 31 is 8.
        if matches!(ty, HirType::BigInt) {
            return self.push(OpKind::Binary { op, lhs, rhs }, ty, origin.clone());
        }
        let left_coercion = if matches!(op, BinOp::UShr) {
            UnOp::ToUint32
        } else {
            UnOp::ToInt32
        };
        let left = self.push(
            OpKind::Unary {
                op: left_coercion,
                operand: lhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let right = self.push(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: rhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.push(
            OpKind::Binary {
                op,
                lhs: left,
                rhs: right,
            },
            ty,
            origin.clone(),
        )
    }

    /// The shared half of `++`/`--`: add or subtract one and rebind the name.
    /// `x++`, `++x`, and their decrementing halves.
    ///
    /// Returns the value before the step and the value after it, because the
    /// prefix and postfix forms differ in exactly which one they evaluate to.
    /// The place is read and written *once*, which is what a step is.
    fn step(
        &mut self,
        id: NodeId,
        target: NodeId,
        op: BinOp,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        let place = self.place_of(target)?;
        let current = self.read_place(target, &place)?;
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a step"))?;
        let one = self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone());
        let stepped = self.push(
            OpKind::Binary {
                op,
                lhs: current,
                rhs: one,
            },
            ty,
            origin,
        );
        self.write_place(id, &place, stepped);
        Ok((current, stepped))
    }

    /// `if (c) { .. } else { .. }`.
    ///
    /// # The merge is where the arms have to agree
    ///
    /// Each arm may leave a different value in the same name. After the `if`,
    /// which one is live depends on the edge taken — which is precisely what a
    /// block parameter is for, and the same mechanism a loop header uses.
    ///
    /// Without it, the name keeps whatever value the last-lowered arm produced,
    /// defined in a block the merge does not dominate. That is invalid SSA. It
    /// also *compiles*, to code that reads a variable the other path never wrote,
    /// which is why the verifier exists rather than a code review.
    ///
    /// Only names the arms disagree about become parameters. One they agree on is
    /// already defined before the branch — two arms cannot produce the same
    /// [`ValueId`] otherwise — so it dominates the merge, and a parameter for it
    /// would be a copy carrying no information.
    fn lower_if(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let (condition, then_branch, else_branch) = match children.as_slice() {
            [condition, then_branch] => (*condition, *then_branch, None),
            [condition, then_branch, else_branch] => (*condition, *then_branch, Some(*else_branch)),
            _ => return Err(self.unsupported(id, "an `if` of unexpected shape")),
        };

        let origin = self.origin(id);
        let cond = self.lower_expression(condition)?;
        // `if (x)` takes any value, not just a boolean, and JavaScript decides
        // which are false. An empty string and a NaN are, which is why this
        // cannot be left to C's own idea of a condition.
        let cond = self.truthy(condition, cond);
        let then_block = self.new_block();

        // With no `else`, the false edge goes straight to the merge. Allocating an
        // else block for it would leave a block whose only content is a jump —
        // once per `if` without an else, which is most of them.
        let (else_block, preallocated) = if else_branch.is_some() {
            (self.new_block(), None)
        } else {
            let merge = self.new_block();
            (merge, Some(merge))
        };

        // Remembered because the false edge's arguments are not known until the
        // merge has parameters, which is after both arms are lowered.
        let branch_block = self.current;
        self.terminate(Terminator::Branch {
            cond,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        // What each name held on entry: the baseline the arms are compared
        // against, and what the false edge carries when there is no `else`.
        let entry = self.bindings.clone();

        self.switch_to(then_block);
        self.lower_statement(then_branch)?;
        // The block the arm *ended* in, which nested control flow moves away from
        // the block it started in. Terminating `then_block` instead would leave
        // the real tail without a terminator.
        let then_tail = self.current;
        let then_open = !self.is_terminated();
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        let (else_tail, else_open, else_bindings) = match else_branch {
            Some(else_branch) => {
                self.switch_to(else_block);
                self.lower_statement(else_branch)?;
                let tail = self.current;
                let open = !self.is_terminated();
                let bindings = std::mem::replace(&mut self.bindings, entry.clone());
                (tail, open, bindings)
            }
            // The false edge is the merge, which is open by construction and
            // changes nothing.
            None => (else_block, true, entry.clone()),
        };

        if !then_open && !else_open {
            // Both arms ended. Anything after the `if` is unreachable, and the
            // enclosing block is already closed.
            return Ok(());
        }

        let merge = preallocated.unwrap_or_else(|| self.new_block());

        let mut merged: Vec<(u32, ValueId, ValueId)> = Vec::new();
        if then_open && else_open {
            for (symbol, entering) in &entry {
                let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
                let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
                if from_then != from_else {
                    merged.push((*symbol, from_then, from_else));
                }
            }
            // Sorted because the source is a hash map: without this the parameter
            // list would vary between runs of one compiler on one input, and the
            // snapshot digest would stop being a cache key.
            merged.sort_unstable();
        }

        let mut params = Vec::new();
        for (symbol, from_then, _) in &merged {
            let ty = self.values[from_then.0 as usize].ty.clone();
            params.push((*symbol, self.push_block_param(merge, ty, origin.clone())));
        }

        if then_open {
            self.switch_to(then_tail);
            let args = merged.iter().map(|(_, from_then, _)| *from_then).collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }
        if else_branch.is_some() {
            if else_open {
                self.switch_to(else_tail);
                let args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
                self.terminate(Terminator::Jump {
                    target: merge,
                    args,
                });
            }
        } else if let Some(Terminator::Branch { else_args, .. }) =
            &mut self.blocks[branch_block.0 as usize].terminator
        {
            // The false edge points at the merge directly, so its arguments live
            // on the branch rather than on a jump of its own.
            *else_args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
        }

        self.switch_to(merge);
        self.bindings = match (then_open, else_open) {
            // Only one arm reaches the merge, so its bindings are the live ones
            // outright — no parameter is needed to choose between them.
            (true, false) => then_bindings,
            (false, true) => else_bindings,
            _ => {
                let mut live = entry;
                for (symbol, param) in params {
                    live.insert(symbol, param);
                }
                live
            }
        };
        Ok(())
    }

    fn lower_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::RETURN_STATEMENT) => {
                let expression = self.children(id).first().copied();
                let value = match expression {
                    Some(expression) => Some(self.lower_expression(expression)?),
                    None => None,
                };
                if let Some(target) = self.callback_returns.last().copied() {
                    // Only the `try`s inside the callback. A `return` here means
                    // "this element is done", so it leaves the `try`s written in
                    // the callback body and *not* one the call itself is inside
                    // -- the enclosing `try` is not being left at all.
                    let floor = self.breakables[target.depth].exits_at;
                    self.run_finallys_to(floor)?;
                    if self.is_terminated() {
                        return Ok(());
                    }
                    return self.return_from_callback(id, target, value);
                }
                if let Some(result) = self.async_result.clone() {
                    // The whole function is being left, so every one of them.
                    self.run_finallys_to(0)?;
                    if self.is_terminated() {
                        return Ok(());
                    }
                    return self.settle_and_return(id, &result, value);
                }
                // At the type the *signature* declares, and only on this path:
                // a callback return and an `async` settle both hand the value
                // somewhere else, at a type of their own. `function f():
                // unknown { return n }` returns an erased value, and returning
                // the raw double instead lowered with nothing refused and then
                // failed in C -- the verifier checks call arguments and not
                // returns, so this had nothing watching it.
                let value = match (value, expression) {
                    // `return f();` where the function returns nothing. Legal
                    // JavaScript -- the result is `undefined` either way -- and
                    // the expression has already been lowered, so its effects
                    // happen and its value is dropped.
                    //
                    // Keeping it produced `Return(Some(v))` on a function whose
                    // C signature says `void`, and `v` was a call typed void,
                    // which the emitter declares no variable for. `return v4;`
                    // with no `v4`: uncompilable C from a function the lowering
                    // called complete.
                    (Some(_), _) if matches!(self.returns, HirType::Void) => None,
                    (Some(value), Some(expression)) => {
                        let want = self.returns.clone();
                        Some(self.coerce(value, &want, expression)?)
                    }
                    (value, _) => value,
                };
                // A `return` leaves every `try` it is inside, so every pending
                // `finally` runs before it -- after the returned expression has
                // been evaluated, which is the order the language specifies.
                self.run_finallys_to(0)?;
                if self.is_terminated() {
                    // A `finally` returned or threw, which replaces this
                    // return outright.
                    return Ok(());
                }
                self.terminate(Terminator::Return(value));
                Ok(())
            }
            Some(syntax::BLOCK) => self.lower_block(id),
            Some(syntax::IF_STATEMENT) => self.lower_if(id),
            Some(syntax::WHILE_STATEMENT) => self.lower_while(id),
            Some(syntax::DO_STATEMENT) => self.lower_do_while(id),
            Some(syntax::SWITCH_STATEMENT) => self.lower_switch(id),
            Some(syntax::FOR_STATEMENT) => self.lower_for(id),
            Some(syntax::FOR_OF_STATEMENT) => self.lower_for_of(id),
            Some(syntax::BREAK_STATEMENT) => self.lower_break(id),
            Some(syntax::CONTINUE_STATEMENT) => self.lower_continue(id),
            // Two kinds with nothing to run, for two different reasons.
            //
            // `;` on its own has nothing to lower and nothing wrong with it.
            //
            // A function declared inside a body is lowered by the walk in
            // `lower`, which visits *every* `FUNCTION_DECLARATION` in the file
            // and not only the top-level ones -- so the statement is a
            // declaration here exactly as `is_module_declaration` says it is at
            // module scope: its body is its own business. Hoisting comes free
            // with that. The name is a function in the program before any
            // statement here executes, so a call above the declaration resolves
            // like any other.
            //
            // One that reads a local of the function around it is refused, and
            // by the walk rather than here: lowered on its own it has a free
            // name, and "`base`, a name from an enclosing scope" says which.
            // That is a closure, and this is not the path that builds one.
            Some(syntax::EMPTY_STATEMENT | syntax::FUNCTION_DECLARATION) => Ok(()),
            Some(syntax::THROW_STATEMENT) => self.lower_throw(id),
            Some(syntax::TRY_STATEMENT) => self.lower_try(id),
            Some(syntax::LABELED_STATEMENT) => self.lower_labeled(id),
            Some(syntax::EXPRESSION_STATEMENT) => {
                let Some(expression) = self.children(id).first().copied() else {
                    return Ok(());
                };
                let value = self.lower_expression(expression)?;
                // A call to something declared `never` does not come back, and
                // saying so is what makes the rest of the block dead rather
                // than merely unreached. `boundsError(offset, last)` is the
                // last statement of `Buffer#at8`, which is declared `: number`
                // and returns from every other path -- TypeScript accepts it
                // *because* the call cannot return, and without that fact the
                // function looked like one that falls out of its end owing a
                // value.
                //
                // `Unreachable` and not `FellThrough`: this is a claim the
                // lowering can back, which is the whole difference between the
                // two terminators.
                if self.values[value.0 as usize].ty == HirType::Never {
                    self.terminate(Terminator::Unreachable);
                }
                Ok(())
            }
            Some(syntax::VARIABLE_STATEMENT) => self.lower_variable_statement(id),

            // Named, not "this statement". Five sites in the corpus shared
            // that message and no reader could rank them -- which is the
            // mistake `describe_name` exists to undo one field over, and the
            // one `typescript.md` §15 warns about in as many words: the first
            // move on a row is to name what it blocks on. `for...in` and
            // `try` are different features and a count that adds them together
            // ranks neither.
            _ => {
                let what = self
                    .kind_of(id)
                    .and_then(nts_semantic_schema::syntax::name_of)
                    .map_or_else(
                        || "this statement".to_owned(),
                        |name| format!("a `{name}`"),
                    );
                Err(self.unsupported(id, &what))
            }
        }
    }

    fn lower_expression(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::IDENTIFIER) => self.lower_identifier(id),
            Some(syntax::NUMERIC_LITERAL) => self.lower_number(id),
            Some(syntax::BIGINT_LITERAL) => self.lower_bigint(id),
            Some(syntax::STRING_LITERAL) => self.lower_string(id),
            Some(syntax::BINARY_EXPRESSION) => self.lower_binary(id),
            Some(syntax::CALL_EXPRESSION) => self.lower_call(id),
            // Parentheses group; they compute nothing. Lowering the inner
            // expression is the whole of it — the grouping already happened when
            // the parser built the tree this shape.
            Some(syntax::PARENTHESIZED_EXPRESSION) => {
                let children = self.children(id);
                let [inner] = children.as_slice() else {
                    return Err(
                        self.unsupported(id, "a parenthesized expression of unexpected shape")
                    );
                };
                self.lower_expression(*inner)
            }
            Some(syntax::CONDITIONAL_EXPRESSION) => self.lower_conditional(id),
            Some(syntax::ARRAY_LITERAL_EXPRESSION) => self.lower_array_literal(id),
            Some(syntax::OBJECT_LITERAL_EXPRESSION) => self.lower_object_literal(id),
            Some(syntax::NEW_EXPRESSION) => self.lower_new(id),
            Some(syntax::ARROW_FUNCTION) => self.lower_arrow(id),
            Some(syntax::NULL_KEYWORD) => self.lower_absent(id),
            // `this` is parameter zero of a method. Outside one there is no
            // receiver to name.
            Some(syntax::THIS_KEYWORD) => self
                .this
                .ok_or_else(|| self.unsupported(id, "`this` outside a method")),
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => self.lower_element_access(id),
            Some(syntax::AWAIT_EXPRESSION) => self.lower_await(id),
            Some(syntax::YIELD_EXPRESSION) => self.lower_yield(id),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => self.lower_property_access(id),
            // `x!`, `x as T` and `x satisfies T` are claims about types. The
            // first two narrow what the checker believes; the third asserts
            // without narrowing. None of them computes anything, so each lowers
            // to its operand — but the *claim* is not free: an `x!` on an
            // element access is the author asserting the index is in bounds, and
            // the bounds check is what makes that assertion checked rather than
            // assumed. `docs/any-unknown.md` calls this out as the general rule
            // for assertions.
            Some(
                syntax::NON_NULL_EXPRESSION | syntax::AS_EXPRESSION | syntax::SATISFIES_EXPRESSION,
            ) => {
                let children = self.children(id);
                let Some(inner) = children.first() else {
                    return Err(self.unsupported(id, "an assertion with no operand"));
                };
                let value = self.lower_expression(*inner)?;
                // An assertion *from* an erased value is the one that computes
                // something: `columns[0] as string` where the element is
                // `string | number` reads the payload back at the asserted
                // type. That is what the author claimed, and it is the same
                // unerase a checker-narrowed read emits -- the difference is
                // only who established it.
                //
                // Where nothing is erased this is the identity, which is what
                // every other assertion stays.
                self.narrowed(id, value)
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => self.lower_prefix_unary(id),
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.lower_postfix_unary(id),
            Some(syntax::TRUE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin))
            }
            Some(syntax::FALSE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(false), HirType::Bool, origin))
            }
            // A template with nothing in it is a string literal written with
            // different quotes.
            Some(syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL) => {
                let text = self.node(id).text.clone().unwrap_or_default();
                let origin = self.origin(id);
                Ok(self.push(
                    OpKind::ConstString(text),
                    HirType::Managed(ManagedType::String),
                    origin,
                ))
            }
            Some(syntax::TEMPLATE_EXPRESSION) => self.lower_template(id),
            Some(syntax::DELETE_EXPRESSION) => self.lower_delete(id),
            Some(syntax::TYPE_OF_EXPRESSION) => self.lower_typeof(id),
            // Named rather than left to the fallthrough below, for the reason
            // `yield` is: an unlabelled refusal cannot be grouped, ranked or
            // counted, so a construct that lands there is invisible to anyone
            // deciding what to implement next.
            //
            // The suggestion is a real one and is checked: an arrow function
            // with the same body lowers today. It is not a rewrite rule -- the
            // two differ in `this` and `arguments`, and
            // `internal/deprecate.ts` is a case that genuinely needs the
            // first -- which is why this says "when" rather than "so".
            // One that binds its own `this` is still refused, and says so.
            Some(syntax::FUNCTION_EXPRESSION) => {
                if self.binds_this(id) {
                    Err(self.unsupported(id, &self.why_not_arrow(id)))
                } else {
                    self.lower_arrow(id)
                }
            }
            Some(syntax::REGULAR_EXPRESSION_LITERAL) => Err(self.unsupported(
                id,
                "a regular expression literal, which needs a regular expression engine",
            )),
            // Named, because the fallthrough below does not name anything and a
            // refusal nobody can group by is a refusal nobody can rank. Every
            // `yield` in the node profile was reported as "this expression",
            // so a work-list built from these messages could not see generators
            // at all -- and node's `readline` key decoder is one.
            //
            // Refusing it is the whole of what this compiler can say today.
            // Carrying the kind, for the same reason `yield` got a name of its
            // own: a refusal nobody can group by is a refusal nobody can rank.
            // The number is not an explanation, but it is enough to sort a
            // work-list by and to find the one case that is worth naming next.
            kind => Err(self.unsupported(
                id,
                &kind.map_or_else(
                    || "a node list".to_owned(),
                    |kind| spell(kind, "an expression"),
                ),
            )),
        }
    }

    /// `const x = expr` / `let x = expr`.
    ///
    /// A declaration with an initializer binds its symbol to the initializer's
    /// value — no slot and no store, because nothing here can reassign it yet.
    /// When assignment arrives, a `let` will need one and a `const` still will
    /// not, which is what the snapshot's variable kind is for.
    /// `[a, b, c]`.
    ///
    /// An allocation and a store per element. The length is known here, so it
    /// is a constant, which is what lets the analysis prove that every one of
    /// these stores is in bounds — the checks below are elided before they cost
    /// anything.
    fn lower_array_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            // `[]` is typed `never[]`, which is the checker saying the literal
            // decides nothing -- the slot it goes into does. So the expected
            // type wins over it, and only over it: a literal with elements
            // knows what it holds.
            .filter(|ty| {
                !matches!(ty, HirType::Managed(ManagedType::Array(element))
                    if **element == HirType::Never)
            })
            // Unfiltered, and the line below is why: a non-array expected type
            // is rejected there, with a message that names what went wrong.
            // Filtering it here refused the same programs one step earlier and
            // called them unrepresentable instead, which cost four functions in
            // the node profile to the cascade that followed.
            .or_else(|| self.expecting.clone())
            // And where nothing is expecting it, what its *position* says --
            // the same question `null` asks, and the same answer. `expecting`
            // is set by whatever is lowering the enclosing expression, which a
            // class field's initializer has none of: `#calls: TrackedCall[] =
            // []` and `this.#calls = []` were both refused as unrepresentable
            // while `const calls: TrackedCall[] = []` was not. Eighteen sites,
            // and `xs: T[] = []` is how a class declares a list.
            //
            // Last, so this can only decide what was previously refused.
            .or_else(|| self.contextual_type(id, 0))
            .ok_or_else(|| self.unrepresentable(id, "an array literal"))?;
        // `[a, b]` where the slot is a tuple. Written the same way as an array
        // and meaning something else: a fixed number of slots of their own
        // types, which is an object, so this builds one rather than an
        // allocation with a length.
        if let HirType::Managed(ManagedType::Object(type_id)) = ty.clone()
            && matches!(
                self.snapshot.types.get(type_id.0 as usize).map(|r| &r.kind),
                Some(TypeKind::Tuple(_))
            )
        {
            return self.lower_tuple_literal(id, type_id, &ty);
        }
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an array literal that is not an array"));
        }
        let origin = self.origin(id);
        let elements = self.children(id);

        // `[...xs]`, which is a copy of `xs` and nothing else -- fourteen of the
        // twenty-six spreads in `runtime/node` are exactly this shape, and a
        // copy is what `slice` already is.
        //
        // Only this shape. `[...a, ...b]` needs the lengths added before
        // anything is allocated and `[...a, x]` needs one more slot than the
        // spread has; both are a different lowering rather than a longer
        // version of this one, and are refused by name.
        if let [only] = elements.as_slice()
            && self.kind_of(*only) == Some(syntax::SPREAD_ELEMENT)
        {
            return self.lower_spread_copy(*only, &ty, &origin);
        }
        if elements
            .iter()
            .any(|element| self.kind_of(*element) == Some(syntax::SPREAD_ELEMENT))
        {
            return self.lower_mixed_literal(&elements, &ty, &origin);
        }

        #[allow(clippy::cast_precision_loss)]
        let count = elements.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                zeroed: true,
            },
            ty,
            origin.clone(),
        );

        for (index, element) in elements.iter().enumerate() {
            let value = self.lower_expression(*element)?;
            #[allow(clippy::cast_precision_loss)]
            let position = index as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: true,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// `[]`, with the element type supplied from outside.
    fn lower_empty_array(&mut self, id: NodeId, ty: HirType) -> Result<ValueId, Diagnostic> {
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an empty array literal that is not an array"));
        }
        let origin = self.origin(id);
        let length = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(self.push(
            OpKind::ArrayNew {
                length,
                zeroed: true,
            },
            ty,
            origin,
        ))
    }

    /// `{ x: 1, y }`.
    ///
    /// An allocation and a store per field. The fields are written in *layout*
    /// order rather than source order, so two literals of one type produce the
    /// same stores — which is what lets a later pass recognize them as the same
    /// shape.
    fn lower_object_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The *declared* type where there is one, not the literal's own.
        //
        // `const o: Options = {}` gives the literal type `{}`, which has no
        // fields -- so a later `o.limit` was refused as a property the type
        // does not declare, when `Options` declares it and the literal simply
        // omitted it. A literal may omit a property only when it is optional,
        // and an optional property is `T | undefined`, whose absent value is
        // the zero a fresh allocation already holds.
        //
        // Safe in the other direction too: a literal missing a *required*
        // property is a type error the checker reported before this ran.
        let ty = self
            .contextual_type(id, 0)
            .filter(|ty| matches!(ty, HirType::Managed(ManagedType::Object(_))))
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unrepresentable(id, "an object literal"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "an object literal that is not an object"));
        };
        let layout = self.layout_of(id, type_id)?;
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());

        // Source order, since an initializer may have effects and they happen
        // where the author wrote them. The *field index* is what puts them in
        // layout order.
        for property in self.children(id) {
            let (name, value) = self.property_parts(property)?;
            let Some(field) = layout.index_of(&name) else {
                return Err(self.unsupported(property, "a property the type does not declare"));
            };
            // At the field's type, like every other slot a value meets. An
            // optional field is erased -- its absence is a tag -- so a literal
            // that supplies one erases on the way in.
            let want = layout.fields[field as usize].ty.clone();
            let value = self.coerce(value, &want, property)?;
            self.push(
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(object)
    }

    /// The name and value of one property in an object literal.
    fn property_parts(&mut self, id: NodeId) -> Result<(String, ValueId), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name, initializer] = children.as_slice() else {
                    return Err(self.unsupported(id, "a property of unexpected shape"));
                };
                let text = self
                    .literal_name(*name)
                    .ok_or_else(|| self.unsupported(*name, "a computed property name"))?;
                let value = self.lower_expression(*initializer)?;
                Ok((text, value))
            }
            // `{ x }` — one node serving as both the field name and a reference
            // to a variable, and the checker gives it the *property's* symbol.
            // The variable's symbol is what `getShorthandAssignmentValueSymbol`
            // answers, which the snapshot does not carry yet; until it does, the
            // reference is resolved by name against what is in scope.
            //
            // That is sound only while the name is unambiguous, so a shadowed
            // one is refused rather than guessed at.
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name] = children.as_slice() else {
                    return Err(self.unsupported(id, "a shorthand property of unexpected shape"));
                };
                let text = self
                    .node(*name)
                    .text
                    .clone()
                    .ok_or_else(|| self.unsupported(*name, "a shorthand without a name"))?;

                let mut found = self.bindings.iter().filter(|(symbol, _)| {
                    self.snapshot
                        .symbols
                        .get(**symbol as usize)
                        .is_some_and(|record| record.name == text)
                });
                let value = match (found.next(), found.next()) {
                    (Some((_, value)), None) => *value,
                    (Some(_), Some(_)) => {
                        return Err(
                            self.unsupported(*name, "a shorthand naming a shadowed binding")
                        );
                    }
                    _ => return Err(self.unsupported(*name, "a shorthand naming nothing in scope")),
                };
                Ok((text, value))
            }
            // Named, for the reason the statement dispatch is: a spread, an
            // accessor and a method are three features, and one message over
            // all of them ranks none.
            _ => {
                let what = self
                    .kind_of(id)
                    .and_then(nts_semantic_schema::syntax::name_of)
                    .map_or_else(
                        || "this kind of property".to_owned(),
                        |name| format!("a `{name}` in an object literal"),
                    );
                Err(self.unsupported(id, &what))
            }
        }
    }
    /// The layout of a class this compiler provides, if `ty` names one.
    fn provided_layout(&mut self, ty: TypeId) -> Option<Layout> {
        let name = named(self.snapshot, ty)
            .filter(|name| super::builtin::is_error(name))?
            .to_owned();
        // `TypeError extends Error`, which the compiler knows and used to
        // discard. The hierarchy has never heard of these four -- they are not
        // declarations in this program -- so `Hierarchy::base` has nothing, and
        // this is where the relation is spelled instead. `lower_instanceof`
        // already spells the same one for the same reason, through
        // `provided_errors_under`.
        //
        // The comment here used to say a base would be *worse* than none:
        // all four would carry `Error`, merge on identical fields, methods and
        // base, and reproduce the defect 0074 names. That was true when it was
        // written and is not now -- `collect_layouts` grew a nominal guard for
        // exactly this family, and two differently-named error layouts do not
        // merge whatever their shape says. The reason outlived the condition it
        // described, which is the third stale comment found this week.
        //
        // Only the JVM can see the difference: an upcast is a pointer here and
        // a nominal relation checked at class load there, so `examples/
        // exceptions` emitted `nts/gen/TypeError` extending `Object` and would
        // not verify.
        let base = (name != "Error").then(|| self.type_named("Error")).flatten();
        let layout = Layout {
            types: vec![ty],
            name,
            fields: super::builtin::error_fields(),
            methods: vec![None; self.hierarchy.table_size()],
            base,
        };
        self.layouts.push(layout.clone());
        Some(layout)
    }

    /// The function an accessor of `member` on `ty` is emitted as.
    ///
    /// `Owner#get x`, where the owner is the class that *declares* it — which
    /// may be a base, exactly as for a method. `None` where the type has no
    /// such accessor, which is the ordinary case and means the caller should go
    /// on to say the property does not exist.
    fn accessor_callee(&self, ty: TypeId, member: &str, kind: &str) -> Option<String> {
        let key = format!("{kind}{member}");
        let declaring = self.hierarchy.declaring(ty, &key)?;
        let owner = self.hierarchy.name.get(&declaring)?;
        Some(format!("{owner}#{key}"))
    }

    /// Why a property is not on a layout.
    ///
    /// Usually because the type does not have it. On an error it can instead be
    /// a member of the *declared* `Error` that this compiler chose not to
    /// provide, and saying which is the difference between "you misspelled it"
    /// and "a compiled binary keeps no record of the frames it came through".
    fn absent_member(&self, id: NodeId, ty: TypeId, member: &str) -> Diagnostic {
        let on_an_error = named(self.snapshot, ty).is_some_and(super::builtin::is_error)
            || self.provided_error_base(ty).is_some();
        match super::builtin::omitted(member).filter(|_| on_an_error) {
            Some(reason) => self.unsupported(
                id,
                &format!("`{member}`, which this compiler's `Error` does not have — {reason}"),
            ),
            // Named, and named with the type it was looked for on. It is the
            // largest refusal in the node profile, and as `a property the type
            // does not declare` it was one bucket holding every cause at once:
            // a member of a library type this compiler does not model, a
            // property of a type whose decomposition stopped short, and an
            // actual absence all read the same. A refusal nobody can group by
            // is a refusal nobody can rank.
            None => self.unsupported(
                id,
                &format!(
                    "`{member}`, which `{}` does not declare",
                    named(self.snapshot, ty)
                        .map_or_else(|| "an anonymous type".to_owned(), ToOwned::to_owned)
                ),
            ),
        }
    }

    /// `Error`'s constructor, inline.
    ///
    /// This compiler provides the class, so there is no function to call and
    /// nothing to link against: the two field stores *are* the constructor.
    /// Both sites that would otherwise call one come here — `new Error(m)`,
    /// which has no constructor to find, and `super(m)` in a subclass, whose
    /// base declares none. Without this the `super(m)` was a *no-op*: the base
    /// is not in the hierarchy, so the call resolved to nothing and the message
    /// was never stored. That is the silent kind of wrong.
    ///
    /// `name` is the provided class's own name rather than the subclass's,
    /// which is what JavaScript does — `Error.prototype.name` is inherited, so
    /// `new MyError("x").name` is `"Error"` until a constructor assigns it.
    fn initialize_error(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        provided: &str,
        arguments: &[NodeId],
    ) -> Result<(), Diagnostic> {
        // `new Error(message, { cause })`. The second argument is an options
        // object whose only member is `cause`, which this compiler does not
        // provide -- see `super::builtin`.
        if arguments.len() > 1 {
            return Err(self.unsupported(id, "an `Error` with options"));
        }
        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[receiver.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "an `Error` that is not an object"));
        };
        let layout = self.layout_of(id, type_id)?;
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        let message = match arguments.first() {
            Some(argument) => self.lower_expression(*argument)?,
            // `new Error()` has an empty message, not an absent one.
            None => self.push(
                OpKind::ConstString(String::new()),
                text.clone(),
                origin.clone(),
            ),
        };
        let name = self.push(
            OpKind::ConstString(provided.to_owned()),
            text,
            origin.clone(),
        );
        for (field, value) in [("message", message), ("name", name)] {
            let Some(field) = layout.index_of(field) else {
                continue;
            };
            self.push(
                OpKind::FieldSet {
                    object: receiver,
                    field,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(())
    }

    /// The provided error class this type descends from, if any.
    ///
    /// Transitive, because the chains are: `ERR_INVALID_ARG_TYPE` extends
    /// `NodeTypeError` extends `TypeError`, and only the last of those is
    /// provided here.
    fn provided_error_base(&self, ty: TypeId) -> Option<String> {
        let mut stack = vec![(ty, 0u32)];
        while let Some((at, depth)) = stack.pop() {
            // A type that reaches itself through its bases is not a hierarchy.
            if depth > 32 {
                continue;
            }
            if at != ty
                && let Some(name) = named(self.snapshot, at)
                && super::builtin::is_error(name)
            {
                return Some(name.to_owned());
            }
            for base in self.snapshot.base_types.get(&at).into_iter().flatten() {
                stack.push((*base, depth + 1));
            }
        }
        None
    }

    /// Every base in the chain has to be a type this compiler lays out itself.
    ///
    /// The checker's property list is *flattened*: a class that extends
    /// something built in arrives here looking like a plain object, with the
    /// inherited members all present and nothing in the list saying they came
    /// from a base whose storage this compiler does not model.
    ///
    /// `class Bytes extends Uint8Array {}` laid out as five `int32_t` and no
    /// bytes, and `b.length` compiled to a read of the fifth field of a struct
    /// nothing ever allocates. Accepted, compiled, and wrong — while
    /// `Uint8Array` used *directly* was refused, which is the shape of the bug:
    /// the subclass was representable because nothing looked at what it derived
    /// from.
    ///
    /// The test is that each base is laid out as an object here. That is
    /// stronger than being representable — `class S extends String` would pass
    /// the weaker test and inherit a layout it has no storage for — and it is
    /// checked through the whole chain, because a class two steps below a
    /// built-in has the same hole as one directly below it.
    fn representable_bases(&self, id: NodeId, ty: TypeId, depth: u32) -> Result<(), Diagnostic> {
        // A type that reaches itself through its bases is not a hierarchy, and
        // recursing on one would not stop.
        if depth > 32 {
            return Ok(());
        }
        for base in self.snapshot.base_types.get(&ty).into_iter().flatten() {
            if !matches!(
                self.represent(*base),
                Some(HirType::Managed(ManagedType::Object(_)))
            ) {
                let named = self
                    .snapshot
                    .types
                    .get(base.0 as usize)
                    .and_then(|record| record.symbol)
                    .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                    .map_or_else(|| format!("#{}", base.0), |symbol| symbol.name.clone());
                return Err(self.unrepresentable_member(id, "a base", &named, *base));
            }
            self.representable_bases(id, *base, depth + 1)?;
        }
        Ok(())
    }

    /// The fields of a class, from the checker's flattened property list.
    ///
    /// A method is a member of the type but not a field of the object: it has
    /// no storage, because the checker resolved every call site, so it is a
    /// function the call names directly rather than a slot to load from. This
    /// is where a vtable would go if dispatch needed one.
    fn fields_of(
        &mut self,
        id: NodeId,
        ty: TypeId,
        properties: &[nts_semantic_schema::PropertyRecord],
    ) -> Result<Vec<Field>, Diagnostic> {
        // A class descending from a provided one takes *that* class's fields
        // rather than the checker's flattened view of them, because the view
        // includes members this compiler does not provide -- `stack?` and
        // `cause?` are in the list and are not fields here. What the class
        // declares itself is marked `own`, which is exactly the remainder.
        let provided = self.provided_error_base(ty);
        let mut fields = if provided.is_some() {
            super::builtin::error_fields()
        } else {
            Vec::new()
        };
        for property in properties {
            if provided.is_some() && !property.own {
                continue;
            }

            // Only a field is laid out. An accessor looks like a property and
            // *is* a call -- `o.x` where `x` is a getter runs code -- and a
            // method is a call the dispatch table holds.
            //
            // What used to stand here skipped every property whose *type* was a
            // function type, which is a method and a function-valued field
            // together, because the type cannot tell them apart. Dropping the
            // field silently was worse than refusing it: the member the program
            // wrote was not in the layout, so reading it answered "`twice`,
            // which `Ops` does not declare" -- a message about the type, for a
            // field this compiler had removed.
            if !property.kind.is_stored() {
                continue;
            }
            // A reference field is a pointer. Under NoGC nothing is ever freed,
            // so it costs neither a write barrier nor a trace; which fields are
            // references is recorded on the layout for the collector that comes
            // later, because that is a fact about the layout and the layout is
            // decided here.
            let field_ty = self.represent(property.ty).ok_or_else(|| {
                self.unrepresentable_member(id, "a property", &property.name, property.ty)
            })?;
            // A field of object type needs that object's *layout*, not only its
            // representation: the struct has to name a member of it, and the
            // descriptor beside it takes an `offsetof` into it.
            //
            // Without this the emitter silently dropped the member -- it skips
            // a field whose C type it cannot compute -- and left the descriptor
            // naming one that was not there. Five corpus files emitted a
            // `struct { NtsHeader header; }` that way, and the two which
            // happened to be *read* were the two the ratchet had been counting.
            //
            // Confined to a *tuple* field, which is the shape this commit
            // introduced. Asking it of every object field is the honest rule
            // and costs 40 functions in the node profile -- a field whose type
            // has no layout but which nothing ever reads still emits and still
            // runs -- so the wider fix is its own decision, with the silent
            // drop in the emitter as its other half.
            //
            // A *function* type is asked for too, and safely: `layout_of`
            // constructs one for it rather than deriving it -- a signature has
            // no fields, because two closures of one type differ by what they
            // captured -- so the call cannot refuse anything. It is the general
            // rule for exactly the case where the general rule is free.
            if let HirType::Managed(ManagedType::Object(inner)) = &field_ty
                && *inner != ty
                && (self.is_tuple(*inner) || self.is_a_signature(*inner))
            {
                self.layout_of(id, *inner)?;
            }
            // An optional field's absence has to live somewhere, and a tag is
            // where. This used to be refused outright -- "an optional field
            // needs a presence bit, which changes the layout rather than adding
            // to it" -- and the tag *is* that presence bit, now that there is
            // one.
            //
            // The property's own type is `T` rather than `T | undefined`: the
            // checker records optionality beside the type instead of in it, so
            // the union has to be reconstructed here. A fresh allocation is
            // zeroed and zero is the `undefined` tag, which is what makes an
            // omitted property already correct.
            let field_ty = if property.optional && field_ty != HirType::Erased {
                HirType::Erased
            } else {
                field_ty
            };
            fields.push(Field {
                name: property.name.clone(),
                ty: field_ty,
                readonly: property.readonly,
            });
        }
        Ok(fields)
    }

    /// `[a, b]` where the slot is a tuple.
    ///
    /// One allocation and one store per slot, which is what building an object
    /// of that shape is. The element count has to match exactly: a tuple's
    /// length is part of its type, so a literal that is short or long is not
    /// the same tuple and saying so beats writing whatever fits.
    fn lower_tuple_literal(
        &mut self,
        id: NodeId,
        type_id: TypeId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let layout = self.layout_of(id, type_id)?;
        let elements = self.children(id);
        if elements.len() != layout.fields.len() {
            return Err(self.unsupported(
                id,
                &format!(
                    "a tuple literal of {} element(s) where the type has {}",
                    elements.len(),
                    layout.fields.len()
                ),
            ));
        }
        let origin = self.origin(id);
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );
        for (at, element) in elements.into_iter().enumerate() {
            let want = layout.fields[at].ty.clone();
            let value = self.lower_expression(element)?;
            let stored = self.coerce(value, &want, element)?;
            let field = u32::try_from(at).unwrap_or(0);
            self.push(
                OpKind::FieldSet {
                    object,
                    field,
                    value: stored,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(object)
    }

    /// The class a polymorphic `this` stands for, or the type unchanged.
    ///
    /// TypeScript models `this` as a type parameter named after its class and
    /// constrained to it. Anything keyed by the *class* -- the method
    /// hierarchy, a layout -- has to be asked about the class rather than about
    /// the parameter, and this is the one place that unwrapping is spelled.
    ///
    /// A genuine type parameter passes through untouched: `<T extends Buffer>`
    /// is named `T`, and this is named `Buffer`.
    fn class_behind(&self, ty: TypeId) -> TypeId {
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return ty;
        };
        match &record.kind {
            TypeKind::TypeParameter {
                name,
                constraint: Some(constraint),
            } if named(self.snapshot, *constraint) == Some(name.as_str()) => *constraint,
            _ => ty,
        }
    }

    /// Whether a type is a tuple, asked of the snapshot rather than of a name.
    ///
    /// The first version tested `layout.name.starts_with("Tuple")`, which is a
    /// string standing in for a fact the snapshot already holds -- and which a
    /// class the program happened to call `TupleRow` would have answered yes
    /// to.
    fn is_tuple(&self, ty: TypeId) -> bool {
        matches!(
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Tuple(_))
        )
    }

    /// The layout of a heterogeneous tuple: one field per position.
    ///
    /// `[string, number]` *is* a two-field struct, and saying so gives it the
    /// layout machinery, field access, escape analysis and reference counting
    /// rather than a second mechanism that would need all four again. A tuple
    /// whose elements agree never reaches here -- `representation_of` makes it
    /// an array, which is the older and better answer for that case.
    fn tuple_layout(
        &mut self,
        id: NodeId,
        ty: TypeId,
        elements: &[TypeId],
    ) -> Result<Layout, Diagnostic> {
        let mut fields = Vec::with_capacity(elements.len());
        for (at, element) in elements.iter().enumerate() {
            let Some(field) = self.represent(*element) else {
                return Err(self.unrepresentable(id, &format!("element {at} of a tuple")));
            };
            // An element of object type needs that object's *layout*, not only
            // its representation: the tuple's struct has to name a member of
            // it. Asked for here, where the failure is still this tuple's, so
            // it is refused rather than emitted as a struct whose member the
            // backend cannot spell.
            //
            // The emitter drops a field it cannot type, silently, and the
            // descriptor beside it keeps the `offsetof` -- so without this the
            // corpus gained a file whose `struct { NtsHeader header; }` sat
            // next to a descriptor naming a member it did not have. That
            // silent drop is its own bug and its own commit.
            if let HirType::Managed(ManagedType::Object(inner)) = &field
                && *inner != ty
            {
                self.layout_of(id, *inner)?;
            }
            fields.push(Field {
                // `_0`, not `0`: the name reaches C as a struct member and
                // `v->1` is not C. Every lookup is by position anyway -- a
                // tuple has no names of its own -- so the spelling is free to
                // be whatever the backend can pronounce.
                name: format!("_{at}"),
                ty: field,
                // Writable: `const pair: [number, number] = [1, 2]; pair[0] = 5`
                // is legal TypeScript, and only `readonly [number, number]` is
                // not. Marking these `readonly` refused a program the checker
                // accepts.
                readonly: false,
            });
        }
        let layout = Layout {
            types: vec![ty],
            name: format!("Tuple{}", ty.0),
            fields,
            methods: Vec::new(),
            // A tuple has no declaration to extend.
            base: None,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// Whether a type is a call signature rather than something with fields.
    fn is_a_signature(&self, ty: TypeId) -> bool {
        self.snapshot
            .types
            .get(ty.0 as usize)
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
    }

    fn layout_of(&mut self, id: NodeId, ty: TypeId) -> Result<Layout, Diagnostic> {
        if let Some(known) = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
        {
            return Ok(known.clone());
        }
        let record =
            self.snapshot.types.get(ty.0 as usize).ok_or_else(|| {
                self.unsupported(id, "an object type that is not in the snapshot")
            })?;
        // A function type has no fields: two closures of one type differ by what
        // they captured, and that is their own class's business.
        if matches!(record.kind, TypeKind::Function(_)) {
            let layout = Layout {
                types: vec![ty],
                name: signature_name(self.snapshot, ty),
                fields: Vec::new(),
                methods: Vec::new(),
                // A function type is a signature, not a class.
                base: None,
            };
            self.layouts.push(layout.clone());
            return Ok(layout);
        }
        // A tuple is a fixed-length heterogeneous sequence, which is what an
        // object with positional fields already is. Naming the fields `0`, `1`
        // is not a trick to make it fit: `[string, number]` *is* a two-field
        // struct, and saying so gives it the layout machinery, field access,
        // escape analysis and reference counting rather than a second mechanism
        // that would need all four again.
        //
        // Not an array, which is the other tempting answer: an array has one
        // element type and a length the compiler does not fix, and a tuple has
        // neither.
        if let TypeKind::Tuple(elements) = &record.kind {
            let elements = elements.clone();
            return self.tuple_layout(id, ty, &elements);
        }
        // A class this compiler provides rather than decomposes. It never
        // reaches the arm below, because it is never an `Object`: `Error`
        // arrives as a structured type and stays one.
        if let Some(layout) = self.provided_layout(ty) {
            return Ok(layout);
        }
        let TypeKind::Object { properties } = &record.kind else {
            return Err(self.unsupported(id, "an object type that was not decomposed"));
        };
        // Cloned so the borrow of the snapshot ends here: `fields_of` builds
        // the layouts of the object types its fields hold, which needs `&mut`.
        // Once per type, and a layout is built once.
        let properties = properties.clone();
        self.representable_bases(id, ty, 0)?;

        let mut fields = self.fields_of(id, ty, &properties)?;

        // What this type extends, where the program declares it. Needed twice
        // below: once to order the fields base-first, and once so that two types
        // differing only in their base do not merge -- `class B extends A {}`
        // adding nothing is the case, and it merged into `A` until this.
        let base = self.hierarchy.base.get(&ty).copied();

        // Base first, so a derived object's fields start with exactly the base's
        // and a pointer to one is a pointer to the other. That is what makes an
        // upcast free: `Square#area` and `Shape#doubled` read the same offsets
        // for the fields they share, so passing a `Square*` where a `Shape*` is
        // expected needs no work at all.
        //
        // The checker's property list is flattened -- it already contains the
        // inherited members with nothing to say where they came from -- so the
        // order has to be recovered from the base rather than read off.
        //
        // From the base's *layout*, which is the authoritative answer and cannot
        // disagree with itself. Re-deriving it from the base type's properties
        // is what this did before, and it silently produced nothing whenever the
        // base's type record was not the `Object` kind -- which is every
        // `abstract class` in `runtime/node`'s error hierarchy. The order then
        // fell back to the checker's, which puts a class's *own* declarations
        // first, so `ERR_INVALID_ARG_TYPE` laid out `["code", "name",
        // "message"]` against its base's `["message", "name", "code"]`.
        //
        // Same fields, different order, and every backend's upcast is a pointer
        // cast that assumes otherwise. Nothing caught it because nothing
        // asserted base-first layout until `Layout.base` gave `verify` something
        // to assert it against; the check found this on its first run.
        // Taken *from* the base's layout rather than sorted towards it, which
        // fixes a second thing at the same time. A field whose type has exactly
        // one value needs no storage and is elided -- `override readonly code =
        // "ERR_INVALID_ARG_TYPE"` is a string literal type -- so a derived class
        // could drop a slot its base keeps. `ERR_INVALID_ARG_TYPE_FUNCTION` laid
        // out `["message", "name"]` under a base laid out `["message", "name",
        // "code"]`, and an upcast would have read past the end of it.
        //
        // Whatever the base stores, the derived stores, at the same offsets, in
        // the same order. Then its own additions. That is base-first layout
        // stated as a construction instead of hoped for as a sort.
        if let Some(base) = base {
            let inherited = self.layout_of(id, base)?.fields;
            let mut ordered = inherited;
            for field in fields {
                if !ordered.iter().any(|kept| kept.name == field.name) {
                    ordered.push(field);
                }
            }
            fields = ordered;
        }

        // The declared name where there is one. An anonymous object type —
        // `{ x: number }` written inline — has no symbol, so it is named after
        // its type id, which is at least stable and unique.
        let name = record
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| format!("Type{}", ty.0), |symbol| symbol.name.clone());
        // `Vector<Body>` and `Vector<double>` share the declaring symbol and so
        // share this name, and they are different classes with different field
        // widths. The type id tells them apart, and `<>` cannot appear in a
        // TypeScript identifier so the qualified name cannot collide with a
        // plain one. `nts types` is what reads the number back.
        let name = format!("{name}{}", instantiation_suffix(self.snapshot, ty));
        // What this class does for each dispatch slot. Empty where nothing in
        // the hierarchy is overridden, which is most classes.
        let mut methods = vec![None; self.hierarchy.table_size()];
        for ((root, member), slot) in &self.hierarchy.slots {
            if !self.hierarchy.descends_from(ty, *root) {
                continue;
            }
            let Some(owner) = self.hierarchy.declaring(ty, member) else {
                continue;
            };
            if let Some(name) = self.hierarchy.name.get(&owner) {
                methods[*slot as usize] = Some(format!("{name}#{member}"));
            }
        }

        // Structural, so a type whose shape is already laid out joins that
        // layout rather than getting one of its own. The first name wins, which
        // is usually the declared one -- an anonymous literal type tends to be
        // discovered second.
        if let Some(existing) = self
            .layouts
            .iter_mut()
            .find(|layout| layout.same_shape(&fields, &methods, base))
        {
            existing.types.push(ty);
            // A declared name beats a generated one, whichever was seen first.
            // The anonymous type of a literal is usually discovered before the
            // interface it is assigned to, and `NtsObj_Point` reads better than
            // `NtsObj_Type5`.
            if existing.name.starts_with("Type") && !name.starts_with("Type") {
                existing.name = name;
            }
            return Ok(existing.clone());
        }

        let layout = Layout {
            types: vec![ty],
            name,
            fields,
            methods,
            base,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// `(x) => x * n` — allocate the closure and write what it captured.
    ///
    /// The same two operations `new C(...)` lowers to, for the same reason: an
    /// allocation and the stores that fill it. Everything after this treats the
    /// result as the object it is, so a closure that does not outlive the call
    /// ends up in the frame and one that does gets a reference count.
    fn lower_arrow(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let index = self
            .closures
            .iter()
            .position(|closure| closure.node == id)
            .ok_or_else(|| self.unsupported(id, "an arrow function the collector did not see"))?;
        let info = self.closures[index].clone();
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(id, reason));
        }

        self.used_closures.push(index);

        let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());

        let mut fields = Vec::new();
        for (at, capture) in info.captures.iter().enumerate() {
            // The value the enclosing scope holds. It is in `bindings` because
            // the collector only allowed a capture of something declared
            // outside the arrow and never assigned -- so by the time the arrow
            // is reached, the binding exists and is final.
            // `this` is not in `bindings` and never was: it is the enclosing
            // function's receiver, which is exactly what an arrow inherits.
            if capture.symbol == THIS_CAPTURE {
                let value = self
                    .this
                    .ok_or_else(|| self.unsupported(capture.at, "`this` outside a method"))?;
                let field_ty = self.values[value.0 as usize].ty.clone();
                self.push(
                    OpKind::FieldSet {
                        object,
                        field: u32::try_from(at).unwrap_or(0),
                        value,
                    },
                    HirType::Void,
                    origin.clone(),
                );
                // The layout this side builds has to have the same fields in
                // the same order as the one the body builds, or every index
                // after this one is off by a field.
                fields.push(Field {
                    name: capture.name.clone(),
                    ty: field_ty,
                    readonly: true,
                });
                continue;
            }
            if !self.bindings.contains_key(&capture.symbol) {
                self.open_cell_early(capture.symbol, capture.at);
            }
            let value = *self.bindings.get(&capture.symbol).ok_or_else(|| {
                // Every name that is reached *by* name -- a function, a class,
                // an import, a type, anything at module scope -- is excluded
                // from captures before this. So a miss here is a local that has
                // no value at the point the closure is built, which in practice
                // means the closure was written above the declaration:
                //
                //     const onListening = () => { ...cleanup... };
                //     const cleanup = ...;
                //
                // Legal, because the body runs later. Capturing it here would
                // capture nothing, so it is refused rather than answered.
                self.unsupported(
                    capture.at,
                    &format!(
                        "`{}`, captured above its own declaration, where it has \
                         no value yet",
                        capture.name
                    ),
                )
            })?;
            let field_ty = self.values[value.0 as usize].ty.clone();
            self.push(
                OpKind::FieldSet {
                    object,
                    field: u32::try_from(at).unwrap_or(0),
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
            fields.push(Field {
                name: capture.name.clone(),
                ty: field_ty,
                readonly: true,
            });
        }
        // The same layout the body's side builds. Both are pushed, and
        // `collect_layouts` merges them -- which is also the check that the two
        // sides agree, because a disagreement would be two layouts for one type
        // rather than one.
        self.layouts.push(self.closure_layout(index, fields));
        Ok(object)
    }

    /// `new C(a, b)` — allocate, then run the constructor over it.
    ///
    /// The allocation is the value. The constructor writes through the pointer
    /// it is handed and returns nothing, so `new` is an allocation and a call
    /// rather than an allocation, a call, and a pointer round-trip that every
    /// stage downstream has to prove is the identity.
    /// The children of a call or `new` that are *arguments*.
    ///
    /// Explicit type arguments are flattened in among them --
    /// `new Box<number>(xs)` arrives as `[Box, number, xs]` -- so they are
    /// dropped by asking the same question tsgo asks. Nothing structural
    /// distinguishes them: a list is not a node here.
    fn arguments_of(&self, id: NodeId) -> Vec<NodeId> {
        self.children(id)
            .into_iter()
            .skip(1)
            .filter(|child| !syntax::is_type_node(self.kind_of(*child).unwrap_or(0)))
            // `f?.(x)` puts the `?.` among the children the way `f<T>(x)` puts
            // its type argument there. Both are punctuation and neither is an
            // argument; lowering this one reported "a question dot token is not
            // supported", which is true and says nothing.
            .filter(|child| self.kind_of(*child) != Some(syntax::QUESTION_DOT_TOKEN))
            .collect()
    }

    /// The field initializers a construction runs.
    ///
    /// `class Counter { value: number = 5 }` has no constructor, and the
    /// allocation is zeroed -- so `new Counter().value` read `0`. Silently: a
    /// zeroed field and an initialized one are the same bytes whenever the
    /// initializer happens to be the zero value, which is why the only field
    /// initializer in the whole example corpus (`code: string = ""`) never
    /// disagreed with node and this survived.
    ///
    /// Base first, because a derived class's initializer may overwrite an
    /// inherited field and the source order says which wins.
    ///
    /// # Where this is not yet node's order
    ///
    /// Node runs a derived class's initializers *after* `super()` returns.
    /// These run before the constructor is entered at all, so a base
    /// constructor that calls an overridden method which reads a derived field
    /// sees the initialized value where node sees `undefined`. That is a real
    /// difference and a narrow one; the shape it needs is a base constructor
    /// calling a virtual method, which this compiler does not lower yet.
    fn initialize_fields(
        &mut self,
        at: NodeId,
        object: ValueId,
        type_id: TypeId,
    ) -> Result<(), Diagnostic> {
        let mut chain = vec![type_id];
        let mut ty = type_id;
        while let Some(base) = self.snapshot.base_types.get(&ty).and_then(|b| b.first()) {
            if chain.contains(base) {
                break;
            }
            chain.push(*base);
            ty = *base;
        }
        chain.reverse();

        let layout = self.layout_of(at, type_id)?;
        for class in chain {
            let Some(declaration) = self
                .snapshot
                .types
                .get(class.0 as usize)
                .and_then(|record| record.symbol)
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .and_then(|record| record.declarations.first().copied())
            else {
                continue;
            };
            for member in self.children(declaration) {
                if self.kind_of(member) != Some(syntax::PROPERTY_DECLARATION) {
                    continue;
                }
                // Slots rather than positions: a property declaration is
                // `modifiers, name, ?/!, type, initializer`, and which of them
                // are present is recorded in the node's `present` bitmask. A
                // first version took the *last* child and checked it had a
                // type, which matched the type annotation of `name: number;`
                // and lowered `number` as an expression -- six functions in
                // `examples/inheritance` vanished, and the refusal landed in
                // the anonymous bucket that had just been emptied.
                let Some([_, Some(name), _, _, initializer]) = self.child_slots::<5>(member) else {
                    continue;
                };
                let Some(initializer) = initializer else {
                    continue;
                };
                let Some(text) = self.node(name).text.clone() else {
                    continue;
                };
                let Some(field) = layout.index_of(&text) else {
                    continue;
                };
                let value = self.lower_expression(initializer)?;
                let want = layout.fields[field as usize].ty.clone();
                let value = self.coerce(value, &want, initializer)?;
                let origin = self.origin(initializer);
                self.push(
                    OpKind::FieldSet {
                        object,
                        field,
                        value,
                    },
                    HirType::Void,
                    origin,
                );
            }
        }
        Ok(())
    }

    fn lower_new(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let callee = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a `new` with no callee"))?;
        let class = self
            .node(callee)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(callee, "a computed constructor"))?;

        // `new Array(n)` is an allocation with a length, which is what
        // `ArrayNew` already is. It is worth taking rather than asking authors
        // to write `[]` and push: an array made at its final size allocates
        // once, and a benchmark that pre-sizes its array is measuring that.
        //
        // The type comes from where the result goes, because the constructor's
        // own type is a union of the overloads in `lib.d.ts` and says nothing
        // about the element.
        // `new Uint8Array(n)` is the same allocation with the element width
        // written down instead of inferred.
        // Or a class whose instances *are* an array: one that extends a typed
        // array and adds no storage of its own. `new Buffer(n)` is
        // `new Uint8Array(n)` with a different name on it, and asking the
        // representation rather than the name is what makes that true without
        // keeping a list of subclasses.
        //
        // A subclass that declares a constructor is not this: taking the
        // allocation here would skip it silently, so it falls through to the
        // object path and is refused there.
        let is_an_array = matches!(
            self.type_of(id),
            Some(HirType::Managed(ManagedType::Array(_)))
        ) && self
            .snapshot
            .node_types
            .get(&id)
            .is_none_or(|constructed| self.hierarchy.constructor(*constructed).is_none());
        if class == "Array" || super::builtin::typed_array_element(&class).is_some() || is_an_array
        {
            let ty = self
                .type_of(id)
                .filter(|ty| matches!(ty, HirType::Managed(ManagedType::Array(_))))
                .or_else(|| self.contextual_type(id, 0))
                .ok_or_else(|| self.unrepresentable(id, "a `new Array`"))?;
            if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
                return Err(self.unsupported(id, "a `new Array` that is not an array"));
            }
            let origin = self.origin(id);
            let arguments = self.arguments_of(id);
            let Some(count) = arguments.first() else {
                return self.lower_empty_array(id, ty);
            };
            let length = self.lower_expression(*count)?;
            // `new Uint8Array([1, 2, 3])` and `new Uint8Array(other)` copy from
            // what they are given rather than sizing to it. Refused, because
            // taking the argument as a length would allocate an array of
            // whatever the pointer happened to be.
            if !matches!(
                self.values[length.0 as usize].ty,
                HirType::Int { .. } | HirType::Float { .. }
            ) {
                return Err(self.unsupported(id, &format!("a `new {class}` from a value")));
            }
            return Ok(self.push(
                OpKind::ArrayNew {
                    length,
                    zeroed: true,
                },
                ty,
                origin,
            ));
        }

        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `new`"))?;

        // The three the runtime builds rather than the program: a class's `new`
        // is a call to its constructor, and none of these has one.
        if let Some(built) = self.lower_new_provided(id, &ty) {
            return built;
        }

        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "a `new` that does not produce an object"));
        };
        // Laying the class out here is what makes its fields addressable; the
        // constructor is about to write every one of them.
        self.layout_of(id, type_id)?;

        let origin = self.origin(id);
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );

        // Field initializers, before any constructor runs, so a constructor
        // that assigns the same field wins -- which is what source order says.
        self.initialize_fields(id, object, type_id)?;

        // The nearest declared constructor, which may be a base's: a class
        // that declares none has an implicit one that forwards, and forwarding
        // to it directly is the same call with one frame fewer. A class with no
        // constructor anywhere in its chain has only its field initializers to
        // run, which the line above emitted.
        let arguments = self.arguments_of(id);
        let Some(declaring) = self.hierarchy.constructor(type_id) else {
            // A provided error class, or one descending from one and declaring
            // no constructor of its own. There is no function to call: this
            // compiler is the constructor, and it is emitted inline.
            let provided = named(self.snapshot, type_id)
                .filter(|name| super::builtin::is_error(name))
                .map(str::to_owned)
                .or_else(|| self.provided_error_base(type_id));
            if let Some(provided) = provided {
                self.initialize_error(id, object, &provided, &arguments)?;
                return Ok(object);
            }
            if !arguments.is_empty() {
                return Err(self.unsupported(id, "a `new` with arguments and no constructor"));
            }
            return Ok(object);
        };
        let owner = self
            .hierarchy
            .name
            .get(&declaring)
            .cloned()
            .unwrap_or(class);

        let mut args = vec![object];
        args.extend(self.lower_arguments(id, &arguments)?);
        self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{owner}#constructor")),
                args,
                frame: None,
            },
            HirType::Void,
            origin,
        );
        Ok(object)
    }

    /// `new Map`, `new Set` and `new Promise`, which the runtime builds.
    ///
    /// `None` when the type is a class, whose `new` is a call to a constructor
    /// the program declares.
    fn lower_new_provided(
        &mut self,
        id: NodeId,
        ty: &HirType,
    ) -> Option<Result<ValueId, Diagnostic>> {
        match ty {
            HirType::Managed(ManagedType::Map(key, _) | ManagedType::Set(key)) => {
                let key = key.as_ref().clone();
                Some(self.lower_new_table(id, ty, &key))
            }
            HirType::Managed(ManagedType::Promise(payload)) => {
                let payload = payload.as_ref().clone();
                Some(self.lower_new_promise(id, ty, &payload))
            }
            _ => None,
        }
    }

    /// `new Promise<T>(executor)`.
    ///
    /// # The executor is not a function here
    ///
    /// `new Promise(f)` calls `f` *synchronously*, before the constructor
    /// returns. So when `f` is written at the call -- which is how essentially
    /// every one of them is written -- its body belongs at the construction
    /// site, and `resolve` and `reject` are not values that have to exist. A
    /// call to `resolve` is the settle it stands for, which is the same helper
    /// an `async` function's `return` emits.
    ///
    /// That is the whole reason this needs no closure over the promise, which
    /// is what made the feature look hard. The promise is a local, `resolve(v)`
    /// is `nts_promise_fulfill_*(p, v)`, and nothing is captured by anything.
    ///
    /// The same shape, and the same refusal, as an array method whose callback
    /// is not an arrow written at the call: an executor that arrives as a name
    /// is a genuine indirect call, and answering it needs a real closure over
    /// the promise rather than a harder version of this.
    fn lower_new_promise(
        &mut self,
        id: NodeId,
        ty: &HirType,
        payload: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let [executor] = arguments.as_slice() else {
            return Err(self.unsupported(id, "a `new Promise` with more than an executor"));
        };
        let executor = *executor;
        if self.kind_of(executor) != Some(syntax::ARROW_FUNCTION) {
            return Err(self.unsupported(
                id,
                "a `new Promise` whose executor is not an arrow written at the call",
            ));
        }
        let names = self.callback_parameters(executor, "Promise")?;
        if names.len() > 2 {
            return Err(self.unsupported(executor, "a `new Promise` executor of this shape"));
        }
        let Some(&body) = self.children(executor).last() else {
            return Err(self.unsupported(executor, "a `new Promise` executor with no body"));
        };

        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty.clone(), origin);
        let result = AsyncResult {
            promise,
            payload: payload.clone(),
        };

        // Saved and restored rather than inserted and removed: an executor
        // nested inside another one rebinds the same names, and the outer
        // meanings have to come back when it ends.
        let outer = self.settlers.clone();
        for (at, symbol) in names.into_iter().enumerate() {
            self.settlers.insert(
                symbol,
                Settler {
                    result: result.clone(),
                    rejects: at == 1,
                },
            );
        }
        // A concise body is an expression whose value the executor discards --
        // `new Promise(r => r(n))` is the shortest spelling there is.
        let lowered = if self.kind_of(body) == Some(syntax::BLOCK) {
            self.lower_statement(body)
        } else {
            self.lower_expression(body).map(|_| ())
        };
        self.settlers = outer;
        lowered?;

        Ok(promise)
    }

    /// `resolve(v)` or `reject(e)` inside a `new Promise` executor.
    ///
    /// `None` when this call is an ordinary one, which is every call in a
    /// program that is not inside an executor.
    fn lower_settler_call(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        if self.settlers.is_empty() {
            return Ok(None);
        }
        let Some(&callee) = self.children(id).first() else {
            return Ok(None);
        };
        if self.kind_of(callee) != Some(syntax::IDENTIFIER) {
            return Ok(None);
        }
        let Some(symbol) = self.node(callee).symbol else {
            return Ok(None);
        };
        let Some(settler) = self.settlers.get(&symbol.0).cloned() else {
            return Ok(None);
        };

        let arguments = self.arguments_of(id);
        let value = match arguments.as_slice() {
            [] => None,
            [one] => Some(self.lower_expression(*one)?),
            _ => {
                return Err(self.unsupported(id, "a `resolve` or `reject` with more than one \
                                                 argument"));
            }
        };

        if !settler.rejects {
            return self.settle(id, &settler.result, value).map(Some);
        }

        // A rejection reason is `any`, and the runtime takes a reference:
        // `reject(new Error(m))` and `reject("text")` are both one, and
        // `reject(7)` is not. Refused rather than boxed, because a number
        // written into the reason slot is a pointer the collector would follow.
        let origin = self.origin(id);
        let Some(reason) = value else {
            return Err(self.unsupported(id, "a `reject` with no reason"));
        };
        if !matches!(
            self.values[reason.0 as usize].ty,
            HirType::Managed(_) | HirType::Erased
        ) {
            return Err(self.unsupported(
                id,
                "a `reject` with a reason that is not a reference",
            ));
        }
        Ok(Some(self.runtime_call(
            "nts_promise_reject",
            vec![settler.result.promise, reason],
            HirType::Void,
            origin,
        )))
    }

    /// `xs[i]`, as a read. Writes are handled by the assignment lowering.
    fn lower_element_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // `xs?.[i]`, which is three children because the `?.` is a token of its
        // own between the receiver and the index -- the same shape `a?.b` has,
        // and it reaches here before the two-child forms below can fail on it.
        if let [object, dot, index] = self.children(id).as_slice()
            && self.kind_of(*dot) == Some(syntax::QUESTION_DOT_TOKEN)
        {
            return self.lower_optional_element(id, *object, *index);
        }
        if self.names_a_property(id) {
            return self.lower_property_access(id);
        }
        if let Some(read) = self.lower_string_index(id)? {
            return Ok(read);
        }
        let (array, index) = self.element_access_parts(id)?;
        self.element_of(id, array, index)
    }

    /// `xs[i]` with both halves already lowered.
    ///
    /// Split out so that `xs?.[i]` can share it: the optional form lowers its
    /// receiver first, to ask whether it is absent, and then wants exactly this
    /// read in the arm where it is not.
    fn element_of(
        &mut self,
        id: NodeId,
        array: ValueId,
        index: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        // The element's representation comes from the *array*, not from the
        // access node's type. Under `noUncheckedIndexedAccess` — which is what
        // TypeScript actually knows — that type is `number | undefined`, and
        // there is no `undefined` to put in a double. What is stored in the
        // slot is a number; the `!` the author wrote is the claim that one is
        // there, and the bounds test is what checks it.
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Err(self.not_an_array(id));
        };
        let ty = *element;
        let origin = self.origin(id);
        let read = self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: true,
            },
            ty.clone(),
            origin.clone(),
        );
        // A typed array's element is narrower than the `number` every
        // expression around it is typed in -- TypeScript says `Uint8Array[i]`
        // is a `number`, and it is. Converting here keeps the HIR well typed
        // without asking the checker, which under `noUncheckedIndexedAccess`
        // would answer `number | undefined` and have no representation to give.
        //
        // It is not a cost so much as a statement of where the value is:
        // `hir::specialize` puts the arithmetic back into the narrow type where
        // that is what the program does, and `hir::simplify` drops a conversion
        // that turned out to be the identity.
        if matches!(ty, HirType::Int { .. } | HirType::Float { bits: 32 }) {
            return Ok(self.push(OpKind::Convert(read), HirType::NUMBER, origin));
        }
        Ok(read)
    }

    /// An array literal with a spread somewhere in it: `[...a, x, ...b]`.
    ///
    /// Everything is evaluated first, left to right, because that is the order
    /// JavaScript evaluates it in and the lengths are not known until it has
    /// been. Then the lengths are added -- one per plain element, the array's
    /// own for each spread -- and *then* the result is allocated, with the room
    /// it needs and no length.
    ///
    /// So `push` never reallocates and there is nothing to shorten at the end,
    /// which is the shape `filter` uses and for the same reasons.
    fn lower_mixed_literal(
        &mut self,
        elements: &[NodeId],
        ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let element_ty = match ty {
            HirType::Managed(ManagedType::Array(element)) => (**element).clone(),
            _ => return Err(self.unrepresentable(elements[0], "an array literal")),
        };
        let (push, extend) = match &element_ty {
            HirType::Managed(_) => ("nts_array_push_ref", "nts_array_extend_ref"),
            HirType::Float { bits: 64 } => ("nts_array_push", "nts_array_extend"),
            _ => {
                return Err(self.unsupported(elements[0], "a spread into a typed array"));
            }
        };

        // Left to right, and before anything is allocated.
        let mut lowered = Vec::new();
        for element in elements {
            let spread = self.kind_of(*element) == Some(syntax::SPREAD_ELEMENT);
            let node = if spread {
                *self
                    .children(*element)
                    .first()
                    .ok_or_else(|| self.unsupported(*element, "a spread of nothing"))?
            } else {
                *element
            };
            let value = self.lower_expression(node)?;
            if spread
                && !matches!(
                    self.values[value.0 as usize].ty,
                    HirType::Managed(ManagedType::Array(_))
                )
            {
                return Err(
                    self.unsupported(node, "a spread of something that is not an array")
                );
            }
            lowered.push((spread, value));
        }

        let mut total = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        for (spread, value) in &lowered {
            let more = if *spread {
                self.push(OpKind::Length(*value), HirType::NUMBER, origin.clone())
            } else {
                self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone())
            };
            total = self.push(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: total,
                    rhs: more,
                },
                HirType::NUMBER,
                origin.clone(),
            );
        }

        let out = self.push(
            OpKind::ArrayNew {
                length: total,
                zeroed: false,
            },
            ty.clone(),
            origin.clone(),
        );
        let none = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.runtime_call(
            "nts_array_keep_first",
            vec![out, none],
            HirType::Void,
            origin.clone(),
        );
        for (spread, value) in lowered {
            let helper = if spread { extend } else { push };
            let result = if spread {
                HirType::Void
            } else {
                HirType::NUMBER
            };
            self.runtime_call(helper, vec![out, value], result, origin.clone());
        }
        Ok(out)
    }

    /// `[...xs]`: the whole of `xs`, copied.
    ///
    /// A `slice` from nothing to the length, which is what the spread means and
    /// what `slice` already does -- including retaining each element where they
    /// are references, since both arrays hold them afterwards.
    fn lower_spread_copy(
        &mut self,
        spread: NodeId,
        ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let inner = *self
            .children(spread)
            .first()
            .ok_or_else(|| self.unsupported(spread, "a spread of nothing"))?;
        self.lower_array_copy(inner, ty, origin)
    }

    /// The whole of an array, copied: `[...xs]` and `Array.from(xs)` alike.
    ///
    /// A `slice` from nothing to the length, which is what both mean and what
    /// `slice` already does -- including retaining each element where they are
    /// references, since both arrays hold them afterwards.
    fn lower_array_copy(
        &mut self,
        inner: NodeId,
        ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let source = self.lower_expression(inner)?;
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[source.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(inner, "a copy of something that is not an array"));
        };
        let helper = match *element {
            HirType::Managed(_) => "nts_array_slice_ref",
            HirType::Float { bits: 64 } => "nts_array_slice",
            // `slice` reads the elements as doubles or as pointers, and a
            // narrower one is neither. The array methods refuse the same shape
            // for the same reason.
            _ => return Err(self.unsupported(inner, "a copy of a typed array")),
        };
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let length = self.push(OpKind::Length(source), HirType::NUMBER, origin.clone());
        Ok(self.runtime_call(helper, vec![source, zero, length], ty.clone(), origin.clone()))
    }

    /// `s[i]` where `s` is a string, which is a one-unit string rather than an
    /// element of anything.
    ///
    /// `None` where the receiver is not a string, so the array path runs
    /// unchanged. Decided from the *checker's* type rather than by lowering the
    /// receiver and looking, because the array path lowers it again and a
    /// receiver with a side effect would then have it twice.
    ///
    /// Two of the seven things `runtime/node/path` could not compile were this,
    /// both in the same shape: `path[i]` inside a loop bounded by
    /// `path.length`, and `ext[0]` guarded by `ext` being non-empty.
    fn lower_string_index(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let children = self.children(id);
        let [object, index] = children.as_slice() else {
            return Ok(None);
        };
        if !matches!(
            self.type_of(*object),
            Some(HirType::Managed(ManagedType::String))
        ) {
            return Ok(None);
        }
        let receiver = self.lower_expression(*object)?;
        let at = self.lower_expression(*index)?;
        let origin = self.origin(id);
        Ok(Some(self.runtime_call(
            "nts_str_at",
            vec![receiver, at],
            HirType::Managed(ManagedType::String),
            origin,
        )))
    }

    /// The array and index of an `xs[i]`, lowered in source order.
    fn element_access_parts(&mut self, id: NodeId) -> Result<(ValueId, ValueId), Diagnostic> {
        let children = self.children(id);
        let [array, index] = children.as_slice() else {
            return Err(self.unsupported(id, "an element access of unexpected shape"));
        };
        let array_value = self.lower_expression(*array)?;
        if !matches!(
            self.values[array_value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return Err(self.not_an_array(id));
        }
        let index_value = self.lower_expression(*index)?;
        Ok((array_value, index_value))
    }

    /// `xs[i]` where `xs` is not an array, named by what it is.
    ///
    /// From the checker rather than from the lowered value: a receiver with no
    /// representation has no lowered type to report, and those are most of
    /// these. Thirty-two instances read `indexing something that is not an
    /// array`, which says nothing about which thirty-two.
    fn not_an_array(&self, id: NodeId) -> Diagnostic {
        let described = self
            .children(id)
            .first()
            .and_then(|object| self.snapshot.node_types.get(object))
            .map_or_else(
                || "an untyped receiver".to_owned(),
                |ty| describe(self.snapshot, *ty),
            );
        self.unsupported(id, &format!("indexing {described}, which is not an array"))
    }

    /// `xs.length`. Other members are not lowered yet.
    fn lower_property_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // `Colour.Red` is a constant, and the checker has already worked out
        // which one: it gives the access a *literal* type carrying the value.
        // So there is nothing to look up at run time and no object to look it
        // up in -- which is why an enum was refused as "used as a value rather
        // than as a type". It is not being used as a value; the member is.
        //
        // A `const enum` is the same thing said twice. TypeScript's own erasure
        // of one is exactly this substitution, and a plain `enum` differs only
        // in also emitting a reverse-mapping object, which nothing in a
        // compiled program can reach without `Colour[n]`.
        match self.enum_member(id) {
            Some(EnumMember::Number(value)) => {
                let origin = self.origin(id);
                return Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin));
            }
            // A string member is a constant too, and a *managed* one: it wants
            // the interned static a string literal gets rather than an
            // immediate. That turns out to be the same emission, because the
            // checker gives `Label.Short` the identical
            // `Literal(String("s"))` type it gives the literal `"s"` -- so
            // this is `lower_string` reading its text from the same place,
            // and the two share an interned constant rather than each getting
            // one.
            Some(EnumMember::Text(text)) => {
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::ConstString(text),
                    HirType::Managed(ManagedType::String),
                    origin,
                ));
            }
            None => {}
        }
        let children = self.children(id);
        // `a?.b`, which is three children because the `?.` is a token of its
        // own between the receiver and the name.
        if let [object, dot, member] = children.as_slice()
            && self.kind_of(*dot) == Some(syntax::QUESTION_DOT_TOKEN)
        {
            return self.lower_optional_access(id, *object, *member);
        }
        let [object, member] = children.as_slice() else {
            return Err(self.unsupported(
                id,
                &format!(
                    "a property access of {} parts rather than an object and a name",
                    children.len()
                ),
            ));
        };
        // `a?.b.c` short-circuits the *whole* chain: when `a` is absent, `.c`
        // is not evaluated either. That is a property of the chain rather than
        // of either access, so a link after an optional one is refused instead
        // of being lowered as `(a?.b).c`, which would read a member of the
        // absent value. All twenty-six optional accesses in the node profile
        // are a single link.
        if self
            .children(*object)
            .get(1)
            .is_some_and(|dot| self.kind_of(*dot) == Some(syntax::QUESTION_DOT_TOKEN))
        {
            return Err(self.unsupported(id, "a link after an optional access"));
        }
        // `C.x` where `C` is a module: the checker resolved the member to the
        // export's own symbol, so this is a name and lowers as one -- through
        // the same alias-following path `import { x }` already takes.
        if self.denotes_a_module(*object) {
            return self.lower_identifier(*member);
        }
        let member_name = self
            .literal_name(*member)
            .ok_or_else(|| self.unsupported(id, "a computed property name"))?;

        // The constants `Math` and `Number` hold, taken before the object is
        // lowered because neither is a value: both are namespaces, and lowering
        // one would fail on the name rather than on the member.
        if self.kind_of(*object) == Some(syntax::IDENTIFIER)
            && let Some(namespace) = self.node(*object).text.as_deref()
            && let Some(constant) = named_constant(namespace, &member_name)
        {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstFloat(constant), HirType::NUMBER, origin));
        }

        let value = self.lower_expression(*object)?;
        self.member_of(id, value, &member_name)
    }

    /// `a?.b` -- `a.b` unless `a` is absent, and `undefined` when it is.
    ///
    /// The receiver is lowered once, before the test, and read only inside the
    /// arm that established it is present. Which is the same shape `??` has,
    /// and the same absence: a tag on an erased value, a null pointer on a
    /// reference.
    fn lower_optional_access(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(object)?;
        let Some(absent) = self.absence_of(object, receiver) else {
            // A receiver with no room for an absence is never absent, so this
            // is an ordinary access. TypeScript permits the shape and reports
            // it as unnecessary.
            let name = self
                .literal_name(member)
                .ok_or_else(|| self.unsupported(member, "a computed property name"))?;
            return self.member_of(id, receiver, &name);
        };
        let present = self.present_of(object, receiver);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Member(receiver, member, present),
        )
    }

    /// `xs?.[i]`.
    ///
    /// The same three steps as [`Self::lower_optional_access`], with an element
    /// read where that one has a member read.
    fn lower_optional_element(
        &mut self,
        id: NodeId,
        object: NodeId,
        index: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(object)?;
        let Some(absent) = self.absence_of(object, receiver) else {
            // A receiver with no room for an absence is never absent, so this
            // is an ordinary read. TypeScript permits the shape and reports it
            // as unnecessary.
            let index = self.lower_expression(index)?;
            return self.element_of(id, receiver, index);
        };
        let present = self.present_of(object, receiver);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Element(receiver, index, present),
        )
    }

    /// A call the frontend did not resolve, which is a missing pass rather than
    /// an unsupported construct.
    fn unresolved_call(&self, id: NodeId) -> Diagnostic {
        Diagnostic::error(
            "NTS1002",
            "this call was not resolved to a target; the frontend's call \
             resolution pass has to run before lowering",
            self.location(id),
        )
    }

    /// Whether a call is written `f?.(x)`.
    ///
    /// Asked before the target lookup in [`Self::lower_call`], because an
    /// optional call is on a *value* and the frontend has no single target to
    /// resolve it to.
    fn is_optional_call(&self, id: NodeId) -> bool {
        self.children(id)
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_DOT_TOKEN))
    }

    /// `f?.(x)`.
    ///
    /// The same three steps as [`Self::lower_optional_access`], with the call
    /// where that one has a member read. `f` is a *value* here, so the call in
    /// the present arm is the indirect one through the closure -- the third way
    /// [`Self::call_through_closure`] is come by.
    fn lower_optional_call(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let Some(&callee_node) = self.children(id).first() else {
            return Err(self.unsupported(id, "an optional call with no callee"));
        };
        let callee = self.lower_expression(callee_node)?;
        let Some(absent) = self.absence_of(callee_node, callee) else {
            // A callee with no room for an absence is always there, so this is
            // an ordinary call. TypeScript permits the shape and reports it as
            // unnecessary.
            let arguments = self.arguments_of(id);
            return self.call_through_closure(id, callee_node, callee, &arguments);
        };
        let present = self.present_of(callee_node, callee);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Invoke(callee, callee_node, present),
        )
    }

    /// What an erased receiver is, in the arm a `?.` has established it is
    /// present.
    ///
    /// # Why this is not [`Self::narrowed`]
    ///
    /// That one reads back what the *checker* narrowed, and its licence is
    /// `node_types`: it asks for the type of the very node being read. Here
    /// there is no such node. The checker narrows `v` inside
    /// `if (v !== null && v !== undefined)`, and it does not narrow anything
    /// inside `v?.length` -- the only type it records for that expression is
    /// the type of the whole thing, `number | undefined`, which says nothing
    /// about the receiver.
    ///
    /// So the licence is this lowering's own: [`Self::absence_of`] emitted a
    /// test of the tag against exactly the tags the receiver's type admits as
    /// absences, and this runs in the arm where that test was false. What is
    /// left is the union's non-absent members, and where those share one
    /// representation, that is what the payload holds.
    ///
    /// # What it was worth
    ///
    /// Two refusals with different sentences and one cause. `v?.length` on a
    /// `string | null | undefined` was refused as "`length` of something
    /// without one", and `h?.value` on a `Held | null | undefined` as "a union
    /// whose members lay their fields out differently" -- said of a union with
    /// exactly one object in it. Both were the erased receiver reaching
    /// [`Self::member_of`] still erased, while `Branch::Present` two arms away
    /// had been reading the payload back all along.
    ///
    /// `None` where there is nothing to read back to: a receiver that was never
    /// erased was never tagged, and a payload that is still several things
    /// (`string | number | null`) stays erased in the present arm too. Both are
    /// ordinary answers rather than refusals -- the first needs no unerase and
    /// the second is refused, if at all, by the member read.
    fn present_of(&self, object: NodeId, receiver: ValueId) -> Option<HirType> {
        if self.values[receiver.0 as usize].ty != HirType::Erased {
            return None;
        }
        let ty = *self.snapshot.node_types.get(&object)?;
        let TypeKind::Union(members) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let mut shared: Option<HirType> = None;
        for member in members {
            if absence_of_member(self.snapshot, *member).is_some() {
                continue;
            }
            let member = self.represent(*member)?;
            match &shared {
                Some(existing) if *existing != member => return None,
                _ => shared = Some(member),
            }
        }
        shared.filter(readable_back)
    }

    /// A member of a receiver that is already lowered.
    ///
    /// Split from [`Self::lower_property_access`] so `a?.b` can read the member
    /// without lowering `a` twice: the optional form has to test the receiver
    /// *and* read through it, and once is the difference between `a?.b` and
    /// something that calls a getter on the way in and again on the way out.
    fn member_of(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            let layout = self.layout_of(id, type_id)?;
            // A tuple is indexed by position, and `pair[0]` arrives here as a
            // member named `0`. Its layout spells the fields `_0`, `_1` --
            // because `v->1` is not C -- so the number is turned back into the
            // position it always was rather than looked up as a name nobody
            // wrote.
            let positional = member_name
                .parse::<usize>()
                .ok()
                .filter(|_| self.is_tuple(type_id))
                // Bounded here rather than at the indexing below, which would
                // read past the layout. A tuple's length is part of its type,
                // so an index outside it is a program the checker should have
                // rejected -- and if one arrives anyway it is refused by name
                // rather than answered with whatever is adjacent in memory.
                .filter(|at| *at < layout.fields.len())
                .and_then(|at| u32::try_from(at).ok());
            let Some(field) = positional
                .or_else(|| layout.index_of(member_name))
                .or_else(|| Self::symbol_keyed(&layout, member_name))
            else {
                // A getter. `o.x` looks like a field read and runs code, which
                // is why an accessor may not be laid out as a field: emitting
                // the load would read whatever sits at that offset.
                if let Some(callee) = self.accessor_callee(type_id, member_name, "get ") {
                    let ty = self
                        .type_of(id)
                        .ok_or_else(|| self.unrepresentable(id, "a getter"))?;
                    let origin = self.origin(id);
                    return Ok(self.push(
                        OpKind::Call {
                            callee: Callee::Direct(callee),
                            args: vec![value],
                            frame: None,
                        },
                        ty,
                        origin,
                    ));
                }
                return Err(self.absent_member(id, type_id, member_name));
            };
            let ty = layout.fields[field as usize].ty.clone();
            let origin = self.origin(id);
            // An erased field read where the checker narrowed is the same
            // question an erased *binding* read is, and takes the same answer.
            // `if (o.limit !== undefined) o.limit * 2` reads a number, while
            // the declaration says the field may be absent.
            let read = self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            );
            return self.narrowed(id, read);
        }

        // A table's `size` is its live entry count, which the header already
        // holds in the field an array's `length` uses -- so it is the same
        // operation, not a call.
        if matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_))
        ) {
            if member_name != "size" {
                return Err(self.unsupported(
                    id,
                    &format!("`{member_name}`, where a `Map` or a `Set` has only `size`"),
                ));
            }
            let origin = self.origin(id);
            return Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin));
        }

        let sequence = matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_) | ManagedType::String)
        );
        if member_name != "length" {
            // `buffer`, `byteLength` and `byteOffset` land here: a typed array
            // is an array of a known width and not a view onto storage
            // something else can also see, so it has a length and nothing else.
            return Err(self.unsupported(
                id,
                &if sequence {
                    format!("`{member_name}`, where an array has only `length`")
                } else if self.values[value.0 as usize].ty == HirType::Erased {
                    // A union of object types. Every member is a pointer, so
                    // the value is representable -- what is missing is that a
                    // field lives at a different offset in each member, so
                    // reading one needs the layouts reconciled or the
                    // discriminant tested first. Saying "a value with no
                    // fields" of something that has several sets of them is
                    // the wrong sentence entirely.
                    format!(
                        "`{member_name}` on a union, whose members lay their fields out \
                         differently"
                    )
                } else {
                    format!("`{member_name}`, a property of a value with no fields")
                },
            ));
        }
        if !sequence {
            return Err(self.unsupported(id, "`length` of something without one"));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin))
    }

    /// `c ? a : b`, and the short-circuiting `a && b` / `a || b`.
    ///
    /// All three are one shape: evaluate a condition, take one of two paths, and
    /// arrive at a value that depends on which. That is a merge block with a
    /// parameter — the same mechanism an `if` uses for a name the two arms
    /// disagree about, applied to a value with no name.
    ///
    /// The point of doing it this way rather than evaluating both sides is that
    /// both sides *must not* be evaluated: `a && expensive()` does not call
    /// `expensive` when `a` is falsy, and in a language with side effects that
    /// is a semantic difference rather than an optimization.
    fn lower_branching_value(
        &mut self,
        id: NodeId,
        condition: ValueId,
        then_branch: Branch,
        else_branch: Branch,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a conditional"))?;

        let then_block = self.new_block();
        let else_block = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        let entry = self.bindings.clone();
        self.switch_to(then_block);
        let then_value = self.evaluate(id, then_branch)?;
        let then_tail = self.current;
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        self.switch_to(else_block);
        let else_value = self.evaluate(id, else_branch)?;
        let else_tail = self.current;
        let else_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        // The two arms have to agree about representation, since one parameter
        // receives both -- and they are made to agree rather than assumed to.
        //
        // The assumption held while a union had no representation: `number |
        // string` was not lowerable, so a conditional that produced one was
        // refused before reaching here. Now it is an erased value, and
        // `n > 0 ? n : undefined` has a `double` on one arm and a tagged value
        // on the other. The join took the erased type and the first arm passed
        // the double straight through, which the C compiler reported as
        // assigning a `double` to an `NtsValue` -- with no source location and
        // nothing naming the join.
        let merge = self.new_block();
        let result = self.push_block_param(merge, ty.clone(), origin.clone());

        let mut merged = Vec::new();
        for (symbol, entering) in &entry {
            let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
            let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
            if from_then != from_else {
                merged.push((*symbol, from_then, from_else));
            }
        }
        merged.sort_unstable();

        let mut params = Vec::new();
        for (symbol, from_then, _) in &merged {
            let carried = self.values[from_then.0 as usize].ty.clone();
            params.push((
                *symbol,
                self.push_block_param(merge, carried, origin.clone()),
            ));
        }

        self.switch_to(then_tail);
        let then_value = self.coerce(then_value, &ty, id)?;
        let mut args = vec![then_value];
        args.extend(merged.iter().map(|(_, from_then, _)| *from_then));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(else_tail);
        let else_value = self.coerce(else_value, &ty, id)?;
        let mut args = vec![else_value];
        args.extend(merged.iter().map(|(_, _, from_else)| *from_else));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(merge);
        self.bindings = entry;
        for (symbol, param) in params {
            self.bindings.insert(symbol, param);
        }
        Ok(result)
    }

    /// Produce a branch's value: either an expression to lower here, or one
    /// already computed before the branch.
    fn evaluate(&mut self, id: NodeId, branch: Branch) -> Result<ValueId, Diagnostic> {
        match branch {
            Branch::Expression(node) => self.lower_expression(node),
            Branch::Value(value) => Ok(value),
            Branch::Absent => {
                let ty = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "an optional access"))?;
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstUndefined, ty, origin))
            }
            Branch::Invoke(callee, callee_node, present) => {
                // Here and not before the branch, for the reason above.
                let callee = match present {
                    Some(ty) => {
                        let origin = self.origin(callee_node);
                        self.push(OpKind::Unerase { value: callee }, ty, origin)
                    }
                    None => callee,
                };
                let arguments = self.arguments_of(id);
                self.call_through_closure(id, callee_node, callee, &arguments)
            }
            Branch::Element(receiver, index, present) => {
                // Here and not before the branch, for the reason above.
                let receiver = match present {
                    Some(ty) => {
                        let origin = self.origin(index);
                        self.push(OpKind::Unerase { value: receiver }, ty, origin)
                    }
                    None => receiver,
                };
                let index = self.lower_expression(index)?;
                self.element_of(id, receiver, index)
            }
            Branch::Member(receiver, member, present) => {
                let name = self
                    .literal_name(member)
                    .ok_or_else(|| self.unsupported(member, "a computed property name"))?;
                // Here and not before the branch. Reading the payload of a
                // value that may be absent is the thing the test exists to
                // prevent, and `evaluate` runs with the arm's block current.
                let receiver = match present {
                    Some(ty) => {
                        let origin = self.origin(member);
                        self.push(OpKind::Unerase { value: receiver }, ty, origin)
                    }
                    None => receiver,
                };
                self.member_of(id, receiver, &name)
            }
            // At the type the whole expression has, which is what `id` is.
            // Without this, `const chosen: number = limit || 1` handed a
            // `number` block parameter an erased value -- rejected by the
            // verifier, and before that check existed, by clang.
            Branch::Assigned(node, place) => {
                let value = self.lower_expression(node)?;
                // `write_place` coerces to what the slot holds; the value the
                // *expression* has is the one assigned, which the join then
                // coerces to the type of the whole thing. Those are the same
                // value at two representations, and conflating them would
                // store a `double` into an erased field.
                self.write_place(id, &place, value);
                Ok(value)
            }
            Branch::Present(value) => self.narrowed(id, value),
        }
    }

    /// `c ? a : b`.
    fn lower_conditional(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // condition, `?`, whenTrue, `:`, whenFalse — the punctuation is made of
        // children too, so the slots come from the presence bitmask.
        let Some([Some(condition), _, Some(when_true), _, Some(when_false)]) =
            self.child_slots::<5>(id)
        else {
            return Err(self.unsupported(id, "a conditional of unexpected shape"));
        };
        let condition = self.lower_expression(condition)?;
        let condition = self.truthy(id, condition);
        self.lower_branching_value(
            id,
            condition,
            Branch::Expression(when_true),
            Branch::Expression(when_false),
        )
    }

    /// `x += e`, which is `x = x + e` with the target evaluated once.
    ///
    /// Spelled out rather than desugared, so that one place knows a bitwise
    /// operator needs its coercions and `+=` on strings is concatenation. The
    /// target goes through [`Self::place_of`], which is what makes
    /// `xs[next()] += 1` call `next` once rather than twice.
    fn lower_compound(
        &mut self,
        id: NodeId,
        compound: Compound,
        lhs_node: NodeId,
        rhs_node: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let place = self.place_of(lhs_node)?;
        let current = self.read_place(lhs_node, &place)?;
        let addend = self.lower_expression(rhs_node)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a compound assignment of unrepresentable type"))?;
        let updated = match compound {
            Compound::Exponentiate => self.exponentiate(id, ty, current, addend),
            Compound::Op(op) => {
                // `s += t` on strings is concatenation, not addition, and the
                // two lower to nothing alike -- `Add` on two `NtsString *`
                // reaches the backend as pointer arithmetic. `lower_binary`
                // resolves `+` against the result type for exactly this reason;
                // the compound form has to ask the same question rather than
                // assume the answer.
                let (op, current, addend) = if matches!(op, BinOp::Add) && ty.is_managed() {
                    (
                        BinOp::Concat,
                        self.as_string(lhs_node, current)?,
                        self.as_string(rhs_node, addend)?,
                    )
                } else {
                    (op, current, addend)
                };
                let origin = self.origin(id);
                if bitwise_operator_of(op) {
                    self.push_bitwise(op, current, addend, ty, &origin)
                } else {
                    self.push(
                        OpKind::Binary {
                            op,
                            lhs: current,
                            rhs: addend,
                        },
                        ty,
                        origin,
                    )
                }
            }
        };
        self.write_place(id, &place, updated);
        Ok(updated)
    }

    /// `a ||= b`, `a &&= b`, `a ??= b`.
    ///
    /// Spelled as a branch around a write rather than as `a = a || b`, because
    /// the desugaring is wrong in a way that is easy to miss: it writes on
    /// every path. `a ||= b` where `a` is truthy performs no store, and the
    /// difference shows up twice -- a setter that does not run, and a counted
    /// store that does not release what the place already held. The
    /// specification is explicit about it, and so is this.
    ///
    /// The place is lowered once, before the test, for the reason
    /// [`Self::place_of`] exists at all.
    fn lower_logical_assignment(
        &mut self,
        id: NodeId,
        logical: Logical,
        lhs_node: NodeId,
        rhs_node: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let place = self.place_of(lhs_node)?;
        let current = self.read_place(lhs_node, &place)?;
        let condition = match logical {
            Logical::Nullish => match self.absence_of(lhs_node, current) {
                Some(absent) => absent,
                // Nothing to test, so nothing is ever written. A value with no
                // room for an absence is never absent, so `n ??= 1` is `n` --
                // which is what the specification says happens rather than an
                // optimization of it. TypeScript permits the shape and reports
                // it as unnecessary.
                None => return self.narrowed(id, current),
            },
            Logical::And | Logical::Or => self.truthy(id, current),
        };
        let assign = Branch::Assigned(rhs_node, place);
        // Which arm keeps the current value, and at what type. Truthy excludes
        // both absences and so does the nullish test, so those arms may read an
        // erased value back at the type the whole expression has. `&&=` keeps
        // its value where it is *falsy*, and `undefined` is falsy -- so that
        // one is a `Value` and not a `Present`. The distinction is the same
        // soundness one [`Branch::Present`] documents, and getting it backwards
        // here would unerase a payload that is not there.
        let keep = match logical {
            Logical::Or | Logical::Nullish => Branch::Present(current),
            Logical::And => Branch::Value(current),
        };
        let (then_branch, else_branch) = match logical {
            Logical::And | Logical::Nullish => (assign, keep),
            Logical::Or => (keep, assign),
        };
        self.lower_branching_value(id, condition, then_branch, else_branch)
    }

    /// The value of an enum member access, where that is what this is.
    ///
    /// Both halves are asked. The *object* has to be an enum -- otherwise any
    /// property access whose type happens to be a literal would fold, which is
    /// constant propagation and not this. And the access's own type has to be a
    /// numeric literal, which is where the value comes from.
    ///
    /// A string enum answers `LiteralValue::String` and falls through to the
    /// refusal, which is correct for now: `Colour.Red` as a string is a
    /// constant too, but it is a *managed* constant and wants the interned
    /// static a string literal gets rather than an immediate.
    fn enum_member(&self, id: NodeId) -> Option<EnumMember> {
        let object = *self.children(id).first()?;
        let symbol = self.node(object).symbol?;
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        if !record.flags.contains(SymbolFlags::ENUM) {
            return None;
        }
        let ty = self.snapshot.node_types.get(&id)?;
        match &self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Literal(nts_semantic_schema::LiteralValue::Number(value)) => {
                Some(EnumMember::Number(*value))
            }
            TypeKind::Literal(nts_semantic_schema::LiteralValue::String(text)) => {
                Some(EnumMember::Text(text.clone()))
            }
            _ => None,
        }
    }

    /// `a ?? b` -- `a` unless `a` is absent.
    ///
    /// The same shape as [`Self::lower_logical`] and deliberately not the same
    /// test. `||` asks whether the left operand is *truthy*, so `0 || 1` is
    /// `1`; `??` asks whether it is `null` or `undefined`, so `0 ?? 1` is `0`.
    /// Telling those apart is the whole reason the operator exists, which is
    /// why this is its own lowering rather than a desugaring to `||`.
    ///
    /// The left operand is lowered once, before the branch, so it is evaluated
    /// once however the test goes.
    fn lower_nullish(
        &mut self,
        id: NodeId,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let first = self.lower_expression(left)?;
        let Some(absent) = self.absence_of(left, first) else {
            // Nothing to test. A value with no room for an absence is never
            // absent, so the result is the left operand and the right one is
            // never evaluated -- which is what the specification says happens,
            // rather than an optimization of it. TypeScript permits the shape
            // and reports it as unnecessary.
            return self.narrowed(id, first);
        };
        self.lower_branching_value(
            id,
            absent,
            Branch::Expression(right),
            Branch::Present(first),
        )
    }

    /// Whether a loose comparison between these two could coerce.
    ///
    /// It can when either side is erased: the runtime types are then not known
    /// to agree, and JavaScript's abstract equality converts before comparing.
    /// Where both sides have the same concrete representation there is nothing
    /// to convert and `==` is `===`.
    fn coercing_comparison(&self, lhs: NodeId, rhs: NodeId) -> bool {
        // `x == null` and `x == undefined` are the *absence* question, whatever
        // the other side is represented as, and they are answered correctly
        // above -- by the tag pair for an erased value and by the null pointer
        // for a reference. They are also the only loose comparison real code
        // writes: 273 of them in the node profile.
        let absent = |node: NodeId| {
            self.kind_of(node) == Some(syntax::NULL_KEYWORD)
                || self.node(node).text.as_deref() == Some("undefined")
        };
        if absent(lhs) || absent(rhs) {
            return false;
        }
        // Otherwise only an erased side can surprise: two concrete
        // representations that reach here already agree, because the checker
        // rejects a comparison between types that do not.
        self.type_of(lhs) == Some(HirType::Erased) || self.type_of(rhs) == Some(HirType::Erased)
    }

    /// The absent values a node's *type* admits, as tags.
    ///
    /// The representation has forgotten which: a `string | null` and a `string
    /// | undefined` are both one pointer. The type has not, and it is what says
    /// whether `v === undefined` can ever be true.
    fn absences_of(&self, node: NodeId) -> Option<Vec<u32>> {
        let ty = *self.snapshot.node_types.get(&node)?;
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let members: Vec<TypeId> = match &record.kind {
            TypeKind::Union(members) => members.clone(),
            _ => vec![ty],
        };
        Some(
            members
                .iter()
                .filter_map(|member| match absence_of_member(self.snapshot, *member)? {
                    Absence::Null => Some(super::tags::NULL),
                    Absence::Undefined => Some(super::tags::UNDEFINED),
                })
                .collect(),
        )
    }

    /// Whether a lowered value is `null` or `undefined`.
    ///
    /// `None` where the type has no room for either, which is not a refusal:
    /// a `double` is never absent and there is nothing to compare it against.
    ///
    /// This is the *loose* question -- what `?.` and `??` ask, and what
    /// `== null` means. Both absent values answer it, which for an erased value
    /// is two tags. `===` is a different question and is answered by
    /// [`Self::erased_absence_test`].
    fn absence_of(&mut self, at: NodeId, value: ValueId) -> Option<ValueId> {
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(at);
        match ty {
            // The tag is the answer, and it is already there.
            HirType::Erased => {
                let unsigned = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                // `undefined` is tag 0 and `null` is the highest tag, so
                // "either absence" is two comparisons however it is spelled.
                let undefined = self.push(
                    OpKind::ConstInt(i128::from(super::tags::UNDEFINED)),
                    unsigned.clone(),
                    origin.clone(),
                );
                let is_undefined = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: undefined,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let null = self.push(
                    OpKind::ConstInt(i128::from(super::tags::NULL)),
                    unsigned,
                    origin.clone(),
                );
                let is_null = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                Some(self.push(
                    OpKind::Binary {
                        op: BinOp::BitOr,
                        lhs: is_undefined,
                        rhs: is_null,
                    },
                    HirType::Bool,
                    origin,
                ))
            }
            // A reference has one absent value and it is the null pointer. The
            // emitter compares addresses for this rather than reading through
            // them, which for a string is the difference between an answer and
            // a fault.
            HirType::Managed(_) => {
                let null = self.push(OpKind::ConstNull, ty, origin.clone());
                Some(self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: value,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin,
                ))
            }
            _ => None,
        }
    }

    /// `a && b` and `a || b`, which do not evaluate `b` unless they have to.
    fn lower_logical(
        &mut self,
        id: NodeId,
        and: bool,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let first = self.lower_expression(left)?;
        let condition = self.truthy(id, first);
        // `a && b` is `b` when `a` is truthy and `a` otherwise; `a || b` is the
        // other way round. Neither yields a bool in general — `0 || 5` is `5`.
        // `&&` keeps its first operand where it is *falsy*, and `undefined` is
        // falsy -- so that arm is `Value` and not `Present`.
        let (then_branch, else_branch) = if and {
            (Branch::Expression(right), Branch::Value(first))
        } else {
            (Branch::Present(first), Branch::Expression(right))
        };
        self.lower_branching_value(id, condition, then_branch, else_branch)
    }

    /// A value as a condition, by JavaScript's rules.
    fn truthy(&mut self, id: NodeId, value: ValueId) -> ValueId {
        // A bool is already its own condition; anything else needs the rule.
        if matches!(self.values[value.0 as usize].ty, HirType::Bool) {
            return value;
        }
        let origin = self.origin(id);
        self.push(
            OpKind::Unary {
                op: UnOp::Truthy,
                operand: value,
            },
            HirType::Bool,
            origin,
        )
    }

    /// `-x`, `+x`, `!x`.
    ///
    /// # The operator is not a child
    ///
    /// A `BinaryExpression` holds its operator as a real token node, so
    /// [`Self::children`] returns it. A `PrefixUnaryExpression` does not: tsgo
    /// stores the operator as a `Kind` *field*, which the encoder packs into the
    /// node's small data as a dense index — see
    /// [`syntax::prefix_operator`] for why that index is not a `SyntaxKind`
    /// however firmly the encoder's documentation says it is. The only child is
    /// the operand.
    ///
    /// Unary `+` is `ToNumber`, which on something already typed `number` is the
    /// identity — including on `-0`, so it is dropped rather than lowered to an
    /// operation that would then have to preserve the sign of zero.
    fn lower_prefix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a unary expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a unary expression of unexpected shape"));
        };

        // `++i` and `--i` step the name and evaluate to the *new* value, which
        // is the only way they differ from the postfix forms.
        if matches!(
            small & syntax::prefix_operator::MASK,
            syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
        ) {
            let op =
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::MINUS_MINUS {
                    BinOp::Sub
                } else {
                    BinOp::Add
                };
            let (_, after) = self.step(id, *operand, op)?;
            return Ok(after);
        }

        // `~x` is `ToInt32(x) ^ -1`, which is what the specification says it is
        // and what makes it a bitwise operator rather than an arithmetic one:
        // the coercion is the whole of its behaviour on a non-integer, and
        // `~3.7` is `-4` for that reason rather than by rounding.
        if small & syntax::prefix_operator::MASK == syntax::prefix_operator::TILDE {
            let value = self.lower_expression(*operand)?;
            let origin = self.origin(id);
            let ones = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
            return Ok(self.push_bitwise(BinOp::BitXor, value, ones, HirType::NUMBER, &origin));
        }

        let op = match small & syntax::prefix_operator::MASK {
            syntax::prefix_operator::PLUS => None,
            syntax::prefix_operator::MINUS => Some(UnOp::Neg),
            syntax::prefix_operator::EXCLAMATION => Some(UnOp::Not),
            // `++`/`--` assign, and are handled above.
            _ => return Err(self.unsupported(id, "this unary operator")),
        };

        let value = self.lower_expression(*operand)?;
        let Some(op) = op else { return Ok(value) };
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a unary expression"))?;
        Ok(self.push(OpKind::Unary { op, operand: value }, ty, origin))
    }

    fn lower_variable_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        // A `VariableDeclarationList` is an ordinary syntax node, not a NodeList,
        // so `children` does not flatten it away — the declarations sit one level
        // further down than they appear to.
        let declarations: Vec<NodeId> = self
            .children(id)
            .into_iter()
            .flat_map(|child| {
                if self.kind_of(child) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                    self.children(child)
                } else {
                    vec![child]
                }
            })
            .collect();

        for declaration in declarations {
            if self.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
                continue;
            }
            // name, `!`, type, initializer — the annotation is a child too, so
            // `const scale: number = 3` has three where `const scale = 3` has
            // two. Destructuring positionally refused every annotated local.
            let Some([Some(name), _, _, initializer]) = self.child_slots::<4>(declaration) else {
                return Err(self.unsupported(declaration, "a declaration of unexpected shape"));
            };
            // An empty array literal has type `never[]`: with no elements the
            // checker has nothing to infer from. The declaration does know —
            // `const out: number[] = []` says so — so the annotation supplies
            // what the literal cannot.
            let value = match initializer {
                Some(initializer)
                    if self.kind_of(initializer) == Some(syntax::ARRAY_LITERAL_EXPRESSION)
                        && self.children(initializer).is_empty() =>
                {
                    let declared = self
                        .type_of(name)
                        .or_else(|| self.evolved_type(name))
                        .ok_or_else(|| self.unrepresentable(declaration, "an empty array"))?;
                    self.lower_empty_array(initializer, declared)?
                }
                Some(initializer) => self.lower_expression(initializer)?,
                None => self.unwritten(name, declaration)?,
            };
            // `const { a, b } = o` and `const [a, b] = xs`: one initializer,
            // several names. Lowered as the reads it stands for -- a field per
            // name, or an element per position.
            if matches!(
                self.kind_of(name),
                Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
            ) {
                self.bind_pattern(name, value)?;
                continue;
            }
            let symbol = self
                .node(name)
                .symbol
                .ok_or_else(|| self.unsupported(name, "an unresolved declaration"))?;
            // At the type the declaration *says*, not the one the initializer
            // happens to have. `let held: unknown = n` binds an erased value;
            // binding the raw double instead left the declared type and the
            // stored representation disagreeing, and `typeof held` then matched
            // neither the primitive path nor the erased one.
            let value = match self.type_of(name) {
                Some(declared) => self.coerce(value, &declared, declaration)?,
                None => value,
            };
            // A name some closure writes to lives in a cell from here on, and
            // the binding is the cell. Every read and write below goes through
            // it, in this function and in the closure.
            let value = self.open_cell(symbol.0, value, declaration);
            self.bindings.insert(symbol.0, value);
        }
        Ok(())
    }

    /// What a name holds between its declaration and its first assignment.
    ///
    /// `let path: string;` and then a branch that writes it. It is how a value
    /// decided by statements rather than by an expression gets written, and
    /// four of the seven things `runtime/node/path` still could not compile
    /// were this.
    ///
    /// The name has to *be* something from here on. Every block below reads it
    /// as a carried name, a merge takes it as a parameter, and a name with no
    /// binding is not one -- so the whole of this feature is having a value to
    /// bind, and the rest of the lowering was already able to cope.
    ///
    /// # Why a placeholder is not a guess
    ///
    /// Where the type admits no absence the checker has already proved the
    /// assignment comes first: `let path: string;` read before it is written is
    /// "used before being assigned", and the program does not reach here. So
    /// what the placeholder is cannot be observed.
    ///
    /// Where the type *does* admit one it can be observed, and then the
    /// placeholder is the answer node gives. `let joined: string | undefined;`
    /// is read before it is written -- that is the point of writing it -- and
    /// `undefined` is what it holds. One absence on a reference is the null
    /// pointer, so `ConstNull` is that `undefined` rather than a stand-in for
    /// it; a scalar union is erased, where it is spelled out.
    fn unwritten(&mut self, name: NodeId, declaration: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(name)
            .or_else(|| self.evolved_type(name))
            .ok_or_else(|| self.unsupported(declaration, "a declaration without an initializer"))?;
        let origin = self.origin(declaration);
        let kind = match &ty {
            HirType::Bool => OpKind::ConstBool(false),
            HirType::Erased => OpKind::ConstUndefined,
            HirType::Managed(_) => OpKind::ConstNull,
            HirType::Float { .. } => OpKind::ConstFloat(0.0),
            // An integer here would be `specialize`'s doing, and it has not run
            // yet; anything else is a type with no zero to name.
            _ => {
                return Err(
                    self.unsupported(declaration, "a declaration without an initializer")
                );
            }
        };
        Ok(self.push(kind, ty, origin))
    }

    /// The type an *evolving* declaration settles on, read back from a use.
    ///
    /// `const parts = []` is `never[]` where it is written: with no elements and
    /// no annotation the checker has nothing to infer from *yet*, and it fills
    /// that in from the pushes as it walks. `let device;` is the same thing
    /// spelled without a literal. Both are ordinary TypeScript and both were
    /// refused here, because the type at the declaration is the one that says
    /// nothing.
    ///
    /// Every later mention of the name carries what it evolved to, and the
    /// checker has already done the work. So this reads one back rather than
    /// repeating the inference -- which would be a second answer to a question
    /// that already has one, and the two would agree until they did not.
    ///
    /// **Every** use has to agree, and `None` where they do not. A use before
    /// the first assignment sees a narrower type than one after it, and picking
    /// whichever came first in the node list would be picking arbitrarily.
    fn evolved_type(&self, name: NodeId) -> Option<HirType> {
        let symbol = self.node(name).symbol?;
        let mut settled: Option<HirType> = None;
        for at in 0..self.snapshot.nodes.len() {
            let id = NodeId(u32::try_from(at).ok()?);
            if id == name || self.node(id).symbol != Some(symbol) {
                continue;
            }
            let Some(ty) = self.type_of(id) else {
                continue;
            };
            match &settled {
                Some(known) if *known != ty => return None,
                Some(_) => {}
                None => settled = Some(ty),
            }
        }
        settled
    }

    /// Bind every name a destructuring pattern introduces.
    ///
    /// The initializer is lowered *once* and each name is a read of it, which
    /// is what the pattern means: `const { a, b } = f()` calls `f` once.
    ///
    /// Only the two plain shapes. A default (`{ a = 1 }`), a rest (`[a,
    /// ...tail]`), a nested pattern and a computed property name are each a
    /// separate feature and are refused by name rather than by falling through
    /// to something that looks close.
    /// One slot of a destructuring pattern, read from what it destructures.
    ///
    /// Three sources and one shape: a property by name for `{ a }`, a field by
    /// position for a tuple, and an indexed element for an array. Extracted
    /// from `bind_pattern` so that the loop there is about *binding* -- rests,
    /// nesting, symbols -- and this is about reading.
    fn read_for_pattern(
        &mut self,
        element: NodeId,
        property: NodeId,
        value: ValueId,
        position: usize,
        object: bool,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(element);
        let read = if object {
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[value.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(element, "destructuring something with no fields"));
            };
            let layout = self.layout_of(element, type_id)?;
            let name = self
                .literal_name(property)
                .ok_or_else(|| self.unsupported(element, "a computed property name"))?;
            let Some(field) = layout
                .index_of(&name)
                .or_else(|| Self::symbol_keyed(&layout, &name))
            else {
                return Err(self.absent_member(element, type_id, &name));
            };
            let ty = layout.fields[field as usize].ty.clone();
            self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            )
        } else if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            // `const [a, b] = pair` where `pair` is a tuple: written like an
            // array and read like an object, because the position *is* the
            // field.
            let layout = self.layout_of(element, type_id)?;
            let Some(slot) = layout.fields.get(position) else {
                return Err(self.unsupported(
                    element,
                    &format!(
                        "position {position} of a tuple with {} element(s)",
                        layout.fields.len()
                    ),
                ));
            };
            let ty = slot.ty.clone();
            let field = u32::try_from(position).unwrap_or(0);
            self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            )
        } else {
            let HirType::Managed(ManagedType::Array(element_ty)) =
                self.values[value.0 as usize].ty.clone()
            else {
                return Err(
                    self.unsupported(element, "destructuring something that is not an array")
                );
            };
            #[allow(clippy::cast_precision_loss)]
            let at = position as f64;
            let index = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
            // Checked, like every other element read: a pattern longer than
            // its array is `undefined` in JavaScript and this compiler has
            // no `undefined` to hand back.
            self.push(
                OpKind::ArrayGet {
                    array: value,
                    index,
                    checked: true,
                },
                *element_ty,
                origin,
            )
        };
        Ok(read)
    }

    fn bind_pattern(&mut self, pattern: NodeId, value: ValueId) -> Result<(), Diagnostic> {
        let object = self.kind_of(pattern) == Some(syntax::OBJECT_BINDING_PATTERN);
        for (position, element) in self.children(pattern).into_iter().enumerate() {
            if self.kind_of(element) != Some(syntax::BINDING_ELEMENT) {
                return Err(self.unsupported(element, "a binding of unexpected shape"));
            }
            let parts = self.children(element);
            // `[a, ...tail]`: everything from here on, as a new array. An
            // object rest -- `{ a, ...others }` -- would have to *build* an
            // object out of the fields nobody named, which is a different
            // thing, and is refused.
            if parts
                .iter()
                .any(|part| self.kind_of(*part) == Some(syntax::DOT_DOT_DOT_TOKEN))
            {
                if object {
                    return Err(self.unsupported(element, "a rest element in an object pattern"));
                }
                self.bind_rest(element, value, position)?;
                continue;
            }
            // One identifier for `{ a }` and `[a]`; two for `{ a: renamed }`,
            // the property first.
            // A binding element is one of four shapes, and the encoder gives
            // the fields it has and no tokens:
            //
            //     `{ a }`       [name]
            //     `{ a: b }`    [property, name]
            //     `{ a = d }`   [name, default]
            //     `{ a: b = d}` [property, name, default]
            //
            // Two children are ambiguous when both are identifiers, because
            // `{ a: b }` and `{ a = b }` encode identically. They are told
            // apart by which identifier is a *declaration*: the checker records
            // a binding's own identifier in its symbol's declaration list, and
            // a reference to something else is not in it.
            //
            // A nested *pattern* is a binding too, and declares no symbol of
            // its own -- `{ inner: { name } }` would otherwise read as a
            // property with the pattern as its default.
            let binds = |builder: &Self, node: NodeId| {
                builder.declared_by(element, node)
                    || matches!(
                        builder.kind_of(node),
                        Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
                    )
            };
            let (property, binding, default) = match parts.as_slice() {
                [only] => (*only, *only, None),
                [first, second] if binds(self, *second) => (*first, *second, None),
                [first, second] => (*first, *first, Some(*second)),
                [first, second, third] => (*first, *second, Some(*third)),
                _ => return Err(self.unsupported(element, "a binding of unexpected shape")),
            };
            let nested = matches!(
                self.kind_of(binding),
                Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
            );
            if !nested && self.kind_of(binding) != Some(syntax::IDENTIFIER) {
                return Err(self.unsupported(element, "a binding of unexpected shape"));
            }
            let symbol = if nested {
                None
            } else {
                match self.node(binding).symbol {
                    Some(symbol) => Some(symbol),
                    None => return Err(self.unsupported(element, "an unresolved binding")),
                }
            };

            let read = self.read_for_pattern(element, property, value, position, object)?;
            // `{ a = d }`: the default stands in where the read is `undefined`,
            // and only there.
            let read = match default {
                Some(default) => match self.defaulted_when(element, property, read)? {
                    // The *binding's* node, not the element's: its type is the
                    // one the default has already been folded into, which is
                    // what both arms have to produce.
                    Some(absent) => self.lower_branching_value(
                        binding,
                        absent,
                        Branch::Expression(default),
                        Branch::Present(read),
                    )?,
                    // No room for an absence, so the default is unreachable.
                    // The language agrees: it is never evaluated.
                    None => read,
                },
                None => read,
            };
            // `{ p: { x } }` is a read and then another pattern over what it
            // produced, which is the same function one level down.
            match symbol {
                Some(symbol) => {
                    self.bindings.insert(symbol.0, read);
                }
                None => self.bind_pattern(binding, read)?,
            }
        }
        Ok(())
    }

    /// Whether this identifier is the name `element` *declares*.
    ///
    /// The checker records a binding's declaration as the **binding element**,
    /// not as the identifier inside it -- read off a real program, because the
    /// obvious guess is the identifier and it is wrong. So the question is
    /// asked of the element: `{ a: b }` has `b`'s symbol declared by this
    /// element, and in `{ a = b }` the `b` is a reference whose symbol was
    /// declared somewhere else entirely.
    ///
    /// That is the only thing telling the two apart: the encoder gives both as
    /// the same two identifiers, with no `=` token and no property-name slot to
    /// distinguish them.
    fn declared_by(&self, element: NodeId, node: NodeId) -> bool {
        self.node(node)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .is_some_and(|record| record.declarations.contains(&element))
    }

    /// The condition under which a pattern's default applies.
    ///
    /// Not [`Self::absence_of`], which tests for `null` as well. `{ a = 5 }`
    /// where `a` is `null` keeps the `null` -- only `undefined` reaches a
    /// default. The two tests coincide for an *optional* property, whose type
    /// admits no null, and differ for `T | null`.
    ///
    /// `None` when the representation has no room for an absence at all, which
    /// makes the default unreachable. The language says the same thing: a
    /// default is evaluated only when the value is `undefined`.
    fn defaulted_when(
        &mut self,
        at: NodeId,
        property: NodeId,
        value: ValueId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(at);
        match ty {
            // The tag is the answer, and only one of its values is the one.
            HirType::Erased => {
                let unsigned = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                let undefined = self.push(
                    OpKind::ConstInt(i128::from(super::tags::UNDEFINED)),
                    unsigned,
                    origin.clone(),
                );
                Ok(Some(self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: undefined,
                    },
                    HirType::Bool,
                    origin,
                )))
            }
            // One null pointer stands for both absences, so the representation
            // cannot tell them apart and the *type* has to. A property that can
            // only be missing is answered exactly; one that can also be `null`
            // is refused rather than answered by the nearest available test,
            // which would take the default for a `null` the language keeps.
            HirType::Managed(_) => {
                let only_missing = self
                    .absences_of(property)
                    .is_some_and(|tags| tags == vec![super::tags::UNDEFINED]);
                if only_missing {
                    Ok(self.absence_of(at, value))
                } else {
                    Err(self.unsupported(
                        at,
                        "a default on a property that can be `null` as well as missing",
                    ))
                }
            }
            _ => Ok(None),
        }
    }

    /// `[a, ...tail]`: everything from `position` on, as a new array.
    ///
    /// A slice rather than a view, which is what the language says: `tail` is a
    /// fresh array and writing to it does not touch the one it came from.
    fn bind_rest(
        &mut self,
        element: NodeId,
        value: ValueId,
        position: usize,
    ) -> Result<(), Diagnostic> {
        let Some(binding) = self
            .children(element)
            .into_iter()
            .find(|part| self.kind_of(*part) == Some(syntax::IDENTIFIER))
        else {
            return Err(self.unsupported(element, "a rest element with no name"));
        };
        let Some(symbol) = self.node(binding).symbol else {
            return Err(self.unsupported(element, "an unresolved binding"));
        };
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(element);
        #[allow(clippy::cast_precision_loss)]
        let at = position as f64;
        let from = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
        let to = self.push(OpKind::Length(value), HirType::NUMBER, origin.clone());
        let rest = self.push(
            OpKind::Call {
                callee: Callee::External("nts_array_slice".to_owned()),
                args: vec![value, from, to],
                frame: None,
            },
            ty,
            origin,
        );
        self.bindings.insert(symbol.0, rest);
        Ok(())
    }

    fn lower_string(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
                _ => None,
            })
            .ok_or_else(|| self.unsupported(id, "a string literal with no known value"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstString(text),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A call to a statically resolved target.
    ///
    /// Requires the frontend's call resolution: without it there is no way to
    /// know *which* function a call site reaches, and guessing from the callee's
    /// spelling would pick the wrong overload silently. Refusing is the honest
    /// answer, and the diagnostic says what is missing rather than what is
    /// unsupported.
    /// `c.advance()` — a call whose receiver is the thing before the dot.
    ///
    /// Which method runs depends on what the receiver *is*: a string's methods
    /// are the runtime's, an array's are the runtime's with the element type
    /// deciding which, and an object's are the program's own.
    fn lower_method_call(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let parts = self.children(callee_node);
        let [receiver_node, member] = parts.as_slice() else {
            return Err(self.unsupported(callee_node, "a method call of unexpected shape"));
        };
        let receiver = self.lower_expression(*receiver_node)?;

        // `n.toString()` is `ToString` spelled as a method. A number has no
        // other method this compiler provides, so the arm is exact rather than
        // a first guess.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Float { .. } | HirType::Int { .. }
        ) {
            let name = self.node(*member).text.clone().unwrap_or_default();
            if name == "toString" && arguments.is_empty() {
                return self.as_string(*receiver_node, receiver);
            }
            return Err(self.unsupported(id, &format!("`{name}` on a number")));
        }

        // `valueOf` and `toString` on a string are the string. Not a runtime
        // call, because there is nothing for one to do: the specification says
        // the result *is* the receiver, and a helper returning it would hand
        // back a reference the caller does not own.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        ) && arguments.is_empty()
            && matches!(
                self.node(*member).text.as_deref(),
                Some("valueOf" | "toString")
            )
        {
            return Ok(receiver);
        }

        // A string's methods are the runtime's, not the program's: there is
        // no `String` class here to resolve a call against.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        ) {
            return self.lower_string_method(id, receiver, *member, arguments);
        }
        if let HirType::Managed(ManagedType::Array(element)) =
            self.values[receiver.0 as usize].ty.clone()
        {
            // A class whose instances *are* an array -- one extending a typed
            // array and adding no storage -- still declares methods, and they
            // are in the hierarchy under its own name. The representation says
            // how the bytes are arranged and nothing about what declared them,
            // so the member is resolved from the type the *checker* gives the
            // receiver. Without this, `buf.fill(0)` asked the runtime's array
            // helpers for a method the program wrote.
            // Through the polymorphic `this` first. Inside `class Buffer
            // extends Uint8Array`, `this.at8(...)` gives the receiver the
            // *this* type -- a type parameter constrained to `Buffer` -- and
            // the hierarchy is keyed by the class, so asking it about a type
            // parameter found nothing and the call fell through to the
            // runtime's array helpers. 34 refusals in the node profile were
            // `at8` and `checkInt`, which are Buffer's own methods called on
            // its own `this`.
            if let Some(declared) = self
                .snapshot
                .node_types
                .get(receiver_node)
                .copied()
                .map(|ty| self.class_behind(ty))
                && let Some(name) = self.literal_name(*member)
                && self.hierarchy.declaring(declared, &name).is_some()
            {
                return self.lower_object_method(id, receiver, declared, *member, arguments);
            }
            return self.lower_array_method(id, receiver, &element, *member, arguments);
        }

        if let table @ HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) =
            self.values[receiver.0 as usize].ty.clone()
        {
            return self.lower_table_method(id, receiver, &table, *member, arguments);
        }

        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[receiver.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "a method call on something without methods"));
        };
        self.lower_object_method(id, receiver, type_id, *member, arguments)
    }

    fn lower_call(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // Before the target lookup, because `resolve` is a parameter rather
        // than a function: the frontend has nothing to resolve it to, and the
        // call is not a call at all once the executor is inlined.
        if let Some(settled) = self.lower_settler_call(id)? {
            return Ok(settled);
        }
        if self.is_optional_call(id) {
            return self.lower_optional_call(id);
        }
        let Some(target) = self.snapshot.call_targets.get(&id) else {
            return Err(self.unresolved_call(id));
        };

        let children = self.children(id);
        let callee_node = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a call with no callee"))?;
        // Explicit type arguments are flattened in among the arguments, so
        // `f<number>(x)` would otherwise lower `number` as a value.
        let arguments = self.arguments_of(id);

        // `super(...)` and `super.method()`. The base is known statically -- a
        // class extends at most one -- so both are ordinary static calls with
        // `this` as the receiver, which is what they are once `this` is
        // explicit.
        if self.kind_of(callee_node) == Some(syntax::SUPER_KEYWORD) {
            return self.lower_super(id, "constructor", &arguments);
        }
        if self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee_node);
            if let [target, member] = parts.as_slice()
                && self.kind_of(*target) == Some(syntax::SUPER_KEYWORD)
            {
                let name = self.literal_name(*member).ok_or_else(|| {
                    self.unsupported(*member, "a method whose name the program computes")
                })?;
                return self.lower_super(id, &name, &arguments);
            }
        }

        // The calls that are not calls, in one place.
        if let Some(special) = self.lower_special_call(id, callee_node, &arguments) {
            return special;
        }

        // `Body.jupiter()` — a *static* method. It looks like a method call and
        // is not one: the thing before the dot is a class, which is a type
        // rather than a value, so lowering it as a receiver would ask for the
        // value of something that has none.
        //
        // Recognized from the checker's resolved target rather than from the
        // syntax, so an aliased import resolves the same as a plain name.
        if let Some(callee) = target.callee
            && self
                .node(callee)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
            && let Some(class_name) = self.declaring_class_name(callee)
        {
            return self.lower_static_call(id, &class_name, callee, &arguments);
        }

        // `c.advance()` — a method call. The receiver becomes the first
        // argument, which is what a method is once it is explicit.
        if self.names_a_property(callee_node) {
            return self.lower_method_call(id, callee_node, &arguments);
        }

        // `f(x)` where `f` is a parameter, a local, or `pick(1)(x)` where it is
        // another call's result: the callee is a *value*, not a function, so
        // there is nothing to call directly. It holds a closure, which is an
        // object with one method, and this is a dispatch through that method's
        // slot with the closure itself as the receiver.
        // The checker resolved this call, so ask it rather than the name. An
        // imported `scale` is bound to an *import specifier*, not to the
        // function declaration, so asking the name gave "not a declared
        // function" and sent every cross-module call down the closure path --
        // where it was refused for reading a name from an enclosing scope.
        let declaration = self.direct_callee(target.callee, callee_node);
        if declaration.is_none()
            && self.is_function_typed(callee_node)
            && !self.names_a_declared_function(callee_node)
        {
            return self.lower_closure_call(id, callee_node, &arguments);
        }

        // The name the function is *emitted* under, which is the one on its
        // declaration. `import { scale as by }` puts `by` at the call site and
        // `scale` on the function, and a call has to name the function.
        let name = declaration
            .and_then(|declaration| {
                self.qualified
                    .get(&declaration)
                    .cloned()
                    .or_else(|| self.declared_name(declaration))
            })
            .or_else(|| self.node(callee_node).text.clone())
            .ok_or_else(|| self.unsupported(callee_node, "a computed callee"))?;
        // And the copy made for *this* call's instantiation, where the callee
        // is generic. There is one copy per distinct substitution and the
        // suffix is what tells them apart.
        let name = format!(
            "{name}{}",
            self.generic_calls.get(&id).map_or("", String::as_str)
        );

        // A callee inside the compiled program becomes a static call; one outside
        // it is still typed exactly, and the definition comes from elsewhere.
        //
        // "Inside" means *defined* here, not merely declared here. A
        // `declare function` has a declaration node and no body, and calling it
        // directly would name a function this program never emits.
        let defined = target
            .callee
            .is_some_and(|declaration| self.has_a_body(declaration));

        // A callee with no declaration in the compiled set at all. A `declare
        // function` the *program* wrote is an FFI import and stays external --
        // the linker or the platform supplies it, which is the whole point of
        // writing one. A name declared only by `lib.d.ts` is not that: it is a
        // builtin this compiler has not implemented, and emitting a call to it
        // produced a prototype, a link error, and no diagnostic at all.
        //
        // `isNaN(x)` compiled to `call.extern isNaN` and failed at link time
        // with no source location. It was my own regression from making
        // `declare function` external, and the two are told apart by whether
        // the checker resolved the call to a declaration node: the decoded file
        // set is the program's own sources, so a `lib.d.ts` declaration has
        // none.
        // Some of those `lib.d.ts` names are builtins this compiler *does*
        // provide, and they are taken before the refusal below.
        if target.callee.is_none()
            && let Some(provided) = self.lower_provided_builtin(id, &name, &arguments)
        {
            return provided;
        }
        if target.callee.is_none() {
            return Err(self.unsupported(
                id,
                &format!("`{name}`, a builtin this compiler does not provide"),
            ));
        }
        let callee = if defined {
            Callee::Direct(name)
        } else {
            Callee::External(name)
        };

        let args = self.lower_arguments(id, &arguments)?;

        // Calling a generator produces its frame, not the `Generator<T, ...>`
        // the checker says: that interface describes an object this compiler
        // does not build, and the frame is what the call actually hands back.
        // The reservation is read from the declaration, which is the same
        // authority `begin_generator` used.
        let ty = declaration
            .and_then(|declaration| self.generators.get(&declaration).copied())
            .map(|index| HirType::Managed(ManagedType::Object(super::generator_frame(index))))
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The declaration a call resolves to, when it is a plain function.
    ///
    /// Not ahead of a local binding, which is the guard
    /// `names_a_declared_function` makes and this must not lose: a name bound to
    /// a value in this frame *is* that value, whatever the checker resolved the
    /// name to elsewhere, and calling it is a dispatch rather than a static
    /// call.
    fn direct_callee(&self, resolved: Option<NodeId>, callee_node: NodeId) -> Option<NodeId> {
        let locally_bound = self
            .node(callee_node)
            .symbol
            .is_some_and(|symbol| self.bindings.contains_key(&symbol.0));
        resolved.filter(|declaration| {
            !locally_bound && self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
        })
    }

    /// The name a declaration declares.
    fn declared_name(&self, declaration: NodeId) -> Option<String> {
        self.children(declaration)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(child).text.clone())
    }

    /// The name of the class a member is declared on.
    ///
    /// By walking to the declaration's parent rather than reading the name
    /// before the dot: `import { Body as B }` puts `B` at the call site and
    /// `Body` on the function, and the two have to agree.
    fn declaring_class_name(&self, member: NodeId) -> Option<String> {
        let class = self.ancestor(member, syntax::CLASS_DECLARATION)?;
        self.children(class)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(child).text.clone())
    }

    /// `Class.member(...)`: an ordinary direct call to a function with no
    /// receiver.
    fn lower_static_call(
        &mut self,
        id: NodeId,
        class_name: &str,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // The *last* child. `Box.#check` is an object beside a name, and
        // looking for the first identifier found `Box` -- which named the
        // method after its class for every static call whose receiver is a
        // plain name, and found nothing at all when the name was `#check`.
        // The declaration's own name -- `member` is the `MethodDeclaration`
        // here, not a property access. Through the shared resolver, because
        // `#check` is a name and the private-identifier kind is not the
        // identifier kind: reading only identifiers left a private static
        // method nameless, and the members declared after it in the same class
        // were then neither lowered nor refused.
        let member_name = self.member_name(member).ok_or_else(|| {
            self.unsupported(member, "a static method whose name the program computes")
        })?;

        let args = self.lower_arguments(id, arguments)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        self.materialize(id, &ty)?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{class_name}.{member_name}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `f(x)` where `f` holds a closure.
    ///
    /// The receiver goes first, exactly as it does for a method, and the slot
    /// is the one every closure's `call` occupies. What makes the single slot
    /// safe is that the call spells its own signature: two closure types
    /// sharing an index are never confused, because neither call site consults
    /// the other's types.
    fn lower_closure_call(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(callee_node)?;
        self.call_through_closure(id, callee_node, receiver, arguments)
    }

    /// The call itself, given the closure value already in hand.
    ///
    /// Separate because there are two ways to come by one. `f(x)` lowers the
    /// name; `o.f(x)` where `f` is a *field* has already lowered `o` and loaded
    /// the field out of it, and lowering the property access again would
    /// evaluate the receiver twice.
    fn call_through_closure(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        receiver: ValueId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Object(receiver_ty)) =
            self.values[receiver.0 as usize].ty
        else {
            return Err(self.unsupported(callee_node, "a call of something that is not a function"));
        };
        // A closure class is final: nothing extends it, and only the arrow it
        // was made for fills its slot. So where the receiver's static type *is*
        // the closure class rather than the signature, which body runs is known
        // here, and the call is a direct one.
        //
        // This is not a nicety, because clang cannot recover it: to fold the
        // table load it would have to prove the callee does not write the
        // receiver's descriptor, and it cannot know the callee without folding
        // the load. What is left is an indirect call per iteration where there
        // should be an inlined multiply.
        let callee = if receiver_ty.0 >= super::SYNTHETIC_TYPE_FLOOR {
            Callee::Direct(closure_names((u32::MAX - receiver_ty.0) as usize).1)
        } else if let Some(slot) = self.hierarchy.closure_slot {
            Callee::Closure { slot }
        } else {
            return Err(self.unsupported(
                id,
                "a call of a function value in a program with no closures",
            ));
        };

        let mut args = vec![receiver];
        args.extend(self.lower_arguments(id, arguments)?);
        // The callee's return where it has one. See `returned_by`: for `f?.(x)`
        // the expression's type carries an `undefined` the call cannot produce.
        let ty = self
            .returned_by(receiver)
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The `Math` or `Number` member a callee names, if it names one.
    ///
    /// Recognized by shape rather than by symbol identity, which is a
    /// simplification: a program that shadowed the global `Math` with its own
    /// object would be mis-read. It cannot be shadowed by a *function* in the
    /// compiled program — that call would resolve to a direct target and never
    /// reach here — so the remaining case is an import named `Math` with
    /// matching method names.
    ///
    /// `docs/any-unknown.md` describes the principled version: profiles that
    /// associate trusted *declaration identities* with a closed set of
    /// compiler-owned semantics, so the core never matches on a name at all.
    /// This is the shape that becomes.
    fn intrinsic_of(&self, callee: NodeId) -> Option<Intrinsic> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let children = self.children(callee);
        let object = *children.first()?;
        let member = *children.last()?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let member = self.node(member).text.as_deref()?;
        match self.node(object).text.as_deref()? {
            "Math" => math_member(member),
            // `Number`'s four predicates. The first two are `Number` only in
            // spelling: over a `number` they are exactly the global `isNaN`
            // and `isFinite`, because the whole difference the `Number.` forms
            // exist for is what they do to a value that is *not* a number,
            // and one cannot reach here.
            "Number" => Some(match member {
                "isNaN" => Intrinsic::NotANumber,
                "isFinite" => Intrinsic::UnaryCall("nts_is_finite"),
                "isInteger" => Intrinsic::UnaryCall("nts_is_integer"),
                "isSafeInteger" => Intrinsic::UnaryCall("nts_is_safe_integer"),
                _ => return None,
            }),
            // Two functions rather than two names for one. `fromCharCode`
            // takes a UTF-16 code *unit* through `ToUint16` and always yields
            // one of them; `fromCodePoint` takes a code *point* and yields a
            // surrogate pair above 0xFFFF.
            "String" => Some(match member {
                "fromCharCode" => Intrinsic::UnaryCall("nts_string_from_char_code"),
                "fromCodePoint" => Intrinsic::UnaryCall("nts_string_from_code_point"),
                _ => return None,
            }),
            _ => None,
        }
    }

    /// A global function this compiler implements, if this call names one.
    ///
    /// `None` means the name is not one of them, which is a different answer
    /// from `Some(Err(..))`: the second is a builtin that is provided and was
    /// given something it cannot take, and it says so rather than falling
    /// through to "a builtin this compiler does not provide".
    /// `setTimeout(fn, ms)` and `setInterval(fn, ms)`.
    ///
    /// A *capability* over the host's `post_delayed` rather than part of the
    /// host contract, so both hosts have it and neither implements it -- which
    /// is what makes a `setTimeout` ordering testable against node, because the
    /// deterministic host runs the same code the libuv one does.
    ///
    /// The callback is a closure, and a closure in this compiler is an object
    /// with a method table, so the runtime is handed the object *and* the slot
    /// its call occupies. One slot serves every closure: what makes that safe
    /// is that the caller spells the signature, and a timer callback has one.
    fn lower_set_timer(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        repeating: bool,
    ) -> Result<ValueId, Diagnostic> {
        let (callback, delay) = match arguments {
            [callback] => (*callback, None),
            [callback, delay] => (*callback, Some(*delay)),
            // `setTimeout(fn, ms, a, b)` forwards the extra arguments to the
            // callback. That is a different shape rather than a longer one:
            // the callback's signature stops being "takes nothing", and the
            // arguments have to outlive the call in something.
            _ => return Err(self.unsupported(id, "a timer that forwards arguments")),
        };
        // `@types/node` types this `NodeJS.Timeout`, an object with `unref`.
        // The default library says `number`, which is what the runtime returns,
        // and guessing across that difference would hand a program an object it
        // could not use.
        let returns = self.type_of(id).unwrap_or(HirType::Void);
        if !matches!(returns, HirType::Float { .. } | HirType::Int { .. }) {
            return Err(self.unsupported(id, "a timer whose id is not a number"));
        }
        let closure = self.lower_expression(callback)?;
        if !matches!(
            self.values[closure.0 as usize].ty,
            HirType::Managed(ManagedType::Object(_))
        ) {
            return Err(self.unsupported(id, "a timer callback that is not a function"));
        }
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(self.unsupported(id, "a timer in a program with no closures"));
        };
        let origin = self.origin(id);
        let slot = self.push(
            OpKind::ConstFloat(f64::from(slot)),
            HirType::NUMBER,
            origin.clone(),
        );
        let delay = match delay {
            Some(node) => self.lower_expression(node)?,
            // `setTimeout(fn)` is `setTimeout(fn, 0)`.
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        let repeating = self.push(OpKind::ConstBool(repeating), HirType::Bool, origin.clone());
        Ok(self.runtime_call(
            "nts_set_timeout",
            vec![closure, slot, delay, repeating],
            returns,
            origin,
        ))
    }

    /// `clearTimeout(id)` and `clearInterval(id)`, which are one operation.
    ///
    /// Clearing a timer that already fired is legal and does nothing, so this
    /// needs no test for whether the id is live -- the host's table knows, and
    /// it is the only thing that can.
    fn lower_clear_timer(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [timer] = arguments else {
            // `clearTimeout()` with no argument is legal and does nothing, but
            // it is also never what a program means.
            return Err(self.unsupported(id, "a `clearTimeout` with no timer"));
        };
        let timer = self.lower_expression(*timer)?;
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_clear_timeout", vec![timer], HirType::Void, origin))
    }

    fn lower_provided_builtin(
        &mut self,
        id: NodeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        // `isNaN` and `isFinite`. Over a `number` these are exactly the
        // `Number.` forms -- the whole difference between the two pairs is what
        // they do to a value that is not a number, and one cannot reach here.
        if let Some(intrinsic) = global_predicate(name) {
            return Some(self.lower_intrinsic(id, intrinsic, arguments));
        }
        // The `timers` capability, which takes two arguments and so has to be
        // read before the single-argument builtins below.
        match name {
            "setTimeout" => return Some(self.lower_set_timer(id, arguments, false)),
            "setInterval" => return Some(self.lower_set_timer(id, arguments, true)),
            "clearTimeout" | "clearInterval" => {
                return Some(self.lower_clear_timer(id, arguments));
            }
            _ => {}
        }
        let [argument] = arguments else {
            return None;
        };
        // `String(x)` is `ToString`, which is what `s + n` already needs. For a
        // number only -- `String(unknown)` is a general renderer and
        // `String({})` walks a prototype chain.
        if name == "String" {
            return Some(
                self.lower_expression(*argument)
                    .and_then(|value| self.as_string(*argument, value)),
            );
        }
        // `Boolean(x)` is `ToBoolean`, and `ToBoolean` is the test `if (x)`
        // already performs -- so it is that operation rather than a conversion
        // of its own, and it inherits whatever the truthiness rule already
        // knows about each representation. Nineteen sites in the profile, every
        // one of them turning an optional or an erased value into a flag to
        // store.
        if name == "Boolean" {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            return Some(Ok(self.truthy(id, value)));
        }
        // `Number(x)`, the mirror of it and a much smaller job: the identity on
        // a number, and `ToNumber` on a boolean, which the specification gives
        // as 1 and 0. On a string it is a parse -- the same parse `parseFloat`
        // needs, and neither exists yet -- and on anything else it is `valueOf`
        // off a prototype chain.
        if name == "Number" {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            let origin = self.origin(id);
            return Some(match self.values[value.0 as usize].ty {
                HirType::Float { .. } | HirType::Int { .. } => Ok(value),
                // One conversion, two reasons. A boolean is `ToNumber`, which
                // the specification gives as 1 and 0. A `bigint` rounds to the
                // nearest double -- lossy above 2^53 in node and here alike,
                // deliberately, because that is what asking for a `number`
                // means. C's own conversion is both of those.
                HirType::Bool | HirType::BigInt => {
                    Ok(self.push(OpKind::Convert(value), HirType::NUMBER, origin))
                }
                _ => Err(self.unsupported(id, "a conversion to number from this type")),
            });
        }
        // `BigInt(x)`, the mirror of `Number(x)` and not quite its twin.
        //
        // The identity on a bigint, and `0n`/`1n` on a boolean, both of which a
        // C cast already is. On a *number* it is a conversion with a
        // precondition: the specification throws a `RangeError` when the value
        // is not an integer, so `BigInt(1.5)` is not `1n` and a cast would be a
        // wrong answer rather than a lossy one. `nts_bigint_from_number` checks
        // and refuses, the way an index past the end of an array does.
        //
        // On a string it is a parse, which `parseInt` would need too and
        // neither has; on anything else it is `valueOf` off a prototype chain.
        // Both are refused by name -- 22 sites in the node profile said only
        // "a builtin this compiler does not provide" before this existed.
        if name == "BigInt" {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            let origin = self.origin(id);
            return Some(match self.values[value.0 as usize].ty {
                HirType::BigInt => Ok(value),
                HirType::Bool => Ok(self.push(OpKind::Convert(value), HirType::BigInt, origin)),
                HirType::Float { .. } | HirType::Int { .. } => Ok(self.runtime_call(
                    "nts_bigint_from_number",
                    vec![value],
                    HirType::BigInt,
                    origin,
                )),
                _ => Err(self.unsupported(id, "a conversion to bigint from this type")),
            });
        }
        None
    }

    /// A call into the C runtime.
    ///
    /// The prototype the backend emits comes from the header, not from this
    /// call site, so an argument that specialization narrowed to an integer
    /// converts at the call the way C converts any argument to a declared
    /// parameter type. Nothing here has to pin its operands to `double`.
    fn runtime_call(
        &mut self,
        name: &str,
        args: Vec<ValueId>,
        ty: HirType,
        origin: Origin,
    ) -> ValueId {
        self.push(
            OpKind::Call {
                callee: Callee::External(name.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        )
    }

    /// ECMAScript's exponentiation, which `**`, `**=` and `Math.pow` all spell.
    ///
    /// A call rather than an operation, because it is **not** C's `pow`: the
    /// specification says a base of 1 or -1 with an infinite exponent is NaN,
    /// where C99 says 1. The runtime holds that difference in one place; see
    /// `nts_math_pow`.
    fn exponentiate(
        &mut self,
        id: NodeId,
        ty: HirType,
        base: ValueId,
        exponent: ValueId,
    ) -> ValueId {
        let origin = self.origin(id);
        if let OpKind::ConstFloat(power) = self.values[exponent.0 as usize].kind
            && let Some(folded) = self.fold_power(base, power, &ty, &origin)
        {
            return folded;
        }
        self.runtime_call("nts_math_pow", vec![base, exponent], ty, origin)
    }

    /// `x ** k` for a literal `k`, where the operations spell it exactly.
    ///
    /// Worth doing because `nts_math_pow` lives in the runtime's translation
    /// unit, so the C compiler cannot see through it the way it sees through
    /// `pow` -- `x ** 2` would cost a call where the C++ it is measured against
    /// costs a multiply. `pow(x, 2)` is one of the calls clang folds itself,
    /// and this compiler has to fold its own.
    ///
    /// Three exponents, and the boundary was found by measurement rather than
    /// by reasoning:
    ///
    /// - `x ** 3` is **not** `x * x * x`. `pow` rounds the cube once and three
    ///   multiplications round twice, and they differ: at `x = -828.3432249414309`
    ///   the two answers are `-568369773.2487181` and `-568369773.2487183`.
    ///   A pool of interesting values agreed on every one of them, which is
    ///   what makes the case worth writing down.
    /// - `x ** -1` is **not** `1 / x` in practice, even though it is in theory:
    ///   both are the correctly rounded reciprocal, and V8's `pow` is not
    ///   correctly rounded at `x = -2.126284657577152e-37`. The specification
    ///   allows that -- `pow` is implementation-approximated -- so the fold
    ///   would be righter than node and would still be a difference.
    /// - `x ** 0.5` is not `sqrt(x)`: they disagree on `-0`, where `pow` gives
    ///   `+0` and `sqrt` gives `-0`.
    ///
    /// What is left is exact. `x * x` is the correctly rounded square for every
    /// double including the infinities, the zeros and NaN; `x ** 1` is `x`; and
    /// `x ** 0` is `1` for every base, NaN included, which the specification
    /// says before it says anything else about the base.
    // The comparisons here are exact on purpose: the exponent is a literal, and
    // folding `x ** 1.9999999999999998` as though it were `x ** 2` would be a
    // wrong answer rather than an imprecise one. A margin is what this lint
    // exists to suggest and is exactly what must not happen.
    #[allow(clippy::float_cmp)]
    fn fold_power(
        &mut self,
        base: ValueId,
        power: f64,
        ty: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        if power == 0.0 {
            return Some(self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone()));
        }
        if power == 1.0 {
            return Some(base);
        }
        if power == 2.0 {
            return Some(self.push(
                OpKind::Binary {
                    op: BinOp::Mul,
                    lhs: base,
                    rhs: base,
                },
                ty.clone(),
                origin.clone(),
            ));
        }
        None
    }

    fn lower_intrinsic(
        &mut self,
        id: NodeId,
        intrinsic: Intrinsic,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a `Math` call of unrepresentable type"))?;
        let origin = self.origin(id);

        match (intrinsic, arguments) {
            (Intrinsic::Unary(op), [argument]) => {
                let operand = self.lower_expression(*argument)?;
                Ok(self.push(OpKind::Unary { op, operand }, ty, origin))
            }
            (Intrinsic::Binary(op), [left, right]) => {
                let lhs = self.lower_expression(*left)?;
                let rhs = self.lower_expression(*right)?;
                Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
            }
            (Intrinsic::NotANumber, [argument]) => {
                let operand = self.lower_expression(*argument)?;
                Ok(self.push(
                    OpKind::Binary {
                        op: BinOp::Ne,
                        lhs: operand,
                        rhs: operand,
                    },
                    ty,
                    origin,
                ))
            }
            (Intrinsic::UnaryCall(name), [argument]) => {
                let operand = self.lower_expression(*argument)?;
                Ok(self.runtime_call(name, vec![operand], ty, origin))
            }
            (Intrinsic::BinaryCall(name), [left, right]) => {
                let lhs = self.lower_expression(*left)?;
                let rhs = self.lower_expression(*right)?;
                Ok(self.runtime_call(name, vec![lhs, rhs], ty, origin))
            }
            // `String.fromCharCode` takes any number of code units and the
            // runtime offers one at a time, so the n-ary call is the fold.
            // Concatenation is associative and exact on strings, which is what
            // makes folding this one right where folding `Math.hypot` would
            // not be -- `sqrt(sqrt(a^2+b^2)^2+c^2)` is the same number only in
            // arithmetic that has no rounding.
            //
            // It is the shape real code uses, and refusing it stopped Node's
            // own UTF-8 decoder: a code point above the BMP is written
            // `fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff))`, which
            // is the surrogate pair, and there is no one-at-a-time spelling of
            // it that does not allocate the same two strings anyway.
            (Intrinsic::UnaryCall(name), [first, rest @ ..])
                if !rest.is_empty() && name == "nts_string_from_char_code" =>
            {
                let operand = self.lower_expression(*first)?;
                let mut folded = self.runtime_call(name, vec![operand], ty.clone(), origin.clone());
                for argument in rest {
                    let operand = self.lower_expression(*argument)?;
                    let unit = self.runtime_call(name, vec![operand], ty.clone(), origin.clone());
                    // The *call* spelling of concatenation, not `BinOp::Concat`.
                    // The emitter renders both as `nts_concat`, but only a call
                    // carries `frame`: `hir::frame_capacity` reads a call's
                    // callee and a binary operator has nowhere to put storage.
                    //
                    // Each side here is exactly one code unit, so the pair is
                    // two and fits a frame slot -- which `flow::string_span`
                    // can now say, because it knows what `fromCharCode` returns.
                    // As a binop this was a heap allocation: three of the eight
                    // `node-utf8` makes per decoded string, for its three emoji.
                    folded = self.runtime_call(
                        "nts_concat",
                        vec![folded, unit],
                        ty.clone(),
                        origin.clone(),
                    );
                }
                Ok(folded)
            }
            // `Math.min()` is `Infinity` and `Math.min(a, b, c)` folds, but both
            // are shapes this lowering does not accept yet, and quietly
            // producing the two-argument answer for a three-argument call would
            // be wrong in a way nothing downstream could detect.
            _ => Err(self.unsupported(id, "an intrinsic call with this many arguments")),
        }
    }

    /// A method on a string.
    ///
    /// Every one of these is a runtime call, because a string has no layout to
    /// resolve a member against and no class the program declares. The set is
    /// deliberately the operations that are *exactly* expressible over UTF-16
    /// code units, which is what a `NtsString` holds -- so each is the same
    /// function JavaScript specifies rather than an approximation of it.
    ///
    /// `toUpperCase`, `toLowerCase` and `trim` are absent for that reason. All
    /// three are defined over Unicode, not over ASCII, and an ASCII version
    /// would be right for most inputs and quietly wrong for the rest. Refusing
    /// beats that.
    fn lower_string_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .node(member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // (runtime function, how many arguments after the receiver, result)
        let string = HirType::Managed(ManagedType::String);
        // `charCodeAt` is an operation rather than a call: as a call its index
        // would have to match a C signature, which pins the loop counter that
        // produces it to a `double` and makes every step downstream floating
        // point.
        if name == "charCodeAt"
            && let [argument] = arguments
        {
            let index = self.lower_expression(*argument)?;
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::StringUnitAt {
                    string: receiver,
                    index,
                    checked: true,
                },
                HirType::NUMBER,
                origin,
            ));
        }

        let (helper, arity, ty) = match name.as_str() {
            "codePointAt" => ("nts_str_code_point_at", 1, HirType::NUMBER),
            "indexOf" if arguments.len() == 2 => {
                ("nts_str_index_of_from", 2, HirType::NUMBER)
            }
            "indexOf" => ("nts_str_index_of", 1, HirType::NUMBER),
            "lastIndexOf" => ("nts_str_last_index_of", 1, HirType::NUMBER),
            "includes" => ("nts_str_includes", 1, HirType::Bool),
            "startsWith" => ("nts_str_starts_with", 1, HirType::Bool),
            "endsWith" => ("nts_str_ends_with", 1, HirType::Bool),
            "charAt" => ("nts_str_char_at", 1, string.clone()),
            "repeat" => ("nts_str_repeat", 1, string.clone()),
            "slice" => ("nts_str_slice", 2, string.clone()),
            "substring" => ("nts_str_substring", 2, string.clone()),
            "concat" => ("nts_concat", 1, string.clone()),
            // `trim` and its two halves. The whitespace set is the
            // specification's rather than `isspace`'s -- it includes NBSP and
            // the byte order mark -- and lives in the runtime, where it can be
            // read as a list.
            "trim" => ("nts_str_trim", 0, string.clone()),
            // `padStart(n)` pads with a single space, which the filler below
            // supplies: every other omitted argument here is "to the end" and
            // is a number, and this one is a string.
            "padStart" => ("nts_str_pad_start", 2, string.clone()),
            "padEnd" => ("nts_str_pad_end", 2, string.clone()),
            // The only two members that are about surrogates rather than
            // characters. A one-byte string cannot hold a lone one, which is
            // most strings and the whole of the answer for them.
            "isWellFormed" => ("nts_str_is_well_formed", 0, HirType::Bool),
            "toWellFormed" => ("nts_str_to_well_formed", 0, string.clone()),

            // Case conversion, which is a table rather than an algorithm -- see
            // `runtime/c/quickjs`. The locale forms are deliberately *not*
            // aliased onto these: `toLocaleUpperCase` of `i` in Turkish is
            // `\u0130` and not `I`, so answering it with the
            // locale-independent mapping would be wrong rather than
            // approximate, and a wrong answer is worse than a named refusal.
            "toLowerCase" => ("nts_str_to_lower_case", 0, string.clone()),
            "toUpperCase" => ("nts_str_to_upper_case", 0, string.clone()),

            "trimStart" => ("nts_str_trim_start", 0, string.clone()),
            "trimEnd" => ("nts_str_trim_end", 0, string.clone()),
            // `split`, with a *string* separator. A regular expression is a
            // different feature and is refused below by falling through, which
            // names it rather than splitting on its source text.
            "split" => (
                "nts_str_split",
                1,
                HirType::Managed(ManagedType::Array(Box::new(string))),
            ),
            // `replace` takes the first match, `replaceAll` every one. The
            // difference is the whole of it, so they share a runtime function
            // and differ by which entry point calls it.
            //
            // Both expand `$` in the replacement, which is not optional: node
            // answers `"a-b".replace("-", "$&")` with `"a-b"`, not with
            // `"a$&b"`. A pattern that is a regular expression is refused just
            // below rather than here, because the member exists for it and it
            // is the *argument* that is not something this can do.
            "replace" => ("nts_str_replace", 2, string.clone()),
            "replaceAll" => ("nts_str_replace_all", 2, string.clone()),
            // Named, because twenty-eight instances of "this string method"
            // in the node profile is a bucket and not a work item.
            other => {
                return Err(self.unsupported(
                    member,
                    &format!("`{other}`, which a string does not have here"),
                ));
            }
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let origin = self.origin(id);

        // `padStart(n)` and `padEnd(n)` pad with a single space. The filler
        // below gives an omitted trailing argument the "to the end" infinity
        // every other member here wants, and a string is not that.
        if matches!(helper, "nts_str_pad_start" | "nts_str_pad_end") && args.len() == 2 {
            let space = self.push(
                OpKind::ConstString(" ".to_owned()),
                HirType::Managed(ManagedType::String),
                origin.clone(),
            );
            args.push(space);
        }

        // An omitted trailing argument becomes the default the specification
        // gives it, which for every two-argument member here is "to the end".
        // Passing it explicitly means the runtime has one signature rather than
        // two, and the default is written down once.
        while args.len() < arity + 1 {
            let end = self.push(
                OpKind::ConstFloat(f64::INFINITY),
                HirType::NUMBER,
                origin.clone(),
            );
            args.push(end);
        }
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "a string method with this many arguments"));
        }

        // A regular expression is a pattern `String.prototype.replace` accepts
        // and this does not. It has to be named and refused *here*: everything
        // below spells a call handing a `NtsString *` to the runtime, so a
        // `RegExp` arriving at it is a wrong answer rather than a type error.
        if matches!(helper, "nts_str_replace" | "nts_str_replace_all")
            && args[1..].iter().any(|value| {
                self.values[value.0 as usize].ty != HirType::Managed(ManagedType::String)
            })
        {
            return Err(self.unsupported(id, "`replace` with a pattern that is not a string"));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A method on an array.
    ///
    /// The same shape as a string's: a runtime call, because an array has no
    /// layout to resolve a member against. The set is what can be done *without
    /// growing* the array and without a callback -- `push`, `splice` and the
    /// rest change the length, which the current representation cannot do
    /// because the elements are inline and growing would move the object;
    /// `map`, `filter` and `forEach` take a function, which needs closures.
    /// Both are real extensions rather than oversights.
    ///
    /// Elements must be numbers. A reference array's `indexOf` compares by
    /// identity and its `slice` has to retain what it copies, and neither is
    /// something to guess at.
    fn lower_array_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .node(member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // The runtime's array helpers read the block at one width:
        // `nts_array_index_of` takes a `const double *`. A narrower element
        // means a typed array, and handing one to a helper compiled for doubles
        // makes it read pairs of elements as a single value -- which is not a
        // wrong answer so much as unrelated memory.
        //
        // `hir::elements` refuses to *narrow* an array that reaches a helper
        // for exactly this reason, having been caught by a benchmark that
        // returned -512 for 4864. This is the same rule from the other side:
        // an array that arrived narrow does not reach one.
        if !matches!(
            element,
            HirType::Float { bits: 64 } | HirType::Managed(_) | HirType::Bool
        ) {
            return Err(self.unsupported(id, &format!("`{name}` on a typed array")));
        }

        // `xs.forEach(v => ...)` is a loop written as a call, and so are `map`
        // and `reduce`. All three are compiled as the loop. See
        // [`Self::lower_iteration`].
        if let Some(kind) = iteration_method(&name) {
            let (callback, seed) = match (kind, arguments) {
                (Iteration::Reduce, [callback, seed]) => (*callback, Some(*seed)),
                (
                    Iteration::ForEach
                    | Iteration::Map
                    | Iteration::Any
                    | Iteration::All
                    | Iteration::FindIndex
                    | Iteration::Filter
                    | Iteration::Find,
                    [callback],
                ) => (*callback, None),
                // `reduce` with no initial value starts from the first element
                // and throws on an empty array, which is a different lowering
                // and a different failure. Refused rather than assumed.
                _ => {
                    return Err(
                        self.unsupported(id, &format!("a `{name}` call with this many arguments"))
                    );
                }
            };
            if self.kind_of(callback) != Some(syntax::ARROW_FUNCTION) {
                // `xs.map(f)` where `f` is a name is a genuine dispatch: which
                // body runs is not written at the call. Monomorphization is the
                // answer to that one, and it is a different lowering rather
                // than a harder version of this one -- so it says which.
                return Err(self.unsupported(
                    id,
                    &format!("a `{name}` whose callback is not an arrow written at the call"),
                ));
            }
            let seed = match seed {
                Some(seed) => Some(self.lower_expression(seed)?),
                None => None,
            };
            return self.lower_iteration(id, receiver, element, callback, kind, seed);
        }

        // `fill` is the one method whose element type does not have to be a
        // number: it writes a value it was given rather than comparing or
        // arithmetic-ing one, so the only thing that changes is how wide the
        // write is. `new Array(n).fill(true)` is how three of the Are We Fast
        // Yet benchmarks make their working set.
        if name == "fill" && !matches!(element, HirType::Float { .. } | HirType::Int { .. }) {
            return self.lower_wide_fill(id, receiver, element, arguments);
        }
        // An array of references, where the element is a pointer rather than a
        // double. Every one of the twenty-two profile sites that wanted a
        // method on a non-numeric array wanted this -- strings, objects,
        // closures, an `Int32Array` -- and not one wanted an array of
        // booleans, which is why there is no third family.
        //
        // `pop` and `at` answer the element type directly here rather than an
        // erased value: `T | undefined` for a reference *is* the null pointer.
        if let HirType::Managed(managed) = element.clone() {
            return self
                .lower_reference_array_method(id, member, &name, receiver, &managed, arguments);
        }
        if !matches!(element, HirType::Float { .. } | HirType::Int { .. }) {
            return Err(self.unsupported(member, "an array method on a non-numeric array"));
        }
        let array = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));

        // `pop` and `at` answer `undefined` where there is nothing there, and
        // the checker says so: both are typed `T | undefined`, which for a
        // number is an *erased* value. They answered NaN instead, on the
        // written claim that "undefined is NaN for a number" -- which is not
        // true of anything the language does with it. `String([].pop())` is
        // "undefined" in node and was "NaN" here; `?? 0` takes the one and not
        // the other. Where a caller has narrowed the result back to a number
        // the double-returning helper is still the one, and costs nothing.
        let absent_result = self.type_of(id) == Some(HirType::Erased);

        // `push` returns the new length, which is what the expression is worth
        // in JavaScript, and takes as many elements as it was given.
        if name == "push" {
            return self.lower_pushes(id, "nts_array_push", receiver, arguments);
        }
        if name == "unshift" {
            return self.lower_pushes(id, "nts_array_unshift", receiver, arguments);
        }

        let Some((helper, arity, ty)) = numeric_array_method(&name, absent_result, &array)
        else {
            return Err(self.unsupported(member, "this array method"));
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let origin = self.origin(id);
        while args.len() < arity + 1 {
            let end = self.push(
                OpKind::ConstFloat(f64::INFINITY),
                HirType::NUMBER,
                origin.clone(),
            );
            args.push(end);
        }
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "an array method with this many arguments"));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `push` with more than one argument, which appends each in turn.
    ///
    /// `headers.push(name, value)` is how a flat key-value list is built and it
    /// appears twice in the node profile. The runtime helper takes one element,
    /// which is the right shape -- appending two is appending one twice -- so
    /// this is a loop here rather than a variadic there. The value of the
    /// expression is the length after the last, which is what the last call
    /// returns.
    fn lower_pushes(
        &mut self,
        id: NodeId,
        helper: &str,
        receiver: ValueId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let mut length = None;
        for argument in arguments {
            let value = self.lower_expression(*argument)?;
            length = Some(self.push(
                OpKind::Call {
                    callee: Callee::External(helper.to_owned()),
                    args: vec![receiver, value],
                    frame: None,
                },
                HirType::NUMBER,
                origin.clone(),
            ));
        }
        length.map_or_else(
            || {
                // `xs.push()` appends nothing and is the current length.
                Ok(self.push(OpKind::Length(receiver), HirType::NUMBER, origin))
            },
            Ok,
        )
    }

    /// An array method where the elements are references.
    ///
    /// The same shape as the numeric family and a different set of helpers,
    /// because three of the questions change with the element:
    ///
    /// - `pop` and `at` answer `T | undefined`, which for a reference is the
    ///   null pointer -- so they return the element type and need no tag,
    ///   where the numeric pair had to return an erased value.
    /// - `indexOf` and `includes` compare by `===`, and `===` on a string is
    ///   *value* equality. `["a"].indexOf("a")` is 0 across two separately
    ///   built strings, so a shared identity comparison answers -1 for exactly
    ///   the case a string array is written for.
    /// - `slice` retains each element it copies, and `push` retains what it is
    ///   given. `pop` retains nothing: the array is handing over its own count
    ///   with the element.
    fn lower_reference_array_method(
        &mut self,
        id: NodeId,
        member: NodeId,
        name: &str,
        receiver: ValueId,
        element: &ManagedType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let of_element = HirType::Managed(element.clone());
        let array = HirType::Managed(ManagedType::Array(Box::new(of_element.clone())));
        let text = matches!(element, ManagedType::String);
        if name == "push" {
            return self.lower_pushes(id, "nts_array_push_ref", receiver, arguments);
        }
        if name == "unshift" {
            return self.lower_pushes(id, "nts_array_unshift_ref", receiver, arguments);
        }
        // `join`, whose separator defaults to a comma rather than to the
        // infinity the arity filling below supplies. Only on strings: every
        // other element needs a conversion per element, which is the question
        // `String()` on an erased value answers and not this one.
        if name == "join" && text {
            let origin = self.origin(id);
            let separator = match arguments.first() {
                Some(argument) => self.lower_expression(*argument)?,
                None => self.push(
                    OpKind::ConstString(",".to_owned()),
                    HirType::Managed(ManagedType::String),
                    origin.clone(),
                ),
            };
            return Ok(self.push(
                OpKind::Call {
                    callee: Callee::External("nts_array_join_str".to_owned()),
                    args: vec![receiver, separator],
                    frame: None,
                },
                HirType::Managed(ManagedType::String),
                origin,
            ));
        }
        let (helper, arity, ty) = match name {
            "pop" => ("nts_array_pop_ref", 0, of_element),
            "shift" => ("nts_array_shift_ref", 0, of_element),
            "at" => ("nts_array_at_ref", 1, of_element),
            "indexOf" if text => ("nts_array_index_of_str", 1, HirType::NUMBER),
            "indexOf" => ("nts_array_index_of_ref", 1, HirType::NUMBER),
            "includes" if text => ("nts_array_includes_str", 1, HirType::Bool),
            "includes" => ("nts_array_includes_ref", 1, HirType::Bool),
            "concat" => ("nts_array_concat_ref", 1, array.clone()),
            "slice" => ("nts_array_slice_ref", 2, array.clone()),
            "splice" => ("nts_array_splice_ref", 2, array),
            "reverse" => ("nts_array_reverse_ref", 0, array),
            _ => {
                return Err(
                    self.unsupported(member, &format!("`{name}` on an array of references"))
                );
            }
        };
        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let origin = self.origin(id);
        while args.len() < arity + 1 {
            let end = self.push(
                OpKind::ConstFloat(f64::INFINITY),
                HirType::NUMBER,
                origin.clone(),
            );
            args.push(end);
        }
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "an array method with this many arguments"));
        }
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `new Map()` and `new Set()`.
    ///
    /// The table is one runtime struct, so what the constructor carries is
    /// which hash and comparison to build it with -- decided here, from the
    /// static key type, and never asked again.
    fn lower_new_table(
        &mut self,
        id: NodeId,
        ty: &HirType,
        key: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let is_a_map = matches!(ty, HirType::Managed(ManagedType::Map(_, _)));
        let what = if is_a_map { "Map" } else { "Set" };
        // An argument is an initializer -- `new Map([[k, v]])` or
        // `new Set(xs)` -- which is iteration, and the protocol that would serve
        // it does not exist. Refused rather than dropped: a `new Set(existing)`
        // that silently produced an empty one is the kind of wrong that reads as
        // a logic bug in the caller.
        if let Some(argument) = self.arguments_of(id).first() {
            return Err(self.unsupported(
                *argument,
                &format!("a `new {what}` with contents, which needs the iteration protocol"),
            ));
        }
        let origin = self.origin(id);
        let kind = self.push(
            OpKind::ConstFloat(f64::from(key_kind_of(key))),
            HirType::NUMBER,
            origin.clone(),
        );
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(
                    if is_a_map {
                        "nts_map_new"
                    } else {
                        "nts_set_new"
                    }
                    .to_owned(),
                ),
                args: vec![kind],
                frame: None,
            },
            ty.clone(),
            origin,
        ))
    }

    /// A method on a `Map` or a `Set`.
    ///
    /// Keys and values cross as `NtsValue`s, which is what the table stores, so
    /// each one is erased at the call. That is a tag write beside a payload the
    /// caller already had -- and for `get` there is nothing to undo on the way
    /// back, because `V | undefined` *is* an erased value and the slot is
    /// returned whole.
    ///
    /// The iterating half -- `keys`, `values`, `entries`, `forEach` -- is
    /// absent, and refused by name rather than by silence: each needs the
    /// iteration protocol, which does not exist yet.
    fn lower_table_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        table: &HirType,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(name) = self.literal_name(member) else {
            return Err(self.unsupported(member, "a table method whose name the program computes"));
        };
        let is_a_map = matches!(table, HirType::Managed(ManagedType::Map(_, _)));
        let what = if is_a_map { "Map" } else { "Set" };

        if name == "forEach"
            && let [callback] = arguments
            && matches!(
                self.kind_of(*callback),
                Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
            )
        {
            return self.lower_table_for_each(id, receiver, table, *callback);
        }
        if matches!(name.as_str(), "keys" | "values" | "entries" | "forEach") {
            return Err(self.unsupported(
                member,
                &format!("`{what}#{name}`, which needs the iteration protocol"),
            ));
        }

        // (runtime function, arguments after the receiver, result)
        let (helper, arity, ty) = match (name.as_str(), is_a_map) {
            ("get", true) => ("nts_map_get", 1, HirType::Erased),
            ("set", true) => ("nts_map_set", 2, table.clone()),
            ("add", false) => ("nts_set_add", 1, table.clone()),
            ("has", _) => ("nts_map_has", 1, HirType::Bool),
            ("delete", _) => ("nts_map_delete", 1, HirType::Bool),
            ("clear", _) => ("nts_map_clear", 0, HirType::Void),
            _ => {
                return Err(self.unsupported(
                    member,
                    &format!("`{what}#{name}`, which this table has not"),
                ));
            }
        };
        if arguments.len() != arity {
            return Err(self.unsupported(
                id,
                &format!("`{what}#{name}` with {} argument(s)", arguments.len()),
            ));
        }

        let origin = self.origin(id);
        let mut args = vec![receiver];
        for argument in arguments {
            let value = self.lower_expression(*argument)?;
            args.push(self.erased_for_table(value, &origin));
        }
        let call = self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        );
        // A `get` whose result the checker has already narrowed -- through an
        // assertion, or a guard -- unerases here rather than staying erased for
        // the rest of the function.
        if helper == "nts_map_get" {
            return self.narrowed(id, call);
        }
        Ok(call)
    }

    /// A value at the width the table stores, which is erased.
    ///
    /// Already-erased values pass through: erasing one twice would build a
    /// value whose payload is a value.
    fn erased_for_table(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        if self.values[value.0 as usize].ty == HirType::Erased {
            return value;
        }
        self.push(OpKind::Erase { value }, HirType::Erased, origin.clone())
    }

    /// A method call on an object, once the receiver is lowered.
    ///
    /// Two questions, and they are different. Which class *declares* the method
    /// is not always the receiver's -- `new Square(n).describe()` calls
    /// `Shape#describe` when only `Shape` declares one. And whether the call is
    /// static is decided by whether anything *below* the receiver's type
    /// overrides it, which the compiler can answer because TypeScript closes the
    /// hierarchy.
    ///
    /// So a call on a `Square` is static even where the same method on a `Shape`
    /// dispatches: nothing below `Square` overrides anything.
    /// `xs.fill(v)` where the elements are not numbers.
    ///
    /// A boolean is a byte and a reference is a pointer, so each has its own
    /// entry point rather than one taking a width -- the compiler knows the
    /// element type, and a runtime that had to be told it would be told it
    /// wrongly one day. The reference one counts what it stores.
    fn lower_wide_fill(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let helper = match element {
            HirType::Bool => "nts_array_fill_bool",
            HirType::Managed(_) => "nts_array_fill_ref",
            _ => return Err(self.unsupported(id, "a `fill` on an array of this element type")),
        };
        let [value] = arguments else {
            return Err(self.unsupported(id, "a `fill` with a range on this array"));
        };
        let value = self.lower_expecting(*value, element)?;
        let origin = self.origin(id);
        let ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args: vec![receiver, value],
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// An array method whose callback is an arrow written at the call site.
    ///
    /// # Why a desugaring rather than a call
    ///
    /// Compiled as a closure it would allocate an object, pass it to a runtime
    /// helper, and dispatch through a slot once per element. Every one of those
    /// is machinery for a question the source has already answered: which body
    /// runs is written right there.
    ///
    /// Compiled as a loop it is [`Self::lower_for_of`] with the element name
    /// coming from the arrow's parameter instead of from a binding form, and it
    /// costs exactly what the hand-written loop costs.
    ///
    /// # What it also fixes
    ///
    /// `collect_closures` refuses to capture a variable something *assigns* to,
    /// because this compiler captures by value and JavaScript captures by
    /// reference. So the shape Are We Fast Yet's nbody uses --
    ///
    /// ```text
    /// bodies.forEach((b) => { px += b.vx * b.mass; });
    /// ```
    ///
    /// -- could not be compiled at all. Inlined there is no capture: `px` is an
    /// ordinary local the loop body assigns, and the loop carries it the way it
    /// carries any other. The refusal is right about closures and simply does
    /// not apply.
    ///
    /// Only for an arrow written at the call site. `xs.forEach(f)` where `f` is
    /// a variable is a genuine dispatch, and monomorphization is the answer to
    /// that one.
    ///
    /// # What the three have in common
    ///
    /// All of it except what happens to the value the body produces, which is
    /// [`CallbackResult`]: dropped, stored at the same index of a new array, or
    /// carried to the next iteration. That difference is the whole of `forEach`
    /// against `map` against `reduce`, and putting it in one place is what
    /// makes a `return` inside the body work the same in all three -- it has to
    /// deliver the value before it jumps, and there is one function that knows
    /// how.
    fn lower_iteration(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element_ty: &HirType,
        callback: NodeId,
        kind: Iteration,
        seed: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let method = kind.name();
        let (parameters, body) = self.callback_shape(callback, kind)?;
        let names = parameters.as_slice();
        // Where the element is, which is not "the last one" once an index may
        // follow it. `reduce` takes the accumulator first, everything else
        // takes the element first, and the index -- when the callback asks for
        // one -- is always after both.
        let element_at = usize::from(matches!(kind, Iteration::Reduce));
        let element_symbol = *names.get(element_at).ok_or_else(|| {
            self.unsupported(callback, &format!("a `{method}` callback of this shape"))
        })?;
        let index_symbol = names.get(element_at + 1).copied();

        let origin = self.origin(id);
        let index = self.synthetic_symbol();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.bindings.insert(index, zero);
        let length = self.push(OpKind::Length(receiver), HirType::NUMBER, origin.clone());

        // What the loop carries: the index always, the accumulator when there
        // is one, and every name the body assigns that it did not declare.
        //
        // The accumulator is a loop-carried name like any other, which is what
        // keeps `reduce` free of an allocation: nothing about it escapes.
        let accumulator = self.iteration_answer(id, kind, seed, length, &origin)?;
        let mut synthetic = vec![index];
        synthetic.extend(accumulator);
        let carried = self.carried_across(body, &synthetic, names);

        let produced = self.iteration_result_array(id, kind, length, &origin)?;

        // `steps: true`, so the index moves in a latch block of its own. A
        // `return` inside the callback jumps there, the way `continue` does,
        // and a step written at the end of the body would be skipped by it --
        // which is a loop that never finishes.
        let record = self.begin_loop(id, &carried, true, &origin)?;

        let at = self.bindings[&index];
        let cond = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let at = self.bindings[&index];
        let value = self.push(
            OpKind::ArrayGet {
                array: receiver,
                index: at,
                checked: true,
            },
            element_ty.clone(),
            origin.clone(),
        );
        self.bindings.insert(element_symbol, value);
        // The counter itself, under the name the callback gave it. It is the
        // same value the `ArrayGet` above just indexed with, so the body sees
        // the position it is looking at rather than a second count that could
        // drift from it.
        //
        // The refusal this replaces said the index "would need the loop
        // counter's identity to survive into the body, and this has no test for
        // that yet". It survives: `at` is read from `self.bindings[&index]`
        // *inside* the body block, after `begin_loop` has made the carried
        // names block parameters, so it is the current iteration's value and
        // not the one the loop started with.
        if let Some(index_symbol) = index_symbol {
            self.bindings.insert(index_symbol, at);
        }
        if let (Iteration::Reduce, Some(accumulator), Some(name)) =
            (kind, accumulator, names.first())
        {
            self.bindings.insert(*name, self.bindings[&accumulator]);
        }

        let result =
            Self::iteration_delivery(kind, produced, accumulator, index, value, element_ty);
        self.callback_returns.push(CallbackReturn {
            depth: record.depth,
            result,
        });
        let concise = self.kind_of(body) != Some(syntax::BLOCK);
        let lowered = if concise {
            self.lower_expression(body).map(Some)
        } else {
            self.lower_statement(body).map(|()| None)
        };
        self.callback_returns.pop();
        let produced_value = lowered?;

        // A concise body *is* its value, so it is delivered here rather than by
        // a `return` that cannot appear in one.
        if let Some(value) = produced_value {
            self.deliver(id, &result, record.depth, Some(value))?;
        } else if !self.is_terminated() && !matches!(kind, Iteration::ForEach) {
            // A block body that can reach its end without returning has no
            // value for this iteration. TypeScript rejects it before this,
            // because the callback's inferred return type would include
            // `undefined`; refusing rather than trusting that keeps the
            // failure a diagnostic instead of a silently unchanged
            // accumulator.
            return Err(self.unsupported(
                body,
                &format!("a `{method}` callback that can finish without returning a value"),
            ));
        }
        self.end_loop(&record, Step::Increment(index))?;

        match (kind, produced, accumulator) {
            // `forEach` evaluates to `undefined`, which is `void` here. Nothing
            // reads it -- an expression statement is the only place this
            // appears -- but the caller wants a value.
            (Iteration::ForEach, _, _) => {
                Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
            }
            // `map` filled every slot it allocated; `filter` appended to one
            // allocated empty. Either way the array is the answer.
            (Iteration::Map | Iteration::Filter, Some(array), _) => Ok(array),
            // The accumulator's binding after the loop is the exit block's
            // parameter for it, which `end_loop` has just installed.
            (
                Iteration::Reduce | Iteration::Any | Iteration::All | Iteration::FindIndex,
                _,
                Some(symbol),
            ) => Ok(self.bindings[&symbol]),
            // The element at the index the loop stopped at, or `undefined`
            // where it stopped because it ran out -- which is what `at` answers
            // for an index that is not there, and the reason the seed is the
            // length.
            (Iteration::Find, _, Some(symbol)) => {
                let at = self.bindings[&symbol];
                let ty = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "a `find` result"))?;
                let helper = match &ty {
                    HirType::Erased => "nts_array_at_value",
                    HirType::Managed(_) => "nts_array_at_ref",
                    _ => "nts_array_at",
                };
                Ok(self.runtime_call(helper, vec![receiver, at], ty, origin))
            }
            _ => unreachable!("the result of a kind is decided with the kind"),
        }
    }

    /// `map`'s result, allocated once before the loop.
    ///
    /// It exists before the loop and is never rebound, so it is not carried:
    /// it is one allocation the body writes into.
    ///
    /// Not zeroed. The loop runs every index from 0 to this very length,
    /// [`Self::deliver`] stores on every path through the body, and there is no
    /// early exit -- so nothing can read a slot this allocation did not fill.
    /// The claim is checked rather than argued: `NTS_POISON` fills an
    /// uninitialized allocation with a pattern that is not zero, and the whole
    /// example suite still agrees with node under it.
    fn iteration_result_array(
        &mut self,
        id: NodeId,
        kind: Iteration,
        length: ValueId,
        origin: &Origin,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if !matches!(kind, Iteration::Map | Iteration::Filter) {
            return Ok(None);
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `map` result"))?;
        let made = self.push(
            OpKind::ArrayNew {
                length,
                zeroed: false,
            },
            ty.clone(),
            origin.clone(),
        );
        if !matches!(kind, Iteration::Filter) {
            return Ok(Some(made));
        }
        // `filter` keeps the *room* and gives back the length.
        //
        // `map` writes every slot it allocates and `filter` writes a prefix, so
        // the two differ in what the tail holds while the loop is running --
        // and the array is a live object throughout, with a length the
        // collector walks if the callback allocates. An array whose length says
        // `n` and whose slots hold whatever the allocator last left there is
        // one the collector reads as `n` references.
        //
        // Zeroing the tail answers that and was the first version. It costs a
        // `memset` of the whole input: 16.4% of `benches/cases/array-predicates`
        // went to `__memset_avx2_unaligned_erms`.
        //
        // Saying the array is *empty* answers it for nothing. The capacity is
        // the input's length, so `push` never reallocates, and the length is
        // exactly what has been written -- so the collector never sees a slot
        // the loop has not reached, the result needs no shortening at the end,
        // and the two paths through the body no longer disagree about a count.
        let none = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.runtime_call(
            "nts_array_keep_first",
            vec![made, none],
            HirType::Void,
            origin.clone(),
        );
        Ok(Some(made))
    }

    /// The names an inlined callback's loop has to carry.
    ///
    /// The ones this lowering invented -- the index, and the accumulator where
    /// there is one -- and every name the body *assigns* that it did not also
    /// declare. A name declared inside the body is new on each iteration, and
    /// carrying it would be wrong as well as wasteful.
    fn carried_across(&mut self, body: NodeId, synthetic: &[u32], names: &[u32]) -> Vec<u32> {
        let mut carried = synthetic.to_vec();
        self.assigned_symbols(body, &mut carried);
        let mut declared = names.to_vec();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| synthetic.contains(symbol) || !declared.contains(symbol));
        carried
    }

    /// What the callback produces, put where this method wants it.
    ///
    /// Called from two places that must agree: the end of a concise body, and
    /// a `return` in a block body, which has to do this *before* it jumps.
    fn deliver(
        &mut self,
        id: NodeId,
        result: &CallbackResult,
        depth: usize,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        match result {
            CallbackResult::Discard => Ok(()),
            CallbackResult::Accumulate(symbol) => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                self.bindings.insert(*symbol, value);
                Ok(())
            }
            // `some` and `every`: the callback's value is a question, and an
            // answer that ends the loop leaves through the same exit `break`
            // uses -- carrying what the loop carries, so the answer merges with
            // the one the header would have reached on its own.
            CallbackResult::Decide { symbol, exits_on } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let origin = self.origin(id);
                let cond = self.truthy(id, value);
                let answer = self.push(OpKind::ConstBool(*exits_on), HirType::Bool, origin);
                self.stop_early(*symbol, answer, depth, cond, *exits_on);
                Ok(())
            }
            // `findIndex`: the same early exit `some` takes, carrying the
            // index it stopped at instead of the answer that stopped it.
            CallbackResult::Locate { symbol, index } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let cond = self.truthy(id, value);
                let at = self.bindings[index];
                self.stop_early(*symbol, at, depth, cond, true);
                Ok(())
            }
            // `filter`: a store and a step, or neither.
            //
            // The two paths disagree about how many have been kept, so the
            // block they meet in takes it as a parameter -- which is what an
            // `if` does for any name its arms write, and the reason the cursor
            // cannot just be rebound the way `some`'s answer is.
            CallbackResult::Keep {
                array,
                element,
                push,
            } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let cond = self.truthy(id, value);
                self.keep_element(id, *array, *element, push, cond);
                Ok(())
            }
            CallbackResult::Store { array, index } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let origin = self.origin(id);
                let at = self.bindings[index];
                self.push(
                    OpKind::ArraySet {
                        array: *array,
                        index: at,
                        value,
                        checked: true,
                    },
                    HirType::Void,
                    origin,
                );
                Ok(())
            }
        }
    }

    /// What the body's value does, which is the whole difference between the
    /// seven methods this lowering serves.
    fn iteration_delivery(
        kind: Iteration,
        produced: Option<ValueId>,
        accumulator: Option<u32>,
        index: u32,
        value: ValueId,
        element: &HirType,
    ) -> CallbackResult {
        match (kind, produced, accumulator) {
            (Iteration::ForEach, _, _) => CallbackResult::Discard,
            (Iteration::Map, Some(array), _) => CallbackResult::Store { array, index },
            (Iteration::Reduce, _, Some(symbol)) => CallbackResult::Accumulate(symbol),
            (Iteration::Any, _, Some(symbol)) => CallbackResult::Decide {
                symbol,
                exits_on: true,
            },
            (Iteration::All, _, Some(symbol)) => CallbackResult::Decide {
                symbol,
                exits_on: false,
            },
            (Iteration::FindIndex | Iteration::Find, _, Some(symbol)) => {
                CallbackResult::Locate { symbol, index }
            }
            (Iteration::Filter, Some(array), _) => CallbackResult::Keep {
                array,
                element: value,
                push: if matches!(element, HirType::Managed(_)) {
                    "nts_array_push_ref"
                } else {
                    "nts_array_push"
                },
            },
            _ => unreachable!("the result of a kind is decided with the kind"),
        }
    }

    /// The name a method's answer is carried in, and what it starts as.
    ///
    /// One loop-carried name serves five of the seven. `reduce` carries its
    /// accumulator, `some` and `every` carry the answer, `findIndex` carries the
    /// index it stopped at, and `filter` carries how many it has kept -- and in
    /// every case it is a scalar in a block parameter, which is why none of them
    /// allocates anything to hold it.
    ///
    /// The seed is the answer for an array the loop never decides anything
    /// about: `[].some(f)` is `false`, `[].every(f)` is `true`, `[].findIndex(f)`
    /// is `-1`, and a `filter` that keeps nothing has kept none.
    fn iteration_answer(
        &mut self,
        id: NodeId,
        kind: Iteration,
        seed: Option<ValueId>,
        length: ValueId,
        origin: &Origin,
    ) -> Result<Option<u32>, Diagnostic> {
        Ok(match kind {
            Iteration::Reduce => {
                let symbol = self.synthetic_symbol();
                let seed =
                    seed.ok_or_else(|| self.unsupported(id, "a `reduce` with no initial value"))?;
                self.bindings.insert(symbol, seed);
                Some(symbol)
            }
            // `some` and `every` carry their answer the way `reduce` carries
            // its accumulator, and for the same reason: it is a loop-carried
            // name, so nothing about it escapes and nothing is allocated for
            // it. The seed is the answer for an array that never decides --
            // `[].some(f)` is `false` and `[].every(f)` is `true`.
            Iteration::Any | Iteration::All => {
                let symbol = self.synthetic_symbol();
                let start = self.push(
                    OpKind::ConstBool(matches!(kind, Iteration::All)),
                    HirType::Bool,
                    origin.clone(),
                );
                self.bindings.insert(symbol, start);
                Some(symbol)
            }
            // `findIndex` carries an index rather than an answer, seeded with
            // the one it returns for an array that never decides.
            Iteration::FindIndex => {
                let symbol = self.synthetic_symbol();
                let start =
                    self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
                self.bindings.insert(symbol, start);
                Some(symbol)
            }
            // `find` carries the index it stopped at, seeded with the length
            // rather than with `-1`. Both say "nothing matched", and this one
            // says it in a number `at` already answers `undefined` for -- so
            // the value is read out by the helper `xs.at(i)` uses rather than
            // by a conditional this would have to build.
            Iteration::Find => {
                let symbol = self.synthetic_symbol();
                self.bindings.insert(symbol, length);
                Some(symbol)
            }
            Iteration::ForEach | Iteration::Map | Iteration::Filter => None,
        })
    }

    /// Append an element, or do not.
    ///
    /// `filter`'s body. The two paths used to disagree about how many had been
    /// kept, which made the block they meet in a merge and the count its
    /// parameter. They do not any more: the result is allocated with room and
    /// no length, so the count *is* the array's length and `push` is what
    /// maintains it. Nothing crosses the join.
    fn keep_element(
        &mut self,
        id: NodeId,
        array: ValueId,
        element: ValueId,
        push: &'static str,
        cond: ValueId,
    ) {
        let origin = self.origin(id);
        let keeping = self.new_block();
        let rest = self.new_block();
        self.terminate(Terminator::Branch {
            cond,
            then_target: keeping,
            then_args: Vec::new(),
            else_target: rest,
            else_args: Vec::new(),
        });
        self.switch_to(keeping);
        self.runtime_call(push, vec![array, element], HirType::NUMBER, origin);
        self.terminate(Terminator::Jump {
            target: rest,
            args: Vec::new(),
        });
        self.switch_to(rest);
    }

    /// Leave the loop with an answer, on the side of a test that decides.
    ///
    /// `some`, `every` and `findIndex` all stop before the end and all three
    /// stop the same way: branch on what the callback said, write the answer on
    /// the side that leaves, and go out through the block `break` goes out
    /// through -- carrying what the loop carries, so the answer merges with the
    /// one the header would have reached had it run out of elements instead.
    ///
    /// `exits_on` says which side of the test leaves. It is `true` for `some`
    /// and `findIndex`, which stop when the predicate holds, and `false` for
    /// `every`, which stops when it does not.
    ///
    /// # The binding, written twice
    ///
    /// `bindings` is one map and not one per block, so a name written on a path
    /// that ends in a jump is still written after it. Left that way the loop
    /// goes on reading a value defined in a block that no longer dominates it,
    /// which is what `NotDominated` says and what this got wrong first.
    fn stop_early(
        &mut self,
        symbol: u32,
        answer: ValueId,
        depth: usize,
        cond: ValueId,
        exits_on: bool,
    ) {
        let before = self.bindings[&symbol];
        let leaving = self.new_block();
        let staying = self.new_block();
        let (then_target, else_target) = if exits_on {
            (leaving, staying)
        } else {
            (staying, leaving)
        };
        self.terminate(Terminator::Branch {
            cond,
            then_target,
            then_args: Vec::new(),
            else_target,
            else_args: Vec::new(),
        });
        self.switch_to(leaving);
        self.bindings.insert(symbol, answer);
        let carried = self.breakables[depth].carried.clone();
        let args = self.carried_now(&carried);
        let (exit, _) = self.exit_of(depth);
        self.terminate(Terminator::Jump { target: exit, args });
        self.switch_to(staying);
        self.bindings.insert(symbol, before);
    }

    /// The names a callback binds and the body it runs, checked against what
    /// this method needs of them.
    ///
    /// The index and the array are the parameters every callback of these
    /// *may* take, and a callback taking one is refused rather than bound: the
    /// index would need the loop counter's identity to survive into the body,
    /// and this has no test for that yet.
    fn callback_shape(
        &mut self,
        callback: NodeId,
        kind: Iteration,
    ) -> Result<(Vec<u32>, NodeId), Diagnostic> {
        let method = kind.name();
        let parameters = self.callback_parameters(callback, method)?;
        // The element, plus the accumulator where the method has one, plus an
        // optional index. The third parameter every one of these callbacks may
        // take is the *array*, and that is still refused: handing the receiver
        // to the body would let it be stored somewhere the loop cannot see, and
        // the loop is what proves the array does not escape.
        let least = kind.parameters();
        if parameters.len() != least && parameters.len() != least + 1 {
            return Err(self.unsupported(
                callback,
                &format!(
                    "a `{method}` callback taking {} parameters, where it may take {least} or \
                     {} -- the element, the index, and for `reduce` the accumulator before them",
                    parameters.len(),
                    least + 1
                ),
            ));
        }
        let body = *self.children(callback).last().ok_or_else(|| {
            self.unsupported(callback, &format!("a `{method}` callback with no body"))
        })?;
        Ok((parameters, body))
    }

    /// The symbols an arrow's parameters bind, in order.
    fn callback_parameters(
        &mut self,
        callback: NodeId,
        method: &str,
    ) -> Result<Vec<u32>, Diagnostic> {
        let parameters: Vec<NodeId> = self
            .children(callback)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .collect();
        let mut symbols = Vec::new();
        for parameter in parameters {
            let name = self
                .children(parameter)
                .into_iter()
                .find(|field| self.kind_of(*field) == Some(syntax::IDENTIFIER))
                .ok_or_else(|| {
                    self.unsupported(parameter, &format!("a `{method}` parameter of this shape"))
                })?;
            let symbol = self
                .node(name)
                .symbol
                .ok_or_else(|| {
                    self.unsupported(name, &format!("a `{method}` name with no symbol"))
                })?
                .0;
            symbols.push(symbol);
        }
        Ok(symbols)
    }

    fn lower_object_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        type_id: TypeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let member_name = self
            .node(member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // A method nothing in the hierarchy declares. Falling back to the
        // receiver's own type named a function this program never emits: on a
        // class extending the provided `Error`, `e.toString()` became `call
        // E#toString`, and the failure was a missing symbol at link time rather
        // than a diagnostic here. `toString` is a real member of the declared
        // `Error` and is not one this compiler provides, which is the same
        // shape as reading `.stack`.
        // A *field* holding a closure, called. `o.f(x)` where `f: (x) => y` is
        // storage, not a method: nothing declares it in the hierarchy because
        // there is nothing to declare, and the value to call is in the object.
        //
        // Asked before the hierarchy, because a name cannot be both: a method
        // is not in the layout and a field is not in the dispatch table.
        if let Some(layout) = self.layout_of(id, type_id).ok()
            && let Some(field) = layout.index_of(&member_name)
            && let Some(declared) = layout.fields.get(field as usize)
            && matches!(declared.ty, HirType::Managed(ManagedType::Object(_)))
        {
            let field_ty = declared.ty.clone();
            let origin = self.origin(member);
            let held = self.push(
                OpKind::FieldGet {
                    object: receiver,
                    field,
                },
                field_ty,
                origin,
            );
            return self.call_through_closure(id, member, held, arguments);
        }

        let callee = self.callee_for(id, type_id, &member_name)?;

        let mut args = vec![receiver];
        args.extend(self.lower_arguments(id, arguments)?);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The callee a method name resolves to on a receiver's type.
    ///
    /// Virtual where the hierarchy says the method is overridden, direct
    /// otherwise, and named `Owner#member` either way -- the naming that keeps
    /// two classes' `ref` apart.
    ///
    /// Split out of [`Self::lower_object_method`] because the iteration
    /// protocol calls methods the source never writes. `for (const x of it)`
    /// calls `[Symbol.iterator]()` and then `next()` repeatedly, with no call
    /// node to lower and no argument list to walk; resolving those by hand
    /// would be a second rule that agrees with this one until it does not.
    fn callee_for(
        &mut self,
        id: NodeId,
        type_id: TypeId,
        member_name: &str,
    ) -> Result<Callee, Diagnostic> {
        // `c[kStep](2)` spells the *variable* holding the symbol, and the
        // hierarchy knows the member as `__@kStep@2`. The declaration side
        // resolves the same way, so both halves of a symbol-keyed method agree
        // on one name -- writing only one of them emitted a method nothing
        // could reach, which is the failure [`Self::member_name`] documents.
        let keyed;
        let member_name = if self.hierarchy.declaring(type_id, member_name).is_some() {
            member_name
        } else if let Some(mangled) = self.symbol_property_name(type_id, member_name) {
            keyed = mangled;
            &keyed
        } else {
            member_name
        };
        let Some(declaring) = self.hierarchy.declaring(type_id, member_name) else {
            return Err(self.unsupported(
                id,
                &format!("a method `{member_name}` with no declaration in the hierarchy"),
            ));
        };
        let owner = match self.hierarchy.name.get(&declaring) {
            Some(name) => name.clone(),
            None => self.layout_of(id, declaring)?.name,
        };
        Ok(
            if self.hierarchy.overridden(type_id, member_name)
                && let Some(slot) = self.hierarchy.slot_for(type_id, member_name)
            {
                Callee::Virtual {
                    slot,
                    declared: format!("{owner}#{member_name}"),
                }
            } else {
                Callee::Direct(format!("{owner}#{member_name}"))
            },
        )
    }

    /// A call into the base class, with `this` as the receiver.
    fn lower_super(
        &mut self,
        id: NodeId,
        member: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let base = self
            .base
            .clone()
            .ok_or_else(|| self.unsupported(id, "`super` outside a derived class"))?;
        let receiver = self
            .this
            .ok_or_else(|| self.unsupported(id, "`super` outside a method"))?;

        // Which class above this one actually has the thing being called. Not
        // necessarily the immediate base: a method declared on a grandparent
        // and inherited through the parent is the grandparent's function, and a
        // constructor a base does not declare is one further up still.
        let above = match self.values[receiver.0 as usize].ty {
            HirType::Managed(ManagedType::Object(ty)) => self.hierarchy.base.get(&ty).copied(),
            _ => None,
        };
        let declaring = above.and_then(|base| {
            if member == "constructor" {
                self.hierarchy.constructor(base)
            } else {
                self.hierarchy.declaring(base, member)
            }
        });
        let base = match declaring.and_then(|ty| self.hierarchy.name.get(&ty)) {
            Some(name) => name.clone(),
            // Nothing above declares it. For a constructor that is ordinary --
            // a base class with only methods has none, and `super()` in a
            // derived one has nothing to run. The receiver stands in as the
            // expression's value, which no `super()` statement looks at.
            //
            // Except when the base is a class this compiler *provides*: there
            // the constructor exists and is emitted inline. Before that it fell
            // through here and did nothing, so the message a subclass passed up
            // was silently dropped.
            None if member == "constructor" => {
                let provided = match self.values[receiver.0 as usize].ty {
                    HirType::Managed(ManagedType::Object(ty)) => self.provided_error_base(ty),
                    _ => None,
                };
                if let Some(provided) = provided {
                    self.initialize_error(id, receiver, &provided, arguments)?;
                }
                return Ok(receiver);
            }
            None => base,
        };

        let mut args = vec![receiver];
        args.extend(self.lower_arguments(id, arguments)?);
        let origin = self.origin(id);
        // A `super(...)` produces nothing; `super.m()` produces whatever `m`
        // does, and the checker typed the call node accordingly.
        let ty = if member == "constructor" {
            HirType::Void
        } else {
            self.type_of(id).unwrap_or(HirType::Void)
        };
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{base}#{member}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The name of the class a class extends.
    fn base_class(&self, class: NodeId) -> Option<String> {
        let ty = self.snapshot.node_types.get(&class)?;
        // `extends` first, then `implements`, and a class extends at most one
        // class -- so the first base is the superclass when there is one.
        let base = *self.snapshot.base_types.get(ty)?.first()?;
        let symbol = self.snapshot.types.get(base.0 as usize)?.symbol?;
        Some(self.snapshot.symbols.get(symbol.0 as usize)?.name.clone())
    }

    fn lower_identifier(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // `Infinity`, `NaN` and `undefined` are global bindings that no scope in
        // the program declares, and each is a constant. Resolving them by name
        // is safe for a reason worth stating: all three are non-writable,
        // non-configurable properties of the global object, so unlike an
        // ordinary global they cannot have been reassigned. A local named
        // `NaN` would shadow them, and is caught before this by the binding
        // lookup below coming first.
        if let Some(symbol) = self.node(id).symbol
            && let Some(value) = self.bindings.get(&symbol.0).copied()
        {
            // A name something captured *and* writes to is bound to its cell,
            // so reading it is a load rather than the binding itself.
            let value = self.read_cell(symbol.0, value, id).unwrap_or(value);
            return self.narrowed(id, value);
        }
        let origin = self.origin(id);
        match self.node(id).text.as_deref() {
            Some("Infinity") => {
                return Ok(self.push(OpKind::ConstFloat(f64::INFINITY), HirType::NUMBER, origin));
            }
            Some("NaN") => {
                return Ok(self.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin));
            }
            // `undefined` is not a keyword in an expression -- it is an
            // identifier bound to a non-writable property of the global object.
            // A local of that name would shadow it, and the binding lookup
            // above is what catches one.
            Some("undefined") => return self.lower_absent(id),
            _ => {}
        }

        let symbol = self
            .node(id)
            .symbol
            .ok_or_else(|| self.unsupported(id, "an unresolved name"))?;
        if let Some(value) = self.bindings.get(&symbol.0).copied() {
            let value = self.read_cell(symbol.0, value, id).unwrap_or(value);
            return self.narrowed(id, value);
        }
        // An imported name, resolved to what it imports. Below the local
        // lookup because an import binds nothing a function body can shadow.
        let symbol = self.denoted_symbol(symbol);

        // Declared at module scope. A constant is its value; a variable is a
        // load.
        let origin = self.origin(id);
        if let Some(constant) = self.module.constants.get(&symbol.0) {
            return Ok(self.push(OpKind::ConstFloat(*constant), HirType::NUMBER, origin));
        }
        // Declared at module scope and not usable. Saying which is worth more
        // than "a name declared outside this function", and it is only said for
        // a name something actually reads.
        //
        // Asked *before* the global slot, because a variable can have both: a
        // representable type, so a slot exists, and an initializer that was
        // refused, so nothing ever writes it. Reading the slot would answer
        // with the zero it still holds.
        if let Some(reason) = self.module.unsupported.get(&symbol.0) {
            return Err(self.unsupported(id, reason));
        }
        if let Some(global) = self.module.variables.get(&symbol.0) {
            let ty = self.module.types[*global as usize].clone();
            return Ok(self.push(OpKind::GlobalGet(*global), ty, origin));
        }
        // A named function used as a value. One static instance per
        // declaration, so two mentions of it are the same object.
        if let Some(record) = self.snapshot.symbols.get(symbol.0 as usize)
            && record.flags.contains(SymbolFlags::FUNCTION)
            && let Some(index) = record.declarations.iter().find_map(|declaration| {
                self.closures
                    .iter()
                    .position(|closure| closure.wraps && closure.node == *declaration)
            })
        {
            self.used_closures.push(index);
            // The same layout the body's side builds, pushed here too: the two
            // are lowered by different builders and `collect_layouts` merges
            // them, so the type is known wherever it is used.
            self.layouts.push(self.closure_layout(index, Vec::new()));
            let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
            return Ok(self.push(OpKind::ClosureStatic, ty, origin));
        }
        Err(self.unsupported(id, &self.describe_name(id, symbol)))
    }

    /// `null` and `undefined`, which are one value in a compiled program.
    ///
    /// A reference has a value that is not an object, so the absence needs no
    /// tag beside it. What it does need is a *type*: C tells a null
    /// `NtsString *` from a null `NtsObj_Point *` even though both are the same
    /// address, and the literal itself has neither -- the checker types it
    /// `null`. So the type comes from where the literal sits.
    fn lower_absent(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .contextual_type(id, 0)
            .or_else(|| self.expecting.clone());
        // Which of the two was written. An erased slot has a tag for each, so
        // the distinction survives into the emitted value; a pointer has room
        // for one, and a type carrying both is erased rather than a pointer
        // precisely so that this can never be lost.
        let literal = if self.kind_of(id) == Some(syntax::NULL_KEYWORD) {
            OpKind::ConstNull
        } else {
            OpKind::ConstUndefined
        };
        if ty.as_ref() == Some(&HirType::Erased) {
            let origin = self.origin(id);
            return Ok(self.push(literal, HirType::Erased, origin));
        }
        let ty = ty.filter(HirType::is_managed);
        let Some(ty) = ty else {
            return Err(self.unsupported(
                id,
                "`null` or `undefined` where what it stands in for is not a reference",
            ));
        };
        let origin = self.origin(id);
        Ok(self.push(literal, ty, origin))
    }

    /// The type an expression is expected to have, from where it sits.
    ///
    /// Only for the literals that have no type of their own. The checker types
    /// `null` as `null`, which is true and useless: what a backend needs is the
    /// reference type the absence is standing in for, and that is a property of
    /// the position rather than of the token.
    fn contextual_type(&self, id: NodeId, depth: u32) -> Option<HirType> {
        if depth > 8 {
            return None;
        }
        let parent = self.syntactic_parent(id)?;
        match self.kind_of(parent) {
            // `return null` — whatever the enclosing function promised.
            Some(syntax::RETURN_STATEMENT) => {
                let owner = self.enclosing_callable(parent)?;
                self.declared_return(owner)
            }
            // `const x: Element | null = null`, `next: Element | null = null`,
            // and a parameter default. The declaration names the type.
            Some(
                syntax::VARIABLE_DECLARATION | syntax::PROPERTY_DECLARATION | syntax::PARAMETER,
            ) => self
                .children(parent)
                .into_iter()
                // The written annotation, which is every child but the name and
                // the initializer this came from. Not the *name's* type: the
                // checker narrows it by the initializer, so `let head: Element
                // | null = null` types `head` as `null` right there -- true,
                // and not what the storage is.
                .filter(|child| *child != id && self.kind_of(*child) != Some(syntax::IDENTIFIER))
                .find_map(|child| self.type_of(child))
                .or_else(|| {
                    self.children(parent)
                        .into_iter()
                        .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                        .and_then(|name| self.type_of(name))
                }),
            // `x = null`, `p.next = null` — what the left side holds. And
            // `at !== null` — whatever the other side is, since a comparison
            // against the absent value is a comparison in that side's type.
            Some(syntax::BINARY_EXPRESSION) => {
                let parts = self.children(parent);
                let [left, operator, right] = parts.as_slice() else {
                    return None;
                };
                match self.kind_of(*operator) {
                    Some(syntax::EQUALS_TOKEN) => self.type_of(*left),
                    Some(
                        syntax::EQUALS_EQUALS_TOKEN
                        | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                        | syntax::EXCLAMATION_EQUALS_TOKEN
                        | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN,
                    ) => {
                        let other = if *left == id { *right } else { *left };
                        self.type_of(other)
                    }
                    // `a || undefined`, `a ?? null`. Neither operator chooses a
                    // type: the result is one side or the other, so the whole
                    // expression's type is what each operand is heading for.
                    // Without this an `undefined` written as the right of a
                    // `||` had nothing to ask and was refused for standing in
                    // for something that is not a reference.
                    Some(
                        syntax::BAR_BAR_TOKEN
                        | syntax::AMPERSAND_AMPERSAND_TOKEN
                        | syntax::QUESTION_QUESTION_TOKEN,
                    ) => self
                        .type_of(parent)
                        .or_else(|| self.contextual_type(parent, depth + 1)),
                    _ => None,
                }
            }
            // `f(null)` and `new Element(v, null)` — the parameter it fills.
            // The signature is the checker's answer after overload resolution,
            // so this is exact rather than a guess at which overload.
            Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION) => {
                let at = self
                    .children(parent)
                    .iter()
                    .position(|child| *child == id)?;
                // The callee rather than an argument: `new Array(6).fill(0)`
                // reaches here from the `new`, and what the whole call is
                // expected to be is what its receiver is expected to be. A
                // fallback only -- a caller that asked for something specific
                // rejects an answer that is not it.
                let Some(argument) = at.checked_sub(1) else {
                    return self.contextual_type(parent, depth + 1);
                };
                let signature = self
                    .snapshot
                    .call_targets
                    .get(&parent)
                    .map(|target| target.signature)
                    // A call through a *value* has no resolved target:
                    // `(callback as Callback<string>)(null, resolved)` names no
                    // declaration for the checker to point at. The callee's own
                    // type is a signature, which is the same answer reached from
                    // the other end, and it is how a node-style callback is
                    // always invoked -- seven of the sites in the profile.
                    .or_else(|| {
                        let callee = *self.children(parent).first()?;
                        let ty = *self.snapshot.node_types.get(&callee)?;
                        match self.snapshot.types.get(ty.0 as usize)?.kind {
                            TypeKind::Function(signature) => Some(signature),
                            _ => None,
                        }
                    })?;
                let signature = self.snapshot.signatures.get(signature.0 as usize)?;
                let parameter = signature.parameters.get(argument)?;
                self.represent(parameter.ty)
            }
            // The receiver of `x.m()`, for the same reason.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                if self.children(parent).first() != Some(&id) {
                    return None;
                }
                self.contextual_type(parent, depth + 1)
            }
            // Grouping and assertions carry the context through unchanged.
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::SATISFIES_EXPRESSION
                | syntax::CONDITIONAL_EXPRESSION,
            ) => self.contextual_type(parent, depth + 1),
            _ => None,
        }
    }

    /// The function, method or arrow a node sits inside.
    fn enclosing_callable(&self, id: NodeId) -> Option<NodeId> {
        let mut at = self.node(id).parent;
        for _ in 0..64 {
            let here = at?;
            if matches!(
                self.kind_of(here),
                Some(
                    syntax::FUNCTION_DECLARATION
                        | syntax::METHOD_DECLARATION
                        | syntax::ARROW_FUNCTION
                        | syntax::CONSTRUCTOR
                )
            ) {
                return Some(here);
            }
            at = self.node(here).parent;
        }
        None
    }

    /// `123n`, `0xffn`, `0b1010n` -- a `bigint` literal.
    ///
    /// # The boundary, and why it is here
    ///
    /// A `bigint` is arbitrary precision in the specification. This compiler
    /// gives it 128 bits, and that is a real difference rather than an
    /// implementation detail -- so it is drawn where it can be *seen*: a
    /// literal that does not fit is refused at the place it is written, with
    /// its own digits in the message, and arithmetic that leaves the range
    /// aborts at run time rather than wrapping into a wrong answer.
    ///
    /// The trade is measured rather than assumed. Every `bigint` in the node
    /// profile is a 64-bit quantity -- `readBigUInt64BE`, an hrtime timestamp,
    /// `0xffffffffffffffffn` -- and the comment above the first of them says
    /// why: "`bigint` rather than `number`, because a `double` holds only 53
    /// bits". A true bignum would put a heap allocation in each of those,
    /// which is the opposite of what they are reaching for. 128 bits covers
    /// every one of them with 63 to spare, at the cost of one C type.
    ///
    /// What replaces it, when something needs it: the representation engines
    /// use, which is a small-integer fast path beside a heap bignum. That is a
    /// strictly larger piece of work than either half, and it belongs to the
    /// program that needs `2n ** 200n` rather than to this one.
    fn lower_bigint(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The literal's own text, for the reason `lower_number` reads it: the
        // spelling is the authority on what the literal is.
        let text = self
            .node(id)
            .text
            .clone()
            // No fallback to `snapshot.constants`: it holds a `Number` or a
            // `String`, and a `bigint` is neither -- folding one into a double
            // is exactly the precision this literal exists to avoid.
            .ok_or_else(|| self.unsupported(id, "a `bigint` literal with no digits"))?;

        let digits = text.trim().trim_end_matches('n');
        let (radix, body) = match digits.get(..2) {
            Some("0x" | "0X") => (16, &digits[2..]),
            Some("0o" | "0O") => (8, &digits[2..]),
            Some("0b" | "0B") => (2, &digits[2..]),
            _ => (10, digits),
        };
        let cleaned: String = body.chars().filter(|c| *c != '_').collect();
        let Ok(value) = i128::from_str_radix(&cleaned, radix) else {
            return Err(self.unsupported(
                id,
                &format!(
                    "the `bigint` literal `{digits}`, which needs more than the 128 bits this \
                     compiler gives one"
                ),
            ));
        };

        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstInt(value), HirType::BigInt, origin))
    }

    fn lower_number(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The source text first, parsed here.
        //
        // The checker's value is a convenience and is not always right: tsgo
        // returns `1` for `0.9999999999999999`, because a mantissa of sixteen
        // nines is above 2^53 and rounds up before the division by a power of
        // ten. `0.9999999999999998` survives, because that mantissa is even.
        // test262 found it.
        //
        // Rust's float parser is correctly rounded, and the literal's own text
        // is the authority on what the literal is -- so there is no reason to
        // ask anyone else. The checker's value stays as the fallback for a
        // spelling this does not read.
        if let Some(text) = self.node(id).text.as_deref()
            && let Some(value) = parse_number(text)
        {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin));
        }

        let value = match self.snapshot.constants.get(&id) {
            Some(nts_semantic_schema::ConstantValue::Number(value)) => *value,
            _ => self
                .snapshot
                .node_types
                .get(&id)
                .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                .and_then(|record| match &record.kind {
                    TypeKind::Literal(LiteralValue::Number(value)) => Some(*value),
                    _ => None,
                })
                .ok_or_else(|| self.unsupported(id, "a numeric literal with no known value"))?,
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin))
    }

    fn lower_binary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [lhs_node, operator, rhs_node] = children.as_slice() else {
            return Err(self.unsupported(id, "a binary expression of unexpected shape"));
        };

        // Assignment is not arithmetic on a location: it rebinds a name to a
        // value. With the name bound directly there is no slot to store into and
        // nothing to emit — the rebinding *is* the assignment.
        if self.kind_of(*operator) == Some(syntax::EQUALS_TOKEN) {
            return self.lower_assignment(id, *lhs_node, *rhs_node);
        }

        let token = self.kind_of(*operator).unwrap_or(0);
        // `v === undefined` on an erased value is a tag test, and neither
        // operand is ever built -- `undefined` has no representation of its
        // own, only a tag.
        if let Some(result) = self.erased_absence_test(id, token, *lhs_node, *rhs_node) {
            return result;
        }

        if token == syntax::INSTANCEOF_KEYWORD {
            return self.lower_instanceof(id, *lhs_node, *rhs_node);
        }

        if token == syntax::IN_KEYWORD {
            return self.lower_in(id, *lhs_node, *rhs_node);
        }

        // `&&` and `||` must not evaluate their right operand unless the left
        // one requires it, so they are taken before the ordinary path lowers
        // both.
        if token == syntax::AMPERSAND_AMPERSAND_TOKEN || token == syntax::BAR_BAR_TOKEN {
            return self.lower_logical(
                id,
                token == syntax::AMPERSAND_AMPERSAND_TOKEN,
                *lhs_node,
                *rhs_node,
            );
        }

        // `??` short-circuits for the same reason and on a different question.
        if token == syntax::QUESTION_QUESTION_TOKEN {
            return self.lower_nullish(id, *lhs_node, *rhs_node);
        }

        // `x += e` is `x = x + e`: the operator applies, and the name rebinds.
        // Spelling it out here rather than in a desugaring keeps one place that
        // knows a bitwise operator needs its coercions.
        // `x += e` is `x = x + e`: the operator applies, and the name rebinds.
        // `a ||= b` short-circuits like `a || b` and additionally decides
        // whether to write at all, so it is taken before the compound path --
        // which would lower it as `a = a || b` and store on every path.
        if let Some(logical) = logical_assignment(token) {
            return self.lower_logical_assignment(id, logical, *lhs_node, *rhs_node);
        }

        if let Some(compound) = compound_operator(token) {
            return self.lower_compound(id, compound, *lhs_node, *rhs_node);
        }

        let lhs = self.lower_expression(*lhs_node)?;
        let rhs = self.lower_expression(*rhs_node)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a binary expression of unrepresentable type"))?;

        let token = self
            .kind_of(*operator)
            .ok_or_else(|| self.unsupported(id, "a binary expression with no operator"))?;

        // A bitwise operator is `ToInt32`, the machine operation, and back. The
        // coercion is made explicit rather than folded into the operator so the
        // analysis can see it: `ToInt32` is where "this value is an integer"
        // stops being a hope and becomes a fact, and `x | 0` is how a TypeScript
        // author writes exactly that.
        if let Some(op) = bitwise_operator(token) {
            let origin = self.origin(id);
            return Ok(self.push_bitwise(op, lhs, rhs, ty, &origin));
        }

        // `+` is not one operator. On numbers it is arithmetic; on strings it is
        // concatenation, and the two lower to nothing alike. Resolving it here
        // against the result type means no backend has to ask again.
        // `s + n` converts `n` before concatenating. Done here rather than in
        // the backend, because the conversion is a *call* and a backend that
        // synthesized one would be deciding a semantic question.
        let (lhs, rhs) = if token == syntax::PLUS_TOKEN && ty.is_managed() {
            (
                self.as_string(*lhs_node, lhs)?,
                self.as_string(*rhs_node, rhs)?,
            )
        } else {
            (lhs, rhs)
        };
        if token == syntax::ASTERISK_ASTERISK_TOKEN {
            return Ok(self.exponentiate(id, ty, lhs, rhs));
        }

        let op = match token {
            syntax::EQUALS_TOKEN => unreachable!("assignment is handled before this"),
            syntax::PLUS_TOKEN if ty.is_managed() => BinOp::Concat,
            syntax::PLUS_TOKEN => BinOp::Add,
            syntax::MINUS_TOKEN => BinOp::Sub,
            syntax::ASTERISK_TOKEN => BinOp::Mul,
            syntax::SLASH_TOKEN => BinOp::Div,
            syntax::PERCENT_TOKEN => BinOp::Rem,
            syntax::LESS_THAN_TOKEN => BinOp::Lt,
            syntax::LESS_THAN_EQUALS_TOKEN => BinOp::Le,
            syntax::GREATER_THAN_TOKEN => BinOp::Gt,
            syntax::GREATER_THAN_EQUALS_TOKEN => BinOp::Ge,
            // `==` and `===` differ only by coercion, and where both operands
            // have the same representation the two agree exactly -- number
            // against number, string against string. The checker rejects most
            // mismatches under `strict`, which is what made this safe.
            //
            // It does not reject `unknown == unknown`, and there the runtime
            // types can differ and coercion is the whole question: node answers
            // `1 == true` with true, `[1] == 1` with true, and `null ==
            // undefined` with true. This lowered all three to
            // `nts_value_strict_eq` and answered false. Refused rather than
            // answered wrongly -- see the loose-equality note in section 1.
            //
            // `x == null` does not come through here: it is the *absence*
            // question and `erased_absence_test` answered it above, correctly,
            // which is the one loose comparison real code writes.
            syntax::EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_TOKEN
                if self.coercing_comparison(*lhs_node, *rhs_node) =>
            {
                return Err(self.unsupported(
                    id,
                    "`==` between values whose types are not known to agree, which \
                     coerces -- and this compiler has no `ToPrimitive` to coerce with",
                ));
            }
            syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN => BinOp::Eq,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN => BinOp::Ne,
            kind => {
                return Err(
                    self.unsupported(*operator, &format!("the operator {}", spelling(kind)))
                );
            }
        };

        let origin = self.origin(id);
        Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
    }

    /// A comparison against an absent literal whose answer is in the *type*.
    ///
    /// A pointer carries one absence, so comparing it against the other absent
    /// literal is a question its representation cannot be asked -- the null
    /// pointer would answer yes to both.
    ///
    /// ```ts
    /// const v: string | null = ...;
    /// v === null        // the pointer test
    /// v === undefined   // false, whatever the pointer holds
    /// ```
    ///
    /// Strictly, because `v == undefined` is the loose question and a null
    /// answers it. Answered from the type, which still knows which absence it
    /// has even though the representation does not.
    ///
    /// A type carrying *no* absence answers both operators the same way, and
    /// `==` no less than `===`: abstract equality returns false as soon as one
    /// side is absent and the other is not, before any conversion. `v == null`
    /// on a `number` needs no `ToPrimitive` and never did -- it was refused
    /// only because lowering the `null` came first and a double has nowhere to
    /// put one. Thirty-two sites in the profile, and `x == null` is how
    /// TypeScript spells the nullish check.
    ///
    /// `None` leaves it to the caller: a pointer asked about the absence it
    /// does carry is a real test and not a constant.
    fn absence_the_type_decides(
        &mut self,
        id: NodeId,
        operator: u16,
        value: NodeId,
        written: u32,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let carried = self.absences_of(value)?;
        // Three ways the type settles it, and one way it does not.
        //
        // A type that is an absence and *nothing else* is the case the checker
        // hands back after `v = undefined`: every later read is typed
        // `undefined`, so `v !== undefined` is not a test, it is `false`. It
        // was refused, while the same comparison on the wider `number |
        // undefined` was answered — a value the checker knew *more* about
        // being the one that could not be compiled.
        let equal = if self.only_absences(value) && carried.len() == 1 {
            // `===` asks whether it is that absence; `==` accepts either,
            // since `null == undefined`.
            Some(!strict_operator(operator) || carried[0] == written)
        } else if carried.is_empty() || (strict_operator(operator) && !carried.contains(&written)) {
            // Never absent, or a pointer asked about the absence it does not
            // carry. Both are false.
            Some(false)
        } else {
            // A pointer asked about the absence it does carry: a real test.
            None
        };
        let equal = equal?;
        // The answer is known; the operand is still evaluated. Folding it away
        // made `next() === undefined` skip the call to `next`, which node
        // makes -- a constant is what the *comparison* is, not what the
        // expression is.
        if let Err(diagnostic) = self.lower_expression(value) {
            return Some(Err(diagnostic));
        }
        let origin = self.origin(id);
        let negated = matches!(
            operator,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        );
        let answer = if negated { !equal } else { equal };
        Some(Ok(self.push(
            OpKind::ConstBool(answer),
            HirType::Bool,
            origin,
        )))
    }

    /// Whether a node's type is an absence and nothing else.
    ///
    /// `undefined` on its own, or `null` on its own -- what the checker leaves
    /// a binding at once it has seen the assignment that set it. Distinct from
    /// [`Self::absences_of`] being non-empty, which only says the type *admits*
    /// one beside something real.
    fn only_absences(&self, node: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&node) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let members: Vec<TypeId> = match &record.kind {
            TypeKind::Union(members) => members.clone(),
            _ => vec![*ty],
        };
        !members.is_empty()
            && members
                .iter()
                .all(|member| absence_of_member(self.snapshot, *member).is_some())
    }

    /// `v === undefined` where `v` is erased, as the tag test it is.
    ///
    /// A `number | undefined` is one erased value, and its absence is the
    /// `undefined` tag rather than a null -- a double has no spare bit pattern
    /// to be absent in, which is exactly why the union needs a tag at all. So
    /// the comparison is between a tag and a constant, and neither operand is
    /// ever built.
    ///
    /// Handled here rather than in `lower_absent`, because `undefined` on its
    /// own has no representation to produce: it is only ever *compared*, and
    /// the comparison is the thing that means something.
    fn erased_absence_test(
        &mut self,
        id: NodeId,
        operator: u16,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(
            operator,
            syntax::EQUALS_EQUALS_TOKEN
                | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        ) {
            return None;
        }
        let absent = |builder: &Self, node: NodeId| {
            if builder.kind_of(node) == Some(syntax::NULL_KEYWORD) {
                Some(super::tags::NULL)
            } else if builder.node(node).text.as_deref() == Some("undefined") {
                Some(super::tags::UNDEFINED)
            } else {
                None
            }
        };
        // Either order: `x === null` and `null === x` are the same question.
        let (value, written) = match (absent(self, rhs), absent(self, lhs)) {
            (Some(tag), _) => (lhs, tag),
            (None, Some(tag)) => (rhs, tag),
            (None, None) => return None,
        };
        if self.type_of(value) != Some(HirType::Erased) {
            return self.absence_the_type_decides(id, operator, value, written);
        }
        Some((|| {
            let value = self.lower_expression(value)?;
            let origin = self.origin(id);
            let tag_value = self.push(
                OpKind::TagOf { value },
                HirType::Int {
                    bits: 32,
                    signed: false,
                },
                origin.clone(),
            );
            let unsigned = HirType::Int {
                bits: 32,
                signed: false,
            };
            let positive = matches!(
                operator,
                syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN
            );
            let strict = matches!(
                operator,
                syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
            );
            let op = if positive { BinOp::Eq } else { BinOp::Ne };

            // One comparison per tag the operator asks about. `===` asks about
            // the one that was written; `==` asks about both, because `null ==
            // undefined` is true and is the whole reason the loose operator is
            // still worth writing.
            let against = |builder: &mut Self, tag: u32| {
                let wanted = builder.push(
                    OpKind::ConstInt(i128::from(tag)),
                    unsigned.clone(),
                    origin.clone(),
                );
                builder.push(
                    OpKind::Binary {
                        op,
                        lhs: tag_value,
                        rhs: wanted,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            };
            if strict {
                return Ok(against(self, written));
            }
            let undefined = against(self, super::tags::UNDEFINED);
            let null = against(self, super::tags::NULL);
            // De Morgan rather than a negation: `x == null` is "either", and
            // `x != null` is "neither", so the same two comparisons combine
            // one way or the other.
            let join = if positive {
                BinOp::BitOr
            } else {
                BinOp::BitAnd
            };
            Ok(self.push(
                OpKind::Binary {
                    op: join,
                    lhs: undefined,
                    rhs: null,
                },
                HirType::Bool,
                origin,
            ))
        })())
    }
}

/// Whether a comparison token is the strict one.
const fn strict_operator(token: u16) -> bool {
    matches!(
        token,
        syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
    )
}

/// What `typeof` answers for a representation, where the representation alone
/// decides it -- `Self::spelling_for` wraps this with the one question that
/// needs the snapshot.
///
/// `None` for a value whose answer is not fixed by how it is stored: an erased
/// one carries a tag and is read at run time, and `void`/`never` have no value
/// to ask about.
const fn spelling_of(ty: &HirType) -> Option<&'static str> {
    Some(match ty {
        HirType::Bool => "boolean",
        HirType::Int { .. } | HirType::Float { .. } => "number",
        HirType::BigInt => "bigint",
        HirType::Managed(ManagedType::String) => "string",
        // A closure is the one reference `typeof` does not call an object.
        HirType::Managed(ManagedType::Object(id)) if super::is_closure_type(*id) => "function",
        HirType::Managed(_) => "object",
        HirType::Erased | HirType::Void | HirType::Never => return None,
    })
}

/// The bitwise operator a token spells, if it spells one.
const fn bitwise_operator(token: u16) -> Option<BinOp> {
    Some(match token {
        syntax::AMPERSAND_TOKEN => BinOp::BitAnd,
        syntax::BAR_TOKEN => BinOp::BitOr,
        syntax::CARET_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN => BinOp::UShr,
        _ => return None,
    })
}

/// The operator a compound-assignment token applies.
const fn compound_operator(token: u16) -> Option<Compound> {
    Some(Compound::Op(match token {
        syntax::ASTERISK_ASTERISK_EQUALS_TOKEN => return Some(Compound::Exponentiate),
        syntax::PLUS_EQUALS_TOKEN => BinOp::Add,
        syntax::MINUS_EQUALS_TOKEN => BinOp::Sub,
        syntax::ASTERISK_EQUALS_TOKEN => BinOp::Mul,
        syntax::SLASH_EQUALS_TOKEN => BinOp::Div,
        syntax::PERCENT_EQUALS_TOKEN => BinOp::Rem,
        syntax::AMPERSAND_EQUALS_TOKEN => BinOp::BitAnd,
        syntax::BAR_EQUALS_TOKEN => BinOp::BitOr,
        syntax::CARET_EQUALS_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::UShr,
        _ => return None,
    }))
}

/// The test a logical assignment applies before it writes.
///
/// Separate from [`Compound`] rather than a fourth variant of it, because the
/// two differ in the thing that matters: a compound assignment always writes,
/// and these write only when the test says to.
#[derive(Clone, Copy)]
enum Logical {
    /// `&&=`.
    And,
    /// `||=`.
    Or,
    /// `??=`, which asks a different question from `||=` and not a narrower
    /// one: `n ||= 1` overwrites a `0` and `n ??= 1` does not.
    Nullish,
}

/// The test a logical-assignment token applies.
const fn logical_assignment(token: u16) -> Option<Logical> {
    Some(match token {
        syntax::AMPERSAND_AMPERSAND_EQUALS_TOKEN => Logical::And,
        syntax::BAR_BAR_EQUALS_TOKEN => Logical::Or,
        syntax::QUESTION_QUESTION_EQUALS_TOKEN => Logical::Nullish,
        _ => return None,
    })
}

/// A construct refused by name rather than by the blanket `async` rule.
///
/// Each of these is a *different* transformation from the one an ordinary
/// `async` function needs, and each is the kind that looks like it nearly
/// works:
///
/// - An async generator is two suspension mechanisms at once, and its frame has
///   to survive being resumed from both a consumer and an awaited promise.
/// - `for await` is a loop whose *iteration protocol* suspends, so the
///   suspension points are inside machinery the source never wrote.
/// - A `finally` that spans an `await` has to run on every path out of the try,
///   including the one where the function suspended and was resumed with an
///   exception -- which is the exception state machine, not the value one.
///
/// Conservative in the safe direction: any `await` anywhere inside a `try` that
/// has a `finally` is refused, rather than only those on a path the `finally`
/// could observe. A narrower rule is a proof this lowering has not written.
fn refused_by_name(snapshot: &SemanticSnapshot, id: NodeId) -> Option<&'static str> {
    let node = snapshot.nodes.get(id.0 as usize)?;
    let asynchronous = node
        .modifiers
        .contains(nts_semantic_schema::DeclarationModifiers::ASYNC);
    if asynchronous && has_child_of_kind(snapshot, id, syntax::ASTERISK_TOKEN) {
        return Some("an async generator");
    }
    let mut found = None;
    walk(snapshot, id, &mut |child| {
        if found.is_some() {
            return;
        }
        let kind = kind_at(snapshot, child);
        if kind == Some(syntax::FOR_OF_STATEMENT)
            && has_child_of_kind(snapshot, child, syntax::AWAIT_KEYWORD)
        {
            found = Some("a `for await` loop");
        }
        if kind == Some(syntax::TRY_STATEMENT)
            && has_finally(snapshot, child)
            && contains_kind(snapshot, child, syntax::AWAIT_EXPRESSION)
        {
            found = Some("a `finally` that spans an `await`");
        }
        // The same for a `yield`, and it is **iterator closing**: a `for...of`
        // left by `break` or `return` calls `gen.return()` on the way out,
        // which resumes the generator inside its `try` and runs the `finally`.
        // Nothing here does that -- an abandoned walk simply stops calling the
        // resumption, and the frame sits at whatever state it stopped in.
        //
        // Measured rather than assumed, and it was a wrong answer that ran:
        // a generator whose `finally` incremented a module-scope counter
        // disagreed with node on **26 of 29 cases** the moment the walk had a
        // `break` in it. The refusal is at the `try` because that is the only
        // place that can see the question; the loop that abandons it is in
        // another function.
        //
        // A `catch` that spans a `yield` is **not** refused, and that is
        // measured too: 29 of 29 agree. The `await` rule refuses one because a
        // rejected resumption goes to a shared exit that knows no handler, and
        // nothing resumes a generator with a failure -- a `throw` in the body
        // and the handler that catches it are both in the resumption, in
        // blocks the split preserved.
        if kind == Some(syntax::TRY_STATEMENT)
            && has_finally(snapshot, child)
            && contains_kind(snapshot, child, syntax::YIELD_EXPRESSION)
        {
            found = Some("a `finally` that spans a `yield`, which is iterator closing");
        }
        // A rejected `await` inside a `try` has to reach that `try`'s handler,
        // and it does not: a resumption's rejection goes to one shared exit
        // that rejects this function's own promise, because until `try`/`catch`
        // existed that was the whole of what a rejection could do.
        //
        // Refused rather than left alone, because leaving it alone is a *wrong
        // answer*: `try { await failing() } catch { return -99 }` compiled, ran,
        // and rejected where node returns -99. The shape of the fix is known --
        // a suspension has to record which handler it is inside, so the
        // rejection branch can jump there with the reason instead -- and it is
        // the same question `throw` across a call asks. See 0071.
        if kind == Some(syntax::TRY_STATEMENT)
            && has_catch(snapshot, child)
            && direct_children(snapshot, child)
                .first()
                .is_some_and(|block| contains_kind(snapshot, *block, syntax::AWAIT_EXPRESSION))
        {
            found = Some("a `catch` that spans an `await`");
        }
    });
    found
}

/// A `try` has a `finally` when its last part is a block: `try/catch` ends in a
/// catch clause, and `try/finally` and `try/catch/finally` end in the block the
/// `finally` introduces.
fn has_finally(snapshot: &SemanticSnapshot, id: NodeId) -> bool {
    let parts = direct_children(snapshot, id);
    parts.len() >= 2 && kind_at(snapshot, parts[parts.len() - 1]) == Some(syntax::BLOCK)
}

/// A `try` has a `catch` when its second part is not a block -- the same
/// reading of the same node as [`has_finally`], from the other end.
fn has_catch(snapshot: &SemanticSnapshot, id: NodeId) -> bool {
    let parts = direct_children(snapshot, id);
    parts.len() >= 2 && kind_at(snapshot, parts[1]) != Some(syntax::BLOCK)
}

/// The syntax kind of a node, or `None` for a list.
fn kind_at(snapshot: &SemanticSnapshot, id: NodeId) -> Option<u16> {
    match snapshot.nodes.get(id.0 as usize)?.kind {
        NodeKind::Syntax(kind) => Some(kind),
        NodeKind::List => None,
    }
}

fn direct_children(snapshot: &SemanticSnapshot, id: NodeId) -> Vec<NodeId> {
    let Some(node) = snapshot.nodes.get(id.0 as usize) else {
        return Vec::new();
    };
    node.children
        .iter()
        .flat_map(|child| match snapshot.nodes.get(child.0 as usize) {
            Some(record) if record.kind == NodeKind::List => record.children.clone(),
            _ => vec![*child],
        })
        .collect()
}

fn has_child_of_kind(snapshot: &SemanticSnapshot, id: NodeId, kind: u16) -> bool {
    direct_children(snapshot, id)
        .into_iter()
        .any(|child| kind_at(snapshot, child) == Some(kind))
}

fn contains_kind(snapshot: &SemanticSnapshot, id: NodeId, kind: u16) -> bool {
    let mut found = false;
    walk(snapshot, id, &mut |child| {
        if kind_at(snapshot, child) == Some(kind) {
            found = true;
        }
    });
    found
}

/// Every node under `id`, itself included.
fn walk(snapshot: &SemanticSnapshot, id: NodeId, visit: &mut impl FnMut(NodeId)) {
    visit(id);
    for child in direct_children(snapshot, id) {
        walk(snapshot, child, visit);
    }
}

/// The `Math` member a name spells.
fn math_member(member: &str) -> Option<Intrinsic> {
    Some(match member {
        "floor" => Intrinsic::Unary(UnOp::Floor),
        "ceil" => Intrinsic::Unary(UnOp::Ceil),
        "trunc" => Intrinsic::Unary(UnOp::Trunc),
        "round" => Intrinsic::Unary(UnOp::Round),
        "abs" => Intrinsic::Unary(UnOp::Abs),
        "sqrt" => Intrinsic::Unary(UnOp::Sqrt),
        "min" => Intrinsic::Binary(BinOp::Min),
        "max" => Intrinsic::Binary(BinOp::Max),
        "pow" => Intrinsic::BinaryCall("nts_math_pow"),
        "atan2" => Intrinsic::BinaryCall("nts_math_atan2"),
        "hypot" => Intrinsic::BinaryCall("nts_math_hypot"),
        "sign" => Intrinsic::UnaryCall("nts_math_sign"),
        "fround" => Intrinsic::UnaryCall("nts_math_fround"),
        "cbrt" => Intrinsic::UnaryCall("nts_math_cbrt"),
        "exp" => Intrinsic::UnaryCall("nts_math_exp"),
        "expm1" => Intrinsic::UnaryCall("nts_math_expm1"),
        "log" => Intrinsic::UnaryCall("nts_math_log"),
        "log2" => Intrinsic::UnaryCall("nts_math_log2"),
        "log10" => Intrinsic::UnaryCall("nts_math_log10"),
        "log1p" => Intrinsic::UnaryCall("nts_math_log1p"),
        "sin" => Intrinsic::UnaryCall("nts_math_sin"),
        "cos" => Intrinsic::UnaryCall("nts_math_cos"),
        "tan" => Intrinsic::UnaryCall("nts_math_tan"),
        "asin" => Intrinsic::UnaryCall("nts_math_asin"),
        "acos" => Intrinsic::UnaryCall("nts_math_acos"),
        "atan" => Intrinsic::UnaryCall("nts_math_atan"),
        "sinh" => Intrinsic::UnaryCall("nts_math_sinh"),
        "cosh" => Intrinsic::UnaryCall("nts_math_cosh"),
        "tanh" => Intrinsic::UnaryCall("nts_math_tanh"),
        // `Math.random` is absent on purpose: it is the one member of this
        // family that no differential can check, because two runs of the
        // same program disagree by design.
        _ => return None,
    })
}

/// The global function a name spells, for the two that are numeric predicates.
fn global_predicate(name: &str) -> Option<Intrinsic> {
    Some(match name {
        "isNaN" => Intrinsic::NotANumber,
        "isFinite" => Intrinsic::UnaryCall("nts_is_finite"),
        _ => return None,
    })
}

/// The value a namespace's named constant holds.
///
/// `Math` and `Number` between them, because both are namespaces of numbers
/// with no representation of their own, and the lowering asks the same question
/// of each.
fn named_constant(namespace: &str, name: &str) -> Option<f64> {
    match namespace {
        "Math" => math_constant(name),
        "Number" => number_constant(name),
        _ => None,
    }
}

/// The value `Number`'s named constants hold.
///
/// The specification gives each as an exact `double`, so these are values and
/// not approximations -- `EPSILON` is 2^-52 and `MAX_SAFE_INTEGER` is 2^53 - 1,
/// both exactly representable. `Number.NaN` is here as well: it is a constant
/// like the rest, and the global `NaN` is the same value under a shorter name.
fn number_constant(name: &str) -> Option<f64> {
    Some(match name {
        "MAX_SAFE_INTEGER" => 9_007_199_254_740_991.0,
        "MIN_SAFE_INTEGER" => -9_007_199_254_740_991.0,
        "MAX_VALUE" => f64::MAX,
        // The smallest *subnormal*, which is what the specification says and is
        // not `f64::MIN_POSITIVE` -- that is the smallest normal, 2^-1022,
        // where this is 2^-1074. Four orders of magnitude apart in the exponent.
        "MIN_VALUE" => f64::from_bits(1),
        "EPSILON" => f64::EPSILON,
        "POSITIVE_INFINITY" => f64::INFINITY,
        "NEGATIVE_INFINITY" => f64::NEG_INFINITY,
        "NaN" => f64::NAN,
        _ => return None,
    })
}

/// The value `Math`'s named constants hold.
///
/// Spelled out rather than computed, because the specification gives each one
/// as the `double` nearest a mathematical constant and `M_PI` and friends are
/// not guaranteed to be that -- they are a POSIX extension, not C, and their
/// precision is the implementation's business. These are the digits node
/// prints.
fn math_constant(name: &str) -> Option<f64> {
    Some(match name {
        "PI" => std::f64::consts::PI,
        "E" => std::f64::consts::E,
        "LN2" => std::f64::consts::LN_2,
        "LN10" => std::f64::consts::LN_10,
        "LOG2E" => std::f64::consts::LOG2_E,
        "LOG10E" => std::f64::consts::LOG10_E,
        "SQRT2" => std::f64::consts::SQRT_2,
        "SQRT1_2" => std::f64::consts::FRAC_1_SQRT_2,
        _ => return None,
    })
}

/// What an enum member access resolved to.
///
/// Two kinds because they need two emissions, not because they are two
/// features: a number is an immediate and a string is the interned static a
/// string literal gets.
#[derive(Clone)]
enum EnumMember {
    Number(f64),
    /// The member's text, which the checker has already interned as the
    /// access's literal type -- the same one it gives the literal itself.
    Text(String),
}

/// What a compound assignment applies to the place it reads.
///
/// Two variants rather than one, because `**=` is the only compound assignment
/// whose operator is not an operator: exponentiation is a runtime call, so it
/// cannot be spelled as a [`BinOp`].
#[derive(Clone, Copy)]
enum Compound {
    Op(BinOp),
    Exponentiate,
}

/// Whether an operator needs the `ToInt32` coercions.
const fn bitwise_operator_of(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr
    )
}

/// The values a declared type admits.
///
/// Only literal types and unions of them say anything useful; everything else
/// is as wide as its representation. Bounded so that a self-referential union
/// cannot make this recurse forever — the checker should not produce one, but a
/// stack overflow is a poor way to find out.
fn known_values(snapshot: &SemanticSnapshot, ty: TypeId, depth: u32) -> Facts {
    const MAX_DEPTH: u32 = 8;
    if depth > MAX_DEPTH {
        return Facts::TOP;
    }
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return Facts::TOP;
    };
    match &record.kind {
        TypeKind::Literal(LiteralValue::Number(value)) => Facts::constant(*value),
        TypeKind::Union(members) => members.iter().fold(Facts::BOTTOM, |accumulated, member| {
            accumulated.join(known_values(snapshot, *member, depth + 1))
        }),
        _ => Facts::TOP,
    }
}

/// A `Math` member the compiler implements directly.
#[derive(Debug, Clone, Copy)]
enum Intrinsic {
    Unary(UnOp),
    Binary(BinOp),
    /// A one-argument call into the runtime, named here.
    UnaryCall(&'static str),
    /// A two-argument call into the runtime, named here.
    BinaryCall(&'static str),
    /// `Number.isNaN`, which is `x != x` rather than a call.
    ///
    /// Free, and it folds away entirely where the specializer has narrowed the
    /// operand to an integer -- which cannot be NaN, so the comparison is a
    /// constant `false` that the C compiler removes. A runtime call would have
    /// pinned the value to a `double` to pass it.
    NotANumber,
}

/// What a call has to supply for a parameter its argument list did not reach.
///
/// Two different absences. `f(a = 1)` has an expression to evaluate; `f(a?: T)`
/// has nothing written down at all, and the value is `undefined`.
#[derive(Debug, Clone, Copy)]
enum Omitted {
    /// The declaration's initializer, evaluated at this call.
    Default(NodeId),
    /// `undefined`, in whatever representation the parameter has.
    Absent,
}

/// Where an assignment writes.
///
/// Named rather than re-derived, because a compound assignment reads and writes
/// *the same* place: `xs[next()] += 1` calls `next` once in JavaScript, and
/// lowering the target twice would call it twice.
#[derive(Debug, Clone)]
enum Place {
    Field {
        object: ValueId,
        field: u32,
    },
    /// A setter. `o.x = v` where `x` is one runs code, so this is a call with
    /// the receiver and the value as its two arguments.
    Setter {
        object: ValueId,
        callee: String,
    },
    Element {
        array: ValueId,
        index: ValueId,
    },
    Global(u32),
    /// A name bound in the function, with the type its declaration gives it.
    ///
    /// A binding is an SSA value rather than a slot, so nothing else records
    /// what it is supposed to hold -- and an assignment has to keep it. The
    /// type is carried here because the *declaration* is where it is written
    /// and the symbol table does not have it: a local's `SymbolRecord.ty` is
    /// `None`.
    Binding {
        symbol: u32,
        ty: Option<HirType>,
    },
}

/// How a `for...of` steps through what it was given.
///
/// Three shapes, and each is a cursor and three questions: where it starts,
/// whether it is still going, and what it reads. Naming them together is what
/// lets one loop serve an array, a table and a string -- the alternative was
/// three loops that would drift apart, since `break`, `continue` and the
/// loop-carried names are the same problem in all three.
///
/// The array case still emits exactly the counted loop it emitted before this
/// existed, which is the whole of what "typed code pays nothing" means here.
#[derive(Clone)]
enum Walk {
    /// `xs[i]` while `i < xs.length`, stepping by one.
    Counted(HirType),
    /// The live entries of a `Map` or a `Set`.
    ///
    /// The cursor is an entry index rather than a position, because the entries
    /// are not contiguous -- a deleted one leaves a hole -- so the runtime is
    /// asked for the next live index rather than told to add one.
    Table {
        /// `nts_map_key_at` or `nts_map_value_at`. A `Set` stores its elements
        /// as keys, so iterating one and iterating `keys()` are the same read.
        read: &'static str,
        element: HirType,
    },
    /// The entries of a `Map`, bound through `[key, value]`.
    ///
    /// Two names and two reads. Nothing materializes the pair: it is what the
    /// *language* says the element is, and building one per iteration to take
    /// apart immediately would be an allocation for nothing. The table holds
    /// keys and values in separate arrays, so this reads one of each.
    Entries {
        key: HirType,
        value: HirType,
        /// `nts_map_value_at` for a `Map`. A `Set` stores no values at all, and
        /// its `entries()` yields `[v, v]` -- node agrees it is the same value
        /// twice -- so the second read is the key again.
        value_read: &'static str,
    },
    /// A user type's own iterator, stepped through `[Symbol.iterator]()` and
    /// `next()`.
    ///
    /// The only walk with no cursor. The other four know where they are from an
    /// index the loop advances; this one's entire state lives inside the
    /// iterator object, and the *call* to `next()` is what moves it. So one
    /// call answers both questions -- whether to go round again, and with what
    /// -- which is why the result is computed in the header and the body reads
    /// the element back out of it rather than reading the sequence at all.
    ///
    /// That is also why the latch is the header: `continue` has to reach the
    /// `next()` call, and a step written anywhere else is a step `continue`
    /// skips. `Step::None` says exactly this.
    Protocol {
        /// The iterator, made once before the loop and never reassigned, so it
        /// is an ordinary dominating value rather than a carried one.
        iterator: ValueId,
        /// `next()` on it, resolved once instead of per iteration.
        next: Callee,
        /// What `next()` hands back, and where the two fields sit in it.
        result: HirType,
        done: u32,
        value: u32,
        element: HirType,
    },
    /// A generator, stepped by its own resumption.
    ///
    /// The protocol without the object. `[Symbol.iterator]()` on a user type
    /// builds an iterator and `next()` returns a `{ value, done }`; a generator
    /// *is* its iterator -- the frame [`super::suspend`] builds is the state,
    /// and the resumption both advances it and answers whether it is over. So
    /// there is nothing to allocate per step and no result object at all: the
    /// element is left in the frame and `done` comes back as the return value.
    ///
    /// Cursorless for the same reason [`Walk::Protocol`] is, and with the same
    /// consequence: the header is the latch, because the resumption is called
    /// there and `continue` has to reach it.
    Generator {
        /// The frame, made once by calling the generator before the loop.
        frame: ValueId,
        /// `f__resume(frame)`, which [`super::suspend`] has not built yet.
        resume: Callee,
        element: HirType,
    },
    /// The code points of a string, which are one or two units wide.
    ///
    /// Not the code *units*: node yields three items for `"a\u{1F600}b"` where
    /// `length` is four, and stepping by one unit would hand the body the
    /// halves of a surrogate pair as two separate strings.
    Text,
}

/// The parts of a `switch` its test chain needs.
///
/// Bundled because they are one thing -- the switch being lowered -- and
/// passing them one at a time had grown to eight arguments, where a transposed
/// pair would still compile.
#[derive(Debug, Clone, Copy)]
struct CaseChain<'a> {
    clauses: &'a [NodeId],
    blocks: &'a [BlockId],
    carried: &'a [u32],
    origin: &'a Origin,
    depth: usize,
    /// Whether the labels cover every value the discriminant can hold, so that
    /// the chain's last `else` is a point control does not reach.
    exhaustive: bool,
}

/// One side of a branching expression.
///
/// A ternary's arms are expressions to lower inside their own blocks; a
/// short-circuit's "untaken" arm is the left operand, already evaluated before
/// the branch.
///
/// `Clone` and not `Copy`: `Member` carries a representation, which is a type
/// and owns a `Box` for an array's element. Every branch is built where it is
/// used and moved once, so nothing here wanted the copy.
#[derive(Clone)]
enum Branch {
    Expression(NodeId),
    Value(ValueId),
    /// A logical assignment's right operand, evaluated *and written* here.
    ///
    /// Inside the arm rather than before it, for two reasons that happen to
    /// coincide. The evaluation must not happen on the other path -- `a ||=
    /// f()` does not call `f` when `a` is truthy -- and neither must the
    /// write: a logical assignment whose test goes the other way performs no
    /// store at all. The second is what distinguishes this from
    /// [`Self::Expression`], and it is observable rather than academic. A
    /// setter does not run, and a counted store does not release whatever the
    /// place was already holding.
    ///
    /// The place is lowered once, before the branch, so `xs[next()] ??= 1`
    /// calls `next` a single time whichever way the test goes.
    Assigned(NodeId, Place),
    /// `undefined`, at whatever type the whole expression has.
    ///
    /// What `a?.b` produces when `a` is absent -- and it is the *expression's*
    /// type rather than the member's, because the member is not read at all.
    Absent,
    /// A member read from a receiver that is already lowered.
    ///
    /// The receiver is evaluated before the branch and read inside it, which is
    /// what keeps `a?.b` from evaluating `a` twice.
    ///
    /// The third field is what the receiver *is* once the branch has
    /// established it is present, and `None` where it was already that. A
    /// pointer carries its own absence, so a `string | null` receiver is a
    /// string in the arm that tested it and there is nothing to do; two
    /// absences needed a tag, and the payload has to be read back out of it
    /// before anything can ask for a member. See
    /// [`FuncBuilder::present_of`].
    Member(ValueId, NodeId, Option<HirType>),
    /// `f?.(x)`'s call, in the arm where the callee is present.
    ///
    /// The arguments are lowered *here* rather than before the branch: `f?.(g())`
    /// must not call `g` when `f` is absent, which is what the specification
    /// says and what a branch taken earlier would get wrong.
    Invoke(ValueId, NodeId, Option<HirType>),
    /// `xs?.[i]`'s read, in the arm where the receiver is present.
    ///
    /// The index is lowered *here* rather than before the branch, for the same
    /// reason [`Self::Member`]'s payload read is: `xs?.[next()]` must not call
    /// `next` when `xs` is absent, and the specification says so.
    Element(ValueId, NodeId, Option<HirType>),
    /// A value the branch has established is neither `null` nor `undefined`.
    ///
    /// Distinct from [`Self::Value`] because the distinction is a soundness
    /// one. `a || b` takes its first arm when `a` is *truthy*, and truthy
    /// excludes both absences -- so an erased `a` may be read back at the type
    /// the whole expression has. `a && b` takes its second arm when `a` is
    /// *falsy*, and `undefined` is falsy, so the same read there would be a
    /// payload that is not present.
    Present(ValueId),
}

#[cfg(test)]
mod tests {
    use super::parse_number;

    /// Every spelling a JavaScript numeric literal has.
    #[test]
    fn a_literal_parses_as_the_double_it_denotes() {
        assert_eq!(parse_number("0"), Some(0.0));
        assert_eq!(parse_number("1_000_000"), Some(1_000_000.0));
        assert_eq!(parse_number("1e-320"), Some(1e-320));
        assert_eq!(parse_number("0x1f"), Some(31.0));
        assert_eq!(parse_number("0o17"), Some(15.0));
        assert_eq!(parse_number("0b1011"), Some(11.0));
        assert_eq!(parse_number(".5"), Some(0.5));
        assert_eq!(parse_number("1.7976931348623157e308"), Some(f64::MAX));

        // A BigInt is a different type with different arithmetic, and is not
        // this. Saying so beats parsing off the `n` and being quietly wrong.
        assert_eq!(parse_number("1n"), None);
    }

    /// The reason this function exists rather than trusting the checker.
    ///
    /// tsgo returns `1` for this literal: a mantissa of sixteen nines is above
    /// 2^53 and rounds up before the division by a power of ten. The neighbour
    /// below survives, because that mantissa is even. Rust's parser is correctly
    /// rounded and the literal's own text is the authority on what it says.
    #[test]
    fn seventeen_significant_digits_survive() {
        assert_eq!(
            parse_number("0.9999999999999999"),
            Some(0.999_999_999_999_999_9)
        );
        assert_ne!(parse_number("0.9999999999999999"), Some(1.0));
        assert_eq!(
            parse_number("0.9999999999999998"),
            Some(0.999_999_999_999_999_8)
        );
        assert_eq!(
            parse_number("1.9999999999999998"),
            Some(1.999_999_999_999_999_8)
        );
    }
}
