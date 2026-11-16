/** YouTube SPA helpers for turning an on-page Short into a /shorts/… URL the matcher understands. */

export function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "youtube.com" || host.endsWith(".youtube.com");
}

export function pathIsShortsSection(pathname: string): boolean {
  let path = pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const lower = path.toLowerCase();
  return lower === "/shorts" || lower.startsWith("/shorts/");
}

export function shortsIdFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/shorts\/([^/?#]+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function shortsCheckUrl(pageUrl: string, videoId: string | null): string {
  if (!videoId) return pageUrl;
  try {
    const page = new URL(pageUrl);
    if (!isYouTubeHost(page.hostname)) return pageUrl;
    if (pathIsShortsSection(page.pathname)) return pageUrl;
    return `${page.origin}/shorts/${videoId}`;
  } catch {
    return pageUrl;
  }
}

export function shortsVideoIdFromDocument(doc: Document, origin: string): string | null {
  const og = doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
  if (og) {
    const id = shortsIdFromUrl(og);
    if (id) return id;
  }
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (canonical) {
    const id = shortsIdFromUrl(canonical.startsWith("http") ? canonical : `${origin}${canonical}`);
    if (id) return id;
  }
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/shorts/"]'))) {
    const href = anchor.href || `${origin}${anchor.getAttribute("href") ?? ""}`;
    const id = shortsIdFromUrl(href);
    if (id && anchor.closest("ytd-shorts, ytd-reel-video-renderer, ytd-shorts-shelf-renderer, #shorts-container")) {
      return id;
    }
  }
  const shortsRoot = doc.querySelector("ytd-shorts");
  if (shortsRoot && isVisible(shortsRoot)) {
    const active = shortsRoot.querySelector<HTMLElement>("[video-id], [data-video-id]");
    const fromAttr = active?.getAttribute("video-id") ?? active?.getAttribute("data-video-id");
    if (fromAttr) return fromAttr;
    const href = shortsRoot.querySelector<HTMLAnchorElement>('a[href*="/shorts/"]')?.href;
    if (href) {
      const id = shortsIdFromUrl(href);
      if (id) return id;
    }
  }
  const reel = doc.querySelector<HTMLElement>("ytd-reel-video-renderer[selected], ytd-reel-video-renderer[is-active]");
  const reelId = reel?.getAttribute("video-id");
  if (reelId) return reelId;
  return null;
}

function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.offsetParent !== null) return true;
  const rect = html.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}