plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

if (file("google-services.json").exists() && file("google-services.json").length() > 10L) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.kashish.world"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kashish.world"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "2.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
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
