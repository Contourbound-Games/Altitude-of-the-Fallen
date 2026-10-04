import { describe, expect, it } from 'vitest';

// Source of every module that must stay engine-independent, keyed by path relative to src/.
const pureSources = import.meta.glob<string>(['./core/**/*.ts', './shared/**/*.ts'], {
    query: '?raw',
    import: 'default',
    eager: true
});

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function importsOf (source: string): string[]
{
    return [...source.matchAll(IMPORT_SPECIFIER)].map(match => match[1]);
}

describe('core/ and shared/ boundary', () => {
    it('finds the modules it guards', () => {
        expect(Object.keys(pureSources)).toContain('./core/terrain/elevation.ts');
        expect(Object.keys(pureSources)).toContain('./shared/constants.ts');
    });

    it('only imports from core/ or shared/, and never Phaser or another package', () => {
        const violations: string[] = [];

        for (const [path, source] of Object.entries(pureSources))
        {
            for (const specifier of importsOf(source))
            {
                if (specifier === 'vitest' && path.endsWith('.test.ts'))
                {
                    continue;
                }

                const resolved = specifier.startsWith('.')
                    ? new URL(specifier, new URL(path, 'file:///src/')).pathname
                    : specifier;

                if (!resolved.startsWith('/src/core/') && !resolved.startsWith('/src/shared/'))
                {
                    violations.push(`${path} imports '${specifier}'`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
