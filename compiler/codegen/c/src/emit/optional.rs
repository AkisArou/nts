//! The coupled optional value. Native scalar pairs use their ordinary C ABI;
//! references use the immortal undefined niche, preserving a defined null.
use super::{Context, Diagnostic, Func, HirType, OpKind, ValueId, c_type_of, value_name};

pub(super) fn operation(
    func: &Func,
    id: ValueId,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let op = func.value(id);
    let name = value_name(id);
    let source = match op.kind {
        OpKind::OptionalDefined(source) | OpKind::OptionalPayload(source) => source,
        _ => id,
    };
    let HirType::PossiblyUndefined(payload_type) = &func.value(source).ty else {
        return Err(Diagnostic::error(
            "NTS2006",
            "an optional operation without its coupled type",
            op.origin.location,
        ));
    };
    let reference = payload_type.is_managed();
    let held = value_name(source);
    Ok(match op.kind {
        OpKind::Optional { defined, payload } if reference => format!(
            "{name} = {} ? (NtsHeader *){} : NTS_UNDEFINED_REFERENCE;",
            value_name(defined),
            value_name(payload)
        ),
        OpKind::Optional { defined, payload } => {
            let ty = c_type_of(context.program, &op.ty, &op.origin)?;
            let cast = if matches!(**payload_type, HirType::NativePointer(_)) {
                "(void *)"
            } else {
                ""
            };
            format!(
                "{name} = ({ty}){{ .payload = {cast}{}, .defined = {} }};",
                value_name(payload),
                value_name(defined)
            )
        }
        OpKind::OptionalDefined(_) if reference => {
            format!("{name} = {held} != NTS_UNDEFINED_REFERENCE;")
        }
        OpKind::OptionalDefined(_) => format!("{name} = {held}.defined;"),
        OpKind::OptionalPayload(_) => {
            let ty = c_type_of(context.program, payload_type, &op.origin)?;
            if reference {
                format!("{name} = ({ty}){held};")
            } else {
                format!("{name} = ({ty}){held}.payload;")
            }
        }
        OpKind::ConstUndefined if reference => format!("{name} = NTS_UNDEFINED_REFERENCE;"),
        OpKind::ConstUndefined => {
            let ty = c_type_of(context.program, &op.ty, &op.origin)?;
            format!("{name} = ({ty}){{0}};")
        }
        _ => {
            return Err(Diagnostic::error(
                "NTS2006",
                "an unsupported optional operation",
                op.origin.location,
            ));
        }
    })
}
