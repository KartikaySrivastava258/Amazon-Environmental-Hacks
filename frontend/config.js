// Static fallback config. The local Build It server (backend/src/local/server.js) serves its own /config.js with
// mode "local". Served by a plain static server, this file runs the browser-only demo (apiUrl empty).
// The optional cloud deployment (cloud-optional/scripts/deploy-frontend.sh) overwrites it with stack outputs.
// Leave apiUrl empty to run the local demo mode (everything stays in this browser).
window.PUNARNAVA_CONFIG = {
  apiUrl: '',
  region: '',
  userPoolId: '',
  clientId: '',
  // true only when the stack has EnableCloudSpeech=true: Amazon Polly read-aloud (English, Hindi) and Amazon
  // Transcribe voice typing as a fallback when the phone has no voice. Browser voices work either way.
  cloudSpeech: false,
};
