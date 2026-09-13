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
        void run(int id);
    }

    /** Varargs, and inherited by `View` -- the intersection nothing covered. */
    public void setPadding(int... values) {
        for (int v : values) { left += v; }
    }

    /** A SAM parameter, also inherited. */
    public void post(Task task) {
        task.run(left);
    }

    public void setBounds(Rect bounds) {
        setBounds(bounds.left, bounds.top, bounds.right, bounds.bottom);
    }
}
