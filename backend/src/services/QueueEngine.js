// src/services/QueueEngine.js

import supabase     from '../utils/supabaseClient.js';
import ConfigLoader from './ConfigLoader.js';

class QueueEngine {

  static async createEntry({ outlet_id, phone, party_size, customer_name = null }) {
    const { data, error } = await supabase
      .from('queue_entries')
      .insert({
        outlet_id,
        phone,
        party_size,
        customer_name,
        status:     'waiting',
        arrived_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[QueueEngine] createEntry error:', error);
      throw new Error('Failed to create queue entry.');
    }
    return data;
  }

  /**
   * recalculatePositions(outletId)
   *
   * Fetches all waiting entries ordered by arrived_at ASC,
   * assigns sequential positions 1, 2, 3...
   * Then immediately updates estimated_wait_mins for each entry
   * based on their new position.
   *
   * Called after: createEntry, seat, delete, cancel.
   */
  static async recalculatePositions(outletId) {
    // Fetch outlet config for wait time formula values
    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', outletId)
      .single();

    const outlet = outletRow
      ? ConfigLoader.getInstance().getOutletBySlug(outletRow.slug)
      : null;

    // Fetch all waiting entries ordered by arrival (FIFO)
    const { data: waitingEntries, error: fetchError } = await supabase
      .from('queue_entries')
      .select('id, arrived_at')
      .eq('outlet_id', outletId)
      .eq('status', 'waiting')
      .order('arrived_at', { ascending: true });

    if (fetchError) {
      console.error('[QueueEngine] recalculatePositions fetch error:', fetchError);
      throw new Error('Failed to fetch waiting entries.');
    }

    if (!waitingEntries || waitingEntries.length === 0) {
      console.log('[QueueEngine] No waiting entries to recalculate.');
      return;
    }

    // Update each entry: new position + recalculated wait time
    for (let i = 0; i < waitingEntries.length; i++) {
      const newPosition    = i + 1;
      const newWaitMins    = outlet
        ? QueueEngine.calculateWaitTime(outlet, newPosition)
        : null;

      const updateFields = { position: newPosition };
      if (newWaitMins !== null) {
        updateFields.estimated_wait_mins = newWaitMins;
      }

      const { error: updateError } = await supabase
        .from('queue_entries')
        .update(updateFields)
        .eq('id', waitingEntries[i].id);

      if (updateError) {
        console.error(
          `[QueueEngine] Failed to update position/wait for entry ${waitingEntries[i].id}:`,
          updateError
        );
      } else {
        console.log(
          `[QueueEngine] Entry ${waitingEntries[i].id} → ` +
          `position=${newPosition}, wait=${newWaitMins}min`
        );
      }
    }

    console.log(
      `[QueueEngine] Recalculated ${waitingEntries.length} entries for outlet ${outletId}`
    );
  }

  /**
   * calculateWaitTime(outlet, position)
   *
   * Formula (example): estimated_wait = A + B × (N - 1)
   *   A = first_table_vacant_mins (time until first table opens)
   *   B = avg_turn_mins (average table occupancy)
   *   N = position in queue
   *
   * Values are read from outlets.config.json per outlet.
   * Tune A and B in config without any code changes.
   */
  static calculateWaitTime(outlet, position) {
    const A = outlet.first_table_vacant_mins ?? 10;
    const B = outlet.avg_turn_mins           ?? 25;
    const N = position;
    return A + B * (N - 1);
  }

  static async getQueueSnapshot(outletId) {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('outlet_id', outletId)
      .eq('status', 'waiting')
      .order('position', { ascending: true });

    if (error) {
      console.error('[QueueEngine] getQueueSnapshot error:', error);
      throw new Error('Failed to fetch queue.');
    }
    return data ?? [];
  }

  static async getEntryById(entryId) {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('[QueueEngine] getEntryById error:', error);
      throw new Error('Failed to fetch queue entry.');
    }
    return data;
  }

  static async getEntryByPhone(phone, outletId) {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('phone', phone)
      .eq('outlet_id', outletId)
      .eq('status', 'waiting')
      .order('arrived_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('[QueueEngine] getEntryByPhone error:', error);
      throw new Error('Failed to fetch entry by phone.');
    }
    return data;
  }

  static async updateEntryStatus(entryId, status, extraFields = {}) {
    const { error } = await supabase
      .from('queue_entries')
      .update({
        status,
        action_at: new Date().toISOString(),
        ...extraFields,
      })
      .eq('id', entryId);

    if (error) {
      console.error('[QueueEngine] updateEntryStatus error:', error);
      throw new Error(`Failed to update entry status to '${status}'.`);
    }
  }

  static async updateEntryFields(entryId, fields) {
    const { data, error } = await supabase
      .from('queue_entries')
      .update(fields)
      .eq('id', entryId)
      .select()
      .single();

    if (error) {
      console.error('[QueueEngine] updateEntryFields error:', error);
      throw new Error('Failed to update entry fields.');
    }

    console.log('[QueueEngine] updateEntryFields result:', data);
    return data;
  }
}

export default QueueEngine;