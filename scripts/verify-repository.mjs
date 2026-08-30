import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const MAX_TRACKED_FILE_BYTES = 1024 * 1024;
const BINARY_EXTENSIONS = new Set([".png"]);
const FORBIDDEN_SECRET_FILES = /(^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:key|pem|p12|pfx))$/i;
const SECRET_PATTERNS = [
  {
    label: "private key",
    pattern: new RegExp(["-----BEGIN ", "[A-Z ]*", "PRIVATE KEY-----"].join("")),
  },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "GitHub token", pattern: /(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/ },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "OpenAI API key", pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

assert(trackedFiles.length > 0, "repository has no tracked files");
assert(existsSync("LICENSE"), "repository is missing LICENSE");
assert(trackedFiles.includes("package-lock.json"), "repository is missing package-lock.json");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert(packageJson.license === "MIT", "package license must be MIT");
assert(
  packageJson.repository?.url === "https://github.com/bem130/webcam-app.git",
  "package repository URL is incorrect",
);
assert(
  packageJson.homepage === "https://bem130.github.io/webcam-app/",
  "package homepage is incorrect",
);

const decoder = new TextDecoder("utf-8", { fatal: true });
for (const file of trackedFiles) {
  assert(!FORBIDDEN_SECRET_FILES.test(file), `tracked secret-bearing filename: ${file}`);
  const size = statSync(file).size;
  assert(size <= MAX_TRACKED_FILE_BYTES, `tracked file exceeds 1 MiB (${size} bytes): ${file}`);
  if (BINARY_EXTENSIONS.has(extname(file).toLowerCase())) continue;

  const bytes = readFileSync(file);
  assert(!bytes.includes(0), `text file contains NUL bytes: ${file}`);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error(`text file is not valid UTF-8: ${file}`);
  }
  for (const secret of SECRET_PATTERNS) {
    assert(!secret.pattern.test(text), `possible ${secret.label} in ${file}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
