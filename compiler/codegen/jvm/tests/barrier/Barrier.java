/**
 * Two publications that differ only in a keyword, so the compiler's answer to
 * it can be read.
 *
 * <p>Nothing here is run. The methods exist to be **compiled** by ART's
 * `dex2oat` and disassembled by `oatdump`: `publishVolatile` stores through a
 * `volatile` field and `publishPlain` through an ordinary one, and everything
 * else about them is identical, down to the parameter types.
 *
 * <p>That is the whole design. A barrier in one and not the other is only
 * evidence if the two are otherwise the same instruction sequence -- which they
 * are, byte for byte, apart from the field offset.
 */
public final class Barrier {
    public static final class Node {
        public Object value;
        public volatile Node next;
        public Node plainNext;
    }

    public static void publishVolatile(Node from, Node to) { from.next = to; }

    public static void publishPlain(Node from, Node to) { from.plainNext = to; }

    public static void main(String[] args) { System.out.println("barrier probe"); }
}
