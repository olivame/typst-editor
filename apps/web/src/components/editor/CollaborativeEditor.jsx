import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'

const readOnlyCompartment = new Compartment()
const wrappingCompartment = new Compartment()
const themeCompartment = new Compartment()
const commentCompartment = new Compartment()

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

function normalizeCommentAnchors(commentAnchors, docLength = Infinity) {
  const boundedDocLength = Number.isFinite(docLength) ? Math.max(docLength, 0) : Infinity

  return (Array.isArray(commentAnchors) ? commentAnchors : [])
    .map((anchor) => {
      const start = Math.max(Number(anchor.start) || 0, 0)
      const end = Math.max(Number(anchor.end) || 0, 0)
      return {
        ...anchor,
        start: Math.min(start, boundedDocLength),
        end: Math.min(end, boundedDocLength),
      }
    })
    .filter((anchor) => anchor.end > anchor.start)
    .sort((left, right) => (
      left.start - right.start
      || left.end - right.end
      || `${left.id || ''}`.localeCompare(`${right.id || ''}`)
    ))
}

function buildCommentTitle(anchor) {
  const titleParts = [
    anchor.summary || 'Comment',
    anchor.locationNote || '',
    anchor.body || '',
  ].filter(Boolean)
  return titleParts.join('\n')
}

function createCommentTooltip(anchors) {
  return hoverTooltip((view, pos) => {
    const matchingAnchors = anchors.filter((anchor) => pos >= anchor.start && pos <= anchor.end)
    if (matchingAnchors.length === 0) return null

    const firstAnchor = matchingAnchors[0]
    return {
      pos: firstAnchor.start,
      end: Math.max(...matchingAnchors.map((anchor) => anchor.end)),
      above: true,
      create() {
        const root = document.createElement('div')
        root.className = 'cm-commentTooltip'

        matchingAnchors.slice(0, 4).forEach((anchor) => {
          const item = document.createElement('div')
          item.className = 'cm-commentTooltipItem'

          const title = document.createElement('div')
          title.className = 'cm-commentTooltipTitle'
          title.textContent = anchor.summary || 'Comment'
          item.appendChild(title)

          if (anchor.locationNote) {
            const note = document.createElement('div')
            note.className = 'cm-commentTooltipNote'
            note.textContent = anchor.locationNote
            item.appendChild(note)
          }

          if (anchor.body) {
            const body = document.createElement('div')
            body.className = 'cm-commentTooltipBody'
            body.textContent = anchor.body
            item.appendChild(body)
          }

          root.appendChild(item)
        })

        if (matchingAnchors.length > 4) {
          const overflow = document.createElement('div')
          overflow.className = 'cm-commentTooltipNote'
          overflow.textContent = `+${matchingAnchors.length - 4} more comments`
          root.appendChild(overflow)
        }

        return { dom: root }
      },
    }
  })
}

function createCommentExtensions(commentAnchors, docLength = Infinity) {
  const anchors = normalizeCommentAnchors(commentAnchors, docLength)
  const decorations = Decoration.set(
    anchors.map((anchor) => Decoration.mark({
      class: [
        'cm-commentAnchor',
        anchor.stale ? 'cm-commentAnchor-stale' : '',
        anchor.relocated ? 'cm-commentAnchor-relocated' : '',
      ].filter(Boolean).join(' '),
      attributes: {
        title: buildCommentTitle(anchor),
      },
    }).range(anchor.start, anchor.end)),
  )

  return [
    EditorView.decorations.of(decorations),
    createCommentTooltip(anchors),
  ]
}

const commentTheme = EditorView.theme({
  '.cm-commentAnchor': {
    backgroundColor: 'rgba(250, 204, 21, 0.26)',
    borderBottom: '2px solid rgba(217, 119, 6, 0.9)',
    borderRadius: '3px',
    cursor: 'help',
  },
  '.cm-commentAnchor-relocated': {
    backgroundColor: 'rgba(253, 186, 116, 0.28)',
    borderBottomColor: 'rgba(234, 88, 12, 0.9)',
  },
  '.cm-commentAnchor-stale': {
    backgroundColor: 'rgba(251, 146, 60, 0.24)',
    borderBottomStyle: 'dashed',
  },
  '.cm-commentTooltip': {
    maxWidth: '320px',
    padding: '10px',
    borderRadius: '12px',
    border: '1px solid #d8b4fe',
    background: '#fffdf7',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)',
    color: '#334155',
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
  },
  '.cm-commentTooltipItem + .cm-commentTooltipItem': {
    marginTop: '9px',
    paddingTop: '9px',
    borderTop: '1px solid #fde68a',
  },
  '.cm-commentTooltipTitle': {
    color: '#92400e',
    fontSize: '12px',
    fontWeight: '800',
    lineHeight: '1.35',
  },
  '.cm-commentTooltipNote': {
    marginTop: '4px',
    color: '#b45309',
    fontSize: '11px',
    fontWeight: '700',
    lineHeight: '1.4',
  },
  '.cm-commentTooltipBody': {
    marginTop: '6px',
    color: '#334155',
    fontSize: '13px',
    lineHeight: '1.45',
    whiteSpace: 'pre-wrap',
  },
})

const CollaborativeEditor = forwardRef(function CollaborativeEditor({
  authToken = '',
  collaborationSession = null,
  commentAnchors = [],
  fontSize = 15,
  lineHeight = 24,
  onChange,
  onConnectionStateChange,
  onCursorClick,
  onDoubleClick,
  onMount,
  onScroll,
  onSelectionChange,
  readOnly = false,
  value = '',
  wordWrap = true,
}, ref) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onConnectionStateChangeRef = useRef(onConnectionStateChange)
  const onCursorClickRef = useRef(onCursorClick)
  const onDoubleClickRef = useRef(onDoubleClick)
  const onMountRef = useRef(onMount)
  const onScrollRef = useRef(onScroll)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const commentAnchorsRef = useRef(commentAnchors)
  const collaborationRef = useRef(null)
  const lastPublishedValueRef = useRef(value)
  const suppressedChangeCountRef = useRef(0)
  const initialConfigRef = useRef({
    authToken,
    collaborationSession,
    commentAnchors,
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
    onCursorClickRef.current = onCursorClick
  }, [onCursorClick])

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
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    commentAnchorsRef.current = commentAnchors
  }, [commentAnchors])

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
      commentTheme,
      commentCompartment.of(createCommentExtensions(
        initialConfig.commentAnchors,
        shouldUseRealtime ? 0 : initialConfig.value.length,
      )),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) {
          onSelectionChangeRef.current?.({
            start: update.state.selection.main.from,
            end: update.state.selection.main.to,
          })
        }

        if (update.docChanged) {
          const nextValue = update.state.doc.toString()
          lastPublishedValueRef.current = nextValue
          if (suppressedChangeCountRef.current > 0) {
            suppressedChangeCountRef.current -= 1
            return
          }
          onChangeRef.current?.(nextValue)
        }
      }),
      EditorView.domEventHandlers({
        click: (event, view) => {
          if (event.button !== 0) return
          const clickedPosition = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          })
          if (typeof clickedPosition !== 'number') return

          window.requestAnimationFrame(() => {
            onCursorClickRef.current?.(clickedPosition)
          })
        },
        dblclick: (event, view) => {
          const clickedPosition = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          })
          window.requestAnimationFrame(() => {
            const activeView = viewRef.current
            if (!activeView) return
            onDoubleClickRef.current?.(
              typeof clickedPosition === 'number'
                ? clickedPosition
                : activeView.state.selection.main.head,
            )
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
          activeView.dispatch({
            effects: commentCompartment.reconfigure(createCommentExtensions(
              commentAnchorsRef.current,
              activeView.state.doc.length,
            )),
          })
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
      effects: commentCompartment.reconfigure(createCommentExtensions(commentAnchorsRef.current, value.length)),
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

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: commentCompartment.reconfigure(createCommentExtensions(commentAnchors, view.state.doc.length)),
    })
  }, [commentAnchors])

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
    getDocumentPosition(position) {
      const view = viewRef.current
      if (!view) {
        return { offset: 0, line: 0, character: 0, lineText: '' }
      }

      const fallbackPosition = view.state.selection.main.head
      const safePosition = clampPosition(
        typeof position === 'number' ? position : fallbackPosition,
        view.state.doc.length,
      )
      const line = view.state.doc.lineAt(safePosition)

      return {
        offset: safePosition,
        line: line.number - 1,
        character: safePosition - line.from,
        lineText: line.text,
      }
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
