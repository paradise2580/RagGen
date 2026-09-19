/**
 * Trigger a browser download for a URL without opening a new tab.
 *
 * The presigned URL from the API carries `Content-Disposition: attachment`, so
 * a plain anchor click makes the browser download the file directly instead of
 * navigating to / rendering it. We use a temporary anchor (not `window.open`)
 * to avoid a flashing blank tab.
 */
export function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  // Hint for same-origin; cross-origin S3 relies on Content-Disposition instead.
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
