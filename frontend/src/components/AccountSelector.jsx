import React from 'react'

export default function AccountSelector({ accounts = [], selected, onSelect }) {
  return (
    <div className="field">
      <label>Google Account</label>
      <select value={selected} onChange={(e) => onSelect(e.target.value)}>
        {accounts.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      <div className="note">If your account isn't listed, sign in via the backend auth flow.</div>
    </div>
  )
}
