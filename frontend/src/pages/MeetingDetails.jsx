import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as meetingAPI from '../api/meeting'

function loadMeeting(id) {
  const raw = localStorage.getItem('scheduled_meetings') || '[]'
  try { return JSON.parse(raw).find((m) => m.id === id) } catch { return null }
}

export default function MeetingDetails() {
  const { id } = useParams()
  const [meeting, setMeeting] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setMeeting(loadMeeting(id))
  }, [id])

  async function refresh() {
    setLoading(true)
    try {
      const t = await meetingAPI.getTranscript()
      setTranscript(t?.lines || [])
      const s = await meetingAPI.getSummary()
      setSummary(s?.summary || '')
    } catch (e) {
      console.error(e)
      alert('Failed to fetch meeting data from backend')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      {!meeting ? (
        <div className="empty">Meeting not found.</div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Meeting for {meeting.email}</h2>
              <div className="muted" style={{ marginTop: 6 }}>{meeting.time ? new Date(meeting.time).toLocaleString() : meeting.time}</div>
            </div>
            <div>
              <a href={meeting.link} target="_blank" rel="noreferrer"><button className="secondary">Open Meet</button></a>
            </div>
          </div>

          <div style={{ marginTop: 16, marginBottom: 12 }}>
            <button onClick={refresh} disabled={loading}>{loading ? 'Loading...' : 'Fetch Summary & Transcript'}</button>
          </div>

          <div className="grid">
            <div>
              <div className="viewer card" style={{ padding: 14 }}>
                <h3 style={{ marginTop: 0 }}>AI Summary</h3>
                <div className="summary">{summary || 'No summary available.'}</div>
              </div>

              <div className="viewer card" style={{ padding: 14, marginTop: 12 }}>
                <h3 style={{ marginTop: 0 }}>Transcript</h3>
                {transcript.length === 0 ? <div className="empty">No transcript available.</div> : (
                  <div className="transcript">
                    {transcript.map((t, idx) => (
                      <div key={idx} className="line">
                        <div className="speaker">{t.speaker || 'Speaker'}</div>
                        <div className="text">{t.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
