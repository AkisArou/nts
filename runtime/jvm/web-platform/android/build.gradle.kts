// Include as a module in an existing Android project; the parent owns AGP version.
plugins { id("com.android.library") }
android {
    namespace = "org.nts.web"
    compileSdk = providers.gradleProperty("ntsAndroidCompileSdk").orElse("36").get().toInt()
    // **29, and the reason is ALPN.** `SSLParameters.setApplicationProtocols`
    // and `SSLSocket.getApplicationProtocol` are absent below it -- measured on
    // a device, and the API-26 stub declares all three anyway -- so a provider
    // there cannot report which protocol TLS selected and cannot honestly offer
    // a choice. 29 is where HTTP/2 becomes negotiable without reflecting into
    // Conscrypt's hidden API, which this lane's dependency rules forbid.
    defaultConfig { minSdk = 29; consumerProguardFiles("consumer-rules.pro") }
    sourceSets["main"].java.srcDirs("src/main/java", "src/android/java")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

// **No runtime dependencies.** OkHttp is gone: its only unique value was ALPN
// below API 29, and the floor is 29. Everything else it supplied is either
// shared TypeScript's (HTTP/2, HPACK, pooling, redirects, cookies, cache,
// decompression) or already in `NtsSocket` (TLS, hostname verification, SNI,
// CONNECT and SOCKS). `dependencies.tsv` still pins R8, which is a build tool
// and not in the artifact.
