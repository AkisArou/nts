// Include as a module in an existing Android project; the parent owns AGP version.
plugins { id("com.android.library") }
android {
    namespace = "org.nts.web"
    compileSdk = providers.gradleProperty("ntsAndroidCompileSdk").orElse("36").get().toInt()
    defaultConfig { minSdk = 26; consumerProguardFiles("consumer-rules.pro") }
    // `src/okhttp` is the production dispatcher and is a separate source set
    // because it is the only one that needs a third-party dependency. Keeping
    // it apart is what lets `src/main` be compiled and tested against real
    // sockets with nothing on the classpath at all.
    sourceSets["main"].java.srcDirs("src/main/java", "src/android/java", "src/okhttp/java")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

// Exact versions, matching `dependencies.tsv`, which also carries the SHA-256
// digests and the licenses. A range or a `+` here would let the artifact that
// ships differ from the artifact that was reviewed.
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
