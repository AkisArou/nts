//! The classes this compiler provides rather than reads.
//!
//! # Why `Error` cannot come from `lib.d.ts`
//!
//! Every other class this compiler lays out is decomposed from the checker's
//! own type, and `Error` cannot be. Its declared interface has `stack?: string`
//! and `cause?: unknown`, and an optional property is refused here because it
//! needs a presence bit, which changes the layout rather than adding to it.
//!
//! So `class MyError extends Error {}` — which is how every error in a real
//! TypeScript program is written — failed for a reason that had nothing to do
//! with errors, and reported the *base* as unrepresentable, which was true and
//! unhelpful.
//!
//! The answer is not to widen what a layout can hold. It is to say what an
//! `Error` is in a compiled program: a message and a name. `stack` is a record
//! of frames a compiled binary does not keep, and refusing to read one is
//! better than a field that is always empty.
//!
//! # What a subclass gets
//!
//! The checker's property list is flattened, so `class CodedError extends Error
//! { code: string }` arrives with `code`, `name`, `message`, `stack?` and
//! `cause?` all at one level. What separates them is `PropertyRecord::own`,
//! which the schema already carries: `code` is the class's own and the rest
//! came from the base. So a descendant's layout is *this* module's fields
//! followed by the properties the class declares itself — which is the
//! base-first rule every other hierarchy here already follows.

use super::{Field, HirType, ManagedType};

/// The error classes this compiler provides.
///
/// Several rather than one because they are distinguishable at run time —
/// `assert.throws(fn, TypeError)` is an `instanceof` check, and code that
/// branches on which error it caught is ordinary. They hold the same two
/// fields, so this is a list rather than five definitions.
///
/// **Append only.** The position is the class's identity as a value: it picks
/// the type in [`super::provided_error_type`] and the token in
/// [`super::constructor_token`], so inserting one renames every class after it.
///
/// `SyntaxError` is here because a parser cannot be written without it, and a
/// function that can raise one was refused entirely — which kept a complete,
/// specification-exact JSON parser in `runtime/web-platform` off the compiled
/// axis, along with every function that calls it. A class absent from this list
/// does not merely fail where it is thrown; it refuses its caller, and its
/// caller's caller.
pub(super) const ERRORS: &[&str] = &[
    "Error",
    "TypeError",
    "RangeError",
    "URIError",
    "SyntaxError",
    // `EvalError` and `ReferenceError` are one site each in `runtime/node` and
    // are here for what a missing one *costs* rather than for the sites: a
    // class absent from this list refuses its caller and its caller's caller,
    // so the cheap ones are worth having before something behind them is found
    // the expensive way.
    "EvalError",
    "ReferenceError",
    // **Appended, not inserted**, because the paragraph above says an insertion
    // renames every class after it -- the type and the token are both this
    // list's index.
    //
    // It is here for what its absence *cascaded* into rather than for the sites
    // that throw one. `NodeAggregateError extends AggregateError`, so without a
    // layout for the base the subclass had none, and reading `.code` across the
    // five `instanceof`-narrowed arms of `knownErrorCode` refused as `code` on a
    // union one of whose members has no layout -- in `internal/errors.ts`, which
    // every module imports. Traced rather than guessed: a user class carrying an
    // array field compiles and reads through a union perfectly well, so it was
    // the base being unprovided and not the array.
    "AggregateError",
];

/// The extra field `AggregateError` holds, beyond what every error holds.
///
/// **A real field rather than an omission**, and the difference is a wrong
/// answer that runs. `errors` is read nowhere in `runtime/node`, so leaving it
/// out would have cost nothing a reader could see -- but three sites
/// *construct* one with it, `new NodeAggregateError([outer, inner], message,
/// code)` among them, and a constructor argument that is accepted and discarded
/// is exactly the shape [`OMITTED`] cannot express. `OMITTED` names a member so
/// that *reading* it says why it is absent; it says nothing about writing.
const AGGREGATE_ERRORS_FIELD: &str = "errors";

/// Members of the declared `Error` that this compiler does not provide.
///
/// Named, rather than left to fail as "a property the type does not declare",
/// so that reading one says *why* it is absent.
pub(super) const OMITTED: &[(&str, &str)] = &[
    ("stack", "a compiled binary keeps no record of its frames"),
    (
        "cause",
        "the chained error would have to be a reference to any error type",
    ),
];

/// Whether a name is one of the provided error classes.
pub(super) fn is_error(name: &str) -> bool {
    ERRORS.contains(&name)
}

/// Which provided error class a name is, by position in [`ERRORS`].
///
/// The position is the class's identity as a *value*: it picks the token type
/// in [`super::constructor_token`], so two mentions of `TypeError` anywhere in
/// a program name one object. A list rather than a map because there are a
/// handful of them and the order *is* the identity -- which is also why
/// [`ERRORS`] is appended to and never inserted into.
pub(super) fn error_index(name: &str) -> Option<usize> {
    ERRORS.iter().position(|error| *error == name)
}

/// The layout of a class used as a *value*.
///
/// Empty, and that is the whole of it: the object exists to have an address.
/// Nothing reads a field of `TypeError`-the-value, because the only things a
/// program does with it are compare it, ask its `typeof`, and pass it along.
///
/// Named, because an empty shape is a shape `Layout::same_shape` cannot tell
/// from another empty one -- the third family with that problem, after the
/// error classes themselves and the function types of record 0096, and the
/// third for the same reason. `collect_layouts` refuses to merge two of these
/// with different names.
pub(super) fn constructor_name(name: &str) -> String {
    format!("Ctor_{name}")
}

/// Whether a layout name is a constructor token's.
///
/// **Any `Ctor_`, not only a provided error's.** A class used as a value is an
/// empty layout whose name is its whole identity, so `Ctor_IncomingMessage` and
/// `Ctor_ServerResponse` are two tokens that `Layout::same_shape` cannot tell
/// apart -- and merging them would make `opts.IncomingMessage ?? IncomingMessage`
/// and its `ServerResponse` neighbour one value, so a program asking which it
/// got would be told the wrong one with nothing emitted to say so.
///
/// Widening this is what enrols user class tokens in `nominal_name`'s rule: a
/// layout whose name is its identity does not merge with a differently-named
/// one. A user class actually spelled `Ctor_Foo` is then treated as nominal
/// too, which costs a merge that was only ever an optimization.
pub(super) fn is_constructor_name(name: &str) -> bool {
    name.starts_with("Ctor_")
}

/// Why a member of the declared `Error` is absent here, if it is one.
pub(super) fn omitted(name: &str) -> Option<&'static str> {
    OMITTED
        .iter()
        .find(|(member, _)| *member == name)
        .map(|(_, reason)| *reason)
}

/// What every provided error class holds.
///
/// `name` is a field rather than a constant on the layout because constructors
/// write it: a subclass that wants `e.name` to be its own sets `this.name`
/// after `super(...)`, which is what Node's error classes do.
///
/// Neither is `readonly`: `e.message = ...` is legal JavaScript, and a
/// `readonly` field here would be a claim about the program rather than about
/// the type.
pub(super) fn error_fields(class: &str) -> Vec<Field> {
    let mut fields: Vec<Field> = ["message", "name"]
        .into_iter()
        .map(|name| Field {
            name: name.to_owned(),
            ty: HirType::Managed(ManagedType::String),
            readonly: false,
            declared_by: None,
        })
        .collect();
    // **After the shared two, which is what keeps base-first layout true.**
    // `AggregateError extends Error` in the specification, so an `Error` reaching
    // a slot declared for it must find `message` and `name` at the same indices,
    // and a subclass of `AggregateError` must find all three. Putting `errors`
    // first would have been correct only for programs that never mix them.
    if class == "AggregateError" {
        fields.push(Field {
            name: AGGREGATE_ERRORS_FIELD.to_owned(),
            // **The array erased, not an array of erased values**, and the
            // difference is a representation change rather than a cast.
            //
            // `Array(Erased)` was the first spelling and the verifier rejected
            // it: `new AggregateError([new Error("x")], "m")` passes an
            // `Array(Object(Error))`, and an array of pointers is not an array
            // of tagged values, so storing one in the other is a per-element
            // conversion that nothing here is entitled to insert. `Erased`
            // takes the whole array in one `Erase`, which is the operation this
            // compiler already has for exactly this.
            //
            // The cost is stated rather than hidden: reading `.errors` gets an
            // erased value and refuses to be an array until something casts it
            // back. Nothing in `runtime/node` reads it -- checked, zero sites --
            // and the point of storing it at all is that three sites *write*
            // one. A constructor argument accepted and discarded is a wrong
            // answer that runs; a value stored and not yet readable is a
            // refusal with a name on it.
            ty: HirType::Erased,
            readonly: false,
            declared_by: None,
        });
    }
    fields
}

/// What each typed array stores, if the name is one.
///
/// A typed array needs no representation of its own: it is an ordinary
/// [`ManagedType::Array`] whose element width was *written down* rather than
/// inferred. `hir::elements` decides that a `number[]` holding small whole
/// numbers can be an `int32_t[]`; `Int32Array` is the same storage, chosen by
/// the author instead of proved by the compiler. So the descriptors, the bounds
/// checks, the escape analysis and the reference counting all already work on
/// one.
///
/// `Uint8ClampedArray` is deliberately absent. It stores by *clamping* to
/// `[0, 255]` where the others wrap, and giving it the wrapping conversion
/// would be silently wrong for exactly the inputs anyone would notice.
/// `BigInt64Array` and `BigUint64Array` are absent because `bigint` is.
pub(super) fn typed_array_element(name: &str) -> Option<HirType> {
    let int = |bits, signed| HirType::Int { bits, signed };
    Some(match name {
        "Int8Array" => int(8, true),
        "Uint8Array" => int(8, false),
        "Int16Array" => int(16, true),
        "Uint16Array" => int(16, false),
        "Int32Array" => int(32, true),
        "Uint32Array" => int(32, false),
        "Float32Array" => HirType::Float { bits: 32 },
        "Float64Array" => HirType::Float { bits: 64 },
        _ => return None,
    })
}

/// Which of the runtime's nine element kinds an element type is.
///
/// The width does not answer this: `Int16Array` and `Uint16Array` are two bytes
/// each and differ on read, `Int32Array` and `Float32Array` are four each and
/// differ on both. `set` between two views converts *values*, so the runtime
/// stores the kind rather than inferring it from a width.
///
/// The numbers are `NTS_ELEMENT_*` in `nts_runtime.h`. `Uint8ClampedArray` is
/// absent from [`typed_array_element`] -- clamping is a different store, and
/// giving it the wrapping conversion would be silently wrong -- so its kind is
/// unreachable from here until the name is accepted.
///
/// `Option`, and deliberately no catch-all. A `_ => 8` arm reads as a default
/// and is a trap: an element this does not name would become `f64` silently, on
/// C and LLVM, with no diagnostic anywhere. Every element reaches a real arm
/// today, so the arm would be harmless -- and the day `BigInt64Array` gets a
/// lowering its element becomes a double and nothing says so. That is the same
/// shape as a `let else` on `ManagedType::Array` that a view falls through, and
/// it cost a wrong answer once already this week.
///
/// Kind 2 is `Uint8ClampedArray`, which [`typed_array_element`] does not accept:
/// clamping and wrapping disagree on exactly the inputs typed-array code is
/// written for, so the slot is reserved rather than aliased onto `u8`.
#[must_use]
pub(super) fn element_kind(element: &HirType) -> Option<u32> {
    Some(match element {
        HirType::Int { bits: 8, signed: true } => 0,
        HirType::Int { bits: 8, signed: false } => 1,
        HirType::Int { bits: 16, signed: true } => 3,
        HirType::Int { bits: 16, signed: false } => 4,
        HirType::Int { bits: 32, signed: true } => 5,
        HirType::Int { bits: 32, signed: false } => 6,
        HirType::Float { bits: 32 } => 7,
        HirType::Float { bits: 64 } => 8,
        _ => return None,
    })
}

/// Bytes per element, which the kind decides.
#[must_use]
pub(super) fn element_width(element: &HirType) -> Option<u32> {
    Some(match element {
        HirType::Int { bits, .. } | HirType::Float { bits } => u32::from(*bits) / 8,
        _ => return None,
    })
}

/// The runtime helper that turns a `number` into what a typed array stores.
///
/// Storing into an integer typed array is not a cast. `u8[i] = 300` stores 44,
/// `i32[i] = 1.7` stores 1, and `u8[i] = NaN` stores 0 — ECMAScript truncates
/// toward zero and then takes the value modulo the width, with the
/// non-finite cases going to zero. C's `(uint8_t)someDouble` is *undefined
/// behaviour* for every one of those inputs, so the conversion is a named
/// helper rather than a cast the backend guesses at.
///
/// `None` for the floating-point arrays: `double` to `float` is a defined
/// narrowing conversion and `double` to `double` is nothing at all.
pub(super) fn element_coercion(element: &HirType) -> Option<&'static str> {
    match element {
        HirType::Int {
            bits: 8,
            signed: true,
        } => Some("nts_to_int8"),
        HirType::Int {
            bits: 8,
            signed: false,
        } => Some("nts_to_uint8"),
        HirType::Int {
            bits: 16,
            signed: true,
        } => Some("nts_to_int16"),
        HirType::Int {
            bits: 16,
            signed: false,
        } => Some("nts_to_uint16"),
        HirType::Int {
            bits: 32,
            signed: true,
        } => Some("nts_to_int32"),
        HirType::Int {
            bits: 32,
            signed: false,
        } => Some("nts_to_uint32"),
        _ => None,
    }
}

/// The runtime helpers whose result the specification leaves approximate.
///
/// ECMAScript divides `Math` in two. `abs`, `sign`, `floor`, `ceil`, `trunc`,
/// `round`, `sqrt`, `fround`, `min`, `max` and the named constants each have
/// exactly one correct answer for every input, and this compiler must produce
/// it. The rest are *implementation-approximated*: the specification names the
/// mathematical function, requires the special cases, and lets the
/// implementation choose how closely it lands on the rest. It recommends
/// fdlibm; it does not require it.
///
/// So bit-equality with node is not the oracle for these, and treating it as
/// one would make a green differential mean "glibc agreed with V8 today".
/// Measured over a pool built to reach the hard cases, the two differ by up to
/// 2 ULP -- `pow` included, where `Math.pow(0.9999999999999999, 0.5)` is
/// exactly `1` under glibc and the next double below it under V8.
///
/// Naming them here rather than in the differential keeps the classification
/// with the runtime that has to honour it: a helper added to one list without
/// the other is a helper whose oracle is wrong.
pub const APPROXIMATED: &[&str] = &[
    "nts_math_pow",
    "nts_math_atan2",
    "nts_math_hypot",
    "nts_math_cbrt",
    "nts_math_exp",
    "nts_math_expm1",
    "nts_math_log",
    "nts_math_log2",
    "nts_math_log10",
    "nts_math_log1p",
    "nts_math_sin",
    "nts_math_cos",
    "nts_math_tan",
    "nts_math_asin",
    "nts_math_acos",
    "nts_math_atan",
    "nts_math_sinh",
    "nts_math_cosh",
    "nts_math_tanh",
];

/// The functions an implementation-approximated result can reach.
///
/// Transitive, because the property travels: a function that returns
/// `helper(x)` is as approximate as `helper`. Call edges only -- a value that
/// reaches a *branch* rather than the result can diverge by any amount at all,
/// and no tolerance would be the right answer for that. It shows up as an
/// ordinary disagreement, which is what it is.
#[must_use]
pub fn approximating(program: &super::Program) -> std::collections::HashSet<String> {
    let mut approximate: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut changed = true;
    while changed {
        changed = false;
        for func in &program.funcs {
            if approximate.contains(&func.name) {
                continue;
            }
            let reaches = func.values.iter().any(|op| match &op.kind {
                super::OpKind::Call {
                    callee: super::Callee::External(name),
                    ..
                } => APPROXIMATED.contains(&name.as_str()),
                super::OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } => approximate.contains(name),
                _ => false,
            });
            if reaches {
                approximate.insert(func.name.clone());
                changed = true;
            }
        }
    }
    approximate
}
