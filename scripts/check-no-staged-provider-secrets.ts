type HookEventName = "PreToolUse";

interface HookInput {
  cwd?: string;
  hookEventName?: HookEventName | string;
  tool_name?: string;
  tool_input?: unknown;
}

interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: HookEventName;
    permissionDecision: "allow" | "ask" | "deny";
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}

interface DiffScanResult {
  label: string;
  diffText: string;
}

interface SecretViolation {
  source: string;
  filePath: string;
  lineNumber: number | null;
  redactedLine: string;
}

const SECRET_PREFIX = "sk-or-v1-";
const SECRET_PATTERN = /sk-or-v1-[A-Za-z0-9_-]*/g;
const GIT_COMMIT_PATTERN = /\bgit\s+commit\b/i;
const GIT_PUSH_PATTERN = /\bgit\s+push\b/i;
const PROVIDER_SENSITIVE_PATH_PREFIXES = [
  "TODO.md",
  "docs/PROVIDERS.md",
  "src/providers/",
  "src/runtime/config.ts",
];

async function readAllFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}

function parseHookInput(raw: string): HookInput | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as HookInput;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function printJson(payload: HookOutput): void {
  console.log(JSON.stringify(payload));
}

function extractToolInputText(toolInput: unknown): string {
  if (typeof toolInput === "string") {
    return toolInput;
  }

  try {
    return JSON.stringify(toolInput ?? "");
  } catch {
    return String(toolInput ?? "");
  }
}

function shouldInspectTool(input: HookInput): boolean {
  if (input.hookEventName !== "PreToolUse") {
    return false;
  }

  const candidate = extractToolInputText(input.tool_input);
  return GIT_COMMIT_PATTERN.test(candidate) || GIT_PUSH_PATTERN.test(candidate);
}

function decodeBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function runGit(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = decodeBytes(result.stderr);
    throw new Error(stderr || `git ${args.join(" ")} failed with exit code ${result.exitCode}`);
  }

  return decodeBytes(result.stdout);
}

function resolveUpstreamRef(cwd: string): string {
  try {
    return runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  } catch {
    try {
      const originHead = runGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
      return originHead.replace(/^refs\/remotes\//, "");
    } catch {
      return "origin/main";
    }
  }
}

function collectDiffs(cwd: string, toolText: string): DiffScanResult[] {
  const scans: DiffScanResult[] = [];

  if (GIT_COMMIT_PATTERN.test(toolText)) {
    scans.push({
      label: "staged changes",
      diffText: runGit(cwd, ["diff", "--cached", "--no-color", "--unified=0", "-G", SECRET_PREFIX, "--"]),
    });
  }

  if (GIT_PUSH_PATTERN.test(toolText)) {
    const upstreamRef = resolveUpstreamRef(cwd);
    scans.push({
      label: `outgoing commits against ${upstreamRef}`,
      diffText: runGit(cwd, ["diff", "--no-color", "--unified=0", "-G", SECRET_PREFIX, `${upstreamRef}...HEAD`, "--"]),
    });
  }

  return scans;
}

function redactSecrets(value: string): string {
  return value.replaceAll(SECRET_PATTERN, `${SECRET_PREFIX}•••`);
}

function detectViolations(scan: DiffScanResult): SecretViolation[] {
  const violations: SecretViolation[] = [];
  let currentFilePath = "unknown";
  let currentLineNumber: number | null = null;

  for (const line of scan.diffText.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const rawPath = line.slice(4).trim();
      currentFilePath = rawPath === "/dev/null" ? "unknown" : rawPath.replace(/^b\//, "");
      continue;
    }

    if (line.startsWith("@@")) {
      const match = /\+(\d+)(?:,\d+)?/.exec(line);
      currentLineNumber = match ? Number(match[1]) : null;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      const addedLine = line.slice(1);
      if (addedLine.includes(SECRET_PREFIX)) {
        violations.push({
          source: scan.label,
          filePath: currentFilePath,
          lineNumber: currentLineNumber,
          redactedLine: redactSecrets(addedLine).trim(),
        });
      }

      if (currentLineNumber !== null) {
        currentLineNumber += 1;
      }
    }
  }

  return violations;
}

function formatLocation(violation: SecretViolation): string {
  return violation.lineNumber === null
    ? violation.filePath
    : `${violation.filePath}:${violation.lineNumber}`;
}

function isProviderSensitivePath(filePath: string): boolean {
  return PROVIDER_SENSITIVE_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? filePath.startsWith(prefix) : filePath === prefix,
  );
}

function summarizeViolations(violations: SecretViolation[]): string {
  const uniqueLocations = Array.from(new Set(violations.map((violation) => formatLocation(violation))));
  return uniqueLocations.slice(0, 5).join(", ");
}

function buildAdditionalContext(violations: SecretViolation[]): string {
  const previewLines = violations.slice(0, 3).map((violation) => {
    const location = formatLocation(violation);
    return `- ${violation.source} · ${location} · ${violation.redactedLine || "(line hidden)"}`;
  });

  const sensitiveFiles = Array.from(
    new Set(
      violations
        .map((violation) => violation.filePath)
        .filter((filePath) => isProviderSensitivePath(filePath)),
    ),
  );

  const providerNote = sensitiveFiles.length
    ? `Provider-sensitive files touched: ${sensitiveFiles.join(", ")}.`
    : `Provider-sensitive hotspots covered by policy: ${PROVIDER_SENSITIVE_PATH_PREFIXES.join(", ")}.`;

  return [
    `Secret-like text matching ${SECRET_PREFIX} was found in newly added git diff lines.`,
    providerNote,
    ...previewLines,
  ].join("\n");
}

function allow(message?: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: message,
    },
  };
}

function deny(reason: string, additionalContext?: string): HookOutput {
  return {
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      additionalContext,
    },
  };
}

function runHookCheck(input: HookInput): HookOutput {
  if (!shouldInspectTool(input)) {
    return allow();
  }

  const cwd = input.cwd?.trim() || process.cwd();
  const toolText = extractToolInputText(input.tool_input);

  try {
    const scans = collectDiffs(cwd, toolText);
    const violations = scans.flatMap((scan) => detectViolations(scan));

    if (violations.length === 0) {
      return allow("No staged or outgoing provider secrets detected.");
    }

    const reason = `Blocked git commit/push: found ${SECRET_PREFIX} in ${summarizeViolations(violations)}.`;
    return deny(reason, buildAdditionalContext(violations));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown git inspection error";
    return deny(
      `Blocked git commit/push because the secret scan could not inspect your git changes: ${message}`,
      `The ${SECRET_PREFIX} guard errs on the safe side when git inspection fails.`,
    );
  }
}

function runStandaloneCheck(cwd: string): number {
  try {
    const scan = {
      label: "staged changes",
      diffText: runGit(cwd, ["diff", "--cached", "--no-color", "--unified=0", "-G", SECRET_PREFIX, "--"]),
    } satisfies DiffScanResult;
    const violations = detectViolations(scan);
    if (violations.length === 0) {
      console.log(`No staged additions contain ${SECRET_PREFIX}.`);
      return 0;
    }

    console.error(buildAdditionalContext(violations));
    return 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

async function main(): Promise<void> {
  const rawInput = await readAllFromStdin();
  const hookInput = parseHookInput(rawInput);

  if (!hookInput) {
    process.exit(runStandaloneCheck(process.cwd()));
  }

  printJson(runHookCheck(hookInput));
}

await main();