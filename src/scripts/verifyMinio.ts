import * as AWS from 'aws-sdk';

async function run() {
  console.log('--- MinIO Credentials and Connection Verification ---');
  
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_ROOT_USER || process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_ROOT_PASSWORD || process.env.MINIO_SECRET_KEY;
  const region = process.env.MINIO_REGION_NAME || 'us-east-1';
  
  console.log('Loaded Configuration:');
  console.log('  MINIO_ENDPOINT :', endpoint);
  console.log('  MINIO_ROOT_USER :', accessKeyId);
  console.log('  MINIO_ROOT_PASSWORD :', secretAccessKey ? `${secretAccessKey.slice(0, 4)}...${secretAccessKey.slice(-4)}` : undefined);
  console.log('  MINIO_REGION_NAME :', region);

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('❌ Error: Missing MinIO environment variables in .env!');
    process.exit(1);
  }

  const s3 = new AWS.S3({
    endpoint: endpoint,
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: region,
    httpOptions: { timeout: 10000 }
  });

  console.log('\nTesting connection by listing buckets...');
  try {
    const data = await s3.listBuckets().promise();
    console.log('✅ Success! Connection established.');
    console.log('Available buckets:', data.Buckets?.map(b => b.Name));
  } catch (error: any) {
    console.error('❌ MinIO Connection/Authentication failed!');
    console.error('Error Code:', error.code);
    console.error('Status Code:', error.statusCode);
    console.error('Error Message:', error.message);
    console.error('Full Error Object:', error);
  }
}

run();
