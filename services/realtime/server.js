import http from 'node:http'
import { URL } from 'node:url'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_AUTH = 2
const MESSAGE_QUERY_AWARENESS = 3
const FLUSH_DEBOUNCE_MS = 900
const ROOM_IDLE_TTL_MS = 60_000

function buildServiceUrl(prefix, defaultHost, defaultPort, defaultScheme = 'http') {
  const explicitUrl = `${process.env[`${prefix}_URL`] || ''}`.trim()
  if (explicitUrl) return explicitUrl.replace(/\/+$/, '')

  const scheme = `${process.env[`${prefix}_SCHEME`] || defaultScheme}`.trim() || defaultScheme
  const host = `${process.env[`${prefix}_HOST`] || defaultHost}`.trim() || defaultHost
  const port = `${process.env[`${prefix}_PORT`] || defaultPort}`.trim()
  return `${scheme}://${host}${port ? `:${port}` : ''}`.replace(/\/+$/, '')
}

const realtimePort = Number.parseInt(process.env.REALTIME_PORT || '8003', 10)
const apiHost = process.env.API_HOST || 'api'
const apiPort = process.env.API_PORT || '8000'
const apiInternalUrl = buildServiceUrl('API_INTERNAL', apiHost, apiPort)
const realtimeSecret = process.env.REALTIME_SECRET || 'change-this-realtime-secret'

const rooms = new Map()
const wss = new WebSocketServer({ noServer: true })

function summarizeContent(value, limit = 80) {
  return `${value || ''}`.replace(/\s+/g, ' ').slice(0, limit)
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) return Uint8Array.from(data)
  return new Uint8Array(data)
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function encodeStateBase64(doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
}

function applyStoredState(doc, stateBase64) {
  const normalizedState = `${stateBase64 || ''}`.trim()
  if (!normalizedState) return false

  try {
    const update = Uint8Array.from(Buffer.from(normalizedState, 'base64'))
    if (update.byteLength === 0) return false
    Y.applyUpdate(doc, update)
    return true
  } catch (error) {
    console.error('[realtime] failed to decode stored state:', error)
    return false
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => {
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })

    request.on('error', reject)
  })
}

function sendHttpError(socket, statusCode, message) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n`
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(message)}\r\n`
    + '\r\n'
    + message,
  )
  socket.destroy()
}

function extractRoomKey(pathname) {
  const normalizedPath = `${pathname || '/'}`
  if (normalizedPath === '/health') return ''

  if (normalizedPath.startsWith('/collaboration/')) {
    return decodeURIComponent(normalizedPath.slice('/collaboration/'.length))
  }

  if (normalizedPath === '/collaboration') {
    return ''
  }

  if (normalizedPath.startsWith('/realtime/')) {
    return decodeURIComponent(normalizedPath.slice('/realtime/'.length))
  }

  if (normalizedPath === '/realtime') {
    return ''
  }

  return decodeURIComponent(normalizedPath.replace(/^\/+/, ''))
}

function buildSyncUpdateMessage(update) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

function buildSyncStep1Message(doc) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

function buildAwarenessMessage(update) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

function parseAwarenessClientIds(update) {
  const decoder = decoding.createDecoder(update)
  const clientCount = decoding.readVarUint(decoder)
  const clientIds = []

  for (let index = 0; index < clientCount; index += 1) {
    clientIds.push(decoding.readVarUint(decoder))
    decoding.readVarUint(decoder)
    decoding.readVarString(decoder)
  }

  return clientIds
}

function broadcast(room, payload, exceptSocket = null) {
  room.connections.forEach((connection) => {
    if (connection.socket === exceptSocket) return
    if (connection.socket.readyState !== connection.socket.OPEN) return
    connection.socket.send(payload)
  })
}

function destroyRoom(room, closeCode = 1012, reason = 'Realtime room reset') {
  if (room.closed) return
  room.closed = true

  if (room.flushTimer) {
    clearTimeout(room.flushTimer)
    room.flushTimer = null
  }
  if (room.idleTimer) {
    clearTimeout(room.idleTimer)
    room.idleTimer = null
  }

  Array.from(room.connections).forEach((connection) => {
    removeConnectionAwareness(room, connection)
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.close(closeCode, reason)
    }
  })
  room.connections.clear()
  room.dirty = false
  room.doc.destroy()
  rooms.delete(room.roomKey)
}

function cleanupRoomIfUnused(room) {
  if (room.closed) return
  if (room.connections.size > 0 || room.dirty || room.flushInFlight) return
  if (room.idleTimer) return

  destroyRoom(room, 1001, 'Realtime room idle')
}

function scheduleRoomCleanup(room) {
  if (room.connections.size > 0) return

  if (room.idleTimer) {
    clearTimeout(room.idleTimer)
  }

  room.idleTimer = setTimeout(() => {
    room.idleTimer = null
    cleanupRoomIfUnused(room)
  }, ROOM_IDLE_TTL_MS)
}

async function flushRoom(room, reason = 'debounce') {
  const shouldForce = reason === 'manual'
  if (room.closed) {
    return { flushed: false, statusCode: 410, message: 'Realtime room is closed' }
  }
  if (room.flushInFlight) {
    return room.flushPromise || { flushed: false, statusCode: 202, message: 'Flush already in progress' }
  }
  if (!room.dirty && !shouldForce) {
    return { flushed: false, statusCode: 200, contentRevision: room.contentRevision }
  }

  room.flushInFlight = true
  if (room.flushTimer) {
    clearTimeout(room.flushTimer)
    room.flushTimer = null
  }

  room.flushPromise = (async () => {
    try {
      const content = room.ytext.toString()
      console.log(
        `[realtime] flush room=${room.roomKey} reason=${reason} len=${content.length} preview=${JSON.stringify(summarizeContent(content))}`,
      )
      const response = await fetch(`${apiInternalUrl}/internal/realtime/flush-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Realtime-Secret': realtimeSecret,
        },
        body: JSON.stringify({
          file_id: room.fileId,
          content,
          state_base64: encodeStateBase64(room.doc),
          content_revision: room.contentRevision,
          updated_by_id: room.lastUpdatedById,
          reason,
        }),
      })

      if (!response.ok) {
        const message = await response.text()
        return {
          flushed: false,
          statusCode: response.status,
          message: message || `Flush failed with status ${response.status}`,
        }
      }

      const payload = await response.json().catch(() => ({}))
      if (Number.isInteger(payload.content_revision)) {
        room.contentRevision = payload.content_revision
      }
      room.dirty = false
      return { flushed: true, statusCode: 200, contentRevision: room.contentRevision }
    } catch (error) {
      console.error(`[realtime] flush failed for ${room.roomKey}:`, error)
      return { flushed: false, statusCode: 502, message: error.message || 'Flush failed' }
    } finally {
      room.flushInFlight = false
      room.flushPromise = null
      cleanupRoomIfUnused(room)
    }
  })()

  return room.flushPromise
}

function scheduleFlush(room, reason = 'debounce') {
  if (room.closed) return

  room.dirty = true
  if (room.flushTimer) {
    clearTimeout(room.flushTimer)
  }

  room.flushTimer = setTimeout(() => {
    void flushRoom(room, reason)
  }, FLUSH_DEBOUNCE_MS)
}

async function resolveRealtimeSession({ fileId, token }) {
  const response = await fetch(`${apiInternalUrl}/internal/realtime/resolve-file-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Realtime-Secret': realtimeSecret,
    },
    body: JSON.stringify({ file_id: fileId }),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Resolve failed with status ${response.status}`)
  }

  return response.json()
}

function getOrCreateRoom(session) {
  const existingRoom = rooms.get(session.room_key)
  if (existingRoom) return existingRoom

  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  const initialContent = `${session.file?.content || ''}`
  const initialContentRevision = Number.parseInt(`${session.file?.content_revision ?? 0}`, 10) || 0
  const restoredFromState = applyStoredState(doc, session.file?.realtime_state)
  if (!restoredFromState && initialContent) {
    ytext.insert(0, initialContent)
  }
  console.log(
    `[realtime] create room=${session.room_key} file=${session.file.id} len=${ytext.toString().length} source=${restoredFromState ? 'state' : 'content'} preview=${JSON.stringify(summarizeContent(ytext.toString()))}`,
  )

  const room = {
    roomKey: session.room_key,
    fileId: session.file.id,
    projectId: session.file.project_id,
    path: session.file.path,
    contentRevision: initialContentRevision,
    ytext,
    doc,
    awareness: new awarenessProtocol.Awareness(doc),
    connections: new Set(),
    dirty: false,
    flushInFlight: false,
    flushTimer: null,
    flushPromise: null,
    idleTimer: null,
    closed: false,
    lastUpdatedById: null,
  }

  doc.on('update', (update, origin) => {
    if (origin?.socket == null) return

    room.lastUpdatedById = origin.user?.id ?? room.lastUpdatedById
    console.log(
      `[realtime] update room=${room.roomKey} user=${room.lastUpdatedById ?? 'unknown'} len=${room.ytext.toString().length} preview=${JSON.stringify(summarizeContent(room.ytext.toString()))}`,
    )
    scheduleFlush(room, 'update')
    broadcast(room, buildSyncUpdateMessage(update), origin.socket)
  })

  rooms.set(room.roomKey, room)
  if (!restoredFromState && initialContent) {
    scheduleFlush(room, 'init')
  }
  return room
}

function removeConnectionAwareness(room, connection) {
  if (connection.controlledClientIds.size === 0) return

  awarenessProtocol.removeAwarenessStates(
    room.awareness,
    Array.from(connection.controlledClientIds),
    connection,
  )
  connection.controlledClientIds.clear()
}

function handleAwarenessUpdate(room, connection, payload) {
  const clientIds = parseAwarenessClientIds(payload)
  clientIds.forEach((clientId) => {
    connection.controlledClientIds.add(clientId)
  })

  awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, connection)
  broadcast(room, buildAwarenessMessage(payload), connection.socket)
}

function sendCurrentAwarenessState(room, socket) {
  const awarenessClientIds = Array.from(room.awareness.getStates().keys())
  if (awarenessClientIds.length === 0 || socket.readyState !== socket.OPEN) return

  socket.send(
    buildAwarenessMessage(
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, awarenessClientIds),
    ),
  )
}

function handleSyncMessage(room, connection, decoder) {
  const syncMessageStart = decoder.pos
  const syncMessageType = decoding.readVarUint(decoder)

  if (!connection.canEdit && syncMessageType !== 0) {
    connection.socket.close(1008, 'Read-only realtime session')
    return
  }

  decoder.pos = syncMessageStart
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.readSyncMessage(decoder, encoder, room.doc, connection)

  const payload = encoding.toUint8Array(encoder)
  if (payload.length > 1 && connection.socket.readyState === connection.socket.OPEN) {
    connection.socket.send(payload)
  }
}

function handleConnectionClose(room, connection) {
  if (room.closed) return

  removeConnectionAwareness(room, connection)
  room.connections.delete(connection)

  if (room.connections.size === 0) {
    scheduleRoomCleanup(room)

    if (room.dirty) {
      void flushRoom(room, 'disconnect')
    }
  }
}

function findRoomByFileId(fileId) {
  for (const room of rooms.values()) {
    if (room.fileId === fileId) return room
  }
  return null
}

async function handleUpgrade(request, socket, head) {
  const requestUrl = new URL(request.url || '/', 'http://localhost')
  const roomKey = extractRoomKey(requestUrl.pathname)
  const fileId = Number.parseInt(requestUrl.searchParams.get('fileId') || '', 10)
  const token = requestUrl.searchParams.get('token') || ''

  if (!roomKey) {
    sendHttpError(socket, 400, 'Missing room key')
    return
  }

  if (!Number.isInteger(fileId) || fileId <= 0 || !token) {
    sendHttpError(socket, 400, 'Missing realtime authentication parameters')
    return
  }

  let session
  try {
    session = await resolveRealtimeSession({ fileId, token })
  } catch (error) {
    sendHttpError(socket, 403, error.message || 'Realtime authorization failed')
    return
  }

  if (session.room_key !== roomKey) {
    sendHttpError(socket, 403, 'Realtime room mismatch')
    return
  }

  const room = getOrCreateRoom(session)
  if (room.idleTimer) {
    clearTimeout(room.idleTimer)
    room.idleTimer = null
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    const connection = {
      socket: websocket,
      roomKey,
      user: session.user,
      canEdit: Boolean(session.permissions?.can_edit),
      controlledClientIds: new Set(),
    }

    room.connections.add(connection)

    websocket.on('message', (data) => {
      try {
        const decoder = decoding.createDecoder(toUint8Array(data))
        const messageType = decoding.readVarUint(decoder)

        if (messageType === MESSAGE_SYNC) {
          handleSyncMessage(room, connection, decoder)
          return
        }

        if (messageType === MESSAGE_AWARENESS) {
          const update = decoding.readVarUint8Array(decoder)
          handleAwarenessUpdate(room, connection, update)
          return
        }

        if (messageType === MESSAGE_QUERY_AWARENESS) {
          sendCurrentAwarenessState(room, websocket)
          return
        }

        if (messageType === MESSAGE_AUTH) {
          return
        }
      } catch (error) {
        console.error(`[realtime] message handling failed for ${room.roomKey}:`, error)
      }
    })

    websocket.on('close', () => {
      handleConnectionClose(room, connection)
    })

    websocket.send(buildSyncStep1Message(room.doc))

    const awarenessStates = Array.from(room.awareness.getStates().keys())
    if (awarenessStates.length > 0) {
      sendCurrentAwarenessState(room, websocket)
    }
  })
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://localhost')

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    writeJson(response, 200, {
      status: 'ok',
      service: 'realtime',
      rooms: rooms.size,
      connections: Array.from(rooms.values()).reduce((total, room) => total + room.connections.size, 0),
    })
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/internal/realtime/flush-room') {
    if (request.headers['x-realtime-secret'] !== realtimeSecret) {
      writeJson(response, 401, { detail: 'Invalid realtime secret' })
      return
    }

    try {
      const payload = await readJsonBody(request)
      const fileId = Number.parseInt(`${payload?.file_id || ''}`, 10)
      if (!Number.isInteger(fileId) || fileId <= 0) {
        writeJson(response, 400, { detail: 'Invalid file_id' })
        return
      }

      const room = findRoomByFileId(fileId)
      if (!room) {
        writeJson(response, 200, {
          status: 'idle',
          file_id: fileId,
        })
        return
      }

      const flushResult = await flushRoom(room, 'manual')
      if (flushResult.statusCode === 409) {
        writeJson(response, 409, {
          detail: flushResult.message || 'Realtime room content is stale',
          file_id: fileId,
          room_key: room.roomKey,
        })
        return
      }

      writeJson(response, 200, {
        status: flushResult.flushed ? 'flushed' : 'idle',
        file_id: fileId,
        room_key: room.roomKey,
        content_length: room.ytext.toString().length,
        content_revision: room.contentRevision,
      })
      return
    } catch (error) {
      console.error('[realtime] manual flush failed:', error)
      writeJson(response, 500, { detail: error.message || 'Manual flush failed' })
      return
    }
  }

  if (request.method === 'POST' && requestUrl.pathname === '/internal/realtime/reset-room') {
    if (request.headers['x-realtime-secret'] !== realtimeSecret) {
      writeJson(response, 401, { detail: 'Invalid realtime secret' })
      return
    }

    try {
      const payload = await readJsonBody(request)
      const fileId = Number.parseInt(`${payload?.file_id || ''}`, 10)
      if (!Number.isInteger(fileId) || fileId <= 0) {
        writeJson(response, 400, { detail: 'Invalid file_id' })
        return
      }

      const room = findRoomByFileId(fileId)
      if (!room) {
        writeJson(response, 200, {
          status: 'idle',
          file_id: fileId,
        })
        return
      }

      const roomKey = room.roomKey
      const connectionCount = room.connections.size
      const contentLength = room.ytext.toString().length
      if (room.flushInFlight && room.flushPromise) {
        await room.flushPromise
      }
      destroyRoom(room)
      writeJson(response, 200, {
        status: 'reset',
        file_id: fileId,
        room_key: roomKey,
        connection_count: connectionCount,
        content_length: contentLength,
      })
      return
    } catch (error) {
      console.error('[realtime] room reset failed:', error)
      writeJson(response, 500, { detail: error.message || 'Room reset failed' })
      return
    }
  }

  writeJson(response, 200, {
    service: 'typst-editor-realtime',
    status: 'ok',
    rooms: rooms.size,
  })
})

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url || '/', 'http://localhost')
  if (!extractRoomKey(requestUrl.pathname)) {
    sendHttpError(socket, 404, 'Not Found')
    return
  }

  void handleUpgrade(request, socket, head)
})

server.listen(realtimePort, '0.0.0.0', () => {
  console.log(`realtime server listening on ${realtimePort}`)
})
