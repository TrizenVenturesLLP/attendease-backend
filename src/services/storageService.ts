import AWS from 'aws-sdk';
import config from '../config';
import { logger } from '../utils/logger';
import { BadRequestError } from '../utils/AppError';

// Configure S3 client for MinIO
const s3 = new AWS.S3({
  accessKeyId: config.minio.rootUser,
  secretAccessKey: config.minio.rootPassword,
  endpoint: config.minio.endpoint,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: config.minio.regionName,
});

export class StorageService {
  /**
   * Upload a base64 encoded image to a MinIO bucket
   * @param base64Data The full base64 string (including data:image/png;base64, etc.)
   * @param bucketName The bucket to upload to
   * @param pathPrefix The prefix/folder for the object key
   * @returns The public URL of the uploaded image
   */
  async uploadBase64Image(base64Data: string, bucketName: string, pathPrefix: string): Promise<string> {
    try {
      // Parse base64
      const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new BadRequestError('Invalid base64 image data format');
      }

      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      
      // Determine file extension
      let extension = 'png';
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
        extension = 'jpg';
      } else if (mimeType.includes('gif')) {
        extension = 'gif';
      } else if (mimeType.includes('webp')) {
        extension = 'webp';
      }

      const filename = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;

      logger.info(`Uploading image to MinIO: bucket=${bucketName}, file=${filename}`);

      const params = {
        Bucket: bucketName,
        Key: filename,
        Body: buffer,
        ContentType: mimeType,
      };

      const uploadResult = await s3.upload(params).promise();
      
      logger.info(`Successfully uploaded to MinIO: ${uploadResult.Location}`);
      return uploadResult.Location;
    } catch (error: any) {
      logger.error('Failed to upload image to MinIO storage', { error: error.message });
      throw new BadRequestError(`Storage upload failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from a MinIO bucket
   */
  async deleteFile(fileUrl: string, bucketName: string): Promise<void> {
    try {
      if (!fileUrl) return;

      // Extract the key from the fileUrl
      const endpoint = config.minio.endpoint.replace(/\/$/, '');
      const relativePath = fileUrl.replace(endpoint, '').replace(/^\//, '');
      
      // Remove bucket name prefix if it exists in the relative path (since s3ForcePathStyle is true)
      const bucketPrefix = `${bucketName}/`;
      let key = relativePath;
      if (relativePath.startsWith(bucketPrefix)) {
        key = relativePath.substring(bucketPrefix.length);
      }

      logger.info(`Deleting image from MinIO: bucket=${bucketName}, key=${key}`);

      await s3.deleteObject({
        Bucket: bucketName,
        Key: key,
      }).promise();
    } catch (error: any) {
      logger.error('Failed to delete image from MinIO storage', { error: error.message });
      // We don't throw here to avoid blocking user profile update when deletion fails
    }
  }
}

export default new StorageService();
