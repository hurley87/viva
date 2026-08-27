import { spawn } from "node:child_process";

export async function convexRun<T>(
  functionName: string,
  args: Record<string, string>,
): Promise<T> {
  const payload = JSON.stringify(args);
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("npx", ["convex", "run", functionName, payload], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `npx convex run ${functionName} failed (exit ${code}): ${stderr || stdout}`,
        ),
      );
    });
  });

  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(
      `Could not parse Convex result from ${functionName}: ${output}`,
    );
  }
}
