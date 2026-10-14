import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * Loads and links every class in the runtime jar it is given, so that one run
 * under {@code -XX:ArchiveClassesAtExit} archives all of them: the warm-up
 * {@code tooling/jvm/launch.ts} dumps a program's class-data archive with.
 *
 * <p>Outside the runtime jar on purpose. The archive is valid only for a class
 * path that begins with the one it was dumped with, and a class path entry an
 * archive holds may not be a non-empty directory, so the warm-up travels as a
 * jar of its own, after the runtime's and before the program's classes, at run
 * time as at dump time.
 */
public final class NtsCdsWarm {
    private NtsCdsWarm() {}

    public static void main(String[] args) throws Exception {
        ClassLoader loader = NtsCdsWarm.class.getClassLoader();
        try (JarFile jar = new JarFile(args[0])) {
            for (Enumeration<JarEntry> entries = jar.entries(); entries.hasMoreElements(); ) {
                String name = entries.nextElement().getName();
                if (name.endsWith(".class")) {
                    Class.forName(name.substring(0, name.length() - 6).replace('/', '.'), false, loader);
                }
            }
        }
    }
}
