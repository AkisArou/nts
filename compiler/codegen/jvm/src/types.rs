//! What a `HirType` is on the JVM: a descriptor, a computational kind, and a
//! verification type.
//!
//! # Three answers because the machine asks three questions
//!
//! The JVM has no integer type narrower than `int` *on the stack*, so a
//! `boolean`, a `byte` and a `short` are all computed as `int`s -- but a field
//! or a method parameter still spells itself `Z`, `B` or `S`, and the verifier
//! wants a fourth vocabulary again. Collapsing the three would be wrong in a
//! different place each time, so each has its own function and they are read
//! from the same match.
//!
//! # This backend's own ABI, deliberately
//!
//! Every integer narrower than 64 bits is `I` in a signature here, where the C
//! backend writes `int8_t` and `uint16_t`. Nothing links the two artifacts --
//! a class file and an object file never meet -- so the JVM lane is free to
//! take the spelling that cannot be got wrong, and the narrowing that *is*
//! observable arrives as an explicit `Convert` from the middle end rather than
//! being implied by a parameter's width.

use nts_codegen_common::symbols::jvm_class_name;
use nts_core::hir::{HirType, Layout, ManagedType, Program};
use nts_jvm_emitter::{Kind, VType};

/// The two properties the tag *numbering* exists to make true.
///
/// Asserted at compile time rather than in a test, because they are facts about
/// two constants and there is no run in which they could differ. A backend that
/// depends on `tag >= OBJECT` meaning "object" should not build against a table
/// where that is false.
///
/// A renumbering that kept every name would pass a table comparison and make
/// `typeof f` answer `"object"` in every program, so these are stated
/// separately from the table rather than implied by it.
const _: () = assert!(
    nts_core::hir::tags::NULL > nts_core::hir::tags::OBJECT,
    "`typeof x === \"object\"` is emitted as `tag >= OBJECT`, so null must be inside that range"
);
const _: () = assert!(
    nts_core::hir::tags::FUNCTION < nts_core::hir::tags::OBJECT,
    "a closure must fall outside `tag >= OBJECT`, or `typeof f` answers \"object\""
);
const _: () = assert!(
    nts_core::hir::tags::SYMBOL < nts_core::hir::tags::OBJECT,
    "a symbol must fall outside `tag >= OBJECT`, or `typeof sym` answers \"object\""
);

/// The erased value: a tag beside a payload, mirroring the C struct.
/// What a managed type with no layout is carried as; see `descriptor`.
pub const OBJECT: &str = "java/lang/Object";

pub const VALUE: &str = "nts/rt/NtsValue";
pub const VALUE_DESCRIPTOR: &str = "Lnts/rt/NtsValue;";

/// `java.lang.String`, the JVM's name for it.
pub const STRING: &str = "java/lang/String";
pub const STRING_DESCRIPTOR: &str = "Ljava/lang/String;";

/// The binary name of the class one layout becomes.
///
/// One class per `Layout`, not per source type: structural typing merges
/// `Point` and the anonymous `{ x: number; y: number }` of a literal into one
/// layout, and giving them separate classes would emit two classes that are the
/// same class and could not be passed to each other.
#[must_use]
pub fn class_name(layout: &Layout) -> String {
    jvm_class_name(&layout.name)
}

/// A promise: a settled-or-not value and the frames waiting on it.
pub const PROMISE: &str = "nts/rt/NtsPromise";

/// The environment, which owns the platform slot and the completion lane.
pub const ENV: &str = "nts/rt/NtsEnv";
pub const PROMISE_DESCRIPTOR: &str = "Lnts/rt/NtsPromise;";

/// The interface a suspended function's frame implements, so the loop can run
/// it. Created by this backend rather than recovered from the IR: `Suspend`
/// names a frame and a function, and both are emitted here.
/// The interface a zero-argument closure declares, so the runtime can call it
/// without knowing its class. See `NtsCallback`.
pub const CALLBACK: &str = "nts/rt/NtsCallback";

pub const RESUMABLE: &str = "nts/rt/NtsResumable";

/// The callback ABI: a descriptor, and the `nts.rt` interface a generated class
/// with that shape implements.
///
/// **Keyed by descriptor, not by name.** A runtime that reached a closure by
/// its class would name `nts/gen/Closure7`, and the 7 counts closures in source
/// order -- so adding a line somewhere else in the program renames the thing
/// the runtime calls. Naming the shape instead is stable under every edit that
/// does not change the shape, which is the property an ABI needs.
///
/// It is deliberately not a grid over argument kinds. A generated family of
/// `NtsCall_DLD` interfaces would cover shapes nothing uses and would still
/// miss the first one that mattered; each entry here exists because a fixed
/// intrinsic takes it, and the drift test asserts the Java side agrees.
pub const CALLBACKS: &[(&str, &str)] = &[
    ("()V", CALLBACK),
    ("(D)V", "nts/rt/NtsNumberCallback"),
    ("(Ljava/lang/String;)V", "nts/rt/NtsTextCallback"),
    ("(Ljava/lang/String;Ljava/lang/String;)V", "nts/rt/NtsTextPairCallback"),
    ("([BDD)V", "nts/rt/NtsBytesCallback"),
];

/// The interface a class whose `call` has this descriptor implements, if any.
#[must_use]
pub fn callback_interface(descriptor: &str) -> Option<&'static str> {
    CALLBACKS.iter().find(|(shape, _)| *shape == descriptor).map(|&(_, name)| name)
}

/// Whether this is one of the callback interfaces, which is what decides
/// whether an argument may be coerced into it rather than refused.
#[must_use]
pub fn is_callback_interface(descriptor: &str) -> bool {
    CALLBACKS.iter().any(|(_, name)| descriptor.len() == name.len() + 2
        && descriptor.starts_with('L')
        && descriptor.ends_with(';')
        && &descriptor[1..descriptor.len() - 1] == *name)
}

/// The program a backend is rendering, and the one whole-program fact that
/// changes how a type is spelled.
///
/// A struct rather than two parameters because `grows` is not a property of the
/// *type* -- `number[]` is a `[D` in one program and an `NtsArrayD` in another,
/// and which it is depends on whether anything, anywhere, calls `push`. Passing
/// the program without it made that decision unavailable at the only place it
/// could be made.
#[derive(Clone, Copy, Debug)]
pub struct Shape<'a> {
    pub program: &'a Program,
    pub grows: bool,
}

impl<'a> Shape<'a> {
    #[must_use]
    pub fn of(program: &'a Program) -> Self {
        Self { program, grows: nts_core::hir::arrays_can_grow(program) }
    }
}

/// The wrapper class for an array of this element type.
fn growable(shape: Shape<'_>, element: &HirType) -> Option<String> {
    let _ = shape;
    Some(nts_jvm_emitter::descriptor::object(wrapper(element)?))
}

/// The wrapper class for a growable array of this element type.
///
/// **One function, three callers** -- the descriptor, the frame entry, and the
/// operations. The first version had the choice written out at each, and the
/// two that disagreed disagreed about `boolean`: one refused it and one would
/// have widened it into the `double` wrapper, which answers `1` where the
/// language answers `true`.
#[must_use]
pub fn wrapper(element: &HirType) -> Option<&'static str> {
    Some(match descriptor_of_element(element)? {
        "D" => "nts/rt/NtsArrayD",
        "Z" => "nts/rt/NtsArrayZ",
        _ => "nts/rt/NtsArrayL",
    })
}

/// Which storage width an element type belongs to.
///
/// A boolean is its own, not widened into the `double` one: `true` and `1` are
/// different answers, and an array is the one place this backend cannot let the
/// operand stack's `int` stand in for both.
fn descriptor_of_element(element: &HirType) -> Option<&'static str> {
    Some(match element {
        HirType::Float { bits: 64 } | HirType::Int { .. } => "D",
        HirType::Bool => "Z",
        HirType::Erased | HirType::Managed(_) => "L",
        _ => return None,
    })
}

/// `Map` and `Set`, which are one table with the values left out of one of them.
pub const MAP: &str = "nts/rt/NtsMap";
/// A `Date`: a `double` and an identity, and the two operations that reach it.
pub const DATE: &str = "nts/rt/NtsDate";
/// A symbol: a description and an identity, and five operations.
pub const SYMBOL: &str = "nts/rt/NtsSymbol";

/// An `ArrayBuffer`: a `byte[]` that is null once detached, its length, and
/// its maximum. One class whether or not it is resizable -- `transfer` moves a
/// resizable buffer's bytes into a fixed one, so the two are not different
/// types to anything that holds a result.
pub const BUFFER: &str = "nts/rt/NtsBuffer";

/// A `DataView`: a buffer, an offset, and a length that may track the buffer's.
pub const VIEW: &str = "nts/rt/NtsDataView";

/// The marker a generated tuple class carries, so `Array.isArray` can answer.
///
/// `runtime/c` reads `NTS_KIND_TUPLE` off the descriptor. There is no
/// descriptor here -- RFC §13 puts these objects in the platform collector's
/// heap -- so the nominal fact goes where `instanceof` can read it, which on
/// this platform is an interface.
pub const TUPLE: &str = "nts/rt/NtsTuple";

/// The base every typed-array class extends.
///
/// The properties -- `length`, `byteLength`, `byteOffset`, `buffer` -- are
/// declared here and take a base-typed receiver, so they need no per-element
/// dispatch. Only construction does, because only construction has to *name* a
/// class rather than accept one.
pub const VIEW_BASE: &str = "nts/rt/NtsView";

/// What a typed array and a `DataView` share, which nothing here can name yet.
///
/// `nts/rt/NtsAnyView` holds the `buffer`, `offset` and `declared` that both
/// kinds carried separately, and both now extend it. It is the JVM half of
/// `ArrayBufferView` -- the union a function takes when it wants "some window
/// on these bytes" and reads `buffer` or `byteOffset` without caring which kind
/// arrived.
///
/// **Deliberately not mapped from anything.** `ManagedType` has `View(element)`
/// and `DataView` and no variant for the union, so no program can produce a
/// value of it and there is nothing for this to be the descriptor of. The same
/// arrangement as the three view classes above that no `HirType` reaches: the
/// runtime half is written and the middle end supplies the type when it has
/// one. What it must *not* do meanwhile is guess -- answering `NtsAnyView`
/// where a program said `Uint8Array` would lose every element accessor and
/// every one of the eleven monomorphic call sites record 0182 measured.
pub const ANY_VIEW: &str = "nts/rt/NtsAnyView";

/// The class for a typed array over `element`.
///
/// Eleven classes rather than one with a kind field, and the difference is
/// measured: record 0182 has a monomorphic `getAt` at 0.177 ns against 0.924 ns
/// through the generic pair, because a monomorphic call site inlines to a shift
/// and a load and a switch on a kind does not.
///
/// **Eight of the eleven.** `NtsViewU8C`, `NtsViewI64` and `NtsViewU64` exist in
/// `runtime/jvm` and are reachable from Java, and `hir::builtin`'s
/// `typed_array_element` names neither `Uint8ClampedArray` nor the two bigint
/// arrays -- so no program can produce a `View` over them and this returns
/// `None`, which is a refusal by name. When the middle end gains them, the
/// runtime half is already written and oracle-verified; what it must *not* do
/// is guess that an unsigned 8-bit element might have been the clamped one,
/// because clamping and wrapping disagree on exactly the inputs typed-array
/// code is written for.
#[must_use]
pub fn view_class(element: &HirType) -> Option<&'static str> {
    Some(match element {
        HirType::Int { bits: 8, signed: true } => "nts/rt/NtsViewI8",
        HirType::Int { bits: 8, signed: false } => "nts/rt/NtsViewU8",
        HirType::Int { bits: 16, signed: true } => "nts/rt/NtsViewI16",
        HirType::Int { bits: 16, signed: false } => "nts/rt/NtsViewU16",
        HirType::Int { bits: 32, signed: true } => "nts/rt/NtsViewI32",
        HirType::Int { bits: 32, signed: false } => "nts/rt/NtsViewU32",
        HirType::Float { bits: 32 } => "nts/rt/NtsViewF32",
        HirType::Float { bits: 64 } => "nts/rt/NtsViewF64",
        _ => return None,
    })
}
pub const MAP_DESCRIPTOR: &str = "Lnts/rt/NtsMap;";

/// The fixed networking intrinsics: the one runtime class a *program* reaches
/// by an intrinsic rather than by a type.
///
/// A facade over `NtsSocket` and `NtsEnv` rather than either of them. The
/// entries pointed at `NtsSocket` while they were four scalar calls, and that
/// stopped being honest the moment `connect` and `read` arrived: those need an
/// environment and a completion credit, which are not the socket layer's to
/// decide. One class that *is* the table keeps "what a program may call"
/// answerable by reading one file.
pub const WEB: &str = "nts/rt/NtsWeb";

/// The 128-bit integer, which the JVM has no primitive for.
pub const BIGINT: &str = "nts/rt/NtsBigInt";
pub const BIGINT_DESCRIPTOR: &str = "Lnts/rt/NtsBigInt;";

/// The descriptor for a parameter, result or field.
///
/// `None` is a type this backend cannot represent yet, which is a refusal by
/// name rather than a guess.
#[must_use]
pub fn descriptor(shape: Shape<'_>, ty: &HirType) -> Option<String> {
    let program = shape.program;
    Some(match ty {
        HirType::Void => "V".to_owned(),
        HirType::Bool => "Z".to_owned(),
        HirType::Int { bits: 64, .. } => "J".to_owned(),
        HirType::Int { .. } => "I".to_owned(),
        HirType::Float { bits: 32 } => "F".to_owned(),
        HirType::Float { .. } => "D".to_owned(),
        // **A type with no layout is `java/lang/Object` rather than a refusal**,
        // and that is what the other two lanes already do: `hir::layouts` holds
        // "every object type the program *uses*", so an absent one is a type
        // nothing in this program materialises. C gives such a field an opaque
        // pointer and LLVM gives it `ptr`; neither has to name a class, and
        // this backend does, which is the whole of the difference.
        //
        // It is sound for the same reason it is necessary. Nothing can
        // construct a value of a type with no layout, so such a field holds
        // null or something that arrived from outside the compiled set, and
        // there is no class the program could name to cast it to. Refusing
        // instead declined five accessors in `tooling/config` -- ordinary
        // TypeScript, `Config.workspace: Workspace`, where `Workspace` is an
        // interface this program reads and never builds.
        //
        // The fallback is here rather than at the field, so every `getfield`,
        // `putfield` and signature asks one question and gets one answer.
        HirType::Managed(ManagedType::Object(id)) => nts_jvm_emitter::descriptor::object(
            &program.layout(*id).map_or_else(|| OBJECT.to_owned(), class_name),
        ),
        // UTF-16 code units with a compact one-byte/two-byte representation --
        // which is what `NtsString` implements by hand and what JavaScript's
        // string *is*. `length`, `charAt`, `substring` and `equals` are already
        // the language's semantics, and JIT intrinsics besides.
        HirType::Managed(ManagedType::String) => STRING_DESCRIPTOR.to_owned(),
        // A tag beside a payload, the same three fields and the same tag
        // numbering as the C struct -- so `hir::tags` stays one fact and
        // `typeof x === "object"` stays the single comparison `tag >= OBJECT`,
        // which erasing to a bare `Object` and testing with `instanceof` would
        // throw away.
        HirType::Erased => VALUE_DESCRIPTOR.to_owned(),
        // Two `long`s in a `final class`, not `BigInteger`. This compiler's
        // `bigint` is exactly 128 bits and refuses a literal that does not fit,
        // so `BigInteger` would be *more* correct than the C lane -- and the
        // two would then disagree on precisely the inputs that matter, with
        // `agrees_with_c` as the oracle because node's arbitrary precision is
        // not one.
        HirType::BigInt => BIGINT_DESCRIPTOR.to_owned(),
        // One runtime class for both, and its keys and values are erased --
        // which is why the payload types in `ManagedType::Map` are for the
        // compiler rather than the runtime, exactly as that type's own comment
        // says. This is not a monomorphization.
        HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_)) => {
            MAP_DESCRIPTOR.to_owned()
        }
        // One runtime class whatever it settles with, which is what
        // `ManagedType::Promise`'s payload type says it is for: the payload is
        // in the type for the *compiler*, to choose which `fulfill` to emit and
        // how to read the value back. Not a monomorphization.
        HirType::Managed(ManagedType::Promise(_)) => PROMISE_DESCRIPTOR.to_owned(),
        // A bare JVM array, which is what a Java programmer writes and what the
        // hand-written reference will use. `arraylength` is one instruction,
        // the bounds check is mandatory *and* eliminated in a counted loop, and
        // there is no header to lay out.
        //
        // Only correct for a program where no array grows: a Java array cannot,
        // so a growing one needs an object with a `double[]` and a length
        // inside it. `emit` refuses such a program whole, which is the right
        // granularity because `arrays_can_grow` is a whole-program property.
        HirType::Managed(ManagedType::Array(element)) => {
            if shape.grows {
                // Whole-program: one `push` anywhere puts every array behind a
                // wrapper, because an array that grows cannot keep its elements
                // inline after its own header without moving.
                //
                // Record 0088 measured that at **1.4%** here against **4.02x**
                // on the native lane, so the refusal this replaces was worth
                // having until the number existed and is not worth having now.
                // The bare array stays for a program that never grows one,
                // because 1.4% on the AWFY rows is 1.4% off the only comparison
                // this lane exists to make.
                growable(shape, element)?
            } else {
                nts_jvm_emitter::descriptor::array_of(&descriptor(shape, element)?)
            }
        }
        // A window onto a buffer, and a *different class per element* -- which
        // is the one place this backend's shape differs from `runtime/c`'s,
        // where one `NtsView` struct carries a kind. The C header says why the
        // JVM may do this: "ordinary indexed access is emitted inline by the
        // backends, because a call per element is not a price a typed array can
        // pay", and a monomorphic receiver is what makes that inlining land.
        HirType::Managed(ManagedType::View(element)) => {
            nts_jvm_emitter::descriptor::object(view_class(element)?)
        }
        // A `double` and an identity, which is what the `NtsDate` struct in
        // `nts_runtime.h` is once the collector's header is the platform's.
        // Two operations reach it and both are about the same field; it is a
        // class rather than a bare `double` because two `new Date(0)` are
        // different objects and a `Date | null` needs an absence a `double`
        // has no room for.
        HirType::Managed(ManagedType::Date) => nts_jvm_emitter::descriptor::object(DATE),
        // A description and an identity. The identity is the whole of it --
        // two symbols with the same description are different values -- so it
        // is a class, and `NtsMap` keys it by reference through the `default`
        // arm of `sameKey` rather than through any tagged one.
        HirType::Managed(ManagedType::Symbol) => nts_jvm_emitter::descriptor::object(SYMBOL),
        // An `ArrayBuffer`: bytes, and the two things that can happen to them.
        //
        // **One class for fixed and resizable both**, which is the question the
        // placeholder here declined to answer. A separate class for each would
        // make `transfer` change a buffer's *type* -- it can hand a resizable
        // buffer's contents to a fixed one -- so a variable holding the result
        // would have no single class, and every view would need two shapes to
        // point at. Resizability is a field.
        HirType::Managed(ManagedType::Buffer) => nts_jvm_emitter::descriptor::object(BUFFER),
        HirType::Managed(ManagedType::DataView) => nts_jvm_emitter::descriptor::object(VIEW),
        // Every `ManagedType` is spelled above, so there is no catch-all here
        // and adding a variant upstream is a compile error rather than a
        // silent refusal. `never` reaching a value position means control got
        // somewhere the type system said it could not.
        HirType::Never => return None,
    })
}

/// How a value of this type is computed and stored.
#[must_use]
pub fn kind(ty: &HirType) -> Option<Kind> {
    Some(match ty {
        HirType::Erased
        | HirType::BigInt
        | HirType::Managed(
            ManagedType::Object(_)
            | ManagedType::String
            | ManagedType::Symbol
            | ManagedType::Date
            | ManagedType::Buffer
            | ManagedType::View(_)
            | ManagedType::DataView
            | ManagedType::Array(_)
            | ManagedType::Map(..)
            | ManagedType::Set(_)
            | ManagedType::Promise(_),
        ) => Kind::Ref,
        HirType::Int { bits: 64, .. } => Kind::Long,
        // A `boolean` is an `int` everywhere except in a descriptor: there is
        // no narrower computational type on this machine.
        HirType::Bool | HirType::Int { .. } => Kind::Int,
        HirType::Float { bits: 32 } => Kind::Float,
        HirType::Float { .. } => Kind::Double,
        HirType::Void | HirType::Never => return None,
    })
}

/// The frame entry for a slot holding this type.
#[must_use]
pub fn vtype(shape: Shape<'_>, ty: &HirType) -> Option<VType> {
    let program = shape.program;
    Some(match kind(ty)? {
        Kind::Int => VType::Integer,
        Kind::Long => VType::Long,
        Kind::Float => VType::Float,
        Kind::Double => VType::Double,
        Kind::Ref => match ty {
            HirType::Erased => VType::Object(VALUE.to_owned()),
            HirType::BigInt => VType::Object(BIGINT.to_owned()),
            HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_)) => {
                VType::Object(MAP.to_owned())
            }
            HirType::Managed(ManagedType::Promise(_)) => VType::Object(PROMISE.to_owned()),
            HirType::Managed(ManagedType::String) => VType::Object(STRING.to_owned()),
            // An array's *class* constant is named by its descriptor rather
            // than by an internal name: `[D`, not `D` and not `L[D;`. That is
            // true of a **bare** array only -- a growable one is an ordinary
            // class and wants its internal name, and passing the descriptor
            // there is `ClassFormatError: Illegal class name
            // "Lnts/rt/NtsArrayD;"` at load.
            HirType::Managed(ManagedType::Array(element)) if shape.grows => {
                // The same answer `growable` gives, from the same function --
                // a second copy of "which wrapper" is exactly the drift that
                // put `NtsArrayD.pop` where an `NtsValue` was wanted.
                VType::Object(wrapper(element)?.to_owned())
            }
            HirType::Managed(ManagedType::Array(_)) => {
                VType::Object(descriptor(shape, ty)?)
            }
            // The class, not the descriptor: a view is an ordinary object, so
            // this is the `Array`-when-growable case rather than the bare-array
            // one, and passing `Lnts/rt/NtsViewU8;` here is the
            // `ClassFormatError` that arm's comment names.
            HirType::Managed(ManagedType::View(element)) => {
                VType::Object(view_class(element)?.to_owned())
            }
            // The same fallback as `descriptor`, and it has to be the same or the
            // frame and the field would disagree about a slot.
            HirType::Managed(ManagedType::Object(id)) => {
                VType::Object(program.layout(*id).map_or_else(|| OBJECT.to_owned(), class_name))
            }
            HirType::Managed(ManagedType::Date) => VType::Object(DATE.to_owned()),
            HirType::Managed(ManagedType::Symbol) => VType::Object(SYMBOL.to_owned()),
            HirType::Managed(ManagedType::Buffer) => VType::Object(BUFFER.to_owned()),
            HirType::Managed(ManagedType::DataView) => VType::Object(VIEW.to_owned()),
            // **No catch-all**, and the missing one here cost a day of the wrong
            // diagnosis. `descriptor` says of its own last arm that every
            // `ManagedType` is spelled out so adding a variant upstream is a
            // compile error rather than a silent refusal -- and this function,
            // which decides the *same* thing for a local slot, had a `_` that
            // quietly answered `None`. So `ManagedType::Buffer` arrived,
            // `descriptor` was updated, and every function holding a buffer
            // still refused with "a value of unrepresentable type" pointing at
            // a type the backend could by then represent perfectly well.
            //
            // The scalars cannot reach here -- `kind` already answered `Ref` --
            // but they are listed rather than swept up, because a `_` that is
            // unreachable today is the one that catches the next variant.
            HirType::Bool
            | HirType::Int { .. }
            | HirType::Float { .. }
            | HirType::Void
            | HirType::Never => return None,
        },
    })
}

/// What to call a type in a refusal, so the message names the construct rather
/// than an internal spelling.
#[must_use]
pub fn describe(ty: &HirType) -> String {
    match ty {
        HirType::Never => "a value of type `never`".to_owned(),
        HirType::BigInt => "a bigint".to_owned(),
        HirType::Erased => "an erased value".to_owned(),
        HirType::Managed(ManagedType::String) => "a string".to_owned(),
        HirType::Managed(ManagedType::Symbol) => "a symbol".to_owned(),
        HirType::Managed(ManagedType::Date) => "a date".to_owned(),
        HirType::Managed(ManagedType::Buffer) => "an array buffer".to_owned(),
        // The element, for the reason the array arm below gives: the refusals
        // this most needs to be readable are the three element types the
        // runtime has and the middle end has not, and "a typed array" three
        // times says nothing about which.
        HirType::Managed(ManagedType::View(element)) => {
            format!("a typed array of {}", short(element))
        }
        HirType::Managed(ManagedType::DataView) => "a data view".to_owned(),
        // The element, because the one message that most needs this is two
        // arrays that differ only in it -- `an array` twice says nothing about
        // why the two would not agree.
        HirType::Managed(ManagedType::Array(element)) => {
            format!("an array of {}", short(element))
        }
        HirType::Managed(ManagedType::Object(_)) => "an object".to_owned(),
        HirType::Managed(ManagedType::Promise(_)) => "a promise".to_owned(),
        HirType::Managed(ManagedType::Map(..)) => "a map".to_owned(),
        HirType::Managed(ManagedType::Set(_)) => "a set".to_owned(),
        HirType::Bool => "a boolean".to_owned(),
        HirType::Void => "nothing".to_owned(),
        HirType::Int { bits, signed } => {
            format!("{}{bits}", if *signed { "an i" } else { "a u" })
        }
        HirType::Float { bits } => format!("an f{bits}"),
    }
}

/// A type's name without the article, for reading inside another name.
fn short(ty: &HirType) -> String {
    match ty {
        HirType::Bool => "bool".to_owned(),
        HirType::Erased => "erased values".to_owned(),
        HirType::Int { bits, signed } => format!("{}{bits}", if *signed { "i" } else { "u" }),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Managed(ManagedType::String) => "strings".to_owned(),
        other => describe(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty() -> Program {
        Program::default()
    }

    #[test]
    fn a_narrow_integer_is_an_int_in_every_vocabulary_but_none() {
        let byte = HirType::Int { bits: 8, signed: true };
        assert_eq!(descriptor(Shape::of(&empty()), &byte).as_deref(), Some("I"));
        assert_eq!(kind(&byte), Some(Kind::Int));
        assert_eq!(vtype(Shape::of(&empty()), &byte), Some(VType::Integer));
    }

    #[test]
    fn a_bool_is_an_int_to_compute_and_a_z_to_declare() {
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::Bool).as_deref(), Some("Z"));
        assert_eq!(kind(&HirType::Bool), Some(Kind::Int));
    }

    #[test]
    fn sixty_four_bits_is_the_only_wide_integer() {
        let long = HirType::Int { bits: 64, signed: true };
        assert_eq!(descriptor(Shape::of(&empty()), &long).as_deref(), Some("J"));
        assert_eq!(kind(&long), Some(Kind::Long));
        assert_eq!(vtype(Shape::of(&empty()), &long), Some(VType::Long));
    }

    #[test]
    fn what_this_slice_does_not_represent_says_so() {
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::Never), None);
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::Void).as_deref(), Some("V"));
        assert_eq!(kind(&HirType::Void), None, "void has no computational kind");
    }

    /// A bigint is a reference on this backend, which is the whole of what
    /// makes it work: there is no 128-bit primitive, so it is a two-field
    /// object and every operation on one is a call.
    ///
    /// Pinned because the alternative that suggests itself -- `BigInteger` --
    /// would be *more* correct than the C lane rather than equal to it. This
    /// compiler's bigint is exactly 128 bits and refuses a literal that does
    /// not fit, so arbitrary precision would disagree with the other backends
    /// on precisely the inputs that matter, and `agrees_with_c` is the oracle
    /// here because node's `BigInt` is not one.
    #[test]
    fn a_bigint_is_a_reference_to_two_longs() {
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::BigInt).as_deref(), Some(BIGINT_DESCRIPTOR));
        assert_eq!(kind(&HirType::BigInt), Some(Kind::Ref));
        assert_eq!(
            vtype(Shape::of(&empty()), &HirType::BigInt),
            Some(VType::Object(BIGINT.to_owned()))
        );
    }
}
