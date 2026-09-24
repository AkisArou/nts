//! What a GIR file says, and nothing it does not.
//!
//! Parsed once into owned data so that mapping and emitting never touch XML.
//! Every field is one GIR states; nothing here is inferred, which is what lets
//! the mapper be the one place a decision is made.

use std::collections::BTreeMap;

/// Every namespace a binding reaches, by name (`Gtk`, `Gdk`, `GObject`).
#[derive(Debug, Default)]
pub(crate) struct Repository {
    pub(crate) namespaces: BTreeMap<String, Namespace>,
    /// Namespaces something includes and no search directory has.
    pub(crate) missing: std::collections::BTreeSet<String>,
    /// Every GIR file read, which is what a cached binding depends on.
    pub(crate) files: Vec<camino::Utf8PathBuf>,
}

#[derive(Debug, Default)]
pub(crate) struct Namespace {
    pub(crate) name: String,
    pub(crate) version: String,
    /// `c:symbol-prefixes`: `gtk`, the first word of every C symbol.
    pub(crate) symbol_prefix: String,
    /// `<c:include>`: the headers a C program includes to use this namespace.
    pub(crate) headers: Vec<String>,
    /// `<package>`: the pkg-config names whose `--cflags` reach those headers.
    pub(crate) packages: Vec<String>,
    /// `<include>`: the namespaces this one names types from, as `(name, version)`.
    pub(crate) includes: Vec<(String, String)>,
    pub(crate) classes: Vec<Class>,
    pub(crate) records: Vec<Record>,
    pub(crate) enums: Vec<Enum>,
    pub(crate) callbacks: Vec<Callback>,
    pub(crate) functions: Vec<Callable>,
}

/// A `GObject` class or interface: an instance struct C code only points at.
#[derive(Debug)]
pub(crate) struct Class {
    pub(crate) name: String,
    pub(crate) c_type: Option<String>,
    /// Qualified (`Gtk.Widget`, `GObject.Object`); `None` for a root.
    pub(crate) parent: Option<String>,
    pub(crate) interface: bool,
    /// `c:symbol-prefix`: `button` in `gtk_button_new`, joined to the
    /// namespace's own prefix to name what a binding adds for the class.
    pub(crate) symbol_prefix: Option<String>,
    /// `<glib:signal>`: the signals instances of this class emit.
    pub(crate) signals: Vec<Signal>,
    /// `glib:get-type`: the function answering this class's `GType`.
    pub(crate) get_type: Option<String>,
    /// The type of the first field, when GIR lists fields. C makes a pointer
    /// to a struct and a pointer to its first member interconvertible, which
    /// is how `GObject` sits on `GTypeInstance` with no GIR parent to say so.
    pub(crate) first_field: Option<TypeRef>,
    pub(crate) callables: Vec<Callable>,
}

/// A signal: its name, and the handler's signature less the instance first
/// and the `user_data` last, which every handler has and GIR does not list.
#[derive(Debug)]
pub(crate) struct Signal {
    pub(crate) name: String,
    pub(crate) signature: Signature,
}

/// A C struct GIR describes: boxed types and plain records alike.
#[derive(Debug)]
pub(crate) struct Record {
    pub(crate) name: String,
    pub(crate) c_type: Option<String>,
    /// The instance-class structs of `GObject` types (`GtkWidgetClass`), which a
    /// binding never needs a handle to.
    pub(crate) class_struct: bool,
    pub(crate) callables: Vec<Callable>,
}

#[derive(Debug)]
pub(crate) struct Enum {
    pub(crate) name: String,
    pub(crate) c_type: Option<String>,
    /// A `<bitfield>`: a set of flags, whose empty set, `0`, is "none".
    pub(crate) flags: bool,
    pub(crate) members: Vec<Member>,
}

#[derive(Debug)]
pub(crate) struct Member {
    pub(crate) name: String,
    pub(crate) c_identifier: String,
    pub(crate) value: i64,
}

/// A C function pointer type: `<callback name="TickCallback">`.
#[derive(Debug)]
pub(crate) struct Callback {
    pub(crate) name: String,
    pub(crate) signature: Signature,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CallableKind {
    Function,
    Method,
    Constructor,
}

#[derive(Debug)]
pub(crate) struct Callable {
    pub(crate) name: String,
    /// The C symbol. Absent on a virtual method, which has none.
    pub(crate) c_identifier: Option<String>,
    pub(crate) kind: CallableKind,
    pub(crate) signature: Signature,
    /// `introspectable="0"`: GIR itself says a binding cannot use this.
    pub(crate) introspectable: bool,
    pub(crate) deprecated: bool,
    /// `shadowed-by`/`moved-to`: another entry is the one to bind.
    pub(crate) shadowed: bool,
    /// `glib:finish-func`: for an `_async` callable, the name of the one that
    /// reads its result.
    pub(crate) finish: Option<String>,
}

#[derive(Debug)]
pub(crate) struct Signature {
    pub(crate) instance: Option<Param>,
    pub(crate) parameters: Vec<Param>,
    pub(crate) result: Param,
    /// `throws="1"`: a trailing `GError **` the parameter list does not show.
    pub(crate) throws: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    In,
    Out,
    InOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Transfer {
    None,
    Container,
    Full,
}

/// When a callback is called, relative to the call that receives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    /// Only during the call.
    Call,
    /// Once, some time later, and then never again.
    Async,
    /// Until the destroy function beside it is called.
    Notified,
    /// For the life of the process.
    Forever,
}

#[derive(Debug, Clone)]
pub(crate) struct Param {
    pub(crate) name: String,
    pub(crate) ty: TypeRef,
    pub(crate) direction: Direction,
    pub(crate) transfer: Transfer,
    pub(crate) nullable: bool,
    /// An out parameter the caller may pass `NULL` for, to say it does not
    /// want the value.
    pub(crate) optional: bool,
    /// An out parameter whose storage the caller provides whole -- a struct
    /// the callee fills in -- rather than a slot the callee writes a value to.
    pub(crate) caller_allocates: bool,
    pub(crate) scope: Option<Scope>,
    /// Index of the `user_data` parameter this callback is handed back, among
    /// the non-instance parameters -- or, on a callback type's own parameter,
    /// that parameter's own index.
    pub(crate) closure: Option<usize>,
    /// Index of the destroy function for this callback's `user_data`.
    pub(crate) destroy: Option<usize>,
}

#[derive(Debug, Clone)]
pub(crate) enum TypeRef {
    /// `<type name="..." c:type="...">`. `name` is as GIR wrote it, qualified
    /// or not; the mapper qualifies it against the namespace it appears in.
    Named { name: String, c_type: Option<String> },
    /// `<array>`: C's pointer to elements, described by GIR.
    Array(ArrayRef),
    Varargs,
    /// No type element at all, which GIR writes for a few odd returns.
    Missing,
}

/// An `<array>` as GIR describes it.
#[derive(Debug, Clone)]
pub(crate) struct ArrayRef {
    /// The element's GIR type name: `utf8`, `guint8`, `Gtk.Widget`.
    pub(crate) element: Option<String>,
    /// The whole array's C spelling, `const gchar* const*`.
    pub(crate) c_type: Option<String>,
    /// The index, among the non-instance parameters, of the one holding the
    /// element count.
    pub(crate) length: Option<usize>,
    /// Ends with a zero element. GIR's default when neither a length nor a
    /// fixed size is given.
    pub(crate) zero_terminated: bool,
}
