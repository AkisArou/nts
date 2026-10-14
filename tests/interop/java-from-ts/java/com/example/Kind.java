package com.example;

/** An enum, to exercise the "enums fall out of static constants" proposal. */
public enum Kind {
    SMALL,
    MEDIUM,
    LARGE;

    public int weight() {
        return ordinal() * 10;
    }
}
