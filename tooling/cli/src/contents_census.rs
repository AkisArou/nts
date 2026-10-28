//! Observation of production content proofs, not a typed-storage selector.

use anyhow::{Result, bail};
use camino::Utf8Path;
use nts_core::hir::contents::{
    FunctionFacts, Inspection, RecognizedWrite, RejectedUse, Tags, Unknown, ValueFact,
};
use nts_core::hir::{self, Callee, Func, OpKind, ValueId};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

pub(super) fn command(config: &Utf8Path) -> Result<()> {
    if !super::rc_requested() {
        bail!("contents-census requires --rc: content cleanup uses the RC preparation");
    }
    let mut frontend = super::frontend_for(config)?;
    let snapshot = super::capture_project(&mut frontend, config)?;
    super::emission::snapshot_diagnostics(&snapshot, &mut super::emission::Report::live())?;
    let (preparation, prepared, invalid) = super::prepare_for_listing(config, &snapshot)?;
    if let Some(invalid) = invalid {
        bail!("the prepared program does not verify:\n{invalid}");
    }
    println!("{}", report(&prepared, &preparation));
    Ok(())
}

fn report(prepared: &hir::Prepared, preparation: &str) -> Value {
    let mut rows = Vec::new();
    let mut visits = 0;
    let mut exhausted = 0;
    for (function_index, func) in prepared.program.funcs.iter().enumerate() {
        let roots: Vec<_> = func
            .blocks
            .iter()
            .flat_map(|b| &b.ops)
            .filter_map(|&id| match &func.value(id).kind {
                OpKind::Call {
                    callee: Callee::External(name),
                    ..
                } if matches!(
                    name.as_str(),
                    "nts_map_new" | "nts_set_new" | "nts_table_new" | "nts_map_copy"
                ) =>
                {
                    Some((id, name))
                }
                _ => None,
            })
            .collect();
        if roots.is_empty() {
            continue;
        }
        let inspection = FunctionFacts::inspect(func);
        visits += inspection.facts.visits;
        exhausted += inspection.facts.budget_exhaustions;
        let mut indexed = index(&inspection);
        rows.extend(roots.into_iter().map(|(id, name)| {
            allocation(
                function_index,
                func,
                id,
                name,
                &inspection.facts,
                &indexed.remove(&id).unwrap_or_default(),
            )
        }));
    }
    json!({
        "schema": 1,
        "state": "PASS",
        "preparation": preparation,
        "unit": "prepared allocation identities, including named clones",
        "scope": "current-provider value eligibility, not selected or emitted typed storage; unsupported slot or payload proofs remain explicit",
        "functions": prepared.program.funcs.len(),
        "pruned_functions": prepared.pruned,
        "uncompiled_functions": prepared.program.uncompiled.len(),
        "diagnostics": prepared.diagnostics.iter().map(|d| format!("{d:?}")).collect::<Vec<_>>(),
        "provider_visits": visits,
        "budget_exhaustions": exhausted,
        "rows": rows,
    })
}

#[derive(Default)]
struct Observations<'a> {
    fact: Option<ValueFact>,
    rejected: Vec<&'a RejectedUse>,
    writes: Vec<&'a RecognizedWrite>,
}

fn index(inspection: &Inspection) -> FxHashMap<ValueId, Observations<'_>> {
    let mut indexed: FxHashMap<_, Observations<'_>> = FxHashMap::default();
    for container in &inspection.facts.containers {
        indexed.entry(container.value).or_default().fact = Some(container.contents);
    }
    for rejected in &inspection.rejected {
        indexed
            .entry(rejected.root)
            .or_default()
            .rejected
            .push(rejected);
    }
    for write in &inspection.writes {
        indexed.entry(write.root).or_default().writes.push(write);
    }
    indexed
}

fn allocation(
    function_index: usize,
    func: &Func,
    id: ValueId,
    constructor: &str,
    facts: &FunctionFacts,
    observations: &Observations<'_>,
) -> Value {
    let fact = observations.fact;
    let (value, reason) = fact.map_or_else(
        || {
            (
                "Dynamic",
                if facts.budget_exhaustions > 0 {
                    Unknown::Budget.reason()
                } else {
                    "allocation kind unsupported by current provider"
                },
            )
        },
        eligibility,
    );
    let rejected: Vec<_> = observations.rejected.iter().map(|r| {
        let (category, helper, kind) = r.operation.map_or_else(
            || ("return".to_owned(), None, "Return".to_owned()),
            |op| {
                let kind = &func.value(op).kind;
                let (category, helper) = match kind {
                    OpKind::Length(_) => ("length".to_owned(), None),
                    OpKind::Call { callee: Callee::External(name), .. } => ("external".to_owned(), Some(name.as_str())),
                    OpKind::Call { .. } => ("call".to_owned(), None),
                    _ => ("operation".to_owned(), None),
                };
                (category, helper, format!("{kind:?}"))
            },
        );
        json!({"category": category, "helper": helper, "operation": r.operation.map(|v| v.0),
            "operand": r.operand.0, "argument": r.argument, "reason": r.reason.reason(), "kind": kind})
    }).collect();
    let writes: Vec<_> = observations
        .writes
        .iter()
        .map(|w| json!({"value": w.value.0, "fact": fact_json(facts.value(w.value))}))
        .collect();
    json!({"function": func.name, "function_index": function_index, "value": id.0, "constructor": constructor,
        "origin": format!("{:?}", func.value(id).origin),
        "value_eligibility": value, "reason": reason,
        "fact": fact.map(fact_json),
        "key_eligibility": "Dynamic", "key_reason": "per-identity key summary unprovided",
        "inspection_complete": facts.budget_exhaustions == 0,
        "rejected_uses": rejected,
        // Recognized writes can be incomplete even without budget exhaustion.
        // They are diagnostic witnesses, never an alternative content proof.
        "recognized_writes": writes})
}

fn eligibility(fact: ValueFact) -> (&'static str, &'static str) {
    let ValueFact::Known { tags, numbers } = fact else {
        let ValueFact::Unknown(reason) = fact else {
            unreachable!()
        };
        return ("Dynamic", reason.reason());
    };
    let optional = tags.contains(Tags::UNDEFINED);
    if tags == Tags::STRING || tags == Tags::STRING.union(Tags::UNDEFINED) {
        return (
            if optional {
                "Optional<String>"
            } else {
                "String"
            },
            "closed string payload",
        );
    }
    if tags == Tags::NUMBER || tags == Tags::NUMBER.union(Tags::UNDEFINED) {
        // Values preserve observable -0. A truncating accumulator's looser
        // zero policy cannot license an int32 storage column.
        let int32 = numbers.integral()
            && !numbers.maybe_negative_zero
            && numbers.lo >= f64::from(i32::MIN)
            && numbers.hi <= f64::from(i32::MAX);
        return (
            match (int32, optional) {
                (true, false) => "I32",
                (true, true) => "Optional<I32>",
                (false, false) => "F64",
                (false, true) => "Optional<F64>",
            },
            "closed numeric payload",
        );
    }
    if tags == Tags::BOOLEAN || tags == Tags::BOOLEAN.union(Tags::UNDEFINED) {
        return (
            if optional { "Optional<Bool>" } else { "Bool" },
            "closed boolean payload",
        );
    }
    if tags == Tags::NULL {
        return ("Unit<null>", "closed singleton payload");
    }
    if tags == Tags::UNDEFINED {
        return ("Unit<undefined>", "closed singleton payload");
    }
    if tags == Tags::NUMBER.without(Tags::NUMBER) {
        return ("Empty", "no stored payload");
    }
    if tags.intersects(Tags::REFERENCE)
        && !tags.contains(Tags::NUMBER)
        && !tags.contains(Tags::BOOLEAN)
    {
        return ("Dynamic", "precise managed payload layout unprovided");
    }
    ("Dynamic", "heterogeneous possible payload tags")
}

fn fact_json(fact: ValueFact) -> Value {
    match fact {
        ValueFact::Unknown(reason) => json!({"unknown": reason.reason()}),
        ValueFact::Known { tags, numbers } => {
            let names: Vec<_> = tags.names().collect();
            // String endpoints retain infinities rather than serializing them
            // as JSON null. Numeric facts never stand apart from possible tags.
            json!({"tags": names, "numbers": {"lo": numbers.lo.to_string(), "hi": numbers.hi.to_string(),
                "whole": numbers.whole, "maybe_nan": numbers.maybe_nan, "maybe_negative_zero": numbers.maybe_negative_zero}})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_core::hir::facts::Facts;

    #[test]
    fn value_storage_requires_all_tags_and_preserves_negative_zero() {
        let numbers = Facts {
            lo: -3.0,
            hi: 7.0,
            whole: true,
            maybe_nan: false,
            maybe_negative_zero: false,
        };
        let known = |tags, numbers| ValueFact::Known { tags, numbers };
        assert_eq!(eligibility(known(Tags::STRING, Facts::BOTTOM)).0, "String");
        assert_eq!(
            eligibility(known(Tags::STRING.union(Tags::UNDEFINED), Facts::BOTTOM)).0,
            "Optional<String>"
        );
        assert_eq!(
            eligibility(known(Tags::REFERENCE, Facts::BOTTOM)).0,
            "Dynamic"
        );
        assert_eq!(eligibility(known(Tags::NUMBER, numbers)).0, "I32");
        assert_eq!(
            eligibility(known(Tags::NUMBER.union(Tags::UNDEFINED), numbers)).0,
            "Optional<I32>"
        );
        assert_eq!(
            eligibility(known(Tags::BOOLEAN.union(Tags::UNDEFINED), Facts::BOTTOM)).0,
            "Optional<Bool>"
        );
        assert_eq!(
            eligibility(known(
                Tags::NUMBER,
                Facts {
                    maybe_negative_zero: true,
                    ..numbers
                }
            ))
            .0,
            "F64"
        );
        assert_eq!(
            eligibility(known(Tags::NUMBER.union(Tags::MANAGED), numbers)).0,
            "Dynamic"
        );
        assert_eq!(
            eligibility(ValueFact::Unknown(Unknown::Budget)),
            ("Dynamic", Unknown::Budget.reason())
        );
        assert_eq!(
            fact_json(ValueFact::Unknown(Unknown::OpenWriterSet))["unknown"],
            Unknown::OpenWriterSet.reason()
        );
    }
}
