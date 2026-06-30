// src/components/ConfirmModal.jsx
//
// Accessible confirmation dialog used for Mark Entry, Delete, and Logout actions.
// Blocks background interaction until manager confirms or cancels.
// Uses Headless UI Dialog for accessibility (focus trap, ESC key, etc.)

import { Fragment }            from 'react';
import { Dialog, Transition }  from '@headlessui/react';

// modal.type: 'seat' | 'delete' | 'logout'
// modal.entry: queue entry object (not present for 'logout')
export default function ConfirmModal({ modal, onConfirm, onCancel }) {
  if (!modal) return null;

  const isSeat   = modal.type === 'seat';
  const isLogout = modal.type === 'logout';

  const name = !isLogout
    ? (modal.entry.customer_name ?? `+${modal.entry.phone.replace('+', '')}`)
    : null;
  const pax = !isLogout ? modal.entry.party_size : null;

  // Icon background colour per type
  const iconBg =
    isLogout ? 'bg-gray-100' :
    isSeat   ? 'bg-green-100' : 'bg-red-100';

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
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${iconBg}`}>
                {isLogout
                  ? <span className="text-gray-600 text-xl">⏻</span>
                  : isSeat
                    ? <span className="text-green-600 text-xl">→</span>
                    : <span className="text-red-600 text-xl">🗑</span>
                }
              </div>

              {/* Title */}
              <Dialog.Title className="text-center text-base font-semibold text-gray-900 mb-1">
                {isLogout ? 'Confirm Logout' : isSeat ? 'Confirm Entry' : 'Remove Entry'}
              </Dialog.Title>

              {/* Description */}
              <p className="text-center text-sm text-gray-500 mb-6">
                {isLogout
                  ? <>Are you sure you want to log out?</>
                  : isSeat
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
                                    isLogout
                                    ? 'bg-gray-700 hover:bg-gray-800'
                                    : isSeat
                                      ? 'bg-green-600 hover:bg-green-700'
                                      : 'bg-red-600 hover:bg-red-700'
                                }`}
                    >
                    {isLogout ? 'Logout' : isSeat ? 'Confirm Entry' : 'Remove'}
                </button>
              </div>

            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}