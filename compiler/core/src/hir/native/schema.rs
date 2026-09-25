//! Decode only authored native storage. An unsupported layout remains refused;
//! it must not fall back to managed-object layout or guessed member offsets.
use nts_semantic_schema::{LiteralValue, MemberKind, NodeId, NodeKind, PropertyRecord, SemanticSnapshot, SymbolId, TypeId, TypeKind, syntax};
use super::{Field, Pointee, Record, RecordKind, scalar};

/// A member of `ty` by name, through an intersection's parts.
pub(crate) fn property<'a>(snapshot: &'a SemanticSnapshot, ty: TypeId, name: &str) -> Option<&'a PropertyRecord> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Object { properties } => properties.iter().find(|p| p.name == name),
        TypeKind::Intersection(parts) => parts.iter().find_map(|part| property(snapshot, *part, name)),
        _ => None,
    }
}

fn marker(snapshot: &SemanticSnapshot, ty: TypeId, name: &str) -> Option<TypeId> {
    let p = property(snapshot, ty, name)?;
    (p.readonly && !p.optional && p.kind == MemberKind::Field).then_some(p.ty)
}

/// An optional property's literal, through the `undefined` optionality adds.
fn optional_text(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(parts) => parts.iter().find_map(|part| text(snapshot, *part)),
        _ => text(snapshot, ty),
    }
}

fn text(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Literal(LiteralValue::String(name)) => Some(name),
        _ => None,
    }
}

/// A nullable pointer has the same address representation; undefined and mixed
/// pointer unions do not have that contract. Recursive pointees require a
/// separately named incomplete type and are not expanded speculatively here.
#[must_use]
pub fn pointer(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    pointer_within(snapshot, stored(snapshot, ty), &mut Vec::new())
}

/// `ByValue<T> | Fields<T>` as the `ByValue<T>` it is to C and to every
/// reader of the type: the record, which the argument may also be written as
/// an object literal. The literal is the lowering's to write into storage
/// (`native_record_literal`), so no other question about the parameter
/// changes. Any other type is itself.
pub(crate) fn stored(snapshot: &SemanticSnapshot, ty: TypeId) -> TypeId {
    let fields = |part: TypeId| property(snapshot, part, "___c_fields").is_some_and(|p| p.readonly && p.optional);
    match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::Union(parts)) => match parts.as_slice() {
            [a, b] if fields(*b) && !fields(*a) => *a,
            [a, b] if fields(*a) && !fields(*b) => *b,
            _ => ty,
        },
        _ => ty,
    }
}

/// An opaque pointee: `Opaque<Tag>`, or `Class<Tag, Parent>` with its chain.
fn handle(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    if let Some(tag) = marker(snapshot, ty, "___c_opaque") {
        return Some(Pointee::Opaque(text(snapshot, tag)?.into()));
    }
    // `Class<Tag, Parent>` -- an opaque pointee with a hierarchy. The chain is
    // a tuple of string literals, root first, ending in a `...string[]` rest,
    // which the snapshot flattens to one trailing `string` element: the tags
    // are the literal prefix and the last of them is this handle's own.
    let chain = marker(snapshot, ty, "___c_chain")?;
    let TypeKind::Tuple(elements) = &snapshot.types.get(chain.0 as usize)?.kind else {
        return None;
    };
    let mut tags: Vec<String> =
        elements.iter().map_while(|element| text(snapshot, *element).map(str::to_owned)).collect();
    // `GObjectInterface<Tag, Prerequisite>`: the chain is the prerequisite's,
    // whole, and the handle is the interface's own tag, which is how C
    // declares a parameter of one (`GtkEditable *`).
    let interface = property(snapshot, ty, "___c_interface")
        .filter(|p| p.readonly && p.optional && p.kind == MemberKind::Field)
        .and_then(|p| optional_text(snapshot, p.ty))
        .map(str::to_owned);
    let tag = match &interface {
        Some(tag) => tag.clone(),
        None => tags.pop()?,
    };
    // `ObjcClass<Tag, Parent>` is `Class<Tag, Parent>` with this brand beside
    // it: the same chain, an object the program counts. `GObjectClass` the same.
    let family = if marker(snapshot, ty, "___objc").is_some() {
        super::Family::Objc
    } else if marker(snapshot, ty, "___gobject").is_some() {
        super::Family::GObject
    } else if marker(snapshot, ty, "___com").is_some() {
        super::Family::Com
    } else {
        super::Family::C
    };
    Some(Pointee::Opaque(super::Handle { tag, ancestors: tags, family, interface: interface.is_some() }))
}

/// The handle behind `Erased<H>` (or `Erased<H> | null`): what the program
/// holds where C says `void *`. `None` for anything not erased.
pub(crate) fn erased_handle(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    let ty = match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(parts) => match parts.as_slice() {
            [a, b] if matches!(snapshot.types[a.0 as usize].kind, TypeKind::Null) => *b,
            [a, b] if matches!(snapshot.types[b.0 as usize].kind, TypeKind::Null) => *a,
            _ => return None,
        },
        _ => ty,
    };
    property(snapshot, ty, "___c_erased").filter(|p| p.optional && p.readonly)?;
    handle(snapshot, ty)
}

/// A `GLib` boxed record (`Boxed<Tag, GetType, Size>`): its `GType` function
/// and its size, 0 where the headers keep the struct opaque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BoxedRecord {
    pub(crate) get_type: String,
    pub(crate) size: u64,
}

/// `Boxed<Tag, GetType, Size>`, or that `| null`: a record the program holds
/// in a box (`BOXED_RECORD`). `None` for any other type.
pub(crate) fn boxed(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<BoxedRecord> {
    let ty = match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(parts) => match parts.as_slice() {
            [a, b] if matches!(snapshot.types[a.0 as usize].kind, TypeKind::Null) => *b,
            [a, b] if matches!(snapshot.types[b.0 as usize].kind, TypeKind::Null) => *a,
            _ => return None,
        },
        _ => ty,
    };
    let get_type = property(snapshot, ty, "___c_boxed").filter(|p| p.optional && p.readonly)?;
    let get_type = optional_text(snapshot, get_type.ty)?.to_owned();
    let size = property(snapshot, ty, "___c_size")
        .filter(|p| p.optional && p.readonly)
        .and_then(|p| optional_number(snapshot, p.ty))
        .unwrap_or(0);
    Some(BoxedRecord { get_type, size })
}

/// An optional property's number literal, through the `undefined`
/// optionality adds.
fn optional_number(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<u64> {
    let number = |id: TypeId| match &snapshot.types.get(id.0 as usize)?.kind {
        TypeKind::Literal(LiteralValue::Number(value)) if *value >= 0.0 && value.fract() == 0.0 => {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            Some(*value as u64)
        }
        _ => None,
    };
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(parts) => parts.iter().find_map(|part| number(*part)),
        _ => number(ty),
    }
}

/// `ByValue<T>`: the record `T` itself, where C takes or returns one by value.
///
/// `Ptr<T> & { readonly __c_by_value?: true }`. The pointer is what TypeScript
/// holds -- storage -- and the optional brand says C's parameter is the record
/// in that storage. Anything but a record under the brand is not one of these.
#[must_use]
pub(crate) fn by_value(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<std::sync::Arc<Record>> {
    let ty = stored(snapshot, ty);
    let brand = property(snapshot, ty, "___c_by_value")?;
    if !(brand.readonly && brand.optional && brand.kind == MemberKind::Field) {
        return None;
    }
    match pointer(snapshot, ty)? {
        Pointee::Record(record) => Some(record),
        _ => None,
    }
}

/// The Objective-C class a class type's instances are: a class a binding
/// declares with `@ntsClass NSTimer` -- the name Objective-C knows, where
/// TypeScript may say `Timer` as Swift does -- with every ancestor's, root
/// first. The instance side only: the class as a value is a `Function` type.
///
/// **Decided by the declaration, not by structure.** A class type carries no
/// marker, and needs none: the tag says what the class is, and it is on the
/// declaration the checker resolved the type to.
///
/// A class the *program* declares over one of these is one too: an
/// Objective-C class of its own, registered under its own name when the
/// program loads (`Program::foreign_classes`), as Swift registers one.
fn objc_class(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    let record = snapshot.types.get(ty.0 as usize)?;
    if !matches!(record.kind, TypeKind::Object { .. }) {
        return None;
    }
    let declaration = class_declaration(snapshot, record.symbol?)?;
    let tag = objc_name(snapshot, declaration)?;
    let mut ancestors = Vec::new();
    let mut at = base_class(snapshot, declaration);
    while let Some(base) = at {
        ancestors.push(objc_name(snapshot, base)?);
        at = base_class(snapshot, base);
    }
    ancestors.reverse();
    Some(Pointee::Opaque(super::Handle { tag, ancestors, family: super::Family::Objc, interface: false }))
}

/// An Objective-C protocol a binding declares (`@ntsProtocol
/// UITableViewDataSource` on an interface), as the type of a value: Swift's
/// `any UITableViewDataSource`, an object whose class is known only to
/// conform. Its handle is an interface over `NSObject`'s chain, so any
/// Objective-C object may be passed as one -- whether its class conforms is
/// the checker's to say, as `implements` is.
fn objc_protocol(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    let record = snapshot.types.get(ty.0 as usize)?;
    if !matches!(record.kind, TypeKind::Object { .. }) {
        return None;
    }
    let mut symbol = snapshot.symbols.get(record.symbol?.0 as usize)?;
    while let Some(aliased) = symbol.aliased {
        symbol = snapshot.symbols.get(aliased.0 as usize)?;
    }
    let tag = symbol.declarations.iter().find_map(|declaration| {
        let node = snapshot.nodes.get(declaration.0 as usize)?;
        matches!(node.kind, NodeKind::Syntax(syntax::INTERFACE_DECLARATION)).then(|| node.native.as_ref()?.protocol.clone())?
    })?;
    Some(Pointee::Opaque(super::Handle { tag, ancestors: vec!["NSObject".to_owned()], family: super::Family::Objc, interface: true }))
}

/// Whether a class declaration has an Objective-C class among its ancestors
/// while not being one itself: a subclass the program writes.
pub(crate) fn extends_objc(snapshot: &SemanticSnapshot, declaration: NodeId) -> bool {
    if objc_tag(snapshot, declaration).is_some() {
        return false;
    }
    let mut at = base_class(snapshot, declaration);
    while let Some(base) = at {
        if objc_tag(snapshot, base).is_some() {
            return true;
        }
        at = base_class(snapshot, base);
    }
    false
}

/// Whether a runtime registers the class a program writes, so that its
/// instances are its own and not merely its parent's handle: a `GObject`
/// class's subclass (a `GType` of its own), an Objective-C class or one over
/// it, a composable Windows Runtime class or one over it (composed). The one
/// answer both `lower_class` and `new` ask -- two derivations of it disagreed
/// once, and `new App()` was refused as a class nothing registers.
pub(crate) fn registered_by_a_runtime(snapshot: &SemanticSnapshot, declaration: NodeId) -> bool {
    gobject_parent(snapshot, declaration).is_some()
        || extends_objc(snapshot, declaration)
        || is_objc_class(snapshot, declaration)
        || extends_com(snapshot, declaration)
        || is_com_class(snapshot, declaration)
}

/// The prefix of the `GType` function a backend defines for each `GObject`
/// class the program writes: `nts_gobject_type_Counter`.
pub const PROGRAM_GTYPE: &str = "nts_gobject_type_";

/// For a class the program writes over a `GObject` class -- `class Counter
/// extends GtkButton` -- the function answering that class's `GType`, which
/// the subclass registers under: the `@ntsGType` on the `__c_gtype` member of
/// the value it extends, or, over a class the program wrote itself, that
/// class's own ([`PROGRAM_GTYPE`]). `None` for any other class.
///
/// Read from the value's declaration, not its type: the snapshot keeps a
/// value with a construct signature as that signature, and its members are
/// gone from it.
pub(crate) fn gobject_parent(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<String> {
    let node = |id: NodeId| snapshot.nodes.get(id.0 as usize);
    let is = |id: NodeId, kind: u16| matches!(node(id).map(|n| &n.kind), Some(NodeKind::Syntax(k)) if *k == kind);
    let base = syntax_children(snapshot, declaration)
        .into_iter()
        .filter(|child| is(*child, syntax::HERITAGE_CLAUSE))
        .flat_map(|clause| syntax_children(snapshot, clause))
        .find_map(|expression| syntax_children(snapshot, expression).first().copied())?;
    gtype_function(snapshot, node(base)?.symbol?)
}

/// The function answering the `GType` of the class `symbol` names -- in a
/// heritage clause or on the right of `instanceof`: a class the program wrote
/// over a `GObject` class, its own ([`PROGRAM_GTYPE`]), which registers it;
/// or a binding's, the `@ntsGType` on the `__c_gtype` member of its value.
/// `None` for any other class.
pub(crate) fn gtype_function(snapshot: &SemanticSnapshot, symbol: SymbolId) -> Option<String> {
    let node = |id: NodeId| snapshot.nodes.get(id.0 as usize);
    let is = |id: NodeId, kind: u16| matches!(node(id).map(|n| &n.kind), Some(NodeKind::Syntax(k)) if *k == kind);
    let mut record = snapshot.symbols.get(symbol.0 as usize)?;
    while let Some(aliased) = record.aliased {
        record = snapshot.symbols.get(aliased.0 as usize)?;
    }
    // A class the program wrote over one, `class Derived extends Base`: the
    // `GType` function the backends define for it, which registers `Base`
    // before `Derived` asks for it as its parent.
    if let Some(class) = record.declarations.iter().copied().find(|d| is(*d, syntax::CLASS_DECLARATION)) {
        gobject_parent(snapshot, class)?;
        let name = syntax_children(snapshot, class).into_iter().find_map(|child| {
            let node = node(child)?;
            matches!(node.kind, NodeKind::Syntax(syntax::IDENTIFIER)).then(|| node.text.clone()).flatten()
        })?;
        return Some(format!("{PROGRAM_GTYPE}{name}"));
    }
    let value = record.declarations.iter().copied().find(|d| is(*d, syntax::VARIABLE_DECLARATION))?;
    // The tag is on a member of the value's type literal, a few levels down.
    let mut pending = vec![value];
    while let Some(at) = pending.pop() {
        if let Some(gtype) = node(at).and_then(|n| n.native.as_ref()).and_then(|n| n.gtype.clone()) {
            return Some(gtype);
        }
        pending.extend(syntax_children(snapshot, at));
    }
    None
}

/// Whether a class declaration binds an Objective-C class (`@ntsClass`).
pub(crate) fn is_objc_class(snapshot: &SemanticSnapshot, declaration: NodeId) -> bool {
    objc_tag(snapshot, declaration).is_some()
}

/// The name the Objective-C runtime knows a class declaration by: a binding's
/// `@ntsClass`, or a class the program writes over one, its own name.
pub(crate) fn objc_name(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<String> {
    if let Some(tag) = objc_tag(snapshot, declaration) {
        return Some(tag.to_owned());
    }
    if !extends_objc(snapshot, declaration) {
        return None;
    }
    syntax_children(snapshot, declaration).into_iter().find_map(|child| {
        let node = snapshot.nodes.get(child.0 as usize)?;
        matches!(node.kind, NodeKind::Syntax(syntax::IDENTIFIER)).then(|| node.text.clone()).flatten()
    })
}

/// The class a class declaration extends, where it is one this program's
/// classes can name.
pub(crate) fn superclass(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<NodeId> {
    base_class(snapshot, declaration)
}

/// The `@ntsClass` a class declaration carries.
/// A composable Windows Runtime class a binding declares (`@ntsComposable`):
/// the framework's, every member a vtable call or an override a subclass
/// writes, none a function of this program.
pub(crate) fn is_com_class(snapshot: &SemanticSnapshot, declaration: NodeId) -> bool {
    composable_tag(snapshot, declaration).is_some()
}

/// Whether a class the program writes extends a composable Windows Runtime
/// class: `class App extends Application`.
pub(crate) fn extends_com(snapshot: &SemanticSnapshot, declaration: NodeId) -> bool {
    composable_base(snapshot, declaration).is_some()
}

/// The composable class a class the program writes extends, nearest first,
/// as its binding's `@ntsComposable` says. `None` for a binding's own class,
/// and for a class written over nothing composable.
pub(crate) fn composable_base(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<super::Composable> {
    if is_com_class(snapshot, declaration) {
        return None;
    }
    let mut at = base_class(snapshot, declaration);
    while let Some(base) = at {
        if let Some(tag) = composable_tag(snapshot, base) {
            let words: Vec<&str> = tag.split_whitespace().collect();
            return match words.as_slice() {
                [class, factory, slot, rest @ ..] => Some(super::Composable {
                    class: (*class).to_owned(),
                    factory: (*factory).to_owned(),
                    slot: slot.parse().ok()?,
                    xaml: rest == ["xaml"],
                    forwarded: Vec::new(),
                }),
                _ => None,
            };
        }
        at = base_class(snapshot, base);
    }
    None
}

fn composable_tag(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<&str> {
    snapshot.nodes.get(declaration.0 as usize)?.native.as_ref()?.composable.as_deref()
}

fn objc_tag(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<&str> {
    snapshot.nodes.get(declaration.0 as usize)?.native.as_ref()?.class.as_deref()
}

/// The class declaration a symbol names, through an import.
fn class_declaration(snapshot: &SemanticSnapshot, symbol: SymbolId) -> Option<NodeId> {
    let mut record = snapshot.symbols.get(symbol.0 as usize)?;
    while let Some(aliased) = record.aliased {
        record = snapshot.symbols.get(aliased.0 as usize)?;
    }
    record.declarations.iter().copied().find(|declaration| {
        matches!(snapshot.nodes.get(declaration.0 as usize).map(|n| &n.kind), Some(NodeKind::Syntax(syntax::CLASS_DECLARATION)))
    })
}

/// The class a class declaration extends. Of its heritage clauses, the one
/// naming a class: `implements` names interfaces.
fn base_class(snapshot: &SemanticSnapshot, declaration: NodeId) -> Option<NodeId> {
    let node = |id: NodeId| snapshot.nodes.get(id.0 as usize);
    let is = |id: NodeId, kind: u16| matches!(node(id).map(|n| &n.kind), Some(NodeKind::Syntax(k)) if *k == kind);
    syntax_children(snapshot, declaration)
        .into_iter()
        .filter(|child| is(*child, syntax::HERITAGE_CLAUSE))
        .flat_map(|clause| syntax_children(snapshot, clause))
        .filter_map(|expression| syntax_children(snapshot, expression).first().copied())
        .filter_map(|name| node(name)?.symbol)
        .find_map(|symbol| class_declaration(snapshot, symbol))
}

/// The interfaces a class declaration names in its heritage clauses: those an
/// `implements` lists, and any an `extends` names that is not a class.
pub(crate) fn implemented(snapshot: &SemanticSnapshot, declaration: NodeId) -> Vec<NodeId> {
    let node = |id: NodeId| snapshot.nodes.get(id.0 as usize);
    let is = |id: NodeId, kind: u16| matches!(node(id).map(|n| &n.kind), Some(NodeKind::Syntax(k)) if *k == kind);
    syntax_children(snapshot, declaration)
        .into_iter()
        .filter(|child| is(*child, syntax::HERITAGE_CLAUSE))
        .flat_map(|clause| syntax_children(snapshot, clause))
        .filter_map(|expression| syntax_children(snapshot, expression).first().copied())
        .filter_map(|name| node(name)?.symbol)
        .filter_map(|symbol| {
            let mut record = snapshot.symbols.get(symbol.0 as usize)?;
            while let Some(aliased) = record.aliased {
                record = snapshot.symbols.get(aliased.0 as usize)?;
            }
            record.declarations.iter().copied().find(|declaration| is(*declaration, syntax::INTERFACE_DECLARATION))
        })
        .collect()
}

/// A node's children, with the lists between them seen through: a class's
/// heritage clauses, and a clause's types, sit in list nodes of no syntax kind.
fn syntax_children(snapshot: &SemanticSnapshot, id: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    for &child in snapshot.nodes.get(id.0 as usize).map(|n| n.children.as_slice()).unwrap_or_default() {
        if matches!(snapshot.nodes.get(child.0 as usize).map(|n| &n.kind), Some(NodeKind::Syntax(_))) {
            out.push(child);
        } else {
            out.extend(syntax_children(snapshot, child));
        }
    }
    out
}

/// `ObjcMeta<Tag>`: the name of the Objective-C class whose class object a
/// value of this type is.
pub(crate) fn objc_meta(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<String> {
    marker(snapshot, ty, "___objc_meta").and_then(|tag| text(snapshot, tag)).map(str::to_owned)
}

/// A `Struct<...>` describes native storage; constructing its phantom marker as a
/// managed JS object is not constructing that storage.
#[must_use]
pub fn is_layout(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    marker(snapshot, ty, "___c_struct").is_some() || marker(snapshot, ty, "___c_union").is_some()
}

fn pointer_within(snapshot: &SemanticSnapshot, ty: TypeId, visiting: &mut Vec<TypeId>) -> Option<Pointee> {
    if visiting.contains(&ty) { return None; }
    visiting.push(ty);
    let answer = pointer_body(snapshot, ty, visiting);
    visiting.pop();
    answer
}

fn pointer_body(snapshot: &SemanticSnapshot, ty: TypeId, visiting: &mut Vec<TypeId>) -> Option<Pointee> {
    if let TypeKind::Union(parts) = &snapshot.types.get(ty.0 as usize)?.kind {
        let [a, b] = parts.as_slice() else { return None; };
        let is_null = |id: TypeId| matches!(snapshot.types[id.0 as usize].kind, TypeKind::Null);
        let payload = if is_null(*a) { *b } else if is_null(*b) { *a } else { return None; };
        return pointer_within(snapshot, payload, visiting);
    }
    if let Some(class) = objc_class(snapshot, ty) {
        return Some(class);
    }
    if let Some(protocol) = objc_protocol(snapshot, ty) {
        return Some(protocol);
    }
    if let Some(handle) = handle(snapshot, ty) {
        // `Const<H>` -- the same handle, read-only through this view: C's
        // `const GtkBitset *`. The marker is optional, so a plain handle is
        // assignable to it, which is C's own qualification conversion.
        let constant = property(snapshot, ty, "___c_const").is_some_and(|p| p.optional && p.readonly);
        // `Erased<H>` -- the same handle, spelled `void *` where C erases it.
        let erased = property(snapshot, ty, "___c_erased").is_some_and(|p| p.optional && p.readonly);
        if erased {
            return Some(Pointee::Void);
        }
        return Some(if constant { Pointee::Const(Box::new(handle)) } else { handle });
    }
    // `Flexible<T>` -- `T name[]`, storage with no extent. Read before the
    // pointer cases for the reason the others are: it is the thing a pointer to
    // it would point at, not a pointer.
    if let Some(element) = marker(snapshot, ty, "___c_flexible") {
        return Some(super::Pointee::Flexible(Box::new(storage(snapshot, element)?)));
    }
    // `Bits<T, N>` -- N bits of a T-sized unit. Read before the pointer cases
    // for the reason `CArray` is: it is not a pointer, and not a thing anything
    // may point at.
    //
    // The marker is spelled with **three** leading underscores here and two in
    // `libc.d.ts`. That is not a typo on either side: TypeScript escapes a
    // property name beginning with `__` by prefixing another one, so `__c_bits`
    // is `___c_bits` by the time it reaches a snapshot. Every native marker in
    // this file has the same shape, and getting it wrong is silent -- the
    // lookup simply never matches and the type falls through to "not native".
    if let Some(unit) = marker(snapshot, ty, "___c_bits")
        && let Some(width) = marker(snapshot, ty, "___c_width")
    {
        let TypeKind::Literal(LiteralValue::Number(width)) =
            &snapshot.types.get(width.0 as usize)?.kind
        else {
            return None;
        };
        let unit = scalar(snapshot, unit)?;
        // A width, so the same rule the length follows: a fractional or
        // out-of-range literal is not a small width, it is not a width. And a
        // bit-field may not be wider than its unit -- C says so, and a wider
        // one would make the recomputed layout disagree with the header's in a
        // way that reads as a packing bug rather than as a bad declaration.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::float_cmp)]
        let width = {
            let written = *width;
            if !(1.0..=64.0).contains(&written) {
                return None;
            }
            let narrowed = written as u32;
            let unit_bits = crate::hir::layout::shape_of(&unit.representation())?
                .size
                .checked_mul(8)?;
            if f64::from(narrowed) != written || narrowed > unit_bits {
                return None;
            }
            narrowed
        };
        return Some(super::Pointee::Bits { unit, width });
    }
    // `CArray<T, N>` -- storage of N elements inline. Read before the pointer
    // cases because it is not a pointer: it is the thing a pointer to it would
    // point at, and the length is part of the layout rather than of a value.
    if let Some(element) = marker(snapshot, ty, "___c_array")
        && let Some(count) = marker(snapshot, ty, "___c_length")
    {
        let TypeKind::Literal(LiteralValue::Number(length)) = &snapshot.types.get(count.0 as usize)?.kind
        else {
            return None;
        };
        // A count, so a fractional or out-of-range literal is not a small count
        // -- it is not a count. `CArray<c_char, 64.5>` truncating to 64 would
        // produce a struct 65 bytes short of the one the header defines, and
        // the only thing that would have noticed is the witness.
        //
        // `float_cmp` is allowed because exact equality is the question: the
        // cast is accepted exactly when it round-trips, which is what makes
        // the truncation the other two lints warn about unreachable.
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::float_cmp
        )]
        let length = {
            let count = *length;
            if !(count >= 1.0 && count <= f64::from(u32::MAX)) {
                return None;
            }
            let narrowed = count as u32;
            if f64::from(narrowed) != count {
                return None;
            }
            narrowed
        };
        let inner = if let Some(scalar) = scalar(snapshot, element) {
            Pointee::Scalar(scalar)
        } else {
            pointer_within(snapshot, element, visiting)?
        };
        return Some(Pointee::Array { element: Box::new(inner), length });
    }
    let element = marker(snapshot, ty, "___c_pointer")?;
    // `ConstPtr<T>` is `Ptr<T>` without the writable marker. The marker sits on
    // the *mutable* type on purpose: the const one is then the smaller of the
    // two, so a `Ptr<T>` satisfies a `ConstPtr<T>` and not the reverse, which is
    // exactly the one direction C converts. A marker on the const type would
    // invert that and make every call site convert explicitly.
    let writable = marker(snapshot, ty, "___c_writable").is_some();
    let qualify = |pointee: Pointee| {
        if writable { pointee } else { Pointee::Const(Box::new(pointee)) }
    };
    // `Ptr<unknown>` is C's `void *`. Only `unknown`: `Ptr<any>` stays refused,
    // because `any` is what a program ends up with by accident and `unknown` is
    // what someone writes on purpose. `TypeKind::Unsupported` is a third thing
    // again -- the checker telling us it rendered something we do not model --
    // and reading that as `void *` would turn every unmodelled type into a
    // pointer nobody declared.
    //
    // `Ptr<void>` is the same pointer, spelled the way C and every generated
    // binding spell it (`LPVOID`, `void *`). Like `unknown`, `void` reaches
    // here only by being written: nothing infers it as a pointee.
    if matches!(snapshot.types.get(element.0 as usize)?.kind, TypeKind::Unknown | TypeKind::Void) {
        return Some(qualify(Pointee::Void));
    }
    if let Some(scalar) = scalar(snapshot, element) { return Some(qualify(Pointee::Scalar(scalar))); }
    if let Some(layout) = structure(snapshot, element, visiting, false) { return Some(qualify(Pointee::Record(layout.into()))); }
    pointer_within(snapshot, element, visiting).map(|p| qualify(Pointee::Pointer(Box::new(p))))
}

/// `within_header` is whether the record *holding* this one is defined by a
/// header, which is what makes an untagged member type inferable rather than
/// something a binding has to mark.
///
/// A header-defined record's members are the header's, so a member whose type
/// carries no tag cannot be a layout this program invented -- the header
/// defines the struct, and therefore its members' types. It must be the
/// header's own untagged one. That inference is why the surface has no marker
/// for it: the author would have been restating what the enclosing tag already
/// says.
fn structure(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    visiting: &mut Vec<TypeId>,
    within_header: bool,
) -> Option<Record> {
    // `Struct<F, Tag>` and `Union<F, Tag>` differ in one marker and nothing
    // else: the same member list, read the same way, laid out differently.
    let (shape, kind) = match marker(snapshot, ty, "___c_struct") {
        Some(shape) => (shape, RecordKind::Struct),
        None => (marker(snapshot, ty, "___c_union")?, RecordKind::Union),
    };
    // `Packed<T>` intersects a marker in, so this reads through to the `T`.
    let packed = marker(snapshot, ty, "___c_packed").is_some();
    let tag = text(snapshot, marker(snapshot, ty, "___c_tag")?)?;
    let TypeKind::Object { properties } = &snapshot.types.get(shape.0 as usize)?.kind else { return None; };
    if properties.is_empty() { return None; }
    let declarations = properties.iter().map(|p| p.declaration).collect::<Option<Vec<_>>>()?;
    let parent = snapshot.nodes[declarations[0].0 as usize].parent?;
    if declarations.iter().any(|id| snapshot.nodes[id.0 as usize].parent != Some(parent)) { return None; }
    // Decided before the members are read, because a member's own answer
    // depends on it: a record this header defines makes its untagged members
    // the header's too, however deep.
    let foreign = !tag.is_empty();
    let from_header = foreign.then(|| declaring_module(snapshot, parent)).flatten();
    // `Typedef<...>` says the name is a typedef rather than a tag, which
    // changes only how C spells the type. Read before the tagged case, which it
    // is otherwise identical to.
    let naming = if foreign && marker(snapshot, ty, "___c_typedef").is_some() {
        super::Naming::Typedef { from_header }
    } else if foreign {
        super::Naming::Tagged { from_header }
    } else if within_header {
        super::Naming::Untagged
    } else {
        super::Naming::Invented
    };
    let members_are_the_header_s = from_header.is_some() || within_header;
    let mut ordered: Vec<_> = properties.iter().collect();
    ordered.sort_by_key(|p| snapshot.nodes[p.declaration.map_or(0, |id| id.0) as usize].origin.location.span.start);
    let mut fields = Vec::new();
    for property in ordered {
        // Inheritance, optional fields, methods and synthesized members do not
        // define a C declaration order. Refuse until their contract is explicit.
        if property.optional || property.kind != MemberKind::Field || property.declaration.is_none() { return None; }
        // A struct-typed member is stored *inline*, the way C stores it: the
        // nested layout's bytes sit in this one, and `native_shape` already
        // knew how to size and align that. It is tried before the pointer case
        // because a `Struct<...>` is not a pointer and would otherwise be
        // refused as one.
        //
        // `visiting` is what stops a type that contains itself by value. C has
        // no such type -- a struct may contain a pointer to itself, never a
        // copy -- so the guard refuses rather than recursing, and the pointer
        // form remains available and is unaffected.
        // A member's own type, which for an array is the array and not a
        // pointer to one: `char name[65]` occupies 65 bytes here, and the
        // pointer path below would have made it 8. Tried before that path for
        // the same reason the struct case is.
        let ty = if let Some(scalar) = scalar(snapshot, property.ty) {
            Pointee::Scalar(scalar)
        } else if let Some(
            inline @ (Pointee::Array { .. } | Pointee::Bits { .. } | Pointee::Flexible(_)),
        ) =
            pointer_body(snapshot, property.ty, visiting)
        {
            // Two member types that are neither a scalar nor a pointer, and
            // both resolved by the helper that reads the surface's markers. A
            // bit-field is here rather than beside `scalar` above because
            // `Bits<c_uint, 4>` is an object type carrying markers, not a
            // branded number -- `scalar` would not recognise it and the
            // pointer path below would have made it an address, which is the
            // one thing a bit-field does not have.
            inline
        } else if !visiting.contains(&property.ty)
            && let Some(inner) = {
                visiting.push(property.ty);
                let inner = structure(snapshot, property.ty, visiting, members_are_the_header_s);
                visiting.pop();
                inner
            }
        {
            Pointee::Record(inner.into())
        } else if let Some(signature) = super::fn_pointer(snapshot, property.ty) {
            // A member written as an ordinary TypeScript function type, which
            // at a C boundary can mean one thing -- `struct sigaction` and
            // every registration table in C is this shape. It is read by the
            // same function a *parameter* goes through, because a
            // function-typed member is a function pointer for the same reason
            // a function-typed parameter is.
            Pointee::Pointer(Box::new(Pointee::FnPointer(signature)))
        } else {
            Pointee::Pointer(Box::new(pointer_within(snapshot, property.ty, visiting)?))
        };
        let name = property.name.strip_prefix("___").map_or_else(|| property.name.clone(), |rest| format!("__{rest}"));
        fields.push(Field { name, ty });
    }
    let name = if foreign { tag.to_owned() } else { format!("NtsNative_Type{}", shape.0) };
    // An anonymous record is the header's, so nothing about it is this
    // program's to define -- but it has no tag either, so `foreign` cannot
    // carry that. The two facts are separate and both are recorded.
    Some(Record {
        name,
        fields,
        kind,
        naming,
        packed,
    })
}

/// Whether the scope that declared this struct named any header.
///
/// Walks out from the type literal to the enclosing `declare module` or source
/// file, which are the two scopes a header tag can sit on. It answers *whether*
/// and not *which*: a module may name several headers, all of them are included
/// together, and which one carries a given tag is the C compiler's to know --
/// claiming to know it here would be a second derivation of a fact the
/// preprocessor already holds, and the two could disagree.
/// The enclosing declaration whose `@ntsHeader` covers `from`, if any.
///
/// **Which one, not whether.** It answered `bool` and the identity it had just
/// found was discarded, so a program had no way to say which headers it needs
/// and carried every one in the snapshot -- `native-stat` compiled with seven
/// and used one.
pub(crate) fn declaring_module(
    snapshot: &SemanticSnapshot,
    from: nts_semantic_schema::NodeId,
) -> Option<nts_semantic_schema::NodeId> {
    let mut at = Some(from);
    while let Some(id) = at {
        let node = snapshot.nodes.get(id.0 as usize)?;
        if node.native.as_ref().is_some_and(|native| {
            native.headers.as_ref().is_some_and(|headers| !headers.is_empty())
        }) {
            return Some(id);
        }
        at = node.parent;
    }
    None
}

/// Storage named by a native type argument; pointer types occupy one word.
#[must_use]
pub fn storage(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    if let Some(scalar) = scalar(snapshot, ty) { return Some(Pointee::Scalar(scalar)); }
    if let Some(layout) = structure(snapshot, ty, &mut Vec::new(), false) { return Some(Pointee::Record(layout.into())); }
    pointer(snapshot, ty).map(|p| Pointee::Pointer(Box::new(p)))
}
