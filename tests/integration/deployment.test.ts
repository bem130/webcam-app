import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment contract", () => {
  const workflow = readFileSync(".github/workflows/pages.yml", "utf8");

  it("verifies pull requests but deploys only verified main-branch runs", () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("needs: verify");

    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");

    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
  });

  it("isolates concurrency by ref and cancels only obsolete pull-request runs", () => {
    expect(workflow).toContain("group: ${{ github.workflow }}-${{ github.ref }}");
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it("uses only GitHub official actions pinned to immutable full SHAs", () => {
    const actions = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);

    expect(actions.length).toBeGreaterThan(0);

    actions.forEach((action) => expect(action).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/));
  });

  it("keeps the GitHub project-site base path", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toContain('base: "/webcam-app/"');
  });

  it("makes verify the complete source and browser gate", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.verify).toBe("npm run verify:source && npm run verify:e2e");
    expect(packageJson.scripts["verify:source"]).toContain("npm run verify:repository");
    expect(workflow).toContain("run: npm run verify:source");
    expect(workflow).toContain("run: npm run verify:e2e");
  });
});
