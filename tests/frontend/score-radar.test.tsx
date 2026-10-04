import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderScoreRadarDot } from '../../frontend/components/ScoreRadar';

describe('ScoreRadar markers distinguish missing, zero and ordinary scores (T-110)', () => {
  it.each([
    ['missing', null, false],
    ['zero', 0, true],
    ['ordinary', 8, true],
  ] as const)('%s', (_label, score, visible) => {
    const markup = renderToStaticMarkup(
      renderScoreRadarDot({
        cx: 100,
        cy: 120,
        payload: { score: score ?? 0, unavailable: score === null },
      }),
    );
    expect(markup.includes('<circle')).toBe(visible);
    if (visible) {
      expect(markup).toContain(`data-score="${score}"`);
      expect(markup).toContain('fill="var(--color-data)"');
    }
  });
});
