import { z } from "zod";
import path from "node:path";

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("PP Studio"),
    NEXT_PUBLIC_APP_URL: z.url(),
    NEXT_PUBLIC_SITE_URL: z.url().optional(),
    NEXT_PUBLIC_SITE_DOMAIN: z.string().trim().min(1).optional(),
    VOUCHER_PUBLIC_DOMAIN: z.string().trim().min(1).optional(),
    NEXT_PUBLIC_MATOMO_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    NEXT_PUBLIC_CLARITY_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    NEXT_PUBLIC_META_PIXEL_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    NEXT_PUBLIC_GOOGLE_ADS_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    NEXT_PUBLIC_WEB_VITALS_ENABLED: z.enum(["true", "false"]).optional().default("true"),
    NEXT_PUBLIC_CLARITY_PROJECT_ID: z.string().trim().optional(),
    NEXT_PUBLIC_META_PIXEL_ID: z.string().trim().optional(),
    NEXT_PUBLIC_GOOGLE_ADS_ID: z.string().trim().optional(),
    NEXT_PUBLIC_MATOMO_URL: z.url().optional(),
    NEXT_PUBLIC_MATOMO_SITE_ID: z.string().trim().min(1).optional(),
    MATOMO_URL: z.string().trim().optional(),
    MATOMO_SITE_ID: z.string().trim().optional(),
    MATOMO_AUTH_TOKEN: z.string().trim().optional(),
    PUSHOVER_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    PUSHOVER_APP_TOKEN: z.string().trim().optional(),
    DATABASE_URL: z.string().min(1),
    ADMIN_SESSION_SECRET: z.string().min(32),
    ADMIN_OWNER_EMAIL: z.email(),
    EMAIL_DELIVERY_MODE: z.enum(["log", "background"]).default("log"),
    EMAIL_TRANSPORT: z.enum(["smtp", "resend"]).default("smtp"),
    SMTP_HOST: z.string().trim().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
    SMTP_USER: z.string().trim().optional(),
    SMTP_PASSWORD: z.string().trim().optional(),
    SMTP_FROM_EMAIL: z.email().optional(),
    SMTP_FROM_NAME: z.string().trim().min(1).default("PP Studio"),
    SMTP_REPLY_TO: z.email().optional(),
    RESEND_API_KEY: z.string().trim().optional(),
    RESEND_WEBHOOK_SECRET: z.string().trim().optional(),
    MEDIA_STORAGE_ROOT: z.string().trim().optional(),
    SITE_SETTINGS_SNAPSHOT_PATH: z.string().trim().optional(),
  })
  .superRefine((env, context) => {
    if (env.EMAIL_DELIVERY_MODE !== "background") {
      return;
    }

    const requiredFields =
      env.EMAIL_TRANSPORT === "smtp"
        ? ([
            ["SMTP_HOST", env.SMTP_HOST],
            ["SMTP_PORT", env.SMTP_PORT],
            ["SMTP_USER", env.SMTP_USER],
            ["SMTP_PASSWORD", env.SMTP_PASSWORD],
            ["SMTP_FROM_EMAIL", env.SMTP_FROM_EMAIL],
          ] as const)
        : ([["RESEND_API_KEY", env.RESEND_API_KEY]] as const);

    for (const [field, value] of requiredFields) {
      if (value === undefined || value === "") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} je povinné, když EMAIL_DELIVERY_MODE=background.`,
        });
      }
    }
  });

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables.");
}

export const env = parsed.data;

if (env.NODE_ENV === "production" && env.EMAIL_DELIVERY_MODE === "background" && env.EMAIL_TRANSPORT === "smtp") {
  console.warn(
    "EMAIL_TRANSPORT=smtp provides at-least-once delivery only; Resend REST is required for provider-side idempotency.",
  );
}

export const mediaStorageRoot =
  env.MEDIA_STORAGE_ROOT && env.MEDIA_STORAGE_ROOT.length > 0
    ? path.resolve(env.MEDIA_STORAGE_ROOT)
    : path.resolve("/var/www/ppstudio/uploads");

export const siteSettingsSnapshotPath =
  env.SITE_SETTINGS_SNAPSHOT_PATH && env.SITE_SETTINGS_SNAPSHOT_PATH.length > 0
    ? path.resolve(env.SITE_SETTINGS_SNAPSHOT_PATH)
    : path.resolve("/var/lib/ppstudio/site-settings-snapshot.json");
