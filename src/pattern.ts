export type HostPattern = { kind: "host"; host: string };

export type SubdomainPattern = { kind: "subdomains"; host: string };

export type SectionPattern = {
  kind: "section";
  host: string;
  pathPrefix: string;
  includeSubdomains: boolean;
  includeApex: boolean;
};

export type PagePattern = {
  kind: "page";
  host: string;
  path: string;
  includeSubdomains: boolean;
  includeApex: boolean;
};

export type Pattern = HostPattern | SubdomainPattern | SectionPattern | PagePattern;

const HOST_TEXT = /^[a-z0-9.-]+$/;

export function parsePattern(raw: string): Pattern | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000 || /\s/.test(trimmed)) return null;

  let includeSubdomains = false;
  let includeApex = true;
  let input = trimmed;
  if (input.startsWith("*.")) {
    includeSubdomains = true;
    includeApex = false;
    input = input.slice(2);
    if (!input || input.startsWith(".")) return null;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".") || !HOST_TEXT.test(host)) return null;
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return null;

  let path = url.pathname;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const wildcard = path.endsWith("/*");
  if (wildcard) {
    path = path.slice(0, -2);
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "") path = "/";
  }

  if (!wildcard && (path === "" || path === "/")) {
    if (includeSubdomains) return { kind: "subdomains", host };
    return { kind: "host", host };
  }

  if (wildcard) {
    return { kind: "section", host, pathPrefix: path, includeSubdomains, includeApex };
  }

  return { kind: "page", host, path, includeSubdomains, includeApex };
}

export function urlMatches(url: string, pattern: Pattern): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  path = path.toLowerCase();

  if (pattern.kind === "host") return hostname === pattern.host;
  if (pattern.kind === "subdomains") return isSubdomain(hostname, pattern.host);

  const hostOk = hostMatches(hostname, pattern.host, pattern.includeApex, pattern.includeSubdomains);
  if (!hostOk) return false;
  if (pattern.kind === "section") return pathMatchesPrefix(path, pattern.pathPrefix.toLowerCase());
  return path === pattern.path.toLowerCase();
}

export function urlMatchesAny(url: string, patterns: Pattern[]): boolean {
  return patterns.some((pattern) => urlMatches(url, pattern));
}

function hostMatches(hostname: string, host: string, includeApex: boolean, includeSubdomains: boolean): boolean {
  if (includeApex && hostname === host) return true;
  if (includeSubdomains && isSubdomain(hostname, host)) return true;
  return false;
}

function isSubdomain(hostname: string, host: string): boolean {
  return hostname !== host && hostname.endsWith(`.${host}`);
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  if (prefix === "" || prefix === "/") return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function patternToRegex(pattern: Pattern): string {
  const host = escapeRegex(pattern.host);
  const port = "(?::[0-9]+)?";
  if (pattern.kind === "host") return `^https?://${host}${port}(?:[/?#]|$)`;
  if (pattern.kind === "subdomains") return `^https?://(?:[a-z0-9-]+\\.)+${host}${port}(?:[/?#]|$)`;

  const hostPart = pattern.includeSubdomains
    ? pattern.includeApex
      ? `(?:${host}|(?:[a-z0-9-]+\\.)+${host})`
      : `(?:[a-z0-9-]+\\.)+${host}`
    : host;

  if (pattern.kind === "section") {
    const prefix = pattern.pathPrefix === "/" ? "" : escapeRegex(pattern.pathPrefix);
    return `^https?://${hostPart}${port}${prefix}(?:/|[?#]|$)`;
  }

  const path = escapeRegex(pattern.path);
  return `^https?://${hostPart}${port}${path}/?(?:[?#]|$)`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function describePattern(raw: string): string {
  const pattern = parsePattern(raw);
  if (!pattern) return "Enter a site, a path ending in /*, or a single page URL.";
  if (pattern.kind === "host") return `Blocks every page on ${pattern.host}. Other hosts stay open.`;
  if (pattern.kind === "subdomains") return `Blocks hosts under ${pattern.host}, not ${pattern.host} itself.`;
  if (pattern.kind === "section") {
    const where = pattern.includeSubdomains ? `subdomains of ${pattern.host}` : pattern.host;
    return `Blocks ${pattern.pathPrefix} and pages under it on ${where}.`;
  }
  const where = pattern.includeSubdomains ? `subdomains of ${pattern.host}` : pattern.host;
  return `Blocks only ${pattern.path} on ${where}. The query string is ignored.`;
}
