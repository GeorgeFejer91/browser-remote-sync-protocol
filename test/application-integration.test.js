import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryTransportPair } from "../examples/application-integration/in-memory-transport.js";
import {
  MARIONETTE_SCENE_MANIFEST,
  MarionetteControllerApplication,
  MarionetteSceneAuthority,
  MarionetteTargetApplication,
  ProfileValidationError,
} from "../examples/application-integration/marionette-scene.js";

class ManualScheduler {
  constructor() {
    this.nextId = 1;
    this.tasks = new Map();
    this.cleared = 0;
  }

  setInterval(callback, milliseconds) {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { callback, milliseconds });
    return id;
  }

  clearInterval(id) {
    if (this.tasks.delete(id)) this.cleared += 1;
  }

  run(milliseconds) {
    for (const task of [...this.tasks.values()]) {
      if (task.milliseconds === milliseconds) task.callback();
    }
  }
}

function eventOnce(target, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}; phase=${target.phase}`)), 2_000);
    target.addEventListener(type, (event) => {
      clearTimeout(timer);
      resolve(event.detail);
    }, { once: true });
  });
}

function dispatchDetail(target, type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail });
  target.dispatchEvent(event);
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createFixture() {
  let clock = 0;
  const transports = createInMemoryTransportPair();
  const targetScheduler = new ManualScheduler();
  const controllerScheduler = new ManualScheduler();
  let targetFactoryCalls = 0;
  let controllerFactoryCalls = 0;
  const common = {
    sessionId: "session_application_integration",
    sharedSecret: "generated-192-bit-style-application-secret",
    now: () => clock,
  };
  const target = new MarionetteTargetApplication({
    ...common,
    peerId: "target_application_peer",
    scheduler: targetScheduler,
    transportFactory: () => {
      targetFactoryCalls += 1;
      return transports.target;
    },
  });
  const controller = new MarionetteControllerApplication({
    ...common,
    peerId: "controller_application_peer",
    scheduler: controllerScheduler,
    transportFactory: () => {
      controllerFactoryCalls += 1;
      return transports.controller;
    },
  });
  return {
    target,
    controller,
    transports,
    targetScheduler,
    controllerScheduler,
    factoryCalls: () => ({ target: targetFactoryCalls, controller: controllerFactoryCalls }),
    setClock: (value) => { clock = value; },
  };
}

async function startFixture(fixture) {
  const targetReady = eventOnce(fixture.target, "ready");
  const controllerReady = eventOnce(fixture.controller, "ready");
  await Promise.all([fixture.target.start(), fixture.controller.start()]);
  await Promise.all([targetReady, controllerReady]);
  await waitFor(() => fixture.controller.authoritativeState !== undefined, "initial authoritative state");
}

test("construction is inert and the manifest is fixed semantic data", async () => {
  const fixture = createFixture();
  assert.deepEqual(fixture.factoryCalls(), { target: 0, controller: 0 });
  assert.equal(fixture.transports.target.phase, "idle");
  assert.equal(fixture.transports.controller.phase, "idle");
  assert.equal(fixture.target.phase, "idle");
  assert.equal(fixture.controller.phase, "idle");
  assert.equal(Object.isFrozen(MARIONETTE_SCENE_MANIFEST), true);
  assert.deepEqual(MARIONETTE_SCENE_MANIFEST.controls.map(({ kind }) => kind), [
    "command-button",
    "toggle-command",
    "joystick-2d",
    "absolute-slider",
    "command-button",
  ]);

  await startFixture(fixture);
  assert.deepEqual(fixture.factoryCalls(), { target: 1, controller: 1 });
  assert.equal(fixture.target.phase, "ready");
  assert.equal(fixture.controller.phase, "ready");
  assert.deepEqual(fixture.controller.connection.acceptedScopes, ["scene.command", "scene.intent"]);
  await Promise.all([fixture.controller.stop(), fixture.target.stop()]);
});

test("application timer intervals are finite, positive, and profile-bounded", () => {
  const transports = createInMemoryTransportPair();
  const common = {
    sessionId: "session_interval_validation",
    sharedSecret: "generated-192-bit-style-interval-secret",
    now: () => 0,
    scheduler: new ManualScheduler(),
  };
  assert.throws(() => new MarionetteTargetApplication({
    ...common,
    peerId: "target_bad_lease_check",
    transportFactory: () => transports.target,
    leaseCheckMs: 0,
  }), /leaseCheckMs/);
  assert.throws(() => new MarionetteTargetApplication({
    ...common,
    peerId: "target_bad_state_heartbeat",
    transportFactory: () => transports.target,
    stateHeartbeatMs: Number.POSITIVE_INFINITY,
  }), /stateHeartbeatMs/);
  assert.throws(() => new MarionetteControllerApplication({
    ...common,
    peerId: "controller_bad_intent_heartbeat",
    transportFactory: () => transports.controller,
    intentHeartbeatMs: 500,
  }), /intentHeartbeatMs/);
});

test("active momentary state cannot be restored without a receiver-owned lease", () => {
  assert.throws(() => new MarionetteSceneAuthority({
    now: () => 0,
    initialState: {
      profile: "brsp-marionette-scene",
      version: 1,
      revision: 12,
      scene: { hue: 280, pulse: false },
      pointer: { x: 0.25, y: -0.5, active: true },
    },
  }), (error) => error instanceof ProfileValidationError
    && /initialState\.pointer\.active must be false.*receiver-owned lease/i.test(error.message));
});

test("smartphone intent is validated, applied once, and confirmed by target-owned state", async () => {
  const fixture = createFixture();
  await startFixture(fixture);

  const returnedState = eventOnce(fixture.controller, "statechange");
  assert.equal(fixture.controller.sendControls({
    pointer: { x: 0.7, y: -0.25, active: true },
    hue: 275,
  }), true);
  const returned = await returnedState;
  assert.equal(returned.state.revision, 1);
  assert.deepEqual(returned.state.pointer, { x: 0.7, y: -0.25, active: true });
  assert.equal(returned.state.scene.hue, 275);
  assert.deepEqual(fixture.target.authority.snapshot(), fixture.controller.authoritativeState);

  const unchangedRevision = fixture.target.authority.snapshot().revision;
  fixture.controllerScheduler.run(100);
  await waitFor(
    () => fixture.transports.controller.stats.stateSent >= 2,
    "active intent heartbeat",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.target.authority.snapshot().revision, unchangedRevision, "unchanged heartbeat renews the lease without revision churn");

  const beforeInvalid = fixture.target.authority.snapshot();
  assert.throws(() => fixture.controller.sendControls({
    pointer: { x: "0.1", y: 0, active: true },
    hue: 205,
  }), ProfileValidationError);
  assert.throws(() => fixture.target.authority.applyIntent({
    scope: "scene.intent",
    controls: { pointer: { x: 0, y: 0, active: false }, hue: Number.NaN },
    sequence: 99,
    receivedAt: 0,
  }), ProfileValidationError);
  assert.deepEqual(fixture.target.authority.snapshot(), beforeInvalid, "validation occurs before any authoritative mutation");

  await Promise.all([fixture.controller.stop(), fixture.target.stop()]);
});

test("reliable commands acknowledge success and reject stale revisions without mutation", async () => {
  const fixture = createFixture();
  await startFixture(fixture);

  const appliedSuccess = eventOnce(fixture.controller, "commandapplied");
  fixture.controller.setPulse(false, { expectedRevision: 0 });
  const success = await appliedSuccess;
  assert.equal(success.ok, true);
  assert.equal(success.revision, 1);
  assert.equal(fixture.target.authority.snapshot().scene.pulse, false);
  await waitFor(() => fixture.controller.authoritativeState?.revision === 1, "command state revision 1");

  const stateBeforeConflict = fixture.target.authority.snapshot();
  const appliedConflict = eventOnce(fixture.controller, "commandapplied");
  fixture.controller.reset({ expectedRevision: 0 });
  const conflict = await appliedConflict;
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, "revision_conflict");
  assert.equal(conflict.revision, 1);
  assert.deepEqual(fixture.target.authority.snapshot(), stateBeforeConflict);
  assert.equal(fixture.controller.pendingCommandId, undefined);
  assert.throws(() => fixture.controller.setPulse("yes"), ProfileValidationError);

  await Promise.all([fixture.controller.stop(), fixture.target.stop()]);
});

test("controller accepts equal-revision heartbeat but rejects authoritative revision rollback", async () => {
  const fixture = createFixture();
  await startFixture(fixture);
  fixture.controller.sendControls({
    pointer: { x: 0, y: 0, active: false },
    hue: 280,
  });
  await waitFor(() => fixture.controller.authoritativeState?.revision === 1, "authoritative revision 1");
  const current = fixture.target.authority.snapshot();

  const equalHeartbeat = eventOnce(fixture.controller, "statechange");
  fixture.target.connection.publishState(current, { revision: current.revision });
  assert.equal((await equalHeartbeat).state.revision, 1, "equal-revision state heartbeat is accepted");

  const reusedRevisionError = eventOnce(fixture.controller, "profileerror");
  const changedWithoutRevision = {
    ...current,
    scene: { ...current.scene, hue: 281 },
  };
  fixture.target.connection.publishState(changedWithoutRevision, { revision: current.revision });
  assert.match((await reusedRevisionError).message, /without advancing/i);
  assert.equal(fixture.controller.authoritativeState.scene.hue, 280);

  const rollbackError = eventOnce(fixture.controller, "profileerror");
  const rollback = { ...current, revision: 0 };
  fixture.target.connection.publishState(rollback, { revision: 0 });
  assert.match((await rollbackError).message, /backwards/i);
  assert.equal(fixture.controller.authoritativeState.revision, 1);
  assert.equal(fixture.controller.authoritativeState.scene.hue, 280);

  await Promise.all([fixture.controller.stop(), fixture.target.stop()]);
});

test("the target lease neutralizes a lost phone release while persistent hue holds", async () => {
  const fixture = createFixture();
  await startFixture(fixture);
  fixture.controller.sendControls({
    pointer: { x: -0.8, y: 0.4, active: true },
    hue: 330,
  });
  await waitFor(() => fixture.target.authority.snapshot().pointer.active, "active pointer at target");
  const activeRevision = fixture.target.authority.snapshot().revision;

  // The phone is now treated as suspended: its 100 ms scheduler is not run and no release arrives.
  fixture.setClock(499);
  assert.equal(fixture.target.checkLease(), false);
  const returnedNeutral = eventOnce(fixture.controller, "statechange");
  fixture.setClock(500);
  assert.equal(fixture.target.checkLease(), true);
  const neutral = await returnedNeutral;
  assert.equal(neutral.state.revision, activeRevision + 1);
  assert.deepEqual(neutral.state.pointer, { x: 0, y: 0, active: false });
  assert.equal(neutral.state.scene.hue, 330, "expiry:hold values survive momentary lease expiry");
  assert.equal(fixture.target.checkLease(), false, "expiry commits at most once");

  await Promise.all([fixture.controller.stop(), fixture.target.stop()]);
});

test("Stop cancels producers synchronously and neutralizes target-owned momentary state", async () => {
  const fixture = createFixture();
  await startFixture(fixture);
  fixture.controller.sendControls({
    pointer: { x: 0.5, y: 0.5, active: true },
    hue: 190,
  });
  await waitFor(() => fixture.target.authority.snapshot().pointer.active, "active pointer before stop");
  assert.equal(fixture.targetScheduler.tasks.size, 2);
  assert.equal(fixture.controllerScheduler.tasks.size, 1);

  const targetStop = fixture.target.stop();
  assert.equal(fixture.targetScheduler.tasks.size, 0, "target timers are cancelled before transport teardown completes");
  assert.deepEqual(fixture.target.authority.snapshot().pointer, { x: 0, y: 0, active: false });
  await targetStop;
  await fixture.controller.stop();
  assert.equal(fixture.controllerScheduler.tasks.size, 0);
  assert.equal(fixture.transports.target.phase, "closed");
  assert.equal(fixture.transports.controller.phase, "closed");
});

test("Stop removes connection and authority listeners so late callbacks are inert", async () => {
  const fixture = createFixture();
  await startFixture(fixture);
  const oldTargetConnection = fixture.target.connection;
  const oldControllerConnection = fixture.controller.connection;
  let relayedAuthorityEvents = 0;
  let relayedControllerStates = 0;
  fixture.target.addEventListener("localstatechange", () => { relayedAuthorityEvents += 1; });
  fixture.controller.addEventListener("statechange", () => { relayedControllerStates += 1; });

  await Promise.all([fixture.controller.stop(), fixture.target.stop()]);
  relayedAuthorityEvents = 0;
  relayedControllerStates = 0;
  fixture.target.authority.commit({
    scene: { hue: 210, pulse: false },
    pointer: { x: 0, y: 0, active: false },
    reason: "late-local-callback-fixture",
  });
  dispatchDetail(oldControllerConnection, "state", {
    revision: 99,
    state: {
      profile: "brsp-marionette-scene",
      version: 1,
      revision: 99,
      scene: { hue: 99, pulse: false },
      pointer: { x: 0, y: 0, active: false },
    },
  });
  dispatchDetail(oldTargetConnection, "ready", { acceptedScopes: [] });
  assert.equal(relayedAuthorityEvents, 0);
  assert.equal(relayedControllerStates, 0);
  assert.equal(fixture.target.phase, "stopped");
  assert.equal(fixture.controller.phase, "stopped");
  assert.equal(fixture.target.connectionListeners.length, 0);
  assert.equal(fixture.target.authorityListeners.length, 0);
});

test("failed Start stops transport with or without a constructed BRSP connection", async () => {
  class ConstructorRejectedTransport extends EventTarget {
    constructor() {
      super();
      this.stops = 0;
    }

    async stop() { this.stops += 1; }
  }

  const constructorRejected = new ConstructorRejectedTransport();
  const rejectedController = new MarionetteControllerApplication({
    sessionId: "session_constructor_rejected",
    sharedSecret: "generated-192-bit-style-rejected-secret",
    peerId: "controller_constructor_rejected",
    scheduler: new ManualScheduler(),
    transportFactory: () => constructorRejected,
  });
  await assert.rejects(rejectedController.start(), /transport must implement/i);
  assert.equal(constructorRejected.stops, 1, "factory-created transport is stopped even when BRSP construction fails");
  assert.equal(rejectedController.phase, "error");

  class StartRejectedTransport extends EventTarget {
    constructor() {
      super();
      this.stops = 0;
    }

    sendControl() { return false; }

    sendState() { return false; }

    closePeer() {}

    async start() { throw new Error("deliberate transport start failure"); }

    async stop() { this.stops += 1; }
  }

  const startRejected = new StartRejectedTransport();
  const rejectedTarget = new MarionetteTargetApplication({
    sessionId: "session_start_rejected",
    sharedSecret: "generated-192-bit-style-start-secret",
    peerId: "target_start_rejected",
    scheduler: new ManualScheduler(),
    transportFactory: () => startRejected,
  });
  let lateAuthorityEvents = 0;
  rejectedTarget.addEventListener("localstatechange", () => { lateAuthorityEvents += 1; });
  await assert.rejects(rejectedTarget.start(), /deliberate transport start failure/);
  assert.equal(startRejected.stops, 1);
  rejectedTarget.authority.commit({
    scene: { hue: 220, pulse: false },
    pointer: { x: 0, y: 0, active: false },
    reason: "post-failure-listener-fixture",
  });
  assert.equal(lateAuthorityEvents, 0, "failed Start removes authority relay listeners");
  assert.equal(rejectedTarget.connectionListeners.length, 0);
  assert.equal(rejectedTarget.authorityListeners.length, 0);
});

test("the pure authority rejects exotic or partial values before mutation", () => {
  const authority = new MarionetteSceneAuthority({ now: () => 0 });
  const initial = authority.snapshot();
  assert.throws(() => authority.applyIntent({
    scope: "scene.intent",
    controls: new Map(),
    sequence: 1,
    receivedAt: 0,
  }), ProfileValidationError);
  assert.throws(() => authority.applyIntent({
    scope: "scene.intent",
    controls: { pointer: { x: 0, active: true }, hue: 200 },
    sequence: 2,
    receivedAt: 0,
  }), ProfileValidationError);
  assert.deepEqual(authority.applyCommand({
    commandId: "command_bad_args",
    scope: "scene.command",
    action: "set-pulse",
    args: { enabled: "yes" },
    expectedRevision: 0,
  }), {
    ok: false,
    revision: 0,
    result: null,
    error: "invalid_argument",
  });
  assert.deepEqual(authority.snapshot(), initial);
});
