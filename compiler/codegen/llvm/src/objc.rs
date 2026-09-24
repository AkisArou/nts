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
    if found.returns_records && !bound(program, "objc_msgSend_stret") {
        let _ = writeln!(text, "declare void @objc_msgSend_stret()");
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
            Passing::Memory { .. } if platform.arch == crate::Arch::X86_64 => ("objc_msgSend_stret", String::new()),
            Passing::Memory { .. } => ("objc_msgSend", String::new()),
            Passing::Registers(_) | Passing::Homogeneous { .. } => ("objc_msgSend", format!("{returned} = ")),
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
        "{prefix}call {}{} ({}) @objc_msgSend({})",
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
        "define internal void @nts_block_dispose(ptr %block) {".to_owned(),
        "  call void @nts_block_on_owner(ptr @nts.block.released)".to_owned(),
        "  %slot = getelementptr inbounds %nts.block, ptr %block, i32 0, i32 5".to_owned(),
        "  %context = load ptr, ptr %slot".to_owned(),
        "  call void @nts_closure_unlend(ptr %context)".to_owned(),
        "  ret void".to_owned(),
        "}".to_owned(),
    ] {
        let _ = writeln!(text, "{line}");
    }
    for signature in signatures {
        adapter(&mut text, signature);
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

/// A native ABI type as an LLVM parameter type, with the extension C gives it.
pub(super) fn abi(ty: &Type) -> String {
    let representation = ty.representation();
    format!("{}{}", extension(&representation), bare(&representation))
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
fn adapter(text: &mut String, signature: &FnPointer) {
    let result = abi(&signature.result);
    let mut parameters = vec!["ptr %block".to_owned()];
    let mut types = Vec::new();
    let mut arguments = Vec::new();
    for (at, ty) in signature.parameters.iter().enumerate() {
        let spelled = abi(ty);
        parameters.push(format!("{spelled} %a{at}"));
        types.push(bare(&ty.representation()).to_owned());
        arguments.push(format!("{spelled} %a{at}"));
    }
    types.push("ptr".to_owned());
    arguments.push("ptr %context".to_owned());
    let _ = writeln!(text, "define internal {result} @{}({}) {{", block_invoke_symbol(signature), parameters.join(", "));
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
        let _ = writeln!(text, "  ret {returned} %r");
    }
    let _ = writeln!(text, "}}");
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
