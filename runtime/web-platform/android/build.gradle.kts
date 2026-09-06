// Include as a module in an existing Android project; the parent owns AGP version.
plugins { id("com.android.library") }
android {
    namespace = "org.nts.web"
    compileSdk = providers.gradleProperty("ntsAndroidCompileSdk").orElse("36").get().toInt()
    defaultConfig { minSdk = 26; consumerProguardFiles("consumer-rules.pro") }
    sourceSets["main"].java.srcDirs("src/main/java", "src/android/java")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
