import type { Command, CommandResult } from "../types.js";
import { findProjectRoot } from "../../runtime/trust.js";

export function createReviewCommand(): Command {
  return {
    name: "review",
    aliases: ["check"],
    description: "Review recent changes",
    type: "local",
    usage: "/review",
    modes: ["interactive", "telegram"],
    trustLevels: ["trusted", "bare"],
    execute: (_args, ctx): CommandResult => {
      const projectRoot = findProjectRoot(ctx.cwd);
      if (!projectRoot) {
        return {
          success: true,
          output: "No project root found to review.",
        };
      }

      const repoCheck = Bun.spawnSync({
        cmd: ["git", "rev-parse", "--is-inside-work-tree"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (repoCheck.exitCode !== 0) {
        return {
          success: true,
          output: "Current project is not a git repository.",
        };
      }

      const status = Bun.spawnSync({
        cmd: ["git", "status", "--short"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const diffStat = Bun.spawnSync({
        cmd: ["git", "diff", "--stat"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stagedDiffStat = Bun.spawnSync({
        cmd: ["git", "diff", "--cached", "--stat"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const statusText = status.stdout.toString().trim() || "Working tree clean";
      const unstagedText = diffStat.stdout.toString().trim() || "No unstaged diff";
      const stagedText = stagedDiffStat.stdout.toString().trim() || "No staged diff";

      return {
        success: true,
        output: [
          `Repository: ${projectRoot}`,
          "Status:",
          statusText,
          "",
          "Unstaged diff summary:",
          unstagedText,
          "",
          "Staged diff summary:",
          stagedText,
        ].join("\n"),
      };
    },
  };
}