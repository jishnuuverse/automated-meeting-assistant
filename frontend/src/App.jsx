import React from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import SchedulerForm from './pages/SchedulerForm'
import MeetingsPage from './pages/MeetingsPage'
import MeetingDetails from './pages/MeetingDetails'

export default function App() {
  return (
    <HashRouter>
      <div className="app container">
        <h1>Automated Meeting Assistant</h1>
        <NavBar />
        <div style={{ marginTop: 12 }} />
        <Routes>
          <Route path="/" element={<SchedulerForm />} />
          <Route path="/meetings" element={<MeetingsPage />} />
          <Route path="/meeting/:id" element={<MeetingDetails />} />
        </Routes>
      </div>
    </HashRouter>
  )
}
