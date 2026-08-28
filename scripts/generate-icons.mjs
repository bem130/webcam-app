import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const outputDirectory = "public/icons";
const source = await readFile(`${outputDirectory}/app-icon.svg`, "utf8");
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
const icons = [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-512-maskable.png", 512],
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`<img alt="" src="${dataUrl}">`);
  const image = page.locator("img");

  for (const [name, size] of icons) {
    await image.evaluate((element, pixels) => {
      element.style.display = "block";
      element.style.width = `${pixels}px`;
      element.style.height = `${pixels}px`;
    }, size);
    await image.screenshot({ path: `${outputDirectory}/${name}` });
  }
} finally {
  await browser.close();
}
