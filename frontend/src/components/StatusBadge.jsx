// src/components/StatusBadge.jsx
//
// Colour-coded pill badge for queue entry status values.

const STATUS_STYLES = {
  waiting:   'bg-amber-100  text-amber-800',
  seated:    'bg-green-100  text-green-800',
  deleted:   'bg-red-100    text-red-700',
  cancelled: 'bg-gray-100   text-gray-600',
};

const STATUS_LABELS = {
  waiting:   'Waiting',
  seated:    'Seated',
  deleted:   'Deleted',
  cancelled: 'Cancelled',
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500';
  const label = STATUS_LABELS[status] ?? status;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}