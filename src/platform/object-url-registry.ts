import type { CaptureId } from "../core/model";

export type ObjectUrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

export class ObjectUrlRegistry {
  readonly #urls = new Map<CaptureId, string>();
  readonly #api: ObjectUrlApi;

  constructor(api: ObjectUrlApi = URL) {
    this.#api = api;
  }

  get(id: CaptureId, blob: Blob): string {
    const existing = this.#urls.get(id);
    if (existing !== undefined) return existing;
    const url = this.#api.createObjectURL(blob);
    this.#urls.set(id, url);
    return url;
  }

  revoke(id: CaptureId): void {
    const url = this.#urls.get(id);
    if (url === undefined) return;
    this.#api.revokeObjectURL(url);
    this.#urls.delete(id);
  }

  revokeAll(): void {
    this.#urls.forEach((url) => this.#api.revokeObjectURL(url));
    this.#urls.clear();
  }
}
