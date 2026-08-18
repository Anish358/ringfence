'use client'

/**
 * Last-resort boundary. error.tsx cannot catch a failure in the root layout
 * itself -- for example getEnv() throwing because nothing is configured -- so
 * this one ships its own <html> and inline styles and depends on nothing.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f1f3f7', color: '#111827' }}>
        <div style={{ maxWidth: 560, margin: '18vh auto', padding: '0 24px' }}>
          <h1 style={{ fontSize: 19, margin: '0 0 10px' }}>Ringfence could not start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#4b5768', margin: '0 0 18px' }}>
            The application failed before it could render. This is almost always missing
            configuration: copy <code>.env.example</code> to <code>.env.local</code> and fill in
            the CognoDB connection details.
          </p>
          <pre style={{ fontSize: 12, background: '#fff', border: '1px solid #d6dce6', borderRadius: 6, padding: 12, overflowX: 'auto' }}>
            {error.message}
          </pre>
          <button onClick={reset} style={{ marginTop: 16, padding: '8px 14px', fontSize: 13, borderRadius: 6, border: '1px solid #1f4796', background: '#1f4796', color: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
