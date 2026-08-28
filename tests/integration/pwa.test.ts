import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ManifestIcon = Readonly<{
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}>;

type WebAppManifest = Readonly<{
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  prefer_related_applications: boolean;
  icons: readonly ManifestIcon[];
}>;

describe("PWA installation contract", () => {
  const manifest = JSON.parse(
    readFileSync("public/manifest.webmanifest", "utf8"),
  ) as WebAppManifest;

  it("declares Chromium installability metadata for the GitHub Pages scope", () => {
    expect(manifest).toMatchObject({
      id: "/webcam-app/",
      name: "Camera Clipboard",
      short_name: "Camera Clip",
      start_url: "/webcam-app/",
      scope: "/webcam-app/",
      display: "standalone",
      prefer_related_applications: false,
    });
  });

  it("provides PNG icons at the required sizes and a maskable icon", () => {
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
      ]),
    );

    for (const icon of manifest.icons) {
      const expectedSize = Number(icon.sizes.split("x", 1)[0]);
      const path = `public${icon.src.replace("/webcam-app", "")}`;
      expect(readPngDimensions(path)).toEqual({ width: expectedSize, height: expectedSize });
    }
  });

  it("links the manifest and Apple touch icon after the document policies", () => {
    const html = readFileSync("index.html", "utf8");
    const referrer = html.indexOf('name="referrer" content="no-referrer"');
    const manifest = html.indexOf('rel="manifest"');
    const touchIcon = html.indexOf('rel="apple-touch-icon"');

    expect(manifest).toBeGreaterThan(referrer);
    expect(touchIcon).toBeGreaterThan(referrer);
    expect(html).toContain('href="/webcam-app/manifest.webmanifest"');
    expect(html).toContain('href="/webcam-app/icons/apple-touch-icon.png"');
  });
});

function readPngDimensions(path: string): Readonly<{ width: number; height: number }> {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
