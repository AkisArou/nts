//! Captured primitive services which do not raise source exceptions.

use crate::{
    body::Body,
    error::Failure,
    module::FuncKey,
    numeric, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ValueId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Shape {
    UnaryNumber,
    BinaryNumber,
    NumberString,
    ParseFloat,
    ParseInt,
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
        name: "nts_number_to_string",
        shape: Shape::NumberString,
    },
    Service {
        name: "nts_parse_float",
        shape: Shape::ParseFloat,
    },
    Service {
        name: "nts_parse_int",
        shape: Shape::ParseInt,
    },
];

pub(crate) fn external(name: &str) -> Option<&'static Service> {
    SERVICES.iter().find(|service| service.name == name)
}

impl Service {
    pub(crate) fn signature(self) -> (Vec<Physical>, Physical) {
        let number = Physical::Scalar(Slot::F64);
        match self.shape {
            Shape::UnaryNumber => (vec![number], number),
            Shape::BinaryNumber => (vec![number, number], number),
            Shape::NumberString => (vec![number], strings::STRING),
            Shape::ParseFloat => (vec![strings::STRING], number),
            Shape::ParseInt => (vec![strings::STRING, number], number),
        }
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
        let callee = body.m.import(
            FuncKey::Host(self.name),
            "nts:host/v1",
            self.name,
            params.clone(),
            Some(output),
            false,
        );
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
