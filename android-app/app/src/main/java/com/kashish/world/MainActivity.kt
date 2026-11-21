package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Custom WebView that keeps HTML5 / YouTube iframe audio playing smoothly when the user
 * switches apps or locks the phone screen by preventing Chromium from receiving GONE/INVISIBLE
 * window visibility signals while the app is running.
 */
class KeepAliveWebView(context: Context) : WebView(context) {
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(View.VISIBLE)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, View.VISIBLE)
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(true)
    }
}

@Suppress("UnsafeOptInUsageError")
class MainActivity : AppCompatActivity() {

    companion object {
        @Volatile
        private var activeWebViewRef: WeakReference<WebView>? = null
        private val mainHandler = Handler(Looper.getMainLooper())

        fun dispatchMediaAction(action: String) {
            mainHandler.post {
                val wv = activeWebViewRef?.get() ?: return@post
                try {
                    wv.onResume()
                    wv.resumeTimers()
                    val safeAction = JSONObject.quote(action)
                    wv.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('kashish-native-media-action', { detail: $safeAction }));",
                        null
                    )
                } catch (_: Exception) {}
            }
        }

        fun dispatchNativeAudioState(jsonPayload: String) {
            mainHandler.post {
                val wv = activeWebViewRef?.get() ?: return@post
                try {
                    val safeJson = JSONObject.quote(jsonPayload)
                    wv.evaluateJavascript(
                        "try { window.dispatchEvent(new CustomEvent('kashish-native-audio-state', { detail: JSON.parse($safeJson) })); } catch(e) {}",
                        null
                    )
                } catch (_: Exception) {}
            }
        }

        fun resolveNativeAsyncCallback(reqId: String, jsonPayload: String) {
            mainHandler.post {
                val wv = activeWebViewRef?.get() ?: return@post
                try {
                    val safeId = JSONObject.quote(reqId)
                    val safePayload = JSONObject.quote(jsonPayload)
                    wv.evaluateJavascript(
                        "try { if (window.__kashishResolveNativeReq) { window.__kashishResolveNativeReq($safeId, $safePayload); } } catch(e) {}",
                        null
                    )
                } catch (_: Exception) {}
            }
        }
    }

    private lateinit var webView: WebView
    private var filePickerCallback: ValueCallback<Array<Uri>>? = null
    private var cameraImageUri: Uri? = null

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        PermissionReporter.reportStatusAsync(this)
        if (grants[Manifest.permission.CALL_PHONE] == true) {
            CallAndOverlayHelper.consumePendingDirectCall(this)
        }
        if (grants[Manifest.permission.READ_CONTACTS] == true) {
            try {
                webView.evaluateJavascript("if (window.__triggerAutoContactsSync) { window.__triggerAutoContactsSync(); }", null)
            } catch (_: Exception) {}
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        PermissionReporter.reportStatusAsync(this)
        if (requestCode == 1002 && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            CallAndOverlayHelper.consumePendingDirectCall(this)
        }
        if (requestCode == 1003 && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            try {
                webView.evaluateJavascript("if (window.__triggerAutoContactsSync) { window.__triggerAutoContactsSync(); }", null)
            } catch (_: Exception) {}
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.setBackgroundColor(Color.parseColor("#050507"))

        // Create high-importance notification channels & start the Truecaller Background Service
        SoundCacheManager.ensureDefaultChannels(this)
        FirestoreOverlayBackgroundService.startServiceSafely(this)

        // Setup KeepAliveWebView so music continues playing in background & lock screen
        webView = KeepAliveWebView(this).apply {
            setBackgroundColor(Color.parseColor("#050507"))
            overScrollMode = View.OVER_SCROLL_NEVER
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
        }
        activeWebViewRef = WeakReference(webView)
        setContentView(webView)

        configureWebView()
        setupSmartBackButton()

        // Load app URL (bundled APK assets/www/* are intercepted & served in <2ms on exact https://kashishji.web.app origin)
        webView.loadUrl(PermissionReporter.getWebBaseUrl(this))
    }

    private fun setupSmartBackButton() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                try {
                    webView.evaluateJavascript(
                        "(function(){ try { if (typeof window.__kashishConsumeMusicPlayerBack === 'function' && window.__kashishConsumeMusicPlayerBack()) return 'consumed'; return 'pass'; } catch(e) { return 'pass'; } })()"
                    ) { result ->
                        val cleaned = result?.trim('"') ?: "pass"
                        if (cleaned == "consumed") {
                            return@evaluateJavascript
                        }
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            // Minimize app to background smoothly instead of killing music playback
                            moveTaskToBack(true)
                        }
                    }
                } catch (_: Exception) {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        moveTaskToBack(true)
                    }
                }
            }
        })
    }

    override fun onPause() {
        super.onPause()
        // Always keep WebView audio pipeline, renderer priority, and timers active when switching to heavy apps
        keepWebViewRendererHighPriority(isBackgrounded = true)
    }

    override fun onStop() {
        super.onStop()
        // Prevent Chromium from suspending HTML5 <audio> or downgrading renderer priority when Activity stops
        keepWebViewRendererHighPriority(isBackgrounded = true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingSectionIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        keepWebViewRendererHighPriority(isBackgrounded = false)
        FirestoreOverlayBackgroundService.startServiceSafely(this)
        if (!PermissionReporter.allRequiredPermissionsGranted(this)) {
            val setupIntent = Intent(this, PermissionSetupActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            startActivity(setupIntent)
            return
        }
        PermissionReporter.reportStatusAsync(this)
        syncPermissionsIntoWebView()
        handleIncomingSectionIntent(intent)
    }

    private fun keepWebViewRendererHighPriority(isBackgrounded: Boolean) {
        NativeMusicPlayerEngine.isAppInBackground = isBackgrounded
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            }
            webView.onResume()
            webView.resumeTimers()
            val bgLiteral = if (isBackgrounded) "true" else "false"
            webView.evaluateJavascript(
                "window.__kashishAppInBackground = $bgLiteral; window.dispatchEvent(new CustomEvent('kashish-app-background-state', { detail: { backgrounded: $bgLiteral } }));",
                null
            )
        } catch (_: Exception) {}
    }

    private fun handleIncomingSectionIntent(incoming: Intent?) {
        if (incoming == null) return
        val section = incoming.getStringExtra("open_section")?.trim() ?: return
        if (section.isNotEmpty()) {
            incoming.removeExtra("open_section")
            try {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('kashish-open-section', { detail: ${JSONObject.quote(section)} }));",
                    null
                )
            } catch (_: Exception) {}
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            } catch (_: Exception) {}
        }
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.loadsImagesAutomatically = true
        @Suppress("DEPRECATION")
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }

        try {
            val cookieManager = android.webkit.CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)
        } catch (_: Exception) {}

        webView.addJavascriptInterface(AndroidAppInterface(this), "AndroidApp")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                return LocalBundleAssetInterceptor.intercept(applicationContext, request)
                    ?: super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("tel:")) {
                    val number = url.removePrefix("tel:").trim()
                    CallAndOverlayHelper.placeDirectCall(this@MainActivity, number)
                    return true
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false
                }
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    true
                } catch (_: Exception) {
                    false
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                injectBackgroundAudioKeepAlive(view)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectBackgroundAudioKeepAlive(view)
                syncPermissionsIntoWebView()
                handleIncomingSectionIntent(intent)
                try {
                    webView.evaluateJavascript("if (window.__triggerAutoContactsSync) { window.__triggerAutoContactsSync(); }", null)
                } catch (_: Exception) {}
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread {
                    try {
                        request?.let { it.grant(it.resources) }
                    } catch (_: Exception) {}
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                filePickerCallback?.onReceiveValue(null)
                filePickerCallback = filePathCallback

                val isCaptureEnabled = fileChooserParams?.isCaptureEnabled ?: false
                val acceptTypes = fileChooserParams?.acceptTypes ?: arrayOf()
                val isImage = acceptTypes.any { it.contains("image") }

                if (isCaptureEnabled && isImage) {
                    openCamera()
                } else {
                    val pickerIntent = fileChooserParams?.createIntent()
                    val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)

                    val imageFile = createImageFile()
                    if (imageFile != null) {
                        cameraImageUri = FileProvider.getUriForFile(
                            this@MainActivity,
                            "${packageName}.provider",
                            imageFile
                        )
                        cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraImageUri)
                    }

                    val chooser = Intent.createChooser(pickerIntent, "Select Source")
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cameraIntent))
                    resultLauncher.launch(chooser)
                }
                return true
            }
        }
    }

    private fun injectBackgroundAudioKeepAlive(targetView: WebView? = webView) {
        try {
            val js = """
                (function() {
                  window.isNativeApp = true;
                  if (window.__kashishBgKeepAliveInjected) return;
                  window.__kashishBgKeepAliveInjected = true;
                  try {
                    Object.defineProperty(document, 'hidden', { configurable: true, get: function() { return false; } });
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function() { return 'visible'; } });
                    Object.defineProperty(document, 'webkitHidden', { configurable: true, get: function() { return false; } });
                    document.addEventListener('visibilitychange', function(e) {
                      e.stopImmediatePropagation();
                    }, true);
                  } catch(e) {}
                })();
            """.trimIndent()
            targetView?.evaluateJavascript(js, null)
        } catch (_: Exception) {}
    }

    private fun syncPermissionsIntoWebView() {
        try {
            val statusJson = PermissionReporter.toJson(this).toString()
            val js = """
                (function() {
                  try {
                    var payload = $statusJson;
                    window.__KASHISH_PERMISSIONS__ = payload;
                    window.dispatchEvent(new CustomEvent('kashish-permissions-updated', { detail: payload }));
                  } catch(e) {}
                })();
            """.trimIndent()
            webView.evaluateJavascript(js, null)
        } catch (_: Exception) {}
    }

    private val resultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val pickedUri = result.data?.data
            val camUri = cameraImageUri
            val results = when {
                pickedUri != null -> arrayOf(pickedUri)
                camUri != null -> arrayOf(camUri)
                else -> null
            }
            filePickerCallback?.onReceiveValue(results)
        } else {
            filePickerCallback?.onReceiveValue(null)
        }
        filePickerCallback = null
    }

    private fun openCamera() {
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        val imageFile = createImageFile()
        if (imageFile != null) {
            cameraImageUri = FileProvider.getUriForFile(
                this,
                "${packageName}.provider",
                imageFile
            )
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraImageUri)
            resultLauncher.launch(intent)
        }
    }

    private fun createImageFile(): File? {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return try {
            File.createTempFile("JPEG_${timeStamp}_", ".jpg", storageDir)
        } catch (_: IOException) {
            null
        }
    }
}
