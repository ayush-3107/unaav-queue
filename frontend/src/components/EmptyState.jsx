// src/components/EmptyState.jsx
// Shown in the Home tab when no customers are waiting.

export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <span className="text-3xl">🍛</span>
      </div>
      <p className="text-gray-500 font-medium">No one in queue</p>
      <p className="text-gray-400 text-sm mt-1">New customers will appear here automatically.</p>
    </div>
  );
}