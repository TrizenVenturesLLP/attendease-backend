import * as AWS from 'aws-sdk';
import { BaseStorage } from './StorageInterface';

interface MinIOConfig {
  endpoint?: string;
  port?: string;
  useSSL?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  publicDomain?: string;
  region?: string;
  /** When true, skip public-read bucket policy (private buckets). */
  privateBucket?: boolean;
}

export class MinIOStorage extends BaseStorage {
  private s3: AWS.S3;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;
  private publicDomain?: string;
  private region: string;
  private privateBucket: boolean;

  constructor(config: MinIOConfig = {}) {
    super();
    
    // CapRover MinIO configuration
    const rawEndpoint = config.endpoint || process.env.MINIO_ENDPOINT || '';
    const rawPort = config.port || process.env.MINIO_PORT || '';
    const useSSL =
      typeof config.useSSL !== 'undefined'
        ? !!config.useSSL
        : (process.env.MINIO_USE_SSL || '').toLowerCase() === 'true';

    let protocol = useSSL ? 'https' : 'http';
    let host = 'srv-captain--extrahand-minio-storage';
    let port = rawPort || '';

    if (rawEndpoint) {
      try {
        if (rawEndpoint.includes('://')) {
          const url = new URL(rawEndpoint);
          host = url.hostname || host;
          protocol = url.protocol.replace(':', '') || protocol;
          if (url.port) {
            port = url.port;
          } else if (rawPort) {
            port = rawPort;
          } else if (protocol === 'http') {
            port = '9000';
          } else {
            // HTTPS without explicit port — use default 443 (omit from endpoint string)
            port = '';
          }
        } else {
          host = rawEndpoint;
          if (!port) {
            port = protocol === 'http' ? '9000' : '';
          }
        }
      } catch (e) {
        console.warn('⚠️ Could not parse MINIO_ENDPOINT, using defaults', { rawEndpoint, error: (e as Error).message });
      }
    } else if (!port) {
      port = protocol === 'http' ? '9000' : '';
    }

    const endpointString = `${protocol}://${host}${port ? `:${port}` : ''}`;
    this.endpoint = endpointString;
    
    // Support both MINIO_ACCESS_KEY and MINIO_ROOT_USER (CapRover uses MINIO_ROOT_USER)
    this.accessKeyId = config.accessKeyId || process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || '';
    
    // Support both MINIO_SECRET_KEY and MINIO_ROOT_PASSWORD (CapRover uses MINIO_ROOT_PASSWORD)
    this.secretAccessKey = config.secretAccessKey || process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
    
    this.bucketName = config.bucketName || process.env.MINIO_BUCKET_NAME || 'trizen-attendance-photos';
    
    // Support MINIO_SERVER_URL (from CapRover) or MINIO_PUBLIC_DOMAIN
    const serverUrl = process.env.MINIO_SERVER_URL;
    if (serverUrl) {
      try {
        const url = new URL(serverUrl);
        this.publicDomain = url.hostname;
      } catch (e) {
        this.publicDomain = config.publicDomain || process.env.MINIO_PUBLIC_DOMAIN;
      }
    } else {
      this.publicDomain = config.publicDomain || process.env.MINIO_PUBLIC_DOMAIN;
    }
    
    // Support MINIO_REGION_NAME from CapRover, fallback to us-east-1
    this.region = config.region || process.env.MINIO_REGION_NAME || 'us-east-1';
    this.privateBucket = !!config.privateBucket;

    // Initialize S3 client (MinIO is S3-compatible)
    this.s3 = new AWS.S3({
      endpoint: this.endpoint,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      s3ForcePathStyle: true, // Required for MinIO
      signatureVersion: 'v4',
      region: this.region,
      // Fast-fail timeouts to prevent blocking
      httpOptions: {
        timeout: 30000,
        connectTimeout: 10000,
      },
      // Disable retries for faster failure
      maxRetries: 0,
    });

    console.log('✅ MinIO Storage client ready', {
      endpoint: this.endpoint,
      bucket: this.bucketName,
      publicDomain: this.publicDomain || 'using endpoint',
      region: this.region,
    });

    if (!this.accessKeyId || !this.secretAccessKey) {
      console.warn('⚠️ MinIO credentials not configured - photo upload will be disabled');
    }
    // No network calls here: bucket/connectivity is validated on first upload (or health check).
  }

  /** AWS SDK / network conditions where storage cannot be reached (not a missing bucket). */
  private isStorageUnreachable(err: any): boolean {
    if (!err) return false;
    const code = err.code as string | undefined;
    const msg = String(err.message || '');
    if (code === 'NetworkingError' || code === 'TimeoutError' || code === 'UnknownEndpoint') {
      return true;
    }
    if (
      msg.includes('ETIMEDOUT') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('Inaccessible host') ||
      msg.includes('getaddrinfo')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Ensure bucket exists, create if it doesn't. Call only from uploads or explicit health checks.
   */
  private async ensureBucketExists(): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      try {
        await this.s3.headBucket({ Bucket: this.bucketName }).promise();
        if (!this.privateBucket) {
          try {
            await this.ensureBucketPolicy();
          } catch {
            // Ignore policy errors - not critical
          }
        }
        return true;
      } catch (headError: any) {
        if (this.isStorageUnreachable(headError)) {
          throw new Error('MinIO service unavailable');
        }

        if (headError.statusCode === 404 || headError.code === 'NotFound') {
          try {
            console.log(`📦 Bucket '${this.bucketName}' not found. Creating it...`);
            await this.s3.createBucket({ Bucket: this.bucketName }).promise();

            if (!this.privateBucket) {
              try {
                await this.ensureBucketPolicy();
              } catch {
                // Ignore policy errors - not critical
              }
            }

            console.log(`✅ Bucket '${this.bucketName}' created successfully`);
            return true;
          } catch (createError: any) {
            if (
              createError.code === 'BucketAlreadyOwnedByYou' ||
              createError.code === 'BucketAlreadyExists'
            ) {
              return true;
            }
            if (this.isStorageUnreachable(createError)) {
              throw new Error('MinIO service unavailable');
            }
            throw createError;
          }
        }
        throw headError;
      }
    } catch (error: any) {
      if (error.message === 'MinIO service unavailable' || error.message === 'MinIO credentials not configured') {
        throw error;
      }
      if (this.isStorageUnreachable(error)) {
        throw new Error('MinIO service unavailable');
      }
      throw new Error(`Failed to ensure bucket exists: ${error.message}`);
    }
  }

  /**
   * Ensure bucket has public read policy
   */
  private async ensureBucketPolicy(): Promise<void> {
    try {
      const bucketPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucketName}/*`],
          },
        ],
      };
      
      await this.s3.putBucketPolicy({
        Bucket: this.bucketName,
        Policy: JSON.stringify(bucketPolicy),
      }).promise();
    } catch (policyError: any) {
      // Log but don't fail
      if (policyError.code !== 'MalformedPolicy') {
        console.warn(`⚠️ Could not set bucket policy: ${policyError.message}`);
      }
    }
  }

  /**
   * Upload file to MinIO
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    folder: string = 'uploads',
    metadata: any = {}
  ): Promise<{ url: string; key: string; bucket?: string }> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      // Try to ensure bucket exists (will fail fast if unreachable)
      try {
        await this.ensureBucketExists();
      } catch (bucketError: any) {
        if (
          bucketError.message === 'MinIO service unavailable' ||
          this.isStorageUnreachable(bucketError)
        ) {
          throw new Error('Photo upload unavailable - storage service is not reachable');
        }
        throw bucketError;
      }

      // Sanitize file name
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const timestamp = Date.now();
      const key = `${folder}/${timestamp}_${sanitizedFileName}`;

      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        Metadata: {
          uploadedAt: new Date().toISOString(),
          originalFileName: fileName,
          ...metadata,
        },
      };

      await this.s3.upload(params).promise();

      // Get public URL
      const url = this.getFileUrl(key);

      console.log('File uploaded to MinIO', {
        key,
        bucket: this.bucketName,
        size: fileBuffer.length,
      });

      return {
        url,
        key,
        bucket: this.bucketName,
      };
    } catch (error: any) {
      // Provide user-friendly error messages
      let errorMessage = 'Failed to upload file to MinIO';
      
      if (error.message?.includes('unavailable') || error.message?.includes('unreachable')) {
        errorMessage = error.message;
      } else if (this.isStorageUnreachable(error)) {
        errorMessage = 'Storage service is not reachable';
      } else if (error.code === 'NetworkingError' || error.code === 'TimeoutError' ||
                 error.message?.includes('ETIMEDOUT') || error.message?.includes('ECONNREFUSED')) {
        errorMessage = 'Storage service is not reachable';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      console.warn('Upload failed:', errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Delete file from MinIO
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      const params: AWS.S3.DeleteObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
      };

      await this.s3.deleteObject(params).promise();
      console.log('File deleted from MinIO', { key });
      return true;
    } catch (error: any) {
      console.error('Error deleting file from MinIO:', error.message);
      throw new Error(`Failed to delete file from MinIO: ${error.message}`);
    }
  }

  /**
   * Get public URL for a file
   */
  getFileUrl(key: string): string {
    if (this.publicDomain) {
      // Use public domain if configured
      return `https://${this.publicDomain}/${this.bucketName}/${key}`;
    }
    
    // Fallback to endpoint URL
    const endpointUrl = this.endpoint.replace(/\/$/, '');
    return `${endpointUrl}/${this.bucketName}/${key}`;
  }

  /**
   * Presigned GET URL for private buckets (e.g. profile photos).
   */
  getPresignedUrl(key: string, expiresSeconds = 86400): Promise<string> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      return Promise.reject(new Error('MinIO credentials not configured'));
    }

    return this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucketName,
      Key: key,
      Expires: expiresSeconds,
    });
  }

  /**
   * Download object bytes (for API proxy serving private files).
   */
  async getObjectBuffer(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('MinIO credentials not configured');
    }

    try {
      const result = await this.s3.getObject({ Bucket: this.bucketName, Key: key }).promise();
      const buffer = await this.bodyToBuffer(result.Body);
      return {
        buffer,
        contentType: result.ContentType || 'image/jpeg',
      };
    } catch (error: any) {
      const code = error?.code as string | undefined;
      if (code === 'NoSuchKey' || code === 'NotFound' || error?.statusCode === 404) {
        throw new Error(`Object not found in storage: ${key}`);
      }
      if (this.isStorageUnreachable(error)) {
        throw new Error('Storage service is not reachable');
      }
      throw new Error(error?.message || 'Failed to read object from storage');
    }
  }

  private async bodyToBuffer(body: unknown): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === 'string') return Buffer.from(body);

    const stream = body as NodeJS.ReadableStream;
    if (typeof stream?.on === 'function') {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
      return Buffer.concat(chunks);
    }

    return Buffer.from(body as ArrayBuffer);
  }

  /**
   * Health check - verify MinIO is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        return false;
      }

      await this.ensureBucketExists();
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      return true;
    } catch (error: any) {
      console.warn('MinIO health check failed:', error.message);
      return false;
    }
  }
}

// Export singleton instances
export const minioStorage = new MinIOStorage();

export const profileMinioStorage = new MinIOStorage({
  bucketName: process.env.MINIO_PROFILE_BUCKET_NAME || 'profile-photos',
  privateBucket: true,
});

/** Check-in selfie bucket (private). Name matches MinIO console: attendence-image-checkin */
export const checkInMinioStorage = new MinIOStorage({
  bucketName:
    process.env.MINIO_CHECKIN_BUCKET_NAME ||
    process.env.MINIO_BUCKET_NAME ||
    'attendence-image-checkin',
  privateBucket: true,
});

export const leaveMinioStorage = new MinIOStorage({
  bucketName: process.env.MINIO_LEAVE_BUCKET_NAME || 'leave-attachments',
  privateBucket: true,
});
