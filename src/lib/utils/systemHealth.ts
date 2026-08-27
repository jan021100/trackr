export const FIRESTORE_FREE_STORAGE_BYTES = 1024 ** 3;
export const FIRESTORE_FREE_DAILY_READS = 50_000;
export const FIRESTORE_FREE_DAILY_WRITES = 20_000;
export const FIRESTORE_FREE_MONTHLY_EGRESS_BYTES = 10 * 1024 ** 3;

export type StoredImageFormat = 'webp' | 'png' | 'jpeg' | 'other' | 'url-only' | 'none';

export type WardrobeHealthItem = {
  id: string;
  name: string;
  format: StoredImageFormat;
  imageBytes: number;
  documentBytes: number;
};

export type WardrobeStorageHealth = {
  documentCount: number;
  estimatedDocumentBytes: number;
  imageBytes: number;
  embeddedImageCount: number;
  webpCount: number;
  webpCoverage: number;
  estimatedFreeStoragePercent: number;
  formats: Record<StoredImageFormat, number>;
  largestImages: WardrobeHealthItem[];
  nonWebpImages: WardrobeHealthItem[];
};

export type BrowserPerformanceHealth = {
  score: number;
  navigationMs: number | null;
  resourceCount: number;
  transferredBytes: number;
  firestoreRequestCount: number;
  firestoreTransferredBytes: number;
  slowResourceCount: number;
  longTaskCount: number;
};

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function detectStoredImageFormat(imageBase64: unknown, imageUrl: unknown): StoredImageFormat {
  const value = typeof imageBase64 === 'string' ? imageBase64.trim().toLowerCase() : '';
  if (value.startsWith('data:image/webp')) return 'webp';
  if (value.startsWith('data:image/png')) return 'png';
  if (value.startsWith('data:image/jpeg') || value.startsWith('data:image/jpg')) return 'jpeg';
  if (value.startsWith('data:image/')) return 'other';
  if (typeof imageUrl === 'string' && imageUrl.trim()) return 'url-only';
  return 'none';
}

function safeJsonBytes(value: unknown): number {
  try {
    return utf8Bytes(JSON.stringify(value) ?? '');
  } catch {
    return 0;
  }
}

export function analyzeWardrobeStorage(
  records: Array<{ id: string; data: Record<string, unknown> }>
): WardrobeStorageHealth {
  const formats: Record<StoredImageFormat, number> = {
    webp: 0,
    png: 0,
    jpeg: 0,
    other: 0,
    'url-only': 0,
    none: 0
  };

  const items = records.map(({ id, data }) => {
    const imageBase64 = typeof data.imageBase64 === 'string' ? data.imageBase64 : '';
    const format = detectStoredImageFormat(imageBase64, data.imageUrl);
    formats[format] += 1;
    return {
      id,
      name: String(data.product ?? data.name ?? 'Unnamed item'),
      format,
      imageBytes: imageBase64 ? utf8Bytes(imageBase64) : 0,
      documentBytes: safeJsonBytes(data)
    } satisfies WardrobeHealthItem;
  });

  const embedded = items.filter((item) => ['webp', 'png', 'jpeg', 'other'].includes(item.format));
  const webpCount = formats.webp;
  const estimatedDocumentBytes = items.reduce((total, item) => total + item.documentBytes, 0);
  const imageBytes = items.reduce((total, item) => total + item.imageBytes, 0);

  return {
    documentCount: items.length,
    estimatedDocumentBytes,
    imageBytes,
    embeddedImageCount: embedded.length,
    webpCount,
    webpCoverage: embedded.length ? (webpCount / embedded.length) * 100 : 0,
    estimatedFreeStoragePercent: (estimatedDocumentBytes / FIRESTORE_FREE_STORAGE_BYTES) * 100,
    formats,
    largestImages: items
      .filter((item) => item.imageBytes > 0)
      .sort((a, b) => b.imageBytes - a.imageBytes)
      .slice(0, 8),
    nonWebpImages: items
      .filter((item) => ['png', 'jpeg', 'other'].includes(item.format))
      .sort((a, b) => b.imageBytes - a.imageBytes)
  };
}

export function performanceScore(input: Omit<BrowserPerformanceHealth, 'score'>): number {
  let score = 100;
  if (input.navigationMs !== null) score -= Math.min(35, Math.max(0, input.navigationMs - 1500) / 100);
  score -= Math.min(25, input.slowResourceCount * 5);
  score -= Math.min(25, input.longTaskCount * 5);
  if (input.transferredBytes > 5 * 1024 ** 2) score -= 15;
  return Math.max(0, Math.round(score));
}

export function readBrowserPerformance(): BrowserPerformanceHealth {
  if (typeof performance === 'undefined') {
    return {
      score: 0,
      navigationMs: null,
      resourceCount: 0,
      transferredBytes: 0,
      firestoreRequestCount: 0,
      firestoreTransferredBytes: 0,
      slowResourceCount: 0,
      longTaskCount: 0
    };
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const firestoreResources = resources.filter((entry) =>
    /firestore\.googleapis\.com|firebaseinstallations\.googleapis\.com/.test(entry.name)
  );
  const snapshot = {
    navigationMs: navigation ? navigation.duration : null,
    resourceCount: resources.length,
    transferredBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
    firestoreRequestCount: firestoreResources.length,
    firestoreTransferredBytes: firestoreResources.reduce(
      (total, entry) => total + (entry.transferSize || 0),
      0
    ),
    slowResourceCount: resources.filter((entry) => entry.duration > 1000).length,
    longTaskCount: performance.getEntriesByType('longtask').length
  };

  return { ...snapshot, score: performanceScore(snapshot) };
}
