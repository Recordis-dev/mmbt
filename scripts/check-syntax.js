import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const nodeCheckDirectories = ["src/core", "tests", "scripts"];
const n8nSnippetDirectory = "n8n/code-nodes";

const nodeCheckFiles = nodeCheckDirectories.flatMap((directory) =>
  readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .map((file) => join(directory, file))
);

for (const file of nodeCheckFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const n8nSnippetFiles = readdirSync(n8nSnippetDirectory)
  .filter((file) => file.endsWith(".js"))
  .map((file) => join(n8nSnippetDirectory, file));

for (const file of n8nSnippetFiles) {
  const source = readFileSync(file, "utf8");
  try {
    new AsyncFunction("$json", "redis", "db", "env", "fetch", source);
  } catch (error) {
    console.error(`Syntax error in ${file}`);
    throw error;
  }
}

console.log(`Checked ${nodeCheckFiles.length + n8nSnippetFiles.length} JavaScript files.`);
