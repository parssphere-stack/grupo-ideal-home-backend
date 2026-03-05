/**
 * Reset script: deletes all leads + all non-admin agents
 * Usage: node src/scripts/reset_agents.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Agent = require("../models/agent.model");
const Lead = require("../models/lead.model");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB");

  // Show current state
  const agents = await Agent.find().select("name email role").lean();
  console.log("\nCurrent agents:");
  agents.forEach((a) => console.log(`  [${a.role}] ${a.name} (${a.email})`));

  const leadCount = await Lead.countDocuments();
  console.log(`\nTotal leads: ${leadCount}`);

  // Delete all leads
  const deletedLeads = await Lead.deleteMany({});
  console.log(`\nDeleted ${deletedLeads.deletedCount} leads`);

  // Delete non-admin agents
  const deletedAgents = await Agent.deleteMany({ role: { $ne: "admin" } });
  console.log(`Deleted ${deletedAgents.deletedCount} non-admin agents`);

  // Show remaining
  const remaining = await Agent.find().select("name email role").lean();
  console.log("\nRemaining agents:");
  remaining.forEach((a) => console.log(`  [${a.role}] ${a.name} (${a.email})`));

  await mongoose.disconnect();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
