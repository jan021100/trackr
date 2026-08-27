export function safeInternalReturnPath(value: string | null | undefined, fallback = '/clothing'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const url = new URL(value, 'https://trackr.local');
    if (url.origin !== 'https://trackr.local' || url.pathname.startsWith('/clothing/edit/')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function itemEditHref(itemId: string, returnTo: string): string {
  const safeReturnTo = safeInternalReturnPath(returnTo);
  const url = new URL(safeReturnTo, 'https://trackr.local');
  url.searchParams.set('editItem', itemId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function withImageSavedNotice(returnTo: string, format: 'webp' | 'png' | null): string {
  const safeReturnTo = safeInternalReturnPath(returnTo);
  if (!format) return safeReturnTo;
  const url = new URL(safeReturnTo, 'https://trackr.local');
  url.searchParams.set('imageSaved', format);
  return `${url.pathname}${url.search}${url.hash}`;
}
