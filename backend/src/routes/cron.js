// src/routes/cron.js
//
// Two cron jobs — both triggered by external cron-job.org calls:
//
// POST /api/cron/send-review-requests
//   Finds seated entries 90+ min old with review_state='pending'
//   and sends the review_request_template.
//   Run: every 5 minutes
//
// POST /api/cron/send-daily-reports
//   Sends a daily summary report for each outlet to report_phones.
//   Run: every day at 8:00 AM IST (2:30 AM UTC) via cron-job.org
//   Schedule: 30 2 * * *

import { Router }      from 'express';
import supabase        from '../utils/supabaseClient.js';
import ConfigLoader    from '../services/ConfigLoader.js';
import WhatsAppService from '../services/WhatsAppService.js';

const router = Router();

const REVIEW_DELAY_MINUTES = 90;

// ── Auth middleware for all cron routes ───────────────────────────────────────
function cronAuth(req, res, next) {
  const secret = req.headers['x-cron-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

// ── POST /api/cron/send-review-requests ──────────────────────────────────────
router.post('/send-review-requests', cronAuth, async (req, res) => {
  res.status(200).json({ message: 'Review request job started.' });

  try {
    const cutoff = new Date(Date.now() - REVIEW_DELAY_MINUTES * 60 * 1000).toISOString();

    const { data: dueEntries, error } = await supabase
      .from('queue_entries')
      .select('id, phone, customer_name, outlet_id, action_at')
      .eq('status', 'seated')
      .eq('review_state', 'pending')
      .lte('action_at', cutoff);

    if (error) {
      console.error('[Cron] Failed to fetch due entries:', error.message);
      return;
    }

    if (!dueEntries || dueEntries.length === 0) {
      console.log('[Cron] No review requests due.');
      return;
    }

    console.log(`[Cron] Found ${dueEntries.length} entries due for review request.`);

    for (const entry of dueEntries) {
      try {
        const { data: outletRow } = await supabase
          .from('outlets')
          .select('slug')
          .eq('id', entry.outlet_id)
          .single();

        const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);
        if (!outlet) continue;

        // Get best name — entry first, then wa_session
        let customerName = entry.customer_name;
        if (!customerName) {
          const { data: sess } = await supabase
            .from('wa_sessions')
            .select('customer_name')
            .eq('queue_entry_id', entry.id)
            .maybeSingle();
          customerName = sess?.customer_name ?? null;
        }

        await WhatsAppService.sendReviewRequest(
          entry.phone,
          customerName,
          outlet.name
        );

        await supabase
          .from('queue_entries')
          .update({
            review_state:        'sent',
            review_requested_at: new Date().toISOString(),
          })
          .eq('id', entry.id);

        console.log(`[Cron] Review request sent to ${entry.phone} (entry ${entry.id})`);

      } catch (entryErr) {
        console.error(`[Cron] Failed to process entry ${entry.id}:`, entryErr.message);
      }
    }

    console.log('[Cron] Review request job completed.');

  } catch (err) {
    console.error('[Cron] Review request job error:', err.message);
  }
});

// ── POST /api/cron/send-daily-reports ────────────────────────────────────────
router.post('/send-daily-reports', cronAuth, async (req, res) => {
  res.status(200).json({ message: 'Daily report job started.' });

  try {
    // Yesterday's date in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    // Yesterday
    const yesterday = new Date(istNow);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    // Date range in UTC for yesterday IST
    // IST midnight = UTC 18:30 previous day
    const dayStartUTC = new Date(`${dateStr}T00:00:00+05:30`).toISOString();
    const dayEndUTC   = new Date(`${dateStr}T23:59:59+05:30`).toISOString();

    const outlets = ConfigLoader.getInstance().getAllOutlets();
    // console.log('[Cron Daily] Outlets found:', outlets.map(o => o.slug));

    for (const outlet of outlets) {
      try {
        if (!outlet.report_phones?.length) continue;

        // Get outlet DB row
        const { data: outletRow } = await supabase
          .from('outlets')
          .select('id')
          .eq('slug', outlet.slug)
          .single();

        if (!outletRow) continue;

        // Fetch all seated entries for yesterday
        const { data: fetchedEntries } = await supabase
          .from('queue_entries')
          .select('party_size, action_at, overall_rating')
          .eq('outlet_id', outletRow.id)
          .eq('status', 'seated')
          .gte('action_at', dayStartUTC)
          .lte('action_at', dayEndUTC);

        const entries = fetchedEntries || [];

        // Calculate stats
        const totalCustomers = entries.length;
        const totalPax       = entries.reduce((s, e) => s + (e.party_size || 0), 0);

        // Lunch cutoff in IST (configurable per outlet, default 15:30)
        const lunchCutoff = outlet.lunch_cutoff || '15:30';

        let lunchCount = 0, lunchPax = 0, dinnerCount = 0, dinnerPax = 0;
        for (const e of entries) {
          const actionIST = new Date(new Date(e.action_at).getTime() + istOffset);
          const timeStr   = `${actionIST.getUTCHours().toString().padStart(2,'0')}:${actionIST.getUTCMinutes().toString().padStart(2,'0')}`;
          if (timeStr < lunchCutoff) {
            lunchCount++;
            lunchPax += e.party_size || 0;
          } else {
            dinnerCount++;
            dinnerPax += e.party_size || 0;
          }
        }

        // Rating breakdown
        const star5      = entries.filter(e => e.overall_rating === 5).length;
        const star4      = entries.filter(e => e.overall_rating === 4).length;
        const star3orless = entries.filter(e => e.overall_rating != null && e.overall_rating <= 3).length;

        // Format display date as DD-MM-YYYY
        const [y, m, d] = dateStr.split('-');
        const displayDate = `${d}-${m}-${y}`;

        // Send to all report phones
        for (const reportPhone of outlet.report_phones) {
          await WhatsAppService.sendDailyReport(
            reportPhone,
            outlet.name,
            displayDate,
            totalCustomers,
            totalPax,
            lunchCount,
            lunchPax,
            dinnerCount,
            dinnerPax,
            star5,
            star4,
            star3orless
          );
        }

        console.log(`[Cron Daily] Report sent for ${outlet.name} — ${totalCustomers} customers`);

      } catch (outletErr) {
        console.error(`[Cron Daily] Failed for outlet ${outlet.slug}:`, outletErr.message);
      }
    }

    console.log('[Cron Daily] Daily report job completed.');

  } catch (err) {
    console.error('[Cron Daily] Job error:', err.message);
  }
});

export default router;