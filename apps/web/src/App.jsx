import { useEffect, useState } from 'react'
import AuthScreen from './components/AuthScreen'
import Editor from './Editor'
import ProjectList from './ProjectList'
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  setAuthToken,
} from './services/projects'

function App() {
  const [currentProject, setCurrentProject] = useState(null)
  const [projectListIntentNonce, setProjectListIntentNonce] = useState(0)
  const [currentUser, setCurrentUser] = useState(null)
  const [authErrorMessage, setAuthErrorMessage] = useState('')
  const [projectListMessage, setProjectListMessage] = useState('')
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(true)

  const loadCurrentSession = async () => {
    try {
      const payload = await getCurrentUser()
      setCurrentUser(payload.user)
      setAuthErrorMessage('')
    } catch {
      setAuthToken('')
      setCurrentUser(null)
    } finally {
      setIsAuthBootstrapping(false)
    }
  }

  useEffect(() => {
    void loadCurrentSession()
  }, [])

  const handleAuthSuccess = async (payloadPromise) => {
    const payload = await payloadPromise
    setAuthToken(payload.token)
    setCurrentUser(payload.user)
    setAuthErrorMessage('')
    setProjectListMessage('')
  }

  const handleEditorAuthFailure = (message = '') => {
    setAuthToken('')
    setCurrentUser(null)
    setCurrentProject(null)
    setProjectListMessage('')
    setAuthErrorMessage(message || '登录状态已失效，请重新登录。')
  }

  const handleEditorAccessDenied = (message = '') => {
    setCurrentProject(null)
    setProjectListMessage(message || '你当前无权访问这个项目。')
  }

  const handleLogout = async () => {
    try {
      await logoutUser()
    } catch {
      // Ignore logout failures and clear local auth state regardless.
    }
    setAuthToken('')
    setCurrentUser(null)
    setCurrentProject(null)
    setProjectListMessage('')
  }

  if (isAuthBootstrapping) {
    return <div style={styles.booting}>Loading session...</div>
  }

  if (!currentUser) {
    return (
      <AuthScreen
        errorMessage={authErrorMessage}
        onLogin={async (payload) => {
          try {
            await handleAuthSuccess(loginUser(payload))
          } catch (error) {
            setAuthErrorMessage(error.message || 'Login failed')
            throw error
          }
        }}
        onRegister={async (payload) => {
          try {
            await handleAuthSuccess(registerUser(payload))
          } catch (error) {
            setAuthErrorMessage(error.message || 'Registration failed')
            throw error
          }
        }}
      />
    )
  }

  return currentProject ? (
    <Editor
      onBack={() => setCurrentProject(null)}
      onAccessDenied={handleEditorAccessDenied}
      onAuthFailure={handleEditorAuthFailure}
      onRequestNewProject={() => {
        setProjectListIntentNonce((current) => current + 1)
        setCurrentProject(null)
      }}
      projectId={currentProject}
    />
  ) : (
    <ProjectList
      currentUser={currentUser}
      externalMessage={projectListMessage}
      newProjectIntentNonce={projectListIntentNonce}
      onLogout={() => {
        void handleLogout()
      }}
      onOpenProject={(projectId) => {
        setProjectListMessage('')
        setCurrentProject(projectId)
      }}
    />
  )
}

const styles = {
  booting: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f3efe4',
    color: '#5d533a',
    fontSize: '14px',
    fontWeight: '700',
  },
}

export default App
