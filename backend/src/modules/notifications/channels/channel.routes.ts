import { Router } from "express";
import { z } from "zod";
import { validate } from "../../../shared/validate.middleware.js";
import { EncryptedChannelRegistry } from "./channel-registry.js";
import {
  ALL_NOTIFICATION_EVENT_TYPES,
  type ChannelSecrets,
  type NotificationEventType,
  type PreferenceMatrix,
} from "./channel.types.js";

const channelTypeSchema = z.enum(["email", "telegram", "discord"]);

const channelSecretsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("email"),
    to: z.string().email("valid email recipient is required"),
    from: z.string().email().optional(),
    smtpUrl: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(10, "botToken is required"),
    chatId: z.string().min(1, "chatId is required"),
  }),
  z.object({
    type: z.literal("discord"),
    webhookUrl: z.string().url("webhookUrl must be a valid URL"),
  }),
]);

const registerChannelBodySchema = z.object({
  userId: z.string().min(1, "userId is required"),
  vaultId: z.string().min(1, "vaultId is required"),
  type: channelTypeSchema,
  label: z.string().min(1).max(100),
  secrets: channelSecretsSchema,
});

const piiRedactionSchema = z
  .object({
    redactEmails: z.boolean().optional(),
    redactAddresses: z.boolean().optional(),
    redactAmounts: z.boolean().optional(),
    redactMemo: z.boolean().optional(),
  })
  .optional();

const eventPreferenceRuleSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(channelTypeSchema),
  piiRedaction: piiRedactionSchema,
});

const eventTypeEnum = z.enum(
  ALL_NOTIFICATION_EVENT_TYPES as unknown as [
    NotificationEventType,
    ...NotificationEventType[],
  ]
);

const setPreferencesBodySchema = z.object({
  userId: z.string().min(1, "userId is required"),
  vaultId: z.string().min(1, "vaultId is required"),
  preferences: z.record(eventTypeEnum, eventPreferenceRuleSchema),
});

export function createChannelRegistryRouter(
  registry: EncryptedChannelRegistry = new EncryptedChannelRegistry()
) {
  const router = Router();

  router.post(
    "/channels",
    validate(registerChannelBodySchema),
    async (req, res) => {
      try {
        const { userId, vaultId, type, label, secrets } = req.body as {
          userId: string;
          vaultId: string;
          type: "email" | "telegram" | "discord";
          label: string;
          secrets: ChannelSecrets;
        };
        if (secrets.type !== type) {
          res.status(400).json({
            error: `Channel type "${type}" does not match secrets.type "${secrets.type}"`,
          });
          return;
        }
        const channel = await registry.registerChannel({
          userId,
          vaultId,
          type,
          label,
          secrets,
        });
        res.status(201).json({ channel });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to register channel",
        });
      }
    }
  );

  router.get("/channels", (req, res) => {
    const userId =
      typeof req.query.userId === "string" ? req.query.userId : undefined;
    const vaultId =
      typeof req.query.vaultId === "string" ? req.query.vaultId : undefined;
    const channels = registry.listChannels({ userId, vaultId });
    res.status(200).json({ channels });
  });

  router.delete("/channels/:channelId", (req, res) => {
    const deleted = registry.deleteChannel(req.params.channelId);
    if (!deleted) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    res.status(200).json({ deleted: true });
  });

  router.put(
    "/preferences",
    validate(setPreferencesBodySchema),
    (req, res) => {
      const { userId, vaultId, preferences } = req.body as {
        userId: string;
        vaultId: string;
        preferences: PreferenceMatrix;
      };
      const saved = registry.setPreferences(userId, vaultId, preferences);
      res.status(200).json({ userId, vaultId, preferences: saved });
    }
  );

  router.get("/preferences", (req, res) => {
    const userId =
      typeof req.query.userId === "string" ? req.query.userId : "";
    const vaultId =
      typeof req.query.vaultId === "string" ? req.query.vaultId : "";
    if (!userId || !vaultId) {
      res.status(400).json({ error: "userId and vaultId query params are required" });
      return;
    }
    const preferences = registry.getPreferences(userId, vaultId);
    res.status(200).json({ userId, vaultId, preferences });
  });

  return router;
}
