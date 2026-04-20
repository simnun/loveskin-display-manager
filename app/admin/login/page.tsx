'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { loginAction } from '@/app/actions'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      setError('Credenziali non valide')
    } else {
      router.push('/admin')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-[#e8e8e8] tracking-tight">Loveskin Display</h1>
          <p className="text-[#888] text-sm mt-1">Accedi per gestire i display</p>
        </div>

        <form onSubmit={handleSubmit}
          className="bg-[#131313] border border-[#232323] rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#888] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-[#0a0a0a] border border-[#232323] rounded-lg px-3 py-2 text-[#e8e8e8] text-sm outline-none focus:border-[#3b82f6] transition-colors"
              placeholder="admin@loveskin.it"
            />
          </div>
          <div>
            <label className="block text-sm text-[#888] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-[#0a0a0a] border border-[#232323] rounded-lg px-3 py-2 text-[#e8e8e8] text-sm outline-none focus:border-[#3b82f6] transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-[#ef4444] text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 text-white font-medium rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>
      </div>
    </div>
  )
}
