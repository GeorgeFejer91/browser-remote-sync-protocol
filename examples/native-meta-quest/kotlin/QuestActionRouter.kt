package org.example.brsp.quest

import java.util.LinkedHashMap

/** Native effects remain exact product operations and return success/failure. */
interface QuestEffectPort {
  fun recenterPanel(): Boolean
  fun enableBrowserRemote(): Boolean
  fun approveController(): Boolean
  fun requestRuntimePermissions(): Boolean
  fun revokeRemoteSession(): Boolean
}

data class ActionOutcome(
  val ok: Boolean,
  val state: QuestAppState,
  val error: String? = null,
)

/**
 * Sole application-state authority. Both local headset controls and the remote
 * gate below call dispatch(); neither path clicks UI or mutates views directly.
 */
class QuestApplicationAuthority(
  initialState: QuestAppState,
  private val effects: QuestEffectPort,
) {
  private var current = initialState

  fun snapshot(): QuestAppState = current

  @Synchronized
  fun setTargetInteraction(value: TargetInteraction): QuestAppState {
    if (current.targetInteraction != value) {
      current = current.copy(targetInteraction = value, revision = current.revision + 1)
    }
    return current
  }

  @Synchronized
  fun dispatch(action: QuestAppAction): ActionOutcome {
    val before = current
    val candidate =
      when (action) {
        QuestAppAction.RequestStatus,
        QuestAppAction.RequestCapabilities,
        QuestAppAction.ApproveController,
        QuestAppAction.ApproveRuntimePermissions -> before
        is QuestAppAction.SetInteractionMode -> before.copy(interactionMode = action.mode)
        is QuestAppAction.SetPanelVisible -> before.copy(panelVisible = action.visible)
        QuestAppAction.RecenterPanel -> {
          if (!effects.recenterPanel()) return rejected(before, "action_unavailable")
          before.copy(panelAnchorRevision = before.panelAnchorRevision + 1)
        }
        QuestAppAction.Revoke -> {
          if (!effects.revokeRemoteSession()) return rejected(before, "action_unavailable")
          before.copy(remoteSessionActive = false)
        }
        QuestAppAction.EnableBrowserRemote -> {
          if (!effects.enableBrowserRemote()) return rejected(before, "action_unavailable")
          before.copy(remoteSessionActive = true)
        }
      }

    // Local-only approval effects run through the same typed port without claiming a state change.
    val localEffectSucceeded =
      when (action) {
        QuestAppAction.ApproveController -> effects.approveController()
        QuestAppAction.ApproveRuntimePermissions -> effects.requestRuntimePermissions()
        else -> true
      }
    if (!localEffectSucceeded) return rejected(before, "action_unavailable")

    current = if (candidate == before) before else candidate.copy(revision = before.revision + 1)
    return ActionOutcome(ok = true, state = current)
  }

  private fun rejected(state: QuestAppState, error: String) = ActionOutcome(false, state, error)
}

data class RemoteActionRequest(
  val protocolVersion: Int,
  val actionId: String,
  val sessionEpoch: String,
  val baseRevision: Long,
  val action: QuestAppAction,
)

data class RemoteActionResult(
  val actionId: String,
  val applied: Boolean,
  val revision: Long,
  val error: String?,
  val state: PublicQuestState,
)

/** Scope/revision/background/dedupe gate around the shared app authority. */
class QuestRemoteActionGate(
  private val sessionEpoch: String,
  private val grantedScopes: Set<QuestScope>,
  private val authority: QuestApplicationAuthority,
) {
  private val results =
    object : LinkedHashMap<String, Pair<RemoteActionRequest, RemoteActionResult>>() {
      override fun removeEldestEntry(
        eldest: MutableMap.MutableEntry<String, Pair<RemoteActionRequest, RemoteActionResult>>?
      ): Boolean = size > 128
    }

  @Synchronized
  fun apply(request: RemoteActionRequest): RemoteActionResult {
    require(request.protocolVersion == 1) { "version_unsupported" }
    require(ACTION_ID.matches(request.actionId)) { "malformed" }
    require(request.sessionEpoch == sessionEpoch) { "stale_epoch" }

    results[request.actionId]?.let { (original, result) ->
      require(original == request) { "deduplication_conflict" }
      return result
    }

    val before = authority.snapshot()
    val entry = QuestCapabilityManifest.entry(request.action)
    val preconditionError =
      when {
        !entry.remotelyEligible || entry.requiredScope == null -> "unsupported_command"
        entry.requiredScope !in grantedScopes -> "scope_denied"
        before.targetInteraction == TargetInteraction.BACKGROUND && request.action !in BACKGROUND_ALLOWED ->
          "target_not_interactive"
        request.action !in REVISION_INDEPENDENT && request.baseRevision != before.revision -> "revision_conflict"
        else -> null
      }

    val outcome =
      if (preconditionError == null) authority.dispatch(request.action)
      else ActionOutcome(ok = false, state = before, error = preconditionError)
    check(outcome.state.revision >= before.revision)
    check(outcome.ok || outcome.state == before)

    val result =
      RemoteActionResult(
        actionId = request.actionId,
        applied = outcome.ok,
        revision = outcome.state.revision,
        error = outcome.error,
        state = outcome.state.publicProjection(),
      )
    results[request.actionId] = request to result
    return result
  }

  @Synchronized
  fun close() = results.clear()

  private companion object {
    val ACTION_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_.:-]{7,95}$")
    val BACKGROUND_ALLOWED =
      setOf(QuestAppAction.RequestStatus, QuestAppAction.RequestCapabilities, QuestAppAction.Revoke)
    val REVISION_INDEPENDENT = BACKGROUND_ALLOWED
  }
}
