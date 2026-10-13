import { readFile } from 'node:fs/promises'
import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** A FitLog backup file: app marker, export time, then one list of rows per table. */
export type Backup = { app: string; exported_at: string } & Record<string, unknown>

/** More → export my data / restore from backup. */
export class BackupPage extends BasePage {
  protected readonly path = '/more'

  readonly exportButton = this.page.getByRole('button', { name: 'Export my data (JSON)' })
  readonly restoreButton = this.page.getByRole('button', { name: 'Restore from backup (JSON)' })
  readonly replaceButton = this.page.getByRole('button', { name: 'Replace my data' })
  readonly cancelButton = this.page.getByRole('button', { name: 'Cancel', exact: true })

  /** Export through the UI and read the downloaded file. */
  async exportBackup(): Promise<Backup> {
    await this.goto()
    const download = this.page.waitForEvent('download')
    await this.exportButton.click()
    return JSON.parse(await readFile(await (await download).path(), 'utf8')) as Backup
  }

  /** Pick a file through the real file chooser, as a user would. */
  async chooseFile(contents: string, name = 'fitlog-backup.json'): Promise<void> {
    await this.goto()
    const chooser = this.page.waitForEvent('filechooser')
    await this.restoreButton.click()
    await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(contents) })
  }

  /** Choose a backup and confirm. The app reloads itself once the restore finishes. */
  async restore(backup: Backup): Promise<void> {
    await this.chooseFile(JSON.stringify(backup))
    const reloaded = this.page.waitForEvent('load')
    await this.replaceButton.click()
    await reloaded
  }

  /** A row of the restore preview, e.g. "diary entries · 2". */
  previewRow(label: string): Locator {
    return this.page.getByRole('listitem').filter({ hasText: label })
  }

  message(text: string): Locator {
    return this.page.getByText(text, { exact: true })
  }
}
