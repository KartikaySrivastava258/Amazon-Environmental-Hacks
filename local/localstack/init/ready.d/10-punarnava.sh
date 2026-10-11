#!/bin/bash
# LocalStack ready hook: the DynamoDB table (same keys and indexes as the app's single-table design) and the
# S3 bucket for photos and voice notes. Idempotent. LocalStack Community does not keep data across container
# restarts; the app re-seeds an empty table on start (backend/src/local/context.js, seedIfEmpty).
set -euo pipefail
TABLE="${PN_TABLE:-punarnava-local}"
BUCKET="${PN_BUCKET:-punarnava-local}"
if ! awslocal dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  awslocal dynamodb create-table --table-name "$TABLE" --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
      AttributeName=GSI2PK,AttributeType=S AttributeName=GSI2SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
      'IndexName=GSI1,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=GSI2,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' >/dev/null
  echo "punarnava: created table $TABLE"
fi
if ! awslocal s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  awslocal s3 mb "s3://$BUCKET" >/dev/null
  awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration \
    '{"CORSRules":[{"AllowedOrigins":["http://127.0.0.1:8787","http://localhost:8787"],"AllowedMethods":["GET","PUT"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]}'
  echo "punarnava: created bucket $BUCKET"
fi
