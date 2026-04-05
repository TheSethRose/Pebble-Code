import { spawn } from "node:child_process";

function resolveOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  return { command: "xdg-open", args: [url] };
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return false;
  }

  const { command, args } = resolveOpenCommand(trimmedUrl);

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });

      child.once("spawn", () => {
        if (settled) {
          return;
        }

        settled = true;
        child.unref();
        resolve(true);
      });

      child.once("error", () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}