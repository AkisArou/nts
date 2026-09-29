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
//   VERIFIED <n> OF <m>
import java.io.IOException;
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
    for (String name : names) {
      try {
        Class<?> c = Class.forName(name, false, loader);
        c.getDeclaredMethods();
        c.getDeclaredFields();
        verified += 1;
      } catch (VerifyError | ClassFormatError e) {
        System.out.println("INVALID " + name + " " + e.getClass().getSimpleName() + ": " + oneLine(e.getMessage()));
      } catch (LinkageError | ClassNotFoundException e) {
        System.out.println("MISSING " + name + " " + e.getClass().getSimpleName() + ": " + oneLine(e.getMessage()));
      }
    }
    System.out.println("VERIFIED " + verified + " OF " + names.size());
  }

  private static String oneLine(String message) {
    return message == null ? "" : message.replaceAll("\\s+", " ");
  }
}
