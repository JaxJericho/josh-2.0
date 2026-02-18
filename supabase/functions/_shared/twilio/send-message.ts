export type TwilioRestSendInput = {
  accountSid: string;
  authToken: string;
  idempotencyKey: string;
  to: string;
  from: string;
  body: string;
  messagingServiceSid: string | null;
  statusCallbackUrl: string | null;
};

export type TwilioRestSendResult =
  | {
      ok: true;
      sid: string;
      status: string | null;
      from: string | null;
    }
  | {
      ok: false;
      retryable: boolean;
      errorMessage: string;
    };

export async function sendTwilioRestMessage(
  input: TwilioRestSendInput,
): Promise<TwilioRestSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Messages.json`;
  const payload = new URLSearchParams();
  payload.set("To", input.to);
  payload.set("Body", input.body);

  if (input.messagingServiceSid) {
    payload.set("MessagingServiceSid", input.messagingServiceSid);
  } else {
    payload.set("From", input.from);
  }

  if (input.statusCallbackUrl) {
    payload.set("StatusCallback", input.statusCallbackUrl);
  }

  const auth = btoa(`${input.accountSid}:${input.authToken}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Idempotency-Key": input.idempotencyKey,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const errorCode = json?.code ? `code=${json.code}` : null;
      const errorMessage = json?.message ?? response.statusText;
      const retryable = isRetryableStatus(response.status);
      return {
        ok: false,
        retryable,
        errorMessage: [errorCode, errorMessage].filter(Boolean).join(" "),
      };
    }

    const sid = json?.sid as string | undefined;
    if (!sid) {
      return {
        ok: false,
        retryable: false,
        errorMessage: "Twilio response missing sid",
      };
    }

    return {
      ok: true,
      sid,
      status: json?.status ?? null,
      from: (json?.from as string | undefined) ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      errorMessage: (error as Error)?.message ?? "Twilio request failed",
    };
  }
}

export function resolveTwilioStatusCallbackUrl(params: {
  explicitUrl: string | null;
  projectRef: string | null;
}): string | null {
  if (params.explicitUrl) {
    return params.explicitUrl;
  }

  if (!params.projectRef) {
    return null;
  }

  return `https://${params.projectRef}.supabase.co/functions/v1/twilio-status-callback`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
