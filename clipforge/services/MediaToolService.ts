import { spawn } from "node:child_process";

export type MediaToolStatus = {
  ffmpeg: { available: boolean; version?: string };
  ffprobe: { available: boolean; version?: string };
};

export async function getMediaToolStatus(): Promise<MediaToolStatus> {
  const [ffmpeg, ffprobe] = await Promise.all([
    inspectBinary(process.env.FFMPEG_PATH?.trim() || "ffmpeg"),
    inspectBinary(process.env.FFPROBE_PATH?.trim() || "ffprobe"),
  ]);

  return { ffmpeg, ffprobe };
}

function inspectBinary(command: string): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 2048) stdout += chunk;
    });

    child.on("error", () => resolve({ available: false }));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ available: false });
        return;
      }

      const firstLine = stdout.split(/\r?\n/, 1)[0]?.trim();
      resolve({
        available: true,
        version: firstLine || undefined,
      });
    });
  });
}
