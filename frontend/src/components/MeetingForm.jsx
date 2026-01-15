import React from 'react'

export default function MeetingForm({ value, onChange }) {
  return (
    <div className="field">
      <label>Google Meet Link</label>
      <input
        type="text"
        placeholder="https://meet.google.com/xxxx-xxxx-xxx"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
