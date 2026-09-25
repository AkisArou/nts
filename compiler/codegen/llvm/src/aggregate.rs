//! Records passed and returned by value, and erased values past the integer
//! registers: how each crosses a call, by the platform's convention.
//!
//! Three conventions are implemented, all clang's, and `tests/by_value.rs`
//! compares each against `clang -emit-llvm` for its target directly. arm64
//! Windows is none of them, and a record by value there is refused by name
//! rather than lowered by another platform's rules.
//!
//! **AAPCS64** (`AArch64ABIInfo`), Apple's and Linux's arm64, which clang
//! spells alike except for one hint. A register is never counted here: each
//! record crosses as one LLVM value, and LLVM places it.
//!
//! - one to four members of one floating type, and nothing else, is a
//!   *homogeneous floating-point aggregate*, in that many SIMD registers:
//!   `[N x double]` as an argument, `{ double, ... }` as a result. `CGRect`
//!   is four doubles, nested two by two, and crosses in `d0`-`d3`.
//! - otherwise, sixteen bytes or fewer are integer registers: an argument of
//!   eight bytes is an `i64` and of sixteen `[2 x i64]` (`i128` when the
//!   record is aligned to sixteen); a result of up to eight bytes is an
//!   integer of its own width, and of sixteen the same `[2 x i64]`.
//! - over sixteen bytes, a result is written through `sret` (`x8`).
//!
//! Refused by name, each where the spelling above would be wrong rather than
//! merely unbuilt: an argument that is a homogeneous aggregate of `float`s,
//! which Linux aligns to eight on the stack and Apple to four (the one
//! difference, and `Platform` does not say which of the two it is); an
//! argument or result whose size is not one of those above, which the load or
//! store of its integer would run past; and an argument over sixteen bytes,
//! which is a pointer to a copy the caller makes and is not built here.
//!
//! **Win64** (`WinX86_64ABIInfo`) decides by size alone, unions included: a
//! record of 1, 2, 4 or 8 bytes is one integer of that width, as an argument
//! and as a result (`struct { double }` is an `i64`); any other size is a
//! pointer to a copy the caller makes, which is what LLVM makes of `byval`
//! on this target, and an `sret` pointer as a result. The four argument
//! registers are positional, so nothing spills whole: a record or an erased
//! value past the fourth goes on the stack as it would have gone in a register.
//!
//! **System V `x86_64`** (`X86_64ABIInfo`). A union is refused, since clang
//! classifies its eightbytes by rules this does not reproduce:
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
use crate::{Arch, Platform};

/// How one record crosses a call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Passing {
    /// One scalar per eightbyte, in order.
    Registers(Vec<Eightbyte>),
    /// A copy in memory: `byval` as an argument, `sret` as a result.
    Memory { size: u32, align: u32 },
    /// AAPCS64's homogeneous floating-point aggregate: `count` members of one
    /// floating type, `element`, in as many consecutive SIMD registers.
    Homogeneous { element: &'static str, count: u32 },
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
pub(crate) fn plan(leading: usize, parameters: &[Type], result_type: &Type, platform: Platform) -> Option<Plan> {
    if convention(platform) == Some(Convention::Aapcs64) {
        return aapcs64_plan(parameters, result_type, platform);
    }
    let result = match result_type {
        Type::Record(record) => Some(classify(record, platform)?),
        _ => None,
    };
    let Some(convention) = convention(platform) else {
        // arm64 Windows: a scalar or a pointer crosses as itself, whatever
        // the convention. A record or an erased value is placed by rules
        // this backend does not implement there, so the call is refused.
        let placed_by_convention = |ty: &Type| matches!(ty, Type::Record(_)) || ty.representation() == HirType::Erased;
        if parameters.iter().chain(std::iter::once(result_type)).any(placed_by_convention) {
            return None;
        }
        return Some(Plan { arguments: vec![Crossing::Scalar; parameters.len()], result: None });
    };
    if convention == Convention::Win64 {
        let arguments = parameters
            .iter()
            .map(|parameter| match parameter {
                Type::Record(record) => classify(record, platform).map(Crossing::Record),
                // Sixteen bytes: a pointer to a copy, which `byval` is here.
                other if other.representation() == HirType::Erased => Some(Crossing::ErasedInMemory),
                _ => Some(Crossing::Scalar),
            })
            .collect::<Option<Vec<_>>>()?;
        return Some(Plan { arguments, result });
    }
    // A result in memory is written through a pointer the caller passes
    // first, in an integer register.
    let hidden = usize::from(matches!(result, Some(Passing::Memory { .. })));
    let mut integer = INTEGER_REGISTERS.saturating_sub(leading + hidden);
    let mut sse = SSE_REGISTERS;
    let mut arguments = Vec::with_capacity(parameters.len());
    for parameter in parameters {
        let crossing = match parameter {
            Type::Record(record) => match classify(record, platform)? {
                Passing::Registers(eightbytes) => {
                    let wants_sse = eightbytes.iter().filter(|e| e.sse).count();
                    let wants_integer = eightbytes.len() - wants_sse;
                    if wants_integer <= integer && wants_sse <= sse {
                        integer -= wants_integer;
                        sse -= wants_sse;
                        Crossing::Record(Passing::Registers(eightbytes))
                    } else {
                        let (size, align) = extent(record, platform)?;
                        Crossing::Record(Passing::Memory { size, align })
                    }
                }
                // Only AAPCS64 classifies one of these, and it has its own plan.
                other @ (Passing::Memory { .. } | Passing::Homogeneous { .. }) => Crossing::Record(other),
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

/// The calling convention a platform's records cross by, which its data
/// model and its arch decide together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Convention {
    SysV,
    Win64,
    Aapcs64,
}

/// `None` on arm64 Windows, whose convention this backend does not implement.
fn convention(platform: Platform) -> Option<Convention> {
    match (platform.abi, platform.arch) {
        (NativeAbi::SysV, Arch::X86_64) => Some(Convention::SysV),
        (NativeAbi::Win64, Arch::X86_64) => Some(Convention::Win64),
        (NativeAbi::SysV, Arch::Aarch64) => Some(Convention::Aapcs64),
        (NativeAbi::Win64, Arch::Aarch64) => None,
    }
}

/// Which side of a call a record is on: AAPCS64 spells the two differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    Argument,
    Result,
}

/// AAPCS64's plan: each record classified for where it is, and an erased
/// value refused, since no native declaration here passes one.
fn aapcs64_plan(parameters: &[Type], result_type: &Type, platform: Platform) -> Option<Plan> {
    let erased = |ty: &Type| !matches!(ty, Type::Record(_)) && ty.representation() == HirType::Erased;
    if parameters.iter().chain(std::iter::once(result_type)).any(erased) {
        return None;
    }
    let result = match result_type {
        Type::Record(record) => Some(aapcs64(record, platform, Role::Result)?),
        _ => None,
    };
    let arguments = parameters
        .iter()
        .map(|parameter| match parameter {
            Type::Record(record) => aapcs64(record, platform, Role::Argument).map(Crossing::Record),
            _ => Some(Crossing::Scalar),
        })
        .collect::<Option<Vec<_>>>()?;
    Some(Plan { arguments, result })
}

/// One record under AAPCS64, as the module doc sets out.
fn aapcs64(record: &Record, platform: Platform, role: Role) -> Option<Passing> {
    if record.kind == RecordKind::Union {
        return None;
    }
    let (size, align) = extent(record, platform)?;
    let mut leaves = Vec::new();
    if !walk(&Pointee::Record(std::sync::Arc::new(record.clone())), 0, platform, &mut leaves)? {
        return None;
    }
    if let Some(element) = homogeneous(&leaves, size) {
        // Apple and Linux align a `float` aggregate on the stack differently.
        if element == "float" && role == Role::Argument {
            return None;
        }
        return Some(Passing::Homogeneous { element, count: u32::try_from(leaves.len()).ok()? });
    }
    let integer = |ty: String| Some(Passing::Registers(vec![Eightbyte { ty, sse: false }]));
    match (role, size) {
        (_, 16) if align == 16 => integer("i128".to_owned()),
        (_, 16) => integer("[2 x i64]".to_owned()),
        (Role::Argument, 8) => integer("i64".to_owned()),
        (Role::Result, 1..=8) => integer(format!("i{}", size * 8)),
        (Role::Result, 17..) => Some(Passing::Memory { size, align }),
        _ => None,
    }
}

/// The floating type of a homogeneous floating-point aggregate: one to four
/// members, every one a `float` or every one a `double`, packed with nothing
/// between them.
fn homogeneous(leaves: &[Leaf], size: u32) -> Option<&'static str> {
    let first = leaves.first()?;
    let count = u32::try_from(leaves.len()).ok()?;
    let packed = leaves.iter().enumerate().all(|(at, leaf)| {
        leaf.float && leaf.size == first.size && u32::try_from(at).is_ok_and(|at| leaf.offset == at * first.size)
    });
    (packed && (1..=4).contains(&count) && size == first.size * count).then_some(if first.size == 8 { "double" } else { "float" })
}

/// Whether this backend knows how a record or an erased value crosses a call
/// on `platform`.
pub(crate) fn classifies_on(platform: Platform) -> bool {
    convention(platform).is_some()
}

/// How `record` crosses when registers are available. `None` for a record
/// this cannot classify: one on a platform whose convention is not
/// implemented here, a record with no layout, or, under System V, a union or
/// a record whose eightbytes are not ones clang's rules name.
pub(crate) fn classify(record: &Record, platform: Platform) -> Option<Passing> {
    match convention(platform)? {
        Convention::SysV => sysv(record, platform),
        Convention::Win64 => win64(record, platform),
        Convention::Aapcs64 => aapcs64(record, platform, Role::Result),
    }
}

fn win64(record: &Record, platform: Platform) -> Option<Passing> {
    let (size, align) = extent(record, platform)?;
    Some(match size {
        1 | 2 | 4 | 8 => Passing::Registers(vec![Eightbyte { ty: format!("i{}", size * 8), sse: false }]),
        _ => Passing::Memory { size, align },
    })
}

fn sysv(record: &Record, platform: Platform) -> Option<Passing> {
    if record.kind == RecordKind::Union {
        return None;
    }
    let (size, align) = extent(record, platform)?;
    if size > 16 {
        return Some(Passing::Memory { size, align });
    }
    let mut leaves = Vec::new();
    if !walk(&Pointee::Record(std::sync::Arc::new(record.clone())), 0, platform, &mut leaves)? {
        return Some(Passing::Memory { size, align });
    }
    let eightbytes = (0..size.div_ceil(8))
        .map(|chunk| eightbyte(&leaves, chunk * 8, size))
        .collect::<Option<Vec<_>>>()?;
    Some(Passing::Registers(eightbytes))
}

fn extent(record: &Record, platform: Platform) -> Option<(u32, u32)> {
    let placed = native_place(record, platform.abi)?;
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
fn walk(pointee: &Pointee, base: u32, platform: Platform, leaves: &mut Vec<Leaf>) -> Option<bool> {
    match pointee {
        Pointee::Record(record) => {
            let placed = native_place(record, platform.abi)?;
            for (field, offset) in record.fields.iter().zip(&placed.offsets) {
                if !walk(&field.ty, base + offset, platform, leaves)? {
                    return Some(false);
                }
            }
            Some(true)
        }
        Pointee::Array { element, length } => {
            let step = native_shape(element, platform.abi)?.size;
            for at in 0..*length {
                if !walk(element, base + at * step, platform, leaves)? {
                    return Some(false);
                }
            }
            Some(true)
        }
        Pointee::Const(inner) => walk(inner, base, platform, leaves),
        Pointee::Bits { unit, .. } => walk(&Pointee::Scalar(*unit), base, platform, leaves),
        Pointee::Unaligned(_) | Pointee::Flexible(_) | Pointee::Opaque(_) | Pointee::Void => None,
        scalar_or_pointer => {
            let shape = native_shape(scalar_or_pointer, platform.abi)?;
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
        Passing::Homogeneous { element, count } => vec![format!("[{count} x {element}]")],
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
        Passing::Homogeneous { element, count } => format!("{{ {} }}", vec![*element; *count as usize].join(", ")),
    }
}

/// The hidden first parameter of a call whose record result is in memory.
pub(crate) fn sret(passing: &Passing, pointer: &str) -> Option<String> {
    match passing {
        Passing::Memory { size, align } => Some(format!("ptr sret([{size} x i8]) align {align} {pointer}")),
        Passing::Registers(_) | Passing::Homogeneous { .. } => None,
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
        Passing::Homogeneous { .. } => {
            let ty = &parameter_types(passing)[0];
            before.push(format!("{temp}.e0 = load {ty}, ptr {pointer}, align {}", eightbyte_align(align)));
            vec![format!("{ty} {temp}.e0")]
        }
    }
}

/// Store a record result returned in registers, `returned`, into
/// `destination`. Nothing to do for one returned through `sret`.
pub(crate) fn store_result(passing: &Passing, align: u32, returned: &str, destination: &str, before: &mut Vec<String>) {
    if let Passing::Homogeneous { .. } = passing {
        before.push(format!("store {} {returned}, ptr {destination}, align {}", result_type(passing), eightbyte_align(align)));
        return;
    }
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
pub(crate) fn alignment(record: &Record, platform: Platform) -> Option<u32> {
    extent(record, platform).map(|(_, align)| align)
}
