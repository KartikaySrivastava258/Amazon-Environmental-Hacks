#!/usr/bin/env bash
# Deploys the web app to Amplify Hosting using the outputs of the CloudFormation stack.
# Usage: ./scripts/deploy-frontend.sh [stack-name]   (default: punarnava)
set -euo pipefail
STACK="${1:-punarnava}"
REGION="${AWS_REGION:-$(aws configure get region || echo ap-south-1)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
API_URL="$(out ApiUrl)"; POOL_ID="$(out UserPoolId)"; CLIENT_ID="$(out UserPoolClientId)"
APP_ID="$(out AmplifyAppId)"; APP_URL="$(out AppUrl)"
# Cloud read-aloud / voice typing (EnableCloudSpeech). Older stacks have no such output: treat as off.
CLOUD_SPEECH="$(out CloudSpeech)"; [ "$CLOUD_SPEECH" = "true" ] || CLOUD_SPEECH=false
[ -n "$API_URL" ] && [ "$API_URL" != "None" ] || { echo "Stack $STACK not found in $REGION. Run sam deploy first."; exit 1; }

# Catalog checks (five languages per key, matching placeholders). Stops the deploy on errors.
if command -v node > /dev/null; then node "$ROOT/scripts/check-i18n.mjs"; else echo "node not found: skipping the translation check"; fi

BUILD="$(mktemp -d)"
cp -r "$ROOT/frontend" "$BUILD/site"
rm -rf "$BUILD/site/core" && cp -r "$ROOT/backend/src/core" "$BUILD/site/core"
cat > "$BUILD/site/config.js" <<CFG
window.PUNARNAVA_CONFIG = {
  apiUrl: '$API_URL',
  region: '$REGION',
  userPoolId: '$POOL_ID',
  clientId: '$CLIENT_ID',
  cloudSpeech: $CLOUD_SPEECH,
};
CFG
(cd "$BUILD/site" && zip -qr "$BUILD/site.zip" .)

read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --app-id "$APP_ID" --branch-name main --region "$REGION" \
  --query "[jobId,zipUploadUrl]" --output text)
curl -sS --fail -X PUT -H "Content-Type: application/zip" --upload-file "$BUILD/site.zip" "$UPLOAD_URL" > /dev/null
aws amplify start-deployment --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" --region "$REGION" > /dev/null

echo "Deploying job $JOB_ID ..."
for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" --region "$REGION" --query 'job.summary.status' --output text)"
  [ "$STATUS" = "SUCCEED" ] && { echo "Live at $APP_URL"; exit 0; }
  [ "$STATUS" = "FAILED" ] && { echo "Amplify deployment failed. Check the Amplify console."; exit 1; }
  sleep 5
done
echo "Still deploying. Check the Amplify console, then open $APP_URL"
