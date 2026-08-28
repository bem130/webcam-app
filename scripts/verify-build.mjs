import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const html = readFileSync("dist/index.html", "utf8");
const cspPosition = html.indexOf("Content-Security-Policy");
const referrerPosition = html.indexOf('name="referrer" content="no-referrer"');
const firstResourcePosition = Math.min(
  ...[html.indexOf("<script"), html.indexOf('<link rel="stylesheet"')].filter(
    (position) => position >= 0,
  ),
);

assert(cspPosition >= 0, "production HTML is missing meta CSP");
assert(html.includes("connect-src 'none'"), "production CSP must prohibit connections");
assert(referrerPosition > cspPosition, "referrer policy must follow CSP");
assert(firstResourcePosition > referrerPosition, "policies must precede every resource");
assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "production HTML contains an inline script");
assert(!/<style\b/i.test(html), "production HTML contains an inline style block");
assert(
  html.includes('rel="manifest" href="/webcam-app/manifest.webmanifest"'),
  "production HTML is missing the Web App Manifest",
);

[
  "dist/manifest.webmanifest",
  "dist/icons/app-icon.svg",
  "dist/icons/apple-touch-icon.png",
  "dist/icons/icon-192.png",
  "dist/icons/icon-512.png",
  "dist/icons/icon-512-maskable.png",
].forEach((path) => assert(existsSync(path), `production artifact is missing ${path}`));

const resourceUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
assert(resourceUrls.length > 0, "production HTML has no generated resources");
resourceUrls.forEach((url) =>
  assert(url?.startsWith("/webcam-app/") ?? false, `resource is outside Vite base: ${url}`),
);

const javascriptFiles = readdirSync("dist/assets").filter((name) => name.endsWith(".js"));
const initialJavascriptUrls = resourceUrls.filter((url) => url?.endsWith(".js") ?? false);
assert(initialJavascriptUrls.length === 1, "expected one initial JavaScript bundle");
const initialJavascript = initialJavascriptUrls[0]?.split("/").at(-1);
assert(initialJavascript !== undefined, "initial JavaScript filename is missing");
const workerFiles = javascriptFiles.filter((name) => name !== initialJavascript);
assert(
  workerFiles.length === 1 && workerFiles[0]?.startsWith("image-processing.worker-"),
  "expected one generated image-processing worker bundle",
);
const initialSource = readFileSync(`dist/assets/${initialJavascript}`);
const gzipBytes = gzipSync(initialSource).byteLength;
assert(gzipBytes <= 80 * 1024, `initial JavaScript exceeds 80 KiB gzip: ${gzipBytes} bytes`);
assert(
  initialSource.includes(Buffer.from(workerFiles[0])),
  "initial JavaScript does not reference the generated worker",
);
const workerGzipBytes = gzipSync(readFileSync(`dist/assets/${workerFiles[0]}`)).byteLength;
assert(
  workerGzipBytes <= 20 * 1024,
  `worker JavaScript exceeds 20 KiB gzip: ${workerGzipBytes} bytes`,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
