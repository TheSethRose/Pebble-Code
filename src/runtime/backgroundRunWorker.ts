#!/usr/bin/env bun

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import {
  appendBackgroundRunLog,
  appendBackgroundRunOutput,
  loadBackgroundRunRecord,
  type BackgroundRunRecord,
  saveBackgroundRunRecord,
  type VerificationCommand,
} from "./backgroundRuns.js";

const args = process.argv.slice(2);
const recordPath = getFlagValue(args, "--record");

if (!recordPath) {
  console.error("Missing --record for background run worker.");
  process.exit(1);
}

const initialRecord = loadBackgroundRunRecord(recordPath);
if (!initialRecord) {
  console.error(`Background run record not found: ${recordPath}`);
  process.exit(1);
}

let currentRecord = saveBackgroundRunRecord(recordPath, {
  ...initialRecord,
  status: "running",
  workerPid: process.pid,
  startedAt: initialRecord.startedAt ?? new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  summary: `Running background ${initialRecord.task} task.`,
});

appendBackgroundRunLog(currentRecord.logPath, `== Background ${currentRecord.task} run ${currentRecord.id} ==`);

let stopRequested = false;
let activeChild: ChildProcessWithoutNullStreams | null = null;
const abortController = new AbortController();

const requestStop = (signalName: string) => {
  if (stopRequested) {
    return;
  }

  stopRequested = true;
  appendBackgroundRunLog(currentRecord.logPath, `[worker] Stop requested via ${signalName}.`);
  abortController.abort();
  if (activeChild && !activeChild.killed) {
    activeChild.kill("SIGTERM");
  }
};

process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));

const originalLog = console.log;
const originalError = console.error;

console.log = (...parts: unknown[]) => {
  appendBackgroundRunLog(currentRecord.logPath, parts.map((part) => String(part)).join(" "));
};

console.error = (...parts: unknown[]) => {
  appendBackgroundRunLog(currentRecord.logPath, parts.map((part) => String(part)).join(" "));
};

try {
  const exitCode = currentRecord.task === "agent"
    ? await runAgentTask(currentRecord, abortController.signal)
    : await runVerificationTask(currentRecord, abortController.signal, (child) => {
      activeChild = child;
    });

  finalizeRecord({
    record: currentRecord,
    exitCode,
    status: stopRequested ? "stopped" : exitCode === 0 ? "completed" : "failed",
    summary: stopRequested
      ? `Background ${currentRecord.task} run stopped.`
      : exitCode === 0
        ? `Background ${currentRecord.task} run completed.`
        : `Background ${currentRecord.task} run failed with exit code ${exitCode}.`,
    error: stopRequested || exitCode === 0 ? undefined : `Exited with code ${exitCode}`,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  appendBackgroundRunLog(currentRecord.logPath, `[worker] Fatal background run error: ${message}`);
  finalizeRecord({
    record: currentRecord,
    exitCode: 1,
    status: stopRequested ? "stopped" : "failed",
    summary: stopRequested ? `Background ${currentRecord.task} run stopped.` : `Background ${currentRecord.task} run failed.`,
    error: stopRequested ? undefined : message,
  });
}

console.log = originalLog;
console.error = originalError;

function finalizeRecord(params: {
  record: BackgroundRunRecord;
  exitCode: number;
  status: BackgroundRunRecord["status"];
  summary: string;
  error?: string;
}): void {
  currentRecord = saveBackgroundRunRecord(recordPath, {
    ...params.record,
    status: params.status,
    exitCode: params.exitCode,
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary: params.summary,
    ...(params.error ? { error: params.error } : {}),
  });

  appendBackgroundRunLog(currentRecord.logPath, `[worker] ${params.summary}`);
  process.exit(params.status === "completed" ? 0 : params.status === "stopped" ? 130 : 1);
}

async function runAgentTask(record: BackgroundRunRecord, signal: AbortSignal): Promise<number> {
  const { run } = await import("./main.js");
  appendBackgroundRunLog(record.logPath, `[worker] Starting headless Pebble run for session ${record.sessionId ?? "(new session)"}.`);
  return run({
    headless: true,
    prompt: record.prompt,
    resume: record.sessionId,
    cwd: record.cwd,
    provider: record.provider,
    model: record.model,
    format: "json-stream",
    signal,
  });
}

async function runVerificationTask(
  record: BackgroundRunRecord,
  signal: AbortSignal,
  setActiveChild: (child: ChildProcessWithoutNullStreams | null) => void,
): Promise<number> {
  let lastExitCode = 0;

  for (const command of record.commands ?? []) {
    if (signal.aborted) {
      return 130;
    }

    const resolved = resolveVerificationCommand(command);
    appendBackgroundRunLog(record.logPath, `$ ${resolved.join(" ")}`);
    lastExitCode = await runLoggedCommand(resolved, record.cwd, record.logPath, signal, setActiveChild);
    if (lastExitCode !== 0) {
      return lastExitCode;
    }
  }

  return lastExitCode;
}

function runLoggedCommand(
  command: string[],
  cwd: string,
  logPath: string,
  signal: AbortSignal,
  setActiveChild: (child: ChildProcessWithoutNullStreams | null) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    setActiveChild(child);

    child.stdout.on("data", (chunk) => {
      appendBackgroundRunOutput(logPath, chunk.toString("utf-8"));
    });
    child.stderr.on("data", (chunk) => {
      appendBackgroundRunOutput(logPath, chunk.toString("utf-8"));
    });

    const abortHandler = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    signal.addEventListener("abort", abortHandler, { once: true });

    child.once("error", (error) => {
      signal.removeEventListener("abort", abortHandler);
      setActiveChild(null);
      reject(error);
    });

    child.once("close", (exitCode) => {
      signal.removeEventListener("abort", abortHandler);
      setActiveChild(null);
      resolve(exitCode ?? 1);
    });
  });
}

function resolveVerificationCommand(command: VerificationCommand): string[] {
  if (command === "test") {
    return ["bun", "test"];
  }

  if (command === "typecheck") {
    return ["bun", "run", "typecheck"];
  }

  return ["bun", "run", "build"];
}

function getFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return argv[index + 1];
}