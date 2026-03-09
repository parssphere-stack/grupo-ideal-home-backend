/**
 * Removes contact information from property descriptions.
 * Keeps only property-related content (features, location, amenities).
 */

// Patterns that match phone numbers in various formats
const PHONE_PATTERNS = [
  /(?:tel[éeÉE]fono|tfno|telf?|mov|móvil|movil|fax)\s*[.:]\s*[\d\s+()./-]{6,18}/gi,
  /\+?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{0,4}/g, // +34 612 345 678
  /\b\d{3}[\s.-]\d{2}[\s.-]\d{2}[\s.-]\d{2}\b/g,        // 612.34.56.78
];

// Email pattern
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// URL/website patterns
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s,)]+/gi;

// Contact-related sentences/phrases to remove (Spanish)
const CONTACT_SENTENCE_PATTERNS = [
  // WhatsApp / chat references
  /[^.!?\n]*(?:whatsapp|whatssap|whasap|whatshap)[^.!?\n]*/gi,
  // "contactar/contacte/contacto" sentences
  /[^.!?\n]*(?:contact[eao]r?\s+(?:con|por|al|para|sin)[^.!?\n]*)/gi,
  /[^.!?\n]*(?:para\s+(?:más|mas)\s+informaci[oó]n\s+(?:contact|llam|escrib))[^.!?\n]*/gi,
  // "llamar/llame" contact instructions
  /[^.!?\n]*(?:no\s+llamar|abstenerse\s+inmobiliaria)[^.!?\n]*/gi,
  /[^.!?\n]*(?:llam[ea]r?\s+(?:al|a\s+(?:este|el)|para|sin))[^.!?\n]*/gi,
  // "Consultar precio" with contact method
  /[^.!?\n]*consultar?\s+(?:precio|disponibilidad)[^.!?\n]*(?:whatsapp|tel[eé]fono|chat|llamar)[^.!?\n]*/gi,
  // "escribir/escriba" contact instructions
  /[^.!?\n]*(?:escrib[aei]r?\s+(?:al|a\s+(?:este|el)|por|un))[^.!?\n]*/gi,
  // "Directamente" + contact person
  /directamente\s+(?:abogado|propietario|dueño)[^.!?\n]*/gi,
  // "solo contactar"
  /[^.!?\n]*solo\s+contactar[^.!?\n]*/gi,
  // "preferiblemente por"
  /[^.!?\n]*preferiblemente\s+por[^.!?\n]*/gi,
];

/**
 * Clean contact information from a property description.
 * @param {string} description - Raw description from Idealista
 * @returns {string} Cleaned description with only property info
 */
function cleanDescription(description) {
  if (!description || typeof description !== "string") return description;

  let cleaned = description;

  // Remove email addresses
  cleaned = cleaned.replace(EMAIL_PATTERN, "");

  // Remove URLs
  cleaned = cleaned.replace(URL_PATTERN, "");

  // Remove phone numbers
  for (const pattern of PHONE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Remove contact-related sentences
  for (const pattern of CONTACT_SENTENCE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Clean up leftover artifacts
  cleaned = cleaned
    .replace(/\s*[.!?]\s*[.!?]+/g, ".")   // multiple punctuation → single dot
    .replace(/\(\s*\)/g, "")                // empty parentheses
    .replace(/^\s*[.!?\-–—,;:\s]+/g, "")  // leading punctuation/whitespace
    .replace(/\n\s*\n\s*\n/g, "\n\n")      // triple+ newlines → double
    .replace(/  +/g, " ")                   // multiple spaces → single
    .replace(/^\s+|\s+$/g, "")             // trim

  // If cleaning removed everything meaningful, return empty string
  if (cleaned.length < 10) return "";

  return cleaned;
}

module.exports = { cleanDescription };
