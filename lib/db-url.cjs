// lib/db-url.cjs
//
// Builds the Postgres connection URL that Prisma's datasource (`env("TENANT_DATABASE_URL")`)
// reads, so that THE PASSWORD IS NEVER STORED IN A URL. It lives on its own in
// `DB_PASSWORD` and is spliced in here, percent-encoded, at process start.
//
// CommonJS on purpose: this is the single implementation, and it has to be loadable from
// three places that cannot share a TypeScript module —
//   * next.config.js            → the Next server/build process (see the require() there)
//   * scripts/db-env.cjs        → `node -r` / `tsx -r` preload for the Prisma CLI + scripts
//   * anything else that needs the URL before Prisma is constructed
//
// Inputs (all optional except the password):
//   DB_HOST      default 127.0.0.1
//   DB_PORT      default 5432
//   DB_NAME      default video_generator
//   DB_USER      default video_generator
//   DB_PASSWORD  REQUIRED — the whole point of this file
//   DB_SCHEMA    default public
//   DB_SSLMODE   optional, e.g. "require" for a managed database
//
// TENANT_DATABASE_URL may still be set as an ops override (a full URL for a managed
// instance). It is honoured, but it does NOT have to carry credentials: whatever it omits
// is filled from the DB_* vars above, and DB_PASSWORD always wins over an inline password.

"use strict";

const DEFAULTS = {
  host: "127.0.0.1",
  port: "5432",
  name: "video_generator",
  user: "video_generator",
  schema: "public",
};

function missingPasswordError() {
  return new Error(
    "DB_PASSWORD is not set. This tool connects to Postgres with password " +
      "authentication and keeps the password out of the connection URL, so the password " +
      "must be provided separately in DB_PASSWORD (set it in .env).",
  );
}

/**
 * Compose the Postgres URL from the DB_* environment variables.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function buildTenantDatabaseUrl(env = process.env) {
  const password = env.DB_PASSWORD;
  if (!password) throw missingPasswordError();

  const host = env.DB_HOST || DEFAULTS.host;
  const port = env.DB_PORT || DEFAULTS.port;
  const name = env.DB_NAME || DEFAULTS.name;
  const user = env.DB_USER || DEFAULTS.user;
  const schema = env.DB_SCHEMA || DEFAULTS.schema;

  // Encode both halves of the userinfo so passwords containing @ : / ? # etc. survive.
  const url = new URL(
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`,
  );
  url.searchParams.set("schema", schema);
  if (env.DB_SSLMODE) url.searchParams.set("sslmode", env.DB_SSLMODE);
  return url.toString();
}

/**
 * Take an operator-supplied TENANT_DATABASE_URL and make sure it carries the password from
 * DB_PASSWORD (and a username, if the URL left it out). Anything else in the URL — host,
 * port, database, query string — is left exactly as given.
 * @param {string} raw
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function withSeparatePassword(raw, env = process.env) {
  const password = env.DB_PASSWORD;
  const url = new URL(raw);

  if (!password) {
    // Only tolerable when the override already authenticates some other way.
    if (!url.password) throw missingPasswordError();
    return raw;
  }

  url.username = encodeURIComponent(url.username ? decodeURIComponent(url.username) : env.DB_USER || DEFAULTS.user);
  url.password = encodeURIComponent(password);
  return url.toString();
}

/**
 * Resolve the effective URL: the override when present, otherwise built from parts.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveTenantDatabaseUrl(env = process.env) {
  const override = (env.TENANT_DATABASE_URL || "").trim();
  return override ? withSeparatePassword(override, env) : buildTenantDatabaseUrl(env);
}

/**
 * Write the resolved URL back into process.env so Prisma (client construction and the
 * `prisma` CLI, which both read TENANT_DATABASE_URL) picks it up. Idempotent.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} the resolved URL
 */
function applyTenantDatabaseUrl(env = process.env) {
  const url = resolveTenantDatabaseUrl(env);
  env.TENANT_DATABASE_URL = url;
  return url;
}

/** The URL with the password masked — safe to print in logs and error messages. */
function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<unparseable database url>";
  }
}

module.exports = {
  buildTenantDatabaseUrl,
  resolveTenantDatabaseUrl,
  applyTenantDatabaseUrl,
  redactUrl,
};
