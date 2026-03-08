# arc-browser-mcp

MCP server that controls Arc via AppleScript, with optional CDP (remote-debugging-port) support for reading console/network events.

## Requirements

- macOS (Arc AppleScript)
- Arc
- Bun

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

## Getting started

Add the following config to your MCP client:

```json
{
  "mcpServers": {
    "arc-devtools": {
      "command": "bunx",
      "args": ["--bun", "@alango/arc-devtools-mcp@latest"]
    }
  }
}
```

> **Note:** Using `@alango/arc-devtools-mcp@latest` ensures that your MCP client will always use the latest version.

### MCP Client configuration

<details>
  <summary>Claude Code</summary>

Use the Claude Code CLI to add the Arc DevTools MCP server:

```bash
claude mcp add arc-devtools --scope user -- bunx --bun @alango/arc-devtools-mcp@latest
```

</details>

<details>
  <summary>Claude Desktop</summary>

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arc-devtools": {
      "command": "bunx",
      "args": ["--bun", "@alango/arc-devtools-mcp@latest"]
    }
  }
}
```

</details>

<details>
  <summary>Cursor</summary>

Go to `Cursor Settings` -> `MCP` -> `New MCP Server`. Use the config provided above.

</details>

<details>
  <summary>Copilot / VS Code</summary>

Follow the MCP install <a href="https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server">guide</a> and use the config provided above.

</details>

<details>
  <summary>Cline</summary>

Follow <a href="https://docs.cline.bot/mcp/configuring-mcp-servers">the guide</a> and use the config provided above.

</details>

<details>
  <summary>Windsurf</summary>

Follow the <a href="https://docs.windsurf.com/windsurf/cascade/mcp#mcp-config-json">configure MCP guide</a> and use the config provided above.

</details>

<details>
  <summary>OpenCode</summary>

Add the following to your `opencode.json` (<a href="https://opencode.ai/docs/mcp-servers">guide</a>):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "arc-devtools": {
      "type": "local",
      "command": ["bunx", "--bun", "@alango/arc-devtools-mcp@latest"]
    }
  }
}
```

</details>

## Tools

AppleScript:

- `arc_list_spaces`
- `arc_focus_space`
- `arc_list_tabs`
- `arc_get_active_tab`
- `arc_open_url`
- `arc_focus_tab`
- `arc_close_tab`
- `arc_reload_tab`
- `arc_execute_js`

CDP (remote debugging):

- `arc_cdp_status`
- `arc_cdp_connect`
- `arc_cdp_disconnect`
- `arc_cdp_get_console`
- `arc_cdp_get_network`

## Examples

List tabs:

```json
{"tool":"arc_list_tabs","input":{}}
```

Open a URL:

```json
{"tool":"arc_open_url","input":{"url":"https://example.com"}}
```

Execute JS in active tab:

```json
{"tool":"arc_execute_js","input":{"javascript":"console.log('hello from mcp')"}}
```

Connect to CDP and read console/network:

```json
{"tool":"arc_cdp_connect","input":{"port":9222}}
```

```json
{"tool":"arc_cdp_get_console","input":{"limit":50}}
```

```json
{"tool":"arc_cdp_get_network","input":{"limit":200}}
```

## CDP (Console / Network)

CDP tools (`arc_cdp_*`) require Arc to be running with a remote debugging port enabled. There are two ways to set this up:

### Option 1: Via `arc://inspect` (Recommended)

1. Open Arc and navigate to `arc://inspect/#remote-debugging`
2. Follow the dialog to enable remote debugging

Once enabled, the MCP server can connect to Arc automatically.

### Option 2: Launch Arc with flags

If Option 1 is not available, you can launch Arc manually with the remote debugging flags:

**Step 1:** Quit Arc

```bash
osascript -e 'tell application "Arc" to quit'
```

**Step 2:** Relaunch Arc with flags

```bash
open -na "Arc" --args \
  --remote-debugging-port=9222 \
  --remote-allow-origins=http://127.0.0.1
```

If you want to allow any origin (less strict):

```bash
open -na "Arc" --args \
  --remote-debugging-port=9222 \
  --remote-allow-origins=*
```

> **Warning:** Enabling the remote debugging port opens a debugging port on the running browser instance. Any application on your machine can connect to this port and control the browser. Avoid browsing sensitive websites while the debugging port is open.

### Environment variables

- `ARC_MCP_CDP_ORIGIN` (default: `http://127.0.0.1`)
  - Must match what you pass to `--remote-allow-origins=...` (unless you use `*`).
- `ARC_MCP_ARC_USER_DATA_DIR`
  - Overrides the Arc user data dir used to read `DevToolsActivePort`.

## Troubleshooting

- `403 Forbidden` / "Rejected an incoming WebSocket connection"
  - Arc was launched without the matching `--remote-allow-origins=...`.
  - Fix: restart Arc with `--remote-allow-origins=http://127.0.0.1` (or `*`).
- `http://127.0.0.1:9222/json/version` returns 404
  - This can happen in Arc. This server falls back to `DevToolsActivePort` for browser WebSocket discovery.
- Port is listening but connect fails intermittently
  - Arc can restart/rotate the `DevToolsActivePort` UUID. Re-run `arc_cdp_connect`.
