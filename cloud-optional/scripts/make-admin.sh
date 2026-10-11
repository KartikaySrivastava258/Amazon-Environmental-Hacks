#!/usr/bin/env bash
# Adds an existing user to the Cognito admin group. Sign up in the app first.
# Usage: ./scripts/make-admin.sh you@example.com [stack-name]
set -euo pipefail
EMAIL="$1"; STACK="${2:-punarnava}"
REGION="${AWS_REGION:-$(aws configure get region || echo ap-south-1)}"
POOL_ID="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" --username "$EMAIL" --group-name admin --region "$REGION"
echo "$EMAIL is now an admin. Sign out and sign in again in the app."
