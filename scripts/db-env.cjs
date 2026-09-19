// scripts/db-env.cjs — preload module: `node -r ./scripts/db-env.cjs …`
//
// Loads .env and then composes TENANT_DATABASE_URL out of the DB_* vars (password from
// DB_PASSWORD, kept separate — see lib/db-url.cjs). Used by every npm script that shells
// out to the Prisma CLI or runs a tsx script, because both read TENANT_DATABASE_URL from
// the environment before any of our TypeScript gets a chance to run.
//
// Next.js does not go through here — it loads .env itself and next.config.js applies the
// same composition.

"use strict";

require("dotenv").config();
const url = require("../lib/db-url.cjs").applyTenantDatabaseUrl();

// The QA/recovery scripts accept a workspace's database as TENANT_DB_URL/TENANT_ID. In
// local mode there is only the one database and one workspace, so default both rather
// than making the operator rediscover them (and paste a URL with the password in it).
if (!process.env.TENANT_DB_URL) process.env.TENANT_DB_URL = url;
if (!process.env.TENANT_ID) {
  process.env.TENANT_ID = process.env.VIDEO_GENERATOR_TENANT_ID || "standalone";
}
