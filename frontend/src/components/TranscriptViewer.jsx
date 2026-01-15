import React from 'react'

export default function TranscriptViewer({ transcript = [] }) {
  return (
    <div className="viewer">
      <h3>Transcript</h3>
      <div className="transcript">
        {transcript.length === 0 ? (
          <div className="empty">No transcript available.</div>
        ) : (
          transcript.map((t, idx) => (
            <div key={idx} className="line">
              <div className="speaker">{t.speaker || 'Speaker'}</div>
              <div className="text">{t.text}</div>
              <div className="time">{t.time || ''}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
