import React from 'react'

export default function StatusDisplay({ status }) {
  const label = status || 'idle'
  return (
    <div className="field status">
      <label>Meeting Status</label>
      <div className={`status-pill status-${label}`}>{label}</div>
    </div>
  )
}
