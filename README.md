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

## bunx

After publishing to npm, you can run it without cloning:

```bash
bunx --package @alango/arc-devtools-mcp arc-devtools-mcp
```

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

## OpenCode configuration

Add an MCP entry pointing at this repo:

```json
{
  "mcp": {
    "arc": {
      "command": "bash",
      "args": [
        "-lc",
        "cd /Users/alan/Developments/arc-browser-mcp && bun run dev"
      ]
    }
  }
}
```

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

Arc's remote debugging WebSocket can reject non-DevTools clients unless you allow the Origin.

To enable CDP for this server:

1) Quit Arc

```bash
osascript -e 'tell application "Arc" to quit'
```

2) Relaunch Arc with flags

```bash
open -na "Arc" --args \
  --remote-debugging-port=9222 \
  --remote-allow-origins=http://127.0.0.1
```

If you want to allow any Origin (less strict):

```bash
open -na "Arc" --args \
  --remote-debugging-port=9222 \
  --remote-allow-origins=*
```

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
