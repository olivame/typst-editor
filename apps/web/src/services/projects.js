import { API_URL } from '../config/api'
import { PREVIEW_URL } from '../config/preview'

const AUTH_TOKEN_STORAGE_KEY = 'typst-editor-auth-token'

function createHttpError(response, rawMessage, fallbackMessage = '') {
  let normalizedMessage = rawMessage || fallbackMessage || `Request failed with status ${response.status}`

  if (rawMessage) {
    try {
      const payload = JSON.parse(rawMessage)
      normalizedMessage = payload.detail || payload.message || normalizedMessage
    } catch {
      normalizedMessage = rawMessage || normalizedMessage
    }
  }

  const error = new Error(normalizedMessage)
  error.status = response.status
  error.response = response
  return error
}

function getAuthHeaders(headers = {}) {
  const token = getAuthToken()
  if (!token) return headers

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}

async function parseJsonResponse(response) {
  if (!response.ok) {
    const message = await response.text()
    throw createHttpError(response, message)
  }

  if (response.status === 204) return null
  return response.json()
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: getAuthHeaders(options.headers || {}),
  })
  return parseJsonResponse(response)
}

export function getAuthToken() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || ''
}

export function setAuthToken(token) {
  if (typeof window === 'undefined') return
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  }
}

export async function registerUser(payload) {
  return apiFetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function loginUser(payload) {
  return apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function logoutUser() {
  return apiFetch('/auth/logout', {
    method: 'POST',
  })
}

export async function getCurrentUser() {
  return apiFetch('/auth/me')
}

export async function listProjects() {
  return apiFetch('/projects')
}

export async function createProject(name, description = '') {
  return apiFetch('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
}

export async function listProjectMembers(projectId) {
  return apiFetch(`/projects/${projectId}/members`)
}

export async function addProjectMember(projectId, payload) {
  return apiFetch(`/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateProjectMember(projectId, memberId, payload) {
  return apiFetch(`/projects/${projectId}/members/${memberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteProjectMember(projectId, memberId) {
  return apiFetch(`/projects/${projectId}/members/${memberId}`, {
    method: 'DELETE',
  })
}

export async function listTags() {
  return apiFetch('/tags')
}

export async function createTag(name) {
  return apiFetch('/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteTag(tagId) {
  return apiFetch(`/tags/${tagId}`, {
    method: 'DELETE',
  })
}

export async function copyProject(projectId) {
  return apiFetch(`/projects/${projectId}/copy`, {
    method: 'POST',
  })
}

export async function deleteProject(projectId) {
  return apiFetch(`/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export async function updateProjectStatus(projectId, status) {
  return apiFetch(`/projects/${projectId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

export async function updateProjectTags(projectId, tagIds) {
  return apiFetch(`/projects/${projectId}/tags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_ids: tagIds }),
  })
}

export async function listProjectFiles(projectId) {
  return apiFetch(`/projects/${projectId}/files`)
}

export async function searchProjectFiles(projectId, query) {
  return apiFetch(`/projects/${projectId}/search?q=${encodeURIComponent(query)}`)
}

export async function createProjectFile(projectId, path) {
  return apiFetch(`/projects/${projectId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function createProjectFolder(projectId, path) {
  return apiFetch(`/projects/${projectId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function uploadProjectFiles(projectId, files, options = {}) {
  const formData = new FormData()
  const relativePaths = options.relativePaths || []

  files.forEach((file) => {
    formData.append('files', file, file.name)
  })

  formData.append('parent_path', options.parentPath || '')
  if (relativePaths.length > 0) {
    formData.append('relative_paths', JSON.stringify(relativePaths))
  }

  const response = await fetch(`${API_URL}/projects/${projectId}/uploads`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  })

  return parseJsonResponse(response)
}

export async function getFileContent(fileId) {
  return apiFetch(`/files/${fileId}/content`)
}

export async function updateFileContent(fileId, content) {
  return apiFetch(`/files/${fileId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

export async function renameProjectEntry(fileId, path) {
  return apiFetch(`/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function deleteProjectEntry(fileId) {
  return apiFetch(`/files/${fileId}`, {
    method: 'DELETE',
  })
}

export async function compileProject(projectId, options = {}) {
  return apiFetch(`/projects/${projectId}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entrypoint: options.entrypoint || '' }),
  })
}

export async function listAvailableFonts() {
  return apiFetch('/fonts')
}

export function getProjectPreviewUrl(projectId, options = {}) {
  const url = new URL(`${PREVIEW_URL}/sessions/${projectId}/data`)
  if (options.entrypoint) {
    url.searchParams.set('entrypoint', options.entrypoint)
  }
  return url.toString()
}

export function getProjectFileUrl(fileId, options = {}) {
  const url = new URL(`${API_URL}/files/${fileId}/raw`)
  if (options.download) {
    url.searchParams.set('download', '1')
  }
  return url.toString()
}

export async function getProjectPreviewStatus(projectId, options = {}) {
  const url = new URL(`${PREVIEW_URL}/sessions/${projectId}/status`)
  if (options.entrypoint) {
    url.searchParams.set('entrypoint', options.entrypoint)
  }
  const response = await fetch(url, {
    headers: getAuthHeaders(),
  })
  return parseJsonResponse(response)
}

export async function downloadProjectPdf(projectId, options = {}) {
  const url = new URL(`${API_URL}/projects/${projectId}/pdf/download`)
  if (options.entrypoint) {
    url.searchParams.set('entrypoint', options.entrypoint)
  }
  const response = await fetch(url, {
    headers: getAuthHeaders(),
  })
  if (!response.ok) {
    const message = await response.text()
    throw createHttpError(response, message, 'Failed to export PDF')
  }

  const blob = await response.blob()
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = options.filename || 'main.pdf'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(objectUrl)
}

export function downloadProjectFile(fileId, filename = '') {
  const anchor = document.createElement('a')
  anchor.href = getProjectFileUrl(fileId, { download: true })
  if (filename) {
    anchor.download = filename
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
