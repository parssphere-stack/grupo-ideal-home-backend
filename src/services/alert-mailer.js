/**
 * Alert Mailer Service
 *
 * Called by daily-maintenance as Phase 5.
 * Processes alert subscriptions and sends matching property emails.
 */

const crypto = require("crypto");
const Alert = require("../models/alert.model");
const Property = require("../models/property.model");
const { sendEmail, buildAlertEmailHtml } = require("./email.service");
const { JWT_SECRET } = require("../middleware/auth");

async function processAlerts() {
  console.log("[Maintenance] Phase 5: Alert emails...");

  const now = new Date();
  const alerts = await Alert.find({ active: true })
    .populate("user", "name email")
    .lean();

  if (!alerts.length) {
    console.log("[Maintenance] Phase 5: No active alerts");
    return { processed: 0, sent: 0 };
  }

  let processed = 0,
    sent = 0,
    skipped = 0,
    errors = 0;

  for (const alert of alerts) {
    try {
      if (!alert.user || !alert.user.email) {
        skipped++;
        continue;
      }

      if (!shouldSendNow(alert, now)) {
        skipped++;
        continue;
      }

      const filter = buildPropertyFilter(alert.criteria || {});

      // Only match properties created since last email (or last 24h for new alerts)
      const since =
        alert.lastSentAt || new Date(now - 24 * 60 * 60 * 1000);
      filter.createdAt = { $gte: since };

      const matches = await Property.find(filter)
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      processed++;

      if (!matches.length) continue;

      const unsubToken = crypto.createHmac("sha256", JWT_SECRET).update(`${alert._id}:${alert.user._id}`).digest("hex").slice(0, 16);
      const unsubscribeUrl = `https://grupo-ideal-home-backend-production.up.railway.app/api/alerts/${alert._id}/unsubscribe?token=${unsubToken}`;
      const html = buildAlertEmailHtml(
        alert.user.name,
        matches,
        alert.criteria || {},
        unsubscribeUrl,
      );

      const result = await sendEmail({
        to: alert.user.email,
        subject: `${matches.length} nuevas propiedades para ti — Grupo Ideal Home`,
        html,
      });

      if (result.sent || result.skipped) {
        await Alert.findByIdAndUpdate(alert._id, {
          lastSentAt: now,
          lastMatchCount: matches.length,
        });
        sent++;
      } else {
        errors++;
      }
    } catch (err) {
      console.error(`[Alert ${alert._id}] Error:`, err.message);
      errors++;
    }
  }

  console.log(
    `[Maintenance] Phase 5 done: ${processed} processed, ${sent} sent, ${skipped} skipped, ${errors} errors`,
  );
  return { processed, sent, skipped, errors };
}

function shouldSendNow(alert, now) {
  if (!alert.lastSentAt) return true;

  const hoursSince =
    (now - new Date(alert.lastSentAt)) / (1000 * 60 * 60);

  switch (alert.frequency) {
    case "immediate":
      return false; // immediate handled separately, not in daily batch
    case "daily":
      return hoursSince >= 23;
    case "weekly":
      return hoursSince >= 6.5 * 24;
    default:
      return hoursSince >= 23;
  }
}

function buildPropertyFilter(criteria) {
  const filter = { status: "active", is_particular: true };

  if (criteria.city) {
    filter["location.city"] = { $regex: criteria.city, $options: "i" };
  }
  if (criteria.operation && ["sale", "rent"].includes(criteria.operation)) {
    filter.operation = criteria.operation;
  }
  if (criteria.propertyType) {
    filter.type = criteria.propertyType;
  }

  const priceFilter = {};
  if (criteria.minPrice) priceFilter.$gte = criteria.minPrice;
  if (criteria.maxPrice) priceFilter.$lte = criteria.maxPrice;
  if (Object.keys(priceFilter).length) filter.price = priceFilter;

  if (criteria.minRooms)
    filter["features.bedrooms"] = { $gte: criteria.minRooms };

  const sizeFilter = {};
  if (criteria.minSize) sizeFilter.$gte = criteria.minSize;
  if (criteria.maxSize) sizeFilter.$lte = criteria.maxSize;
  if (Object.keys(sizeFilter).length) filter["features.size_sqm"] = sizeFilter;

  if (criteria.hasElevator) filter["features.has_elevator"] = true;
  if (criteria.hasParking) filter["features.has_parking"] = true;
  if (criteria.hasPool) filter["features.has_pool"] = true;
  if (criteria.hasTerrace) filter["features.has_terrace"] = true;
  if (criteria.isExterior) filter["features.is_exterior"] = true;

  return filter;
}

module.exports = { processAlerts };
