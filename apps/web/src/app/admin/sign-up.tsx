import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '~/lib/auth-client'
import { PaperCard, Scrawl, StickerButton, FIELD, LABEL } from '~/components/paper'
import { BRAND } from '../../../../../packages/shared/src/brand'

export function AdminSignUp() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const name = email.split('@')[0] || 'admin'
    const { error: err } = await authClient.signUp.email({ email, password, name })
    setLoading(false)
    if (err) {
      setError(err.message ?? 'Sign up failed')
      return
    }
    navigate('/admin', { replace: true })
  }

  return (
    <div className="tabletop grid min-h-dvh place-items-center p-6">
      <PaperCard className="w-full max-w-sm" tilt={-1}>
        <Scrawl as="h1" className="text-3xl text-ink">
          {BRAND.name} admin
        </Scrawl>
        <p className="mb-1 mt-1 font-hand text-lg text-ink-soft">Make an admin account</p>
        <p className="mb-4 font-hand text-sm text-ink-soft">
          Only allow-listed emails can sign in. If yours is not on the list the account is created but
          the portal stays locked.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className={FIELD}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className={FIELD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          {error && <p className="font-hand text-base text-crayon-red">{error}</p>}
          <StickerButton type="submit" tone="green" tilt={-1} disabled={loading} className="w-full">
            {loading ? 'One sec…' : 'Create account'}
          </StickerButton>
        </form>
        <p className="mt-4 font-hand text-base text-ink-soft">
          Already have one?{' '}
          <Link to="/admin/sign-in" className="text-purple underline">
            Sign in
          </Link>
        </p>
      </PaperCard>
    </div>
  )
}
