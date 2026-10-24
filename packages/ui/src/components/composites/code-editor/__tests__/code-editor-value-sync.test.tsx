// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'

import CodeEditor from '../code-editor'

function DelayedValueHarness({ content }: { content: string }) {
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue(content)
  }, [content])

  return <CodeEditor value={value} onChange={setValue} language="markdown" />
}

describe('CodeEditor value sync', () => {
  it('keeps a value that arrives after mount but before the editor view exists', async () => {
    const { container } = render(<DelayedValueHarness content="delayed content" />)

    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('delayed content')
    })
  })
})
