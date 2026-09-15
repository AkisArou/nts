// **Their file.** An existing single-module Android app, shown as it would
// already look -- the only line we caused is the dependency at the bottom.
plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "com.acme.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.acme.app"
        minSdk = 29
    }

    // **Android is the one host with somewhere for us to live inside its own
    // conventions.** `sourceSets` takes extra source directories, so our
    // TypeScript could be `src/main/ts` rather than `nts/` at the root --
    // `runtime/jvm/web-platform/android/build.gradle.kts` already does exactly
    // this for `src/android/java`. Left at `nts/` for uniformity with the other
    // six, whose build systems have no equivalent notion, and noted here because
    // the asymmetry is real: Android could absorb us and CMake cannot.
    //
    // sourceSets["main"].java.srcDirs("src/main/java", "src/main/ts")

    buildTypes {
        release {
            isMinifyEnabled = true
            // Our AAR ships `consumerProguardFiles`, so nothing here names our
            // classes. If it had to, the library would be leaking its own
            // packaging problem into its consumer's build file.
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")

    // Us. An AAR resolved like any other -- which is the requirement this app
    // exists to state: a directory of class files is not a thing Gradle
    // resolves, and `emit-jvm --out` produces a directory of class files.
    implementation("com.acme:sdk:0.1.0")
}
