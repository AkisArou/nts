//! Records passed and returned by value, as AMD64 System V passes them.
//!
//! This backend's native calls follow that ABI and no other: `native.rs`'s
//! rule for an erased value in registers is the same assumption. Under Win64
//! a record by value is refused by name, and so is a union, whose eightbytes
//! clang classifies by rules this does not reproduce.
//!
//! The rules are clang's (`X86_64ABIInfo`), which the tests in
//! `tests/by_value.rs` compare against `clang -emit-llvm` directly:
//!
//! - over 16 bytes, or holding a misaligned member: **memory**, a `byval`
//!   copy as an argument and an `sret` pointer as a result;
//! - otherwise each eightbyte is **SSE** when everything in it is a `float`
//!   or a `double`, and **INTEGER** otherwise, and is passed as one scalar:
//!   `double`, `<2 x float>` or `float` for SSE, and for INTEGER the member at
//!   its start when the rest of it is padding, else as many bytes as the
//!   record still has, up to eight;
//! - a record whose eightbytes do not all fit in the registers left goes to
//!   memory whole, as an erased value does.

use nts_core::hir::layout::{native_place, native_shape};
use nts_core::hir::native::{NativeAbi, Pointee, Record, RecordKind, Scalar, Type};
use nts_core::hir::HirType;

/// How one record crosses a call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Passing {
    /// One scalar per eightbyte, in order.
    Registers(Vec<Eightbyte>),
    /// A copy in memory: `byval` as an argument, `sret` as a result.
    Memory { size: u32, align: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Eightbyte {
    /// The LLVM type it is passed as.
    pub ty: String,
    /// Whether it takes an SSE register rather than an integer one.
    pub sse: bool,
}

/// How each argument of a call crosses, in order, and how the result does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Plan {
    pub arguments: Vec<Crossing>,
    /// `Some` exactly when the result is a record.
    pub result: Option<Passing>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Crossing {
    /// Anything that is not a record, spelled by its own rules.
    Scalar,
    /// An erased value that no longer fits in the integer registers left.
    ErasedInMemory,
    Record(Passing),
}

const INTEGER_REGISTERS: usize = 6;
const SSE_REGISTERS: usize = 8;

/// The plan for a call whose first `leading` integer arguments are implicit --
/// an Objective-C send's receiver and selector -- and whose declared
/// parameters and result are these. `None` when a record in it cannot be
/// classified here.
pub(crate) fn plan(leading: usize, parameters: &[Type], result: &Type, abi: NativeAbi) -> Option<Plan> {
    let result = match result {
        Type::Record(record) => Some(classify(record, abi)?),
        _ => None,
    };
    // A result in memory is written through a pointer the caller passes
    // first, in an integer register.
    let hidden = usize::from(matches!(result, Some(Passing::Memory { .. })));
    let mut integer = INTEGER_REGISTERS.saturating_sub(leading + hidden);
    let mut sse = SSE_REGISTERS;
    let mut arguments = Vec::with_capacity(parameters.len());
    for parameter in parameters {
        let crossing = match parameter {
            Type::Record(record) => match classify(record, abi)? {
                Passing::Registers(eightbytes) => {
                    let wants_sse = eightbytes.iter().filter(|e| e.sse).count();
                    let wants_integer = eightbytes.len() - wants_sse;
                    if wants_integer <= integer && wants_sse <= sse {
                        integer -= wants_integer;
                        sse -= wants_sse;
                        Crossing::Record(Passing::Registers(eightbytes))
                    } else {
                        let (size, align) = extent(record, abi)?;
                        Crossing::Record(Passing::Memory { size, align })
                    }
                }
                memory @ Passing::Memory { .. } => Crossing::Record(memory),
            },
            other => {
                let ty = other.representation();
                let words = match ty {
                    HirType::Erased | HirType::BigInt => 2,
                    HirType::Float { .. } | HirType::Void => 0,
                    _ => 1,
                };
                if matches!(ty, HirType::Float { .. }) {
                    sse = sse.saturating_sub(1);
                }
                let memory = ty == HirType::Erased && integer < words;
                if integer >= words {
                    integer -= words;
                }
                if memory { Crossing::ErasedInMemory } else { Crossing::Scalar }
            }
        };
        arguments.push(crossing);
    }
    Some(Plan { arguments, result })
}

/// How `record` crosses when registers are available. `None` for a record
/// this cannot classify: a union, a record with no layout on `abi`, or one
/// whose eightbytes are not ones clang's rules name.
pub(crate) fn classify(record: &Record, abi: NativeAbi) -> Option<Passing> {
    if abi != NativeAbi::SysV || record.kind == RecordKind::Union {
        return None;
    }
    let (size, align) = extent(record, abi)?;
    if size > 16 {
        return Some(Passing::Memory { size, align });
    }
    let mut leaves = Vec::new();
    if !walk(&Pointee::Record(std::sync::Arc::new(record.clone())), 0, abi, &mut leaves)? {
        return Some(Passing::Memory { size, align });
    }
    let eightbytes = (0..size.div_ceil(8))
        .map(|chunk| eightbyte(&leaves, chunk * 8, size))
        .collect::<Option<Vec<_>>>()?;
    Some(Passing::Registers(eightbytes))
}

fn extent(record: &Record, abi: NativeAbi) -> Option<(u32, u32)> {
    let placed = native_place(record, abi)?;
    Some((placed.size, placed.align))
}

/// One scalar member: where it starts, how wide it is, and whether it is
/// floating point.
#[derive(Debug, Clone, Copy)]
struct Leaf {
    offset: u32,
    size: u32,
    float: bool,
}

/// Every scalar in `pointee`, at its offset from `base`. `Some(false)` when a
/// member is misaligned, which puts the whole record in memory.
fn walk(pointee: &Pointee, base: u32, abi: NativeAbi, leaves: &mut Vec<Leaf>) -> Option<bool> {
    match pointee {
        Pointee::Record(record) => {
            let placed = native_place(record, abi)?;
            for (field, offset) in record.fields.iter().zip(&placed.offsets) {
                if !walk(&field.ty, base + offset, abi, leaves)? {
                    return Some(false);
                }
            }
            Some(true)
        }
        Pointee::Array { element, length } => {
            let step = native_shape(element, abi)?.size;
            for at in 0..*length {
                if !walk(element, base + at * step, abi, leaves)? {
                    return Some(false);
                }
            }
            Some(true)
        }
        Pointee::Const(inner) => walk(inner, base, abi, leaves),
        Pointee::Bits { unit, .. } => walk(&Pointee::Scalar(*unit), base, abi, leaves),
        Pointee::Unaligned(_) | Pointee::Flexible(_) | Pointee::Opaque(_) | Pointee::Void => None,
        scalar_or_pointer => {
            let shape = native_shape(scalar_or_pointer, abi)?;
            if shape.align == 0 || !base.is_multiple_of(shape.align) {
                return Some(false);
            }
            let float = matches!(scalar_or_pointer, Pointee::Scalar(Scalar::Float | Scalar::Double));
            leaves.push(Leaf { offset: base, size: shape.size, float });
            Some(true)
        }
    }
}

/// The eightbyte at `start` of a record `size` bytes long.
fn eightbyte(leaves: &[Leaf], start: u32, size: u32) -> Option<Eightbyte> {
    let end = start + 8;
    let inside: Vec<&Leaf> = leaves.iter().filter(|leaf| leaf.offset >= start && leaf.offset < end).collect();
    if inside.is_empty() || inside.iter().any(|leaf| leaf.offset + leaf.size > end) {
        return None;
    }
    if inside.iter().all(|leaf| leaf.float) {
        let at = |offset: u32| inside.iter().find(|leaf| leaf.offset == start + offset);
        let ty = match (at(0), at(4)) {
            (Some(first), None) if first.size == 8 => "double",
            (Some(first), None) if first.size == 4 && inside.len() == 1 => "float",
            (Some(first), Some(second)) if first.size == 4 && second.size == 4 => "<2 x float>",
            _ => return None,
        };
        return Some(Eightbyte { ty: ty.to_owned(), sse: true });
    }
    // INTEGER: the member at the start when nothing else is in the eightbyte,
    // which clang keeps at its own width; otherwise the bytes the record still
    // has here.
    let first = inside.iter().find(|leaf| leaf.offset == start)?;
    let bytes = if inside.len() == 1 && !first.float { first.size } else { (size - start).min(8) };
    Some(Eightbyte { ty: format!("i{}", bytes * 8), sse: false })
}

/// The parameter spelling of one record argument, as a declaration writes it.
pub(crate) fn parameter_types(passing: &Passing) -> Vec<String> {
    match passing {
        Passing::Registers(eightbytes) => eightbytes.iter().map(|e| e.ty.clone()).collect(),
        Passing::Memory { size, align } => vec![format!("ptr byval([{size} x i8]) align {align}")],
    }
}

/// The return type a record result is declared with: its eightbytes, or
/// `void` when it is written through an `sret` pointer.
pub(crate) fn result_type(passing: &Passing) -> String {
    match passing {
        Passing::Registers(eightbytes) if eightbytes.len() == 1 => eightbytes[0].ty.clone(),
        Passing::Registers(eightbytes) => {
            format!("{{ {} }}", eightbytes.iter().map(|e| e.ty.as_str()).collect::<Vec<_>>().join(", "))
        }
        Passing::Memory { .. } => "void".to_owned(),
    }
}

/// The hidden first parameter of a call whose record result is in memory.
pub(crate) fn sret(passing: &Passing, pointer: &str) -> Option<String> {
    match passing {
        Passing::Memory { size, align } => Some(format!("ptr sret([{size} x i8]) align {align} {pointer}")),
        Passing::Registers(_) => None,
    }
}

/// The alignment an eightbyte of a record aligned to `align` can promise: the
/// record's own for the first, and at most eight for the second.
fn eightbyte_align(align: u32) -> u32 {
    align.min(8)
}

/// The argument list entries for a record read from `pointer`: each eightbyte
/// loaded, or the pointer itself passed `byval`.
pub(crate) fn load_argument(passing: &Passing, align: u32, pointer: &str, temp: &str, before: &mut Vec<String>) -> Vec<String> {
    match passing {
        Passing::Registers(eightbytes) => eightbytes
            .iter()
            .enumerate()
            .map(|(at, eightbyte)| {
                let address = if at == 0 {
                    pointer.to_owned()
                } else {
                    before.push(format!("{temp}.e{at}.at = getelementptr inbounds i8, ptr {pointer}, i64 {}", at * 8));
                    format!("{temp}.e{at}.at")
                };
                before.push(format!(
                    "{temp}.e{at} = load {}, ptr {address}, align {}",
                    eightbyte.ty,
                    eightbyte_align(align)
                ));
                format!("{} {temp}.e{at}", eightbyte.ty)
            })
            .collect(),
        Passing::Memory { .. } => vec![format!("{} {pointer}", parameter_types(passing)[0])],
    }
}

/// Store a record result returned in registers, `returned`, into
/// `destination`. Nothing to do for one returned through `sret`.
pub(crate) fn store_result(passing: &Passing, align: u32, returned: &str, destination: &str, before: &mut Vec<String>) {
    let Passing::Registers(eightbytes) = passing else { return };
    for (at, eightbyte) in eightbytes.iter().enumerate() {
        let value = if eightbytes.len() == 1 {
            returned.to_owned()
        } else {
            before.push(format!("{returned}.e{at} = extractvalue {} {returned}, {at}", result_type(passing)));
            format!("{returned}.e{at}")
        };
        let address = if at == 0 {
            destination.to_owned()
        } else {
            before.push(format!("{returned}.e{at}.at = getelementptr inbounds i8, ptr {destination}, i64 {}", at * 8));
            format!("{returned}.e{at}.at")
        };
        before.push(format!("store {} {value}, ptr {address}, align {}", eightbyte.ty, eightbyte_align(align)));
    }
}

/// The alignment of a record's storage, which the loads and stores above may
/// assume of the pointer they are handed.
pub(crate) fn alignment(record: &Record, abi: NativeAbi) -> Option<u32> {
    extent(record, abi).map(|(_, align)| align)
}
