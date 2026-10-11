// LocalStack setup from Node (used by reset and `npm run local:check`); the container init script does the same
// at start-up (local/localstack/init/ready.d/10-punarnava.sh). Dummy credentials only.
const creds = { accessKeyId: 'test', secretAccessKey: 'test' };

export const TABLE_DEF = (TableName) => ({
  TableName, BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK'].map((AttributeName) => ({ AttributeName, AttributeType: 'S' })),
  KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
  GlobalSecondaryIndexes: ['GSI1', 'GSI2'].map((n) => ({ IndexName: n, KeySchema: [{ AttributeName: `${n}PK`, KeyType: 'HASH' }, { AttributeName: `${n}SK`, KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } })),
});

export async function recreateTable(config) {
  const { DynamoDBClient, DeleteTableCommand, CreateTableCommand, waitUntilTableExists, waitUntilTableNotExists } = await import('@aws-sdk/client-dynamodb');
  const db = new DynamoDBClient({ endpoint: config.localstackUrl, region: config.region, credentials: creds });
  try {
    await db.send(new DeleteTableCommand({ TableName: config.table }));
    await waitUntilTableNotExists({ client: db, maxWaitTime: 30 }, { TableName: config.table });
  } catch (e) { if (e.name !== 'ResourceNotFoundException') throw e; }
  await db.send(new CreateTableCommand(TABLE_DEF(config.table)));
  await waitUntilTableExists({ client: db, maxWaitTime: 30 }, { TableName: config.table });
}

/** { dynamodb: bool, s3: bool, errors } for the status page and `local:check`. */
export async function checkLocalstack(config) {
  const out = { dynamodb: false, s3: false, errors: [] };
  try {
    const { DynamoDBClient, DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
    await new DynamoDBClient({ endpoint: config.localstackUrl, region: config.region, credentials: creds }).send(new DescribeTableCommand({ TableName: config.table }));
    out.dynamodb = true;
  } catch (e) { out.errors.push(`DynamoDB table ${config.table}: ${e.name || e.message}`); }
  try {
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    await new S3Client({ endpoint: config.localstackUrl, region: config.region, forcePathStyle: true, credentials: creds }).send(new HeadBucketCommand({ Bucket: config.bucket }));
    out.s3 = true;
  } catch (e) { out.errors.push(`S3 bucket ${config.bucket}: ${e.name || e.message}`); }
  return out;
}
