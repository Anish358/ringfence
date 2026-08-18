/**
 * Applicant Check — the screen that saves money.
 *
 * Everything else in Ringfence explains fraud that already happened. This runs
 * BEFORE disbursement, which is where the business value is: ninety seconds of
 * automated approval becomes a rejection, and the ring loses an account.
 *
 * The shell is a Server Component only so it can pull example inputs from the
 * live graph. The form itself is a client component, because the user submits
 * it and needs to watch it work.
 */

import { exampleApplicants } from '@/queries/applicant'
import { ApplicantForm } from '@/components/check/ApplicantForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function CheckPage() {
  // If the graph is unreachable the examples simply do not render -- the form
  // still works, and the error surfaces on submit where the user is looking.
  const examples = await exampleApplicants().catch(() => [])

  return (
    <>
      <div className="mb-6 max-w-[70ch]">
        <h1 className="text-[22px] font-semibold tracking-tight">Applicant Check</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
          Run a new application against the graph before money moves. The applicant has no
          account yet, so their raw identifiers are resolved against nodes that already
          exist — then traversed to see how close they sit to accounts already confirmed as
          fraud.
        </p>
      </div>
      <ApplicantForm examples={examples} />
    </>
  )
}
