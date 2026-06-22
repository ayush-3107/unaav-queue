// src/routes/reviews.js
//
// Public routes (no auth) for the customer-facing feedback form,
// plus a protected cron-trigger route for the scheduled review request job.

import { Router }     from 'express';
import supabase       from '../utils/supabaseClient.js';
import ConfigLoader   from '../services/ConfigLoader.js';
import WhatsAppService from '../services/WhatsAppService.js';

const router = Router();

// ── GET /api/reviews/entry/:id ────────────────────────────────────────────────
// Used by the feedback form to fetch basic entry info (name, outlet) to display.
// Public — no auth — token is the queue_entry id itself (UUID, unguessable).
router.get('/entry/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: entry, error } = await supabase
      .from('queue_entries')
      .select('id, customer_name, outlet_id, overall_rating, review_state')
      .eq('id', id)
      .single();

    if (error || !entry) {
      return res.status(404).json({ error: 'Review link not found or expired.' });
    }

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);

    return res.status(200).json({
      entry: {
        id:             entry.id,
        customer_name:  entry.customer_name,
        outlet_name:    outlet?.name ?? 'Unaav',
        overall_rating: entry.overall_rating,
        review_state:   entry.review_state,
      },
    });
  } catch (err) {
    console.error('[Reviews GET entry] Error:', err.message);
    return res.status(500).json({ error: 'Failed to load review details.' });
  }
});

// ── POST /api/reviews/entry/:id/feedback ──────────────────────────────────────
// Submits the detailed feedback form (food/service/ambiance ratings + text).
// Public — no auth — token is the queue_entry id.
router.post('/entry/:id/feedback', async (req, res) => {
  const { id } = req.params;
  const { food_rating, service_rating, ambiance_rating, user_feedback } = req.body ?? {};

  // Validate ratings are 1-5 if provided
  for (const [label, val] of [
    ['food_rating', food_rating],
    ['service_rating', service_rating],
    ['ambiance_rating', ambiance_rating],
  ]) {
    if (val !== undefined && val !== null && (!Number.isInteger(val) || val < 1 || val > 5)) {
      return res.status(400).json({ error: `${label} must be an integer 1-5.` });
    }
  }

  try {
    const { data: entry, error: fetchErr } = await supabase
      .from('queue_entries')
      .select('id, phone, customer_name, outlet_id, review_state')
      .eq('id', id)
      .single();

    if (fetchErr || !entry) {
      return res.status(404).json({ error: 'Review link not found or expired.' });
    }

    if (entry.review_state === 'completed') {
      return res.status(400).json({ error: 'Feedback has already been submitted for this visit.' });
    }

    await supabase
      .from('queue_entries')
      .update({
        food_rating:     food_rating ?? null,
        service_rating:  service_rating ?? null,
        ambiance_rating: ambiance_rating ?? null,
        user_feedback:   user_feedback?.trim() ?? null,
        review_state:    'completed',
      })
      .eq('id', id);

    // Send thank-you message via WhatsApp
    try {
      await WhatsAppService.sendReviewThankYou(entry.phone, entry.customer_name);
    } catch (waErr) {
      console.warn('[Reviews POST feedback] WA thank-you failed:', waErr.message);
    }

    console.log(`[Reviews POST feedback] Feedback submitted for entry ${id}`);

    return res.status(200).json({ message: 'Feedback submitted successfully.' });
  } catch (err) {
    console.error('[Reviews POST feedback] Error:', err.message);
    return res.status(500).json({ error: 'Failed to submit feedback.' });
  }
});

export default router;