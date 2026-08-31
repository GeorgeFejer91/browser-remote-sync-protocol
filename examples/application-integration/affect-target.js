import { BRSPApplicationTarget } from "../../src/application-target.js";

const exactKeys = (value, keys) => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

const finiteUnit = (value) => Number.isFinite(value) && value >= -1 && value <= 1;

/** Model adapter for a high-rate Affect Tracker-like native target. */
export function createAffectTarget() {
  return new BRSPApplicationTarget({
    profile: "affect-tracker.v1",
    initialState: {
      targetX: 0,
      targetY: 0,
      paused: false,
      localLslMessage: "local-only diagnostic",
    },
    projectState: ({ revision, targetX, targetY, paused }) => ({
      revision,
      targetX,
      targetY,
      paused,
    }),
    commands: [
      {
        scope: "affect.control",
        action: "reset",
        reduce: ({ state }) => ({
          state: { ...state, targetX: 0, targetY: 0 },
          result: { targetX: 0, targetY: 0 },
        }),
      },
      {
        scope: "affect.control",
        action: "set-paused",
        validate: ({ args }) => exactKeys(args, ["paused"]) && typeof args.paused === "boolean",
        reduce: ({ state, args }) => ({
          state: { ...state, paused: args.paused },
          result: { paused: args.paused },
          changed: state.paused !== args.paused,
        }),
      },
    ],
    intents: [
      {
        scope: "affect.control",
        validate: ({ controls }) => exactKeys(controls, ["target"])
          && exactKeys(controls.target, ["x", "y"])
          && finiteUnit(controls.target.x)
          && finiteUnit(controls.target.y),
        reduce: ({ state, controls }) => ({
          state: {
            ...state,
            targetX: controls.target.x,
            targetY: controls.target.y,
          },
        }),
      },
    ],
  });
}
