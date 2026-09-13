package com.example.ui;

/**
 * An abstract class with a public constructor -- 26 of 491 public classes in
 * the sampled `android.jar` have this exact shape, and it is the one where the
 * generated declaration let TypeScript write `new Drawable()`.
 */
public abstract class Drawable {
    private int alpha;

    public Drawable() {
        this.alpha = 255;
    }

    public int alpha() {
        return alpha;
    }

    /** The reason it is abstract. */
    public abstract void draw(Rect bounds);
}
