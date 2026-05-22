type LogMeta = Record<string, unknown>;

function formatMeta(meta?: LogMeta): string {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    console.log(`[TrizenHR] ${message}${formatMeta(meta)}`);
  },
  warn(message: string, meta?: LogMeta): void {
    console.warn(`[TrizenHR] ${message}${formatMeta(meta)}`);
  },
  error(message: string, meta?: LogMeta): void {
    console.error(`[TrizenHR] ${message}${formatMeta(meta)}`);
  },
};
