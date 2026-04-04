function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function runGit(args: string[], cwd?: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = decode(result.stderr);
    throw new Error(stderr || `git ${args.join(" ")} failed with exit code ${result.exitCode}`);
  }

  return decode(result.stdout);
}

function main(): void {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"]);
  runGit(["config", "--local", "core.hooksPath", ".githooks"], repoRoot);
  console.log(`Configured local git hooks for ${repoRoot}`);
  console.log("Git will now run .githooks/pre-commit and .githooks/pre-push in this repository.");
}

main();