# Optional: AWS cloud deployment ("Ship It")

**Not used by the local Build It setup.** Nothing in this folder is needed to run, test or demo Punarnava on a
laptop. See the main README for the local setup (`scripts/local/start.sh`).

This is the earlier AWS deployment, kept for reference: `template.yaml` (SAM: Cognito, API Gateway, Lambda,
DynamoDB, S3, Step Functions, EventBridge, SQS, SNS, optional SageMaker), `statemachine/`, and
`scripts/deploy-frontend.sh`, `scripts/make-admin.sh`, `scripts/train_rcf.py`. It needs an AWS account and
creates billable resources. It was not re-tested after the Build It pivot.

    sam build -t cloud-optional/template.yaml
    sam deploy --guided -t cloud-optional/template.yaml
    cloud-optional/scripts/deploy-frontend.sh

The Lambda handlers it runs are `backend/src/handlers/{api,async,auth,workflow}.js` with the AWS adapter
`backend/src/adapters/aws.js`; their SDKs are `optionalDependencies` in `backend/package.json`.
For the local, never-deployed SAM template see `sam/template.local.yaml`.
