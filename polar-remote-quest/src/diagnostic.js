const TONES = Object.freeze({ GOOD: "good", ACTIVE: "active", WARNING: "warning", ERROR: "error", MUTED: "muted" });

export function humanState(value) {
  if (typeof value !== "string" || !value.trim()) return "Waiting";
  return value.replace(/[-_]+/gu, " ").trim().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function formatFreshness(value) {
  if (!Number.isFinite(value)) return "No samples";
  const milliseconds = Math.max(0, Math.floor(value));
  if (milliseconds < 1_000) return `${milliseconds} ms ago`;
  return `${Math.floor(milliseconds / 1_000)}.${Math.floor((milliseconds % 1_000) / 100)} s ago`;
}

function check(key, label, detail, complete, { active = false, attention = false } = {}) {
  return {
    key,
    label,
    detail,
    state: complete ? "complete" : (attention ? "attention" : (active ? "active" : "pending")),
  };
}

/**
 * Pure semantic mirror of the Study 6 Sensor Bridge diagnostic projector.
 * All values come from the target-confirmed, privacy-safe BRSP projection.
 */
export function projectDiagnosticPanel(state = {}, { remoteReady = false, stale = false } = {}) {
  const polar = state.polar;
  const recorder = state.recorder;
  const bridge = state.bridge;
  const permissionsGranted = polar?.permissionsGranted === true;
  const bluetoothPowered = polar?.bluetoothPowered !== false;
  const connected = polar?.sensor === "connected";
  const ecgStreaming = polar?.ecg === "streaming";
  const detected = Boolean(polar?.candidates?.length || connected);
  const realSamples = (polar?.sampleCount ?? 0) > 0;
  const activeRecordingHealthy = Boolean(recorder?.active
    && recorder?.droppedBatches === 0 && recorder?.state !== "fault" && !recorder?.fault);
  const completedRecordingDurable = Boolean(!recorder?.active && recorder?.durable
    && recorder?.droppedBatches === 0 && recorder?.state !== "fault" && !recorder?.fault);
  const recordingHealthy = activeRecordingHealthy || completedRecordingDurable;
  // Controller staleness is rendered in the remote-connection card. It must not rewrite the
  // headset's target-authoritative sensor verdict.
  const complete = polar?.ready === true;
  const transportHasError = polar?.transportState?.includes("error") === true;
  const transportDetail = polar?.transportDetail ?? polar?.transportState;
  const readinessDetail = polar?.readinessDetail ?? polar?.readinessReason;
  const searching = transportDetail?.includes("search")
    || transportDetail?.includes("not-found");

  let title = "Starting Polar acquisition";
  if (polar && !permissionsGranted) {
    title = "Nearby devices permission needed";
  } else if (polar && !bluetoothPowered) {
    title = "Bluetooth is turned off";
  } else if (complete) {
    title = "Polar H10 ECG ready";
  } else if (transportHasError) {
    title = "Polar ECG needs attention";
  } else if (connected && realSamples) {
    title = "Live ECG is stabilizing";
  } else if (connected) {
    title = "Polar connected · starting ECG";
  } else if (searching) {
    title = "Searching for Polar H10";
  } else if (polar) {
    title = humanState(transportDetail);
  }

  let summary = "The headset sensor service is starting.";
  if (polar && !permissionsGranted) {
    summary = "Grant Nearby devices so this app can discover and connect to the worn H10.";
  } else if (polar && !bluetoothPowered) {
    summary = "Turn Bluetooth on, then refresh or rescan.";
  } else if (complete) {
    summary = "Real 130 Hz ECG, heart rate, RR intervals, and fresh samples are arriving.";
  } else if (connected && !ecgStreaming) {
    summary = "The H10 is connected; waiting for the real ECG stream to begin.";
  } else if (ecgStreaming && !realSamples) {
    summary = "The ECG stream was requested; waiting for the first real sample frame.";
  } else if (connected) {
    summary = "The H10 is connected and preparing live streams.";
  } else if (polar) {
    summary = "Wear the moistened strap, keep it close, and close Polar/fitness apps on other devices.";
  }

  let tone = TONES.MUTED;
  if (complete) tone = TONES.GOOD;
  else if (transportHasError || recorder?.state === "fault" || (recorder?.droppedBatches ?? 0) > 0) tone = TONES.ERROR;
  else if (polar && (!permissionsGranted || !bluetoothPowered)) tone = TONES.WARNING;
  else if (polar && transportDetail !== "not-started") tone = TONES.ACTIVE;

  const freshness = polar?.lastSampleAgeMs;
  const metrics = [
    { label: "Heart rate", value: polar?.heartRateBpm == null ? "Waiting" : `${polar.heartRateBpm} bpm`, tone: (polar?.heartRateBpm ?? 0) > 0 ? TONES.GOOD : TONES.MUTED },
    { label: "RR interval", value: polar?.rrIntervalMs == null ? "Waiting" : `${Math.round(polar.rrIntervalMs)} ms`, tone: (polar?.rrIntervalCount ?? 0) > 0 ? TONES.GOOD : TONES.MUTED },
    { label: "ECG stream", value: polar?.sampleRateHz == null ? "Waiting" : `${polar.sampleRateHz} Hz`, tone: polar?.sampleRateHz === 130 ? TONES.GOOD : TONES.MUTED },
    { label: "Resolution", value: polar?.resolutionBits == null ? "Waiting" : `${polar.resolutionBits} bit`, tone: TONES.MUTED },
    { label: "Samples received", value: String(polar?.sampleCount ?? 0), tone: realSamples ? TONES.GOOD : TONES.MUTED },
    { label: "Last sample", value: formatFreshness(freshness), tone: freshness == null ? TONES.MUTED : (freshness <= 1_500 ? TONES.GOOD : (freshness <= 5_000 ? TONES.WARNING : TONES.ERROR)) },
    { label: "Recording", value: recorder == null ? "Stopped" : (recorder.fault ? humanState(recorder.fault) : (recorder.active ? `Active · ${recorder.recordingName ?? "unnamed"}` : (recorder.durable && recorder.recordingName ? `Saved · ${recorder.recordingName}` : "Stopped"))), tone: recordingHealthy ? TONES.GOOD : (recorder?.fault ? TONES.ERROR : TONES.MUTED) },
    { label: "Recorded samples", value: String(recorder?.samplesWritten ?? 0), tone: TONES.MUTED },
    { label: "Writer queue", value: String(recorder?.queuedBatches ?? 0), tone: (recorder?.queuedBatches ?? 0) === 0 ? TONES.GOOD : TONES.ACTIVE },
    { label: "Dropped batches", value: String(recorder?.droppedBatches ?? 0), tone: (recorder?.droppedBatches ?? 0) === 0 ? TONES.GOOD : TONES.ERROR },
    { label: "Nearby H10s", value: String(polar?.candidates?.length ?? 0), tone: (polar?.candidates?.length ?? 0) > 0 ? TONES.GOOD : TONES.MUTED },
    { label: "Latest BLE stage", value: polar?.lastDiagnosticStage == null ? "Waiting" : humanState(polar.lastDiagnosticStage), tone: complete ? TONES.GOOD : (polar?.lastDiagnosticError ? TONES.ERROR : TONES.ACTIVE) },
  ];

  const checks = [
    check("permissions", "Nearby devices permission", permissionsGranted ? "Granted" : "Required before H10 discovery", permissionsGranted, { active: !permissionsGranted }),
    check("bluetooth", "Bluetooth powered", polar?.bluetoothPowered === false ? "Turn Bluetooth on" : "Available", polar?.bluetoothPowered === true, { active: permissionsGranted && polar?.bluetoothPowered !== true }),
    check("detected", "Polar H10 detected", detected ? "A nearby H10 was found" : "Scanning nearby H10 sensors", detected, { active: permissionsGranted && polar?.bluetoothPowered === true && !detected }),
    check("connected", "Polar H10 connected", connected ? "Transport connected" : "Waiting for a connection", connected, { active: detected && !connected }),
    check("heart_rate", "Heart-rate notifications", polar?.heartRateBpm == null ? "Waiting for contact/HR data" : `${polar.heartRateBpm} bpm received`, (polar?.heartRateBpm ?? 0) > 0, { active: connected }),
    check("rr", "RR intervals", polar?.rrIntervalMs == null ? "Waiting for RR data" : `${Math.round(polar.rrIntervalMs)} ms · ${polar.rrIntervalCount} received`, (polar?.rrIntervalCount ?? 0) > 0, { active: (polar?.heartRateBpm ?? 0) > 0 }),
    check("ecg_stream", "ECG stream started", ecgStreaming ? "Polar ECG stream active" : "Waiting for settings/start", ecgStreaming, { active: connected }),
    check("samples", "Real ECG samples", realSamples ? `${polar.sampleCount} samples received` : "No real samples received yet", realSamples, { active: ecgStreaming }),
    check("rate", "Expected H10 sample rate", polar?.sampleRateHz == null ? "Waiting for sample-rate observation" : `${polar.sampleRateHz} Hz observed · expected 130 Hz`, polar?.sampleRateHz === 130, { active: realSamples, attention: polar?.sampleRateHz != null && polar.sampleRateHz !== 130 }),
    check("fresh", "Three-second stable, fresh ECG", readinessDetail ? humanState(readinessDetail) : "Waiting for ECG readiness", polar?.ready === true, { active: realSamples && !polar?.ready, attention: freshness != null && freshness > 5_000 }),
    check("writer", "App-private ECG recording", recorder == null ? "Recorder status unavailable" : (recorder.fault ? humanState(recorder.fault) : (recorder.active ? `Recording ${recorder.recordingName ?? "unnamed"} · queue ${recorder.queuedBatches} · dropped ${recorder.droppedBatches}` : (recorder.durable ? `Saved ${recorder.recordingName ?? "recording"} · ${recorder.samplesWritten} samples` : "Stopped · enter a name to record"))), recordingHealthy, { active: recorder != null && !recorder.active && !recorder.durable && !recorder.fault, attention: recorder?.state === "fault" || (recorder?.droppedBatches ?? 0) > 0 }),
  ];

  let troubleshooting;
  if (!polar) troubleshooting = ["Wait for a confirmed headset status, then select Refresh status."];
  else if (!permissionsGranted) troubleshooting = ["Select Grant Nearby devices, approve the headset prompt, then select Rescan."];
  else if (!bluetoothPowered) troubleshooting = ["Turn Bluetooth on in Quest settings, return to the app, and select Refresh status."];
  else if (recorder?.state === "fault" || recorder?.fault || (recorder?.droppedBatches ?? 0) > 0) troubleshooting = [
    `The app-private ECG writer needs attention: ${humanState(recorder?.fault ?? "recording-write-failed")}.`,
    "Stop recording, keep the existing private artifact, then start a newly named recording.",
  ];
  else if (complete) troubleshooting = ["No troubleshooting action is required. Keep the app open while controlling it."];
  else if (polar.lastDiagnosticError) troubleshooting = [
    `Latest sanitized BLE diagnostic: ${humanState(polar.lastDiagnosticError)}.`,
    "Select Reconnect or Restart ECG once; if it repeats, rescan and select the intended H10.",
  ];
  else if (searching) troubleshooting = [
    "Wear the strap with both electrode areas moistened and keep the sensor near the headset.",
    "Close Polar Beat/Flow and fitness apps on phones or watches so another client is not holding it.",
  ];
  else if (connected && !ecgStreaming) troubleshooting = [
    "Wait briefly for settings, then select Restart ECG stream if it remains here.",
  ];
  else if (ecgStreaming && !realSamples) troubleshooting = [
    "Restart ECG once; if samples remain zero, reconnect and close competing Polar clients.",
  ];
  else if (freshness != null && freshness > 5_000) troubleshooting = ["The ECG stream is stale. Reconnect the H10 before recording."];
  else troubleshooting = ["Keep the strap on and allow three seconds of continuous real samples for readiness."];

  return Object.freeze({
    title,
    summary,
    tone,
    transport: polar ? humanState(transportDetail) : "Service not bound",
    metrics: Object.freeze(metrics),
    checks: Object.freeze(checks),
    troubleshooting: Object.freeze(troubleshooting),
    candidates: Object.freeze(polar?.candidates ?? []),
    selectedCandidateKey: polar?.selectedCandidateKey ?? null,
    recorder,
    bridge,
    controls: Object.freeze({
      rescan: permissionsGranted && bluetoothPowered && !connected,
      stopScan: permissionsGranted && !connected,
      refresh: remoteReady,
      reconnect: Boolean(connected || detected || transportHasError || polar?.lastDiagnosticError),
      disconnect: connected,
      candidateSelection: !connected,
      connectCandidate: !connected && polar?.candidates?.some((candidate) => candidate.candidateKey === polar.selectedCandidateKey && candidate.connectable) === true,
      startEcg: connected && !ecgStreaming,
      stopEcg: connected && ecgStreaming,
      restartEcg: connected,
      startRecording: connected && ecgStreaming && polar?.sampleRateHz === 130 && realSamples && recorder?.active !== true,
      stopRecording: recorder?.active === true,
    }),
  });
}
