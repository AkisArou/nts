//! Uncaught reporting reads the actual allocation's fixed string-message slot.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use crate::{common, scratch};
use nts_frontend_ts::Frontend;

struct Fixture(scratch::ScratchDir);
impl Fixture {
    fn new(source: &str) -> Self {
        let root = scratch::ScratchDir::in_target("thrown-message");
        std::fs::write(root.join("main.ts"), source).unwrap();
        std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"esnext","types":[]},"files":["main.ts"]}"#).unwrap();
        Self(root)
    }

    fn emit(&self) -> nts_codegen_jvm::Emitted {
        let snapshot = Frontend::new(&self.0)
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&self.0.join("tsconfig.json"))
            .expect("actual source capture");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = common::prepare(&snapshot).expect("actual JVM host-GC preparation");
        nts_codegen_jvm::emit(&prepared.program)
    }

    fn write_classes(&self) -> std::ffi::OsString {
        let emitted = self.emit();
        assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
        for class in &emitted.classes {
            let path = self.0.join(class.path());
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, &class.bytes).unwrap();
        }
        let jar = self.0.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
        std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
        std::env::join_paths([self.0.as_std_path(), jar.as_std_path()]).unwrap()
    }

    fn facade(&self) {
        let classpath = self.write_classes();
        let driver = self.0.join("Driver.java");
        std::fs::write(&driver, "public class Driver { public static void main(String[] args) { System.out.println(nts.gen.Program.make().nts$thrownMessage()); } }\n").unwrap();
        let javac = common::tool("javac").expect("JDK required for the authored facade guard");
        let compiled = nts_codegen_jvm::toolchain::command(javac)
            .arg("-cp")
            .arg(&classpath)
            .arg(driver)
            .output()
            .unwrap();
        assert!(compiled.status.success(), "{compiled:?}");
        let java = common::tool("java").expect("JDK required for the authored facade guard");
        let run = nts_codegen_jvm::toolchain::command(java)
            .args(["-Xverify:all", "-cp"])
            .arg(classpath)
            .arg("Driver")
            .output()
            .unwrap();
        assert_eq!(run.status.code(), Some(0), "{run:?}");
        assert_eq!(run.stdout, b"authored\n", "{run:?}");
        assert_eq!(run.stderr, [] as [u8; 0], "{run:?}");
    }

    fn run(&self, expected: &str) {
        let classpath = self.write_classes();
        let java = common::tool("java").expect("JDK required for the reporting guard");
        let run = nts_codegen_jvm::toolchain::command(java)
            .args(["-Xverify:all", "-cp"])
            .arg(classpath)
            .args(["nts.rt.NtsMain", "nts.gen.Program"])
            .output()
            .unwrap();
        assert_eq!(run.status.code(), Some(1), "{run:?}");
        assert_eq!(run.stdout, [] as [u8; 0]);
        assert_eq!(String::from_utf8(run.stderr).unwrap(), expected);
    }
}
#[test]
fn synchronous_and_promise_throws_share_the_actual_value_description() {
    for (source, expected) in [
        (
            "class Message {constructor(readonly message:string){}} function fail():void{throw new Message('kept')} Promise.resolve(0).then(()=>fail());",
            "nts: uncaught Message: kept\n",
        ),
        (
            "class Message {constructor(readonly message:string){}} function fail():void{throw new Message('kept')} fail();",
            "nts: uncaught Message: kept\n",
        ),
        (
            "Promise.resolve(0).then(()=>{throw 'kept'});",
            "nts: uncaught kept\n",
        ),
        (
            "Promise.resolve(0).then(()=>{throw 7});",
            "nts: uncaught 7\n",
        ),
        (
            "class First{constructor(readonly message:string){}} class Second{constructor(readonly message:string){}} export function first(){return new First('other')} Promise.resolve(0).then(()=>{throw new Second('shared')});",
            "nts: uncaught Second: shared\n",
        ),
        (
            "class Wide{constructor(readonly prefix:number,readonly message:string,readonly suffix:string){}} Promise.resolve(0).then(()=>{throw new Wide(7,'kept','other')});",
            "nts: uncaught Wide: kept\n",
        ),
        (
            "class Message{constructor(public message:string){}} const reason=new Message('before'); Promise.reject(reason); reason.message='after';",
            "nts: uncaught Message: after\n",
        ),
    ] {
        Fixture::new(source).run(expected);
    }
}

#[test]
fn missing_non_string_and_interface_instance_slots_publish_no_message_protocol() {
    for source in [
        "class Missing{constructor(readonly other:string){}} export function make(){return new Missing('other')}",
        "class Wrong{constructor(readonly message:number){}} export function make(){return new Wrong(7)}",
        "interface Empty{ping():number} class Impl implements Empty{ping(){return 1}} export function make():Empty{return {ping(){return 2}}} export function other():Empty{return new Impl()}",
    ] {
        let emitted = Fixture::new(source).emit();
        assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
        assert!(!emitted.classes.is_empty());
        if source.starts_with("interface") {
            assert!(
                emitted
                    .classes
                    .iter()
                    .any(|class| class.binary_name.ends_with("$Object")),
                "actual interface allocation producer"
            );
        }
        let protocol = b"nts/rt/NtsThrownMessage";
        assert!(!emitted.classes.iter().any(|class| {
            class
                .bytes
                .windows(protocol.len())
                .any(|window| window == protocol)
        }));
    }
}

#[test]
fn a_capture_named_message_is_not_a_property_of_the_thrown_function() {
    for capture in ["message", "text"] {
        for action in [
            "throw f",
            "Promise.reject(f)",
            "Promise.resolve(0).then(()=>{throw f})",
        ] {
            let fixture = Fixture::new(&format!(
                "function make({capture}:string):()=>string{{return ()=>{capture}}} function run():void{{const f=make('captured-secret'); if(f()!=='captured-secret')throw 'bad capture'; {action};}} run();"
            ));
            let emitted = fixture.emit();
            assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
            let protocol = b"nts/rt/NtsThrownMessage";
            assert!(!emitted.classes.iter().any(|class| {
                class
                    .bytes
                    .windows(protocol.len())
                    .any(|window| window == protocol)
            }));
            fixture.run("nts: uncaught Closure0\n");
        }
    }
}

const AUTHORED: &str = "export class Message{constructor(readonly message:string){} nts$thrownMessage():string{return 'authored'}} export function make(){return new Message('kept')} export function call(){return make().nts$thrownMessage()}";

#[test]
fn an_authored_message_spelling_keeps_its_java_facade() {
    Fixture::new(AUTHORED).facade();
}

#[test]
fn an_authored_facade_does_not_replace_the_fixed_message_projection() {
    Fixture::new(&format!("{AUTHORED} throw make();")).run("nts: uncaught Message: kept\n");
}

fn inherited_source(field: &str) -> String {
    format!(
        "export class Base{{nts$thrownMessage():string{{return 'authored'}}}} export class Derived extends Base{{{field}:string='kept'}} export function make():Derived{{return new Derived()}} export function call(){{return make().nts$thrownMessage()}}"
    )
}

#[test]
fn an_inherited_message_spelling_keeps_its_java_facade() {
    // Only the field spelling differs: the control has no message projection.
    for field in ["other", "message"] {
        Fixture::new(&inherited_source(field)).facade();
    }
}

#[test]
fn an_inherited_authored_facade_keeps_the_actual_message_projection() {
    Fixture::new(&format!("{} throw make();", inherited_source("message")))
        .run("nts: uncaught Derived: kept\n");
}
