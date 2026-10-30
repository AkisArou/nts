//! The same logical matrix as the native ABI guards, through verified JVM
//! methods and a separately compiled Java caller. No source L4 producer yet.
#![allow(clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir;
use std::process::Command;
#[path = "../../../test-support/optional.rs"]
mod fixture;
#[path = "../../../test-support/scratch.rs"]
mod scratch;
fn checked(command: &mut Command) {
    let out = command.output().expect("run JDK tool");
    assert!(
        out.status.success(),
        "{command:?}: {}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}
#[test]
fn optional_jvm_values_preserve_every_bit_and_keep_null_distinct() {
    let mut program = fixture::program();
    let unsupported = nts_codegen_jvm::emit(&program);
    assert!(
        unsupported.diagnostics.iter().any(|d| d.code == "NTS4001"
            && d.message.contains("identityPointer")
            && d.message.contains("native pointer")),
        "{:?}",
        unsupported.diagnostics
    );
    let mut native_region = program.clone();
    let function = native_region
        .funcs
        .iter_mut()
        .find(|f| f.name == "identityPointer")
        .expect("optional pointer function");
    let region = fixture::optional(&hir::HirType::Managed(hir::ManagedType::Region));
    function.params[0].ty = region.clone();
    function.values[0].ty = region.clone();
    function.return_type = region;
    let rejected = nts_codegen_jvm::emit(&native_region);
    assert!(
        rejected.diagnostics.iter().any(|d| d.code == "NTS4001"
            && d.message.contains("identityPointer")
            && d.message.contains("region")),
        "{:?}",
        rejected.diagnostics
    );
    program.funcs.retain(|f| !f.name.ends_with("Pointer"));
    program
        .public_api
        .retain(|(name, _)| !name.ends_with("Pointer"));
    assert_eq!(hir::verify::verify(&program), Ok(()));
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let dir = scratch::ScratchDir::new(Utf8Path::new(env!("CARGO_TARGET_TMPDIR")), "optional-jvm");
    for class in emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().expect("class parent")).expect("directory");
        std::fs::write(path, class.bytes).expect("class");
    }
    std::fs::write(dir.join("OptionalDriver.java"), DRIVER).expect("driver");
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut javac = nts_codegen_jvm::toolchain::command("javac");
    javac
        .current_dir(dir.as_std_path())
        .args(["--release", "8", "-d", ".", "OptionalDriver.java"]);
    for file in std::fs::read_dir(root.join("runtime/jvm/src/nts/rt")).expect("runtime directory") {
        let file = file.expect("runtime source");
        if file.path().extension().is_some_and(|ext| ext == "java") {
            javac.arg(file.path());
        }
    }
    checked(&mut javac);
    checked(
        nts_codegen_jvm::toolchain::command("java")
            .current_dir(dir.as_std_path())
            .args(["-Xverify:all", "-cp", ".", "OptionalDriver"]),
    );
    assert_defined_component_mutation_is_observed(&dir);
}
fn assert_defined_component_mutation_is_observed(dir: &Utf8Path) {
    let path = dir.join("nts/gen/Program.class");
    let original = std::fs::read(&path).expect("program class");
    let parsed = nts_jvm_emitter::read::class_file(&original).expect("read program class");
    assert_local_scratch(&parsed);
    let code = &parsed
        .methods
        .iter()
        .find(|m| m.name == "makeBool")
        .expect("boolean factory")
        .code
        .as_ref()
        .expect("factory code")
        .bytes;
    let offsets: Vec<_> = original
        .windows(code.len())
        .enumerate()
        .filter_map(|(at, bytes)| (bytes == code).then_some(at))
        .collect();
    assert_eq!(offsets.len(), 1, "mutate exactly this method's bytecode");
    let reads: Vec<_> = code
        .iter()
        .enumerate()
        .filter_map(|(at, byte)| (*byte == 0x1a).then_some(at))
        .collect();
    assert_eq!(
        reads.len(),
        1,
        "makeBool reads its flag once through iload_0"
    );
    let mut broken = original.clone();
    // iload_0 -> iconst_0: same stack and frames, but the defined component
    // is lost. Require a value assertion, rather than a verifier/link failure.
    broken[offsets[0] + reads[0]] = 0x03;
    std::fs::write(&path, broken).expect("mutant class");
    let out = nts_codegen_jvm::toolchain::command("java")
        .current_dir(dir.as_std_path())
        .args(["-Xverify:all", "-cp", ".", "OptionalDriver"])
        .output()
        .expect("mutant JVM");
    assert!(!out.status.success());
    assert!(
        {
            let message = String::from_utf8_lossy(&out.stderr);
            message.contains("java.lang.AssertionError: Bool")
                && (message.contains("make defined") || message.contains("swapped definedness"))
        },
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    std::fs::write(path, original).expect("restore isolated class");
}

fn assert_local_scratch(class: &nts_jvm_emitter::read::ClassFile) {
    assert!(
        class.fields.iter().all(|f| !f.descriptor.starts_with('[')),
        "scratch must not be stored in static program state"
    );
    for name in ["roundtripF64", "recursiveF64"] {
        let code = &class
            .methods
            .iter()
            .find(|m| m.name == name)
            .expect("full-width caller")
            .code
            .as_ref()
            .expect("caller body")
            .bytes;
        assert_eq!(
            code.windows(3)
                .filter(|bytes| *bytes == [0x04, 0xbc, 0x07])
                .count(),
            1,
            "{name} must allocate one local double[1] per activation"
        );
    }
}

const DRIVER: &str = r#"
import java.lang.reflect.*;
import nts.gen.Program;
import nts.rt.*;
public class OptionalDriver {
  static Object call(String name,Class<?>[] types,Object... args) throws Exception {return Program.class.getMethod(name,types).invoke(null,args);}
  static Object[] unpack(String name,Object value,Object scratch) {
    if(name.equals("Reference")||name.equals("BigInt")) return new Object[]{value,value!=NtsUndefinedReference.INSTANCE};
    if(name.equals("F64")) return new Object[]{((double[])scratch)[0],value};
    if(name.equals("I64")||name.equals("U64")) return new Object[]{((long[])scratch)[0],value};
    long word=((Number)value).longValue(); int bits=name.equals("Bool")?1:name.endsWith("8")?8:name.endsWith("16")?16:32;
    Object payload;
    if(name.equals("F32"))payload=Float.intBitsToFloat((int)word);
    else if(name.equals("Bool"))payload=(word&1)!=0;
    else if(name.equals("I8"))payload=(int)(byte)word;
    else if(name.equals("I16"))payload=(int)(short)word;
    else payload=(int)(word& (bits==32?0xffffffffL:(1L<<bits)-1));
    return new Object[]{payload,((word>>>bits)&1)!=0};
  }
  static long unsigned32(Object value) {
    return value instanceof Integer?Integer.toUnsignedLong((Integer)value):((Number)value).longValue();
  }
  static void same(String name,Object a,Object b) {
    boolean ok;
    if(name.equals("F64"))ok=Double.doubleToRawLongBits((Double)a)==Double.doubleToRawLongBits((Double)b);
    else if(name.equals("F32"))ok=Float.floatToRawIntBits((Float)a)==Float.floatToRawIntBits((Float)b);
    else if(name.equals("U32"))ok=unsigned32(a)==unsigned32(b);
    else if(name.equals("BigInt")){NtsBigInt x=(NtsBigInt)a,y=(NtsBigInt)b;ok=x.hi==y.hi&&x.lo==y.lo;}
    else ok=a==null?b==null:a.equals(b);
    if(!ok)throw new AssertionError(name+" payload: "+a+" / "+b);
  }
  static void check(String name,Class<?> type,Object x,Object fallback) throws Exception {
    // Optional payload lanes retain their raw int ABI; direct Uint32 Java
    // parameters and results expose the unsigned value as long.
    Class<?> entryType=name.equals("U32")?long.class:type;
    boolean ref=name.equals("Reference")||name.equals("BigInt");
    boolean full=name.equals("F64")||name.equals("I64")||name.equals("U64");
    for(boolean d:new boolean[]{false,true}) {
      Object scratch=name.equals("F64")?new double[]{-333.25}:new long[]{0x123456789abcdefL};
      Object packed=full?call("make"+name,new Class<?>[]{boolean.class,entryType,scratch.getClass()},d,x,scratch):call("make"+name,new Class<?>[]{boolean.class,entryType},d,x);
      Object[] pair=unpack(name,packed,scratch);
      if((Boolean)pair[1]!=d)throw new AssertionError(name+" make defined");
      if(d)same(name,pair[0],x);
      Object other=full?call("make"+name,new Class<?>[]{boolean.class,entryType,scratch.getClass()},!d,fallback,scratch):call("make"+name,new Class<?>[]{boolean.class,entryType},!d,fallback);
      Object[] opposite=unpack(name,other,scratch);
      for(boolean exchange:new boolean[]{false,true}) {
        Object changed=ref?call("swap"+name,new Class<?>[]{boolean.class,Object.class,Object.class},exchange,pair[0],opposite[0]):full?call("swap"+name,new Class<?>[]{boolean.class,type,boolean.class,type,boolean.class,scratch.getClass()},exchange,pair[0],pair[1],opposite[0],opposite[1],scratch):call("swap"+name,new Class<?>[]{boolean.class,type,boolean.class,type,boolean.class},exchange,pair[0],pair[1],opposite[0],opposite[1]);
        Object[] swapped=unpack(name,changed,scratch);
        if((Boolean)swapped[1]!=(exchange?!d:d))throw new AssertionError(name+" swapped definedness");
        if((Boolean)swapped[1])same(name,swapped[0],exchange?fallback:x);
      }
      packed=ref?call("identity"+name,new Class<?>[]{Object.class},pair[0]):full?call("identity"+name,new Class<?>[]{type,boolean.class,scratch.getClass()},pair[0],d,scratch):call("identity"+name,new Class<?>[]{type,boolean.class},pair[0],d);
      pair=unpack(name,packed,scratch);
      boolean defined=(Boolean)(ref?call("defined"+name,new Class<?>[]{Object.class},pair[0]):call("defined"+name,new Class<?>[]{type,boolean.class},pair[0],pair[1]));
      if(defined!=d)throw new AssertionError(name+" identity defined");
      Object read=ref?call("read"+name,new Class<?>[]{Object.class,type},pair[0],fallback):call("read"+name,new Class<?>[]{type,boolean.class,entryType},pair[0],pair[1],fallback);
      same(name,read,d?x:fallback);
      same(name,call("roundtrip"+name,new Class<?>[]{boolean.class,entryType,entryType},d,x,fallback),d?x:fallback);
    }
  }
  public static void main(String[] args) throws Exception {
    check("Bool",boolean.class,true,false);
    for(String name:new String[]{"I8","U8","I16","U16","I32"}) {
      int min=name.equals("I8")?-128:name.equals("U8")?0:name.equals("I16")?-32768:name.equals("U16")?0:Integer.MIN_VALUE;
      int max=name.equals("I8")?127:name.equals("U8")?255:name.equals("I16")?32767:name.equals("U16")?65535:Integer.MAX_VALUE;
      check(name,int.class,min,max);check(name,int.class,max,min);
    }
    for(long x:new long[]{0L,0x7fffffffL,0x80000000L,0xffffffffL})check("U32",int.class,x,0xffffffffL-x);
    for(String name:new String[]{"I64","U64"}){check(name,long.class,Long.MIN_VALUE,Long.MAX_VALUE);check(name,long.class,Long.MAX_VALUE,Long.MIN_VALUE);}
    for(int bits:new int[]{0,0x80000000,0x7f800000,0xff800000,0x7fc00001,0x7fffffff,0xffc12345,1,0x3f800000})check("F32",float.class,Float.intBitsToFloat(bits),-99.0f);
    for(long bits:new long[]{0,0x8000000000000000L,0x7ff0000000000000L,0xfff0000000000000L,0x7ff8000000000001L,0x7fffffffffffffffL,0xfff8123456789abcL,1,0x3ff0000000000000L})check("F64",double.class,Double.longBitsToDouble(bits),-99.0);
    check("BigInt",NtsBigInt.class,NtsBigInt.of(Long.MIN_VALUE,1),NtsBigInt.of(Long.MAX_VALUE,-1));
    check("Reference",String.class,null,"fallback");check("Reference",String.class,"payload","fallback");
    for(int repeat=0;repeat<50;repeat++)for(boolean d:new boolean[]{false,true}) {
      double[] out={123.0};
      boolean found=Program.recursiveF64(12,-0.0,d,out);
      if(found!=d)throw new AssertionError("recursive definedness");
      if(d && Double.doubleToRawLongBits(out[0])!=0x8000000000000000L)throw new AssertionError("recursive payload");
    }
    final Throwable[] failures=new Throwable[4];
    Thread[] workers=new Thread[4];
    for(int i=0;i<workers.length;i++) {
      final int id=i;
      workers[i]=new Thread(new Runnable(){public void run(){try {
        for(int repeat=0;repeat<200;repeat++) {
          double value=1000.25*id+repeat;
          double[] out={-1.0};
          if(!Program.recursiveF64(8,value,true,out)||out[0]!=value)throw new AssertionError("concurrent scratch");
        }
      } catch(Throwable error){failures[id]=error;}}});
      workers[i].start();
    }
    for(Thread worker:workers)worker.join();
    for(Throwable failure:failures)if(failure!=null)throw new AssertionError("scratch isolation",failure);
    System.out.println("OPTIONAL_JVM_MATRIX_PASS");
  }
}
"#;
