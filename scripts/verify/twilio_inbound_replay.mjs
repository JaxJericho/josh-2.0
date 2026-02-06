import crypto from "node:crypto";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

const authToken = required("TWILIO_AUTH_TOKEN");
const url = process.env.WEBHOOK_URL ??
  "http://127.0.0.1:54321/functions/v1/twilio-inbound";
const signatureUrl = process.env.SIGNATURE_URL ?? url;
const forwardedHost = process.env.FORWARDED_HOST;
const forwardedProto = process.env.FORWARDED_PROTO;
const from = process.env.FROM_E164 ?? "+15555550111";
const to = process.env.TO_E164 ?? "+15555550222";
const body = process.env.BODY ?? "hello";
const messageSid = process.env.MESSAGE_SID ?? "SM00000000000000000000000000000001";
const numMedia = process.env.NUM_MEDIA ?? "0";

const params = new URLSearchParams({
  From: from,
  To: to,
  Body: body,
  MessageSid: messageSid,
  NumMedia: numMedia,
});

const signature = computeSignature(signatureUrl, params, authToken);

await sendOnce("first");
await sendOnce("second");

async function sendOnce(label) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
      ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
      ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
    },
    body: params.toString(),
  });

  const text = await response.text();
  console.log(`${label} status=${response.status} body=${text}`);
}

function computeSignature(targetUrl, searchParams, token) {
  const keys = Array.from(new Set(searchParams.keys())).sort();
  let base = targetUrl;
  for (const key of keys) {
    const values = searchParams.getAll(key);
    for (const value of values) {
      base += key + value;
    }
  }

  return crypto
    .createHmac("sha1", token)
    .update(base)
    .digest("base64");
}
