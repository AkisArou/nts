//! Number endpoints shared by string and array slices.
use wasm_encoder::{BlockType, Function, Instruction as I, ValType};

/// Consume a numeric parameter via `ToIntegerOrInfinity`, optionally relative
/// to the logical length, and clamp to [0, length] before unsigned conversion.
pub(crate) fn clamp(
    f: &mut Function,
    param: u32,
    output: u32,
    relative: bool,
    length: u32,
    scratch: u32,
) {
    f.instruction(&I::LocalGet(param));
    f.instruction(&I::F64Trunc);
    if relative {
        for i in [
            I::LocalTee(scratch),
            I::F64Const(0.0.into()),
            I::F64Lt,
            I::If(BlockType::Result(ValType::F64)),
            I::LocalGet(length),
            I::F64ConvertI32U,
            I::LocalGet(scratch),
            I::F64Add,
            I::Else,
            I::LocalGet(scratch),
            I::End,
        ] {
            f.instruction(&i);
        }
    }
    // Saturation handles NaN -> 0, negative and large infinite endpoints.
    for i in [
        I::I32TruncSatF64U,
        I::LocalTee(output),
        I::LocalGet(length),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::LocalGet(length),
        I::LocalSet(output),
        I::End,
    ] {
        f.instruction(&i);
    }
}
