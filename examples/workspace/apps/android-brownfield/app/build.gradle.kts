// **Their file, not ours.** This is the existing app's Gradle build, shown as it
// would already look before we appear in it -- the only new line is the
// dependency. That is the whole claim of a brownfield story: adoption is one
// line in a file somebody else owns.
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
