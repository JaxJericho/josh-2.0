import crypto from "node:crypto";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const mode = (args.mode ?? process.env.TWILIO_REPLAY_MODE ?? "inbound").toLowerCase();
if (mode !== "inbound" && mode !== "status") {
  fail(`Invalid --mode '${mode}'. Use 'inbound' or 'status'.`);
}

const authToken = required("TWILIO_AUTH_TOKEN");

const url =
  args.url ??
  (mode === "inbound"
    ? process.env.TWILIO_INBOUND_URL ?? process.env.WEBHOOK_URL
    : process.env.TWILIO_STATUS_CALLBACK_URL ?? process.env.WEBHOOK_URL);

if (!url) {
  fail(
    mode === "inbound"
      ? "Missing target URL. Set --url or TWILIO_INBOUND_URL (or WEBHOOK_URL for legacy compatibility)."
      : "Missing target URL. Set --url or TWILIO_STATUS_CALLBACK_URL (or WEBHOOK_URL for legacy compatibility)."
  );
}

const signatureUrl = args.signatureUrl ?? process.env.SIGNATURE_URL ?? url;
const forwardedHost = args.forwardedHost ?? process.env.FORWARDED_HOST;
const forwardedProto = args.forwardedProto ?? process.env.FORWARDED_PROTO;

const from = args.from ?? process.env.FROM_E164 ?? "+15555550111";
const to = args.to ?? process.env.TO_E164 ?? "+15555550222";
const body = args.body ?? process.env.BODY ?? "hello";
const messageSid =
  args.messageSid ??
  process.env.MESSAGE_SID ??
  `SM${Date.now().toString().padStart(32, "0").slice(-32)}`;
const numMedia = args.numMedia ?? process.env.NUM_MEDIA ?? "0";
const messageStatus = args.messageStatus ?? process.env.MESSAGE_STATUS ?? "sent";

const expectedStatus = parseExpectedStatus(args.expectStatus ?? process.env.EXPECT_STATUS ?? "200");
const unsigned = Boolean(args.unsigned);

const params =
  mode === "inbound"
    ? new URLSearchParams({
        From: from,
        To: to,
        Body: body,
        MessageSid: messageSid,
        NumMedia: numMedia,
      })
    : new URLSearchParams({
        MessageSid: messageSid,
        MessageStatus: messageStatus,
      });

const signature = computeSignature(signatureUrl, params, authToken);

const headers = {
  "content-type": "application/x-www-form-urlencoded",
  ...(unsigned ? {} : { "x-twilio-signature": signature }),
  ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
  ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
};

const response = await fetch(url, {
  method: "POST",
  headers,
  body: params.toString(),
});

const responseText = await response.text();
const pass = response.status === expectedStatus;

console.log(
  `[twilio-replay] mode=${mode} unsigned=${unsigned} status=${response.status} expected=${expectedStatus} pass=${pass}`
);
console.log(`[twilio-replay] url=${url}`);
console.log(`[twilio-replay] signature_url=${signatureUrl}`);
console.log(`[twilio-replay] body=${truncate(responseText, 400)}`);

if (!pass) {
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--unsigned":
        parsed.unsigned = true;
        break;
      case "--mode":
        parsed.mode = readValue(argv, ++i, arg);
        break;
      case "--url":
        parsed.url = readValue(argv, ++i, arg);
        break;
      case "--signature-url":
        parsed.signatureUrl = readValue(argv, ++i, arg);
        break;
      case "--forwarded-host":
        parsed.forwardedHost = readValue(argv, ++i, arg);
        break;
      case "--forwarded-proto":
        parsed.forwardedProto = readValue(argv, ++i, arg);
        break;
      case "--from":
        parsed.from = readValue(argv, ++i, arg);
        break;
      case "--to":
        parsed.to = readValue(argv, ++i, arg);
        break;
      case "--body":
        parsed.body = readValue(argv, ++i, arg);
        break;
      case "--message-sid":
        parsed.messageSid = readValue(argv, ++i, arg);
        break;
      case "--num-media":
        parsed.numMedia = readValue(argv, ++i, arg);
        break;
      case "--message-status":
        parsed.messageStatus = readValue(argv, ++i, arg);
        break;
      case "--expect-status":
        parsed.expectStatus = readValue(argv, ++i, arg);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readValue(argv, index, argName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${argName}`);
  }
  return value;
}

function parseExpectedStatus(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 100 || parsed > 599) {
    fail(`Invalid expected status '${value}'.`);
  }
  return parsed;
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing ${name}`);
  }
  return value;
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

  return crypto.createHmac("sha1", token).update(base).digest("base64");
}

function truncate(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function fail(message) {
  console.error(`[twilio-replay] ERROR: ${message}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: TWILIO_AUTH_TOKEN=... node scripts/verify/twilio_inbound_replay.mjs [options]

Options:
  --mode inbound|status       Request shape to send (default: inbound)
  --url URL                   Target webhook URL (required unless env provides one)
  --signature-url URL         Canonical URL used for Twilio signature base string
  --unsigned                  Omit x-twilio-signature header (negative test)
  --expect-status CODE        Expected HTTP status (default: 200)
  --forwarded-host HOST       Optional x-forwarded-host override
  --forwarded-proto PROTO     Optional x-forwarded-proto override
  --from E164                 Inbound From number (default +15555550111)
  --to E164                   Inbound To number (default +15555550222)
  --body TEXT                 Inbound Body (default hello)
  --message-sid SID           Twilio MessageSid payload field
  --num-media N               Inbound NumMedia (default 0)
  --message-status STATUS     Status callback MessageStatus (default sent)
  --help                      Show this help

Env fallbacks:
  TWILIO_AUTH_TOKEN, TWILIO_INBOUND_URL, TWILIO_STATUS_CALLBACK_URL,
  WEBHOOK_URL (legacy), SIGNATURE_URL, FORWARDED_HOST, FORWARDED_PROTO,
  FROM_E164, TO_E164, BODY, MESSAGE_SID, NUM_MEDIA, MESSAGE_STATUS, EXPECT_STATUS
`);
}
