// AWS implementation of the core ports. Only this file talks to AWS SDKs.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SageMakerRuntimeClient, InvokeEndpointCommand } from '@aws-sdk/client-sagemaker-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CognitoIdentityProviderClient, AdminDisableUserCommand, AdminEnableUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, DeleteTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { POLLY_VOICES, TRANSCRIBE_CODES, CLIP_PREFIX, ttsKey } from '../core/speech.js';

const env = process.env;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = env.TABLE;

import { createDynamoStore, ConditionFailed } from './dynamo.js';
export const store = createDynamoStore(ddb, TABLE);
export { ConditionFailed };

const sfn = new SFNClient({});
const eb = new EventBridgeClient({});
const scheduler = new SchedulerClient({});
const sns = new SNSClient({});
const s3 = new S3Client({});
const sm = new SageMakerRuntimeClient({});
const lambda = new LambdaClient({});
const cognito = new CognitoIdentityProviderClient({});
const polly = new PollyClient({});
const transcribe = new TranscribeClient({});

// Voices this account/region refused (e.g. no neural engine): skipped for the life of the container.
const badVoice = new Set();
const VOICE_FALLBACK_ERRORS = new Set(['EngineNotSupportedException', 'LanguageNotSupportedException', 'ValidationException', 'InvalidSampleRateException']);
async function s3Exists(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: env.BUCKET, Key: key })); return true; } catch (e) {
    const code = e.$metadata?.httpStatusCode;
    if (e.name === 'NotFound' || code === 404 || code === 403) return false; // 403 when the role lacks s3:ListBucket
    throw e;
  }
}

const atExpr = (ms) => `at(${new Date(ms).toISOString().slice(0, 19)})`;

export const svc = {
  workflow: {
    async start(input) {
      const r = await sfn.send(new StartExecutionCommand({ stateMachineArn: env.STATE_MACHINE_ARN, name: `${input.jobId}-${Date.now()}`, input: JSON.stringify(input) }));
      return r.executionArn;
    },
    async sendSuccess(token, output) {
      await sfn.send(new SendTaskSuccessCommand({ taskToken: token, output: JSON.stringify(output) }));
    },
  },
  scheduler: {
    async at(name, whenMs, payload) {
      const params = {
        Name: name, GroupName: 'default', ScheduleExpression: atExpr(whenMs), ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
        Target: { Arn: env.SCHEDULED_FN_ARN, RoleArn: env.SCHEDULER_ROLE_ARN, Input: JSON.stringify(payload) },
      };
      try { await scheduler.send(new CreateScheduleCommand(params)); } catch (e) {
        if (e.name !== 'ConflictException') throw e;
        await this.cancel(name);
        await scheduler.send(new CreateScheduleCommand(params));
      }
    },
    async cancel(name) {
      try { await scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: 'default' })); } catch (e) {
        if (e.name !== 'ResourceNotFoundException') throw e;
      }
    },
  },
  events: {
    async emit(type, detail) {
      const r = await eb.send(new PutEventsCommand({ Entries: [{ EventBusName: env.BUS, Source: 'punarnava', DetailType: type, Detail: JSON.stringify(detail) }] }));
      if (r.FailedEntryCount) console.error('PutEvents failed', JSON.stringify(r.Entries));
    },
  },
  notify: {
    async publish(subject, message) {
      if (!env.TOPIC_ARN) return;
      await sns.send(new PublishCommand({ TopicArn: env.TOPIC_ARN, Subject: subject.slice(0, 99), Message: message }));
    },
    async sms(phone, message) {
      if (env.ENABLE_SMS !== 'true') return;
      await sns.send(new PublishCommand({
        PhoneNumber: `+91${phone}`, Message: message,
        MessageAttributes: { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } },
      }));
    },
  },
  files: {
    async presignPut(key, contentType) {
      return getSignedUrl(s3, new PutObjectCommand({ Bucket: env.BUCKET, Key: key, ContentType: contentType }), { expiresIn: 300 });
    },
    async presignGet(key) {
      if (!key || !key.startsWith('uploads/')) return null;
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.BUCKET, Key: key }), { expiresIn: 3600 });
    },
  },
  // Amazon Polly (en, hi) and Amazon Transcribe batch (en, hi, mr, bn, ta). Off unless SPEECH_ENABLED=true.
  speech: {
    configured: env.SPEECH_ENABLED === 'true',
    voices: Object.fromEntries(Object.entries(POLLY_VOICES).map(([l, v]) => [l, v.map((x) => `${x.voice} (${x.engine})`)])),
    // Cached in s3://BUCKET/tts/<lang>/<voice>/<engine>/<sha256>.mp3 (lifecycle: 90 days). HeadObject first.
    async synthesize({ text, lang }) {
      for (const v of POLLY_VOICES[lang] || []) {
        const id = `${v.voice}/${v.engine}/${v.code}`;
        if (badVoice.has(id)) continue;
        const key = await ttsKey({ lang, voice: v.voice, engine: v.engine, text });
        if (await s3Exists(key)) return { key, cached: true, voice: v.voice, engine: v.engine };
        let audio;
        try {
          const r = await polly.send(new SynthesizeSpeechCommand({ Engine: v.engine, VoiceId: v.voice, LanguageCode: v.code, OutputFormat: 'mp3', TextType: 'text', Text: text }));
          audio = await r.AudioStream.transformToByteArray();
        } catch (e) {
          if (!VOICE_FALLBACK_ERRORS.has(e.name)) throw e;
          console.warn('polly voice unavailable, trying the next one', id, e.name);
          badVoice.add(id);
          continue;
        }
        await s3.send(new PutObjectCommand({ Bucket: env.BUCKET, Key: key, Body: audio, ContentType: 'audio/mpeg', CacheControl: 'private, max-age=31536000, immutable' }));
        return { key, cached: false, voice: v.voice, engine: v.engine };
      }
      return null;
    },
    async presignAudio(key) {
      if (!key || !key.startsWith('tts/')) return null;
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.BUCKET, Key: key }), { expiresIn: 3600 });
    },
    // No OutputBucketName: Transcribe keeps the transcript in its own bucket and returns a 15-minute link, so the
    // role needs no write access for results and nothing is left in our bucket. The job is deleted once read.
    async startTranscription({ key, lang, languageCode, jobName, mediaFormat }) {
      await transcribe.send(new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName, LanguageCode: languageCode || TRANSCRIBE_CODES[lang], MediaFormat: mediaFormat,
        Media: { MediaFileUri: `s3://${env.BUCKET}/${key}` },
      }));
    },
    async getTranscription(jobName) {
      let job;
      try { job = (await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }))).TranscriptionJob; } catch (e) {
        if (e.name === 'NotFoundException' || e.name === 'BadRequestException') return { status: 'FAILED', text: '' };
        throw e;
      }
      const status = job?.TranscriptionJobStatus || 'IN_PROGRESS';
      if (status !== 'COMPLETED' && status !== 'FAILED') return { status, text: '' };
      let text = '';
      if (status === 'COMPLETED') {
        const res = await fetch(job.Transcript.TranscriptFileUri);
        if (!res.ok) throw new Error(`transcript fetch ${res.status}`);
        const json = await res.json();
        text = (json.results?.transcripts || []).map((t) => t.transcript).join(' ').trim();
      } else {
        console.warn('transcription failed', jobName, job.FailureReason); // the reason never contains what was said
      }
      try { await transcribe.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName })); } catch (e) { console.warn('could not delete transcription job', jobName, e.name); }
      return { status, text };
    },
    async discard(key) {
      if (!key || !key.startsWith(CLIP_PREFIX)) return;
      await s3.send(new DeleteObjectCommand({ Bucket: env.BUCKET, Key: key }));
    },
  },
  metrics: {
    emit(name, value) {
      if (!Number.isFinite(value)) return;
      console.log(JSON.stringify({
        _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: 'Punarnava', Dimensions: [['Service']], Metrics: [{ Name: name, Unit: 'Count' }] }] },
        Service: 'punarnava', [name]: value,
      }));
    },
  },
  ml: {
    configured: !!env.SAGEMAKER_ENDPOINT,
    async scoreRcf(rows) {
      const body = rows.map((r) => r.join(',')).join('\n');
      const r = await sm.send(new InvokeEndpointCommand({ EndpointName: env.SAGEMAKER_ENDPOINT, ContentType: 'text/csv', Accept: 'application/json', Body: body }));
      const parsed = JSON.parse(Buffer.from(r.Body).toString('utf8'));
      return (parsed.scores || []).map((s) => Number(s.score));
    },
  },
  users: {
    async setEnabled(userId, enabled) {
      if (!env.USER_POOL_ID) return;
      const Cmd = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
      await cognito.send(new Cmd({ UserPoolId: env.USER_POOL_ID, Username: userId }));
    },
  },
  async: {
    async invoke(fn, payload, { wait = false } = {}) {
      const name = { seed: env.SEED_FN, anomaly: env.ANOMALY_FN }[fn];
      const r = await lambda.send(new InvokeCommand({ FunctionName: name, InvocationType: wait ? 'RequestResponse' : 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
      if (!wait) return { accepted: true, note: 'Running in the background. Refresh in a minute.' };
      if (r.FunctionError) throw new Error(`${fn} failed`);
      return JSON.parse(Buffer.from(r.Payload).toString('utf8'));
    },
  },
};

export function awsContext() {
  return {
    store,
    svc,
    now: () => Date.now(),
    config: {
      demoMode: env.DEMO_MODE === 'true',
      reminderMinutes: Number(env.REMINDER_MINUTES || 2),
      followupMinutes: Number(env.FOLLOWUP_MINUTES || 5),
      enableSms: env.ENABLE_SMS === 'true',
      appUrl: env.APP_URL || '',
    },
  };
}
