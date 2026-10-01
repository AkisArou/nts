// Link every class under a directory, so the JVM verifies it: the driver
// jvm-verifies.ts runs, as `java -Xverify:all -cp <dir>:<runtime jar>
// JvmVerify.java <dir>` (the single-file launcher; nothing is compiled).
//
// Loading a class does not verify it -- verification happens when it is
// *linked*, which HotSpot does lazily. `Class.forName(name, false, loader)`
// loads without initialising (no static initialiser runs, so nothing the
// program does happens here), and reflecting over its declared members links
// it. One line per class that fails, then a summary line the driver reads:
//
//   INVALID <class> <throwable>: <message>     VerifyError, ClassFormatError
//   MISSING <class> <throwable>: <message>     a reference that does not resolve
//   UNRESOLVED <class> <owner>.<name><descriptor>
//                                              a member ref no generated class holds
//   SHADOWED <class> <name><descriptor>         an override whose raising copy is
//                                              left to the ancestor's
//   UNFILLED <class> <name><descriptor>         an abstract raising entry a concrete
//                                              class never implements
//
// **UNRESOLVED is the one the verifier cannot give.** Linkage of a member is
// lazy: `invokevirtual Callable.erased_call$raises` verifies whatever
// `Callable` declares, and fails as NoSuchMethodError only when a call reaches
// it -- which is how the raising entry's first cut passed this tool and
// aborted when run (2026-09-30). So each generated class's constant pool is
// read directly, and every field and method ref whose owner is a class in the
// same output is resolved by name and descriptor up that owner's superclasses
// and interfaces. Refs to classes outside the output (the runtime jar, the
// JDK) are left to the JVM, whose own classes do not drift under a compiler.
//
// **SHADOWED is the one linkage cannot give either.** A raising copy is an
// ordinary virtual method, `m$raises`, and the JVM dispatches it by name and
// descriptor like any other. A class that overrides `m` and does not override
// `m$raises` at the same descriptor resolves the raising call to the
// ancestor's copy -- it links, verifies and runs the wrong body. TypeScript's
// arity-tolerant overriding makes the gap easy to open: `Transform`'s `_read()`
// is an overload of `Readable#_read(D)V`, not an override, and only the bridge
// beside it overrides. So each class's own `m` that overrides an ancestor's,
// where that ancestor also declares a concrete `m$raises` with the same
// parameters, must declare its own `m$raises` too -- once some instruction in
// the output calls `m$raises` on that ancestor or below. Before then it is a
// copy nothing dispatches to (on 2026-10-01 `Readable#_read$raises`, overridden
// by `Transform`, `DuplexSide` and `IncomingMessage` and called by nobody,
// since the one virtual site refuses), and a hazard nothing reaches is not yet
// a failure. An *abstract* inherited copy is not this: it is the raising entry
// `Callable` declares and a closure that cannot raise leaves unfilled, which
// a call reaching it reports as AbstractMethodError rather than a wrong body.
//   VERIFIED <n> OF <m>
import java.io.DataInputStream;
import java.io.IOException;
import java.lang.invoke.MethodType;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

public class JvmVerify {
  public static void main(String[] args) throws IOException {
    Path root = Path.of(args[0]);
    List<String> names;
    try (Stream<Path> files = Files.walk(root)) {
      names = files
          .filter(p -> p.toString().endsWith(".class"))
          .map(p -> root.relativize(p).toString().replace('/', '.').replaceAll("\\.class$", ""))
          .sorted()
          .toList();
    }
    ClassLoader loader = JvmVerify.class.getClassLoader();
    int verified = 0;
    Set<String> raisingCalls = new HashSet<>();
    Set<String> instantiated = new HashSet<>();
    List<Class<?>> loaded = new ArrayList<>();
    for (String name : names) {
      try {
        Class<?> c = Class.forName(name, false, loader);
        c.getDeclaredMethods();
        c.getDeclaredFields();
        verified += 1;
        unresolved(root, name, names, loader, raisingCalls, instantiated);
        loaded.add(c);
      } catch (VerifyError | ClassFormatError e) {
        System.out.println("INVALID " + name + " " + e.getClass().getSimpleName() + ": " + oneLine(e.getMessage()));
      } catch (LinkageError | ClassNotFoundException e) {
        System.out.println("MISSING " + name + " " + e.getClass().getSimpleName() + ": " + oneLine(e.getMessage()));
      }
    }
    for (Class<?> c : loaded) {
      shadowed(c, raisingCalls);
      if (instantiated.contains(c.getName())) unfilled(c, raisingCalls);
    }
    System.out.println("VERIFIED " + verified + " OF " + names.size());
  }

  /** Print one UNRESOLVED line per member ref of `name` that no output class holds. */
  private static void unresolved(
      Path root, String name, List<String> names, ClassLoader loader, Set<String> raisingCalls, Set<String> instantiated)
      throws IOException {
    Set<String> ours = new HashSet<>(names);
    for (String[] ref : memberRefs(root.resolve(name.replace('.', '/') + ".class"))) {
      String owner = ref[0].replace('/', '.');
      if (ref[3].equals("N")) {
        instantiated.add(owner);
        continue;
      }
      if (!ours.contains(owner)) continue;
      boolean method = ref[3].equals("M");
      if (method && ref[1].endsWith("$raises")) raisingCalls.add(owner + "." + ref[1] + ref[2]);
      try {
        Class<?> c = Class.forName(owner, false, loader);
        if (!(method ? hasMethod(c, ref[1], ref[2]) : hasField(c, ref[1], ref[2]))) {
          System.out.println("UNRESOLVED " + name + " " + ref[0] + "." + ref[1] + ref[2]);
        }
      } catch (LinkageError | ClassNotFoundException e) {
        // The owner itself does not load; it is reported as MISSING or INVALID on its own line.
      }
    }
  }

  /**
   * Print one SHADOWED line per override of `c` whose raising copy only an
   * ancestor declares concretely, where an instruction calls that copy on an
   * owner `c` is or descends from.
   */
  private static void shadowed(Class<?> c, Set<String> raisingCalls) {
    List<Class<?>> lineage = ancestry(c);
    for (Method m : c.getDeclaredMethods()) {
      if (Modifier.isStatic(m.getModifiers()) || m.getName().endsWith("$raises")) continue;
      String copy = m.getName() + "$raises";
      Class<?>[] params = m.getParameterTypes();
      if (declared(c, copy, params) != null) continue;
      for (Class<?> at : lineage) {
        if (at == c) continue;
        Method inherited = declared(at, copy, params);
        if (inherited == null || Modifier.isAbstract(inherited.getModifiers()) || declared(at, m.getName(), params) == null) continue;
        String descriptor = MethodType.methodType(inherited.getReturnType(), params).toMethodDescriptorString();
        boolean reached = lineage.stream().anyMatch(owner -> raisingCalls.contains(owner.getName() + "." + copy + descriptor));
        if (reached) System.out.println("SHADOWED " + c.getName() + " " + copy + descriptor + " runs " + at.getName() + "'s");
        break;
      }
    }
  }

  /**
   * Print one UNFILLED line per abstract `m$raises` that concrete `c` -- one a
   * `new` somewhere in the output instantiates -- inherits,
   * implements nowhere in its class chain, and an instruction calls on an owner
   * `c` is or descends from -- an `AbstractMethodError` when that call reaches a
   * `c`, which neither the verifier nor linkage reports.
   */
  private static void unfilled(Class<?> c, Set<String> raisingCalls) {
    if (c.isInterface() || Modifier.isAbstract(c.getModifiers())) return;
    List<Class<?>> lineage = ancestry(c);
    Set<String> seen = new HashSet<>();
    for (Class<?> at : lineage) {
      for (Method m : at.getDeclaredMethods()) {
        if (!Modifier.isAbstract(m.getModifiers()) || !m.getName().endsWith("$raises")) continue;
        String descriptor = MethodType.methodType(m.getReturnType(), m.getParameterTypes()).toMethodDescriptorString();
        if (!seen.add(m.getName() + descriptor)) continue;
        boolean filled = false;
        for (Class<?> k = c; k != null && !filled; k = k.getSuperclass()) {
          Method concrete = declared(k, m.getName(), m.getParameterTypes());
          filled = concrete != null && !Modifier.isAbstract(concrete.getModifiers());
        }
        if (filled) continue;
        String name = m.getName();
        boolean reached = lineage.stream().anyMatch(owner -> raisingCalls.contains(owner.getName() + "." + name + descriptor));
        if (reached) System.out.println("UNFILLED " + c.getName() + " " + name + descriptor + " declared abstract by " + at.getName());
      }
    }
  }

  /** The instance method `at` itself declares with this name and these parameters, or null. */
  private static Method declared(Class<?> at, String name, Class<?>[] params) {
    for (Method m : at.getDeclaredMethods()) {
      if (!Modifier.isStatic(m.getModifiers()) && m.getName().equals(name) && Arrays.equals(m.getParameterTypes(), params)) {
        return m;
      }
    }
    return null;
  }

  /**
   * [owner, name, descriptor, "M" or "F"] for every field and method ref an
   * instruction names, and [class, "", "", "N"] for every class a `new` names --
   * *instruction* names -- not every one in the pool. A pool keeps entries no
   * code uses (the emitter renders a function, then declines it and its
   * callers, and the entries stay), and a ref nothing executes links nothing.
   */
  private static List<String[]> memberRefs(Path file) throws IOException {
    List<String[]> refs = new ArrayList<>();
    try (DataInputStream in = new DataInputStream(Files.newInputStream(file))) {
      in.readInt();
      in.readUnsignedShort();
      in.readUnsignedShort();
      int count = in.readUnsignedShort();
      String[] utf8 = new String[count];
      int[] classAt = new int[count];
      int[][] nameAndType = new int[count][];
      int[][] member = new int[count][];
      char[] kind = new char[count];
      for (int i = 1; i < count; i++) {
        int tag = in.readUnsignedByte();
        switch (tag) {
          case 1 -> utf8[i] = in.readUTF();
          case 3, 4 -> in.readInt();
          case 5, 6 -> { in.readLong(); i++; }
          case 7 -> classAt[i] = in.readUnsignedShort();
          case 8, 16, 19, 20 -> in.readUnsignedShort();
          case 9, 10, 11 -> {
            member[i] = new int[] {in.readUnsignedShort(), in.readUnsignedShort()};
            kind[i] = tag == 9 ? 'F' : 'M';
          }
          case 12 -> nameAndType[i] = new int[] {in.readUnsignedShort(), in.readUnsignedShort()};
          case 15 -> { in.readUnsignedByte(); in.readUnsignedShort(); }
          case 17, 18 -> { in.readUnsignedShort(); in.readUnsignedShort(); }
          default -> throw new IOException("constant pool tag " + tag + " at " + i + " in " + file);
        }
      }
      in.readUnsignedShort();
      in.readUnsignedShort();
      in.readUnsignedShort();
      in.skipNBytes(2L * in.readUnsignedShort());
      int fields = in.readUnsignedShort();
      for (int f = 0; f < fields; f++) {
        in.skipNBytes(6);
        skipAttributes(in);
      }
      Set<Integer> used = new HashSet<>();
      int methods = in.readUnsignedShort();
      for (int m = 0; m < methods; m++) {
        in.skipNBytes(6);
        int attributes = in.readUnsignedShort();
        for (int a = 0; a < attributes; a++) {
          String attribute = utf8[in.readUnsignedShort()];
          int length = in.readInt();
          if (!"Code".equals(attribute)) {
            in.skipNBytes(length);
            continue;
          }
          byte[] body = in.readNBytes(length);
          int codeLength = ((body[4] & 0xff) << 24) | ((body[5] & 0xff) << 16) | ((body[6] & 0xff) << 8) | (body[7] & 0xff);
          byte[] code = java.util.Arrays.copyOfRange(body, 8, 8 + codeLength);
          operands(code, used);
        }
      }
      for (int i : used) {
        if (i > 0 && i < count && member[i] == null && classAt[i] != 0) {
          refs.add(new String[] {utf8[classAt[i]], "", "", "N"});
          continue;
        }
        if (i <= 0 || i >= count || member[i] == null) continue;
        String owner = utf8[classAt[member[i][0]]];
        int[] nt = nameAndType[member[i][1]];
        refs.add(new String[] {owner, utf8[nt[0]], utf8[nt[1]], String.valueOf(kind[i])});
      }
    }
    return refs;
  }

  private static void skipAttributes(DataInputStream in) throws IOException {
    int attributes = in.readUnsignedShort();
    for (int a = 0; a < attributes; a++) {
      in.readUnsignedShort();
      in.skipNBytes(in.readInt());
    }
  }

  /** Add the pool index of every field and invoke instruction in `code` to `used`. */
  private static void operands(byte[] code, Set<Integer> used) throws IOException {
    int pc = 0;
    while (pc < code.length) {
      int op = code[pc] & 0xff;
      // getstatic..invokestatic (0xb2..0xb8) and invokeinterface (0xb9) name a
      // field or method ref in the two bytes after the opcode.
      // `new` (0xbb) names a class ref the same way, which is how a class is
      // known to be instantiated.
      if (((op >= 0xb2 && op <= 0xb9) || op == 0xbb) && pc + 2 < code.length) {
        used.add(((code[pc + 1] & 0xff) << 8) | (code[pc + 2] & 0xff));
      }
      pc += width(code, pc, op);
    }
  }

  /** The length of the instruction at `pc`, JVMS 6.5. */
  private static int width(byte[] code, int pc, int op) throws IOException {
    switch (op) {
      case 0xaa -> {
        int base = (pc + 4) & ~3;
        int low = readInt(code, base + 4);
        int high = readInt(code, base + 8);
        return base + 12 + 4 * (high - low + 1) - pc;
      }
      case 0xab -> {
        int base = (pc + 4) & ~3;
        int pairs = readInt(code, base + 4);
        return base + 8 + 8 * pairs - pc;
      }
      case 0xc4 -> {
        return (code[pc + 1] & 0xff) == 0x84 ? 6 : 4;
      }
      default -> {
        return WIDTHS[op];
      }
    }
  }

  private static int readInt(byte[] code, int at) {
    return ((code[at] & 0xff) << 24) | ((code[at + 1] & 0xff) << 16) | ((code[at + 2] & 0xff) << 8) | (code[at + 3] & 0xff);
  }

  /** Instruction lengths by opcode; 0 marks one handled in `width`, or unassigned. */
  private static final int[] WIDTHS = new int[256];
  static {
    java.util.Arrays.fill(WIDTHS, 1);
    for (int op : new int[] {0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0xbc}) WIDTHS[op] = 2;
    for (int op : new int[] {0x11, 0x13, 0x14, 0x84, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7}) WIDTHS[op] = 3;
    for (int op = 0x99; op <= 0xa8; op++) WIDTHS[op] = 3;
    WIDTHS[0xc5] = 4;
    WIDTHS[0xb9] = 5;
    WIDTHS[0xba] = 5;
    WIDTHS[0xc8] = 5;
    WIDTHS[0xc9] = 5;
  }

  /** Whether `c` declares or inherits a method of this name and descriptor. */
  private static boolean hasMethod(Class<?> c, String name, String descriptor) {
    if (name.equals("<init>")) {
      for (var k : c.getDeclaredConstructors()) {
        if (MethodType.methodType(void.class, k.getParameterTypes()).toMethodDescriptorString().equals(descriptor)) return true;
      }
      return false;
    }
    if (name.equals("<clinit>")) return true;
    for (Class<?> at : ancestry(c)) {
      for (Method m : at.getDeclaredMethods()) {
        if (m.getName().equals(name)
            && MethodType.methodType(m.getReturnType(), m.getParameterTypes()).toMethodDescriptorString().equals(descriptor)) {
          return true;
        }
      }
    }
    return false;
  }

  /** Whether `c` declares or inherits a field of this name and descriptor. */
  private static boolean hasField(Class<?> c, String name, String descriptor) {
    for (Class<?> at : ancestry(c)) {
      for (Field f : at.getDeclaredFields()) {
        if (f.getName().equals(name) && f.getType().descriptorString().equals(descriptor)) return true;
      }
    }
    return false;
  }

  /** `c`, its superclasses and every interface any of them implements. */
  private static List<Class<?>> ancestry(Class<?> c) {
    List<Class<?>> out = new ArrayList<>();
    List<Class<?>> todo = new ArrayList<>(List.of(c));
    while (!todo.isEmpty()) {
      Class<?> at = todo.remove(todo.size() - 1);
      if (at == null || out.contains(at)) continue;
      out.add(at);
      todo.add(at.getSuperclass());
      todo.addAll(List.of(at.getInterfaces()));
    }
    return out;
  }

  private static String oneLine(String message) {
    return message == null ? "" : message.replaceAll("\\s+", " ");
  }
}
