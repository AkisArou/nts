package com.example.ui;

/**
 * A value-returning callback, delivered SYNCHRONOUSLY on the calling thread.
 *
 * <p>This is the shape `View.OnTouchListener` has, and the one that cannot be
 * served by posting to an inbox: the framework uses the returned boolean to
 * decide whether the event was consumed, and it needs it now.
 */
public class View extends Widget {

    public interface OnTouch {
        /** Returns whether the event was consumed. */
        boolean onTouch(int x, int y);
    }

    private OnTouch listener;

    public void setOnTouch(OnTouch listener) {
        this.listener = listener;
    }

    /** Called by the framework on the thread that owns this view. */
    public boolean dispatchTouch(int x, int y) {
        return listener != null && listener.onTouch(x, y);
    }
}
