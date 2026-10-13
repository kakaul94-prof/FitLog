import type { Page, Route } from '@playwright/test'

/** What the app sent to the trainer endpoint for one question. */
export interface TrainerRequest {
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** The text snapshot of the user's own log that grounds the answer. */
  context: string
  /** Saved trainer-memory facts. */
  memory: string[]
}

type Reply = { text: string } | { status: number; error: string } | 'hang'

/**
 * Stands in for /api/trainer, the Cloudflare function that streams Claude's
 * answer. The E2E dev server doesn't serve it, and a real model would cost
 * money and answer differently every run. So each test scripts the replies and
 * inspects what the app sent: the conversation, the data snapshot and memory.
 */
export class TrainerStub {
  readonly requests: TrainerRequest[] = []
  private readonly queue: Reply[] = []
  private readonly hung: Route[] = []

  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
    await this.page.route('**/api/trainer', (route) => this.handle(route))
  }

  /** Queue replies, one per question. Text may carry a [[REMEMBER: …]] marker, as the real one can. */
  replies(...texts: string[]): void {
    for (const text of texts) this.queue.push({ text })
  }

  /** The next question gets an HTTP error with this message. */
  failsWith(status: number, error: string): void {
    this.queue.push({ status, error })
  }

  /** The next question gets no answer at all, like a model that's taking its time. */
  hangs(): void {
    this.queue.push('hang')
  }

  async dispose(): Promise<void> {
    for (const route of this.hung) await route.abort().catch(() => {})
  }

  private async handle(route: Route): Promise<void> {
    this.requests.push(route.request().postDataJSON() as TrainerRequest)
    const next = this.queue.shift() ?? { status: 500, error: 'No reply scripted for this question.' }
    if (next === 'hang') {
      this.hung.push(route)
      return
    }
    if ('text' in next) {
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: next.text })
    }
    return route.fulfill({ status: next.status, json: { error: next.error } })
  }
}
