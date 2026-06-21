import React from 'react';

export default function StatusBadge({ status }) {
  const map = {
    Paid:     'badge badge-green',
    Partial:  'badge badge-yellow',
    Unpaid:   'badge badge-red',
    Returned: 'badge badge-purple',
  };
  return <span className={map[status] || 'badge badge-gray'}>{status || '—'}</span>;
}
