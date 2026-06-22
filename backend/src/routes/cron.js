// src/routes/cron.js
//
// Internal route triggered by Render Cron Job every 5 minutes.
// Finds all 'seated' entries where 90 minutes have passed since action_at
// and review_state is still 'pending' — sends the review request and
// flips review_state to 'sent'.
//
// Protected by a shared secret header (CRON_SECRET) so it can't be
// triggered by random internet traffic.

import { Router }      from 'express';
import supabase        from '../utils/supabaseClient.js';
import ConfigLoader    from '../services/ConfigLoader.js';
import WhatsAppService from '../services/WhatsAppService.js';

const router = Router();

const REVIEW_DELAY_MINUTES = 90;

router.post('/send-review-requests', async (req, res) => {
  // Auth check — shared secret
  const secret = req.headers['x-cron-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  // Respond immediately — processing happens after
  res.status(200).json({ message: 'Review request job started.' });

  try {
    const cutoff = new Date(Date.now() - REVIEW_DELAY_MINUTES * 60 * 1000).toISOString();

    // Find seated entries older than 90 min that haven't had a review request sent
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
        if (!outlet) {
          console.warn(`[Cron] No outlet config for entry ${entry.id} — skipping.`);
          continue;
        }

        await WhatsAppService.sendReviewRequest(
          entry.phone,
          entry.customer_name,
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
        // Continue with next entry — one failure shouldn't block the batch
      }
    }

    console.log('[Cron] Review request job completed.');

  } catch (err) {
    console.error('[Cron] Review request job error:', err.message);
  }
});

export default router;