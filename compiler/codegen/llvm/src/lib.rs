//! The second backend: textual LLVM IR.
//!
//! # Why textual, and why a second backend at all
//!
//! Textual `.ll` fed to `clang -x ir` rather than a linked `llvm-sys`. Reading
//! `program.c` diagnosed three separate bugs in one week — a struct cast to a
//! double named an unreachable narrowing on sight, and a `module__init` visibly
//! not assigning a global exposed an initializer that had been silently
//! dropped. That legibility is a working instrument, not a nicety, and it is
//! worth keeping in the backend that is meant to become primary. It also avoids
//! pinning an LLVM version into the build.
//!
//! The C backend does not go away when this one grows up. It is the *oracle*:
//! one HIR, two renderers, and the differential already knows how to ask
//! whether a compiled program agrees with node. A disagreement between the two
//! backends is a backend bug by construction, which is the only cheap way to
//! find one. scriptc gave this up — their C backend cannot express coroutines,
//! so it is debug-only — and they gave it up because their suspension lives in
//! the backend. Ours lives in `hir::suspend`, which is what makes two real
//! backends possible at all.
//!
//! # What it maps
//!
//! HIR is already backend-neutral: `Convert` is a representation change that
//! specialization decided, `frame` is a placement decision from escape
//! analysis, `checked` is a bounds proof. Each renders differently here and
//! means the same thing.
//!
//! The one structural difference is *block parameters*. HIR is SSA with
//! arguments on edges, the way MLIR and Swift's SIL are; LLVM puts the join in
//! the successor as a `phi` listing one value per predecessor. The two carry
//! the same information and the translation is mechanical — which is the whole
//! reason the lowering chose block parameters rather than phis in the first
//! place.
//!
//! # What it does not do yet
//!
//! This is the scalar slice: numbers, integers and booleans, arithmetic,
//! comparison, calls between lowered functions, and control flow. Anything
//! managed is refused by name rather than half-emitted. A backend that emits
//! *something* for every input is a backend nobody can trust the output of.

mod aggregate;
mod native;
mod objc;
mod indirect;
/// How many sixteen-byte arguments a Win64 runtime call can pass; see `indirect`.
pub use indirect::SLOTS as WIN64_INDIRECT_SLOTS;
pub mod signatures;
pub mod signatures_win64;

use std::fmt::Write as _;

use nts_core::hir::native::NativeAbi;
use nts_core::hir::{
    BinOp, BlockId, Callee, Func, HirType, OpKind, Program, Terminator, UnOp, ValueId,
};
use nts_diagnostics::Diagnostic;

/// What the backend produced, and what it declined to.
#[derive(Debug)]
pub struct Emitted {
    pub text: String,
    pub diagnostics: Vec<Diagnostic>,
}

/// The target a module is emitted for, as far as its text depends on it.
///
/// **Two facts, because neither decides the other.** `abi` is the C data
/// model, which decides every native size and offset. `arch` decides with it
/// the calling convention: how a record or an erased value crosses a call.
/// `x86_64` Linux and arm64 macOS share a data model and not a convention.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Platform {
    pub abi: NativeAbi,
    pub arch: Arch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
    X86_64,
    Aarch64,
}

impl Platform {
    /// `x86_64` System V: Linux and the other ELF targets.
    pub const SYSV_X86_64: Self = Self { abi: NativeAbi::SysV, arch: Arch::X86_64 };
    /// `x86_64` Windows, mingw and MSVC alike.
    pub const WIN64_X86_64: Self = Self { abi: NativeAbi::Win64, arch: Arch::X86_64 };
}

/// Render a whole program as textual LLVM IR.
///
/// A function this cannot render is *absent* and reported, exactly as the C
/// backend does: a caller that still calls it fails at the linker with a name,
/// which is a better failure than a body that silently means something else.
///
/// **For a target whose C ABI is `abi`**, which decides a `long`'s width and
/// every native size and offset. HIR is the same for every target, so this is
/// the first place the answer exists, and it is required so that no caller
/// gets the host's by omission.
#[must_use]
pub fn emit(program: &Program, platform: Platform) -> Emitted {
    let mut text = String::new();
    let mut diagnostics = Vec::new();
    if let Err(why) = nts_codegen_common::native::layouts(program)
        && let Some(func) = program.funcs.first()
    {
        return Emitted { text, diagnostics: vec![refuse(func, &why)] };
    }
    let mut refusals = nts_codegen_common::abi::unrepresentable_constants(program, platform.abi);
    refusals.extend(nts_codegen_common::abi::unavailable_scalars(program, platform.abi));
    if !refusals.is_empty() {
        return Emitted { text, diagnostics: refusals };
    }
    let native = match native::declarations(program, platform) {
        Ok(lines) => lines,
        Err(diagnostics) => return Emitted { text, diagnostics },
    };
    let _ = writeln!(text, "; Generated by nts. Do not edit.");
    for line in native {
        let _ = writeln!(text, "{line}");
    }
    text.push_str(&native_memory::helpers(program));
    text.push_str(&objc::module(program));
    text.push_str(&counting_declarations(program));
    text.push_str(&open_chains(program));
    // What the runtime offers this backend, declared up front.
    //
    // `nts_to_int32` is `static inline` in the C header, which is right for C
    // and unreadable to anything else: a header is not a contract another code
    // generator can read. The runtime exposes a linkable form beside the inline
    // for exactly this, and these two are the first things to cross the C-to-
    // LLVM boundary -- a double in, an `i32` out, the simplest ABI there is to
    // get wrong.
    // Everything the backend may reach for, declared from the same table the
    // program's own calls use -- one source of signatures, and the attributes
    // come with them.
    for helper in ALWAYS_DECLARED {
        if let Some(line) = declaration(helper, platform) {
            let _ = writeln!(text, "{line}");
        }
    }
    // The two intrinsics, which are LLVM's own and in no C header.
    let _ = writeln!(text, "declare double @llvm.fabs.f64(double) nounwind");
    let _ = writeln!(text, "declare double @llvm.sqrt.f64(double) nounwind");
    // Integer magnitude. The second argument says whether `INT_MIN` is poison;
    // it is not, because `hir` widens the operand before asking -- `Math.abs`
    // of an `i32` does not fit one, and the HIR types the result `i64`.
    let _ = writeln!(text, "declare i64 @llvm.abs.i64(i64, i1) nounwind");
    let _ = writeln!(text, "declare i32 @llvm.abs.i32(i32, i1) nounwind");
    // Rounding toward each infinity and toward zero. `Math.round` is *not*
    // among them -- see `nts_round_fn`, which the runtime offers because
    // JavaScript rounds a half the other way from C.
    let _ = writeln!(text, "declare double @llvm.floor.f64(double) nounwind");
    let _ = writeln!(text, "declare double @llvm.ceil.f64(double) nounwind");
    let _ = writeln!(text, "declare double @llvm.trunc.f64(double) nounwind");
    let _ = writeln!(text, "@nts_desc_ref = external constant %NtsDescriptor");
    let _ = writeln!(
        text,
        "@nts_closure_call_slot = constant i32 {}",
        nts_core::hir::closure_call_slot(program)
    );
    for line in externals(program, platform) {
        let _ = writeln!(text, "{line}");
    }
    let _ = writeln!(text, "\n{}", descriptors(program));
    let _ = writeln!(text, "{}", literals(program));
    let _ = write!(text, "{}", cell_name_globals(program));
    // Module-scope storage. `internal` unless the program exports it, for the
    // same reason the C backend makes it `static`: a name outside the program
    // is a name something outside can collide with.
    for (at, global) in program.globals.iter().enumerate() {
        let Ok(ty) = ty_of(&global.ty, &program.funcs[0]) else {
            continue;
        };
        let linkage = if global.exported { "" } else { "internal " };
        let zero = if matches!(global.ty, HirType::Managed(_)) {
            "null".to_owned()
        } else if matches!(global.ty, HirType::Erased) {
            // An erased global is a tag beside a payload -- an aggregate, and
            // `0` is not a value one can have. `undefined` is the tag zero and
            // the payload zero together, which is what `zeroinitializer` is.
            //
            // Nothing reached this until `let held;` could be a global: an
            // evolving `any` has no annotation to refuse it by, so the slot is
            // erased and the module has one. clang's answer was "integer
            // constant must have integer type", which is the right complaint
            // about the wrong thing.
            "zeroinitializer".to_owned()
        } else if matches!(global.ty, HirType::Float { .. }) {
            float_literal(global.initial)
        } else {
            // A global's recorded initial value is a double whatever the
            // slot's width is, and an integer slot's is a whole number by
            // construction -- `Global::initial` is what the lowering folded,
            // not an arbitrary value.
            #[allow(
                clippy::cast_possible_truncation,
                reason = "an integer global's initial value is whole by construction"
            )]
            let whole = global.initial as i64;
            format!("{whole}")
        };
        let _ = writeln!(
            text,
            "{} = {linkage}global {ty} {zero}",
            symbol(&global_symbol(program, at))
        );
    }
    let mut bodies = String::new();
    for func in &program.funcs {
        match function(program, func, platform) {
            Ok(rendered) => {
                let _ = writeln!(bodies, "\n{rendered}");
            }
            Err(diagnostic) => {
                diagnostics.push(diagnostic);
                // A refused function is absent, and a module that *calls* an
                // absent function is not a module: clang rejects the whole
                // thing, which turns a clean refusal into a broken build. Seven
                // benchmarks failed exactly that way -- the caller rendered,
                // the callee did not, and `@Benchmark__innerBenchmarkLoop` was
                // a name with nothing behind it.
                //
                // Declaring it makes the module valid and moves the failure to
                // the linker, which is where the C backend already puts it: C
                // emits a prototype for everything and lets `ld` say what is
                // missing. A refusal should look like a refusal.
                if let Some(line) = refused_declaration(func) {
                    let _ = writeln!(text, "{line}");
                }
            }
        }
    }
    match bridges(program, platform) {
        Ok(text_for_bridges) => text.push_str(&text_for_bridges),
        Err(diagnostic) => diagnostics.push(diagnostic),
    }
    text.push_str(&bodies);
    let _ = writeln!(text, "\n{TBAA_TREE}");
    Emitted { text, diagnostics }
}

/// What may alias what, which C tells clang and a module has to say for itself.
///
/// # Why this is here at all
///
/// The generated C gets this free. `xs[i] = ...` writes a `double` and
/// `xs.length` reads a `uint32_t`, and C's rule -- two accesses of different
/// types do not alias -- lets clang hoist the length and the element block out
/// of a loop that only writes doubles. A module carries no types at all once it
/// is written: `store double` and `load i32` are both just bytes, so every
/// store forces every later load to be done again.
///
/// Measured on `xs[i] = xs[i] * k; total += xs[i]` over four thousand doubles,
/// four hundred thousand rounds: **0.85s without this and 0.78s with it** --
/// which is exactly the C backend's 0.78s. The gap was never to clang; it was
/// to our own oracle, and this closes it.
///
/// # Why this is clang's tree and not one of ours
///
/// The first version invented a root, `!{!"nts"}`. The worry was that this
/// would be *unsound* under `-flto` -- which `tooling/bench` uses -- because
/// two trees would make claims about the same memory. It is the opposite, and
/// the experiment is worth keeping: given a loop that loads a `double` and
/// stores an `int` through an unrelated pointer, LLVM hoists the load out
/// entirely when both tags sit under clang's root, and moves *nothing* when the
/// store's tag has a root of its own. Tags from unrelated roots are treated as
/// possibly aliasing, which is the conservative answer.
///
/// So an invented root is safe and **useless across a translation unit**. Every
/// tag the runtime carries would have been opaque to every tag we emit, and
/// under LTO -- where the runtime's body is finally visible and there is most
/// to gain -- we would have gained nothing.
///
/// Metadata nodes are uniqued by content, so spelling the tree exactly as clang
/// spells it makes our `double` node *be* the runtime's `double` node. The
/// names are read off clang rather than guessed, and they are not obvious:
/// `int8_t` and `uint8_t` are character types and get the omnipotent char;
/// signed and unsigned share one node, so `uint32_t` is `"int"`; `int64_t` and
/// `uintptr_t` are both `"long"`; `_Bool` keeps its underscore.
///
/// # Why it is only types, and not fields
///
/// Clang additionally emits struct-path tags, which say `Point.x` and `Point.y`
/// do not alias. Scalar tags are strictly weaker, so mixing ours with the
/// runtime's paths is safe, and the plain type rule already recovered the whole
/// measured difference.
///
/// # What makes this sound here
///
/// Every field is accessed at exactly one LLVM type: the type comes from
/// `field_at`, off the field's HIR type, and it is the same type `emit.rs`
/// would have written in C -- so the tag agrees with the runtime's by
/// construction rather than by coincidence. An erased value is read and written
/// whole and gets the char node, because `NtsValue` is a union in C and this is
/// not the place to make a claim about one.
const TBAA_TREE: &str = "!0 = !{!\"Simple C/C++ TBAA\"}
!1 = !{!\"omnipotent char\", !0, i64 0}
!2 = !{!\"any pointer\", !1, i64 0}
!3 = !{!\"double\", !1, i64 0}
!4 = !{!\"float\", !1, i64 0}
!5 = !{!\"_Bool\", !1, i64 0}
!6 = !{!\"short\", !1, i64 0}
!7 = !{!\"int\", !1, i64 0}
!8 = !{!\"long\", !1, i64 0}
!9 = !{!\"__int128\", !1, i64 0}
!10 = !{!1, !1, i64 0}
!11 = !{!2, !2, i64 0}
!12 = !{!3, !3, i64 0}
!13 = !{!4, !4, i64 0}
!14 = !{!5, !5, i64 0}
!15 = !{!6, !6, i64 0}
!16 = !{!7, !7, i64 0}
!17 = !{!8, !8, i64 0}
!18 = !{!9, !9, i64 0}";

/// The access tag for a load or store at this LLVM type, as a suffix.
///
/// The mapping is C's, because the memory is shared with C: `i32` is `"int"`
/// whether the field was signed or not, `i64` is `"long"` because that is what
/// `int64_t` and `uintptr_t` are here, and `i8` is the omnipotent char, which
/// aliases everything.
///
/// Anything unrecognised falls to the char node too: a type this does not know
/// is a type whose memory it cannot reason about, and the conservative answer
/// is the one that is never wrong.
fn tbaa(ty: &str) -> &'static str {
    match ty {
        "ptr" => ", !tbaa !11",
        "double" => ", !tbaa !12",
        "float" => ", !tbaa !13",
        "i1" => ", !tbaa !14",
        "i16" => ", !tbaa !15",
        "i32" => ", !tbaa !16",
        "i64" => ", !tbaa !17",
        "i128" => ", !tbaa !18",
        // `i8` and `NtsValue` included: a character type aliases everything in
        // C, and a union is not something to make a claim about from here.
        _ => ", !tbaa !10",
    }
}

/// What an array holds, taken from the *array*.
///
/// Not from the value being stored, and not from the slot being filled. The
/// element type is what the descriptor was built from, so it is the only one
/// that describes the memory. `ArraySet` used the stored value's type instead:
/// a `number[]` whose descriptor says eight-byte doubles took `store i64`.
/// The width matched, so nothing crashed and nothing was diagnosed -- and every
/// later read of that element was an integer's bits read as a double.
/// `erasure-stored-typed` answered 1.3186118021857029e-314 where node answered
/// 2668900000, which is exactly the one reinterpreted as the other.
///
/// The C backend cannot make this mistake. It writes `elements[i] = value`
/// through a `double *` and C converts on the way in. Here it is written down.
fn array_element(func: &Func, array: ValueId) -> Result<&HirType, Diagnostic> {
    match &func.values[array.0 as usize].ty {
        HirType::Managed(
            nts_core::hir::ManagedType::Array(element) | nts_core::hir::ManagedType::View(element),
        ) => Ok(element),
        _ => Err(refuse(
            func,
            "an element access on something that is not an array",
        )),
    }
}

/// One operand of a runtime helper, at the type the runtime declares for it.
///
/// C converts at the call and says nothing. Here every conversion has to be
/// written down -- and at *every* call, not only the ones `call` renders. The
/// signature table existed and exactly one code path consulted it, so a length
/// specialization had narrowed to an `i32` was handed to `nts_array_new(ptr,
/// double)` as an `i32`, an index narrowed the other way was handed to
/// `nts_unit_fn(ptr, i32)` as a `double`, and neither module assembled.
///
/// Any conversion lines go into `before`, because they have to be emitted
/// ahead of the call rather than inside its argument list.
fn helper_operand(
    func: &Func,
    out: &str,
    target: &str,
    at: usize,
    value: ValueId,
    before: &mut Vec<String>,
) -> Result<String, Diagnostic> {
    let have = ty_of(&func.values[value.0 as usize].ty, func)?;
    let want = signatures::signature(target)
        .and_then(|known| known.params.get(at))
        .map_or(have, |spec| spec.split_whitespace().next().unwrap_or(spec));
    if want == have {
        return Ok(format!("{have} {}", name(value)));
    }
    let slot = format!("{out}.a{}", value.0);
    before.push(converted(&slot, have, want, &name(value), func)?);
    Ok(format!("{want} {slot}"))
}

/// `declare` for a function this backend could not render.
///
/// Types only and no `internal`: LLVM has no such thing as an internal
/// declaration, and external is what makes the link fail with the function's
/// name in the message rather than the module fail to parse.
fn refused_declaration(func: &Func) -> Option<String> {
    let returns = ty_of(&func.return_type, func).ok()?;
    let mut params = Vec::new();
    for param in &func.params {
        if param.ty == HirType::Erased {
            // Two scalars, the same split `function` makes for a definition.
            params.push("i32".to_owned());
            params.push("i64".to_owned());
        } else {
            let ty = ty_of(&param.ty, func).ok()?;
            params.push(format!("{}{ty}", extension(&param.ty)));
        }
    }
    Some(format!(
        "declare {}{returns} {}({}) nounwind",
        extension(&func.return_type),
        symbol(&func.name),
        params.join(", ")
    ))
}

/// An erased value: the tag, and the union's eightbyte as an integer.
const ERASED_TYPE: &str = "{ i32, i64 }";

/// An erased value handed to a runtime helper as operand `at` of one call:
/// its two scalars on System V, where clang splits sixteen bytes into two
/// registers, and a pointer to its copy on Win64 (`indirect`).
fn erased_argument(platform: Platform, value: &str, out: &str, at: usize, lines: &mut Vec<String>) -> String {
    if indirect::applies(platform) {
        return indirect::argument(ERASED_TYPE, value, at, lines);
    }
    lines.push(format!("{out}.t{at} = extractvalue {ERASED_TYPE} {value}, 0"));
    lines.push(format!("{out}.p{at} = extractvalue {ERASED_TYPE} {value}, 1"));
    format!("i32 {out}.t{at}, i64 {out}.p{at}")
}

/// The tags, which are `typeof`'s answers in `typeof`'s order.
///
/// Read from the middle end rather than restated: `hir::tags` is where the
/// order is decided, and the order is load-bearing -- `"object"` is the range
/// test `tag >= OBJECT`, which is why `FUNCTION` sits below it.
fn tag_of(ty: &HirType) -> Option<u32> {
    use nts_core::hir::tags;
    Some(match ty {
        HirType::Bool => tags::BOOLEAN,
        HirType::Float { .. } | HirType::Int { .. } => tags::NUMBER,
        HirType::Managed(nts_core::hir::ManagedType::String) => tags::STRING,
        // A closure answers `"function"` to `typeof`, so it carries its own
        // tag -- told apart by the id rather than by the layout, because that
        // is all this sees. The C backend has had this case since closures
        // became values; here they fell into `OBJECT` below, and
        // `examples/absent` read 42 where node reads 45.
        HirType::Managed(nts_core::hir::ManagedType::Object(ty))
            if nts_core::hir::is_closure_type(*ty) =>
        {
            tags::FUNCTION
        }
        // And a symbol answers `"symbol"`, for the same reason and with the
        // same failure mode: it fell into `OBJECT` below, `examples/symbol-values`
        // disagreed with node on this lane and agreed on the C one, and the
        // comment above about closures had already described the shape. The
        // second time a wildcard over `Managed` has answered for a newcomer
        // here.
        HirType::Managed(nts_core::hir::ManagedType::Symbol) => tags::SYMBOL,
        HirType::Managed(_) => tags::OBJECT,
        HirType::Void => tags::UNDEFINED,
        _ => return None,
    })
}

/// `NtsHeader`, as LLVM's own struct type: the same fields in the same order,
/// so it is laid out the way clang lays out the C one.
const HEADER_TYPE: &str = "%NtsHeader = type { ptr, i64, i32, i32 }";

/// Every string literal in the program, in the order the C backend numbers
/// them -- one table, so `nts_str_3` is the same string in both outputs.
///
/// A literal is static storage with an immortal count, so nothing ever tries to
/// free it. Emitted as code *units* rather than as an LLVM string constant for
/// the reason the C backend gives: an escape rule that is not JavaScript's is a
/// different string, and a wide literal is not bytes at all.
fn literals(program: &Program) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "{HEADER_TYPE}");
    // What to run, how to drop it unrun, and the frame both act on. Named
    // `%struct.NtsTask` because that is what the runtime's own signature says
    // it passes `byval`, and the two have to agree.
    let _ = writeln!(out, "%struct.NtsTask = type {{ ptr, ptr, ptr }}");
    let _ = writeln!(out, "@nts_desc_string1 = external constant %NtsDescriptor");
    let _ = writeln!(out, "@nts_desc_string2 = external constant %NtsDescriptor");
    for (index, text) in literal_table(program).iter().enumerate() {
        let units: Vec<u16> = text.encode_utf16().collect();
        let wide = units.iter().any(|unit| *unit > 0xFF);
        let (element, descriptor, flags) = if wide {
            ("i16", "@nts_desc_string2", 1)
        } else {
            ("i8", "@nts_desc_string1", 0)
        };
        // One more unit than the string holds, kept at zero, so a narrow one
        // can be handed to C directly.
        let mut data: Vec<String> = units
            .iter()
            .map(|unit| format!("{element} {unit}"))
            .collect();
        data.push(format!("{element} 0"));
        let _ = writeln!(
            out,
            "@nts_str_{index} = internal constant {{ %NtsHeader, [{count} x {element}] }} \
             {{ %NtsHeader {{ ptr {descriptor}, i64 {immortal}, i32 {flags}, i32 {length} }}, \
             [{count} x {element}] [{}] }}",
            data.join(", "),
            count = data.len(),
            immortal = nts_core::hir::layout::IMMORTAL,
            length = units.len(),
        );
    }
    out
}

/// The literals a program holds, numbered the way the C backend numbers them.
fn literal_table(program: &Program) -> Vec<String> {
    let mut table: Vec<String> = Vec::new();
    for func in &program.funcs {
        for block in &func.blocks {
            for value in &block.ops {
                if let OpKind::ConstString(text) = &func.values[value.0 as usize].kind
                    && !table.contains(text)
                {
                    table.push(text.clone());
                }
            }
        }
    }
    table
}

/// `NtsDescriptor`, as LLVM's own struct type.
///
/// The field *types* in the runtime's order, not hand-computed offsets. LLVM
/// lays a struct out with the same rules clang does, so declaring the same
/// fields in the same order matches by construction -- which is the whole
/// difference between this and deriving an ABI, and it is why there is nothing
/// here to get wrong by four bytes.
///
/// **It was four bytes short**, which that sentence did not notice: the C
/// struct ends in `element`, which this type left out, so an array descriptor
/// this backend emitted had its element kind read from whatever followed it.
/// Zero there refuses, which is how it went unseen. The type now carries every
/// field, `foreign` and `foreign_slots` after `element` as in the runtime.
const DESCRIPTOR_TYPE: &str =
    "%NtsDescriptor = type { i32, i32, i32, i32, ptr, ptr, ptr, i32, ptr, i32, i32, ptr }";

/// `NTS_KIND_OBJECT`. The other kinds belong to the runtime's own types.
const KIND_OBJECT: u32 = 2;

/// `NTS_KIND_TUPLE`, which is not one of those: a tuple is laid out here and
/// the runtime never allocates one. It exists so `Array.isArray` can answer for
/// a heterogeneous tuple, which the language calls an Array and which this
/// compiler lays out as a struct.
const KIND_TUPLE: u32 = 6;

/// One global per class that shares a shape.
///
/// Identical in every field a descriptor holds and differing in its **address**,
/// which is what `nts_is_class` compares, and in the name it reports as its own.
/// See `descriptor_for`; the C backend emits the same pair and
/// `examples/two-classes-one-descriptor` holds both lanes to it.
fn class_descriptors(
    out: &mut String,
    program: &Program,
    layout: &nts_core::hir::Layout,
    tag: &str,
    body: (&str, &str),
) {
    let (head, tail) = body;
    let sharing = identities_sharing(program, layout);
    if sharing.len() < 2 {
        return;
    }
    for class in &sharing {
        let spelling = format!("{tag}__{}", identity_suffix(&sharing, class));
        name_constant(out, &spelling, &class.name);
        let _ = writeln!(
            out,
            "@nts_desc_{spelling} = internal constant %NtsDescriptor \
             {{ {head}, ptr @nts_name_{spelling}, {tail} }}"
        );
    }
}

/// A layout's name as a C string constant, terminator and all: the runtime
/// prints it, so the NUL is part of the data rather than an artefact.
fn name_constant(out: &mut String, tag: &str, name: &str) {
    let bytes = name.len() + 1;
    let _ = writeln!(
        out,
        "@nts_name_{tag} = internal constant [{bytes} x i8] c\"{name}\\00\""
    );
}

/// Which of the two an emitted layout carries.
///
/// A function rather than four lines inside `descriptors`, which is already at
/// its length limit -- and the better shape anyway: the question is about a
/// layout and not about the loop that happens to be walking them.
fn descriptor_kind(name: &str) -> u32 {
    if nts_core::hir::is_tuple_layout_name(name) {
        KIND_TUPLE
    } else {
        KIND_OBJECT
    }
}

/// Every descriptor the program needs, with the tables they point at.
///
/// What goes *in* one is already shared: `cyclic_layouts` and
/// `reference_fields` are `nts_core::hir`'s, and the offsets are the layout
/// engine's. Only the rendering is the backend's, which is what a backend is.
fn descriptors(program: &Program) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "{DESCRIPTOR_TYPE}");
    let cyclic = program.cyclic_layouts();
    for (index, layout) in program.layouts.iter().enumerate() {
        let Some(placed) = nts_core::hir::layout::place(&layout.fields) else {
            continue;
        };
        let tag = descriptor_name(layout);
        let mut offsets = |which: &str, wanted: &[u32]| -> String {
            if wanted.is_empty() {
                return "ptr null".to_owned();
            }
            let entries: Vec<String> = wanted.iter().map(|at| format!("i32 {at}")).collect();
            let _ = writeln!(
                out,
                "@nts_{which}_{tag} = internal constant [{} x i32] [{}]",
                wanted.len(),
                entries.join(", ")
            );
            format!("ptr @nts_{which}_{tag}")
        };
        // The *pointer* slots, not every slot that may hold a reference: an
        // erased one belongs in the table below and in this one it would be
        // read as a pointer. See `HirType::holds_a_pointer`.
        let references: Vec<u32> = layout
            .fields
            .iter()
            .enumerate()
            .filter(|(_, field)| field.ty.holds_a_pointer())
            .filter_map(|(at, _)| placed.offsets.get(at).copied())
            .collect();
        let erased: Vec<u32> = layout
            .fields
            .iter()
            .enumerate()
            .filter(|(_, field)| field.ty == HirType::Erased)
            .filter_map(|(at, _)| placed.offsets.get(at).copied())
            .collect();
        let reference_table = offsets("refs", &references);
        let erased_table = offsets("erased", &erased);
        let (foreign, foreign_table) = foreign_slots(&mut out, layout, &placed.offsets, &tag);
        // The class's dispatch table, where the hierarchy has one. A slot the
        // class does not implement is null, which is unreachable: a call only
        // uses a slot the receiver's static type declares, and every class at
        // or below that type fills it.
        let methods = vtable(&mut out, layout, &tag);
        // A named function used as a value is one object, so it is emitted
        // rather than allocated: nothing in it but the header, and immortal.
        // `NTS_IMMORTAL` in the count word is what keeps reference counting
        // away from storage that was never allocated and must never be freed.
        if wants_a_static_instance(program, layout) {
            // The header spelled out rather than named: `%NtsHeader` is
            // declared further down the module, and a named struct type has to
            // exist before an initializer uses it.
            let _ = writeln!(
                out,
                "@{} = internal global {{ ptr, i64, i32, i32 }} \
                 {{ ptr @nts_desc_{tag}, i64 {}, i32 0, i32 0 }}",
                static_closure_name(layout),
                nts_core::hir::layout::IMMORTAL
            );
        }
        name_constant(&mut out, &tag, &layout.name);
        let is_cyclic = u32::from(cyclic.get(index).copied().unwrap_or(true));
        // Everything that does not depend on *which* class, so the shape's
        // global and the per-class ones cannot drift apart.
        let head = format!(
            "i32 {}, i32 {}, i32 {}, i32 {is_cyclic}, {reference_table}, {methods}",
            descriptor_kind(&layout.name),
            placed.size,
            references.len()
        );
        // `element` is `NTS_ARRAY_UNKNOWN` for an object, as in C.
        let tail = format!("i32 {}, {erased_table}, i32 0, i32 {foreign}, {foreign_table}", erased.len());
        let _ = writeln!(
            out,
            "@nts_desc_{tag} = internal constant %NtsDescriptor \
             {{ {head}, ptr @nts_name_{tag}, {tail} }}"
        );
        class_descriptors(&mut out, program, layout, &tag, (&head, &tail));
    }
    array_descriptors(&mut out, program);
    out
}

/// One descriptor per scalar element type an array is made of. An array of
/// references uses the runtime's `nts_desc_ref`, declared above.
fn array_descriptors(out: &mut String, program: &Program) {
    // An array of a family's objects: its one foreign slot names the family,
    // which the collector reads for holders, and the family's operations,
    // which `counting_declarations` wrote. `size` is a pointer's, as the C
    // backend's `sizeof(void *)`.
    for (counting, family) in nts_codegen_common::counting::array_families(program) {
        let descriptor = nts_codegen_common::counting::array_descriptor_name(&counting);
        let ops = nts_codegen_common::counting::ops_name(&counting);
        let name = format!("{family:?}[]");
        let _ = writeln!(*out, "@{descriptor}.name = internal constant [{} x i8] c\"{name}\\00\"", name.len() + 1);
        let _ = writeln!(
            *out,
            "@{descriptor}.slot = internal constant [1 x {{ i32, i32, ptr }}] [{{ i32, i32, ptr }} {{ i32 0, i32 {}, ptr @{ops} }}]",
            family.runtime_id()
        );
        let size = nts_core::hir::layout::shape_of(&HirType::NativePointer(nts_core::hir::native::Pointee::Void))
            .map_or(8, |shape| shape.size);
        let _ = writeln!(
            *out,
            "@{descriptor} = internal constant %NtsDescriptor {{ i32 0, i32 {size}, i32 0, i32 {}, ptr null, ptr null, \
             ptr @{descriptor}.name, i32 0, ptr null, i32 {}, i32 1, ptr @{descriptor}.slot }}",
            u32::from(family.holds_closures()),
            nts_codegen_common::counting::ARRAY_FOREIGN
        );
    }
    let mut seen: Vec<String> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            if !matches!(op.kind, OpKind::ArrayNew { .. }) {
                continue;
            }
            let HirType::Managed(nts_core::hir::ManagedType::Array(element)) = &op.ty else {
                continue;
            };
            // An array of foreign objects has its family's descriptor, which
            // `counting_declarations` writes beside the family's operations.
            if element.is_managed() || nts_codegen_common::counting::counted_element(element).is_some() {
                continue;
            }
            let Some(shape) = nts_core::hir::layout::shape_of(element) else {
                continue;
            };
            let tag = element_tag(element);
            if seen.contains(&tag) {
                continue;
            }
            seen.push(tag.clone());
            let _ = writeln!(
                *out,
                "@nts_name_arr_{tag} = internal constant [{} x i8] c\"{tag}[]\\00\"",
                tag.len() + 3
            );
            // For an array, `erased` is a fact about *every* element rather
            // than a table of offsets, exactly as `references` is. One that
            // said zero would never be walked, and a string held in it
            // would be released while something still pointed at it.
            let erased = u32::from(**element == HirType::Erased);
            let _ = writeln!(
                *out,
                "@nts_desc_arr_{tag} = internal constant %NtsDescriptor {{ i32 0, i32 {}, \
                 i32 0, i32 0, ptr null, ptr null, ptr @nts_name_arr_{tag}, i32 {erased}, \
                 ptr null, i32 {}, i32 0, ptr null }}",
                shape.size,
                nts_codegen_common::counting::array_element(element)
            );
        }
    }
}

/// A layout's foreign slots: the fields holding a counted foreign object, each
/// with its family and its family's `NtsFamilyOps`, whose release `nts_free`
/// calls when the object dies.
/// Answers how many, and the table's operand (`ptr null` for none).
fn foreign_slots(out: &mut String, layout: &nts_core::hir::Layout, offsets: &[u32], tag: &str) -> (usize, String) {
    let slots: Vec<String> = layout
        .fields
        .iter()
        .enumerate()
        .filter_map(|(at, field)| {
            let ops = nts_codegen_common::counting::ops_name(&field.ty.counting()?);
            let family = field.ty.counted_family().map_or(0, nts_core::hir::native::Family::runtime_id);
            Some(format!("{{ i32, i32, ptr }} {{ i32 {}, i32 {family}, ptr @{ops} }}", offsets.get(at)?))
        })
        .collect();
    if slots.is_empty() {
        return (0, "ptr null".to_owned());
    }
    let _ = writeln!(
        out,
        "@nts_foreign_{tag} = internal constant [{} x {{ i32, i32, ptr }}] [{}]",
        slots.len(),
        slots.join(", ")
    );
    (slots.len(), format!("ptr @nts_foreign_{tag}"))
}

/// A global's symbol, which is its source name.
fn global_symbol(program: &Program, at: usize) -> String {
    program
        .globals
        .get(at)
        .map_or_else(|| format!("nts_global_{at}"), |global| global.name.clone())
}

/// The address of an array's element block, and the index into it.
///
/// Leaves `%out.blk` holding the address of the `elements` field and `%out.i`
/// holding the checked index, which the caller loads and indexes through.
fn index_lines(
    func: &Func,
    out: &str,
    array: ValueId,
    index: ValueId,
    checked: bool,
    growing: bool,
) -> Result<Vec<String>, Diagnostic> {
    // An array's elements sit at a fixed offset inside its header; a view's are
    // in a buffer somewhere else, so the block is a call rather than an offset.
    // The helper is pure, so repeated accesses in one function fold to one.
    let view = matches!(
        func.values[array.0 as usize].ty,
        HirType::Managed(nts_core::hir::ManagedType::View(_))
    );
    //
    // Both branches leave `%out.block` holding the *elements* pointer, so the
    // callers index it the same way. An array's `elements` is a field, so its
    // address is an offset and the pointer is loaded out of it; a view's bytes
    // are what `nts_view_bytes` already returns, and loading from that would
    // read the first eight bytes of the data as an address.
    let block = if view {
        vec![format!(
            "{out}.block = call ptr @nts_view_bytes(ptr {})",
            name(array)
        )]
    } else {
        vec![
            format!(
                "{out}.blk = getelementptr i8, ptr {}, i64 {}",
                name(array),
                nts_core::hir::layout::ELEMENTS_OFFSET
            ),
            format!("{out}.block = load ptr, ptr {out}.blk{}", tbaa("ptr")),
        ]
    };
    // **The index first, then the block**, and the order is load-bearing for a
    // growing store: `nts_slot_or_grow_fn` may reallocate the elements, so a
    // pointer loaded before it can be to freed memory. The two do not depend on
    // each other, so the safe order is also always a valid one -- which is why
    // it is unconditional rather than a second shape for the growing case.
    let mut lines = Vec::with_capacity(block.len() + 3);
    let held = &func.values[index.0 as usize].ty;
    let integral = matches!(held, HirType::Int { .. });
    if checked {
        // The index at the width the check declares. `matches!(Int { .. })` is
        // true of an `i64` as well, and this used to hand one straight to
        // `nts_check_fn(ptr, uint32_t)` as an `i32` -- an index wide enough to
        // need narrowing is exactly the one where saying `i32` and meaning
        // `i64` is wrong. Found by a benchmark whose counter is bounded by a
        // length rather than a constant.
        let helper = match (view, integral, growing) {
            (true, true, _) => "nts_view_check_fn",
            (true, false, _) => "nts_view_index_fn",
            (false, true, false) => "nts_check_fn",
            (false, true, true) => "nts_check_or_grow_fn",
            (false, false, false) => "nts_index_fn",
            (false, false, true) => "nts_slot_or_grow_fn",
        };
        let at = helper_operand(func, out, helper, 1, index, &mut lines)?;
        lines.push(format!(
            "{out}.i = call i32 @{helper}(ptr {}, {at})",
            name(array)
        ));
    } else if integral {
        let have = ty_of(held, func)?;
        lines.push(if have == "i32" {
            format!("{out}.i = add i32 {}, 0", name(index))
        } else {
            converted(&format!("{out}.i"), have, "i32", &name(index), func)?
        });
    } else {
        // Proven in range, so the conversion is exact whichever representation
        // it arrived in.
        lines.push(format!("{out}.i = fptoui double {} to i32", name(index)));
    }
    lines.extend(block);
    Ok(lines)
}

/// A name for a scalar element type, for the descriptor it needs.
fn element_tag(ty: &HirType) -> String {
    match ty {
        HirType::Bool => "bool".to_owned(),
        HirType::Erased => "value".to_owned(),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Int { bits, signed: true } => format!("i{bits}"),
        HirType::Int {
            bits,
            signed: false,
        } => format!("u{bits}"),
        other => format!("{other:?}"),
    }
}

/// A layout's descriptor symbol, with anything LLVM dislikes replaced.
/// The three operations a suspended function is made of.
///
/// `hir::suspend` turns a function that awaits into a state machine in the
/// middle end, so a backend never sees `await` -- it sees the machine. What is
/// left is subscribing the rest of the function to a promise, and checking that
/// a cell was written before it is read.
fn suspension(
    program: &Program,
    func: &Func,
    value: ValueId,
    out: &str,
) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        // A cell read before its initializer ran. The check is a load and a
    // branch rather than a call, because the answer is yes on every
    // execution but the broken one -- so this is the one place the emitter
    // writes basic blocks of its own.
    OpKind::CellReady { cell, name: what } => {
        let held = &func.values[cell.0 as usize].ty;
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = held else {
            return Err(refuse(func, "a readiness check on something that is not a cell"));
        };
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.types.contains(id))
            .ok_or_else(|| refuse(func, "a cell whose type has no layout"))?;
        let placed = nts_core::hir::layout::place(&layout.fields)
            .ok_or_else(|| refuse(func, "a cell whose fields cannot be placed"))?;
        let at = layout
            .fields
            .iter()
            .position(|field| field.name == "ready")
            .and_then(|at| placed.offsets.get(at).copied())
            .ok_or_else(|| refuse(func, "a cell with no `ready` field"))?;
        let text = format!("@nts_cellname_{}", cell_names(program)
            .iter()
            .position(|known| known == what)
            .unwrap_or(0));
        [
            format!("{out}.at = getelementptr i8, ptr {}, i64 {at}", name(*cell)),
            format!("{out}.ready = load i8, ptr {out}.at{}", tbaa("i8")),
            format!("{out}.is = icmp ne i8 {out}.ready, 0"),
            // `out` already carries its `%`, and the label definitions below
            // strip it. Adding one here made `label %%v2.ok`, which is not a
            // token clang accepts -- the emitter was unreachable *and* could
            // never have produced a valid module.
            format!("br i1 {out}.is, label {out}.ok, label {out}.no"),
            format!("{}.no:", out.trim_start_matches('%')),
            format!("  call void @nts_cell_unready(ptr {text})"),
            format!("  br label {out}.ok"),
            format!("{}.ok:", out.trim_start_matches('%')),
        ]
        .join("\n  ")
    }
    // `await` is not a code generation concept. `hir::suspend` turns a
    // function that awaits into a state machine and leaves `Suspend`
    // behind; one reaching here means that pass did not run.
    OpKind::Await { .. } => {
        return Err(refuse(func, "an `await`, which the suspension pass should have removed"));
    }
    // Subscribing the rest of this function to a promise. `NtsTask` is
    // three pointers -- what to run, how to drop it unrun, and the frame
    // both act on -- and the platform passes it in memory, which is what
    // `byval` in the runtime's signature says.
    OpKind::Suspend {
        promise,
        frame,
        resume,
    } => [
        format!("{out}.task = alloca %struct.NtsTask, align 8"),
        format!("store ptr {}, ptr {out}.task{}", symbol(resume), tbaa("ptr")),
        format!("{out}.drop = getelementptr %struct.NtsTask, ptr {out}.task, i32 0, i32 1"),
        format!("store ptr null, ptr {out}.drop{}", tbaa("ptr")),
        format!("{out}.state = getelementptr %struct.NtsTask, ptr {out}.task, i32 0, i32 2"),
        format!("store ptr {}, ptr {out}.state{}", name(*frame), tbaa("ptr")),
        format!(
            "call void @nts_promise_subscribe(ptr {}, ptr byval(%struct.NtsTask) align 8 {out}.task)",
            name(*promise)
        ),
    ]
    .join("\n  "),
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which is not a suspension"),
            ));
        }
    })
}

/// Every name a readiness check can report, in a stable order.
///
/// The runtime prints it, so it is a C string rather than an `NtsString`, and
/// the emitter cannot add a global from inside an operation -- so they are
/// collected up front the way string literals are.
fn cell_names(program: &Program) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::CellReady { name, .. } = &op.kind
                && !names.contains(name)
            {
                names.push(name.clone());
            }
        }
    }
    names
}

/// One `private constant` per name, NUL terminated for C.
fn cell_name_globals(program: &Program) -> String {
    let mut out = String::new();
    for (at, name) in cell_names(program).iter().enumerate() {
        let bytes: String = name
            .bytes()
            .map(|byte| {
                if byte.is_ascii_graphic() && byte != b'"' && byte != b'\\' {
                    (byte as char).to_string()
                } else {
                    format!("\\{byte:02X}")
                }
            })
            .collect();
        let _ = writeln!(
            out,
            "@nts_cellname_{at} = private unnamed_addr constant [{} x i8] c\"{bytes}\\00\"",
            name.len() + 1
        );
    }
    out
}

/// The class's dispatch table, where the hierarchy has one.
///
/// A slot the class does not implement is null, which is unreachable: a call
/// only uses a slot the receiver's static type declares, and every class at or
/// below that type fills it.
fn vtable(out: &mut String, layout: &nts_core::hir::Layout, tag: &str) -> String {
    if layout.methods.iter().all(Option::is_none) {
        return "ptr null".to_owned();
    }
    let entries: Vec<String> = layout
        .methods
        .iter()
        .map(|method| {
            method.as_ref().map_or_else(
                || "ptr null".to_owned(),
                |name| format!("ptr {}", symbol(name)),
            )
        })
        .collect();
    let _ = writeln!(
        out,
        "@nts_vtable_{tag} = internal constant [{} x ptr] [{}]",
        entries.len(),
        entries.join(", ")
    );
    format!("ptr @nts_vtable_{tag}")
}

/// Whether anything in the program refers to this layout's single instance.
///
/// Asked of the IR rather than tracked alongside it: `ClosureStatic` is the
/// only thing that reads one, so the ops that read it are the whole answer.
fn wants_a_static_instance(program: &Program, layout: &nts_core::hir::Layout) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(op.kind, OpKind::ClosureStatic)
                && matches!(&op.ty, HirType::Managed(nts_core::hir::ManagedType::Object(ty))
                    if layout.types.contains(ty))
        })
    })
}

/// The one instance of a closure class that captures nothing.
/// The callback bridges this program needs, as LLVM definitions.
///
/// A real function with the foreign signature that calls the compiled one. It
/// has to exist in each backend separately: the C backend's bridge is C, and a
/// program compiled here links against the same consumer, so the symbol and the
/// behaviour must match while the text cannot.
///
/// The receiver is the static closure's global. Only a closure with no captures
/// is bridged, so one immortal instance is the whole of its state.
fn bridges(program: &Program, platform: Platform) -> Result<String, Diagnostic> {
    let mut out = String::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut declared = false;
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| func.value(*value)) {
            let OpKind::NativeBridge { closure, signature, context, once } = &op.kind else { continue };
            let layout = closure_layout(program, func, *closure)?;
            let target = layout
                .closure_call()
                .ok_or_else(|| refuse(func, "a callback bridge whose closure publishes no function"))?;
            let name = nts_codegen_common::symbols::bridge_name(target, signature, *once);
            if !seen.insert(name.clone()) {
                continue;
            }
            if !declared {
                declared = true;
                out.push_str("declare void @nts_callback_enter()\n");
                out.push_str("declare void @nts_callback_leave()\n");
            }
            let compiled = program
                .funcs
                .iter()
                .find(|candidate| candidate.name == target)
                .ok_or_else(|| refuse(func, "a callback bridge naming a function this program does not define"))?;
            // With a context, the foreign signature's last parameter is the
            // receiver -- the closure C was lent and hands back -- so the two
            // counts agree instead of differing by one. Both are `ptr`, so it
            // is passed on as it arrives.
            // And the compiled function may take fewer than C passes -- `() =>
            // count++` handles a signal that passes the instance -- so C's
            // extra trailing arguments are accepted and dropped. More is the
            // mismatch.
            let foreign = signature.parameters.len() - usize::from(*context);
            if compiled.params.is_empty() || compiled.params.len() - 1 > foreign {
                return Err(refuse(func, "a callback bridge whose foreign signature and compiled function disagree about arity"));
            }
            let last = signature.parameters.len().saturating_sub(1);
            let mut parameters = Vec::new();
            let mut arguments = if *context {
                vec![format!("ptr %a{last}")]
            } else {
                vec![format!("ptr @{}", static_closure_name(layout))]
            };
            let mut body = String::new();
            for (at, foreign) in signature.parameters.iter().enumerate() {
                let from = foreign.abi(platform.abi);
                // The context, which became the receiver, and any argument C
                // passes that the compiled function does not take.
                if (*context && at == last) || at + 1 >= compiled.params.len() {
                    parameters.push(format!("{} %a{at}", ty_of(&from, compiled)?));
                    continue;
                }
                let to = compiled.params[at + 1].ty.clone();
                let (from_ty, to_ty) = (ty_of(&from, compiled)?, ty_of(&to, compiled)?);
                parameters.push(format!("{from_ty} %a{at}"));
                if from == to {
                    arguments.push(format!("{to_ty} %a{at}"));
                } else if to == HirType::Bool {
                    // A `gboolean` C passes, read as C reads it: any non-zero
                    // is true, as `Convert` reads one -- a `trunc` to `i1`
                    // would read 2 as false.
                    let _ = writeln!(body, "  {}", is_not_zero(&format!("%p{at}"), &from, from_ty, &format!("%a{at}")));
                    arguments.push(format!("{to_ty} %p{at}"));
                } else {
                    let instruction = conversion(&from, &to, compiled)?;
                    let _ = writeln!(body, "  %p{at} = {instruction} {from_ty} %a{at} to {to_ty}");
                    arguments.push(format!("{to_ty} %p{at}"));
                }
            }
            let want = signature.result.abi(platform.abi);
            let have = compiled.return_type.clone();
            // `symbol` already carries the sigil; a second one is `@@f`, which
            // the assembler reports as "expected value token" pointing at the
            // call and not at the name.
            // Raised around the call so a `throw` inside it stops at this
            // boundary instead of jumping past the C frames that called us.
            // Same two calls the C bridge makes, because the policy lives in
            // the runtime and not in either backend's text.
            let enter = "  call void @nts_callback_enter()";
            // A once-bridge gives the closure back after its one call, before
            // leaving, as the C bridge does.
            let leave = if *once {
                format!("  call void @nts_closure_unlend_once(ptr %a{last})\n  call void @nts_callback_leave()")
            } else {
                "  call void @nts_callback_leave()".to_owned()
            };
            let call = format!("call {} {}({})", ty_of(&have, compiled)?, symbol(&compiled.name), arguments.join(", "));
            let parameters = parameters.join(", ");
            if want == HirType::Void {
                let _ = writeln!(out, "define internal void @{name}({parameters}) nounwind {{");
                out.push_str(&body);
                let _ = writeln!(out, "{enter}\n  {call}\n{leave}\n  ret void\n}}");
            } else {
                let want_ty = ty_of(&want, compiled)?;
                let _ = writeln!(out, "define internal {want_ty} @{name}({parameters}) nounwind {{");
                out.push_str(&body);
                let _ = writeln!(out, "{enter}");
                let _ = writeln!(out, "  %r = {call}");
                let _ = writeln!(out, "{leave}");
                if have == want {
                    let _ = writeln!(out, "  ret {want_ty} %r\n}}");
                } else {
                    let instruction = conversion(&have, &want, compiled)?;
                    let _ = writeln!(out, "  %c = {instruction} {} %r to {want_ty}", ty_of(&have, compiled)?);
                    let _ = writeln!(out, "  ret {want_ty} %c\n}}");
                }
            }
        }
    }
    Ok(out)
}

/// The layout of the closure a bridge names.
fn closure_layout<'p>(
    program: &'p Program,
    func: &Func,
    closure: nts_core::hir::ValueId,
) -> Result<&'p nts_core::hir::Layout, Diagnostic> {
    let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = &func.value(closure).ty else {
        return Err(refuse(func, "a callback bridge whose operand is not a closure"));
    };
    program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(id))
        .ok_or_else(|| refuse(func, "a callback bridge whose closure type has no layout"))
}

/// The symbol of the bridge for one function reached through one signature.
///
/// The same name the C backend derives, because the two must not disagree: a
/// program compiled by one and linked against a consumer built for the other
/// would otherwise differ in a symbol nobody looked at.
fn static_closure_name(layout: &nts_core::hir::Layout) -> String {
    format!("nts_fnval_{}", descriptor_name(layout))
}

/// `x instanceof C`, as one call per class that satisfies it, or'd together.
///
/// The set is closed when the program is built, so there is no chain to walk.
/// A class with no layout was never laid out here, so nothing can be an
/// instance of it and it contributes nothing.
///
/// Through `nts_is_class` rather than an inline comparison because this backend
/// cannot short-circuit the load without branching: the tag has to rule out the
/// values with no class before the descriptor is read, and a `select` would
/// read it either way.
fn instance_of(
    program: &Program,
    out: &str,
    operand: nts_core::hir::ValueId,
    classes: &[nts_core::hir::ClassId],
    platform: Platform,
) -> String {
    let subject = name(operand);
    // System V takes the two scalars, extracted once for every class; Win64 a
    // copy, stored again before each call because the callee owns it.
    let win64 = indirect::applies(platform);
    let mut lines = if win64 {
        Vec::new()
    } else {
        vec![
            format!("{out}.t = extractvalue {ERASED_TYPE} {subject}, 0"),
            format!("{out}.p = extractvalue {ERASED_TYPE} {subject}, 1"),
        ]
    };
    let mut answers: Vec<String> = Vec::new();
    for class in classes {
        let Some(layout) = program
            .layouts
            .iter()
            .find(|layout| layout.types.contains(class))
        else {
            continue;
        };
        let at = format!("{out}.c{}", answers.len());
        let argument = if win64 {
            indirect::argument(ERASED_TYPE, &subject, 0, &mut lines)
        } else {
            format!("i32 {out}.t, i64 {out}.p")
        };
        lines.push(format!(
            "{at} = call zeroext i1 @nts_is_class({argument}, ptr @nts_desc_{})",
            descriptor_for(program, layout, Some(*class))
        ));
        answers.push(at);
    }
    let Some((first, rest)) = answers.split_first() else {
        // Nothing to compare against, so nothing is one.
        return format!("{out} = add i1 false, 0");
    };
    let mut running = first.clone();
    for (step, next) in rest.iter().enumerate() {
        let joined = format!("{out}.or{step}");
        lines.push(format!("{joined} = or i1 {running}, {next}"));
        running = joined;
    }
    lines.push(format!("{out} = add i1 {running}, 0"));
    lines.join("\n  ")
}

/// The classes that share one layout. See `hir::Program::classes`.
fn identities_sharing<'a>(
    program: &'a Program,
    layout: &nts_core::hir::Layout,
) -> Vec<&'a nts_core::hir::ClassIdentity> {
    let mut found: Vec<&nts_core::hir::ClassIdentity> = Vec::new();
    for class in &program.classes {
        if !class.types.iter().any(|ty| layout.types.contains(ty)) {
            continue;
        }
        if found.iter().any(|known| known.symbol == class.symbol) {
            continue;
        }
        found.push(class);
    }
    found
}

/// One class's spelling within its shape, with the symbol where two classes of
/// one name share a layout.
fn identity_suffix(
    sharing: &[&nts_core::hir::ClassIdentity],
    class: &nts_core::hir::ClassIdentity,
) -> String {
    let spelling: String = class
        .name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if sharing.iter().filter(|other| other.name == class.name).count() > 1 {
        return format!("{spelling}_{}", class.symbol);
    }
    spelling
}

/// The descriptor a value of this type carries.
///
/// The layout's own where nothing shares it. Where two classes share a shape
/// they get one global each -- same size, same reference map, same table --
/// differing in the **address**, which is what `nts_is_class` compares. The C
/// backend does the same thing and `examples/two-classes-one-descriptor` holds
/// both lanes to it.
fn descriptor_for(
    program: &Program,
    layout: &nts_core::hir::Layout,
    ty: Option<nts_core::hir::ClassId>,
) -> String {
    let shape = descriptor_name(layout);
    let sharing = identities_sharing(program, layout);
    if sharing.len() < 2 {
        return shape;
    }
    let Some(ty) = ty else { return shape };
    match sharing.iter().find(|class| class.types.contains(&ty)) {
        Some(class) => format!("{shape}__{}", identity_suffix(&sharing, class)),
        None => shape,
    }
}

fn descriptor_name(layout: &nts_core::hir::Layout) -> String {
    layout
        .name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// Runtime helpers this backend emits calls to without the program naming them.
///
/// A bounds check, a retain, an allocation: the lowering does not put these in
/// `Callee::External`, the backend reaches for them. Declared from the same
/// table as everything else so there is one place a signature comes from.
pub const ALWAYS_DECLARED: &[&str] = &[
    // The no-match arm of an open field chain. Declared always, because the
    // chain is emitted wherever a slot has several layouts and a call with no
    // declaration is an invalid module rather than a refusal.
    "nts_no_arm",
    "nts_array_new",
    // The view trio. Emitted as raw IR from `index_lines` rather than as HIR
    // calls, so `externals` -- which reads `OpKind::Call` -- cannot see them
    // and would leave every element access referring to an undeclared symbol.
    "nts_view_bytes",
    "nts_view_length",
    "nts_view_check_fn",
    "nts_view_index_fn",
    "nts_array_new_uninitialized",
    "nts_bigint_shl",
    "nts_bigint_shr",
    "nts_cell_unready",
    "nts_check_fn",
    // The growing pair, here for the reason the view trio is: `index_lines`
    // writes the call as raw IR, so `externals` -- which reads `OpKind::Call` --
    // never sees it, and the module referred to an undefined symbol.
    "nts_check_or_grow_fn",
    "nts_slot_or_grow_fn",
    "nts_concat",
    "nts_promise_subscribe",
    "nts_index_fn",
    "nts_is_class",
    "nts_object_new",
    "nts_max_fn",
    "nts_min_fn",
    "nts_release",
    "nts_retain",
    "nts_round_fn",
    "nts_str_char_code_at_fn",
    "nts_str_char_code_at_int_fn",
    "nts_string_cmp",
    "nts_string_eq",
    "nts_string_truthy",
    "nts_to_int32_fn",
    "nts_to_uint32_fn",
    "nts_unit_fn",
    "nts_value_eq_boolean_fn",
    "nts_value_eq_number_fn",
    "nts_value_eq_reference",
    "nts_value_eq_string",
    "nts_value_release",
    "nts_value_retain",
    "nts_value_strict_eq",
    "nts_value_truthy_fn",
];

/// `a === b` on two strings, which compares by contents.
///
/// See the arm that reaches this for why it exists and why it must come after
/// the absent-reference test.
fn string_equality(out: &str, bin: BinOp, lhs: ValueId, rhs: ValueId) -> String {
    let same = format!("{out}.eq");
    let call = format!(
        "{same} = call zeroext i1 @nts_string_eq(ptr {}, ptr {})",
        name(lhs),
        name(rhs)
    );
    let answer = if matches!(bin, BinOp::Ne) {
        format!("{out} = xor i1 {same}, true")
    } else {
        format!("{out} = add i1 {same}, 0")
    };
    format!("{call}\n  {answer}")
}

/// The two rules for a binary operator on strings, which share a guard.
///
/// `None` where the operands are not two present strings, which is the caller's
/// signal to fall through to the ordinary arithmetic path. The absent test has
/// to come first for the reason `absent_reference` gives: `s === null` asks
/// about the pointer, and reading contents through it would be reading through
/// the null one.
fn string_binary(
    func: &Func,
    out: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    if func.values[lhs.0 as usize].ty != HirType::Managed(nts_core::hir::ManagedType::String)
        || absent(func, lhs)
        || absent(func, rhs)
    {
        return None;
    }
    match bin {
        BinOp::Eq | BinOp::Ne => Some(string_equality(out, bin, lhs, rhs)),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Some(string_ordering(out, bin, lhs, rhs)),
        _ => None,
    }
}

/// `a < b` and its three siblings on two strings, which order by code unit.
///
/// The C operator here would compare the two *addresses*, which is what both
/// backends did until the sweep grew a cell for it. See the runtime's
/// `nts_string_cmp` for why the answer is neither `strcmp` nor `memcmp`: the
/// two sides may be different widths, and the language orders by UTF-16 code
/// unit rather than by code point.
fn string_ordering(out: &str, bin: BinOp, lhs: ValueId, rhs: ValueId) -> String {
    let order = format!("{out}.cmp");
    let call = format!(
        "{order} = call i32 @nts_string_cmp(ptr {}, ptr {})",
        name(lhs),
        name(rhs)
    );
    // Signed, because the runtime answers like `memcmp`: negative, zero or
    // positive rather than a three-valued enumeration.
    let predicate = match bin {
        BinOp::Lt => "slt",
        BinOp::Le => "sle",
        BinOp::Gt => "sgt",
        _ => "sge",
    };
    format!("{call}\n  {out} = icmp {predicate} i32 {order}, 0")
}

/// Whether a value is the absent reference, written as a constant.
///
/// `s === null` is a question about the pointer and not about the text, so it
/// has to be answered *before* the string rule: reading through the pointer to
/// compare contents is reading through the null one. The C backend orders its
/// two rules this way and says so; this is the same order spelled as a guard,
/// because here the string rule is a match arm rather than a function that can
/// decline.
///
/// Fifteen crashes in `examples/optional-access` were this, and the arm shipped
/// without it for one build.
fn absent(func: &Func, value: ValueId) -> bool {
    matches!(
        func.values[value.0 as usize].kind,
        OpKind::ConstNull | OpKind::ConstUndefined
    )
}

/// The frame bound on a call whose result the escape analysis kept off the heap.
///
/// `benches/substrings` is a parser's shape -- one `substring` per word -- and
/// without this the second backend allocated for every token while the first
/// allocated for none. It ran 2.25x slower for exactly that reason.
fn frame_units(func: &Func, value: ValueId) -> Option<u32> {
    match &func.values[value.0 as usize].kind {
        OpKind::Call {
            frame: Some(units), ..
        } => Some(*units),
        _ => None,
    }
}

/// Stack storage for the strings the escape analysis kept out of the heap.
///
/// Every one of them, in the **entry block**. An `alloca` runs where it is
/// written, so one emitted beside its call sits inside whatever loop the call
/// is in and takes another 186 bytes of stack every iteration -- and
/// `benches/substrings` slices a word at a time, sixty-four rounds deep. The C
/// backend declares this storage with the function's other locals and says why:
/// one slot per allocation *site* rather than one per execution of it, which is
/// correct precisely because nothing outlives the iteration that made it.
///
/// `NTS_FRAME_STRING(units)`: a header and `units + 1` code units, which is a
/// *bound* rather than a length -- what the compiler knows is that a slice
/// cannot exceed the string it came from, and how long it actually is only
/// running finds out.
///
/// An **object** placed in the frame is here for the same reason and was not,
/// for as long as this backend has placed one. Its `alloca` sat where the
/// allocation was written, so an object made in a loop took another `sizeof`
/// bytes of stack every iteration and gave none of them back until the function
/// returned. `examples/cycles` builds one `Node` per round and asks for as many
/// rounds as the caller likes: it ran off the end of the stack and died of
/// signal 11, and it took a change that placed *more* objects in frames to
/// reach it.
fn frame_storage(program: &Program, func: &Func) -> Vec<String> {
    func.values
        .iter()
        .enumerate()
        .filter_map(|(at, op)| {
            let out = name(ValueId(u32::try_from(at).unwrap_or(0)));
            match op.kind {
                OpKind::Call {
                    frame: Some(units), ..
                } => Some(one_frame(&out, units)),
                // A block's frame slot: see `OpKind::NativeBlock`.
                OpKind::NativeBlock { .. } => Some(format!("{out}.block = alloca %nts.block, align 8")),
                OpKind::ObjectNew { frame: true } => {
                    let placed = object_placement(program, &op.ty)?;
                    Some(format!(
                        "{out}.frame = alloca i8, i64 {}, align {}",
                        placed.size, placed.align
                    ))
                }
                _ => None,
            }
        })
        .collect()
}

/// Where an object type's fields sit, for the two places that need it.
fn object_placement(
    program: &Program,
    ty: &HirType,
) -> Option<nts_core::hir::layout::Placement> {
    let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
        return None;
    };
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(id))?;
    nts_core::hir::layout::place(&layout.fields)
}

fn one_frame(out: &str, units: u32) -> String {
    let bytes = u64::from(nts_core::hir::layout::HEADER.size) + 2 * (u64::from(units) + 1);
    format!(
        "{out}.frame = alloca i8, i64 {bytes}, align {}",
        nts_core::hir::layout::POINTER
    )
}

/// The name this backend can actually call.
///
/// A helper the lowering names may be `static inline` in the header, which is
/// right for C and invisible here -- there is no symbol. The runtime puts a
/// linkable companion beside each one, spelled `_fn`, and this prefers the
/// original so that C keeps its inline and only the second backend pays a call
/// that `-flto` removes anyway.
///
/// `nts_to_uint8` is why: `x | 0` on a `Uint8Array` element lowers to it, and
/// `benches/cases/bytes` was refused outright for want of one symbol.
fn linkable(target: &str) -> String {
    if signatures::signature(target).is_some() {
        return target.to_owned();
    }
    let companion = format!("{target}_fn");
    if signatures::signature(&companion).is_some() {
        companion
    } else {
        target.to_owned()
    }
}

/// The name of a helper's frame-placed form.
///
/// `nts_str_slice_into` is a real function; `nts_str_substring_into` is a
/// `static inline` fast path with a linkable companion beside it, the same
/// arrangement `nts_to_int32_fn` has. Preferring the plain `_into` and falling
/// back to `_into_fn` means the fast one is used wherever it is linkable.
fn into_form(target: &str) -> String {
    let into = format!("{target}_into");
    if signatures::signature(&into).is_some() {
        into
    } else {
        format!("{into}_fn")
    }
}

/// One `declare` line for a runtime helper, from the generated table.
fn declaration(name: &str, platform: Platform) -> Option<String> {
    let known = signatures::signature_on(name, platform)?;
    // Nothing in this language unwinds -- there is no exception mechanism to
    // unwind *with* -- so every call is `nounwind` whatever else it is. Saying
    // so lets LLVM stop reasoning about paths that cannot exist.
    let mut carried: Vec<&str> = known.attributes.to_vec();
    if !carried.contains(&"nounwind") {
        carried.insert(0, "nounwind");
    }
    let attributes = carried.join(" ");
    Some(format!(
        "declare {} {}({}) {attributes}",
        known.returns,
        symbol(name),
        known.params.join(", ")
    ))
}

/// One `declare` per runtime helper the program calls, from `signatures`.
///
/// Read off the *call site* at first, which is sound only where the lowering's
/// types and the runtime's already agree -- and they do not. `nts_tag_name`
/// takes a `uint32_t` and the lowering hands it a double, because C converts
/// implicitly at the call and the C backend never had to notice. The declared
/// double went into an SSE register, the callee read an integer one, and
/// `typeof v` answered "undefined" for a number. Found by the cross-backend
/// test, which is the only thing that could have.
fn externals(program: &Program, platform: Platform) -> Vec<String> {
    let mut seen: Vec<String> = ALWAYS_DECLARED
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    let mut lines = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            let (target, frame) = match &op.kind {
                OpKind::Call {
                    callee: Callee::External(target),
                    frame,
                    ..
                } => (target, frame),
                OpKind::Call {
                    callee: Callee::Native(target),
                    frame,
                    ..
                } if signatures::signature(&target.name).is_some() => (&target.name, frame),
                _ => continue,
            };
            // A frame-placed call goes to the `_into` form, so that is the name
            // that has to be declared -- not the one the operation carries.
            let target = if frame.is_some() {
                into_form(target)
            } else {
                linkable(target)
            };
            if seen.contains(&target) {
                continue;
            }
            let Some(line) = declaration(&target, platform) else {
                continue;
            };
            seen.push(target);
            lines.push(line);
        }
    }
    // A once-bridge calls `nts_closure_unlend_once` from its own body, which
    // no operation above names -- the bridges are emitted from the operations
    // that create them, not from calls.
    let once = program.funcs.iter().flat_map(|func| &func.values).any(|op| matches!(op.kind, OpKind::NativeBridge { once: true, .. }));
    let unlend = "nts_closure_unlend_once".to_owned();
    if once && !seen.contains(&unlend)
        && let Some(line) = declaration(&unlend, platform)
    {
        seen.push(unlend);
        lines.push(line);
    }
    // A block's copy and dispose helpers lend and give back its closure, on
    // the owning thread only (`objc::module`), and no operation names them.
    if !nts_codegen_common::objc::block_signatures(program).is_empty() {
        for helper in ["nts_is_owner_thread", "nts_closure_lend", "nts_closure_unlend"] {
            let helper = helper.to_owned();
            if !seen.contains(&helper)
                && let Some(line) = declaration(&helper, platform)
            {
                seen.push(helper);
                lines.push(line);
            }
        }
    }
    lines
}

/// The LLVM type a value of this HIR type lives in.
fn ty_of(ty: &HirType, func: &Func) -> Result<&'static str, Diagnostic> {
    Ok(match ty {
        HirType::NativePointer(name) => {
            if let nts_core::hir::native::Pointee::Opaque(name) = name
                && !nts_codegen_common::symbols::is_native_c_identifier(name) {
                return Err(refuse(func, "an opaque pointee that is not an available C struct tag"));
            }
            "ptr"
        }
        HirType::Void => "void",
        HirType::Bool => "i1",
        HirType::Float { bits: 32 } => "float",
        HirType::Float { .. } => "double",
        HirType::Int { bits: 8, .. } => "i8",
        HirType::Int { bits: 16, .. } => "i16",
        HirType::Int { bits: 32, .. } => "i32",
        HirType::Int { bits: 64, .. } => "i64",
        // Exact, and 128 bits rather than arbitrary precision -- the same
        // promise the C backend makes with `__int128`, which is where LLVM's
        // `i128` is what clang lowers that to anyway.
        HirType::BigInt => "i128",
        // One opaque pointer, whatever it points at. LLVM has had no other
        // kind since 17, and it is the same fact the C backend leans on when a
        // field's type has no layout: every managed value is a pointer.
        HirType::Managed(_) => "ptr",
        // `NtsValue`: a tag beside a union of a double, a bool and a pointer.
        //
        // The *type* is easy and the **ABI** is not, which is why this was
        // refused until clang was asked. `clang -S -emit-llvm` on a function
        // taking one prints `define { i32, i64 } @f(i32 %0, i64 %1)`: System V
        // classifies the sixteen bytes as two eightbytes, and the second is
        // `i64` rather than `double` because the union holds a pointer. So an
        // erased value is this aggregate inside a function and *two scalars*
        // across a call, which `function` and the call arm below arrange.
        HirType::Erased => ERASED_TYPE,
        other => {
            return Err(refuse(
                func,
                &format!("a value of type {other:?}, which this backend does not render yet"),
            ));
        }
    })
}

/// The extension attribute a value of this type carries across a call.
///
/// Taken from clang rather than derived. A `_Bool` is passed `zeroext`, an
/// `int8_t` `signext`, a `uint16_t` `zeroext`, and anything word-sized or
/// wider nothing at all -- which is what `clang -S -emit-llvm` prints for the
/// same declarations, and the only way to be sure is to look.
///
/// On x86-64 a bare `i1` happens to work, because both ends use the low bit of
/// a register. "Happens to work" is not an ABI: the runtime is compiled by
/// clang and this has to agree with it on every target, not on the one it was
/// written on. This is the whole of the ABI story for the scalar slice --
/// `NtsValue` by value is the part that is not, and it is refused rather than
/// guessed at.
/// The instruction that widens a narrower C slot to the value HIR holds, where
/// the two differ: a `c_long` read under Win64 is an `i32` becoming an `i64`,
/// by `sext` or `zext` as the slot's signedness says. `None` where they agree.
///
/// **One place decides it**, for returns, loads and callback arguments, so the
/// three cannot disagree about sign extension.
fn widening(slot: &HirType, value: &HirType) -> Option<&'static str> {
    match (slot, value) {
        (HirType::Int { bits: narrow, signed }, HirType::Int { bits: wide, .. }) if narrow < wide => {
            Some(if *signed { "sext" } else { "zext" })
        }
        _ => None,
    }
}

fn extension(ty: &HirType) -> &'static str {
    match ty {
        HirType::Int {
            bits: 8 | 16,
            signed: true,
        } => "signext ",
        // A `_Bool` and an unsigned narrow integer are the same case: neither
        // has a sign bit to carry into the upper half of the register.
        HirType::Bool
        | HirType::Int {
            bits: 8 | 16,
            signed: false,
        } => "zeroext ",
        _ => "",
    }
}

fn refuse(func: &Func, what: &str) -> Diagnostic {
    Diagnostic::error(
        "NTS3001",
        format!("{what} (in `{}`)", func.name),
        func.origin.location,
    )
}

/// A value's name in the emitted IR.
///
/// `%v12` for every value, including block parameters: SSA names are unique
/// per function and the HIR's are already numbered, so nothing has to be
/// invented or tracked.
fn name(value: ValueId) -> String {
    format!("%v{}", value.0)
}

fn label(block: BlockId) -> String {
    format!("b{}", block.0)
}

/// A function's symbol, mangled the way the C backend mangles it.
///
/// Not LLVM's quoted form, which was the first answer and the wrong one. An
/// exported name is an ABI a human links against, so it cannot depend on which
/// backend produced the object -- and `module#init` became `module__init` in
/// one output and `@"module#init"` in the other, so a driver could link against
/// exactly one of them. The rule lives in `nts_codegen_common::symbols` now and
/// both backends read it.
fn symbol(raw: &str) -> String {
    format!("@{}", nts_codegen_common::symbols::c_identifier(raw))
}

fn function(program: &Program, func: &Func, platform: Platform) -> Result<String, Diagnostic> {
    indirect::unexportable(func, platform).map_or(Ok(()), |why| Err(refuse(func, why)))?;
    let mut out = String::new();
    let returns = ty_of(&func.return_type, func)?;
    let mut params = Vec::new();
    // An erased parameter arrives as two scalars and is put back together at
    // the top of the entry block, which is what clang does for the same C.
    let mut prologue: Vec<String> = Vec::new();
    for (at, param) in func.params.iter().enumerate() {
        let ty = ty_of(&param.ty, func)?;
        // A parameter's *value* is whichever op is `Param(at)`, which is how
        // the rest of the function names it.
        let value = func
            .values
            .iter()
            .position(|op| matches!(op.kind, OpKind::Param(slot) if slot as usize == at))
            .map_or_else(
                || format!("%unused{at}"),
                |index| name(ValueId(u32::try_from(index).unwrap_or(0))),
            );
        if param.ty == HirType::Erased {
            params.push(format!("i32 {value}.tag"));
            params.push(format!("i64 {value}.bits"));
            prologue.push(format!(
                "{value}.half = insertvalue {ERASED_TYPE} undef, i32 {value}.tag, 0"
            ));
            prologue.push(format!(
                "{value} = insertvalue {ERASED_TYPE} {value}.half, i64 {value}.bits, 1"
            ));
        } else {
            params.push(format!("{ty} {}{value}", extension(&param.ty)));
        }
    }
    prologue.extend(frame_storage(program, func));
    prologue.extend(native::stack_arguments(func, platform));
    prologue.extend(native_memory::stack_storage(func, platform));
    prologue.extend(indirect::scratch(platform));
    let linkage = if func.exported { "" } else { "internal " };
    // `nounwind` on everything this compiler defines, for the reason above: the
    // language has no exceptions, so no frame here can be unwound through.
    //
    // Deliberately *not* `willreturn` or `mustprogress`. C guarantees forward
    // progress and JavaScript does not -- `while (true) {}` is a program the
    // checker accepts and this compiler compiles, and telling LLVM otherwise
    // would licence it to delete the loop.
    let _ = writeln!(
        out,
        "define {linkage}{}{returns} {}({}) nounwind {{",
        extension(&func.return_type),
        symbol(&func.name),
        params.join(", ")
    );

    // **Render every block's operations before writing any `phi`.**
    //
    // A `phi`'s incoming label has to be the block the edge actually leaves
    // from, and that is not always the block's own label: a guarded cell read
    // opens `<v>.no` and `<v>.ok` inline, so the terminator after one sits in
    // `<v>.ok` while `label(id)` still names the block. LLVM rejects the
    // module outright -- `PHI node entries do not match predecessors` -- so it
    // is a hard failure rather than a wrong answer, but it is reachable today
    // by a closure that reads a forward-captured `const` inside a `?:`, and
    // `examples/a-guarded-cell-read-in-a-branch` is that program.
    //
    // Rendering first is what makes the answer available: a successor may be
    // emitted before its predecessor (any back edge), so the exit label cannot
    // be discovered while writing in order.
    let mut rendered: Vec<Vec<String>> = Vec::with_capacity(func.blocks.len());
    for block in &func.blocks {
        let mut lines = Vec::new();
        for value in &block.ops {
            let line = operation(program, func, *value, platform)?;
            if !line.is_empty() {
                lines.push(line);
            }
        }
        rendered.push(lines);
    }
    let exits: Vec<String> = func
        .blocks
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let id = BlockId(u32::try_from(index).unwrap_or(0));
            rendered[index]
                .iter()
                .flat_map(|line| line.split('\n'))
                .filter_map(|line| {
                    let line = line.trim();
                    line.strip_suffix(':').filter(|name| {
                        !name.is_empty()
                            && name
                                .chars()
                                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
                    })
                })
                .next_back()
                .map_or_else(|| label(id), str::to_owned)
        })
        .collect();

    for (index, block) in func.blocks.iter().enumerate() {
        let id = BlockId(u32::try_from(index).unwrap_or(0));
        let _ = writeln!(out, "{}:", label(id));
        if index == 0 {
            for line in &prologue {
                let _ = writeln!(out, "  {line}");
            }
        }
        // Block parameters become `phi`, one incoming per predecessor edge.
        for (slot, param) in block.params.iter().enumerate() {
            let ty = ty_of(&func.values[param.0 as usize].ty, func)?;
            let incoming = incoming_for(func, id, slot, &exits);
            if incoming.is_empty() {
                return Err(refuse(
                    func,
                    &format!("a block parameter no edge supplies, in {}", label(id)),
                ));
            }
            let _ = writeln!(out, "  {} = phi {ty} {}", name(*param), incoming.join(", "));
        }
        for line in &rendered[index] {
            let _ = writeln!(out, "  {line}");
        }
        // Anything an outgoing edge has to convert, before the terminator that
        // carries it: a phi's incoming value must be available in the
        // predecessor, so this is the only place it can go.
        let _ = writeln!(out, "  {}", terminator(func, &block.terminator)?);
    }
    let _ = writeln!(out, "}}");
    Ok(out)
}

/// The name an edge supplies for one block parameter, and the conversion it
/// needs to get there.
///
/// The verifier's `compatible` treats **any scalar as compatible with any
/// other**: an `i32` may flow along an edge into an `f64` block parameter. That
/// is sound for the C backend, which writes `v7 = v0;` and lets C convert, and
/// it is not sound here -- a `phi double` taking an `i32` is not a module.
///
/// So the conversion is written out, in the *predecessor*, because that is
/// where a phi's incoming value has to be available. It is the same thing C was
/// doing silently, and the IR being under-specified about it is a real finding:
/// nothing but a second backend could have noticed, because the first one's
/// language happened to fill the gap.
/// The value an edge supplies to a block parameter.
///
/// Just the name. It used to convert: `verify::compatible` called any scalar
/// compatible with any other, so specialization could send an `i32` along an
/// edge into an `f64` block parameter, and a `phi double` taking an `i32` is
/// not a module. The C backend wrote `v7 = v0;` and let C convert.
///
/// `verify` requires them to agree now and `specialize::reconcile_edges` makes
/// them, in the predecessor, which is where the conversion had to go anyway.
fn edge_value(value: ValueId) -> String {
    name(value)
}

/// Every predecessor's contribution to one block parameter, as a phi's
/// incoming list.
///
/// A block parameter is a phi read from the other side: the parameter says what
/// it holds and each predecessor says what it sends, and this collects the
/// second into the first.
fn incoming_for(func: &Func, target: BlockId, slot: usize, exits: &[String]) -> Vec<String> {
    let mut pairs = Vec::new();
    for (index, block) in func.blocks.iter().enumerate() {
        // `exits[index]`, not `label(from)`: the label the edge actually
        // leaves from, which a guarded cell read moves off the block's own.
        let from = exits
            .get(index)
            .cloned()
            .unwrap_or_else(|| label(BlockId(u32::try_from(index).unwrap_or(0))));
        let mut add = |to: BlockId, args: &[ValueId]| {
            if to == target
                && let Some(value) = args.get(slot)
            {
                pairs.push(format!("[ {}, %{} ]", edge_value(*value), from));
            }
        };
        match &block.terminator {
            Terminator::Jump { target: to, args } => add(*to, args),
            Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                add(*then_target, then_args);
                add(*else_target, else_args);
            }
            _ => {}
        }
    }
    pairs
}

fn terminator(func: &Func, term: &Terminator) -> Result<String, Diagnostic> {
    Ok(match term {
        Terminator::Return(Some(value)) => {
            let ty = ty_of(&func.values[value.0 as usize].ty, func)?;
            format!("ret {ty} {}", name(*value))
        }
        Terminator::Return(None) => "ret void".to_owned(),
        Terminator::Jump { target, .. } => format!("br label %{}", label(*target)),
        Terminator::Branch {
            cond,
            then_target,
            else_target,
            ..
        } => format!(
            "br i1 {}, label %{}, label %{}",
            name(*cond),
            label(*then_target),
            label(*else_target)
        ),
        // A claim the compiler is making, and LLVM has the same word for it.
        Terminator::Unreachable => "unreachable".to_owned(),
        // Not a claim, an absence -- and the C backend's note explains what
        // rendering it as a licence cost once. Refused rather than rendered.
        Terminator::FellThrough => {
            return Err(refuse(
                func,
                "a block that falls out of the end of a function",
            ));
        }
    })
}

/// Where a field sits, and what it holds.
///
/// The offset comes from the layout engine and the *type* from the operation
/// rather than from the layout: a field whose own type has no layout is a
/// pointer here exactly as it is in the C backend, and the operation says so.
fn field_at(
    program: &Program,
    func: &Func,
    object: ValueId,
    field: u32,
    ty: &HirType,
) -> Result<(u32, &'static str), Diagnostic> {
    let HirType::Managed(nts_core::hir::ManagedType::Object(id)) =
        &func.values[object.0 as usize].ty
    else {
        return Err(refuse(func, "a field of something that is not an object"));
    };
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(id))
        .ok_or_else(|| refuse(func, "a field of a type with no layout"))?;
    let placed = nts_core::hir::layout::place(&layout.fields)
        .ok_or_else(|| refuse(func, "an object whose fields cannot be placed"))?;
    let offset = *placed
        .offsets
        .get(field as usize)
        .ok_or_else(|| refuse(func, "a field index outside its layout"))?;
    Ok((offset, ty_of(ty, func)?))
}

fn operation(program: &Program, func: &Func, value: ValueId, platform: Platform) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = name(value);
    Ok(match &op.kind {
        // Already named by the signature.
        OpKind::Param(_) | OpKind::BlockParam(_) => String::new(),
        OpKind::ConstFloat(number) => {
            // LLVM reads a float literal as a C double, and prints one back
            // exactly when it is written in full. A value that is not
            // representable is written as its bits so nothing is lost in the
            // spelling.
            //
            // `x - 0.0` rather than `0.0 + x`, and the difference is one value:
            // `0.0 + -0.0` is `+0.0`, because a sum of opposite signs that is
            // exactly zero is positive under round-to-nearest. Subtraction has
            // no such case -- `-0.0 - 0.0` is `-0.0 + -0.0`, like signs, so the
            // sign survives -- and `x - 0.0` is exact for every other double
            // too. Nothing produces a `-0` literal today, since `-0` lowers as
            // a negation of zero; this is so that a constant-folding pass in
            // the middle end cannot quietly turn `1 / -0` from `-Infinity` into
            // `Infinity` later.
            //
            // An instruction at all is a wart: a constant has no SSA name in
            // LLVM and should be substituted at its uses, which needs `name` to
            // tell a definition from a use and it currently cannot. The
            // optimizer folds this away at -O1, so it costs spelling rather
            // than speed.
            format!("{out} = fsub double {}, 0.0", float_literal(*number))
        }
        // The cached, required lookup a class send makes (`objc::module`).
        OpKind::ObjcClass { name, .. } => format!("{out} = call ptr @{}()", nts_codegen_common::objc::class_symbol(name)),
        // The size is this target's, so it is resolved here and not in HIR,
        // and spelled as the constant it is.
        OpKind::NativeSizeOf(storage) => {
            let shape = nts_core::hir::layout::native_shape(storage, platform.abi)
                .ok_or_else(|| refuse(func, "sizeof needs a complete native layout"))?;
            format!("{out} = fsub double {}, 0.0", float_literal(f64::from(shape.size)))
        }
        OpKind::ConstInt(number) => {
            let ty = ty_of(&op.ty, func)?;
            format!("{out} = add {ty} 0, {number}")
        }
        // The address of the static storage, which is what a string value is.
        OpKind::ConstString(text) => {
            let index = literal_table(program)
                .iter()
                .position(|known| known == text)
                .unwrap_or(0);
            format!("{out} = getelementptr i8, ptr @nts_str_{index}, i64 0")
        }
        OpKind::ConstBool(flag) => {
            format!("{out} = add i1 0, {}", u8::from(*flag))
        }
        OpKind::Erase { .. } | OpKind::Unerase { .. } | OpKind::TagOf { .. } => {
            return tagging(func, value, &out, platform);
        }
        // See `instance_of`, which is where the reasoning is.
        OpKind::InstanceOf {
            value: operand,
            classes,
        } => return Ok(instance_of(program, &out, *operand, classes, platform)),
        // Before the general binary arm, because it *is* a binary and the
        // general one would match it first -- and an `icmp` on a sixteen-byte
        // aggregate is not an instruction.
        // Either side, not just the left one. `3 === x` is the same question as
        // `x === 3` and reaches here written either way round; guarding on the
        // left alone sent the mirrored spelling to `arithmetic`, which compared
        // an aggregate with `fcmp`.
        OpKind::Binary {
            op: BinOp::Eq | BinOp::Ne,
            lhs,
            rhs,
        } if func.values[lhs.0 as usize].ty == HirType::Erased
            || func.values[rhs.0 as usize].ty == HirType::Erased =>
        {
            return tagging(func, value, &out, platform);
        }
        // And before it again, for the same reason one step over: two strings
        // are equal when their *contents* are, and `icmp eq` compares the
        // pointers they arrive in.
        //
        // This was a wrong answer rather than a missing one, and it had been
        // there as long as the backend. `ext.charAt(0) === "."` is `false`
        // however the string reads, because `charAt` allocates and the literal
        // did not -- so every `s[i] === c` and every `s.charAt(i) === c` was
        // false. Nothing caught it because the examples compared literals
        // against literals, where two equal strings genuinely are one pointer
        // and the test accidentally agrees.
        //
        // The C backend has had `nts_string_eq` here since it had strings; this
        // is the second half of that rule, arriving late.
        // Both string rules share one precondition, so they are one arm and
        // one helper: a managed operand, and neither side the absent
        // reference. Splitting them was what pushed `operation` over its line
        // limit, and the guard was written twice to do it.
        OpKind::Binary { op: bin, lhs, rhs } => string_binary(func, &out, *bin, *lhs, *rhs)
            .map_or_else(|| arithmetic(func, &out, *bin, *lhs, *rhs, platform), Ok)?,
        OpKind::Unary { op: un, operand } => unary(func, &out, value, *un, *operand, platform)?,
        // A representation change specialization decided on. The C backend
        // spells it as a cast; LLVM makes the direction explicit, which is the
        // same instruction and a better record of what was meant.
        //
        // Out-of-range float to integer is undefined in C and poison here --
        // the same hazard by the same argument, and specialization only emits
        // one where the interval analysis proved the value fits.
        OpKind::Convert(operand) => {
            let from = &func.values[operand.0 as usize].ty;
            let to = &op.ty;
            let (from_ty, to_ty) = (ty_of(from, func)?, ty_of(to, func)?);
            // `int32_t` to `uint32_t` is a conversion in C and nothing at all
            // in LLVM: same width, same bits, and signedness is a property of
            // the *operation* here rather than of the type. Falling through to
            // the width comparison produced `zext i32 %v to i32`, which is not
            // an instruction -- two benchmarks failed to assemble on it.
            //
            // There is no no-op cast, so this is the same `add x, 0` the
            // backend already uses to give a constant a name.
            if from_ty == to_ty {
                // `add ptr %v, 0` is not an instruction -- `add` wants an
                // integer. A pointer's no-op is a zero-offset `getelementptr`,
                // which is what a `T *` to `void *` conversion is here: the
                // address does not change, and under opaque pointers the type
                // does not either. C spells the same thing `(void *)p`.
                if matches!(to, HirType::NativePointer(_) | HirType::Managed(_)) {
                    format!("{out} = getelementptr i8, {from_ty} {}, i64 0", name(*operand))
                } else {
                    format!("{out} = add {from_ty} {}, 0", name(*operand))
                }
            } else if matches!(to, HirType::Bool) && !matches!(from, HirType::Bool) {
                is_not_zero(&out, from, from_ty, &name(*operand))
            } else {
                let instruction = conversion(from, to, func)?;
                format!(
                    "{out} = {instruction} {from_ty} {} to {to_ty}",
                    name(*operand)
                )
            }
        }
        OpKind::Call { .. } => return call(func, value, &out, platform),
        // A null pointer, which is what an absent reference is: the one spare
        // value a pointer has, and the whole reason `T | null` costs nothing.
        OpKind::ConstNull | OpKind::ConstUndefined if matches!(op.ty, HirType::Managed(_) | HirType::NativePointer(_)) => {
            format!("{out} = inttoptr i64 0 to ptr")
        }
        // Where there are *two* absences the value is erased and each has a tag
        // of its own, which is the whole reason that union is not a pointer.
        // The payload is zero rather than undefined: a program that reads it
        // through a wrong narrowing then gets a zero rather than whatever was
        // in the register, which is the same choice `nts_value_of_undefined`
        // makes.
        OpKind::ConstNull | OpKind::ConstUndefined if op.ty == HirType::Erased => {
            let tag = if matches!(op.kind, OpKind::ConstNull) {
                nts_core::hir::tags::NULL
            } else {
                nts_core::hir::tags::UNDEFINED
            };
            format!(
                "{out}.half = insertvalue {ERASED_TYPE} undef, i32 {tag}, 0\n  \
                 {out} = insertvalue {ERASED_TYPE} {out}.half, i64 0, 1"
            )
        }
        // An absence that reached a *scalar* slot, which happens where the
        // lowering proved the receiver present and left the other arm behind:
        // `o?.level` on a fresh object tests it against null, and the branch
        // that would produce the absence is unreachable.
        //
        // Zero rather than NaN, which is what `undefined` coerces to, because
        // the C backend writes `(TYPE)0` here and a value neither backend can
        // observe is the worst possible place for them to disagree. If the
        // invariant ever breaks, the differential against node is what says so
        // -- and it says it about both backends at once rather than reporting a
        // checksum mismatch between them.
        OpKind::ConstNull | OpKind::ConstUndefined => {
            let ty = ty_of(&op.ty, func)?;
            let zero = if matches!(op.ty, HirType::Float { .. }) {
                "0.0"
            } else {
                "0"
            };
            format!(
                "{out} = {} {ty} {zero}, {zero}",
                if matches!(op.ty, HirType::Float { .. }) {
                    "fadd"
                } else {
                    "add"
                }
            )
        }
        _ => return memory_operation(program, func, value, &out, platform),
    })
}

/// The two operations that make an object.
///
/// Both need a descriptor, which is the piece of the runtime a backend has to
/// *build* rather than call: it is data the collector reads, so it is emitted
/// here and everything in it comes from the middle end.
///
/// On the heap that is the allocator handed the descriptor; in the frame it is
/// an `alloca` and the header written out, which is what the C backend's
/// `v_frame.header.descriptor = ...` compiles to and one of the reasons escape
/// analysis is worth having.
fn allocation(
    program: &Program,
    func: &Func,
    value: ValueId,
    out: &str,
) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        OpKind::ArrayNew { length, zeroed } => {
            let HirType::Managed(nts_core::hir::ManagedType::Array(element)) = &op.ty else {
                return Err(refuse(func, "an array of something with no element type"));
            };
            // Two entry points rather than a flag, so the branch is taken here
            // rather than once per allocation at run time.
            let allocate = if *zeroed {
                "@nts_array_new"
            } else {
                "@nts_array_new_uninitialized"
            };
            let descriptor = if element.is_managed() {
                "@nts_desc_ref".to_owned()
            } else if let Some(counting) = nts_codegen_common::counting::counted_element(element) {
                format!("@{}", nts_codegen_common::counting::array_descriptor_name(&counting))
            } else {
                format!("@nts_desc_arr_{}", element_tag(element))
            };
            let mut before = Vec::new();
            let count = helper_operand(
                func,
                &out,
                allocate.trim_start_matches('@'),
                1,
                *length,
                &mut before,
            )?;
            before.push(format!(
                "{out} = call ptr {allocate}(ptr {descriptor}, {count})"
            ));
            before.join("\n  ")
        }
        // The address of the static instance emitted beside its descriptor.
        // No allocation and no counting: it is immortal and there is nothing
        // in it.
        // A bridge's address is its symbol. `getelementptr i8, ptr @f, i64 0` for
        // the same reason the static closure below uses one: a value needs a
        // name, and there is no no-op cast between two `ptr`s.
        OpKind::NativeBridge { closure, signature, once, .. } => {
            let layout = closure_layout(program, func, *closure)?;
            let target = layout
                .closure_call()
                .ok_or_else(|| refuse(func, "a callback bridge whose closure publishes no function"))?;
            format!(
                "{out} = getelementptr i8, ptr @{}, i64 0",
                nts_codegen_common::symbols::bridge_name(target, signature, *once)
            )
        }
        OpKind::NativeBlock { invoke, context, signature } => objc::block(&out, *invoke, *context, signature),
        OpKind::ClosureStatic => {
            let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = &op.ty else {
                return Err(refuse(func, "a closure value that is not an object"));
            };
            let layout = program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(id))
                .ok_or_else(|| refuse(func, "a closure value whose type has no layout"))?;
            format!(
                "{out} = getelementptr i8, ptr @{}, i64 0",
                static_closure_name(layout)
            )
        }
        OpKind::CellReady { .. } | OpKind::Await { .. } | OpKind::Suspend { .. } => {
            return suspension(program, func, value, &out);
        }
        OpKind::ObjectNew { frame } => {
            let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = &op.ty else {
                return Err(refuse(
                    func,
                    "an allocation of something that is not an object",
                ));
            };
            let layout = program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(id))
                .ok_or_else(|| refuse(func, "an allocation of a type with no layout"))?;
            let placed = nts_core::hir::layout::place(&layout.fields)
                .ok_or_else(|| refuse(func, "an object whose fields cannot be placed"))?;
            // The class being constructed, not the shape it shares.
            let tag = descriptor_for(program, layout, Some(*id));
            if *frame {
                frame_object(func, layout, &placed, &tag, &out)?
            } else {
                format!("{out} = call ptr @nts_object_new(ptr @nts_desc_{tag})")
            }
        }
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which does not allocate"),
            ));
        }
    })
}

/// An object that lives in the frame, made out of storage the entry block owns.
fn frame_object(
    func: &Func,
    layout: &nts_core::hir::Layout,
    placed: &nts_core::hir::layout::Placement,
    tag: &str,
    out: &str,
) -> Result<String, Diagnostic> {
    // The storage is in the entry block -- see `frame_storage` --
    // and this is where it becomes an object: a name for it, the
    // descriptor, `NTS_IMMORTAL` in the count word so the counting
    // pass's release is a no-op on storage that was never
    // allocated, and a zero in every slot that can hold a
    // reference.
    //
    // That last one is not decoration. `nts_object_new` hands back
    // memory that is already zero and the whole compiler is built
    // on it: a store over a zero disconnects nothing, so it needs
    // no release, which is what `own::still_zero` proves and what
    // lets a list be built without counting. An `alloca` is
    // whatever the last frame left there. The first store to a
    // reference field would have released it.
    let mut lines = vec![
        format!("{out} = getelementptr i8, ptr {out}.frame, i64 0"),
        format!("store ptr @nts_desc_{tag}, ptr {out}{}", tbaa("ptr")),
        format!("{out}.rc = getelementptr i8, ptr {out}, i64 8"),
        format!(
            "store i64 {}, ptr {out}.rc{}",
            nts_core::hir::layout::IMMORTAL,
            tbaa("i64")
        ),
        // And the flags word, at 16, for the same reason as the zeroes below:
        // `nts_object_new` `memset`s and an `alloca` is whatever the last frame
        // left there. It held nothing anybody read until optional-property
        // presence put a bit in it, and then `"other" in o` answered **true**
        // for a property never written -- 16 of 29 cases, on this backend only,
        // because the C emitter had been given the same store and this one had
        // not. Two emitters, one invariant, and the one that was not told is the
        // one that was wrong.
        format!("{out}.flags = getelementptr i8, ptr {out}, i64 16"),
        format!("store i32 0, ptr {out}.flags{}", tbaa("i32")),
    ];
    for (at, field) in layout.fields.iter().enumerate() {
        // The same fields the C backend zeroes (`Layout::counted_fields`): a
        // counted handle's null is what its release walk must find.
        if !field.ty.is_counted() {
            continue;
        }
        let Some(offset) = placed.offsets.get(at) else {
            continue;
        };
        let slot = format!("{out}.f{at}");
        let ty = ty_of(&field.ty, func)?;
        // Zero is `undefined`'s tag as well as the null pointer,
        // which is what makes an omitted optional property already
        // correct without anyone storing to it.
        let zero = if ty == "ptr" {
            "null"
        } else {
            "zeroinitializer"
        };
        lines.push(format!(
            "{slot} = getelementptr i8, ptr {out}, i64 {offset}"
        ));
        lines.push(format!("store {ty} {zero}, ptr {slot}{}", tbaa(ty)));
    }
    Ok(lines.join("\n  "))
}

/// Reading and writing an array's elements.
///
/// The block is a separate allocation -- which is what lets an array grow
/// without the object moving -- so this is a load of the block pointer and then
/// an index into it.
fn element_access(func: &Func, value: ValueId, out: &str) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } => {
            // The element type, from the array. Not from the result and not
            // from the value: the descriptor was built from the element type,
            // so it is the only one that describes the memory. `verify`
            // requires the read and the write to agree with it, which is why
            // there is no conversion here any more -- there used to be two, and
            // the one on the write took its type from the *stored value* and
            // put `store i64` into an array of doubles.
            let element = ty_of(array_element(func, *array)?, func)?;
            let mut lines = index_lines(func, &out, *array, *index, *checked, false)?;
            lines.push(format!(
                "{out}.at = getelementptr {element}, ptr {out}.block, i32 {out}.i"
            ));
            lines.push(format!(
                "{out} = load {element}, ptr {out}.at{}",
                tbaa(element)
            ));
            lines.join("\n  ")
        }
        OpKind::ArraySet {
            array,
            index,
            value,
            checked,
        } => {
            let element = ty_of(array_element(func, *array)?, func)?;
            let growing = *checked && nts_core::hir::array_write_may_grow(func, *array);
            let mut lines = index_lines(func, &out, *array, *index, *checked, growing)?;
            lines.push(format!(
                "{out}.at = getelementptr {element}, ptr {out}.block, i32 {out}.i"
            ));
            lines.push(format!(
                "store {element} {}, ptr {out}.at{}",
                name(*value),
                tbaa(element)
            ));
            lines.join("\n  ")
        }
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which is not an element access"),
            ));
        }
    })
}

/// Counting, and module-scope storage.
///
/// The counting pass decides where a retain and a release go and both backends
/// emit one call each; under `NoGC` there are none, because the pass that would
/// have inserted them did not run. A global is `internal` unless the program
/// exports it, for the same reason the C backend makes it `static`.
fn counting_or_global(
    program: &Program,
    func: &Func,
    value: ValueId,
    out: &str,
) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        // Counting, which the memory provider decides and both backends emit
        // the same way: one call each, and nothing under NoGC because the pass
        // that would have inserted them did not run.
        // A tagged value is not a pointer, and which of its sixteen bytes is a
        // reference is a question about its tag -- so the runtime answers it,
        // and the C backend calls the same pair for the same reason. Passing
        // the value straight to `nts_release` produced a module that did not
        // compile, and nothing noticed because no gate step runs the second
        // backend under reference counting.
        OpKind::Retain(object) | OpKind::Release(object)
            if func.values[object.0 as usize].ty == HirType::Erased =>
        {
            let helper = if matches!(op.kind, OpKind::Retain(_)) {
                "nts_value_retain"
            } else {
                "nts_value_release"
            };
            format!(
                "{out}.t = extractvalue {ERASED_TYPE} {0}, 0\n  \
                 {out}.p = extractvalue {ERASED_TYPE} {0}, 1\n  \
                 call void @{helper}(i32 {out}.t, i64 {out}.p)",
                name(*object)
            )
        }
        OpKind::Retain(object) | OpKind::Release(object) => {
            use nts_codegen_common::counting::{Counter, counter};
            let retain = matches!(op.kind, OpKind::Retain(_));
            let operand = name(*object);
            match counter(&func.values[object.0 as usize].ty).map_err(|why| refuse(func, why))? {
                Counter::Foreign(counting) if retain => format!("call ptr @{}(ptr {operand})", counting.called(true)),
                Counter::Foreign(counting) => format!("call void @{}(ptr {operand})", counting.called(false)),
                _ if retain => format!("call void @nts_retain(ptr {operand})"),
                _ => format!("call void @nts_release(ptr {operand})"),
            }
        }
        OpKind::GlobalGet(global) => {
            let ty = ty_of(&op.ty, func)?;
            format!(
                "{out} = load {ty}, ptr {}{}",
                symbol(&global_symbol(program, *global as usize)),
                tbaa(ty)
            )
        }
        OpKind::GlobalSet { global, value } => {
            let ty = ty_of(&func.values[value.0 as usize].ty, func)?;
            format!(
                "store {ty} {}, ptr {}{}",
                name(*value),
                symbol(&global_symbol(program, *global as usize)),
                tbaa(ty)
            )
        }
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which is neither counting nor a global"),
            ));
        }
    })
}

/// Reading a length, and reading a code unit.
///
/// Both are a load through a header, and both differ from an array's rule in
/// the same direction: a string is immutable and cannot grow, so its count is
/// the header's own and an index out of range answers NaN rather than trapping.
fn text_operation(func: &Func, value: ValueId, out: &str) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        // The count is the last four bytes of the header, whatever it belongs
        // to: an array reaches through its header because it can grow, and a
        // string *is* one.
        // A code unit. Checked goes through the runtime, which answers NaN out
        // of range rather than trapping -- a string's rule, and the opposite of
        // an array's.
        OpKind::StringUnitAt {
            string,
            index,
            checked,
        } => {
            // Both the index and the result are whatever specialization
            // decided, not whatever the runtime happens to declare. This used
            // to write `double` for both, so a narrowed index was handed to
            // `nts_unit_fn(ptr, i32)` as a `double` and a narrowed *result* was
            // produced as a `double` that every later reader then disagreed
            // with -- one bad type propagating to every use of it. `Length`
            // next door had it right all along.
            let returns = ty_of(&op.ty, func)?;
            let helper = if *checked {
                // See the C backend: an index that is already an integer is
                // range-tested as one, rather than converted to a double and
                // back once per character.
                if func.value(*index).ty.is_scalar()
                    && !matches!(func.value(*index).ty, HirType::Float { .. })
                {
                    "nts_str_char_code_at_int_fn"
                } else {
                    "nts_str_char_code_at_fn"
                }
            } else {
                "nts_unit_fn"
            };
            // What the helper hands back, from the table rather than from
            // memory: one is a `double` and the other a `uint16_t`, and the
            // second carries `zeroext`.
            let known = signatures::signature(helper)
                .ok_or_else(|| refuse(func, "a string read with no declared helper"))?;
            let produced = known
                .returns
                .split_whitespace()
                .last()
                .unwrap_or(known.returns);
            let mut lines = Vec::new();
            let at = helper_operand(func, &out, helper, 1, *index, &mut lines)?;
            let call = format!(
                "call {} @{helper}(ptr {}, {at})",
                known.returns,
                name(*string)
            );
            if produced == returns {
                lines.push(format!("{out} = {call}"));
            } else {
                let raw = format!("{out}.u");
                lines.push(format!("{raw} = {call}"));
                lines.push(converted(&out, produced, returns, &raw, func)?);
            }
            lines.join("\n  ")
        }
        OpKind::Length(of) => {
            let returns = ty_of(&op.ty, func)?;
            let at = format!("{out}.at");
            let raw = format!("{out}.raw");
            // A view's length is computed rather than stored -- one built
            // without a count follows its buffer through `resize` -- so there
            // is no field at `LENGTH_OFFSET` to load.
            if matches!(
                func.values[of.0 as usize].ty,
                HirType::Managed(nts_core::hir::ManagedType::View(_))
            ) {
                let counted = format!("{out}.n");
                let mut lines = vec![format!(
                    "{counted} = call double @nts_view_length(ptr {})",
                    name(*of)
                )];
                // `converted` refuses a conversion to the type it already
                // has, which is right for it and means the common case here --
                // a length used as a number -- has to be a move.
                lines.push(if returns == "double" {
                    format!("{out} = fadd double {counted}, 0.0")
                } else {
                    converted(&out, "double", returns, &counted, func)?
                });
                return Ok(lines.join("\n  "));
            }
            let offset = nts_core::hir::layout::LENGTH_OFFSET;
            let mut lines = vec![
                format!("{at} = getelementptr i8, ptr {}, i64 {offset}", name(*of)),
                format!("{raw} = load i32, ptr {at}{}", tbaa("i32")),
            ];
            // A length is a `uint32_t`, so widening it is `zext` and turning
            // it into a float is `uitofp` -- and the difference is not
            // cosmetic: `uitofp i32 ... to i64` is not an instruction. This
            // wrote `uitofp` for everything that was not `i32`, which nothing
            // noticed while a length was only ever compared against a double.
            // Specializing it made `i64` reachable and the module stopped
            // verifying.
            lines.push(if returns == "i32" {
                format!("{out} = add i32 {raw}, 0")
            } else {
                converted(&out, "i32", returns, &raw, func)?
            });
            lines.join("\n  ")
        }
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which reads no length"),
            ));
        }
    })
}

/// `x === 3` where `x` is erased and `3` is not: the tag decides, and the
/// runtime has a helper per shape of the other side.
///
/// Equality is symmetric, so `erased` is whichever side carried the tag however
/// it was written. The C backend picks among the same four.
fn mixed_equality(
    func: &Func,
    out: &str,
    same: &str,
    erased: ValueId,
    against: ValueId,
    other: &HirType,
    platform: Platform,
) -> Result<Vec<String>, Diagnostic> {
    let mut lines = Vec::new();
    let receiver = erased_argument(platform, &name(erased), out, 0, &mut lines);
    // An integer is compared as the number it is, which is what the erased side
    // holds: the tag says `number` and the payload is a double whatever width
    // the other side was proved into.
    let (helper, argument) = match other {
        HirType::Float { .. } => ("nts_value_eq_number_fn", format!("double {}", name(against))),
        HirType::Int { .. } => {
            let wide = format!("{out}.n");
            lines.push(format!(
                "{wide} = sitofp {} {} to double",
                ty_of(other, func)?,
                name(against)
            ));
            ("nts_value_eq_number_fn", format!("double {wide}"))
        }
        HirType::Bool => (
            "nts_value_eq_boolean_fn",
            format!("i1 zeroext {}", name(against)),
        ),
        HirType::Managed(nts_core::hir::ManagedType::String) => {
            ("nts_value_eq_string", format!("ptr {}", name(against)))
        }
        HirType::Managed(_) => ("nts_value_eq_reference", format!("ptr {}", name(against))),
        _ => {
            return Err(refuse(
                func,
                "an equality between an erased value and a type with no comparison",
            ));
        }
    };
    lines.push(format!("{same} = call zeroext i1 @{helper}({receiver}, {argument})"));
    Ok(lines)
}

/// Putting a value in a tagged one, taking it back out, and comparing two.
///
/// The whole of what a tag is *for*: `1 == true` and `[1] == 1` are questions
/// only a tag can answer, and the runtime answers them. The payload eightbyte
/// holds the union's first member, the `double`, so an integer is converted
/// before it is stored -- the same conversion `nts_value_of_number(x)` makes.
fn tagging(func: &Func, value: ValueId, out: &str, platform: Platform) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        // Comparing two tagged values, which is the one thing carrying a tag is
        // *for*: `1 == true` and `[1] == 1` are questions only a tag can
        // answer, and the runtime answers them. Four scalars, because each
        // sixteen-byte value is two.
        OpKind::Binary {
            op: bin @ (BinOp::Eq | BinOp::Ne),
            lhs,
            rhs,
        } => {
            let left = &func.values[lhs.0 as usize].ty;
            let right = &func.values[rhs.0 as usize].ty;
            // One of each, in either order: equality is symmetric, so the
            // erased side becomes the receiver whichever side it was written
            // on. The C backend picks among the same four helpers.
            let mixed = match (left, right) {
                (HirType::Erased, HirType::Erased) => None,
                (HirType::Erased, other) => Some((*lhs, *rhs, other)),
                (other, HirType::Erased) => Some((*rhs, *lhs, other)),
                _ => None,
            };
            let same = format!("{out}.eq");
            let mut lines = Vec::new();
            if let Some((erased, against, other)) = mixed {
                lines.extend(mixed_equality(func, &out, &same, erased, against, other, platform)?);
            } else {
                let left = erased_argument(platform, &name(*lhs), &out, 0, &mut lines);
                let right = erased_argument(platform, &name(*rhs), &out, 1, &mut lines);
                lines.push(format!("{same} = call zeroext i1 @nts_value_strict_eq({left}, {right})"));
            }
            lines.push(if matches!(bin, BinOp::Ne) {
                format!("{out} = xor i1 {same}, true")
            } else {
                format!("{out} = add i1 {same}, 0")
            });
            lines.join("\n  ")
        }
        // Putting a value in a tagged one. The payload eightbyte holds the
        // union's first member, which is the `double` -- so an *integer* is
        // converted before it is stored, exactly as the C backend's
        // `nts_value_of_number(x)` converts it, and a bool and a pointer are
        // widened to the same eightbyte.
        OpKind::Erase { value, absent } => {
            use nts_core::hir::{tags, Absent};
            let from = &func.values[value.0 as usize].ty;
            let tag = tag_of(from)
                .ok_or_else(|| refuse(func, &format!("erasing a value of type {from:?}")))?;
            let bits = format!("{out}.bits");
            let widen = payload_from(func, &out, &bits, from, *value)?;
            // **A null reference is not an object**, and which absence it is
            // cannot be read off the operand's type: `ptr` is `T`, `T | null`
            // and `T | undefined` alike. The op carries that one fact; without
            // it `t?.mid?.leaf === null` answered `false` where node answers
            // `true`.
            //
            // A `select` and not a branch, because a branch here would put two
            // basic blocks in the middle of a HIR block and leave control
            // arriving at a label no successor's `phi` names -- the hazard
            // `open_chains` is written out for. `Absent::Impossible` emits
            // neither, which is every erase of a reference the program can show
            // is there.
            let (test, chosen) = match absent {
                Absent::Impossible => (String::new(), tag.to_string()),
                Absent::Null | Absent::Undefined => {
                    let empty = if *absent == Absent::Null { tags::NULL } else { tags::UNDEFINED };
                    (
                        format!(
                            "{out}.gone = icmp eq i64 {bits}, 0\n  \
                             {out}.tag = select i1 {out}.gone, i32 {empty}, i32 {tag}\n  "
                        ),
                        format!("{out}.tag"),
                    )
                },
            };
            format!(
                "{widen}\n  {test}{out}.half = insertvalue {ERASED_TYPE} undef, i32 {chosen}, 0\n  \
                 {out} = insertvalue {ERASED_TYPE} {out}.half, i64 {bits}, 1"
            )
        }
        // Reading the payload back, at the type the checker narrowed to.
        // Unchecked by construction, exactly as the C backend's union read is:
        // the licence comes from the narrowing and from nothing else.
        OpKind::Unerase { value } => {
            let bits = format!("{out}.bits");
            let read = format!("{bits} = extractvalue {ERASED_TYPE} {}, 1", name(*value));
            let narrow = payload_into(func, &out, &bits, &op.ty)?;
            format!("{read}\n  {narrow}")
        }
        OpKind::TagOf { value } => {
            format!("{out} = extractvalue {ERASED_TYPE} {}, 0", name(*value))
        }
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which reads no tag"),
            ));
        }
    })
}

/// The implementation to call, three loads down from the receiver.
///
/// `args[0]` is the receiver and its descriptor is where the table lives, so
/// this is the descriptor, then the table, then the slot. The table stores
/// untyped pointers, which is why the call spells its own signature.
fn method_pointer(out: &str, args: &[ValueId], slot: u32, before: &mut Vec<String>) -> String {
    let receiver = args
        .first()
        .map_or_else(|| "null".to_owned(), |value| name(*value));
    before.push(format!(
        "{out}.desc = load ptr, ptr {receiver}{}",
        tbaa("ptr")
    ));
    before.push(format!(
        "{out}.tab.at = getelementptr %NtsDescriptor, ptr {out}.desc, i32 0, i32 5"
    ));
    before.push(format!(
        "{out}.tab = load ptr, ptr {out}.tab.at{}",
        tbaa("ptr")
    ));
    before.push(format!(
        "{out}.fn.at = getelementptr ptr, ptr {out}.tab, i32 {slot}"
    ));
    before.push(format!(
        "{out}.fn = load ptr, ptr {out}.fn.at{}",
        tbaa("ptr")
    ));
    format!("{out}.fn")
}

/// Every argument to a call, at the type the callee declares.
///
/// Two things happen here that C does silently. An erased argument becomes
/// *two* scalars, because that is how the platform passes a sixteen-byte
/// struct. And an argument whose type is not the one the *runtime* declares is
/// converted -- C does that at the call and says nothing, which is how
/// `nts_tag_name(uint32_t)` came to be handed a double.
///
/// Only the runtime needs the second. A call inside this program is checked by
/// `verify` to match the parameter it fills, so there is nothing left to
/// decide; the runtime's signatures are C's and fixed, and adapting to them is
/// not a decision either backend gets to make differently.
fn arguments(
    func: &Func,
    out: &str,
    args: &[ValueId],
    before: &mut Vec<String>,
) -> Result<Vec<String>, Diagnostic> {
    let mut rendered: Vec<String> = Vec::new();
    for (at, arg) in args.iter().enumerate() {
        let arg_ty = &func.values[arg.0 as usize].ty;
        // Two scalars, because that is how the platform passes a
        // sixteen-byte struct and how clang emits the same call.
        if *arg_ty == HirType::Erased {
            let tag = format!("{}.a{}", out, arg.0);
            let bits = format!("{}.b{}", out, arg.0);
            // The same value twice in one call -- `map.set(v, v)` -- is
            // extracted once: the names are the value's, and a second
            // extraction defined them again, which LLVM rejects.
            if args[..at].contains(arg) {
                rendered.push(format!("i32 {tag}"));
                rendered.push(format!("i64 {bits}"));
                continue;
            }
            before.push(format!(
                "{tag} = extractvalue {ERASED_TYPE} {}, 0",
                name(*arg)
            ));
            before.push(format!(
                "{bits} = extractvalue {ERASED_TYPE} {}, 1",
                name(*arg)
            ));
            rendered.push(format!("i32 {tag}"));
            rendered.push(format!("i64 {bits}"));
            continue;
        }
        let ty = ty_of(arg_ty, func)?;
        // What the callee actually declares. C converts at the call and
        // says nothing; here the conversion has to be written down,
        // which is the better of the two.
        //
        // The runtime's index is into `rendered` because an erased
        // parameter is two entries there and one here; our own
        // functions carry one parameter per argument.
        // No conversion. `hir::runtime` gives the middle end the C runtime's
        // declared types -- with the signedness the LLVM table cannot carry,
        // because `i32` is both `int32_t` and `uint32_t` and the difference is
        // `fptosi` against `fptoui` -- so an argument arrives already at the
        // type the callee declares, for both backends, from one place.
        rendered.push(format!("{ty} {}{}", extension(arg_ty), name(*arg)));
    }
    Ok(rendered)
}

/// The arguments of a call into the C runtime: [`arguments`]' spelling,
/// except that under Win64 an erased value or an `i128` is a pointer to its
/// copy (`indirect`), which is how that platform's C takes sixteen bytes.
fn runtime_arguments(
    func: &Func,
    out: &str,
    args: &[ValueId],
    before: &mut Vec<String>,
    platform: Platform,
) -> Result<Vec<String>, Diagnostic> {
    if !indirect::applies(platform) {
        return arguments(func, out, args, before);
    }
    let mut rendered = Vec::new();
    let mut slot = 0;
    for arg in args {
        let ty = &func.values[arg.0 as usize].ty;
        if indirect::is_indirect(ty) {
            if slot == indirect::SLOTS {
                return Err(refuse(func, "a runtime call passing more sixteen-byte values than Win64's scratch slots hold"));
            }
            rendered.push(indirect::argument(ty_of(ty, func)?, &name(*arg), slot, before));
            slot += 1;
        } else {
            rendered.extend(arguments(func, out, &[*arg], before)?);
        }
    }
    Ok(rendered)
}

/// A declared result split into the extension a call site repeats and the
/// type: `zeroext i1` is `("zeroext ", "i1")`, `{ i32, i64 }` is all type.
/// `noalias` and `nonnull` stay on the declaration, where they already say
/// what they say.
///
/// A runtime helper is called at the result its declaration says, with the
/// extension its platform's C promises: Win64 widens no narrow result for its
/// caller, so an `i8` there carries no `signext`. A result the program does not
/// use is still called for at its type and dropped -- a `void` call to a
/// function returning `ptr` is undefined, which `opt -passes=lint` reports.
fn declared_result(returns: &str) -> (String, &str) {
    let mut attribute = String::new();
    let mut rest = returns;
    while let Some((word, after)) = rest.split_once(' ') {
        match word {
            "zeroext" | "signext" => {
                attribute.push_str(word);
                attribute.push(' ');
            }
            "noalias" | "nonnull" => {}
            _ => break,
        }
        rest = after;
    }
    (attribute, rest)
}

/// A call, direct or into the runtime.
///
/// Two things happen here that C does silently. An erased argument becomes
/// *two* scalars, because that is how the platform passes a sixteen-byte
/// struct. And an argument whose type is not the one the runtime declares is
/// converted -- C does that at the call and says nothing, which is how
/// `nts_tag_name(uint32_t)` came to be handed a double.
fn call(func: &Func, value: ValueId, out: &str, platform: Platform) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    if let OpKind::Call {
        callee: Callee::Native(target),
        args,
        frame,
    } = &op.kind
    {
        if frame.is_some() {
            return Err(refuse(func, "a frame-placed native call"));
        }
        if let Some(send) = &target.send {
            return objc::send(func, target, send, args, &op.ty, out, platform);
        }
        return native::call(func, target, args, &op.ty, out, platform);
    }
    let out = out.to_owned();
    Ok(match &op.kind {
        OpKind::Call { callee, args, .. } => {
            let returns = ty_of(&op.ty, func)?;
            // A dispatch through the receiver's method table: one load for the
            // descriptor, one for the table, one for the slot, and an indirect
            // call. That is what dispatch costs when the compiler knows the
            // whole hierarchy -- and the table stores untyped pointers, so the
            // call spells the signature it is making.
            let dispatched = match callee {
                Callee::Virtual { slot, .. } | Callee::Closure { slot } => Some(*slot),
                _ => None,
            };
            let empty = String::new();
            let target = match callee {
                Callee::Direct(target) | Callee::External(target) => target,
                Callee::Native(_) => unreachable!("native calls are emitted above"),
                Callee::Virtual { .. } | Callee::Closure { .. } => &empty,
            };
            let framed = frame_units(func, value);
            // The `_into` form of the same helper, handed the storage above.
            // `nts_str_substring_into` is `static inline`, so what this calls
            // is the linkable companion beside it -- the same distinction
            // `nts_to_int32_fn` exists for.
            let called = if framed.is_some() {
                into_form(target)
            } else {
                linkable(target)
            };
            if framed.is_some() && signatures::signature(&called).is_none() {
                return Err(refuse(
                    func,
                    &format!("a frame-placed {target}, which has no linkable `_into` form"),
                ));
            }
            let mut rendered = Vec::new();
            let mut before: Vec<String> = Vec::new();
            if framed.is_some() {
                // The storage itself is declared in the entry block, not here.
                // See `frame_storage`.
                rendered.push(format!("ptr {out}.frame"));
            }
            // Into C for a runtime helper, which follows the platform's
            // convention; between two of this program's functions, which
            // follow this backend's.
            let into_c = matches!(callee, Callee::External(_));
            rendered.extend(if into_c { runtime_arguments(func, &out, args, &mut before, platform)? } else { arguments(func, &out, args, &mut before)? });
            // A helper the table does not carry is one this backend cannot
            // call. `nts_to_uint8` is `static inline` in the header, so there
            // is no symbol to link against and no signature to read -- and
            // emitting the call anyway produced a module that referenced a name
            // nothing defined. That is not a refusal, it is a broken build.
            //
            // The same distinction the `_fn` companions exist for: a `static
            // inline` is not a contract another code generator can read.
            match callee {
                Callee::External(_) if signatures::signature(&called).is_none() => {
                    let target = &called;
                    return Err(refuse(
                        func,
                        &format!(
                            "a call to {target}, which the runtime declares only as a \
                             `static inline` and so exposes no symbol for"
                        ),
                    ));
                }
                _ => {}
            }
            // The type the *callee* returns, which is not always the type the
            // rest of the function wants: C converts a `double` result into an
            // `int64_t` slot without a word, and the op carries the slot's type.
            // The type the call is *written* at is the type the operation
            // carries: `hir::runtime` reconciled it with what the runtime
            // declares, the same way it did the arguments.
            let call_returns = returns;
            // The function to call: a name, or three loads down from the
            // receiver. `args[0]` is the receiver, and its descriptor is where
            // the table lives.
            let callable = match dispatched {
                None => symbol(&called),
                Some(slot) => method_pointer(&out, args, slot, &mut before),
            };
            // A runtime helper is called at its declared result (`declared_result`).
            let declared = if into_c { signatures::signature_on(&called, platform) } else { None };
            if declared.is_some() && indirect::applies(platform) && indirect::is_indirect(&op.ty) {
                before.push(indirect::call_returning(&out, &callable, rendered, &op.ty));
                return Ok(before.join("\n  "));
            }
            let (attribute, call_returns) =
                declared.map_or_else(|| (extension(&op.ty).to_owned(), call_returns), |known| declared_result(known.returns));
            let call = format!("call {attribute}{call_returns} {callable}({})", rendered.join(", "));
            let call = if returns == "void" && call_returns != "void" {
                format!("{out}.unused = {call}")
            } else if returns == "void" {
                call
            } else if call_returns == returns {
                format!("{out} = {call}")
            } else {
                let raw = format!("{out}.r");
                let fix = converted(&out, call_returns, returns, &raw, func)?;
                format!("{raw} = {call}\n  {fix}")
            };
            if before.is_empty() {
                call
            } else {
                before.push(call);
                before.join("\n  ")
            }
        }
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which is not a call"),
            ));
        }
    })
}

/// A concrete value, widened into the payload eightbyte.
///
/// The union's first member is the `double`, so an integer is converted to one
/// before its bits are stored -- the same conversion `nts_value_of_number(x)`
/// performs when C passes it an `int`. A bool and a pointer widen directly.
fn payload_from(
    func: &Func,
    out: &str,
    bits: &str,
    from: &HirType,
    value: ValueId,
) -> Result<String, Diagnostic> {
    Ok(match from {
        HirType::Float { .. } => format!("{bits} = bitcast double {} to i64", name(value)),
        HirType::Int { signed, .. } => {
            let wide = format!("{out}.d");
            let widen = if *signed { "sitofp" } else { "uitofp" };
            format!(
                "{wide} = {widen} {} {} to double\n  {bits} = bitcast double {wide} to i64",
                ty_of(from, func)?,
                name(value)
            )
        }
        HirType::Bool => format!("{bits} = zext i1 {} to i64", name(value)),
        HirType::Managed(_) => format!("{bits} = ptrtoint ptr {} to i64", name(value)),
        other => return Err(refuse(func, &format!("erasing a value of type {other:?}"))),
    })
}

/// The payload eightbyte, read back at the type the checker narrowed to.
///
/// Unchecked by construction, exactly as the C backend's union read is: the
/// licence comes from the narrowing and from nothing else.
fn payload_into(func: &Func, out: &str, bits: &str, want: &HirType) -> Result<String, Diagnostic> {
    Ok(match want {
        HirType::Float { .. } => format!("{out} = bitcast i64 {bits} to double"),
        HirType::Int { signed, .. } => {
            let wide = format!("{out}.d");
            let narrow = if *signed { "fptosi" } else { "fptoui" };
            format!(
                "{wide} = bitcast i64 {bits} to double\n  \
                 {out} = {narrow} double {wide} to {}",
                ty_of(want, func)?
            )
        }
        HirType::Bool => format!("{out} = trunc i64 {bits} to i1"),
        HirType::Managed(_) => format!("{out} = inttoptr i64 {bits} to ptr"),
        other => return Err(refuse(func, &format!("reading back a {other:?}"))),
    })
}

/// The operations that read or write memory.
///
/// Split from the rest because this is the half of the backend that depends on
/// `nts_core::hir::layout` -- every one of these needs to know where
/// something sits, and none of the arithmetic does.
fn memory_operation(
    program: &Program,
    func: &Func,
    value: ValueId,
    out: &str,
    platform: Platform,
) -> Result<String, Diagnostic> {
    let op = &func.values[value.0 as usize];
    let out = out.to_owned();
    Ok(match &op.kind {
        // Making one is next door: an allocation needs a descriptor, which is
        // data rather than code and the one piece of the runtime a backend has
        // to build.
        OpKind::ObjectNew { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::ClosureStatic
        // A bridge's address is a symbol rather than an allocation, but it is
        // rendered beside the static closure it is derived from, which is where
        // the layout lookup already lives.
        | OpKind::NativeBridge { .. }
        | OpKind::NativeBlock { .. }
        | OpKind::Await { .. }
        // `CellReady` belongs with the other two halves of the suspension
        // machine, and was the one kind missing from this list -- so it fell
        // through to "does not render yet" while `suspension` implemented it
        // in full, four functions of `examples/captured-by-reference` away.
        // An implementation nothing routes to reads exactly like one that was
        // never written.
        | OpKind::CellReady { .. }
        | OpKind::Suspend { .. } => {
            return allocation(program, func, value, &out);
        }
        OpKind::ArrayGet { .. } | OpKind::ArraySet { .. } => {
            return element_access(func, value, &out);
        }
        OpKind::NativeLocal { .. } | OpKind::NativeMalloc { .. } | OpKind::NativeFree { .. }
        | OpKind::NativeLoad { .. } | OpKind::NativeStore { .. }
        | OpKind::NativeIndexAddress { .. } | OpKind::NativeFieldAddress { .. }
        | OpKind::NativeBitLoad { .. } | OpKind::NativeBitStore { .. }
        | OpKind::NativeCopy { .. } => {
            return native_memory::operation(func, &op.kind, &op.ty, &out, platform);
        }
        OpKind::Length(_) | OpKind::StringUnitAt { .. } => {
            return text_operation(func, value, &out);
        }
        OpKind::Retain(_)
        | OpKind::Release(_)
        | OpKind::GlobalGet(_)
        | OpKind::GlobalSet { .. } => {
            return counting_or_global(program, func, value, &out);
        }
        // A field, at the offset this compiler computed.
        //
        // The C backend writes `p->x` and lets clang place it; there is no
        // `p->x` here, so `nts_core::hir::layout` is not merely checked by
        // the `_Static_assert`s it emits -- it is the only thing that knows
        // where the field is. That is the whole reason the placement moved out
        // of the backend.
        //
        // `getelementptr i8` and a byte offset rather than an indexed GEP into
        // a named struct: opaque pointers mean the type is not carried by the
        // value, and a byte offset is exactly what the descriptor's reference
        // map already holds.
        //
        // Two instructions rather than one, because a *constant*
        // `getelementptr` may not name a function-local value and the object
        // always is one. The address gets a name of its own, derived from the
        // value it serves so nothing has to be counted.
        OpKind::FieldGet { object, field } => {
            let (offset, ty) = field_at(program, func, *object, *field, &op.ty)?;
            let at = format!("{out}.at");
            format!(
                "{at} = getelementptr i8, ptr {}, i64 {offset}\n  {out} = load {ty}, ptr {at}{}",
                name(*object),
                tbaa(ty)
            )
        }
        // A field every arm of an erased union puts in the same place.
        //
        // **The same load `FieldGet` emits**, with two instructions in front of
        // it to get the pointer out of the erased pair. No arm is tested: the
        // op's precondition is that the arms agree about this field's name,
        // index and representation, so the offset is the same through any of
        // them and the first is as good as the rest. A backend that cannot
        // reinterpret a pointer reads `arms` and emits a test chain instead;
        // see `hir::OpKind::SharedFieldGet`.
        OpKind::SharedFieldGet { value, arms, field } => {
            let first = arms
                .first()
                .ok_or_else(|| refuse(func, "a shared field read over no arms"))?;
            let layout = program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(first))
                .ok_or_else(|| refuse(func, "a shared field read over a type with no layout"))?;
            let placed = nts_core::hir::layout::place(&layout.fields)
                .ok_or_else(|| refuse(func, "an object whose fields cannot be placed"))?;
            let offset = *placed
                .offsets
                .get(*field as usize)
                .ok_or_else(|| refuse(func, "a shared field index outside its layout"))?;
            let ty = ty_of(&op.ty, func)?;
            format!(
                "{out}.p = extractvalue {ERASED_TYPE} {0}, 1\n  \
                 {out}.ref = inttoptr i64 {out}.p to ptr\n  \
                 {out}.at = getelementptr i8, ptr {out}.ref, i64 {offset}\n  \
                 {out} = load {ty}, ptr {out}.at{1}",
                name(*value),
                tbaa(ty)
            )
        }
        // A field whose index depends on which layout arrived: the chain, called
        // rather than written here. `open_chains` says why it is a call.
        OpKind::OpenFieldGet { .. } | OpKind::OpenFieldSet { .. } => {
            open_chain_op(program, func, op, &out)?
        }
        OpKind::FieldSet {
            object,
            field,
            value,
        } => {
            let stored = func.values[value.0 as usize].ty.clone();
            let (offset, ty) = field_at(program, func, *object, *field, &stored)?;
            let at = format!("{out}.at");
            format!(
                "{at} = getelementptr i8, ptr {}, i64 {offset}\n  store {ty} {}, ptr {at}{}",
                name(*object),
                name(*value),
                tbaa(ty)
            )
        }
        // Everything that touches memory is next door: it is the half of this
        // backend that depends on the layout engine, and keeping it together
        // is what makes that dependency visible.
        other => {
            return Err(refuse(
                func,
                &format!("the operation {other:?}, which this backend does not render yet"),
            ));
        }
    })
}

/// A double, written so that reading it back gives the same value.
///
/// LLVM accepts a decimal literal only when it is exactly representable, and
/// hexadecimal bits otherwise. Writing the bits always would be correct and
/// unreadable; writing decimal always would be wrong. So: decimal for the
/// whole numbers a program is mostly made of, bits for the rest.
fn float_literal(number: f64) -> String {
    if number.is_finite() && number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{number:.1}")
    } else {
        format!("0x{:016X}", number.to_bits())
    }
}

/// Whether overflow of this type wraps rather than being undefined.
///
/// The distinction is C's, and this backend inherits it rather than inventing
/// it: `int32_t` overflow is undefined and `uint32_t` overflow wraps, so the C
/// backend has *always* been compiled under the stronger assumption. Saying so
/// here is what makes the two backends agree; staying silent made this one
/// strictly more conservative than its own oracle, which is a divergence in the
/// direction nobody wants -- the primary backend giving up an optimization the
/// reference implementation already takes.
///
/// `bigint` is `__int128`, which is signed, and clang emits `add nsw i128` for
/// it. Whether *that* is the semantics `bigint` should have is a question for
/// the middle end, where it would change both backends at once. It is not a
/// question this file gets to answer on its own.
fn wraps(ty: &HirType) -> bool {
    !matches!(ty, HirType::Int { signed: true, .. } | HirType::BigInt)
}

/// The instruction, and the overflow flag where the type licenses one.
///
/// Which operations carry `nsw` is taken from clang rather than from the
/// standard: `+`, `-`, `*` and unary `-` on a signed type, and nothing else. In
/// particular `<<` does not, even on a signed operand, and `/` and `>>` do not.
/// Reading it off a compiler beats reading it off C11 6.5 and getting one case
/// subtly wrong, for the same reason the signature table is generated.
///
/// There is no `nuw` anywhere, and its absence is the point: unsigned overflow
/// in C is *defined* to wrap, so claiming otherwise would be the one place this
/// backend promised more than the oracle does.
/// A binary operator, and the three that are not one instruction.
///
/// Concatenation and the two extrema are calls; a `bigint` shift is a call
/// because JavaScript's rule is not the machine's. Everything else takes its
/// type from an operand and is trusted: `verify` requires both operands and the
/// result to agree, so there is nothing here to decide -- which is the point.
/// This used to carry C's usual arithmetic conversions, because the IR allowed
/// a `double` and an `i64` to reach one `+` and somebody had to pick. That
/// somebody is the middle end now.
fn arithmetic(
    func: &Func,
    out: &str,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
    platform: Platform,
) -> Result<String, Diagnostic> {
    // Two operators wear the `+` token and this is the other one. The lowering
    // already decided which, from the result type.
    if matches!(op, BinOp::Concat) {
        return Ok(format!(
            "{out} = call ptr @nts_concat(ptr {}, ptr {})",
            name(lhs),
            name(rhs)
        ));
    }
    if matches!(op, BinOp::Shl | BinOp::Shr) && func.values[lhs.0 as usize].ty == HirType::BigInt {
        return Ok(wide_shift(out, op, lhs, rhs, platform));
    }
    if matches!(op, BinOp::Min | BinOp::Max) {
        return extremum(func, out, op, lhs, rhs);
    }
    let float = matches!(func.values[lhs.0 as usize].ty, HirType::Float { .. });
    if float
        && matches!(
            op,
            BinOp::BitAnd
                | BinOp::BitOr
                | BinOp::BitXor
                | BinOp::Shl
                | BinOp::Shr
                | BinOp::UShr
        )
    {
        return Ok(float_bitwise(out, op, lhs, rhs));
    }
    let ty = ty_of(&func.values[lhs.0 as usize].ty, func)?;
    let instruction = binary(op, float, wraps(&func.values[lhs.0 as usize].ty), func)?;
    Ok(format!(
        "{out} = {instruction} {ty} {}, {}",
        name(lhs),
        name(rhs)
    ))
}

/// A bitwise operator whose operands are held as doubles.
///
/// `x | 0` is an integer operation on a value the *representation* left in a
/// double, which happens whenever the surrounding expression stayed floating
/// point -- `n === 0 ? 0 / 0 : n | 0` is the shape, because the other arm can be
/// NaN so the join is a double.
///
/// The C backend has spelled this since it was written: `(double)((int32_t)a |
/// (int32_t)b)`. This one refused it, so a program the C lane compiled was
/// declined here with "the operator `BitOr` on this representation" -- found by
/// `examples/module-numbers`, which is the first example to put a `| 0` in a
/// branch beside a NaN.
///
/// **Not `fptosi`.** This used to say "`fptosi` is exact here for the same
/// reason C's cast is: JavaScript's `|` applies `ToInt32` to both operands
/// first, so what reaches this is an integral value widened to a double".
/// Integral it is; in range it is not. `4294967295.0` reaches here from
/// `ToUint32`, and `fptosi` of a value outside `i32` is **poison** in LLVM,
/// exactly as C's cast is undefined and the JVM's `d2i` saturates. All three
/// backends carried the same argument, each citing another, and C and the JVM
/// answered `0` and `134217727` where node says `268435455`.
///
/// `nts_to_int32_fn` is ECMAScript's conversion --- wrap modulo 2^32 --- and it
/// is a real call rather than an instruction precisely because no target has
/// this as one.
///
/// **Shifts arrive too, and used to be declined.** `NTS3001 the operator UShr
/// on this representation` was honest and meant a program the other two lanes
/// compiled did not render here. They are spelled inline rather than through a
/// helper: JavaScript masks the count to five bits, which is an `and i32 …, 31`
/// and removes the poison LLVM's `shl` has past the width. `>>>` answers a
/// `uint32`, so it widens with `uitofp` where the others use `sitofp`.
fn float_bitwise(out: &str, op: BinOp, lhs: ValueId, rhs: ValueId) -> String {
    let instruction = match op {
        BinOp::BitAnd => "and",
        BinOp::BitOr => "or",
        BinOp::BitXor => "xor",
        BinOp::Shl => "shl",
        BinOp::Shr => "ashr",
        _ => "lshr",
    };
    let shift = matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr);
    let count = if shift {
        format!("{out}.c = and i32 {out}.r, 31\n  ")
    } else {
        String::new()
    };
    let right = if shift { format!("{out}.c") } else { format!("{out}.r") };
    // `>>>` is the one bitwise result that is a `uint32` rather than an `int32`.
    let widen = if matches!(op, BinOp::UShr) { "uitofp" } else { "sitofp" };
    format!(
        "{out}.l = call i32 @nts_to_int32_fn(double {0})\n  \
         {out}.r = call i32 @nts_to_int32_fn(double {1})\n  \
         {count}{out}.v = {instruction} i32 {out}.l, {right}\n  \
         {out} = {widen} i32 {out}.v to double",
        name(lhs),
        name(rhs)
    )
}

/// A `bigint` shift, which is not a machine shift.
///
/// JavaScript reverses the direction for a negative count and saturates for one
/// at or past the width, where LLVM's `shl` and `ashr` are *poison*. So the
/// runtime spells the rule and both backends call it -- emitting the
/// instruction rendered a module that compiled and then disagreed with node on
/// 28 cases of `examples/bigint`.
///
/// `>>>` has no `bigint` form: JavaScript throws for it, so there is nothing
/// here to route.
fn wide_shift(out: &str, op: BinOp, lhs: ValueId, rhs: ValueId, platform: Platform) -> String {
    let helper = if matches!(op, BinOp::Shl) {
        "nts_bigint_shl"
    } else {
        "nts_bigint_shr"
    };
    if indirect::applies(platform) {
        // Win64's C takes each `__int128` as a pointer to a copy and hands one
        // back in XMM0.
        let mut lines = Vec::new();
        let left = indirect::argument("i128", &name(lhs), 0, &mut lines);
        let right = indirect::argument("i128", &name(rhs), 1, &mut lines);
        lines.push(format!("{out}.v = call <2 x i64> @{helper}({left}, {right})"));
        lines.push(format!("{out} = bitcast <2 x i64> {out}.v to i128"));
        return lines.join("\n  ");
    }
    format!(
        "{out} = call i128 @{helper}(i128 {}, i128 {})",
        name(lhs),
        name(rhs)
    )
}

/// `Math.min` and `Math.max`, which are not one instruction in either backend.
///
/// Two integers cannot be NaN and have no second zero, so the whole reason the
/// helper exists is absent and a comparison will do -- the same split the C
/// backend makes, and the same reason it makes it. Anything else is a call,
/// because `llvm.minnum` returns the operand that is *not* NaN where JavaScript
/// propagates it, and is free to ignore the sign of a zero where `1 / -0` is
/// still not `1 / 0`.
fn extremum(
    func: &Func,
    out: &str,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<String, Diagnostic> {
    let ty = ty_of(&func.values[lhs.0 as usize].ty, func)?;
    let smallest = matches!(op, BinOp::Min);
    let integers = matches!(func.values[lhs.0 as usize].ty, HirType::Int { .. })
        && matches!(func.values[rhs.0 as usize].ty, HirType::Int { .. });
    if !integers {
        let helper = if smallest { "nts_min_fn" } else { "nts_max_fn" };
        return Ok(format!(
            "{out} = call double @{helper}(double {}, double {})",
            name(lhs),
            name(rhs)
        ));
    }
    let signed = matches!(
        func.values[lhs.0 as usize].ty,
        HirType::Int { signed: true, .. }
    );
    let test = match (smallest, signed) {
        (true, true) => "slt",
        (true, false) => "ult",
        (false, true) => "sgt",
        (false, false) => "ugt",
    };
    Ok(format!(
        "{out}.c = icmp {test} {ty} {0}, {1}\n  {out} = select i1 {out}.c, {ty} {0}, {ty} {1}",
        name(lhs),
        name(rhs)
    ))
}

fn binary(op: BinOp, float: bool, wraps: bool, func: &Func) -> Result<&'static str, Diagnostic> {
    Ok(match (op, float) {
        (BinOp::Add, true) => "fadd",
        (BinOp::Add, false) if wraps => "add",
        (BinOp::Add, false) => "add nsw",
        (BinOp::Sub, true) => "fsub",
        (BinOp::Sub, false) if wraps => "sub",
        (BinOp::Sub, false) => "sub nsw",
        (BinOp::Mul, true) => "fmul",
        (BinOp::Mul, false) if wraps => "mul",
        (BinOp::Mul, false) => "mul nsw",
        (BinOp::Div, true) => "fdiv",
        // LLVM's integer types carry no sign, so the *instruction* is where the
        // signedness has to be said -- and these six said "signed" whatever the
        // IR held. `bytes` computes `(a + data[i]) % 65521` on a `u32` and got
        // `srem`, which clang cannot turn into the multiply-and-shift an
        // unsigned remainder by a constant becomes: 686us against the C
        // backend's 423us on the same HIR.
        //
        // The slowness is the cheap half. `srem` and `urem` *disagree* above
        // 2^31, as do `slt` and `ult`, so this was a wrong answer waiting for a
        // program that reached one. Nothing in the corpus does, which is why
        // nothing caught it.
        (BinOp::Div, false) if wraps => "udiv",
        (BinOp::Div, false) => "sdiv",
        (BinOp::Rem, true) => "frem",
        (BinOp::Rem, false) if wraps => "urem",
        (BinOp::Rem, false) => "srem",
        // `ordered` comparisons, which answer false when either side is NaN --
        // which is what JavaScript's relational operators do.
        (BinOp::Lt, true) => "fcmp olt",
        (BinOp::Le, true) => "fcmp ole",
        (BinOp::Gt, true) => "fcmp ogt",
        (BinOp::Ge, true) => "fcmp oge",
        (BinOp::Eq, true) => "fcmp oeq",
        (BinOp::Ne, true) => "fcmp une",
        // And the same for the relations. `i1` makes it plainest: `slt` reads a
        // `true` as -1, so an unsigned comparison is not an optimization here
        // but the only correct spelling.
        (BinOp::Lt, false) if wraps => "icmp ult",
        (BinOp::Lt, false) => "icmp slt",
        (BinOp::Le, false) if wraps => "icmp ule",
        (BinOp::Le, false) => "icmp sle",
        (BinOp::Gt, false) if wraps => "icmp ugt",
        (BinOp::Gt, false) => "icmp sgt",
        (BinOp::Ge, false) if wraps => "icmp uge",
        (BinOp::Ge, false) => "icmp sge",
        (BinOp::Eq, false) => "icmp eq",
        (BinOp::Ne, false) => "icmp ne",
        (BinOp::BitAnd, false) => "and",
        (BinOp::BitOr, false) => "or",
        (BinOp::BitXor, false) => "xor",
        (BinOp::Shl, false) => "shl",
        (BinOp::Shr, false) => "ashr",
        (BinOp::UShr, false) => "lshr",
        _ => {
            return Err(refuse(
                func,
                &format!("the operator {op:?} on this representation"),
            ));
        }
    })
}

/// One argument, at the type the runtime declares for it.
///
/// The conversions C performs silently at a call, written out. Only the pairs
/// that actually occur: a tag handed over as a double and wanted as a
/// `uint32_t`, a length the other way, an index narrowed. Anything else is
/// refused, because a silent conversion is what caused this.
fn converted(
    into: &str,
    have: &str,
    want: &str,
    from: &str,
    func: &Func,
) -> Result<String, Diagnostic> {
    let instruction = match (have, want) {
        ("double", "i32" | "i64" | "i16" | "i8") => "fptoui",
        ("i32" | "i64" | "i16" | "i8", "double") => "uitofp",
        ("i64", "i32") | ("i32" | "i64", "i16" | "i8") | ("i16", "i8") => "trunc",
        // A narrower unsigned value into a wider slot, `i1` included: a bool is
        // one unsigned bit and widens the way an unsigned integer does. A code
        // unit is a `uint16_t` and widens the same way, which is what a string
        // read needs when specialization has narrowed its result.
        ("i32" | "i1" | "i16" | "i8", "i64") | ("i1" | "i16" | "i8", "i32") | ("i8", "i16") => {
            "zext"
        }
        _ => {
            return Err(refuse(
                func,
                &format!("an argument of {have} where the runtime declares {want}"),
            ));
        }
    };
    Ok(format!("{into} = {instruction} {have} {from} to {want}"))
}

/// The instruction that turns one representation into another.
///
/// Named per direction rather than derived, because getting one of these
/// backwards is a wrong answer that compiles: `sitofp` where `uitofp` belongs
/// reads 4294967295 as -1.
/// A conversion **to** `bool`, which is a comparison rather than a cast.
///
/// Every other conversion is one instruction with a `to` clause, so this one
/// cannot go in [`conversion`]'s table at all. The C backend writes `(bool)v`,
/// which the standard defines as `v != 0`; this is the same conversion spelled
/// the way LLVM spells it rather than a second opinion about what it means.
///
/// `une` and not `one`, so `NaN` is true, because `NaN != 0` is true in C and
/// the backend that already worked is the one to agree with. Nothing reaches
/// here with a `NaN` in practice — the conversion arises where a promise whose
/// payload is a `boolean` round-trips through its frame slot, which holds `0.0`
/// or `1.0` — but two backends have to answer alike for the value that does
/// arrive *and* the one that could.
fn is_not_zero(out: &str, from: &HirType, from_ty: &str, operand: &str) -> String {
    let (compare, zero) = if matches!(from, HirType::Float { .. }) {
        ("fcmp une", "0.0")
    } else {
        ("icmp ne", "0")
    };
    format!("{out} = {compare} {from_ty} {operand}, {zero}")
}

fn conversion(from: &HirType, to: &HirType, func: &Func) -> Result<&'static str, Diagnostic> {
    Ok(match (from, to) {
        (HirType::Int { signed: true, .. } | HirType::BigInt, HirType::Float { .. }) => "sitofp",
        // A bool is one unsigned bit, so it converts the way an unsigned
        // integer does -- the same instruction for the same reason, not two
        // cases that happen to agree.
        (HirType::Int { signed: false, .. } | HirType::Bool, HirType::Float { .. }) => "uitofp",
        // `BigInt` is `__int128` and signed, and it is *not* `HirType::Int`, so
        // it has to be named here or the conversion is refused outright. The C
        // backend writes `(__int128)x`, which truncates toward zero exactly as
        // `fptosi` does.
        (HirType::Float { .. }, HirType::Int { signed: true, .. } | HirType::BigInt) => "fptosi",
        (HirType::Float { .. }, HirType::Int { signed: false, .. }) => "fptoui",
        (HirType::Float { bits: 32 }, HirType::Float { bits: 64 }) => "fpext",
        (HirType::Float { bits: 64 }, HirType::Float { bits: 32 }) => "fptrunc",
        // A bool widens into a `bigint` the same way and for the same reason it
        // widens into any integer: it is one unsigned bit, so `BigInt(true)` is
        // `1n`. Named separately only because `BigInt` is its own `HirType`
        // rather than a wide `Int` -- which is what keeps `1n << 40n` from
        // masking its shift count to five.
        (HirType::Bool, HirType::Int { .. } | HirType::BigInt) => "zext",
        // Widening reads the *source's* signedness, not the destination's. A
        // `uint8_t` becoming an `int32_t` is `zext`: bytes 128..255 are 128..255
        // and not negatives, however the slot they land in is spelled.
        //
        // This asked the destination, which was unreachable while every integer
        // conversion went through `f64` on its way -- and wrong the moment
        // `simplify` learned to collapse that detour. `benches/cases/bytes`
        // answered -131008 where node answered 1090394752.
        (
            HirType::Int {
                bits: from,
                signed: from_signed,
            },
            HirType::Int { bits: to, .. },
        ) => {
            if from > to {
                "trunc"
            } else if *from_signed {
                "sext"
            } else {
                "zext"
            }
        }
        // A native 64-bit integer and the bigint a program holds it in. The ABI
        // stays `i64`; `BigInt` is the wider `i128` the source value lives in,
        // so one direction widens and the other truncates.
        //
        // **Widening reads the source's signedness**, which is the whole point:
        // `UINT64_MAX` must become 18446744073709551615, not -1. `zext` for an
        // unsigned source, `sext` for a signed one -- the same rule the integer
        // arm above states, and the reason this is not folded into it is that
        // `BigInt` is its own `HirType` rather than a wide `Int`.
        (HirType::Int { signed: from_signed, .. }, HirType::BigInt) => {
            if *from_signed { "sext" } else { "zext" }
        }
        // And back: the low 64 bits, which is `BigInt.asIntN(64, x)` for a
        // signed destination and `asUintN` for an unsigned one. Both are the
        // same instruction -- what differs is how the bits are read afterwards,
        // and that is the destination's business.
        (HirType::BigInt, HirType::Int { .. }) => "trunc",
        _ => {
            return Err(refuse(
                func,
                &format!("a conversion from {from:?} to {to:?}"),
            ));
        }
    })
}

/// `ToInt32` and `ToUint32`, which are a reduction and then a widening.
///
/// Lifted out of `unary` for its length rather than for its shape: the two
/// steps are one operation and splitting them further would separate the
/// coercion from the sign it establishes.
fn coercion(
    func: &Func,
    out: &str,
    value: ValueId,
    op: UnOp,
    operand: ValueId,
    ty: &str,
    float: bool,
) -> Result<String, Diagnostic> {
    Ok({
        // LLVM's integer types carry no sign, so both coercions land in
        // `i32` and only the *widening* differs: `sext` keeps a negative
        // number negative, `zext` does not.
        let signed = matches!(op, UnOp::ToInt32);
        let want = ty_of(&func.values[value.0 as usize].ty, func)?;
        // The coercion *is* a reduction to thirty-two bits, so that happens
        // first -- and then the result goes into whatever slot the middle
        // end gave it, which is not always a thirty-two bit one.
        //
        // Producing `i32` and calling it the result's type made a value
        // whose emitted width disagreed with its recorded one. Nothing
        // complained at the definition; every later reader converted from
        // the width the HIR claimed, and `%v22`, an `i32`, was truncated
        // from `i64`. One hardcoded type, and the module stopped verifying
        // several instructions away from the cause.
        let reduced = if want == "i32" {
            out.to_owned()
        } else {
            format!("{out}.n")
        };
        let reduce = if float {
            // A genuine double: the ten-instruction reduction the runtime
            // spells out, called rather than reproduced. Inlining it here
            // would be a second implementation of ToInt32 to keep in step
            // with the first, and the differential would only find the
            // difference after it shipped.
            let helper = if signed {
                "nts_to_int32_fn"
            } else {
                "nts_to_uint32_fn"
            };
            format!("{reduced} = call i32 @{helper}(double {})", name(operand))
        } else {
            let HirType::Int { bits, .. } = func.values[operand.0 as usize].ty else {
                return Err(refuse(func, "a width-changing coercion of a non-integer"));
            };
            match bits.cmp(&32) {
                std::cmp::Ordering::Greater => {
                    format!("{reduced} = trunc {ty} {} to i32", name(operand))
                }
                // Already thirty-two bits: the reinterpretation is free and
                // LLVM's types carry no sign, so there is nothing to emit.
                std::cmp::Ordering::Equal => {
                    format!("{reduced} = add {ty} {}, 0", name(operand))
                }
                std::cmp::Ordering::Less if signed => {
                    format!("{reduced} = sext {ty} {} to i32", name(operand))
                }
                std::cmp::Ordering::Less => {
                    format!("{reduced} = zext {ty} {} to i32", name(operand))
                }
            }
        };
        if want == "i32" {
            reduce
        } else {
            // The widening keeps the sign the coercion just established:
            // a `ToInt32` result is signed and a `ToUint32` result is not.
            // Backwards here reads 4294967295 as -1.
            let land = match want {
                "i64" if signed => "sext",
                "i64" => "zext",
                "i16" | "i8" => "trunc",
                "double" if signed => "sitofp",
                "double" => "uitofp",
                _ => {
                    return Err(refuse(
                        func,
                        &format!("a thirty-two bit coercion landing in {want}"),
                    ));
                }
            };
            format!("{reduce}\n  {out} = {land} i32 {reduced} to {want}")
        }
    })
}

/// Rounding an integer, which changes nothing — at *which* type.
///
/// The result may be a `double` where the operand is an `i32`:
/// `Math.trunc(n).toString(16)` on a whole `n` gives the parameter an `i32`
/// signature, and the HIR still types the rounded value `f64` because that is
/// what `nts_number_to_string_radix` takes. An `add i32` identity there kept the
/// integer type and the call read it as a double — `'%v1' defined with type
/// 'i32' but expected 'double'`, which clang rejects.
///
/// **The `Float` arm of [`unary`] is this same fact from the other side**, and
/// says so: the *result* may be an integer even where the operand is not. Both
/// directions need the conversion written down, and only one of them had it. The
/// C backend needs neither, because assigning to a declared local is the
/// conversion there.
fn rounding_identity(
    func: &Func,
    value: ValueId,
    operand: ValueId,
    out: &str,
    ty: &str,
) -> Result<String, Diagnostic> {
    if !matches!(func.values[value.0 as usize].ty, HirType::Float { .. }) {
        return Ok(format!("{out} = add {ty} {}, 0", name(operand)));
    }
    let want = ty_of(&func.values[value.0 as usize].ty, func)?;
    let widen = if matches!(
        func.values[operand.0 as usize].ty,
        HirType::Int { signed: false, .. }
    ) {
        "uitofp"
    } else {
        "sitofp"
    };
    Ok(format!("{out} = {widen} {ty} {} to {want}", name(operand)))
}

fn unary(
    func: &Func,
    out: &str,
    value: ValueId,
    op: UnOp,
    operand: ValueId,
    platform: Platform,
) -> Result<String, Diagnostic> {
    let ty = ty_of(&func.values[operand.0 as usize].ty, func)?;
    let float = matches!(func.values[operand.0 as usize].ty, HirType::Float { .. });
    Ok(match op {
        UnOp::Neg if float => format!("{out} = fneg {ty} {}", name(operand)),
        // `sub nsw 0, x` on a signed type, which is what clang emits for
        // `-a` -- and it is a real promise rather than a formality, because
        // negating `INT32_MIN` is exactly the case it excludes.
        UnOp::Neg => {
            let flag = if wraps(&func.values[operand.0 as usize].ty) {
                ""
            } else {
                " nsw"
            };
            format!("{out} = sub{flag} {ty} 0, {}", name(operand))
        }
        UnOp::Not => format!("{out} = xor i1 {}, true", name(operand)),
        // An integer, a `bigint` and a reference are all "not the zero value".
        // A double additionally has to exclude NaN, which is falsy and which a
        // plain inequality would call true, since every comparison with a NaN
        // is false -- `fcmp one` is *ordered* and not equal, which is exactly
        // both conditions. And a string is falsy when absent *or* empty, which
        // is a short circuit and so a call.
        UnOp::Truthy => match &func.values[operand.0 as usize].ty {
            HirType::Managed(nts_core::hir::ManagedType::String) => format!(
                "{out} = call zeroext i1 @nts_string_truthy(ptr {})",
                name(operand)
            ),
            HirType::Managed(_) | HirType::NativePointer(_) => {
                format!("{out} = icmp ne ptr {}, null", name(operand))
            }
            HirType::Int { .. } | HirType::BigInt => {
                format!("{out} = icmp ne {ty} {}, 0", name(operand))
            }
            HirType::Bool => format!("{out} = add i1 {}, 0", name(operand)),
            // An erased value carries which of those it is, so the rule is a
            // switch on the tag rather than a comparison -- and it lives in the
            // runtime, because spelling the whole of JavaScript truthiness at
            // every site that tests one is what the C backend also declines to
            // do.
            //
            // Without this arm the fall-through emitted `fcmp one { i32, i64 }
            // %v, 0.0`, which is a floating-point comparison of a struct
            // against a float. clang said "floating point constant invalid for
            // type", and three examples could not be built through this
            // backend.
            HirType::Erased if indirect::applies(platform) => {
                let mut lines = Vec::new();
                let argument = indirect::argument(ERASED_TYPE, &name(operand), 0, &mut lines);
                lines.push(format!("{out} = call zeroext i1 @nts_value_truthy_fn({argument})"));
                lines.join("\n  ")
            }
            HirType::Erased => {
                let tag = format!("{out}.t");
                let bits = format!("{out}.p");
                format!(
                    "{tag} = extractvalue {ERASED_TYPE} {0}, 0\n  \
                     {bits} = extractvalue {ERASED_TYPE} {0}, 1\n  \
                     {out} = call zeroext i1 @nts_value_truthy_fn(i32 {tag}, i64 {bits})",
                    name(operand)
                )
            }
            _ => format!("{out} = fcmp one {ty} {}, 0.0", name(operand)),
        },
        UnOp::Abs if float => format!(
            "{out} = call double @llvm.fabs.f64(double {})",
            name(operand)
        ),
        // The same ones the C backend answers without a library call: an
        // integer is already rounded, and its magnitude is an intrinsic rather
        // than a `fabs` around two conversions.
        //
        // At the *result's* width, not the operand's. `Math.abs` of an `i32`
        // does not fit one -- the middle end knows that and gives the result a
        // wider slot -- so taking the magnitude at the operand's width and
        // calling the answer the result is the mistake `ToInt32` documents
        // below, and it fails several instructions away from here.
        UnOp::Abs => {
            let want = ty_of(&func.values[value.0 as usize].ty, func)?;
            if want == ty {
                format!(
                    "{out} = call {ty} @llvm.abs.{ty}({ty} {}, i1 false)",
                    name(operand)
                )
            } else {
                let signed = matches!(
                    func.values[operand.0 as usize].ty,
                    HirType::Int { signed: true, .. }
                );
                let ext = if signed { "sext" } else { "zext" };
                format!(
                    "{out}.w = {ext} {ty} {} to {want}\n  {out} = call {want} @llvm.abs.{want}({want} {out}.w, i1 false)",
                    name(operand)
                )
            }
        }
        UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round
            if matches!(func.values[operand.0 as usize].ty, HirType::Int { .. }) =>
        {
            // Rounding an integer changes nothing, so this is an identity --
            // but an identity **at which type**. The result may be a `double`
            // where the operand is an `i32`: `Math.trunc(n).toString(16)` on a
            // whole `n` gives the parameter an `i32` signature, and the HIR
            // still types the rounded value `f64` because that is what
            // `nts_number_to_string_radix` takes. `add i32` kept the integer
            // type and the call read it as a double -- `'%v1' defined with
            // type 'i32' but expected 'double'`, which clang rejects.
            //
            // **The arm below is this same fact from the other side**, and says
            // so: "the *result* may be an integer even where the operand is
            // not". Both directions need the conversion written down and only
            // one of them had it. The C backend needs neither, because
            // assigning to a declared local is the conversion there.
            rounding_identity(func, value, operand, out, ty)?
        }
        // A genuine double. Three are intrinsics; `Math.round` is a call,
        // because JavaScript rounds a half toward positive infinity and C
        // rounds it away from zero -- and because the runtime's definition
        // also settles a value already integral near 2^53 and the negative
        // zero that [-0.5, 0) produces. Reproducing that here would be a
        // second implementation to keep in step with the first.
        UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round => {
            let intrinsic = match op {
                UnOp::Floor => "@llvm.floor.f64",
                UnOp::Ceil => "@llvm.ceil.f64",
                UnOp::Trunc => "@llvm.trunc.f64",
                _ => "@nts_round_fn",
            };
            // The *result* may be an integer even where the operand is not:
            // specialization proves a rounded value fits one and types it so.
            // The intrinsic still answers a double, so the conversion has to be
            // written down -- the C backend gets it from assigning to an
            // `int32_t` and there is no such thing here.
            //
            // Without it `Math.floor(x / 65536)` emitted a `double` and the
            // next instruction read it as an `i32`: "defined with type 'double'
            // but expected 'i32'", and `examples/mathops` could not be built
            // through this backend at all.
            if let HirType::Int { bits, .. } = &func.values[value.0 as usize].ty {
                let rounded = format!("{out}.r");
                format!(
                    "{rounded} = call double {intrinsic}(double {0})\n  \
                     {out} = fptosi double {rounded} to i{bits}",
                    name(operand)
                )
            } else {
                format!("{out} = call double {intrinsic}(double {})", name(operand))
            }
        }
        UnOp::Sqrt => format!(
            "{out} = call double @llvm.sqrt.f64(double {})",
            name(operand)
        ),
        // ToInt32 and ToUint32 on something already an integer, which is the
        // case specialization exists to produce: reduce modulo 2^32 and
        // reinterpret. The C backend writes `(int32_t)(uint32_t)x` for exactly
        // this and calls the runtime only for a genuine double -- which this
        // slice has no runtime to call, so it says so.
        // A genuine double: the ten-instruction reduction the runtime spells
        // out, called rather than reproduced. Inlining it here would be a
        // second implementation of ToInt32 to keep in step with the first, and
        // the differential would only find the difference after it shipped.
        UnOp::ToInt32 | UnOp::ToUint32 => coercion(func, out, value, op, operand, ty, float)?,
    })
}

mod native_memory;

/// The foreign counting pairs the program calls, declared -- and for a pair
/// that does not take NULL quietly, the guard every count goes through
/// (`Counting::called`).
/// One `alwaysinline` function per distinct open-field chain in the program.
///
/// **A function rather than instructions in place, and the reason is `phi`.** A
/// block parameter is emitted as a `phi` naming its predecessors' *labels*, and
/// those labels are the HIR block ids. A chain written inline would split its
/// HIR block into several LLVM blocks, so control would leave from a label no
/// successor's `phi` names -- an invalid module, and not one the op could be
/// blamed for. Calling out keeps the chain's branching inside a function of its
/// own, and `alwaysinline` puts the same instructions back where they would
/// have been. The null-guarded counting pairs above are emitted this way for
/// the same reason.
///
/// The name **is** the key: arms, indices and result type, sanitised. Two
/// identical chains in one program therefore share one definition without a
/// table for anyone to keep in step, and two runs of one compiler on one input
/// emit the same names.
/// The call an open field access becomes.
fn open_chain_op(
    program: &Program,
    func: &Func,
    op: &nts_core::hir::Op,
    out: &str,
) -> Result<String, Diagnostic> {
    match &op.kind {
        OpKind::OpenFieldGet { object, arms } => {
            let ty = ty_of(&op.ty, func)?;
            open_chain_call(program, func, arms, ty, false)?;
            Ok(format!(
                "{out} = call {ty} @\"{}\"({ERASED_TYPE} {})",
                open_chain_name(arms, ty, false),
                name(*object)
            ))
        },
        OpKind::OpenFieldSet {
            object,
            arms,
            value,
        } => {
            let ty = ty_of(&func.values[value.0 as usize].ty, func)?;
            open_chain_call(program, func, arms, ty, true)?;
            Ok(format!(
                "call void @\"{}\"({ERASED_TYPE} {}, {ty} {})",
                open_chain_name(arms, ty, true),
                name(*object),
                name(*value)
            ))
        },
        _ => Err(refuse(func, "an open field access this dispatch did not recognise")),
    }
}

/// Refuse a call whose definition `open_chains` could not build.
///
/// The two ask the same questions -- every arm has a layout, every index is
/// inside it -- and this is the half that can say so by name. Without it a
/// missing definition would be a call to an undefined symbol: a link error a
/// long way from the op, where a refusal names the operation and the function.
fn open_chain_call(
    program: &Program,
    func: &Func,
    arms: &[nts_core::hir::FieldArm],
    ty: &str,
    stored: bool,
) -> Result<(), Diagnostic> {
    if arms.is_empty() {
        return Err(refuse(func, "an open field access over no arms"));
    }
    if open_chain_body(program, &open_chain_name(arms, ty, stored), arms, ty, stored).is_none() {
        return Err(refuse(
            func,
            "an open field access over an arm with no layout, or an index outside one",
        ));
    }
    Ok(())
}

fn open_chains(program: &Program) -> String {
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut text = String::new();
    for func in &program.funcs {
        for op in &func.values {
            let (arms, stored) = match &op.kind {
                OpKind::OpenFieldGet { arms, .. } => (arms, None),
                OpKind::OpenFieldSet { arms, value, .. } => {
                    (arms, Some(&func.values[value.0 as usize].ty))
                },
                _ => continue,
            };
            let carried = stored.unwrap_or(&op.ty);
            let Ok(ty) = ty_of(carried, func) else { continue };
            let name = open_chain_name(arms, ty, stored.is_some());
            if !seen.insert(name.clone()) {
                continue;
            }
            if let Some(body) = open_chain_body(program, &name, arms, ty, stored.is_some()) {
                text.push_str(&body);
            }
        }
    }
    text
}

/// The symbol a chain gets, which is its content spelled out.
fn open_chain_name(arms: &[nts_core::hir::FieldArm], ty: &str, stored: bool) -> String {
    let kind = if stored { "s" } else { "g" };
    let sanitised: String = ty
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let list = arms
        .iter()
        .map(|arm| format!("{}_{}", arm.ty.0, arm.field))
        .collect::<Vec<_>>()
        .join(".");
    format!("nts.open.{kind}.{sanitised}.{list}")
}

/// The definition: one `nts_is_class` per arm, that arm's offset on a hit, and
/// a named abort on the fall-through.
///
/// `None` when an arm has no layout or an index is outside one. The op's own
/// emission asks the same questions and refuses by name, so a chain missing
/// here is a call to an undefined symbol only if that refusal is skipped --
/// which is why both ask rather than one trusting the other.
fn open_chain_body(
    program: &Program,
    symbol: &str,
    arms: &[nts_core::hir::FieldArm],
    ty: &str,
    stored: bool,
) -> Option<String> {
    let result = if stored { "void" } else { ty };
    let params = if stored {
        format!("{ERASED_TYPE} %v, {ty} %stored")
    } else {
        format!("{ERASED_TYPE} %v")
    };
    let mut text = format!("define internal {result} @\"{symbol}\"({params}) alwaysinline {{\nentry:\n");
    let _ = writeln!(text, "  %t = extractvalue {ERASED_TYPE} %v, 0");
    let _ = writeln!(text, "  %p = extractvalue {ERASED_TYPE} %v, 1");
    let _ = writeln!(text, "  %ref = inttoptr i64 %p to ptr");
    let _ = writeln!(text, "  br label %arm0");

    let mut hits: Vec<String> = Vec::new();
    let mut member = String::new();
    for (at, arm) in arms.iter().enumerate() {
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&arm.ty))?;
        let placed = nts_core::hir::layout::place(&layout.fields)?;
        let offset = *placed.offsets.get(arm.field as usize)?;
        if at == 0 {
            member.clone_from(&layout.fields.get(arm.field as usize)?.name);
        }
        let next = if at + 1 == arms.len() {
            "miss".to_owned()
        } else {
            format!("arm{}", at + 1)
        };
        let _ = writeln!(text, "arm{at}:");
        let _ = writeln!(
            text,
            "  %c{at} = call zeroext i1 @nts_is_class(i32 %t, i64 %p, ptr @nts_desc_{})",
            descriptor_for(program, layout, Some(arm.ty))
        );
        let _ = writeln!(text, "  br i1 %c{at}, label %hit{at}, label %{next}");
        let _ = writeln!(text, "hit{at}:");
        let _ = writeln!(text, "  %at{at} = getelementptr i8, ptr %ref, i64 {offset}");
        if stored {
            let _ = writeln!(text, "  store {ty} %stored, ptr %at{at}{}", tbaa(ty));
        } else {
            let _ = writeln!(text, "  %r{at} = load {ty}, ptr %at{at}{}", tbaa(ty));
            hits.push(format!("[ %r{at}, %hit{at} ]"));
        }
        let _ = writeln!(text, "  br label %done");
    }

    // Unreachable in a program whose arm set over-approximates its inhabitants,
    // which is the op's precondition and not something this can check. Named
    // rather than `unreachable` alone, because a wrong set announcing itself is
    // the whole reason to test the arms instead of casting the pointer.
    let _ = writeln!(text, "miss:");
    let _ = writeln!(
        text,
        "  call void @nts_no_arm(ptr @\"{symbol}.member\")"
    );
    let _ = writeln!(text, "  unreachable");
    let _ = writeln!(text, "done:");
    if stored {
        let _ = writeln!(text, "  ret void");
    } else {
        let _ = writeln!(text, "  %out = phi {ty} {}", hits.join(", "));
        let _ = writeln!(text, "  ret {ty} %out");
    }
    let _ = writeln!(text, "}}");
    let bytes = member.len() + 1;
    Some(format!(
        "@\"{symbol}.member\" = private unnamed_addr constant [{bytes} x i8] c\"{member}\\00\"\n{text}"
    ))
}

fn counting_declarations(program: &Program) -> String {
    let mut text = String::new();
    let held = nts_codegen_common::counting::held(program);
    for counting in nts_codegen_common::counting::foreign(program) {
        let _ = writeln!(text, "declare ptr @{}(ptr)", counting.retain);
        let _ = writeln!(text, "declare void @{}(ptr)", counting.release);
        // A pair that does not take NULL quietly, guarded once here.
        if !counting.null_safe {
            let retain = nts_core::hir::native::Counting::guarded(counting.retain);
            let release = nts_core::hir::native::Counting::guarded(counting.release);
            let _ = writeln!(
                text,
                "define internal ptr @{retain}(ptr %object) alwaysinline {{\nentry:\n  %null = icmp eq ptr %object, null\n  br i1 %null, label %done, label %count\ncount:\n  %counted = call ptr @{}(ptr %object)\n  br label %done\ndone:\n  %result = phi ptr [ %object, %entry ], [ %counted, %count ]\n  ret ptr %result\n}}",
                counting.retain
            );
            let _ = writeln!(
                text,
                "define internal void @{release}(ptr %object) alwaysinline {{\nentry:\n  %null = icmp eq ptr %object, null\n  br i1 %null, label %done, label %count\ncount:\n  call void @{}(ptr %object)\n  br label %done\ndone:\n  ret void\n}}",
                counting.release
            );
        }
        // How the runtime counts one of these where it holds it: a field
        // being freed, an array's elements. Both functions take NULL.
        if !held.contains(&counting) {
            continue;
        }
        let ops = nts_codegen_common::counting::ops_name(&counting);
        let _ = writeln!(
            text,
            "@{ops} = internal constant {{ ptr, ptr }} {{ ptr @{}, ptr @{} }}",
            counting.called(true),
            counting.called(false)
        );

    }
    text
}
