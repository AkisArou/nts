package com.example.ui;

/**
 * Shaped after `android.graphics.Rect`, which is the class that broke the
 * plan's first constraint: it surfaces its geometry as public mutable fields,
 * read directly all over Android.
 */
public final class Rect implements Comparable<Rect> {
    public int left;
    public int top;
    public int right;
    public int bottom;

    public Rect() { }

    public Rect(int left, int top, int right, int bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    /** A generic override: `javac` emits a synthetic bridge
     *  `compareTo(Object)` beside this, which is not API. */
    @Override
    public int compareTo(Rect other) {
        return Integer.compare(width(), other.width());
    }

    public int width() { return right - left; }
    public int height() { return bottom - top; }
}
