//! Library-global identity, independently of which provider is selected.
//!
//! Scope membership and provenance come from the checker-owned symbol record.
//! A written name, a type with that name, or a module export is not that fact.

use nts_semantic_schema::{Library, SnapshotError, SymbolFlags, SymbolId, SymbolRecord};

/// The two independent meanings in the checker's global binding tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GlobalMeaning {
    Value,
    Type,
}

/// A checked binding in one snapshot. It borrows that snapshot and cannot be
/// retained as the identity of a later checking revision.
#[derive(Debug, Clone, Copy)]
pub struct GlobalBinding<'a> {
    symbol: SymbolId,
    record: &'a SymbolRecord,
    name: &'a str,
    library: &'a Library,
    meaning: GlobalMeaning,
}

impl<'a> GlobalBinding<'a> {
    #[must_use]
    pub const fn symbol(self) -> SymbolId {
        self.symbol
    }
    #[must_use]
    pub const fn record(self) -> &'a SymbolRecord {
        self.record
    }
    #[must_use]
    pub const fn name(self) -> &'a str {
        self.name
    }
    #[must_use]
    pub const fn library(self) -> &'a Library {
        self.library
    }
    #[must_use]
    pub const fn meaning(self) -> GlobalMeaning {
        self.meaning
    }

    /// Source-level membership only. Target/helper and call-shape eligibility
    /// remain separate resolver/lowering obligations.
    #[must_use]
    pub fn compiler_provided(self) -> bool {
        super::compiler::provides_binding(self.library, self.name)
    }
}

/// Follow checked aliases, then require the exact global meaning and the
/// declaration-library fact. Source-owned declarations never acquire a provider
/// merely because a library also declares the same name.
///
/// Invalid identities and alias cycles are errors, not an absent requirement.
pub fn global_binding(
    symbols: &[SymbolRecord],
    mut symbol: SymbolId,
    meaning: GlobalMeaning,
) -> Result<Option<GlobalBinding<'_>>, SnapshotError> {
    // A non-cyclic chain visits at most the number of symbols in the arena.
    // This bounds malformed inputs without recursion or a per-lookup hash set.
    for _ in 0..symbols.len() {
        let record = symbols.get(symbol.0 as usize).ok_or_else(|| {
            SnapshotError::Project("global binding refers to an unknown symbol".into())
        })?;
        if let Some(target) = record.aliased {
            symbol = target;
            continue;
        }
        let flag = match meaning {
            GlobalMeaning::Value => SymbolFlags::GLOBAL_VALUE,
            GlobalMeaning::Type => SymbolFlags::GLOBAL_TYPE,
        };
        if !record.flags.contains(flag) {
            return Ok(None);
        }
        let Some(library) = record.library.as_ref() else {
            return Ok(None);
        };
        if !record.declarations.is_empty() || record.declaration_sites.is_empty() {
            return Err(SnapshotError::Project(
                "a library global has contradictory declaration provenance".into(),
            ));
        }
        let name = record.name.public_name().ok_or_else(|| {
            SnapshotError::Project("a library global has no public binding name".into())
        })?;
        return Ok(Some(GlobalBinding {
            symbol,
            record,
            name,
            library,
            meaning,
        }));
    }
    Err(SnapshotError::Project("cyclic global binding alias".into()))
}

/// The canonical global supplying this checked reference, including a member
/// declared by that global. Owners are followed only through library-owned
/// symbols; an own source member never inherits a builtin's attribution.
pub fn feature_binding(
    symbols: &[SymbolRecord],
    symbol: SymbolId,
    meaning: GlobalMeaning,
) -> Result<Option<GlobalBinding<'_>>, SnapshotError> {
    FeatureBindings::new(symbols).get(symbol, meaning)
}

type Answer = Result<Option<(SymbolId, GlobalMeaning)>, std::sync::Arc<str>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Projection {
    Reference,
    Owner,
    Global,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct Key {
    symbol: SymbolId,
    meaning: GlobalMeaning,
    projection: Projection,
}

enum Step<'a> {
    Done(Option<(SymbolId, GlobalMeaning)>),
    Next(Key, Check<'a>),
}
enum Check<'a> {
    Alias,
    Owner(&'a Library),
    Constructor(&'a Library),
}

/// Counts at the actual attribution dependency transitions, excluding hits.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AttributionWork {
    pub owner_hops: usize,
    pub alias_hops: usize,
    pub constructor_hops: usize,
}

/// One run's canonical attribution cache, borrowing its immutable checked
/// symbol arena. Every reference/owner/global projection, including negative
/// and cycle/error answers, is resolved once by an iterative dependency walk.
#[derive(Debug)]
pub struct FeatureBindings<'a> {
    symbols: &'a [SymbolRecord],
    answers: rustc_hash::FxHashMap<Key, Answer>,
    work: AttributionWork,
}

impl<'a> FeatureBindings<'a> {
    #[must_use]
    pub fn new(symbols: &'a [SymbolRecord]) -> Self {
        Self {
            symbols,
            answers: rustc_hash::FxHashMap::default(),
            work: AttributionWork::default(),
        }
    }
    #[must_use]
    pub const fn work(&self) -> AttributionWork {
        self.work
    }
    pub fn get(
        &mut self,
        symbol: SymbolId,
        meaning: GlobalMeaning,
    ) -> Result<Option<GlobalBinding<'a>>, SnapshotError> {
        self.binding(Key {
            symbol,
            meaning,
            projection: Projection::Reference,
        })
    }
    pub fn global(
        &mut self,
        symbol: SymbolId,
        meaning: GlobalMeaning,
    ) -> Result<Option<GlobalBinding<'a>>, SnapshotError> {
        self.binding(Key {
            symbol,
            meaning,
            projection: Projection::Global,
        })
    }
    fn binding(&mut self, key: Key) -> Result<Option<GlobalBinding<'a>>, SnapshotError> {
        match self
            .resolve(key)
            .map_err(|error| SnapshotError::Project(error.to_string()))?
        {
            Some((symbol, meaning)) => global_binding(self.symbols, symbol, meaning),
            None => Ok(None),
        }
    }
    fn resolve(&mut self, root: Key) -> Answer {
        let mut path = Vec::new();
        let mut active = rustc_hash::FxHashSet::default();
        let mut at = root;
        let mut answer = loop {
            if let Some(answer) = self.answers.get(&at) {
                break answer.clone();
            }
            if !active.insert(at) {
                break Err("cyclic feature owner or alias".into());
            }
            match self.step(at) {
                Ok(Step::Done(answer)) => {
                    self.answers.insert(at, Ok(answer));
                    break Ok(answer);
                }
                Ok(Step::Next(next, check)) => {
                    path.push((at, check));
                    at = next;
                }
                Err(error) => {
                    self.answers.insert(at, Err(error.clone()));
                    break Err(error);
                }
            }
        };
        while let Some((key, check)) = path.pop() {
            answer = self.check(answer, check);
            self.answers.insert(key, answer.clone());
        }
        answer
    }
    fn step(&mut self, key: Key) -> Result<Step<'a>, std::sync::Arc<str>> {
        let record = self
            .symbols
            .get(key.symbol.0 as usize)
            .ok_or("feature binding refers to an unknown symbol")?;
        if let Some(alias) = record.aliased {
            self.work.alias_hops += 1;
            return Ok(Step::Next(
                Key {
                    symbol: alias,
                    ..key
                },
                Check::Alias,
            ));
        }
        if global_binding(self.symbols, key.symbol, key.meaning)
            .map_err(failure)?
            .is_some()
        {
            return Ok(Step::Done(Some((key.symbol, key.meaning))));
        }
        if key.projection == Projection::Global {
            return Ok(Step::Done(None));
        }
        let Some(library) = record.library.as_ref() else {
            return Ok(Step::Done(None));
        };
        if !record.declarations.is_empty() || record.declaration_sites.is_empty() {
            return Err("contradictory library member ownership".into());
        }
        if key.projection == Projection::Owner
            && let Some(value) = record.constructor_value
        {
            self.work.constructor_hops += 1;
            return Ok(Step::Next(
                Key {
                    symbol: value,
                    meaning: GlobalMeaning::Value,
                    projection: Projection::Global,
                },
                Check::Constructor(library),
            ));
        }
        let Some(owner) = record.owner else {
            return Ok(Step::Done(None));
        };
        self.work.owner_hops += 1;
        if self
            .symbols
            .get(owner.0 as usize)
            .and_then(|owner| owner.library.as_ref())
            .is_some_and(|owner| owner != library)
        {
            return Err("contradictory library member ownership".into());
        }
        Ok(Step::Next(
            Key {
                symbol: owner,
                projection: Projection::Owner,
                ..key
            },
            Check::Owner(library),
        ))
    }
    fn check(&self, answer: Answer, check: Check<'a>) -> Answer {
        let answer = answer?;
        match (answer, check) {
            (answer, Check::Alias) => Ok(answer),
            (None, Check::Owner(_)) => Ok(None),
            (Some(identity), Check::Owner(library) | Check::Constructor(library))
                if self.symbols[identity.0.0 as usize].library.as_ref() == Some(library) =>
            {
                Ok(Some(identity))
            }
            _ => Err("invalid library owner or constructor value relation".into()),
        }
    }
}

fn failure(error: SnapshotError) -> std::sync::Arc<str> {
    match error {
        SnapshotError::Project(message) => message.into(),
        error => error.to_string().into(),
    }
}
