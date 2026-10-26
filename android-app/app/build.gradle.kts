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

// Deterministic, permanent PKCS12 keystore generated from committed PEM key & certificate.
// Guarantees every GitHub Actions build and local build uses the exact same signing key,
// permanently preventing "App not installed as package conflicts with an existing package" (INSTALL_FAILED_UPDATE_INCOMPATIBLE).
val fixedKeystoreFile = file("keystore/release.keystore")
val keyPemFile = file("kashish-signing-key.pem")
val certPemFile = file("kashish-signing-cert.pem")
val fixedStorePassword = "kashish123456"
val fixedKeyAlias = "kashish_key"

if (keyPemFile.exists() && certPemFile.exists()) {
    try {
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
        ks.setKeyEntry(fixedKeyAlias, privateKey, fixedStorePassword.toCharArray(), arrayOf(cert))
        FileOutputStream(fixedKeystoreFile).use { out ->
            ks.store(out, fixedStorePassword.toCharArray())
        }
    } catch (e: Exception) {
        println("Warning: Could not regenerate PKCS12 from PEM, using existing keystore: ${e.message}")
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
        versionName = (project.findProperty("versionNameProp")?.toString()) ?: "3.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            storeFile = fixedKeystoreFile
            storePassword = fixedStorePassword
            keyAlias = fixedKeyAlias
            keyPassword = fixedStorePassword
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

    // Firebase Cloud Messaging for high-priority data push notifications
    implementation(platform("com.google.firebase:firebase-bom:33.1.2"))
    implementation("com.google.firebase:firebase-messaging")
}
