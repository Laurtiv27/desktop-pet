export type WindowInfo = { title: string; processName: string };

export type ScreenContextBlacklist = {
  titles: string[];
  processes: string[];
};

function matchesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  for (const needle of needles) {
    if (needle && lower.includes(needle.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function isBlacklisted(windows: WindowInfo[], blacklist: ScreenContextBlacklist): boolean {
  for (const win of windows) {
    if (matchesAny(win.title, blacklist.titles)) {
      return true;
    }
    if (matchesAny(win.processName, blacklist.processes)) {
      return true;
    }
  }
  return false;
}
