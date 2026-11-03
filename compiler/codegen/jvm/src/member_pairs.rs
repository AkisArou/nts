//! Producer-owned raising relations, rendered by the ordinary JVM name authority.
use std::collections::{BTreeMap, BTreeSet};

use nts_jvm_emitter::{Class, ClassBuilder, class::access};

use crate::{hierarchy, program::JvmProgram};

struct Pair {
    raised_slot: u32,
    ordinary_slot: Option<u32>,
    raised: String,
    ordinary: Option<String>,
}

fn count(out: &mut Vec<u8>, value: usize) -> Result<(), String> {
    out.extend_from_slice(
        &u32::try_from(value)
            .map_err(|_| "raising metadata exceeds its 32-bit count".to_owned())?
            .to_be_bytes(),
    );
    Ok(())
}

fn string(out: &mut Vec<u8>, value: &str) -> Result<(), String> {
    count(out, value.len())?;
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

fn descriptors(out: &mut Vec<u8>, values: Option<&BTreeSet<&str>>) -> Result<(), String> {
    count(out, values.map_or(0, BTreeSet::len))?;
    for value in values.into_iter().flatten() {
        string(out, value)?;
    }
    Ok(())
}

/// A versioned, length-framed attribute. Names are opaque UTF-8, not identifiers.
/// Descriptors come directly from declarations the class writer serialized.
/// A missing ordinary relation and a pruned physical declaration remain distinct.
pub(crate) fn attribute(
    program: &JvmProgram<'_>,
    classes: &[Class],
    builder: &ClassBuilder,
) -> Result<Vec<u8>, String> {
    let mut declarations: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (flags, name, descriptor) in classes.iter().flat_map(|class| &class.declarations) {
        if flags & access::STATIC == 0 {
            declarations.entry(name).or_default().insert(descriptor);
        }
    }
    for method in &builder.methods {
        if method.access & access::STATIC == 0 {
            declarations
                .entry(&method.name)
                .or_default()
                .insert(&method.descriptor);
        }
    }
    let mut pairs: BTreeMap<u32, Pair> = program
        .raising_members
        .iter()
        .map(|(&slot, member)| {
            let pair = Pair {
                raised_slot: slot,
                ordinary_slot: member.ordinary_slot,
                raised: hierarchy::slot_member(program, slot as usize, &member.member)?,
                ordinary: member
                    .ordinary_slot
                    .map(|ordinary| {
                        hierarchy::slot_member(program, ordinary as usize, &member.member)
                    })
                    .transpose()?,
            };
            Ok((slot, pair))
        })
        .collect::<Result<_, String>>()?;
    if let (Some(ordinary), Some(raised)) = (program.erased_call_slot, program.raising_call_slot) {
        let ordinary_name = hierarchy::slot_member(program, ordinary as usize, "call")?;
        let raised_name = hierarchy::slot_member(program, raised as usize, "call")?;
        // A quiet uniform entry fills both slots under the same member. It has
        // no separate raising copy to inherit or leave unimplemented.
        if ordinary_name != raised_name {
            pairs.insert(
                raised,
                Pair {
                    raised_slot: raised,
                    ordinary_slot: Some(ordinary),
                    raised: raised_name,
                    ordinary: Some(ordinary_name),
                },
            );
        }
    }
    let mut out = Vec::new();
    out.extend_from_slice(&1_u16.to_be_bytes());
    count(&mut out, pairs.len())?;
    for pair in pairs.values() {
        out.extend_from_slice(&pair.raised_slot.to_be_bytes());
        out.push(u8::from(pair.ordinary_slot.is_some()));
        if let Some(slot) = pair.ordinary_slot {
            out.extend_from_slice(&slot.to_be_bytes());
        }
        string(&mut out, &pair.raised)?;
        out.push(u8::from(pair.ordinary.is_some()));
        if let Some(ordinary) = &pair.ordinary {
            string(&mut out, ordinary)?;
        }
        descriptors(&mut out, declarations.get(pair.raised.as_str()))?;
        descriptors(
            &mut out,
            pair.ordinary
                .as_deref()
                .and_then(|name| declarations.get(name)),
        )?;
    }
    // The binding covers the complete emitted population. An empty row is
    // the producer's explicit statement that this class has no raising entry;
    // absence of a row is never used to make that claim.
    let raised_names: BTreeSet<&str> = pairs.values().map(|pair| pair.raised.as_str()).collect();
    count(&mut out, classes.len() + 1)?;
    for class in classes {
        string(&mut out, &class.binary_name)?;
        let names: BTreeSet<&str> = class
            .declarations
            .iter()
            .filter(|(flags, name, _)| {
                flags & access::STATIC == 0 && raised_names.contains(name.as_str())
            })
            .map(|(_, name, _)| name.as_str())
            .collect();
        descriptors(&mut out, Some(&names))?;
    }
    string(&mut out, &builder.name)?;
    let names: BTreeSet<&str> = builder
        .methods
        .iter()
        .filter(|method| {
            method.access & access::STATIC == 0 && raised_names.contains(method.name.as_str())
        })
        .map(|method| method.name.as_str())
        .collect();
    descriptors(&mut out, Some(&names))?;
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use nts_core::hir::{Program, RaisingMember};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_jvm_emitter::{Code, Kind, Pool, VType, read};
    use nts_semantic_schema::Origin;
    use std::path::{Path, PathBuf};

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn integer(builder: &mut ClassBuilder, pool: &mut Pool, name: &str, value: i32) {
        let mut code = Code::new(vec![VType::Object(builder.name.clone())], 1);
        code.const_int(&origin(), pool, value);
        code.ret(&origin(), Some(Kind::Int));
        builder.method(
            access::PUBLIC,
            name,
            "()I",
            Some(code.finish(pool).unwrap()),
        );
    }

    fn hierarchy(abstract_raised: bool, fill: bool, raised: &str) -> Vec<Class> {
        let mut pool = Pool::default();
        let mut base = ClassBuilder::new("Base", "java/lang/Object");
        base.default_constructor(&origin(), &mut pool).unwrap();
        integer(&mut base, &mut pool, "read", 1);
        if abstract_raised {
            base.access |= access::ABSTRACT;
            base.method(access::PUBLIC | access::ABSTRACT, raised, "()I", None);
        } else {
            integer(&mut base, &mut pool, raised, 1);
        }
        let base = base.build(pool).unwrap();
        let mut pool = Pool::default();
        let mut child = ClassBuilder::new("Child", "Base");
        child.default_constructor(&origin(), &mut pool).unwrap();
        integer(&mut child, &mut pool, "read", 2);
        if fill {
            integer(&mut child, &mut pool, raised, 2);
        }
        vec![base, child.build(pool).unwrap()]
    }

    #[derive(Clone, Copy)]
    enum Binding {
        Complete,
        Missing,
        MissingClass,
    }

    fn fixture(path: &Path, abstract_raised: bool, fill: bool, binding: Binding) -> String {
        let mut program = Program::default();
        program.raising_members.insert(
            1,
            RaisingMember {
                member: "read".into(),
                ordinary_slot: Some(0),
            },
        );
        crate::member_identity::synthetic_rows(&mut program, &[(1, 0, "read", true)]);
        let facts = JvmProgram::new(&program);
        let raised = hierarchy::slot_member(&facts, 1, "read").unwrap();
        assert_eq!(raised, facts.dispatch_name(1).unwrap());
        let mut classes = hierarchy(abstract_raised, fill, &raised);
        let mut pool = Pool::default();
        let mut main = ClassBuilder::new("Program", "java/lang/Object");
        let mut code = Code::new(Vec::new(), 0);
        code.new_object(&origin(), &mut pool, "Child");
        code.dup(&origin());
        code.invoke_special(&origin(), &mut pool, "Child", "<init>", "()V");
        code.invoke_virtual(&origin(), &mut pool, "Base", &raised, "()I");
        code.ret(&origin(), Some(Kind::Int));
        main.method(
            access::PUBLIC | access::STATIC,
            "probe",
            "()I",
            Some(code.finish(&pool).unwrap()),
        );
        if !matches!(binding, Binding::Missing) {
            let population = if matches!(binding, Binding::MissingClass) {
                &classes[..1]
            } else {
                &classes
            };
            main.attributes.push((
                crate::generated_members::RAISING_PAIRS.into(),
                attribute(&facts, population, &main).unwrap(),
            ));
        }
        classes.push(main.build(pool).unwrap());
        write(path, &classes);
        raised
    }

    fn write(path: &Path, classes: &[Class]) {
        std::fs::create_dir_all(path).unwrap();
        for class in classes {
            let parsed = read::class_file(&class.bytes).unwrap();
            assert_eq!(
                parsed.methods.len(),
                class.declarations.len(),
                "actual definitions must survive"
            );
            std::fs::write(path.join(class.path()), &class.bytes).unwrap();
        }
    }

    fn verify(label: &str, populate: impl FnOnce(&Path)) -> String {
        let path =
            std::env::temp_dir().join(format!("member-pairs-{}-{label}", std::process::id()));
        populate(&path);
        let java = std::env::var_os("JAVA_HOME").map_or_else(
            || PathBuf::from("java"),
            |home| PathBuf::from(home).join("bin/java"),
        );
        let output = nts_jvm_emitter::toolchain::command(java)
            .args(["-Xverify:all", "-cp"])
            .arg(&path)
            .arg(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../../tooling/conformance/JvmVerify.java"),
            )
            .arg(&path)
            .output()
            .expect("the real verifier must run");
        std::fs::write(path.join("verify.stdout"), &output.stdout).unwrap();
        std::fs::write(path.join("verify.stderr"), &output.stderr).unwrap();
        assert!(output.status.success(), "verifier failed: {output:?}");
        assert!(output.stderr.is_empty(), "verifier diagnostic: {output:?}");
        String::from_utf8(output.stdout).unwrap()
    }

    #[test]
    fn actual_new_name_pairs_keep_shadowed_and_unfilled_guards_live() {
        for (label, abstract_raised, fill, expected) in [
            ("shadowed", false, false, "SHADOWED Child "),
            ("unfilled", true, false, "UNFILLED Child "),
            ("filled", false, true, "VERIFIED 3 OF 3"),
        ] {
            let output = verify(label, |path| {
                fixture(path, abstract_raised, fill, Binding::Complete);
            });
            assert!(output.contains(expected), "{label}: {output}");
            assert!(!output.contains("UNPAIRED"), "{label}: {output}");
            if fill {
                assert!(
                    !output.contains("SHADOWED") && !output.contains("UNFILLED"),
                    "{output}"
                );
            }
        }
    }

    #[test]
    fn missing_binding_is_named_and_explicit_zero_raising_passes() {
        let missing = verify("missing", |path| {
            fixture(path, false, true, Binding::Missing);
        });
        assert!(
            missing.contains("UNPAIRED Base missing Program catalogue pair attribute"),
            "{missing}"
        );
        let missing_class = verify("missing-class", |path| {
            fixture(path, false, true, Binding::MissingClass);
        });
        assert!(
            missing_class.contains("UNPAIRED Child missing producer raising inventory"),
            "{missing_class}"
        );
        let empty = verify("empty", |path| {
            let program = Program::default();
            let facts = JvmProgram::new(&program);
            let mut pool = Pool::default();
            let mut main = ClassBuilder::new("Program", "java/lang/Object");
            integer(
                &mut main,
                &mut pool,
                &crate::generated_members::body("quiet"),
                1,
            );
            main.attributes.push((
                crate::generated_members::RAISING_PAIRS.into(),
                attribute(&facts, &[], &main).unwrap(),
            ));
            write(path, &[main.build(pool).unwrap()]);
        });
        assert_eq!(empty, "VERIFIED 1 OF 1\n");
    }

    #[test]
    fn invalid_method_identity_comes_from_the_actual_definition() {
        let name = crate::generated_members::body("東京#bad.$");
        let output = verify("invalid", |path| {
            let program = Program::default();
            let facts = JvmProgram::new(&program);
            let pool = Pool::default();
            let mut main = ClassBuilder::new("Program", "java/lang/Object");
            let mut code = Code::new(Vec::new(), 0);
            code.const_null(&origin());
            code.ret(&origin(), Some(Kind::Int));
            main.method(
                access::PUBLIC | access::STATIC,
                &name,
                "()I",
                Some(code.finish(&pool).unwrap()),
            );
            main.attributes.push((
                crate::generated_members::RAISING_PAIRS.into(),
                attribute(&facts, &[], &main).unwrap(),
            ));
            write(path, &[main.build(pool).unwrap()]);
        });
        assert!(
            output.contains(&format!("\"method\":\"{name}\"")),
            "{output}"
        );
        assert!(
            output.contains("\"descriptor\":\"()I\"") && output.contains("\"offset\":1"),
            "{output}"
        );
        assert!(!output.contains("UNPAIRED"), "{output}");
    }
}
