/**
 * copyToClipboard — best-effort clipboard write with textarea fallback.
 * Works in both secure (navigator.clipboard) and insecure contexts.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  } catch {
    // Best-effort; ignore failures in insecure/non-clipboard contexts.
  }
}
