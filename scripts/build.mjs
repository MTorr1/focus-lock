import { cpSync, rmSync } from "node:fs";
import * as esbuild from "esbuild";

rmSync("dist", { recursive: true, force: true });

await esbuild.build({
  entryPoints: {
    background: "src/background.ts",
    "history-hook": "src/history-hook.ts",
    guard: "src/guard.ts",
    options: "src/options.ts",
    blocked: "src/blocked.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
});

cpSync("public", "dist", { recursive: true });
