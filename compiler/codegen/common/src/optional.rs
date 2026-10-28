//! The C ABI of the shared optional scalar aggregate. This plan describes the
//! physical pair declared in `nts_runtime.h`, not an emitter-specific return
//! convention. Cross-target clang controls check the register/slot decisions.
use nts_core::hir::{
    HirType, layout,
    native::{NativeAbi, PlatformConvention},
    possibly_undefined::Payload,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Arch {
    X86_64,
    Aarch64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    pub arch: Arch,
    pub abi: NativeAbi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Register {
    Integer(u16),
    Pointer,
    F64,
    Words128,
    Vector128,
}

impl Register {
    #[must_use]
    pub fn llvm(self) -> String {
        match self {
            Self::Integer(bits) => format!("i{bits}"),
            Self::Pointer => "ptr".to_owned(),
            Self::F64 => "double".to_owned(),
            Self::Words128 => "[2 x i64]".to_owned(),
            Self::Vector128 => "<2 x i64>".to_owned(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Passing {
    Registers(Vec<Register>),
    /// The caller provides independent storage for this value. System V
    /// spells an argument byval; Windows and AAPCS64 pass the copy's pointer.
    Indirect {
        size: u32,
        align: u32,
        byval: bool,
    },
}

impl Passing {
    #[must_use]
    pub fn result_type(&self) -> String {
        match self {
            Self::Indirect { .. } => "void".to_owned(),
            Self::Registers(registers) if registers.len() == 1 => registers[0].llvm(),
            Self::Registers(registers) => format!(
                "{{ {} }}",
                registers
                    .iter()
                    .map(|r| r.llvm())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    /// None is an ordinary scalar, including the managed undefined niche.
    pub arguments: Vec<Option<Passing>>,
    pub result: Option<Passing>,
}

fn aggregate(ty: &HirType, target: Target, argument: bool) -> Option<Passing> {
    // Ordinary wide values in a signature containing an optional use their
    // existing C ABI too; the optional cannot shift a neighbour's contract.
    let windows_x64 =
        target.arch == Arch::X86_64 && target.abi.convention == PlatformConvention::Win64;
    if *ty == HirType::Erased {
        return Some(if windows_x64 {
            Passing::Indirect {
                size: 16,
                align: 8,
                byval: false,
            }
        } else if target.arch == Arch::Aarch64 {
            Passing::Registers(vec![Register::Words128])
        } else if argument {
            Passing::Registers(vec![Register::Integer(32), Register::Integer(64)])
        } else {
            return None;
        });
    }
    if *ty == HirType::BigInt && windows_x64 {
        return Some(if argument {
            Passing::Indirect {
                size: 16,
                align: 16,
                byval: false,
            }
        } else {
            Passing::Registers(vec![Register::Vector128])
        });
    }
    let HirType::PossiblyUndefined(payload) = ty else {
        return None;
    };
    let payload = Payload::new((**payload).clone()).ok()?;
    if payload.ty().is_managed() {
        return None;
    }
    let shape = layout::shape_of(ty)?;
    let sysv = target.arch == Arch::X86_64 && target.abi.convention == PlatformConvention::SysV;
    if shape.size > 16 || (target.arch == Arch::X86_64 && !sysv && shape.size > 8) {
        return Some(Passing::Indirect {
            size: shape.size,
            align: shape.align,
            byval: sysv,
        });
    }
    let registers = if shape.size <= 8 {
        vec![Register::Integer(
            if argument && target.arch == Arch::Aarch64 {
                64
            } else {
                u16::try_from(shape.size * 8).ok()?
            },
        )]
    } else if target.arch == Arch::Aarch64 {
        vec![Register::Words128]
    } else {
        vec![
            match payload.ty() {
                HirType::Float { bits: 64 } => Register::F64,
                HirType::NativePointer(_) => Register::Pointer,
                _ => Register::Integer(64),
            },
            Register::Integer(8),
        ]
    };
    Some(Passing::Registers(registers))
}

/// Classify the whole signature together. A mixed System V pair spills as a
/// whole if either register bank cannot hold it; a one-eightbyte aggregate
/// keeps its scalar spelling even after the integer registers are exhausted.
#[must_use]
pub fn plan(parameters: &[HirType], returns: &HirType, target: Target) -> Plan {
    let result = aggregate(returns, target, false);
    let sysv = target.arch == Arch::X86_64 && target.abi.convention == PlatformConvention::SysV;
    let mut integer = 6_usize.saturating_sub(usize::from(
        sysv && matches!(result, Some(Passing::Indirect { .. })),
    ));
    let mut sse = 8_usize;
    let arguments = parameters
        .iter()
        .map(|ty| {
            let mut passing = aggregate(ty, target, true);
            if sysv {
                match &passing {
                    Some(Passing::Registers(registers)) => {
                        let floats = registers
                            .iter()
                            .filter(|r| matches!(r, Register::F64))
                            .count();
                        let words = registers.len() - floats;
                        if registers.len() > 1 && (words > integer || floats > sse) {
                            let shape =
                                layout::shape_of(ty).expect("a classified optional has a shape");
                            passing = Some(Passing::Indirect {
                                size: shape.size,
                                align: shape.align,
                                byval: true,
                            });
                        } else {
                            integer = integer.saturating_sub(words);
                            sse = sse.saturating_sub(floats);
                        }
                    }
                    Some(Passing::Indirect { .. }) => {}
                    None => match ty {
                        HirType::Float { .. } => sse = sse.saturating_sub(1),
                        HirType::BigInt | HirType::Erased => {
                            if integer >= 2 {
                                integer -= 2;
                            }
                        }
                        _ => integer = integer.saturating_sub(1),
                    },
                }
            }
            passing
        })
        .collect();
    Plan { arguments, result }
}
