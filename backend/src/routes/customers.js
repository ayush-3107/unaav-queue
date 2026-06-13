// src/routes/customers.js
//
// GET /api/customers/:outletId
//
// Returns the historical log of all queue entries for an outlet.
// Supports filtering by date, status, and search.
// Used by the Customers tab in the manager dashboard.

import { Router }   from 'express';
import authenticate from '../middleware/authenticate.js';
import supabase     from '../utils/supabaseClient.js';

const router = Router();

router.use(authenticate);

// ── GET /api/customers/:outletId ──────────────────────────────────────────────
//
// Query parameters:
//   date   (string)  YYYY-MM-DD          — defaults to today
//   status (string)  waiting|seated|deleted|cancelled|all — defaults to 'all'
//   search (string)  matches phone or customer_name (case-insensitive)
//   page   (number)  default 1
//   limit  (number)  default 50, max 200
//
// Response:
//   { entries: Entry[], total: number, page: number, limit: number, summary: object }
router.get('/:outletId', async (req, res) => {
  const { outletId } = req.params;

  // Outlet access guard
  if (req.user.outlet_id !== outletId) {
    return res.status(403).json({ error: 'Access denied to this outlet.' });
  }

  // ── Parse query params ──────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const dateParam   = req.query.date   ?? today;
  const statusParam = req.query.status ?? 'all';
  const searchParam = req.query.search?.trim() ?? '';
  const page        = Math.max(1, parseInt(req.query.page  ?? '1',  10));
  const limit       = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10)));
  const offset      = (page - 1) * limit;

  try {
    // ── Build base query ──────────────────────────────────────────────────────
    // Filter by date range: arrived_at between start and end of the given date
    const dayStart = `${dateParam}T00:00:00.000Z`;
    const dayEnd   = `${dateParam}T23:59:59.999Z`;

    let query = supabase
      .from('queue_entries')
      .select('*', { count: 'exact' })
      .eq('outlet_id', outletId)
      .gte('arrived_at', dayStart)
      .lte('arrived_at', dayEnd)
      .order('arrived_at', { ascending: false });

    // Status filter
    if (statusParam !== 'all') {
      query = query.eq('status', statusParam);
    }

    // Search filter — matches phone or customer_name
    if (searchParam) {
      query = query.or(
        `phone.ilike.%${searchParam}%,customer_name.ilike.%${searchParam}%`
      );
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: entries, count, error } = await query;

    if (error) {
      console.error('[Customers GET] Query error:', error);
      return res.status(500).json({ error: 'Failed to fetch customer log.' });
    }

    // ── Build summary for the summary bar ────────────────────────────────────
    // Fetch counts for all statuses for the given date (ignoring current filter)
    const { data: allForDay } = await supabase
      .from('queue_entries')
      .select('status, party_size')
      .eq('outlet_id', outletId)
      .gte('arrived_at', dayStart)
      .lte('arrived_at', dayEnd);

    const summary = buildSummary(allForDay ?? []);

    return res.status(200).json({
      entries:  entries ?? [],
      total:    count   ?? 0,
      page,
      limit,
      summary,
    });
  } catch (err) {
    console.error('[Customers GET] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch customer log.' });
  }
});

// ── Helper: build summary object ─────────────────────────────────────────────
function buildSummary(entries) {
  const total_entries   = entries.length;
  const total_pax       = entries.reduce((sum, e) => sum + (e.party_size ?? 0), 0);
  const seated_count    = entries.filter((e) => e.status === 'seated').length;
  const cancelled_count = entries.filter((e) => e.status === 'cancelled').length;
  const deleted_count   = entries.filter((e) => e.status === 'deleted').length;
  const waiting_count   = entries.filter((e) => e.status === 'waiting').length;

  return {
    total_entries,
    total_pax,
    seated_count,
    cancelled_count,
    deleted_count,
    waiting_count,
  };
}

export default router;