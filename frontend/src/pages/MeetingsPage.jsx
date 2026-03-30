import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

function loadMeetings() {
  const raw = localStorage.getItem('scheduled_meetings') || '[]'
  try { return JSON.parse(raw) } catch { return [] }
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState([])

  useEffect(() => {
    setMeetings(loadMeetings())
  }, [])

  function remove(id) {
    const next = meetings.filter((m) => m.id !== id)
    setMeetings(next)
    localStorage.setItem('scheduled_meetings', JSON.stringify(next))
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Scheduled Meetings</h2>
      {meetings.length === 0 ? (
        <div className="empty">No meetings scheduled.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {meetings.map((m) => (
            <div key={m.id} className="meeting-row">
              <div className="meeting-meta">
                <div style={{ fontWeight: 800 }}>{m.email}</div>
                <div className="muted" style={{ fontSize: 13 }}>{m.time ? new Date(m.time).toLocaleString() : m.time}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <div className="muted" style={{ fontSize: 13 }}>{m.link}</div>
                  {m.processing_mode === 'local' ? (
                    <span className="mode-badge mode-badge--local">🛡️ Private</span>
                  ) : (
                    <span className="mode-badge mode-badge--cloud">⚡ Fast</span>
                  )}
                </div>
              </div>

              <div className="meeting-actions">
                <Link to={`/meeting/${m.id}`}><button className="">View</button></Link>
                <button className="secondary" onClick={() => remove(m.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
