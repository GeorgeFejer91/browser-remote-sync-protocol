import {
  BRSPApplicationTarget,
  rejectApplicationAction,
} from "../../src/application-target.js";

const exactKeys = (value, keys) => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

/** Model adapter for a discrete-command experiment Runner-like target. */
export function createRunnerTarget() {
  return new BRSPApplicationTarget({
    profile: "experiment-runner.v1",
    initialState: {
      phase: "ready",
      activePart: null,
      paused: false,
      instructionWaiting: false,
      participantPath: "C:/private/session/P001",
    },
    projectState: ({ revision, phase, activePart, paused, instructionWaiting }) => ({
      revision,
      phase,
      activePart,
      paused,
      instructionWaiting,
    }),
    commands: [
      {
        scope: "runner.operate",
        action: "start-part",
        validate: ({ args }) => exactKeys(args, ["part"]) && (args.part === 1 || args.part === 2),
        reduce: ({ state, args }) => {
          if (state.phase !== "ready") return rejectApplicationAction("command_rejected");
          return {
            state: { ...state, phase: "running", activePart: args.part, paused: false },
            result: { activePart: args.part },
          };
        },
      },
      {
        scope: "runner.operate",
        action: "pause",
        reduce: ({ state }) => state.phase === "running" && !state.paused
          ? { state: { ...state, paused: true }, result: { paused: true } }
          : rejectApplicationAction("command_rejected"),
      },
      {
        scope: "runner.operate",
        action: "resume",
        reduce: ({ state }) => state.phase === "running" && state.paused
          ? { state: { ...state, paused: false }, result: { paused: false } }
          : rejectApplicationAction("command_rejected"),
      },
      {
        scope: "runner.operate",
        action: "continue-instruction",
        reduce: ({ state }) => state.instructionWaiting
          ? { state: { ...state, instructionWaiting: false } }
          : rejectApplicationAction("command_rejected"),
      },
    ],
  });
}
