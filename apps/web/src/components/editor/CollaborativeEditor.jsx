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

const readOnlyCompartment = new Compartment()
const wrappingCompartment = new Compartment()
const themeCompartment = new Compartment()

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
  fontSize = 15,
  lineHeight = 24,
  onChange,
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
  const onDoubleClickRef = useRef(onDoubleClick)
  const onMountRef = useRef(onMount)
  const onScrollRef = useRef(onScroll)
  const initialConfigRef = useRef({
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

    const view = new EditorView({
      state: EditorState.create({
        doc: initialConfig.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          markdown(),
          keymap.of([
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          readOnlyCompartment.of([
            EditorState.readOnly.of(initialConfig.readOnly),
            EditorView.editable.of(!initialConfig.readOnly),
          ]),
          wrappingCompartment.of(initialConfig.wordWrap ? EditorView.lineWrapping : []),
          themeCompartment.of(createEditorTheme({
            fontSize: initialConfig.fontSize,
            lineHeight: initialConfig.lineHeight,
          })),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            onChangeRef.current?.(update.state.doc.toString())
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
        ],
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
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentValue = view.state.doc.toString()
    if (currentValue === value) return

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
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
