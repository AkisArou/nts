//! Emitting C from HIR.
//!
//! # A printer, not a decision-maker
//!
//! Block order and the copies a block-parameter edge implies are decided in
//! `nts-codegen-common`, so nothing here chooses anything a JVM emitter would
//! have to choose again. What is left is spelling.
//!
//! # Scalars only, for now
//!
//! A managed reference needs a runtime — an allocator, a header, a collector —
//! and none of that exists yet. Rather than emit a plausible `char *` and pretend,
//! a function touching a managed type is refused. RFC §4.1 again: the failure has
//! to be visible.

pub use nts_codegen_common::symbols::c_identifier;
use nts_codegen_common::{CodeWriter, Copy, block_order, destruct};
use nts_core::hir::{
    BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, UnOp, ValueId,
};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::Origin;

/// The C runtime, as source.
///
/// Real C compiled as its own translation unit rather than text pasted into
/// every generated file. It lives under `runtime/c/` and is included here, so
/// it can be read, edited and reviewed as C -- and so an unused external
/// function is not a warning, which is what let the whole "work out which
/// helpers this program reaches" apparatus be deleted.
pub const RUNTIME_HEADER_NAME: &str = "nts_runtime.h";
pub const RUNTIME_HEADER: &str = include_str!("../../../../runtime/c/nts_runtime.h");
pub const RUNTIME_SOURCE_NAME: &str = "nts_runtime.c";
pub const RUNTIME_SOURCE: &str = include_str!("../../../../runtime/c/nts_runtime.c");

/// The libuv host, for a standalone program.
///
/// Separate from the runtime because it is a *choice*: an embedder with its
/// own loop supplies its own host and links none of this, and a library
/// product has no loop at all (RFC §26.1). Written beside the program only
/// when one is asked for.
pub const UV_HOST_HEADER_NAME: &str = "nts_uv_host.h";
pub const UV_HOST_HEADER: &str = include_str!("../../../../runtime/c/nts_uv_host.h");
pub const UV_HOST_SOURCE_NAME: &str = "nts_uv_host.c";
pub const UV_HOST_SOURCE: &str = include_str!("../../../../runtime/c/nts_uv_host.c");

/// The `main` of a standalone program.
///
/// What an executable *is*, in one function: evaluate the module, then run the
/// loop until nothing is left, then shut down. That is what node does with
/// `node main.js`, and it is why the module's top-level code is the program
/// rather than some exported entry point being one.
///
/// `initializes` is whether the program has any top-level code. A program that
/// is only declarations has nothing to evaluate, and calling a function that
/// was never emitted is a link error.
#[must_use]
pub fn standalone_main(initializes: bool) -> String {
    let declare = if initializes {
        "/* Emitted only when the program has top-level code to evaluate. */\nvoid module__init(void);\n\n"
    } else {
        ""
    };
    let evaluate = if initializes {
        "    module__init();\n    /* Module evaluation is itself a job, so what it queued is drained\n     * here rather than at the first thing the loop runs. */\n    nts_enter();\n    nts_leave();\n"
    } else {
        "    /* No top-level code, so nothing to evaluate. */\n"
    };
    format!(
        "/* Before any header: libuv's Unix header names POSIX types that a\n\
         \x20* strict `-std=c11` translation unit cannot see, and a feature-test\n\
         \x20* macro set after the first system header has no effect. */\n\
         #if defined(__linux__) && !defined(_GNU_SOURCE)\n\
         #define _GNU_SOURCE\n\
         #endif\n\
         \n\
         #include \"nts_runtime.h\"\n\
         #include \"nts_uv_host.h\"\n\
         \n\
         {declare}\
         int main(void) {{\n\
         \x20   nts_uv_host_install(uv_default_loop());\n\
         {evaluate}\
         \x20   /* Until nothing is runnable, no timer is pending, and no\n\
         \x20    * foreign completion is in flight. */\n\
         \x20   nts_uv_host_run();\n\
         \x20   /* Closes every handle and drops whatever is still queued: a\n\
         \x20    * task owns a reference, and the contract is that whoever\n\
         \x20    * holds it either runs it or gives it back. */\n\
         \x20   nts_uv_host_shutdown();\n\
         \x20   return 0;\n\
         }}\n"
    )
}

/// Every value some operation or terminator in a function reads.
fn values_read(func: &Func) -> rustc_hash::FxHashSet<ValueId> {
    let mut read = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
        for value in &block.ops {
            read.extend(nts_core::hir::operands_of(
                &func.values[value.0 as usize].kind,
            ));
        }
    }
    read
}

/// What an emitter needs beyond the function it is emitting.
///
/// Layouts come from the program because a field's name and position are a
/// property of its *type*, not of the function reading it; literals come from
/// the program because two functions naming the same string must reach the same
/// static.
struct Context<'a> {
    program: &'a Program,
    literals: &'a [String],
    /// Values something in this function reads.
    ///
    /// A call whose result nobody wants still has to happen, so dead-code
    /// elimination keeps it — but assigning it to a local nobody reads is
    /// `-Wunused-but-set-variable`, which is an error under the flags the
    /// generated file is compiled with. `c.advance();` as a statement is
    /// exactly that.
    read: rustc_hash::FxHashSet<ValueId>,
}

/// C for one program, and what could not be emitted.
#[derive(Debug)]
pub struct Emitted {
    pub writer: CodeWriter,
    pub diagnostics: Vec<Diagnostic>,
}

impl Emitted {
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

/// Emit a whole program as one translation unit.
#[must_use]
pub fn emit(program: &Program) -> Emitted {
    let mut writer = CodeWriter::new();
    let mut diagnostics = Vec::new();

    let Some(first) = program.funcs.first() else {
        return Emitted {
            writer,
            diagnostics,
        };
    };
    let origin = first.origin.clone();

    // Each function is emitted speculatively and kept only if it succeeded. A
    // half-emitted function is worse than an absent one: it declares a signature
    // and a body that does not return, which compiles into a callable shell.
    // Two different TypeScript names can mangle to one C name — `double` and
    // `double_` both become `double_`. Emitting both would produce a redefinition
    // error far from its cause, so it is caught here where the cause is known.
    let mut claimed: rustc_hash::FxHashMap<String, &str> = rustc_hash::FxHashMap::default();
    for func in &program.funcs {
        let c_name = c_identifier(&func.name);
        if let Some(previous) = claimed.insert(c_name.clone(), &func.name)
            && previous != func.name
        {
            diagnostics.push(Diagnostic::error(
                "NTS2004",
                format!(
                    "`{}` and `{previous}` both need the C name `{c_name}`",
                    func.name
                ),
                func.origin.location,
            ));
        }
    }

    // Collected before emission so that every reference names the same static.
    //
    // From the values each block still *executes*, not from every value the
    // function defines. Dead-code elimination leaves the definitions behind --
    // they are addressed by index, so removing one would renumber the rest --
    // and a static nothing reads is an error under `-Wunused-const-variable`,
    // which is the setting that makes a warning from generated code a compiler
    // bug rather than a style preference.
    let mut literals: Vec<String> = Vec::new();
    for func in &program.funcs {
        for block in &func.blocks {
            for value in &block.ops {
                if let OpKind::ConstString(text) = &func.values[value.0 as usize].kind
                    && !literals.contains(text)
                {
                    literals.push(text.clone());
                }
            }
        }
    }

    let mut bodies = Vec::new();
    for func in &program.funcs {
        let mut body = CodeWriter::new();
        let context = Context {
            program,
            literals: &literals,
            read: values_read(func),
        };
        match emit_func(&mut body, func, &context) {
            Ok(signature) => bodies.push((signature, body, func)),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    let descriptors = descriptors_reached(&bodies);

    writer.line(&origin, "/* Generated by nts. Do not edit. */");
    // The runtime, and nothing else -- notably not <stdlib.h>, which declares
    // `div`, a name a TypeScript program is entitled to use.
    writer.line(&origin, format!("#include \"{RUNTIME_HEADER_NAME}\""));
    emit_object_types(&mut writer, &origin, program, &mut diagnostics);

    // Forward declarations, so a call does not depend on definition order — and
    // only for functions that actually have a definition. Before the
    // descriptors, because a dispatch table takes the address of a function and
    // C wants that declared.
    for (signature, _, _) in &bodies {
        writer.line(&origin, format!("{signature};"));
    }
    // And for the functions it calls and does *not* define. A
    // `declare function` is a promise that a symbol exists at link time, and
    // without a prototype the call is an implicit declaration -- which C99
    // removed and clang rejects.
    match external_prototypes(program) {
        Ok(prototypes) => {
            for prototype in prototypes {
                writer.line(&origin, prototype);
            }
        }
        Err(diagnostic) => diagnostics.push(diagnostic),
    }
    writer.blank(&origin);

    emit_object_descriptors(&mut writer, &origin, program);
    emit_descriptors(&mut writer, &origin, &descriptors);
    emit_literals(&mut writer, &origin, &literals);
    if let Err(diagnostic) = emit_globals(&mut writer, program) {
        diagnostics.push(diagnostic);
    }

    for (_, body, _) in bodies {
        writer.append(body);
    }

    Emitted {
        writer,
        diagnostics,
    }
}

/// Prototypes for every function this program calls and does not define.
///
/// The signature comes from the call sites, because that is the only place it
/// exists: an external callee has no `Func` to read parameters off. Where two
/// calls disagree the program is asking for one symbol with two signatures,
/// which C would take and the linker would not, so it is a diagnostic here.
///
/// # Why the runtime's own helpers are excluded by asking rather than by name
///
/// They are already declared by the included header, and declaring them twice
/// with types derived from a call site would conflict with the real
/// declaration. The test is whether the header mentions the name, not whether
/// the name starts with `nts_`: a program is entitled to write
/// `declare function nts_process_cwd()`, and a naming convention would silently
/// leave that one undeclared -- which is the bug this function exists to fix.
fn external_prototypes(program: &Program) -> Result<Vec<String>, Diagnostic> {
    let mut seen: rustc_hash::FxHashMap<&str, String> = rustc_hash::FxHashMap::default();
    let mut prototypes = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            if runtime_declares(name) {
                continue;
            }
            let mut parameters = Vec::new();
            for arg in args {
                parameters.push(c_type_of(
                    program,
                    &func.values[arg.0 as usize].ty,
                    &op.origin,
                )?);
            }
            if parameters.is_empty() {
                parameters.push("void".to_owned());
            }
            let prototype = format!(
                "{} {}({});",
                c_type_of(program, &op.ty, &op.origin)?,
                c_identifier(name),
                parameters.join(", ")
            );
            match seen.get(name.as_str()) {
                Some(existing) if *existing != prototype => {
                    return Err(Diagnostic::error(
                        "NTS2007",
                        format!(
                            "`{name}` is called with two different signatures, so there is no \
                             one declaration to emit: `{existing}` and `{prototype}`"
                        ),
                        op.origin.location,
                    ));
                }
                Some(_) => {}
                None => {
                    seen.insert(name.as_str(), prototype.clone());
                    prototypes.push(prototype);
                }
            }
        }
    }
    prototypes.sort();
    Ok(prototypes)
}

/// Whether the runtime header already declares a name.
///
/// A whole-word search, so `nts_str_slice` does not count as a declaration of
/// `nts_str_slice_into`.
fn runtime_declares(name: &str) -> bool {
    RUNTIME_HEADER.match_indices(name).any(|(at, _)| {
        let before = RUNTIME_HEADER[..at].chars().next_back();
        let after = RUNTIME_HEADER[at + name.len()..].chars().next();
        let boundary = |c: Option<char>| !c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        boundary(before) && boundary(after)
    })
}

/// The C name of a string literal's static data.
fn literal_name(literals: &[String], text: &str) -> String {
    let index = literals.iter().position(|known| known == text).unwrap_or(0);
    format!("nts_str_{index}")
}

/// Whether a runtime helper takes a managed reference of any class here.
///
/// The header spells that `NtsHeader *`, which C will not accept a
/// `NtsObj_Error *` for without being told -- and every managed object in a
/// program is one of those. A *string* is a `NtsHeader` by typedef, so a
/// `Promise<string>` worked and a `Promise<SomeClass>` did not, which is the
/// kind of gap that shows up as one payload type failing and the rest passing.
fn erases_class(callee: &str, at: usize) -> bool {
    matches!(
        (callee, at),
        ("nts_promise_fulfill_reference" | "nts_promise_reject", 1) | ("nts_set_timeout", 0)
    )
}

/// Whether a runtime helper *returns* a managed reference of any class.
///
/// The mirror of [`erases_class`], and it needs the same treatment for the
/// same reason: the runtime stores one reference slot for every payload, so it
/// hands back `NtsHeader *` and the caller supplies the class. The caller can,
/// because the payload's representation is in the type -- that is what
/// `ManagedType::Promise` carries it for.
///
/// A string and an object both went unnoticed here, because assigning to a
/// `NtsString *` from a `NtsHeader *` is the typedef and C allows it. An array
/// payload is the first one C objects to, which is a warning about how narrow
/// the accident of a passing test can be.
fn erases_result(callee: &str) -> bool {
    matches!(callee, "nts_promise_reference")
}

/// A call: static, external, or through the receiver's dispatch table.
fn call_text(
    func: &Func,
    name: &str,
    value: ValueId,
    callee: &Callee,
    args: &[ValueId],
    context: &Context<'_>,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    // A virtual call names the implementation the receiver's *static* type would
    // reach. That is not the one that runs -- the table decides that -- but it
    // is what gives the call its signature, and an override has the same
    // signature by definition.
    //
    // A *closure* call has no such declaration -- every closure of a type has
    // its own implementation -- so its signature comes from the call site
    // instead, which knows the argument types and the result type exactly.
    let target = match callee {
        Callee::Direct(target)
        | Callee::External(target)
        | Callee::Virtual {
            declared: target, ..
        } => target.as_str(),
        Callee::Closure { .. } => "",
    };

    // A derived object passed where a base is expected. The layout is base
    // first, so the two agree on every field the base has and the cast is a
    // no-op -- but C will not take one pointer for the other without being told,
    // and `super(...)` does exactly this.
    //
    // Only an *up*cast is reachable here: TypeScript checked assignability
    // before any of this ran, so an argument that is not the parameter's type is
    // a subtype of it.
    let declared = context
        .program
        .funcs
        .iter()
        .find(|func| func.name == target)
        .map(|func| &func.params);
    let arguments: Vec<String> = args
        .iter()
        .enumerate()
        .map(|(at, argument)| {
            // A runtime helper that takes a managed reference of *any* class
            // is declared in the header as `NtsHeader *`, and the emitter has
            // no signature for it -- `declared` only covers functions the
            // program itself defines. A string is already an `NtsHeader`, so
            // this went unnoticed until an object payload reached one.
            if erases_class(target, at) {
                return format!("(NtsHeader *){}", value_name(*argument));
            }
            let wanted = declared.and_then(|params| params.get(at)).map(|p| &p.ty);
            let actual = &func.values[argument.0 as usize].ty;
            match wanted {
                Some(wanted) if wanted != actual && wanted.is_managed() => {
                    match c_type_of(context.program, wanted, origin) {
                        Ok(ty) => format!("({ty}){}", value_name(*argument)),
                        Err(_) => value_name(*argument),
                    }
                }
                _ => value_name(*argument),
            }
        })
        .collect();

    let call = if let Callee::Closure { slot } = callee {
        let signature = closure_signature(func, value, args, context.program, origin)?;
        let receiver = args
            .first()
            .map_or_else(|| "0".to_owned(), |value| value_name(*value));
        format!(
            "(({signature}){receiver}->header.descriptor->methods[{slot}])({})",
            arguments.join(", ")
        )
    } else if let Callee::Virtual { slot, .. } = callee {
        // The table stores untyped pointers, so the call spells the signature it
        // is making. `args[0]` is the receiver, and its descriptor is where the
        // table lives -- one load and one indirect call, which is what dispatch
        // costs when the compiler knows the whole hierarchy.
        let signature = virtual_signature(context.program, target, origin)?;
        let receiver = args
            .first()
            .map_or_else(|| "0".to_owned(), |value| value_name(*value));
        format!(
            "(({signature}){receiver}->header.descriptor->methods[{slot}])({})",
            arguments.join(", ")
        )
    } else if matches!(
        func.values[value.0 as usize].kind,
        OpKind::Call { frame: Some(_), .. }
    ) {
        // The `_into` form of the same helper, handed the storage declared
        // above. The frame is where the result lives; everything else about the
        // call is unchanged, which is the point of doing it this way rather than
        // with a second operation.
        format!(
            "{}_into(&{name}_frame.header, {})",
            c_identifier(target),
            arguments.join(", ")
        )
    } else if erases_result(target) {
        let wanted = c_type_of(context.program, &func.values[value.0 as usize].ty, origin)?;
        format!(
            "({wanted}){}({})",
            c_identifier(target),
            arguments.join(", ")
        )
    } else {
        format!("{}({})", c_identifier(target), arguments.join(", "))
    };

    // A result used at a different type than the callee declares.
    //
    // `bump(): this` on a base class returns the base pointer, and in a
    // subclass the caller's `this` is the subclass. Under base-first layout
    // those are the same pointer -- which is the rule `verify::compatible`
    // already applies to a return, a store and a call argument -- but C wants
    // telling, and `-Wincompatible-pointer-types` is an error here.
    //
    // Only where the two actually differ, so nothing that agreed before this
    // grows a cast. Only for a managed type, because two scalars are a
    // conversion rather than a cast and specialization owns those.
    let wanted = &func.values[value.0 as usize].ty;
    let cast = context
        .program
        .funcs
        .iter()
        .find(|declared| declared.name == *target)
        .filter(|declared| declared.return_type != *wanted && wanted.is_managed())
        .map(|_| c_type_of(context.program, wanted, origin))
        .transpose()?;

    Ok(if context.read.contains(&value) {
        match cast {
            Some(ty) => format!("{name} = ({ty}){call};"),
            None => format!("{name} = {call};"),
        }
    } else {
        // The call still happens; only its result is unwanted.
        format!("{call};")
    })
}

/// Which layouts some `ObjectNew` in the program actually creates.
///
/// A descriptor is read through an object's own header, so only a layout a
/// program allocates can ever have its read.
fn allocated_layouts(program: &Program) -> rustc_hash::FxHashSet<usize> {
    let mut found = rustc_hash::FxHashSet::default();
    for func in &program.funcs {
        for op in &func.values {
            // A static closure instance is not allocated, but it *is* an
            // object: it carries a header, and a header needs a descriptor to
            // point at. Reference counting reads that descriptor before it
            // reads `NTS_IMMORTAL` and stops.
            if !matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ClosureStatic) {
                continue;
            }
            let HirType::Managed(ManagedType::Object(ty)) = &op.ty else {
                continue;
            };
            if let Some(at) = program
                .layouts
                .iter()
                .position(|layout| layout.types.contains(ty))
            {
                found.insert(at);
            }
        }
    }
    found
}

/// `a === b` on two strings, which compares by value.
///
/// `"a" + "b" === "ab"` is true in JavaScript, and those are two different
/// allocations -- so pointer equality is the wrong answer rather than an
/// approximation of it.
fn string_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    if !matches!(bin, BinOp::Eq | BinOp::Ne)
        || !matches!(
            func.values[lhs.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        )
    {
        return None;
    }
    let negate = if matches!(bin, BinOp::Ne) { "!" } else { "" };
    Some(format!(
        "{name} = {negate}nts_string_eq({}, {});",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// `===` and `!==` where one side is an erased value.
///
/// A tag has to be tested before a payload can be read, so this is a call
/// rather than a C operator. Reached by `x === 5` on a `number | undefined`,
/// which is what a `Map#get` produces -- and which emitted `(double)v` on a
/// sixteen-byte struct before this existed: uncompilable C from a function the
/// lowering reported as complete.
///
/// Deliberately not the table's key comparison. That one is `SameValueZero`, so
/// it answers true for `NaN` against `NaN`, and `===` answers false.
fn erased_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    if !matches!(bin, BinOp::Eq | BinOp::Ne) {
        return None;
    }
    let left = &func.values[lhs.0 as usize].ty;
    let right = &func.values[rhs.0 as usize].ty;
    let negate = if matches!(bin, BinOp::Ne) { "!" } else { "" };
    if left == &HirType::Erased && right == &HirType::Erased {
        return Some(format!(
            "{name} = {negate}nts_value_strict_eq({}, {});",
            value_name(lhs),
            value_name(rhs)
        ));
    }
    // One of each, in either order: equality is symmetric, so the erased side
    // becomes the receiver whichever side it was written on.
    let (value, against, other) = match (left, right) {
        (HirType::Erased, _) => (lhs, rhs, right),
        (_, HirType::Erased) => (rhs, lhs, left),
        _ => return None,
    };
    let helper = match other {
        HirType::Float { .. } | HirType::Int { .. } => "nts_value_eq_number",
        HirType::Bool => "nts_value_eq_boolean",
        HirType::Managed(ManagedType::String) => "nts_value_eq_string",
        // Every other managed value is a pointer and compares by identity,
        // which is what `===` means for one.
        HirType::Managed(_) => "nts_value_eq_reference",
        // `void` and `never` have no value to compare, and a comparison
        // against the absent reference was answered before this ran.
        _ => return None,
    };
    Some(format!(
        "{name} = {negate}{helper}({}, {});",
        value_name(value),
        value_name(against)
    ))
}

/// `x === null` and `x !== null`, as a comparison of addresses.
fn null_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    let absent = |value: ValueId| {
        matches!(
            func.values[value.0 as usize].kind,
            OpKind::ConstNull | OpKind::ConstUndefined
        )
    };
    if !matches!(bin, BinOp::Eq | BinOp::Ne) || !(absent(lhs) || absent(rhs)) {
        return None;
    }
    // Addresses, so both sides have to *be* addresses. An erased operand is a
    // struct: `==` on it is not C, and its absence is a tag rather than a null
    // anyway. Guarded here rather than relied on from the lowering, because
    // this function cannot see what routed the comparison to it.
    if matches!(func.values[lhs.0 as usize].ty, HirType::Erased)
        || matches!(func.values[rhs.0 as usize].ty, HirType::Erased)
    {
        return None;
    }
    let operator = if matches!(bin, BinOp::Ne) { "!=" } else { "==" };
    Some(format!(
        "{name} = {} {operator} {};",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// `obj.f = v`, with the truncation spelled where there is one.
///
/// A field narrowed to an integer by `hir::fields` is stored into from a double
/// the analysis proved whole and in range, so the cast is the identity on every
/// value the program can produce -- but C should be told rather than left to
/// convert implicitly.
fn field_store(
    func: &Func,
    op: &nts_core::hir::Op,
    object: ValueId,
    field: u32,
    stored: ValueId,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let layout = layout_of(
        context.program,
        &func.values[object.0 as usize].ty,
        &op.origin,
    )?;
    let declared = layout.fields.get(field as usize).ok_or_else(|| {
        Diagnostic::error(
            "NTS2006",
            "a field index outside its layout",
            op.origin.location,
        )
    })?;
    let cast = if declared.ty == func.values[stored.0 as usize].ty {
        String::new()
    } else {
        c_type_of(context.program, &declared.ty, &op.origin)
            .map_or_else(|_| String::new(), |ty| format!("({ty})"))
    };
    Ok(format!(
        "{}->{} = {cast}{};",
        value_name(object),
        c_identifier(&declared.name),
        value_name(stored)
    ))
}

/// The cast an upcast needs, or nothing where the types already agree.
///
/// TypeScript checked assignability before any of this ran, so a reference
/// whose type is not the one wanted is a *subtype* of it -- and base-first
/// layout makes the two pointers equal. The cast carries no instruction; it
/// tells C that the two spellings mean one address.
fn upcast(func: &Func, context: &Context<'_>, wanted: &HirType, value: ValueId) -> String {
    let actual = &func.values[value.0 as usize].ty;
    if !wanted.is_managed() || wanted == actual {
        return String::new();
    }
    let origin = &func.values[value.0 as usize].origin;
    c_type_of(context.program, wanted, origin)
        .map_or_else(|_| String::new(), |ty| format!("({ty})"))
}

/// A function-pointer type for calling a closure, taken from the call itself.
///
/// The receiver is the closure object, whose static type is the *function*
/// type -- an empty layout that every closure of that type has as its base. So
/// the pointer the table entry is called with is the same address the
/// implementation wants, and only the spelling differs.
fn closure_signature(
    func: &Func,
    value: ValueId,
    args: &[ValueId],
    program: &Program,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let mut params = Vec::new();
    for arg in args {
        params.push(c_type_of(program, &func.values[arg.0 as usize].ty, origin)?);
    }
    Ok(format!(
        "{} (*)({})",
        c_type_of(program, &func.values[value.0 as usize].ty, origin)?,
        if params.is_empty() {
            "void".to_owned()
        } else {
            params.join(", ")
        }
    ))
}

/// A function-pointer type for calling one implementation of a virtual method.
fn virtual_signature(
    program: &Program,
    target: &str,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let Some(func) = program.funcs.iter().find(|func| func.name == target) else {
        return Err(Diagnostic::error(
            "NTS2006",
            format!("no declaration for `{target}` to take a signature from"),
            origin.location,
        ));
    };
    let mut params = Vec::new();
    for param in &func.params {
        params.push(c_type_of(program, &param.ty, origin)?);
    }
    Ok(format!(
        "{} (*)({})",
        c_type_of(program, &func.return_type, origin)?,
        if params.is_empty() {
            "void".to_owned()
        } else {
            params.join(", ")
        }
    ))
}

/// The C name of a module-scope variable.
fn global_name(program: &Program, global: u32) -> String {
    program
        .globals
        .get(global as usize)
        .map_or_else(|| format!("nts_global_{global}"), |g| c_identifier(&g.name))
}

/// Module-scope variables, as file-scope storage.
///
/// `static` unless exported, so a name a program keeps to itself does not become
/// part of the artifact's ABI -- and so the linker can drop one nothing reads,
/// which is the same reachability argument `--gc-sections` makes for functions.
fn emit_globals(writer: &mut CodeWriter, program: &Program) -> Result<(), Diagnostic> {
    for global in &program.globals {
        // `c_type_of` rather than `c_type`: an object type is named per
        // program, so a global holding one cannot be spelled without it.
        let ty = c_type_of(program, &global.ty, &global.origin)?;
        let visibility = if global.exported { "" } else { "static " };
        writer.line(
            &global.origin,
            format!(
                "{visibility}{ty} {} = {};",
                c_identifier(&global.name),
                match global.ty {
                    HirType::Bool => (global.initial != 0.0).to_string(),
                    // A global's `initial` is one `f64`, which cannot spell a
                    // tag beside a payload. It does not have to: an erased
                    // global starts as `undefined`, and whatever the source
                    // wrote is assigned by `module#init` -- which is where
                    // every module-scope initializer that is not a constant
                    // already runs.
                    //
                    // The macro rather than the accessor, because this is a
                    // static's initializer and C wants a constant expression
                    // there. The call compiled everywhere else and not here.
                    HirType::Erased => "NTS_VALUE_UNDEFINED".to_owned(),
                    // A reference global starts null, and `module#init`
                    // assigns whatever the source wrote -- the same place every
                    // non-constant module-scope initializer already runs.
                    // `initial` is one `f64` and cannot spell a pointer, so
                    // emitting it here would declare `NtsString *s = 0.0;`.
                    ref ty if ty.may_hold_a_reference() => "0".to_owned(),
                    _ => float_literal(global.initial),
                }
            ),
        );
    }
    if !program.globals.is_empty() {
        writer.blank(&program.globals[0].origin);
    }
    Ok(())
}

/// A double as a C expression.
///
/// Rust prints the three non-finite doubles as `inf`, `-inf` and `NaN`, none of
/// which is C. They reach here because `Infinity` and `NaN` are ordinary
/// constants in a TypeScript program and because the constant folder produces
/// them: dividing by zero is not an error in JavaScript, it is a value.
fn float_literal(value: f64) -> String {
    if value.is_nan() {
        // The sign and payload of a NaN are not observable from JavaScript, so
        // any NaN will do and `NAN` is the one `math.h` names.
        return "(double)NAN".to_owned();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-(double)INFINITY".to_owned()
        } else {
            "(double)INFINITY".to_owned()
        };
    }
    // `{:?}` round-trips: it prints the shortest decimal that reads back as the
    // same double, and always with a decimal point so C reads it as one.
    format!("{value:?}")
}

/// String literals, as static data.
///
/// Emitted as numeric code units rather than as C string literals: a C literal
/// would need escaping rules that do not match JavaScript's, and would carry
/// its own idea of what a byte means.
fn emit_literals(writer: &mut CodeWriter, origin: &Origin, literals: &[String]) {
    for (index, text) in literals.iter().enumerate() {
        let units: Vec<u16> = text.encode_utf16().collect();
        let name = format!("nts_str_{index}");
        // One byte per code unit whenever every one fits, which for ordinary
        // program text is always. The trailing zero is what makes a one-byte
        // string usable as a C string without copying.
        let wide = units.iter().any(|unit| *unit > 0xFF);
        let (element, descriptor, flags) = if wide {
            ("uint16_t", "nts_desc_string2", "NTS_TWO_BYTE")
        } else {
            ("unsigned char", "nts_desc_string1", "0")
        };
        let data: Vec<String> = units
            .iter()
            .map(std::string::ToString::to_string)
            .chain(std::iter::once("0".to_owned()))
            .collect();
        writer.line(
            origin,
            format!(
                "static const struct {{ NtsHeader header; {element} data[{}]; }} {name} = \
                 {{ {{ &{descriptor}, NTS_IMMORTAL, {flags}, {} }}, {{ {} }} }};",
                data.len(),
                units.len(),
                data.join(", ")
            ),
        );
    }
    if !literals.is_empty() {
        writer.blank(origin);
    }
}

/// A 128-bit integer as C source.
///
/// C has no literal wider than `long long`, so a `bigint` past 64 bits cannot
/// be written as digits: clang rejects `170141183460469231731687303715884105727`
/// with "integer literal is too large to be represented in any integer type",
/// which is what every `bigint` literal above 2^63 emitted.
///
/// Built from halves instead, which every C compiler accepts and constant-folds
/// away. The low half is taken as unsigned so its top bit is not a sign.
// Both casts reinterpret rather than convert, which is the whole job: the sign
// is carried by the top bit of the high half and the halves are put back
// together by the shift below.
#[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
fn integer_literal(value: i128) -> String {
    if let Ok(narrow) = i64::try_from(value) {
        return format!("{narrow}");
    }
    let bits = value as u128;
    let high = (bits >> 64) as u64;
    let low = bits as u64;
    format!("(((__int128)0x{high:x}ULL << 64) | 0x{low:x}ULL)")
}

/// The name of the single instance a named function's closure has.
fn static_closure_name(layout: &nts_core::hir::Layout) -> String {
    format!("nts_fnval_{}", object_type_name(layout))
}

/// A C struct per object type, and its descriptor.
///
/// A real struct rather than manual offsets, so the C compiler decides padding
/// and alignment and the emitted field access is `p->x` — which is both faster
/// to read and impossible to get wrong by an offset.
fn emit_object_types(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    diagnostics: &mut Vec<Diagnostic>,
) {
    // Every object type is forward-declared first, so a field may point at a
    // type declared later -- or at its own, which a linked structure does.
    for layout in &program.layouts {
        let name = object_type_name(layout);
        writer.line(origin, format!("typedef struct {name} {name};"));
    }
    if !program.layouts.is_empty() {
        writer.blank(origin);
    }

    // One number both backends write into a count word, checked against the
    // macro that defines it. A backend that got this wrong would produce
    // storage the collector believes it may free.
    writer.line(
        origin,
        format!(
            "_Static_assert(NTS_IMMORTAL == {}u, \"NTS_IMMORTAL is not what nts writes\");",
            nts_codegen_common::layout::IMMORTAL
        ),
    );
    for layout in &program.layouts {
        let name = object_type_name(layout);
        writer.line(origin, format!("struct {name} {{"));
        // The header first, so every managed object starts the same way and a
        // provider can read the descriptor without knowing the type (RFC 8.2).
        writer.line(origin, "    NtsHeader header;");
        for field in &layout.fields {
            // A field whose C type cannot be computed used to be *dropped
            // from the struct*, silently, while the descriptor beside it kept
            // taking an `offsetof` into it. Ninety-three of them across the
            // node profile, and not obscure ones: a cell's `value`, a closure's
            // captured `callback`, `Agent.requests`. A struct missing a field
            // the reference map still points at is not a smaller object, it is
            // a wrong one.
            //
            // Named instead. The layout is the thing that is unrepresentable,
            // so the diagnostic is about the layout rather than about whichever
            // function happened to touch it first.
            // A field whose type has no layout is still a *pointer*, and that
            // is the whole of what this struct needs from it.
            //
            // `materialize_within` walks containers and deliberately not
            // fields: demanding a layout for every field type refused a class
            // for holding a `Map` it never touches, at 81 profile functions to
            // fix nothing. What it did instead was silently *drop* the field --
            // ninety-three of them, including a cell's `value` and a closure's
            // captured `callback` -- while `reference_fields` kept the name in
            // the descriptor's map and the emitter kept taking an `offsetof`
            // into it. A struct missing a field the reference map points at is
            // not a smaller object, it is a wrong one.
            //
            // Neither horn was necessary. Every managed object is one pointer
            // whatever its layout, the reference map wants an offset and a
            // pointer has one, and nothing here can dereference it: reading
            // through the field would have called `layout_of` and there would
            // be a layout. So it is emitted opaque.
            //
            // Which is also where LLVM already is -- it has had none but opaque
            // pointers since 17 -- so this is the C backend agreeing with the
            // one that comes next rather than a concession.
            let ty = match c_type_of(program, &field.ty, origin) {
                Ok(ty) => ty,
                Err(problem) if field.ty.is_managed() => {
                    let _ = problem;
                    "void *".to_owned()
                }
                Err(problem) => {
                    diagnostics.push(problem);
                    continue;
                }
            };
            // `readonly` is semantic, not syntactic — `Readonly<T>` counts — but
            // it is deliberately *not* emitted as `const` on the member.
            //
            // It used to be, to let clang hoist loads across calls, and the
            // construction store wrote through the qualifier with a cast. That
            // is defined for heap storage, which has no declared type, and
            // undefined the moment the same struct is declared in a frame --
            // which is now something the compiler does whenever an object does
            // not escape. One of the two had to go, and an object that never
            // reaches the allocator is worth an order of magnitude more than a
            // qualifier on storage whose declared type does not exist.
            //
            // The fact is not lost: `readonly` stays in the HIR, where a field
            // load that cannot change is something this compiler can common up
            // itself. That is strictly more than the C qualifier was buying.
            writer.line(origin, format!("    {ty} {};", c_identifier(&field.name)));
        }
        writer.line(origin, "};");
        // What this compiler believes about the struct clang just laid out.
        //
        // Descriptors take `offsetof` on the principle that whoever laid the
        // struct out says where its fields are. That is right while C owns the
        // layout and unavailable the moment a second backend does not have an
        // `offsetof` to ask -- so the placement is computed in
        // `nts_codegen_common::layout` and this is where clang checks it, on
        // every build, per field.
        //
        // The claim and the oracle, side by side, until the claim has gone long
        // enough without being wrong to become the authority. A `_Static_assert`
        // costs nothing at run time and fails at compile time with the field's
        // name in the message.
        if let Some(placed) = nts_codegen_common::layout::place(&layout.fields) {
            writer.line(
                origin,
                format!(
                    "_Static_assert(sizeof({name}) == {}u, \"{name} is not the size nts computed\");",
                    placed.size
                ),
            );
            for (field, offset) in layout.fields.iter().zip(&placed.offsets) {
                writer.line(
                    origin,
                    format!(
                        "_Static_assert(offsetof({name}, {}) == {offset}u, \"{name}.{} is not where nts computed\");",
                        c_identifier(&field.name),
                        field.name
                    ),
                );
            }
        }
        writer.blank(origin);
    }
}

/// Per-type data: the reference map, the dispatch table, and the descriptor.
///
/// Separate from the structs because a dispatch table takes the address of a
/// function, and a function has to be declared before that is legal. The structs
/// come first because a declaration's parameter types need them.
fn emit_object_descriptors(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    let cyclic_layouts = program.cyclic_layouts();
    let allocated = allocated_layouts(program);
    for (index, layout) in program.layouts.iter().enumerate() {
        // A layout nothing allocates needs no descriptor. It still needs its
        // struct, because something is declared as a pointer to it -- a
        // closure's signature type is exactly that: every value of it is really
        // a closure, and the closure's own descriptor is the one at runtime.
        if !allocated.contains(&index) {
            continue;
        }
        let name = object_type_name(layout);
        // RFC 8.3: where this object's references are, as byte offsets. Written
        // with `offsetof` so the compiler that laid the struct out is the one
        // that says where its fields are -- padding, alignment and field order
        // are its business, and duplicating its arithmetic here would be a
        // second source of truth that agrees until it does not.
        //
        // Nothing reads this under NoGC, where a reference field is a pointer
        // and costs nothing. It is emitted anyway, because it is a fact about
        // the layout.
        // The class's dispatch table, where the hierarchy has one. A slot the
        // class does not implement is null, which is unreachable: a call only
        // uses a slot the receiver's static type declares, and every class at or
        // below that type fills it.
        let methods = if layout.methods.iter().all(Option::is_none) {
            "0".to_owned()
        } else {
            let entries: Vec<String> = layout
                .methods
                .iter()
                .map(|method| {
                    method.as_ref().map_or_else(
                        || "0".to_owned(),
                        |name| format!("(void *){}", c_identifier(name)),
                    )
                })
                .collect();
            writer.line(
                origin,
                format!(
                    "static void *const nts_vtable_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_vtable_{name}")
        };

        let references = layout.reference_fields();
        let offsets = if references.is_empty() {
            // No table, and no `static const uint32_t x[] = {};` either: a
            // zero-length array is not C.
            "0".to_owned()
        } else {
            let entries: Vec<String> = references
                .iter()
                .map(|field| format!("offsetof({name}, {})", c_identifier(field)))
                .collect();
            writer.line(
                origin,
                format!(
                    "static const uint32_t nts_refs_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_refs_{name}")
        };
        // Slots holding an erased value, which is a reference only when its tag
        // says so. Emitted the same way and for the same reason as the
        // reference table above: `offsetof`, so the compiler that laid the
        // struct out is the one that says where its fields are.
        let erased: Vec<&str> = layout
            .fields
            .iter()
            .filter(|field| field.ty == HirType::Erased)
            .map(|field| field.name.as_str())
            .collect();
        let erased_offsets = if erased.is_empty() {
            "0".to_owned()
        } else {
            let entries: Vec<String> = erased
                .iter()
                .map(|field| format!("offsetof({name}, {})", c_identifier(field)))
                .collect();
            writer.line(
                origin,
                format!(
                    "static const uint32_t nts_erased_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_erased_{name}")
        };
        // Whether an object of this type could be in a reference cycle. The
        // collector reads it to stay away from the programs that have none,
        // which is nearly all of them.
        let cyclic = u32::from(cyclic_layouts.get(index).copied().unwrap_or(true));
        writer.line(
            origin,
            format!(
                "static const NtsDescriptor nts_desc_{name} = \
                 {{ NTS_KIND_OBJECT, sizeof({name}), {}u, {cyclic}u, {offsets}, {methods}, \"{}\", \
                 {}u, {erased_offsets} }};",
                references.len(),
                layout.name,
                erased.len()
            ),
        );
        // A named function used as a value is one object, so it is emitted
        // rather than allocated: static, immortal, and nothing in it but the
        // header. `NTS_IMMORTAL` is what keeps reference counting away from
        // storage that was never allocated and must never be freed.
        if wants_a_static_instance(program, layout) {
            writer.line(
                origin,
                format!(
                    "static {name} {} = {{{{&nts_desc_{name}, NTS_IMMORTAL, 0, 0}}}};",
                    static_closure_name(layout)
                ),
            );
        }
        writer.blank(origin);
    }
}

/// Whether anything in the program refers to this layout's single instance.
///
/// Asked of the IR rather than tracked alongside it: `ClosureStatic` is the
/// only thing that reads one, so the ops that read it are the whole answer.
fn wants_a_static_instance(program: &Program, layout: &nts_core::hir::Layout) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(op.kind, OpKind::ClosureStatic)
                && matches!(&op.ty, HirType::Managed(ManagedType::Object(ty))
                    if layout.types.contains(ty))
        })
    })
}

/// The per-program data: a descriptor per element type this program allocates.
///
/// The runtime itself is [`RUNTIME_HEADER`] and [`RUNTIME_SOURCE`] -- real C,
/// compiled separately -- so none of it is generated. What is generated is what
/// depends on the program.
fn emit_descriptors(writer: &mut CodeWriter, origin: &Origin, descriptors: &[&'static str]) {
    for element in descriptors {
        writer.line(
            origin,
            format!(
                "static const NtsDescriptor {} = \
                 {{ NTS_KIND_ARRAY, sizeof({element}), 0, 0, 0, 0, \"{element}[]\", {}, 0 }};",
                descriptor_name(element),
                // For an array, `erased` is a fact about every element rather
                // than a table of offsets -- exactly as `references` is. An
                // array of erased values whose descriptor said `0` would never
                // be walked, so a string held in one would be released while
                // something still pointed at it.
                u32::from(**element == *"NtsValue")
            ),
        );
    }
    if !descriptors.is_empty() {
        writer.blank(origin);
    }
}

/// The element types the emitted functions actually allocate.
///
/// One descriptor per element type rather than per array: a descriptor is
/// immutable and describes the shape, not any particular array's contents.
fn descriptors_reached(bodies: &[(String, CodeWriter, &Func)]) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = Vec::new();
    for func in bodies.iter().map(|(_, _, func)| *func) {
        for op in &func.values {
            if !matches!(op.kind, OpKind::ArrayNew { .. }) {
                continue;
            }
            let HirType::Managed(ManagedType::Array(element)) = &op.ty else {
                continue;
            };
            // Arrays of references share the runtime's own descriptor: every
            // reference is a pointer, so they are all the same shape.
            if element.is_managed() {
                continue;
            }
            if let Ok(spelling) = c_type(element, &op.origin)
                && !found.contains(&spelling)
            {
                found.push(spelling);
            }
        }
    }
    found
}

/// The C spelling of a type, including the object types this program declares.
fn c_type_of(program: &Program, ty: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    if let HirType::Managed(ManagedType::Object(_)) = ty {
        let layout = layout_of(program, ty, origin)?;
        return Ok(format!("{} *", object_type_name(layout)));
    }
    Ok(c_type(ty, origin)?.to_owned())
}

/// The layout an object-typed value refers to.
fn layout_of<'a>(
    program: &'a Program,
    ty: &HirType,
    origin: &Origin,
) -> Result<&'a nts_core::hir::Layout, Diagnostic> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return Err(Diagnostic::error(
            "NTS2006",
            "a field operation on something that is not an object",
            origin.location,
        ));
    };
    program.layout(*id).ok_or_else(|| {
        Diagnostic::error("NTS2006", "an object type with no layout", origin.location)
    })
}

/// The C name of an object type.
///
/// Prefixed so it cannot collide with anything the program declares, and named
/// after the source type so the emitted C is readable.
fn object_type_name(layout: &nts_core::hir::Layout) -> String {
    format!(
        "NtsObj_{}",
        layout.name.replace(|c: char| !c.is_alphanumeric(), "_")
    )
}

/// The C name of a field, by index into its type's layout.
fn field_of(
    program: &Program,
    func: &Func,
    object: ValueId,
    field: u32,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let layout = layout_of(program, &func.values[object.0 as usize].ty, origin)?;
    layout
        .fields
        .get(field as usize)
        .map(|field| c_identifier(&field.name))
        .ok_or_else(|| {
            Diagnostic::error(
                "NTS2006",
                "a field index outside its layout",
                origin.location,
            )
        })
}

/// The C spelling of an array's element type.
fn element_type(program: &Program, array: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    let HirType::Managed(ManagedType::Array(element)) = array else {
        return Err(Diagnostic::error(
            "NTS2005",
            "an array operation on something that is not an array",
            origin.location,
        ));
    };
    c_type_of(program, element, origin)
}

/// The descriptor an array's elements use.
///
/// Every reference is the same shape -- a pointer -- so arrays of references
/// share one descriptor. A descriptor describes the element's *shape*, not what
/// it points at, and emitting one per pointed-to type would be as many copies
/// of the same three numbers.
fn element_descriptor(array: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    let HirType::Managed(ManagedType::Array(element)) = array else {
        return Err(Diagnostic::error(
            "NTS2005",
            "an array operation on something that is not an array",
            origin.location,
        ));
    };
    if element.is_managed() {
        return Ok("nts_desc_ref".to_owned());
    }
    Ok(descriptor_name(c_type(element, origin)?))
}

/// The descriptor a given element type uses. One per element type, not per
/// array: the descriptor is immutable and says nothing about a particular
/// array's contents.
fn descriptor_name(element: &str) -> String {
    format!("nts_desc_{}", element.replace(' ', "_"))
}

/// The subscript for an element access, with or without a bounds test.
///
/// An unsigned comparison catches a negative index in the same instruction as
/// a too-large one, since a negative wraps to something enormous. Where the
/// analysis proved the index in range, there is no test at all.
fn index_expression(func: &Func, array: ValueId, index: ValueId, checked: bool) -> String {
    if !checked {
        // Proven in range, so the cast is exact whichever representation it
        // arrived in.
        return format!("(uint32_t){}", value_name(index));
    }
    if matches!(func.values[index.0 as usize].ty, HirType::Int { .. }) {
        format!(
            "nts_check({}, (uint32_t){})",
            value_name(array),
            value_name(index)
        )
    } else {
        format!("nts_index({}, {})", value_name(array), value_name(index))
    }
}

/// Whether a coercion is a no-op because its operand already has that shape.
fn coercion_is_free(func: &Func, coercion: UnOp, operand: ValueId) -> bool {
    let source = &func.values[operand.0 as usize].ty;
    match coercion {
        UnOp::ToInt32 => {
            *source
                == HirType::Int {
                    bits: 32,
                    signed: true,
                }
        }
        UnOp::ToUint32 => {
            *source
                == HirType::Int {
                    bits: 32,
                    signed: false,
                }
        }
        _ => false,
    }
}

/// `Erase` and `Unerase`, which are a tag-and-store and a load.
///
/// Both fail the same way and for the same reason, so they answer together:
/// there is no tag for a reference yet, in either direction.
fn erased_conversion(
    func: &Func,
    op: &nts_core::hir::Op,
    name: &str,
    kind: &OpKind,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let refuse = |ty: &HirType, direction: &str| {
        Diagnostic::error(
            "NTS2008",
            format!(
                "a value of type {ty:?} cannot be {direction} yet; a reference payload needs \
                 retain and release that switch on the tag, and getting that subtly wrong is \
                 silent"
            ),
            op.origin.location,
        )
    };
    match kind {
        OpKind::Erase { value } => {
            let from = &func.value(*value).ty;
            let (tag, field) = erased_tag(from).ok_or_else(|| refuse(from, "erased"))?;
            // The payload is one `NtsHeader *` for every reference, because
            // that is what retain, release and the tracer all take. The cast is
            // the same one `nts_retain` needs and for the same reason: a class
            // instance is a header followed by its fields, so the two point at
            // the same address.
            // Through the runtime's constructors rather than a struct literal:
            // the representation is sixteen bytes of tag-beside-payload today
            // and eight NaN-boxed ones tomorrow, and the emitter should not be
            // the second place that has to know which.
            let built = match field {
                "reference" => format!(
                    "nts_value_of_reference((NtsHeader *){}, {tag})",
                    value_name(*value)
                ),
                "boolean" => format!("nts_value_of_boolean({})", value_name(*value)),
                _ if tag == "NTS_TAG_UNDEFINED" => "nts_value_of_undefined()".to_owned(),
                _ => format!("nts_value_of_number({})", value_name(*value)),
            };
            Ok(format!("{name} = {built};"))
        }
        OpKind::Unerase { value } => {
            let (_, field) = erased_tag(&op.ty).ok_or_else(|| refuse(&op.ty, "read back"))?;
            let read = match field {
                "reference" => {
                    let ty = c_type_of(context.program, &op.ty, &op.origin)?;
                    format!("({ty})nts_value_reference({})", value_name(*value))
                }
                "boolean" => format!("nts_value_boolean({})", value_name(*value)),
                _ => format!("nts_value_number({})", value_name(*value)),
            };
            Ok(format!("{name} = {read};"))
        }
        _ => unreachable!("only the two conversions reach here"),
    }
}

/// The tag and union member an erased value uses for a concrete type.
///
/// `None` for anything this cannot erase yet, which today is every reference:
/// a payload that is sometimes a pointer needs retain and release that switch
/// on the tag, and reference counting that is subtly wrong does not announce
/// itself. Refused by name rather than stored and hoped for.
fn erased_tag(ty: &HirType) -> Option<(&'static str, &'static str)> {
    match ty {
        HirType::Float { .. } | HirType::Int { .. } => Some(("NTS_TAG_NUMBER", "number")),
        HirType::Bool => Some(("NTS_TAG_BOOLEAN", "boolean")),
        HirType::Void => Some(("NTS_TAG_UNDEFINED", "number")),
        HirType::Managed(ManagedType::String) => Some(("NTS_TAG_STRING", "reference")),
        // Every object shares one tag. `typeof` cannot tell two classes apart
        // -- it answers "object" for both -- and which class it is comes from
        // the header the payload points at, which is where the collector and
        // dispatch already look.
        // An array answers "object" to `typeof`, like any other object, and it
        // carries the same header -- so the collector and the refcount reach it
        // through the payload exactly as they reach a class instance.
        // A closure answers `"function"` to `typeof`, so it carries its own
        // tag. Told apart by the id rather than by the layout, because that is
        // all this sees -- see `hir::is_closure_type` for why the synthetic id
        // space is partitioned to make the question answerable here.
        HirType::Managed(ManagedType::Object(ty)) if nts_core::hir::is_closure_type(*ty) => {
            Some(("NTS_TAG_FUNCTION", "reference"))
        }
        HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_)) => {
            Some(("NTS_TAG_OBJECT", "reference"))
        }
        _ => None,
    }
}

fn c_type(ty: &HirType, origin: &Origin) -> Result<&'static str, Diagnostic> {
    Ok(match ty {
        HirType::Void => "void",
        HirType::Bool => "bool",
        HirType::Erased => "NtsValue",
        HirType::Float { bits: 32 } => "float",
        HirType::Float { .. } => "double",
        HirType::Int {
            bits: 8,
            signed: true,
        } => "int8_t",
        HirType::Int {
            bits: 8,
            signed: false,
        } => "uint8_t",
        HirType::Int {
            bits: 16,
            signed: true,
        } => "int16_t",
        HirType::Int {
            bits: 16,
            signed: false,
        } => "uint16_t",
        HirType::Int {
            bits: 32,
            signed: true,
        } => "int32_t",
        HirType::Int {
            bits: 32,
            signed: false,
        } => "uint32_t",
        // `bigint`. `__int128` is a clang extension rather than a C type, which
        // is fine here: this backend emits for clang and the runtime is built
        // with it.
        //
        // 128 bits is not arbitrary precision, and the difference is a
        // deliberate, visible boundary rather than a silent one -- a literal
        // that does not fit is refused where it is written. See `lower_bigint`
        // for the whole argument.
        HirType::BigInt => "__int128",
        HirType::Int { signed: true, .. } => "int64_t",
        HirType::Int { signed: false, .. } => "uint64_t",
        // `never` reaching a value position means control got somewhere the type
        // system said it could not.
        HirType::Never => {
            return Err(Diagnostic::error(
                "NTS2002",
                "a value of type `never` reached code generation",
                origin.location,
            ));
        }
        // An array is a pointer to its header; the elements follow it. The
        // element type is not in the C type, because every access already knows
        // it from the HIR and spelling it here would need a struct per element
        // type for no benefit.
        HirType::Managed(ManagedType::Array(_)) => "NtsArray *",
        HirType::Managed(ManagedType::String) => "NtsString *",
        // One runtime type whatever it carries. The payload's representation is
        // in the HIR type for the compiler's sake -- it says which
        // `nts_promise_fulfill_*` to emit -- and the C sees a tagged union, so
        // there is nothing per payload to name here.
        HirType::Managed(ManagedType::Promise(_)) => "NtsPromise *",
        // Likewise one runtime type for both, and for both type arguments. The
        // table stores `NtsValue`s whatever the key and value represent as, so
        // a `Map<string, number>` and a `Map<Socket, Buffer>` are the same C
        // type -- what differs is the hash it was built with, which is an
        // argument to the constructor rather than part of the type.
        HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) => "NtsMap *",
        // An object type is named per program, so it has no `&'static str`
        // spelling. `c_type_of` answers for those; reaching here means a caller
        // asked the question that cannot be answered without the program.
        HirType::Managed(ManagedType::Object(_)) => {
            return Err(Diagnostic::error(
                "NTS2006",
                "an object type needs the program to be named",
                origin.location,
            ));
        }
    })
}

/// One function's signature, used for both its definition and its prototype.
///
/// `static` unless exported, which the globals next door have always been and
/// functions never were. Same argument: a name a program keeps to itself should
/// not become part of the artifact's ABI, and the linker can drop one nothing
/// reads.
///
/// Not a speed change, and it was pursued as one. `accumulate` runs faster
/// through the LLVM backend, which emits `internal` for the same function, so
/// external linkage looked like the reason. It is not -- `tooling/bench` builds
/// with `-flto`, where clang internalizes what nothing outside needs, so this
/// was already happening. Measured before and after: 1.81us and 1.82us.
fn signature(program: &Program, func: &Func) -> Result<String, Diagnostic> {
    let returns = c_type_of(program, &func.return_type, &func.origin)?;
    let visibility = if func.exported { "" } else { "static " };
    if func.params.is_empty() {
        return Ok(format!(
            "{visibility}{returns} {}(void)",
            c_identifier(&func.name)
        ));
    }
    let mut params = Vec::new();
    for (index, param) in func.params.iter().enumerate() {
        let ty = c_type_of(program, &param.ty, &param.origin)?;
        params.push(format!(
            "{ty} {}",
            value_name(ValueId(u32::try_from(index).unwrap_or(0)))
        ));
    }
    Ok(format!(
        "{visibility}{returns} {}({})",
        c_identifier(&func.name),
        params.join(", ")
    ))
}

/// The C name of a value.
///
/// A parameter's value is the C parameter itself, which is why the arena is
/// numbered so that `%0..%n` are the parameters — no copy is needed to get an
/// argument into a local.
fn value_name(value: ValueId) -> String {
    format!("v{}", value.0)
}

fn block_label(block: BlockId) -> String {
    format!("b{}", block.0)
}

/// Emit one function, returning its signature so a declaration can be written.
fn emit_func(
    writer: &mut CodeWriter,
    func: &Func,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let signature = signature(context.program, func)?;
    writer.line(&func.origin, format!("{signature} {{"));
    emit_body(writer, func, context)?;
    writer.line(&func.origin, "}");
    writer.blank(&func.origin);
    Ok(signature)
}

fn emit_body(
    writer: &mut CodeWriter,
    func: &Func,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let order = block_order(func);

    // Every value except the parameters becomes a local. C scoping would not let
    // a value defined in one block be read in another, so they are all declared
    // at the top — where SSA guarantees each is assigned before any use.
    //
    // Declared from the block contents rather than from the value arena, so that
    // a value dead-code elimination dropped does not leave an unused local
    // behind. The arena keeps dead entries on purpose: a `ValueId` is an index
    // into it, and compacting would invalidate every reference in the function.
    let mut declared = rustc_hash::FxHashSet::default();
    let mut read = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        declared.extend(block.params.iter().copied());
        declared.extend(block.ops.iter().copied());
        read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
        for value in &block.ops {
            read.extend(nts_core::hir::operands_of(
                &func.values[value.0 as usize].kind,
            ));
        }
    }

    // A call whose result nobody reads is emitted as a bare statement, so it has
    // nothing to declare. `c.advance();` written for its effect is exactly that,
    // and a local assigned by nobody is `-Wunused-variable`.
    declared.retain(|value| {
        read.contains(value) || !matches!(func.values[value.0 as usize].kind, OpKind::Call { .. })
    });

    // A parameter nothing reads is an error under -Werror, and constant folding
    // produces them for real: `fixed(scale: 8) { return scale * scale }` folds
    // to `64` and stops looking at its argument. The signature still has to
    // match, so the parameter stays and is discarded explicitly.
    writer.indent();
    for index in 0..func.params.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        if !read.contains(&id) {
            writer.line(
                &func.params[index].origin,
                format!("(void){};", value_name(id)),
            );
        }
    }
    writer.dedent();

    writer.indent();
    for (index, op) in func.values.iter().enumerate() {
        // A parameter is already declared by the signature, a value nothing
        // reads was dropped by dead-code elimination, and an operation that
        // produces nothing has nothing to hold — `void v4;` is not a variable.
        // A string built in the frame needs room for its code units, and the
        // statement names that room whether or not anything reads the result --
        // so the storage is declared on the strength of the *frame* rather than
        // of the value, above the skip below.
        //
        // Reachable since `for (const c of s)` existed: constant folding turns
        // `c.length` on a literal into a number, the slice becomes a call
        // nobody reads, and the assignment is dropped while the frame it writes
        // into is still named.
        if let OpKind::Call {
            frame: Some(units), ..
        } = op.kind
        {
            writer.line(
                &op.origin,
                format!(
                    "NTS_FRAME_STRING({units}) {}_frame;",
                    value_name(ValueId(u32::try_from(index).unwrap_or(0)))
                ),
            );
        }
        if matches!(op.kind, OpKind::Param(_))
            || matches!(op.ty, HirType::Void)
            || !declared.contains(&ValueId(u32::try_from(index).unwrap_or(0)))
        {
            continue;
        }
        let ty = c_type_of(context.program, &op.ty, &op.origin)?;
        // An object that does not escape lives here rather than on the heap, so
        // it needs storage as well as a pointer to it. Declared with the other
        // locals, which means one slot per allocation site rather than one per
        // execution of it -- correct precisely because nothing outlives the
        // iteration that made it.
        if let OpKind::ObjectNew { frame: true } = op.kind {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            writer.line(
                &op.origin,
                format!(
                    "{} {}_frame;",
                    object_type_name(layout),
                    value_name(ValueId(u32::try_from(index).unwrap_or(0)))
                ),
            );
        }
        writer.line(
            &op.origin,
            format!(
                "{ty} {};",
                value_name(ValueId(u32::try_from(index).unwrap_or(0)))
            ),
        );
    }

    let temps = destruct::temp_count(func);
    for temp in 0..temps {
        // One scratch per cycle depth. Typed as the widest scalar, since a swap
        // only ever moves a value into a slot of its own type.
        writer.line(&func.origin, format!("double t{temp};"));
    }
    writer.dedent();

    // Only blocks something actually jumps to need a label, and an unreferenced
    // label is a warning in every C compiler worth using. "Actually" is the load-
    // bearing word: a jump to the next block in this order emits no `goto`, so
    // the successor edge exists in the HIR and no label is needed for it. This
    // has to mirror the rule in `emit_terminator` exactly or the two disagree.
    let mut targeted = rustc_hash::FxHashSet::default();
    for (position, block) in order.iter().enumerate() {
        let next = order.get(position + 1).copied();
        match &func.blocks[block.0 as usize].terminator {
            Terminator::Jump { target, .. } if next == Some(*target) => {}
            terminator => targeted.extend(terminator.successors()),
        }
    }

    for (position, block) in order.iter().enumerate() {
        let next = order.get(position + 1).copied();
        emit_block(
            writer,
            func,
            *block,
            next,
            targeted.contains(block),
            context,
        )?;
    }
    Ok(())
}

fn emit_block(
    writer: &mut CodeWriter,
    func: &Func,
    block: BlockId,
    next: Option<BlockId>,
    labelled: bool,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let record = &func.blocks[block.0 as usize];
    let origin = func
        .values
        .get(record.ops.first().map_or(0, |v| v.0 as usize))
        .map_or_else(|| func.origin.clone(), |op| op.origin.clone());

    if labelled {
        writer.line(&origin, format!("{}:;", block_label(block)));
    }
    writer.indent();

    for value in &record.ops {
        emit_op(writer, func, *value, context)?;
    }
    emit_terminator(writer, func, block, next, &origin, context);

    writer.dedent();
    Ok(())
}

/// The C spelling of a binary operation.
fn binary_text(
    func: &Func,
    op: &nts_core::hir::Op,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> String {
    // A bitwise operator's operands are always coercion results — the lowering
    // guarantees it — so they hold int32 values whatever their representation
    // says. When specialization did not give them an integer type, the
    // arithmetic still has to happen in integers, so it is spelled with casts
    // around it. Those casts are exactly the cost the analysis removes.
    //
    // A `bigint` is the exception at both ends. It is already exact, and it is
    // 128 bits wide: narrowing it to `int32_t` or returning it through a
    // `double` would each throw away most of it. So it counts as integral here,
    // and the cast below leaves it alone.
    let integral = holds_an_integer(&op.ty);
    // Cast decided per *operand*, from its own type. Deciding it from the
    // result's would emit `v14 | v15` with `v15` a double, which is not C.
    let cast = |value: ValueId| {
        if matches!(
            func.values[value.0 as usize].ty,
            HirType::Int { .. } | HirType::BigInt
        ) {
            value_name(value)
        } else {
            format!("(int32_t){}", value_name(value))
        }
    };
    let wrap = |text: String| {
        if integral {
            format!("{name} = {text};")
        } else {
            format!("{name} = (double)({text});")
        }
    };

    // Shifts are not C operators here. JavaScript masks the count to five bits,
    // where C leaves a shift by 32 or more undefined; `<<` on a negative signed
    // operand is undefined in C and defined in JavaScript. Each goes through a
    // helper that spells the real rule.
    // The shift helpers spell JavaScript's rule for a *number*: the count is
    // masked to five bits and the operands are int32. A `bigint` has neither
    // rule -- the lowering skipped the `ToInt32` pair for it -- but it does not
    // get C's operator either, because a negative count reverses the direction
    // and a count past the width saturates, and C leaves both undefined. It
    // gets a second pair of helpers that spell *those* rules on 128 bits.
    let wide = matches!(func.values[lhs.0 as usize].ty, HirType::BigInt);
    let helper = match (wide, bin) {
        (false, BinOp::Shl) => Some("nts_shl"),
        (false, BinOp::Shr) => Some("nts_shr"),
        (false, BinOp::UShr) => Some("nts_ushr"),
        (true, BinOp::Shl) => Some("nts_bigint_shl"),
        (true, BinOp::Shr) => Some("nts_bigint_shr"),
        _ => None,
    };
    if let Some(helper) = helper {
        // Cast to the slot the result goes in. `nts_ushr` answers a `uint32_t`
        // -- `>>>` is defined to -- and the slot is an `int32_t`, so C narrowed
        // it silently. That is safe only because a shift by one or more clears
        // the top bit, which is an argument nobody had written down; `x >>> 0`
        // is the case it does not cover. Saying it makes the one place that has
        // to think about it visible.
        // A shift's result is a scalar, so `c_type` answers it without the
        // program; if it somehow could not, the unannotated call is what this
        // emitted before and is no worse.
        let slot = c_type(&op.ty, &op.origin).unwrap_or("");
        return wrap(format!("({slot}){helper}({}, {})", cast(lhs), cast(rhs)));
    }

    // A comparison against the absent reference is a comparison of addresses,
    // whatever the other side is. It has to come before the string rule below:
    // `s === null` is a question about the pointer, and answering it by reading
    // through the pointer would read through the null one.
    if let Some(text) = null_comparison(func, name, bin, lhs, rhs) {
        return text;
    }

    // After the null rule, which answers `x === null` for an erased `x` as a
    // question about absence, and before the string one, whose test is the
    // *static* type being a string and so would not fire for an erased side.
    if let Some(text) = erased_comparison(func, name, bin, lhs, rhs) {
        return text;
    }
    if let Some(text) = string_comparison(func, name, bin, lhs, rhs) {
        return text;
    }

    let operator = match bin {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::BitAnd => "&",
        BinOp::BitOr => "|",
        BinOp::BitXor => "^",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        // Every shift went to a helper above except `>>>` on a bigint, which
        // is a TypeError in JavaScript and is rejected by the typechecker long
        // before this. Reachable in this `match`, unreachable from a program.
        BinOp::Shl | BinOp::Shr | BinOp::UShr => {
            unreachable!("`>>>` on a bigint is a type error and does not arrive")
        }
        // Not `fmin`/`fmax`: those return the non-NaN operand where JavaScript
        // returns NaN, and disagree about the two zeroes.
        BinOp::Min | BinOp::Max => {
            // Two integers cannot be NaN and have no second zero, so the whole
            // reason the helper exists is absent and a comparison will do.
            let both_integers = matches!(func.values[lhs.0 as usize].ty, HirType::Int { .. })
                && matches!(func.values[rhs.0 as usize].ty, HirType::Int { .. });
            if both_integers {
                let test = if matches!(bin, BinOp::Min) { "<" } else { ">" };
                return format!(
                    "{name} = {0} {test} {1} ? {0} : {1};",
                    value_name(lhs),
                    value_name(rhs)
                );
            }
            let helper = if matches!(bin, BinOp::Min) {
                "nts_min"
            } else {
                "nts_max"
            };
            return wrap(format!(
                "{helper}({}, {})",
                value_name(lhs),
                value_name(rhs)
            ));
        }
        BinOp::Concat => {
            return format!(
                "{name} = nts_concat({}, {});",
                value_name(lhs),
                value_name(rhs)
            );
        }
    };

    if matches!(bin, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) {
        return wrap(format!("{} {operator} {}", cast(lhs), cast(rhs)));
    }

    // `%` is integer-only in C, and on doubles it is `fmod` -- which is not an
    // approximation of JavaScript's remainder but exactly it: ECMAScript
    // defines `%` as truncated division with the sign of the dividend, and so
    // does C99. `-4 % 2` is `-0` on both sides, and `x % 0` is NaN on both.
    //
    // Specialization turns most of these into an integer `%` first, where the
    // two are also the same operation. This is what is left: a remainder over
    // values the analysis could not prove whole.
    if matches!(bin, BinOp::Rem) && matches!(op.ty, HirType::Float { .. }) {
        return format!("{name} = fmod({}, {});", value_name(lhs), value_name(rhs));
    }

    format!(
        "{name} = {} {operator} {};",
        value_name(lhs),
        value_name(rhs)
    )
}

/// Whether a bitwise result can be written without going through a `double`.
///
/// `Bool` counts. `a || b` lowers to a bitwise or of two comparisons, and
/// leaving it out sent the result through a `double` on its way into a `bool`
/// -- `(double)((int32_t)v31 | (int32_t)v33)` in a condition, so a float
/// compare where an integer test would do. Twenty-eight of those across the
/// examples, found by compiling the generated C with `-Wconversion`, which is a
/// question nothing had asked it before.
fn holds_an_integer(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Int { .. } | HirType::BigInt | HirType::Bool
    )
}

/// The C spelling of a unary operation.
fn unary_text(
    func: &Func,
    name: &str,
    un: UnOp,
    operand: ValueId,
    result: &HirType,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    // Integer arithmetic happens in the type of the *result*, not of the
    // operand, and the two differ exactly where it matters. The analysis widens
    // `-x` and `Math.abs(x)` on an `i32` to `i64` precisely because
    // `-INT32_MIN` does not fit; negating first and widening after is signed
    // overflow, which is undefined and which in practice yields `INT32_MIN`
    // again -- the one input `Math.abs` exists to handle. Differential testing
    // against node found it as `Math.abs(-2147483648)`.
    let widen = |value: ValueId| -> Result<String, Diagnostic> {
        if matches!(result, HirType::Int { .. }) {
            Ok(format!(
                "({}){}",
                c_type(result, origin)?,
                value_name(value)
            ))
        } else {
            Ok(value_name(value))
        }
    };

    Ok(match un {
        UnOp::Neg => format!("{name} = -{};", widen(operand)?),
        // IEEE-754 requires a correctly rounded square root, so C's is
        // JavaScript's -- on every input, including the negatives where both
        // are NaN and the negative zero both return unchanged.
        UnOp::Sqrt => format!("{name} = sqrt({});", value_name(operand)),
        UnOp::Not => format!("{name} = !{};", value_name(operand)),
        UnOp::Truthy => {
            // An integer is truthy exactly when it is non-zero, and `!= 0` says
            // so. A double additionally has to exclude NaN, which is falsy and
            // which `!= 0` would call true — every comparison with a NaN is
            // false, including the inequality.
            //
            // A reference is truthy when it is present, except that an *empty
            // string* is falsy in JavaScript however present it is. An array or
            // an object is truthy whatever it holds, including an empty one:
            // `if ([])` runs.
            match &func.values[operand.0 as usize].ty {
                HirType::Managed(ManagedType::String) => format!(
                    "{name} = {0} != 0 && {0}->length != 0;",
                    value_name(operand)
                ),
                // An integer, a `bigint` and a reference are all "not the zero
                // value". A `bigint` reached the double rule below and emitted
                // `isnan` on an `__int128`, which is not C -- it has no NaN to
                // exclude, being an exact integer, and `0n` is its only falsy
                // value.
                HirType::Int { .. } | HirType::BigInt | HirType::Managed(_) => {
                    format!("{name} = {} != 0;", value_name(operand))
                }
                // An erased value carries which of those it is, so the rule is
                // a switch on the tag rather than a comparison. In the runtime,
                // because spelling it inline would put the whole of JavaScript
                // truthiness at every site that tests one.
                HirType::Erased => {
                    format!("{name} = nts_value_truthy({});", value_name(operand))
                }
                _ => format!("{name} = ({0} != 0.0) && !isnan({0});", value_name(operand)),
            }
        }
        UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round | UnOp::Abs => {
            // An integer is already rounded, and taking its magnitude is a
            // comparison rather than a library call.
            let already_integral =
                matches!(func.values[operand.0 as usize].ty, HirType::Int { .. });
            if already_integral {
                return Ok(match un {
                    UnOp::Abs => {
                        let wide = widen(operand)?;
                        format!("{name} = {wide} < 0 ? -{wide} : {wide};")
                    }
                    _ => format!("{name} = {};", widen(operand)?),
                });
            }
            let call = match un {
                UnOp::Floor => "floor",
                UnOp::Ceil => "ceil",
                UnOp::Trunc => "trunc",
                UnOp::Abs => "fabs",
                // C's `round` rounds a half away from zero; JavaScript rounds it
                // toward positive infinity, so `Math.round(-1.5)` is `-1` and
                // `round(-1.5)` is `-2`.
                _ => "nts_round",
            };
            // Rounding in doubles and converting after, never the other way
            // round: `(int32_t)-3.7` is `-3` and `floor(-3.7)` is `-4`.
            // The cast is to the result's own width. Hardcoding `int32_t` here
            // truncated a `floor` whose range the analysis had already widened
            // past 32 bits.
            if matches!(result, HirType::Int { .. }) {
                return Ok(format!(
                    "{name} = ({}){call}({});",
                    c_type(result, origin)?,
                    value_name(operand)
                ));
            }
            format!("{name} = {call}({});", value_name(operand))
        }
        UnOp::ToInt32 | UnOp::ToUint32 => {
            // A value already in the target representation needs no coercion,
            // and that is the common case: integer code writing `x | 0` on
            // something already proven an integer.
            if coercion_is_free(func, un, operand) {
                return Ok(format!("{name} = {};", value_name(operand)));
            }

            // An *integer* of some other width is a truncation, which C spells
            // as a cast through the unsigned type of the target — exactly
            // ToInt32's "reduce modulo 2^32, reinterpret signed", and one
            // instruction. Only a genuine double needs the total, wrapping,
            // fmod-based helper, and reaching for it on an `int64_t` operand
            // costs a conversion to double and a library call in the loop body
            // that the whole analysis existed to speed up.
            if matches!(func.values[operand.0 as usize].ty, HirType::Int { .. }) {
                return Ok(match un {
                    UnOp::ToInt32 => {
                        format!("{name} = (int32_t)(uint32_t){};", value_name(operand))
                    }
                    _ => format!("{name} = (uint32_t){};", value_name(operand)),
                });
            }

            let helper = if matches!(un, UnOp::ToInt32) {
                "nts_to_int32"
            } else {
                "nts_to_uint32"
            };
            format!("{name} = {helper}({});", value_name(operand))
        }
    })
}

/// Allocation and field or element access: the operations that go through a
/// managed object's header.
/// Prepare an object that lives in the frame rather than on the heap.
///
/// The storage is a local declared with the others; this fills in what the
/// allocator would have. The descriptor because anything that reads an object
/// reads it there, and the count as `NTS_IMMORTAL` so that a retain or release
/// which somehow reaches a frame object is a no-op rather than `free` on a stack
/// address.
///
/// The reference slots start empty, and that one is load-bearing. A frame slot
/// is reused by every execution of the site that declares it, so on the second
/// pass through a loop it holds the pointers the first pass released -- and the
/// compiler emits a release of each reference field where the object ends.
/// Zeroing is what makes that release read a null rather than a pointer to
/// memory that is gone, on any path where a field was not written.
///
/// None of these stores survive a program that writes every field before reading
/// it, which is every constructor and every object literal; clang removes them
/// along with the object.
fn start_frame_object(
    writer: &mut CodeWriter,
    origin: &Origin,
    name: &str,
    type_name: &str,
    layout: &nts_core::hir::Layout,
) {
    writer.line(
        origin,
        format!("{name}_frame.header.descriptor = &nts_desc_{type_name};"),
    );
    writer.line(
        origin,
        format!("{name}_frame.header.reserved = NTS_IMMORTAL;"),
    );
    for field in layout.reference_fields() {
        // An erased field's zero is `undefined`, and it has to be spelled --
        // the tag is a struct member, not a pointer, so `= 0` is not C. That
        // this *is* the zero is what makes an omitted optional property
        // already correct without a store.
        let zero = layout
            .fields
            .iter()
            .find(|candidate| candidate.name == field)
            .filter(|candidate| candidate.ty == HirType::Erased)
            .map_or("0", |_| "nts_value_of_undefined()");
        writer.line(
            origin,
            format!("{name}_frame.{} = {zero};", c_identifier(field)),
        );
    }
}

/// The two operations `hir::suspend` deals in.
///
/// `Await` never reaches here: the pass rewrites every one away, so arriving
/// with one means an `async` function was transformed by nobody, and there is
/// no C for "stop here and come back later".
fn suspension(op: &nts_core::hir::Op) -> Result<String, Diagnostic> {
    match &op.kind {
        // `drop` is null: the frame is released by the resumption that runs it,
        // and a task the queue discards instead is one the runtime never had --
        // `nts_promise_subscribe` is the only path in, and it either keeps the
        // task or hands it to the microtask queue.
        OpKind::Suspend {
            promise,
            frame,
            resume,
        } => Ok(format!(
            "nts_promise_subscribe({}, (NtsTask){{ (void (*)(void *))&{}, 0, {} }});",
            value_name(*promise),
            crate::c_identifier(resume),
            value_name(*frame)
        )),
        _ => Err(Diagnostic::error(
            "NTS2007",
            "an `await` reached code generation",
            op.origin.location,
        )),
    }
}

fn managed_op(
    writer: &mut CodeWriter,
    func: &Func,
    value: ValueId,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let op = func.value(value);
    let name = value_name(value);
    let text = match &op.kind {
        // One predictable branch. The string is compile-time text and is only
        // touched on the path that ends the program.
        OpKind::CellReady { cell, name } => format!(
            "if (!{}->ready) nts_cell_unready(\"{}\");",
            value_name(*cell),
            name.escape_default()
        ),
        // One instance, emitted once beside its descriptor. No allocation and
        // no reference counting: it is immortal, and there is nothing in it.
        OpKind::ClosureStatic => {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            format!("{name} = &{};", static_closure_name(layout))
        }
        OpKind::ObjectNew { frame } => {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            let type_name = object_type_name(layout);
            if *frame {
                start_frame_object(writer, &op.origin, &name, &type_name, layout);
                format!("{name} = &{name}_frame;")
            } else {
                format!("{name} = ({type_name} *)nts_object_new(&nts_desc_{type_name});")
            }
        }
        OpKind::FieldGet { object, field } => {
            let field = field_of(context.program, func, *object, *field, &op.origin)?;
            format!("{name} = {}->{field};", value_name(*object))
        }
        OpKind::FieldSet {
            object,
            field,
            value: stored,
        } => field_store(func, op, *object, *field, *stored, context)?,
        OpKind::Await { .. } | OpKind::Suspend { .. } => suspension(op)?,
        OpKind::ArrayNew { length, zeroed } => {
            // Two entry points rather than a flag argument, so the branch is
            // taken here rather than once per allocation at run time.
            let allocate = if *zeroed {
                "nts_array_new"
            } else {
                "nts_array_new_uninitialized"
            };
            format!(
                "{name} = {allocate}(&{}, {});",
                element_descriptor(&op.ty, &op.origin)?,
                value_name(*length)
            )
        }
        OpKind::Length(array) => {
            let target = c_type(&op.ty, &op.origin)?;
            // A string *is* a header, so its length is a direct member.
            // Everything else here has one as its first field and reaches
            // through it -- an array because it can grow and a string cannot, a
            // table because it owns three arrays besides.
            let of = if matches!(
                func.values[array.0 as usize].ty,
                HirType::Managed(
                    ManagedType::Array(_) | ManagedType::Map(_, _) | ManagedType::Set(_)
                )
            ) {
                format!("{}->header.length", value_name(*array))
            } else {
                format!("{}->length", value_name(*array))
            };
            format!("{name} = ({target}){of};")
        }
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } => {
            let element = element_type(
                context.program,
                &func.values[array.0 as usize].ty,
                &op.origin,
            )?;
            let slot = index_expression(func, *array, *index, *checked);
            format!(
                "{name} = NTS_ITEMS({}, {element})[{slot}];",
                value_name(*array)
            )
        }
        OpKind::ArraySet {
            array,
            index,
            value: stored,
            checked,
        } => {
            let element = element_type(
                context.program,
                &func.values[array.0 as usize].ty,
                &op.origin,
            )?;
            let slot = index_expression(func, *array, *index, *checked);
            format!(
                "NTS_ITEMS({}, {element})[{slot}] = {};",
                value_name(*array),
                value_name(*stored)
            )
        }
        _ => unreachable!("managed_op is only reached for managed operations"),
    };
    writer.line(&op.origin, text);
    Ok(())
}

fn emit_op(
    writer: &mut CodeWriter,
    func: &Func,
    value: ValueId,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let op = func.value(value);
    let name = value_name(value);
    let text = match &op.kind {
        // Nothing to compute at the definition site. A parameter *is* the C
        // parameter; a block parameter is written by the edges that jump here;
        // a return is spelled by the terminator.
        OpKind::Param(_) | OpKind::BlockParam(_) | OpKind::Return(_) => return Ok(()),
        OpKind::ConstInt(v) => format!("{name} = {};", integer_literal(*v)),
        // A concrete value becomes an erased one, and reading one back. Both
        // are one line and both can fail, so they live together in
        // `erased_conversion` rather than growing this match by twenty.
        OpKind::Erase { .. } | OpKind::Unerase { .. } => {
            erased_conversion(func, op, &name, &op.kind, context)?
        }
        OpKind::TagOf { value: operand } => {
            format!("{name} = nts_value_tag({});", value_name(*operand))
        }
        // The absent reference. Typed, because C distinguishes a null
        // `NtsString *` from a null `NtsObj_Point *` even though the address is
        // the same one.
        // The absent value in an erased slot is a tag, not a null pointer:
        // there is nothing to point at and `undefined` is a kind of value here
        // rather than the absence of one.
        // Erased, the two are different values and carry different tags --
        // which is the whole reason a union holding both cannot be a pointer.
        OpKind::ConstNull if op.ty == HirType::Erased => {
            format!("{name} = nts_value_of_null();")
        }
        OpKind::ConstUndefined if op.ty == HirType::Erased => {
            format!("{name} = nts_value_of_undefined();")
        }
        // As a pointer, they are the same address -- and only one of them can
        // reach a given pointer, because a type holding both is erased instead.
        OpKind::ConstNull | OpKind::ConstUndefined => {
            let ty = c_type_of(context.program, &op.ty, &op.origin)?;
            format!("{name} = ({ty})0;")
        }
        // Enough digits to round-trip an f64 exactly. Fewer would change the
        // program's arithmetic.
        OpKind::ConstFloat(v) => format!("{name} = {};", float_literal(*v)),
        OpKind::StringUnitAt {
            string,
            index,
            checked,
        } => {
            // Proven inside the string, so there is no NaN to produce and no
            // range to test: a load, and the index is already an integer.
            if *checked {
                format!(
                    "{name} = nts_str_char_code_at({}, {});",
                    value_name(*string),
                    value_name(*index)
                )
            } else {
                format!(
                    "{name} = nts_unit({}, (uint32_t){});",
                    value_name(*string),
                    value_name(*index)
                )
            }
        }
        OpKind::GlobalGet(global) => format!("{name} = {};", global_name(context.program, *global)),
        OpKind::GlobalSet { global, value } => format!(
            "{} = {};",
            global_name(context.program, *global),
            value_name(*value)
        ),
        OpKind::ConstBool(v) => format!("{name} = {v};"),
        // A literal is immutable and known now, so it is static data rather
        // than an allocation. This is the difference between a string-heavy
        // program allocating once at startup and allocating in a loop.
        OpKind::ConstString(text) => {
            format!(
                "{name} = (NtsString *)(void *)&{};",
                literal_name(context.literals, text)
            )
        }
        OpKind::Binary { op: bin, lhs, rhs } => binary_text(func, op, &name, *bin, *lhs, *rhs),
        OpKind::Call { callee, args, .. } => {
            call_text(func, &name, value, callee, args, context, &op.origin)?
        }
        OpKind::Unary { op: un, operand } => {
            unary_text(func, &name, *un, *operand, &op.ty, &op.origin)?
        }
        OpKind::ObjectNew { .. }
        | OpKind::ClosureStatic
        | OpKind::CellReady { .. }
        | OpKind::FieldGet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::ArraySet { .. }
        | OpKind::Await { .. }
        | OpKind::Suspend { .. } => {
            return managed_op(writer, func, value, context);
        }
        // An erased value is not a pointer to cast: it is sixteen bytes that
        // hold one only when the tag says so, and the runtime helper is where
        // that question is asked. The compiler emits the same retain and
        // release it would for a reference and lets the tag decide -- which is
        // exactly the branch that specializing a site by its reaching
        // representations would remove.
        OpKind::Retain(object) if func.value(*object).ty == HirType::Erased => {
            format!("nts_value_retain({});", value_name(*object))
        }
        OpKind::Release(object) if func.value(*object).ty == HirType::Erased => {
            format!("nts_value_release({});", value_name(*object))
        }
        OpKind::Retain(object) => {
            format!("nts_retain((NtsHeader *){});", value_name(*object))
        }
        OpKind::Release(object) => {
            format!("nts_release((NtsHeader *){});", value_name(*object))
        }
        OpKind::Convert(operand) => {
            // A C cast. Between an integer and a double this is one instruction,
            // and every one is a place specialization decided two adjacent
            // values should live in different machine types.
            let target = c_type(&op.ty, &op.origin)?;
            format!("{name} = ({target}){};", value_name(*operand))
        }
    };
    writer.line(&op.origin, text);
    Ok(())
}

fn emit_terminator(
    writer: &mut CodeWriter,
    func: &Func,
    block: BlockId,
    next: Option<BlockId>,
    origin: &Origin,
    context: &Context<'_>,
) {
    let record = &func.blocks[block.0 as usize];

    // The copies an edge implies run before control leaves.
    let emit_edge = |writer: &mut CodeWriter, target: BlockId, args: &[ValueId]| {
        let params = &func.blocks[target.0 as usize].params;
        for copy in destruct::edge_copies(params, args) {
            let text = match copy {
                Copy::Move { to, from } => format!(
                    "{} = {}{};",
                    value_name(to),
                    upcast(func, context, &func.value(to).ty, from),
                    value_name(from)
                ),
                Copy::Save { temp, from } => format!("t{temp} = {};", value_name(from)),
                Copy::Restore { to, temp } => format!("{} = t{temp};", value_name(to)),
            };
            writer.line(origin, text);
        }
    };

    match &record.terminator {
        Terminator::Return(Some(value)) => {
            // A derived reference where a base is declared. The layout is base
            // first so the pointer is already right; C wants to be told.
            let cast = upcast(func, context, &func.return_type, *value);
            writer.line(origin, format!("return {cast}{};", value_name(*value)));
        }
        Terminator::Return(None) => writer.line(origin, "return;"),
        Terminator::Unreachable | Terminator::FellThrough => {
            // A claim the compiler made. Saying so lets the C compiler optimize on
            // it, and makes a violated claim a crash rather than a fall-through.
            //
            // The same code for both, and safe for the second only because the
            // verifier has already established that a `FellThrough` block is
            // unreachable. It is what this rendered before that check existed
            // that made the check worth having: a setter with a wrong return
            // type came out as a store followed by this line, which the C
            // compiler read as a licence to compute anything at all.
            writer.line(origin, "__builtin_unreachable();");
        }
        Terminator::Jump { target, args } => {
            emit_edge(writer, *target, args);
            // The block order exists so this is usually free.
            if next != Some(*target) {
                writer.line(origin, format!("goto {};", block_label(*target)));
            }
        }
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => {
            // Each arm's copies belong to that arm, so they are emitted inside it.
            writer.line(origin, format!("if ({}) {{", value_name(*cond)));
            writer.nested(|writer| {
                emit_edge(writer, *then_target, then_args);
                writer.line(origin, format!("goto {};", block_label(*then_target)));
            });
            writer.line(origin, "} else {");
            writer.nested(|writer| {
                emit_edge(writer, *else_target, else_args);
                writer.line(origin, format!("goto {};", block_label(*else_target)));
            });
            writer.line(origin, "}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_c_keyword_is_not_a_usable_function_name() {
        // `function double()` is ordinary TypeScript.
        assert_eq!(c_identifier("double"), "double_");
        assert_eq!(c_identifier("int"), "int_");
        assert_eq!(c_identifier("switch"), "switch_");
        // `main` is not a keyword, but a second definition of it does not link.
        assert_eq!(c_identifier("main"), "main_");
    }

    #[test]
    fn a_name_this_backend_generates_is_also_reserved() {
        // A function called `v0` would shadow the first parameter of every
        // function that calls it.
        assert_eq!(c_identifier("v0"), "v0_");
        assert_eq!(c_identifier("t12"), "t12_");
        assert_eq!(c_identifier("b3"), "b3_");
        // Only the exact generated shape. These are ordinary names.
        assert_eq!(c_identifier("v"), "v");
        assert_eq!(c_identifier("value0"), "value0");
        assert_eq!(c_identifier("b3x"), "b3x");
    }

    #[test]
    fn a_leading_underscore_is_reserved_to_the_implementation() {
        assert_eq!(c_identifier("_internal"), "_internal_");
    }

    #[test]
    fn an_ordinary_name_is_left_alone() {
        // Mangling everything would be simpler and would make every exported
        // symbol worse to link against.
        assert_eq!(c_identifier("compute"), "compute");
        assert_eq!(c_identifier("sumTo"), "sumTo");
    }
}
