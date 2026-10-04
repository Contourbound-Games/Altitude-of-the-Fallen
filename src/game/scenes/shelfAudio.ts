/**
 * Minimal synthesized sound for the slice, only where it carries information the eye cannot:
 * wind that rises to a roar near the drop, the slide, the fall, and arrival. Web Audio, no files.
 * The context starts on the first key or click (browsers block sound before a user gesture).
 */
class ShelfAudio
{
    private context: AudioContext | null = null;
    private noise: AudioBuffer | null = null;
    private windGain: GainNode | null = null;
    private windFilter: BiquadFilterNode | null = null;

    /** Starts the context and the wind loop on the first user gesture; later calls do nothing. */
    unlock ()
    {
        if (this.context)
        {
            void this.context.resume();
            return;
        }

        const context = new AudioContext();
        const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = noise.getChannelData(0);
        let brown = 0;

        // Brown-ish noise: wind rather than hiss.
        for (let i = 0; i < data.length; i++)
        {
            brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            data[i] = brown * 3.5;
        }

        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();

        source.buffer = noise;
        source.loop = true;
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(context.destination);
        source.start();

        this.context = context;
        this.noise = noise;
        this.windGain = gain;
        this.windFilter = filter;
        this.setWind(0);
    }

    /** Wind level: 0 is the steady background, 1 the roar at the very edge of the drop. */
    setWind (proximity: number)
    {
        if (!this.context || !this.windGain || !this.windFilter)
        {
            return;
        }

        const now = this.context.currentTime;

        this.windGain.gain.setTargetAtTime(0.05 + 0.5 * proximity * proximity, now, 0.15);
        this.windFilter.frequency.setTargetAtTime(450 + 1800 * proximity, now, 0.15);
    }

    /** A rushing slither that falls in pitch over `seconds`. */
    slide (seconds: number)
    {
        this.burst(seconds, 2400, 500, 0.5);
    }

    /** A short roar then nothing: the drop. */
    fall ()
    {
        this.burst(1.4, 1600, 120, 0.7);
        this.setWind(0);
    }

    /** Two soft tones: the door. */
    arrive ()
    {
        if (!this.context)
        {
            return;
        }

        const now = this.context.currentTime;

        [523.25, 659.25].forEach((frequency, i) => {
            const oscillator = this.context!.createOscillator();
            const gain = this.context!.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0, now + i * 0.25);
            gain.gain.linearRampToValueAtTime(0.15, now + i * 0.25 + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 1.2);
            oscillator.connect(gain).connect(this.context!.destination);
            oscillator.start(now + i * 0.25);
            oscillator.stop(now + i * 0.25 + 1.3);
        });
        this.setWind(0);
    }

    private burst (seconds: number, fromHz: number, toHz: number, level: number)
    {
        if (!this.context || !this.noise)
        {
            return;
        }

        const now = this.context.currentTime;
        const source = this.context.createBufferSource();
        const filter = this.context.createBiquadFilter();
        const gain = this.context.createGain();

        source.buffer = this.noise;
        filter.type = 'bandpass';
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(fromHz, now);
        filter.frequency.exponentialRampToValueAtTime(toHz, now + seconds);
        gain.gain.setValueAtTime(level, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
        source.connect(filter).connect(gain).connect(this.context.destination);
        source.start(now);
        source.stop(now + seconds);
    }
}

/** One context for the whole page, kept across scene restarts. */
export const shelfAudio = new ShelfAudio();
