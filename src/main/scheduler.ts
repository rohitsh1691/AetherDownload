import { DatabaseService } from './db';
import { DownloadEngine } from './engine';

export class SchedulerService {
  private db: DatabaseService;
  private engine: DownloadEngine;
  private checkInterval!: NodeJS.Timeout;
  private lastCheckedMinute: number = -1;

  constructor(db: DatabaseService, engine: DownloadEngine) {
    this.db = db;
    this.engine = engine;
    this.startTicker();
  }

  private startTicker() {
    // Check scheduler settings every 15 seconds
    this.checkInterval = setInterval(() => {
      this.tick();
    }, 15000);
  }

  private tick() {
    const settings = this.db.getSettings();
    if (!settings.scheduler.enabled) return;

    const now = new Date();
    const currentMinute = now.getMinutes();
    
    // Only execute once per minute change to prevent double triggering
    if (currentMinute === this.lastCheckedMinute) return;
    this.lastCheckedMinute = currentMinute;

    const timeString = now.toTimeString().split(' ')[0]; // "HH:MM:SS"
    const [currH, currM] = timeString.split(':').map(Number);

    // Check Start Time
    if (settings.scheduler.startTime) {
      const [startH, startM] = settings.scheduler.startTime.split(':').map(Number);
      if (currH === startH && currM === startM) {
        console.log(`Scheduler starting downloads at ${timeString}...`);
        this.startAllQueued();
      }
    }

    // Check Stop Time
    if (settings.scheduler.stopTime) {
      const [stopH, stopM] = settings.scheduler.stopTime.split(':').map(Number);
      if (currH === stopH && currM === stopM) {
        console.log(`Scheduler pausing downloads at ${timeString}...`);
        this.pauseAllActive();
      }
    }
  }

  private startAllQueued() {
    const downloads = this.db.getDownloads();
    downloads.forEach(item => {
      if (item.status === 'queued' || item.status === 'paused') {
        this.engine.startDownload(item.id).catch(console.error);
      }
    });
  }

  private pauseAllActive() {
    const downloads = this.db.getDownloads();
    downloads.forEach(item => {
      if (item.status === 'downloading') {
        this.engine.pauseDownload(item.id);
      }
    });
  }

  public stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
