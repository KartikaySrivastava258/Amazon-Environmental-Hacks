// Step Functions task Lambda. The state machine passes { task, jobId, ... }.
import { awsContext } from '../adapters/aws.js';
import { handle } from '../core/workflow.js';

const ctx = awsContext();
export const handler = async (event) => handle(ctx, event);
