import java.io.ByteArrayInputStream
import java.io.FileOutputStream
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

if (file("google-services.json").exists() && file("google-services.json").length() > 10L) {
    apply(plugin = "com.google.gms.google-services")
}

// Existing production PKCS12 keystore (`keystore/release.keystore`) is preserved as-is so every
// GitHub Actions and local release build uses the exact same certificate (preventing INSTALL_FAILED_UPDATE_INCOMPATIBLE).
// Supports environment/Gradle property overrides without hardcoding secrets in CI workflows.
val keystorePathOverride = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
    ?: project.findProperty("androidKeystorePath")?.toString()?.takeIf { it.isNotBlank() }
val fixedKeystoreFile = if (keystorePathOverride != null) file(keystorePathOverride) else file("keystore/release.keystore")
val keyPemFile = file("kashish-signing-key.pem")
val certPemFile = file("kashish-signing-cert.pem")
val resolvedStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }
    ?: project.findProperty("androidKeystorePassword")?.toString()?.takeIf { it.isNotBlank() }
    ?: "kashish123456"
val resolvedKeyAlias = System.getenv("ANDROID_KEY_ALIAS")?.takeIf { it.isNotBlank() }
    ?: project.findProperty("androidKeyAlias")?.toString()?.takeIf { it.isNotBlank() }
    ?: "kashish_key"
val resolvedKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")?.takeIf { it.isNotBlank() }
    ?: project.findProperty("androidKeyPassword")?.toString()?.takeIf { it.isNotBlank() }
    ?: resolvedStorePassword

// Never overwrite an existing production keystore; only reconstruct from PEM if keystore is absent.
if (!fixedKeystoreFile.exists() && keyPemFile.exists() && certPemFile.exists()) {
    fixedKeystoreFile.parentFile?.mkdirs()
    val keyBase64 = keyPemFile.readText()
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace("\\s+".toRegex(), "")
    val keyBytes = Base64.getDecoder().decode(keyBase64)
    val privateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(keyBytes))

    val certFactory = CertificateFactory.getInstance("X.509")
    val cert = certFactory.generateCertificate(ByteArrayInputStream(certPemFile.readBytes()))

    val ks = KeyStore.getInstance("PKCS12")
    ks.load(null, null)
    ks.setKeyEntry(resolvedKeyAlias, privateKey, resolvedKeyPassword.toCharArray(), arrayOf(cert))
    FileOutputStream(fixedKeystoreFile).use { out ->
        ks.store(out, resolvedStorePassword.toCharArray())
    }
}

android {
    namespace = "com.kashish.world"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kashishhh.app"
        minSdk = 24
        targetSdk = 34
        versionCode = (project.findProperty("versionCodeProp")?.toString()?.toIntOrNull()) ?: 2000
        versionName = (project.findProperty("versionNameProp")?.toString()) ?: "3.2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            storeFile = fixedKeystoreFile
            storePassword = resolvedStorePassword
            keyAlias = resolvedKeyAlias
            keyPassword = resolvedKeyPassword
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")

    implementation("androidx.annotation:annotation-experimental:1.4.0")

    // Native Media3 ExoPlayer + Disk Cache for zero-stutter background music & hardware Equalizer
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-datasource:1.4.1")
    implementation("androidx.media3:media3-database:1.4.1")
    implementation("androidx.media3:media3-common:1.4.1")

    // Firebase Cloud Messaging for high-priority data push notifications
    implementation(platform("com.google.firebase:firebase-bom:33.1.2"))
    implementation("com.google.firebase:firebase-messaging")
}
