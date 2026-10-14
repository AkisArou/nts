package com.acme.app;

import android.app.Activity;
import android.os.Bundle;

// Ordinary Android. The only unusual line is the import: `com.acme.sdk` is
// TypeScript, compiled to class files, and nothing here can tell.
import com.acme.sdk.Sdk;

public final class MainActivity extends Activity {
    private final Sdk sdk = new Sdk();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        sdk.remember("opened", "1");
        sdk.notify("welcome", "Acme", "Thanks for installing.");
    }
}
