// src/components/QueueRow.jsx
//
// Single row in the live queue table.
// Displays: position, name, party size, phone, arrival time,
//           live wait countdown, mark entry button, delete button.

import { format }        from 'date-fns';
import { useCountdown }  from '../hooks/useCountdown.js';

export default function QueueRow({ entry, onSeat, onDelete }) {
  const waitDisplay = useCountdown(entry.arrived_at, entry.estimated_wait_mins);

  const name        = entry.customer_name ?? `User …${entry.phone.slice(-4)}`;
  const arrivalTime = format(new Date(entry.arrived_at), 'hh:mm a');

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">

      {/* Name */}
      <td className="px-4 py-3">
        <span className="font-medium text-gray-900 text-sm">{name}</span>
      </td>

      {/* Party size */}
      <td className="px-4 py-3 text-center">
        <span className="text-sm text-gray-700 font-medium">{entry.party_size}</span>
      </td>

      {/* Phone */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500">{entry.phone}</span>
      </td>

      {/* Arrival time */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500">{arrivalTime}</span>
      </td>

      {/* Wait time */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-600">{waitDisplay || '—'}</span>
      </td>

      {/* Mark Entry button */}
      <td className="px-4 py-3 text-center">
        <button
            onClick={onSeat}
            className="inline-flex items-center justify-center
                    w-10 h-10 rounded-lg
                    bg-green-100 hover:bg-green-200
                    text-green-700 transition-colors"
            title="Mark as seated"
        >
            →
        </button>
      </td>

      {/* Delete button */}
      <td className="px-4 py-3 text-center">
        <button
        onClick={onDelete}
        className="inline-flex items-center justify-center
                    w-10 h-10 rounded-lg
                    bg-red-100 hover:bg-red-200
                    text-red-600
                    transition-colors"
        title="Delete Entry"
        >
        🗑️
        </button>
      </td>

    </tr>
  );
}