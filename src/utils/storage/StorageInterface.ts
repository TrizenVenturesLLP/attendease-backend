/**
 * Base Storage Interface
 * Abstract class that all storage implementations must extend
 */
export abstract class BaseStorage {
  /**
   * Upload a file to storage
   */
  abstract uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    folder?: string,
    metadata?: any
  ): Promise<{ url: string; key: string; bucket?: string }>;

  /**
   * Delete a file from storage
   */
  abstract deleteFile(key: string): Promise<boolean>;

  /**
   * Get public URL for a file
   */
  abstract getFileUrl(key: string): string;

  /**
   * Health check
   */
  abstract healthCheck(): Promise<boolean>;
}
