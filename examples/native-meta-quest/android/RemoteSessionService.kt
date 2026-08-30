package org.example.brsp.quest

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** In-process hook; a restarted service cannot reconstruct remote authority. */
object RemoteStopAuthority {
  @Volatile private var stopHandler: (() -> Unit)? = null
  fun install(value: () -> Unit) { stopHandler = value }
  fun clear() { stopHandler = null }
  fun requestStop() = stopHandler?.invoke()
}

/** Notification helper only; it does not claim foreground-service ownership. */
object RemoteStopNotification {
  fun show(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Browser remote", NotificationManager.IMPORTANCE_LOW)
    )
    manager.notify(NOTIFICATION_ID, notification(context))
  }

  fun hide(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }

  private fun notification(context: Context): Notification =
    Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setContentTitle("Browser remote enabled")
      .setContentText("Remote authority is locally approved. Stop revokes this session.")
      .setOngoing(true)
      .addAction(
        android.R.drawable.ic_menu_close_clear_cancel,
        "Stop remote",
        PendingIntent.getBroadcast(
          context,
          1,
          Intent(context, RemoteStopReceiver::class.java).setAction(ACTION_STOP),
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
      .build()

  internal const val ACTION_STOP = "org.example.brsp.quest.remote.STOP"
  private const val CHANNEL_ID = "brsp-quest-remote"
  private const val NOTIFICATION_ID = 1501
}

/** Private notification action; process recreation never reconstructs authority. */
class RemoteStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action == RemoteStopNotification.ACTION_STOP) RemoteStopAuthority.requestStop()
    RemoteStopNotification.hide(context)
  }
}
