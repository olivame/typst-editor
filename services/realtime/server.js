import http from 'node:http'
import { WebSocketServer } from 'ws'

const realtimePort = Number.parseInt(process.env.REALTIME_PORT || '8003', 10)

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      status: 'ok',
      service: 'realtime',
      mode: 'placeholder',
    }))
    return
  }

  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({
    service: 'typst-editor-realtime',
    status: 'placeholder',
    message: 'Realtime room sync will be added in the next milestone.',
  }))
})

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (socket, request) => {
  socket.send(JSON.stringify({
    type: 'realtime.placeholder',
    message: 'Realtime collaboration is not enabled yet.',
    path: request.url || '/',
  }))
  socket.close(1013, 'Realtime collaboration is not enabled yet')
})

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/collaboration')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

server.listen(realtimePort, '0.0.0.0', () => {
  console.log(`realtime placeholder listening on ${realtimePort}`)
})
