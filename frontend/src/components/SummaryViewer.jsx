import React from 'react'

export default function SummaryViewer({ summary = '' }) {
  return (
    <div className="viewer">
      <h3>AI Summary</h3>
      <div className="summary">{summary || 'No summary available.'}</div>
    </div>
  )
}
