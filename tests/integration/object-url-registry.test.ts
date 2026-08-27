import { describe, expect, it, vi } from "vitest";
import { captureId } from "../../src/core/model";
import { ObjectUrlRegistry } from "../../src/platform/object-url-registry";

describe("ObjectUrlRegistry", () => {
  it("creates once and revokes individual and remaining URLs", () => {
    const api = {
      createObjectURL: vi.fn((_blob: Blob) => `blob:${Math.random()}`),
      revokeObjectURL: vi.fn(),
    };
    const registry = new ObjectUrlRegistry(api);
    const firstId = captureId("first");
    const secondId = captureId("second");
    const blob = new Blob();
    const firstUrl = registry.get(firstId, blob);
    expect(registry.get(firstId, blob)).toBe(firstUrl);
    registry.get(secondId, blob);
    expect(api.createObjectURL).toHaveBeenCalledTimes(2);
    registry.revoke(firstId);
    registry.revokeAll();
    expect(api.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
