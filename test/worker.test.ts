import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const env: Env = { DOMAIN: "example.com" };

describe("Kuest custom domain proxy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("proxies a configured hostname and preserves path and query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const response = await worker.fetch(
      new Request("https://clob.example.com/markets?active=true"),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledOnce();

    const upstreamRequest = fetchSpy.mock.calls[0]?.[0];
    expect(upstreamRequest).toBeInstanceOf(Request);
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Expected the proxy to issue a Request");
    }
    expect(upstreamRequest.url).toBe("https://clob.kuest.com/markets?active=true");
  });

  it("rejects hostnames outside the configured domain", async () => {
    const response = await worker.fetch(new Request("https://clob.other.example/markets"), env);

    expect(response.status).toBe(404);
  });

  it("proxies asset reads and preserves the upstream cache policy for missing objects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"name":"asset"}', {
        headers: { "Content-Type": "application/json", ETag: '"asset-tag"' },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      }));
    const assetId = "a".repeat(43);
    const operatorUrl = `https://assets.example.com/${assetId}`;
    const asset = await worker.fetch(new Request(operatorUrl), env);
    const missing = await worker.fetch(new Request(operatorUrl, { method: "HEAD" }), env);

    expect(asset.status).toBe(200);
    expect(asset.headers.get("ETag")).toBe('"asset-tag"');
    expect(await asset.json()).toEqual({ name: "asset" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchSpy.mock.calls.map(([request]) => [
      (request as Request).method,
      (request as Request).url,
    ])).toEqual([
      ["GET", `https://assets.kuest.com/${assetId}`],
      ["HEAD", `https://assets.kuest.com/${assetId}`],
    ]);
  });

  it("rewrites upstream redirects to the custom hostname", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://clob.kuest.com/new" },
      }),
    );

    const response = await worker.fetch(new Request("https://clob.example.com/old"), env);

    expect(response.headers.get("Location")).toBe("https://clob.example.com/new");
  });
});
