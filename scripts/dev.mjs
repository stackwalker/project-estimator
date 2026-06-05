import { spawn } from "node:child_process";

const commands = [
  ["server", "node", ["server/index.js"]],
  ["client", "npx", ["vite", "--host", "0.0.0.0"]]
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${name} exited with code ${code}`);
    }
    children.forEach((other) => {
      if (other !== child && !other.killed) other.kill("SIGTERM");
    });
  });

  return child;
});

process.on("SIGINT", () => {
  children.forEach((child) => child.kill("SIGINT"));
});
