'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { loginAction } from '@/app/actions'

const TEST_EMAIL = 'admin@loveskin.it'
const TEST_PASSWORD = 'LoveSkin2026!'

const BUILD_INFO = (() => {
  const iso = process.env.NEXT_PUBLIC_BUILD_TIME
  if (!iso) return 'v1 · dev'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `v1 · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})()

export default function LoginPage() {
  const [email, setEmail] = useState(TEST_EMAIL)
  const [password, setPassword] = useState(TEST_PASSWORD)
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await loginAction(email, password)
    setLoading(false)
    if (result.error) {
      setError(result.error ?? 'Errore sconosciuto')
    } else {
      router.push('/admin')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="logo-dark" style={{ width: '240px', height: '60px' }} />
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-[#f5c7b8] rounded-2xl p-6 space-y-4">
          <p className="text-[#8a6a60] text-sm text-center">Accedi per gestire i display</p>

          <div>
            <label className="block text-sm text-[#8a6a60] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-white border border-[#f5c7b8] rounded-lg px-3 py-2 text-[#2d1b17] text-sm outline-none focus:border-[#ad6f62] transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8a6a60] mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-white border border-[#f5c7b8] rounded-lg px-3 py-2 pr-10 text-[#2d1b17] text-sm outline-none focus:border-[#ad6f62] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#b09890] hover:text-[#ad6f62] transition-colors"
                tabIndex={-1}
              >
                {showPw ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && <p className="text-[#dc2626] text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#ad6f62] hover:bg-[#8f5648] disabled:opacity-50 text-[#f5c7b8] font-medium rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? 'Accesso in corso...' : 'Accedi'}
          </button>

          <p className="text-center text-[10px] text-[#b09890] pt-1 select-none">{BUILD_INFO}</p>
        </form>
      </div>
    </div>
  )
}
