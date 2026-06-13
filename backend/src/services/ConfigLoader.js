// src/services/ConfigLoader.js
//
// Singleton service. Reads outlets.config.json once at server startup
// and caches the result in memory. All other services call
// ConfigLoader.getInstance() to access outlet data.
//
// To add/remove an outlet: edit outlets.config.json and redeploy.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const CONFIG_PATH = join(__dirname, '../config/outlets.config.json');

class ConfigLoader {
  // ── Singleton ──────────────────────────────────────────────────────────────
  static #instance = null;

  static getInstance() {
    if (!ConfigLoader.#instance) {
      ConfigLoader.#instance = new ConfigLoader();
    }
    return ConfigLoader.#instance;
  }

  // ── Internal state ─────────────────────────────────────────────────────────
  #outlets = [];
  #loaded  = false;

  // Private constructor — use getInstance()
  constructor() {}

  // ── Public methods ─────────────────────────────────────────────────────────

  /**
   * load()
   * Reads and parses outlets.config.json. Called once in index.js on startup.
   * Throws if the file is missing or contains invalid JSON.
   */
  load() {
    try {
      const raw      = readFileSync(CONFIG_PATH, 'utf-8');
      const parsed   = JSON.parse(raw);

      if (!Array.isArray(parsed.outlets) || parsed.outlets.length === 0) {
        throw new Error('outlets.config.json must contain a non-empty "outlets" array.');
      }

      this.#outlets = parsed.outlets;
      this.#loaded  = true;

      console.log(
        `[ConfigLoader] Loaded ${this.#outlets.length} outlet(s): ` +
        this.#outlets.map((o) => o.slug).join(', ')
      );
    } catch (err) {
      console.error('[ConfigLoader] Failed to load config:', err.message);
      throw err;
    }
  }

  /**
   * getOutletByIdentifier(text)
   * Matches the customer's first WhatsApp message (case-insensitive, trimmed)
   * against each outlet's wa_identifier.
   *
   * @param   {string}      text  — raw message text from customer
   * @returns {object|null}       — outlet object or null if no match
   */
  getOutletByIdentifier(text) {
    this.#assertLoaded();
    const normalised = text?.trim().toLowerCase();
    return (
      this.#outlets.find(
        (o) => o.wa_identifier.toLowerCase() === normalised
      ) ?? null
    );
  }

  /**
   * getOutletBySlug(slug)
   * @param   {string}      slug  — e.g. 'dwarka'
   * @returns {object|null}
   */
  getOutletBySlug(slug) {
    this.#assertLoaded();
    return this.#outlets.find((o) => o.slug === slug) ?? null;
  }

  /**
   * getAllOutlets()
   * @returns {object[]} — full array of outlet config objects
   */
  getAllOutlets() {
    this.#assertLoaded();
    return this.#outlets;
  }

  /**
   * getManagerOutlet(username)
   * Searches all outlets' manager arrays to find which outlet a
   * username belongs to. Returns the full outlet object.
   *
   * @param   {string}      username  — e.g. 'RaviDwarka'
   * @returns {object|null}           — outlet object or null
   */
  getManagerOutlet(username) {
    this.#assertLoaded();
    return (
      this.#outlets.find((o) =>
        o.managers.some((m) => m.username === username)
      ) ?? null
    );
  }

  /**
   * getManagerByUsername(username)
   * Returns the individual manager record (username + password).
   *
   * @param   {string}      username
   * @returns {object|null}
   */
  getManagerByUsername(username) {
    this.#assertLoaded();
    for (const outlet of this.#outlets) {
      const manager = outlet.managers.find((m) => m.username === username);
      if (manager) return manager;
    }
    return null;
  }

  // ── Private helpers ────────────────────────────────────────────────────────
  #assertLoaded() {
    if (!this.#loaded) {
      throw new Error(
        '[ConfigLoader] Config not loaded. Call ConfigLoader.getInstance().load() at startup.'
      );
    }
  }
}

export default ConfigLoader;