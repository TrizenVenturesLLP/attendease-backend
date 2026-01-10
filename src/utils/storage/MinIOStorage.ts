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
}

export class MinIOStorage extends BaseStorage {
  private s3: AWS.S3;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;
  private publicDomain?: string;
  private region: string;

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
    let port = rawPort || '9000';

    if (rawEndpoint) {
      try {
        if (rawEndpoint.includes('://')) {
          const url = new URL(rawEndpoint);
          host = url.hostname || host;
          port = url.port || rawPort || port;
          protocol = url.protocol.replace(':', '') || protocol;
        } else {
          host = rawEndpoint;
        }
      } catch (e) {
        console.warn('⚠️ Could not parse MINIO_ENDPOINT, using defaults', { rawEndpoint, error: (e as Error).message });
      }
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

    // Validate required configuration
    if (!this.accessKeyId || !this.secretAccessKey) {
      console.warn('⚠️ MinIO credentials not configured. Storage operations will fail.');
    }

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
        timeout: 5000, // 5 second timeout for HTTP requests
        connectTimeout: 3000, // 3 second timeout for initial connection
      },
      // Disable retries for faster failure
      maxRetries: 0,
    });

    console.log('✅ MinIO Storage initialized', {
      endpoint: this.endpoint,
      bucket: this.bucketName,
      publicDomain: this.publicDomain || 'using endpoint',
      region: this.region,
    });

    // Ensure bucket exists on initialization (non-blocking, runs in background)
    if (this.accessKeyId && this.secretAccessKey) {
      this.ensureBucketExists().catch(error => {
        // Silent fail - will retry on actual upload
        console.debug('Bucket validation skipped during init:', error.message);
      });
    } else {
      console.warn('⚠️ MinIO credentials not configured - photo upload will be disabled');
    }
  }

  /**
   * Ensure bucket exists, create if it doesn't
   */
  private async ensureBucketExists(): Promise<boolean> {
    try {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('MinIO credentials not configured');
      }

      // Check if bucket exists with timeout
      try {
        await this.s3.headBucket({ Bucket: this.bucketName }).promise();
        // Bucket exists - try to ensure public read policy
        try {
          await this.ensureBucketPolicy();
        } catch (policyError) {
          // Ignore policy errors - not critical
        }
        return true;
      } catch (headError: any) {
        // Network/timeout errors - don't try to create, just fail fast
        if (headError.code === 'NetworkingError' || headError.code === 'TimeoutError' || 
            headError.message?.includes('ETIMEDOUT') || headError.message?.includes('ECONNREFUSED')) {
          console.warn('⚠️ MinIO unreachable - photo uploads disabled temporarily');
          throw new Error('MinIO service unavailable');
        }
        
        // Bucket doesn't exist (404/NotFound) - proceed to create it
        if (headError.statusCode === 404 || headError.code === 'NotFound') {
          try {
            console.log(`📦 Bucket '${this.bucketName}' not found. Creating it...`);
            await this.s3.createBucket({ Bucket: this.bucketName }).promise();
            
            // Set bucket policy for public read access (ignore failures)
            try {
              await this.ensureBucketPolicy();
            } catch (policyError) {
              // Ignore policy errors - not critical
            }
            
            console.log(`✅ Bucket '${this.bucketName}' created successfully`);
            return true;
          } catch (createError: any) {
            // Handle race condition: bucket might have been created by another request
            if (
              createError.code === 'BucketAlreadyOwnedByYou' ||
              createError.code === 'BucketAlreadyExists'
            ) {
              return true;
            }
            console.error('Error creating bucket:', createError.message);
            throw createError;
          }
        }
        throw headError;
      }
    } catch (error: any) {
      // Don't log full stack trace for network errors
      if (error.message === 'MinIO service unavailable') {
        throw error;
      }
      console.error('Failed to ensure bucket exists:', error.message);
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
        if (bucketError.message === 'MinIO service unavailable') {
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

// Export singleton instance
export const minioStorage = new MinIOStorage();
