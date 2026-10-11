// Photos and voice notes in LocalStack S3 (PN_FILES=localstack). Same port as files-disk.js. Dummy credentials only.
export async function createS3Files({ endpoint, bucket, region }) {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const s3 = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  return {
    kind: 'localstack-s3',
    async presignPut(key, contentType) { return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 900 }); },
    async presignGet(key) {
      if (!key) return null;
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); } catch { return null; }
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
    },
    async putData(key, dataUrl) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl));
      if (m) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(m[3], m[2] ? 'base64' : 'utf8'), ContentType: m[1] }));
    },
  };
}

/** DynamoDB store against LocalStack (PN_STORE=localstack). */
export async function createLocalstackStore({ endpoint, table, region }) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const { createDynamoStore } = await import('../adapters/dynamo.js');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }), { marshallOptions: { removeUndefinedValues: true } });
  return createDynamoStore(ddb, table);
}
