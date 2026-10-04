import type { Point } from '../../core/geometry';

/** One logged moment: milliseconds since the run started, a type, and whatever else it records. */
export interface LogEvent
{
    readonly t: number;
    readonly type: string;
    readonly [key: string]: unknown;
}

/** How often (ms) the true position is sampled into the path. */
const SAMPLE_MS = 100;

/**
 * Playtest record of one run: the true path, sampled every SAMPLE_MS, and every event that matters
 * for judging the slice (readings, fixes, map use, slides, the end, recall marks). Never shown to the
 * player during the run; the debrief draws from it and the facilitator downloads it as JSON.
 */
export class RunLog
{
    readonly startedAt = new Date().toISOString();
    readonly path: { t: number; x: number; y: number }[] = [];
    readonly events: LogEvent[] = [];
    private lastSample = -Infinity;

    /** Records the position if SAMPLE_MS has passed since the last sample (or `force`). */
    sample (t: number, position: Point, force = false)
    {
        if (force || t - this.lastSample >= SAMPLE_MS)
        {
            this.path.push({ t: Math.round(t), x: round(position.x), y: round(position.y) });
            this.lastSample = t;
        }
    }

    event (t: number, type: string, data: Record<string, unknown> = {})
    {
        this.events.push({ t: Math.round(t), type, ...data });
    }

    /** Saves the log as a JSON file through the browser. */
    download ()
    {
        const blob = new Blob([JSON.stringify({ startedAt: this.startedAt, path: this.path, events: this.events })], { type: 'application/json' });
        const link = document.createElement('a');

        link.href = URL.createObjectURL(blob);
        link.download = `shelf-run-${this.startedAt.replace(/[:.]/g, '-')}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
    }
}

const round = (value: number) => Math.round(value * 10) / 10;
