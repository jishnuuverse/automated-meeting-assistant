import React from 'react'

export default function StartStopButtons({ onStart, onStop, status }) {
  const disabled = status === 'joining' || status === 'active'
  return (
    <div className="buttons">
      <button onClick={onStart} disabled={disabled}>Start</button>
      <button onClick={onStop} disabled={status !== 'active' && status !== 'joining'}>Stop</button>
    </div>
  )
}
