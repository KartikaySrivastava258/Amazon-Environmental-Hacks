// Asynchronous consumers: SQS queues, EventBridge rules, EventBridge Scheduler targets, cron.
import { awsContext } from '../adapters/aws.js';
import * as consumers from '../core/consumers.js';

const ctx = awsContext();

// SQS (analytics queue): EventBridge events → aggregates + impact counters.
export const aggregator = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const e = JSON.parse(record.body);
      await consumers.aggregate(ctx, { type: e['detail-type'], detail: e.detail });
    } catch (err) {
      console.error('aggregate failed', err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

// SQS (pickup queue): notify collectors in the area.
export const pickupDispatcher = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try { await consumers.pickupDispatcher(ctx, JSON.parse(record.body).detail); }
    catch (err) { console.error(err); batchItemFailures.push({ itemIdentifier: record.messageId }); }
  }
  return { batchItemFailures };
};

// EventBridge rule (part.listed): notify technicians with matching saved searches.
export const partMatcher = async (event) => consumers.partMatcher(ctx, event.detail);

// EventBridge Scheduler one-time schedules: owner reminder, 30-day follow-up.
export const scheduled = async (event) => consumers.scheduled(ctx, event);

// Nightly cron and admin "run now": failure-spike detection (SageMaker RCF or fallback).
export const anomaly = async () => consumers.anomaly(ctx);

// Admin: load labelled synthetic data for the dashboard.
export const seed = async (event) => consumers.seed(ctx, event || {});
