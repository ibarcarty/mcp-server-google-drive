import { rmSync } from "node:fs";
import { resolve } from "node:path";

const distPath = resolve(process.cwd(), "dist");
try {
  rmSync(distPath, { recursive: true, force: true });
  console.log(`Cleaned ${distPath}`);
} catch (err) {
  console.error(`Failed to clean ${distPath}:`, err);
  process.exit(1);
}
