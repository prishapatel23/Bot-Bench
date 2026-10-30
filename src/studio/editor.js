// CodeMirror setup. Loaded on demand by run.js so the other tabs start faster.

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { linter, lintGutter } from '@codemirror/lint';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const theme = EditorView.theme({
  '&': { color: '#dfe9ec', backgroundColor: 'var(--code-bg)', fontSize: '13.5px' },
  '.cm-content': { fontFamily: 'JetBrains Mono, monospace', fontVariantLigatures: 'none', caretColor: '#f3c326', padding: '10px 0' },
  '.cm-scroller': { fontFamily: 'JetBrains Mono, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: '#4f646c', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#9fb3ba' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#f3c326', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(139,240,255,0.18) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(243,195,38,0.2)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: '#1b2a31', color: '#dfe9ec', border: '1px solid #2c3f47', borderRadius: '8px' },
  '.cm-diagnostic': { padding: '6px 10px', fontFamily: 'Atkinson Hyperlegible, sans-serif' },
  '.cm-panels': { backgroundColor: '#1b2a31', color: '#dfe9ec' },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: '#f3c326' },
  { tag: [t.typeName, t.standard(t.typeName)], color: '#8bf0ff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#9fd0ff' },
  { tag: [t.number, t.bool, t.null], color: '#ff9da1' },
  { tag: [t.string, t.character], color: '#a9e5b8' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#62777f', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.macroName], color: '#e7a6ff' },
  { tag: [t.operator, t.punctuation], color: '#9fb3ba' },
]);

export function createEditor({ parent, doc, lintSource, onChange }) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        cpp(),
        theme,
        syntaxHighlighting(highlight),
        lintGutter(),
        linter(lintSource, { delay: 400 }),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });
}
