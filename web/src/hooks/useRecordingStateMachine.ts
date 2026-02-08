"use client";

import { useReducer, useCallback } from "react";

// ===================================
// Recording State Machine
// ===================================
// BUG-1~7 の根本原因である「独立 boolean フラグの組み合わせ爆発」を
// 有限状態マシン (FSM) で解決する。
// 有効な状態遷移のみ許可し、無効な状態の組み合わせを型レベルで防止。

export type RecordingState =
  | "idle"
  | "starting"
  | "recording"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping"
  | "stopped"
  | "error";

export type RecordingAction =
  | { type: "START" }
  | { type: "START_SUCCESS" }
  | { type: "START_FAILURE"; error: string }
  | { type: "PAUSE" }
  | { type: "PAUSE_SUCCESS" }
  | { type: "RESUME" }
  | { type: "RESUME_SUCCESS" }
  | { type: "STOP" }
  | { type: "STOP_SUCCESS" }
  | { type: "ERROR"; error: string }
  | { type: "RESET" };

interface RecordingMachineState {
  state: RecordingState;
  error: string | null;
}

// 有効な状態遷移マップ
const transitions: Record<
  RecordingState,
  Partial<Record<RecordingAction["type"], RecordingState>>
> = {
  idle: { START: "starting" },
  starting: { START_SUCCESS: "recording", START_FAILURE: "error" },
  recording: { PAUSE: "pausing", STOP: "stopping", ERROR: "error" },
  pausing: { PAUSE_SUCCESS: "paused", ERROR: "error" },
  paused: { RESUME: "resuming", STOP: "stopping" },
  resuming: { RESUME_SUCCESS: "recording", ERROR: "error" },
  stopping: { STOP_SUCCESS: "stopped", ERROR: "error" },
  stopped: { RESET: "idle", START: "starting" },
  error: { RESET: "idle" },
};

function recordingReducer(
  current: RecordingMachineState,
  action: RecordingAction
): RecordingMachineState {
  const nextState = transitions[current.state][action.type];

  if (!nextState) {
    // 無効な遷移 — 無視（連打防止）
    console.warn(
      `[FSM] Invalid transition: ${current.state} + ${action.type} → ignored`
    );
    return current;
  }

  const error =
    action.type === "START_FAILURE" || action.type === "ERROR"
      ? (action as { error: string }).error
      : nextState === "idle" || nextState === "recording"
        ? null
        : current.error;

  return { state: nextState, error };
}

const initialState: RecordingMachineState = {
  state: "idle",
  error: null,
};

export interface UseRecordingStateMachineReturn {
  /** 現在の FSM 状態 */
  recordingState: RecordingState;
  /** FSM エラー */
  fsmError: string | null;
  /** アクション dispatch */
  dispatch: (action: RecordingAction) => void;
  /** 便利な状態チェッカー */
  isIdle: boolean;
  isRecording: boolean;
  isPaused: boolean;
  isStopped: boolean;
  isTransitioning: boolean;
  /** 各操作が可能かどうか */
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canReset: boolean;
}

export function useRecordingStateMachine(): UseRecordingStateMachineReturn {
  const [machine, dispatch] = useReducer(recordingReducer, initialState);

  const isIdle = machine.state === "idle";
  const isRecording = machine.state === "recording";
  const isPaused = machine.state === "paused";
  const isStopped = machine.state === "stopped";
  const isTransitioning = ["starting", "pausing", "resuming", "stopping"].includes(
    machine.state
  );

  const canStart = machine.state === "idle" || machine.state === "stopped";
  const canPause = machine.state === "recording";
  const canResume = machine.state === "paused";
  const canStop = machine.state === "recording" || machine.state === "paused";
  const canReset = machine.state === "stopped" || machine.state === "error";

  const safeDispatch = useCallback(
    (action: RecordingAction) => {
      dispatch(action);
    },
    []
  );

  return {
    recordingState: machine.state,
    fsmError: machine.error,
    dispatch: safeDispatch,
    isIdle,
    isRecording,
    isPaused,
    isStopped,
    isTransitioning,
    canStart,
    canPause,
    canResume,
    canStop,
    canReset,
  };
}
