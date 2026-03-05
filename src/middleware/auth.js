/**
 * Shared JWT auth middleware
 * Used by: user.routes, inbox.routes, alert.routes, activity.routes
 */

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "grupo-ideal-secret-2024";

function userAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function signUserToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" },
  );
}

module.exports = { userAuth, signUserToken, JWT_SECRET };
