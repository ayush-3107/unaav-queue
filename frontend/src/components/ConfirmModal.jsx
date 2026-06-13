// src/components/ConfirmModal.jsx
//
// Accessible confirmation dialog used for both Mark Entry and Delete actions.
// Blocks background interaction until manager confirms or cancels.
// Uses Headless UI Dialog for accessibility (focus trap, ESC key, etc.)

import { Fragment }            from 'react';
import { Dialog, Transition }  from '@headlessui/react';

// modal.type: 'seat' | 'delete'
// modal.entry: queue entry object
export default function ConfirmModal({ modal, onConfirm, onCancel }) {
  if (!modal) return null;

  const isSeat   = modal.type === 'seat';
  const name     = modal.entry.customer_name ?? `+${modal.entry.phone.replace('+', '')}`;
  const pax      = modal.entry.party_size;

  return (
    <Transition appear show as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onCancel}>

        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150"  leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        {/* Modal panel */}
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"  leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">

              {/* Icon */}
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4
                               ${isSeat ? 'bg-green-100' : 'bg-red-100'}`}>
                {isSeat
                  ? <span className="text-green-600 text-xl">→</span>
                  : <span className="text-red-600 text-xl">🗑</span>
                }
              </div>

              {/* Title */}
              <Dialog.Title className="text-center text-base font-semibold text-gray-900 mb-1">
                {isSeat ? 'Confirm Entry' : 'Remove Entry'}
              </Dialog.Title>

              {/* Description */}
              <p className="text-center text-sm text-gray-500 mb-6">
                {isSeat
                  ? <>Mark <strong>{name}</strong> (party of {pax}) as seated?</>
                  : <>Remove <strong>{name}</strong> (party of {pax}) from the queue?</>
                }
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 px-4 rounded-lg border border-gray-300
                             text-sm font-medium text-gray-700 hover:bg-gray-50
                             transition-colors"
                >
                  Cancel
                </button>
                <button
                    onClick={onConfirm}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold
                                text-white transition-colors
                                ${
                                    isSeat
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-red-600 hover:bg-red-700'
                                }`}
                    >
                    {isSeat ? 'Confirm Entry' : 'Remove'}
                </button>
              </div>

            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}