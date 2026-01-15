import React from 'react'

export default function ActionItemsViewer({ items = [] }) {
  return (
    <div className="viewer">
      <h3>Action Items</h3>
      {items.length === 0 ? (
        <div className="empty">No action items extracted.</div>
      ) : (
        <ul className="actions">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
