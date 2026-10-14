package com.acme.tool;

import com.acme.sdk.Sdk;

public final class Main {
    public static void main(String[] args) {
        Sdk sdk = new Sdk();
        sdk.remember("ran", "1");
        System.out.println(sdk.sessionMillis());
    }
}
