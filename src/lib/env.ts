/**
 * src/lib/env.ts — validated configuration
 * ---------------------------------------------------------------------------
 * Connection details come from the environment and are never committed. This
 * module is the single place they are read, and the single place they are
 * checked.
 *
 * Validation is LAZY (on first getEnv() call) rather than at module import.
 * Importing this file must stay side-effect free: a module-level throw would
 * fire during `next build` on any page that merely imports the query layer,
 * turning a missing variable into a failed BUILD rather than a clear runtime
 * error. Deferring means a misconfigured deployment shows the friendly
 * database-unreachable state instead of never deploying at all.
 */

import { z } from 'zod'

const EnvSchema = z.object({
  COGNODB_URI: z
    .string()
    .min(1, 'COGNODB_URI is required')
    .refine((v) => v.startsWith('bolt+s://') || v.startsWith('bolt://') || v.startsWith('neo4j+s://'), {
      message: 'must be the bolt+s:// URI from the CognoDB console',
    }),
  COGNODB_USER: z.string().min(1).default('cognodb'),
  COGNODB_PASSWORD: z.string().min(1, 'COGNODB_PASSWORD is required'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached

  const parsed = EnvSchema.safeParse({
    COGNODB_URI: process.env.COGNODB_URI,
    COGNODB_USER: process.env.COGNODB_USER,
    COGNODB_PASSWORD: process.env.COGNODB_PASSWORD,
  })

  if (!parsed.success) {
    throw new Error(
      'Invalid CognoDB configuration:\n' +
        parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n') +
        '\n\nCopy .env.example to .env.local and fill in your instance details.\n' +
        'Create a free instance at https://console.cognodb.com/signup\n',
    )
  }

  cached = parsed.data
  return cached
}
