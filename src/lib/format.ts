/**
 * NOIR Music — formatting helpers (pure, unit-testable).
 */

/** 213 → "3:33"; 61 → "1:01"; durations over an hour keep their hours. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** 12_500_000 → "11.9 MB"; under a megabyte is shown in KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 * 1024) {
    const kilobytes = Math.max(1, Math.round(bytes / 1024));
    return `${kilobytes.toLocaleString('en-US')} KB`;
  }
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) {
    return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
  }
  return `${(megabytes / 1024).toFixed(megabytes / 1024 < 10 ? 1 : 0)} GB`;
}

/** "0" → "Not played"; 3 → "3 plays" (used by future statistics views). */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * Chooses the display font class for a string: Instrument Serif for Latin,
 * Vazirmatn for Persian/Arabic script — mirrors the native `ScriptFont.face`.
 */
export function containsArabicScript(text: string): boolean {
  return Array.from(text).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0xfb50 && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff)
    );
  });
}

export function displayFontClass(text: string): string {
  return containsArabicScript(text) ? 'display-fa' : '';
}
