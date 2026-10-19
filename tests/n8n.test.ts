import { afterEach, describe, expect, it, vi } from "vitest";
import { describeResponse, hasN8n, maskUrl, tools, workflowUrl, WORKFLOW_NAMES } from "@/lib/sponsors/n8n";

afterEach(() => vi.unstubAllEnvs());

function env(values: Record<string, string>) {
  for (const key of ["N8N_WEBHOOK_BASE", "N8N_WEBHOOK_SECRET", "N8N_WORKFLOWS"]) vi.stubEnv(key, values[key] ?? "");
}

describe("workflowUrl", () => {
  it("builds default paths under the base, with or without /webhook", () => {
    env({ N8N_WEBHOOK_BASE: "https://x.app.n8n.cloud" });
    expect(workflowUrl("shopping")).toBe("https://x.app.n8n.cloud/webhook/openstate-shopping-list");
    env({ N8N_WEBHOOK_BASE: "https://x.app.n8n.cloud/webhook/" });
    expect(workflowUrl("alert")).toBe("https://x.app.n8n.cloud/webhook/openstate-alert");
  });

  it("lets N8N_WORKFLOWS override one name and leaves the others alone", () => {
    env({ N8N_WEBHOOK_BASE: "https://x.app.n8n.cloud", N8N_WORKFLOWS: "email=https://other/hook/mail" });
    expect(workflowUrl("email")).toBe("https://other/hook/mail");
    expect(workflowUrl("health")).toBe("https://x.app.n8n.cloud/webhook/openstate-health");
  });

  it("is null for everything when nothing is set, and the sponsor is unconfigured", () => {
    env({});
    for (const name of WORKFLOW_NAMES) expect(workflowUrl(name)).toBeNull();
    expect(hasN8n()).toBe(false);
    expect(tools()).toEqual([]);
  });
});

describe("maskUrl", () => {
  it("hides token-like query values and keeps the host", () => {
    expect(maskUrl("https://h/webhook/x?token=abc123&v=1")).toBe("https://h/webhook/x?token=…&v=1");
  });
});

describe("describeResponse", () => {
  it("turns a workflow reply into short text and treats empty replies as nothing", () => {
    expect(describeResponse({ ok: true, created: 2 })).toBe('{"ok":true,"created":2}');
    expect(describeResponse("  done  ")).toBe("done");
    expect(describeResponse({})).toBe("");
    expect(describeResponse(undefined)).toBe("");
  });
});

describe("tools", () => {
  it("offers only the workflows that have a URL, and validates inputs before calling", async () => {
    env({ N8N_WORKFLOWS: "shopping=https://h/webhook/s,reminder=https://h/webhook/r" });
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual(["add_to_shopping_list", "create_reminder"]);
    const [shopping, reminder] = tools();
    expect(await shopping.run({ items: [] })).toBe("No items given.");
    expect(await reminder.run({ title: "pills", when_iso: "tomorrow-ish" })).toBe('"tomorrow-ish" is not a time I can set.');
  });

  it("reports a failed workflow in plain words instead of throwing", async () => {
    env({ N8N_WORKFLOWS: "alert=https://127.0.0.1:9/webhook/a" });
    const [alert] = tools();
    const result = await alert.run({ message: "milk is off" });
    expect(result.startsWith("The action failed:")).toBe(true);
  });
});
