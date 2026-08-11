/**
 * `navigator.clipboard` only exists in a secure context. This dashboard is
 * routinely opened over plain http on a LAN address (`http://10.0.0.5:3000`),
 * where the API is simply undefined — so the legacy `execCommand` path is the
 * one that actually runs for a lot of users, not a nicety for old browsers.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_e) {
      // Permission denied or a non-secure context that still exposes the API.
      // Fall through to the textarea path rather than failing outright.
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Off-screen but still selectable; `display: none` would break selection.
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (_e) {
    return false;
  }
};
