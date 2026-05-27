import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import {
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'

const readOnlyCompartment = new Compartment()
const wrappingCompartment = new Compartment()
const themeCompartment = new Compartment()

function getEditorReadOnlyState(readOnly, collaborationState) {
  if (!collaborationState) return readOnly
  return readOnly || !collaborationState.isSynced
}

function clampPosition(value, max) {
  return Math.max(0, Math.min(value, max))
}

function createEditorTheme({ fontSize, lineHeight }) {
  const lineNumberFontSize = Math.max(Math.round(fontSize * 0.87 * 10) / 10, 11)

  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: '#fbfbfc',
      color: '#2b2f37',
      fontSize: `${fontSize}px`,
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
      lineHeight: `${lineHeight}px`,
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '14px 0',
      caretColor: '#1f2937',
    },
    '.cm-line': {
      padding: '0 18px',
    },
    '.cm-focused': {
      outline: 'none',
    },
    '.cm-gutters': {
      backgroundColor: '#f1f2f5',
      color: '#b1b6c2',
      borderRight: '1px solid #e2e4ea',
      padding: '14px 0',
    },
    '.cm-gutterElement': {
      minHeight: `${lineHeight}px`,
      lineHeight: `${lineHeight}px`,
      fontSize: `${lineNumberFontSize}px`,
      padding: '0 12px 0 0',
      fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#8a91a1',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(59, 130, 246, 0.18)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#1f2937',
    },
  })
}

const CollaborativeEditor = forwardRef(function CollaborativeEditor({
  authToken = '',
  collaborationSession = null,
  fontSize = 15,
  lineHeight = 24,
  onChange,
  onConnectionStateChange,
  onDoubleClick,
  onMount,
  onScroll,
  readOnly = false,
  value = '',
  wordWrap = true,
}, ref) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onConnectionStateChangeRef = useRef(onConnectionStateChange)
  const onDoubleClickRef = useRef(onDoubleClick)
  const onMountRef = useRef(onMount)
  const onScrollRef = useRef(onScroll)
  const collaborationRef = useRef(null)
  const lastPublishedValueRef = useRef(value)
  const suppressedChangeCountRef = useRef(0)
  const initialConfigRef = useRef({
    authToken,
    collaborationSession,
    fontSize,
    lineHeight,
    readOnly,
    value,
    wordWrap,
  })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onConnectionStateChangeRef.current = onConnectionStateChange
  }, [onConnectionStateChange])

  useEffect(() => {
    onDoubleClickRef.current = onDoubleClick
  }, [onDoubleClick])

  useEffect(() => {
    onMountRef.current = onMount
  }, [onMount])

  useEffect(() => {
    onScrollRef.current = onScroll
  }, [onScroll])

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return undefined
    const initialConfig = initialConfigRef.current
    const initialCollaborationSession = initialConfig.collaborationSession
    const shouldUseRealtime = Boolean(initialCollaborationSession?.room_key && initialConfig.authToken)
    const collaborationState = shouldUseRealtime
      ? {
        isSynced: false,
        provider: null,
        undoManager: null,
        ydoc: null,
      }
      : null
    const keyBindings = [
      indentWithTab,
      ...defaultKeymap,
    ]
    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      drawSelection(),
      markdown(),
      readOnlyCompartment.of([
        EditorState.readOnly.of(getEditorReadOnlyState(initialConfig.readOnly, collaborationState)),
        EditorView.editable.of(!getEditorReadOnlyState(initialConfig.readOnly, collaborationState)),
      ]),
      wrappingCompartment.of(initialConfig.wordWrap ? EditorView.lineWrapping : []),
      themeCompartment.of(createEditorTheme({
        fontSize: initialConfig.fontSize,
        lineHeight: initialConfig.lineHeight,
      })),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        const nextValue = update.state.doc.toString()
        lastPublishedValueRef.current = nextValue
        if (suppressedChangeCountRef.current > 0) {
          suppressedChangeCountRef.current -= 1
          return
        }
        onChangeRef.current?.(nextValue)
      }),
      EditorView.domEventHandlers({
        dblclick: () => {
          window.requestAnimationFrame(() => {
            const activeView = viewRef.current
            if (!activeView) return
            onDoubleClickRef.current?.(activeView.state.selection.main.head)
          })
        },
      }),
    ]

    if (shouldUseRealtime) {
      const ydoc = new Y.Doc()
      const ytext = ydoc.getText('content')
      const undoManager = new Y.UndoManager(ytext)
      const provider = new WebsocketProvider(
        initialCollaborationSession.realtime_url,
        initialCollaborationSession.room_key,
        ydoc,
        {
          params: {
            fileId: `${initialCollaborationSession.file.id}`,
            token: initialConfig.authToken,
          },
        },
      )

      collaborationState.provider = provider
      collaborationState.undoManager = undoManager
      collaborationState.ydoc = ydoc
      collaborationState.ytext = ytext
      collaborationRef.current = collaborationState
      keyBindings.push(
        { key: 'Mod-z', run: () => { undoManager.undo(); return true } },
        { key: 'Mod-y', run: () => { undoManager.redo(); return true } },
        { key: 'Mod-Shift-z', run: () => { undoManager.redo(); return true } },
      )
      extensions.push(yCollab(ytext, provider.awareness, { undoManager }))

      provider.on('status', (event) => {
        onConnectionStateChangeRef.current?.(event.status)
      })
      provider.on('sync', (isSynced) => {
        collaborationState.isSynced = isSynced
        const activeView = viewRef.current
        if (!activeView) return

        activeView.dispatch({
          effects: readOnlyCompartment.reconfigure([
            EditorState.readOnly.of(getEditorReadOnlyState(initialConfig.readOnly, collaborationState)),
            EditorView.editable.of(!getEditorReadOnlyState(initialConfig.readOnly, collaborationState)),
          ]),
        })

        if (isSynced) {
          onConnectionStateChangeRef.current?.('connected')
        }
      })
      onConnectionStateChangeRef.current?.('connecting')
    } else {
      keyBindings.push(...historyKeymap)
      extensions.splice(3, 0, history())
      collaborationRef.current = null
    }

    extensions.splice(4, 0, keymap.of(keyBindings))

    const view = new EditorView({
      state: EditorState.create({
        doc: shouldUseRealtime ? '' : initialConfig.value,
        extensions,
      }),
      parent: containerRef.current,
    })

    const handleScroll = () => {
      onScrollRef.current?.(view.scrollDOM.scrollTop)
    }

    view.scrollDOM.addEventListener('scroll', handleScroll)
    viewRef.current = view
    onMountRef.current?.({
      rootElement: view.dom,
      scrollElement: view.scrollDOM,
    })

    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll)
      onMountRef.current?.({
        rootElement: null,
        scrollElement: null,
      })
      collaborationRef.current?.provider?.destroy()
      collaborationRef.current?.ydoc?.destroy()
      collaborationRef.current = null
      onConnectionStateChangeRef.current?.('idle')
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (collaborationSession && !collaborationRef.current?.isSynced) return

    const currentValue = view.state.doc.toString()
    if (currentValue === value) {
      lastPublishedValueRef.current = currentValue
      return
    }
    if (value === lastPublishedValueRef.current) return

    suppressedChangeCountRef.current += 1
    lastPublishedValueRef.current = value
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    })
  }, [collaborationSession, value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const collaborationState = collaborationRef.current
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(getEditorReadOnlyState(readOnly, collaborationState)),
        EditorView.editable.of(!getEditorReadOnlyState(readOnly, collaborationState)),
      ]),
    })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: wrappingCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    })
  }, [wordWrap])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: themeCompartment.reconfigure(createEditorTheme({ fontSize, lineHeight })),
    })
  }, [fontSize, lineHeight])

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus()
    },
    getScrollElement() {
      return viewRef.current?.scrollDOM || null
    },
    getScrollTop() {
      return viewRef.current?.scrollDOM.scrollTop || 0
    },
    getSelectionRange() {
      const view = viewRef.current
      if (!view) {
        return { start: 0, end: 0 }
      }

      return {
        start: view.state.selection.main.from,
        end: view.state.selection.main.to,
      }
    },
    getValue() {
      return viewRef.current?.state.doc.toString() || ''
    },
    redo() {
      if (collaborationRef.current?.undoManager) {
        collaborationRef.current.undoManager.redo()
        return true
      }
      return viewRef.current ? redo(viewRef.current) : false
    },
    selectAll() {
      const view = viewRef.current
      if (!view) return
      const docLength = view.state.doc.length
      view.dispatch({
        selection: EditorSelection.range(0, docLength),
        effects: EditorView.scrollIntoView(0, { y: 'start' }),
      })
      view.focus()
    },
    setScrollTop(nextScrollTop) {
      const view = viewRef.current
      if (!view) return
      view.scrollDOM.scrollTop = Math.max(nextScrollTop, 0)
    },
    setSelectionRange(start, end, options = {}) {
      const view = viewRef.current
      if (!view) return

      const docLength = view.state.doc.length
      const nextStart = clampPosition(start, docLength)
      const nextEnd = clampPosition(end, docLength)
      const effects = options.reveal
        ? [EditorView.scrollIntoView(nextStart, { y: options.center ? 'center' : 'nearest' })]
        : []

      view.dispatch({
        selection: EditorSelection.range(nextStart, nextEnd),
        effects,
      })
      view.focus()

      if (typeof options.scrollTop === 'number') {
        view.scrollDOM.scrollTop = Math.max(options.scrollTop, 0)
      }
    },
    undo() {
      if (collaborationRef.current?.undoManager) {
        collaborationRef.current.undoManager.undo()
        return true
      }
      return viewRef.current ? undo(viewRef.current) : false
    },
  }), [])

  return <div ref={containerRef} style={styles.host} />
})

const styles = {
  host: {
    width: '100%',
    height: '100%',
  },
}

export default CollaborativeEditor
