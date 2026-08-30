package org.example.brsp.quest

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

interface NativeTransportEndpoint {
  fun peerOpened(generation: Long, peerKey: String): String
  fun peerClosed(generation: Long, peerKey: String): String
  fun postInbound(generation: Long, lane: String, peerKey: String, payload: String): String
  fun transportDiagnostic(generation: Long, kind: String, route: String, rttMs: Int)
}

/**
 * Transport-only WebView. It loads bundled reviewed assets and exposes no
 * Android intent, URL, file, shell, input, permission, or application action.
 * BRSP authentication/authorization and application authority stay in Kotlin.
 */
class BundledWebViewTransport(
  context: Context,
  private val endpoint: NativeTransportEndpoint,
) {
  private val assetLoader =
    WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
      .build()

  val webView = WebView(context).apply { configure() }
  private var pageReady = false
  private var pendingConfiguration: String? = null
  @Volatile private var activeGeneration = 0L

  @SuppressLint("SetJavaScriptEnabled")
  private fun WebView.configure() {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.javaScriptCanOpenWindowsAutomatically = false
    settings.setSupportMultipleWindows(false)
    settings.mediaPlaybackRequiresUserGesture = true
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    addJavascriptInterface(JsEndpoint(), JS_ENDPOINT_NAME)
    webViewClient =
      object : WebViewClient() {
        override fun shouldInterceptRequest(
          view: WebView,
          request: WebResourceRequest,
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          !isBundledAssetUri(request.url)

        override fun onPageFinished(view: WebView, url: String) {
          super.onPageFinished(view, url)
          if (!isBundledAssetUri(Uri.parse(url))) return
          pageReady = true
          pendingConfiguration?.let { deliverConfiguration(it, activeGeneration) }
        }
      }
    loadUrl(ASSET_URL)
  }

  /** Only the VDO routing secret crosses this boundary. */
  fun configureTransport(roomId: String, transportSecret: String, generation: Long) {
    require(ROOM.matches(roomId))
    require(TRANSPORT_SECRET.matches(transportSecret))
    require(generation > 0)
    webView.post {
      activeGeneration = generation
      val configuration =
        JSONObject()
          .put("room", roomId)
          .put("transportSecret", transportSecret)
          .put("generation", generation)
          .toString()
      pendingConfiguration = configuration
      if (pageReady) deliverConfiguration(configuration, generation)
    }
  }

  /** Fixed native-to-bundled-function delivery; payload is quoted as data. */
  fun sendToTransport(lane: String, peerKey: String, payload: String) {
    if (lane !in LANES || !PEER_KEY.matches(peerKey) || utf8Size(payload) > limitFor(lane)) return
    val generation = activeGeneration
    webView.post {
      if (generation != activeGeneration) return@post
      webView.evaluateJavascript(
        "window.QuestRemoteTransportBridge.receive(" +
          "${JSONObject.quote(lane)},${JSONObject.quote(peerKey)},${JSONObject.quote(payload)});",
        null,
      )
    }
  }

  fun closePeer(generation: Long, peerKey: String) {
    if (generation != activeGeneration || !PEER_KEY.matches(peerKey)) return
    webView.post {
      if (generation != activeGeneration) return@post
      webView.evaluateJavascript(
        "window.QuestRemoteTransportBridge.closePeer(${JSONObject.quote(peerKey)});",
        null,
      )
    }
  }

  /** Forget ownership before asking the bundled page to close signaling. */
  fun stopTransport() {
    webView.post {
      pendingConfiguration = null
      activeGeneration = 0L
      webView.evaluateJavascript("window.QuestRemoteTransportBridge.stop();", null)
    }
  }

  fun destroy() {
    webView.post {
      pendingConfiguration = null
      activeGeneration = 0L
      pageReady = false
      webView.removeJavascriptInterface(JS_ENDPOINT_NAME)
      webView.stopLoading()
      webView.destroy()
    }
  }

  private inner class JsEndpoint {
    @JavascriptInterface
    fun peerOpened(generation: Long, peerKey: String): String =
      if (current(generation) && PEER_KEY.matches(peerKey)) endpoint.peerOpened(generation, peerKey)
      else "stale-generation"

    @JavascriptInterface
    fun peerClosed(generation: Long, peerKey: String): String =
      if (current(generation) && PEER_KEY.matches(peerKey)) endpoint.peerClosed(generation, peerKey)
      else "stale-generation"

    @JavascriptInterface
    fun postInbound(generation: Long, lane: String, peerKey: String, payload: String): String {
      if (!current(generation)) return "stale-generation"
      if (lane !in LANES || !PEER_KEY.matches(peerKey)) return "malformed"
      if (utf8Size(payload) > limitFor(lane)) return "message-too-large"
      return endpoint.postInbound(generation, lane, peerKey, payload)
    }

    @JavascriptInterface
    fun transportDiagnostic(generation: Long, kind: String, route: String, rttMs: Int) {
      if (!current(generation) || kind !in DIAGNOSTIC_KINDS || route !in ROUTES || rttMs !in -1..60_000) return
      endpoint.transportDiagnostic(generation, kind, route, rttMs)
    }
  }

  private fun deliverConfiguration(configuration: String, generation: Long) {
    webView.post {
      if (generation != activeGeneration) return@post
      webView.evaluateJavascript(
        "window.QuestRemoteTransportBridge.configure(${JSONObject.quote(configuration)});",
        null,
      )
    }
  }

  private fun current(generation: Long): Boolean = generation == activeGeneration
  private fun limitFor(lane: String): Int = if (lane == "control") 16 * 1024 else 8 * 1024
  private fun utf8Size(value: String): Int = value.toByteArray(Charsets.UTF_8).size
  private fun isBundledAssetUri(uri: Uri): Boolean =
    uri.scheme == "https" && uri.host == ASSET_HOST && uri.path?.startsWith("/assets/") == true

  private companion object {
    const val JS_ENDPOINT_NAME = "QuestRemoteTransport"
    const val ASSET_HOST = "appassets.androidplatform.net"
    const val ASSET_URL = "https://appassets.androidplatform.net/assets/remote-bridge/index.html"
    val LANES = setOf("control", "state")
    val DIAGNOSTIC_KINDS = setOf("status", "quality", "error")
    val ROUTES = setOf("direct", "relay", "unknown")
    val PEER_KEY = Regex("^[A-Za-z0-9_.:-]{1,96}$")
    val ROOM = Regex("^[A-Za-z0-9_]{12,64}$")
    val TRANSPORT_SECRET = Regex("^[A-Za-z0-9_-]{43,128}$")
  }
}
