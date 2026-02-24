import { db } from "../db/connection.js";
import { notificationQueue, pushSubscriptions } from "../db/schema/notifications.js";
import { eq, and } from "drizzle-orm";
import { config } from "../config.js";
import * as webPush from "web-push";

let vapidConfigured = false;

function ensureVapidConfig() {
  if (vapidConfigured) return true;
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    return false;
  }
  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  vapidConfigured = true;
  return true;
}

/** Dispatch queued push notifications */
export function startNotificationDispatcher() {
  async function dispatch() {
    if (!ensureVapidConfig()) {
      // VAPID keys not configured, skip silently
      return;
    }

    // Query unsent notifications
    const pending = await db
      .select()
      .from(notificationQueue)
      .where(eq(notificationQueue.sent, false))
      .limit(100);

    if (pending.length === 0) return;

    console.log(`[notifications] Dispatching ${pending.length} notifications...`);

    for (const notification of pending) {
      // Get push subscriptions for this pubkey
      const subs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.pubkey, notification.pubkey));

      if (subs.length === 0) {
        // No subscriptions, mark as sent to avoid retrying
        await db
          .update(notificationQueue)
          .set({ sent: true })
          .where(eq(notificationQueue.id, notification.id));
        continue;
      }

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        data: notification.data ? JSON.parse(notification.data) : undefined,
        type: notification.type,
      });

      let allSent = true;

      for (const sub of subs) {
        try {
          await webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            // Subscription expired or not found, remove it
            await db
              .delete(pushSubscriptions)
              .where(
                and(
                  eq(pushSubscriptions.pubkey, sub.pubkey),
                  eq(pushSubscriptions.endpoint, sub.endpoint),
                ),
              );
            console.log(`[notifications] Removed expired subscription for ${sub.pubkey}`);
          } else {
            console.error(`[notifications] Failed to send to ${sub.pubkey}:`, err.message);
            allSent = false;
          }
        }
      }

      if (allSent) {
        await db
          .update(notificationQueue)
          .set({ sent: true })
          .where(eq(notificationQueue.id, notification.id));
      }
    }
  }

  // Run every 30 seconds
  setInterval(dispatch, 30 * 1000);
  // Delay first run by 5s
  setTimeout(dispatch, 5000);
}
