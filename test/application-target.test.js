import assert from "node:assert/strict";
import test from "node:test";

import { BRSPApplicationTarget } from "../src/application-target.js";
import { BRSPConnection } from "../src/brsp.js";
import { createAffectTarget } from "../examples/application-integration/affect-target.js";
import { createRunnerTarget } from "../examples/application-integration/runner-target.js";
import { eventOnce, MockTransport, settle } from "../fixtures/mock-transport.js";

async function connectApplicationTarget(application, {
  scope,
  sessionId,
  secret = "application-target-secret-with-enough-entropy",
}) {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  const targetOptions = application.connectionOptions({ grantedScopes: [scope] });
  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId,
    sharedSecret: secret,
    peerId: `target_${application.profile.replaceAll(".", "_").replaceAll("-", "_")}`,
    epoch: 101,
    ...targetOptions,
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId,
    sharedSecret: secret,
    peerId: `controller_${application.profile.replaceAll(".", "_").replaceAll("-", "_")}`,
    epoch: 202,
    capabilities: targetOptions.capabilities,
    requestedScopes: [scope],
  });
  const ready = Promise.all([eventOnce(target, "ready"), eventOnce(controller, "ready")]);
  targetTransport.open();
  controllerTransport.open();
  await ready;
  return { target, controller, targetTransport, controllerTransport };
}

test("application target derives a narrow connection surface and protects private state", async () => {
  const affect = createAffectTarget();
  assert.deepEqual(affect.describe(), {
    profile: "affect-tracker.v1",
    scopes: ["affect.control"],
    commands: [
      { scope: "affect.control", action: "reset" },
      { scope: "affect.control", action: "set-paused" },
    ],
    intentScopes: ["affect.control"],
  });
  const options = affect.connectionOptions({ grantedScopes: ["affect.control"] });
  assert.deepEqual(options.grantedScopes, ["affect.control"]);
  assert.ok(options.capabilities.includes("latest-intent"));
  assert.throws(
    () => affect.connectionOptions({ grantedScopes: ["admin"] }),
    /unregistered application scope/i,
  );
  const publicState = options.getState();
  assert.equal(publicState.localLslMessage, undefined);
  publicState.targetX = 99;
  assert.equal(affect.getPublicState().targetX, 0, "public projections are defensive copies");

  const localIntent = await affect.dispatchLocalIntent("affect.control", { target: { x: 0.4, y: -0.6 } });
  assert.equal(localIntent.revision, 1);
  const paused = await affect.dispatchLocalCommand("affect.control", "set-paused", { paused: true });
  assert.deepEqual(paused, { ok: true, revision: 2, result: { paused: true } });
  const invalid = await affect.dispatchLocalCommand("affect.control", "set-paused", { paused: "yes" });
  assert.equal(invalid.error, "invalid_argument");
  assert.equal(invalid.revision, 2);
});

test("Affect-style adapter carries high-rate intent and reliable commands through the same BRSP core", async () => {
  const affect = createAffectTarget();
  const { target, controller } = await connectApplicationTarget(affect, {
    scope: "affect.control",
    sessionId: "session_affect_adapter",
  });

  const returnedIntentState = eventOnce(controller, "state");
  assert.equal(controller.publishIntent("affect.control", { target: { x: 0.8, y: -0.25 } }), true);
  const intentState = await returnedIntentState;
  assert.equal(intentState.revision, 1);
  assert.deepEqual(intentState.state, {
    paused: false,
    revision: 1,
    targetX: 0.8,
    targetY: -0.25,
  });

  const appliedPromise = eventOnce(controller, "commandapplied");
  const returnedCommandState = eventOnce(controller, "state");
  const commandId = controller.sendCommand("affect.control", "reset", {}, { expectedRevision: 1 });
  const applied = await appliedPromise;
  assert.equal(applied.commandId, commandId);
  assert.equal(applied.ok, true);
  assert.equal(applied.revision, 2);
  assert.deepEqual((await returnedCommandState).state, {
    paused: false,
    revision: 2,
    targetX: 0,
    targetY: 0,
  });

  await Promise.all([target.close(), controller.close()]);
});

test("Runner-style adapter needs no intent lane and preserves state-machine rejection", async () => {
  const runner = createRunnerTarget();
  const options = runner.connectionOptions({ grantedScopes: ["runner.operate"] });
  assert.equal(options.capabilities.includes("latest-intent"), false);
  assert.equal(options.getState().participantPath, undefined);

  const { target, controller } = await connectApplicationTarget(runner, {
    scope: "runner.operate",
    sessionId: "session_runner_adapter",
  });
  const startApplied = eventOnce(controller, "commandapplied");
  const startState = eventOnce(controller, "state");
  controller.sendCommand("runner.operate", "start-part", { part: 1 }, { expectedRevision: 0 });
  assert.deepEqual(
    (({ ok, revision, result, error }) => ({ ok, revision, result, error }))(await startApplied),
    { ok: true, revision: 1, result: { activePart: 1 }, error: null },
  );
  assert.equal((await startState).state.phase, "running");

  const rejectedApplied = eventOnce(controller, "commandapplied");
  const rejectedState = eventOnce(controller, "state");
  controller.sendCommand("runner.operate", "start-part", { part: 2 }, { expectedRevision: 1 });
  const rejected = await rejectedApplied;
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "command_rejected");
  assert.equal(rejected.revision, 1);
  assert.equal((await rejectedState).state.activePart, 1);

  await Promise.all([target.close(), controller.close()]);
});

test("a slower obsolete intent cannot overwrite a newer accepted intent", async () => {
  const target = new BRSPApplicationTarget({
    profile: "async-intent-test.v1",
    initialState: { value: 0 },
    intents: [{
      scope: "controls.write",
      validate: ({ controls }) => Number.isFinite(controls.value) && Number.isFinite(controls.delayMs),
      reduce: async ({ state, controls }) => {
        await new Promise((resolve) => setTimeout(resolve, controls.delayMs));
        return { state: { ...state, value: controls.value } };
      },
    }],
  });
  const older = target.applyIntent({
    scope: "controls.write",
    controls: { value: 1, delayMs: 25 },
    sequence: 1,
  });
  await settle(1);
  const newer = target.applyIntent({
    scope: "controls.write",
    controls: { value: 2, delayMs: 1 },
    sequence: 2,
  });
  const [olderResult, newerResult] = await Promise.all([older, newer]);
  assert.equal(olderResult.superseded, true);
  assert.equal(newerResult.superseded, false);
  assert.deepEqual(target.getPublicState(), { revision: 1, value: 2 });
});

test("duplicate descriptors and implicit scope grants fail at construction boundaries", () => {
  assert.throws(() => new BRSPApplicationTarget({
    profile: "duplicate-test.v1",
    initialState: {},
    commands: [
      { scope: "scope.write", action: "go", reduce: ({ state }) => ({ state }) },
      { scope: "scope.write", action: "go", reduce: ({ state }) => ({ state }) },
    ],
  }), /duplicate command descriptor/i);
  const runner = createRunnerTarget();
  assert.throws(() => runner.connectionOptions(), /explicit grantedScopes/i);
});

test("application exceptions remain local while the command result is generic", async () => {
  const target = new BRSPApplicationTarget({
    profile: "failure-redaction.v1",
    initialState: { value: 0 },
    commands: [{
      scope: "value.write",
      action: "fail",
      reduce: () => { throw new Error("private native diagnostic"); },
    }],
  });
  const localDiagnostic = eventOnce(target, "applicationerror");
  const outcome = await target.dispatchLocalCommand("value.write", "fail");
  assert.deepEqual(outcome, {
    ok: false,
    revision: 0,
    result: null,
    error: "command_failed",
  });
  assert.match((await localDiagnostic).message, /private native diagnostic/);
  assert.doesNotMatch(JSON.stringify(outcome), /private native diagnostic/);
});
