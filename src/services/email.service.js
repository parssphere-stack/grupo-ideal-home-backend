/**
 * Email Service — Resend API
 * Free tier: 3,000 emails/month, 100/day
 * Env: RESEND_API_KEY, FROM_EMAIL
 */

const axios = require("axios");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";
const FROM_NAME = process.env.FROM_NAME || "Grupo Ideal Home";

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log("[Email] RESEND_API_KEY not set, skipping email to:", to);
    return { skipped: true };
  }

  try {
    const response = await axios.post(
      "https://api.resend.com/emails",
      {
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
      },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );
    return { sent: true, id: response.data?.id };
  } catch (err) {
    console.error("[Email] Send failed:", err.response?.data || err.message);
    return { sent: false, error: err.message };
  }
}

function buildAlertEmailHtml(userName, properties, alertCriteria, unsubscribeUrl) {
  const criteriaText = [];
  if (alertCriteria.city) criteriaText.push(alertCriteria.city);
  if (alertCriteria.operation)
    criteriaText.push(alertCriteria.operation === "rent" ? "Alquiler" : "Venta");
  if (alertCriteria.maxPrice)
    criteriaText.push(`max ${alertCriteria.maxPrice.toLocaleString("es-ES")}€`);
  if (alertCriteria.minRooms)
    criteriaText.push(`${alertCriteria.minRooms}+ hab`);
  const criteriaLine = criteriaText.length
    ? criteriaText.join(" · ")
    : "Todas las propiedades";

  const propertyCards = properties
    .slice(0, 10)
    .map((p) => {
      const img = (p.images || [])[0] || "";
      const imgTag = img
        ? `<img src="${img}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:8px 8px 0 0">`
        : `<div style="width:100%;height:160px;background:#1a1a2e;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;color:#666;font-size:24px">🏠</div>`;

      const price = p.price
        ? `${p.price.toLocaleString("es-ES")}€${p.operation === "rent" ? "/mes" : ""}`
        : "";
      const loc = [p.location?.city, p.location?.neighborhood]
        .filter(Boolean)
        .join(", ");
      const feats = [
        p.features?.bedrooms ? `${p.features.bedrooms} hab` : "",
        p.features?.size_sqm ? `${p.features.size_sqm}m²` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `
      <div style="background:#16213e;border-radius:8px;overflow:hidden;margin-bottom:12px">
        ${imgTag}
        <div style="padding:12px">
          <div style="font-size:18px;font-weight:700;color:#c49a3a">${price}</div>
          <div style="font-size:13px;color:#a0a0b0;margin-top:4px">${loc}</div>
          ${feats ? `<div style="font-size:12px;color:#808090;margin-top:4px">${feats}</div>` : ""}
          <a href="https://giphomes.com" style="display:inline-block;margin-top:8px;color:#c49a3a;font-size:12px;text-decoration:none">Ver propiedad →</a>
        </div>
      </div>`;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#0a0a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
      <div style="max-width:600px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:24px;font-weight:700;color:#c49a3a">Grupo Ideal Home</div>
          <div style="font-size:12px;color:#606070;margin-top:4px">Nuevas propiedades para ti</div>
        </div>
        <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;margin-bottom:20px">
          <div style="font-size:14px;color:#e0e0e0;margin-bottom:4px">Hola ${userName || ""},</div>
          <div style="font-size:13px;color:#a0a0b0;margin-bottom:16px">
            Encontramos <strong style="color:#c49a3a">${properties.length}</strong> nuevas propiedades que coinciden con tu alerta:
            <strong style="color:#e0e0e0">${criteriaLine}</strong>
          </div>
          ${propertyCards}
          ${properties.length > 10 ? `<div style="text-align:center;padding:12px;color:#808090;font-size:12px">... y ${properties.length - 10} más</div>` : ""}
          <a href="https://giphomes.com" style="display:block;text-align:center;background:linear-gradient(135deg,#c49a3a,#d4a94a);color:#000;padding:12px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px">
            Ver todas en giphomes.com
          </a>
        </div>
        <div style="text-align:center;font-size:11px;color:#505060;padding:12px">
          <a href="${unsubscribeUrl}" style="color:#808090;text-decoration:underline">Desactivar esta alerta</a>
          <br>Grupo Ideal Home · giphomes.com
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { sendEmail, buildAlertEmailHtml };
