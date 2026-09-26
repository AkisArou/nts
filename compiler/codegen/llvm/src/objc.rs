//! Objective-C message sends, as LLVM IR. The C backend's `emit/objc.rs` in
//! the other spelling, and the same rules: every send calls `objc_msgSend`
//! with the exact function type spelled at the call site (never variadically),
//! and each selector and class is looked up once, by an `internal` function
//! with its own cached global.

use std::fmt::Write as _;

use nts_codegen_common::objc::{
    block_descriptor_symbol, block_encoding, block_invoke_symbol, block_signatures, class_symbol, lookups,
    selector_symbol,
};
use nts_core::hir::native::{FnPointer, Function, Send, Type};
use nts_core::hir::{Callee, Func, HirType, OpKind, Program, ValueId};
use nts_diagnostics::Diagnostic;

use super::aggregate::{self, Crossing, Passing};
use super::{Platform, extension, name, refuse, ty_of};

/// A C string as an LLVM constant. Selectors and class names are identifier
/// characters and colons only (checked where they are read), so no byte here
/// needs an escape.
fn constant(global: &str, text: &str) -> String {
    format!(
        "{global} = private unnamed_addr constant [{} x i8] c\"{text}\\00\"",
        text.len() + 1
    )
}

/// One cached lookup: `define internal ptr @symbol()` loading `@symbol.cache`,
/// and on the first call asking `lookup(name)` and storing the answer. The
/// symbol is the C backend's, from `nts_codegen_common::objc`.
fn lookup(text: &mut String, symbol: &str, lookup: &str, spelled: &str) {
    let base = format!("@{symbol}");
    let _ = writeln!(text, "{}", constant(&format!("{base}.name"), spelled));
    let _ = writeln!(text, "{base}.cache = internal global ptr null");
    let _ = writeln!(text, "define internal ptr {base}() {{");
    let _ = writeln!(text, "  %cached = load ptr, ptr {base}.cache");
    let _ = writeln!(text, "  %missing = icmp eq ptr %cached, null");
    let _ = writeln!(text, "  br i1 %missing, label %miss, label %hit");
    let _ = writeln!(text, "hit:");
    let _ = writeln!(text, "  ret ptr %cached");
    let _ = writeln!(text, "miss:");
    let _ = writeln!(text, "  %found = call ptr @{lookup}(ptr {base}.name)");
    let _ = writeln!(text, "  store ptr %found, ptr {base}.cache");
    let _ = writeln!(text, "  ret ptr %found");
    let _ = writeln!(text, "}}");
}

/// The runtime declarations and the lookups, when the program sends anything.
pub(super) fn module(program: &Program) -> String {
    let mut text = blocks(program);
    if !program.objc {
        return text;
    }
    let found = lookups(program);
    // Each declared once: a program that binds the runtime's C API itself
    // (`objc:runtime`, to define a class) has declared `sel_registerName`
    // already, and LLVM refuses a second declaration where C accepts it.
    // Required, not `objc_getClass`: a missing class ends the process by
    // name, where nil would answer every message with zero. And
    // `objc_msgSend` with no parameters, as Apple's header does; every call
    // spells the function type it actually makes.
    for (symbol, declaration) in [
        ("sel_registerName", "declare ptr @sel_registerName(ptr)"),
        ("objc_getRequiredClass", "declare ptr @objc_getRequiredClass(ptr)"),
        ("objc_msgSend", "declare void @objc_msgSend()"),
    ] {
        if !bound(program, symbol) {
            let _ = writeln!(text, "{declaration}");
        }
    }
    // A record result in memory comes back through `objc_msgSend_stret` on
    // x86_64; arm64 has none, and an unused declaration costs nothing. See
    // `send`.
    if found.supers {
        for (symbol, declaration) in [
            ("objc_msgSendSuper", "declare void @objc_msgSendSuper()"),
            ("class_getSuperclass", "declare ptr @class_getSuperclass(ptr)"),
        ] {
            if !bound(program, symbol) {
                let _ = writeln!(text, "{declaration}");
            }
        }
    }
    if found.returns_records && !bound(program, "objc_msgSend_stret") {
        let _ = writeln!(text, "declare void @objc_msgSend_stret()");
    }
    if found.returns_records && found.supers && !bound(program, "objc_msgSendSuper_stret") {
        let _ = writeln!(text, "declare void @objc_msgSendSuper_stret()");
    }
    for selector in found.selectors {
        lookup(&mut text, &selector_symbol(selector), "sel_registerName", selector);
    }
    for class in found.classes {
        lookup(&mut text, &class_symbol(class), "objc_getRequiredClass", class);
    }
    text
}

/// `%out = call R (ptr, ptr, A...) @objc_msgSend(ptr %receiver, ptr %sel, A %a...)`.
///
/// A record crosses as `native::call` passes one, with the receiver and the
/// selector counted as the two integer arguments ahead of it. A record result
/// in memory goes through `objc_msgSend_stret`, the `sret` pointer first: on
/// `x86_64` plain `objc_msgSend` would read that pointer as the receiver.
pub(super) fn send(
    func: &Func,
    target: &Function,
    send: &Send,
    args: &[ValueId],
    result: &HirType,
    out: &str,
    platform: Platform,
) -> Result<String, Diagnostic> {
    let instance = send.class.is_none();
    // The selector always; the receiver too when it is a class, which is not
    // among the declared parameters.
    let plan = super::native::plan(func, target, 1 + usize::from(!instance), platform)?;
    if args.len() != target.argument_types().count() || *result != target.call_result() {
        return Err(refuse(func, "an Objective-C message whose HIR disagrees with its declared ABI"));
    }
    let (args, destination) = super::native::split_destination(target, args);
    let mut before = Vec::new();
    let receiver = match &send.class {
        Some(class) => {
            let receiver = format!("{out}.receiver");
            before.push(format!("{receiver} = call ptr @{}()", class_symbol(class)));
            receiver
        }
        None => name(args[0]),
    };
    // `[super m]`: the receiver and the superclass of the program's class, in
    // `struct objc_super`'s two words, and `objc_msgSendSuper` takes it where
    // the receiver goes.
    let (receiver, entry) = match &send.super_of {
        Some(class) => {
            let at = format!("{out}.super");
            before.push(format!("{at} = alloca {{ ptr, ptr }}"));
            before.push(format!("store ptr {receiver}, ptr {at}"));
            before.push(format!("{at}.class = call ptr @{}()", class_symbol(class)));
            before.push(format!("{at}.base = call ptr @class_getSuperclass(ptr {at}.class)"));
            before.push(format!("{at}.slot = getelementptr inbounds {{ ptr, ptr }}, ptr {at}, i32 0, i32 1"));
            before.push(format!("store ptr {at}.base, ptr {at}.slot"));
            (at, "objc_msgSendSuper")
        }
        None => (receiver, "objc_msgSend"),
    };
    let selector = format!("{out}.selector");
    before.push(format!("{selector} = call ptr @{}()", selector_symbol(&send.selector)));
    let mut types = Vec::new();
    let mut values = Vec::new();
    if let (Some(passing), Some(destination)) = (&plan.result, destination)
        && let Some(hidden) = aggregate::sret(passing, &name(destination))
    {
        types.push("ptr".to_owned());
        values.push(hidden);
    }
    types.extend(["ptr".to_owned(), "ptr".to_owned()]);
    values.extend([format!("ptr {receiver}"), format!("ptr {selector}")]);
    let skip = usize::from(instance);
    for (at, arg) in args.iter().enumerate().skip(skip) {
        let ty = &func.values[arg.0 as usize].ty;
        if *ty == HirType::Erased {
            return Err(refuse(func, "an Objective-C message with an erased argument"));
        }
        let temp = format!("{out}.arg{at}");
        if let Crossing::Record(passing) = &plan.arguments[at] {
            let align = super::native::record_alignment(func, target.parameters.get(at), platform)?;
            if let Passing::Memory { .. } = passing {
                types.push("ptr".to_owned());
            } else {
                types.extend(aggregate::parameter_types(passing));
            }
            values.extend(aggregate::load_argument(passing, align, &name(*arg), &temp, &mut before));
        } else {
            types.push(ty_of(ty, func)?.to_owned());
            values.extend(super::arguments(func, &temp, &[*arg], &mut before)?);
        }
    }
    if let (Some(passing), Some(destination)) = (&plan.result, destination) {
        let align = super::native::record_alignment(func, Some(&target.result), platform)?;
        let returned = format!("{out}.returned");
        let (entry, prefix) = match passing {
            // arm64 has no `_stret`: `objc_msgSend` itself takes the `sret`
            // pointer, in `x8`.
            Passing::Memory { .. } if platform.arch == crate::Arch::X86_64 => {
                (if send.super_of.is_some() { "objc_msgSendSuper_stret" } else { "objc_msgSend_stret" }, String::new())
            }
            Passing::Memory { .. } => (entry, String::new()),
            Passing::Registers(_) | Passing::Homogeneous { .. } => (entry, format!("{returned} = ")),
        };
        let spelled = aggregate::result_type(passing);
        before.push(format!(
            "{prefix}call {spelled} ({}) @{entry}({})",
            types.join(", "),
            values.join(", ")
        ));
        aggregate::store_result(passing, align, &returned, &name(destination), &mut before);
        return Ok(before.join("\n"));
    }
    let prefix = if *result == HirType::Void { String::new() } else { format!("{out} = ") };
    before.push(format!(
        "{prefix}call {}{} ({}) @{entry}({})",
        extension(result),
        ty_of(result, func)?,
        types.join(", "),
        values.join(", ")
    ));
    Ok(before.join("\n"))
}

/// Whether the program binds `symbol` as a C function of its own, which the
/// native declarations have already declared.
fn bound(program: &Program, symbol: &str) -> bool {
    program.funcs.iter().flat_map(|func| &func.values).any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::Native(target), .. }
            if target.send.is_none() && target.name == symbol)
    })
}

/// The C backend's `objc::blocks`, in the other spelling: the block layout,
/// the owner-checked copy and dispose helpers, and one invoke adapter and
/// descriptor per signature. See there for why each piece is what it is.
fn blocks(program: &Program) -> String {
    let signatures = block_signatures(program);
    let mut text = String::new();
    // A block returning an object hands it back at +0, as ARC's caller
    // expects: under reference counting the closure returns its own count,
    // which goes to the pool. Without counting it owns nothing to give.
    let counted = program.provider == nts_core::hir::Provider::ReferenceCounting;
    // An entry point of a class the program writes answers an object the
    // same way (`imp` in lib.rs), so the one declaration serves both -- and
    // is made before the return below, since a program can have entry
    // points and no block.
    let entries_return_objects = program
        .foreign_classes
        .iter()
        .flat_map(|class| &class.methods)
        .any(|method| returns_object(&method.signature.result));
    if counted
        && (signatures.iter().any(|signature| returns_object(&signature.result)) || entries_return_objects)
        && !bound(program, "objc_autoreleaseReturnValue")
    {
        let _ = writeln!(text, "declare ptr @objc_autoreleaseReturnValue(ptr)");
    }
    if signatures.is_empty() {
        return text;
    }
    let message = "nts: a block was %s off the thread that owns its closure";
    for line in [
        "%nts.block = type { ptr, i32, i32, ptr, ptr, ptr, ptr }".to_owned(),
        "%nts.block.descriptor = type { i64, i64, ptr, ptr, ptr, ptr }".to_owned(),
        "@_NSConcreteStackBlock = external global [32 x ptr]".to_owned(),
        "declare void @abort()".to_owned(),
        "declare i32 @dprintf(i32, ptr, ...)".to_owned(),
        // The message and its newline (`\0A`), then the terminating NUL.
        format!(
            "@nts.block.message = private unnamed_addr constant [{} x i8] c\"{message}\\0A\\00\"",
            message.len() + 2
        ),
        constant("@nts.block.copied", "copied"),
        constant("@nts.block.released", "released"),
        "define internal void @nts_block_on_owner(ptr %what) {".to_owned(),
        "  %owned = call zeroext i1 @nts_is_owner_thread()".to_owned(),
        "  br i1 %owned, label %fine, label %foreign".to_owned(),
        "fine:".to_owned(),
        "  ret void".to_owned(),
        "foreign:".to_owned(),
        "  %said = call i32 (i32, ptr, ...) @dprintf(i32 2, ptr @nts.block.message, ptr %what)".to_owned(),
        "  call void @abort()".to_owned(),
        "  unreachable".to_owned(),
        "}".to_owned(),
        "define internal void @nts_block_copy(ptr %copy, ptr %block) {".to_owned(),
        "  call void @nts_block_on_owner(ptr @nts.block.copied)".to_owned(),
        "  %slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 5".to_owned(),
        "  %context = load ptr, ptr %slot".to_owned(),
        "  %lent = call ptr @nts_closure_lend(ptr %context)".to_owned(),
        "  ret void".to_owned(),
        "}".to_owned(),
        // A platform lets go of a handler on whatever thread called it; the
        // closure's give-back is carried to the one owning it.
        "define internal void @nts_block_dispose(ptr %block) {".to_owned(),
        "  %slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 5".to_owned(),
        "  %context = load ptr, ptr %slot".to_owned(),
        "  %owned = call zeroext i1 @nts_is_owner_thread()".to_owned(),
        "  br i1 %owned, label %here, label %carry".to_owned(),
        "carry:".to_owned(),
        "  call void @nts_block_unlend(ptr %context)".to_owned(),
        "  ret void".to_owned(),
        "here:".to_owned(),
        "  call void @nts_closure_unlend(ptr %context)".to_owned(),
        "  ret void".to_owned(),
        "}".to_owned(),
    ] {
        let _ = writeln!(text, "{line}");
    }
    for signature in signatures {
        adapter(&mut text, signature, counted);
        let encoding = format!("@{}.signature", block_descriptor_symbol(signature));
        let _ = writeln!(text, "{}", constant(&encoding, &block_encoding(signature)));
        let _ = writeln!(
            text,
            "@{} = internal constant %nts.block.descriptor {{ i64 0, i64 48, ptr @nts_block_copy, ptr @nts_block_dispose, ptr {encoding}, ptr null }}",
            block_descriptor_symbol(signature)
        );
    }
    text
}

/// A native ABI type as an LLVM result type, with the extension C gives it:
/// `zeroext i1`, the attribute before the type, as a result is written.
pub(super) fn abi(ty: &Type) -> String {
    let representation = ty.representation();
    format!("{}{}", extension(&representation), bare(&representation))
}

/// The same as a parameter or an argument: `i1 zeroext`, the attribute after
/// the type. The result's order there is not IR.
pub(super) fn abi_parameter(ty: &Type) -> String {
    let representation = ty.representation();
    format!("{} {}", bare(&representation), extension(&representation)).trim_end().to_owned()
}

pub(super) fn bare(ty: &HirType) -> &'static str {
    match ty {
        HirType::Void => "void",
        HirType::Bool => "i1",
        HirType::Int { bits: 8, .. } => "i8",
        HirType::Int { bits: 16, .. } => "i16",
        HirType::Int { bits: 32, .. } => "i32",
        HirType::Int { .. } => "i64",
        HirType::Float { bits: 32 } => "float",
        HirType::Float { .. } => "double",
        _ => "ptr",
    }
}

/// `R @nts_block_invoke_X(ptr %block, A...)`: the context and the bridge out
/// of the block, then the bridge with the context last.
/// Whether a block's result is an Objective-C object.
pub(super) fn returns_object(result: &Type) -> bool {
    matches!(result, Type::Pointer(nts_core::hir::native::Pointee::Opaque(handle)) if handle.family == nts_core::hir::native::Family::Objc)
}

fn adapter(text: &mut String, signature: &FnPointer, counted: bool) {
    let result = abi(&signature.result);
    let mut parameters = vec!["ptr %block".to_owned()];
    let mut types = Vec::new();
    let mut arguments = Vec::new();
    for (at, ty) in signature.parameters.iter().enumerate() {
        let spelled = abi_parameter(ty);
        parameters.push(format!("{spelled} %a{at}"));
        types.push(bare(&ty.representation()).to_owned());
        arguments.push(format!("{spelled} %a{at}"));
    }
    types.push("ptr".to_owned());
    arguments.push("ptr %context".to_owned());
    // Called off the thread owning the closure: carried there, where `run`
    // unpacks the arguments into the bridge. Not for a record by value,
    // which this adapter passes as its address; that one keeps the owner check.
    let carried = nts_codegen_common::objc::hop_arguments(signature)
        .filter(|_| !signature.parameters.iter().any(|ty| matches!(ty, Type::Record(_))));
    if let Some(carried) = &carried {
        hop(text, signature, carried, &types, &arguments);
    }
    let _ = writeln!(text, "define internal {result} @{}({}) {{", block_invoke_symbol(signature), parameters.join(", "));
    if let Some(carried) = &carried {
        let hop = nts_codegen_common::objc::block_hop_symbol(signature);
        let _ = writeln!(text, "  %owned = call zeroext i1 @nts_is_owner_thread()");
        let _ = writeln!(text, "  br i1 %owned, label %here, label %carry");
        let _ = writeln!(text, "carry:");
        let _ = writeln!(text, "  %h = alloca %{hop}");
        for (at, ty) in signature.parameters.iter().enumerate() {
            let _ = writeln!(text, "  %h{at} = getelementptr inbounds %{hop}, ptr %h, i32 0, i32 {at}");
            let _ = writeln!(text, "  store {} %a{at}, ptr %h{at}", bare(&ty.representation()));
        }
        let _ = writeln!(text, "  %size.at = getelementptr %{hop}, ptr null, i32 1");
        let _ = writeln!(text, "  %size = ptrtoint ptr %size.at to i64");
        let objects = if carried.iter().any(|c| matches!(c, nts_codegen_common::objc::Carried::Counted(_))) {
            format!("@{hop}.objects")
        } else {
            "null".to_owned()
        };
        let count = carried.iter().filter(|c| matches!(c, nts_codegen_common::objc::Carried::Counted(_))).count();
        let _ = writeln!(text, "  call void @nts_block_carry(ptr %block, ptr %h, i64 %size, ptr {objects}, i32 {count}, ptr @{hop}.run)");
        let _ = writeln!(text, "  ret void");
        let _ = writeln!(text, "here:");
    }
    let _ = writeln!(text, "  %context.slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 5");
    let _ = writeln!(text, "  %context = load ptr, ptr %context.slot");
    let _ = writeln!(text, "  %bridge.slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 6");
    let _ = writeln!(text, "  %bridge = load ptr, ptr %bridge.slot");
    let returned = bare(&signature.result.representation());
    if returned == "void" {
        let _ = writeln!(text, "  call void ({}) %bridge({})", types.join(", "), arguments.join(", "));
        let _ = writeln!(text, "  ret void");
    } else {
        let _ = writeln!(text, "  %r = call {result} ({}) %bridge({})", types.join(", "), arguments.join(", "));
        if counted && returns_object(&signature.result) {
            let _ = writeln!(text, "  %given = call ptr @objc_autoreleaseReturnValue(ptr %r)");
            let _ = writeln!(text, "  ret {returned} %given");
        } else {
            let _ = writeln!(text, "  ret {returned} %r");
        }
    }
    let _ = writeln!(text, "}}");
}

/// The carried call of a block signature: the arguments' type, the offsets of
/// the objects in it, and `run`, which unpacks them on the owning thread and
/// calls the bridge -- the C backend's `hop`, in the other spelling.
fn hop(text: &mut String, signature: &FnPointer, carried: &[nts_codegen_common::objc::Carried], types: &[String], arguments: &[String]) {
    let hop = nts_codegen_common::objc::block_hop_symbol(signature);
    let fields: Vec<&str> = signature.parameters.iter().map(|ty| bare(&ty.representation())).collect();
    let _ = writeln!(text, "%{hop} = type {{ {} }}", if fields.is_empty() { "i8".to_owned() } else { fields.join(", ") });
    let offsets: Vec<String> = carried
        .iter()
        .enumerate()
        .filter(|(_, c)| matches!(c, nts_codegen_common::objc::Carried::Counted(_)))
        .map(|(at, _)| format!("i32 ptrtoint (ptr getelementptr (%{hop}, ptr null, i32 0, i32 {at}) to i32)"))
        .collect();
    if !offsets.is_empty() {
        let _ = writeln!(text, "@{hop}.objects = private constant [{} x i32] [{}]", offsets.len(), offsets.join(", "));
    }
    let _ = writeln!(text, "define internal void @{hop}.run(ptr %block, ptr %h) {{");
    for (at, field) in fields.iter().enumerate() {
        let _ = writeln!(text, "  %h{at} = getelementptr inbounds %{hop}, ptr %h, i32 0, i32 {at}");
        let _ = writeln!(text, "  %a{at} = load {field}, ptr %h{at}");
    }
    let _ = writeln!(text, "  %context.slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 5");
    let _ = writeln!(text, "  %context = load ptr, ptr %context.slot");
    let _ = writeln!(text, "  %bridge.slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 6");
    let _ = writeln!(text, "  %bridge = load ptr, ptr %bridge.slot");
    let _ = writeln!(text, "  call void ({}) %bridge({})", types.join(", "), arguments.join(", "));
    let _ = writeln!(text, "  ret void\n}}");
}

/// A `NativeBlock`: its frame slot filled, and the slot's address as the value.
pub(super) fn block(out: &str, invoke: ValueId, context: ValueId, signature: &FnPointer) -> String {
    let slot = format!("{out}.block");
    let field = |at: u32| format!("{out}.f{at} = getelementptr inbounds %nts.block, ptr {slot}, i32 0, i32 {at}");
    [
        field(0),
        format!("store ptr @_NSConcreteStackBlock, ptr {out}.f0"),
        field(1),
        // `BLOCK_HAS_COPY_DISPOSE | BLOCK_HAS_SIGNATURE`; a stack block's
        // reference count bits are zero.
        format!("store i32 {}, ptr {out}.f1", (1u32 << 25) | (1u32 << 30)),
        field(2),
        format!("store i32 0, ptr {out}.f2"),
        field(3),
        format!("store ptr @{}, ptr {out}.f3", block_invoke_symbol(signature)),
        field(4),
        format!("store ptr @{}, ptr {out}.f4", block_descriptor_symbol(signature)),
        field(5),
        format!("store ptr {}, ptr {out}.f5", name(context)),
        field(6),
        format!("store ptr {}, ptr {out}.f6", name(invoke)),
        format!("{out} = getelementptr inbounds %nts.block, ptr {slot}, i32 0"),
    ]
    .join("\n  ")
}
