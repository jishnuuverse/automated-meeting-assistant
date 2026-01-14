import React from 'react'
import { NavLink } from 'react-router-dom'

export default function NavBar() {
  return (
    <nav className="nav">
      <NavLink to="/" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Join Meeting</NavLink>
    </nav>
  )
}
