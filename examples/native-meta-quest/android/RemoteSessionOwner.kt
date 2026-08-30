package org.example.brsp.quest

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

data class EnabledRemoteSession(
  val roomId: String,
  val transportSecret: String,
  val transportGeneration: Long,
  val invitationFragmentForLocalDisplay: String,
  val invitationExpiresAtElapsedMs: Long,
  val sessionExpiresAtElapsedMs: Long,
  val nativeSession: NativeRemoteSession,
)

interface NativeRemoteSession {
  /** Returns true only after a pending controller and exact scopes were reviewed locally. */
  fun approvePendingController(scopes: Set<QuestScope>): Boolean
  fun setTargetInteractive(interactive: Boolean)
  fun clearInvitationMaterial()
  fun revokeAndClear()
}

fun interface RemoteSessionFactory {
  /** Creates fresh IDs, epochs, nonces, and separate 256-bit transport/BRSP secrets. */
  fun create(transportGeneration: Long, nowElapsedMs: Long): EnabledRemoteSession
}

/**
 * Activity/process owner for explicit Enable, local approval, expiry, and Stop.
 * Call the lifecycle methods from the real Meta Spatial activity callbacks.
 */
class RemoteSessionOwner(
  private val context: Context,
  private val transport: BundledWebViewTransport,
  private val sessionFactory: RemoteSessionFactory,
  private val showInvitationLocally: (String) -> Unit,
  private val showStatusLocally: (String) -> Unit,
  private val elapsedRealtime: () -> Long = SystemClock::elapsedRealtime,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var generation = 0L
  private var active: EnabledRemoteSession? = null
  private var ready = false
  private var released = false
  private var activityResumed = false
  private var vrReady = false

  private val expiryCheck =
    object : Runnable {
      override fun run() {
        val current = active ?: return
        val now = elapsedRealtime()
        val expired = now >= current.sessionExpiresAtElapsedMs || (!ready && now >= current.invitationExpiresAtElapsedMs)
        if (expired) stopLocally("Remote invitation/session expired and was revoked.")
        else mainHandler.postDelayed(this, 1_000L)
      }
    }

  init {
    RemoteStopAuthority.install { stopLocally("Remote stopped from the headset notification.") }
  }

  /** Invoke only from a current headset-local button/gesture after notification permission. */
  fun enableFromHeadset() {
    check(!released) { "owner released" }
    stopInternal()
    generation = if (generation == Long.MAX_VALUE) 1L else generation + 1L
    val created = sessionFactory.create(generation, elapsedRealtime())
    active = created
    ready = false
    RemoteStopNotification.show(context)
    transport.configureTransport(created.roomId, created.transportSecret, created.transportGeneration)
    showInvitationLocally(created.invitationFragmentForLocalDisplay)
    mainHandler.post(expiryCheck)
    showStatusLocally("Invitation active; controller proof and local scope approval are required.")
  }

  /** Invoke only from the headset UI after displaying the pending controller/scopes. */
  fun approveControllerFromHeadset(scopes: Set<QuestScope>): Boolean {
    val accepted = active?.nativeSession?.approvePendingController(scopes) == true
    showStatusLocally(if (accepted) "Controller approved locally; authenticating." else "No approvable controller is pending.")
    return accepted
  }

  /** Called by native BRSP core only after proof and matching ready. */
  fun onBrspReady() {
    val current = active ?: return
    ready = true
    current.nativeSession.clearInvitationMaterial()
    showInvitationLocally("")
    showStatusLocally("Controller authenticated; one-time invitation cleared.")
  }

  fun onActivityResumed() { activityResumed = true; publishInteractivity() }
  fun onActivityPaused() { activityResumed = false; publishInteractivity() }
  fun onVrReady() { vrReady = true; publishInteractivity() }
  fun onVrPaused() { vrReady = false; publishInteractivity() }

  fun stopFromHeadset() = stopLocally("Remote stopped locally; all scopes and secrets were revoked.")
  fun onSpatialShutdown() = release()
  fun onActivityDestroyed() = release()

  private fun stopLocally(message: String) {
    stopInternal()
    showStatusLocally(message)
  }

  /** Revoke/clear native authority before closing the lower-trust transport. */
  private fun stopInternal() {
    mainHandler.removeCallbacks(expiryCheck)
    val closing = active
    active = null
    ready = false
    showInvitationLocally("")
    closing?.nativeSession?.revokeAndClear()
    transport.stopTransport()
    RemoteStopNotification.hide(context)
  }

  private fun release() {
    if (released) return
    released = true
    stopInternal()
    RemoteStopAuthority.clear()
    transport.destroy()
  }

  private fun publishInteractivity() {
    active?.nativeSession?.setTargetInteractive(activityResumed && vrReady && !released)
  }
}
