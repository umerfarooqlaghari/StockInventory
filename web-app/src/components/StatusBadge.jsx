import React from 'react';

const STYLE_MAP = {
  Paid: 'badge-green',
  Partial: 'badge-yellow',
  Unpaid: 'badge-red',
  Returned: 'badge-purple',
  Pending: 'badge-yellow',
  Received: 'badge-green',
  'Not Delivered': 'badge-blue',
  'Out of Stock': 'badge-red',
  Cancelled: 'badge-gray',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${STYLE_MAP[status] || 'badge-gray'}`}>{status || '—'}</span>;
}
