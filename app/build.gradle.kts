import java.util.Base64
import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.google.devtools.ksp)
}

android {
  namespace = "fr.bullix.app"
  compileSdk = 36

  val versionPropsFile = file("${rootDir}/version.properties")
  val versionProps = Properties()
  if (versionPropsFile.exists()) {
    versionProps.load(versionPropsFile.inputStream())
  }
  val appVersionCode = (project.findProperty("appVersionCode") as? String)?.toIntOrNull()
    ?: (versionProps.getProperty("versionCode", "1").toIntOrNull() ?: 1)
  val appVersionName = (project.findProperty("appVersionName") as? String)
    ?: versionProps.getProperty("versionName", "1.0.0")

  val envProps = Properties()
  val envExampleFile = file("${rootDir}/.env.example")
  if (envExampleFile.exists()) {
    envProps.load(envExampleFile.inputStream())
  }
  val envFile = file("${rootDir}/.env")
  if (envFile.exists()) {
    envProps.load(envFile.inputStream())
  }
  val apiUrl = envProps.getProperty("BULLIX_API_URL", "https://bullix.pages.dev")

  defaultConfig {
    applicationId = "fr.bullix.app"
    minSdk = 24
    targetSdk = 36
    versionCode = appVersionCode
    versionName = appVersionName

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    buildConfigField("String", "BULLIX_API_URL", "\"$apiUrl\"")
  }

  val keystoreFile = file("${rootDir}/app/debug.keystore")
  val keystoreBase64File = file("${rootDir}/app/debug.keystore.base64")
  if (!keystoreFile.exists() && keystoreBase64File.exists()) {
    val decoded = Base64.getDecoder().decode(keystoreBase64File.readText().trim())
    keystoreFile.writeBytes(decoded)
  }

  signingConfigs {
    getByName("debug") {
      storeFile = keystoreFile
      storePassword = "android"
      keyAlias = "androiddebugkey"
      keyPassword = "android"
    }
  }

  buildTypes {
    debug {
      signingConfig = signingConfigs.getByName("debug")
    }
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.activity.compose)

  // Compose
  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.material.icons.extended)
  implementation(libs.androidx.navigation.compose)
  implementation(libs.coil.compose)

  // Room SQLite Local Database
  implementation(libs.androidx.room.runtime)
  implementation(libs.androidx.room.ktx)
  ksp(libs.androidx.room.compiler)

  // WorkManager (Offline-First Sync)
  implementation(libs.androidx.work.runtime.ktx)

  // Coroutines
  implementation(libs.kotlinx.coroutines.core)
  implementation(libs.kotlinx.coroutines.android)

  // CameraX & ML Kit (Barcode + OCR)
  implementation(libs.androidx.camera.core)
  implementation(libs.androidx.camera.camera2)
  implementation(libs.androidx.camera.lifecycle)
  implementation(libs.androidx.camera.view)
  implementation(libs.mlkit.barcode.scanning)
  implementation(libs.mlkit.text.recognition)
  implementation(libs.accompanist.permissions)

  // Network & JSON
  implementation(libs.okhttp)
  implementation(libs.moshi)
  implementation(libs.moshi.kotlin)

  // Test
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.androidx.espresso.core)
  debugImplementation(libs.androidx.compose.ui.tooling)
}
