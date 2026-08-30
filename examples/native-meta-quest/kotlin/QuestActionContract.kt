package org.example.brsp.quest

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** Application scopes are closed enums, never dynamic module/function names. */
enum class QuestScope(val wire: String) {
  OBSERVE("app.observe"),
  PRESENTATION_WRITE("panel.presentation.write"),
  SESSION_SAFETY("session.safety"),
}

enum class Sensitivity(val wire: String) { NORMAL("normal"), SENSITIVE("sensitive"), HEADSET_ONLY("headset_only") }
enum class TargetInteraction(val wire: String) { INTERACTIVE("interactive"), BACKGROUND("background") }
enum class InteractionMode(val wire: String) { POINTER("pointer"), DIRECT("direct") }
enum class ConnectionRoute(val wire: String) { UNKNOWN("unknown"), DIRECT("direct"), RELAY("relay") }
enum class AppPhase(val wire: String) { READY("ready"), RUNNING("running"), PAUSED("paused"), COMPLETE("complete") }

/** Every app-owned semantic outcome. There is intentionally no generic invoke action. */
sealed interface QuestAppAction {
  val type: String

  data object RequestStatus : QuestAppAction { override val type = "request-status" }
  data object RequestCapabilities : QuestAppAction { override val type = "request-capabilities" }
  data class SetInteractionMode(val mode: InteractionMode) : QuestAppAction { override val type = "set-interaction-mode" }
  data class SetPanelVisible(val visible: Boolean) : QuestAppAction { override val type = "set-panel-visible" }
  data object RecenterPanel : QuestAppAction { override val type = "recenter-panel" }
  data object Revoke : QuestAppAction { override val type = "revoke" }

  // These outcomes are reachable only from local headset UI and are not decoded from BRSP.
  data object EnableBrowserRemote : QuestAppAction { override val type = "enable-browser-remote" }
  data object ApproveController : QuestAppAction { override val type = "approve-controller" }
  data object ApproveRuntimePermissions : QuestAppAction { override val type = "approve-runtime-permissions" }
}

data class CapabilityManifestEntry(
  val action: String,
  val schemaVersion: Int,
  val requiredScope: QuestScope?,
  val sensitivity: Sensitivity,
  val availabilityGuard: String,
  val remotelyEligible: Boolean,
)

object QuestCapabilityManifest {
  const val SCHEMA_VERSION = 1
  const val CAPABILITY_HASH = "a6baeaa8727b13c316f733909fb30297183308ec3fe4eda3ef0c8a9c0376cc20"

  val entries = listOf(
    CapabilityManifestEntry("request-status", 1, QuestScope.OBSERVE, Sensitivity.NORMAL, "always", true),
    CapabilityManifestEntry("request-capabilities", 1, QuestScope.OBSERVE, Sensitivity.NORMAL, "always", true),
    CapabilityManifestEntry("set-interaction-mode", 1, QuestScope.PRESENTATION_WRITE, Sensitivity.NORMAL, "interactive", true),
    CapabilityManifestEntry("set-panel-visible", 1, QuestScope.PRESENTATION_WRITE, Sensitivity.NORMAL, "interactive", true),
    CapabilityManifestEntry("recenter-panel", 1, QuestScope.PRESENTATION_WRITE, Sensitivity.NORMAL, "interactive", true),
    CapabilityManifestEntry("revoke", 1, QuestScope.SESSION_SAFETY, Sensitivity.NORMAL, "always", true),
    CapabilityManifestEntry("enable-browser-remote", 1, null, Sensitivity.HEADSET_ONLY, "headset-local", false),
    CapabilityManifestEntry("approve-controller", 1, null, Sensitivity.HEADSET_ONLY, "headset-local", false),
    CapabilityManifestEntry("approve-runtime-permissions", 1, null, Sensitivity.HEADSET_ONLY, "headset-local", false),
  )

  private val allActionTypes = setOf(
    QuestAppAction.RequestStatus.type,
    QuestAppAction.RequestCapabilities.type,
    QuestAppAction.SetInteractionMode(InteractionMode.POINTER).type,
    QuestAppAction.SetPanelVisible(true).type,
    QuestAppAction.RecenterPanel.type,
    QuestAppAction.Revoke.type,
    QuestAppAction.EnableBrowserRemote.type,
    QuestAppAction.ApproveController.type,
    QuestAppAction.ApproveRuntimePermissions.type,
  )

  init {
    require(entries.map { it.action }.toSet() == allActionTypes) {
      "every app action must appear exactly once in the capability manifest"
    }
    require(entries.map { it.action }.distinct().size == entries.size) { "duplicate capability entry" }
  }

  fun entry(action: QuestAppAction): CapabilityManifestEntry = entries.single { it.action == action.type }
}

data class QuestAppState(
  val revision: Long = 0,
  val targetInteraction: TargetInteraction = TargetInteraction.INTERACTIVE,
  val interactionMode: InteractionMode = InteractionMode.POINTER,
  val panelVisible: Boolean = true,
  val panelAnchorRevision: Long = 0,
  val appPhase: AppPhase = AppPhase.READY,
  val remoteSessionActive: Boolean = false,
  val connectionRoute: ConnectionRoute = ConnectionRoute.UNKNOWN,
  val rttMs: Long? = null,
)

/** No participant data, raw sensors, pairing material, files, or private labels. */
data class PublicQuestState(
  val revision: Long,
  val targetInteraction: String,
  val interactionMode: String,
  val panelVisible: Boolean,
  val panelAnchorRevision: Long,
  val appPhase: String,
  val connectionRoute: String,
  val rttMs: Long?,
  val capabilityHash: String,
)

fun QuestAppState.publicProjection(): PublicQuestState =
  PublicQuestState(
    revision = revision,
    targetInteraction = targetInteraction.wire,
    interactionMode = interactionMode.wire,
    panelVisible = panelVisible,
    panelAnchorRevision = panelAnchorRevision,
    appPhase = appPhase.wire,
    connectionRoute = connectionRoute.wire,
    rttMs = rttMs?.takeIf { it in 0..60_000 },
    capabilityHash = QuestCapabilityManifest.CAPABILITY_HASH,
  )

class ActionDecodeException(val stableCode: String) : IllegalArgumentException(stableCode)

/** Decode only exact typed wire shapes. Headset-only actions are intentionally absent. */
object QuestActionCodec {
  fun fromWire(type: String, args: JsonObject): QuestAppAction =
    when (type) {
      "request-status" -> noArgs(args, QuestAppAction.RequestStatus)
      "request-capabilities" -> noArgs(args, QuestAppAction.RequestCapabilities)
      "set-interaction-mode" -> {
        requireKeys(args, setOf("mode"))
        val mode = (args["mode"] as? JsonPrimitive)?.contentOrNull
        QuestAppAction.SetInteractionMode(
          InteractionMode.entries.singleOrNull { it.wire == mode }
            ?: throw ActionDecodeException("invalid_argument")
        )
      }
      "set-panel-visible" -> {
        requireKeys(args, setOf("visible"))
        QuestAppAction.SetPanelVisible(
          (args["visible"] as? JsonPrimitive)?.booleanOrNull
            ?: throw ActionDecodeException("invalid_argument")
        )
      }
      "recenter-panel" -> noArgs(args, QuestAppAction.RecenterPanel)
      "revoke" -> noArgs(args, QuestAppAction.Revoke)
      else -> throw ActionDecodeException("unsupported_command")
    }

  private fun noArgs(args: JsonObject, action: QuestAppAction): QuestAppAction {
    requireKeys(args, emptySet())
    return action
  }

  private fun requireKeys(args: JsonObject, expected: Set<String>) {
    if (args.keys != expected) throw ActionDecodeException("invalid_argument")
  }
}
