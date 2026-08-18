import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/shell/Nav'
import { DbStatusBanner } from '@/components/shell/DbStatusBanner'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
// Mono is used for every identifier -- account ids, device fingerprints, bank
// accounts. They are data to be compared character by character, and a
// proportional face makes two similar fingerprints look identical.
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Ringfence — fraud ring detection',
  description:
    'Find organised fraud rings in a lending portfolio by treating shared devices, addresses, bank accounts and IPs as traversable connections rather than columns.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        <DbStatusBanner />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-7">{children}</main>
        <footer className="border-t border-line px-5 py-4">
          <p className="mx-auto max-w-[1400px] text-[11.5px] text-ink-3">
            Ringfence · synthetic data, six planted fraud rings · graph queries run on CognoDB over Bolt
          </p>
        </footer>
      </body>
    </html>
  )
}
