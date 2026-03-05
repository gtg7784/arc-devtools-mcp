import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ArcSpace = {
  id: string;
  title: string;
};

export type ArcTabLocation = "topApp" | "pinned" | "unpinned" | string;

export type ArcTab = {
  id: string;
  title: string;
  url: string;
  location: ArcTabLocation;
  loading: boolean;
  active: boolean;
};

function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\"/g, "\\\"")
    .replace(/\n/g, "\\n");
}

async function runAppleScript(script: string, timeoutMs = 15_000): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

const JSON_ESCAPE_FN = String.raw`
on __escape_json(this_text)
  set AppleScript's text item delimiters to "\\"
  set the item_list to every text item of this_text
  set AppleScript's text item delimiters to "\\\\"
  set this_text to the item_list as string

  set AppleScript's text item delimiters to "\""
  set the item_list to every text item of this_text
  set AppleScript's text item delimiters to "\\\""
  set this_text to the item_list as string

  set AppleScript's text item delimiters to linefeed
  set the item_list to every text item of this_text
  set AppleScript's text item delimiters to "\\n"
  set this_text to the item_list as string

  set AppleScript's text item delimiters to ""
  return this_text
end __escape_json
`;

export async function listSpaces(): Promise<ArcSpace[]> {
  const script = `${JSON_ESCAPE_FN}
tell application "Arc"
  tell front window
    set out to ""
    set n to count of spaces
    repeat with i from 1 to n
      set sp to item i of spaces
      set sid to get id of sp
      set stitle to my __escape_json(get title of sp)
      set out to (out & "{ \\\"id\\\": \\\"" & sid & "\\\", \\\"title\\\": \\\"" & stitle & "\\\" }")
      if i < n then
        set out to (out & ",")
      end if
    end repeat
    return "[" & out & "]"
  end tell
end tell
`;

  const raw = await runAppleScript(script);
  return JSON.parse(raw) as ArcSpace[];
}

export async function focusSpace(spaceId: string): Promise<void> {
  const sid = escapeAppleScriptString(spaceId);
  const script = `tell application "Arc"
  tell front window
    tell space id "${sid}" to focus
  end tell
  activate
end tell`;
  await runAppleScript(script);
}

export async function listTabsInFrontWindow(): Promise<ArcTab[]> {
  const script = `${JSON_ESCAPE_FN}
tell application "Arc"
  tell front window
    set activeId to get id of active tab
    set out to ""
    set firstItem to true
    repeat with t in tabs
      try
        set tid to get id of t
        set ttitle to my __escape_json(get title of t)
        set turl to my __escape_json(get URL of t)
        set tloc to get location of t
        set tloading to get loading of t
        set isActive to (tid is equal to activeId)
        set itemJson to ("{ \\\"id\\\": \\\"" & tid & "\\\", \\\"title\\\": \\\"" & ttitle & "\\\", \\\"url\\\": \\\"" & turl & "\\\", \\\"location\\\": \\\"" & tloc & "\\\", \\\"loading\\\": " & tloading & ", \\\"active\\\": " & isActive & " }")
        if firstItem then
          set out to (out & itemJson)
          set firstItem to false
        else
          set out to (out & "," & itemJson)
        end if
      end try
    end repeat
    return "[" & out & "]"
  end tell
end tell
`;

  const raw = await runAppleScript(script);
  return JSON.parse(raw) as ArcTab[];
}

export async function getActiveTabInFrontWindow(): Promise<ArcTab> {
  const script = `${JSON_ESCAPE_FN}
tell application "Arc"
  tell front window
    set tid to get id of active tab
    set ttitle to my __escape_json(get title of active tab)
    set turl to my __escape_json(get URL of active tab)
    set tloc to get location of active tab
    set tloading to get loading of active tab
    return "{ \\\"id\\\": \\\"" & tid & "\\\", \\\"title\\\": \\\"" & ttitle & "\\\", \\\"url\\\": \\\"" & turl & "\\\", \\\"location\\\": \\\"" & tloc & "\\\", \\\"loading\\\": " & tloading & ", \\\"active\\\": true }"
  end tell
end tell
`;

  const raw = await runAppleScript(script);
  return JSON.parse(raw) as ArcTab;
}

export async function openUrl(url: string, spaceId?: string): Promise<void> {
  const u = escapeAppleScriptString(url);
  const sid = spaceId ? escapeAppleScriptString(spaceId) : undefined;
  const script = sid
    ? `tell application "Arc"
  tell front window
    tell space id "${sid}"
      make new tab with properties {URL:"${u}"}
    end tell
  end tell
  activate
end tell`
    : `tell application "Arc"
  tell front window
    make new tab with properties {URL:"${u}"}
  end tell
  activate
end tell`;

  await runAppleScript(script);
}

export async function focusTab(tabId: string): Promise<void> {
  const tid = escapeAppleScriptString(tabId);
  const script = `tell application "Arc"
  tell front window
    tell tab id "${tid}" to select
  end tell
  activate
end tell`;
  await runAppleScript(script);
}

export async function closeTab(tabId: string): Promise<void> {
  const tid = escapeAppleScriptString(tabId);
  const script = `tell application "Arc"
  tell front window
    tell tab id "${tid}" to close
  end tell
end tell`;
  await runAppleScript(script);
}

export async function reloadTab(tabId: string): Promise<void> {
  const tid = escapeAppleScriptString(tabId);
  const script = `tell application "Arc"
  tell front window
    tell tab id "${tid}" to reload
  end tell
end tell`;
  await runAppleScript(script);
}

export async function executeJsInTab(tabId: string | undefined, javascript: string): Promise<string> {
  const js = escapeAppleScriptString(javascript);
  if (!tabId) {
    const script = `tell application "Arc" to execute (active tab of front window) javascript "${js}"`;
    return runAppleScript(script);
  }

  const tid = escapeAppleScriptString(tabId);
  const script = `tell application "Arc" to execute (tab id "${tid}" of front window) javascript "${js}"`;
  return runAppleScript(script);
}
