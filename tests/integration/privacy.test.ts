import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_CONSTRAINTS } from "../../src/platform/camera";

describe("privacy contract", () => {
  it("always requests video without audio", () => {
    expect(INITIAL_CONSTRAINTS.audio).toBe(false);
  });

  it("does not contain persistent storage, upload, download, or telemetry APIs", () => {
    const source = sourceText("src");
    const forbidden = [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "caches.open",
      "serviceWorker",
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "WebSocket",
      ".download",
    ];
    forbidden.forEach((token) => expect(source, `unexpected ${token}`).not.toContain(token));
  });

  it("places CSP and referrer policy before every resource", () => {
    const html = readFileSync("index.html", "utf8");
    const csp = html.indexOf("Content-Security-Policy");
    const referrer = html.indexOf('name="referrer" content="no-referrer"');
    const resource = html.indexOf('<script type="module"');
    expect(csp).toBeGreaterThan(0);
    expect(html).toContain("worker-src 'self'");
    expect(referrer).toBeGreaterThan(csp);
    expect(resource).toBeGreaterThan(referrer);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style\b/i);
  });
});

function sourceText(directory: string): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? sourceText(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}
