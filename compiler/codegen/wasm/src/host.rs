//! Captured primitive services which do not raise source exceptions.

use crate::{
    body::Body,
    error::Failure,
    module::{Builder, Func, FuncKey},
    numeric, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ValueId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Shape {
    UnaryNumber,
    BinaryNumber,
    NumberString,
    /// A number formatted with a second number: a radix, or digits.
    NumberNumberString,
    /// A string made from a string: a case mapping.
    StringString,
    /// A string and a number to a string: `repeat`, a relative `at`.
    StringNumberString,
    /// A string searched for a string: a position.
    StringStringNumber,
    /// The same from a position.
    StringStringNumberNumber,
    /// A string tested with a string.
    StringStringBool,
    /// A string tested.
    StringBool,
    /// A string padded to a length with a string.
    StringNumberStringString,
    /// A string with a pattern replaced.
    StringStringStringString,
    ParseFloat,
    /// A string and a number to a number: `parseInt` with its radix, and
    /// `codePointAt`.
    StringNumberNumber,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Service {
    pub(crate) name: &'static str,
    shape: Shape,
}

// One row per admitted primitive. Unknown external names fail closed in Body;
// range-raising formatting and string receivers await the raising adapter.
const SERVICES: &[Service] = &[
    Service {
        name: "nts_math_acos",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_asin",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_atan",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_atan2",
        shape: Shape::BinaryNumber,
    },
    Service {
        name: "nts_math_cbrt",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_cos",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_cosh",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_exp",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_expm1",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_fround",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_hypot",
        shape: Shape::BinaryNumber,
    },
    Service {
        name: "nts_math_imul",
        shape: Shape::BinaryNumber,
    },
    Service {
        name: "nts_math_log",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_log10",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_log1p",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_log2",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_pow",
        shape: Shape::BinaryNumber,
    },
    Service {
        name: "nts_math_sign",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_sin",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_sinh",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_tan",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_math_tanh",
        shape: Shape::UnaryNumber,
    },
    Service {
        name: "nts_number_to_fixed",
        shape: Shape::NumberNumberString,
    },
    Service {
        name: "nts_number_to_string",
        shape: Shape::NumberString,
    },
    Service {
        name: "nts_number_to_string_radix",
        shape: Shape::NumberNumberString,
    },
    Service {
        name: "nts_parse_float",
        shape: Shape::ParseFloat,
    },
    Service {
        name: "nts_parse_int",
        shape: Shape::StringNumberNumber,
    },
    Service {
        name: "nts_str_code_point_at",
        shape: Shape::StringNumberNumber,
    },
    Service {
        name: "nts_str_relative_at",
        shape: Shape::StringNumberString,
    },
    Service {
        name: "nts_str_repeat",
        shape: Shape::StringNumberString,
    },
    Service {
        name: "nts_str_to_lower_case",
        shape: Shape::StringString,
    },
    Service {
        name: "nts_str_to_number",
        shape: Shape::ParseFloat,
    },
    Service {
        name: "nts_str_to_upper_case",
        shape: Shape::StringString,
    },
    Service {
        name: "nts_decode_uri",
        shape: Shape::StringNumberString,
    },
    Service {
        name: "nts_encode_uri",
        shape: Shape::StringNumberString,
    },
    Service {
        name: "nts_str_ends_with",
        shape: Shape::StringStringBool,
    },
    Service {
        name: "nts_str_includes",
        shape: Shape::StringStringBool,
    },
    Service {
        name: "nts_str_index_of",
        shape: Shape::StringStringNumber,
    },
    Service {
        name: "nts_str_index_of_from",
        shape: Shape::StringStringNumberNumber,
    },
    Service {
        name: "nts_str_is_well_formed",
        shape: Shape::StringBool,
    },
    Service {
        name: "nts_str_last_index_of",
        shape: Shape::StringStringNumber,
    },
    Service {
        name: "nts_str_pad_end",
        shape: Shape::StringNumberStringString,
    },
    Service {
        name: "nts_str_pad_start",
        shape: Shape::StringNumberStringString,
    },
    Service {
        name: "nts_str_point_width",
        shape: Shape::StringNumberNumber,
    },
    Service {
        name: "nts_str_replace",
        shape: Shape::StringStringStringString,
    },
    Service {
        name: "nts_str_replace_all",
        shape: Shape::StringStringStringString,
    },
    Service {
        name: "nts_str_starts_with",
        shape: Shape::StringStringBool,
    },
    Service {
        name: "nts_str_to_well_formed",
        shape: Shape::StringString,
    },
    Service {
        name: "nts_str_trim",
        shape: Shape::StringString,
    },
    Service {
        name: "nts_str_trim_end",
        shape: Shape::StringString,
    },
    Service {
        name: "nts_str_trim_start",
        shape: Shape::StringString,
    },
    Service {
        name: "nts_string_from_code_point",
        shape: Shape::NumberString,
    },
];

pub(crate) fn external(name: &str) -> Option<&'static Service> {
    SERVICES.iter().find(|service| service.name == name)
}

impl Service {
    pub(crate) fn signature(self) -> (Vec<Physical>, Physical) {
        let number = Physical::Scalar(Slot::F64);
        let boolean = Physical::Scalar(Slot::I32);
        match self.shape {
            Shape::UnaryNumber => (vec![number], number),
            Shape::BinaryNumber => (vec![number, number], number),
            Shape::NumberString => (vec![number], strings::STRING),
            Shape::NumberNumberString => (vec![number, number], strings::STRING),
            Shape::StringString => (vec![strings::STRING], strings::STRING),
            Shape::StringNumberString => (vec![strings::STRING, number], strings::STRING),
            Shape::StringStringNumber => (vec![strings::STRING, strings::STRING], number),
            Shape::StringStringNumberNumber => {
                (vec![strings::STRING, strings::STRING, number], number)
            }
            Shape::StringStringBool => (vec![strings::STRING, strings::STRING], boolean),
            Shape::StringBool => (vec![strings::STRING], boolean),
            Shape::StringNumberStringString => (
                vec![strings::STRING, number, strings::STRING],
                strings::STRING,
            ),
            Shape::StringStringStringString => (
                vec![strings::STRING, strings::STRING, strings::STRING],
                strings::STRING,
            ),
            Shape::ParseFloat => (vec![strings::STRING], number),
            Shape::StringNumberNumber => (vec![strings::STRING, number], number),
        }
    }
    /// The host's import of this service.
    pub(crate) fn callee(self, m: &mut Builder<'_>) -> Func {
        let (params, output) = self.signature();
        m.import(
            FuncKey::Host(self.name),
            "nts:host/v1",
            self.name,
            params,
            Some(output),
            false,
        )
    }
    pub(crate) fn call(
        self,
        body: &mut Body<'_, '_>,
        result: ValueId,
        args: &[ValueId],
    ) -> Result<(), Failure> {
        let (params, output) = self.signature();
        if params.len() != args.len() {
            return Err(format!("host primitive `{}` arity mismatch", self.name).into());
        }
        let callee = self.callee(body.m);
        for (&arg, slot) in args.iter().zip(params) {
            body.load(arg)?;
            match slot {
                Physical::Scalar(Slot::F64) => {
                    numeric::convert(body, &body.ty(arg).clone(), &HirType::NUMBER)?;
                }
                strings::STRING if strings::is_string(body.ty(arg)) => {}
                _ => {
                    return Err(
                        format!("host primitive `{}` input {:?}", self.name, body.ty(arg)).into(),
                    );
                }
            }
        }
        body.call(callee);
        match output {
            Physical::Scalar(Slot::F64) => {
                numeric::convert(body, &HirType::NUMBER, &body.ty(result).clone())
            }
            Physical::Scalar(Slot::I32) => {
                numeric::convert(body, &HirType::Bool, &body.ty(result).clone())
            }
            strings::STRING if strings::is_string(body.ty(result)) => Ok(()),
            _ => Err(format!(
                "host primitive `{}` output {:?}",
                self.name,
                body.ty(result)
            )
            .into()),
        }
    }
}
