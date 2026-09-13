package com.example.ui;

/** A class TypeScript extends, with an overridable hook and public fields. */
public class Widget {
    public int left;
    public int top;
    public int right;
    public int bottom;

    /** Overridden from TypeScript. */
    public void onMeasure(int width, int height) { }

    /**
     * The primitive overload pair Android publishes constantly. Preferring the
     * four-int form means no `Rect` is constructed, nothing escapes, and there
     * is nothing to copy.
     */
    public void setBounds(int left, int top, int right, int bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    /** A single-abstract-method interface declared on the base class. */
    public interface Task {
        /** An interface field: implicitly `public static final`, and inherited
         *  by every implementor. Also a `ConstantValue`, so provably non-null
         *  and an `ldc` rather than a `getstatic`. */
        String KIND = "task";

        void run(int id);
    }

    /** A static on the base class. `View.defaultPadding()` is legal Java, and
     *  the generated TypeScript classes carry no `extends`, so it has to be
     *  listed on the subclass or it is unreachable. */
    public static int defaultPadding() {
        return 8;
    }

    /** An interface extending another: its own method plus the parent's. */
    public interface Pressable extends Task {
        void press();
    }

    /** Varargs, and inherited by `View` -- the intersection nothing covered. */
    public void setPadding(int... values) {
        for (int v : values) { left += v; }
    }

    /** NOT a SAM parameter: `Pressable` has two abstract methods once its
     *  superinterface is counted, so Java accepts no lambda for it either. */
    public void press(Pressable p) {
        p.press();
    }

    /** A SAM parameter, also inherited. */
    public void post(Task task) {
        task.run(left);
    }

    public void setBounds(Rect bounds) {
        setBounds(bounds.left, bounds.top, bounds.right, bounds.bottom);
    }
}
