import React from 'react'
import { NavLink } from 'react-router-dom'

export default function NavBar() {
  return (
    <nav className="nav">
      <NavLink to="/" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Schedule Meeting</NavLink>
      <NavLink to="/meetings" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Scheduled Meetings</NavLink>
    </nav>
  )
}
