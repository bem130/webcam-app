import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { GENERATED_Z_INDEX_LAYERS } from "../../src/ui/app-overlay-plane";

type Layer = "core" | "platform" | "application" | "ui" | "outside";

const forbiddenTargets: Readonly<Record<Layer, readonly Layer[]>> = {
  core: ["platform", "application", "ui"],
  platform: ["application", "ui"],
  application: ["ui"],
  ui: [],
  outside: [],
};

describe("architecture dependency contract", () => {
  it("rejects imports that point from an inner layer to an outer layer", () => {
    expect(dependencyViolation("src/core/example.ts", "../platform/camera")).toBe(
      "core -> platform",
    );
    expect(dependencyViolation("src/platform/example.ts", "../ui/app")).toBe("platform -> ui");
    expect(dependencyViolation("src/application/example.ts", "../core/model")).toBeNull();
  });

  it("keeps the checked source graph within the permitted dependency direction", () => {
    const violations = sourceFiles("src").flatMap((file) =>
      relativeImports(file).flatMap((specifier) => {
        const violation = dependencyViolation(file, specifier);
        return violation === null ? [] : [`${normalized(file)} imports ${specifier}: ${violation}`];
      }),
    );

    expect(violations).toEqual([]);
  });

  it("keeps nullable browser representations outside the core", () => {
    expect(sourceText("src/core", [".ts", ".tsx"])).not.toMatch(/\bnull\b/);
  });

  it("rejects ad hoc numeric z-index values and keeps modals in the top layer", () => {
    const css = sourceText("src/styles", [".css"]);
    const zIndexes = [...css.matchAll(/z-index:\s*([^;]+);/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    const dialogs = [
      readFileSync("src/ui/history-panel.tsx", "utf8"),
      readFileSync("src/ui/confirm-dialog.tsx", "utf8"),
    ];

    zIndexes.forEach((value) => expect(value).toMatch(/^var\(--z-generated-[a-z-]+\)$/));
    const referencedLayers = [
      ...new Set(zIndexes.map((value) => value.replace(/^var\(--z-generated-([a-z-]+)\)$/, "$1"))),
    ].sort();
    expect(referencedLayers).toEqual([...GENERATED_Z_INDEX_LAYERS].sort());
    dialogs.forEach((source) => expect(source).toContain(".showModal()"));
    expect(css).not.toMatch(/\.(?:history|confirm)-dialog\s*\{[^}]*z-index:/s);
  });

  it("keeps camera-local overlays in their semantic render order", () => {
    const cameraView = readFileSync("src/ui/camera-view.tsx", "utf8");
    const backToFront = [
      "class={`switch-placeholder",
      'class="camera-topbar"',
      'class="camera-controls"',
      'class="switch-progress"',
      "class={`capture-flash",
    ].map((token) => cameraView.indexOf(token));

    expect(backToFront.every((index) => index >= 0)).toBe(true);
    expect(backToFront).toEqual([...backToFront].sort((left, right) => left - right));

    const topbarBackToFront = [
      'class="capture-preference material"',
      'class="camera-menu-wrap"',
    ].map((token) => cameraView.indexOf(token));
    expect(topbarBackToFront.every((index) => index >= 0)).toBe(true);
    expect(topbarBackToFront).toEqual([...topbarBackToFront].sort((left, right) => left - right));
  });
});

function dependencyViolation(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const source = sourceLayer(importer);
  const target = sourceLayer(resolve(dirname(importer), specifier));
  return forbiddenTargets[source].includes(target) ? `${source} -> ${target}` : null;
}

function sourceLayer(path: string): Layer {
  const parts = normalized(resolve(path)).split("/");
  const srcIndex = parts.lastIndexOf("src");
  const candidate = parts[srcIndex + 1];
  return candidate === "core" ||
    candidate === "platform" ||
    candidate === "application" ||
    candidate === "ui"
    ? candidate
    : "outside";
}

function relativeImports(file: string): readonly string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    const importArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      importArgument !== undefined &&
      ts.isStringLiteral(importArgument)
    ) {
      imports.push(importArgument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return extname(path) === ".ts" || extname(path) === ".tsx" ? [path] : [];
  });
}

function sourceText(directory: string, extensions: readonly string[]): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory()
        ? sourceText(path, extensions)
        : extensions.includes(extname(path))
          ? readFileSync(path, "utf8")
          : "";
    })
    .join("\n");
}

function normalized(path: string): string {
  return path.split(sep).join("/");
}
