// Cognito triggers.
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { awsContext } from '../adapters/aws.js';
import { ensureProfile } from '../core/api.js';

const SIGNUP_ROLES = ['technician', 'collector', 'recycler', 'brand'];
const cognito = new CognitoIdentityProviderClient({});
const ctx = awsContext();

// Auto-confirm so a judge can sign up and use the app immediately. Admin role cannot be self-assigned.
export const preSignUp = async (event) => {
  const role = event.request.userAttributes['custom:role'];
  if (!SIGNUP_ROLES.includes(role)) throw new Error('Choose technician, collector, recycler or brand');
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) event.response.autoVerifyEmail = true;
  return event;
};

export const postConfirmation = async (event) => {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;
  const attrs = event.request.userAttributes;
  const role = SIGNUP_ROLES.includes(attrs['custom:role']) ? attrs['custom:role'] : 'technician';
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: event.userPoolId, Username: event.userName, GroupName: role }));
  await ensureProfile(ctx, { userId: attrs.sub, claims: attrs });
  return event;
};
