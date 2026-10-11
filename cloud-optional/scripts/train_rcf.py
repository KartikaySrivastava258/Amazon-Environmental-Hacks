#!/usr/bin/env python3
"""
Train and deploy the SageMaker Random Cut Forest model that scores monthly failure spikes.

What it does:
  1. Reads the component failure aggregates from the Punarnava DynamoDB table.
  2. Builds one feature row per component per month: [count, median of prior months, ratio].
  3. Trains the built-in Random Cut Forest algorithm on those rows.
  4. Deploys an endpoint (serverless by default) named punarnava-rcf.

Then redeploy the stack with:  sam deploy --parameter-overrides SageMakerEndpoint=punarnava-rcf
The anomaly Lambda will use SageMaker instead of the statistical fallback, and the UI says so.

Requirements: pip install boto3 sagemaker
Costs: a few minutes of ml.m5.large training. Delete the endpoint after judging with --delete.
The training data is whatever is in the table, which for the demo is mostly labelled synthetic data.
"""
import argparse
import csv
import io
import json
import statistics
import time
from datetime import datetime, timezone

import boto3

p = argparse.ArgumentParser()
p.add_argument("--stack", default="punarnava")
p.add_argument("--region", default=None)
p.add_argument("--endpoint", default="punarnava-rcf")
p.add_argument("--realtime", action="store_true", help="Use an ml.t2.medium real-time endpoint instead of serverless")
p.add_argument("--delete", action="store_true", help="Delete the endpoint, endpoint config and model, then exit")
args = p.parse_args()

session = boto3.session.Session(region_name=args.region)
region = session.region_name
sm = session.client("sagemaker")
iam = session.client("iam")
s3 = session.client("s3")
cfn = session.client("cloudformation")
ddb = session.resource("dynamodb")

if args.delete:
    for fn, kw in [(sm.delete_endpoint, {"EndpointName": args.endpoint}),
                   (sm.delete_endpoint_config, {"EndpointConfigName": args.endpoint}),
                   (sm.delete_model, {"ModelName": args.endpoint})]:
        try:
            fn(**kw)
        except Exception as e:  # noqa: BLE001
            print("skip:", e)
    print("Deleted. Redeploy with SageMakerEndpoint='' to use the statistical fallback.")
    raise SystemExit(0)

outputs = {o["OutputKey"]: o["OutputValue"] for o in cfn.describe_stacks(StackName=args.stack)["Stacks"][0]["Outputs"]}
table = ddb.Table(outputs["TableName"])
bucket = outputs["PhotoBucket"]

# 1. Read COMP# aggregates
items, kw = [], {}
while True:
    r = table.scan(FilterExpression="begins_with(SK, :c)", ExpressionAttributeValues={":c": "COMP#"}, **kw)
    items += r["Items"]
    if "LastEvaluatedKey" not in r:
        break
    kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]
print(f"Read {len(items)} component aggregates")

# 2. Feature rows (same features the Lambda sends: count, prior median, ratio)
rows = []
for it in items:
    months = sorted((k[2:], int(v)) for k, v in it.items() if k.startswith("m_"))
    counts = [v for _, v in months]
    for i in range(3, len(counts)):
        prior = counts[max(0, i - 11):i]
        med = statistics.median(prior)
        rows.append([counts[i], med, counts[i] / med if med else counts[i]])
if len(rows) < 50:
    raise SystemExit("Not enough data to train. Load synthetic data from the admin page first.")
buf = io.StringIO()
csv.writer(buf).writerows(rows)
key = f"rcf/train-{int(time.time())}.csv"
s3.put_object(Bucket=bucket, Key=key, Body=buf.getvalue().encode())
print(f"Wrote {len(rows)} training rows to s3://{bucket}/{key}")

# Execution role for SageMaker
role_name = "punarnava-sagemaker-role"
try:
    role_arn = iam.get_role(RoleName=role_name)["Role"]["Arn"]
except iam.exceptions.NoSuchEntityException:
    role_arn = iam.create_role(RoleName=role_name, AssumeRolePolicyDocument=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Principal": {"Service": "sagemaker.amazonaws.com"}, "Action": "sts:AssumeRole"}],
    }))["Role"]["Arn"]
    iam.attach_role_policy(RoleName=role_name, PolicyArn="arn:aws:iam::aws:policy/AmazonSageMakerFullAccess")
    iam.put_role_policy(RoleName=role_name, PolicyName="bucket", PolicyDocument=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
                       "Resource": [f"arn:aws:s3:::{bucket}", f"arn:aws:s3:::{bucket}/*"]}],
    }))
    print("Created role, waiting for it to propagate...")
    time.sleep(15)

from sagemaker import image_uris  # noqa: E402

image = image_uris.retrieve("randomcutforest", region)
job = f"punarnava-rcf-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

# 3. Train
sm.create_training_job(
    TrainingJobName=job,
    AlgorithmSpecification={"TrainingImage": image, "TrainingInputMode": "File"},
    RoleArn=role_arn,
    InputDataConfig=[{
        "ChannelName": "train",
        "DataSource": {"S3DataSource": {"S3DataType": "S3Prefix", "S3Uri": f"s3://{bucket}/{key}", "S3DataDistributionType": "ShardedByS3Key"}},
        "ContentType": "text/csv;label_size=0",
    }],
    OutputDataConfig={"S3OutputPath": f"s3://{bucket}/rcf/output"},
    ResourceConfig={"InstanceType": "ml.m5.large", "InstanceCount": 1, "VolumeSizeInGB": 5},
    StoppingCondition={"MaxRuntimeInSeconds": 1800},
    HyperParameters={"feature_dim": "3", "num_trees": "50", "num_samples_per_tree": "128"},
)
print(f"Training {job} ...")
sm.get_waiter("training_job_completed_or_stopped").wait(TrainingJobName=job)
desc = sm.describe_training_job(TrainingJobName=job)
if desc["TrainingJobStatus"] != "Completed":
    raise SystemExit(f"Training failed: {desc.get('FailureReason')}")
artifacts = desc["ModelArtifacts"]["S3ModelArtifacts"]

# 4. Deploy (replace any previous model/endpoint of the same name)
for fn, kw in [(sm.delete_model, {"ModelName": args.endpoint}), (sm.delete_endpoint_config, {"EndpointConfigName": args.endpoint})]:
    try:
        fn(**kw)
    except Exception:  # noqa: BLE001
        pass
sm.create_model(ModelName=args.endpoint, ExecutionRoleArn=role_arn, PrimaryContainer={"Image": image, "ModelDataUrl": artifacts})
variant = {"VariantName": "main", "ModelName": args.endpoint}
if args.realtime:
    variant.update({"InstanceType": "ml.t2.medium", "InitialInstanceCount": 1})
else:
    variant["ServerlessConfig"] = {"MemorySizeInMB": 2048, "MaxConcurrency": 1}
sm.create_endpoint_config(EndpointConfigName=args.endpoint, ProductionVariants=[variant])
try:
    sm.describe_endpoint(EndpointName=args.endpoint)
    sm.update_endpoint(EndpointName=args.endpoint, EndpointConfigName=args.endpoint)
except sm.exceptions.ClientError:
    sm.create_endpoint(EndpointName=args.endpoint, EndpointConfigName=args.endpoint)
print("Creating endpoint (5-10 minutes) ...")
try:
    sm.get_waiter("endpoint_in_service").wait(EndpointName=args.endpoint)
except Exception as e:  # noqa: BLE001
    reason = sm.describe_endpoint(EndpointName=args.endpoint).get("FailureReason", str(e))
    raise SystemExit(f"Endpoint failed: {reason}\nIf serverless is not supported for this algorithm in your region, rerun with --realtime (and delete it after judging).")

# Smoke test with the same format the Lambda sends
rt = session.client("sagemaker-runtime")
r = rt.invoke_endpoint(EndpointName=args.endpoint, ContentType="text/csv", Accept="application/json", Body="2,2,1\n30,2,15\n")
print("Test scores:", json.loads(r["Body"].read()))
print(f"\nDone. Now run:\n  sam deploy --parameter-overrides SageMakerEndpoint={args.endpoint} DemoMode=true\n"
      f"Delete after judging:\n  python3 scripts/train_rcf.py --delete")
