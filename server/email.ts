import { createHmac, timingSafeEqual } from "node:crypto";

export class EmailError extends Error {
  constructor(
    public readonly code:
      "disabled" | "configuration" | "unavailable" | "invalid_response",
  ) {
    super(`Email delivery ${code}`);
    this.name = "EmailError";
  }
}

/** Custom gateway protocol: HMAC-SHA256 over "UNIX_SECONDS." followed by exact request bytes. */
export function verifyInbound(
  raw: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !/^\d{10}$/.test(timestamp) || !Buffer.isBuffer(raw))
    return false;
  const seconds = Number(timestamp);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300
  )
    return false;
  const hex = signature.replace(/^sha256=/, "");
  if (!/^[a-f\d]{64}$/i.test(hex)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest();
  return timingSafeEqual(expected, Buffer.from(hex, "hex"));
}

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  threadId?: string;
  idempotencyKey?: string;
}

/** Retries belong to the durable outbox, not the HTTP handler. Never log message bodies or recipients. */
export async function sendEmail(input: EmailInput): Promise<{ id: string }> {
  const provider = process.env.EMAIL_PROVIDER || "disabled";
  if (provider === "disabled") throw new EmailError("disabled");
  if (
    provider !== "resend" ||
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM
  ) {
    throw new EmailError("configuration");
  }
  if (/\r|\n/.test(input.to + input.subject + (input.threadId || "")))
    throw new EmailError("configuration");
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey
          ? { "Idempotency-Key": input.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.threadId
          ? {
              headers: {
                "In-Reply-To": input.threadId,
                References: input.threadId,
              },
            }
          : {}),
      }),
    });
    if (!result.ok) throw new EmailError("unavailable");
    const data = (await result.json()) as { id?: unknown };
    if (typeof data.id !== "string" || data.id.length > 500)
      throw new EmailError("invalid_response");
    return { id: data.id };
  } catch (error) {
    if (error instanceof EmailError) throw error;
    throw new EmailError("unavailable");
  }
}
