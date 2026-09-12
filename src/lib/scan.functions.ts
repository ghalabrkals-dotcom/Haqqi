import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  /** data:image/...;base64,... */
  image: z.string().min(32).max(12_000_000),
});

export type ScanResult = {
  owed_by: string | null;
  amount: number | null;
  currency: string | null;
  type: string | null;
  date_owed: string | null;
  expected_return_type: "exact_date" | "business_days" | "unknown";
  expected_date: string | null;
  min_business_days: number | null;
  max_business_days: number | null;
  reference_number: string | null;
};

const TYPES = [
  "Refund",
  "Deposit",
  "Cancelled Order",
  "Failed / Reversed Transaction",
  "Duplicate Charge",
  "Travel / Ticket Refund",
  "Merchant Dispute",
  "Money Owed by Someone",
  "Other",
];

const SYSTEM = `You read screenshots and confirmations about money a person is waiting to receive back.
Extract ONLY what is clearly visible. Never guess or invent amounts, dates, merchants, currencies or reference numbers.
Use null for anything not clearly stated.
Return strict JSON with these keys:
owed_by (merchant or person name), amount (number), currency (ISO code such as KWD, USD, EUR, GBP, SAR, AED),
type (one of: ${TYPES.join(", ")}),
date_owed (YYYY-MM-DD, the date the money became owed),
expected_return_type ("exact_date" if a specific return date is stated, "business_days" if a business-day range is stated, otherwise "unknown"),
expected_date (YYYY-MM-DD or null), min_business_days (number or null), max_business_days (number or null),
reference_number (order or reference number or null).
If only a single business-day figure is given, use it for both min and max.`;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;

export const scanMoneyOwed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<ScanResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI_UNAVAILABLE");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the receivable details as JSON." },
              { type: "image_url", image_url: { url: data.image } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      if (res.status === 402) throw new Error("AI_CREDITS");
      if (res.status === 429) throw new Error("AI_BUSY");
      throw new Error("AI_UNAVAILABLE");
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI_UNREADABLE");

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      throw new Error("AI_UNREADABLE");
    }

    const typeRaw = str(raw["type"]);
    const typeValue = typeRaw
      ? (TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase()) ?? null)
      : null;
    const returnType = str(raw["expected_return_type"]);

    return {
      owed_by: str(raw["owed_by"]),
      amount: num(raw["amount"]),
      currency: str(raw["currency"])?.toUpperCase() ?? null,
      type: typeValue,
      date_owed: str(raw["date_owed"]),
      expected_return_type:
        returnType === "exact_date" || returnType === "business_days" ? returnType : "unknown",
      expected_date: str(raw["expected_date"]),
      min_business_days: num(raw["min_business_days"]),
      max_business_days: num(raw["max_business_days"]),
      reference_number: str(raw["reference_number"]),
    };
  });
