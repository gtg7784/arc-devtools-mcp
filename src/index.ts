import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  closeTab,
  executeJsInTab,
  focusSpace,
  focusTab,
  getActiveTabInFrontWindow,
  listSpaces,
  listTabsInFrontWindow,
  openUrl,
  reloadTab,
} from "./arc/applescript.js";

import { ArcCdpBridge, cdpGetVersion } from "./arc/cdp.js";

const server = new McpServer({
  name: "arc",
  version: "0.1.0",
});

const cdp = new ArcCdpBridge();

server.registerTool(
  "arc_list_spaces",
  {
    title: "List Arc Spaces",
    description: "List spaces in the front Arc window (AppleScript).",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const spaces = await listSpaces();
      return {
        content: [{ type: "text", text: JSON.stringify(spaces, null, 2) }],
        structuredContent: { spaces },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to list spaces: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_focus_space",
  {
    title: "Focus Arc Space",
    description: "Focus a space by its id (AppleScript).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      spaceId: z.string().min(1),
    }),
  },
  async ({ spaceId }) => {
    try {
      await focusSpace(spaceId);
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to focus space: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_list_tabs",
  {
    title: "List Arc Tabs",
    description: "List tabs in the front Arc window (AppleScript).",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const tabs = await listTabsInFrontWindow();
      return {
        content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }],
        structuredContent: { tabs },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to list tabs: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_get_active_tab",
  {
    title: "Get Active Arc Tab",
    description: "Get the active tab in the front Arc window (AppleScript).",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const tab = await getActiveTabInFrontWindow();
      return {
        content: [{ type: "text", text: JSON.stringify(tab, null, 2) }],
        structuredContent: { tab },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to get active tab: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_open_url",
  {
    title: "Open URL in Arc",
    description: "Open a URL in Arc. Optionally target a space by id (AppleScript).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
      url: z
        .string()
        .min(1)
        .regex(/^https?:\/\//, "URL must start with http:// or https://"),
      spaceId: z.string().min(1).optional(),
    }),
  },
  async ({ url, spaceId }) => {
    try {
      await openUrl(url, spaceId);
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to open URL: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_focus_tab",
  {
    title: "Focus Arc Tab",
    description: "Select a tab by its id (AppleScript).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      tabId: z.string().min(1),
    }),
  },
  async ({ tabId }) => {
    try {
      await focusTab(tabId);
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to focus tab: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_close_tab",
  {
    title: "Close Arc Tab",
    description: "Close a tab by its id (AppleScript).",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: z.object({
      tabId: z.string().min(1),
    }),
  },
  async ({ tabId }) => {
    try {
      await closeTab(tabId);
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to close tab: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_reload_tab",
  {
    title: "Reload Arc Tab",
    description: "Reload a tab by its id (AppleScript).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
      tabId: z.string().min(1),
    }),
  },
  async ({ tabId }) => {
    try {
      await reloadTab(tabId);
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to reload tab: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_execute_js",
  {
    title: "Execute JavaScript in Arc Tab",
    description: "Execute JavaScript in a tab (or active tab if omitted) via AppleScript.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
      javascript: z.string().min(1),
      tabId: z.string().min(1).optional(),
    }),
  },
  async ({ tabId, javascript }) => {
    try {
      const result = await executeJsInTab(tabId, javascript);
      return {
        content: [{ type: "text", text: result }],
        structuredContent: { result },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to execute JavaScript: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_cdp_status",
  {
    title: "Arc CDP Status",
    description: "Check whether a local CDP endpoint is available and whether this server is connected.",
    inputSchema: z.object({
      port: z.number().int().min(1).max(65535).optional(),
    }),
  },
  async ({ port }) => {
    const st = cdp.status();
    const effectivePort = port ?? st.port ?? 9222;
    try {
      const version = await cdpGetVersion(effectivePort);
      return {
        content: [{ type: "text", text: JSON.stringify({ connected: st.connected, port: st.port, target: st.target, available: true, version }, null, 2) }],
        structuredContent: { connected: st.connected, port: st.port, target: st.target, available: true, version },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: JSON.stringify({ connected: st.connected, port: st.port, target: st.target, available: false, error: message }, null, 2) }],
        structuredContent: { connected: st.connected, port: st.port, target: st.target, available: false, error: message },
      };
    }
  }
);

server.registerTool(
  "arc_cdp_connect",
  {
    title: "Connect to Arc CDP",
    description: "Connect to a local CDP endpoint (remote-debugging-port) and start capturing console/network events.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
      port: z.number().int().min(1).max(65535).default(9222),
      targetId: z.string().min(1).optional(),
      targetUrl: z.string().min(1).optional(),
    }),
  },
  async ({ port, targetId, targetUrl }) => {
    try {
      let effectiveTargetUrl = targetUrl;
      if (!targetId && !effectiveTargetUrl) {
        try {
          const active = await getActiveTabInFrontWindow();
          if (typeof active.url === "string" && active.url.length > 0) {
            effectiveTargetUrl = active.url;
          }
        } catch (err) {
          void err;
        }
      }

      const { target, version } = await cdp.connect({ port, targetId, targetUrl: effectiveTargetUrl });
      const result = { ok: true, port, target, version };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to connect to CDP: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_cdp_disconnect",
  {
    title: "Disconnect from Arc CDP",
    description: "Disconnect the CDP bridge.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({}),
  },
  async () => {
    try {
      await cdp.disconnect();
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to disconnect CDP: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_cdp_get_console",
  {
    title: "Get Console Messages (CDP)",
    description: "Return captured console entries from the connected CDP target.",
    inputSchema: z.object({
      sinceTs: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
  },
  async ({ sinceTs, limit }) => {
    try {
      const entries = cdp.getConsole({ sinceTs, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        structuredContent: { entries },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to get console entries: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "arc_cdp_get_network",
  {
    title: "Get Network Entries (CDP)",
    description: "Return captured network entries from the connected CDP target.",
    inputSchema: z.object({
      sinceTs: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  },
  async ({ sinceTs, limit }) => {
    try {
      const entries = cdp.getNetwork({ sinceTs, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        structuredContent: { entries },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Failed to get network entries: ${message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
