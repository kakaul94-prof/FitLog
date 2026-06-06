import { useState, type FormEvent } from 'react'
import { Dumbbell } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setStatus('sending')
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center p-6">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Dumbbell className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">FitLog</h1>
        <p className="text-sm text-muted-foreground">
          Track food, macros, workouts &amp; weight.
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          {!isSupabaseConfigured ? (
            <p className="text-sm text-muted-foreground">
              Not connected yet. Add your Supabase keys to{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code>{' '}
              and reload.
            </p>
          ) : status === 'sent' ? (
            <div className="text-sm">
              <p className="font-medium text-foreground">Check your email ✉️</p>
              <p className="mt-1 text-muted-foreground">
                We sent a magic link to{' '}
                <span className="font-medium text-foreground">{email}</span>.
                Open it on this device to finish signing in.
              </p>
              <Button
                variant="link"
                className="mt-2 h-auto p-0"
                onClick={() => setStatus('idle')}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {status === 'error' && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={status === 'sending'}
              >
                {status === 'sending' ? 'Sending…' : 'Send magic link'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                No password — we email you a one-tap sign-in link.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
