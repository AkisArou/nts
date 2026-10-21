//! A program that overrides a virtual function holds a declaration of the
//! module declaring it, whose headers its witness then includes -- the
//! ground the witness's claims about the program's class struct slots
//! stand on.
//!
//! A small `GObject` library is bound, and a program subclasses its widget
//! and overrides `vfunc_measure`, calling nothing else of the library's.

#![cfg(target_os = "linux")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("vfunc-slot-witness-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch directory");
    dir
}

fn cflags(package: &str) -> Option<Vec<String>> {
    let output = Command::new("pkg-config")
        .args(["--cflags", package])
        .output()
        .ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    })
}

/// `slot.h` with `members` as `SlotWidgetClass`'s after its parent.
fn header(members: &str) -> String {
    format!(
        "#include <glib-object.h>\n\
         G_BEGIN_DECLS\n\
         typedef struct _SlotWidget SlotWidget;\n\
         typedef struct _SlotWidgetClass SlotWidgetClass;\n\
         struct _SlotWidget {{ GObject parent_instance; }};\n\
         struct _SlotWidgetClass {{ GObjectClass parent_class; {members} }};\n\
         GType slot_widget_get_type(void);\n\
         G_END_DECLS\n"
    )
}

const BOUND: &str = "int (*measure)(SlotWidget *widget, int for_size);";

const GIR: &str = r#"<?xml version="1.0"?>
<repository version="1.2"
    xmlns="http://www.gtk.org/introspection/core/1.0"
    xmlns:c="http://www.gtk.org/introspection/c/1.0"
    xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
  <include name="GObject" version="2.0"/>
  <package name="slot"/>
  <c:include name="slot.h"/>
  <namespace name="Slot" version="1.0" c:identifier-prefixes="Slot" c:symbol-prefixes="slot">
    <class name="Widget" c:type="SlotWidget" parent="GObject.Object"
        glib:type-name="SlotWidget" glib:get-type="slot_widget_get_type" glib:type-struct="WidgetClass">
      <virtual-method name="measure">
        <return-value><type name="gint" c:type="int"/></return-value>
        <parameters>
          <instance-parameter name="widget"><type name="Widget" c:type="SlotWidget*"/></instance-parameter>
          <parameter name="for_size"><type name="gint" c:type="int"/></parameter>
        </parameters>
      </virtual-method>
      <field name="parent_instance"><type name="GObject.Object" c:type="GObject"/></field>
    </class>
    <record name="WidgetClass" c:type="SlotWidgetClass" glib:is-gtype-struct-for="Widget">
      <field name="parent_class"><type name="GObject.ObjectClass" c:type="GObjectClass"/></field>
      <field name="measure">
        <callback name="measure">
          <return-value><type name="gint" c:type="int"/></return-value>
          <parameters>
            <parameter name="widget"><type name="Widget" c:type="SlotWidget*"/></parameter>
            <parameter name="for_size"><type name="gint" c:type="int"/></parameter>
          </parameters>
        </callback>
      </field>
    </record>
  </namespace>
</repository>
"#;

const MAIN: &str = "import { SlotWidget } from \"c:Slot-1.0\";\n\
import type { c_int } from \"@nts/scalars\";\n\
class Measured extends SlotWidget {\n\
  vfunc_measure(for_size: c_int): c_int {\n\
    return for_size;\n\
  }\n\
}\n\
export function made(): boolean {\n\
  return new Measured() !== null;\n\
}\n";

/// The library's header, `.pc` and GIR under `dir`, the header with
/// `members` in its class struct.
fn library(dir: &Path, members: &str) {
    for sub in ["include", "pc", "gir"] {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }
    std::fs::write(dir.join("include/slot.h"), header(members)).unwrap();
    std::fs::write(
        dir.join("pc/slot.pc"),
        format!(
            "Name: slot\nDescription: a fixture\nVersion: 1.0\nRequires: gobject-2.0\nCflags: -I{}\nLibs:\n",
            dir.join("include").display()
        ),
    )
    .unwrap();
    std::fs::write(dir.join("gir/Slot-1.0.gir"), GIR).unwrap();
}

/// The library under `dir`, its header with `members`, bound by `nts
/// bind-gir` into `dir/bindings`.
fn bound(dir: &Path, members: &str) -> PathBuf {
    library(dir, members);
    let bindings = dir.join("bindings");
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-gir", "Slot-1.0", "--gir-dir"])
        .arg(dir.join("gir"))
        .arg("--out")
        .arg(&bindings)
        .env("PKG_CONFIG_PATH", dir.join("pc"))
        .output()
        .expect("running nts bind-gir");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    bindings
}

/// `main` as `dir/<name>/main.ts`, emitted by `nts emit-c` against
/// `bindings` with nothing refused: where its witness is.
fn emitted(dir: &Path, bindings: &Path, name: &str, main: &str) -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let project = dir.join(name);
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("main.ts"), main).unwrap();
    let mut files = vec!["main.ts".to_owned()];
    for entry in std::fs::read_dir(bindings).unwrap() {
        let path = entry.unwrap().path();
        if path.to_string_lossy().ends_with(".d.ts") {
            files.push(path.display().to_string());
        }
    }
    files.push(repo.join("runtime/native/libc.d.ts").display().to_string());
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::json!({ "extends": repo.join("tsconfig.fixtures.json"), "files": files })
            .to_string(),
    )
    .unwrap();
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("emit-c")
        .arg(project.join("tsconfig.json"))
        .arg("--out")
        .arg(project.join("c"))
        .output()
        .expect("running nts emit-c");
    let said = String::from_utf8_lossy(&run.stderr);
    assert!(
        run.status.success() && !said.contains("NTS"),
        "{name}: {said}"
    );
    project.join("c/native_witness.c")
}

/// Whether the witness at `path` includes `slot.h`: none written, none.
fn includes_the_header(path: &Path) -> bool {
    std::fs::read_to_string(path).is_ok_and(|text| text.contains("#include <slot.h>"))
}

fn available() -> Option<Vec<String>> {
    let flags = cflags("gobject-2.0");
    if flags.is_none() || !Path::new("/usr/share/gir-1.0/GObject-2.0.gir").exists() {
        eprintln!("skipping: no gobject-2.0 pkg-config entry or GObject-2.0.gir");
    }
    flags.filter(|_| Path::new("/usr/share/gir-1.0/GObject-2.0.gir").exists())
}

/// A program that overrides a virtual function holds a declaration of the
/// module that declares it, as one that calls a function or lays out a
/// record does: the module's header is the witness's, though the program
/// calls nothing from it. The control calls nothing and overrides nothing,
/// and reaches nothing.
#[test]
fn an_override_reaches_the_module_declaring_its_virtual_function() {
    if available().is_none() {
        return;
    }
    let dir = scratch("reach");
    let bindings = bound(&dir, BOUND);
    assert!(includes_the_header(&emitted(
        &dir,
        &bindings,
        "overrides",
        MAIN
    )));
    let control = emitted(
        &dir,
        &bindings,
        "control",
        "export function made(): number {\n  return 1;\n}\n",
    );
    assert!(!includes_the_header(&control));
    std::fs::remove_dir_all(dir).unwrap();
}
