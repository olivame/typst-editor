import { useState } from 'react'

export default function AuthScreen({ errorMessage = '', onLogin, onRegister }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setLocalError('Email and password are required')
      return
    }

    if (mode === 'register' && !displayName.trim()) {
      setLocalError('Display name is required')
      return
    }

    setIsSubmitting(true)
    setLocalError('')
    try {
      if (mode === 'login') {
        await onLogin({ email, password })
      } else {
        await onRegister({ email, password, display_name: displayName })
      }
    } catch (error) {
      setLocalError(error.message || 'Authentication failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.panel}>
        <div style={styles.brand}>Typst Team</div>
        <div style={styles.title}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </div>
        <div style={styles.subtitle}>
          Collaborative Typst writing with project-level permissions.
        </div>

        <div style={styles.tabs}>
          <button
            onClick={() => setMode('login')}
            style={{ ...styles.tabButton, ...(mode === 'login' ? styles.tabButtonActive : null) }}
            type="button"
          >
            Login
          </button>
          <button
            onClick={() => setMode('register')}
            style={{ ...styles.tabButton, ...(mode === 'register' ? styles.tabButtonActive : null) }}
            type="button"
          >
            Register
          </button>
        </div>

        {mode === 'register' ? (
          <input
            autoComplete="name"
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Display name"
            style={styles.input}
            value={displayName}
          />
        ) : null}

        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          style={styles.input}
          value={email}
        />
        <input
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          style={styles.input}
          type="password"
          value={password}
        />

        {(localError || errorMessage) ? (
          <div style={styles.error}>{localError || errorMessage}</div>
        ) : null}

        <button
          onClick={() => {
            void handleSubmit()
          }}
          style={styles.submitButton}
          type="button"
        >
          {isSubmitting ? 'Submitting...' : mode === 'login' ? 'Login' : 'Register'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(180deg, #f5f3ea 0%, #ece7d8 100%)',
    padding: '24px',
  },
  panel: {
    width: '100%',
    maxWidth: '420px',
    background: '#fffdf7',
    border: '1px solid #ddd5c1',
    borderRadius: '18px',
    boxShadow: '0 24px 70px rgba(84, 67, 31, 0.12)',
    padding: '28px',
    display: 'grid',
    gap: '14px',
  },
  brand: {
    fontSize: '13px',
    fontWeight: '800',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#846c38',
  },
  title: {
    fontSize: '28px',
    fontWeight: '800',
    color: '#2b2518',
  },
  subtitle: {
    fontSize: '14px',
    lineHeight: '1.6',
    color: '#66583c',
  },
  tabs: {
    display: 'flex',
    gap: '8px',
  },
  tabButton: {
    flex: 1,
    height: '38px',
    borderRadius: '10px',
    border: '1px solid #d7ceb8',
    background: '#f3efe3',
    color: '#5e5030',
    fontWeight: '700',
    cursor: 'pointer',
  },
  tabButtonActive: {
    background: '#2f3c2f',
    color: '#f9f7ef',
    borderColor: '#2f3c2f',
  },
  input: {
    height: '44px',
    borderRadius: '10px',
    border: '1px solid #d7ceb8',
    background: '#fff',
    padding: '0 14px',
    fontSize: '14px',
    color: '#2b2518',
    outline: 'none',
  },
  error: {
    padding: '10px 12px',
    borderRadius: '10px',
    background: '#fff0ea',
    color: '#9b3d1d',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  submitButton: {
    height: '46px',
    border: 'none',
    borderRadius: '12px',
    background: '#9b5d24',
    color: '#fffef8',
    fontSize: '14px',
    fontWeight: '800',
    cursor: 'pointer',
  },
}
