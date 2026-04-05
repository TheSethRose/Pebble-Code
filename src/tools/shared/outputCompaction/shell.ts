import { truncateText } from "../common.js";
import { persistRawToolOutput } from "./rawOutput.js";
import {
	type CompactionMode,
	DEFAULT_RAW_OUTPUT_LIMIT,
	getVisibleItemLimit,
	type ShellCommandFamily,
	type ShellExecutionSummary,
	uniqueStrings,
} from "./shared.js";

export function summarizeShellExecution(params: {
	command: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	cwd: string;
	mode?: CompactionMode;
	maxChars?: number;
}): ShellExecutionSummary {
	const rawOutput = [params.stdout, params.stderr].filter(Boolean).join("\n\n").trim() || "(no output)";
	const family = detectShellCommandFamily(params.command);
	const mode = params.mode ?? "auto";
	const baseDebug = {
		command: params.command,
		commandFamily: family,
		exitCode: params.exitCode,
		compactionMode: mode,
	} satisfies Record<string, unknown>;

	if (mode === "off") {
		const truncated = truncateText(rawOutput, params.maxChars ?? DEFAULT_RAW_OUTPUT_LIMIT);
		return {
			output: truncated.text,
			summary: params.exitCode === 0 ? "Executed shell command" : `Command failed with exit code ${params.exitCode}`,
			truncated: truncated.truncated,
			commandFamily: family,
			debug: {
				...baseDebug,
				compactionApplied: false,
				rawOutputBytes: rawOutput.length,
			},
		};
	}

	switch (family) {
		case "git-status":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitStatus(rawOutput, mode),
			});
		case "git-diff-name-only":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitFileList(rawOutput, "Changed files", mode),
			});
		case "git-diff-stat":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitDiffStat(rawOutput, mode),
			});
		case "git-show-stat":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitShowStat(rawOutput, mode),
			});
		case "git-branch-vv":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitBranchVerbose(rawOutput, mode),
			});
		case "git-stash-list":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitStashList(rawOutput, mode),
			});
		case "git-ls-files":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitFileList(rawOutput, "Tracked files", mode),
			});
		case "git-log-oneline":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactGitLogOneline(rawOutput, mode),
			});
		case "test":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactTestOutput(rawOutput, params.exitCode, mode),
			});
		case "diagnostics":
			return finalizeShellSummary({
				...params,
				mode,
				family,
				rawOutput,
				baseDebug,
				compacted: compactDiagnosticsOutput(rawOutput, params.exitCode, mode),
			});
		case "generic": {
			const truncated = truncateText(rawOutput, params.maxChars ?? DEFAULT_RAW_OUTPUT_LIMIT);
			return {
				output: truncated.text,
				summary: params.exitCode === 0 ? "Executed shell command" : `Command failed with exit code ${params.exitCode}`,
				truncated: truncated.truncated,
				commandFamily: family,
				debug: {
					...baseDebug,
					compactionApplied: false,
					rawOutputBytes: rawOutput.length,
				},
			};
		}
	}
}

function finalizeShellSummary(params: {
	command: string;
	cwd: string;
	exitCode: number;
	mode: CompactionMode;
	maxChars?: number;
	rawOutput: string;
	family: ShellCommandFamily;
	baseDebug: Record<string, unknown>;
	compacted: { output: string; summary: string; debug?: Record<string, unknown> };
}): ShellExecutionSummary {
	const shouldPersistRaw = params.exitCode !== 0 || params.rawOutput.length > (params.maxChars ?? DEFAULT_RAW_OUTPUT_LIMIT);
	const rawOutputPath = shouldPersistRaw
		? persistRawToolOutput({
				cwd: params.cwd,
				category: "shell",
				identifier: params.family,
				rawOutput: params.rawOutput,
			})
		: undefined;

	const persistedHint = rawOutputPath ? `\n\n[Full output saved to ${rawOutputPath}]` : "";
	const output = `${params.compacted.output}${persistedHint}`;
	const wasCompacted = output.trim() !== params.rawOutput.trim() || Boolean(rawOutputPath);

	return {
		output,
		summary: params.compacted.summary,
		truncated: wasCompacted,
		commandFamily: params.family,
		rawOutputPath,
		debug: {
			...params.baseDebug,
			...(params.compacted.debug ?? {}),
			compactionApplied: true,
			rawOutputBytes: params.rawOutput.length,
			...(rawOutputPath ? { rawOutputPath } : {}),
		},
	};
}

function detectShellCommandFamily(command: string): ShellCommandFamily {
	const normalized = command.trim().replace(/\s+/g, " ").toLowerCase();

	if (/^git status(?:\s|$)/.test(normalized)) return "git-status";
	if (/^git diff(?:\s|$)/.test(normalized) && normalized.includes("--name-only")) return "git-diff-name-only";
	if (/^git show(?:\s|$)/.test(normalized) && normalized.includes("--stat")) return "git-show-stat";
	if (/^git branch(?:\s|$)/.test(normalized) && normalized.includes("--vv")) return "git-branch-vv";
	if (/^git stash list(?:\s|$)/.test(normalized)) return "git-stash-list";
	if (/^git ls-files(?:\s|$)/.test(normalized)) return "git-ls-files";
	if (/^git diff(?:\s|$)/.test(normalized)) return "git-diff-stat";
	if (/^git log(?:\s|$)/.test(normalized) && normalized.includes("--oneline")) return "git-log-oneline";
	if (/^(bun test|bun run test|cargo test|pytest(?:\s|$)|go test(?:\s|$)|vitest(?:\s|$)|jest(?:\s|$)|npm test(?:\s|$)|pnpm test(?:\s|$)|yarn test(?:\s|$))/.test(normalized)) return "test";
	if (/^(bun run build|bun run typecheck|bun run lint|tsc(?:\s|$)|eslint(?:\s|$)|biome(?:\s|$)|ruff(?:\s|$)|cargo build(?:\s|$)|cargo check(?:\s|$)|cargo clippy(?:\s|$))/.test(normalized)) return "diagnostics";
	return "generic";
}

function compactGitStatus(rawOutput: string, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const lines = rawOutput.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	if (lines.length === 0) {
		return {
			output: "Working tree clean.",
			summary: "Git status · clean",
			debug: { fileCount: 0, stagedCount: 0, unstagedCount: 0, untrackedCount: 0 },
		};
	}

	let stagedCount = 0;
	let unstagedCount = 0;
	let untrackedCount = 0;
	let modifiedCount = 0;
	let addedCount = 0;
	let deletedCount = 0;
	let renamedCount = 0;
	let branchSummary: string | undefined;
	const fileLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith("## ")) {
			branchSummary = line.slice(3).trim();
			continue;
		}

		fileLines.push(line);
		const status = line.slice(0, 2);
		if (status === "??") {
			untrackedCount += 1;
			continue;
		}

		if (status[0] && status[0] !== " ") stagedCount += 1;
		if (status[1] && status[1] !== " ") unstagedCount += 1;
		if (status.includes("M")) modifiedCount += 1;
		if (status.includes("A")) addedCount += 1;
		if (status.includes("D")) deletedCount += 1;
		if (status.includes("R")) renamedCount += 1;
	}

	const visibleFiles = fileLines.slice(0, getVisibleItemLimit(mode, { auto: 12, aggressive: 8 }));
	const summaryBits = [branchSummary, stagedCount > 0 ? `${stagedCount} staged` : undefined, unstagedCount > 0 ? `${unstagedCount} unstaged` : undefined, untrackedCount > 0 ? `${untrackedCount} untracked` : undefined].filter((value): value is string => Boolean(value));
	const detailBits = [modifiedCount > 0 ? `${modifiedCount} modified` : undefined, addedCount > 0 ? `${addedCount} added` : undefined, deletedCount > 0 ? `${deletedCount} deleted` : undefined, renamedCount > 0 ? `${renamedCount} renamed` : undefined].filter((value): value is string => Boolean(value));

	return {
		output: [
			`Files changed: ${fileLines.length}`,
			summaryBits.length > 0 ? `State: ${summaryBits.join(", ")}` : undefined,
			detailBits.length > 0 ? `Kinds: ${detailBits.join(", ")}` : undefined,
			"",
			...visibleFiles,
			fileLines.length > visibleFiles.length ? `... +${fileLines.length - visibleFiles.length} more` : undefined,
		].filter((line): line is string => Boolean(line)).join("\n"),
		summary: `Git status · ${fileLines.length} file${fileLines.length === 1 ? "" : "s"}`,
		debug: { fileCount: fileLines.length, branchSummary, stagedCount, unstagedCount, untrackedCount },
	};
}

function compactGitFileList(rawOutput: string, label: string, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const files = rawOutput.split("\n").map((line) => line.trim()).filter(Boolean);
	if (files.length === 0) {
		return { output: `${label}: 0\nNo files to show.`, summary: `${label} · 0 files`, debug: { fileCount: 0 } };
	}

	const visible = files.slice(0, getVisibleItemLimit(mode, { auto: 20, aggressive: 10 }));
	return {
		output: [`${label}: ${files.length}`, "", ...visible, files.length > visible.length ? `... +${files.length - visible.length} more` : undefined].filter((line): line is string => Boolean(line)).join("\n"),
		summary: `${label} · ${files.length} file${files.length === 1 ? "" : "s"}`,
		debug: { fileCount: files.length },
	};
}

function compactGitDiffStat(rawOutput: string, mode: CompactionMode): { output: string; summary: string } {
	const lines = rawOutput.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	const statLines = lines.filter((line) => line.includes("|") || /files? changed|insertions?\(\+\)|deletions?\(-\)/.test(line));
	const visible = statLines.slice(0, getVisibleItemLimit(mode, { auto: 12, aggressive: 8 }));
	const summaryLine = statLines.findLast((line) => /files? changed|insertions?\(\+\)|deletions?\(-\)/.test(line));
	return {
		output: [...visible, summaryLine && !visible.includes(summaryLine) ? summaryLine : undefined, statLines.length > visible.length ? `... +${statLines.length - visible.length} more` : undefined].filter((line): line is string => Boolean(line)).join("\n") || rawOutput,
		summary: summaryLine ? `Git diff · ${summaryLine}` : "Git diff summary",
	};
}

function compactGitShowStat(rawOutput: string, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const lines = rawOutput.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	if (lines.length === 0) {
		return { output: "No commit details available.", summary: "Git show · no output", debug: { fileCount: 0 } };
	}

	const subjectLine = lines[0] ?? "git show";
	const statSummary = lines.findLast((line) => /files? changed|insertions?\(\+\)|deletions?\(-\)/.test(line));
	const fileLines = lines.filter((line) => line.includes("|"));
	const visible = fileLines.slice(0, getVisibleItemLimit(mode, { auto: 12, aggressive: 8 }));
	return {
		output: [subjectLine, statSummary ? "" : undefined, statSummary, visible.length > 0 ? "" : undefined, ...visible, fileLines.length > visible.length ? `... +${fileLines.length - visible.length} more` : undefined].filter((line): line is string => Boolean(line)).join("\n"),
		summary: statSummary ? `Git show · ${subjectLine} · ${statSummary}` : `Git show · ${subjectLine}`,
		debug: { fileCount: fileLines.length, subjectLine },
	};
}

function compactGitBranchVerbose(rawOutput: string, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const lines = rawOutput.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	const current = lines.find((line) => line.startsWith("* "))?.slice(2).trim();
	const visible = lines.slice(0, getVisibleItemLimit(mode, { auto: 12, aggressive: 8 }));
	return {
		output: [`Branches: ${lines.length}`, current ? `Current: ${current}` : undefined, "", ...visible, lines.length > visible.length ? `... +${lines.length - visible.length} more` : undefined].filter((line): line is string => Boolean(line)).join("\n"),
		summary: current ? `Git branches · ${current}` : `Git branches · ${lines.length} total`,
		debug: { branchCount: lines.length, currentBranch: current },
	};
}

function compactGitStashList(rawOutput: string, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const entries = rawOutput.split("\n").map((line) => line.trim()).filter(Boolean);
	if (entries.length === 0) {
		return { output: "Stashes: 0\nNo stashes saved.", summary: "Git stashes · 0", debug: { stashCount: 0 } };
	}

	const visible = entries.slice(0, getVisibleItemLimit(mode, { auto: 10, aggressive: 6 }));
	return {
		output: [`Stashes: ${entries.length}`, "", ...visible, entries.length > visible.length ? `... +${entries.length - visible.length} more` : undefined].filter((line): line is string => Boolean(line)).join("\n"),
		summary: `Git stashes · ${entries.length}`,
		debug: { stashCount: entries.length },
	};
}

function compactGitLogOneline(rawOutput: string, mode: CompactionMode): { output: string; summary: string } {
	const lines = rawOutput.split("\n").map((line) => line.trim()).filter(Boolean);
	const visible = lines.slice(0, getVisibleItemLimit(mode, { auto: 10, aggressive: 6 }));
	return {
		output: [...visible, lines.length > visible.length ? `... +${lines.length - visible.length} more commits` : undefined].filter((line): line is string => Boolean(line)).join("\n"),
		summary: `Git log · ${lines.length} commit${lines.length === 1 ? "" : "s"}`,
	};
}

function compactTestOutput(rawOutput: string, exitCode: number, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const lines = rawOutput.split("\n").map((line) => line.trimEnd());
	const summaryLines = uniqueStrings(lines.filter((line) => /(?:\bpass(?:ed)?\b|\bfail(?:ed)?\b|\bskip(?:ped)?\b|\berror(?:s)?\b|test result:|Ran \d+ tests?|\d+ passing|\d+ failing|\d+ failed)/i.test(line))).slice(0, getVisibleItemLimit(mode, { auto: 6, aggressive: 4 }));
	const failureLines = uniqueStrings(lines.filter((line) => /(?:^FAIL\b|^FAILED\b|\berror\b|panic|assert(?:ion)?|Exception|✗|^not ok\b)/i.test(line))).slice(0, getVisibleItemLimit(mode, { auto: 14, aggressive: 8 }));
	const outputLines = [exitCode === 0 ? "Tests passed." : `Tests failed (exit ${exitCode}).`, summaryLines.length > 0 ? "" : undefined, ...summaryLines, failureLines.length > 0 ? "" : undefined, ...failureLines].filter((line): line is string => Boolean(line));
	return {
		output: outputLines.join("\n") || rawOutput,
		summary: exitCode === 0 ? summaryLines[0] ?? "Tests passed" : `Tests failed${summaryLines[0] ? ` · ${summaryLines[0]}` : ` with exit code ${exitCode}`}`,
		debug: { summaryLineCount: summaryLines.length, surfacedFailureLines: failureLines.length },
	};
}

function compactDiagnosticsOutput(rawOutput: string, exitCode: number, mode: CompactionMode): { output: string; summary: string; debug: Record<string, unknown> } {
	const lines = rawOutput.split("\n").map((line) => line.trimEnd());
	const diagnostics = uniqueStrings(lines.filter((line) => /(?:\berror\b|\bwarning\b|✖|×|^\s*at\s|^\s*-->\s|\.ts\(\d+,\d+\)|:[0-9]+:[0-9]+)/i.test(line))).slice(0, getVisibleItemLimit(mode, { auto: 18, aggressive: 10 }));
	const errorCount = lines.filter((line) => /\berror\b/i.test(line)).length;
	const warningCount = lines.filter((line) => /\bwarning\b/i.test(line)).length;
	const summaryBits = [errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : undefined, warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : undefined].filter((value): value is string => Boolean(value));
	return {
		output: [exitCode === 0 ? "Diagnostics completed." : `Diagnostics failed (exit ${exitCode}).`, summaryBits.length > 0 ? summaryBits.join(", ") : undefined, diagnostics.length > 0 ? "" : undefined, ...diagnostics].filter((line): line is string => Boolean(line)).join("\n") || rawOutput,
		summary: summaryBits.length > 0 ? `Diagnostics · ${summaryBits.join(", ")}` : (exitCode === 0 ? "Diagnostics completed" : `Diagnostics failed with exit code ${exitCode}`),
		debug: { errorCount, warningCount, surfacedDiagnosticLines: diagnostics.length },
	};
}