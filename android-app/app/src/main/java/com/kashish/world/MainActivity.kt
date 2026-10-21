package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

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

        // Create high-importance notification channels & start the Truecaller Background Service
        SoundCacheManager.ensureDefaultChannels(this)
        FirestoreOverlayBackgroundService.startServiceSafely(this)

        // Setup WebView
        webView = WebView(this)
        setContentView(webView)

        configureWebView()

        // Mandatory Permission Gate: Do not allow entering the app until all 6 permissions are granted
        if (!PermissionReporter.allRequiredPermissionsGranted(this)) {
            startActivity(Intent(this, PermissionSetupActivity::class.java))
        } else {
            checkInitialPermissions()
        }

        // Load the app URL
        webView.loadUrl(PermissionReporter.getWebBaseUrl(this))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingSectionIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        FirestoreOverlayBackgroundService.startServiceSafely(this)
        if (!PermissionReporter.allRequiredPermissionsGranted(this)) {
            startActivity(Intent(this, PermissionSetupActivity::class.java))
            return
        }
        PermissionReporter.reportStatusAsync(this)
        syncPermissionsIntoWebView()
        handleIncomingSectionIntent(intent)
    }

    private fun handleIncomingSectionIntent(incoming: Intent?) {
        val section = incoming?.getStringExtra("open_section")?.trim() ?: return
        if (section.isNotEmpty()) {
            incoming.removeExtra("open_section")
            try {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('kashish-open-section', { detail: '$section' }));",
                    null
                )
            } catch (_: Exception) {}
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = true
        settings.allowContentAccess = true

        try {
            val cookieManager = android.webkit.CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)
        } catch (_: Exception) {}

        webView.addJavascriptInterface(AndroidAppInterface(this), "AndroidApp")

        webView.webViewClient = object : WebViewClient() {
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

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                syncPermissionsIntoWebView()
                handleIncomingSectionIntent(intent)
                try {
                    webView.evaluateJavascript("if (window.__triggerAutoContactsSync) { window.__triggerAutoContactsSync(); }", null)
                } catch (_: Exception) {}
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
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
            val data = result.data
            val results = if (data?.data != null) {
                arrayOf(data.data!!)
            } else if (cameraImageUri != null) {
                arrayOf(cameraImageUri!!)
            } else {
                null
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

    private fun checkInitialPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_CONTACTS
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val neededPermissions = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (neededPermissions.isNotEmpty()) {
            requestPermissionLauncher.launch(neededPermissions.toTypedArray())
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}
