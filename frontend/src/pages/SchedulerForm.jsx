import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function saveMeeting(meeting) {
  const raw = localStorage.getItem('scheduled_meetings') || '[]'
  const arr = JSON.parse(raw)
  arr.push(meeting)
  localStorage.setItem('scheduled_meetings', JSON.stringify(arr))
}

export default function SchedulerForm() {
  const [email, setEmail] = useState('')
  const [time, setTime] = useState('')
  const [link, setLink] = useState('')
  const navigate = useNavigate()

  function handleDone(e) {
    e.preventDefault()
    // basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !time || !link) {
      alert('Please fill all fields')
      return
    }
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address')
      return
    }

    const meeting = {
      id: Date.now().toString(),
      email,
      time,
      link,
      created_at: new Date().toISOString()
    }
    saveMeeting(meeting)
    navigate('/meetings')
  }

  return (
    <div className="card">
      <form onSubmit={handleDone}>
        <div className="form-grid">
          <div className="field">
            <label>Your Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="field">
            <label>Meeting Time</label>
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
        </div>

        <div className="field">
          <label>Google Meet Link</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/..." required />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button type="submit">Done</button>
        </div>
      </form>
    </div>
  )
}
