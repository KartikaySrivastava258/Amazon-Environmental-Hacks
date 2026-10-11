// Authentication. Live: Amazon Cognito user pool (USER_PASSWORD_AUTH over HTTPS, no SDK needed).
// Demo: pick a persona.
import { isLive, isLocal, config, PERSONAS, setAuthProvider } from './api.js';
import { t, errorText } from './i18n.js';

const KEY = 'pn-auth';
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const listeners = new Set();
export const onAuthChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());
const persist = () => { try { if (session) localStorage.setItem(KEY, JSON.stringify(session)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

function decode(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

// Cognito error type → message key. The pre-sign-up Lambda's role check maps to the server key err.signupRole.
const COGNITO_ERRORS = {
  NotAuthorizedException: 'shell.auth.wrong',
  UserNotFoundException: 'shell.auth.wrong',
  UsernameExistsException: 'shell.auth.exists',
  InvalidPasswordException: 'shell.auth.weakPassword',
  InvalidParameterException: 'shell.auth.badInput',
  TooManyRequestsException: 'shell.auth.tooMany',
  TooManyFailedAttemptsException: 'shell.auth.tooMany',
  LimitExceededException: 'shell.auth.tooMany',
};

async function cognito(target, body) {
  let r;
  try {
    r = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error(t('shell.err.network')), { status: 0, code: 'network' });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const type = String(data.__type || '').split('#').pop();
    const serverMessage = String(data.message || '');
    // The pre-sign-up trigger rejects an unknown role (backend/src/handlers/auth.js).
    if (type === 'UserLambdaValidationException' && /choose technician/i.test(serverMessage)) {
      throw Object.assign(new Error(errorText({ code: 'signupRole' })), { status: r.status, code: 'signupRole', serverMessage, type });
    }
    throw Object.assign(new Error(t(COGNITO_ERRORS[type] || 'shell.auth.failed')), { status: r.status, serverMessage, type });
  }
  return data;
}

function store(result, refreshToken) {
  const claims = decode(result.IdToken);
  session = {
    idToken: result.IdToken,
    refreshToken: refreshToken || result.RefreshToken,
    exp: claims.exp * 1000,
    userId: claims.sub,
    email: claims.email,
    role: (claims['cognito:groups'] || []).includes('admin') ? 'admin' : claims['custom:role'],
    groups: claims['cognito:groups'] || [],
  };
  persist();
  emit();
}

// ── Local Build It accounts (backend/src/local/server.js): no Cognito, sessions signed by the local server ──
const LOCAL_ERRORS = { wrongLogin: 'shell.auth.wrong', accountExists: 'shell.auth.exists', weakPassword: 'shell.auth.weakPassword', badEmail: 'shell.auth.badInput' };
async function localAuth(path, body) {
  let r;
  try { r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw Object.assign(new Error(t('shell.err.network')), { status: 0, code: 'network' }); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.code === 'signupRole' ? errorText({ code: 'signupRole' }) : t(LOCAL_ERRORS[data.code] || 'shell.auth.failed');
    throw Object.assign(new Error(msg), { status: r.status, code: data.code });
  }
  session = { local: true, token: data.token, exp: data.exp, userId: data.userId, role: data.role, groups: data.groups || [] };
  persist();
  emit();
}

export async function signIn(email, password) {
  if (isLocal()) return localAuth('/local/login', { email, password });
  const r = await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: config.clientId, AuthParameters: { USERNAME: email.trim(), PASSWORD: password } });
  store(r.AuthenticationResult);
}

export async function signUp({ email, password, name, role, brandId }) {
  if (isLocal()) return localAuth('/local/signup', { email, password, name, role, brandId: role === 'brand' ? brandId : undefined });
  const attrs = [{ Name: 'email', Value: email.trim() }, { Name: 'name', Value: name.trim() }, { Name: 'custom:role', Value: role }];
  if (role === 'brand' && brandId) attrs.push({ Name: 'custom:brandId', Value: brandId });
  await cognito('SignUp', { ClientId: config.clientId, Username: email.trim(), Password: password, UserAttributes: attrs });
  await signIn(email, password);
}

async function refresh() {
  if (!session?.refreshToken) return null;
  try {
    const r = await cognito('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: config.clientId, AuthParameters: { REFRESH_TOKEN: session.refreshToken } });
    store(r.AuthenticationResult, session.refreshToken);
    return session.idToken;
  } catch {
    signOut();
    return null;
  }
}

export function signOut() { session = null; persist(); emit(); }
/** Sign in as a persona. Local mode asks the server for a session; demo mode needs none. Returns a promise. */
export async function demoSignIn(userId) {
  if (isLocal()) return localAuth('/local/session', { userId });
  const p = PERSONAS.find((x) => x.userId === userId);
  session = { demo: true, userId: p.userId, role: p.role, name: p.name };
  persist();
  emit();
}
export const currentSession = () => session;

setAuthProvider({
  demoUser: () => (!isLive() && session?.demo ? PERSONAS.find((p) => p.userId === session.userId) : null),
  async idToken() {
    if (session?.local) {
      if (!(session.exp > Date.now() + 60000)) { signOut(); return null; }
      return session.token;
    }
    if (!session?.idToken) return null;
    if (Date.now() > session.exp - 60000) return refresh();
    return session.idToken;
  },
  expired() { signOut(); },
});

// A stale live session should not survive a switch to demo mode (or the reverse).
const modeNow = isLocal() ? 'local' : isLive() ? 'cloud' : 'demo';
const modeOf = (s) => (s.local ? 'local' : s.demo ? 'demo' : 'cloud');
if (session && modeOf(session) !== modeNow) { session = null; persist(); }
