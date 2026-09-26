//! The React Compiler's memo cache, typed (M3.4).
//!
//! The compiler writes a function's cache as an array of slots, each holding
//! `Symbol.for("react.memo_cache_sentinel")` until its scope first runs:
//!
//! ```ts
//! const $ = _c(2);
//! if ($[0] !== label) { t1 = ...; $[0] = label; $[1] = t1; } else { t1 = $[1]; }
//! ```
//!
//! With `typed_cache`, a function whose every slot has a type the checker
//! can name gets a record instead -- one field per slot, and a bit per scope
//! that says it has run, which does the sentinel's work:
//!
//! ```ts
//! const $ = _cacheOf({ create: ..., clone: ... });
//! if (($.f0 & 1) === 0 || $.s0 !== label) { ...; $.s0 = label; $.s1 = t1; $.f0 |= 1; }
//! else { t1 = $.s1 as (ReactElement); }
//! ```
//!
//! A slot's type is the checker's type of what is stored into it, at the
//! place the stored value came from -- the same answer that types the
//! compiler's temporaries. The bits are exact because the compiler writes a
//! scope's slots together: a scope is filled entirely or not at all. A
//! function this cannot type keeps the compiler's array.

use serde_json::Value;

/// A function's typed cache.
#[derive(Debug)]
pub(super) struct CachePlan {
    /// The cache's local name, `$`.
    pub name: String,
    pub slots: Vec<Slot>,
    /// How many scopes fill it.
    pub scopes: u32,
    /// The next scope printed takes this bit.
    pub next_scope: u32,
    /// The module-scope constant holding the shape, when it could be put
    /// there: made once, not on every render.
    pub hoisted: Option<String>,
}

#[derive(Debug)]
pub(super) struct Slot {
    /// The stored value's type, as the checker prints it.
    pub ty: String,
    /// How the slot starts: a default for a primitive, which the filled bit
    /// keeps from ever being read, or `undefined`.
    pub init: &'static str,
}

/// Bits per filled word: a number's bit operations are 32-bit, and 30 keeps
/// clear of the sign.
const BITS: u32 = 30;

/// A memo scope's `if`, as the typed cache writes it.
#[derive(Debug)]
pub(super) struct Scope {
    /// The test that the scope has not run: `($.f0 & 1) === 0`.
    pub unfilled: String,
    /// The test is only the sentinel check, which `unfilled` replaces.
    pub sentinel_only: bool,
    /// The statement that records it has, last in its block: `$.f0 |= 1;`.
    pub fill: String,
}

impl CachePlan {
    /// The field of the word holding `bit`, and its mask.
    pub(super) fn filled(bit: u32) -> (String, u32) {
        (format!("f{}", bit / BITS), 1 << (bit % BITS))
    }

    /// The next scope printed, which takes the next bit.
    pub(super) fn scope(&mut self, sentinel_only: bool) -> Scope {
        let (word, mask) = Self::filled(self.next_scope);
        self.next_scope += 1;
        Scope {
            unfilled: format!("({}.{word} & {mask}) === 0", self.name),
            sentinel_only,
            fill: format!("{}.{word} |= {mask};", self.name),
        }
    }

    fn words(&self) -> u32 {
        self.scopes.div_ceil(BITS)
    }

    /// The record's type, spelled out.
    pub(super) fn record_type(&self) -> String {
        let mut fields: Vec<String> = (0..self.words()).map(|w| format!("f{w}: number")).collect();
        for (at, slot) in self.slots.iter().enumerate() {
            // Parenthesised: `(x: T) => U | undefined` would make `undefined`
            // part of the function's result.
            // Whether `T` already admits `undefined` is not a question the text
            // answers (`(i: T) => U | undefined` does not), and a second
            // `| undefined` is harmless.
            let ty = if slot.init == "undefined" { format!("({}) | undefined", slot.ty) } else { slot.ty.clone() };
            fields.push(format!("s{at}: {ty}"));
        }
        format!("{{ {} }}", fields.join("; "))
    }

    /// The shape `cacheOf` takes: how a cache is made, with nothing filled,
    /// and how one is copied.
    pub(super) fn shape(&self) -> String {
        self.shape_of(&self.record_type())
    }

    /// The shape, with the record written as `ty` (its type, or an alias of it).
    pub(super) fn shape_of(&self, ty: &str) -> String {
        let names: Vec<String> = (0..self.words()).map(|w| format!("f{w}")).chain((0..self.slots.len()).map(|at| format!("s{at}"))).collect();
        let fresh: Vec<String> = (0..self.words())
            .map(|w| format!("f{w}: 0"))
            .chain(self.slots.iter().enumerate().map(|(at, slot)| format!("s{at}: {}", slot.init)))
            .collect();
        let copied: Vec<String> = names.iter().map(|name| format!("{name}: c.{name}")).collect();
        format!(
            "{{ create: (): {ty} => ({{ {} }}), clone: (c: {ty}): {ty} => ({{ {} }}) }}",
            fresh.join(", "),
            copied.join(", ")
        )
    }

    /// Whether the record's types name any of `locals` -- the function's type
    /// parameters and local types -- which a module-scope shape cannot see.
    pub(super) fn names_any(&self, locals: &[String]) -> bool {
        self.slots.iter().any(|slot| slot.ty.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '$').any(|word| locals.iter().any(|local| local == word)))
    }

    /// What `cacheOf` is called with: the hoisted shape, or the shape itself.
    /// A shape is a `MemoCacheShape` to nts, whose layout an object literal
    /// has only where it is typed as one: the hoisted const is annotated, and
    /// the inline shape is typed by `cacheOf`'s type argument.
    pub(super) fn argument(&self) -> String {
        self.hoisted.clone().unwrap_or_else(|| self.shape())
    }

    /// `cacheOf`'s type argument, for a shape written inline.
    pub(super) fn type_argument(&self) -> String {
        if self.hoisted.is_some() { String::new() } else { format!("<{}>", self.record_type()) }
    }

    /// How a read of slot `at` is written: the field, cast to what was stored
    /// unless the field has exactly that type -- a primitive's.
    pub(super) fn read(&self, at: usize) -> String {
        let slot = &self.slots[at];
        if slot.init == "undefined" {
            format!("({}.s{at} as ({}))", self.name, slot.ty)
        } else {
            format!("{}.s{at}", self.name)
        }
    }
}

/// The initial value of a field of type `ty`, where there is one that needs
/// no `undefined`.
fn default_of(ty: &str) -> &'static str {
    match ty {
        "number" => "0",
        "string" => "\"\"",
        "boolean" => "false",
        _ => "undefined",
    }
}

/// What the compiler's cache code in a function body says, read from its
/// JSON: the cache's name and size, the value each slot is stored from, and
/// whether every comparison against a slot is in a scope's `if` test.
#[derive(Debug, Default)]
pub(super) struct CacheUse {
    pub name: String,
    pub size: usize,
    /// For each slot, the first value stored into it.
    pub stored: Vec<Option<Value>>,
    pub scopes: u32,
    /// A comparison against a slot outside a scope's test, which the filled
    /// bits could not guard.
    pub unguarded: bool,
}

/// The cache a function body declares with `const <name> = <callee>(size)`.
pub(super) fn find(body: &Value, callee: &str) -> Option<CacheUse> {
    let statements = body.get("body")?.as_array()?;
    let (name, size) = statements.iter().find_map(|statement| {
        let declarator = statement.get("declarations")?.as_array()?.first()?;
        let init = declarator.get("init")?;
        (init.get("type")?.as_str()? == "CallExpression" && init.get("callee")?.get("name")?.as_str()? == callee).then_some(())?;
        let size = index(init.get("arguments")?.as_array()?.first()?.get("value")?)?;
        Some((declarator.get("id")?.get("name")?.as_str()?.to_owned(), size))
    })?;
    let mut found = CacheUse { name, size, stored: vec![None; size], ..CacheUse::default() };
    walk(body, &mut found, false);
    Some(found)
}

/// A slot index or cache size, which the compiler writes as a numeric
/// literal: a JSON number that is a small whole number.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "checked whole and in range just above")]
fn index(value: &Value) -> Option<usize> {
    let number = value.as_f64()?;
    (number.fract() == 0.0 && (0.0..1e6).contains(&number)).then_some(number as usize)
}

/// The slot `value` is, if it is `<cache>[k]`.
pub(super) fn slot_of(value: &Value, cache: &str) -> Option<usize> {
    (value.get("type")?.as_str()? == "MemberExpression"
        && value.get("computed")?.as_bool()?
        && value.get("object")?.get("name")?.as_str()? == cache)
        .then(|| index(value.get("property")?.get("value")?))?
}

fn walk(value: &Value, found: &mut CacheUse, in_test: bool) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| walk(item, found, in_test)),
        Value::Object(map) => {
            match map.get("type").and_then(Value::as_str) {
                Some("IfStatement") => {
                    let test = map.get("test").unwrap_or(&Value::Null);
                    let mut reads = CacheUse { name: found.name.clone(), ..CacheUse::default() };
                    touches(test, &mut reads);
                    if reads.scopes > 0 {
                        found.scopes += 1;
                    }
                    walk(test, found, reads.scopes > 0);
                    for key in ["consequent", "alternate"] {
                        if let Some(branch) = map.get(key) {
                            walk(branch, found, false);
                        }
                    }
                    return;
                }
                Some("BinaryExpression") if !in_test => {
                    let operands = [map.get("left"), map.get("right")];
                    if operands.iter().flatten().any(|operand| slot_of(operand, &found.name).is_some()) {
                        found.unguarded = true;
                    }
                }
                Some("AssignmentExpression") => {
                    if let (Some(at), Some(right)) = (map.get("left").and_then(|left| slot_of(left, &found.name)), map.get("right"))
                        && let Some(slot) = found.stored.get_mut(at)
                        && slot.is_none()
                    {
                        *slot = Some(right.clone());
                    }
                }
                _ => {}
            }
            for (key, child) in map {
                if key != "loc" {
                    walk(child, found, in_test);
                }
            }
        }
        _ => {}
    }
}

/// Whether `value` reads a slot of `cache` anywhere.
pub(super) fn reads(value: &Value, cache: &str) -> bool {
    let mut found = CacheUse { name: cache.to_owned(), ..CacheUse::default() };
    touches(value, &mut found);
    found.scopes > 0
}

/// Whether `value` compares against a slot of the cache, counted as a scope.
fn touches(value: &Value, found: &mut CacheUse) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| touches(item, found)),
        Value::Object(map) => {
            if slot_of(value, &found.name).is_some() {
                found.scopes = 1;
                return;
            }
            map.iter().filter(|(key, _)| *key != "loc").for_each(|(_, child)| touches(child, found));
        }
        _ => {}
    }
}

/// Whether a test is only the sentinel check `<cache>[k] === Symbol.for(...)`.
pub(super) fn is_sentinel_test(test: &Value, cache: &str) -> bool {
    test.get("type").and_then(Value::as_str) == Some("BinaryExpression")
        && test.get("operator").and_then(Value::as_str) == Some("===")
        && test.get("left").is_some_and(|left| slot_of(left, cache).is_some())
        && test
            .get("right")
            .and_then(|right| right.get("arguments"))
            .and_then(Value::as_array)
            .and_then(|arguments| arguments.first())
            .and_then(|argument| argument.get("value"))
            .and_then(Value::as_str)
            == Some("react.memo_cache_sentinel")
}

/// A plan from what the cache stores and the types found for it; `None`
/// when a slot has no type worth writing down.
pub(super) fn plan(found: &CacheUse, types: Vec<Option<String>>) -> Option<CachePlan> {
    if found.unguarded || types.len() != found.size {
        return None;
    }
    let slots = types
        .into_iter()
        .map(|ty| {
            let ty = ty?;
            // A slot of `any` or `unknown` is no better typed than the array.
            let loose = ty.split(|c: char| !c.is_alphanumeric() && c != '_').any(|word| word == "any" || word == "unknown");
            (!loose).then(|| Slot { init: default_of(&ty), ty })
        })
        .collect::<Option<Vec<Slot>>>()?;
    Some(CachePlan { name: found.name.clone(), slots, scopes: found.scopes, next_scope: 0, hoisted: None })
}

#[cfg(test)]
mod tests {
    use super::{CachePlan, Slot};

    #[test]
    fn a_plan_spells_its_record_and_how_to_make_and_copy_one() {
        let plan = CachePlan {
            name: "$".to_owned(),
            slots: vec![Slot { ty: "string".to_owned(), init: "\"\"" }, Slot { ty: "Element".to_owned(), init: "undefined" }],
            scopes: 1,
            next_scope: 0,
            hoisted: None,
        };
        assert_eq!(
            plan.shape(),
            "{ create: (): { f0: number; s0: string; s1: (Element) | undefined } => ({ f0: 0, s0: \"\", s1: undefined }), \
             clone: (c: { f0: number; s0: string; s1: (Element) | undefined }): { f0: number; s0: string; s1: (Element) | undefined } => ({ f0: c.f0, s0: c.s0, s1: c.s1 }) }"
        );
        assert_eq!(plan.read(0), "$.s0");
        assert_eq!(plan.read(1), "($.s1 as (Element))");
        assert!(plan.names_any(&["Element".to_owned()]) && !plan.names_any(&["T".to_owned()]));

        // A type whose own text mentions `undefined` -- here in a function's
        // result -- is still widened as a whole, or `undefined` would not fit.
        let callback = CachePlan {
            name: "$".to_owned(),
            slots: vec![Slot { ty: "(i: Item) => boolean | undefined".to_owned(), init: "undefined" }],
            scopes: 1,
            next_scope: 0,
            hoisted: None,
        };
        assert!(callback.shape().contains("s0: ((i: Item) => boolean | undefined) | undefined"), "{}", callback.shape());
        assert_eq!(CachePlan::filled(0), ("f0".to_owned(), 1));
        assert_eq!(CachePlan::filled(31), ("f1".to_owned(), 2));
    }
}
