/**
 * Shared agency detection — used by scraper routes + daily maintenance
 */

const AGENCY_KEYWORDS = [
  "inmobiliaria", "inmobiliario", "agencia", "agente", "agency",
  "real estate", "realestate", "realty",
  "gestión inmobiliaria", "gestion inmobiliaria",
  "servicios", "soluciones",
  "inversiones", "inversión", "inversion",
  "consultores", "consultoría", "consultoria",
  "asociados", "partners",
  "century 21", "century21", "remax", "re/max",
  "coldwell", "engel", "voelkers", "völkers",
  "lucas fox", "lucasfox", "barnes", "savills",
  "knight frank", "jll", "cushman", "cbre",
  "tecnocasa", "habitaclia", "fotocasa", "pisos.com",
  "s.l.", "s.l ", "s.a.", "s.a ", "s.l.u",
  "sociedad limitada", "asesor inmobiliario",
  "broker", "promotor", "promotora",
  "desarrollo inmobiliario", "construcciones",
  "administracion de fincas", "gestion de alquileres", "compraventa",
  // Additional patterns from description analysis
  "gilmar", "redpiso", "donpiso", "keller williams",
  "le presentamos", "nuestro equipo", "contacte con nosotros",
  "grupo inmobiliario",
];

function isAgency(name = "", commercial = "") {
  const combined = `${name} ${commercial}`.toLowerCase();
  if (commercial && commercial.length > 2) return true;
  return AGENCY_KEYWORDS.some((kw) => combined.includes(kw));
}

function isExpired(item) {
  if (item.status && !["good", "renew", ""].includes(item.status)) return true;
  if (item.firstActivationDate) {
    const daysOld = (Date.now() - item.firstActivationDate) / (1000 * 60 * 60 * 24);
    if (daysOld > 90) return true;
  }
  return false;
}

module.exports = { AGENCY_KEYWORDS, isAgency, isExpired };
