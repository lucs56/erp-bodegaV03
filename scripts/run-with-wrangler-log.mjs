import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Falta indicar el comando que se debe ejecutar.");
  process.exit(1);
}

mkdirSync(".wrangler", { recursive: true });

const child = spawn(command, args, {
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`No se pudo iniciar ${command}:`, error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
