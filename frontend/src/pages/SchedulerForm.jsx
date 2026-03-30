import React, { useState, useEffect, useRef } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import * as meetingAPI from '../api/meeting'

export default function SchedulerForm() {
  const [link, setLink] = useState('')
  const [scheduledTime, setScheduledTime] = useState(null)
  const [status, setStatus] = useState('idle') // idle, scheduled, joining, success, error
  const [message, setMessage] = useState('')
  const [scheduledMeetings, setScheduledMeetings] = useState([])
  const [processingMode, setProcessingMode] = useState('cloud')
  const joiningRef = useRef(false) // prevent double-submit

  useEffect(() => {
    // Check for scheduled meetings every second
    const interval = setInterval(() => {
      checkScheduledMeetings()
    }, 1000)

    return () => clearInterval(interval)
  }, [scheduledMeetings])

  function checkScheduledMeetings() {
    const now = new Date()
    
    setScheduledMeetings(prev => {
      const updated = prev.filter(meeting => {
        const meetingTime = new Date(meeting.time)
        
        // If meeting time has arrived, join it
        if (meetingTime <= now && !meeting.joined) {
          joinMeetingNow(meeting.link, meeting.id, meeting.processing_mode)
          return false // Remove from scheduled list
        }
        return true
      })
      
      return updated
    })
  }

  async function joinMeetingNow(meetingLink, scheduledId = null, meetingProcessingMode = null) {
    // Prevent double-submit
    if (joiningRef.current) {
      console.log('Join already in progress, ignoring duplicate call')
      return
    }
    joiningRef.current = true

    // Use the meeting's own mode if supplied (scheduled meetings), else current toggle
    const modeToUse = meetingProcessingMode || processingMode

    setStatus('joining')
    setMessage(scheduledId ? `⏰ Time to join! Starting browser...` : 'Joining meeting...')

    try {
      // Ubuntu paths for Brave browser
      const braveExecutable = '/usr/bin/brave-browser'
      const userDataDir = '/home/abhijith/.config/BraveSoftware/Brave-Browser/Default'

      const result = await meetingAPI.start({
        url: meetingLink,
        braveExecutable,
        userDataDir,
        processing_mode: modeToUse
      })

      console.log('Join result:', result)
      setStatus('success')
      setMessage(`✅ Successfully joined! Browser window should open. PID: ${result.pid}`)
      
      // Clear form after 3 seconds
      setTimeout(() => {
        if (!scheduledId) {
          setLink('')
          setScheduledTime(null)
        }
        setStatus('idle')
        setMessage('')
      }, 3000)

    } catch (error) {
      console.error('Failed to join:', error)
      setStatus('error')
      setMessage(`❌ Failed to join meeting: ${error.message}`)
    } finally {
      joiningRef.current = false
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    
    if (!link) {
      alert('Please enter a meeting link')
      return
    }

    // Validate supported platforms: Google Meet, Zoom, Teams
    const supported = /(meet\.google\.com|zoom\.us|app\.zoom\.us|teams\.microsoft\.com)/i
    if (!supported.test(link)) {
      alert('Please enter a valid Google Meet, Zoom, or Teams meeting link')
      return
    }

    // If time is specified and in the future, schedule it
    if (scheduledTime) {
      const meetingTime = scheduledTime
      const now = new Date()
      
      if (meetingTime <= now) {
        alert('Please select a future time')
        return
      }

      // Add to scheduled meetings
      const newMeeting = {
        id: Date.now().toString(),
        link,
        time: meetingTime.toISOString(),
        joined: false,
        processing_mode: processingMode
      }
      
      setScheduledMeetings(prev => [...prev, newMeeting])
      setStatus('scheduled')
      setMessage(`⏰ Meeting scheduled for ${meetingTime.toLocaleString()}`)
      
      // Clear form
      setLink('')
      setScheduledTime(null)
      
      // Clear message after 3 seconds
      setTimeout(() => {
        setStatus('idle')
        setMessage('')
      }, 3000)
    } else {
      // Join immediately
      joinMeetingNow(link)
    }
  }

  function cancelScheduled(id) {
    setScheduledMeetings(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Join or Schedule Meeting</h2>
      <p className="muted">Join now or schedule for later with camera and mic automatically off</p>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Meeting Link (Google Meet / Zoom / Teams)</label>
          <input 
            value={link} 
            onChange={(e) => setLink(e.target.value)} 
            placeholder="https://meet.google.com/... or https://zoom.us/... or https://teams.microsoft.com/..." 
            required 
            disabled={status === 'joining'}
          />
        </div>

        {/* ── Processing Mode Toggle ── */}
        <div className="field">
          <label>Processing Mode</label>
          <div className="mode-toggle-row">
            <button
              type="button"
              className={`mode-card${processingMode === 'cloud' ? ' mode-card--active mode-card--cloud' : ''}`}
              onClick={() => setProcessingMode('cloud')}
            >
              <span className="mode-card__icon">⚡</span>
              <span className="mode-card__label">Fast Mode</span>
              <span className="mode-card__sub">Cloud AI · Faster results</span>
            </button>
            <button
              type="button"
              className={`mode-card${processingMode === 'local' ? ' mode-card--active mode-card--local' : ''}`}
              onClick={() => setProcessingMode('local')}
            >
              <span className="mode-card__icon">🛡️</span>
              <span className="mode-card__label">Private Mode</span>
              <span className="mode-card__sub">Runs locally · Data stays on device</span>
            </button>
          </div>
        </div>

        <div className="field">
          <label>Schedule Time (Optional)</label>
          <DatePicker
            selected={scheduledTime}
            onChange={(date) => setScheduledTime(date)}
            showTimeSelect
            timeFormat="HH:mm"
            timeIntervals={15}
            timeCaption="Time"
            dateFormat="MMMM d, yyyy h:mm aa"
            placeholderText="Click to select date and time"
            disabled={status === 'joining'}
            className="datepicker-input"
            minDate={new Date()}
          />
          <small style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px', display: 'block' }}>
            Leave empty to join immediately, or set a time to join automatically later
          </small>
        </div>

        {message && (
          <div style={{ 
            padding: '12px', 
            marginBottom: '12px', 
            borderRadius: '6px',
            backgroundColor: status === 'success' ? '#dcfce7' : status === 'error' ? '#fee2e2' : status === 'scheduled' ? '#dbeafe' : '#fef3c7',
            color: status === 'success' ? '#166534' : status === 'error' ? '#991b1b' : status === 'scheduled' ? '#1e40af' : '#854d0e'
          }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="submit" disabled={status === 'joining'}>
            {status === 'joining' ? 'Joining...' : scheduledTime ? 'Schedule Meeting' : 'Join Now'}
          </button>
          {link && status !== 'joining' && (
            <button type="button" className="secondary" onClick={() => {
              setLink('')
              setScheduledTime(null)
              setStatus('idle')
              setMessage('')
            }}>
              Clear
            </button>
          )}
        </div>
      </form>

      {scheduledMeetings.length > 0 && (
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0, fontSize: '16px', marginBottom: '12px' }}>⏰ Scheduled Meetings</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {scheduledMeetings.map(meeting => {
              const meetingTime = new Date(meeting.time)
              const now = new Date()
              const timeUntil = Math.floor((meetingTime - now) / 1000)
              const minutes = Math.floor(timeUntil / 60)
              const seconds = timeUntil % 60
              
              return (
                <div key={meeting.id} style={{ 
                  padding: '12px', 
                  backgroundColor: 'white', 
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid #e5e7eb'
                }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
                      {meetingTime.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      {meeting.link.substring(0, 50)}...
                    </div>
                    {timeUntil > 0 && (
                      <div style={{ fontSize: '12px', color: '#059669', marginTop: '4px' }}>
                        ⏱️ Joins in {minutes}m {seconds}s
                      </div>
                    )}
                  </div>
                  <button 
                    type="button" 
                    className="secondary" 
                    onClick={() => cancelScheduled(meeting.id)}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Cancel
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ marginTop: '24px', padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
        <h3 style={{ marginTop: 0, fontSize: '14px' }}>✨ Features</h3>
        <ul style={{ fontSize: '13px', margin: '8px 0', paddingLeft: '20px' }}>
          <li>🎥 Camera automatically turned off</li>
          <li>🎤 Microphone automatically muted</li>
          <li>⏰ Schedule meetings for automatic joining</li>
          
        </ul>
      </div>

      <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
        <h3 style={{ marginTop: 0, fontSize: '14px' }}>⚙️ Configuration</h3>
        <p style={{ fontSize: '12px', margin: '8px 0', color: '#6b7280' }}>
          Browser paths are configured in the code. Current settings:
        </p>
        <ul style={{ fontSize: '11px', margin: '8px 0', paddingLeft: '20px', color: '#6b7280', fontFamily: 'monospace' }}>
          <li>/usr/bin/brave-browser</li>
          <li>/home/abhijith/.config/BraveSoftware/Brave-Browser/Default</li>
        </ul>
      </div>
    </div>
  )
}
